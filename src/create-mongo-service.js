import { normalizeConfig } from "./config.js";
import { createConnectionManager } from "./connections/manager.js";
import { ConnectionError } from "./errors.js";
import { createModelRegistry } from "./models/registry.js";

/**
 * Hook failures never escape the notifier; they are routed to onHookError.
 * @param {import("./types.js").NormalizedConfig} config
 */
function createNotifier(config) {
  /** @param {unknown} error @param {string} hookName @param {string} scope */
  const report = (error, hookName, scope) => {
    try {
      const handler = config.hooks.onHookError;
      Promise.resolve(handler?.({ error, hookName, scope })).catch(() => undefined);
    } catch {
      // onHookError itself failed; nothing further can be reported.
    }
  };
  return (/** @type {string} */ hookName, /** @type {unknown} */ status) => {
    const sources = [
      ...config.plugins.map((plugin) => [plugin.name, plugin.hooks]),
      ["service", config.hooks],
    ];
    for (const [scope, hooks] of /** @type {Array<[string, any]>} */ (sources)) {
      const hook = hooks[hookName];
      if (typeof hook !== "function") continue;
      try {
        Promise.resolve(hook(status)).catch((error) => report(error, hookName, scope));
      } catch (error) {
        report(error, hookName, scope);
      }
    }
  };
}

/**
 * Creates a service over owned Mongoose connections. Nothing connects until connect().
 * @param {import("./types.js").MongoServiceConfig} [input]
 * @param {{ createConnection?: () => import("mongoose").Connection }} [internal]
 * @returns {import("./types.js").MongoService}
 */
export function createMongoService(input = {}, internal = {}) {
  const config = normalizeConfig(input);
  const manager = createConnectionManager({
    config,
    notify: createNotifier(config),
    createConnection: internal.createConnection,
  });
  /** @type {Map<string, ReturnType<typeof createModelRegistry>>} */
  const registries = new Map();
  /** @param {string | undefined} name */
  const registry = (name) => {
    const key = name ?? config.defaultConnection;
    manager.assert(key);
    let found = registries.get(key);
    if (!found) {
      found = createModelRegistry(manager.getConnection(key), key);
      registries.set(key, found);
    }
    return found;
  };

  /** @param {string} name */
  const createView = (name) =>
    Object.freeze({
      name,
      connect: () => manager.connect(name),
      disconnect: () => manager.disconnect(name),
      getConnection: () => manager.getConnection(name),
      isConnected: () => manager.isConnected(name),
      getStatus: () => manager.getStatus(name),
      registerModel: (/** @type {any} */ definition) => registry(name).registerModel(definition),
      registerModels: (/** @type {any} */ definitions) =>
        registry(name).registerModels(definitions),
      getModel: (/** @type {string} */ model) => registry(name).getModel(model),
      hasModel: (/** @type {string} */ model) => registry(name).hasModel(model),
      listModels: () => registry(name).listModels(),
      unregisterModel: (/** @type {string} */ model) => registry(name).unregisterModel(model),
    });

  /** @type {Map<string, import("./types.js").ConnectionView>} */
  const views = new Map();
  const defaultView = () => use(config.defaultConnection);
  /** @param {string} name */
  function use(name) {
    if (typeof name !== "string" || !manager.has(name)) {
      throw new ConnectionError("Unknown connection name");
    }
    const view = views.get(name) ?? createView(name);
    views.set(name, view);
    return view;
  }

  return Object.freeze({
    ...defaultView(),
    defaultConnection: config.defaultConnection,
    connect: (/** @type {string} */ name = config.defaultConnection) => manager.connect(name),
    disconnect: (/** @type {string} */ name = config.defaultConnection) => manager.disconnect(name),
    connectAll: () => manager.connectAll(),
    disconnectAll: () => manager.disconnectAll(),
    getConnection: (/** @type {string} */ name = config.defaultConnection) =>
      manager.getConnection(name),
    isConnected: (/** @type {string} */ name = config.defaultConnection) =>
      manager.isConnected(name),
    getStatus: (/** @type {string} */ name = config.defaultConnection) => manager.getStatus(name),
    listStatuses: () => manager.listStatuses(),
    listConnections: () => manager.names(),
    use,
  });
}
