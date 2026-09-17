'use strict';

/**
 * @fileoverview Builds Agent 02's prompt trace: the exact system and per-story user prompts the generation LLM
 * received, what each part of the input contributed, every call's provider-reported token usage and cost, and
 * what the deterministic validator decided on each attempt.
 *
 * The trace is diagnostic only. It never influences generation. Token counts come from the provider API; the
 * per-section figures are proportional estimates, labelled as such.
 *
 * @module Agent02PromptTrace
 */

import { LLMCallTrace } from '../../../core/llm/LLMClient';
import {
  costBreakdownUSD, effectiveMaxTokens, processedInputTokens, sumCallUsage,
} from '../../../core/llm/callTraceMath';
import { AttemptRecord } from './storyGenerator';

export const PROMPT_TRACE_VERSION = 1;
/** Rough characters-per-token ratio, used only when a story has no recorded call. */
const CHARS_PER_TOKEN_HEURISTIC = 4;
/** Validation errors kept per attempt; the full count is always recorded. */
const MAX_ERRORS_PER_ATTEMPT = 60;
const SECTION_HEADER = /^## (.+)$/;
const PREAMBLE_LABEL = 'Instructions';

/** What the agent knows about one story's generation. */
export interface StoryTraceInput {
  /** "F-01/US-01" — also the trace label of the story's LLM calls. */
  key: string;
  title: string;
  acceptanceCriteria: number;
  businessRules: number;
  userPrompt: string;
  scenariosAccepted: number;
  attemptLog: AttemptRecord[];
}

/** Everything the agent knows about one generation run. */
export interface PromptTraceInput {
  stageId: string;
  status: 'COMPLETED' | 'FAILED';
  error?: string;
  projectName: string;
  excludedTypes: string[];
  skillPath: string;
  /** System prompt exactly as sent (skill + learnings, filtered to the active test types). */
  systemPrompt: string;
  /** Memory improvement rules and rejection feedback available to the prompts. */
  memory: { improvementRules: unknown[]; rejectionFeedback: unknown[] };
  stories: StoryTraceInput[];
  testCaseCount: number;
  warnings: string[];
  calls: LLMCallTrace[];
}

interface CompositionRow { key: string; label: string; chars: number; share: number; estimatedTokens: number }

/**
 * Splits a story user prompt into its "## SECTION" blocks, with the leading instruction as its own block.
 * @param {string} userPrompt
 * @returns {Array<{label: string, text: string}>}
 */
export function splitPromptSections(userPrompt: string): Array<{ label: string; text: string }> {
  const sections: Array<{ label: string; text: string }> = [];
  for (const block of String(userPrompt || '').split(/\n\n(?=## )/)) {
    const header = block.match(SECTION_HEADER) || block.split('\n')[0].match(SECTION_HEADER);
    sections.push({ label: header ? header[1].trim() : PREAMBLE_LABEL, text: block });
  }
  return sections.filter((section) => section.text.trim());
}

/**
 * Estimates each input source's share of a story's first call, in proportion to characters.
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {LLMCallTrace} [firstCall]
 * @returns {{ method: string, basisTokens: number, rows: CompositionRow[] }}
 */
export function composeStoryInput(systemPrompt: string, userPrompt: string, firstCall?: LLMCallTrace) {
  const sources = [
    { key: 'system', label: 'System prompt (skill + learnings)', chars: systemPrompt.length },
    ...splitPromptSections(userPrompt).map((section, idx) => ({ key: `user-${idx}`, label: `User prompt: ${section.label}`, chars: section.text.length })),
  ];
  const totalChars = sources.reduce((sum, source) => sum + source.chars, 0) || 1;
  const basisTokens = firstCall ? processedInputTokens(firstCall) : 0;
  const rows: CompositionRow[] = sources.map((source) => ({
    ...source,
    share: source.chars / totalChars,
    estimatedTokens: Math.round(basisTokens ? (basisTokens * source.chars) / totalChars : source.chars / CHARS_PER_TOKEN_HEURISTIC),
  }));
  return { method: basisTokens ? 'proportional-to-reported' : 'chars-per-token-heuristic', basisTokens, rows };
}

/** Parses the attempt number out of a "F-01/US-01 #2" trace label. */
function attemptOf(call: LLMCallTrace): number {
  const match = String(call.label || '').match(/#(\d+)$/);
  return match ? Number(match[1]) : 1;
}

function storyKeyOf(call: LLMCallTrace): string {
  return String(call.label || '').replace(/\s*#\d+$/, '');
}

function callPurpose(call: LLMCallTrace): string {
  const attempt = attemptOf(call);
  const story = storyKeyOf(call) || 'unlabelled call';
  return attempt === 1 ? `${story} — initial scenario generation` : `${story} — self-correction round ${attempt - 1}`;
}

function traceStory(story: StoryTraceInput, systemPrompt: string, stageCalls: LLMCallTrace[]) {
  const calls = stageCalls.filter((call) => storyKeyOf(call) === story.key);
  return {
    key: story.key,
    title: story.title,
    acceptanceCriteria: story.acceptanceCriteria,
    businessRules: story.businessRules,
    scenariosAccepted: story.scenariosAccepted,
    userPrompt: story.userPrompt,
    composition: composeStoryInput(systemPrompt, story.userPrompt, calls.find((call) => attemptOf(call) === 1)),
    attempts: story.attemptLog.map((record) => ({
      ...record,
      errorCount: record.errors.length,
      errors: record.errors.slice(0, MAX_ERRORS_PER_ATTEMPT),
    })),
    usage: sumCallUsage(calls),
  };
}

/**
 * Assembles the persisted trace for one Agent 02 run.
 * @param {PromptTraceInput} input
 * @returns {Record<string, any>} JSON-serialisable trace
 */
export function buildPromptTrace(input: PromptTraceInput): Record<string, any> {
  const stageCalls = input.calls.filter((call) => call.stageId === input.stageId);
  return {
    version: PROMPT_TRACE_VERSION,
    generatedAt: new Date().toISOString(),
    stageId: input.stageId,
    status: input.status,
    error: input.error || null,
    projectName: input.projectName,
    excludedTypes: input.excludedTypes,
    llmCalled: stageCalls.length > 0,
    testCaseCount: input.testCaseCount,
    inputs: {
      skillPath: input.skillPath,
      systemPrompt: input.systemPrompt,
      improvementRules: JSON.stringify(input.memory.improvementRules || [], null, 2),
      rejectionFeedback: JSON.stringify(input.memory.rejectionFeedback || [], null, 2),
    },
    stories: input.stories.map((story) => traceStory(story, input.systemPrompt, stageCalls)),
    calls: stageCalls.map((call, idx) => ({
      ...call,
      callNumber: idx + 1,
      purpose: callPurpose(call),
      countsTowardStageUsage: true,
      effectiveMaxTokens: effectiveMaxTokens(call),
      costBreakdownUSD: costBreakdownUSD(call),
    })),
    warnings: input.warnings,
    totals: { stage: sumCallUsage(stageCalls) },
  };
}
