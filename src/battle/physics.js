"use strict";
/* src/battle/physics.js — NPC War: THE GRID + BODIES + THE WAY THROUGH.
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

/* ============================================================ THE GRID
   Target search over thousands of men cannot be O(n squared). One uniform
   grid, rebuilt on a slow tick, queried in rings. */
const GRID_CELL = 14;
const grid = new Map();
let gridAt = -1;
function gridKey(cx, cz) { return cx * 73856093 ^ cz * 19349663; }
function rebuildGrid() {
  grid.clear();
  for (let i = 0; i < men.length; i++) {
    const m = men[i];
    if (m.dead || m.fled) continue;
    const k = gridKey(Math.floor(m.pos.x / GRID_CELL), Math.floor(m.pos.z / GRID_CELL));
    let a = grid.get(k);
    if (!a) { a = []; grid.set(k, a); }
    a.push(m);
  }
  gridAt = simT;
}
function nearestEnemy(m, range) {
  const cx = Math.floor(m.pos.x / GRID_CELL), cz = Math.floor(m.pos.z / GRID_CELL);
  const maxR = Math.ceil(range / GRID_CELL);
  let best = null, bd = range * range;
  for (let r = 0; r <= maxR; r++) {
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;   // ring shell only
      const a = grid.get(gridKey(cx + dx, cz + dz));
      if (!a) continue;
      for (let i = 0; i < a.length; i++) {
        const o = a[i];
        if (o.team === m.team || o.dead || o.downed) continue;
        const d = (o.pos.x - m.pos.x) * (o.pos.x - m.pos.x) + (o.pos.z - m.pos.z) * (o.pos.z - m.pos.z);
        if (d < bd) { bd = d; best = o; }
      }
    }
    if (best && r > 1) break;    // a full ring past the first hit is enough
  }
  return best;
}
/* THE NEAREST MAN IS NOT THE MAN YOU CAN SHOOT. On open sand those are the
   same sentence and the old code was right; put a city under it and the
   nearest enemy is routinely three buildings away, so every soldier locked
   onto somebody he could not see, waited out 2.6 s of `losBadT`, and
   assaulted a facade while a clean target stood in the street beside him.
   So: gather the near candidates, and prefer one there is a line to. The
   LOS tests only happen on a RE-target — a man keeps his mark until it dies
   or the dead-end timer gives up on it — so this is a handful of segment
   tests per casualty, not per frame. */
/* AND ONLY MEN HE COULD HAVE NOTICED. The candidates used to be every enemy
   inside SIGHT on every bearing, and when none of them had a line the man
   took the NEAREST ANYWAY and walked at him — radar, through a hill, behind
   his own back. Now a candidate has to pass CBZ.brain.perception (the
   brain's one sight test): the soldier archetype's range, a ~200 degree
   field of view off m.yaw (a human's, so the front of a line sees the whole
   front of the other), and a 10 m touch radius. The LOS rays below still
   decide who is actually visible (occlude:false here, so the brain does not
   cast a second ray), and "nobody visible: go to the nearest" now means the
   nearest he could have SEEN go behind that wall. Nobody in his field at all
   is no mark: marchGoal and the squad's shared contact bring him in, and
   the man who shoots him is his mark anyway (hurtMan). What this buys: a
   FLANK is a flank. A column coming round the rear is not answered by every
   man turning at once on the frame it enters range. Pure arithmetic on
   positions and yaw: the seeded replay stays identical. */
const SPOT = { range: 0, fovHalf: 1.75, touch: 10, occlude: false };   // range set per call
const _cand = [];
function pickTarget(m, range) {
  SPOT.range = range;
  const cx = Math.floor(m.pos.x / GRID_CELL), cz = Math.floor(m.pos.z / GRID_CELL);
  const maxR = Math.ceil(range / GRID_CELL);
  _cand.length = 0;
  for (let r = 0; r <= maxR; r++) {
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const a = grid.get(gridKey(cx + dx, cz + dz));
      if (!a) continue;
      for (let i = 0; i < a.length; i++) {
        const o = a[i];
        // a wounded man on the ground is out of the fight, not a mark (ai/squad.js)
        if (o.team === m.team || o.dead || o.downed) continue;
        // an aircraft is only a mark for what can reach it
        if (o.air && !vehicleCanTarget(m, o)) continue;
        const d2 = (o.pos.x - m.pos.x) * (o.pos.x - m.pos.x) + (o.pos.z - m.pos.z) * (o.pos.z - m.pos.z);
        if (d2 < range * range && CBZ.brain.perception.sees(m, o, SPOT)) _cand.push(o, d2);
      }
    }
    if (_cand.length >= 12 && r > 1) break;
  }
  // a tiered battle: the rows round the ring are marks too, handed over as ghosts
  if (MASS.on && _cand.length < 24) MASS.cands(m, range, _cand, SPOT);
  if (!_cand.length) return null;
  // nearest first, then the first four get asked whether they can be seen
  let bestO = null, bestD = 1e18;
  for (let i = 0; i < _cand.length; i += 2) if (_cand[i + 1] < bestD) { bestD = _cand[i + 1]; bestO = _cand[i]; }
  // (a MID man asks two sight lines, a FAR one one: the LOD tiers' budget —
  // m.aiTier from ai/squad.js; a FULL man and everything else asks four)
  let tries = 0;
  const maxTries = m.aiTier === 2 ? 1 : m.aiTier === 1 ? 2 : 4;
  while (tries < maxTries) {
    let o = null, od = 1e18, oi = -1;
    for (let i = 0; i < _cand.length; i += 2) {
      if (_cand[i] && _cand[i + 1] < od) { od = _cand[i + 1]; o = _cand[i]; oi = i; }
    }
    if (!o) break;
    _cand[oi] = null;
    tries++;
    if (eyeLos(m, o)) return o;
  }
  return bestO;               // nobody visible: take the nearest and go to him
}
/* ============================================================ BODIES
   A MAN IS 0.52 m ACROSS THE SHOULDERS AND THE GRID WAS 14 m WIDE.

   The old separation pass ran on the TARGET-SEARCH grid, and the two jobs
   want opposite cells: target search wants cells big enough that a 175 m
   look is a handful of lookups, separation wants cells at BODY scale. On a
   14 m cell it could only ever be wrong in three ways at once, and all
   three were measured:

     • it never compared across a cell boundary, so two men 0.2 m apart on
       opposite sides of an invisible line interpenetrated forever;
     • it capped the inner loop at five neighbours (`i + 6`), so in the
       press of a real fight most pairs in the same cell were skipped, and
       WHICH five depended on spawn order;
     • it fired at 1.0 m, which for a 0.52 m body is contact, not clearance.

   So bodies get their own grid at 2.4 m — wide enough that a 0.9 m
   clearance test only ever needs the cell and its four FORWARD neighbours,
   which visits every pair exactly once — rebuilt every sub-step, because a
   stale body grid is exactly the thing that lets two men swap cells and
   stop seeing each other. */
