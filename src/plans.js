// Daily plans.
//
// A plan is one person's day as a chain of stops: a place, what he does there, when he
// arrives and when he leaves. Between two stops he is travelling. The plan is a pure function
// of the seed, the person, the day and whatever play has changed about him, so nothing ticks
// for people nobody is looking at: to know where someone is, build his plan and read it.
//
// Every outing has a destination and an end. Nobody "drives around".

import { hash2, hash3, unit, salt } from './rng.js';
import { ARCH } from './census.js';
import { FLAG } from './state.js';
import { MODE, travelMinutes } from './routing.js';

export const ACT = { HOME: 0, WORK: 1, STUDY: 2, SHOP: 3, EAT: 4, DRINK: 5, LEISURE: 6, VISIT: 7, HANG: 8, STREET: 9, AWAY: 10 };
export const ACT_NAMES = ['at home', 'at work', 'studying', 'shopping', 'eating', 'having a drink', 'out', 'visiting family', 'hanging about', 'on the street', 'out of town'];
export const MAX_STOPS = 8;
export const DAY = 1440;

const WHITE_COLLAR = new Set(['office', 'bank', 'cityhall', 'university']);
const S_PUNCTUAL = salt('punctual'), S_FAV = salt('favourite');

export function newPlan() {
  return {
    n: 0,
    place: new Int32Array(MAX_STOPS),
    kind: new Uint8Array(MAX_STOPS),
    arrive: new Float32Array(MAX_STOPS),
    depart: new Float32Array(MAX_STOPS),
    mode: new Uint8Array(MAX_STOPS), // how he travels on from this stop
  };
}

/**
 * @param {object} w  needs seed, city, router, census, people (Map of person states),
 *                    nightFactor(district): how willing people there are to go out after dark,
 *                    and hauntSpots(): places in the district the player frequents
 */
