import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { it } from "node:test";
import mongoose from "mongoose";
import { createMongoService } from "../src/create-mongo-service.js";
import { ConnectionError, ModelRegistrationError, ShutdownTimeoutError } from "../src/index.js";

function unbuffered() {
  const connection = mongoose.createConnection();
  connection.set("bufferCommands", false);
  return connection;
}

/** @param {{ failOpen?: boolean, openDelay?: number }} [behavior] */
function fakeConnection(behavior = {}) {
  const conn = Object.assign(new EventEmitter(), {
    readyState: 0,
    opens: 0,
    closes: 0,
    settings: /** @type {Record<string, unknown>} */ ({}),
    set(/** @type {string} */ key, /** @type {unknown} */ value) {
      conn.settings[key] = value;
    },
    async openUri() {
      conn.opens += 1;
      conn.readyState = 2;
      if (behavior.openDelay) await new Promise((r) => setTimeout(r, behavior.openDelay));
      if (behavior.failOpen && conn.opens === 1) {
        conn.readyState = 0;
        throw new Error("mongodb://user:secret@host failed");
      }
      conn.readyState = 1;
      conn.emit("connected");
    },
    async close() {
      conn.closes += 1;
      conn.readyState = 0;
      conn.emit("close");
    },
    async asPromise() {},
    get(/** @type {string} */ key) {
      return conn.settings[key];
    },
    models: {},
  });
  return conn;
}

/** @param {ReturnType<typeof fakeConnection>} fake @param {object} [extra] */
function service(fake, extra = {}) {
  const manager = createMongoService(
    { uri: "mongodb://localhost/x", ...extra },
    { createConnection: () => /** @type {any} */ (fake) },
  );
  return manager;
}

it("is idle until connect and dedupes concurrent opens", async () => {
  const fake = fakeConnection({ openDelay: 5 });
  const db = service(fake);
  assert.equal(db.getStatus().state, "idle");
  assert.equal(fake.opens, 0);
  const [a, b] = await Promise.all([db.connect(), db.connect()]);
  assert.equal(fake.opens, 1);
  assert.equal(a.state, "ready");
  assert.equal(b.state, "ready");
  assert.equal(db.isConnected(), true);
  assert.equal(fake.settings.bufferCommands, false);
  assert.equal(fake.settings.autoIndex, false);
});

it("failed open reports a safe error and can be retried", async () => {
  const fake = fakeConnection({ failOpen: true });
  const db = service(fake);
  await assert.rejects(db.connect(), (error) => {
    assert.ok(error instanceof ConnectionError);
    assert.doesNotMatch(JSON.stringify(db.getStatus()), /secret/);
    return true;
  });
  assert.equal(db.getStatus().state, "failed");
  assert.equal((await db.connect()).state, "ready");
});

it("disconnect is idempotent, reopenable, and mirrors events to hooks", async () => {
  const fake = fakeConnection();
  /** @type {string[]} */
  const seen = [];
  const db = service(fake, {
    hooks: {
      onConnectionConnected: () => {
        seen.push("service");
      },
      onConnectionDisconnected: () => {
        throw new Error("hook broke");
      },
      onHookError: (/** @type {{hookName: string}} */ { hookName }) => {
        seen.push(`error:${hookName}`);
      },
    },
    plugins: [
      { name: "p", hooks: { onConnectionConnected: () => Promise.reject(new Error("x")) } },
    ],
  });
  await db.disconnect();
  await db.connect();
  fake.emit("disconnected");
  fake.emit("error", new Error("boom"));
  assert.equal(db.getStatus().error?.code, "ERR_CONNECTION");
  await Promise.all([db.disconnect(), db.disconnect()]);
  assert.equal(fake.closes, 1);
  assert.equal(db.getStatus().state, "closed");
  assert.equal((await db.connect()).state, "ready");
  await new Promise((r) => setImmediate(r));
  assert.ok(seen.includes("service"));
  assert.ok(seen.includes("error:onConnectionDisconnected"));
  assert.ok(seen.includes("error:onConnectionConnected"));
  assert.equal(fake.listenerCount("connected"), 1);
  await db.disconnect();
  assert.equal(fake.listenerCount("connected"), 0);
});

it("driver readyState drives status", async () => {
  const fake = fakeConnection();
  const db = service(fake);
  await db.connect();
  fake.readyState = 0;
  assert.equal(db.getStatus().state, "connecting");
  fake.readyState = 3;
  assert.equal(db.getStatus().state, "closing");
  fake.readyState = 1;
  assert.equal(db.getStatus().state, "ready");
});

