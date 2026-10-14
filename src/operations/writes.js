import { InvalidOptionError } from "../errors.js";
import { assertMutationFilter, isPlain } from "./guards.js";
import {
  applyQuery,
  assertKnownKeys,
  compact,
  normalizeFilter,
  normalizeFlag,
  normalizeId,
  normalizeLean,
  normalizeOptions,
  normalizePopulate,
  normalizeProjection,
  normalizeSort,
  normalizeUpdate,
  RETURN_ALIASES,
  resolveReturnDocument,
} from "./query-options.js";

/** @typedef {import("./spec.js").OperationSpec} OperationSpec */

const NO_RETURN = [...RETURN_ALIASES];
const NO_UPSERT = ["upsert", "runValidators"];
const VALIDATED = { runValidators: true };

/** @param {unknown} value @param {string} method */
function document(value, method) {
  if (!isPlain(value)) throw new InvalidOptionError(`${method} data must be a plain object`);
  return value;
}

/** @param {Record<string, unknown>} options */
const findAndModifyOptions = (options) => resolveReturnDocument(options);

/** @type {readonly OperationSpec[]} */
export const writeSpecs = Object.freeze([
  {
    method: "create",
    write: true,
    retryable: false,
    normalize: (body) => {
      assertKnownKeys(body, ["data", "options"], "create");
      return compact({
        data: document(body.data, "create"),
        options: normalizeOptions(body.options, "create", { forbid: NO_RETURN }),
      });
    },
    run: async (model, input) => {
      const [created] = await model.create([input.data], input.options ?? {});
      return created;
    },
  },
  {
    method: "insertMany",
    write: true,
    retryable: false,
    normalize: (body) => {
      assertKnownKeys(body, ["data", "options"], "insertMany");
      const data = body.data;
      if (!Array.isArray(data) || data.length === 0) {
        throw new InvalidOptionError("insertMany data must be a non-empty array");
      }
      for (const item of data) document(item, "insertMany");
      return compact({
        data,
        options: normalizeOptions(body.options, "insertMany", { forbid: NO_RETURN.slice(0, 3) }),
      });
    },
    run: (model, input) => model.insertMany(input.data, input.options ?? {}),
  },
  ...["updateOne", "updateMany"].map(
    (method) =>
      /** @type {OperationSpec} */ ({
        method,
        write: true,
        retryable: false,
        normalize: (body) => {
          assertKnownKeys(body, ["filter", "update", "options", "allowAll"], method);
          const allowAll = normalizeFlag(body.allowAll, "allowAll");
          const filter = normalizeFilter(body.filter);
          assertMutationFilter(filter, allowAll, method);
          return compact({
            filter,
            update: normalizeUpdate(body.update),
            options: normalizeOptions(body.options, method, {
              forbid: NO_RETURN,
              defaults: VALIDATED,
            }),
            allowAll,
          });
        },
        run: (model, input) =>
          model[/** @type {"updateOne"} */ (method)](input.filter, input.update, input.options),
      }),
  ),
  ...["deleteOne", "deleteMany"].map(
    (method) =>
      /** @type {OperationSpec} */ ({
        method,
        write: true,
        retryable: false,
        normalize: (body) => {
          assertKnownKeys(body, ["filter", "options", "allowAll"], method);
          const allowAll = normalizeFlag(body.allowAll, "allowAll");
          const filter = normalizeFilter(body.filter);
          assertMutationFilter(filter, allowAll, method);
          return compact({
            filter,
            options: normalizeOptions(body.options, method, {
              forbid: [...NO_RETURN, ...NO_UPSERT],
            }),
            allowAll,
          });
        },
        run: (model, input) =>
          model[/** @type {"deleteOne"} */ (method)](input.filter, input.options),
      }),
  ),
  {
    method: "findOneAndUpdate",
    write: true,
    retryable: false,
    normalize: (body) => {
      assertKnownKeys(
        body,
        ["filter", "update", "projection", "sort", "populate", "lean", "options", "allowAll"],
        "findOneAndUpdate",
      );
      const allowAll = normalizeFlag(body.allowAll, "allowAll");
      const filter = normalizeFilter(body.filter);
      assertMutationFilter(filter, allowAll, "findOneAndUpdate");
      const options = normalizeOptions(body.options, "findOneAndUpdate", {
        forbid: ["rawResult"],
        defaults: VALIDATED,
      });
      return compact({
        filter,
        update: normalizeUpdate(body.update),
        projection: normalizeProjection(body.projection),
        sort: normalizeSort(body.sort),
        populate: normalizePopulate(body.populate),
        lean: normalizeLean(body.lean),
        options: findAndModifyOptions(options),
        allowAll,
      });
    },
    run: (model, input) =>
      applyQuery(model.findOneAndUpdate(input.filter, input.update), input).exec(),
  },
  {
    method: "findByIdAndUpdate",
    write: true,
    retryable: false,
    normalize: (body) => {
      assertKnownKeys(
        body,
        ["id", "update", "projection", "populate", "lean", "options"],
        "findByIdAndUpdate",
      );
      const options = normalizeOptions(body.options, "findByIdAndUpdate", {
        forbid: ["rawResult"],
        defaults: VALIDATED,
      });
      return compact({
        id: normalizeId(body.id),
        update: normalizeUpdate(body.update),
        projection: normalizeProjection(body.projection),
        populate: normalizePopulate(body.populate),
        lean: normalizeLean(body.lean),
        options: findAndModifyOptions(options),
      });
    },
    run: (model, input) =>
      applyQuery(model.findByIdAndUpdate(input.id, input.update), input).exec(),
  },
  {
    method: "findOneAndDelete",
    write: true,
    retryable: false,
    normalize: (body) => {
      assertKnownKeys(
        body,
        ["filter", "projection", "sort", "populate", "lean", "options", "allowAll"],
        "findOneAndDelete",
      );
      const allowAll = normalizeFlag(body.allowAll, "allowAll");
      const filter = normalizeFilter(body.filter);
      assertMutationFilter(filter, allowAll, "findOneAndDelete");
      return compact({
        filter,
        projection: normalizeProjection(body.projection),
        sort: normalizeSort(body.sort),
        populate: normalizePopulate(body.populate),
        lean: normalizeLean(body.lean),
        options: normalizeOptions(body.options, "findOneAndDelete", {
          forbid: [...NO_RETURN.filter((key) => key !== "includeResultMetadata"), ...NO_UPSERT],
        }),
        allowAll,
      });
    },
    run: (model, input) => applyQuery(model.findOneAndDelete(input.filter), input).exec(),
  },
  {
    method: "findByIdAndDelete",
    write: true,
    retryable: false,
    normalize: (body) => {
      assertKnownKeys(
        body,
        ["id", "projection", "populate", "lean", "options"],
        "findByIdAndDelete",
      );
      return compact({
        id: normalizeId(body.id),
        projection: normalizeProjection(body.projection),
        populate: normalizePopulate(body.populate),
        lean: normalizeLean(body.lean),
        options: normalizeOptions(body.options, "findByIdAndDelete", {
          forbid: [...NO_RETURN.filter((key) => key !== "includeResultMetadata"), ...NO_UPSERT],
        }),
      });
    },
    run: (model, input) => applyQuery(model.findByIdAndDelete(input.id), input).exec(),
  },
]);
