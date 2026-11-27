import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY, ACT } from '../src/world.js';
import { ARCH } from '../src/census.js';
import { sharedSmall } from './helpers.js';

test('every day of every person hangs together', () => {
  const w = sharedSmall();
  const n = w.census.n;
  for (let day = 0; day < 9; day++) {
    for (let id = 0; id < n; id += day < 2 ? 1 : 7) {
      const plan = w.plan(id, day), what = `person ${id} day ${day}`;
      assert.ok(plan.length >= 1 && plan.length <= 8, what);
      assert.equal(plan[0].arrive, 0, what);
      assert.equal(plan.at(-1).depart, DAY, what);
      for (let i = 0; i < plan.length; i++) {
        assert.ok(plan[i].arrive <= plan[i].depart, `${what} stop ${i} leaves before arriving`);
        if (i === 0) continue;
        const leg = plan[i].arrive - plan[i - 1].depart;
        assert.notEqual(plan[i].place, plan[i - 1].place, `${what} travels to where he is`);
        assert.ok(leg > 0, `${what} leg ${i} takes no time`);
        // the complaint this project started from: nobody drives around for hours
        assert.ok(leg < 90, `${what} leg ${i} takes ${leg} minutes`);
        assert.ok(plan[i - 1].mode > 0, what);
      }
      // the day ends where the next one starts
      assert.equal(plan.at(-1).place, w.plan(id, day + 1)[0].place, `${what} does not end where tomorrow starts`);
    }
  }
});

test('people sleep at home unless they work nights', () => {
  const w = sharedSmall(), c = w.census;
  let nights = 0;
  for (let id = 0; id < c.n; id++) {
    const first = w.plan(id, 2)[0];
    if (first.place === c.home[id]) continue;
    nights++;
    assert.equal(first.kind, ACT.WORK, `person ${id} starts the day somewhere odd`);
    assert.ok(c.shiftStart[id] + c.shiftLen[id] > DAY, `person ${id} is at work at midnight on a day shift`);
  }
  assert.ok(nights > 20, 'some people work nights');
});

test('a worker on a working day goes to work and comes home', () => {
  const w = sharedSmall(), c = w.census;
  let checked = 0;
  for (let id = 0; id < c.residents && checked < 300; id++) {
    if (c.arch[id] !== ARCH.WORKER || !c.rostered(id, 1) || c.shiftStart[id] + c.shiftLen[id] > DAY) continue;
    const plan = w.plan(id, 1);
    const atWork = plan.filter((s) => s.kind === ACT.WORK && s.place === c.work[id]);
    assert.ok(atWork.length >= 1, `worker ${id} never reaches work`);
    assert.ok(Math.abs(atWork[0].arrive - c.shiftStart[id]) < 20, `worker ${id} arrives at ${atWork[0].arrive} for ${c.shiftStart[id]}`);
    assert.equal(plan.at(-1).place, c.home[id]);
    checked++;
  }
  assert.equal(checked, 300);
});

test('whereIs agrees with the plan and moves smoothly', () => {
  const w = sharedSmall();
  const p = {}, q = {};
  for (let id = 3; id < w.census.n; id += 211) {
    const plan = w.plan(id, 3);
    let prev = null;
    for (let m = 0; m < DAY; m += 1) {
      w.whereIs(id, 3 * DAY + m, p);
      const stop = plan[p.stop];
      if (p.state === 'at') {
        assert.ok(m >= stop.arrive - 1e-3 && (m < stop.depart || p.stop === plan.length - 1), `person ${id} minute ${m}`);
        assert.equal(p.place, stop.place);
      } else {
        assert.equal(p.state, 'travel');
        assert.ok(m >= stop.depart && m < plan[p.stop + 1].arrive);
        assert.ok(p.frac >= 0 && p.frac <= 1);
        assert.ok(p.outside);
        if (prev && prev.state === 'travel' && prev.stop === p.stop) {
          const moved = Math.hypot(p.x - prev.x, p.y - prev.y);
          assert.ok(moved < 560, `person ${id} jumps ${moved} m in a minute`);
        }
      }
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
      prev = { ...p };
    }
  }
  // the cached table and a plan built on the spot give the same answer
  w.table(5);
  for (let id = 0; id < w.census.n; id += 97) {
    w.whereIs(id, 5 * DAY + 700, p);
    w.forgetPlans();
    w.whereIs(id, 5 * DAY + 700, q);
    assert.deepEqual(p, q);
    w.table(5);
  }
});

test('tail someone home: at the end of the day he is behind his own door', () => {
  const w = sharedSmall(), c = w.census, p = {};
  for (let id = 0; id < c.residents; id += 53) {
    if (c.shiftStart[id] + c.shiftLen[id] > DAY) continue;
    w.whereIs(id, 2 * DAY - 1, p);
    assert.equal(p.state, 'at');
    assert.equal(p.place, c.home[id]);
    assert.equal(p.outside, false);
  }
});
