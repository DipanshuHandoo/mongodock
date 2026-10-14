import { InvalidOptionError } from "../errors.js";
import { isEmptyFilter, isPlain } from "../operations/guards.js";
import {
  applyQuery,
  assertKnownKeys,
  compact,
  normalizeFilter,
  normalizeLean,
  normalizeLimit,
  normalizePopulate,
  normalizeProjection,
} from "../operations/query-options.js";
import { readOptions } from "../operations/reads.js";
import { decodeToken, encodeToken, encodeValue, filterDigest } from "./cursor-codec.js";
import { toSortPairs, withIdTiebreaker } from "./sort.js";

/** @typedef {import("../operations/spec.js").OperationSpec} OperationSpec */
/** @typedef {[string, 1 | -1][]} SortPairs */

/** @param {unknown} projection @returns {{ mode: "inclusion" | "exclusion", fields: Map<string, boolean> } | undefined} */
function parseProjection(projection) {
  if (projection === undefined) return undefined;
  /** @type {[string, unknown][]} */
  let entries;
  if (typeof projection === "string") {
    entries = projection
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => {
        if (token.startsWith("+")) {
          throw new InvalidOptionError("projection +field is not supported with keyset sorting");
        }
        return token.startsWith("-") ? [token.slice(1), 0] : [token, 1];
      });
  } else if (isPlain(projection)) {
    entries = Object.entries(projection);
  } else {
    throw new InvalidOptionError("projection must be a string or plain object");
  }
  const fields = new Map();
  for (const [field, value] of entries) {
    if (value !== 0 && value !== 1 && value !== true && value !== false) {
      throw new InvalidOptionError("projection expressions are not supported with keyset sorting");
    }
    fields.set(field, value === 1 || value === true);
  }
  const included = [...fields].filter(([field, on]) => on && field !== "_id");
  const excluded = [...fields].filter(([field, on]) => !on && field !== "_id");
  if (included.length > 0 && excluded.length > 0) {
    throw new InvalidOptionError("projection cannot mix inclusion and exclusion");
  }
  /** @type {"inclusion" | "exclusion"} */
  let mode = "exclusion";
  if (included.length > 0) mode = "inclusion";
  else if (excluded.length === 0 && fields.get("_id") === true) mode = "inclusion";
  return { mode, fields };
}

/**
 * Makes sure every sort key is fetched so the continuation can be captured, and reports which
 * keys were added only for that purpose (hidden). Hidden keys can only be stripped from lean
 * results, so they are rejected for hydrated documents rather than leaked or half-removed.
 * @param {unknown} projection @param {SortPairs} sort @param {boolean} lean
 */
export function projectionPlan(projection, sort, lean) {
  const parsed = parseProjection(projection);
  if (!parsed) return { projection, hidden: /** @type {string[]} */ ([]) };
  const covered = (/** @type {string} */ field) => {
    const parts = field.split(".");
    for (let end = parts.length; end > 0; end -= 1) {
      const value = parsed.fields.get(parts.slice(0, end).join("."));
      if (value !== undefined) return { value, exact: end === parts.length };
    }
    return undefined;
  };
  /** @type {string[]} */
  const hidden = [];
  const next = new Map(parsed.fields);
  for (const [field] of sort) {
    const hit = covered(field);
    if (parsed.mode === "inclusion") {
      if (field === "_id") {
        if (parsed.fields.get("_id") === false) {
          throw new InvalidOptionError("projection cannot exclude _id with keyset sorting");
        }
        continue;
      }
      if (hit?.value) continue;
      next.set(field, true);
      hidden.push(field);
    } else if (hit && !hit.value) {
      if (!hit.exact) {
        throw new InvalidOptionError(`projection excludes a parent of sort field "${field}"`);
      }
      next.delete(field);
      hidden.push(field);
    }
  }
  if (hidden.length === 0) return { projection, hidden };
  if (!lean) {
    throw new InvalidOptionError(
      `sort fields (${hidden.join(", ")}) are missing from the projection; include them or use lean: true`,
    );
  }
  if (hidden.some((field) => field.includes("."))) {
    throw new InvalidOptionError("nested sort fields must be part of the projection");
  }
  return { projection: Object.fromEntries([...next].map(([k, on]) => [k, on ? 1 : 0])), hidden };
}

/** @param {any} doc @param {string} path */
function getPath(doc, path) {
  if (typeof doc?.get === "function") return doc.get(path);
  return path.split(".").reduce((value, key) => value?.[key], doc);
}

