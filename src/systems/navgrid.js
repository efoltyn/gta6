/* ============================================================
   systems/navgrid.js — CBZ.navGrid: ONE WALKABILITY GRID, ONE A*, AND THE
   FOLLOWER THAT TURNS A GOAL INTO A WALK. Every mode, every cast.

   OWNER (2026-08-19): "If you're fixing running into things can you fix the
   logic root or lack why gang city ncs often run into walls instead of
   breaking infra jumping thru or SIMPLY BUMPING AND ADJUSTING OR BEING
   SMARTER ... my vision with npc war."

   The root is one sentence long and it is the same sentence in both games:
   EVERY MOVER IN THIS ENGINE WALKS A STRAIGHT LINE AT A POINT, and until this
   file nothing anywhere answered the question "and what if a building is in
   the way". The prison proved it first (systems/prisonnav.js, now folded in
   here); the city measures WORSE, because the city is made of blocks:

     escape mode, four blocks of the day   7% / 15% / 20% / 24% of attempted
                                           movement stalled against geometry
     city mode, calm street, 683 peds      56% stalled, 37 bodies grinding
                                           more than 1.5 s of a 10 s sample

   Fifty-six per cent. A gang enforcer with his goal four metres away and a
   wall between, standing in it for the whole sample. Two soldiers doing the
   same. Office workers 250 m from a goal on the far side of three city blocks,
   walking into the same facade for ten seconds. What city/peds.js has instead
   is a 0.45 s stuck timer that either SIDESTEPS at random or throws the errand
   away and rolls a new one — which is exactly the "these r dumb" the owner is
   describing: a body with no memory of what it just failed at, re-deciding
   twice a second, forever.

   WHAT IS ACTUALLY SHARED. A grid of walkable squares, an A* over it, a line
   test, and a follower that hands a mover one waypoint at a time and gets out
   of the way the moment the goal is in plain sight. Two things that are NOT
   shared, and are options instead:

     · THE WINDOW. The prison is 252 m square: one grid covers the world and
       is built in 0.3 ms. The city is EIGHT KILOMETRES with 123,072 colliders,
       and a global 0.4 m grid would be 400 million cells. So the city gets a
       320 m window that follows the player — everything anyone can see, plus
       margin — rebuilt when he leaves the middle of it, and built ACROSS
       FRAMES (a fixed box budget per frame, into a shadow buffer, swapped in
       when complete) so no rebuild is ever a hitch. Measured: 9,590 colliders
       in a city window, ~13 ms of marking, spread over four frames.
     · WHAT COUNTS AS A BODY. The prison's actors keep position on
       `group.position` and the errand in `target`; a city ped keeps it on
       `pos` and `target`. The follower takes both as arguments and neither
       cast has to change shape.

   THE POINT OF ALL OF IT, in the owner's words: NPC war. Two crews fighting
   across a block only reads as a war if the bodies GO somewhere — round the
   corner, through the door, into the lot — instead of pressing into the back
   of a building because their enemy is on the other side of it.

   Flags: CONFIG.PRISON_NAV_V1, CONFIG.CITY_NAV_V1 (either off = that mode's
   movers get their old straight line back). Gates: tools/prison-nav-check.mjs,
   tools/city-nav-check.mjs.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  const STEP = 0.4;            // grid cell, metres
  const BODY_R = 0.42;         // walls are grown by this: a free cell fits a man
  const FOOT = 0.25;           // matches actorcollide: a kerb is stepped, not walled
  const HEAD = 1.7;            // ... and a body is this tall

  // ---- 1. THE WINDOW -----------------------------------------------------
  // A built grid covers a square of the world. Ask for one with focus(); it is
  // rebuilt only when the ask leaves the middle of what is already built.
  let nx = 0, nz = 0, oX = 0, oZ = 0, half = 0;
  let blocked = null;
  /* THE COARSE TIER. A city goal is two hundred metres away and A* on 0.4 m
     cells cannot see that far for any affordable number of nodes: 12,000 nodes
     is a 44 m square, so every long ask came back PARTIAL — and a partial
     route heads for "the reachable cell nearest the goal", which on the wrong
     side of a city block IS THE WALL FACING IT. Measured: 343 of 418 city
     plans partial, bodies walking to the back of a building and pressing.
     So a long ask is answered on a 4x downsample of the same window (1.6 m
     cells, an eighth of the nodes for the same distance) and the answer is
     then string-pulled against the FINE grid, which is what keeps the legs
     honest. A coarse cell is open when ANY fine cell in it is open: better to
     propose a line the fine test then rejects than to quantise a doorway shut
     and call the far side unreachable. */
  const COARSE = 4;                      // fine cells per coarse cell
  const CSTEP = STEP * COARSE;
  /* WHEN a coarse answer is the right answer is a property of the WORLD, not
     of this file. The prison is 250 m of dense interior: fine A* reaches every
     corner of it inside the node budget, and routing it coarsely measurably
     hurt (curfew went 1% -> 14% stalled, seven bodies grinding). The city is
     eight kilometres of blocks where a fine search cannot see past forty
     metres. So the caller sets it on the window it asks for; Infinity means
     "never go coarse". */
  let coarseOver = Infinity;
  let coarse = null, cnx = 0, cnz = 0;
  let version = 0, builtCols = -1, builtT = -1e9, buildMs = 0, builds = 0;
  let cx0 = 0, cz0 = 0;                       // centre of the built window

  // a rebuild in progress: marking runs across frames into a shadow buffer
  let job = null;
  const BOX_BUDGET = 3000;     // colliders marked per frame while rebuilding
  const _boxes = [];

  const ix = (x) => ((x - oX) / STEP) | 0;
  const iz = (z) => ((z - oZ) / STEP) | 0;
  const cx = (i) => oX + (i + 0.5) * STEP;
  const cz = (k) => oZ + (k + 0.5) * STEP;

  function gather(centreX, centreZ, reach, out) {
    out.length = 0;
    if (CBZ.queryCollidersNear) {
      CBZ.queryCollidersNear(centreX, centreZ, reach + 4, out);
      return out;
    }
    const cols = CBZ.colliders || [];
    const cityOn = !CBZ.game || CBZ.game.mode === "city";
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c._city && !cityOn) continue;
      if (c.maxX < centreX - reach || c.minX > centreX + reach) continue;
      if (c.maxZ < centreZ - reach || c.minZ > centreZ + reach) continue;
      out.push(c);
    }
    return out;
  }

  function startBuild(centreX, centreZ, reach) {
    const w = Math.max(1, Math.ceil((reach * 2) / STEP));
    const buf = (job && job.buf && job.buf.length === w * w) ? job.buf : new Uint8Array(w * w);
    buf.fill(0);
    const boxes = gather(centreX, centreZ, reach, _boxes).slice();
    job = {
      buf: buf, n: w, oX: centreX - reach, oZ: centreZ - reach,
      cx: centreX, cz: centreZ, half: reach, boxes: boxes, i: 0, ms: 0,
    };
  }

  // mark one budget's worth of boxes; returns true when the window is finished
  function pumpBuild() {
    if (!job) return false;
    const t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    const N = job.n, buf = job.buf, jx = job.oX, jz = job.oZ;
    const cityOn = !CBZ.game || CBZ.game.mode === "city";
    const end = Math.min(job.boxes.length, job.i + BOX_BUDGET);
    for (let i = job.i; i < end; i++) {
      const c = job.boxes[i];
      // the same two skips CBZ.collide applies, so the grid agrees with the
      // wall resolver about what is actually solid for THIS body
      if (c._city && !cityOn) continue;
      if (c.y0 != null && (c.y0 >= HEAD || c.y1 <= FOOT)) continue;
      let x0 = ((c.minX - BODY_R - jx) / STEP) | 0, x1 = ((c.maxX + BODY_R - jx) / STEP) | 0;
      let z0 = ((c.minZ - BODY_R - jz) / STEP) | 0, z1 = ((c.maxZ + BODY_R - jz) / STEP) | 0;
      if (x1 < 0 || z1 < 0 || x0 >= N || z0 >= N) continue;
      if (x0 < 0) x0 = 0; if (z0 < 0) z0 = 0;
      if (x1 >= N) x1 = N - 1; if (z1 >= N) z1 = N - 1;
      for (let k = z0; k <= z1; k++) {
        const row = k * N;
        for (let j = x0; j <= x1; j++) buf[row + j] = 1;
      }
    }
    job.i = end;
    job.ms += ((window.performance && performance.now) ? performance.now() : Date.now()) - t0;
    if (job.i < job.boxes.length) return false;
    // downsample for the coarse tier, then swap the finished window in
    const CN = Math.ceil(job.n / COARSE);
    if (!coarse || coarse.length !== CN * CN) coarse = new Uint8Array(CN * CN);
    coarse.fill(1);
    for (let k = 0; k < job.n; k++) {
      const row = k * job.n, crow = ((k / COARSE) | 0) * CN;
      for (let j = 0; j < job.n; j++) if (!job.buf[row + j]) coarse[crow + ((j / COARSE) | 0)] = 0;
    }
    cnx = cnz = CN;
    blocked = job.buf; nx = nz = job.n; oX = job.oX; oZ = job.oZ;
    cx0 = job.cx; cz0 = job.cz; half = job.half;
    buildMs = job.ms; builds++; version++;
    builtCols = (CBZ.colliders || []).length;
    builtT = CBZ.game ? (+CBZ.game.elapsed || 0) : 0;
    job = null;
    return true;
  }

  const REBUILD_BACKSTOP = 8;   // seconds: catches a door that swapped in place
  /* focus(x, z, reach, opts) — "I need walkable answers around here."
     opts.watchColliders: rebuild when the collider COUNT changes (the prison,
       where every door open/close splices its wall in or out and the whole
       world is one cheap window). A city rebuilds on movement and the backstop
       instead: its collider count churns constantly and a 320 m window is not
       something to redo sixty times a second. */
  function focus(x, z, reach, opts) {
    const keep = reach * 0.42;            // leave the middle → time for a new one
    const watch = opts && opts.watchColliders;
    coarseOver = (opts && opts.coarseOver != null) ? opts.coarseOver : Infinity;
    const now = CBZ.game ? (+CBZ.game.elapsed || 0) : 0;
    const stale = !blocked || half !== reach
      || Math.abs(x - cx0) > keep || Math.abs(z - cz0) > keep
      || (watch && (CBZ.colliders || []).length !== builtCols)
      || now - builtT > REBUILD_BACKSTOP || now < builtT;
    if (stale && !job) startBuild(x, z, reach);
    if (job) pumpBuild();                 // a slice per frame; the old window still serves
    return !!blocked;
  }

  // ---- 2. QUERIES --------------------------------------------------------
  // Off-window is "not our business": the caller keeps whatever it was doing.
  function standable(x, z) {
    if (!blocked) return true;
    const j = ix(x), k = iz(z);
    if (j < 0 || j >= nx || k < 0 || k >= nz) return true;
    return !blocked[k * nx + j];
  }
  function inWindow(x, z) {
    return !!blocked && x > oX && x < oX + nx * STEP && z > oZ && z < oZ + nz * STEP;
  }

  // Is a straight walk from A to B blocked? Sampled on the grid, capped so a
  // long line cannot cost more than a short one — beyond the cap the answer is
  // "yes, plan a route", which is the safe direction to be wrong in.
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
    const steps = Math.ceil(len / (STEP * 0.85));
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

  /* `los` = "and he must be able to WALK there from (x,z) in a straight line".
     Without it the snap is a nearest-free-cell search and nothing more, which
     for a body pressed against a wall — every body the navigator is called for,
     since that is what being stuck IS — can hand back the free cell on the FAR
     SIDE of the wall he is leaning on. Measured: the first waypoint of a route
     0.6 m away, through 20 cm of concrete, walked at for as long as he lived.
     The goal end keeps the plain search: a goal legitimately sits inside the
     furniture sometimes, and the route should end at the near edge of it. */
  function nearestFreeIn(g, gn, gs, x, z, maxRings, los) {
    if (!g) return -1;
    const gi = (v, o) => ((v - o) / gs) | 0;
    const ctr = (i, o) => o + (i + 0.5) * gs;
    let j = gi(x, oX), k = gi(z, oZ);
    if (j < 0) j = 0; else if (j >= gn) j = gn - 1;
    if (k < 0) k = 0; else if (k >= gn) k = gn - 1;
    if (!g[k * gn + j]) return k * gn + j;
    const R = maxRings || 14;
    let fallback = -1;
    for (let r = 1; r <= R; r++) {
      for (let o = -r; o <= r; o++) {
        const cand = [[j + o, k - r], [j + o, k + r], [j - r, k + o], [j + r, k + o]];
        for (let q = 0; q < 4; q++) {
          const a = cand[q][0], b = cand[q][1];
          if (a < 0 || a >= gn || b < 0 || b >= gn) continue;
          const id = b * gn + a;
          if (g[id]) continue;
          if (!los) return id;
          if (fallback < 0) fallback = id;
          if (!lineBlocked(x, z, ctr(a, oX), ctr(b, oZ), 0.75)) return id;
        }
      }
    }
    return los ? fallback : -1;
  }
  function nearestFree(x, z, maxRings, los) {
    if (!blocked) return -1;
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
    if (!blocked) return null;
    const t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    // WHICH TIER. Short asks get the fine grid (it threads doorways); anything
    // past a block gets the coarse one, whose legs are then string-pulled back
    // against the fine grid below, so the answer is never coarser than the
    // walk it describes.
    const far = coarse && Math.hypot(to.x - from.x, to.z - from.z) > coarseOver;
    const g = far ? coarse : blocked;
    const gn = far ? cnx : nx;
    const gs = far ? CSTEP : STEP;
    const ctrX = (i) => oX + ((i % gn) + 0.5) * gs;
    const ctrZ = (i) => oZ + (((i / gn) | 0) + 0.5) * gs;
    const count = nx * nz;
    if (!gScore || gScore.length !== count) {
      gScore = new Float32Array(count); parent = new Int32Array(count); seen = new Int32Array(count);
      heapId = new Int32Array(4096); heapScore = new Float32Array(4096); stamp = 0;
    }
    const start = nearestFreeIn(g, gn, gs, from.x, from.z, 14, true), goal = nearestFreeIn(g, gn, gs, to.x, to.z, 14);
    if (start < 0 || goal < 0) { planFails++; return null; }
    if (start === goal) return [{ x: to.x, z: to.z }];

    const portals = opts && opts.portals;
    let pMap = null;
    if (portals && portals.length) {
      pMap = new Map();
      for (let i = 0; i < portals.length; i++) {
        const v = portals[i];
        const a = nearestFreeIn(g, gn, gs, v.x, v.z, 14), b = nearestFreeIn(g, gn, gs, v.dx, v.dz, 14);
        if (a < 0 || b < 0) continue;
        let list = pMap.get(a);
        if (!list) pMap.set(a, list = []);
        list.push({ id: b, cost: v.cost || 4, label: v.label || null });
      }
    }
    let portalOf = null;

    stamp++;
    const gx1 = goal % gn, gz1 = (goal / gn) | 0;
    heapN = 0;
    seen[start] = stamp; gScore[start] = 0; parent[start] = -1;
    heapPush(start, 0);
    let nodes = 0, found = false;
    let bestNode = start, bestH = Math.hypot(gx1 - (start % gn), gz1 - ((start / gn) | 0));
    while (heapN) {
      const cur = heapPop();
      if (cur === goal) { found = true; bestNode = goal; break; }
      if (++nodes > NODE_BUDGET) break;
      const j = cur % gn, k = (cur / gn) | 0, base = gScore[cur];
      const h = Math.hypot(gx1 - j, gz1 - k);
      if (h < bestH) { bestH = h; bestNode = cur; }
      for (let d = 0; d < DIRS.length; d += 3) {
        const a = j + DIRS[d], b = k + DIRS[d + 1];
        if (a < 0 || a >= gn || b < 0 || b >= gn) continue;
        const ni = b * gn + a;
        if (g[ni]) continue;
        // no cutting a corner between two walls — a body cannot pass diagonally
        // through a doorjamb, and a route that says it can is a route that grinds
        if (DIRS[d] && DIRS[d + 1] && (g[k * gn + a] || g[b * gn + j])) continue;
        const next = base + DIRS[d + 2] * gs;
        if (seen[ni] === stamp && next >= gScore[ni]) continue;
        seen[ni] = stamp; gScore[ni] = next; parent[ni] = cur;
        if (portalOf) portalOf.delete(ni);
        heapPush(ni, next + Math.hypot(gx1 - a, gz1 - b) * gs * HEUR_W);
      }
      if (pMap) {
        const exits = pMap.get(cur);
        if (exits) for (let e = 0; e < exits.length; e++) {
          const ex = exits[e], next = base + ex.cost;
          if (seen[ex.id] === stamp && next >= gScore[ex.id]) continue;
          seen[ex.id] = stamp; gScore[ex.id] = next; parent[ex.id] = cur;
          if (!portalOf) portalOf = new Map();
          portalOf.set(ex.id, ex.label || "maintenance route");
          heapPush(ex.id, next + Math.hypot(gx1 - (ex.id % gn), gz1 - ((ex.id / gn) | 0)) * gs * HEUR_W);
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
      if (end === start || bestH * gs < 1.2) { planFails++; return null; }
      partials++;
    }
    plans++;

    // walk the parents back, then STRING-PULL: keep a waypoint only where the
    // straight line to the next one is blocked. A grid path is a staircase;
    // a man walks the diagonal.
    const raw = [];
    for (let at = end; at >= 0; at = parent[at]) {
      const label = portalOf ? portalOf.get(at) : null;
      raw.push({ x: ctrX(at), z: ctrZ(at), portal: label || null });
      if (at === start) break;
    }
    raw.reverse();
    /* A COARSE CELL IS OPEN IF ANY FINE CELL IN IT IS — WHICH MEANS ITS CENTRE
       CAN BE SOLID. Walking a body at the middle of a 1.6 m square that is
       "open" because one corner of it is open puts him in the wall, and that
       is not a theory: it took the prison's curfew block from 1% stalled
       straight back to 29% with fifteen bodies grinding, the whole fault
       restored, the first time this ran without the next four lines. Every
       coarse waypoint is snapped onto a fine cell a body can stand on. */
    if (far) for (let r = 0; r < raw.length; r++) {
      const id = nearestFree(raw[r].x, raw[r].z, 4);
      if (id >= 0) { raw[r].x = cx(id % nx); raw[r].z = cz((id / nx) | 0); }
    }
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
  /* What a brain wrote in `target` is a GOAL. This turns it into the next step
     of a walk that exists, and puts the goal back the moment it is in plain
     sight. It is deliberately blind to what KIND of body it is steering: it
     takes the position and the target vectors and a couple of numbers, so the
     prison's inmates (entities/npc.js) and the city's pedestrians
     (city/peds.js) share one implementation and one set of bugs. */
  const CHECK_MIN = 0.30;      // seconds between "is the straight line blocked" tests
  const REPLAN_MIN = 0.60;     // seconds between plans for one body
  const ARRIVE = 0.85;         // waypoint counts as reached inside this
  const NEAR_GOAL = 0.7;       // this close to the goal, walk straight at it
  const GOAL_SLACK = 2.5;      // a goal that moved less than this is the same errand
  const STALL_SPAN = 0.55;     // seconds of no progress before he is "stuck"
  const SLIDE_TIME = 1.6;      // seconds of wall-following after a failed plan
  const PARTIAL_RETRY = 3.5;   // a door that was locked may not be next time
  const SEALED_WAIT = 1.6;     // seconds a man waits at a door he cannot open

  let budget = -1, followers = 0, slides = 0;
  // A COUNT OF PLANS IS NOT A COST. One search of a 40 m corner and one across
  // a whole wing differ by an order of magnitude, so the frame is capped in
  // MILLISECONDS as well: whichever runs out first stops the planning.
  let spent = 0, msBudget = 2.5;

  function navOf(a) {
    return a._nav || (a._nav = {
      pts: null, i: 0, gx: 0, gz: 0, wx: null, wz: null,
      chk: 0, cool: 0, px: 0, pz: 0, stall: 0, slide: 0, sx: 0, sz: 0, need: 0,
    });
  }
  function setT(t, x, z) { if (t.set) t.set(x, 0, z); else { t.x = x; t.z = z; } }
  function release(a, S, t, restore) {
    if (restore && S.wx != null && t) setT(t, S.gx, S.gz);
    S.pts = null; S.wx = S.wz = null;
  }
  // does the navigator own this body's target right now? (movers ask before
  // running their own stuck-recovery: a body walking the long way is not stuck)
  function owns(a) {
    const S = a && a._nav;
    return !!(S && (S.pts || S.slide > 0));
  }

  /* frame(plansPerFrame) — called once per frame by whichever mode is using
     the grid. The plan budget is SHARED by the whole cast: a search is a few
     tenths of a millisecond and a city has hundreds of bodies, so the cap is
     what keeps a busy moment from turning into a spike. */
  function frame(plansPerFrame, msPerFrame) {
    budget = plansPerFrame > 0 ? plansPerFrame : 0;
    msBudget = msPerFrame > 0 ? msPerFrame : 2.5;
    spent = 0; followers = 0; slides = 0;
  }
  function idle() { budget = -1; }

  function follow(a, p, t, dt, o) {
    const S = navOf(a);
    S.chk -= dt; S.cool -= dt; S.slide -= dt;

    /* Whose target is this, and is it the same errand as last frame?

       The first cut asked only "does `target` still read back the waypoint I
       wrote", and that was wrong for the block where it mattered most. The
       prison's night muster rewrites `target` EVERY FRAME with the same value
       — the leg of the authored way the man is walking — so the test said
       "somebody else wrote it, this is a new errand" sixty times a second,
       threw the route away sixty times a second, and re-planned from scratch.
       Measured: 1182 plans in ten seconds and the block still grinding at 20%.

       An errand is the same errand when the incoming target is the goal we are
       ALREADY walking to. Only a genuinely different destination — further
       than the slack from both our waypoint and our goal — retires the route.
       A DESTINATION THAT WOBBLES IS STILL THE SAME DESTINATION: an escaping
       inmate's exit and a fighter's mark both re-roll a metre or two per
       think, and inside the slack the route stands. */
    const slack = o.slack || GOAL_SLACK;
    const sameErrand = S.wx != null && Math.hypot(t.x - S.gx, t.z - S.gz) < slack;
    const ours = S.wx != null && (
      (Math.abs(t.x - S.wx) < 1e-4 && Math.abs(t.z - S.wz) < 1e-4) || sameErrand);
    if (ours && sameErrand) { S.gx = t.x; S.gz = t.z; }
    if (!ours) {
      S.pts = null; S.wx = S.wz = null; S.gx = t.x; S.gz = t.z; S.chk = 0;
      /* A GOAL INSIDE A TABLE IS A GOAL NOBODY REACHES. A brain picks the spot
         a body wants to be — a bench, a bunk edge, the man it is fighting —
         and some of those points are inside the furniture's own collider. The
         mover then walks at it forever from a body-radius away, which is a
         grind with no wall in sight. Snap it to the nearest square he can
         actually stand on, once, when it arrives. */
      if (!standable(S.gx, S.gz)) {
        const id = nearestFree(S.gx, S.gz, 6);
        if (id >= 0) { S.gx = cx(id % nx); S.gz = cz((id / nx) | 0); }
      }
    }
    const gx = S.gx, gz = S.gz;

    const dgx = gx - p.x, dgz = gz - p.z;
    const dg = Math.hypot(dgx, dgz);
    if (dg < (o.nearGoal || NEAR_GOAL)) { release(a, S, t, ours); return; }

    // stall bookkeeping — the measurement this file exists for, live
    const moved = Math.hypot(p.x - S.px, p.z - S.pz);
    S.px = p.x; S.pz = p.z;
    if (moved < (o.speed || 1.8) * dt * 0.35) S.stall += dt;
    else S.stall = Math.max(0, S.stall - dt * 2);

    /* STRAIGHT SHOT? THEN THIS FILE HAS NO BUSINESS HERE — but the answer is
       REMEMBERED, and that matters more than it looks. The first cut returned
       early whenever the throttle said "not time to re-test the line yet",
       which quietly meant a body could only ever ASK FOR A ROUTE on the one
       frame in eighteen when its line test ran. In the prison, forty bodies
       sharing two plans a frame, nobody noticed. In a city of 690 the odds of
       the shared budget being free on exactly that frame are small, and the
       measurement was brutal: of three bodies given a goal behind a building,
       ONE ever got a route and walked it (44 m -> 13 m); the other two never
       got one at all and drifted for thirty seconds. Test on the throttle,
       want on every frame. */
    if (!S.pts && S.slide <= 0) {
      if (S.chk <= 0) {
        S.chk = CHECK_MIN;
        // measured from a stride away: a body pressed into geometry stands
        // inside the grid's inflated wall band, and a test from its own feet
        // says every direction is blocked, including the open one
        S.need = lineBlocked(p.x, p.z, gx, gz, 0.75) ? 1 : 0;
      }
      if (!S.need) return;
    }

    // ---- follow an existing route ----
    if (S.pts) {
      while (S.i < S.pts.length && Math.hypot(S.pts[S.i].x - p.x, S.pts[S.i].z - p.z) <= ARRIVE) S.i++;

      if (S.i >= S.pts.length) {
        const last = S.pts[S.pts.length - 1];
        if (!S.pts.partial) { release(a, S, t, true); return; }   // arrived: goal in sight
        if (S.pts.sealed) {
          /* As close as the world lets him get — a locked door, a sealed wing,
             a walled lot. He STANDS there, which is what a person does at a
             door they cannot open, and the route is asked for again later in
             case it opens. */
          setT(t, last.x, last.z); S.wx = last.x; S.wz = last.z;
          if (o.wait) o.wait(a, o.sealedWait || SEALED_WAIT);
          if (S.cool <= 0) { S.pts = null; S.cool = PARTIAL_RETRY; }
          followers++;
          return;
        }
        // truncated by the node budget: a long walk seen a chunk at a time.
        // Hold this end while the next leg is planned — never hand the raw
        // goal back, that is the straight line into the wall again.
        setT(t, last.x, last.z); S.wx = last.x; S.wz = last.z;
        S.pts = null; S.cool = 0;
        followers++;
        return;
      }

      const w = S.pts[S.i];
      /* IS THIS LEG STILL WALKABLE? Two ways it stops being: something shut
         across it, or the body was shoved off the route. Both are the same
         test — measured with a SKIP, for the same reason as above. Without the
         skip this dropped the route every 0.3 s and the body re-planned in
         place forever (measured: 10 legs planned, leg 1 never passed). */
      const stale = S.stall > STALL_SPAN * 2
        || (S.chk <= 0 && lineBlocked(p.x, p.z, w.x, w.z, 0.75));
      if (!stale) {
        if (S.chk <= 0) S.chk = CHECK_MIN;
        setT(t, w.x, w.z);
        S.wx = w.x; S.wz = w.z;
        followers++;
        return;
      }
      S.chk = CHECK_MIN; S.pts = null; S.stall = 0;
    }

    // ---- plan (budgeted across the whole cast) ----
    if (S.cool <= 0 && budget > 0 && spent < msBudget) {
      budget--; S.cool = REPLAN_MIN;
      const pt0 = (window.performance && performance.now) ? performance.now() : Date.now();
      const pts = plan(p, { x: gx, z: gz });
      spent += ((window.performance && performance.now) ? performance.now() : Date.now()) - pt0;
      if (pts && pts.length) {
        S.pts = pts; S.i = 0; S.stall = 0;
        const w = pts[0];
        setT(t, w.x, w.z); S.wx = w.x; S.wz = w.z;
        followers++;
        return;
      }
      // Not even a partial walk — already as near as the world allows. Do not
      // burn a search on this goal again for a while; grind-avoidance below.
      S.slide = SLIDE_TIME;
      S.cool = PARTIAL_RETRY;
    }

    // ---- wall-follow: the "bump, then look for a way round" fallback -------
    // city/citynav.js's context-steer kernel, the one a thousand pedestrians
    // already run: a danger map of the walls in reach, and the heading that
    // still points somewhere near the goal survives. A body doing this reads
    // as looking for a way round rather than pressing into the wall.
    if (S.slide > 0 && S.stall > STALL_SPAN && CBZ.cityNav && CBZ.cityNav.contextSteer) {
      const s = CBZ.cityNav.contextSteer(p.x, p.z, dgx / dg, dgz / dg, null, 0, S.sx, S.sz);
      const L = Math.hypot(s.x, s.z);
      if (L > 1e-4) {
        S.sx = s.x / L; S.sz = s.z / L;
        setT(t, p.x + S.sx * 3.0, p.z + S.sz * 3.0);
        S.wx = t.x; S.wz = t.z;
        slides++;
      }
    }
  }

  /* step(actor, pos, target, dt, opts) — ONE BODY, called by its own mover with
     `target` in its FINAL state for the frame.

     The prison version of this began as an updater ahead of the mover, and the
     day blocks improved immediately while the curfew block did not move at all.
     The reason was four lines into entities/npc.js, which writes `target`
     ITSELF (the night muster, the bed, the authored way) and then integrates in
     the same breath: anything decided before that call is overwritten by it.
     So the navigator is not a pass over the cast; it is a step the mover takes.

     opts: {speed, slack, nearGoal, sealedWait, wait(actor, seconds)} */
  const NO_OPTS = {};
  function step(a, p, t, dt, opts) {
    if (!blocked || budget < 0 || !a || !p || !t) return false;
    if (!inWindow(p.x, p.z)) return false;      // outside the built window: not ours
    follow(a, p, t, dt, opts || NO_OPTS);
    return owns(a);
  }

  // ---- 5. PUBLIC ---------------------------------------------------------
  CBZ.navGrid = {
    focus: focus,
    ready: () => !!blocked,
    inWindow: inWindow,
    standable: standable,
    lineBlocked: lineBlocked,
    nearestFree: (x, z, rings, los) => nearestFree(x, z, rings, los),
    cellCentre: (id) => ({ x: cx(id % nx), z: cz((id / nx) | 0) }),
    plan: plan,
    step: step,
    owns: owns,
    frame: frame,
    idle: idle,
    version: () => version,
    cell: STEP,
  };

  CBZ.navGridAudit = function () {
    let open = 0;
    if (blocked) for (let i = 0; i < blocked.length; i++) if (!blocked[i]) open++;
    return {
      built: !!blocked, building: !!job, builds: builds,
      cells: blocked ? blocked.length : 0, openCells: open, grid: [nx, nz], step: STEP,
      centre: [Math.round(cx0), Math.round(cz0)], half: half, version: version,
      buildMs: Math.round(buildMs * 100) / 100,
      plans: plans, partials: partials, planFails: planFails,
      lastPlanMs: Math.round(lastPlanMs * 100) / 100, lastNodes: lastNodes,
      followers: followers, slides: slides,
    };
  };
})();
