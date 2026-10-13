import assert from "node:assert/strict";
import { createMongoService } from "@dipanshuhandoo/mongodock";

const uri = process.env.MONGODB_URI;
const db = createMongoService(
  uri
    ? { connections: { primary: { uri }, analytics: { uri, options: { dbName: "analytics" } } } }
    : { uri: "mongodb://localhost:27017/example" },
);
assert.equal(db.getStatus().state, "idle");
console.log("Connections:", db.listConnections().join(", "), "(nothing connected yet)");

if (uri) {
  await db.connectAll();
  console.log(
    db
      .listStatuses()
      .map((s) => `${s.name}:${s.state}`)
      .join(" "),
  );
  await db.disconnectAll();
} else {
  console.log("Set MONGODB_URI to connect; skipped.");
}
