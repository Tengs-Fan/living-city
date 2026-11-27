#!/usr/bin/env node
// A look at the city from the command line.
//
//   living-city stats                       the city and its people
//   living-city person <id | name> [day]    one person and his day
//   living-city corner [HH:MM] [day]        who is on the street by the biggest office
//   living-city story                       the guard, his mother, the eviction, the confrontation
//   living-city rampage [kills]             a very violent game, and what is left of the city
//
// Options: --seed N, --small (a city a sixth of the size)

import { createWorld, DAY, stamp, clock, ARCH_NAMES } from '../src/world.js';
import { findStory, robbery, walkUpTo } from '../src/scenarios.js';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i < 0 ? null : args.splice(i, 2)[1] ?? true; };
const seed = Number(flag('--seed') ?? 1);
const smallCity = args.includes('--small') && args.splice(args.indexOf('--small'), 1);
const [cmd = 'stats', ...rest] = args;

const t0 = performance.now();
const w = createWorld(smallCity ? { seed, cols: 16, rows: 12 } : { seed });
const c = w.census;
const ms = () => `${Math.round(performance.now() - t0)} ms`;
const card = (id) => {
  const p = w.person(id);
  const lines = [`#${id} ${p.name}, ${p.age}, ${p.archetype}${p.role ? `: ${p.role} at ${p.workName}, ${p.shift}` : ''}`,
    `  lives at ${p.homeName}, ${p.district}${p.visitor ? ' (visitor)' : ''}${p.car ? '; has a car' : ''}${p.traits.length ? '; ' + p.traits.join(', ') : ''}`];
  if (p.relatives.length) lines.push('  ' + p.relatives.map((r) => `${r.rel} ${r.name}${r.gone ? ' (gone)' : ''}`).join(', '));
  if (p.state.length) lines.push('  now: ' + p.state.join(', '));
  return lines.join('\n');
};

