/**
 * AURA Memory Extension for OpenClaw - Hello World Version
 *
 * Simplified version for initial testing.
 * Full version is in index.ts.backup
 *
 * Features:
 * - Simple context injection via before_prompt_build hook
 */

import { z } from "zod";
import type { OpenClawPluginApi } from "../plugin-sdk/types.js";
import {
  initializeContextInjector,
  getContextInjector,
  isContextInjectorInitialized,
} from "./agents/ContextInjector.js";

/**
 * Extract user query from full prompt (removes metadata wrapper)
 */
function extractUserQuery(prompt: string | undefined): string {
  if (!prompt) return "";

  // Try to find the user message after the metadata block
  const match = prompt.match(
    /\[(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+UTC\]\s*(.+)/s,
  );
  if (match && match[2]) {
    return match[2].trim();
  }

  // Fallback: look for "user:" in the prompt
  const userMatch = prompt.match(/user:\s*(.+)/is);
  if (userMatch && userMatch[1]) {
    return userMatch[1].trim();
  }

  // If no pattern matches, return the last non-empty line
  const lines = prompt.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length > 0) {
    return lines[lines.length - 1].trim();
  }

  return prompt.trim();
}

const auraMemoryConfigSchema = z.object({
  enabled: z.boolean().default(true),
  contextInjection: z
    .object({
      enabled: z.boolean().default(true),
      minQueryLength: z.number().default(3),
      defaultTokenLimit: z.number().default(4000),
    })
    .default({}),
});

const auraMemoryPlugin = {
  id: "aura-memory",
  name: "AURA Memory",
  description: "Session extraction, knowledge graph integration, and intelligent context injection",
  kind: "extension",
  configSchema: auraMemoryConfigSchema,

  register(api: OpenClawPluginApi) {
    api.logger.info("[AURA Memory] ==========================================");
    api.logger.info("[AURA Memory] EXTENSION REGISTER FUNCTION CALLED");
    api.logger.info("[AURA Memory] ==========================================");

    const config = api.pluginConfig as z.infer<typeof auraMemoryConfigSchema> | undefined;

    if (config?.enabled === false) {
      api.logger.info("[AURA Memory] Extension disabled in config - exiting");
      return;
    }

    const pluginConfig = config ?? auraMemoryConfigSchema.parse({});
    const contextInjectionEnabled = pluginConfig.contextInjection?.enabled !== false;

    // Initialize the context injector
    initializeContextInjector({
      defaultTokenLimit: pluginConfig.contextInjection?.defaultTokenLimit ?? 4000,
      minQueryLength: pluginConfig.contextInjection?.minQueryLength ?? 3,
    });
    api.logger.info("[AURA Memory] ContextInjector initialized");

    if (contextInjectionEnabled) {
      api.logger.info("[AURA Memory] Registering before_prompt_build hook...");

      api.on(
        "before_prompt_build",
        async (event) => {
          const hookStartTime = Date.now();

          api.logger.info("[AURA Memory] ==========================================");
          api.logger.info("[AURA Memory] HOOK TRIGGERED - before_prompt_build");
          api.logger.info("[AURA Memory] ==========================================");

          // Get injector
          let injector;
          try {
            injector = getContextInjector();
            api.logger.info("[AURA Memory] ContextInjector obtained successfully");
          } catch (error) {
            api.logger.error("[AURA Memory] FAILED to get ContextInjector:", {
              error: error instanceof Error ? error.message : String(error),
            });
            return {};
          }

          // Extract user query
          const userQuery = extractUserQuery(event.prompt);
          api.logger.info("[AURA Memory] Query extraction:", {
            originalLength: event.prompt?.length ?? 0,
            extractedLength: userQuery.length,
            extractedQuery: userQuery.substring(0, 100),
          });

          // Skip if query too short
          if (userQuery.trim().length < 3) {
            api.logger.info("[AURA Memory] Query too short (< 3 chars), skipping injection");
            return {};
          }

          // Execute injection
          api.logger.info("[AURA Memory] Starting context injection...");

          try {
            const result = injector.inject(userQuery);
            const hookDuration = Date.now() - hookStartTime;

            api.logger.info("[AURA Memory] ==========================================");
            api.logger.info("[AURA Memory] INJECTION COMPLETE");
            api.logger.info("[AURA Memory] ==========================================");
            api.logger.info("[AURA Memory] Results:", {
              hasContext: result.metadata.hasContext,
              memoryCount: result.metadata.memoryCount,
              buildTimeMs: result.metadata.buildTimeMs,
              hookDurationMs: hookDuration,
            });

            if (result.metadata.hasContext && result.prependContext) {
              api.logger.info("[AURA Memory] SUCCESS - Returning context:", {
                contextLength: result.prependContext.length,
              });

              return {
                prependContext: result.prependContext,
              };
            }

            api.logger.info("[AURA Memory] No context found for this query");
            return {};
          } catch (error) {
            api.logger.error("[AURA Memory] INJECTION FAILED:", {
              error: error instanceof Error ? error.message : String(error),
            });
            return {};
          }
        },
        { priority: 100 },
      );

      api.logger.info("[AURA Memory] before_prompt_build hook registered SUCCESSFULLY");
    } else {
      api.logger.info("[AURA Memory] Context injection disabled in config");
    }

    // Register CLI commands
    registerCliCommands(api);

    api.logger.info("[AURA Memory] ==========================================");
    api.logger.info("[AURA Memory] REGISTRATION COMPLETE");
    api.logger.info("[AURA Memory] ==========================================");
  },
};

// ==========================================
// CLI COMMANDS
// ==========================================
function registerCliCommands(api: OpenClawPluginApi) {
  api.onCliReady?.((program) => {
    // Status command
    program
      .command("aura-memory:status")
      .description("Show AURA memory system status")
      .action(() => {
        console.log("AURA Memory System Status:");
        console.log(
          JSON.stringify(
            {
              version: "2.0.0-hello-world",
              status: "running",
              contextInjection: isContextInjectorInitialized(),
            },
            null,
            2,
          ),
        );
      });

    // Context injection status
    program
      .command("aura-memory:context-status")
      .description("Show AURA context injection status")
      .action(() => {
        if (isContextInjectorInitialized()) {
          const injector = getContextInjector();
          const stats = injector.getStats();
          console.log("AURA Context Injection Status:");
          console.log(JSON.stringify(stats, null, 2));
        } else {
          console.log("AURA Context Injection: Not initialized");
        }
      });

    // Clear cache
    program
      .command("aura-memory:clear-cache")
      .description("Clear AURA context injection cache")
      .action(() => {
        if (isContextInjectorInitialized()) {
          const injector = getContextInjector();
          injector.clearCaches();
          console.log("AURA cache cleared");
        } else {
          console.log("AURA Context Injection: Not initialized");
        }
      });
  });
}

export default auraMemoryPlugin;
