'use strict';

/**
 * @fileoverview Human edits of Agent 04 test data with one source of truth: every edit updates the manifest AND the
 * enriched test case Agent 05 binds from (`resolvedData.inputs`), then recounts. Credentials may only be set as
 * environment variable names.
 */

import { buildFlatTestData } from '../../core/state-manager/FixtureSync';
import { isEnvVarName } from '../../core/aut/envVarNames';
import { RUNTIME_TYPE, VALUE_SOURCE } from './constants';
import { RUNTIME_SENTINEL, VALUE_CLASS } from './placeholderIntent';
import { ValueEntry, effectiveValueClass, inferDataType } from './valuePolicy';

/** @enum {string} Kinds of edit the Agent 04 UI sends. */
export const EDIT_TYPE = Object.freeze({
  SINGLE_TC: 'single_tc',
  GLOBAL: 'global',
  FULL_FLAT: 'full_flat',
} as const);

/** A value a human changed. */
export interface DataChange {
  name: string;
  /** Absent when the change applies to every test case using the placeholder. */
  tcKey?: string;
  value?: unknown;
  envVar?: string;
}

/** Result of an edit; nothing is changed when `errors` is not empty. */
export interface EditOutcome {
  changes: DataChange[];
  errors: string[];
  /** Keys that match no placeholder or are generated boundary constants. */
  ignored: string[];
}

/** Project settings that change what an edit may set. */
export interface EditOptions {
  /** Credentials may be set as values (AUT profile `auth.credentialStorage: "fixture"`). */
  credentialsInFixture?: boolean;
}

/** Input totals of a manifest. */
export interface InputSummary {
  resolvedCount: number;
  unresolvedCount: number;
  sensitiveRefs: string[];
  runtimeBindings: Array<{ placeholder: string; envVar: string }>;
}

interface PlannedEdit {
  tcKey: string;
  name: string;
  entry: ValueEntry;
  global: boolean;
}

const PLACEHOLDER_TOKEN = /\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g;
const FLAT_TEST_CASE_KEY = /^([A-Za-z0-9]+)_([A-Za-z][A-Za-z0-9]*)$/;
const BOUNDARY_KEY = /^(string|number)[A-Z]/;
const UI_NOTE = 'Set in the Agent 04 UI';

const toToken = (name: string): string => `{{${name}}}`;
const cleanName = (key: string): string => String(key).replace(/^\{\{|\}\}$/g, '');
const flatTestCaseKey = (tcKey: string): string => tcKey.replace(/[^a-zA-Z0-9]/g, '');

/**
 * Whether an input is read from an environment variable at runtime.
 * @param {any} entry
 * @returns {boolean}
 */
export function isBoundToEnvironment(entry: any): boolean {
  return Boolean(entry?.sensitive) || entry?.source === VALUE_SOURCE.RUNTIME;
}

function unwrap(raw: unknown): unknown {
  return raw !== null && typeof raw === 'object' && 'value' in (raw as Record<string, unknown>) ? (raw as Record<string, unknown>).value : raw;
}

function isUnchanged(existing: any, value: unknown): boolean {
  if (!existing) return false;
  if (existing.envVar !== undefined && value === existing.envVar) return true;
  return JSON.stringify(existing.value) === JSON.stringify(value);
}

function overrideEntry(name: string, value: unknown, options: EditOptions): { entry?: ValueEntry; error?: string } {
  const valueClass = effectiveValueClass(name, Boolean(options.credentialsInFixture));
  if (valueClass !== VALUE_CLASS.RUNTIME) {
    return { entry: { value, type: inferDataType(name, value), sensitive: false, source: VALUE_SOURCE.USER_OVERRIDE, note: UI_NOTE, valueClass } };
  }
  if (!isEnvVarName(value)) {
    return { error: `{{${name}}} is a credential or secret: enter the name of the environment variable that holds it, not its value.` };
  }
  return {
    entry: {
      value: RUNTIME_SENTINEL, type: RUNTIME_TYPE, sensitive: true, source: VALUE_SOURCE.RUNTIME, origin: VALUE_SOURCE.USER_OVERRIDE, envVar: value, note: UI_NOTE, valueClass,
    },
  };
}

function newOutcome(): EditOutcome {
  return { changes: [], errors: [], ignored: [] };
}

