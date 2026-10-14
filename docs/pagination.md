# Pagination and streaming

All methods take `model` (name or model object) plus the common call options
(`signal`, `correlationId`, `hooks`, `retry`, `metadata`).

## `paginate` (offset)

```js
const page = await db.paginate({ model: "User", filter, sort: { createdAt: -1 }, page: 3, limit: 20, lean: true });
// { docs, totalDocs, limit, page, totalPages, hasNextPage, hasPrevPage, nextPage, prevPage }
```

- Defaults: `page: 1`, `limit: 20` (at most `limits.maxReadLimit`), `includeTotal: true`.
- Sorting always ends with an `_id` tie-breaker so pages are deterministic.
- The count and the page run in parallel, or sequentially when the session is in a transaction.
- `includeTotal: false` skips the count; `totalDocs`/`totalPages` are `null` and
  `hasNextPage` comes from reading `limit + 1`.
- Counts and page reads are not a snapshot: concurrent writes can shift pages. Retries re-run the whole page.
- Deep offsets cost O(skip); prefer `paginateCursor` for large collections.

## `paginateCursor` (keyset)

```js
let cursor;
do {
  const page = await db.paginateCursor({ model: "Event", sort: { at: -1 }, limit: 100, cursor, lean: true });
  // { docs, limit, hasNextPage, nextCursor }
  cursor = page.nextCursor ?? undefined;
} while (cursor);
```

- Sort keys must be indexed by you; `_id` is appended as the unique tie-breaker and may only be last.
- Supported key types, consistent across the collection: ObjectId, Date, string, finite number, boolean.
  Null, missing, array and other BSON values are rejected. Only the simple collation is supported.
- The token is versioned base64url JSON, at most 8192 characters, bound to the connection, model, sort, a
  digest of the filter and the collation. A token used with a different query is rejected.
  Tokens are **not signed or authorization credentials**; never trust them for access control.
- Sort keys missing from your projection are fetched and removed again. This is only possible with
  `lean: true`; hydrated documents with hidden sort keys are rejected. Mixed or expression projections are rejected.
- `afterOperation` hooks may replace `docs` only; paging metadata is restored.

## Streaming

Stream methods return an `AsyncGenerator` **synchronously**. Input is validated at call time (invalid input
throws immediately); the database is first touched on the first `next()`. Breaking out of `for await`
closes the driver cursor, and `signal` abort ends the stream with `OperationAbortedError`.
Streams are not retried (no safe resume point) and provide no resume token for the `cursor` strategy.

```js
for await (const doc of db.iterate({ model: "Order", filter, lean: true, batchSize: 500 })) { /* ... */ }
for await (const batch of db.iterateBatches({ model: "Order", batchSize: 1000, includeTotal: true })) {
  // { docs, batchIndex, processed, totalDocs, nextCursor }
}
for await (const row of db.aggregateCursor({ model: "Order", pipeline })) { /* ... */ }
```

- `batchSize` defaults to 500, maximum 10,000. Memory is bounded by the driver batch plus one batch of yielded
  documents, but there is no hard RSS cap: native read buffers and `populate` can use more.
- `iterateBatches` strategies: `cursor` (default, one server cursor, `nextCursor: null`) or `keyset`
  (repeated keyset pages, each with a `nextCursor` you could persist). Empty batches are never yielded.
- `includeTotal: true` counts first on the final filter and session; a count failure rejects the stream.
  The total is advisory (not a snapshot).
- `aggregateCursor` applies the `aggregate` write-stage guard and forbids the `cursor` and `pipeline` options.
- Backpressure: the source is pulled only as fast as the consumer asks.

Use these with `bulk` slot pools in a later phase to process batches in parallel.
