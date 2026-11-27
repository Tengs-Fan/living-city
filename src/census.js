// The census: who lives and works in the city.
//
// Generated once from the seed and never saved: a save only stores what play changed.
// Method, after the synthetic populations of transport modelling: fill the homes with
// households, link some families across households, then give each worker a workplace by a
// distance-weighted choice. Jobs that residents do not fill go to commuters from off the
// map, and hotel beds to tourists.
//
// Records are flat typed arrays indexed by person id. Ids run residents first, then
// commuters, then tourists.

import { makeRng, hash2 } from './rng.js';
import { FIRST_M, FIRST_F, LAST } from './names.js';

export const ARCH = { WORKER: 0, STUDENT: 1, RETIREE: 2, IDLE: 3, GANG: 4, HOMELESS: 5, COMMUTER: 6, TOURIST: 7 };
export const ARCH_NAMES = ['worker', 'student', 'retired', 'not working', 'gang member', 'homeless', 'commuter', 'tourist'];
export const TRAIT = { BRAVE: 1, NERVOUS: 2, SOCIABLE: 4, ARMS: 8 };

// [single, couple, couple + grown children, one parent + grown child, flatmates, three generations]
const HOUSEHOLD_MIX = {
  suburb: [12, 40, 25, 10, 5, 8],
  affluent: [10, 50, 28, 6, 0, 6],
  midrise: [32, 32, 10, 10, 14, 2],
  tenement: [26, 22, 14, 20, 12, 6],
  oldtown: [40, 30, 4, 8, 18, 0],
  campus: [35, 10, 0, 0, 55, 0],
  downtown: [50, 38, 0, 2, 10, 0],
  beachfront: [35, 40, 8, 7, 10, 0],
  industrial: [40, 30, 5, 10, 15, 0],
};
const EMPLOYED = { suburb: 0.76, affluent: 0.74, midrise: 0.78, tenement: 0.6, oldtown: 0.78, campus: 0.6, downtown: 0.86, beachfront: 0.72, industrial: 0.7 };
const CAR = { suburb: 0.86, affluent: 0.96, midrise: 0.5, tenement: 0.3, oldtown: 0.36, campus: 0.2, downtown: 0.4, beachfront: 0.5, industrial: 0.5 };

// Who works where. `lead` roles are filled first, so every bank has guards and they are
// residents whenever any resident works there.
const JOBS = {
  office: { lead: ['manager', 'receptionist'], pool: ['accountant', 'analyst', 'clerk', 'lawyer', 'designer', 'engineer', 'paralegal', 'salesperson'], collar: 'white' },
  bank: { lead: ['security guard', 'security guard', 'security guard', 'branch manager'], pool: ['teller', 'teller', 'loan officer', 'clerk'], collar: 'white' },
  cityhall: { lead: ['security guard', 'receptionist'], pool: ['clerk', 'planner', 'inspector', 'councillor\'s aide', 'archivist'], collar: 'white' },
  university: { lead: ['janitor', 'librarian'], pool: ['lecturer', 'researcher', 'administrator', 'technician'], collar: 'white' },
  hospital: { lead: ['doctor', 'porter'], pool: ['nurse', 'nurse', 'doctor', 'cleaner', 'paramedic', 'orderly'], collar: 'white' },
  police: { lead: ['desk sergeant', 'detective'], pool: ['police officer', 'police officer', 'police officer', 'detective', 'dispatcher'], collar: 'service' },
  shop: { lead: ['shopkeeper'], pool: ['shop assistant', 'cashier', 'stock clerk'], collar: 'service' },
  restaurant: { lead: ['chef', 'head waiter'], pool: ['cook', 'waiter', 'waiter', 'dishwasher'], collar: 'service' },
  bar: { lead: ['bartender', 'bouncer'], pool: ['bartender', 'barback', 'waiter'], collar: 'service' },
  gym: { lead: ['manager'], pool: ['trainer', 'receptionist', 'cleaner'], collar: 'service' },
  hotel: { lead: ['concierge', 'night porter'], pool: ['receptionist', 'housekeeper', 'housekeeper', 'porter', 'cook'], collar: 'service' },
  church: { lead: ['priest'], pool: ['caretaker'], collar: 'service' },
  shelter: { lead: ['warden'], pool: ['support worker', 'cook'], collar: 'service' },
  factory: { lead: ['foreman'], pool: ['machinist', 'machinist', 'assembler', 'forklift driver', 'welder'], collar: 'blue' },
  warehouse: { lead: ['foreman', 'security guard'], pool: ['docker', 'forklift driver', 'packer', 'crane operator'], collar: 'blue' },
  station: { lead: ['station master'], pool: ['ticket clerk', 'guard', 'cleaner', 'signaller'], collar: 'blue' },
  pier: { lead: ['pier manager'], pool: ['stallholder', 'ride attendant', 'lifeguard'], collar: 'service' },
};
const COLLAR_BIAS = {
  affluent: { white: 3, blue: 0.3, service: 0.7 },
  suburb: { white: 1.5, blue: 1, service: 1 },
  tenement: { white: 0.5, blue: 2, service: 1.4 },
};

