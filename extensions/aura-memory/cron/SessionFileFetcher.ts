/**
 * Session File Fetcher - Reads OpenClaw session JSONL files
 *
 * Implements copy-process-delete workflow:
 * 1. Copy session file to working directory
 * 2. Read new messages since last checkpoint (byte offset)
 * 3. Filter out AURA commands and verbose think blocks
 * 4. Track individual message failures
 * 5. Delete working copy
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { Message } from "../types.js";
import type { IMessageFetcher, MessageFetchResult, FetchOptions } from "./types.js";

// Logger interface
interface Logger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  debug: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, error?: Error, meta?: Record<string, unknown>) => void;
}

/**
 * Checkpoint for tracking progress per session file
 */
export interface SessionCheckpoint {
  /** Session ID (from filename) */
  sessionId: string;
  /** Full path to original session file */
  originalPath: string;
  /** Bytes successfully processed */
  byteOffset: number;
  /** Number of lines processed */
  lineCount: number;
  /** Timestamp of last processed message */
  lastMessageTimestamp: number;
  /** Individual message failures: messageId -> error */
  failedMessages: Record<string, string>;
  /** MD5 checksum of processed content (verify no gaps) */
  contentHash: string;
  /** Last update time */
  updatedAt: number;
}

/**
 * Options for session file fetching
 */
export interface SessionFileFetcherOptions {
  /** Directory containing session files (e.g., ~/.openclaw/agents/main/sessions) */
  sessionsDir: string;
  /** Working directory for file copies */
  workDir: string;
  /** Checkpoint storage (SQLite or JSON file path) */
  checkpointPath: string;
}

/**
 * Message fetcher that reads OpenClaw JSONL session files
 */
export class SessionFileFetcher implements IMessageFetcher {
  private options: SessionFileFetcherOptions;
  private checkpoints: Map<string, SessionCheckpoint> = new Map();
  private log: Logger;

  constructor(options: SessionFileFetcherOptions, logger?: Logger) {
    this.options = options;
    this.log = logger || {
      info: () => {},
      debug: () => {},
      warn: () => {},
      error: () => {},
    };
  }

  /**
   * Initialize fetcher: ensure directories exist, load checkpoints
   */
  async initialize(): Promise<void> {
    // Ensure work directory exists
    await fs.mkdir(this.options.workDir, { recursive: true });

    // Load existing checkpoints
    await this.loadCheckpoints();

    this.log.info("SessionFileFetcher initialized", {
      sessionsDir: this.options.sessionsDir,
      workDir: this.options.workDir,
      checkpointsLoaded: this.checkpoints.size,
    });
  }

  /**
   * Fetch messages from all session files since last run
   * Returns aggregated messages from all sessions
   */
  async fetchSince(timestamp: number, options: FetchOptions): Promise<MessageFetchResult> {
    const correlationId = `fetch-${Date.now()}`;

    // Discover all session files
    const sessionFiles = await this.discoverSessionFiles();

    const allMessages: Message[] = [];
    let totalNewMessages = 0;

    for (const sessionFile of sessionFiles) {
      try {
        const messages = await this.processSessionFile(sessionFile, correlationId);

        // Filter messages newer than timestamp
        const newMessages = messages.filter((m) => m.timestamp > timestamp);

        allMessages.push(...newMessages);
        totalNewMessages += newMessages.length;
      } catch (error) {
        this.log.error("Failed to process session file", error as Error, {
          correlationId,
          sessionFile,
        });
        // Continue with other sessions, don't fail entire batch
      }
    }

    // Sort by timestamp (oldest first)
    allMessages.sort((a, b) => a.timestamp - b.timestamp);

    // Apply batch size limit
    const limitedMessages = allMessages.slice(0, options.batchSize);
    const hasMore = allMessages.length > options.batchSize;

    this.log.info("Session file fetch completed", {
      correlationId,
      sessionsProcessed: sessionFiles.length,
      totalNewMessages,
      returnedMessages: limitedMessages.length,
      hasMore,
    });

    return {
      messages: limitedMessages,
      hasMore,
      nextCursor: hasMore ? String(timestamp) : undefined,
    };
  }

