'use strict';

/**
 * @fileoverview Recognises replies that do not answer a clarification ("Skip", "N/A", "?"). Recording such a reply as an
 * answer would mark the question resolved while the gap it asked about stays in the requirement or test case.
 */

/** Replies that decline to answer rather than answer (compared case-insensitively, ignoring punctuation). */
const NON_ANSWERS: ReadonlySet<string> = new Set([
  'skip', 'skipped', 'skip it', 'skip this', 'pass', 'ignore', 'ignored', 'later', 'next',
  'na', 'n a', 'none', 'nil', 'null', 'nothing', 'no answer', 'not applicable',
  'tbd', 'tba', 'todo', 'to do', 'unknown', 'not known', 'idk', 'i dont know', 'i do not know', 'dont know', 'do not know',
  'not sure', 'unsure', 'no idea', 'x', 'test', 'asdf',
  // A decision, not an answer: use the "Mark as Manual Test" action instead of typing it as the expected result.
  'manual', 'mark manual', 'marked manual', 'mark as manual', 'marked as manual', 'make it manual', 'manual test',
]);

/**
 * Whether a reply declines to answer (empty, punctuation only, or a known non-answer such as "Skip" or "N/A").
 * "Yes" and "No" are real answers and are not rejected.
 * @param {unknown} reply
 * @returns {boolean}
 */
export function isNonAnswer(reply: unknown): boolean {
  const normalized = String(reply ?? '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  return normalized === '' || NON_ANSWERS.has(normalized);
}

/**
 * Message explaining why a reply was not recorded, and what to do instead.
 * @param {string} reply
 * @param {string} alternative - How to decline in this stage (e.g. "dismiss the question")
 * @returns {string}
 */
export function nonAnswerMessage(reply: string, alternative: string): string {
  return `"${String(reply).trim()}" does not answer the question, so it was not recorded as an answer. `
    + `Give the actual information, or ${alternative}.`;
}