const SEP = 0.9;               // centre-to-centre clearance two men keep
/* AND THE CELL FOLLOWS THE BIGGEST BODY ON THE FIELD.

   2.4 m is "wider than two men", which is what makes the four-neighbour fan
   below a COMPLETE sweep: two bodies further apart than one cell can never
   be touching, so they never need comparing. The moment an army is lions
   that arithmetic breaks — a lion pair owes each other 2.6 m of clearance,
   more than the cell, so the pairs that mattered most were exactly the ones
   the sweep was allowed to skip. Measured on 120 lions v 400 dogs before
   this: 32 overlapping pairs at peak, the worst pair 84% inside each other.

   So the cell is sized off the widest body that has actually spawned, and
   the completeness bound holds by construction: FINE > 2 * maxRadius >=
   every pair clearance. An army of men never grows it (the max stays 0.45)
   and pays nothing. */
let FINE = 2.4;
let bodyRadMax = 0.45;
function noteBodyRadius(r) {
  if (!(r > bodyRadMax)) return;
  bodyRadMax = r;
  FINE = Math.max(2.4, r * 2 + 0.25);
}
const fine = new Map();
function rebuildFine() {
  fine.clear();
  for (let i = 0; i < men.length; i++) {
    const m = men[i];
    if (m.dead) continue;
    if (!PHYS.mixed && (m.beast || m.vehicle)) PHYS.mixed = true;   // bodies of another weight: momentum matters now
    const k = gridKey(Math.floor(m.pos.x / FINE), Math.floor(m.pos.z / FINE));
    let a = fine.get(k);
    if (!a) { a = []; fine.set(k, a); }
    a.push(m);
  }
}
// the four cells that make each pair appear once: same cell (j > i), then
// E, NE, N, NW. Anything closer than one cell is inside this fan.
const FAN = [[1, 0], [1, 1], [0, 1], [-1, 1]];
let sepFixed = 0;
function separatePass(k) {
  if (SEP_OLD) { separateOld(k); return 0; }
  sepFixed = 0;
  fine.forEach(function (a, key) {
    for (let i = 0; i < a.length; i++) {
      const m = a[i];
      if (m.dead) continue;
      for (let j = i + 1; j < a.length; j++) push2(m, a[j], k);
      const cx = Math.floor(m.pos.x / FINE), cz = Math.floor(m.pos.z / FINE);
      for (let f = 0; f < 4; f++) {
        const b = fine.get(gridKey(cx + FAN[f][0], cz + FAN[f][1]));
        if (!b) continue;
        for (let j = 0; j < b.length; j++) push2(m, b[j], k);
      }
    }
  });
  return sepFixed;
}
/* ONE SWEEP IS NOT A SOLVER.

   A single relaxation pass fixes any pair it looks at — and then the next
   pair moves one of them back. In open order that is invisible (a man's
   residual is under a shoulder width); in a crush of four hundred dogs
   converging on a pride it is not, because every body is inside several
   constraints at once and each correction partly cancels the last. The
   probe proved it was this and not a hole in the grid: instrumented with
   the grid's OWN sweep, the survivors after one pass matched the O(n^2)
   count exactly, 33 for 33 — nothing was being missed, everything was
   being undone.

   So the pass runs until it converges, up to three sweeps, rebuilding the
   body grid between them because the bodies have moved. It stops the
   instant a sweep corrects nothing, so open order still costs exactly one
   sweep, and a battle of men — whose radii never grow past 0.45 — never
   enters the loop at all. */
