import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import mongoose from "mongoose";
import { ConnectionError, createMongoService } from "../../src/index.js";

const uri = () => {
  const value = process.env.MONGODOCK_TEST_URI;
  assert.ok(value, "Run through npm run test:integration");
  return value;
};
const dbName = () => `mongodock_test_${randomUUID().replaceAll("-", "")}`;

/** @param {import("../../src/index.js").MongoService} db */
async function dropOwned(db) {
  for (const status of db.listStatuses()) {
    if (status.state === "ready") await db.getConnection(status.name).dropDatabase();
  }
  await db.disconnectAll();
}

it("two databases keep identical models isolated and survive reopen", async () => {
  const db = createMongoService({
    connections: {
      a: { uri: uri(), options: { dbName: dbName() } },
      b: { uri: uri(), options: { dbName: dbName() } },
    },
    defaultConnection: "a",
  });
  try {
    await db.connectAll();
    const schema = new mongoose.Schema({ label: String });
    const a = db.use("a").registerModel({ name: "Item", schema });
    const b = db.use("b").registerModel({ name: "Item", schema });
    await a.create({ label: "only-a" });
    assert.equal(await a.countDocuments(), 1);
    assert.equal(await b.countDocuments(), 0);
    assert.equal(mongoose.connection.readyState, 0);

    await db.use("a").disconnect();
    assert.equal(db.getStatus("a").state, "closed");
    await db.use("a").connect();
    assert.equal(db.isConnected("a"), true);
    assert.equal(await a.countDocuments(), 1);
  } finally {
    await dropOwned(db);
  }
});

it("a failed open reports a safe diagnostic and can be disconnected", async () => {
  const db = createMongoService({
    uri: "mongodb://127.0.0.1:1/mongodock_unreachable",
    options: { serverSelectionTimeoutMS: 300 },
  });
  await assert.rejects(db.connect(), ConnectionError);
  assert.equal(db.getStatus().state, "failed");
  assert.equal(db.getStatus().error?.code, "ERR_CONNECTION");
  await db.disconnect();
});

it("caller-owned connections stay open after disconnect", async () => {
  const connection = mongoose.createConnection(uri(), {
    dbName: dbName(),
    bufferCommands: false,
  });
  await connection.asPromise();
  const db = createMongoService({ connections: { default: { connection } } });
  try {
    await db.connect();
    assert.equal(db.isConnected(), true);
    await db.disconnect();
    assert.equal(connection.readyState, 1);
  } finally {
    await connection.dropDatabase();
    await connection.close();
  }
});
