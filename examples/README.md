# Examples

Offline examples that import the public package name and assert real outputs. They need no database.
`npm run test:package` packs the library, installs it into an isolated consumer, and runs every
`*.mjs` here on both supported Mongoose majors. Examples stay in the repository and are not published.

| File | Shows |
| --- | --- |
| `basic.mjs` | Minimal service creation and registration without opening a connection |
| `full-tour.mjs` | Named connections, model registry, hook/plugin/retry configuration, errors and safe diagnostics |
| `connections.mjs`, `crud.mjs`, `pagination.mjs` | Lifecycle, CRUD surface and validation, paging and streaming surface |
| `bulk.mjs`, `seeding.mjs` | Bulk/seed input validation and dry-run planning |
| `transactions.mjs`, `health.mjs`, `hooks.mjs` | Transaction scope rules, health shape, hook pipeline |

For a real-database walkthrough against your own server, run `npm run demo:live` (it uses temporary
`mongodock_test_*` databases and offers to delete them). See [docs/testing.md](../docs/testing.md).