function separateSolve(k) {
  const fixed = separatePass(k);
  if (!fixed || bodyRadMax <= 0.5) return;
  for (let it = 0; it < 2; it++) {
    rebuildFine();
    if (!separatePass(k)) return;
  }
}
function push2(m, o, k) {
  if (o.dead || o === m) return;
  // a hull is a box and is not shoved by a man (src/battle/vehicles.js)
  if (m.vehicle || o.vehicle) { pushVehicle(m, o, k); return; }
  // a held or airborne body is somewhere the crowd solver has no say over:
  // shoving it out of the gorilla's fist (or out of its own flight arc) is
  // the pass correcting an "overlap" that is the entire point of the move
  if (o._apeHeld || m._apeHeld || o._apeFlying || m._apeFlying) return;
  if (o._tossed || m._tossed) return;      // in a trunk, or in the air (flyStep)
  // clearance is the PAIR's, not the species': a man by a man keeps the old
  // 0.9, a man by a bear keeps more, and the radii are clamped at build so
  // the widest pair (2.2) still fits the FINE cell's completeness bound
  const clr = (m.rad || 0.45) + (o.rad || 0.45);
  const dx = o.pos.x - m.pos.x, dz = o.pos.z - m.pos.z;
  const d2 = dx * dx + dz * dz;
  if (d2 > clr * clr) return;
  let d = Math.sqrt(d2), ux, uz;
  if (d < 1e-4) {
    // exactly co-located: a deterministic bearing off the pair's own ids,
    // never Math.random — two men in the same spot must part the same way
    // every run or the battle stops being reproducible
    const a = ((m.i * 37 + o.i * 91) % 360) * Math.PI / 180;
    ux = Math.cos(a); uz = Math.sin(a); d = 1e-4;
  } else { ux = dx / d; uz = dz / d; }
  // A DEEP OVERLAP IS NOT A SPRING. Relaxation at k≈0.4 walks two men apart
  // over a few frames, which is right for a crowd easing itself out and
  // wrong for two bodies genuinely inside each other — that has to be gone
  // THIS step or it is on screen. Inside shoulder width the correction is
  // full; outside it, the soft pass keeps the crowd from jittering.
  const total = (clr - d) * (d < clr * 0.69 ? 1 : k);
  /* AND THE SHOVE IS SPLIT BY MASS. It used to be 50/50 whoever the two
     were, which is how a crowd of men walked a six-tonne bull elephant
     backwards at up to 13 m/s (measured, 100 men v 1 bull, node sim): every
     man that touched it moved it as far as it moved him. Contact is a
     momentum question: each body gives way in proportion to the OTHER one's
     mass, so a man by a man is still exactly half each (equal masses, the
     same arithmetic to the last bit, which keeps the riflemen's overlapPeak
     where it was), a man against an elephant takes 98.7% of it, and a
     hundred men leaning on a bull move it by what a hundred 80 kg bodies
     can: about nothing. */
  const km = bodyKg(m), ko = bodyKg(o);
  const wm = km === ko ? 0.5 : ko / (km + ko);
  const pm = total * wm, po = total - pm;
  m.pos.x -= ux * pm; m.pos.z -= uz * pm;
  o.pos.x += ux * po; o.pos.z += uz * po;
  // a heavy body MOVING into a light one is not a shove, it is an impact
  if (PHYS.mixed && (km > ko * 3 || ko > km * 3)) contactImpulse(m, o, ux, uz, km, ko);
  sepFixed++;
  // a shove is a move, and a move has to answer to the walls. Marking them
  // makes the NEXT step resolve them instead of every one of them now: a
  // body squeezed into a crate is invisible to every line of sight, so it
  // is immortal, and a battle with an immortal in it cannot end.
  m.resT = 0; o.resT = 0;
}
// One shove, resolved against the world, reporting how much of it SURVIVED
// along the axis it was aimed down. That number is the whole mechanism of
// the pinned pass below: it is how a body finds out that a wall said no.
function shove(m, ux, uz, amt) {
  const x0 = m.pos.x, z0 = m.pos.z;
  m.pos.x += ux * amt; m.pos.z += uz * amt;
  CBZ.micro.resolveCircle(m.pos, (m.rad || 0.45) + 0.05, m.pos.y, 1.8);
  return (m.pos.x - x0) * ux + (m.pos.z - z0) * uz;
}
/* ---- THE PINNED PAIR, and it is why walls were the last overlap left ----

   separateSolve above already answers the CROWD half of this: a body belongs
   to several pairs at once, so the shove that clears it of B walks it back
   into C, and it sweeps again until nothing moves. What no number of sweeps
   can answer is a WALL, because a wall does not take its half of the shove:
   separation puts him into the facade, the next step's resolveCircle puts
   him straight back out — which is straight back into the man he was cleared
   from — and the two of them oscillate in a doorway for as long as they both
   want to stand there. MEASURED, 26 v 26, 90 s: overlapPeak 0 on island,
   field, dunes and the kill box, and 3 on `city`, the one map made of walls.

   So a final pass runs over what the sweeps could not fix, and only over
   that — pairs still inside their own overlap line, which after convergence
   is a handful in a battle and usually none. It asks the world instead of
   assuming it:

     1. shove each man his half and see how much the world let him keep;
     2. hand what a wall refused to the OTHER man, who is the one with
        somewhere to go;
     3. if neither has, part them ALONG the wall rather than into it, on a
        bearing off their own ids so it is the same every run;
     4. and if the geometry genuinely cannot seat two men, separate them
        anyway without asking, because a frame drawn with two bodies inside
        each other is the fault being counted. resT = 0 hands them back to
        the world on the next step, where a wall gets the last word.        */
function pinnedPass() {
  fine.forEach(function (a) {
    for (let i = 0; i < a.length; i++) {
      const m = a[i];
      if (m.dead) continue;
      for (let j = i + 1; j < a.length; j++) unpin(m, a[j]);
      const cx = Math.floor(m.pos.x / FINE), cz = Math.floor(m.pos.z / FINE);
      for (let f = 0; f < 4; f++) {
        const b = fine.get(gridKey(cx + FAN[f][0], cz + FAN[f][1]));
        if (!b) continue;
        for (let j = 0; j < b.length; j++) unpin(m, b[j]);
      }
    }
  });
}
function unpin(m, o) {
  if (o.dead || o === m) return;
  if (m.vehicle || o.vehicle) return;      // pushVehicle already put him outside the hull
  if (o._tossed || m._tossed || o._apeHeld || m._apeHeld || o._apeFlying || m._apeFlying) return;
  // the PAIR's clearance and the PAIR's overlap line, exactly as push2 and
  // the probe read them — a lion pinned against a hangar is the same fault
  // as a man pinned against a facade, and a man's numbers are still 0.9/0.62
  const clr = (m.rad || 0.45) + (o.rad || 0.45);
  const deep = clr * 0.69;
  let dx = o.pos.x - m.pos.x, dz = o.pos.z - m.pos.z;
  if (dx * dx + dz * dz >= deep * deep) return;            // the common case: nothing to do
  let d = Math.sqrt(dx * dx + dz * dz), ux, uz;
  if (d < 1e-4) {
    const ang = ((m.i * 37 + o.i * 91) % 360) * Math.PI / 180;
    ux = Math.cos(ang); uz = Math.sin(ang); d = 1e-4;
  } else { ux = dx / d; uz = dz / d; }
  // by mass, as push2: the heavy body keeps its ground and the light one
  // is the one that finds somewhere to go
  const km = bodyKg(m), ko = bodyKg(o);
  const wm = km === ko ? 0.5 : ko / (km + ko);
  const pushM = (clr - d) * wm, pushO = (clr - d) - pushM;
  const gotM = shove(m, -ux, -uz, pushM);
  const gotO = shove(o, ux, uz, pushO);
  const owed = Math.max(0, pushM - gotM) + Math.max(0, pushO - gotO);
  if (owed > 0.01) {
    if (pushM - gotM > 0.01) shove(o, ux, uz, owed);
    else if (pushO - gotO > 0.01) shove(m, -ux, -uz, owed);
  }
  dx = o.pos.x - m.pos.x; dz = o.pos.z - m.pos.z;
  if (dx * dx + dz * dz < deep * deep) {
    const sgn = ((m.i * 37 + o.i * 91) & 1) ? 1 : -1;
    shove(m, uz * sgn, -ux * sgn, deep * wm * 2);          // along the wall
    shove(o, -uz * sgn, ux * sgn, deep * (1 - wm) * 2);
    dx = o.pos.x - m.pos.x; dz = o.pos.z - m.pos.z;
    if (dx * dx + dz * dz < deep * deep) {
      // nowhere left to put them: the frame wins, the world gets the next step
      const e0 = deep - Math.sqrt(dx * dx + dz * dz);
      const eM = km === ko ? e0 * 0.5 + 0.01 : (e0 + 0.02) * wm;
      const eO = km === ko ? eM : (e0 + 0.02) * (1 - wm);
      m.pos.x -= ux * eM; m.pos.z -= uz * eM;
      o.pos.x += ux * eO; o.pos.z += uz * eO;
    }
  }
  m.resT = 0; o.resT = 0;
}
/* THE PASS THIS ONE REPLACED, kept so the claim is two-sided: ?sep=old and
   the overlap count has to come BACK. A fix that cannot be turned off has
   not been measured, it has been asserted. */
