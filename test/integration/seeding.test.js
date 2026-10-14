import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import mongoose from "mongoose";
import { BulkError, createMongoService, InvalidOptionError } from "../../src/index.js";
import { skipWithoutReplicaSet } from "./topology.js";

const uri = () => {
  const value = process.env.MONGODOCK_TEST_URI;
  assert.ok(value, "Run through npm run test:integration");
  return value;
};

async function withService(/** @type {(db: any) => Promise<void>} */ body, { index = true } = {}) {
  const db = createMongoService({
    uri: uri(),
    options: { dbName: `mongodock_test_${randomUUID().replaceAll("-", "")}` },
  });
  try {
    await db.connectAll();
    const schema = new mongoose.Schema(
      {
        sku: { type: String, required: true },
        region: { type: String, default: "eu" },
        name: { type: String, required: true },
        price: { type: Number, min: 0 },
        origin: { type: String, immutable: true },
      },
      { autoIndex: false },
    );
    schema.index({ sku: 1, region: 1 }, { unique: true });
    db.registerModel({ name: "Product", schema });
    const model = db.getModel("Product");
    await model.createCollection();
    if (index) await model.createIndexes();
    await body(db);
  } finally {
    await db.getConnection().dropDatabase();
    await db.disconnectAll();
  }
}

const keys = ["sku", "region"];
const all = (/** @type {any} */ db) => db.find({ model: "Product", filter: {}, lean: true });
const records = (/** @type {number} */ n, extra = {}) =>
  Array.from({ length: n }, (_, i) => ({ sku: `s${i}`, region: "eu", name: `n${i}`, ...extra }));

it("is idempotent: repeating a seed leaves existing records untouched", async () => {
  await withService(async (db) => {
    const first = await db.seed({ model: "Product", keyFields: keys, records: records(5) });
    assert.equal(first.upsertedCount, 5);
    const edited = records(5).map((r) => ({ ...r, name: "changed" }));
    const second = await db.seed({ model: "Product", keyFields: keys, records: edited });
    assert.equal(second.upsertedCount, 0);
    const docs = await all(db);
    assert.equal(docs.length, 5);
    assert.ok(docs.every((/** @type {any} */ d) => d.name !== "changed"));
  });
});

it("updateExisting overwrites provided non-key fields and inserts missing records", async () => {
  await withService(async (db) => {
    await db.seed({ model: "Product", keyFields: keys, records: records(2, { price: 1 }) });
    const report = await db.seed({
      model: "Product",
      keyFields: keys,
      updateExisting: true,
      records: records(3, { price: 9 }),
    });
    assert.equal(report.upsertedCount, 1);
    const docs = await all(db);
    assert.equal(docs.length, 3);
    assert.ok(docs.every((/** @type {any} */ d) => d.price === 9));
  });
});

it("rejects before any write when the unique index is missing", async () => {
  await withService(
    async (db) => {
      await assert.rejects(
        db.seed({ model: "Product", keyFields: keys, records: records(2) }),
        (/** @type {any} */ error) =>
          error instanceof BulkError &&
          error.databaseOutcome === "notDispatched" &&
          /unique index/.test(error.message),
      );
      assert.equal((await all(db)).length, 0);
      await assert.rejects(
        db.seed({ model: "Product", keyFields: keys, dryRun: true, records: records(2) }),
        BulkError,
      );
    },
    { index: false },
  );
});

it("rejects an index that does not exactly match the key fields", async () => {
  await withService(async (db) => {
    await assert.rejects(
      db.seed({ model: "Product", keyFields: ["sku"], records: records(1) }),
      /unique index/,
    );
  });
});

it("dry-run plans without writing, in both modes", async () => {
  await withService(async (db) => {
    const native = await db.seed({
      model: "Product",
      keyFields: keys,
      dryRun: true,
      records: records(7),
    });
    assert.equal(native.status, "dry-run");
    assert.equal(native.planned, 7);
    const seen = /** @type {number[]} */ ([]);
    const batched = await db.seed({
      model: "Product",
      keyFields: keys,
      dryRun: true,
      batching: true,
      batchSize: 3,
      records: records(7),
      onBatch: (/** @type {any} */ b) => seen.push(b.size),
    });
    assert.deepEqual(seen, [3, 3, 1]);
    assert.equal(batched.batches, 3);
    assert.equal((await all(db)).length, 0);
  });
});

it("seeds an async source in parallel batches", async () => {
  await withService(async (db) => {
    async function* source() {
      for (const record of records(250)) yield record;
    }
    const report = await db.seed({
      model: "Product",
      keyFields: keys,
      batching: true,
      batchSize: 40,
      concurrency: 4,
      records: source(),
    });
    assert.equal(report.status, "completed");
    assert.equal(report.upsertedCount, 250);
    assert.equal(await db.countDocuments({ model: "Product", filter: {} }), 250);
  });
});

it("rejects a repeated key inside one batch and reports the record index", async () => {
  await withService(async (db) => {
    const data = [...records(3), { sku: "s1", region: "eu", name: "dup" }];
    await assert.rejects(
      db.seed({ model: "Product", keyFields: keys, records: data }),
      /records\[3\]: duplicate key within batch \(first at records\[1\]\)/,
    );
    await assert.rejects(
      db.seed({ model: "Product", keyFields: keys, batching: true, batchSize: 10, records: data }),
      (/** @type {any} */ error) => /records\[3\]: duplicate key/.test(error.message),
    );
    assert.equal((await all(db)).length, 0);
  });
});

it("validates with the schema and names the record and path, never the value", async () => {
  await withService(async (db) => {
    const bad = [...records(2), { sku: "secret-sku", region: "eu", name: "x", price: -5 }];
    await assert.rejects(
      db.seed({ model: "Product", keyFields: keys, records: bad }),
      (/** @type {any} */ error) =>
        error instanceof InvalidOptionError &&
        /records\[2\]: validation failed for price/.test(error.message) &&
        !error.message.includes("secret-sku"),
    );
    await assert.rejects(
      db.seed({
        model: "Product",
        keyFields: keys,
        updateExisting: true,
        records: [{ sku: "a", region: "eu", name: "a", origin: "x" }],
      }),
      /immutable field "origin"/,
    );
    await assert.rejects(
      db.seed({
        model: "Product",
        keyFields: keys,
        records: [{ sku: "a", region: "eu", name: "a", $set: { x: 1 } }],
      }),
      /operator-shaped/,
    );
  });
});

it("concurrent seeds of the same keys never duplicate records", async () => {
  await withService(async (db) => {
    const run = () =>
      db.seed({ model: "Product", keyFields: keys, batching: true, records: records(60) });
    const results = await Promise.allSettled([run(), run(), run()]);
    for (const result of results) {
      if (result.status === "rejected") assert.ok(result.reason instanceof BulkError);
    }
    assert.equal((await all(db)).length, 60);
  });
});

it("seeds inside a transaction and rolls back with it", async (t) => {
  if (await skipWithoutReplicaSet(t)) return;
  await withService(async (db) => {
    await assert.rejects(
      db.withTransaction(async (/** @type {any} */ tx) => {
        await tx.ops.seed({ model: "Product", keyFields: keys, records: records(4) });
        throw new Error("rollback");
      }),
      /rollback/,
    );
    assert.equal((await all(db)).length, 0);
    await db.withTransaction((/** @type {any} */ tx) =>
      tx.ops.seed({ model: "Product", keyFields: keys, records: records(4) }),
    );
    assert.equal((await all(db)).length, 4);
  });
});
