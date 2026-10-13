# Phase 01: contracts and package foundation

Status: planned. Prerequisites: none.
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
