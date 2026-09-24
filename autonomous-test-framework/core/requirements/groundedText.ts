'use strict';

/**
 * @fileoverview Concrete claims in generated text and whether a source grounds them. Shared by the agents that must not
 * state what their input does not: Agent 01 checks its analysis against the requirement document, Agent 02 checks its
 * scenarios against the story, and the eval suites score both the same way.
 */

const QUOTED = [/"([^"\n]{2,}?)"/g, /“([^”\n]{2,}?)”/g, /‘([^’\n]{2,}?)’/g, /(?<![A-Za-z0-9])'([^'\n]{2,}?)'(?![A-Za-z0-9])/g];
const URL = /https?:\/\/[^\s'"`)<>\]]+/g;
const NUMBER = /(?<![\w.-])\d{2,}(?:[.,]\d+)?%?(?![\w-])|(?<![\w.-])\d+[.,]\d+%?(?![\w-])/g;
const PLACEHOLDER_TOKEN = /^\{\{\w+\}\}$/;
const NUMERIC_CLAIM = /^\d+(?:[.,]\d+)?%?$/;

/**
 * Lower-case, one space, straight quotes and hyphens, so formatting differences are not reported as inventions.
 * @param {string} text
 * @returns {string}
 */
export function normalizeForMatch(text: string): string {
  return String(text || '')
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Concrete claims in a statement: quoted text, URLs and numbers of two or more digits (or with a decimal part).
 * A single digit is left out: "one character" is legitimately restated as "1 character".
 * @param {string} text
 * @returns {string[]}
 */
export function concreteClaims(text: string): string[] {
  const claims = new Set<string>();
  for (const pattern of QUOTED) for (const match of text.matchAll(pattern)) claims.add(match[1].trim());
  // A trailing slash does not change the address: "https://a.test/" is the "https://a.test" the document names.
  for (const match of text.matchAll(URL)) claims.add(match[0].replace(/[.,;:]+$/, '').replace(/(?<=[^/])\/$/, ''));
  const withoutUrls = text.replace(URL, ' ');
  for (const match of withoutUrls.matchAll(NUMBER)) claims.add(match[0]);
  return [...claims].filter((claim) => claim && !PLACEHOLDER_TOKEN.test(claim));
}

/**
 * Every number a text states.
 * @param {string} text
 * @returns {number[]}
 */
export function numbersIn(text: string): number[] {
  return (String(text || '').match(/\d+(?:\.\d+)?/g) || []).map(Number);
}

/**
 * Whether a source grounds a concrete claim: it contains the claim, or the claim is a number at most one away from a
 * number the source states — the boundary value an edge case tests (a 64-character limit tested with 65).
 * @param {string} claim
 * @param {string} source - Text already passed through normalizeForMatch
 * @param {number[]} sourceNumbers - numbersIn(source)
 * @returns {boolean}
 */
export function isGroundedClaim(claim: string, source: string, sourceNumbers: number[]): boolean {
  if (source.includes(normalizeForMatch(claim))) return true;
  if (!NUMERIC_CLAIM.test(claim)) return false;
  const value = Number(claim.replace(',', '.').replace('%', ''));
  return sourceNumbers.some((n) => Math.abs(n - value) <= 1);
}
