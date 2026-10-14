import { InvalidOptionError } from "../errors.js";

const MAX_DEPTH = 32;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
export const isPlain = (value) =>
  !!value &&
  typeof value === "object" &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));

/**
 * Mongoose and the driver can turn undefined into null or drop the condition, which silently
 * widens a filter. Native handles (ObjectId, Date, RegExp, ...) are not inspected.
 * @param {unknown} value @param {string} label @param {number} [depth]
 */
export function assertNoUndefined(value, label, depth = 0) {
  if (depth > MAX_DEPTH) throw new InvalidOptionError(`${label} is nested too deeply`);
  if (value === undefined) throw new InvalidOptionError(`${label} must not contain undefined`);
  if (Array.isArray(value)) {
    for (const item of value) assertNoUndefined(item, label, depth + 1);
  } else if (isPlain(value)) {
    for (const item of Object.values(value)) assertNoUndefined(item, label, depth + 1);
  }
}

/**
 * Structural analysis only: an empty object, or a logical $and/$or whose branches cannot
 * restrict anything. Field operators such as { a: { $exists: true } } are not analysed and
 * may still match every document; allowAll is the explicit opt-in for intentional bulk work.
 * @param {unknown} filter
 * @returns {boolean}
 */
export function isEmptyFilter(filter) {
  if (!isPlain(filter)) return false;
  const keys = Object.keys(filter);
  if (keys.length === 0) return true;
  return keys.every((key) => {
    const branches = filter[key];
    if (key !== "$and" && key !== "$or") return false;
    if (!Array.isArray(branches)) return false;
    if (branches.length === 0) return true;
    return key === "$and" ? branches.every(isEmptyFilter) : branches.some(isEmptyFilter);
  });
}

/**
 * Reusable mutation guard (also used for nested bulk operations).
 * @param {unknown} filter @param {boolean | undefined} allowAll @param {string} method
 */
export function assertMutationFilter(filter, allowAll, method) {
  if (allowAll !== true && isEmptyFilter(filter)) {
    throw new InvalidOptionError(
      `${method} requires a restrictive filter; pass allowAll: true to affect every document`,
    );
  }
}

const PIPELINE_WRITE_STAGES = new Set(["$out", "$merge"]);

/**
 * Rejects $out/$merge unless allowed, including inside nested pipelines. Shapes that cannot be
 * inspected are rejected rather than trusted.
 * @param {unknown} pipeline @param {boolean | undefined} allowWriteStages @param {number} [depth]
 */
export function scanPipeline(pipeline, allowWriteStages, depth = 0) {
  if (depth > 10) throw new InvalidOptionError("Aggregation pipeline is nested too deeply");
  if (!Array.isArray(pipeline)) throw new InvalidOptionError("pipeline must be an array");
  for (const stage of pipeline) {
    if (!isPlain(stage))
      throw new InvalidOptionError("Every pipeline stage must be a plain object");
    const keys = Object.keys(stage);
    const name = keys[0];
    if (keys.length !== 1 || name === undefined || !name.startsWith("$")) {
      throw new InvalidOptionError("Every pipeline stage must have exactly one $-operator");
    }
    const body = stage[name];
    if (PIPELINE_WRITE_STAGES.has(name)) {
      if (allowWriteStages !== true) {
        throw new InvalidOptionError(`${name} requires allowWriteStages: true`);
      }
      continue;
    }
    if (name === "$lookup" && isPlain(body) && body.pipeline !== undefined) {
      scanPipeline(body.pipeline, allowWriteStages, depth + 1);
    } else if (name === "$unionWith") {
      if (isPlain(body)) {
        if (body.pipeline !== undefined) scanPipeline(body.pipeline, allowWriteStages, depth + 1);
      } else if (typeof body !== "string") {
        throw new InvalidOptionError("$unionWith has an uninspectable shape");
      }
    } else if (name === "$facet") {
      if (!isPlain(body)) throw new InvalidOptionError("$facet has an uninspectable shape");
      for (const branch of Object.values(body)) scanPipeline(branch, allowWriteStages, depth + 1);
    }
  }
}
