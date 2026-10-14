import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import mongoose from "mongoose";
import { createMongoService } from "../../src/index.js";

const uri = () => {
  const value = process.env.MONGODOCK_TEST_URI;
  assert.ok(value, "Run through npm run test:integration");
  return value;
};

async function withService(/** @type {(db: any) => Promise<void>} */ body) {
  const db = createMongoService({
    uri: uri(),
    options: { dbName: `mongodock_test_${randomUUID().replaceAll("-", "")}` },
  });
  try {
    await db.connectAll();
    for (const name of ["Source", "Target"]) {
      const schema = new mongoose.Schema(
        { key: { type: String, required: true }, n: Number },
        { autoIndex: false },
      );
      schema.index({ key: 1 }, { unique: true });
      db.registerModel({ name, schema });
      await db.getModel(name).createCollection();
      await db.getModel(name).createIndexes();
    }
    await body(db);
  } finally {
    await db.getConnection().dropDatabase();
    await db.disconnectAll();
  }
}

const slow = () => new Promise((resolve) => setTimeout(resolve, 2));

it("streams one collection into another through seed with a slow sink", async () => {
  await withService(async (db) => {
    const rows = Array.from({ length: 600 }, (_, i) => ({ key: `k${i}`, n: i }));
    await db.seed({ model: "Source", keyFields: ["key"], records: rows });

    async function* copy() {
      for await (const doc of db.iterate({ model: "Source", lean: true, batchSize: 50 })) {
        yield { key: doc.key, n: doc.n };
      }
    }
    let batches = 0;
    const report = await db.seed({
      model: "Target",
      keyFields: ["key"],
      batching: true,
      batchSize: 100,
      concurrency: 3,
      records: copy(),
      onBatch: async () => {
        batches++;
        await slow();
      },
    });
    assert.equal(report.status, "completed");
    assert.equal(report.consumed, 600);
    assert.equal(report.upsertedCount, 600);
    assert.equal(batches, 6);
    assert.equal(await db.countDocuments({ model: "Target", filter: {} }), 600);

    const again = await db.seed({
      model: "Target",
      keyFields: ["key"],
      batching: true,
      batchSize: 100,
      records: copy(),
    });
    assert.equal(again.upsertedCount, 0);
    assert.equal(await db.countDocuments({ model: "Target", filter: {} }), 600);
  });
});

it("disconnectAll drains an in-flight batched seed and then rejects new work", async () => {
  const dbName = `mongodock_test_${randomUUID().replaceAll("-", "")}`;
  const db = createMongoService({ uri: uri(), options: { dbName } });
  await db.connectAll();
  const schema = new mongoose.Schema(
    { key: { type: String, required: true } },
    { autoIndex: false },
  );
  schema.index({ key: 1 }, { unique: true });
  db.registerModel({ name: "Item", schema });
  await db.getModel("Item").createCollection();
  await db.getModel("Item").createIndexes();
  try {
    const rows = Array.from({ length: 300 }, (_, i) => ({ key: `k${i}` }));
    const pending = db.seed({
      model: "Item",
      keyFields: ["key"],
      batching: true,
      batchSize: 50,
      records: rows,
    });
    const closing = db.disconnectAll();
    const settled = await Promise.allSettled([pending, closing]);
    assert.equal(settled[1].status, "fulfilled");
    if (settled[0].status === "fulfilled") assert.equal(settled[0].value.consumed, 300);
    await assert.rejects(db.countDocuments({ model: "Item", filter: {} }));
  } finally {
    const cleanup = await mongoose.createConnection(uri(), { dbName }).asPromise();
    await cleanup.dropDatabase();
    await cleanup.close();
  }
});

it("cancelling mid-stream stops dispatch, closes the cursor and reports partial progress", async () => {
  await withService(async (db) => {
    const rows = Array.from({ length: 500 }, (_, i) => ({ key: `k${i}`, n: i }));
    await db.seed({ model: "Source", keyFields: ["key"], records: rows });
    const controller = new AbortController();
    async function* copy() {
      for await (const doc of db.iterate({ model: "Source", lean: true, batchSize: 25 })) {
        yield { key: doc.key, n: doc.n };
      }
    }
    await assert.rejects(
      db.seed({
        model: "Target",
        keyFields: ["key"],
        batching: true,
        batchSize: 50,
        concurrency: 1,
        signal: controller.signal,
        records: copy(),
        onBatch: () => controller.abort(),
      }),
      (/** @type {any} */ error) =>
        error.report !== undefined && error.databaseOutcome === "partial",
    );
    const written = await db.countDocuments({ model: "Target", filter: {} });
    assert.ok(written > 0 && written < 500, `written ${written}`);
  });
});