function planInputs(testData: any, tcKey: string, inputs: Record<string, unknown>, outcome: EditOutcome, global: boolean, options: EditOptions): PlannedEdit[] {
  const tcData = testData?.manifest?.perTCData?.[tcKey];
  if (!tcData) {
    outcome.errors.push(`No test data for ${tcKey}.`);
    return [];
  }
  const planned: PlannedEdit[] = [];
  for (const [key, raw] of Object.entries(inputs || {})) {
    const name = cleanName(key);
    const value = unwrap(raw);
    if (isUnchanged(tcData.inputs?.[toToken(name)], value)) continue;
    const { entry, error } = overrideEntry(name, value, options);
    if (entry) planned.push({ tcKey, name, entry, global });
    else outcome.errors.push(`${tcKey}: ${error}`);
  }
  return planned;
}

/**
 * Applies resolved values to a test case's steps and attaches its resolved data.
 * @param {any} tc - Test case with its original `{{placeholder}}` steps
 * @param {any} tcData - perTCData entry
 * @returns {any}
 */
export function injectResolvedData(tc: any, tcData: any): any {
  if (!tcData) return tc;
  const steps = (tc.testSteps || []).map((step: any) => ({
    ...step,
    testData: String(step.testData || '').replace(PLACEHOLDER_TOKEN, (match) => {
      const entry = tcData.inputs?.[match];
      const literal = entry && entry.source !== VALUE_SOURCE.UNRESOLVED && !isBoundToEnvironment(entry);
      return literal ? String(entry.value) : match;
    }),
  }));
  return { ...tc, testSteps: steps, resolvedData: tcData, dataManifestId: `tdm_ref_${tc.key}` };
}

/**
 * Totals and runtime bindings of per-test-case inputs.
 * @param {Record<string, any>} perTCData
 * @returns {InputSummary}
 */
export function summarizeInputs(perTCData: Record<string, any>): InputSummary {
  const entries = Object.values(perTCData || {}).flatMap((tcData: any) => Object.entries(tcData?.inputs || {}) as Array<[string, any]>);
  const bound = entries.filter(([, entry]) => isBoundToEnvironment(entry));
  const bindings = new Map(bound.filter(([, entry]) => entry.envVar).map(([token, entry]) => [`${token}|${entry.envVar}`, { placeholder: token, envVar: entry.envVar }]));
  return {
    resolvedCount: entries.filter(([, entry]) => entry?.source !== VALUE_SOURCE.UNRESOLVED).length,
    unresolvedCount: entries.filter(([, entry]) => entry?.source === VALUE_SOURCE.UNRESOLVED).length,
    sensitiveRefs: [...new Set(bound.map(([token]) => token))].sort(),
    runtimeBindings: [...bindings.values()].sort((a, b) => a.placeholder.localeCompare(b.placeholder)),
  };
}

/**
 * Recomputes counts, unresolved lists and runtime bindings after an edit.
 * @param {any} testData - Agent 04 artifact (updated in place)
 */
export function recountTestData(testData: any): void {
  const manifest = testData.manifest;
  const perTCData = manifest.perTCData || {};
  for (const tcData of Object.values(perTCData) as any[]) {
    tcData.unresolved = Object.entries(tcData.inputs || {}).filter(([, entry]: [string, any]) => entry?.source === VALUE_SOURCE.UNRESOLVED).map(([token]) => token);
  }
  const summary = summarizeInputs(perTCData);
  Object.assign(manifest, { resolvedCount: summary.resolvedCount, unresolvedCount: summary.unresolvedCount, runtimeBindings: summary.runtimeBindings });
  manifest.sensitiveDataVault = { ...(manifest.sensitiveDataVault || {}), refs: summary.sensitiveRefs };
  manifest.unresolvedPlaceholders = (manifest.unresolvedPlaceholders || [])
    .filter((item: any) => perTCData[item.tcKey]?.inputs?.[item.placeholder]?.source === VALUE_SOURCE.UNRESOLVED);
  if (testData.summary) {
    Object.assign(testData.summary, { resolvedCount: summary.resolvedCount, unresolvedCount: summary.unresolvedCount, sensitiveRefs: summary.sensitiveRefs.length });
  }
}

function refreshEnrichedTestCase(testData: any, tcKey: string, rawTestCases: any[]): void {
  const list = testData.enrichedZephyrExport?.testCases;
  const index = Array.isArray(list) ? list.findIndex((tc: any) => tc.key === tcKey) : -1;
  if (index === -1) return;
  const tcData = testData.manifest.perTCData[tcKey];
  const raw = rawTestCases.find((tc) => tc.key === tcKey);
  list[index] = raw ? { ...list[index], ...injectResolvedData(raw, tcData) } : { ...list[index], resolvedData: tcData };
}

