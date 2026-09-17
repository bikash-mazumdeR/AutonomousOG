'use strict';

/**
 * @fileoverview Resolves per-model USD pricing and converts LLM usage into
 * USD + INR cost estimates. Centralizes the pricing/currency logic referenced
 * by LLMClient, ApprovalGate, and every agent UI's real-time token/cost card.
 *
 * @module TokenPriceCalculator
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { FRAMEWORK_CONFIG } from '../../config/framework.config';
import { Logger } from '../logger/Logger';
import { TokenUsage } from '../types';

const logger = new Logger('TokenPriceCalculator');

const RATE_CACHE_PATH = path.resolve(__dirname, '../../.state/fx-rate-cache.json');

interface RateCache {
  usdToInr: number;
  fetchedAt: number;
}

/**
 * Longest-substring-first patterns for normalizing provider-specific model ids
 * (Bedrock inference profiles, region-prefixed names, dated snapshots, "latest"
 * aliases) to a canonical key in FRAMEWORK_CONFIG.llm.pricing. Order matters —
 * more specific patterns (e.g. "opus-4-8") must be checked before their looser
 * parents (e.g. "opus") would otherwise win.
 */
const PRICING_PATTERNS: Array<{ pattern: RegExp; key: string }> = [
  { pattern: /opus-5/, key: 'claude-opus-5' },
  { pattern: /opus-4-8|opus-4\.8/, key: 'claude-opus-4-8' },
  { pattern: /opus-4-7|opus-4\.7/, key: 'claude-opus-4-7' },
  { pattern: /opus-4-6|opus-4\.6/, key: 'claude-opus-4-6' },
  { pattern: /sonnet-5/, key: 'claude-sonnet-5' },
  { pattern: /sonnet-4-6|sonnet-4\.6/, key: 'claude-sonnet-4-6' },
  { pattern: /haiku-4-5|haiku-4\.5/, key: 'claude-haiku-4-5' },
  { pattern: /claude-3-5-sonnet/, key: 'claude-3-5-sonnet-20240620' },
  { pattern: /gemini-3\.?8-flash|gemini-38-flash/, key: 'gemini-3.8-flash' },
  { pattern: /gemini-3\.?7-flash|gemini-37-flash/, key: 'gemini-3.7-flash' },
  { pattern: /gemini-3\.?6-flash|gemini-36-flash/, key: 'gemini-3.6-flash' },
  { pattern: /gemini-3\.?5-flash-lite/, key: 'gemini-3.5-flash-lite' },
  { pattern: /gemini-3\.?5-flash/, key: 'gemini-3.5-flash' },
  { pattern: /gemini-3\.?1-flash-lite-preview/, key: 'gemini-3.1-flash-lite-preview' },
  { pattern: /gemini-3\.?1-flash-lite/, key: 'gemini-3.1-flash-lite' },
  { pattern: /gemini-flash-lite-latest/, key: 'gemini-flash-lite-latest' },
  { pattern: /gemini-flash-latest/, key: 'gemini-flash-latest' },
  { pattern: /gemini-2\.?5-pro/, key: 'gemini-2.5-pro' },
  { pattern: /gemini-2\.?5-flash/, key: 'gemini-2.5-flash' },
  { pattern: /gpt-4o-mini/, key: 'gpt-4o-mini' },
  { pattern: /gpt-4o/, key: 'gpt-4o' },
  { pattern: /text-embedding-3-small/, key: 'text-embedding-3-small' },
];

export class TokenPriceCalculator {
  private _rate: number;
  private _fetchedAt: number;
  private _pinned: boolean;
  private _refreshing = false;
  private _warnedUnknownModels = new Set<string>();

  constructor() {
    const { pinnedUsdToInr, fallbackUsdToInr } = FRAMEWORK_CONFIG.llm.exchangeRate;
    if (pinnedUsdToInr) {
      this._rate = pinnedUsdToInr;
      this._fetchedAt = Date.now();
      this._pinned = true;
      return;
    }
    this._pinned = false;
    const cached = this._readCache();
    this._rate = cached?.usdToInr ?? fallbackUsdToInr;
    this._fetchedAt = cached?.fetchedAt ?? 0;
  }

  /**
   * Normalizes a raw model id (Bedrock inference profile, region-prefixed,
   * dated snapshot, etc.) to its USD-per-1K pricing. Falls back to zero cost
   * with a one-time warning when no known model matches.
   */
  resolvePricing(model: string): { input: number; output: number } {
    const pricingTable = FRAMEWORK_CONFIG.llm.pricing as Record<string, { input: number; output: number }>;
    if (pricingTable[model]) return pricingTable[model];

    const normalized = model.toLowerCase();
    for (const { pattern, key } of PRICING_PATTERNS) {
      if (pattern.test(normalized) && pricingTable[key]) return pricingTable[key];
    }

    if (!this._warnedUnknownModels.has(model)) {
      this._warnedUnknownModels.add(model);
      logger.warn('No pricing entry for model — cost will report as $0. Add it to framework.config.ts llm.pricing.', { model });
    }
    return { input: 0, output: 0 };
  }

  /** Current USD→INR rate. Triggers a non-blocking background refresh when stale. */
  getExchangeRate(): number {
    if (!this._pinned) this._maybeRefresh();
    return this._rate;
  }

  calculateCost(model: string, promptTokens: number, completionTokens: number): TokenUsage {
    const pricing = this.resolvePricing(model);
    const costUSD = (promptTokens / 1000) * pricing.input + (completionTokens / 1000) * pricing.output;
    const exchangeRate = this.getExchangeRate();
    const costINR = costUSD * exchangeRate;

    return {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      estimatedCost: parseFloat(costUSD.toFixed(6)),
      estimatedCostUSD: parseFloat(costUSD.toFixed(6)),
      estimatedCostINR: parseFloat(costINR.toFixed(4)),
      exchangeRate,
    };
  }

  private _maybeRefresh(): void {
    const { refreshIntervalMs } = FRAMEWORK_CONFIG.llm.exchangeRate;
    const isStale = Date.now() - this._fetchedAt > refreshIntervalMs;
    if (!isStale || this._refreshing) return;
    this._refreshing = true;

    const { liveLookupUrl } = FRAMEWORK_CONFIG.llm.exchangeRate;
    axios
      .get(liveLookupUrl, { timeout: 4000 })
      .then((res) => {
        const rate = res.data?.rates?.INR;
        if (typeof rate === 'number' && rate > 0) {
          this._rate = rate;
          this._fetchedAt = Date.now();
          this._writeCache({ usdToInr: rate, fetchedAt: this._fetchedAt });
          logger.info('Refreshed USD→INR exchange rate', { rate });
        }
      })
      .catch((err: any) => {
        logger.warn('Live USD→INR rate lookup failed — keeping last-known rate.', { error: err.message, rate: this._rate });
      })
      .finally(() => {
        this._refreshing = false;
      });
  }

  private _readCache(): RateCache | null {
    try {
      return JSON.parse(fs.readFileSync(RATE_CACHE_PATH, 'utf-8'));
    } catch {
      return null;
    }
  }

  private _writeCache(cache: RateCache): void {
    try {
      fs.mkdirSync(path.dirname(RATE_CACHE_PATH), { recursive: true });
      fs.writeFileSync(RATE_CACHE_PATH, JSON.stringify(cache, null, 2), 'utf-8');
    } catch (err: any) {
      logger.warn('Could not persist FX rate cache', { error: err.message });
    }
  }
}

export const tokenPriceCalculator = new TokenPriceCalculator();
