'use strict';

import axios from 'axios';
import { LLMProvider, LLMChatOptions, LLMResponse } from './LLMProvider';

export class GeminiProvider implements LLMProvider {
  name = 'gemini';
  private apiKey: string;
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async chat(options: LLMChatOptions): Promise<LLMResponse> {
    // Gemini uses a different format: contents: [{ role: 'user', parts: [{ text: '...' }] }]
    // System instruction is separate in v1beta
    
    const systemInstruction = options.messages.find(m => m.role === 'system');
    const contents = options.messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));

    const url = `${this.baseUrl}/${options.model}:generateContent?key=${this.apiKey}`;
    
    const payload: any = {
      contents,
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: options.max_tokens ?? 16384,
        ...(options.seed !== undefined ? { seed: options.seed } : {}),
      }
    };

    if (options.json) {
      payload.generationConfig.responseMimeType = 'application/json';
    }

    if (systemInstruction) {
      payload.system_instruction = {
        parts: [{ text: systemInstruction.content }]
      };
    }

    const response = await axios.post(url, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 120000,
    });

    const candidate = response.data?.candidates?.[0];
    const textPart = candidate?.content?.parts?.find((p: any) => p.text && !p.thought) || candidate?.content?.parts?.[0];

    return {
      text: textPart?.text || '',
      usage: {
        promptTokens: response.data.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: response.data.usageMetadata?.candidatesTokenCount ?? 0,
        totalTokens: response.data.usageMetadata?.totalTokenCount ?? 0,
      }
    };
  }
}

