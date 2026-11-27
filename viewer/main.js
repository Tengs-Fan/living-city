// The 2D viewer: the city as a map, everyone outside as a dot, and a ledger for whoever or
// whatever is selected. It is a debug tool for the library in ../src, not a game.

import { createWorld, DAY, clock, dayOf, ACT_NAMES } from '../src/world.js';
import { createPresence } from '../src/presence.js';
import { findStory, robbery, walkUpTo } from '../src/scenarios.js';
import { FLAG } from '../src/state.js';

const $ = (id) => document.getElementById(id);
const canvas = $('map'), ctx = canvas.getContext('2d');
const fmt = (n) => n.toLocaleString('en-US');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const dayName = (d) => DAYS[((d % 7) + 7) % 7];
const when = (t) => `${dayName(dayOf(t)).slice(0, 3)} day ${dayOf(t)}, ${clock(t)}`;
const STORE = 'living-city-save-v1';

let w, ring, story = null, fresh = null;
const view = { x: 0, y: 0, s: 0.2 }; // centre in metres, pixels per metre
const ui = { tab: 'story', sel: null, follow: false, running: true, speed: 5, quiet: false, scene: null };
const feed = []; // who came into and left the ring
let C = {}; // colours, read from the stylesheet so the map follows the theme
let paths = null;
let dpr = 1, W = 0, H = 0;

// --- colours -----------------------------------------------------------------------------------
function readColours() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  C = {};
  for (const n of ['bg', 'ink', 'muted', 'line', 'accent', 'danger', 'warn', 'good', 'police', 'land', 'street', 'water', 'sand', 'park',
    'b-home', 'b-office', 'b-industry', 'b-civic', 'b-shop', 'b-hotel', 'walk', 'car', 'bus', 'stay', 'mark', 'fear', 'panel']) C[n] = v('--' + n);
}
const GROUP = {
  house: 'b-home', apartment: 'b-home', tower: 'b-home', shelter: 'b-home',
  office: 'b-office', bank: 'b-office', university: 'b-office',
  factory: 'b-industry', warehouse: 'b-industry', station: 'b-industry',
  cityhall: 'b-civic', police: 'b-civic', hospital: 'b-civic', church: 'b-civic',
  shop: 'b-shop', restaurant: 'b-shop', bar: 'b-shop', gym: 'b-shop', hotel: 'b-hotel',
  park: 'park', beach: 'sand', pier: 'b-industry', gateway: 'muted',
};
const ACT_COLOUR = ['var(--b-home)', 'var(--accent)', 'var(--bus)', 'var(--warn)', 'var(--car)', 'var(--b-hotel)', 'var(--stay)', 'var(--good)', 'var(--mark)', 'var(--muted)', 'transparent'];

// --- the static map as retained paths, in world coordinates ---------------------------------------
function buildPaths() {
  const { city } = w, { nodes, edges } = city;
  const P = { groups: {}, minor: new Path2D(), major: new Path2D(), water: new Path2D(), districts: [] };
  for (const b of city.buildings) {
    const g = (P.groups[GROUP[b.kind] ?? 'b-home'] ??= new Path2D());
    const p = b.poly;
    g.moveTo(p[0], p[1]); g.lineTo(p[2], p[3]); g.lineTo(p[4], p[5]); g.lineTo(p[6], p[7]); g.closePath();
  }
  for (let e = 0; e < edges.n; e++) {
    const path = edges.major[e] ? P.major : P.minor;
    path.moveTo(nodes.x[edges.a[e]], nodes.y[edges.a[e]]);
    path.lineTo(nodes.x[edges.b[e]], nodes.y[edges.b[e]]);
  }
  const s = city.shore, far = city.bounds.maxY + 4000;
  P.water.moveTo(s[0] - 6000, s[1]);
  for (let i = 0; i < s.length; i += 2) P.water.lineTo(s[i], s[i + 1]);
  P.water.lineTo(s[s.length - 2] + 6000, s[s.length - 1]);
  P.water.lineTo(s[s.length - 2] + 6000, far); P.water.lineTo(s[0] - 6000, far); P.water.closePath();
  const nx = city.cols + 1;
  for (let d = 0; d < city.districts.length; d++) P.districts.push(new Path2D());
  for (let j = 0; j < city.rows; j++) {
    for (let i = 0; i < city.cols; i++) {
      const path = P.districts[city.blockDistrict[j * city.cols + i]];
      const q = [j * nx + i, j * nx + i + 1, (j + 1) * nx + i + 1, (j + 1) * nx + i];
      path.moveTo(nodes.x[q[0]], nodes.y[q[0]]);
      for (let k = 1; k < 4; k++) path.lineTo(nodes.x[q[k]], nodes.y[q[k]]);
      path.closePath();
    }
  }
  return P;
}