it("unknown names are rejected", () => {
  const db = service(fakeConnection());
  assert.throws(() => db.use("nope"), ConnectionError);
  assert.throws(() => db.getStatus("nope"), ConnectionError);
  assert.equal(db.use("default"), db.use("default"));
  assert.deepEqual(db.listConnections(), ["default"]);
});

it("connectAll and disconnectAll report per-connection outcomes", async () => {
  const good = fakeConnection();
  const bad = fakeConnection({ failOpen: true });
  const queue = [good, bad];
  const db = createMongoService(
    {
      connections: {
        a: { uri: "mongodb://localhost/a" },
        b: { uri: "mongodb://localhost/b" },
      },
      defaultConnection: "a",
    },
    { createConnection: () => /** @type {any} */ (queue.shift()) },
  );
  await assert.rejects(db.connectAll(), (error) => {
    assert.ok(error instanceof ConnectionError);
    assert.deepEqual(
      error.outcomes.map((o) => [o.connection, o.status]),
      [
        ["a", "fulfilled"],
        ["b", "rejected"],
      ],
    );
    return true;
  });
  assert.equal(db.isConnected("a"), true);
  assert.equal(db.isConnected("b"), false);
  const statuses = await db.disconnectAll();
  assert.deepEqual(
    statuses.map((s) => s.state),
    ["closed", "failed"],
  );
});

it("caller-owned connections are never closed or stripped of listeners", async () => {
  const fake = fakeConnection();
  fake.readyState = 1;
  fake.settings.bufferCommands = false;
  const mine = () => {};
  fake.on("connected", mine);
  const db = createMongoService({
    connections: { default: { connection: /** @type {any} */ (fake) } },
  });
  assert.equal(db.getStatus().owned, false);
  await db.connect();
  await db.disconnect();
  assert.equal(fake.closes, 0);
  assert.ok(fake.listeners("connected").includes(mine));
  fake.readyState = 0;
  const other = createMongoService({
    connections: { default: { connection: /** @type {any} */ (fake) } },
  });
  await assert.rejects(other.connect(), ConnectionError);
});

it("drain rejects new work, times out staying closing, then completes later", async () => {
  const fake = fakeConnection();
  const { createConnectionManager } = await import("../src/connections/manager.js");
  const { normalizeConfig } = await import("../src/config.js");
  const manager = createConnectionManager({
    config: normalizeConfig({ uri: "mongodb://localhost/x", limits: { drainTimeoutMS: 20 } }),
    createConnection: () => /** @type {any} */ (fake),
  });
  await manager.connect();
  let cancelled = 0;
  const work = manager.admit(undefined, {
    kind: "cursor",
    cancel: () => {
      cancelled += 1;
    },
  });
  const closing = manager.disconnect();
  assert.throws(() => manager.admit(undefined, { kind: "op" }), ConnectionError);
  await assert.rejects(closing, (error) => {
    assert.ok(error instanceof ShutdownTimeoutError);
    assert.deepEqual(error.pending, [{ connection: "default", kind: "cursor", count: 1 }]);
    assert.equal(error.databaseOutcome, "uncertain");
    return true;
  });
  assert.equal(cancelled, 1);
  assert.equal(manager.getStatus().state, "closing");
  await assert.rejects(manager.disconnectAll(), ShutdownTimeoutError);
  work.release();
  work.release();
  assert.equal((await manager.disconnect()).state, "closed");
  assert.equal(fake.closes, 1);
});

it("drain waits for operations that finish in time", async () => {
  const fake = fakeConnection();
  const db = service(fake);
  await db.connect();
  const { createConnectionManager } = await import("../src/connections/manager.js");
  const { normalizeConfig } = await import("../src/config.js");
  const manager = createConnectionManager({
    config: normalizeConfig({ uri: "mongodb://localhost/x" }),
    createConnection: () => /** @type {any} */ (fake),
  });
  await manager.connect();
  const work = manager.admit(undefined, { kind: "operation" });
  const closing = manager.disconnect();
  setTimeout(() => work.release(), 10);
  assert.equal((await closing).state, "closed");
});

