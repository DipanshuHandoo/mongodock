import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeConfig } from "../src/config.js";
import { createExecutor } from "../src/hooks/pipeline.js";
import { InvalidOptionError, OperationAbortedError, TransactionError } from "../src/index.js";
import { createSessionVerifier, createWithTransaction } from "../src/transactions.js";

const config = normalizeConfig({ uri: "mongodb://localhost:27017/x" });

/** Records every query with the options it received. */
function fakeModel() {
  const calls = /** @type {any[]} */ ([]);
  const query = (/** @type {string} */ name, /** @type {any[]} */ args) => {
    const record = { name, args, chain: /** @type {any[]} */ ([]) };
    calls.push(record);
    const q = {
      exec: () => Promise.resolve([]),
      setOptions(/** @type {any} */ value) {
        record.chain.push(value);
        return q;
      },
    };
    // biome-ignore lint/suspicious/noThenProperty: mongoose queries are intentionally thenable
    Object.defineProperty(q, "then", {
      value: (/** @type {any} */ ok, /** @type {any} */ bad) => q.exec().then(ok, bad),
    });
    for (const step of ["select", "sort", "limit", "skip", "lean", "populate"]) {
      /** @type {any} */ (q)[step] = () => q;
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

const client = {};
class FakeSession {
  /** @param {number} id */
  constructor(id) {
    this.id = id;
    this.client = client;
  }
  inTransaction() {
    return true;
  }
}
const newSession = (/** @type {number} */ id) => new FakeSession(id);

/**
 * @param {(fn: (session: any) => Promise<any>, options?: any) => Promise<any>} script
 */
function setup(script) {
  const { model, calls } = fakeModel();
  const connection = { transaction: script, getClient: () => client };
  const withTransaction = createWithTransaction({
    executor: createExecutor({ config }),
    config,
    name: "default",
    getConnection: () => /** @type {any} */ (connection),
    resolveModel: () => /** @type {any} */ (model),
  });
  return { withTransaction, calls, connection };
}

/** Runs the callback once, like a committed driver transaction. */
const commitOnce = (/** @type {(session: any) => Promise<any>} */ fn) => fn(newSession(1));

const sessionsIn = (/** @type {any[]} */ calls) =>
  calls.flatMap((call) => call.chain.map((/** @type {any} */ o) => o?.session));

describe("withTransaction", () => {
  it("returns the committed callback value and pins scoped calls to the session", async () => {
    const { withTransaction, calls } = setup(commitOnce);
    const value = await withTransaction(async (tx) => {
      await tx.ops.find({ model: "Thing", filter: {} });
      return { id: tx.attempt };
    });
    assert.deepEqual(value, { id: 1 });
    assert.equal(calls.length, 1);
    assert.equal(sessionsIn(calls)[0].id, 1);
  });

  it("propagates correlation and tags scoped calls with transaction and attempt", async () => {
    const seen = /** @type {any[]} */ ([]);
    const { withTransaction } = setup(commitOnce);
    await withTransaction(
      async (tx) => {
        await tx.ops.find({
          model: "Thing",
          filter: {},
          hooks: { onSuccess: ({ context }) => void seen.push(context) },
        });
      },
      { correlationId: "corr-2" },
    );
    assert.equal(seen[0].correlationId, "corr-2");
    assert.equal(seen[0].metadata.transactionAttempt, 1);
    assert.match(seen[0].metadata.transactionId, /^[0-9a-f-]{36}$/);
  });

  it("replays the callback with distinct attempts and fires terminal hooks once", async () => {
    const events = /** @type {string[]} */ ([]);
    const { withTransaction } = setup(async (fn) => {
      await assert.rejects(fn(newSession(1)), /transient/);
      return fn(newSession(2));
    });
    let stale = /** @type {any} */ (undefined);
    const result = await withTransaction(
      async (tx) => {
        if (tx.attempt === 1) {
          stale = tx.ops;
          throw new Error("transient");
        }
        assert.equal(tx.session.id, 2);
        return tx.attempt;
      },
      {
        hooks: {
          onSuccess: () => void events.push("success"),
          onError: () => void events.push("error"),
          onComplete: () => void events.push("complete"),
        },
      },
    );
    assert.equal(result, 2);
    assert.deepEqual(events, ["success", "complete"]);
    await assert.rejects(stale.find({ model: "Thing" }), TransactionError);
  });

  it("rethrows the callback error unchanged and reports it once", async () => {
    const failure = new Error("business rule");
    const events = /** @type {string[]} */ ([]);
    const { withTransaction } = setup(commitOnce);
    await assert.rejects(
      withTransaction(
        async () => {
          throw failure;
        },
        {
          hooks: {
            onError: () => void events.push("error"),
            onSuccess: () => void events.push("ok"),
          },
        },
      ),
      (error) => error === failure,
    );
    assert.deepEqual(events, ["error"]);
  });

  it("wraps commit failures and keeps the uncertain commit outcome", async () => {
    const commit = Object.assign(new Error("commit unknown"), {
      hasErrorLabel: (/** @type {string} */ label) => label === "UnknownTransactionCommitResult",
    });
    const { withTransaction } = setup(async (fn) => {
      await fn(newSession(1));
      throw commit;
    });
    await assert.rejects(
      withTransaction(async () => "done"),
      (error) =>
        error instanceof TransactionError &&
        error.cause === commit &&
        error.databaseOutcome === "uncertain",
    );
  });

  it("reports definitive commit failures as failed", async () => {
    const { withTransaction } = setup(async (fn) => {
      await fn(newSession(1));
      throw new Error("write conflict");
    });
    await assert.rejects(
      withTransaction(async () => 1),
      (error) => error instanceof TransactionError && error.databaseOutcome === "failed",
    );
  });

  it("maps a standalone topology rejection to a clear TransactionError", async () => {
    const driver = Object.assign(
      new Error("Transaction numbers are only allowed on a replica set member or mongos"),
      { code: 20 },
    );
    const { withTransaction } = setup(commitOnce);
    await assert.rejects(
      withTransaction(async () => {
        throw driver;
      }),
      (error) =>
        error instanceof TransactionError &&
        /replica set/.test(error.message) &&
        error.cause === driver &&
        error.databaseOutcome === "notDispatched",
    );
  });

  it("rejects concurrent use of one transaction and allows sequential use", async () => {
    const { withTransaction, calls } = setup(commitOnce);
    await withTransaction(async (tx) => {
      const first = tx.ops.find({ model: "Thing", filter: {} });
      await assert.rejects(tx.ops.find({ model: "Thing", filter: {} }), TransactionError);
      await first;
      await tx.ops.find({ model: "Thing", filter: {} });
    });
    assert.equal(calls.length, 2);
  });

  it("runs independent transactions concurrently", async () => {
    let active = 0;
    let peak = 0;
    const { withTransaction } = setup(commitOnce);
    const work = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
    };
    await Promise.all([withTransaction(work), withTransaction(work)]);
    assert.equal(peak, 2);
  });

  it("rejects nested transactions, foreign sessions and use after the callback", async () => {
    const { withTransaction } = setup(commitOnce);
    let leaked = /** @type {any} */ (undefined);
    await withTransaction(async (tx) => {
      leaked = tx.ops;
      await assert.rejects(/** @type {any} */ (tx.ops).withTransaction(), TransactionError);
      await assert.rejects(
        tx.ops.find({ model: "Thing", options: { session: newSession(9) } }),
        InvalidOptionError,
      );
    });
    await assert.rejects(leaked.find({ model: "Thing" }), TransactionError);
  });

  it("stops issuing calls once cancelled", async () => {
    const controller = new AbortController();
    const { withTransaction, calls } = setup(commitOnce);
    await assert.rejects(
      withTransaction(
        async (tx) => {
          controller.abort(new Error("stop"));
          await tx.ops.find({ model: "Thing", filter: {} });
        },
        { signal: controller.signal },
      ),
      OperationAbortedError,
    );
    assert.equal(calls.length, 0);
  });

  it("validates its arguments before touching the connection", async () => {
    const { withTransaction } = setup(() => assert.fail("must not start"));
    await assert.rejects(withTransaction(/** @type {any} */ (null)), InvalidOptionError);
    await assert.rejects(
      withTransaction(async () => 1, /** @type {any} */ ({ retry: true })),
      InvalidOptionError,
    );
    await assert.rejects(
      withTransaction(async () => 1, /** @type {any} */ ("x")),
      InvalidOptionError,
    );
  });

  it("refuses owned sessions on the unscoped path and sessions from other clients", async () => {
    const verify = createSessionVerifier(() => /** @type {any} */ ({ getClient: () => client }));
    assert.doesNotThrow(() => verify(newSession(1)));
    assert.throws(() => verify({ inTransaction: () => true }), InvalidOptionError);
    assert.throws(() => verify({ client: {} }), InvalidOptionError);
    const { withTransaction } = setup(commitOnce);
    await withTransaction(async (tx) => {
      assert.throws(() => verify(tx.session), InvalidOptionError);
    });
    assert.doesNotThrow(() => verify(newSession(2)));
  });
});
