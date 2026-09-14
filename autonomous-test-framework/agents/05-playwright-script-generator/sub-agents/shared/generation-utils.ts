'use strict';

/**
 * @fileoverview Shared helpers for Agent 05 sub-agents: routing, chunking, JSON parsing and prompt loading.
 * Prompts come only from skill files and learnings (generic, then project-scoped) — no rule text lives in code.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  API_TYPES, PERF_TYPES, SKILLS_DIR, GENERIC_LEARNINGS_DIR, SKILL_FILES, GENERIC_LEARNINGS_FILES,
  PROJECT_LEARNINGS_FILES, GenerationMode,
} from '../../constants';

const PROJECT_NOTES_HEADING = '# Project notes (lower authority than the approved test case and the page contract)';

/**
 * Splits an array into chunks of at most `size` items.
 * @param {T[]} items
 * @param {number} size
 * @returns {T[][]}
 */
export function chunkArray<T>(items: T[], size: number): T[][] {
  if (!items || items.length === 0) return [];
  const chunkSize = Math.max(1, size);
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) chunks.push(items.slice(i, i + chunkSize));
  return chunks;
}

/**
 * Routes test cases to UI, API or performance generation by type.
 * @param {any[]} testCases
 * @returns {{ uiTCs: any[], apiTCs: any[], perfTCs: any[] }}
 */
export function partitionByType(testCases: any[] = []): { uiTCs: any[]; apiTCs: any[]; perfTCs: any[] } {
  const uiTCs: any[] = [];
  const apiTCs: any[] = [];
  const perfTCs: any[] = [];
  for (const tc of testCases || []) {
    const type = String(tc.type || '').toLowerCase();
    if (PERF_TYPES.has(type)) perfTCs.push(tc);
    else if (API_TYPES.has(type)) apiTCs.push(tc);
    else uiTCs.push(tc);
  }
  return { uiTCs, apiTCs, perfTCs };
}

/**
 * Parses the first JSON object in an LLM response (code fences tolerated).
 * @param {string} text
 * @returns {any}
 * @throws {Error} When no JSON object can be parsed
 */
export function parseJsonObject(text: string): any {
  const cleaned = String(text || '').replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object found');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function readRequired(file: string): string {
  if (!fs.existsSync(file)) throw new Error(`Agent 05 prompt file not found: ${file}`);
  return fs.readFileSync(file, 'utf-8');
}

function readOptional(file: string): string {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
}

function projectNotes(projectLearningsDir: string | null | undefined, fileName: string): string {
  if (!projectLearningsDir) return '';
  const notes = readOptional(path.join(projectLearningsDir, fileName));
  return notes ? `${PROJECT_NOTES_HEADING}\n\n${notes}` : '';
}

/**
 * System prompt for body generation: shared contract + mode addendum + generic learnings + project notes.
 * @param {GenerationMode} mode
 * @param {string|null} [projectLearningsDir]
 * @returns {string}
 */
export function loadGenerationPrompt(mode: GenerationMode, projectLearningsDir?: string | null): string {
  return [
    readRequired(path.join(SKILLS_DIR, SKILL_FILES.SHARED)),
    readRequired(path.join(SKILLS_DIR, SKILL_FILES[mode])),
    readOptional(path.join(GENERIC_LEARNINGS_DIR, GENERIC_LEARNINGS_FILES[mode])),
    projectNotes(projectLearningsDir, PROJECT_LEARNINGS_FILES[mode]),
  ].filter(Boolean).join('\n\n---\n\n');
}

/**
 * System prompt for the discovery navigation planner.
 * @param {string|null} [projectLearningsDir]
 * @returns {string}
 */
export function loadDiscoveryPrompt(projectLearningsDir?: string | null): string {
  return [
    readRequired(path.join(SKILLS_DIR, SKILL_FILES.DISCOVERY)),
    projectNotes(projectLearningsDir, PROJECT_LEARNINGS_FILES.UI),
  ].filter(Boolean).join('\n\n---\n\n');
}
