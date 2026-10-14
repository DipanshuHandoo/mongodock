# Mongodock: production Mongoose service package

## Status and authority

Phase 01 is completed for local delivery following user authorization. Its local
foundation verification passes; the user deferred Docker/cross-platform
acceptance on 2026-10-13. Linux fixture readiness remains unverified.
Later phases, publication, commit, and push
are not authorized by the Phase 01 request.
This is the consolidated implementation plan, replacing the former
mongoose-service-toolkit plan. Its applicable requirements and future-roadmap
ideas are retained here; obsolete implementation and validation claims are
not evidence about the current checkout.

Build `@dipanshuhandoo/mongodock` as a reusable Node.js service with every
requested capability in the first release. Use Mongoose as the only database
adapter, keep native Mongoose available, and add reliable connection management,
bounded reads, pagination, slot-pooled bulk processing, and explicit seeding.

## Confirmed requirements and decisions

- All requested features belong in the first release, not a deferred roadmap.
- JavaScript source, checked JSDoc, and TypeScript declarations.
- Functional `createMongoService()` factory; no global singleton or repository
  classes. Operation arguments are objects. `db.use(name)` binds a database.
- Mongoose 8 and 9 compatibility, validated separately; external peer dependency.
- `@dipanshuhandoo/async-slot-pool` is required for bulk slot scheduling.
- Target millions of records using streaming and bounded memory. Applications
  trigger jobs manually, on events, or on schedules; scheduling stays outside
  this library.
- `batching: false` preserves a single native bulk-write call.
  `batching: true` enables caller-configurable package batching and concurrency.
- Batched defaults: batchSize 500, concurrency 2, unordered execution,
  failureMode `continue`. Ordered batched jobs require concurrency 1 and
  stop-on-error. Never silently change an incompatible caller configuration.
- Partial bulk success and uncertain write outcomes must be explicit.
  No automatic retry of ambiguous writes.
- Seeding is explicit, idempotent upsert by caller-defined unique keys, with
  dry-run. No import/connect-time seed execution or collection clearing.
- Reads default to 100 records; pagination defaults to 20; configurable maximum
  1,000. Whole-collection processing uses iteration rather than unbounded arrays.
- Empty-filter updates/deletes require explicit `allowAll: true`.
- Plugins are configured at factory creation, instance-scoped, deterministic,
  and frozen before connection/operation execution. Per-call hooks follow
  plugin hooks and service hooks.
- Hooks are controlled middleware: they may modify operation inputs, replace
  results/errors, or veto dispatch without bypassing validation or safety guards.
- Package read retries are off by default. Supplying beforeRetry enables the
  safe-read retry profile unless explicitly disabled; the hook can stop retries.
- findAll stays bounded. Add iterateBatches with optional initial count and
  bounded cursor/keyset traversal; never collect an entire collection implicitly.
- onCircuitStateChange was an example of hook style, not a request for a circuit
  breaker. Defer both the breaker and that hook.
- Integration fixtures use pinned MongoDB containers on Linux and native
  MongoDB replica-set processes on Windows; local runs may supply an explicitly
  isolated test replica-set URI. No test-server npm dependency is required.

## Verified baseline and reference observations

The repository was initialized while planning and now contains the Phase 01
foundation:

- Package metadata now identifies `@dipanshuhandoo/mongodock`, version `0.0.0`,
  MIT, public publication configuration, and Node >=22.18.0.
- The TypeScript `withRetry` sample has been replaced by checked JavaScript/
  JSDoc configuration, errors, and shared contracts. Build language is `js`.
  Phases 1-6 are implemented (foundation, connections/models, hooks/plugins/retry,
  CRUD and aggregation, pagination and streaming, slot-pooled bulk). Transactions,
  health and seeding are not implemented yet.
- Existing scripts provide ESM/CommonJS normal/minified builds, maps, declaration
  emission, Biome, Node tests, coverage gates, tarball checks, and Changesets.
- CI covers Linux/Windows, Node 22/24, and Mongoose 8.24.5/9.11.2. The manual release workflow
  uses environment approval, trusted publishing, and a verified tarball.
- Retain that infrastructure; adapt it rather than replacing it. Coordinate
  with user-owned changes and reread touched files before implementation.

The external reference service was read for behavior, not copied as an
architecture. It provides connection lifecycle, model lookup, create/find,
single-document updates/deletes, count, aggregation, offset pagination,
transactions, bulkWrite, exists, and state-based health.

Its application config dependency, default singleton, global Mongoose
connection, unconditional console logging, and global session creation do not
belong in the package. It lacks named isolated connections, bounded streaming,
keyset pagination, configurable bulk orchestration, and general-purpose seeding.

Dependency observations:

- Registry metadata reports async-slot-pool 1.0.1, Node >=22, and ESM/CJS exports.
- Tests against the published artifact confirm synchronous iterable input,
  retained task results, stringified task errors, swallowed progress-hook
  failures, bail without iterator cleanup, and non-cancelling timeouts.
- Registry metadata reports Mongoose 9.11.2 and latest major-8 version 8.24.5.
  Candidate peer range: `^8.24.5 || ^9.11.2`, subject to successful compatibility
  testing. Do not advertise older patches without testing them.
- Both Mongoose peers pass installed tarball runtime/declaration checks and
  expose public BSON size calculation. These are foundation observations, not
  complete future-feature compatibility claims. Exact evidence and outstanding
  fixture acceptance are recorded in the Phase 01 handoff.

## Package architecture

Keep feature ownership explicit without creating speculative layers.
Use private modules for composition; export only the factory and documented
errors/types from `src\index.js`. Expose native connection/model handles through
the service, not private import paths.

```text
src\
  index.js
  create-mongo-service.js
  config.js
  errors.js
  types.js
  connections\
    manager.js
    status.js
  models\
    registry.js
  operations\
    reads.js
    writes.js
    aggregate.js
    query-options.js
  pagination\
    offset.js
    cursor.js
    cursor-codec.js
  bulk\
    bulk-write.js
    batches.js
    slot-runner.js
    outcomes.js
  seeding\
    seed.js
    keys.js
  transactions.js
  health.js
  observability.js
  hooks\
    pipeline.js
    context.js
  plugins\
    registry.js
  retry\
    read-policy.js
test\
  *.test.js
  helpers.js
  integration\
    *.test.js
  types\
    esm.mts
    cjs.cts
docs\
examples\
scripts\
```

