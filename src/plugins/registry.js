/**
 * Ordered hook resolution: configured plugins, then service hooks, then per-call hooks.
 * Registrations were snapshotted and frozen by normalizeConfig; nothing can be added later.
 * @param {import("../types.js").NormalizedConfig} config
 */
export function createPluginChain(config) {
  const sources = Object.freeze([
    ...config.plugins.map((plugin) => ({ scope: `plugin:${plugin.name}`, hooks: plugin.hooks })),
    { scope: "service", hooks: config.hooks },
  ]);
  return Object.freeze({
    /**
     * @param {string} hookName
     * @param {Readonly<Record<string, unknown>>} callHooks
     * @returns {Array<{scope: string, fn: Function}>}
     */
    entries(hookName, callHooks) {
      return [...sources, { scope: "call", hooks: callHooks }].flatMap(({ scope, hooks }) => {
        const fn = /** @type {Record<string, unknown>} */ (hooks)[hookName];
        return typeof fn === "function" ? [{ scope, fn: /** @type {Function} */ (fn) }] : [];
      });
    },
  });
}
