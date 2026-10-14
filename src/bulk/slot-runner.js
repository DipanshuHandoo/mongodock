import { asyncSlotPool } from "@dipanshuhandoo/async-slot-pool";

/**
 * Pulls bounded windows of batches and runs each window through async-slot-pool. The pool
 * receives an array (never the source), retries and timeouts are disabled so a scheduling
 * timeout can never release a slot while its write is still running, and `handle` must settle
 * every batch itself: pool failure lists are stringified and are not used for outcomes.
 * Nothing is retained across windows.
 * @template B
 * @param {object} options
 * @param {() => Promise<B | null>} options.pull Resolves null when the source is exhausted.
 * @param {(batch: B) => Promise<void>} options.handle Never rejects.
 * @param {() => boolean} options.shouldStop Checked before each pull.
 * @param {number} options.concurrency
 * @param {number} [options.windowFactor] Window size as a multiple of concurrency.
 */
export async function runWindows({ pull, handle, shouldStop, concurrency, windowFactor = 1 }) {
  const size = concurrency * windowFactor;
  let exhausted = false;
  while (!exhausted) {
    /** @type {B[]} */
    const window = [];
    while (window.length < size && !shouldStop()) {
      const batch = await pull();
      if (batch === null) {
        exhausted = true;
        break;
      }
      window.push(batch);
    }
    if (window.length === 0) break;
    const { failed } = await asyncSlotPool(window, (batch) => handle(batch), {
      concurrency: Math.min(concurrency, window.length),
      retries: 0,
      timeout: 0,
    });
    if (failed.length > 0) {
      throw new Error(`Slot pool reported an unhandled task failure: ${failed[0]?.error}`);
    }
    if (shouldStop()) break;
  }
  return { exhausted };
}
