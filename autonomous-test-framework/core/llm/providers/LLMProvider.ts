'use strict';

/**
 * @fileoverview Unified Interface for all LLM Providers.
 */

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMChatOptions {
  model: string;
  messages: LLMMessage[];
  temperature?: number;
  /** Sampling seed for providers that support reproducible sampling (Gemini, OpenAI-compatible). */
  seed?: number;
  max_tokens?: number;
  json?: boolean;
}

export interface LLMResponse {
  text: string;
  /** True when the model stopped because it reached the output token limit (the text is incomplete). */
  truncated?: boolean;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    /** Input tokens served from the provider's prompt cache (not included in promptTokens). */
    cacheReadTokens?: number;
    /** Input tokens written to the provider's prompt cache (not included in promptTokens). */
    cacheWriteTokens?: number;
  };
}

/**
 * Whether prompt caching of the system message is enabled (LLM_PROMPT_CACHE, default on).
 * @returns {boolean}
 */
export function isPromptCacheEnabled(): boolean {
  return String(process.env.LLM_PROMPT_CACHE ?? 'true').toLowerCase() !== 'false';
}

export interface LLMProvider {
  name: string;
  chat(options: LLMChatOptions): Promise<LLMResponse>;
}

