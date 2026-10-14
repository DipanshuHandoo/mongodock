export {
  DEFAULTS,
  HOOK_NAMES,
  normalizeBatchOptions,
  normalizeConfig,
  normalizeRetry,
} from "./config.js";
export { createMongoService } from "./create-mongo-service.js";
export {
  BulkError,
  ConfigurationError,
  ConnectionError,
  HookError,
  InvalidOptionError,
  isMongoDockError,
  ModelRegistrationError,
  MongoDockError,
  OperationAbortedError,
  OperationVetoError,
  ShutdownTimeoutError,
  toSafeDiagnostic,
  TransactionError,
} from "./errors.js";
/** @typedef {import("./types.js").MongoService} MongoService */
/** @typedef {import("./types.js").ConnectionView} ConnectionView */
/** @typedef {import("./types.js").ConnectionStatus} ConnectionStatus */
/** @typedef {import("./types.js").ModelDefinition} ModelDefinition */
/** @typedef {import("./types.js").MongoServiceConfig} MongoServiceConfig */
/** @typedef {import("./types.js").NormalizedConfig} NormalizedConfig */
/** @typedef {import("./types.js").Hooks} Hooks */
/** @typedef {import("./types.js").Plugin} Plugin */
/** @typedef {import("./types.js").RetryOptions} RetryOptions */
/** @typedef {import("./types.js").OperationContext} OperationContext */
/** @typedef {import("./types.js").BulkReport} BulkReport */
/** @typedef {import("./types.js").TransactionContext} TransactionContext */
/** @typedef {import("./types.js").TransactionOptions} TransactionOptions */
/** @typedef {import("./types.js").HealthOptions} HealthOptions */
/** @typedef {import("./types.js").ConnectionHealth} ConnectionHealth */
/** @typedef {import("./types.js").ServiceHealth} ServiceHealth */
/** @typedef {import("./types.js").BulkBatchOutcome} BulkBatchOutcome */
/** @typedef {import("./types.js").BatchOptions} BatchOptions */
/** @typedef {import("./types.js").NativeSeedInput} NativeSeedInput */
/** @typedef {import("./types.js").BatchedSeedInput} BatchedSeedInput */
/** @typedef {import("./types.js").SeedDryRunReport} SeedDryRunReport */
/** @template T @typedef {import("./contracts.js").FindInput<T>} FindInput */
/** @template T @typedef {import("./contracts.js").CreateInput<T>} CreateInput */
/** @template T @typedef {import("./contracts.js").MutationInput<T>} MutationInput */
/** @template T @typedef {import("./contracts.js").BulkInput<T>} BulkInput */
/** @template T @typedef {import("./types.js").OffsetPage<T>} OffsetPage */
/** @template T @typedef {import("./types.js").CursorPage<T>} CursorPage */
/** @template T @typedef {import("./types.js").BatchEnvelope<T>} BatchEnvelope */
/** @typedef {import("./errors.js").ErrorCode} ErrorCode */
/** @typedef {import("./errors.js").DatabaseOutcome} DatabaseOutcome */
/** @typedef {import("./errors.js").InvocationOutcome} InvocationOutcome */
