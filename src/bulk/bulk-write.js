import { BulkError, InvalidOptionError, OperationAbortedError } from "../errors.js";
import { isPlain } from "../operations/guards.js";
import {
  assertKnownKeys,
  compact,
  normalizeFlag,
  normalizeOptions,
} from "../operations/query-options.js";
import { assertOperations, createBatches, sourceKind } from "./batches.js";
import { createLedger, skippedBatch, summarizeBatch } from "./outcomes.js";
import { runWindows } from "./slot-runner.js";

/** @typedef {import("../operations/spec.js").OperationSpec} OperationSpec */

const NATIVE_KEYS = ["operations", "batching", "options", "allowAll"];
const BATCHED_KEYS = [
  ...NATIVE_KEYS,
  "batchSize",
  "concurrency",
  "maxBatchBytes",
  "ordered",
  "failureMode",
  "onBatch",
];
const BATCH_ONLY = [
  "batchSize",
  "concurrency",
  "maxBatchBytes",
  "ordered",
  "failureMode",
  "onBatch",
];
const MAX_BATCH_SIZE = 10_000;
const MAX_CONCURRENCY = 32;
/** Fields hooks may add to, but never rewrite on, a batched report. */
const isReport = (/** @type {any} */ value) =>
  isPlain(value) && typeof value.status === "string" && value.mode === "batched";

/**
 * @param {unknown} value @param {string} label @param {number} min @param {number} max
 */
function integer(value, label, min, max) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new InvalidOptionError(`${label} must be a safe integer between ${min} and ${max}`);
  }
  return value;
}

/** @param {any} body @param {{ limits: Record<string, any> }} context */
function normalize(body, context) {
  if (!isPlain(body)) throw new InvalidOptionError("bulkWrite input must be a plain object");
  const batching = body.batching;
  if (batching !== undefined && typeof batching !== "boolean") {
    throw new InvalidOptionError("batching must be a boolean");
  }
  const allowAll = normalizeFlag(body.allowAll, "allowAll");

  if (batching !== true) {
    assertKnownKeys(body, NATIVE_KEYS, "bulkWrite");
    const given = BATCH_ONLY.filter((key) => body[key] !== undefined);
    if (given.length > 0) {
      throw new InvalidOptionError(`${given.join(", ")} require batching: true`);
    }
    const operations = body.operations;
    if (!Array.isArray(operations) || operations.length === 0) {
      throw new InvalidOptionError(
        "bulkWrite without batching requires a non-empty operations array; use batching: true for iterables",
      );
    }
    assertOperations(operations, { allowAll, maxBatchBytes: undefined });
    return compact({
      batching: false,
      operations,
      options: normalizeOptions(body.options, "bulkWrite"),
      allowAll,
    });
  }

  assertKnownKeys(body, BATCHED_KEYS, "bulkWrite");
  const controls = normalizeBatchControls(body, context);
  const operations = body.operations;
  const kind = sourceKind(operations);
  if (!kind || typeof operations === "string") {
    throw new InvalidOptionError("operations must be an array, Iterable, or AsyncIterable");
  }
  if (kind === "array") {
    assertOperations(/** @type {any[]} */ (operations), {
      allowAll,
      maxBatchBytes: controls.maxBatchBytes,
    });
  }
  return compact({ batching: true, operations, allowAll, ...controls });
}

/**
 * Validates the batching controls shared by bulkWrite and seed.
 * @param {any} body
 * @param {{ limits: Record<string, any> }} context
 * @param {{ method?: string, allowOrdered?: boolean, defaultConcurrency?: number | undefined }} [rules]
 */
