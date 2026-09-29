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

  /* ==========================================================
     1. THE STERILE ZONE. Inner fence 6.5 m inside the wall, a patrol road
        between, floodlight masts on the road, the perimeter patrol
        (entities/guards.js) walking it.
     ========================================================== */
  const FX = OUT.x1 - 6.5, FZN = OUT.z0 + 6.5, FZS = OUT.z1 - 6.5;   // fence lines
  const RW = 6.0;                                                     // road width
  ground(-(OUT.x1 - 0.5 - RW / 2), (OUT.z0 + OUT.z1) / 2, RW, OUT.z1 - OUT.z0 - 1, "asphalt", { program: "patrol-road-w" });
  ground((OUT.x1 - 0.5 - RW / 2), (OUT.z0 + OUT.z1) / 2, RW, OUT.z1 - OUT.z0 - 1, "asphalt", { program: "patrol-road-e" });
  // the cross roads stop at the side roads: two asphalt sheets overlapping
  // at one height in every corner z-fought into a flicker
  const RX0 = OUT.x0 + 0.5 + RW, RX1 = OUT.x1 - 0.5 - RW;
  ground(0, OUT.z0 + 0.5 + RW / 2, RX1 - RX0, RW, "asphalt", { program: "patrol-road-n" });
  ground((RX0 + S.x0) / 2, OUT.z1 - 0.5 - RW / 2, S.x0 - RX0, RW, "asphalt", { program: "patrol-road-sw" });
  ground((S.x1 + RX1) / 2, OUT.z1 - 0.5 - RW / 2, RX1 - S.x1, RW, "asphalt", { program: "patrol-road-se" });
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
        and the network they form is the map's spine.
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
    paint(cx + Ro - lanes * lw / 2, cz - L / 2 + 2, lanes * lw, 0.08, 0xe9e9e4, 0.036);   // on the track, not under it
  })();
  // two full courts on the east side: a painted court surface, the
  // boundary, and both halves' FIBA markings (world/prisonkit.js courtHalf),
  // a gooseneck hoop behind each baseline
  function court(cx, cz) {
    const w = 15, d = 28, ln = 0.05, PY = 0.034;
    ground(cx, cz, w + 2, d + 3, "asphalt", { y: 0.03, a: "#3f5f4f", b: "#3a5849" });
    const line = (x, z, ww, dd) => paint(x, z, ww, dd, 0xe9e9e4, PY);
    line(cx, cz - d / 2, w, ln); line(cx, cz + d / 2, w, ln); line(cx - w / 2, cz, ln, d); line(cx + w / 2, cz, ln, d);
    K.courtHalf(cx, cz - d / 2, 1, { halfLine: true, keyFill: 0x6b3a30 });
    K.courtHalf(cx, cz + d / 2, -1, { keyFill: 0x6b3a30 });
    for (const s of [-1, 1]) {
      const pz = cz + s * (d / 2 + 0.6);
      K.hoop(cx, pz, 0, -s, { reach: 1.8 });
      CBZ.colliders.push({ minX: cx - 0.2, maxX: cx + 0.2, minZ: pz - 0.2, maxZ: pz + 0.2, noBreach: true });
    }
  }
  court(-58.5, -82); court(-58.5, -48);
  // bleachers on the track's west side, facing the infield (world/prisonkit.js)
  K.bleacher(-107.5, -70, 12); K.bleacher(-107.5, -46, 12);
  // the weight pit under a mono-pitch canopy, on a poured pad
  (function weights() {
    const x0 = -66, x1 = -51, z0 = -30, z1 = -16;
    ground((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, "concrete", { y: 0.03 });
    K.canopy(x0 + 0.4, x1 - 0.4, z0 + 0.4, z1 - 0.4, 3.7, 3.0);
    const vinyl = K.skin("steel", 0x1c1e22, 0.7), frame = K.skin("steel", 0x3a4048), bar = K.skin("galv", 0xb4bcc4), iron = K.skin("steel", 0x1c1e22, 0.7);
    const plate = (x, y, z, r) => stat(new THREE.CylinderGeometry(r, r, 0.05, 20), iron, x, y, z, { rz: Math.PI / 2, cast: false });
    // three flat press benches: a padded top on a tube frame, two uprights with the loaded bar racked
    for (let i = 0; i < 3; i++) {
      const bx = x0 + 3 + i * 4.2, bz = z0 + 4;
      stat(new THREE.BoxGeometry(0.3, 0.09, 1.2), vinyl, bx, 0.44, bz + 0.1, {});
      stat(new THREE.BoxGeometry(0.1, 0.04, 1.3), frame, bx, 0.38, bz + 0.1, { cast: false });
      for (const e of [-0.45, 0.65]) K.tube(bx - 0.2, 0.02, bz + e, bx + 0.2, 0.02, bz + e, 0.025, frame, { cast: false });
      for (const e of [-0.45, 0.65]) K.tube(bx, 0.02, bz + e, bx, 0.38, bz + e, 0.03, frame, { cast: false });
      for (const s of [-1, 1]) K.tube(bx + s * 0.55, 0, bz - 0.45, bx + s * 0.55, 1.22, bz - 0.45, 0.03, frame, { cast: false });
      stat(new THREE.CylinderGeometry(0.014, 0.014, 2.2, 8), bar, bx, 1.15, bz - 0.4, { rz: Math.PI / 2, cast: false });
      for (const s of [-1, 1]) { plate(bx + s * 0.86, 1.15, bz - 0.4, 0.225); plate(bx + s * 0.92, 1.15, bz - 0.4, 0.225); }
      CBZ.colliders.push({ minX: bx - 1.1, maxX: bx + 1.1, minZ: bz - 0.7, maxZ: bz + 0.7, noBreach: true });
    }
    // the squat rack: four square uprights, top frame, the bar on its J-hooks
    const rx = x1 - 3, rz = z1 - 3.5;
    for (const s of [-1, 1]) for (const t of [-1, 1]) stat(new THREE.BoxGeometry(0.075, 2.2, 0.075), frame, rx + s * 0.55, 1.1, rz + t * 0.6, {});
    for (const t of [-1, 1]) stat(new THREE.BoxGeometry(1.2, 0.075, 0.075), frame, rx, 2.2, rz + t * 0.6, { cast: false });
    for (const s of [-1, 1]) stat(new THREE.BoxGeometry(0.075, 0.075, 1.25), frame, rx + s * 0.55, 2.2, rz, { cast: false });
    stat(new THREE.CylinderGeometry(0.014, 0.014, 2.2, 8), bar, rx, 1.45, rz - 0.52, { rz: Math.PI / 2, cast: false });
    for (const s of [-1, 1]) plate(rx + s * 0.8, 1.45, rz - 0.52, 0.225);
    CBZ.colliders.push({ minX: rx - 0.7, maxX: rx + 0.7, minZ: rz - 0.7, maxZ: rz + 0.7, noBreach: true });
    // the plate tree: a post on a cross foot, four horns, a plate on each
    const tx = x0 + 2, tz = z1 - 2.5;
    stat(new THREE.BoxGeometry(0.07, 1.3, 0.07), frame, tx, 0.65, tz, {});
    stat(new THREE.BoxGeometry(0.7, 0.05, 0.08), frame, tx, 0.025, tz, { cast: false });
    stat(new THREE.BoxGeometry(0.08, 0.05, 0.7), frame, tx, 0.025, tz, { cast: false });
    for (const y of [0.45, 0.95]) for (const s of [-1, 1]) {
      stat(new THREE.CylinderGeometry(0.025, 0.025, 0.2, 8), bar, tx + s * 0.13, y, tz, { rz: Math.PI / 2, cast: false });
      plate(tx + s * 0.1, y, tz, y > 0.9 ? 0.16 : 0.225);
    }
    K.program("weight-pit", x0, x1, z0, z1);
  })();
  // the handball wall on the north end, a 6 m concrete slab on its pad
  (function handball() {
    const m = addBox(-90, 3, -97.6, 20, 6, 0.4, 0x9aa3ad, { solid: true, blockLOS: true });
    K.skinBox(m, "concrete", 0xb2b6ba);
    stat(new THREE.BoxGeometry(20.3, 0.2, 0.6), K.skin("concrete", 0x9ea3a8), -90, 6.1, -97.6, { cast: false });   // coping
    ground(-90, -93.5, 20, 7.5, "concrete", { y: 0.03 });
    paint(-90, -93.5, 0.06, 7.5, 0xe9e9e4, 0.034); paint(-90, -89.8, 20, 0.06, 0xe9e9e4, 0.034);
  })();
  // picnic tables by the gate: galvanised walk-through tables, bolted down
  function picnic(x, z) {
    K.picnicTable(x, z, 0);
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
      ground(cx, (z0 + z1) / 2, x1 - x0, z1 - z0, "concrete", { y: 0.03 });
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
      const leaf = addBox(cx, 3.6, VG.z, 9.7, 7.2, 0.32, 0x4a525c, { solid: true, blockLOS: true, y0: 0, y1: 7.2 });
      if (leaf.userData.collider) leaf.userData.collider.noBreach = true;
      K.skinBox(leaf, "steel", 0x5b636d);
      for (const y of [0.9, 2.6, 4.3, 6.0]) stat(new THREE.BoxGeometry(9.5, 0.18, 0.12), steelDark, cx, y, VG.z + 0.22, { cast: false });
      for (const y of [0.9, 2.6, 4.3, 6.0]) stat(new THREE.BoxGeometry(9.5, 0.18, 0.12), steelDark, cx, y, VG.z - 0.22, { cast: false });
    }
    // the wicket in the west leaf, a hinge column either side, a lintel beam with the coil over it
    stat(new THREE.BoxGeometry(0.9, 2.1, 0.06), steelDark, VG.x0 + 2.2, 1.06, VG.z + 0.2, { cast: false });
    for (const x of [VG.x0 - 0.5, VG.x1 + 0.5]) {
      const col = addBox(x, YHn / 2, VG.z, 1.4, YHn, 1.6, 0x9aa3ad, { solid: true, blockLOS: true, y0: 0, y1: YHn });
      if (col.userData.collider) col.userData.collider.noBreach = true;
      K.skinBox(col, "concrete", 0xa9adb1);
    }
    // (every piece of the port is solid to its own height and no higher: a
    // heightless collider is a wall to the sky, see world/yard.js)
    const lintel = addBox((VG.x0 + VG.x1) / 2, 9.2, VG.z, VG.x1 - VG.x0 + 1, 3.6, 1.0, 0x9aa3ad, { cast: true, solid: true, y0: 7.4, y1: 11 });
    if (lintel.userData.collider) lintel.userData.collider.noBreach = true;
    K.skinBox(lintel, "panel", 0x9aa3ad);
    K.program("sally-port", PEN.x0, PEN.x1, OUT.z0, PEN.z1);
  })();
  // a profile-extruded solid turned by `ry` (the fuel dispensers); vehicles
  // and dumpsters are the kit's own (world/prisonkit.js K.vehicle / K.dumpster)
  const place = (g, mat, x, z, ry, o) => stat(g, mat, x, 0, z, Object.assign({ ry: ry }, o || {}));
  const rubber = K.skin("steel", 0x1c1e22, 0.7), yellow = K.skin("steel", 0xd9b233);

  // the gatehouse beside the pen: a small glazed room with a counter
  (function gatehouse() {
    const x0 = 83, x1 = 89, z0 = -104, z1 = -98.5, h = 3.2;
    CBZ.roomShell({ x0: x0, x1: x1, z0: z0, z1: z1, h: h, wall: 0x9aa3ad, floor: 0x5b636c, skin: "panel", doors: [{ side: "S", center: 85, width: 1.4 }] });
    if (CBZ.prisonRoof) CBZ.prisonRoof({ id: "vehicle-gatehouse", x0: x0, x1: x1, z0: z0, z1: z1, top: h, over: 0.35, cast: true });
    stat(new THREE.PlaneGeometry(2.4, 1.1), glass, x1 + 0.26, 1.9, (z0 + z1) / 2, { ry: Math.PI / 2, cast: false });
    stat(new THREE.PlaneGeometry(4.0, 1.1), glass, (x0 + x1) / 2, 1.9, z0 - 0.26, { cast: false });
    const counter = addBox((x0 + x1) / 2, 0.5, z1 - 0.2, 3.6, 1.0, 0.5, 0x515a66, { solid: true });
    K.skinBox(counter, "steel", 0x515a66);
    stat(new THREE.BoxGeometry(3.7, 0.04, 0.6), K.skin("steel", 0x8f959c), (x0 + x1) / 2, 1.02, z1 - 0.2, { cast: false });   // the worktop
  })();
  // the warehouse: a shell with a roof, a raised dock, three roller doors
  (function warehouse() {
    const x0 = 60, x1 = 100, z0 = -100, z1 = -72, h = 7;
    CBZ.roomShell({ x0: x0, x1: x1, z0: z0, z1: z1, h: h, wall: 0x8d949c, floor: 0x5e656e, skin: "panel", doors: [{ side: "S", center: 66, width: 3 }] });
    const head = addBox(66, (3.1 + h) / 2, z1, 3, h - 3.1, 0.5, 0x8d949c, { cast: false });
    K.skinBox(head, "panel", 0x8d949c);
    if (CBZ.prisonRoof) CBZ.prisonRoof({ id: "warehouse", x0: x0, x1: x1, z0: z0, z1: z1, top: h, over: 0.25, cast: true });
    K.sign("RECEIVING", 86, 6.2, z1 + 0.3, 4, 0.9, 0, "#f3f3ef", "#1f3a5f");
    // three roller shutters on the south face, over the dock, each with its guides and barrel box
    for (const dx of [76, 84, 92]) {
      stat(new THREE.PlaneGeometry(4.2, 4.4), roller, dx, 1.2 + 2.2, z1 + 0.27, { cast: false });
      stat(new THREE.BoxGeometry(4.6, 0.5, 0.55), steelDark, dx, 1.2 + 4.65, z1 + 0.5, { cast: false });
      for (const s of [-1, 1]) stat(new THREE.BoxGeometry(0.12, 4.4, 0.14), steelDark, dx + s * 2.16, 1.2 + 2.2, z1 + 0.32, { cast: false });
    }
    // the dock: 1.2 m high, 4 m deep, rubber bumpers, a grounded stair with a rail at its east end.
    // Its collider was full height and nothing was ever registered on top,
    // so the dock was a 1.2 m wall and its six-step stair pure paint. Now the
    // collider is banded to the dock's own 1.2 m (a body on top is above it),
    // the deck is a platform, and the stair is a CBZ.stairs flight (6 x 0.20
    // rise over 3.0 m) landing on its own top step beside the deck.
    const dock = addBox(85, 0.6, z1 + 2.2, 26, 1.2, 4.0, 0x8f959c, { solid: true, y0: 0, y1: 1.2 });
    (CBZ.platforms || (CBZ.platforms = [])).push({ minX: 72, maxX: 98, minZ: z1 + 0.2, maxZ: z1 + 4.2, top: 1.2 });
    if (CBZ.markPlatformsDirty) CBZ.markPlatformsDirty();
    if (CBZ.stairs) CBZ.stairs.flight({
      bottom: { x: 98.6, y: 0, z: z1 + 4.0 }, top: { x: 98.6, y: 1.2, z: z1 + 1.0 },
      width: 1.2, overlap: 0.3, underside: false, owner: "warehouse-dock",
    });
    K.skinBox(dock, "concrete", 0xa0a5aa);
    stat(new THREE.BoxGeometry(26.05, 0.1, 0.1), steelDark, 85, 1.17, z1 + 4.18, { cast: false });   // the nosing angle
    for (const dx of [76, 84, 92]) for (const s of [-1, 1]) stat(new THREE.BoxGeometry(0.25, 0.45, 0.12), rubber, dx + s * 1.6, 0.8, z1 + 4.26, { cast: false });
    const conc = K.skin("concrete", 0xa0a5aa);
    for (let i = 0; i < 6; i++) {
      const top = 0.2 * (i + 1);
      stat(new THREE.BoxGeometry(1.2, top, 0.6), conc, 98.6, top / 2, z1 + 3.7 - 0.6 * i, { uv: 2 });
    }
    K.tube(99.15, 1.0, z1 + 4.4, 99.15, 2.1, z1 + 0.8, 0.025, galv, { cast: false });
    for (const tz of [z1 + 4.3, z1 + 0.9]) K.tube(99.15, tz > z1 + 4 ? 0.2 : 1.2, tz, 99.15, tz > z1 + 4 ? 1.1 : 2.15, tz, 0.025, galv, { cast: false });
    paint(85, z1 + 6.2, 26, 0.14, 0xe1c744);
    /* STOCK: five runs of pallet racking (blue frames, orange beams), each
       bay holding two pallets a level on the floor and two beam levels, the
       loads wrapped and of honest, different heights. The run is still the
       solid, LOS-blocking mass it was (an unseen box inside the racking);
       it just looks like racking now, not a grey slab with coloured cubes
       glued to it. */
    const upright = K.skin("steel", 0x2d5aa0), beam = K.skin("steel", 0xe07a1f), wood = K.skin("concrete", 0x9c7a4e);
    const cardboard = K.skin("concrete", 0xb08c5e), wrap = K.skin("galv", 0xc9ced3);
    const LEVELS = [0, 1.55, 3.1];
    for (let i = 0; i < 5; i++) {
      const rx = x0 + 6 + i * 7, rz0 = z0 + 3, rz1 = z0 + 23, bays = 8;
      const core = addBox(rx, 1.6, (rz0 + rz1) / 2, 1.2, 3.2, 20, 0x5b6470, { solid: true, blockLOS: true });
      core.visible = false;
      for (let b = 0; b <= bays; b++) {
        const bz = rz0 + (rz1 - rz0) * b / bays;
        for (const s of [-1, 1]) stat(new THREE.BoxGeometry(0.08, 4.2, 0.08), upright, rx + s * 0.55, 2.1, bz, { cast: b % 2 === 0 });
        for (let y = 0.6; y < 4.2; y += 0.9) stat(new THREE.BoxGeometry(1.1, 0.03, 0.03), upright, rx, y, bz, { cast: false });
      }
      for (const y of LEVELS) if (y > 0) for (const s of [-1, 1])
        stat(new THREE.BoxGeometry(0.06, 0.12, rz1 - rz0), beam, rx + s * 0.55, y - 0.06, (rz0 + rz1) / 2, { cast: false });
      for (let b = 0; b < bays; b++) for (let lv = 0; lv < LEVELS.length; lv++) for (const k of [-1, 1]) {
        const n = ((i * 7 + b * 3 + lv * 5 + (k + 1)) * 2654435761 >>> 0) / 4294967296;
        if (n < 0.22) continue;                                            // an empty slot
        const pz = rz0 + (rz1 - rz0) * (b + 0.5) / bays + k * 0.6, py = LEVELS[lv];
        stat(new THREE.BoxGeometry(1.2, 0.14, 1.0), wood, rx, py + 0.07, pz, { cast: false, uv: 1 });
        const lh = lv === 2 ? 0.45 + n * 0.45 : 0.6 + n * 0.7;
        stat(new THREE.BoxGeometry(1.1, lh, 0.95), n > 0.6 ? wrap : cardboard, rx, py + 0.14 + lh / 2, pz, { cast: false, uv: 1 });
      }
    }
    // the day's delivery, on the floor inside the doors
    for (let i = 0; i < 5; i++) {
      const px = 72 + i * 5, pz = z1 - 3;
      K.pallet(px, pz, 0);
      stat(new THREE.BoxGeometry(1.1, 0.7, 0.95), i % 2 ? wrap : cardboard, px, 0.14 + 0.35, pz, { uv: 1 });
      CBZ.colliders.push({ minX: px - 0.6, maxX: px + 0.6, minZ: pz - 0.5, maxZ: pz + 0.5, y0: 0, y1: 0.84 });
    }
    // the room is an interior to the night rig
    CBZ.onUpdate(21.37, (function () { let done = false; return function () {
      if (done || !CBZ.prisonLights || !CBZ.prisonLights.rooms) return; done = true;
      CBZ.prisonLights.rooms.push({ id: "warehouse", x0: x0, x1: x1, z0: z0, z1: z1 });
    }; })());
    // three front-load dumpsters on the dock apron
    for (let i = 0; i < 3; i++) K.dumpster(62 + i * 3.6, z1 + 8, Math.PI / 2);
  })();
  /* the fuel island: two dispensers under a canopy. A dispenser is a
     plinth, a white cabinet, a head with a display each face, a nozzle
     holstered on each flank with its hose looping down; yellow crash
     bollards guard the island ends. */
  (function fuel() {
    const x = 113, z = -80;
    ground(x, z, 9, 8, "concrete", { y: 0.03 });
    for (const s of [-1, 1]) stat(new THREE.BoxGeometry(0.4, 4.6, 0.4), steelDark, x + s * 2.6, 2.3, z, {});
    stat(new THREE.BoxGeometry(8, 0.5, 6), steelWhite, x, 4.6, z, {});
    stat(new THREE.BoxGeometry(8.2, 0.3, 6.2), steelDark, x, 4.85, z, { cast: false });
    const island = addBox(x, 0.1, z, 6, 0.2, 1.4, 0x8f959c, { solid: true }); K.skinBox(island, "concrete", 0xa0a5aa);
    const cab = K.skin("steel", 0xe6e7e3), red = K.skin("steel", 0xa3261f), screen = K.skin("steel", 0x141b22, 0.12);
    for (const s of [-1, 1]) {
      const px = x + s * 1.6;
      stat(new THREE.BoxGeometry(1.0, 0.12, 0.55), steelDark, px, 0.26, z, { cast: false });
      place(K.profileGeo([[-0.22, 0.32], [-0.22, 1.35], [-0.26, 1.4], [-0.26, 1.95], [0.26, 1.95], [0.26, 1.4], [0.22, 1.35], [0.22, 0.32]], 0.9, 0.03), cab, px, z, 0);
      stat(new THREE.BoxGeometry(0.94, 0.12, 0.6), red, px, 1.9, z, { cast: false });
      for (const f of [-1, 1]) {
        stat(new THREE.BoxGeometry(0.42, 0.26, 0.01), screen, px, 1.62, z + f * 0.295, { cast: false });
        stat(new THREE.BoxGeometry(0.2, 0.2, 0.01), screen, px - 0.28, 1.02, z + f * 0.255, { cast: false });   // keypad
      }
      for (const f of [-1, 1]) {
        const hx = px + f * 0.47;
        stat(new THREE.BoxGeometry(0.06, 0.22, 0.12), steelDark, hx, 1.12, z, { cast: false });              // holster
        stat(new THREE.CylinderGeometry(0.018, 0.018, 0.26, 6), steelDark, hx + f * 0.05, 1.05, z, { rz: f * 0.5, cast: false });
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(px + f * 0.3, 1.7, z), new THREE.Vector3(px + f * 0.62, 1.35, z + 0.05),
          new THREE.Vector3(px + f * 0.66, 0.55, z + 0.08), new THREE.Vector3(hx + f * 0.02, 0.95, z),
        ]);
        stat(new THREE.TubeGeometry(curve, 16, 0.02, 5, false), rubber, 0, 0, 0, { cast: false });
      }
      CBZ.colliders.push({ minX: px - 0.5, maxX: px + 0.5, minZ: z - 0.3, maxZ: z + 0.3, noBreach: true });
    }
    for (const s of [-1, 1]) for (const t of [-1, 1]) {
      K.tube(x + s * 3.3, 0, z + t * 0.45, x + s * 3.3, 1.0, z + t * 0.45, 0.07, yellow, { seg: 10 });
      CBZ.colliders.push({ minX: x + s * 3.3 - 0.1, maxX: x + s * 3.3 + 0.1, minZ: z + t * 0.45 - 0.1, maxZ: z + t * 0.45 + 0.1, noBreach: true });
    }
    K.sign("NO SMOKING", x, 3.6, z + 3.1, 2.4, 0.6, 0, "#f3f3ef", "#b3261e");
  })();
  // the motor pool: painted bays along the east fence, three transport vans
  // and the bus in them (world/prisonkit.js K.vehicle)
  for (let i = 0; i < 7; i++) paint(SY.x1 - 4.5, -60 + i * 3.6, 9, 0.12, 0xe9e9e4);
  paint(SY.x1 - 9, -60 + 3 * 3.6, 0.12, 6 * 3.6, 0xe9e9e4);
  K.vehicle("van", SY.x1 - 4.5, -58.2, Math.PI / 2);
  K.vehicle("van", SY.x1 - 4.5, -51.0, Math.PI / 2);
  K.vehicle("van", SY.x1 - 4.5, -43.8, Math.PI / 2);
  K.vehicle("bus", 96, -30, Math.PI / 2);
  paint(96, -30, 13, 0.12, 0xe9e9e4); paint(96, -26.5, 13, 0.12, 0xe9e9e4); paint(96, -33.5, 13, 0.12, 0xe9e9e4);
  // masts
  mast(56, SY.z0 + 4, 18, { x: 0.7, z: 0.7 }); mast(56, SY.z1 - 4, 18, { x: 0.7, z: -0.7 }); mast(SY.x1 - 3, -50, 18, { x: -1, z: 0 });
  // a smoking shelter for the yard detail: a real canopy and a bench on legs
  (function shelter() {
    const x = 58, z = -40;
    K.canopy(x - 1.6, x + 1.6, z - 1.2, z + 1.2, 2.7, 2.5);
    stat(new THREE.BoxGeometry(3.0, 0.05, 0.4), K.skin("galv", 0xb4bcc4), x, 0.45, z - 0.8, {});
    for (const e of [-1.3, 0, 1.3]) stat(new THREE.BoxGeometry(0.05, 0.43, 0.3), steelDark, x + e, 0.215, z - 0.8, { cast: false });
    CBZ.colliders.push({ minX: x - 1.5, maxX: x + 1.5, minZ: z - 1.0, maxZ: z - 0.6, y0: 0, y1: 0.48 });
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
      /* THE CATWALK AND THE WAY UP. A railed octagonal catwalk round the
         foot of the tank, a grated floor you stand on, and a caged ladder up
         the outside of the south-east leg that comes up through a hatch in
         it (world/ladderkit.js draws it off the numbers systems/climb.js
         climbs). It used to be rails with no floor, 0.4 m of room between the
         rail and the tank, rungs with no stiles, and one solid 7.8 m column
         from the ground to the sky — nobody could stand under it, and nobody
         could get up it. Now the legs are the columns and the tank is solid
         only where the tank is. */
      const CW = R + 1.6;                           // catwalk rail, circumradius
      K.octRing(CW, H + 1.0, 0.05, 0.05, galv, x, z, { cast: false });
      K.octRing(CW, H + 0.5, 0.04, 0.04, galv, x, z, { cast: false });
      for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4; stat(new THREE.BoxGeometry(0.05, 1.0, 0.05), galv, x + Math.cos(a) * CW, H + 0.55, z + Math.sin(a) * CW, { cast: false }); }
      for (const up of [1, -1]) {                   // the grating, both faces
        const deckG = new THREE.RingGeometry(R - 0.3, CW, 8, 1, Math.PI / 8, Math.PI * 2);
        deckG.rotateX(up > 0 ? -Math.PI / 2 : Math.PI / 2);
        stat(deckG, galv, x, H + (up > 0 ? 0.001 : -0.04), z, { cast: false });
      }
      if (CBZ.platforms) CBZ.platforms.push({ minX: x - CW, maxX: x + CW, minZ: z - CW, maxZ: z + CW, top: H });
      // the rail, as colliders: short boxes along each of the eight sides,
      // height-gated to the catwalk so they never stand in the yard
      for (let i = 0; i < 8; i++) {
        const a0 = Math.PI / 8 + i * Math.PI / 4, a1 = a0 + Math.PI / 4;
        const ax = x + Math.cos(a0) * CW, az = z + Math.sin(a0) * CW, bx = x + Math.cos(a1) * CW, bz = z + Math.sin(a1) * CW;
        const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.45);
        for (let k = 0; k <= n; k++) {
          const px = ax + (bx - ax) * k / n, pz = az + (bz - az) * k / n;
          CBZ.colliders.push({ minX: px - 0.14, maxX: px + 0.14, minZ: pz - 0.14, maxZ: pz + 0.14, y0: H, y1: H + 1.1, rail: true, noBreach: true });
        }
      }
      // the tank and its dome, from the dome's belly up: a plus of boxes
      // round the tank's 4.6 m wall (a head on the catwalk is at its height)
      const T0 = H - 3, T1 = H + 7.5;
      CBZ.colliders.push({ minX: x - 3.3, maxX: x + 3.3, minZ: z - 3.3, maxZ: z + 3.3, y0: T0, y1: T1, noBreach: true });
      CBZ.colliders.push({ minX: x - R, maxX: x + R, minZ: z - 2.0, maxZ: z + 2.0, y0: T0, y1: T1, noBreach: true });
      CBZ.colliders.push({ minX: x - 2.0, maxX: x + 2.0, minZ: z - R, maxZ: z + R, y0: T0, y1: T1, noBreach: true });
      // the legs and the riser, full height
      for (const l of legs) CBZ.colliders.push({ minX: x + l[0] - 0.3, maxX: x + l[0] + 0.3, minZ: z + l[1] - 0.3, maxZ: z + l[1] + 0.3, y0: 0, y1: H, noBreach: true });
      CBZ.colliders.push({ minX: x - 0.4, maxX: x + 0.4, minZ: z - 0.4, maxZ: z + 0.4, y0: 0, y1: H, noBreach: true });
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
      if (CBZ.markPlatformsDirty) CBZ.markPlatformsDirty();
      // the ladder: on the outside of the south-east leg, clear of its
      // footing, up through a hatch in the grating; the stiles and rungs run
      // on a metre past the floor, so the hands have something to come off by
      if (CBZ.ladderKit) {
        CBZ.ladderKit.build(CBZ.prisonRoot || CBZ.scene, {
          x: x + 3.85, z: z - 3.2, nx: 1, nz: 0, y0: 0, y1: H, rungTop: H + 1.0, ext: 0.15,
          standoff: 0.45, top: { x: x + 5.05, z: z - 2.25 },
          name: "water tower", tag: "prison:watertower", mode: "escape",
        }, galv);
      }
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
    // the silencer on the roof and its round exhaust stack with a rain cap
    stat(new THREE.CylinderGeometry(0.35, 0.35, 1.4, 14), steelDark, -86, 3.25, 114, { rz: Math.PI / 2, cast: false });
    K.tube(-86.5, 3.25, 114, -86.5, 4.6, 114, 0.1, steelDark, { seg: 10 });
    stat(new THREE.ConeGeometry(0.16, 0.14, 10), steelDark, -86.5, 4.72, 114, { cast: false });
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
    // three insulators on the arm and the three phases dropping, with sag, to the first transformer's bushings
    const porcelain = K.skin("steel", 0x8a6a3a), line = K.skin("steel", 0x1c1e22, 0.7);
    for (let i = 0; i < 3; i++) {
      const ax = -103 + i;
      stat(new THREE.CylinderGeometry(0.06, 0.08, 0.3, 8), porcelain, ax, 8.81, 58.5, { cast: false });
      const bx = -105.8 + i * 0.8;
      const wire = new THREE.CatmullRomCurve3([new THREE.Vector3(ax, 8.95, 58.5), new THREE.Vector3((ax + bx) / 2, 5.9, 55.8), new THREE.Vector3(bx, 4.0, 53)]);
      stat(new THREE.TubeGeometry(wire, 14, 0.012, 4, false), line, 0, 0, 0, { cast: false });
    }
  })();

  /* ==========================================================
     7. THE NUMBERS. Walkways are programmes too (the fences claim them);
        the rest of the ring's open ground is what the audit reports as
        still unprogrammed.
     ========================================================== */
  // the city's interiors (built later) keep their own flat walls
  K.defaultSkin = null;
})();
