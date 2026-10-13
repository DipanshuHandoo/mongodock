import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeConfig } from "../src/config.js";
import { createExecutor } from "../src/hooks/pipeline.js";
import { HookError, OperationAbortedError } from "../src/index.js";
import {
  abortableDelay,
  computeDelay,
  isTransientReadError,
  resolveRetry,
} from "../src/retry/read-policy.js";

const URI = "mongodb://localhost:27017/x";
const fast = { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 2 };

/** @param {Record<string, unknown>} [extra] */
const make = (extra = {}) =>
  createExecutor({ config: normalizeConfig({ uri: URI, ...extra }), random: () => 0 });

const named = (/** @type {string} */ name) => Object.assign(new Error(name), { name });
const coded = (/** @type {number} */ code) => Object.assign(new Error("c"), { code });

/** @param {number} failures */
function flaky(failures, error = () => named("MongoNetworkError")) {
  const state = { calls: 0 };
  return {
    state,
    run: async () => {
      state.calls += 1;
      if (state.calls <= failures) throw error();
      return "ok";
    },
  };
}

describe("classification", () => {
  it("flags transient driver classes and codes for Mongoose 8 and 9 drivers", () => {
    for (const name of [
      "MongoServerSelectionError",
      "MongoNetworkError",
      "MongoNetworkTimeoutError",
      "MongooseServerSelectionError",
      "MongoPoolClearedError",
      "MongoNotConnectedError",
    ]) {
      assert.equal(isTransientReadError(named(name)), true, name);
    }
    for (const code of [6, 7, 91, 189, 11600, 11602, 10107, 13435, 13436, 89, 9001]) {
      assert.equal(isTransientReadError(coded(code)), true, String(code));
    }
  });

  it("never retries cancellation, maxTimeMS expiry, or message-only matches", () => {
    assert.equal(isTransientReadError(named("AbortError")), false);
    assert.equal(isTransientReadError(coded(50)), false);
    assert.equal(isTransientReadError(new Error("ECONNRESET network error")), false);
    assert.equal(isTransientReadError(null), false);
    assert.equal(isTransientReadError("x"), false);
  });
});

describe("policy resolution", () => {
  it("is disabled without configuration", () => {
    const config = normalizeConfig({ uri: URI });
    assert.equal(resolveRetry(config, undefined, false).enabled, false);
  });

  it("activates for a call-level beforeRetry and per-call settings", () => {
    const config = normalizeConfig({ uri: URI });
    assert.equal(resolveRetry(config, undefined, true).enabled, true);
    assert.equal(resolveRetry(config, { maxRetries: 1 }, false).maxRetries, 1);
    assert.equal(resolveRetry(config, true, false).enabled, true);
  });

  it("disables per call with false and honors explicit service disable over call hooks", () => {
    const config = normalizeConfig({ uri: URI, retry: fast });
    assert.equal(resolveRetry(config, false, false).enabled, false);
    const off = normalizeConfig({ uri: URI, retry: false });
    assert.equal(resolveRetry(off, undefined, true).enabled, false);
  });

  it("computes full-jitter delay within bounds", () => {
    const policy = { maxRetries: 5, baseDelayMs: 100, maxDelayMs: 1000, totalBudgetMS: 10_000 };
    assert.equal(
      computeDelay(/** @type {any} */ (policy), 1, () => 0),
      0,
    );
    assert.equal(
      computeDelay(/** @type {any} */ (policy), 1, () => 0.999999),
      100,
    );
    assert.equal(
      computeDelay(/** @type {any} */ (policy), 10, () => 0.999999),
      1000,
    );
  });

  it("aborts a delay before and during the wait", async () => {
    await assert.rejects(abortableDelay(50, AbortSignal.abort()), OperationAbortedError);
    const controller = new AbortController();
    const wait = abortableDelay(10_000, controller.signal);
    controller.abort();
    await assert.rejects(wait, OperationAbortedError);
  });
});

