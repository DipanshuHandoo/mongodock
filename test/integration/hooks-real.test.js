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

async function withHooks(/** @type {(db: any, calls: string[]) => Promise<void>} */ body) {
  const calls = /** @type {string[]} */ ([]);
  const db = createMongoService({
    uri: uri(),
    options: { dbName: `mongodock_test_${randomUUID().replaceAll("-", "")}` },
    hooks: {
      onSuccess: () => {
        calls.push("success");
      },
      onError: () => {
        calls.push("error");
      },
      onComplete: () => {
        calls.push("complete");
      },
    },
  });
  try {
    await db.connectAll();
    const schema = new mongoose.Schema(
      { key: { type: String, required: true } },
      { autoIndex: false },
    );
    schema.index({ key: 1 }, { unique: true });
    db.registerModel({ name: "Item", schema });
    await db.getModel("Item").createCollection();
    await db.getModel("Item").createIndexes();
    await body(db, calls);
  } finally {
    await db.getConnection().dropDatabase();
    await db.disconnectAll();
  }
}

it("runs onSuccess then onComplete once for a successful real write", async () => {
  await withHooks(async (db, calls) => {
    calls.length = 0;
    await db.insertMany({ model: "Item", data: [{ key: "a" }, { key: "b" }] });
    assert.deepEqual(calls, ["success", "complete"]);
  });
});

it("runs onError then onComplete once for a real duplicate-key failure", async () => {
  await withHooks(async (db, calls) => {
    await db.create({ model: "Item", data: { key: "a" } });
    calls.length = 0;
    await assert.rejects(db.create({ model: "Item", data: { key: "a" } }));
    assert.deepEqual(calls, ["error", "complete"]);
  });
});

it("runs onError then onComplete once for a partial unordered bulk report", async () => {
  await withHooks(async (db, calls) => {
    await db.create({ model: "Item", data: { key: "a" } });
    calls.length = 0;
    await assert.rejects(
      db.insertMany({
        model: "Item",
        data: [{ key: "a" }, { key: "c" }],
        options: { ordered: false },
      }),
    );
    assert.deepEqual(calls, ["error", "complete"]);
    assert.equal(await db.countDocuments({ model: "Item", filter: {} }), 2);
  });
});

it("surfaces an unsatisfiable write concern as one error with hooks fired once", async (t) => {
  if (await skipWithoutReplicaSet(t)) return;
  await withHooks(async (db, calls) => {
    calls.length = 0;
    await assert.rejects(
      db.insertMany({ model: "Item", data: [{ key: "w" }], options: { writeConcern: { w: 5 } } }),
    );
    assert.deepEqual(calls, ["error", "complete"]);
  });
});
