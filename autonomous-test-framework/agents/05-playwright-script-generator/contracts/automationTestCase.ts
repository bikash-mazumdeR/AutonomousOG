'use strict';

/**
 * @fileoverview AutomationTestCase contract — the approved test case (Agents 02/03) plus explicit data
 * bindings (Agent 04) — and the deterministic readiness pre-flight that decides whether a test case can be
 * automated without guessing. Nothing here knows anything about a specific application.
 */

import {
  API_TYPES, PERF_TYPES, K6_SCENARIOS, PLACEHOLDER_PATTERN, REVIEWER_CLARIFICATION_MARKER,
  REVIEWER_REWRITE_MARKER, SLA_PATTERN, GenerationMode, MissingKind,
} from '../constants';

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
}

/** A piece of information required before automation can proceed. */
export interface MissingItem {
  kind: MissingKind;
  detail: string;
}

/** Environment facts used by the readiness check. */
export interface ReadinessContext {
  mode: GenerationMode;
  baseURL: string | null;
  baseUrlEnv: string;
  authStrategy: string;
  apiAuthHeaderEnv?: string;
  thresholdEnv?: string;
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
 * Environment variable name for a sensitive/runtime placeholder ("validPassword" → "ARIA_VALID_PASSWORD").
 * @param {string} placeholder
 * @returns {string}
 */
export function toEnvVarName(placeholder: string): string {
  return `ARIA_${placeholder.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}`;
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
    if (entry.sensitive || entry.source === 'runtime') return { token, envVar: toEnvVarName(name) };
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
  };
  const mode = modeForType(contract.type);
  if (mode === 'API') contract.api = buildApi(tcKey, tc, fixture);
  if (mode === 'K6') contract.performance = buildPerformance(tc, steps);
  return contract;
}

function stepReadiness(tc: AutomationTestCase): MissingItem[] {
  const missing: MissingItem[] = [];
  if (!tc.steps.some((step) => step.expected.length > 0)) {
    missing.push({ kind: 'EXPECTED_RESULT', detail: 'The test case has no steps with expected results.' });
  }
  for (const step of tc.steps) {
    if (step.expected.some((line) => REVIEWER_CLARIFICATION_MARKER.test(line))) {
      missing.push({ kind: 'EXPECTED_RESULT', detail: `Step ${step.index}: the reviewer marked the expected result as requiring clarification.` });
    }
    if (REVIEWER_REWRITE_MARKER.test(step.action)) {
      missing.push({ kind: 'EXPECTED_RESULT', detail: `Step ${step.index}: the action was rewritten by the reviewer and needs human confirmation.` });
    }
    step.data.filter((binding) => binding.unresolved).forEach((binding) => {
      missing.push({ kind: 'DATA', detail: `Step ${step.index}: ${binding.token} has no resolved value (run or complete Agent 04).` });
    });
  }
  return missing;
}

function isRelativePath(value: string | undefined): boolean {
  return !!value && value.startsWith('/') && !value.startsWith('//');
}

function modeReadiness(tc: AutomationTestCase, ctx: ReadinessContext): MissingItem[] {
  const missing: MissingItem[] = [];
  if (!ctx.baseURL) missing.push({ kind: 'AUT_UNREACHABLE', detail: `Environment variable ${ctx.baseUrlEnv} is not set.` });
  if (ctx.mode === 'API') {
    const api = tc.api;
    if (!api || !isRelativePath(api.endpoint) || !api.method || !Number.isInteger(api.expectedStatusCode)) {
      missing.push({ kind: 'ENDPOINT', detail: 'apiDetails must define a relative endpoint, an HTTP method and an expected status code.' });
    }
    if (api?.requestBodyUnresolved) missing.push({ kind: 'DATA', detail: 'The request body contains unresolved placeholders.' });
    if (ctx.authStrategy === 'apiToken' && !ctx.apiAuthHeaderEnv) {
      missing.push({ kind: 'AUTH', detail: 'The AUT profile uses apiToken auth but api.authHeaderEnv is not configured.' });
    }
  }
  if (ctx.mode === 'K6') {
    const perf = tc.performance;
    if (!perf || !K6_SCENARIOS.includes(perf.scenario) || !isRelativePath(perf.targetEndpoint)) {
      missing.push({ kind: 'ENDPOINT', detail: 'performanceRef must define a scenario (load|stress|spike|soak) and a relative target endpoint.' });
    }
    if (perf && !perf.slaText && !ctx.thresholdEnv) {
      missing.push({ kind: 'SLA', detail: 'No latency SLA in the test case and no performance.thresholdEnv in the AUT profile.' });
    }
  }
  return missing;
}

/**
 * Deterministic pre-flight: everything that must be known before any code is generated.
 * @param {AutomationTestCase} tc
 * @param {ReadinessContext} ctx
 * @returns {MissingItem[]} Empty when the test case is ready
 */
export function assessReadiness(tc: AutomationTestCase, ctx: ReadinessContext): MissingItem[] {
  return [...stepReadiness(tc), ...modeReadiness(tc, ctx)];
}
