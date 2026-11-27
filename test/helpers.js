import { createWorld } from '../src/world.js';

/** A small city (about a sixth of the default) so tests stay quick. */
export const small = (opts = {}) => createWorld({ seed: 7, cols: 16, rows: 12, ...opts });

let shared = null;
/** One small world shared by tests that only read. */
export const sharedSmall = () => (shared ??= small());