Feature tests may use matching subdirectories when useful. Keep singular
`test`. Do not create empty files; split modules according to actual
responsibilities. Shared query options, batching, and outcomes have real reuse;
do not add a generic utilities framework.

The factory composes per-instance connection/model state and focused functions.
Connection-bound views share that instance's resources but hold no mutable
global selection. No ambient tenant context, automatic process signal handlers,
or network side effects on import.

## Proposed public contract

### Minimal setup and multiple databases

Single database: supply a URI and schemas, explicitly connect, then use methods.
No dotenv, application config module, mandatory logger, or framework integration.

```js
import mongoose from "mongoose";
import { createMongoService } from "@dipanshuhandoo/mongodock";

const db = createMongoService({ uri: process.env.MONGODB_URI });
db.registerModel({
  name: "Page",
  schema: new mongoose.Schema({ title: String }),
});
await db.connect();

const page = await db.create({ model: "Page", data: { title: "Example" } });
const pages = await db.paginate({ model: "Page", filter: {}, page: 1, limit: 20 });

await db.disconnectAll();
```

Named setup accepts `connections: { primary: { uri, options }, reporting: ... }`
and an explicit defaultConnection. Reject conflicting single-URI/named
configuration and unknown names. `db.use("reporting")` returns a bound view;
root operations target the default. It does not silently open a connection.

### Required surfaces

| Area | Methods and semantics |
| --- | --- |
| Connections | connect, connectAll, disconnect, disconnectAll, getConnection, isConnected, getStatus, use |
| Models | registerModel, registerModels, getModel, hasModel, listModels, unregisterModel |
| Reads | find, findAll, findOne, findById, exists, countDocuments |
| Writes | create, insertMany, updateOne, updateMany, findOneAndUpdate, findByIdAndUpdate |
| Deletes | deleteOne, deleteMany, findOneAndDelete, findByIdAndDelete |
| Pagination | paginate for offset; paginateCursor for keyset |
| Streaming | iterate for documents; iterateBatches for batches and optional initial count |
| Aggregation | aggregate; aggregateCursor for large result sets |
| Transactions | withTransaction with explicit connection-scoped session |
| Bulk | bulkWrite with batching flag, bounded input bridge, progress, outcomes |
| Health | healthCheck per connection or aggregate service readiness |
| Seeding | seed with unique-key upserts, dry-run, batching flag, summaries |
| Extension | factory-configured plugins and service/per-call operation hooks |

`findAll` is a documented bounded alias of `find`, not a promise to materialize
the collection. Multi-record methods with inherently unbounded outputs, including
aggregate/insertMany/native bulkWrite, document their caller-owned memory
boundary and link to streaming/batched alternatives.

### Types, query options, results, and errors

- Accept a registered name or a same-connection Mongoose Model. Infer document
  types from Model inputs; string-based lookup needs explicit generics or a
  typed registry. Do not imply arbitrary model names infer schemas automatically.
- Separate wrapper controls from `options` passed to Mongoose. Maintain
  method-specific option types; do not spread pagination/batching keys into
  native calls.
- Support projection/select, sort, populate, lean, session, and appropriate
  native query options. Validate incompatible combinations rather than ignoring
  options. Return executable results, not unfinished Query objects; direct
  getModel/getConnection provide the advanced-query escape hatch.
- Native document-returning methods use Mongoose documents by default;
  lean is explicit. Missing single-document reads return null. exists returns
  boolean; countDocuments returns number.
- Update helpers return post-update documents by default. Honor explicit native
  return options and reject contradictory aliases. Default update validation on;
  expose deliberate opt-out and explain Mongoose update-validation limitations.
- Ordinary write methods return documented native results. Native validation,
  cast, duplicate-key, and database errors remain inspectable without losing
  code/details. Package control/lifecycle errors use stable codes and causes.
- No generic wrapper that erases native errors, no empty arrays on failure,
  and no blanket retry around writes or transaction callbacks. Explicit result/
  error replacement hooks are the sole caller-controlled exception and must
  preserve original execution metadata.
- Error metadata/hook payloads exclude credentials, documents, filters, and
  updates from observer events by default. Trusted modifying middleware receives
  necessary operation input/results and must not be treated as a logging-safe
  payload. Do not claim nested native causes are fully redacted; document them
  as sensitive and provide a safe serialized diagnostic view.

## Connection and model correctness

- Use owned `mongoose.createConnection` resources, never mongoose.connect or
  global model registration. Each named connection has its own model registry.
- Deduplicate concurrent opens, serialize lifecycle transitions, recover from
  failed opens, and make repeated closes safe. State comes from current
  Mongoose events/readyState, not a cached ever-connected boolean.
- Allow schema registration before connect. Repeating the same registration is
  idempotent; conflicting schema/model/name/collection registrations reject.
- Existing models must belong to the selected connection. Do not rebind or
  clone them silently. To reuse an application's connection, support explicit
  caller-owned connection configuration; never close it without opt-in.
- unregisterModel removes the service registry entry, not collections,
  indexes, or unrelated Mongoose model state.
- Named databases are connection-routing boundaries, not automatic authorization
  or tenant-security guarantees.
- Shutdown stops scheduling package jobs, settles active work under documented
  drain semantics, then closes owned resources and removes owned listeners.
  Report per-connection failures rather than hiding them in disconnectAll.
- Leave reconnect/retryable-write machinery to the driver. Expose options rather
  than installing a competing reconnect loop.
- No implicit index synchronization or production collection creation policy.
  Document autoIndex/autoCreate choices and explicit deployment-time indexes.

### Admission, buffering, and shutdown

Per-connection lifecycle: idle, connecting, ready, closing, closed, failed.
Only ready connections admit database operations; disable implicit Mongoose
command buffering for owned connections. Caller-owned connections must meet
the same no-hidden-buffering requirement or configuration rejects. Connecting
does not imply readiness. Explicit connect can reopen a fully closed connection;
it cannot overtake an in-progress close.

