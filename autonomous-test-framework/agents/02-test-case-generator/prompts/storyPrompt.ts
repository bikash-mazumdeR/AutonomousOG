'use strict';

/**
 * @fileoverview Builds the per-story user prompt and the self-correction prompt for Agent 02.
 * The system prompt (skill + learnings) is identical for every story; only this compact,
 * story-scoped context varies, so the model sees exactly the requirements it may test.
 */

import {
  LABEL_TAGS, K6_SCENARIOS, HTTP_METHODS, MIN_TC_BY_RISK, MAX_REJECTION_FEEDBACK_IN_PROMPT, STAGE_ID, ALL_STAGES,
  SELECTABLE_UI_TYPE_TAGS, MIN_TC_PER_STORY_PER_TYPE, maxTcPerStoryPerType,
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
    `Story: ${story.id} — ${story.title}${story.sourceStoryId ? ` (source story ${story.sourceStoryId})` : ''}`,
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

const tagList = (tags: string[]): string => tags.map((tag) => `@${tag}`).join(' ');

/** UI type tags selected for this run, in canonical order. */
function selectedUiTypes(excludedTypeTags: ReadonlySet<string>): string[] {
  return SELECTABLE_UI_TYPE_TAGS.filter((tag) => !excludedTypeTags.has(tag));
}

function hasExcludedUiType(excludedTypeTags: ReadonlySet<string>): boolean {
  return SELECTABLE_UI_TYPE_TAGS.some((tag) => excludedTypeTags.has(tag));
}

function gateLines({ apiGate, performanceGate, excludedTypeTags }: StoryPromptInput): string[] {
  const lines = [`- Selected types: ${tagList(selectedUiTypes(excludedTypeTags)) || '(none)'}`];
  if (excludedTypeTags.size > 0) {
    lines.push(`- EXCLUDED for this run: ${tagList([...excludedTypeTags])} — never generate them and never re-tag their behaviour as another type`);
  }
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

function coverageLines({ feature, story, excludedTypeTags }: StoryPromptInput): string[] {
  const storyCount = Math.max(feature.userStories.length, 1);
  const max = maxTcPerStoryPerType(story.acceptanceCriteria.length + story.businessRules.length);
  const targets = selectedUiTypes(excludedTypeTags).map((typeTag) => {
    const riskTarget = Math.ceil(MIN_TC_BY_RISK[feature.riskLevel][typeTag as 'positive' | 'negative' | 'edge'] / storyCount);
    return `${Math.min(Math.max(riskTarget, MIN_TC_PER_STORY_PER_TYPE), max)} @${typeTag}`;
  });
  const lines = hasExcludedUiType(excludedTypeTags)
    ? ['- Every acceptance criterion MUST be covered by ≥1 scenario tagged @ac-N, EXCEPT a criterion that only an excluded type '
      + 'could verify: write the line "# UNCOVERED AC-N: @<excluded type>" for it instead.']
    : ['- Every acceptance criterion MUST be covered by ≥1 scenario tagged @ac-N.'];
  if (targets.length > 0) {
    lines.push(`- Per story: at least ${MIN_TC_PER_STORY_PER_TYPE} and at most ${max} scenarios of EACH selected type; `
      + `aim for up to ${targets.join(', ')} when enough distinct behaviour is documented.`);
  }
  lines.push('- Beyond the minimum, add scenarios only for distinct documented behaviour; never invent behaviour to reach a number.');
  return lines;
}

function memoryLines({ memoryContext }: StoryPromptInput): string[] {
  const rules = (memoryContext.improvementRules || [])
    .filter((rule) => (rule.appliesTo === STAGE_ID || rule.appliesTo === ALL_STAGES) && rule.description)
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
    section('ACCEPTANCE CRITERIA (tag covering scenarios with @ac-N)',
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

/** Optional context that keeps retries consistent with the run's type selection. */
export interface RetryPromptOptions {
  /** Titles of scenarios already accepted. */
  acceptedTitles?: string[];
  excludedTypeTags?: ReadonlySet<string>;
  /** Type tags of scenarios dropped in the failed attempt because their type is excluded. */
  excludedDrops?: string[];
  /** The previous answer was cut off at the output token limit. */
  truncated?: boolean;
}

function exclusionReminder(excludedTypeTags: ReadonlySet<string>, excludedDrops: string[]): string[] {
  if (excludedTypeTags.size === 0) return [];
  const counts = [...new Set(excludedDrops)].map((tag) => `${excludedDrops.filter((t) => t === tag).length} @${tag}`);
  return [
    `EXCLUDED types: ${tagList([...excludedTypeTags])} — never generate them and never re-tag their behaviour as another type.`,
    ...(counts.length > 0 ? [`Your last output contained ${counts.join(', ')} scenario(s); they were discarded.`] : []),
    ...(hasExcludedUiType(excludedTypeTags)
      ? ['If a criterion can only be verified by an excluded type, write "# UNCOVERED AC-N: @<type>" instead of a scenario.'] : []),
  ];
}

/**
 * Builds the self-correction prompt. Accepted scenarios are kept by the framework, so the model returns
 * only fixes and coverage gaps — a retry can never shrink the already-valid scenario set.
 * @param {string[]} errors
 * @param {RetryPromptOptions} [options]
 * @returns {string}
 */
export function buildRetryPrompt(errors: string[], options: RetryPromptOptions = {}): string {
  const {
    acceptedTitles = [], excludedTypeTags = new Set<string>(), excludedDrops = [], truncated = false,
  } = options;
  const kept = acceptedTitles.length === 0 ? [] : [
    '',
    'ALREADY ACCEPTED — the framework keeps these; do NOT return them again unless an issue below requires changing one',
    '(then return it with the EXACT same title):',
    ...acceptedTitles.map((title) => `- ${title}`),
  ];
  return [
    ...(truncated ? ['Your previous output was cut off at the output token limit; its last scenario was discarded. Continue with the scenarios still needed.'] : []),
    'Your previous output failed deterministic validation. Return ONLY, in the same strict grammar:',
    '(a) a corrected version of each failing scenario, and (b) new scenarios, of SELECTED types only, for any coverage gap below.',
    'Do not add behaviour that is not grounded in the listed acceptance criteria and business rules.',
    ...exclusionReminder(excludedTypeTags, excludedDrops),
    ...kept,
    '',
    'ISSUES TO FIX:',
    ...errors.map((error, idx) => `${idx + 1}. ${error}`),
  ].join('\n');
}
