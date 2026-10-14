# Queries and writes

Every method takes one plain object and returns a promise. `model` is a registered
model name or a `Model` created on the same connection. Methods exist on the service
(default connection) and on `service.use(name)`.

| Method | Result |
| --- | --- |
| `find` / `findAll` | array; bounded by `limit` (default `limits.readLimit`, max `limits.maxReadLimit`) |
| `findOne` / `findById` | document or `null` |
| `exists` | `boolean` |
| `countDocuments` | `number` |
| `create` / `insertMany` | document / documents |
| `updateOne` / `updateMany` | Mongoose update result |
| `deleteOne` / `deleteMany` | `{ deletedCount }` |
| `findOneAndUpdate` / `findByIdAndUpdate` | document (post-update by default) or `null` |
| `findOneAndDelete` / `findByIdAndDelete` | deleted document or `null` |
| `aggregate` | materialized array |

Reads accept `filter`, `projection`, `sort`, `populate` (max 5 paths, depth 2), `lean`,
`limit`, `skip` and native `options`. Results are hydrated documents unless `lean: true`.
Unbounded reads are rejected: use `limit` within the configured maximum. Large scans
belong to `iterate`, `iterateBatches`, `paginateCursor` and batched `bulkWrite`; see [Pagination and streaming](pagination.md).

## Safety rules

- Filters must not contain `undefined`; ids must be scalars, never query objects.
- `updateMany`, `deleteMany` and other mutation filters that are empty (including
  `{ $and: [{}] }` or `$or` with an empty branch) are rejected unless `allowAll: true`.
- `aggregate` rejects `$out` and `$merge` (also inside `$lookup`, `$facet`, `$unionWith`)
  unless `allowWriteStages: true`. Memory use of the materialized result is caller-owned.
- Update validators run by default. Return semantics: `new`, `returnDocument` and
  `returnOriginal` are collapsed into `returnDocument` (default `after`); contradictory
  values throw.
- Wrapper-owned keys (`limit`, `sort`, `lean`, ...) cannot be passed inside native `options`.
- Input produced by `beforeOperation` hooks is validated again before dispatch, and hooks
  cannot swap the session or enable `allowAll` / `allowWriteStages`.

## Retry and cancellation

Only reads retry, using the configured transient-error policy. Writes, aggregates and any
call with `options.session` never retry. `signal` cancels before dispatch and between
retries, not an in-flight driver call.

Indexes are not built automatically (`autoIndex` is off); call `model.createIndexes()` or
`syncIndexes()` yourself. Declarations are checked against both supported Mongoose majors by `npm run test:package`.
