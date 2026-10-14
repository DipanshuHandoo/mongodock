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

async function withItems(/** @type {(db: any, name: string) => Promise<void>} */ body) {
  const db = createMongoService({
    uri: uri(),
    options: { dbName: `mongodock_test_${randomUUID().replaceAll("-", "")}` },
  });
  try {
    await db.connectAll();
    const schema = new mongoose.Schema({
      key: { type: String, unique: true, required: true },
      n: Number,
    });
    db.registerModel({ name: "Item", schema });
    await db.getModel("Item").createIndexes();
    await body(db, "Item");
  } finally {
    for (const status of db.listStatuses()) {
      if (status.state === "ready") await db.getConnection(status.name).dropDatabase();
    }
    await db.disconnectAll();
  }
}

const doc = (/** @type {string | undefined} */ key, n = 0) => ({
  insertOne: { document: { key, n } },
});

it("batched unordered write maps duplicate-key and validation failures to input indexes", async () => {
  await withItems(async (db, model) => {
    await db.create({ model, data: { key: "dup" } });
    const operations = [doc("a"), doc("dup"), doc(undefined), doc("b"), doc("c")];
    const report = await db.bulkWrite({ model, batching: true, operations, batchSize: 5 });
    assert.equal(report.status, "partial");
    assert.equal(report.failed, 2);
    assert.equal(report.knownSucceeded, 3);
    assert.equal(report.insertedCount, 3);
    const found = report.diagnostics.samples
      .map((/** @type {any} */ s) => [s.index, s.kind])
      .sort();
    assert.deepEqual(found, [
      [1, "write"],
      [2, "validation"],
    ]);
    assert.equal(await db.countDocuments({ model }), 4);
  });
});

it("batched ordered write stops at the first failure", async () => {
  await withItems(async (db, model) => {
    await db.create({ model, data: { key: "dup" } });
    const operations = [doc("a"), doc("dup"), doc("never")];
    const report = await db.bulkWrite({
      model,
      batching: true,
      operations,
      ordered: true,
      batchSize: 3,
    });
    assert.equal(report.knownSucceeded, 1);
    assert.equal(report.failed, 1);
    assert.equal(report.unattempted, 1);
    assert.equal(await db.exists({ model, filter: { key: "never" } }), false);
  });
});

it("processes a large lazy source in parallel batches", async () => {
  await withItems(async (db, model) => {
    const total = 5000;
    async function* source() {
      for (let i = 0; i < total; i++) yield doc(`k${i}`, i);
    }
    const report = await db.bulkWrite({
      model,
      batching: true,
      operations: source(),
      batchSize: 250,
      concurrency: 4,
    });
    assert.equal(report.status, "completed");
    assert.equal(report.insertedCount, total);
    assert.equal(await db.countDocuments({ model }), total);
  });
});

it("native mode returns the driver result", async () => {
  await withItems(async (db, model) => {
    const result = await db.bulkWrite({ model, operations: [doc("x"), doc("y")] });
    assert.equal(result.insertedCount, 2);
  });
});
