const VALIDATION_NAMES = new Set(["ValidationError", "CastError", "StrictModeError"]);
const TRANSPORT = /Network|Timeout|ServerSelection|Pool/;
const MAX_BATCH_ERRORS = 1_000;

/** @typedef {import("./batches.js").Batch} Batch */
/**
 * @typedef {object} BatchError
 * @property {number | null} index Input index; null when the failure is batch-wide.
 * @property {"validation" | "write" | "writeConcern" | "transport" | "unknown"} kind
 * @property {number | string | undefined} [code]
 */
/**
 * @typedef {object} BatchOutcome
 * @property {number} batchIndex
 * @property {number} startIndex
 * @property {number} size
 * @property {number} bytes
 * @property {"succeeded" | "partial" | "failed" | "uncertain" | "unattempted"} status
 * @property {number} attempted
 * @property {number} succeeded
 * @property {number} failed
 * @property {number} uncertain
 * @property {number} unattempted
 * @property {Counts} counts
 * @property {BatchError[]} errors Safe metadata only, capped per batch.
 * @property {number} errorsOmitted
 * @property {unknown} [error] Native error for the caller's sink; never copied into the report.
 * @property {number} elapsedMs
 */
/**
 * @typedef {object} Counts
 * @property {number} insertedCount
 * @property {number} matchedCount
 * @property {number} modifiedCount
 * @property {number} deletedCount
 * @property {number} upsertedCount
 */

/** @returns {Counts} */
export const emptyCounts = () => ({
  insertedCount: 0,
  matchedCount: 0,
  modifiedCount: 0,
  deletedCount: 0,
  upsertedCount: 0,
});

/** @param {unknown} value */
const count = (value) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/** @param {any} source @returns {Counts} */
function nativeCounts(source) {
  const pick = (/** @type {string} */ key) => count(source?.[key]) || count(source?.result?.[key]);
  return {
    insertedCount: pick("insertedCount"),
    matchedCount: pick("matchedCount"),
    modifiedCount: pick("modifiedCount"),
    deletedCount: pick("deletedCount"),
    upsertedCount: pick("upsertedCount"),
  };
}

/** @param {unknown} code */
const safeCode = (code) =>
  typeof code === "number" || typeof code === "string" ? code : undefined;

/** @param {any} error */
const isValidation = (error) => VALIDATION_NAMES.has(error?.name);

/**
 * Mongoose reports per-operation validation and server write failures in input order through
 * `mongoose.results`; native indexes inside the error refer to the filtered operation list, so
 * the results array is the only index-faithful source.
 * @param {any} carrier
 */
function perOperation(carrier) {
  const results = carrier?.mongoose?.results;
  return Array.isArray(results) ? results : undefined;
}

/**
 * @param {Batch} batch
 * @param {{ ok: true, result: unknown } | { ok: false, error: unknown }} settled
 * @param {{ ordered: boolean, elapsedMs: number }} context
 * @returns {BatchOutcome}
 */
export function summarizeBatch(batch, settled, { ordered, elapsedMs }) {
  const n = batch.ops.length;
  /** @type {any} */
  const failure = settled.ok ? undefined : settled.error;
  /** @type {any} */
  const carrier = settled.ok ? settled.result : failure;
  const results = perOperation(carrier);
  /** @type {number[]} */
  const validation = [];
  /** @type {Array<{ index: number, code: number | string | undefined }>} */
  const writes = [];
  results?.forEach((entry, position) => {
    if (entry === null || entry === undefined) return;
    if (isValidation(entry)) validation.push(position);
    else writes.push({ index: position, code: safeCode(entry.code) });
  });
  if (!results && failure) {
    for (const entry of [].concat(failure.writeErrors ?? [])) {
      const item = /** @type {any} */ (entry);
      if (Number.isInteger(item?.index)) {
        writes.push({ index: item.index, code: safeCode(item.code) });
      }
    }
  }
  const concernFailed = !!(
    failure?.writeConcernError ??
    failure?.result?.getWriteConcernError?.() ??
    failure?.result?.writeConcernError
  );
  const bulkFailure =
    failure &&
    (failure.name === "MongoBulkWriteError" ||
      writes.length > 0 ||
      [].concat(failure.writeErrors ?? []).length > 0 ||
      concernFailed);
  const preDispatch = failure && !bulkFailure && isValidation(failure);

  /** @type {BatchError[]} */
  const errors = [];
  for (const position of validation) {
    errors.push({ index: batch.startIndex + position, kind: "validation" });
  }
  for (const write of writes) {
    errors.push({ index: batch.startIndex + write.index, kind: "write", code: write.code });
  }

  let attempted = n - validation.length;
  let succeeded = attempted;
  let failed = validation.length;
  let uncertain = 0;
  let unattempted = 0;

  if (preDispatch) {
    attempted = 0;
    succeeded = 0;
    failed = 0;
    unattempted = n;
    errors.push({ index: null, kind: "validation" });
  } else if (failure && bulkFailure) {
    if (ordered && writes.length > 0) {
      const first = Math.min(...writes.map((write) => write.index));
      attempted = first + 1;
      succeeded = first;
      failed += 1;
      unattempted = n - first - 1;
    } else {
      failed += writes.length;
      succeeded = attempted - writes.length;
    }
    if (concernFailed) {
      errors.push({ index: null, kind: "writeConcern", code: safeCode(failure.code) });
      uncertain = succeeded;
      succeeded = 0;
    }
  } else if (failure) {
    uncertain = attempted;
    succeeded = 0;
    errors.push({
      index: null,
      kind: TRANSPORT.test(String(failure?.name)) ? "transport" : "unknown",
      code: safeCode(failure?.code),
    });
  }

  const omitted = Math.max(0, errors.length - MAX_BATCH_ERRORS);
  const kept = omitted > 0 ? errors.slice(0, MAX_BATCH_ERRORS) : errors;
  /** @type {BatchOutcome["status"]} */
  let status = "succeeded";
  if (attempted === 0 && unattempted === n) status = "unattempted";
  else if (uncertain > 0) status = "uncertain";
  else if (failed > 0 || unattempted > 0) status = succeeded === 0 ? "failed" : "partial";

  /** @type {BatchOutcome} */
  const outcome = {
    batchIndex: batch.index,
    startIndex: batch.startIndex,
    size: n,
    bytes: batch.bytes,
    status,
    attempted,
    succeeded,
    failed,
    uncertain,
    unattempted,
    counts: failure ? nativeCounts(failure) : nativeCounts(carrier),
    errors: kept,
    errorsOmitted: omitted,
    elapsedMs,
  };
  if (failure) outcome.error = failure;
  return outcome;
}

