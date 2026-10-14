import assert from "node:assert/strict";
import { createMongoService, InvalidOptionError } from "@dipanshuhandoo/mongodock";

const db = createMongoService({ uri: "mongodb://localhost:27017/example" });

for (const method of [
  "find",
  "findAll",
  "findOne",
  "findById",
  "exists",
  "countDocuments",
  "create",
  "insertMany",
  "updateOne",
  "updateMany",
  "deleteOne",
  "deleteMany",
  "findOneAndUpdate",
  "findByIdAndUpdate",
  "findOneAndDelete",
  "findByIdAndDelete",
  "aggregate",
]) {
  assert.equal(typeof db[method], "function", method);
}

// Invalid input fails before any connection or database work is attempted.
await assert.rejects(db.deleteMany({ model: "Item", filter: {} }), (error) => {
  assert.ok(error instanceof InvalidOptionError || error.code === "ERR_MODEL_REGISTRATION");
  return true;
});
console.log("CRUD and aggregation methods are available; no connection opened.");
