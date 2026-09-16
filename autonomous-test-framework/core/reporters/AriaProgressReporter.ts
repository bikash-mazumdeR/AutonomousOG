'use strict';

/**
 * @fileoverview Playwright reporter that streams per-test progress as NDJSON so the Agent 07 UI can
 * render a live results grid.
 *
 * Playwright's JSON reporter only lands at the very end of a run, and the `list` reporter emits prose
 * rather than structured events — neither gives the UI per-test progress while a multi-minute run is
 * in flight. This reporter appends one JSON object per line to the file named by ARIA_PROGRESS_FILE,
 * which the Agent 07 UI server tails (and replays to clients that connect mid-run, so a browser
 * refresh rebuilds the grid instead of resetting it).
 *
 * It is registered unconditionally in playwright.config.ts and no-ops when ARIA_PROGRESS_FILE is
 * unset, so a manual `npx playwright test` is unaffected.
 *
 * @module AriaProgressReporter
 */

import fs from 'fs';
import path from 'path';
import type {
  FullConfig, FullResult, Reporter, Suite, TestCase, TestResult,
} from '@playwright/test/reporter';

/** Environment variable naming the NDJSON file to append progress events to. */
const PROGRESS_FILE_ENV = 'ARIA_PROGRESS_FILE';

/** Matches the `TC-123` convention used across generated specs. */
const TC_KEY_PATTERN = /TC-\d{3}/;

/** Annotation Agent 05 writes onto generated tests. */
const TC_KEY_ANNOTATION = 'TC Key';

/**
 * @typedef {Object} ProgressEvent
 * @property {string} t - Event kind: 'begin' | 'start' | 'test' | 'end'
 */

/**
 * Streams per-test progress events to an NDJSON file for the Agent 07 UI.
 *
 * Playwright requires a reporter module to have a single default class export.
 */
export default class AriaProgressReporter implements Reporter {
  private _target: string | null = null;

  /**
   * Opens the progress file and emits the run header.
   * @param {FullConfig} config - Resolved Playwright configuration
   * @param {Suite} suite - Root suite for the run
   */
  onBegin(config: FullConfig, suite: Suite): void {
    const target = (process.env[PROGRESS_FILE_ENV] || '').trim();
    if (!target) return; // Not an ARIA-driven run — stay silent.

    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      // Truncate so a re-run never replays the previous run's events to the UI.
      fs.writeFileSync(target, '', 'utf-8');
      this._target = target;
    } catch {
      this._target = null; // Progress is best-effort; never fail a test run over it.
      return;
    }

    this._emit({
      t: 'begin',
      total: suite.allTests().length,
      workers: config.workers,
      startedAt: new Date().toISOString(),
    });
  }

  /**
   * Marks a test as in-flight so the grid can show a running row.
   * @param {TestCase} test
   */
  onTestBegin(test: TestCase): void {
    this._emit({
      t: 'start',
      testId: test.id,
      tcKey: this._tcKey(test),
      title: test.title,
      file: this._file(test),
    });
  }

  /**
   * Emits the outcome of one attempt. The UI keys on `testId` and takes the latest attempt,
   * so retries naturally overwrite earlier rows.
   * @param {TestCase} test
   * @param {TestResult} result
   */
  onTestEnd(test: TestCase, result: TestResult): void {
    this._emit({
      t: 'test',
      testId: test.id,
      tcKey: this._tcKey(test),
      title: test.title,
      file: this._file(test),
      status: result.status,
      outcome: test.outcome(),
      duration: result.duration,
      retry: result.retry,
      project: test.parent?.project()?.name,
    });
  }

  /**
   * Emits the terminal event so the UI can stop polling and load the final artifacts.
   * @param {FullResult} result
   */
  onEnd(result: FullResult): void {
    this._emit({ t: 'end', status: result.status, endedAt: new Date().toISOString() });
    this._target = null;
  }

  /**
   * This reporter writes to a file, never to stdout, so Playwright should not count it as the
   * run's terminal reporter.
   * @returns {boolean}
   */
  printsToStdio(): boolean {
    return false;
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /**
   * Resolves the TC key from the annotation Agent 05 writes, falling back to the title convention.
   * @param {TestCase} test
   * @returns {string|null}
   * @private
   */
  private _tcKey(test: TestCase): string | null {
    const annotation = (test.annotations || []).find((a) => a.type === TC_KEY_ANNOTATION);
    if (annotation?.description) return annotation.description;
    const match = (test.title || '').match(TC_KEY_PATTERN);
    return match ? match[0] : null;
  }

  /**
   * @param {TestCase} test
   * @returns {string} Spec file basename
   * @private
   */
  private _file(test: TestCase): string {
    return path.basename(test.location?.file || '');
  }

  /**
   * Appends one NDJSON line. Failures are swallowed — progress reporting must never break a run.
   * @param {Record<string, unknown>} event
   * @private
   */
  private _emit(event: Record<string, unknown>): void {
    if (!this._target) return;
    try {
      fs.appendFileSync(this._target, `${JSON.stringify(event)}\n`, 'utf-8');
    } catch {
      // Best-effort: a full disk or a deleted reports/ folder must not fail the suite.
    }
  }
}
