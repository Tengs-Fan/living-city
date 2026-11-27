// Presence: who is on the street right now.
//
// DayIndex answers "who is travelling through, or standing in the open, near this point at
// this minute" without looking at everyone. It files each leg of each plan under the
// five-minute buckets it overlaps, and, for a bucket somebody asks about, under the map cells
// the leg passes through during those five minutes.
//
// Presence is the A-Life split on top of that: people within the ring round the player are
// "online"; everyone else is a record and a plan.

import { MAX_STOPS, DAY, ACT } from './plans.js';

const BUCKET = 5, NB = DAY / BUCKET, CELL = 64;

export function createDayIndex(w, table) {
  const { city, router } = w;
  const n = table.count.length;
  const { minX, minY, maxX, maxY } = city.bounds;
  const cw = Math.ceil((maxX - minX) / CELL) + 1, ch = Math.ceil((maxY - minY) / CELL) + 1;

  // An entry is a person and one of his stops: either the stay at the stop (if it is in the
  // open) or the leg that leaves it.
  const STAY = 1;
  const enc = (id, stop, stay) => id * 16 + stop * 2 + stay;
  const start = new Uint32Array(NB + 1);
  const visit = (fn) => {
    for (let id = 0; id < n; id++) {
      const c = table.count[id], o = id * MAX_STOPS;
      for (let i = 0; i < c; i++) {
        if (w.inTheOpen(table.place[o + i], table.kind[o + i])) fn(enc(id, i, STAY), table.arrive[o + i], table.depart[o + i]);
        if (i < c - 1) fn(enc(id, i, 0), table.depart[o + i], table.arrive[o + i + 1]);
      }
    }
  };
  const span = (t0, t1, fn) => {
    const b1 = Math.min(NB - 1, Math.floor((t1 - 1e-3) / BUCKET));
    for (let b = Math.max(0, Math.floor(t0 / BUCKET)); b <= b1; b++) fn(b);
  };
  visit((e, t0, t1) => span(t0, t1, (b) => start[b + 1]++));
  for (let b = 0; b < NB; b++) start[b + 1] += start[b];
  const items = new Uint32Array(start[NB]);
  const pos = start.slice(0, NB);
  visit((e, t0, t1) => span(t0, t1, (b) => { items[pos[b]++] = e; }));

  const cellOf = (x, y) => Math.min(ch - 1, Math.max(0, Math.floor((y - minY) / CELL))) * cw + Math.min(cw - 1, Math.max(0, Math.floor((x - minX) / CELL)));
  const cells = new Map(); // bucket -> { start, items }
  const pt = { x: 0, y: 0 };

  function cellsFor(b) {
    let c = cells.get(b);
    if (c) return c;
    const pairs = []; // cell, entry
    const t0 = b * BUCKET, t1 = t0 + BUCKET;
    for (let k = start[b]; k < start[b + 1]; k++) {
      const e = items[k], id = Math.floor(e / 16), stop = (e >> 1) & 7, o = id * MAX_STOPS + stop;
      if (e & STAY) {
        w.spot(table.place[o], id, pt);
        pairs.push(cellOf(pt.x, pt.y), e);
        continue;
      }
      const dep = table.depart[o], arr = table.arrive[o + 1];
      const p = router.path(table.place[o], table.place[o + 1]);
      const f0 = Math.max(0, (t0 - dep) / (arr - dep)), f1 = Math.min(1, (t1 - dep) / (arr - dep));
      const steps = Math.max(1, Math.ceil(((f1 - f0) * p.len) / (CELL / 2)));
      let prev = -1;
      for (let s = 0; s <= steps; s++) {
        router.along(p, f0 + ((f1 - f0) * s) / steps, 0, pt);
        const cell = cellOf(pt.x, pt.y);
        if (cell !== prev) { pairs.push(cell, e); prev = cell; }
      }
    }
    const cs = new Uint32Array(cw * ch + 1);
    for (let k = 0; k < pairs.length; k += 2) cs[pairs[k] + 1]++;
    for (let k = 0; k < cw * ch; k++) cs[k + 1] += cs[k];
    const ci = new Uint32Array(pairs.length / 2), cp = cs.slice(0, cw * ch);
    for (let k = 0; k < pairs.length; k += 2) ci[cp[pairs[k]]++] = pairs[k + 1];
    c = { start: cs, items: ci };
    if (cells.size > 24) cells.delete(cells.keys().next().value);
    cells.set(b, c);
    return c;
  }

  const where = {};
  const stamp = new Uint32Array(n);
  let stampNow = 0;

  /** Call fn(id, where) for everyone on the street or in the open at minute `m` of the day. */
  function forEachOutside(m, fn) {
    const b = Math.min(NB - 1, Math.max(0, Math.floor(m / BUCKET)));
    for (let k = start[b]; k < start[b + 1]; k++) {
      const e = items[k], id = Math.floor(e / 16), stop = (e >> 1) & 7, o = id * MAX_STOPS + stop;
      if (e & STAY ? m >= table.arrive[o] && m < table.depart[o] : m >= table.depart[o] && m < table.arrive[o + 1]) {
        fn(id, w.locateIn(table, id, m, where));
      }
    }
  }

  /**
   * People outside within `r` metres of a point at minute `m`. Returns ids; the callback, if
   * given, also gets each person's position.
   */
  function near(x, y, r, m, fn) {
    const b = Math.min(NB - 1, Math.max(0, Math.floor(m / BUCKET)));
    const c = cellsFor(b), out = [];
    const pad = r + 8; // people walk up to a pavement's width off the centre line
    const x0 = Math.max(0, Math.floor((x - pad - minX) / CELL)), x1 = Math.min(cw - 1, Math.floor((x + pad - minX) / CELL));
    const y0 = Math.max(0, Math.floor((y - pad - minY) / CELL)), y1 = Math.min(ch - 1, Math.floor((y + pad - minY) / CELL));
    if (++stampNow === 0xffffffff) { stamp.fill(0); stampNow = 1; }
    const test = (id) => {
      if (stamp[id] === stampNow) return;
      stamp[id] = stampNow;
      const p = w.locateIn(table, id, m, where);
      if (p.outside && (p.x - x) ** 2 + (p.y - y) ** 2 <= r * r) {
        out.push(id);
        if (fn) fn(id, p);
      }
    };
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const cell = cy * cw + cx;
        for (let k = c.start[cell]; k < c.start[cell + 1]; k++) test(Math.floor(c.items[k] / 16));
      }
    }
    // people whose plan changed since the index was built are checked one by one
    for (const id of table.dirty) test(id);
    return out;
  }

  return { forEachOutside, near, entries: items.length };
}