function separateOld(k) {
  grid.forEach(function (a) {
    for (let i = 0; i < a.length; i++) {
      const m = a[i];
      if (m.dead) continue;
      const jEnd = Math.min(a.length, i + 6);
      for (let j = i + 1; j < jEnd; j++) {
        const o = a[j];
        if (o.dead) continue;
        const dx = o.pos.x - m.pos.x, dz = o.pos.z - m.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 1.0 || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = (1.0 - d) * 0.5 * k / d;
        m.pos.x -= dx * push; m.pos.z -= dz * push;
        o.pos.x += dx * push; o.pos.z += dz * push;
      }
    }
  });
}
/* DID THE PASS ACTUALLY DO ITS JOB? The probe's overlap count is O(n^2) and
   deliberately shares none of the grid's assumptions, which makes it honest
   about the RESULT and silent about the CAUSE: a pair can survive because
   the pass never visited it (a grid that is not complete) or because it was
   visited and something moved it back. This counts the survivors using the
   grid's OWN sweep immediately after the pass — so a residual of zero here
   beside a non-zero probe means the grid is missing pairs, and a residual
   that matches the probe means the pass is being fought. */
let sepResid = 0;
function sepResidual() {
  let n = 0;
  fine.forEach(function (a) {
    for (let i = 0; i < a.length; i++) {
      const m = a[i];
      if (m.dead) continue;
      const cx = Math.floor(m.pos.x / FINE), cz = Math.floor(m.pos.z / FINE);
      for (let j = i + 1; j < a.length; j++) n += tooClose(m, a[j]);
      for (let f = 0; f < 4; f++) {
        const b = fine.get(gridKey(cx + FAN[f][0], cz + FAN[f][1]));
        if (!b) continue;
        for (let j = 0; j < b.length; j++) n += tooClose(m, b[j]);
      }
    }
  });
  return n;
}
function tooClose(m, o) {
  if (o.dead || o === m) return 0;
  if (Math.abs(m.pos.y - o.pos.y) >= 1.8) return 0;
  const need = 0.69 * ((m.rad || 0.45) + (o.rad || 0.45));
  const dx = o.pos.x - m.pos.x, dz = o.pos.z - m.pos.z;
  return (dx * dx + dz * dz) < need * need ? 1 : 0;
}
// NEIGHBOURS, for anything that needs to ask about bodies rather than push
// them: the fire-discipline lane test, and the director.
const _fine1 = [];
function fineNear(x, z, r, out) {
  out = out || _fine1;
  out.length = 0;
  const x0 = Math.floor((x - r) / FINE), x1 = Math.floor((x + r) / FINE);
  const z0 = Math.floor((z - r) / FINE), z1 = Math.floor((z + r) / FINE);
  for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
    const a = fine.get(gridKey(cx, cz));
    if (a) for (let i = 0; i < a.length; i++) out.push(a[i]);
  }
  return out;
}
/* ============================================================ THE WAY THROUGH
   A MAN IS NOT A PATHFINDER — AND IN A CITY THAT IS NOT SURVIVABLE.

   Measured, first build on the real downtown: 25 of 40 men in slot "push",
   `cool` at -28 s, both armies 135 m apart with eight blocks of masonry
   between them and not a shot fired for half a minute. The wall-slide
   detour is the right instinct for a crate and hopeless against a city
   block: a man walks into the Exchange Bank, slides 1.5 s along the
   facade, turns back into it, and does that until the clock runs out.

   So the ground gets a FLOW FIELD, and it is multi-source on purpose. Seed
   Dijkstra from EVERY living enemy at once and the resulting field is
   "path distance to the nearest enemy" — one solve, and each man descending
   it walks toward whichever opponent is genuinely closest THROUGH the
   streets, not the one closest as the crow flies. Seeding from a centre of
   mass instead funnels an army into a single point, which is what the first
   draft did and what the corner-bunching in the measurement was.

   Cells are 4 m: a 15 m street is three of them wide, and a 490 m town is
   22 500 cells, which Dial's bucket queue clears in about a millisecond.
   The blocked map is built ONCE, because buildings do not move; the field
   is re-solved on a slow tick, because men do. */
const NAV = { cell: 4, x0: 0, z0: 0, w: 0, h: 0, block: null, on: false,
  dist: { red: null, blue: null }, at: { red: -9, blue: -9 }, solves: 0, blocked: 0 };
function navBuild(cx, cz, radius) {
  const C = NAV.cell;
  const w = Math.max(8, Math.ceil(radius * 2 / C));
  NAV.x0 = cx - radius; NAV.z0 = cz - radius; NAV.w = w; NAV.h = w;
  const block = new Uint8Array(w * w);
  let blocked = 0;
  for (let iz = 0; iz < w; iz++) for (let ix = 0; ix < w; ix++) {
    if (blockedAt(NAV.x0 + (ix + 0.5) * C, NAV.z0 + (iz + 0.5) * C)) { block[iz * w + ix] = 1; blocked++; }
  }
  NAV.block = block; NAV.blocked = blocked;
  // NOTHING IN THE WAY MEANS NO FIELD. On open sand a gradient is a worse
  // straight line than a straight line, and the solve is pure cost.
  NAV.on = blocked > 24;
  NAV.dist.red = new Uint16Array(w * w);
  NAV.dist.blue = new Uint16Array(w * w);
  NAV.at.red = NAV.at.blue = -9;
  return NAV.on;
}
/* THE SOLVE ITSELF IS core/flow.js (CBZ.battleFlow): one Dial solver for the
   FULL brains here and for the MID / FAR sims (core/tiersim.js), which run
   the same code in the page or in the worker. This side only says where the
   enemy is: every living body on the other side, and in a tiered battle the
   rows nobody built a rig for (MASS.seedNav). */
let _navSeeds = new Int32Array(1024);
function navSolve(team) {
  const w = NAV.w, C = NAV.cell, d = NAV.dist[team];
  if (!d) return 0;
  let n = 0;
  const seed = function (x, z) {
    const ix = ((x - NAV.x0) / C) | 0, iz = ((z - NAV.z0) / C) | 0;
    if (ix < 0 || iz < 0 || ix >= w || iz >= w) return;
    if (n >= _navSeeds.length) { const g = new Int32Array(_navSeeds.length * 2); g.set(_navSeeds); _navSeeds = g; }
    _navSeeds[n++] = iz * w + ix;
  };
  for (let i = 0; i < men.length; i++) {
    const m = men[i];
    if (m.dead || m.team === team) continue;
    seed(m.pos.x, m.pos.z);
  }
  if (typeof MASS !== "undefined" && MASS.on) MASS.seedNav(team, seed);
  NAV.at[team] = simT;
  const seeded = CBZ.battleFlow.solve(NAV.block, w, w, _navSeeds, n, d);
  if (seeded) NAV.solves++;
  return seeded;
}
/* Descend the field a few cells and hand back where that lands. Three steps
   rather than one because a single-cell goal is 4 m away and makes a column
   walk in stair steps; three is far enough to read as a direction and near
   enough that the next think re-asks. */
