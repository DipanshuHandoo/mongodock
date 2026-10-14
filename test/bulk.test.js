import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createBatches } from "../src/bulk/batches.js";
import { summarizeBatch } from "../src/bulk/outcomes.js";
import { normalizeConfig } from "../src/config.js";
import { BulkError, InvalidOptionError, OperationAbortedError } from "../src/errors.js";
import { createExecutor } from "../src/hooks/pipeline.js";
import { createOperations } from "../src/operations/index.js";

const insert = (/** @type {number} */ n) => ({ insertOne: { document: { n } } });
const many = (/** @type {number} */ count) => Array.from({ length: count }, (_, i) => insert(i));
const result = (/** @type {number} */ n) => ({ insertedCount: n, matchedCount: 0 });
const bulkError = (/** @type {any} */ extra) =>
  Object.assign(new Error("bulk"), { name: "MongoBulkWriteError", ...extra });

/**
 * @param {(ops: any[], options: any, call: number) => any} handler
 * @param {Record<string, unknown>} [extra]
 */
function setup(handler, extra = {}) {
  const config = normalizeConfig({ uri: "mongodb://localhost:27017/x", ...extra });
  const executor = createExecutor({ config });
  const state = { calls: 0, active: 0, maxActive: 0 };
  const model = {
    modelName: "Thing",
    async bulkWrite(/** @type {any[]} */ ops, /** @type {any} */ options) {
      const call = state.calls++;
      state.active++;
      state.maxActive = Math.max(state.maxActive, state.active);
      try {
        return await handler(ops, options, call);
      } finally {
        state.active--;
      }
    },
  };
  const bulk = /** @type {any} */ (
    createOperations({
      executor,
      config,
      connection: "default",
      resolveModel: () => /** @type {any} */ (model),
    })
  ).bulkWrite;
  return { bulk, state };
}

const ok = (/** @type {any[]} */ ops) => result(ops.length);

describe("createBatches", () => {
  it("splits by record count and by estimated bytes", async () => {
    const byCount = [];
    for await (const b of createBatches(many(5), { batchSize: 2, maxBatchBytes: 1e6 })) {
      byCount.push([b.index, b.startIndex, b.ops.length]);
    }
    assert.deepEqual(byCount, [
      [0, 0, 2],
      [1, 2, 2],
      [2, 4, 1],
    ]);
    const sizes = [];
    for await (const b of createBatches(many(4), { batchSize: 100, maxBatchBytes: 80 })) {
      sizes.push(b.ops.length);
    }
    assert.ok(sizes.length > 1 && sizes.every((s) => s >= 1));
  });

  it("rejects one operation larger than the byte limit", async () => {
    const big = [{ insertOne: { document: { text: "x".repeat(500) } } }];
    await assert.rejects(async () => {
      for await (const _ of createBatches(big, { batchSize: 10, maxBatchBytes: 100 }));
    }, InvalidOptionError);
  });

  it("closes the source iterator on early return", async () => {
    let closed = false;
    async function* source() {
      try {
        yield* many(10);
      } finally {
        closed = true;
      }
    }
    const it = createBatches(source(), { batchSize: 2, maxBatchBytes: 1e6 });
    await it.next();
    await it.return(undefined);
    assert.equal(closed, true);
  });
});

describe("summarizeBatch", () => {
  const batch = { index: 0, startIndex: 100, ops: many(4), bytes: 10 };
  const ctx = { ordered: false, elapsedMs: 1 };

  it("remaps unordered validation and write errors to input positions", () => {
    const validation = Object.assign(new Error("v"), { name: "ValidationError" });
    const write = { code: 11000 };
    const out = summarizeBatch(
      batch,
      {
        ok: false,
        error: bulkError({
          result: { insertedCount: 2 },
          mongoose: { results: [null, validation, null, write] },
        }),
      },
      ctx,
    );
    assert.equal(out.attempted, 3);
    assert.equal(out.failed, 2);
    assert.equal(out.succeeded, 2);
    assert.deepEqual(
      out.errors.map((e) => [e.index, e.kind]),
      [
        [101, "validation"],
        [103, "write"],
      ],
    );
    assert.equal(JSON.stringify(out.errors).includes("message"), false);
  });

  it("accounts for ordered failure with unattempted tail", () => {
    const out = summarizeBatch(
      batch,
      { ok: false, error: bulkError({ writeErrors: [{ index: 1, code: 11000 }] }) },
      { ordered: true, elapsedMs: 1 },
    );
    assert.deepEqual(
      [out.succeeded, out.failed, out.unattempted, out.status],
      [1, 1, 2, "partial"],
    );
  });

  it("treats write-concern failure and transport errors as uncertain", () => {
    const concern = summarizeBatch(
      batch,
      { ok: false, error: bulkError({ writeConcernError: { code: 64 }, result: {} }) },
      ctx,
    );
    assert.deepEqual([concern.uncertain, concern.succeeded, concern.status], [4, 0, "uncertain"]);
    const net = summarizeBatch(
      batch,
      { ok: false, error: Object.assign(new Error("n"), { name: "MongoNetworkError" }) },
      ctx,
    );
    assert.deepEqual([net.uncertain, net.errors[0]?.kind], [4, "transport"]);
  });

  it("treats an ordered pre-dispatch validation error as unattempted", () => {
    const out = summarizeBatch(
      batch,
      { ok: false, error: Object.assign(new Error("v"), { name: "ValidationError" }) },
      { ordered: true, elapsedMs: 1 },
    );
    assert.deepEqual([out.unattempted, out.attempted, out.status], [4, 0, "unattempted"]);
  });
});

