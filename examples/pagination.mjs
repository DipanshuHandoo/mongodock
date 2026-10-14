import assert from "node:assert/strict";
import mongoose from "mongoose";
import { createMongoService, InvalidOptionError } from "@dipanshuhandoo/mongodock";

const db = createMongoService({ uri: "mongodb://localhost:27017/example" });
db.registerModel({ name: "Item", schema: new mongoose.Schema({ n: Number }) });

for (const method of [
  "paginate",
  "paginateCursor",
  "iterate",
  "iterateBatches",
  "aggregateCursor",
]) {
  assert.equal(typeof db[method], "function", method);
}

// Streams validate eagerly, so bad input throws at call time without touching the database.
assert.throws(() => db.iterate({ model: "Item", batchSize: 0 }), InvalidOptionError);
assert.throws(
  () => db.aggregateCursor({ model: "Item", pipeline: [{ $out: "copy" }] }),
  InvalidOptionError,
);
// Materialized methods resolve the connection first, so an idle one rejects before the token is read.
await assert.rejects(db.paginateCursor({ model: "Item", cursor: "not-a-token" }), {
  name: "ConnectionError",
});

// A stream is lazy: nothing connects until the first pull.
const stream = db.iterate({ model: "Item", lean: true });
await stream.return();
console.log("Pagination and streaming methods are available; no connection opened.");
