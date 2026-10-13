# Phase 08: idempotent seeding

Status: planned. Prerequisites: Phase 06; Phase 07 for session integration.
Authority: [master plan](../mongodock-implementation-plan.md);
common rules: [phase index](README.md).

## Objective and boundary

Provide explicit unique-key seed upserts and no-write dry-run using the bulk
engine. No import/connect execution, admin provisioning, collection reset,
automatic index creation, fixture discovery, or durable seed ledger.

## Files and deliverables

- src\seeding\seed.js/keys.js.
- Shared bulk preparation/outcomes and seed declarations/config/errors.
- Seed unit/integration/type tests.
- docs\seeding.md and repeated-seed/dry-run/batched-source examples.

## Implementation tasks

1. Input: model, records, keyFields, dryRun, updateExisting, batching, and supported
   bulk controls. Preserve selected connection/session and outer safety controls.
   Native mode requires arrays; large async sources use batching true.
2. Validate nonempty own defined scalar keys after schema casting. Reject
   undefined/null/arrays/unsupported objects/operator-shaped records. Preserve
   original source indexes in preparation/errors.
3. Inspect actual indexes before any dispatch: exact unique key set, simple
   collation, no sparse/partial constraints in the first release. Missing/wrong
   indexes fail clearly; schema declarations alone do not prove enforcement.
4. Prepare documents with defaults, schema casting/validation/custom validators,
   strictness and immutable-key/path checks. Define updateExisting validation
   behavior explicitly against the finalized master contract.
5. Build key filters and $setOnInsert by default, leaving existing records
   untouched. updateExisting deliberately applies $set for allowed fields;
   keys/immutable fields are not overwritten.
6. Reuse bulk record/byte/window bounds, outcome aggregation, source cleanup,
   awaited sinks, cancellation, session routing, and no-write-retry policy.
7. Validate duplicate keys within each batch before dispatch. Keep bounded
   per-batch detection, not a million-key global set; cross-batch repeats rely
   on actual unique indexes and idempotent upserts.
8. Parallel updateExisting requires explicit caller guarantee of source key
   uniqueness; otherwise require concurrency 1. Report native concurrent upsert
   duplicate-key races, do not blindly retry or claim insertion.
9. Dry-run uses the same preparation/index checks and emits bounded planned
   operations/counts without writing. It cannot predict native race/server/
   persistence-middleware errors or accurate inserted-versus-existing totals.
10. Do not present explicit validation as save middleware. Document/test
    validate/bulkWrite behavior on both peers and default execution during
    preparation; never promise save hooks.
11. Hooks run once for the seed job and per batch for reports; internal bulk
    dispatch does not duplicate job success/completion hooks.

## Validation and exit criteria

- Tests cover bad keys/operators, cast values, defaults/required/custom validation,
  immutable fields, strictness, proper filters/updates, and indexed error location.
- Real tests cover absent/incompatible unique indexes, repeat seeds, unchanged
  existing documents, explicit updates, and concurrent unique-key races.
- Verify within-batch duplicate detection versus bounded cross-batch policy,
  updateExisting concurrency guarantee, and byte-budget enforcement.
- Dry-run asserts zero writes/collection mutations, preparation parity, sink
  behavior, and honest planned counts. Missing indexes reject even in dry-run.
- Cancel/source/sink failure leaves explicit partial state and no active jobs.
  Transaction/session behavior and middleware limits are tested on both majors.
- Public types/examples/docs and targeted quality/integration checks pass.

## Handoff

Provide seed preparation/index constraints, duplicate policy, dry-run contract,
native middleware evidence, and bounded accounting. Phase 09 validates seeds
alongside streaming, transactions, and shutdown under realistic failures.