/**
 * Outcome for a batch that was consumed but never sent (stop, cancel, or fatal failure).
 * @param {Batch} batch
 * @returns {BatchOutcome}
 */
export const skippedBatch = (batch) => ({
  batchIndex: batch.index,
  startIndex: batch.startIndex,
  size: batch.ops.length,
  bytes: batch.bytes,
  status: "unattempted",
  attempted: 0,
  succeeded: 0,
  failed: 0,
  uncertain: 0,
  unattempted: batch.ops.length,
  counts: emptyCounts(),
  errors: [],
  errorsOmitted: 0,
  elapsedMs: 0,
});

/**
 * Running totals only: no operation, document, batch outcome or upsert id is retained.
 * @param {{ sampleLimit: number, byteLimit: number, sourceTotal: number | null, ordered: boolean }} options
 */
export function createLedger({ sampleLimit, byteLimit, sourceTotal, ordered }) {
  const startedAt = Date.now();
  let consumed = 0;
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  let uncertain = 0;
  let unattempted = 0;
  let sampleBytes = 0;
  let omitted = 0;
  const counts = emptyCounts();
  const batches = { total: 0, succeeded: 0, partial: 0, failed: 0, uncertain: 0, unattempted: 0 };
  /** @type {Array<BatchError & { batchIndex: number }>} */
  const samples = [];

  return {
    /** @param {BatchOutcome} outcome */
    fold(outcome) {
      consumed += outcome.size;
      attempted += outcome.attempted;
      succeeded += outcome.succeeded;
      failed += outcome.failed;
      uncertain += outcome.uncertain;
      unattempted += outcome.unattempted;
      for (const key of /** @type {Array<keyof Counts>} */ (Object.keys(counts))) {
        counts[key] += outcome.counts[key];
      }
      batches.total += 1;
      batches[outcome.status] += 1;
      omitted += outcome.errorsOmitted;
      for (const error of outcome.errors) {
        const sample = { batchIndex: outcome.batchIndex, ...error };
        const size = JSON.stringify(sample).length;
        if (samples.length < sampleLimit && sampleBytes + size <= byteLimit) {
          samples.push(sample);
          sampleBytes += size;
        } else {
          omitted += 1;
        }
      }
    },
    get consumed() {
      return consumed;
    },
    get failedOrUncertain() {
      return failed + uncertain;
    },
    get attempted() {
      return attempted;
    },
    /**
     * @param {{ cancelled: boolean, exhausted: boolean }} state
     * @returns {import("../types.js").BulkReport}
     */
    report({ cancelled, exhausted }) {
      const remaining = exhausted ? 0 : sourceTotal === null ? null : sourceTotal - consumed;
      const open = remaining === null ? null : unattempted + remaining;
      /** @type {import("../types.js").BulkReport["status"]} */
      let status = "completed";
      if (cancelled) status = "cancelled";
      else if (failed > 0 || uncertain > 0 || open === null || open > 0) {
        status = succeeded === 0 && uncertain === 0 ? "failed" : "partial";
      }
      return Object.freeze({
        status,
        mode: "batched",
        ordered,
        consumed,
        attempted,
        knownSucceeded: succeeded,
        failed,
        uncertain,
        unattempted: open,
        ...counts,
        batches: Object.freeze({ ...batches }),
        diagnostics: Object.freeze({ samples: Object.freeze([...samples]), omitted }),
        elapsedMs: Date.now() - startedAt,
      });
    },
  };
}
