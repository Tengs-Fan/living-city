// Event memory: what happened, to whom, who saw it, and who comes to know.
//
// The host game reports what the player does through w.act. Each report becomes a world
// event with a place, victims, witnesses and a salience. Everything that follows later is a
// task on a timeline: the police identifying the player, the morning news, a relative
// hearing of a death. Nothing is polled.

import { hash4, unit, salt } from './rng.js';
import { FLAG, newPersonState } from './state.js';
import { districtAt } from './city.js';
import { DAY } from './plans.js';

const BASE = { kill: 1, injure: 0.35, rob: 0.3, carjack: 0.3, robbery: 0.5, gunfire: 0.1 };
// [fear, extra fear per witness, most witnesses counted, violence]
const SHOCK = { kill: [0.035, 0.015, 6, 0.03], injure: [0.015, 0.01, 4, 0.015], rob: [0.01, 0.005, 4, 0.01],
  carjack: [0.01, 0.005, 4, 0.01], robbery: [0.03, 0.005, 6, 0.02], gunfire: [0.015, 0.005, 4, 0.005] };
/** Events at least this salient are kept in full and make the news. */
export const NEWSWORTHY = 1.5;
/** A relative's loss at least this salient may be shown to the player one day. */
export const PAYOFF = 2;
const S_CALL = salt('call');

const article = (s) => (/^[aeiou]/i.test(s) ? 'an' : 'a');