// --- view ---------------------------------------------------------------------------------------
const sx = (x) => (x - view.x) * view.s + W / 2;
const sy = (y) => (y - view.y) * view.s + H / 2;
const wx = (px) => (px - W / 2) / view.s + view.x;
const wy = (py) => (py - H / 2) / view.s + view.y;
function fit() {
  const b = w.city.bounds;
  view.x = (b.minX + b.maxX) / 2; view.y = (b.minY + b.maxY) / 2;
  view.s = Math.min(W / (b.maxX - b.minX), H / (b.maxY - b.minY)) * 0.98;
}
function zoomAt(px, py, factor) {
  const x = wx(px), y = wy(py);
  view.s = Math.min(6, Math.max(0.05, view.s * factor));
  view.x = x - (px - W / 2) / view.s; view.y = y - (py - H / 2) / view.s;
}
function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  dpr = Math.min(2, window.devicePixelRatio || 1);
  W = Math.max(50, r.width); H = Math.max(50, r.height);
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
}

// --- drawing ---------------------------------------------------------------------------------------
const MAXDOTS = 16000;
const dots = { 1: new Float32Array(MAXDOTS * 2), 2: new Float32Array(MAXDOTS * 2), 3: new Float32Array(MAXDOTS * 2), 0: new Float32Array(MAXDOTS * 2), mark: new Float32Array(4000) };
const count = { 0: 0, 1: 0, 2: 0, 3: 0, mark: 0 };
const here = {};