disconnect(name) stops admission and scheduling only for that connection;
disconnectAll stops admission across the instance before beginning the drain.
Track admitted ordinary calls, transactions, bulk jobs, and open iterators.
Cancel owned idle cursors, stop future batch pulls, and await in-flight calls
and writes. An abandoned iterator does not keep drain waiting indefinitely.
Caller-owned database resources are never closed by default, but owned
listeners/cursors and service jobs are still cleaned up.

Default drainTimeoutMS is 30,000, configurable as a positive finite integer.
Expiry rejects with ShutdownTimeoutError and an explicit pending/uncertain
operation summary. Do not close a connection beneath unresolved writes,
pretend rollback occurred, or detach untracked writes. Remain closing while
tracked work settles; a later disconnect call can await completion with a new
budget. No automatic force-close mode in the first release.

Hooks have a configurable hookTimeoutMS budget, default 5,000. Timeout stops
dispatch of later middleware and reports HookError; a hook receives a cooperative
signal. JavaScript cannot forcibly cancel a timed-out hook: it must never retain
mutable service inputs/results that can affect subsequent execution. Use
isolated snapshots of supported input values, preserve protected native handles,
and reject unsupported mutable values rather than silently sharing them.
Timeout is not rollback of external effects performed by a hook.

### Mutation guard coverage

Apply allowAll guards to updateOne/updateMany, deleteOne/deleteMany,
findOneAndUpdate/findOneAndDelete, and every equivalent nested bulk operation.
The explicit outer-call allowAll permission is immutable to hooks; validate the
effective filters after middleware and before dispatch, including streamed
batches. Per-record permission escalation is not supported.

Reject missing, null, invalid, and structurally empty filters without allowAll.
Recognize empty logical conjunctions as empty rather than assuming every
nonempty object is selective. Document that matching every possible record
cannot be decided for arbitrary MongoDB expressions: this is an accidental
full-collection guard, not authorization or protection against untrusted queries.

aggregate/aggregateCursor reject $out and $merge unless
allowWriteStages: true is explicit. Inspect all nested pipeline-bearing stages;
reject unknown nested pipeline shapes when they cannot be inspected safely.
Rerun checks after input middleware. Mutating aggregates are never retryable,
and write-stage output is not a bounded-read promise.

## Pagination and streaming

Offset result contract: docs, totalDocs, limit, page, totalPages, hasNextPage,
hasPrevPage, nextPage, prevPage. Counts are optional; when disabled, count-related
fields are explicitly null, and next-page detection uses a bounded extra record.
Outside a snapshot transaction, count and data may differ under concurrent writes.
Do not parallelize the count and data query when they share a transaction.

Keyset result contract: docs, limit, hasNextPage, nextCursor. Default `_id` sort;
supported compound scalar sort keys require an `_id` tie-breaker and suitable
indexes. Use lexicographic predicates with matching directions. Encode a
versioned typed BSON-aware cursor bound to connection/model/sort; reject invalid,
oversized, or incompatible cursors. A cursor is not an authorization credential.
Reject unsupported multikey/null/missing/collation cases initially rather than
silently returning incorrect pages.

First-release keyset values: ObjectId, Date, string with simple binary
collation, finite number, and boolean, homogeneous per sort field. Reject other
BSON types, arrays, mixed types, null/missing values, and non-simple collation.
Capture sort values before result transformation. Internally include all sort
fields even when caller projection excludes them; remove hidden fields from
delivered results afterward. Reject projections that cannot be augmented safely.

Bind cursor tokens to a versioned canonical query identity as well as connection,
model, sort, and collation. Serialize only supported BSON-aware query values,
use a digest rather than embedding sensitive filters, and reject unsupported
query shapes rather than unstable hashing. Require the same effective filter
on subsequent pages. Tokens are validated continuation data, not trusted
authorization or tamper-proof credentials. Default maximum token size: 8 KiB.
Hooks may transform delivered documents but cannot change continuation values,
count metadata, or next tokens.

iterate/aggregateCursor use Mongoose cursors, bounded batchSize, projection/lean
where applicable, and finally-based cleanup on exhaustion, early break, error,
and cancellation. No full-collection count or materialization before yielding.
Document that keyset iteration is not an immutable snapshot under concurrent
changes and that arbitrary aggregates may contain mutating stages.

### Batch iteration and count-first progress

iterateBatches accepts model, filter, batchSize, projection, sort, session,
signal, strategy (`cursor` default or `keyset`), includeTotal (default false),
and hooks. It returns an AsyncIterable of bounded batch envelopes:
docs, batchIndex, processed, totalDocs (number or null), and nextCursor
(keyset token or null for a server cursor). Do not expose a resumable token for
a native server cursor or add automatic durable resume.

When includeTotal is true, execute countDocuments on the same connection/filter/
session after input hooks and final validation, before fetching any data.
Count failure rejects; do not silently substitute an estimated count. Zero
count does not skip traversal because records can change after counting.
The count is progress metadata, not a termination condition or snapshot promise.
Stop only on iterator exhaustion/empty keyset page, an explicit bound, or
cancellation. Progress may exceed the initial count; do not report misleading
100% completion while work remains.

Default traversal uses a server cursor and application-level bounded grouping.
Keyset strategy uses indexed deterministic sort and the existing cursor codec,
not increasingly expensive skip/offset pages. Do not require an initial count
for either strategy. Await consumer demand before advancing; release buffers and
close underlying resources on early return/error/cancel.

Use async iterators as the core streaming API; Node consumers can explicitly
use Readable.from when a stream pipeline/export requires it. No extra streaming
dependency or eager Readable wrapper is necessary. Include bounded
iterateBatches-to-bulkWrite examples so the read and write sides both retain
backpressure. Document that user-owned consumers can defeat memory bounds by
collecting every yielded batch.

## Plugins, hooks, and safe read retries

### Plugin registration

Factory configuration accepts `plugins: [{ name, hooks }]` plus service-level
hooks. Plugin names are unique, hook names/signatures validated, and ordering
is the array declaration order. Snapshot registrations; avoid mutation from
the caller's original config after creation. No dynamic registration/removal,
global plugin registry, or auto-discovery.

A plugin is a reusable set of controlled hooks, not an alternate database
adapter or unrestricted service-method override. Do not introduce plugin
dependency graphs, dynamic loaders, or setup/teardown resource lifecycles
without a demonstrated need. Applications own resources used by their hooks.
Mongoose schema plugins remain available independently and are not the same
as service plugins.

