'use strict';

/**
 * @fileoverview Thread-safe State Manager for the ARIA Autonomous Testing Framework.
 * Single source of truth for all pipeline stage state.
 * Uses async mutex pattern for thread-safe read/write operations.
 *
 * @module StateManager
 * @version 1.0.0
 */

import { Mutex } from '../thread-manager/Mutex';
import { stateDb, StateDatabase } from './Database';
import { PipelineState, StageStatus, ApprovalStatus, PipelineArtifacts } from '../types';

// ─── Constants ────────────────────────────────────────────────────────────────

const LOCK_TIMEOUT_MS = 5000;

export const STAGE_STATUS: Record<string, StageStatus> = {
  PENDING:   'PENDING',
  RUNNING:   'RUNNING',
  COMPLETED: 'COMPLETED',
  AWAITING:  'AWAITING',
  APPROVED:  'APPROVED',
  REJECTED:  'REJECTED',
  FAILED:    'FAILED',
  SKIPPED:   'SKIPPED',
};

export const APPROVAL_STATUS: Record<string, ApprovalStatus> = {
  PENDING:  'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
};

// ─── Default State Shape ──────────────────────────────────────────────────────

/**
 * Returns a fresh default state object.
 * @param {string} projectId - Unique project identifier
 * @returns {PipelineState}
 */
const createDefaultState = (projectId: string): PipelineState => ({
  version:   '1.0.0',
  projectId,
  runId:     `run_${Date.now()}`,
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  currentStage: null,
  globalStatus: 'IDLE',

  stages: {
    '01-requirement-analyzer':     { status: STAGE_STATUS.PENDING, output: null, approval: APPROVAL_STATUS.PENDING, attempts: 0 },
    '02-test-case-generator':      { status: STAGE_STATUS.PENDING, output: null, approval: APPROVAL_STATUS.PENDING, attempts: 0 },
    '03-test-case-reviewer':       { status: STAGE_STATUS.PENDING, output: null, approval: APPROVAL_STATUS.PENDING, attempts: 0 },
    '04-test-data-generator':      { status: STAGE_STATUS.PENDING, output: null, approval: APPROVAL_STATUS.PENDING, attempts: 0 },
    '05-playwright-script-generator': { status: STAGE_STATUS.PENDING, output: null, approval: APPROVAL_STATUS.PENDING, attempts: 0 },
    '06-automation-reviewer':      { status: STAGE_STATUS.PENDING, output: null, approval: APPROVAL_STATUS.PENDING, attempts: 0 },
    '07-test-runner':              { status: STAGE_STATUS.PENDING, output: null, approval: APPROVAL_STATUS.PENDING, attempts: 0 },
    '08-bug-reporter':             { status: STAGE_STATUS.PENDING, output: null, approval: APPROVAL_STATUS.PENDING, attempts: 0 },
    '09-report-generator':        { status: STAGE_STATUS.PENDING, output: null, approval: APPROVAL_STATUS.PENDING, attempts: 0 },
    '10-auto-healer':             { status: STAGE_STATUS.PENDING, output: null, approval: APPROVAL_STATUS.PENDING, attempts: 0 },
    '11-retest-agent':            { status: STAGE_STATUS.PENDING, output: null, approval: APPROVAL_STATUS.PENDING, attempts: 0 },
  },

  pipeline: {
    requirements:      null,
    analyzedRequirements: null,
    testCases:         null,
    reviewedTestCases: null,
    testData:          null,
    playwrightScripts: null,
    reviewedScripts:   null,
    executionResults:  null,
    bugReports:        null,
    publishedReports:  null,
    healingPatches:    null,
    retestResults:     null,
  },

  clarifications: [],
  errors:         [],
  warnings:       [],
});

// ─── StateManager Class ───────────────────────────────────────────────────────

/**
 * @class StateManager
 * @description Thread-safe singleton state manager for pipeline orchestration.
 */
export class StateManager {
  private _mutex: Mutex;
  private _initialized: boolean;
  private _projectId: string;

