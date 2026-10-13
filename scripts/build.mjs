import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { fail, log, readConfig, readPackage, root, runBin } from "./lib/util.mjs";

const config = readConfig();
const pkg = readPackage();
const dist = path.join(root, "dist");

const external = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
  ...Object.keys(pkg.optionalDependencies ?? {}),
];

const entryPoints = Object.fromEntries(
  Object.entries(config.entries).map(([name, source]) => [
    name,
    path.join(root, `${source}.${config.language === "js" ? "js" : "ts"}`),
  ]),
);

const common = {
  absWorkingDir: root,
  entryPoints,
  bundle: true,
  sourcemap: true,
  sourcesContent: false,
  legalComments: "none",
  logLevel: "warning",
};

function bundle(options) {
  return Promise.all(
    [false, true].map((minify) =>
      build({
        ...common,
        ...options,
        minify,
        entryNames: minify ? "[name].min" : "[name]",
      }),
    ),
  );
}

async function main() {
  rmSync(dist, { recursive: true, force: true });

  log("Bundling ESM, CommonJS and (if enabled) browser builds");
  const jobs = [
    bundle({
      format: "esm",
      platform: "node",
      target: config.nodeTarget,
      outdir: path.join(dist, "esm"),
      external,
    }),
    bundle({
      format: "cjs",
      platform: "node",
      target: config.nodeTarget,
      outdir: path.join(dist, "cjs"),
      external,
    }),
  ];
  if (config.browser) {
    jobs.push(
      bundle({
        format: "iife",
        platform: "browser",
        globalName: config.globalName,
        target: config.browserTarget,
        outdir: path.join(dist, "browser"),
      }),
    );
  }
  await Promise.all(jobs);
  writeFileSync(
    path.join(dist, "cjs", "package.json"),
    `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
  );

  log("Generating type declarations");
  await runBin("typescript", "tsc", ["-p", "tsconfig.build.json"]);

  // CommonJS consumers need declarations that resolve under the commonjs package marker.
  copyDeclarations(path.join(dist, "esm"), path.join(dist, "cjs"));

  console.log(`Build complete: dist/esm, dist/cjs${config.browser ? ", dist/browser" : ""}`);
}

function copyDeclarations(source, destination) {
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      copyDeclarations(path.join(source, entry.name), path.join(destination, entry.name));
    } else if (entry.name.endsWith(".d.ts")) {
      mkdirSync(destination, { recursive: true });
      cpSync(path.join(source, entry.name), path.join(destination, entry.name));
    }
  }
}

main().catch((error) => fail(error));
