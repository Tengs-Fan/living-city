// Scripted runs through the system, for the tests, the command line and the viewer.
// Nothing here is special-cased in the simulation: a scenario only chooses whom the player
// kills and when.

import { ARCH, ROLE_GUARD } from './census.js';
import { DAY } from './plans.js';

/**
 * Find someone whose death would put a parent on the street: a day-shift worker who is the
 * only earner in a home he shares with one parent of 45 or more who has no other family in
 * the city to take them in. Bank guards are looked at first.
 */
export function findStory(w, { from = 0 } = {}) {
  const { census: c, city } = w;
  const fits = (id) => {
    if (id < from || id >= c.residents || c.arch[id] !== ARCH.WORKER || w.isGone(id)) return null;
    if (c.shiftStart[id] + c.shiftLen[id] > DAY || c.shiftStart[id] > 600) return null;
    const dependants = w.rules.dependants(id);
    if (dependants.length !== 1) return null;
    const parent = dependants[0];
    if (c.age[parent] < 45 || (c.parentA[id] !== parent && c.parentB[id] !== parent)) return null;
    if (c.relatives(parent).some((r) => r.id !== id && r.closeness >= 0.7 && w.alive(r.id))) return null;
    return { victim: id, parent, work: c.work[id] };
  };
  for (const b of city.byKind.bank ?? []) {
    for (const id of c.staffOf(b)) if (c.role[id] === ROLE_GUARD && fits(id)) return fits(id);
  }
  for (let id = 0; id < c.residents; id++) if (c.role[id] === ROLE_GUARD && fits(id)) return fits(id);
  for (let id = 0; id < c.residents; id++) if (fits(id)) return fits(id);
  return null;
}

/**
 * The robbery: skip to the first morning on or after `day` that the victim is at work, then
 * the player kills him and holds the place up. Hour 5 of play is game day 6.
 */
export function robbery(w, story, { day = 6, mission = 'robbery' } = {}) {
  const { census: c } = w;
  let d = Math.max(day, Math.ceil(w.t / DAY));
  while (!c.rostered(story.victim, d)) d++;
  const at = d * DAY + c.shiftStart[story.victim] + 100;
  w.advance(at - w.t, { player: false });
  const b = w.city.buildings[story.work];
  Object.assign(w.player, { x: b.doorX, y: b.doorY, busy: true });
  const kill = w.act.kill(story.victim, { mission });
  const rob = w.act.robPlace(story.work, { mission });
  w.player.busy = false;
  return { kill, rob };
}

/** Put the player beside someone, if he is out where he can be met. */
export function walkUpTo(w, id) {
  const p = w.whereIs(id, w.t);
  if (!p.outside) return false;
  w.player.x = p.x + 3;
  w.player.y = p.y + 3;
  return true;
}
