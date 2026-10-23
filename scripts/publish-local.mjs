import readline from "node:readline/promises";
import { capture, captureNpm, fail, log, readPackage, runNpm } from "./lib/util.mjs";

// One-time bootstrap publish from a maintainer machine. Normal releases use the Release workflow
// (OIDC + provenance). This skips the prepublish guard, so every safety check lives here instead.
const pkg = readPackage();
const spec = `${pkg.name}@${pkg.version}`;
const distTag = pkg.version.includes("-") ? "next" : "latest";

async function git(...args) {
  const result = await capture("git", args);
  if (result.code !== 0) throw new Error(`git ${args.join(" ")} failed:\n${result.stderr}`);
  return result.stdout.trim();
}

async function assertReleasable() {
  if (await git("status", "--porcelain")) throw new Error("git working tree is not clean");
  const branch = await git("rev-parse", "--abbrev-ref", "HEAD");
  if (branch !== "main") throw new Error(`must publish from main (on ${branch})`);

  await git("fetch", "origin", "main");
  if ((await git("rev-parse", "HEAD")) !== (await git("rev-parse", "origin/main"))) {
    throw new Error("local main differs from origin/main; pull or push first");
  }

  const view = await captureNpm(["view", spec, "version", "--json"]);
  const output = `${view.stdout}\n${view.stderr}`;
  if (view.code === 0 && view.stdout.trim()) throw new Error(`${spec} is already published`);
  if (!/E404|404 Not Found|is not in this registry/i.test(output)) {
    throw new Error(`could not determine whether ${spec} exists:\n${output.trim()}`);
  }

  const who = await captureNpm(["whoami"]);
  if (who.code !== 0) throw new Error("not logged in to npm; run `npm login` first");
  return who.stdout.trim();
}

async function confirm(user) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `\nPublish ${spec} to npm as "${user}" with tag "${distTag}" (no provenance)?\nType the version to confirm: `,
  );
  rl.close();
  if (answer.trim() !== pkg.version)
    throw new Error("confirmation did not match; nothing published");
}

async function main() {
  const user = await assertReleasable();
  log(`Running full verification for ${spec}`);
  await runNpm(["run", "verify"]);
  await confirm(user);
  log("Publishing (npm will ask for your 2FA code)");
  await runNpm([
    "publish",
    "--access",
    "public",
    "--tag",
    distTag,
    "--provenance=false",
    "--ignore-scripts",
  ]);
  log(
    `Published ${spec}. Next: add the Trusted Publisher on npmjs.com so releases can use the workflow.`,
  );
}

main().catch(fail);
