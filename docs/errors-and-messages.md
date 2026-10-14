# Errors and diagnostics

`MongoDockError(code, message, options?)` extends Error and preserves
`options.cause`. Default database outcome is `notDispatched`; invocation outcome
is `failed`. Explicit outcomes distinguish committed database success from a
failed post-execution invocation. Optional operationId/connection identify work.

`ConfigurationError` uses `ERR_CONFIGURATION`; `InvalidOptionError` uses
`ERR_INVALID_OPTION`. Shared ErrorCode declarations reserve the remaining
connection/model/veto/hook/abort/shutdown/bulk/transaction codes for later phases.
No unimplemented error subclasses are exported.

`isMongoDockError` narrows package errors. Native Mongoose errors will retain
their original codes/details in later operations, not be erased by a generic
wrapper.

`toSafeDiagnostic(error)` does not serialize native messages or causes. For
unrecognized errors it reports `ERR_DATABASE` and uncertain outcome; this is a
diagnostic classification, not a returned database success. Raw error/cause
objects can contain credentials and must not be logged without redaction.

## TransactionError

`TransactionError` (`ERR_TRANSACTION`, with an `errors` array) is raised for misuse of a transaction scope (concurrent, nested, closed or stale-attempt use), standalone-server rejection (`notDispatched`) and commit/abort failures (`failed`, or `uncertain` when the driver labels the commit `UnknownTransactionCommitResult`). The callback's own errors are rethrown unchanged. See [Transactions](transactions.md).

