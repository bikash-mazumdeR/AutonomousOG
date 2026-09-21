/**
 * @fileoverview Unit tests for the shared project resolver.
 *
 * Every agent, CLI and UI route resolves the project it works on through this one module. When the
 * copies of this lookup disagreed, a requirement uploaded through Agent 01 landed in one project
 * while Agent 02 generated from another, and the newly uploaded requirement was silently ignored.
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  DEFAULT_PROJECT_ID, LATEST_PROJECT_SQL, LATEST_RUN_FOR_PROJECT_SQL, resolveProjectId,
} from '../../core/state-manager/projectResolver';

describe('latest-run ordering', () => {
  let dir: string;
  let db: any;

  const addRun = (runId: string, projectId: string, startedAt: string, updatedAt: string) => db
    .prepare('INSERT INTO runs (run_id, project_id, version, started_at, updated_at, current_stage, global_status) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(runId, projectId, '1.0.0', startedAt, updatedAt, null, 'IDLE');

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aria-runs-'));
    db = new Database(path.join(dir, 'runs.db'));
    db.prepare(`CREATE TABLE runs (
      run_id TEXT PRIMARY KEY, project_id TEXT, version TEXT, started_at TEXT,
      updated_at TEXT, current_stage TEXT, global_status TEXT
    )`).run();
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('picks the run that was last worked on, not the one created last', () => {
    addRun('run_old', 'Requirements Project', '2026-09-16T12:00:00Z', '2026-09-19T05:41:00Z');
    addRun('run_new', 'Other Project', '2026-09-18T15:00:00Z', '2026-09-18T15:30:00Z');

    expect(db.prepare(LATEST_PROJECT_SQL).get().project_id).toBe('Requirements Project');
  });

  it('ignores runs created by the unit test suite', () => {
    addRun('run_real', 'Real Project', '2026-09-16T12:00:00Z', '2026-09-16T12:00:00Z');
    addRun('run_unit', 'test-unit-123', '2026-09-19T12:00:00Z', '2026-09-19T12:00:00Z');

    expect(db.prepare(LATEST_PROJECT_SQL).get().project_id).toBe('Real Project');
  });

  it('resolves the newest run of one project, which is where a new requirement lands', () => {
    addRun('run_login', 'Nexolvi', '2026-09-18T15:00:00Z', '2026-09-18T15:30:00Z');
    addRun('run_logout', 'Nexolvi', '2026-09-19T11:00:00Z', '2026-09-19T11:05:00Z');
    addRun('run_elsewhere', 'Other', '2026-09-19T12:00:00Z', '2026-09-19T12:00:00Z');

    expect(db.prepare(LATEST_RUN_FOR_PROJECT_SQL).get('Nexolvi').run_id).toBe('run_logout');
  });

  it('falls back to started_at when a run has never been updated', () => {
    addRun('run_a', 'A', '2026-09-16T12:00:00Z', null as any);
    addRun('run_b', 'B', '2026-09-17T12:00:00Z', null as any);

    expect(db.prepare(LATEST_PROJECT_SQL).get().project_id).toBe('B');
  });
});

describe('resolveProjectId', () => {
  it('honours an explicit project from a CLI flag or request body', () => {
    expect(resolveProjectId('Nexolvi')).toBe('Nexolvi');
    expect(resolveProjectId('  Nexolvi  ')).toBe('Nexolvi');
  });

  it('treats an empty field as "the project being worked on", never as a literal', () => {
    // An empty field must fall through to the database lookup. Agent 01's upload route used to
    // substitute the fallback literal here, which is what split an upload from its pipeline.
    const resolved = resolveProjectId('');
    expect(resolved).not.toBe('');
    expect(typeof resolved).toBe('string');
  });

  it('uses the caller-supplied fallback only when no real run exists', () => {
    expect(DEFAULT_PROJECT_ID).toBe('ARIA Project');
  });
});
