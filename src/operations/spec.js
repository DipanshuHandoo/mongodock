/**
 * @typedef {object} OperationEnv
 * @property {string} connection
 * @property {Record<string, any> & { readLimit: number, maxReadLimit: number }} limits
 *
 * @typedef {object} OperationSpec
 * @property {string} method
 * @property {boolean} write
 * @property {boolean} retryable Reads in the retry allowlist only; writes and aggregates never retry.
 * @property {(body: any, context: { limits: Record<string, any> & { readLimit: number, maxReadLimit: number } }) => Record<string, any>} normalize
 * @property {boolean} [stream] Returns an AsyncGenerator synchronously instead of a Promise.
 * @property {(model: import("mongoose").Model<any>, input: any, env: OperationEnv, context: any) => Promise<unknown>} [run]
 * @property {(model: import("mongoose").Model<any>, input: any, env: OperationEnv, context: any) => Promise<AsyncIterable<unknown>>} [open] Streaming operations; lazy until first pull.
 * @property {(original: any, replaced: any) => unknown} [restore] Re-applies fields hooks must not change.
 * @property {(result: any) => { invocationOutcome: import("../errors.js").InvocationOutcome, databaseOutcome: import("../errors.js").DatabaseOutcome } | undefined} [classify] Marks a resolved result as non-success (fires onError).
 */
export {};
