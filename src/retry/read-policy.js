import { normalizeRetry } from "../config.js";
import { OperationAbortedError } from "../errors.js";

/** Named materialized reads that may be retried. */
export const RETRYABLE_METHODS = Object.freeze([
  "find",
  "findAll",
  "findOne",
  "findById",
  "exists",
  "countDocuments",
  "paginate",
  "paginateCursor",
]);

const TRANSIENT_NAMES = new Set([
  "MongoServerSelectionError",
  "MongoNetworkError",
  "MongoNetworkTimeoutError",
  "MongooseServerSelectionError",
  "MongoPoolClearedError",
  "MongoNotConnectedError",
]);

// HostUnreachable 6, HostNotFound 7, ShutdownInProgress 91, PrimarySteppedDown 189,
// InterruptedAtShutdown 11600, InterruptedDueToReplStateChange 11602, NotWritablePrimary 10107,
// NotPrimaryNoSecondaryOk 13435, NotPrimaryOrSecondary 13436, NetworkTimeout 89, SocketException 9001
const TRANSIENT_CODES = new Set([6, 7, 91, 189, 11600, 11602, 10107, 13435, 13436, 89, 9001]);

/**
 * Classifies by driver error class and numeric code only; message text is never inspected.
 * Cancellation and maxTimeMS expiry (code 50) are never transient.
 * @param {unknown} error
 */
export function isTransientReadError(error) {
  if (!error || typeof error !== "object") return false;
  const candidate = /** @type {{name?: unknown, code?: unknown}} */ (error);
  if (candidate.name === "AbortError" || candidate.code === 50) return false;
  if (typeof candidate.name === "string" && TRANSIENT_NAMES.has(candidate.name)) return true;
  return typeof candidate.code === "number" && TRANSIENT_CODES.has(candidate.code);
}

/**
 * Precedence: per-call false/0 disables; per-call settings override inherited fields and can
 * enable a disabled service policy; otherwise the service policy applies, except that an
 * effective call-level beforeRetry activates the default profile unless retry was disabled
 * explicitly. Service and plugin beforeRetry hooks are already folded into the service policy.
 * @param {import("../types.js").NormalizedConfig} config
 * @param {unknown} callRetry
 * @param {boolean} callHasBeforeRetry
 * @returns {Readonly<import("../types.js").NormalizedRetry>}
 */
export function resolveRetry(config, callRetry, callHasBeforeRetry) {
  const service = config.retry;
  if (callRetry === false) return Object.freeze({ ...service, enabled: false });
  if (callRetry !== undefined) {
    const fields = typeof callRetry === "object" && callRetry !== null ? callRetry : {};
    return normalizeRetry({
      maxRetries: service.maxRetries || 2,
      baseDelayMs: service.baseDelayMs,
      maxDelayMs: service.maxDelayMs,
      totalBudgetMS: service.totalBudgetMS,
      ...fields,
    });
  }
  if (config.retrySource === "disabled") return service;
  if (callHasBeforeRetry && !service.enabled) return normalizeRetry(undefined, true);
  return service;
}

/**
 * Bounded exponential full jitter.
 * @param {Readonly<import("../types.js").NormalizedRetry>} policy
 * @param {number} attempt 1-based attempt that just failed
 * @param {() => number} [random]
 */
export function computeDelay(policy, attempt, random = Math.random) {
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  return Math.floor(random() * (ceiling + 1));
}

/**
 * @param {number} ms
 * @param {AbortSignal} signal
 * @returns {Promise<void>}
 */
export function abortableDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    const aborted = () => new OperationAbortedError("Operation aborted while waiting to retry");
    if (signal.aborted) return reject(aborted());
    const onAbort = () => {
      clearTimeout(timer);
      reject(aborted());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
