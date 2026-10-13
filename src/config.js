import { ConfigurationError } from "./errors.js";

export const DEFAULTS = Object.freeze({
  readLimit: 100,
  maxReadLimit: 1_000,
  pageLimit: 20,
  batchSize: 500,
  concurrency: 2,
  maxBatchBytes: 8 * 1024 * 1024,
  diagnosticSamples: 100,
  maxDiagnosticBytes: 64 * 1024,
  hookTimeoutMS: 5_000,
  drainTimeoutMS: 30_000,
  probeTimeoutMS: 5_000,
});

export const HOOK_NAMES = Object.freeze([
  "beforeOperation",
  "beforeRetry",
  "afterOperation",
  "beforeError",
  "onSuccess",
  "onError",
  "onComplete",
  "onHookError",
  "onBatch",
  "onProgress",
  "onConnectionConnecting",
  "onConnectionConnected",
  "onConnectionDisconnected",
  "onConnectionReconnected",
  "onConnectionError",
]);

/** @param {unknown} value @param {string} label @returns {Record<string, unknown>} */
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConfigurationError(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ConfigurationError(`${label} must be a plain object`);
  }
  return Object.fromEntries(Object.entries(value));
}

/** @param {Record<string, unknown>} value @param {readonly string[]} keys @param {string} label */
function known(value, keys, label) {
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    throw new ConfigurationError(`${label} contains an unsupported option`);
  }
}

/** @param {unknown} value @param {string} label @param {number} min @param {number} [max] @returns {number} */
function integer(value, label, min, max = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new ConfigurationError(`${label} must be a safe integer between ${min} and ${max}`);
  }
  return value;
}

/** @param {unknown} value @param {unknown} fallback */
function provided(value, fallback) {
  return value === undefined ? fallback : value;
}

