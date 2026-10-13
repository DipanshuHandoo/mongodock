# Phase 05: pagination and streaming

Status: planned. Prerequisite: Phase 04.
Authority: [master plan](../mongodock-implementation-plan.md);
common rules: [phase index](README.md).

## Objective and boundary

Support simple materialized pages and million-record traversal with bounded
async iterators. Do not change findAll into an unbounded array or build durable
resume/export tooling. A consumer may use Readable.from for Node pipelines.

## Files and deliverables

- src\pagination\offset.js/cursor.js/cursor-codec.js.
- Focused iterator module(s) created only where responsibility warrants them.
- iterate/iterateBatches/aggregateCursor wired into factory/types.
- Pagination/stream unit and integration tests; declaration fixtures.
- docs\pagination.md/streaming.md, count/no-count and stream export examples.

## Implementation tasks

1. Implement paginate with default page size 20, safe-integer page/skip arithmetic,
   deterministic sorting, optional includeTotal (default true), and master result
   fields. Disabled counts use null metadata and limit-plus-one next-page detection.
2. Outside transactions allow independent data/count queries; inside transaction
   sessions execute sequentially. Document non-snapshot count/data drift.
   Read retries rerun the complete materialized page.
3. Implement paginateCursor using lexicographic predicates, indexed sort, and _id
   tie-breaker. Default _id ordering; enforce homogeneous supported scalar BSON
   keys and reject multikey/missing/null/non-simple-collation cases.
4. Encode versioned tokens with query digest, model/connection/sort/collation,
   typed continuation values, and 8 KiB maximum before decoding. Canonicalize
   only supported query values; reject unstable/unsupported shapes.
5. Add hidden sort fields needed by projection, capture continuation before result
   hooks, remove internal fields afterward. Reject incompatible projections;
   do not let result replacement change next tokens/counts.
6. Implement iterate and aggregateCursor using native Mongoose cursors with batch
   size default 500 (maximum 10,000), projection/lean/options, guarded write stages,
   cancellation checks, and resource registration.
7. Implement lazy iterateBatches envelopes: docs/batchIndex/processed/totalDocs/
   nextCursor; strategy cursor default or keyset. No full-source materialization.
8. includeTotal defaults false. When enabled, count the final effective filter
   before traversal on the same connection/session; errors reject. Zero count
   does not skip reads. Terminate by exhaustion, never initial total.
9. Pull only with consumer demand; count is progress metadata and may drift.
   Close underlying resources on exhaustion, early return, error, cancel, shutdown.
   Never-started iterators perform no connection work or execution hooks.
10. Stream terminal hooks follow Phase 03: exhaustion succeeds, early return is
    closedEarly, cancellation/failure rejects; onComplete follows cleanup.
    No cursor replay or whole-iterator/batch replacement hooks.
11. Document native read buffers, large documents, population costs, and absence
    of a hard RSS cap. Consumers must not collect yielded records globally.

## Validation and exit criteria

- Offset tests: empty/out-of-range pages, caps, count disabled, count failure,
  overflow, stable sorting, concurrent-change metadata, transaction sequencing.
- Keyset tests: ascending/descending compound ties, all supported BSON types,
  query mismatch, oversize/malformed tokens, rejected null/mixed keys, excluded
  sort fields, hooks preserving continuation, deterministic traversal.
- Stream tests: laziness, bounded pulls, slow consumers, count drift/zero count
  followed by inserts, early break/return, error/cancel, abandoned cursor shutdown.
- Real tests verify cursor close, no missing/duplicate stable-fixture pages,
  native/keyset traversal, and aggregation guards. Do not claim snapshot behavior.
- Type fixtures validate async document/batch interfaces; examples use public
  exports and assert envelopes. Targeted quality/integration gates pass.

## Handoff

Provide codec/query constraints, resource cleanup and terminal semantics,
backpressure evidence, and streaming examples. Phase 09 joins these iterators
to the Phase 06 bulk engine and validates the combined memory boundary.
