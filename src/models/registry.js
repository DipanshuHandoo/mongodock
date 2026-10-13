import { isDeepStrictEqual } from "node:util";
import { ModelRegistrationError } from "../errors.js";

const NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;

/** @param {unknown} value */
const isSchema = (value) =>
  !!value &&
  typeof value === "object" &&
  typeof (/** @type {{path?: unknown}} */ (value).path) === "function" &&
  typeof (/** @type {{add?: unknown}} */ (value).add) === "function" &&
  typeof (/** @type {{pre?: unknown}} */ (value).pre) === "function";

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isPlain = (value) =>
  !!value &&
  typeof value === "object" &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));

/**
 * One registry per connection. Schemas are compared by identity; collection and
 * compile options are compared by value. Unregistering never touches database state.
 * @param {import("mongoose").Connection} connection
 * @param {string} connectionName
 */
export function createModelRegistry(connection, connectionName) {
  /** @type {Map<string, {definition: Normalized, model: import("mongoose").Model<any>, compiled: boolean}>} */
  const registered = new Map();

  /** @typedef {{name: string, schema?: unknown, collection?: string | undefined, options: Record<string, unknown>, model?: import("mongoose").Model<any>}} Normalized */

  /** @param {string} message @param {unknown} [cause] */
  const failure = (message, cause) =>
    new ModelRegistrationError(message, { connection: connectionName, cause });

  /** @param {unknown} input @returns {Normalized} */
  function normalize(input) {
    if (!isPlain(input)) throw failure("Model definition must be a plain object");
    const keys = Object.keys(input);
    if ("model" in input) {
      const model = /** @type {any} */ (input.model);
      if (keys.length !== 1) throw failure("An existing model definition accepts only model");
      if (
        typeof model !== "function" ||
        typeof model.modelName !== "string" ||
        model.db !== connection ||
        connection.models[model.modelName] !== model
      ) {
        throw failure("Existing models must belong to the selected connection");
      }
      return { name: model.modelName, model, options: {} };
    }
    if (keys.some((key) => !["name", "schema", "collection", "options"].includes(key))) {
      throw failure("Model definition contains an unsupported option");
    }
    if (typeof input.name !== "string" || !NAME.test(input.name)) {
      throw failure("Model names must be 1..128 identifier characters");
    }
    if (!isSchema(input.schema)) throw failure("A Mongoose schema is required");
    if (
      input.collection !== undefined &&
      (typeof input.collection !== "string" || input.collection.length === 0)
    ) {
      throw failure("collection must be a nonempty string");
    }
    if (input.options !== undefined && !isPlain(input.options)) {
      throw failure("Model options must be a plain object");
    }
    const options = { ...(input.options ?? {}) };
    if ("overwriteModels" in options || "connection" in options) {
      throw failure("Model options cannot override registry collision or connection handling");
    }
    return {
      name: input.name,
      schema: input.schema,
      collection: input.collection,
      options,
    };
  }

  /** @param {Normalized} left @param {Normalized} right */
  const same = (left, right) =>
    left.model || right.model
      ? left.model === right.model
      : left.schema === right.schema &&
        left.collection === right.collection &&
        isDeepStrictEqual(left.options, right.options);

  /** @param {string} name */
  function missing(name) {
    return failure(`Model "${name}" is not registered on connection "${connectionName}"`);
  }

  /** @param {readonly unknown[]} definitions */
  function registerModels(definitions) {
    if (!Array.isArray(definitions)) throw failure("registerModels requires an array");
    /** @type {Map<string, Normalized>} */
    const pending = new Map();
    /** @type {Normalized[]} */
    const order = [];
    for (const input of definitions) {
      const definition = normalize(input);
      const prior = pending.get(definition.name) ?? registered.get(definition.name)?.definition;
      const known = registered.get(definition.name)?.model;
      const sameModel = !!definition.model && known === definition.model;
      if (prior && !sameModel && !same(prior, definition)) {
        throw failure(`Model "${definition.name}" conflicts with an existing registration`);
      }
      if (!prior) {
        if (connection.models[definition.name] && !definition.model) {
          throw failure(
            `Model "${definition.name}" already exists on the connection outside the registry`,
          );
        }
        order.push(definition);
      }
      pending.set(definition.name, prior ?? definition);
    }
    /** @type {string[]} */
    const created = [];
    try {
      for (const definition of order) {
        const compiled = !definition.model;
        const model =
          definition.model ??
          connection.model(
            definition.name,
            /** @type {import("mongoose").Schema} */ (definition.schema),
            definition.collection,
            definition.options,
          );
        registered.set(definition.name, { definition, model, compiled });
        if (compiled) created.push(definition.name);
      }
    } catch (cause) {
      // Models compiled in this call are removed; earlier registrations stay untouched.
      for (const name of created) {
        registered.delete(name);
        connection.deleteModel(name);
      }
      for (const definition of order) registered.delete(definition.name);
      throw failure("Model compilation failed; this registration was rolled back", cause);
    }
    return Object.freeze(
      definitions.map((input) => {
        const name =
          /** @type {{name?: string, model?: {modelName: string}}} */ (input).name ??
          /** @type {{model: {modelName: string}}} */ (input).model.modelName;
        return /** @type {import("mongoose").Model<any>} */ (registered.get(name)?.model);
      }),
    );
  }

  return {
    registerModels,
    /** @param {unknown} definition */
    registerModel: (definition) =>
      /** @type {import("mongoose").Model<any>} */ (registerModels([definition])[0]),
    /** @param {string} name */
    getModel(name) {
      const found = registered.get(name);
      if (!found) throw missing(name);
      return found.model;
    },
    /** @param {string} name */
    hasModel: (name) => registered.has(name),
    listModels: () => Object.freeze([...registered.keys()]),
    /** @param {string} name */
    unregisterModel(name) {
      const found = registered.get(name);
      if (!found) return false;
      registered.delete(name);
      if (found.compiled && connection.models[name] === found.model) connection.deleteModel(name);
      return true;
    },
  };
}
