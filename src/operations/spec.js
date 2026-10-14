/**
 * @typedef {object} OperationSpec
 * @property {string} method
 * @property {boolean} write
 * @property {boolean} retryable Reads in the retry allowlist only; writes and aggregates never retry.
 * @property {(body: any, context: { limits: { readLimit: number, maxReadLimit: number } }) => Record<string, any>} normalize
 * @property {(model: import("mongoose").Model<any>, input: any) => Promise<unknown>} run
 */
export {};
