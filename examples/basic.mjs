import assert from "node:assert/strict";
import { normalizeConfig } from "@dipanshuhandoo/mongodock";

const config = normalizeConfig({ uri: "mongodb://localhost:27017/example" });
assert.equal(config.retry.enabled, false);
assert.equal(config.limits.readLimit, 100);
assert.equal(config.connections.default.options.bufferCommands, false);
console.log("Configuration normalized; no database connection was opened.");
