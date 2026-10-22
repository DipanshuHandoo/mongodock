import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyChanges } from "../scripts/ci-scope.mjs";

const pkg = (version, extra = {}) =>
  JSON.stringify({ name: "x", version, dependencies: { a: "^1.0.0" }, ...extra });
const lock = (version, extra = {}) =>
  JSON.stringify({
    name: "x",
    version,
    lockfileVersion: 3,
    packages: { "": { name: "x", version }, "node_modules/a": { version: "1.0.0", ...extra } },
  });

const reader = (files) => (revision, file) => {
  const content = files[revision][file];
  if (content === undefined) throw new Error(`missing ${revision}:${file}`);
  return content;
};

test("a changeset version commit is metadata-only", () => {
  const changes = [
    { status: "D", file: ".changeset/pink-dancers-begin.md" },
    { status: "M", file: "CHANGELOG.md" },
    { status: "M", file: "package.json" },
    { status: "M", file: "package-lock.json" },
  ];
  const files = {
    base: { "package.json": pkg("0.1.0"), "package-lock.json": lock("0.1.0") },
    head: { "package.json": pkg("0.2.0"), "package-lock.json": lock("0.2.0") },
  };
  assert.equal(classifyChanges(changes, reader(files)).metadataOnly, true);
});

test("an empty diff is metadata-only", () => {
  assert.equal(classifyChanges([], reader({ base: {}, head: {} })).metadataOnly, true);
});

test("source changes require full CI", () => {
  const result = classifyChanges([{ status: "M", file: "src/index.js" }], reader({}));
  assert.equal(result.metadataOnly, false);
  assert.match(result.reason, /src\/index\.js/);
});

test("non-markdown changeset files require full CI", () => {
  const changes = [{ status: "M", file: ".changeset/config.json" }];
  assert.equal(classifyChanges(changes, reader({})).metadataOnly, false);
});

test("package.json changes beyond version require full CI", () => {
  const changes = [{ status: "M", file: "package.json" }];
  const files = {
    base: { "package.json": pkg("0.1.0") },
    head: { "package.json": pkg("0.2.0", { dependencies: { a: "^2.0.0" } }) },
  };
  assert.equal(classifyChanges(changes, reader(files)).metadataOnly, false);
});

test("lockfile dependency changes require full CI", () => {
  const changes = [{ status: "M", file: "package-lock.json" }];
  const files = {
    base: { "package-lock.json": lock("0.1.0") },
    head: { "package-lock.json": lock("0.2.0", { version: "1.0.1" }) },
  };
  assert.equal(classifyChanges(changes, reader(files)).metadataOnly, false);
});

test("added or deleted manifests require full CI", () => {
  const changes = [{ status: "D", file: "package-lock.json" }];
  assert.equal(classifyChanges(changes, reader({})).metadataOnly, false);
});

test("unparseable manifests require full CI", () => {
  const changes = [{ status: "M", file: "package.json" }];
  const files = { base: { "package.json": "{" }, head: { "package.json": pkg("0.2.0") } };
  const result = classifyChanges(changes, reader(files));
  assert.equal(result.metadataOnly, false);
  assert.match(result.reason, /could not be compared/);
});
