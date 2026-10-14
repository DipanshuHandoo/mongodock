# Configuration

Normalization copies and freezes plain objects and arrays, including nested
connection options. Opaque native handles and driver instances keep their
identity and are not frozen.

`normalizeConfig(config)` accepts either `uri` plus native Mongoose `options`,
or `connections` with named `{ uri, options }` definitions. Named configs need
`defaultConnection` unless a connection is called `default`.
`requiredConnections` defaults to every configured name.

A caller-owned Mongoose Connection can be passed as `{ connection }` within
named configuration. It must explicitly disable `bufferCommands`; it cannot
also specify URI/options and will not be closed by default. Normalization
checks public capability shapes; the service never closes a caller-owned connection.

Wrapper options are allowlisted. Native Mongoose options pass through; owned
connections always set `bufferCommands: false`. Errors avoid echoing URI values.
URIs/options/native handles are sensitive and should not be logged.

## Limits

| Key | Default | Boundary |
| --- | --- | --- |
| readLimit / maxReadLimit / pageLimit | 100 / 1,000 / 20 | Positive safe integers; defaults <= maximum |
| batchSize | 500 | 1..10,000 |
| concurrency | 2 | 1..32 |
| maxBatchBytes | 8 MiB | Positive safe integer |
| diagnosticSamples | 100 | 0..1,000 |
| maxDiagnosticBytes | 64 KiB | Positive safe integer |
| hookTimeoutMS / drainTimeoutMS / probeTimeoutMS | 5,000 / 30,000 / 5,000 | Positive safe integers |

Zero, NaN, infinity, fractions, strings, and unsafe integers
are rejected where outside the listed range.

## Hooks and plugins

`hooks` accepts functions with the names in exported `HOOK_NAMES`.
`plugins` is an array of unique `{ name, hooks }` registrations. Names are
1..64 ASCII letters/digits/underscores/hyphens, starting with a letter.
Registrations are copied/frozen. See [Hooks](hooks.md) and [Plugins](plugins.md).

## Retry

`normalizeRetry(setting?, hasBeforeRetry?)` normalizes one effective setting.
Normalization itself never retries. Defaults: disabled; when enabled, 2 retries,
100 ms base delay, 1,000 ms maximum delay, 10,000 ms admission budget.
`retry: true` or an object enables the profile. With absent retry settings,
`beforeRetry` in service/plugin hooks enables it. `false` or `maxRetries: 0`
disables it. Maximum configured retries: 10; base delay cannot exceed maximum.

Per-call inheritance and eligible read/error classification belong to the executor; see
[Retries](retries.md). `retrySource` records inferred/configured/disabled intent so inheritance
can distinguish default-off from an explicit service disable.

## Batch controls

`normalizeBatchOptions(options?)` preserves native mode unless batching=true.
Native mode rejects batchSize/concurrency/maxBatchBytes/failureMode controls.
Batched defaults are 500 records, 2 slots, 8 MiB, unordered, continue.
Ordered batched input requires concurrency=1 and failureMode=stop explicitly.
This validator does not consume operations or execute a bulk write; see [Bulk processing](bulk-processing.md).
