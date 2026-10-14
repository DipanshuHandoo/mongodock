import { InvalidOptionError } from "../errors.js";
import {
  applyQuery,
  assertKnownKeys,
  compact,
  normalizeFilter,
  normalizeFlag,
  normalizeLean,
  normalizeLimit,
  normalizePopulate,
  normalizeProjection,
} from "../operations/query-options.js";
import { readOptions } from "../operations/reads.js";
import { restoreDocs } from "./cursor.js";
import { toSortPairs, withIdTiebreaker } from "./sort.js";

/** @typedef {import("../operations/spec.js").OperationSpec} OperationSpec */

const DEFAULT_PAGE_SIZE = 20;

/** @type {OperationSpec} */
export const paginateSpec = {
  method: "paginate",
  write: false,
  retryable: true,
  normalize: (body, { limits }) => {
    assertKnownKeys(
      body,
      [
        "filter",
        "projection",
        "sort",
        "populate",
        "lean",
        "page",
        "skip",
        "limit",
        "includeTotal",
        "options",
      ],
      "paginate",
    );
    const page = body.page ?? 1;
    if (!Number.isSafeInteger(page) || page < 1) {
      throw new InvalidOptionError("page must be a positive integer");
    }
    const limit = normalizeLimit(
      body.limit ?? Math.min(DEFAULT_PAGE_SIZE, limits.maxReadLimit),
      limits,
    );
    const skip = (page - 1) * limit;
    if (!Number.isSafeInteger(skip)) throw new InvalidOptionError("page is out of range");
    return compact({
      filter: normalizeFilter(body.filter ?? {}),
      projection: normalizeProjection(body.projection),
      sort: withIdTiebreaker(toSortPairs(body.sort)),
      populate: normalizePopulate(body.populate),
      lean: normalizeLean(body.lean),
      options: readOptions(body.options, "paginate"),
      page,
      limit,
      skip,
      includeTotal:
        body.includeTotal === undefined ? true : normalizeFlag(body.includeTotal, "includeTotal"),
    });
  },
  run: async (model, input) => {
    const { filter, page, limit, skip, includeTotal } = input;
    const readData = () =>
      applyQuery(model.find(filter), {
        options: input.options,
        projection: input.projection,
        sort: input.sort,
        skip,
        limit: includeTotal ? limit : limit + 1,
        populate: input.populate,
        lean: input.lean,
      }).exec();
    const readTotal = () =>
      applyQuery(model.countDocuments(filter), { options: input.options }).exec();

    // Operations sharing a transaction session must not be interleaved.
    const sequential = input.options?.session?.inTransaction?.() === true;
    /** @type {any[]} */
    let found;
    /** @type {number | null} */
    let totalDocs = null;
    if (!includeTotal) {
      found = await readData();
    } else if (sequential) {
      totalDocs = await readTotal();
      found = await readData();
    } else {
      [totalDocs, found] = await Promise.all([readTotal(), readData()]);
    }
    const hasNextPage = totalDocs === null ? found.length > limit : skip + found.length < totalDocs;
    return {
      docs: found.length > limit ? found.slice(0, limit) : found,
      totalDocs,
      limit,
      page,
      totalPages: totalDocs === null ? null : Math.ceil(totalDocs / limit),
      hasNextPage,
      hasPrevPage: page > 1,
      nextPage: hasNextPage ? page + 1 : null,
      prevPage: page > 1 ? page - 1 : null,
    };
  },
  restore: restoreDocs,
};