export function normalizeBatchControls(
  body,
  context,
  { method = "bulkWrite", allowOrdered = true, defaultConcurrency } = {},
) {
  const options = normalizeOptions(body.options, method, {
    forbid: ["ordered", "throwOnValidationError"],
  });
  const transactional = options.session !== undefined;
  const ordered = allowOrdered ? (body.ordered ?? false) : false;
  if (typeof ordered !== "boolean") throw new InvalidOptionError("ordered must be a boolean");
  const failureMode = body.failureMode ?? (ordered || transactional ? "stop" : "continue");
  if (failureMode !== "continue" && failureMode !== "stop") {
    throw new InvalidOptionError('failureMode must be "continue" or "stop"');
  }
  const sequential = ordered || transactional;
  const concurrency = integer(
    body.concurrency ?? (sequential ? 1 : (defaultConcurrency ?? context.limits.concurrency)),
    "concurrency",
    1,
    MAX_CONCURRENCY,
  );
  if (sequential && (concurrency !== 1 || failureMode !== "stop")) {
    throw new InvalidOptionError(
      ordered
        ? "ordered batches require concurrency 1 and failureMode stop"
        : "batched writes in a session require concurrency 1 and failureMode stop",
    );
  }
  const batchSize = integer(
    body.batchSize ?? context.limits.batchSize,
    "batchSize",
    1,
    MAX_BATCH_SIZE,
  );
  const maxBatchBytes = integer(
    body.maxBatchBytes ?? context.limits.maxBatchBytes,
    "maxBatchBytes",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  if (body.onBatch !== undefined && typeof body.onBatch !== "function") {
    throw new InvalidOptionError("onBatch must be a function");
  }
  return {
    options,
    ordered,
    failureMode,
    concurrency,
    batchSize,
    maxBatchBytes,
    onBatch: body.onBatch,
  };
}

/**
 * Batched execution. Batches are pulled into windows of `concurrency`, dispatched through
 * async-slot-pool, folded into constant-size totals, and reported to `onBatch` once each.
 * @param {import("mongoose").Model<any>} model
 * @param {any} input
 * @param {import("../operations/spec.js").OperationEnv} env
 * @param {{ signal: AbortSignal, operationId?: string }} context
 * @param {{ windowFactor?: number, inspectBatch?: (batch: import("./batches.js").Batch) => void }} [tuning]
 */
export async function runBatched(model, input, env, context, tuning = {}) {
  const { signal } = context;
  const operations = input.operations;
  const sourceTotal = Array.isArray(operations) ? operations.length : null;
  const ledger = createLedger({
    sampleLimit: env.limits.diagnosticSamples,
    byteLimit: env.limits.maxDiagnosticBytes,
    sourceTotal,
    ordered: input.ordered,
  });
  const batches = createBatches(operations, {
    batchSize: input.batchSize,
    maxBatchBytes: input.maxBatchBytes,
    allowAll: input.allowAll,
  });
  /** @type {{ error: unknown } | undefined} */
  let fatal;
  let stopped = false;
  // A source failure still lets batches already pulled (valid, fully flushed) finish writing.
  let sinkFailed = false;
  const shouldStop = () => stopped || fatal !== undefined || signal.aborted;

  /** @param {import("../bulk/outcomes.js").BatchOutcome} outcome */
  async function record(outcome) {
    ledger.fold(outcome);
    if (input.failureMode === "stop" && outcome.status !== "succeeded") stopped = true;
    if (typeof input.onBatch !== "function") return;
    try {
      await input.onBatch(outcome);
    } catch (error) {
      sinkFailed = true;
      fatal ??= { error: new BulkError("onBatch sink failed", { cause: error }) };
    }
  }

  /** @param {import("./batches.js").Batch} batch */
  async function handle(batch) {
    if (stopped || signal.aborted || sinkFailed) return record(skippedBatch(batch));
    const startedAt = Date.now();
    /** @type {Parameters<typeof summarizeBatch>[1]} */
    let settled;
    try {
      settled = {
        ok: true,
        result: await model.bulkWrite(/** @type {any} */ (batch.ops), {
          ...input.options,
          ordered: input.ordered,
        }),
      };
    } catch (error) {
      settled = { ok: false, error };
    }
    return record(
      summarizeBatch(batch, settled, {
        ordered: input.ordered,
        elapsedMs: Date.now() - startedAt,
      }),
    );
  }

  const pull = /** @type {() => Promise<import("./batches.js").Batch | null>} */ (
    async () => {
      try {
        const step = await batches.next();
        if (step.done) return null;
        try {
          tuning.inspectBatch?.(step.value);
        } catch (error) {
          // Rejected before dispatch, but consumed: account for it as unattempted.
          ledger.fold(skippedBatch(step.value));
          fatal ??= { error };
          return null;
        }
        return step.value;
      } catch (error) {
        fatal ??= { error };
        return null;
      }
    }
  );

  let exhausted = false;
  try {
    ({ exhausted } = await runWindows({
      pull,
      handle,
      shouldStop,
      concurrency: input.concurrency,
      windowFactor: tuning.windowFactor ?? 1,
    }));
  } catch (error) {
    fatal ??= { error };
  } finally {
    await batches.return(undefined).catch(() => undefined);
  }

  const cancelled = signal.aborted && fatal === undefined;
  const report = ledger.report({ cancelled, exhausted: exhausted && fatal === undefined });
  const dispatched = ledger.attempted > 0;
  const identity = {
    connection: env.connection,
    ...(context.operationId === undefined ? {} : { operationId: context.operationId }),
  };
  if (fatal) {
    const error = fatal.error;
    /** @type {import("../errors.js").ErrorContext} */
    const outcomes = {
      databaseOutcome: dispatched ? "partial" : "notDispatched",
      invocationOutcome: dispatched ? "partial" : "failed",
      ...identity,
    };
    const wrapped =
      error instanceof BulkError
        ? error
        : new BulkError(
            error instanceof InvalidOptionError
              ? error.message
              : "Bulk source failed; dispatch stopped",
            { cause: error, report, ...outcomes },
          );
    Object.assign(wrapped, { report, ...outcomes });
    throw wrapped;
  }
  if (cancelled) {
    const aborted = new OperationAbortedError("Bulk write cancelled; in-flight batches settled", {
      databaseOutcome: dispatched ? "partial" : "notDispatched",
      ...identity,
    });
    Object.defineProperty(aborted, "report", { value: report, enumerable: true });
    throw aborted;
  }
  return report;
}

/** @type {OperationSpec} */
export const bulkWriteSpec = {
  method: "bulkWrite",
  write: true,
  retryable: false,
  normalize,
  run: (model, input, env, context) =>
    input.batching === true
      ? runBatched(model, input, env, context)
      : model.bulkWrite(input.operations, input.options ?? {}),
  restore: (original, replaced) =>
    isReport(original) ? { ...(isPlain(replaced) ? replaced : {}), ...original } : replaced,
  classify: (result) => {
    if (!isReport(result) || result.status === "completed") return undefined;
    return {
      invocationOutcome: result.status === "failed" ? "failed" : "partial",
      databaseOutcome:
        result.uncertain > 0 ? "uncertain" : result.status === "failed" ? "failed" : "partial",
    };
  },
};
