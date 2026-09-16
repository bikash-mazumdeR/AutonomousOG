'use strict';

/**
 * @fileoverview Deterministic grounding & coverage validator for Agent 02 scenarios.
 * Errors are fed back to the LLM for self-correction; scenarios with errors are never persisted.
 */

import * as crypto from 'crypto';
import {
  TYPE_TAGS, LABEL_TAGS, K6_SCENARIOS, HTTP_METHODS, TAG_PATTERN, IGNORED_TAGS, PLACEHOLDER_TOKEN,
  VALID_PLACEHOLDER, TITLE_LENGTH, MIN_OUT_OF_SCOPE_PHRASE_LENGTH, SMOKE_REQUIRED_RISKS, TC_TYPE,
  SELECTABLE_UI_TYPE_TAGS, MIN_TC_PER_STORY_PER_TYPE, FAILURE_OUTCOME_PATTERN, NEGATED_FAILURE_PHRASE, maxTcPerStoryPerType,
} from '../constants';
import {
  GherkinParseResult, ParsedScenario, ParsedStep, UncoveredDeclaration,
} from '../parsers/GherkinToZephyrParser';
import { IntegrationPoint, NormalizedFeature, NormalizedStory } from '../analysis/normalizeAnalysis';
import { GateResult, integrationTag } from '../analysis/requirementGates';

/** Everything the validator needs to judge one story's scenarios. */
export interface ScenarioContext {
  feature: NormalizedFeature;
  story: NormalizedStory;
  apiGate: GateResult;
  performanceGate: GateResult;
  /** Type tags excluded by --skip-* options. */
  excludedTypeTags: ReadonlySet<string>;
}

/** A scenario that passed validation, with its tags resolved. */
export interface ValidatedScenario extends ParsedScenario {
  type: string;
  labels: string[];
  requirementRefs: string[];
  api?: { integration: IntegrationPoint; method: string; statusCode: number };
  performance?: { scenario: string; integration: IntegrationPoint };
}

/** Validation outcome for one story. */
export interface StoryValidationResult {
  scenarios: ValidatedScenario[];
  errors: string[];
  warnings: string[];
  /** Valid "# UNCOVERED" declarations accumulated across attempts. */
  declaredUncovered: UncoveredDeclaration[];
  /** Type tags of scenarios dropped in this attempt because their type is excluded (one entry per scenario). */
  excludedDrops: string[];
}

interface TagBuckets {
  types: string[];
  refs: string[];
  labels: string[];
  integrations: string[];
  methods: string[];
  statuses: string[];
  k6: string[];
  unknown: string[];
}

interface StoryIssues {
  errors: string[];
  warnings: string[];
}

interface ScenarioOutcome {
  errors: string[];
  scenario?: ValidatedScenario;
  excludedTypeTag?: string;
}

const SNIPPET_LENGTH = 80;

const hasKey = (record: object, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);

function snippet(text: string): string {
  return text.length > SNIPPET_LENGTH ? `${text.slice(0, SNIPPET_LENGTH - 3)}...` : text;
}

/**
 * Stable content hash of a scenario (used for duplicate detection here and by Agent 03).
 * @param {string} type
 * @param {Array<Pick<ParsedStep, 'keyword'|'description'|'expectedResult'>>} steps
 * @returns {string}
 */
export function computeStepsHash(type: string, steps: Array<Pick<ParsedStep, 'keyword' | 'description' | 'expectedResult'>>): string {
  const content = [type, ...steps.map((s) => `${s.keyword} ${s.description} => ${s.expectedResult}`)]
    .join('|').toLowerCase().replace(/\s+/g, ' ');
  return crypto.createHash('md5').update(content).digest('hex').slice(0, 12);
}