  constructor() {
    this._mutex = new Mutex(LOCK_TIMEOUT_MS);
    this._initialized = false;
    this._projectId = 'default';
  }

  // ── Initialization ───────────────────────────────────────────────────────

  /**
   * Initializes the state manager. Creates state file if absent.
   * @param {string} [projectId='default'] - Project identifier
   * @returns {Promise<void>}
   */
  async initialize(projectId: string = 'default'): Promise<void> {
    await this._mutex.acquire();
    try {
      stateDb.initialize();

      let targetProjectId = projectId;
      // If default or my-project, resolve to latest non-test run if available
      if (projectId === 'default' || projectId === 'my-project') {
        const latestRun = stateDb.prepare("SELECT project_id FROM runs WHERE project_id NOT LIKE 'test-unit-%' AND project_id NOT LIKE 'test-%' ORDER BY started_at DESC LIMIT 1").get() as any;
        if (latestRun?.project_id) {
          targetProjectId = latestRun.project_id;
        }
      } else {
        const existingRun = stateDb.prepare('SELECT project_id FROM runs WHERE project_id = ? ORDER BY started_at DESC LIMIT 1').get(projectId) as any;
        if (!existingRun) {
          const caseInsensitiveRun = stateDb.prepare('SELECT project_id FROM runs WHERE LOWER(project_id) = LOWER(?) ORDER BY started_at DESC LIMIT 1').get(projectId) as any;
          if (caseInsensitiveRun?.project_id) {
            targetProjectId = caseInsensitiveRun.project_id;
          }
        }
      }

      if (this._initialized && this._projectId === targetProjectId) return;

      this._projectId = targetProjectId;

      const existingState = this._readFile();
      if (!existingState) {
        const defaultState = createDefaultState(targetProjectId);
        this._writeFile(defaultState);
      }

      this._initialized = true;
    } finally {
      this._mutex.release();
    }
  }

  // ── Core Read/Write ──────────────────────────────────────────────────────

  /**
   * Retrieves a value from state using dot-notation key path.
   * @param {string} keyPath - Dot-separated path (e.g., 'stages.01-requirement-analyzer.status')
   * @returns {Promise<*>} The value at keyPath
   */
  async get(keyPath: string): Promise<any> {
    this._assertInitialized();
    const state = this._readFile();
    if (!state) return undefined;
    return this._resolveKeyPath(state, keyPath);
  }

  /**
   * Sets a value in state using dot-notation key path. Thread-safe.
   * @param {string} keyPath - Dot-separated path
   * @param {*} value - Value to set
   * @returns {Promise<void>}
   */
  async set(keyPath: string, value: any): Promise<void> {
    this._assertInitialized();

    await this._mutex.acquire();
    try {
      const state = this._readFile();
      if (state) {
        this._setKeyPath(state, keyPath, value);
        state.updatedAt = new Date().toISOString();
        this._writeFile(state);
      }
    } finally {
      this._mutex.release();
    }
  }

  /**
   * Atomically reads then writes state. Guarantees consistency.
   * @param {Function} updater - (currentState) => newState
   * @returns {Promise<Object>} Updated state
   */
  async update(updater: (state: PipelineState) => PipelineState): Promise<PipelineState> {
    this._assertInitialized();

    await this._mutex.acquire();
    try {
      const state = this._readFile();
      if (!state) throw new Error('State not found');
      const updatedState = updater(state);
      updatedState.updatedAt = new Date().toISOString();
      this._writeFile(updatedState);
      return updatedState;
    } finally {
      this._mutex.release();
    }
  }

  /**
   * Returns a deep copy of the full pipeline state.
   * @returns {Promise<Object>} Current full state
   */
  async getFullState(): Promise<PipelineState> {
    this._assertInitialized();
    const state = this._readFile();
    if (!state) throw new Error('State not found');
    return JSON.parse(JSON.stringify(state));
  }

  // ── Stage-Specific Helpers ───────────────────────────────────────────────

