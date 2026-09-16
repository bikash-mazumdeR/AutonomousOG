'use strict';

import OpenAI from 'openai';
import { LLMProvider, LLMChatOptions, LLMResponse } from './LLMProvider';

/**
 * @fileoverview LiteLLM Proxy Provider for the ARIA Framework.
 *
 * Routes all LLM chat calls through a LiteLLM proxy server using the
 * standard OpenAI TypeScript SDK. When LITELLM_PROXY_URL is set in the
 * environment, this provider is used for every configured model
 * (gemini, openai, anthropic) — the proxy handles vendor routing.
 *
 * Setup:
 *   1. Run the LiteLLM proxy:  litellm --config litellm_proxy_config.yaml --port 4000
 *   2. Set in .env:            LITELLM_PROXY_URL=http://localhost:4000
 *   3. Optionally set:         LITELLM_PROXY_API_KEY=sk-your-master-key
 *
 * @see https://docs.litellm.ai/docs/proxy/quick_start
 * @module LiteLLMProvider
 * @version 1.0.0
 */
export class LiteLLMProvider implements LLMProvider {
  name = 'litellm';
  private _client: OpenAI;

  constructor(proxyUrl: string, apiKey: string = 'litellm') {
    this._client = new OpenAI({
      baseURL: `${proxyUrl.replace(/\/$/, '')}/v1`,
      apiKey,            // LiteLLM proxy master key (or 'litellm' as a placeholder if unset)
      timeout: 120_000,
      maxRetries: 0,     // ARIA's _withRetry / fallback chain handles retries externally
    });
  }

  async chat(options: LLMChatOptions): Promise<LLMResponse> {
    const requestParams: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: options.model,
      messages: options.messages as OpenAI.Chat.ChatCompletionMessageParam[],
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 16384,
    };

    if (options.json) {
      requestParams.response_format = { type: 'json_object' };
    }

    if (options.seed !== undefined) {
      requestParams.seed = options.seed;
    }

    const response = await this._client.chat.completions.create(requestParams);

    return {
      text: response.choices[0]?.message?.content ?? '',
      ...(response.choices[0]?.finish_reason === 'length' ? { truncated: true } : {}),
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      },
    };
  }
}
