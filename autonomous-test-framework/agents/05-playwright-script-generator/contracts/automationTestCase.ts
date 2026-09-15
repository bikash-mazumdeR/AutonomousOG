'use strict';

/**
 * @fileoverview AutomationTestCase contract — the approved test case (Agents 02/03) plus explicit data
 * bindings (Agent 04). The readiness rules that decide whether it can be automated without guessing live in
 * core/readiness. Nothing here knows anything about a specific application.
 */

import {
  API_TYPES, PERF_TYPES, PLACEHOLDER_PATTERN, GenerationMode,
} from '../constants';
import { SLA_PATTERN } from '../../../core/readiness/readinessConstants';
import { toEnvVarName } from '../../../core/aut/envVarNames';
import { BrowserTarget, targetedBrowsers } from '../../../core/readiness/browserTargets';

export { toEnvVarName };

/** How a step's data token is supplied at runtime. */
export interface DataBinding {
  token: string;
  fixtureKey?: string;
  envVar?: string;
  unresolved?: boolean;
}

/** One approved step with its data bindings. */
export interface AutomationStep {
  index: number;
  keyword: string;
  action: string;
  expected: string[];
  testData: string;
  data: DataBinding[];
}

/** The approved test case in the shape Agent 05 generates from. */
export interface AutomationTestCase {
  tcKey: string;
  title: string;
  type: string;
  priority: string;
  labels: string[];
  featureId: string;
  userStoryId: string;
  requirementRefs: string[];
  objective: string;
  precondition: string;
  steps: AutomationStep[];
  api?: {
    method: string;
    endpoint: string;
    expectedStatusCode: number;
    requestBodyFixtureKey?: string;
    requestBodyUnresolved?: boolean;
  };
  performance?: { scenario: string; targetEndpoint: string; slaText?: string };
  /** Browsers the test case explicitly names; the generated test runs only in those browser projects. */
  targetBrowsers?: BrowserTarget[];
}

/**
 * Generation mode for a test case type.
 * @param {string} type
 * @returns {GenerationMode}
 */
export function modeForType(type: string): GenerationMode {
  const normalized = String(type || '').toLowerCase();
  if (PERF_TYPES.has(normalized)) return 'K6';
  if (API_TYPES.has(normalized)) return 'API';
  return 'UI';
}

/**
 * Collects fixture values with deterministic keys: a placeholder keeps its own name unless a different
 * value was already registered under it, in which case the value is stored as `<TCKEY>_<name>`.
 */
export class FixtureAccumulator {
  private readonly _values = new Map<string, unknown>();

  /**
   * Registers a value and returns the fixture key to reference it by.
   * @param {string} tcKey
   * @param {string} name
   * @param {unknown} value
   * @returns {string}
   */
  bind(tcKey: string, name: string, value: unknown): string {
    if (!this._values.has(name)) {
      this._values.set(name, value);
      return name;
    }
    if (JSON.stringify(this._values.get(name)) === JSON.stringify(value)) return name;
    const perTestKey = `${tcKey.replace(/[^A-Za-z0-9]/g, '')}_${name}`;
    this._values.set(perTestKey, value);
    return perTestKey;
  }

  /**
   * Fixture file contents with keys sorted for stable output.
   * @returns {Record<string, unknown>}
   */
  toObject(): Record<string, unknown> {
    return Object.fromEntries([...this._values.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)).filter(Boolean) : [];
}

function placeholdersIn(...texts: unknown[]): string[] {
  const found = new Set<string>();
  for (const text of texts) {
    for (const match of String(text || '').matchAll(PLACEHOLDER_PATTERN)) found.add(match[1]);
  }
  return [...found];
}

function bindStep(tcKey: string, names: string[], inputs: Record<string, any>, fixture: FixtureAccumulator): DataBinding[] {
  return names.map((name) => {
    const token = `{{${name}}}`;
    const entry = inputs[token];
    if (!entry || entry.source === 'unresolved') return { token, unresolved: true };
    // Agent 04 names the variable (AUT profile, clarification or UI); the convention is the fallback for older manifests
    if (entry.sensitive || entry.source === 'runtime') return { token, envVar: entry.envVar || toEnvVarName(name) };
    return { token, fixtureKey: fixture.bind(tcKey, name, entry.value) };
  });
}

function buildApi(tcKey: string, tc: any, fixture: FixtureAccumulator): AutomationTestCase['api'] {
  const details = tc.apiDetails || {};
  const api = {
    method: String(details.method || '').toUpperCase(),
    endpoint: String(details.endpoint || '').trim(),
    expectedStatusCode: Number(details.expectedStatusCode),
  };
  const body = tc.resolvedData?.apiPayload ?? details.requestBody ?? null;
  if (body === null || body === undefined) return api;
  if (JSON.stringify(body).includes('{{')) return { ...api, requestBodyUnresolved: true };
  return { ...api, requestBodyFixtureKey: fixture.bind(tcKey, 'requestBody', body) };
}

function buildPerformance(tc: any, steps: AutomationStep[]): AutomationTestCase['performance'] {
  const slaText = steps.flatMap((step) => step.expected).find((line) => SLA_PATTERN.test(line));
  return {
    scenario: String(tc.performanceRef?.scenario || '').toLowerCase(),
    targetEndpoint: String(tc.performanceRef?.targetEndpoint || '').trim(),
    slaText,
  };
}

/**
 * Builds the automation contract for one approved test case.
 * @param {any} tc - Approved test case (Agent 04-enriched when available, carrying `resolvedData`)
 * @param {any} raw - The same test case from the Agent 03 artifact (original `{{placeholders}}` in steps)
 * @param {FixtureAccumulator} fixture
 * @returns {AutomationTestCase}
 */
export function buildAutomationTestCase(tc: any, raw: any, fixture: FixtureAccumulator): AutomationTestCase {
  const tcKey = String(tc.key);
  const inputs = tc.resolvedData?.inputs || {};
  const sourceSteps: any[] = raw?.testSteps || tc.testSteps || [];
  const steps: AutomationStep[] = sourceSteps.map((step, idx) => {
    const testData = String(step.testData || '').trim();
    return {
      index: idx + 1,
      keyword: String(step.keyword || ''),
      action: String(step.description || '').trim(),
      expected: String(step.expectedResult || '').split('\n').map((line) => line.trim()).filter(Boolean),
      testData,
      data: bindStep(tcKey, placeholdersIn(step.description, testData, step.expectedResult), inputs, fixture),
    };
  });
  const contract: AutomationTestCase = {
    tcKey,
    title: String(tc.name || tcKey).trim(),
    type: String(tc.type || ''),
    priority: String(tc.priority || ''),
    labels: toStringArray(tc.labels),
    featureId: String(tc.featureId || 'UNMAPPED'),
    userStoryId: String(tc.userStoryId || ''),
    requirementRefs: toStringArray(tc.requirementRefs),
    objective: String(tc.objective || ''),
    precondition: String(tc.precondition || ''),
    steps,
    targetBrowsers: targetedBrowsers([String(tc.name || ''), String(tc.precondition || ''), ...steps.flatMap((step) => [step.action, ...step.expected])]),
  };
  const mode = modeForType(contract.type);
  if (mode === 'API') contract.api = buildApi(tcKey, tc, fixture);
  if (mode === 'K6') contract.performance = buildPerformance(tc, steps);
  return contract;
}
