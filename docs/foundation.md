# Foundation and dependency contracts

## Scope

Phase 1 provides JavaScript/JSDoc declarations, configuration, safe diagnostics,
dual module builds, artifact checks, and isolated replica-set fixtures. No
runtime factory, CRUD, retry execution, bulk, pagination, or seed API exists yet.
Source maps omit embedded source text to avoid distributing four copies of
private implementation/JSDoc while retaining relative mappings; readable builds
remain available. This keeps the existing 40 KiB packed/160 KiB unpacked gates.

## Dependencies

Mongoose is an external peer and a development verification dependency.
Candidate range: `^8.24.5 || ^9.11.2`. Those versions use MongoDB drivers 6.20.x
and 7.7.x respectively. Version ranges are support targets; phase evidence must
distinguish observed builds from final domain compatibility testing.

async-slot-pool 1.0.1 is the only added runtime dependency. Its published artifact
is checked for ESM/CJS identity, synchronous iterable input, retained results,
stringified errors, swallowed observer exceptions, lazy iteration, bail behavior,
and non-cancelling timeouts. The future bulk bridge must use bounded windows,
preserve errors itself, disable pool retries/timeouts, and await its own sinks.

Both peers expose the driver's BSON API through `mongoose.mongo.BSON`; the
foundation contract test checks ObjectId size calculation. No separately
versioned BSON runtime dependency is added.

## Fixture pins

Pins were resolved from official download/registry endpoints, not invented.
Windows archives are streamed and hash-checked before execution. Linux images
are pinned to manifest digest, with Docker validating layer content.

| Server | Windows archive SHA-256 | Docker manifest digest |
| --- | --- | --- |
| 8.0.17 | 39f0b72797f73e0909da3b454739d0f86bfcd5df436509f43d3df1aeeafc30e3 | sha256:9814652e33f0cf8b9fddea8b46dfc9d8e19b130dcfdd7b510ca58bb0d40c8b71 |
| 7.0.26 | 9ec43d80342ad0c447c62ff2a3f87a1c36258426b0dcd43e8a875b0bc6d60b56 | sha256:8c3ce64d1a433bf57ea79035b48a38ea3e532997a1328fe3266e2e2e8bfb41b6 |

## Contracts for subsequent phases

Database calls use object arguments with protected model/connection/session
identity and distinct wrapper/native options. Hooks receive validated inputs and
separate invocation/database outcomes. Ordinary write errors retain native
results/causes. Streaming is lazy AsyncIterable; native and batched bulk results
are deliberately different. Schemas/model types, native method-specific inputs,
session facade, and bulk overload contracts are specified in
[Operation contracts](operation-contracts.md), not exported executable stubs.
