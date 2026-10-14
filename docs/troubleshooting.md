# Troubleshooting

**Operation rejected before reaching the database:** Control errors are `MongoDockError`s with a
`code` (see [Errors](errors-and-messages.md)). `databaseOutcome: \
**Named config rejected:** Set defaultConnection to an existing name. Do not
combine top-level uri/options with connections.

**Caller-owned connection rejected:** Set bufferCommands false on the connection
and ensure it exposes the Mongoose public connection contract. The service never closes
a connection you supplied.

**Integration prerequisites missing:** Linux needs a running Docker daemon.
Windows fixtures download verified native binaries. Supply an explicitly opted-in
isolated replica-set URI if automatic provisioning is unavailable. Missing
prerequisites are an integration failure, not a skipped passing check.

**URI or native error contains secrets:** Do not log normalized config or raw
causes. Use toSafeDiagnostic for minimal metadata.
