import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeConfig } from "../src/config.js";
import { createExecutor } from "../src/hooks/pipeline.js";
import { InvalidOptionError } from "../src/index.js";
import { createOperations, OPERATION_METHODS } from "../src/operations/index.js";
import { assertMutationFilter, isEmptyFilter, scanPipeline } from "../src/operations/guards.js";
import { normalizeOptions, resolveReturnDocument } from "../src/operations/query-options.js";

const transient = () => Object.assign(new Error("net"), { name: "MongoNetworkError" });

/**
 * Fake chainable query recording every call.
 * @param {any} [result]
 * @param {{ failTimes?: number }} [options]
 */
function fakeModel(result = [], { failTimes = 0 } = {}) {
  const calls = /** @type {any[]} */ ([]);
  let failures = failTimes;
  const query = (/** @type {string} */ name, /** @type {any[]} */ args) => {
    const record = { name, args, chain: /** @type {any[]} */ ([]) };
    calls.push(record);
    const q = {
      exec() {
        return failures-- > 0 ? Promise.reject(transient()) : Promise.resolve(result);
      },
    };
    // biome-ignore lint/suspicious/noThenProperty: mongoose queries are intentionally thenable
    Object.defineProperty(q, "then", {
      value: (/** @type {any} */ ok, /** @type {any} */ bad) => q.exec().then(ok, bad),
    });
    for (const step of ["select", "sort", "limit", "skip", "lean", "populate", "setOptions"]) {
      /** @type {any} */ (q)[step] = (/** @type {any[]} */ ...a) => {
        record.chain.push([step, ...a]);
        return q;
      };
    }
    return q;
  };
  const model = new Proxy(
    { modelName: "Thing" },
    {
      get: (t, key) =>
        key in t
          ? /** @type {any} */ (t)[key]
          : (/** @type {any[]} */ ...a) => query(String(key), a),
    },
  );
  return { model, calls };
}

/**
 * @param {Record<string, unknown>} [extra]
 * @param {{ failTimes?: number, result?: any }} [modelOptions]
 */
function setup(extra = {}, modelOptions = {}) {
  const config = normalizeConfig({
    uri: "mongodb://localhost:27017/x",
    retry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 2 },
    ...extra,
  });
  const executor = createExecutor({ config });
  const fake = fakeModel(/** @type {any} */ (modelOptions.result ?? []), modelOptions);
  const ops = /** @type {any} */ (
    createOperations({
      executor,
      config,
      connection: "default",
      resolveModel: (ref) => {
        if (ref === "Thing") return /** @type {any} */ (fake.model);
        throw new InvalidOptionError("unknown model");
      },
    })
  );
  return { ops, ...fake };
}

describe("guards", () => {
  it("detects empty filters including trivially empty $and/$or", () => {
    for (const f of [{}, { $and: [] }, { $and: [{}] }, { $or: [{}, { a: 1 }] }, { $or: [] }]) {
      assert.equal(isEmptyFilter(f), true, JSON.stringify(f));
    }
    for (const f of [{ a: 1 }, { $and: [{ a: 1 }] }, { $or: [{ a: 1 }, { b: 2 }] }]) {
      assert.equal(isEmptyFilter(f), false, JSON.stringify(f));
    }
  });

  it("rejects empty mutation filters unless allowAll", () => {
    assert.throws(() => assertMutationFilter({}, false, "deleteMany"), InvalidOptionError);
    assert.doesNotThrow(() => assertMutationFilter({}, true, "deleteMany"));
    assert.doesNotThrow(() => assertMutationFilter({ a: 1 }, false, "deleteMany"));
  });

  it("scans pipelines recursively for write stages", () => {
    const bad = [
      [{ $out: "x" }],
      [{ $merge: { into: "x" } }],
      [{ $lookup: { from: "a", pipeline: [{ $out: "x" }], as: "z" } }],
      [{ $facet: { f: [{ $merge: { into: "x" } }] } }],
      [{ $unionWith: { coll: "a", pipeline: [{ $out: "x" }] } }],
      [{ $match: {}, $limit: 1 }],
      [1],
      "nope",
    ];
    for (const pipeline of bad) {
      assert.throws(() => scanPipeline(/** @type {any} */ (pipeline), false), InvalidOptionError);
    }
    assert.doesNotThrow(() => scanPipeline([{ $out: "x" }], true));
    assert.doesNotThrow(() => scanPipeline([{ $match: { a: 1 } }, { $unionWith: "other" }], false));
  });
});

describe("option mapping", () => {
  it("collapses return aliases and rejects contradictions", () => {
    assert.equal(resolveReturnDocument({}).returnDocument, "after");
    assert.equal(resolveReturnDocument({ new: false }).returnDocument, "before");
    assert.equal(resolveReturnDocument({ returnOriginal: true }).returnDocument, "before");
    assert.equal(resolveReturnDocument({ returnDocument: "before" }).returnDocument, "before");
    assert.throws(
      () => resolveReturnDocument({ new: true, returnOriginal: true }),
      InvalidOptionError,
    );
    assert.throws(() => resolveReturnDocument({ returnDocument: "x" }), InvalidOptionError);
    assert.throws(() => resolveReturnDocument({ new: "yes" }), InvalidOptionError);
  });

  it("rejects wrapper-owned keys and fake sessions in native options", () => {
    assert.throws(() => normalizeOptions({ limit: 1 }, "find", {}), InvalidOptionError);
    assert.throws(() => normalizeOptions({ session: {} }, "find", {}), InvalidOptionError);
    assert.throws(() => normalizeOptions([], "find", {}), InvalidOptionError);
  });
});

