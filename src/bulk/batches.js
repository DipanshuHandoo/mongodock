import mongoose from "mongoose";
import { InvalidOptionError } from "../errors.js";
import { assertMutationFilter, assertNoUndefined, isPlain } from "../operations/guards.js";
import { normalizeUpdate } from "../operations/query-options.js";

const FILTERED = new Set(["updateOne", "updateMany", "replaceOne", "deleteOne", "deleteMany"]);
const KINDS = new Set(["insertOne", ...FILTERED]);

/**
 * BSON size of one operation as the peer driver's public BSON surface sees it. Mongoose
 * documents are measured by their plain form; this is an application-buffer estimate, not an
 * exact wire-message size.
 * @param {Record<string, any>} operation
 */
export function measureOperation(operation) {
  const kind = Object.keys(operation)[0] ?? "";
  const body = operation[kind];
  const measurable =
    kind === "insertOne" && typeof body.document?.toObject === "function"
      ? { insertOne: { ...body, document: body.document.toObject() } }
      : operation;
  try {
    return mongoose.mongo.BSON.calculateObjectSize(measurable);
  } catch (cause) {
    throw new InvalidOptionError("Operation cannot be serialized to BSON", { cause });
  }
}

/**
 * Validates one native bulk operation and applies the same mutation guards as single-call
 * writes. Runs on the final (post-hook) operation, so a transformation cannot bypass a guard.
 * @param {unknown} operation @param {boolean | undefined} allowAll
 */
export function assertOperation(operation, allowAll) {
  if (!isPlain(operation)) throw new InvalidOptionError("Bulk operation must be a plain object");
  const keys = Object.keys(operation);
  const kind = keys[0];
  if (keys.length !== 1 || kind === undefined || !KINDS.has(kind)) {
    throw new InvalidOptionError(
      "Bulk operation must have exactly one of insertOne, updateOne, updateMany, replaceOne, deleteOne, deleteMany",
    );
  }
  const body = operation[kind];
  if (!isPlain(body)) throw new InvalidOptionError(`${kind} must be a plain object`);
  if (kind === "insertOne") {
    const document = body.document;
    if (!document || typeof document !== "object" || Array.isArray(document)) {
      throw new InvalidOptionError("insertOne.document must be an object");
    }
    return kind;
  }
  if (!isPlain(body.filter)) throw new InvalidOptionError(`${kind}.filter must be a plain object`);
  assertNoUndefined(body.filter, `${kind}.filter`);
  assertMutationFilter(body.filter, allowAll, kind);
  if (kind === "replaceOne") {
    const replacement = body.replacement;
    if (!replacement || typeof replacement !== "object" || Array.isArray(replacement)) {
      throw new InvalidOptionError("replaceOne.replacement must be an object");
    }
  } else if (kind === "updateOne" || kind === "updateMany") {
    normalizeUpdate(body.update);
  }
  return kind;
}

/**
 * @param {unknown} source
 * @returns {"array" | "iterable" | "asyncIterable" | undefined}
 */
export function sourceKind(source) {
  if (Array.isArray(source)) return "array";
  if (!source || typeof source !== "object") return undefined;
  if (typeof (/** @type {any} */ (source)[Symbol.asyncIterator]) === "function") {
    return "asyncIterable";
  }
  if (typeof (/** @type {any} */ (source)[Symbol.iterator]) === "function") return "iterable";
  return undefined;
}

/**
 * Whole-array validation before any dispatch, so a bad array never produces partial writes.
 * @param {readonly unknown[]} operations @param {{ allowAll?: boolean | undefined, maxBatchBytes?: number | undefined }} rules
 */
export function assertOperations(operations, { allowAll, maxBatchBytes }) {
  operations.forEach((operation, index) => {
    try {
      assertOperation(operation, allowAll);
      if (maxBatchBytes !== undefined) {
        const bytes = measureOperation(/** @type {any} */ (operation));
        if (bytes > maxBatchBytes) {
          throw new InvalidOptionError(
            `Operation is ${bytes} bytes, above maxBatchBytes (${maxBatchBytes})`,
          );
        }
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "invalid operation";
      throw new InvalidOptionError(`operations[${index}]: ${message}`, { cause });
    }
  });
}

/**
 * @typedef {object} Batch
 * @property {number} index Zero-based batch number.
 * @property {number} startIndex Input index of the first operation.
 * @property {Record<string, any>[]} ops
 * @property {number} bytes
 */

/**
 * Lazily groups a source into record- and byte-bounded batches. At most one batch plus one
 * pending operation is buffered. A source or validation failure flushes the pending batch first
 * so every consumed operation is accounted for, then rethrows. Closing the generator closes the
 * source iterator.
 * @param {Iterable<unknown> | AsyncIterable<unknown>} source
 * @param {{ batchSize: number, maxBatchBytes: number, allowAll?: boolean | undefined }} limits
 * @returns {AsyncGenerator<Batch, void, void>}
 */
export async function* createBatches(source, { batchSize, maxBatchBytes, allowAll }) {
  const asynchronous = typeof (/** @type {any} */ (source)[Symbol.asyncIterator]) === "function";
  const iterator = asynchronous
    ? /** @type {AsyncIterable<unknown>} */ (source)[Symbol.asyncIterator]()
    : /** @type {Iterable<unknown>} */ (source)[Symbol.iterator]();
  /** @type {Record<string, any>[]} */
  let ops = [];
  let bytes = 0;
  let startIndex = 0;
  let accepted = 0;
  let index = 0;
  /** @returns {Batch} */
  const flush = () => {
    const batch = { index, startIndex, ops, bytes };
    index += 1;
    startIndex += ops.length;
    ops = [];
    bytes = 0;
    return batch;
  };
  try {
    for (;;) {
      /** @type {Record<string, any> | undefined} */
      let operation;
      let size = 0;
      try {
        const step = await iterator.next();
        if (step.done) break;
        operation = /** @type {Record<string, any>} */ (step.value);
        assertOperation(operation, allowAll);
        size = measureOperation(operation);
        if (size > maxBatchBytes) {
          throw new InvalidOptionError(
            `Operation is ${size} bytes, above maxBatchBytes (${maxBatchBytes})`,
          );
        }
      } catch (cause) {
        if (ops.length > 0) yield flush();
        if (operation !== undefined && cause instanceof InvalidOptionError) {
          throw new InvalidOptionError(`operations[${accepted}]: ${cause.message}`, { cause });
        }
        throw cause;
      }
      if (ops.length > 0 && (ops.length >= batchSize || bytes + size > maxBatchBytes)) {
        yield flush();
      }
      ops.push(operation);
      bytes += size;
      accepted += 1;
    }
    if (ops.length > 0) yield flush();
  } finally {
    await iterator.return?.();
  }
}