function navStep(m, out) {
  if (!NAV.on) return false;
  const w = NAV.w, C = NAV.cell, d = NAV.dist[m.team];
  if (!d) return false;
  const ix = ((m.pos.x - NAV.x0) / C) | 0, iz = ((m.pos.z - NAV.z0) / C) | 0;
  const k = CBZ.battleFlow.step(d, w, w, ix, iz, 3);
  if (k < 0) return false;
  out.set(NAV.x0 + ((k % w) + 0.5) * C, 0, NAV.z0 + (((k / w) | 0) + 0.5) * C);
  return true;
}

const teamCOM = { red: { x: 0, z: 0 }, blue: { x: 0, z: 0 } };
const HUNT = { red: false, blue: false };

/* ============================================================ MASS AND MOMENTUM
   Bodies on this field were circles that pushed each other half and half,
   flew at whatever speed a move file typed, and fell at 18 m/s². This is the
   one place that knows what a body WEIGHS and what happens when it is hit:

     bodyKg(m)            kg. A hull's stats.mass, a species file's own
                          individual (m._mass: the bull is 6 t, the calf
                          0.4), else the anatomy row (weapons/ballistics.js)
                          x the individual's size cubed. A man is 80.
     contactImpulse       a heavy body MOVING into a light one (a charge):
                          momentum both ways, restitution 0.2. Men bounce off
                          a bull; the bull does not notice the men.
     addKnock(b, dvx, dvz, by, o)   a velocity change on a living body: it
                          slides on its feet against friction (stepKnock), a
                          man hit past 2.5 m/s goes down, past 5 m/s a body
                          light enough leaves the ground (flingBody).
     flingBody / stepTossed   a body in the air: ballistic at 9.81, walls
                          stop it (and hurt), bodies in its path are bowled by
                          momentum, the landing speed is the injury.
     blastBodies          NPC War's own detonation sweep (the mode's `blast`,
                          see damage.js): overpressure and impulse by scaled
                          distance, a push of impulse / mass, and the debris.
     impactDmg(b, dv)     blunt trauma from a velocity change, as a share of
                          the body's own hp (a big animal's hp already scales
                          with its size): nothing under 3 m/s, about half a
                          man at 11 m/s (a 6 m fall), all of him at 14.
     deathDv(m, imp)      the speed the killing blow left the body with, so
                          a ragdoll is thrown by momentum and not by cause.

   A WAR OF MEN PAYS NOTHING. Equal masses split a shove exactly as they always
   did (bit for bit), and the momentum passes only run once a body of another
   weight is on the field (PHYS.mixed) or something has been knocked. */
const MAN_KG = 80;
const PHYS_G = 9.81;            // m/s². The toss used 18: a man thrown by a trunk hung in the air like a stone
const PHYS = { mixed: false, knock: [], hulls: [], strike: false,
  audit: { impacts: 0, knocks: 0, downs: 0, flings: 0, landings: 0, wallSlams: 0, bowled: 0, crushes: 0, blasts: 0, maxDv: 0 } };
function bodyKg(m) {
  if (!m) return MAN_KG;
  if (m._mass > 0) return m._mass;
  if (!m.beast) return MAN_KG;
  const sp = m.species || {};
  let kg = 0;
  const B = CBZ.ballistics;
  if (B && B.anatomyOf && sp.id) { try { kg = +B.anatomyOf(sp.id, m).mass || 0; } catch (e) {} }
  if (!(kg > 0) && sp.mass > 0) kg = sp.mass;
  if (!(kg > 0)) { const s = sp.scale || 1; kg = 125 * s * s * s; }
  const k = m._sizeMul > 0 ? m._sizeMul : 1;
  kg *= k * k * k;
  m._mass = kg;              // one number: systems/bodymass.js reads the same field
  return kg;
}
function impactDmg(b, dv) {
  const x = dv - 3;
  if (!(x > 0)) return 0;
  const hp = (b.maxHp > 0 && b.maxHp < 1e8) ? b.maxHp : 100;
  return hp * 0.0085 * x * x;
}
// the speed a killing blow left a body with: its own momentum change, or the
// slide / flight it was already in when it died
function deathDv(m, imp) {
  let dv = 0;
  if (imp && imp.J > 0) dv = imp.J / bodyKg(m);
  const kv = Math.hypot(m.kvx || 0, m.kvz || 0);
  if (kv > dv) dv = kv;
  const T = m._tossed;
  if (T && T.vx != null) { const tv = Math.hypot(T.vx, T.vy, T.vz); if (tv > dv) dv = tv; }
  return dv;
}

/* HOW FAST EACH BODY IS GOING, measured as what it did THIS sub-step under
   its own legs (and its own slide): where it was before stepMan, where it is
   after. Never across the separation pass: a deep overlap corrected by a
   metre in one step is not a man running at 20 m/s, and reading it as one
   fed every shove back in as a collision (measured: 22 m/s "impacts" in a
   crowd). physPre also lists the hulls a run-over can be asked about. */
const V_CAP = 16;
function physPre(sdt) {
  if (!PHYS.mixed && !PHYS.knock.length) return;
  PHYS.hulls.length = 0;
  for (let i = 0; i < men.length; i++) {
    const m = men[i];
    if (m.dead) continue;
    m._px = m.pos.x; m._pz = m.pos.z;
    if (m.vehicle && !m.air) PHYS.hulls.push(m);
  }
}
function physMid(sdt) {
  if (!PHYS.mixed && !PHYS.knock.length) return;
  const inv = 1 / Math.max(1e-4, sdt);
  for (let i = 0; i < men.length; i++) {
    const m = men[i];
    if (m.dead || m._px == null) continue;
    let vx = (m.pos.x - m._px) * inv, vz = (m.pos.z - m._pz) * inv;
    const v = Math.hypot(vx, vz);
    if (v > V_CAP) { vx *= V_CAP / v; vz *= V_CAP / v; }
    m._vx = vx; m._vz = vz;
  }
}

