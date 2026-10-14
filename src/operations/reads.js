import {
  applyQuery,
  assertKnownKeys,
  compact,
  normalizeFilter,
  normalizeId,
  normalizeLean,
  normalizeLimit,
  normalizeOptions,
  normalizePopulate,
  normalizeProjection,
  normalizeSkip,
  normalizeSort,
  RETURN_ALIASES,
} from "./query-options.js";

const NOT_FOR_READS = [...RETURN_ALIASES, "upsert", "runValidators", "multi"];
export const readOptions = (/** @type {unknown} */ value, /** @type {string} */ method) =>
  normalizeOptions(value, method, { forbid: NOT_FOR_READS });

/** @typedef {import("./spec.js").OperationSpec} OperationSpec */

/** @param {string} method @returns {OperationSpec} */
const listSpec = (method) => ({
  method,
  write: false,
  retryable: true,
  normalize: (body, { limits }) => {
    assertKnownKeys(
      body,
      ["filter", "projection", "sort", "populate", "lean", "limit", "skip", "options"],
      method,
    );
    return compact({
      filter: normalizeFilter(body.filter ?? {}),
      projection: normalizeProjection(body.projection),
      sort: normalizeSort(body.sort),
      populate: normalizePopulate(body.populate),
      lean: normalizeLean(body.lean),
      limit: normalizeLimit(body.limit, limits),
      skip: normalizeSkip(body.skip),
      options: readOptions(body.options, method),
    });
  },
  run: (model, input) => applyQuery(model.find(input.filter), input).exec(),
});

/** @type {readonly OperationSpec[]} */
export const readSpecs = Object.freeze([
  listSpec("find"),
  listSpec("findAll"),
  {
    method: "findOne",
    write: false,
    retryable: true,
    normalize: (body) => {
      assertKnownKeys(
        body,
        ["filter", "projection", "sort", "populate", "lean", "options"],
        "findOne",
      );
      return compact({
        filter: normalizeFilter(body.filter ?? {}),
        projection: normalizeProjection(body.projection),
        sort: normalizeSort(body.sort),
        populate: normalizePopulate(body.populate),
        lean: normalizeLean(body.lean),
        options: readOptions(body.options, "findOne"),
      });
    },
    run: (model, input) => applyQuery(model.findOne(input.filter), input).exec(),
  },
  {
    method: "findById",
    write: false,
    retryable: true,
    normalize: (body) => {
      assertKnownKeys(body, ["id", "projection", "populate", "lean", "options"], "findById");
      return compact({
        id: normalizeId(body.id),
        projection: normalizeProjection(body.projection),
        populate: normalizePopulate(body.populate),
        lean: normalizeLean(body.lean),
        options: readOptions(body.options, "findById"),
      });
    },
    run: (model, input) => applyQuery(model.findById(input.id), input).exec(),
  },
  {
    method: "exists",
    write: false,
    retryable: true,
    normalize: (body) => {
      assertKnownKeys(body, ["filter", "options"], "exists");
      return compact({
        filter: normalizeFilter(body.filter ?? {}),
        options: readOptions(body.options, "exists"),
      });
    },
    run: async (model, input) => {
      const found = await applyQuery(model.exists(input.filter), input).exec();
      return found !== null;
    },
  },
  {
    method: "countDocuments",
    write: false,
    retryable: true,
    normalize: (body) => {
      assertKnownKeys(body, ["filter", "options"], "countDocuments");
      return compact({
        filter: normalizeFilter(body.filter ?? {}),
        options: readOptions(body.options, "countDocuments"),
      });
    },
    run: (model, input) => applyQuery(model.countDocuments(input.filter), input).exec(),
  },
]);
