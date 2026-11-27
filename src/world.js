// The world: a city, its census, and the questions a game would ask of them.
//
//   const w = createWorld({ seed: 1 });
//   w.whereIs(id, t)            where is this person at game minute t
//   w.plan(id, day)             his whole day
//   w.near(x, y, r, t)          who is on the street within r metres of a point
//
// Time is game minutes since midnight on day 0, a Monday.

import { generateCity } from './city.js';
import { createRouter, MODE, MODE_NAMES } from './routing.js';
import { generateCensus, ARCH_NAMES } from './census.js';
import { createPlanner, newPlan, ACT, ACT_NAMES, MAX_STOPS, DAY } from './plans.js';
import { createDayIndex } from './presence.js';
import { describeState } from './state.js';
import { hash2, unit } from './rng.js';

export { ACT, ACT_NAMES, DAY, MODE, MODE_NAMES, ARCH_NAMES };

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const KIND_LABEL = { house: 'house', apartment: 'flats', tower: 'tower', cityhall: 'City Hall' };

export const clock = (m) => {
  const mm = Math.floor(((m % DAY) + DAY) % DAY);
  return `${String(Math.floor(mm / 60)).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`;
};
export const dayOf = (t) => Math.floor(t / DAY);
/** "day 6 (Sun) 08:30". Days are counted from 0. */
export const stamp = (t) => `day ${dayOf(t)} (${DAY_NAMES[((dayOf(t) % 7) + 7) % 7]}) ${clock(t)}`;

