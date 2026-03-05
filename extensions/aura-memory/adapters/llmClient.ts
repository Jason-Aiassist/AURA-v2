// Container LLM Adapter
// Bridges Sprint 3 extraction engine to OpenClaw container's LLM
// Now uses environment-based configuration

// Inline config to avoid bundling issues
const primaryLLMConfig = {
  model: process.env.PRIMARY_LLM_MODEL || "moonshot/kimi-k2.5",
  baseUrl: process.env.PRIMARY_LLM_BASE_URL || "https://api.moonshot.ai/v1",
  apiKey: process.env.PRIMARY_LLM_API_KEY || "sk-wXOO5NVTAPQM4DZVS3qw4WYJn8LMsOxlTlNlnnlGD5b1zlA9",
};

const deepcoderLLMConfig = {
  model: process.env.DEEPCODER_LLM_MODEL || "coder_fast",
  baseUrl: process.env.DEEPCODER_LLM_BASE_URL || "https://llm.code-weaver.co.uk/v1",
  apiKey: process.env.DEEPCODER_LLM_API_KEY || "sk-local",
};

const litellmConfig = {
  proxyUrl: process.env.LITELLM_PROXY_URL || "http://localhost:11434",
};

// Timeout for LLM requests (30 seconds for coder_fast)
const LLM_TIMEOUT_MS = 30000;

export interface LLMClient {
  complete(params: { prompt: string; maxTokens: number; temperature: number }): Promise<{
    content: string;
    tokensUsed: { input: number; output: number };
  }>;
}

interface LLMResponse {
  content?: string;
  choices?: Array<{ text?: string; message?: { content?: string } }>;
  usage?: { input?: number; output?: number; prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Create LLM client that uses container's gateway
 *
 * Configuration loaded from environment variables:
 * - PRIMARY_LLM_MODEL / DEEPCODER_LLM_MODEL
 * - PRIMARY_LLM_API_KEY / DEEPCODER_LLM_API_KEY
 * - PRIMARY_LLM_BASE_URL / DEEPCODER_LLM_BASE_URL
 */
export function createContainerLLMClient(model?: string): LLMClient {
  const targetModel = model || primaryLLMConfig.model;

  // FIX: Use appropriate config based on model
  // coder_fast/coder_deep -> code-weaver endpoint
  // moonshot/kimi -> moonshot endpoint
  const isDeepCoderModel = targetModel.includes("coder_");
  const baseUrl = isDeepCoderModel
    ? deepcoderLLMConfig.baseUrl || litellmConfig.proxyUrl
    : primaryLLMConfig.baseUrl || litellmConfig.proxyUrl;
  const apiKey = isDeepCoderModel ? deepcoderLLMConfig.apiKey : primaryLLMConfig.apiKey;

  // FIX: Use /v1/chat/completions endpoint, not just base URL
  const apiUrl = baseUrl.endsWith("/v1")
    ? `${baseUrl}/chat/completions`
    : `${baseUrl}/v1/chat/completions`;

  return {
    async complete({ prompt, maxTokens, temperature }) {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      // Add API key if configured
      if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }

      // Add LiteLLM master key if configured
      if (litellmConfig.masterKey) {
        headers["x-master-key"] = litellmConfig.masterKey;
      }

      // Set timeout for fetch
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

      try {
        // Call the LLM through the configured endpoint
        const response = await fetch(apiUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: targetModel,
            messages: [{ role: "user", content: prompt }],
            max_tokens: maxTokens,
            temperature,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          // Fallback to primary model if requested model fails

          // Set timeout for fallback fetch
          const fallbackController = new AbortController();
          const fallbackTimeoutId = setTimeout(() => fallbackController.abort(), LLM_TIMEOUT_MS);

          const fallbackResponse = await fetch(apiUrl, {
            method: "POST",
            headers,
            body: JSON.stringify({
              model: primaryLLMConfig.model,
              messages: [{ role: "user", content: prompt }],
              max_tokens: maxTokens,
              temperature,
            }),
            signal: fallbackController.signal,
          });

          clearTimeout(fallbackTimeoutId);

          if (!fallbackResponse.ok) {
            throw new Error(
              `LLM request failed: ${fallbackResponse.status} ${fallbackResponse.statusText}`,
            );
          }

          const fallbackResult = (await fallbackResponse.json()) as LLMResponse;
          return {
            content:
              fallbackResult.content ||
              fallbackResult.choices?.[0]?.text ||
              fallbackResult.choices?.[0]?.message?.content ||
              "",
            tokensUsed: {
              input: fallbackResult.usage?.input || fallbackResult.usage?.prompt_tokens || 0,
              output: fallbackResult.usage?.output || fallbackResult.usage?.completion_tokens || 0,
            },
          };
        }

        const result = (await response.json()) as LLMResponse;
        return {
          content:
            result.content ||
            result.choices?.[0]?.text ||
            result.choices?.[0]?.message?.content ||
            "",
          tokensUsed: {
            input: result.usage?.input || result.usage?.prompt_tokens || 0,
            output: result.usage?.output || result.usage?.completion_tokens || 0,
          },
        };
      } catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error(`LLM request timed out after ${LLM_TIMEOUT_MS}ms`);
        }
        throw error;
      }
    },
  };
}

/**
 * Create LLM client specifically for extraction
 * Uses DEEPCODER_LLM_MODEL from environment (defaults to local-llm/coder_deep)
 */
export function createExtractionLLMClient(): LLMClient {
  const baseUrl = deepcoderLLMConfig.baseUrl || litellmConfig.proxyUrl;
  // FIX: Use /v1/chat/completions endpoint
  const apiUrl = baseUrl.endsWith("/v1")
    ? `${baseUrl}/chat/completions`
    : `${baseUrl}/v1/chat/completions`;

  return {
    async complete({ prompt, maxTokens, temperature }) {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (deepcoderLLMConfig.apiKey) {
        headers["Authorization"] = `Bearer ${deepcoderLLMConfig.apiKey}`;
      }

      if (litellmConfig.masterKey) {
        headers["x-master-key"] = litellmConfig.masterKey;
      }

      // Set timeout for fetch
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

      try {
        const response = await fetch(apiUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: deepcoderLLMConfig.model,
            messages: [{ role: "user", content: prompt }],
            max_tokens: maxTokens,
            temperature,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          // Fallback to primary LLM if deepcoder fails
          return createContainerLLMClient(primaryLLMConfig.model).complete({
            prompt,
            maxTokens,
            temperature,
          });
        }

        const result = (await response.json()) as LLMResponse;
        return {
          content:
            result.content ||
            result.choices?.[0]?.text ||
            result.choices?.[0]?.message?.content ||
            "",
          tokensUsed: {
            input: result.usage?.input || result.usage?.prompt_tokens || 0,
            output: result.usage?.output || result.usage?.completion_tokens || 0,
          },
        };
      } catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error(`LLM request timed out after ${LLM_TIMEOUT_MS}ms`);
        }
        throw error;
      }
    },
  };
}

/**
 * Create LLM client with specific model selection
 * Uses environment variables for configuration
 */
export function createCoderDeepClient(): LLMClient {
  return createExtractionLLMClient();
}

// Stub for testing - can be enabled via environment
export function createStubLLMClient(): LLMClient {
  return {
    async complete() {
      return {
        content: JSON.stringify({
          memories: [
            {
              content: "Extracted memory from conversation",
              category: "knowledge_base",
              confidence: 0.8,
              reasoning: "This appears to be useful information",
              sourceMessageIds: ["msg-1"],
            },
          ],
        }),
        tokensUsed: { input: 100, output: 50 },
      };
    },
  };
}
