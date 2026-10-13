import { createMongoFixture } from "./lib/mongo-fixture.mjs";
import { fail, runNode } from "./lib/util.mjs";

let fixture;
let interrupted = false;
const controller = new AbortController();
const interrupt = () => {
  interrupted = true;
  controller.abort();
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
try {
  fixture = await createMongoFixture();
  if (interrupted) throw new Error("Integration run interrupted before execution");
  await runNode(["--test", "test/integration/*.test.js"], {
    env: { ...process.env, MONGODOCK_TEST_URI: fixture.uri },
    signal: controller.signal,
  });
} catch (error) {
  fail(error);
} finally {
  try {
    if (fixture) await fixture.stop();
  } catch (error) {
    fail(error);
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
}
