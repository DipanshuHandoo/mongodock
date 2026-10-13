import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import mongoose from "mongoose";

it("isolated replica-set fixture supports ping, separate databases, and rollback", async () => {
  const uri = process.env.MONGODOCK_TEST_URI;
  assert.ok(uri, "Run through npm run test:integration");
  const prefix = `mongodock_test_${randomUUID().replaceAll("-", "")}`;
  const names = [`${prefix}_a`, `${prefix}_b`];
  const connections = names.map((dbName) =>
    mongoose.createConnection(uri, { dbName, bufferCommands: false }),
  );
  /** @type {unknown[]} */
  const failures = [];
  try {
    await Promise.all(connections.map((connection) => connection.asPromise()));
    const [first, second] = connections;
    assert.ok(first?.db && second?.db);
    const hello = await first.db.admin().command({ hello: 1 });
    assert.ok(hello.setName, "Transactions require a replica set");
    assert.equal(hello.isWritablePrimary, true);
    assert.equal((await first.db.admin().ping()).ok, 1);
    const models = connections.map((connection) =>
      connection.model("Fixture", new mongoose.Schema({ label: String })),
    );
    const [a, b] = models;
    assert.ok(a && b);
    await a.create({ label: "first" });
    assert.equal(await b.countDocuments(), 0);
    await assert.rejects(
      first.transaction(async (session) => {
        await a.create([{ label: "rollback" }], { session });
        throw new Error("rollback fixture");
      }),
      /rollback fixture/,
    );
    assert.equal(await a.countDocuments(), 1);
  } catch (error) {
    failures.push(error);
  } finally {
    const results = await Promise.allSettled(
      connections.map(async (connection) => {
        try {
          if (connection.readyState === 1) await connection.dropDatabase();
        } finally {
          await connection.close();
        }
      }),
    );
    failures.push(
      ...results.flatMap((result) => (result.status === "rejected" ? [result.reason] : [])),
    );
  }
  if (failures.length)
    throw new AggregateError(failures, "Fixture test or owned database cleanup failed");
});