All middleware executes in order: configured plugins, service hooks, per-call
hooks; same forward order for every phase, awaited sequentially. Concurrent
operations have independent contexts; never put per-request state on the plugin.
No new dependency is needed for plugins/hooks.

### Hook names and contracts

| Hook | Contract |
| --- | --- |
| beforeOperation | Inspect context; return a replacement validated input, undefined for unchanged input, or false to veto before dispatch |
| beforeRetry | Receive attempt, nextAttempt, delayMs, error, context; false stops eligible retries, undefined/true permits them |
| afterOperation | Transform materialized results via `{ result }`; undefined preserves them; not an iterator/batch transformer |
| beforeError | Inspect original error/context; return an Error replacement or undefined; cannot convert failure to success |
| onSuccess | Terminal observer after result transformation; once per logical operation, not per attempt |
| onError | Terminal observer for failure, veto, or cancellation; once per logical operation |
| onComplete | Finally-style terminal observer for every admitted invocation; after cleanup, once for all outcomes |
| onHookError | Receive hook failure, hookName, plugin/scope, and safe execution context; no recursive self-invocation |
| onBatch / onProgress | Awaited bounded job/batch reporting; complete ledger persistence remains an explicit required sink |

HTTP beforeRequest/afterResponse/beforeError(req) shapes become database
operation context; there are no headers or Response objects. Do not add
misleading HTTP aliases. beforeRetry follows the policy below, and
onCircuitStateChange is omitted until an actual breaker exists.

Context includes operation ID, correlation ID if supplied, fixed connection,
model identity, method, attempt, signal, timestamps, and per-invocation metadata.
Middleware cannot change connection/model/method/session, retry eligibility,
batch safety controls, or grant allowAll. It may return method-specific
filter/data/update/projection/native-option changes; validate and rerun every
guard afterward. Inputs are caller-supplied data, not pre-cast trusted MongoDB
commands. Reject invalid hook return types.

Capture the validated effective input once before attempt 1. Do not rerun
beforeOperation on each retry or recount/rewrite filters mid-iteration. Native
direct model calls remain outside service hooks and this boundary is documented.

### Hook failures and database outcome integrity

- beforeOperation/beforeRetry failures stop dispatch/retry and reject as
  HookError with cause. Veto is explicit OperationVetoError, never empty results.
- afterOperation runs only after execution, so hook failure rejects with
  databaseOutcome metadata indicating whether execution succeeded or is
  uncertain. Never repeat a committed write because its hook failed.
- beforeError failure must retain both the database error and hook failure;
  replacement errors retain original cause/context without erasing execution
  facts or rewriting partial/uncertain status.
- Terminal observer failures are reported through onHookError and do not
  rewrite committed database outcomes. If reporting is absent or itself fails,
  surface a composite HookError retaining the completed outcome and original
  failure; do not swallow it or launch an unhandled rejection.
- onComplete is attempted even when transformation, terminal, or cleanup hooks
  fail. Final reporting failures cannot recursively invoke onHookError.
- Streaming success/completion occurs on exhaustion, not when returning the
  iterator. Early consumer return is a distinct closed-early outcome; cancellation
  and iteration errors are non-success outcomes. A never-started lazy iterator
  does not open a cursor or run execution hooks.
- Stream/bulk job hooks run once at the logical job boundary. Batch hooks run per
  batch. Internal reads/counts/writes use the validated job context without
  accidentally replaying all job hooks per document. afterOperation does not
  replace iterators or streamed batches. onBatch/onProgress are reporting-only;
  callers apply streaming transforms through their own async iterators.
  Bulk report transformations must retain status, counters, and uncertainty.
- Partial bulk reports do not trigger onSuccess: partial/failed/cancelled use
  onError with report context even when the public continue-mode promise resolves.
  Native and batched APIs retain their previously documented return contracts.

### Terminal lifecycle and outcome contract

Track databaseOutcome separately from invocationOutcome. A database write can
be committed while the invocation rejects because of a post-execution hook.
Possible database outcomes: notDispatched, succeeded, failed, partial, uncertain,
and pendingCommit for operations inside a transaction. Invocation outcomes:
succeeded, failed, partial, cancelled, closedEarly. Preserve these facts in
errors, completion context, and safe diagnostics; hooks cannot rewrite them.

| Invocation path | Terminal delivery |
| --- | --- |
| Materialized success | afterOperation, then onSuccess, cleanup, onComplete |
| Terminal execution failure/veto/cancel | beforeError, onError, cleanup, onComplete |
| Resolved partial bulk report | onError with report, cleanup, onComplete; return report |
| Stream exhausted | onSuccess, cursor cleanup, onComplete |
| Stream closed early | cursor cleanup, onComplete with closedEarly; no onSuccess/onError |
| Stream failure/cancel | beforeError, onError, cursor cleanup, onComplete |

Invoke at most one of onSuccess/onError per admitted logical invocation.
Failure of a terminal observer does not invoke the opposite terminal observer.
onHookError reporting is attempted once per failed hook; its own failure is
included in a composite error without recursion. beforeError replacement applies
to thrown errors, not conversion of a resolved partial report into success.
onComplete is always attempted once after cleanup, including cleanup failures.
An invalid call rejected before admission has no execution lifecycle; validate
hook configuration at factory/call parsing boundaries and report directly.
Internal transaction callback replay has attempt contexts, but transaction
completion observers run only after commit/abort, never on each callback replay.

### Opt-in safe-read retry profile

Resolve retry settings at service/per-call scopes. Explicit retry false or
maxRetries 0 at the applicable override disables retries even with beforeRetry.
Otherwise explicit retry settings enable the policy; absent settings, an
effective beforeRetry hook enables the default profile. Without either, retries
are disabled. A plugin's beforeRetry counts as an effective hook; document this
because adding such a plugin changes policy.

Default enabled profile: maxRetries 2 (3 total attempts), baseDelayMs 100,
maxDelayMs 1,000, bounded exponential full jitter, abortable delay.
beforeRetry receives the actual chosen delay before waiting and may return false
to rethrow the existing failure. It cannot expand the budget or force an unsafe
operation to retry. Max attempts/time budget and explicit overrides are validated.

