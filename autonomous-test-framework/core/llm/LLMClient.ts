'use strict';

import pRetry, { AbortError } from 'p-retry';
import { FRAMEWORK_CONFIG } from '../../config/framework.config';
import { Logger } from '../logger/Logger';
import { LLMProvider, LLMChatOptions, LLMResponse } from './providers/LLMProvider';
import { OpenAIProvider } from './providers/OpenAIProvider';
import { AnthropicProvider } from './providers/AnthropicProvider';
import { GeminiProvider } from './providers/GeminiProvider';
import { LiteLLMProvider } from './providers/LiteLLMProvider';
import { TokenUsage } from '../types';
import axios from 'axios';

const logger = new Logger('LLMClient');

export interface LLMClientResponse {
  text: string;
  usage: TokenUsage;
}

export class LLMClient {
  private _providers: Map<string, LLMProvider> = new Map();
  private _stageUsage: Map<string, TokenUsage> = new Map();
  /** Tracks the last-known-working candidate index per stageId (sticky fallback). */
  private _activeCandidateIndex: Map<string, number> = new Map();

  constructor() {
    this._initializeProviders();
  }

  private _initializeProviders() {
    // ── Hybrid mode: LiteLLM proxy takes precedence ─────────────────────────
    // When LITELLM_PROXY_URL is set, ALL chat calls are routed through the proxy
    // regardless of which `provider` is specified in framework.config.ts.
    // The proxy is responsible for routing model names to the correct vendor.
    const proxyUrl = process.env.LITELLM_PROXY_URL;
    if (proxyUrl) {
      const proxyKey = process.env.LITELLM_PROXY_API_KEY || 'litellm';
      const proxy = new LiteLLMProvider(proxyUrl, proxyKey);
      // Register under ALL provider names so the candidate loop in chat()
      // routes every configured model (gemini, openai, anthropic) through the proxy.
      this._providers.set('openai',    proxy);
      this._providers.set('anthropic', proxy);
      this._providers.set('gemini',    proxy);
      this._providers.set('litellm',   proxy);
      logger.info('LiteLLM proxy mode active — all chat calls routed through proxy.', { proxyUrl });
      return;
    }

    // ── Direct mode: use individual vendor providers ─────────────────────────
    if (process.env.OPENAI_API_KEY) {
      this._providers.set('openai', new OpenAIProvider(process.env.OPENAI_API_KEY));
    }
    if (process.env.ANTHROPIC_API_KEY) {
      this._providers.set('anthropic', new AnthropicProvider(process.env.ANTHROPIC_API_KEY));
    }
    if (process.env.GEMINI_API_KEY) {
      this._providers.set('gemini', new GeminiProvider(process.env.GEMINI_API_KEY));
    }
  }


  /**
   * Generates a vector embedding for the given text.
   */
  async createEmbedding(text: string): Promise<number[]> {
    const model = (FRAMEWORK_CONFIG as any).llm.embedding || 'text-embedding-3-small';
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return this._generateMockEmbedding();
    }

