/**
 * @fileoverview Unit tests for the AWS Bedrock provider (Converse API, bearer-token auth).
 */

import axios from 'axios';
import { BedrockProvider } from '../../core/llm/providers/BedrockProvider';

jest.mock('axios');
const mockedPost = axios.post as jest.Mock;

describe('BedrockProvider', () => {
  afterEach(() => {
    mockedPost.mockReset();
    delete process.env.BEDROCK_MAX_TOKENS;
  });

  it('calls the Converse API with a bearer token and maps messages, text and usage', async () => {
    mockedPost.mockResolvedValue({
      data: { output: { message: { content: [{ text: 'hello' }] } }, usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15 } },
    });
    const result = await new BedrockProvider('test-key', 'eu-west-1').chat({
      model: 'us.vendor.model-v1:0',
      messages: [
        { role: 'system', content: 'Be brief' },
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
        { role: 'user', content: 'Again' },
      ],
      temperature: 0,
      max_tokens: 20000,
      seed: 42,
      json: true,
    });

    const [url, body, config] = mockedPost.mock.calls[0];
    expect(url).toBe('https://bedrock-runtime.eu-west-1.amazonaws.com/model/us.vendor.model-v1%3A0/converse');
    expect(config.headers.Authorization).toBe('Bearer test-key');
    expect(body).toEqual({
      system: [{ text: 'Be brief' }],
      messages: [
        { role: 'user', content: [{ text: 'Hi' }] },
        { role: 'assistant', content: [{ text: 'Hello' }] },
        { role: 'user', content: [{ text: 'Again' }] },
      ],
      inferenceConfig: { maxTokens: 8192, temperature: 0 },
    });
    expect(result).toEqual({
      text: 'hello',
      usage: {
        promptTokens: 12, completionTokens: 3, totalTokens: 15, cacheReadTokens: 0, cacheWriteTokens: 0,
      },
    });
  });

  it('adds a system-prompt cache point for Claude/Nova models unless LLM_PROMPT_CACHE=false', async () => {
    mockedPost.mockResolvedValue({
      data: {
        output: { message: { content: [{ text: 'ok' }] } },
        usage: { inputTokens: 5, outputTokens: 1, cacheReadInputTokens: 900, cacheWriteInputTokens: 0 },
      },
    });
    const chat = () => new BedrockProvider('key', 'us-east-1').chat({
      model: 'us.anthropic.claude-sonnet-4-5-v1:0',
      messages: [{ role: 'system', content: 'Skill' }, { role: 'user', content: 'Story' }],
    });
    const result = await chat();
    expect(mockedPost.mock.calls[0][1].system).toEqual([{ text: 'Skill' }, { cachePoint: { type: 'default' } }]);
    expect(result.usage).toMatchObject({ cacheReadTokens: 900 });

    process.env.LLM_PROMPT_CACHE = 'false';
    try {
      await chat();
      expect(mockedPost.mock.calls[1][1].system).toEqual([{ text: 'Skill' }]);
    } finally {
      delete process.env.LLM_PROMPT_CACHE;
    }
  });

  it('honours BEDROCK_MAX_TOKENS and lets throttling errors reach the fallback chain', async () => {
    process.env.BEDROCK_MAX_TOKENS = '4096';
    mockedPost.mockRejectedValue(Object.assign(new Error('Too many requests'), { response: { status: 429 } }));
    await expect(new BedrockProvider('key', 'us-east-1').chat({ model: 'model', messages: [{ role: 'user', content: 'Hi' }] }))
      .rejects.toMatchObject({ response: { status: 429 } });
    expect(mockedPost.mock.calls[0][1].inferenceConfig.maxTokens).toBe(4096);
  });
});