function commit(testData: any, planned: PlannedEdit[], outcome: EditOutcome, rawTestCases: any[]): EditOutcome {
  if (outcome.errors.length > 0) return outcome;
  const touched = new Set<string>();
  const globalChanges = new Set<string>();
  for (const { tcKey, name, entry, global } of planned) {
    testData.manifest.perTCData[tcKey].inputs[toToken(name)] = entry;
    touched.add(tcKey);
    const change = { name, value: entry.envVar ? undefined : entry.value, envVar: entry.envVar };
    if (!global) outcome.changes.push({ ...change, tcKey });
    else if (!globalChanges.has(name)) outcome.changes.push(change);
    if (global) globalChanges.add(name);
  }
  touched.forEach((tcKey) => refreshEnrichedTestCase(testData, tcKey, rawTestCases));
  recountTestData(testData);
  return outcome;
}

/**
 * Sets inputs of one test case.
 * @param {any} testData - Agent 04 artifact (updated in place unless the outcome has errors)
 * @param {string} tcKey
 * @param {Record<string, unknown>} inputs - Placeholder name (with or without braces) → value, or env var name for a credential
 * @param {any[]} [rawTestCases] - Agent 03 test cases, to re-apply values to the original steps
 * @param {EditOptions} [options]
 * @returns {EditOutcome}
 */
export function applyInputOverride(testData: any, tcKey: string, inputs: Record<string, unknown>, rawTestCases: any[] = [], options: EditOptions = {}): EditOutcome {
  const outcome = newOutcome();
  return commit(testData, planInputs(testData, tcKey, inputs, outcome, false, options), outcome, rawTestCases);
}

function planGlobal(testData: any, values: Record<string, unknown>, outcome: EditOutcome, options: EditOptions): PlannedEdit[] {
  const perTCData = testData?.manifest?.perTCData || {};
  const planned: PlannedEdit[] = [];
  for (const [key, raw] of Object.entries(values || {})) {
    const name = cleanName(key);
    const users = Object.keys(perTCData).filter((tcKey) => perTCData[tcKey]?.inputs?.[toToken(name)]);
    if (users.length === 0) outcome.ignored.push(name);
    users.forEach((tcKey) => planned.push(...planInputs(testData, tcKey, { [name]: raw }, outcome, true, options)));
  }
  return planned;
}

/**
 * Sets a placeholder's value for every test case that uses it.
 * @param {any} testData - Agent 04 artifact (updated in place unless the outcome has errors)
 * @param {Record<string, unknown>} values - Placeholder name → value, or env var name for a credential
 * @param {any[]} [rawTestCases]
 * @param {EditOptions} [options]
 * @returns {EditOutcome}
 */
export function applyGlobalOverride(testData: any, values: Record<string, unknown>, rawTestCases: any[] = [], options: EditOptions = {}): EditOutcome {
  const outcome = newOutcome();
  return commit(testData, planGlobal(testData, values, outcome, options), outcome, rawTestCases);
}

/**
 * Applies an edited flat fixture: `<TCKEY>_<name>` keys change that test case, root keys change every test case using
 * the placeholder, generated boundary constants are ignored.
 * @param {any} testData - Agent 04 artifact (updated in place unless the outcome has errors)
 * @param {Record<string, unknown>} flat - Edited flat fixture
 * @param {any[]} [rawTestCases]
 * @param {EditOptions} [options]
 * @returns {EditOutcome}
 */
export function applyFlatOverride(testData: any, flat: Record<string, unknown>, rawTestCases: any[] = [], options: EditOptions = {}): EditOutcome {
  const outcome = newOutcome();
  const current = buildFlatTestData(testData?.manifest);
  const tcKeyByFlatKey = new Map(Object.keys(testData?.manifest?.perTCData || {}).map((tcKey) => [flatTestCaseKey(tcKey), tcKey]));
  const perTestCase = new Map<string, Record<string, unknown>>();
  const global: Record<string, unknown> = {};
  for (const [flatKey, value] of Object.entries(flat || {})) {
    if (JSON.stringify(current[flatKey]) === JSON.stringify(value)) continue;
    const match = flatKey.match(FLAT_TEST_CASE_KEY);
    const tcKey = match ? tcKeyByFlatKey.get(match[1]) : undefined;
    if (match && tcKey) perTestCase.set(tcKey, { ...(perTestCase.get(tcKey) || {}), [match[2]]: value });
    else if (BOUNDARY_KEY.test(flatKey) && flatKey in current) outcome.ignored.push(flatKey);
    else global[flatKey] = value;
  }
  const planned = [...perTestCase].flatMap(([tcKey, inputs]) => planInputs(testData, tcKey, inputs, outcome, false, options));
  return commit(testData, [...planned, ...planGlobal(testData, global, outcome, options)], outcome, rawTestCases);
}
