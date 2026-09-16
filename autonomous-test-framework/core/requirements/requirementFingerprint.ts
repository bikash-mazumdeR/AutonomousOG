'use strict';

/**
 * @fileoverview Content-addressed identity for an uploaded requirement.
 *
 * Agent 01 already has `inputFingerprint`, but that deliberately mixes the requirement text with the
 * skill file, the prompt version and resolved clarifications — it answers "must the LLM run again?".
 * This module answers a different question: "is this the same requirement we already processed?",
 * and so it hashes the requirement content and nothing else.
 *
 * Keeping the two separate matters: editing the analysis prompt should invalidate the cached
 * analysis, but it must not make an unchanged requirement look like a new version and spawn a new
 * upload file and a new set of artifacts.
 *
 * Change detection is deliberately deterministic. Normalization absorbs formatting noise — line
 * endings, trailing spaces, blank-line runs, bullet characters — so a re-save or a reformat is
 * recognised as the same requirement. Anything that survives normalization counts as a new version,
 * and a semantic summary of what changed is produced separately as advice for the human rather than
 * as a gate, so a real requirement change can never be silently swallowed.
 *
 * @module requirementFingerprint
 */

import * as crypto from 'crypto';

/** Bump when normalization changes in a way that should re-ingest previously processed requirements. */
export const REQUIREMENT_NORMALIZER_VERSION = '1';

/** Characters Markdown accepts interchangeably for an unordered list item. */
const UNORDERED_BULLET = /^(\s*)[*+•]\s+/;

/** Three or more newlines collapse to a single paragraph break. */
const BLANK_LINE_RUN = /\n{3,}/g;

/** Zero-width and BOM characters that survive copy-paste but carry no meaning. */
const INVISIBLE_CHARS = /[﻿​‌‍⁠]/g;

/**
 * Collapses formatting noise so that re-saving or reformatting a requirement does not read as a
 * change, while leaving anything that carries meaning intact.
 *
 * Intentionally conservative: runs of spaces *inside* a line are preserved, because they carry
 * meaning in Markdown tables and indented code blocks. Only whitespace that Markdown itself treats
 * as insignificant is normalized.
 *
 * @param {string} text - Raw requirement content
 * @returns {string} Normalized content
 */
export function normalizeRequirement(text: string): string {
  return String(text ?? '')
    .replace(INVISIBLE_CHARS, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, '').replace(UNORDERED_BULLET, '$1- '))
    .join('\n')
    .replace(BLANK_LINE_RUN, '\n\n')
    .trim();
}

/**
 * Stable content hash for a requirement.
 * @param {string} text - Raw requirement content
 * @returns {string} sha256 hex digest
 */
export function computeRequirementFingerprint(text: string): string {
  const payload = JSON.stringify([REQUIREMENT_NORMALIZER_VERSION, normalizeRequirement(text)]);
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Content-addressed filename for an upload.
 *
 * Naming the stored copy after its own content is what makes the uploads folder self-deduplicating:
 * re-uploading identical content resolves to the same path instead of adding a random-named twin.
 *
 * @param {string} fingerprint - Value from computeRequirementFingerprint
 * @param {string} [extension] - Including the leading dot
 * @returns {string} e.g. "3f2a…c1.md" (32 hex characters)
 */
export function uploadFileNameFor(fingerprint: string, extension = '.md'): string {
  const safeExtension = /^\.[A-Za-z0-9]{1,8}$/.test(extension) ? extension.toLowerCase() : '.md';
  return `${fingerprint.slice(0, 32)}${safeExtension}`;
}

/**
 * Whether two requirement payloads are the same after normalization.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function isSameRequirement(a: string, b: string): boolean {
  return computeRequirementFingerprint(a) === computeRequirementFingerprint(b);
}
