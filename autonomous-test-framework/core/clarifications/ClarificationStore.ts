'use strict';

/**
 * @fileoverview Project-scoped clarification store. Any stage raises a question about missing information; it is routed
 * to the stage that owns the answer, deduplicated, and kept across pipeline runs so the next run asks — once — instead
 * of failing again.
 */

import * as crypto from 'crypto';
import { stateDb } from '../state-manager/Database';

/** @enum {string} Clarification lifecycle. */
export const CLARIFICATION_STATUS = Object.freeze({
  OPEN: 'OPEN',
  ANSWERED: 'ANSWERED',
  APPLIED: 'APPLIED',
  RESOLVED_BY_CHANGE: 'RESOLVED_BY_CHANGE',
  STALE: 'STALE',
  MANUAL: 'MANUAL',
  DISMISSED: 'DISMISSED',
} as const);

export type ClarificationStatus = typeof CLARIFICATION_STATUS[keyof typeof CLARIFICATION_STATUS];

/** After this many answers that did not clear the gap, the human must decide (manual or reject) instead of answering again. */
export const MAX_ASK_ROUNDS = 2;

/** Answers to requirement-level questions apply to every stage. */
const REQUIREMENTS_STAGE_ID = '01-requirement-analyzer';
const HUMAN_DECISION_STATUSES: ReadonlySet<string> = new Set([CLARIFICATION_STATUS.MANUAL, CLARIFICATION_STATUS.DISMISSED]);
const RESOLVED_STATUSES: ReadonlySet<string> = new Set([CLARIFICATION_STATUS.ANSWERED, CLARIFICATION_STATUS.APPLIED]);

/** A question to raise. */
export interface ClarificationRequest {
  sourceStage: string;
  owningStage: string;
  kind: string;
  ruleId?: string;
  tcKey?: string;
  featureId?: string;
  requirementRef?: string;
  stepIndex?: number;
  /** Extra identity when one rule can fire several times for the same step (e.g. a placeholder name). */
  subject?: string;
  question: string;
  context?: Record<string, unknown>;
  /** Hash of the content the question is about; a different hash later makes the open question stale. */
  subjectHash?: string;
}

/** A stored clarification. */
export interface Clarification {
  id: string;
  projectId: string;
  dedupeKey: string;
  sourceStage: string;
  owningStage: string;
  kind: string;
  ruleId?: string;
  tcKey?: string;
  featureId?: string;
  requirementRef?: string;
  question: string;
  context: Record<string, any>;
  status: ClarificationStatus;
  answer?: string;
  answeredBy?: string;
  askRounds: number;
  subjectHash?: string;
  raisedRunId?: string;
  lastSeenRunId?: string;
  askedAt: string;
  answeredAt?: string;
}

/**
 * Stable identity of a question: owner, rule, test case, step and subject — never the detail text, which may change.
 * @param {ClarificationRequest} request
 * @returns {string}
 */
export function dedupeKeyFor(request: Pick<ClarificationRequest, 'owningStage' | 'kind' | 'ruleId' | 'tcKey' | 'stepIndex' | 'subject'>): string {
  const parts = [request.owningStage, request.ruleId || request.kind, request.tcKey || '', request.stepIndex ?? '', request.subject || ''];
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex');
}

function contextOf(request: ClarificationRequest, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...(request.context || {}), ...(request.stepIndex !== undefined ? { stepIndex: request.stepIndex } : {}), ...extra };
}

function toClarification(row: any): Clarification {
  return {
    id: row.id,
    projectId: row.project_id,
    dedupeKey: row.dedupe_key,
    sourceStage: row.source_stage,
    owningStage: row.owning_stage,
    kind: row.kind,
    ruleId: row.rule_id ?? undefined,
    tcKey: row.tc_key ?? undefined,
    featureId: row.feature_id ?? undefined,
    requirementRef: row.requirement_ref ?? undefined,
    question: row.question,
    context: row.context_json ? JSON.parse(row.context_json) : {},
    status: row.status,
    answer: row.answer ?? undefined,
    answeredBy: row.answered_by ?? undefined,
    askRounds: row.ask_rounds,
    subjectHash: row.subject_hash ?? undefined,
    raisedRunId: row.raised_run_id ?? undefined,
    lastSeenRunId: row.last_seen_run_id ?? undefined,
    askedAt: row.asked_at,
    answeredAt: row.answered_at ?? undefined,
  };
}

/**
 * Clarifications of one project.
 */
export class ClarificationStore {
  private readonly _projectId: string;

  private readonly _runId: string | null;

