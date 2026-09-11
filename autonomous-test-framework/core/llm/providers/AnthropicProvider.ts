'use strict';

import axios from 'axios';
import { LLMProvider, LLMChatOptions, LLMResponse } from './LLMProvider';

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic';
  private apiKey: string;
  private baseUrl = 'https://api.anthropic.com/v1/messages';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async chat(options: LLMChatOptions): Promise<LLMResponse> {
    const systemMessage = options.messages.find(m => m.role === 'system')?.content || '';
    const messages = options.messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'assistant' as const : 'user' as const,
        content: m.content
      }));

    const response = await axios.post(this.baseUrl, {
      model: options.model,
      system: systemMessage,
      messages: messages,
      max_tokens: options.max_tokens ?? 2000,
      temperature: options.temperature ?? 0.7,
    }, {
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    });

    return {
      text: response.data.content[0].text,
      usage: {
        promptTokens: response.data.usage?.input_tokens ?? 0,
        completionTokens: response.data.usage?.output_tokens ?? 0,
        totalTokens: (response.data.usage?.input_tokens ?? 0) + (response.data.usage?.output_tokens ?? 0),
      }
    };
  }
}

