'use strict';

/**
 * @fileoverview Stage-agnostic prompt trace, shared by Agents 03-06: what each LLM call was sent and received, what it
 * was for, how its provider-reported tokens and cost add up to the stage's token card, and what the agent's own
 * validation decided on each attempt. A stage that makes no LLM call records that too, with the reason.
 *
 * Calls are attributed to a unit of work ("group") by their trace label, "<group key> #<attempt>".
 * The trace is diagnostic only and never influences a stage. Per-section token figures are proportional estimates.
 *
 * @module StagePromptTrace
 */

import { LLMCallTrace } from './LLMClient';
import {
  CallUsageTotals, costBreakdownUSD, effectiveMaxTokens, processedInputTokens, sumCallUsage,
} from './callTraceMath';

export const STAGE_PROMPT_TRACE_VERSION = 1;
/** Rough characters-per-token ratio, used only when a group has no recorded call. */
const CHARS_PER_TOKEN_HEURISTIC = 4;
/** Validation errors kept per attempt; the full count is always recorded. */
const MAX_ERRORS_PER_ATTEMPT = 60;
const ATTEMPT_SUFFIX = /\s*#(\d+)$/;
const MARKDOWN_SECTION = /\n\n(?=## )/;
const MARKDOWN_HEADER = /^## (.+)$/m;

/** What one generate/validate attempt of a group produced. */
export interface TraceAttempt {
  attempt: number;
  /** Short result, e.g. "4 of 6 test bodies valid". */
  summary?: string;
  /** Validation errors fed back to the model (or left unresolved after the last attempt). */
  errors: string[];
}

/** One unit of LLM work, e.g. one spec file review or one chunk of test bodies. */
export interface TraceGroup {
  key: string;
  title: string;
  /** Group kind shown in the call purpose, e.g. "Navigation plan". */
  kind: string;
  facts: Record<string, string | number>;
  attempts: TraceAttempt[];
}

/** Everything a stage knows about one run. */
export interface StagePromptTraceInput {
  stageId: string;
  stageName: string;
  status: 'COMPLETED' | 'FAILED';
  error?: string;
  projectName: string;
  /** Stage-specific facts for the overview, e.g. { 'Files reviewed': 3 }. */
  overview: Record<string, string | number>;
  /** How this stage uses the LLM, shown under the token table. */
  llmUsageNotes: string[];
  /** Why no LLM call is expected, for deterministic stages. */
  noLlmReason?: string;
  /** Inputs shared by every call (system prompts, memory). */
  sharedInputs: Array<{ label: string; content: string | null | undefined }>;
  groups: TraceGroup[];
  calls: LLMCallTrace[];
  warnings: string[];
}

interface CompositionRow { key: string; label: string; chars: number; share: number; estimatedTokens: number }

/**
 * Collects groups and attempts from concurrent generation code without threading state through return values.
 */
export class TraceRecorder {
  private _groups = new Map<string, TraceGroup>();

  /**
   * Registers a group and returns its unique key: a repeated base key gets a " (2)", " (3)"… suffix.
   * @param {string} baseKey - Trace label prefix of the group's calls
   * @param {string} kind
   * @param {string} title
   * @param {Record<string, string|number>} [facts]
   * @returns {string}
   */
  group(baseKey: string, kind: string, title: string, facts: Record<string, string | number> = {}): string {
    let key = baseKey;
    for (let n = 2; this._groups.has(key); n += 1) key = `${baseKey} (${n})`;
    this._groups.set(key, { key, kind, title, facts, attempts: [] });
    return key;
  }

  /** Records one attempt of a registered group. */
  attempt(key: string, record: TraceAttempt): void {
    this._groups.get(key)?.attempts.push(record);
  }

  /** Groups in registration order. */
  groups(): TraceGroup[] {
    return [...this._groups.values()];
  }
}

/**
 * Trace label for one attempt of a group.
 * @param {string} groupKey
 * @param {number} attempt - 1-based
 * @returns {string}
 */
export function traceLabel(groupKey: string, attempt: number): string {
  return `${groupKey} #${attempt}`;
}

const attemptOf = (call: LLMCallTrace): number => Number((String(call.label || '').match(ATTEMPT_SUFFIX) || [])[1] || 1);
const groupKeyOf = (call: LLMCallTrace): string => String(call.label || '').replace(ATTEMPT_SUFFIX, '');

/**
 * Splits a message into labelled sources: "## SECTION" blocks, else the top-level keys of a trailing JSON object,
 * else the whole message.
 * @param {string} role
 * @param {string} content
 * @returns {Array<{label: string, chars: number}>}
 */
export function splitMessageSources(role: string, content: string): Array<{ label: string; chars: number }> {
  const text = String(content || '');
  const blocks = text.split(MARKDOWN_SECTION);
  if (blocks.length > 1) {
    return blocks.map((block, idx) => ({ label: `${role}: ${idx === 0 && !block.startsWith('## ') ? 'Instructions' : (block.match(MARKDOWN_HEADER) || [])[1]}`, chars: block.length }));
  }
  const jsonStart = text.indexOf('{');
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(text.slice(jsonStart));
      const preamble = jsonStart > 0 ? [{ label: `${role}: Instructions`, chars: jsonStart }] : [];
      const keys = Object.entries(parsed).map(([key, value]) => ({ label: `${role}: JSON "${key}"`, chars: JSON.stringify(value, null, 2).length + key.length + 4 }));
      const covered = keys.reduce((sum, row) => sum + row.chars, 0);
      return [...preamble, ...keys, { label: `${role}: JSON formatting`, chars: Math.max(text.length - jsonStart - covered, 0) }];
    } catch { /* not JSON — fall through */ }
  }
  return [{ label: `${role}: ${role === 'system' ? 'system prompt' : 'message'}`, chars: text.length }];
}