export const ROLE_NAMES = ['none', 'student'];
const roleIndex = new Map(ROLE_NAMES.map((r, i) => [r, i]));
for (const k in JOBS) {
  for (const r of [...JOBS[k].lead, ...JOBS[k].pool]) {
    if (!roleIndex.has(r)) { roleIndex.set(r, ROLE_NAMES.length); ROLE_NAMES.push(r); }
  }
}
export const ROLE_GUARD = roleIndex.get('security guard');

const WEEKEND = (1 << 5) | (1 << 6); // day 0 is a Monday

/** Shift for a job slot: [start minute, length in minutes]. A shift may run past midnight. */
function shiftFor(kind, slot, rng) {
  switch (kind) {
    case 'office': case 'cityhall': case 'university': return [480 + 15 * rng.int(7), 510];
    case 'bank': return slot < 3 ? [480, 540] : [525, 495];
    case 'shop': case 'gym': return rng.chance(0.6) ? [540, 480] : [720, 480];
    case 'restaurant': return rng.chance(0.5) ? [630, 480] : [960, 465];
    case 'bar': return [1020, 510];
    case 'factory': { const r = rng(); return r < 0.5 ? [360, 480] : r < 0.85 ? [840, 480] : [1320, 480]; }
    case 'warehouse': return rng.chance(0.7) ? [420, 510] : [1320, 480];
    case 'hospital': case 'police': case 'station': return [[420, 480], [900, 480], [1380, 480]][slot % 3];
    case 'hotel': { const r = rng(); return r < 0.45 ? [420, 480] : r < 0.8 ? [900, 480] : [1380, 480]; }
    default: return [540, 480];
  }
}

