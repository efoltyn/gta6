/* ============================================================
   world/textures_masonry.js — PROCEDURAL MASONRY (brick + ashlar stone)
   for the punched-masonry / civic facade family in city/buildings.js.

   WHY THIS FILE EXISTS (and why it is deliberately small):
     core/batch.js refuses to merge ANY mesh whose material carries a `map`
     (batch.js:171 / :196 — `if (mat.map || mat.transparent ...) return null`).
     So a textured brick wall opts itself OUT of the city-wide static merge,
     which is exactly the wrong trade in the most object-dense part of the
     game. The rule this module enforces:

       • STRUCTURAL walls stay FLAT-LAMBERT + untextured (mergeable). The
         brick "read" comes from GEOMETRY — piers, sills, lintels, string
         courses, quoins, corbelled cornices — all merged deco boxes.
       • TEXTURE appears only on a bounded set of VENEER TILES that ride an
         InstancedMesh pool (one pool per colourway per world sector), so
         the whole city's brick detail costs a handful of draw calls.

     Consequence: the colourway set is FIXED and SMALL (6). One material per
     colourway → one pool per colourway per sector. Adding a seventh is a
     draw-call decision, not a palette whim.

   TILING CONTRACT: every veneer tile is a BoxGeometry unit cube scaled to
   ~CBZ.masonryTile (1.6m × 0.8m). r128 BoxGeometry UVs run 0..1 per face, so
   ONE tile == ONE texture repeat; the consumer stretches tiles by at most a
   few percent to fit a band exactly. Never stretch a tile past ~2× or the
   brick course height stops reading as brick.

   DETERMINISM: canvas painting uses fixed arithmetic sequences ((i*53)%128
   style, copied from world/materials.js's concreteTex idiom) — never
   Math.random — so a texture is byte-identical run to run. Colourway
   SELECTION is CBZ.hash01 position-hashed, never a shared rng() stream.

   NO FILES ARE LOADED. Everything is <canvas> + THREE.CanvasTexture, r128.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  // one veneer tile in world metres. 1.6 × 0.8 ≈ 7 stretchers × 10 courses at
  // real brick module (215mm brick + 10mm perp, 65mm brick + 10mm bed joint).
  CBZ.masonryTile = { w: 1.6, h: 0.8 };

  // ---- THE FIXED COLOURWAY SET -------------------------------------------
  // `wall`  — flat Lambert colour for the (untextured, batch-mergeable)
  //           structural wall boxes. Chosen to sit close to the texture's
  //           mean value so a veneer band never reads as a pasted-on sticker.
  // `stone` — contrasting sill / lintel / string-course / coping colour.
  // `mortar`/`a`/`b` — canvas paints (strings) for the texture generator.
  const COLORWAYS = [
    { id: "brick_red",   kind: "brick",  wall: 0x8a4a36, stone: 0xcfc6b0, dirt: 0x4a3126,
      mortar: "#bfb2a0", a: "#96513a", b: "#7d4230", c: "#a75f42" },
    { id: "brick_brown", kind: "brick",  wall: 0x6d4a36, stone: 0xc4b8a0, dirt: 0x3d2b20,
      mortar: "#b3a893", a: "#77513b", b: "#5f4230", c: "#835c44" },
    { id: "brick_buff",  kind: "brick",  wall: 0xa78a63, stone: 0xd9d2c0, dirt: 0x5a4633,
      mortar: "#cfc5ae", a: "#b0916a", b: "#9a7d59", c: "#bd9e74" },
    { id: "brick_grey",  kind: "brick",  wall: 0x746f68, stone: 0xbebbb2, dirt: 0x3a3833,
      mortar: "#a9a49a", a: "#7d786f", b: "#6a655e", c: "#8a857c" },
    { id: "stone_lime",  kind: "ashlar", wall: 0xc6bda6, stone: 0xd9d2c0, dirt: 0x6a604e,
      mortar: "#a99f8a", a: "#cdc4ad", b: "#bfb5a0", c: "#d6cdb8" },
    { id: "stone_gran",  kind: "ashlar", wall: 0x969a9e, stone: 0xb3b7bb, dirt: 0x4a4d50,
      mortar: "#7f8387", a: "#9ca0a4", b: "#8d9195", c: "#a8acb0" },
  ];
  const BY_ID = new Map();
  for (const cw of COLORWAYS) BY_ID.set(cw.id, cw);
  CBZ.MASONRY_COLORWAYS = COLORWAYS;
  CBZ.masonryColorway = function (id) { return BY_ID.get(id) || COLORWAYS[0]; };

  // BRICK family / STONE family, split so a caller can ask for "any brick".
  const BRICKS = COLORWAYS.filter((c) => c.kind === "brick").map((c) => c.id);
  const STONES = COLORWAYS.filter((c) => c.kind === "ashlar").map((c) => c.id);
  CBZ.MASONRY_BRICK_IDS = BRICKS;
  CBZ.MASONRY_STONE_IDS = STONES;

  // Deterministic colourway pick for a world position. `family` is "brick" |
  // "ashlar". Position-hashed (CBZ.hash01) so it is independent of build
  // ORDER — lot #23's brick can be decided without building lots 0..22.
  CBZ.masonryPick = function (family, x, z, salt) {
    const list = family === "ashlar" ? STONES : BRICKS;
    const h = CBZ.hash01 ? CBZ.hash01(x, z, salt == null ? 0xb21c : salt) : 0.5;
    return list[Math.min(list.length - 1, (h * list.length) | 0)];
  };

  // ---- TEXTURE RESOLUTION, tiered ----------------------------------------
  // Textures are generated LAZILY (first use) and cached forever, so the tier
  // read here is a build-time snapshot — exactly how the elevator cap and the
  // crowd budget already read CBZ.qScale. Low tiers get a half-res canvas:
  // same look at distance, a quarter of the texture memory.
  function texW() {
    const lvl = CBZ.qualityLevel != null ? CBZ.qualityLevel : 2;
    return lvl <= 0 ? 128 : (lvl === 1 ? 192 : 256);
  }

  // deterministic 0..1 sequence — the concreteTex idiom (world/materials.js),
  // NOT Math.random, so every canvas is byte-identical across runs/clients.
  function det(i, m) { return ((i * 1103515 + m * 12345) % 977) / 977; }

  function shadeStr(hex3, f) {
    // hex3 = "#rrggbb" → scaled string
    const n = parseInt(hex3.slice(1), 16);
    const r = Math.max(0, Math.min(255, (((n >> 16) & 255) * f) | 0));
    const g = Math.max(0, Math.min(255, (((n >> 8) & 255) * f) | 0));
    const b = Math.max(0, Math.min(255, ((n & 255) * f) | 0));
    return "#" + ("000000" + ((r << 16) | (g << 8) | b).toString(16)).slice(-6);
  }

  // ---- BRICK: stretcher bond with a header course every 5th row ----------
  function brickCanvas(cw) {
    const W = texW(), H = W >> 1;              // 2:1 → matches the 1.6×0.8 tile
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    const ROWS = 10;                            // 10 bed courses per 0.8m tile
    const COLS = 7;                             // 7 stretchers per 1.6m tile
    const rh = H / ROWS, bw = W / COLS;
    const joint = Math.max(1, Math.round(W / 128));   // mortar joint in px
    g.fillStyle = cw.mortar; g.fillRect(0, 0, W, H);
    const paints = [cw.a, cw.b, cw.c];
    for (let r = 0; r < ROWS; r++) {
      const header = (r % 5) === 4;             // a header (short-brick) course
      const n = header ? COLS * 2 : COLS;
      const cellW = W / n;
      const off = (r % 2) ? cellW * 0.5 : 0;    // running bond half-lap
      for (let i = -1; i <= n; i++) {
        const x = i * cellW + off;
        const y = r * rh;
        const k = (r * 13 + i * 7) % 3;
        let p = paints[k];
        // per-brick tone jitter so a wall never reads as a repeating stamp
        p = shadeStr(p, 0.90 + det(r * 31 + i * 17, r) * 0.20);
        g.fillStyle = p;
        g.fillRect(x + joint * 0.5, y + joint * 0.5, cellW - joint, rh - joint);
      }
    }
    // soot / weathering wash: faint vertical streaks + a deterministic speckle
    g.globalAlpha = 0.10;
    g.fillStyle = "#1b1512";
    for (let i = 0; i < 14; i++) {
      const x = ((i * 53) % W);
      g.fillRect(x, 0, Math.max(1, W / 96), H * (0.35 + det(i, 3) * 0.65));
    }
    g.globalAlpha = 0.16;
    for (let i = 0; i < 90; i++) {
      g.fillStyle = (i & 1) ? "#0d0a08" : "#e8dfd2";
      g.fillRect((i * 53) % W, (i * 97) % H, 1, 1);
    }
    g.globalAlpha = 1;
    return c;
  }

  // ---- ASHLAR: big drafted-margin stone blocks (civic / bank / courthouse)
  function ashlarCanvas(cw) {
    const W = texW(), H = W >> 1;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    const ROWS = 4, COLS = 3;                   // 0.2m courses × 0.53m blocks
    const rh = H / ROWS, bw = W / COLS;
    const joint = Math.max(1, Math.round(W / 96));
    g.fillStyle = cw.mortar; g.fillRect(0, 0, W, H);
    for (let r = 0; r < ROWS; r++) {
      const off = (r % 2) ? bw * 0.5 : 0;       // broken vertical joints
      for (let i = -1; i <= COLS; i++) {
        const x = i * bw + off, y = r * rh;
        const face = shadeStr(cw.a, 0.94 + det(r * 41 + i * 23, r + 5) * 0.14);
        g.fillStyle = face;
        g.fillRect(x + joint, y + joint, bw - joint * 2, rh - joint * 2);
        // drafted margin: a bright top/left chamfer + a dark bottom/right one,
        // so each block reads carved rather than painted.
        g.fillStyle = shadeStr(cw.c, 1.06);
        g.fillRect(x + joint, y + joint, bw - joint * 2, Math.max(1, joint));
        g.fillRect(x + joint, y + joint, Math.max(1, joint), rh - joint * 2);
        g.fillStyle = shadeStr(cw.b, 0.80);
        g.fillRect(x + joint, y + rh - joint * 2, bw - joint * 2, Math.max(1, joint));
        g.fillRect(x + bw - joint * 2, y + joint, Math.max(1, joint), rh - joint * 2);
      }
    }
    // limestone mottling + rain staining under the horizontal joints
    g.globalAlpha = 0.12;
    for (let i = 0; i < 70; i++) {
      g.fillStyle = (i % 3) ? "#171412" : "#f2ece0";
      g.fillRect((i * 53) % W, (i * 97) % H, 2, 2);
    }
    g.globalAlpha = 0.09; g.fillStyle = "#2a241c";
    for (let r = 1; r < ROWS; r++) {
      for (let i = 0; i < 6; i++) {
        const x = ((i * 71 + r * 29) % W);
        g.fillRect(x, r * rh, Math.max(1, W / 128), rh * (0.3 + det(i, r) * 0.6));
      }
    }
    g.globalAlpha = 1;
    return c;
  }

  // ---- cached texture + material per colourway ---------------------------
  const texCache = new Map(), matCache = new Map();

  CBZ.masonryTex = function (id) {
    let t = texCache.get(id);
    if (t) return t;
    const cw = CBZ.masonryColorway(id);
    const canvas = cw.kind === "ashlar" ? ashlarCanvas(cw) : brickCanvas(cw);
    t = new THREE.CanvasTexture(canvas);
    // r128: wrapS/wrapT + LinearFilter. RepeatWrapping matters because a
    // consumer MAY set map.repeat on a private clone; the pooled instances
    // themselves use exactly one repeat per tile.
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 1;
    texCache.set(id, t);
    return t;
  };

  // The ONE material per colourway. Lambert (never Standard — house rule:
  // roads/cars are the only Standard materials). `color` stays white so the
  // canvas carries all the colour; `_shared` marks it never-dispose.
  CBZ.masonryMat = function (id) {
    let m = matCache.get(id);
    if (m) return m;
    m = new THREE.MeshLambertMaterial({ color: 0xffffff, map: CBZ.masonryTex(id) });
    m._shared = true;
    m.userData = m.userData || {};
    matCache.set(id, m);
    return m;
  };

  // flat (untextured) palette a builder uses for the STRUCTURAL boxes, so the
  // mergeable walls and the textured veneer read as one material family.
  CBZ.masonryPalette = function (id) {
    const cw = CBZ.masonryColorway(id);
    return { wall: cw.wall, stone: cw.stone, dirt: cw.dirt, kind: cw.kind, id: cw.id };
  };
})();
