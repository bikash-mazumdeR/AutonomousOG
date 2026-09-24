'use strict';

/**
 * @fileoverview Input fingerprinting for Agent 01. LLM extraction reorders and rewrites acceptance
 * criteria on every call, so an unchanged requirement input reuses the previous analysis instead.
 */

import * as crypto from 'crypto';

/** Bump when the analysis prompt changes in a way that should invalidate saved analyses. */
export const ANALYSIS_PROMPT_VERSION = '5';

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

/**
 * Whether this requirement needs a run of its own.
 *
 * Runs are per requirement, not per project: a project accumulates one run per requirement document
 * it has ingested. A requirement whose content differs from the one the current run holds must branch
 * into a fresh run, so the previous requirement's analysis, test cases, test data and scripts stay
 * exactly as they were. The same requirement analysed again keeps its run and invalidates the
 * downstream stages in place.
 *
 * @param {any} currentAnalysis - analyzedRequirements of the run currently open, if any
 * @param {string} requirementFingerprint - Content identity of the incoming requirement
 * @returns {boolean}
 */
export function requiresIsolatedRun(currentAnalysis: any, requirementFingerprint: string): boolean {
  const current = String(currentAnalysis?.requirementFingerprint || '');
  return Boolean(current) && current !== requirementFingerprint;
}
