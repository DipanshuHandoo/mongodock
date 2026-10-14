import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import mongoose from "mongoose";
import { skipWithoutReplicaSet } from "./topology.js";
import { createMongoService, TransactionError } from "../../src/index.js";

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
    const schema = new mongoose.Schema({ key: { type: String, unique: true }, n: Number });
    db.registerModel({ name: "Account", schema });
    // Collections must exist before a transaction can write to them.
    await db.getModel("Account").createCollection();
    await db.getModel("Account").createIndexes();
    await body(db);
  } finally {
    await db.getConnection().dropDatabase();
    await db.disconnectAll();
  }
}

const count = (/** @type {any} */ db) => db.countDocuments({ model: "Account", filter: {} });

it("commits every scoped write and returns the callback value", async (t) => {
  if (await skipWithoutReplicaSet(t)) return;
  await withService(async (db) => {
    const result = await db.withTransaction(async (/** @type {any} */ tx) => {
      await tx.ops.create({ model: "Account", data: { key: "a", n: 1 } });
      await tx.ops.create({ model: "Account", data: { key: "b", n: 2 } });
      const inside = await tx.ops.countDocuments({ model: "Account", filter: {} });
      return { inside };
    });
    assert.deepEqual(result, { inside: 2 });
    assert.equal(await count(db), 2);
  });
});

it("rolls back everything when the callback throws and surfaces its error", async (t) => {
  if (await skipWithoutReplicaSet(t)) return;
  await withService(async (db) => {
    const failure = new Error("business rule");
    await assert.rejects(
      db.withTransaction(async (/** @type {any} */ tx) => {
        await tx.ops.create({ model: "Account", data: { key: "a" } });
        throw failure;
      }),
      (error) => error === failure,
    );
    assert.equal(await count(db), 0);
  });
});

it("aborts the whole transaction on a duplicate-key error", async (t) => {
  if (await skipWithoutReplicaSet(t)) return;
  await withService(async (db) => {
    await db.create({ model: "Account", data: { key: "dup" } });
    await assert.rejects(
      db.withTransaction(async (/** @type {any} */ tx) => {
        await tx.ops.create({ model: "Account", data: { key: "fresh" } });
        await tx.ops.create({ model: "Account", data: { key: "dup" } });
      }),
      (error) => /** @type {any} */ (error).code === 11000,
    );
    assert.equal(await count(db), 1);
  });
});

it("makes uncommitted writes invisible outside the transaction until commit", async (t) => {
  if (await skipWithoutReplicaSet(t)) return;
  await withService(async (db) => {
    await db.withTransaction(async (/** @type {any} */ tx) => {
      await tx.ops.create({ model: "Account", data: { key: "a" } });
      assert.equal(await count(db), 0);
    });
    assert.equal(await count(db), 1);
  });
});

it("runs bulk writes inside a session and rolls them back", async (t) => {
  if (await skipWithoutReplicaSet(t)) return;
  await withService(async (db) => {
    await assert.rejects(
      db.withTransaction(async (/** @type {any} */ tx) => {
        await tx.ops.bulkWrite({
          model: "Account",
          operations: [{ insertOne: { document: { key: "x" } } }],
        });
        throw new Error("undo");
      }),
      /undo/,
    );
    assert.equal(await count(db), 0);
  });
});

it("ends the session after the transaction", async () => {
  await withService(async (db) => {
    /** @type {any} */
    let session;
    await db.withTransaction(async (/** @type {any} */ tx) => {
      session = tx.session;
    });
    assert.equal(session.hasEnded, true);
  });
});

it("rejects scoped use after the callback finished", async () => {
  await withService(async (db) => {
    /** @type {any} */
    let leaked;
    await db.withTransaction(async (/** @type {any} */ tx) => {
      leaked = tx.ops;
    });
    await assert.rejects(
      leaked.create({ model: "Account", data: { key: "late" } }),
      TransactionError,
    );
    assert.equal(await count(db), 0);
  });
});

it("rolls back hydrated documents so isNew is restored on abort", async (t) => {
  if (await skipWithoutReplicaSet(t)) return;
  await withService(async (db) => {
    /** @type {any} */
    let created;
    await assert.rejects(
      db.withTransaction(async (/** @type {any} */ tx) => {
        created = await tx.ops.create({ model: "Account", data: { key: "doc" } });
        throw new Error("undo");
      }),
      /undo/,
    );
    assert.equal(created.isNew, true);
  });
});

it("healthCheck reports the real connection and the service aggregate", async () => {
  await withService(async (db) => {
    const aggregate = await db.healthCheck();
    assert.equal(aggregate.ready, true);
    assert.equal(aggregate.connections.default.probed, true);
    const view = await db.use("default").healthCheck();
    assert.equal(view.ready, true);
    assert.equal(typeof view.latencyMs, "number");
    const status = await db.use("default").healthCheck({ probe: false });
    assert.deepEqual([status.ready, status.probed], [true, false]);
  });
});

it("healthCheck reports a disconnected service as not ready without probing", async () => {
  const db = createMongoService({ uri: uri() });
  const report = await db.healthCheck();
  assert.equal(report.ready, false);
  assert.equal(report.connections.default?.probed, false);
  assert.equal(report.connections.default?.state, "idle");
});
