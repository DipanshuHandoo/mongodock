import { createInterface } from "node:readline/promises";
import mongoose from "mongoose";
import { createMongoService } from "../src/index.js";

const uri = process.env.MONGODOCK_URI ?? "mongodb://localhost:27017/mongodock";
const MODEL = "DemoItem";
const flag = (name) => process.argv.includes(name) || process.env.MONGODOCK_DEMO === name.slice(2);

const ask = async (question) => {
  if (flag("--keep")) return true;
  if (flag("--cleanup")) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(question);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
};

const step = (label, value) => console.log(`  ${label.padEnd(26)} ${value}`);

const db = createMongoService({
  connections: { main: { uri } },
  defaultConnection: "main",
});

try {
  await db.connect();
  db.registerModel({
    name: MODEL,
    schema: new mongoose.Schema({
      sku: { type: String, unique: true },
      qty: Number,
      group: String,
    }),
  });
  const model = db.getModel(MODEL);
  const dbName = model.db.name;
  const collection = model.collection.name;
  console.log(`\nTarget: ${dbName}.${collection} at ${uri.replace(/\/\/[^@/]*@/, "//***@")}\n`);

  const health = await db.healthCheck();
  step("health ready", health.ready);

  await db.deleteMany({ model: MODEL, filter: {}, allowAll: true });
  const data = Array.from({ length: 25 }, (_, i) => ({
    sku: `sku-${String(i + 1).padStart(3, "0")}`,
    qty: (i + 1) * 10,
    group: i % 2 === 0 ? "even" : "odd",
  }));
  await db.insertMany({ model: MODEL, data });
  step("inserted", data.length);
  step("countDocuments", await db.countDocuments({ model: MODEL }));

  const page = await db.paginate({ model: MODEL, page: 2, limit: 10, sort: { qty: 1 } });
  step("page 2 of", `${page.totalPages} (${page.docs.length} docs)`);

  await db.updateOne({ model: MODEL, filter: { sku: "sku-001" }, update: { $set: { qty: 999 } } });
  const one = await db.findOne({ model: MODEL, filter: { sku: "sku-001" }, lean: true });
  step("updated sku-001 qty", one?.qty);

  const groups = await db.aggregate({
    model: MODEL,
    pipeline: [{ $group: { _id: "$group", total: { $sum: "$qty" } } }, { $sort: { _id: 1 } }],
  });
  step("aggregate by group", JSON.stringify(groups));

  try {
    await db.withTransaction(async (tx) => {
      await tx.ops.create({ model: MODEL, data: { sku: "tx-1", qty: 1, group: "tx" } });
    });
    step("transaction", "committed (replica set)");
  } catch (error) {
    step("transaction", `skipped: ${error.code ?? error.name} (needs a replica set)`);
  }

  // Counted by the native driver, independent of the package, to prove data is in MongoDB.
  const raw = await model.collection.countDocuments({});
  step("raw driver count", raw);
  console.log(`\nInspect now: mongosh "${uri}" --eval "db.${collection}.find().limit(3)"`);
  console.log(`or MongoDB Compass -> ${dbName} -> ${collection}\n`);

  const keep = await ask(`Keep the demo data in ${dbName}.${collection}? [y/N] `);
  if (keep) {
    console.log("Kept. Drop it later with: npm run demo:live:cleanup");
  } else {
    await model.collection.drop().catch(() => {});
    console.log("Demo collection dropped.");
  }
} catch (error) {
  console.error("Demo failed:", error);
  process.exitCode = 1;
} finally {
  await db.disconnect().catch(() => {});
}
