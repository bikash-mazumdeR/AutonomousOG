/**
 * @fileoverview Runtime environment accessor for generated tests.
 * Fails loudly when a required variable is missing — it never falls back to a default value,
 * so a misconfigured environment can never produce a misleading pass.
 */

/**
 * Returns a required environment variable.
 * @param {string} name - Environment variable name
 * @returns {string}
 * @throws {Error} When the variable is not set or empty
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Required environment variable "${name}" is not set. Configure it for this environment; never hard-code it in tests.`);
  }
  return value;
}
