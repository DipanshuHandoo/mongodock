import { InvalidOptionError } from "../errors.js";
import { paginateCursorSpec } from "../pagination/cursor.js";
import { paginateSpec } from "../pagination/offset.js";
import { streamSpecs } from "../streaming/iterate.js";
import { aggregateSpecs } from "./aggregate.js";
import { bulkWriteSpec } from "../bulk/bulk-write.js";
import { isPlain } from "./guards.js";
import { readSpecs } from "./reads.js";
import { writeSpecs } from "./writes.js";

const SPECS = Object.freeze([
  ...readSpecs,
  paginateSpec,
  paginateCursorSpec,
  ...writeSpecs,
  bulkWriteSpec,
  ...aggregateSpecs,
  ...streamSpecs,
]);
export const OPERATION_METHODS = Object.freeze(SPECS.map((spec) => spec.method));

/**
 * @typedef {object} OperationScope
 * @property {unknown} session The transaction session every call in this scope uses.
 * @property {() => () => void} begin Admits one call (rejects when closed, cancelled or busy).
 * @property {(params: Record<string, any>) => Record<string, any>} decorate
 */

/**
 * Builds the public operation methods for one connection. Each call resolves its model once,
 * validates the caller input, and runs through the shared executor; hook-transformed input is
 * re-validated and cannot elevate permissions or change the session.
 * @param {object} deps
 * @param {ReturnType<typeof import("../hooks/pipeline.js").createExecutor>} deps.executor
 * @param {import("../types.js").NormalizedConfig} deps.config
 * @param {string} deps.connection
 * @param {(model: unknown) => import("mongoose").Model<any>} deps.resolveModel
 * @param {(session: unknown) => void} [deps.verifySession] Rejects sessions this connection must not use.
 * @param {OperationScope} [deps.scope] Pins every call to one transaction session.
 */
export function createOperations({
  executor,
  config,
  connection,
  resolveModel,
  verifySession,
  scope,
}) {
  const context = { limits: config.limits };
  const env = Object.freeze({ connection, limits: config.limits });
  /** @type {Record<string, (params: any) => any>} */
  const methods = {};
  for (const spec of SPECS) {
    const invoke = (/** @type {any} */ given) => {
      if (!isPlain(given))
        throw new InvalidOptionError(`${spec.method} input must be a plain object`);
      const params = scope ? scope.decorate(given) : given;
      const { model: reference, signal, correlationId, hooks, retry, metadata, ...body } = params;
      const model = resolveModel(reference);
      const input = spec.normalize(body, context);
      const session = input.options?.session;
      if (session !== undefined && !scope) verifySession?.(session);
      const common = {
        method: spec.method,
        connection,
        model: model.modelName,
        correlationId,
        signal,
        hooks,
        retry,
        metadata,
        write: spec.write,
        transactional: session?.inTransaction?.() === true,
        retryable: spec.retryable && session === undefined,
        input,
        finalizeInput: (/** @type {any} */ current) => {
          const next = spec.normalize(current, context);
          if (next.options?.session !== session) {
            throw new InvalidOptionError("Hooks cannot change the session");
          }
          if (
            (next.allowAll && !input.allowAll) ||
            (next.allowWriteStages && !input.allowWriteStages)
          ) {
            throw new InvalidOptionError("Hooks cannot elevate safety permissions");
          }
          return next;
        },
      };
      if (spec.stream && spec.open) {
        const { open } = spec;
        return executor.executeStream({
          ...common,
          open: (/** @type {any} */ final, /** @type {any} */ ctx) => open(model, final, env, ctx),
        });
      }
      const run = /** @type {NonNullable<typeof spec.run>} */ (spec.run);
      return executor.execute({
        ...common,
        restoreResult: spec.restore,
        ...(spec.classify ? { classify: spec.classify } : {}),
        run: (/** @type {any} */ final, /** @type {any} */ ctx) => run(model, final, env, ctx),
      });
    };
    // Materialized methods always reject rather than throw; streams validate synchronously.
    if (!scope) {
      methods[spec.method] = spec.stream ? invoke : async (params) => invoke(params);
    } else if (spec.stream) {
      methods[spec.method] = (params) =>
        guardedStream(scope, /** @type {AsyncGenerator<unknown, void, void>} */ (invoke(params)));
    } else {
      methods[spec.method] = async (params) => {
        const release = scope.begin();
        try {
          return await invoke(params);
        } finally {
          release();
        }
      };
    }
  }
  return Object.freeze(methods);
}

/** @param {OperationScope} scope @param {AsyncGenerator<unknown, void, void>} inner */
async function* guardedStream(scope, inner) {
  const release = scope.begin();
  try {
    yield* inner;
  } finally {
    release();
  }
}
