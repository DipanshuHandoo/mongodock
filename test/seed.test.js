import assert from "node:assert/strict";
import { describe, it } from "node:test";
import mongoose from "mongoose";
import { normalizeConfig } from "../src/config.js";
import { BulkError, InvalidOptionError, OperationAbortedError } from "../src/errors.js";
import { createExecutor } from "../src/hooks/pipeline.js";
import { createOperations } from "../src/operations/index.js";
import {
  assertSeedIndex,
  isScalarKey,
  keyIdentity,
  normalizeKeyFields,
} from "../src/seeding/keys.js";

const schema = new mongoose.Schema({
  sku: { type: String, required: true },
  region: { type: String, default: "eu" },
  name: { type: String, required: true },
  price: { type: Number, min: 0 },
  origin: { type: String, immutable: true },
  when: Date,
});
const Product = mongoose.model("SeedUnitProduct", schema);
const UNIQUE = [{ key: { _id: 1 } }, { key: { sku: 1 }, unique: true }];

/**
 * @param {{ indexes?: any, writes?: any[][], bulk?: (ops: any[], options: any) => any, base?: any }} [stub]
 * @param {Record<string, unknown>} [extra]
 */
function setup(
  { indexes = UNIQUE, writes = [], bulk, base: modelBase = Product } = {},
  extra = {},
) {
  const config = normalizeConfig({ uri: "mongodb://localhost:27017/x", ...extra });
  const executor = createExecutor({ config });
  const model = class extends modelBase {};
  Object.defineProperty(model, "collection", {
    value: {
      indexes: async () => {
        if (indexes instanceof Error) throw indexes;
        return indexes;
      },
    },
  });
  model.bulkWrite = async (/** @type {any[]} */ ops, /** @type {any} */ options) => {
    writes.push(ops);
    return bulk ? bulk(ops, options) : { upsertedCount: ops.length, matchedCount: 0 };
  };
  const seed = /** @type {any} */ (
    createOperations({
      executor,
      config,
      connection: "default",
      resolveModel: () => /** @type {any} */ (model),
    })
  ).seed;
  return { seed, writes };
}

const rec = (/** @type {string} */ sku, extra = {}) => ({ sku, region: "eu", name: sku, ...extra });
const base = { model: "x", keyFields: ["sku"] };

describe("key helpers", () => {
  it("validates keyFields", () => {
    for (const bad of [
      undefined,
      [],
      "sku",
      [1],
      [""],
      ["$a"],
      ["a.b"],
      ["a", "a"],
      Array(9)
        .fill("x")
        .map((v, i) => v + i),
    ]) {
      assert.throws(() => normalizeKeyFields(bad), InvalidOptionError);
    }
    assert.deepEqual(normalizeKeyFields(["a", "b"]), ["a", "b"]);
  });

  it("accepts only scalar key values", () => {
    const id = new mongoose.Types.ObjectId();
    for (const ok of ["a", 1, false, new Date(), id]) assert.equal(isScalarKey(ok), true);
    for (const bad of [
      "",
      NaN,
      Infinity,
      new Date("x"),
      null,
      undefined,
      {},
      [],
      Symbol.iterator,
    ]) {
      assert.equal(isScalarKey(bad), false);
    }
  });

  it("distinguishes key identities by type and value", () => {
    const k = ["a"];
    assert.notEqual(keyIdentity({ a: "1" }, k), keyIdentity({ a: 1 }, k));
    assert.equal(keyIdentity({ a: new Date(5) }, k), keyIdentity({ a: new Date(5) }, k));
    const id = new mongoose.Types.ObjectId();
    assert.equal(
      keyIdentity({ a: id }, k),
      keyIdentity({ a: new mongoose.Types.ObjectId(String(id)) }, k),
    );
  });
});

