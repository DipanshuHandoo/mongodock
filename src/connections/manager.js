import mongoose from "mongoose";
import { cloneOptions } from "../config.js";
import { ConnectionError, ShutdownTimeoutError, toSafeDiagnostic } from "../errors.js";
import { createStatus } from "./status.js";

const EVENT_HOOKS = Object.freeze({
  connecting: "onConnectionConnecting",
  connected: "onConnectionConnected",
  disconnected: "onConnectionDisconnected",
  reconnected: "onConnectionReconnected",
  error: "onConnectionError",
});

/**
 * @typedef {object} TrackedResource
 * @property {string} kind
 * @property {() => unknown} [cancel] Stops idle work (for example a cursor); it must release itself.
 *
 * @typedef {object} Admission
 * @property {() => void} release Idempotent.
 */

/**
 * Owns the per-instance connection resources. It never opens a connection on creation,
 * never touches Mongoose globals, and leaves reconnection to the driver.
 * @param {object} input
 * @param {import("../types.js").NormalizedConfig} input.config
 * @param {(hookName: string, status: Readonly<import("../types.js").ConnectionStatus>) => void} [input.notify]
 * @param {(() => import("mongoose").Connection) | undefined} [input.createConnection]
 */
export function createConnectionManager({
  config,
  notify = () => {},
  createConnection = () => mongoose.createConnection(),
}) {
  /** @typedef {ReturnType<typeof createEntry>} Entry */
  const entries = new Map(
    Object.entries(config.connections).map(([name, value]) => [name, createEntry(name, value)]),
  );
  const drainTimeoutMS = config.limits.drainTimeoutMS;

  /** @param {string} name @param {import("../types.js").NormalizedConnection} value */
  function createEntry(name, value) {
    const owned = value.owned;
    const connection = owned
      ? createConnection()
      : /** @type {import("mongoose").Connection} */ (value.connection);
    const options = { autoIndex: false, autoCreate: false, ...value.options };
    if (owned) {
      // Compilation reads these before the connection is opened.
      for (const key of /** @type {const} */ (["bufferCommands", "autoIndex", "autoCreate"])) {
        connection.set(key, options[key]);
      }
    }
    return {
      name,
      owned,
      uri: value.uri,
      options,
      connection,
      /** @type {import("./status.js").Phase} */
      phase: /** @type {import("./status.js").Phase} */ ("idle"),
      /** @type {import("../types.js").ConnectionStatus["error"]} */
      error: undefined,
      /** @type {Promise<Readonly<import("../types.js").ConnectionStatus>> | undefined} */
      opening: undefined,
      /** @type {Promise<Readonly<import("../types.js").ConnectionStatus>> | undefined} */
      closing: undefined,
      /** @type {Set<TrackedResource>} */
      resources: new Set(),
      /** @type {Array<() => void>} */
      waiters: [],
      /** @type {Array<[string, (...args: unknown[]) => void]>} */
      listeners: [],
    };
  }

  /** @param {string} [name] @returns {Entry} */
  function entry(name = config.defaultConnection) {
    const found = typeof name === "string" ? entries.get(name) : undefined;
    if (!found) throw new ConnectionError("Unknown connection name");
    return found;
  }

  /** @param {Entry} item */
  const statusOf = (item) =>
    createStatus({
      name: item.name,
      phase: item.phase,
      readyState: item.connection.readyState,
      owned: item.owned,
      error: item.error,
    });

  /** @param {Entry} item */
  function listen(item) {
    if (item.listeners.length) return;
    /** @type {Array<[string, (...args: unknown[]) => void]>} */
    const handlers = Object.entries(EVENT_HOOKS).map(([event, hookName]) => [
      event,
      (...args) => {
        if (event === "error") {
          item.error = toSafeDiagnostic(
            new ConnectionError("Connection error", { cause: args[0], connection: item.name }),
          );
        }
        notify(hookName, statusOf(item));
      },
    ]);
    handlers.push([
      "close",
      () => {
        if (item.phase === "open") item.phase = "closed";
      },
    ]);
    for (const [event, handler] of handlers) item.connection.on(event, handler);
    item.listeners = handlers;
  }

  /** @param {Entry} item */
  function unlisten(item) {
    for (const [event, handler] of item.listeners) item.connection.off(event, handler);
    item.listeners = [];
  }

  /** @param {Entry} item */
  async function open(item) {
    item.phase = "opening";
    item.error = undefined;
    listen(item);
    try {
      if (item.owned) {
        await item.connection.openUri(item.uri ?? "", cloneOptions(item.options));
      } else if (item.connection.readyState === 2) {
        await item.connection.asPromise();
      } else if (item.connection.readyState !== 1) {
        throw new Error("Caller-owned connection is neither open nor connecting");
      }
      item.phase = "open";
      return statusOf(item);
    } catch (cause) {
      item.phase = "failed";
      const error = new ConnectionError(`Failed to open connection "${item.name}"`, {
        cause,
        connection: item.name,
      });
      item.error = toSafeDiagnostic(error);
      // Listeners stay attached: Mongoose may emit a late "error" and throws if none exist.
      if (item.owned) await item.connection.close().catch(() => undefined);
      throw error;
    }
  }

  /** @param {Entry} item */
  async function connectEntry(item) {
    while (item.closing) await item.closing.catch(() => undefined);
    if (item.phase === "closing") {
      throw new ConnectionError(
        `Connection "${item.name}" is closing and its previous drain is incomplete`,
        { connection: item.name },
      );
    }
    if (item.opening) return item.opening;
    if (item.phase === "open") return statusOf(item);
    const run = open(item).finally(() => {
      item.opening = undefined;
    });
    item.opening = run;
    return run;
  }

  /** @param {Entry} item @returns {readonly import("../errors.js").PendingWork[]} */
  function pendingWork(item) {
    /** @type {Map<string, number>} */
    const counts = new Map();
    for (const resource of item.resources) {
      counts.set(resource.kind, (counts.get(resource.kind) ?? 0) + 1);
    }
    return [...counts].map(([kind, count]) => ({ connection: item.name, kind, count }));
  }

  /** @param {Entry} item */
  async function drain(item) {
    for (const resource of item.resources) {
      if (resource.cancel) {
        Promise.resolve()
          .then(resource.cancel)
          .catch(() => undefined);
      }
    }
    if (item.resources.size === 0) return;
    await new Promise((resolve, reject) => {
      const done = () => {
        clearTimeout(timer);
        resolve(undefined);
      };
      const timer = setTimeout(() => {
        item.waiters = item.waiters.filter((waiter) => waiter !== done);
        const pending = pendingWork(item);
        reject(
          new ShutdownTimeoutError(
            `Connection "${item.name}" still has ${item.resources.size} tracked operation(s) after ${drainTimeoutMS} ms`,
            { connection: item.name, pending },
          ),
        );
      }, drainTimeoutMS);
      item.waiters.push(done);
    });
  }

  /** @param {Entry} item */
  async function close(item) {
    if (!item.opening && item.phase === "open") item.phase = "closing";
    if (item.opening) await item.opening.catch(() => undefined);
    if (item.phase === "idle" || item.phase === "closed" || item.phase === "failed") {
      return statusOf(item);
    }
    item.phase = "closing";
    await drain(item);
    if (item.owned) {
      try {
        await item.connection.close();
      } catch (cause) {
        throw new ConnectionError(`Failed to close connection "${item.name}"`, {
          cause,
          connection: item.name,
          databaseOutcome: "uncertain",
        });
      }
    }
    unlisten(item);
    item.phase = "closed";
    return statusOf(item);
  }

  /** @param {Entry} item */
  function disconnectEntry(item) {
    if (item.closing) return item.closing;
    const run = close(item).finally(() => {
      item.closing = undefined;
    });
    item.closing = run;
    return run;
  }

  /**
   * @param {(item: Entry) => Promise<unknown>} action
   * @param {string} verb
   */
  async function settleAll(action, verb) {
    const items = [...entries.values()];
    // Every action starts synchronously, so admission stops everywhere before any drain waits.
    const results = await Promise.allSettled(items.map((item) => action(item)));
    const outcomes = items.map((item, index) => {
      const result = results[index];
      return result?.status === "rejected"
        ? { connection: item.name, status: /** @type {const} */ ("rejected"), error: result.reason }
        : { connection: item.name, status: /** @type {const} */ ("fulfilled") };
    });
    const failed = outcomes.filter((outcome) => outcome.status === "rejected");
    if (failed.length === 0) return Object.freeze(items.map(statusOf));
    const pending = failed.flatMap((outcome) =>
      outcome.error instanceof ShutdownTimeoutError ? [...outcome.error.pending] : [],
    );
    const message = `${failed.length} of ${items.length} connection(s) failed to ${verb}`;
    throw pending.length
      ? new ShutdownTimeoutError(message, { pending, outcomes })
      : new ConnectionError(message, { outcomes, databaseOutcome: "uncertain" });
  }

  return {
    names: () => Object.freeze([...entries.keys()]),
    has: (/** @type {string} */ name) => entries.has(name),
    assert: (/** @type {string} */ name) => {
      entry(name);
    },
    getConnection: (/** @type {string} */ name = config.defaultConnection) =>
      entry(name).connection,
    getStatus: (/** @type {string} */ name = config.defaultConnection) => statusOf(entry(name)),
    listStatuses: () => Object.freeze([...entries.values()].map(statusOf)),
    isConnected: (/** @type {string} */ name = config.defaultConnection) =>
      statusOf(entry(name)).state === "ready",
    connect: (/** @type {string} */ name = config.defaultConnection) => connectEntry(entry(name)),
    disconnect: (/** @type {string} */ name = config.defaultConnection) =>
      disconnectEntry(entry(name)),
    connectAll: () => settleAll(connectEntry, "connect"),
    disconnectAll: () => settleAll(disconnectEntry, "disconnect"),
    /**
     * Admission/resource primitive for ordinary calls, transactions, jobs, and iterators.
     * Only a ready, non-closing connection admits work.
     * @param {string | undefined} name
     * @param {TrackedResource} resource
     * @returns {Admission}
     */
    admit(name, resource) {
      const item = entry(name);
      const state = statusOf(item).state;
      if (state !== "ready" || item.closing) {
        throw new ConnectionError(
          `Connection "${item.name}" is ${item.closing ? "closing" : state}`,
          {
            connection: item.name,
          },
        );
      }
      const tracked = { ...resource };
      item.resources.add(tracked);
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          item.resources.delete(tracked);
          if (item.resources.size === 0) {
            for (const waiter of item.waiters.splice(0)) waiter();
          }
        },
      };
    },
  };
}
