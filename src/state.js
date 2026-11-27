// What play changes about a person. The census is never modified; a person something has
// happened to gets one of these records, and the save stores only these.

export const FLAG = {
  DEAD: 1,
  EVICTED: 2,
  HOMELESS: 4,
  MOVED: 8, // left the city
  KNOWS: 16, // knows the player's face
  HOSTILE: 32, // looking for the player
  ARMED: 64,
  ROBBED: 128,
};
export const FLAG_NAMES = ['dead', 'evicted', 'homeless', 'moved away', 'knows your face', 'hostile', 'armed', 'robbed'];

export function newPersonState() {
  return {
    flags: 0,
    home: -1, // building he lives in now, if not the census one
    arch: -1, // archetype now, if not the census one
    spot: -1, // building whose pavement a homeless person keeps to
    griefUntil: 0, // game minutes
    leaveUntil: 0, // off work until
    fearUntil: 0,
    hurtUntil: 0,
    armedUntil: 0,
    trauma: 0, // how hard grief and fear have struck, counted per incident
    shockAt: -1e9, // when the last incident was
    leaving: false, // has decided to leave the city
    knows: [], // events he knows the player was behind
    avoid: [], // buildings he keeps away from
    mourns: [], // people he has lost
  };
}

/** The flags as words, including the ones that wear off. */
export function describeState(ps, t) {
  if (!ps) return [];
  const out = [];
  FLAG_NAMES.forEach((n, i) => { if (ps.flags & (1 << i)) out.push(n); });
  if (ps.griefUntil > t) out.push('grieving');
  if (ps.leaveUntil > t) out.push('off work');
  if (ps.fearUntil > t) out.push('afraid');
  if (ps.hurtUntil > t) out.push('injured');
  return out;
}
