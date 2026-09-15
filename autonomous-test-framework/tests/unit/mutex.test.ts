/**
 * @fileoverview Unit tests for the Mutex (async lock) implementation.
 * Tests concurrency safety, timeout behavior, queue ordering, and runExclusive.
 */

import { Mutex } from '../../core/thread-manager/Mutex';

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('Mutex', () => {
  let mutex: Mutex;

  beforeEach(() => {
    mutex = new Mutex(1000); // 1s timeout for tests
  });

  it('should process queued waiters in FIFO order', async () => {
    const order: number[] = [];

    await mutex.acquire();
    const waiter1 = mutex.acquire().then(() => { order.push(1); });
    const waiter2 = mutex.acquire().then(() => { order.push(2); });
    expect(mutex.queueLength).toBe(2);

    mutex.release();
    await waiter1;
    mutex.release();
    await waiter2;

    expect(order).toEqual([1, 2]);
  });

  it('should reject with timeout error when lock is held too long', async () => {
    const fastMutex = new Mutex(50);
    await fastMutex.acquire();
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

  it('should release lock even if function throws', async () => {
    await expect(
      mutex.runExclusive(async () => { throw new Error('boom'); })
    ).rejects.toThrow('boom');

    expect(mutex.isLocked).toBe(false);
  });

  it('should protect a shared counter from race conditions', async () => {
    let counter = 0;
    const iterations = 50;

    const tasks = Array.from({ length: iterations }, () =>
      mutex.runExclusive(async () => {
        const val = counter;
        await delay(1);
        counter = val + 1;
      })
    );

    await Promise.all(tasks);
    expect(counter).toBe(iterations); // Without mutex, this would be < iterations
  });
});
