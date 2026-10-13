import assert from "node:assert/strict";
import {
  ConfigurationError,
  normalizeConfig,
  normalizeRetry,
  toSafeDiagnostic,
} from "@dipanshuhandoo/mongodock";

const config = normalizeConfig({
  connections: {
    primary: { uri: "mongodb://localhost:27017/primary" },
    reporting: { uri: "mongodb://localhost:27017/reporting" },
  },
  defaultConnection: "primary",
  requiredConnections: ["primary"],
  plugins: [{ name: "trace", hooks: { beforeRetry: () => false } }],
});
assert.equal(config.retry.enabled, true);
assert.equal(normalizeRetry(false, true).enabled, false);
assert.equal(Object.keys(config.connections).length, 2);
assert.throws(() => normalizeConfig({ uri: "" }), ConfigurationError);
const diagnostic = toSafeDiagnostic(new Error("mongodb://user:secret@host"));
assert.equal(JSON.stringify(diagnostic).includes("secret"), false);
console.log("Foundation contracts checked; service operations arrive in later phases.");