Only allowlisted idempotent read methods and read-only pagination before any
data delivery are eligible, and only for tested transient infrastructure errors.
No retries for validation/cast/duplicate-key/auth/config errors, mutation methods,
arbitrary aggregation (which may write), health probes, bulk batches, seeding,
reads in transactions, or streaming jobs after start/delivery. Separate native
transaction replay/driver retryable reads from package attempts in documentation.
Read results can differ between attempts; retries do not guarantee a snapshot.
Never retry on hook errors or masked/replaced errors: classify the original
database failure, and run beforeError only after terminal retry exhaustion.

For cursor jobs, require explicit consumer-managed restart/checkpoint handling
rather than retrying a partially consumed cursor. Deadlines must not release
an occupied execution slot while an underlying read is still running; prefer
driver-supported budgets plus cancellation checks.

Retry allowlist: find/findAll, findOne, findById, exists, countDocuments,
paginate, and paginateCursor as a materialized single-page call. A pagination
retry discards the failed attempt's data/count and reruns the complete page;
never combine data from one attempt with a count from another.
Retry only tested Mongoose/driver server-selection, network, and not-primary/
recovering infrastructure error classes/codes; no message-string heuristics.
Cancellation, maxTimeMS expiry, validation, authorization, hook errors, and
explicit non-retryable labels veto retry. Capture exact version-compatible
classification fixtures before advertising support.

Option precedence: per-call retry false/zero disables; otherwise per-call
settings override inherited fields, service retry false/zero remains disabled
unless the call explicitly enables retry. With no explicit disable/config,
any effective beforeRetry activates the default profile. retry true explicitly
enables defaults. All applicable beforeRetry hooks must permit a retry.
Default enabled totalBudgetMS: 10,000; maximum configured retries: 10.
The total budget governs admission of attempts/backoff, not hard cancellation
of an already-running driver call. Document additional driver-level attempts.

### Public defaults and limits

| Control | Default | Accepted boundary |
| --- | --- | --- |
| Read limit | 100 | 1..configured maxReadLimit; initial max 1,000 |
| Pagination limit | 20 | Same read limit boundary |
| Offset count / iterateBatches count | true / false | Explicit boolean includeTotal |
| Cursor/iteration batchSize | 500 | 1..10,000; separate from read-page limit |
| Bulk batchSize / concurrency | 500 / 2 | 1..10,000 / 1..32 |
| Diagnostic samples / byte cap | 100 / 64 KiB | 0..1,000 samples; positive finite byte cap |
| Bulk/seed maxBatchBytes | 8 MiB | Positive safe integer; applies before dispatch |
| Keyset token bytes | Maximum 8,192 | Reject oversize before decoding |
| healthCheck probe / probeTimeoutMS | true / 5,000 | probe false is status-only; positive finite budget |
| Required health connections | All configured | Explicit nonempty subset may be configured |
| drainTimeoutMS / hookTimeoutMS | 30,000 / 5,000 | Positive finite integers |
| Retry | Disabled | beforeRetry activation and precedence as specified above |

All numeric inputs must be safe integers within documented ranges. Validate
offset multiplication for safe-integer overflow. State-based healthCheck never
labels an unprobed connection as ping-verified; getStatus remains network-free.
Lifecycle hooks: onConnectionConnecting, onConnectionConnected,
onConnectionDisconnected, onConnectionReconnected, onConnectionError.
These are observers with the terminal observer-error contract, not mutable
operation middleware. No raw EventEmitter error event without a listener.

## Slot-pooled bulk processing

Illustrative batched operation:

```js
const report = await db.bulkWrite({
  model: "Page",
  operations: operationSource,
  batching: true,
  batchSize: 500,
  concurrency: 2,
  ordered: false,
  failureMode: "continue",
  signal: controller.signal,
  onBatch: async (outcome) => persistOutcome(outcome),
});
```

### Two explicit modes

- `batching: false` is the default: require a materialized native operations
  array, execute once, return native BulkWriteResult, and reject native errors.
  Reject batching-only settings/async streams instead of pretending they apply.
- `batching: true`: accept arrays, Iterable, or AsyncIterable; produce structured
  summaries. Apply confirmed configurable defaults. Validate positive integer
  batchSize/concurrency and caps. MongoDB's driver still controls wire-size
  splitting; a record-count batch limit is not a BSON-byte guarantee.
- Ordered mode means global input order: concurrency 1, stop after error, and
  accurate unattempted tracking. Reject ordered parallel or ordered-continue
  combinations. Unordered parallel mode is only for independent operations.

### Bounded bridge around async-slot-pool

- Consume async input into bounded windows of batches, and submit each window
  to asyncSlotPool. Use default window size equal to concurrency; add complexity
  for cross-window refill only if measurement justifies it.
- Benchmark window-barrier idle time and slot utilization under skewed batch
  latency. Preserve bounded windows initially; if materially limiting throughput,
  use a bounded larger window (maximum 4 times concurrency) or advancing lanes.
  Record the decision and measured memory bound, never trade it for job-wide
  retained pool results. Stop-on-error still checks before each dispatch.
- Set pool retries 0 and pool timeout 0. Driver-level supported time budgets
  and caller cancellation are separate controls. A scheduling timeout must not
  release a slot while the write is still running.
- Wrap each database task into a typed batch outcome preserving the original
  error; do not depend on the pool's stringified failure list.
- Fold each completed window into summary counters and discard retained
  operations/results. Stream detailed outcomes through an awaited application
  sink, not the pool's fire-and-forget hooks. Do not accumulate all records or
  failed batches in the final report.
- Keep bounded diagnostic samples (default cap 100) and explicit omitted counts.
  Avoid storing entire batch documents in samples. The caller supplies external
  persistence if a complete failure ledger is required.
- Close resource-owning iterators explicitly. Catch source/sink failures at the
  orchestration boundary, settle active tasks, and reject with partial summary.
- Cancel stops new pulls/scheduling; active writes settle. Propagate AbortSignal
  only where the tested underlying API supports it. Never promise rollback or
  hard cancellation for writes already dispatched.

### Outcome/report contract