  /**
   * Marks a stage as running and increments attempt counter.
   * @param {string} stageId - e.g., '01-requirement-analyzer'
   * @returns {Promise<void>}
   */
  async markStageRunning(stageId: string): Promise<void> {
    await this.update((state) => {
      if (!state.stages[stageId]) throw new Error(`Unknown stage: ${stageId}`);
      state.stages[stageId].status = STAGE_STATUS.RUNNING;
      state.stages[stageId].attempts += 1;
      state.stages[stageId].startedAt = new Date().toISOString();
      state.currentStage = stageId;
      state.globalStatus = 'RUNNING';
      return state;
    });
  }

  /**
   * Marks a stage as completed and stores its output payload.
   * @param {string} stageId - Stage identifier
   * @param {Object} output - Agent result payload
   * @param {Object} [usage] - Token usage data
   * @returns {Promise<void>}
   */
  async markStageCompleted(stageId: string, output: any, usage?: any): Promise<void> {
    await this.update((state) => {
      state.stages[stageId].status = STAGE_STATUS.COMPLETED;
      state.stages[stageId].output = output;
      state.stages[stageId].usage = usage;
      state.stages[stageId].completedAt = new Date().toISOString();
      // Preserve approval status if already approved (agents invoke approval gates internally)
      if (state.stages[stageId].approval !== APPROVAL_STATUS.APPROVED) {
        state.stages[stageId].approval = APPROVAL_STATUS.PENDING;
        state.globalStatus = 'AWAITING_APPROVAL';
      }
      return state;
    });
  }

  /**
   * Marks a stage as approved by human reviewer.
   * @param {string} stageId - Stage identifier
   * @param {string} [comment=''] - Human reviewer comment
   * @returns {Promise<void>}
   */
  async markStageApproved(stageId: string, comment: string = ''): Promise<void> {
    await this.update((state) => {
      state.stages[stageId].approval = APPROVAL_STATUS.APPROVED;
      state.stages[stageId].approvalComment = comment;
      state.stages[stageId].approvedAt = new Date().toISOString();
      state.globalStatus = 'RUNNING';
      return state;
    });
  }

  /**
   * Marks a stage as rejected by human reviewer.
   * @param {string} stageId - Stage identifier
   * @param {string} reason - Rejection reason
   * @returns {Promise<void>}
   */
  async markStageRejected(stageId: string, reason: string): Promise<void> {
    await this.update((state) => {
      state.stages[stageId].approval = APPROVAL_STATUS.REJECTED;
      state.stages[stageId].status = STAGE_STATUS.REJECTED;
      state.stages[stageId].rejectionReason = reason;
      state.stages[stageId].rejectedAt = new Date().toISOString();
      state.globalStatus = 'REJECTED';
      return state;
    });
  }

  /**
   * Marks a stage as failed with error details.
   * @param {string} stageId - Stage identifier
   * @param {Error} error - The error that caused failure
   * @returns {Promise<void>}
   */
  async markStageFailed(stageId: string, error: any): Promise<void> {
    await this.update((state) => {
      state.stages[stageId].status = STAGE_STATUS.FAILED;
      state.stages[stageId].failedAt = new Date().toISOString();
      state.stages[stageId].error = {
        message: error.message,
        stack: error.stack,
        code: error.code || 'UNKNOWN',
      };
      state.globalStatus = 'FAILED';
      return state;
    });
    // Persist error log directly to DB (not via _writeFile which would wipe breadcrumbs)
    await this.logBreadcrumb(stageId, error.message, 'ERROR');
  }

  /**
   * Stores pipeline artifact in the shared pipeline object.
   * @param {string} artifactKey - Key in pipeline object (e.g., 'requirements')
   * @param {*} artifact - The artifact data
   * @returns {Promise<void>}
   */
  async setPipelineArtifact(artifactKey: keyof PipelineArtifacts, artifact: any): Promise<void> {
    await this.set(`pipeline.${artifactKey}`, artifact);
  }

