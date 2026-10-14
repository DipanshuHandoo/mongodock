# Phase 07: transactions and health

Status: implemented locally (verify passes). Prerequisite: Phase 04.
Authority: [master plan](../mongodock-implementation-plan.md);
common rules: [phase index](README.md).

## Objective and boundary

Implement explicit connection-scoped transactions and inexpensive status versus
bounded readiness probes. Native callback replay belongs to the driver/Mongoose,
not the package read retry loop. No circuit breaker or implicit ambient session.

## Files and deliverables

- src\transactions.js, src\health.js.
- Factory/types/config/errors, operation session checks, admission tracking.
- Transaction/health unit and replica-set tests; declaration fixtures.
- docs\transactions.md/health.md and commit/rollback/readiness examples.

## Implementation tasks

1. Implement withTransaction on the selected connection using the supported
   Mongoose transaction helper where document rollback tracking is required.
   Callback receives explicit session and scoped operation facade; return its
   committed callback value. End owned sessions in finally.
2. Track package session ownership/transaction scope by session. Scoped calls
   attach the same session and cannot switch databases. Reject nested scope
   transactions and concurrent use of one active transaction.
3. Independent sessions may transact simultaneously. Do not use a global
   inTransaction flag, implicit AsyncLocalStorage, or Promise.all within one
   transaction. Root/native escape hatches define enforcement limits.
4. Verify externally supplied session ownership using supported public APIs only.
   Unverifiable/mismatched sessions reject; native model access is the fallback.
5. Driver-supported callback replay is explicit: attempt contexts are distinct;
   transaction terminal observers run once after commit/abort. External effects
   must be idempotent or delayed until commit. Ordinary transaction operations
   report pendingCommit, not committed success.
6. Preserve callback/commit/abort/cleanup errors and uncertainty without hiding the
   primary failure. Standalone topology rejects clearly. No generic package
   retries, cross-connection transaction claims, or parallel batched writes.
7. Enlist active transactions in connection drain. Cancellation stops subsequent
   calls and follows native transaction semantics; never fabricate commit/rollback.
8. healthCheck defaults probe true with 5,000 ms budget; probe false returns
   explicitly unprobed status. getStatus stays network-free.
9. Report per-connection readiness/latency/timestamp/safe codes and aggregate
   required connection readiness (all default, configurable nonempty subset).
   Do not log URI credentials or run collection scans for health.
10. Probe failures yield unhealthy reports plus error observers, not silent
    defaults. Apply no package health retry. Deadline handling must distinguish
    an expired report from an underlying native operation still active.
11. Wire lifecycle/operation observers through the existing hook pipeline; no
    second instrumentation framework or automatic HTTP health routes.

## Validation and exit criteria

- Real tests: commit/value, rollback, commit failure where reproducible, duplicate
  key abort, hydration state rollback, session cleanup, standalone rejection.
- Controlled tests: callback replay, attempt/terminal hooks, post-commit hook
  failure without replay, compound cleanup errors, ownership and nesting guards.
- Tests prove same-session sequencing, separate-session concurrency, no package
  read retries inside transactions, and drain-aware transaction admission.
- Health tests cover connected/disconnected, ping failure/deadline, status-only,
  aggregate required subset, safe errors, and no expensive data queries.
- Public types preserve transaction return values and scoped operations.
  Focused examples/quality/integration checks pass.

## Handoff

Provide session ownership/scoped facade APIs, callback replay evidence per peer
major, cleanup/error contract, and readiness/probe fields. Wire Phase 06 session
integration when bulk is available; Phase 08/09 validate the combined surfaces.