describe("operation behavior", () => {
  it("exposes every planned method", () => {
    for (const name of [
      "find",
      "findAll",
      "findOne",
      "findById",
      "exists",
      "countDocuments",
      "create",
      "insertMany",
      "updateOne",
      "updateMany",
      "deleteOne",
      "deleteMany",
      "findOneAndUpdate",
      "findByIdAndUpdate",
      "findOneAndDelete",
      "findByIdAndDelete",
      "aggregate",
    ]) {
      assert.ok(OPERATION_METHODS.includes(name), name);
    }
  });

  it("applies default and explicit limits, projection, sort, lean and rejects overruns", async () => {
    const { ops, calls } = setup();
    await ops.find({
      model: "Thing",
      filter: { a: 1 },
      projection: "a",
      sort: { a: -1 },
      lean: true,
    });
    const chain = calls[0].chain.map((/** @type {any[]} */ c) => c[0]);
    assert.ok(chain.includes("limit") && chain.includes("sort") && chain.includes("lean"));
    const limit = calls[0].chain.find((/** @type {any[]} */ c) => c[0] === "limit");
    assert.equal(limit[1], 100);
    await assert.rejects(ops.find({ model: "Thing", limit: 0 }), InvalidOptionError);
    await assert.rejects(ops.find({ model: "Thing", limit: 1_000_000 }), InvalidOptionError);
    await assert.rejects(
      ops.find({ model: "Thing", filter: { a: undefined } }),
      InvalidOptionError,
    );
    await assert.rejects(ops.find({ model: "Nope" }), InvalidOptionError);
    await assert.rejects(ops.find("Thing"), InvalidOptionError);
  });

  it("rejects ids that are query objects", async () => {
    const { ops } = setup();
    await assert.rejects(ops.findById({ model: "Thing", id: { $ne: null } }), InvalidOptionError);
    await assert.rejects(ops.findById({ model: "Thing", id: null }), InvalidOptionError);
  });

  it("never dispatches an unsafe mutation, even when a hook widens the filter", async () => {
    const { ops, calls } = setup();
    await assert.rejects(ops.deleteMany({ model: "Thing", filter: {} }), InvalidOptionError);
    await assert.rejects(
      ops.deleteMany({
        model: "Thing",
        filter: { a: 1 },
        hooks: { beforeOperation: (/** @type {any} */ i) => ({ ...i, filter: {} }) },
      }),
      InvalidOptionError,
    );
    await assert.rejects(
      ops.deleteMany({
        model: "Thing",
        filter: {},
        allowAll: false,
        hooks: { beforeOperation: (/** @type {any} */ i) => ({ ...i, allowAll: true }) },
      }),
      InvalidOptionError,
    );
    await assert.rejects(
      ops.aggregate({
        model: "Thing",
        pipeline: [{ $match: {} }],
        hooks: {
          beforeOperation: (/** @type {any} */ i) => ({ ...i, pipeline: [{ $out: "x" }] }),
        },
      }),
      InvalidOptionError,
    );
    assert.equal(calls.length, 0);
  });

  it("retries reads on transient errors but never writes, aggregates or session calls", async () => {
    const read = setup({}, { failTimes: 1, result: [] });
    await read.ops.find({ model: "Thing" });
    assert.equal(read.calls.length, 2);

    const write = setup({}, { failTimes: 1 });
    await assert.rejects(
      write.ops.updateOne({ model: "Thing", filter: { a: 1 }, update: { $set: { b: 1 } } }),
    );
    assert.equal(write.calls.length, 1);

    const agg = setup({}, { failTimes: 1 });
    await assert.rejects(agg.ops.aggregate({ model: "Thing", pipeline: [{ $match: {} }] }));
    assert.equal(agg.calls.length, 1);

    class FakeSession {
      inTransaction() {
        return false;
      }
    }
    const session = new FakeSession();
    const sess = setup({}, { failTimes: 1 });
    await assert.rejects(sess.ops.find({ model: "Thing", options: { session } }));
    assert.equal(sess.calls.length, 1);
  });

  it("maps return-document aliases onto findOneAndUpdate options", async () => {
    const { ops, calls } = setup({}, { result: { a: 1 } });
    await ops.findOneAndUpdate({
      model: "Thing",
      filter: { a: 1 },
      update: { $set: { b: 1 } },
      options: { returnOriginal: true },
    });
    const opts = calls[0].chain.find((/** @type {any[]} */ c) => c[0] === "setOptions")[1];
    assert.equal(opts.returnDocument, "before");
    assert.equal(opts.runValidators, true);
    assert.equal("returnOriginal" in opts, false);
  });
});
