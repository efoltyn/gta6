/* ============================================================
   world/street_furniture.js — SIGNS, BOLLARDS, ALLEY JUNK (layer 3 of 5).

   city/props.js already owns the "shop-adjacent" furniture: hydrants,
   mailboxes, bins, meters, newsboxes, cones, planters, patio sets, bike
   RACKS, bus shelters, billboards. This pass deliberately does NOT
   duplicate any of those. It adds the layer underneath them — the stuff
   nobody designs but every street has:

     • REGULATORY SIGNAGE on real posts, drawn from one shared canvas
       ATLAS so every sign face in the world is a single textured draw:
       octagonal STOP signs (real 8-sided geometry) at unsignalised
       junctions, street-name blades hung from the signal mast arms
       (city/props.js records where), SPEED LIMIT plates mid-block by
       street class, parking plates down the kerbs, and house numbers
       beside front doors. There are no one-way streets and no yield
       situations in the network, so there are no ONE WAY / YIELD signs.
     • Bollards guarding plaza corners and shopfronts.
     • Kerb-inlet storm drains where gutter water would actually go.
     • The BACK of a building: its dumpster and the bagged trash beside it
       (the pallet / crate-stack / site-barrier scatter was deleted in the
       2026-09-27 de-slop: props with no reason to be there).
     • Chained bikes leaning on poles and railings.
     • The fine grain: kerbside litter and weeds in the joints. This is
       the first thing to go on a weak GPU and the first thing you miss
       on a strong one.

   DRAW-CALL BUDGET
     sign posts 1 · sign faces 1 (atlas) · bollards 1 · storm drains 1 ·
     dumpsters 1 · trash bags 1 · bikes 1 · litter 1 · weeds 1
     =  9 draws (+2 shadow casters).

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
  // cell map. Only standard MUTCD faces live here, and each one knows the
  // exact pixel rectangle (or octagon) it occupies, so the geometry samples
  // the face and nothing around it: no transparent margin, no cutout halo,
  // no lettering spilling past the plate edge.
  const C_STOP = 0, C_STOP_BACK = 1, C_NOPARK = 2, C_RECT_BACK = 3, C_SPEED = 7,
    C_PARK = 48, C_TOW = 49, C_FIRELANE = 50, C_BUS = 53, C_HYDRANT = 54, C_BLADE_BACK = 55,
    C_SPEED25 = 56, C_SPEED35 = 57, C_SPEED_BACK = 58;
  const NAME_0 = 8, NAME_N = 16;      // cells 8..23  — street-name blades (8 avenues, then 8 streets)
  const NUM_0 = 24, NUM_N = 24;       // cells 24..47 — house-number plates (building_dress.js)

  // Deterministic by construction: fixed authored tables. The avenues (the
  // N-S grid lines) take the AVE names in order, the cross streets the ST
  // names, so a street carries ONE name at every one of its crossings.
  const AVE_NAMES = ["MERIDIAN AVE", "ASHGROVE AVE", "8TH AVE", "HARBOR AVE", "TENTH AVE", "KESTREL AVE", "VERDE AVE", "MARLOWE AVE"];
  const ST_NAMES = ["HOLLOW ST", "CANAL ST", "PORTSIDE ST", "LOW BANK ST", "3RD ST", "CINDER ST", "OLD MILL ST", "BRINE ST"];

  // plate rectangles inside their 128 px cell: {x, y, w, h} in cell pixels
  const PLATE = {};
  function plateRect(i, w, h) { PLATE[i] = { x: (CELL - w) / 2, y: (CELL - h) / 2, w: w, h: h }; return PLATE[i]; }
  const BLADE_RECT = { x: 2, y: 48, w: 124, h: 31 };   // 4:1, the blade's own aspect
  const OCT_R = 62;                                     // STOP octagon circumradius, cell px

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
    function poly(i, n, rot, r, fill) {
      const c = cell(i), cx = c.x + CELL / 2, cy = c.y + CELL / 2;
      g.beginPath();
      for (let k = 0; k < n; k++) {
        const a = rot + k * Math.PI * 2 / n;
        const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
        if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath();
      g.fillStyle = fill; g.fill();
    }
    // a plate: fill the WHOLE rect (its edges are the geometry's edges), then
    // an inset border like the real sheeting has
    function plate(i, w, h, fill, border, bw, inset) {
      const c = cell(i), r = plateRect(i, w, h);
      g.fillStyle = fill; g.fillRect(c.x + r.x - 2, c.y + r.y - 2, r.w + 4, r.h + 4);   // 2 px bleed past the UV edge
      if (border) {
        g.strokeStyle = border; g.lineWidth = bw || 3;
        const k = (inset || 4) + (bw || 3) / 2;
        g.strokeRect(c.x + r.x + k, c.y + r.y + k, r.w - 2 * k, r.h - 2 * k);
      }
    }
    function text(i, str, size, color, dy, maxW) {
      const c = cell(i);
      g.fillStyle = color;
      g.font = "bold " + size + "px Helvetica, Arial, sans-serif";
      g.fillText(str, c.x + CELL / 2, c.y + CELL / 2 + (dy || 0), maxW || CELL - 16);
    }

    // --- STOP (R1-1): white border band, white legend on red -----------------
    poly(C_STOP, 8, Math.PI / 8, OCT_R + 2, "#f2f2ee");
    poly(C_STOP, 8, Math.PI / 8, OCT_R - 6, "#b4231e");
    text(C_STOP, "STOP", 38, "#f6f6f2", 2, 94);
    poly(C_STOP_BACK, 8, Math.PI / 8, OCT_R + 2, "#9aa0a2");
    // --- rectangular regulatory plates (2:3) ----------------------------------
    plate(C_NOPARK, 76, 114, "#f4f4ef", "#22262b", 2, 3);
    (function () {
      const c = cell(C_NOPARK), cx = c.x + CELL / 2, cy = c.y + 46;
      g.beginPath(); g.arc(cx, cy, 24, 0, Math.PI * 2);
      g.strokeStyle = "#c02a24"; g.lineWidth = 7; g.stroke();
      g.fillStyle = "#22262b"; g.font = "bold 30px Helvetica, Arial, sans-serif";
      g.fillText("P", cx, cy + 1);
      g.strokeStyle = "#c02a24"; g.lineWidth = 7;
      g.beginPath(); g.moveTo(cx - 17, cy + 17); g.lineTo(cx + 17, cy - 17); g.stroke();
      g.fillStyle = "#22262b"; g.font = "bold 13px Helvetica, Arial, sans-serif";
      g.fillText("NO PARKING", cx, c.y + 88, 66);
      g.fillText("ANY TIME", cx, c.y + 103, 66);
    })();
    plate(C_RECT_BACK, 76, 114, "#9aa0a2");
    plate(C_TOW, 76, 114, "#f4f4ef", "#c02a24", 3, 3);
    text(C_TOW, "TOW", 21, "#c02a24", -26, 62);
    text(C_TOW, "AWAY", 21, "#c02a24", -2, 62);
    text(C_TOW, "ZONE", 21, "#c02a24", 22, 62);
    plate(C_FIRELANE, 76, 114, "#c02a24", "#f4f4ef", 3, 3);
    text(C_FIRELANE, "FIRE", 22, "#f4f4ef", -14, 62);
    text(C_FIRELANE, "LANE", 22, "#f4f4ef", 12, 62);
    plate(C_PARK, 76, 114, "#1b4f8f", "#f4f4ef", 3, 3);
    text(C_PARK, "P", 62, "#f4f4ef", 2);
    plate(C_BUS, 76, 114, "#1b4f8f", "#f4f4ef", 3, 3);
    text(C_BUS, "BUS", 21, "#f4f4ef", -14, 62);
    text(C_BUS, "STOP", 21, "#f4f4ef", 12, 62);
    plate(C_HYDRANT, 76, 114, "#f4f4ef", "#c02a24", 3, 3);
    text(C_HYDRANT, "NO", 18, "#c02a24", -22, 60);
    text(C_HYDRANT, "STOPPING", 13, "#c02a24", -2, 62);
    text(C_HYDRANT, "ANY TIME", 13, "#c02a24", 18, 62);
    // --- SPEED LIMIT (R2-1, 4:5): black legend on white, by street class ------
    [[C_SPEED25, "25"], [C_SPEED, "30"], [C_SPEED35, "35"]].forEach(function (sp) {
      plate(sp[0], 92, 115, "#f4f4ef", "#22262b", 3, 4);
      text(sp[0], "SPEED", 18, "#22262b", -35, 76);
      text(sp[0], "LIMIT", 18, "#22262b", -15, 76);
      text(sp[0], sp[1], 52, "#22262b", 22, 76);
    });
    plate(C_SPEED_BACK, 92, 115, "#9aa0a2");

    // --- street-name blades (green, reflective white legend and border) -----
    const NAMES = AVE_NAMES.concat(ST_NAMES);
    for (let i = 0; i < NAME_N; i++) {
      const idx = NAME_0 + i, c = cell(idx), R = BLADE_RECT;
      g.fillStyle = "#1f5c3a"; g.fillRect(c.x + R.x - 2, c.y + R.y - 2, R.w + 4, R.h + 4);
      g.strokeStyle = "#e8ece6"; g.lineWidth = 2; g.strokeRect(c.x + R.x + 3, c.y + R.y + 3, R.w - 6, R.h - 6);
      g.fillStyle = "#f2f5ef";
      g.font = "bold 18px Helvetica, Arial, sans-serif";
      g.fillText(NAMES[i % NAMES.length], c.x + CELL / 2, c.y + R.y + R.h / 2 + 1, R.w - 14);
    }
    (function () { const c = cell(C_BLADE_BACK), R = BLADE_RECT; g.fillStyle = "#8f9691"; g.fillRect(c.x + R.x - 2, c.y + R.y - 2, R.w + 4, R.h + 4); })();

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
    // sharp at the glancing angles a kerbside sign is always seen from:
    // trilinear mips (the CanvasTexture default on a power-of-two canvas)
    // plus as much anisotropy as the GPU offers, capped at 8
    let aniso = 8;
    try { const R = CBZ.renderer; if (R && R.capabilities && R.capabilities.getMaxAnisotropy) aniso = Math.min(8, R.capabilities.getMaxAnisotropy()); } catch (e) { /* keep 8 */ }
    t.anisotropy = Math.max(1, aniso);
    if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;   // sRGB-authored canvas colours
    _atlas = t;
    return t;
  }
  // uv rect of a cell's exact face (plate / blade), inset half a texel
  function faceUV(i, rect) {
    const col = i % GRID, row = (i / GRID) | 0, r = rect || PLATE[i];
    if (!r) return DK.atlasCell(i, GRID);
    const x0 = col * CELL + r.x + 0.5, x1 = col * CELL + r.x + r.w - 0.5;
    const y0 = row * CELL + r.y + 0.5, y1 = row * CELL + r.y + r.h - 0.5;
    return { u0: x0 / ATLAS_PX, u1: x1 / ATLAS_PX, v0: 1 - y1 / ATLAS_PX, v1: 1 - y0 / ATLAS_PX };
  }
  // Shared with world/building_dress.js (house-number plates) so the whole
  // world still has exactly ONE signage texture, hence one signage draw per
  // consuming sheet rather than one per sign.
  DK.signAtlas = signAtlas;
  DK.signAtlasGrid = GRID;
  DK.signAtlasCells = { NUM_0: NUM_0, NUM_N: NUM_N, RECT_BACK: C_RECT_BACK, NAME_0: NAME_0, NAME_N: NAME_N, BUS: C_BUS, HYDRANT: C_HYDRANT };
  // exact-plate UVs of a cell (city/props.js hangs the BUS STOP flag sign with it)
  DK.signFaceUV = function (i, rect) { return faceUV(i, rect); };

  // =====================================================================
  //  PROTOTYPES
  // =====================================================================
  const GALV = 0xa7adb0, GALV_D = 0x858b8e, HOLE = 0x3a3e41;

  function signPostProto() {
    // 2-inch square galvanised PERFORATED tube (the US standard: 7/16 in
    // holes on 1 in centres down every face), seated in its 2.5 in breakaway
    // anchor sleeve with the corner bolt through both, a ground collar, and
    // the cap. The hole rows are drawn as the dark recessed stripe they read
    // as past arm's length. The kit scales this in Y by postH/3, so nothing
    // here has a height-specific detail.
    const p = DK.proto();
    p.cbox(0.05, 2.7, 0.05, 0.004, GALV, 0, 1.6, 0);
    for (let s = -1; s <= 1; s += 2) {
      p.box(0.011, 2.62, 0.002, HOLE, 0, 1.6, s * 0.0255);
      p.box(0.002, 2.62, 0.011, HOLE, s * 0.0255, 1.6, 0);
    }
    p.cbox(0.064, 0.32, 0.064, 0.004, GALV_D, 0, 0.16, 0);         // anchor sleeve
    p.cyl(0.006, 0.006, 0.09, 6, 0x6a7073, 0, 0.27, 0, Math.PI / 2, 0, 0);   // corner bolt
    for (let s = -1; s <= 1; s += 2) p.cyl(0.011, 0.011, 0.006, 6, 0x6a7073, 0, 0.27, s * 0.035, Math.PI / 2, 0, 0);
    p.cbox(0.11, 0.02, 0.11, 0.006, 0x8e9396, 0, 0.01, 0);          // ground collar
    p.cbox(0.056, 0.016, 0.056, 0.005, 0x7d8386, 0, 2.958, 0);      // top cap
    return p.done();
  }
  function bollardProto() {
    // A cast-iron "heritage" bollard, turned in one profile: the base flare
    // on its bolt-down plinth, the barely tapered shaft, a collar, a fluted
    // neck, the dome and its finial; a retroreflective band at bumper height.
    const p = DK.proto();
    const IRON = 0x2c3035;
    p.cyl(0.165, 0.175, 0.03, 12, 0x23262a, 0, 0.015, 0);
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + Math.PI / 4;
      p.cyl(0.017, 0.017, 0.016, 6, 0x50555a, Math.cos(a) * 0.13, 0.035, Math.sin(a) * 0.13);   // bolt heads
    }
    p.lathe([[0.0, 0.03], [0.15, 0.03], [0.15, 0.06], [0.12, 0.1], [0.108, 0.16], [0.1, 0.78],
      [0.122, 0.8], [0.122, 0.84], [0.094, 0.86], [0.088, 0.9], [0.1, 0.93], [0.1, 0.95],
      [0.082, 1.0], [0.045, 1.035], [0.02, 1.04], [0.026, 1.07], [0.0, 1.085]], 12, IRON, 0, 0, 0);
    p.cyl(0.1035, 0.1035, 0.05, 12, 0xdad8ce, 0, 0.7, 0);           // reflective band
    return p.done();
  }
  function drainProto() {
    // A kerb inlet: the steel lintel hood over the throat cut into the kerb
    // face, the dark throat, and the cast-iron gutter grate (chamfered frame,
    // vane bars, two lift slots) with the stencil plate on the kerb top.
    const p = DK.proto();
    p.cbox(1.3, 0.2, 0.1, 0.012, 0xa89e7c, 0, 0.1, 0.22);              // kerb apron
    p.box(1.15, 0.13, 0.06, 0x101113, 0, 0.085, 0.17);                 // dark throat
    p.cbox(1.2, 0.05, 0.03, 0.006, 0x4a4d50, 0, 0.175, 0.16);          // steel lintel
    p.cbox(1.25, 0.05, 0.44, 0.012, 0x3a3e42, 0, 0.025, -0.06);        // grate frame
    p.box(1.13, 0.012, 0.33, 0x0d0e10, 0, 0.046, -0.06);               // the void under the bars
    for (let i = -5; i <= 5; i++) p.box(0.04, 0.03, 0.33, 0x2b2e31, i * 0.1, 0.045, -0.06);   // bars
    for (const z of [-0.155, 0.035]) p.box(1.13, 0.03, 0.03, 0x2b2e31, 0, 0.045, z);          // cross bearers
    p.box(0.3, 0.004, 0.06, 0xc9c3ae, 0, 0.202, 0.24);                 // stencil plate
    p.box(0.24, 0.005, 0.016, 0x2d4f7a, 0, 0.203, 0.24);
    return p.done();
  }
  function dumpsterProto() {
    // A 3-yard FRONT-LOAD container, 1.85 x 1.15 m: the body flares toward
    // the top, the sloped front a truck's forks lift from, steel fork
    // POCKETS down both flanks on gussets, pressed stiffener channels round
    // the body, the top rim, two black plastic lids on a rod hinge (one
    // propped), a drain plug, four swivel castors, the hauler's panel.
    // Local +Z faces OUT from the wall.
    const p = DK.proto();
    const BODY = 0x2f5e46, DARK = 0x244936, LID = 0x1b1c1e, STEEL = 0x3a3d40, RUST = 0x5a4632;
    const W = 1.85;
    // THE BODY IS ITS SIDE PROFILE, extruded across the width: a vertical
    // back, a flat top, a short vertical front lip and the long slope that
    // runs down and in to the floor (the face a truck's forks lift against).
    const prof = function (zb, zf, zs, y0, y1, ys) {
      const sh = new THREE.Shape();      // shape x = -z (see the ry below)
      sh.moveTo(-zb, y0); sh.lineTo(-zb, y1); sh.lineTo(-zf, y1); sh.lineTo(-zf, ys); sh.lineTo(-zs, y0); sh.lineTo(-zb, y0);
      return sh;
    };
    const body = new THREE.ExtrudeGeometry(prof(-0.58, 0.56, 0.08, 0.22, 1.24, 0.92),
      { depth: W - 0.06, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1, curveSegments: 1 });
    body.translate(0, 0, -(W - 0.06) / 2);
    p.add(body, BODY, 0, 0, 0, 0, Math.PI / 2, 0);
    p.cbox(W + 0.1, 0.06, 1.24, 0.015, DARK, 0, 1.27, -0.01);          // top rim
    p.cbox(W + 0.02, 0.05, 0.05, 0.01, DARK, 0, 0.92, 0.59);           // front lip channel
    // stiffener channels: three down the back, two on each flank
    for (let k = -1; k <= 1; k++) p.cbox(0.08, 0.96, 0.05, 0.01, DARK, k * 0.6, 0.72, -0.615);
    for (let s = -1; s <= 1; s += 2) {
      for (const z of [-0.35, 0.05]) p.cbox(0.05, 0.9, 0.08, 0.01, DARK, s * 0.955, 0.7, z);
      // fork pocket on two gussets
      p.cbox(0.16, 0.15, 1.2, 0.02, STEEL, s * 1.0, 0.95, -0.02);
      p.box(0.11, 0.11, 1.22, 0x0e0f10, s * 1.0, 0.95, -0.02);          // its open mouth (dark)
      for (const z of [-0.4, 0.3]) p.box(0.1, 0.2, 0.03, STEEL, s * 0.97, 0.8, z);
    }
    // lids: rod hinge at the back rim, one shut, one propped open a crack
    p.cyl(0.018, 0.018, W, 6, STEEL, 0, 1.3, -0.6, 0, 0, Math.PI / 2);
    p.cbox(0.9, 0.06, 1.18, 0.02, LID, -0.47, 1.325, -0.02);
    p.cbox(0.9, 0.06, 1.18, 0.02, LID, 0.47, 1.4, -0.06, -0.14, 0, 0);
    for (let k = -2; k <= 2; k++) {
      p.box(0.86, 0.014, 0.035, 0x262729, -0.47, 1.36, -0.02 + k * 0.22);
      p.box(0.86, 0.014, 0.035, 0x262729, 0.47, 1.435, -0.06 + k * 0.22, -0.14, 0, 0);
    }
    for (const x of [-0.47, 0.47]) p.cbox(0.14, 0.04, 0.05, 0.01, 0x222325, x, 1.33 + (x > 0 ? 0.12 : 0), 0.58);   // lid handles
    // castors: swivel plate, fork, wheel
    for (let s = -1; s <= 1; s += 2) for (let t = -1; t <= 1; t += 2) {
      const cx = s * 0.78, cz = t * 0.25 - 0.26;
      p.cbox(0.13, 0.02, 0.13, 0.006, STEEL, cx, 0.225, cz);
      p.box(0.09, 0.09, 0.012, STEEL, cx, 0.17, cz + 0.035);
      p.box(0.09, 0.09, 0.012, STEEL, cx, 0.17, cz - 0.035);
      p.cyl(0.075, 0.075, 0.05, 10, 0x151618, cx, 0.075, cz, Math.PI / 2, 0, 0);
      p.cyl(0.03, 0.03, 0.056, 8, 0x8a8f93, cx, 0.075, cz, Math.PI / 2, 0, 0);
    }
    p.cyl(0.035, 0.035, 0.05, 6, STEEL, 0.7, 0.3, -0.62, Math.PI / 2, 0, 0);   // drain plug
        // hauler panel on the slope, laid in its plane: a point on the slope
    // plus the slope's outward normal (forward and DOWN), rotated to face it
    const sl = Math.atan2(0.92 - 0.22, 0.56 - 0.08);                     // slope angle off horizontal
    const nY = -Math.cos(sl), nZ = Math.sin(sl), tilt = Math.PI / 2 - sl;
    const onSlope = function (t, off) { off += 0.03; return [0.22 + (0.92 - 0.22) * t + nY * off, 0.08 + (0.56 - 0.08) * t + nZ * off]; };   // +0.03: the extrusion's bevel
    let q = onSlope(0.55, 0.008); p.box(0.62, 0.3, 0.012, 0xcfc6a6, 0.5, q[0], q[1], tilt, 0, 0);
    q = onSlope(0.64, 0.016); p.box(0.52, 0.06, 0.006, 0x5a2a22, 0.5, q[0], q[1], tilt, 0, 0);
    q = onSlope(0.5, 0.016); p.box(0.42, 0.03, 0.006, 0x3a3c40, 0.46, q[0], q[1], tilt, 0, 0);
    q = onSlope(0.44, 0.016); p.box(0.3, 0.03, 0.006, 0x3a3c40, 0.4, q[0], q[1], tilt, 0, 0);
    q = onSlope(0.1, 0.008); p.box(0.44, 0.06, 0.006, RUST, -0.5, q[0], q[1], tilt, 0, 0);   // scuffed kick rust
    return p.done();
  }
  function bagProto() {
    // Three slumped black sacks: each a squashed body, a gathered neck and
    // the two tied ears of its draw tape. ONE prototype, one instance a pile.
    const p = DK.proto();
    function sack(x, z, r, h, col, lean) {
      const g = new THREE.SphereGeometry(r, 10, 7);
      // SLUMP: a full bag sits on its contents — flat bottom, bellied sides,
      // lumps where the rubbish pushes the film out. Deterministic per bag.
      const a = g.attributes.position.array;
      for (let i = 0; i < a.length; i += 3) {
        const vx = a[i], vy = a[i + 1], vz = a[i + 2];
        const bulge = 1 + 0.09 * Math.sin(vx * 23 + x * 7) * Math.cos(vz * 19 + z * 5) + 0.06 * Math.sin(vy * 17);
        const belly = vy < 0 ? 1.12 : 1 - 0.18 * (vy / r);
        a[i] = vx * bulge * belly; a[i + 2] = vz * bulge * belly * 0.92;
        a[i + 1] = vy < 0 ? vy * 0.55 : vy;
      }
      g.computeVertexNormals();
      g.scale(1, h, 1);
      p.add(g, col, x, r * h * 0.55, z, lean * 0.4, 0, lean * 0.3);
      const ny = r * h * 1.5;
      p.cone(r * 0.32, r * 0.5, 6, col, x + lean * r, ny + r * 0.1, z, Math.PI, 0, 0);  // gathered neck
      p.cone(r * 0.12, r * 0.38, 4, col, x + lean * r - r * 0.12, ny + r * 0.3, z, 0, 0, 0.7);   // tie ears
      p.cone(r * 0.12, r * 0.38, 4, col, x + lean * r + r * 0.12, ny + r * 0.3, z, 0, 0, -0.7);
      p.box(r * 0.3, r * 0.05, r * 0.06, 0xc9c4b5, x + lean * r, ny + r * 0.22, z);  // white draw tape
    }
    sack(0, 0, 0.27, 1.05, 0x202226, 0.12);
    sack(0.4, 0.16, 0.23, 0.95, 0x1b1d21, -0.18);
    sack(-0.3, -0.18, 0.21, 1.0, 0x26282d, 0.25);
    return p.done();
  }
  function bikeProto() {
    // A city hybrid, 700c: torus tyres on rims with a hub and spokes, a
    // diamond frame authored by its JOINTS (head tube, top/down/seat tubes,
    // stays), the fork, stem and riser bar with grips, seatpost and saddle,
    // crank with chainring and pedals, the kickstand and a U-lock on the
    // frame. Local X = along the bike, front at -X.
    const p = DK.proto();
    const TYRE = 0x1a1b1d, RIM = 0x8d9396, FRAME = 0x2c6f9c, BLK = 0x1d1f22, CH = 0x5d6266;
    const R = 0.335, WB = 1.04, fx = -WB / 2, rx = WB / 2, wy = R + 0.02;
    for (const x of [fx, rx]) {
      p.torus(R - 0.018, 0.02, 5, 20, Math.PI * 2, TYRE, x, wy, 0);
      p.torus(R - 0.045, 0.009, 3, 20, Math.PI * 2, RIM, x, wy, 0);
      p.cyl(0.022, 0.022, 0.1, 8, CH, x, wy, 0, Math.PI / 2, 0, 0);
      for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4;
        p.rod(x, wy, (k % 2 ? 0.035 : -0.035), x + Math.cos(a) * (R - 0.05), wy + Math.sin(a) * (R - 0.05), 0, 0.0025, 3, 0xa9aeb1);
      }
    }
    // frame joints
    const BB = [0.06, 0.29, 0], ST = [0.16, 0.86, 0], HT = [-0.4, 0.84, 0], HL = [-0.37, 0.66, 0];
    const tube = function (a, b, r, c) { p.rod(a[0], a[1], a[2], b[0], b[1], b[2], r, 6, c || FRAME); };
    tube(BB, ST, 0.017);                              // seat tube
    tube(ST, HT, 0.016);                              // top tube
    tube(BB, HL, 0.02);                               // down tube
    tube(HT, [-0.37, 0.64, 0], 0.022);                // head tube
    for (const s of [-1, 1]) {
      tube([BB[0], BB[1], s * 0.03], [rx, wy, s * 0.05], 0.009);        // chain stays
      tube([ST[0] - 0.02, ST[1] - 0.04, s * 0.02], [rx, wy, s * 0.05], 0.008);   // seat stays
      tube([-0.37, 0.64, s * 0.02], [fx, wy, s * 0.05], 0.011, CH);      // fork blades
    }
    tube([-0.4, 0.84, 0], [-0.43, 0.97, 0], 0.013, CH);                  // steerer + stem
    tube([-0.43, 0.97, 0], [-0.5, 0.98, 0], 0.012, CH);
    p.rod(-0.5, 0.98, -0.3, -0.5, 0.98, 0.3, 0.011, 6, BLK);            // bar
    for (const s of [-1, 1]) p.cyl(0.017, 0.017, 0.11, 6, 0x2a2a2a, -0.5, 0.98, s * 0.27, Math.PI / 2, 0, 0);   // grips
    tube(ST, [0.19, 0.98, 0], 0.012, CH);                                 // seatpost
    const sad = new THREE.SphereGeometry(0.1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    sad.scale(1.35, 0.4, 0.75);
    p.add(sad, 0x1a1a1c, 0.2, 0.985, 0);                                  // saddle
    // drivetrain
    p.cyl(0.1, 0.1, 0.008, 18, CH, BB[0], BB[1], 0.05, Math.PI / 2, 0, 0);    // chainring
    p.rod(BB[0], BB[1], 0.06, BB[0] + 0.05, BB[1] - 0.16, 0.08, 0.009, 4, CH);   // crank arm
    p.rod(BB[0], BB[1], -0.06, BB[0] - 0.05, BB[1] + 0.16, -0.08, 0.009, 4, CH);
    p.box(0.08, 0.02, 0.1, BLK, BB[0] + 0.05, BB[1] - 0.16, 0.13);       // pedals
    p.box(0.08, 0.02, 0.1, BLK, BB[0] - 0.05, BB[1] + 0.16, -0.13);
    p.rod(BB[0] + 0.1, BB[1] + 0.005, 0.05, rx, wy + 0.04, 0.05, 0.005, 3, 0x3b3d40);   // chain, top run
    p.rod(BB[0] + 0.1, BB[1] - 0.09, 0.05, rx, wy - 0.04, 0.05, 0.005, 3, 0x3b3d40);    // chain, return
    p.rod(0.22, 0.27, -0.03, 0.3, 0.0, -0.16, 0.009, 4, CH);             // kickstand
    // U-lock round the seat tube
    p.torus(0.07, 0.009, 4, 10, Math.PI, 0x9a9fa3, 0.1, 0.5, 0, 0, Math.PI / 2, 0);
    p.cbox(0.17, 0.035, 0.035, 0.008, 0xb0302a, 0.1, 0.43, 0, 0, Math.PI / 2, 0);
    return p.done();
  }
  function litterProto() {
    // a scatter cluster: a flattened cup with its lid, a crushed can, a sheet
    // of paper and a receipt.
    // NOTE the flat sheets spin on rz, not ry: the kit composes Euler XYZ, so
    // after the -90° x-tilt it is rz that yaws a ground quad — ry would tip it
    // up on edge. (Same trap the aim-library docs warn about for cameras.)
    const p = DK.proto();
    p.cyl(0.035, 0.045, 0.11, 7, 0xd8d2c2, 0, 0.042, 0, Math.PI / 2 - 0.2, 0, 0.4);
    p.cyl(0.047, 0.047, 0.008, 7, 0x2a2c30, -0.05, 0.045, 0.025, Math.PI / 2 - 0.2, 0, 0.4);
    p.cyl(0.033, 0.033, 0.07, 7, 0x9aa4ad, 0.26, 0.03, 0.14, 0, 0, Math.PI / 2 - 0.15);
    p.cyl(0.034, 0.03, 0.018, 7, 0xb3262a, 0.26 + 0.044, 0.03, 0.14, 0, 0, Math.PI / 2 - 0.15);
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

  // The prototypes, for the asset turntable (tools/lab asset kit) only.
  CBZ.streetFurnitureProtos = {
    signPost: signPostProto, bollard: bollardProto, drain: drainProto, dumpster: dumpsterProto,
    bags: bagProto, bike: bikeProto, litter: litterProto, weed: weedProto,
  };

  // =====================================================================
  //  THE PASS
  // =====================================================================
  DK.register(20, "street-furniture", function (city, DK) {
    if (CBZ.CONFIG.DETAIL_STREET_FURNITURE === false) return;
    const root = city.root;
    // What this pass no longer does: the site BARRIER (a work zone with no
    // work), the pallet stacks and the crate-on-a-crate at back walls are all
    // gone (2026-09-27 de-slop). Dumpster and bollard declare their collider
    // and half-width to CBZ.alleyOk through DK.free, so at most ONE solid can
    // stand in any 14 m of alley and only where it leaves a 2.4 m run. The
    // flat grain (litter, weeds, drains) opts OUT: a stain is not a prop and
    // must not spend an alley's budget.
    // Seat everything on the DRAWN street surface: the landmass floor
    // (DK.groundY) is 0 across the city, but the footway is a raised slab
    // (city.street.heightAt: road, gutter, kerb, footway). Posts, bollards
    // and drains read the higher of the two, so no base is ever buried.
    const street = city.street;
    function gY(x, z) {
      const g0 = DK.groundY(x, z);
      const h = street && typeof street.heightAt === "function" ? +street.heightAt(x, z) : NaN;
      return Number.isFinite(h) ? Math.max(g0, h) : g0;
    }
    let cutN = 0;

    // Regulatory signs are never thinned by the quality tier: a STOP sign that
    // vanishes on an iPad is a rule the player cannot see. (cls "solid" keeps
    // every instance; each is still one draw.) The faces sample only their own
    // plate pixels, so the alphaTest never actually cuts anything: it is there
    // because DK.sheet makes a mapped sheet OPAQUE (depth-writing) only when
    // one is given, and a sign must sort like the solid plate it is.
    const posts = DK.batch("sign-post", signPostProto(), { cls: "solid", cast: false });
    const faces = DK.sheet("sign-face", { cls: "solid", map: signAtlas(), alphaTest: 0.45, unlit: false });
    const bollards = DK.batch("bollard", bollardProto(), { cls: "solid", cast: true });
    const drains = DK.batch("storm-drain", drainProto(), { cls: "fine", cast: false });
    const dumps = DK.batch("dumpster", dumpsterProto(), { cls: "solid", cast: true });
    const bags = DK.batch("trash-bags", bagProto(), { cls: "fine", cast: false });
    const bikes = DK.batch("bike", bikeProto(), { cls: "decor", cast: false });
    const litter = DK.batch("litter", litterProto(), { cls: "fine", cast: false });
    const weeds = DK.batch("weeds", weedProto(), { cls: "fine", cast: false });

    // ---- sign helpers ----------------------------------------------------
    // One post instance + a front face and a matching BACK face, so walking
    // behind a sign shows a blank grey plate instead of mirrored lettering.
    // Faces sample exactly their plate's pixels (faceUV), so the quad IS the
    // plate: no cutout margin, no halo.
    function post(x, z, nx, nz, postH) {
      const y = gY(x, z);
      posts.add(x, y, z, { sy: (postH || 3.0) / 3.0, ry: Math.atan2(-nx, -nz) });
      // SOLID: a 3 m galvanised post on a kerb is not pass-through.
      DK.solid(x, z, 0.12, 0.12, null);
      DK.claim(x, z);
      return y;
    }
    function sign(x, z, nx, nz, cellFront, cellBack, w, h, mountY, postH) {
      const y = post(x, z, nx, nz, postH);
      faces.quadWall(x + nx * 0.04, y + mountY, z + nz * 0.04, w, h, nx, nz, 0xffffff, faceUV(cellFront));
      faces.quadWall(x - nx * 0.04, y + mountY, z - nz * 0.04, w, h, -nx, -nz, 0xffffff, faceUV(cellBack));
    }
    // a regular polygon face (the STOP octagon is REAL eight-sided geometry,
    // not a textured square), UV-mapped onto the same polygon in the atlas.
    // Tangent/winding follow Sheet.quadWall: texture-left on the viewer's left,
    // triangle normal = (nx, 0, nz).
    function polyFace(cx, cy, cz, R, sides, rot, nx, nz, cellI, rPx) {
      const tx = -nz, tz = nx;
      const col = cellI % GRID, row = (cellI / GRID) | 0;
      const uc = (col * CELL + CELL / 2) / ATLAS_PX, vc = 1 - (row * CELL + CELL / 2) / ATLAS_PX;
      const ru = (rPx - 0.5) / ATLAS_PX;
      const P = [], Nn = [], U = [];
      for (let k = 0; k < sides; k++) {
        const a0 = rot + k * Math.PI * 2 / sides, a1 = rot + (k + 1) * Math.PI * 2 / sides;
        // (centre, v1, v0): with angles increasing counter-clockwise in the
        // (tangent, up) plane this order faces (nx, 0, nz)
        const vx = [0, Math.cos(a1), Math.cos(a0)], vy = [0, Math.sin(a1), Math.sin(a0)];
        for (let q = 0; q < 3; q++) {
          P.push(cx + tx * vx[q] * R, cy + vy[q] * R, cz + tz * vx[q] * R);
          Nn.push(nx, 0, nz);
          U.push(uc + vx[q] * ru, vc + vy[q] * ru);
        }
      }
      faces.push(P, Nn, DK.colArray(0xffffff, P.length / 3), U, DK.h01(cx, cz, 0x77a3));
    }
    function stopSign(x, z, nx, nz) {
      // R1-1 at 30 in across the flats; bottom edge 2.1 m over the footway
      const R = 0.76 / (2 * Math.cos(Math.PI / 8));
      const mountY = 2.1 + R;
      const y = post(x, z, nx, nz, mountY + R * 0.6);
      polyFace(x + nx * 0.04, y + mountY, z + nz * 0.04, R, 8, Math.PI / 8, nx, nz, C_STOP, OCT_R);
      polyFace(x - nx * 0.04, y + mountY, z - nz * 0.04, R, 8, Math.PI / 8, -nx, -nz, C_STOP_BACK, OCT_R);
    }

    // =====================================================================
    //  1) STOP SIGNS at unsignalised junctions
    // =====================================================================
    // Every mainland grid crossing carries a real signal installation
    // (city/props.js), and a junction never has both. So compute the
    // geometric crossings of the ORDINARY street network and drop a stop
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
        // A two-way stop on the north-south road: one sign per opposing
        // approach, on that approach's near kerb (the side its lanes run on)
        // with its face turned back at the oncoming driver. s = +1 governs
        // traffic arriving from the south (travelling +z; keep right puts its
        // lanes at -x, config.js roadLaneSide), so it stands west and south
        // of the junction facing -z.
        for (let s = -1; s <= 1; s += 2) {
          const sx = ix - s * (halfV + 1.3), sz = iz - s * (halfH + 1.3);
          if (!DK.free(sx, sz, { doorR: 3.0, ring: 1 })) continue;
          stopSign(sx, sz, 0, -s);
          (city._stopSigns = city._stopSigns || []).push({ x: sx, z: sz, nx: 0, nz: -s });   // for shots + audits
          stopN++;
        }
      }
    }

    // =====================================================================
    //  2) STREET-NAME BLADES on the signal mast arms
    // =====================================================================
    // city/props.js hangs a blade under every mast arm (the cross street's
    // name, facing the traffic that is about to cross it) and records where.
    // A street carries ONE name everywhere: avenues take the AVE list in
    // west-to-east order, cross streets the ST list south-to-north.
    const blades = city._signalBlades || [];
    if (blades.length) {
      const vKeys = [], hKeys = [];
      for (const b of blades) {
        const list = b.vertical ? vKeys : hKeys;
        if (list.indexOf(b.key) < 0) list.push(b.key);
      }
      const coord = function (k) { return +k.slice(2); };
      vKeys.sort(function (a, b) { return coord(a) - coord(b); });
      hKeys.sort(function (a, b) { return coord(a) - coord(b); });
      const half = NAME_N / 2;
      for (const b of blades) {
        const cellI = b.vertical
          ? NAME_0 + (vKeys.indexOf(b.key) % half)
          : NAME_0 + half + (hKeys.indexOf(b.key) % half);
        const uv = faceUV(cellI, BLADE_RECT);
        // double-faced, like the real mast-arm signs: legible from both ways
        faces.quadWall(b.x + b.nx * 0.015, b.y, b.z + b.nz * 0.015, b.w, b.h, b.nx, b.nz, 0xffffff, uv);
        faces.quadWall(b.x - b.nx * 0.015, b.y, b.z - b.nz * 0.015, b.w, b.h, -b.nx, -b.nz, 0xffffff, uv);
      }
    }

    // =====================================================================
    //  2b) SPEED LIMIT signs mid-block, one per direction per block
    // =====================================================================
    // R2-1 on the near kerb of each approach, 35% of the way into the block
    // (past the junction clutter, before the next one). The number follows
    // the street's class: avenue 35, grid street 30, everything else 25.
    const gridX = city.xLines || [], gridZ = city.zLines || [];
    const onLine = function (lines, v) { for (let i = 0; i < lines.length; i++) if (Math.abs(lines[i] - v) < 0.6) return true; return false; };
    let speedN = 0;
    const SPEED_MAX = DK.count(160);
    for (let a = 0; a < streets.length && speedN < SPEED_MAX; a++) {
      const r = streets[a];
      const cellI = r.avenue ? C_SPEED35 : ((r.vertical ? onLine(gridX, r.x) : onLine(gridZ, r.z)) ? C_SPEED : C_SPEED25);
      const half = (r.w != null ? r.w : (city.ROAD || 18)) / 2;
      const c0 = r.vertical ? r.z : r.x;
      // the crossings along this road, plus its two ends
      const cuts = [c0 - r.len / 2, c0 + r.len / 2];
      const others = r.vertical ? horizontals : verticals;
      for (let b = 0; b < others.length; b++) {
        const o = others[b];
        const along = r.vertical ? o.z : o.x, fixed = r.vertical ? r.x : r.z;
        const oc = r.vertical ? o.x : o.z;
        if (Math.abs(along - c0) > r.len / 2 || Math.abs(fixed - oc) > o.len / 2) continue;
        cuts.push(along);
      }
      cuts.sort(function (p, q) { return p - q; });
      for (let k = 0; k + 1 < cuts.length && speedN < SPEED_MAX; k++) {
        const u0 = cuts[k], u1 = cuts[k + 1], gap = u1 - u0;
        if (gap < 30) continue;
        // +dir traffic (lanes on the + side) enters at u0; -dir at u1
        for (let s = -1; s <= 1; s += 2) {
          const u = s > 0 ? u0 + gap * 0.35 : u1 - gap * 0.35;
          const lat = s * (half + 0.6);
          const x = r.vertical ? r.x + lat : u, z = r.vertical ? u : r.z + lat;
          const nx = r.vertical ? 0 : -s, nz = r.vertical ? -s : 0;
          if (!DK.free(x, z, { doorR: 3.0, ring: 1 })) continue;
          sign(x, z, nx, nz, cellI, C_SPEED_BACK, 0.6, 0.75, 2.1 + 0.375, 2.9);
          speedN++;
        }
      }
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
        // parking regulation only: speed limits are placed per block, above
        const front = pick < 0.5 ? C_NOPARK : (pick < 0.72 ? C_TOW : (pick < 0.88 ? C_PARK : C_FIRELANE));
        sign(sx, sz, -p.nx, -p.nz, front, C_RECT_BACK, 0.42, 0.63, 2.1 + 0.315, 2.8);
        plateN++;
        return true;
      }
      // (b) kerb-inlet storm drain — sits ON the kerb line, flush, no collider
      if (h > 0.90 && drainN < DRAIN_MAX) {
        const gx = p.x - p.nx * 0.95, gz = p.z - p.nz * 0.95;   // back at the gutter
        drains.add(gx, gY(gx, gz), gz, { ry: Math.atan2(-p.nx, -p.nz) });
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
          bollards.add(ox, gY(ox, oz), oz, { tint: 0.92 + DK.h01(ox, oz, 0x4433) * 0.16 });
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
        bikes.add(bx, gY(bx, bz), bz, { ry: yaw });
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
    let dumpN = 0, bagN = 0;
    const DUMP_MAX = DK.count(55), BAG_MAX = DK.count(110);
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
          dumps.add(ox, gY(ox, oz), oz, { ry: yaw, tint: 0.88 + DK.h01(ox, oz, 0x4443) * 0.24 });
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
            bags.add(gx, gY(gx, gz), gz, { ry: DK.h01(gx, gz, 0x4444) * 6.28, sx: 0.85 + DK.h01(gx, gz, 0x4445) * 0.4, sz: 0.85 + DK.h01(gz, gx, 0x4446) * 0.4 });
            DK.claim(gx, gz); bagN++;
          }
        }
      }
      // DE-SLOP (2026-09-27): no pallets, crate stacks or site barriers at the
      // back wall any more. A lone pallet, a crate with a second crate balanced
      // on it, a roadworks A-frame guarding nothing: props with no reason to be
      // there, which is exactly what the owner called slop. The dumpster and
      // its bags (a building's real waste point) are what an alley keeps.
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
        litter.add(gx, gY(gx, gz) + 0.005, gz, {
          ry: DK.h01(gx, gz, 0x4452) * 6.28,
          sx: 0.7 + DK.h01(gx, gz, 0x4453) * 0.7, sz: 0.7 + DK.h01(gz, gx, 0x4454) * 0.7,
        });
        litN++; did = true;
      }
      // weeds grow where the kerb meets the slab, and against wall bases
      if (h > 0.42 && h < 0.78 && weedN < WEED_MAX) {
        const wx = p.x - p.nx * 0.16 + p.nz * DK.h11(p.x, p.z, 0x4455) * 0.5;
        const wz = p.z - p.nz * 0.16 - p.nx * DK.h11(p.x, p.z, 0x4455) * 0.5;
        weeds.add(wx, gY(wx, wz), wz, {
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
          weeds.add(wx, gY(wx, wz), wz, {
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
    bikes.build(root);
    litter.build(root);
    weeds.build(root);
    // hand the census to city/props.js's ratchet (CBZ.propPurgeAudit)
    if (CBZ.propPurgeCensus) CBZ.propPurgeCensus({ alleyRemoved: cutN, alleySolids: dumpN + bollN });
  });
})();
