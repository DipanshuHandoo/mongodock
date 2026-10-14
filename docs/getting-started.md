# Getting started

## Install

```sh
npm install @dipanshuhandoo/mongodock mongoose
```

Requires Node.js >=22.18.0 and Mongoose `^8.24.5 || ^9.11.2`. Mongoose is a peer dependency so your
application controls its version. MongoDB 7.0 or 8.0 is supported; transactions need a replica set.

## Minimal setup

```js
import mongoose from "mongoose";
import { createMongoService } from "@dipanshuhandoo/mongodock";

const db = createMongoService({ uri: process.env.MONGO_URI });
db.registerModel({ name: "Page", schema: new mongoose.Schema({ url: String, status: Number }) });
await db.connect();

const created = await db.create({ model: "Page", data: { url: "https://example.com", status: 200 } });
const found = await db.findById({ model: "Page", id: created.id, lean: true });
const total = await db.countDocuments({ model: "Page", filter: { status: 200 } });

await db.disconnect();
```

Every call takes one object. `model` is a registered name; `filter`, `limit`, `lean`, `sort` and
native `options` are method specific. See [Queries and writes](queries.md).

## Beyond the minimum

None of the following is required.

- Several databases: [Connections](connections.md)
- Large scans and exports: [Pagination and streaming](pagination.md)
- Bulk jobs and seeds: [Bulk processing](bulk-processing.md), [Seeding](seeding.md)
- Atomic multi-write work: [Transactions](transactions.md)
- Observability and cross-cutting behavior: [Hooks](hooks.md), [Plugins](plugins.md), [Retries](retries.md)
- Readiness endpoints: [Health](health.md)

## Shutting down

Call `disconnectAll()` on `SIGTERM`. It rejects new work, drains in-flight operations within
`limits.drainTimeoutMS`, then closes the connections the service owns.

## From a checkout

`npm ci`, then `npm run verify`. `npm run test:package` installs a real tarball into an isolated
consumer and exercises ESM, CommonJS, TypeScript and the offline examples on both Mongoose majors.
