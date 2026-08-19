/* ============================================================
   systems/prisonnav.js — CBZ.prisonNav: THE PRISON WALKS TO DOORS.

   OWNER (2026-08-19, after the cell-flicker fix): "Instead of flickering when
   walking into a wall falling real physics and then finding door etc IDK
   consider this."

   He is describing the other half of the same defect. entities/npc.js's mover
   is a STRAIGHT LINE to `target` and systems/actorcollide.js says so out loud:
   "It's not full pathfinding, so an NPC may bump a wall its target is behind."
   Nothing ever asked what happens next. Measured on the shipped tree, escape
   mode, 10 s samples at four points of the day:

     block    trying     STALLED (achieved < 35% of the step it tried)
     yard     120 a-s    8 a-s   ( 7%)   1 actor grinding >1.5 s
     mess     124 a-s   18 a-s   (15%)   3
     supper   138 a-s   28 a-s   (20%)   5
     secure   342 a-s   81 a-s   (24%)  12 of 69

   At curfew a QUARTER of every metre this cast tries to walk is a body
   pressed into geometry. Individual cases were worse than the average: three
   inmates at the far end of the yard, targets set to the wing door 80 m away
   on the other side of the block, spent all ten seconds of the sample walking
   into the same wall. One "escape"-state inmate had been grinding the same
   corner since the run began — stalled 10 s of every 10 s, at every hour.

   WHAT THIS FILE ADDS, and what it deliberately does NOT.

   It does not touch the brain: entities/ai.js still decides WHERE a man wants
   to be. It does not touch the mover: entities/npc.js still walks a straight
   line at `target`. It sits between them (order 21.8, after the brain at 18,
   before the mover at 22) and answers the question neither of them asked —
   HOW do you get there from here:

     · straight line to the goal is clear  -> it does nothing at all, and the
       cast moves exactly as it always did (the common case, and it costs one
       throttled grid raycast every 0.3 s per actor).
     · straight line is blocked            -> it plans a route on the wing's
       own colliders and feeds `target` one waypoint at a time. Doors are
       gaps in that grid because a door that is OPEN is not in CBZ.colliders,
       so "finding the door" is not special-cased anywhere — it is what the
       shortest path through a wall with a hole in it IS.
     · no route exists at all (goal behind a LOCKED door, a man sealed in his
       cell at night) -> it stops him grinding: the same context-steering
       kernel city/citynav.js already runs for a thousand pedestrians picks
       the least-blocked heading, so he walks the wall like a man looking for
       a way round instead of pressing his face into it.

   REUSE, NOT A SECOND SYSTEM. This file owns ONE walkability grid and ONE A*,
   and systems/navigation.js's escapeRoute — the planner behind the player's
   map arrows, which used to rebuild a coarse 2.15 m grid from every collider
   on every single call — now delegates to it, keeping its vent portals as
   plan() options. The prison had a pathfinder all along. Nothing was driving
   with it.

   THE GRID. 0.4 m cells over CBZ.WORLD with the body radius baked in, so a
   free cell means a man's whole width fits. A cell door is 1.6 m wide, which
   leaves 0.76 m of free centres — comfortably more than one cell, so a
   doorway can never quantise shut. Built once, rebuilt when the collider set
   changes (every door open/close splices its wall in or out of CBZ.colliders)
   and on a slow backstop timer. Cost is reported by CBZ.prisonNavAudit().

   Flag: CONFIG.PRISON_NAV_V1 (?cfg_PRISON_NAV_V1=0 reverts to the straight
   line). Gate: tools/prison-nav-check.mjs.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  const STEP = 0.4;            // grid cell, metres
  const BODY_R = 0.42;         // walls are grown by this: a free cell fits a man
  const FOOT = 0.25;           // matches actorcollide: a kerb is stepped, not walled
  const HEAD = 1.7;            // ... and a body is this tall

  function on() { return !CBZ.CONFIG || CBZ.CONFIG.PRISON_NAV_V1 !== false; }

  // ---- 1. THE GRID -------------------------------------------------------
  let nx = 0, nz = 0, oX = 0, oZ = 0;
  let blocked = null;
  let version = 0, builtCols = -1, builtT = -1e9, buildMs = 0;

  function worldBox() {
    const W = CBZ.WORLD;
    if (!W || W.minX == null) return null;
    return { minX: W.minX - 1, maxX: W.maxX + 1, minZ: W.minZ - 1, maxZ: W.maxZ + 1 };
  }
  const ix = (x) => ((x - oX) / STEP) | 0;
  const iz = (z) => ((z - oZ) / STEP) | 0;
  const cx = (i) => oX + (i + 0.5) * STEP;
  const cz = (k) => oZ + (k + 0.5) * STEP;

  function build() {
    const b = worldBox();
    if (!b) return false;
    const t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    const w = Math.max(1, Math.ceil((b.maxX - b.minX) / STEP));
    const d = Math.max(1, Math.ceil((b.maxZ - b.minZ) / STEP));
    if (!blocked || nx !== w || nz !== d) { nx = w; nz = d; blocked = new Uint8Array(nx * nz); }
    else blocked.fill(0);
    oX = b.minX; oZ = b.minZ;
    const cols = CBZ.colliders || [];
    const cityOn = !CBZ.game || CBZ.game.mode === "city";
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      // the same two skips CBZ.collide applies, so the grid agrees with the
      // wall resolver about what is actually solid for THIS body
      if (c._city && !cityOn) continue;
      if (c.y0 != null && (c.y0 >= HEAD || c.y1 <= FOOT)) continue;
      let x0 = ix(c.minX - BODY_R), x1 = ix(c.maxX + BODY_R);
      let z0 = iz(c.minZ - BODY_R), z1 = iz(c.maxZ + BODY_R);
      if (x1 < 0 || z1 < 0 || x0 >= nx || z0 >= nz) continue;
      if (x0 < 0) x0 = 0; if (z0 < 0) z0 = 0;
      if (x1 >= nx) x1 = nx - 1; if (z1 >= nz) z1 = nz - 1;
      for (let k = z0; k <= z1; k++) {
        const row = k * nx;
        for (let j = x0; j <= x1; j++) blocked[row + j] = 1;
      }
    }
    version++;
    builtCols = cols.length;
    builtT = CBZ.game ? (+CBZ.game.elapsed || 0) : 0;
    buildMs = ((window.performance && performance.now) ? performance.now() : Date.now()) - t0;
    return true;
  }

  const REBUILD_BACKSTOP = 8;    // seconds: catches a door that swapped in place
  function ensure() {
    if (!on()) return false;
    const cols = CBZ.colliders || [];
    const now = CBZ.game ? (+CBZ.game.elapsed || 0) : 0;
    if (!blocked || cols.length !== builtCols || now - builtT > REBUILD_BACKSTOP || now < builtT) return build();
    return true;
  }

  // ---- 2. QUERIES --------------------------------------------------------
  function standable(x, z) {
    if (!blocked) return true;
    const j = ix(x), k = iz(z);
    if (j < 0 || j >= nx || k < 0 || k >= nz) return true;   // off-grid: not our business
    return !blocked[k * nx + j];
  }

  // Is a straight walk from A to B blocked? Sampled on the grid, capped so a
  // 100 m line cannot cost more than a short one — beyond the cap the answer
  // is "yes, plan a route", which is the safe direction to be wrong in.
  const LINE_CAP = 140;
  // `skip` metres of the start are not sampled. A body standing against a wall
  // is INSIDE the inflated band by design (the grid grows walls by a body
  // radius), so a line test that begins at his feet reports every direction
  // blocked, including the way out. Callers asking "can I walk from where I am
  // wedged to there" pass a skip; callers asking about open ground pass none.
  function lineBlocked(x0, z0, x1, z1, skip) {
    if (!blocked) return false;
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) return false;
    let steps = Math.ceil(len / (STEP * 0.85));
    if (steps > LINE_CAP) return true;
    const sx = dx / steps, sz = dz / steps;
    const from = skip > 0 ? Math.ceil((skip / len) * steps) : 0;
    let x = x0 + sx * from, z = z0 + sz * from;
    for (let s = from; s <= steps; s++) {
      if (!standable(x, z)) return true;
      x += sx; z += sz;
    }
    return false;
  }

  // nearest standable cell to a point, spiralling out (a goal inside a wall —
  // a bunk, a table — is a legitimate ask; route to the edge of it)
  /* `los` = "and he must be able to WALK there from (x,z) in a straight line".
     Without it the snap is a nearest-free-cell search and nothing more, which
     for a body pressed against a wall — every body the navigator is called for,
     since that is what being stuck IS — can hand back the free cell on the FAR
     SIDE of the wall he is leaning on. Measured: the first waypoint of a route
     0.6 m away, through 20 cm of concrete, walked at for as long as he lived.
     The goal end keeps the plain search: a goal legitimately sits inside the
     furniture sometimes, and the route should end at the near edge of it. */
  function nearestFree(x, z, maxRings, los) {
    let j = ix(x), k = iz(z);
    if (j < 0) j = 0; else if (j >= nx) j = nx - 1;
    if (k < 0) k = 0; else if (k >= nz) k = nz - 1;
    if (!blocked[k * nx + j]) return k * nx + j;
    const R = maxRings || 14;
    let fallback = -1;
    for (let r = 1; r <= R; r++) {
      for (let o = -r; o <= r; o++) {
        const cand = [[j + o, k - r], [j + o, k + r], [j - r, k + o], [j + r, k + o]];
        for (let q = 0; q < 4; q++) {
          const a = cand[q][0], b = cand[q][1];
          if (a < 0 || a >= nx || b < 0 || b >= nz) continue;
          const id = b * nx + a;
          if (blocked[id]) continue;
          if (!los) return id;
          if (fallback < 0) fallback = id;
          if (!lineBlocked(x, z, cx(a), cz(b), 0.75)) return id;
        }
      }
    }
    return los ? fallback : -1;
  }

  // ---- 3. A* -------------------------------------------------------------
  // Stamped visit marks instead of clearing 400k cells per plan; a binary heap
  // of (cell, score). Both are reused across plans — no per-plan allocation
  // beyond the returned point list.
  let gScore = null, parent = null, seen = null, stamp = 0;
  let heapId = null, heapScore = null, heapN = 0;

  function heapPush(id, score) {
    let i = heapN++;
    if (heapN > heapId.length) {                 // grow (once, early)
      const gi = new Int32Array(heapId.length * 2), gs = new Float32Array(heapId.length * 2);
      gi.set(heapId); gs.set(heapScore); heapId = gi; heapScore = gs;
    }
    while (i) {
      const p = (i - 1) >> 1;
      if (heapScore[p] <= score) break;
      heapId[i] = heapId[p]; heapScore[i] = heapScore[p]; i = p;
    }
    heapId[i] = id; heapScore[i] = score;
  }
  function heapPop() {
    const top = heapId[0];
    const tailId = heapId[--heapN], tailS = heapScore[heapN];
    if (heapN) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        if (l >= heapN) break;
        const c = (r < heapN && heapScore[r] < heapScore[l]) ? r : l;
        if (heapScore[c] >= tailS) break;
        heapId[i] = heapId[c]; heapScore[i] = heapScore[c]; i = c;
      }
      heapId[i] = tailId; heapScore[i] = tailS;
    }
    return top;
  }

  const DIRS = [1, 0, 1, -1, 0, 1, 0, 1, 1, 0, -1, 1,
                1, 1, Math.SQRT2, 1, -1, Math.SQRT2, -1, 1, Math.SQRT2, -1, -1, Math.SQRT2];
  /* WEIGHTED A*, AND A ROUTE THAT ENDS WHERE THE WING ENDS.

     Two numbers learned from the first measured run of this file. With a plain
     admissible heuristic a 70 m walk across the yard exhausted 24 000 nodes and
     came back NULL — the search fans out over every open square metre it can
     reach before it commits — and null meant "no route", which put the body
     straight back to grinding. 790 of 1326 plans in the curfew block failed
     that way, at 6.4 ms each, which is the worst of both: expensive AND useless.

     · HEUR_W over-weights the heuristic. The path is no longer provably
       shortest; it is committed, which for a man walking to supper is the
       better property and cuts the explored set by an order of magnitude.
     · A search that does not reach the goal now returns the BEST NODE IT SAW
       instead of nothing. A locked wing door at curfew genuinely has no route
       behind it, and the honest answer is not "give up where you stand" — it
       is "walk to the door and wait there", which is what a partial path is.
       Marked `.partial` so the follower stands instead of pressing on. */
  const HEUR_W = 1.5;
  const NODE_BUDGET = 12000;
  let plans = 0, partials = 0, planFails = 0, lastPlanMs = 0, lastNodes = 0;

  /* plan(from, to, opts) -> [{x,z}, ...] | null
     opts.portals: [{x,z,dx,dz,cost,label}] — an edge that leaves (x,z) and
     arrives at (dx,dz) for `cost` metres (systems/navigation.js's vents). The
     arrival point carries {teleportToNext, portalLabel} so that file's map
     copy still reads out of the returned list. */
  function plan(from, to, opts) {
    if (!ensure()) return null;
    const t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    const count = nx * nz;
    if (!gScore || gScore.length !== count) {
      gScore = new Float32Array(count); parent = new Int32Array(count); seen = new Int32Array(count);
      heapId = new Int32Array(4096); heapScore = new Float32Array(4096); stamp = 0;
    }
    const start = nearestFree(from.x, from.z, 14, true), goal = nearestFree(to.x, to.z);
    if (start < 0 || goal < 0) { planFails++; return null; }
    if (start === goal) return [{ x: to.x, z: to.z }];

    const portals = opts && opts.portals;
    let pMap = null;
    if (portals && portals.length) {
      pMap = new Map();
      for (let i = 0; i < portals.length; i++) {
        const v = portals[i];
        const a = nearestFree(v.x, v.z), b = nearestFree(v.dx, v.dz);
        if (a < 0 || b < 0) continue;
        let list = pMap.get(a);
        if (!list) pMap.set(a, list = []);
        list.push({ id: b, cost: v.cost || 4, label: v.label || null });
      }
    }
    let portalOf = null;

    stamp++;
    const gx1 = goal % nx, gz1 = (goal / nx) | 0;
    heapN = 0;
    seen[start] = stamp; gScore[start] = 0; parent[start] = -1;
    heapPush(start, 0);
    let nodes = 0, found = false;
    let bestNode = start, bestH = Math.hypot(gx1 - (start % nx), gz1 - ((start / nx) | 0));
    while (heapN) {
      const cur = heapPop();
      if (cur === goal) { found = true; bestNode = goal; break; }
      if (++nodes > NODE_BUDGET) break;
      const j = cur % nx, k = (cur / nx) | 0, base = gScore[cur];
      const h = Math.hypot(gx1 - j, gz1 - k);
      if (h < bestH) { bestH = h; bestNode = cur; }
      for (let d = 0; d < DIRS.length; d += 3) {
        const a = j + DIRS[d], b = k + DIRS[d + 1];
        if (a < 0 || a >= nx || b < 0 || b >= nz) continue;
        const ni = b * nx + a;
        if (blocked[ni]) continue;
        // no cutting a corner between two walls — a body cannot pass diagonally
        // through a doorjamb, and a route that says it can is a route that grinds
        if (DIRS[d] && DIRS[d + 1] && (blocked[k * nx + a] || blocked[b * nx + j])) continue;
        const next = base + DIRS[d + 2] * STEP;
        if (seen[ni] === stamp && next >= gScore[ni]) continue;
        seen[ni] = stamp; gScore[ni] = next; parent[ni] = cur;
        if (portalOf) portalOf.delete(ni);
        heapPush(ni, next + Math.hypot(gx1 - a, gz1 - b) * STEP * HEUR_W);
      }
      if (pMap) {
        const exits = pMap.get(cur);
        if (exits) for (let e = 0; e < exits.length; e++) {
          const ex = exits[e], next = base + ex.cost;
          if (seen[ex.id] === stamp && next >= gScore[ex.id]) continue;
          seen[ex.id] = stamp; gScore[ex.id] = next; parent[ex.id] = cur;
          if (!portalOf) portalOf = new Map();
          portalOf.set(ex.id, ex.label || "maintenance route");
          heapPush(ex.id, next + Math.hypot(gx1 - (ex.id % nx), gz1 - ((ex.id / nx) | 0)) * STEP * HEUR_W);
        }
      }
    }
    lastNodes = nodes;
    lastPlanMs = ((window.performance && performance.now) ? performance.now() : Date.now()) - t0;
    const end = found ? goal : bestNode;
    const sealed = !found && heapN === 0;      // the search ran DRY, not out of budget
    if (!found) {
      // a partial walk is not a failed plan — it is the honest answer to a
      // goal behind a locked door, and the body walks to the door. Only a
      // route that cannot even improve on standing still is a failure.
      if (end === start || bestH * STEP < 1.2) { planFails++; return null; }
      partials++;
    }
    plans++;

    // walk the parents back, then STRING-PULL: keep a waypoint only where the
    // straight line to the next one is blocked. A grid path is a staircase;
    // a man walks the diagonal.
    const raw = [];
    for (let at = end; at >= 0; at = parent[at]) {
      const label = portalOf ? portalOf.get(at) : null;
      raw.push({ x: cx(at % nx), z: cz((at / nx) | 0), portal: label || null });
      if (at === start) break;
    }
    raw.reverse();
    const out = [];
    let anchorX = from.x, anchorZ = from.z, i = 0;
    while (i < raw.length) {
      let j = i;
      // extend while the straight line from the anchor still clears, but never
      // across a portal hop (that leg is a teleport, not a walk)
      while (j + 1 < raw.length && !raw[j + 1].portal && !lineBlocked(anchorX, anchorZ, raw[j + 1].x, raw[j + 1].z)) j++;
      const p = raw[j];
      const w = { x: p.x, z: p.z };
      if (j + 1 < raw.length && raw[j + 1].portal) { w.teleportToNext = true; w.portalLabel = raw[j + 1].portal; }
      out.push(w);
      anchorX = p.x; anchorZ = p.z;
      i = j + 1;
    }
    // the true goal, once the last waypoint can see it
    if (found && !lineBlocked(anchorX, anchorZ, to.x, to.z)) out.push({ x: to.x, z: to.z });
    /* partial: this walk does not reach the goal. `sealed` says WHY, and the
       two answers could not be more different — a search that ran DRY means
       there is no way there at all (a locked wing at curfew: stand at the door
       and wait), while one that ran out of NODES is simply a long walk seen
       forty metres at a time (keep walking, replan from where you get to). */
    out.partial = !found;
    out.sealed = sealed;
    return out;
  }

  // ---- 4. THE FOLLOWER ---------------------------------------------------
  // What the brain wrote in `target` is a GOAL. This turns it into the next
  // step of a walk, and puts the goal back the moment it is in plain sight.
  const CHECK_MIN = 0.30;      // seconds between "is the straight line blocked" tests
  const REPLAN_MIN = 0.60;     // seconds between plans for one body
  const ARRIVE = 0.85;         // waypoint counts as reached inside this
  const NEAR_GOAL = 0.7;       // this close to the goal, walk straight at it
  const GOAL_SLACK = 2.5;      // a goal that moved less than this is the same errand
  const PLANS_PER_FRAME = 2;   // the whole cast shares this, per frame
  const STALL_SPAN = 0.55;     // seconds of no progress before he is "stuck"
  const SLIDE_TIME = 1.6;      // seconds of wall-following after a failed plan
  const PARTIAL_RETRY = 3.5;   // a door that was locked may not be next time
  const SEALED_WAIT = 1.6;     // seconds a man waits at a door he cannot open

  let budget = -1, followers = 0, slides = 0;

  function navOf(n) {
    return n._nav || (n._nav = {
      pts: null, i: 0, gx: 0, gz: 0, wx: null, wz: null,
      chk: 0, cool: 0, px: 0, pz: 0, stall: 0, slide: 0, sx: 0, sz: 0,
    });
  }
  function release(n, S, restore) {
    if (restore && S.wx != null && n.target) n.target.set(S.gx, 0, S.gz);
    S.pts = null; S.wx = S.wz = null;
  }
  // does the navigator own this body's target right now?
  function owns(n) {
    const S = n && n._nav;
    return !!(S && (S.pts || S.slide > 0));
  }

  function movable(n) {
    return !!(n && n.group && n.target && !n.dead && !(n.ko > 0) && !n.escaped && !n._crowd
      && !n._propLie && !n._propBed && !n._propSeat
      && !(CBZ.propArcActive && CBZ.propArcActive(n))
      && !(n.char && (n.char.sitting || n.char.lying)));
  }

  function follow(n, dt) {
    const S = navOf(n), p = n.group.position, t = n.target;
    S.chk -= dt; S.cool -= dt; S.slide -= dt;

    /* Whose target is this, and is it the same errand as last frame?

       The first cut asked only "does `target` still read back the waypoint I
       wrote", and that was wrong for the block where it mattered most. The
       night muster in entities/npc.js rewrites `target` EVERY FRAME with the
       same value — the leg of the authored way the man is walking — so the
       test said "somebody else wrote it, this is a new errand" sixty times a
       second, threw the route away sixty times a second, and re-planned from
       scratch. Measured: 1182 plans in ten seconds and the curfew block still
       grinding at 20%.

       An errand is the same errand when the incoming target is the goal we are
       ALREADY walking to. Only a genuinely different destination — more than a
       stride away from both our waypoint and our goal — retires the route. */
    const sameErrand = S.wx != null && Math.hypot(t.x - S.gx, t.z - S.gz) < GOAL_SLACK;
    const ours = S.wx != null && (
      (Math.abs(t.x - S.wx) < 1e-4 && Math.abs(t.z - S.wz) < 1e-4) || sameErrand);
    // A DESTINATION THAT WOBBLES IS STILL THE SAME DESTINATION. An escaping
    // inmate's goal is the exit "somewhere around (0, 130)" and entities/ai.js
    // re-rolls it a metre or two on every think; measured, that retired a
    // perfectly good ten-leg route three times a second and the man never got
    // past his first waypoint. Inside the slack the errand is the same one and
    // the route stands — only the goal coordinates are refreshed.
    if (ours && sameErrand) { S.gx = t.x; S.gz = t.z; }
    if (!ours) {
      S.pts = null; S.wx = S.wz = null; S.gx = t.x; S.gz = t.z;
      /* A GOAL INSIDE A TABLE IS A GOAL NOBODY REACHES. The brain picks the
         spot a man wants to be — a bench, a bunk edge, someone he is talking
         to — and some of those points are inside the furniture's own collider.
         The mover then walks at it forever from a body-radius away, which is a
         grind with no wall in sight (measured: two of the yard block's stalls).
         Snap the goal to the nearest square he can actually stand on, once,
         when it arrives. */
      if (!standable(S.gx, S.gz)) {
        const id = nearestFree(S.gx, S.gz, 6);
        if (id >= 0) { S.gx = cx(id % nx); S.gz = cz((id / nx) | 0); }
      }
    }
    const gx = S.gx, gz = S.gz;

    const dgx = gx - p.x, dgz = gz - p.z;
    const dg = Math.hypot(dgx, dgz);
    if (dg < NEAR_GOAL) { release(n, S, ours); return; }

    // stall bookkeeping — the measurement this file exists for, live
    const moved = Math.hypot(p.x - S.px, p.z - S.pz);
    S.px = p.x; S.pz = p.z;
    const want = (n._spd != null ? n._spd : (n.speed || 1.8)) * dt * 0.35;
    if ((n.pause || 0) <= 0 && moved < want) S.stall += dt;
    else S.stall = Math.max(0, S.stall - dt * 2);

    // straight shot? then this file has no business here.
    if (!S.pts && S.slide <= 0) {
      if (S.chk > 0) return;
      S.chk = CHECK_MIN;
      // measured from a stride away: a body pressed into geometry stands inside
      // the grid's inflated wall band, and a test from his own feet says every
      // direction is blocked, including the open one
      if (!lineBlocked(p.x, p.z, gx, gz, 0.75)) return;
    }

    // ---- follow an existing route ----
    if (S.pts) {
      // waypoints fall behind as he walks through them
      while (S.i < S.pts.length && Math.hypot(S.pts[S.i].x - p.x, S.pts[S.i].z - p.z) <= ARRIVE) S.i++;

      if (S.i >= S.pts.length) {
        const last = S.pts[S.pts.length - 1];
        if (!S.pts.partial) { release(n, S, true); return; }   // arrived: the goal is in sight
        if (S.pts.sealed) {
          /* As close as the wing lets him get — a locked door, a sealed wing.
             He STANDS there, which is what a man does at a door he cannot open,
             and the route is asked for again later in case it opens. */
          t.set(last.x, 0, last.z); S.wx = last.x; S.wz = last.z;
          n.pause = Math.max(n.pause || 0, SEALED_WAIT);
          if (S.cool <= 0) { S.pts = null; S.cool = PARTIAL_RETRY; }
          followers++;
          return;
        }
        // truncated by the node budget: a long walk seen forty metres at a
        // time. Hold this end while the next leg is planned — never hand the
        // raw goal back, that is the straight line into the wall again.
        t.set(last.x, 0, last.z); S.wx = last.x; S.wz = last.z;
        S.pts = null; S.cool = 0;
        followers++;
        return;
      }

      const w = S.pts[S.i];
      /* IS THIS LEG STILL WALKABLE? Two ways it stops being: a door shut
         across it, or he was shoved off the route. Both are the same test —
         but it is measured with a SKIP, because a body pressed against
         geometry stands inside the grid's inflated wall band by design, and a
         line test from his own feet reports every direction blocked including
         the one he is walking. Without the skip this dropped the route every
         0.3 s and the man re-planned in place forever (measured: 10 legs
         planned, leg 1 never passed, a body oscillating between waypoint and
         raw goal at (-24.8, 66.5) for the whole sample). */
      const stale = S.stall > STALL_SPAN * 2
        || (S.chk <= 0 && lineBlocked(p.x, p.z, w.x, w.z, 0.75));
      if (!stale) {
        if (S.chk <= 0) S.chk = CHECK_MIN;
        t.set(w.x, 0, w.z);
        S.wx = w.x; S.wz = w.z;
        followers++;
        return;
      }
      S.chk = CHECK_MIN; S.pts = null; S.stall = 0;
    }

    // ---- plan (budgeted across the whole cast) ----
    if (S.cool <= 0 && budget > 0) {
      budget--; S.cool = REPLAN_MIN;
      const pts = plan(p, { x: gx, z: gz });
      if (pts && pts.length) {
        S.pts = pts; S.i = 0; S.stall = 0;
        const w = pts[0];
        t.set(w.x, 0, w.z); S.wx = w.x; S.wz = w.z;
        followers++;
        return;
      }
      // Not even a partial walk — he is already as near as the wing allows.
      // Do not burn a search on this goal again for a while; grind-avoidance
      // takes over below.
      S.slide = SLIDE_TIME;
      S.cool = PARTIAL_RETRY;
    }

    // ---- wall-follow: the "bump, then look for a way round" fallback ----
    // city/citynav.js's context-steer kernel, the one a thousand pedestrians
    // already run: build a danger map from the walls in reach, keep the
    // heading that still points somewhere near the goal. A man doing this
    // reads as searching for the door rather than pressing into the wall.
    if (S.slide > 0 && S.stall > STALL_SPAN && CBZ.cityNav && CBZ.cityNav.contextSteer) {
      const s = CBZ.cityNav.contextSteer(p.x, p.z, dgx / dg, dgz / dg, null, 0, S.sx, S.sz);
      const L = Math.hypot(s.x, s.z);
      if (L > 1e-4) {
        S.sx = s.x / L; S.sz = s.z / L;
        t.set(p.x + S.sx * 3.0, 0, p.z + S.sz * 3.0);
        S.wx = t.x; S.wz = t.z;
        slides++;
      }
    }
  }

  /* THE CALL SITE IS INSIDE THE MOVER, AND IT HAS TO BE.

     This began as its own updater at order 21.8, ahead of entities/npc.js at
     22, and the day blocks improved immediately — but the curfew block did not
     move at all: 26% of attempted movement still went into walls. The reason is
     four lines into npc.js's own update, which writes `target` ITSELF (the
     night muster, the bed, the schedule's authored way) and then integrates in
     the same breath. Anything decided before that call is overwritten by it.

     So the navigator is not a pass over the cast; it is a step the mover takes,
     called once per body with `target` in its FINAL state for the frame. The
     frame hook below only resets the shared plan budget — the work happens in
     step(), from the one place that can see the answer everybody else agreed
     on. */
  CBZ.onUpdate(21.75, function () {
    if (!on()) return;
    const g = CBZ.game;
    if (!g || g.mode !== "escape" || g.state !== "playing") { budget = -1; return; }
    if (!ensure()) { budget = -1; return; }
    budget = PLANS_PER_FRAME;
    followers = 0; slides = 0;
  });

  // one body, called by its mover with the frame's final target
  function step(n, dt) {
    if (!on() || !blocked || budget < 0) return false;
    if (!movable(n)) return false;
    follow(n, dt);
    return owns(n);
  }

  // ---- 5. PUBLIC ---------------------------------------------------------
  CBZ.prisonNav = {
    ready: () => !!blocked,
    step: step,
    ensure: ensure,
    standable: standable,
    lineBlocked: lineBlocked,
    plan: plan,
    owns: owns,
    version: () => version,
    cell: STEP,
  };

  CBZ.prisonNavAudit = function () {
    let open = 0;
    if (blocked) for (let i = 0; i < blocked.length; i++) if (!blocked[i]) open++;
    return {
      on: on(), built: !!blocked, cells: blocked ? blocked.length : 0, openCells: open,
      grid: [nx, nz], step: STEP, version: version, buildMs: Math.round(buildMs * 100) / 100,
      plans: plans, partials: partials, planFails: planFails,
      lastPlanMs: Math.round(lastPlanMs * 100) / 100,
      lastNodes: lastNodes, followers: followers, slides: slides,
    };
  };
})();
