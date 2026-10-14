# Mongodock execution phases

Status: Phase 10 readiness reported locally (not published; consumer adoption and CI matrix open); Phase 09 implemented locally (CI matrix and network-drop fault injection open); Phase 08 implemented locally (verify passes); Phase 07 implemented locally; Phase 06 implemented locally; Phase 05 implemented locally; Phase 04 implemented locally; Phase 03 implemented locally; Phase 02 implemented locally; Phase 01 completed for local delivery; the user deferred Docker/
cross-platform acceptance on 2026-10-13. Phases 09-10 remain planned. Creating these files
does not authorize later implementation, commit, push, or publication.
All requested features remain first-release scope.

The [master plan](../mongodock-implementation-plan.md) is the authoritative
product contract. These phase plans decompose execution, not redefine it.
If a contract changes, update the master and affected phase files together.
Future-roadmap features stay excluded unless explicitly approved.

## Phase index and dependencies

| Phase | Detailed plan | Prerequisites | Main deliverable |
| --- | --- | --- | --- |
| 01 | [Contracts and package foundation](phase-01-contracts-and-foundation.md) | None | JS/JSDoc baseline, API contracts, isolated replica-set fixtures |
| 02 | [Connections and model registry](phase-02-connections-and-models.md) | 01 | Named resources, lifecycle, ownership, model registration |
| 03 | [Plugins, hooks, and safe retries](phase-03-plugins-hooks-and-retries.md) | 02 | Reusable execution pipeline and retry policy |
| 04 | [CRUD and aggregation](phase-04-crud-and-aggregation.md) | 03 | Complete operations and mutation guards |
| 05 | [Pagination and streaming](phase-05-pagination-and-streaming.md) | 04 | Offset/keyset pages and bounded async iteration |
| 06 | [Slot-pooled bulk processing](phase-06-slot-pooled-bulk.md) | 04 | Native/batched writes, bounded outcomes, cancellation |
| 07 | [Transactions and health](phase-07-transactions-and-health.md) | 04 | Scoped transaction facade and readiness probes |
| 08 | [Idempotent seeding](phase-08-idempotent-seeding.md) | 06; 07 for session integration | Unique-key seed preparation, upsert, dry-run |
| 09 | [Reliability, compatibility, and scale](phase-09-reliability-and-scale.md) | 05, 06, 07, 08 | Cross-feature integration and measured scale evidence |
| 10 | [Consumer experience and release readiness](phase-10-consumers-and-release-readiness.md) | 09 | Complete guides/examples, packed consumers, CI/release gates |

05, 06, and 07 have no dependency on each other's internal implementation.
They share public pipeline/session contracts from earlier phases. Sequential
execution in numeric order is the simplest default; no fleet or parallel agent
execution is implied. Integrate shared surfaces before accepting each phase.

## Common execution rules

- Reread the master, current phase, repository instructions, and touched files.
  Preserve unrelated/user-owned changes. Report conflicting changes.
- Implement functional modules with checked JavaScript/JSDoc and intentional
  public exports. Do not create empty placeholders or speculative abstractions.
- Add targeted tests, declaration fixtures, focused docs, and runnable examples
  with each feature. Later phases complete cross-feature coverage, not first tests.
- Use existing Node test/Biome/TypeScript/esbuild tools. Required runtime addition
  is async-slot-pool; Mongoose is an external peer and development dependency.
  New dependencies beyond these require discussion.
- Coverage gates remain 90% lines, 80% branches, 85% functions for library source.
  Do not lower gates, hide unfinished functionality, or claim a skipped check ran.
- MongoDB fixtures must be isolated, explicitly owned, and finally-cleaned.
  Never use application credentials or drop an arbitrary database.
- Intermediate phases may have only part of the public surface. Document that
  boundary honestly; do not add no-op methods or advertise unimplemented features.
- Validation commands below describe future implementation gates, not results
  already achieved. Run targeted checks during work and the applicable full
  gate at phase exit. Report unavailable infrastructure as a blocker.
- Each handoff records actual changed files, finalized contracts, commands/results,
  remaining blockers, and prerequisites satisfied. Tracking stays in session SQL;
  do not add markdown completion checkboxes.
- No commits, pushes, publishing, account changes, or releases without explicit
  authorization. Phase 10 establishes readiness, not permission to publish.

## Coverage map

| Master contract | Owning phases |
| --- | --- |
| API shapes, defaults, limits, BSON support, peer/runtime policy | 01; all feature phases validate their contract |
| Named databases, model registration, admission, drain, buffering | 02; 05/06/07 integrate resource tracking |
| Plugins, hooks, outcome lifecycle, hook timeout, read retry precedence | 03; 04/05/06/07/08 wire behavior |
| Reads, creates, updates, deletes, exists, count, aggregates, guardrails | 04 |
| Projection, counts, pagination, cursor identity, backpressure | 05 |
| Batching flag, byte limits, pool bridge, partial/uncertain outcomes | 06 |
| Session ownership, callback replay, readiness, lifecycle observability | 02/03/07 |
| Seed keys, indexes, defaults/validation, duplicates, dry-run | 08 |
| Million-item bounds, failures, cleanup, peer/server matrix | 09; targeted tests start earlier |
| Docs, migration, examples, artifacts, CI, immutable manual release | 10; focused docs/examples start earlier |

The master plan's deliberate exclusions and retained future roadmap are not
unassigned implementation work. They remain outside these phases.
