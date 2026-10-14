// Scheduler-scale evidence: pushes a lazily generated source through the real bulk orchestrator
// against a controlled in-memory sink. This measures orchestration bounds and accounting, NOT
// MongoDB write throughput. Set MONGODOCK_SCALE_URI (+ MONGODOCK_TEST_ALLOW_EXTERNAL=1 for a
// non-fixture server) to also run a smaller real-database workload.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { normalizeConfig } from "../src/config.js";
import { createExecutor } from "../src/hooks/pipeline.js";
import { createOperations } from "../src/operations/index.js";

const TOTAL = Number(process.env.MONGODOCK_SCALE_TOTAL ?? 1_000_000);
const BATCH = 1000;
const CONCURRENCY = 8;
const PAYLOADS = [0, 256];
const mb = (/** @type {number} */ n) => Math.round((n / 1024 / 1024) * 10) / 10;

async function schedulerRun(/** @type {number} */ total, /** @type {number} */ payload) {
  const config = normalizeConfig({ uri: "mongodb://localhost:27017/x" });
  const executor = createExecutor({ config });
  const state = { generated: 0, done: 0, active: 0, maxActive: 0, maxBuffered: 0, calls: 0 };
  let closed = false;
  const filler = "x".repeat(payload);
  function* source() {
    try {
      for (let i = 0; i < total; i++) {
        state.generated++;
        state.maxBuffered = Math.max(state.maxBuffered, state.generated - state.done);
        yield { insertOne: { document: { n: i, filler } } };
      }
    } finally {
      closed = true;
    }
  }
  const model = {
    modelName: "Scale",
    async bulkWrite(/** @type {any[]} */ ops) {
      state.calls++;
      state.active++;
      state.maxActive = Math.max(state.maxActive, state.active);
      // Skewed latency: every 7th batch is slow, so uneven slots must still honour the cap.
      await new Promise((resolve) => setTimeout(resolve, state.calls % 7 === 0 ? 4 : 1));
      state.active--;
      state.done += ops.length;
      return { insertedCount: ops.length, matchedCount: 0, modifiedCount: 0, deletedCount: 0 };
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

  let peakHeap = 0;
  const sampler = setInterval(() => {
    peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
  }, 50);
  const startedAt = performance.now();
  const report = await bulk({
    model: "Scale",
    batching: true,
    operations: source(),
    batchSize: BATCH,
    concurrency: CONCURRENCY,
    maxBatchBytes: 64 * 1024 * 1024,
  });
  const seconds = (performance.now() - startedAt) / 1000;
  clearInterval(sampler);

  assert.equal(report.status, "completed");
  assert.equal(report.consumed, total);
  assert.equal(report.attempted, total);
  assert.equal(report.insertedCount, total);
  assert.equal(report.uncertain, 0);
  assert.equal(state.done, total, "every operation dispatched exactly once");
  assert.ok(state.maxActive <= CONCURRENCY, `active ${state.maxActive} > ${CONCURRENCY}`);
  // One window of batches plus the batch being assembled is the architectural ceiling.
  const ceiling = BATCH * (CONCURRENCY + 1);
  assert.ok(state.maxBuffered <= ceiling, `buffered ${state.maxBuffered} > ${ceiling}`);
  assert.ok(report.diagnostics.samples.length <= 100, "diagnostic samples stay capped");
  assert.equal(closed, true, "source iterator cleaned up");
  return {
    total,
    payload,
    seconds: Math.round(seconds * 10) / 10,
    opsPerSec: Math.round(total / seconds),
    maxActive: state.maxActive,
    maxBuffered: state.maxBuffered,
    peakHeapMb: mb(peakHeap),
    rssMb: mb(process.memoryUsage().rss),
  };
}

async function realRun() {
  const uri = process.env.MONGODOCK_SCALE_URI;
  if (!uri) return undefined;
  const total = Number(process.env.MONGODOCK_SCALE_REAL_TOTAL ?? 50_000);
  const { createMongoService } = await import("../src/index.js");
  const db = createMongoService({
    uri,
    options: { dbName: `mongodock_test_${randomUUID().replaceAll("-", "")}` },
  });
  try {
    await db.connectAll();
    db.registerModel({
      name: "Scale",
      schema: new mongoose.Schema({ n: Number }, { autoIndex: false }),
    });
    await db.getModel("Scale").createCollection();
    function* source() {
      for (let i = 0; i < total; i++) yield { insertOne: { document: { n: i } } };
    }
    const startedAt = performance.now();
    const report = await db.bulkWrite({
      model: "Scale",
      batching: true,
      operations: source(),
      concurrency: CONCURRENCY,
    });
    const seconds = (performance.now() - startedAt) / 1000;
    assert.equal(report.status, "completed");
    assert.equal(await db.countDocuments({ model: "Scale", filter: {} }), total);
    return {
      total,
      seconds: Math.round(seconds * 10) / 10,
      opsPerSec: Math.round(total / seconds),
    };
  } finally {
    await db.getConnection().dropDatabase();
    await db.disconnectAll();
  }
}

console.log(
  `node ${process.version}, mongoose ${mongoose.version}, concurrency ${CONCURRENCY}, batch ${BATCH}`,
);
const rows = [];
for (const payload of PAYLOADS) {
  const row = await schedulerRun(TOTAL, payload);
  rows.push(row);
  console.log("scheduler-scale", JSON.stringify(row));
}
// Heap must not scale with input: compare against a run a tenth the size.
const small = await schedulerRun(Math.max(TOTAL / 10, 10_000), 0);
const big = /** @type {any} */ (rows[0]);
assert.ok(
  big.peakHeapMb <= Math.max(small.peakHeapMb * 3, small.peakHeapMb + 150),
  `heap grew with input: ${small.peakHeapMb} MB -> ${big.peakHeapMb} MB`,
);
const real = await realRun();
console.log(
  real
    ? `real-database ${JSON.stringify(real)}`
    : "real-database skipped (set MONGODOCK_SCALE_URI)",
);
console.log("scale ok");