/** @param {unknown} value @param {boolean} freeze @param {WeakMap<object, unknown>} seen @returns {unknown} */
function copyPlain(value, freeze, seen) {
  if (!value || typeof value !== "object") return value;
  const prototype = Object.getPrototypeOf(value);
  // Native handles retain their identity; only caller-owned containers are copied.
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return value;
  if (seen.has(value)) return seen.get(value);
  const copy = Array.isArray(value) ? [] : {};
  seen.set(value, copy);
  for (const [key, item] of Object.entries(value)) {
    Object.defineProperty(copy, key, {
      value: copyPlain(item, freeze, seen),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return freeze ? Object.freeze(copy) : copy;
}

/** @param {unknown} value @returns {unknown} */
const snapshot = (value) => copyPlain(value, true, new WeakMap());

/**
 * Mutable copy for handing normalized options to a driver that may modify them.
 * @template T
 * @param {T} value
 * @returns {T}
 */
export const cloneOptions = (value) => /** @type {T} */ (copyPlain(value, false, new WeakMap()));

/** @param {unknown} value @returns {Readonly<import("./types.js").Hooks>} */
function hooks(value = {}) {
  const input = object(value, "hooks");
  known(input, HOOK_NAMES, "hooks");
  if (Object.values(input).some((handler) => typeof handler !== "function")) {
    throw new ConfigurationError("Every configured hook must be a function");
  }
  return Object.freeze({ ...input });
}

export const normalizeHooks = hooks;

/** @param {unknown} value @returns {string} */
function name(value) {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)) {
    throw new ConfigurationError(
      "Names must be 1..64 ASCII letters, digits, underscores or hyphens",
    );
  }
  return value;
}

/**
 * Normalize one effective retry setting. Per-call inheritance is resolved by the future executor.
 * @param {unknown} [value]
 * @param {boolean} [hasBeforeRetry]
 * @returns {Readonly<import("./types.js").NormalizedRetry>}
 */
export function normalizeRetry(value, hasBeforeRetry = false) {
  if (value !== undefined && typeof value !== "boolean" && typeof value !== "object") {
    throw new ConfigurationError("retry must be a boolean or object");
  }
  const input = typeof value === "object" ? object(value, "retry") : {};
  known(input, ["maxRetries", "baseDelayMs", "maxDelayMs", "totalBudgetMS"], "retry");
  const maxRetries = integer(provided(input.maxRetries, 2), "maxRetries", 0, 10);
  const baseDelayMs = integer(provided(input.baseDelayMs, 100), "baseDelayMs", 0);
  const maxDelayMs = integer(provided(input.maxDelayMs, 1_000), "maxDelayMs", 0);
  const totalBudgetMS = integer(provided(input.totalBudgetMS, 10_000), "totalBudgetMS", 1);
  if (baseDelayMs > maxDelayMs) {
    throw new ConfigurationError("baseDelayMs must not exceed maxDelayMs");
  }
  return Object.freeze({
    enabled: value !== false && maxRetries > 0 && (value !== undefined || hasBeforeRetry),
    maxRetries,
    baseDelayMs,
    maxDelayMs,
    totalBudgetMS,
  });
}

/** @param {unknown} value @returns {import("./types.js").NormalizedConnection} */
function connection(value) {
  const input = object(value, "connection");
  known(input, ["uri", "options", "connection"], "connection");
  const options = object(provided(input.options, {}), "connection options");
  if (options.bufferCommands !== undefined && options.bufferCommands !== false) {
    throw new ConfigurationError("Connection command buffering must be disabled");
  }
  if (input.connection !== undefined) {
    if (input.uri !== undefined || input.options !== undefined) {
      throw new ConfigurationError("Caller-owned connection cannot also specify uri or options");
    }
    const native = input.connection;
    if (
      !native ||
      typeof native !== "object" ||
      !("get" in native) ||
      typeof native.get !== "function" ||
      !("asPromise" in native) ||
      typeof native.asPromise !== "function" ||
      !("readyState" in native) ||
      typeof native.readyState !== "number"
    ) {
      throw new ConfigurationError("connection must be a Mongoose Connection");
    }
    if (native.get("bufferCommands") !== false) {
      throw new ConfigurationError("Caller-owned connection must disable bufferCommands");
    }
    // The public Connection contract is checked before retaining its opaque identity.
    const existing = /** @type {import("mongoose").Connection} */ (native);
    return Object.freeze({ uri: undefined, connection: existing, options: {}, owned: false });
  }
  if (typeof input.uri !== "string" || !/^mongodb(?:\+srv)?:\/\/[^\s]+$/.test(input.uri)) {
    throw new ConfigurationError("A nonempty MongoDB URI is required");
  }
  return Object.freeze({
    uri: input.uri,
    connection: undefined,
    options: /** @type {import("mongoose").ConnectOptions} */ (
      snapshot({ ...options, bufferCommands: false })
    ),
    owned: true,
  });
}

/** @param {import("./types.js").MongoServiceConfig} config @returns {import("./types.js").NormalizedConfig} */
export function normalizeConfig(config) {
  const input = object(config, "config");
  known(
    input,
    [
      "uri",
      "options",
      "connections",
      "defaultConnection",
      "requiredConnections",
      "limits",
      "retry",
      "hooks",
      "plugins",
    ],
    "config",
  );
  if (input.connections !== undefined && (input.uri !== undefined || input.options !== undefined)) {
    throw new ConfigurationError("Use either uri/options or named connections");
  }
  const entries =
    input.connections === undefined
      ? { default: { uri: input.uri, options: input.options } }
      : object(input.connections, "connections");
  if (!Object.keys(entries).length)
    throw new ConfigurationError("At least one connection is required");
  /** @type {Record<string, import("./types.js").NormalizedConnection>} */
  const connections = {};
  for (const [key, value] of Object.entries(entries)) connections[name(key)] = connection(value);
  const defaultConnection = name(provided(input.defaultConnection, "default"));
  if (!Object.hasOwn(connections, defaultConnection)) {
    throw new ConfigurationError("defaultConnection must identify a configured connection");
  }
  const required = provided(input.requiredConnections, Object.keys(connections));
  if (
    !Array.isArray(required) ||
    required.length === 0 ||
    required.some((key) => typeof key !== "string" || !Object.hasOwn(connections, key)) ||
    new Set(required).size !== required.length
  ) {
    throw new ConfigurationError("requiredConnections must be a nonempty unique configured subset");
  }
  const limitInput = object(provided(input.limits, {}), "limits");
  known(limitInput, Object.keys(DEFAULTS), "limits");
  const limits = {
    readLimit: integer(provided(limitInput.readLimit, DEFAULTS.readLimit), "readLimit", 1),
    maxReadLimit: integer(
      provided(limitInput.maxReadLimit, DEFAULTS.maxReadLimit),
      "maxReadLimit",
      1,
    ),
    pageLimit: integer(provided(limitInput.pageLimit, DEFAULTS.pageLimit), "pageLimit", 1),
    batchSize: integer(provided(limitInput.batchSize, DEFAULTS.batchSize), "batchSize", 1, 10_000),
    concurrency: integer(
      provided(limitInput.concurrency, DEFAULTS.concurrency),
      "concurrency",
      1,
      32,
    ),
    maxBatchBytes: integer(
      provided(limitInput.maxBatchBytes, DEFAULTS.maxBatchBytes),
      "maxBatchBytes",
      1,
    ),
    diagnosticSamples: integer(
      provided(limitInput.diagnosticSamples, DEFAULTS.diagnosticSamples),
      "diagnosticSamples",
      0,
      1_000,
    ),
    maxDiagnosticBytes: integer(
      provided(limitInput.maxDiagnosticBytes, DEFAULTS.maxDiagnosticBytes),
      "maxDiagnosticBytes",
      1,
    ),
    hookTimeoutMS: integer(
      provided(limitInput.hookTimeoutMS, DEFAULTS.hookTimeoutMS),
      "hookTimeoutMS",
      1,
    ),
    drainTimeoutMS: integer(
      provided(limitInput.drainTimeoutMS, DEFAULTS.drainTimeoutMS),
      "drainTimeoutMS",
      1,
    ),
    probeTimeoutMS: integer(
      provided(limitInput.probeTimeoutMS, DEFAULTS.probeTimeoutMS),
      "probeTimeoutMS",
      1,
    ),
  };
  if (limits.readLimit > limits.maxReadLimit || limits.pageLimit > limits.maxReadLimit) {
    throw new ConfigurationError("Default read/page limits must not exceed maxReadLimit");
  }
  const serviceHooks = hooks(input.hooks);
  if (input.plugins !== undefined && !Array.isArray(input.plugins)) {
    throw new ConfigurationError("plugins must be an array");
  }
  const plugins = (input.plugins ?? []).map((value) => {
    const plugin = object(value, "plugin");
    known(plugin, ["name", "hooks"], "plugin");
    return Object.freeze({ name: name(plugin.name), hooks: hooks(plugin.hooks) });
  });
  if (new Set(plugins.map((plugin) => plugin.name)).size !== plugins.length) {
    throw new ConfigurationError("Plugin names must be unique");
  }
  return Object.freeze({
    connections: Object.freeze(connections),
    defaultConnection,
    requiredConnections: Object.freeze([...required]),
    limits: Object.freeze(limits),
    hooks: serviceHooks,
    plugins: Object.freeze(plugins),
    retry: normalizeRetry(
      input.retry,
      !!serviceHooks.beforeRetry || plugins.some((plugin) => !!plugin.hooks.beforeRetry),
    ),
    retrySource:
      input.retry === false ||
      (typeof input.retry === "object" &&
        input.retry !== null &&
        "maxRetries" in input.retry &&
        input.retry.maxRetries === 0)
        ? "disabled"
        : input.retry === undefined
          ? "inferred"
          : "configured",
  });
}

/**
 * Validates batching controls without consuming input or executing writes.
 * @param {import("./types.js").BatchOptions} [options]
 */
export function normalizeBatchOptions(options = {}) {
  const input = object(options, "batch options");
  known(
    input,
    ["batching", "batchSize", "concurrency", "maxBatchBytes", "ordered", "failureMode", "signal"],
    "batch options",
  );
  if (input.batching !== undefined && typeof input.batching !== "boolean") {
    throw new ConfigurationError("batching must be a boolean");
  }
  if (input.ordered !== undefined && typeof input.ordered !== "boolean") {
    throw new ConfigurationError("ordered must be a boolean");
  }
  if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) {
    throw new ConfigurationError("signal must be an AbortSignal");
  }
  if (input.batching !== true) {
    if (
      ["batchSize", "concurrency", "maxBatchBytes", "failureMode"].some(
        (key) => input[key] !== undefined,
      )
    ) {
      throw new ConfigurationError("Batch-only controls require batching: true");
    }
    return Object.freeze({ batching: false, ordered: input.ordered, signal: input.signal });
  }
  const batchSize = integer(provided(input.batchSize, DEFAULTS.batchSize), "batchSize", 1, 10_000);
  const concurrency = integer(
    provided(input.concurrency, DEFAULTS.concurrency),
    "concurrency",
    1,
    32,
  );
  const maxBatchBytes = integer(
    provided(input.maxBatchBytes, DEFAULTS.maxBatchBytes),
    "maxBatchBytes",
    1,
  );
  const ordered = input.ordered ?? false;
  const failureMode = provided(input.failureMode, "continue");
  if (failureMode !== "continue" && failureMode !== "stop") {
    throw new ConfigurationError("failureMode must be continue or stop");
  }
  if (ordered && (concurrency !== 1 || failureMode !== "stop")) {
    throw new ConfigurationError("Ordered batches require concurrency 1 and failureMode stop");
  }
  return Object.freeze({
    batching: true,
    batchSize,
    concurrency,
    maxBatchBytes,
    ordered,
    failureMode,
    signal: input.signal,
  });
}
