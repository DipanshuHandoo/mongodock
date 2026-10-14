# Seeding

`seed` upserts records by an explicit unique key through the same bulk engine as
`bulkWrite`. Repeating a seed is safe: existing records are left untouched unless
you opt in with `updateExisting`.

```js
await db.seed({
  model: "Product",
  keyFields: ["sku", "region"],
  records: [{ sku: "a1", region: "eu", name: "Anvil" }],
});
```

Seeding never runs on import or connect, never clears collections, never creates
indexes, and keeps no ledger. Call it explicitly, once per model, in the order your
data requires.

## Contract

| Input | Meaning |
| --- | --- |
| `keyFields` | 1-8 top-level schema paths (no `.` or `$`). Values must be provided explicitly and cast to a non-empty scalar: string, finite number, boolean, valid Date, or a BSON ObjectId/Decimal128/Long/Int32/Double/Binary. |
| `records` | Plain documents. Operator-shaped fields (`$set`, `a.b`) are rejected. |
| `updateExisting` | `$set` the provided non-key fields on existing records. Default `false` (`$setOnInsert` only). |
| `dryRun` | Prepare, validate, check indexes and plan; never write. |
| `batching: true` | Stream any Iterable/AsyncIterable through bounded, slot-pooled batches. Takes `batchSize`, `concurrency`, `maxBatchBytes`, `failureMode`, `onBatch`, `uniqueSource` and `options` exactly as in [bulk processing](bulk-processing.md). `ordered` is not accepted. |
| `options` | Native bulk options (for example `session`, `comment`). `ordered` and `throwOnValidationError` are owned by the wrapper. |

Without `batching` the input must be a non-empty array and one unordered
`bulkWrite` is issued; the result is the native `BulkWriteResult`. With `batching`
the result is a `BulkReport`.

## Unique index requirement

Before preparing or writing anything (including dry-runs), the real collection
indexes are inspected. A unique index on exactly `keyFields` must exist, without
`sparse`, `partialFilterExpression` or `collation`. A schema `unique` declaration
does not count; create the index first (for example `Model.createIndexes()`).
Otherwise a `BulkError` with `databaseOutcome: "notDispatched"` is thrown. A key of
just `["_id"]` is always accepted.

## Validation

Every record is hydrated and validated through the model's schema, so casts,
defaults, `required`, custom validators and strictness apply. Failures throw
`InvalidOptionError` naming `records[i]` and the failing paths, never values.

- Validation is whole-document. With `updateExisting`, a partial record still has
  to satisfy `required` paths; provide complete records.
- With `updateExisting`, a record providing an `immutable` non-key path is
  rejected instead of silently ignored.
- This is not save middleware. Validation and `bulkWrite` run, but `save` hooks do
  not. Mongoose applies schema timestamps for `bulkWrite` upserts.

## Duplicates and parallelism

Repeated keys within one batch (or one native array) are rejected before dispatch,
naming both indexes. Memory stays bounded: no job-wide key set is kept, so a key
repeated across batches is resolved by the unique index (an idempotent upsert).

`updateExisting` with `concurrency > 1` requires `uniqueSource: true`, your
guarantee that no key repeats anywhere in the source. Without that guarantee it
defaults to concurrency 1, and an explicit higher value is rejected. Concurrent
upsert races on the same key surface as native duplicate-key errors in the report;
they are not retried or counted as inserts, and `upsertedCount`/`matchedCount` are
approximate under races.

## Dry-run

Dry-run returns `{ status: "dry-run", mode: "dry-run", batching, consumed, planned, batches, elapsedMs }`.
With `batching`, `onBatch` receives `{ batchIndex, startIndex, size, bytes, operations }`
for each planned batch (sequentially). It cannot predict server errors, races, or
whether records already exist, so it reports no inserted-versus-existing counts.

## Sessions

`options.session` is honoured: batches run sequentially with `failureMode: "stop"`.
Inside `withTransaction`, use `tx.ops.seed(...)`; the transaction needs a replica
set and an existing collection, as for any write.