/**
 * Estimates each source's share of a call's processed input tokens, in proportion to characters.
 * @param {LLMCallTrace} [call]
 * @returns {{ method: string, basisTokens: number, rows: CompositionRow[] }}
 */
export function composeCallInput(call?: LLMCallTrace): { method: string; basisTokens: number; rows: CompositionRow[] } {
  if (!call) return { method: 'none', basisTokens: 0, rows: [] };
  const sources = call.messages.flatMap((message) => splitMessageSources(message.role, message.content));
  const totalChars = sources.reduce((sum, source) => sum + source.chars, 0) || 1;
  const basisTokens = processedInputTokens(call);
  const rows = sources.map((source, idx) => ({
    key: `src-${idx}`,
    ...source,
    share: source.chars / totalChars,
    estimatedTokens: Math.round(basisTokens ? (basisTokens * source.chars) / totalChars : source.chars / CHARS_PER_TOKEN_HEURISTIC),
  }));
  return { method: basisTokens ? 'proportional-to-reported' : 'chars-per-token-heuristic', basisTokens, rows };
}

function callPurpose(call: LLMCallTrace, groups: Map<string, TraceGroup>): string {
  const group = groups.get(groupKeyOf(call));
  const name = group ? `${group.kind}: ${group.title}` : groupKeyOf(call) || 'unlabelled call';
  const attempt = attemptOf(call);
  return attempt === 1 ? name : `${name} — retry ${attempt - 1}`;
}

function traceGroup(group: TraceGroup, stageCalls: LLMCallTrace[]): Record<string, any> & { usage: CallUsageTotals } {
  const calls = stageCalls.filter((call) => groupKeyOf(call) === group.key);
  return {
    ...group,
    callNumbers: calls.map((call) => stageCalls.indexOf(call) + 1),
    composition: composeCallInput(calls.find((call) => attemptOf(call) === 1) || calls[0]),
    attempts: group.attempts.map((record) => ({
      ...record, errorCount: record.errors.length, errors: record.errors.slice(0, MAX_ERRORS_PER_ATTEMPT),
    })),
    usage: sumCallUsage(calls),
  };
}

/**
 * Each distinct system prompt the stage sent, with the number of calls that carried it.
 * @param {LLMCallTrace[]} calls
 * @returns {Array<{label: string, content: string}>}
 */
export function distinctSystemPrompts(calls: LLMCallTrace[]): Array<{ label: string; content: string }> {
  const counts = new Map<string, number>();
  calls.flatMap((call) => call.messages.filter((m) => m.role === 'system'))
    .forEach((message) => counts.set(message.content, (counts.get(message.content) || 0) + 1));
  return [...counts.entries()].map(([content, count], idx) => ({
    label: `System prompt${counts.size > 1 ? ` ${idx + 1}` : ''} — sent on ${count} call(s)`, content,
  }));
}

/**
 * Assembles the persisted trace for one stage run.
 * @param {StagePromptTraceInput} input
 * @returns {Record<string, any>} JSON-serialisable trace
 */
export function buildStagePromptTrace(input: StagePromptTraceInput): Record<string, any> {
  const stageCalls = input.calls.filter((call) => call.stageId === input.stageId);
  const groupsByKey = new Map(input.groups.map((group) => [group.key, group]));
  return {
    version: STAGE_PROMPT_TRACE_VERSION,
    generatedAt: new Date().toISOString(),
    stageId: input.stageId,
    stageName: input.stageName,
    status: input.status,
    error: input.error || null,
    projectName: input.projectName,
    llmCalled: stageCalls.length > 0,
    noLlmReason: input.noLlmReason || null,
    overview: input.overview,
    llmUsageNotes: input.llmUsageNotes,
    sharedInputs: [
      ...input.sharedInputs
        .filter((entry) => entry.content !== null && entry.content !== undefined)
        .map((entry) => ({ label: entry.label, content: String(entry.content) })),
      ...distinctSystemPrompts(stageCalls),
    ],
    groups: input.groups.map((group) => traceGroup(group, stageCalls)),
    calls: stageCalls.map((call, idx) => ({
      ...call,
      callNumber: idx + 1,
      purpose: callPurpose(call, groupsByKey),
      effectiveMaxTokens: effectiveMaxTokens(call),
      costBreakdownUSD: costBreakdownUSD(call),
    })),
    warnings: input.warnings,
    totals: { stage: sumCallUsage(stageCalls) },
  };
}
