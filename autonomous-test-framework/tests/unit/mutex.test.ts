/**
 * @fileoverview Unit tests for the Mutex (async lock) implementation.
 * Tests concurrency safety, timeout behavior, queue ordering, and runExclusive.
 */

import { Mutex } from '../../core/thread-manager/Mutex';

describe('Mutex', () => {
  let mutex: Mutex;

  beforeEach(() => {
    mutex = new Mutex(1000); // 1s timeout for tests
  });

  // ── Basic Lock Behavior ──────────────────────────────────────────────────

  describe('acquire / release', () => {
    it('should start unlocked', () => {
      expect(mutex.isLocked).toBe(false);
      expect(mutex.queueLength).toBe(0);
    });

    it('should lock on acquire', async () => {
      await mutex.acquire();
      expect(mutex.isLocked).toBe(true);
    });

    it('should unlock on release', async () => {
      await mutex.acquire();
      mutex.release();
      expect(mutex.isLocked).toBe(false);
    });

    it('should process queued waiters in FIFO order', async () => {
      const order: number[] = [];

      await mutex.acquire(); // Lock it

      // Queue two waiters
      const waiter1 = mutex.acquire().then(() => { order.push(1); });
      const waiter2 = mutex.acquire().then(() => { order.push(2); });

      expect(mutex.queueLength).toBe(2);

      // Release to let waiter1 proceed
      mutex.release();
      await waiter1;

      // Release to let waiter2 proceed
      mutex.release();
      await waiter2;

      expect(order).toEqual([1, 2]);
    });
  });

  // ── Timeout Behavior ─────────────────────────────────────────────────────

  describe('timeout', () => {
    it('should reject with timeout error when lock is held too long', async () => {
      const fastMutex = new Mutex(50); // 50ms timeout
      await fastMutex.acquire(); // Hold the lock

      // Attempt to acquire should time out
      await expect(fastMutex.acquire()).rejects.toThrow('Mutex acquisition timed out');
    });

    it('should remove timed-out waiter from queue', async () => {
      const fastMutex = new Mutex(50);
      await fastMutex.acquire();

      try {
        await fastMutex.acquire();
      } catch {
        // Expected timeout
      }

      expect(fastMutex.queueLength).toBe(0);
    });
  });

  // ── runExclusive ──────────────────────────────────────────────────────────

  describe('runExclusive', () => {
    it('should execute function while holding the lock', async () => {
      let wasLocked = false;

      await mutex.runExclusive(async () => {
        wasLocked = mutex.isLocked;
      });

      expect(wasLocked).toBe(true);
      expect(mutex.isLocked).toBe(false); // Released after
    });

    it('should return the function result', async () => {
      const result = await mutex.runExclusive(async () => 42);
      expect(result).toBe(42);
    });

    it('should release lock even if function throws', async () => {
      await expect(
        mutex.runExclusive(async () => { throw new Error('boom'); })
      ).rejects.toThrow('boom');

      expect(mutex.isLocked).toBe(false);
    });

    it('should serialize concurrent runExclusive calls', async () => {
      const results: number[] = [];

      const p1 = mutex.runExclusive(async () => {
        await delay(30);
        results.push(1);
      });

      const p2 = mutex.runExclusive(async () => {
        results.push(2);
      });

      await Promise.all([p1, p2]);
      // p1 acquires first, so 1 should appear before 2
      expect(results).toEqual([1, 2]);
    });
  });

  // ── Concurrency Stress ────────────────────────────────────────────────────

  describe('concurrency safety', () => {
    it('should protect a shared counter from race conditions', async () => {
      let counter = 0;
      const iterations = 50;

      const tasks = Array.from({ length: iterations }, () =>
        mutex.runExclusive(async () => {
          const val = counter;
          await delay(1); // Simulate async work
          counter = val + 1;
        })
      );

      await Promise.all(tasks);
      expect(counter).toBe(iterations); // Without mutex, this would be < iterations
    });
  });
});

// ── Helper ──────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

