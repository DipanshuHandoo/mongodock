# Scale and reliability

`npm run test:scale` pushes one million lazily generated operations through the real bulk engine
(`createOperations(...).bulkWrite`) against an in-memory model, with skewed batch latency.

It asserts: status `completed`; every operation dispatched exactly once; active batches never above
`concurrency`; buffered operations never above `batchSize * (concurrency + 1)`; bounded diagnostics;
the source iterator closed; and heap that does not grow with input size.

Local result (Node 24, Mongoose 9, batch 1000, concurrency 8):

| Payload | Ops/s | Max active | Max buffered | Peak heap |
| --- | --- | --- | --- | --- |
| 0 B | ~320k | 8 | 8001 | ~98 MB |
| 256 B | ~240k | 8 | 8001 | ~68-113 MB |

These numbers measure **scheduler and memory behaviour**, not database throughput.

Optional real-database run: set `MONGODOCK_SCALE_URI` (and `MONGODOCK_TEST_ALLOW_EXTERNAL=1` for
non-managed servers) and optionally `MONGODOCK_SCALE_REAL_TOTAL` (default 50,000). It uses a temporary
`mongodock_test_*` database that is dropped afterwards. One local standalone run wrote 50,000
documents at ~72k ops/s; that is a single-machine figure, not a benchmark.

## Evidence and open items

- Covered locally: scheduler scale, stream-to-seed over a real database (slow sink, idempotent re-run,
  mid-stream cancellation), Mongoose 8 and 9 package consumption (`test:package`).
- CI only: Linux and Windows on Node 22 and 24 with Mongoose 8.24.5 and 9.11.2, and the Linux scale job.
- Not yet verified: MongoDB 7.0 versus 8.0 server matrix, transactions on Mongoose 8, shutdown-during-bulk
  and fault-injection tests against real driver errors.