export function createMemory(w) {
  const { census, city } = w;
  const B = city.buildings;
  w.events = new Map();
  w.eventSeq = 0;
  w.tasks = [];
  w.taskSeq = 0;
  w.news = [];
  w.markers = [];
  w.log = [];
  w.handlers = {};
  w.act = {};

  w.stateOf = (id) => {
    let ps = w.people.get(id);
    if (!ps) w.people.set(id, (ps = newPersonState()));
    return ps;
  };
  w.alive = (id) => !w.isGone(id);
  /** A line in the timeline of everything that has happened: the debug view of the memory. */
  w.note = (text, extra = {}) => {
    w.log.push({ t: w.t, text, ...extra });
    if (w.log.length > 4000) w.log.splice(0, 1000);
  };
  /** Run a task of `type` at game minute t. */
  w.schedule = (t, type, data) => {
    t = Math.ceil(t); // whole minutes keep the save small
    const task = { t, seq: w.taskSeq++, type, ...data };
    let lo = 0, hi = w.tasks.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (w.tasks[mid].t <= t) lo = mid + 1; else hi = mid; }
    w.tasks.splice(lo, 0, task);
  };
  /** A repeatable dice roll in [0, 1) for a thing (an event, say) and a person. */
  w.roll = (a, b, s) => unit(hash4(w.seed, a, b, s));

  const pronoun = (id) => (census.sex[id] ? 'she' : 'he');
  const possessive = (id) => (census.sex[id] ? 'her' : 'his');
  w.pronoun = pronoun; w.possessive = possessive;
  w.jobOf = (id) => (census.work[id] >= 0 && census.role[id] > 1 ? `${article(census.roleName(id))} ${census.roleName(id)} at ${w.placeName(census.work[id])}` : null);

  // --- recording ---------------------------------------------------------------------------
  function record(type, o) {
    const t = w.t, victims = o.victims ?? [];
    let { x, y, place = -1 } = o;
    if (victims.length && x === undefined && place < 0) {
      const p = w.whereIs(victims[0], t);
      if (p.state === 'gone') return null;
      x = p.x; y = p.y;
      if (p.state === 'at' && !p.outside) place = p.place; // it happened indoors
    }
    if (place >= 0 && x === undefined) { x = B[place].doorX; y = B[place].doorY; }
    const district = place >= 0 ? B[place].district : districtAt(city, x, y);
    // witnesses: whoever is in the building, and whoever is on the street close by
    const seen = new Set(victims), witnesses = [];
    const see = (id) => { if (!seen.has(id) && witnesses.length < 12) { seen.add(id); witnesses.push(id); } };
    if (place >= 0) for (const id of w.inside(place, t)) see(id);
    for (const id of w.near(x, y, place >= 0 ? 25 : 40, t)) see(id);
    return {
      id: w.eventSeq++, t: Math.round(t * 100) / 100, type, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10,
      district, place, victims, witnesses, mission: o.mission ?? null,
      salience: 0, police: false, policeAt: -1, newsAt: -1, public: false, mourners: [],
    };
  }

  function salience(ev, kin, dependants) {
    let s = BASE[ev.type];
    if (kin) s *= 1.6;
    if (ev.witnesses.length) s *= 1.3;
    if (ev.mission) s *= 2.5;
    if (dependants) s *= 1.5;
    return s;
  }

  // What every event sets in motion.
  function file(ev) {
    w.events.set(ev.id, ev);
    const [fear, per, cap, violence] = SHOCK[ev.type];
    w.moodHit(ev.district, fear + per * Math.min(ev.witnesses.length, cap), violence);
    for (const id of ev.witnesses) w.rules.witness(ev, id);
    // somebody calls the police; a mission's alarm always does
    const n = ev.witnesses.length;
    if (ev.mission || (n && w.roll(ev.id, 0, S_CALL) < 1 - 0.5 ** n)) {
      ev.policeAt = Math.ceil(ev.t + 3 + 17 * w.roll(ev.id, 1, S_CALL));
      w.schedule(ev.policeAt, 'police', { event: ev.id });
    }
    if (ev.salience >= NEWSWORTHY) {
      ev.newsAt = (Math.floor(ev.t / DAY) + 1) * DAY + 7 * 60; // the morning news
      w.schedule(ev.newsAt, 'news', { event: ev.id });
      if (ev.type === 'kill') w.markers.push({ type: 'flowers', x: ev.x, y: ev.y, from: ev.t + 12 * 60, until: ev.t + 7.5 * DAY, event: ev.id });
      w.schedule(ev.t + 10 * DAY, 'expire', { event: ev.id });
    } else w.schedule(ev.t + 3 * DAY, 'expire', { event: ev.id });
    return ev;
  }

  w.handlers.police = (k) => {
    const ev = w.events.get(k.event);
    if (!ev) return;
    ev.police = true;
    w.note(`The police know who was behind the ${describeType(ev)}`, { event: ev.id, quiet: ev.salience < NEWSWORTHY });
  };

  w.handlers.news = (k) => {
    const ev = w.events.get(k.event);
    if (!ev) return;
    ev.public = ev.police;
    const text = headline(ev);
    w.news.push({ t: w.t, text, event: ev.id, district: ev.district });
    if (w.news.length > 60) w.news.shift();
    w.note(`News: ${text}`, { event: ev.id, news: true });
    // those already mourning now learn who did it
    if (ev.public) for (const m of ev.mourners) w.rules.blame(m.person, ev, m.victim, m.closeness);
  };

  // Events are forgotten as records: small ones after three days, newsworthy ones after ten,
  // and the few a pending payoff refers to when that payoff is spent. What they did to people
  // and districts stays; the district counters keep the totals.
  w.handlers.expire = (k) => {
    const ev = w.events.get(k.event);
    if (!ev) return;
    if (w.payoffs.some((p) => p.event === k.event)) { w.schedule(w.t + 30 * DAY, 'expire', { event: k.event }); return; }
    for (const id of [...ev.witnesses, ...ev.victims, ...ev.mourners.map((m) => m.person)]) {
      const ps = w.people.get(id);
      if (ps && ps.knows.includes(ev.id)) ps.knows = ps.knows.filter((e) => e !== ev.id);
    }
    w.events.delete(k.event);
  };

  function describeType(ev) {
    const where = ev.place >= 0 ? `at ${w.placeName(ev.place)}` : `in ${city.districts[ev.district].name}`;
    const what = { kill: 'killing', injure: 'shooting', rob: 'mugging', carjack: 'carjacking', robbery: 'robbery', gunfire: 'gunfire' }[ev.type];
    return `${what} ${where}`;
  }

  function headline(ev) {
    const d = city.districts[ev.district].name;
    const suspect = ev.police ? 'Police have named a suspect.' : 'Police are appealing for witnesses.';
    if (ev.type === 'kill') {
      const v = ev.victims[0], job = w.jobOf(v);
      const where = ev.place >= 0 ? `at ${w.placeName(ev.place)} on ${B[ev.place].street}` : `in the street in ${d}`;
      const kin = census.relatives(v).filter((r) => census.hh[r.id] === census.hh[v] && census.hh[v] >= 0 && r.rel !== 'flatmate');
      const home = kin.length ? ` ${pronoun(v) === 'she' ? 'She' : 'He'} lived in ${city.districts[B[census.home[v]].district].name} with ${possessive(v)} ${kin.map((r) => r.rel).join(' and ')}.` : '';
      return `${census.name(v)}, ${census.age[v]}, ${job ? job + ', ' : ''}was shot dead ${ev.mission ? `during a ${ev.mission} ` : ''}${where}.${home} ${suspect}`;
    }
    if (ev.type === 'robbery') return `Armed robbery at ${w.placeName(ev.place)} on ${B[ev.place].street}. ${suspect}`;
    return `A ${describeType(ev)}. ${suspect}`;
  }
  w.describeEvent = describeType;

  // --- what the player can be reported doing -------------------------------------------------
  /** The player kills someone. Returns the world event, or null if he is not there to kill. */
  w.act.kill = (victim, o = {}) => {
    if (w.isGone(victim)) return null;
    const dependants = w.rules.dependants(victim);
    const kin = census.relatives(victim).some((r) => w.alive(r.id));
    const ev = record('kill', { ...o, victims: [victim] });
    if (!ev) return null;
    ev.salience = salience(ev, kin, dependants.length > 0);
    const ps = w.stateOf(victim);
    ps.flags |= FLAG.DEAD;
    w.touch(victim);
    w.director.drop(victim);
    w.mood.kills[ev.district]++;
    const job = w.jobOf(victim);
    w.note(`${census.name(victim)}, ${census.age[victim]}${job ? ', ' + job : ''}, is killed ${ev.place >= 0 ? 'at ' + w.placeName(ev.place) : 'in the street in ' + city.districts[ev.district].name}${ev.mission ? ` (${ev.mission})` : ''}; ${ev.witnesses.length} saw it`,
      { event: ev.id, people: [victim], quiet: ev.salience < NEWSWORTHY });
    file(ev);
    w.rules.death(ev, victim, dependants);
    return ev;
  };

  const harm = (type, flag, count) => (victim, o = {}) => {
    if (w.isGone(victim)) return null;
    const ev = record(type, { ...o, victims: [victim] });
    if (!ev) return null;
    ev.salience = salience(ev, false, false);
    w.mood[count][ev.district]++;
    file(ev);
    w.rules.victim(ev, victim, flag);
    w.note(`${census.name(victim)} is the victim of a ${describeType(ev)}`, { event: ev.id, people: [victim], quiet: true });
    return ev;
  };
  /** The player shoots and wounds someone. */
  w.act.injure = harm('injure', 0, 'injuries');
  /** The player robs someone in the street. */
  w.act.rob = harm('rob', FLAG.ROBBED, 'robberies');
  /** The player takes someone's car. */
  w.act.carjack = harm('carjack', FLAG.ROBBED, 'robberies');

  /** The player holds up a building. */
  w.act.robPlace = (place, o = {}) => {
    const ev = record('robbery', { ...o, place });
    ev.salience = salience(ev, false, false) * 2; // a robbery of a business is always news
    w.mood.robberies[ev.district]++;
    w.note(`Armed robbery at ${w.placeName(place)}${ev.mission ? ` (${ev.mission})` : ''}; ${ev.witnesses.length} saw it`, { event: ev.id });
    return file(ev);
  };

  /** Shots fired at a point, hitting nobody. */
  w.act.gunfire = (x, y) => {
    const ev = record('gunfire', { x, y });
    ev.salience = salience(ev, false, false);
    return file(ev);
  };
}
