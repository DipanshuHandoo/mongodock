import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// A commit is release-metadata-only when it touches nothing but changeset notes, the changelog
// and the version fields that `changeset version` rewrites. Such commits ship the same code as
// their parent, so CI may reuse the parent's result instead of rerunning the full matrix.
const METADATA_FILES = [/^CHANGELOG\.md$/, /^\.changeset\/[^/]+\.md$/];

const VERSION_FIELDS = {
  "package.json": [["version"]],
  "package-lock.json": [["version"], ["packages", "", "version"]],
};

const withoutPaths = (json, paths) => {
  const copy = structuredClone(json);
  for (const keys of paths) {
    const parent = keys.slice(0, -1).reduce((node, key) => node?.[key], copy);
    if (parent && typeof parent === "object") delete parent[keys.at(-1)];
  }
  return copy;
};

/**
 * @param {{ status: string, file: string }[]} changes from `git diff --name-status --no-renames`
 * @param {(revision: "base" | "head", file: string) => string} readFile
 * @returns {{ metadataOnly: boolean, reason: string }}
 */
export function classifyChanges(changes, readFile) {
  if (changes.length === 0) return { metadataOnly: true, reason: "no file changes" };

  for (const { status, file } of changes) {
    if (METADATA_FILES.some((pattern) => pattern.test(file))) continue;

    const versionPaths = VERSION_FIELDS[file];
    if (!versionPaths || status !== "M") {
      return { metadataOnly: false, reason: `${file} (${status}) is not release metadata` };
    }

    try {
      const before = withoutPaths(JSON.parse(readFile("base", file)), versionPaths);
      const after = withoutPaths(JSON.parse(readFile("head", file)), versionPaths);
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        return { metadataOnly: false, reason: `${file} changed beyond its version fields` };
      }
    } catch (error) {
      return { metadataOnly: false, reason: `${file} could not be compared: ${error.message}` };
    }
  }

  return { metadataOnly: true, reason: "only release metadata changed" };
}

const isSha = (value) => typeof value === "string" && /^[0-9a-f]{40}$/i.test(value);

function main([base, head]) {
  if (!isSha(base) || !isSha(head) || /^0+$/.test(base)) {
    console.log("ci-scope: no comparable base commit; full CI required");
    return 1;
  }

  const git = (...args) =>
    execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

  const changes = git("diff", "--name-status", "--no-renames", base, head)
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, file] = line.split("\t");
      return { status, file };
    });

  const revisions = { base, head };
  const { metadataOnly, reason } = classifyChanges(changes, (revision, file) =>
    git("show", `${revisions[revision]}:${file}`),
  );
  console.log(`ci-scope: ${reason}; ${metadataOnly ? "light" : "full"} CI`);
  return metadataOnly ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.log(`ci-scope: ${error.message}; full CI required`);
    process.exitCode = 1;
  }
}
