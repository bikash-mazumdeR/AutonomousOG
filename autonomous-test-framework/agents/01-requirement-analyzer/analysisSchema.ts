'use strict';

/**
 * @fileoverview Output schema for Agent 01's LLM analysis, checked on the parsed JSON before it is normalised.
 * The prompt describes this format; this module enforces it, so a story without criteria, a criterion without its
 * category prefix, an unknown ambiguity category or a reference to a story that does not exist is caught and sent back
 * to the model instead of being silently defaulted downstream.
 */

import { z } from 'zod';
import { AMBIGUITY_CATEGORY } from './ambiguities';

/** Category prefixes the prompt requires at the start of every acceptance criterion. */
export const CRITERION_CATEGORIES = ['functional', 'ui', 'performance', 'security', 'accessibility', 'error-handling'] as const;

/** Prefix of every schema issue, so a reader can tell them apart from story-structure issues. */
export const SCHEMA_ISSUE_PREFIX = 'Schema:';

/** Most issues listed in one correction prompt; the rest are counted, so a badly broken answer cannot flood the prompt. */
export const MAX_REPORTED_ISSUES = 20;

const CRITERION = new RegExp(`^\\[@(${CRITERION_CATEGORIES.join('|')})\\]\\s+\\S`);
/** sourceRef of a test data value that comes from a resolved clarification answer rather than the document. */
export const CLARIFICATION_SOURCE_REF = 'CLARIFICATION';

const SOURCE_REF = new RegExp(`^((AC|BR)-\\d+|${CLARIFICATION_SOURCE_REF})$`, 'i');

const REQUIRED = { required_error: 'is required', invalid_type_error: 'must be a list' };

const text = z.string({ required_error: 'is required', invalid_type_error: 'must be a string' }).trim().min(1, 'must be a non-empty string');

const testDataValue = z.object({
  name: text,
  value: z.string().optional(),
  sourceRef: z.string().regex(SOURCE_REF, `must be "AC-n", "BR-n" or "${CLARIFICATION_SOURCE_REF}"`),
  sensitive: z.boolean({ invalid_type_error: 'must be true or false' }),
}).passthrough();

const userStory = z.object({
  id: text,
  sourceStoryId: z.string().nullable().optional(),
  title: text,
  acceptanceCriteria: z.array(z.string().regex(CRITERION, 'must start with exactly one category prefix such as [@functional]'), REQUIRED)
    .min(1, 'must list at least one acceptance criterion'),
  testDataValues: z.array(testDataValue, REQUIRED).optional(),
}).passthrough();

const feature = z.object({
  id: text,
  name: text,
  userStories: z.array(userStory, REQUIRED).min(1, 'must contain at least one user story'),
}).passthrough();

const ambiguity = z.object({
  featureId: z.string().optional(),
  userStoryId: z.string().nullable().optional(),
  category: z.enum(Object.values(AMBIGUITY_CATEGORY) as [string, ...string[]], {
    errorMap: () => ({ message: `must be one of ${Object.values(AMBIGUITY_CATEGORY).join(', ')}` }),
  }),
  question: text,
  blockingTestGeneration: z.boolean({ invalid_type_error: 'must be true or false' }).optional(),
}).passthrough();

const analysis = z.object({
  features: z.array(feature, REQUIRED).min(1, 'must contain at least one feature'),
  integrationPoints: z.array(z.object({ id: text, name: text }).passthrough(), REQUIRED).optional(),
  ambiguities: z.array(ambiguity, REQUIRED).optional(),
}).passthrough();

function pathOf(path: Array<string | number>): string {
  return path.reduce<string>((out, part) => (typeof part === 'number' ? `${out}[${part}]` : `${out}${out ? '.' : ''}${part}`), '') || 'analysis';
}

function duplicates(values: string[]): string[] {
  return [...new Set(values.filter((value, idx) => value && values.indexOf(value) !== idx))];
}

/** Cross-references zod cannot express: unique ids, and ambiguities pointing at a feature and story that exist. */
function referenceIssues(raw: any): string[] {
  const features: any[] = Array.isArray(raw?.features) ? raw.features : [];
  const stories = features.flatMap((f) => (Array.isArray(f?.userStories) ? f.userStories : []));
  const featureIds = features.map((f) => String(f?.id || ''));
  const storyIds = stories.map((s) => String(s?.id || ''));
  const issues = [
    ...duplicates(featureIds).map((id) => `feature id "${id}" is used more than once`),
    ...duplicates(storyIds).map((id) => `user story id "${id}" is used more than once`),
  ];
  (Array.isArray(raw?.ambiguities) ? raw.ambiguities : []).forEach((amb: any, idx: number) => {
    if (amb?.featureId && !featureIds.includes(String(amb.featureId))) issues.push(`ambiguities[${idx}].featureId "${amb.featureId}" is not a feature of the analysis`);
    if (amb?.userStoryId && !storyIds.includes(String(amb.userStoryId))) issues.push(`ambiguities[${idx}].userStoryId "${amb.userStoryId}" is not a user story of the analysis`);
  });
  return issues;
}

/**
 * Checks the parsed analysis against the output format the prompt requires. Read-only.
 * @param {any} raw - The LLM's parsed JSON, before normalisation fills defaults
 * @returns {string[]} Issues, each starting with SCHEMA_ISSUE_PREFIX; empty when the analysis conforms
 */
export function validateAnalysisSchema(raw: any): string[] {
  const parsed = analysis.safeParse(raw);
  const shape = parsed.success ? [] : parsed.error.issues.map((issue) => `${pathOf(issue.path)} ${issue.message}`);
  return [...shape, ...referenceIssues(raw)].map((issue) => `${SCHEMA_ISSUE_PREFIX} ${issue}`);
}

/**
 * The issues to put in one correction prompt: at most MAX_REPORTED_ISSUES, with a count of the rest.
 * @param {string[]} issues
 * @returns {string[]}
 */
export function issuesForPrompt(issues: string[]): string[] {
  if (issues.length <= MAX_REPORTED_ISSUES) return issues;
  return [...issues.slice(0, MAX_REPORTED_ISSUES), `… and ${issues.length - MAX_REPORTED_ISSUES} more issue(s) of the same kinds.`];
}
