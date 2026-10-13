# Retries

Retries apply only to materialized reads: `find`, `findAll`, `findOne`, `findById`, `exists`,
`countDocuments`, `paginate`, `paginateCursor`. Writes, transactions and streams are never
retried, and nothing is retried after a post-write hook error.

Only transient failures retry, classified by driver error class
(`MongoServerSelectionError`, `MongoNetworkError`, `MongoNetworkTimeoutError`,
`MongoPoolClearedError`, `MongoNotConnectedError`, …) or numeric code (6, 7, 89, 91, 189, 9001,
10107, 11600, 11602, 13435, 13436). Message text is never inspected. Cancellation and `maxTimeMS`
expiry (code 50) never retry.

Defaults when enabled: 2 retries, 100 ms base, 1000 ms max, 10 s total budget (max 10 retries),
exponential backoff with full jitter.

## Enabling

- Service `retry` options, or any service/plugin `beforeRetry` hook, enable the policy.
- Per call: `retry: false` or `maxRetries: 0` disables; `retry: { … }` overrides and can enable a
  disabled service policy; a call-level `beforeRetry` enables the default profile unless retry was
  disabled explicitly on the service.
- `beforeRetry` returning `false` rethrows the last database error; a throwing hook yields
  `HookError` with `original`.
- Aborting `signal` during the wait cancels the operation (`OperationAbortedError`).