export function createPlanner(w) {
  const { seed, city, router, census } = w;
  const B = city.buildings;
  const S = newPlan();

  // the day being built
  let free = 0; // when he is free to leave the current stop
  let latest = DAY; // the last moment he can leave it and still end the day where he must
  let endPlace = -1, endKind = ACT.HOME;
  let hasCar = 0, forceCar = false, walkLimit = 650, tmode = 0;
  let avoid = null, quiet = false, nf = 1;
  let hp = 0, hd = 0, rk = 0;
  const rnd = () => unit(hash2(hd, rk++)); // the next random number of this person's day

  function travel(a, b) {
    const d = router.distance(a, b);
    tmode = d < walkLimit ? MODE.WALK : forceCar || hasCar ? MODE.CAR : MODE.BUS;
    return Math.max(1, travelMinutes(d, tmode));
  }

  function start(place, kind, freeAt = 0) {
    S.n = 1;
    S.place[0] = place; S.kind[0] = kind; S.arrive[0] = 0;
    free = freeAt; latest = DAY;
  }

  /**
   * Travel to a place, arriving at `arriveAt` or as soon as he can get there, and stay.
   * Refused, changing nothing, if he could not get back to where the day ends by midnight.
   */
  function go(place, kind, arriveAt, stay, final = false) {
    if (place < 0) return false;
    const cur = S.place[S.n - 1];
    if (place === cur) {
      free = Math.min(Math.max(free, arriveAt) + stay, latest);
      return true;
    }
    if (!final && (S.n >= MAX_STOPS - 1 || (avoid && avoid.includes(place)))) return false;
    const tr = travel(cur, place), mode = tmode;
    const dep = Math.min(Math.max(free, arriveAt - tr), DAY - 1 - tr);
    const arr = dep + tr;
    let last = DAY;
    if (!final) {
      last = DAY - 4 - travel(place, endPlace);
      if (arr + 5 > last) return false;
    }
    S.depart[S.n - 1] = dep; S.mode[S.n - 1] = mode;
    S.place[S.n] = place; S.kind[S.n] = kind; S.arrive[S.n] = arr;
    S.n++;
    latest = last;
    free = Math.min(arr + stay, latest);
    return true;
  }
  const stayUntil = (t) => { free = Math.min(Math.max(free, t), latest); };
  const here = () => S.place[S.n - 1];

  /** A place of a category near an anchor: usually his regular one, sometimes another. */
  function near(anchor, cat) {
    const list = city.near(cat, anchor);
    if (!list.length) return -1;
    const u = rnd() < 0.7 ? unit(hash3(hp, S_FAV, salt(cat))) : rnd();
    let k = Math.floor(u * u * list.length);
    if (avoid && avoid.includes(list[k])) k = (k + 1) % list.length;
    return list[k];
  }

  const homeOf = (id) => {
    const ps = w.people.get(id);
    if (ps && ps.flags & (FLAG.DEAD | FLAG.MOVED | FLAG.HOMELESS)) return -1;
    return ps && ps.home >= 0 ? ps.home : census.home[id];
  };
  /** The home of a parent or child who lives elsewhere, for Sunday visits. */
  function familyHome(id, home) {
    if (id >= census.residents) return -1;
    const p = census.parentA[id];
    if (p >= 0 && homeOf(p) >= 0 && homeOf(p) !== home) return homeOf(p);
    const kids = census.childrenOf(id);
    for (let k = 0; k < kids.length; k++) {
      const c = kids[(k + (hd & 3)) % kids.length];
      if (homeOf(c) >= 0 && homeOf(c) !== home) return homeOf(c);
    }
    return -1;
  }

  function evening(home, homeKind, p) {
    if (quiet || free > 1170 || rnd() >= p * nf) return;
    const r = rnd();
    const at = Math.max(free + 40, 1140 + rnd() * 60);
    if (r < 0.45) go(near(home, 'drink'), ACT.DRINK, at, 50 + rnd() * 90);
    else if (r < 0.8) go(near(home, 'eat'), ACT.EAT, at, 50 + rnd() * 40);
    else go(near(home, 'outdoors'), ACT.LEISURE, at, 30 + rnd() * 40);
    go(home, homeKind, 0, 0);
  }

  function leisureDay(id, home, dow, o) {
    if (quiet) {
      // grieving or hurt: stays in, perhaps one short walk
      if (rnd() < 0.3) {
        go(near(home, rnd() < 0.5 ? 'church' : 'park'), ACT.LEISURE, 600 + rnd() * 240, 30 + rnd() * 40);
        go(home, ACT.HOME, 0, 0);
      }
      return;
    }
    const t = Math.max(free + 20, o.wake + rnd() * 120);
    if (rnd() < o.out) {
      const r = rnd(), kin = dow === 6 ? familyHome(id, home) : -1;
      let ok;
      if (kin >= 0 && r < 0.35) ok = go(kin, ACT.VISIT, t + 60, 90 + rnd() * 120);
      else if (dow === 6 && census.age[id] > 50 && r < 0.5) ok = go(near(home, 'church'), ACT.LEISURE, 570 + rnd() * 60, 60);
      else if (r < (dow >= 5 ? 0.62 : 0.48)) ok = go(near(home, 'outdoors'), ACT.LEISURE, t, 40 + rnd() * 110);
      else if (r < 0.88) ok = go(near(home, 'shop'), ACT.SHOP, t, 15 + rnd() * 40);
      else ok = go(near(home, 'eat'), ACT.EAT, Math.max(t, 720 + rnd() * 60), 40 + rnd() * 30);
      if (ok && rnd() < o.second) {
        if (rnd() < 0.5) go(near(here(), 'eat'), ACT.EAT, 0, 30 + rnd() * 30);
        else go(near(here(), 'shop'), ACT.SHOP, 0, 15 + rnd() * 30);
      }
      go(home, ACT.HOME, 0, 0);
    }
    evening(home, ACT.HOME, o.evening);
  }

  function workDay(id, day, home, homeKind, ps, dow) {
    const work = census.work[id], s = census.shiftStart[id], L = census.shiftLen[id];
    const crosses = s + L > DAY;
    const on = (d) => census.rostered(id, d) && !(ps && (ps.leaveUntil > d * DAY + s || ps.hurtUntil > d * DAY + s));
    const onPrev = crosses && on(day - 1), onToday = on(day);
    // habitually early or late, plus the day's luck
    const arriveAt = s + (unit(hash2(hp, S_PUNCTUAL)) - 0.5) * 16 + (rnd() - 0.5) * 8;
    endPlace = onToday && crosses ? work : home;
    endKind = onToday && crosses ? ACT.WORK : homeKind;
    if (onPrev) {
      // the end of last night's shift, then home to sleep
      start(work, ACT.WORK, s + L - DAY + rnd() * 10);
      go(home, homeKind, 0, 0);
    } else start(home, homeKind);
    const visitor = homeKind === ACT.AWAY;
    if (!onToday) {
      if (!visitor) leisureDay(id, home, dow, { wake: onPrev ? 780 : 540, out: 0.7, second: 0.3, evening: 0.22 });
      return;
    }
    if (s >= 780 && !quiet && !onPrev && !visitor && rnd() < 0.3) {
      if (go(near(home, rnd() < 0.6 ? 'shop' : 'outdoors'), ACT.SHOP, 570 + rnd() * 90, 20 + rnd() * 50)) go(home, homeKind, 0, 0);
    }
    if (crosses) { go(work, ACT.WORK, arriveAt, DAY, true); return; }
    const end = s + L + rnd() * 12;
    if (!go(work, ACT.WORK, arriveAt, 0)) return;
    if (L >= 420 && !quiet && rnd() < (WHITE_COLLAR.has(B[work].kind) ? 0.38 : 0.14)) {
      stayUntil(s + 215 + rnd() * 70);
      if (go(near(work, 'eat'), ACT.EAT, 0, 26 + rnd() * 20)) go(work, ACT.WORK, 0, 0);
    }
    stayUntil(end);
    if (!quiet && free < 1260) {
      const sociable = census.traits[id] & 4 ? 1.5 : 1;
      if ((hp >>> 3) % 7 === dow && (hp & 7) < 3) go(near(visitor ? work : home, 'gym'), ACT.LEISURE, 0, 50 + rnd() * 30);
      else if (rnd() < (dow === 4 || dow === 5 ? 0.4 : 0.18) * nf * sociable * (visitor ? 0.4 : 1)) {
        const r = rnd();
        if (r < 0.5 || visitor) go(near(work, 'drink'), ACT.DRINK, 0, 45 + rnd() * 100);
        else if (r < 0.8) go(near(home, 'shop'), ACT.SHOP, 0, 15 + rnd() * 30);
        else go(near(home, 'eat'), ACT.EAT, 0, 45 + rnd() * 40);
      }
    }
    go(home, homeKind, 0, 0);
    if (!visitor) evening(home, homeKind, 0.13);
  }

  /** Build the plan of person `id` for `day` into the shared scratch plan and return it. */
  function build(id, day) {
    const ps = w.people.get(id);
    S.n = 0;
    if (ps && ps.flags & (FLAG.DEAD | FLAG.MOVED)) return S;
    const arch = ps && ps.arch >= 0 ? ps.arch : census.arch[id];
    const home = ps && ps.home >= 0 ? ps.home : census.home[id];
    const t0 = day * DAY, dow = ((day % 7) + 7) % 7;
    hp = hash2(seed, id); hd = hash3(seed, id, day); rk = 0;
    hasCar = census.car[id]; forceCar = false; walkLimit = 650;
    avoid = ps && ps.avoid.length ? ps.avoid : null;
    quiet = !!ps && (ps.griefUntil > t0 || ps.hurtUntil > t0);
    nf = quiet || (ps && ps.fearUntil > t0) ? 0 : w.nightFactor(B[home].district);
    endPlace = home; endKind = ACT.HOME;

    switch (arch) {
      case ARCH.WORKER:
        workDay(id, day, home, ACT.HOME, ps, dow);
        break;
      case ARCH.COMMUTER:
        if (B[home].kind === 'station') { hasCar = 0; walkLimit = 900; } else forceCar = true;
        workDay(id, day, home, ACT.AWAY, ps, dow);
        break;
      case ARCH.STUDENT: {
        start(home, ACT.HOME);
        if (census.rostered(id, day) && !quiet) {
          const s = census.shiftStart[id] + ((hash2(hp, dow) % 5) - 2) * 30;
          if (go(census.work[id], ACT.STUDY, s + rnd() * 10, census.shiftLen[id]) && rnd() < 0.45 * nf) {
            const r = rnd();
            if (r < 0.5) go(near(here(), 'drink'), ACT.DRINK, 0, 50 + rnd() * 100);
            else if (r < 0.8) go(near(here(), 'eat'), ACT.EAT, 0, 35 + rnd() * 30);
            else go(near(here(), 'outdoors'), ACT.LEISURE, 0, 40 + rnd() * 60);
          }
          go(home, ACT.HOME, 0, 0);
          evening(home, ACT.HOME, 0.3);
        } else leisureDay(id, home, dow, { wake: 600, out: 0.75, second: 0.35, evening: 0.35 });
        break;
      }
      case ARCH.RETIREE:
        start(home, ACT.HOME);
        if (!quiet && rnd() < 0.55) {
          if (go(near(home, 'park'), ACT.LEISURE, 500 + rnd() * 110, 35 + rnd() * 50)) go(home, ACT.HOME, 0, 30);
        }
        leisureDay(id, home, dow, { wake: 660, out: 0.45, second: 0.15, evening: 0.04 });
        break;
      case ARCH.GANG: {
        start(home, ACT.HOME);
        const spots = city.districts[B[census.home[id]].district].hangouts;
        if (!spots.length || quiet) { leisureDay(id, home, dow, { wake: 660, out: 0.7, second: 0.3, evening: 0.3 }); break; }
        const hang = spots[hp % spots.length];
        go(hang, ACT.HANG, 810 + rnd() * 90, 170 + rnd() * 70);
        if (rnd() < 0.5) go(near(hang, 'eat'), ACT.EAT, 0, 30 + rnd() * 30); else go(home, ACT.HOME, 0, 60);
        go(spots[(hp + (hd & 1)) % spots.length], ACT.HANG, 1200 + rnd() * 40, 150 + rnd() * 60);
        break;
      }
      case ARCH.HOMELESS: {
        // a pavement spot by day, a park or a church doorway by night
        const spot = ps && ps.spot >= 0 ? ps.spot : home;
        const nights = city.near('park', spot).concat(city.near('church', spot));
        const night = nights.length ? nights[hp % Math.min(2, nights.length)] : spot;
        walkLimit = 1e9;
        start(night, ACT.STREET, 400 + rnd() * 40);
        endPlace = night; endKind = ACT.STREET;
        go(spot, ACT.STREET, 0, 0);
        stayUntil(710 + rnd() * 40);
        if (go(near(spot, 'church'), ACT.EAT, 0, 35 + rnd() * 20)) go(spot, ACT.STREET, 0, 0);
        stayUntil(1180 + rnd() * 50);
        break;
      }
      case ARCH.TOURIST: {
        start(home, ACT.HOME);
        hasCar = 1; walkLimit = 1000; // taxis
        const sights = city.categories.sights;
        if (quiet || !sights.length) break;
        go(near(home, 'outdoors'), ACT.LEISURE, 570 + rnd() * 90, 80 + rnd() * 110);
        go(near(here(), 'eat'), ACT.EAT, 0, 40 + rnd() * 30);
        if (rnd() < 0.6) {
          const b = sights[Math.floor(rnd() * sights.length)];
          go(b, B[b].kind === 'shop' ? ACT.SHOP : ACT.LEISURE, 0, 50 + rnd() * 90);
        }
        go(home, ACT.HOME, 0, 60 + rnd() * 60);
        if (rnd() < 0.7 * w.nightFactor(B[home].district)) {
          if (go(near(home, 'eat'), ACT.EAT, 1140 + rnd() * 60, 60 + rnd() * 30) && rnd() < 0.5) go(near(here(), 'drink'), ACT.DRINK, 0, 50 + rnd() * 70);
        }
        break;
      }
      default:
        start(home, ACT.HOME);
        leisureDay(id, home, dow, { wake: 570, out: 0.75, second: 0.35, evening: 0.22 });
    }
    // revenge: an evening spent looking for the player where he is usually seen
    if (ps && ps.flags & FLAG.HOSTILE && endPlace === home && arch !== ARCH.HOMELESS && ps.hurtUntil <= t0 && free < 1230) {
      const spots = w.hauntSpots();
      if (spots.length) go(spots[hp % spots.length], ACT.HANG, Math.max(free + 20, 1080 + rnd() * 60), 80 + rnd() * 60);
    }
    if (here() !== endPlace) go(endPlace, endKind, 0, 0, true);
    S.depart[S.n - 1] = DAY;
    return S;
  }

  /** A person's day as a list of stops, for reading and for tests. */
  function plan(id, day) {
    const p = build(id, day), out = [];
    for (let i = 0; i < p.n; i++) {
      out.push({ place: p.place[i], kind: p.kind[i], arrive: p.arrive[i], depart: p.depart[i], mode: i < p.n - 1 ? p.mode[i] : 0 });
    }
    return out;
  }

  return { build, plan };
}
