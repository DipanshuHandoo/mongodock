import { randomUUID } from "node:crypto";
import { cloneOptions, normalizeHooks } from "../config.js";
import {
  HookError,
  InvalidOptionError,
  isMongoDockError,
  OperationAbortedError,
  OperationVetoError,
} from "../errors.js";
import {
  abortableDelay,
  computeDelay,
  isTransientReadError,
  RETRYABLE_METHODS,
  resolveRetry,
} from "../retry/read-policy.js";
import { createPluginChain } from "../plugins/registry.js";

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isPlain = (value) =>
  !!value &&
  typeof value === "object" &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));

/** @param {unknown} next @param {unknown} _previous */
function defaultValidateInput(next, _previous) {
  if (!isPlain(next)) throw new InvalidOptionError("beforeOperation must return a plain object");
}

/**
 * One execution lifecycle shared by materialized calls, streams, and later bulk/seed jobs.
 * Methods supply `run`/`open`; hooks, retry, admission, outcomes and terminal delivery live here.
 * @param {object} input
 * @param {import("../types.js").NormalizedConfig} input.config
 * @param {(connection: string | undefined, resource: {kind: string}) => {release(): void}} [input.admit]
 * @param {() => number} [input.random]
 * @param {string} [input.defaultConnection]
 */
