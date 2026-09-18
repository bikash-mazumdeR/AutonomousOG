'use strict';

/**
 * @fileoverview Application-Under-Test (AUT) profile — the ONLY place application-specific
 * configuration lives. Agents, skills, shared rules and generic learnings stay application-agnostic;
 * onboarding a new application means adding `projects/<slug>/aut-profile.json`.
 */

import * as fs from 'fs';
import { projectPaths, toProjectSlug, PROJECTS_CONFIG_ROOT } from './projectPaths';

export type AuthStrategy = 'none' | 'form' | 'storageState' | 'apiToken';
export type BrowserName = 'chromium' | 'firefox' | 'webkit';

/** @enum {string} Where test credentials live. */
export const CREDENTIAL_STORAGE = Object.freeze({
  /** Environment variable references only; values are never stored (default). */
  ENV: 'env',
  /** Stored as fixture values — for public test applications whose credentials are not secret. */
  FIXTURE: 'fixture',
} as const);
export type CredentialStorage = typeof CREDENTIAL_STORAGE[keyof typeof CREDENTIAL_STORAGE];

/** A locator the project declares for an element discovery cannot identify by itself. */
export interface ExtraLocator {
  /** camelCase page-object member name, e.g. "errorMessageContainer". */
  name: string;
  /** CSS selector that must match exactly one element in the state where the element is used. */
  css: string;
  /** What the element is, e.g. "error icon inside the username field". */
  description?: string;
}

/** AUT profile schema (projects/<slug>/aut-profile.json). */
export interface AutProfile {
  projectId: string;
  displayName: string;
  /** Name of the env var holding the base URL — the value is never stored in the profile. */
  baseUrlEnv: string;
  testIdAttribute?: string;
  browsers: BrowserName[];
  discovery: {
    entryPaths: string[];
    maxDepth: number;
    dynamicIdPatterns?: string[];
    /** Whether discovery may execute approved test-case steps against the application to reach deeper states. */
    executeTestSteps: boolean;
    /**
     * Elements discovery cannot identify on its own (no test id, role name, label or id — e.g. decorative icons or
     * styling containers). Each is added to a captured state only when its CSS selector matches exactly one element there.
     */
    extraLocators?: ExtraLocator[];
  };
  auth: {
    strategy: AuthStrategy;
    credentialEnvVars?: Record<string, string>;
    loginStateDescription?: string;
    /** Where test credentials live; defaults to "env". */
    credentialStorage?: CredentialStorage;
  };
  /**
   * Local-storage keys the application writes that tests may assert (a session expiry, for example).
   * Storage keys are application knowledge, so a generated test may only poll a key declared here.
   */
  storageKeys?: string[];
  secretsEnvVars: string[];
  api?: { basePathEnv?: string; authHeaderEnv?: string };
  performance?: { thresholdEnv?: string };
  couplingGuardTokens: string[];
}

/** Profile with runtime values resolved. */
export interface ResolvedAutProfile extends AutProfile {
  slug: string;
  /** Resolved from `baseUrlEnv`; null when the variable is not set in this environment. */
  baseURL: string | null;
}

/** Raised when a profile is missing or invalid. */
export class AutProfileError extends Error {}

const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const AUTH_STRATEGIES: AuthStrategy[] = ['none', 'form', 'storageState', 'apiToken'];
const BROWSERS: BrowserName[] = ['chromium', 'firefox', 'webkit'];

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function validateDiscovery(discovery: any, errors: string[]): void {
  if (!discovery || typeof discovery !== 'object') {
    errors.push('discovery is required');
    return;
  }
  if (!isStringArray(discovery.entryPaths) || discovery.entryPaths.length === 0 || discovery.entryPaths.some((p: string) => !p.startsWith('/'))) {
    errors.push('discovery.entryPaths must be a non-empty array of relative paths starting with "/"');
  }
  if (!Number.isInteger(discovery.maxDepth) || discovery.maxDepth < 0 || discovery.maxDepth > 10) {
    errors.push('discovery.maxDepth must be an integer between 0 and 10');
  }
  if (typeof discovery.executeTestSteps !== 'boolean') errors.push('discovery.executeTestSteps must be a boolean');
  if (discovery.dynamicIdPatterns !== undefined && !isStringArray(discovery.dynamicIdPatterns)) {
    errors.push('discovery.dynamicIdPatterns must be an array of regex strings');
  }
  if (discovery.extraLocators !== undefined) validateExtraLocators(discovery.extraLocators, errors);
}

const MEMBER_NAME = /^[a-z][A-Za-z0-9]*$/;

function validateExtraLocators(locators: unknown, errors: string[]): void {
  if (!Array.isArray(locators)) {
    errors.push('discovery.extraLocators must be an array');
    return;
  }
  const names = new Set<string>();
  locators.forEach((locator: any, idx) => {
    const label = `discovery.extraLocators[${idx}]`;
    if (typeof locator?.name !== 'string' || !MEMBER_NAME.test(locator.name)) errors.push(`${label}.name must be a camelCase identifier`);
    else if (names.has(locator.name)) errors.push(`${label}.name "${locator.name}" is declared twice`);
    else names.add(locator.name);
    if (typeof locator?.css !== 'string' || !locator.css.trim()) errors.push(`${label}.css must be a non-empty CSS selector`);
    if (locator?.description !== undefined && typeof locator.description !== 'string') errors.push(`${label}.description must be a string`);
  });
}

