# Getting started

## Requirements

Node.js >= 22.18.0. The package ships ESM and CommonJS builds with TypeScript declarations.

## Install

```sh
npm install @dipanshuhandoo/mongodock
```

## First call

```js
import { withRetry } from "@dipanshuhandoo/mongodock";

const result = await withRetry(async (attempt) => callService(attempt));
```

```js
// CommonJS
const { withRetry } = require("@dipanshuhandoo/mongodock");
```

## Next steps

- [Retry guide](retry.md) for backoff, cancellation and hooks
- [Configuration](configuration.md) for every option and default
- [Errors and messages](errors-and-messages.md)
