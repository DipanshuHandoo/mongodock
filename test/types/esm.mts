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

import {
  createMongoService,
  type ConnectionView,
  ShutdownTimeoutError,
} from "@dipanshuhandoo/mongodock";

const service = createMongoService({ uri: "mongodb://localhost/test" });
const view: ConnectionView = service.use("default");
const states: boolean = service.isConnected();
const named = service.getStatus("default").state;
const model = view.getModel<{ title: string }>("Page");
const timeout = new ShutdownTimeoutError("late");
const pending: readonly { kind: string }[] = timeout.pending;
// @ts-expect-error Unknown model definitions need a name and schema or a model.
service.registerModel({ collection: 1 });
void states;
void named;
void model;
void pending;

import {
  HookError,
  type Hooks as ServiceHooks,
  OperationAbortedError,
  OperationVetoError,
  type Plugin,
} from "@dipanshuhandoo/mongodock";

const pluginHooks: ServiceHooks = {
  beforeRetry: ({ attempt }) => attempt < 2,
  onHookError: ({ hookName }) => {
    void hookName;
  },
};
const plugin: Plugin = { name: "p", hooks: pluginHooks };
const hookError = new HookError("x", { hookName: "beforeOperation", scope: "service" });
const scope: string | undefined = hookError.scope;
// @ts-expect-error Unknown hooks are rejected.
const badHooks: ServiceHooks = { nope() {} };
void plugin;
void scope;
void badHooks;
void OperationVetoError;
void OperationAbortedError;

import type mongoose from "mongoose";
import { createMongoService as createOpsService } from "@dipanshuhandoo/mongodock";

interface Widget {
  sku: string;
  qty: number;
}
declare const Widgets: mongoose.Model<Widget>;
const ops = createOpsService({ uri: "mongodb://localhost/test" });
async function operationTypes() {
  const hydrated = await ops.findOne({ model: Widgets, filter: { sku: "a" } });
  const hydratedSku: string | undefined = hydrated?.sku;
  const lean = await ops.find({ model: Widgets, lean: true });
  const leanQty: number | undefined = lean[0]?.qty;
  const count: number = await ops.countDocuments({ model: "Widget" });
  const present: boolean = await ops.exists({ model: "Widget" });
  // @ts-expect-error model is required.
  await ops.find({ filter: {} });
  void hydratedSku;
  void leanQty;
  void count;
  void present;
}
void operationTypes;

async function pagingTypes() {
  const page = await ops.paginate({ model: Widgets, lean: true, page: 2 });
  const total: number | null = page.totalDocs;
  const sku: string | undefined = page.docs[0]?.sku;
  const keyset = await ops.paginateCursor({ model: Widgets, lean: true, sort: { sku: 1 } });
  const next: string | null = keyset.nextCursor;
  for await (const doc of ops.iterate({ model: Widgets, lean: true })) {
    const qty: number = doc.qty;
    void qty;
  }
  for await (const batch of ops.iterateBatches({
    model: Widgets,
    lean: true,
    strategy: "keyset",
  })) {
    const size: number = batch.docs.length;
    const batchTotal: number | null = batch.totalDocs;
    void size;
    void batchTotal;
  }
  for await (const row of ops.aggregateCursor({ model: Widgets, pipeline: [{ $match: {} }] })) {
    void row;
  }
  void total;
  void sku;
  void next;
}
void pagingTypes;

async function bulkTypes() {
  const native = await ops.bulkWrite({
    model: Widgets,
    operations: [{ insertOne: { document: { sku: "a", qty: 1 } } }],
  });
  const inserted: number = native.insertedCount;
  const report = await ops.bulkWrite({
    model: Widgets,
    batching: true,
    operations: [{ insertOne: { document: { sku: "a", qty: 1 } } }],
    onBatch: (outcome) => {
      const status: string = outcome.status;
      void status;
    },
  });
  const consumed: number = report.consumed;
  const batches: number = report.batches.total;
  void inserted;
  void consumed;
  void batches;
}
void bulkTypes;

async function transactionTypes() {
  const total = await ops.withTransaction(async (tx) => {
    const session: import("mongodb").ClientSession = tx.session;
    const created = await tx.ops.create({ model: Widgets, data: { sku: "t", qty: 1 } });
    void session;
    return created.qty + tx.attempt;
  });
  const sum: number = total;
  const health = await ops.healthCheck({ probe: false, timeoutMS: 1000 });
  const ready: boolean = health.ready;
  const one = await ops.use("default").healthCheck();
  const latency: number | undefined = one.latencyMs;
  void sum;
  void ready;
  void latency;
}
void transactionTypes;
