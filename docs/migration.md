# Migrating from a singleton Mongo service

For code shaped like the `gwp-engg-boilerplate` `MongoService`: a module-level singleton that reads
`getConfig().mongodb`, calls `mongoose.connect()` once, keeps a `Map` of models, and exposes helpers
with positional arguments `(model, query, options)`. The mapping is mostly mechanical.

| Singleton service | mongodock |
| --- | --- |
| `new MongoService()` exported as a singleton | `createMongoService(config)`; create it once in your composition root and pass it around |
| `getConfig().mongodb` → `{ uri, options }` | Pass `{ uri, options }` or `{ connections, defaultConnection }` yourself; the package never reads app config or the environment |
| `mongoose.connect()` on the global connection | Owned connections (`mongoose.createConnection`); `connect()` / `connectAll()` |
| `isMongoConnected()` | `isConnected(name?)`, `getStatus(name?)`, `listStatuses()`, `healthCheck()` |
| `registerModel(name, model)` / `getModel(name)` / `unregisterModel(name)` | `registerModel` per connection; operations take `model: "Name"` and resolve it for you |
| `find(model, query, { select, sort, limit, skip, populate })` | `find({ model, filter, projection, sort, limit, skip, populate, lean })`; `select` becomes `projection`; default `limit` is 100 |
| `findOne(model, query, options)` / `findById(model, id, options)` | `findOne({ model, filter })` / `findById({ model, id })` |
| `findOneAndUpdate` / `findByIdAndUpdate` with `{ new: true }` default | Same names, object arguments; `returnDocument: "after"` is the default and update validators run |
| `findOneAndDelete`, `findByIdAndDelete`, `deleteOne` | Same names, object arguments |
| `deleteMany(model, query)` | `deleteMany({ model, filter })`; an empty filter is rejected unless `allowAll: true` |
| `create(model, data, options)` (`new Model(data).save()`) | `create({ model, data })`; use `insertMany({ model, data })` for several |
| `countDocuments`, `exists` (boolean), `aggregate` | Same names and shapes; `aggregate` pipelines are checked by safety guards |
| `paginate(model, query, { page, limit, sort, select, populate })` returning `{ docs, totalDocs, limit, page, totalPages, hasNextPage, hasPrevPage, nextPage, prevPage }` | `paginate({ model, filter, page, limit, sort, projection, populate })` returns the same fields; default `limit` is 20, capped by `limits.maxReadLimit`; sort gets an `_id` tie-breaker (default sort is not `createdAt: -1`) |
| `withTransaction(async (session) => ...)` | `withTransaction(async (tx) => ...)` with `tx.ops.<operation>(...)` pinned to the session and `tx.session` for raw access; commits, aborts and ends the session for you |
| `bulkWrite(model, operations, options)` | `bulkWrite({ model, operations })` native passthrough, or `batching: true` for slot-pooled batches |
| `console.error` then rethrow in every method | No logging inside the package; use `hooks` / `plugins` (`onError`, `onComplete`, ...). Control failures are `MongoDockError` subclasses |
| No streaming, no seeding, no health probe | `iterate`, `iterateBatches`, `paginateCursor`, `seed`, `healthCheck` |

Not in the original, so nothing to migrate: `findAll`, multi-database `use(name)`, hooks and plugins.
Use `findAll`, `iterateBatches` or `paginateCursor` instead of any unbounded `find`.
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

The mapping above was written from reading the original service's method list and behavior. No consuming application has migrated yet, so treat production
stability as unproven until a real adoption run is complete.
