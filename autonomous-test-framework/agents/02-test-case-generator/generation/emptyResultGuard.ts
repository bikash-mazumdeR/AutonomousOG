'use strict';

/**
 * @fileoverview Stops an Agent 02 run in which every generated scenario failed validation. Persisting such a run
 * would replace the previous test cases and feature files with nothing, and the UI would show an empty result with
 * no reason.
 */

import { GenerationMeta, TestCase } from '../../../core/types';

/** Validation errors quoted in the failure message; the prompt trace keeps all of them. */
const MAX_ERRORS_IN_FAILURE = 3;
/** Prefix storyGenerator puts on errors still open after the last self-correction attempt. */
const UNRESOLVED_PREFIX = /^\[[^\]]+\] Unresolved after \d+ attempt\(s\): /;

/** The parts of a generation the guard inspects. */
export interface GenerationResult {
  testCases: TestCase[];
  warnings: string[];
  meta: Pick<GenerationMeta, 'storyCount'>;
}

/**
 * Throws when stories were generated but none of their scenarios passed validation. A run with no generatable story
 * (e.g. every feature blocked by a clarification) is not affected.
 * @param {GenerationResult} generation
 * @throws {Error} quoting the first unresolved validation errors
 */
export function assertTestCasesGenerated(generation: GenerationResult): void {
  const { storyCount } = generation.meta;
  if (generation.testCases.length > 0 || storyCount === 0) return;
  const errors = [...new Set(generation.warnings
    .filter((warning) => UNRESOLVED_PREFIX.test(warning))
    .map((warning) => warning.replace(UNRESOLVED_PREFIX, '')))];
  const shown = errors.slice(0, MAX_ERRORS_IN_FAILURE).map((error) => `- ${error}`).join('\n');
  throw new Error(`No valid test case was generated: every scenario of ${storyCount} user story(ies) failed validation after `
    + `self-correction, so the previous test cases and feature files were kept. ${errors.length} validation error(s); first:\n${shown}\n`
    + 'Open "View agent input & token math" for each attempt, its validation errors and the raw LLM output.');
}
