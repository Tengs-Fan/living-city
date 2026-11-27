// Deterministic randomness. Two kinds:
//  - makeRng(seed): a sequential generator, used once, by the city and census generators;
//  - hashN(...): stateless hashes, used wherever an answer must be a pure function of its
//    inputs (a person's plan for a day, a place he prefers, the outcome of an event).

export function mix32(h) {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

const step = (h, k) => mix32((h ^ Math.imul(k | 0, 0x9e3779b1)) + 0x7f4a7c15);

export const hash2 = (a, b) => step(step(0x811c9dc5, a), b);
export const hash3 = (a, b, c) => step(hash2(a, b), c);
export const hash4 = (a, b, c, d) => step(hash3(a, b, c), d);

/** Map a 32-bit hash to [0, 1). */
export const unit = (h) => h / 4294967296;

/** A number for a string, for use as a salt. */
export function salt(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** Sequential generator (mulberry32) with a few helpers. */
export function makeRng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.int = (n) => Math.floor(next() * n);
  next.range = (a, b) => a + next() * (b - a);
  next.irange = (a, b) => a + Math.floor(next() * (b - a + 1));
  next.chance = (p) => next() < p;
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  /** Index drawn in proportion to the weights. */
  next.weighted = (weights) => {
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += weights[i];
    let r = next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r < 0) return i;
    }
    return weights.length - 1;
  };
  return next;
}
