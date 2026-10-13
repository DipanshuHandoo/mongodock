import assert from "node:assert/strict";
import { describe, it } from "node:test";
import mongoose from "mongoose";
import {
  ConfigurationError,
  DEFAULTS,
  normalizeBatchOptions,
  normalizeConfig,
  normalizeRetry,
} from "../src/index.js";

const uri = "mongodb://localhost:27017/example";

describe("configuration", () => {
  it("normalizes owned connection defaults without opening a connection", () => {
    const config = normalizeConfig({ uri });
    assert.equal(config.defaultConnection, "default");
    assert.deepEqual(config.requiredConnections, ["default"]);
    assert.deepEqual(config.limits, DEFAULTS);
    assert.equal(config.retry.enabled, false);
    assert.equal(config.connections.default?.options.bufferCommands, false);
    assert.equal(config.connections.default?.owned, true);
    assert.equal(mongoose.connection.readyState, 0);
  });

  it("copies named configuration, limits, hooks and plugin registrations", () => {
    const beforeRetry = () => false;
    const hooks = { beforeRetry };
    const plugins = [{ name: "trace", hooks }];
    const config = normalizeConfig({
      connections: { primary: { uri }, reporting: { uri } },
      defaultConnection: "primary",
      requiredConnections: ["primary"],
      hooks,
      plugins,
      limits: { readLimit: 10, pageLimit: 5, maxReadLimit: 50, diagnosticSamples: 0 },
    });
    plugins.length = 0;
    hooks.beforeRetry = () => true;
    assert.equal(config.plugins.length, 1);
    assert.equal(config.hooks.beforeRetry, beforeRetry);
    assert.equal(config.retry.enabled, true);
    assert.equal(config.limits.readLimit, 10);
    assert.ok(Object.isFrozen(config.connections));
    assert.ok(Object.isFrozen(config.limits));
  });

  it("snapshots nested native options without freezing opaque driver instances", () => {
    const readPreference = new mongoose.mongo.ReadPreference("secondary");
    const options = {
      auth: { username: "fixture", password: "fixture" },
      readPreferenceTags: [{ region: "east" }],
      readPreference,
    };
    const config = normalizeConfig({ uri, options });
    options.auth.username = "changed";
    const tag = options.readPreferenceTags[0];
    assert.ok(tag);
    tag.region = "west";
    options.readPreferenceTags.push({ region: "north" });
    const normalized = config.connections.default?.options;
    assert.equal(normalized?.auth?.username, "fixture");
    assert.deepEqual(normalized?.readPreferenceTags, [{ region: "east" }]);
    assert.equal(normalized?.readPreference, readPreference);
    assert.ok(Object.isFrozen(normalized?.auth));
    assert.ok(Object.isFrozen(normalized?.readPreferenceTags));
    assert.equal(Object.isFrozen(readPreference), false);
    const cyclic = { nested: Object.create(null) };
    cyclic.nested.self = cyclic.nested;
    const cycle = normalizeConfig({ uri, options: { authMechanismProperties: cyclic } });
    const nested = cycle.connections.default?.options.authMechanismProperties?.nested;
    assert.equal(nested.self, nested);
  });

  it("accepts caller-owned connections only when buffering is explicitly disabled", async () => {
    const connection = mongoose.createConnection();
    try {
      assert.throws(
        () =>
          normalizeConfig({
            connections: { default: { connection } },
          }),
        ConfigurationError,
      );
      connection.set("bufferCommands", false);
      const normalized = normalizeConfig({ connections: { default: { connection } } });
      assert.equal(normalized.connections.default?.connection, connection);
      assert.equal(normalized.connections.default?.owned, false);
      assert.throws(
        () =>
          normalizeConfig({
            connections: { default: { connection, uri } },
          }),
        ConfigurationError,
      );
    } finally {
      await connection.close();
    }
  });

  it("rejects invalid configurations without echoing credentials or unknown keys", () => {
    /** @type {unknown[]} */
    const invalid = [
      undefined,
      null,
      [],
      new Date(),
      {},
      { uri: "" },
      { uri: "https://secret:password@host" },
      { uri, options: { bufferCommands: true } },
      { uri, connections: {} },
      { connections: {} },
      { connections: { "bad name": { uri } } },
      { connections: { primary: { uri } } },
      { uri, defaultConnection: "missing" },
      { uri, requiredConnections: [] },
      { uri, requiredConnections: ["missing"] },
      { uri, requiredConnections: ["default", "default"] },
      { uri, requiredConnections: "default" },
      { connections: { default: { uri, secret: true } } },
      { connections: { default: { connection: {} } } },
      { uri, hooks: { secret: () => {} } },
      { uri, hooks: { onSuccess: "wrong" } },
      { uri, plugins: {} },
      { uri, plugins: [null] },
      {
        uri,
        plugins: [
          { name: "x", hooks: {} },
          { name: "x", hooks: {} },
        ],
      },
      { uri, plugins: [{ name: "x", secret: true }] },
      { uri, limits: { secret: 1 } },
      { uri, limits: { maxReadLimit: 5 } },
      { uri, secret: "password" },
      { uri, options: [] },
      { uri, options: null },
      { uri, limits: null },
      { uri, defaultConnection: null },
      { uri, requiredConnections: null },
    ];
    for (const input of invalid) {
      // Invalid external input is intentionally exercised beyond the static contract.
      assert.throws(
        () => normalizeConfig(/** @type {import("../src/types.js").MongoServiceConfig} */ (input)),
        (error) => {
          assert.ok(error instanceof ConfigurationError);
          assert.doesNotMatch(error.message, /password|secret:|https:/);
          return true;
        },
      );
    }
  });

  it("validates every numeric limit and its boundaries", () => {
    for (const key of Object.keys(DEFAULTS)) {
      for (const value of [null, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1"]) {
        assert.throws(() => normalizeConfig({ uri, limits: { [key]: value } }), ConfigurationError);
      }
    }
    assert.throws(
      () => normalizeConfig({ uri, limits: { batchSize: 10_001 } }),
      ConfigurationError,
    );
    assert.throws(() => normalizeConfig({ uri, limits: { concurrency: 33 } }), ConfigurationError);
    assert.throws(
      () => normalizeConfig({ uri, limits: { diagnosticSamples: 1_001 } }),
      ConfigurationError,
    );
    assert.equal(
      normalizeConfig({ uri, limits: { batchSize: 10_000, concurrency: 32 } }).limits.concurrency,
      32,
    );
  });
});

describe("retry normalization", () => {
  it("is off unless explicitly configured or activated by beforeRetry", () => {
    assert.equal(normalizeRetry().enabled, false);
    assert.equal(normalizeRetry(undefined, true).enabled, true);
    assert.equal(normalizeRetry(true).enabled, true);
    assert.equal(normalizeRetry({}, true).maxRetries, 2);
    assert.equal(normalizeRetry(false, true).enabled, false);
    assert.equal(normalizeRetry({ maxRetries: 0 }, true).enabled, false);
    assert.deepEqual(
      normalizeRetry({ maxRetries: 3, baseDelayMs: 1, maxDelayMs: 2, totalBudgetMS: 5 }),
      {
        enabled: true,
        maxRetries: 3,
        baseDelayMs: 1,
        maxDelayMs: 2,
        totalBudgetMS: 5,
      },
    );
  });
  it("rejects invalid and contradictory retry settings", () => {
    for (const input of [
      null,
      [],
      "yes",
      1,
      { unknown: 1 },
      { maxRetries: 11 },
      { baseDelayMs: 2, maxDelayMs: 1 },
      { totalBudgetMS: 0 },
      { maxRetries: null },
    ]) {
      assert.throws(() => normalizeRetry(input), ConfigurationError);
    }
  });
});

describe("batch control normalization", () => {
  it("preserves native defaults and validates explicit batched profiles", () => {
    assert.deepEqual(normalizeBatchOptions(), {
      batching: false,
      ordered: undefined,
      signal: undefined,
    });
    assert.equal(normalizeBatchOptions({ ordered: true }).ordered, true);
    const batch = normalizeBatchOptions({ batching: true });
    assert.ok(batch.batching);
    assert.equal(batch.batchSize, 500);
    assert.equal(batch.concurrency, 2);
    assert.equal(batch.failureMode, "continue");
    const signal = new AbortController().signal;
    assert.equal(
      normalizeBatchOptions({
        batching: true,
        ordered: true,
        concurrency: 1,
        failureMode: "stop",
        signal,
      }).signal,
      signal,
    );
  });
  it("rejects incompatible modes and invalid limits before input is consumed", () => {
    const invalid = [
      { batchSize: 500 },
      { concurrency: 2 },
      { failureMode: "continue" },
      { batching: "true" },
      { ordered: null },
      { signal: {} },
      { batching: true, concurrency: 33 },
      { batching: true, batchSize: 0 },
      { batching: true, maxBatchBytes: 0 },
      { batching: true, failureMode: "ignore" },
      { batching: true, ordered: true },
      { batching: true, ordered: true, concurrency: 1 },
      { extra: true },
    ];
    for (const input of invalid) {
      assert.throws(
        () => normalizeBatchOptions(/** @type {import("../src/types.js").BatchOptions} */ (input)),
        ConfigurationError,
      );
    }
  });
});
