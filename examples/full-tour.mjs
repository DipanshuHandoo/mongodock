import assert from "node:assert/strict";
import {
  ConfigurationError,
  createMongoService,
  InvalidOptionError,
  normalizeConfig,
  normalizeRetry,
  toSafeDiagnostic,
} from "@dipanshuhandoo/mongodock";
import mongoose from "mongoose";

// Configuration: named databases, plugin-triggered retry, explicit disable.
const config = normalizeConfig({
  connections: {
    primary: { uri: "mongodb://localhost:27017/primary" },
    reporting: { uri: "mongodb://localhost:27017/reporting" },
  },
  defaultConnection: "primary",
  plugins: [{ name: "trace", hooks: { beforeRetry: () => false } }],
});
assert.equal(Object.keys(config.connections).length, 2);
assert.equal(config.retry.enabled, true);
assert.equal(normalizeRetry(false, true).enabled, false);
assert.throws(() => normalizeConfig({ uri: "" }), ConfigurationError);

// Service: per-connection model registry and connection views, still with no network access.
const events = [];
const db = createMongoService({
  connections: {
    primary: { uri: "mongodb://localhost:27017/primary" },
    reporting: { uri: "mongodb://localhost:27017/reporting" },
  },
  defaultConnection: "primary",
  hooks: { onConnectionConnected: (status) => events.push(status.name) },
});
const schema = new mongoose.Schema({ sku: { type: String, required: true }, qty: Number });
db.registerModel({ name: "Item", schema });
db.use("reporting").registerModel({ name: "Item", schema });
assert.notEqual(db.getModel("Item"), db.use("reporting").getModel("Item"));
assert.deepEqual([...db.listConnections()].sort(), ["primary", "reporting"]);
assert.equal(db.use("reporting").getStatus().state, "idle");

// Safety guards fail before any database work.
await assert.rejects(
  db.deleteMany({ model: "Item", filter: {} }),
  (error) => error instanceof InvalidOptionError,
);
await assert.rejects(
  db.updateMany({ model: "Item", filter: { $and: [{}] }, update: { $set: { qty: 0 } } }),
  (error) => error instanceof InvalidOptionError,
);

// Diagnostics never leak connection strings.
const diagnostic = toSafeDiagnostic(new Error("mongodb://user:secret@host/db"));
assert.equal(JSON.stringify(diagnostic).includes("secret"), false);

console.log("Full tour passed: config, registry, connection views, guards and diagnostics.");
