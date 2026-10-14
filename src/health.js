import {
  ConnectionError,
  InvalidOptionError,
  OperationAbortedError,
  toSafeDiagnostic,
} from "./errors.js";
import { isPlain } from "./operations/guards.js";

const OPTION_KEYS = Object.freeze([
  "probe",
  "timeoutMS",
  "signal",
  "correlationId",
  "hooks",
  "metadata",
]);

/** @param {unknown} options @param {number} defaultTimeoutMS */
function parseOptions(options, defaultTimeoutMS) {
  if (options === undefined) return { probe: true, timeoutMS: defaultTimeoutMS, call: {} };
  if (!isPlain(options)) throw new InvalidOptionError("healthCheck options must be a plain object");
  const unknown = Object.keys(options).filter((key) => !OPTION_KEYS.includes(key));
  if (unknown.length > 0) {
    throw new InvalidOptionError(`Unknown healthCheck option: ${unknown[0]}`);
  }
  const { probe = true, timeoutMS = defaultTimeoutMS, ...call } = /** @type {any} */ (options);
  if (typeof probe !== "boolean") throw new InvalidOptionError("probe must be a boolean");
  if (!Number.isSafeInteger(timeoutMS) || timeoutMS <= 0) {
    throw new InvalidOptionError("timeoutMS must be a positive integer");
  }
  return { probe, timeoutMS, call };
}

/**
 * Pings once. A deadline only stops waiting: the native ping cannot be cancelled, so the
 * report says it may still be active instead of claiming it ended.
 * @param {import("mongoose").Connection} connection
 * @param {number} timeoutMS
 * @param {AbortSignal} signal
 */
async function ping(connection, timeoutMS, signal) {
  const started = performance.now();
  let timer;
  let onAbort = () => {};
  const native = Promise.resolve().then(() =>
    /** @type {import("mongodb").Db} */ (connection.db).admin().ping(),
  );
  const stop = new Promise((resolve) => {
    timer = setTimeout(() => resolve("deadline"), timeoutMS);
    onAbort = () => resolve("aborted");
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  const settled = native.then(
    () => "ok",
    (/** @type {unknown} */ error) => ({ error }),
  );
  try {
    const outcome = await Promise.race([settled, stop]);
    const latencyMs = Math.round((performance.now() - started) * 1000) / 1000;
    if (outcome === "ok") return { ok: true, latencyMs };
    if (outcome === "deadline") return { ok: false, latencyMs, deadlineExpired: true };
    if (outcome === "aborted") return { ok: false, aborted: true, latencyMs };
    return { ok: false, latencyMs, cause: /** @type {{ error: unknown }} */ (outcome).error };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

/**
 * @param {object} deps
 * @param {ReturnType<typeof import("./hooks/pipeline.js").createExecutor>} deps.executor
 * @param {ReturnType<typeof import("./connections/manager.js").createConnectionManager>} deps.manager
 * @param {import("./types.js").NormalizedConfig} deps.config
 */
export function createHealth({ executor, manager, config }) {
  /** @param {string} name @param {unknown} [rawOptions] @returns {Promise<import("./types.js").ConnectionHealth>} */
  async function checkConnection(name, rawOptions) {
    const { probe, timeoutMS, call } = parseOptions(rawOptions, config.limits.probeTimeoutMS);
    const status = manager.getStatus(name);
    const checkedAt = new Date().toISOString();
    const base = { name, state: status.state, checkedAt };
    const stateReady = status.state === "ready";
    if (!probe || !stateReady) {
      return Object.freeze({
        ...base,
        ready: probe ? false : stateReady,
        probed: false,
        ...(status.error ? { error: status.error } : {}),
      });
    }
    return /** @type {Promise<import("./types.js").ConnectionHealth>} */ (
      executor.execute({
        ...call,
        method: "healthCheck",
        connection: name,
        input: {},
        run: async (_input, ctx) => {
          const result = await ping(manager.getConnection(name), timeoutMS, ctx.signal);
          if (result.aborted) {
            throw new OperationAbortedError("Health check cancelled", { connection: name });
          }
          if (result.ok) {
            return Object.freeze({
              ...base,
              ready: true,
              probed: true,
              latencyMs: result.latencyMs,
            });
          }
          const failure = new ConnectionError(
            result.deadlineExpired
              ? `Health probe exceeded ${timeoutMS} ms`
              : "Health probe failed",
            {
              cause: result.cause,
              connection: name,
              databaseOutcome: result.deadlineExpired ? "uncertain" : "failed",
            },
          );
          return Object.freeze({
            ...base,
            ready: false,
            probed: true,
            latencyMs: result.latencyMs,
            ...(result.deadlineExpired
              ? { deadlineExpired: true, nativeOperationActive: true }
              : {}),
            error: toSafeDiagnostic(failure),
          });
        },
        classify: (/** @type {import("./types.js").ConnectionHealth} */ report) =>
          report.ready ? undefined : { invocationOutcome: "failed", databaseOutcome: "failed" },
      })
    );
  }

  /** @param {unknown} [rawOptions] @returns {Promise<import("./types.js").ServiceHealth>} */
  async function checkAll(rawOptions) {
    parseOptions(rawOptions, config.limits.probeTimeoutMS);
    const names = manager.names();
    const reports = await Promise.all(names.map((name) => checkConnection(name, rawOptions)));
    /** @type {Record<string, import("./types.js").ConnectionHealth>} */
    const connections = {};
    for (const report of reports) connections[report.name] = report;
    const required = config.requiredConnections;
    return Object.freeze({
      ready: required.every((name) => connections[name]?.ready === true),
      checkedAt: new Date().toISOString(),
      required: Object.freeze([...required]),
      connections: Object.freeze(connections),
    });
  }

  return Object.freeze({ checkConnection, checkAll });
}
