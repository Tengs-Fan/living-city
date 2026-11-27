// The director: most consequences stay quiet; this chooses the few that are shown, and when.
//
// It keeps a short list of pending payoffs, the most salient first, and plays one as a scene
// when its person is on the street beside the player, enough time has passed, the player is
// not busy, and no other personal scene has played for a while. A player who kills thousands
// still sees only a handful.

import { FLAG } from './state.js';
import { ARCH } from './census.js';
import { DAY } from './plans.js';

/** Game minutes between personal scenes: two and a half game days, about two real hours. */
export const SCENE_GAP = 60 * 60;
const MAX_PENDING = 8;
const RANGE = 45; // metres: close enough to call out across a street

export function createDirector(w) {
  const { census, city } = w;
  const B = city.buildings;
  w.payoffs = [];
  w.payoffSeq = 0;
  w.scenes = [];
  w.lastScene = -1e9;
  w.player = { x: 0, y: 0, busy: false };
  const D = (w.director = {});
  const where = {};

  /** A consequence worth showing one day. Only the most salient few are kept. */
  D.offer = (p) => {
    const had = w.payoffs.find((q) => q.person === p.person && q.type === p.type);
    if (had) { if (p.salience > had.salience) Object.assign(had, p); return; }
    w.payoffs.push({ id: w.payoffSeq++, created: w.t, ...p });
    w.payoffs.sort((a, b) => b.salience - a.salience || a.id - b.id);
    if (w.payoffs.length > MAX_PENDING) w.payoffs.length = MAX_PENDING;
  };
  D.drop = (person) => { w.payoffs = w.payoffs.filter((p) => p.person !== person); };

  /** Can a payoff be shown right now? Plays it and returns the scene if so. */
  D.check = () => {
    const pl = w.player;
    if (pl.busy || w.t - w.lastScene < SCENE_GAP) return null;
    for (const p of w.payoffs) {
      if (w.t < p.notBefore || !w.alive(p.person)) continue;
      w.whereIs(p.person, w.t, where);
      if (!where.outside || (where.x - pl.x) ** 2 + (where.y - pl.y) ** 2 > RANGE * RANGE) continue;
      return play(p, where.x, where.y);
    }
    return null;
  };

  function play(p, x, y) {
    const ev = w.events.get(p.event), v = p.victim, me = p.person;
    const ps = w.people.get(me);
    const rel = w.rules.relation(me, v) ?? 'friend';
    const first = census.firstName(v), He = census.sex[v] ? 'She' : 'He', he = He.toLowerCase();
    const days = ev ? Math.floor((w.t - ev.t) / DAY) : null;
    const job = w.jobOf(v), home = B[census.home[me]];
    const lines = [];
    let cue;
    if (p.type === 'confront') {
      cue = `${census.name(me)} stops the player on the pavement.`;
      lines.push('You. I know your face.');
      if (ev && job && ev.place === census.work[v]) lines.push(`My ${rel} ${first} was ${job}, on ${B[ev.place].street}. ${He} went to work and never came home.`);
      else if (ev) lines.push(`You killed my ${rel} ${first} ${ev.place >= 0 ? 'at ' + w.placeName(ev.place) : 'in ' + city.districts[ev.district].name}.${job ? ` ${He} was ${job}.` : ''}`);
      else lines.push(`You killed my ${rel} ${first}.`);
      if (ps && ps.flags & FLAG.HOMELESS) lines.push(`I lost the ${home.kind === 'house' ? 'house' : 'flat'} on ${home.street} after ${he} died. This pavement is where I live now.`);
      else if (ps && ps.flags & FLAG.EVICTED) lines.push(`We lost our home on ${home.street} after ${he} died.`);
      else if (days !== null) lines.push(`${days} days. I have counted every one.`);
    } else {
      cue = `${census.name(me)} steps out with a pistol.`;
      lines.push(p.gang ? `${first} was one of ours.` : `${first} was my ${rel}.`);
      lines.push('Did you think nobody would come?');
    }
    const scene = { t: w.t, type: p.type, person: me, name: census.name(me), victim: v, event: p.event, x, y, cue, lines };
    w.scenes.push(scene);
    w.lastScene = w.t;
    w.payoffs = w.payoffs.filter((q) => q !== p);
    w.note(`Scene: ${cue} "${lines.join(' ')}"`, { scene: true, people: [me], event: p.event });
    return scene;
  }

  /** The pending payoffs with names, for a debug panel. */
  D.pending = () => w.payoffs.map((p) => ({
    ...p, name: census.name(p.person), victimName: census.name(p.victim),
    homeless: w.archOf(p.person) === ARCH.HOMELESS, ready: w.t >= p.notBefore,
  }));
}
