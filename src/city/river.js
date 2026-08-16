/* ============================================================
   city/river.js — THE RIVER. The marina's way to the sea.

   OWNER WANT (2026-08-15)
   -----------------------
   "the city marina needs a single river that takes all the way to the ocean.
    why would there be a marina in an island if it didn't go connect ocean
    somewhere? and that's ingress egress too but if marina"

   AND HE IS RIGHT, AND IT IS WORSE THAN "NO RIVER"
   ------------------------------------------------
   The marina was a POND. Measured, not guessed: a flood fill over
   CBZ.cityWaterAt from a marina berth, 8 m step, reaches 465 cells and stops
   314 m out. Rays fired from the quay in sixteen bearings find no wet run
   longer than 240 m within six kilometres. The world sea spans +/-54,000.

   The cause is in city/continent.js and it is one function. `bayDist` is a
   CHEBYSHEV distance outside the city rect, and the harbour pass opens water
   between BAY0 = 28 and BAY1 = 95 of it. That is a 67 m MOAT around the city
   rect — closed, on all four sides, with no outlet anywhere. Everything that
   floats in this game floats in it: the marina's 80 berths, world.js's three
   harbour hulls, the beach's dock, the yacht roadstead. A harbour ring with
   no river is a water feature, not a harbour, and the nearest real coast is
   7.0 km away.

   WHAT THIS FILE ADDS
   -------------------
   ONE river, from the bay ring to the open sea, carved by the SAME signed
   shore field that carves everything else — so it is water the way the ocean
   is water, with no second oracle to disagree with the first:

     · it renders (continent.js lowers the plate wherever shoreField < 0 and
       the sea plane shows through),
     · you can swim it (city/swim.js reads cityWaterAt),
     · boats float and drive it (water_buoyancy / the marine hulls),
     · wildlife navigates it (isNavigableWater),
     · it is on the map (systems/fullmap.js samples mapTerrain.shoreAt),

   ...because all five of those already read `city.mapTerrain.shoreAt`, and
   that function already folds in `city.waterBodies`. This file registers ONE
   body. It does not draw a single triangle of water.

   THE ROUTE IS A SEARCH, and it had to become one. The first version fanned
   straight corridors off the harbour and scored them; its own diagnostics
   then reported that EVERY bearing out of the marina's water is walled —
   east by the Commerce Annex and the Ironjaw Arena, north by the County Jail
   and Mount Mercy, and the other two faces are not the marina's water at
   all. There is a way out; it simply is not straight. So the route is a
   weighted grid search over the whole plate: POIs are walls (a river through
   the Defence Headquarters is worse than no river), roads and decks are
   PRICED, and the winner is string-pulled back into the few bends the
   country actually forces. On the shipping seed it runs 8.7 km north and
   crosses one road.

   THE HARBOUR IS NOT ONE POND EITHER. Walking the bay ring shows it chopped
   into five arcs — the County Jail and City Hall sit ON it and hold their
   land, the east bridge and the Halloran causeway are decks that read as
   land. A river dug from the west arc drains the west arc and leaves the
   marina exactly as landlocked as it found it. That is not a hypothetical:
   it is what the first working version shipped and what the audit caught. So
   the arc containing the marina's own water is flood filled first, and a
   route may only start inside it.

   AND A BOAT COULD NOT PASS UNDER A BRIDGE. This is the finding underneath
   all of it. waterfield.js's isSurfaceWater() answers "not water" over any
   deck — right for a road car, since vehicles.js floods anything on water,
   and fatal for the hull passing beneath, which is what the bridge is FOR.
   This country carries 31 highway link regions and there is no route from
   the harbour to any coast that avoids them all, so with decks as walls the
   router correctly reported that no river can exist. Putting the exception
   in the shared oracle instead made the gate fail with CARS ON WATER: 1 — a
   car floating on its own bridge. The split is therefore by ASKER, in
   vehicles.js, where the asker is known: a marine hull reads the new
   CBZ.cityNavWaterAt (surface water, plus a registered channel under a
   deck), and everything with wheels keeps CBZ.cityWaterAt unchanged.

   THE CROSSINGS this file adds for its own river are REGIONS, not models:
   continent.js's inSolidRegion() skips /bridge|causeway|link/ names so the
   water is carved under them, and overDeck() matches the same names so the
   deck reads as land above. The piers and parapets drawn here are so the
   crossing READS as a bridge; they are not what makes it one. A crossing is
   never laid inside the bay ring — one there would sever the harbour, which
   is a mistake this file made once and now refuses by construction.

   THE RATCHET IS THE WHOLE POINT OF THE FEATURE. CBZ.cityRiverAudit() flood
   fills from a real marina berth, through the BOAT's oracle, and reports
   whether it reaches open sea. Not "did we register a river" — whether a
   boat can get out. Pin `connected` true.

   DETERMINISM: pure geometry plus CBZ.hash01 for the meander. No Math.random.

   FLAGS (one-line revert each):
     CBZ.CONFIG.CITY_RIVER         (true)  — carve it at all
     CBZ.CONFIG.CITY_RIVER_BRIDGES (true)  — the crossings' decks + regions

   Exposes: CBZ.cityRiver, CBZ.cityRiverAudit.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const C = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (C.CITY_RIVER == null) C.CITY_RIVER = true;
  if (C.CITY_RIVER_BRIDGES == null) C.CITY_RIVER_BRIDGES = true;

  /* ---- THE WIDTH, and it is set by the PLATE, not by taste ---------------
     continent.js builds the ground on a grid whose cell is PLATE_CELL = 38 m
     (it says so, and it derives its segment count from that constant rather
     than typing one). A channel narrower than about three cells cannot be
     resolved by that mesh: it renders as a ragged notch that closes and
     re-opens along its length, which is worse than no river because it looks
     like a bug. 58 m of half-width is 116 m across — three cells and a
     margin — and it flares at the mouth the way a river actually meets a sea.
     The bay ring it joins is 67 m wide, so the taper at the top end matches
     the harbour rather than swallowing it. */
  const HALF_MID = 58, HALF_MOUTH = 92, HALF_HEAD = 40;
  const MEANDER = 130;        // metres of lateral wander
  const WAVE = 950;           // metres per meander cycle
  const STEP = 165;           // polyline spacing (a plate cell is 38)

  let river = null;           // { pts, half[], side, bridges[], length }
  let audit = { built: false, reason: "not run", length: 0, points: 0, bridges: 0, crossings: 0 };

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function isLinkName(n) { return !!(n && /bridge|causeway|link/i.test(n)); }

  // ---- deterministic smooth noise, the shape continent.js/expansion.js use
  function sm01(t) { return t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t); }
  function wobble(t, salt) {
    if (!CBZ.hash01) return 0;
    const g = t / WAVE, i0 = Math.floor(g), f = sm01(g - i0);
    const a = CBZ.hash01(i0 * WAVE, salt, 5501), b = CBZ.hash01((i0 + 1) * WAVE, salt, 5501);
    return (a + (b - a) * f) * 2 - 1;
  }

  /* ============================================================
     CBZ.cityRiverCarve(city, ctx) — CALLED BY city/continent.js.
     ------------------------------------------------------------
     WHY IT IS A CALLBACK AND NOT A LANDMASS BUILDER, which is the whole
     lesson of this pass: a river has to know where the SEA is, and until
     continent.js has built its shore field nothing in this world does.
     Registering at order 96.5 and asking CBZ.cityWaterAt put this file
     straight into the trap the marina had just been pulled out of — before
     order 97, waterfield.js answers every water question with its boot-time
     fallback ("outside the city rect and outside every region IS water"), so
     the corridor walk found the "sea" 2.2 km inland at the first gap between
     two regions and stopped there.

     continent.js now calls this the moment its own shoreField exists and
     before it folds inland bodies in — so `ctx.shoreAt` is the REAL coast
     with no river in it yet, which is exactly the oracle "how far to the
     sea" needs. The returned body goes straight into the array that field
     reads. One hook, one direction of dependency, no guessing.

       ctx.shoreAt(x, z)  signed metres to the coast (negative = water)
       ctx.plate          { minX, maxX, minZ, maxZ } of the ground plate
     Returns the water body to carve, or null.
     ============================================================ */
  CBZ.cityRiverCarve = function (city, ctx) {
    river = null;
    audit = { built: false, reason: "off", length: 0, points: 0, bridges: 0, crossings: 0 };
    if (C.CITY_RIVER === false) return null;
    if (!city || !isFinite(city.minX)) { audit.reason = "no city rect"; return null; }
    if (!ctx || typeof ctx.shoreAt !== "function") { audit.reason = "no coastline oracle"; return null; }

    const regs = city.regions || [], roads = city.roads || [];
    // The bay ring's own numbers, from continent.js's harbour pass. Kept here
    // as the two constants they are there (BAY0 = the swim.js QUAY line,
    // BAY1 = the outer edge) rather than re-derived, because a river that
    // starts anywhere else does not touch the water it exists to drain.
    const BAY0 = 28, BAY1 = 95, RING_MID = (BAY0 + BAY1) / 2;

    /* ---- WHAT A CORRIDOR WOULD HAVE TO CUT THROUGH --------------------- */
    function regionAt(x, z, m) {
      for (let i = 0; i < regs.length; i++) {
        const r = regs[i];
        if (isLinkName(r.name)) continue;                 // decks are crossed, not avoided
        // The backcountry IS the open country this river is supposed to run
        // through; it is a label on the wilds, not a place with a wall.
        if (r.name && /backcountry|wilds/i.test(r.name)) continue;
        if (r.kind === "circle") {
          if (Math.hypot(x - r.cx, z - r.cz) < r.r + (r.pad || 0) + m) return r;
        } else if (x > r.minX - m && x < r.maxX + m && z > r.minZ - m && z < r.maxZ + m) return r;
      }
      return null;
    }
    function roadsCrossing(x, z, m) {
      const out = [];
      for (let i = 0; i < roads.length; i++) {
        const r = roads[i];
        const hw = (r.w || 18) / 2 + m;
        const dx = r.vertical ? Math.abs(x - r.x) : Math.max(0, Math.abs(x - r.x) - r.len / 2);
        const dz = r.vertical ? Math.max(0, Math.abs(z - r.z) - r.len / 2) : Math.abs(z - r.z);
        if (dx <= hw && dz <= hw) out.push(r);
      }
      return out;
    }
    // WATER PER THE CALLER'S OWN COASTLINE. Never CBZ.cityWaterAt here: at
    // the moment this runs, waterfield.js is still answering from its
    // boot-time fallback (see the header) and would report open country as
    // sea. ctx.shoreAt IS continent.js's shoreField with no river in it yet.
    const CELL = 80;                                       // the router's grid pitch
    function wet(x, z) { return ctx.shoreAt(x, z) < 0; }

    /* WATER A BOAT CAN ACTUALLY BE IN, which is not the same thing and is the
       distinction this file was missing. waterfield.js's isSurfaceWater()
       tests overDeck() FIRST and answers "not water" anywhere a bridge or
       causeway deck is registered — so a deck does not merely span the water,
       it REPLACES it, and the bay ring is cut wherever one crosses. That rule
       exists so a car on a causeway is not swimming, and it is the same rule
       the audit's flood fill obeys at the far end of this pipe.

       So the head of the river has to be chosen against THIS test, not
       against the raw coastline: the first cut used the bare shore field,
       found the ring continuous, dug from the west face — and the audit
       reported the marina still landlocked, because between the two lay the
       Halloran causeway and the east bridge. Replicated here rather than
       called, because CBZ.cityWaterAt cannot be trusted at this order. */
    function overDeck(x, z, m) {
      m = m == null ? 0.6 : m;                             // 0.6 == waterfield's own margin
      const B = city.bridge;
      if (B && x >= B.minX - m && x <= B.maxX + m && z >= B.minZ - m && z <= B.maxZ + m) return true;
      for (let i = 0; i < regs.length; i++) {
        const r = regs[i];
        if (!isLinkName(r.name)) continue;
        if (r.kind === "circle") { if (Math.hypot(x - r.cx, z - r.cz) <= r.r + (r.pad || 0) + m) return true; }
        else if (x >= r.minX - m && x <= r.maxX + m && z >= r.minZ - m && z <= r.maxZ + m) return true;
      }
      return false;
    }
    function boatWet(x, z) { return wet(x, z) && !overDeck(x, z); }
    /* THE ROUTER'S OWN DECK TEST, and it is DELIBERATELY FATTER than the one
       above. The search grid samples a cell CENTRE every 80 m; the airport
       causeway's deck is 24 m wide. A point test on that grid walks straight
       over it and reports a clear route — which is exactly what happened:
       the first solved river crossed the causeway at (-40, -1180), a single
       dry cell in fifty-two, and the audit's flood fill stopped dead there.
       The margin is the half-channel plus a cell, so a deck cannot hide
       between two samples. */
    function deckBlocks(x, z) { return overDeck(x, z, HALF_MID + CELL); }

    /* ---- THE SEARCH ----------------------------------------------------
       Four sides; down each, a fan of parallel corridors. A corridor is
       walked outward until it reaches water that is NOT the bay ring — that
       is the sea, and the walk's length is the river's length. Rejected
       outright if it would cut a POI; charged 1 point per road it must
       bridge; length is the tiebreak, in kilometres, so a corridor never
       trades a whole extra bridge for two hundred metres.

       COARSE ON PURPOSE (60 m): this is ~90 walks of up to 9 km and the
       winner is re-walked at full resolution. A 60 m stride cannot miss a
       POI — every region in this world is wider than that — and it cannot
       miss a road, because roadsCrossing() is asked with the road's own
       half-width plus a margin at every step.                            */
    /* ---- WHICH PIECE OF THE RING THE MARINA IS ACTUALLY IN ------------
       THE RING IS NOT ONE POND, IT IS SEVERAL. Measured by walking it: the
       County Jail and City Hall sit ON it and hold their land, and the east
       bridge and the Halloran causeway are decks that read as land — so the
       67 m moat is chopped into five separate arcs. A river dug from the
       WEST arc drains the west arc. The marina is on the EAST waterfront
       (city/marina.js searches east from maxX + 26 and always has), so a
       west river leaves the harbour exactly as landlocked as it found it —
       which is what the first cut of this file did, and the audit caught it.

       So the arc is FLOOD FILLED from the east waterfront, and a corridor
       may only start in it. This is the same question the audit asks at the
       other end of the pipe, asked here at build time: not "is there water
       at the head" but "is that water the water the boats are in".        */
    const ARC = new Set(), ARC_STEP = 20;
    (function fillArc() {
      const pad = BAY1 + 80;
      const lo = { x: city.minX - pad, z: city.minZ - pad };
      const hi = { x: city.maxX + pad, z: city.maxZ + pad };
      const key = function (x, z) { return Math.round(x / ARC_STEP) + "," + Math.round(z / ARC_STEP); };
      // seed on the EAST face, the one marina.js builds on
      let seed = null;
      for (let z = city.minZ - BAY1; z <= city.maxZ + BAY1 && !seed; z += 12) {
        for (let d = BAY0 + 4; d <= BAY1 - 4 && !seed; d += 8) {
          if (boatWet(city.maxX + d, z)) seed = { x: city.maxX + d, z: z };
        }
      }
      if (!seed) return;
      // SNAP THE SEED TO THE LATTICE. The fill walks in ARC_STEP hops from
      // wherever it started, so its keys live on the seed's own offset grid —
      // while inArc() keys a corridor head off the world origin. Two lattices
      // one rounding apart never share a cell, so the veto silently passed
      // everything and the river went on draining the wrong arc.
      seed = { x: Math.round(seed.x / ARC_STEP) * ARC_STEP, z: Math.round(seed.z / ARC_STEP) * ARC_STEP };
      const q = [seed]; ARC.add(key(seed.x, seed.z));
      for (let head = 0; head < q.length && q.length < 8000; head++) {
        const p = q[head];
        const nb = [[ARC_STEP, 0], [-ARC_STEP, 0], [0, ARC_STEP], [0, -ARC_STEP]];
        for (let i = 0; i < 4; i++) {
          const nx = p.x + nb[i][0], nz = p.z + nb[i][1];
          if (nx < lo.x || nx > hi.x || nz < lo.z || nz > hi.z) continue;
          const k = key(nx, nz);
          if (ARC.has(k)) continue;
          if (!boatWet(nx, nz)) continue;
          ARC.add(k); q.push({ x: nx, z: nz });
        }
      }
    })();
    function inArc(x, z) {
      if (!ARC.size) return true;                          // no fill: do not veto
      return ARC.has(Math.round(x / ARC_STEP) + "," + Math.round(z / ARC_STEP));
    }

    /* ---- THE ROUTE IS A SEARCH, because a straight line cannot solve this
       map and the diagnostics said so in as many words. Fanning corridors
       off the harbour arc, every bearing was walled: east by the Commerce
       Annex and the Ironjaw Arena, north by the County Jail and Mount Mercy,
       and the other two faces are not the marina's water at all. There is a
       way out — it just is not straight, and a river that cannot bend is not
       a router, it is a ruler.

       So: a weighted grid search from the harbour arc to open sea over the
       whole plate. Blocked cells are POIs (never carved — a river through
       the Defence Headquarters is worse than no river) and DECKS (a bridge
       region reads as land to everything, so a channel cannot pass under
       one in this engine; treating them as walls here is what keeps the
       route honest about the water it produces). Roads are passable but
       PRICED, so the search spends a few hundred metres of detour to save a
       bridge and takes the bridge when it must.

       COST: one blocked/priced pass over ~45k cells is ~100 ms at build,
       and it happens once. The BFS itself is a few milliseconds.          */
    const P = ctx.plate || { minX: city.minX - 8000, maxX: city.maxX + 8000, minZ: city.minZ - 8000, maxZ: city.maxZ + 8000 };
    const GX = Math.max(4, Math.ceil((P.maxX - P.minX) / CELL));
    const GZ = Math.max(4, Math.ceil((P.maxZ - P.minZ) / CELL));
    const N = GX * GZ;
    const cellX = function (i) { return P.minX + (i % GX + 0.5) * CELL; };
    const cellZ = function (i) { return P.minZ + ((i / GX) | 0 + 0) * CELL + CELL * 0.5; };
    const blocked = new Uint8Array(N), priced = new Uint8Array(N), isSea = new Uint8Array(N);
    let seaCells = 0;
    for (let i = 0; i < N; i++) {
      const x = cellX(i), z = cellZ(i);
      if (regionAt(x, z, HALF_MID + 10)) { blocked[i] = 1; continue; }
      // A DECK IS A TOLL, NOT A WALL. It was a wall in the first working
      // version and the search then correctly reported that no route exists:
      // 31 highway "Link" regions criss-cross this country, so every path
      // from the harbour to any coast crosses at least one. Pricing them at
      // forty cells means the river goes a long way out of its way to avoid
      // a bridge and takes one only when the map leaves it no choice — which
      // is also how a real river valley and a real road network negotiate.
      if (deckBlocks(x, z)) priced[i] = 6;
      else if (roadsCrossing(x, z, HALF_MID + 10).length) priced[i] = 1;
      // OPEN SEA: water, and far enough out that the bay ring itself can
      // never be mistaken for the destination.
      const cheb = Math.max(Math.max(city.minX - x, x - city.maxX), Math.max(city.minZ - z, z - city.maxZ));
      if (cheb > BAY1 + 400 && wet(x, z)) { isSea[i] = 1; seaCells++; }
    }
    if (!seaCells) { audit.reason = "no open sea on the plate"; audit.arcCells = ARC.size; return null; }

    // starts: every grid cell the harbour arc touches
    const dist = new Float64Array(N).fill(Infinity);
    const from = new Int32Array(N).fill(-1);
    const heap = [];
    function push(i, d) { dist[i] = d; heap.push([d, i]); }
    let starts = 0;
    ARC.forEach(function (k) {
      const c = k.split(","), ax = +c[0] * ARC_STEP, az = +c[1] * ARC_STEP;
      const gi = Math.floor((ax - P.minX) / CELL), gj = Math.floor((az - P.minZ) / CELL);
      if (gi < 0 || gj < 0 || gi >= GX || gj >= GZ) return;
      const i = gj * GX + gi;
      if (blocked[i] || dist[i] === 0) return;
      push(i, 0); starts++;
    });
    if (!starts) { audit.reason = "harbour arc has no cell on the plate"; audit.arcCells = ARC.size; return null; }

    // Dijkstra with a lazy binary heap — the graph is 45k nodes and 8-way,
    // so an unsorted scan would be O(n^2) and this is O(n log n).
    function siftUp(n) { while (n > 0) { const p = (n - 1) >> 1; if (heap[p][0] <= heap[n][0]) break; const t = heap[p]; heap[p] = heap[n]; heap[n] = t; n = p; } }
    function siftDown(n) { for (;;) { const l = n * 2 + 1, r = l + 1; let m = n; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === n) break; const t = heap[m]; heap[m] = heap[n]; heap[n] = t; n = m; } }
    for (let i = 0; i < heap.length; i++) siftUp(i);
    let goal = -1;
    const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    while (heap.length) {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) { heap[0] = last; siftDown(0); }
      const d = top[0], i = top[1];
      if (d > dist[i]) continue;
      if (isSea[i]) { goal = i; break; }
      const gi = i % GX, gj = (i / GX) | 0;
      for (let k = 0; k < 8; k++) {
        const ni = gi + NB[k][0], nj = gj + NB[k][1];
        if (ni < 0 || nj < 0 || ni >= GX || nj >= GZ) continue;
        const j = nj * GX + ni;
        if (blocked[j]) continue;
        // a road costs six cells of detour: cheap enough that the search will
        // not walk a kilometre around one, dear enough that it prefers the gap
        const nd = d + NB[k][2] + (priced[j] === 6 ? 40 : priced[j] ? 6 : 0);
        if (nd < dist[j]) { dist[j] = nd; from[j] = i; heap.push([nd, j]); siftUp(heap.length - 1); }
      }
    }
    if (goal < 0) { audit.reason = "no navigable route from the harbour to open sea"; audit.arcCells = ARC.size; return null; }

    // ---- unwind, then STRAIGHTEN: a grid path is a staircase, and a river
    // is not. Drop any waypoint whose neighbours can see each other over
    // unblocked ground; what is left are the bends the terrain actually
    // forced. Cheap and deterministic.
    let raw = [];
    for (let i = goal; i >= 0; i = from[i]) raw.push({ x: cellX(i), z: cellZ(i) });
    raw.reverse();
    function clearLine(a, b) {
      const d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(d / 40));
      for (let i = 0; i <= n; i++) {
        const t = i / n, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        if (regionAt(x, z, HALF_MID + 10)) return false;
      }
      return true;
    }
    const knots = [raw[0]];
    for (let i = 1; i < raw.length - 1; i++) {
      if (!clearLine(knots[knots.length - 1], raw[i + 1])) knots.push(raw[i]);
    }
    knots.push(raw[raw.length - 1]);
    // …and push the last knot well past the coast: the sea is already water
    // out there, shoreField takes the minimum, so an overshoot costs nothing
    // while a shortfall leaves the river ending one plate cell short of it.
    {
      const a = knots[knots.length - 2], b = knots[knots.length - 1];
      const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
      knots.push({ x: b.x + dx / L * 400, z: b.z + dz / L * 400 });
    }
    /* ---- THE POLYLINE. The knots are the route; this walks them at a fixed
       spacing and adds the wander that makes a river a river rather than a
       canal. The meander is DECORATION and the route is the DECISION, so a
       wandered point that would enter a POI is pulled back onto the knot line
       rather than allowed through — the search already proved the knot line
       is clear, and nothing downstream may overrule it.                   */
    const pts = [], halves = [];
    // cumulative length along the knots, so `u` is real distance and the
    // taper lands where it is meant to rather than where the knots happen
    // to be dense
    const segLen = [];
    let total = 0;
    for (let i = 0; i + 1 < knots.length; i++) {
      const L = Math.hypot(knots[i + 1].x - knots[i].x, knots[i + 1].z - knots[i].z);
      segLen.push(L); total += L;
    }
    if (!(total > 400)) { audit.reason = "route too short to build"; audit.arcCells = ARC.size; return null; }
    function atDist(d) {
      let acc = 0;
      for (let i = 0; i < segLen.length; i++) {
        if (acc + segLen[i] >= d || i === segLen.length - 1) {
          const t = segLen[i] > 0 ? clamp((d - acc) / segLen[i], 0, 1) : 0;
          const a = knots[i], b = knots[i + 1];
          const dx = (b.x - a.x) / (segLen[i] || 1), dz = (b.z - a.z) / (segLen[i] || 1);
          return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, nx: -dz, nz: dx };
        }
        acc += segLen[i];
      }
      const b = knots[knots.length - 1];
      return { x: b.x, z: b.z, nx: 0, nz: 1 };
    }
    for (let d = 0; d <= total; d += STEP) {
      const u = d / total;
      const base = atDist(d);
      // no wander at either end: the head has to stay in the harbour it
      // drains, and the mouth has to stay pointed at the sea
      const taper = Math.sin(Math.PI * clamp(u * 1.15 - 0.05, 0, 1));
      let off = wobble(d, 17) * MEANDER * taper;
      let x = base.x + base.nx * off, z = base.z + base.nz * off;
      let guard = 0;
      while (regionAt(x, z, HALF_MID + 10) && guard++ < 6) {
        off *= 0.5; x = base.x + base.nx * off; z = base.z + base.nz * off;
      }
      if (regionAt(x, z, HALF_MID + 10)) { x = base.x; z = base.z; }
      pts.push({ x: x, z: z });
      // narrow where it leaves the harbour, widest where it meets the sea
      halves.push(u < 0.08 ? HALF_HEAD + (HALF_MID - HALF_HEAD) * (u / 0.08)
                : u > 0.86 ? HALF_MID + (HALF_MOUTH - HALF_MID) * ((u - 0.86) / 0.14)
                : HALF_MID);
    }
    if (pts.length < 3) { audit.reason = "route too short to build"; audit.arcCells = ARC.size; return null; }

    /* ---- REGISTER IT. One body, one kind, and the kind is new: a POLYLINE.
       Registering 43 separate rects would have worked and would also have
       made continent.js's inlandWaterField — which is called for every plate
       vertex, every ground query, every water test in the game — 43 times
       more expensive. `bbox` rejects the whole country in one test and
       `bucket` narrows the rest to two or three segments. */
    const bbox = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (let i = 0; i < pts.length; i++) {
      const h = halves[i] + 4;
      if (pts[i].x - h < bbox.minX) bbox.minX = pts[i].x - h;
      if (pts[i].x + h > bbox.maxX) bbox.maxX = pts[i].x + h;
      if (pts[i].z - h < bbox.minZ) bbox.minZ = pts[i].z - h;
      if (pts[i].z + h > bbox.maxZ) bbox.maxZ = pts[i].z + h;
    }
    // NAMED FOR WHERE IT GOES, read off the mouth's own bearing from the
    // city rather than off a side the router no longer has an opinion about.
    const mouth = pts[pts.length - 1];
    const bx = mouth.x - (city.minX + city.maxX) / 2, bz = mouth.z - (city.minZ + city.maxZ) / 2;
    const axis = Math.abs(bx) > Math.abs(bz) ? "x" : "z";
    const bearing = axis === "x" ? (bx < 0 ? "west" : "east") : (bz < 0 ? "north" : "south");
    const body = {
      kind: "path", pts: pts, half: halves, axis: axis, bbox: bbox,
      name: "The " + (bearing === "west" ? "Kesh" : bearing === "east" ? "Veridia"
            : bearing === "north" ? "Mercy" : "Solara") + " River",
    };
    if (CBZ.registerCityWaterBody) CBZ.registerCityWaterBody(city, body);

    /* ---- THE CROSSINGS. Re-derived from the FINAL polyline, not carried
       over from the search: the meander moved the channel, so a road the
       straight corridor cleared can be one the river now cuts, and the other
       way about. Every road within the channel gets a link region — which is
       both halves of a bridge (see the header) — and a pier line so it reads
       as one from the water.                                              */
    const bridges = [];
    if (C.CITY_RIVER_BRIDGES !== false) {
      const claimed = new Set();
      for (let i = 0; i < pts.length; i++) {
        const h = halves[i];
        for (const r of roadsCrossing(pts[i].x, pts[i].z, h + 14)) {
          const k = (r.vertical ? "V" : "H") + Math.round(r.x) + "," + Math.round(r.z);
          if (claimed.has(k)) continue;
          /* NEVER BRIDGE THE HARBOUR ITSELF. A link region is land to
             everything that asks, so one laid across the bay ring severs the
             ring — the first cut of this file put "Kesh River Bridge 1" on
             the west face and cut the moat in two, which the ring walk caught
             by name. Inside the ring band the road already crosses water and
             already has whatever deck it was built with; this file does not
             get to add another. */
          const cheb = Math.max(Math.max(city.minX - pts[i].x, pts[i].x - city.maxX),
                                Math.max(city.minZ - pts[i].z, pts[i].z - city.maxZ));
          if (cheb < BAY1 + 40) continue;
          claimed.add(k);
          // the deck spans the channel plus an abutment either side
          const span = h * 2 + 90, deckW = (r.w || 18) + 8;
          const b = {
            road: r, x: r.vertical ? r.x : pts[i].x, z: r.vertical ? pts[i].z : r.z,
            vertical: !!r.vertical, span: span, w: deckW,
          };
          bridges.push(b);
          const reg = {
            // THE NAME IS LOAD-BEARING, twice over: continent.js's
            // isLinkReg() and waterfield.js's overDeck() both test
            // /bridge|causeway|link/ against it. Rename this and the deck
            // starts holding its land (no water under the bridge) AND stops
            // reading as land (cars swim on it).
            name: body.name + " Bridge " + (bridges.length),
            subtitle: "River Crossing", biome: "wilds", kind: "rect", pad: 0,
            minX: b.vertical ? b.x - deckW / 2 : b.x - span / 2,
            maxX: b.vertical ? b.x + deckW / 2 : b.x + span / 2,
            minZ: b.vertical ? b.z - span / 2 : b.z - deckW / 2,
            maxZ: b.vertical ? b.z + span / 2 : b.z + deckW / 2,
          };
          // through the shared registrar, not a raw push: it owns pad
          // defaults, the map-reserve ledger and the collider dirty flag.
          if (CBZ.registerCityRegion) CBZ.registerCityRegion(city, reg); else regs.push(reg);
          b.region = reg;
        }
      }
    }

    river = { pts: pts, half: halves, side: bearing, bridges: bridges,
              length: Math.round(total), body: body, name: body.name };
    audit = { built: true, reason: "", length: river.length, points: pts.length,
              bridges: bridges.length, crossings: bridges.length, side: bearing,
              name: body.name,
              // the marina's arc, in 20 m cells. A ZERO here means the veto
              // that keeps the river on the harbour's own water was inert.
              arcCells: ARC.size, head: [Math.round(pts[0].x), Math.round(pts[0].z)] };

    /* ---- AND THE THING YOU CAN SEE: piers and parapets at each crossing.
       Drawn LAST and drawn cheap — two merged meshes for the whole river —
       because the region above is what makes the bridge work and this is
       only what makes it read. A crossing with no visible structure is a
       road that appears to float over a river, which is the same "geometry
       with nothing holding it up" this repo keeps catching. */
    if (window.THREE && bridges.length && city.root) {
      const THREE = window.THREE;
      const BGU = THREE.BufferGeometryUtils;
      const cmat = CBZ.cmat || function (c) { return new THREE.MeshLambertMaterial({ color: c }); };
      function boxAt(x, y, z, w, hh, d) {
        const g = new THREE.BoxGeometry(w, hh, d); g.translate(x, y, z); return g;
      }
      const piers = [], rails = [];
      for (const b of bridges) {
        const half = b.span / 2, along = b.vertical ? "z" : "x";
        // piers every ~26 m down the span, in pairs across the deck
        for (let t = -half + 13; t <= half - 13; t += 26) {
          for (const s of [-1, 1]) {
            const px2 = b.vertical ? b.x + s * (b.w / 2 - 1.4) : b.x + t;
            const pz2 = b.vertical ? b.z + t : b.z + s * (b.w / 2 - 1.4);
            piers.push(boxAt(px2, -1.2, pz2, 1.6, 3.0, 1.6));
          }
        }
        // a parapet down each edge of the deck
        for (const s of [-1, 1]) {
          const rx = b.vertical ? b.x + s * (b.w / 2) : b.x;
          const rz = b.vertical ? b.z : b.z + s * (b.w / 2);
          rails.push(boxAt(rx, 0.55, rz, b.vertical ? 0.4 : b.span, 0.9, b.vertical ? b.span : 0.4));
          if (CBZ.colliders) {
            CBZ.colliders.push({
              minX: rx - (b.vertical ? 0.25 : b.span / 2), maxX: rx + (b.vertical ? 0.25 : b.span / 2),
              minZ: rz - (b.vertical ? b.span / 2 : 0.25), maxZ: rz + (b.vertical ? b.span / 2 : 0.25),
              y0: 0, y1: 1.0, noCam: true,
            });
          }
        }
      }
      function merge(list, hex, cast) {
        if (!list.length) return;
        const mat = cmat(hex);
        if (BGU && BGU.mergeBufferGeometries) {
          const mesh = new THREE.Mesh(BGU.mergeBufferGeometries(list), mat);
          mesh.castShadow = !!cast; mesh.receiveShadow = true;
          mesh.matrixAutoUpdate = false; mesh.updateMatrix();
          city.root.add(mesh);
          return;
        }
        for (const g of list) { const mm = new THREE.Mesh(g, mat); mm.receiveShadow = true; city.root.add(mm); }
      }
      merge(piers, 0x8b9097, true);
      merge(rails, 0xb4b9bf, false);
    }
    /* ---- AND A REASON TO BE ON IT. 8.7 km of navigable water with nothing
       on its banks is the same "geometry with nobody in it" this repo keeps
       catching — the marina's own header is about exactly that. Three bank
       stations, on alternating sides, at quarter/half/three-quarter of the
       run: city/fishing.js validates each one against the water point it is
       given and REFUSES a station whose water is not water, so a bank that a
       future coastline moves out from under loses its angler rather than
       lying about him. No new loop, no new body — fishSpotRegister is the
       same call the marina quay and the fuel dock already use. */
    if (CBZ.fishSpotRegister && pts.length > 8) {
      const NAMES = ["Upper Reach", "The Oxbow", "River Mouth"];
      [0.25, 0.55, 0.85].forEach(function (u, k) {
        const i = Math.max(1, Math.min(pts.length - 2, Math.round(u * (pts.length - 1))));
        const a = pts[i - 1], b = pts[i + 1];
        const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
        const nx = -dz / L, nz = dx / L;              // bank normal
        const side = k % 2 ? 1 : -1;                  // alternate banks
        const h = halves[i];
        const bx = pts[i].x + nx * side * (h + 2.5), bz = pts[i].z + nz * side * (h + 2.5);
        try {
          CBZ.fishSpotRegister(bx, bz, {
            name: body.name.replace(/^The /, "") + " · " + NAMES[k],
            // face the water, which is back down the bank normal
            face: Math.atan2(-nx * side, -nz * side),
            water: { x: pts[i].x, z: pts[i].z },
          });
        } catch (e) {}
      });
    }

    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    return body;
  };

  /* ============================================================
     THE RATCHET — CBZ.cityRiverAudit()
     ------------------------------------------------------------
     `connected` is the entire feature expressed as a boolean, and it is
     MEASURED on every call, never stored: a flood fill over the LIVE
     CBZ.cityWaterAt from a real registered berth, out until it either
     reaches open sea or runs dry. A river that registers, draws bridges and
     reports a length while the marina is still a pond would pass every other
     number in this file and fail this one.

     The step is 30 m against a channel that is at minimum 80 m across, so
     the fill cannot hop a bank; the cap is what stops a genuinely connected
     river from walking the whole 54,000 u ocean before answering.
     ============================================================ */
  CBZ.cityRiverAudit = function () {
    const out = Object.assign({ connected: false, reach: 0, cells: 0 }, audit);
    const berths = (CBZ.cityBerth && CBZ.cityBerth.list) ? CBZ.cityBerth.list() : [];
    /* THE BOAT'S OWN ORACLE, not the car's. The question this audit exists to
       answer is "can a HULL get from the marina to the sea", and under a
       bridge those two oracles deliberately disagree — cityWaterAt keeps the
       deck dry so cars do not flood, cityNavWaterAt lets the channel through.
       Asking the wrong one here reported the river disconnected while boats
       could in fact run it. */
    const wetAt = CBZ.cityNavWaterAt || CBZ.cityWaterAt;
    if (!berths.length || !wetAt) { out.reason = out.reason || "no berths to test from"; return out; }
    const start = berths[0];
    const STEP2 = 30, CAP = 30000;
    // OPEN SEA = far enough from the city that nothing else could be. The bay
    // ring is 95 u out; a mainland lake would be a lake. 3 km is past every
    // registered POI's own footprint and short enough to answer fast.
    const A = CBZ.city && CBZ.city.arena;
    const cx = A ? (A.minX + A.maxX) / 2 : 0, cz = A ? (A.minZ + A.maxZ) / 2 : 0;
    const OPEN = 3000;
    const seen = new Set(), q = [[Math.round(start.x), Math.round(start.z)]];
    seen.add(q[0][0] + "," + q[0][1]);
    let head = 0, reach = 0;
    while (head < q.length && q.length < CAP) {
      const p = q[head++];
      const d = Math.hypot(p[0] - cx, p[1] - cz);
      if (d > reach) reach = d;
      if (d > OPEN) { out.connected = true; break; }
      const dirs = [[STEP2, 0], [-STEP2, 0], [0, STEP2], [0, -STEP2]];
      for (let i = 0; i < 4; i++) {
        const nx = p[0] + dirs[i][0], nz = p[1] + dirs[i][1], k = nx + "," + nz;
        if (seen.has(k)) continue;
        let ok = false;
        try { ok = !!wetAt(nx, nz); } catch (e) {}
        if (!ok) continue;
        seen.add(k); q.push([nx, nz]);
      }
    }
    out.cells = seen.size;
    out.reach = Math.round(reach);

    /* ---- THE ONE THING A BOAT CAN DO HERE THAT A SWIMMER CANNOT, in
       metres, measured live rather than described. Under a road deck this
       engine answers "not water" to cityWaterAt (so a car on the causeway
       does not flood) while cityNavWaterAt lets the hull through — so on the
       shipping seed there is one 31 m stretch, the width of the road itself,
       where you can drive a boat but not swim.

       IT IS NOT PAPERED OVER, and deliberately. The honest fix is a y-gated
       water test, and the y's are not there to gate on: at that crossing the
       deck sits at grade (0.085) and the sea surface at -0.31, so "standing
       on the bridge" and "swimming under it" are 0.4 m apart — closer than
       the swell moves. A gate that tight is a guess wearing a fix's clothes,
       and the failure mode is a pedestrian on a bridge who starts swimming.
       So it is REPORTED: 31 m of 8675 is a known limit of a y-less water
       oracle, and the number is here for whoever gets to fix that properly. */
    if (river && CBZ.cityWaterAt && CBZ.cityNavWaterAt) {
      let blocked = 0;
      const p = river.pts;
      for (let i = 0; i + 1 < p.length; i++) {
        const L = Math.hypot(p[i + 1].x - p[i].x, p[i + 1].z - p[i].z);
        const n = Math.max(1, Math.ceil(L / 8));
        for (let k = 0; k < n; k++) {
          const t = k / n, x = p[i].x + (p[i + 1].x - p[i].x) * t, z = p[i].z + (p[i + 1].z - p[i].z) * t;
          if (!CBZ.cityWaterAt(x, z) && CBZ.cityNavWaterAt(x, z)) blocked += L / n;
        }
      }
      out.swimBlocked = Math.round(blocked);
    }
    if (!out.connected && !out.reason) out.reason = "flood fill from berth '" + start.id + "' stopped at " + out.reach + " m";
    return out;
  };

  /* ---- CBZ.cityChannelAt(x, z) — "is this point inside the river?"
     THE ONE THING waterfield.js ASKS THIS FILE, and the reason it has to.
     isSurfaceWater() answers "not water" over any bridge or causeway deck,
     because with no y in the question a deck is the best proxy it has for
     "whoever is asking is probably standing on it". That proxy is wrong in
     exactly one place: under a bridge, where the whole point of the bridge
     is that water passes beneath it. With 31 highway link regions across
     this country there is no route from the harbour to any coast that does
     not cross one, so without this the river cannot exist — the router said
     so in as many words before decks were re-priced from walls to tolls.

     Deliberately NARROW: it is true only inside this river's own channel, so
     every other deck in the world keeps the old behaviour exactly. */
  CBZ.cityChannelAt = function (x, z) {
    if (!river) return false;
    const p = river.pts, h = river.half;
    const bb = river.body && river.body.bbox;
    if (bb && (x < bb.minX || x > bb.maxX || z < bb.minZ || z > bb.maxZ)) return false;
    for (let i = 0; i + 1 < p.length; i++) {
      const ax = p[i].x, az = p[i].z, vx = p[i + 1].x - ax, vz = p[i + 1].z - az;
      const L2 = vx * vx + vz * vz;
      let t = L2 > 0 ? ((x - ax) * vx + (z - az) * vz) / L2 : 0;
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      const dx = x - (ax + vx * t), dz = z - (az + vz * t);
      const half = h[i] + (h[i + 1] - h[i]) * t;
      if (dx * dx + dz * dz <= half * half) return true;
    }
    return false;
  };

  CBZ.cityRiver = {
    exists: function () { return !!river; },
    path: function () { return river ? river.pts.slice() : []; },
    name: function () { return river ? river.name : null; },
    bridges: function () { return river ? river.bridges.slice() : []; },
    info: function () { return river; },
  };
})();
