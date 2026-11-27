import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/world.js';
import { ARCH, ROLE_GUARD } from '../src/census.js';
import { sharedSmall, small } from './helpers.js';

test('the same seed gives the same city of people; another seed gives another', () => {
  const a = small(), b = small(), c = small({ seed: 8 });
  assert.equal(a.census.n, b.census.n);
  for (const key of ['home', 'work', 'age', 'first', 'last', 'partner', 'parentA', 'shiftStart']) {
    assert.deepEqual(a.census[key], b.census[key], key);
  }
  assert.deepEqual(a.plan(123, 4), b.plan(123, 4));
  assert.notDeepEqual([...a.census.age.slice(0, 200)], [...c.census.age.slice(0, 200)]);
});

test('a GTA 5-scale city houses a GTA 5-scale population', () => {
  const w = createWorld({ seed: 1 });
  const c = w.census;
  assert.ok(c.residents > 35000 && c.residents < 75000, `residents ${c.residents}`);
  assert.ok(c.commuters > 5000, `commuters ${c.commuters}`);
  assert.ok(c.tourists > 500, `tourists ${c.tourists}`);
  // every bank has guards, and they are people with homes in the city
  for (const b of w.city.byKind.bank) {
    const guards = [...c.staffOf(b)].filter((id) => c.role[id] === ROLE_GUARD);
    assert.ok(guards.length >= 2, `${w.placeName(b)} has ${guards.length} guards`);
  }
});

test('everyone has somewhere to live and workers somewhere to work', () => {
  const { census: c, city } = sharedSmall();
  for (let id = 0; id < c.n; id++) {
    const home = city.buildings[c.home[id]];
    assert.ok(home, `person ${id} has a home`);
    if (id < c.residents) assert.ok(home.homes > 0, `resident ${id} lives in a home`);
    if (c.arch[id] === ARCH.WORKER || c.arch[id] === ARCH.COMMUTER) {
      assert.ok(city.buildings[c.work[id]].jobs > 0, `worker ${id} has a workplace`);
      assert.ok(c.shiftLen[id] > 0);
    }
    if (c.arch[id] === ARCH.COMMUTER) assert.ok(home.gateway, 'a commuter lives off the map');
  }
  // no workplace is over-staffed
  for (const b of city.buildings) assert.ok(c.staffOf(b.id).length <= b.jobs, `${b.kind} ${b.id}`);
});

test('family ties run both ways and make sense', () => {
  const { census: c } = sharedSmall();
  const inverse = { mother: ['son', 'daughter'], father: ['son', 'daughter'], son: ['mother', 'father'], daughter: ['mother', 'father'],
    wife: ['husband', 'wife'], husband: ['wife', 'husband'], brother: ['brother', 'sister'], sister: ['brother', 'sister'] };
  let ties = 0, apart = 0;
  for (let id = 0; id < c.residents; id++) {
    for (const r of c.relatives(id)) {
      if (!inverse[r.rel]) continue;
      ties++;
      const back = c.relatives(r.id).find((x) => x.id === id);
      assert.ok(back && inverse[r.rel].includes(back.rel), `${id} says ${r.rel} of ${r.id}; back: ${back?.rel}`);
      if (r.rel === 'mother' || r.rel === 'father') {
        assert.ok(c.age[r.id] - c.age[id] >= 17, `parent ${c.age[r.id]} of child ${c.age[id]}`);
        if (c.hh[r.id] !== c.hh[id]) apart++;
      }
    }
  }
  assert.ok(ties > 1000);
  assert.ok(apart > 100, 'some grown children live apart from their parents');
});
