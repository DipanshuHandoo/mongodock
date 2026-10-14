import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import mongoose from "mongoose";
import { createMongoService, InvalidOptionError } from "../../src/index.js";

const uri = () => {
  const value = process.env.MONGODOCK_TEST_URI;
  assert.ok(value, "Run through npm run test:integration");
  return value;
};
const dbName = () => `mongodock_ops_${randomUUID().replaceAll("-", "")}`;

describe("operations against a real database", () => {
  /** @type {ReturnType<typeof createMongoService>} */
  let db;
  /** @type {import("mongoose").Model<any>} */
  let Item;
  const events = /** @type {string[]} */ ([]);

  before(async () => {
    db = createMongoService({
      connections: {
        main: { uri: uri(), options: { dbName: dbName() } },
        other: { uri: uri(), options: { dbName: dbName() } },
      },
      defaultConnection: "main",
      hooks: { onComplete: (c) => void events.push(`${c.context.method}:${c.invocationOutcome}`) },
    });
    await db.connectAll();
    const schema = new mongoose.Schema({
      sku: { type: String, required: true, unique: true },
      qty: { type: Number, min: 0, default: 0 },
      tag: String,
    });
    Item = db.registerModel({ name: "Item", schema });
    db.use("other").registerModel({ name: "Item", schema });
    await Item.createIndexes();
  });

  after(async () => {
    for (const name of ["main", "other"]) await db.getConnection(name).dropDatabase();
    await db.disconnectAll();
  });

  it("creates, reads, counts and checks existence with schema casting and validation", async () => {
    const created = await db.create({ model: "Item", data: { sku: "a", qty: "5" } });
    assert.equal(created.qty, 5);
    await db.insertMany({
      model: Item,
      data: [
        { sku: "b", tag: "x" },
        { sku: "c", tag: "x" },
      ],
    });
    assert.equal(await db.countDocuments({ model: "Item" }), 3);
    assert.equal(await db.exists({ model: "Item", filter: { sku: "b" } }), true);
    assert.equal(await db.exists({ model: "Item", filter: { sku: "zzz" } }), false);
    assert.equal(await db.findOne({ model: "Item", filter: { sku: "zzz" } }), null);
    const lean = await db.findOne({ model: "Item", filter: { sku: "a" }, lean: true });
    assert.equal(lean.constructor, Object);
    const hydrated = await db.findById({ model: "Item", id: created._id });
    assert.equal(typeof hydrated.save, "function");
    const projected = await db.find({
      model: "Item",
      filter: { tag: "x" },
      projection: { sku: 1 },
      sort: { sku: -1 },
      limit: 1,
      skip: 1,
      lean: true,
    });
    assert.deepEqual(
      projected.map((d) => d.sku),
      ["b"],
    );
    assert.equal((await db.findAll({ model: "Item" })).length, 3);
    await assert.rejects(db.create({ model: "Item", data: { sku: "bad", qty: -1 } }), {
      name: "ValidationError",
    });
    await assert.rejects(db.create({ model: "Item", data: { sku: "a" } }), { code: 11000 });
  });

  it("updates with validators, post-update default and explicit return modes", async () => {
    const after = await db.findOneAndUpdate({
      model: "Item",
      filter: { sku: "a" },
      update: { $set: { qty: 9 } },
    });
    assert.equal(after.qty, 9);
    const before = await db.findOneAndUpdate({
      model: "Item",
      filter: { sku: "a" },
      update: { $set: { qty: 10 } },
      options: { returnDocument: "before" },
      lean: true,
    });
    assert.equal(before.qty, 9);
    await assert.rejects(
      db.findOneAndUpdate({
        model: "Item",
        filter: { sku: "a" },
        update: { $set: { qty: 1 } },
        options: { new: true, returnOriginal: true },
      }),
      InvalidOptionError,
    );
    await assert.rejects(
      db.updateOne({ model: "Item", filter: { sku: "a" }, update: { $set: { qty: -5 } } }),
      { name: "ValidationError" },
    );
    const one = await db.updateOne({
      model: "Item",
      filter: { sku: "b" },
      update: { $set: { qty: 2 } },
    });
    assert.equal(one.modifiedCount, 1);
    const many = await db.updateMany({
      model: "Item",
      filter: { tag: "x" },
      update: { $inc: { qty: 1 } },
    });
    assert.equal(many.matchedCount, 2);
    const byId = await db.findByIdAndUpdate({
      model: "Item",
      id: after._id,
      update: { $set: { tag: "y" } },
    });
    assert.equal(byId.tag, "y");
  });

  it("rejects unsafe mutations before dispatch and honors allowAll", async () => {
    const before = events.length;
    for (const filter of [{}, { $and: [{}] }, { $or: [{}, { sku: "a" }] }]) {
      await assert.rejects(db.deleteMany({ model: "Item", filter }), InvalidOptionError);
      await assert.rejects(
        db.updateMany({ model: "Item", filter, update: { $set: { qty: 0 } } }),
        InvalidOptionError,
      );
    }
    assert.equal(await db.countDocuments({ model: "Item" }), 3);
    assert.ok(events.length > before);
    const guarded = createMongoService({
      uri: uri(),
      hooks: {
        beforeOperation: (/** @type {any} */ input) => ({ ...input, filter: {} }),
      },
    });
    await guarded.connect();
    try {
      await assert.rejects(
        guarded.deleteMany({ model: Item, filter: { sku: "a" } }),
        InvalidOptionError,
      );
    } finally {
      await guarded.disconnect();
    }
  });

  it("deletes with every variant", async () => {
    const one = await db.findOneAndDelete({ model: "Item", filter: { sku: "c" }, lean: true });
    assert.equal(one.sku, "c");
    const byId = await db.findByIdAndDelete({ model: "Item", id: one._id });
    assert.equal(byId, null);
    assert.equal((await db.deleteOne({ model: "Item", filter: { sku: "b" } })).deletedCount, 1);
    assert.equal(
      (await db.deleteMany({ model: "Item", filter: {}, allowAll: true })).deletedCount,
      1,
    );
  });

  it("aggregates and rejects write stages unless allowed", async () => {
    await db.insertMany({
      model: "Item",
      data: [
        { sku: "g1", tag: "g" },
        { sku: "g2", tag: "g" },
      ],
    });
    const rows = await db.aggregate({
      model: "Item",
      pipeline: [{ $match: { tag: "g" } }, { $group: { _id: "$tag", n: { $sum: 1 } } }],
    });
    assert.deepEqual(rows, [{ _id: "g", n: 2 }]);
    await assert.rejects(
      db.aggregate({ model: "Item", pipeline: [{ $match: {} }, { $out: "elsewhere" }] }),
      InvalidOptionError,
    );
    await assert.rejects(
      db.aggregate({
        model: "Item",
        pipeline: [{ $facet: { f: [{ $merge: { into: "x" } }] } }],
      }),
      InvalidOptionError,
    );
  });

  it("keeps named databases isolated and rejects foreign models", async () => {
    const other = db.use("other");
    assert.equal(await other.countDocuments({ model: "Item" }), 0);
    await assert.rejects(other.countDocuments({ model: Item }), InvalidOptionError);
    await assert.rejects(db.find({ model: "Missing" }), { name: "ModelRegistrationError" });
  });
});
