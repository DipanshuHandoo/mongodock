# Phase 06: slot-pooled bulk processing

Status: implemented locally (verify passes). Prerequisite: Phase 04.
Authority: [master plan](../mongodock-implementation-plan.md);
common rules: [phase index](README.md).

## Objective and boundary

Implement explicit native/batched bulk modes with async-slot-pool scheduling,
bounded input/results, truthful partial/uncertain accounting, and cancellation.
No automatic write retry, durable scheduler, checkpoint store, or job-wide ledger.

## Files and deliverables

- src\bulk\bulk-write.js/batches.js/slot-runner.js/outcomes.js.
- Factory/types/config/errors and shared guards/session/resource wiring.
- Unit/integration bulk tests and controlled scale fixtures.
- docs\bulk-processing.md plus batching/partial-error/cancel examples.

## Implementation tasks

1. batching false default: require native operations array, execute once, return
   native result/reject native error. Reject batching-only settings/async sources.
2. batching true accepts array/Iterable/AsyncIterable, returns master report.
   Defaults: batchSize 500, concurrency 2, ordered false, failureMode continue.
   Caps: 10,000 records, 32 slots. Validate before consuming input.
3. Ordered input requires concurrency 1 and stop-on-error; reject conflicts.
   Unordered parallel batches require independent operations, documented as a
   caller responsibility. Never preserve a misleading global ordered promise.
4. Apply all nested update/delete filter guards after transformation; outer
   allowAll remains protected. Validate supported native operation shapes.
5. Batch by record and byte limits (default maxBatchBytes 8 MiB). Use verified
   public BSON size API from the selected peer driver. Reject oversize single
   operations; no truncation or false wire-limit promise.
6. Consume async sources into bounded windows equal to concurrency initially.
   asyncSlotPool retries/timeout are zero. Preserve native errors in typed batch
   outcomes, not stringified pool failures.
7. Fold/discard completed windows. Stream awaited onBatch/outcome sinks; diagnostic
   samples default 100/maximum 1,000 and 64 KiB total cap. Never retain all records,
   failed batches, raw documents, or upsert IDs in the final summary.
8. Account for consumed/attempted/knownSucceeded/failed/uncertain/unattempted
   separately from inserted/matched/modified/deleted/upserted native counts.
   Preserve original operation indexes after Mongoose validation filtering.
9. Distinguish pre-dispatch validation, indexed write errors, ordered tails,
   write concern, and ambiguous transport. Unknown lazy-source totals remain
   null; modified document counts are not successful-operation counts.
10. Continue independent failures with explicit partial/failed status; stop prevents
    new dispatch while draining in-flight work. Fatal source/sink/config failures
    reject with partial report. Partial resolved report uses onError/onComplete.
11. Cancellation/closing stops pulls and dispatch; settle active writes, close
    source iterators, and never claim rollback. Supported driver abort signals
    are capability-tested; timing out cannot release active write slots.
12. Track jobs through Phase 02, reject parallel transaction batches, and expose
    hooks once per job plus reporting once per batch, not once per record.
13. Benchmark skewed latency/window idle time. Retain bounded windows unless
    evidence justifies at most 4-times-concurrency windows or advancing lanes;
    document measured throughput/memory tradeoff.

## Validation and exit criteria

- Test input modes, defaults/caps/conflicts, empty source, record/byte boundaries,
  oversize items, sync/async iterator failure, return cleanup, and guarded deletes.
- Prove active writes <= slots; timeout/retry never overlaps the same write.
- Test native/batched return contracts, ordered/unordered partial failure,
  validation-remapped indexes, concern/transport uncertainty, and unknown totals.
- Test cancel/stop/closing during pull/dispatch, slow/failing sinks, bounded
  diagnostics, exact-once hooks, all active work settled before exit.
- Real replica-set tests establish both peer majors' result/error shapes.
  Controlled large-source checks prove bounded buffers before Phase 09 stress.
- Types discriminate batching modes; docs explain driver middleware/validation
  differences. Targeted quality/integration checks pass.

## Handoff

Provide reusable preparation/batching/outcome APIs for seeding, measured window
policy, error-shape fixtures, dispatch/cleanup invariants, and exact memory bounds.
Phase 08 reuses this engine rather than duplicating scheduling.