export function createWorld(opts = {}) {
  const o = { seed: 1, cols: 40, rows: 30, ...opts };
  const city = generateCity(o);
  const router = createRouter(city);
  const census = generateCensus(city, o);
  const B = city.buildings;

  const w = {
    seed: o.seed, opts: o, city, router, census,
    t: 6 * 60,
    /** People something has happened to: id -> state record (see state.js). */
    people: new Map(),
    /** Fear per district as it stood at dawn; plans for the day are built against it. */
    fearAtDawn: new Float32Array(city.districts.length),
  };
  w.nightFactor = (district) => 1 - 0.8 * w.fearAtDawn[district];
  const planner = createPlanner(w);

  // --- where things are --------------------------------------------------------------------
  /** A stop is "in the open" if people there can be seen: a park, a beach, a street corner. */
  w.inTheOpen = (place, kind) => B[place].outdoor || kind === ACT.HANG || kind === ACT.STREET;

  /** Where exactly a person stands when he is in the open at a place. */
  w.spot = (place, id, out) => {
    const b = B[place], u = unit(hash2(id, place)), v = unit(hash2(place, id));
    if (b.outdoor) {
      const p = b.poly, iu = 0.08 + u * 0.84, iv = 0.08 + v * 0.84;
      const tx = p[0] + (p[2] - p[0]) * iu, ty = p[1] + (p[3] - p[1]) * iu;
      const bx = p[6] + (p[4] - p[6]) * iu, by = p[7] + (p[5] - p[7]) * iu;
      out.x = tx + (bx - tx) * iv; out.y = ty + (by - ty) * iv;
    } else {
      // on the pavement by the door, a few metres either way along the kerb
      const e = b.edge, a = city.edges.a[e], c = city.edges.b[e], len = city.edges.len[e] || 1;
      const k = (u - 0.5) * 14;
      out.x = b.streetX + (b.doorX - b.streetX) * 0.6 + ((city.nodes.x[c] - city.nodes.x[a]) / len) * k;
      out.y = b.streetY + (b.doorY - b.streetY) * 0.6 + ((city.nodes.y[c] - city.nodes.y[a]) / len) * k;
    }
    return out;
  };

  // Read a plan (the scratch plan, or a row of a day table) at minute m of its day.
  function locate(P, o, n, id, m, out) {
    out.id = id; out.minute = m;
    out.mode = 0; out.from = out.to = -1; out.frac = 0;
    if (n === 0) {
      out.state = 'gone'; out.outside = false; out.place = -1; out.kind = -1; out.stop = -1;
      out.x = out.y = NaN;
      return out;
    }
    let i = 0;
    while (i + 1 < n && P.arrive[o + i + 1] <= m) i++;
    out.stop = i;
    if (i === n - 1 || m < P.depart[o + i]) {
      const place = P.place[o + i], kind = P.kind[o + i];
      out.state = 'at'; out.place = place; out.kind = kind;
      out.outside = w.inTheOpen(place, kind);
      if (out.outside) w.spot(place, id, out);
      else { out.x = B[place].doorX; out.y = B[place].doorY; }
      return out;
    }
    const from = P.place[o + i], to = P.place[o + i + 1], mode = P.mode[o + i];
    const dep = P.depart[o + i], arr = P.arrive[o + i + 1];
    out.state = 'travel'; out.outside = true;
    out.from = from; out.to = to; out.place = to; out.kind = P.kind[o + i + 1]; out.mode = mode;
    out.frac = (m - dep) / (arr - dep);
    router.along(router.path(from, to), out.frac, mode === MODE.WALK ? (id & 1 ? 5.5 : -5.5) : 2.4, out);
    return out;
  }
  w.locateIn = (table, id, m, out) => locate(table, id * MAX_STOPS, table.count[id], id, m, out);

  // --- day tables: everyone's plan for a day, built when first asked for ---------------------
  const tables = new Map();
  function fillRow(T, id) {
    const P = planner.build(id, T.day), o = id * MAX_STOPS;
    T.count[id] = P.n;
    for (let i = 0; i < P.n; i++) {
      T.place[o + i] = P.place[i]; T.kind[o + i] = P.kind[i];
      T.arrive[o + i] = P.arrive[i]; T.depart[o + i] = P.depart[i]; T.mode[o + i] = P.mode[i];
    }
  }
  w.table = (day) => {
    let T = tables.get(day);
    if (T) return T;
    const n = census.n;
    T = {
      day, count: new Uint8Array(n), place: new Int32Array(n * MAX_STOPS), kind: new Uint8Array(n * MAX_STOPS),
      arrive: new Float32Array(n * MAX_STOPS), depart: new Float32Array(n * MAX_STOPS), mode: new Uint8Array(n * MAX_STOPS),
      dirty: new Set(), index: null,
    };
    for (let id = 0; id < n; id++) fillRow(T, id);
    if (tables.size >= 2) tables.delete(tables.keys().next().value);
    tables.set(day, T);
    return T;
  };
  w.index = (day) => {
    const T = w.table(day);
    if (T.index && T.dirty.size > 2000) { T.index = null; T.dirty.clear(); }
    return (T.index ??= createDayIndex(w, T));
  };
  /** A person's state changed: rebuild his plan wherever it is cached. */
  w.touch = (id) => {
    for (const T of tables.values()) {
      if (T.day < dayOf(w.t)) continue;
      fillRow(T, id);
      T.dirty.add(id);
    }
  };
  /** Forget cached plans (after a load, or when the mood plans were built against has moved). */
  w.forgetPlans = () => tables.clear();

  // --- the questions --------------------------------------------------------------------------
  const scratch = newPlan();
  /** Where is this person at game minute t? */
  w.whereIs = (id, t = w.t, out = {}) => {
    const day = dayOf(t), T = tables.get(day);
    if (T) return w.locateIn(T, id, t - day * DAY, out);
    const P = planner.build(id, day);
    return locate(P, 0, P.n, id, t - day * DAY, out);
  };
  /** A person's whole day: [{ place, kind, arrive, depart, mode }]. */
  w.plan = (id, day = dayOf(w.t)) => planner.plan(id, day);
  /** Ids of people on the street or in the open within r metres of a point at time t. */
  w.near = (x, y, r, t = w.t, fn) => w.index(dayOf(t)).near(x, y, r, t - dayOf(t) * DAY, fn);
  /** Call fn(id, where) for everyone on the street or in the open at time t. */
  w.outside = (t, fn) => w.index(dayOf(t)).forEachOutside(t - dayOf(t) * DAY, fn);
  /** People inside a building at time t (not in the open in front of it). */
  w.inside = (b, t = w.t) => {
    const out = [], p = {};
    const seen = new Set();
    for (const list of [census.staffOf(b), census.lodgersOf(b)]) {
      for (const id of list) {
        if (seen.has(id)) continue;
        seen.add(id);
        w.whereIs(id, t, p);
        if (p.state === 'at' && p.place === b && !p.outside) out.push(id);
      }
    }
    return out;
  };

  // --- words -----------------------------------------------------------------------------------
  w.placeName = (b) => {
    if (b < 0) return 'nowhere';
    const p = B[b];
    if (p.name) return p.name;
    return `${p.address}${KIND_LABEL[p.kind] && p.kind !== 'house' ? ` (${KIND_LABEL[p.kind]})` : p.kind === 'house' ? '' : ` (${p.kind})`}`;
  };
  w.homeOf = (id) => { const ps = w.people.get(id); return ps && ps.home >= 0 ? ps.home : census.home[id]; };
  w.archOf = (id) => { const ps = w.people.get(id); return ps && ps.arch >= 0 ? ps.arch : census.arch[id]; };
  w.isGone = (id) => { const ps = w.people.get(id); return !!ps && (ps.flags & 9) !== 0; };

  /** One line on what someone is doing: "walking to First Meridian Bank (at work)". */
  w.describeWhere = (p) => {
    if (p.state === 'gone') return 'gone';
    if (p.state === 'travel') return `${MODE_NAMES[p.mode]} from ${w.placeName(p.from)} to ${w.placeName(p.to)}`;
    return `${ACT_NAMES[p.kind]}, ${p.outside ? 'outside ' : ''}${w.placeName(p.place)}`;
  };

  /** Everything known about a person, as plain data for a debug panel. */
  w.person = (id, t = w.t) => {
    const ps = w.people.get(id), c = census;
    return {
      id, name: c.name(id), age: c.age[id], sex: c.sex[id] ? 'f' : 'm',
      visitor: c.isVisitor(id), archetype: ARCH_NAMES[w.archOf(id)],
      role: c.work[id] >= 0 ? c.roleName(id) : null,
      home: w.homeOf(id), homeName: w.placeName(w.homeOf(id)), district: city.districts[B[c.home[id]].district].name,
      work: c.work[id], workName: c.work[id] >= 0 ? w.placeName(c.work[id]) : null,
      shift: c.work[id] >= 0 ? `${clock(c.shiftStart[id])} to ${clock(c.shiftStart[id] + c.shiftLen[id])}` : null,
      car: !!c.car[id], traits: ['brave', 'nervous', 'sociable', 'arms himself when afraid'].filter((_, i) => c.traits[id] & (1 << i)),
      relatives: c.relatives(id).map((r) => ({ ...r, name: c.name(r.id), gone: w.isGone(r.id) })),
      state: describeState(ps, t),
    };
  };

  /** A day as readable lines. */
  w.describeDay = (id, day = dayOf(w.t)) => {
    const plan = w.plan(id, day), lines = [];
    plan.forEach((s, i) => {
      lines.push(`${clock(s.arrive)}-${clock(s.depart === DAY ? DAY - 1 : s.depart)}  ${ACT_NAMES[s.kind]}, ${w.placeName(s.place)}`);
      if (i < plan.length - 1) {
        const metres = router.distance(s.place, plan[i + 1].place);
        lines.push(`        ${MODE_NAMES[s.mode]} ${Math.round(plan[i + 1].arrive - s.depart)} min, ${Math.round(metres)} m`);
      }
    });
    return lines;
  };

  return w;
}