function classifyTags(tags: string[]): TagBuckets {
  const buckets: TagBuckets = {
    types: [], refs: [], labels: [], integrations: [], methods: [], statuses: [], k6: [], unknown: [],
  };
  for (const tag of new Set(tags)) {
    const ref = tag.match(TAG_PATTERN.REQUIREMENT_REF);
    const method = tag.match(TAG_PATTERN.METHOD);
    const status = tag.match(TAG_PATTERN.STATUS);
    if (hasKey(TYPE_TAGS, tag)) buckets.types.push(tag);
    else if (ref) buckets.refs.push(`${ref[1].toUpperCase()}-${Number(ref[2])}`);
    else if (hasKey(LABEL_TAGS, tag)) buckets.labels.push(tag);
    else if (K6_SCENARIOS.includes(tag)) buckets.k6.push(tag);
    else if (method) buckets.methods.push(method[1].toUpperCase());
    else if (status) buckets.statuses.push(status[1]);
    else if (TAG_PATTERN.INTEGRATION.test(tag)) buckets.integrations.push(tag);
    else if (!TAG_PATTERN.TC_KEY.test(tag) && !IGNORED_TAGS.has(tag)) buckets.unknown.push(tag);
  }
  return buckets;
}

function sortRefs(refs: string[]): string[] {
  const rank = (ref: string) => (ref.startsWith('AC') ? 0 : 100000) + Number(ref.split('-')[1]);
  return [...new Set(refs)].sort((a, b) => rank(a) - rank(b));
}

function checkRefs(refs: string[], story: NormalizedStory): string[] {
  const known = new Set([...story.acceptanceCriteria, ...story.businessRules].map((item) => item.id));
  if (refs.length === 0) return ['must reference at least one requirement via @ac-N or @br-N'];
  const unknown = refs.filter((ref) => !known.has(ref));
  return unknown.length === 0 ? [] : [`references unknown requirement id(s) ${unknown.join(', ')} — valid ids: ${[...known].join(', ')}`];
}

function checkTitle(title: string): string[] {
  if (title.length < TITLE_LENGTH.MIN) return [`title must be at least ${TITLE_LENGTH.MIN} characters`];
  if (title.length > TITLE_LENGTH.MAX) return [`title must be at most ${TITLE_LENGTH.MAX} characters`];
  return [];
}

