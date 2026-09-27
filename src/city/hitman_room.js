/* ============================================================
   city/hitman_room.js — THE MOTEL ROOM IS THE MENU (CBZ.hmRoom).

   OWNER (2026-09-27): "I hate a popup that says 'the wall' and then a 'read
   wall' button... look at the room they spawn in and make the assets and
   things in that room more meaningful."

   So there is no card and no menu. There is a rented room: a corkboard over
   the desk you walk up to and read, a burner that buzzes on the bedspread,
   an envelope that slides in under the door, a TV left on the local news, a
   hard case on the table that IS the loadout, an open rail of clothes that
   IS the wardrobe, and a bed that is how the night passes. Every one of them
   is used through the only prompt the game has: a verb on the thing you are
   looking at (CBZ.hmVerbs, city/hitman_hands.js), and "looking closely" is
   CBZ.hmInspect leaning the camera in.

   PUBLIC API (the Hitman contract, section B):
     ensure() -> room | null   {name, lot, spawn:{x,z,heading}, door:{x,z},
                               board:{x,z}, center:{x,z}, inside(x,z)}
     board.set(items) / items() / reset() / defaults() / refresh()
     phone.ring({from, onAnswer}) / stop() / ringing()
     door.deliver(kind, {canvas, verb, onPick}) / clear(kind) / waiting(kind)
     tv.show(canvas) / tv.idle()
     gunCase.open() / close() / isOpen()
     closet.open()
     sleep.now() / sleep.until(hour, done)
     on(event, cb)  events: enter leave answer pick change sleep
     onChange(cb)   (= on('change', cb))
     inRoom() -> bool
   CBZ.hitmanRoom() is the compat alias origins.js / campaign.js read.

   ------------------------------------------------------------------
   THE ROOM IN LOCAL METRES (origin = centre of the floor, y up).
   The whole group is yawed by a multiple of 90 degrees so +Z (the front,
   the door and the window) faces the nearest street. Because the yaw is
   axis-aligned, every local rectangle below maps to an EXACT world AABB,
   which is what CBZ.colliders needs (the old annex used a free yaw and
   bounded diagonal walls by their AABB, which filled the room).

     interior      x -3.25..3.25   z -2.50..2.50   floor y 0, ceiling 2.70
     wall shell    0.15 thick outside that (to x +-3.40, z +-2.65)

                         BACK WALL (z = -2.50)
      x: -3.25   -2.8  -1.7 [desk -1.45..-0.15] 0.1     2.0 [bath] 2.8  3.25
          +-------+------[====corkboard====]------------+=====+-----+
          |nstand |       desk + chair (-0.8,-1.55)      bath door   |
          |lamp   |                                                  | dresser
    LEFT  |=======|   (headboard on the left wall)                   | x 2.75..3.25
    WALL  |  BED  x -3.25..-1.20, z -1.175..0.275                    | z -1.40..0.00
          |  phone on the spread at (-1.60, -0.30)                   | TV faces -x
          |=======|                                                  |
          |nstand2 z 0.40..0.85 (ashtray)                            | rail alcove
          |                     SPAWN (0.35, 1.15)                   | x 2.68..3.25
          | table x -2.70..-1.50, z 1.45..2.25 (gun case)  chair     | z 0.33..1.47
          +---[ window x -2.60..-1.00, y 0.95..2.05 ]------[door]----+
                         FRONT WALL (z = +2.50)       gap x 1.90..2.80
                                                      hinge x 2.80, swings in
     ceiling fixture + the ONE PointLight   (0.30, 2.35, -0.20)
     corkboard centre (-0.80, 1.62) on the back wall, 1.8 x 1.1, cork face
       at z -2.47; paper layers at +0.025 + 0.004 i off the cork.
     envelope lands at (2.30, 0.006, 2.18) after sliding from z 2.62.

   COLLIDERS (y0 = floor, world AABB, all tagged _hmRoom):
     back wall   x -3.40..3.40  z -2.65..-2.50
     left wall   x -3.40..-3.25 z -2.65..2.65
     right wall  x  3.25..3.40  z -2.65..2.65
     front       x -3.40..1.90 and 2.80..3.40, z 2.50..2.65
     door leaf   x  1.90..2.80  z 2.45..2.65   (only while closed)
     bed 0.62 high, nightstands, desk, dresser, table, rail alcove.
     STEP_UP is 0.45, so the bed (0.62) blocks instead of being stepped on.

   LIGHT. One PointLight, added at build (r128 recompiles every material in
   the scene when the light COUNT changes, so it is never added or removed at
   runtime). Everything else that glows (lamp shade, ceiling dome, TV, phone
   screen, the porch light) is emissive or Basic. The shell casts shadows and
   the interior receives them, so the noon sun does not light the bedspread
   through the roof; daylight comes in as the blind stripes on the carpet,
   faded with CBZ.nightAmount.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE || !CBZ.game) return;
  const g = CBZ.game;

  /* ---------------- constants ------------------------------------------ */
  const HX = 3.25, HZ = 2.5, IH = 2.7, WT = 0.15;
  const OX = HX + WT, OZ = HZ + WT;                 // outer shell half extents
  const DOOR = { x0: 1.9, x1: 2.8, h: 2.08 };
  const WIN = { x0: -2.6, x1: -1.0, y0: 0.95, y1: 2.05 };
  const BED = { x0: -3.25, x1: -1.2, z0: -1.175, z1: 0.275, top: 0.6 };
  const BOARD = { x: -0.8, y: 1.62, z: -HZ + 0.03, w: 1.8, h: 1.1 };
  const TABLE = { x: -2.1, z: 1.85, w: 1.2, d: 0.8, top: 0.755 };
  const DRESSER = { x0: 2.75, x1: 3.25, z0: -1.4, z1: 0.0, top: 0.78 };
  const RAIL = { x0: 2.68, x1: 3.25, z0: 0.33, z1: 1.47, x: 2.97, y: 1.82 };
  const SPAWN = { x: 0.35, z: 1.15 };
  const LIGHT_AT = { x: 0.3, y: 2.35, z: -0.2 };
  const PHONE_AT = { x: -1.6, z: -0.3 };

  /* ---------------- small reads ------------------------------------------ */
  function arena() { return CBZ.city && CBZ.city.arena; }
  function P() { return CBZ.player || null; }
  function playing() { return g.mode === "city" && g.state === "playing"; }
  function floorY(x, z) { try { return CBZ.floorAt ? (CBZ.floorAt(x, z) || 0) : 0; } catch (e) { return 0; } }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function now() { return (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000; }
  function night() { return CBZ.nightAmount == null ? 0 : clamp(CBZ.nightAmount, 0, 1); }
  function records() {
    try {
      const w = CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null;
      if (!w) return null;
      w.records = w.records || {};
      w.records.hitman = w.records.hitman || { contracts: 0, completed: 0, failed: 0, highValue: 0, heat: 0, paid: 0 };
      return w.records.hitman;
    } catch (e) { return null; }
  }
  function rng(seed) {
    let s = (seed >>> 0) || 1;
    return function () { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function paperKit() { return CBZ.hmPaper || null; }

  /* ================================================================
     TEXTURES — canvas-painted, metric-tiled (see metricUV), sRGB-decoded
     (core/renderer.js outputs sRGB; an sRGB canvas uploaded LINEAR reads
     washed out, the lesson of the pale road).
     ================================================================ */
  function aniso() {
    try { return Math.min(8, CBZ.renderer && CBZ.renderer.capabilities ? CBZ.renderer.capabilities.getMaxAnisotropy() : 1); } catch (e) { return 1; }
  }
  function cv(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  function speckle(cc, w, h, seed, n, dark, light, size) {
    const r = rng(seed);
    for (let i = 0; i < n; i++) {
      const x = r() * w, y = r() * h, s = (size || 1.6) * (0.5 + r());
      cc.fillStyle = r() < 0.5 ? dark : light;
      cc.fillRect(x, y, s, s);
    }
  }
  function tileTex(c, tile, opts) {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1 / (tile || 1), 1 / ((opts && opts.tileV) || tile || 1));
    if (THREE.sRGBEncoding != null) t.encoding = THREE.sRGBEncoding;
    t.anisotropy = aniso();
    t._shared = true;
    return t;
  }
  function paperTex(c) {
    const t = new THREE.CanvasTexture(c);
    if (THREE.sRGBEncoding != null) t.encoding = THREE.sRGBEncoding;
    t.anisotropy = aniso();
    t.minFilter = THREE.LinearMipmapLinearFilter || t.minFilter;
    return t;
  }

  const PAINT = {
    carpet: function () {
      // the motel carpet: a dark plum ground, a small repeating lozenge in
      // teal and dull gold, worn pile noise. 0.5 m repeat.
      const c = cv(256, 256), cc = c.getContext("2d");
      cc.fillStyle = "#3a2a31"; cc.fillRect(0, 0, 256, 256);
      speckle(cc, 256, 256, 11, 9000, "rgba(0,0,0,.22)", "rgba(255,230,210,.06)", 1.2);
      for (let gy = 0; gy < 4; gy++) for (let gx = 0; gx < 4; gx++) {
        const x = gx * 64 + (gy % 2 ? 32 : 0), y = gy * 64 + 32;
        cc.strokeStyle = "rgba(64,112,108,.75)"; cc.lineWidth = 3;
        cc.beginPath(); cc.moveTo(x, y - 18); cc.lineTo(x + 14, y); cc.lineTo(x, y + 18); cc.lineTo(x - 14, y); cc.closePath(); cc.stroke();
        cc.fillStyle = "rgba(170,132,64,.7)"; cc.beginPath(); cc.arc(x, y, 3.2, 0, 6.29); cc.fill();
        cc.fillStyle = "rgba(170,132,64,.35)";
        cc.fillRect(x - 32, y - 1, 10, 2); cc.fillRect(x + 22, y - 1, 10, 2);
      }
      speckle(cc, 256, 256, 12, 2600, "rgba(20,10,14,.35)", "rgba(120,90,100,.12)", 1);
      return tileTex(c, 0.55);
    },
    wallpaper: function () {
      // tired beige paper, a faint tone-on-tone stripe and a small damask dot
      const c = cv(256, 256), cc = c.getContext("2d");
      cc.fillStyle = "#c9b996"; cc.fillRect(0, 0, 256, 256);
      for (let x = 0; x < 256; x += 32) { cc.fillStyle = "rgba(120,96,60,.08)"; cc.fillRect(x, 0, 12, 256); }
      for (let y = 16; y < 256; y += 32) for (let x = 22; x < 256; x += 32) {
        cc.fillStyle = "rgba(140,110,70,.16)";
        cc.beginPath(); cc.ellipse(x, y + ((x / 32) % 2 ? 16 : 0), 3, 5, 0, 0, 6.29); cc.fill();
      }
      speckle(cc, 256, 256, 21, 5000, "rgba(90,70,40,.06)", "rgba(255,250,235,.05)", 1.4);
      const gr = cc.createLinearGradient(0, 0, 0, 256);
      gr.addColorStop(0, "rgba(90,70,40,.05)"); gr.addColorStop(1, "rgba(90,70,40,0)");
      cc.fillStyle = gr; cc.fillRect(0, 0, 256, 256);
      return tileTex(c, 0.53);
    },
    stucco: function () {
      const c = cv(256, 256), cc = c.getContext("2d");
      cc.fillStyle = "#d4c4a4"; cc.fillRect(0, 0, 256, 256);
      speckle(cc, 256, 256, 31, 14000, "rgba(80,64,40,.16)", "rgba(255,248,230,.22)", 1.5);
      speckle(cc, 256, 256, 32, 400, "rgba(80,64,40,.12)", "rgba(255,248,230,.12)", 5);
      return tileTex(c, 1.3);
    },
    ceiling: function () {
      const c = cv(128, 128), cc = c.getContext("2d");
      cc.fillStyle = "#e3ddd0"; cc.fillRect(0, 0, 128, 128);
      speckle(cc, 128, 128, 41, 3000, "rgba(90,80,60,.12)", "rgba(255,255,255,.3)", 1.3);
      return tileTex(c, 0.7);
    },
    wood: function (base, streak, seed) {
      const c = cv(256, 256), cc = c.getContext("2d");
      cc.fillStyle = base; cc.fillRect(0, 0, 256, 256);
      const r = rng(seed || 51);
      for (let i = 0; i < 90; i++) {
        const y = r() * 256, a = 0.05 + r() * 0.12;
        cc.strokeStyle = streak.replace("A", a.toFixed(3)); cc.lineWidth = 0.6 + r() * 2.2;
        cc.beginPath(); cc.moveTo(0, y);
        for (let x = 0; x <= 256; x += 32) cc.lineTo(x, y + Math.sin(x * 0.03 + i) * (1.5 + r() * 3));
        cc.stroke();
      }
      speckle(cc, 256, 256, (seed || 51) + 1, 1500, "rgba(0,0,0,.08)", "rgba(255,240,220,.05)", 1);
      return tileTex(c, 0.9);
    },
    bedspread: function () {
      // a quilted burgundy spread: stitched diamond grid, a paler medallion
      const c = cv(256, 256), cc = c.getContext("2d");
      cc.fillStyle = "#6a2330"; cc.fillRect(0, 0, 256, 256);
      speckle(cc, 256, 256, 61, 6000, "rgba(0,0,0,.14)", "rgba(255,210,200,.06)", 1.3);
      cc.strokeStyle = "rgba(214,176,120,.55)"; cc.lineWidth = 1.5; cc.setLineDash([4, 3]);
      for (let k = -256; k < 512; k += 42) {
        cc.beginPath(); cc.moveTo(k, 0); cc.lineTo(k + 256, 256); cc.stroke();
        cc.beginPath(); cc.moveTo(k, 256); cc.lineTo(k + 256, 0); cc.stroke();
      }
      cc.setLineDash([]);
      for (let y = 0; y < 256; y += 84) for (let x = 0; x < 256; x += 84) {
        const cx = x + 42, cy = y + 42;
        cc.fillStyle = "rgba(205,160,110,.35)";
        for (let p = 0; p < 6; p++) { const a = p * 1.047; cc.beginPath(); cc.ellipse(cx + Math.cos(a) * 9, cy + Math.sin(a) * 9, 7, 3.5, a, 0, 6.29); cc.fill(); }
        cc.fillStyle = "rgba(60,90,70,.6)"; cc.beginPath(); cc.arc(cx, cy, 4, 0, 6.29); cc.fill();
      }
      return tileTex(c, 0.84);
    },
    linen: function () {
      const c = cv(128, 128), cc = c.getContext("2d");
      cc.fillStyle = "#ece8df"; cc.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 128; i += 2) { cc.fillStyle = "rgba(120,110,90,.05)"; cc.fillRect(i, 0, 1, 128); cc.fillRect(0, i, 128, 1); }
      return tileTex(c, 0.25);
    },
    cork: function () {
      const c = cv(256, 256), cc = c.getContext("2d");
      cc.fillStyle = "#a47748"; cc.fillRect(0, 0, 256, 256);
      speckle(cc, 256, 256, 71, 16000, "rgba(70,40,15,.35)", "rgba(230,190,140,.3)", 2);
      speckle(cc, 256, 256, 72, 900, "rgba(50,28,10,.45)", "rgba(210,170,120,.25)", 3.5);
      // pin holes from years of other people's paper
      const r = rng(73);
      for (let i = 0; i < 60; i++) { cc.fillStyle = "rgba(30,15,5,.55)"; cc.beginPath(); cc.arc(r() * 256, r() * 256, 0.9, 0, 6.29); cc.fill(); }
      return tileTex(c, 0.45);
    },
    foam: function () {
      // egg-crate case foam
      const c = cv(128, 128), cc = c.getContext("2d");
      cc.fillStyle = "#26272a"; cc.fillRect(0, 0, 128, 128);
      for (let y = 0; y < 128; y += 16) for (let x = 0; x < 128; x += 16) {
        const gr = cc.createRadialGradient(x + 8, y + 8, 1, x + 8, y + 8, 9);
        gr.addColorStop(0, "rgba(90,92,98,.55)"); gr.addColorStop(1, "rgba(0,0,0,.35)");
        cc.fillStyle = gr; cc.fillRect(x, y, 16, 16);
      }
      speckle(cc, 128, 128, 81, 1500, "rgba(0,0,0,.25)", "rgba(120,120,130,.12)", 1);
      return tileTex(c, 0.12);
    },
    concrete: function () {
      const c = cv(128, 128), cc = c.getContext("2d");
      cc.fillStyle = "#8d8980"; cc.fillRect(0, 0, 128, 128);
      speckle(cc, 128, 128, 91, 4000, "rgba(40,40,40,.2)", "rgba(255,255,255,.12)", 1.4);
      return tileTex(c, 1.0);
    },
    roof: function () {
      const c = cv(128, 128), cc = c.getContext("2d");
      cc.fillStyle = "#3d3b38"; cc.fillRect(0, 0, 128, 128);
      speckle(cc, 128, 128, 101, 5000, "rgba(0,0,0,.3)", "rgba(190,180,160,.25)", 1.6);
      return tileTex(c, 0.8);
    },
    blinds: function () {
      // horizontal slats with thin gaps (alphaTest cuts the gaps)
      const c = cv(64, 256), cc = c.getContext("2d");
      cc.clearRect(0, 0, 64, 256);
      for (let y = 0; y < 256; y += 16) {
        const gr = cc.createLinearGradient(0, y, 0, y + 13);
        gr.addColorStop(0, "#f2eee4"); gr.addColorStop(0.55, "#ddd6c6"); gr.addColorStop(1, "#b9b09c");
        cc.fillStyle = gr; cc.fillRect(0, y, 64, 13);
      }
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      if (THREE.sRGBEncoding != null) t.encoding = THREE.sRGBEncoding;
      t._shared = true;
      return t;
    },
    stripes: function () {
      // sunlight through the blinds: soft warm bars on a black ground (additive)
      const c = cv(128, 256), cc = c.getContext("2d");
      cc.fillStyle = "#000"; cc.fillRect(0, 0, 128, 256);
      for (let y = 0; y < 256; y += 21) {
        const gr = cc.createLinearGradient(0, y, 0, y + 9);
        gr.addColorStop(0, "rgba(255,226,170,0)"); gr.addColorStop(0.5, "rgba(255,226,170,1)"); gr.addColorStop(1, "rgba(255,226,170,0)");
        cc.fillStyle = gr; cc.fillRect(0, y, 128, 9);
      }
      const edge = cc.createLinearGradient(0, 0, 128, 0);
      edge.addColorStop(0, "rgba(0,0,0,1)"); edge.addColorStop(0.12, "rgba(0,0,0,0)"); edge.addColorStop(0.88, "rgba(0,0,0,0)"); edge.addColorStop(1, "rgba(0,0,0,1)");
      cc.fillStyle = edge; cc.fillRect(0, 0, 128, 256);
      const t = new THREE.CanvasTexture(c);
      if (THREE.sRGBEncoding != null) t.encoding = THREE.sRGBEncoding;
      t._shared = true;
      return t;
    },
    kraft: function () {
      const c = cv(128, 128), cc = c.getContext("2d");
      cc.fillStyle = "#a9814f"; cc.fillRect(0, 0, 128, 128);
      speckle(cc, 128, 128, 111, 2500, "rgba(60,40,20,.2)", "rgba(240,210,160,.15)", 1.3);
      return tileTex(c, 0.3);
    },
    dresserFace: function () {
      // walnut veneer with three drawer seams per 0.26 m and brass pulls
      const c = cv(256, 256), cc = c.getContext("2d");
      cc.drawImage(PAINT._walnutCanvas(), 0, 0);
      for (let y = 0; y < 256; y += 85) { cc.fillStyle = "rgba(10,5,2,.8)"; cc.fillRect(0, y, 256, 3); }
      for (let y = 42; y < 256; y += 85) for (let x = 64; x < 256; x += 128) {
        cc.fillStyle = "#b08a45"; cc.fillRect(x - 14, y - 2, 28, 5);
        cc.fillStyle = "rgba(255,240,200,.5)"; cc.fillRect(x - 14, y - 2, 28, 1.5);
      }
      const t = new THREE.CanvasTexture(c);
      if (THREE.sRGBEncoding != null) t.encoding = THREE.sRGBEncoding;
      t.anisotropy = aniso(); t._shared = true;
      return t;
    },
    _walnut: null,
    _walnutCanvas: function () {
      if (PAINT._walnut) return PAINT._walnut;
      const c = cv(256, 256), cc = c.getContext("2d");
      cc.fillStyle = "#4b3120"; cc.fillRect(0, 0, 256, 256);
      const r = rng(55);
      for (let i = 0; i < 80; i++) {
        const y = r() * 256; cc.strokeStyle = "rgba(20,10,4," + (0.06 + r() * 0.14).toFixed(3) + ")"; cc.lineWidth = 0.6 + r() * 2;
        cc.beginPath(); cc.moveTo(0, y); for (let x = 0; x <= 256; x += 32) cc.lineTo(x, y + Math.sin(x * 0.03 + i) * 2.5); cc.stroke();
      }
      PAINT._walnut = c;
      return c;
    },
  };

  /* ---------------- shared materials (built once, kept across worlds) ---- */
  let M = null;
  function std(o) {
    const m = new THREE.MeshStandardMaterial({
      color: o.color != null ? o.color : 0xffffff, roughness: o.roughness != null ? o.roughness : 0.85,
      metalness: o.metalness || 0, map: o.map || null,
    });
    if (o.emissive != null) { m.emissive = new THREE.Color(o.emissive); m.emissiveIntensity = o.ei != null ? o.ei : 1; }
    if (o.side) m.side = o.side;
    if (o.transparent) { m.transparent = true; m.opacity = o.opacity != null ? o.opacity : 1; m.depthWrite = o.depthWrite !== false; }
    if (o.alphaTest) m.alphaTest = o.alphaTest;
    m._shared = true;
    return m;
  }
  function mats() {
    if (M) return M;
    const walnutTex = tileTex(PAINT._walnutCanvas(), 0.9);
    M = {
      stucco: std({ map: PAINT.stucco(), roughness: 0.95 }),
      trim: std({ color: 0x8f6b4a, roughness: 0.8 }),
      roof: std({ map: PAINT.roof(), roughness: 1 }),
      concrete: std({ map: PAINT.concrete(), roughness: 1 }),
      ceiling: std({ map: PAINT.ceiling(), roughness: 1 }),
      wallpaper: std({ map: PAINT.wallpaper(), roughness: 0.92 }),
      carpet: std({ map: PAINT.carpet(), roughness: 1 }),
      baseboard: std({ color: 0xd8d0bf, roughness: 0.6 }),
      walnut: std({ map: walnutTex, roughness: 0.6 }),
      oak: std({ map: PAINT.wood("#8a6641", "rgba(40,22,8,A)", 57), roughness: 0.65 }),
      dresserFace: std({ map: PAINT.dresserFace(), roughness: 0.6 }),
      spread: std({ map: PAINT.bedspread(), roughness: 0.95 }),
      linen: std({ map: PAINT.linen(), roughness: 0.95 }),
      cork: std({ map: PAINT.cork(), roughness: 1 }),
      frameWood: std({ color: 0x5a3a22, roughness: 0.55 }),
      foam: std({ map: PAINT.foam(), roughness: 1 }),
      foamCut: std({ color: 0x0d0e10, roughness: 1 }),
      caseShell: std({ color: 0x1b1d20, roughness: 0.55 }),
      caseTrim: std({ color: 0x5c6066, roughness: 0.4, metalness: 0.5 }),
      gunMetal: std({ color: 0x24272b, roughness: 0.42, metalness: 0.45 }),
      gunPoly: std({ color: 0x2b2d30, roughness: 0.8 }),
      gunWood: std({ color: 0x5b3a22, roughness: 0.55 }),
      gunOlive: std({ color: 0x3c3f33, roughness: 0.85 }),
      glassLens: std({ color: 0x223040, roughness: 0.1, metalness: 0.3 }),
      steel: std({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.6 }),
      brass: std({ color: 0xb08a45, roughness: 0.35, metalness: 0.6 }),
      black: std({ color: 0x131416, roughness: 0.45 }),
      plastic: std({ color: 0x2c2e31, roughness: 0.6 }),
      doorPaint: std({ color: 0x6b4630, roughness: 0.5 }),
      bathDoor: std({ color: 0xe2dccd, roughness: 0.55 }),
      shadeOn: std({ color: 0xf1dfb8, emissive: 0xffc58a, ei: 0.85, roughness: 1, side: THREE.DoubleSide }),
      bulbDome: std({ color: 0xfff4de, emissive: 0xffe2b0, ei: 0.9, roughness: 1 }),
      porch: std({ color: 0xfff1d0, emissive: 0xffd790, ei: 1.0, roughness: 1 }),
      ceramic: std({ color: 0xece6da, roughness: 0.35 }),
      glassAsh: std({ color: 0x9fb2b0, roughness: 0.1, transparent: true, opacity: 0.55 }),
      kraft: std({ map: PAINT.kraft(), roughness: 1 }),
      cupWhite: std({ color: 0xf2efe8, roughness: 0.7 }),
      coffeeLid: std({ color: 0x2a2624, roughness: 0.5 }),
      acUnit: std({ color: 0xcfc9bb, roughness: 0.7 }),
      grille: std({ color: 0x5d5a55, roughness: 0.8 }),
      tape: std({ color: 0x8e9196, roughness: 0.6 }),
      wireRed: std({ color: 0x9c1c16, roughness: 0.5 }),
      vialGlass: std({ color: 0xb8d0d8, roughness: 0.05, transparent: true, opacity: 0.45 }),
      vialLiquid: std({ color: 0x7f9a4a, roughness: 0.2, transparent: true, opacity: 0.85 }),
      pinRed: std({ color: 0xb3261e, roughness: 0.35 }),
      pinWhite: std({ color: 0xe8e4da, roughness: 0.35 }),
      string: new THREE.MeshBasicMaterial({ color: 0x8c1a17 }),
      glass: new THREE.MeshBasicMaterial({ color: 0x9fb4c0, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide }),
      blinds: std({ map: PAINT.blinds(), roughness: 0.8, alphaTest: 0.5, side: THREE.DoubleSide }),
      sunStripes: new THREE.MeshBasicMaterial({ map: PAINT.stripes(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.3 }),
      tvOff: std({ color: 0x0d0f12, roughness: 0.25 }),
      newsprint: std({ color: 0xe0dccf, roughness: 1 }),
    };
    M.blinds.map.repeat.set(1, 1);
    M.string._shared = M.glass._shared = M.sunStripes._shared = true;
    return M;
  }

  /* ================================================================
     GEOMETRY HELPERS
     ================================================================ */
  // scale a geometry's UVs so 1 UV unit = 1 metre (textures carry the tile)
  function scaleUV(geo, su, sv) {
    const uv = geo.attributes.uv; if (!uv) return geo;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    uv.needsUpdate = true;
    return geo;
  }
  // BoxGeometry with metric UVs per face (r128 face order: px nx py ny pz nz,
  // 4 verts each at one segment; px/nx u=depth v=height, py/ny u=width
  // v=depth, pz/nz u=width v=height)
  function boxGeo(w, h, d) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const uv = geo.attributes.uv;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]);
    }
    uv.needsUpdate = true;
    return geo;
  }
  function planeGeo(w, h) { return scaleUV(new THREE.PlaneGeometry(w, h), w, h); }
  // a box with rounded edges and corners (cushions, pillows, cases, knobs)
  function roundBox(w, h, d, r, seg) {
    r = Math.max(0.0005, Math.min(r, w / 2 - 0.0005, h / 2 - 0.0005, d / 2 - 0.0005));
    const sw = Math.max(0.0005, w - 2 * r), sd = Math.max(0.0005, d - 2 * r);
    const cr = Math.min(sw, sd) * 0.18;
    const s = new THREE.Shape();
    const x0 = -sw / 2, x1 = sw / 2, y0 = -sd / 2, y1 = sd / 2;
    s.moveTo(x0 + cr, y0); s.lineTo(x1 - cr, y0); s.quadraticCurveTo(x1, y0, x1, y0 + cr);
    s.lineTo(x1, y1 - cr); s.quadraticCurveTo(x1, y1, x1 - cr, y1);
    s.lineTo(x0 + cr, y1); s.quadraticCurveTo(x0, y1, x0, y1 - cr);
    s.lineTo(x0, y0 + cr); s.quadraticCurveTo(x0, y0, x0 + cr, y0);
    const depth = Math.max(0.0005, h - 2 * r);
    const geo = new THREE.ExtrudeGeometry(s, { depth: depth, bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelOffset: 0, bevelSegments: seg || 2, curveSegments: 3 });
    geo.translate(0, 0, -depth / 2);
    geo.rotateX(-Math.PI / 2);                     // extrusion axis -> +Y; shape Y -> -Z
    return geo;
  }
  // a flat profile (points in XY) extruded `depth` thick, centred on z
  function profile(pts, depth, bevel) {
    const s = new THREE.Shape();
    s.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
    s.closePath();
    const b = bevel || 0;
    const geo = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, depth - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b * 0.8, bevelSegments: 1, curveSegments: 4 });
    geo.translate(0, 0, -(depth - 2 * b) / 2);
    return geo;
  }
  // a cylinder whose axis runs along +X from x0 to x1 (r0 at x0, r1 at x1)
  function rod(x0, x1, r0, r1, seg) {
    const len = Math.abs(x1 - x0);
    const geo = new THREE.CylinderGeometry(r1, r0, len, seg || 12, 1);
    geo.rotateZ(-Math.PI / 2);                     // +Y -> +X (radiusTop lands at +X)
    geo.translate((x0 + x1) / 2, 0, 0);
    return geo;
  }

  /* ---------------- the static batcher -------------------------------------
     Collect every non-moving piece with its material key and bake it into
     one merged mesh per material: the whole room shell + furniture is a
     couple of dozen draw calls instead of a few hundred. */
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
  function Batch() { this.by = {}; }
  Batch.prototype.add = function (geo, key, x, y, z, rx, ry, rz) {
    _e.set(rx || 0, ry || 0, rz || 0);
    _q.setFromEuler(_e);
    _m4.compose(_v.set(x || 0, y || 0, z || 0), _q, _s);
    let gg = geo.index ? geo.toNonIndexed() : geo;
    if (gg !== geo) geo.dispose();
    gg.applyMatrix4(_m4);
    if (!gg.attributes.uv) {
      gg.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(gg.attributes.position.count * 2), 2));
    }
    // merge wants identical attribute sets: keep position/normal/uv only
    gg.clearGroups();
    const keep = { position: 1, normal: 1, uv: 1 };
    for (const k in gg.attributes) if (!keep[k]) gg.deleteAttribute(k);
    (this.by[key] || (this.by[key] = [])).push(gg);
  };
  Batch.prototype.finish = function (parent, B, flags) {
    const BGU = THREE.BufferGeometryUtils;
    const MM = mats();
    for (const key in this.by) {
      const list = this.by[key];
      let geo = null;
      if (list.length === 1) geo = list[0];
      else if (BGU && BGU.mergeBufferGeometries) {
        try { geo = BGU.mergeBufferGeometries(list, false); } catch (e) { geo = null; }
        if (geo) for (let i = 0; i < list.length; i++) list[i].dispose();
      }
      const mat = (B && B.mat && B.mat[key]) || MM[key];
      if (!geo) {                                    // no merger: meshes one by one
        for (let i = 0; i < list.length; i++) { const m = new THREE.Mesh(list[i], mat); tagMesh(m, key, flags); parent.add(m); if (B) B.geos.push(list[i]); }
        continue;
      }
      const mesh = new THREE.Mesh(geo, mat);
      tagMesh(mesh, key, flags);
      parent.add(mesh);
      if (B) B.geos.push(geo);
    }
    this.by = {};
  };
  const CASTERS = { stucco: 1, roof: 1, concrete: 1, trim: 1, acUnit: 1 };
  function tagMesh(m, key, flags) {
    m.matrixAutoUpdate = !(flags && flags.frozen);
    if (!m.matrixAutoUpdate) m.updateMatrix();
    m.castShadow = !!CASTERS[key];
    m.receiveShadow = true;
  }

  /* ================================================================
     STATE
     ================================================================ */
  let B = null;                                    // the built room
  let refusedRoot = null;
  const subs = { enter: [], leave: [], answer: [], pick: [], change: [], sleep: [] };
  function emit(ev, data) {
    const L = subs[ev]; if (!L) return;
    for (let i = 0; i < L.length; i++) { try { L[i](data); } catch (e) { if (window.console) console.error("[hmRoom] " + ev, e); } }
  }

  // local <-> world (yaw is a multiple of 90 degrees; see the header)
  function W(lx, ly, lz) {
    const c = B.cos, s = B.sin;
    return { x: B.ox + lx * c + lz * s, y: B.gy + (ly || 0), z: B.oz - lx * s + lz * c };
  }
  function L(wx, wz) {
    const dx = wx - B.ox, dz = wz - B.oz, c = B.cos, s = B.sin;
    return { x: dx * c - dz * s, z: dx * s + dz * c };
  }
  function insideLocal(lx, lz, pad) { pad = pad || 0; return lx > -HX - pad && lx < HX + pad && lz > -HZ - pad && lz < HZ + pad; }

  /* ================================================================
     PLACEMENT — beside the motel (or the fallback rented lot), refused
     rather than forced when nothing is clear.
     ================================================================ */
  function motelLot() {
    if (CBZ.cityFindMotelLot) { try { const l = CBZ.cityFindMotelLot(); if (l) return l; } catch (e) {} }
    const A = arena(); if (!A || !A.lots) return null;
    let home = null;
    for (let i = 0; i < A.lots.length; i++) {
      const l = A.lots[i];
      if (!l || !l.building) continue;
      if (l.kind === "motel") return l;
      if (!home && (l.kind === "home" || l.kind === "house" || l.kind === "tower")) home = l;
    }
    return home;
  }
  function roadRects(A) {
    const out = [], rs = (A && A.roads) || [];
    const RW = (A && A.ROAD) || 12;
    for (let i = 0; i < rs.length; i++) {
      const r = rs[i]; if (!r || r.x == null || r.z == null) continue;
      const w = (r.w || RW) / 2, h = (r.len || 0) / 2;
      out.push(r.vertical ? { minX: r.x - w, maxX: r.x + w, minZ: r.z - h, maxZ: r.z + h, r: r } : { minX: r.x - h, maxX: r.x + h, minZ: r.z - w, maxZ: r.z + w, r: r });
    }
    return out;
  }
  function place() {
    const A = arena();
    const lot = motelLot();
    if (!lot || !lot.building || !lot.building.door) return null;
    const door = lot.building.door;
    const cols = CBZ.colliders || [];
    const near = [];
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (!c || c._hmRoom || c._hitmanRoom) continue;
      if (c.maxX < door.x - 80 || c.minX > door.x + 80 || c.maxZ < door.z - 80 || c.minZ > door.z + 80) continue;
      near.push(c);
    }
    const roads = roadRects(A);
    function nearestRoad(x, z) {
      let best = null, bd = Infinity;
      for (let i = 0; i < roads.length; i++) {
        const R = roads[i];
        const dx = Math.max(R.minX - x, 0, x - R.maxX), dz = Math.max(R.minZ - z, 0, z - R.maxZ);
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = R; }
      }
      return best ? { R: best, d: Math.sqrt(bd) } : null;
    }
    // the front faces the nearest street, snapped to an axis
    function facing(x, z) {
      const nr = nearestRoad(x, z);
      if (nr) {
        const r = nr.R.r;
        if (r.vertical) return { nx: Math.sign(r.x - x) || 1, nz: 0, road: nr.d };
        return { nx: 0, nz: Math.sign(r.z - z) || 1, road: nr.d };
      }
      let nx = door.nx || 0, nz = door.nz == null ? 1 : door.nz;
      if (Math.abs(nx) >= Math.abs(nz)) { nx = Math.sign(nx) || 1; nz = 0; } else { nz = Math.sign(nz) || 1; nx = 0; }
      return { nx: nx, nz: nz, road: 99 };
    }
    function test(x, z, strictRoads) {
      const f = facing(x, z);
      // footprint incl. the stoop / door swing out front (+1.2 m along n)
      const alongX = f.nx !== 0;
      const hx = (alongX ? OZ : OX) + 0.35, hz = (alongX ? OX : OZ) + 0.35;
      let minX = x - hx, maxX = x + hx, minZ = z - hz, maxZ = z + hz;
      if (f.nx > 0) maxX += 1.2; else if (f.nx < 0) minX -= 1.2; else if (f.nz > 0) maxZ += 1.2; else minZ -= 1.2;
      const gy = floorY(x, z);
      for (let i = 0; i < near.length; i++) {
        const c = near[i];
        if (c.y0 != null && (c.y1 < gy + 0.2 || c.y0 > gy + 3.2)) continue;
        if (maxX < c.minX || minX > c.maxX || maxZ < c.minZ || minZ > c.maxZ) continue;
        return null;
      }
      if (strictRoads) {
        for (let i = 0; i < roads.length; i++) {
          const R = roads[i];
          if (maxX < R.minX || minX > R.maxX || maxZ < R.minZ || minZ > R.maxZ) continue;
          return null;
        }
        if (f.road > 18) return null;                  // a motel unit fronts a street
      }
      // flat enough to sit a slab on
      let lo = Infinity, hi = -Infinity;
      const cs = [[minX, minZ], [maxX, minZ], [minX, maxZ], [maxX, maxZ], [x, z]];
      for (let i = 0; i < cs.length; i++) { const y = floorY(cs[i][0], cs[i][1]); lo = Math.min(lo, y); hi = Math.max(hi, y); }
      if (hi - lo > 0.45) return null;
      return { x: x, z: z, gy: gy, nx: f.nx, nz: f.nz };
    }
    // candidates: beside the door along the frontage first (the old annex's
    // addresses), then a deterministic spiral outward
    const cands = [];
    const n = { x: door.nx || 0, z: door.nz == null ? 1 : door.nz };
    const s = { x: -n.z, z: n.x };
    const flip = (CBZ.hash01 ? CBZ.hash01(lot.cx | 0, lot.cz | 0, 0x517) : 0.5) < 0.5 ? 1 : -1;
    [9.5, -9.5, 13, -13].forEach(function (a) {
      [2.2, 4.2, -1.5].forEach(function (o) { cands.push({ x: door.x + n.x * o + s.x * flip * a, z: door.z + n.z * o + s.z * flip * a }); });
    });
    for (let rad = 6; rad <= 60; rad += 3) {
      const k = Math.max(8, Math.round(rad * 1.6));
      for (let i = 0; i < k; i++) { const a = (i / k) * Math.PI * 2 + rad * 0.37; cands.push({ x: door.x + Math.cos(a) * rad, z: door.z + Math.sin(a) * rad }); }
    }
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < cands.length; i++) {
        const got = test(cands[i].x, cands[i].z, pass === 0);
        if (got) { got.lot = lot; return got; }
      }
    }
    return null;
  }

  /* ================================================================
     BUILD
     ================================================================ */
  function newMat(key, m) { B.mat[key] = m; B.ownMats.push(m); return m; }
  function mesh(geo, mat, parent, x, y, z, rx, ry, rz) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.castShadow = false; m.receiveShadow = true;
    (parent || B.group).add(m);
    B.geos.push(geo);
    return m;
  }

  function buildShell(S) {
    // foundation + stoop
    S.add(boxGeo(2 * OX + 0.1, 0.42, 2 * OZ + 0.1), "concrete", 0, -0.21, 0);
    S.add(boxGeo(1.6, 0.1, 0.8), "concrete", 2.35, -0.03, OZ + 0.4);
    // floor
    S.add(scaleUV(new THREE.PlaneGeometry(2 * HX, 2 * HZ).rotateX(-Math.PI / 2), 2 * HX, 2 * HZ), "carpet", 0, 0.004, 0);
    // ceiling (faces down) + roof slab + parapet
    S.add(scaleUV(new THREE.PlaneGeometry(2 * HX, 2 * HZ).rotateX(Math.PI / 2), 2 * HX, 2 * HZ), "ceiling", 0, IH, 0);
    S.add(boxGeo(2 * OX, 0.16, 2 * OZ), "roof", 0, IH + 0.09, 0);
    S.add(boxGeo(2 * OX + 0.12, 0.1, 0.12), "trim", 0, IH + 0.2, OZ + 0.0);     // fascia over the front
    // wall shells (stucco), their inner faces 1 cm behind the wallpaper
    const T = WT - 0.01, H = IH + 0.1, Y = H / 2 - 0.02;
    S.add(boxGeo(2 * OX, H, T), "stucco", 0, Y, -OZ + T / 2);                     // back
    S.add(boxGeo(T, H, 2 * OZ), "stucco", -OX + T / 2, Y, 0);                     // left
    S.add(boxGeo(T, H, 2 * OZ), "stucco", OX - T / 2, Y, 0);                      // right
    const fz = OZ - T / 2;
    function front(x0, x1, y0, y1) { S.add(boxGeo(x1 - x0, y1 - y0, T), "stucco", (x0 + x1) / 2, (y0 + y1) / 2, fz); }
    front(-OX, WIN.x0, -0.02, H - 0.02);
    front(WIN.x0, WIN.x1, -0.02, WIN.y0);
    front(WIN.x0, WIN.x1, WIN.y1, H - 0.02);
    front(WIN.x1, DOOR.x0, -0.02, H - 0.02);
    front(DOOR.x0, DOOR.x1, DOOR.h, H - 0.02);
    front(DOOR.x1, OX, -0.02, H - 0.02);
    // wallpaper (inner faces)
    function paperWall(w, h, x, y, z, ry) { S.add(planeGeo(w, h), "wallpaper", x, y, z, 0, ry, 0); }
    paperWall(2 * HX, IH, 0, IH / 2, -HZ, 0);
    paperWall(2 * HZ, IH, -HX, IH / 2, 0, Math.PI / 2);
    paperWall(2 * HZ, IH, HX, IH / 2, 0, -Math.PI / 2);
    function paperFront(x0, x1, y0, y1) { S.add(planeGeo(x1 - x0, y1 - y0), "wallpaper", (x0 + x1) / 2, (y0 + y1) / 2, HZ, 0, Math.PI, 0); }
    paperFront(-HX, WIN.x0, 0, IH); paperFront(WIN.x0, WIN.x1, 0, WIN.y0); paperFront(WIN.x0, WIN.x1, WIN.y1, IH);
    paperFront(WIN.x1, DOOR.x0, 0, IH); paperFront(DOOR.x0, DOOR.x1, DOOR.h, IH); paperFront(DOOR.x1, HX, 0, IH);
    // reveals (the wall thickness inside the window and door openings)
    S.add(boxGeo(WIN.x1 - WIN.x0, 0.03, WT + 0.02), "baseboard", (WIN.x0 + WIN.x1) / 2, WIN.y0 - 0.015, HZ + WT / 2);   // sill
    S.add(boxGeo(WIN.x1 - WIN.x0 + 0.16, 0.035, 0.06), "baseboard", (WIN.x0 + WIN.x1) / 2, WIN.y0 - 0.03, HZ - 0.02); // inner stool
    S.add(boxGeo(0.02, WIN.y1 - WIN.y0, WT), "wallpaper", WIN.x0 + 0.01, (WIN.y0 + WIN.y1) / 2, HZ + WT / 2);
    S.add(boxGeo(0.02, WIN.y1 - WIN.y0, WT), "wallpaper", WIN.x1 - 0.01, (WIN.y0 + WIN.y1) / 2, HZ + WT / 2);
    S.add(boxGeo(WIN.x1 - WIN.x0, 0.02, WT), "wallpaper", (WIN.x0 + WIN.x1) / 2, WIN.y1 - 0.01, HZ + WT / 2);
    // door casing (inside and out)
    // casing boards, 2.4 cm proud of the wall on both faces
    [HZ - 0.012, OZ + 0.012].forEach(function (z) {
      S.add(boxGeo(0.07, DOOR.h + 0.05, 0.025), "trim", DOOR.x0 - 0.035, (DOOR.h + 0.05) / 2, z);
      S.add(boxGeo(0.07, DOOR.h + 0.05, 0.025), "trim", DOOR.x1 + 0.035, (DOOR.h + 0.05) / 2, z);
      S.add(boxGeo(DOOR.x1 - DOOR.x0 + 0.21, 0.07, 0.025), "trim", (DOOR.x0 + DOOR.x1) / 2, DOOR.h + 0.035, z);
    });
    S.add(boxGeo(0.02, DOOR.h, WT), "trim", DOOR.x0 + 0.01, DOOR.h / 2, HZ + WT / 2);
    S.add(boxGeo(0.02, DOOR.h, WT), "trim", DOOR.x1 - 0.01, DOOR.h / 2, HZ + WT / 2);
    // window frame outside (aluminium) + mullion
    S.add(boxGeo(WIN.x1 - WIN.x0 + 0.08, 0.05, 0.05), "steel", (WIN.x0 + WIN.x1) / 2, WIN.y1 + 0.02, OZ + 0.0);
    S.add(boxGeo(WIN.x1 - WIN.x0 + 0.08, 0.05, 0.08), "steel", (WIN.x0 + WIN.x1) / 2, WIN.y0 - 0.02, OZ + 0.01);
    S.add(boxGeo(0.04, WIN.y1 - WIN.y0, 0.05), "steel", (WIN.x0 + WIN.x1) / 2, (WIN.y0 + WIN.y1) / 2, OZ - 0.02);
    // baseboards (skip the door gap)
    const bb = 0.09, bt = 0.014;
    S.add(boxGeo(2 * HX, bb, bt), "baseboard", 0, bb / 2, -HZ + bt / 2);
    S.add(boxGeo(bt, bb, 2 * HZ), "baseboard", -HX + bt / 2, bb / 2, 0);
    S.add(boxGeo(bt, bb, 2 * HZ), "baseboard", HX - bt / 2, bb / 2, 0);
    S.add(boxGeo(DOOR.x0 + HX, bb, bt), "baseboard", (-HX + DOOR.x0) / 2, bb / 2, HZ - bt / 2);
    S.add(boxGeo(HX - DOOR.x1, bb, bt), "baseboard", (DOOR.x1 + HX) / 2, bb / 2, HZ - bt / 2);
    // crown line where paper meets ceiling
    S.add(boxGeo(2 * HX, 0.035, 0.02), "baseboard", 0, IH - 0.018, -HZ + 0.01);
    S.add(boxGeo(0.02, 0.035, 2 * HZ), "baseboard", -HX + 0.01, IH - 0.018, 0);
    S.add(boxGeo(0.02, 0.035, 2 * HZ), "baseboard", HX - 0.01, IH - 0.018, 0);
    S.add(boxGeo(2 * HX, 0.035, 0.02), "baseboard", 0, IH - 0.018, HZ - 0.01);
    // exterior: the wall-box AC under the window, the porch light by the door
    S.add(roundBox(0.72, 0.42, 0.34, 0.02), "acUnit", (WIN.x0 + WIN.x1) / 2, 0.42, OZ + 0.17);
    S.add(boxGeo(0.6, 0.22, 0.01), "grille", (WIN.x0 + WIN.x1) / 2, 0.44, OZ + 0.345);
    S.add(roundBox(0.12, 0.2, 0.09, 0.02), "porch", DOOR.x0 - 0.35, 2.0, OZ + 0.05);
    S.add(boxGeo(0.16, 0.05, 0.1), "black", DOOR.x0 - 0.35, 2.12, OZ + 0.05);
    // ceiling fixture: a flush frosted dome on a brass ring
    const dome = new THREE.SphereGeometry(0.2, 18, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    dome.scale(1, 0.45, 1);
    S.add(dome, "bulbDome", LIGHT_AT.x, IH - 0.005, LIGHT_AT.z);
    S.add(new THREE.CylinderGeometry(0.215, 0.215, 0.02, 20), "brass", LIGHT_AT.x, IH - 0.012, LIGHT_AT.z);
    // bathroom door on the back wall (closed; the bathroom is not modelled)
    const bx = 2.4;
    S.add(boxGeo(0.8, 2.03, 0.04), "bathDoor", bx, 1.015, -HZ + 0.02);
    S.add(boxGeo(0.07, 2.08, 0.025), "baseboard", bx - 0.435, 1.04, -HZ + 0.014);
    S.add(boxGeo(0.07, 2.08, 0.025), "baseboard", bx + 0.435, 1.04, -HZ + 0.014);
    S.add(boxGeo(0.94, 0.07, 0.025), "baseboard", bx, 2.065, -HZ + 0.014);
    S.add(new THREE.SphereGeometry(0.028, 10, 8), "brass", bx - 0.3, 1.0, -HZ + 0.07);
    S.add(rod(0, 0.05, 0.008, 0.008, 8).rotateY(Math.PI / 2), "brass", bx - 0.3, 1.0, -HZ + 0.05);
  }

  function buildFurniture(S) {
    // ---- the bed: frame, mattress, spread, two pillows, headboard ----
    const bl = BED.x1 - BED.x0, bw = BED.z1 - BED.z0, bcx = (BED.x0 + BED.x1) / 2, bcz = (BED.z0 + BED.z1) / 2;
    S.add(roundBox(bl - 0.04, 0.24, bw - 0.02, 0.02), "walnut", bcx + 0.01, 0.18, bcz);
    for (const sx of [BED.x0 + 0.1, BED.x1 - 0.08]) for (const sz of [BED.z0 + 0.08, BED.z1 - 0.08]) S.add(boxGeo(0.06, 0.08, 0.06), "walnut", sx, 0.04, sz);
    S.add(roundBox(bl - 0.1, 0.24, bw - 0.08, 0.05, 3), "linen", bcx + 0.03, 0.425, bcz);   // top at 0.545
    // the spread: a soft slab over the mattress and a skirt down both sides
    S.add(roundBox(bl - 0.42, 0.07, bw + 0.02, 0.03, 3), "spread", bcx + 0.2, BED.top - 0.02, bcz);
    S.add(roundBox(0.06, 0.36, bw + 0.02, 0.025), "spread", BED.x1 - 0.02, BED.top - 0.2, bcz);           // foot drape
    S.add(roundBox(bl - 0.42, 0.34, 0.04, 0.018), "spread", bcx + 0.2, BED.top - 0.19, BED.z0 - 0.0);   // side drapes
    S.add(roundBox(bl - 0.42, 0.34, 0.04, 0.018), "spread", bcx + 0.2, BED.top - 0.19, BED.z1 + 0.0);
    // turned-down sheet band at the pillow end
    S.add(roundBox(0.3, 0.05, bw - 0.1, 0.02, 2), "linen", BED.x0 + 0.62, BED.top - 0.035, bcz);
    // pillows, slightly squashed and not perfectly square
    S.add(roundBox(0.42, 0.13, 0.62, 0.06, 3), "linen", BED.x0 + 0.3, BED.top + 0.02, bcz - 0.33, 0, 0.04, -0.12);
    S.add(roundBox(0.42, 0.13, 0.62, 0.06, 3), "linen", BED.x0 + 0.31, BED.top + 0.025, bcz + 0.33, 0, -0.05, -0.12);
    // headboard panel on the left wall
    S.add(roundBox(0.05, 0.62, bw + 0.14, 0.012), "walnut", -HX + 0.03, 0.9, bcz);
    S.add(boxGeo(0.03, 0.04, bw + 0.14), "walnut", -HX + 0.04, 1.22, bcz);

    // ---- nightstands ----
    function stand(cx, cz) {
      S.add(roundBox(0.46, 0.56, 0.44, 0.012), "walnut", cx, 0.3, cz);
      S.add(boxGeo(0.005, 0.16, 0.36), "black", cx + 0.232, 0.44, cz);                  // drawer seam shadow
      S.add(new THREE.SphereGeometry(0.014, 8, 6), "brass", cx + 0.24, 0.44, cz);
    }
    stand(-3.02, -1.53);
    stand(-3.02, 0.63);
    // lamp on the back stand: base, stem, glowing shade
    S.add(new THREE.CylinderGeometry(0.07, 0.085, 0.05, 16), "ceramic", -3.05, 0.605, -1.58);
    S.add(new THREE.CylinderGeometry(0.06, 0.07, 0.2, 16), "ceramic", -3.05, 0.73, -1.58);
    S.add(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 8), "brass", -3.05, 0.9, -1.58);
    S.add(new THREE.CylinderGeometry(0.12, 0.17, 0.22, 20, 1, true), "shadeOn", -3.05, 1.05, -1.58);
    // ashtray + a lighter on the front stand
    S.add(new THREE.CylinderGeometry(0.06, 0.055, 0.025, 14), "glassAsh", -3.0, 0.595, 0.62);
    S.add(new THREE.CylinderGeometry(0.035, 0.035, 0.004, 12), "black", -3.0, 0.605, 0.62);
    S.add(roundBox(0.08, 0.008, 0.012, 0.003), "cupWhite", -2.97, 0.61, 0.615, 0, 0.5, 0);           // a cigarette resting on the rim
    S.add(roundBox(0.025, 0.07, 0.012, 0.004), "wireRed", -2.9, 0.615, 0.72, Math.PI / 2, 0, 0.3);

    // ---- the desk + chair under the corkboard ----
    const dx = -0.8, dz = -HZ + 0.28;
    S.add(roundBox(1.3, 0.035, 0.56, 0.008), "walnut", dx, 0.74, dz);
    S.add(boxGeo(0.04, 0.72, 0.52), "walnut", dx - 0.62, 0.36, dz);
    S.add(roundBox(0.42, 0.72, 0.52, 0.01), "walnut", dx + 0.44, 0.36, dz);          // drawer pedestal
    S.add(boxGeo(0.36, 0.006, 0.004), "black", dx + 0.44, 0.5, dz + 0.262);               // drawer seam
    S.add(new THREE.SphereGeometry(0.013, 8, 6), "brass", dx + 0.44, 0.62, dz + 0.265);
    S.add(new THREE.SphereGeometry(0.013, 8, 6), "brass", dx + 0.44, 0.36, dz + 0.265);
    S.add(boxGeo(1.2, 0.3, 0.02), "walnut", dx - 0.02, 0.55, -HZ + 0.02);              // modesty panel
    chair(S, dx - 0.05, -1.55, 0.12);                   // back to the room, seat to the desk
    // on the desk: a paper cup of coffee, a folded paper bag, a motel pen
    S.add(new THREE.CylinderGeometry(0.043, 0.032, 0.12, 16), "cupWhite", dx - 0.4, 0.817, dz + 0.06);
    S.add(new THREE.CylinderGeometry(0.046, 0.046, 0.012, 16), "coffeeLid", dx - 0.4, 0.882, dz + 0.06);
    S.add(new THREE.CylinderGeometry(0.044, 0.044, 0.035, 16, 1, true), "kraft", dx - 0.4, 0.83, dz + 0.06);  // the sleeve
    S.add(roundBox(0.18, 0.22, 0.11, 0.01), "kraft", dx + 0.42, 0.87, dz - 0.06, 0, 0.25, 0);
    S.add(boxGeo(0.18, 0.03, 0.08), "kraft", dx + 0.42, 0.99, dz - 0.06, 0.35, 0.25, 0);          // folded-over top
    S.add(rod(0, 0.14, 0.004, 0.004, 6), "black", dx + 0.05, 0.762, dz + 0.1, 0, 0.4, 0);

    // ---- the dresser + TV on the right wall ----
    const dcx = (DRESSER.x0 + DRESSER.x1) / 2, dcz = (DRESSER.z0 + DRESSER.z1) / 2, dl = DRESSER.z1 - DRESSER.z0;
    S.add(roundBox(DRESSER.x1 - DRESSER.x0, DRESSER.top - 0.06, dl, 0.012), "walnut", dcx, (DRESSER.top - 0.06) / 2 + 0.06, dcz);
    S.add(boxGeo(0.44, 0.06, dl - 0.06), "black", dcx + 0.02, 0.03, dcz);                // plinth in shadow
    S.add(planeGeo(dl - 0.04, DRESSER.top - 0.1), "dresserFace", DRESSER.x0 - 0.001, (DRESSER.top - 0.1) / 2 + 0.07, dcz, 0, -Math.PI / 2, 0);
    // TV stand + back (the screen itself is a dynamic mesh)
    S.add(boxGeo(0.2, 0.012, 0.28), "black", dcx, DRESSER.top + 0.006, -0.7);
    S.add(boxGeo(0.04, 0.12, 0.05), "black", dcx + 0.02, DRESSER.top + 0.06, -0.7);
    S.add(roundBox(0.05, 0.44, 0.76, 0.012), "black", dcx + 0.03, DRESSER.top + 0.34, -0.7);

    // ---- the table under the window + a chair ----
    S.add(roundBox(TABLE.w, 0.035, TABLE.d, 0.01), "oak", TABLE.x, TABLE.top - 0.018, TABLE.z);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      S.add(new THREE.CylinderGeometry(0.02, 0.018, TABLE.top - 0.035, 8), "steel", TABLE.x + sx * (TABLE.w / 2 - 0.07), (TABLE.top - 0.035) / 2, TABLE.z + sz * (TABLE.d / 2 - 0.07));
    }
    chair(S, -1.2, 1.9, Math.PI / 2 - 0.2);            // pulled up to the table

    // ---- the rail alcove (the closet) ----
    S.add(boxGeo(RAIL.x1 - RAIL.x0, 2.1, 0.02), "walnut", (RAIL.x0 + RAIL.x1) / 2, 1.05, RAIL.z0);
    S.add(boxGeo(RAIL.x1 - RAIL.x0, 2.1, 0.02), "walnut", (RAIL.x0 + RAIL.x1) / 2, 1.05, RAIL.z1);
    S.add(boxGeo(RAIL.x1 - RAIL.x0, 0.025, RAIL.z1 - RAIL.z0), "walnut", (RAIL.x0 + RAIL.x1) / 2, 1.96, (RAIL.z0 + RAIL.z1) / 2);
    S.add(rod(-0.56, 0.56, 0.012, 0.012, 10).rotateY(Math.PI / 2), "steel", RAIL.x, RAIL.y, (RAIL.z0 + RAIL.z1) / 2);
    S.add(roundBox(0.4, 0.1, 0.6, 0.03, 2), "linen", RAIL.x, 2.03, (RAIL.z0 + RAIL.z1) / 2);        // spare blanket on the shelf
    S.add(roundBox(0.32, 0.12, 0.12, 0.03), "black", RAIL.x - 0.05, 0.06, RAIL.z0 + 0.25);          // a pair of shoes
    S.add(roundBox(0.32, 0.12, 0.12, 0.03), "black", RAIL.x - 0.03, 0.06, RAIL.z0 + 0.4);
    // a hold-all on the carpet by the bathroom door
    S.add(roundBox(0.55, 0.28, 0.32, 0.08, 3), "black", 0.8, 0.14, -2.2, 0, 0.18, 0);
    S.add(rod(-0.18, 0.18, 0.01, 0.01, 6), "black", 0.8, 0.31, -2.2, 0, 0.18, 0);

    // ---- the corkboard frame + cork ----
    S.add(boxGeo(BOARD.w, BOARD.h, 0.03), "cork", BOARD.x, BOARD.y, -HZ + 0.015);
    const fw = 0.045, fd = 0.045;
    S.add(boxGeo(BOARD.w + 2 * fw, fw, fd), "frameWood", BOARD.x, BOARD.y + BOARD.h / 2 + fw / 2, -HZ + fd / 2);
    S.add(boxGeo(BOARD.w + 2 * fw, fw, fd), "frameWood", BOARD.x, BOARD.y - BOARD.h / 2 - fw / 2, -HZ + fd / 2);
    S.add(boxGeo(fw, BOARD.h, fd), "frameWood", BOARD.x - BOARD.w / 2 - fw / 2, BOARD.y, -HZ + fd / 2);
    S.add(boxGeo(fw, BOARD.h, fd), "frameWood", BOARD.x + BOARD.w / 2 + fw / 2, BOARD.y, -HZ + fd / 2);
  }
  function chair(S, x, z, ry) {
    const c = Math.cos(ry), s = Math.sin(ry);
    function at(lx, lz) { return [x + lx * c + lz * s, z - lx * s + lz * c]; }
    let p = at(0, 0);
    S.add(roundBox(0.44, 0.05, 0.42, 0.015), "oak", p[0], 0.46, p[1], 0, ry, 0);
    for (const lx of [-0.19, 0.19]) for (const lz of [-0.18, 0.18]) { p = at(lx, lz); S.add(boxGeo(0.035, 0.44, 0.035), "oak", p[0], 0.22, p[1], 0, ry, 0); }
    p = at(0, 0.19);
    S.add(roundBox(0.42, 0.34, 0.035, 0.012), "oak", p[0], 0.82, p[1], -0.08, ry, 0);
    for (const lx of [-0.19, 0.19]) { p = at(lx, 0.19); S.add(boxGeo(0.035, 0.42, 0.035), "oak", p[0], 0.66, p[1], 0, ry, 0); }
  }

  /* ---------------- dynamic pieces -------------------------------------- */
  function buildDoor() {
    const piv = new THREE.Group();
    piv.position.set(DOOR.x1, 0, HZ + WT / 2);
    const leafW = DOOR.x1 - DOOR.x0 - 0.01;
    const leaf = mesh(roundBox(leafW, DOOR.h - 0.018, 0.045, 0.006), mats().doorPaint, piv, -leafW / 2 - 0.005, 0.015 + (DOOR.h - 0.018) / 2, 0);
    leaf.castShadow = true;
    // handle both sides, a peephole, the security chain plate
    mesh(new THREE.SphereGeometry(0.03, 12, 8), mats().brass, piv, -leafW + 0.08, 1.0, -0.045);
    mesh(new THREE.SphereGeometry(0.03, 12, 8), mats().brass, piv, -leafW + 0.08, 1.0, 0.045);
    mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.05, 8).rotateX(Math.PI / 2), mats().brass, piv, -leafW / 2, 1.55, 0);
    mesh(boxGeo(0.02, 0.1, 0.01), mats().brass, piv, -leafW + 0.06, 1.35, -0.026);
    B.group.add(piv);
    B.doorPivot = piv;
    B.doorOpen = 0; B.doorWant = 0;
  }
  function buildWindow() {
    const MM = mats();
    const w = WIN.x1 - WIN.x0, h = WIN.y1 - WIN.y0, cx = (WIN.x0 + WIN.x1) / 2, cy = (WIN.y0 + WIN.y1) / 2;
    B.glass = mesh(new THREE.PlaneGeometry(w, h), MM.glass.clone(), B.group, cx, cy, OZ - 0.04);
    B.ownMats.push(B.glass.material);
    B.glass.receiveShadow = false;
    const bl = mesh(planeGeo(w + 0.08, h + 0.02), MM.blinds, B.group, cx, cy + 0.01, HZ - 0.04, 0, Math.PI, 0);
    bl.material.map.repeat.set(1 / 0.5, 1 / 0.4);   // 16 slats per 0.4 m: 2.5 cm mini-blinds
    // headrail
    mesh(boxGeo(w + 0.1, 0.04, 0.05), MM.baseboard, B.group, cx, WIN.y1 + 0.005, HZ - 0.04);
    // the sun through the slats, laid on the carpet and the table's front
    const st = mesh(new THREE.PlaneGeometry(w * 0.95, 1.7), MM.sunStripes.clone(), B.group, cx + 0.15, 0.012, HZ - 1.0, -Math.PI / 2, 0, 0.12);
    st.material.map = MM.sunStripes.map;
    B.ownMats.push(st.material);
    st.renderOrder = 2;
    B.sunStripes = st;
  }
  function buildLight() {
    const L0 = new THREE.PointLight(0xffd9a8, 1.5, 9.5, 2);
    L0.position.set(LIGHT_AT.x, LIGHT_AT.y, LIGHT_AT.z);
    L0.castShadow = false;
    B.group.add(L0);
    B.light = L0;
  }

  /* ---------------- guns (simple, but shaped like guns) ------------------- */
  // Each is built in PROFILE (x = along the gun, muzzle +x; y = up; z = its
  // thickness) and laid on its side in the foam by rotating x -90 degrees.
  function gunGroup(build) {
    const S = new Batch();
    build(S);
    const gg = new THREE.Group();
    S.finish(gg, B, null);
    gg.children.forEach(function (m) { m.castShadow = false; m.receiveShadow = true; });
    return gg;
  }
  const GUNS = {
    rifle: function (S) {
      S.add(profile([[-0.47, -0.075], [-0.44, -0.082], [-0.30, -0.046], [-0.19, -0.032], [-0.16, -0.032], [-0.178, -0.112], [-0.142, -0.12], [-0.112, -0.03], [0.02, -0.028], [0.20, -0.014], [0.212, 0.004], [0.02, 0.012], [-0.2, 0.02], [-0.29, 0.042], [-0.47, 0.036]], 0.036, 0.004), "gunPoly");
      S.add(boxGeo(0.28, 0.036, 0.03), "gunMetal", -0.04, 0.03, 0);
      S.add(rod(0.09, 0.47, 0.0095, 0.0078, 12), "gunMetal", 0, 0.032, 0);
      S.add(rod(0.44, 0.48, 0.0115, 0.0115, 12), "gunMetal", 0, 0.032, 0);
      S.add(boxGeo(0.064, 0.05, 0.024), "gunMetal", -0.03, -0.03, 0);                 // magazine
      S.add(boxGeo(0.07, 0.006, 0.012), "gunMetal", -0.12, -0.055, 0);                // trigger guard
      // scope
      S.add(rod(-0.19, 0.13, 0.0125, 0.0125, 16), "black", 0, 0.088, 0);
      S.add(rod(0.13, 0.19, 0.0125, 0.021, 16), "black", 0, 0.088, 0);
      S.add(rod(0.19, 0.245, 0.021, 0.021, 16), "black", 0, 0.088, 0);
      S.add(rod(0.244, 0.246, 0.018, 0.018, 16), "glassLens", 0, 0.088, 0);
      S.add(rod(-0.225, -0.19, 0.018, 0.0125, 16), "black", 0, 0.088, 0);
      S.add(rod(-0.265, -0.225, 0.018, 0.018, 16), "black", 0, 0.088, 0);
      S.add(new THREE.CylinderGeometry(0.01, 0.01, 0.024, 12), "black", -0.03, 0.108, 0);
      S.add(new THREE.CylinderGeometry(0.01, 0.01, 0.024, 12).rotateX(Math.PI / 2), "black", -0.03, 0.088, 0.02);
      S.add(boxGeo(0.018, 0.045, 0.03), "gunMetal", -0.11, 0.062, 0);
      S.add(boxGeo(0.018, 0.045, 0.03), "gunMetal", 0.06, 0.062, 0);
      // bolt handle
      S.add(new THREE.CylinderGeometry(0.005, 0.005, 0.05, 8).rotateX(Math.PI / 2), "gunMetal", -0.13, 0.036, 0.035);
      S.add(new THREE.SphereGeometry(0.01, 10, 8), "gunMetal", -0.13, 0.036, 0.06);
    },
    shotgun: function (S) {
      S.add(profile([[-0.46, -0.085], [-0.43, -0.092], [-0.22, -0.042], [-0.14, -0.03], [-0.14, 0.02], [-0.24, 0.026], [-0.46, 0.032]], 0.038, 0.004), "gunWood");
      S.add(roundBox(0.22, 0.066, 0.036, 0.006), "gunMetal", -0.03, 0.002, 0);
      S.add(rod(0.08, 0.47, 0.011, 0.011, 14), "gunMetal", 0, 0.022, 0);
      S.add(rod(0.08, 0.40, 0.0105, 0.0105, 14), "gunMetal", 0, -0.008, 0);
      S.add(roundBox(0.16, 0.036, 0.042, 0.012), "gunWood", 0.2, -0.008, 0);
      S.add(new THREE.SphereGeometry(0.004, 6, 4), "brass", 0.465, 0.035, 0);
      S.add(boxGeo(0.06, 0.006, 0.012), "gunMetal", -0.09, -0.05, 0);
    },
    pistol: function (S) {
      S.add(roundBox(0.19, 0.03, 0.026, 0.004), "gunMetal", -0.005, 0.027, 0);        // slide
      S.add(boxGeo(0.15, 0.02, 0.028), "gunPoly", -0.005, 0.004, 0);                    // frame
      S.add(profile([[-0.1, 0.012], [-0.055, 0.012], [-0.045, -0.1], [-0.085, -0.106], [-0.108, 0.0]], 0.03, 0.003), "gunPoly");
      S.add(profile([[-0.045, -0.006], [0.0, -0.006], [0.004, -0.03], [-0.04, -0.034]], 0.012, 0), "gunPoly");
      S.add(rod(0.09, 0.1, 0.006, 0.006, 10), "gunMetal", 0, 0.027, 0);
      S.add(rod(0.1, 0.25, 0.016, 0.016, 16), "black", 0, 0.027, 0);                    // suppressor
    },
    smg: function (S) {
      S.add(roundBox(0.26, 0.05, 0.036, 0.006), "gunMetal", -0.02, 0.02, 0);
      S.add(profile([[-0.1, -0.004], [-0.065, -0.004], [-0.055, -0.1], [-0.092, -0.106]], 0.032, 0.003), "gunPoly");
      S.add(profile([[0.0, -0.004], [0.032, -0.004], [0.05, -0.145], [0.017, -0.15]], 0.024, 0.002), "gunMetal");
      S.add(profile([[0.07, -0.004], [0.1, -0.004], [0.1, -0.05], [0.082, -0.055]], 0.03, 0.003), "gunPoly");   // stub grip
      S.add(rod(0.11, 0.135, 0.008, 0.008, 10), "gunMetal", 0, 0.025, 0);
      S.add(rod(0.135, 0.29, 0.017, 0.017, 16), "black", 0, 0.025, 0);
      S.add(boxGeo(0.22, 0.01, 0.008), "gunMetal", -0.05, -0.01, 0.024);                // folded stock rails
      S.add(boxGeo(0.22, 0.01, 0.008), "gunMetal", -0.05, 0.03, 0.024);
      S.add(boxGeo(0.014, 0.065, 0.03), "gunPoly", -0.155, 0.01, 0.016);
      S.add(boxGeo(0.02, 0.02, 0.01), "gunMetal", -0.12, 0.052, 0);
      S.add(boxGeo(0.02, 0.016, 0.01), "gunMetal", 0.09, 0.05, 0);
    },
  };
  // the loadout: what the case holds, what taking it gives (the real weapon
  // API: weapons/weapon-data.js unlockWeapon + systems/fpsmode.js ammo +
  // city/gunmods.js g.cityGunMods), and where it sits in the foam (case
  // local: x along the case, z toward the hinge; the front, where you stand,
  // is -z).
  const LOADOUT = [
    { key: "rifle", id: "sniper", city: "Sniper", noun: "the rifle", ammo: 20, at: { x: 0.02, z: 0.19 } },
    { key: "shotgun", id: "shotgun", city: "Shotgun", noun: "the shotgun", ammo: 16, at: { x: 0.0, z: 0.02 } },
    { key: "pistol", id: "sidearm", city: "Pistol", noun: "the pistol", ammo: 34, mods: { muzzle: "suppressor" }, at: { x: -0.33, z: -0.2 } },
    { key: "smg", id: "smg", city: "SMG", noun: "the SMG", ammo: 90, mods: { muzzle: "suppressor" }, at: { x: 0.06, z: -0.2 } },
  ];
  const CASE = { w: 1.12, d: 0.7, base: 0.1, rim: 0.125, lid: 0.05, foam: 0.102 };

  function buildCase() {
    const MM = mats();
    const cg = new THREE.Group();
    cg.position.set(TABLE.x + 0.02, TABLE.top + 0.001, TABLE.z + 0.02);
    cg.rotation.y = 0.02;
    B.group.add(cg);
    B.caseGroup = cg;
    const S = new Batch();
    S.add(roundBox(CASE.w, CASE.base, CASE.d, 0.02), "caseShell", 0, CASE.base / 2, 0);
    // rim walls
    const rh = CASE.rim - CASE.base + 0.004, ry = CASE.base + rh / 2 - 0.004;
    S.add(boxGeo(CASE.w - 0.01, rh, 0.022), "caseShell", 0, ry, -CASE.d / 2 + 0.016);
    S.add(boxGeo(CASE.w - 0.01, rh, 0.022), "caseShell", 0, ry, CASE.d / 2 - 0.016);
    S.add(boxGeo(0.022, rh, CASE.d - 0.01), "caseShell", -CASE.w / 2 + 0.016, ry, 0);
    S.add(boxGeo(0.022, rh, CASE.d - 0.01), "caseShell", CASE.w / 2 - 0.016, ry, 0);
    S.add(scaleUV(new THREE.PlaneGeometry(CASE.w - 0.05, CASE.d - 0.05).rotateX(-Math.PI / 2), CASE.w, CASE.d), "foam", 0, CASE.foam, 0);
    // latches + handle on the front
    for (const lx of [-0.36, 0.36]) S.add(roundBox(0.07, 0.05, 0.02, 0.005), "caseTrim", lx, 0.1, -CASE.d / 2 - 0.006);
    S.add(roundBox(0.2, 0.025, 0.03, 0.01), "black", 0, 0.08, -CASE.d / 2 - 0.02);
    // hinge knuckles on the back
    for (const lx of [-0.4, 0, 0.4]) S.add(rod(-0.05, 0.05, 0.009, 0.009, 8), "caseTrim", lx, CASE.rim, CASE.d / 2 + 0.004);
    // foam cutouts (the recess each gun leaves when it is out)
    const cuts = { rifle: [0.98, 0.17], shotgun: [0.95, 0.12], pistol: [0.37, 0.13], smg: [0.46, 0.16] };
    for (let i = 0; i < LOADOUT.length; i++) {
      const it = LOADOUT[i], c = cuts[it.key];
      S.add(new THREE.PlaneGeometry(c[0], c[1]).rotateX(-Math.PI / 2), "foamCut", it.at.x, CASE.foam + 0.0015, it.at.z);
    }
    S.add(new THREE.PlaneGeometry(0.16, 0.13).rotateX(-Math.PI / 2), "foamCut", 0.42, CASE.foam + 0.0015, -0.2);
    S.finish(cg, B, null);

    // the guns
    B.guns = {};
    for (let i = 0; i < LOADOUT.length; i++) {
      const it = LOADOUT[i];
      const gg = gunGroup(GUNS[it.key]);
      gg.rotation.x = -Math.PI / 2;
      gg.position.set(it.at.x, CASE.foam + 0.004, it.at.z);
      cg.add(gg);
      B.guns[it.key] = gg;
    }
    // binoculars (always in the case)
    const bin = gunGroup(function (S2) {
      S2.add(rod(-0.06, 0.05, 0.024, 0.024, 16), "gunOlive", 0, 0, -0.031);
      S2.add(rod(-0.06, 0.05, 0.024, 0.024, 16), "gunOlive", 0, 0, 0.031);
      S2.add(rod(0.05, 0.07, 0.027, 0.027, 16), "black", 0, 0, -0.031);
      S2.add(rod(0.05, 0.07, 0.027, 0.027, 16), "black", 0, 0, 0.031);
      S2.add(rod(-0.08, -0.06, 0.018, 0.02, 12), "black", 0, 0, -0.031);
      S2.add(rod(-0.08, -0.06, 0.018, 0.02, 12), "black", 0, 0, 0.031);
      S2.add(boxGeo(0.07, 0.022, 0.03), "gunOlive", -0.01, 0, 0);
    });
    bin.position.set(0.42, CASE.foam + 0.02, -0.2);
    bin.rotation.y = 0.1;
    cg.add(bin);

    // the lid on its hinge; the kit rides in the lid foam
    const lp = new THREE.Group();
    lp.position.set(0, CASE.rim, CASE.d / 2);
    cg.add(lp);
    const LS = new Batch();
    LS.add(roundBox(CASE.w, CASE.lid, CASE.d, 0.02), "caseShell", 0, CASE.lid / 2, -CASE.d / 2);
    LS.add(scaleUV(new THREE.PlaneGeometry(CASE.w - 0.05, CASE.d - 0.05).rotateX(Math.PI / 2), CASE.w, CASE.d), "foam", 0, -0.002, -CASE.d / 2);
    for (const lx of [-0.36, 0.36]) LS.add(roundBox(0.07, 0.03, 0.02, 0.005), "caseTrim", lx, 0.01, -CASE.d - 0.006);
    LS.finish(lp, B, null);
    B.lid = lp; B.lidOpen = 0; B.lidWant = 0;
    // vial (glass, a finger of something green) and the wrapped charge
    const vial = gunGroup(function (S2) {
      S2.add(rod(-0.04, 0.03, 0.011, 0.011, 12), "vialGlass");
      S2.add(rod(-0.037, 0.0, 0.0095, 0.0095, 12), "vialLiquid");
      S2.add(rod(0.03, 0.045, 0.012, 0.012, 12), "black");
    });
    vial.position.set(0.32, -0.018, -0.3);
    vial.rotation.set(Math.PI, 0.2, 0);
    lp.add(vial);
    const charge = gunGroup(function (S2) {
      S2.add(roundBox(0.14, 0.045, 0.08, 0.008), "kraft");
      S2.add(boxGeo(0.02, 0.048, 0.083), "tape", -0.035, 0, 0);
      S2.add(boxGeo(0.02, 0.048, 0.083), "tape", 0.035, 0, 0);
      S2.add(rod(-0.02, 0.06, 0.002, 0.002, 6), "wireRed", 0.07, 0.01, 0.01);
    });
    charge.position.set(0.12, -0.026, -0.32);
    charge.rotation.set(Math.PI, -0.1, 0);
    lp.add(charge);
    B.kit = { vial: vial, charge: charge, bin: bin };
    syncCase();
  }
  function kitCounts() {
    try { return (CBZ.agency && CBZ.agency.kit && CBZ.agency.kit()) || null; } catch (e) { return null; }
  }
  function carrying(id) { try { return !!(CBZ.hasWeapon && CBZ.hasWeapon(id)); } catch (e) { return false; } }
  function syncCase() {
    if (!B || !B.guns) return;
    for (let i = 0; i < LOADOUT.length; i++) {
      const it = LOADOUT[i];
      if (B.guns[it.key]) B.guns[it.key].visible = !carrying(it.id);
    }
    const k = kitCounts();
    if (B.kit) {
      B.kit.vial.visible = !!(k && k.vial > 0);
      B.kit.charge.visible = !!(k && k.charge > 0);
    }
  }

  /* ---------------- the phone on the bed ---------------------------------- */
  function buildPhone() {
    const pg = new THREE.Group();
    pg.position.set(PHONE_AT.x, BED.top + 0.021, PHONE_AT.z);
    pg.rotation.y = 0.5;
    B.group.add(pg);
    mesh(roundBox(0.07, 0.011, 0.145, 0.0045, 2), mats().black, pg, 0, 0, 0);
    const scr = new THREE.MeshBasicMaterial({ color: 0x222222 });
    scr.toneMapped = false;
    B.ownMats.push(scr);
    const sm = mesh(new THREE.PlaneGeometry(0.062, 0.128), scr, pg, 0, 0.0058, 0, -Math.PI / 2, 0, 0);
    sm.receiveShadow = false;
    B.phone = { g: pg, scr: scr, tex: null, ringing: false, from: "", onAnswer: null, t: 0, base: { x: PHONE_AT.x, z: PHONE_AT.z, ry: 0.5 } };
    phoneScreen("idle");
  }
  function phoneScreen(state) {
    const K = paperKit(), ph = B && B.phone;
    if (!ph) return;
    let c = null;
    if (K && K.phone) { try { c = K.phone({ state: state, from: ph.from }, { canvas: ph.canvas || undefined }); } catch (e) { c = null; } }
    if (!c) { c = cv(36, 74); const cc = c.getContext("2d"); cc.fillStyle = state === "ringing" ? "#1f6a3c" : "#050607"; cc.fillRect(0, 0, 36, 74); }
    if (ph.tex && ph.canvas === c) ph.tex.needsUpdate = true;
    else {
      if (ph.tex) ph.tex.dispose();
      ph.tex = paperTex(c); ph.canvas = c;
      ph.scr.map = ph.tex; ph.scr.needsUpdate = true;
    }
    ph.scr.color.setHex(state === "ringing" ? 0xffffff : 0x3a3a3a);
  }
  // the buzz: a motor rattle synthesised on the game's own AudioContext
  // (systems/audio.js has no vibration sample), scaled by distance
  function buzz(vol) {
    const ctx = CBZ.getAudioCtx ? CBZ.getAudioCtx() : null;
    if (!ctx || ctx.state !== "running" || vol <= 0.002) return;
    try {
      const t = ctx.currentTime;
      const o = ctx.createOscillator(), o2 = ctx.createOscillator(), f = ctx.createBiquadFilter(), gn = ctx.createGain(), am = ctx.createGain();
      o.type = "sawtooth"; o.frequency.value = 142;
      o2.type = "square"; o2.frequency.value = 31;
      am.gain.value = 0.5; o2.connect(am); am.connect(gn.gain);
      f.type = "lowpass"; f.frequency.value = 700; f.Q.value = 2;
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.linearRampToValueAtTime(vol, t + 0.03);
      gn.gain.setValueAtTime(vol, t + 0.36);
      gn.gain.linearRampToValueAtTime(0.0001, t + 0.4);
      o.connect(f); f.connect(gn); gn.connect(ctx.destination);
      o.start(t); o2.start(t); o.stop(t + 0.42); o2.stop(t + 0.42);
    } catch (e) {}
  }

  /* ---------------- the TV --------------------------------------------------- */
  function buildTV() {
    const dcx = (DRESSER.x0 + DRESSER.x1) / 2;
    const scr = new THREE.MeshBasicMaterial({ color: 0xdadada });
    scr.toneMapped = false;
    B.ownMats.push(scr);
    const m = mesh(new THREE.PlaneGeometry(0.7, 0.394), scr, B.group, dcx + 0.002, DRESSER.top + 0.34, -0.7, 0, -Math.PI / 2, 0);   // 3 mm proud of the bezel (dcx + 0.005)
    m.receiveShadow = false;
    B.tv = { mesh: m, scr: scr, tex: null, canvas: null, own: true, story: null, day: -1, tick: 0, off: 0 };
    tvIdle();
  }
  function tvSet(c, own) {
    const T = B && B.tv; if (!T || !c) return;
    if (T.tex && T.canvas === c) { T.tex.needsUpdate = true; T.own = own; return; }
    if (T.tex) T.tex.dispose();
    T.tex = paperTex(c); T.canvas = c; T.own = own;
    T.scr.map = T.tex; T.scr.needsUpdate = true;
  }
  const STORY_BITS = [
    function (d, off) { return { headline: "Water main break in " + d.a, sub: "Crews expect the street closed through the evening", ticker: "Traffic slow on the ring road   Rain likely after dark   " + d.b + " school board meets Thursday" }; },
    function (d, off) { return { headline: (off ? off.title + " " + off.name : "City council") + " defends budget", sub: "Opponents say the cuts land hardest in " + d.b, ticker: "Fuel prices up four cents   " + d.a + " bakery reopens after fire   Harbour ferry delays" }; },
    function (d) { return { headline: "Police appeal for witnesses", sub: "A man was found dead in " + d.a + " early this morning", ticker: "Detectives ask anyone with dashcam footage to come forward   " + d.b + " road works continue" }; },
    function (d) { return { headline: "Heat wave expected this weekend", sub: "Cooling centres open in " + d.b + " from Friday", ticker: "Pollen count high   " + d.a + " market moves indoors   Stadium sold out Saturday" }; },
    function (d) { return { headline: "Armed robbery at " + d.a + " pawn shop", sub: "Two men left on foot, police say", ticker: "No arrests yet   Harbour ferry back on schedule   " + d.b + " night market returns" }; },
  ];
  const DKEYS = ["downtown", "projects", "waterfront", "uptown", "island"];
  function districtNames() {
    const E = CBZ.cityEcon, out = [];
    for (let i = 0; i < DKEYS.length; i++) {
      let n = null;
      try { n = E && E.districtName ? E.districtName(DKEYS[i]) : null; } catch (e) { n = null; }
      if (n && n !== "the city") out.push(n);
    }
    return out.length ? out : ["Downtown", "the Waterfront"];
  }
  function localStory() {
    const day = CBZ.dayCount ? CBZ.dayCount() : 0;
    const r = rng(day * 7919 + 17);
    const dn = districtNames();
    const d = { a: dn[(r() * dn.length) | 0], b: dn[(r() * dn.length) | 0] };
    let off = null;
    try { off = (CBZ.cityOrders && CBZ.cityOrders._official) ? CBZ.cityOrders._official() : null; } catch (e) { off = null; }
    const R0 = records();
    // a settled name the night before is the morning's lead story
    if (R0 && (R0.completed | 0) > 0 && r() < 0.5) return STORY_BITS[2](d, off);
    return STORY_BITS[(r() * STORY_BITS.length) | 0](d, off);
  }
  function tvIdle() {
    const T = B && B.tv; if (!T) return;
    const K = paperKit();
    const day = CBZ.dayCount ? CBZ.dayCount() : 0;
    if (!T.story || T.day !== day) { T.story = localStory(); T.day = day; }
    let c = null;
    const o = { headline: T.story.headline, sub: T.story.sub, ticker: T.story.ticker, live: true, tickerOffset: T.off };
    if (K && K.tv) { try { c = K.tv(o, { canvas: T.own ? T.canvas || undefined : undefined }); } catch (e) { c = null; } }
    if (!c) { c = cv(64, 36); const cc = c.getContext("2d"); cc.fillStyle = "#1a2a44"; cc.fillRect(0, 0, 64, 36); cc.fillStyle = "#9b1b1b"; cc.fillRect(0, 24, 64, 6); }
    tvSet(c, true);
  }

  /* ---------------- the rail of clothes -------------------------------------- */
  // only looks outfits.js can actually put on (CBZ.cityWearOutfit ids)
  const LOOKS = [
    { id: "suit", kind: "suit" },
    { id: "coveralls", kind: "coveralls" },
    { id: "mailman", kind: "jacket" },
    { id: "waiter", kind: "waiter" },
    { id: "denim_jacket", kind: "jacket" },
  ];
  function garment(rec, kind) {
    const MM = mats();
    const col = rec.colors || {};
    const torso = newMat("cloth_" + rec.id, std({ color: col.torso != null ? col.torso : 0x444444, roughness: 0.95 }));
    const legs = newMat("legs_" + rec.id, std({ color: col.legs != null ? col.legs : 0x333333, roughness: 0.95 }));
    const collar = newMat("collar_" + rec.id, std({ color: kind === "suit" || kind === "waiter" ? 0xe9e7e2 : (col.collar != null ? col.collar : 0x555555), roughness: 0.9 }));
    const gHang = new THREE.Group();                 // hook at y 0, garment faces +z
    const body = new THREE.Group();
    gHang.add(body);
    // hanger (always stays on the rail)
    mesh(new THREE.TorusGeometry(0.022, 0.0028, 5, 12, Math.PI * 1.3), MM.steel, gHang, 0, 0.0, 0, 0, Math.PI / 2, -0.3);
    mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.04, 5), MM.steel, gHang, 0, -0.035, 0);
    mesh(roundBox(0.42, 0.014, 0.012, 0.005), MM.oak, gHang, 0, -0.08, 0);
    mesh(boxGeo(0.23, 0.012, 0.01), MM.oak, gHang, -0.1, -0.066, 0, 0, 0, 0.16);
    mesh(boxGeo(0.23, 0.012, 0.01), MM.oak, gHang, 0.1, -0.066, 0, 0, 0, -0.16);
    // the cloth
    const top = [[-0.07, -0.062], [-0.2, -0.085], [-0.245, -0.14], [-0.265, -0.64], [-0.212, -0.655], [-0.194, -0.3], [-0.19, -0.74]];
    let pts;
    if (kind === "coveralls") {
      pts = top.concat([[-0.18, -1.33], [-0.035, -1.33], [0, -0.86], [0.035, -1.33], [0.18, -1.33]]);
    } else pts = top.slice();
    const mir = [];
    for (let i = top.length - 1; i >= 0; i--) mir.push([-top[i][0], top[i][1]]);
    pts = pts.concat(mir);
    pts.push([0, -0.12]);
    mesh(profile(pts, 0.05, 0.012), torso, body, 0, 0, 0);
    if (kind === "suit" || kind === "waiter") {
      // shirt front and (for the suit) a tie in the V
      mesh(profile([[-0.068, -0.066], [0.068, -0.066], [0, -0.34]], 0.01, 0), collar, body, 0, 0, 0.03);
      if (kind === "suit") mesh(profile([[-0.012, -0.08], [0.012, -0.08], [0.02, -0.3], [0, -0.33], [-0.02, -0.3]], 0.008, 0), MM.wireRed, body, 0, 0, 0.037);
      mesh(profile([[-0.3, 0], [0.3, 0], [0.28, -0.7], [-0.28, -0.7]], 0.025, 0.005), legs, body, 0, -0.6, -0.03);   // trousers behind
    } else {
      mesh(profile([[-0.075, -0.055], [0.075, -0.055], [0.05, -0.11], [-0.05, -0.11]], 0.012, 0.003), collar, body, 0, 0, 0.03);
    }
    if (kind === "jacket") {
      mesh(boxGeo(0.006, 0.6, 0.004), MM.black, body, 0, -0.42, 0.033);   // the zip / button line
    }
    return { g: gHang, body: body };
  }
  function buildCloset() {
    B.looks = [];
    let cat = null;
    try { cat = CBZ.cityOutfitCatalog ? CBZ.cityOutfitCatalog() : null; } catch (e) { cat = null; }
    if (!cat || !CBZ.cityWearOutfit) return;
    const avail = LOOKS.filter(function (L0) { return !!cat[L0.id]; });
    const n = avail.length; if (!n) return;
    const span = RAIL.z1 - RAIL.z0 - 0.26;
    for (let i = 0; i < n; i++) {
      const L0 = avail[i];
      const gm = garment(cat[L0.id], L0.kind);
      const z = RAIL.z0 + 0.13 + (n === 1 ? span / 2 : span * i / (n - 1));
      gm.g.position.set(RAIL.x, RAIL.y + 0.012, z);
      gm.g.rotation.y = (i % 2 ? 0.05 : -0.04);
      B.group.add(gm.g);
      B.looks.push({ id: L0.id, name: cat[L0.id].name, g: gm.g, body: gm.body, z: z, pull: 0, want: 0 });
    }
    syncCloset();
  }
  function wornId() { return g.cityOutfitId || (g.cityWornOutfit && g.cityWornOutfit.id) || null; }
  function syncCloset() {
    if (!B || !B.looks) return;
    const w = wornId();
    for (let i = 0; i < B.looks.length; i++) B.looks[i].body.visible = B.looks[i].id !== w;
  }

  /* ---------------- the board ------------------------------------------------ */
  function buildBoard() {
    const bg = new THREE.Group();
    bg.position.set(BOARD.x, BOARD.y, -HZ + 0.03);
    B.group.add(bg);
    B.board = { g: bg, items: [], nodes: [], custom: null, refreshT: 0 };
    boardDraw(null);
  }
  function clearBoardNodes() {
    const bd = B.board;
    for (let i = 0; i < bd.nodes.length; i++) {
      const n = bd.nodes[i];
      if (n.parent) n.parent.remove(n);
      if (n.geometry) n.geometry.dispose();
      if (n.material && !n.material._shared) { if (n.material.map && !n.material.map._shared) n.material.map.dispose(); n.material.dispose(); }
    }
    bd.nodes.length = 0;
  }
  function fallbackPaper(w, h, tone, lines) {
    const c = cv(w, h), cc = c.getContext("2d");
    cc.fillStyle = tone || "#ece6d6"; cc.fillRect(0, 0, w, h);
    cc.fillStyle = "#222"; cc.font = Math.round(h / 12) + "px serif";
    (lines || []).forEach(function (t, i) { cc.fillText(String(t).slice(0, 30), w * 0.06, h * 0.14 + i * h / 9); });
    return c;
  }
  function defaults() {
    const K = paperKit();
    const R0 = records() || { completed: 0, paid: 0 };
    const out = [];
    const me = B ? W(0, 0, 0) : { x: 0, z: 0 };
    const redraw = { onRedraw: function () { refreshBoard(); } };
    const dn = districtNames();
    // a street map clipping, the room circled
    let map = null;
    try { map = K && K.map ? K.map({ places: [{ x: me.x, z: me.z, label: "here" }], center: { x: me.x, z: me.z }, radius: 260, title: "" }, redraw) : null; } catch (e) { map = null; }
    out.push({ id: "map", canvas: map || fallbackPaper(512, 512, "#ebe3cd", ["street map"]), w: 0.42, h: 0.42, x: -0.6, y: 0.1, rot: -0.03, links: ["old1"], pin: "red" });
    // two old clippings, the kind of thing a man in this line keeps
    const done = R0.completed | 0;
    const c1 = done > 0
      ? { headline: "Man found dead in " + dn[done % dn.length], body: "Police said the man was found shortly before dawn. No arrests have been made and detectives have asked anyone who was in the area overnight to come forward. A neighbour said she heard nothing." }
      : { headline: "Still no arrest in dockside killing", body: "Eight months after the body of a shipping clerk was found beside the container yard, detectives say they have no suspect. The family has offered a reward for information. The case remains open." };
    const c2 = { headline: "Businessman's death ruled an accident", body: "The coroner found no evidence of foul play in the death of the property developer, who fell from the balcony of his apartment in March. His former partner declined to comment." };
    let k1 = null, k2 = null;
    try { k1 = K && K.clipping ? K.clipping(c1, redraw) : null; } catch (e) {}
    try { k2 = K && K.clipping ? K.clipping(c2, redraw) : null; } catch (e) {}
    out.push({ id: "old1", canvas: k1 || fallbackPaper(480, 640, "#e5dfcf", [c1.headline]), w: 0.26, h: 0.347, x: 0.05, y: 0.16, rot: 0.035, links: [], pin: "white" });
    out.push({ id: "old2", canvas: k2 || fallbackPaper(480, 640, "#e5dfcf", [c2.headline]), w: 0.24, h: 0.32, x: 0.5, y: 0.2, rot: -0.05, links: [], pin: "white" });
    // his own index cards, in his own hand
    const paid = R0.paid | 0;
    const tally = ["Settled " + done, paid > 0 ? "$" + paid.toLocaleString() + " in" : "Nothing owed", "Rent paid to Friday"];
    const bits = ["Burner stays on", "No calls from the room", "Ice machine, 2nd floor"];
    let n1 = null, n2 = null;
    try { n1 = K && K.note ? K.note({ lines: tally, hand: true, tone: "index" }) : null; } catch (e) {}
    try { n2 = K && K.note ? K.note({ lines: bits, hand: true, tone: "yellow" }) : null; } catch (e) {}
    out.push({ id: "tally", canvas: n1 || fallbackPaper(400, 260, "#f1ede0", tally), w: 0.2, h: 0.13, x: 0.08, y: -0.33, rot: -0.02, links: [], pin: "red" });
    out.push({ id: "rules", canvas: n2 || fallbackPaper(400, 260, "#f0dc7a", bits), w: 0.19, h: 0.124, x: 0.52, y: -0.3, rot: 0.06, links: [], pin: "white" });
    return out;
  }
  function boardDraw(items) {
    const bd = B.board; if (!bd) return;
    clearBoardNodes();
    const MM = mats();
    const list = (items && items.length ? items : defaults()).filter(function (it) { return it && it.canvas; });
    bd.items = list;
    const pinAt = {};
    const pinGeo = new THREE.CylinderGeometry(0.0065, 0.0075, 0.009, 12);
    const needleGeo = new THREE.CylinderGeometry(0.0007, 0.0007, 0.04, 4);
    let top = 0;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      const cw = it.canvas.width || 1, ch = it.canvas.height || 1;
      const w = it.w || (it.h ? it.h * cw / ch : 0.25), h = it.h || w * ch / cw;
      it.w = w; it.h = h;
      const z = 0.025 + 0.004 * i;
      top = z;
      const tex = paperTex(it.canvas);
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, side: THREE.FrontSide });
      const pm = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      pm.position.set(it.x || 0, it.y || 0, z);
      pm.rotation.z = it.rot || 0;
      pm.receiveShadow = true;
      bd.g.add(pm); bd.nodes.push(pm);
      it._mesh = pm; it._tex = tex;
      // the pin, top centre, through the paper into the cork
      const r = it.rot || 0, off = h / 2 - Math.min(0.02, h * 0.1);
      const px = (it.x || 0) - Math.sin(r) * off, py = (it.y || 0) + Math.cos(r) * off;
      pinAt[it.id] = { x: px, y: py, z: z + 0.006 };
      const head = new THREE.Mesh(pinGeo.clone(), it.pin === "white" ? MM.pinWhite : MM.pinRed);
      head.rotation.x = Math.PI / 2;
      head.position.set(px, py, z + 0.0055);
      bd.g.add(head); bd.nodes.push(head);
      const nd = new THREE.Mesh(needleGeo.clone(), MM.steel);
      nd.rotation.x = Math.PI / 2;
      nd.position.set(px, py, z - 0.019);
      bd.g.add(nd); bd.nodes.push(nd);
    }
    pinGeo.dispose(); needleGeo.dispose();
    // red string between linked pins, above the top paper
    const sz = top + 0.012;
    for (let i = 0; i < list.length; i++) {
      const it = list[i], a = pinAt[it.id];
      const links = it.links || [];
      for (let j = 0; j < links.length; j++) {
        const b = pinAt[links[j]]; if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
        if (len < 0.01) continue;
        const s = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.0032), MM.string);
        s.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, sz);
        s.rotation.z = Math.atan2(dy, dx);
        bd.g.add(s); bd.nodes.push(s);
      }
    }
    bd.refreshT = 6;
  }
  function refreshBoard() {
    const bd = B && B.board; if (!bd) return;
    for (let i = 0; i < bd.items.length; i++) if (bd.items[i]._tex) bd.items[i]._tex.needsUpdate = true;
  }
  // reading order: top row first, left to right (rows banded at 0.18 m)
  function readingOrder(list) {
    return list.slice().sort(function (a, b) {
      const ra = Math.round(-(a.y || 0) / 0.18), rb = Math.round(-(b.y || 0) / 0.18);
      return ra !== rb ? ra - rb : (a.x || 0) - (b.x || 0);
    });
  }

  /* ---------------- deliveries under the door ------------------------------ */
  function deliverMesh(kind, canvas) {
    const K = paperKit();
    let c = canvas;
    if (!c) {
      try { c = kind === "paper" ? (K && K.newspaper ? K.newspaper({ masthead: "The Morning Ledger", headline: localStory().headline }) : null) : (K && K.envelope ? K.envelope({ text: "", sealed: true }) : null); } catch (e) { c = null; }
      if (!c) c = fallbackPaper(kind === "paper" ? 280 : 256, kind === "paper" ? 380 : 160, kind === "paper" ? "#e0dccf" : "#e8dcc0", []);
    }
    const grp = new THREE.Group();
    const tex = paperTex(c);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
    B.ownMats.push(mat);
    B.ownTex.push(tex);
    if (kind === "paper") {
      // folded in half: a newsprint slab, the top half of the front page up
      mesh(boxGeo(0.3, 0.012, 0.4), mats().newsprint, grp, 0, 0.006, 0);
      mesh(new THREE.PlaneGeometry(0.29, 0.39), mat, grp, 0, 0.0125, 0, -Math.PI / 2, 0, 0);
    } else {
      mesh(boxGeo(0.22, 0.004, 0.1375), mats().newsprint, grp, 0, 0.002, 0);
      mesh(new THREE.PlaneGeometry(0.22, 0.1375), mat, grp, 0, 0.0045, 0, -Math.PI / 2, 0, 0);
    }
    grp.traverse(function (o) { o.receiveShadow = true; o.castShadow = false; });
    return { g: grp, canvas: c };
  }

  /* ================================================================
     ENSURE (build once per arena root)
     ================================================================ */
  function disposeBuilt() {
    if (!B) return;
    const cols = CBZ.colliders;
    if (cols) for (let i = cols.length - 1; i >= 0; i--) if (cols[i] && cols[i]._hmRoom) cols.splice(i, 1);
    if (CBZ.markCollidersDirty) { try { CBZ.markCollidersDirty(); } catch (e) {} }
    if (B.group && B.group.parent) B.group.parent.remove(B.group);
    if (B.board) clearBoardNodes();
    for (let i = 0; i < B.geos.length; i++) { try { B.geos[i].dispose(); } catch (e) {} }
    for (let i = 0; i < B.ownMats.length; i++) { try { B.ownMats[i].dispose(); } catch (e) {} }
    for (let i = 0; i < B.ownTex.length; i++) { try { B.ownTex[i].dispose(); } catch (e) {} }
    if (B.phone && B.phone.tex) B.phone.tex.dispose();
    if (B.tv && B.tv.tex) B.tv.tex.dispose();
    B = null;
  }
  function solid(lx0, lz0, lx1, lz1, y0, y1, tag) {
    const a = W(lx0, 0, lz0), b = W(lx1, 0, lz1);
    const c = {
      minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z),
      y0: B.gy + y0, y1: B.gy + y1, ref: B.group, _hmRoom: true, _hmTag: tag || "",
    };
    (CBZ.colliders = CBZ.colliders || []).push(c);
    return c;
  }
  function buildColliders() {
    solid(-OX, -OZ, OX, -HZ, -0.4, IH + 0.25, "wall");
    solid(-OX, -OZ, -HX, OZ, -0.4, IH + 0.25, "wall");
    solid(HX, -OZ, OX, OZ, -0.4, IH + 0.25, "wall");
    solid(-OX, HZ, DOOR.x0, OZ, -0.4, IH + 0.25, "wall");
    solid(DOOR.x1, HZ, OX, OZ, -0.4, IH + 0.25, "wall");
    solid(DOOR.x0, DOOR.h, DOOR.x1, OZ, DOOR.h, IH + 0.25, "lintel");
    B.doorCol = solid(DOOR.x0, HZ - 0.05, DOOR.x1, OZ, -0.4, DOOR.h, "door");
    solid(BED.x0, BED.z0, BED.x1, BED.z1, 0, 0.62, "bed");
    solid(-3.25, -1.75, -2.79, -1.31, 0, 0.6, "stand");
    solid(-3.25, 0.41, -2.79, 0.85, 0, 0.6, "stand");
    solid(-1.45, -HZ, -0.15, -HZ + 0.56, 0, 0.76, "desk");
    solid(DRESSER.x0, DRESSER.z0, DRESSER.x1, DRESSER.z1, 0, DRESSER.top, "dresser");
    solid(TABLE.x - TABLE.w / 2, TABLE.z - TABLE.d / 2, TABLE.x + TABLE.w / 2, TABLE.z + TABLE.d / 2, 0, TABLE.top + 0.18, "table");
    solid(RAIL.x0, RAIL.z0, RAIL.x1, RAIL.z1, 0, 2.1, "rail");
    if (CBZ.markCollidersDirty) { try { CBZ.markCollidersDirty(); } catch (e) {} }
  }
  function setDoorCollider(closed) {
    const cols = CBZ.colliders || [];
    const i = cols.indexOf(B.doorCol);
    if (closed && i < 0) cols.push(B.doorCol);
    else if (!closed && i >= 0) cols.splice(i, 1);
    else return;
    if (CBZ.markCollidersDirty) { try { CBZ.markCollidersDirty(); } catch (e) {} }
  }

  function ensure() {
    const A = arena();
    if (!A || !A.root || !A.lots || !A.lots.length) return B ? B.room : null;
    if (B && B.root === A.root) return B.room;
    if (refusedRoot === A.root) return null;
    if (B) disposeBuilt();
    const at = place();
    if (!at) { refusedRoot = A.root; return null; }
    const yaw = Math.atan2(at.nx, at.nz);                // local +Z -> the street
    B = {
      root: A.root, lot: at.lot, ox: at.x, oz: at.z, gy: at.gy, yaw: yaw,
      cos: Math.round(Math.cos(yaw)), sin: Math.round(Math.sin(yaw)),
      geos: [], ownMats: [], ownTex: [], mat: {},
      inside: false, deliveries: {}, sleeping: false,
    };
    const group = new THREE.Group();
    group.position.set(at.x, at.gy, at.z);
    group.rotation.y = yaw;
    group.userData.transient = false;
    group.name = "hmRoom";
    B.group = group;
    try {
      const S = new Batch();
      buildShell(S);
      buildFurniture(S);
      S.finish(group, B, { frozen: true });
      buildDoor(); buildWindow(); buildLight();
      buildCase(); buildPhone(); buildTV(); buildCloset(); buildBoard();
    } catch (e) {
      if (window.console) console.error("[hmRoom] build failed", e);
      A.root.add(group); disposeBuilt(); refusedRoot = A.root; return null;
    }
    A.root.add(group);
    buildColliders();
    const sp = W(SPAWN.x, 0, SPAWN.z), bc = W(BOARD.x, BOARD.y, -HZ), bs = W(BOARD.x, 0, -HZ + 0.75);
    const heading = Math.atan2(-(bc.x - sp.x), -(bc.z - sp.z));   // forward = (-sin, -cos) * yaw
    const dr = W((DOOR.x0 + DOOR.x1) / 2, 0, OZ + 0.8), ce = W(0, 0, 0);
    B.room = {
      name: at.lot.kind === "motel" ? "The motel room" : "The rented room",
      lot: at.lot,
      // `heading` is a CAMERA yaw (systems/camera.js: forward = (-sin yaw,
      // -cos yaw)), so cam.yaw = spawn.heading wakes you facing the corkboard.
      spawn: { x: sp.x, z: sp.z, heading: heading },
      door: { x: dr.x, z: dr.z },
      board: { x: bs.x, z: bs.z },
      center: { x: ce.x, z: ce.z },
      inside: function (x, z) { if (!B) return false; const l = L(x, z); return insideLocal(l.x, l.z); },
    };
    regVerbs();
    return B.room;
  }

  /* ================================================================
     INSPECT HELPERS
     ================================================================ */
  function inspect(o) {
    const I = CBZ.hmInspect;
    if (!I || !I.enter) return false;
    if (I.active && I.active()) return false;
    try { return !!I.enter(o); } catch (e) { if (window.console) console.error("[hmRoom] inspect", e); return false; }
  }
  function camFov() { const c = CBZ.camera; return c && c.fov ? c.fov : 62; }
  function camAspect() { const c = CBZ.camera; return c && c.aspect ? c.aspect : 1.6; }
  // camera distance that fits a w x h sheet in view with a small margin
  function fitDist(w, h) {
    const t = Math.tan((camFov() * Math.PI / 180) / 2);
    return Math.max(0.2, Math.max((h / 2) / t, (w / 2) / (t * camAspect())) * 1.12);
  }

  function lookBoard() {
    if (!B || !B.board) return;
    const list = readingOrder(B.board.items);
    if (!list.length) return;
    // first the whole board, the way you see it when you walk up; then each paper
    const dAll = fitDist(BOARD.w + 0.2, BOARD.h + 0.15);
    const stops = [{ pos: W(BOARD.x, BOARD.y, -HZ + 0.06 + dAll), look: W(BOARD.x, BOARD.y, -HZ + 0.06), id: "board" }];
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      const lx = BOARD.x + (it.x || 0), ly = BOARD.y + (it.y || 0), lz = -HZ + 0.03 + 0.03;
      const d = fitDist(it.w, it.h);
      stops.push({ pos: W(lx, ly, lz + d), look: W(lx, ly, lz), id: it.id });
    }
    inspect({ stops: stops, index: 0 });
  }

  /* ---------------- the case --------------------------------------------- */
  function caseLocal(x, y, z) {
    // case-group local -> room local (the case group is only nudged, ignore its tiny yaw)
    return { x: TABLE.x + 0.02 + x, y: TABLE.top + 0.001 + y, z: TABLE.z + 0.02 + z };
  }
  function giveGun(it) {
    const id = it.id;
    try {
      if (CBZ.unlockWeapon) { g.cityMeleeWeapon = null; CBZ.unlockWeapon(id, { select: true }); }
      else if (CBZ.cityGiveWeapon) CBZ.cityGiveWeapon(it.city);
    } catch (e) {}
    // rounds come with the gun once per world (a put-back gun is not a refill)
    const R0 = records();
    if (R0) {
      R0.caseAmmo = R0.caseAmmo || {};
      if (!R0.caseAmmo[id] && CBZ.fpsAddAmmo) { try { CBZ.fpsAddAmmo(it.ammo, id); } catch (e) {} R0.caseAmmo[id] = 1; }
    }
    if (it.mods) {
      g.cityGunMods = g.cityGunMods || {};
      const cur = g.cityGunMods[id] || { scope: null, mag: null, muzzle: null, under: null };
      for (const k in it.mods) cur[k] = it.mods[k];
      g.cityGunMods[id] = cur;
      if (CBZ.gunModsDressAll) { try { CBZ.gunModsDressAll(); } catch (e) {} }
    }
    if (CBZ.cityHudDirty) { try { CBZ.cityHudDirty(); } catch (e) {} }
    if (CBZ.cityWorldCommit) { try { CBZ.cityWorldCommit(); } catch (e) {} }
    if (CBZ.sfx) { try { CBZ.sfx("rack"); } catch (e) {} }
  }
  function returnGun(it) {
    try { if (CBZ.lockWeapon) CBZ.lockWeapon(it.id); } catch (e) {}
    if (CBZ.cityHudDirty) { try { CBZ.cityHudDirty(); } catch (e) {} }
    if (CBZ.sfx) { try { CBZ.sfx("equip"); } catch (e) {} }
  }
  function openCase() {
    if (!B || !B.lid) return;
    B.lidWant = 1;
    if (CBZ.sfx) { try { CBZ.sfx("switch"); } catch (e) {} }
    syncCase();
    const I = CBZ.hmInspect;
    if (!I || !I.enter) {
      // no hands module: the case still works, in one press it hands over
      // whatever is not already on you
      for (let i = 0; i < LOADOUT.length; i++) if (!carrying(LOADOUT[i].id)) giveGun(LOADOUT[i]);
      syncCase();
      return;
    }
    const cx = caseLocal(0, CASE.foam, 0);
    const stops = [{ pos: W(cx.x, cx.y + 0.72, cx.z - 0.42), look: W(cx.x, cx.y, cx.z + 0.04), id: "case" }];
    for (let i = 0; i < LOADOUT.length; i++) {
      const it = LOADOUT[i];
      const p = caseLocal(it.at.x, CASE.foam, it.at.z);
      const span = it.key === "rifle" || it.key === "shotgun" ? 1.0 : 0.46;
      const d = fitDist(span, span * 0.5);
      stops.push({ pos: W(p.x, p.y + d * 0.86, p.z - d * 0.5), look: W(p.x, p.y, p.z), id: it.key });
    }
    setTimeout(function () {
      if (!B) return;
      const ok = inspect({
        stops: stops, index: 0,
        onExit: function () { if (B) B.lidWant = 0; },
        verbs: [{
          key: "E",
          verb: function (i) {
            const it = LOADOUT[i - 1]; if (!it) return "";
            return carrying(it.id) ? "Put it back" : "Take " + it.noun;
          },
          onUse: function (i) {
            const it = LOADOUT[i - 1]; if (!it) return;
            if (carrying(it.id)) returnGun(it); else giveGun(it);
            syncCase();
            if (CBZ.hmInspect && CBZ.hmInspect.refreshVerb) CBZ.hmInspect.refreshVerb();
          },
        }],
      });
      if (!ok && B) B.lidWant = 0;
    }, 380);
  }

  /* ---------------- the rail ------------------------------------------------- */
  function openCloset() {
    if (!B || !B.looks || !B.looks.length) return;
    const stops = [];
    for (let i = 0; i < B.looks.length; i++) {
      const lk = B.looks[i];
      const d = fitDist(0.7, 1.05);
      stops.push({ pos: W(RAIL.x - 0.42 - d, RAIL.y - 0.45, lk.z), look: W(RAIL.x - 0.42, RAIL.y - 0.5, lk.z), id: lk.id });
    }
    let cur = 0;
    const pull = function (i) { cur = i; for (let k = 0; k < B.looks.length; k++) B.looks[k].want = k === i ? 1 : 0; };
    const ok = inspect({
      stops: stops, index: 0,
      onStop: function (i) { if (B) pull(i); },
      onExit: function () { if (B) for (let k = 0; k < B.looks.length; k++) B.looks[k].want = 0; },
      verbs: [{
        key: "E",
        verb: function (i) { const lk = B && B.looks[i]; if (!lk) return ""; return lk.id === wornId() ? "Put it back" : "Wear this"; },
        onUse: function (i) {
          const lk = B && B.looks[i]; if (!lk) return;
          let ok2 = false;
          const id = lk.id === wornId() ? "street" : lk.id;
          try { ok2 = !!CBZ.cityWearOutfit(id, { silent: true }); } catch (e) { ok2 = false; }
          if (!ok2) return;
          if (CBZ.sfx) { try { CBZ.sfx("whoosh"); } catch (e) {} }
          syncCloset();
          emit("change", { id: id, name: id === "street" ? "own clothes" : lk.name });
          if (CBZ.hmInspect && CBZ.hmInspect.refreshVerb) CBZ.hmInspect.refreshVerb();
        },
      }],
    });
    if (ok) pull(0);
    void cur;
  }

  /* ---------------- the TV --------------------------------------------------- */
  function watchTV() {
    if (!B || !B.tv) return;
    const dcx = (DRESSER.x0 + DRESSER.x1) / 2;
    const d = fitDist(0.7, 0.394);
    inspect({ pos: W(dcx - d, DRESSER.top + 0.34, -0.7), look: W(dcx, DRESSER.top + 0.34, -0.7) });
  }

  /* ---------------- sleep --------------------------------------------------- */
  function advanceTo(hour) {
    if (!CBZ.dayPhase) return;
    const cur = CBZ.dayPhase();
    const curH = ((cur * 24 + 6) % 24 + 24) % 24;
    let dh = ((hour - curH) % 24 + 24) % 24;
    if (dh < 2) dh += 24;                          // "the next 07:00" is at least a real night away
    const p = cur + dh / 24;
    const wraps = Math.floor(p);
    const np = p - wraps;
    // the sky's calendar (daynight.js counts a day each time the phase wraps)
    if (wraps > 0 && CBZ.dayCount) CBZ.dayCount(CBZ.dayCount() + wraps);
    CBZ.dayPhase(np);
    if (CBZ.cityHour) CBZ.cityHour(hour);            // the ped schedule: hour = phase*24 + 6
    // polity.js's worldDay counts a wrap only when the phase DROPS by more
    // than half a day between frames; a shorter drop would be missed
    if (wraps > 0 && CBZ.worldDay && !(cur - np > 0.5)) { try { CBZ.worldDay(CBZ.worldDay() + 1); } catch (e) {} }
    try { if (CBZ.renderer && CBZ.renderer.shadowMap) CBZ.renderer.shadowMap.needsUpdate = true; } catch (e) {}
  }
  function sleepUntil(hour, done) {
    if (!B || B.sleeping) return false;
    hour = hour == null ? 7 : +hour;
    B.sleeping = true;
    const wake = function () {
      advanceTo(hour);
      // wake standing at the side of the bed, facing the room
      const pl = P();
      if (pl && pl.pos && B) {
        const at = W(-0.9, 0, -0.5), to = W(1.0, 0, -0.8);
        pl.pos.set(at.x, B.gy, at.z);
        if (CBZ.cam) CBZ.cam.yaw = Math.atan2(-(to.x - at.x), -(to.z - at.z));
      }
      if (B && B.tv && B.tv.own) { B.tv.story = null; tvIdle(); }
      emit("sleep", { hour: hour, day: CBZ.dayCount ? CBZ.dayCount() : 0 });
    };
    const finish = function () { if (B) B.sleeping = false; if (done) { try { done(); } catch (e) {} } };
    if (CBZ.hmFade) {
      CBZ.hmFade(wake, 900);
      setTimeout(finish, 620 + 900 + 700);
    } else { wake(); finish(); }
    return true;
  }

  /* ================================================================
     VERBS (CBZ.hmVerbs; registered when hands exist, retried until then)
     ================================================================ */
  let verbsReg = false;
  const tok = {};
  function T(name, lx, ly, lz) {
    const w = W(lx, ly, lz);
    const t = tok[name] || (tok[name] = {});
    t.x = w.x; t.z = w.z; t.y = w.y; t.kind = name;
    return t;
  }
  function near(P0, lx, lz, r) {
    if (!B || !P0 || !P0.pos) return false;
    if (Math.abs(P0.pos.y - B.gy) > 1.3) return false;
    const l = L(P0.pos.x, P0.pos.z);
    return Math.hypot(l.x - lx, l.z - lz) < r;
  }
  function pinside(P0) {
    if (!B || !P0 || !P0.pos || Math.abs(P0.pos.y - B.gy) > 1.3) return false;
    const l = L(P0.pos.x, P0.pos.z);
    return insideLocal(l.x, l.z);
  }
  function regVerbs() {
    if (verbsReg) return;
    const V = CBZ.hmVerbs;
    if (!V || !V.add) return;
    verbsReg = true;
    V.add({
      id: "hmroom-delivery", prio: 30,
      find: function (px, pz, P0) {
        if (!B || !pinside(P0)) return null;
        for (const k in B.deliveries) {
          const d = B.deliveries[k];
          if (!d || d.t < d.dur) continue;
          if (!near(P0, d.to.x, d.to.z, 1.5)) continue;
          const t = T("delivery_" + k, d.to.x, 0.05, d.to.z); t.dk = k;
          return t;
        }
        return null;
      },
      verb: function (t) { const d = B && t && B.deliveries[t.dk]; return d ? (d.verb || "Pick up") : ""; },
      onUse: function (t) { pickDelivery(t.dk); },
    });
    V.add({
      id: "hmroom-phone", prio: 40,
      find: function (px, pz, P0) {
        if (!B || !B.phone || !B.phone.ringing || !pinside(P0)) return null;
        if (!near(P0, PHONE_AT.x, PHONE_AT.z, 2.2)) return null;
        return T("phone", PHONE_AT.x, BED.top, PHONE_AT.z);
      },
      verb: "Answer",
      onUse: function () { answerPhone(); },
    });
    V.add({
      id: "hmroom-board", prio: 20,
      find: function (px, pz, P0) {
        if (!B || !B.board || !pinside(P0)) return null;
        if (!near(P0, BOARD.x, -HZ + 0.6, 1.9)) return null;
        return T("board", BOARD.x, BOARD.y, -HZ);
      },
      verb: "Look",
      onUse: function () { lookBoard(); },
    });
    V.add({
      id: "hmroom-case", prio: 20,
      find: function (px, pz, P0) {
        if (!B || !B.lid || B.lidWant > 0 || !pinside(P0)) return null;
        if (!near(P0, TABLE.x, TABLE.z, 1.7)) return null;
        return T("case", TABLE.x, TABLE.top, TABLE.z);
      },
      verb: "Open",
      onUse: function () { openCase(); },
    });
    V.add({
      id: "hmroom-closet", prio: 20,
      find: function (px, pz, P0) {
        if (!B || !B.looks || !B.looks.length || !pinside(P0)) return null;
        if (!near(P0, RAIL.x0 - 0.2, (RAIL.z0 + RAIL.z1) / 2, 1.6)) return null;
        return T("closet", RAIL.x, 1.2, (RAIL.z0 + RAIL.z1) / 2);
      },
      verb: "Change",
      onUse: function () { openCloset(); },
    });
    V.add({
      id: "hmroom-tv", prio: 15,
      find: function (px, pz, P0) {
        if (!B || !B.tv || !pinside(P0)) return null;
        if (!near(P0, DRESSER.x0 - 1.2, -0.7, 1.7)) return null;
        return T("tv", DRESSER.x0, DRESSER.top + 0.34, -0.7);
      },
      verb: "Watch",
      onUse: function () { watchTV(); },
    });
    V.add({
      id: "hmroom-bed", prio: 10,
      find: function (px, pz, P0) {
        if (!B || B.sleeping || !pinside(P0)) return null;
        if ((g.wanted | 0) > 0 || (B.phone && B.phone.ringing)) return null;
        if (!near(P0, BED.x1 - 0.5, (BED.z0 + BED.z1) / 2, 1.5)) return null;
        return T("bed", BED.x1 - 0.6, BED.top, (BED.z0 + BED.z1) / 2);
      },
      verb: "Sleep",
      onUse: function () { sleepUntil(7); },
    });
    V.add({
      id: "hmroom-door", prio: 8,
      find: function (px, pz, P0) {
        if (!B || !B.doorPivot) return null;
        const cx = (DOOR.x0 + DOOR.x1) / 2;
        if (!near(P0, cx, HZ, 1.8) || near(P0, cx, HZ + 0.07, 0.78)) return null;
        return T("door", cx, 1.0, HZ);
      },
      verb: function () { return B && B.doorWant > 0.5 ? "Close" : "Open"; },
      onUse: function () { if (!B) return; setDoor(B.doorWant > 0.5 ? 0 : 1); },
    });
  }

  function setDoor(v) {
    if (!B) return;
    if (v === B.doorWant) return;
    B.doorWant = v;
    if (v > 0) setDoorCollider(false);
    if (CBZ.sfx) { try { CBZ.sfx(v > 0 ? "door_open" : "door_close"); } catch (e) {} }
  }

  /* ---------------- phone / deliveries actions ----------------------------- */
  function ring(opts) {
    if (!ensure() || !B.phone) return null;
    opts = opts || {};
    const ph = B.phone;
    ph.ringing = true; ph.from = opts.from || "Unknown"; ph.onAnswer = opts.onAnswer || null; ph.t = 0; ph.pulse = -1;
    phoneScreen("ringing");
    return { stop: stopRing, ringing: function () { return !!(B && B.phone && B.phone.ringing); } };
  }
  function stopRing() {
    if (!B || !B.phone) return;
    const ph = B.phone;
    ph.ringing = false; ph.onAnswer = null;
    ph.g.position.set(ph.base.x, BED.top + 0.021, ph.base.z);
    ph.g.rotation.set(0, ph.base.ry, 0);
    phoneScreen("idle");
  }
  function answerPhone() {
    if (!B || !B.phone || !B.phone.ringing) return;
    const cb = B.phone.onAnswer, from = B.phone.from;
    stopRing();
    if (CBZ.sfx) { try { CBZ.sfx("pickup"); } catch (e) {} }
    emit("answer", { from: from });
    if (cb) { try { cb(); } catch (e) { if (window.console) console.error("[hmRoom] onAnswer", e); } }
  }
  function deliver(kind, opts) {
    if (!ensure()) return null;
    kind = kind === "paper" ? "paper" : "envelope";
    opts = opts || {};
    clearDelivery(kind);
    const m = deliverMesh(kind, opts.canvas || null);
    const r = rng(((now() * 1000) | 0) + (kind === "paper" ? 7 : 3));
    const d = {
      kind: kind, g: m.g, canvas: m.canvas, verb: opts.verb || "Pick up", onPick: opts.onPick || null,
      from: { x: 2.3, z: HZ + 0.12 }, to: { x: (DOOR.x0 + DOOR.x1) / 2 - 0.05 + (r() - 0.5) * 0.25, z: HZ - (kind === "paper" ? 0.42 : 0.32) - r() * 0.12 },
      ry0: (r() - 0.5) * 0.3, ry1: (r() - 0.5) * 0.9, t: 0, dur: 0.85,
    };
    m.g.position.set(d.from.x, 0.006, d.from.z);
    m.g.rotation.y = d.ry0;
    B.group.add(m.g);
    B.deliveries[kind] = d;
    return { waiting: function () { return !!(B && B.deliveries[kind] === d); }, clear: function () { if (B && B.deliveries[kind] === d) clearDelivery(kind); } };
  }
  function clearDelivery(kind) {
    if (!B) return;
    const d = B.deliveries[kind]; if (!d) return;
    if (d.g.parent) d.g.parent.remove(d.g);
    d.g.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
    delete B.deliveries[kind];
  }
  function pickDelivery(kind) {
    if (!B) return;
    const d = B.deliveries[kind]; if (!d) return;
    const cb = d.onPick, canvas = d.canvas;
    clearDelivery(kind);
    if (CBZ.sfx) { try { CBZ.sfx("pickup"); } catch (e) {} }
    emit("pick", { kind: kind, canvas: canvas });
    if (cb) { try { cb(canvas); } catch (e) { if (window.console) console.error("[hmRoom] onPick", e); } }
    else if (CBZ.hmHold && CBZ.hmHold.open) { try { CBZ.hmHold.open(canvas, { kind: kind === "paper" ? "news" : "paper" }); } catch (e) {} }
  }

  /* ================================================================
     TICK
     ================================================================ */
  function ease(t) { return t < 0 ? 0 : t > 1 ? 1 : 1 - Math.pow(1 - t, 3); }
  let tvT = 0;
  function tick(dt) {
    if (!playing()) return;
    if (!B || B.root !== (arena() && arena().root)) ensure();
    if (!B) return;
    regVerbs();
    dt = Math.min(0.1, dt || 0.016);
    const pl = P();
    const far = !pl || !pl.pos || Math.hypot(pl.pos.x - B.ox, pl.pos.z - B.oz) > 70;

    // enter / leave
    const inNow = !!(pl && pinside(pl));
    if (inNow !== B.inside) { B.inside = inNow; emit(inNow ? "enter" : "leave", { room: B.room }); }

    // the door: approach opens it (from either side), and it swings
    if (pl && pl.pos && B.doorWant < 0.5) {
      const cx = (DOOR.x0 + DOOR.x1) / 2;
      if (near(pl, cx, HZ + 0.07, 0.7)) setDoor(1);       // walking into it, from either side
    }
    const dw = B.doorWant, dOpen = B.doorOpen;
    if (Math.abs(dw - dOpen) > 0.001) {
      B.doorOpen = dOpen + Math.sign(dw - dOpen) * Math.min(Math.abs(dw - dOpen), dt * 1.6);
      B.doorPivot.rotation.y = -ease(B.doorOpen) * 1.62;
      if (B.doorOpen < 0.002 && dw === 0) setDoorCollider(true);
    }

    // the lid
    if (Math.abs(B.lidWant - B.lidOpen) > 0.001) {
      B.lidOpen += Math.sign(B.lidWant - B.lidOpen) * Math.min(Math.abs(B.lidWant - B.lidOpen), dt * 2.2);
      B.lid.rotation.x = ease(B.lidOpen) * 1.78;
    }
    // clothes sliding off the rail toward you
    if (B.looks) for (let i = 0; i < B.looks.length; i++) {
      const lk = B.looks[i];
      if (Math.abs(lk.want - lk.pull) < 0.001) continue;
      lk.pull += Math.sign(lk.want - lk.pull) * Math.min(Math.abs(lk.want - lk.pull), dt * 3);
      const e = ease(lk.pull);
      lk.g.position.x = RAIL.x - 0.42 * e;
      lk.g.rotation.y = -Math.PI / 2 * e + (i % 2 ? 0.05 : -0.04) * (1 - e);
    }
    // deliveries slide in under the door
    for (const k in B.deliveries) {
      const d = B.deliveries[k];
      if (d.t >= d.dur) continue;
      d.t = Math.min(d.dur, d.t + dt);
      const e = ease(d.t / d.dur);
      d.g.position.set(d.from.x + (d.to.x - d.from.x) * e, 0.006, d.from.z + (d.to.z - d.from.z) * e);
      d.g.rotation.y = d.ry0 + (d.ry1 - d.ry0) * e;
      if (d.t >= d.dur && CBZ.sfx) { try { CBZ.sfx("whoosh"); } catch (e2) {} }
    }
    // the phone buzzes: buzz-buzz, rest, the whole thing rattling on the spread
    const ph = B.phone;
    if (ph && ph.ringing) {
      ph.t += dt;
      const cyc = ph.t % 2.3;
      const on = cyc < 0.4 || (cyc > 0.58 && cyc < 0.98);
      const pulse = cyc < 0.4 ? 0 : (cyc > 0.58 && cyc < 0.98 ? 1 : -1);
      if (pulse >= 0 && pulse !== ph.pulse) {
        const d = pl && pl.pos ? Math.hypot(pl.pos.x - W(PHONE_AT.x, 0, PHONE_AT.z).x, pl.pos.z - W(PHONE_AT.x, 0, PHONE_AT.z).z) : 99;
        buzz(0.16 * clamp(1 - d / 16, 0, 1) * (B.inside || d < 5 ? 1 : 0.35));
      }
      ph.pulse = pulse;
      if (on) {
        ph.g.position.set(ph.base.x + (Math.random() - 0.5) * 0.004, BED.top + 0.021 + Math.random() * 0.0015, ph.base.z + (Math.random() - 0.5) * 0.004);
        ph.g.rotation.y = ph.base.ry + (Math.random() - 0.5) * 0.03;
        ph.base.ry += (Math.random() - 0.5) * 0.004;       // it walks, a little, over a long ring
      }
      ph.scr.color.setScalar(on ? 1 : 0.8);
    }
    if (far) return;

    // day / night on the glass and the sun stripes
    const n = night();
    if (B.glass) {
      const gm = B.glass.material;
      gm.color.setRGB(0.62 * (1 - n) + 0.04 * n, 0.7 * (1 - n) + 0.06 * n, 0.75 * (1 - n) + 0.12 * n);
      gm.opacity = 0.35 + 0.35 * n;
    }
    if (B.sunStripes) B.sunStripes.material.opacity = 0.32 * (1 - n) * (1 - n);
    // the TV: a slow flicker, and the ticker crawls while you are in the room
    if (B.tv) {
      B.tv.scr.color.setScalar(0.86 + Math.random() * 0.06);
      if (B.tv.own && B.inside) {
        tvT += dt;
        if (tvT > 0.25) { tvT = 0; B.tv.off = (B.tv.off + 18) % 1600; tvIdle(); }
      }
      if (B.tv.own && CBZ.dayCount && CBZ.dayCount() !== B.tv.day) tvIdle();
    }
    // board textures whose photographs are still loading
    if (B.board && B.board.refreshT > 0) {
      B.board.refreshT -= dt;
      B.board.pulse = (B.board.pulse || 0) - dt;
      if (B.board.pulse <= 0) { B.board.pulse = 0.5; refreshBoard(); }
    }
    // the case shows what you do not carry
    B.syncT = (B.syncT || 0) - dt;
    if (B.syncT <= 0) { B.syncT = 0.5; syncCase(); syncCloset(); }
  }
  if (CBZ.onUpdate) CBZ.onUpdate(39.4, tick);

  /* ================================================================
     THE PUBLIC FACE
     ================================================================ */
  CBZ.hmRoom = {
    ensure: ensure,
    inRoom: function () { return !!(B && B.inside); },
    on: function (ev, cb) { if (subs[ev] && typeof cb === "function") subs[ev].push(cb); },
    onChange: function (cb) { if (typeof cb === "function") subs.change.push(cb); },
    board: {
      set: function (items) { if (!ensure() || !B.board) return false; B.board.custom = items && items.length ? items : null; boardDraw(B.board.custom); return true; },
      reset: function () { if (!ensure() || !B.board) return false; B.board.custom = null; boardDraw(null); return true; },
      items: function () { return B && B.board ? B.board.items.slice() : []; },
      defaults: function () { return ensure() ? defaults() : []; },
      refresh: refreshBoard,
      look: function () { if (ensure()) lookBoard(); },
    },
    phone: {
      ring: ring,
      stop: stopRing,
      ringing: function () { return !!(B && B.phone && B.phone.ringing); },
      answer: answerPhone,
    },
    door: {
      deliver: deliver,
      clear: function (kind) { clearDelivery(kind === "paper" ? "paper" : "envelope"); },
      waiting: function (kind) { return !!(B && B.deliveries[kind === "paper" ? "paper" : "envelope"]); },
      open: function () { if (ensure()) setDoor(1); },
      close: function () { if (ensure()) setDoor(0); },
      isOpen: function () { return !!(B && B.doorWant > 0.5); },
    },
    tv: {
      show: function (canvas) { if (!ensure() || !B.tv || !canvas) return false; tvSet(canvas, false); return true; },
      idle: function () { if (!ensure() || !B.tv) return false; B.tv.own = true; B.tv.canvas = null; tvIdle(); return true; },
      watch: function () { if (ensure()) watchTV(); },
    },
    gunCase: {
      open: function () { if (ensure()) openCase(); },
      close: function () { if (B) B.lidWant = 0; },
      isOpen: function () { return !!(B && B.lidWant > 0); },
      loadout: function () { return LOADOUT.map(function (it) { return { key: it.key, id: it.id, carried: carrying(it.id) }; }); },
    },
    closet: {
      open: function () { if (ensure()) openCloset(); },
      looks: function () { return B && B.looks ? B.looks.map(function (l) { return { id: l.id, name: l.name }; }) : []; },
    },
    sleep: {
      now: function (done) { return ensure() ? sleepUntil(7, done) : false; },
      until: function (hour, done) { return ensure() ? sleepUntil(hour, done) : false; },
      busy: function () { return !!(B && B.sleeping); },
    },
    audit: function () {
      return {
        built: !!B, at: B ? { x: +B.ox.toFixed(1), z: +B.oz.toFixed(1), yaw: +B.yaw.toFixed(2) } : null,
        boardItems: B && B.board ? B.board.items.length : 0, verbs: verbsReg,
        colliders: (CBZ.colliders || []).filter(function (c) { return c && c._hmRoom; }).length,
        looks: B && B.looks ? B.looks.length : 0, ringing: !!(B && B.phone && B.phone.ringing),
        deliveries: B ? Object.keys(B.deliveries) : [], inside: !!(B && B.inside),
      };
    },
  };
  // compat: origins.js / campaign.js / tools read room.spawn, room.board, room.name
  CBZ.hitmanRoom = function () { return CBZ.hmRoom.ensure(); };
})();
