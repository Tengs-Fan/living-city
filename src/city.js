// The city generator: a street graph, districts and buildings from a seed.
//
// The design's first milestone suggests a real street map from OpenStreetMap and lists
// "a generated grid city would get to M3 sooner" as an open question. This is the generated
// city. Everything downstream only needs what this module returns (nodes, edges, buildings
// with a door on a street), so an imported map can replace it later.
//
// Units are metres. x grows east, y grows south; the sea is to the south.

import { makeRng, hash2 } from './rng.js';
import { STREETS, LAST, ordinal } from './names.js';

// District seeds in normalised coordinates (u east, v south). A block belongs to the
// nearest seed; the weight stretches a district's reach.
const DISTRICT_SEEDS = [
  { name: 'Centro', kind: 'downtown', u: 0.5, v: 0.5, w: 1.05 },
  { name: 'Old Quarter', kind: 'oldtown', u: 0.34, v: 0.62, w: 0.95 },
  { name: 'Northbank', kind: 'midrise', u: 0.5, v: 0.2, w: 1.0 },
  { name: 'Ironbridge', kind: 'midrise', u: 0.71, v: 0.4, w: 0.95 },
  { name: 'The Flats', kind: 'tenement', u: 0.7, v: 0.72, w: 0.86, gang: 'the Flats Crew' },
  { name: 'Eastdock', kind: 'industrial', u: 0.93, v: 0.62, w: 1.1 },
  { name: 'Saltmarsh', kind: 'industrial', u: 0.9, v: 0.2, w: 0.9 },
  { name: 'Collegetown', kind: 'campus', u: 0.27, v: 0.33, w: 0.9 },
  { name: 'Marlowe Heights', kind: 'affluent', u: 0.08, v: 0.14, w: 1.0 },
  { name: 'Westvale', kind: 'suburb', u: 0.08, v: 0.6, w: 1.1 },
  { name: 'Fairmount', kind: 'suburb', u: 0.72, v: 0.06, w: 0.9 },
  { name: 'Linden Park', kind: 'suburb', u: 0.3, v: 0.05, w: 0.9 },
  { name: 'Costa Brisa', kind: 'beachfront', u: 0.5, v: 1.2, w: 1.22 },
];

// How a block of each district kind is cut into lots, and what gets built on them.
const RECIPES = {
  downtown: { layouts: [[2, 1], [2, 2], [1, 1], [2, 2]], park: 0.04,
    mix: { office: 54, tower: 9, hotel: 6, shop: 11, restaurant: 9, bar: 5, bank: 4, gym: 2 } },
  oldtown: { layouts: [[3, 2]], park: 0.03,
    mix: { apartment: 50, shop: 17, restaurant: 12, bar: 10, office: 6, gym: 2, church: 3 } },
  midrise: { layouts: [[3, 2], [4, 2]], park: 0.04,
    mix: { apartment: 68, shop: 10, restaurant: 5, bar: 4, gym: 2, office: 4, house: 5, church: 2 } },
  tenement: { layouts: [[4, 2]], park: 0.02,
    mix: { apartment: 76, shop: 9, bar: 7, factory: 4, church: 2, restaurant: 2 } },
  suburb: { layouts: [[5, 2], [6, 2]], park: 0.035,
    mix: { house: 91, shop: 4, church: 1, restaurant: 2, gym: 1, bar: 1 } },
  affluent: { layouts: [[3, 2], [4, 2]], park: 0.05,
    mix: { house: 92, restaurant: 3, shop: 3, gym: 2 } },
  industrial: { layouts: [[2, 1], [1, 1], [2, 2]], park: 0,
    mix: { factory: 38, warehouse: 46, office: 8, bar: 4, shop: 4 } },
  beachfront: { layouts: [[3, 2]], park: 0.02,
    mix: { hotel: 20, apartment: 30, restaurant: 17, bar: 14, shop: 14, gym: 5 } },
  campus: { layouts: [[2, 2], [3, 2]], park: 0.05,
    mix: { university: 7, apartment: 62, bar: 10, shop: 10, restaurant: 9, gym: 2 } },
};

