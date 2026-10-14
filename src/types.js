/**
 * @typedef {import("mongoose").Connection} Connection
 * @typedef {import("mongoose").ConnectOptions} ConnectOptions
 * @typedef {object} ConnectionConfig
 * @property {string} [uri]
 * @property {ConnectOptions} [options]
 * @property {Connection} [connection] Caller-owned, never closed by default.
 *
 * @typedef {object} RetryOptions
 * @property {number} [maxRetries]
 * @property {number} [baseDelayMs]
 * @property {number} [maxDelayMs]
 * @property {number} [totalBudgetMS]
 *
 * @typedef {object} NormalizedRetry
 * @property {boolean} enabled
 * @property {number} maxRetries
 * @property {number} baseDelayMs
 * @property {number} maxDelayMs
 * @property {number} totalBudgetMS
 *
 * @typedef {object} OperationContext
 * @property {string} operationId
 * @property {string} connection
 * @property {string} method
 * @property {string} [model]
 * @property {string} [correlationId]
 * @property {number} attempt
 * @property {number} startedAt Epoch milliseconds when the logical operation began.
 * @property {AbortSignal} signal
 * @property {Readonly<Record<string, unknown>>} metadata
 *
 * @typedef {object} CompletionContext
 * @property {OperationContext} context
 * @property {import("./errors.js").DatabaseOutcome} databaseOutcome
 * @property {import("./errors.js").InvocationOutcome} invocationOutcome
 * @property {unknown} [error]
 * @property {unknown} [result]
 *
 * @typedef {object} RetryContext
 * @property {number} attempt
 * @property {number} nextAttempt
 * @property {number} delayMs
 * @property {unknown} error
 * @property {OperationContext} context
 *
 * @typedef {object} HookFailure
 * @property {unknown} error
 * @property {string} hookName
 * @property {string} scope
 * @property {OperationContext} [context] Absent for connection lifecycle events.
 *
 */
/**
 * @template [Input=unknown], [Result=unknown]
 * @typedef {object} Hooks
 * @property {(input: Input, context: OperationContext) => Input | false | void | Promise<Input | false | void>} [beforeOperation]
 * @property {(info: RetryContext) => boolean | void | Promise<boolean | void>} [beforeRetry]
 * @property {(result: Result, context: OperationContext) => {result: Result} | void | Promise<{result: Result} | void>} [afterOperation]
 * @property {(error: unknown, context: OperationContext) => Error | void | Promise<Error | void>} [beforeError]
 * @property {(context: CompletionContext) => void | Promise<void>} [onSuccess]
 * @property {(context: CompletionContext) => void | Promise<void>} [onError]
 * @property {(context: CompletionContext) => void | Promise<void>} [onComplete]
 * @property {(info: HookFailure) => void | Promise<void>} [onHookError]
 * @property {(report: Readonly<Record<string, unknown>>) => void | Promise<void>} [onBatch]
 * @property {(report: Readonly<Record<string, unknown>>) => void | Promise<void>} [onProgress]
 * @property {(status: ConnectionStatus) => void | Promise<void>} [onConnectionConnecting]
 * @property {(status: ConnectionStatus) => void | Promise<void>} [onConnectionConnected]
 * @property {(status: ConnectionStatus) => void | Promise<void>} [onConnectionDisconnected]
 * @property {(status: ConnectionStatus) => void | Promise<void>} [onConnectionReconnected]
 * @property {(status: ConnectionStatus) => void | Promise<void>} [onConnectionError]
 *
 * @typedef {object} Plugin
 * @property {string} name
 * @property {Hooks} hooks
 *
 * @typedef {object} ConnectionStatus
 * @property {string} name
 * @property {"idle" | "connecting" | "ready" | "closing" | "closed" | "failed"} state
 * @property {number} readyState
 * @property {boolean} owned
 * @property {{code: string, databaseOutcome?: string}} [error] Credential-safe last failure.
 *
 * @typedef {object} ModelDefinition
 * @property {string} [name]
 * @property {import("mongoose").Schema} [schema]
 * @property {string} [collection]
 * @property {Record<string, unknown>} [options]
 * @property {import("mongoose").Model<any>} [model]
 *
 * @typedef {object} CallOptions
 * @property {AbortSignal} [signal]
 * @property {string} [correlationId]
 * @property {Record<string, unknown>} [metadata]
 * @property {Hooks<any, any>} [hooks]
 * @property {boolean | RetryOptions} [retry]
 *
 * @typedef {string | import("mongoose").Model<any>} ModelRef
 */
