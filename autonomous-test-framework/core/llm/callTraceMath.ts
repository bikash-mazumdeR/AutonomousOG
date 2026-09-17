'use strict';

/**
 * @fileoverview Token and cost arithmetic shared by the per-agent prompt traces. Every figure is derived from
 * the provider-reported usage recorded in {@link LLMCallTrace}; nothing here tokenizes text.
 *
 * @module CallTraceMath
 */

import { LLMCallTrace } from './LLMClient';

/** Output ceiling Bedrock applies when BEDROCK_MAX_TOKENS is unset. */
const DEFAULT_BEDROCK_MAX_TOKENS = 8192;

/** Summed usage of a set of calls. */
export interface CallUsageTotals {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estimatedCostUSD: number;
  estimatedCostINR: number;
}

/**
 * Sums the priced usage and the reported cache counts of the given calls.
 * @param {LLMCallTrace[]} calls
 * @returns {CallUsageTotals}
 */
export function sumCallUsage(calls: LLMCallTrace[]): CallUsageTotals {
  return calls.reduce((acc, call) => ({
    promptTokens: acc.promptTokens + call.usage.promptTokens,
    completionTokens: acc.completionTokens + call.usage.completionTokens,
    totalTokens: acc.totalTokens + call.usage.totalTokens,
    cacheReadTokens: acc.cacheReadTokens + call.reportedUsage.cacheReadTokens,
    cacheWriteTokens: acc.cacheWriteTokens + call.reportedUsage.cacheWriteTokens,
    estimatedCostUSD: acc.estimatedCostUSD + call.usage.estimatedCostUSD,
    estimatedCostINR: acc.estimatedCostINR + call.usage.estimatedCostINR,
  }), {
    promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, estimatedCostUSD: 0, estimatedCostINR: 0,
  });
}

/**
 * Output ceiling the provider actually applies (Bedrock caps the requested value).
 * @param {LLMCallTrace} call
 * @returns {number|undefined}
 */
export function effectiveMaxTokens(call: LLMCallTrace): number | undefined {
  if (call.provider !== 'bedrock') return call.request.maxTokens;
  const configured = Number(process.env.BEDROCK_MAX_TOKENS);
  const cap = Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_BEDROCK_MAX_TOKENS;
  return Math.min(call.request.maxTokens ?? cap, cap);
}

/**
 * Splits one call's USD cost into its input and output parts.
 * @param {LLMCallTrace} call
 * @returns {{ input: number, output: number }}
 */
export function costBreakdownUSD(call: LLMCallTrace): { input: number; output: number } {
  return {
    input: (call.usage.promptTokens / 1000) * call.pricingPer1K.input,
    output: (call.usage.completionTokens / 1000) * call.pricingPer1K.output,
  };
}

/**
 * All input tokens the provider processed for a call, including prompt-cache reads and writes, which some
 * providers (Bedrock) report separately from the uncached prompt tokens.
 * @param {LLMCallTrace} call
 * @returns {number}
 */
export function processedInputTokens(call: LLMCallTrace): number {
  const { promptTokens, cacheReadTokens, cacheWriteTokens } = call.reportedUsage;
  return promptTokens + cacheReadTokens + cacheWriteTokens;
}
