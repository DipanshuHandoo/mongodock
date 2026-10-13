# Troubleshooting

**No createMongoService export:** Phase 1 is foundation-only. Database factory
and operations arrive in subsequent phases; the old withRetry demo is removed.

**Named config rejected:** Set defaultConnection to an existing name. Do not
combine top-level uri/options with connections.

**Caller-owned connection rejected:** Set bufferCommands false on the connection
and ensure it exposes the Mongoose public connection contract. Native lifecycle
management is not implemented by normalization.

**Integration prerequisites missing:** Linux needs a running Docker daemon.
Windows fixtures download verified native binaries. Supply an explicitly opted-in
isolated replica-set URI if automatic provisioning is unavailable. Missing
prerequisites are an integration failure, not a skipped passing check.

**URI or native error contains secrets:** Do not log normalized config or raw
causes. Use toSafeDiagnostic for minimal metadata.
