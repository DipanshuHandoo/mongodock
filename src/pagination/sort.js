import { InvalidOptionError } from "../errors.js";
import { isPlain } from "../operations/guards.js";

const DIRECTIONS = new Map(
  /** @type {[unknown, 1 | -1][]} */ ([
    [1, 1],
    [-1, -1],
    ["asc", 1],
    ["ascending", 1],
    ["desc", -1],
    ["descending", -1],
  ]),
);

/**
 * Normalizes any supported sort shape into ordered [field, direction] pairs.
 * Pairs preserve order for numeric-like field names, which plain objects would reorder.
 * @param {unknown} sort
 * @returns {[string, 1 | -1][]}
 */
export function toSortPairs(sort) {
  if (sort === undefined) return [];
  /** @type {unknown[]} */
  let entries;
  if (typeof sort === "string") {
    entries = sort
      .split(/\s+/)
      .filter(Boolean)
      .map((token) =>
        token.startsWith("-") ? [token.slice(1), -1] : [token.replace(/^\+/, ""), 1],
      );
  } else if (Array.isArray(sort)) {
    entries = sort;
  } else if (isPlain(sort)) {
    entries = Object.entries(sort);
  } else {
    throw new InvalidOptionError("sort must be a string, object, or [field, direction] pairs");
  }
  const pairs = entries.map((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || !entry[0]) {
      throw new InvalidOptionError("sort must be a string, object, or [field, direction] pairs");
    }
    const direction = DIRECTIONS.get(entry[1]);
    if (direction === undefined) {
      throw new InvalidOptionError("paginated sort supports only ascending and descending order");
    }
    return /** @type {[string, 1 | -1]} */ ([entry[0], direction]);
  });
  if (new Set(pairs.map(([field]) => field)).size !== pairs.length) {
    throw new InvalidOptionError("sort must not repeat a field");
  }
  return pairs;
}

/**
 * Makes ordering total and deterministic by ending with the unique _id.
 * @param {[string, 1 | -1][]} pairs
 * @returns {[string, 1 | -1][]}
 */
export function withIdTiebreaker(pairs) {
  const at = pairs.findIndex(([field]) => field === "_id");
  if (at === -1) return [...pairs, ["_id", 1]];
  if (at !== pairs.length - 1) {
    throw new InvalidOptionError("_id must be the last sort key because it is unique");
  }
  return pairs;
}
