# Models

Models are registered per connection, so the same schema can back different
databases without sharing state.

```js
db.registerModel({ name: "Page", schema: pageSchema, collection: "pages" });
db.use("analytics").registerModels([{ name: "Event", schema: eventSchema }]);
const Page = db.getModel("Page");
```

- `registerModel(def)` / `registerModels(defs)`: `def` is `{ name, schema, collection?, options? }` or `{ model }`
  for an existing model compiled on that same connection.
- Re-registering the same schema (by identity), collection, and options returns the existing model;
  anything else throws `ModelRegistrationError`. Batches are validated first and rolled back if compilation fails.
- A name already compiled on the connection outside the registry is a conflict.
- `getModel(name)` throws if unknown; `hasModel`, `listModels`, `unregisterModel` (returns a boolean;
  removes only models the registry compiled; never touches database state).
- `options.overwriteModels` and `options.connection` are rejected.
- Registration never creates collections or indexes.