function validateEnvNames(values: unknown, label: string, errors: string[]): void {
  const names = Array.isArray(values) ? values : Object.values((values as Record<string, string>) || {});
  if (names.some((name) => typeof name !== 'string' || !ENV_NAME.test(name))) {
    errors.push(`${label} must contain UPPER_SNAKE_CASE environment variable names`);
  }
}

/**
 * Validates a raw profile object.
 * @param {any} raw
 * @returns {string[]} Validation errors (empty when valid)
 */
export function validateAutProfile(raw: any): string[] {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') return ['profile must be a JSON object'];
  if (typeof raw.projectId !== 'string' || !raw.projectId.trim()) errors.push('projectId is required');
  if (typeof raw.displayName !== 'string' || !raw.displayName.trim()) errors.push('displayName is required');
  if (typeof raw.baseUrlEnv !== 'string' || !ENV_NAME.test(raw.baseUrlEnv)) errors.push('baseUrlEnv must be an env var name');
  if (raw.testIdAttribute !== undefined && (typeof raw.testIdAttribute !== 'string' || !raw.testIdAttribute.trim())) {
    errors.push('testIdAttribute must be a non-empty string when set');
  }
  if (!Array.isArray(raw.browsers) || raw.browsers.length === 0 || raw.browsers.some((b: string) => !BROWSERS.includes(b as BrowserName))) {
    errors.push(`browsers must be a non-empty subset of ${BROWSERS.join(', ')}`);
  }
  validateDiscovery(raw.discovery, errors);
  if (!raw.auth || !AUTH_STRATEGIES.includes(raw.auth.strategy)) errors.push(`auth.strategy must be one of ${AUTH_STRATEGIES.join(', ')}`);
  if (raw.auth?.credentialEnvVars) validateEnvNames(raw.auth.credentialEnvVars, 'auth.credentialEnvVars', errors);
  const storages: string[] = Object.values(CREDENTIAL_STORAGE);
  if (raw.auth?.credentialStorage !== undefined && !storages.includes(raw.auth.credentialStorage)) {
    errors.push(`auth.credentialStorage must be one of ${storages.join(', ')}`);
  }
  if (raw.storageKeys !== undefined && (!isStringArray(raw.storageKeys) || raw.storageKeys.some((k) => !k.trim()))) {
    errors.push('storageKeys must be an array of non-empty local-storage key names');
  }
  if (!Array.isArray(raw.secretsEnvVars)) errors.push('secretsEnvVars must be an array');
  else validateEnvNames(raw.secretsEnvVars, 'secretsEnvVars', errors);
  if (!isStringArray(raw.couplingGuardTokens)) errors.push('couplingGuardTokens must be an array of strings');
  return errors;
}

/**
 * Loads and validates the AUT profile for a project.
 * @param {string} projectId
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {ResolvedAutProfile}
 * @throws {AutProfileError}
 */
export function loadAutProfile(projectId: string, env: NodeJS.ProcessEnv = process.env): ResolvedAutProfile {
  const { profileFile, slug } = projectPaths(projectId);
  if (!fs.existsSync(profileFile)) {
    throw new AutProfileError(`No AUT profile for project "${projectId}". Create ${profileFile} (see core/aut/AutProfile.ts for the schema).`);
  }
  let raw: any;
  try {
    raw = JSON.parse(fs.readFileSync(profileFile, 'utf-8'));
  } catch (err: any) {
    throw new AutProfileError(`AUT profile ${profileFile} is not valid JSON: ${err.message}`);
  }
  const errors = validateAutProfile(raw);
  if (errors.length > 0) throw new AutProfileError(`Invalid AUT profile ${profileFile}:\n- ${errors.join('\n- ')}`);
  const baseURL = env[raw.baseUrlEnv] && String(env[raw.baseUrlEnv]).trim() ? String(env[raw.baseUrlEnv]).trim() : null;
  return { ...(raw as AutProfile), slug, baseURL };
}

/**
 * Loads every valid profile under projects/ (used by the coupling guard).
 * @returns {AutProfile[]}
 */
export function listAutProfiles(): AutProfile[] {
  if (!fs.existsSync(PROJECTS_CONFIG_ROOT)) return [];
  return fs.readdirSync(PROJECTS_CONFIG_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      try {
        const raw = JSON.parse(fs.readFileSync(projectPaths(entry.name).profileFile, 'utf-8'));
        return validateAutProfile(raw).length === 0 ? (raw as AutProfile) : null;
      } catch {
        return null;
      }
    })
    .filter((profile): profile is AutProfile => profile !== null && toProjectSlug(profile.projectId).length > 0);
}
