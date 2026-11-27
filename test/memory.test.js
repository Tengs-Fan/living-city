import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY, ACT, loadWorld } from '../src/world.js';
import { FLAG } from '../src/state.js';
import { small } from './helpers.js';

/** Somebody walking in the street at time t, preferably with company. */
function someoneOutside(w, t, skip = new Set()) {
  let best = -1, bestN = -1;
  let seen = 0;
  w.outside(t, (id, p) => {
    if (skip.has(id) || w.isGone(id) || seen > 400) return;
    seen++;
    const n = w.near(p.x, p.y, 40, t).length;
    if (n > bestN) { bestN = n; best = id; }
  });
  return best;
}

test('a killing is recorded with its place, its witnesses and what follows', () => {
  const w = small();
  w.advance(DAY + 8.5 * 60 - w.t, { player: false });
  const victim = someoneOutside(w, w.t);
  const ev = w.act.kill(victim);
  assert.equal(ev.type, 'kill');
  assert.ok(ev.witnesses.length > 0, 'someone saw it');
  assert.ok(!ev.witnesses.includes(victim));
  assert.equal(w.whereIs(victim).state, 'gone');
  assert.equal(w.act.kill(victim), null, 'he cannot be killed twice');
  assert.ok(!w.near(ev.x, ev.y, 40).includes(victim), 'the dead are not on the street');
  for (const id of ev.witnesses) {
    const ps = w.people.get(id);
    assert.ok(ps.fearUntil > w.t && ps.flags & FLAG.KNOWS && ps.knows.includes(ev.id));
  }
  assert.ok(w.mood.fear[ev.district] > 0 && w.mood.kills[ev.district] === 1);
  // a frightened witness stays in after dark
  const scared = ev.witnesses[0];
  for (let d = 2; d < 9; d++) {
    for (const s of w.plan(scared, d)) assert.ok(!(s.arrive >= 1150 && [ACT.DRINK, ACT.EAT, ACT.LEISURE].includes(s.kind)), 'out at night while afraid');
  }
});

test('relatives hear of a death within a day and grieve', () => {
  const w = small(), c = w.census;
  let victim = -1;
  for (let id = 0; id < c.residents && victim < 0; id++) if (c.partner[id] >= 0 && c.childrenOf(id).length && c.work[id] >= 0) victim = id;
  w.advance(DAY, { player: false });
  const ev = w.act.kill(victim);
  w.advance(DAY + 60, { player: false });
  for (const r of c.relatives(victim)) {
    const ps = w.people.get(r.id);
    assert.ok(ps && ps.mourns.includes(victim), `${r.rel} mourns`);
    assert.ok(ps.griefUntil > w.t, `${r.rel} grieves`);
  }
  const widow = c.partner[victim];
  if (c.work[widow] >= 0) {
    for (let d = 3; d < 8; d++) assert.ok(!w.plan(widow, d).some((s) => s.kind === ACT.WORK), 'off work in the first week');
  }
  // grief wears off
  w.advance(60 * DAY, { player: false });
  assert.ok(w.people.get(widow).griefUntil <= w.t);
  assert.ok(ev.id === 0);
});

test('a district grows afraid, empties at night, and recovers', () => {
  const w = small(), calm = small(), c = w.census;
  const B = w.city.buildings;
  w.advance(DAY + 12 * 60 - w.t, { player: false });
  // thirty killings in the busiest residential district in one afternoon
  const homes = new Map();
  for (let id = 0; id < c.residents; id++) homes.set(B[c.home[id]].district, (homes.get(B[c.home[id]].district) ?? 0) + 1);
  const d = [...homes].sort((a, b) => b[1] - a[1])[0][0];
  let killed = 0;
  for (let id = 0; id < c.residents && killed < 30; id += 3) {
    if (B[c.home[id]].district !== d) continue;
    const ev = w.act.kill(id);
    if (ev && ev.district === d) killed++;
  }
  assert.ok(killed >= 20, `${killed} killings landed in the district`);
  const hot = w.districtReport(d);
  assert.ok(hot.fear > 0.5, `fear ${hot.fear}`);
  assert.ok(hot.effects.armedShare > 0.25 && hot.effects.nightLife < 0.6 && hot.effects.shopsShutEarly);

  const nightsOut = (world, day) => {
    let n = 0;
    for (let id = 0; id < c.residents; id++) {
      if (B[c.home[id]].district !== d || world.isGone(id)) continue;
      for (let k = 0; k < 5; k++) if (world.plan(id, day + k).some((s) => s.arrive >= 1130 && s.kind !== ACT.HOME && s.kind !== ACT.WORK)) n++;
    }
    return n;
  };
  w.advance(DAY, { player: false });
  calm.advance(w.t - calm.t, { player: false });
  const day = Math.floor(w.t / DAY);
  const scared = nightsOut(w, day), normal = nightsOut(calm, day);
  assert.ok(normal > 30, `normally ${normal} evenings out`);
  assert.ok(scared < normal * 0.6, `${scared} evenings out against ${normal}`);
  // policing follows violence a few days behind
  w.advance(5 * DAY, { player: false });
  assert.ok(w.districtReport(d).policing > 0.2);

  w.advance(120 * DAY, { player: false });
  calm.advance(w.t - calm.t, { player: false });
  const later = w.districtReport(d);
  assert.ok(later.fear < 0.02 && later.effects.nightLife > 0.98, `fear ${later.fear} after four months`);
  const day2 = Math.floor(w.t / DAY);
  assert.ok(nightsOut(w, day2) > nightsOut(calm, day2) * 0.8, 'the evenings come back');
});

test('small crimes are forgotten; a stranger forgets a face', () => {
  const w = small();
  w.advance(DAY + 13 * 60 - w.t, { player: false });
  const done = new Set();
  for (let k = 0; k < 12; k++) {
    const id = someoneOutside(w, w.t, done);
    done.add(id);
    assert.ok(w.act.rob(id));
  }
  assert.equal(w.events.size, 12);
  assert.ok(w.people.size >= 12);
  w.advance(4 * DAY, { player: false });
  assert.equal(w.events.size, 0, 'muggings fold into the district counters');
  assert.equal(w.mood.robberies.reduce((a, b) => a + b), 12);
  w.advance(80 * DAY, { player: false });
  assert.equal(w.people.size, 0, 'nobody is still marked by a mugging months later');
});

test('a save holds only what play changed, and a loaded game carries on identically', () => {
  const w = small();
  const run = (world, from) => {
    for (let k = 0; k < 6; k++) {
      world.advance(DAY * 1.3, { player: false });
      const id = someoneOutside(world, world.t, new Set());
      if (id >= 0) (k % 2 ? world.act.kill : world.act.injure)(id);
      world.act.kill(from + k * 37);
    }
  };
  run(w, 100);
  const text = JSON.stringify(w.save());
  assert.ok(text.length < 200000, `save is ${text.length} bytes`);
  const copy = loadWorld(JSON.parse(text));
  assert.equal(JSON.stringify(copy.save()), text);
  for (let id = 0; id < w.census.n; id += 31) assert.deepEqual(copy.whereIs(id, w.t + 500), w.whereIs(id, w.t + 500));
  run(w, 2000); run(copy, 2000);
  w.advance(40 * DAY, { player: false }); copy.advance(40 * DAY, { player: false });
  assert.equal(JSON.stringify(copy.save()), JSON.stringify(w.save()));
});
