# API reference: Phase 1

All APIs below are available from the root export in ESM and CommonJS.
Private source imports are unsupported.

| Export | Contract |
| --- | --- |
| normalizeConfig(config) | Validates and freezes normalized wrapper configuration; no network I/O |
| normalizeRetry(setting?, hasBeforeRetry?) | Validates a single effective retry policy; no retry execution |
| normalizeBatchOptions(options?) | Validates native versus batched controls; no input consumption or writes |
| DEFAULTS | Frozen default limit values |
| HOOK_NAMES | Frozen supported registration names |
| MongoDockError | Control error with code, cause, and database/invocation outcomes |
| ConfigurationError | Invalid setup, ERR_CONFIGURATION |
| InvalidOptionError | Invalid operation option, ERR_INVALID_OPTION |
| isMongoDockError(value) | Instance type guard for package control errors |
| toSafeDiagnostic(error) | Frozen diagnostic excluding messages, documents, URIs and causes |

Root declarations include config, normalized config, hooks, plugins, retry
settings, operation context, bulk report, batch/seed options, error/outcome types.
Generic FindInput/CreateInput/MutationInput/BulkInput and page/envelope types
describe future input contracts without exporting runtime methods. No declaration claims an executable
factory or operation exists before its feature phase.

Native causes are preserved and sensitive; safe diagnostics are intentionally
minimal. See [Errors](errors-and-messages.md) and [Configuration](configuration.md).

## Transactions and health

| Export | Contract |
| --- | --- |
| TransactionError | Transaction scope misuse or commit/abort failure, ERR_TRANSACTION |
| service.withTransaction(fn, options?) / use(name).withTransaction | Runs fn with tx = {session, ops, attempt, transactionId, signal}; see [Transactions](transactions.md) |
| service.healthCheck(options?) | Aggregate readiness across connections; see [Health](health.md) |
| use(name).healthCheck(options?) | Per-connection status and ping probe |

