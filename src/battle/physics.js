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
  if (!_cand.length) return null;
  // nearest first, then the first four get asked whether they can be seen
  let bestO = null, bestD = 1e18;
  for (let i = 0; i < _cand.length; i += 2) if (_cand[i + 1] < bestD) { bestD = _cand[i + 1]; bestO = _cand[i]; }
  let tries = 0;
  while (tries < 4) {
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
  const push = (clr - d) * 0.5 * (d < clr * 0.69 ? 1 : k);
  m.pos.x -= ux * push; m.pos.z -= uz * push;
  o.pos.x += ux * push; o.pos.z += uz * push;
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
  const push = (clr - d) * 0.5;
  const gotM = shove(m, -ux, -uz, push);
  const gotO = shove(o, ux, uz, push);
  const owed = Math.max(0, push - gotM) + Math.max(0, push - gotO);
  if (owed > 0.01) {
    if (push - gotM > 0.01) shove(o, ux, uz, owed);
    else if (push - gotO > 0.01) shove(m, -ux, -uz, owed);
  }
  dx = o.pos.x - m.pos.x; dz = o.pos.z - m.pos.z;
  if (dx * dx + dz * dz < deep * deep) {
    const sgn = ((m.i * 37 + o.i * 91) & 1) ? 1 : -1;
    shove(m, uz * sgn, -ux * sgn, deep);                   // along the wall
    shove(o, -uz * sgn, ux * sgn, deep);
    dx = o.pos.x - m.pos.x; dz = o.pos.z - m.pos.z;
    if (dx * dx + dz * dz < deep * deep) {
      // nowhere left to put them: the frame wins, the world gets the next step
      const e = (deep - Math.sqrt(dx * dx + dz * dz)) * 0.5 + 0.01;
      m.pos.x -= ux * e; m.pos.z -= uz * e;
      o.pos.x += ux * e; o.pos.z += uz * e;
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
const NBX = [1, -1, 0, 0, 1, 1, -1, -1], NBZ = [0, 0, 1, -1, 1, -1, 1, -1];
const NAV_MAXD = 6000;                        // ~2.4 km of path; past that, no route
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
const _bk = [];
function navSolve(team) {
  const w = NAV.w, C = NAV.cell, blk = NAV.block, d = NAV.dist[team];
  if (!d) return 0;
  d.fill(65535);
  for (let i = 0; i < NAV_MAXD; i++) { if (!_bk[i]) _bk[i] = []; else _bk[i].length = 0; }
  let seeded = 0;
  for (let i = 0; i < men.length; i++) {
    const m = men[i];
    if (m.dead || m.team === team) continue;
    const ix = ((m.pos.x - NAV.x0) / C) | 0, iz = ((m.pos.z - NAV.z0) / C) | 0;
    if (ix < 0 || iz < 0 || ix >= w || iz >= w) continue;
    const k = iz * w + ix;
    if (d[k] !== 0) { d[k] = 0; _bk[0].push(k); seeded++; }
  }
  NAV.at[team] = simT;
  if (!seeded) return 0;
  for (let b = 0; b < NAV_MAXD; b++) {
    const q = _bk[b];
    if (!q.length) continue;
    for (let qi = 0; qi < q.length; qi++) {
      const k = q[qi];
      if (d[k] !== b) continue;                       // a cheaper route already claimed it
      const ix = k % w, iz = (k / w) | 0;
      for (let n = 0; n < 8; n++) {
        const nx = ix + NBX[n], nz = iz + NBZ[n];
        if (nx < 0 || nz < 0 || nx >= w || nz >= w) continue;
        const nk = nz * w + nx;
        if (blk[nk]) continue;
        const nd = b + (n < 4 ? 10 : 14);
        if (nd < d[nk] && nd < NAV_MAXD) { d[nk] = nd; _bk[nd].push(nk); }
      }
    }
    q.length = 0;
  }
  NAV.solves++;
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
  let ix = ((m.pos.x - NAV.x0) / C) | 0, iz = ((m.pos.z - NAV.z0) / C) | 0;
  if (ix < 1 || iz < 1 || ix >= w - 1 || iz >= w - 1) return false;
  if (d[iz * w + ix] === 65535) return false;         // no route from here
  let moved = false;
  for (let s = 0; s < 3; s++) {
    let best = d[iz * w + ix], bx = -1, bz = -1;
    for (let n = 0; n < 8; n++) {
      const nx = ix + NBX[n], nz = iz + NBZ[n];
      if (nx < 1 || nz < 1 || nx >= w - 1 || nz >= w - 1) continue;
      const v = d[nz * w + nx];
      if (v < best) { best = v; bx = nx; bz = nz; }
    }
    if (bx < 0) break;
    ix = bx; iz = bz; moved = true;
    if (best === 0) break;                            // standing on him
  }
  if (!moved) return false;
  out.set(NAV.x0 + (ix + 0.5) * C, 0, NAV.z0 + (iz + 0.5) * C);
  return true;
}

const teamCOM = { red: { x: 0, z: 0 }, blue: { x: 0, z: 0 } };
const HUNT = { red: false, blue: false };
