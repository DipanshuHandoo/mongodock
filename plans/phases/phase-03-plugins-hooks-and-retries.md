# Phase 03: plugins, hooks, and safe read retries

Status: implemented and merged. Prerequisite: Phase 02. Evidence: npm run verify passed; coverage 99.0/97.1/92.9 (lines/branches/functions); size gate raised to 110/480 kB (packed/unpacked), actual 92.6/403.7 kB - needs user review. Public operation methods arrive in Phase 4; the executor is internal (getInternals) until then.
Authority: [master plan](../mongodock-implementation-plan.md);
common rules: [phase index](README.md).

## Objective and boundary

Build one execution lifecycle for future operations, configured plugins, and
opt-in read retries. Test with controlled execution functions before wiring CRUD.
No unrestricted method override, dynamic plugin loading, circuit breaker, or
HTTP-shaped hook aliases.

## Files and deliverables

- src\plugins\registry.js: unique-name validated plugin snapshots.
- src\hooks\pipeline.js/context.js: mutable-input boundary and terminal lifecycle.
- src\retry\read-policy.js: classification, precedence, budgets, abortable backoff.
- src\observability.js and shared declarations/errors/config: safe observer
  payloads and lifecycle integration.
- Feature tests/type fixtures, docs\plugins.md/hooks.md/retries.md, focused examples.

## Implementation tasks

1. Configure plugins as named reusable hooks at factory creation. Snapshot/freeze
   registration, validate known hook names/functions, reject duplicate names.
   Service hooks and per-call hooks follow plugins in deterministic forward order.
2. Give each admitted operation its own ID/context/metadata. Protect connection,
   model/method/session identity, allowAll, retry eligibility, signal, and bulk
   controls. Native direct calls remain outside this pipeline.
3. beforeOperation may return changed method-specific data/filter/options,
   undefined, or false. Validate hook return shapes and rerun input/safety checks.
   Capture effective input once; retries do not rerun transformations.
4. afterOperation transforms materialized results via { result }; beforeError may
   replace Error while preserving original cause/execution facts. Never replace
   iterators/batches or erase bulk counters/uncertainty.
5. Implement beforeRetry/onSuccess/onError/onComplete/onHookError and reporting
   hooks. Await sequential hooks; do not use the pool's swallowed callbacks.
6. Implement databaseOutcome versus invocationOutcome and every terminal path
   from the master's lifecycle table. At most one success/error terminal observer;
   onComplete is attempted exactly once after cleanup, including cleanup failure.
   Partial bulk uses onError even when its report resolves.
7. Hook failures before dispatch reject/veto. Post-execution failures retain the
   database result/outcome without retry. Observer failures report through
   onHookError; missing/failed reporting yields composite HookError without
   recursion or unhandled rejection.
8. Apply default 5,000 ms hook budget and cooperative cancellation. Isolate
   supported mutable inputs/results from late hook writes; define protected
   handles and unsupported-value rejection. Never claim external side-effect
   cancellation. Preserve pendingCommit contexts for future transactions.
9. Retry remains disabled unless explicit config or an effective beforeRetry
   activates it. Explicit per-call disable wins; inherited service disable needs
   explicit call enable. Use the master's full precedence table.
10. Enabled defaults: 2 retries, 100 ms base/1,000 ms maximum full-jitter delay,
    10,000 ms total admission budget; cap configured retries at 10. All retry
    hooks must allow continuation; false preserves the last database error.
11. Allow only named materialized reads/pages. Use tested driver/Mongoose
    classes/codes for transient infrastructure failures, no message heuristics.
    Exclude writes, seeds, bulk, arbitrary aggregates, health, transaction reads,
    cursor jobs, hook errors, timeout/cancel/auth/validation failures.
12. Connect lifecycle observers from Phase 02 using safe diagnostics. No duplicate
    event framework or raw unhandled error event; no data/credentials in default
    observer payloads.

## Validation and exit criteria

- Test order, async awaiting, concurrent context isolation, frozen config,
  duplicate names, invalid hooks/returns, replacement chaining, veto, revalidation.
- Test all terminal paths, reporting failure, cleanup failure, hook timeout,
  late mutation isolation, native error retention, and exact-once completion.
- Test retry activation from service/plugin/per-call hooks, disable/enable
  precedence, veto, jitter bounds, attempts/budgets, abort before/during wait.
- Both Mongoose majors supply supported classification fixtures. Controlled
  execution demonstrates no write retry and no retry after post-write hook error.
- Type fixtures enforce method-specific context/result contracts without any
  casts hiding input errors. Applicable lint/type/coverage/build checks pass.

## Handoff

Provide reusable executor/stream lifecycle contracts, invariant input fields,
retry classifier evidence, hook failure/outcome table, and observer safety rules.
Phase 04 must use this pipeline rather than add per-method try/catch frameworks.
