/* ============================================================
   world/southblock.js — the big new SOUTH BLOCK that the compound now
   extends into: a lower exercise yard ringed by a workshop, a chapel,
   an infirmary and an industrial laundry, ending at a guarded sally
   port and the freedom gate. Built from the same addBox / roomShell
   primitives as the rest of the world. Load order: after roombuild
   (needs roomShell) and after coins (needs addPack).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.addBox || !CBZ.roomShell || !CBZ.scene) return;
  const { addBox, roomShell } = CBZ;
  const scene = CBZ.prisonRoot || CBZ.scene;
  const S = CBZ.WORLD.southBlock;

  /* ============================================================
     PRISON_DRESS_V2 — THE FLAG'S HOME. (2026-07-30)
     ============================================================
     OWNER: the prison escape game gets the craft bar of gang city's county
     jail. CLAUDE.md's gun-room grammar says polish spent EVENLY creates no
     gradient and therefore pulls nobody — so it goes on the rooms the game
     actually sends you to. systems/capture.js's DAY_BEAT rotates the whole
     block through four calls (YARD · CHOW · REC · LOCKDOWN, :273-278), which
     makes the yard, the chow hall and the dayroom load-bearing rooms rather
     than scenery, and this flag is the one switch over all three plus the
     south block's institutional texture.

     ON  → serving lines, dayroom fittings, wayfinding paint, wall wear, pipe
           runs, caged lamps, fire kit, door heads, bolted yard chow tables.
     OFF → the rooms exactly as they shipped, including the old cafeteria
           table rows and the lounge TV's original (floating) coordinate.

     DECLARED HERE, READ EVERYWHERE: index.html parses cafeteria (:445) and
     lounge (:446) BEFORE this file (:450), so all four prison-dress files
     carry the same `== null` line. The idiom is idempotent — whichever runs
     first wins and the rest are no-ops — which is exactly why CLAUDE.md
     prefers it to a src/config.js edit (that file is an Edit-race magnet).
  ============================================================ */
  if (CBZ.CONFIG.PRISON_DRESS_V2 == null) CBZ.CONFIG.PRISON_DRESS_V2 = true;
  const DRESS = !!CBZ.CONFIG.PRISON_DRESS_V2;
  const PD = CBZ.prisonDress || null;   // world/cafeteria.js; degrade-safe

  /* ============================================================
     PRISON_PROP_USE_V1 — THE FLAG'S HOME. (2026-08-15)
     ============================================================
     OWNER: "there's rooms that have, like, random blocks, just very stupid
     stuff. I don't like stupid details. Just leave an empty room if you want,
     or find a way to make it used." The rule that follows from it: EVERY PROP
     IS EITHER USABLE OR IT GOES. Usable = it has a collider (it stops you, or
     it is cover), it registers a propuse seat or bed anchor, it holds a placed
     item, it is a door / lock / breach target, it is a pushable, or it is a
     light fitting systems/prisonnight.js drives.

     THE MEASUREMENT: tools/visual-presets/prison-rooms.mjs counts, per room,
     `props / solid / used / dead` and `deadVol` m3. On the 2026-08-15 baseline
     run this file's LOWER YARD was the only room in the compound with
     `used: 0` — 58 props, 43 dead, 5.39 m3 — and 5.12 m3 of that was four
     walk-through 8 m lamp posts.

     WHAT THIS FLAG CHANGES IN THIS FILE
       · the four floodlight poles are GONE. systems/prisonnight.js:236 already
         stands eight real flood masts and four of them are over this yard.
       · the bar stock, both laundry carts and all three bleacher tiers are
         solid; the carts, the two barbells are pushables.
       · the weight benches and the bleachers register propuse seat anchors —
         the exercise yard's own program, which it did not have.
     OFF → every box back exactly as it shipped, including the four poles and
     the three concentric bleacher slabs.

     DECLARED HERE, READ IN cafeteria / lounge / yardfurniture / escape_routes.
     Same `== null` idiom as PRISON_DRESS_V2 above: idempotent, so whichever of
     the five files index.html parses first wins and the rest are no-ops.
     Ratchet: lower-yard `used` may never go back to 0.
  ============================================================ */
  if (CBZ.CONFIG.PRISON_PROP_USE_V1 == null) CBZ.CONFIG.PRISON_PROP_USE_V1 = true;
  const USE = !!CBZ.CONFIG.PRISON_PROP_USE_V1;

  // ---- ground: a poured concrete apron + the walkway leading to the gate ----
  // PRISON_GROUND_V2 (owner: "the checkered ground is dumb" — world/ground.js
  // owns the flag). The apron is a slab, so it gets REAL EXPANSION JOINTS on a
  // ~3.1 m panel grid instead of a draughts board; joints are drawn on the
  // tile seam as well as mid-tile, so the place the texture wraps IS a joint.
  // The central path is bitumen and now reads as bitumen. Same planes, same
  // positions, same `tex.repeat.set(rx, rz)` shape — only the canvas changed.
  const GV2 = !!(CBZ.CONFIG && CBZ.CONFIG.PRISON_GROUND_V2 && CBZ.prisonGroundTex);
  function slab(x, z, w, d, a, b, rx, rz, kind) {
    const tex = GV2 ? CBZ.prisonGroundTex(kind || "concrete", { a: a, b: b })
      : CBZ.checkerTex(a, b, 2);
    tex.repeat.set(rx, rz);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ map: tex }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.012, z); m.receiveShadow = true; scene.add(m);
    return m;
  }
  // apron: repeat UNCHANGED at 14x12 on purpose — that is a 6.3 m tile, and at
  // two panels per tile the joints land on 3.15 m centres, which is what a
  // real poured apron uses. A slab is the one tiling surface allowed to show
  // where it repeats.
  slab(0, 90, 88, 76, "#586069", "#4f5760", 14, 12, "concrete");   // lower-yard apron
  // path: 1x8 -> a ~9 m square tile. The old 2x16 repeated a 4.6 m cell
  // sixteen times down the corridor you walk the whole length of.
  // PRISON_ROAD_FIX (world/ground.js owns the flag and PUBLISHES the width).
  // This is the southern 76 m of the SAME walkway ground.js draws; the two used
  // to type "9" independently, which is exactly how a 132 m two-lane band ended
  // up running the length of the compound. One number, read, never retyped.
  const WALK = (CBZ.prisonWalkway && CBZ.prisonWalkway.w) || 9;
  slab(0, 90, WALK, 76, CBZ.COL.ASPHALT_A, CBZ.COL.ASPHALT_B, GV2 ? 1 : 2, GV2 ? 8 : 16, "asphalt"); // central path to the gate
  // the kerb continues with it, so the path does not lose its edges at z=52
  if (CBZ.prisonWalkway && CBZ.prisonWalkway.fixed) {
    for (const sx of [-1, 1]) addBox(sx * (WALK / 2 + 0.09), 0.06, 90, 0.18, 0.12, 76, 0xa9a294, { cast: false });
  }

  // a basketball half-court painted into the apron
  (function court() {
    const c = new THREE.Mesh(new THREE.PlaneGeometry(16, 22),
      new THREE.MeshLambertMaterial({ color: 0x8a5a2b }));
    c.rotation.x = -Math.PI / 2; c.position.set(-11, 0.02, 96); scene.add(c);
    const line = (x, z, w, d) => addBox(x, 0.04, z, w, 0.02, d, 0xe7e2d2, { cast: false });
    line(-11, 85.2, 16, 0.16); line(-11, 96, 5.0, 5.0); line(-3.2, 96, 0.16, 22);
  })();

  // running-track oval outline around the infield (just painted lines).
  // WHITE and small: the old 0.7 m yellow dabs read as road dashes from the
  // air and chained with the walkway into a phantom carriageway (owner:
  // "yellow dotted road going through the middle of it"). A track is lined
  // in white; nothing painted in this compound is yellow-dashed.
  (function track() {
    const seg = 40, R = 30;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const x = Math.cos(a) * (R * 0.9), z = 94 + Math.sin(a) * (R * 0.62);
      addBox(x, 0.03, z, 0.42, 0.02, 0.42, 0xcfd5d8, { cast: false });
    }
  })();

  /* ---- floodlight poles: DELETED (PRISON_PROP_USE_V1) -------------------
     THE YARD ALREADY HAS FLOOD MASTS AND THEY ARE NOT THESE.
     systems/prisonnight.js:236 stands eight — floodMast(-21,66) (21,66)
     (-21,110) (21,110) are the four over THIS yard — and each of those is a
     0.36 x 7 pole drawn `{ solid: true }`, with a bracket, a `mover`-tagged
     head, a 9 m light pool, a 6.9 m beam cone and a `flood` kind that strikes
     at dusk and burns till dawn (prisonnight.js:118).
     The four this file drew stood at (+/-20, 74) and (+/-20, 112) — 8.06 m and
     2.24 m from the real ones. Two eight-metre masts 2.24 m apart, and the
     pair this file owned was the fake one: 0.4 x 8 x 0.4 drawn `{}`, so you
     walked through a lamp post, under a head that was permanently emissive and
     never once obeyed lights-out.
     12 boxes. 5.12 m3 of walk-through steel — four of the five largest dead
     props in lower-yard and the single largest in sally-port. Deleting them
     costs the yard no light at all, because the light was never theirs. */
  if (!USE) {
    const floodPole = function (x, z) {
      addBox(x, 4.0, z, 0.4, 8, 0.4, 0x3c424d, {});
      addBox(x, 8.1, z, 1.6, 0.4, 0.7, 0x2a2f38, { cast: false });
      addBox(x, 7.95, z + 0.3, 1.5, 0.3, 0.18, 0xfff1a8, { emissive: 0xffe066, ei: 0.9, cast: false });
    };
    [[-20, 74], [20, 74], [-20, 112], [20, 112]].forEach((p) => floodPole(p[0], p[1]));
  }

  // ============================================================
  //  WORKSHOP (south-west) — welding bay
  // ============================================================
  roomShell({ x0: -42, x1: -24, z0: 58, z1: 80, h: 6, wall: 0x7c8590, floor: 0x6a6f78, door: { side: "E", center: 69, width: 4.2 } });
  addBox(-24, 5.4, 69, 0.2, 0.9, 4.0, 0xc85c00, { cast: false }); // sign band
  // workbenches with vices + scattered parts
  // NO-DECOY SWEEP (owner: "find things in the game that you can run through").
  // This file was written with `{ solid: true }` on the things whose author
  // happened to think about it — the crate, the bus, the jersey barriers, the
  // dumpster — and a bare `{}` on things of exactly the same size and kind
  // standing a few metres away. The rule applied below is the one world/
  // clutter.js already states: anything a body can meaningfully approach is
  // solid, or it reads as a decoy. What is deliberately NOT collided is named
  // at each site: overhead slabs, sheets and pillows lying on a solid frame,
  // and the water tank 8 m up (its LEGS are what you walk into).
  function bench2(x, z) {
    addBox(x, 0.8, z, 3.2, 0.18, 1.2, 0x8a939d, { solid: true });    // top — a 3.2m steel workbench
    addBox(x - 1.4, 0.4, z, 0.2, 0.8, 1.0, 0x5b6470, { cast: false });
    addBox(x + 1.4, 0.4, z, 0.2, 0.8, 1.0, 0x5b6470, { cast: false });
    addBox(x + 1.0, 1.0, z, 0.4, 0.3, 0.4, 0x2a2f38, { cast: false }); // vice
    addBox(x - 0.6, 0.98, z, 0.7, 0.12, 0.5, 0xb07a3c, { cast: false }); // wood block
  }
  bench2(-37, 62); bench2(-37, 76);
  // a glowing forge + sparks
  addBox(-40, 0.9, 69, 1.6, 1.8, 2.0, 0x2a2f38, { solid: true });    // 1.8m masonry forge
  addBox(-40, 1.2, 70.2, 1.2, 0.7, 0.3, 0xff6a1a, { emissive: 0xc83000, ei: 0.9, cast: false });
  // stacked steel stock + a parts crate
  // PRISON_PROP_USE_V1: the four bars were drawn `{}`+cast:false — 0.816 m3 of
  // 2.6 m steel a body walked straight through, the largest walk-through
  // object in the workshop after the forge glow. Bar stock IS the workshop's
  // raw material and a shin-high stack of it is a real obstacle, so it is
  // solid, y-gated to the stack's own top (0.64 + 0.14) the way the mess
  // tables and the round-table stools are — an obstacle, never a pillar.
  const STOCK = USE ? { cast: false, solid: true, y0: 0, y1: 0.78 } : { cast: false };
  for (let i = 0; i < 4; i++) addBox(-27 + (i % 2) * 0.4, 0.3 + Math.floor(i / 2) * 0.34, 75 + (i % 2) * 0.5, 2.6, 0.28, 0.28, 0x6b7480, STOCK);
  addBox(-28, 0.5, 62, 1.6, 1.0, 1.6, CBZ.COL.CRATE, { solid: true });

  // ============================================================
  //  CHAPEL (south-east) — the quiet wing
  // ============================================================
  roomShell({ x0: 24, x1: 42, z0: 58, z1: 80, h: 6.5, wall: 0xbfb6a4, floor: 0x6e5a3c, door: { side: "W", center: 69, width: 4.2 } });
  addBox(42, 5.8, 69, 0.2, 0.9, 4.0, 0x6d5a8f, { cast: false }); // sign band
  // altar + a tall cross on the far (east) wall
  addBox(40, 0.6, 69, 1.4, 1.2, 2.4, 0xece3d1, { solid: true });     // stone altar
  addBox(41, 2.6, 69, 0.22, 2.4, 0.22, 0xe8d44f, { emissive: 0x6a5a10, ei: 0.4, cast: false });
  addBox(41, 3.0, 69, 0.22, 0.22, 1.1, 0xe8d44f, { emissive: 0x6a5a10, ei: 0.4, cast: false });
  // rows of pews
  function pew(z) {
    // the seat plank is the collider (world/clutter.js's bench rule); the
    // backrest rides inside its footprint, so one AABB, not two.
    addBox(31, 0.45, z, 7.2, 0.16, 0.5, 0x9a6a2d, { solid: true });
    addBox(31, 0.8, z - 0.28, 7.2, 0.5, 0.12, 0x8a5e2b, { cast: false });
  }
  [62, 64.4, 66.8, 71.2, 73.6, 76]. forEach(pew);
  // narrow stained-glass slits on the east wall
  for (let i = -1; i <= 1; i++) addBox(41.78, 4.0, 69 + i * 5, 0.06, 2.0, 1.0, [0x6fb0ff, 0xff8e6f, 0x8dff9f][i + 1], { emissive: [0x2a4a7a, 0x7a3a20, 0x2a6a3a][i + 1], ei: 0.6, cast: false });

  // ============================================================
  //  INFIRMARY (east, lower) — beds + screens
  // ============================================================
  roomShell({ x0: 26, x1: 42, z0: 88, z1: 104, h: 6, wall: 0xd7dde2, floor: 0xb9c0c8, door: { side: "W", center: 96, width: 4.0 } });
  addBox(42, 5.4, 96, 0.2, 0.9, 3.4, 0x2f9e6a, { cast: false }); // green cross band
  addBox(42.0, 5.4, 96, 0.22, 0.6, 0.2, 0xffffff, { emissive: 0xbfeada, ei: 0.5, cast: false });
  function bed(x, z) {
    // THE WARD BED IS THE SHARED KIT'S. It was three flat slabs — frame, sheet,
    // pillow — and NO sleep anchor at all, so an infirmary full of beds was an
    // infirmary nobody could lie down in. CBZ.furnish.bed draws rails, a duvet
    // with a turned-down fold and a headboard, in the "clinic" tone (pale
    // frame + white linen: the same two colours this room already used, no new
    // batch bucket), and its own base box carries the collider the frame used
    // to. yaw = PI points from the mattress centre at the PILLOW, which is the
    // -z end the old pillow box sat on.
    //
    // KIT CALL, THEN FALL BACK (the world/lounge.js idiom — always through the
    // namespace, always inside a try, null = draw the authored boxes instead).
    const F = CBZ.furnish;
    let kitTop = null;
    if (F && typeof F.bed === "function") {
      try { if (F.bed(x, 0, z, Math.PI, { len: 2.4, wide: 1.4, tone: "clinic" })) kitTop = 0.55; }
      catch (e) { kitTop = null; }
    }
    if (kitTop == null) {
      // FRAME is the collider; the sheet and pillow lie ON it and add nothing.
      // Safe for propuse: entryOf() approaches a bed from its long side at
      // >=0.95 m, clear of a 1.5 m-wide frame, and the settle beats deliberately
      // skip collision (city/propuse.js) — a solid frame is the NORMAL case there
      // (CBZ.furnish draws a 1.4 m one).
      addBox(x, 0.45, z, 1.5, 0.2, 2.6, 0x9aa0a8, { solid: true });  // frame
      addBox(x, 0.62, z, 1.3, 0.14, 2.4, 0xeef2f5, { cast: false }); // sheet
      addBox(x, 0.78, z - 0.9, 1.1, 0.16, 0.5, 0xdfe6ec, { cast: false }); // pillow
    }
    addBox(x - 0.95, 0.7, z, 0.08, 1.0, 2.4, 0xcfd6dc, { cast: false }); // privacy screen
    // THE SLEEP ANCHOR THIS ROOM NEVER HAD. This file is parsed from the world
    // block, LONG before city/propuse.js exists, so it goes through
    // CBZ.roomBedAnchor — the queue-and-flush shim world/roombuild.js owns for
    // exactly this load-order gap. Head at -z (hx,hz = 0,-1), mattress top from
    // whichever body actually got drawn, never a retyped constant.
    const topY = kitTop != null ? kitTop : 0.69;
    if (CBZ.roomBedAnchor) CBZ.roomBedAnchor(x, 0, z, 0, -1, 2.4, topY, "bed", null);
    else if (CBZ.propRegisterBed) CBZ.propRegisterBed(x, 0, z, 0, -1, 2.4, topY, "bed", null);
  }
  bed(30, 92); bed(30, 100); bed(38, 92); bed(38, 100);
  // a supply cabinet + a glowing monitor
  addBox(34, 0.9, 90, 1.2, 1.8, 0.7, 0xc7ccd2, { solid: true });   // supply cabinet
  addBox(34, 1.6, 90.4, 0.6, 0.4, 0.06, 0x6fb7ff, { emissive: 0x2a6ea5, ei: 0.7, cast: false });

  // ============================================================
  //  LAUNDRY (west, lower) — steam, machines & carts
  // ============================================================
  roomShell({ x0: -42, x1: -26, z0: 88, z1: 104, h: 6, wall: 0x8a929c, floor: 0x7a828c, door: { side: "E", center: 96, width: 4.0 } });
  addBox(-26, 5.4, 96, 0.2, 0.9, 3.4, 0x3a6ea5, { cast: false });
  // a bank of industrial washers along the west wall
  for (let i = 0; i < 4; i++) {
    const z = 90 + i * 3.5;
    addBox(-40, 0.9, z, 1.8, 1.8, 1.8, 0xbfc6cd, { solid: true }); // industrial washer
    addBox(-39.1, 1.2, z, 0.1, 0.9, 0.9, 0x223047, { cast: false });          // door
    addBox(-39.05, 1.2, z, 0.06, 0.7, 0.7, 0x6fb7ff, { emissive: 0x2a5e85, ei: 0.4, cast: false }); // glass glow
  }
  // rolling laundry carts (canvas bins on a frame)
  // PRISON_PROP_USE_V1: both were drawn `{}` — a 1.5 m3 canvas bin you walked
  // through, and the (-29.5, 99) one was the biggest dead prop in the room.
  // A cart is SOLID (these two are the only cover on this floor) and the one
  // that is not holding a tool is a PUSHABLE: a laundry cart on castors is the
  // most obviously shovable object in the compound, and systems/pushables.js
  // is already how this compound prices a bench, a barrel and a mop bucket.
  // The (-31, 92) cart stays bolted because world/yardfurniture.js:231 lays
  // the LOCKPICK in it at y 1.22 — a route item does not get to roll away.
  function cart(x, z, push) {
    const bin = addBox(x, 0.7, z, 1.2, 0.9, 1.4, 0xe2e2e2, USE ? { solid: true } : {});
    const base = addBox(x, 0.18, z, 1.3, 0.12, 1.5, 0x3c424d, { cast: false });
    if (USE && push && CBZ.pushProp) CBZ.pushProp({
      parts: [bin, base], x: x, z: z, hx: 0.65, hz: 0.75, y1: 1.15,
      mass: 30, kind: "cart", leash: 5.0, mode: "escape",
    });
  }
  cart(-31, 92, false); cart(-29.5, 99, true);

  // ============================================================
  //  HOUSING D — controlled open-bay dormitory, 16 real beds
  // ============================================================
  /* The playable cast needs forty-two places to sleep. The cell house owns
     twenty-six; the old answer was sixteen loose mats scattered through its
     dayroom and the route to the yard gate. This room closes that exact gap
     with eight double stacks, using cellblock.js's own bunk builder and bed
     registration. It also puts the beds where a jail puts beds: inside one
     bounded, observable housing unit with sanitation, a bolted table, a
     controlled opening, and a clear sightline from the staffed sally-port
     side. Nothing below is generic yard garnish.

     GEOMETRY: the former water-tower corner, x[-42,-24] z[106,124]. Its north
     entrance faces the program yard; the west observation bay lets staff see
     the central aisle without stepping inside; the 3.4 m door lane remains
     clear through the first third of the room. */
  const HD = { id: "south-dorm", x0: -42, x1: -24, z0: 106, z1: 124, doorX: -33, doorZ: 106 };
  roomShell({
    x0: HD.x0, x1: HD.x1, z0: HD.z0, z1: HD.z1, h: 6,
    wall: 0x76818c, floor: 0x626b74,
    doors: [
      { side: "N", center: HD.doorX, width: 3.4 },
      { side: "N", center: -38.5, width: 3.0 },
    ],
  });
  // Human-scale entrance head + jambs. Like the main housing gate, the head
  // is visual/LOS structure only: a solid overhead box would be a full-height
  // 2-D collider to the actor system.
  addBox(HD.doorX, 4.65, HD.z0, 3.4, 2.7, 0.5, 0x76818c, { cast: false, blockLOS: true });
  addBox(HD.doorX - 1.78, 1.65, HD.z0 - 0.02, 0.18, 3.3, 0.62, 0x39424e, { cast: false });
  addBox(HD.doorX + 1.78, 1.65, HD.z0 - 0.02, 0.18, 3.3, 0.62, 0x39424e, { cast: false });
  addBox(HD.doorX, 3.28, HD.z0 - 0.02, 3.74, 0.18, 0.62, 0x39424e, { cast: false });
  addBox(HD.doorX, 5.45, HD.z0 - 0.28, 3.2, 0.52, 0.08, 0x244665, { cast: false });

  // Observation opening: real gap in roomShell, rebuilt as wall below/above a
  // clear pane and a security grille. The pane's collider is the wall here;
  // staff can see through it, nobody can walk through it.
  addBox(-38.5, 0.67, HD.z0, 3.0, 1.34, 0.5, 0x76818c, { solid: true, blockLOS: true });
  addBox(-38.5, 4.30, HD.z0, 3.0, 3.40, 0.5, 0x76818c, { cast: false, blockLOS: true });
  const dormPane = addBox(-38.5, 2.05, HD.z0 - 0.03, 2.82, 1.42, 0.16, 0xa9d9ea,
    { solid: true, cast: false });
  dormPane.material.transparent = true; dormPane.material.opacity = 0.34; dormPane.material.depthWrite = false;
  for (let i = -2; i <= 2; i++)
    addBox(-38.5 + i * 0.55, 2.05, HD.z0 - 0.16, 0.08, 1.46, 0.08, 0x39424e, { cast: false });
  addBox(-38.5, 1.36, HD.z0 - 0.16, 2.9, 0.10, 0.10, 0x39424e, { cast: false });
  addBox(-38.5, 2.74, HD.z0 - 0.16, 2.9, 0.10, 0.10, 0x39424e, { cast: false });

  const housing = {
    id: HD.id, bounds: HD, beds: [],
    route: { x: HD.doorX, z: HD.z0 + 1.1 },
    contains: function (x, z, pad) {
      pad = pad || 0;
      return x > HD.x0 - pad && x < HD.x1 + pad && z > HD.z0 - pad && z < HD.z1 + pad;
    },
  };
  CBZ.prisonHousing = housing;
  const dormZ = [109.2, 113.1, 117.0, 120.9];
  const blankets = [0x4a5b46, 0x5c6470, 0x6b6152, 0x53535e];
  if (CBZ.prisonBunk) {
    for (let side = 0; side < 2; side++) for (let i = 0; i < dormZ.length; i++) {
      const stack = CBZ.prisonBunk({
        id: "D-" + (side ? "E" : "W") + (i + 1), unit: housing,
        x: side ? -26.0 : -40.0, z: dormZ[i], along: "z", double: true,
        blanket: blankets[(i + side) % blankets.length],
      });
      if (stack) housing.beds.push(stack);
    }
  }

  // One bolted day table, offset from the entrance lane. It is a housing-unit
  // activity, not bedding in a common corridor; four declared cushions make
  // the furniture usable by the same shared sitting solve as the cell house.
  addBox(-36.0, 0.74, 116.0, 2.4, 0.10, 1.15, 0x8a939d, { solid: true });
  addBox(-36.0, 0.37, 116.0, 0.28, 0.74, 0.28, 0x5b6470, { cast: false });
  for (const p of [[-37.0, 116.0, Math.PI / 2], [-35.0, 116.0, -Math.PI / 2],
    [-36.0, 114.95, 0], [-36.0, 117.05, Math.PI]]) {
    addBox(p[0], 0.44, p[1], 0.44, 0.08, 0.44, 0x52606d, { cast: false });
    addBox(p[0], 0.22, p[1], 0.14, 0.44, 0.14, 0x9aa0a8, { cast: false });
    if (CBZ.roomSeatAnchor)
      CBZ.roomSeatAnchor(p[0], 0, p[1], p[2], "stool", null, { cushion: 0.48, floorBelow: 0 });
  }

  // Sanitation on the back wall, screened from the bunks but open to staff
  // observation above shoulder height. Each fixture is a combined stainless
  // toilet/sink, not a decorative bathroom prop.
  function dormSanitary(x) {
    addBox(x, 0.30, 122.75, 0.64, 0.60, 0.72, 0xc7ccd2, { cast: false });
    addBox(x, 0.62, 122.75, 0.60, 0.10, 0.68, 0xe6e9ed, { cast: false });
    addBox(x, 1.02, 123.02, 0.66, 0.70, 0.16, 0x9aa0a8, { cast: false });
    addBox(x, 1.18, 122.92, 0.44, 0.10, 0.34, 0xd7dce2, { cast: false });
  }
  dormSanitary(-34.4); dormSanitary(-31.6);
  addBox(-35.55, 1.05, 122.75, 0.08, 2.10, 2.0, 0xc7ccd2, { cast: false });
  addBox(-30.45, 1.05, 122.75, 0.08, 2.10, 2.0, 0xc7ccd2, { cast: false });
  addBox(-33.0, 0.035, 112.0, 2.2, 0.02, 10.2, 0xd7dde2, { cast: false }); // clear circulation spine

  // ============================================================
  //  LOWER-YARD FITTINGS — hoop, weights, pull-up rig, bleachers
  // ============================================================
  // basketball hoop on the painted court
  addBox(-11, 2.0, 84.4, 0.2, 4.0, 0.2, 0x6b7480, { solid: true }); // 4m pole
  addBox(-11, 3.6, 85.0, 1.6, 0.12, 0.9, 0xff7a1a, { cast: false });
  addBox(-11, 3.95, 84.6, 1.4, 0.7, 0.08, 0xffffff, { cast: false });
  // weight benches + plates
  // PRISON_PROP_USE_V1: THE EXERCISE YARD HAD NO PROGRAM. The pad was already
  // solid but nothing could ever be ON it — lower-yard measured `used: 0`, the
  // only room in the compound that did. A weight bench is a bench: it gets a
  // propuse seat anchor at the pad's REAL top (centre 0.45 + half of 0.16 =
  // 0.53), declared, never the kind table's guess. And the loaded bar is 60 kg
  // of free weight resting in the J-hooks, so it is a pushable rather than
  // three boxes welded to the sky — the same call world/yardfurniture.js:130
  // already makes for the north yard's bench, plate tree and chalk bucket.
  function weightBench(x, z) {
    addBox(x, 0.45, z, 0.7, 0.16, 2.2, 0x3a3f47, { solid: true });
    const bar = addBox(x, 1.1, z - 1.3, 1.9, 0.12, 0.12, 0x2a2f38, { cast: false });
    const pl = [
      addBox(x - 0.85, 1.1, z - 1.3, 0.16, 0.5, 0.5, 0x1a1a1a, { cast: false }),
      addBox(x + 0.85, 1.1, z - 1.3, 0.16, 0.5, 0.5, 0x1a1a1a, { cast: false }),
    ];
    if (!USE) return;
    // yaw 0 looks +z; the bar is at z-1.3, so PI faces the lifter up the bench.
    if (CBZ.roomSeatAnchor)
      CBZ.roomSeatAnchor(x, 0, z + 0.3, Math.PI, "bench", null, { cushion: 0.53, floorBelow: 0 });
    if (CBZ.pushProp) CBZ.pushProp({
      parts: [bar].concat(pl), x: x, z: z - 1.3, hx: 1.0, hz: 0.26, y1: 1.35,
      mass: 60, kind: "barbell", leash: 3.0, mode: "escape",
    });
  }
  weightBench(8, 100); weightBench(11, 106);
  // pull-up / dip rig. The 9 m crossbar stays non-solid ON PURPOSE: it is the
  // member the two solid uprights carry, 2.7 m up, and nothing that walks can
  // reach it — the same exemption this file's NO-DECOY SWEEP note already
  // names for overhead slabs and for bedding lying on a solid frame.
  addBox(4, 1.4, 110, 0.16, 2.8, 0.16, 0x515a66, { solid: true });
  addBox(13, 1.4, 110, 0.16, 2.8, 0.16, 0x515a66, { solid: true });
  addBox(8.5, 2.7, 110, 9.0, 0.16, 0.16, 0x6b7480, { cast: false });
  // tiered bleachers along the west edge of the infield.
  // PRISON_PROP_USE_V1: they were three CONCENTRIC slabs on one centreline
  // (2.2 wide, 14/12/10 deep, all at x=-17) with only the bottom one solid —
  // a wedding cake you walked into the top two tiers of and could not sit on
  // any of. Three real STEPPED tiers now, rising away from the half-court,
  // inside the SAME x[-18.1,-15.9] footprint this file's own institutional
  // note measures the laundry wayfinding leg against — so that note still
  // holds. Every tier is solid; every tier seats four, facing +x at the court.
  if (USE) {
    for (let i = 0; i < 3; i++) {
      const bx = -16.27 - i * 0.73, top = 0.45 + i * 0.45;
      addBox(bx, top / 2, 96, 0.73, top, 14, 0x6e7682, { solid: true });
      for (const dz of [-5.0, -1.7, 1.7, 5.0])
        if (CBZ.roomSeatAnchor)
          CBZ.roomSeatAnchor(bx, 0, 96 + dz, Math.PI / 2, "bench", null, { cushion: top, floorBelow: 0 });
    }
  } else {
    for (let i = 0; i < 3; i++) addBox(-17, 0.4 + i * 0.5, 96, 2.2, 0.4, 14 - i * 2, 0x6e7682, { solid: i === 0 });
  }

  // ============================================================
  //  SALLY PORT — checkpoint flanking the gate, guard hut, transport
  // ============================================================
  // The checkpoint pillars, the red boom and the jersey barriers that stood
  // here until 2026-09-05 are gone: the exit is a building now
  // (world/sallyport.js — a fenced walkway into a vestibule with a barred
  // grille on the wall line), and nothing a prison does not have stands in
  // front of it.
  // guard hut (small roofed booth)
  roomShell({ x0: -22, x1: -14, z0: 116, z1: 124, h: 3.2, wall: 0x515a66, floor: 0x3c424d, door: { side: "E", center: 120, width: 2.2 } });
  addBox(-18, 3.4, 120, 8.4, 0.4, 8.4, 0x44505a, { cast: false }); // roof
  addBox(-18, 1.7, 116.1, 3.0, 0.9, 0.08, 0x9fd6ff, { emissive: 0x3a6ea5, ei: 0.4, cast: false });
  // a parked transport bus (big prop) on the east side
  (function bus() {
    const bx = 16, bz = 120;
    addBox(bx, 1.5, bz, 4.6, 2.2, 9.0, 0x2b3a67, { solid: true });   // body
    addBox(bx, 2.9, bz, 4.2, 0.6, 8.6, 0x223057, { cast: false });   // roof
    for (let i = -3; i <= 3; i++) addBox(bx - 2.32, 1.8, bz + i * 1.2, 0.06, 0.7, 0.8, 0x0a0d18, { cast: false }); // windows
    addBox(bx, 0.45, bz - 3.2, 1.0, 0.9, 0.5, 0x14181f, { cast: false }); // front wheel
    addBox(bx, 0.45, bz + 3.2, 1.0, 0.9, 0.5, 0x14181f, { cast: false }); // rear wheel
    addBox(bx - 2.34, 1.4, bz + 4.2, 0.06, 0.5, 0.3, 0xffd451, { emissive: 0x6a5510, ei: 0.5, cast: false }); // headlight
  })();

  // ---- service waste belongs at the workshop, not across circulation ----
  function dumpster(x, z) {
    addBox(x, 0.7, z, 3.0, 1.3, 1.7, 0x2f6b3a, { solid: true });
    addBox(x, 1.45, z, 3.1, 0.2, 1.8, 0x274f2c, { cast: false });
  }
  dumpster(-21, 64);

  // ---- a few cigarette packs to reward exploring the new wing ----
  if (CBZ.addPack) {
    CBZ.addPack(-37, 76, 6);   // workshop
    CBZ.addPack(31, 64, 5);    // chapel pews
    CBZ.addPack(30, 100, 6);   // infirmary
    CBZ.addPack(-31, 99, 5);   // laundry
    CBZ.addPack(8, 106, 7);    // weights
    CBZ.addPack(16, 120, 8);   // by the transport bus
  }

  // ========================================================================
  //  INSTITUTIONAL TEXTURE  (PRISON_DRESS_V2)
  // ========================================================================
  // The south block had four good ROOMS standing in a very empty yard: 88 x 76
  // metres of apron with a hoop, some weights and nothing that says a
  // government runs this place. What follows is the layer every institution
  // accumulates and no generated one has — paint on the deck, wear at shoulder
  // height, pipework under the wall head, caged light, fire kit, and a chow
  // pad you can actually sit at.
  //
  // GEOMETRY IT IS BUILT AGAINST — measured, not guessed:
  //   perimeter inner faces  x = -43.5 / +43.5, south z = 127.5 (gate gap x +/-4)
  //   central path slab      x[-4.5,4.5], z 52..128
  //   half-court             x[-19,-3]  z[85,107]      bleachers x[-18.1,-15.9] z[89,103]
  //   workshop  x[-42,-24] z[58,80]  door E z[66.9,71.1]
  //   chapel    x[ 24, 42] z[58,80]  door W z[66.9,71.1]
  //   infirmary x[ 26, 42] z[88,104] door W z[94,98]
  //   laundry   x[-42,-26] z[88,104] door E z[94,98]
  //   sally port pillars (+/-6.5,118), boom y=3.4, barriers (+/-10,124)
  //   guard hut x[-22,-14] z[116,124] door E z[118.9,121.1]
  // ROUTES HELD: the 9 m central path is never built on (only painted), every
  // door lane above stays clear by >= 1.2 m, and the exit gap x[-4,4] at
  // z=128 keeps both its width and its approach.
  if (DRESS && PD) (function institutional() {
    const WX = 43.5, SZ1 = 127.5;                 // perimeter inner faces

    // ---- 1. WAYFINDING PAINT ---------------------------------------------
    // Prisons and hospitals route people with COLOURED LINES ON THE DECK, and
    // a line on the deck is the only wayfinding a third-person camera can read
    // at this scale. Each trunk peels off at the z of the door it serves, so
    // the paint is a map of the block rather than decoration.
    const GATE = 0xe8c33c, MED = 0x4fbf7a, WORK = 0x3f7fd0, CHAP = 0x9a7ad0, LAUN = 0xd8d2c4;
    PD.floorLine(-0.6, 89, 70, "z", GATE);          // trunk: the gate, z 54..124
    PD.floorLine(-1.6, 75, 42, "z", MED);           // trunk: medical, z 54..96
    PD.floorLine(11.9, 96, 27, "x", MED, { y: 0.047 });   // branch east to the infirmary door
    PD.floorLine(-1.1, 61.5, 15, "z", WORK);        // trunk: workshop, z 54..69
    PD.floorLine(-12.3, 69, 22.4, "x", WORK, { y: 0.047 }); // branch west to the workshop door
    PD.floorLine(11.4, 69.6, 24.1, "x", CHAP, { y: 0.047 }); // branch east to the chapel door
    // the laundry gets a DOOR LEG only: a full branch at this z would run
    // under the bleachers (x -18.1..-15.9) and across the painted half-court,
    // i.e. a line you cannot see for half its length.
    PD.floorLine(-22.6, 96.6, 6.2, "x", LAUN, { y: 0.047 });
    PD.chevron(-0.6, 112, "z", 1, GATE);
    PD.chevron(-0.6, 84, "z", 1, GATE);
    PD.chevron(18, 96, "x", 1, MED);
    PD.chevron(-18, 69, "x", -1, WORK);
    // The same colours carried onto the wall each line ends at, so a lane and
    // a doorway are the same idea in two places. Each x is the wall's YARD
    // face plus a hair — a roomShell wall is 0.5 thick and centred on the rect
    // edge, so the yard face is edge -/+ 0.25 and getting the sign wrong hides
    // the stripe inside the concrete.
    // Each band sits BESIDE its doorway, never across it: a roomShell door gap
    // is a full-height hole in the wall, so a stripe centred on the door
    // centreline would hang in the opening with nothing behind it.
    PD.band(-23.72, 1.55, 73.2, 3.6, "z", WORK);    // workshop east face (yard side x > -23.75)
    PD.band(23.72, 1.55, 73.2, 3.6, "z", CHAP);     // chapel west face   (yard side x <  23.75)
    PD.band(25.72, 1.55, 100.2, 3.4, "z", MED);     // infirmary west face
    PD.band(-25.72, 1.55, 100.2, 3.4, "z", LAUN);   // laundry east face

    // ---- 2. PERIMETER WEAR ------------------------------------------------
    // A 76 m concrete wall with one red trim line on top is a boundary; the
    // same wall with a scuffed hand-height band is somewhere people have been
    // walked past ten thousand times.
    PD.scuff(-WX + 0.04, 1.4, 90, 74, "z", { color: 0x7a828c, h: 0.12 });
    PD.scuff(WX - 0.04, 1.4, 90, 74, "z", { color: 0x7a828c, h: 0.12 });
    PD.band(-WX + 0.04, 0.55, 90, 74, "z", 0x8a929c, { h: 0.5 });     // kerb wash
    PD.band(WX - 0.04, 0.55, 90, 74, "z", 0x8a929c, { h: 0.5 });
    for (const s of [-1, 1]) {                                        // south wall, each side of the gate
      PD.scuff(s * 23.75, 1.4, SZ1 - 0.04, 39.5, "x", { color: 0x7a828c, h: 0.12 });
    }

    // ---- 3. THE ROOMS -----------------------------------------------------
    // One table, four rooms. Each row is the shell rect, the wall the yard
    // sees, and where its door lane is — so nothing below is a hand-typed
    // coordinate that can drift away from the shell it belongs to.
    //   [id, x0,x1,z0,z1, wallTop, doorSide, doorCenter, doorWidth, signY]
    const ROOMS = [
      ["workshop", -42, -24, 58, 80, 6, "E", 69, 4.2, 5.4],
      ["chapel", 24, 42, 58, 80, 6.5, "W", 69, 4.2, 5.8],
      ["infirmary", 26, 42, 88, 104, 6, "W", 96, 4.0, 5.4],
      ["laundry", -42, -26, 88, 104, 6, "E", 96, 4.0, 5.4],
    ];
    for (const R of ROOMS) {
      const x0 = R[1] + 0.25, x1 = R[2] - 0.25, z0 = R[3] + 0.25, z1 = R[4] - 0.25;  // inner faces
      const h = R[5], side = R[6], dc = R[7], dw = R[8], signY = R[9];
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, dz = z1 - z0;
      const east = side === "E";
      const wallX = east ? R[2] : R[1];                     // the wall the door is in
      const inX = east ? x1 : x0;                           // its inner face
      const outX = east ? R[2] + 0.25 : R[1] - 0.25;        // its outer (yard) face
      const dirIn = east ? -1 : 1;                          // into the room from that wall

      // A DOORWAY NEEDS A HEAD. roomShell splits its wall floor-to-top for the
      // gap, so every door in this block is a 6 m slot. One box makes it an
      // opening, with 3.1 m of clearance — nothing that walks is near it.
      // It stops UNDER the existing sign band (a 0.2 m-deep box at the wall
      // centreline): run the head to the wall top instead and it swallows the
      // sign whole, which is how you lose four signs in one line.
      const headTop = signY - 0.45;
      addBox(wallX, (3.1 + headTop) / 2, dc, 0.5, headTop - 3.1, dw,
        R[0] === "chapel" ? 0xbfb6a4 : 0x7c8590, { cast: false });
      addBox(outX + (east ? 0.07 : -0.07), 3.02, dc, 0.14, 0.16, dw + 0.2, 0x5b6470, { cast: false }); // drip nose, tight under the head
      // a hooded light over the door, outside — 2 meshes, and it is the thing
      // that makes a doorway read as an entrance at night
      addBox(outX + (east ? 0.16 : -0.16), 3.25, dc, 0.32, 0.14, 0.7, 0x3c424d, { cast: false });
      addBox(outX + (east ? 0.16 : -0.16), 3.13, dc, 0.24, 0.1, 0.5, 0xffe9a8,
        { emissive: 0xffcf66, ei: 0.8, cast: false });

      // interior wear: the dado + scuff on the long wall opposite the door,
      // which is the wall you look at from the doorway.
      const farX = east ? x0 : x1;
      PD.dado(farX + (east ? 0.03 : -0.03), 0.5, cz, dz, "z", 0x6f7a86);
      PD.scuff(farX + (east ? 0.03 : -0.03), 1.32, cz, dz, "z", { color: 0x59616b });
      // service run under the wall head, with hangers — the chapel is exempt:
      // a nave does not have exposed conduit, and that difference is what
      // makes the other three read as working rooms.
      if (R[0] !== "chapel") {
        PD.pipe(inX + dirIn * 0.45, h - 0.85, cz, dz - 1.2, "z", 0.09, 0x6f7a86);
        for (const t of [-0.3, 0.3]) PD.hanger(inX + dirIn * 0.45, h - 0.76, cz + t * dz, 0.5);
      }
      // one caged lamp inside, on the door wall so it lights the room you enter
      PD.lamp(inX + dirIn * 0.06, 3.6, dc + (dw / 2 + 1.4), east ? "x-" : "x+");
    }

    // ---- 4. FIRE KIT ------------------------------------------------------
    // Red is the only colour in this block that is not a warning stripe, so
    // it has to be earned: a cabinet where a hose really would be racked
    // (the workshop, which contains the only open flame in the compound) and
    // extinguishers where a fire would start.
    PD.hoseCab(-24.6, 1.6, 73.2, "x-");                 // workshop, inside the door wall
    PD.extinguisher(-24.55, 1.1, 64.4, "x-");           // workshop, by the forge end
    PD.extinguisher(-26.6, 1.1, 92.6, "x-");            // laundry (dryers)
    PD.extinguisher(26.6, 1.1, 100.4, "x+");            // infirmary

    // ---- 5. THE CHOW PAD --------------------------------------------------
    // Bolted round tables on a poured pad, south-east of the path and clear of
    // the chapel's door lane (which starts at z 66.9). This is where the yard
    // eats when the hall is full, and it is the one place in 6,700 m2 of apron
    // with a reason to stand still. Seats register with city/propuse.js at
    // their real cushion height, so bodies can be sat here with no new code.
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(9, 6.5),
      new THREE.MeshLambertMaterial({ color: 0x6a7078 }));
    pad.rotation.x = -Math.PI / 2; pad.position.set(18, 0.028, 60.6); pad.receiveShadow = true;
    scene.add(pad);
    PD.roundTable(15.6, 59.6, { seatTone: 0x3a6ea5 });
    PD.roundTable(20.4, 59.6, { seatTone: 0x2f6b3a, spin: 1.2 });
    addBox(15.6, 0.815, 59.6, 0.5, 0.06, 0.36, 0xffd451, { cast: false });   // a left tray
    // a lidded bin at the pad edge (the yard's only bussing point)
    (function bin() {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.34, 1.0, 10), CBZ.cmat(0x2f6b3a));
      b.position.set(21.8, 0.5, 62.0); b.castShadow = true; b.receiveShadow = true; scene.add(b);
      addBox(21.8, 1.03, 62.0, 0.82, 0.08, 0.82, 0x274f2c, { cast: false });
      if (CBZ.colliders) CBZ.colliders.push({ minX: 21.42, maxX: 22.18, minZ: 61.62, maxZ: 62.38, ref: b });
    })();

    // ---- 6. THE SALLY PORT ------------------------------------------------
    // The last thing between you and the gate should look like it was built to
    // stop a vehicle, not like two posts and a stick.
    PD.floorLine(0, 112.4, 9, "x", 0xe8e2d2, { w: 0.3, y: 0.05 });            // stop line at the walkway mouth
    // The rules board on the guard hut's yard face — the last words you read.
    // SOUTH of the hut's own doorway (z 118.9..121.1), not across it.
    addBox(-13.70, 2.3, 117.2, 0.08, 1.3, 1.8, 0x6a563c, { cast: false });
    addBox(-13.645, 2.3, 117.2, 0.03, 1.14, 1.64, 0x3f4a3c, { cast: false });
    for (const n of [[2.72, 116.7, 0.42, 0.32], [2.7, 117.7, 0.4, 0.28],
    [2.18, 116.9, 0.38, 0.42]])
      PD.paper(-13.61, n[0], n[1], "x+", n[2], n[3], {});
    // Caged lamps at the gate and the hut. Every plate sits FLUSH on a real
    // face: the hut's east wall face is -13.75 and the pillars' inner faces
    // are +/-6.0, and the hut lamp ducks under its own 3.2-3.6 m roof slab.
    PD.lamp(-13.69, 2.9, 122.4, "x+");
  })();

  // The facade pass (world/building_dress.js) dresses whatever registers here.
  if (PD && PD.shell) {
    // `face` = the elevation the yard actually looks at. `quiet` = do not punch
    // windows: the chapel already has authored stained-glass slits, and a
    // barred window is the wrong idea for a nave.
    PD.shell({ id: "workshop", x0: -42, x1: -24, z0: 58, z1: 80, h: 6, door: "E", dc: 69, dw: 4.2, tone: 0x7c8590, face: "E" });
    PD.shell({ id: "chapel", x0: 24, x1: 42, z0: 58, z1: 80, h: 6.5, door: "W", dc: 69, dw: 4.2, tone: 0xbfb6a4, face: "W", quiet: true });
    PD.shell({ id: "infirmary", x0: 26, x1: 42, z0: 88, z1: 104, h: 6, door: "W", dc: 96, dw: 4.0, tone: 0xd7dde2, face: "W" });
    PD.shell({ id: "laundry", x0: -42, x1: -26, z0: 88, z1: 104, h: 6, door: "E", dc: 96, dw: 4.0, tone: 0x8a929c, face: "E" });
    PD.shell({ id: "south-dorm", x0: -42, x1: -24, z0: 106, z1: 124, h: 6, door: "N", dc: -33, dw: 3.4, tone: 0x76818c, face: "N", quiet: true });
  }
})();
