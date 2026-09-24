'use strict';

/**
 * @fileoverview Converts validated scenarios into the persisted test case model and computes
 * requirement coverage. Keys are assigned deterministically in feature → story → scenario order.
 */

import { TestCase, TestStep } from '../../../core/types';
import {
  TC_TYPE, PRIORITY, MIN_TC_BY_RISK, RiskLevel, TYPE_TAGS, isClientErrorStatus,
} from '../constants';
import { NormalizedFeature, NormalizedStory } from '../analysis/normalizeAnalysis';
import { ParsedStep } from '../parsers/GherkinToZephyrParser';
import { ValidatedScenario, computeStepsHash } from '../validators/scenarioValidator';

/** Validated scenarios for one story, in generation order. */
export interface StoryScenarios {
  feature: NormalizedFeature;
  story: NormalizedStory;
  scenarios: ValidatedScenario[];
}

/** Coverage of story requirements by generated test cases. */
export interface RequirementCoverage {
  acceptanceCriteria: { covered: number; total: number };
  businessRules: { covered: number; total: number };
  /** "US-01:AC-3" style ids with no covering test case. */
  uncovered: string[];
}

const RISK_TO_PRIORITY: Readonly<Record<RiskLevel, string>> = Object.freeze({
  CRITICAL: PRIORITY.HIGH,
  HIGH: PRIORITY.HIGH,
  MEDIUM: PRIORITY.MEDIUM,
  LOW: PRIORITY.LOW,
});

const ONE_LEVEL_LOWER: Readonly<Record<string, string>> = Object.freeze({
  [PRIORITY.HIGH]: PRIORITY.MEDIUM,
  [PRIORITY.MEDIUM]: PRIORITY.LOW,
  [PRIORITY.LOW]: PRIORITY.LOW,
});

/**
 * Deterministic priority: risk-based, with edge cases one level lower.
 * @param {string} type
 * @param {RiskLevel} riskLevel
 * @returns {string}
 */
export function priorityFor(type: string, riskLevel: RiskLevel): string {
  const base = RISK_TO_PRIORITY[riskLevel] || PRIORITY.MEDIUM;
  return type === TC_TYPE.EDGE ? ONE_LEVEL_LOWER[base] : base;
}

function extractRequestBody(steps: ParsedStep[]): Record<string, any> | any[] | null {
  for (const step of steps) {
    const data = step.testData.trim();
    if (!data.startsWith('{') && !data.startsWith('[')) continue;
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  return null;
}

function buildPrecondition(scenario: ValidatedScenario, story: NormalizedStory): string {
  const givens = scenario.steps.filter((step) => step.keyword === 'Given').map((step) => step.description);
  if (givens.length > 0) return givens.join('; ');
  return story.assumptions.join('; ') || 'None';
}

function buildTestCase(key: string, feature: NormalizedFeature, story: NormalizedStory, scenario: ValidatedScenario): TestCase {
  const testSteps: TestStep[] = scenario.steps.map((step) => ({
    keyword: step.keyword,
    description: step.description,
    testData: step.testData,
    expectedResult: step.expectedResult,
  }));
  const testCase: TestCase = {
    key,
    name: scenario.title,
    objective: `Verifies ${scenario.requirementRefs.join(', ')}: ${scenario.title}`,
    precondition: buildPrecondition(scenario, story),
    type: scenario.type,
    priority: priorityFor(scenario.type, feature.riskLevel),
    labels: scenario.labels,
    featureId: feature.id,
    userStoryId: story.id,
    requirementRefs: scenario.requirementRefs,
    testSteps,
    hash: computeStepsHash(scenario.type, scenario.steps),
    selected: true,
  };
  if (scenario.api) {
    testCase.apiDetails = {
      method: scenario.api.method,
      endpoint: scenario.api.integration.endpoint,
      requestBody: extractRequestBody(scenario.steps),
      expectedStatusCode: scenario.api.statusCode,
    };
  }
  if (scenario.performance) {
    testCase.performanceRef = { scenario: scenario.performance.scenario, targetEndpoint: scenario.performance.integration.endpoint };
  }
  return testCase;
}

/**
 * Builds test cases with sequential keys TC-001… in the given story order.
 * @param {StoryScenarios[]} stories - Must be in feature → story order for stable keys
 * @returns {TestCase[]}
 */
export function buildTestCases(stories: StoryScenarios[]): TestCase[] {
  let counter = 0;
  return stories.flatMap(({ feature, story, scenarios }) => scenarios.map((scenario) => {
    counter += 1;
    return buildTestCase(`TC-${String(counter).padStart(3, '0')}`, feature, story, scenario);
  }));
}

/**
 * Feature-level coverage warnings against MIN_TC_BY_RISK. Advisory only — never padded.
 * @param {NormalizedFeature[]} features
 * @param {TestCase[]} testCases
 * @param {ReadonlySet<string>} excludedTypeTags
 * @returns {string[]}
 */
export function buildCoverageWarnings(features: NormalizedFeature[], testCases: TestCase[], excludedTypeTags: ReadonlySet<string>): string[] {
  const warnings: string[] = [];
  for (const feature of features) {
    const featureTCs = testCases.filter((tc) => tc.featureId === feature.id);
    const targets = MIN_TC_BY_RISK[feature.riskLevel];
    for (const [typeTag, target] of Object.entries(targets)) {
      // An API test case asserting a 4xx status verifies negative behaviour, as the per-story minimum counts it.
      const count = featureTCs.filter((tc) => tc.type === TYPE_TAGS[typeTag]
        || (typeTag === 'negative' && tc.type === TC_TYPE.API && isClientErrorStatus(tc.apiDetails?.expectedStatusCode))).length;
      if (count >= target || excludedTypeTags.has(typeTag)) continue;
      warnings.push(`[${feature.id}] ${feature.riskLevel} risk target: ${count}/${target} ${typeTag} test cases `
        + '— not padded; add documented rules/criteria in Agent 01 if more coverage is needed');
    }
  }
  return warnings;
}

/**
 * Computes how many acceptance criteria and business rules are referenced by test cases.
 * @param {NormalizedFeature[]} features
 * @param {TestCase[]} testCases
 * @returns {RequirementCoverage}
 */
export function computeRequirementCoverage(features: NormalizedFeature[], testCases: TestCase[]): RequirementCoverage {
  const covered = new Set(testCases.flatMap((tc) => tc.requirementRefs.map((ref) => `${tc.userStoryId}:${ref}`)));
  const stories = features.flatMap((feature) => feature.userStories);
  const tally = (pick: (story: NormalizedStory) => { id: string }[]) => {
    const ids = stories.flatMap((story) => pick(story).map((item) => `${story.id}:${item.id}`));
    return { ids, covered: ids.filter((id) => covered.has(id)).length };
  };
  const acs = tally((story) => story.acceptanceCriteria);
  const brs = tally((story) => story.businessRules);
  return {
    acceptanceCriteria: { covered: acs.covered, total: acs.ids.length },
    businessRules: { covered: brs.covered, total: brs.ids.length },
    uncovered: [...acs.ids, ...brs.ids].filter((id) => !covered.has(id)),
  };
}