function draw() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = C.land;
  ctx.fillRect(0, 0, W, H);
  if (!paths) return;
  const k = view.s;
  ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (W / 2 - view.x * k), dpr * (H / 2 - view.y * k));
  ctx.fillStyle = C.water; ctx.fill(paths.water);
  // fear lies over a district like a stain
  for (let d = 0; d < paths.districts.length; d++) {
    const f = w.mood.fear[d];
    if (f < 0.01) continue;
    ctx.fillStyle = `rgba(${C.fear}, ${(Math.min(1, f * 1.2) * 0.42).toFixed(3)})`;
    ctx.fill(paths.districts[d]);
  }
  ctx.strokeStyle = C.street; ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(8, 0.8 / k); ctx.stroke(paths.minor);
  ctx.lineWidth = Math.max(13, 1.6 / k); ctx.stroke(paths.major);
  for (const g in paths.groups) { ctx.fillStyle = C[g]; ctx.fill(paths.groups[g]); }

  // selection: a building, or the building a selected person is inside
  const sel = ui.sel;
  let selPerson = null;
  if (sel?.type === 'person') selPerson = w.whereIs(sel.id, w.t, {});
  const outline = sel?.type === 'building' ? sel.id : selPerson && selPerson.state === 'at' && !selPerson.outside ? selPerson.place : -1;
  if (outline >= 0) {
    const p = w.city.buildings[outline].poly;
    ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[2], p[3]); ctx.lineTo(p[4], p[5]); ctx.lineTo(p[6], p[7]); ctx.closePath();
    ctx.strokeStyle = C.accent; ctx.lineWidth = Math.max(3, 2.5 / k); ctx.stroke();
  }
  // the rest of a selected person's journey
  if (selPerson && selPerson.state === 'travel') {
    const route = w.router.path(selPerson.from, selPerson.to);
    ctx.beginPath();
    ctx.moveTo(selPerson.x, selPerson.y);
    for (let i = 0; i < route.n; i++) if (route.cum[i] > selPerson.frac * route.len) ctx.lineTo(route.pts[i * 2], route.pts[i * 2 + 1]);
    ctx.strokeStyle = C.accent; ctx.lineWidth = Math.max(2, 2 / k); ctx.setLineDash([8 / k, 6 / k]); ctx.stroke(); ctx.setLineDash([]);
  }
  // the ring round the player
  ctx.beginPath(); ctx.arc(w.player.x, w.player.y, ring.radius, 0, 6.2832);
  ctx.fillStyle = 'rgba(127,127,127,0.10)'; ctx.fill();
  ctx.strokeStyle = C.ink; ctx.lineWidth = 1.2 / k; ctx.setLineDash([6 / k, 5 / k]); ctx.stroke(); ctx.setLineDash([]);

  // everything from here is drawn in screen pixels
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  count[0] = count[1] = count[2] = count[3] = count.mark = 0;
  const marked = w.people.size > 0;
  w.outside(w.t, (id, p) => {
    const x = sx(p.x), y = sy(p.y);
    if (x < -4 || y < -4 || x > W + 4 || y > H + 4) return;
    const m = p.state === 'travel' ? p.mode : 0;
    if (count[m] < MAXDOTS) { dots[m][count[m] * 2] = x; dots[m][count[m] * 2 + 1] = y; count[m]++; }
    if (marked && w.people.has(id) && count.mark < 2000) { dots.mark[count.mark * 2] = x; dots.mark[count.mark * 2 + 1] = y; count.mark++; }
  });
  const r = Math.min(4.5, Math.max(1.1, k * 2.2));
  const pass = (m, colour, size) => {
    ctx.fillStyle = colour;
    const a = dots[m], n = count[m];
    if (size < 2) { for (let i = 0; i < n; i++) ctx.fillRect(a[i * 2] - size, a[i * 2 + 1] - size, size * 2, size * 2); return; }
    ctx.beginPath();
    for (let i = 0; i < n; i++) { ctx.moveTo(a[i * 2] + size, a[i * 2 + 1]); ctx.arc(a[i * 2], a[i * 2 + 1], size, 0, 6.2832); }
    ctx.fill();
  };
  pass(0, C.stay, r * 0.85); pass(3, C.bus, r); pass(2, C.car, r); pass(1, C.walk, r);
  if (count.mark) {
    ctx.strokeStyle = C.mark; ctx.lineWidth = 1.5; ctx.beginPath();
    for (let i = 0; i < count.mark; i++) { ctx.moveTo(dots.mark[i * 2] + r + 2.5, dots.mark[i * 2 + 1]); ctx.arc(dots.mark[i * 2], dots.mark[i * 2 + 1], r + 2.5, 0, 6.2832); }
    ctx.stroke();
  }
  // flowers where someone died
  ctx.fillStyle = C.mark;
  for (const m of w.markers) {
    if (m.from > w.t) continue;
    const x = sx(m.x), y = sy(m.y);
    ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x + 4, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 4, y); ctx.closePath(); ctx.fill();
  }
  // the player
  {
    const x = sx(w.player.x), y = sy(w.player.y);
    ctx.fillStyle = C.ink; ctx.strokeStyle = C.panel; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x + 6, y + 5); ctx.lineTo(x - 6, y + 5); ctx.closePath(); ctx.stroke(); ctx.fill();
  }
  // district names when the whole city is in view
  if (k < 0.45) {
    ctx.font = `600 ${Math.max(10, Math.min(13, k * 60))}px "IBM Plex Sans Condensed", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const d of w.city.districts) {
      const label = d.name.toUpperCase();
      ctx.lineWidth = 3; ctx.strokeStyle = C.land; ctx.strokeText(label, sx(d.cx), sy(d.cy));
      ctx.fillStyle = C.ink; ctx.fillText(label, sx(d.cx), sy(d.cy));
    }
  }
  if (selPerson && selPerson.state !== 'gone') {
    const x = sx(selPerson.x), y = sy(selPerson.y);
    ctx.strokeStyle = C.accent; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(x, y, r + 6, 0, 6.2832); ctx.stroke();
    const label = w.census.name(sel.id) + (selPerson.outside ? '' : ' (inside)');
    ctx.font = '500 12px "IBM Plex Sans", sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = C.panel; ctx.fillRect(x + r + 10, y - 10, tw + 10, 20);
    ctx.fillStyle = C.ink; ctx.fillText(label, x + r + 15, y);
  }
}

// --- picking -----------------------------------------------------------------------------------
function pick(px, py) {
  const x = wx(px), y = wy(py);
  let best = -1, bestD = Infinity;
  w.near(x, y, Math.max(14 / view.s, 5), w.t, (id, p) => {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bestD) { bestD = d; best = id; }
  });
  if (best >= 0) return { type: 'person', id: best };
  for (const b of w.city.buildings) {
    if (Math.abs(b.cx - x) > 160 || Math.abs(b.cy - y) > 160) continue;
    const p = b.poly;
    let inside = true;
    for (let i = 0; i < 4 && inside; i++) {
      const j = (i + 1) % 4;
      if ((p[j * 2] - p[i * 2]) * (y - p[i * 2 + 1]) - (p[j * 2 + 1] - p[i * 2 + 1]) * (x - p[i * 2]) < 0) inside = false;
    }
    if (inside) return { type: 'building', id: b.id };
  }
  return null;
}
function select(sel, tab = 'person') {
  ui.sel = sel;
  if (!sel) ui.follow = false;
  if (tab) setTab(tab);
  renderPanel(true);
}
function centreOn(x, y, scale) {
  view.x = x; view.y = y;
  if (scale) view.s = Math.max(view.s, scale);
}

// --- panel ---------------------------------------------------------------------------------------
const person = (id, label) => `<a class="link${w.isGone(id) ? ' gone' : ''}" data-person="${id}">${esc(label ?? w.census.name(id))}</a>`;
const place = (b) => (b < 0 ? 'nowhere' : `<a class="link" data-building="${b}">${esc(w.placeName(b))}</a>`);
function chips(id) {
  const p = w.person(id), out = [`<span class="chip">${esc(p.archetype)}</span>`];
  for (const s of p.state) if (s !== p.archetype) out.push(`<span class="chip ${['dead', 'hostile', 'homeless', 'evicted'].includes(s) ? 'bad' : 'warn'}">${esc(s)}</span>`);
  for (const t of p.traits) out.push(`<span class="chip">${esc(t)}</span>`);
  return out.join('');
}

function personView(id) {
  const c = w.census, p = w.person(id), where = w.whereIs(id, w.t, here);
  const day = dayOf(w.t), plan = w.plan(id, day), m = w.t - day * DAY;
  const gone = w.isGone(id);
  let strip = '', stops = '';
  plan.forEach((s, i) => {
    strip += `<span style="left:${(s.arrive / DAY) * 100}%;width:${((s.depart - s.arrive) / DAY) * 100}%;background:${ACT_COLOUR[s.kind]}"></span>`;
    const cur = m >= s.arrive && m < s.depart;
    stops += `<li class="${cur ? 'cur' : ''}"><span>${clock(s.arrive)}-${clock(Math.min(s.depart, DAY - 1))}</span><span><i style="background:${ACT_COLOUR[s.kind]}"></i>${esc(ACT_NAMES[s.kind])}, ${place(s.place)}</span></li>`;
    if (i < plan.length - 1) {
      const next = plan[i + 1], moving = m >= s.depart && m < next.arrive;
      strip += `<span style="left:${(s.depart / DAY) * 100}%;width:${((next.arrive - s.depart) / DAY) * 100}%;background:var(--ink);opacity:.55"></span>`;
      stops += `<li class="leg${moving ? ' cur' : ''}"><span></span><span>${['', 'walks', 'drives', 'takes the bus'][s.mode]} ${Math.round(next.arrive - s.depart)} min, ${fmt(Math.round(w.router.distance(s.place, next.place)))} m</span></li>`;
    }
  });
  const ps = w.people.get(id);
  const marks = [];
  if (ps) {
    if (ps.mourns.length) marks.push(`Mourns ${ps.mourns.map((v) => person(v)).join(', ')}.`);
    if (ps.flags & FLAG.KNOWS) marks.push('Knows the player\'s face.');
    if (ps.avoid.length) marks.push(`Keeps away from ${ps.avoid.map(place).join(', ')}.`);
    if (ps.spot >= 0 && ps.flags & FLAG.HOMELESS) marks.push(`Lives on the pavement outside ${place(ps.spot)}.`);
    if (ps.leaving && !(ps.flags & FLAG.MOVED)) marks.push('Has decided to leave the city.');
  }
  const pay = w.payoffs.find((q) => q.person === id);
  if (pay) marks.push(`The director is holding a ${pay.type === 'confront' ? 'confrontation' : 'revenge'} scene for ${w.pronoun(id) === 'she' ? 'her' : 'him'}${w.t < pay.notBefore ? `, not before day ${dayOf(pay.notBefore)}` : ''}.`);
  return `
    <div><h2>${esc(p.name)}, ${p.age}</h2>
      <p class="sub">${p.role ? `${esc(p.role)} at ${place(p.work)}, ${p.shift}` : esc(p.archetype)}${p.visitor ? ' &middot; lives off the map' : ''}</p></div>
    <div class="chips">${chips(id)}</div>
    <p><b>Now:</b> ${gone ? (ps.flags & FLAG.DEAD ? 'dead' : 'gone from the city') : esc(w.describeWhere(where))}</p>
    <div class="actions">
      <button class="btn" data-act="follow" aria-pressed="${ui.follow}" ${gone ? 'disabled' : ''}>${ui.follow ? 'Following' : 'Follow'}</button>
      <button class="btn danger" data-act="kill" ${gone ? 'disabled' : ''}>Kill</button>
      <button class="btn danger" data-act="injure" ${gone ? 'disabled' : ''}>Wound</button>
      <button class="btn danger" data-act="rob" ${gone ? 'disabled' : ''}>Rob</button>
    </div>
    ${marks.length ? `<div><h3>What play has done</h3><ul class="plain">${marks.map((s) => `<li>${s}</li>`).join('')}</ul></div>` : ''}
    ${plan.length ? `<div><h3>${dayName(day)}, day ${day}</h3>
      <div class="strip">${strip}<span class="now" style="left:${(m / DAY) * 100}%"></span></div>
      <div class="hours"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
      <ul class="plain stops">${stops}</ul></div>` : ''}
    <div><h3>Record</h3><dl>
      <dt>Home</dt><dd>${ps && ps.flags & FLAG.HOMELESS ? `none; it was ${place(p.home)}` : `${place(p.home)}, ${esc(w.city.districts[w.city.buildings[p.home].district].name)}`}</dd>
      ${p.work >= 0 ? `<dt>${p.role === 'student' ? 'Studies' : 'Works'}</dt><dd>${place(p.work)}</dd>` : ''}
      <dt>Gets about</dt><dd>${p.car ? 'has a car' : 'on foot and by bus'}</dd>
      <dt>Census id</dt><dd>${id}</dd></dl></div>
    ${p.relatives.length ? `<div><h3>Family and household</h3><ul class="plain">${p.relatives.map((r) => `<li>${esc(r.rel)} ${person(r.id)}, ${c.age[r.id]}</li>`).join('')}</ul></div>` : ''}`;
}

function buildingView(b) {
  const B = w.city.buildings[b], c = w.census;
  const inside = w.inside(b, w.t);
  const list = (ids, max = 40) => `<ul class="plain">${[...ids].slice(0, max).map((id) => `<li>${person(id)}, ${c.age[id]}${c.work[id] === b ? `, ${esc(c.roleName(id))}` : ''}</li>`).join('')}${ids.length > max ? `<li class="sub">and ${ids.length - max} more</li>` : ''}</ul>`;
  const staff = c.staffOf(b), lodgers = c.lodgersOf(b);
  return `
    <div><h2>${esc(B.name ?? B.address)}</h2><p class="sub">${esc(B.kind)} &middot; ${esc(B.address)} &middot; ${esc(w.city.districts[B.district].name)}</p></div>
    <div class="chips">${B.homes ? `<span class="chip">${B.homes} homes</span>` : ''}${B.jobs ? `<span class="chip">${B.jobs} jobs</span>` : ''}${B.guests ? `<span class="chip">${B.guests} beds</span>` : ''}<span class="chip">${inside.length} inside now</span></div>
    ${B.jobs ? `<div class="actions"><button class="btn danger" data-act="robplace">Hold it up</button></div>` : ''}
    ${staff.length ? `<div><h3>Works here (${staff.length})</h3>${list(staff)}</div>` : ''}
    ${lodgers.length ? `<div><h3>${B.guests ? 'Staying here' : 'Lives here'} (${lodgers.length})</h3>${list(lodgers)}</div>` : ''}`;
}

function ringView() {
  const c = w.census, where = {};
  const rows = [...ring.online.values()].slice(0, 60).map((r) => {
    const ps = w.people.get(r.id);
    let react = '';
    if (ps) {
      if (ps.flags & FLAG.HOSTILE) react = '<span class="chip bad">hunting you</span>';
      else if (ps.flags & FLAG.KNOWS && ps.fearUntil > w.t) react = `<span class="chip warn">knows you: ${ps.flags & FLAG.ARMED ? 'armed, stands his ground' : 'runs'}</span>`;
      else if (ps.flags & FLAG.KNOWS) react = '<span class="chip warn">knows your face</span>';
    }
    return `<li>${person(r.id)} <span class="sub">${esc(w.describeWhere(w.whereIs(r.id, w.t, where)))}</span> ${react}</li>`;
  });
  const d = w.districtReport(nearestDistrict(w.player.x, w.player.y));
  return `
    <div><h2>The player</h2><p class="sub">In ${esc(d.name)}. Everyone within ${ring.radius} m is online: a full character in a real game. Everyone else is a record and a plan, and costs nothing.</p></div>
    <div class="actions"><button class="btn" data-act="playerhere">Move the player to the middle of the map</button><button class="btn" data-act="showplayer">Show the player</button></div>
    <div><h3>Online now (${ring.online.size})</h3><ul class="plain">${rows.join('') || '<li class="sub">Nobody is out here at this hour.</li>'}</ul></div>
    <div><h3>Came and went</h3><ul class="plain">${feed.slice(0, 14).map((f) => `<li><span class="sub">${clock(f.t)}</span> ${person(f.id)} ${esc(f.text)}</li>`).join('') || '<li class="sub">Nothing yet.</li>'}</ul></div>`;
}
function nearestDistrict(x, y) {
  let best = 0, bd = Infinity;
  for (const d of w.city.districts) { const q = (d.cx - x) ** 2 + (d.cy - y) ** 2; if (q < bd) { bd = q; best = d.id; } }
  return best;
}

function districtsView() {
  const meter = (label, v, colour, base) => `<div class="meter">${label} ${v.toFixed(2)}<div><span style="width:${Math.round(v * 100)}%;background:${colour}"></span></div>${base !== undefined ? `<span>normally ${base.toFixed(2)}</span>` : ''}</div>`;
  const rows = w.city.districts.map((d) => w.districtReport(d.id)).sort((a, b) => b.fear - a.fear || a.id - b.id).map((m) => {
    const fx = [`${Math.round(m.effects.armedShare * 100)}% of civilians armed`, `evenings out at ${Math.round(m.effects.nightLife * 100)}%`, `${m.effects.patrolsPerHour} patrol${m.effects.patrolsPerHour > 1 ? 's' : ''} an hour`];
    if (m.effects.shopsShutEarly) fx.push('shops shut early');
    if (m.effects.boardedUp) fx.push('windows boarded up');
    if (m.kills) fx.push(`${m.kills} killed`);
    if (m.emptyHomes) fx.push(`${m.emptyHomes} homes empty`);
    return `<div class="district"><header><b>${esc(m.name)}</b><span class="sub">${esc(m.kind)}${m.gang ? ', gang turf' : ''}</span></header>
      <div class="meters">${meter('fear', m.fear, 'var(--danger)')}${meter('violence', m.violence, 'var(--warn)')}${meter('policing', m.policing, 'var(--police)')}${meter('prosperity', m.prosperity, 'var(--good)', m.baseProsperity)}</div>
      <p class="sub">${fx.join(' &middot; ')}</p></div>`;
  });
  return `<div><h2>Districts</h2><p class="sub">Four numbers each. They rise with what the player does there and fade over game weeks; fear is the red stain on the map.</p></div>${rows.join('')}`;
}

function timelineView() {
  const rows = [];
  for (let i = w.log.length - 1; i >= 0 && rows.length < 150; i--) {
    const l = w.log[i];
    if (l.quiet && !ui.quiet) continue;
    const who = l.people?.[0];
    rows.push(`<li class="${l.scene ? 'scene' : l.news ? 'news' : l.quiet ? 'quiet' : ''}"><time>${when(l.t)}</time><span>${esc(l.text)}${who !== undefined ? ` ${person(who, 'show')}` : ''}</span></li>`);
  }
  return `<div><h2>Timeline</h2><p class="sub">What the city remembers, newest first.</p></div>
    <label class="check"><input type="checkbox" id="quiet" ${ui.quiet ? 'checked' : ''}> Show quiet consequences too</label>
    <ul class="plain log">${rows.join('') || '<li><time></time><span class="sub">Nothing has happened yet. Kill someone, or run the story.</span></li>'}</ul>`;
}

function storyView() {
  const c = w.census;
  let steps;
  if (!story) steps = '<p class="sub">Nobody in this census fits the story.</p>';
  else {
    const { victim, parent, work } = story;
    const rel = w.rules.relation(parent, victim), back = w.rules.relation(victim, parent);
    const dead = w.isGone(victim), ps = w.people.get(parent);
    const evicted = !!ps && (ps.flags & FLAG.EVICTED) !== 0;
    const late = dayOf(w.t) >= 125;
    const shown = w.scenes.some((s) => s.person === parent);
    steps = `<ol class="steps">
      <li class="done"><div><span>${person(victim)}, ${c.age[victim]}, is ${esc(w.jobOf(victim))}. ${w.pronoun(victim) === 'she' ? 'She' : 'He'} is the only earner in a home shared with ${w.possessive(victim)} ${esc(back)} ${person(parent)}, ${c.age[parent]}. Nobody wrote either of them: they came out of the census.</span></div></li>
      <li class="${dead ? 'done' : ''}"><div><span>Hour 5 of play. The player holds up ${place(work)} and shoots the guard.</span><button class="btn danger" data-act="s-rob" ${dead ? 'disabled' : ''}>Rob the bank</button></div></li>
      <li class="${evicted ? 'done' : ''}"><div><span>${dead ? (evicted ? `The rent fell due. ${esc(c.firstName(parent))} lost the home.` : `${esc(c.firstName(parent))} is grieving. The rent falls due in about a fortnight.`) : `The ${esc(back)} hears the same day, and learns who did it from the next morning's news.`}</span><button class="btn" data-act="s-fortnight" ${!dead || evicted ? 'disabled' : ''}>Let three weeks pass</button></div></li>
      <li class="${late ? 'done' : ''}"><div><span>Hour 100 of play is game day 125.</span><button class="btn" data-act="s-skip" ${!evicted || late ? 'disabled' : ''}>Skip to day 125</button></div></li>
      <li class="${shown ? 'done' : ''}"><div><span>The player walks down ${esc(w.city.buildings[c.home[parent]].street)}.</span><button class="btn primary" data-act="s-walk" ${!late || shown ? 'disabled' : ''}>Walk past ${w.pronoun(parent) === 'she' ? 'her' : 'him'}</button></div></li>
    </ol>`;
  }
  const pending = w.director.pending();
  return `
    <div><h2>A city that remembers</h2>
      <p class="sub">Every dot is a person with a home, a job and a day that ends somewhere. Tap one to read their day, or follow them home. What the player does to them is still felt months later.</p></div>
    ${steps}
    <div><h3>Scenes the director is holding (${pending.length})</h3>
      <ul class="plain">${pending.map((p) => `<li>${person(p.person)} for ${person(p.victim)} <span class="sub">${p.type === 'confront' ? 'confrontation' : 'revenge'}, ${p.ready ? 'ready' : `from day ${dayOf(p.notBefore)}`}</span></li>`).join('') || '<li class="sub">None. Most of what happens stays quiet.</li>'}</ul></div>
    <div class="actions"><button class="btn" data-act="save">Save</button><button class="btn" data-act="load">Load</button><button class="btn" data-act="reset">Start again</button></div>`;
}

let lastHtml = '';
function renderPanel(force) {
  if (!w) return;
  let html;
  if (ui.tab === 'story') html = storyView();
  else if (ui.tab === 'ring') html = ringView();
  else if (ui.tab === 'districts') html = districtsView();
  else if (ui.tab === 'timeline') html = timelineView();
  else if (ui.sel?.type === 'person') html = personView(ui.sel.id);
  else if (ui.sel?.type === 'building') html = buildingView(ui.sel.id);
  else html = '<div><h2>Nobody selected</h2><p class="sub">Tap a dot on the map to read that person\'s record and day. Tap a building to see who lives or works there.</p></div>';
  if (!force && html === lastHtml) return;
  lastHtml = html;
  $('view').innerHTML = html;
}
function setTab(tab) {
  ui.tab = tab;
  for (const b of $('tabs').children) b.setAttribute('aria-selected', b.dataset.tab === tab);
  $('body').scrollTop = 0;
}
function renderClock() {
  $('time').textContent = clock(w.t);
  $('day').textContent = `${dayName(dayOf(w.t)).slice(0, 3)}, day ${dayOf(w.t)}`;
}
let toastTimer = 0;
function toast(text) {
  $('toast').textContent = text; $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3500);
}
function showScene(scene) {
  ui.scene = scene;
  centreOn(scene.x, scene.y, 1.2);
  select({ type: 'person', id: scene.person }, null);
  $('scene').innerHTML = `<div class="cue">${esc(scene.cue)}</div>${scene.lines.map((l) => `<p>&ldquo;${esc(l)}&rdquo;</p>`).join('')}
    <div class="row"><span>${when(scene.t)} &middot; chosen by the director</span><button class="btn primary" data-act="scene-ok">Continue</button></div>`;
  $('scene').hidden = false;
  $('legend').hidden = true; $('toast').hidden = true;
}

// --- actions -----------------------------------------------------------------------------------
function skip(minutes, present) {
  const scene = w.advance(minutes, { player: present });
  if (scene) showScene(scene);
  renderClock(); renderPanel(true);
}
function act(name) {
  const sel = ui.sel;
  switch (name) {
    case 'follow': ui.follow = !ui.follow; if (ui.follow) view.s = Math.max(view.s, 1.1); break;
    case 'kill': case 'injure': case 'rob': {
      const p = w.whereIs(sel.id, w.t, {});
      if (p.state === 'gone') break;
      w.player.x = p.x + 2; w.player.y = p.y + 2;
      const ev = w.act[name](sel.id);
      if (ev) toast(`${{ kill: 'Killed', injure: 'Wounded', rob: 'Robbed' }[name]} ${w.census.name(sel.id)}. ${ev.witnesses.length ? `${ev.witnesses.length} ${ev.witnesses.length === 1 ? 'person' : 'people'} saw it.` : 'Nobody saw it.'}`);
      if (name === 'kill') ui.follow = false;
      break;
    }
    case 'robplace': {
      const b = w.city.buildings[sel.id];
      w.player.x = b.doorX; w.player.y = b.doorY;
      const ev = w.act.robPlace(sel.id);
      toast(`Held up ${w.placeName(sel.id)}. ${ev.witnesses.length} saw it.`);
      break;
    }
    case 'playerhere': w.player.x = view.x; w.player.y = view.y; ui.follow = false; break;
    case 'showplayer': centreOn(w.player.x, w.player.y, 1.1); break;
    case 's-rob': {
      robbery(w, story, { mission: 'bank robbery' });
      const b = w.city.buildings[story.work];
      centreOn(b.doorX, b.doorY, 1.1);
      ui.running = false; syncPlay();
      toast(`${when(w.t)}: the guard is dead. Read the timeline, then let time pass.`);
      setTab('timeline');
      break;
    }
    case 's-fortnight': skip(21 * DAY, false); select({ type: 'person', id: story.parent }, 'timeline'); break;
    case 's-skip': {
      skip(125 * DAY + 10 * 60 - w.t, false);
      const p = w.whereIs(story.parent, w.t, {});
      if (p.state !== 'gone') { centreOn(p.x, p.y, 1.3); w.player.x = p.x + 110; w.player.y = p.y + 60; }
      select({ type: 'person', id: story.parent }, 'story');
      ui.running = false; syncPlay();
      break;
    }
    case 's-walk':
      if (!walkUpTo(w, story.parent)) { toast('Not out on the street right now. Try again in the daytime.'); break; }
      skip(1, true);
      break;
    case 'scene-ok': $('scene').hidden = true; $('legend').hidden = false; ui.scene = null; break;
    case 'save':
      try { localStorage.setItem(STORE, JSON.stringify({ save: w.save(), story })); toast('Saved in this browser.'); } catch { toast('This browser will not let the page save.'); }
      break;
    case 'load':
      try {
        const data = JSON.parse(localStorage.getItem(STORE));
        if (!data) { toast('Nothing saved yet.'); break; }
        w.restore(data.save); story = data.story; ring.online.clear(); feed.length = 0; toast('Loaded.');
      } catch { toast('Could not read the save.'); }
      break;
    case 'reset': w.restore(fresh); story = findStory(w); ring.online.clear(); feed.length = 0; ui.follow = false; toast('Back to the first Monday.'); break;
  }
  renderClock(); renderPanel(true);
}
function syncPlay() {
  $('play').textContent = ui.running ? 'Pause' : 'Play';
  $('play').setAttribute('aria-pressed', String(!ui.running));
}

// --- input ---------------------------------------------------------------------------------------
function wire() {
  $('tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { setTab(b.dataset.tab); renderPanel(true); } });
  $('panel').addEventListener('click', (e) => {
    const t = e.target.closest('[data-person],[data-building],[data-act]');
    if (!t) return;
    if (t.dataset.person !== undefined) {
      const id = Number(t.dataset.person), p = w.whereIs(id, w.t, {});
      if (p.state !== 'gone') centreOn(p.x, p.y, 0.9);
      select({ type: 'person', id });
    } else if (t.dataset.building !== undefined) {
      const b = w.city.buildings[Number(t.dataset.building)];
      centreOn(b.cx, b.cy, 0.9);
      ui.follow = false;
      select({ type: 'building', id: b.id });
    } else act(t.dataset.act);
  });
  $('panel').addEventListener('change', (e) => { if (e.target.id === 'quiet') { ui.quiet = e.target.checked; renderPanel(true); } });
  $('scene').addEventListener('click', (e) => { if (e.target.closest('[data-act]')) act('scene-ok'); });
  $('play').addEventListener('click', () => { ui.running = !ui.running; syncPlay(); });
  $('speed').addEventListener('click', (e) => {
    const b = e.target.closest('[data-speed]');
    if (!b) return;
    ui.speed = Number(b.dataset.speed);
    for (const x of $('speed').children) x.setAttribute('aria-pressed', x === b);
  });
  $('skipH').addEventListener('click', () => skip(60, true));
  $('skipD').addEventListener('click', () => skip(DAY, false));
  $('skipM').addEventListener('click', () => skip(30 * DAY, false));
  $('zin').addEventListener('click', () => zoomAt(W / 2, H / 2, 1.5));
  $('zout').addEventListener('click', () => zoomAt(W / 2, H / 2, 1 / 1.5));
  $('zfit').addEventListener('click', () => { ui.follow = false; fit(); });

  // drag to pan, pinch or wheel to zoom, tap to select
  const pointers = new Map();
  let moved = 0, pinch = 0;
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    moved = 0; pinch = 0;
    canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const cur = local(e);
    if (pointers.size === 1) {
      view.x -= (cur[0] - prev[0]) / view.s; view.y -= (cur[1] - prev[1]) / view.s;
      moved += Math.abs(cur[0] - prev[0]) + Math.abs(cur[1] - prev[1]);
      if (moved > 6) ui.follow = false;
    }
    pointers.set(e.pointerId, cur);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch) zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, dist / pinch);
      pinch = dist; moved = 99;
    }
  });
  const up = (e) => {
    const was = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    pinch = 0;
    if (!pointers.size) canvas.classList.remove('dragging');
    if (was && moved <= 6 && e.type === 'pointerup' && w) {
      const hit = pick(was[0], was[1]);
      if (hit) { ui.follow = false; select(hit); }
    }
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); const [x, y] = local(e); zoomAt(x, y, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  new ResizeObserver(() => { resize(); }).observe(canvas.parentElement);
  const themed = () => { readColours(); };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', themed);
  new MutationObserver(themed).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

// --- the loop ---------------------------------------------------------------------------------------
let last = 0, lastPanel = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000 || 0);
  last = now;
  if (ui.running && !ui.scene) {
    const scene = w.advance(dt * ui.speed);
    if (scene) showScene(scene);
  }
  if (ui.follow && ui.sel?.type === 'person') {
    const p = w.whereIs(ui.sel.id, w.t, here);
    if (p.state === 'gone') ui.follow = false;
    else {
      view.x += (p.x - view.x) * 0.2; view.y += (p.y - view.y) * 0.2;
      w.player.x = p.x - 7; w.player.y = p.y + 7; // the player tails him
    }
  }
  const r = ring.update(w.player.x, w.player.y, w.t);
  for (const s of r.spawned) feed.unshift({ t: w.t, id: s.id, text: 'came into range' });
  for (const d of r.despawned) feed.unshift({ t: w.t, id: d.id, text: d.why === 'out of range' ? 'went out of range' : d.why });
  if (feed.length > 40) feed.length = 40;
  draw();
  if (now - lastPanel > 300) { lastPanel = now; renderClock(); renderPanel(false); }
  requestAnimationFrame(frame);
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
async function boot() {
  readColours(); resize(); wire();
  await nextFrame();
  w = createWorld({ seed: 1 });
  const c = w.census;
  $('pop').textContent = `${fmt(c.residents)} residents, ${fmt(c.commuters)} commuters, ${fmt(c.tourists)} tourists`;
  $('loadmsg').textContent = `Planning Monday for ${fmt(c.n)} people…`;
  await nextFrame();
  w.advance(8 * 60 + 10 - w.t, { player: false }); // Monday, ten past eight: the rush hour
  w.index(0);
  ring = createPresence(w);
  paths = buildPaths();
  story = findStory(w);
  const office = w.city.buildings.filter((b) => b.kind === 'office').sort((a, b) => b.jobs - a.jobs)[0];
  w.player.x = office.streetX; w.player.y = office.streetY;
  fresh = w.save();
  fit();
  if (story) ui.sel = { type: 'person', id: story.victim };
  $('loading').hidden = true;
  syncPlay(); renderClock(); renderPanel(true);
  requestAnimationFrame(frame);
}
boot();
