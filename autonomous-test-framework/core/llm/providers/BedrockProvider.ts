'use strict';

/**
 * @fileoverview AWS Bedrock provider (Converse API), authenticated with a Bedrock API key sent as a bearer token.
 * Throttling (429) and unavailability (503) surface as axios errors, so LLMClient falls back to the next candidate.
 */

import axios from 'axios';
import { LLMProvider, LLMChatOptions, LLMResponse } from './LLMProvider';

/** Output token ceiling; several Bedrock models reject larger values. Override with BEDROCK_MAX_TOKENS. */
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_TEMPERATURE = 0.7;
const REQUEST_TIMEOUT_MS = 120000;

function maxTokensLimit(): number {
  const configured = Number(process.env.BEDROCK_MAX_TOKENS);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_MAX_TOKENS;
}

/**
 * Bedrock chat provider using the model-agnostic Converse API.
 */
export class BedrockProvider implements LLMProvider {
  name = 'bedrock';

  private readonly apiKey: string;

  private readonly region: string;

  /**
   * @param {string} apiKey - Bedrock API key (AWS_BEARER_TOKEN_BEDROCK)
   * @param {string} region - AWS region of the Bedrock runtime endpoint
   */
  constructor(apiKey: string, region: string) {
    this.apiKey = apiKey;
    this.region = region;
  }

  /**
   * Sends a conversation to a Bedrock model or inference profile.
   * @param {LLMChatOptions} options - `seed` and `json` are not supported by Converse and are ignored
   * @returns {Promise<LLMResponse>}
   */
  async chat(options: LLMChatOptions): Promise<LLMResponse> {
    const system = options.messages.filter((m) => m.role === 'system').map((m) => ({ text: m.content }));
    const messages = options.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: [{ text: m.content }] }));
    const limit = maxTokensLimit();
    const url = `https://bedrock-runtime.${this.region}.amazonaws.com/model/${encodeURIComponent(options.model)}/converse`;

    const response = await axios.post(url, {
      messages,
      ...(system.length > 0 ? { system } : {}),
      inferenceConfig: {
        maxTokens: Math.min(options.max_tokens ?? limit, limit),
        temperature: options.temperature ?? DEFAULT_TEMPERATURE,
      },
    }, {
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      timeout: REQUEST_TIMEOUT_MS,
    });

    const content: any[] = response.data?.output?.message?.content || [];
    const usage = response.data?.usage || {};
    const promptTokens = usage.inputTokens ?? 0;
    const completionTokens = usage.outputTokens ?? 0;
    return {
      text: content.find((block) => typeof block?.text === 'string')?.text || '',
      usage: { promptTokens, completionTokens, totalTokens: usage.totalTokens ?? promptTokens + completionTokens },
    };
  }
}
