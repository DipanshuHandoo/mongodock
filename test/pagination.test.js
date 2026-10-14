import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InvalidOptionError } from "../src/errors.js";
import {
  decodeToken,
  encodeToken,
  encodeValue,
  filterDigest,
  MAX_TOKEN_LENGTH,
} from "../src/pagination/cursor-codec.js";
import {
  assertSimpleCollation,
  keysetPredicate,
  projectionPlan,
  restoreDocs,
} from "../src/pagination/cursor.js";
import { paginateSpec } from "../src/pagination/offset.js";
import { toSortPairs, withIdTiebreaker } from "../src/pagination/sort.js";

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
const HEX = "a".repeat(24);
const limits = { readLimit: 100, maxReadLimit: 1000 };

describe("sort pairs", () => {
  it("accepts every shape and rejects ambiguity", () => {
    assert.deepEqual(toSortPairs("-a b"), [
      ["a", -1],
      ["b", 1],
    ]);
    assert.deepEqual(toSortPairs({ a: "desc", b: "ascending" }), [
      ["a", -1],
      ["b", 1],
    ]);
    assert.deepEqual(toSortPairs([["1", 1]]), [["1", 1]]);
    assert.deepEqual(toSortPairs(undefined), []);
    for (const bad of [{ a: { $meta: "textScore" } }, { a: 1, b: 1 }.a, 5, [["a"]], { a: 2 }]) {
      assert.throws(() => toSortPairs(bad), InvalidOptionError);
    }
    assert.throws(() => toSortPairs("a -a"), InvalidOptionError);
  });

  it("appends the _id tie-breaker and keeps _id last", () => {
    assert.deepEqual(withIdTiebreaker([["a", -1]]), [
      ["a", -1],
      ["_id", 1],
    ]);
    assert.deepEqual(withIdTiebreaker([["_id", -1]]), [["_id", -1]]);
    assert.throws(
      () =>
        withIdTiebreaker([
          ["_id", 1],
          ["a", 1],
        ]),
      InvalidOptionError,
    );
  });
});

describe("cursor codec", () => {
  const sort = /** @type {[string, 1 | -1][]} */ ([
    ["n", 1],
    ["_id", 1],
  ]);
  const identity = { connection: "main", model: "Row", sort, digest: filterDigest({ a: 1 }) };
  const values = /** @type {any} */ ([encodeValue(5), encodeValue(new FakeId(HEX))]);

  it("round-trips typed values", () => {
    const token = encodeToken({ ...identity, values });
    const decoded = decodeToken(token, identity, FakeId);
    assert.equal(decoded[0], 5);
    assert.equal(/** @type {any} */ (decoded[1]).hex, HEX);
    const date = encodeValue(new Date(5));
    assert.deepEqual(date, ["d", 5]);
    assert.ok(
      decodeToken(
        encodeToken({ ...identity, values: [date, values[1]] }),
        identity,
        FakeId,
      )[0] instanceof Date,
    );
  });

  it("rejects mismatches, tampering, oversize and unsupported values", () => {
    const token = encodeToken({ ...identity, values });
    for (const other of [
      { ...identity, connection: "x" },
      { ...identity, model: "x" },
      { ...identity, digest: filterDigest({ a: 2 }) },
      {
        ...identity,
        sort: [
          ["n", -1],
          ["_id", 1],
        ],
      },
    ]) {
      assert.throws(
        () => decodeToken(token, /** @type {any} */ (other), FakeId),
        InvalidOptionError,
      );
    }
    const forge = (/** @type {unknown} */ k) =>
      Buffer.from(
        JSON.stringify({
          v: 1,
          c: "main",
          m: "Row",
          s: sort,
          q: identity.digest,
          col: "simple",
          k,
        }),
      ).toString("base64url");
    for (const bad of [
      "",
      "###",
      "x".repeat(MAX_TOKEN_LENGTH + 1),
      42,
      forge([["n", 1]]),
      forge([
        ["z", 1],
        ["o", HEX],
      ]),
      forge([
        ["n", "x"],
        ["o", HEX],
      ]),
      forge([
        ["n", 1],
        ["o", "nothex"],
      ]),
      Buffer.from("[]").toString("base64url"),
    ]) {
      assert.throws(() => decodeToken(bad, identity, FakeId), InvalidOptionError);
    }
    for (const bad of [null, undefined, Number.NaN, [1], {}, new Date(Number.NaN)]) {
      assert.throws(() => encodeValue(bad), InvalidOptionError);
    }
    assert.throws(
      () => encodeToken({ ...identity, values: [encodeValue("é".repeat(9000)), values[1]] }),
      InvalidOptionError,
    );
  });

  it("digests filters canonically and rejects unsupported values", () => {
    assert.equal(filterDigest({ a: 1, b: [1, 2] }), filterDigest({ b: [1, 2], a: 1 }));
    assert.notEqual(filterDigest({ a: 1 }), filterDigest({ a: "1" }));
    assert.equal(filterDigest({ a: 0 }), filterDigest({ a: -0 }));
    assert.doesNotThrow(() =>
      filterDigest({ a: new Date(1), b: /x/i, c: new FakeId(HEX), d: null, e: true }),
    );
    for (const bad of [{ a: Number.NaN }, { a: new Date(Number.NaN) }, { a: () => 1 }, { a: 1n }]) {
      assert.throws(() => filterDigest(bad), InvalidOptionError);
    }
    let deep = {};
    for (let i = 0; i < 40; i += 1) deep = { a: deep };
    assert.throws(() => filterDigest(deep), InvalidOptionError);
  });
});