Report status `completed`, `partial`, `failed`, or `cancelled`; consumed,
attempted, knownSucceeded, failed, uncertain, and skipped/unattempted where
knowable; batch counts; elapsed time; native inserted/matched/modified/deleted/
upserted counters; bounded error samples.

Do not equate modified documents with successful operations. Distinguish
validation failures before dispatch, indexed write errors, ordered unattempted
tails, write-concern failures, and ambiguous transport failures. Use null/unknown
for unavailable totals, especially a stopped lazy source. Upsert ID detail is
streamed rather than collected for millions of operations.

Continue mode resolves with explicit non-success status for record/write
failures; stop mode reports partial progress after draining. Fatal config,
input-iteration, or required result-sink errors reject with a partial report.
Cancellation remains distinct from successful completion. No automatic
whole-batch retry; consumers can reconcile/retry known safe failures explicitly.

### Payload-size and buffering boundaries

Record counts alone do not bound bytes. Expose maxBatchBytes, default 8 MiB,
for transformed bulk/seed operations, using BSON size calculation from the
selected Mongoose driver's public BSON surface rather than a new BSON version.
Flush before either record or byte budget is exceeded; reject an individual
operation exceeding the configured application budget before dispatch.
This is an application-buffer estimate, not an exact wire-message limit.
Driver wire-size splitting and server document-size limits remain authoritative.

Bound diagnostic samples by both count and maxDiagnosticBytes (default 64 KiB
total); retain safe metadata rather than raw errors/documents. Truncate individual
diagnostic messages explicitly with omitted-byte counts, never truncate actual
operations or error causes returned for ordinary failed calls.

Read cursors still have native buffers and a single document can be large.
Describe read memory as O(buffered records times delivered payload), including
hydration and population. A post-fetch byte budget cannot prevent the driver's
initial allocation. Recommend lean/projection and bounded population limits;
reject wrapper-managed unbounded population requests and expose the native-model
escape hatch. Do not advertise a strict process-RSS cap.

## Transactions, health, observability, and seeding

### Transactions

Use the selected connection's supported transaction helper with explicit
session propagation. The callback receives that session and returns its value.
Document driver-supported callback replay: external side effects must be
idempotent or postponed until commit. End sessions in finally.

Reject detectable nested transactions in package scopes, mismatched/cross-
connection sessions, and parallel batched writes in transactions. Sequential
native operations remain possible.
Do not use Promise.all within a transaction. Replica sets/sharded clusters are
required; standalone deployments fail clearly rather than claiming support.
Cover rollback, commit failure, replay, and hydrated-document state after abort;
prefer Mongoose's transaction helper when its rollback tracking is needed.

Track package-owned sessions in instance-local ownership records and transaction
scopes by session, not a global inTransaction flag. Pass an explicit scoped
operation facade alongside the session so nested withTransaction on that facade
and concurrent use of the same active transaction can be rejected. Independent
transactions on different sessions remain allowed. No implicit AsyncLocalStorage
propagation is required.

Raw Mongoose sessions use only tested public driver ownership checks; if their
connection cannot be verified, reject and direct callers to the native model
escape hatch. Do not rely on private client fields. Package guards cannot
intercept direct native model/session calls or unrelated root transactions;
document that boundary instead of promising universal nested-transaction
detection. Operation hooks inside a transaction report pendingCommit.
Successful commit alone changes transaction outcome to succeeded.

### Health and observability

getStatus is cheap current state. healthCheck defaults to a lightweight ping,
with explicit probe: false for state-only inspection, and returns status, readiness,
latency, timestamp, and safe diagnostic code. Probe failure intentionally
produces an unhealthy result and emits an error event; it is not a swallowed CRUD
error. Aggregate readiness reflects all required connections.

Expose structured lifecycle/operation/job hooks with connection, model,
operation, timing, correlation label, and outcome. No console logger or mandatory
telemetry dependency. Document hook-error handling: required persistence sinks
are awaited and fatal; ordinary observer failures are surfaced through a
designated observer-error channel without rewriting database success.
Use the plugin/hook pipeline above as the single operation instrumentation
surface; do not create a second competing callback/event dispatch mechanism.
Cheap lifecycle/status notifications remain distinguishable from mutable
operation middleware.

### Seeding

seed accepts model, records, keyFields, dryRun, batching, and relevant bulk
controls. Validate nonempty keys, own defined scalar key values, and matching
unique indexes. Missing/wrong indexes fail before writes; do not create them
silently. Use an upsert filter from keys and `$setOnInsert` by default, leaving
existing records untouched; explicit updateExisting uses `$set` with documented
overwrite semantics.

Validate cast seed documents against the schema before forming operations,
including defaults, required fields, custom validators, strictness, and immutable
paths. For updateExisting, reject immutable-key/path changes and document
partial-update versus full-document validation. Seed transforms must reject
operator-shaped records and unsupported keys instead of accepting raw update
operators. Retain per-record original input indexes in validation reports.

Explicit validation is not save middleware: seeding does not execute save hooks.
Document validate/bulkWrite middleware behavior separately for Mongoose 8/9,
including validators/defaults run during preparation. Dry-run uses the same
preparation and index checks as execution without dispatching writes; it cannot
simulate server-side write errors or persistence middleware effects.

Inspect actual unique indexes, not just schema declarations. Initially support
only exact key-field unique indexes without sparse/partial constraints and with
simple collation; reject unsupported variants with an actionable explanation.
Use cast scalar key values matching index semantics. Explicitly reject missing,
undefined, null, array, and object keys other than supported BSON scalar values.

Default duplicate-input policy: repeated keys within a batch reject those records.
The wrapper does not retain a job-wide key set for millions of records; keys
repeated across batches are handled by unique indexes and reported idempotent
upserts. updateExisting with parallel batches requires the caller to guarantee
unique keys across the source; require concurrency 1 unless that guarantee is
explicitly declared. Concurrent upsert duplicate-key races are reported with
their native cause; do not silently retry or treat them as inserts.

Share the bulk engine and error/report contracts. Batched async sources are the
large-input path; nonbatched arrays retain the native memory boundary. Dry-run
validates/transforms bounded input, reports planned upserts, and performs no
writes; it does not guarantee race-free inserted-versus-existing counts.
Separate independent seeding calls are the composition primitive for multiple
models; applications order dependent fixtures explicitly. No seed discovery
from application directories, environment-specific admin provisioning, automatic
execution, delete/reset modes, or durable seed ledger in this release.

