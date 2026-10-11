"use strict";
/* src/battle/state.js — NPC War: STATE: the one battle's live state.
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

/* set in onBoot below (they need THREE / the raised world) */
let _upV, _fwV, _v, _v2, _muz, sWorld;

/* ============================================================ STATE */
const V = function () { return new THREE.Vector3(); };
CBZ.npcwar.onBoot(function () {
  _upV = V();          // probe scratch: a corpse's own up axis
  _fwV = V();          // probe scratch: a corpse's own nose axis
});
const BITES = { landed: 0, missed: 0 };   // probe: jaw contact, counted
/* HOW MANY BODIES HAVE BEEN HANDED TO A SOLVER (and not yet retired). The
   two corpse solvers are stepped from the innermost sub-step loop, and this
   page has already been bitten once by adding work there: a battle of
   riflemen is held to zero overlapping bodies, which is a knife edge a
   shoulder either crosses or does not. Until the first body falls there is
   nothing to solve and nothing to enter — one integer read, and the opening
   of every battle costs exactly what it always did. (It counts bodies, not
   ACTIVE solves: a settled corpse still holds its slot and its frozen pose,
   and the solvers skip it themselves in one test.) */
let deadSolving = 0;
CBZ.npcwar.onBoot(function () {
  _v = V(),
    _v2 = V(),
    _muz = V();
});
let world = null, base = null, town = null, MAP = null, hud = null;
let men = [], corpses = [], rockets = [], dropGuns = [], planes = [];
const squads = { red: [], blue: [] };
const AIR = { on: false, nuke: false, nukeAt: 42 };   // nukeAt rescaled at begin: it must land ON a battle, not after one
let started = false, over = false, simT = 0, speed = 1, lastSpeed = 1;
/* HOW LONG UNTIL THIS PAGE SHOWED YOU SOMETHING. The water arena's whole
   claim is that it is CHEAP — "a lightweight test arena" — and a claim about
   cost that nobody measured is a claim about nothing. performance.now() in a
   page context counts from navigation start, so stamping it on the first
   frame IS time-to-first-frame, load included, with no clock to keep. */
let firstFrameAt = 0, winner = null;
let bench = null;
const stats = { red: { kills: 0, shots: 0, hits: 0 }, blue: { kills: 0, shots: 0, hits: 0 } };
/* THE LEDGER, PER MAN AND PER GUN. The team totals above answer "who won";
   they cannot answer "how is THIS man doing", which is the only question a
   camera parked on his shoulder makes you ask. Every man carries his own
   kills/shots/hits/reloads (see makeMan), and each gun keeps the same four
   across everyone carrying it — so MIXED and EVERYTHING finally settle the
   argument they were always implicitly starting. */
const GUNS = {};
function gunLedger(wid) {
  let g = GUNS[wid];
  if (!g) g = GUNS[wid] = { shots: 0, hits: 0, kills: 0, reloads: 0, men: 0 };
  return g;
}
const shotsRing = [];          // recent fire positions, feeds the director
const spawnQueue = [];
let spawnTotal = 0;
CBZ.npcwar.onBoot(function () {

  // seeded streams — the determinism law reaches world layout and combat alike
  sWorld = CBZ.seedStream("npcwar-world");
});
let _s = 421371;
function lcg() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }
