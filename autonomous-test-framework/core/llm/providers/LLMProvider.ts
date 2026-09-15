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
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface LLMProvider {
  name: string;
  chat(options: LLMChatOptions): Promise<LLMResponse>;
}

