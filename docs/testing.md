# Testing and isolated fixtures

`test` and `test:coverage` run deterministic nested JavaScript tests, excluding
`test/integration`. `typecheck`, `lint`, `format:check`, `build`, and
`test:package` check source and installed consumers.

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

Cross-platform CI execution is required evidence before claiming both fixture
routes verified. A local Windows run cannot establish Linux readiness.