  /**
   * Stream messages in batches from all session files
   */
  async *streamBatches(timestamp: number, batchSize: number): AsyncGenerator<Message[]> {
    const sessionFiles = await this.discoverSessionFiles();
    let totalFetched = 0;

    for (const sessionFile of sessionFiles) {
      try {
        const messages = await this.processSessionFile(sessionFile, `stream-${Date.now()}`);
        const newMessages = messages.filter((m) => m.timestamp > timestamp);

        if (newMessages.length > 0) {
          totalFetched += newMessages.length;
          yield newMessages;
        }
      } catch (error) {
        this.log.error("Failed to stream session file", error as Error, { sessionFile });
        // Continue with other sessions
      }
    }

    this.log.info("Session file streaming completed", { totalFetched });
  }

  /**
   * Check if a session file is locked by OpenClaw
   */
  private async isSessionLocked(sessionPath: string): Promise<boolean> {
    const lockPath = `${sessionPath}.lock`;
    try {
      await fs.access(lockPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Copy session file with retry for locked files.
   * Uses streaming to avoid blocking on file locks.
   */
  private async copySessionFile(
    sourcePath: string,
    destPath: string,
    maxRetries = 3,
  ): Promise<void> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Try streaming copy first - reads without blocking on advisory locks
        const sourceHandle = await fs.open(sourcePath, "r");
        try {
          const destHandle = await fs.open(destPath, "w");
          try {
            // Read and write in chunks to avoid memory issues with large files
            const chunkSize = 64 * 1024; // 64KB chunks
            let position = 0;

            while (true) {
              const buffer = Buffer.alloc(chunkSize);
              const { bytesRead } = await sourceHandle.read(buffer, 0, chunkSize, position);

              if (bytesRead === 0) break;

              await destHandle.write(buffer.slice(0, bytesRead));
              position += bytesRead;
            }

            return; // Success
          } finally {
            await destHandle.close();
          }
        } finally {
          await sourceHandle.close();
        }
      } catch (error) {
        lastError = error as Error;
        if (attempt < maxRetries) {
          // Wait before retry (100ms, 200ms, 400ms...)
          await new Promise((resolve) => setTimeout(resolve, 100 * Math.pow(2, attempt - 1)));
        }
      }
    }

    // All retries failed, throw the last error
    throw lastError || new Error(`Failed to copy session file after ${maxRetries} attempts`);
  }

