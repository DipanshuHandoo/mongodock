import pkg = require("@dipanshuhandoo/mongodock");

const input: pkg.MongoServiceConfig = { uri: "mongodb://localhost/test" };
const config: pkg.NormalizedConfig = pkg.normalizeConfig(input);
const hooks: pkg.Hooks = { beforeRetry: () => false };
const error = new pkg.ConfigurationError("Invalid input");
if (pkg.isMongoDockError(error)) {
  const code: pkg.ErrorCode = error.code;
  void code;
}
void config;
void hooks;
const service: pkg.MongoService = pkg.createMongoService({ uri: "mongodb://localhost/test" });
const status: pkg.ConnectionStatus = service.getStatus();
void status;