describe("retry execution", () => {
  it("retries a transient read with bounded attempts and reports attempt numbers", async () => {
    const executor = make({ retry: fast });
    const job = flaky(2);
    const attempts = /** @type {number[]} */ ([]);
    const result = await executor.execute({
      method: "find",
      retryable: true,
      run: async (/** @type {unknown} */ _i, /** @type {any} */ c) => {
        attempts.push(c.attempt);
        return job.run();
      },
    });
    assert.equal(result, "ok");
    assert.deepEqual(attempts, [1, 2, 3]);
  });

  it("exhausts retries and rethrows the native error", async () => {
    const executor = make({ retry: fast });
    const job = flaky(10);
    await assert.rejects(
      executor.execute({ method: "find", retryable: true, run: job.run }),
      (/** @type {any} */ error) => error.name === "MongoNetworkError",
    );
    assert.equal(job.state.calls, 3);
  });

  it("does not rerun beforeOperation on retries", async () => {
    let before = 0;
    const executor = make({
      retry: fast,
      hooks: {
        beforeOperation: () => {
          before += 1;
        },
      },
    });
    await executor.execute({ method: "find", retryable: true, run: flaky(2).run });
    assert.equal(before, 1);
  });

  it("never retries writes, transactions, non-retryable methods, or non-transient errors", async () => {
    const executor = make({ retry: fast });
    for (const options of [
      { method: "find", retryable: true, write: true },
      { method: "find", retryable: true, transactional: true },
      { method: "find", retryable: false },
      { method: "updateOne", retryable: true },
    ]) {
      const job = flaky(5);
      await executor.execute({ ...options, run: job.run }).catch(() => undefined);
      assert.equal(job.state.calls, 1, JSON.stringify(options));
    }
    const job = flaky(5, () => new Error("logic"));
    await executor.execute({ method: "find", retryable: true, run: job.run }).catch(() => 0);
    assert.equal(job.state.calls, 1);
  });

  it("lets beforeRetry veto with the last database error", async () => {
    const executor = make({ retry: fast, hooks: { beforeRetry: () => false } });
    const job = flaky(5);
    await assert.rejects(
      executor.execute({ method: "find", retryable: true, run: job.run }),
      (/** @type {any} */ error) => error.name === "MongoNetworkError",
    );
    assert.equal(job.state.calls, 1);
  });

  it("wraps a throwing beforeRetry as HookError with original", async () => {
    const executor = make({
      retry: fast,
      hooks: {
        beforeRetry: () => {
          throw new Error("hook");
        },
      },
    });
    await assert.rejects(
      executor.execute({ method: "find", retryable: true, run: flaky(5).run }),
      (/** @type {any} */ error) =>
        error instanceof HookError &&
        /** @type {any} */ (error.original)?.name === "MongoNetworkError",
    );
  });

  it("is activated by a per-call beforeRetry hook and per-call settings", async () => {
    const executor = make();
    const seen = /** @type {number[]} */ ([]);
    const job = flaky(1);
    const result = await executor.execute({
      method: "find",
      retryable: true,
      retry: fast,
      hooks: { beforeRetry: (/** @type {any} */ r) => void seen.push(r.nextAttempt) },
      run: job.run,
    });
    assert.equal(result, "ok");
    assert.deepEqual(seen, [2]);
  });

  it("stops when the total budget would be exceeded", async () => {
    const executor = createExecutor({
      config: normalizeConfig({
        uri: URI,
        retry: { maxRetries: 5, baseDelayMs: 50, maxDelayMs: 50, totalBudgetMS: 10 },
      }),
      random: () => 1,
    });
    const job = flaky(5);
    await executor.execute({ method: "find", retryable: true, run: job.run }).catch(() => 0);
    assert.equal(job.state.calls, 1);
  });

  it("aborts during the retry wait and reports cancelled", async () => {
    const executor = createExecutor({
      config: normalizeConfig({
        uri: URI,
        retry: { maxRetries: 2, baseDelayMs: 5000, maxDelayMs: 5000 },
      }),
      random: () => 1,
    });
    const controller = new AbortController();
    const outcomes = /** @type {string[]} */ ([]);
    const job = flaky(5);
    const pending = executor.execute({
      method: "find",
      retryable: true,
      signal: controller.signal,
      hooks: { onError: (/** @type {any} */ c) => outcomes.push(c.invocationOutcome) },
      run: job.run,
    });
    setTimeout(() => controller.abort(), 20);
    await assert.rejects(pending, OperationAbortedError);
    assert.deepEqual(outcomes, ["cancelled"]);
    assert.equal(job.state.calls, 1);
  });
});