export function generateCensus(city, { seed = city.seed, vacancy = 0.04, commuters = 0.9, occupancy = 0.6 } = {}) {
  const rng = makeRng(hash2(seed, 0xce5));
  const { buildings, districts } = city;

  const home = [], hh = [], age = [], sex = [], first = [], last = [], partner = [], parentA = [], parentB = [];
  const hhRole = []; // 0 adult, 1 grown child at home, 2 elder
  const hhFirst = [], hhSize = [], hhHome = [], hhCar = [];

  const add = (b, h, a, s, l, role) => {
    const id = home.length;
    home.push(b); hh.push(h); age.push(Math.max(18, Math.min(95, Math.round(a)))); sex.push(s);
    first.push(rng.int(s ? FIRST_F.length : FIRST_M.length)); last.push(l);
    partner.push(-1); parentA.push(-1); parentB.push(-1); hhRole.push(role);
    return id;
  };
  const anyAge = () => (rng.chance(0.84) ? 20 + rng.int(47) : 67 + rng.int(22));
  const couple = (b, h, a, l, role = 0) => {
    const s = rng.int(2);
    const p = add(b, h, a, s, l, role);
    const q = add(b, h, a + rng.range(-6, 6), rng.chance(0.92) ? 1 - s : s, rng.chance(0.75) ? l : rng.int(LAST.length), role);
    partner[p] = q; partner[q] = p;
    return [p, q];
  };

  // --- households fill the homes ---------------------------------------------------------
  for (const b of buildings) {
    if (!b.homes) continue;
    const dk = districts[b.district].kind;
    const mix = HOUSEHOLD_MIX[dk] ?? HOUSEHOLD_MIX.midrise;
    for (let unit = 0; unit < b.homes; unit++) {
      if (rng.chance(vacancy)) continue;
      const h = hhFirst.length, start = home.length, l = rng.int(LAST.length);
      switch (rng.weighted(mix)) {
        case 0: add(b.id, h, dk === 'campus' ? 19 + rng.int(9) : dk === 'affluent' ? 34 + rng.int(46) : anyAge(), rng.int(2), l, 0); break;
        case 1: couple(b.id, h, dk === 'campus' ? 21 + rng.int(8) : anyAge(), l); break;
        case 2: {
          const [p, q] = couple(b.id, h, 46 + rng.int(26), l);
          const youngest = Math.min(age[p], age[q]);
          for (let k = rng.irange(1, 2); k > 0; k--) {
            const c = add(b.id, h, 18 + rng.int(Math.max(1, Math.min(15, youngest - 19 - 18))), rng.int(2), last[p], 1);
            parentA[c] = p; parentB[c] = q;
          }
          break;
        }
        case 3: {
          const p = add(b.id, h, 46 + rng.int(36), rng.chance(0.7) ? 1 : 0, l, 2);
          for (let k = rng.chance(0.8) ? 1 : 2; k > 0; k--) {
            const c = add(b.id, h, 18 + rng.int(Math.max(1, Math.min(27, age[p] - 20 - 18))), rng.int(2), l, 1);
            parentA[c] = p;
          }
          hhRole[p] = age[p] >= 58 ? 2 : 0;
          break;
        }
        case 4:
          for (let k = rng.irange(2, 4); k > 0; k--) add(b.id, h, 19 + rng.int(16), rng.int(2), rng.int(LAST.length), 0);
          break;
        default: {
          const [p, q] = couple(b.id, h, 28 + rng.int(27), l);
          const child = rng.chance(0.5) ? p : q;
          const elder = add(b.id, h, age[child] + 22 + rng.int(9), rng.chance(0.7) ? 1 : 0, last[child], 2);
          parentA[child] = elder;
        }
      }
      hhFirst.push(start); hhSize.push(home.length - start); hhHome.push(b.id);
      hhCar.push(rng.chance(CAR[dk] ?? 0.5) ? 1 : 0);
    }
  }
  const R = home.length;

  // --- family across households: a grown child in one home, a parent in another -------------
  const byAge = Array.from({ length: 100 }, () => []);
  const childCount = new Uint8Array(R);
  for (let id = 0; id < R; id++) {
    if (age[id] >= 40) byAge[age[id]].push(id);
    if (parentA[id] >= 0) childCount[parentA[id]]++;
    if (parentB[id] >= 0) childCount[parentB[id]]++;
  }
  const rename = (id, to) => {
    const from = last[id], h = hh[id];
    for (let m = hhFirst[h]; m < hhFirst[h] + hhSize[h]; m++) if (last[m] === from) last[m] = to;
  };
  for (let id = 0; id < R; id++) {
    if (parentA[id] >= 0 || age[id] > 50 || !rng.chance(0.42)) continue;
    const bucket = byAge[Math.min(95, age[id] + 20 + rng.int(18))];
    if (!bucket.length) continue;
    const p = bucket[rng.int(bucket.length)];
    if (hh[p] === hh[id] || childCount[p] >= 3 || parentA[p] === id) continue;
    parentA[id] = p; childCount[p]++;
    const q = partner[p];
    if (q >= 0 && age[q] - age[id] >= 18) { parentB[id] = q; childCount[q]++; }
    rename(id, last[q >= 0 && sex[q] === 0 ? q : p]);
  }

  // --- what each resident does ---------------------------------------------------------
  const arch = new Uint8Array(R), traits = new Uint8Array(R), car = new Uint8Array(R);
  const universities = city.byKind.university ?? [];
  for (let id = 0; id < R; id++) {
    const d = districts[buildings[home[id]].district], dk = d.kind, a = age[id];
    car[id] = hhCar[hh[id]];
    let t = 0;
    const r = rng();
    if (r < 0.25) t |= TRAIT.BRAVE; else if (r < 0.5) t |= TRAIT.NERVOUS;
    if (rng.chance(0.4)) t |= TRAIT.SOCIABLE;
    if (rng.chance(0.3)) t |= TRAIT.ARMS;
    traits[id] = t;
    let employed = EMPLOYED[dk] ?? 0.7;
    if (hhRole[id] === 2) employed = 0.18; else if (hhRole[id] === 1) employed = 0.86;
    if (a >= 67) arch[id] = rng.chance(0.06) ? ARCH.WORKER : ARCH.RETIREE;
    else if (universities.length && ((dk === 'campus' && a <= 26 && rng.chance(0.75)) || (a <= 23 && rng.chance(0.2)))) arch[id] = ARCH.STUDENT;
    else if (d.gang && a <= 34 && rng.chance(sex[id] ? 0.04 : 0.14)) arch[id] = ARCH.GANG;
    else arch[id] = rng.chance(employed) ? ARCH.WORKER : ARCH.IDLE;
  }

  // --- jobs: a distance-weighted choice among workplaces with room ---------------------------
  const workplaces = buildings.filter((b) => b.jobs > 0 && JOBS[b.kind]);
  const cum = new Float64Array(workplaces.length);
  let totalJobs = 0;
  workplaces.forEach((b, i) => { totalJobs += b.jobs; cum[i] = totalJobs; });
  const taken = new Int32Array(buildings.length);
  const work = [], shiftStart = [], shiftLen = [], daysOff = [], role = [];
  for (let id = 0; id < R; id++) { work.push(-1); shiftStart.push(0); shiftLen.push(0); daysOff.push(0); role.push(0); }

  const employ = (id, b) => {
    const slot = taken[b.id]++;
    const J = JOBS[b.kind];
    const [s, l] = shiftFor(b.kind, slot, rng);
    work[id] = b.id; shiftStart[id] = s; shiftLen[id] = l;
    role[id] = roleIndex.get(slot < J.lead.length ? J.lead[slot] : J.pool[rng.int(J.pool.length)]);
    if (J.collar === 'white' && b.kind !== 'hospital') daysOff[id] = WEEKEND;
    else {
      const a = rng.int(7);
      daysOff[id] = (1 << a) | (1 << ((a + 1 + rng.int(6)) % 7));
    }
  };
  const sampleWorkplace = () => {
    const r = rng() * totalJobs;
    let lo = 0, hi = workplaces.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] > r) hi = mid; else lo = mid + 1; }
    return workplaces[lo];
  };
  const order = [];
  for (let id = 0; id < R; id++) if (arch[id] === ARCH.WORKER) order.push(id);
  for (let i = order.length - 1; i > 0; i--) { const j = rng.int(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  const cand = [], weight = [];
  for (const id of order) {
    const H = buildings[home[id]];
    const bias = COLLAR_BIAS[districts[H.district].kind];
    cand.length = weight.length = 0;
    for (let k = 0; k < 14; k++) {
      const b = sampleWorkplace();
      if (taken[b.id] >= b.jobs) continue;
      const d = Math.hypot(b.doorX - H.doorX, b.doorY - H.doorY);
      cand.push(b);
      weight.push(Math.exp(-d / 1400) * (bias ? bias[JOBS[b.kind].collar] : 1));
    }
    if (cand.length) employ(id, cand[rng.weighted(weight)]);
    else arch[id] = ARCH.IDLE;
  }
  for (let id = 0; id < R; id++) {
    if (arch[id] !== ARCH.STUDENT) continue;
    const H = buildings[home[id]];
    const w = universities.map((u) => Math.exp(-Math.hypot(buildings[u].doorX - H.doorX, buildings[u].doorY - H.doorY) / 1200));
    work[id] = universities[rng.weighted(w)];
    shiftStart[id] = 540 + 30 * rng.int(5); shiftLen[id] = 240 + 30 * rng.int(5);
    daysOff[id] = WEEKEND; role[id] = 1;
  }

  // --- visitors: commuters take the jobs residents left, tourists take the hotel beds ---------
  const gateways = buildings.filter((b) => b.kind === 'gateway');
  const station = buildings.find((b) => b.kind === 'station');
  const visitor = (homeId, a, archetype, hasCar) => {
    const id = add(homeId, -1, a, rng.int(2), rng.int(LAST.length), 0);
    work.push(-1); shiftStart.push(0); shiftLen.push(0); daysOff.push(0); role.push(0);
    visitorArch.push(archetype); visitorCar.push(hasCar);
    visitorTraits.push((rng.chance(0.25) ? TRAIT.BRAVE : rng.chance(0.33) ? TRAIT.NERVOUS : 0) | (rng.chance(0.4) ? TRAIT.SOCIABLE : 0) | (rng.chance(0.3) ? TRAIT.ARMS : 0));
    return id;
  };
  const visitorArch = [], visitorCar = [], visitorTraits = [];
  if (gateways.length || station) {
    for (const b of workplaces) {
      const n = Math.round((b.jobs - taken[b.id]) * commuters);
      for (let k = 0; k < n; k++) {
        let g = null;
        if (station && rng.chance(Math.hypot(b.doorX - station.doorX, b.doorY - station.doorY) < 1500 ? 0.45 : 0.22)) g = station;
        else if (gateways.length) {
          const g1 = rng.pick(gateways), g2 = rng.pick(gateways);
          g = Math.hypot(g1.doorX - b.doorX, g1.doorY - b.doorY) < Math.hypot(g2.doorX - b.doorX, g2.doorY - b.doorY) ? g1 : g2;
        } else g = station;
        employ(visitor(g.id, 20 + rng.int(46), ARCH.COMMUTER, g === station ? 0 : 1), b);
      }
    }
  }
  const C = home.length - R;
  for (const b of buildings) {
    if (!b.guests) continue;
    for (let k = Math.round(b.guests * occupancy); k > 0; k--) visitor(b.id, 22 + rng.int(50), ARCH.TOURIST, 0);
  }
  const N = home.length, T = N - R - C;

  const A = {
    home: Int32Array.from(home), work: Int32Array.from(work), hh: Int32Array.from(hh),
    shiftStart: Int16Array.from(shiftStart), shiftLen: Int16Array.from(shiftLen), daysOff: Uint8Array.from(daysOff),
    age: Uint8Array.from(age), sex: Uint8Array.from(sex), role: Uint8Array.from(role),
    first: Uint16Array.from(first), last: Uint16Array.from(last),
    partner: Int32Array.from(partner), parentA: Int32Array.from(parentA), parentB: Int32Array.from(parentB),
    arch: new Uint8Array(N), traits: new Uint8Array(N), car: new Uint8Array(N),
  };
  A.arch.set(arch); A.traits.set(traits); A.car.set(car);
  A.arch.set(visitorArch, R); A.traits.set(visitorTraits, R); A.car.set(visitorCar, R);

  // --- indexes ---------------------------------------------------------------------------
  const csr = (n, keyOf, count) => {
    const start = new Int32Array(n + 1);
    for (let i = 0; i < count; i++) { const k = keyOf(i); if (k >= 0) start[k + 1]++; }
    for (let i = 0; i < n; i++) start[i + 1] += start[i];
    const pos = start.slice(0, n), list = new Int32Array(start[n]);
    for (let i = 0; i < count; i++) { const k = keyOf(i); if (k >= 0) list[pos[k]++] = i; }
    return { start, list, of: (k) => list.subarray(start[k], start[k + 1]) };
  };
  const staff = csr(buildings.length, (id) => (A.arch[id] === ARCH.STUDENT ? -1 : A.work[id]), N);
  const lodgers = csr(buildings.length, (id) => (id < R || A.arch[id] === ARCH.TOURIST ? A.home[id] : -1), N);
  const kidsA = csr(R, (id) => A.parentA[id], R), kidsB = csr(R, (id) => A.parentB[id], R);
  const HF = Int32Array.from(hhFirst), HS = Uint8Array.from(hhSize), HH = Int32Array.from(hhHome);

  const firstName = (id) => (A.sex[id] ? FIRST_F : FIRST_M)[A.first[id]];
  const name = (id) => `${firstName(id)} ${LAST[A.last[id]]}`;
  const childrenOf = (id) => (id < R ? [...kidsA.of(id), ...kidsB.of(id)] : []);

  /** The people of one home. A visitor's household is himself. */
  const household = (id) => {
    const h = A.hh[id];
    if (h < 0) return [id];
    const out = [];
    for (let m = HF[h]; m < HF[h] + HS[h]; m++) out.push(m);
    return out;
  };

  /**
   * Everyone tied to a person, with the relation as he would say it ("mother", "son").
   * `closeness` is 1 for partner, parents and children, less for the rest.
   */
  const relatives = (id) => {
    const out = [], seen = new Set([id]);
    const push = (other, rel, closeness) => {
      if (other < 0 || seen.has(other)) return;
      seen.add(other);
      out.push({ id: other, rel, closeness });
    };
    if (id >= R) return out;
    const p = A.partner[id];
    if (p >= 0) push(p, A.sex[p] ? 'wife' : 'husband', 1);
    for (const q of [A.parentA[id], A.parentB[id]]) if (q >= 0) push(q, A.sex[q] ? 'mother' : 'father', 1);
    for (const c of childrenOf(id)) push(c, A.sex[c] ? 'daughter' : 'son', 1);
    for (const q of [A.parentA[id], A.parentB[id]]) {
      if (q < 0) continue;
      for (const s of childrenOf(q)) push(s, A.sex[s] ? 'sister' : 'brother', 0.7);
    }
    if (p >= 0) for (const q of [A.parentA[p], A.parentB[p]]) if (q >= 0) push(q, A.sex[q] ? 'mother-in-law' : 'father-in-law', 0.5);
    for (const c of childrenOf(id)) if (A.partner[c] >= 0) push(A.partner[c], A.sex[A.partner[c]] ? 'daughter-in-law' : 'son-in-law', 0.5);
    for (const m of household(id)) push(m, 'flatmate', 0.3);
    return out;
  };

  return {
    ...A, n: N, residents: R, commuters: C, tourists: T,
    households: HF.length, hhFirst: HF, hhSize: HS, hhHome: HH, taken,
    firstName, name, lastName: (id) => LAST[A.last[id]],
    roleName: (id) => ROLE_NAMES[A.role[id]],
    isVisitor: (id) => id >= R,
    household, relatives, childrenOf,
    /** People employed at a building, residents first. */
    staffOf: (b) => staff.of(b),
    /** People who sleep in a building: its residents, or a hotel's guests. */
    lodgersOf: (b) => lodgers.of(b),
    /** True if the person's job has him working the shift that starts on `day`. */
    rostered: (id, day) => A.work[id] >= 0 && !((A.daysOff[id] >> (((day % 7) + 7) % 7)) & 1),
  };
}
