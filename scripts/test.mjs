import { readdirSync } from "node:fs";
import path from "node:path";
import { runNode, readConfig, sourceExtension, fail, root } from "./lib/util.mjs";

const coverage = process.argv.includes("--coverage");
const config = readConfig();
const ext = sourceExtension();

const args = ["--test"];
if (coverage) {
  args.push(
    "--experimental-test-coverage",
    "--test-coverage-include=src/**",
    `--test-coverage-lines=${config.coverage.lines}`,
    `--test-coverage-branches=${config.coverage.branches}`,
    `--test-coverage-functions=${config.coverage.functions}`,
  );
}
function tests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "integration" ? [] : tests(file);
    }
    return entry.name.endsWith(`.test.${ext}`) || entry.name.endsWith(".test.mjs") ? [file] : [];
  });
}
args.push(...tests(path.join(root, "test")));

runNode(args).catch((error) => fail(error));
