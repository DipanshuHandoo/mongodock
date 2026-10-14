import assert from "node:assert/strict";
import { createMongoService } from "@dipanshuhandoo/mongodock";
import mongoose from "mongoose";

// Creating a service and registering a model opens no connection.
const db = createMongoService({ uri: "mongodb://localhost:27017/example" });
db.registerModel({
  name: "Page",
  schema: new mongoose.Schema({ url: { type: String, required: true }, status: Number }),
});

assert.equal(db.getStatus().state, "idle");
assert.equal(db.isConnected(), false);
assert.deepEqual(db.listModels(), ["Page"]);
assert.equal(db.getModel("Page").modelName, "Page");
console.log("Service created and model registered; connect() would open the database.");