  /**
   * Process a single session file: copy, read, parse, delete
   *
   * CHECKPOINT FIX: Updates checkpoint incrementally as messages are parsed,
   * ensuring we don't re-process the same content even if later steps fail.
   *
   * LOCKED FILE HANDLING: Process locked files by copying first.
   * The lock prevents writes, but reading is safe via copy.
   */
  private async processSessionFile(sessionPath: string, correlationId: string): Promise<Message[]> {
    const sessionId = path.basename(sessionPath, ".jsonl");

    // Check if session is locked (for logging only - we still process)
    const isLocked = await this.isSessionLocked(sessionPath);
    if (isLocked) {
      this.log.debug("Session file locked, processing copy anyway", { correlationId, sessionId });
    }

    const workPath = path.join(this.options.workDir, `${sessionId}-${Date.now()}.jsonl`);

    // Get or create checkpoint
    let checkpoint = this.checkpoints.get(sessionId);
    if (!checkpoint) {
      checkpoint = {
        sessionId,
        originalPath: sessionPath,
        byteOffset: 0,
        lineCount: 0,
        lastMessageTimestamp: 0,
        failedMessages: {},
        contentHash: "",
        updatedAt: Date.now(),
      };
    }

    try {
      // 1. COPY: Create working copy with retry for locked files
      await this.copySessionFile(sessionPath, workPath);
      this.log.debug("Copied session file to work directory", {
        correlationId,
        sessionId,
        workPath,
        wasLocked: isLocked,
      });

      // 2. READ: Parse new messages from byte offset
      // Returns both messages AND the last byte position successfully parsed
      const { messages, lastBytePosition } = await this.readMessagesFromOffset(
        workPath,
        checkpoint.byteOffset,
        sessionId,
      );

      // 3. FILTER: Remove AURA commands, verbose think blocks, and recall responses
      const filteredMessages = messages.filter((m) => this.shouldIncludeMessage(m));

      // 3b. CHECK FOR RECALL: Skip messages that are just recalling injected context
      const nonRecallMessages = this.filterRecallResponses(
        filteredMessages,
        sessionId,
        correlationId,
      );

      // CHECKPOINT FIX: Update checkpoint to last successfully parsed byte position
      // This ensures we don't re-process content even if extraction fails later
      checkpoint.byteOffset = lastBytePosition;
      checkpoint.lineCount += messages.length;
      checkpoint.lastMessageTimestamp =
        filteredMessages.length > 0
          ? Math.max(...filteredMessages.map((m) => m.timestamp))
          : checkpoint.lastMessageTimestamp;
      checkpoint.updatedAt = Date.now();

      // Save checkpoint immediately (don't wait for extraction)
      this.checkpoints.set(sessionId, checkpoint);
      await this.saveCheckpoint(sessionId, checkpoint);

      this.log.info("Session file processed", {
        correlationId,
        sessionId,
        messagesRead: messages.length,
        messagesFiltered: filteredMessages.length,
        recallFiltered: filteredMessages.length - nonRecallMessages.length,
        lastBytePosition,
        failedMessages: Object.keys(checkpoint.failedMessages).length,
      });

      return nonRecallMessages;
    } catch (error) {
      this.log.error("Failed to process session file", error as Error, {
        correlationId,
        sessionId,
      });
      // CHECKPOINT FIX: Even on error, save progress up to last successful parse
      if (checkpoint.byteOffset > (this.checkpoints.get(sessionId)?.byteOffset || 0)) {
        await this.saveCheckpoint(sessionId, checkpoint);
      }
      throw error;
    } finally {
      // 4. DELETE: Always cleanup working copy
      try {
        await fs.unlink(workPath);
        this.log.debug("Deleted working copy", { correlationId, workPath });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Read messages from session file starting at byte offset
   *
   * CHECKPOINT FIX: Returns both messages AND last byte position successfully parsed.
   * This allows checkpoint to advance even if some lines fail to parse.
   */
  private async readMessagesFromOffset(
    filePath: string,
    byteOffset: number,
    sessionId: string,
  ): Promise<{ messages: Message[]; lastBytePosition: number }> {
    const messages: Message[] = [];
    let lastBytePosition = byteOffset; // Track progress through file

    const fileHandle = await fs.open(filePath, "r");
    try {
      // Read entire file and track byte positions
      const buffer = await fileHandle.readFile({ encoding: "utf-8" });

      // If we have a byte offset, slice from that position but track original positions
      const contentFromOffset = buffer.slice(byteOffset);
      const lines = contentFromOffset.split("\n");

      // Calculate byte position of each line relative to original file
      let currentBytePosition = byteOffset;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineLength = Buffer.byteLength(line, "utf-8") + 1; // +1 for newline

        const trimmedLine = line.trim();
        if (!trimmedLine) {
          // Empty line - still advance position
          currentBytePosition += lineLength;
          continue;
        }

        try {
          const record = JSON.parse(trimmedLine);

          // Skip tool results, tool calls, and other non-conversation records
          if (record.type === "toolResult" || record.type === "toolCall") {
            currentBytePosition += lineLength;
            continue;
          }

          // Only process "message" type records
          if (record.type !== "message" || !record.message) {
            // Not a message - advance position but don't add to results
            currentBytePosition += lineLength;
            continue;
          }

          const msg = record.message;
          if (!msg.role || !msg.content) {
            currentBytePosition += lineLength;
            continue;
          }

          // Extract text content (handle array or string)
          const content = this.extractTextContent(msg.content);
          if (!content) {
            currentBytePosition += lineLength;
            continue;
          }

          // Successfully parsed - add message and update position
          // TIMESTAMP FIX: Convert ISO string timestamps to milliseconds for comparison
          let messageTimestamp: number;
          if (typeof record.timestamp === "string") {
            messageTimestamp = new Date(record.timestamp).getTime();
          } else if (typeof record.timestamp === "number") {
            messageTimestamp = record.timestamp;
          } else {
            messageTimestamp = Date.now();
          }

          messages.push({
            id: record.id || `${sessionId}-${i}`,
            role: msg.role,
            content,
            timestamp: messageTimestamp,
          });

          // Update last successful byte position
          currentBytePosition += lineLength;
          lastBytePosition = currentBytePosition;
        } catch (parseError) {
          // Failed to parse - log but still advance position to avoid re-processing
          this.log.debug("Failed to parse JSONL line", {
            line: trimmedLine.substring(0, 100),
            bytePosition: currentBytePosition,
          });
          currentBytePosition += lineLength;
          // Still update lastBytePosition so we don't re-parse bad lines
          lastBytePosition = currentBytePosition;
        }
      }

      return { messages, lastBytePosition };
    } finally {
      await fileHandle.close();
    }
  }

  /**
   * Extract text content from message (handles string or array format)
   */
  private extractTextContent(content: unknown, role?: string): string | null {
    if (typeof content === "string") {
      return this.cleanContent(content.trim()) || null;
    }

    if (Array.isArray(content)) {
      // Skip messages that contain thinking blocks (assistant internal reasoning)
      const hasThinkingBlock = content.some(
        (part) => part && typeof part === "object" && part.type === "thinking",
      );
      if (hasThinkingBlock) {
        return null;
      }

      // Skip tool results (system output, not conversation)
      const hasToolResult = content.some(
        (part) => part && typeof part === "object" && part.type === "toolResult",
      );
      if (hasToolResult) {
        return null;
      }

      const texts: string[] = [];
      for (const part of content) {
        if (
          part &&
          typeof part === "object" &&
          part.type === "text" &&
          typeof part.text === "string"
        ) {
          texts.push(part.text);
        }
      }
      return this.cleanContent(texts.join(" ").trim()) || null;
    }

    return null;
  }

  /**
   * Clean content by stripping system metadata wrappers
   * Removes "Conversation info" blocks that wrap actual user messages
   */
  private cleanContent(content: string): string {
    if (!content) return content;

    // Strip "Conversation info (untrusted metadata):" block
    // Pattern: Conversation info...```json...```\n\n[Date] Actual message
    const conversationInfoPattern =
      /Conversation info \(untrusted metadata\):\s*```json[\s\S]*?```\s*\n\n(?:\[[^\]]+\]\s*)?/;
    content = content.replace(conversationInfoPattern, "");

    // Strip any remaining system message patterns
    content = content.replace(/^\[System Message\]\s*/i, "");

    return content.trim();
  }

  /**
   * Filter: Should this message be included in extraction?
   * Filters out:
   * - System/tool messages (AURA commands)
   * - Assistant messages with verbose think blocks
   * - Messages with only code/output (no explanation)
   */
  private shouldIncludeMessage(message: Message): boolean {
    // Skip system and tool messages (AURA commands)
    if (message.role === "system" || message.role === "tool" || message.role === "toolResult") {
      return false;
    }

    // Skip assistant messages that are verbose think blocks
    if (message.role === "assistant") {
      if (this.isVerboseThinkBlock(message.content)) {
        return false;
      }

      // Skip pure command output (tool results)
      if (this.isToolOutput(message.content)) {
        return false;
      }
    }

    // Skip very short messages
    if (message.content.length < 20) {
      return false;
    }

    return true;
  }

  /**
   * Detect verbose think blocks in assistant messages
   */
  private isVerboseThinkBlock(content: string): boolean {
    const verbosePatterns = [
      /^\s*Thinking\s*process\s*:/i,
      /^\s*Let\s+me\s+think\s*:/i,
      /^\s*Step\s+\d+[:.)]\s*/i,
      /^\s*Analysis\s*:/i,
      /^\s*Reasoning\s*:/i,
      /^\s*I'll\s+analyze\s+this\s+step\s+by\s+step/i,
      /^\s*Breaking\s+this\s+down\s*:/i,
      /^\s*Let\s+me\s+break\s+this\s+down/i,
      /^\s*First,\s+I('ll|\s+will)/i,
      /^\s*Now\s+let\s+me\s+analyze/i,
    ];

    const lines = content.split("\n");
    const verboseLineCount = lines.filter((line) =>
      verbosePatterns.some((p) => p.test(line)),
    ).length;

    // Skip if >40% of lines are verbose think markers
    return verboseLineCount > lines.length * 0.4;
  }

  /**
   * Detect tool/command output (not conversational content)
   */
  private isToolOutput(content: string): boolean {
    const toolPatterns = [
      /^\s*Executing\s+(command|tool|function)\s*:/i,
      /^\s*Running\s+\w+\s*:/i,
      /^\s*Result\s+from\s+\w+\s*:/i,
      /^```\w*\s*\n*\$/, // Code blocks starting with $
      /^\s*npm\s+(install|run|test|build)/i,
      /^\s*(docker|git|curl|wget|python|node)\s+/i,
      /^\s*\[System\s+Message\]/i,
    ];

    return toolPatterns.some((p) => p.test(content));
  }

  /**
   * Filter out recall responses
   * Uses global recall detector if available to prevent feedback loops
   */
  private filterRecallResponses(
    messages: Message[],
    sessionId: string,
    correlationId: string,
  ): Message[] {
    // Try to get global recall detector from ContextInjector
    try {
      // Dynamic import to avoid circular dependency
      const { getContextInjector } = require("../agents/ContextInjector.js");
      const injector = getContextInjector();
      const recallDetector = injector?.getRecallDetector?.();

      if (!recallDetector) {
        this.log.debug("Recall detector not available, skipping recall filter", {
          correlationId,
          sessionId,
        });
        return messages;
      }

      const filtered: Message[] = [];
      let recallCount = 0;

      for (const message of messages) {
        // Only check assistant messages for recall
        if (message.role === "assistant") {
          const result = recallDetector.isRecallResponse(message.content, sessionId, "assistant");

          if (result.isRecall) {
            recallCount++;
            this.log.info("[RecallDetection] Skipping recall response", {
              correlationId,
              sessionId,
              messageId: message.id,
              reason: result.reason,
              confidence: Math.round(result.confidence * 100),
              novelContentRatio: Math.round(result.novelContentRatio * 100),
            });
            continue; // Skip this message
          }
        }
        filtered.push(message);
      }

      if (recallCount > 0) {
        this.log.info("[RecallDetection] Recall filtering complete", {
          correlationId,
          sessionId,
          totalMessages: messages.length,
          recallFiltered: recallCount,
          keptMessages: filtered.length,
        });
      }

      return filtered;
    } catch (error) {
      this.log.warn("[RecallDetection] Error during recall filtering (non-fatal)", {
        correlationId,
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return messages; // Return original on error
    }
  }

  /**
   * Discover all session JSONL files in sessions directory
   */
  private async discoverSessionFiles(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.options.sessionsDir, { withFileTypes: true });
      return entries
        .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
        .map((e) => path.join(this.options.sessionsDir, e.name));
    } catch (error) {
      this.log.error("Failed to discover session files", error as Error);
      return [];
    }
  }

  /**
   * Mark a message as failed (for checkpoint tracking)
   */
  async markMessageFailed(sessionId: string, messageId: string, error: string): Promise<void> {
    const checkpoint = this.checkpoints.get(sessionId);
    if (checkpoint) {
      checkpoint.failedMessages[messageId] = error;
      checkpoint.updatedAt = Date.now();
      await this.saveCheckpoint(sessionId, checkpoint);
    }
  }

  /**
   * Load checkpoints from storage (simplified - uses in-memory for now)
   */
  private async loadCheckpoints(): Promise<void> {
    try {
      const data = await fs.readFile(this.options.checkpointPath, "utf-8");
      const parsed = JSON.parse(data);
      for (const [sessionId, checkpoint] of Object.entries(parsed)) {
        this.checkpoints.set(sessionId, checkpoint as SessionCheckpoint);
      }
    } catch {
      // No existing checkpoints, start fresh
      this.checkpoints.clear();
    }
  }

  /**
   * Save checkpoint to storage
   */
  private async saveCheckpoint(sessionId: string, checkpoint: SessionCheckpoint): Promise<void> {
    try {
      // Read existing checkpoints
      let allCheckpoints: Record<string, SessionCheckpoint> = {};
      try {
        const data = await fs.readFile(this.options.checkpointPath, "utf-8");
        allCheckpoints = JSON.parse(data);
      } catch {
        // File doesn't exist yet
      }

      // Update this checkpoint
      allCheckpoints[sessionId] = checkpoint;

      // Write back
      await fs.writeFile(
        this.options.checkpointPath,
        JSON.stringify(allCheckpoints, null, 2),
        "utf-8",
      );
    } catch (error) {
      this.log.error("Failed to save checkpoint", error as Error, { sessionId });
      // Don't throw - checkpoint failure shouldn't stop processing
    }
  }

  /**
   * Get all loaded checkpoints (for monitoring/debugging)
   */
  getCheckpoints(): Map<string, SessionCheckpoint> {
    return new Map(this.checkpoints);
  }

  /**
   * Fetch messages from a specific session file
   * Used by ImmediateExtractionService for event-driven extraction
   *
   * @param sessionKey - The session key (e.g., "webchat-steve-abc123" or "agent:main:main")
   * @returns Array of messages from the session
   */
  async fetchSessionMessages(sessionKey: string): Promise<Message[]> {
    this.log.info("[FETCH_DEBUG] ========== SESSION FETCH START ==========");
    this.log.info("[FETCH_DEBUG] Input:", { sessionKey, sessionsDir: this.options.sessionsDir });

    // Strategy 1: Try to find session file directly from sessionKey
    // sessionKey might be: "agent:main:main" or "43fd8340-1119-4eb7-876f-f0e2e0f88674"
    let sessionId = sessionKey;

    // Handle "agent:main:main" format - this is a compound key, not a filename
    if (sessionKey.includes(":")) {
      // This is likely an agent session key, not a file-based session
      // We need to look up the most recent session for this agent
      this.log.info(
        "[FETCH_DEBUG] Agent-style session key detected, looking up latest session file",
      );
      const latestSession = await this.findLatestSessionFile();
      if (latestSession) {
        sessionId = latestSession;
        this.log.info("[FETCH_DEBUG] Using latest session file:", { sessionId });
      } else {
        this.log.warn("[FETCH_DEBUG] No session files found for agent key", { sessionKey });
        return [];
      }
    }

    // Clean up session ID (remove any file extensions if present)
    sessionId = sessionId.replace(".jsonl", "");

    const sessionPath = path.join(this.options.sessionsDir, `${sessionId}.jsonl`);

    this.log.info("[FETCH_DEBUG] Checking file:", {
      sessionId,
      sessionPath,
      dirExists: await this.checkDirExists(this.options.sessionsDir),
    });

    // Check if file exists
    try {
      await fs.access(sessionPath);
      this.log.info("[FETCH_DEBUG] File exists:", { sessionPath });
    } catch (error) {
      this.log.warn("[FETCH_DEBUG] Session file not found", {
        sessionKey,
        sessionId,
        sessionPath,
        error: (error as Error).message,
        availableFiles: await this.listSessionFiles(),
      });
      return [];
    }

    // Process the session file - read ALL messages (not just since checkpoint)
    const correlationId = `fetch-${Date.now()}`;
    this.log.info("[FETCH_DEBUG] Processing session file:", { sessionPath, correlationId });

    // For immediate extraction, we want ALL recent messages, not just new ones
    // So we read the file directly without checkpoint logic
    const result = await this.readAllMessages(sessionPath, correlationId);

    this.log.info("[FETCH_DEBUG] ========== SESSION FETCH END ==========");

    // Helper to extract text content from string or array format
    const extractContentPreview = (content: unknown): string => {
      if (typeof content === "string") {
        return content.substring(0, 50);
      }
      if (Array.isArray(content)) {
        // OpenClaw format: [{type: "text", text: "..."}]
        const textParts = content
          .filter((part: unknown) => part && typeof part === "object" && "text" in part)
          .map((part: any) => part.text)
          .join(" ");
        return textParts.substring(0, 50);
      }
      return String(content).substring(0, 50);
    };

    this.log.info("[FETCH_DEBUG] Results:", {
      messageCount: result.length,
      sessionId,
      sampleMessage: result[0]
        ? {
            role: result[0].role,
            contentPreview: extractContentPreview(result[0].content),
          }
        : null,
    });

    return result;
  }

  /**
   * Read messages from a session file for immediate extraction
   * Uses the same parsing logic as processSessionFile but reads recent messages
   */
  private async readAllMessages(sessionPath: string, correlationId: string): Promise<Message[]> {
    // Use the existing checkpoint system but with a fresh checkpoint
    // This ensures we get recent messages using the proven parsing logic
    const tempCheckpoint: SessionCheckpoint = {
      sessionId: path.basename(sessionPath, ".jsonl"),
      byteOffset: 0, // Start from beginning to get recent context
      lastProcessedAt: new Date(0).toISOString(),
      messageCount: 0,
      failedMessages: {},
    };

    // Read the file and get recent messages
    const messages: Message[] = [];
    const failedLines: number[] = [];

    try {
      const stats = await fs.stat(sessionPath);
      const fileSize = stats.size;

      // For immediate extraction, read last 50KB of file (recent messages)
      const readSize = Math.min(50 * 1024, fileSize);
      const startPos = fileSize - readSize;

      const fileHandle = await fs.open(sessionPath, "r");
      try {
        const buffer = Buffer.alloc(readSize);
        await fileHandle.read(buffer, 0, readSize, startPos);
        const content = buffer.toString("utf-8");

        // Process lines (may have partial first line due to seeking)
        const lines = content.split("\n").filter((line) => line.trim());

        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);

            // Handle OpenClaw message wrapper format
            if (parsed.type === "message" && parsed.message) {
              const message = parsed.message as Message;

              // Normalize content to string (OpenClaw stores as array)
              if (Array.isArray(message.content)) {
                message.content = message.content
                  .filter((part: unknown) => part && typeof part === "object" && "text" in part)
                  .map((part: any) => part.text)
                  .join(" ");
              } else if (typeof message.content !== "string") {
                message.content = String(message.content);
              }

              messages.push(message);
            } else if (parsed.type === "session") {
              continue; // Skip session metadata
            }
          } catch (parseError) {
            failedLines.push(messages.length);
          }
        }
      } finally {
        await fileHandle.close();
      }

      this.log.info("[FETCH_DEBUG] Read messages complete:", {
        correlationId,
        parsedCount: messages.length,
        failedCount: failedLines.length,
      });

      return messages;
    } catch (error) {
      this.log.error("Failed to read session file", error as Error, {
        correlationId,
        sessionPath,
      });
      return [];
    }
  }

  /**
   * Find the most recent session file (for agent-style session keys)
   */
  private async findLatestSessionFile(): Promise<string | null> {
    try {
      const files = await fs.readdir(this.options.sessionsDir);
      const sessionFiles = files
        .filter((f) => f.endsWith(".jsonl") && !f.includes(".reset."))
        .map((f) => ({
          name: f,
          path: path.join(this.options.sessionsDir, f),
        }));

      if (sessionFiles.length === 0) {
        return null;
      }

      // Get stats for each file and find the most recently modified
      const filesWithStats = await Promise.all(
        sessionFiles.map(async (f) => ({
          ...f,
          stats: await fs.stat(f.path),
        })),
      );

      filesWithStats.sort((a, b) => b.stats.mtime.getTime() - a.stats.mtime.getTime());

      const latest = filesWithStats[0];
      this.log.info("[FETCH_DEBUG] Latest session file found:", {
        name: latest.name,
        modified: latest.stats.mtime,
        size: latest.stats.size,
      });

      // Return just the filename without extension
      return latest.name.replace(".jsonl", "");
    } catch (error) {
      this.log.error("[FETCH_DEBUG] Error finding latest session file:", error as Error);
      return null;
    }
  }

  /**
   * Check if directory exists
   */
  private async checkDirExists(dir: string): Promise<boolean> {
    try {
      await fs.access(dir);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List available session files for debugging
   */
  private async listSessionFiles(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.options.sessionsDir);
      return files.filter((f) => f.endsWith(".jsonl")).slice(0, 10); // First 10 only
    } catch {
      return [];
    }
  }
}

/**
 * Error thrown when session file fetch fails
 */
export class SessionFileFetchError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "SessionFileFetchError";
    this.cause = options?.cause;
  }
}