const APARTMENT_HOMES = {
  oldtown: [4, 10], midrise: [5, 12], tenement: [6, 14], beachfront: [5, 12],
  campus: [6, 14], downtown: [8, 16], suburb: [3, 6], affluent: [3, 6], industrial: [4, 8],
};

const BASE_PROSPERITY = {
  downtown: 0.8, oldtown: 0.62, midrise: 0.6, tenement: 0.32, suburb: 0.7,
  affluent: 0.92, industrial: 0.45, beachfront: 0.76, campus: 0.6,
};

/** Kinds where people stand in the open and can be seen, rather than being "inside". */
export const OUTDOOR_KINDS = new Set(['park', 'beach', 'pier']);

/** Kinds a plan can go to, by purpose. */
export const PLACE_CATEGORIES = {
  eat: ['restaurant'],
  drink: ['bar'],
  shop: ['shop'],
  outdoors: ['park', 'beach', 'pier'],
  park: ['park'],
  gym: ['gym'],
  church: ['church'],
  university: ['university'],
  sights: ['pier', 'beach', 'park', 'shop'],
};

const BANKS = ['First Meridian Bank', 'Halcyon Savings', 'Coastal Trust', 'Harbour Union Bank',
  'Bay Mutual', 'Centro Credit', 'Saltmarsh & Lowe', 'Ironbridge Building Society'];
const BAR_A = ['Blue', 'Rusty', 'Golden', 'Last', 'Lucky', 'Crooked', 'Silver', 'Salty', 'Quiet', 'Red'];
const BAR_B = ['Anchor', 'Gull', 'Lantern', 'Parrot', 'Compass', 'Barrel', 'Heron', 'Tide', 'Fox', 'Lamp'];
const HOTELS = ['Miramar', 'Halcyon', 'Corsair', 'Soledad', 'Atlantic', 'Belvedere', 'Riviera', 'Marisol',
  'Grand Pacific', 'Coral', 'Alcazar', 'Seabright'];

function capacity(kind, dk, rng, big) {
  switch (kind) {
    case 'house': return { homes: 1 };
    case 'apartment': { const [a, b] = APARTMENT_HOMES[dk] ?? [5, 12]; return { homes: rng.irange(a, b) }; }
    case 'tower': return { homes: rng.irange(50, 110) };
    case 'office': return { jobs: dk === 'downtown' ? Math.round(rng.irange(35, 120) * big) : rng.irange(10, 36) };
    case 'bank': return { jobs: rng.irange(14, 24) };
    case 'shop': return { jobs: rng.irange(3, 10) };
    case 'restaurant': return { jobs: rng.irange(6, 14) };
    case 'bar': return { jobs: rng.irange(4, 9) };
    case 'gym': return { jobs: rng.irange(4, 8) };
    case 'church': return { jobs: 2 };
    case 'hotel': return { jobs: rng.irange(25, 60), guests: rng.irange(30, 100) };
    case 'factory': return { jobs: Math.round(rng.irange(12, 44) * Math.sqrt(big)) };
    case 'warehouse': return { jobs: Math.round(rng.irange(6, 22) * Math.sqrt(big)) };
    case 'university': return { jobs: rng.irange(40, 90) };
    default: return {};
  }
}

function pickKind(mix, rng) {
  let total = 0;
  for (const k in mix) total += mix[k];
  let r = rng() * total;
  for (const k in mix) {
    r -= mix[k];
    if (r < 0) return k;
  }
  return Object.keys(mix)[0];
}

/**
 * Generate a city.
 * @param {object} [opts]
 * @param {number} [opts.seed]
 * @param {number} [opts.cols]   blocks east-west (40 gives a GTA 5-scale city)
 * @param {number} [opts.rows]   blocks north-south
 * @param {number} [opts.homes]  multiplier on homes per building
 * @param {number} [opts.jobs]   multiplier on jobs per building
 */
