# Changelog

Release notes are generated from changesets when the **Version Packages** PR is merged.
## 2.0.4

### Patch Changes

- 81c7f12: release fix

## 2.0.3

### Patch Changes

- 4289731: bypass release

## 2.0.2

### Patch Changes

- ebd7767: ci update

## 2.0.1

### Patch Changes

- c9c0a6a: github actions optimizations

## 2.0.0

### Major Changes

- 72a3fbf: Mongo Connection and Data Collection library

### Patch Changes

- 43f3103: docs update

## 1.0.0

### Major Changes

- bffba36: All 10 phases completed

### Patch Changes

- bffba36: Reconcile README and guides with the implemented API, add a migration guide, and replace the stale foundation-only examples.

## 0.2.0

### Minor Changes

- ee16956: Add idempotent `seed`: explicit unique-key upserts with real index verification, schema validation, within-batch duplicate rejection, `updateExisting`, no-write `dryRun`, and native or slot-pooled batched execution.
- 7cab102: Add `paginate`, `paginateCursor`, `iterate`, `iterateBatches` and `aggregateCursor`: bounded offset pages with totals, bound keyset cursors, and lazy cursor streams with deterministic cleanup.
- 63794d4: Add CRUD, existence, count and aggregation operations with bounded reads, mutation and pipeline safety guards, hook-validated input and read-only retry.
- 9b1b826: Add `withTransaction` (explicit session plus a scoped, sequential operations facade, replay-aware, rollback-safe) and `healthCheck` (bounded ping probe, status-only mode, required-connection aggregate), plus `TransactionError`.
- 7a10261: Add `bulkWrite` with native passthrough and slot-pooled batched mode (bounded memory, lazy sources, partial-failure reports, `onBatch`, cancellation) and `BulkError`.

### Patch Changes

- 125de85: Document scale and reliability evidence (`docs/scale.md`).
- 4aa7d65: Live Mongo DB testing

## 0.1.0

### Minor Changes

- 4fa0be9: Initial release.
- 363dd58: Replace the retry sample with checked JavaScript configuration and error
  contracts, Mongoose peer metadata, slot-pool verification, dual-format
  declarations, and isolated replica-set test fixtures. Database service features
  remain scheduled for subsequent phases.
- 5455e1e: Add the hook and plugin lifecycle engine, safe read retry policy, `HookError`, `OperationVetoError` and `OperationAbortedError`.
- c7423b5: Add createMongoService with multi-database connection management, status, graceful drain, and a per-connection model registry.
- c7423b5: Phase 2 connection

### Patch Changes

- 4fa0be9: initialize

## 0.1.0

### Minor Changes

- 60c115b: setup changelog and version update
