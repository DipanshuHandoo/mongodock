import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeConfig } from "../src/config.js";
import { createExecutor } from "../src/hooks/pipeline.js";
import {
  HookError,
  InvalidOptionError,
  OperationAbortedError,
  OperationVetoError,
} from "../src/index.js";

const URI = "mongodb://localhost:27017/x";

/** @param {Record<string, unknown>} [extra] */
const make = (extra = {}, executorOptions = {}) => {
  const config = normalizeConfig({ uri: URI, ...extra });
  return createExecutor({ config, ...executorOptions });
};

const transient = () => Object.assign(new Error("net"), { name: "MongoNetworkError" });

describe("hook ordering and input", () => {
  it("runs plugins, service hooks, then call hooks sequentially and awaits each", async () => {
    const order = /** @type {string[]} */ ([]);
    const tag = (/** @type {string} */ name) => async () => {
      await new Promise((r) => setTimeout(r, 5));
      order.push(name);
    };
    const executor = make({
      plugins: [{ name: "p", hooks: { beforeOperation: tag("plugin") } }],
      hooks: { beforeOperation: tag("service") },
    });
    await executor.execute({
      method: "find",
      hooks: { beforeOperation: tag("call") },
      run: async () => 1,
    });
    assert.deepEqual(order, ["plugin", "service", "call"]);
  });

  it("chains replacement input and isolates the run copy from later mutation", async () => {
    const seen = /** @type {unknown[]} */ ([]);
    const executor = make({
      hooks: { beforeOperation: (/** @type {any} */ input) => ({ ...input, a: 2 }) },
    });
    const shared = { a: 1, nested: { v: 1 } };
    await executor.execute({
      method: "find",
      input: shared,
      run: async (/** @type {any} */ input) => {
        input.nested.v = 99;
        seen.push(input.a);
      },
    });
    assert.deepEqual(seen, [2]);
    assert.equal(shared.nested.v, 1);
  });

  it("vetoes with OperationVetoError and never dispatches", async () => {
    let ran = false;
    const events = /** @type {string[]} */ ([]);
    const executor = make({
      hooks: {
        beforeOperation: () => false,
        onError: () => events.push("error"),
        onComplete: () => events.push("complete"),
      },
    });
    await assert.rejects(
      executor.execute({
        method: "find",
        run: async () => {
          ran = true;
        },
      }),
      (/** @type {any} */ error) =>
        error instanceof OperationVetoError && error.databaseOutcome === "notDispatched",
    );
    assert.equal(ran, false);
    assert.deepEqual(events, ["error", "complete"]);
  });

  it("revalidates replacement input", async () => {
    const executor = make({ hooks: { beforeOperation: () => "bad" } });
    await assert.rejects(
      executor.execute({ method: "find", run: async () => 1 }),
      (/** @type {any} */ error) => error instanceof HookError,
    );
  });

  it("applies afterOperation replacements and rejects malformed returns", async () => {
    const good = make({ hooks: { afterOperation: () => ({ result: 7 }) } });
    assert.equal(await good.execute({ method: "find", run: async () => 1 }), 7);
    const bad = make({ hooks: { afterOperation: () => 7 } });
    await assert.rejects(bad.execute({ method: "find", run: async () => 1 }), HookError);
  });

  it("gives concurrent operations isolated contexts", async () => {
    const ids = new Set();
    const executor = make({
      hooks: {
        beforeOperation: (/** @type {unknown} */ _i, /** @type {any} */ c) =>
          ids.add(c.operationId) && undefined,
      },
    });
    await Promise.all(
      Array.from({ length: 20 }, () => executor.execute({ method: "find", run: async () => 1 })),
    );
    assert.equal(ids.size, 20);
  });

  it("rejects invalid call options before any lifecycle", async () => {
    const executor = make();
    await assert.rejects(
      executor.execute({ method: "find", signal: "nope", run: async () => 1 }),
      InvalidOptionError,
    );
    assert.throws(() => executor.createOperation({ method: "find", hooks: { bogus() {} } }));
  });
});

