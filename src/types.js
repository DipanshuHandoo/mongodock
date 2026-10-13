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
 * @property {AbortSignal} signal
 * @property {Readonly<Record<string, unknown>>} metadata
 *
 * @typedef {object} CompletionContext
 * @property {OperationContext} context
 * @property {import("./errors.js").DatabaseOutcome} databaseOutcome
 * @property {import("./errors.js").InvocationOutcome} invocationOutcome
 * @property {unknown} [error]
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
 * @typedef {object} ConnectionView
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
 * @property {number} consumed
 * @property {number} attempted
 * @property {number | null} knownSucceeded
 * @property {number} failed
 * @property {number} uncertain
 * @property {number | null} unattempted
 * @property {number} insertedCount
 * @property {number} matchedCount
 * @property {number} modifiedCount
 * @property {number} deletedCount
 * @property {number} upsertedCount
 * @property {number} elapsedMs
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