/**
 * The ring round the player. Call update() as the player moves and time passes; it reports
 * who came online and who went offline, and why.
 */
export function createPresence(w, { radius = 150, slack = 25 } = {}) {
  const online = new Map(); // id -> { id, since, x, y, kind, state }
  const where = {};

  function update(px, py, t) {
    const spawned = [], despawned = [];
    for (const [id, rec] of online) {
      const p = w.whereIs(id, t, where);
      let why = null;
      if (p.state === 'gone') why = 'gone';
      else if (!p.outside) why = `went into ${w.placeName(p.place)}`;
      else if ((p.x - px) ** 2 + (p.y - py) ** 2 > (radius + slack) ** 2) why = 'out of range';
      if (why) { online.delete(id); despawned.push({ id, why, place: p.place }); }
      else { rec.x = p.x; rec.y = p.y; rec.state = p.state; rec.kind = p.kind; rec.mode = p.mode; rec.to = p.to; rec.place = p.place; }
    }
    w.near(px, py, radius, t, (id, p) => {
      if (online.has(id)) return;
      const rec = { id, since: t, x: p.x, y: p.y, state: p.state, kind: p.kind, mode: p.mode, to: p.to, place: p.place };
      online.set(id, rec);
      spawned.push(rec);
    });
    return { spawned, despawned };
  }

  return { online, update, radius };
}

export { ACT };
