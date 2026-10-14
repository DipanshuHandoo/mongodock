import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import mongoose from "mongoose";
import { createMongoService, InvalidOptionError } from "../../src/index.js";

const uri = () => {
  const value = process.env.MONGODOCK_TEST_URI;
  assert.ok(value, "Run through npm run test:integration");
  return value;
};

const COUNT = 53;

/** @param {AsyncIterable<any>} stream */
const collect = async (stream) => {
  const out = [];
  for await (const item of stream) out.push(item);
  return out;
};

describe("pagination and streaming against a real database", () => {
  /** @type {any} */
  let db;
  const events = /** @type {string[]} */ ([]);

  before(async () => {
    db = createMongoService({
      connections: {
        main: {
          uri: uri(),
          options: { dbName: `mongodock_page_${randomUUID().replaceAll("-", "")}` },
        },
      },
      defaultConnection: "main",
      hooks: { onComplete: (c) => void events.push(`${c.context.method}:${c.invocationOutcome}`) },
    });
    await db.connectAll();
    const schema = new mongoose.Schema({
      n: Number,
      group: Number,
      name: String,
      flag: Boolean,
      at: Date,
      secret: String,
    });
    const Row = db.registerModel({ name: "Row", schema });
    await Row.createIndexes();
    await Row.insertMany(
      Array.from({ length: COUNT }, (_, i) => ({
        n: i,
        group: i % 5,
        name: `name-${String(i % 7).padStart(2, "0")}`,
        flag: i % 2 === 0,
        at: new Date(Date.UTC(2024, 0, 1 + (i % 9))),
        secret: `s${i}`,
      })),
    );
  });

  after(async () => {
    await db.getConnection("main").dropDatabase();
    await db.disconnectAll();
  });

  it("offset pagination walks every document once with accurate metadata", async () => {
    const seen = [];
    let page = 1;
    for (;;) {
      const result = await db.paginate({
        model: "Row",
        page,
        limit: 10,
        sort: { n: 1 },
        lean: true,
      });
      assert.equal(result.totalDocs, COUNT);
      assert.equal(result.totalPages, 6);
      assert.equal(result.hasPrevPage, page > 1);
      seen.push(...result.docs.map((/** @type {any} */ d) => d.n));
      if (!result.hasNextPage) break;
      assert.equal(result.nextPage, page + 1);
      page += 1;
    }
    assert.deepEqual(
      seen,
      Array.from({ length: COUNT }, (_, i) => i),
    );
    const beyond = await db.paginate({ model: "Row", page: 99, limit: 10, lean: true });
    assert.deepEqual(
      [beyond.docs.length, beyond.hasNextPage, beyond.hasPrevPage],
      [0, false, true],
    );
    const noTotal = await db.paginate({ model: "Row", limit: 50, includeTotal: false, lean: true });
    assert.deepEqual(
      [noTotal.totalDocs, noTotal.totalPages, noTotal.hasNextPage],
      [null, null, true],
    );
  });

  /** @type {Array<[string, string | Record<string, 1 | -1>]>} */
  const sorts = [
    ["ascending number with ties", { group: 1 }],
    ["descending number with ties", { group: -1 }],
    ["compound mixed direction", { group: 1, n: -1 }],
    ["string with ties", { name: 1 }],
    ["boolean", { flag: -1 }],
    ["date with ties", { at: 1 }],
    ["_id", { _id: -1 }],
  ];
  for (const [label, sort] of sorts) {
    it(`keyset pagination is complete and duplicate-free: ${label}`, async () => {
      const ids = [];
      /** @type {string | undefined} */
      let cursor;
      let pages = 0;
      do {
        /** @type {any} */
        const page = await db.paginateCursor({ model: "Row", sort, limit: 8, cursor, lean: true });
        ids.push(...page.docs.map((/** @type {any} */ d) => String(d._id)));
        cursor = page.nextCursor ?? undefined;
        pages += 1;
      } while (cursor);
      assert.equal(ids.length, COUNT);
      assert.equal(new Set(ids).size, COUNT);
      assert.equal(pages, Math.ceil(COUNT / 8));
    });
  }

  it("keyset order matches an offset walk of the same sort", async () => {
    const sort = { group: -1, name: 1 };
    const expected = (
      await db.find({
        model: "Row",
        sort: [...Object.entries(sort), ["_id", 1]],
        limit: 1000,
        lean: true,
      })
    ).map((/** @type {any} */ d) => String(d._id));
    const got = [];
    /** @type {string | undefined} */
    let cursor;
    do {
      /** @type {any} */
      const page = await db.paginateCursor({ model: "Row", sort, limit: 7, cursor, lean: true });
      got.push(...page.docs.map((/** @type {any} */ d) => String(d._id)));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    assert.deepEqual(got, expected);
  });

  it("rejects cursors from another query and strips hidden sort fields", async () => {
    const first = await db.paginateCursor({
      model: "Row",
      filter: { group: 1 },
      sort: { n: 1 },
      limit: 2,
      lean: true,
    });
    await assert.rejects(
      db.paginateCursor({
        model: "Row",
        filter: { group: 2 },
        sort: { n: 1 },
        limit: 2,
        cursor: first.nextCursor,
      }),
      InvalidOptionError,
    );
    await assert.rejects(
      db.paginateCursor({
        model: "Row",
        filter: { group: 1 },
        sort: { n: -1 },
        limit: 2,
        cursor: first.nextCursor,
      }),
      InvalidOptionError,
    );
    const hidden = await db.paginateCursor({
      model: "Row",
      projection: { name: 1 },
      sort: { n: 1 },
      limit: 3,
      lean: true,
    });
    assert.deepEqual(Object.keys(hidden.docs[0]).sort(), ["_id", "name"]);
    const next = await db.paginateCursor({
      model: "Row",
      projection: { name: 1 },
      sort: { n: 1 },
      limit: 3,
      lean: true,
      cursor: hidden.nextCursor,
    });
    assert.equal(next.docs.length, 3);
    await assert.rejects(
      db.paginateCursor({ model: "Row", projection: { name: 1 }, sort: { n: 1 } }),
      InvalidOptionError,
    );
  });

  it("iterate streams every document and closes the cursor on early exit", async () => {
    assert.equal(
      (await collect(db.iterate({ model: "Row", lean: true, batchSize: 10 }))).length,
      COUNT,
    );
    events.length = 0;
    let taken = 0;
    for await (const _ of db.iterate({ model: "Row", lean: true, batchSize: 5 })) {
      taken += 1;
      if (taken === 3) break;
    }
    assert.deepEqual(events, ["iterate:closedEarly"]);
  });

  it("iterateBatches supports both strategies, totals and never yields empty batches", async () => {
    for (const strategy of ["cursor", "keyset"]) {
      const batches = await collect(
        db.iterateBatches({
          model: "Row",
          strategy,
          batchSize: 20,
          includeTotal: true,
          sort: { group: 1 },
          lean: true,
        }),
      );
      assert.deepEqual(
        batches.map((b) => b.docs.length),
        [20, 20, 13],
      );
      assert.ok(batches.every((b) => b.totalDocs === COUNT));
      assert.deepEqual(
        batches.map((b) => b.batchIndex),
        [0, 1, 2],
      );
      assert.equal(batches.at(-1).processed, COUNT);
      assert.equal(batches.at(-1).nextCursor, null);
    }
    const empty = await collect(
      db.iterateBatches({ model: "Row", filter: { n: -1 }, includeTotal: true }),
    );
    assert.deepEqual(empty, []);
    const exact = await collect(
      db.iterateBatches({ model: "Row", strategy: "keyset", batchSize: COUNT, lean: true }),
    );
    assert.deepEqual(
      exact.map((b) => b.docs.length),
      [COUNT],
    );
  });

  it("aggregateCursor streams results and blocks write stages", async () => {
    const out = await collect(
      db.aggregateCursor({
        model: "Row",
        pipeline: [{ $group: { _id: "$group", c: { $sum: 1 } } }],
        batchSize: 2,
      }),
    );
    assert.equal(out.length, 5);
    assert.throws(() => db.aggregateCursor({ model: "Row", pipeline: [{ $out: "x" }] }), /./);
  });

  it("aborts a stream promptly", async () => {
    const controller = new AbortController();
    const stream = db.iterate({
      model: "Row",
      lean: true,
      batchSize: 2,
      signal: controller.signal,
    });
    await stream.next();
    controller.abort();
    await assert.rejects(stream.next(), { code: "ERR_ABORTED" });
  });
});