describe("bulkWrite native mode", () => {
  it("passes the operations and options straight through", async () => {
    const seen = /** @type {any[]} */ ([]);
    const { bulk } = setup((ops, options) => {
      seen.push([ops.length, options]);
      return result(ops.length);
    });
    const r = await bulk({ model: "Thing", operations: many(3), options: { ordered: false } });
    assert.equal(r.insertedCount, 3);
    assert.deepEqual(seen[0], [3, { ordered: false }]);
  });

  it("rejects batch-only keys, empty input, unknown ops, and unfiltered deletes", async () => {
    const { bulk } = setup(ok);
    await assert.rejects(
      bulk({ model: "Thing", operations: many(1), batchSize: 2 }),
      InvalidOptionError,
    );
    await assert.rejects(bulk({ model: "Thing", operations: [] }), InvalidOptionError);
    await assert.rejects(bulk({ model: "Thing", operations: [{ bogus: {} }] }), InvalidOptionError);
    await assert.rejects(
      bulk({ model: "Thing", operations: [{ deleteMany: { filter: {} } }] }),
      InvalidOptionError,
    );
    await bulk({
      model: "Thing",
      operations: [{ deleteMany: { filter: {} } }],
      allowAll: true,
    });
  });

  it("rejects the native error unchanged", async () => {
    const failure = bulkError({});
    const { bulk } = setup(() => {
      throw failure;
    });
    await assert.rejects(bulk({ model: "Thing", operations: many(1) }), (e) => e === failure);
  });
});

