import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeConfig } from "../src/config.js";
import { InvalidOptionError } from "../src/errors.js";
import { createExecutor } from "../src/hooks/pipeline.js";
import { createOperations } from "../src/operations/index.js";

class FakeId {
  _bsontype = "ObjectId";
  /** @param {string} hex */
  constructor(hex) {
    this.hex = hex;
  }
  toHexString() {
    return this.hex;
  }
}
const id = (/** @type {number} */ n) => new FakeId(String(n).padStart(24, "0"));

/** @param {any[]} rows */
function setup(rows, { hooks = {} } = {}) {
  const state = { closed: 0, pulls: 0, finds: /** @type {any[]} */ ([]), counts: 0 };
  const makeCursor = (/** @type {any[]} */ items) => {
    const pending = [...items];
    return {
      next: async () => {
        state.pulls += 1;
        return pending.length > 0 ? pending.shift() : null;
      },
      close: async () => {
        state.closed += 1;
      },
    };
  };
  const query = (/** @type {() => any} */ exec, /** @type {any} */ record) => {
    const q = {
      cursor: () => makeCursor(rows),
      exec: async () => exec(),
    };
    for (const step of ["select", "sort", "limit", "skip", "lean", "populate", "setOptions"]) {
      /** @type {any} */ (q)[step] = (/** @type {any[]} */ ...args) => {
        record?.chain.push([step, ...args]);
        return q;
      };
    }
    return q;
  };
  const model = {
    modelName: "Thing",
    base: { Types: { ObjectId: FakeId } },
    find: (/** @type {any} */ filter) => {
      const record = { filter, chain: /** @type {any[]} */ ([]) };
      state.finds.push(record);
      const limitOf = () => record.chain.find((c) => c[0] === "limit")?.[1] ?? rows.length;
      return query(() => rows.slice(0, limitOf()), record);
    },
    countDocuments: () => {
      state.counts += 1;
      return query(() => rows.length, undefined);
    },
    aggregate: () => query(() => [], undefined),
  };
  const config = normalizeConfig({ uri: "mongodb://localhost:27017/x", hooks });
  const ops = /** @type {any} */ (
    createOperations({
      executor: createExecutor({ config }),
      config,
      connection: "default",
      resolveModel: () => /** @type {any} */ (model),
    })
  );
  return { ops, state };
}

const collect = async (/** @type {AsyncIterable<any>} */ stream) => {
  const out = [];
  for await (const item of stream) out.push(item);
  return out;
};

describe("streaming operations", () => {
  it("validates eagerly but stays lazy until the first pull", async () => {
    const { ops, state } = setup([{ a: 1 }]);
    assert.throws(() => ops.iterate({ model: "Thing", batchSize: 0 }), InvalidOptionError);
    assert.throws(() => ops.iterate({ model: "Thing", batchSize: 10_001 }), InvalidOptionError);
    assert.throws(() => ops.iterate({ model: "Thing", limit: 5 }), InvalidOptionError);
    const stream = ops.iterate({ model: "Thing" });
    assert.equal(state.finds.length, 0);
    assert.deepEqual(await collect(stream), [{ a: 1 }]);
    assert.equal(state.closed, 1);
  });

  it("closes the cursor on early exit and on abort", async () => {
    const early = setup([1, 2, 3]);
    for await (const _ of early.ops.iterate({ model: "Thing" })) break;
    assert.equal(early.state.closed, 1);

    const { ops, state } = setup([1, 2, 3]);
    const controller = new AbortController();
    const stream = ops.iterate({ model: "Thing", signal: controller.signal });
    await stream.next();
    controller.abort();
    await assert.rejects(stream.next(), { code: "ERR_ABORTED" });
    assert.equal(state.closed, 1);
  });

  it("aggregateCursor guards write stages and forbidden options", async () => {
    const { ops } = setup([]);
    assert.throws(
      () => ops.aggregateCursor({ model: "Thing", pipeline: [{ $merge: { into: "x" } }] }),
      InvalidOptionError,
    );
    assert.throws(
      () => ops.aggregateCursor({ model: "Thing", pipeline: [], options: { cursor: {} } }),
      InvalidOptionError,
    );
    assert.deepEqual(await collect(ops.aggregateCursor({ model: "Thing", pipeline: [] })), []);
  });

  it("iterateBatches groups by cursor strategy and counts before reading", async () => {
    const { ops, state } = setup([1, 2, 3, 4, 5]);
    const batches = await collect(
      ops.iterateBatches({ model: "Thing", batchSize: 2, includeTotal: true }),
    );
    assert.deepEqual(
      batches.map((b) => [b.docs, b.batchIndex, b.processed, b.totalDocs, b.nextCursor]),
      [
        [[1, 2], 0, 2, 5, null],
        [[3, 4], 1, 4, 5, null],
        [[5], 2, 5, 5, null],
      ],
    );
    assert.equal(state.counts, 1);
    assert.throws(() => ops.iterateBatches({ model: "Thing", strategy: "x" }), InvalidOptionError);
  });

  it("iterateBatches keyset strategy chains tokens and never yields empty batches", async () => {
    const rows = [1, 2, 3, 4].map((n) => ({ _id: id(n) }));
    const { ops, state } = setup(rows);
    // The fake ignores the predicate, so each page re-reads from the start; bound the stream.
    const stream = ops.iterateBatches({ model: "Thing", strategy: "keyset", batchSize: 4 });
    const first = await stream.next();
    assert.equal(first.value.docs.length, 4);
    assert.equal(first.value.totalDocs, null);
    assert.equal((await stream.next()).done, true);
    assert.equal(state.finds[0].chain.find((/** @type {any[]} */ c) => c[0] === "limit")[1], 5);

    const paged = setup(rows);
    const small = paged.ops.iterateBatches({ model: "Thing", strategy: "keyset", batchSize: 2 });
    const one = await small.next();
    assert.equal(one.value.docs.length, 2);
    assert.equal(typeof one.value.nextCursor, "string");
    await small.return();
    const empty = setup([]);
    assert.deepEqual(
      await collect(empty.ops.iterateBatches({ model: "Thing", strategy: "keyset" })),
      [],
    );
  });
});

