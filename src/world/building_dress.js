/* ============================================================
   world/building_dress.js — VERTICAL CLUTTER ON THE EXISTING CITY
   (layer 5 of 5).

   city/buildings.js owns the buildings; this pass never rebuilds one.
   It reads the finished lot records (CBZ.city.arena.lots → lot.building
   = the makeBuilding return: group/w/d/h/storeys/door/floorTops) and
   glues onto them the layer every real building accumulates and no
   procedural one has:

     ROOF  — packaged HVAC units, condenser banks, mushroom vents, duct
             runs, a timber-legged water tank, satellite dishes and
             aerials. A skyline of bare boxes is the single loudest
             "generated" signal in the game; roof plant fixes it from
             every window and every helicopter.
     WALL  — downpipes from gutter to ground with a cast shoe, window AC
             units dripping onto the storey below, shop awnings, rolled
             security shutters, wall-mounted lamps beside doorways, fire
             escapes zig-zagging down the blind elevations, and enamel
             house-number plates by the front door.
     GRIME — the staining that makes a facade look weathered: streaks
             below every window sill, runs under the roof edge, and dark
             trails down the wall beside each downpipe.

   DRAW-CALL BUDGET
     hvac 1 · condenser 1 · vent 1 · duct 1 · water tank 1 · dish 1 ·
     aerial 1 · downpipe 1 · pipe shoe 1 · window AC 1 · awning 1 ·
     shutter 1 · wall lamp 1 · fire escape 1 · house numbers 1 (shares
     the street-furniture sign atlas) · wall grime 1  =  16 draws.

   Everything is an InstancedMesh or a merged sheet, so those 16 draws
   cover thousands of individual fittings. Nothing here registers a
   collider: none of it is reachable, and a collider on a rooftop vent
   would only trip up the helicopter landing logic.

   Flag: CBZ.CONFIG.DETAIL_BUILDING_DRESS.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.detailKit) return;
  const THREE = window.THREE;
  const DK = CBZ.detailKit;

  const METAL = 0x9aa1a5, METAL_D = 0x767c80, RUST = 0x8a6a4e, PAINT = 0xb6bcbd;

  // =====================================================================
  //  WALL-GRIME TEXTURE — one soft streak, reused everywhere
  // =====================================================================
  // Deterministic by arithmetic (the world/materials.js concreteTex idiom),
  // never Math.random: the same seed must produce the same world on every
  // client, and that includes anything baked at build time.
  let _grimeTex = null;
  function grimeTex() {
    if (_grimeTex) return _grimeTex;
    const W = 64, H = 256;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    g.clearRect(0, 0, W, H);
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const v = y / (H - 1);                       // 0 at top (source), 1 at bottom
      // runs are strongest just under the source and fade as they spread
      const fall = Math.max(0, 1 - Math.pow(v, 0.72));
      for (let x = 0; x < W; x++) {
        const u = x / (W - 1);
        // three fixed harmonics give the vertical streaking; the *53/*97
        // integer walk adds grain without a PRNG
        const streak =
          0.55 + 0.26 * Math.sin(u * 17.3 + 1.1) + 0.15 * Math.sin(u * 41.7 - 0.4)
          + 0.10 * Math.sin(u * 7.1 + v * 3.0);
        const grain = (((x * 53 + y * 97) % 128) / 128) * 0.16;
        const edge = Math.min(1, Math.min(u, 1 - u) * 5.5);   // fade the sides out
        let a = fall * Math.max(0, streak - 0.34) * edge * (0.82 + grain);
        a = Math.max(0, Math.min(1, a));
        const q = (y * W + x) * 4;
        const dark = 52 + 26 * (1 - a);
        img.data[q] = dark; img.data[q + 1] = dark * 0.98; img.data[q + 2] = dark * 0.9;
        img.data[q + 3] = (a * 168) | 0;
      }
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    _grimeTex = t;
    return t;
  }

  // =====================================================================
  //  PROTOTYPES — roof
  // =====================================================================
  function hvacProto() {
    const p = DK.proto();
    p.box(2.3, 1.05, 1.7, PAINT, 0, 0.53, 0);
    p.box(2.36, 0.09, 1.76, METAL_D, 0, 1.08, 0);            // lid
    p.cyl(0.52, 0.52, 0.17, 7, METAL_D, -0.55, 1.2, 0);      // fan cowl
    p.cyl(0.46, 0.46, 0.05, 7, 0x4d5257, -0.55, 1.3, 0);     // fan grille
    for (let i = 0; i < 3; i++) p.box(0.06, 0.62, 0.05, 0x3d4145, 0.35 + i * 0.27, 0.55, 0.86);  // condenser fins
    p.box(0.9, 0.7, 0.03, 0x5b6165, 0.62, 0.55, 0.862);
    p.box(2.5, 0.14, 1.34, 0x6c6f6b, 0, 0.07, 0);            // sleeper raft
    p.box(0.16, 0.8, 0.16, METAL, 1.0, 1.2, 0.5);            // refrigerant riser
    return p.done();
  }
  function condenserProto() {
    const p = DK.proto();
    p.box(1.05, 0.9, 1.05, 0xa9afb1, 0, 0.45, 0);
    p.cyl(0.4, 0.4, 0.08, 7, 0x4d5257, 0, 0.92, 0);
    p.box(1.1, 0.05, 0.05, 0x71767a, 0, 0.9, 0.5);
    p.box(1.15, 0.1, 0.16, 0x6c6f6b, 0, 0.05, 0);
    return p.done();
  }
  function ventProto() {
    const p = DK.proto();
    p.cyl(0.16, 0.19, 0.5, 6, METAL, 0, 0.25, 0);
    p.cyl(0.3, 0.24, 0.16, 6, METAL_D, 0, 0.56, 0);          // mushroom cap
    return p.done();
  }
  function ductProto() {
    const p = DK.proto();
    p.box(0.62, 0.5, 3.2, 0xb4b9ba, 0, 0.62, 0);
    for (let i = -1; i <= 1; i++) p.box(0.68, 0.56, 0.06, 0x92989a, 0, 0.62, i * 1.1);  // flanges
    p.box(0.12, 0.44, 0.12, 0x7c8083, -0.2, 0.19, -1.2);     // stand legs
    p.box(0.12, 0.44, 0.12, 0x7c8083, -0.2, 0.19, 1.2);
    p.box(0.12, 0.44, 0.12, 0x7c8083, 0.2, 0.19, -1.2);
    p.box(0.12, 0.44, 0.12, 0x7c8083, 0.2, 0.19, 1.2);
    return p.done();
  }
  function tankProto() {
    // The classic timber-slat water tank: instantly legible, and it breaks the
    // flat roofline better than anything else this cheap.
    const p = DK.proto();
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      p.box(0.16, 2.6, 0.16, 0x6a563c, Math.cos(a) * 0.9, 1.3, Math.sin(a) * 0.9);
    }
    p.box(2.3, 0.14, 2.3, 0x5b492f, 0, 2.6, 0);              // deck
    p.cyl(1.05, 1.0, 2.5, 10, 0x8a6f49, 0, 3.9, 0);          // staves
    for (let i = 0; i < 2; i++) p.cyl(1.07, 1.07, 0.07, 10, 0x4a3d2b, 0, 3.3 + i * 1.1, 0);  // hoops
    p.cone(1.1, 0.7, 10, 0x6f5a3b, 0, 5.5, 0);               // conical lid
    p.box(0.1, 2.4, 0.1, METAL_D, 1.0, 1.3, 0.34);           // downpipe from the tank
    for (let i = 0; i < 4; i++) p.box(0.5, 0.05, 0.05, METAL_D, 1.02, 0.6 + i * 0.7, 0);     // ladder rungs
    return p.done();
  }
  function dishProto() {
    const p = DK.proto();
    p.cyl(0.62, 0.1, 0.14, 10, 0xd6d8d2, 0, 0.5, 0.16, -1.05, 0, 0);   // the bowl, tipped up
    p.box(0.06, 0.5, 0.06, METAL_D, 0, 0.5, -0.1, -1.05, 0, 0);        // feed arm
    p.box(0.11, 0.11, 0.11, 0x3b3f42, 0, 0.72, -0.34);                  // LNB
    p.cyl(0.06, 0.07, 0.62, 5, METAL_D, 0, 0.31, 0);                    // mast
    p.box(0.34, 0.06, 0.34, 0x6c6f6b, 0, 0.03, 0);                      // base plate
    return p.done();
  }
  function aerialProto() {
    const p = DK.proto();
    p.box(0.05, 3.0, 0.05, METAL_D, 0, 1.5, 0);
    for (let i = 0; i < 4; i++) p.box(1.1 - i * 0.2, 0.028, 0.028, METAL, 0, 1.5 + i * 0.36, 0);
    p.box(0.05, 0.5, 0.05, METAL_D, 0, 0.25, 0.2, 0.5, 0, 0);           // guy strut
    p.box(0.3, 0.05, 0.3, 0x6c6f6b, 0, 0.03, 0);
    return p.done();
  }

  // =====================================================================
  //  PROTOTYPES — wall
  // =====================================================================
  function pipeProto() {
    // a 1m unit scaled to the building's height; brackets are deliberately
    // NOT modelled here so the scale never stretches them out of shape
    const p = DK.proto();
    p.cyl(0.075, 0.075, 1.0, 7, 0x8b8f8c, 0, 0.5, 0);
    return p.done();
  }
  function pipeShoeProto() {
    const p = DK.proto();
    p.cyl(0.085, 0.1, 0.42, 6, 0x7c817e, 0, 0.21, 0);
    p.cyl(0.085, 0.11, 0.3, 6, 0x7c817e, 0, 0.5, 0.16, 0.85, 0, 0);     // the elbow out to the gutter
    p.box(0.24, 0.06, 0.06, 0x63676a, 0, 1.35, -0.06);                   // a bracket at head height
    return p.done();
  }
  function windowAcProto() {
    const p = DK.proto();
    p.box(0.72, 0.42, 0.5, 0xc3c7c2, 0, 0, 0.2);
    p.box(0.66, 0.34, 0.03, 0x585d60, 0, 0, 0.46);                       // grille
    for (let i = 0; i < 3; i++) p.box(0.6, 0.02, 0.035, 0x8b9094, 0, -0.1 + i * 0.1, 0.47);
    p.box(0.78, 0.05, 0.1, 0x9aa0a2, 0, -0.24, 0.06);                    // sill bracket
    return p.done();
  }
  function awningProto() {
    // canvas awning projecting along +z; the pass yaws it to the door face
    const p = DK.proto();
    p.box(3.2, 0.06, 1.55, 0x9c3b34, 0, 0.3, 0.78, -0.32, 0, 0);         // sloped canvas
    p.box(3.2, 0.34, 0.05, 0x8a322c, 0, 0.06, 1.5);                      // valance
    for (let s = -1; s <= 1; s += 2) {
      p.box(0.05, 0.05, 1.6, 0x5d6062, s * 1.5, 0.34, 0.78, -0.32, 0, 0);   // frame rails
      p.box(0.04, 0.9, 0.04, 0x5d6062, s * 1.5, 0.28, 0.34, 0.8, 0, 0);     // tie rods
    }
    p.box(3.3, 0.09, 0.09, 0x4f5254, 0, 0.62, 0.06);                     // wall channel
    return p.done();
  }
  function shutterProto() {
    const p = DK.proto();
    p.cyl(0.24, 0.24, 3.0, 7, 0x8d9294, 0, 0, 0.16, 0, 0, Math.PI / 2);  // rolled curtain
    p.box(3.2, 0.1, 0.34, 0x6f7477, 0, 0.28, 0.14);                      // hood
    for (let s = -1; s <= 1; s += 2) p.box(0.11, 2.6, 0.11, 0x7c8184, s * 1.6, -1.35, 0.1);   // guide rails
    return p.done();
  }
  function wallLampProto() {
    const p = DK.proto();
    p.box(0.09, 0.09, 0.34, 0x4a4e50, 0, 0, 0.17);
    p.cone(0.19, 0.24, 6, 0xc9ccc6, 0, -0.06, 0.36, Math.PI, 0, 0);      // downlit shade
    p.box(0.15, 0.12, 0.15, 0xfff0c8, 0, -0.17, 0.36);                   // the lamp itself
    return p.done();
  }
  function fireEscapeProto() {
    // One storey of a New-York-style escape: grated platform, railings and
    // the diagonal ladder down to the level below. This is the single most
    // expensive prototype in the pass (it is instanced PER STOREY), so the
    // grating and rungs are held to the minimum that still reads as steel.
    const p = DK.proto();
    const G = 0x4e4a44, R = 0x585149;
    p.box(2.6, 0.06, 1.25, G, 0, 0, 0.62);                               // platform
    for (let i = 0; i < 4; i++) p.box(2.6, 0.03, 0.04, 0x3d3a35, 0, 0.04, 0.2 + i * 0.3);   // grating
    p.box(2.6, 0.05, 0.05, R, 0, 1.0, 1.22);                             // outer rail
    p.box(2.6, 0.05, 0.05, R, 0, 0.55, 1.22);
    for (let s = -1; s <= 1; s += 2) {
      p.box(0.05, 1.0, 0.05, R, s * 1.28, 0.5, 1.22);                     // stanchions
      p.box(0.05, 0.05, 1.2, R, s * 1.28, 1.0, 0.64);                     // side rails
    }
    // the ladder run
    p.box(0.06, 2.6, 0.06, R, -0.9, -1.2, 1.0, -0.62, 0, 0);
    p.box(0.06, 2.6, 0.06, R, -0.35, -1.2, 1.0, -0.62, 0, 0);
    for (let i = 0; i < 5; i++) p.box(0.6, 0.04, 0.04, R, -0.62, -0.35 - i * 0.58, 0.3 + i * 0.3);
    // brackets back into the wall
    p.box(0.07, 0.07, 0.5, R, -1.1, -0.1, 0.25, 0.6, 0, 0);
    p.box(0.07, 0.07, 0.5, R, 1.1, -0.1, 0.25, 0.6, 0, 0);
    return p.done();
  }

  // =====================================================================
  //  THE PASS
  // =====================================================================
  DK.register(40, "building-dress", function (city, DK) {
    if (CBZ.CONFIG.DETAIL_BUILDING_DRESS === false) return;
    const root = city.root;
    /* ==================================================================
       PROPS_PURGE_V1 — WHAT CAME OFF THE BUILDINGS, AND WHY.
       ==================================================================
       OWNER: "DUMB AC BOXES OUTSIDE WINDOWS ... AND DUMB THINGS ON ROOFS
       OF BUILDINGS, GET RID OF THE DUMB PROPS."

       THE HISTORY IS THE ARGUMENT. city/props.js used to scatter exactly
       this kit and DELETED it — its own surviving comment reads "Generic
       AC/vent/tank/dish/mast clutter was pure silhouette noise and has
       been removed. Keep only fall-prevention rails and the rare rentable
       ad: both have a direct gameplay reason to exist." It even preserved
       the rng draws so the removal was reversible. Then THIS pass, four
       files later, put the whole thing back and made it denser. That is
       the exact failure mode CLAUDE.md's block law exists to stop, and it
       is why the census below is written down rather than just done.

       CUT OUTRIGHT
         • WINDOW AC UNITS — up to 260 of them, six per elevation, hung on
           a hash off a wall with no window behind them (this pass does not
           read the facade; buildings.js owns the glazing, and nothing here
           asks it where a window is). A box bolted to blank concrete is
           the owner's screenshot. The DRIP STAIN that went with each one
           goes too — a stain under nothing is worse than the unit.
         • SATELLITE DISHES + AERIAL MASTS — laid on the same lattice at a
           hashed yaw, so a dish pointed at a different sky on every roof
           and an aerial stood in the middle of nowhere guyed to nothing.
           A dish has an azimuth or it is a prop.
         • DUCT RUNS — a 3.2m duct on legs with no plant at either end.

       KEPT, AND MADE INTENTIONAL
         • ROOF PLANT is now a DECK, not a scatter: one contiguous
           mechanical run inset from ONE parapet — chiller, its condensers
           beside it, its vents at the end — on buildings big enough to
           need plant (>=9m either way, >=2 storeys) instead of on every
           shed with a 6m footprint. A lattice of eleven unrelated boxes
           reads generated; four related ones on one deck reads built.
         • THE WATER TANK keeps its rule unchanged (low/mid-rise, one
           corner) — it was already the most legible thing on the skyline.
         • Downpipes, fire escapes, awnings, shutters, wall lamps, house
           numbers and the roofline/sill weathering all stay: every one of
           them is anchored to something the building actually has.
       ================================================================== */
    const PURGED = !CBZ.CONFIG || CBZ.CONFIG.PROPS_PURGE_V1 !== false;
    let cutN = 0;

    const hvac = DK.batch("roof-hvac", hvacProto(), { cls: "decor", cast: true });
    const cond = DK.batch("roof-condenser", condenserProto(), { cls: "decor", cast: true });
    const vents = DK.batch("roof-vent", ventProto(), { cls: "fine", cast: false });
    const ducts = DK.batch("roof-duct", ductProto(), { cls: "decor", cast: true });
    const tanks = DK.batch("water-tank", tankProto(), { cls: "decor", cast: true });
    const dishes = DK.batch("sat-dish", dishProto(), { cls: "fine", cast: false });
    const aerials = DK.batch("aerial", aerialProto(), { cls: "fine", cast: false });
    const pipes = DK.batch("downpipe", pipeProto(), { cls: "decor", cast: false });
    const shoes = DK.batch("downpipe-shoe", pipeShoeProto(), { cls: "decor", cast: false });
    const acs = DK.batch("window-ac", windowAcProto(), { cls: "decor", cast: false });
    const awnings = DK.batch("awning", awningProto(), { cls: "decor", cast: true });
    const shutters = DK.batch("shutter", shutterProto(), { cls: "fine", cast: false });
    const escapes = DK.batch("fire-escape", fireEscapeProto(), { cls: "decor", cast: false });
    // vertexColors on, same reason as world/utility_lines.js's mast lamp: the
    // prototype carries its part colours in the geometry, not the material.
    const lampM = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, emissive: 0xffe0b0, emissiveIntensity: 0 });
    lampM._shared = true;
    const wlamps = DK.batch("wall-lamp", wallLampProto(), { cls: "decor", cast: false, material: lampM });
    const grime = DK.sheet("wall-grime", { cls: "fine", unlit: true, map: grimeTex() });
    const atlas = DK.signAtlas ? DK.signAtlas() : null;
    const nums = atlas ? DK.sheet("house-number", { cls: "fine", map: atlas, alphaTest: 0.45, unlit: true }) : null;
    const AC = DK.signAtlasCells || { NUM_0: 24, NUM_N: 24 };
    const AGRID = DK.signAtlasGrid || 8;

    // running caps so one enormous settlement can't eat the whole budget
    let nHvac = 0, nCond = 0, nVent = 0, nDuct = 0, nTank = 0, nDish = 0, nAerial = 0,
      nPipe = 0, nAc = 0, nAwn = 0, nShut = 0, nEsc = 0, nLamp = 0, nGrime = 0, nNum = 0;
    // VERTEX BUDGET. These caps are the real cost control: an InstancedMesh
    // submits count × prototype-verts every frame, and the roof/facade layer
    // touches every building in the world, so it is the heaviest of the five
    // passes by far. Caps are consumed in DK.eachBuilding's HASH-SHUFFLED
    // order, so a cap that binds thins the layer evenly across the map
    // instead of dressing the first N buildings and abandoning the rest.
    const MAX = {
      hvac: DK.count(170), cond: DK.count(180), vent: DK.count(300), duct: DK.count(95),
      tank: DK.count(55), dish: DK.count(150), aerial: DK.count(120), pipe: DK.count(240),
      ac: DK.count(260), awn: DK.count(140), shut: DK.count(100), esc: DK.count(100),
      lamp: DK.count(260), grime: DK.count(950), num: DK.count(240),
    };

    // Elevator/stair shafts punch through the roof (buildings.js publishes
    // b.shaftRects); dropping a two-tonne chiller on the hatch would look
    // broken and could block the roof-access gameplay that already exists.
    function onShaft(b, lx, lz) {
      const sr = b.shaftRects;
      if (!sr || !sr.length) return false;
      for (let i = 0; i < sr.length; i++) {
        const r = sr[i];
        if (!r) continue;
        const x0 = r.minX != null ? r.minX : (r.x - (r.w || 0) / 2);
        const x1 = r.maxX != null ? r.maxX : (r.x + (r.w || 0) / 2);
        const z0 = r.minZ != null ? r.minZ : (r.z - (r.d || 0) / 2);
        const z1 = r.maxZ != null ? r.maxZ : (r.z + (r.d || 0) / 2);
        if (!Number.isFinite(x0)) continue;
        if (lx > x0 - 1.2 && lx < x1 + 1.2 && lz > z0 - 1.2 && lz < z1 + 1.2) return true;
      }
      return false;
    }

    DK.eachBuilding(city, function (bi) {
      const b = bi.b;
      const rx = bi.w / 2, rz = bi.d / 2;
      const roofY = bi.roofY + 0.04;
      const bh = DK.h01(bi.x, bi.z, 0x8101);
      // PER-BUILDING quotas on top of the global caps. Without these a single
      // 40m×40m tower could eat the entire rooftop budget on its own lattice
      // and every other roof in the city would come out bare.
      let roofHere = 0, acHere = 0, grimeHere = 0, escHere = 0;
      const ROOF_PER = 11, AC_PER = 6, GRIME_PER = 7, ESC_PER = 5;

      // =================================================================
      //  ROOF PLANT
      // =================================================================
      // Laid on a coarse lattice inset from the parapet, skipping the middle
      // (where hatches, helipads and city/roofloot.js's own content live) and
      // any published shaft rect. Everything is position-hashed, so a given
      // roof always gets the same kit.
      if (PURGED) {
        // ---- THE PLANT DECK ------------------------------------------
        // A real roof's mechanical plant sits together, on one side, set
        // back from the parapet, with a walkway around it — because a
        // fitter has to reach it and a crane had to land it. So: pick a
        // side from the position hash, run the chiller down it with its
        // condensers beside it and its vents at the end, and leave the
        // rest of the roof EMPTY. Everything is still position-hashed, so
        // a given roof always gets the same deck.
        if (bi.w >= 9 && bi.d >= 9 && bi.storeys >= 2 && nHvac < MAX.hvac) {
          const INSET = 2.6;
          let side = (DK.h01(bi.x, bi.z, 0x8118) * 4) | 0;
          // (ex,ez) = the OUTWARD normal of the chosen parapet; the deck
          // sits INSET inside it and runs along the tangent.
          let ex = 0, ez = 0, half = 0, run = 0;
          for (let attempt = 0; attempt < 4; attempt++) {
            const s = (side + attempt) & 3;
            ex = s === 2 ? -1 : (s === 3 ? 1 : 0);
            ez = s === 0 ? -1 : (s === 1 ? 1 : 0);
            half = ex ? rx : rz;                    // depth toward that parapet
            run = ex ? bi.d : bi.w;                 // length along it
            const dx = ex * (half - INSET), dz = ez * (half - INSET);
            if (!onShaft(b, dx, dz)) { side = s; break; }
            if (attempt === 3) { half = 0; }        // every side blocked — no deck
          }
          // AVAIL is the usable half-length along that parapet, and it is what
          // decides how much deck this roof gets — NOT a per-building fudge.
          // A 9m roof fits the chiller alone; a 16m one fits the whole run.
          // Every item is admitted only if its own half-width still lands
          // inside AVAIL, so nothing can ever hang off a parapet edge (the
          // failure the lattice above could not have, and which is exactly
          // what a "floating roof prop" screenshot looks like).
          const avail = run / 2 - INSET;
          if (half > 0 && avail > 1.3) {
            const tx = -ez, tz = ex;                // along the parapet
            const cx0 = ex * (half - INSET), cz0 = ez * (half - INSET);
            // a deterministic slide so not every deck is dead-centre
            const slide = DK.h11(bi.z, bi.x, 0x8119) * Math.max(0, avail - 3.9);
            const fits = function (t, hw) { return Math.abs(slide + t) + hw <= avail; };
            // local +z points at the parapet, so the chiller's long axis
            // (its 2.3m x) runs ALONG the deck by construction
            const yaw = Math.atan2(ex, ez);
            const put = function (t, off) {
              return {
                x: bi.x + cx0 + tx * (slide + t) - ex * (off || 0),
                z: bi.z + cz0 + tz * (slide + t) - ez * (off || 0),
              };
            };
            if (fits(0, 1.25)) {
              const P0 = put(0, 0);
              hvac.add(P0.x, roofY, P0.z, { ry: yaw, tint: 0.9 + DK.h01(bi.x, bi.z, 0x8111) * 0.6 });
              nHvac++; roofHere++;
              // 2.3 x 1.7 x 1.05 of chiller on a walkable deck. Same y-gate as
              // the tank below: solid between the deck and its own top, nothing
              // at street level. Extents are the yawed box's, not the raw one.
              {
                const ec = Math.abs(Math.cos(yaw)), es = Math.abs(Math.sin(yaw));
                DK.solid(P0.x, P0.z, 1.15 * ec + 0.85 * es, 1.15 * es + 0.85 * ec,
                  null, roofY, roofY + 1.35);
              }
              // condensers in a row beside the chiller — the same machine
              const conds = 1 + (DK.h01(bi.x, bi.z, 0x811a) < 0.55 ? 1 : 0);
              for (let k = 0; k < conds && nCond < MAX.cond; k++) {
                const t = 2.05 + k * 1.25;
                if (!fits(t, 0.58)) break;
                const P = put(t, 0);
                cond.add(P.x, roofY, P.z, { ry: yaw }); nCond++; roofHere++;
              }
              // and its flues at the other end of the deck
              const vN = 1 + (DK.h01(bi.z, bi.x, 0x811b) < 0.5 ? 1 : 0);
              for (let k = 0; k < vN && nVent < MAX.vent; k++) {
                const t = -1.9 - k * 0.85;
                if (!fits(t, 0.32)) break;
                const P = put(t, k * 0.6);
                vents.add(P.x, roofY, P.z, { ry: yaw, sy: k ? 0.8 : 1 }); nVent++; roofHere++;
              }
            }
          }
        }
      } else if (bi.w > 6 && bi.d > 6) {
        const inset = 2.1;
        const gx = Math.max(1, Math.floor((bi.w - inset * 2) / 3.4));
        const gz = Math.max(1, Math.floor((bi.d - inset * 2) / 3.4));
        for (let a = 0; a < gx && roofHere < ROOF_PER; a++) {
          for (let c = 0; c < gz && roofHere < ROOF_PER; c++) {
            const lx = -rx + inset + (a + 0.5) * ((bi.w - inset * 2) / gx);
            const lz = -rz + inset + (c + 0.5) * ((bi.d - inset * 2) / gz);
            // keep the middle of the roof clear
            if (Math.abs(lx) < rx * 0.22 && Math.abs(lz) < rz * 0.22) continue;
            if (onShaft(b, lx, lz)) continue;
            const wx = bi.x + lx, wz = bi.z + lz;
            const h = DK.h01(wx, wz, 0x8111);
            const yaw = (((DK.h01(wz, wx, 0x8112) * 4) | 0) * Math.PI) / 2;
            if (h < 0.17 && nHvac < MAX.hvac) {
              hvac.add(wx, roofY, wz, { ry: yaw, tint: 0.9 + h * 0.6 }); nHvac++; roofHere++;
            } else if (h < 0.34 && nCond < MAX.cond) {
              cond.add(wx, roofY, wz, { ry: yaw }); nCond++; roofHere++;
              if (h < 0.24 && nCond < MAX.cond) { cond.add(wx + 1.25, roofY, wz, { ry: yaw }); nCond++; }
            } else if (h < 0.42 && nDuct < MAX.duct) {
              ducts.add(wx, roofY, wz, { ry: yaw, sz: 0.8 + h }); nDuct++; roofHere++;
            } else if (h < 0.62 && nVent < MAX.vent) {
              vents.add(wx, roofY, wz, { ry: yaw }); nVent++; roofHere++;
              if (nVent < MAX.vent) { vents.add(wx + 0.7, roofY, wz + 0.5, { ry: yaw, sy: 0.8 }); nVent++; }
            } else if (h < 0.70 && nDish < MAX.dish) {
              dishes.add(wx, roofY, wz, { ry: DK.h01(wx, wz, 0x8113) * 6.28, sx: 0.8 + h * 0.5, sy: 0.8 + h * 0.5, sz: 0.8 + h * 0.5 });
              nDish++; roofHere++;
            } else if (h < 0.745 && nAerial < MAX.aerial) {
              aerials.add(wx, roofY, wz, { ry: DK.h01(wz, wx, 0x8114) * 6.28 }); nAerial++; roofHere++;
            }
          }
        }
      }
      // A TIMBER WATER TANK on the low/mid-rise stock, in one corner. Hoisted
      // OUT of the lattice branch so it survives the purge unchanged: it was
      // never the problem — it is the one rooftop object in this pass that a
      // player can name from the street, and it is one per roof by rule, in a
      // corner, on exactly the building stock that really carries them.
      if (bi.w > 6 && bi.d > 6 && bi.storeys >= 3 && bi.storeys <= 14 && bh < 0.30 && nTank < MAX.tank) {
        const sxg = DK.h01(bi.x, bi.z, 0x8115) < 0.5 ? -1 : 1;
        const szg = DK.h01(bi.z, bi.x, 0x8116) < 0.5 ? -1 : 1;
        const wx = bi.x + sxg * (rx - 2.6), wz = bi.z + szg * (rz - 2.6);
        if (!onShaft(b, wx - bi.x, wz - bi.z)) {
          tanks.add(wx, roofY, wz, { ry: DK.h01(wx, wz, 0x8117) * 1.57 }); nTank++;
          // SOLID, AND HEIGHT-GATED — this is the whole trick for roof plant.
          // Roofs in this game are real walkable platforms (elevators land on
          // them, roofloot sends you up), so a 5.5 m timber tank with no
          // collider is a thing you walk clean through while standing on the
          // building it sits on. But a FULL-HEIGHT AABB here would be a 2.2 m
          // invisible column running all the way down to the PAVEMENT, which
          // is a far worse bug than the one it fixes. y0/y1 (physics.js:133)
          // makes the collider exist only between the deck and the tank's own
          // top, so the street below is untouched.
          DK.solid(wx, wz, 1.15, 1.15, null, roofY, roofY + 5.5);
        }
      }

      // =================================================================
      //  FACADE
      // =================================================================
      const faces = DK.buildingFaces(bi);
      for (let f = 0; f < faces.length; f++) {
        const fc = faces[f];
        const isDoor = DK.isDoorFace(bi, fc);
        const tx = -fc.nz, tz = fc.nx;                     // tangent along the wall
        const yaw = Math.atan2(fc.nx, fc.nz);              // local +z → outward
        const wallX = fc.cx + fc.nx * 0.06, wallZ = fc.cz + fc.nz * 0.06;
        const fh = DK.h01(fc.cx, fc.cz, 0x8121);

        // ---- downpipes at both ends of every elevation -----------------
        if (nPipe < MAX.pipe && fc.span > 4 && (f === 0 || f === 2)) {
          for (let s = -1; s <= 1; s += 2) {
            if (nPipe >= MAX.pipe) break;
            const px = wallX + tx * s * (fc.span / 2 - 0.55);
            const pz = wallZ + tz * s * (fc.span / 2 - 0.55);
            const len = Math.max(2.5, bi.h - 0.35);
            pipes.add(px, bi.y0 + 0.3, pz, { sy: len });
            shoes.add(px, bi.y0, pz, { ry: yaw });
            nPipe++;
            // and the stain the pipe has been making for thirty years
            if (nGrime < MAX.grime && grimeHere < GRIME_PER) {
              grimeHere++;
              grime.quadWall(px + fc.nx * 0.02, bi.y0 + Math.min(6, bi.h) * 0.5, pz + fc.nz * 0.02,
                0.9, Math.min(6.5, bi.h * 0.75), fc.nx, fc.nz, 0xffffff, DK.atlasCell(0, 1));
              nGrime++;
            }
          }
        }

        // ---- fire escape on a blind elevation of a mid-rise ------------
        if (!isDoor && nEsc < MAX.esc && bi.storeys >= 3 && bi.storeys <= 12
          && fc.span > 6 && fh < 0.34) {
          const ex = wallX + tx * (fc.span * 0.18), ez = wallZ + tz * (fc.span * 0.18);
          const top = Math.min(bi.storeys, 8);
          for (let s = 1; s < top && nEsc < MAX.esc && escHere < ESC_PER; s++) {
            escapes.add(ex, bi.y0 + s * 3.2 + 0.15, ez, { ry: yaw });
            nEsc++; escHere++;
          }
        }

        // ---- window AC units, floor by floor ---------------------------
        // PURGED. The loop still RUNS under the flag so the census can report
        // how many boxes came off the city's walls, but it places nothing and
        // its drip stains go with it — a drip stain under no unit is a smear
        // on a blank wall, which is worse than the unit was.
        if (nAc < MAX.ac && acHere < AC_PER && bi.storeys >= 2) {
          const cols = Math.max(1, Math.floor(fc.span / 2.6));
          const rows = Math.min(bi.storeys - 1, 8);
          for (let r2 = 1; r2 <= rows && nAc < MAX.ac && acHere < AC_PER; r2++) {
            for (let c2 = 0; c2 < cols && nAc < MAX.ac && acHere < AC_PER; c2++) {
              const t = -fc.span / 2 + (c2 + 0.5) * (fc.span / cols);
              const ax = wallX + tx * t, az = wallZ + tz * t;
              const ay = bi.y0 + r2 * 3.2 + 1.15;
              if (DK.h01(ax + r2 * 7.3, az - r2 * 3.1, 0x8131) > 0.16) continue;
              if (PURGED) { cutN++; acHere++; continue; }
              acs.add(ax, ay, az, { ry: yaw });
              nAc++; acHere++;
              if (nGrime < MAX.grime && grimeHere < GRIME_PER) {
                // the drip stain the unit leaves down the wall beneath it
                grime.quadWall(ax + fc.nx * 0.02, ay - 1.25, az + fc.nz * 0.02,
                  0.6, 2.0, fc.nx, fc.nz, 0xffffff, DK.atlasCell(0, 1));
                nGrime++; grimeHere++;
              }
            }
          }
        }

        // ---- sill staining: a run under every storey band ---------------
        if (nGrime < MAX.grime && grimeHere < GRIME_PER && bi.storeys >= 2) {
          const bands = Math.min(bi.storeys, 6);
          const cols2 = Math.max(1, Math.floor(fc.span / 4.2));
          for (let r2 = 1; r2 <= bands && nGrime < MAX.grime && grimeHere < GRIME_PER; r2++) {
            for (let c2 = 0; c2 < cols2 && nGrime < MAX.grime && grimeHere < GRIME_PER; c2++) {
              const t = -fc.span / 2 + (c2 + 0.5) * (fc.span / cols2);
              const sx = fc.cx + fc.nx * 0.05 + tx * t, sz = fc.cz + fc.nz * 0.05 + tz * t;
              if (DK.h01(sx + r2 * 11.7, sz + r2 * 5.3, 0x8141) > 0.36) continue;
              grime.quadWall(sx, bi.y0 + r2 * 3.2 - 0.55, sz, 2.5, 1.9, fc.nx, fc.nz, 0xffffff, DK.atlasCell(0, 1));
              nGrime++; grimeHere++;
            }
          }
        }
        // ---- one long run under the roof edge --------------------------
        // A single wide quad per elevation buys the most weathering per
        // vertex of anything in the pass — the roofline is where every
        // building in the world is dirtiest.
        if (nGrime < MAX.grime && fh < 0.62) {
          grime.quadWall(fc.cx + fc.nx * 0.05, bi.roofY - Math.min(4.5, bi.h * 0.28), fc.cz + fc.nz * 0.05,
            Math.min(fc.span - 0.6, 12), Math.min(5.0, bi.h * 0.4), fc.nx, fc.nz, 0xffffff, DK.atlasCell(0, 1));
          nGrime++;
        }

        // ---- the shopfront kit, on the door elevation only -------------
        if (isDoor && bi.door) {
          const dx = bi.door.x, dz = bi.door.z;
          // sit the fittings on the wall plane directly above the doorway
          const ox = fc.cx + fc.nx * 0.08 + tx * ((dx - fc.cx) * tx + (dz - fc.cz) * tz);
          const oz = fc.cz + fc.nz * 0.08 + tz * ((dx - fc.cx) * tx + (dz - fc.cz) * tz);
          if (bi.shop && nAwn < MAX.awn && DK.h01(ox, oz, 0x8151) < 0.62) {
            awnings.add(ox, bi.y0 + 3.05, oz, { ry: yaw, sx: 0.85 + DK.h01(oz, ox, 0x8152) * 0.4 });
            nAwn++;
          } else if (bi.shop && nShut < MAX.shut) {
            shutters.add(ox, bi.y0 + 3.3, oz, { ry: yaw });
            nShut++;
          }
          if (nLamp < MAX.lamp) {
            for (let s = -1; s <= 1; s += 2) {
              if (nLamp >= MAX.lamp) break;
              wlamps.add(ox + tx * s * 1.5, bi.y0 + 2.85, oz + tz * s * 1.5, { ry: yaw });
              nLamp++;
            }
          }
          // ---- enamel house number beside the door ---------------------
          if (nums && nNum < MAX.num) {
            const cell = AC.NUM_0 + (((DK.h01(ox, oz, 0x8161) * AC.NUM_N) | 0) % AC.NUM_N);
            nums.quadWall(ox + tx * 1.15 + fc.nx * 0.02, bi.y0 + 2.35, oz + tz * 1.15 + fc.nz * 0.02,
              0.34, 0.34, fc.nx, fc.nz, 0xffffff, DK.atlasCell(cell, AGRID));
            nNum++;
          }
        }
      }
    });

    hvac.build(root); cond.build(root); vents.build(root); ducts.build(root);
    tanks.build(root); dishes.build(root); aerials.build(root);
    pipes.build(root); shoes.build(root); acs.build(root);
    awnings.build(root); shutters.build(root); escapes.build(root);
    const lampMesh = wlamps.build(root);
    grime.build(root);
    if (nums) nums.build(root);

    // Same trick utility_lines.js uses: join city/props.js's existing dusk
    // driver (city._nightLamps, walked every frame at props.js:2115) instead
    // of standing up a second lighting loop.
    if (lampMesh && city._nightLamps) { try { city._nightLamps.push(lampMesh); } catch (e) { /* driver absent */ } }

    // hand the census to city/props.js's ratchet (CBZ.propPurgeAudit).
    // acBoxes is the pinned one and it is STRUCTURALLY 0 under the flag;
    // roofItems is printed beside it so a future pass cannot re-grow the
    // skyline clutter without the number saying so.
    if (CBZ.propPurgeCensus) {
      CBZ.propPurgeCensus({
        acBoxes: nAc,
        roofItems: nHvac + nCond + nVent + nDuct + nTank + nDish + nAerial,
        acRemoved: cutN,
      });
    }
  });

  // =====================================================================
  //  THE PRISON FACADE PASS  (PRISON_DRESS_V2)
  // =====================================================================
  // The city pass above dresses city/buildings.js's lots. The PRISON is a
  // different world — a handful of hand-raised roomShell boxes under
  // CBZ.prisonRoot — and from inside the yard those boxes are 6 m of blank
  // render with a coloured sign band on them. Same disease, same cure, so it
  // lives in the same file: the elevation you stare at while you walk the
  // yard gets the layer a real building has.
  //
  // IT DRESSES ONLY WHAT REGISTERS. CBZ.prisonShells is pushed by the rooms
  // that own themselves (cafeteria, lounge, and the south block's four), so
  // nothing here reaches into a shell another file owns — no cell block, no
  // armory, no guard hut. A room opts in with one line.
  //
  // TIMING: this runs at PARSE, not inside a DK pass. index.html parses the
  // prison at :383-:450 and this file at :1408, so every shell already exists
  // and core/batch.js (:1413, fires on `load`) still merges the result.
  //
  // WIRE: none. world/razorwire.js owns every coil in the compound and crowns
  // the PERIMETER on purpose — a 6 m room roof inside the wire is not a
  // climbing risk, so wiring it would be decoration pretending to be security.
  // What these roofs get instead is the thing they were actually missing: a
  // coping band, so the top of the wall reads as an edge.
  (function prisonFacade() {
    const CFG = CBZ.CONFIG || {};
    if (CFG.PRISON_DRESS_V2 === false) return;
    const shells = CBZ.prisonShells;
    const PD = CBZ.prisonDress;
    if (!shells || !shells.length || !PD || !CBZ.addBox) return;
    const addBox = CBZ.addBox;
    let nWin = 0, nPipe = 0, nBand = 0;

    for (let i = 0; i < shells.length; i++) {
      const s = shells[i];
      if (!s || !s.face) continue;
      const f = s.face;
      const xAxis = (f === "E" || f === "W");
      const sign = (f === "E" || f === "S") ? 1 : -1;          // outward direction
      // the wall's centreline, its OUTER face (walls are 0.5 thick, centred on
      // the rect edge), and the span of the elevation along its own axis
      const edge = f === "E" ? s.x1 : f === "W" ? s.x0 : f === "S" ? s.z1 : s.z0;
      const out = edge + sign * 0.25;
      const a0 = xAxis ? s.z0 : s.x0, a1 = xAxis ? s.z1 : s.x1;
      const span = a1 - a0, mid = (a0 + a1) / 2;
      const h = s.h || 6;
      const tone = s.tone != null ? s.tone : 0x8a929c;
      // is `p` inside this elevation's door gap (plus a reveal either side)?
      const isDoorFace = s.door === f;
      const clearOfDoor = function (p, half) {
        if (!isDoorFace || s.dc == null) return true;
        return Math.abs(p - s.dc) > (s.dw || 3.4) / 2 + half + 0.7;
      };
      const at = function (p, offset, w, hgt, thick, color, opts) {
        // one call places a box on this elevation without the caller ever
        // knowing which axis it is on
        return xAxis
          ? addBox(out + sign * offset, hgt, p, thick, opts.h, w, color, opts)
          : addBox(p, hgt, out + sign * offset, w, opts.h, thick, color, opts);
      };

      // ---- COPING: the drip edge along the top of the elevation -----------
      // One box, and it is the highest-value line in the pass: it is what
      // stops a wall and a sky meeting at a hard unshaded corner.
      at(mid, 0.06, span + 0.5, h - 0.16, 0.22, 0x6f7a86, { h: 0.22, cast: false });
      nBand++;

      // ---- BARRED WINDOWS: a rhythm, not a scatter ------------------------
      // Institutions repeat a bay. Count comes from the span, positions are
      // symmetric about the centre, and any bay that lands on the doorway is
      // simply not built — the rhythm survives the gap, which is exactly how
      // a real elevation handles its entrance.
      if (!s.quiet) {
        const bays = Math.max(2, Math.min(4, Math.floor(span / 5.0)));
        const step = span / (bays + 1);
        const wy = h * 0.6;
        for (let b = 1; b <= bays; b++) {
          const p = a0 + b * step;
          if (!clearOfDoor(p, 0.7)) continue;
          at(p, 0.05, 1.32, wy, 0.14, 0x161a20, { h: 1.14, cast: false });      // reveal
          for (const k of [-1, 1])                                               // bars, proud of the reveal
            at(p + k * 0.28, 0.16, 0.075, wy, 0.075, 0x2a2f38, { h: 1.06, cast: false });
          at(p, 0.1, 1.5, wy - 0.66, 0.2, 0xa8b0b8, { h: 0.1, cast: false });     // sill
          nWin++;
        }
      }

      // ---- DOWNPIPE at the yard-side corner of the elevation --------------
      // Rainwater has to come off a roof somewhere. Placed at the corner
      // furthest from the door so it never lands in a doorway reveal.
      const corner = (isDoorFace && s.dc != null && s.dc > mid) ? a0 + 0.45 : a1 - 0.45;
      const px = xAxis ? out + sign * 0.16 : corner;
      const pz = xAxis ? corner : out + sign * 0.16;
      PD.pipe(px, (h - 0.3) / 2 + 0.15, pz, h - 0.3, "y", 0.075, 0x8b8f8c);
      addBox(px + (xAxis ? sign * 0.06 : 0), 0.24, pz + (xAxis ? 0 : sign * 0.06),
        xAxis ? 0.26 : 0.2, 0.34, xAxis ? 0.2 : 0.26, 0x7c817e, { cast: false });  // shoe
      nPipe++;
    }

    // Census, printed the way the city pass prints its own — an audit nobody
    // has executed is not a measurement (CLAUDE.md), so it is at least
    // countable from the console the first time somebody looks.
    CBZ.prisonFacadeAudit = function () {
      return { shells: shells.length, windows: nWin, downpipes: nPipe, copings: nBand };
    };
  })();
})();
