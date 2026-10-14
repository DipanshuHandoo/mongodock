# Migrating from a singleton Mongo service

For code that wraps Mongoose in a module-level singleton (a `mongo.service.js` that reads app
configuration, connects once, and exposes positional-argument helpers). The mapping is mostly
mechanical.

| Singleton pattern | mongodock |
| --- | --- |
| Exported singleton instance created at import time | `createMongoService(config)` returns an instance; create it once in your composition root and pass it around |
| Service reads the app's `getConfig()` | Pass plain configuration: `{ uri, options }` or `{ connections, defaultConnection }`. The package never reads your app config or environment |
| Global `mongoose.connect()` and `mongoose.model()` | Owned connections (`mongoose.createConnection`); models are registered per connection with `registerModel` |
| Several databases through ad hoc connection objects | `connections: { name: { uri } }` plus `db.use(name)`; the same schema can back different databases |
| Positional arguments, e.g. `find(model, filter, projection, options)` | One object: `find({ model, filter, projection, sort, limit, lean, options })` |
| `findAll` loading a whole collection | `findAll` is bounded by `limit`. For full scans use `iterateBatches` / `iterate` (streaming) or `paginateCursor`, and `bulkWrite` with `batching: true` for processing |
| Silent update defaults | Update validators on, `returnDocument: "after"`; contradictory `new`/`returnDocument`/`returnOriginal` throws |
| Empty-filter `updateMany`/`deleteMany` | Rejected unless `allowAll: true` |
| Session passed in options by hand | `withTransaction(async (tx) => { await tx.ops.create(...) })`; `tx.ops` is pinned to the session |
| Thrown native errors only | Control failures are `MongoDockError` subclasses with `code`, `cause`, `databaseOutcome` and `invocationOutcome`; native database errors keep their original shape |

## Suggested order

1. Create the service from plain configuration and register your existing schemas.
2. Replace helper calls one module at a time, converting positional arguments to objects.
3. Replace unbounded `findAll` usages: add a `limit`, or move the job to `iterateBatches`/`bulkWrite`.
4. Replace hand-rolled session code with `withTransaction`.
5. Call `disconnectAll()` from your shutdown path.
6. Optionally move cross-cutting logging, tracing and retries into `hooks` or `plugins`.

## Behavior to re-check

- Hydrated documents are returned unless `lean: true`.
- Indexes are not built automatically; call `model.createIndexes()` or `syncIndexes()` yourself.
- Only reads retry, and only when retries are enabled (`retry` or a `beforeRetry` hook). Writes never retry.
- Cursor tokens from `paginateCursor` are bound to the query and sort that produced them.

This guide describes the mapping only. No consuming application has migrated yet, so treat production
stability as unproven until a real adoption run is complete.
