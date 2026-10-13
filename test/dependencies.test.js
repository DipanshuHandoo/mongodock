import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { it } from "node:test";
import { asyncSlotPool } from "@dipanshuhandoo/async-slot-pool";
import mongoose from "mongoose";

const require = createRequire(import.meta.url);

it("published slot pool supports ESM/CommonJS and retains indexed item/results", async () => {
  assert.equal(typeof require("@dipanshuhandoo/async-slot-pool").asyncSlotPool, "function");
  const source = [{ value: 1 }, { value: 2 }];
  const result = await asyncSlotPool(source, (item) => item.value * 2, { concurrency: 1 });
  assert.equal(result.succeeded.length, 2);
  assert.equal(result.succeeded[0]?.item, source[0]);
  assert.equal(result.succeeded[0]?.result, 2);
  assert.equal(result.succeeded[1]?.index, 1);
});

it("published slot pool rejects async iterables and stringifies task errors", async () => {
  const result = await asyncSlotPool([1], () => {
    throw new Error("native detail");
  });
  assert.equal(typeof result.failed[0]?.error, "string");
  assert.match(result.failed[0]?.error ?? "", /native detail/);
  const input = (async function* () {
    yield 1;
  })();
  // The published API must reject async input even if a JavaScript caller bypasses types.
  await assert.rejects(
    asyncSlotPool(
      /** @type {Iterable<number>} */ (/** @type {unknown} */ (input)),
      (value) => value,
    ),
    /sync Iterable/,
  );
});

it("published pool swallows progress errors and bails without closing its iterator", async () => {
  let closed = false;
  function* source() {
    try {
      yield 1;
      yield 2;
    } finally {
      closed = true;
    }
  }
  const iterator = source();
  const result = await asyncSlotPool(
    iterator,
    () => {
      throw new Error("stop");
    },
    {
      concurrency: 1,
      bail: true,
      onProgress: () => {
        throw new Error("observer failure");
      },
    },
  );
  assert.equal(result.failed.length, 1);
  assert.equal(closed, false);
  iterator.return(undefined);
  assert.equal(closed, true);
  await new Promise((resolve) => setImmediate(resolve));
});

it("published pool timeout does not cancel underlying work", async () => {
  let finished = false;
  /** @type {() => void} */
  let release = () => {};
  const gate = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  const result = await asyncSlotPool(
    [1],
    async () => {
      await gate;
      finished = true;
    },
    { timeout: 10, concurrency: 1, retries: 0 },
  );
  assert.equal(result.failed.length, 1);
  assert.equal(finished, false);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, true);
});

it("selected Mongoose exposes public BSON size calculation without another BSON package", () => {
  const document = { _id: new mongoose.Types.ObjectId(), value: "example" };
  assert.ok(mongoose.mongo.BSON.calculateObjectSize(document) > 0);
});
