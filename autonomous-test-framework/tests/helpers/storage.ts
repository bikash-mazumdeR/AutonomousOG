'use strict';

/**
 * @fileoverview Browser-storage accessors for generated tests.
 *
 * Some application state is never rendered in the DOM — how long a remembered session stays valid, for example —
 * so no locator can observe it and no web-first assertion can target it. These helpers expose such a value so an
 * assertion can poll it, without loosening the rule that assertions come from the approved test case: the storage
 * key is always passed in by the test, never inferred here.
 */

import { Page } from '@playwright/test';

/** Milliseconds in a day. */
const DAY_MS = 86400000;

/**
 * Value the application stored under a local-storage key.
 * @param {Page} page - Page whose origin owns the storage
 * @param {string} key - Storage key stated by the test case
 * @returns {Promise<string|null>} The stored value, or null when the key is absent
 */
export async function storedValue(page: Page, key: string): Promise<string | null> {
  return page.evaluate((name: string) => globalThis.localStorage.getItem(name), key);
}

/**
 * Whole days from now until the epoch-milliseconds timestamp stored under a key. Rounded, so a value written a
 * moment ago for "30 days" reads as 30 rather than 29.9.
 * @param {Page} page - Page whose origin owns the storage
 * @param {string} key - Storage key stated by the test case
 * @returns {Promise<number|null>} Days remaining, or null when the key is absent or not a timestamp
 */
export async function storedDaysFromNow(page: Page, key: string): Promise<number | null> {
  const raw = await storedValue(page, key);
  if (raw === null) return null;
  const expiresAt = Number(raw);
  return Number.isFinite(expiresAt) ? Math.round((expiresAt - Date.now()) / DAY_MS) : null;
}
