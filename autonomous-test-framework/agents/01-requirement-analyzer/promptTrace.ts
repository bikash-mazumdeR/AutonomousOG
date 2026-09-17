'use strict';

/**
 * @fileoverview Builds Agent 01's prompt trace: the exact input the analysis LLM received, how that input is
 * composed, and how the token counts and cost shown in the UI were derived from the provider's usage report.
 *
 * The trace is diagnostic only. It never influences the analysis, and token counts in it come from the
 * provider API — the per-section figures are proportional estimates, labelled as such.
 *
 * @module Agent01PromptTrace
 */

import { LLMCallTrace } from '../../core/llm/LLMClient';
import { costBreakdownUSD, effectiveMaxTokens, sumCallUsage } from '../../core/llm/callTraceMath';

export const PROMPT_TRACE_VERSION = 1;
/** Stage id the squeezer bills its calls to; they are not part of the stage's token card. */
export const UTILITY_STAGE_ID = 'system-utility';
/** Rough characters-per-token ratio, used only when no provider count exists (e.g. the analysis was reused). */
const CHARS_PER_TOKEN_HEURISTIC = 4;

/** The pieces the analysis user prompt is assembled from. */
export interface AnalysisPromptParts {
  prompt: string;
  requirements: string;
  improvementRules: string;
  resolvedClarifications: string;
}

/** Everything the agent knows about one analysis attempt. */
export interface PromptTraceInput {
  stageId: string;
  status: 'COMPLETED' | 'FAILED';
  error?: string;
  projectName: string;
  format: string;
  requirementSource: string;
  analysisSource?: string | null;
  inputFingerprint?: string;
  originalRequirements?: string;
  skillPath: string;
  skill: string;
  promptParts?: AnalysisPromptParts | null;
  calls: LLMCallTrace[];
}

interface CompositionRow { key: string; label: string; chars: number; share: number; estimatedTokens: number }

/**
 * Splits the first analysis request into its sources, estimating each source's share of the reported input tokens.
 *
 * @param {PromptTraceInput} input
 * @param {LLMCallTrace|undefined} firstCall - The initial analysis call, when the LLM ran
 * @returns {{ method: string, rows: CompositionRow[] }}
 */
export function composeInput(input: PromptTraceInput, firstCall?: LLMCallTrace): { method: string; rows: CompositionRow[] } {
  const parts = input.promptParts;
  if (!parts) return { method: 'none', rows: [] };
  const instructionChars = parts.prompt.length - parts.requirements.length - parts.improvementRules.length - parts.resolvedClarifications.length;
  const sources: Array<[string, string, number]> = [
    ['skill', 'System prompt (skill file)', input.skill.length],
    ['instructions', 'Agent instructions & JSON output template', Math.max(instructionChars, 0)],
    ['requirements', 'Requirement document text', parts.requirements.length],
    ['improvementRules', 'Memory: improvement rules', parts.improvementRules.length],
    ['resolvedClarifications', 'Memory: resolved clarifications', parts.resolvedClarifications.length],
  ];
  const totalChars = sources.reduce((sum, [, , chars]) => sum + chars, 0) || 1;
  const reported = firstCall?.reportedUsage.promptTokens || 0;
  const rows = sources.map(([key, label, chars]) => ({
    key, label, chars,
    share: chars / totalChars,
    estimatedTokens: Math.round(reported ? (reported * chars) / totalChars : chars / CHARS_PER_TOKEN_HEURISTIC),
  }));
  return { method: reported ? 'proportional-to-reported' : 'chars-per-token-heuristic', rows };
}

/** What a call was for, in the order the agent makes them. */
function callPurpose(call: LLMCallTrace, stageCallIndex: number): string {
  if (call.stageId === UTILITY_STAGE_ID) return 'Context squeeze — summarises an oversized requirement before analysis';
  return stageCallIndex === 0 ? 'Initial requirement analysis' : `Story-structure correction round ${stageCallIndex}`;
}

/**
 * Assembles the persisted trace for one Agent 01 run.
 *
 * @param {PromptTraceInput} input
 * @returns {Record<string, any>} JSON-serialisable trace
 */
export function buildPromptTrace(input: PromptTraceInput): Record<string, any> {
  let stageIndex = 0;
  const calls = input.calls.map((call, idx) => {
    const purpose = callPurpose(call, call.stageId === input.stageId ? stageIndex : -1);
    if (call.stageId === input.stageId) stageIndex += 1;
    return {
      ...call,
      callNumber: idx + 1,
      purpose,
      countsTowardStageUsage: call.stageId === input.stageId,
      effectiveMaxTokens: effectiveMaxTokens(call),
      costBreakdownUSD: costBreakdownUSD(call),
    };
  });
  const stageCalls = input.calls.filter((call) => call.stageId === input.stageId);
  const squeezed = Boolean(input.originalRequirements && input.promptParts
    && input.originalRequirements !== input.promptParts.requirements);
  return {
    version: PROMPT_TRACE_VERSION,
    generatedAt: new Date().toISOString(),
    stageId: input.stageId,
    status: input.status,
    error: input.error || null,
    projectName: input.projectName,
    format: input.format,
    requirementSource: input.requirementSource,
    analysisSource: input.analysisSource || null,
    inputFingerprint: input.inputFingerprint || null,
    llmCalled: stageCalls.length > 0,
    inputs: {
      skillPath: input.skillPath,
      systemPrompt: input.skill,
      userPrompt: input.promptParts?.prompt ?? null,
      requirementsSent: input.promptParts?.requirements ?? null,
      originalRequirements: squeezed ? input.originalRequirements : null,
      squeezed,
      improvementRules: input.promptParts?.improvementRules ?? null,
      resolvedClarifications: input.promptParts?.resolvedClarifications ?? null,
    },
    composition: composeInput(input, stageCalls[0]),
    calls,
    totals: { stage: sumCallUsage(stageCalls), utility: sumCallUsage(input.calls.filter((call) => call.stageId !== input.stageId)) },
  };
}
