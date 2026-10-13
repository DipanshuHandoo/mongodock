/**
 * @typedef {"idle" | "opening" | "open" | "closing" | "closed" | "failed"} Phase
 */

/**
 * Service-level phases combine with the live Mongoose readyState: an open service
 * phase is only ready while the driver reports connected.
 * @param {Phase} phase
 * @param {number} readyState
 * @returns {import("../types.js").ConnectionStatus["state"]}
 */
export function computeState(phase, readyState) {
  if (phase === "opening") return "connecting";
  if (phase !== "open") return phase;
  if (readyState === 1) return "ready";
  return readyState === 3 ? "closing" : "connecting";
}

/**
 * @param {{ name: string, phase: Phase, readyState: number, owned: boolean, error?: import("../types.js").ConnectionStatus["error"] }} input
 * @returns {Readonly<import("../types.js").ConnectionStatus>}
 */
export function createStatus({ name, phase, readyState, owned, error }) {
  return Object.freeze({
    name,
    state: computeState(phase, readyState),
    readyState,
    owned,
    ...(error ? { error } : {}),
  });
}