describe("terminal delivery", () => {
  it("runs onSuccess then onComplete exactly once with the result", async () => {
    const events = /** @type {any[]} */ ([]);
    const executor = make({
      hooks: {
        onSuccess: (/** @type {any} */ c) => events.push(["success", c.result, c.databaseOutcome]),
        onError: () => events.push(["error"]),
        onComplete: (/** @type {any} */ c) => events.push(["complete", c.invocationOutcome]),
      },
    });
    await executor.execute({ method: "find", run: async () => "ok" });
    assert.deepEqual(events, [
      ["success", "ok", "succeeded"],
      ["complete", "succeeded"],
    ]);
  });

  it("keeps native errors, replaces via beforeError with cause, and reports uncertain writes", async () => {
    const native = new Error("native");
    const replaced = new Error("friendly");
    const executor = make({ hooks: { beforeError: () => replaced } });
    await assert.rejects(
      executor.execute({ method: "create", write: true, run: async () => Promise.reject(native) }),
      (error) => error === replaced && /** @type {any} */ (error).cause === native,
    );
    const plain = make();
    await assert.rejects(
      plain.execute({ method: "find", run: async () => Promise.reject(native) }),
      (error) => error === native,
    );
  });

  it("marks failed reads failed and failed writes uncertain", async () => {
    const outcomes = /** @type {string[]} */ ([]);
    const executor = make({
      hooks: { onError: (/** @type {any} */ c) => outcomes.push(c.databaseOutcome) },
    });
    const boom = () => Promise.reject(new Error("x"));
    await executor.execute({ method: "find", run: boom }).catch(() => undefined);
    await executor.execute({ method: "create", write: true, run: boom }).catch(() => undefined);
    assert.deepEqual(outcomes, ["failed", "uncertain"]);
  });

  it("wraps a throwing beforeError as HookError retaining the original", async () => {
    const original = new Error("db");
    const executor = make({
      hooks: {
        beforeError: () => {
          throw new Error("hook");
        },
      },
    });
    await assert.rejects(
      executor.execute({ method: "find", run: async () => Promise.reject(original) }),
      (/** @type {any} */ error) => error instanceof HookError && error.original === original,
    );
  });

  it("uses onError for partial classification yet resolves the report", async () => {
    const outcomes = /** @type {string[]} */ ([]);
    const executor = make({
      hooks: {
        onError: (/** @type {any} */ c) => outcomes.push(`error:${c.invocationOutcome}`),
        onSuccess: () => outcomes.push("success"),
      },
    });
    const report = { ok: false };
    const result = await executor.execute({
      method: "bulkWrite",
      run: async () => report,
      classify: () => ({ invocationOutcome: "partial", databaseOutcome: "succeeded" }),
    });
    assert.equal(result, report);
    assert.deepEqual(outcomes, ["error:partial"]);
  });

  it("routes observer failures to onHookError and continues", async () => {
    const reported = /** @type {any[]} */ ([]);
    const executor = make({
      hooks: {
        onSuccess: () => {
          throw new Error("observer");
        },
        onHookError: (/** @type {any} */ e) => reported.push([e.hookName, e.scope]),
      },
    });
    assert.equal(await executor.execute({ method: "find", run: async () => 5 }), 5);
    assert.deepEqual(reported, [["onSuccess", "service"]]);
  });

  it("throws a composite HookError when observer failures cannot be reported", async () => {
    const executor = make({
      hooks: {
        onComplete: () => {
          throw new Error("observer");
        },
      },
    });
    await assert.rejects(
      executor.execute({ method: "find", run: async () => 5 }),
      (/** @type {any} */ error) => error instanceof HookError && error.errors.length === 1,
    );
    const failing = make({
      hooks: {
        onSuccess: () => {
          throw new Error("observer");
        },
        onHookError: () => {
          throw new Error("reporter");
        },
      },
    });
    await assert.rejects(
      failing.execute({ method: "find", run: async () => 5 }),
      (/** @type {any} */ error) => error instanceof HookError && error.errors.length === 2,
    );
  });

  it("reports cleanup failure and still completes", async () => {
    const reported = /** @type {string[]} */ ([]);
    const events = /** @type {string[]} */ ([]);
    const executor = make({
      hooks: {
        onHookError: (/** @type {any} */ e) => reported.push(e.hookName),
        onComplete: () => events.push("complete"),
      },
    });
    const op = executor.createOperation({ method: "find" });
    op.addCleanup(() => {
      throw new Error("cleanup");
    });
    await op.succeed(1);
    assert.deepEqual(reported, ["cleanup"]);
    assert.deepEqual(events, ["complete"]);
  });

  it("abandons a hook that exceeds the hook timeout", async () => {
    const executor = make({
      limits: { hookTimeoutMS: 20 },
      hooks: { beforeOperation: () => new Promise(() => undefined) },
    });
    await assert.rejects(
      executor.execute({ method: "find", run: async () => 1 }),
      (/** @type {any} */ error) => error instanceof HookError,
    );
  });

  it("reports a pre-aborted signal as cancelled", async () => {
    const outcomes = /** @type {string[]} */ ([]);
    const executor = make({
      hooks: { onError: (/** @type {any} */ c) => outcomes.push(c.invocationOutcome) },
    });
    await assert.rejects(
      executor.execute({ method: "find", signal: AbortSignal.abort(), run: async () => 1 }),
      OperationAbortedError,
    );
    assert.deepEqual(outcomes, ["cancelled"]);
  });

  it("admits per operation and releases on every path", async () => {
    let active = 0;
    const executor = make(
      {},
      {
        admit: () => {
          active += 1;
          return {
            release: () => {
              active -= 1;
            },
          };
        },
      },
    );
    await executor.execute({ method: "find", run: async () => 1 });
    await executor
      .execute({ method: "find", run: () => Promise.reject(new Error("x")) })
      .catch(() => 0);
    assert.equal(active, 0);
  });
});

