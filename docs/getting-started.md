# Getting started

The package is under development. Phase 1 exposes configuration normalization
and errors, not a database service. Registry publication is not implied.

From a checkout, install dependencies with `npm ci`, then build with
`npm run build`. `npm run test:package` installs a real tarball into an isolated
consumer and exercises ESM, CommonJS, TypeScript, and offline examples.

```js
import { normalizeConfig } from "@dipanshuhandoo/mongodock";

const config = normalizeConfig({
  connections: {
    primary: { uri: "mongodb://localhost:27017/primary" },
    reporting: { uri: "mongodb://localhost:27017/reporting" },
  },
  defaultConnection: "primary",
});
```

No network operation occurs. Factory/model lifecycle arrives in Phase 2; see
[Configuration](configuration.md) and [Testing](testing.md) for today's APIs.
