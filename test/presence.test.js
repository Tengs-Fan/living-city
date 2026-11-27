import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY } from '../src/world.js';
import { createPresence } from '../src/presence.js';
import { sharedSmall } from './helpers.js';

test('the corner query finds exactly the people who are there', () => {
  const w = sharedSmall(), p = {};
  const { minX, minY, maxX, maxY } = w.city.bounds;
  let found = 0;
  for (let k = 0; k < 40; k++) {
    const x = minX + ((k * 0.37) % 1) * (maxX - minX), y = minY + ((k * 0.61) % 1) * (maxY - minY);
    const t = DAY + 400 + k * 23, r = 60 + (k % 4) * 50;
    const got = w.near(x, y, r, t).sort((a, b) => a - b);
    const want = [];
    for (let id = 0; id < w.census.n; id++) {
      w.whereIs(id, t, p);
      if (p.outside && Math.hypot(p.x - x, p.y - y) <= r) want.push(id);
    }
    assert.deepEqual(got, want, `query ${k}`);
    found += got.length;
  }
  assert.ok(found > 50, `only ${found} people found in 40 queries`);
});

test('at 08:30 the street by a downtown office is full of people going to work', () => {
  const w = sharedSmall();
  const office = w.city.buildings.filter((b) => b.kind === 'office').sort((a, b) => b.jobs - a.jobs)[0];
  const morning = w.near(office.streetX, office.streetY, 150, DAY + 8.5 * 60);
  const night = w.near(office.streetX, office.streetY, 150, DAY + 3.5 * 60);
  assert.ok(morning.length >= 5, `${morning.length} people at 08:30`);
  assert.ok(night.length < morning.length / 2, `${night.length} people at 03:30`);
});

test('the ring: people come online near the player and go offline with a reason', () => {
  const w = sharedSmall();
  const office = w.city.buildings.filter((b) => b.kind === 'office').sort((a, b) => b.jobs - a.jobs)[0];
  const ring = createPresence(w);
  let spawned = 0, wentIn = 0;
  for (let m = 8 * 60; m < 9.5 * 60; m += 0.5) {
    const r = ring.update(office.streetX, office.streetY, DAY + m);
    spawned += r.spawned.length;
    for (const s of r.spawned) assert.ok(Math.hypot(s.x - office.streetX, s.y - office.streetY) <= ring.radius + 1e-3);
    wentIn += r.despawned.filter((d) => d.why.startsWith('went into')).length;
    for (const rec of ring.online.values()) assert.ok(Math.hypot(rec.x - office.streetX, rec.y - office.streetY) <= ring.radius + 25 + 1e-3);
  }
  assert.ok(spawned > 20, `${spawned} spawned`);
  assert.ok(wentIn > 5, `${wentIn} walked through a door`);
});

test('leave and come back: the same people are where their plans put them', () => {
  const w = sharedSmall();
  const park = w.city.buildings.find((b) => b.kind === 'park');
  const t = DAY + 11 * 60;
  const snapshot = () => {
    const out = [];
    w.near(park.cx, park.cy, 150, t, (id, p) => out.push([id, p.x, p.y]));
    return out.sort((a, b) => a[0] - b[0]);
  };
  const before = snapshot();
  w.near(park.cx + 900, park.cy, 150, t + 300); // the player wanders off
  w.forgetPlans(); // and everything cached is thrown away
  assert.deepEqual(snapshot(), before);
  assert.ok(before.length > 0);
});
