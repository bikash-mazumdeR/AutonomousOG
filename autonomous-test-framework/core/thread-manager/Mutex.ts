'use strict';

/**
 * @fileoverview Async Mutex implementation for thread-safe state operations.
 * Prevents race conditions when multiple agents access shared state concurrently.
 *
 * @module Mutex
 * @version 1.0.0
 */

// ─── Mutex Class ──────────────────────────────────────────────────────────────

/**
 * @class Mutex
 * @description Promise-based async mutex with configurable timeout.
 * Ensures only one async operation holds the lock at a time.
 */
export class Mutex {
  private _timeoutMs: number;
  private _queue: Array<{ resolve: () => void }>;
  private _locked: boolean;

  /**
   * @param {number} [timeoutMs=5000] - Max wait time before acquisition fails
   */
  constructor(timeoutMs: number = 5000) {
    this._timeoutMs = timeoutMs;
    this._queue = [];
    this._locked = false;
  }

  /**
   * Acquires the mutex lock. Waits if locked, times out if wait exceeds threshold.
   * @returns {Promise<void>}
   * @throws {Error} If acquisition times out
   */
  async acquire(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this._locked) {
        this._locked = true;
        return resolve();
      }

      const timer = setTimeout(() => {
        const idx = this._queue.indexOf(entry);
        if (idx !== -1) this._queue.splice(idx, 1);
        reject(new Error(`Mutex acquisition timed out after ${this._timeoutMs}ms`));
      }, this._timeoutMs);

      const entry = {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
      };

      this._queue.push(entry);
    });
  }

  /**
   * Releases the mutex lock and unblocks the next waiter.
   * @returns {void}
   */
  release(): void {
    if (this._queue.length > 0) {
      const next = this._queue.shift();
      if (next) next.resolve();
    } else {
      this._locked = false;
    }
  }

  /**
   * Executes a function within a mutex-protected critical section.
   * Automatically acquires and releases the lock.
   * @template T
   * @param {() => Promise<T>} fn - Async function to execute
   * @returns {Promise<T>} Result of fn
   */
  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /** @returns {boolean} Whether the mutex is currently locked */
  get isLocked(): boolean {
    return this._locked;
  }

  /** @returns {number} Number of waiters in the queue */
  get queueLength(): number {
    return this._queue.length;
  }
}

