# Transactions

```js
const result = await db.withTransaction(async (tx) => {
  const order = await tx.ops.create({ model: "Order", data: { sku: "a", qty: 2 } });
  await tx.ops.updateOne({ model: "Stock", filter: { sku: "a" }, update: { $inc: { qty: -2 } } });
  return order.id;
});
```

`withTransaction(callback, options?)` exists on the service (default connection) and on
`db.use(name)`. It uses Mongoose's `connection.transaction`, so documents created inside
roll their `isNew` state back on abort. It resolves with the callback's return value after the
commit, and always ends the session.

Transactions need a replica set or sharded cluster. A standalone server is rejected with a
`TransactionError` (`databaseOutcome: "notDispatched"`) that carries the driver error as `cause`.

## The callback context

| Field | Meaning |
| --- | --- |
| `tx.ops` | Every operation method, pinned to this transaction's session. |
| `tx.session` | The explicit native session, for APIs the package does not wrap. |
| `tx.attempt` | 1-based. Greater than 1 when the driver replays the callback. |
| `tx.transactionId` | Stable across attempts; also in scoped calls' `metadata`. |
| `tx.signal` | Aborts when the caller's `signal` aborts. |

Scoped calls inherit the transaction's `correlationId`, get `transactionId` and
`transactionAttempt` in `metadata`, and run through the normal hook pipeline. Their
`databaseOutcome` is `pendingCommit` until the transaction ends. Reads are never retried
inside a transaction and writes are never retried by the package.

## Rules

- **Sequential per transaction.** Await each call before the next; a second concurrent call
  rejects with `TransactionError`. Do not `Promise.all` inside one transaction. Independent
  transactions run concurrently.
- **No nesting.** `tx.ops.withTransaction` rejects. Pass `tx.ops` to helpers instead.
- **Bulk in a session** is forced to `concurrency: 1` and `failureMode: "stop"`.
- **Attempt scope.** A replayed callback gets a new `tx`; calls on a previous attempt's `ops`
  (or after the callback returned) reject with `TransactionError`.
- **Sessions are verified.** `options.session` passed to unscoped calls must come from the same
  connection and must not belong to an active `withTransaction`.
- **Cancellation** stops further scoped calls (`OperationAbortedError`). The transaction then
  follows native semantics: if your callback propagates the error it is aborted; the package
  never fabricates a commit or rollback.
- **Drain.** An active transaction counts as in-flight work, so `disconnect` waits for it
  (bounded by `limits.drainTimeoutMS`).

## Errors

The callback's own error is rethrown unchanged. Commit/abort failures become `TransactionError`
with `cause`; `databaseOutcome` is `uncertain` when the driver labels the commit result
`UnknownTransactionCommitResult` (verify the data before retrying), otherwise `failed`.

## Hooks

`beforeOperation`, `onSuccess`, `onError`, `onComplete` and `beforeError` see
`method: "withTransaction"` once per transaction, after commit or abort, never once per replay.

## Options

`transactionOptions` (native read/write concern), `signal`, `correlationId`, `hooks`,
`metadata`. Anything else is rejected.