/* A HEAVY BODY MOVING INTO A LIGHT ONE. Called by push2 for a pair whose
   masses differ by 3x or more. The closing speed along the line between
   them is a collision: J = (1 + e) v m1 m2 / (m1 + m2), each takes J over
   its own mass. A bull at 6 m/s into a man: he leaves at 7 m/s and goes
   down; the bull loses 0.1 m/s. A crowd leaning on a standing bull has no
   closing speed and is just a shove (mass-split above). */
const RESTITUTION = 0.2;
function contactImpulse(m, o, ux, uz, km, ko) {
  const vrel = ((m._vx || 0) - (o._vx || 0)) * ux + ((m._vz || 0) - (o._vz || 0)) * uz;
  if (vrel < 1.5) return;
  const light = km < ko ? m : o, heavy = light === m ? o : m;
  if (light._impBy === heavy && light._impT > simT) return;
  light._impBy = heavy; light._impT = simT + 0.45;
  const J = (1 + RESTITUTION) * vrel * km * ko / (km + ko);
  const dvO = J / ko, dvM = J / km;
  PHYS.audit.impacts++;
  /* ONE HIT, BILLED ONCE. A species file that bills its own charge (the
     elephant's ram / trample: m.impactBilled) has already dealt the
     collision's injury; this pass still moves the light body by momentum
     but does not hurt it again. Measured before: a charging bull's victims
     took the ram's 28 x v AND impactDmg for the same contact. */
  addKnock(o, ux * dvO, uz * dvO, m, { hurt: (!o.beast || !m.beast || ko < km) && !(m.impactBilled && heavy === m) });
  addKnock(m, -ux * dvM, -uz * dvM, o, { hurt: (!m.beast || !o.beast || km < ko) && !(o.impactBilled && heavy === o) });
}

/* A VELOCITY CHANGE ON A LIVING BODY. o = { hurt, vy, noDown } */
function addKnock(b, dvx, dvz, by, o) {
  if (!b || b.dead || b.fled || b.vehicle || b.air || b._apeHeld || b._apeFlying) return;
  o = o || {};
  const dv = Math.hypot(dvx, dvz, o.vy || 0);
  if (dv < 0.05) return;
  if (dv > PHYS.audit.maxDv) PHYS.audit.maxDv = dv;
  if (o.hurt) {
    const dmg = impactDmg(b, dv);
    if (dmg > 0) {
      hurtMan(b, dmg, { by: by && by.team ? by : null, byTeam: by && by.team, cause: "impact", J: dv * bodyKg(b), dvx: dvx, dvz: dvz,
        fromX: b.pos.x - dvx, fromZ: b.pos.z - dvz });
      if (b.dead) return;
    }
  }
  const kg = bodyKg(b);
  // OFF THE GROUND: hard enough, light enough. A man hit at 7 m/s is thrown;
  // a lion takes the same as a shove it skids out of; an elephant never flies.
  if (b._tossed) { const T = b._tossed; if (T.vx != null && T.lift <= T.age) { T.vx += dvx; T.vz += dvz; T.vy += o.vy || 0; } return; }
  if ((dv > 5.5 || (o.vy || 0) > 2.5) && kg < 450) {
    flingBody(b, (b.kvx || 0) + dvx, Math.max(o.vy || 0, dv * 0.3), (b.kvz || 0) + dvz, { by: by });
    b.kvx = 0; b.kvz = 0;
    return;
  }
  b.kvx = (b.kvx || 0) + dvx; b.kvz = (b.kvz || 0) + dvz;
  if (!b._knock) { b._knock = true; PHYS.knock.push(b); }
  PHYS.audit.knocks++;
  // a man struck past what his legs can take goes down along the blow
  if (!b.beast && !o.noDown && dv > 2.5) knockBody(b, dvx / dv, dvz / dv, 0.8 + dv * 0.18, Math.min(1, dv / 8));
}
function knockBody(b, dx, dz, dur, power) {
  PHYS.audit.downs++;
  const V = CBZ.verbs;
  if (V && V.knockdown && b.char && b.char.parts) {
    try { if (V.knockdown(b, { dir: { x: dx, z: dz }, power: power, dur: dur })) return; } catch (e) {}
  }
  b.ko = Math.max(b.ko || 0, dur);
  b._koMine = true;
  if (!b._knock) { b._knock = true; PHYS.knock.push(b); }
}
/* THE SLIDE. A struck body keeps the velocity it was given and loses it to
   friction: on its feet, braced, about 0.8 g; a body down skids at 0.6 g.
   A wall that eats the move at speed is a second impact. */
function stepKnock(sdt) {
  const L = PHYS.knock;
  for (let i = L.length - 1; i >= 0; i--) {
    const b = L[i];
    if (b._koMine) {
      b.ko = (b.ko || 0) - sdt;
      if (b.ko <= 0) { b.ko = 0; b._koMine = false; }
    }
    const kvx = b.kvx || 0, kvz = b.kvz || 0, sp = Math.hypot(kvx, kvz);
    if (b.dead || b.fled || b._tossed || sp < 0.04) {
      b.kvx = 0; b.kvz = 0;
      if (b.dead || b.fled || !b._koMine) { b._knock = false; L.splice(i, 1); }
      continue;
    }
    const ox = b.pos.x, oz = b.pos.z;
    b.pos.x += kvx * sdt; b.pos.z += kvz * sdt;
    CBZ.micro.resolveCircle(b.pos, b.rad || 0.45, b.pos.y, 1.8);
    b.resT = 0;
    const want = sp * sdt, got = Math.hypot(b.pos.x - ox, b.pos.z - oz);
    if (sp > 4 && got < want * 0.5) {
      // into a wall: the wall is the impact now
      PHYS.audit.wallSlams++;
      const dmg = impactDmg(b, sp * 0.9);
      b.kvx = -kvx * 0.15; b.kvz = -kvz * 0.15;
      if (dmg > 0) hurtMan(b, dmg, { cause: "impact", J: sp * bodyKg(b), fromX: ox - kvx, fromZ: oz - kvz });
      continue;
    }
    const mu = (b.ko > 0 || knockedDown(b)) ? 0.6 : (b.beast ? 1.0 : 0.8);
    const ns = Math.max(0, sp - mu * PHYS_G * sdt);
    b.kvx = kvx * ns / sp; b.kvz = kvz * ns / sp;
  }
}

/* ============================================================ BODIES IN THE AIR
   One integrator for anything thrown: the elephant's trunk throw, a man a
   charge or a blast lifted. Ballistic at 9.81, swept through the walls,
   bowling whoever is in the way by momentum, hurt by how fast it arrives.
   The body is nobody else's while it flies (step.js routes _tossed here,
   push2 and the pinned pass stand down). */