if (cmd === 'stats') {
  const kinds = {};
  for (const b of w.city.buildings) kinds[b.kind] = (kinds[b.kind] ?? 0) + 1;
  const arch = new Array(ARCH_NAMES.length).fill(0);
  for (let id = 0; id < c.n; id++) arch[c.arch[id]]++;
  console.log(`${w.city.name}, seed ${seed}: generated in ${ms()}`);
  console.log(`  ${w.city.buildings.length} buildings on ${w.city.edges.n} street segments, ${w.city.districts.length} districts`);
  console.log(`  ${c.residents} residents in ${c.households} households, ${c.commuters} commuters, ${c.tourists} tourists`);
  console.log('  ' + arch.map((n, i) => `${n} ${ARCH_NAMES[i]}`).filter((s) => !s.startsWith('0 ')).join(', '));
  console.log('  ' + Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join(', '));
  for (const h of [3, 8.5, 12.5, 18, 22]) {
    let moving = 0, still = 0;
    w.outside(h * 60, (id, p) => (p.state === 'travel' ? moving++ : still++));
    console.log(`  Monday ${clock(h * 60)}: ${moving} people on the move, ${still} out in parks, on beaches and on corners`);
  }
} else if (cmd === 'person') {
  let id = Number(rest[0]);
  if (Number.isNaN(id)) {
    const q = rest[0].toLowerCase();
    id = -1;
    for (let k = 0; k < c.n && id < 0; k++) if (c.name(k).toLowerCase().includes(q)) id = k;
    if (id < 0) { console.error(`nobody called "${rest[0]}"`); process.exit(1); }
  }
  const day = Number(rest[1] ?? 0);
  console.log(card(id));
  console.log(`\n${stamp(day * DAY).split(' ').slice(0, 3).join(' ')}:`);
  console.log(w.describeDay(id, day).map((l) => '  ' + l).join('\n'));
} else if (cmd === 'corner') {
  const [hh, mm] = (rest[0] ?? '08:30').split(':').map(Number);
  const t = Number(rest[1] ?? 0) * DAY + hh * 60 + mm;
  const office = w.city.buildings.filter((b) => b.kind === 'office').sort((a, b) => b.jobs - a.jobs)[0];
  const q0 = performance.now();
  const ids = w.near(office.streetX, office.streetY, 150, t);
  const first = performance.now() - q0;
  const q1 = performance.now();
  for (let k = 0; k < 1000; k++) w.near(office.streetX, office.streetY, 150, t);
  console.log(`${stamp(t)}, within 150 m of ${office.address}: ${ids.length} people (first query ${first.toFixed(0)} ms, then ${((performance.now() - q1)).toFixed(0)} microseconds each)`);
  for (const id of ids.slice(0, 25)) console.log(`  ${c.name(id)}, ${c.age[id]}: ${w.describeWhere(w.whereIs(id, t))}`);
  if (ids.length > 25) console.log(`  ... and ${ids.length - 25} more`);
} else if (cmd === 'story') {
  const story = findStory(w);
  if (!story) { console.error('this seed has nobody whose death would put a parent on the street'); process.exit(1); }
  console.log(card(story.victim));
  console.log(card(story.parent));
  console.log();
  robbery(w, story, { mission: w.city.buildings[story.work].kind === 'bank' ? 'bank robbery' : 'robbery' });
  w.advance(125 * DAY + 10 * 60 - w.t, { player: false });
  walkUpTo(w, story.parent);
  w.advance(1);
  for (const l of w.log) if (!l.quiet) console.log(`${stamp(l.t)}  ${l.text}`);
  console.log(`\n${c.firstName(story.parent)}'s day now:`);
  console.log(w.describeDay(story.parent).map((l) => '  ' + l).join('\n'));
  console.log(`\nsave: ${JSON.stringify(w.save()).length} bytes; ${ms()} in all`);
} else if (cmd === 'rampage') {
  const target = Number(rest[0] ?? 2000);
  const { minX, minY, maxX, maxY } = w.city.bounds;
  let kills = 0, r = 99;
  const rand = () => ((r = (Math.imul(r, 1103515245) + 12345) >>> 0) / 4294967296);
  for (let day = 1; kills < target; day++) {
    w.advance(day * DAY + (9 + rand() * 9) * 60 - w.t, { player: false });
    for (let k = 0; k < 16 && kills < target; k++) {
      w.player.x = minX + rand() * (maxX - minX); w.player.y = minY + rand() * (maxY - minY);
      const near = w.near(w.player.x, w.player.y, 250);
      if (near.length && w.act.kill(near[Math.floor(rand() * near.length)])) kills++;
      for (let m = 0; m < 6; m++) w.advance(5);
    }
  }
  console.log(`${kills} killings in ${Math.floor(w.t / DAY)} game days (${ms()})`);
  console.log(`scenes shown: ${w.scenes.length}; payoffs still pending: ${w.payoffs.length}`);
  for (const s of w.scenes) console.log(`  ${stamp(s.t)}  ${s.cue} "${s.lines.join(' ')}"`);
  const tally = {};
  for (const [, ps] of w.people) for (const s of ['dead', 'evicted', 'homeless', 'moved away', 'knows your face', 'hostile', 'armed'].filter((_, i) => ps.flags & (1 << i))) tally[s] = (tally[s] ?? 0) + 1;
  console.log('people marked: ' + Object.entries(tally).map(([k, n]) => `${n} ${k}`).join(', '));
  console.log('districts:');
  for (let d = 0; d < w.city.districts.length; d++) {
    const m = w.districtReport(d);
    console.log(`  ${m.name.padEnd(16)} fear ${m.fear.toFixed(2)}  violence ${m.violence.toFixed(2)}  policing ${m.policing.toFixed(2)}  prosperity ${m.prosperity.toFixed(2)} (normally ${m.baseProsperity})  ${m.kills} killed, ${m.emptyHomes} homes empty, ${Math.round(m.effects.armedShare * 100)}% armed`);
  }
  console.log(`save: ${JSON.stringify(w.save()).length} bytes`);
} else {
  console.error(`unknown command "${cmd}": try stats, person, corner, story or rampage`);
  process.exit(1);
}
