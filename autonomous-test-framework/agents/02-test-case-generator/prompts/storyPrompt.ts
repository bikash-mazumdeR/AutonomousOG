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
  /** Placeholder names of the test account's credentials, supplied by the environment (e.g. validEmail). */
  credentialNames?: string[];
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

/**
 * The step grammar rules models most often break: they write conventional Gherkin (a Given precondition with no
 * Then, followed by When → Then), which the strict parser rejects scenario by scenario. Restated in the user prompt
 * and, when violated, at the top of the retry prompt.
 */
export const STEP_GRAMMAR_RULES: readonly string[] = Object.freeze([
  '- EVERY `Given` line and EVERY `When` line is followed by its OWN `Then` before the next `Given`/`When`. '
    + 'A setup `Given` is no exception: follow it with a `Then` stating the observable starting state.',
  '  WRONG:  Given the user opens the <page>  /  When the user submits the form  /  Then <result>',
  '  RIGHT:  Given the user opens the <page>  /  Then the <page> is displayed  /  When the user submits the form  /  Then <result>',
  '- EVERY scenario has at least one `Given` block AND at least one `When` block, including scenarios that only verify '
    + 'what a page shows: add a `When` for the user viewing or interacting with it, followed by its `Then`.',
  '- Never continue an action with `And <another action>`; start a new `When` block instead.',
]);

/** Parser/validator messages that mean the step grammar itself was broken. */
const GRAMMAR_ERROR_PATTERN = /has no Then expected result|has no When action|has no Given setup step|continues an action|has no preceding Given\/When/;

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

function coverageLines({
  feature, story, excludedTypeTags, apiGate,
}: StoryPromptInput): string[] {
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
  if (!excludedTypeTags.has('negative') && !excludedTypeTags.has('api') && apiGate.allowed) {
    lines.push('- A documented API error response is tested as ONE @api scenario asserting its 4xx @status-<code>; it also counts as '
      + "the story's @negative scenario. Never tag an API scenario @negative, and never add @method-/@status-/@int- tags to a @negative scenario.");
  }
  lines.push('- Beyond the minimum, add scenarios only for distinct documented behaviour; never invent behaviour to reach a number.');
  return lines;
}

/**
 * The placeholder names a scenario should use for test inputs: the account credentials, then the values the analysis
 * extracted for this story. A sensitive value is listed by name only.
 */
function testDataLines({ story, credentialNames = [] }: StoryPromptInput): string[] {
  const credentials = credentialNames
    .filter((name) => !(story.testData || []).some((item) => item.name === name))
    .map((name) => `- {{${name}}} — test account credential, supplied by the environment`);
  const values = (story.testData || []).map((item) => {
    const source = item.sourceRef ? ` (${item.sourceRef})` : '';
    return item.sensitive || item.value === undefined
      ? `- {{${item.name}}} — sensitive; supplied by the environment, never write its value${source}`
      : `- {{${item.name}}} = ${JSON.stringify(item.value)}${source}`;
  });
  const lines = [...credentials, ...values];
  if (lines.length === 0) return [];
  return [
    ...lines,
    'Write a value the user ENTERS or SELECTS, or an API request SENDS in its body, as its placeholder with exactly this name',
    '(e.g. { "productId": "{{productId}}" }), and name a new camelCase placeholder only for an input none of them covers.',
    'Keep expected on-screen wording (headings, labels, messages) as quoted text, exactly as the criteria state it.',
  ];
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
    section('TEST DATA — placeholder names for test inputs', testDataLines(input)),
    section('ASSUMPTIONS', story.assumptions.map((item) => `- ${item}`)),
    section('OUT OF SCOPE — never test these', story.outOfScope.map((item) => `- ${item}`)),
    section('OPEN AMBIGUITIES — do not assume an answer; skip behaviour that depends on them', ambiguities),
    section('TEST TYPE GATES', gateLines(input)),
    section('COVERAGE', coverageLines(input)),
    section('LEARNINGS FROM PAST RUNS', memoryLines(input)),
    section('OUTPUT', [
      'Return ONLY Scenario blocks in the strict grammar from the skill. No Feature header, no Background, no prose, no code fences.',
      'Step grammar (answers that break it are rejected scenario by scenario):',
      ...STEP_GRAMMAR_RULES,
    ]),
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
  const grammarErrors = errors.filter((error) => GRAMMAR_ERROR_PATTERN.test(error)).length;
  const grammar = grammarErrors === 0 ? [] : [
    `${grammarErrors} issue(s) below break the step grammar. Fix these first, in EVERY scenario you return:`,
    ...STEP_GRAMMAR_RULES,
    '',
  ];
  return [
    ...grammar,
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