function flingBody(b, vx, vy, vz, o) {
  if (!b || b.dead || b.vehicle) return null;
  o = o || {};
  PHYS.audit.flings++;
  if (b.beast && b._atkAnim >= 0 && CBZ.creatureEndAttack) { try { CBZ.creatureEndAttack(b); } catch (e) {} }
  b._tossed = {
    by: o.by || null, age: 0, lift: o.lift || 0, carry: o.carry || null, dmg: o.dmg || 0, down: 0,
    x0: b.pos.x, y0: b.pos.y, z0: b.pos.z, vx: vx, vy: vy, vz: vz, hit: false,
    rx: b.group ? b.group.rotation.x : 0, spin: o.spin != null ? o.spin : 3 + Math.hypot(vx, vz) * 0.5,
  };
  return b._tossed;
}
const _flyNear = [];
function stepTossed(t, sdt) {
  const T = t._tossed;
  if (!T) return;
  if (t.dead) { if (t.group && !t.ragdoll) t.group.rotation.x = T.rx; t._tossed = null; return; }
  T.age += sdt;
  if (T.down > 0) {
    // on the floor, getting up
    T.down -= sdt;
    if (T.down <= 0) { if (t.group) t.group.rotation.x = T.rx; t._tossed = null; t.thinkAt = simT; }
    return;
  }
  const c = T.carry;
  if (T.age < T.lift && c && !c.dead) {
    // up into the trunk, in front of the head
    const h = c.heading || 0, k = T.age / T.lift;
    const tx = c.pos.x + Math.cos(h) * (c.noseR || 2) * 1.05, tz = c.pos.z + Math.sin(h) * (c.noseR || 2) * 1.05;
    const ty = c.pos.y + (c.eyeH || 2.5) * 1.05;
    t.pos.set(T.x0 + (tx - T.x0) * k, T.y0 + (ty - T.y0) * k, T.z0 + (tz - T.z0) * k);
    if (t.group) t.group.rotation.x = T.rx + k * 0.9;
    return;
  }
  T.vy -= PHYS_G * sdt;
  const ox = t.pos.x, oz = t.pos.z;
  t.pos.x += T.vx * sdt; t.pos.y += T.vy * sdt; t.pos.z += T.vz * sdt;
  if (t.group) t.group.rotation.x += sdt * T.spin;
  // the walls: swept by the same resolve the walkers answer to
  const vh = Math.hypot(T.vx, T.vz), want = vh * sdt;
  CBZ.micro.resolveCircle(t.pos, t.rad || 0.45, t.pos.y, 1.8);
  if (want > 0.02 && Math.hypot(t.pos.x - ox, t.pos.z - oz) < want * 0.5) {
    PHYS.audit.wallSlams++;
    const dmg = impactDmg(t, vh);
    T.vx *= -0.15; T.vz *= -0.15;
    if (dmg > 0) {
      hurtMan(t, dmg, { by: T.by && !T.by.dead ? T.by : null, byTeam: T.by && T.by.team, cause: "impact", J: vh * bodyKg(t), fromX: ox - T.vx, fromZ: oz - T.vz });
      if (t.dead) { t._tossed = null; return; }
    }
  }
  // whoever is standing where it arrives is hit by a body, mass for mass
  if (!T.hit && vh > 4) {
    const a = fineNear(t.pos.x, t.pos.z, 2.5, _flyNear);
    const kt = bodyKg(t);
    for (let i = 0; i < a.length; i++) {
      const o = a[i];
      if (o === t || o.dead || o.vehicle || o._tossed || o._apeHeld || o === T.by) continue;
      const dx = o.pos.x - t.pos.x, dz = o.pos.z - t.pos.z, d = Math.hypot(dx, dz);
      const r = (o.rad || 0.45) + (t.rad || 0.45);
      if (d > r || t.pos.y - o.pos.y > (o.bodyH || 1.8) || t.pos.y < o.pos.y - 0.5) continue;
      const ux = d > 1e-3 ? dx / d : T.vx / vh, uz = d > 1e-3 ? dz / d : T.vz / vh;
      const vrel = (T.vx - (o._vx || 0)) * ux + (T.vz - (o._vz || 0)) * uz;
      if (vrel <= 0) continue;
      const ko = bodyKg(o);
      const J = (1 + RESTITUTION) * vrel * kt * ko / (kt + ko);
      T.vx -= ux * J / kt; T.vz -= uz * J / kt;
      T.hit = true;
      PHYS.audit.bowled++;
      addKnock(o, ux * J / ko, uz * J / ko, T.by, { hurt: true });
      break;
    }
  }
  const g = MAP.bodyY(t, t.pos.x, t.pos.z);
  if ((t.pos.y <= g && T.vy < 0) || T.age > 12) {
    t.pos.y = g;
    PHYS.audit.landings++;
    // the landing is the injury: the fall stopped dead, and part of the skid
    const vImp = Math.abs(T.vy) + 0.3 * Math.hypot(T.vx, T.vz);
    if (vImp > PHYS.audit.maxDv) PHYS.audit.maxDv = vImp;
    const by = T.by && !T.by.dead ? T.by : null;
    const dmg = impactDmg(t, vImp) + (T.dmg || 0);
    if (dmg > 0) hurtMan(t, dmg, { by: by, byTeam: T.by ? T.by.team : null, cause: "impact", J: vImp * bodyKg(t),
      dvx: T.vx, dvz: T.vz, fromX: t.pos.x - T.vx, fromZ: t.pos.z - T.vz });
    if (CBZ.shake && vImp > 6 && camDist2(t.pos) < 40 * 40) CBZ.shake(Math.min(0.5, vImp * 0.04));
    if (t.dead) { t._tossed = null; return; }
    T.down = t.beast ? 0.5 + Math.min(1, vImp * 0.06) : 1.0 + Math.min(1.4, vImp * 0.08);
    if (t.group) t.group.rotation.x = T.rx + Math.PI / 2 * (t.beast ? 0.8 : 1);
    // and he skids what the ground did not take
    t.kvx = T.vx * 0.5; t.kvz = T.vz * 0.5;
    if (!t._knock && Math.hypot(t.kvx, t.kvz) > 0.1) { t._knock = true; PHYS.knock.push(t); }
    T.vx = T.vy = T.vz = 0;
  }
}

