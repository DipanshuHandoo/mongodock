import { normalizeConfig } from "./config.js";
import { createConnectionManager } from "./connections/manager.js";
import { ConnectionError, InvalidOptionError } from "./errors.js";
import { createModelRegistry } from "./models/registry.js";
import { createOperations } from "./operations/index.js";
import { createExecutor } from "./hooks/pipeline.js";
import { createHealth } from "./health.js";
import { createSessionVerifier, createWithTransaction } from "./transactions.js";

/** @type {WeakMap<object, { executor: ReturnType<typeof createExecutor>, config: import("./types.js").NormalizedConfig }>} */
const internals = new WeakMap();

/**
 * Internal access for operation modules; not part of the public package surface.
 * @param {import("./types.js").MongoService} service
 */
export function getInternals(service) {
  const found = internals.get(service);
  if (!found) throw new TypeError("Not a MongoService created by createMongoService");
  return found;
}

/**
 * Creates a service over owned Mongoose connections. Nothing connects until connect().
 * @param {import("./types.js").MongoServiceConfig} [input]
 * @param {{ createConnection?: () => import("mongoose").Connection }} [internal]
 * @returns {import("./types.js").MongoService}
 */
export function createMongoService(input = {}, internal = {}) {
  const config = normalizeConfig(input);
  /** @type {ReturnType<typeof createExecutor>} */
  let executor;
  const manager = createConnectionManager({
    config,
    notify: (hookName, status) => {
      executor.observe(hookName, status).catch(() => undefined);
    },
    createConnection: internal.createConnection,
  });
  executor = createExecutor({
    config,
    admit: (name, resource) => manager.admit(name, resource),
  });
  /** @type {Map<string, ReturnType<typeof createModelRegistry>>} */
  const registries = new Map();
  const health = createHealth({ executor, manager, config });
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
  const createView = (name) => {
    const verifySession = createSessionVerifier(() => manager.getConnection(name));
    const resolve = (/** @type {unknown} */ reference) => resolveModel(name, reference);
    return Object.freeze({
      .../** @type {import("./types.js").OperationMethods} */ (
        /** @type {unknown} */ (
          createOperations({
            executor,
            config,
            connection: name,
            resolveModel: resolve,
            verifySession,
          })
        )
      ),
      name,
      withTransaction: createWithTransaction({
        executor,
        config,
        name,
        getConnection: () => manager.getConnection(name),
        resolveModel: resolve,
      }),
      healthCheck: (/** @type {unknown} */ options) => health.checkConnection(name, options),
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
  };

  /** @param {string} name @param {unknown} reference */
  function resolveModel(name, reference) {
    if (typeof reference === "string") return registry(name).getModel(reference);
    const model = /** @type {any} */ (reference);
    const connection = manager.getConnection(name);
    if (
      typeof model !== "function" ||
      model.db !== connection ||
      connection.models[model.modelName] !== model
    ) {
      throw new InvalidOptionError(
        "model must be a registered name or a Model on the selected connection",
      );
    }
    return model;
  }

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

  const service = Object.freeze({
    ...defaultView(),
    defaultConnection: config.defaultConnection,
    healthCheck: (/** @type {unknown} */ options) => health.checkAll(options),
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
  internals.set(service, { executor, config });
  return service;
}
