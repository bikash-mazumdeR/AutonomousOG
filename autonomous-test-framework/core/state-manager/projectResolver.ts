'use strict';

/**
 * @fileoverview Single definition of "which project is the pipeline working on".
 *
 * Every agent, CLI and UI server used to carry its own copy of this lookup, and the copies did not
 * agree: Agent 01's run route skipped the lookup entirely and pinned every upload to a literal, while
 * the other stages resolved the newest run from the database. A requirement ingested through one path
 * and generated through another then landed in two different projects, and Agent 02 regenerated the
 * older requirement. One exported resolver, one ordering — never a second copy.
 *
 * @module ProjectResolver
 */

import { stateDb } from './Database';

/** Last-resort project id, used only when the state database holds no real run at all. */
export const DEFAULT_PROJECT_ID = 'ARIA Project';

/** Runs created by the unit test suite; never a real project. */
const TEST_RUN_FILTER = "project_id NOT LIKE 'test-unit-%' AND project_id NOT LIKE 'test-%'";

/**
 * Newest real run first, ordered by last activity rather than creation time: the run a stage just
 * wrote to is the one being worked on, even when an idle run was created more recently.
 */
export const LATEST_RUN_ORDER = 'ORDER BY COALESCE(updated_at, started_at) DESC, started_at DESC LIMIT 1';

/** Project id of the most recently active real run. */
export const LATEST_PROJECT_SQL = `SELECT project_id FROM runs WHERE ${TEST_RUN_FILTER} ${LATEST_RUN_ORDER}`;

/** Full row of the most recently active real run. */
export const LATEST_RUN_SQL = `SELECT * FROM runs WHERE ${TEST_RUN_FILTER} ${LATEST_RUN_ORDER}`;

/** Most recently active run of one project, by exact id then case-insensitively. */
export const LATEST_RUN_FOR_PROJECT_SQL = `SELECT * FROM runs WHERE project_id = ? ${LATEST_RUN_ORDER}`;
export const LATEST_RUN_FOR_PROJECT_CI_SQL = `SELECT * FROM runs WHERE LOWER(project_id) = LOWER(?) ${LATEST_RUN_ORDER}`;

/**
 * The project id of the most recently active real run.
 * @returns {string|null} null when the database is unreadable or holds no real run
 */
export function latestProjectId(): string | null {
  try {
    stateDb.initialize();
    const row = stateDb.prepare(LATEST_PROJECT_SQL).get() as { project_id?: string } | undefined;
    return row?.project_id || null;
  } catch {
    // The database may not exist yet on a first run; the caller's fallback applies.
    return null;
  }
}

/**
 * Resolves the project a stage should run against: the caller's explicit value, else the most
 * recently active run, else the fallback. Every entry point — agent CLI, UI route, orchestrator —
 * must resolve through this function so they cannot disagree.
 * @param {string|null} [requested] - Explicit project id (CLI flag, request body, form field)
 * @param {string} [fallback=DEFAULT_PROJECT_ID] - Used only when no real run exists
 * @returns {string}
 */
export function resolveProjectId(requested?: string | null, fallback: string = DEFAULT_PROJECT_ID): string {
  const trimmed = String(requested || '').trim();
  if (trimmed) return trimmed;
  return latestProjectId() || fallback;
}
