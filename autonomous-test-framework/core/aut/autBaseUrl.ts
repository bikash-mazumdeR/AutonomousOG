'use strict';

/**
 * @fileoverview Environment loading and base-URL resolution for the application under test, independent of the
 * working directory. Tests never fall back to a default URL: a missing base URL would point the browser at whatever
 * happens to run locally (for example the ARIA UI) and every test would fail for the wrong reason.
 */

import * as path from 'path';
import * as dotenv from 'dotenv';
import { FRAMEWORK_ROOT } from './projectPaths';

/** The framework's .env file, resolved from the framework root rather than the current working directory. */
export const FRAMEWORK_ENV_FILE = path.join(FRAMEWORK_ROOT, '.env');

/** Env var holding the base URL when the AUT profile names none. */
export const DEFAULT_BASE_URL_ENV = 'AUT_BASE_URL';

/**
 * Loads the framework .env wherever the process was started from (IDE, workspace root, CI). Variables already set in
 * the environment win.
 */
export function loadFrameworkEnv(): void {
  dotenv.config({ path: FRAMEWORK_ENV_FILE });
}

/**
 * Base URL of the application under test: the AUT profile's variable first, then AUT_BASE_URL.
 * @param {string} [baseUrlEnv] - Env var named by the AUT profile
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 * @throws {Error} When no base URL is configured
 */
export function resolveAutBaseUrl(baseUrlEnv?: string, env: NodeJS.ProcessEnv = process.env): string {
  const names = [...new Set([baseUrlEnv, DEFAULT_BASE_URL_ENV].filter((name): name is string => Boolean(name)))];
  const value = names.map((name) => String(env[name] || '').trim()).find(Boolean);
  if (value) return value;
  throw new Error(`No base URL for the application under test: set ${names.join(' or ')} in ${FRAMEWORK_ENV_FILE} or in the environment. `
    + 'Tests never fall back to a default URL.');
}
