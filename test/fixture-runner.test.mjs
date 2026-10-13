import assert from "node:assert/strict";
import { it } from "node:test";
import { createMongoFixture, MONGO_FIXTURES } from "../scripts/lib/mongo-fixture.mjs";

it("fixture pins are exact and contain verified hashes", () => {
  for (const fixture of Object.values(MONGO_FIXTURES)) {
    assert.match(fixture.image, /@sha256:[a-f0-9]{64}$/);
    assert.match(fixture.windowsSha256, /^[a-f0-9]{64}$/);
  }
});

it("fixture rejects unsupported versions and unapproved external URIs before startup", async () => {
  await assert.rejects(
    createMongoFixture({ MONGODOCK_TEST_MONGO_VERSION: "unknown" }),
    /7.0 or 8.0/,
  );
  await assert.rejects(
    createMongoFixture({ MONGODOCK_TEST_URI: "mongodb://localhost/example" }),
    /ALLOW_EXTERNAL/,
  );
  const fixture = await createMongoFixture({
    MONGODOCK_TEST_URI: "mongodb://localhost/example",
    MONGODOCK_TEST_ALLOW_EXTERNAL: "1",
  });
  assert.equal(fixture.uri, "mongodb://localhost/example");
  await fixture.stop();
});
