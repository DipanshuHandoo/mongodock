import { randomUUID } from "node:crypto";
import {
  InvalidOptionError,
  isMongoDockError,
  OperationAbortedError,
  TransactionError,
} from "./errors.js";
import { isPlain } from "./operations/guards.js";
import { createOperations } from "./operations/index.js";

const OPTION_KEYS = Object.freeze([
  "transactionOptions",
  "signal",
  "correlationId",
  "hooks",
  "metadata",
]);

/** Sessions owned by an in-progress withTransaction; only their scoped facade may use them. */
const ownedSessions = new WeakSet();

/**
 * Builds the guard for caller-supplied native sessions on one connection.
 * @param {() => import("mongoose").Connection} getConnection
 */
export function createSessionVerifier(getConnection) {
  return (/** @type {any} */ session) => {
    if (ownedSessions.has(session)) {
      throw new InvalidOptionError(
        "options.session belongs to an active withTransaction; use the ops passed to its callback",
      );
    }
    const client = session?.client;
    if (client === undefined || client !== getConnection().getClient()) {
      throw new InvalidOptionError("options.session was not created by this connection");
    }
  };
}

/** @param {any} error */
const isStandaloneRejection = (error) =>
  error?.code === 20 ||
  /Transaction numbers are only allowed|does not support retryable writes/i.test(
    String(error?.message ?? ""),
  );

/**
 * @param {object} input
 * @param {string} input.connection
 * @param {any} input.session
 * @param {AbortSignal} input.signal
 * @param {string} input.transactionId
 * @param {number} input.attempt
 * @param {string | undefined} input.correlationId
 */
function createScope({ connection, session, signal, transactionId, attempt, correlationId }) {
  let closed = false;
  let busy = false;
  return {
    session,
    close: () => {
      closed = true;
    },
    begin() {
      if (closed) {
        throw new TransactionError("Transaction scope is closed; its attempt has finished", {
          connection,
        });
      }
      if (signal.aborted) {
        throw new OperationAbortedError("Transaction cancelled; no further calls are issued", {
          connection,
          cause: signal.reason,
        });
      }
      if (busy) {
        throw new TransactionError(
          "Operations in one transaction must run sequentially; await each call before the next",
          { connection },
        );
      }
      busy = true;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        busy = false;
      };
    },
    /** @param {Record<string, any>} params */
    decorate(params) {
      const given = params.options;
      if (given !== undefined && !isPlain(given)) return params;
      if (given?.session !== undefined && given.session !== session) {
        throw new InvalidOptionError("Calls inside withTransaction cannot use a different session");
      }
      const tracing = { transactionId, transactionAttempt: attempt };
      return {
        ...params,
        options: { ...(given ?? {}), session },
        ...(params.correlationId === undefined && correlationId !== undefined
          ? { correlationId }
          : {}),
        metadata:
          params.metadata === undefined || isPlain(params.metadata)
            ? { ...tracing, ...(params.metadata ?? {}) }
            : params.metadata,
      };
    },
  };
}

/**
 * @param {object} deps
 * @param {ReturnType<typeof import("./hooks/pipeline.js").createExecutor>} deps.executor
 * @param {import("./types.js").NormalizedConfig} deps.config
 * @param {string} deps.name
 * @param {() => import("mongoose").Connection} deps.getConnection
 * @param {(model: unknown) => import("mongoose").Model<any>} deps.resolveModel
 */
export function createWithTransaction({ executor, config, name, getConnection, resolveModel }) {
  /**
   * @template T
   * @param {(tx: import("./types.js").TransactionContext) => T | Promise<T>} callback
   * @param {import("./types.js").TransactionOptions} [options]
   * @returns {Promise<Awaited<T>>}
   */
  return async function withTransaction(callback, options) {
    if (typeof callback !== "function") {
      throw new InvalidOptionError("withTransaction requires a callback function");
    }
    if (options !== undefined && !isPlain(options)) {
      throw new InvalidOptionError("withTransaction options must be a plain object");
    }
    const unknown = Object.keys(options ?? {}).filter((key) => !OPTION_KEYS.includes(key));
    if (unknown.length > 0) {
      throw new InvalidOptionError(`Unknown withTransaction option: ${unknown[0]}`);
    }
    const { transactionOptions, ...call } = options ?? {};
    const transactionId = randomUUID();
    let attempt = 0;
    /** @type {{ error: unknown } | undefined} */
    let callbackFailure;
    /** @type {unknown[]} */
    const sessions = [];

    /** @param {any} error */
    const translate = (error) => {
      if (isStandaloneRejection(error)) {
        return new TransactionError(
          "Transactions require a replica set or sharded cluster; this topology rejected them",
          { cause: error, connection: name, databaseOutcome: "notDispatched" },
        );
      }
      if (callbackFailure && callbackFailure.error === error) return error;
      if (isMongoDockError(error)) return error;
      return new TransactionError("Transaction did not complete", {
        cause: error,
        connection: name,
        databaseOutcome: error?.hasErrorLabel?.("UnknownTransactionCommitResult")
          ? "uncertain"
          : "failed",
        ...(callbackFailure ? { errors: [callbackFailure.error] } : {}),
      });
    };

    return /** @type {Promise<Awaited<T>>} */ (
      executor.execute({
        ...call,
        method: "withTransaction",
        connection: name,
        write: true,
        input: {},
        run: async (_input, ctx) => {
          try {
            return await getConnection().transaction(async (/** @type {any} */ session) => {
              attempt += 1;
              callbackFailure = undefined;
              sessions.push(session);
              ownedSessions.add(session);
              const scope = createScope({
                connection: name,
                session,
                signal: ctx.signal,
                transactionId,
                attempt,
                correlationId: ctx.correlationId,
              });
              const ops = /** @type {import("./types.js").OperationMethods} */ (
                /** @type {unknown} */ (
                  Object.freeze({
                    ...createOperations({
                      executor,
                      config,
                      connection: name,
                      resolveModel,
                      scope,
                    }),
                    withTransaction: async () => {
                      throw new TransactionError("Nested transactions are not supported", {
                        connection: name,
                      });
                    },
                  })
                )
              );
              try {
                return await callback(
                  Object.freeze({
                    session,
                    ops,
                    attempt,
                    transactionId,
                    signal: ctx.signal,
                  }),
                );
              } catch (error) {
                callbackFailure = { error };
                throw error;
              } finally {
                scope.close();
              }
            }, transactionOptions);
          } catch (error) {
            throw translate(error);
          } finally {
            for (const session of sessions) ownedSessions.delete(/** @type {object} */ (session));
          }
        },
      })
    );
  };
}
