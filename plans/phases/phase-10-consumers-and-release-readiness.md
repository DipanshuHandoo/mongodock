# Phase 10: consumer experience and release readiness

Status: implemented locally (docs, examples, tarball checks, audit; verify passes). Publishing not performed; consumer adoption and external controls outstanding. Prerequisite: Phase 09.
Authority: [master plan](../mongodock-implementation-plan.md);
common rules: [phase index](README.md).

## Objective and boundary

Complete end-to-end consumer documentation/examples, validate the installed
artifact, and ensure CI/manual release gates verify the exact package.
Readiness is not authorization to commit, push, publish, or configure accounts.

## Files and deliverables

- README.md, docs\README.md and focused guides/API/error/troubleshooting/migration.
- examples\README.md/basic.mjs/full-tour.mjs and all feature examples.
- test\types fixtures, scripts\check-package.mjs/build.mjs/verify.mjs/release.mjs.
- .github\workflows\ci.yml/release.yml and maintenance/security/support guides.
- Accurate package metadata, changelog/changeset, published allowlist and maps.

## Implementation tasks

1. Reconcile every documented feature/default/result/error with actual exports
   and Phase 09 evidence. Remove all retry sample boilerplate and unsupported
   production-proven assertions. Record peer/runtime/server requirements.
2. README shows minimal explicit connection/schema setup, CommonJS usage, named
   databases, resource ownership, and links to advanced guides. No optional
   logger/plugin/retry/bulk setting should appear mandatory.
3. Complete migration guidance from the copied service: factory instead of
   singleton, configuration instead of app getConfig, connection/session routing,
   object arguments, bounded findAll, update defaults, mutation guards, and errors.
4. Run public-export examples for CRUD, both pages, cursor/batch traversal,
   count drift, stream export/read-to-bulk, native/batched/partial/cancel writes,
   plugins/hooks/retry activation/disable, transactions, health, seeds/dry-run.
   Full-tour assertions cover meaningful outputs, not merely process exit.
5. Examples use owned isolated fixtures; separate input/config/orchestration where
   warranted. No secrets/live third-party account requirement. Preserve source
   examples in repo and exclude them from published artifacts.
6. Pack a real tarball, install into isolated consumers with explicit peers,
   and run examples against the installed package. Verify ESM/CJS/minified entries,
   all supported exports, and both module-mode TS declarations on both peers.
7. Use publint/Are the Types Wrong. Check maps for absolute local paths, nested
   declaration imports, externals, valid conditions, no source/test/credential/
   planning artifacts, required license/docs/changelog, and current size gates.
   A justified budget change requires discussion, not automatic relaxation.
8. Final verify order: clean, typecheck, lint, format:check, coverage, integration,
   build, packed consumers/examples. CI additionally requires scale evidence
   for the exact commit, plus Windows/Linux runtime/peer integration matrix.
9. Preserve SHA-pinned actions/read-only defaults, reproducible npm ci, separate
   CI/release workflows, immutable exact-artifact publication, and serialization.
   No merge/tag automatic release or local publish shortcut.
10. Inspect manual release preflight: version/lockfile/changelog alignment,
    successful exact-commit CI, registry lookup errors versus not-found, artifact
    integrity, stable/prerelease tags, trusted publishing/provenance, post-publish
    metadata verification, and no blind republish after partial success.
11. Report external prerequisites: scope permission, npm publisher binding,
    protected npm environment with real reviewer approval, and explicit release
    authorization. YAML alone cannot establish those controls.
12. Include consumer migration evidence before claiming production-proven stability.
    With no authorized consuming app, report that adoption gate as outstanding,
    not permission to edit another repository.

## Validation and exit criteria

- npm run verify, test:scale, pack:check, and applicable publication dry-run
  complete with exact results; dry-run must not publish. Audit actual installed
  dependency risk/license metadata without claiming guaranteed future safety.
- All examples and TS/ESM/CJS consumers use the installed tarball and supported
  peers; no source import bypass. Contents/maps/size/defaults match claims.
- Required CI matrix and exact-commit scale/integration gates are green or
  explicitly reported pending; no readiness claim while required evidence lacks.
- All requested capabilities are implemented, documented, and verified.
  Remaining external/adoption gates are separately identified.
- Publishing still requires explicit user authorization; no tags/commits/pushes
  or account changes happen as a side effect of completing this phase.

## Handoff

Provide artifact identity/version, supported matrix, validation evidence,
consumer migration status, and external release checklist. This is the final
implementation-readiness report, not an automatic release action.