export function createExecutor({ config, admit, random = Math.random }) {
  const chain = createPluginChain(config);
  const hookTimeoutMS = config.limits.hookTimeoutMS;

  /**
   * Awaits a hook within the hook budget. Hooks cooperate through context.signal; a timed-out
   * hook is abandoned, never claimed as cancelled, and its late result is ignored.
   * @param {{scope: string, fn: Function}} entry @param {string} hookName @param {unknown[]} args
   */
  function callHook(entry, hookName, args) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new HookError(`Hook "${hookName}" exceeded ${hookTimeoutMS} ms`, {
              hookName,
              scope: entry.scope,
            }),
          ),
        hookTimeoutMS,
      );
      Promise.resolve()
        .then(() => entry.fn(...args))
        .then(resolve, reject)
        .finally(() => clearTimeout(timer));
    });
  }

  /**
   * @param {Record<string, unknown>} options
   */
  function createOperation(options) {
    const {
      method,
      model,
      correlationId,
      write = false,
      transactional = false,
      validateInput = defaultValidateInput,
    } = /** @type {any} */ (options);
    const connection = /** @type {string} */ (options.connection ?? config.defaultConnection);
    const callHooks = normalizeHooks(options.hooks ?? {});
    const policy = resolveRetry(config, options.retry, !!callHooks.beforeRetry);
    const retrying =
      policy.enabled &&
      options.retryable === true &&
      !write &&
      !transactional &&
      RETRYABLE_METHODS.includes(method);
    const callerSignal = /** @type {AbortSignal | undefined} */ (options.signal);
    if (callerSignal !== undefined && !(callerSignal instanceof AbortSignal)) {
      throw new InvalidOptionError("signal must be an AbortSignal");
    }
    const metadata = Object.freeze(cloneOptions(options.metadata ?? {}));
    // Invalid calls above fail before admission; from here a full lifecycle exists.
    const admission = admit?.(connection, { kind: method });

    const operationId = randomUUID();
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(callerSignal?.reason);
    if (callerSignal?.aborted) forwardAbort();
    else callerSignal?.addEventListener("abort", forwardAbort, { once: true });

    const startedAt = Date.now();
    let attempt = 1;
    /** @type {import("../errors.js").DatabaseOutcome} */
    let databaseOutcome = "notDispatched";
    /** @type {unknown[]} */
    const unreported = [];
    /** @type {Array<() => unknown>} */
    const cleanups = [];
    if (admission) cleanups.push(() => admission.release());
    cleanups.push(() => callerSignal?.removeEventListener("abort", forwardAbort));

    const context = () =>
      Object.freeze({
        operationId,
        ...(correlationId === undefined ? {} : { correlationId }),
        connection,
        ...(model === undefined ? {} : { model }),
        method,
        attempt,
        signal: controller.signal,
        startedAt,
        metadata,
      });

    /** @param {string} name */
    const entries = (name) => chain.entries(name, callHooks);

    /** @param {string} message @param {unknown} cause @param {string} hookName @param {string} scope @param {unknown} [original] */
    const hookFailure = (message, cause, hookName, scope, original) =>
      new HookError(message, {
        cause,
        hookName,
        scope,
        original,
        operationId,
        connection,
        databaseOutcome,
      });

    /** @param {string} hookName @param {string} scope @param {unknown} error */
    async function report(hookName, scope, error) {
      const handlers = entries("onHookError");
      if (handlers.length === 0) {
        unreported.push(error);
        return;
      }
      for (const handler of handlers) {
        try {
          await callHook(handler, "onHookError", [{ error, hookName, scope, context: context() }]);
        } catch (reportingError) {
          // onHookError never recurses; its own failure is surfaced in the composite error.
          unreported.push(error, reportingError);
        }
      }
    }

    /** @param {string} name @param {unknown} payload */
    async function observe(name, payload) {
      for (const entry of entries(name)) {
        try {
          await callHook(entry, name, [payload]);
        } catch (error) {
          await report(name, entry.scope, error);
        }
      }
    }

    /** @param {import("../errors.js").InvocationOutcome} invocationOutcome @param {unknown} [error] @param {unknown} [result] */
    const completion = (invocationOutcome, error, result) => ({
      context: context(),
      databaseOutcome,
      invocationOutcome,
      ...(error === undefined ? {} : { error }),
      ...(result === undefined ? {} : { result }),
    });

    /**
     * @param {"onSuccess" | "onError" | null} terminal
     * @param {import("../errors.js").InvocationOutcome} invocationOutcome
     * @param {unknown} [error] @param {unknown} [result]
     */
    async function settle(terminal, invocationOutcome, error, result) {
      if (terminal) await observe(terminal, completion(invocationOutcome, error, result));
      for (const cleanup of cleanups.splice(0).reverse()) {
        try {
          await cleanup();
        } catch (cleanupError) {
          await report("cleanup", "service", cleanupError);
        }
      }
      await observe("onComplete", completion(invocationOutcome, error, result));
      if (unreported.length === 0) return undefined;
      return new HookError("One or more hooks failed and could not be reported", {
        cause: error ?? unreported[0],
        errors: unreported,
        original: error,
        operationId,
        connection,
        databaseOutcome,
        invocationOutcome: invocationOutcome === "succeeded" ? "failed" : invocationOutcome,
      });
    }

    return {
      operationId,
      context,
      /** @param {() => unknown} cleanup */
      addCleanup: (cleanup) => cleanups.push(cleanup),
      /** @param {import("../errors.js").DatabaseOutcome} value */
      setDatabaseOutcome(value) {
        databaseOutcome = value;
      },

      /** Runs beforeOperation hooks and returns the effective input, captured once. */
      async prepare() {
        let current = cloneOptions(options.input ?? {});
        for (const entry of entries("beforeOperation")) {
          let next;
          try {
            next = await callHook(entry, "beforeOperation", [cloneOptions(current), context()]);
          } catch (cause) {
            throw hookFailure("beforeOperation hook failed", cause, "beforeOperation", entry.scope);
          }
          if (next === false) {
            throw new OperationVetoError("Operation vetoed by beforeOperation", {
              operationId,
              connection,
              databaseOutcome: "notDispatched",
            });
          }
          if (next === undefined) continue;
          try {
            validateInput(next, current);
          } catch (cause) {
            throw hookFailure(
              "beforeOperation returned invalid input",
              cause,
              "beforeOperation",
              entry.scope,
            );
          }
          current = cloneOptions(next);
        }
        // Final authority over the hook-transformed input: revalidation and safety guards.
        if (typeof options.finalizeInput === "function") {
          current = cloneOptions(await options.finalizeInput(current));
        }
        if (controller.signal.aborted) {
          throw new OperationAbortedError("Operation aborted before dispatch", {
            operationId,
            connection,
          });
        }
        return current;
      },

      /**
       * Executes with bounded retries for eligible reads. Retries reuse the captured input.
       * @param {unknown} input @param {(input: any, context: any) => Promise<unknown>} run
       */
      async attempts(input, run) {
        for (;;) {
          if (controller.signal.aborted) {
            throw new OperationAbortedError("Operation aborted", {
              operationId,
              connection,
              databaseOutcome,
            });
          }
          databaseOutcome = "uncertain";
          try {
            const value = await run(cloneOptions(input), context());
            databaseOutcome = transactional ? "pendingCommit" : "succeeded";
            return value;
          } catch (error) {
            const retry =
              retrying &&
              attempt <= policy.maxRetries &&
              !controller.signal.aborted &&
              isTransientReadError(error);
            if (!retry) throw error;
            const delayMs = computeDelay(policy, attempt, random);
            if (Date.now() - startedAt + delayMs > policy.totalBudgetMS) throw error;
            for (const entry of entries("beforeRetry")) {
              let verdict;
              try {
                verdict = await callHook(entry, "beforeRetry", [
                  { attempt, nextAttempt: attempt + 1, delayMs, error, context: context() },
                ]);
              } catch (cause) {
                throw hookFailure(
                  "beforeRetry hook failed",
                  cause,
                  "beforeRetry",
                  entry.scope,
                  error,
                );
              }
              if (verdict === false) throw error;
            }
            databaseOutcome = "failed";
            await abortableDelay(delayMs, controller.signal).catch(() => {
              throw new OperationAbortedError("Operation aborted while waiting to retry", {
                cause: error,
                operationId,
                connection,
                databaseOutcome,
              });
            });
            attempt += 1;
          }
        }
      },

      /** @param {unknown} value */
      async transform(value) {
        let result = value;
        for (const entry of entries("afterOperation")) {
          let next;
          try {
            next = await callHook(entry, "afterOperation", [result, context()]);
          } catch (cause) {
            throw hookFailure("afterOperation hook failed", cause, "afterOperation", entry.scope);
          }
          if (next === undefined) continue;
          if (!isPlain(next) || !Object.hasOwn(next, "result")) {
            throw hookFailure(
              "afterOperation must return { result } or undefined",
              new InvalidOptionError("Invalid afterOperation return"),
              "afterOperation",
              entry.scope,
            );
          }
          result = next.result;
        }
        return result;
      },

      /**
       * Terminal success. A classified non-success report (partial bulk) uses onError and still resolves.
       * @param {unknown} result
       * @param {{ invocationOutcome: import("../errors.js").InvocationOutcome, databaseOutcome: import("../errors.js").DatabaseOutcome } | undefined} [classified]
       */
      async succeed(result, classified) {
        const failure =
          classified && classified.invocationOutcome !== "succeeded" ? classified : undefined;
        if (failure) databaseOutcome = failure.databaseOutcome;
        const composite = failure
          ? await settle("onError", failure.invocationOutcome, undefined, result)
          : await settle("onSuccess", "succeeded", undefined, result);
        if (composite) throw composite;
        return result;
      },

      /**
       * Terminal failure/veto/cancel. Returns the error the caller must throw.
       * @param {unknown} error
       */
      async fail(error) {
        if (databaseOutcome === "uncertain" && !write) databaseOutcome = "failed";
        let current = error;
        const hookOrigin = current instanceof HookError;
        if (!hookOrigin) {
          for (const entry of entries("beforeError")) {
            try {
              const next = await callHook(entry, "beforeError", [current, context()]);
              if (next === undefined) continue;
              if (!(next instanceof Error)) {
                throw new InvalidOptionError("beforeError must return an Error or undefined");
              }
              if (next !== current && next.cause === undefined) {
                Object.defineProperty(next, "cause", {
                  value: current,
                  configurable: true,
                  writable: true,
                });
              }
              current = next;
            } catch (cause) {
              current = hookFailure(
                "beforeError hook failed",
                cause,
                "beforeError",
                entry.scope,
                current,
              );
              break;
            }
          }
        }
        const cancelled =
          controller.signal.aborted ||
          current instanceof OperationAbortedError ||
          (isMongoDockError(current) && current.invocationOutcome === "cancelled");
        const composite = await settle("onError", cancelled ? "cancelled" : "failed", current);
        return composite ?? current;
      },

      /** Stream consumer returned early: no onSuccess/onError. */
      async closeEarly() {
        if (databaseOutcome === "uncertain") databaseOutcome = "succeeded";
        const composite = await settle(null, "closedEarly");
        if (composite) throw composite;
      },
    };
  }

  /**
   * Materialized call. `run(input, context)` receives a private copy of the effective input.
   * @param {Record<string, unknown> & { run: (input: any, context: any) => Promise<unknown>, classify?: (result: any) => any }} options
   */
  async function execute(options) {
    const op = createOperation(options);
    let result;
    try {
      const input = await op.prepare();
      const produced = await op.attempts(input, options.run);
      result = await op.transform(produced);
      if (typeof options.restoreResult === "function") {
        result = options.restoreResult(produced, result);
      }
    } catch (error) {
      throw await op.fail(error);
    }
    return op.succeed(result, options.classify?.(result));
  }

  /**
   * Lazy stream: nothing is admitted, hooked or opened until the first next().
   * @param {Record<string, unknown> & { open: (input: any, context: any) => AsyncIterable<unknown> | Promise<AsyncIterable<unknown>> }} options
   * @returns {AsyncGenerator<unknown, void, void>}
   */
  function executeStream(options) {
    normalizeHooks(options.hooks ?? {});
    return streamLifecycle(options);
  }

  /** @param {Record<string, unknown> & { open: (input: any, context: any) => AsyncIterable<unknown> | Promise<AsyncIterable<unknown>> }} options */
  async function* streamLifecycle(options) {
    const op = createOperation({ ...options, retryable: false });
    let finished = false;
    try {
      const input = await op.prepare();
      op.setDatabaseOutcome("uncertain");
      const iterator = (await options.open(cloneOptions(input), op.context()))[
        Symbol.asyncIterator
      ]();
      op.addCleanup(() => iterator.return?.());
      for (;;) {
        const step = await iterator.next();
        if (step.done) break;
        yield step.value;
      }
      op.setDatabaseOutcome("succeeded");
      finished = true;
    } catch (error) {
      finished = true;
      throw await op.fail(error);
    } finally {
      if (!finished) {
        finished = true;
        await op.closeEarly();
      }
    }
    await op.succeed(undefined);
  }

  return { execute, executeStream, createOperation, observe: observeLifecycle };

  /**
   * Connection lifecycle observers: no operation context; failures go to onHookError and are
   * otherwise dropped rather than raised as unhandled rejections.
   * @param {string} hookName @param {unknown} payload
   */
  async function observeLifecycle(hookName, payload) {
    for (const entry of chain.entries(hookName, {})) {
      try {
        await callHook(entry, hookName, [payload]);
      } catch (error) {
        for (const handler of chain.entries("onHookError", {})) {
          try {
            await callHook(handler, "onHookError", [{ error, hookName, scope: entry.scope }]);
          } catch {
            // Nothing further can be reported without recursion.
          }
        }
      }
    }
  }
}
