# Connections

`createMongoService(config)` returns a service over **owned** Mongoose connections
(`mongoose.createConnection()`); it never uses `mongoose.connect()` or global models.
Nothing connects until you call `connect`/`connectAll`.

```js
const db = createMongoService({
  connections: {
    primary: { uri: process.env.PRIMARY_URI },
    analytics: { uri: process.env.ANALYTICS_URI },
  },
  defaultConnection: "primary",
});
await db.connectAll();
db.use("analytics").getStatus(); // { name, state, readyState, owned }
await db.disconnectAll();
```

## API

| Method | Behavior |
| --- | --- |
| `connect(name?)` / `use(name).connect()` | Opens one connection. Concurrent calls share one open. A failed open leaves state `failed` and can be retried. |
| `connectAll()` | Opens all; if any fail, throws `ConnectionError` with per-connection `outcomes`. Successful connections stay open. |
| `disconnect(name?)` / `disconnectAll()` | Stops admission, drains tracked work, closes owned connections. Idempotent; a closed connection can be reopened. |
| `getStatus` / `listStatuses` / `isConnected` | Credential-safe snapshot. `ready` only while the driver reports connected. |
| `getConnection(name?)` | Native Mongoose `Connection`. |
| `use(name)` | Cached view bound to one connection; unknown names throw `ConnectionError`. |

States: `idle`, `connecting`, `ready`, `closing`, `closed`, `failed`. Driver
reconnects show as `connecting` and return to `ready`.

## Defaults

Command buffering is disabled. `autoIndex` and `autoCreate` default to `false`
(no implicit index builds); pass them in `options` to override.

## Shutdown

Operations and iterators register with the connection's admission tracker. Once
a disconnect starts, new work is rejected with `ConnectionError`; idle cursors
are cancelled; in-flight work gets `limits.drainTimeoutMS` (default 30 000). On
timeout `disconnect` throws `ShutdownTimeoutError` (`pending`, `databaseOutcome:
"uncertain"`) and the connection **stays `closing`**; calling `disconnect` again
waits with a fresh budget. There is no force close.

## Caller-owned connections

Pass `connections: { name: { connection } }` with `bufferCommands` disabled. The
service never closes it and never removes listeners it did not add.

## Hooks

Mongoose events map to `onConnectionConnecting`, `onConnectionConnected`,
`onConnectionDisconnected`, `onConnectionReconnected`, and `onConnectionError`
(plugins first, then service hooks). Hook failures go to `onHookError` and never
affect connection state.

Standalone MongoDB servers are fine for connection management; transactions
(later phases) require a replica set.
