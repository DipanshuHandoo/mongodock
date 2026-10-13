# Phase 01: contracts and package foundation

Status: implemented locally; fixture acceptance blocked pending CI evidence.
Prerequisites: none.
Authority: [master plan](../mongodock-implementation-plan.md);
common rules: [phase index](README.md).

## Objective and boundary

Make the initialized package a dependable JavaScript/JSDoc foundation, finalize
the interfaces later phases share, and prove the test infrastructure before
database features are implemented. No CRUD engine, complete service factory,
bulk runtime, or publication in this phase.

## Files and deliverables

- package.json/package-lock.json: description/keywords, candidate Mongoose peer
  range, Mongoose dev dependency, async-slot-pool runtime dependency.
- boilerplate.config.json, tsconfig.json, tsconfig.build.json: checked JS source,
  strict declarations, Node-only ESM/CJS normal/minified builds and maps.
- src\types.js, src\errors.js, src\config.js, src\index.js: real shared contracts,
  validated defaults, intentional exports; no stub methods.
- test\config.test.js, test\errors.test.js, test\types\esm.mts/cjs.cts:
  shared error/default tests and actual exported declaration fixtures.
- scripts\test.mjs, scripts\build.mjs, scripts\check-package.mjs: adapt existing
  helpers; nested JS tests/declarations must be discovered correctly.
- scripts\test-integration.mjs and focused fixture helpers: owned replica set
  provisioning/cleanup. Add test:integration, with a real fixture smoke test.
- Focused foundation/runtime/config documentation and changeset.

Module paths are ownership guidance; extract helpers only with actual reuse.

## Implementation tasks

1. Inspect current instructions/status and initialized files. Do not rerun init
   or overwrite user metadata. Preserve scope, MIT, version, Node >=22.18.0,
   publish allowlist, Changesets, and manual release infrastructure.
2. Verify installed published async-slot-pool contracts: synchronous input only,
   retained outcomes, error conversion, callback behavior, bail, and timeout
   non-cancellation. Confirm actual ESM/CJS imports and public BSON access through
   both proposed Mongoose majors.
3. Record supported peer/runtime/server candidates. Candidate Mongoose peer range
   is ^8.24.5 || ^9.11.2; test minimum and latest patches before final support claims.
   Externalize peers/runtime dependencies. Do not add a separate BSON dependency.
4. Finalize method-specific object input/result types, wrapper/native options,
   branded control errors and causes, outcome enums, pagination/batch envelopes,
   retry precedence, native/batched bulk overloads, session facade, and hooks.
   Resolve any API uncertainty explicitly in the master, not silently in code.
5. Adopt the master's default/limit table and validate finite safe integers,
   unknown names, contradictory modes, invalid hooks, and conflicting URI/named
   connection configuration. Sensitive input must not leak into diagnostics.
6. Replace TS retry sample source/tests with checked JS foundation behavior.
   Remove obsolete retry-demo exports/docs/examples rather than retaining a
   generic unsafe write retry API. Do not promise domain features not yet built.
7. Generate declarations for both module formats. Adapt declaration copying to
   nested output modules, not only top-level .d.ts files. Check actual type
   resolution and forbid private source paths in public exports.
8. Provision digest-pinned MongoDB containers on Linux and checksum-verified
   native binaries on Windows. Choose supported exact 7.0/8.0 patches, random
   ports, unique replica-set names, loopback binding, primary polling, and
   owned data paths. Validate driver/server compatibility first.
9. Support explicitly opted-in MONGODOCK_TEST_URI for local isolated fixtures.
   Generate per-suite databases; cleanup only those names. Ensure early startup
   failure and interrupted test cleanup target only owned PIDs/container IDs.
10. Preserve all standard baseline commands. test/test:coverage remain unit/
    contract checks; integration is required infrastructure, never a no-op pass.
    Complete verify wiring progressively without claiming release readiness.

## Validation and exit criteria

