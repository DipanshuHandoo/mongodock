import { cloneOptions } from "../config.js";
import { InvalidOptionError } from "../errors.js";
import { assertNoUndefined, isPlain } from "./guards.js";

/** Wrapper-owned fields that must never be smuggled into native options. */
const OWNED = [
  "model",
  "filter",
  "update",
  "data",
  "id",
  "sort",
  "limit",
  "skip",
  "projection",
  "select",
  "populate",
  "lean",
  "signal",
  "hooks",
  "retry",
  "allowAll",
  "allowWriteStages",
];
const RETURN_ALIASES = [
  "new",
  "returnDocument",
  "returnOriginal",
  "includeResultMetadata",
  "rawResult",
];
const MAX_POPULATE = 5;
const SORT_DIRECTIONS = new Set([1, -1, "asc", "desc", "ascending", "descending"]);

/** @param {Record<string, unknown>} object */
export const compact = (object) =>
  Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));

/** @param {unknown} body @param {readonly string[]} allowed @param {string} method */
export function assertKnownKeys(body, allowed, method) {
  if (!isPlain(body)) throw new InvalidOptionError(`${method} input must be a plain object`);
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw new InvalidOptionError(`${method} does not accept "${key}"`);
  }
}

/**
 * @param {unknown} value @param {string} method
 * @param {{ forbid?: readonly string[], defaults?: Record<string, unknown> }} [rules]
 */
export function normalizeOptions(value, method, { forbid = [], defaults = {} } = {}) {
  if (value !== undefined && !isPlain(value)) {
    throw new InvalidOptionError(`${method} options must be a plain object`);
  }
  const options = { ...(value ?? {}) };
  for (const key of [...OWNED, ...forbid]) {
    if (key in options) {
      throw new InvalidOptionError(`${method} option "${key}" is a top-level field or unsupported`);
    }
  }
  const session = options.session;
  if (
    session !== undefined &&
    (!session || typeof (/** @type {any} */ (session).inTransaction) !== "function")
  ) {
    throw new InvalidOptionError("options.session must be a ClientSession");
  }
  return cloneOptions({ ...defaults, ...options });
}

/** @param {unknown} value @param {string} [label] */
export function normalizeFilter(value, label = "filter") {
  if (!isPlain(value)) throw new InvalidOptionError(`${label} must be a plain object`);
  assertNoUndefined(value, label);
  return value;
}

/** @param {unknown} value */
export function normalizeId(value) {
  const invalid =
    value === null ||
    value === undefined ||
    Array.isArray(value) ||
    isPlain(value) ||
    typeof value === "function" ||
    typeof value === "symbol" ||
    typeof value === "boolean";
  if (invalid) throw new InvalidOptionError("id must be a scalar identifier, not a query object");
  return value;
}

/** @param {unknown} value */
export function normalizeUpdate(value) {
  const stages = Array.isArray(value) ? value : [value];
  if (
    stages.length === 0 ||
    stages.some((item) => !isPlain(item) || Object.keys(item).length === 0)
  ) {
    throw new InvalidOptionError("update must be a non-empty object or pipeline");
  }
  assertNoUndefined(value, "update");
  return value;
}

/** @param {unknown} value */
export function normalizeProjection(value) {
  if (value === undefined) return undefined;
  if (typeof value === "string" || isPlain(value)) return value;
  throw new InvalidOptionError("projection must be a string or plain object");
}

/** @param {unknown} value */
export function normalizeSort(value) {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  const entries = Array.isArray(value) ? value : isPlain(value) ? Object.entries(value) : undefined;
  const valid = entries?.every(
    (entry) =>
      Array.isArray(entry) &&
      entry.length === 2 &&
      typeof entry[0] === "string" &&
      (SORT_DIRECTIONS.has(entry[1]) || isPlain(entry[1])),
  );
  if (!valid)
    throw new InvalidOptionError("sort must be a string, object, or [field, direction] pairs");
  return value;
}

