import {
  type ErrorCode,
  type BulkInput,
  type FindInput,
  type Hooks,
  isMongoDockError,
  type MongoServiceConfig,
  normalizeConfig,
  normalizeRetry,
} from "@dipanshuhandoo/mongodock";

const hooks: Hooks = {
  beforeRetry: ({ attempt, delayMs }) => attempt < 2 && delayMs >= 0,
  onComplete: ({ databaseOutcome }) => {
    void databaseOutcome;
  },
};
const input: MongoServiceConfig = {
  uri: "mongodb://localhost/test",
  hooks,
  retry: { maxRetries: 2 },
};
const config = normalizeConfig(input);
const enabled: boolean = config.retry.enabled;
const attempts: number = normalizeRetry(true).maxRetries;
declare const error: unknown;
if (isMongoDockError(error)) {
  const code: ErrorCode = error.code;
  void code;
}
// @ts-expect-error Invalid retry option must not be accepted.
const invalid: MongoServiceConfig = { uri: input.uri, retry: { retries: 5 } };
// @ts-expect-error Configuration is readonly.
config.limits.concurrency = 10;
void enabled;
void attempts;
void invalid;

type Page = { title: string; views: number };
const query: FindInput<Page> = { model: "Page", filter: { title: "example" }, lean: true };
const nativeBulk: BulkInput<Page> = {
  model: "Page",
  operations: [{ insertOne: { document: { title: "example", views: 1 } } }],
  batching: false,
};
const batchedBulk: BulkInput<Page> = {
  model: "Page",
  operations: nativeBulk.operations,
  batching: true,
  concurrency: 2,
};
const invalidBulk: BulkInput<Page> = {
  model: "Page",
  operations: [],
  batching: false,
  // @ts-expect-error Native bulk input does not accept batching concurrency.
  concurrency: 2,
};
void query;
void batchedBulk;
void invalidBulk;
