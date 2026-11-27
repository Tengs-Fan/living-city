// Consequences for people: rules that change someone's record some time after an event.
//
// Each rule is a trigger, conditions, a delay and an effect. A person can only do what a rule
// allows, which is the limit Oblivion's free-acting NPCs lacked.
//
//   grief        a relative or someone he lives with was killed
//   lost income  the household's only earner died: after about a fortnight, eviction
//   fear         saw a killing, or was robbed, carjacked or shot
//   armed        afraid, the sort to arm himself, in a district where fear is high
//   revenge      a brave relative who knows who did it, or the victim's gang
//   moving away  struck three times: the household leaves the city
//   recovery     grief and fear wear off, faces are forgotten, the homeless find a bed

import { salt } from './rng.js';
import { FLAG } from './state.js';
import { ARCH, TRAIT } from './census.js';
import { DAY } from './plans.js';
import { PAYOFF } from './memory.js';

const S_FEAR = salt('fear'), S_LEARN = salt('learn'), S_GRIEF = salt('grief'), S_RENT = salt('rent'),
  S_EVICT = salt('evict'), S_REVENGE = salt('revenge'), S_HURT = salt('hurt'), S_GANG = salt('gang'), S_LEAVE = salt('leave');

export function createRules(w) {
  const { census, city } = w;
  const B = city.buildings;
  const R = (w.rules = {});
  const name = (id) => census.name(id);

  /** How `speaker` would name `other`: "son", "wife", "flatmate". */
  R.relation = (speaker, other) => census.relatives(speaker).find((r) => r.id === other)?.rel ?? null;

  /** The people who lose their only income if this person dies. Empty if he is not the sole earner. */
  R.dependants = (id) => {
    if (id >= census.residents || w.archOf(id) !== ARCH.WORKER) return [];
    const rest = census.household(id).filter((m) => m !== id && w.alive(m) && w.homeOf(m) === census.home[m]);
    return rest.some((m) => w.archOf(m) === ARCH.WORKER) ? [] : rest;
  };

  // Struck often enough, a household gives up on the city. Shocks within a few hours of each
  // other are one incident; three bad ones are enough for the nervous, and for half the rest.
  function strain(id, weight) {
    const ps = w.people.get(id);
    if (w.t - ps.shockAt < 180) return;
    ps.shockAt = Math.round(w.t);
    ps.trauma += weight;
    if (ps.trauma < 3 || ps.leaving || id >= census.residents || ps.flags & (FLAG.HOMELESS | FLAG.HOSTILE)) return;
    if (w.roll(id, 0, S_LEAVE) > (census.traits[id] & TRAIT.NERVOUS ? 0.9 : 0.4)) return;
    ps.leaving = true;
    w.schedule(w.t + 10 * DAY, 'leave', { person: id });
  }
  const until = (t) => Math.ceil(t);

  /** Someone saw it happen. */
  R.witness = (ev, id) => {
    const ps = w.stateOf(id);
    const days = (14 + 14 * w.roll(ev.id, id, S_FEAR)) * (ev.type === 'kill' ? 1 : 0.5);
    ps.fearUntil = Math.max(ps.fearUntil, until(ev.t + days * DAY));
    ps.flags |= FLAG.KNOWS;
    ps.knows.push(ev.id);
    // he keeps away from where it happened, unless he lives or works there
    if (ev.place >= 0 && ev.place !== census.home[id] && ev.place !== census.work[id] && !ps.avoid.includes(ev.place)) ps.avoid.push(ev.place);
    w.touch(id);
    strain(id, ev.type === 'kill' ? 1 : 0.5);
  };

  /** Someone was robbed, carjacked or shot, and lived. */
  R.victim = (ev, id, flag) => {
    const ps = w.stateOf(id);
    ps.flags |= FLAG.KNOWS | flag;
    ps.knows.push(ev.id);
    ps.fearUntil = Math.max(ps.fearUntil, until(ev.t + (14 + 14 * w.roll(ev.id, id, S_FEAR)) * DAY));
    if (ev.type === 'injure') ps.hurtUntil = until(ev.t + (5 + 15 * w.roll(ev.id, id, S_HURT)) * DAY);
    w.touch(id);
    strain(id, ev.type === 'injure' ? 1.5 : 1);
  };

  /** Someone died: who will hear of it, who loses their income, who will want revenge. */
  R.death = (ev, victim, dependants) => {
    for (const r of census.relatives(victim)) {
      if (!w.alive(r.id)) continue;
      const u = w.roll(ev.id, r.id, S_LEARN);
      const together = census.hh[victim] >= 0 && census.hh[r.id] === census.hh[victim];
      const at = ev.witnesses.includes(r.id) ? ev.t : ev.t + (together ? 60 + 300 * u : 360 + 1080 * u);
      w.schedule(at, 'learn', { person: r.id, victim, event: ev.id, closeness: r.closeness });
    }
    if (dependants.length) {
      // the rent falls due a fortnight or so on; the bailiffs come at nine in the morning
      const due = Math.floor(ev.t / DAY + 12 + 4 * w.roll(ev.id, victim, S_RENT)) * DAY + 9 * 60;
      w.schedule(due, 'rent', { victim, event: ev.id });
    }
    if (census.arch[victim] === ARCH.GANG) {
      const d = B[census.home[victim]].district;
      const crew = gangOf(d).filter((m) => m !== victim && w.alive(m))
        .sort((a, b) => w.roll(ev.id, a, S_GANG) - w.roll(ev.id, b, S_GANG)).slice(0, 3);
      for (const m of crew) w.schedule(ev.t + (5 + 15 * w.roll(ev.id, m, S_REVENGE)) * DAY, 'hostile', { person: m, victim, event: ev.id, gang: true });
    }
  };

  const gangs = new Map();
  function gangOf(d) {
    let g = gangs.get(d);
    if (!g) {
      g = [];
      for (let id = 0; id < census.residents; id++) if (census.arch[id] === ARCH.GANG && B[census.home[id]].district === d) g.push(id);
      gangs.set(d, g);
    }
    return g;
  }

  // Grief: he hears of the death.
  w.handlers.learn = (k) => {
    if (!w.alive(k.person)) return;
    const ps = w.stateOf(k.person), ev = w.events.get(k.event);
    const u = w.roll(k.event, k.person, S_GRIEF);
    ps.griefUntil = Math.max(ps.griefUntil, until(w.t + (21 + 21 * u) * k.closeness * DAY));
    if (k.closeness >= 0.7) ps.leaveUntil = Math.max(ps.leaveUntil, until(w.t + (7 + 5 * u) * DAY));
    ps.mourns.push(k.victim);
    w.touch(k.person);
    const rel = R.relation(k.person, k.victim);
    w.note(`${name(k.person)} learns that ${w.possessive(k.person)} ${rel} ${census.firstName(k.victim)} is dead`,
      { event: k.event, people: [k.person, k.victim], quiet: !ev || ev.salience < PAYOFF });
    if (ev) {
      ev.mourners.push({ person: k.person, victim: k.victim, closeness: k.closeness });
      if (ev.public || ev.witnesses.includes(k.person)) R.blame(k.person, ev, k.victim, k.closeness);
    }
    strain(k.person, k.closeness >= 0.7 ? 1.5 : 0.5);
  };

  /** A mourner learns who did it: from the news once the police know, or because he was there. */
  R.blame = (person, ev, victim, closeness) => {
    if (!w.alive(person)) return;
    const ps = w.stateOf(person);
    if (!ps.knows.includes(ev.id)) ps.knows.push(ev.id);
    ps.flags |= FLAG.KNOWS;
    const weight = ev.salience * closeness;
    w.note(`${name(person)} learns who killed ${census.firstName(victim)}`, { event: ev.id, people: [person], quiet: weight < PAYOFF });
    if (weight >= PAYOFF) w.director.offer({ type: 'confront', person, victim, event: ev.id, salience: weight, notBefore: w.t + 20 * DAY });
    if (census.traits[person] & TRAIT.BRAVE && closeness >= 0.7 && census.age[person] < 60) {
      w.schedule(w.t + (10 + 20 * w.roll(ev.id, person, S_REVENGE)) * DAY, 'hostile', { person, victim, event: ev.id });
    }
  };

  // Revenge: he starts looking for the player.
  w.handlers.hostile = (k) => {
    if (!w.alive(k.person)) return;
    const ps = w.stateOf(k.person);
    if (ps.flags & FLAG.HOSTILE) return;
    ps.flags |= FLAG.HOSTILE | FLAG.ARMED | FLAG.KNOWS;
    w.touch(k.person);
    const ev = w.events.get(k.event);
    w.note(`${name(k.person)} ${k.gang ? `and ${city.districts[B[census.home[k.person]].district].gang} want blood for` : 'gets a gun and goes looking for whoever killed'} ${census.firstName(k.victim)}`,
      { event: k.event, people: [k.person] });
    w.director.offer({ type: 'revenge', person: k.person, victim: k.victim, event: k.event, salience: (ev ? ev.salience : PAYOFF) * 0.8, notBefore: w.t, gang: !!k.gang });
  };

  // Lost income: the rent falls due and nobody left in the household earns.
  w.handlers.rent = (k) => {
    const home = census.home[k.victim];
    const left = census.household(k.victim).filter((m) => w.alive(m) && w.homeOf(m) === home && !(w.stateOf(m).flags & FLAG.EVICTED));
    if (!left.length || left.some((m) => w.archOf(m) === ARCH.WORKER)) return;
    for (const m of left) evict(m, home, k);
    w.homeEmptied(B[home].district);
  };

  function evict(m, home, k) {
    const ps = w.stateOf(m);
    ps.flags |= FLAG.EVICTED;
    const from = `${B[home].kind === 'house' ? 'the house' : 'the flat'} at ${B[home].address}`;
    const kin = census.relatives(m).filter((r) => r.closeness >= 0.7 && w.alive(r.id) && census.hh[r.id] !== census.hh[m]
      && !((w.people.get(r.id)?.flags ?? 0) & (FLAG.HOMELESS | FLAG.EVICTED)));
    if (kin.length && w.roll(k.event, m, S_EVICT) < 0.6) {
      ps.home = w.homeOf(kin[0].id);
      w.note(`${name(m)} is evicted from ${from} and moves in with ${w.possessive(m)} ${kin[0].rel} ${census.firstName(kin[0].id)}`, { event: k.event, people: [m] });
    } else if (census.age[m] >= 45) {
      ps.flags |= FLAG.HOMELESS;
      ps.arch = ARCH.HOMELESS;
      ps.spot = home;
      w.schedule(w.t + (150 + 150 * w.roll(k.event, m, S_EVICT)) * DAY, 'shelter', { person: m });
      w.note(`${name(m)}, ${census.age[m]}, is evicted from ${from} and is now living on the pavement outside it`, { event: k.event, people: [m] });
    } else {
      ps.flags |= FLAG.MOVED;
      w.director.drop(m);
      w.note(`${name(m)} is evicted from ${from} and leaves the city`, { event: k.event, people: [m] });
    }
    w.touch(m);
  }

  // Recovery: after some months on the street, a bed in a hostel.
  w.handlers.shelter = (k) => {
    const ps = w.people.get(k.person);
    if (!ps || !(ps.flags & FLAG.HOMELESS) || !w.alive(k.person)) return;
    const hostels = (city.byKind.shelter ?? []).slice().sort((a, b) =>
      Math.hypot(B[a].doorX - B[ps.spot].doorX, B[a].doorY - B[ps.spot].doorY) - Math.hypot(B[b].doorX - B[ps.spot].doorX, B[b].doorY - B[ps.spot].doorY));
    if (!hostels.length) return;
    ps.flags &= ~FLAG.HOMELESS;
    ps.arch = ARCH.IDLE;
    ps.home = hostels[0];
    w.touch(k.person);
    w.note(`${name(k.person)} finds a bed at ${w.placeName(hostels[0])}`, { people: [k.person] });
  };

  // Moving away.
  w.handlers.leave = (k) => {
    if (!w.alive(k.person)) return;
    const home = w.homeOf(k.person);
    const going = census.household(k.person).filter((m) => w.alive(m) && w.homeOf(m) === home);
    for (const m of going) {
      w.stateOf(m).flags |= FLAG.MOVED;
      w.director.drop(m);
      w.touch(m);
    }
    const d = B[home].district;
    w.homeEmptied(d);
    w.note(`${name(k.person)}${going.length > 1 ? ' and family have' : ' has'} had enough and ${going.length > 1 ? 'leave' : 'leaves'} ${city.districts[d].name} for good`, { people: going, quiet: true });
  };

  /** Once a game day, over the people something has happened to (never the whole census). */
  R.day = () => {
    const t = w.t;
    for (const [id, ps] of w.people) {
      if (ps.flags & (FLAG.DEAD | FLAG.MOVED)) continue;
      // armed: afraid, the sort to arm himself, and living where fear is high
      if (!(ps.flags & FLAG.ARMED) && ps.fearUntil > t && census.traits[id] & TRAIT.ARMS && w.mood.fear[B[w.homeOf(id)].district] > 0.5) {
        ps.flags |= FLAG.ARMED;
        ps.armedUntil = t + 30 * DAY;
      }
      if (ps.flags & FLAG.ARMED && !(ps.flags & FLAG.HOSTILE) && ps.armedUntil <= t && ps.fearUntil <= t) ps.flags &= ~FLAG.ARMED;
      // a stranger's face is forgotten a month after the fear has gone; a mourner never forgets
      if (ps.flags & (FLAG.KNOWS | FLAG.ROBBED) && !ps.mourns.length && !(ps.flags & FLAG.HOSTILE) && ps.fearUntil + 30 * DAY < t) {
        ps.flags &= ~(FLAG.KNOWS | FLAG.ROBBED);
        ps.knows.length = 0; ps.avoid.length = 0; ps.trauma = 0;
      }
      if (!ps.flags && ps.home < 0 && ps.arch < 0 && !ps.mourns.length && !ps.knows.length && !ps.leaving
        && ps.griefUntil <= t && ps.fearUntil <= t && ps.hurtUntil <= t && ps.leaveUntil <= t) w.people.delete(id);
    }
  };
}
