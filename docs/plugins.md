# Plugins

A plugin is `{ name, hooks }`. Names must be unique; hook names and values are validated and the
registration is frozen when the service is created.

```js
import { createMongoService } from "@dipanshuhandoo/mongodock";

const tracing = {
  name: "tracing",
  hooks: {
    beforeOperation: (input, context) => {
      context.metadata; // frozen, per-operation
    },
    onHookError: ({ error, hookName, scope }) => console.error(scope, hookName, error),
  },
};

const db = createMongoService({ uri: process.env.MONGODB_URI, plugins: [tracing] });
```

Plugins run before service hooks and call hooks. Failure scopes are reported as
`plugin:<name>`, `service` or `call`. A plugin `beforeRetry` activates the default retry profile
for eligible reads (see [retries](./retries.md)). Plugins cannot be added after creation.