/**
 * Lexicographic "strictly after" predicate; every key compares in its own direction.
 * @param {SortPairs} sort @param {unknown[]} values
 */
export function keysetPredicate(sort, values) {
  return {
    $or: sort.map(([field, direction], index) => ({
      ...Object.fromEntries(sort.slice(0, index).map(([prior], i) => [prior, values[i]])),
      [field]: { [direction === 1 ? "$gt" : "$lt"]: values[index] },
    })),
  };
}

/** @param {unknown} options */
export function assertSimpleCollation(options) {
  const collation = /** @type {any} */ (options)?.collation;
  if (collation !== undefined && collation?.locale !== "simple") {
    throw new InvalidOptionError("keyset pagination requires the simple collation");
  }
}

/**
 * One keyset page. Fetches limit+1 to detect another page without a count.
 * @param {import("mongoose").Model<any>} model
 * @param {{ connection: string }} env
 * @param {any} input
 * @param {{ limit: number, cursor?: string | undefined }} page
 */
export async function runKeyset(model, env, input, { limit, cursor }) {
  const sort = /** @type {SortPairs} */ (input.sort);
  const identity = {
    connection: env.connection,
    model: model.modelName,
    sort,
    digest: filterDigest(input.filter),
  };
  const plan = projectionPlan(input.projection, sort, input.lean === true);
  let filter = input.filter;
  if (cursor !== undefined) {
    const values = decodeToken(cursor, identity, model.base.Types.ObjectId);
    const predicate = keysetPredicate(sort, values);
    filter = isEmptyFilter(filter) ? predicate : { $and: [filter, predicate] };
  }
  const found = await applyQuery(model.find(filter), {
    options: input.options,
    projection: plan.projection,
    sort,
    limit: limit + 1,
    populate: input.populate,
    lean: input.lean,
  }).exec();
  const hasNextPage = found.length > limit;
  const docs = hasNextPage ? found.slice(0, limit) : found;
  const last = docs[docs.length - 1];
  const nextCursor = hasNextPage
    ? encodeToken({ ...identity, values: sort.map(([field]) => encodeValue(getPath(last, field))) })
    : null;
  for (const field of plan.hidden) for (const doc of docs) delete (/** @type {any} */ (doc)[field]);
  return { docs, hasNextPage, nextCursor };
}

/** @param {Record<string, any>} body @param {string} method @param {{ readLimit: number, maxReadLimit: number }} limits */
export function normalizeKeyset(body, method, limits) {
  const sort = withIdTiebreaker(toSortPairs(body.sort));
  const options = readOptions(body.options, method);
  assertSimpleCollation(options);
  const lean = normalizeLean(body.lean);
  const projection = normalizeProjection(body.projection);
  projectionPlan(projection, sort, lean);
  return compact({
    filter: normalizeFilter(body.filter ?? {}),
    projection,
    sort,
    populate: normalizePopulate(body.populate),
    lean,
    options,
    limit: normalizeLimit(body.limit, limits),
  });
}

/** @type {OperationSpec} */
export const paginateCursorSpec = {
  method: "paginateCursor",
  write: false,
  retryable: true,
  normalize: (body, { limits }) => {
    assertKnownKeys(
      body,
      ["filter", "projection", "sort", "populate", "lean", "limit", "cursor", "options"],
      "paginateCursor",
    );
    if (body.cursor !== undefined && typeof body.cursor !== "string") {
      throw new InvalidOptionError("cursor must be a string");
    }
    return compact({
      ...normalizeKeyset(body, "paginateCursor", {
        readLimit: Math.min(20, limits.maxReadLimit),
        maxReadLimit: limits.maxReadLimit,
      }),
      cursor: body.cursor,
    });
  },
  run: async (model, input, env) => {
    const page = await runKeyset(model, env, input, { limit: input.limit, cursor: input.cursor });
    return {
      docs: page.docs,
      limit: input.limit,
      hasNextPage: page.hasNextPage,
      nextCursor: page.nextCursor,
    };
  },
  restore: (original, replaced) => restoreDocs(original, replaced),
};

/** Result hooks may replace the documents only; paging metadata stays authoritative. */
export function restoreDocs(/** @type {any} */ original, /** @type {any} */ replaced) {
  if (!isPlain(replaced) || !Array.isArray(replaced.docs)) {
    throw new InvalidOptionError("afterOperation may only replace the docs of a page");
  }
  return { ...original, docs: replaced.docs };
}