describe("keyset predicate", () => {
  it("builds a lexicographic predicate honoring each direction", () => {
    assert.deepEqual(
      keysetPredicate(
        [
          ["a", 1],
          ["b", -1],
          ["_id", 1],
        ],
        [1, 2, 3],
      ),
      {
        $or: [{ a: { $gt: 1 } }, { a: 1, b: { $lt: 2 } }, { a: 1, b: 2, _id: { $gt: 3 } }],
      },
    );
  });

  it("requires the simple collation", () => {
    assert.doesNotThrow(() => assertSimpleCollation(undefined));
    assert.doesNotThrow(() => assertSimpleCollation({ collation: { locale: "simple" } }));
    assert.throws(() => assertSimpleCollation({ collation: { locale: "en" } }), InvalidOptionError);
  });
});

describe("projection plan", () => {
  const sort = /** @type {[string, 1 | -1][]} */ ([
    ["n", 1],
    ["_id", 1],
  ]);
  it("leaves compatible and absent projections untouched", () => {
    assert.deepEqual(projectionPlan(undefined, sort, false).hidden, []);
    assert.deepEqual(projectionPlan("n", sort, false).hidden, []);
    assert.deepEqual(projectionPlan({ n: 1, _id: 1 }, sort, false).hidden, []);
    assert.deepEqual(projectionPlan({ other: 0 }, sort, false).hidden, []);
  });
  it("adds hidden keys for lean results only", () => {
    const inclusion = projectionPlan({ name: 1 }, sort, true);
    assert.deepEqual(inclusion.hidden, ["n"]);
    assert.deepEqual(inclusion.projection, { name: 1, n: 1 });
    const exclusion = projectionPlan("-n -name", sort, true);
    assert.deepEqual(exclusion.hidden, ["n"]);
    assert.deepEqual(exclusion.projection, { name: 0 });
    assert.throws(() => projectionPlan({ name: 1 }, sort, false), InvalidOptionError);
  });
  it("rejects unsafe projections", () => {
    for (const bad of [{ name: 1, x: 0 }, { n: { $slice: 1 } }, "+n", { name: 1, _id: 0 }, 5]) {
      assert.throws(() => projectionPlan(bad, sort, true), InvalidOptionError);
    }
    assert.throws(
      () =>
        projectionPlan(
          { x: 1 },
          [
            ["a.b", 1],
            ["_id", 1],
          ],
          true,
        ),
      InvalidOptionError,
    );
    assert.deepEqual(
      projectionPlan(
        { a: 1 },
        [
          ["a.b", 1],
          ["_id", 1],
        ],
        false,
      ).hidden,
      [],
    );
  });
});

