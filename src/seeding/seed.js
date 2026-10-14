import { assertOperations, createBatches, sourceKind } from "../bulk/batches.js";
import { normalizeBatchControls, runBatched } from "../bulk/bulk-write.js";
import { bulkWriteSpec } from "../bulk/bulk-write.js";
import { BulkError, InvalidOptionError, OperationAbortedError } from "../errors.js";
import { isPlain } from "../operations/guards.js";
import {
  assertKnownKeys,
  compact,
  normalizeFlag,
  normalizeOptions,
} from "../operations/query-options.js";
import { assertSeedIndex, isScalarKey, keyIdentity, normalizeKeyFields } from "./keys.js";

/** @typedef {import("../operations/spec.js").OperationSpec} OperationSpec */

const NATIVE_KEYS = ["records", "keyFields", "dryRun", "updateExisting", "batching", "options"];
const BATCH_ONLY = [
  "batchSize",
  "concurrency",
  "maxBatchBytes",
  "failureMode",
  "onBatch",
  "uniqueSource",
];
const BATCHED_KEYS = [...NATIVE_KEYS, ...BATCH_ONLY];

/** @param {unknown} key */
const operatorShaped = (key) =>
  typeof key === "string" && (key.startsWith("$") || key.includes("."));

/** @param {any} model @param {string} path */
const isImmutable = (model, path) =>
  model.schema.path(path)?.options?.immutable === true ||
  typeof model.schema.path(path)?.options?.immutable === "function";

/**
 * Turns one record into a keyed upsert. Validation runs on a hydrated copy, so defaults, casts,
 * `required`, custom validators and strictness apply; messages carry paths, never values.
 * @param {import("mongoose").Model<any>} model
 * @param {unknown} record @param {number} index
 * @param {{ keyFields: readonly string[], updateExisting: boolean }} config
 */
async function prepareRecord(model, record, index, { keyFields, updateExisting }) {
  const at = `records[${index}]`;
  if (!isPlain(record)) throw new InvalidOptionError(`${at}: record must be a plain object`);
  const provided = Object.keys(record);
  const bad = provided.find(operatorShaped);
  if (bad !== undefined) {
    throw new InvalidOptionError(
      `${at}: field "${bad}" is operator-shaped; records are plain documents`,
    );
  }
  for (const field of keyFields) {
    if (record[field] === undefined || record[field] === null) {
      throw new InvalidOptionError(`${at}: key field "${field}" must be provided explicitly`);
    }
  }

  let prepared;
  try {
    const doc = new model(record);
    await doc.validate();
    prepared = doc.toObject({
      depopulate: true,
      versionKey: false,
      virtuals: false,
      minimize: false,
    });
  } catch (cause) {
    const paths = /** @type {any} */ (cause)?.errors
      ? Object.keys(/** @type {any} */ (cause).errors)
      : [];
    const detail =
      paths.length > 0
        ? `validation failed for ${paths.join(", ")}`
        : "could not be cast to the schema";
    throw new InvalidOptionError(`${at}: ${detail}`, { cause });
  }

  /** @type {Record<string, unknown>} */
  const filter = {};
  for (const field of keyFields) {
    const value = prepared[field];
    if (!isScalarKey(value)) {
      throw new InvalidOptionError(
        `${at}: key field "${field}" must cast to a non-empty scalar (string, number, boolean, Date or BSON scalar)`,
      );
    }
    filter[field] = value;
  }

  /** @type {Record<string, unknown>} */
  const set = {};
  if (updateExisting) {
    for (const field of provided) {
      if (keyFields.includes(field) || field === "_id" || !(field in prepared)) continue;
      if (isImmutable(model, field)) {
        throw new InvalidOptionError(
          `${at}: immutable field "${field}" cannot be updated on existing records`,
        );
      }
      set[field] = prepared[field];
    }
  }
  /** @type {Record<string, unknown>} */
  const onInsert = {};
  for (const [field, value] of Object.entries(prepared)) {
    if (keyFields.includes(field) || field in set) continue;
    onInsert[field] = value;
  }
  if (Object.keys(onInsert).length === 0 && Object.keys(set).length === 0) {
    // Mongo rejects an empty update document; restating a filter equality is a no-op.
    const [first] = keyFields;
    onInsert[/** @type {string} */ (first)] = filter[/** @type {string} */ (first)];
  }
  /** @type {Record<string, unknown>} */
  const update = { $setOnInsert: onInsert };
  if (Object.keys(set).length > 0) update.$set = set;
  return { updateOne: { filter, update, upsert: true } };
}

/**
 * @param {import("mongoose").Model<any>} model @param {any} records
 * @param {{ keyFields: readonly string[], updateExisting: boolean }} config
 * @param {AbortSignal} signal
 */
async function* prepareStream(model, records, config, signal) {
  let index = 0;
  for await (const record of records) {
    if (signal.aborted) return;
    yield await prepareRecord(model, record, index, config);
    index += 1;
  }
}

/**
 * Throws on a repeated key; `offset` maps a position in `ops` back to the source record.
 * @param {readonly any[]} ops @param {readonly string[]} keyFields @param {number} offset
 */
function assertUniqueKeys(ops, keyFields, offset = 0) {
  /** @type {Map<string, number>} */
  const seen = new Map();
  ops.forEach((op, position) => {
    const id = keyIdentity(op.updateOne.filter, keyFields);
    const first = seen.get(id);
    if (first !== undefined) {
      throw new InvalidOptionError(
        `records[${offset + position}]: duplicate key within batch (first at records[${first}])`,
      );
    }
    seen.set(id, offset + position);
  });
}

