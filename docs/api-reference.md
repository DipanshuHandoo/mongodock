# API reference

Everything is exported from the package root in ESM and CommonJS. Private source imports are
unsupported. Every operation takes one object argument and returns a promise (or an async generator for
streams). Methods exist on the service (default connection) and on `service.use(name)`.

## Factory

| Export | Contract |
| --- | --- |
| `createMongoService(config)` | Returns a service over owned (or supplied) Mongoose connections. Opens nothing until `connect`/`connectAll` |

## Service

| Group | Methods | Guide |
| --- | --- | --- |
| Lifecycle | `connect(name?)`, `connectAll()`, `disconnect(name?)`, `disconnectAll()`, `use(name)`, `getConnection(name?)`, `getStatus`, `listStatuses`, `listConnections`, `isConnected` | [Connections](connections.md) |
| Models | `registerModel`, `registerModels`, `getModel`, `hasModel`, `listModels`, `unregisterModel` | [Models](models.md) |
| Reads | `find`, `findAll`, `findOne`, `findById`, `exists`, `countDocuments`, `aggregate` | [Queries](queries.md) |
| Writes | `create`, `insertMany`, `updateOne`, `updateMany`, `deleteOne`, `deleteMany`, `findOneAndUpdate`, `findByIdAndUpdate`, `findOneAndDelete`, `findByIdAndDelete` | [Queries](queries.md) |
| Pages and streams | `paginate`, `paginateCursor`, `iterate`, `iterateBatches`, `aggregateCursor` | [Pagination](pagination.md) |
| Bulk and seed | `bulkWrite` (native or `batching: true`), `seed` (native, batched, dry-run) | [Bulk](bulk-processing.md), [Seeding](seeding.md) |
| Transactions | `withTransaction(fn, options?)`; `fn` receives `{ session, ops, attempt, transactionId, signal }` | [Transactions](transactions.md) |
| Health | `healthCheck(options?)` (aggregate) and `use(name).healthCheck(options?)` | [Health](health.md) |

## Helpers and constants

| Export | Contract |
| --- | --- |
| `normalizeConfig(config)` | Validates and freezes wrapper configuration; no network I/O. Retains URIs, so do not log the result |
| `normalizeRetry(setting?, hasBeforeRetry?)` | Validates one effective retry policy; no retry execution |
| `normalizeBatchOptions(options?)` | Validates native versus batched controls; no input consumption or writes |
| `DEFAULTS` | Frozen default limit values |
| `HOOK_NAMES` | Frozen supported hook names |
| `isMongoDockError(value)` | Type guard for package control errors |
| `toSafeDiagnostic(error)` | Frozen diagnostic with no messages, documents, URIs or causes |

## Errors

All extend `MongoDockError` (`code`, `cause`, `databaseOutcome`, `invocationOutcome`).

| Class | Code |
| --- | --- |
| `ConfigurationError` | `ERR_CONFIGURATION` |
| `InvalidOptionError` | `ERR_INVALID_OPTION` |
| `ConnectionError` | `ERR_CONNECTION` |
| `ModelRegistrationError` | `ERR_MODEL_REGISTRATION` |
| `OperationVetoError` | `ERR_OPERATION_VETO` |
| `OperationAbortedError` | `ERR_ABORTED` |
| `HookError` | `ERR_HOOK` |
| `ShutdownTimeoutError` | `ERR_SHUTDOWN_TIMEOUT` |
| `BulkError` | `ERR_BULK` |
| `TransactionError` | `ERR_TRANSACTION` |

Native database errors (validation, cast, duplicate key) keep their original shape and causes.
Causes are sensitive; use `toSafeDiagnostic` for logging. See [Errors](errors-and-messages.md).

## Types

Declarations ship for both module modes: `MongoService`, `ConnectionView`, `ConnectionStatus`,
`ModelDefinition`, `MongoServiceConfig`, `NormalizedConfig`, `Hooks`, `Plugin`, `RetryOptions`,
`OperationContext`, `BulkReport`, `BulkBatchOutcome`, `BatchOptions`, `NativeSeedInput`,
`BatchedSeedInput`, `SeedDryRunReport`, `TransactionContext`, `TransactionOptions`, `HealthOptions`,
`ConnectionHealth`, `ServiceHealth`, `FindInput`, `CreateInput`, `MutationInput`, `BulkInput`,
`OffsetPage`, `CursorPage`, `BatchEnvelope`, `ErrorCode`, `DatabaseOutcome`, `InvocationOutcome`.
