import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import mongoose from "mongoose";
import { capture, run } from "./util.mjs";

export const MONGO_FIXTURES = Object.freeze({
  "8.0": {
    version: "8.0.17",
    image: "mongo:8.0.17@sha256:9814652e33f0cf8b9fddea8b46dfc9d8e19b130dcfdd7b510ca58bb0d40c8b71",
    windowsSha256: "39f0b72797f73e0909da3b454739d0f86bfcd5df436509f43d3df1aeeafc30e3",
  },
  "7.0": {
    version: "7.0.26",
    image: "mongo:7.0.26@sha256:8c3ce64d1a433bf57ea79035b48a38ea3e532997a1328fe3266e2e2e8bfb41b6",
    windowsSha256: "9ec43d80342ad0c447c62ff2a3f87a1c36258426b0dcd43e8a875b0bc6d60b56",
  },
});

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function download(url, file) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok || !response.body)
    throw new Error(`Fixture download failed: ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(file));
}

async function sha256(file) {
  const hash = createHash("sha256");
  const { createReadStream } = await import("node:fs");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function findMongod(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === "mongod.exe") return full;
    if (entry.isDirectory()) {
      const found = await findMongod(full);
      if (found) return found;
    }
  }
  return undefined;
}

async function startWindows(fixture, port, setName, directory) {
  const zip = path.join(directory, "mongo.zip");
  await download(
    `https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-${fixture.version}.zip`,
    zip,
  );
  if ((await sha256(zip)) !== fixture.windowsSha256) {
    throw new Error("MongoDB fixture checksum mismatch");
  }
  const extracted = path.join(directory, "binary");
  await run(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Expand-Archive -LiteralPath $env:MONGODOCK_FIXTURE_ZIP -DestinationPath $env:MONGODOCK_FIXTURE_EXTRACT",
    ],
    {
      env: {
        ...process.env,
        MONGODOCK_FIXTURE_ZIP: zip,
        MONGODOCK_FIXTURE_EXTRACT: extracted,
      },
    },
  );
  const executable = await findMongod(extracted);
  if (!executable) throw new Error("Verified MongoDB archive has no mongod.exe");
  const data = path.join(directory, "data");
  await mkdir(data);
  const log = path.join(directory, "mongo.log");
  const child = spawn(
    executable,
    [
      "--dbpath",
      data,
      "--port",
      String(port),
      "--bind_ip",
      "127.0.0.1",
      "--replSet",
      setName,
      "--logpath",
      log,
    ],
    { stdio: "ignore" },
  );
  let startupError;
  child.on("error", (error) => {
    startupError = error;
  });
  const exited = new Promise((resolve) => child.once("close", resolve));
  return {
    assertAlive: async () => {
      if (startupError || child.exitCode !== null || child.signalCode !== null) {
        const text = await readFile(log, "utf8").catch((error) => {
          if (error.code === "ENOENT") return "No MongoDB log was created.";
          throw error;
        });
        throw new Error(`MongoDB fixture exited: ${text.slice(-2_000)}`, { cause: startupError });
      }
    },
    stop: async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await exited;
    },
  };
}

async function startLinux(fixture, port, setName) {
  const result = await capture("docker", [
    "create",
    "--name",
    setName,
    "--publish",
    `127.0.0.1:${port}:${port}`,
    fixture.image,
    "mongod",
    "--replSet",
    setName,
    "--port",
    String(port),
    "--bind_ip_all",
  ]);
  if (result.code !== 0) throw new Error(`MongoDB container startup failed: ${result.stderr}`);
  const id = result.stdout.trim();
  if (!/^[a-f0-9]{64}$/.test(id))
    throw new Error("Docker did not return a valid owned container ID");
  try {
    await run("docker", ["start", id]);
  } catch (error) {
    try {
      await run("docker", ["rm", "--force", id]);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Container startup and cleanup failed");
    }
    throw error;
  }
  return {
    assertAlive: async () => {
      const status = await capture("docker", ["inspect", "--format", "{{.State.Running}}", id]);
      if (status.code !== 0 || status.stdout.trim() !== "true") {
        throw new Error("Owned MongoDB fixture container stopped unexpectedly");
      }
    },
    stop: () => run("docker", ["rm", "--force", id]),
  };
}

async function initialize(uri, setName, port, resource) {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    await resource.assertAlive();
    const connection = mongoose.createConnection(uri, { serverSelectionTimeoutMS: 1_000 });
    try {
      await connection.asPromise();
      const hello = await connection.db.admin().command({ hello: 1 });
      if (!hello.setName) {
        await connection.db.admin().command({
          replSetInitiate: { _id: setName, members: [{ _id: 0, host: `127.0.0.1:${port}` }] },
        });
      } else if (hello.isWritablePrimary && hello.setName === setName) {
        return;
      }
    } catch (error) {
      lastError = error;
    } finally {
      await connection.close();
    }
    await pause(250);
  }
  throw new Error("MongoDB replica-set fixture did not become primary", { cause: lastError });
}

/**
 * Only returns resources owned by this run. Supplied URIs never authorize dropping
 * their named database; tests generate and clean up their own database names.
 */
export async function createMongoFixture(env = process.env) {
  const fixture = MONGO_FIXTURES[env.MONGODOCK_TEST_MONGO_VERSION ?? "8.0"];
  if (!fixture) throw new Error("MONGODOCK_TEST_MONGO_VERSION must be 7.0 or 8.0");
  if (env.MONGODOCK_TEST_URI) {
    if (env.MONGODOCK_TEST_ALLOW_EXTERNAL !== "1") {
      throw new Error("External test URI requires MONGODOCK_TEST_ALLOW_EXTERNAL=1");
    }
    return { uri: env.MONGODOCK_TEST_URI, stop: async () => {} };
  }
  if (process.platform !== "linux" && process.platform !== "win32") {
    throw new Error(
      "Automatic fixtures support Linux/Windows; provide an opted-in test replica-set URI",
    );
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), "mongodock-fixture-"));
  const setName = `mongodock_${randomUUID().replaceAll("-", "")}`;
  let resource;
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    if (resource) await resource.stop();
    await rm(directory, { recursive: true, force: true });
    stopped = true;
  };
  try {
    const port = await freePort();
    resource =
      process.platform === "win32"
        ? await startWindows(fixture, port, setName, directory)
        : await startLinux(fixture, port, setName);
    const uri = `mongodb://127.0.0.1:${port}/?directConnection=true`;
    await initialize(uri, setName, port, resource);
    return { uri: `${uri}&replicaSet=${setName}`, stop };
  } catch (error) {
    try {
      await stop();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Fixture startup and cleanup failed");
    }
    throw error;
  }
}
