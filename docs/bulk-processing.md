# Bulk processing

`bulkWrite` has two modes selected by `batching`.

## Native mode (default)

Exactly Mongoose's `Model.bulkWrite`: one call, one driver round trip, the native
`BulkWriteResult` resolved or the native error rejected. `operations` must be a
non-empty array. Each operation shape is validated and the usual safety guards apply
(empty-filter `updateMany`, `deleteOne`/`deleteMany` and `replaceOne` need `allowAll: true`).
Batch-only keys are rejected. `ordered` belongs in `options`.

```js
await db.bulkWrite({ model: "Item", operations, options: { ordered: false } });
```

## Batched mode (`batching: true`)

Accepts an array, any `Iterable` or an `AsyncIterable` (a database cursor, a file stream
transformed into operations). Operations are grouped by count (`batchSize`, default
`limits.batchSize`, max 10,000) and by estimated BSON size (`maxBatchBytes`), and written
through [`@dipanshuhandoo/async-slot-pool`](https://www.npmjs.com/package/@dipanshuhandoo/async-slot-pool)
with at most `concurrency` writes in flight (default `limits.concurrency`, max 32).

```js
const report = await db.bulkWrite({
  model: "Item",
  batching: true,
  operations: lazySource(),
  batchSize: 500,
  concurrency: 4,
  onBatch: (outcome) => log(outcome.batchIndex, outcome.status),
});
```

Defaults: `ordered: false`, `failureMode: "continue"`. `ordered: true` requires
`concurrency: 1` and `failureMode: "stop"` (these are its defaults). A transaction
`session` in `options` also forces `concurrency: 1` and `failureMode: "stop"`:
parallel batches on one transaction session are unsafe. `options.ordered` and
`options.throwOnValidationError` are rejected in batched mode; use the top-level keys.

### Validation

Arrays are validated entirely (shape, guards, per-operation size) before anything is
written. Lazy sources are validated as they are pulled; a violation (or a source that
throws) is fatal, but batches already pulled are still written first.

### Report

The call resolves with a bounded `BulkReport`:

| Field | Meaning |
| --- | --- |
| `status` | `completed` (clean and source exhausted), `partial`, `failed` (nothing succeeded, nothing uncertain), `cancelled` |
| `consumed` / `attempted` | operations pulled from the source / sent to the server |
| `knownSucceeded`, `failed`, `uncertain` | per-operation accounting; `uncertain` covers network/timeout/write-concern failures where the outcome is unknown |
| `unattempted` | operations not sent; `null` when the source was not exhausted and its size is unknown |
| `insertedCount` … `upsertedCount` | summed driver counts |
| `batches` | per-status batch counts |
| `diagnostics` | `{ samples, omitted }`: `{ batchIndex, index, kind, code }` only, capped by `limits.diagnosticSamples` and `limits.maxDiagnosticBytes`. No messages, keys, or documents |

A non-`completed` report still resolves, fires `onError` (not `onSuccess`) and `onComplete`,
and `restore` guarantees hooks cannot rewrite built-in report fields, only add new ones.
Per-input `index` values are positions in the source (validation failures are mapped back
from Mongoose's filtered result positions).

### `onBatch`

Awaited per batch with a `BulkBatchOutcome` (including the native error under `error`, for
your own sink). It may run concurrently and out of order. If it throws, dispatch stops and
the call rejects with `BulkError` carrying the partial `report`.

### Failure and cancellation

- `failureMode: "continue"`: other batches keep going. `"stop"`: after any non-succeeded batch no new
  batch is dispatched; in-flight writes finish.
- Source failure, sink failure, or a safety violation rejects with `BulkError` (`report` attached).
- `signal` abort stops pulling and dispatching, waits for in-flight writes, closes the source and
  rejects with `OperationAbortedError` with `report.status === "cancelled"`. Already-written data is
  **not** rolled back. The driver call itself is not interrupted.
- Bulk writes are never automatically retried (not idempotent).

### Memory

The memory held is roughly `concurrency × maxBatchBytes` of estimated BSON plus one pending
operation, plus Mongoose and driver copies. Per-batch outcomes are folded into constant-size
counters and discarded.

### Scheduling note

async-slot-pool accepts arrays, so batches are pulled in windows of `concurrency` and each
window completes before the next starts. With uniformly fast batches this is free; with skewed
latency (10% of batches 20x slower, 4 slots) a window of `4 × concurrency` finished ~25-30% sooner
in a local benchmark (about 3.4s vs 4.4-4.9s for 400 batches), at the cost of holding four times
as many batches. The strict window is the default to keep the documented memory bound.
