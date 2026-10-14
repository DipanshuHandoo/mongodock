import mongoose from "mongoose";

/** @type {Promise<boolean> | undefined} */
let cached;

const detect = async () => {
  const uri = process.env.MONGODOCK_TEST_URI;
  if (!uri) throw new Error("Run through npm run test:integration");
  const connection = mongoose.createConnection(uri, { bufferCommands: false });
  try {
    await connection.asPromise();
    const hello = await connection.getClient().db("admin").command({ hello: 1 });
    return Boolean(hello.setName) || hello.msg === "isdbgrid";
  } finally {
    await connection.close();
  }
};

/**
 * Skips the current test on standalone servers. Returns true when skipped.
 * @param {import("node:test").TestContext} t
 */
export async function skipWithoutReplicaSet(t) {
  cached ??= detect();
  if (await cached) return false;
  t.skip("requires a replica set or sharded cluster");
  return true;
}
