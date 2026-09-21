'use strict';

/**
 * @fileoverview Centralized Fixture Sync Engine for the ARIA framework.
 * Flattens the Agent 04 test data manifest into a key/value JSON fixture.
 *
 * Application-agnostic: values come ONLY from the manifest (or values explicitly passed by the
 * caller). No application URLs, credentials or messages are hard-coded here. Sensitive or
 * runtime-only values are never written to disk.
 *
 * @module FixtureSync
 */

import * as fs from 'fs';
import * as path from 'path';


interface ManifestInput {
  value?: unknown;
  sensitive?: boolean;
  source?: string;
}

function isPersistable(entry: ManifestInput | undefined): boolean {
  return !!entry && entry.value !== undefined && !entry.sensitive
    && entry.source !== 'runtime' && entry.source !== 'unresolved';
}

function cleanPlaceholder(placeholder: string): string {
  return placeholder.replace(/^\{\{|\}\}$/g, '');
}

function sharedPlaceholderValues(perTCData: Record<string, any>): Map<string, unknown> {
  const seen = new Map<string, { count: number; values: Set<string>; value: unknown }>();
  for (const tcData of Object.values(perTCData)) {
    for (const [placeholder, entry] of Object.entries((tcData as any)?.inputs || {})) {
      if (!isPersistable(entry as ManifestInput)) continue;
      const key = cleanPlaceholder(placeholder);
      const current = seen.get(key) || { count: 0, values: new Set<string>(), value: (entry as ManifestInput).value };
      current.count += 1;
      current.values.add(JSON.stringify((entry as ManifestInput).value));
      seen.set(key, current);
    }
  }
  const shared = new Map<string, unknown>();
  for (const [key, meta] of seen.entries()) {
    if (meta.count > 1 && meta.values.size === 1) shared.set(key, meta.value);
  }
  return shared;
}

/**
 * Builds a flat key/value fixture from an Agent 04 manifest.
 * - Values the manifest recorded from the requirement (`requirementValues`) are written first.
 * - Placeholders used by several test cases with the same value are promoted to a root key.
 * - Other values are stored per test case as `<TCKEY>_<placeholder>` (e.g. `TC004_validName`).
 * - Sensitive, runtime and unresolved entries are skipped.
 * - Generic boundary primitives are included for edge-case tests.
 * @param {any} manifest - Agent 04 manifest (`perTCData`, optional `requirementValues`)
 * @param {Record<string, any>} [explicitValues] - Caller-provided values; override requirement values
 * @returns {Record<string, any>}
 */
export function buildFlatTestData(manifest: any, explicitValues?: Record<string, any>): Record<string, any> {
  const flat: Record<string, any> = { ...(manifest?.requirementValues || {}), ...(explicitValues || {}) };
  const perTCData: Record<string, any> = manifest?.perTCData || {};

  for (const [key, value] of sharedPlaceholderValues(perTCData).entries()) {
    if (!(key in flat)) flat[key] = value;
  }

  for (const [tcKey, tcData] of Object.entries(perTCData)) {
    for (const [placeholder, entry] of Object.entries((tcData as any)?.inputs || {})) {
      const key = cleanPlaceholder(placeholder);
      if (key in flat || !isPersistable(entry as ManifestInput)) continue;
      const formattedKey = `${tcKey.replace(/[^a-zA-Z0-9]/g, '')}_${key}`;
      if (!(formattedKey in flat)) flat[formattedKey] = (entry as ManifestInput).value;
    }
  }

  Object.assign(flat, {
    stringMin: 'A',
    stringUnderMin: '',
    stringLong: 'A'.repeat(1001),
    stringSpecialChars: '#%&<>!@$^*()',
    stringUnicode: '🚀 中文 العربية Ñ',
    stringWhitespace: '   ',
    numberMin: 0,
    numberMax: 2147483647,
    numberUnderMin: -1,
    numberOverMax: 2147483648,
    numberZero: 0,
    numberNegative: -999,
    numberDecimal: 0.001,
  });
  return flat;
}

/**
 * Saves flat test data to a fixture file.
 * @param {any} testDataArtifact - Agent 04 artifact (or its manifest)
 * @param {Record<string, any>} [explicitValues]
 * @param {string} targetPath - The project's fixture file; there is no shared default, because a
 *   fixture file belongs to exactly one project and must never be written outside it.
 * @returns {Record<string, any>}
 */
export function syncFixturesFileFromTestData(
  testDataArtifact: any,
  explicitValues: Record<string, any> | undefined,
  targetPath: string,
): Record<string, any> {
  const manifest = testDataArtifact?.manifest || testDataArtifact || {};
  return writeFixtureFile(targetPath, buildFlatTestData(manifest, explicitValues));
}

/**
 * The only writer of a project's fixture file. Merges into what is already there: one file serves
 * every requirement of the project, and its specs import it by key, so a requirement that defines
 * fewer keys must not delete the keys another requirement's generated tests depend on.
 *
 * @param {string} targetPath - The project's fixture file
 * @param {Record<string, any>} values - Values this requirement contributes; they win on a clash
 * @returns {Record<string, any>} The merged contents, as written
 */
export function writeFixtureFile(targetPath: string, values: Record<string, any>): Record<string, any> {
  let existing: Record<string, any> = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) existing = parsed;
  } catch {
    // No fixture file yet, or one this framework did not write: start from the given values alone.
  }
  const merged = { ...existing, ...values };
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf-8');
  return merged;
}

/**
 * Ensures a fixture file exists on disk, rebuilding it from the Agent 04 artifact when missing.
 * @param {any} stateManager
 * @param {string} targetPath - The project's fixture file
 * @returns {Promise<Record<string, any>>}
 */
export async function ensureFixturesFileSynced(
  stateManager: any,
  targetPath: string,
): Promise<Record<string, any>> {
  if (fs.existsSync(targetPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
      if (existing && Object.keys(existing).length > 0) return existing;
    } catch {
      // Invalid JSON — rebuild below.
    }
  }
  const testData = await stateManager.getPipelineArtifact('testData');
  return syncFixturesFileFromTestData(testData, undefined, targetPath);
}
