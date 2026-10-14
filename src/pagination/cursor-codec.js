import { createHash } from "node:crypto";
import { InvalidOptionError } from "../errors.js";
import { isPlain } from "../operations/guards.js";

export const MAX_TOKEN_LENGTH = 8192;
const VERSION = 1;
const MAX_DEPTH = 32;
const TAGS = new Set(["s", "n", "b", "d", "o"]);
const MISMATCH = "cursor is invalid or does not match this query";

/** @param {unknown} value @returns {value is { toHexString(): string }} */
const isObjectId = (value) =>
  !!value &&
  typeof value === "object" &&
  /** @type {any} */ (value)._bsontype === "ObjectId" &&
  typeof (/** @type {any} */ (value).toHexString) === "function";

/**
 * Stable, unambiguous structure for supported query values; anything else is rejected rather
 * than hashed unstably.
 * @param {unknown} value @param {number} [depth]
 * @returns {unknown}
 */
function canonical(value, depth = 0) {
  if (depth > MAX_DEPTH) throw new InvalidOptionError("filter is nested too deeply for a cursor");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new InvalidOptionError("filter numbers must be finite");
    return Object.is(value, -0) ? 0 : value;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new InvalidOptionError("filter contains an invalid Date");
    }
    return { $date: value.getTime() };
  }
  if (isObjectId(value)) return { $oid: value.toHexString() };
  if (value instanceof RegExp) return { $re: [value.source, value.flags] };
  if (Array.isArray(value)) return value.map((item) => canonical(item, depth + 1));
  if (isPlain(value)) {
    return {
      $obj: Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key], depth + 1)]),
    };
  }
  throw new InvalidOptionError("filter contains a value that cannot be bound to a cursor");
}

/** @param {unknown} filter */
export const filterDigest = (filter) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(filter)))
    .digest("hex");

/**
 * @param {unknown} value
 * @returns {[string, string | number | boolean]}
 */
export function encodeValue(value) {
  if (typeof value === "string") return ["s", value];
  if (typeof value === "boolean") return ["b", value];
  if (typeof value === "number" && Number.isFinite(value)) return ["n", value];
  if (value instanceof Date && !Number.isNaN(value.getTime())) return ["d", value.getTime()];
  if (isObjectId(value)) return ["o", value.toHexString()];
  throw new InvalidOptionError(
    "keyset sort values must be non-null ObjectId, Date, string, finite number or boolean scalars",
  );
}

/**
 * @param {[string, string | number | boolean]} entry
 * @param {new (hex: string) => unknown} ObjectIdClass
 */
function decodeValue(entry, ObjectIdClass) {
  const [tag, raw] = entry;
  if (tag === "d") return new Date(/** @type {number} */ (raw));
  if (tag === "o") return new ObjectIdClass(/** @type {string} */ (raw));
  return raw;
}

/**
 * @typedef {object} CursorIdentity
 * @property {string} connection
 * @property {string} model
 * @property {[string, 1 | -1][]} sort
 * @property {string} digest
 */

/** @param {CursorIdentity & { values: [string, string | number | boolean][] }} payload */
export function encodeToken({ connection, model, sort, digest, values }) {
  const token = Buffer.from(
    JSON.stringify({
      v: VERSION,
      c: connection,
      m: model,
      s: sort,
      q: digest,
      col: "simple",
      k: values,
    }),
  ).toString("base64url");
  if (token.length > MAX_TOKEN_LENGTH) {
    throw new InvalidOptionError(
      "cursor would exceed the maximum token size; use shorter sort values",
    );
  }
  return token;
}

/**
 * The size is checked before any decoding. Tokens are validated continuation data, not
 * credentials: they are not signed and must never be treated as authorization.
 * @param {unknown} token @param {CursorIdentity} expected @param {new (hex: string) => unknown} ObjectIdClass
 */
export function decodeToken(token, expected, ObjectIdClass) {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    throw new InvalidOptionError(MISMATCH);
  }
  /** @type {any} */
  let payload;
  try {
    payload = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch {
    throw new InvalidOptionError(MISMATCH);
  }
  const valid =
    isPlain(payload) &&
    payload.v === VERSION &&
    payload.c === expected.connection &&
    payload.m === expected.model &&
    payload.q === expected.digest &&
    payload.col === "simple" &&
    JSON.stringify(payload.s) === JSON.stringify(expected.sort) &&
    Array.isArray(payload.k) &&
    payload.k.length === expected.sort.length &&
    payload.k.every(
      (/** @type {unknown} */ entry) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        TAGS.has(entry[0]) &&
        ["string", "number", "boolean"].includes(typeof entry[1]) &&
        (entry[0] !== "n" || Number.isFinite(entry[1])) &&
        (entry[0] !== "d" || Number.isFinite(entry[1])) &&
        (entry[0] !== "o" || /^[0-9a-f]{24}$/i.test(entry[1])),
    );
  if (!valid) throw new InvalidOptionError(MISMATCH);
  return payload.k.map((/** @type {[string, string | number | boolean]} */ entry) =>
    decodeValue(entry, ObjectIdClass),
  );
}