describe("index assertion", () => {
  const model = (/** @type {any} */ indexes) => ({
    modelName: "M",
    schema: { path: (/** @type {string} */ p) => (p === "nope" ? undefined : {}) },
    collection: {
      indexes: async () => {
        if (indexes instanceof Error) throw indexes;
        return indexes;
      },
    },
  });
  const check = (/** @type {any} */ indexes, fields = ["sku"]) =>
    assertSeedIndex(/** @type {any} */ (model(indexes)), fields);

  it("accepts an exact unique index and the implicit _id index", async () => {
    await check(UNIQUE);
    await check([{ key: { a: -1, b: 1 }, unique: true }], ["b", "a"]);
    await check([], ["_id"]);
  });

  it("rejects missing, non-unique, sparse, partial, collated and different-key indexes", async () => {
    const variants = [
      [],
      [{ key: { sku: 1 } }],
      [{ key: { sku: 1 }, unique: true, sparse: true }],
      [{ key: { sku: 1 }, unique: true, partialFilterExpression: { a: 1 } }],
      [{ key: { sku: 1 }, unique: true, collation: { locale: "en" } }],
      [{ key: { sku: 1, x: 1 }, unique: true }],
      [{ key: { sku: "text" }, unique: true }],
    ];
    for (const indexes of variants) {
      await assert.rejects(
        check(indexes),
        (/** @type {any} */ e) => e instanceof BulkError && e.databaseOutcome === "notDispatched",
      );
    }
  });

  it("treats a missing collection as having no indexes and wraps other failures", async () => {
    await assert.rejects(check(Object.assign(new Error("x"), { code: 26 })), /unique index/);
    await assert.rejects(
      check(new Error("down")),
      (/** @type {any} */ e) =>
        e instanceof BulkError && /** @type {any} */ (e.cause).message === "down",
    );
  });

  it("rejects fields that are not schema paths", async () => {
    await assert.rejects(check(UNIQUE, ["nope"]), InvalidOptionError);
  });
});

describe("seed input validation", () => {
  const cases = /** @type {[string, any, RegExp][]} */ ([
    [
      "non-array native records",
      { ...base, records: new Set([rec("a")]) },
      /non-empty records array/,
    ],
    ["empty native records", { ...base, records: [] }, /non-empty records array/],
    [
      "batch controls without batching",
      { ...base, records: [rec("a")], batchSize: 1 },
      /require batching/,
    ],
    ["unknown key", { ...base, records: [rec("a")], bogus: 1 }, /bogus/],
    ["ordered", { ...base, batching: true, records: [rec("a")], ordered: true }, /ordered/],
    ["string source", { ...base, batching: true, records: "abc" }, /Iterable/],
    ["bad batching", { ...base, batching: "yes", records: [rec("a")] }, /batching/],
    [
      "parallel updateExisting without uniqueSource",
      { ...base, batching: true, updateExisting: true, concurrency: 2, records: [rec("a")] },
      /uniqueSource/,
    ],
    ["bad dryRun", { ...base, dryRun: 1, records: [rec("a")] }, /dryRun/],
  ]);
  for (const [name, input, pattern] of cases) {
    it(`rejects ${name} before any I/O`, async () => {
      const { seed, writes } = setup();
      await assert.rejects(seed(input), pattern);
      assert.equal(writes.length, 0);
    });
  }
});

describe("record preparation", () => {
  it("builds keyed $setOnInsert upserts with casts and defaults applied", async () => {
    const { seed, writes } = setup();
    await seed({ ...base, records: [{ sku: "a", name: "A", price: "5", when: "2024-01-01" }] });
    const [op] = /** @type {any} */ (writes[0]);
    assert.deepEqual(op.updateOne.filter, { sku: "a" });
    assert.equal(op.updateOne.upsert, true);
    const insert = op.updateOne.update.$setOnInsert;
    assert.equal(insert.price, 5);
    assert.equal(insert.region, "eu");
    assert.ok(insert.when instanceof Date);
    assert.equal("sku" in insert, false);
    assert.equal(op.updateOne.update.$set, undefined);
  });

  it("adds $set for provided non-key fields when updateExisting", async () => {
    const { seed, writes } = setup();
    await seed({ ...base, updateExisting: true, records: [{ sku: "a", name: "N", price: 2 }] });
    const update = /** @type {any} */ (writes[0])[0].updateOne.update;
    assert.deepEqual(update.$set, { name: "N", price: 2 });
    assert.equal("name" in update.$setOnInsert, false);
    assert.equal(update.$setOnInsert.region, "eu");
  });

  it("rejects immutable fields under updateExisting but accepts them for insert-only seeds", async () => {
    const { seed } = setup();
    await assert.rejects(
      seed({ ...base, updateExisting: true, records: [{ sku: "a", name: "N", origin: "x" }] }),
      /immutable field "origin"/,
    );
    await seed({ ...base, records: [{ sku: "a", name: "N", origin: "x" }] });
  });

  it("names the record index and paths, never values", async () => {
    const { seed, writes } = setup();
    await assert.rejects(
      seed({ ...base, records: [rec("a"), { sku: "secret", name: "n", price: -1 }] }),
      (/** @type {any} */ e) =>
        /records\[1\]: validation failed for price/.test(e.message) &&
        !e.message.includes("secret"),
    );
    await assert.rejects(
      seed({ ...base, records: [{ sku: "a" }] }),
      /records\[0\]: validation failed for name/,
    );
    assert.equal(writes.length, 0);
  });

  it("rejects non-plain, operator-shaped, missing, empty and non-scalar keys", async () => {
    const { seed } = setup();
    const bad = /** @type {[any, RegExp][]} */ ([
      ["str", /plain object/],
      [{ ...rec("a"), $inc: { n: 1 } }, /operator-shaped/],
      [{ ...rec("a"), "a.b": 1 }, /operator-shaped/],
      [{ name: "n" }, /key field "sku" must be provided/],
      [{ sku: null, name: "n" }, /must be provided/],
      [{ sku: "", name: "n" }, /non-empty scalar|validation failed/],
    ]);
    for (const [record, pattern] of bad) {
      await assert.rejects(seed({ ...base, records: [record] }), pattern);
    }
  });

  it("restates the key when a record carries nothing else", async () => {
    const Bare = mongoose.model(
      "SeedUnitBare",
      new mongoose.Schema({ code: String }, { _id: false }),
    );
    const { seed, writes } = setup({ base: Bare, indexes: [{ key: { code: 1 }, unique: true }] });
    await seed({ model: "x", keyFields: ["code"], records: [{ code: "a" }] });
    assert.deepEqual(/** @type {any} */ (writes[0])[0].updateOne.update, {
      $setOnInsert: { code: "a" },
    });
  });

  it("wraps non-validation hydrate failures without leaking the value", async () => {
    const { seed } = setup();
    await assert.rejects(
      seed({ ...base, records: [{ sku: "a", name: "n", price: "not-a-number" }] }),
      /records\[0\]: validation failed for price/,
    );
  });
});