it("close failure surfaces an uncertain ConnectionError", async () => {
  const fake = fakeConnection();
  const db = service(fake);
  await db.connect();
  fake.close = async () => {
    throw new Error("close failed");
  };
  await assert.rejects(db.disconnect(), (error) => {
    assert.ok(error instanceof ConnectionError);
    assert.equal(error.databaseOutcome, "uncertain");
    return true;
  });
});

it("connect after a closed phase waits for an in-flight close", async () => {
  const fake = fakeConnection();
  const db = service(fake);
  await db.connect();
  const closing = db.disconnect();
  const reopening = db.connect();
  await closing;
  assert.equal((await reopening).state, "ready");
});

it("registers models per connection with idempotence and conflict detection", () => {
  const connection = mongoose.createConnection();
  connection.set("bufferCommands", false);
  const db = createMongoService({ connections: { default: { connection } } });
  const schema = new mongoose.Schema({ label: String });
  const model = db.registerModel({ name: "Thing", schema, collection: "things" });
  assert.equal(db.registerModel({ name: "Thing", schema, collection: "things" }), model);
  assert.equal(db.getModel("Thing"), model);
  assert.equal(db.hasModel("Thing"), true);
  assert.deepEqual(db.listModels(), ["Thing"]);
  assert.equal(model.collection.name, "things");
  assert.equal(mongoose.models.Thing, undefined);
  assert.throws(
    () => db.registerModel({ name: "Thing", schema: new mongoose.Schema({}) }),
    ModelRegistrationError,
  );
  assert.throws(() => db.getModel("Nope"), ModelRegistrationError);
  assert.equal(db.registerModel({ model }), model);
  assert.equal(db.unregisterModel("Thing"), true);
  assert.equal(db.unregisterModel("Thing"), false);
  assert.equal(connection.models.Thing, undefined);
});

it("registry validates definitions and rolls back failed batches", () => {
  const connection = mongoose.createConnection();
  connection.set("bufferCommands", false);
  const db = createMongoService({ connections: { default: { connection } } });
  const schema = new mongoose.Schema({});
  const invalid = [
    null,
    { name: "1bad", schema },
    { name: "A", schema: {} },
    { name: "A", schema, collection: "" },
    { name: "A", schema, options: [] },
    { name: "A", schema, options: { overwriteModels: true } },
    { name: "A", schema, extra: 1 },
    { model: {} },
    { model: mongoose.model("Global", schema) },
    { model: connection.model("X", schema), name: "X" },
  ];
  for (const definition of invalid) {
    assert.throws(() => db.registerModel(/** @type {any} */ (definition)), ModelRegistrationError);
  }
  assert.throws(() => db.registerModels(/** @type {any} */ ("x")), ModelRegistrationError);
  assert.throws(
    () =>
      db.registerModels([
        { name: "A", schema },
        { name: "A", schema: new mongoose.Schema({}) },
      ]),
    ModelRegistrationError,
  );
  assert.deepEqual(db.listModels(), []);
  assert.throws(() => db.registerModels([{ name: "X", schema }]), /outside the registry/);
  const bad = new mongoose.Schema({});
  bad.path("p", String);
  const original = connection.model.bind(connection);
  let calls = 0;
  connection.model = /** @type {any} */ (
    (/** @type {[any, any, any, any]} */ ...args) => {
      calls += 1;
      if (calls === 2) throw new Error("compile failed");
      return original(...args);
    }
  );
  assert.throws(
    () =>
      db.registerModels([
        { name: "One", schema },
        { name: "Two", schema },
      ]),
    ModelRegistrationError,
  );
  assert.deepEqual(db.listModels(), []);
  assert.equal(connection.models.One, undefined);
  assert.equal(
    db.registerModels([
      { name: "Same", schema },
      { name: "Same", schema },
    ]).length,
    2,
  );
});

it("views route to their own connection", () => {
  const db = createMongoService({
    connections: {
      a: { connection: unbuffered() },
      b: { connection: unbuffered() },
    },
    defaultConnection: "a",
  });
  const schema = new mongoose.Schema({});
  const a = db.registerModel({ name: "Same", schema });
  const b = db.use("b").registerModel({ name: "Same", schema });
  assert.notEqual(a, b);
  assert.equal(db.getModel("Same"), a);
  assert.equal(db.use("b").getModel("Same"), b);
  assert.equal(db.use("b").name, "b");
  assert.deepEqual(db.listConnections(), ["a", "b"]);
  assert.equal(db.listStatuses().length, 2);
  assert.equal(db.use("b").getConnection(), db.getConnection("b"));
});
