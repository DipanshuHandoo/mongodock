# Phase 09: reliability, compatibility, and scale

Status: implemented locally; CI matrix, network-drop fault injection and CI benchmarks remain open (see docs/scale.md). Prerequisites: Phases 05, 06, 07, 08.
Authority: [master plan](../mongodock-implementation-plan.md);
common rules: [phase index](README.md).

## Objective and boundary

Establish cross-feature correctness and scale evidence, resolve defects exposed
by integration, and finalize supported compatibility. This supplements feature
tests already delivered; it is not the first testing phase or publication.

## Files and deliverables

- test\integration cross-feature cases and shared owned fixtures.
- Controlled million-item tests/benchmark harness with scripts\test-scale.mjs.
- CI integration/scale jobs and exact supported peer/server matrix.
- Focused benchmark/reliability documentation and regression tests.

## Implementation tasks

1. Build a coverage map from all public methods/master contracts to assertions.
   Include missing/null/no-op cases, option forwarding, errors, cancellation,
   contexts, cleanup, and declaration behavior; close genuine feature gaps.
2. Exercise Linux/Windows and Node 22/24 with minimum/latest supported Mongoose
   8/9 patches, plus compatible exact MongoDB 7.0/8.0 replica-set versions.
   Record supported combinations and reject unsupported claims.
3. Integrate stream-to-bulk: slow read consumers/writes/sinks, counted/un-counted
   traversal, concurrent collection changes, transient reads, no cursor replay,
   mutation guards, and shared database/connection selection.
4. Verify ordinary calls/transactions/bulk/iterators participate in shutdown:
   reject admission while closing, stop dispatch, cancel idle cursors, drain
   active writes, surface deadlines and uncertain outcomes, and allow later drain.
5. Exercise hooks under database success/failure/partial/commit, reporting/cleanup
   failures, late timed-out hooks, and cancellation. Assert onComplete exactly once
   and no duplicate writes from read retry/plugin behavior.
6. Use actual peer driver result/error fixtures for validation-remapped bulk
   indexes, ordered tails, write concern, and transport uncertainty.
   Simulate faults deterministically where real fault injection is unreliable;
   label simulated versus real evidence rather than conflating them.
7. Generate at least one million operations lazily through the actual bulk
   orchestrator with controlled I/O, without creating a source array.
   Assert active slots, buffered records/bytes, retained sample caps, consumed/
   attempted/known/uncertain accounting, and iterator cleanup.
8. Compare increasing record counts and payload sizes; measure peak heap/RSS,
   throughput, latency, instrumentation overhead, and window slot utilization.
   Establish reproducible bounds from architecture, not arbitrary machine speed.
9. Run a configurable isolated real-database workload separately. Distinguish
   million-item scheduler accounting from actual MongoDB write throughput.
   Record hardware/server/index/payload/write-concern/latency conditions.
10. Tune the bounded window only with skewed-latency evidence and no weakened
    memory/cancel/ordering guarantees. Add regression tests for any corrective
    implementation changes, keeping the master aligned.
11. Add test:scale as a real command and required representative Linux CI gate.
    test:integration remains required on Windows/Linux; no infrastructure skips
    masquerading as release-readiness success.

## Validation and exit criteria

- Complete unit coverage meets 90/80/85 with no broad exclusion tricks.
- All required replica-set integrations and advertised peer/runtime combinations
  pass; unsupported environments have explicit error behavior.
- Million-item orchestration demonstrates bounded resident input/results,
  no overlap/retry of writes, truthful accounting, and deterministic cleanup.
- Slow/failing sinks and uneven payload/latency tests preserve backpressure
  and slot limits. No claim of an absolute process-memory/throughput guarantee.
- Type/lint/format/build gates remain green after any reliability fixes.
- Reports name exact commands/results and clearly distinguish local, CI,
  simulated-fault, scheduler-scale, and real-database evidence.

## Handoff

Provide compatibility matrix, measured scale constraints, regression coverage,
fixture versions, and unresolved blockers. Phase 10 cannot declare readiness
while an advertised combination or required CI scale/integration gate is missing.