describe("page result restoration", () => {
  it("lets hooks replace only the documents", () => {
    const original = { docs: [1], limit: 1, hasNextPage: true, nextCursor: "t" };
    assert.deepEqual(restoreDocs(original, { ...original, docs: [2], nextCursor: "forged" }), {
      ...original,
      docs: [2],
    });
    assert.throws(() => restoreDocs(original, null), InvalidOptionError);
    assert.throws(() => restoreDocs(original, { docs: "no" }), InvalidOptionError);
  });
});

describe("offset normalization and execution", () => {
  /** @param {unknown[]} rows @param {number} total @param {{ transaction?: boolean, failCount?: boolean }} [flags] */
  const fakeModel = (rows, total, flags = {}) => {
    const calls = /** @type {string[]} */ ([]);
    const query = (/** @type {string} */ kind, /** @type {() => Promise<unknown>} */ result) => {
      const q = {
        setOptions: () => q,
        select: () => q,
        sort: () => q,
        skip: () => q,
        limit: (/** @type {number} */ n) => {
          calls.push(`limit:${n}`);
          return q;
        },
        populate: () => q,
        lean: () => q,
        exec: async () => {
          calls.push(kind);
          return result();
        },
      };
      return q;
    };
    return {
      calls,
      model: /** @type {any} */ ({
        find: () => query("find", async () => rows),
        countDocuments: () =>
          query("count", async () => {
            if (flags.failCount) throw new Error("count failed");
            return total;
          }),
      }),
    };
  };
  const normalize = (/** @type {any} */ body) => paginateSpec.normalize(body, { limits });
  const run = (/** @type {any} */ model, /** @type {any} */ input) =>
    /** @type {any} */ (paginateSpec.run)(model, input, { connection: "main", limits });

  it("applies defaults and guards arithmetic", () => {
    const input = normalize({});
    assert.deepEqual([input.page, input.limit, input.skip, input.includeTotal], [1, 20, 0, true]);
    assert.deepEqual(input.sort, [["_id", 1]]);
    for (const bad of [
      { page: 0 },
      { page: 1.5 },
      { limit: 5000 },
      { page: Number.MAX_SAFE_INTEGER, limit: 50 },
      { includeTotal: "y" },
      { nope: 1 },
    ]) {
      assert.throws(() => normalize(bad), InvalidOptionError);
    }
  });

  it("derives metadata from the total, or from limit+1 without it", async () => {
    const withTotal = fakeModel([1, 2], 12);
    const page = await run(withTotal.model, normalize({ page: 2, limit: 2 }));
    assert.deepEqual(
      [page.totalDocs, page.totalPages, page.hasNextPage, page.nextPage, page.prevPage],
      [12, 6, true, 3, 1],
    );
    const last = await run(fakeModel([1], 5).model, normalize({ page: 3, limit: 2 }));
    assert.deepEqual([last.hasNextPage, last.nextPage], [false, null]);

    const noTotal = fakeModel([1, 2, 3], 0);
    const result = await run(noTotal.model, normalize({ limit: 2, includeTotal: false }));
    assert.deepEqual(result.docs, [1, 2]);
    assert.deepEqual([result.totalDocs, result.totalPages, result.hasNextPage], [null, null, true]);
    assert.ok(noTotal.calls.includes("limit:3"));
    assert.ok(!noTotal.calls.includes("count"));
  });

  it("surfaces a count failure and orders queries inside a transaction", async () => {
    await assert.rejects(
      run(fakeModel([1], 1, { failCount: true }).model, normalize({})),
      /count failed/,
    );
    const tx = fakeModel([1], 1);
    const session = { inTransaction: () => true };
    await run(tx.model, normalize({ options: { session } }));
    assert.deepEqual(
      tx.calls.filter((c) => c === "count" || c === "find"),
      ["count", "find"],
    );
  });
});