## Build, dependency, and runtime policy

- Preserve scoped identity, MIT, dual ESM/CJS, normal/minified builds, maps,
  Changesets, Node 22/24 baseline, and the publish allowlist.
- Convert the remaining TS sample to checked JS and replace retry-demo exports,
  fixtures, documentation, and examples with Mongodock capabilities. Generic
  unsafe retry helpers are not a public Mongo write API.
- Required new runtime dependency: async-slot-pool, candidate `^1.0.1`.
  Mongoose is a required peer and a development dependency for verification.
  Externalize both from bundles.
- Use existing esbuild/TypeScript/Biome/Node-test tooling. JSDoc declaration
  generation must preserve generic models, lean/document distinctions,
  projections where inferable, and native options without any-casts.
- Dual builds are stateless on import; shared ESM/CJS singleton identity is not
  required. Each factory instance owns its own state.
- No browser build: Mongoose service is Node-only.
- Retain current package-size gates initially; measure real packed output before
  proposing a documented budget change. Do not automatically relax thresholds.
- Test dependency support on both Mongoose majors before claiming compatibility.
  Broader MongoDB server support is determined by the chosen driver/server
  compatibility matrix, not assumed from local smoke tests.
- Runtime jobs are I/O-bound: slot concurrency, not worker threads. Recommend
  workers for caller CPU-heavy transforms and external queues for durable jobs;
  neither belongs inside this release.

## Testing and acceptance

Unit coverage: factory isolation, every public helper, object validation,
safe defaults, option forwarding, schema collisions, session routing,
connection races, reconnection/shutdown, cursor encoding/comparison, cancellation,
partial outcomes, ambiguous errors, source/sink cleanup, and seed-key safety.
Also cover plugin order/isolation/frozen configuration, invalid hook returns,
veto and post-transform guards, result/error replacements, original error
retention, pre/post-dispatch hook failures, observer-reporting failure, exact-once
completion, and stream early return/cancel. Test retry-off defaults, beforeRetry
activation, explicit disable precedence, read allowlist, transient classifier,
budget exhaustion, veto, jitter bounds, cancellation, and no write retries.

Integration coverage against an isolated real MongoDB replica set:
multiple databases with identical model names; owned/caller-owned resources;
validation/middleware; CRUD and aggregates; offset/keyset pages; streaming
early-break cleanup; ordered/unordered bulk partial failures and write counts;
transaction commit/rollback/replay; repeated/concurrent unique-key seeding;
dry-run no-write assertions; disconnection/probe failure where reproducible.
Test optional count-first traversal under concurrent inserts/deletes, no premature
termination at the initial total, keyset versus native cursor behavior, and
read-to-bulk backpressure. Verify hooks cannot bypass unfiltered-write guards and
a post-write hook failure does not repeat the write.

Require explicit test-only database names and cleanup ownership. Never run tests
or demos against arbitrary application/production databases. Replica-set fixture
provisioning is a prerequisite, not verified present; choose CI/local provisioning
that works on Windows and Linux. Do not add mongodb-memory-server or a container
wrapper dependency without discussing the need. Missing required infrastructure
must fail the integration/release gate; an explicit local skip cannot claim
complete verification.

Fixture strategy is approved: single-node replica set in an exact-version,
digest-pinned official MongoDB container on Linux CI; checksum-verified official
MongoDB binaries running a single-node replica set on Windows CI. Use random
ports, a unique replica-set name, owned temporary data paths, explicit readiness/
primary polling, and finally-based PID/container-specific cleanup. Bind locally,
never expose an unauthenticated fixture on a public interface.
Local developers may provide MONGODOCK_TEST_URI with explicit test-only opt-in.
Generate unique database names per suite; only those names may be dropped.
Never copy application URIs implicitly. Fixture scripts require no new npm
test-server dependency and must fail clearly when prerequisites are absent.

Initial server verification targets: MongoDB 8.0 and 7.0 where both selected
Mongoose drivers officially support them; choose exact patches/checksums during
fixture setup and record them. Do not claim untested server majors. Check
minimum and latest supported peer patches across Mongoose 8/9; build a covering
matrix of server/driver combinations without assuming every combination works.

Commands: test and test:coverage run deterministic unit/contract tests;
test:integration requires a live isolated replica set; test:scale runs the
million-item generated-source accounting/memory benchmark plus a configurable
real-database workload. verify includes required integration after coverage and
before build, then artifact/examples. CI additionally requires test:scale on a
representative Linux job; release requires those gates green on the exact commit.
Windows/Linux integration gates cannot silently skip. Keep expensive real-database
million-write throughput measurements separate from deterministic million-item
scheduler tests; label which evidence each supplies.

Scale acceptance:

- Stream at least one million generated operations without storing the source.
- Assert active writes <= concurrency and resident buffered input remains bounded
  by window/batch controls, independent of total records.
- Measure peak memory across increasing input sizes and payload sizes; investigate
  retention rather than advertising universal throughput.
- Assert consumed/attempted/known/uncertain accounting, bounded diagnostics,
  no duplicate whole-batch retries, no work dispatched after cancellation,
  and all already-started work settled on exit.
- Verify actual driver behavior and native error result shapes on Mongoose 8/9.

Package acceptance:

- Coverage gates: 90% lines, 80% branches, 85% functions across library source.
- Preserve verify order with a required integration gate inserted: clean,
  typecheck, lint, format check, coverage, integration, build, packed consumer/
  example checks. Scale checks are additionally required in CI/release.
- Run ESM, CJS, minified, and TS NodeNext ESM/CJS consumers from an installed
  tarball, with Mongoose installed as a peer. Verify all advertised exports.
- Use publint/Are the Types Wrong; verify source maps, dependency externalization,
  contents, size, no source/test/example/credential leakage.
- Runnable examples: basic, full-tour, multi-database, model registration,
  queries, both pagination modes, cursor processing, transactions, health,
  bulk partial failure/cancellation, and idempotent seeding.
  Include reusable plugins, hook ordering/replacements/failures, safe-read retry
  activation/disable, and counted/uncounted batch iteration with stream export.
