// District mood: four numbers per district, rising with what happens there and fading with
// time. They are the cheap half of "the world remembers": no per-person work at all.

const HALF_LIFE = { fear: 20, violence: 30, damage: 60 }; // game days
const keep = (days) => 2 ** (-1 / days);
const clamp = (v) => Math.min(1, Math.max(0, v));

export function createMood(w) {
  const D = w.city.districts, nd = D.length;
  const M = (w.mood = {
    fear: new Float32Array(nd),
    violence: new Float32Array(nd),
    policing: new Float32Array(nd),
    damage: new Float32Array(nd), // how far prosperity is below what is normal for the district
    emptyHomes: new Int32Array(nd),
    // what has happened here in total; individual events fold into these and are forgotten
    kills: new Int32Array(nd),
    injuries: new Int32Array(nd),
    robberies: new Int32Array(nd),
  });

  const homes = new Float64Array(nd);
  for (const b of w.city.buildings) homes[b.district] += b.homes;
  /** A home stands empty (an eviction, a family gone): the district is a little poorer for it. */
  w.homeEmptied = (d) => {
    M.emptyHomes[d]++;
    M.damage[d] = clamp(M.damage[d] + Math.min(0.02, 4 / Math.max(1, homes[d])));
  };

  /** Something frightening or violent happened. Adds toward 1, never past it. */
  w.moodHit = (d, fear, violence) => {
    M.fear[d] = 1 - (1 - M.fear[d]) * (1 - clamp(fear));
    M.violence[d] = 1 - (1 - M.violence[d]) * (1 - clamp(violence));
  };

  /** One game day passes: fear and violence fade, policing follows violence a few days behind. */
  w.moodDay = () => {
    for (let d = 0; d < nd; d++) {
      M.fear[d] *= keep(HALF_LIFE.fear);
      M.violence[d] *= keep(HALF_LIFE.violence);
      M.policing[d] += (M.violence[d] - M.policing[d]) * (1 - keep(3));
      M.damage[d] = clamp(M.damage[d] * keep(HALF_LIFE.damage) + M.fear[d] * 0.004);
    }
  };

  w.prosperity = (d) => clamp(D[d].baseProsperity - M.damage[d]);

  /** A district's mood and what it does to the street, for the game and for a debug panel. */
  w.districtReport = (d) => {
    const fear = M.fear[d], violence = M.violence[d], policing = M.policing[d];
    return {
      id: d, name: D[d].name, kind: D[d].kind, gang: D[d].gang,
      fear, violence, policing, prosperity: w.prosperity(d), baseProsperity: D[d].baseProsperity,
      emptyHomes: M.emptyHomes[d], kills: M.kills[d], injuries: M.injuries[d], robberies: M.robberies[d],
      effects: {
        armedShare: Math.min(0.6, 0.03 + 0.45 * fear), // civilians who carry and fight back
        nightLife: 1 - 0.8 * fear, // how many go out after dark, against normal
        patrolsPerHour: Math.round(1 + 6 * policing),
        responseMinutes: +(6 - 4 * policing).toFixed(1),
        shopsShutEarly: fear > 0.45,
        boardedUp: M.damage[d] > 0.12,
        gangBoldness: D[d].gang ? clamp(0.3 + violence - policing) : 0,
      },
    };
  };
}
