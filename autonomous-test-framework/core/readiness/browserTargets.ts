'use strict';

/**
 * @fileoverview Browsers a test case explicitly targets ("… in Firefox"), mapped to Playwright engines, and the tag
 * that scopes a generated test to that browser's Playwright project. Application-agnostic.
 */

/** Playwright browser engines an AUT profile can enable. */
export const SUPPORTED_BROWSER_ENGINES: readonly string[] = Object.freeze(['chromium', 'firefox', 'webkit']);

/** Tag prefix that scopes a generated test to one browser project. */
export const BROWSER_TAG_PREFIX = '@browser-';

/** A browser named by a test case; `engine` is null when Playwright cannot run it from the AUT profile. */
export interface BrowserTarget {
  label: string;
  engine: string | null;
}

const BROWSER_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string; engine: string | null }> = [
  { pattern: /\bfire\s?fox\b/i, label: 'Firefox', engine: 'firefox' },
  { pattern: /\b(?:safari|webkit)\b/i, label: 'Safari (WebKit)', engine: 'webkit' },
  { pattern: /\b(?:google\s+)?chrom(?:e|ium)\b/i, label: 'Chrome', engine: 'chromium' },
  // "Edge" alone is also a test type and a common word ("edge case"), so only browser phrasings count
  { pattern: /\b(?:microsoft\s+edge|ms\s?edge|edge\s+browser|(?:in|on|using|with)\s+edge(?!\s*-?\s*cases?\b))\b/i, label: 'Microsoft Edge', engine: null },
];

/**
 * Browsers named in a test case's texts (title, precondition, steps).
 * @param {string[]} texts
 * @returns {BrowserTarget[]}
 */
export function targetedBrowsers(texts: string[]): BrowserTarget[] {
  const text = texts.filter(Boolean).join('\n');
  return BROWSER_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ label, engine }) => ({ label, engine }));
}

/**
 * Tag scoping a generated test to one browser engine.
 * @param {string} engine
 * @returns {string}
 */
export function browserTag(engine: string): string {
  return `${BROWSER_TAG_PREFIX}${engine}`;
}

/**
 * Matches tests tagged for any other engine; a browser project uses it as `grepInvert` so it never runs them.
 * @param {string} engine - The project's engine
 * @returns {RegExp}
 */
export function otherBrowsersPattern(engine: string): RegExp {
  const others = SUPPORTED_BROWSER_ENGINES.filter((candidate) => candidate !== engine);
  return new RegExp(`${BROWSER_TAG_PREFIX}(?:${others.join('|')})(?![\\w-])`);
}
