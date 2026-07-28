/* ============================================================
   world/street_furniture.js — SIGNS, BOLLARDS, ALLEY JUNK (layer 3 of 5).

   city/props.js already owns the "shop-adjacent" furniture: hydrants,
   mailboxes, bins, meters, newsboxes, cones, planters, patio sets, bike
   RACKS, bus shelters, billboards. This pass deliberately does NOT
   duplicate any of those. It adds the layer underneath them — the stuff
   nobody designs but every street has:

     • REGULATORY SIGNAGE on real posts, drawn from one shared canvas
       ATLAS so every sign face in the world is a single textured draw:
       stop signs at unsignalised junctions, street-name blades at the
       signalised ones, no-parking / tow-away / one-way plates down the
       kerbs, and house numbers beside front doors.
     • Bollards guarding plaza corners and shopfronts.
     • Kerb-inlet storm drains where gutter water would actually go.
     • Alley life at the BACK of buildings: dumpsters, bagged trash,
       stacked pallets, crates, and site barriers.
     • Chained bikes leaning on poles and railings.
     • The fine grain: kerbside litter and weeds in the joints. This is
       the first thing to go on a weak GPU and the first thing you miss
       on a strong one.

   DRAW-CALL BUDGET
     sign posts 1 · sign faces 1 (atlas) · bollards 1 · storm drains 1 ·
     dumpsters 1 · trash bags 1 · pallets 1 · crates 1 · barriers 1 ·
     bikes 1 · litter 1 · weeds 1  =  12 draws (+3 shadow casters).

   Determinism: positions and every variant choice come from
   CBZ.hash01 — no rng draws, so no sibling module's stream is shifted.
   Flag: CBZ.CONFIG.DETAIL_STREET_FURNITURE.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.detailKit) return;
  const THREE = window.THREE;
  const DK = CBZ.detailKit;

  // =====================================================================
  //  THE SIGN ATLAS — every sign face in the world, one 1024² canvas
  // =====================================================================
  // Textured materials are excluded from every merge path in core/batch.js
  // (batch.js:171), so handing a texture to a widely-used material would blow
  // the draw budget. One atlas + one merged quad sheet sidesteps that: all
  // signage in the city is ONE textured draw, forever.
  const GRID = 8, CELL = 128, ATLAS_PX = GRID * CELL;
  // cell map
  const C_STOP = 0, C_STOP_BACK = 1, C_NOPARK = 2, C_RECT_BACK = 3, C_ONEWAY = 4,
    C_DNE = 5, C_CIRC_BACK = 6, C_SPEED = 7, C_PARK = 48, C_TOW = 49, C_FIRELANE = 50,
    C_YIELD = 51, C_TRI_BACK = 52, C_BUS = 53, C_HYDRANT = 54, C_BLADE_BACK = 55;
  const NAME_0 = 8, NAME_N = 16;      // cells 8..23  — street-name blades
  const NUM_0 = 24, NUM_N = 24;       // cells 24..47 — house-number plates

  // Deterministic by construction: a fixed authored table, indexed by a
  // position hash. Nothing here is random at build time.
  const ST_NAMES = [
    "MERIDIAN AVE", "HOLLOW ST", "CANAL ST", "8TH AVE", "PORTSIDE RD", "KESTREL ST",
    "LOW BANK RD", "ASHGROVE AVE", "3RD ST", "MARLOWE ST", "CINDER LN", "HARBOR AVE",
    "VERDE ST", "OLD MILL RD", "TENTH AVE", "BRINE ST",
  ];

  let _atlas = null;
  function signAtlas() {
    if (_atlas) return _atlas;
    const cv = document.createElement("canvas");
    cv.width = cv.height = ATLAS_PX;
    const g = cv.getContext("2d");
    g.clearRect(0, 0, ATLAS_PX, ATLAS_PX);
    g.textAlign = "center";
    g.textBaseline = "middle";

    function cell(i) { return { x: (i % GRID) * CELL, y: ((i / GRID) | 0) * CELL }; }
    function poly(i, n, rot, r, fill, stroke, sw) {
      const c = cell(i), cx = c.x + CELL / 2, cy = c.y + CELL / 2;
      g.beginPath();
      for (let k = 0; k < n; k++) {
        const a = rot + k * Math.PI * 2 / n;
        const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
        if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath();
      if (fill) { g.fillStyle = fill; g.fill(); }
      if (stroke) { g.strokeStyle = stroke; g.lineWidth = sw || 5; g.stroke(); }
    }
    function rect(i, pad, fill, stroke, sw, rw, rh) {
      const c = cell(i);
      const w = (rw || CELL) - pad * 2, h = (rh || CELL) - pad * 2;
      const x = c.x + (CELL - w) / 2, y = c.y + (CELL - h) / 2;
      if (fill) { g.fillStyle = fill; g.fillRect(x, y, w, h); }
      if (stroke) { g.strokeStyle = stroke; g.lineWidth = sw || 4; g.strokeRect(x + 2, y + 2, w - 4, h - 4); }
      return { x: x, y: y, w: w, h: h };
    }
    function text(i, str, size, color, dy, maxW) {
      const c = cell(i);
      g.fillStyle = color;
      g.font = "bold " + size + "px Helvetica, Arial, sans-serif";
      g.fillText(str, c.x + CELL / 2, c.y + CELL / 2 + (dy || 0), maxW || CELL - 12);
    }

    // --- STOP (regulation octagon) ---------------------------------------
    poly(C_STOP, 8, Math.PI / 8, 58, "#b4231e", "#f2f2ee", 6);
    text(C_STOP, "STOP", 40, "#f6f6f2", 2);
    poly(C_STOP_BACK, 8, Math.PI / 8, 58, "#9aa0a2", "#7d8385", 5);
    // --- rectangular regulatory plates -----------------------------------
    rect(C_NOPARK, 12, "#f4f4ef", "#22262b", 4, 84, 118);
    (function () {
      const c = cell(C_NOPARK), cx = c.x + CELL / 2, cy = c.y + 46;
      g.beginPath(); g.arc(cx, cy, 26, 0, Math.PI * 2);
      g.strokeStyle = "#c02a24"; g.lineWidth = 8; g.stroke();
      g.beginPath(); g.moveTo(cx - 19, cy + 19); g.lineTo(cx + 19, cy - 19); g.stroke();
      g.fillStyle = "#22262b"; g.font = "bold 30px Helvetica, Arial, sans-serif";
      g.fillText("P", cx, cy + 1);
      g.font = "bold 15px Helvetica, Arial, sans-serif";
      g.fillText("NO PARKING", cx, c.y + 92, 78);
      g.fillText("ANY TIME", cx, c.y + 108, 78);
    })();
    rect(C_RECT_BACK, 12, "#9aa0a2", "#7d8385", 4, 84, 118);
    rect(C_ONEWAY, 16, "#1a1d21", null, 0, 110, 46);
    (function () {
      const c = cell(C_ONEWAY), cy = c.y + CELL / 2;
      g.fillStyle = "#f4f4ef";
      g.beginPath();
      g.moveTo(c.x + 24, cy); g.lineTo(c.x + 44, cy - 12); g.lineTo(c.x + 44, cy - 4);
      g.lineTo(c.x + 100, cy - 4); g.lineTo(c.x + 100, cy + 4); g.lineTo(c.x + 44, cy + 4);
      g.lineTo(c.x + 44, cy + 12); g.closePath(); g.fill();
      g.font = "bold 13px Helvetica, Arial, sans-serif";
      g.fillText("ONE WAY", c.x + CELL / 2, cy + 20, 90);
    })();
    poly(C_DNE, 40, 0, 56, "#b4231e", "#f2f2ee", 5);
    (function () { const c = cell(C_DNE); g.fillStyle = "#f4f4ef"; g.fillRect(c.x + 22, c.y + 56, 84, 17); })();
    poly(C_CIRC_BACK, 40, 0, 56, "#9aa0a2", "#7d8385", 5);
    rect(C_SPEED, 12, "#f4f4ef", "#22262b", 4, 84, 118);
    text(C_SPEED, "SPEED", 16, "#22262b", -34, 70);
    text(C_SPEED, "LIMIT", 16, "#22262b", -16, 70);
    text(C_SPEED, "30", 46, "#22262b", 22, 70);
    rect(C_PARK, 14, "#1b4f8f", "#f4f4ef", 4, 82, 100);
    text(C_PARK, "P", 62, "#f4f4ef", 2);
    rect(C_TOW, 12, "#f4f4ef", "#c02a24", 5, 88, 112);
    text(C_TOW, "TOW", 22, "#c02a24", -26, 76);
    text(C_TOW, "AWAY", 22, "#c02a24", -2, 76);
    text(C_TOW, "ZONE", 22, "#c02a24", 22, 76);
    rect(C_FIRELANE, 12, "#c02a24", "#f4f4ef", 4, 88, 96);
    text(C_FIRELANE, "FIRE", 22, "#f4f4ef", -16, 76);
    text(C_FIRELANE, "LANE", 22, "#f4f4ef", 10, 76);
    poly(C_YIELD, 3, -Math.PI / 2, 62, "#f4f4ef", "#b4231e", 12);
    text(C_YIELD, "YIELD", 20, "#b4231e", 18, 70);
    poly(C_TRI_BACK, 3, -Math.PI / 2, 62, "#9aa0a2", "#7d8385", 6);
    rect(C_BUS, 14, "#1b4f8f", "#f4f4ef", 4, 76, 100);
    text(C_BUS, "BUS", 21, "#f4f4ef", -14, 66);
    text(C_BUS, "STOP", 21, "#f4f4ef", 12, 66);
    rect(C_HYDRANT, 16, "#f4f4ef", "#c02a24", 4, 60, 88);
    text(C_HYDRANT, "NO", 17, "#c02a24", -16, 52);
    text(C_HYDRANT, "STOP", 17, "#c02a24", 4, 52);
    text(C_HYDRANT, "PING", 17, "#c02a24", 22, 52);

    // --- street-name blades (green, reflective white legend) --------------
    for (let i = 0; i < NAME_N; i++) {
      const idx = NAME_0 + i, c = cell(idx);
      g.fillStyle = "#1f5c3a"; g.fillRect(c.x + 2, c.y + 44, CELL - 4, 40);
      g.strokeStyle = "#e8ece6"; g.lineWidth = 2; g.strokeRect(c.x + 5, c.y + 47, CELL - 10, 34);
      g.fillStyle = "#f2f5ef";
      g.font = "bold 17px Helvetica, Arial, sans-serif";
      g.fillText(ST_NAMES[i % ST_NAMES.length], c.x + CELL / 2, c.y + 65, CELL - 16);
    }
    (function () { const c = cell(C_BLADE_BACK); g.fillStyle = "#8f9691"; g.fillRect(c.x + 2, c.y + 44, CELL - 4, 40); })();

    // --- house-number plates ---------------------------------------------
    for (let i = 0; i < NUM_N; i++) {
      const idx = NUM_0 + i, c = cell(idx);
      const num = 100 + i * 37 + (i % 5) * 3;      // authored spread, not random
      g.fillStyle = "#2b2e33"; g.fillRect(c.x + 30, c.y + 42, 68, 44);
      g.strokeStyle = "#c9a24a"; g.lineWidth = 2; g.strokeRect(c.x + 33, c.y + 45, 62, 38);
      g.fillStyle = "#e9dcae";
      g.font = "bold 27px Georgia, 'Times New Roman', serif";
      g.fillText(String(num), c.x + CELL / 2, c.y + 65, 58);
    }

    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = 4;
    if (THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding;   // r128 spelling
    _atlas = t;
    return t;
  }
  // Shared with world/building_dress.js (house-number plates) so the whole
  // world still has exactly ONE signage texture, hence one signage draw per
  // consuming sheet rather than one per sign.
  DK.signAtlas = signAtlas;
  DK.signAtlasGrid = GRID;
  DK.signAtlasCells = { NUM_0: NUM_0, NUM_N: NUM_N, RECT_BACK: C_RECT_BACK, NAME_0: NAME_0, NAME_N: NAME_N };

  // =====================================================================
  //  PROTOTYPES
  // =====================================================================
  const STEEL = 0x8f959a, DARK = 0x2f3338, GALV = 0xa7adb0;

  function signPostProto() {
    const p = DK.proto();
    p.cyl(0.042, 0.05, 3.0, 6, STEEL, 0, 1.5, 0);
    p.cyl(0.09, 0.11, 0.14, 8, 0x6f7478, 0, 0.07, 0);      // base collar
    return p.done();
  }
  function bollardProto() {
    // A domed cap made from a tapered cylinder rather than a sphere: a
    // 10×6 SphereGeometry is 360 verts, which on a few hundred bollards
    // would cost more than every pole in the city.
    const p = DK.proto();
    p.cyl(0.105, 0.125, 0.94, 8, 0x30343a, 0, 0.47, 0);
    p.cyl(0.055, 0.105, 0.09, 8, 0x30343a, 0, 0.98, 0);
    p.cyl(0.16, 0.18, 0.09, 8, 0x24272c, 0, 0.045, 0);     // flange
    p.box(0.22, 0.05, 0.22, 0xd8dbd4, 0, 0.72, 0);         // reflective band
    return p.done();
  }
  function drainProto() {
    // A kerb inlet: the throat cut into the kerb face plus the gutter grate.
    const p = DK.proto();
    p.box(1.15, 0.16, 0.06, 0x1a1c1f, 0, 0.1, 0.17);        // dark throat
    p.box(1.25, 0.06, 0.42, 0x3a3e42, 0, 0.035, -0.06);     // grate frame
    for (let i = -2; i <= 2; i++) p.box(0.07, 0.05, 0.34, 0x191b1e, i * 0.19, 0.05, -0.06);  // bars
    p.box(1.3, 0.2, 0.1, 0xa89e7c, 0, 0.11, 0.22);          // kerb apron either side
    return p.done();
  }
  function dumpsterProto() {
    const p = DK.proto();
    p.box(1.98, 1.12, 1.12, 0x2f6a4b, 0, 0.66, 0);
    p.box(2.04, 0.1, 1.18, 0x24523a, 0, 1.24, 0);           // rim
    p.box(0.96, 0.07, 1.14, 0x3b7a58, -0.5, 1.32, 0.02, -0.16, 0, 0);   // left lid (ajar)
    p.box(0.96, 0.07, 1.14, 0x3b7a58, 0.5, 1.29, -0.02, 0.09, 0, 0);    // right lid
    p.box(2.02, 0.16, 0.06, 0x22462f, 0, 0.9, 0.57);        // side rib
    for (let s = -1; s <= 1; s += 2) for (let t = -1; t <= 1; t += 2) {
      p.box(0.2, 0.2, 0.08, 0x1c1e21, s * 0.82, 0.11, t * 0.45);   // castors
    }
    p.box(0.5, 0.34, 0.02, 0xd9d2b4, 0.55, 0.68, 0.565);    // grubby stencil panel
    return p.done();
  }
  function bagProto() {
    // Three slumped sacks — ONE prototype, so a whole pile is one instance.
    // Sphere segments are kept at the legibility floor (5×3): a bin bag is a
    // lumpy silhouette, and at 0.3m nothing above that is visible.
    const p = DK.proto();
    p.sphere(0.3, 5, 3, 0x24262a, 0, 0.24, 0);
    p.sphere(0.25, 5, 3, 0x1e2024, 0.36, 0.2, 0.14);
    p.sphere(0.22, 5, 3, 0x2a2c31, -0.28, 0.18, -0.16);
    p.cone(0.09, 0.2, 4, 0x24262a, 0, 0.5, 0);              // knotted top
    return p.done();
  }
  function palletProto() {
    const p = DK.proto();
    for (let i = 0; i < 3; i++) p.box(1.16, 0.07, 0.14, 0xa8895e, 0, 0.035, (i - 1) * 0.34);
    for (let i = 0; i < 3; i++) p.box(0.12, 0.09, 0.9, 0x8d7049, (i - 1) * 0.48, 0.12, 0);
    for (let i = 0; i < 4; i++) p.box(1.16, 0.06, 0.11, 0xb59268, 0, 0.2, (i - 1.5) * 0.28);
    return p.done();
  }
  function crateProto() {
    const p = DK.proto();
    p.box(0.86, 0.7, 0.72, 0x9c7f56, 0, 0.35, 0);
    p.box(0.9, 0.06, 0.06, 0x7a6142, 0, 0.66, 0.36);
    p.box(0.9, 0.06, 0.06, 0x7a6142, 0, 0.06, 0.36);
    p.box(0.06, 0.7, 0.06, 0x7a6142, 0.42, 0.35, 0.36);
    p.box(0.06, 0.7, 0.06, 0x7a6142, -0.42, 0.35, 0.36);
    p.box(0.34, 0.22, 0.01, 0xd8cba8, 0, 0.4, 0.365);       // shipping label
    return p.done();
  }
  function barrierProto() {
    // The orange/white A-frame every roadworks in the world uses.
    const p = DK.proto();
    p.box(1.5, 0.2, 0.05, 0xdd6a1e, 0, 0.86, 0);
    p.box(1.5, 0.2, 0.05, 0xdd6a1e, 0, 0.5, 0);
    for (let i = -1; i <= 1; i++) p.box(0.15, 0.2, 0.055, 0xeeeae2, i * 0.46, 0.86, 0.002);
    for (let i = -1; i <= 1; i++) p.box(0.15, 0.2, 0.055, 0xeeeae2, i * 0.46 + 0.23, 0.5, 0.002);
    p.box(0.07, 1.0, 0.07, 0x9aa0a2, -0.66, 0.5, 0.14, 0.2, 0, 0);
    p.box(0.07, 1.0, 0.07, 0x9aa0a2, 0.66, 0.5, 0.14, 0.2, 0, 0);
    p.box(0.07, 1.0, 0.07, 0x9aa0a2, -0.66, 0.5, -0.14, -0.2, 0, 0);
    p.box(0.07, 1.0, 0.07, 0x9aa0a2, 0.66, 0.5, -0.14, -0.2, 0, 0);
    return p.done();
  }
  function bikeProto() {
    const p = DK.proto();
    const WH = 0x1c1e21;
    p.cyl(0.33, 0.33, 0.045, 9, WH, -0.52, 0.33, 0, 0, 0, Math.PI / 2);
    p.cyl(0.33, 0.33, 0.045, 9, WH, 0.52, 0.33, 0, 0, 0, Math.PI / 2);
    p.box(0.72, 0.045, 0.045, 0x2c6f9c, 0, 0.6, 0);          // top tube
    p.box(0.68, 0.045, 0.045, 0x2c6f9c, -0.04, 0.42, 0, 0, 0, 0.24);  // down tube
    p.box(0.045, 0.42, 0.045, 0x2c6f9c, 0.34, 0.44, 0, 0, 0, -0.3);   // seat tube
    p.box(0.045, 0.5, 0.045, 0x2c6f9c, -0.5, 0.5, 0, 0, 0, 0.14);     // fork
    p.box(0.05, 0.05, 0.42, 0x35393d, -0.5, 0.78, 0);        // handlebar
    p.box(0.2, 0.06, 0.11, 0x2a2c30, 0.36, 0.72, 0);         // saddle
    return p.done();
  }
  function litterProto() {
    // a scatter cluster: a flattened cup, a crushed can, a sheet of paper.
    // NOTE the flat sheets spin on rz, not ry: the kit composes Euler XYZ, so
    // after the -90° x-tilt it is rz that yaws a ground quad — ry would tip it
    // up on edge. (Same trap the aim-library docs warn about for cameras.)
    const p = DK.proto();
    p.cyl(0.035, 0.045, 0.11, 5, 0xd8d2c2, 0, 0.055, 0, Math.PI / 2 - 0.2, 0, 0.4);
    p.box(0.07, 0.05, 0.13, 0x9aa4ad, 0.26, 0.03, 0.14, 0, 0.9, 0);
    p.plate(0.19, 0.14, 0xe7e3d6, -0.2, 0.012, 0.1, -Math.PI / 2, 0, 0.6);
    p.plate(0.1, 0.08, 0xcfc9b8, 0.1, 0.011, -0.22, -Math.PI / 2, 0, -1.1);
    return p.done();
  }
  function weedProto() {
    // a tuft of blades leaning out of a joint — three thin tapered fins is
    // the legibility floor, and weeds are the highest-count prop in the world
    const p = DK.proto();
    for (let i = 0; i < 3; i++) {
      const a = i * 2.094;
      p.box(0.024, 0.3, 0.013, i % 2 ? 0x4e6b32 : 0x5c7a37,
        Math.cos(a) * 0.035, 0.14, Math.sin(a) * 0.035,
        Math.sin(a) * 0.5, a, Math.cos(a) * 0.5);
    }
    return p.done();
  }

  // =====================================================================
  //  THE PASS
  // =====================================================================
  DK.register(20, "street-furniture", function (city, DK) {
    if (CBZ.CONFIG.DETAIL_STREET_FURNITURE === false) return;
    const root = city.root;
    // PROPS_PURGE_V1 (city/props.js owns the flag and the ALLEY LAW). What this
    // pass stopped doing:
    //   CUT — the site BARRIER. An orange A-frame is a work zone, and there is
    //     no work: no dig, no cone taper, no plate, nothing it is guarding. It
    //     was a 1.5m SOLID standing at the back of a building — i.e. the single
    //     worst thing in this file for the owner's complaint, and the only one
    //     with neither a verb nor a reason.
    //   THINNED — pallet stacks 1-3 -> 1. A 3-high stack is 0.78m of geometry
    //     with NO collider, which is the decoy world/clutter.js's own header
    //     bans by name; one pallet is 0.26m, under physics.js's 0.45 STEP_UP,
    //     so walking over it is honest.
    //   GATED — dumpster, crate and bollard now declare their collider and
    //     half-width to CBZ.alleyOk through DK.free, so at most ONE of them can
    //     stand in any 14m of alley and only where it leaves a 2.4m run. The
    //     flat grain (litter, weeds, drains) opts OUT: a stain is not a prop
    //     and must not spend an alley's budget.
    const PURGED = !CBZ.CONFIG || CBZ.CONFIG.PROPS_PURGE_V1 !== false;
    let cutN = 0;

    const posts = DK.batch("sign-post", signPostProto(), { cls: "decor", cast: false });
    const faces = DK.sheet("sign-face", { cls: "decor", map: signAtlas(), alphaTest: 0.45, unlit: false });
    const bollards = DK.batch("bollard", bollardProto(), { cls: "solid", cast: true });
    const drains = DK.batch("storm-drain", drainProto(), { cls: "fine", cast: false });
    const dumps = DK.batch("dumpster", dumpsterProto(), { cls: "solid", cast: true });
    const bags = DK.batch("trash-bags", bagProto(), { cls: "fine", cast: false });
    const pallets = DK.batch("pallets", palletProto(), { cls: "decor", cast: false });
    const crates = DK.batch("crate", crateProto(), { cls: "decor", cast: true });
    const barriers = DK.batch("barrier", barrierProto(), { cls: "solid", cast: false });
    const bikes = DK.batch("bike", bikeProto(), { cls: "decor", cast: false });
    const litter = DK.batch("litter", litterProto(), { cls: "fine", cast: false });
    const weeds = DK.batch("weeds", weedProto(), { cls: "fine", cast: false });

    // ---- sign helper ---------------------------------------------------
    // One post instance + a front face and a matching BACK face, so walking
    // behind a sign shows a blank grey plate instead of mirrored lettering.
    function sign(x, z, nx, nz, cellFront, cellBack, w, h, mountY, postH) {
      const y = DK.groundY(x, z);
      posts.add(x, y, z, { sy: (postH || 3.0) / 3.0, ry: Math.atan2(-nx, -nz) });
      const fx = x + nx * 0.045, fz = z + nz * 0.045;
      faces.quadWall(fx, y + mountY, fz, w, h, nx, nz, 0xffffff, DK.atlasCell(cellFront, GRID));
      const bx = x - nx * 0.045, bz = z - nz * 0.045;
      faces.quadWall(bx, y + mountY, bz, w, h, -nx, -nz, 0xffffff, DK.atlasCell(cellBack, GRID));
      // SOLID. This kit's own policy line (detail_kit.js:688) says "only
      // genuinely solid things get one: poles, bollards, dumpsters, cabinets,
      // barriers" — and then every sign POLE in the world was left out, so a
      // 3 m galvanised post standing on a kerb was pass-through while the 1 m
      // bollard beside it was not. Same radius as the bollard (0.16 vs its own
      // 0.09 shaft, matching city/props.js's parking-meter treatment: a body
      // meets the post, not the paint on it).
      DK.solid(x, z, 0.14, 0.14, null);
      DK.claim(x, z);
    }

    // =====================================================================
    //  1) STOP SIGNS at unsignalised junctions
    // =====================================================================
    // Every mainland grid crossing already carries a real signal head
    // (city/props.js's makeHead), and a junction never has both. So compute
    // the geometric crossings of the ORDINARY street network and drop a stop
    // sign only where no signal exists — which in practice means the town
    // lanes, the annex back streets and the biome settlements.
    const streets = DK.streetRoads(city);
    const signalled = city.intersections || [];
    function isSignalled(x, z) {
      for (let i = 0; i < signalled.length; i++) {
        if (Math.abs(signalled[i].x - x) < 12 && Math.abs(signalled[i].z - z) < 12) return true;
      }
      return false;
    }
    const verticals = [], horizontals = [];
    for (let i = 0; i < streets.length; i++) (streets[i].vertical ? verticals : horizontals).push(streets[i]);
    let stopN = 0;
    const STOP_MAX = DK.count(90);
    for (let a = 0; a < verticals.length && stopN < STOP_MAX; a++) {
      const V = verticals[a];
      for (let b = 0; b < horizontals.length && stopN < STOP_MAX; b++) {
        const H = horizontals[b];
        const ix = V.x, iz = H.z;
        if (Math.abs(iz - V.z) > V.len / 2 || Math.abs(ix - H.x) > H.len / 2) continue;
        if (isSignalled(ix, iz)) continue;
        if (DK.h01(ix, iz, 0x4411) > 0.72) continue;      // not every junction is signed
        const halfV = (V.w != null ? V.w : (city.ROAD || 18)) / 2;
        const halfH = (H.w != null ? H.w : (city.ROAD || 18)) / 2;
        // A two-way stop on the north–south road: one sign per opposing
        // approach, each on that approach's NEAR-RIGHT corner with its face
        // turned back at the oncoming driver. s = +1 is the corner east and
        // south of the junction, governing traffic arriving from the south
        // (travelling +z) — so its face points -z, i.e. normal (0, -s).
        for (let s = -1; s <= 1; s += 2) {
          const sx = ix + s * (halfV + 1.3), sz = iz - s * (halfH + 1.3);
          if (!DK.free(sx, sz, { doorR: 3.0, ring: 1 })) continue;
          sign(sx, sz, 0, -s, C_STOP, C_STOP_BACK, 0.78, 0.78, 2.15, 2.6);
          stopN++;
        }
      }
    }

    // =====================================================================
    //  2) STREET-NAME BLADES at the signalised crossings
    // =====================================================================
    // A street you can name is a street you can navigate. One blade per
    // crossing, on a corner the signal heads don't already occupy.
    let bladeN = 0;
    const BLADE_MAX = DK.count(60);
    for (let i = 0; i < signalled.length && bladeN < BLADE_MAX; i++) {
      const it = signalled[i];
      const half = (city.ROAD || 18) / 2;
      const sx = it.x - (half + 2.1), sz = it.z - (half + 2.1);
      if (!DK.free(sx, sz, { doorR: 2.6, ring: 1 })) continue;
      const y = DK.groundY(sx, sz);
      posts.add(sx, y, sz, { sy: 1.25 });
      // two blades crossed at the top, one per street — exactly how a real
      // corner reads, and it costs four quads.
      const nA = DK.h01(sx, sz, 0x4421), nB = DK.h01(sz, sx, 0x4422);
      const cA = NAME_0 + ((nA * NAME_N) | 0) % NAME_N;
      const cB = NAME_0 + ((nB * NAME_N) | 0) % NAME_N;
      faces.quadWall(sx, y + 3.5, sz + 0.03, 1.35, 0.3, 0, 1, 0xffffff, DK.atlasCell(cA, GRID));
      faces.quadWall(sx, y + 3.5, sz - 0.03, 1.35, 0.3, 0, -1, 0xffffff, DK.atlasCell(C_BLADE_BACK, GRID));
      faces.quadWall(sx + 0.03, y + 3.16, sz, 1.35, 0.3, 1, 0, 0xffffff, DK.atlasCell(cB, GRID));
      faces.quadWall(sx - 0.03, y + 3.16, sz, 1.35, 0.3, -1, 0, 0xffffff, DK.atlasCell(C_BLADE_BACK, GRID));
      DK.solid(sx, sz, 0.14, 0.14, null);          // the 3.75 m mast, same rule as sign() above
      DK.claim(sx, sz);
      bladeN++;
    }

    // =====================================================================
    //  3) KERBSIDE REGULATORY PLATES + storm drains + bollards + bikes
    // =====================================================================
    // One walk of every kerb in the world drives four different props from a
    // single position hash, so their spacing interleaves naturally instead of
    // four independent passes fighting over the same metre of pavement.
    let plateN = 0, drainN = 0, bollN = 0, bikeN = 0;
    const PLATE_MAX = DK.count(110), DRAIN_MAX = DK.count(120),
      BOLL_MAX = DK.count(110), BIKE_MAX = DK.count(60);
    DK.eachKerb(city, 9.5, 0x4431, function (p) {
      const h = p.h;
      // (a) regulatory plate — set back against the property line
      if (h < 0.10 && plateN < PLATE_MAX) {
        const sx = p.x + p.nx * 0.55, sz = p.z + p.nz * 0.55;
        if (!DK.free(sx, sz, { doorR: 3.4, ring: 1 })) return false;
        const pick = DK.h01(sx, sz, 0x4432);
        const front = pick < 0.42 ? C_NOPARK : (pick < 0.62 ? C_TOW : (pick < 0.78 ? C_SPEED : (pick < 0.9 ? C_PARK : C_FIRELANE)));
        sign(sx, sz, -p.nx, -p.nz, front, C_RECT_BACK, 0.44, 0.62, 2.05, 2.7);
        plateN++;
        return true;
      }
      // (b) kerb-inlet storm drain — sits ON the kerb line, flush, no collider
      if (h > 0.90 && drainN < DRAIN_MAX) {
        const gx = p.x - p.nx * 0.95, gz = p.z - p.nz * 0.95;   // back at the gutter
        drains.add(gx, DK.groundY(gx, gz), gz, { ry: Math.atan2(-p.nx, -p.nz) });
        drainN++;
        return true;
      }
      // (c) bollard — guards a shopfront or a plaza corner
      if (h > 0.60 && h < 0.66 && bollN < BOLL_MAX) {
        const bx = p.x + p.nx * 0.5, bz = p.z + p.nz * 0.5;
        if (!DK.free(bx, bz, { doorR: 2.6, ring: 1, alley: { solid: true, r: 0.18 } })) return false;
        // Bollards come in threes on real pavements.
        for (let k = -1; k <= 1; k++) {
          const ox = bx - p.nz * k * 1.35, oz = bz + p.nx * k * 1.35;
          if (!DK.free(ox, oz, { doorR: 2.4, ring: 0, alley: { solid: true, r: 0.18 } })) continue;
          bollards.add(ox, DK.groundY(ox, oz), oz, { tint: 0.92 + DK.h01(ox, oz, 0x4433) * 0.16 });
          DK.solid(ox, oz, 0.16, 0.16, null);
          DK.claim(ox, oz);
          bollN++;
        }
        return true;
      }
      // (d) a bike leaning/chained against the property line
      if (h > 0.44 && h < 0.485 && bikeN < BIKE_MAX) {
        const bx = p.x + p.nx * 0.75, bz = p.z + p.nz * 0.75;
        if (!DK.free(bx, bz, { doorR: 3.0, ring: 1 })) return false;
        // yaw only: the kit composes Euler XYZ, so an extra roll here would be
        // applied about the WORLD x axis and would pitch a yawed bike instead
        // of leaning it. Chained upright against the property line is correct.
        const yaw = Math.atan2(-p.nz, -p.nx) + Math.PI / 2 + DK.h11(bx, bz, 0x4434) * 0.18;
        bikes.add(bx, DK.groundY(bx, bz), bz, { ry: yaw });
        bikeN++;
        return true;
      }
      return false;
      // alley:false at the WALKER level — this walk visits every kerb point in
      // the world and only some of them become props, so a claim here would be
      // spent by the walk itself. Each branch above declares its own.
    }, { band: 1.05, free: { doorR: 2.4, ring: 0, alley: false } });

    // =====================================================================
    //  4) THE ALLEY — what lives at the BACK of a building
    // =====================================================================
    // Fronts are for shops; backs are for bins. Dressing the rear faces is
    // what makes a block feel inhabited rather than extruded, and it costs
    // nothing where the player rarely looks straight on.
    let dumpN = 0, bagN = 0, palN = 0, crateN = 0, barN = 0;
    const DUMP_MAX = DK.count(55), BAG_MAX = DK.count(110), PAL_MAX = DK.count(70),
      CRATE_MAX = DK.count(95), BAR_MAX = PURGED ? 0 : DK.count(32);
    DK.eachBuilding(city, function (bi) {
      const facesOf = DK.buildingFaces(bi);
      // rank faces: never the door face, prefer the one facing away from any road
      const cands = [];
      for (let f = 0; f < facesOf.length; f++) {
        const fc = facesOf[f];
        if (DK.isDoorFace(bi, fc)) continue;
        const ox = fc.cx + fc.nx * 1.5, oz = fc.cz + fc.nz * 1.5;
        if (DK.onRoad(ox, oz, 1.0)) continue;
        cands.push(fc);
      }
      if (!cands.length) return;
      const hf = DK.h01(bi.x, bi.z, 0x4441);
      const face = cands[(hf * cands.length) | 0];
      const tx = -face.nz, tz = face.nx;                // along the wall
      const baseX = face.cx + face.nx * 1.25, baseZ = face.cz + face.nz * 1.25;

      // dumpster on the bigger back walls
      if (dumpN < DUMP_MAX && face.span > 7 && DK.h01(bi.x, bi.z, 0x4442) < 0.5) {
        const ox = baseX + tx * (face.span * 0.22), oz = baseZ + tz * (face.span * 0.22);
        // 1.05 = the dumpster's long half-extent; a 2.1m box is the biggest
        // single thing this file can put in an alley, so it is the one that
        // most needs to prove it leaves a run behind it.
        if (DK.free(ox, oz, { doorR: 3.2, ring: 1, alley: { solid: true, r: 1.05 } })) {
          const yaw = Math.atan2(face.nx, face.nz);
          dumps.add(ox, DK.groundY(ox, oz), oz, { ry: yaw, tint: 0.88 + DK.h01(ox, oz, 0x4443) * 0.24 });
          // a real dumpster is solid: cars dent on it, you can hide behind it
          const rx = Math.abs(face.nx) > 0.5 ? 0.62 : 1.05;
          const rz = Math.abs(face.nx) > 0.5 ? 1.05 : 0.62;
          DK.solid(ox, oz, rx, rz, null);
          DK.claim(ox, oz);
          dumpN++;
          // bags always pile up beside one
          for (let k = 0; k < 2 && bagN < BAG_MAX; k++) {
            const gx = ox + tx * (1.5 + k * 0.8) + face.nx * 0.2;
            const gz = oz + tz * (1.5 + k * 0.8) + face.nz * 0.2;
            // bags are 0.3m soft, no collider, and hugging the dumpster that
            // already paid for this alley's slot — they never spend one
            if (!DK.free(gx, gz, { doorR: 2.6, ring: 0, alley: false })) continue;
            bags.add(gx, DK.groundY(gx, gz), gz, { ry: DK.h01(gx, gz, 0x4444) * 6.28, sx: 0.85 + DK.h01(gx, gz, 0x4445) * 0.4, sz: 0.85 + DK.h01(gz, gx, 0x4446) * 0.4 });
            DK.claim(gx, gz); bagN++;
          }
        }
      }
      // pallets / crates / a site barrier further along the same wall
      const h2 = DK.h01(bi.z, bi.x, 0x4447);
      const ox2 = baseX - tx * (face.span * 0.26), oz2 = baseZ - tz * (face.span * 0.26);
      // 0.6 = the crate's own half-extent, which is the largest thing this
      // branch can produce; a pallet and a barrier are both smaller.
      if (DK.free(ox2, oz2, { doorR: 3.0, ring: 1, alley: { solid: h2 >= 0.30, r: 0.6 } })) {
        const yaw = Math.atan2(face.nx, face.nz) + DK.h11(ox2, oz2, 0x4448) * 0.35;
        if (h2 < 0.30 && palN < PAL_MAX) {
          // ONE pallet, flat. See the purge note at the top of the pass: a
          // 3-high stack is 0.78m of walk-through geometry.
          const stack = PURGED ? 1 : 1 + ((DK.h01(ox2, oz2, 0x4449) * 3) | 0);
          if (PURGED) cutN += (1 + ((DK.h01(ox2, oz2, 0x4449) * 3) | 0)) - 1;
          for (let k = 0; k < stack; k++) pallets.add(ox2, DK.groundY(ox2, oz2) + k * 0.26, oz2, { ry: yaw + k * 0.06 });
          DK.claim(ox2, oz2); palN++;
        } else if (h2 < 0.62 && crateN < CRATE_MAX) {
          crates.add(ox2, DK.groundY(ox2, oz2), oz2, { ry: yaw, tint: 0.9 + DK.h01(ox2, oz2, 0x444a) * 0.2 });
          if (DK.h01(oz2, ox2, 0x444b) < 0.45 && crateN + 1 < CRATE_MAX) {
            crates.add(ox2 + tx * 0.15, DK.groundY(ox2, oz2) + 0.7, oz2 + tz * 0.15, { ry: yaw + 0.4, sx: 0.82, sy: 0.82, sz: 0.82 });
            crateN++;
          }
          DK.solid(ox2, oz2, 0.48, 0.48, null);
          DK.claim(ox2, oz2); crateN++;
        } else if (h2 < 0.72) {
          // PURGED: the site barrier. A work zone with no work — see the note
          // at the top of the pass. BAR_MAX is 0 under the flag, so the whole
          // slice draws nothing and the alley simply has a gap in it.
          if (barN < BAR_MAX) {
            barriers.add(ox2, DK.groundY(ox2, oz2), oz2, { ry: yaw + Math.PI / 2 });
            DK.solid(ox2, oz2, 0.28, 0.75, null);
            DK.claim(ox2, oz2); barN++;
          } else if (PURGED) cutN++;
        }
      }
    });

    // =====================================================================
    //  5) THE FINE GRAIN — litter in the gutter, weeds in the joints
    // =====================================================================
    // Tiny, non-solid, and the first thing a weak tier drops. There is no
    // cheaper way to make a kerb stop reading as an extruded rectangle.
    let litN = 0, weedN = 0;
    const LIT_MAX = DK.count(320), WEED_MAX = DK.count(560);
    DK.eachKerb(city, 3.1, 0x4451, function (p) {
      const h = p.h;
      let did = false;
      // litter collects IN the gutter, against the kerb face
      if (h < 0.30 && litN < LIT_MAX) {
        const gx = p.x - p.nx * (0.55 + h), gz = p.z - p.nz * (0.55 + h);
        litter.add(gx, DK.groundY(gx, gz) + 0.005, gz, {
          ry: DK.h01(gx, gz, 0x4452) * 6.28,
          sx: 0.7 + DK.h01(gx, gz, 0x4453) * 0.7, sz: 0.7 + DK.h01(gz, gx, 0x4454) * 0.7,
        });
        litN++; did = true;
      }
      // weeds grow where the kerb meets the slab, and against wall bases
      if (h > 0.42 && h < 0.78 && weedN < WEED_MAX) {
        const wx = p.x - p.nx * 0.16 + p.nz * DK.h11(p.x, p.z, 0x4455) * 0.5;
        const wz = p.z - p.nz * 0.16 - p.nx * DK.h11(p.x, p.z, 0x4455) * 0.5;
        weeds.add(wx, DK.groundY(wx, wz), wz, {
          ry: DK.h01(wx, wz, 0x4456) * 6.28,
          sy: 0.55 + DK.h01(wx, wz, 0x4457) * 0.9,
          sx: 0.7 + DK.h01(wz, wx, 0x4458) * 0.6,
        });
        weedN++; did = true;
      }
      return did;
      // litter and weeds are FLAT GRAIN with no collider — they are what makes
      // an alley read as an alley, and they must never spend its budget.
    }, { band: 1.0, free: { doorR: 1.6, ring: 0, props: false, alley: false } });

    // weeds also creep up the base of every building wall
    DK.eachBuilding(city, function (bi) {
      if (weedN >= WEED_MAX) return;
      const fs = DK.buildingFaces(bi);
      for (let f = 0; f < fs.length; f++) {
        const fc = fs[f];
        if (DK.isDoorFace(bi, fc)) continue;
        const n = Math.max(1, Math.floor(fc.span / 3.4));
        for (let k = 0; k < n && weedN < WEED_MAX; k++) {
          const t = (-fc.span / 2) + (k + 0.5) * (fc.span / n);
          const wx = fc.cx + (-fc.nz) * t + fc.nx * 0.22;
          const wz = fc.cz + (fc.nx) * t + fc.nz * 0.22;
          if (DK.h01(wx, wz, 0x4459) > 0.42) continue;
          if (DK.onRoad(wx, wz, 0.2)) continue;
          weeds.add(wx, DK.groundY(wx, wz), wz, {
            ry: DK.h01(wx, wz, 0x445a) * 6.28,
            sy: 0.5 + DK.h01(wx, wz, 0x445b) * 0.8,
          });
          weedN++;
        }
      }
    });

    // ---- build (order is cosmetic; each is one draw) --------------------
    posts.build(root);
    faces.build(root);
    bollards.build(root);
    drains.build(root);
    dumps.build(root);
    bags.build(root);
    pallets.build(root);
    crates.build(root);
    barriers.build(root);
    bikes.build(root);
    litter.build(root);
    weeds.build(root);
    // hand the census to city/props.js's ratchet (CBZ.propPurgeAudit)
    if (CBZ.propPurgeCensus) CBZ.propPurgeCensus({ alleyRemoved: cutN, alleySolids: dumpN + crateN + barN + bollN });
  });
})();
