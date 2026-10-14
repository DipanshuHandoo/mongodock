import { InvalidOptionError } from "../errors.js";
import { assertKnownKeys, compact, normalizeFlag, normalizeOptions } from "./query-options.js";
import { scanPipeline } from "./guards.js";

/** @typedef {import("./spec.js").OperationSpec} OperationSpec */

/**
 * Materialized aggregation. Results are caller-owned memory; use the Phase 05 cursor for
 * large outputs. Never retried because pipelines may contain write stages.
 * @type {readonly OperationSpec[]}
 */
export const aggregateSpecs = Object.freeze([
  {
    method: "aggregate",
    write: false,
    retryable: false,
    normalize: (body) => {
      assertKnownKeys(body, ["pipeline", "options", "allowWriteStages"], "aggregate");
      const allowWriteStages = normalizeFlag(body.allowWriteStages, "allowWriteStages");
      scanPipeline(body.pipeline, allowWriteStages);
      const options = normalizeOptions(body.options, "aggregate", {
        forbid: ["cursor", "pipeline"],
      });
      if ("explain" in options && options.explain !== false) {
        throw new InvalidOptionError("aggregate explain output is not supported");
      }
      return compact({ pipeline: body.pipeline, options, allowWriteStages });
    },
    run: (model, input) => model.aggregate(input.pipeline, input.options).exec(),
  },
]);
