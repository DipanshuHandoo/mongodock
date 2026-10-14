import assert from "node:assert/strict";
import { createMongoService, BulkError } from "@dipanshuhandoo/mongodock";
import mongoose from "mongoose";

// Native-vs-batched validation runs before any network access, so this needs no database.
const db = createMongoService({ uri: "mongodb://127.0.0.1:1/unused" });
db.registerModel({ name: "Item", schema: new mongoose.Schema({ key: String }) });

const doc = (key) => ({ insertOne: { document: { key } } });

await assert.rejects(db.bulkWrite({ model: "Item", operations: [doc("a")], batchSize: 10 }), {
  code: "ERR_INVALID_OPTION",
});
await assert.rejects(
  db.bulkWrite({
    model: "Item",
    batching: true,
    operations: [doc("a")],
    ordered: true,
    concurrency: 2,
  }),
  { code: "ERR_INVALID_OPTION" },
);
await assert.rejects(
  db.bulkWrite({ model: "Item", batching: true, operations: [doc("a"), { bogus: {} }] }),
  { code: "ERR_INVALID_OPTION" },
);
assert.equal(typeof BulkError, "function");
console.log("bulk validation ok");
