import assert from "node:assert/strict";
import { createMongoService } from "@dipanshuhandoo/mongodock";

// A service that was never connected reports not-ready without any network probe.
const db = createMongoService({
  connections: {
    main: { uri: "mongodb://127.0.0.1:1/unused" },
    analytics: { uri: "mongodb://127.0.0.1:1/unused" },
  },
  defaultConnection: "main",
  requiredConnections: ["main"],
});

const report = await db.healthCheck();
assert.equal(report.ready, false);
assert.deepEqual(report.required, ["main"]);
assert.equal(report.connections.main.state, "idle");
assert.equal(report.connections.main.probed, false);

const status = await db.use("analytics").healthCheck({ probe: false });
assert.deepEqual([status.ready, status.probed], [false, false]);
await assert.rejects(db.healthCheck({ timeoutMS: 0 }), { code: "ERR_INVALID_OPTION" });
console.log("health ok");