describe("bulkWrite batched mode", () => {
  it("bounds active writes to concurrency and reports a complete run", async () => {
    const { bulk, state } = setup(async (ops) => {
      await new Promise((r) => setTimeout(r, 5));
      return ok(ops);
    });
    const outcomes = /** @type {any[]} */ ([]);
    const report = await bulk({
      model: "Thing",
      batching: true,
      operations: many(23),
      batchSize: 2,
      concurrency: 3,
      onBatch: (/** @type {any} */ o) => {
        outcomes.push(o.batchIndex);
      },
    });
    assert.equal(report.status, "completed");
    assert.equal(report.consumed, 23);
    assert.equal(report.knownSucceeded, 23);
    assert.equal(report.insertedCount, 23);
    assert.equal(report.batches.total, 12);
    assert.equal(report.unattempted, 0);
    assert.ok(state.maxActive <= 3 && state.maxActive > 1);
    assert.equal(new Set(outcomes).size, 12);
  });

  it("accepts lazy async sources without materializing them", async () => {
    let pulled = 0;
    async function* source() {
      for (let i = 0; i < 50; i++) {
        pulled++;
        yield insert(i);
      }
    }
    const { bulk, state } = setup(async (ops) => {
      assert.ok(pulled - state.calls * 5 <= 10 + 5, "pulls stay within the window");
      return ok(ops);
    });
    const report = await bulk({
      model: "Thing",
      batching: true,
      operations: source(),
      batchSize: 5,
      concurrency: 2,
    });
    assert.equal(report.consumed, 50);
    assert.equal(report.status, "completed");
  });

  it("continues past failed batches and reports a partial result", async () => {
    const { bulk } = setup((ops, _o, call) => {
      if (call === 1) throw bulkError({ writeErrors: [{ index: 0, code: 11000 }], result: {} });
      return ok(ops);
    });
    const report = await bulk({
      model: "Thing",
      batching: true,
      operations: many(6),
      batchSize: 2,
      concurrency: 1,
    });
    assert.equal(report.status, "partial");
    assert.equal(report.failed, 1);
    assert.equal(report.knownSucceeded, 5);
    assert.equal(report.diagnostics.samples[0]?.kind, "write");
    assert.equal(JSON.stringify(report.diagnostics).includes("bulk"), false);
  });

  it("stops dispatch under failureMode stop and counts the rest as unattempted", async () => {
    const { bulk, state } = setup((ops, _o, call) => {
      if (call === 0) throw bulkError({ writeErrors: [{ index: 0, code: 1 }], result: {} });
      return ok(ops);
    });
    const report = await bulk({
      model: "Thing",
      batching: true,
      operations: many(10),
      batchSize: 2,
      concurrency: 1,
      failureMode: "stop",
    });
    assert.equal(state.calls, 1);
    assert.equal(report.status, "partial");
    assert.equal(report.unattempted, 8);
    assert.equal(report.consumed, 2);
  });

  it("fires onError for non-completed reports but still resolves", async () => {
    const events = /** @type {any[]} */ ([]);
    const { bulk } = setup(() => {
      throw Object.assign(new Error("n"), { name: "MongoNetworkError" });
    });
    const report = await bulk({
      model: "Thing",
      batching: true,
      operations: many(2),
      hooks: {
        onSuccess: () => events.push("success"),
        onError: () => events.push("error"),
        onComplete: () => events.push("complete"),
      },
    });
    assert.equal(report.status, "partial");
    assert.equal(report.uncertain, 2);
    assert.deepEqual(events, ["error", "complete"]);
  });

  it("rejects with BulkError carrying the partial report when onBatch throws", async () => {
    const { bulk } = setup(ok);
    await assert.rejects(
      bulk({
        model: "Thing",
        batching: true,
        operations: many(8),
        batchSize: 2,
        concurrency: 1,
        onBatch: () => {
          throw new Error("sink down");
        },
      }),
      (e) => e instanceof BulkError && e.report?.consumed === 2 && e.report.status !== "completed",
    );
  });

  it("rejects with BulkError when the source fails mid-stream", async () => {
    async function* source() {
      yield insert(1);
      yield insert(2);
      throw new Error("source broke");
    }
    const { bulk } = setup(ok);
    await assert.rejects(
      bulk({ model: "Thing", batching: true, operations: source(), batchSize: 2 }),
      (e) => e instanceof BulkError && e.report?.attempted === 2 && e.cause instanceof Error,
    );
  });

  it("cancels cleanly, closes the source, and attaches a report", async () => {
    const controller = new AbortController();
    let closed = false;
    async function* source() {
      try {
        for (let i = 0; i < 100; i++) yield insert(i);
      } finally {
        closed = true;
      }
    }
    const { bulk, state } = setup(ok);
    await assert.rejects(
      bulk({
        model: "Thing",
        batching: true,
        operations: source(),
        batchSize: 2,
        concurrency: 1,
        signal: controller.signal,
        onBatch: () => controller.abort(),
      }),
      (e) =>
        e instanceof OperationAbortedError && /** @type {any} */ (e).report.status === "cancelled",
    );
    assert.equal(closed, true);
    assert.equal(state.calls, 1);
  });

  it("enforces ordered and session constraints", async () => {
    const { bulk } = setup(ok);
    const base = { model: "Thing", batching: true, operations: many(2) };
    await assert.rejects(bulk({ ...base, ordered: true, concurrency: 2 }), InvalidOptionError);
    await assert.rejects(
      bulk({ ...base, ordered: true, failureMode: "continue" }),
      InvalidOptionError,
    );
    await assert.rejects(bulk({ ...base, options: { ordered: false } }), InvalidOptionError);
    await assert.rejects(bulk({ ...base, concurrency: 99 }), InvalidOptionError);
    await assert.rejects(bulk({ ...base, batchSize: 0 }), InvalidOptionError);
    await assert.rejects(bulk({ ...base, operations: "nope" }), InvalidOptionError);
    const seen = /** @type {any[]} */ ([]);
    const ordered = setup((ops, options) => {
      seen.push(options.ordered);
      return ok(ops);
    });
    const r = await ordered.bulk({ ...base, ordered: true });
    assert.equal(r.ordered, true);
    assert.deepEqual(seen, [true]);
  });

  it("validates arrays fully before dispatching anything", async () => {
    const { bulk, state } = setup(ok);
    await assert.rejects(
      bulk({
        model: "Thing",
        batching: true,
        operations: [insert(1), insert(2), { nope: 1 }],
        batchSize: 1,
      }),
      InvalidOptionError,
    );
    assert.equal(state.calls, 0);
  });

  it("caps diagnostics by sample count", async () => {
    const { bulk } = setup(
      () => {
        throw bulkError({
          result: {},
          writeErrors: Array.from({ length: 50 }, (_, index) => ({ index, code: 11000 })),
        });
      },
      { limits: { diagnosticSamples: 5 } },
    );
    const report = await bulk({
      model: "Thing",
      batching: true,
      operations: many(50),
      batchSize: 50,
    });
    assert.equal(report.diagnostics.samples.length, 5);
    assert.equal(report.diagnostics.omitted, 45);
  });

  it("lets hooks add report fields but not rewrite built-in ones", async () => {
    const { bulk } = setup(ok);
    const report = await bulk({
      model: "Thing",
      batching: true,
      operations: many(2),
      hooks: {
        afterOperation: () => ({
          result: { status: "failed", extra: 1, consumed: 99, mode: "batched" },
        }),
      },
    });
    assert.equal(report.status, "completed");
    assert.equal(report.consumed, 2);
    assert.equal(/** @type {any} */ (report).extra, 1);
  });
});