- Run typecheck, lint, format:check, test:coverage, build, and test:package against
  the implemented foundation; assert dual imports and declaration resolution.
- Test defaults, boundary integers, redaction, causes, invalid config, and import
  without network/process side effects. Assert no singleton state.
- Run fixture smoke tests for ping, primary/replica-set identity, independent
  database setup, and cleanup on success/failure. Both platform fixture routes
  must be verified in CI before claiming cross-platform readiness.
- Published slot-pool behavior is evidenced, not inferred from main-branch docs.
- No browser fields/builds, sample retry exports, missing declaration imports,
  weakened quality gates, or npm package source leakage.
- Required infrastructure unavailable: phase remains blocked for its fixture
  acceptance, even if unit/build checks pass.

## Handoff

Provide finalized contracts/defaults, actual dependency versions and fixture
pins/checksums, supported BSON/public API findings, and command results.
Phase 02 consumes validated config/errors/types and working integration fixtures.

## Implementation evidence

Checked JavaScript replaces the retry boilerplate. Configuration snapshots
plain nested option containers while preserving opaque native identities.
Defaults, retry intent, batch-mode validation, safe diagnostics, shared JSDoc
contracts, and future method contracts are implemented/documented without
exporting an executable service stub. Normal/minified ESM/CJS builds include
declarations and maps; original coverage and package-size gates remain intact.

The published async-slot-pool 1.0.1 behavior is covered directly. Its retained
items/results, stringified errors, swallowed progress-hook failures,
non-cancelling timeouts, and missing iterator cleanup on bail require the
bounded-window bridge specified for Phase 06; no bulk engine is added here.

| Command / environment | Result |
| --- | --- |
| `npm run verify --silent`, Windows, Node 24.16.0, Mongoose 9.11.2 | Passed: clean, typecheck, lint, format, coverage, real integration, build, both-peer installed tarball checks and examples |
| Foundation unit/contract coverage in that run | 19 tests; 100% lines, 96.58% branches, 95.65% functions; no skipped tests |
| Installed tarball consumers, Mongoose 8.24.5 and 9.11.2 | Both passed ESM/CJS/minified runtime imports, public BSON/dependency contracts, NodeNext types, publint, Are the Types Wrong, and examples |
| `npm exec --yes --package=node@22.18.0 --call "node scripts\test.mjs --coverage"` | Passed at the minimum supported Node runtime |
| `MONGODOCK_TEST_MONGO_VERSION=7.0` with `npm exec --yes --package=node@22.18.0 --call "node scripts\test-integration.mjs"` | Passed Windows native MongoDB 7.0.26 replica-set ping/primary, database isolation, rollback, and owned cleanup |
| Default real integration in complete verify | Passed Windows native MongoDB 8.0.17 with Mongoose 9.11.2 |
| Final package size | 32 files; approximately 26.9 kB packed / 150.9 kB unpacked, within unchanged budgets |

Linux Docker provisioning is implemented with digest pins, loopback publication,
explicit container ownership, and startup-failure cleanup. It has not been
executed locally because the Linux Docker daemon is unavailable. The repository's
workflow configuration covers both platforms, Node 22/24, and both Mongoose
peers, but that workflow has not been run for these uncommitted changes.
Cross-platform readiness therefore remains unclaimed, and this phase must not
be marked fully accepted until CI fixture evidence is available. The MongoDB
7.0 route has local Windows evidence; CI currently exercises the default 8.0
route. No commit, push, publication, or later-phase implementation was performed.

Additional local unblock attempts confirmed that neither the `desktop-linux`
nor `default` Docker context exposes a running daemon. `docker desktop start`
reported already running, but `docker desktop status` and engine listing could
not reach the backend API pipe. Ubuntu WSL reports Docker integration disabled.
No Docker settings were changed, shared processes terminated, or commits/pushes
made to trigger CI. A working Linux Docker runtime or authorized CI execution
is still required; user input was unavailable when requesting that decision.
