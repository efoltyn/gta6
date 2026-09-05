/* ============================================================
   world/prisongrounds.js — THE RING GETS A PROGRAMME.

   OWNER (2026-09-04): "half the jail is empty and dumb waste of space."

   Measured on HEAD: the 2026-08-11 enlargement is 248 x 244 m of wire
   around a 92 x 195 m prison. Six rooms stand in the difference and the
   rest — about 30,000 m² — is one concrete slab with nothing on it and
   nobody in it (0 guard routes, 0 roster positions, 0 spawn zones outside
   the old compound; the 2026-08-13 flood-fill found 78% of the walkable
   ground sealed and unpopulated).

   A real compound's open ground is not empty. Reading a medium-security
   plan, the ground between the buildings and the wall is:
     · a STERILE ZONE — an inner fence, a patrol road, the wall. Nobody
       but the perimeter patrol is in it, and it is lit by masts.
     · fenced WALKWAYS between the gates and the doors — inmates move
       between buildings inside chain-link, not across open ground.
     · a RECREATION YARD — a track, courts, bleachers, a weight pit, a
       handball wall, all inside its own fence.
     · a SERVICE YARD — the vehicle sally port in the wall, a warehouse
       with a loading dock, a fuel island, parked vans, the dumpsters.
     · the UTILITIES — a water tower, tanks, a transformer yard by the
       powerhouse, each behind its own fence with its own warning plate.
     · segregation's OUTDOOR CAGES along the unit's back wall.
   That is what this file lays down, with world/prisonkit.js's fences,
   masts, ground and textures. Every rect is claimed as a `program` so
   CBZ.prisonExteriorAudit() can say what fraction of the ring still has
   no use (the number the complaint is).

   NOTHING AUTHORED MOVES, NOTHING SEALS. The old compound's coordinates,
   routes and anchors are untouched. The four sally gates still open the
   ring; the walkways start at those gates and end at the six doors, so
   every lock prisonwings.js hangs is exactly as reachable as it was — the
   open ground BETWEEN the walkways is what the fences take away, and
   nothing has ever been placed there. The vehicle gate is two solid,
   noBreach, LOS-blocking leaves in a gap the north wall now leaves for
   it: it is drawn as a gate and behaves as the wall.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !CBZ.prisonKit || !CBZ.WORLD || !CBZ.addBox) return;
  const K = CBZ.prisonKit;
  const { addBox } = CBZ;
  const ROOT = CBZ.prisonRoot || CBZ.scene;
  const W = CBZ.WORLD;
  const OUT = W.wings || { x0: -124, x1: 124, z0: -116, z1: 128 };
  const N = W.northYard, S = W.southBlock;
  const VG = CBZ.prisonVehicleGate || { x0: 92, x1: 112, z: OUT.z0 };
  const fence = K.fence, ground = K.ground, paint = K.paint, stat = K.stat, mast = K.floodMast;
  const galv = K.skin("galv", 0xb4bcc4), concrete = K.skin("concrete", 0xa9adb1), steelDark = K.skin("steel", 0x3a4048);
  const steelWhite = K.skin("steel", 0xe6e7e3), steelGreen = K.skin("steel", 0x3f5a46), glass = K.skin("glass");
  const corrugated = K.skin("corrugated", 0x9aa1a8), roller = K.skin("roller", 0x8d949c), panel = K.skin("panel", 0xb2b9c1);

  // a rect fence: four runs; gates given per side as {side, at (absolute x or z), w, open, sign}
  function ring(x0, z0, x1, z1, o) {
    o = o || {};
    const gatesFor = (side, from) => (o.gates || []).filter((q) => q.side === side).map((q) => ({
      at: Math.abs(q.at - from), w: q.w || 4, open: !!q.open, sign: q.sign, side: q.swing || 1,
    }));
    fence({ x0: x0, z0: z0, x1: x1, z1: z0, h: o.h, razor: o.razor, gates: gatesFor("N", x0) });   // north (z0), runs +x
    fence({ x0: x1, z0: z0, x1: x1, z1: z1, h: o.h, razor: o.razor, gates: gatesFor("E", z0) });   // east (x1), runs +z
    fence({ x0: x1, z0: z1, x1: x0, z1: z1, h: o.h, razor: o.razor, gates: gatesFor("S", x1) });   // south (z1), runs -x
    fence({ x0: x0, z0: z1, x1: x0, z1: z0, h: o.h, razor: o.razor, gates: gatesFor("W", z1) });   // west (x0), runs -z
  }
  // a fenced corridor between two points, axis-aligned, `w` wide; gaps are
  // {at (absolute coordinate along the run), w, side: "L"|"R"} openings in
  // one of its two fences
  function walkway(id, ax, fixed, a, b, w, o) {
    o = o || {};
    const lo = Math.min(a, b), hi = Math.max(a, b);
    for (const side of [-1, 1]) {
      const f = fixed + side * w / 2;
      const gates = (o.gaps || []).filter((q) => (q.side < 0) === (side < 0)).map((q) => ({ at: q.at - lo, w: q.w, open: true, side: 1 }));
      if (ax === "x") fence({ x0: lo, z0: f, x1: hi, z1: f, h: 3.6, razor: o.razor !== false, gates: gates });
      else fence({ x0: f, z0: lo, x1: f, z1: hi, h: 3.6, razor: o.razor !== false, gates: gates });
    }
    const cx = ax === "x" ? (lo + hi) / 2 : fixed, cz = ax === "x" ? fixed : (lo + hi) / 2;
    ground(cx, cz, ax === "x" ? hi - lo : w - 0.4, ax === "x" ? w - 0.4 : hi - lo, "concrete", { program: id, y: 0.02, a: "#666d76", b: "#5d646d" });
  }

  /* ==========================================================
     1. THE STERILE ZONE. Inner fence 6.5 m inside the wall, a patrol road
        between, floodlight masts on the road, the perimeter patrol
        (entities/guards.js) walking it.
     ========================================================== */
  const FX = OUT.x1 - 6.5, FZN = OUT.z0 + 6.5, FZS = OUT.z1 - 6.5;   // fence lines
  const RW = 6.0;                                                     // road width
  ground(-(OUT.x1 - 0.5 - RW / 2), (OUT.z0 + OUT.z1) / 2, RW, OUT.z1 - OUT.z0 - 1, "asphalt", { program: "patrol-road-w" });
  ground((OUT.x1 - 0.5 - RW / 2), (OUT.z0 + OUT.z1) / 2, RW, OUT.z1 - OUT.z0 - 1, "asphalt", { program: "patrol-road-e" });
  ground(0, OUT.z0 + 0.5 + RW / 2, OUT.x1 - OUT.x0 - 1, RW, "asphalt", { program: "patrol-road-n" });
  ground((OUT.x0 + S.x0) / 2, OUT.z1 - 0.5 - RW / 2, S.x0 - OUT.x0 - 1, RW, "asphalt", { program: "patrol-road-sw" });
  ground((S.x1 + OUT.x1) / 2, OUT.z1 - 0.5 - RW / 2, OUT.x1 - S.x1 - 1, RW, "asphalt", { program: "patrol-road-se" });
  // the road's edge line
  for (const s of [-1, 1]) paint(s * (FX + 0.25), (OUT.z0 + OUT.z1) / 2, 0.12, OUT.z1 - OUT.z0 - 14, 0xd8d2b8);
  const SZ_SIGN = "OUT OF BOUNDS";
  fence({ x0: -FX, z0: FZN, x1: -FX, z1: FZS, h: 4.2, gates: [{ at: 50 - FZN, w: 4, open: false, sign: SZ_SIGN }] });
  fence({ x0: FX, z0: FZN, x1: FX, z1: FZS, h: 4.2, gates: [{ at: 50 - FZN, w: 4, open: false, sign: SZ_SIGN }] });
  fence({ x0: -FX, z0: FZN, x1: VG.x0 - 2, z1: FZN, h: 4.2, gates: [{ at: -40 + FX, w: 4, open: false, sign: SZ_SIGN }] });
  fence({ x0: VG.x1 + 2, z0: FZN, x1: FX, z1: FZN, h: 4.2 });
  // the south runs stop at the two spine sally ports (world/corridors.js, ±50)
  fence({ x0: -FX, z0: FZS, x1: -60.5, z1: FZS, h: 4.2, gates: [{ at: 40, w: 4, open: false, sign: SZ_SIGN }] });
  fence({ x0: 60.5, z0: FZS, x1: FX, z1: FZS, h: 4.2, gates: [{ at: 40, w: 4, open: false, sign: SZ_SIGN }] });
  // masts on the road, aimed into the compound
  for (const z of [-95, -50, -5, 40, 85]) { mast(-(OUT.x1 - 1.6), z, 18, { x: 1, z: 0 }); mast(OUT.x1 - 1.6, z, 18, { x: -1, z: 0 }); }
  for (const x of [-85, -40, 0, 40]) mast(x, OUT.z0 + 1.6, 18, { x: 0, z: 1 });
  for (const x of [-95, -70, 70, 95]) mast(x, OUT.z1 - 1.6, 18, { x: 0, z: -1 });

  /* ==========================================================
     2. THE WALKWAYS were open-air chain-link from each gate to each door
        until 2026-09-05; they are enclosed corridors now (world/corridors.js)
        and the network they form is the map's spine. `walkway()` stays for
        a fenced approach where one is wanted.
     ========================================================== */
  /* ==========================================================
     3. THE RECREATION YARD. x[-112,-46] z[-100,-12]: turf, a four-lane
        track, two courts, bleachers, a weight pit under a canopy, a
        handball wall, picnic tables, masts in the corners.
     ========================================================== */
  const RY = { x0: -112, x1: -46, z0: -100, z1: -12 };
  ground((RY.x0 + RY.x1) / 2, (RY.z0 + RY.z1) / 2, RY.x1 - RY.x0, RY.z1 - RY.z0, "turf", { program: "rec-yard" });
  ring(RY.x0, RY.z0, RY.x1, RY.z1, { h: 4.2, gates: [{ side: "S", at: -48, w: 4, open: true }] });
  // the track: a stadium ring, four 1.22 m lanes
  (function track() {
    const cx = -88, cz = -58, L = 36, Ro = 17.6, lanes = 4, lw = 1.22, Ri = Ro - lanes * lw;
    const stadium = function (R) {
      const p = new THREE.Path();
      p.moveTo(-R, -L / 2); p.lineTo(-R, L / 2);
      p.absarc(0, L / 2, R, Math.PI, 0, true);
      p.lineTo(R, -L / 2);
      p.absarc(0, -L / 2, R, 0, Math.PI, true);
      return p;
    };
    const bandShape = function (Ra, Rb) {
      const s = new THREE.Shape(stadium(Ra).getPoints(40));
      const hole = new THREE.Path(stadium(Rb).getPoints(40));
      s.holes.push(hole);
      return s;
    };
    const surf = new THREE.ShapeGeometry(bandShape(Ro, Ri), 1);
    surf.rotateX(-Math.PI / 2);
    const asphaltRed = K.skin("concrete", 0x9a5a48);
    stat(surf, asphaltRed, cx, 0.03, cz, { uv: 2, cast: false });
    const white = new THREE.MeshLambertMaterial({ color: 0xf0efe8 });
    for (let k = 0; k <= lanes; k++) {
      const R = Ri + k * lw;
      const g = new THREE.ShapeGeometry(bandShape(R + 0.03, R - 0.03), 1);
      g.rotateX(-Math.PI / 2); g.translate(cx, 0.045, cz);
      const m = new THREE.Mesh(g, white); m.userData.paint = true; ROOT.add(m);
    }
    // start/finish
    paint(cx + Ro - lanes * lw / 2, cz - L / 2 + 2, lanes * lw, 0.08);
  })();
  // two courts on the east side
  function court(cx, cz) {
    const w = 15, d = 28;
    ground(cx, cz, w + 1, d + 1, "asphalt", { y: 0.03, a: "#4d6b5e", b: "#466254" });
    const ln = 0.06;
    paint(cx, cz - d / 2, w, ln); paint(cx, cz + d / 2, w, ln); paint(cx - w / 2, cz, ln, d); paint(cx + w / 2, cz, ln, d);
    paint(cx, cz, w, ln);
    const circ = new THREE.Mesh(new THREE.RingGeometry(1.75, 1.81, 32), new THREE.MeshLambertMaterial({ color: 0xf0efe8 }));
    circ.rotation.x = -Math.PI / 2; circ.position.set(cx, 0.046, cz); circ.userData.paint = true; ROOT.add(circ);
    for (const s of [-1, 1]) {
      // the key and the hoop
      paint(cx - 2.45, cz + s * (d / 2 - 2.9), ln, 5.8); paint(cx + 2.45, cz + s * (d / 2 - 2.9), ln, 5.8); paint(cx, cz + s * (d / 2 - 5.8), 4.9, ln);
      const pz = cz + s * (d / 2 + 1.2);
      stat(new THREE.CylinderGeometry(0.06, 0.08, 3.4, 8), galv, cx, 1.7, pz, {});
      stat(new THREE.BoxGeometry(0.1, 0.1, 1.4), galv, cx, 3.2, pz - s * 0.7, { cast: false });
      const board = addBox(cx, 3.05, pz - s * 1.4, 1.8, 1.05, 0.05, 0xe9ecef, { cast: false });
      board.userData.prop = true;
      addBox(cx, 3.05, pz - s * 1.43, 0.6, 0.45, 0.02, 0xd8452a, { cast: false });
      const rim = new THREE.TorusGeometry(0.23, 0.014, 6, 16);
      stat(rim, K.skin("steel", 0xe0672a), cx, 3.05 - 0.3, pz - s * 1.85, { rx: Math.PI / 2, cast: false });
      CBZ.colliders.push({ minX: cx - 0.3, maxX: cx + 0.3, minZ: pz - 0.3, maxZ: pz + 0.3, noBreach: true });
    }
  }
  court(-58.5, -82); court(-58.5, -48);
  // bleachers: four tiers of aluminium on the track's west side, facing east
  function bleacher(x, z, len) {
    for (let t = 0; t < 4; t++) {
      const y = 0.42 + t * 0.36, xx = x - t * 0.62;
      stat(new THREE.BoxGeometry(0.62, 0.05, len), galv, xx, y, z, {});
      stat(new THREE.BoxGeometry(0.28, 0.05, len), galv, xx - 0.1, y + 0.42, z, { cast: false });    // the seat
      for (let i = 0; i <= 4; i++) stat(new THREE.BoxGeometry(0.06, y + 0.42, 0.06), galv, xx - 0.1, (y + 0.42) / 2, z - len / 2 + i * len / 4, { cast: false });
    }
    // a rail on the back
    stat(new THREE.BoxGeometry(0.05, 0.05, len), galv, x - 4 * 0.62 - 0.25, 0.42 + 3 * 0.36 + 1.0, z, { cast: false });
    for (let i = 0; i <= 4; i++) stat(new THREE.BoxGeometry(0.05, 1.0, 0.05), galv, x - 4 * 0.62 - 0.25, 0.42 + 3 * 0.36 + 0.5, z - len / 2 + i * len / 4, { cast: false });
    CBZ.colliders.push({ minX: x - 4 * 0.62 - 0.4, maxX: x + 0.35, minZ: z - len / 2, maxZ: z + len / 2, noBreach: true });
  }
  bleacher(-107.5, -70, 12); bleacher(-107.5, -46, 12);
  // the weight pit under a canopy
  (function weights() {
    const x0 = -66, x1 = -51, z0 = -30, z1 = -16, h = 3.2;
    ground((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, "concrete", { y: 0.03, a: "#6a7079", b: "#606770" });
    for (const x of [x0 + 0.4, (x0 + x1) / 2, x1 - 0.4]) for (const z of [z0 + 0.4, z1 - 0.4])
      stat(new THREE.BoxGeometry(0.16, h, 0.16), steelDark, x, h / 2, z, {});
    const roof = new THREE.PlaneGeometry(x1 - x0 + 1, z1 - z0 + 1);
    roof.rotateX(-Math.PI / 2 + 0.06);
    stat(roof, corrugated, (x0 + x1) / 2, h + 0.1, (z0 + z1) / 2, { uv: 1 });
    stat(new THREE.BoxGeometry(x1 - x0 + 1, 0.12, 0.12), steelDark, (x0 + x1) / 2, h, z0 + 0.4, { cast: false });
    stat(new THREE.BoxGeometry(x1 - x0 + 1, 0.12, 0.12), steelDark, (x0 + x1) / 2, h + 0.85, z1 - 0.4, { cast: false });
    // three benches, a squat rack, plates on a tree
    for (let i = 0; i < 3; i++) {
      const bx = x0 + 3 + i * 4.2, bz = z0 + 4;
      addBox(bx, 0.45, bz, 0.4, 0.08, 1.3, 0x2b2f36, { cast: false });
      addBox(bx, 0.22, bz - 0.5, 0.36, 0.44, 0.08, 0x5b6470, { cast: false }); addBox(bx, 0.22, bz + 0.5, 0.36, 0.44, 0.08, 0x5b6470, { cast: false });
      for (const s of [-1, 1]) addBox(bx + s * 0.6, 0.6, bz - 0.4, 0.06, 1.2, 0.06, 0x5b6470, { cast: false });
      addBox(bx, 1.15, bz - 0.4, 2.2, 0.03, 0.03, 0x8b95a1, { cast: false });
      for (const s of [-1, 1]) { const pl = new THREE.CylinderGeometry(0.22, 0.22, 0.05, 12); stat(pl, steelDark, bx + s * 0.95, 1.15, bz - 0.4, { rz: Math.PI / 2, cast: false }); }
      CBZ.colliders.push({ minX: bx - 1.1, maxX: bx + 1.1, minZ: bz - 0.7, maxZ: bz + 0.7, noBreach: true });
    }
    const rx = x1 - 3, rz = z1 - 3.5;
    for (const s of [-1, 1]) for (const t of [-1, 1]) addBox(rx + s * 0.55, 1.1, rz + t * 0.6, 0.07, 2.2, 0.07, 0x5b6470, { cast: false });
    addBox(rx, 1.5, rz - 0.6, 2.2, 0.03, 0.03, 0x8b95a1, { cast: false });
    CBZ.colliders.push({ minX: rx - 0.7, maxX: rx + 0.7, minZ: rz - 0.7, maxZ: rz + 0.7, noBreach: true });
    const tx = x0 + 2, tz = z1 - 2.5;
    addBox(tx, 0.8, tz, 0.08, 1.6, 0.08, 0x5b6470, { cast: false });
    for (let i = 0; i < 6; i++) { const pl = new THREE.CylinderGeometry(0.2 - i * 0.02, 0.2 - i * 0.02, 0.04, 12); stat(pl, steelDark, tx, 0.9 + i * 0.05, tz + 0.3, { rx: Math.PI / 2, cast: false }); }
    K.program("weight-pit", x0, x1, z0, z1);
  })();
  // the handball wall on the north end, a 6 m concrete slab
  (function handball() {
    const m = addBox(-90, 3, -97.6, 20, 6, 0.4, 0x9aa3ad, { solid: true, blockLOS: true });
    K.skinBox(m, "concrete", 0xb2b6ba);
    ground(-90, -93.5, 20, 7.5, "concrete", { y: 0.03, a: "#6a7079", b: "#606770" });
    paint(-90, -93.5, 0.06, 7.5); paint(-90, -89.8, 20, 0.06);
  })();
  // picnic tables by the gate
  function picnic(x, z) {
    const m = addBox(x, 0.74, z, 1.8, 0.07, 0.8, 0xb6b9bb, { cast: false }); K.skinBox(m, "concrete", 0xc0c3c5);
    addBox(x, 0.36, z, 0.16, 0.72, 0.6, 0x9aa0a8, { cast: false });
    for (const s of [-1, 1]) { const b = addBox(x, 0.45, z + s * 0.75, 1.8, 0.06, 0.3, 0xb6b9bb, { cast: false }); K.skinBox(b, "concrete", 0xc0c3c5); addBox(x, 0.22, z + s * 0.75, 0.12, 0.44, 0.24, 0x9aa0a8, { cast: false }); }
    CBZ.colliders.push({ minX: x - 0.9, maxX: x + 0.9, minZ: z - 0.95, maxZ: z + 0.95, noBreach: true });
  }
  picnic(-78, -18); picnic(-74, -18); picnic(-70, -18); picnic(-78, -22.5); picnic(-74, -22.5);
  for (const c of [[RY.x0 + 1.5, RY.z0 + 1.5, 1, 1], [RY.x1 - 1.5, RY.z0 + 1.5, -1, 1], [RY.x0 + 1.5, RY.z1 - 1.5, 1, -1], [RY.x1 - 1.5, RY.z1 - 1.5, -1, -1]])
    mast(c[0], c[1], 18, { x: c[2] * 0.7, z: c[3] * 0.7 });

  /* ==========================================================
     4. SEGREGATION'S CAGES. Eight chain-link exercise pens along the
        unit's north wall, roofed in mesh — one hour a day, alone.
     ========================================================== */
  (function segCages() {
    const z0 = -11.5, z1 = -4.25;                   // the unit's wall is at z=-4 (T 0.5)
    for (let i = 0; i < 8; i++) {
      const cx = 62 + i * 6.2, x0 = cx - 2.5, x1 = cx + 2.5;
      fence({ x0: x0, z0: z0, x1: x1, z1: z0, h: 3.4, razor: false, gates: [{ at: 2.5, w: 1.1, open: false }] });
      fence({ x0: x0, z0: z1, x1: x0, z1: z0, h: 3.4, razor: false });
      if (i === 7) fence({ x0: x1, z0: z1, x1: x1, z1: z0, h: 3.4, razor: false });
      const lid = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
      lid.rotateX(-Math.PI / 2);
      stat(lid, K.skin("chainlink", 0xb9c0c7), cx, 3.4, (z0 + z1) / 2, { uv: 2, cast: false });
      ground(cx, (z0 + z1) / 2, x1 - x0, z1 - z0, "concrete", { y: 0.03, a: "#6a7079", b: "#606770" });
    }
    K.program("seg-cages", 59.5, 107.9, z0, z1);
  })();

  /* ==========================================================
     5. THE SERVICE YARD. x[52,117.5] z[-109.5,-14]: the vehicle sally port
        in the north wall, a gatehouse, the warehouse with its dock, a
        fuel island, the motor pool, painted bays, the dumpsters.
     ========================================================== */
  const SY = { x0: 44, x1: FX, z0: FZN, z1: -14 };
  ground((SY.x0 + SY.x1) / 2, (SY.z0 + SY.z1) / 2, SY.x1 - SY.x0, SY.z1 - SY.z0, "asphalt", { program: "service-yard" });
  // the yard's south fence; its west fence (with the gate off the north
  // spine's east end) is world/corridors.js's, so the two agree on x=44
  fence({ x0: SY.x0, z0: SY.z1, x1: SY.x1, z1: SY.z1, h: 4.2 });
  /* THE NORTH COURT. Central control (x±26, z[-108,-78]) stands north of the
     administration wing; before the walkways it was reached across open
     ground, and a walkway network that forgot it would strand the gun-room
     key's top room. So the service yard runs west behind the cell house and
     the admin wing to a fence at x=-42, and the strip between the old
     compound's north walls and this court is closed with two stubs to the
     cell house's own walls: one enclosure from the west fence to the wire,
     entered at the service-yard gate. Measured by flood-fill (0.5 m): the
     control door reads reachable with the sally cards, unreachable without. */
  // (the spine's legs at x=±40 pass through this line; the stubs die into
  //  the corridor walls either side of them)
  fence({ x0: -46, z0: SY.z0, x1: -46, z1: SY.z1, h: 4.2 });
  fence({ x0: -46, z0: SY.z1, x1: -42.3, z1: SY.z1, h: 4.2, razor: false });
  fence({ x0: -37.7, z0: SY.z1, x1: -16.6, z1: SY.z1, h: 4.2, razor: false });
  fence({ x0: 16.6, z0: SY.z1, x1: 37.7, z1: SY.z1, h: 4.2, razor: false });
  ground(0, (SY.z0 - 64) / 2, 84, -64 - SY.z0, "asphalt", { program: "north-court" });
  // the sally port: pen fences, inner vehicle gate (shut), the wall gate (shut, solid)
  const PEN = { x0: 90, x1: 114, z1: -98 };
  fence({ x0: PEN.x0, z0: OUT.z0 + 0.5, x1: PEN.x0, z1: PEN.z1, h: 4.6 });
  fence({ x0: PEN.x1, z0: OUT.z0 + 0.5, x1: PEN.x1, z1: PEN.z1, h: 4.6 });
  fence({ x0: PEN.x0, z0: PEN.z1, x1: PEN.x1, z1: PEN.z1, h: 4.6, gates: [{ at: 12, w: 9, open: false, sign: "STOP\nALL VEHICLES SUBJECT TO SEARCH" }] });
  ground((PEN.x0 + PEN.x1) / 2, (OUT.z0 + PEN.z1) / 2, PEN.x1 - PEN.x0, PEN.z1 - OUT.z0, "asphalt", { y: 0.025 });
  for (let i = 0; i < 4; i++) paint(PEN.x0 + 4 + i * 5.5, PEN.z1 + 1.2, 3.0, 0.14, 0xe1c744);
  (function wallGate() {
    // two leaves of ribbed steel in the wall's gap, each solid, noBreach, LOS
    const YHn = (CBZ.DIM && CBZ.DIM.YH) || 11;
    for (const s of [0, 1]) {
      const cx = VG.x0 + 5 + s * 10;
      const leaf = addBox(cx, 3.6, VG.z, 9.7, 7.2, 0.32, 0x4a525c, { solid: true, blockLOS: true });
      if (leaf.userData.collider) leaf.userData.collider.noBreach = true;
      K.skinBox(leaf, "steel", 0x5b636d);
      for (const y of [0.9, 2.6, 4.3, 6.0]) stat(new THREE.BoxGeometry(9.5, 0.18, 0.12), steelDark, cx, y, VG.z + 0.22, { cast: false });
      for (const y of [0.9, 2.6, 4.3, 6.0]) stat(new THREE.BoxGeometry(9.5, 0.18, 0.12), steelDark, cx, y, VG.z - 0.22, { cast: false });
    }
    // the wicket in the west leaf, a hinge column either side, a lintel beam with the coil over it
    stat(new THREE.BoxGeometry(0.9, 2.1, 0.06), steelDark, VG.x0 + 2.2, 1.06, VG.z + 0.2, { cast: false });
    for (const x of [VG.x0 - 0.5, VG.x1 + 0.5]) {
      const col = addBox(x, YHn / 2, VG.z, 1.4, YHn, 1.6, 0x9aa3ad, { solid: true, blockLOS: true });
      if (col.userData.collider) col.userData.collider.noBreach = true;
      K.skinBox(col, "concrete", 0xa9adb1);
    }
    const lintel = addBox((VG.x0 + VG.x1) / 2, 9.2, VG.z, VG.x1 - VG.x0 + 1, 3.6, 1.0, 0x9aa3ad, { cast: true });
    K.skinBox(lintel, "panel", 0x9aa3ad);
    K.program("sally-port", PEN.x0, PEN.x1, OUT.z0, PEN.z1);
  })();
  // the gatehouse beside the pen: a small glazed room with a counter
  (function gatehouse() {
    const x0 = 83, x1 = 89, z0 = -104, z1 = -98.5, h = 3.2;
    CBZ.roomShell({ x0: x0, x1: x1, z0: z0, z1: z1, h: h, wall: 0x9aa3ad, floor: 0x5b636c, skin: "panel", doors: [{ side: "S", center: 85, width: 1.4 }] });
    if (CBZ.prisonRoof) CBZ.prisonRoof({ id: "vehicle-gatehouse", x0: x0, x1: x1, z0: z0, z1: z1, top: h, over: 0.35, cast: true });
    stat(new THREE.PlaneGeometry(2.4, 1.1), glass, x1 + 0.26, 1.9, (z0 + z1) / 2, { ry: Math.PI / 2, cast: false });
    stat(new THREE.PlaneGeometry(4.0, 1.1), glass, (x0 + x1) / 2, 1.9, z0 - 0.26, { cast: false });
    addBox((x0 + x1) / 2, 0.5, z1 - 0.2, 3.6, 1.0, 0.5, 0x515a66, { solid: true });
  })();
  // the warehouse: a shell with a roof, a raised dock, three roller doors
  (function warehouse() {
    const x0 = 60, x1 = 100, z0 = -100, z1 = -72, h = 7;
    CBZ.roomShell({ x0: x0, x1: x1, z0: z0, z1: z1, h: h, wall: 0x8d949c, floor: 0x5e656e, skin: "panel", doors: [{ side: "S", center: 66, width: 3 }] });
    addBox(66, (3.1 + h) / 2, z1, 3, h - 3.1, 0.5, 0x8d949c, { cast: false });
    if (CBZ.prisonRoof) CBZ.prisonRoof({ id: "warehouse", x0: x0, x1: x1, z0: z0, z1: z1, top: h, over: 0.25, cast: true });
    K.sign("RECEIVING", 86, 6.2, z1 + 0.3, 4, 0.9, 0, "#f3f3ef", "#1f3a5f");
    // three roller shutters on the south face, over the dock
    for (const dx of [76, 84, 92]) {
      const door = new THREE.PlaneGeometry(4.2, 4.4);
      stat(door, roller, dx, 1.2 + 2.2, z1 + 0.27, { cast: false });
      stat(new THREE.BoxGeometry(4.6, 0.4, 0.5), steelDark, dx, 1.2 + 4.5, z1 + 0.3, { cast: false });
    }
    // the dock: 1.2 m high, 4 m deep, bumpers, a stair at its east end
    const dock = addBox(85, 0.6, z1 + 2.2, 26, 1.2, 4.0, 0x8f959c, { solid: true });
    K.skinBox(dock, "concrete", 0xa0a5aa);
    for (const dx of [76, 84, 92]) for (const s of [-1, 1]) addBox(dx + s * 1.6, 0.7, z1 + 4.32, 0.4, 0.5, 0.25, 0x1e2126, { cast: false });
    for (let i = 0; i < 6; i++) addBox(98.6, 0.1 + i * 0.2, z1 + 0.6 + i * 0.6, 1.2, 0.2, 0.6, 0x8f959c, { cast: false });
    paint(85, z1 + 6.2, 26, 0.14, 0xe1c744);
    // stock inside: five rack rows, pallets on the floor by the doors
    for (let i = 0; i < 5; i++) {
      const rx = x0 + 6 + i * 7;
      addBox(rx, 1.6, z0 + 13, 1.2, 3.2, 20, 0x5b6470, { solid: true, blockLOS: true });
      for (let j = 0; j < 3; j++) addBox(rx, 0.9 + j * 1.0, z0 + 13, 1.3, 0.06, 20.2, 0x4a525c, { cast: false });
      for (let j = 0; j < 6; j++) addBox(rx + (j % 2 ? 0.2 : -0.2), 0.95 + (j % 3) * 1.0 + 0.3, z0 + 4 + j * 3.2, 0.9, 0.6, 1.1, [0xb07a3c, 0x8a5e2b, 0x9aa0a8][j % 3], { cast: false });
    }
    for (let i = 0; i < 5; i++) addBox(72 + i * 5, 0.42, z1 - 3, 1.2, 0.84, 1.0, 0xb07a3c, { solid: true });
    // the room is an interior to the night rig
    CBZ.onUpdate(21.37, (function () { let done = false; return function () {
      if (done || !CBZ.prisonLights || !CBZ.prisonLights.rooms) return; done = true;
      CBZ.prisonLights.rooms.push({ id: "warehouse", x0: x0, x1: x1, z0: z0, z1: z1 });
    }; })());
    // dumpsters on the dock apron
    for (let i = 0; i < 3; i++) {
      const dx = 62 + i * 3.6, dz = z1 + 8;
      const b = addBox(dx, 0.7, dz, 3.0, 1.3, 1.7, 0x2f6b3a, { solid: true }); K.skinBox(b, "steel", 0x2f6b3a);
      addBox(dx, 1.45, dz, 3.1, 0.2, 1.8, 0x274f2c, { cast: false });
    }
  })();
  // the fuel island: two pumps under a canopy
  (function fuel() {
    const x = 113, z = -80;
    ground(x, z, 9, 8, "concrete", { y: 0.03, a: "#70767f", b: "#666c75" });
    for (const s of [-1, 1]) stat(new THREE.BoxGeometry(0.4, 4.6, 0.4), steelDark, x + s * 2.6, 2.3, z, {});
    stat(new THREE.BoxGeometry(8, 0.5, 6), steelWhite, x, 4.6, z, {});
    stat(new THREE.BoxGeometry(8.2, 0.3, 6.2), steelDark, x, 4.85, z, { cast: false });
    const island = addBox(x, 0.1, z, 6, 0.2, 1.4, 0x8f959c, { solid: true }); K.skinBox(island, "concrete", 0xa0a5aa);
    for (const s of [-1, 1]) { const p = addBox(x + s * 1.6, 0.85, z, 0.9, 1.5, 0.5, 0xd8d2c4, { solid: true }); K.skinBox(p, "steel", 0xd8d2c4); addBox(x + s * 1.6, 1.2, z + 0.28, 0.5, 0.3, 0.02, 0x101418, { cast: false }); }
    K.sign("NO SMOKING", x, 3.6, z + 3.1, 2.4, 0.6, 0, "#f3f3ef", "#b3261e");
  })();
  // the motor pool: painted bays along the east fence, four vehicles in them
  function vehicle(kind, x, z, ry) {
    const c = Math.cos(ry), s = Math.sin(ry);
    const P = (ox, oz) => [x + ox * c + oz * s, z - ox * s + oz * c];
    const box = (ox, oy, oz, w, h, d, mat, o) => { const p = P(ox, oz); stat(new THREE.BoxGeometry(w, h, d), mat, p[0], oy, p[1], Object.assign({ ry: ry }, o || {})); };
    const wheel = (ox, oz) => { const p = P(ox, oz); stat(new THREE.CylinderGeometry(0.4, 0.4, 0.28, 14), steelDark, p[0], 0.4, p[1], { rz: Math.PI / 2, ry: ry }); };
    if (kind === "bus") {
      box(0, 1.75, 0, 2.55, 2.5, 11.0, steelWhite);
      box(0, 3.05, 0, 2.3, 0.14, 10.6, steelDark, { cast: false });
      box(0, 2.05, 0, 2.62, 0.75, 10.2, glass, { cast: false });
      box(0, 1.2, 0, 2.62, 0.22, 11.02, K.skin("steel", 0x1f3a5f), { cast: false });   // the stripe
      box(0, 1.55, -5.55, 2.4, 1.3, 0.06, glass, { cast: false });
      for (const oz of [-3.8, 3.0, 4.2]) { wheel(-1.2, oz); wheel(1.2, oz); }
    } else {
      box(0, 1.35, 0.8, 2.15, 2.0, 4.2, steelWhite);
      box(0, 1.05, -2.0, 2.15, 1.45, 1.6, steelWhite);
      box(0, 1.65, -1.6, 2.1, 0.7, 0.9, glass, { cast: false });
      box(0, 0.9, 0, 2.2, 0.16, 6.0, K.skin("steel", 0x1f3a5f), { cast: false });
      box(0, 1.3, 0.9, 2.2, 0.5, 0.05, steelDark, { cast: false });
      wheel(-1.0, -2.1); wheel(1.0, -2.1); wheel(-1.0, 1.9); wheel(1.0, 1.9);
    }
    const hw = kind === "bus" ? 1.4 : 1.2, hd = kind === "bus" ? 5.6 : 3.1;
    const c0 = P(-hw, -hd), c1 = P(hw, hd), c2 = P(-hw, hd), c3 = P(hw, -hd);
    CBZ.colliders.push({ minX: Math.min(c0[0], c1[0], c2[0], c3[0]), maxX: Math.max(c0[0], c1[0], c2[0], c3[0]), minZ: Math.min(c0[1], c1[1], c2[1], c3[1]), maxZ: Math.max(c0[1], c1[1], c2[1], c3[1]), noBreach: true });
  }
  for (let i = 0; i < 7; i++) paint(SY.x1 - 4.5, -60 + i * 3.6, 9, 0.12, 0xe9e9e4);
  paint(SY.x1 - 9, -60 + 3 * 3.6, 0.12, 6 * 3.6, 0xe9e9e4);
  vehicle("van", SY.x1 - 4.5, -58.2, Math.PI / 2);
  vehicle("van", SY.x1 - 4.5, -51.0, Math.PI / 2);
  vehicle("van", SY.x1 - 4.5, -43.8, Math.PI / 2);
  vehicle("bus", 96, -30, Math.PI / 2);
  paint(96, -30, 13, 0.12, 0xe9e9e4); paint(96, -26.5, 13, 0.12, 0xe9e9e4); paint(96, -33.5, 13, 0.12, 0xe9e9e4);
  // masts
  mast(56, SY.z0 + 4, 18, { x: 0.7, z: 0.7 }); mast(56, SY.z1 - 4, 18, { x: 0.7, z: -0.7 }); mast(SY.x1 - 3, -50, 18, { x: -1, z: 0 });
  // a shelter for the yard detail
  (function shelter() {
    const x = 58, z = -40;
    for (const s of [-1, 1]) for (const t of [-1, 1]) stat(new THREE.BoxGeometry(0.12, 2.6, 0.12), steelDark, x + s * 1.6, 1.3, z + t * 1.2, {});
    const r = new THREE.PlaneGeometry(4, 3.2); r.rotateX(-Math.PI / 2 + 0.08);
    stat(r, corrugated, x, 2.7, z, { uv: 1 });
    addBox(x, 0.45, z + 0.6, 3.2, 0.06, 0.4, 0x8b95a1, { cast: false });
  })();

  /* ==========================================================
     6. THE UTILITIES. A water tower and the tank farm in the south-west,
        the transformer yard against the powerhouse. Fenced, signed, gravel.
     ========================================================== */
  (function utilities() {
    const UY = { x0: -116, x1: -61, z0: 98, z1: 120 };
    ground((UY.x0 + UY.x1) / 2, (UY.z0 + UY.z1) / 2, UY.x1 - UY.x0, UY.z1 - UY.z0, "gravel", { program: "utility-yard" });
    ring(UY.x0, UY.z0, UY.x1, UY.z1, { h: 3.6, gates: [{ side: "N", at: -60, w: 5, open: false, sign: "AUTHORIZED\nPERSONNEL ONLY" }] });
    // the water tower: four braced legs, a riser, a tank with a domed floor and a conical roof
    (function waterTower() {
      const x = -98, z = 109, H = 17, R = 4.6;
      const legs = [[-3.2, -3.2], [3.2, -3.2], [-3.2, 3.2], [3.2, 3.2]];
      for (const l of legs) {
        stat(new THREE.CylinderGeometry(0.16, 0.24, H, 8), K.skin("steel", 0xb9bec4), x + l[0], H / 2, z + l[1], {});
        const f = addBox(x + l[0], 0.3, z + l[1], 1.2, 0.6, 1.2, 0x8f959c, { solid: true }); K.skinBox(f, "concrete", 0xa0a5aa);
      }
      // X bracing on each face, three panels up
      for (let p = 0; p < 3; p++) {
        const y0 = 1.5 + p * 5, y1 = y0 + 5;
        for (const f of [[0, 1], [2, 3], [0, 2], [1, 3]]) {
          const a = legs[f[0]], b = legs[f[1]];
          const mx = x + (a[0] + b[0]) / 2, mz = z + (a[1] + b[1]) / 2;
          const along = a[0] === b[0] ? "z" : "x";
          const len = Math.sqrt(6.4 * 6.4 + 25);
          const ang = Math.atan2(5, 6.4);
          for (const s of [-1, 1]) {
            const g = new THREE.CylinderGeometry(0.03, 0.03, len, 5);
            stat(g, K.skin("steel", 0xb9bec4), mx, (y0 + y1) / 2, mz, along === "x" ? { rz: s * (Math.PI / 2 - ang), cast: false } : { rx: s * (Math.PI / 2 - ang), cast: false });
          }
          if (along === "x") stat(new THREE.BoxGeometry(6.4, 0.1, 0.1), K.skin("steel", 0xb9bec4), mx, y1, mz, { cast: false });
          else stat(new THREE.BoxGeometry(0.1, 0.1, 6.4), K.skin("steel", 0xb9bec4), mx, y1, mz, { cast: false });
        }
      }
      stat(new THREE.CylinderGeometry(0.35, 0.35, H, 10), K.skin("steel", 0x8f959c), x, H / 2, z, {});
      const tankMat = K.skin("steel", 0xc9cdd1);
      stat(new THREE.CylinderGeometry(R, R, 4.2, 24, 1, true), tankMat, x, H + 2.1 + 1.6, z, {});
      const dome = new THREE.SphereGeometry(R, 24, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
      stat(dome, tankMat, x, H + 1.6, z, {});
      stat(new THREE.ConeGeometry(R + 0.2, 1.6, 24), tankMat, x, H + 2.1 + 3.2 + 0.8, z, {});
      stat(new THREE.CylinderGeometry(R + 0.25, R + 0.25, 0.12, 24), steelDark, x, H + 1.65, z, { cast: false });
      // a catwalk ring under the tank and a ladder cage up a leg
      K.octRing(R + 0.6, H + 1.0, 0.05, 0.05, galv, x, z, { cast: false });
      K.octRing(R + 0.6, H + 0.5, 0.04, 0.04, galv, x, z, { cast: false });
      for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4; stat(new THREE.BoxGeometry(0.05, 1.0, 0.05), galv, x + Math.cos(a) * (R + 0.6), H + 0.55, z + Math.sin(a) * (R + 0.6), { cast: false }); }
      for (let y = 0.4; y < H; y += 0.3) stat(new THREE.CylinderGeometry(0.014, 0.014, 0.44, 5), galv, x + 3.2 + 0.4, y, z - 3.2, { rx: Math.PI / 2, cast: false });
      for (let y = 2.4; y < H - 1; y += 1.0) stat(new THREE.TorusGeometry(0.38, 0.015, 5, 9, Math.PI), galv, x + 3.2 + 0.45, y, z - 3.2, { rx: Math.PI / 2, ry: Math.PI / 2, cast: false });
      CBZ.colliders.push({ minX: x - 3.9, maxX: x + 3.9, minZ: z - 3.9, maxZ: z + 3.9, noBreach: true });
    })();
    // two horizontal tanks on saddles, a bunded pad, a generator container
    for (const tz of [104, 110]) {
      const tx = -70;
      stat(new THREE.CylinderGeometry(1.5, 1.5, 9, 18), steelWhite, tx, 2.1, tz, { rz: Math.PI / 2 });
      for (const s of [-1, 1]) stat(new THREE.SphereGeometry(1.5, 18, 10), steelWhite, tx + s * 4.5, 2.1, tz, {});
      for (const s of [-1, 1]) { const sd = addBox(tx + s * 2.8, 0.55, tz, 0.6, 1.1, 3.2, 0x8f959c, { solid: true }); K.skinBox(sd, "concrete", 0xa0a5aa); }
      CBZ.colliders.push({ minX: tx - 6, maxX: tx + 6, minZ: tz - 1.6, maxZ: tz + 1.6, noBreach: true });
    }
    const bund = addBox(-70, 0.3, 107, 14, 0.6, 10, 0x8f959c, { cast: false }); K.skinBox(bund, "concrete", 0xa0a5aa);
    const gen = addBox(-86, 1.45, 114, 12, 2.9, 2.6, 0x3f5a46, { solid: true, blockLOS: true }); K.skinBox(gen, "corrugated", 0x3f5a46, 0.6);
    addBox(-86, 3.2, 114, 1.2, 0.6, 1.2, 0x2a2f38, { cast: false }); addBox(-86, 4.1, 114, 0.4, 1.2, 0.4, 0x2a2f38, { cast: false });
    K.sign("NO SMOKING", -86, 2.0, 115.35, 1.6, 0.5, 0, "#f3f3ef", "#b3261e");
    // the transformer yard, hard against the powerhouse
    const TY = { x0: -116, x1: -100, z0: 46, z1: 60 };
    ground((TY.x0 + TY.x1) / 2, (TY.z0 + TY.z1) / 2, TY.x1 - TY.x0, TY.z1 - TY.z0, "gravel", { program: "transformer-yard" });
    ring(TY.x0, TY.z0, TY.x1, TY.z1, { h: 3.0, razor: false, gates: [{ side: "E", at: 53, w: 3, open: false, sign: "DANGER\nHIGH VOLTAGE" }] });
    for (const tx of [-112, -105]) {
      const body = addBox(tx, 1.1, 53, 2.6, 2.2, 2.0, 0x4a525c, { solid: true, blockLOS: true }); K.skinBox(body, "steel", 0x5b6470);
      for (let i = 0; i < 6; i++) for (const s of [-1, 1]) stat(new THREE.BoxGeometry(0.5, 1.6, 0.05), steelDark, tx + s * 1.55, 1.1, 52.2 + i * 0.32, { cast: false });
      for (let i = 0; i < 3; i++) {
        stat(new THREE.CylinderGeometry(0.09, 0.12, 0.7, 8), K.skin("steel", 0x8a6a3a), tx - 0.8 + i * 0.8, 2.55, 53, { cast: false });
        stat(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 5), galv, tx - 0.8 + i * 0.8, 3.4, 53, { cast: false });
      }
      stat(new THREE.CylinderGeometry(0.06, 0.06, 4.0, 6), galv, tx - 0.8, 2.9, 53, { rz: Math.PI / 2, cast: false });
    }
    // a pole with the drop from the yard to the powerhouse wall
    stat(new THREE.CylinderGeometry(0.12, 0.16, 9, 8), K.skin("steel", 0x6b5a48), -102, 4.5, 58.5, {});
    stat(new THREE.BoxGeometry(2.2, 0.12, 0.12), steelDark, -102, 8.6, 58.5, { cast: false });
  })();

  /* ==========================================================
     7. THE NUMBERS. Walkways are programmes too (the fences claim them);
        the rest of the ring's open ground is what the audit reports as
        still unprogrammed.
     ========================================================== */
  // the city's interiors (built later) keep their own flat walls
  K.defaultSkin = null;
  K.flush();
})();