  /**
   * @param {string} projectId
   * @param {string|null} [runId] - Pipeline run raising or seeing the questions
   */
  constructor(projectId: string, runId: string | null = null) {
    this._projectId = projectId;
    this._runId = runId;
    stateDb.initialize();
  }

  /**
   * Raises a question, or refreshes the matching one. A human decision (manual, dismissed) is kept; an answered question
   * whose gap persists is reopened with its previous answer, and flagged for a decision after MAX_ASK_ROUNDS.
   * @param {ClarificationRequest} request
   * @returns {Clarification}
   */
  raise(request: ClarificationRequest): Clarification {
    const dedupeKey = dedupeKeyFor(request);
    const existing = this._findByKey(dedupeKey);
    if (!existing) return this._insert(request, dedupeKey);
    if (HUMAN_DECISION_STATUSES.has(existing.status)) return existing;
    return existing.status === CLARIFICATION_STATUS.OPEN ? this._refresh(existing, request) : this._reopen(existing, request);
  }

  /** Records a human answer. */
  answer(id: string, answer: string, answeredBy: string): Clarification | null {
    return this._decide(id, CLARIFICATION_STATUS.ANSWERED, answer, answeredBy);
  }

  /** Marks the test case behind the question as a manual test. */
  markManual(id: string, decidedBy: string): Clarification | null {
    return this._decide(id, CLARIFICATION_STATUS.MANUAL, 'Marked as a manual test case', decidedBy);
  }

  /** Dismisses a question that does not need an answer. */
  dismiss(id: string, reason: string, decidedBy: string): Clarification | null {
    return this._decide(id, CLARIFICATION_STATUS.DISMISSED, reason, decidedBy);
  }

  /** Marks an answer as applied to the artifact it corrects. */
  markApplied(id: string): Clarification | null {
    this._setStatus(id, CLARIFICATION_STATUS.APPLIED);
    return this.get(id);
  }

  /** Clarification by id (within this project). */
  get(id: string): Clarification | null {
    const row = stateDb.prepare('SELECT * FROM project_clarifications WHERE id = ? AND project_id = ?').get(id, this._projectId);
    return row ? toClarification(row) : null;
  }

  /**
   * Open questions, optionally filtered by owning stage, source stage and test case keys.
   * @param {{ owningStage?: string, sourceStage?: string, tcKeys?: string[] }} [filter]
   * @returns {Clarification[]}
   */
  listOpen(filter: { owningStage?: string; sourceStage?: string; tcKeys?: string[] } = {}): Clarification[] {
    return this.list({ ...filter, statuses: [CLARIFICATION_STATUS.OPEN] });
  }

  /**
   * Clarifications filtered by status, owning stage, source stage and test case keys.
   * @param {{ statuses?: ClarificationStatus[], owningStage?: string, sourceStage?: string, tcKeys?: string[] }} [filter]
   * @returns {Clarification[]}
   */
  list(filter: { statuses?: ClarificationStatus[]; owningStage?: string; sourceStage?: string; tcKeys?: string[] } = {}): Clarification[] {
    return this._all().filter((c) => (!filter.statuses || filter.statuses.includes(c.status))
      && (!filter.owningStage || c.owningStage === filter.owningStage)
      && (!filter.sourceStage || c.sourceStage === filter.sourceStage)
      && (!filter.tcKeys || (c.tcKey !== undefined && filter.tcKeys.includes(c.tcKey))));
  }

  /**
   * Answered questions a stage should apply: those it owns plus every requirement-level answer.
   * @param {string} stage
   * @param {string[]} [tcKeys] - Limit to these test cases (project-wide answers are always included)
   * @returns {Clarification[]}
   */
  listResolvedFor(stage: string, tcKeys?: string[]): Clarification[] {
    return this._all().filter((c) => RESOLVED_STATUSES.has(c.status)
      && (c.owningStage === stage || c.owningStage === REQUIREMENTS_STAGE_ID)
      && (!tcKeys || !c.tcKey || tcKeys.includes(c.tcKey)));
  }

  /**
   * Resolves open questions a stage raised for a test case (or, without `tcKey`, its project-wide questions) whose rule
   * no longer fires.
   * @param {{ sourceStage: string, tcKey?: string, firingKeys: string[] }} scope
   * @returns {number} Number of questions resolved
   */
  resolveMissing(scope: { sourceStage: string; tcKey?: string; firingKeys: string[] }): number {
    const firing = new Set(scope.firingKeys);
    const resolved = this.listOpen({ sourceStage: scope.sourceStage })
      .filter((c) => c.tcKey === scope.tcKey && !firing.has(c.dedupeKey));
    resolved.forEach((c) => this._setStatus(c.id, CLARIFICATION_STATUS.RESOLVED_BY_CHANGE));
    return resolved.length;
  }

