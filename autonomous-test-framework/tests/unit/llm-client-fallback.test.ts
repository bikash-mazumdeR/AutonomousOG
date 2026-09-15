import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LLMClient } from '../../core/llm/LLMClient';

// p-retry is ESM-only and cannot be loaded by Jest here; this mirrors its contract
// (retries, attemptNumber/retriesLeft, and a throwing onFailedAttempt aborts all retries).
jest.mock('p-retry', () => {
  class AbortError extends Error {}
  const pRetry = async (operation: () => Promise<unknown>, options: any = {}) => {
    const maxAttempts = (options.retries ?? 0) + 1;
    for (let attemptNumber = 1; ; attemptNumber += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop -- sequential retries by design
        return await operation();
      } catch (error: any) {
        Object.assign(error, { attemptNumber, retriesLeft: maxAttempts - attemptNumber });
        // eslint-disable-next-line no-await-in-loop -- sequential retries by design
        await options.onFailedAttempt?.(error);
        if (attemptNumber >= maxAttempts) throw error;
      }
    }
  };
  return { __esModule: true, default: pRetry, AbortError };
});
import { FRAMEWORK_CONFIG } from '../../config/framework.config';
import { LLMChatOptions } from '../../core/llm/providers/LLMProvider';

// A stage without a per-agent model, so these tests exercise the shared profile chain
const STAGE_ID = '03-test-case-reviewer';
const llmConfig = (FRAMEWORK_CONFIG as any).llm;
const profile = llmConfig.models[llmConfig.stageMapping[STAGE_ID]];
const CANDIDATES: string[] = [profile.model, ...profile.fallbacks.map((fallback: any) => fallback.model)];
const REQUEST = { messages: [{ role: 'user', content: 'hi' }], temperature: 0, seed: 42 };

function clientWith(exhausted: ReadonlySet<string>, pinsPath: string) {
  const calls: LLMChatOptions[] = [];
  const provider = {
    name: 'fake',
    chat: async (options: LLMChatOptions) => {
      calls.push(options);
      if (exhausted.has(options.model)) throw Object.assign(new Error('quota exhausted'), { response: { status: 429 } });
      return { text: `ok from ${options.model}`, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
    },
  };
  const client = new LLMClient({ fallbackPinsPath: pinsPath });
  (client as any)._providers = new Map(['gemini', 'openai', 'anthropic', 'bedrock', 'litellm'].map((name) => [name, provider]));
  return { client, calls };
}

describe('LLMClient — seed, served models and fallback pins', () => {
  let dir: string;
  let pinsPath: string;
  const readPins = () => JSON.parse(fs.readFileSync(pinsPath, 'utf-8'));

  beforeAll(() => expect(CANDIDATES.length).toBeGreaterThanOrEqual(3));

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aria-llm-pins-'));
    pinsPath = path.join(dir, 'pins.json');
    delete process.env.LLM_FALLBACK_PIN_TTL_MS;
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('forwards the seed and records the primary model without pinning', async () => {
    const { client, calls } = clientWith(new Set(), pinsPath);
    await client.chat(STAGE_ID, REQUEST);
    expect(calls[0]).toMatchObject({ model: CANDIDATES[0], seed: 42, temperature: 0 });
    expect(client.getStageModels(STAGE_ID)).toEqual([CANDIDATES[0]]);
    expect(fs.existsSync(pinsPath)).toBe(false);
  });

  it('reports the fallback model that served the stage and persists a pin', async () => {
    const { client } = clientWith(new Set(CANDIDATES.slice(0, 2)), pinsPath);
    await client.chat(STAGE_ID, REQUEST);
    expect(client.getStageModels(STAGE_ID)).toEqual([CANDIDATES[2]]);
    expect(readPins()[STAGE_ID].model).toBe(CANDIDATES[2]);
  });

  it('starts a later run from an unexpired pin instead of re-hitting exhausted models', async () => {
    const exhausted = new Set(CANDIDATES.slice(0, 2));
    await clientWith(exhausted, pinsPath).client.chat(STAGE_ID, REQUEST);
    const nextRun = clientWith(exhausted, pinsPath);
    nextRun.client.resetStageFallback(STAGE_ID);
    await nextRun.client.chat(STAGE_ID, REQUEST);
    expect(nextRun.calls.map((call) => call.model)).toEqual([CANDIDATES[2]]);
  });

  it('retries the primary model once the pin has expired', async () => {
    fs.writeFileSync(pinsPath, JSON.stringify({ [STAGE_ID]: { model: CANDIDATES[2], pinnedAt: Date.now() - 60_000 } }));
    process.env.LLM_FALLBACK_PIN_TTL_MS = '1000';
    const { client, calls } = clientWith(new Set(), pinsPath);
    client.resetStageFallback(STAGE_ID);
    await client.chat(STAGE_ID, REQUEST);
    expect(calls.map((call) => call.model)).toEqual([CANDIDATES[0]]);
    expect(readPins()[STAGE_ID]).toBeUndefined();
  });

  it('uses the per-agent Bedrock model first and falls back to Gemini when Bedrock throttles', async () => {
    const stage = 'test-per-agent-stage';
    llmConfig.stageModels[stage] = { provider: 'bedrock', model: 'bedrock-agent-model', fallbacks: [{ provider: 'gemini', model: CANDIDATES[0] }] };
    try {
      const { client, calls } = clientWith(new Set(['bedrock-agent-model']), pinsPath);
      await client.chat(stage, REQUEST);
      expect(calls.map((call) => call.model)).toEqual(['bedrock-agent-model', CANDIDATES[0]]);
      expect(client.getStageModels(stage)).toEqual([CANDIDATES[0]]);
    } finally {
      delete llmConfig.stageModels[stage];
    }
  });
});