  /**
   * Retrieves a pipeline artifact.
   * @param {string} artifactKey - Key in pipeline object
   * @returns {Promise<*>} The artifact or null
   */
  async getPipelineArtifact(artifactKey: keyof PipelineArtifacts): Promise<any> {
    const val = await this.get(`pipeline.${artifactKey}`);
    if (val !== undefined && val !== null) {
      return val;
    }
    try {
      const latestArtifact = stateDb.prepare(`
        SELECT a.value FROM artifacts a
        JOIN runs r ON a.run_id = r.run_id
        WHERE a.key = ? AND r.project_id NOT LIKE 'test-unit-%' AND r.project_id NOT LIKE 'test-%'
        ORDER BY r.started_at DESC LIMIT 1
      `).get(artifactKey) as any;
      if (latestArtifact?.value) {
        return JSON.parse(latestArtifact.value);
      }
    } catch {}
    return null;
  }

  /**
   * Current project id.
   * @returns {string}
   */
  getProjectId(): string {
    return this._projectId;
  }

  /**
   * The shared SQLite database, opened on first use. For read-only lookups that span projects, such as the newest run.
   * @returns {StateDatabase}
   */
  getDatabase(): StateDatabase {
    stateDb.initialize();
    return stateDb;
  }

  /**
   * Returns the newest non-null artifact for the current project, looking at the current run first and
   * then at earlier runs of the same project. Used to compare against or reuse a previous run's output.
   * @param {string} artifactKey - Key in pipeline object
   * @returns {Promise<*>} The artifact or null
   */
  async getLatestArtifactForProject(artifactKey: keyof PipelineArtifacts): Promise<any> {
    const current = await this.get(`pipeline.${artifactKey}`);
    if (current !== undefined && current !== null) return current;
    try {
      const row = stateDb.prepare(`
        SELECT a.value FROM artifacts a
        JOIN runs r ON a.run_id = r.run_id
        WHERE a.key = ? AND r.project_id = ? AND a.value IS NOT NULL AND a.value <> 'null'
        ORDER BY r.started_at DESC LIMIT 1
      `).get(artifactKey, this._projectId) as any;
      return row?.value ? JSON.parse(row.value) : null;
    } catch {
      return null;
    }
  }

