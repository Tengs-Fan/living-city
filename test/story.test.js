import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY, ACT } from '../src/world.js';
import { FLAG } from '../src/state.js';
import { ARCH } from '../src/census.js';
import { findStory, robbery, walkUpTo } from '../src/scenarios.js';
import { small } from './helpers.js';

test('the guard, his mother, the eviction, the confrontation', () => {
  const w = small(), c = w.census;
  const story = findStory(w);
  assert.ok(story, 'the census holds someone whose death would put a parent on the street');
  const { victim, parent } = story;

  // hour 5: the robbery
  const { kill } = robbery(w, story);
  const day0 = Math.floor(kill.t / DAY);
  assert.equal(kill.place, story.work, 'he dies at work');
  assert.ok(kill.salience >= 2);

  // the same day she hears; the next morning the news names him and she knows who
  w.advance((day0 + 1) * DAY + 8 * 60 - w.t, { player: false });
  const ps = w.people.get(parent);
  assert.ok(ps.mourns.includes(victim) && ps.griefUntil > w.t);
  assert.ok(ps.flags & FLAG.KNOWS && ps.knows.includes(kill.id));
  assert.ok(w.news.some((n) => n.text.includes(c.name(victim))), 'the news names the victim');
  assert.ok(w.markers.some((m) => m.type === 'flowers' && m.event === kill.id), 'flowers at the scene');
  assert.equal(w.payoffs.filter((p) => p.person === parent && p.type === 'confront').length, 1);

  // meeting her now shows nothing: it is too soon, and she is at home
  w.advance(5 * DAY, { player: false });
  if (walkUpTo(w, parent)) assert.equal(w.advance(1), null);

  // about a fortnight on, the rent
  w.advance((day0 + 18) * DAY - w.t, { player: false });
  assert.ok(ps.flags & FLAG.EVICTED && ps.flags & FLAG.HOMELESS);
  assert.equal(w.archOf(parent), ARCH.HOMELESS);
  const plan = w.plan(parent);
  assert.ok(plan.every((s) => s.kind === ACT.STREET || s.kind === ACT.EAT), 'her day is the street now');
  assert.ok(plan.some((s) => s.place === c.home[parent]), 'and her spot is outside her old home');
  assert.equal(w.mood.emptyHomes[w.city.buildings[c.home[parent]].district], 1);

  // hour 100
  w.advance(125 * DAY + 10 * 60 - w.t, { player: false });
  const where = w.whereIs(parent);
  assert.ok(where.outside && where.place === c.home[parent]);
  // in a mission the director holds back
  walkUpTo(w, parent);
  w.player.busy = true;
  assert.equal(w.advance(1), null);
  w.player.busy = false;
  const scene = w.advance(1);
  assert.ok(scene, 'she stops him');
  assert.equal(scene.type, 'confront');
  assert.equal(scene.person, parent);
  const said = scene.lines.join(' ');
  assert.ok(said.includes(c.firstName(victim)), said);
  assert.ok(said.includes(w.placeName(story.work)), said);
  assert.ok(said.includes('pavement'), said);
  // once only
  assert.equal(w.advance(1), null);
  w.advance(5 * DAY, { player: false });
  walkUpTo(w, parent);
  assert.equal(w.advance(1), null);
  assert.equal(w.scenes.length, 1);
});

test('kill a gang member and the gang comes looking', () => {
  const w = small(), c = w.census;
  let member = -1;
  for (let id = 0; id < c.residents && member < 0; id++) if (c.arch[id] === ARCH.GANG) member = id;
  assert.ok(member >= 0);
  w.advance(DAY, { player: false });
  w.act.kill(member);
  w.advance(25 * DAY, { player: false });
  const hostile = [...w.people].filter(([, ps]) => ps.flags & FLAG.HOSTILE).map(([id]) => id);
  assert.ok(hostile.length >= 1 && hostile.length <= 6, `${hostile.length} hostile`);
  for (const id of hostile) assert.ok(w.people.get(id).flags & FLAG.ARMED);
  assert.ok(w.payoffs.some((p) => p.type === 'revenge'));
});

test('two thousand killings: a changed city, a handful of scenes, a small save', () => {
  const w = small(), c = w.census;
  const { minX, minY, maxX, maxY } = w.city.bounds;
  let kills = 0, r = 12345;
  const rand = () => ((r = (Math.imul(r, 1103515245) + 12345) >>> 0) / 4294967296);
  for (let day = 1; kills < 2000; day++) {
    w.advance(day * DAY + (9 + rand() * 9) * 60 - w.t, { player: false });
    for (let k = 0; k < 20; k++) {
      // the player turns up somewhere, shoots whoever is near, and hangs about for a while
      w.player.x = minX + rand() * (maxX - minX); w.player.y = minY + rand() * (maxY - minY);
      const near = w.near(w.player.x, w.player.y, 250);
      const id = near.length ? near[Math.floor(rand() * near.length)] : Math.floor(rand() * c.n);
      if (w.act.kill(id)) kills++;
      for (let m = 0; m < 6; m++) w.advance(5);
    }
  }
  const days = Math.floor(w.t / DAY);
  assert.ok(w.scenes.length <= 12, `${w.scenes.length} scenes in ${days} game days`);
  assert.ok(w.payoffs.length <= 8);
  const save = JSON.stringify(w.save());
  assert.ok(save.length < 1e6, `save is ${save.length} bytes`);
  let fear = 0;
  for (let d = 0; d < w.city.districts.length; d++) fear = Math.max(fear, w.mood.fear[d]);
  assert.ok(fear > 0.5, 'somewhere is terrified');
  let gone = 0;
  for (let id = 0; id < c.residents; id++) if (w.isGone(id)) gone++;
  assert.ok(gone < c.residents * 0.5, `${gone} of ${c.residents} residents gone`);
  // every evicted person ended up somewhere a rule allows
  for (const [id, ps] of w.people) {
    if (!(ps.flags & FLAG.EVICTED)) continue;
    const ok = ps.flags & (FLAG.HOMELESS | FLAG.MOVED | FLAG.DEAD) || ps.home >= 0;
    assert.ok(ok, `evicted person ${id} is nowhere`);
  }
});