- CI exercises Linux/Windows, Node 22/24, and minimum/latest supported Mongoose
  patches. Test each advertised runtime boundary rather than assuming parity.
- Manual publication only after exact-artifact verification and external setup.
  Environment reviewer protection, scope ownership, and npm trusted-publisher
  binding are external prerequisites; existing YAML is not proof of setup.

## Execution todos and prerequisites

Detailed execution is split into [10 phase plans](phases/README.md), each with
prerequisites, affected files, tasks, validation, exit criteria, and handoff.
The master contract remains authoritative; phases do not reduce first-release
scope or authorize execution. Tests and focused docs/examples accompany each
feature rather than being deferred to the final phases.

1. Finalize API/result/error schemas and dependency contracts. Verify published
   slot-pool behavior and record minimum supported peer/runtime versions.
2. Adapt initialized package to JavaScript/JSDoc. Update build configuration,
   metadata, public declarations, and fixtures while preserving baseline tools.
3. Implement isolated connection lifecycle and connection-aware model registry.
4. Implement configured plugins, controlled hook lifecycle, and safe-read retries.
5. Implement all read/write/delete/aggregate helpers, native options, guardrails,
   and associated error/observability contracts.
6. Implement offset/keyset pagination, iterateBatches/count-first progress,
   and finally-cleaned streaming cursors.
7. Implement windowed async-slot-pool bulk processing, bounded reports,
   cancellation, sinks, and explicit native/batched modes.
8. Implement connection-scoped transactions and health probing.
9. Implement unique-key seeding and dry-run through the shared bulk engine.
10. Complete deterministic, real-replica-set, scale, and compatibility tests.
11. Replace sample docs/examples; document every API/default/failure boundary.
12. Adapt artifact checks, CI, and release verification; run full release-readiness
    gates and report unconfigured external prerequisites.

Provision and verify integration fixture scripts alongside package adaptation,
before database features are implemented. Add feature tests and documentation
incrementally with each feature, not only in the final completion milestones.

Dependencies: API contracts precede package adaptation. Connections/models need
the adapted package. Operations need connections/models. Pagination/bulk/
transactions need operations. Seeding needs bulk. Comprehensive integration
tests and docs/examples need all feature surfaces. Final readiness needs tests
and docs/examples.
Plugin/hook/retry contracts depend on package adaptation and connections/models;
operation helpers depend on that pipeline. Batch iteration belongs to the
pagination/streaming milestone, not a deferred capability.

Implementation can proceed incrementally in that order without reducing
first-release scope. No release is considered complete until every requested
capability and all required gates are verified.

## Deliberate exclusions

Native MongoDB adapter; scheduler; durable checkpoint/resume; migration engine;
cache; OpenTelemetry adapter; framework-specific packages; soft-delete policy;
automatic indexes; automatic dangerous seed reset; distributed locking/job
leases. Consumers retain native Mongoose for advanced features. None is required
to deliver the explicitly requested first release.
Circuit breakers and onCircuitStateChange are also deferred by user decision.

## Source references

- Former mongoose-service-toolkit roadmap consolidated into this document.
- Observed reference:
  `D:\Github\gwp-engg-boilerplate\node-backend\src\infrastructure\mongo\mongo.service.js`.
- Initialized repository: package.json, boilerplate.config.json, src, test,
  scripts, docs/examples, and CI/release workflows.
- Slot-pool behavior:
  https://github.com/DipanshuHandoo/async-slot-pool
- Dependency versions/engines: npm registry metadata queried during planning.
- Mongoose operation/transaction documentation must be checked during execution;
  a planning-time transaction-page fetch failed, so it is not claimed as verified.

## Retained product direction and future roadmap

These ideas from the former roadmap are preserved for consideration, not
first-release commitments or implemented capabilities.

Target Node.js teams sharing database conventions across services and
high-volume import, content-processing, synchronization, and audit pipelines.
Position the package around minimal setup, reliable multi-database lifecycle,
bounded bulk processing, and observable failures, not merely CRUD method count.
Any competitor comparison, including @classytic/mongokit, needs current
versioned source/documentation evidence before making feature-gap claims.

Future candidates:

- Non-destructive index diagnostics: compare schema declarations with database
  indexes, report missing/unexpected/conflicting indexes, and never drop or
  rebuild production indexes automatically.
- Durable jobs: caller-provided checkpoint storage, stable job/operation IDs,
  versioned state, bounded safe retries, explicit at-least-once semantics,
  and locking/leases before distributed resume. Never promise exactly-once writes.
- Optional cache adapters: explicit TTL, namespaces, stable keys, bypass,
  invalidation policy, and documented stale-data/consistency tradeoffs.
- Versioned migrations: history, dry-run where feasible, explicit forward and
  compensating operations, checkpoints, and multi-worker locking.
- Streaming import/export: serialization and BSON preservation, backpressure,
  destination/overwrite validation, counts/checksums, and safe partial recovery.
- Optional OpenTelemetry, change-stream, audit-event, and framework adapters;
  Express/Fastify/Next.js examples after core API stabilization. No mandatory
  Redis, telemetry service, queue, or framework dependency.

Measure adoption and reliability through consumer integration effort,
applications migrated, reduction in duplicated code, bulk failure-accounting
accuracy, lifecycle incidents, diagnosis effort, and API stability. Downloads
alone do not establish product quality.

Measure connection startup, operation latency distributions, bulk throughput,
peak memory, instrumentation overhead, and recovery under representative
indexes, payload sizes, topology, and write concerns. Publish reproducible
benchmark conditions rather than universal performance promises.

Before calling a stable release production-proven, migrate a real consuming
application, validate API/lifecycle behavior there, and document migration from
the copied service, support/security reporting, semver changes, and release
recovery. npm publication is irreversible; metadata failures after publication
must be recovered without blindly republishing or retagging.

Reference starting points (verify current behavior during implementation):

- https://mongoosejs.com/docs/
- https://mongoosejs.com/docs/connections.html
- https://mongoosejs.com/docs/models.html
- https://mongoosejs.com/docs/middleware.html
- https://mongoosejs.com/docs/api/model.html
- https://www.mongodb.com/docs/drivers/node/current/
- https://docs.npmjs.com/
- https://www.npmjs.com/package/@classytic/mongokit