describe("cursor pagination through the executor", () => {
  const rows = [1, 2, 3, 4, 5].map((n) => ({ _id: id(n), n }));

  it("returns a bound token and applies it as a keyset predicate", async () => {
    const { ops, state } = setup(rows);
    const page = await ops.paginateCursor({ model: "Thing", sort: { n: 1 }, limit: 2, lean: true });
    assert.equal(page.docs.length, 2);
    assert.equal(page.hasNextPage, true);
    const next = await ops.paginateCursor({
      model: "Thing",
      sort: { n: 1 },
      limit: 2,
      lean: true,
      cursor: page.nextCursor,
    });
    assert.deepEqual(state.finds[1].filter, {
      $or: [{ n: { $gt: 2 } }, { n: 2, _id: { $gt: id(2) } }],
    });
    assert.ok(next.docs.length > 0);
    const last = await ops.paginateCursor({ model: "Thing", limit: 10, lean: true });
    assert.deepEqual([last.hasNextPage, last.nextCursor], [false, null]);
  });

  it("combines a cursor with an existing filter and rejects bad input", async () => {
    const { ops, state } = setup(rows);
    const page = await ops.paginateCursor({
      model: "Thing",
      filter: { k: 1 },
      limit: 1,
      lean: true,
    });
    await ops.paginateCursor({
      model: "Thing",
      filter: { k: 1 },
      limit: 1,
      cursor: page.nextCursor,
      lean: true,
    });
    assert.ok(state.finds[1].filter.$and);
    await assert.rejects(ops.paginateCursor({ model: "Thing", cursor: 5 }), InvalidOptionError);
    await assert.rejects(
      ops.paginateCursor({ model: "Thing", cursor: page.nextCursor }),
      InvalidOptionError,
    );
    await assert.rejects(
      ops.paginateCursor({ model: "Thing", options: { collation: { locale: "en" } } }),
      InvalidOptionError,
    );
  });

  it("strips hidden sort fields and ignores hook attempts to alter paging metadata", async () => {
    const { ops } = setup(
      rows.map((r) => ({ ...r })),
      {
        hooks: {
          afterOperation: (/** @type {any} */ result) => ({
            result: { ...result, hasNextPage: false, nextCursor: "forged", docs: [] },
          }),
        },
      },
    );
    const page = await ops.paginateCursor({
      model: "Thing",
      projection: { x: 1 },
      sort: { n: 1 },
      limit: 2,
      lean: true,
    });
    assert.deepEqual(page.docs, []);
    assert.equal(page.hasNextPage, true);
    assert.notEqual(page.nextCursor, "forged");
    const plain = setup(rows.map((r) => ({ ...r })));
    const stripped = await plain.ops.paginateCursor({
      model: "Thing",
      projection: { x: 1 },
      sort: { n: 1 },
      limit: 2,
      lean: true,
    });
    assert.ok(stripped.docs.every((/** @type {any} */ d) => !("n" in d)));
  });
});