describe("duplicates", () => {
  it("rejects a repeated key in a native array before writing", async () => {
    const { seed, writes } = setup();
    await assert.rejects(
      seed({ ...base, records: [rec("a"), rec("b"), rec("a")] }),
      /records\[2\]: duplicate key within batch \(first at records\[0\]\)/,
    );
    assert.equal(writes.length, 0);
  });

  it("rejects a repeated key inside one batch, accounts it, and stops dispatching", async () => {
    const { seed, writes } = setup();
    await assert.rejects(
      seed({
        ...base,
        batching: true,
        batchSize: 2,
        concurrency: 1,
        records: [rec("a"), rec("b"), rec("c"), rec("c"), rec("d")],
      }),
      (/** @type {any} */ e) => {
        assert.match(
          e.message,
          /records\[3\]: duplicate key within batch \(first at records\[2\]\)/,
        );
        assert.ok(e.report);
        return true;
      },
    );
    assert.equal(writes.length, 1);
  });

  it("allows the same key in different batches", async () => {
    const { seed, writes } = setup();
    const report = await seed({
      ...base,
      batching: true,
      batchSize: 1,
      records: [rec("a"), rec("a")],
    });
    assert.equal(writes.length, 2);
    assert.equal(report.status, "completed");
  });
});

describe("execution modes", () => {
  it("native: one unordered bulkWrite with caller options", async () => {
    /** @type {any} */
    let seen;
    const { seed, writes } = setup({
      bulk: (_ops, options) => {
        seen = options;
        return { upsertedCount: 2 };
      },
    });
    const result = await seed({
      ...base,
      records: [rec("a"), rec("b")],
      options: { comment: "c" },
    });
    assert.equal(result.upsertedCount, 2);
    assert.equal(writes.length, 1);
    assert.equal(seen.ordered, false);
    assert.equal(seen.comment, "c");
  });

  it("batched: streams async records through bounded batches", async () => {
    const { seed, writes } = setup();
    async function* source() {
      for (let i = 0; i < 25; i++) yield rec(`s${i}`);
    }
    const seen = /** @type {any[]} */ ([]);
    const report = await seed({
      ...base,
      batching: true,
      batchSize: 10,
      concurrency: 2,
      records: source(),
      onBatch: (/** @type {any} */ o) => seen.push(o.batchIndex),
    });
    assert.equal(writes.length, 3);
    assert.equal(seen.length, 3);
    assert.equal(report.consumed, 25);
    assert.equal(report.status, "completed");
  });

  it("batched: parallel by default, sequential for updateExisting without uniqueSource", async () => {
    const run = async (/** @type {any} */ extra) => {
      let active = 0;
      let max = 0;
      const { seed } = setup({
        bulk: async (ops) => {
          active++;
          max = Math.max(max, active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
          return { upsertedCount: ops.length };
        },
      });
      await seed({
        ...base,
        batching: true,
        batchSize: 1,
        records: [rec("a"), rec("b"), rec("c"), rec("d")],
        ...extra,
      });
      return max;
    };
    assert.ok((await run({})) > 1);
    assert.equal(await run({ updateExisting: true }), 1);
    assert.ok((await run({ updateExisting: true, uniqueSource: true })) > 1);
  });

  it("batched: session forces sequential stop semantics", async () => {
    const { seed } = setup();
    await assert.rejects(
      seed({
        ...base,
        batching: true,
        records: [rec("a")],
        concurrency: 2,
        options: { session: { inTransaction: () => false } },
      }),
      /session require concurrency 1/,
    );
  });

  it("batched: reports partial failure and native duplicate-key races", async () => {
    const { seed } = setup({
      bulk: (_ops, _o) => {
        throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
      },
    });
    const report = await seed({
      ...base,
      batching: true,
      batchSize: 1,
      records: [rec("a"), rec("b")],
    });
    assert.notEqual(report.status, "completed");
    assert.equal(
      report.batches.failed + report.batches.partial + report.batches.uncertain > 0,
      true,
    );
  });

  it("a failing record source aborts with a BulkError and a report", async () => {
    const { seed } = setup();
    async function* source() {
      yield rec("a");
      throw new Error("source down");
    }
    await assert.rejects(
      seed({ ...base, batching: true, batchSize: 1, records: source() }),
      (/** @type {any} */ e) => e instanceof BulkError && e.report !== undefined,
    );
  });

  it("a failing onBatch sink stops the seed", async () => {
    const { seed } = setup();
    await assert.rejects(
      seed({
        ...base,
        batching: true,
        batchSize: 1,
        records: [rec("a"), rec("b")],
        onBatch: () => {
          throw new Error("sink");
        },
      }),
      /onBatch sink failed/,
    );
  });

  it("cancellation before dispatch writes nothing", async () => {
    const { seed, writes } = setup();
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      seed({ ...base, records: [rec("a")], signal: controller.signal }),
      (/** @type {any} */ e) =>
        e instanceof OperationAbortedError ||
        e.name === "AbortError" ||
        /abort|cancel/i.test(e.message),
    );
    assert.equal(writes.length, 0);
  });

  it("index failures stop everything before preparing or writing", async () => {
    const { seed, writes } = setup({ indexes: [] });
    await assert.rejects(seed({ ...base, records: [rec("a")] }), /unique index/);
    await assert.rejects(seed({ ...base, dryRun: true, records: [rec("a")] }), /unique index/);
    assert.equal(writes.length, 0);
  });
});