/* ============================================================ A DETONATION
   NPC War owns its blast (modecaps asks the mode's `blast` first). The old
   shared sweep was one ring: everyone inside 0.55 R took 1e6 and everyone
   outside it took nothing and did not move, so a grenade killed a six-tonne
   elephant as dead as a man and the man at 0.6 R stood there untouched.

   Now it is pressure and impulse by scaled distance Z = d / R, with R the
   page's own radius for the charge:
     damage   BLAST_DMG x power x (0.55 / Z)² inside the core (a man there
              dies, as before; hp already carries a body's size, so an
              elephant at the same spot takes the same number and lives),
              tapering to nothing at R;
     impulse  delta-v = BLAST_DV x power x (0.55 / Z)^1.5 x (80 / kg)^(1/3):
              the impulse goes with the area a body shows (kg^(2/3)) and is
              divided by its mass, so a man is thrown and a bull rocks;
     corpses  thrown by city/ragdoll's own blast (CBZ.ragdollBlast) first, so
              a body this blast kills is not thrown twice;
     debris   loose pieces already lying there are kicked (CBZ.debris.impulse)
              and the crater throws grit and dust (CBZ.debris.chips).
   Hulls keep the old ring: inside 0.55 R the armour answers (hurtVehicle). */
const BLAST_DMG = 420, BLAST_DV = 9;
const _blastL = [];
function blastBodies(x, y, z, R, power, opts) {
  if (!(R > 0)) return 0;
  power = power > 0 ? power : 1;
  opts = opts || {};
  PHYS.audit.blasts++;
  if (CBZ.ragdollBlast) { try { CBZ.ragdollBlast(x, z, R, power); } catch (e) {} }
  rebuildFine();
  const near = fineNear(x, z, R + 1);
  _blastL.length = 0;
  for (let i = 0; i < near.length; i++) _blastL.push(near[i]);
  const by = opts.by && opts.by.team ? opts.by : null;
  let n = 0;
  for (let i = 0; i < _blastL.length; i++) {
    const b = _blastL[i];
    if (b.dead || b.fled || b.air) continue;
    const dx = b.pos.x - x, dz = b.pos.z - z, dy = (b.pos.y + (b.aimY || 1)) - (y || 0);
    const d = Math.hypot(dx, dz, dy);
    if (d >= R) continue;
    const Z = Math.max(0.12, d / R);
    if (b.vehicle) {
      if (Z < 0.55) { hurtMan(b, 1e6, { by: by, byTeam: by && by.team, cause: opts.cause || "explosion", fromX: x, fromZ: z }); n++; }
      continue;
    }
    const taper = Z <= 0.55 ? 1 : (1 - Z) / 0.45;
    const kg = bodyKg(b);
    const dv = Math.min(30, BLAST_DV * power * Math.pow(0.55 / Z, 1.5) * taper * Math.cbrt(MAN_KG / kg));
    const dh = Math.hypot(dx, dz);
    let ux, uz;
    if (dh > 1e-3) { ux = dx / dh; uz = dz / dh; }
    else { const a = ((b.i || 0) * 37 % 360) * Math.PI / 180; ux = Math.cos(a); uz = Math.sin(a); }
    const dmg = BLAST_DMG * power * (0.55 / Z) * (0.55 / Z) * taper;
    hurtMan(b, dmg, { by: by, byTeam: (by && by.team) || opts.team || null, cause: "bomb", fromX: x, fromZ: z,
      J: dv * kg, dvx: ux * dv * 0.9, dvz: uz * dv * 0.9, dvy: dv * 0.45 });
    if (!b.dead && dv > 0.3) addKnock(b, ux * dv * 0.9, uz * dv * 0.9, by, { vy: dv * 0.45 });
    n++;
  }
  const D = CBZ.debris;
  if (D) {
    if (D.impulse) { try { D.impulse(x, y || 0, z, R * 1.2, 8 * power); } catch (e) {} }
    if (D.chips && !(MAP && MAP.water) && camDist2({ x: x, y: y || 0, z: z }) < 400 * 400) {
      try { D.chips(x, (y || 0) + 0.1, z, { kind: "dirt", count: Math.round(10 + 14 * Math.min(2, power)), power: Math.min(3, power * 1.4), dir: { x: 0, y: 1, z: 0 }, dust: true }); } catch (e) {}
    }
  }
  return n;
}

/* ============================================================ HULLS RUN THINGS OVER
   city/carstrike.js already knows what a moving car does to a body: the
   hull's real side profile, swept every ragdoll sub-step, the bumper
   driving the shins, the wrap, the throw, the tyres climbing a body under
   them, and momentum paid back to the car. A tank is a car to it once the
   hull answers the names it reads: v (the drive's own speed, so the hull
   genuinely loses the momentum the body takes), dims, a body kind for the
   profile, a mass factor, and no windscreen to star. And CBZ.cityCars is
   the list it asks for bodies lying in a moving car's path, so a corpse in
   front of a tank is driven over by the tank's shape. */
function hullForStrike(u) {
  if (u._csReady) return u;
  u._csReady = true;
  Object.defineProperty(u, "v", { configurable: true, get: function () { return this.ds ? this.ds.v : 0; },
    set: function (x) { if (this.ds && isFinite(x)) this.ds.v = x; } });
  u.dims = { width: u.vwid * 2, length: u.vlen * 2, height: u.vheight || 2.4, wheelbase: u.vlen * 1.2 };
  u._bk = (u.def && u.def.drive === "wheeled" && (u.vheight || 2) < 2.3) ? "suv" : "semi";
  u.mass = (u._mass || 10000) / 1350;     // carstrike caps the factor at 12 (16 t): plenty to throw a man
  u.noGlass = true;
  return u;
}
function physPost(sdt) {
  if (!PHYS.hulls.length || !CBZ.carStrike) return;
  if (!CBZ.cityCars) { CBZ.cityCars = PHYS.hullsLive = []; }
  if (PHYS.hullsLive) {
    PHYS.hullsLive.length = 0;
    for (let i = 0; i < PHYS.hulls.length; i++) PHYS.hullsLive.push(hullForStrike(PHYS.hulls[i]));
  }
  if (CBZ.ragdollCarPost) { try { CBZ.ragdollCarPost(sdt); } catch (e) {} }
}

/* THE BODY LAYER, for the shared systems (systems/ape_combat.js) that throw
   and strike bodies on this page. One integrator for a body in the air: a
   thrown man arcs at 9.81, is stopped (and hurt) by walls, bowls whoever he
   lands on by momentum, and is injured by the speed he arrives at. */
CBZ.bodyPhys = { kg: bodyKg, knock: addKnock, fling: flingBody, impactDmg: impactDmg, manKg: MAN_KG };
