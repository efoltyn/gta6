/* ============================================================
   world/corridors.js — THE CORRIDORS. A prison is a building you walk
   through, not a yard you cross.

   OWNER (2026-09-05): "add a massive amount of hallways like a real jail …
   make escaping much cooler … alternate escape routes … I don't want too
   many keys." docs/plan/prison-corridors.md has the research; the short
   version: a real campus prison moves everyone along a main corridor cut
   into sections by cross-corridor steel doors (they were barred sliding
   grilles until 2026-09-29), with an interlock (two doors, one at a time) wherever a section meets a secure zone; keys are ONE
   issued ring per post, and the perimeter is a restricted set.

   WHAT THIS LAYS DOWN — about 640 m of enclosed corridor, 4.5 m wide,
   block-lined, polished, lit 24 h, roofed:
     THE SPINE   a U around the old compound: west leg x=-40 (north half)
                 jogging to x=-50 (south half), north leg z=-72, east leg
                 x=40 jogging to x=50. Its two south ends run into two new
                 perimeter sally ports at (±50, 128).
     THE WINGS   industries (z=22), the powerhouse (z=79), the recreation
                 yard (x=-48), segregation (z=21.5), the kitchen (z=78),
                 visitation (z=115), central control (a stub at x=0), and
                 the two lower yard gates (z=84).
     THE DOORS   twenty-odd corridor doors: an INTERLOCK behind each of the
                 four yard sally gates (card, then door), one at every wing
                 mouth, one every ~35 m along the spine. Every one of them
                 takes the CORRIDOR KEY — one ring, on the four movement
                 officers walking the spine (entities/guards.js) and on the
                 board in central control — or 5 lb of C4.
   The escape now reads: yard → card → interlock → corridor key → a long
   walk with officers in it → gate key → out, through any of three ports.
   Or the crawls, the culvert, the roof, a charge.

   Every authored coordinate holds: rooms, doors, yard gates, routes.
   Verified by flood fill (tools/visual-presets/prison-corridors.mjs): with
   card + corridor key + gate key every port's win point is reachable from
   the north yard; without the corridor key none of the spine is.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !CBZ.prisonKit || !CBZ.corridorKit || !CBZ.buildSallyPort || !CBZ.addBox) return;
  const K = CBZ.prisonKit, CK = CBZ.corridorKit;
  const { addBox } = CBZ;
  const W = CBZ.WORLD;
  const EZ = W.exit.z;                                    // the south wall line, 128
  const stat = K.stat;

  const HW = 2.25, T = 0.5, CH = 3.6, TOP = 4.2;
  const WALL = 0x9aa3ad;
  const KEY = ["Corridor Key"];

  /* ==========================================================
     1. THE SEGMENTS. axis "z": runs along z at x = fixed; axis "x": along
        x at z = fixed. a0..a1 is the interior extent. open0/open1: that end
        is a doorway into something else (a room, a gate, another corridor)
        and gets no cap. Order matters: an earlier segment owns the floor
        and roof where two overlap.
     ========================================================== */
  const SEG = [
    { id: "spine-w-n", axis: "z", fixed: -40, a0: -74.25, a1: 46.25, open0: false, open1: false, exit: 1 },
    { id: "spine-n", axis: "x", fixed: -72, a0: -42.25, a1: 44.0, open0: false, open1: true, exit: 0 },
    { id: "spine-e-n", axis: "z", fixed: 40, a0: -74.25, a1: 46.25, open0: false, open1: false, exit: 1 },
    { id: "spine-w-jog", axis: "x", fixed: 44, a0: -52.25, a1: -37.75, open0: false, open1: false, exit: -1 },
    { id: "spine-e-jog", axis: "x", fixed: 44, a0: 37.75, a1: 52.25, open0: false, open1: false, exit: 1 },
    { id: "spine-w-s", axis: "z", fixed: -50, a0: 41.75, a1: EZ - 7.1, open0: false, open1: true, exit: 1 },
    { id: "spine-e-s", axis: "z", fixed: 50, a0: 41.75, a1: EZ - 7.1, open0: false, open1: true, exit: 1 },
    { id: "wing-industries", axis: "x", fixed: 22, a0: -66.2, a1: -30.5, open0: true, open1: true, exit: 1 },
    { id: "wing-rec", axis: "z", fixed: -48, a0: -12.0, a1: 24.25, open0: true, open1: false, exit: 1 },
    { id: "wing-power", axis: "x", fixed: 79, a0: -84.2, a1: -47.75, open0: true, open1: true, exit: 1 },
    { id: "wing-gate-w", axis: "x", fixed: 84, a0: -52.25, a1: -43.5, open0: true, open1: true, exit: -1 },
    { id: "wing-seg", axis: "x", fixed: 21.5, a0: 30.5, a1: 57.8, open0: true, open1: true, exit: -1 },
    { id: "wing-kitchen", axis: "x", fixed: 78, a0: 47.75, a1: 57.8, open0: true, open1: true, exit: -1 },
    { id: "wing-gate-e", axis: "x", fixed: 84, a0: 43.5, a1: 52.25, open0: true, open1: true, exit: 1 },
    { id: "wing-visits", axis: "x", fixed: 115, a0: 47.75, a1: 62.2, open0: true, open1: true, exit: -1 },
    { id: "stub-control", axis: "z", fixed: 0, a0: -78.25, a1: -69.75, open0: true, open1: false, exit: 1 },
    { id: "stub-unit-b", axis: "z", fixed: -35.5, a0: -76.9, a1: -69.75, open0: true, open1: false, exit: 1 },
  ];
  const rectOf = (s) => s.axis === "z"
    ? { x0: s.fixed - HW, x1: s.fixed + HW, z0: s.a0, z1: s.a1 }
    : { x0: s.a0, x1: s.a1, z0: s.fixed - HW, z1: s.fixed + HW };
  for (const s of SEG) s.r = rectOf(s);

  // intervals [from,to] of the edge line `fixed` on `axis` (the other rects'
  // projections) where another corridor opens into this one
  function gapsOn(me, side) {
    // side: "N" (z = r.z0), "S" (z = r.z1), "W" (x = r.x0), "E" (x = r.x1)
    const r = me.r, out = [];
    for (const o of SEG) {
      if (o === me) continue;
      const q = o.r;
      let iv = null;
      if (side === "N" && q.z0 < r.z0 - 0.01 && q.z1 >= r.z0 - 0.01) iv = [Math.max(r.x0, q.x0), Math.min(r.x1, q.x1)];
      if (side === "S" && q.z1 > r.z1 + 0.01 && q.z0 <= r.z1 + 0.01) iv = [Math.max(r.x0, q.x0), Math.min(r.x1, q.x1)];
      if (side === "W" && q.x0 < r.x0 - 0.01 && q.x1 >= r.x0 - 0.01) iv = [Math.max(r.z0, q.z0), Math.min(r.z1, q.z1)];
      if (side === "E" && q.x1 > r.x1 + 0.01 && q.x0 <= r.x1 + 0.01) iv = [Math.max(r.z0, q.z0), Math.min(r.z1, q.z1)];
      if (iv && iv[1] - iv[0] > 0.05) out.push(iv);
    }
    out.sort((a, b) => a[0] - b[0]);
    return out;
  }
  function runs(from, to, gaps) {
    const out = []; let cur = from;
    for (const g of gaps) { if (g[0] > cur + 0.05) out.push([cur, g[0]]); cur = Math.max(cur, g[1]); }
    if (to > cur + 0.05) out.push([cur, to]);
    return out;
  }
  // floor/roof pieces: my extent minus what earlier segments already cover
  function pieces(me) {
    const i = SEG.indexOf(me), r = me.r;
    let list = [[me.a0, me.a1]];
    for (let j = 0; j < i; j++) {
      const q = SEG[j].r;
      if (q.x1 <= r.x0 || q.x0 >= r.x1 || q.z1 <= r.z0 || q.z0 >= r.z1) continue;
      const cut = me.axis === "z" ? [Math.max(r.z0, q.z0), Math.min(r.z1, q.z1)] : [Math.max(r.x0, q.x0), Math.min(r.x1, q.x1)];
      const next = [];
      for (const p of list) {
        if (cut[1] <= p[0] || cut[0] >= p[1]) { next.push(p); continue; }
        if (cut[0] > p[0] + 0.05) next.push([p[0], cut[0]]);
        if (cut[1] < p[1] - 0.05) next.push([cut[1], p[1]]);
      }
      list = next;
    }
    return list;
  }

  /* ==========================================================
     2. THE BUILD. Walls with their linings and parapets, floors, ceilings,
        roofs, strips, the night rig's regions.
     ========================================================== */
  let corridorM = 0, wallRuns = 0;
  function wallBox(x, z, w, d) {
    const m = addBox(x, TOP / 2, z, w, TOP, d, WALL, { solid: true, blockLOS: true });
    K.skinBox(m, "panel", WALL);
    // the parapet on top, and the block lining on the inside face (the caller
    // says which face is inside through the `inner` it passes)
    // (it was a flat-grey 0.36 m box buried in the roof slab, 6 cm of it
    //  showing: a lip, not a parapet. Now it stands 0.45 m clear of the
    //  roof in the same poured concrete as the coping on the yard walls.)
    const para = addBox(x, TOP + 0.375, z, w, 0.75, d, 0x8f959c, { cast: false });
    K.skinBox(para, "concrete", 0x9ea3a8);
    wallRuns++;
    return m;
  }
  function build(s) {
    const r = s.r;
    corridorM += s.a1 - s.a0;
    // side walls (the two long ones) and end caps
    const sides = s.axis === "z" ? ["W", "E"] : ["N", "S"];
    const ends = s.axis === "z" ? ["N", "S"] : ["W", "E"];
    for (const side of sides.concat(ends)) {
      const isEnd = ends.indexOf(side) >= 0;
      if (isEnd && ((side === ends[0] && s.open0) || (side === ends[1] && s.open1))) continue;
      const horiz = side === "N" || side === "S";
      const from = horiz ? r.x0 : r.z0, to = horiz ? r.x1 : r.z1;
      const line = side === "N" ? r.z0 : side === "S" ? r.z1 : side === "W" ? r.x0 : r.x1;
      const out = side === "N" || side === "W" ? -1 : 1;              // which way is outside
      for (const run of runs(from, to, gapsOn(s, side))) {
        const a = run[0] - T / 2, b = run[1] + T / 2, mid = (a + b) / 2;
        if (horiz) wallBox(mid, line + out * T / 2, b - a, T);
        else wallBox(line + out * T / 2, mid, T, b - a);
        // lining on the inside face
        const li = 0.06;
        if (horiz) CK.lining(run[0], run[1], line - out * li, line, CH);
        else CK.lining(line - out * li, line, run[0], run[1], CH);
      }
    }
    // floor, ceiling, roof, strips — per piece this segment owns
    const idx = SEG.indexOf(s);
    for (const p of pieces(s)) {
      const x0 = s.axis === "z" ? r.x0 : p[0], x1 = s.axis === "z" ? r.x1 : p[1];
      const z0 = s.axis === "z" ? p[0] : r.z0, z1 = s.axis === "z" ? p[1] : r.z1;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
      stat(new THREE.BoxGeometry(w, 0.06, d), K.skin("polished", 0x9a9fa6), cx, 0.03, cz, { uv: 2, cast: false });
      K.skinBox(addBox(cx, CH + 0.08, cz, w, 0.16, d, 0xdedbd2, { cast: false }), "concrete", 0xdedbd2);
      const rw = s.axis === "z" ? w + 2 * T : w, rd = s.axis === "z" ? d : d + 2 * T;
      const roof = addBox(cx, TOP + 0.15 - idx * 0.004, cz, rw, 0.3, rd, 0x59616b, { cast: true });
      K.skinBox(roof, "concrete", 0x6b7079);
      const len = s.axis === "z" ? d : w;
      const n = Math.max(1, Math.round(len / 6));
      for (let i = 0; i < n; i++) {
        const t = p[0] + ((i + 0.5) * len) / n;
        if (s.axis === "z") CK.strip(s.fixed, CH - 0.02, t, 3.2, "z");
        else CK.strip(t, CH - 0.02, s.fixed, 3.2, "x");
      }
    }
    CBZ.onUpdate(21.39, (function () { let done = false; return function () {
      if (done || !CBZ.prisonLights || !CBZ.prisonLights.rooms) return; done = true;
      CBZ.prisonLights.rooms.push({ id: "corridor-" + s.id, x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1 });
    }; })());
  }
  for (const s of SEG) build(s);

  /* ==========================================================
     3. THE CORRIDOR DOORS. `at` is the door plane along the segment's axis;
        the EXIT sign hangs on the approach side, reading toward the exit
        the segment's `exit` points at. Each was a barred slider on a motor
        (owner, 2026-09-29: "every jail just has many, many sets of those
        real doors"): now a block partition wall to wall with a steel pair
        in it on the Corridor Key, swinging the way out (egress side).
     ========================================================== */
  const GRILLES = [
    ["spine-w-n", -45], ["spine-w-n", -8], ["spine-w-n", 32],
    ["spine-e-n", -45], ["spine-e-n", -8], ["spine-e-n", 32],
    ["spine-n", -25], ["spine-n", 20],
    ["spine-w-s", 62], ["spine-w-s", 100],
    ["spine-e-s", 62], ["spine-e-s", 100],
    ["wing-industries", -35.5], ["wing-industries", -60],       // the west interlock, the shop mouth
    ["wing-seg", 35.5], ["wing-seg", 52.5],                     // the east interlock, the unit mouth
    ["wing-gate-w", -46.2], ["wing-gate-e", 46.2],              // the lower interlocks
    ["wing-power", -78], ["wing-kitchen", 55], ["wing-visits", 57],
    ["wing-rec", 0],
  ];
  let grilles = 0;
  const byId = {}; for (const s of SEG) byId[s.id] = s;
  for (const g of GRILLES) {
    const s = byId[g[0]], r = s.r, at = g[1];
    const along = s.axis === "z";
    const ex = s.exit || 1;
    CK.crossDoor({
      id: "corridor-" + s.id + "-" + Math.round(at), label: "A corridor door",
      axis: along ? "x" : "z", a0: along ? r.x0 : r.z0, a1: along ? r.x1 : r.z1,
      fixed: at, t: 0.3, top: CH, head: 2.45, clear: 2.2, keys: KEY, lb: 5,
      swing: along ? -ex : ex, bands: true, staffR: 3.2, autoShut: 5,
    });
    grilles++;
    // the sign: 1.2 m on the approach side, facing the man who walks toward the exit
    const dir = s.exit || 1;
    if (along) CK.exitSign(s.fixed + 1.4, 3.22, at - dir * 1.2, dir > 0 ? Math.PI : 0);
    else CK.exitSign(at - dir * 1.2, 3.22, s.fixed + 1.4, dir > 0 ? Math.PI / 2 : -Math.PI / 2);
  }

  /* ==========================================================
     4. THE THREE PORTS, and the key board in central control.
     ========================================================== */
  const main = CBZ.buildSallyPort({ id: "prison-exit", x: 0, z: EZ, dir: 1, label: "GATE 3", walkway: 8, booth: "E", signal: true });
  CBZ.EXIT = new THREE.Vector3(main.win.x, 0, main.win.z);
  CBZ.buildSallyPort({ id: "prison-exit-w", x: -50, z: EZ, dir: 1, label: "GATE 1", walkway: 0, booth: "W", altExit: true });
  CBZ.buildSallyPort({ id: "prison-exit-e", x: 50, z: EZ, dir: 1, label: "GATE 4", walkway: 0, booth: "E", altExit: true });
  // the emergency ring in control: on a board by the relay cabinets
  addBox(20.5, 1.55, -107.55, 0.9, 0.7, 0.06, 0x6a563c, { cast: false });
  for (let i = 0; i < 6; i++) addBox(20.5 - 0.32 + i * 0.13, 1.72 - (i % 2) * 0.22, -107.5, 0.02, 0.05, 0.02, 0x8b95a1, { cast: false });
  if (CBZ.prisonPlaceItem) { try { CBZ.prisonPlaceItem("Corridor Key", 20.6, 1.42, -107.45); } catch (e) {} }
  // the service yard's gate off the north spine's east end
  if (CBZ.prisonFence) CBZ.prisonFence({ x0: 44, z0: -109.5, x1: 44, z1: -14, h: 4.2, gates: [{ at: -72 + 109.5, w: 4.6, open: true, side: 1 }] });

  /* ==========================================================
     5. HOUSING UNIT B. The population of this prison is what it can sleep
        (world/cellblock.js prisonBeds -> entities/ambientstate.js), and the
        wing's 72 beds were full: every body the map had was in the old
        compound, and the ring had none. A second housing unit off the north
        spine — 24 double bunks, 48 beds — is the honest way to have men in
        the corridors and the ring's rooms: the ambient crowd derives from
        the new capacity and its zones are the ring's rooms.
     ========================================================== */
  const UB = { x0: -44, x1: -27, z0: -108, z1: -76.5, h: 5.2 };
  // published so systems/prisonrest.js can roster Unit B's racks as a POCKET:
  // offered only to men already inside it (they spawn there, entities/npc.js),
  // never to a man in the yard with corridor doors between him and them
  CBZ.prisonUnitB = UB;
  CBZ.roomShell({ x0: UB.x0, x1: UB.x1, z0: UB.z0, z1: UB.z1, h: UB.h, wall: WALL, floor: null, skin: "panel",
    doors: [{ side: "S", center: -35.5, width: 3.0 }] });
  // a sealed concrete floor at real joint scale (it was one flat grey slab)
  if (CBZ.prisonDress && CBZ.prisonDress.floor) CBZ.prisonDress.floor(UB.x0, UB.x1, UB.z0, UB.z1, "slab", 0x8e9296);
  else addBox((UB.x0 + UB.x1) / 2, 0.02, (UB.z0 + UB.z1) / 2, UB.x1 - UB.x0, 0.08, UB.z1 - UB.z0, 0x6a6f78, { cast: false });
  addBox(-35.5, (3.0 + UB.h) / 2, UB.z1, 3.0, UB.h - 3.0, 0.5, WALL, { cast: false });
  // the unit's door (the opening was a bare 3 m hole): a framed pair of
  // steel leaves hooked back inside the unit, clear of the bunk rows
  // (a working door: E shuts it, anybody walking up opens it)
  if (CK.door) CK.door({ id: "prison-unit-b-door", label: "Unit B", axis: "x", a0: -37.0, a1: -34.0, fixed: UB.z1, t: 0.5, h: 3.0, y0: 0.06,
    swing: 1, hinge: 0, max: 1.0, keys: null, startOpen: true, autoShut: Infinity, build: CK.steelLeaf(0x4f5d6b) });
  if (CBZ.prisonRoof) CBZ.prisonRoof({ id: "unit-b", x0: UB.x0, x1: UB.x1, z0: UB.z0, z1: UB.z1, top: UB.h, over: 0.25, cast: true });
  CK.lining(UB.x0 + 0.25, UB.x0 + 0.31, UB.z0 + 0.25, UB.z1 - 0.25, 3.6);
  CK.lining(UB.x1 - 0.31, UB.x1 - 0.25, UB.z0 + 0.25, UB.z1 - 0.25, 3.6);
  CK.lining(UB.x0 + 0.25, UB.x1 - 0.25, UB.z0 + 0.25, UB.z0 + 0.31, 3.6);
  // the door wall too, either side of the opening (it was the one bare wall)
  CK.lining(UB.x0 + 0.25, -37.0, UB.z1 - 0.31, UB.z1 - 0.25, 3.6);
  CK.lining(-34.0, UB.x1 - 0.25, UB.z1 - 0.31, UB.z1 - 0.25, 3.6);
  let unitBeds = 0;
  if (CBZ.prisonBunk) {
    for (let i = 0; i < 12; i++) {
      const z = UB.z0 + 3.2 + i * 2.35;
      for (const side of [-1, 1]) {
        const x = side < 0 ? UB.x0 + 1.4 : UB.x1 - 1.4;
        try { CBZ.prisonBunk({ id: "unit-b-" + (side < 0 ? "w" : "e") + "-" + i, x: x, z: z, along: "x", double: true, blanket: 0x4a5b46, unit: "B" }); unitBeds += 2; } catch (e) {}
      }
    }
  }
  // the strips hang on rods from the roof slab (they floated 0.42 m under it)
  const rod = K.skin("galv", 0xb4bcc4);
  for (let i = 0; i < 5; i++) {
    const sz = UB.z0 + 4 + i * 6;
    CK.strip(-35.5, UB.h - 0.42, sz, 3.6, "x");
    for (const e of [-1.4, 1.4]) stat(new THREE.CylinderGeometry(0.012, 0.012, 0.38, 6), rod, -35.5 + e, UB.h - 0.19, sz, { cast: false });
  }
  /* the dayroom tables: a bolted steel table on two pedestals and foot
     plates, four fixed stools on arms a side, each a declared seat. They were
     two table TOPS floating at 0.74 m with nothing under them. */
  const frameM = K.skin("steel", 0x4f5760), stoolM = K.skin("steel", 0x5a6f86);
  for (const z of [-96, -88]) {
    const t = addBox(-35.5, 0.74, z, 2.4, 0.06, 1.0, 0x8a939d, { solid: true, y0: 0, y1: 0.95 }); K.skinBox(t, "steel", 0x8a939d);
    stat(new THREE.BoxGeometry(2.1, 0.05, 0.1), frameM, -35.5, 0.4, z, { cast: false });              // the spine
    for (const e of [-0.85, 0.85]) {
      stat(new THREE.BoxGeometry(0.1, 0.68, 0.1), frameM, -35.5 + e, 0.37, z, { cast: false });        // pedestal
      stat(new THREE.BoxGeometry(0.14, 0.03, 0.8), frameM, -35.5 + e, 0.015, z, { cast: false });      // foot plate
    }
    for (const side of [-1, 1]) {
      const sz = z + side * 0.72;
      for (let k = 0; k < 4; k++) {
        const sx = -35.5 + (k - 1.5) * 0.6;
        stat(new THREE.BoxGeometry(0.05, 0.05, 0.72), frameM, sx, 0.4, z + side * 0.36, { cast: false });   // arm
        stat(new THREE.CylinderGeometry(0.025, 0.025, 0.07, 8), frameM, sx, 0.43, sz, { cast: false });     // post
        stat(new THREE.CylinderGeometry(0.18, 0.17, 0.045, 14), stoolM, sx, 0.468, sz, { cast: false });    // seat
        if (CBZ.roomSeatAnchor) { try { CBZ.roomSeatAnchor(sx, 0, sz, side < 0 ? 0 : Math.PI, "stool", null, { cushion: 0.49, floorBelow: 0 }); } catch (e) {} }
      }
      CBZ.colliders.push({ minX: -35.5 - 1.1, maxX: -35.5 + 1.1, minZ: sz - 0.18, maxZ: sz + 0.18, y0: 0, y1: 0.55 });
    }
  }
  if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  CK.exitSign(-35.5, 3.1, UB.z1 - 0.3, Math.PI);
  K.sign("HOUSING UNIT B", -35.5, 3.9, UB.z1 + 0.28, 2.6, 0.5, 0, "#e8edf2", "#202833");
  CBZ.onUpdate(21.4, (function () { let done = false; return function () {
    if (done || !CBZ.prisonLights || !CBZ.prisonLights.rooms) return; done = true;
    CBZ.prisonLights.rooms.push({ id: "unit-b", x0: UB.x0, x1: UB.x1, z0: UB.z0, z1: UB.z1 });
  }; })());
  K.program("unit-b", UB.x0, UB.x1, UB.z0, UB.z1);

  for (const s of SEG) K.program("corridor-" + s.id, s.r.x0, s.r.x1, s.r.z0, s.r.z1);
  CBZ.prisonCorridorAudit = function () {
    const specs = CBZ._prisonDoorSpecs || [];
    return {
      segments: SEG.length, corridorM: Math.round(corridorM), grilles: grilles, wallRuns: wallRuns,
      doors: specs.length, ports: 1 + ((CBZ.altExitZones || []).filter((z) => !z.test).length), unitBeds: unitBeds,
      ladders: (CBZ.prisonTowers || []).filter((t) => t.ladder || t.foot).length,
      segmentsList: SEG.map((s) => ({ id: s.id, r: s.r })),
    };
  };
})();