/** @param {unknown} value @param {number} [depth] */
export function normalizePopulate(value, depth = 0) {
  if (value === undefined) return undefined;
  const entries = Array.isArray(value) ? value : [value];
  if (entries.length === 0 || entries.length > MAX_POPULATE || depth > 2) {
    throw new InvalidOptionError(`populate accepts 1..${MAX_POPULATE} paths and depth 2`);
  }
  for (const entry of entries) {
    if (typeof entry === "string") continue;
    if (!isPlain(entry) || typeof entry.path !== "string") {
      throw new InvalidOptionError("populate entries must be a path string or { path }");
    }
    if (entry.populate !== undefined) normalizePopulate(entry.populate, depth + 1);
  }
  return value;
}

/** @param {unknown} value */
export function normalizeLean(value) {
  if (value !== undefined && typeof value !== "boolean") {
    throw new InvalidOptionError("lean must be a boolean");
  }
  return value === true;
}

/** @param {unknown} value @param {{readLimit: number, maxReadLimit: number}} limits */
export function normalizeLimit(value, limits) {
  const limit = value ?? limits.readLimit;
  if (!Number.isSafeInteger(limit) || /** @type {number} */ (limit) < 1) {
    throw new InvalidOptionError("limit must be a positive integer; unbounded reads are rejected");
  }
  if (/** @type {number} */ (limit) > limits.maxReadLimit) {
    throw new InvalidOptionError(`limit exceeds the configured maximum of ${limits.maxReadLimit}`);
  }
  return /** @type {number} */ (limit);
}

/** @param {unknown} value */
export function normalizeSkip(value) {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || /** @type {number} */ (value) < 0) {
    throw new InvalidOptionError("skip must be a non-negative integer");
  }
  return /** @type {number} */ (value);
}

/** @param {unknown} value @param {string} label */
export function normalizeFlag(value, label) {
  if (value !== undefined && typeof value !== "boolean") {
    throw new InvalidOptionError(`${label} must be a boolean`);
  }
  return value === true;
}

/**
 * Collapses new/returnDocument/returnOriginal into `returnDocument`; contradictions fail.
 * Default is the post-update document.
 * @param {Record<string, unknown>} options
 */
export function resolveReturnDocument(options) {
  const { new: isNew, returnDocument, returnOriginal, ...rest } = options;
  /** @type {string[]} */
  const choices = [];
  if (isNew !== undefined) {
    if (typeof isNew !== "boolean") throw new InvalidOptionError("options.new must be a boolean");
    choices.push(isNew ? "after" : "before");
  }
  if (returnDocument !== undefined) {
    if (returnDocument !== "before" && returnDocument !== "after") {
      throw new InvalidOptionError('options.returnDocument must be "before" or "after"');
    }
    choices.push(returnDocument);
  }
  if (returnOriginal !== undefined) {
    if (typeof returnOriginal !== "boolean") {
      throw new InvalidOptionError("options.returnOriginal must be a boolean");
    }
    choices.push(returnOriginal ? "before" : "after");
  }
  if (new Set(choices).size > 1) {
    throw new InvalidOptionError("options.new, returnDocument and returnOriginal contradict");
  }
  return { ...rest, returnDocument: choices[0] ?? "after" };
}

export { RETURN_ALIASES };

/**
 * Applies wrapper fields to a Mongoose query; native options go through setOptions only.
 * @template {import("mongoose").Query<any, any>} Q
 * @param {Q} query
 * @param {{ options?: Record<string, unknown>, projection?: unknown, sort?: unknown, skip?: number, limit?: number, populate?: unknown, lean?: boolean }} input
 * @returns {Q}
 */
export function applyQuery(query, input) {
  if (input.options) query.setOptions(/** @type {any} */ (input.options));
  if (input.projection !== undefined) query.select(/** @type {any} */ (input.projection));
  if (input.sort !== undefined) query.sort(/** @type {any} */ (input.sort));
  if (input.skip) query.skip(input.skip);
  if (input.limit !== undefined) query.limit(input.limit);
  if (input.populate !== undefined) query.populate(/** @type {any} */ (input.populate));
  if (input.lean) query.lean();
  return query;
}
