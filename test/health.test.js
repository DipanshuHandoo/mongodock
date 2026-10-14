import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeConfig } from "../src/config.js";
import { createHealth } from "../src/health.js";
import { createExecutor } from "../src/hooks/pipeline.js";
import { InvalidOptionError, OperationAbortedError } from "../src/index.js";

/**
 * @param {Record<string, { state?: string, ping?: () => Promise<unknown> }>} spec
 * @param {Record<string, unknown>} [extra]
 */
function setup(spec, extra = {}) {
  const names = Object.keys(spec);
  const config = normalizeConfig({
    connections: Object.fromEntries(names.map((n) => [n, { uri: "mongodb://localhost:27017/x" }])),
    defaultConnection: /** @type {string} */ (names[0]),
    ...extra,
  });
  const pings = /** @type {string[]} */ ([]);
  const manager = {
    names: () => names,
    getStatus: (/** @type {string} */ name) => ({
      name,
      state: spec[name]?.state ?? "ready",
      ...(spec[name]?.state === "failed"
        ? { error: { code: "ERR_CONNECTION", databaseOutcome: "failed" } }
        : {}),
    }),
    getConnection: (/** @type {string} */ name) => ({
      db: {
        admin: () => ({
          ping: () => {
            pings.push(name);
            const custom = spec[name]?.ping;
            return custom ? custom() : Promise.resolve({ ok: 1 });
          },
        }),
      },
    }),
  };
  const health = createHealth({
    executor: createExecutor({ config }),
    manager: /** @type {any} */ (manager),
    config,
  });
  return { health, pings };
}

const never = () => new Promise(() => undefined);

describe("healthCheck", () => {
  it("probes a ready connection and reports latency", async () => {
    const { health, pings } = setup({ main: {} });
    const report = await health.checkConnection("main");
    assert.equal(report.ready, true);
    assert.equal(report.probed, true);
    assert.equal(report.state, "ready");
    assert.equal(typeof report.latencyMs, "number");
    assert.ok(!Number.isNaN(Date.parse(report.checkedAt)));
    assert.deepEqual(pings, ["main"]);
  });

  it("probe:false is status-only and never touches the network", async () => {
    const { health, pings } = setup({ main: {}, other: { state: "idle" } });
    const ready = await health.checkConnection("main", { probe: false });
    const idle = await health.checkConnection("other", { probe: false });
    assert.deepEqual([ready.ready, ready.probed], [true, false]);
    assert.deepEqual([idle.ready, idle.probed, idle.state], [false, false, "idle"]);
    assert.deepEqual(pings, []);
  });

  it("reports not-ready connections without probing and exposes the safe error", async () => {
    const { health, pings } = setup({ main: { state: "failed" } });
    const report = await health.checkConnection("main");
    assert.equal(report.ready, false);
    assert.equal(report.probed, false);
    assert.equal(report.error?.code, "ERR_CONNECTION");
    assert.deepEqual(pings, []);
  });

  it("turns a ping failure into an unhealthy report and notifies error observers", async () => {
    const secret = new Error("auth failed for mongodb://user:pw@host");
    const { health } = setup({ main: { ping: () => Promise.reject(secret) } });
    const seen = /** @type {any[]} */ ([]);
    const report = await health.checkConnection("main", {
      hooks: {
        onError: (/** @type {any} */ payload) => seen.push(payload),
        onSuccess: () => assert.fail("not a success"),
      },
    });
    assert.equal(report.ready, false);
    assert.equal(report.probed, true);
    assert.equal(report.error?.code, "ERR_CONNECTION");
    assert.ok(!JSON.stringify(report).includes("pw@"));
    assert.equal(seen.length, 1);
    assert.equal(seen[0].context.method, "healthCheck");
  });

  it("distinguishes an expired deadline from a failed ping", async () => {
    const { health } = setup({ main: { ping: never } });
    const report = await health.checkConnection("main", { timeoutMS: 15 });
    assert.equal(report.ready, false);
    assert.equal(report.deadlineExpired, true);
    assert.equal(report.nativeOperationActive, true);
    assert.equal(report.error?.databaseOutcome, "uncertain");
  });

  it("uses limits.probeTimeoutMS as the default budget", async () => {
    const { health } = setup({ main: { ping: never } }, { limits: { probeTimeoutMS: 15 } });
    const report = await health.checkConnection("main");
    assert.equal(report.deadlineExpired, true);
  });

  it("cancels on abort", async () => {
    const { health } = setup({ main: { ping: never } });
    const controller = new AbortController();
    const pending = health.checkConnection("main", { signal: controller.signal });
    setTimeout(() => controller.abort(), 5);
    await assert.rejects(pending, OperationAbortedError);
  });

  it("validates options", async () => {
    const { health } = setup({ main: {} });
    await assert.rejects(health.checkConnection("main", { probe: "yes" }), InvalidOptionError);
    await assert.rejects(health.checkConnection("main", { timeoutMS: 0 }), InvalidOptionError);
    await assert.rejects(health.checkConnection("main", { retry: true }), InvalidOptionError);
    await assert.rejects(health.checkConnection("main", "x"), InvalidOptionError);
  });

  it("aggregates readiness over required connections only", async () => {
    const spec = { main: {}, cache: { state: "idle" } };
    const all = await setup(spec).health.checkAll();
    assert.equal(all.ready, false);
    assert.deepEqual(all.required, ["main", "cache"]);
    assert.equal(all.connections.cache?.ready, false);

    const subset = await setup(spec, { requiredConnections: ["main"] }).health.checkAll();
    assert.equal(subset.ready, true);
    assert.deepEqual(subset.required, ["main"]);
    assert.equal(subset.connections.cache?.ready, false);
  });

  it("probes connections in parallel", async () => {
    const slow = () => new Promise((resolve) => setTimeout(resolve, 30));
    const { health } = setup({ a: { ping: slow }, b: { ping: slow }, c: { ping: slow } });
    const started = Date.now();
    const report = await health.checkAll();
    assert.equal(report.ready, true);
    assert.ok(Date.now() - started < 80);
  });
});
