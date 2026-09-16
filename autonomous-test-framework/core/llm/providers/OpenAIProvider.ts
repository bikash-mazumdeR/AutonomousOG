'use strict';

import axios from 'axios';
import { LLMProvider, LLMChatOptions, LLMResponse } from './LLMProvider';

export class OpenAIProvider implements LLMProvider {
  name = 'openai';
  private apiKey: string;
  private baseUrl = 'https://api.openai.com/v1/chat/completions';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async chat(options: LLMChatOptions): Promise<LLMResponse> {
    const payload: any = {
      model: options.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 4096,
    };

    if (options.json) {
      payload.response_format = { type: 'json_object' };
    }

    if (options.seed !== undefined) {
      payload.seed = options.seed;
    }

    const response = await axios.post(this.baseUrl, payload, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    });

    return {
      text: response.data.choices[0].message.content,
      ...(response.data.choices[0].finish_reason === 'length' ? { truncated: true } : {}),
      usage: {
        promptTokens: response.data.usage?.prompt_tokens ?? 0,
        completionTokens: response.data.usage?.completion_tokens ?? 0,
        totalTokens: response.data.usage?.total_tokens ?? 0,
      }
    };
  }
}