/**
 * @template M
 * @typedef {M extends import("mongoose").Model<infer T> ? T : any} DocOf
 */
/**
 * @typedef {object} ReadInput
 * @property {ModelRef} model
 * @property {Record<string, unknown>} [filter]
 * @property {unknown} [projection]
 * @property {unknown} [sort]
 * @property {unknown} [populate]
 * @property {boolean} [lean]
 * @property {number} [limit]
 * @property {number} [skip]
 * @property {Record<string, unknown>} [options]
 *
 * @typedef {object} WriteInput
 * @property {ModelRef} model
 * @property {Record<string, unknown>} [filter]
 * @property {unknown} [id]
 * @property {unknown} [update]
 * @property {unknown} [data]
 * @property {boolean} [allowAll]
 * @property {boolean} [lean]
 * @property {unknown} [projection]
 * @property {unknown} [sort]
 * @property {unknown} [populate]
 * @property {Record<string, unknown>} [options]
 *
 * @typedef {object} AggregateInput
 * @property {ModelRef} model
 * @property {readonly Record<string, unknown>[]} pipeline
 * @property {boolean} [allowWriteStages]
 * @property {Record<string, unknown>} [options]
 *
 * @typedef {<I extends ReadInput & CallOptions>(input: I) => Promise<I["lean"] extends true ? import("mongoose").Require_id<DocOf<I["model"]>>[] : import("mongoose").HydratedDocument<DocOf<I["model"]>>[]>} ListMethod
 * @typedef {<I extends ReadInput & CallOptions>(input: I) => Promise<(I["lean"] extends true ? import("mongoose").Require_id<DocOf<I["model"]>> : import("mongoose").HydratedDocument<DocOf<I["model"]>>) | null>} OneMethod
 * @typedef {(input: (WriteInput | ReadInput) & CallOptions) => Promise<any>} AnyMethod
 *
 * @typedef {ReadInput & { page?: number, includeTotal?: boolean }} PageInput
 * @typedef {ReadInput & { cursor?: string }} CursorInput
 * @typedef {Omit<ReadInput, "limit" | "skip"> & { batchSize?: number }} IterateInput
 * @typedef {IterateInput & { strategy?: "cursor" | "keyset", includeTotal?: boolean }} BatchInput
 * @typedef {Omit<AggregateInput, "pipeline"> & { pipeline: readonly Record<string, unknown>[], batchSize?: number }} AggregateCursorInput
 *
 * @typedef {object} OperationMethods
 * @property {<I extends PageInput & CallOptions>(input: I) => Promise<OffsetPage<I["lean"] extends true ? import("mongoose").Require_id<DocOf<I["model"]>> : import("mongoose").HydratedDocument<DocOf<I["model"]>>>>} paginate
 * @property {<I extends CursorInput & CallOptions>(input: I) => Promise<CursorPage<I["lean"] extends true ? import("mongoose").Require_id<DocOf<I["model"]>> : import("mongoose").HydratedDocument<DocOf<I["model"]>>>>} paginateCursor
 * @property {<I extends IterateInput & CallOptions>(input: I) => AsyncGenerator<I["lean"] extends true ? import("mongoose").Require_id<DocOf<I["model"]>> : import("mongoose").HydratedDocument<DocOf<I["model"]>>, void, void>} iterate
 * @property {<I extends BatchInput & CallOptions>(input: I) => AsyncGenerator<BatchEnvelope<I["lean"] extends true ? import("mongoose").Require_id<DocOf<I["model"]>> : import("mongoose").HydratedDocument<DocOf<I["model"]>>>, void, void>} iterateBatches
 * @property {(input: AggregateCursorInput & CallOptions) => AsyncGenerator<any, void, void>} aggregateCursor
 * @property {ListMethod} find
 * @property {ListMethod} findAll
 * @property {OneMethod} findOne
 * @property {OneMethod} findById
 * @property {(input: ReadInput & CallOptions) => Promise<boolean>} exists
 * @property {(input: ReadInput & CallOptions) => Promise<number>} countDocuments
 * @property {<I extends WriteInput & CallOptions>(input: I) => Promise<import("mongoose").HydratedDocument<DocOf<I["model"]>>>} create
 * @property {<I extends WriteInput & CallOptions>(input: I) => Promise<import("mongoose").HydratedDocument<DocOf<I["model"]>>[]>} insertMany
 * @property {(input: WriteInput & CallOptions) => Promise<import("mongoose").UpdateWriteOpResult>} updateOne
 * @property {(input: WriteInput & CallOptions) => Promise<import("mongoose").UpdateWriteOpResult>} updateMany
 * @property {(input: WriteInput & CallOptions) => Promise<import("mongodb").DeleteResult>} deleteOne
 * @property {(input: WriteInput & CallOptions) => Promise<import("mongodb").DeleteResult>} deleteMany
 * @property {OneMethod} findOneAndUpdate
 * @property {OneMethod} findByIdAndUpdate
 * @property {OneMethod} findOneAndDelete
 * @property {OneMethod} findByIdAndDelete
 * @property {BulkWriteMethod} bulkWrite
 * @property {(input: AggregateInput & CallOptions) => Promise<any[]>} aggregate
 *
 * @typedef {object} ConnectionViewBase
 * @property {string} name
 * @property {() => Promise<ConnectionStatus>} connect
 * @property {() => Promise<ConnectionStatus>} disconnect
 * @property {() => Connection} getConnection
 * @property {() => boolean} isConnected
 * @property {() => Readonly<ConnectionStatus>} getStatus
 * @property {(definition: ModelDefinition) => import("mongoose").Model<any>} registerModel
 * @property {(definitions: readonly ModelDefinition[]) => readonly import("mongoose").Model<any>[]} registerModels
 * @property {<T = any>(name: string) => import("mongoose").Model<T>} getModel
 * @property {(name: string) => boolean} hasModel
 * @property {() => readonly string[]} listModels
 * @property {(name: string) => boolean} unregisterModel
 *
 * @typedef {ConnectionViewBase & OperationMethods} ConnectionView
 *
 * @typedef {object} MongoServiceExtras
 * @property {string} defaultConnection
 * @property {(name?: string) => Promise<ConnectionStatus>} connect
 * @property {(name?: string) => Promise<ConnectionStatus>} disconnect
 * @property {() => Promise<readonly ConnectionStatus[]>} connectAll
 * @property {() => Promise<readonly ConnectionStatus[]>} disconnectAll
 * @property {(name?: string) => Connection} getConnection
 * @property {(name?: string) => boolean} isConnected
 * @property {(name?: string) => Readonly<ConnectionStatus>} getStatus
 * @property {() => readonly Readonly<ConnectionStatus>[]} listStatuses
 * @property {() => readonly string[]} listConnections
 * @property {(name: string) => ConnectionView} use
 *
 * @typedef {Omit<ConnectionView, "connect" | "disconnect" | "getConnection" | "isConnected" | "getStatus"> & MongoServiceExtras} MongoService
 *
 * @typedef {object} Limits
 * @property {number} [readLimit]
 * @property {number} [maxReadLimit]
 * @property {number} [pageLimit]
 * @property {number} [batchSize]
 * @property {number} [concurrency]
 * @property {number} [maxBatchBytes]
 * @property {number} [diagnosticSamples]
 * @property {number} [maxDiagnosticBytes]
 * @property {number} [hookTimeoutMS]
 * @property {number} [drainTimeoutMS]
 * @property {number} [probeTimeoutMS]
 *
 * @typedef {object} MongoServiceConfig
 * @property {string} [uri]
 * @property {ConnectOptions} [options]
 * @property {Record<string, ConnectionConfig>} [connections]
 * @property {string} [defaultConnection]
 * @property {string[]} [requiredConnections]
 * @property {Limits} [limits]
 * @property {boolean | RetryOptions} [retry]
 * @property {Hooks} [hooks]
 * @property {Plugin[]} [plugins]
 *
 * @typedef {object} NormalizedConnection
 * @property {string | undefined} uri
 * @property {ConnectOptions} options
 * @property {Connection | undefined} connection
 * @property {boolean} owned
 *
 * @typedef {object} NormalizedConfig
 * @property {Readonly<Record<string, NormalizedConnection>>} connections
 * @property {string} defaultConnection
 * @property {readonly string[]} requiredConnections
 * @property {Readonly<Required<Limits>>} limits
 * @property {Readonly<NormalizedRetry>} retry
 * @property {"disabled" | "inferred" | "configured"} retrySource
 * @property {Readonly<Hooks>} hooks
 * @property {readonly Readonly<Plugin>[]} plugins
 *
 * @typedef {object} BatchOptions
 * @property {boolean} [batching]
 * @property {number} [batchSize]
 * @property {number} [concurrency]
 * @property {number} [maxBatchBytes]
 * @property {boolean} [ordered]
 * @property {"continue" | "stop"} [failureMode]
 * @property {AbortSignal} [signal]
 *
 * @typedef {object} BulkReport
 * @property {"completed" | "partial" | "failed" | "cancelled"} status
 * @property {"batched"} mode
 * @property {boolean} ordered
 * @property {number} consumed
 * @property {number} attempted
 * @property {number} knownSucceeded
 * @property {number} failed
 * @property {number} uncertain
 * @property {number | null} unattempted
 * @property {number} insertedCount
 * @property {number} matchedCount
 * @property {number} modifiedCount
 * @property {number} deletedCount
 * @property {number} upsertedCount
 * @property {{ total: number, succeeded: number, partial: number, failed: number, uncertain: number, unattempted: number }} batches
 * @property {{ samples: readonly { batchIndex: number, index: number | null, kind: string, code?: number | string | undefined }[], omitted: number }} diagnostics Index and error-code metadata only; no messages, keys or documents.
 * @property {number} elapsedMs
 *
 * @typedef {import("./bulk/outcomes.js").BatchOutcome} BulkBatchOutcome
 *
 * @typedef {{
 *   (input: import("./contracts.js").NativeBulkInput<any> & CallOptions): Promise<import("mongodb").BulkWriteResult>,
 *   (input: import("./contracts.js").BatchedBulkInput<any> & CallOptions): Promise<BulkReport>,
 * }} BulkWriteMethod
 *
 */
/**
 * @template T
 * @typedef {object} OffsetPage
 * @property {T[]} docs
 * @property {number | null} totalDocs
 * @property {number} limit
 * @property {number} page
 * @property {number | null} totalPages
 * @property {boolean} hasNextPage
 * @property {boolean} hasPrevPage
 * @property {number | null} nextPage
 * @property {number | null} prevPage
 *
 */
/**
 * @template T
 * @typedef {object} CursorPage
 * @property {T[]} docs
 * @property {number} limit
 * @property {boolean} hasNextPage
 * @property {string | null} nextCursor
 *
 */
/**
 * @template T
 * @typedef {object} BatchEnvelope
 * @property {T[]} docs
 * @property {number} batchIndex
 * @property {number} processed
 * @property {number | null} totalDocs
 * @property {string | null} nextCursor
 */
/**
 * @typedef {object} SeedOptions
 * @property {string[]} keyFields
 * @property {boolean} [dryRun]
 * @property {boolean} [updateExisting]
 * @property {boolean} [sourceKeysUnique]
 */
export {};