  /**
   * Adds a clarification question from an agent.
   * @param {string} stageId - The asking agent's stage
   * @param {string} question - The clarification text
   * @returns {Promise<string>} Question ID for tracking
   */
  async addClarification(stageId: string, question: string): Promise<string> {
    const questionId = `clq_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await this.update((state) => {
      state.clarifications.push({
        id: questionId,
        stageId,
        question,
        status: 'PENDING',
        askedAt: new Date().toISOString(),
        answer: null,
      });
      return state;
    });
    return questionId;
  }

  /**
   * Records a human-provided answer to a clarification.
   * @param {string} questionId - ID from addClarification
   * @param {string} answer - Human's answer
   * @returns {Promise<void>}
   */
  async answerClarification(questionId: string, answer: string): Promise<void> {
    await this.update((state) => {
      const clq = state.clarifications.find((c) => c.id === questionId);
      if (clq) {
        clq.answer = answer;
        clq.status = 'ANSWERED';
        clq.answeredAt = new Date().toISOString();
      }
      return state;
    });
  }

  /**
   * Retrieves all breadcrumb logs for the current run.
   * @returns {Promise<Array>}
   */
  async getBreadcrumbs(): Promise<any[]> {
    this._assertInitialized();
    const state = this._readFile();
    if (!state) return [];
    
    return stateDb.prepare('SELECT * FROM logs WHERE run_id = ? ORDER BY timestamp DESC LIMIT 100')
      .all(state.runId) as any[];
  }

  /**
   * Adds a low-level action breadcrumb to the log.
   * @param {string} stageId - Current stage
   * @param {string} message - Description of the action
   * @param {string} [level='INFO'] - Log level
   * @returns {Promise<void>}
   */
  async logBreadcrumb(stageId: string, message: string, level: string = 'INFO'): Promise<void> {
    await this._mutex.acquire();
    try {
      const state = this._readFile();
      if (state) {
        stateDb.prepare('INSERT INTO logs (run_id, stage_id, level, message, timestamp) VALUES (?, ?, ?, ?, ?)')
          .run(state.runId, stageId, level, message, new Date().toISOString());
      }
    } finally {
      this._mutex.release();
    }
  }

  /**
   * Resets state for a fresh run while preserving run history.
   * @param {string} [projectId] - Project identifier
   * @returns {Promise<PipelineState>} Fresh state
   */
  async resetForNewRun(projectId?: string): Promise<PipelineState> {
    await this._mutex.acquire();
    try {
      stateDb.initialize();
      if (projectId) {
        this._projectId = projectId;
      }
      const freshState = createDefaultState(this._projectId);
      this._writeFile(freshState);
      this._initialized = true;
      return freshState;
    } finally {
      this._mutex.release();
    }
  }

  /**
   * Starts a brand new pipeline run for the project. Alias to resetForNewRun.
   * @param {string} [projectId]
   * @returns {Promise<PipelineState>} Fresh state
   */
  async startNewRun(projectId?: string): Promise<PipelineState> {
    return this.resetForNewRun(projectId);
  }

  // ── Private Helpers ──────────────────────────────────────────────────────

  /** @private */
  private _readFile(): PipelineState | null {
    let run: any = null;
    if (this._projectId === 'default' || this._projectId === 'my-project') {
      const latestRun = stateDb.prepare("SELECT * FROM runs WHERE project_id NOT LIKE 'test-unit-%' AND project_id NOT LIKE 'test-%' ORDER BY started_at DESC LIMIT 1").get() as any;
      if (latestRun) {
        run = latestRun;
        this._projectId = latestRun.project_id;
      }
    }
    if (!run) {
      run = stateDb.prepare('SELECT * FROM runs WHERE project_id = ? ORDER BY started_at DESC LIMIT 1').get(this._projectId) as any;
    }
    if (!run) {
      run = stateDb.prepare('SELECT * FROM runs WHERE LOWER(project_id) = LOWER(?) ORDER BY started_at DESC LIMIT 1').get(this._projectId) as any;
      if (run) {
        this._projectId = run.project_id;
      }
    }
    if (!run) return null;

    const state: PipelineState = {
      version:      run.version,
      projectId:    run.project_id,
      runId:        run.run_id,
      startedAt:    run.started_at,
      updatedAt:    run.updated_at,
      currentStage: run.current_stage,
      globalStatus: run.global_status,
      stages:       {},
      pipeline:     {},
      clarifications: [],
      errors:       [],
      warnings:     []
    };

    // Load stages
    const stages = stateDb.prepare('SELECT * FROM stages WHERE run_id = ?').all(run.run_id) as any[];
    stages.forEach((s) => {
      state.stages[s.stage_id] = {
        status:           s.status,
        output:           s.output ? JSON.parse(s.output) : null,
        approval:         s.approval,
        attempts:         s.attempts,
        startedAt:        s.started_at,
        completedAt:      s.completed_at,
        approvedAt:       s.approved_at,
        rejectionReason:  s.rejection_reason,
        error:            s.error ? JSON.parse(s.error) : null,
        usage:            s.usage ? JSON.parse(s.usage) : null,
        };
        });


    // Load artifacts
    const artifacts = stateDb.prepare('SELECT * FROM artifacts WHERE run_id = ?').all(run.run_id) as any[];
    artifacts.forEach((a) => {
      state.pipeline[a.key as keyof PipelineArtifacts] = JSON.parse(a.value);
    });

    // Load clarifications
    const clarifications = stateDb.prepare('SELECT * FROM clarifications WHERE run_id = ?').all(run.run_id) as any[];
    state.clarifications = clarifications.map((c) => ({
      ...c,
      askedAt:    c.asked_at,
      answeredAt: c.answered_at,
    }));

    // Load logs
    const logs = stateDb.prepare('SELECT * FROM logs WHERE run_id = ?').all(run.run_id) as any[];
    logs.forEach((l) => {
      if (l.level === 'ERROR') state.errors.push({ message: l.message, timestamp: l.timestamp });
      if (l.level === 'WARNING') state.warnings.push({ message: l.message, timestamp: l.timestamp });
    });

    return state;
  }

  /** @private */
  private _writeFile(state: PipelineState): void {
    const transaction = stateDb.transaction((s: PipelineState) => {
      // 1. Update run
      stateDb.prepare(`
        INSERT INTO runs (run_id, project_id, version, started_at, updated_at, current_stage, global_status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id) DO UPDATE SET
          updated_at = excluded.updated_at,
          current_stage = excluded.current_stage,
          global_status = excluded.global_status
      `).run(s.runId, s.projectId, s.version, s.startedAt, s.updatedAt, s.currentStage, s.globalStatus);

      // 2. Update stages
      const stageStmt = stateDb.prepare(`
        INSERT INTO stages (
          run_id, stage_id, status, output, approval, attempts, 
          started_at, completed_at, approved_at, rejection_reason, error, usage
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id, stage_id) DO UPDATE SET
          status = excluded.status,
          output = excluded.output,
          approval = excluded.approval,
          attempts = excluded.attempts,
          started_at = excluded.started_at,
          completed_at = excluded.completed_at,
          approved_at = excluded.approved_at,
          rejection_reason = excluded.rejection_reason,
          error = excluded.error,
          usage = excluded.usage
      `);

      Object.entries(s.stages).forEach(([id, data]) => {
        stageStmt.run(
          s.runId, id, data.status,
          data.output ? JSON.stringify(data.output) : null,
          data.approval, data.attempts,
          data.startedAt || null, data.completedAt || null,
          data.approvedAt || null, data.rejectionReason || null,
          data.error ? JSON.stringify(data.error) : null,
          data.usage ? JSON.stringify(data.usage) : null
        );
      });

      // 3. Update artifacts
      const artifactStmt = stateDb.prepare(`
        INSERT INTO artifacts (run_id, key, value)
        VALUES (?, ?, ?)
        ON CONFLICT(run_id, key) DO UPDATE SET value = excluded.value
      `);

      Object.entries(s.pipeline).forEach(([key, val]) => {
        if (val) artifactStmt.run(s.runId, key, JSON.stringify(val));
      });

      // 4. Update clarifications
      const clqStmt = stateDb.prepare(`
        INSERT INTO clarifications (id, run_id, stage_id, question, status, asked_at, answer, answered_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          answer = excluded.answer,
          answered_at = excluded.answered_at
      `);

      s.clarifications.forEach((c) => {
        clqStmt.run(c.id, s.runId, c.stageId, c.question, c.status, c.askedAt, c.answer, c.answeredAt);
      });

      // 5. Logs: breadcrumbs and errors are now inserted directly via logBreadcrumb()
      //    No DELETE — preserves audit trail across state updates

    });

    transaction(state);
  }

  /** @private */
  private _assertInitialized(): void {
    if (!this._initialized) {
      throw new Error('StateManager not initialized. Call initialize() first.');
    }
  }

  /** @private */
  private _resolveKeyPath(obj: any, keyPath: string): any {
    return keyPath.split('.').reduce((acc, key) => {
      if (acc === undefined || acc === null) return undefined;
      return acc[key];
    }, obj);
  }

  /** @private */
  private _setKeyPath(obj: any, keyPath: string, value: any): void {
    const keys = keyPath.split('.');
    const lastKey = keys.pop();
    if (!lastKey) return;
    const target = keys.reduce((acc, key) => {
      if (!acc[key] || typeof acc[key] !== 'object') acc[key] = {};
      return acc[key];
    }, obj);
    target[lastKey] = value;
  }
}

export const stateManager = new StateManager();