/** @param {any} body @param {{ limits: Record<string, any> }} context */
function normalize(body, context) {
  if (!isPlain(body)) throw new InvalidOptionError("seed input must be a plain object");
  const batching = body.batching;
  if (batching !== undefined && typeof batching !== "boolean") {
    throw new InvalidOptionError("batching must be a boolean");
  }
  const keyFields = normalizeKeyFields(body.keyFields);
  const dryRun = normalizeFlag(body.dryRun, "dryRun") ?? false;
  const updateExisting = normalizeFlag(body.updateExisting, "updateExisting") ?? false;

  if (batching !== true) {
    const given = BATCH_ONLY.filter((key) => body[key] !== undefined);
    if (given.length > 0)
      throw new InvalidOptionError(`${given.join(", ")} require batching: true`);
    assertKnownKeys(body, NATIVE_KEYS, "seed");
    if (!Array.isArray(body.records) || body.records.length === 0) {
      throw new InvalidOptionError(
        "seed without batching requires a non-empty records array; use batching: true for iterables",
      );
    }
    return compact({
      batching: false,
      records: body.records,
      keyFields,
      dryRun,
      updateExisting,
      options: normalizeOptions(body.options, "seed", {
        forbid: ["ordered", "throwOnValidationError"],
      }),
    });
  }

  assertKnownKeys(body, BATCHED_KEYS, "seed");
  const uniqueSource = normalizeFlag(body.uniqueSource, "uniqueSource") ?? false;
  const kind = sourceKind(body.records);
  if (!kind || typeof body.records === "string") {
    throw new InvalidOptionError("records must be an array, Iterable, or AsyncIterable");
  }
  const sequentialByDefault = updateExisting && !uniqueSource;
  const { ordered: _ordered, ...controls } = normalizeBatchControls(body, context, {
    method: "seed",
    allowOrdered: false,
    defaultConcurrency: sequentialByDefault ? 1 : undefined,
  });
  if (updateExisting && !uniqueSource && controls.concurrency > 1) {
    throw new InvalidOptionError(
      "updateExisting with concurrency above 1 requires uniqueSource: true, a guarantee that no key repeats across the whole source",
    );
  }
  return compact({
    batching: true,
    records: body.records,
    keyFields,
    dryRun,
    updateExisting,
    uniqueSource,
    ...controls,
  });
}

/**
 * @param {import("mongoose").Model<any>} model @param {any} input @param {{ signal: AbortSignal }} context
 */
async function planBatched(model, input, context) {
  const startedAt = Date.now();
  const stats = { consumed: 0, planned: 0, batches: 0 };
  const stream = prepareStream(model, input.records, input, context.signal);
  const batches = createBatches(stream, {
    batchSize: input.batchSize,
    maxBatchBytes: input.maxBatchBytes,
    allowAll: false,
  });
  try {
    for await (const batch of batches) {
      if (context.signal.aborted) break;
      assertUniqueKeys(batch.ops, input.keyFields, batch.startIndex);
      stats.consumed += batch.ops.length;
      stats.planned += batch.ops.length;
      stats.batches += 1;
      if (typeof input.onBatch === "function") {
        try {
          await input.onBatch({
            batchIndex: batch.index,
            startIndex: batch.startIndex,
            size: batch.ops.length,
            bytes: batch.bytes,
            operations: batch.ops,
          });
        } catch (cause) {
          throw new BulkError("onBatch sink failed", { cause });
        }
      }
    }
  } finally {
    await batches.return(undefined).catch(() => undefined);
  }
  if (context.signal.aborted) {
    throw new OperationAbortedError("Seed dry-run cancelled; nothing was written", {
      databaseOutcome: "notDispatched",
    });
  }
  return Object.freeze({
    status: "dry-run",
    mode: "dry-run",
    batching: true,
    ...stats,
    elapsedMs: Date.now() - startedAt,
  });
}

/**
 * @param {import("mongoose").Model<any>} model @param {any} input
 * @param {import("../operations/spec.js").OperationEnv} env
 * @param {{ signal: AbortSignal, operationId?: string }} context
 */
async function run(model, input, env, context) {
  await assertSeedIndex(model, input.keyFields);
  if (input.batching === true) {
    if (input.dryRun) return planBatched(model, input, context);
    return runBatched(
      model,
      {
        ...input,
        operations: prepareStream(model, input.records, input, context.signal),
        ordered: false,
        allowAll: false,
      },
      env,
      context,
      {
        inspectBatch: (batch) => assertUniqueKeys(batch.ops, input.keyFields, batch.startIndex),
      },
    );
  }

  const startedAt = Date.now();
  /** @type {any[]} */
  const operations = [];
  for await (const operation of prepareStream(model, input.records, input, context.signal)) {
    operations.push(operation);
  }
  if (context.signal.aborted) {
    throw new OperationAbortedError("Seed cancelled before dispatch; nothing was written", {
      databaseOutcome: "notDispatched",
    });
  }
  assertUniqueKeys(operations, input.keyFields);
  assertOperations(operations, { allowAll: false, maxBatchBytes: env.limits.maxBatchBytes });
  if (input.dryRun) {
    return Object.freeze({
      status: "dry-run",
      mode: "dry-run",
      batching: false,
      consumed: operations.length,
      planned: operations.length,
      batches: 1,
      elapsedMs: Date.now() - startedAt,
    });
  }
  return model.bulkWrite(operations, { ...input.options, ordered: false });
}

/** @type {OperationSpec} */
export const seedSpec = {
  method: "seed",
  write: true,
  retryable: false,
  normalize,
  run,
  restore: /** @type {NonNullable<OperationSpec["restore"]>} */ (bulkWriteSpec.restore),
  classify: /** @type {NonNullable<OperationSpec["classify"]>} */ (bulkWriteSpec.classify),
};
