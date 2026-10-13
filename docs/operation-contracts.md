# Operation contracts for later phases

These are agreed implementation contracts, not Phase 1 executable APIs.
The factory and methods are added and exported only in their feature phase.

## Shared input

Every database call accepts an object with `model` (registered name or a Model
on the selected connection), optional `signal`, `correlationId`, `hooks`, and
`retry`. A `db.use(name)` view binds connection identity. Session lives in
method-specific native `options`; a transaction facade attaches it explicitly.
Hooks cannot change model/connection/method/session or elevate safety permissions.

No unbounded `findAll`; model-backed generics infer raw/hydrated types and explicit
lean requests return raw objects. String model lookup requires explicit type
information. Projection cannot promise fields not selected by the caller.
Options use supported Mongoose types, not a generic untyped bag.

| Methods | Specific input | Result |
| --- | --- | --- |
| find/findAll | filter={}, limit=100, skip, projection, sort, populate, lean, native QueryOptions | Bounded document/lean array |
| findOne | filter, projection, sort, populate, lean, QueryOptions | Document/lean object or null |
| findById | id, projection, populate, lean, QueryOptions | Document/lean object or null |
| exists | filter, query/session/time options | boolean |
| countDocuments | filter={}, native count/query options | number |
| create | data, SaveOptions | Saved hydrated document |
| insertMany | data array, InsertManyOptions | Native documents or native raw result when explicitly requested |
| updateOne/updateMany | filter, update, native update options, allowAll=false | Native write result |
| findOneAndUpdate | filter, update, projection/populate/lean, QueryOptions, allowAll=false | Post-update document by default or explicit native metadata |
| findByIdAndUpdate | id, update, projection/populate/lean, QueryOptions | Same return-option contract |
| deleteOne/deleteMany | filter, native delete/query options, allowAll=false | Native delete result |
| findOneAndDelete | filter, projection/populate/lean, QueryOptions, allowAll=false | Deleted document/lean object or null |
| findByIdAndDelete | id, projection/populate/lean, QueryOptions | Deleted document/lean object or null |
| aggregate | pipeline, AggregateOptions, allowWriteStages=false | Materialized native results |
| aggregateCursor | pipeline, AggregateOptions, batchSize, allowWriteStages=false | Lazy AsyncIterable |

Update validators default on; explicit native return options are honored and
contradictory aliases rejected. Native validation/cast/duplicate-key failures
remain inspectable. `save`/`insertMany`/updates/bulk have different middleware
semantics: no claim they execute identical schema hooks.

## Pages and iterators

`paginate` adds page=1, limit=20, includeTotal=true. Result: docs, totalDocs,
limit, page, totalPages, hasNextPage, hasPrevPage, nextPage, prevPage. Without
count, count-specific metadata is null; next-page detection reads limit+1.

`paginateCursor` adds cursor, limit, indexed sort. Result: docs, limit,
hasNextPage, nextCursor. Tokens bind supported BSON sort/query identity.
Continuation is captured before result replacement and cannot be changed by hooks.

`iterate` yields documents; `iterateBatches` yields bounded docs/batchIndex/
processed/totalDocs/nextCursor envelopes. Input adds batchSize=500, strategy
cursor/keyset, includeTotal=false. Counts are optional progress metadata, not
termination conditions. Native cursors have no resumable continuation token.
Returning an unconsumed iterator does not admit work; lifecycle starts on pull.

## Bulk and seed overloads

`bulkWrite({ model, operations, batching: false, options })` accepts a native
operations array, returns native BulkWriteResult, and rejects native failures.
Batch-only controls are rejected. Native options retain Mongoose behavior.

`bulkWrite({ model, operations, batching: true, ...controls })` accepts arrays,
Iterable, or AsyncIterable and returns BulkReport with explicit completion status.
Defaults: batchSize=500, concurrency=2, ordered=false, failureMode=continue.
Ordered requires one slot and stop mode. maxBatchBytes=8 MiB, sample count=100,
diagnostic budget=64 KiB. No ambiguous write retries. Required sinks are awaited.

Report fields include status, consumed, attempted, knownSucceeded, failed,
uncertain, unattempted, native write counters, batch counts, elapsedMs, safe
bounded error samples and omitted counts. Unknown totals are null; matched/
modified counts cannot substitute successful operation counts. Native/batched
overloads must be statically distinguished once the runtime is implemented.

`seed` adds records, keyFields, dryRun=false, updateExisting=false, and
sourceKeysUnique=false, reusing bulk controls/reports. Simple exact unique indexes,
schema preparation and immutable-key checks are required. Seed input is ordinary
document data, not raw update operators. Dry-run reports planned work without
dispatch; detailed status/count fields are finalized with the seed runtime
rather than pretending dry-run has a native database BulkWriteResult.

## Transactions, lifecycle, and retries

`withTransaction(callback, options)` invokes callback(session, scopedDb) using
the selected connection and returns the committed callback value. Callback replay
is driver-controlled and external effects must be idempotent. Scoped operations
report pendingCommit until commit. Sessions are closed in finally. No automatic
ambient sessions, cross-connection scope, or parallel same-session work.

Health defaults to ping; probe=false is explicitly state-only. Required connection
readiness defaults to all. Disconnect rejects admission, drains tracked work,
and reports pending/uncertain work at deadline without closing beneath writes.

Plugin -> service -> call hooks execute sequentially. beforeOperation transforms
validated input or vetoes; afterOperation replaces only materialized results;
beforeError can replace Error but cannot change failure facts; onComplete runs
after cleanup exactly once. Post-write hook errors never replay committed writes.

Read retries are off by default. beforeRetry activates the default profile unless
explicitly disabled; per-call settings override service fields, inherited service
disable needs explicit call enable. Default 2 retries/100 ms base/1,000 ms max/
10,000 ms admission budget with full jitter. All beforeRetry hooks must permit.
Read allowlist: find/findAll/findOne/findById/exists/countDocuments and materialized
pages. Exclude writes, aggregates, probes, transaction reads, cursor jobs, and
hook errors. Native driver retry behavior is separate.
