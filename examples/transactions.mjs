import assert from "node:assert/strict";
import { createMongoService, TransactionError } from "@dipanshuhandoo/mongodock";
import mongoose from "mongoose";

// Input validation and scope guards run before any network access, so this needs no database.
const db = createMongoService({ uri: "mongodb://127.0.0.1:1/unused" });
db.registerModel({ name: "Account", schema: new mongoose.Schema({ key: String }) });

await assert.rejects(db.withTransaction(null), { code: "ERR_INVALID_OPTION" });
await assert.rejects(
  db.withTransaction(async () => 1, { retry: true }),
  {
    code: "ERR_INVALID_OPTION",
  },
);
// Not connected: the transaction is refused at admission, before a session exists.
await assert.rejects(
  db.withTransaction(async (tx) => tx.ops.create({ model: "Account", data: { key: "a" } })),
  { code: "ERR_CONNECTION" },
);
assert.equal(typeof TransactionError, "function");
console.log("transactions validation ok");
