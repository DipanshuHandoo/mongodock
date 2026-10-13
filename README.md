# @dipanshuhandoo/mongodock

> TODO: one-sentence description of what this package does.

[![CI](https://github.com/DipanshuHandoo/mongodock/actions/workflows/ci.yml/badge.svg)](https://github.com/DipanshuHandoo/mongodock/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@dipanshuhandoo/mongodock)](https://www.npmjs.com/package/@dipanshuhandoo/mongodock)

## Requirements

Node.js >= 22.18.0.

## Install

```sh
npm install @dipanshuhandoo/mongodock
```

## Quick start

```js
import { withRetry } from "@dipanshuhandoo/mongodock";

const data = await withRetry(() => fetchSomething(), { retries: 3 });
```

CommonJS:

```js
const { withRetry } = require("@dipanshuhandoo/mongodock");
```

## Advanced usage

```js
import { withRetry, RetryExhaustedError } from "@dipanshuhandoo/mongodock";

const controller = new AbortController();
try {
  await withRetry((attempt) => callApi(attempt), {
    retries: 5,
    minDelayMs: 200,
    maxDelayMs: 10_000,
    signal: controller.signal,
    shouldRetry: (error) => error.status >= 500,
    onRetry: ({ attempt, delayMs, error }) => console.warn("retrying", { attempt, delayMs, error }),
  });
} catch (error) {
  if (error instanceof RetryExhaustedError) console.error(error.attempts, error.cause);
}
```

## Documentation

- [Getting started](docs/getting-started.md)
- [Configuration](docs/configuration.md)
- [Retry guide](docs/retry.md)
- [API reference](docs/api-reference.md)
- [Errors and messages](docs/errors-and-messages.md)
- [Troubleshooting](docs/troubleshooting.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Maintainers: see [MAINTAINING.md](MAINTAINING.md).

## License

MIT
