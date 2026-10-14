import assert from "node:assert/strict";
import { createMongoService } from "@dipanshuhandoo/mongodock";
import mongoose from "mongoose";

// All of these fail during validation, before any network access, so no database is needed.
const db = createMongoService({ uri: "mongodb://127.0.0.1:1/unused" });
db.registerModel({
  name: "Product",
  schema: new mongoose.Schema({ sku: { type: String, required: true }, name: String }),
});

const invalid = { code: "ERR_INVALID_OPTION" };
const base = { model: "Product", keyFields: ["sku"] };

await assert.rejects(db.seed({ ...base, keyFields: [] }), invalid);
await assert.rejects(db.seed({ ...base, keyFields: ["a.b"], records: [{ sku: "a" }] }), invalid);
await assert.rejects(db.seed({ ...base, records: [{ sku: "a" }], batchSize: 10 }), invalid);
await assert.rejects(
  db.seed({ ...base, batching: true, updateExisting: true, concurrency: 4, records: [] }),
  invalid,
);
console.log("seeding validation ok");
