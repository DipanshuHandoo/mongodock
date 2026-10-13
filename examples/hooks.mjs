import assert from "node:assert/strict";
import { createMongoService, HookError } from "@dipanshuhandoo/mongodock";

const events = [];
const db = createMongoService({
  uri: "mongodb://localhost:27017/example",
  retry: { maxRetries: 2, baseDelayMs: 50 },
  plugins: [
    { name: "audit", hooks: { onConnectionConnected: (status) => events.push(status.state) } },
  ],
  hooks: {
    beforeRetry: ({ attempt }) => attempt < 2,
    onHookError: ({ scope, hookName }) => console.error("hook failed", scope, hookName),
  },
});

assert.equal(db.getStatus().state, "idle");
assert.equal(typeof HookError, "function");
console.log("Hooks and plugin registered; no connection opened.");
