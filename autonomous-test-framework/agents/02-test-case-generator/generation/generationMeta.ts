'use strict';

/**
 * @fileoverview Fingerprints the inputs behind an Agent 02 generation so a test case count change
 * between runs can be attributed to what actually changed (requirements, analysis, skip options,
 * prompt/memory or the LLM model that served the request).
 */

import * as crypto from 'crypto';
import { GenerationMeta } from '../../../core/types';
import { NormalizedAnalysis } from '../analysis/normalizeAnalysis';
import { PromptMemoryContext } from '../prompts/storyPrompt';
import { StoryGenerationOutcome } from './storyGenerator';

/** Inputs needed to build generation metadata. */
export interface GenerationMetaInput {
  analyzedRequirements: any;
  normalized: NormalizedAnalysis;
  excludedTypeTags: ReadonlySet<string>;
  systemPrompt: string;
  memoryContext: PromptMemoryContext;
  outcomes: StoryGenerationOutcome[];
  modelsUsed: string[];
}

const FINGERPRINT_LENGTH = 12;

/** Input → human-readable label, in display order. */
const CHANGE_LABELS: ReadonlyArray<[keyof GenerationMeta, string]> = Object.freeze([
  ['requirementsFingerprint', 'requirements'],
  ['analysisFingerprint', 'Agent 01 analysis'],
  ['excludedTypes', 'skip options'],
  ['promptFingerprint', 'skill/learnings/memory'],
  ['modelsUsed', 'LLM model'],
]);

/**
 * Short sha256 fingerprint of a string or JSON-serialisable value.
 * @param {unknown} value
 * @returns {string}
 */
export function fingerprint(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, FINGERPRINT_LENGTH);
}

/**
 * Builds the metadata stored with the generated test cases.
 * @param {GenerationMetaInput} input
 * @returns {GenerationMeta}
 */
export function buildGenerationMeta(input: GenerationMetaInput): GenerationMeta {
  const { normalized, memoryContext } = input;
  return {
    requirementsFingerprint: String(input.analyzedRequirements?.inputFingerprint || ''),
    analysisFingerprint: fingerprint({
      features: normalized.features, stateTransitions: normalized.stateTransitions, openAmbiguities: normalized.openAmbiguities,
    }),
    promptFingerprint: fingerprint([input.systemPrompt, memoryContext.improvementRules || [], memoryContext.rejectionFeedback || []]),
    excludedTypes: [...input.excludedTypeTags].sort(),
    storyCount: input.outcomes.length,
    modelsUsed: [...input.modelsUsed].sort(),
    attemptsByStory: Object.fromEntries(input.outcomes.map((outcome) => [`${outcome.feature.id}/${outcome.story.id}`, outcome.attempts])),
  };
}

/**
 * Lists which generation inputs differ from the previous generation.
 * @param {GenerationMeta | null | undefined} previous
 * @param {GenerationMeta} current
 * @returns {string[] | null} null when there is no previous metadata to compare against
 */
export function describeInputChanges(previous: GenerationMeta | null | undefined, current: GenerationMeta): string[] | null {
  if (!previous) return null;
  return CHANGE_LABELS
    .filter(([key]) => JSON.stringify(previous[key]) !== JSON.stringify(current[key]))
    .map(([, label]) => label);
}

/**
 * Formats input changes for the approval summary.
 * @param {string[] | null} changes
 * @returns {string}
 */
export function formatInputChanges(changes: string[] | null): string {
  if (changes === null) return 'n/a — no previous generation to compare';
  return changes.length === 0 ? 'none — inputs identical' : changes.join(', ');
}
