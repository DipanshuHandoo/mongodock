# Testing and isolated fixtures

`test` and `test:coverage` run deterministic nested JavaScript tests, excluding
`test/integration`. `typecheck`, `lint`, `format:check`, `build`, and
`test:package` check source and installed consumers.

## Live demo against your own MongoDB

`npm run demo:live` runs a real tour (insert, count, paginate, update, aggregate,
transaction) against `MONGODOCK_URI` (default `mongodb://localhost:27017/mongodock`),
prints a count made by the native driver, then asks whether to keep the data in
the `demoitems` collection so you can inspect it in Compass or mongosh. Answer `N` or run
`npm run demo:live:cleanup` to drop it. Set `MONGODOCK_DEMO=keep` or `cleanup` to
skip the prompt. The transaction step is skipped on a standalone server. It only
touches that one collection and is not part of `verify`.

`test:integration` provisions a real single-node MongoDB replica set, runs fixture
smoke tests, and removes owned process/container/data resources in finally.
`verify` requires integration after coverage and before build/artifact checks.

- Windows: checksum-verified official zip, extracted into an owned temporary
  directory, native mongod on loopback, random port, unique replica-set name.
- Linux: exact-version/digest-pinned official MongoDB image in Docker; published
  port binds only 127.0.0.1. Requires a running daemon.
- Choose `MONGODOCK_TEST_MONGO_VERSION=7.0` or `8.0` (default).
- Tests generate unique `mongodock_test_...` database names and drop only those.
  No application database names are accepted as cleanup targets.

To use an existing **isolated test** replica set, explicitly set
`MONGODOCK_TEST_URI` and `MONGODOCK_TEST_ALLOW_EXTERNAL=1`. This grants test
operations on that deployment but never grants dropping the URI's database.
Do not point this at an application or production deployment.

Fixtures validate primary identity, ping, separate databases, and transaction
rollback. Missing binaries/network/Docker/replica-set support fail the required
gate. SIGINT/SIGTERM request test interruption and owned cleanup.

Against a **standalone** server (for example a local dev instance) the suite still
runs: tests that need a replica set (transactions, rollback fixture) detect the
topology and skip, everything else executes for real. Run both topologies:

```powershell
npm run test:integration                       # owned replica set, all tests
$env:MONGODOCK_TEST_URI = "mongodb://localhost:27017/mongodock"
$env:MONGODOCK_TEST_ALLOW_EXTERNAL = "1"
npm run test:integration                       # standalone: replica-set tests skip
```

Tests only create and drop their own `mongodock_test_...` databases, so other
databases on a shared dev server are untouched.

Cross-platform CI execution is required evidence before claiming both fixture
routes verified. A local Windows run cannot establish Linux readiness.
