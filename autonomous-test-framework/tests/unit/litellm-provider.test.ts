'use strict';

/**
 * @fileoverview Unit tests for LiteLLMProvider.
 * Verifies that the provider correctly wraps the OpenAI SDK,
 * sets the proxy baseURL, maps response fields, and applies
 * response_format when json=true.
 */

import { LiteLLMProvider } from '../../core/llm/providers/LiteLLMProvider';

// ─── Mock the openai SDK ──────────────────────────────────────────────────────

const mockCreate = jest.fn();

jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  }));
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('LiteLLMProvider', () => {
  const PROXY_URL = 'http://localhost:4000';
  const API_KEY = 'test-master-key';

  let provider: LiteLLMProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'Hello from LiteLLM proxy' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    provider = new LiteLLMProvider(PROXY_URL, API_KEY);
  });

  it('should initialize the OpenAI SDK with the correct proxy baseURL', () => {
    const OpenAI = require('openai');
    const constructorCall = OpenAI.mock.calls[OpenAI.mock.calls.length - 1][0];
    expect(constructorCall.baseURL).toBe(`${PROXY_URL}/v1`);
    expect(constructorCall.apiKey).toBe(API_KEY);
    expect(constructorCall.maxRetries).toBe(0);
  });

  it('should strip trailing slash from proxyUrl before appending /v1', () => {
    const OpenAI = require('openai');
    OpenAI.mockClear();
    new LiteLLMProvider('http://localhost:4000/', API_KEY);
    const constructorCall = OpenAI.mock.calls[0][0];
    expect(constructorCall.baseURL).toBe('http://localhost:4000/v1');
  });

  it('should return text and usage from a successful chat call', async () => {
    const result = await provider.chat({
      model: 'gemini-3.5-flash',
      messages: [{ role: 'user', content: 'Hello' }],
    });

    expect(result.text).toBe('Hello from LiteLLM proxy');
    expect(result.usage?.promptTokens).toBe(10);
    expect(result.usage?.completionTokens).toBe(5);
    expect(result.usage?.totalTokens).toBe(15);
  });

  it('should pass model name, messages, temperature, and max_tokens to the SDK', async () => {
    await provider.chat({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hi' },
      ],
      temperature: 0.3,
      max_tokens: 2048,
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o',
        temperature: 0.3,
        max_tokens: 2048,
      }),
    );
  });

  it('should set response_format to json_object when json=true', async () => {
    await provider.chat({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Return JSON' }],
      json: true,
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        response_format: { type: 'json_object' },
      }),
    );
  });

  it('should NOT include response_format when json is false or undefined', async () => {
    await provider.chat({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Return text' }],
      json: false,
    });

    const call = mockCreate.mock.calls[0][0];
    expect(call).not.toHaveProperty('response_format');
  });

  it('should return empty string when choices[0].message.content is null', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: null } }],
      usage: { prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 },
    });

    const result = await provider.chat({
      model: 'gemini-3.5-flash',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(result.text).toBe('');
  });

  it('should propagate SDK errors so LLMClient._withRetry can handle them', async () => {
    const error = Object.assign(new Error('Rate limit'), { status: 429 });
    mockCreate.mockRejectedValueOnce(error);

    await expect(
      provider.chat({
        model: 'gemini-3.5-flash',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).rejects.toMatchObject({ status: 429 });
  });
});
