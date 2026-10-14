/**
 * @template T
 * @typedef {ReturnType<ReturnType<import("mongoose").Model<T>["find"]>["getFilter"]>} ModelFilter
 */
/**
 * @template T
 * @typedef {object} FindInput
 * @property {string | import("mongoose").Model<T>} model
 * @property {ModelFilter<T>} [filter]
 * @property {import("mongoose").QueryOptions<T>} [options]
 * @property {import("mongoose").ProjectionType<T>} [projection]
 * @property {import("mongoose").PopulateOptions | import("mongoose").PopulateOptions[]} [populate]
 * @property {boolean} [lean]
 * @property {number} [limit]
 * @property {number} [skip]
 * @property {AbortSignal} [signal]
 * @property {import("./types.js").Hooks<FindInput<T>, T[] | import("mongoose").HydratedDocument<T>[]>} [hooks]
 * @property {boolean | import("./types.js").RetryOptions} [retry]
 */
/**
 * @template T
 * @typedef {object} CreateInput
 * @property {string | import("mongoose").Model<T>} model
 * @property {T} data
 * @property {import("mongoose").SaveOptions} [options]
 * @property {AbortSignal} [signal]
 */
/**
 * @template T
 * @typedef {object} MutationInput
 * @property {string | import("mongoose").Model<T>} model
 * @property {ModelFilter<T>} filter
 * @property {import("mongoose").UpdateQuery<T>} [update]
 * @property {import("mongoose").QueryOptions<T>} [options]
 * @property {boolean} [allowAll]
 * @property {AbortSignal} [signal]
 */
/**
 * @template T
 * @typedef {object} NativeBulkInput
 * @property {string | import("mongoose").Model<T>} model
 * @property {false} [batching]
 * @property {Parameters<import("mongoose").Model<T>["bulkWrite"]>[0]} operations
 * @property {import("mongoose").MongooseBulkWriteOptions} [options]
 * @property {boolean} [allowAll]
 */
/**
 * @template T
 * @typedef {object} BatchedBulkInput
 * @property {string | import("mongoose").Model<T>} model
 * @property {true} batching
 * @property {Iterable<Parameters<import("mongoose").Model<T>["bulkWrite"]>[0][number]> | AsyncIterable<Parameters<import("mongoose").Model<T>["bulkWrite"]>[0][number]>} operations
 * @property {import("mongoose").MongooseBulkWriteOptions} [options]
 * @property {number} [batchSize]
 * @property {number} [concurrency]
 * @property {number} [maxBatchBytes]
 * @property {boolean} [ordered]
 * @property {"continue" | "stop"} [failureMode]
 * @property {boolean} [allowAll]
 * @property {AbortSignal} [signal]
 * @property {(outcome: import("./bulk/outcomes.js").BatchOutcome) => void | Promise<void>} [onBatch] Awaited per batch; may run concurrently and out of index order.
 */
/**
 * @template T
 * @typedef {NativeBulkInput<T> | BatchedBulkInput<T>} BulkInput
 */
export {};
