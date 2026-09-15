'use strict';

/**
 * @fileoverview Environment variable naming shared by the stages that bind runtime values (Agents 04 and 05).
 * Credentials and secrets are always referenced by environment variable name; their values are never stored.
 */

/** A valid environment variable name (UPPER_SNAKE_CASE). */
export const ENV_VAR_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/**
 * Conventional environment variable name for a runtime placeholder ("validPassword" → "ARIA_VALID_PASSWORD").
 * @param {string} placeholder - Placeholder name without braces
 * @returns {string}
 */
export function toEnvVarName(placeholder: string): string {
  return `ARIA_${placeholder.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}`;
}

/**
 * Whether a value is an environment variable name.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isEnvVarName(value: unknown): value is string {
  return typeof value === 'string' && ENV_VAR_NAME_PATTERN.test(value.trim()) && value.trim() === value;
}