  /**
   * Marks open questions of a stage stale when the content they were asked about has changed.
   * @param {{ owningStage: string, subjectHash: string }} scope
   * @returns {number} Number of questions marked stale
   */
  markStale(scope: { owningStage: string; subjectHash: string }): number {
    const stale = this.listOpen({ owningStage: scope.owningStage }).filter((c) => c.subjectHash && c.subjectHash !== scope.subjectHash);
    stale.forEach((c) => this._setStatus(c.id, CLARIFICATION_STATUS.STALE));
    return stale.length;
  }

  private _all(): Clarification[] {
    return (stateDb.prepare('SELECT * FROM project_clarifications WHERE project_id = ? ORDER BY asked_at, id').all(this._projectId) as any[])
      .map(toClarification);
  }

  private _findByKey(dedupeKey: string): Clarification | null {
    const row = stateDb.prepare('SELECT * FROM project_clarifications WHERE project_id = ? AND dedupe_key = ?').get(this._projectId, dedupeKey);
    return row ? toClarification(row) : null;
  }

  private _insert(request: ClarificationRequest, dedupeKey: string): Clarification {
    const id = `clar_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    stateDb.prepare(`INSERT INTO project_clarifications (id, project_id, dedupe_key, source_stage, owning_stage, kind, rule_id, tc_key,
      feature_id, requirement_ref, question, context_json, status, ask_rounds, subject_hash, raised_run_id, last_seen_run_id, asked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`).run(
      id, this._projectId, dedupeKey, request.sourceStage, request.owningStage, request.kind, request.ruleId ?? null, request.tcKey ?? null,
      request.featureId ?? null, request.requirementRef ?? null, request.question, JSON.stringify(contextOf(request)),
      CLARIFICATION_STATUS.OPEN, request.subjectHash ?? null, this._runId, this._runId, new Date().toISOString(),
    );
    return this.get(id) as Clarification;
  }

  private _refresh(existing: Clarification, request: ClarificationRequest): Clarification {
    const kept = { previousAnswer: existing.context.previousAnswer, requiresDecision: existing.context.requiresDecision };
    stateDb.prepare('UPDATE project_clarifications SET question = ?, context_json = ?, subject_hash = ?, last_seen_run_id = ? WHERE id = ?')
      .run(request.question, JSON.stringify(contextOf(request, kept)), request.subjectHash ?? existing.subjectHash ?? null,
        this._runId ?? existing.lastSeenRunId ?? null, existing.id);
    return this.get(existing.id) as Clarification;
  }

  private _reopen(existing: Clarification, request: ClarificationRequest): Clarification {
    // Only an answer that did not clear the gap about the same content counts as a new round; a stale or resolved
    // question, or one about regenerated content, simply reopens.
    const wasAnswered = RESOLVED_STATUSES.has(existing.status);
    const sameSubject = !request.subjectHash || !existing.subjectHash || request.subjectHash === existing.subjectHash;
    const askRounds = wasAnswered && sameSubject ? existing.askRounds + 1 : existing.askRounds;
    const context = contextOf(request, {
      previousAnswer: wasAnswered ? existing.answer : existing.context.previousAnswer,
      requiresDecision: askRounds > MAX_ASK_ROUNDS,
    });
    stateDb.prepare(`UPDATE project_clarifications SET status = ?, question = ?, context_json = ?, ask_rounds = ?, answer = NULL,
      answered_by = NULL, answered_at = NULL, subject_hash = ?, last_seen_run_id = ? WHERE id = ?`)
      .run(CLARIFICATION_STATUS.OPEN, request.question, JSON.stringify(context), askRounds, request.subjectHash ?? existing.subjectHash ?? null,
        this._runId ?? existing.lastSeenRunId ?? null, existing.id);
    return this.get(existing.id) as Clarification;
  }

  private _decide(id: string, status: ClarificationStatus, answer: string, decidedBy: string): Clarification | null {
    stateDb.prepare('UPDATE project_clarifications SET status = ?, answer = ?, answered_by = ?, answered_at = ? WHERE id = ? AND project_id = ?')
      .run(status, answer, decidedBy, new Date().toISOString(), id, this._projectId);
    return this.get(id);
  }

  private _setStatus(id: string, status: ClarificationStatus): void {
    stateDb.prepare('UPDATE project_clarifications SET status = ? WHERE id = ? AND project_id = ?').run(status, id, this._projectId);
  }
}
