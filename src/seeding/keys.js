import { BulkError, InvalidOptionError } from "../errors.js";

const MAX_KEY_FIELDS = 8;
const SCALAR_BSON = new Set(["ObjectId", "Decimal128", "Long", "Int32", "Double", "Binary"]);

/** @param {unknown} value */
export function normalizeKeyFields(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_KEY_FIELDS) {
    throw new InvalidOptionError(`keyFields must be an array of 1..${MAX_KEY_FIELDS} field names`);
  }
  const seen = new Set();
  for (const field of value) {
    if (typeof field !== "string" || field.length === 0) {
      throw new InvalidOptionError("keyFields entries must be non-empty strings");
    }
    if (field.startsWith("$") || field.includes(".")) {
      throw new InvalidOptionError(
        `keyFields entry "${field}" must be a top-level field name without "$" or "."`,
      );
    }
    if (seen.has(field)) throw new InvalidOptionError(`keyFields repeats "${field}"`);
    seen.add(field);
  }
  return /** @type {string[]} */ ([...value]);
}

/** @param {unknown} value */
export function isScalarKey(value) {
  if (typeof value === "string") return value.length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  const tag = /** @type {any} */ (value)?._bsontype;
  return typeof tag === "string" && SCALAR_BSON.has(tag);
}

/** @param {unknown} value */
function identityOf(value) {
  if (value instanceof Date) return `d:${value.getTime()}`;
  const tag = /** @type {any} */ (value)?._bsontype;
  if (tag === "Binary") return `b:${/** @type {any} */ (value).toString("hex")}`;
  if (typeof tag === "string") return `${tag}:${String(value)}`;
  return `${typeof value}:${String(value)}`;
}

/**
 * Stable identity of a key tuple, used only for the bounded within-batch duplicate check.
 * @param {Record<string, unknown>} filter @param {readonly string[]} keyFields
 */
export const keyIdentity = (filter, keyFields) =>
  JSON.stringify(keyFields.map((field) => identityOf(filter[field])));

/**
 * @param {Record<string, any>} index @param {readonly string[]} keyFields
 */
function matchesUniqueKey(index, keyFields) {
  const key = index.key ?? {};
  const fields = Object.keys(key);
  if (fields.length !== keyFields.length || !keyFields.every((field) => fields.includes(field))) {
    return false;
  }
  const simpleKey = Object.values(key).every((direction) => Math.abs(Number(direction)) === 1);
  return (
    simpleKey &&
    index.unique === true &&
    index.sparse !== true &&
    index.partialFilterExpression === undefined &&
    index.collation === undefined
  );
}

/** @param {any} error */
const missingCollection = (error) =>
  error?.code === 26 ||
  error?.codeName === "NamespaceNotFound" ||
  /ns does not exist/i.test(error?.message ?? "");

/**
 * Inspects the real collection indexes; schema declarations alone do not prove enforcement.
 * @param {import("mongoose").Model<any>} model @param {readonly string[]} keyFields
 */
export async function assertSeedIndex(model, keyFields) {
  for (const field of keyFields) {
    if (!model.schema.path(field)) {
      throw new InvalidOptionError(
        `keyFields entry "${field}" is not a path of ${model.modelName}`,
      );
    }
  }
  if (keyFields.length === 1 && keyFields[0] === "_id") return;
  /** @type {Record<string, any>[]} */
  let indexes = [];
  try {
    indexes = await model.collection.indexes();
  } catch (error) {
    if (!missingCollection(error)) {
      throw new BulkError("Could not inspect indexes before seeding; nothing was written", {
        cause: error,
        databaseOutcome: "notDispatched",
      });
    }
  }
  if (indexes.some((index) => matchesUniqueKey(index, keyFields))) return;
  throw new BulkError(
    `Seeding ${model.modelName} by [${keyFields.join(", ")}] requires an existing unique index on exactly those fields ` +
      "(no sparse, partial or collation options). Create it first, for example with Model.createIndexes(); " +
      "nothing was written",
    { databaseOutcome: "notDispatched" },
  );
}
