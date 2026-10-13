import assert from "node:assert/strict";
import { it } from "node:test";
import {
  ConfigurationError,
  InvalidOptionError,
  isMongoDockError,
  MongoDockError,
  toSafeDiagnostic,
} from "../src/index.js";

it("control errors preserve native causes and actual outcomes", () => {
  const cause = new Error("mongodb://user:password@host");
  const error = new MongoDockError("ERR_HOOK", "Post-execution hook failed", {
    cause,
    databaseOutcome: "succeeded",
    operationId: "operation-1",
    connection: "primary",
  });
  assert.equal(error.cause, cause);
  assert.equal(error.databaseOutcome, "succeeded");
  assert.equal(error.invocationOutcome, "failed");
  assert.equal(isMongoDockError(error), true);
  assert.equal(isMongoDockError(cause), false);
  assert.equal(new ConfigurationError("Invalid input").code, "ERR_CONFIGURATION");
  assert.equal(new InvalidOptionError("Invalid input", { cause }).cause, cause);
});

it("safe diagnostics exclude sensitive messages and native causes", () => {
  const error = new ConfigurationError("password");
  assert.deepEqual(toSafeDiagnostic(error), {
    code: "ERR_CONFIGURATION",
    databaseOutcome: "notDispatched",
    invocationOutcome: "failed",
    operationId: undefined,
    connection: undefined,
  });
  assert.deepEqual(toSafeDiagnostic(new Error("password")), {
    code: "ERR_DATABASE",
    databaseOutcome: "uncertain",
  });
  assert.equal(JSON.stringify(toSafeDiagnostic(error)).includes("password"), false);
});