describe("dry-run", () => {
  it("native: plans without writing", async () => {
    const { seed, writes } = setup();
    const report = await seed({ ...base, dryRun: true, records: [rec("a"), rec("b")] });
    assert.deepEqual(
      { ...report, elapsedMs: 0 },
      {
        status: "dry-run",
        mode: "dry-run",
        batching: false,
        consumed: 2,
        planned: 2,
        batches: 1,
        elapsedMs: 0,
      },
    );
    assert.equal(writes.length, 0);
  });

  it("batched: reports each planned batch sequentially and still validates", async () => {
    const { seed, writes } = setup();
    const seen = /** @type {any[]} */ ([]);
    const report = await seed({
      ...base,
      dryRun: true,
      batching: true,
      batchSize: 2,
      records: [rec("a"), rec("b"), rec("c")],
      onBatch: (/** @type {any} */ b) =>
        seen.push([b.batchIndex, b.startIndex, b.size, b.operations.length]),
    });
    assert.deepEqual(seen, [
      [0, 0, 2, 2],
      [1, 2, 1, 1],
    ]);
    assert.equal(report.planned, 3);
    assert.equal(writes.length, 0);
    await assert.rejects(
      seed({ ...base, dryRun: true, batching: true, records: [rec("a"), { sku: "b" }] }),
      /records\[1\]/,
    );
    await assert.rejects(
      seed({ ...base, dryRun: true, batching: true, records: [rec("a"), rec("a")] }),
      /duplicate key/,
    );
  });

  it("batched: sink failure and cancellation", async () => {
    const { seed } = setup();
    await assert.rejects(
      seed({
        ...base,
        dryRun: true,
        batching: true,
        records: [rec("a")],
        onBatch: () => {
          throw new Error("x");
        },
      }),
      /onBatch sink failed/,
    );
    const controller = new AbortController();
    await assert.rejects(
      seed({
        ...base,
        dryRun: true,
        batching: true,
        batchSize: 1,
        signal: controller.signal,
        records: [rec("a"), rec("b"), rec("c")],
        onBatch: () => controller.abort(),
      }),
      OperationAbortedError,
    );
  });
});
