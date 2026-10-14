/**
 * @typedef {"ERR_CONFIGURATION" | "ERR_CONNECTION" | "ERR_MODEL_REGISTRATION" | "ERR_INVALID_OPTION" | "ERR_OPERATION_VETO" | "ERR_HOOK" | "ERR_ABORTED" | "ERR_SHUTDOWN_TIMEOUT" | "ERR_BULK" | "ERR_TRANSACTION"} ErrorCode
 * @typedef {"notDispatched" | "succeeded" | "failed" | "partial" | "uncertain" | "pendingCommit"} DatabaseOutcome
 * @typedef {"succeeded" | "failed" | "partial" | "cancelled" | "closedEarly"} InvocationOutcome
 * @typedef {object} ErrorContext
 * @property {DatabaseOutcome} [databaseOutcome]
 * @property {InvocationOutcome} [invocationOutcome]
 * @property {string} [operationId]
 * @property {string} [connection]
 */

export class MongoDockError extends Error {
  /**
   * @param {ErrorCode} code
   * @param {string} message Safe, application-independent diagnostic.
   * @param {ErrorOptions & ErrorContext} [options]
   */
  constructor(code, message, options = {}) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.databaseOutcome = options.databaseOutcome ?? "notDispatched";
    this.invocationOutcome = options.invocationOutcome ?? "failed";
    this.operationId = options.operationId;
    this.connection = options.connection;
  }
}

export class ConfigurationError extends MongoDockError {
  /** @param {string} message @param {ErrorOptions} [options] */
  constructor(message, options) {
    super("ERR_CONFIGURATION", message, options);
  }
}

export class InvalidOptionError extends MongoDockError {
  /** @param {string} message @param {ErrorOptions} [options] */
  constructor(message, options) {
    super("ERR_INVALID_OPTION", message, options);
  }
}

/**
 * @typedef {object} ConnectionOutcome
 * @property {string} connection
 * @property {"fulfilled" | "rejected"} status
 * @property {unknown} [error]
 */

export class ConnectionError extends MongoDockError {
  /**
   * @param {string} message
   * @param {ErrorOptions & ErrorContext & { outcomes?: readonly ConnectionOutcome[] }} [options]
   */
  constructor(message, options = {}) {
    super("ERR_CONNECTION", message, options);
    this.outcomes = Object.freeze([...(options.outcomes ?? [])]);
  }
}

export class ModelRegistrationError extends MongoDockError {
  /** @param {string} message @param {ErrorOptions & ErrorContext} [options] */
  constructor(message, options) {
    super("ERR_MODEL_REGISTRATION", message, options);
  }
}

/**
 * @typedef {object} PendingWork
 * @property {string} connection
 * @property {string} kind
 * @property {number} count
 */

export class ShutdownTimeoutError extends MongoDockError {
  /**
   * @param {string} message
   * @param {ErrorOptions & ErrorContext & { pending?: readonly PendingWork[], outcomes?: readonly ConnectionOutcome[] }} [options]
   */
  constructor(message, options = {}) {
    super("ERR_SHUTDOWN_TIMEOUT", message, { databaseOutcome: "uncertain", ...options });
    this.pending = Object.freeze([...(options.pending ?? [])]);
    this.outcomes = Object.freeze([...(options.outcomes ?? [])]);
  }
}

export class OperationVetoError extends MongoDockError {
  /** @param {string} message @param {ErrorOptions & ErrorContext} [options] */
  constructor(message, options) {
    super("ERR_OPERATION_VETO", message, options);
  }
}

export class OperationAbortedError extends MongoDockError {
  /** @param {string} message @param {ErrorOptions & ErrorContext} [options] */
  constructor(message, options) {
    super("ERR_ABORTED", message, { invocationOutcome: "cancelled", ...options });
  }
}

export class HookError extends MongoDockError {
  /**
   * @param {string} message
   * @param {ErrorOptions & ErrorContext & { hookName?: string, scope?: string, errors?: readonly unknown[], original?: unknown }} [options]
   */
  constructor(message, options = {}) {
    super("ERR_HOOK", message, options);
    this.hookName = options.hookName;
    this.scope = options.scope;
    /** Every hook failure that could not be delivered to onHookError. */
    this.errors = Object.freeze([...(options.errors ?? [])]);
    /** The database/operation failure that was in flight, when any. */
    this.original = options.original;
  }
}

export class BulkError extends MongoDockError {
  /**
   * Fatal batched-write failure (source, sink, or safety violation). `report` is the bounded
   * partial progress at the time dispatch stopped.
   * @param {string} message
   * @param {ErrorOptions & ErrorContext & { report?: import("./types.js").BulkReport }} [options]
   */
  constructor(message, options = {}) {
    super("ERR_BULK", message, options);
    this.report = options.report;
  }
}

export class TransactionError extends MongoDockError {
  /**
   * Transaction lifecycle failure (scope misuse, unsupported topology, commit/abort/cleanup).
   * `errors` carries secondary failures that would otherwise be hidden by the primary one.
   * @param {string} message
   * @param {ErrorOptions & ErrorContext & { errors?: readonly unknown[] }} [options]
   */
  constructor(message, options = {}) {
    super("ERR_TRANSACTION", message, options);
    this.errors = Object.freeze([...(options.errors ?? [])]);
  }
}

/** @param {unknown} value @returns {value is MongoDockError} */
export function isMongoDockError(value) {
  return value instanceof MongoDockError;
}

/**
 * Deliberately omits messages, native causes, filters, and documents.
 * @param {unknown} error
 */
export function toSafeDiagnostic(error) {
  if (!isMongoDockError(error)) {
    return Object.freeze({ code: "ERR_DATABASE", databaseOutcome: "uncertain" });
  }
  return Object.freeze({
    code: error.code,
    databaseOutcome: error.databaseOutcome,
    invocationOutcome: error.invocationOutcome,
    operationId: error.operationId,
    connection: error.connection,
  });
}
