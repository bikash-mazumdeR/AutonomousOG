'use strict';

/**
 * @fileoverview Input fingerprinting for Agent 01. LLM extraction reorders and rewrites acceptance
 * criteria on every call, so an unchanged requirement input reuses the previous analysis instead.
 */

import * as crypto from 'crypto';

/** Bump when the analysis prompt changes in a way that should invalidate saved analyses. */
export const ANALYSIS_PROMPT_VERSION = '3';

/** @enum {string} Where the stage's analysis came from. */
export const ANALYSIS_SOURCE = Object.freeze({
  REUSED: 'reused',
  REGENERATED: 'regenerated',
});

const byJson = (a: unknown, b: unknown) => JSON.stringify(a).localeCompare(JSON.stringify(b));

/** Everything that shapes the analysis output. */
export interface AnalysisInputs {
  rawRequirements: string;
  skill: string;
  resolvedClarifications: any[];
  improvementRules: any[];
}

/**
 * sha256 over every input that shapes the analysis. Volatile memory fields (ids, timestamps, counters)
 * are excluded so bookkeeping updates do not force a re-analysis.
 * @param {AnalysisInputs} inputs
 * @returns {string}
 */
export function computeInputFingerprint(inputs: AnalysisInputs): string {
  const payload = JSON.stringify([
    ANALYSIS_PROMPT_VERSION,
    inputs.rawRequirements.replace(/\r\n/g, '\n'),
    inputs.skill.replace(/\r\n/g, '\n'),
    inputs.resolvedClarifications.map((c) => [c?.question ?? '', c?.answer ?? '']).sort(byJson),
    inputs.improvementRules.map((r) => [r?.id ?? '', r?.description ?? '']).sort(byJson),
  ]);
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Returns a deep copy of the previous analysis when it was produced from identical inputs.
 * @param {any} previous - Latest analyzedRequirements artifact for the project
 * @param {string} inputFingerprint
 * @returns {any | null}
 */
export function findReusableAnalysis(previous: any, inputFingerprint: string): any | null {
  const matches = previous?.inputFingerprint === inputFingerprint;
  if (!matches || !Array.isArray(previous.features) || previous.features.length === 0) return null;
  return JSON.parse(JSON.stringify(previous));
}