export function generateCity({ seed = 1, cols = 40, rows = 30, homes = 1, jobs = 1 } = {}) {
  const rng = makeRng(hash2(seed, 0xc17));
  const blockW = 104, blockH = 86;
  const nx = cols + 1, ny = rows + 1, nn = nx * ny;
  const W = cols * blockW, H = rows * blockH;

  // --- street graph: a warped grid whose southern edge follows the coast ---------------
  const X = new Float32Array(nn), Y = new Float32Array(nn);
  const south = (u) => H * (0.93 + 0.05 * Math.sin(u * 4.1 + 0.5) + 0.025 * Math.sin(u * 9.7 + 2));
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const u = i / cols, v = j / rows, n = j * nx + i;
      X[n] = u * W + 70 * Math.sin(v * 2.6 + 0.3) + rng.range(-4, 4);
      Y[n] = v * south(u) + rng.range(-3, 3);
    }
  }
  const node = (i, j) => j * nx + i;
  const hEdge = (i, j) => j * cols + i;
  const vEdge = (i, j) => ny * cols + j * nx + i;
  const ne = ny * cols + rows * nx;
  const EA = new Uint16Array(ne), EB = new Uint16Array(ne), EL = new Float32Array(ne), EK = new Uint8Array(ne);
  const edgeNames = new Array(ne);
  const streetName = (j) => (j === rows ? 'Ocean Drive' : `${STREETS[j % STREETS.length]} Street`);
  const avenueName = (i) => `${ordinal(i + 1)} Avenue`;
  const setEdge = (e, a, b, major, name) => {
    EA[e] = a; EB[e] = b; EK[e] = major ? 1 : 0;
    EL[e] = Math.hypot(X[a] - X[b], Y[a] - Y[b]);
    edgeNames[e] = name;
  };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < cols; i++) setEdge(hEdge(i, j), node(i, j), node(i + 1, j), j % 5 === 0 || j === rows, streetName(j));
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < nx; i++) setEdge(vEdge(i, j), node(i, j), node(i, j + 1), i % 5 === 0, avenueName(i));
  }
  // adjacency in compressed rows
  const deg = new Uint32Array(nn + 1);
  for (let e = 0; e < ne; e++) { deg[EA[e] + 1]++; deg[EB[e] + 1]++; }
  for (let n = 0; n < nn; n++) deg[n + 1] += deg[n];
  const adjStart = deg.slice();
  const fill = deg.slice(0, nn);
  const adjNode = new Uint16Array(ne * 2), adjEdge = new Uint32Array(ne * 2);
  for (let e = 0; e < ne; e++) {
    adjNode[fill[EA[e]]] = EB[e]; adjEdge[fill[EA[e]]++] = e;
    adjNode[fill[EB[e]]] = EA[e]; adjEdge[fill[EB[e]]++] = e;
  }

  // --- districts -----------------------------------------------------------------------
  const districts = DISTRICT_SEEDS.map((s, id) => ({
    id, name: s.name, kind: s.kind, gang: s.gang ?? null,
    baseProsperity: BASE_PROSPERITY[s.kind], cx: 0, cy: 0, blocks: 0, hangouts: [],
  }));
  const blockDistrict = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const u = (i + 0.5) / cols, v = (j + 0.5) / rows;
      let best = 0, bestD = Infinity;
      for (let d = 0; d < DISTRICT_SEEDS.length; d++) {
        const s = DISTRICT_SEEDS[d];
        const du = (u - s.u) * (W / H), dv = v - s.v;
        const dist = (du * du + dv * dv) / (s.w * s.w);
        if (dist < bestD) { bestD = dist; best = d; }
      }
      blockDistrict[j * cols + i] = best;
      const dd = districts[best];
      dd.blocks++;
      dd.cx += (X[node(i, j)] + X[node(i + 1, j + 1)]) / 2;
      dd.cy += (Y[node(i, j)] + Y[node(i + 1, j + 1)]) / 2;
    }
  }
  for (const d of districts) if (d.blocks) { d.cx /= d.blocks; d.cy /= d.blocks; }

  // --- special blocks, chosen before the lots are cut ------------------------------------
  const special = new Map();
  const nearestBlock = (u, v, accept) => {
    let best = -1, bestD = Infinity;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const b = j * cols + i;
        if (special.has(b) || !accept(districts[blockDistrict[b]].kind)) continue;
        const d = ((i + 0.5) / cols - u) ** 2 * (W / H) ** 2 + ((j + 0.5) / rows - v) ** 2;
        if (d < bestD) { bestD = d; best = b; }
      }
    }
    return best;
  };
  const claim = (what, u, v, accept) => {
    const b = nearestBlock(u, v, accept);
    if (b >= 0) special.set(b, what);
  };
  claim('station', 0.5, 0.4, (k) => k === 'downtown');
  claim('civic', 0.47, 0.5, (k) => k === 'downtown');
  claim('centralpark', 0.56, 0.56, (k) => k === 'downtown' || k === 'oldtown');
  claim('hospital', 0.5, 0.32, (k) => k === 'midrise' || k === 'oldtown');

  // --- buildings -------------------------------------------------------------------------
  const buildings = [];
  const P = (i, j, u, v, out, o) => {
    const a = node(i, j), b = node(i + 1, j), c = node(i, j + 1), d = node(i + 1, j + 1);
    const tx = X[a] + (X[b] - X[a]) * u, bx = X[c] + (X[d] - X[c]) * u;
    const ty = Y[a] + (Y[b] - Y[a]) * u, by = Y[c] + (Y[d] - Y[c]) * u;
    out[o] = tx + (bx - tx) * v;
    out[o + 1] = ty + (by - ty) * v;
  };
  const mu = 10 / blockW, mv = 10 / blockH; // half a street plus the pavement
  const tmp = [0, 0];
  let bankCount = 0, hotelCount = 0;

  /** Add a building on block (i, j) covering [u0,u1]x[v0,v1], with its door facing `face`. */
  const add = (kind, i, j, u0, u1, v0, v1, face, extra = {}) => {
    const poly = new Float32Array(8);
    P(i, j, u0, v0, poly, 0); P(i, j, u1, v0, poly, 2); P(i, j, u1, v1, poly, 4); P(i, j, u0, v1, poly, 6);
    let edge, t, du, dv;
    if (face === 'N') { edge = hEdge(i, j); t = (u0 + u1) / 2; du = t; dv = v0; }
    else if (face === 'S') { edge = hEdge(i, j + 1); t = (u0 + u1) / 2; du = t; dv = v1; }
    else if (face === 'W') { edge = vEdge(i, j); t = (v0 + v1) / 2; du = u0; dv = t; }
    else { edge = vEdge(i + 1, j); t = (v0 + v1) / 2; du = u1; dv = t; }
    P(i, j, du, dv, tmp, 0);
    const a = EA[edge], b = EB[edge];
    const id = buildings.length;
    const district = blockDistrict[j * cols + i];
    const number = (face === 'N' || face === 'S' ? i : j) * 100 + Math.round(t * 48) * 2 + (face === 'N' || face === 'W' ? 1 : 2);
    const bld = {
      id, kind, district, name: null,
      address: `${number} ${edgeNames[edge]}`, street: edgeNames[edge],
      poly, cx: (poly[0] + poly[2] + poly[4] + poly[6]) / 4, cy: (poly[1] + poly[3] + poly[5] + poly[7]) / 4,
      doorX: tmp[0], doorY: tmp[1],
      edge, t, streetX: X[a] + (X[b] - X[a]) * t, streetY: Y[a] + (Y[b] - Y[a]) * t,
      homes: 0, jobs: 0, guests: 0, outdoor: OUTDOOR_KINDS.has(kind), gateway: false,
      ...extra,
    };
    bld.homes = Math.round((bld.homes || 0) * homes);
    bld.jobs = Math.round((bld.jobs || 0) * jobs);
    buildings.push(bld);
    return bld;
  };

  const nameFor = (kind, bld) => {
    switch (kind) {
      case 'bank': return BANKS[bankCount++ % BANKS.length] + (bankCount > BANKS.length ? ` (${bld.street})` : '');
      case 'bar': return `The ${rng.pick(BAR_A)} ${rng.pick(BAR_B)}`;
      case 'restaurant': return `${rng.pick(LAST)}'s`;
      case 'hotel': return `Hotel ${HOTELS[hotelCount++ % HOTELS.length]}${hotelCount > HOTELS.length ? ' ' + Math.ceil(hotelCount / HOTELS.length) : ''}`;
      case 'factory': return `${rng.pick(LAST)} Works`;
      case 'warehouse': return `${rng.pick(LAST)} Freight`;
      case 'gym': return `${bld.street.split(' ')[0]} Gym`;
      case 'church': return `${rng.pick(['St. Brigid', 'St. Anselm', 'Holy Cross', 'Grace', 'St. Lucia', 'All Souls'])} Church`;
      case 'shop': return `${rng.pick(LAST)} ${rng.pick(['Grocery', 'Hardware', 'Pharmacy', 'Market', 'Books', 'Liquor', 'Clothing', 'Bakery'])}`;
      case 'university': return `Halcyon University, ${bld.street.split(' ')[0]} Hall`;
      case 'office': return `${rng.pick(LAST)} ${rng.pick(['& Partners', 'Insurance', 'Shipping', 'Associates', 'Holdings', 'Media', 'Engineering', 'Travel', 'Systems', 'Legal', 'Accounting', 'Architects'])}`;
      default: return null;
    }
  };

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const blk = j * cols + i;
      const district = districts[blockDistrict[blk]];
      const dk = district.kind;
      const sp = special.get(blk);
      const u0 = mu, u1 = 1 - mu, v0 = mv, v1 = 1 - mv;
      if (sp === 'station') {
        add('station', i, j, u0, u1, v0, v1, 'S', { jobs: 60, name: 'Central Station', gateway: true });
        continue;
      }
      if (sp === 'hospital') {
        add('hospital', i, j, u0, u1, v0, v1, 'S', { jobs: 520, name: 'Halcyon General Hospital' });
        continue;
      }
      if (sp === 'centralpark') {
        add('park', i, j, u0, u1, v0, v1, 'N', { name: 'Founders Park' });
        continue;
      }
      if (sp === 'civic') {
        add('cityhall', i, j, u0, 0.5 - 0.02, v0, v1, 'S', { jobs: 220, name: 'City Hall' });
        add('police', i, j, 0.5 + 0.02, u1, v0, v1, 'S', { jobs: 180, name: 'Police Headquarters' });
        continue;
      }
      const recipe = RECIPES[dk];
      if (rng.chance(recipe.park)) {
        add('park', i, j, u0, u1, v0, v1, rng.pick(['N', 'S']), { name: `${STREETS[(i * 7 + j * 3) % STREETS.length]} ${dk === 'downtown' ? 'Plaza' : 'Park'}` });
        continue;
      }
      const [lx, ly] = rng.pick(recipe.layouts);
      const big = 4 / (lx * ly);
      const gu = 2.5 / blockW, gv = 2.5 / blockH;
      for (let b = 0; b < ly; b++) {
        for (let a = 0; a < lx; a++) {
          const kind = pickKind(recipe.mix, rng);
          let a0 = u0 + ((u1 - u0) * a) / lx + gu, a1 = u0 + ((u1 - u0) * (a + 1)) / lx - gu;
          let b0 = v0 + ((v1 - v0) * b) / ly + gv, b1 = v0 + ((v1 - v0) * (b + 1)) / ly - gv;
          let face;
          if (ly === 2) face = b === 0 ? 'N' : 'S';
          else if (lx === 1) face = rng.pick(['N', 'S', 'E', 'W']);
          else face = rng.chance(0.5) ? (a === 0 ? 'W' : 'E') : rng.pick(['N', 'S']);
          if (kind === 'house') {
            // a house sits toward the street with a yard behind and gaps to the neighbours
            const wu = (a1 - a0) * 0.16, dv = (b1 - b0) * 0.38;
            a0 += wu; a1 -= wu;
            if (face === 'N') { b0 += 3 / blockH; b1 -= dv; } else { b1 -= 3 / blockH; b0 += dv; }
          }
          const bld = add(kind, i, j, a0, a1, b0, b1, face, capacity(kind, dk, rng, big));
          bld.name = nameFor(kind, bld);
        }
      }
    }
  }

  // --- the things a city must have at least one of --------------------------------------
  const convert = (toKind, n, districtKinds, fromKinds, extra) => {
    const have = buildings.filter((b) => b.kind === toKind && districtKinds.includes(districts[b.district].kind)).length;
    const pool = buildings.filter((b) => fromKinds.includes(b.kind) && districtKinds.includes(districts[b.district].kind));
    for (let k = have; k < n && pool.length; k++) {
      const b = pool.splice(rng.int(pool.length), 1)[0];
      b.kind = toKind;
      b.homes = 0; b.guests = 0;
      Object.assign(b, typeof extra === 'function' ? extra(b) : extra);
      b.jobs = Math.round(b.jobs * jobs);
      if (!extra || !('name' in (typeof extra === 'function' ? extra(b) : extra))) b.name = nameFor(toKind, b);
    }
  };
  convert('bank', 5, ['downtown'], ['office', 'shop'], () => ({ jobs: rng.irange(14, 24) }));
  convert('bank', 1, ['oldtown'], ['shop', 'office', 'apartment'], () => ({ jobs: rng.irange(12, 18) }));
  convert('bank', 1, ['beachfront'], ['shop', 'apartment'], () => ({ jobs: rng.irange(12, 18) }));
  convert('shelter', 1, ['tenement'], ['apartment'], { jobs: 8, name: 'Flats Night Shelter' });
  convert('shelter', 1, ['oldtown', 'midrise'], ['apartment'], { jobs: 8, name: 'Harbour Mission Hostel' });
  for (const dk of ['tenement', 'suburb', 'industrial', 'beachfront', 'midrise']) {
    convert('police', 1, [dk], ['shop', 'apartment', 'house', 'warehouse'], (b) => ({ jobs: 50, name: `${districts[b.district].name} Precinct` }));
  }
  convert('university', 2, ['campus'], ['apartment', 'shop'], () => ({ jobs: rng.irange(50, 110) }));
  convert('church', 1, ['tenement', 'oldtown', 'midrise'], ['shop', 'apartment'], { jobs: 2 });
  convert('park', 1, ['tenement'], ['apartment'], (b) => ({ jobs: 0, outdoor: true, name: `${b.street.split(' ')[0]} Yard` }));

  // --- beach and pier, south of the promenade -------------------------------------------
  const shore = new Float32Array(nx * 2); // the water line, west to east
  for (let i = 0; i < nx; i++) {
    shore[i * 2] = X[node(i, rows)];
    shore[i * 2 + 1] = Y[node(i, rows)] + 78;
  }
  const beachDistrict = (i) => blockDistrict[(rows - 1) * cols + Math.min(i, cols - 1)];
  const outside = (kind, i, depth0, depth1, ua, ub, extra) => {
    const a = node(i, rows), b = node(i + 1, rows), e = hEdge(i, rows);
    const lx = (u) => X[a] + (X[b] - X[a]) * u, lyy = (u) => Y[a] + (Y[b] - Y[a]) * u;
    const poly = new Float32Array([lx(ua), lyy(ua) + depth0, lx(ub), lyy(ub) + depth0, lx(ub), lyy(ub) + depth1, lx(ua), lyy(ua) + depth1]);
    const t = (ua + ub) / 2;
    const bld = {
      id: buildings.length, kind, district: beachDistrict(i), name: null,
      address: edgeNames[e], street: edgeNames[e], poly,
      cx: lx(t), cy: lyy(t) + (depth0 + depth1) / 2,
      doorX: lx(t), doorY: lyy(t) + depth0, edge: e, t, streetX: lx(t), streetY: lyy(t),
      homes: 0, jobs: 0, guests: 0, outdoor: true, gateway: false, ...extra,
    };
    buildings.push(bld);
    return bld;
  };
  const pierCol = Math.round(cols * 0.56);
  for (let i = 0; i < cols; i++) {
    outside('beach', i, 12, 72, 0.02, 0.98, { name: `${districts[beachDistrict(i)].name} Beach` });
  }
  outside('pier', pierCol, 10, 250, 0.42, 0.58, { name: 'Halcyon Pier', jobs: Math.round(24 * jobs) });

  // --- gateways: where people who live off the map come and go ---------------------------
  const snap = (k, n) => Math.min(n, Math.max(0, Math.round((k * n) / 5) * 5));
  const gateway = (name, n, e, dx, dy) => {
    const gx = X[n] + dx, gy = Y[n] + dy;
    const s = 9;
    buildings.push({
      id: buildings.length, kind: 'gateway', district: 0, name, address: name, street: edgeNames[e],
      poly: new Float32Array([gx - s, gy - s, gx + s, gy - s, gx + s, gy + s, gx - s, gy + s]), cx: gx, cy: gy,
      doorX: gx, doorY: gy, edge: e, t: EA[e] === n ? 0 : 1, streetX: X[n], streetY: Y[n],
      homes: 0, jobs: 0, guests: 0, outdoor: false, gateway: true,
    });
  };
  const gi = [snap(0.15, cols), snap(0.5, cols), snap(0.85, cols)];
  gi.forEach((i, k) => gateway(['Route 9 North', 'Northern Parkway', 'Saltmarsh Turnpike'][k], node(i, 0), vEdge(i, 0), 0, -70));
  const gj = [snap(0.3, rows), snap(0.7, rows)];
  gj.forEach((j, k) => gateway(['Marlowe Bridge', 'Westvale Causeway'][k], node(0, j), hEdge(0, j), -70, 0));
  gj.forEach((j, k) => gateway(['Eastdock Tunnel', 'Harbour Freeway'][k], node(cols, j), hEdge(cols - 1, j), 70, 0));

  // district of a gateway or beach is the district of the nearest block
  for (const b of buildings) {
    if (b.kind !== 'gateway') continue;
    const i = Math.min(cols - 1, Math.max(0, Math.round((b.streetX / W) * cols - 0.5)));
    const j = Math.min(rows - 1, Math.max(0, Math.round((b.streetY / H) * rows - 0.5)));
    b.district = blockDistrict[j * cols + i];
  }

  // --- lookups ---------------------------------------------------------------------------
  const byKind = {};
  for (const b of buildings) (byKind[b.kind] ??= []).push(b.id);
  const categories = {};
  for (const cat in PLACE_CATEGORIES) {
    categories[cat] = PLACE_CATEGORIES[cat].flatMap((k) => byKind[k] ?? []);
  }
  for (const d of districts) {
    if (!d.gang) continue;
    const local = buildings.filter((b) => b.district === d.id && (b.kind === 'bar' || b.kind === 'park' || b.kind === 'shop'));
    for (let k = 0; k < 4 && local.length; k++) d.hangouts.push(local.splice(rng.int(local.length), 1)[0].id);
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of buildings) {
    for (let k = 0; k < 8; k += 2) {
      minX = Math.min(minX, b.poly[k]); maxX = Math.max(maxX, b.poly[k]);
      minY = Math.min(minY, b.poly[k + 1]); maxY = Math.max(maxY, b.poly[k + 1]);
    }
  }

  const nearCache = new Map();
  /** The six places of a category nearest a building, nearest first. */
  const near = (cat, from) => {
    const key = cat + ':' + from;
    let list = nearCache.get(key);
    if (list) return list;
    const src = buildings[from];
    list = (categories[cat] ?? [])
      .filter((id) => id !== from)
      .map((id) => [id, (buildings[id].doorX - src.doorX) ** 2 + (buildings[id].doorY - src.doorY) ** 2])
      .sort((p, q) => p[1] - q[1] || p[0] - q[0])
      .slice(0, 6)
      .map((p) => p[0]);
    nearCache.set(key, list);
    return list;
  };

  return {
    seed, cols, rows, name: 'Halcyon Bay',
    bounds: { minX: minX - 40, minY: minY - 40, maxX: maxX + 40, maxY: maxY + 60 },
    nodes: { n: nn, x: X, y: Y },
    edges: { n: ne, a: EA, b: EB, len: EL, major: EK, name: edgeNames },
    adjStart, adjNode, adjEdge,
    districts, blockDistrict, buildings, byKind, categories, near, shore,
  };
}

/** District id of a point: the district of the nearest building. Used for events in the street. */
export function districtAt(city, x, y) {
  let best = 0, bestD = Infinity;
  const step = Math.max(1, Math.floor(city.buildings.length / 4000));
  for (let i = 0; i < city.buildings.length; i += step) {
    const b = city.buildings[i];
    if (b.kind === 'gateway') continue;
    const d = (b.cx - x) ** 2 + (b.cy - y) ** 2;
    if (d < bestD) { bestD = d; best = b.district; }
  }
  return best;
}
