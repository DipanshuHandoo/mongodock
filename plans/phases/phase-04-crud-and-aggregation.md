# Phase 04: CRUD and aggregation

Status: implemented locally; `npm run verify` passes (unit, integration against local standalone MongoDB, tarball check incl. Mongoose 9 types). Size budget raised to 150/640 kB packed/unpacked, pending user review. Transactions with sessions are untested here (standalone server; Phase 7). Prerequisite: Phase 03.
Authority: [master plan](../mongodock-implementation-plan.md);
common rules: [phase index](README.md).

## Objective and boundary

Implement every requested ordinary database operation using the shared
connection/model executor, native options, explicit return semantics, and
mutation safety. Streaming aggregation belongs to Phase 05; bulk to Phase 06.

## Files and deliverables

- src\operations\reads.js/writes.js/aggregate.js/query-options.js.
- Factory/public types/errors and test\types fixtures updated.
- Feature unit tests and replica-set operation tests.
- docs\queries.md, focused API/error guides, CRUD/aggregation examples.

## Implementation tasks

1. Implement find/findAll/findOne/findById/exists/countDocuments. findAll is a
   bounded alias: default 100 records and configurable initial maximum 1,000.
   Validate skip/limit and reject unbounded zero-limit shortcuts.
2. Implement create/insertMany/updateOne/updateMany/findOneAndUpdate/
   findByIdAndUpdate, deleteOne/deleteMany/findOneAndDelete/findByIdAndDelete.
3. Return native documents/results; missing single reads return null, exists
   boolean, count number. Post-update document default and validation-on default
   apply where relevant; reject contradictory return aliases.
4. Accept registered name or same-connection Model. Preserve Model generic types;
   document explicit typing for string lookup. Resolve each operation once.
5. Map method-specific native options, projection/select/sort/populate/lean/session
   correctly. Wrapper control fields must never leak into driver calls.
   Reject unsupported combinations instead of ignoring them.
6. Guard missing/invalid/structurally empty mutation filters unless explicit
   allowAll. Recognize empty logical conjunctions; document expression-analysis
   limits. Extract the real shared guard for later nested bulk checks.
7. Check final transformed input before dispatch. Hooks cannot change permissions,
   connection/model/session, or write retry eligibility.
8. Implement materialized aggregate with native pipeline/options and preserved
   results. Reject $out/$merge without explicit allowWriteStages; inspect nested
   pipeline-bearing stages and reject uninspectable shapes conservatively.
9. Wire read allowlist to Phase 03 retry logic. Preserve native code/errors/causes,
   and do not retry writes/aggregate. Honor selected-session restrictions.
10. Enforce bounded wrapper population; document payload fan-out and native escape
    hatch. Materialized aggregate/insertMany have caller-owned memory boundaries.
11. Record pendingCommit when an operation uses a tracked transaction. Add private
    integration points for Phase 07 session scope without pretending all external
    sessions are verifiable.

## Validation and exit criteria

- Table-driven tests cover every helper, native arguments/options, result shape,
  missing documents, projections/lean/population, IDs, defaults, and invalid inputs.
- Real tests cover schema casting/validation/middleware, duplicate keys, all write/
  delete variants, aggregation, and named-database isolation.
- Empty/full-collection accidental mutation guards reject before dispatch,
  including changed filters from hooks; explicit allowAll permits intended work.
- Write-stage aggregate opt-in and nested stage scanning cannot be bypassed
  by hooks; no aggregate/write retry occurs.
- Tests verify terminal observers, native errors, read retry behavior, ordinary
  operation drain tracking, and post-write hook failure without duplicate writes.
- Type fixtures test document/lean/native-result distinctions across both peer
  majors. Run targeted unit/integration plus type/lint/format/build checks.

## Handoff

Provide operation input/result inventory, reusable filter/pipeline guards,
query option mapper, session admission points, and consumer examples.
Phase 05 extends reads, Phase 06 reuses mutation guards, and Phase 07 scopes
transactions without creating competing operations.
