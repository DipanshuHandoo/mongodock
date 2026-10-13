# Phase 02: connections and model registry

Status: implemented locally (uncommitted); Linux/Docker acceptance deferred by the user. Prerequisite: Phase 01.
Authority: [master plan](../mongodock-implementation-plan.md);
common rules: [phase index](README.md).

## Objective and boundary

Implement instance-owned named connections, explicit ownership, model routing,
and resource admission/drain primitives. Do not implement CRUD or a competing
driver reconnection loop. Later phases register their active work/cursors with
this resource tracker rather than duplicating shutdown logic.

## Files and deliverables

- src\create-mongo-service.js: compositional factory and db.use(name) views.
- src\connections\manager.js/status.js: lifecycle, ready-state reporting,
  operation admission, resource tracking, drain.
- src\models\registry.js: schemas/models, collisions, connection-safe lookup.
- Shared types/config/errors/index exports updated for implemented surfaces.
- Connection/model unit and integration tests; type fixtures.
- docs\connections.md, docs\models.md, minimal/multi-database examples.

## Implementation tasks

1. Support single uri or named connection config plus explicit default selection.
   Reject conflicts/unknown names. Bound views route without mutating a global
   current connection and do not connect automatically.
2. Use owned mongoose.createConnection resources, not global connect/models.
   Instantiate resources without opening network connections on import.
3. Implement connect, connectAll, disconnect, disconnectAll, getConnection,
   isConnected, getStatus, use. Define connectAll partial-open errors and retain
   per-connection outcomes; never report universal success after partial failure.
4. Deduplicate opens, serialize open/close races, support failed-open recovery,
   and reopen only after close completes. Mirror current Mongoose events and
   readyState through idle/connecting/ready/closing/closed/failed lifecycle.
5. Disable hidden command buffering. Explicit caller-owned connections must
   satisfy the same requirement; retain ownership and avoid closing them by
   default. Never remove another owner's listeners.
6. Expose private admission/resource-registration primitives for ordinary calls,
   transactions, jobs, and iterators. Only ready connections admit operations.
   Closing rejects new work and prevents additional batch dispatch.
7. Implement connection-specific/all-instance drain with default 30,000 ms budget.
   Stop tracked scheduling, close idle owned cursors, settle in-flight work, and
   finally remove owned listeners/close owned connections.
8. Expired drains report ShutdownTimeoutError with unresolved/uncertain work;
   remain closing rather than close underneath writes. Later disconnect can
   await the same tracked work with a fresh budget. No automatic force close.
9. Register schema definitions before connect; preserve collection/model options.
   Same registration is idempotent; conflicting name/schema/collection rejects.
   Existing Model inputs must belong to the selected connection.
10. Implement registerModel/registerModels/getModel/hasModel/listModels/
    unregisterModel. Prevalidate bulk registration conflicts before changes where
    feasible; document partial creation if native compilation fails. Unregister
    removes registry membership, never database collections/indexes.
11. Define lifecycle event payload delivery through the observer interface from
    Phase 01; Phase 03 owns hook dispatch. No unconditional console logging,
    process signal installation, automatic indexing, or global session ownership.

## Validation and exit criteria

- Two databases can use the same model name/schema with isolated documents,
  connections, registries, and bound views.
- Unit tests cover concurrent opens/closes, failed-open retry, reconnect events,
  unknown connection/model, collision, readiness, idempotent close/reopen.
- Ownership tests prove external connections/listeners remain intact, unregistration
  does not delete native resources, and defaults never select another database.
- Use controlled pending tasks/cursors to test drain admission, deadline, later
  drain completion, and per-connection failure reporting.
- Real replica-set tests cover open/disconnect/recovery and caller-owned resources;
  declaration fixtures preserve model types or document string-lookup limitations.
- Run applicable unit/integration, type, lint, format, and build checks; add docs
  and runnable connection/model examples through public exports.

## Handoff

Document lifecycle transitions, ownership checks, named config shape, and the
private operation/cursor tracker contract. Phase 03 composes the execution
pipeline; later phases must use these primitives for cleanup/admission.

## Evidence (local, Windows, Node 24.16.0)

- npm run verify passes (Mongoose 8.24.5 and 9.11.2 consumers); coverage 99.3% lines, 95.9% branches, 91.9% functions.
- Real-server checks (local standalone server and replica-set fixture): two-database isolation, close/reopen, failed open (a late driver 'error' event requires listeners to stay attached, so they do), caller-owned connection left open.
- Deviation: size budgets raised from 40/160 to 80/400 kB packed/unpacked (was 55.7/291 kB); chosen autonomously, needs user review.
- Deferred: connection event hooks use a simple sequential notifier; Phase 3 replaces it with the full hook pipeline.
