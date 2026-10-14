# @dipanshuhandoo/mongodock

Functional Mongoose service toolkit for Node.js: owned multi-database connections, a per-connection
model registry, bounded CRUD, offset and keyset pagination, streaming, transactions, slot-pooled bulk
writes, idempotent seeding, health checks, and a hook/plugin pipeline. No classes to extend and no
global state: you create a service, register schemas, and call methods with plain objects.

Status: pre-release (`0.0.0`), not yet published. See [Release readiness](#release-readiness).

## Requirements

- Node.js `>=22.18.0`
- `mongoose` `^8.24.5 || ^9.11.2` (peer dependency, installed by you)
- MongoDB 7.0 or 8.0. Transactions need a replica set; everything else works on a standalone server.
- Runtime dependency: `@dipanshuhandoo/async-slot-pool` (bounded parallel bulk windows)

## Quick start

```js
import mongoose from "mongoose";
import { createMongoService } from "@dipanshuhandoo/mongodock";

const db = createMongoService({ uri: process.env.MONGO_URI });

db.registerModel({
  name: "User",
  schema: new mongoose.Schema({ email: { type: String, required: true }, name: String }),
});

await db.connect();

await db.create({ model: "User", data: { email: "a@example.com", name: "Ada" } });
const user = await db.findOne({ model: "User", filter: { email: "a@example.com" }, lean: true });
const page = await db.paginate({ model: "User", page: 1, limit: 20, sort: { _id: 1 }, lean: true });

await db.disconnect();
```

CommonJS works the same way:

```js
const { createMongoService } = require("@dipanshuhandoo/mongodock");
```

Setup is explicit: nothing connects until you call `connect()`, nothing builds indexes
(`autoIndex` is off), and retries, plugins, hooks and bulk tuning are all opt-in.

## Multiple databases

```js
const db = createMongoService({
  connections: {
    primary: { uri: process.env.PRIMARY_URI },
    analytics: { uri: process.env.ANALYTICS_URI },
  },
  defaultConnection: "primary",
});
db.registerModel({ name: "User", schema: userSchema });
db.use("analytics").registerModel({ name: "Event", schema: eventSchema });
await db.connectAll();
await db.use("analytics").find({ model: "Event", limit: 50 });
```

The service owns the connections it creates (`mongoose.createConnection`, never the global
`mongoose.connect`). Pass `{ connection }` to supply a connection you own; it is never closed for you.
Call `disconnectAll()` on shutdown: it stops admission, drains in-flight work and closes owned connections.

## What is included

| Area | Methods |
| --- | --- |
| Reads | `find`, `findAll` (bounded), `findOne`, `findById`, `exists`, `countDocuments`, `aggregate` |
| Writes | `create`, `insertMany`, `updateOne`, `updateMany`, `deleteOne`, `deleteMany`, `findOneAndUpdate`, `findByIdAndUpdate`, `findOneAndDelete`, `findByIdAndDelete` |
| Pages and streams | `paginate`, `paginateCursor`, `iterate`, `iterateBatches`, `aggregateCursor` |
| Bulk and seeding | `bulkWrite` (native or batched), `seed` (dry-run, idempotent) |
| Lifecycle | `connect`, `connectAll`, `disconnect`, `disconnectAll`, `use`, `getStatus`, `healthCheck`, `withTransaction` |
| Models | `registerModel`, `registerModels`, `getModel`, `hasModel`, `listModels`, `unregisterModel` |
| Extension | `hooks`, `plugins`, `retry` |

Safety defaults worth knowing: reads are bounded (`findAll` never scans an unbounded collection),
`updateMany`/`deleteMany` with an empty filter need `allowAll: true`, `aggregate` rejects `$out`/`$merge`
unless `allowWriteStages: true`, update validators run by default, and writes are never retried.

## Large datasets

```js
for await (const batch of db.iterateBatches({ model: "Order", batchSize: 1000, lean: true })) {
  await process(batch.docs);
}

const report = await db.bulkWrite({
  model: "Order",
  operations: lazyOperations(), // array, Iterable or AsyncIterable
  batching: true,
  batchSize: 1000,
  concurrency: 4,
});
```

Batched bulk uses slot-pooled windows with bounded memory and returns a report that distinguishes
attempted, succeeded, failed and uncertain operations. See [Bulk processing](docs/bulk-processing.md).

## Guides

- [Getting started](docs/getting-started.md) and [Configuration](docs/configuration.md)
- [Connections](docs/connections.md) and [Models](docs/models.md)
- [Queries and writes](docs/queries.md), [Pagination and streaming](docs/pagination.md)
- [Bulk processing](docs/bulk-processing.md) and [Seeding](docs/seeding.md)
- [Transactions](docs/transactions.md) and [Health](docs/health.md)
- [Hooks](docs/hooks.md), [Plugins](docs/plugins.md) and [Retries](docs/retries.md)
- [API reference](docs/api-reference.md) and [Errors and diagnostics](docs/errors-and-messages.md)
- [Migrating from a singleton service](docs/migration.md)
- [Scale and reliability](docs/scale.md), [Testing](docs/testing.md) and [Troubleshooting](docs/troubleshooting.md)

Runnable offline examples are in [`examples/`](examples/README.md).

## Development

```sh
npm ci
npm run verify
```

`verify` runs clean, typecheck, lint, format check, coverage, integration tests, build, and the
packed-consumer checks. Integration tests start an isolated temporary replica set (Windows downloads
checksum-verified binaries; Linux uses Docker). See [Testing](docs/testing.md).

## Release readiness

Implemented and verified locally: every capability above. Still outstanding before a public
release: green GitHub CI on the full matrix, adoption in a real consuming application, and the
external release controls (npm scope permission, trusted-publisher binding, protected `npm`
environment). Publishing is manual through the `Release` workflow. See
[MAINTAINING.md](MAINTAINING.md).

## License

MIT. See [LICENSE](LICENSE). Contribution and release policy: [CONTRIBUTING.md](CONTRIBUTING.md),
[MAINTAINING.md](MAINTAINING.md), [SECURITY.md](SECURITY.md).
