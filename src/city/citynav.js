/* ============================================================
   city/citynav.js — CBZ.cityNav: the SHARED navigation brain.

   WHY a separate module: peds.js and crowd.js both need the same
   spatial answers — "am I indoors / which lot encloses me", "which
   exit do I flee toward", "route me to a goal across the street
   grid", and "which way do I actually step this frame avoiding
   walls + my neighbours" — but neither owns the arena or the
   building footprints. Duplicating that math in two files drifts;
   one snapshot-once module keeps the two crowds agreeing on the
   world and keeps the hot per-frame query (contextSteer) in one
   alloc-free place.

   The four public functions match the pinned cross-file contract
   EXACTLY (Builder B consumes them verbatim):
     CBZ.cityNav.indoorLotAt(x, z)                         -> lot | null
     CBZ.cityNav.nearestExit(x, z, awayX, awayZ)           -> {x,z,nx,nz} | null
     CBZ.cityNav.routeTo(fromX, fromZ, goalX, goalZ, out)  -> out (waypoints)
     CBZ.cityNav.contextSteer(px,pz, gdx,gdz, nbrs,n, px0,pz0, out) -> out

   EVERY function is null-safe: if the arena was never built or
   CBZ.colliders is missing, indoorLotAt/nearestExit -> null,
   routeTo -> [direct goal], contextSteer -> just steers toward the
   goal dir. Nothing here ever throws — the crowds call this from
   the middle of their move loops and one bad frame must not stall
   ~1000 agents.

   The context-steer kernel is the F1-2011 method (Andrew Fray, Game
   AI Pro): build an 8-slot DANGER map + INTEREST map, mask every
   slot above the minimum danger, argmax the surviving interest, then
   parabolic sub-slot interpolate so the chosen heading is continuous
   (not locked to 1 of 8). Hysteresis = blend toward last frame's
   steer dir so the agent doesn't flip-flop between two equally good
   slots. ALL of it runs on module-level scratch — zero per-frame
   allocation.

   Builds its door/intersection snapshot LAZILY on first call (the
   arena + buildings must exist first), and re-snapshots if the arena
   reference changes (a new buildCity()).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  // PED_R: the agent collision radius the contract pins. Walls are
  // expanded by this so the closest-point danger keeps a body's width
  // off the geometry, matching peds.js's PED_R = 0.5.
  const PED_R = 0.5;

  // ---- build-once snapshot ------------------------------------------------
  // We cache against the live arena object: if buildCity() returns a NEW
  // descriptor (a fresh world), _arena !== that ref and we rebuild. Holding
  // the arena directly (not a copy) keeps lot refs identity-stable so the
  // crowds can === compare the lot we return.
  let _arena = null;
  let _doors = null;          // live cityDoors array (read-only); per-frame .open
  let _N = 0, _step = 0;
  let _xL = null, _zL = null; // arena xLines / zLines (intersection grid axes)
  // building footprints, flattened for a tight alloc-free scan in indoorLotAt:
  //   parallel arrays, one entry per ENCLOSING building lot (parks/stubs skip).
  let _bMinX = null, _bMaxX = null, _bMinZ = null, _bMaxZ = null, _bLot = null, _bN = 0;
  // door snapshot for the flee EQS: world door point + inward normal. The
  // OUTSIDE-the-door target is door - n*2 (a step onto the sidewalk).
  let _dx = null, _dz = null, _dnx = null, _dnz = null, _dN = 0;

  function arenaNow() {
    // prefer the cached live descriptor; fall back to (re)building once.
    const a = (CBZ.city && CBZ.city.arena) || (CBZ.buildCity ? CBZ.buildCity() : null);
    return a || null;
  }

  function ensure() {
    const a = arenaNow();
    if (!a) { _arena = null; return null; }
    if (a === _arena && _bLot) return a;   // already snapshotted this world
    _arena = a;
    _N = a.N | 0; _step = a.step || 1;
    _xL = a.xLines || null; _zL = a.zLines || null;
    _doors = (CBZ.cityDoorsGet ? CBZ.cityDoorsGet() : null) || null;

    // --- building footprints: only lots whose building truly ENCLOSES space.
    // A real building carries ox/oz/w/d (the makeBuilding return, spread into
    // lot.building). Parks + the "city stub" lots carry only a door at the lot
    // centre with NO w/d — skip them (door.nx == null is the documented park
    // tell, but the absence of w/d is the structural test we use). ----
    const lots = a.lots || [];
    let cnt = 0;
    for (let i = 0; i < lots.length; i++) {
      const b = lots[i].building;
      if (b && b.w > 0 && b.d > 0 && (b.ox != null || lots[i].cx != null)) cnt++;
    }
    _bN = cnt;
    _bMinX = new Float64Array(cnt); _bMaxX = new Float64Array(cnt);
    _bMinZ = new Float64Array(cnt); _bMaxZ = new Float64Array(cnt);
    _bLot = new Array(cnt);
    let k = 0;
    for (let i = 0; i < lots.length; i++) {
      const lot = lots[i], b = lot.building;
      if (!(b && b.w > 0 && b.d > 0 && (b.ox != null || lot.cx != null))) continue;
      // building centre = b.ox/oz when present, else the lot centre (the
      // building is poured on the lot pad at lot.cx/cz). Footprint is the OUTER
      // wall box; the INTERIOR test below insets by the wall thickness so a body
      // pressed against the outside wall doesn't read as "indoors".
      const ox = b.ox != null ? b.ox : lot.cx;
      const oz = b.oz != null ? b.oz : lot.cz;
      _bMinX[k] = ox - b.w / 2; _bMaxX[k] = ox + b.w / 2;
      _bMinZ[k] = oz - b.d / 2; _bMaxZ[k] = oz + b.d / 2;
      _bLot[k] = lot;
      k++;
    }

    // --- door snapshot for the flee EQS. Use the live door records (wx/wz =
    // doorway centre, inx/inz = inward normal). If the door array isn't
    // exposed (older buildings.js), fall back to lot.building.door points,
    // which carry nx/nz on real entrances. ----
    if (_doors && _doors.length) {
      _dN = _doors.length;
      _dx = new Float64Array(_dN); _dz = new Float64Array(_dN);
      _dnx = new Float64Array(_dN); _dnz = new Float64Array(_dN);
      for (let i = 0; i < _dN; i++) {
        const d = _doors[i];
        _dx[i] = d.wx; _dz[i] = d.wz; _dnx[i] = d.inx; _dnz[i] = d.inz;
      }
    } else {
      // build door points from lot.building.door (real entrances only)
      let dc = 0;
      for (let i = 0; i < lots.length; i++) {
        const dr = lots[i].building && lots[i].building.door;
        if (dr && dr.nx != null && dr.nz != null) dc++;
      }
      _dN = dc;
      _dx = new Float64Array(dc); _dz = new Float64Array(dc);
      _dnx = new Float64Array(dc); _dnz = new Float64Array(dc);
      let j = 0;
      for (let i = 0; i < lots.length; i++) {
        const dr = lots[i].building && lots[i].building.door;
        if (!(dr && dr.nx != null && dr.nz != null)) continue;
        _dx[j] = dr.x; _dz[j] = dr.z; _dnx[j] = dr.nx; _dnz[j] = dr.nz; j++;
      }
    }
    return a;
  }

  // ======================================================================
  //  1) indoorLotAt(x, z) -> lot | null
  //     The lot whose building INTERIOR encloses world point (x,z), else
  //     null. We test against the OUTER footprint inset by the wall
  //     thickness (WT ~0.4): a point inside the inset box is genuinely
  //     within the room, not standing against the outside facade.
  // ======================================================================
  const WT = 0.4;   // wall thickness (matches buildings.js WT) — interior inset
  CBZ.cityNav = CBZ.cityNav || {};
  CBZ.cityNav.indoorLotAt = function (x, z) {
    if (!ensure()) return null;
    // tight linear scan over enclosing footprints. ~50 buildings; this is
    // called from death/flee decisions, not every agent every frame, so a
    // branch-light scan beats maintaining a second spatial structure.
    for (let i = 0; i < _bN; i++) {
      if (x > _bMinX[i] + WT && x < _bMaxX[i] - WT &&
          z > _bMinZ[i] + WT && z < _bMaxZ[i] - WT) {
        return _bLot[i];
      }
    }
    return null;
  };

  // ======================================================================
  //  1b) doorFor(lot) -> {x,z,nx,nz} | null
  //     The walkable ENTRANCE of a building lot: world doorway point + INWARD
  //     unit normal. Prefer the LIVE cityDoors record whose doorway centre sits
  //     nearest this lot's footprint (it reflects the real openable leaf +
  //     collider that drops on proximity), and fall back to lot.building.door
  //     (the seeded entrance) when no live record is exposed. Null when the lot
  //     has no real entrance (a park / stub carries door.nx == null).
  //     WHY this lives here: peds.js (flee) + gangs.js (raid/reprisal door
  //     routing) both need the SAME answer for "where do I walk to get in",
  //     and both already snapshot the same door records — one place, no drift.
  // ======================================================================
  const _doorOut = { x: 0, z: 0, nx: 0, nz: 0 };
  CBZ.cityNav.doorFor = function (lot) {
    if (!lot || !ensure()) return null;
    const b = lot.building; if (!b) return null;
    // building centre (matches the footprint snapshot above)
    const ox = b.ox != null ? b.ox : lot.cx;
    const oz = b.oz != null ? b.oz : lot.cz;
    // half-extents of the OUTER footprint — a live door record belongs to this
    // lot only if its doorway centre sits on/near the wall box (cheap reject).
    const hw = (b.w || 0) * 0.5 + 1.2, hd = (b.d || 0) * 0.5 + 1.2;
    if (_doors && _doors.length && ox != null && oz != null && (b.w > 0 || b.d > 0)) {
      let best = null, bd2 = Infinity;
      for (let i = 0; i < _doors.length; i++) {
        const dr = _doors[i];
        const dwx = dr.wx, dwz = dr.wz;
        if (dwx == null || dwz == null) continue;
        if (Math.abs(dwx - ox) > hw || Math.abs(dwz - oz) > hd) continue;  // not this building
        const ddx = dwx - ox, ddz = dwz - oz, dd = ddx * ddx + ddz * ddz;
        if (dd < bd2) { bd2 = dd; best = dr; }
      }
      if (best && (best.inx != null || best.inz != null)) {
        _doorOut.x = best.wx; _doorOut.z = best.wz;
        _doorOut.nx = best.inx || 0; _doorOut.nz = best.inz || 0;
        return _doorOut;
      }
    }
    // fall back to the seeded entrance on the building record (real doors only)
    const dr = b.door;
    if (dr && (dr.nx != null || dr.nz != null)) {
      _doorOut.x = dr.x; _doorOut.z = dr.z;
      _doorOut.nx = dr.nx || 0; _doorOut.nz = dr.nz || 0;
      return _doorOut;
    }
    return null;
  };

  // ======================================================================
  //  2) nearestExit(x, z, awayX, awayZ) -> {x,z,nx,nz} | null
  //     EQS over the <=5 nearest building doors. Score each door's
  //     OUTSIDE step-point by:
  //        0.40 * awayDot   (does fleeing through it move me AWAY from the
  //                          threat dir awayX/awayZ — already unit-ish)
  //        0.35 * nearness  (closer doors first, normalised /40m)
  //        0.25 * clearLOS  (is the line from me to the door exit NOT a
  //                          clear shot for the threat — i.e. it gives cover)
  //     Returns the point already offset OUTSIDE the door:
  //        (door.x - nx*2, door.z - nz*2).
  //     The inward normal is (nx,nz); stepping OUT is the -normal side.
  // ======================================================================
  // module-level scratch for the 5-nearest selection (alloc-free): we keep a
  // tiny insertion-sorted top-5 by squared distance.
  const _exN = 5;
  const _exIdx = new Int32Array(_exN);
  const _exD2 = new Float64Array(_exN);
  const _exOut = { x: 0, z: 0, nx: 0, nz: 0 };
  CBZ.cityNav.nearestExit = function (x, z, awayX, awayZ) {
    if (!ensure() || _dN === 0) return null;
    // normalise the away direction once (callers pass a rough flee vector)
    let al = Math.sqrt(awayX * awayX + awayZ * awayZ);
    if (al < 1e-4) { awayX = 1; awayZ = 0; al = 1; } else { awayX /= al; awayZ /= al; }

    // ---- gather the 5 nearest doors (top-k by squared distance) ----
    let have = 0;
    for (let i = 0; i < _exN; i++) { _exIdx[i] = -1; _exD2[i] = Infinity; }
    for (let i = 0; i < _dN; i++) {
      const dx = _dx[i] - x, dz = _dz[i] - z;
      const d2 = dx * dx + dz * dz;
      if (have >= _exN && d2 >= _exD2[_exN - 1]) continue;   // worse than our worst
      // insertion into the sorted top-k
      let p = (have < _exN ? have : _exN - 1);
      while (p > 0 && _exD2[p - 1] > d2) { _exD2[p] = _exD2[p - 1]; _exIdx[p] = _exIdx[p - 1]; p--; }
      _exD2[p] = d2; _exIdx[p] = i;
      if (have < _exN) have++;
    }
    if (have === 0) return null;

    // ---- score each candidate exit; keep the best ----
    let best = -Infinity, bx = 0, bz = 0, bnx = 0, bnz = 0;
    for (let s = 0; s < have; s++) {
      const i = _exIdx[s];
      const nx = _dnx[i], nz = _dnz[i];
      // OUTSIDE step point: the contract pins door - n*2 (a stride onto the
      // sidewalk, clear of the doorway collider when the leaf is shut).
      const ex = _dx[i] - nx * 2, ez = _dz[i] - nz * 2;
      const tox = ex - x, toz = ez - z;
      const tl = Math.sqrt(tox * tox + toz * toz) || 1;
      const ux = tox / tl, uz = toz / tl;

      // (a) away component: heading toward this exit should align with "away"
      const awayDot = (ux * awayX + uz * awayZ + 1) * 0.5;   // remap [-1,1]->[0,1]
      // (b) nearness: closer is better, saturating past 40m
      const nearness = 1 - Math.min(1, tl / 40);
      // (c) cover: a blocked line of fire from threat->exit means the exit is
      // sheltered. clearLineOfFire(true)=clear shot; we WANT blocked, so
      // score = (blocked ? 1 : 0). Sample at chest height. Null-safe: if no
      // LOS module, treat as open (0) so the term is neutral.
      let cover = 0;
      if (CBZ.clearLineOfFire) {
        // threat is roughly behind us along -away; sample from a point on the
        // threat side toward the exit so a wall between them scores cover.
        const txp = x - awayX * 6, tzp = z - awayZ * 6;
        cover = CBZ.clearLineOfFire(txp, 1.4, tzp, ex, 1.4, ez) ? 0 : 1;
      }
      const score = 0.40 * awayDot + 0.35 * nearness + 0.25 * cover;
      if (score > best) { best = score; bx = ex; bz = ez; bnx = nx; bnz = nz; }
    }
    _exOut.x = bx; _exOut.z = bz; _exOut.nx = bnx; _exOut.nz = bnz;
    return _exOut;
  };

  // ======================================================================
  //  3) routeTo(fromX, fromZ, goalX, goalZ, outArr) -> outArr
  //     Caller-owned outArr filled with waypoints {x,z} from->goal over the
  //     intersection grid. If the goal is within ~1 block, outArr=[goal]
  //     (a direct beeline — no need to detour through a corner).
  //     The grid is a regular (N+1)x(N+1) lattice; we hop from the nearest
  //     intersection to from, along grid rows/cols toward the nearest
  //     intersection to goal (an L/staircase path that stays on streets),
  //     then a final hop to the goal itself.
  // ======================================================================
  // reuse a small pool of waypoint objects so routeTo never allocs after warm
  // (the caller owns outArr's LENGTH but we own the point objects inside it).
  const _wpPool = [];
  function wp(i) {
    let p = _wpPool[i];
    if (!p) { p = { x: 0, z: 0 }; _wpPool[i] = p; }
    return p;
  }
  // dedicated scratch for the two DOOR legs (threshold + a step inside) so they
  // never alias / grow the grid waypoint pool above (routeTo owns these objects;
  // the caller owns the out array's length).
  const _doorThr = { x: 0, z: 0 }, _doorIn = { x: 0, z: 0 };
  CBZ.cityNav.routeTo = function (fromX, fromZ, goalX, goalZ, outArr) {
    outArr = outArr || [];
    outArr.length = 0;
    const a = ensure();

    // ---- DOOR-AWARE INDOOR GOAL: if the goal is INSIDE a building and we're
    //      coming from OUTSIDE it, the street/grid route must end at that
    //      building's DOOR, not at the raw indoor point (a straight final leg
    //      would drive the body THROUGH the wall — the owner-filmed "walk thru
    //      buildings" bug). We route the grid to the door's OUTSIDE step point,
    //      then hand-append the door threshold + a step INWARD toward the goal,
    //      so the approach threads the opening the auto-door drops its collider
    //      for. Null-safe: any missing piece degrades to the plain street route.
    let inDoorX = null, inDoorZ = null, inGoalX = goalX, inGoalZ = goalZ;
    const NAV = CBZ.cityNav;
    if (NAV.indoorLotAt && NAV.doorFor) {
      const gLot = NAV.indoorLotAt(goalX, goalZ);
      // only thread the door when the CHASER is not already inside the SAME lot
      // (if we're in the room with the target, beeline — no door detour).
      if (gLot && NAV.indoorLotAt(fromX, fromZ) !== gLot) {
        const door = NAV.doorFor(gLot);
        if (door) {
          const nx = door.nx || 0, nz = door.nz || 0;
          // route the street legs to a point 2m OUTSIDE the door (the sidewalk
          // stride, clear of the closed-leaf collider), then we append inward.
          inGoalX = door.x - nx * 2; inGoalZ = door.z - nz * 2;
          inDoorX = door.x; inDoorZ = door.z;
        }
      }
    }

    const dx = inGoalX - fromX, dz = inGoalZ - fromZ;
    // emit the door threshold + a step INSIDE (toward the real goal) after the
    // street route lands at the outside step point. One place so beeline +
    // grid branches both thread the door.
    function appendDoorLegs() {
      if (inDoorX == null) return;
      _doorThr.x = inDoorX; _doorThr.z = inDoorZ;
      outArr.push(_doorThr);
      // a single stride PAST the threshold toward the indoor goal so the body
      // commits through the opening instead of stalling on the jamb.
      let ix = goalX - inDoorX, iz = goalZ - inDoorZ;
      const il = Math.sqrt(ix * ix + iz * iz) || 1;
      _doorIn.x = inDoorX + (ix / il) * 1.4; _doorIn.z = inDoorZ + (iz / il) * 1.4;
      outArr.push(_doorIn);
    }

    // No arena, or goal within ~1 block → beeline straight to the (outside) goal.
    if (!a || !a.nearestIntersection || (dx * dx + dz * dz) <= (_step * _step)) {
      const p = wp(0); p.x = inGoalX; p.z = inGoalZ; outArr.push(p);
      appendDoorLegs();
      return outArr;
    }
    const A = a.nearestIntersection(fromX, fromZ);
    const B = a.nearestIntersection(inGoalX, inGoalZ);
    if (!A || !B) {
      const p = wp(0); p.x = inGoalX; p.z = inGoalZ; outArr.push(p);
      appendDoorLegs();
      return outArr;
    }
    // Walk the grid in i then j (a manhattan staircase along streets). The
    // intersections array is row-major i*(N+1)+j; we emit the intersection
    // CENTRES as waypoints. Same-cell A==B collapses to just the goal.
    let n = 0;
    const ints = a.intersections, stride = _N + 1;
    // step i toward B.i, holding j = A.j (walk the cross-street)
    let i = A.i, j = A.j;
    const di = B.i > i ? 1 : -1, dj = B.j > j ? 1 : -1;
    // cap the hop count so a corrupt grid can't loop forever
    let guard = 0, guardMax = (_N + 2) * 2;
    while (i !== B.i && guard++ < guardMax) {
      i += di;
      const it = ints[i * stride + j];
      if (it) { const p = wp(n++); p.x = it.x; p.z = it.z; }
    }
    while (j !== B.j && guard++ < guardMax) {
      j += dj;
      const it = ints[i * stride + j];
      if (it) { const p = wp(n++); p.x = it.x; p.z = it.z; }
    }
    // final leg: the actual goal (off the grid, e.g. the door's outside point)
    const g = wp(n++); g.x = inGoalX; g.z = inGoalZ;
    for (let k = 0; k < n; k++) outArr.push(_wpPool[k]);
    if (!outArr.length) { const p = wp(0); p.x = inGoalX; p.z = inGoalZ; outArr.push(p); }
    appendDoorLegs();
    return outArr;
  };

  // ======================================================================
  //  4) contextSteer(px,pz, goalDirX,goalDirZ, nbrs,nbrCount, prevX,prevZ, out)
  //     8-slot context steering (Andrew Fray / Game AI Pro). Alloc-free.
  //
  //  INTEREST map : interest[k] = max(0, dot(slot_k, goalDir)) — slots that
  //     point toward the goal are attractive.
  //  DANGER map   : the max over (a) the 2-4 nearest WALL AABBs in
  //     CBZ.colliders (closest-point on the box expanded by PED_R, falloff
  //     with distance) and (b) the supplied neighbour peds (a soft repulsion
  //     skirt), written into the slot facing the obstacle with a small
  //     angular spread.
  //  PARSE        : find min danger, MASK out every slot with danger more than
  //     a small epsilon above the minimum, argmax the surviving interest, then
  //     parabolic sub-slot interpolation across the winning slot's neighbours
  //     for a continuous heading. Finally blend ~0.3 toward prev steer dir
  //     (global hysteresis) and renormalise.
  //
  //  out.x/out.z receive the chosen UNIT steer dir; returns out.
  // ======================================================================
  const SLOTS = 8;
  // precomputed unit slot directions (module-level constant; never realloc)
  const _slotX = new Float64Array(SLOTS), _slotZ = new Float64Array(SLOTS);
  for (let k = 0; k < SLOTS; k++) {
    const ang = (k / SLOTS) * Math.PI * 2;
    _slotX[k] = Math.cos(ang); _slotZ[k] = Math.sin(ang);
  }
  // per-call scratch maps (reused; cleared at the top of every call)
  const _interest = new Float64Array(SLOTS);
  const _danger = new Float64Array(SLOTS);
  const _out = { x: 0, z: 0 };
  const _nearCols = [];

  // distances that shape the danger skirt
  const WALL_SENSE = 3.2;        // start feeling a wall within this range
  const NBR_SENSE = 2.4;         // neighbour repulsion radius
  const NBR_HARD = 0.95;         // below this, neighbour danger saturates

  // write a danger value into the slot facing dir (dx,dz), plus a falloff
  // skirt into the two adjacent slots, taking the MAX (per the literature:
  // combine danger by max, not sum — a second obstacle behind the first
  // doesn't make us avoid the first any harder).
  function spreadDanger(dx, dz, mag) {
    if (mag <= 0) return;
    // nearest slot index to this direction
    let bestK = 0, bestDot = -2;
    for (let k = 0; k < SLOTS; k++) {
      const d = dx * _slotX[k] + dz * _slotZ[k];
      if (d > bestDot) { bestDot = d; bestK = k; }
    }
    if (mag > _danger[bestK]) _danger[bestK] = mag;
    const halfK1 = (bestK + 1) % SLOTS, halfK2 = (bestK + SLOTS - 1) % SLOTS;
    const skirt = mag * 0.6;
    if (skirt > _danger[halfK1]) _danger[halfK1] = skirt;
    if (skirt > _danger[halfK2]) _danger[halfK2] = skirt;
  }

  CBZ.cityNav.contextSteer = function (px, pz, goalDirX, goalDirZ, nbrs, nbrCount, prevX, prevZ, out) {
    out = out || _out;
    // normalise the goal dir (callers pass toward-waypoint; may be unnormalised)
    let gl = Math.sqrt(goalDirX * goalDirX + goalDirZ * goalDirZ);
    if (gl < 1e-5) {
      // no goal → hold previous dir if any, else don't move
      out.x = prevX || 0; out.z = prevZ || 0;
      return out;
    }
    goalDirX /= gl; goalDirZ /= gl;

    // ---- INTEREST: dot(slot, goalDir), clamped at 0 ----
    for (let k = 0; k < SLOTS; k++) {
      const d = _slotX[k] * goalDirX + _slotZ[k] * goalDirZ;
      _interest[k] = d > 0 ? d : 0;
      _danger[k] = 0;
    }

    // ---- DANGER (a): nearest wall AABBs in CBZ.colliders ----
    // Find the 2-4 closest boxes and write closest-point danger. Null-safe:
    // if colliders are absent we skip walls entirely (open-field steering).
    const cols = CBZ.queryCollidersNear
      ? CBZ.queryCollidersNear(px, pz, WALL_SENSE + PED_R, _nearCols)
      : CBZ.colliders;
    if (cols && cols.length) {
      // We don't keep our own broadphase here (the caller owns neighbour
      // gathering, not wall gathering). The collider list at city scale is a
      // few hundred boxes; scanning them every contextSteer for ~1000 agents
      // would be hot, so we cheaply skip any box clearly out of WALL_SENSE
      // via an AABB-center quick reject before the precise closest-point.
      const sense2 = (WALL_SENSE + 2) * (WALL_SENSE + 2);
      for (let c = 0; c < cols.length; c++) {
        const box = cols[c];
        // height-gated colliders (doors/seawall) only matter at body height;
        // their y-gate is irrelevant to a 2D steer, so include them all.
        const cxC = (box.minX + box.maxX) * 0.5, czC = (box.minZ + box.maxZ) * 0.5;
        const qdx = px - cxC, qdz = pz - czC;
        if (qdx * qdx + qdz * qdz > sense2 + 64) continue;   // far box: skip
        // closest point on the box, expanded by PED_R
        const minX = box.minX - PED_R, maxX = box.maxX + PED_R;
        const minZ = box.minZ - PED_R, maxZ = box.maxZ + PED_R;
        const cpx = px < minX ? minX : (px > maxX ? maxX : px);
        const cpz = pz < minZ ? minZ : (pz > maxZ ? maxZ : pz);
        let wx = px - cpx, wz = pz - cpz;
        let dist = Math.sqrt(wx * wx + wz * wz);
        if (dist >= WALL_SENSE) continue;
        if (dist < 1e-4) {
          // inside/on the expanded box — push straight out from the box centre
          wx = qdx; wz = qdz;
          const l = Math.sqrt(wx * wx + wz * wz) || 1; wx /= l; wz /= l;
          dist = 0.01;
        } else { wx /= dist; wz /= dist; }
        // danger faces FROM the wall toward us reversed: we want to AVOID the
        // wall, so danger is high in the direction TOWARD the wall (-w).
        const mag = 1 - dist / WALL_SENSE;       // 0 at sense edge, ->1 at contact
        spreadDanger(-wx, -wz, mag * mag);       // squared falloff = sharper near
      }
    }

    // ---- DANGER (b): neighbour peds (caller-supplied flat Float32Array) ----
    // nbrs = [x0,z0,x1,z1,...]; nbrCount = pair count. A soft skirt so bodies
    // don't interpenetrate but the crowd still flows.
    if (nbrs && nbrCount > 0) {
      for (let i = 0; i < nbrCount; i++) {
        const nx = nbrs[i * 2], nz = nbrs[i * 2 + 1];
        let wx = px - nx, wz = pz - nz;
        const dist = Math.sqrt(wx * wx + wz * wz);
        if (dist >= NBR_SENSE) continue;
        if (dist < 1e-4) { wx = 0.001; wz = 0; }
        else { wx /= dist; wz /= dist; }
        const mag = dist <= NBR_HARD ? 1 : (1 - (dist - NBR_HARD) / (NBR_SENSE - NBR_HARD));
        spreadDanger(-wx, -wz, mag * 0.85);      // toward-neighbour = dangerous
      }
    }

    // ---- PARSE: min-danger mask, argmax interest, sub-slot interp ----
    let minDanger = Infinity;
    for (let k = 0; k < SLOTS; k++) if (_danger[k] < minDanger) minDanger = _danger[k];
    const maskCut = minDanger + 0.001;           // epsilon so float ties survive
    let bestK = -1, bestInt = -Infinity;
    for (let k = 0; k < SLOTS; k++) {
      if (_danger[k] > maskCut) continue;        // masked out (higher danger)
      if (_interest[k] > bestInt) { bestInt = _interest[k]; bestK = k; }
    }
    if (bestK < 0) {
      // every slot equally dangerous (or no interest survived) — pick the slot
      // with the absolute lowest danger, tie-broken by interest. This is the
      // "trapped" fallback; still returns a sane unit dir.
      let lo = Infinity;
      for (let k = 0; k < SLOTS; k++) {
        if (_danger[k] < lo || (_danger[k] === lo && _interest[k] > (bestK >= 0 ? _interest[bestK] : -1))) {
          lo = _danger[k]; bestK = k;
        }
      }
      if (bestK < 0) bestK = 0;
    }

    // parabolic sub-slot interpolation across the winning slot using the
    // INTEREST gradient of its two neighbours (only meaningful if both
    // neighbours survived the mask; otherwise snap to the slot centre).
    const kp = (bestK + 1) % SLOTS, km = (bestK + SLOTS - 1) % SLOTS;
    let dirX, dirZ;
    const sPlus = (_danger[kp] <= maskCut) ? _interest[kp] : -1;
    const sMinus = (_danger[km] <= maskCut) ? _interest[km] : -1;
    if (sPlus >= 0 && sMinus >= 0) {
      const denom = (sMinus - 2 * bestInt + sPlus);
      let frac = 0;
      if (Math.abs(denom) > 1e-6) frac = 0.5 * (sMinus - sPlus) / denom;
      if (frac > 0.5) frac = 0.5; else if (frac < -0.5) frac = -0.5;
      // back-project the virtual slot index frac into a world dir by rotating
      // the winning slot dir toward its higher neighbour by frac of a slot.
      const dAng = frac * (Math.PI * 2 / SLOTS);
      const ca = Math.cos(dAng), sa = Math.sin(dAng);
      dirX = _slotX[bestK] * ca - _slotZ[bestK] * sa;
      dirZ = _slotX[bestK] * sa + _slotZ[bestK] * ca;
    } else {
      dirX = _slotX[bestK]; dirZ = _slotZ[bestK];
    }

    // ---- HYSTERESIS: blend ~0.3 toward last frame's chosen dir, renorm ----
    if ((prevX || prevZ)) {
      const pl = Math.sqrt(prevX * prevX + prevZ * prevZ) || 1;
      dirX = dirX * 0.7 + (prevX / pl) * 0.3;
      dirZ = dirZ * 0.7 + (prevZ / pl) * 0.3;
    }
    const ol = Math.sqrt(dirX * dirX + dirZ * dirZ);
    if (ol > 1e-5) { out.x = dirX / ol; out.z = dirZ / ol; }
    else { out.x = goalDirX; out.z = goalDirZ; }   // degenerate → just go to goal
    return out;
  };
})();