    return this._withRetry(async () => {
      logger.info('LLM Embedding Request', { model, textLength: text.length });
      const response = await axios.post('https://api.openai.com/v1/embeddings', {
        model,
        input: text,
      }, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });

      return response.data.data[0].embedding;
    }, 'embeddings');
  }

  /**
   * Sends a prompt to the appropriate LLM provider based on stage configuration.
   *
   * Model selection strategy:
   * 1. Start from the last-known-good candidate index for this stageId (sticky fallback).
   * 2. If the current model returns 503/429, advance to the next fallback and persist
   *    that as the new start index for subsequent calls in the same stage.
   * 3. Hard errors (400/401/403/404) abort immediately without fallback.
   */
  /**
   * Hard ceiling on total wall-clock time for a single chat() call, covering
   * every fallback candidate and retry combined. Without this, a candidate
   * that genuinely hangs (network stall, DNS issue) rather than failing fast
   * can consume its full per-request timeout on every attempt of every
   * fallback (up to `candidates.length * retries * perRequestTimeout`,
   * theoretically tens of minutes) instead of failing fast — which is exactly
   * what stalls the pipeline UI on a spinner with no way to recover short of
   * killing the process.
   */
  private static readonly MAX_CHAT_DURATION_MS = 5 * 60 * 1000;

  async chat(stageId: string, payload: any): Promise<LLMClientResponse> {
    return this._withDeadline(this._chatInternal(stageId, payload), LLMClient.MAX_CHAT_DURATION_MS, stageId);
  }

  /** @private Races a promise against a hard deadline so a hung candidate can't stall the pipeline indefinitely. */
  private _withDeadline<T>(promise: Promise<T>, ms: number, stageId: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(
          `LLM chat() exceeded the maximum allowed duration of ${ms}ms across all fallback candidates for stage "${stageId}" — aborting rather than stalling indefinitely.`
        ));
      }, ms);
      promise.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (err) => { clearTimeout(timer); reject(err); },
      );
    });
  }

  private async _chatInternal(stageId: string, payload: any): Promise<LLMClientResponse> {
    const llmConfig = (FRAMEWORK_CONFIG as any).llm;
    const modelType = llmConfig.stageMapping[stageId] || 'default';
    const modelInfo = llmConfig.models[modelType] || llmConfig.models.default;

    // Build the full ordered candidate list: [primary, ...fallbacks]
    const candidates: Array<{ provider: string; model: string }> = [
      { provider: modelInfo.provider, model: modelInfo.model },
      ...(modelInfo.fallbacks || []),
    ];

    // Start from the last-known-working candidate for this stage
    const startIndex = this._activeCandidateIndex.get(stageId) || 0;
    let lastError: any;

    for (let offset = 0; offset < candidates.length; offset++) {
      const i = (startIndex + offset) % candidates.length;
      const { provider: providerName, model: modelName } = candidates[i];
      const provider = this._providers.get(providerName);

      if (!provider) {
        logger.warn(`Provider "${providerName}" not configured — skipping candidate "${modelName}".`, { stageId });
        continue;
      }

      if (offset > 0) {
        logger.warn(`Falling back to model "${modelName}" (candidate ${i + 1}/${candidates.length}).`, { stageId, previousModel: candidates[(i - 1 + candidates.length) % candidates.length].model });
      } else if (i > 0) {
        logger.info(`Resuming with last-known-good model "${modelName}" (index ${i}).`, { stageId });
      }

      try {
        const response = await this._withRetry(async () => {
          logger.info('LLM Request', { stageId, provider: providerName, model: modelName });
          return await provider.chat({
            model: modelName,
            messages: payload.messages,
            temperature: payload.temperature,
            max_tokens: payload.max_tokens,
            json: payload.json,
          });
        }, stageId, modelName);

        const usage = this._calculateCost(
          modelName,
          response.usage?.promptTokens || 0,
          response.usage?.completionTokens || 0
        );
        this._trackUsage(stageId, usage);

        if (offset > 0) {
          // Persist the working index so future calls skip the exhausted primary
          this._activeCandidateIndex.set(stageId, i);
          logger.info(`✅ Fallback model "${modelName}" succeeded — pinning for future calls.`, { stageId, pinnedIndex: i });
        }

        return { text: response.text, usage };
      } catch (err: any) {
        lastError = err;
        // Detect capacity/quota errors from both raw axios responses AND our CapacityError sentinel
        const status = err.response?.status || err.status;
        const isCapacityError = err.name === 'CapacityError' || status === 503 || status === 429;
        if (isCapacityError) {
          logger.warn(`Model "${modelName}" capacity exhausted — trying next fallback.`, { stageId, status: status || err.name });
          continue;
        }
        // Hard error — propagate immediately
        throw err;
      }
    }

    // All candidates exhausted
    logger.error('All model candidates failed — no more fallbacks available.', { stageId, totalCandidates: candidates.length });
    throw lastError;
  }

  /**
   * Resets the sticky fallback index for a stage (call at stage start).
   */
  resetStageFallback(stageId: string) {
    this._activeCandidateIndex.delete(stageId);
  }

  /**
   * Returns aggregated usage for a specific stage.
   */
  getStageUsage(stageId: string): TokenUsage {
    return this._stageUsage.get(stageId) || {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedCost: 0
    };
  }

  /**
   * Resets usage tracking for a stage.
   */
  resetStageUsage(stageId: string) {
    this._stageUsage.delete(stageId);
  }

  private _trackUsage(stageId: string, usage: TokenUsage) {
    const current = this.getStageUsage(stageId);
    this._stageUsage.set(stageId, {
      promptTokens: current.promptTokens + usage.promptTokens,
      completionTokens: current.completionTokens + usage.completionTokens,
      totalTokens: current.totalTokens + usage.totalTokens,
      estimatedCost: current.estimatedCost + usage.estimatedCost
    });
  }

  private _calculateCost(model: string, promptTokens: number, completionTokens: number): TokenUsage {
    const pricing = (FRAMEWORK_CONFIG as any).llm.pricing[model] || { input: 0, output: 0 };
    const cost = ((promptTokens / 1000) * pricing.input) + ((completionTokens / 1000) * pricing.output);

    return {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      estimatedCost: parseFloat(cost.toFixed(6))
    };
  }

  private async _withRetry<T>(operation: () => Promise<T>, stageId: string, modelName?: string): Promise<T> {
    // A sentinel error that carries the HTTP status so chat() can detect
    // capacity failures and advance to the next fallback candidate.
    class CapacityError extends Error {
      public readonly status: number;
      constructor(message: string, status: number) {
        super(message);
        this.name = 'CapacityError';
        this.status = status;
      }
    }

    return pRetry(operation, {
      retries: 2,  // Only 2 retries per model — fallback chain handles the rest
      factor: 2,
      minTimeout: 1000,
      maxTimeout: 8000,
      onFailedAttempt: async (error: any) => {
        const underlying = error.error || error;
        const status  = underlying.response?.status || error.response?.status;
        const message = underlying.response?.data?.error?.message || underlying.message || error.message;
        const detail  = underlying.response?.data
          ? JSON.stringify(underlying.response.data)
          : (underlying.code ? `Network error: ${underlying.code} (${underlying.message})` : (message || 'No detail'));
        logger.warn(`LLM attempt ${error.attemptNumber} failed.`, { stageId, model: modelName, status, message, detail });

        // Abort immediately on hard client errors (auth/bad request)
        if (status && [400, 401, 403, 404].includes(status)) throw new AbortError(message);

        // On 503/429 capacity/quota errors: throw a CapacityError so the
        // fallback chain in chat() can detect it via .status.
        // If Gemini says to wait a short time and retries remain, honour it first.
        if (status === 503 || status === 429) {
          const details = underlying.response?.data?.error?.details || [];
          const retryInfo = details.find((d: any) => d['@type']?.includes('RetryInfo'));
          const retryDelayStr: string = retryInfo?.retryDelay || '0s';
          const retryDelaySec = parseInt(retryDelayStr, 10) || 0;

          if (retryDelaySec > 0 && retryDelaySec <= 10 && error.retriesLeft > 0) {
            logger.warn(`Capacity error (${status}). Waiting ${retryDelaySec}s (Gemini-specified).`, { stageId, model: modelName });
            await new Promise(resolve => setTimeout(resolve, retryDelaySec * 1000));
          }
          // Stop retrying this model; throw CapacityError so chat() can advance fallback
          throw new CapacityError(message, status);
        }
      }
    });
  }

  private _generateMockResponse(stageId: string, payload: any): string {
    const prompt = payload.messages[payload.messages.length - 1].content;
    return `[MOCK RESPONSE for ${stageId}]\nNo provider active. Prompt length: ${prompt.length}`;
  }

  private _generateMockEmbedding(): number[] {
    return Array.from({ length: 1536 }, () => Math.random());
  }
}

export const llmClient = new LLMClient();
