# Health

```js
const report = await db.healthCheck();            // all connections
// { ready, checkedAt, required, connections: { main: { ready, state, probed, latencyMs, ... } } }

const one = await db.use("analytics").healthCheck();
const quick = await db.healthCheck({ probe: false }); // status only, no network
```

`getStatus()` is the cheap, network-free state of one connection. `healthCheck()` additionally
sends one `ping` per ready connection, in parallel.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `probe` | `true` | `false` reports current state only; every report has `probed: false`. |
| `timeoutMS` | `limits.probeTimeoutMS` (5,000) | Positive integer probe budget. |
| `signal`, `correlationId`, `hooks`, `metadata` | | Same as operations. |

## Report

Per connection: `name`, `ready`, `state`, `probed`, `checkedAt` (ISO), `latencyMs` (probed only),
and a safe `error` (`code`, `databaseOutcome`; never URIs or credentials).

A connection that is not in the `ready` state is reported without a probe. A ping that fails
yields `ready: false` and fires `onError` observers, and the call still resolves: health checks
describe failures rather than throw them. There is no retry. Cancelling through `signal` rejects
with `OperationAbortedError`.

When the budget expires the report has `deadlineExpired: true` and `nativeOperationActive: true`:
the driver ping cannot be cancelled and may still be running, so the package does not claim it
stopped.

## Aggregate readiness

`service.healthCheck()` returns `{ ready, required, connections }`. `ready` is true when every
connection in `requiredConnections` (default: all configured connections; set a nonempty subset
in the config) is ready. Optional connections still appear in `connections`.

## HTTP

No routes are installed. Map it yourself:

```js
app.get("/ready", async (_req, res) => {
  const report = await db.healthCheck();
  res.status(report.ready ? 200 : 503).json(report);
});
```
