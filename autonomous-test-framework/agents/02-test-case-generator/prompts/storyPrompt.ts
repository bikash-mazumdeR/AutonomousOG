'use strict';

/**
 * @fileoverview Builds the per-story user prompt and the self-correction prompt for Agent 02.
 * The system prompt (skill + learnings) is identical for every story; only this compact,
 * story-scoped context varies, so the model sees exactly the requirements it may test.
 */

import {
  LABEL_TAGS, K6_SCENARIOS, HTTP_METHODS, MIN_TC_BY_RISK, MAX_REJECTION_FEEDBACK_IN_PROMPT, STAGE_ID,
} from '../constants';
import { NormalizedFeature, NormalizedStory, OpenAmbiguity } from '../analysis/normalizeAnalysis';
import { GateResult, integrationTag } from '../analysis/requirementGates';

/** Memory context slice used in prompts. */
export interface PromptMemoryContext {
  improvementRules?: Array<{ appliesTo?: string; description?: string }>;
  rejectionFeedback?: Array<{ comment?: string; reason?: string }>;
}

/** Inputs for a story prompt. */
export interface StoryPromptInput {
  feature: NormalizedFeature;
  story: NormalizedStory;
  apiGate: GateResult;
  performanceGate: GateResult;
  excludedTypeTags: ReadonlySet<string>;
  openAmbiguities: OpenAmbiguity[];
  stateTransitions: unknown[];
  memoryContext: PromptMemoryContext;
}

function section(title: string, lines: string[], emptyText?: string): string {
  if (lines.length === 0 && !emptyText) return '';
  return [`## ${title}`, ...(lines.length > 0 ? lines : [emptyText as string])].join('\n');
}

function storyLines({ feature, story }: StoryPromptInput): string[] {
  return [
    `Feature: ${feature.id} — ${feature.name} (risk: ${feature.riskLevel})`,
    ...(feature.description ? [`Feature description: ${feature.description}`] : []),
    `Story: ${story.id} — ${story.title}`,
    ...(story.role ? [`As a ${story.role}`] : []),
    ...(story.goal ? [`I want to ${story.goal}`] : []),
    ...(story.benefit ? [`So that ${story.benefit}`] : []),
  ];
}

function stateTransitionLines(input: StoryPromptInput): string[] {
  const global = input.stateTransitions.flatMap((entity: any) => (Array.isArray(entity?.transitions) ? entity.transitions : [])
    .map((t: any) => `${entity.entity || 'State'}: ${t.from} → ${t.to} when "${t.trigger}"${t.guard ? ` [guard: ${t.guard}]` : ''}`));
  return [...input.story.stateTransitions, ...global].map((line) => `- ${line}`);
}

function gateLines({ apiGate, performanceGate, excludedTypeTags }: StoryPromptInput): string[] {
  const lines = [...excludedTypeTags].map((tag) => `- @${tag}: EXCLUDED for this run — do not generate`);
  if (!excludedTypeTags.has('api')) {
    lines.push(apiGate.allowed
      ? `- @api: ALLOWED (${apiGate.reason}). Tag with one of ${apiGate.integrationPoints.map((ip) => `@${integrationTag(ip.id)} = ${ip.type} ${ip.endpoint}`).join('; ')}, `
        + `plus @method-<${HTTP_METHODS.join('|').toLowerCase()}> and @status-<documented code>`
      : `- @api: NOT ALLOWED — ${apiGate.reason}`);
  }
  if (!excludedTypeTags.has('performance')) {
    lines.push(performanceGate.allowed
      ? `- @performance (K6): ALLOWED (${performanceGate.reason}). Tag with one of @${K6_SCENARIOS.join(' @')}`
      : `- @performance (K6): NOT ALLOWED — ${performanceGate.reason}. Cover latency criteria as UI timing assertions instead`);
  }
  lines.push(`- Allowed label tags: @${Object.keys(LABEL_TAGS).join(' @')}`);
  return lines;
}

function coverageLines({ feature, excludedTypeTags }: StoryPromptInput): string[] {
  const storyCount = Math.max(feature.userStories.length, 1);
  const targets = Object.entries(MIN_TC_BY_RISK[feature.riskLevel])
    .filter(([typeTag]) => !excludedTypeTags.has(typeTag))
    .map(([typeTag, min]) => `${Math.ceil(min / storyCount)} ${typeTag}`);
  return [
    '- Every acceptance criterion MUST be covered by at least one scenario tagged with its @ac-N.',
    `- Aim for at least: ${targets.join(', ')} — ONLY where the criteria/rules above document that behaviour.`,
    '- Never invent behaviour to reach a number; fewer grounded scenarios are correct.',
  ];
}

function memoryLines({ memoryContext }: StoryPromptInput): string[] {
  const rules = (memoryContext.improvementRules || [])
    .filter((rule) => rule.appliesTo === STAGE_ID && rule.description)
    .map((rule) => `- Rule: ${rule.description}`);
  const feedback = (memoryContext.rejectionFeedback || [])
    .map((entry) => entry.comment || entry.reason || '')
    .filter(Boolean)
    .slice(-MAX_REJECTION_FEEDBACK_IN_PROMPT)
    .map((comment) => `- Reviewer rejected a previous run: "${comment}"`);
  return [...new Set([...rules, ...feedback])];
}

/**
 * Builds the user prompt for one story.
 * @param {StoryPromptInput} input
 * @returns {string}
 */
export function buildStoryPrompt(input: StoryPromptInput): string {
  const { story, feature } = input;
  const ambiguities = input.openAmbiguities
    .filter((amb) => !amb.featureId || amb.featureId === feature.id)
    .map((amb) => `- ${amb.id}: ${amb.question}`);
  return [
    'Generate the Gherkin scenarios for the user story below. Use ONLY this context.',
    section('STORY', storyLines(input)),
    section('ACCEPTANCE CRITERIA (each needs ≥1 scenario tagged @ac-N)',
      story.acceptanceCriteria.map((ac) => `- ${ac.id}${ac.category ? ` [${ac.category}]` : ''}: ${ac.text}`), '(none)'),
    section('BUSINESS RULES (tag scenarios that verify them with @br-N)', story.businessRules.map((br) => `- ${br.id}: ${br.text}`), '(none)'),
    section('STATE TRANSITIONS', stateTransitionLines(input)),
    section('ASSUMPTIONS', story.assumptions.map((item) => `- ${item}`)),
    section('OUT OF SCOPE — never test these', story.outOfScope.map((item) => `- ${item}`)),
    section('OPEN AMBIGUITIES — do not assume an answer; skip behaviour that depends on them', ambiguities),
    section('TEST TYPE GATES', gateLines(input)),
    section('COVERAGE', coverageLines(input)),
    section('LEARNINGS FROM PAST RUNS', memoryLines(input)),
    section('OUTPUT', ['Return ONLY Scenario blocks in the strict grammar from the skill. No Feature header, no Background, no prose, no code fences.']),
  ].filter(Boolean).join('\n\n');
}

/**
 * Builds the self-correction prompt listing validator errors.
 * @param {string[]} errors
 * @returns {string}
 */
export function buildRetryPrompt(errors: string[]): string {
  return [
    'Your previous output failed deterministic validation. Fix EVERY issue below and return the COMPLETE corrected',
    'set of Scenario blocks for this story (not only the changed ones), in the same strict grammar.',
    'Do not add behaviour that is not grounded in the listed acceptance criteria and business rules.',
    '',
    ...errors.map((error, idx) => `${idx + 1}. ${error}`),
  ].join('\n');
}
