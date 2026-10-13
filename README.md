# @dipanshuhandoo/mongodock

Node.js Mongoose service toolkit, currently at **Phase 1: configuration and
package foundation**. Database service operations are not implemented yet.
This checkout is not a production-ready release.

## Requirements

Node.js >=22.18.0. Mongoose is an external peer; candidate support is
`^8.24.5 || ^9.11.2`. Published slot scheduling dependency:
`@dipanshuhandoo/async-slot-pool` 1.0.1. Compatibility evidence and fixture pins
are recorded in [Foundation](docs/foundation.md).

## Current public API

```js
import { normalizeConfig } from "@dipanshuhandoo/mongodock";

const config = normalizeConfig({
  uri: "mongodb://localhost:27017/example",
  limits: { concurrency: 2, batchSize: 500 },
});
```

CommonJS:

```js
const { normalizeConfig } = require("@dipanshuhandoo/mongodock");
```

Normalization validates configuration without opening a database connection.
It preserves explicit ownership, disables hidden command buffering, snapshots
hook/plugin registrations, and rejects unknown wrapper options. Do not log the
normalized object: it retains connection URIs.

## Development

```sh
npm ci
npm run verify
```

`verify` requires an isolated real MongoDB replica set. Windows automatically
downloads checksum-verified native binaries; Linux requires Docker. The fixture
runner owns and removes its database/process resources. See
[Testing](docs/testing.md) for explicit external-fixture opt-in.

## Guides

- [Getting started](docs/getting-started.md)
- [Configuration](docs/configuration.md)
- [API reference](docs/api-reference.md)
- [Errors and diagnostics](docs/errors-and-messages.md)
- [Foundation and dependency contracts](docs/foundation.md)
- [Testing and fixtures](docs/testing.md)
- [Troubleshooting](docs/troubleshooting.md)

The repository [phase plans](plans/phases/README.md) describe future capabilities,
not implemented APIs. No factory, CRUD, stream, transaction, bulk, or seed runtime
is exported in Phase 1.

## License

MIT. See [LICENSE](LICENSE). Contribution/release policy remains in
[CONTRIBUTING.md](CONTRIBUTING.md) and [MAINTAINING.md](MAINTAINING.md).