function checkPlaceholders(scenario: ParsedScenario): string[] {
  const text = scenario.steps.flatMap((s) => [s.description, s.testData, s.expectedResult]).join('\n');
  const tokens = text.match(PLACEHOLDER_TOKEN) || [];
  const invalid = [...new Set(tokens.filter((token) => !VALID_PLACEHOLDER.test(token)))];
  const unbalanced = (text.match(/\{\{/g) || []).length !== tokens.length;
  const errors = invalid.map((token) => `placeholder ${token} must be camelCase like {{validPassword}}`);
  if (unbalanced) errors.push('contains an unbalanced "{{" placeholder');
  return errors;
}

function normalizePhrase(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
}

/**
 * Rejects a @positive scenario whose expected results assert a failure outcome (mislabelled negative behaviour).
 * @param {string} typeTag
 * @param {ParsedScenario} scenario
 * @param {ReadonlySet<string>} excludedTypeTags
 * @returns {string[]}
 */
export function checkTypeSemantics(typeTag: string, scenario: ParsedScenario, excludedTypeTags: ReadonlySet<string>): string[] {
  if (typeTag !== 'positive') return [];
  const outcomes = scenario.steps.map((step) => step.expectedResult.replace(NEGATED_FAILURE_PHRASE, ' ')).join('\n');
  const match = outcomes.match(FAILURE_OUTCOME_PATTERN);
  if (!match) return [];
  const remedy = excludedTypeTags.has('negative')
    ? '@negative is EXCLUDED for this run, so do not write it at all; write a @positive scenario with a success or neutral outcome instead'
    : 're-tag it @negative, or rewrite it with a success or neutral outcome';
  return [`is tagged @positive but asserts a failure outcome ("${match[0]}") — that is @negative behaviour; ${remedy}`];
}

function checkOutOfScope(scenario: ParsedScenario, story: NormalizedStory): string[] {
  const haystack = normalizePhrase([scenario.title, ...scenario.steps.flatMap((s) => [s.description, s.expectedResult])].join(' '));
  return story.outOfScope
    .map(normalizePhrase)
    .filter((phrase) => phrase.trim().length >= MIN_OUT_OF_SCOPE_PHRASE_LENGTH && haystack.includes(phrase))
    .map((phrase) => `tests out-of-scope item "${phrase.trim()}"`);
}

function matchIntegration(tags: string[], gate: GateResult, required: boolean, errors: string[]): IntegrationPoint | undefined {
  const allowed = gate.integrationPoints.map((ip) => `@${integrationTag(ip.id)}`).join(', ');
  if (tags.length === 0) {
    if (required) errors.push(`needs one @int-<id> tag (${allowed})`);
    return required ? undefined : gate.integrationPoints[0];
  }
  if (tags.length > 1) {
    errors.push(`must have at most one @int-<id> tag (${allowed})`);
    return undefined;
  }
  const integration = gate.integrationPoints.find((ip) => integrationTag(ip.id) === tags[0]);
  if (!integration) errors.push(`@${tags[0]} is not a documented integration point for this story (${allowed || 'none'})`);
  return integration;
}

function resolveApi(typeTag: string, tags: TagBuckets, ctx: ScenarioContext, errors: string[]): ValidatedScenario['api'] {
  if (typeTag !== 'api') {
    if (tags.methods.length || tags.statuses.length) errors.push('@method-/@status- tags are only allowed on @api scenarios');
    if (tags.integrations.length && typeTag !== 'performance') errors.push('@int- tags are only allowed on @api/@performance scenarios');
    return undefined;
  }
  if (!ctx.apiGate.allowed) {
    errors.push(`@api scenarios are not allowed for this story: ${ctx.apiGate.reason}`);
    return undefined;
  }
  const before = errors.length;
  const integration = matchIntegration(tags.integrations, ctx.apiGate, true, errors);
  if (tags.methods.length !== 1 || !HTTP_METHODS.includes(tags.methods[0])) {
    errors.push(`@api scenario needs exactly one @method-<${HTTP_METHODS.join('|').toLowerCase()}> tag`);
  }
  if (tags.statuses.length !== 1) errors.push('@api scenario needs exactly one @status-<code> tag');
  if (!integration || errors.length > before) return undefined;
  return { integration, method: tags.methods[0], statusCode: Number(tags.statuses[0]) };
}

function resolvePerformance(typeTag: string, tags: TagBuckets, ctx: ScenarioContext, errors: string[]): ValidatedScenario['performance'] {
  if (typeTag !== 'performance') {
    if (tags.k6.length) errors.push(`@${K6_SCENARIOS.join('/@')} tags are only allowed on @performance scenarios`);
    return undefined;
  }
  if (!ctx.performanceGate.allowed) {
    errors.push(`@performance (K6) scenarios are not allowed for this story: ${ctx.performanceGate.reason}. `
      + 'Cover performance criteria as UI timing assertions under @positive/@edge instead');
    return undefined;
  }
  const before = errors.length;
  const integration = matchIntegration(tags.integrations, ctx.performanceGate, false, errors);
  if (tags.k6.length !== 1) errors.push(`@performance scenario needs exactly one of @${K6_SCENARIOS.join(' @')}`);
  if (!integration || errors.length > before) return undefined;
  return { scenario: tags.k6[0], integration };
}

function validateScenario(scenario: ParsedScenario, ctx: ScenarioContext): ScenarioOutcome {
  const tags = classifyTags(scenario.tags);
  const errors = [...scenario.errors];
  if (tags.unknown.length > 0) {
    errors.push(`unknown tag(s) ${tags.unknown.map((t) => `@${t}`).join(' ')} — allowed labels: @${Object.keys(LABEL_TAGS).join(' @')}`);
  }
  if (tags.types.length !== 1) {
    errors.push(`must have exactly one type tag (@${Object.keys(TYPE_TAGS).join('|@')}), found ${tags.types.length}`);
    return { errors };
  }
  const typeTag = tags.types[0];
  if (ctx.excludedTypeTags.has(typeTag)) return { errors: [], excludedTypeTag: typeTag };

  errors.push(
    ...checkTypeSemantics(typeTag, scenario, ctx.excludedTypeTags),
    ...checkRefs(tags.refs, ctx.story),
    ...checkTitle(scenario.title),
    ...checkPlaceholders(scenario),
    ...checkOutOfScope(scenario, ctx.story),
  );
  const api = resolveApi(typeTag, tags, ctx, errors);
  const performance = resolvePerformance(typeTag, tags, ctx, errors);
  if (errors.length > 0) return { errors };

  const labels = Object.keys(LABEL_TAGS).filter((tag) => tags.labels.includes(tag)).map((tag) => LABEL_TAGS[tag]);
  return {
    errors,
    scenario: {
      ...scenario, type: TYPE_TAGS[typeTag], labels, requirementRefs: sortRefs(tags.refs), api, performance,
    },
  };
}

function selectedUiTypeTags(ctx: ScenarioContext): string[] {
  return SELECTABLE_UI_TYPE_TAGS.filter((tag) => !ctx.excludedTypeTags.has(tag));
}

function uncoveredCriterionIssues(accepted: ValidatedScenario[], ctx: ScenarioContext, declared: UncoveredDeclaration[]): StoryIssues {
  const covered = new Set(accepted.flatMap((s) => s.requirementRefs));
  const excluded = SELECTABLE_UI_TYPE_TAGS.filter((tag) => ctx.excludedTypeTags.has(tag));
  const issues: StoryIssues = { errors: [], warnings: [] };
  for (const ac of ctx.story.acceptanceCriteria.filter((item) => !covered.has(item.id))) {
    const declaration = declared.find((d) => d.ref === ac.id && ctx.excludedTypeTags.has(d.typeTag));
    if (declaration) {
      issues.warnings.push(`[${ctx.feature.id}/${ctx.story.id}] ${ac.id} ("${snippet(ac.text)}") not covered: `
        + `requires @${declaration.typeTag} (excluded for this run)`);
      continue;
    }
    const hint = excluded.length === 0 ? ''
      : ` — cover it with a selected type, or if ONLY an excluded type (@${excluded.join('/@')}) can verify it, write "# UNCOVERED ${ac.id}: @<type>"`;
    issues.errors.push(`${ac.id} ("${snippet(ac.text)}") is not covered by any valid scenario${hint}`);
  }
  return issues;
}

function typeMinimumErrors(accepted: ValidatedScenario[], ctx: ScenarioContext): string[] {
  return selectedUiTypeTags(ctx)
    .filter((tag) => accepted.filter((s) => s.type === TYPE_TAGS[tag]).length < MIN_TC_PER_STORY_PER_TYPE)
    .map((tag) => `no @${tag} scenario — at least ${MIN_TC_PER_STORY_PER_TYPE} @${tag} scenario is required for every story; `
      + 'ground it in the closest acceptance criterion or business rule');
}

function checkStoryCoverage(accepted: ValidatedScenario[], ctx: ScenarioContext, declared: UncoveredDeclaration[]): StoryIssues {
  const issues = uncoveredCriterionIssues(accepted, ctx, declared);
  issues.errors.push(...typeMinimumErrors(accepted, ctx));
  const positives = accepted.filter((s) => s.type === TC_TYPE.POSITIVE);
  const needsSmoke = SMOKE_REQUIRED_RISKS.has(ctx.feature.riskLevel) && positives.length > 0;
  if (needsSmoke && !positives.some((s) => s.labels.includes(LABEL_TAGS.smoke))) {
    issues.errors.push(`${ctx.feature.riskLevel} risk story: tag the primary happy-path @positive scenario with @smoke`);
  }
  return issues;
}

function uncoveredRuleWarnings(accepted: ValidatedScenario[], ctx: ScenarioContext): string[] {
  const covered = new Set(accepted.flatMap((s) => s.requirementRefs));
  return ctx.story.businessRules
    .filter((br) => !covered.has(br.id))
    .map((br) => `[${ctx.feature.id}/${ctx.story.id}] ${br.id} ("${snippet(br.text)}") is not verified by any scenario`);
}

interface PriorIndex {
  titleIndex: Map<string, number>;
  steps: Set<string>;
}

type Placement = { action: 'add' } | { action: 'replace'; index: number } | { action: 'ignore' };

function scenarioKeys(scenario: ValidatedScenario): { title: string; steps: string } {
  return { title: `title:${scenario.title.toLowerCase()}`, steps: `steps:${computeStepsHash(scenario.type, scenario.steps)}` };
}

function indexPrior(prior: ValidatedScenario[]): PriorIndex {
  const keys = prior.map(scenarioKeys);
  return { titleIndex: new Map(keys.map((key, idx) => [key.title, idx])), steps: new Set(keys.map((key) => key.steps)) };
}

/**
 * Flags duplicates within one output and relates a valid scenario to previously accepted ones:
 * the same title replaces the accepted version (count unchanged); the same steps under a new title is ignored.
 */
function placeScenario(scenario: ValidatedScenario, errors: string[], seen: Set<string>, prior: PriorIndex): Placement {
  const keys = scenarioKeys(scenario);
  if (seen.has(keys.title)) errors.push('duplicates the title of an earlier scenario');
  if (seen.has(keys.steps)) errors.push('duplicates the steps of an earlier scenario');
  seen.add(keys.title);
  seen.add(keys.steps);
  const index = prior.titleIndex.get(keys.title);
  if (index !== undefined) return { action: 'replace', index };
  return prior.steps.has(keys.steps) ? { action: 'ignore' } : { action: 'add' };
}

function mergeDeclarations(prior: UncoveredDeclaration[], next: UncoveredDeclaration[]): UncoveredDeclaration[] {
  const merged = new Map(prior.map((d) => [`${d.ref}:${d.typeTag}`, d]));
  next.forEach((d) => merged.set(`${d.ref}:${d.typeTag}`, d));
  return [...merged.values()];
}

const typeCount = (accepted: ValidatedScenario[], type: string): number => accepted.filter((s) => s.type === type).length;

/**
 * Validates one story's parsed scenarios against grammar, grounding, gates, type selection and coverage rules.
 * Scenarios accepted in earlier self-correction attempts (`prior`) are kept and coverage is judged on the union.
 * @param {GherkinParseResult} parsed
 * @param {ScenarioContext} ctx
 * @param {ValidatedScenario[]} [prior]
 * @param {UncoveredDeclaration[]} [priorDeclared] - "# UNCOVERED" declarations from earlier attempts
 * @returns {StoryValidationResult} scenarios = prior scenarios (possibly replaced) plus newly accepted ones
 */
export function validateStoryScenarios(
  parsed: GherkinParseResult,
  ctx: ScenarioContext,
  prior: ValidatedScenario[] = [],
  priorDeclared: UncoveredDeclaration[] = [],
): StoryValidationResult {
  const errors = parsed.errors.map((e) => `Output: ${e}`);
  const warnings: string[] = [];
  const excludedDrops: string[] = [];
  const accepted: ValidatedScenario[] = [...prior];
  const priorIndex = indexPrior(prior);
  const seen = new Set<string>();
  const maxPerType = maxTcPerStoryPerType(ctx.story.acceptanceCriteria.length + ctx.story.businessRules.length);
  const declaredUncovered = mergeDeclarations(priorDeclared, parsed.declaredUncovered || []);

  if (parsed.scenarios.length === 0 && prior.length === 0) errors.push('No "Scenario:" blocks were found in the output');
  for (const scenario of parsed.scenarios) {
    const outcome = validateScenario(scenario, ctx);
    const label = `Scenario "${snippet(scenario.title || '(untitled)')}" (line ${scenario.line})`;
    if (outcome.excludedTypeTag) {
      excludedDrops.push(outcome.excludedTypeTag);
      warnings.push(`[${ctx.story.id}] Dropped ${label}: @${outcome.excludedTypeTag} scenarios are excluded for this run`);
      continue;
    }
    const placement = outcome.scenario ? placeScenario(outcome.scenario, outcome.errors, seen, priorIndex) : null;
    if (outcome.errors.length > 0 || !outcome.scenario || !placement) {
      errors.push(...outcome.errors.map((e) => `${label}: ${e}`));
    } else if (placement.action === 'replace') {
      accepted[placement.index] = outcome.scenario;
    } else if (placement.action === 'ignore') {
      warnings.push(`[${ctx.story.id}] Ignored ${label}: repeats the steps of a scenario accepted in an earlier attempt`);
    } else if (typeCount(accepted, outcome.scenario.type) >= maxPerType) {
      warnings.push(`[${ctx.story.id}] Dropped ${label}: exceeds the limit of ${maxPerType} ${outcome.scenario.type} scenarios per story`);
    } else {
      accepted.push(outcome.scenario);
    }
  }

  const coverage = checkStoryCoverage(accepted, ctx, declaredUncovered);
  errors.push(...coverage.errors);
  warnings.push(...coverage.warnings, ...uncoveredRuleWarnings(accepted, ctx));
  return {
    scenarios: accepted, errors, warnings, declaredUncovered, excludedDrops,
  };
}
