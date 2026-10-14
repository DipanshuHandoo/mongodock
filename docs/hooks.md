# Hooks

Hooks are plain functions on `hooks` (service level), on a plugin, or on a single call.
Execution order is always: plugins (registration order) → service hooks → call hooks, each
awaited sequentially. Every hook has a time budget (`limits.hookTimeoutMS`, default 5000 ms).
A hook that exceeds it is abandoned, not cancelled; cooperate through `context.signal`.

## Hook reference

| Hook | Receives | May return |
| --- | --- | --- |
| `beforeOperation(input, context)` | private copy of the input | replacement input, `undefined`, or `false` (veto → `OperationVetoError`) |
| `beforeRetry({ attempt, nextAttempt, delayMs, error, context })` | retry details | `false` to stop and rethrow the last database error |
| `afterOperation(result, context)` | the result | `{ result }` or `undefined` |
| `beforeError(error, context)` | the failure | an `Error` replacement (original kept as `cause`) or `undefined` |
| `onSuccess(completion)` / `onError(completion)` | outcome, `result`/`error` | ignored |
| `onComplete(completion)` | outcome | ignored; runs once after cleanup, like `finally` |
| `onHookError({ error, hookName, scope, context })` | observer failure | ignored |
| `onConnectionConnected` and other `onConnection*` | safe connection status | ignored; no operation context |

Exactly one of `onSuccess`/`onError` runs per logical operation. A resolved partial bulk report
runs `onError`. Retries do not rerun `beforeOperation`.

## Failure semantics

- A throwing or invalid `beforeOperation`, `beforeRetry`, `afterOperation` or `beforeError` fails the
  operation with `HookError` (`error.original` keeps the underlying failure).
- Observer failures (`onSuccess`, `onError`, `onComplete`, connection events, cleanup) go to
  `onHookError`. If none is configured, or it also fails, the operation throws a composite
  `HookError` carrying `errors` and `original`.
- Each failure reports `databaseOutcome` (`notDispatched`, `uncertain`, `succeeded`, `failed`,
  `pendingCommit`) and `invocationOutcome` (`succeeded`, `failed`, `partial`, `cancelled`,
  `closedEarly`). A write that fails natively stays `uncertain`.

## Streams

Streams are lazy: nothing is admitted or opened until the first `next()`. Exhaustion runs
`onSuccess`; breaking out early closes the cursor and runs only `onComplete` with
`closedEarly`; failures run `beforeError` and `onError`. Streams are never retried.