describe("streams", () => {
  async function* source() {
    yield 1;
    yield 2;
  }

  it("is lazy, completes with onSuccess on exhaustion", async () => {
    const events = /** @type {string[]} */ ([]);
    let opened = 0;
    const executor = make({
      hooks: {
        onSuccess: () => events.push("success"),
        onComplete: (/** @type {any} */ c) => events.push(c.invocationOutcome),
      },
    });
    const stream = executor.executeStream({
      method: "stream",
      open: () => {
        opened += 1;
        return source();
      },
    });
    assert.equal(opened, 0);
    const values = [];
    for await (const value of stream) values.push(value);
    assert.deepEqual(values, [1, 2]);
    assert.deepEqual(events, ["success", "succeeded"]);
  });

  it("closes early without onSuccess or onError", async () => {
    const events = /** @type {string[]} */ ([]);
    const executor = make({
      hooks: {
        onSuccess: () => events.push("success"),
        onError: () => events.push("error"),
        onComplete: (/** @type {any} */ c) => events.push(c.invocationOutcome),
      },
    });
    for await (const _ of executor.executeStream({ method: "stream", open: () => source() })) break;
    assert.deepEqual(events, ["closedEarly"]);
  });

  it("fails with onError and never retries", async () => {
    let opens = 0;
    const events = /** @type {string[]} */ ([]);
    const executor = make({
      retry: { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 1 },
      hooks: { onError: () => events.push("error") },
    });
    await assert.rejects(async () => {
      for await (const _ of executor.executeStream({
        method: "stream",
        open: () => {
          opens += 1;
          return (async function* () {
            yield* [];
            throw transient();
          })();
        },
      })) {
        // drain
      }
    });
    assert.equal(opens, 1);
    assert.deepEqual(events, ["error"]);
  });

  it("never touches admission before first next()", () => {
    let admitted = 0;
    const executor = make(
      {},
      {
        admit: () => {
          admitted += 1;
          return { release() {} };
        },
      },
    );
    executor.executeStream({ method: "stream", open: () => source() });
    assert.equal(admitted, 0);
  });
});

describe("lifecycle observers", () => {
  it("delivers connection events and routes failures to onHookError", async () => {
    const reported = /** @type {string[]} */ ([]);
    const received = /** @type {unknown[]} */ ([]);
    const executor = make({
      plugins: [
        {
          name: "p",
          hooks: {
            onConnectionConnected: () => {
              throw new Error("boom");
            },
          },
        },
      ],
      hooks: {
        onConnectionConnected: (/** @type {unknown} */ s) => received.push(s),
        onHookError: (/** @type {any} */ e) => reported.push(`${e.scope}:${e.hookName}`),
      },
    });
    await executor.observe("onConnectionConnected", { name: "default" });
    assert.deepEqual(received, [{ name: "default" }]);
    assert.deepEqual(reported, ["plugin:p:onConnectionConnected"]);
  });
});
