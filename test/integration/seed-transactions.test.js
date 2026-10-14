import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import mongoose from "mongoose";
import { skipWithoutReplicaSet } from "./topology.js";
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
    const schema = new mongoose.Schema(
      { key: { type: String, required: true }, n: Number },
      { autoIndex: false },
    );
    schema.index({ key: 1 }, { unique: true });
    db.registerModel({ name: "Item", schema });
    await db.getModel("Item").createCollection();
    await db.getModel("Item").createIndexes();
    await body(db);
  } finally {
    await db.getConnection().dropDatabase();
    await db.disconnectAll();
  }
}

const count = (/** @type {any} */ db) => db.countDocuments({ model: "Item", filter: {} });

it("commits a native seed and a bulkWrite in one transaction", async (t) => {
  if (await skipWithoutReplicaSet(t)) return;
  await withService(async (db) => {
    await db.withTransaction(async (/** @type {any} */ tx) => {
      await tx.ops.seed({ model: "Item", keyFields: ["key"], records: [{ key: "a", n: 1 }] });
      await tx.ops.bulkWrite({
        model: "Item",
        operations: [{ insertOne: { document: { key: "b", n: 2 } } }],
      });
    });
    assert.equal(await count(db), 2);
  });
});

it("rolls back seed and bulk writes when a later step fails", async (t) => {
  if (await skipWithoutReplicaSet(t)) return;
  await withService(async (db) => {
    await assert.rejects(
      db.withTransaction(async (/** @type {any} */ tx) => {
        await tx.ops.seed({ model: "Item", keyFields: ["key"], records: [{ key: "a", n: 1 }] });
        await tx.ops.bulkWrite({
          model: "Item",
          operations: [{ insertOne: { document: { key: "a", n: 2 } } }],
        });
      }),
    );
    assert.equal(await count(db), 0);
  });
});
