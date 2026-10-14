import { InvalidOptionError, OperationAbortedError } from "../errors.js";
import { scanPipeline } from "../operations/guards.js";
import {
  applyQuery,
  assertKnownKeys,
  compact,
  normalizeFilter,
  normalizeFlag,
  normalizeLean,
  normalizeOptions,
  normalizePopulate,
  normalizeProjection,
  normalizeSort,
} from "../operations/query-options.js";
import { readOptions } from "../operations/reads.js";
import { normalizeKeyset, runKeyset } from "../pagination/cursor.js";

/** @typedef {import("../operations/spec.js").OperationSpec} OperationSpec */

const DEFAULT_BATCH_SIZE = 500;
const MAX_BATCH_SIZE = 10_000;

/** @param {unknown} value */
function normalizeBatchSize(value) {
  const size = value ?? DEFAULT_BATCH_SIZE;
  if (!Number.isSafeInteger(size) || /** @type {number} */ (size) < 1) {
    throw new InvalidOptionError("batchSize must be a positive integer");
  }
  if (/** @type {number} */ (size) > MAX_BATCH_SIZE) {
    throw new InvalidOptionError(`batchSize exceeds the maximum of ${MAX_BATCH_SIZE}`);
  }
  return /** @type {number} */ (size);
}

/** @param {any} context @param {string} message */
const aborted = (context, message) =>
  new OperationAbortedError(message, {
    operationId: context.operationId,
    connection: context.connection,
    databaseOutcome: "uncertain",
  });

/**
 * Pulls one document at a time so the driver's batch is the only buffer. The cursor is always
 * closed, including on early exit and abort.
 * @param {{ next(): Promise<unknown>, close(): Promise<unknown> }} cursor @param {any} context
 */
async function* pull(cursor, context) {
  try {
    for (;;) {
      if (context.signal.aborted) throw aborted(context, "Operation aborted while streaming");
      const doc = await cursor.next();
      if (doc === null || doc === undefined) return;
      yield doc;
    }
  } finally {
    await cursor.close();
  }
}

/** @param {any} input */
const openFind = (/** @type {import("mongoose").Model<any>} */ model, input) =>
  applyQuery(model.find(input.filter), {
    options: input.options,
    projection: input.projection,
    sort: input.sort,
    populate: input.populate,
    lean: input.lean,
  }).cursor({ batchSize: input.batchSize });

/**
 * @param {import("mongoose").Model<any>} model @param {any} input @param {any} context
 */
async function* batchesByCursor(model, input, context) {
  /** @type {unknown[]} */
  let buffer = [];
  let batchIndex = 0;
  let processed = 0;
  const envelope = () => {
    const docs = buffer;
    buffer = [];
    processed += docs.length;
    return { docs, batchIndex: batchIndex++, processed, nextCursor: null };
  };
  for await (const doc of pull(openFind(model, input), context)) {
    buffer.push(doc);
    if (buffer.length >= input.batchSize) yield envelope();
  }
  if (buffer.length > 0) yield envelope();
}

/**
 * @param {import("mongoose").Model<any>} model @param {any} input @param {any} env @param {any} context
 */
async function* batchesByKeyset(model, input, env, context) {
  /** @type {string | undefined} */
  let cursor;
  let batchIndex = 0;
  let processed = 0;
  for (;;) {
    if (context.signal.aborted) throw aborted(context, "Operation aborted while streaming");
    const page = await runKeyset(model, env, input, { limit: input.batchSize, cursor });
    if (page.docs.length === 0) return;
    processed += page.docs.length;
    yield {
      docs: page.docs,
      batchIndex: batchIndex++,
      processed,
      nextCursor: page.nextCursor,
    };
    if (!page.hasNextPage) return;
    cursor = /** @type {string} */ (page.nextCursor);
  }
}

/** @type {readonly OperationSpec[]} */
export const streamSpecs = Object.freeze([
  {
    method: "iterate",
    write: false,
    retryable: false,
    stream: true,
    normalize: (body) => {
      assertKnownKeys(
        body,
        ["filter", "projection", "sort", "populate", "lean", "batchSize", "options"],
        "iterate",
      );
      return compact({
        filter: normalizeFilter(body.filter ?? {}),
        projection: normalizeProjection(body.projection),
        sort: normalizeSort(body.sort),
        populate: normalizePopulate(body.populate),
        lean: normalizeLean(body.lean),
        batchSize: normalizeBatchSize(body.batchSize),
        options: readOptions(body.options, "iterate"),
      });
    },
    open: async (model, input, _env, context) => pull(openFind(model, input), context),
  },
  {
    method: "aggregateCursor",
    write: false,
    retryable: false,
    stream: true,
    normalize: (body) => {
      assertKnownKeys(
        body,
        ["pipeline", "allowWriteStages", "batchSize", "options"],
        "aggregateCursor",
      );
      const allowWriteStages = normalizeFlag(body.allowWriteStages, "allowWriteStages");
      scanPipeline(body.pipeline, allowWriteStages);
      const options = normalizeOptions(body.options, "aggregateCursor", {
        forbid: ["cursor", "pipeline", "explain"],
      });
      return compact({
        pipeline: body.pipeline,
        options,
        allowWriteStages,
        batchSize: normalizeBatchSize(body.batchSize),
      });
    },
    open: async (model, input, _env, context) =>
      pull(
        model.aggregate(input.pipeline, input.options).cursor({ batchSize: input.batchSize }),
        context,
      ),
  },
  {
    method: "iterateBatches",
    write: false,
    retryable: false,
    stream: true,
    normalize: (body, { limits }) => {
      assertKnownKeys(
        body,
        [
          "filter",
          "projection",
          "sort",
          "populate",
          "lean",
          "batchSize",
          "strategy",
          "includeTotal",
          "options",
        ],
        "iterateBatches",
      );
      const strategy = body.strategy ?? "cursor";
      if (strategy !== "cursor" && strategy !== "keyset") {
        throw new InvalidOptionError('strategy must be "cursor" or "keyset"');
      }
      const batchSize = normalizeBatchSize(body.batchSize);
      const shared = {
        strategy,
        batchSize,
        includeTotal: normalizeFlag(body.includeTotal, "includeTotal"),
      };
      if (strategy === "keyset") {
        const { limit: _limit, ...rest } = normalizeKeyset(
          { ...body, limit: undefined },
          "iterateBatches",
          limits,
        );
        return { ...rest, ...shared };
      }
      return compact({
        filter: normalizeFilter(body.filter ?? {}),
        projection: normalizeProjection(body.projection),
        sort: normalizeSort(body.sort),
        populate: normalizePopulate(body.populate),
        lean: normalizeLean(body.lean),
        options: readOptions(body.options, "iterateBatches"),
        ...shared,
      });
    },
    open: async (model, input, env, context) =>
      (async function* batches() {
        // Counted before any read; the total is advisory because the collection may change.
        const totalDocs = input.includeTotal
          ? await applyQuery(model.countDocuments(input.filter), { options: input.options }).exec()
          : null;
        const source =
          input.strategy === "keyset"
            ? batchesByKeyset(model, input, env, context)
            : batchesByCursor(model, input, context);
        for await (const batch of source) yield { ...batch, totalDocs };
      })(),
  },
]);
