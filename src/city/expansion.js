/* ============================================================
   city/expansion.js - the life-game island district.

   This copies the disaster arena's world language into CITY mode:
   a circular island, beach, street grid, enterable low-rise town,
   trees, parked cars, a service station and an auto showroom. The
   disaster hills are replaced with a central pair of massive towers
   and three additional climbable skyline towers. A bridge continues
   the mainland centre street through the east-wall gate.

   ROOMS WORTH ENTERING (why: the island shells were built BARE — the
   bridge ride over should end somewhere worth walking into):
   every storey of every island building is dressed through the shared
   CBZ.cityFurnishApartment dresser (clearFloorPoint-gated, opaque,
   batch-merged), and the gas station / showroom get real interiors
   (kiosk counter + stocked racks; sales desk + tyre wall + plinth).

   Hooked by city/world.js after the original city buildings exist.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const mat = CBZ.mat;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});

  // ---- ANNEX_GROUND_V2 — THE ISLAND WAS A CHECKERBOARD --------------------
  // OWNER: "on the island the green checkered ground is retardedly fake."
  // MEASURED CAUSE, not a guess: the floor was
  //     CBZ.checkerTex(COL.GRASS_A, COL.GRASS_B, 2), repeat.set(28, 28)
  // and checkerTex (world/materials.js) bakes a 256 px canvas holding a LITERAL
  // 2x2 CHESSBOARD of two flat greens (#57b257 / #4aa14a) with
  // `magFilter = NearestFilter` — hard edges by construction, no filtering.
  // Tiled 28x across a 240 m disc that is one tile every 8.6 m and one
  // razor-edged green square every 4.3 m: a 56x56 chessboard you can count
  // from the air. No amount of repeat tuning fixes a texture that IS a chequer.
  //
  // ON → the disc becomes a real vertex-coloured land-cover surface, using the
  // METHOD city/continent.js already proved in CONTINENT_LANDCOVER_V2 (whose
  // own note says the hashed 22/90 u colour CELLS "dissolved into orange/green
  // confetti from any altitude"): three SMOOTH multi-scale fields sampled in
  // WORLD space, interpolated between cells instead of snapped, lerped through
  // a turf palette, plus a low-contrast seamless grain map for near detail and
  // a sand blend into the beach ring so the island edge stops being a hard
  // colour join. Still ONE draw call; the geometry cost is a 129x27 ring grid.
  // OFF → the exact old chequer.
  if (CFG.ANNEX_GROUND_V2 == null) CFG.ANNEX_GROUND_V2 = true;
  // ---- ANNEX_STREETS_V2 — "and road looks awful" --------------------------
  // MEASURED CAUSE: the island streets were ~40 separate untextured Lambert
  // planes (flat #33363d, no map at all) plus 25 SEPARATE junction squares in a
  // DIFFERENT tone (0x2e3138) sitting 1 cm proud of them — and those squares
  // existed only to paper over the fact that every crossing laid two COPLANAR
  // road planes at exactly y=0.05, which z-fights. The bridge deck in this same
  // file already got a baked tarmac grain (bakeTarmac) and the island streets
  // never did, so the island read as painted cardboard beside its own bridge.
  // ON → one merged, world-UV'd, tarmac-textured surface for the whole island
  // street network + one merged concrete shoulder + one merged dash mesh (3
  // draws, was ~105), the two axes separated by 2 mm so nothing is coplanar and
  // the mismatched junction patches are gone. OFF → the old planes.
  if (CFG.ANNEX_STREETS_V2 == null) CFG.ANNEX_STREETS_V2 = true;

  // Deterministic smooth value noise (city/continent.js's noise2, verbatim in
  // shape): hash01 corners, smoothstep interpolation. NEVER Math.random and
  // never the shared rng() stream — this is a build/generation path.
  function sm01(t) { t = t < 0 ? 0 : (t > 1 ? 1 : t); return t * t * (3 - 2 * t); }
  function gnoise(x, z, cell, salt) {
    if (!CBZ.hash01) return 0.5;
    const gx = x / cell, gz = z / cell;
    const x0 = Math.floor(gx), z0 = Math.floor(gz);
    const fx = sm01(gx - x0), fz = sm01(gz - z0);
    const h00 = CBZ.hash01(x0 * cell, z0 * cell, salt);
    const h10 = CBZ.hash01((x0 + 1) * cell, z0 * cell, salt);
    const h01 = CBZ.hash01(x0 * cell, (z0 + 1) * cell, salt);
    const h11 = CBZ.hash01((x0 + 1) * cell, (z0 + 1) * cell, salt);
    const a = h00 + (h10 - h00) * fx, b = h01 + (h11 - h01) * fx;
    return a + (b - a) * fz;
  }

  // Seamless low-contrast surface grain, multiplied over the vertex colours so
  // the turf keeps detail underfoot without a visible tile (every blob is drawn
  // nine times, wrapped, so the 256 px tile edge matches itself). Build-time
  // canvas with a fixed-literal LCG — deterministic, no world position, no
  // Math.random (same idiom as bakeTarmac below).
  function bakeGrain(seed, blobs, specks, darkA, liteA) {
    let cv = null;
    try { cv = document.createElement("canvas"); } catch (e) { return null; }
    if (!cv || !cv.getContext) return null;
    const S = 256; cv.width = S; cv.height = S;
    const g = cv.getContext("2d"); if (!g) return null;
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, S, S);
    let s = (seed | 0) & 0x7fffffff || 0x2f6e2b1;
    const rnd = function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    for (let i = 0; i < blobs; i++) {
      const bx = rnd() * S, by = rnd() * S, r = 2.5 + rnd() * 11;
      g.fillStyle = rnd() < 0.55 ? "rgba(24,30,18," + darkA + ")" : "rgba(255,255,246," + liteA + ")";
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        g.beginPath(); g.arc(bx + ox * S, by + oy * S, r, 0, Math.PI * 2); g.fill();
      }
    }
    for (let i = 0; i < specks; i++) {                       // blade-scale detail
      const px = (rnd() * S) | 0, py = (rnd() * S) | 0;
      g.fillStyle = rnd() < 0.5 ? "rgba(20,26,16,0.075)" : "rgba(255,255,240,0.06)";
      g.fillRect(px, py, 1, 1 + ((rnd() * 2) | 0));
    }
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  }

  // seeded from CBZ.WORLD_SEED via the named-stream registry (core/seed.js)
  // — one world-seed knob instead of a per-file magic literal. rng() is
  // re-armed at build entry so a rebuild replays the identical stream.
  let rng = null;
  function armRng() { rng = CBZ.seedStream ? CBZ.seedStream('expansion') : (function () { let s = 60601; return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })(); }
  armRng();

  let annexCarHook = null, _trafWrapped = false;
  // the island's parking refills right after every traffic respawn —
  // spawnCityTraffic clears cityCars at the start of each run, which used to
  // leave the island carless (and is why it had its own prop cars at all)
  function wrapTraffic() {
    if (_trafWrapped || !CBZ.spawnCityTraffic) return;
    _trafWrapped = true;
    const orig = CBZ.spawnCityTraffic;
    CBZ.spawnCityTraffic = function (n) { const r = orig(n); if (annexCarHook) try { annexCarHook(); } catch (e) {} return r; };
  }
  CBZ.cityExpansion = function (city) {
    wrapTraffic();
    if (city.annex) return city.annex;
    const build = CBZ.cityMakeBuilding;
    if (!build) return null;
    armRng();

    const root = city.root;
    const R = 120, ROADW = 7, GRID = 40;
    const cx = city.maxX + 215, cz = city.center.z;
    const lots = [], placed = [], roadSegs = [];

    function plane(x, z, w, d, color, y, basic) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
        basic ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshLambertMaterial({ color }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, y == null ? 0.03 : y, z);
      m.receiveShadow = !basic;
      root.add(m);
      return m;
    }

    function box(x, y, z, w, h, d, color, opts) {
      opts = opts || {};
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts.emissive ? { emissive: opts.emissive, ei: opts.ei || 0.4 } : null));
      m.position.set(x, y, z);
      m.castShadow = opts.cast !== false; m.receiveShadow = opts.receive !== false;
      root.add(m);
      if (opts.solid) {
        const col = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, ref: m };
        if (opts.y0 != null) col.y0 = opts.y0;
        if (opts.y1 != null) col.y1 = opts.y1;
        if (opts.noCam) col.noCam = true;
        CBZ.colliders.push(col);
      }
      return m;
    }

    function tag(group, text, y, scale) {
      if (!CBZ.makeLabelSprite) return;
      const s = CBZ.makeLabelSprite(text);
      if (!s) return;
      s.position.set(0, y, 0); s.scale.set(scale || 6, (scale || 6) * 0.24, 1);
      group.add(s);
    }

    function addPlaced(x, z, w, d) {
      const p = { x, z, w, d };
      placed.push(p);
      return p;
    }

    function clashes(x, z, w, d, pad) {
      pad = pad == null ? 4 : pad;
      for (const p of placed) {
        if (Math.abs(p.x - x) < (p.w + w) / 2 + pad && Math.abs(p.z - z) < (p.d + d) / 2 + pad) return true;
      }
      return false;
    }

    function registerBuilding(x, z, w, d, storeys, color, name, kind) {
      const b = build(root, x, z, w, d, storeys, color, 0);
      const door = { x, z: z - d / 2 + 1.6, nx: 0, nz: 1 };
      const lot = { cx: x, cz: z, w, d, kind: kind || "tower", district: "island", building: { ...b, name: name || "Island Building", door } };
      lots.push(lot);
      addPlaced(x, z, w, d);
      // ROOMS WORTH ENTERING: the mainland pass dresses every interior, but
      // these shells were registered bare. EVERY storey gets the shared
      // apartment dresser (stair strip + door aisle stay clear via the
      // building's own clearFloorPoint; opaque boxes → batch-merged), so the
      // landmark towers and low-rises are worth climbing, not just facades.
      if (CBZ.cityFurnishApartment) {
        const fh = b.FH || 4;
        for (let k = 0; k < storeys; k++) CBZ.cityFurnishApartment(b, k * fh, (((x | 0) + (z | 0)) >> 2) + k);
      }
      return { b, lot };
    }

    // ---- island and the bridge from the original city's east-wall gate ----
    // The world owns one coast-to-horizon ocean mesh. The old island-local flat
    // disk sat above its waves and produced a visibly different second kind of
    // water, so no local ocean geometry is created here.
    // Sand is an annulus, not a larger full disc hidden under the grass. The
    // old pair overlapped across the whole island and depth-flickered from air.
    // ---- THE ISLAND SURFACE (ANNEX_GROUND_V2) ---------------------------
    // Both discs are RingGeometry with REAL radial subdivision, because a
    // CircleGeometry is a triangle FAN: 1 centre vertex + a rim, i.e. nowhere
    // to put land cover. The ring grid (129 x 27 on the turf) gives ~4.5 m
    // radial / ~5.9 m circumferential vertex spacing, which is finer than any
    // feature in the fields below, so the colour reads as continuous ground
    // rather than as cells. Still one draw call each.
    const V2G = CFG.ANNEX_GROUND_V2 !== false;
    // turf palette — the continent's own family (city/continent.js cGrass /
    // cScrub / cDry / cDirt), so the island stops reading as a different
    // planet's grass from the country across the water.
    const C_LUSH = new THREE.Color(0x4c7842), C_TURF = new THREE.Color(0x5b8a48);
    const C_DRY = new THREE.Color(0x86904f), C_SCRUB = new THREE.Color(0x456a3f);
    const C_DIRT = new THREE.Color(0x6f6244), C_SAND = new THREE.Color(0xdcc794);
    const C_WETSAND = new THREE.Color(0xb49f74);

    let beach;
    if (V2G) {
      const bgeo = new THREE.RingGeometry(R, R + 14, 128, 4);
      bgeo.rotateX(-Math.PI / 2);
      const bpos = bgeo.attributes.position, bcol = new Float32Array(bpos.count * 3);
      const bc = new THREE.Color();
      for (let i = 0; i < bpos.count; i++) {
        const lx = bpos.getX(i), lz = bpos.getZ(i);
        const wx = lx + cx, wz = lz + cz;
        // 0 at the grass edge, 1 at the water — sand darkens as it wets
        const t = Math.min(1, Math.max(0, (Math.hypot(lx, lz) - R) / 14));
        bc.copy(C_SAND).lerp(C_WETSAND, sm01(t * 1.18));
        // drift + wrack line so the annulus is not one flat swatch
        const dr = gnoise(wx, wz, 34, 0x51a1) - 0.5;
        bc.offsetHSL(0, 0, dr * 0.055);
        bc.lerp(C_DIRT, Math.max(0, gnoise(wx, wz, 11, 0x51a2) - 0.72) * 0.5);
        bcol[i * 3] = bc.r; bcol[i * 3 + 1] = bc.g; bcol[i * 3 + 2] = bc.b;
      }
      bgeo.setAttribute("color", new THREE.BufferAttribute(bcol, 3));
      const sandGrain = bakeGrain(0x7ab31d, 520, 1500, "0.05", "0.045");
      if (sandGrain) sandGrain.repeat.set(30, 30);
      beach = new THREE.Mesh(bgeo, new THREE.MeshLambertMaterial({ vertexColors: true, map: sandGrain || null }));
      beach.position.set(cx, 0, cz);
    } else {
      beach = new THREE.Mesh(new THREE.RingGeometry(R, R + 14, 64), new THREE.MeshLambertMaterial({ color: 0xe6d49a }));
      beach.rotation.x = -Math.PI / 2; beach.position.set(cx, 0, cz);
    }
    beach.receiveShadow = true;
    beach.userData.terrain = true; beach.userData.worldSurface = true; beach.name = "annex-beach-surface";
    root.add(beach);

    let island;
    if (V2G) {
      const igeo = new THREE.RingGeometry(0.02, R, 128, 26);
      igeo.rotateX(-Math.PI / 2);
      const ipos = igeo.attributes.position, icol = new Float32Array(ipos.count * 3);
      const ic = new THREE.Color();
      for (let i = 0; i < ipos.count; i++) {
        const lx = ipos.getX(i), lz = ipos.getZ(i);
        const wx = lx + cx, wz = lz + cz;
        // THREE SMOOTH FIELDS, no cell hash: a 74 m land-use mosaic (mown park
        // vs rougher scrub), a 26 m dryness variation and a low-contrast 9 m
        // break. Every one is interpolated between its lattice corners, which
        // is the whole difference between land cover and a chequer.
        const use = gnoise(wx + 310, wz - 140, 74, 0x51b0);
        const veg = gnoise(wx - 90, wz + 260, 26, 0x51b1);
        const fine = gnoise(wx + 40, wz + 40, 9, 0x51b2);
        ic.copy(C_TURF).lerp(C_SCRUB, sm01((use - 0.36) / 0.34));
        ic.lerp(C_LUSH, sm01((0.44 - use) / 0.30) * 0.75);
        ic.lerp(C_DRY, sm01((veg - 0.62) / 0.30) * 0.72);
        ic.lerp(C_DIRT, sm01((fine - 0.78) / 0.16) * 0.30);   // worn patches
        // island-wide hue drift so 240 m of turf is not one repeated swatch
        const drift = gnoise(wx, wz, 155, 0x51b3) - 0.5;
        ic.offsetHSL(0, drift * 0.05, drift * 0.045);
        // …and the last few metres blend into the beach, so the grass/sand join
        // is a shoreline instead of a hard circle.
        const rim = Math.min(1, Math.max(0, (Math.hypot(lx, lz) - (R - 9)) / 9));
        if (rim > 0) ic.lerp(C_SAND, sm01(rim) * 0.9);
        icol[i * 3] = ic.r; icol[i * 3 + 1] = ic.g; icol[i * 3 + 2] = ic.b;
      }
      igeo.setAttribute("color", new THREE.BufferAttribute(icol, 3));
      const turfGrain = bakeGrain(0x51ee2d, 900, 2600, "0.06", "0.045");
      if (turfGrain) turfGrain.repeat.set(46, 46);   // ~5 m per tile, invisible at this contrast
      island = new THREE.Mesh(igeo, new THREE.MeshLambertMaterial({ vertexColors: true, map: turfGrain || null }));
      island.position.set(cx, 0, cz);
    } else {
      const grassTex = CBZ.checkerTex(CBZ.COL.GRASS_A, CBZ.COL.GRASS_B, 2); grassTex.repeat.set(28, 28);
      island = new THREE.Mesh(new THREE.CircleGeometry(R, 64), new THREE.MeshLambertMaterial({ map: grassTex }));
      island.rotation.x = -Math.PI / 2; island.position.set(cx, 0, cz);
    }
    island.receiveShadow = true;
    island.userData.terrain = true; island.userData.worldSurface = true; island.name = "annex-island-surface";
    root.add(island);

    const bridgeStart = city.xLines[city.xLines.length - 1] - 2;
    const bridgeEnd = cx - R + 12;
    const bridgeLen = bridgeEnd - bridgeStart;
    const bridgeX = (bridgeStart + bridgeEnd) / 2;
    // ---- INTENTIONAL CABLE-STAYED BRIDGE (replaces the old blank gray slab
    //      walls). One coherent style: a structural concrete deck with curbs,
    //      see-through steel railings (posts + twin top rails), two tapered
    //      pylons straddling the deck near the 1/3 / 2/3 spans, and fan cables
    //      sweeping from each pylon top to the deck. The visible railing is
    //      open so you see the water through it; behind it a single thin,
    //      continuous SOLID curb collider per side runs the whole span as the
    //      fall-guard (no gap a car can slip through). All boxes are periodic,
    //      not per-meter, so the draw-call cost stays in the low tens. ----
    const SIDE = 8.7;                 // deck-edge / barrier centre on Z
    // colour buckets reused across all elements (keeps Lambert count low)
    const C_DECK = 0x8d939c, C_CURB = 0x707782, C_RAIL = 0x9aa3ad, C_PYLON = 0xb9c0c8, C_CABLE = 0xd9dde2;
    // deck base (slightly proud, with a structural fascia look) + road surface + centre dashes.
    // PAINTED, NOT GEOMETRY (floating-yellow-line fix): the old deck/road were
    // untextured Lambert planes and every dash was its OWN MeshBasicMaterial
    // plane — core/batch.js folded them into DIFFERENT per-tile colour buckets
    // (Lambert vs Basic), and core/farcull.js then hid each merged bucket by
    // its own bounding sphere, so the dashes and the deck popped in/out OUT OF
    // SYNC = a yellow line floating over open water. Now both surfaces carry a
    // tiling grain texture (textured materials are batch-EXEMPT, same as every
    // other road surface — see mergeableKeyV2), and ALL dashes merge into ONE
    // full-span geometry (userData keeps it live) whose cull sphere matches the
    // deck's — the paint and the deck can never cull apart again.
    function bakeTarmac(hex) {
      let cv = null;
      try { cv = document.createElement("canvas"); } catch (e) { return null; }
      if (!cv || !cv.getContext) return null;
      const S = 64; cv.width = S; cv.height = S;
      const g = cv.getContext("2d"); if (!g) return null;
      g.fillStyle = hex; g.fillRect(0, 0, S, S);
      // deterministic string-seeded LCG grain (build-time code — no Math.random)
      let s = 0;
      for (let i = 0; i < hex.length; i++) s = (s * 31 + hex.charCodeAt(i)) | 0;
      s = (s ^ 0x9e3779b9) & 0x7fffffff || 0x2f6e2b1;
      const rnd = function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
      for (let i = 0; i < 800; i++) {
        const lvl = (rnd() - 0.5) * 0.12;
        g.fillStyle = (lvl >= 0 ? "rgba(255,255,255," : "rgba(0,0,0,") + Math.abs(lvl).toFixed(3) + ")";
        g.fillRect((rnd() * S) | 0, (rnd() * S) | 0, 1, 1);
      }
      const tex = new THREE.CanvasTexture(cv);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 4;
      return tex;
    }
    function deckPlane(w, d, hex, fallbackColor, y) {
      const tex = bakeTarmac(hex);
      let mtl;
      if (tex) { tex.repeat.set(w / 8, d / 8); mtl = new THREE.MeshLambertMaterial({ map: tex }); }
      else mtl = new THREE.MeshLambertMaterial({ color: fallbackColor });   // no-canvas stub — colour fallback
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mtl);
      p.rotation.x = -Math.PI / 2; p.position.set(bridgeX, y, cz);
      p.receiveShadow = true; root.add(p);
      return p;
    }
    deckPlane(bridgeLen, 18, "#8d939c", C_DECK, 0.025);
    deckPlane(bridgeLen, ROADW, "#33363d", 0x33363d, 0.055);
    {
      // same dash cadence/footprint as the old per-plane loop (centres at x,
      // 2.8×0.28), accumulated into one BufferGeometry; y sits paint-thin over
      // the road (0.015) with a polygonOffset decal material doing the real
      // depth separation — paint, not hovering geometry.
      const dashPos = [], dashY = 0.07, hw = 0.14;
      for (let x = bridgeStart + 3; x < bridgeEnd; x += 7) {
        const x0 = x - 1.4, x1 = x + 1.4;
        dashPos.push(
          x0, dashY, cz - hw, x0, dashY, cz + hw, x1, dashY, cz + hw,
          x0, dashY, cz - hw, x1, dashY, cz + hw, x1, dashY, cz - hw);
      }
      const dg = new THREE.BufferGeometry();
      dg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(dashPos), 3));
      const dash = new THREE.Mesh(dg, new THREE.MeshBasicMaterial({
        color: 0xf2d14a, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      dash.matrixAutoUpdate = false; dash.renderOrder = 1;
      dash.userData.roadPaint = true;   // batch-exempt: keeps its decal material + culls as one full span
      root.add(dash);
    }

    // continuous SOLID fall-guard curb, one per side (low + thin, part of the
    // railing base). noCam so the chase camera doesn't clip on it. This is the
    // ONLY barrier collider — the posts/rails/cables below are all decorative.
    box(bridgeX, 0.45, cz - SIDE, bridgeLen, 0.9, 0.3, C_CURB, { solid: true, noCam: true });
    box(bridgeX, 0.45, cz + SIDE, bridgeLen, 0.9, 0.3, C_CURB, { solid: true, noCam: true });

    // see-through railings: vertical posts every ~5m + twin horizontal top rails.
    for (const sz of [cz - SIDE, cz + SIDE]) {
      for (let x = bridgeStart + 2.5; x <= bridgeEnd - 2.5; x += 5) {
        box(x, 1.0, sz, 0.16, 1.4, 0.16, C_RAIL, { cast: false });        // post (non-solid; curb holds the line)
      }
      box(bridgeX, 1.55, sz, bridgeLen, 0.1, 0.1, C_RAIL, { cast: false }); // upper rail
      box(bridgeX, 1.1, sz, bridgeLen, 0.08, 0.08, C_RAIL, { cast: false }); // mid rail
    }

    // two cable-stayed pylons + fan cables. Pylons straddle the deck (a leg on
    // each side joined by a cross-beam over the road); cables sweep from the
    // tower top down to deck anchor points fore and aft.
    const PYH = 19;                                   // pylon height above deck
    for (const px of [bridgeStart + bridgeLen * 0.30, bridgeStart + bridgeLen * 0.70]) {
      for (const sz of [cz - SIDE, cz + SIDE]) {
        box(px, PYH / 2, sz, 1.1, PYH, 1.1, C_PYLON, { solid: true, noCam: true }); // tapered leg (also a soft pier collider)
      }
      box(px, PYH + 0.4, cz, 1.0, 1.0, SIDE * 2 + 1.2, C_PYLON, { cast: false });    // cross-beam over the road
      // fan cables: from each tower-top corner to staggered deck anchors fore & aft
      for (const sz of [cz - SIDE, cz + SIDE]) {
        for (const dir of [-1, 1]) {
          for (let k = 1; k <= 3; k++) {
            const ax = px + dir * (4 + k * 5);          // deck anchor along the span
            const dx = ax - px, dy = PYH, midx = (px + ax) / 2;
            const len = Math.hypot(dx, dy);
            const cab = box(midx, PYH / 2 + 0.6, sz, 0.07, len, 0.07, C_CABLE, { cast: false });
            cab.rotation.z = Math.atan2(dx, dy);        // tilt the cable from vertical toward the anchor
          }
        }
      }
    }

    // span end portals — slim gateway frames where the bridge meets land, so
    // the entrance reads as a deliberate threshold rather than an open seam.
    for (const ex of [bridgeStart + 1.5, bridgeEnd - 1.5]) {
      box(ex, 2.6, cz - SIDE, 0.6, 5.2, 0.6, C_PYLON, { cast: false });
      box(ex, 2.6, cz + SIDE, 0.6, 5.2, 0.6, C_PYLON, { cast: false });
      box(ex, 5.0, cz, 0.6, 0.6, SIDE * 2 + 0.6, C_PYLON, { cast: false });
    }

    // the deck barriers run the full span; AABB matches the curb edges (cz±SIDE)
    city.bridge = { minX: bridgeStart - 2, maxX: bridgeEnd + 5, minZ: cz - (SIDE + 0.5), maxZ: cz + (SIDE + 0.5) };
    city.roads.push({ x: bridgeX, z: cz, vertical: false, len: bridgeLen, district: "bridge", w: ROADW, lanesPerDir: 1, laneW: 3.0 });

    // ---- landmark towers: every former mountain position becomes skyline ----
    const towers = [];
    function tower(x, z, w, d, storeys, color, name) {
      const rec = registerBuilding(x, z, w, d, storeys, color, name, "tower");
      towers.push(rec.lot);
      tag(rec.b.group, name, rec.b.h + 2.2, storeys > 10 ? 8 : 6);
      // rooftop beacon makes the tower readable from the mainland.
      rec.b.lbox(0, rec.b.h + 1.0, 0, 0.45, 2.0, 0.45, 0xff5b5b, { emissive: 0xff3b3b, ei: 0.8, cast: false });
      return rec;
    }

    tower(cx - 13, cz, 19, 20, 38, 0x667991, "TWIN TOWER WEST");
    tower(cx + 13, cz, 19, 20, 32, 0x71849d, "TWIN TOWER EAST");
    tower(cx - 52, cz - 30, 14, 15, 8, 0x596b82, "NORTHWEST TOWER");
    tower(cx + 48, cz + 40, 15, 15, 9, 0x7a6f8c, "SOUTHEAST TOWER");
    tower(cx + 40, cz - 48, 14, 14, 7, 0x5e7d86, "NORTHEAST TOWER");

    // ---- service station and showroom, copied from the disaster-town mix ----
    function gasStation(x, z) {
      addPlaced(x, z, 20, 15);
      lots.push({ cx: x, cz: z, w: 20, d: 15, kind: "gas", district: "island", building: { name: "Island Gas" } });
      plane(x, z, 20, 15, 0x41464d, 0.045);
      const CH = 5.2;
      [[-6, -3.5], [6, -3.5], [-6, 3.5], [6, 3.5]].forEach(([px, pz]) => box(x + px, CH / 2, z + pz, 0.55, CH, 0.55, 0xeef1f4, { solid: true }));
      box(x, CH + 0.45, z, 14.5, 0.9, 9.5, 0xfbfcfe, { solid: true, y0: CH, y1: CH + 0.9 });
      for (let i = -1; i <= 1; i++) box(x + i * 4, 0.8, z, 0.8, 1.6, 0.7, 0xff7a1a, { solid: true });
      box(x - 9.5, 2.4, z - 5.5, 0.5, 4.8, 0.5, 0x6a7079, { solid: true });
      box(x - 9.5, 4.6, z - 5.5, 2.2, 1.6, 0.3, 0xffd451);
      // THE KIOSK along the back of the pad: a grab-and-go counter, two
      // stocked snack racks and a lit drinks cooler — the stop is a real
      // business you walk through, not just pumps under a roof.
      box(x - 6.2, 0.55, z + 5.4, 2.6, 1.1, 0.9, 0x55606e, { solid: true });           // counter
      box(x - 6.2, 1.14, z + 5.4, 2.7, 0.08, 1.0, 0xe6e8ee, { cast: false });          // worktop
      for (const off of [-2.4, 0.4]) {
        // SOLID: the kiosk has NO WALLS — counter, racks and cooler stand on
        // the open forecourt slab, so nothing else covers their footprint. The
        // counter beside them was already solid; these two 1.4 m racks and the
        // 2.0 m cooler below were not, on the same floor, in the same room.
        box(x + off, 0.7, z + 5.6, 1.7, 1.4, 0.6, 0x44505c, { cast: false, solid: true }); // rack body
        for (let i = 0; i < 4; i++)
          box(x + off - 0.55 + i * 0.38, 1.55, z + 5.6, 0.28, 0.3, 0.28,
            [0xff6b5a, 0x6bbf4a, 0xffc94a, 0x5a8aff][i], { cast: false });             // snack stock
      }
      box(x + 3.4, 1.0, z + 5.6, 1.2, 2.0, 0.8, 0x9fe0ff, { emissive: 0x9fe0ff, ei: 0.45, cast: false, solid: true });  // drinks cooler (2 m fridge)
    }

    // ISLAND CARS ARE REAL CARS (user-filmed: the old two-box props read as a
    // different, cheaper world — "why would the island have a different car
    // situation?"). Every spot is recorded and filled with a REAL vehicles.js
    // car — same unified visual as mainland traffic, enterable, stealable,
    // choppable. Spawn is deferred: spawnCityTraffic clears cityCars at the
    // start of every run, so the island re-fills right after it (see the wrap
    // below). No static colliders — a real car is solid through the car system
    // and must be free to drive away.
    const carSpots = [];
    function parkedCar(x, z, vertical, color, rare) {
      carSpots.push({ x, z, vertical, rare: !!rare });
    }
    function spawnAnnexCars() {
      if (!CBZ.cityMakeCar || !CBZ.city || !CBZ.city.arena) return;
      const econ = CBZ.cityEcon;
      for (const s of carSpots) {
        const heading = s.vertical ? (Math.random() < 0.5 ? 0 : Math.PI) : (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
        const model = econ && econ.pickCar ? econ.pickCar(s.rare || Math.random() < 0.12) : null;
        const c = CBZ.cityMakeCar(s.x, s.z, heading, s.vertical, model, 0.2);
        c.ai = false; c.v = 0; c.baseV = 0; c.road = null;   // parked until someone takes it
      }
    }
    annexCarHook = spawnAnnexCars;

    function showroom(x, z) {
      addPlaced(x, z, 18, 13);
      lots.push({ cx: x, cz: z, w: 18, d: 13, kind: "carlot", district: "island", building: { name: "Island Auto Showroom" } });
      plane(x, z, 18, 13, 0xd6dade, 0.055);
      box(x, 3, z + 6.3, 18, 6, 0.35, 0x586a86, { solid: true });
      box(x - 8.8, 3, z, 0.35, 6, 13, 0x586a86, { solid: true });
      box(x + 8.8, 3, z, 0.35, 6, 13, 0x586a86, { solid: true });
      box(x, 6.2, z, 18, 0.4, 13, 0x46566b, { solid: true, y0: 6, y1: 6.4 });
      box(x - 5.1, 3, z - 6.3, 0.5, 6, 0.35, 0x44506b, { solid: true });
      box(x + 5.1, 3, z - 6.3, 0.5, 6, 0.35, 0x44506b, { solid: true });
      box(x, 6.9, z - 6.3, 10, 1.2, 0.3, 0x12c258);
      // SALES FLOOR dressing: a manager's desk with a lit terminal by the
      // glass, tyre stacks + a parts shelf along the back wall, and a pale
      // display plinth under the feature car — a showroom you'd browse (and
      // a reason to believe the cars are FOR SALE, i.e. worth taking).
      box(x - 6.6, 0.5, z - 3.4, 2.0, 1.0, 0.9, 0x44505c, { solid: true });            // sales desk
      box(x - 6.6, 1.06, z - 3.4, 2.1, 0.08, 1.0, 0xe6e8ee, { cast: false });          // desktop
      box(x - 6.2, 1.4, z - 3.4, 0.5, 0.45, 0.08, 0x39d0c0, { emissive: 0x39d0c0, ei: 0.5, cast: false }); // terminal
      for (const off of [5.6, 7.2]) for (let i = 0; i < 3; i++)
        box(x + off, 0.26 + i * 0.45, z + 5.3, 0.9 - i * 0.12, 0.42, 0.9 - i * 0.12, 0x23262b, { cast: false }); // tyre stacks
      box(x - 7.4, 0.8, z + 5.4, 2.2, 1.6, 0.7, 0x3a352e, { cast: false, solid: true }); // parts shelf (1.6 m, open showroom floor)
      box(x, 0.1, z + 4.2, 5.2, 0.2, 3.0, 0xc8ccd4, { cast: false });                  // feature-car plinth
      // A FULL SALES FLOOR: a grid of display cars on pale plinths so the empty
      // middle reads as inventory you'd browse (not three lonely cars). Real,
      // stealable cars (parkedCar) + a name/price placard on each plinth.
      const showSpots = [
        { dx: -4.6, dz: 1.6, vert: true,  c: 0xe24b4b },
        { dx:  4.6, dz: 1.6, vert: true,  c: 0x3c6fd6 },
        { dx:  0.0, dz: 4.2, vert: false, c: 0xf2c43d },
        { dx: -4.6, dz: -3.2, vert: true, c: 0x202225 },
        { dx:  4.6, dz: -3.2, vert: true, c: 0xa8afb2 },
        { dx:  0.0, dz: -1.0, vert: false, c: 0xf28c28 },
      ];
      const cars = (CBZ.cityEcon && Array.isArray(CBZ.cityEcon.CARS)) ? CBZ.cityEcon.CARS : null;
      showSpots.forEach((s, i) => {
        box(x + s.dx, 0.08, z + s.dz, s.vert ? 2.6 : 5.0, 0.16, s.vert ? 5.0 : 2.6, 0xc8ccd4, { cast: false });  // plinth
        parkedCar(x + s.dx, z + s.dz, s.vert, s.c, true);
        if (CBZ.makeLabelSprite && cars) {
          try {
            const m = cars[(i * 4 + 8) % cars.length];   // spread across the catalog
            const s2 = CBZ.makeLabelSprite(m.name + "  $" + (m.value || 0).toLocaleString(), { color: "#ffd166" });
            if (s2) { s2.position.set(x + s.dx, 1.4, z + s.dz - (s.vert ? 2.7 : 1.5)); root.add(s2); }
          } catch (e) {}
        }
      });
    }

    gasStation(cx - 78, cz + 74);
    showroom(cx + 72, cz - 76);

    // ---- enterable low-rise town around the former terrain peaks ----
    const PALETTE = [0xff7a6b, 0x6bb6ff, 0xffd166, 0x9ad17a, 0xc792ea, 0xff9e6b, 0x66d9c0, 0xf06b9b];
    function nearRoad(x, z, w, d) {
      for (let k = -2; k <= 2; k++) {
        if (Math.abs(x - (cx + k * GRID)) < w / 2 + ROADW / 2 + 1.2) return true;
        if (Math.abs(z - (cz + k * GRID)) < d / 2 + ROADW / 2 + 1.2) return true;
      }
      return false;
    }
    // METHOD (PROCGEN.md #1): no rejection sampling. The legal spots are
    // known by construction — the cell interiors between the island's road
    // lines, inside the buildable annulus. Enumerate them, shuffle
    // deterministically, take the first 15. The old loop threw up to 900
    // random polar darts against an O(n) clash scan to land the same count.
    const slots = [];
    for (let gi = -3; gi <= 2; gi++) for (let gj = -3; gj <= 2; gj++) {
      const sx = cx + (gi + 0.5) * GRID, sz = cz + (gj + 0.5) * GRID;
      const dc = Math.hypot(sx - cx, sz - cz);
      if (dc < 40 || dc > R - 28) continue;              // keep the ring read
      slots.push({ x: sx, z: sz });
    }
    for (let i = slots.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = slots[i]; slots[i] = slots[j]; slots[j] = t; }
    let made = 0;
    for (const sl of slots) {
      if (made >= 15) break;
      const w = 8 + rng() * 4.5, d = 8 + rng() * 4.5;
      // jitter inside the cell, clear of the road margins by construction
      const play = Math.max(0, (GRID - ROADW) / 2 - Math.max(w, d) / 2 - 1.4);
      const x = sl.x + (rng() - 0.5) * 2 * play;
      const z = sl.z + (rng() - 0.5) * 2 * play;
      if (clashes(x, z, w, d, 4)) continue;              // hand-placed anchors only
      const storeys = 1 + ((rng() * 3) | 0);
      const rec = registerBuilding(x, z, w, d, storeys, PALETTE[(rng() * PALETTE.length) | 0], "Island Apartments", "tower");
      if (rng() < 0.22) tag(rec.b.group, "ISLAND BLOCK", rec.b.h + 1.5, 4.5);
      made++;
    }

    // ---- copied island street grid, clipped around the replacement towers ----
    // wet-road tie-in (feature-detected, load-order safe): one shared
    // CBZ.roadMat() instance reused for every segment plane below (same
    // sharing pattern as the flat Lambert it replaces), kept damp-looking by
    // materials.js as CBZ.weather.intensity rises. Falls back to the plain
    // Lambert if materials.js hasn't loaded yet.
    // ANNEX_STREETS_V2: the island streets get the SAME baked tarmac grain the
    // bridge deck in this very file already had (bakeTarmac), on world-scaled
    // UVs so one shared material tiles at a constant metres-per-repeat across
    // segments of every length — the discipline city/world.js's quadField uses
    // downtown. The old path handed roadMat NO map at all, which is why the
    // island read as flat painted cardboard next to its own textured bridge.
    const V2S = CFG.ANNEX_STREETS_V2 !== false;
    const streetTex = V2S ? bakeTarmac("#33363d") : null;
    const kerbTex = V2S ? bakeTarmac("#8d939c") : null;
    if (streetTex) streetTex.repeat.set(1, 1);       // UVs already carry the world scale
    if (kerbTex) kerbTex.repeat.set(1, 1);
    const roadMat = CBZ.roadMat
      ? CBZ.roadMat(streetTex ? { color: 0xffffff, map: streetTex, detailRepeat: 1 } : { color: 0x33363d })
      : new THREE.MeshLambertMaterial(streetTex ? { map: streetTex } : { color: 0x33363d });
    const kerbMat = CBZ.roadMat
      ? CBZ.roadMat(kerbTex ? { color: 0xffffff, map: kerbTex, detailRepeat: 1 } : { color: 0x8d939c })
      : new THREE.MeshLambertMaterial(kerbTex ? { map: kerbTex } : { color: 0x8d939c });
    // ONE merged surface for the whole island network (was ~40 planes + 25
    // junction squares). Quads are pushed here and built into three meshes
    // after the grid is laid — see the note at the build site.
    const SURF_UV = 6;                       // metres per texture repeat
    const rdP = [], rdN = [], rdU = [];      // asphalt
    const kbP = [], kbN = [], kbU = [];      // concrete shoulder
    const dashAll = [];                      // every centre dash, one mesh
    function surfQuad(P, N, U, x0, x1, z0, z1, y) {
      const uw = (x1 - x0) / SURF_UV, uh = (z1 - z0) / SURF_UV;
      P.push(x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0);
      for (let i = 0; i < 6; i++) N.push(0, 1, 0);
      U.push(0, uh, 0, 0, uw, 0, 0, uh, uw, 0, uw, uh);
    }
    function surfMesh(P, N, U, material, name) {
      if (!P.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(P), 3));
      g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(N), 3));
      g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(U), 2));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, material);
      m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix();
      m.name = name;
      m.userData.islandSurface = true;   // non-empty userData: batch.js spares it
      root.add(m);
      return m;
    }
    // road-paint decal material: polygonOffset (not y-lift) does the depth
    // separation, so the dashes read as paint on the asphalt (shared by every
    // merged per-segment dash mesh below).
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xf2d14a, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    function blocked(x, z) {
      for (const p of placed) {
        if (Math.abs(p.x - x) < p.w / 2 + ROADW / 2 + 0.8 && Math.abs(p.z - z) < p.d / 2 + ROADW / 2 + 0.8) return true;
      }
      return false;
    }
    function nearDoor(x, z, radius) {
      const r2 = radius * radius;
      for (const lot of lots) {
        const d = lot.building && lot.building.door;
        if (!d) continue;
        const ex = d.x - d.nx * 4.8, ez = d.z - d.nz * 4.8;
        const vx = ex - d.x, vz = ez - d.z, wx = x - d.x, wz = z - d.z;
        const den = vx * vx + vz * vz || 1;
        const t = Math.max(0, Math.min(1, (wx * vx + wz * vz) / den));
        const dx = x - (d.x + vx * t), dz = z - (d.z + vz * t);
        if (dx * dx + dz * dz < r2) return true;
      }
      return false;
    }
    function layRoadLine(fixed, vertical) {
      const step = 4, segs = [];
      let start = null;
      for (let t = -R; t <= R + step; t += step) {
        const x = vertical ? fixed : cx + t, z = vertical ? cz + t : fixed;
        const ok = Math.hypot(x - cx, z - cz) < R - 5 && !blocked(x, z);
        if (ok && start === null) start = t;
        if ((!ok || t > R) && start !== null) {
          const end = ok ? t : t - step;
          if (end - start >= step * 2) segs.push([start, end]);
          start = null;
        }
      }
      for (const [a, b] of segs) {
        const mid = (a + b) / 2, len = b - a;
        const x = vertical ? fixed : cx + mid, z = vertical ? cz + mid : fixed;
        if (V2S) {
          // THE TWO AXES SIT 2 mm APART. Every crossing used to lay two road
          // planes at exactly y=0.05 — coplanar, so they z-fight — and the
          // 25 junction squares existed only to hide that, in a DIFFERENT tone
          // (0x2e3138 vs 0x33363d) one centimetre proud. Both problems die
          // here: separate the axes and the junction needs no patch at all.
          const rY = vertical ? 0.050 : 0.052, kY = vertical ? 0.042 : 0.044;
          const hw = ROADW / 2, KERB = 1.2;      // shoulder clears the closest possible building by 0.2 m
          if (vertical) {
            surfQuad(kbP, kbN, kbU, x - hw - KERB, x - hw, z - len / 2, z + len / 2, kY);
            surfQuad(kbP, kbN, kbU, x + hw, x + hw + KERB, z - len / 2, z + len / 2, kY);
            surfQuad(rdP, rdN, rdU, x - hw, x + hw, z - len / 2, z + len / 2, rY);
          } else {
            surfQuad(kbP, kbN, kbU, x - len / 2, x + len / 2, z - hw - KERB, z - hw, kY);
            surfQuad(kbP, kbN, kbU, x - len / 2, x + len / 2, z + hw, z + hw + KERB, kY);
            surfQuad(rdP, rdN, rdU, x - len / 2, x + len / 2, z - hw, z + hw, rY);
          }
        } else {
          const m = new THREE.Mesh(new THREE.PlaneGeometry(vertical ? ROADW : len, vertical ? len : ROADW), roadMat);
          m.rotation.x = -Math.PI / 2; m.position.set(x, 0.05, z); m.receiveShadow = true; root.add(m);
        }
        // Centre dashes accumulate into ONE island-wide mesh. They used to be
        // merged per SEGMENT so each dash mesh's cull sphere matched its own
        // road plane's (out-of-sync culling is what made the bridge's yellow
        // line float over open water). The road is now ONE mesh, so the paint
        // has to be one mesh too — same rule, followed to its conclusion.
        const dashes = Math.max(1, Math.floor(len / 6));
        const dashPos = V2S ? dashAll : [];
        const dashY = 0.065;   // paint-thin over the 0.05 road; polygonOffset does the rest
        for (let i = 0; i < dashes; i++) {
          const tt = a + (i + 0.5) * (len / dashes);
          const lx = vertical ? fixed : cx + tt, lz = vertical ? cz + tt : fixed;
          const hx = vertical ? 0.15 : 1.2, hz = vertical ? 1.2 : 0.15;   // the old 0.3×2.4 dash footprint
          dashPos.push(
            lx - hx, dashY, lz - hz, lx - hx, dashY, lz + hz, lx + hx, dashY, lz + hz,
            lx - hx, dashY, lz - hz, lx + hx, dashY, lz + hz, lx + hx, dashY, lz - hz);
        }
        if (!V2S && dashPos.length) {
          const dg = new THREE.BufferGeometry();
          dg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(dashPos), 3));
          const dmesh = new THREE.Mesh(dg, lineMat);
          dmesh.matrixAutoUpdate = false; dmesh.renderOrder = 1;
          dmesh.userData.roadPaint = true;
          root.add(dmesh);
        }
        const seg = { x, z, len, vertical, district: "island", w: ROADW, lanesPerDir: 1, laneW: 3.0 };
        roadSegs.push(seg); city.roads.push(seg);
      }
    }
    const islandXLines = [], islandZLines = [];
    for (let k = -2; k <= 2; k++) {
      islandXLines.push(cx + k * GRID); islandZLines.push(cz + k * GRID);
      layRoadLine(cx + k * GRID, true);
      layRoadLine(cz + k * GRID, false);
    }

    // THE THREE ISLAND SURFACE MESHES. Asphalt + concrete shoulder + paint, for
    // the whole network. Built here (after every line is laid) rather than per
    // segment, which is what collapses ~105 draw calls into 3.
    if (V2S) {
      surfMesh(kbP, kbN, kbU, kerbMat, "annex-street-shoulder");
      surfMesh(rdP, rdN, rdU, roadMat, "annex-street-surface");
      if (dashAll.length) {
        const dg = new THREE.BufferGeometry();
        dg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(dashAll), 3));
        dg.computeBoundingSphere();
        const dmesh = new THREE.Mesh(dg, lineMat);
        dmesh.matrixAutoUpdate = false; dmesh.updateMatrix(); dmesh.renderOrder = 1;
        dmesh.userData.roadPaint = true;   // batch-exempt: keeps the decal material
        root.add(dmesh);
      }
    }

    // Traffic lights and the radar use the same intersection records as downtown.
    // DELETED with ANNEX_STREETS_V2: the per-junction `plane(...0x2e3138, 0.06)`
    // patch. It was a different asphalt tone from the road it sat on, one
    // centimetre proud of it, and it only existed to cover the coplanar z-fight
    // that the 2 mm axis separation above now makes impossible. The RECORD stays
    // — that is what traffic lights and the radar read.
    for (const x of islandXLines) for (const z of islandZLines) {
      if (Math.hypot(x - cx, z - cz) >= R - 8 || blocked(x, z)) continue;
      if (!V2S) plane(x, z, ROADW, ROADW, 0x2e3138, 0.06);
      city.intersections.push({ x, z, i: -1, j: -1, phase: 0, t: rng() * 6, ns: true, light: null, district: "island" });
    }
    city.allXLines = city.xLines.concat(islandXLines);
    city.allZLines = city.zLines.concat(islandZLines);

    // ---- trees make the new district feel inhabited. INSTANCED (owner rule
    //      #4): the old island trees were per-tree box pairs (trunk box +
    //      foliage box) — dozens of separate meshes/draw calls and a flat slab
    //      look. They are now ONE tapered-trunk InstancedMesh + ONE stacked-
    //      cone crown InstancedMesh (2 draw calls for every island tree), with
    //      prettier shapes and per-instance scale/colour variation. A SPARSE
    //      set of colliders is kept (only the biggest few trunks) so the island
    //      still feels solid where you'd brush a trunk, without thousands of
    //      AABBs — matching the biome_forest discipline. ----------------------
    (function islandTrees() {
      const trees = [];
      for (let i = 0; i < 64; i++) {
        const a = rng() * Math.PI * 2, dist = 20 + rng() * (R - 24);
        const x = cx + Math.cos(a) * dist, z = cz + Math.sin(a) * dist;
        if (blocked(x, z) || nearRoad(x, z, 1, 1) || nearDoor(x, z, 2.7)) continue;
        const broad = rng() < 0.5;                 // mix conifers + round broadleaf
        const h = (broad ? 4.0 : 5.0) + rng() * 3.5;
        trees.push({
          x, z, h, broad,
          tr: 0.7 + rng() * 0.5,                   // trunk radius scale
          rot: rng() * 6.28,
          lean: (rng() - 0.5) * 0.05,
          cR: broad ? h * (0.40 + rng() * 0.16) : 0.85 + rng() * 0.5,
          cH: broad ? h * (0.55 + rng() * 0.2) : h * (0.95 + rng() * 0.2),
          cY: broad ? h * (0.7 + rng() * 0.1) : h * 0.5,
        });
      }
      const N = trees.length;
      if (!N) return;

      // unit geometries (base at y=0 so per-instance Y-scale grows upward)
      // ONE TREE GRAMMAR (world/treeaudit.js §2) + roots baked into the bole.
      const GRAM = !!(CBZ.CONFIG && CBZ.CONFIG.TREES_ONE_GRAMMAR !== false && CBZ.treeCrownGeo);
      const trunkGeo = (CBZ.treeTrunkGeo
        ? CBZ.treeTrunkGeo({ rTop: 0.18, rBase: 0.36, h: 1, seg: 5, roots: 3, spread: 2.3, site: "island" })
        : (function () { const g = new THREE.CylinderGeometry(0.18, 0.36, 1, 5); g.translate(0, 0.5, 0); return g; })());
      // THE OLD COMMENT HERE WAS AN APOLOGY, AND IT IS WORTH KEEPING AS A
      // RECORD: "we render conifers' crowns by reusing the icosahedron
      // stretched tall+narrow (reads as a rounded evergreen) — keeps it at 2
      // draw calls." It did not read as an evergreen; it read as an egg. The
      // real constraint was never the geo, it was the SHARED InstancedMesh —
      // both species ride one crown IM, so they must share one geometry.
      // A two-whorl cone stack solves that honestly: stretched tall and
      // narrow it IS a fir, squashed wide it IS a broadleaf, because a cone
      // stack survives anisotropic scaling and a ball does not. Same 2 draw
      // calls, same unit envelope (y[0,1.2], radius 0.6) so every placement
      // number below and the whole treeaudit chain are untouched.
      const crownGeo = GRAM
        ? CBZ.treeCrownGeo({ tiers: 2, r: 0.6, h: 1.2, seg: 6, taper: 0.68, site: "island", leaf: !!(CBZ.vegetationKit && CBZ.vegetationKit.customCrown) })
        : (function () {
            const g = new THREE.IcosahedronGeometry(0.6, 0);
            g.translate(0, 0.6, 0);
            if (CBZ.treeGrammarLegacy) CBZ.treeGrammarLegacy("island");
            return g;
          })();

      const LEAF = !!(crownGeo.userData && crownGeo.userData.leafCards);
      const trunkMat = LEAF ? CBZ.vegetationKit.material("wood") : (function () { const m = new THREE.MeshLambertMaterial({ color: 0xffffff }); m._shared = true; return m; })();
      const crownMat = LEAF ? CBZ.vegetationKit.material("foliage") : (function () { const m = new THREE.MeshLambertMaterial({ color: 0xffffff }); m._shared = true; return m; })();
      const trunkIM = new THREE.InstancedMesh(trunkGeo, trunkMat, N);
      const crownIM = new THREE.InstancedMesh(crownGeo, crownMat, N);
      trunkIM.castShadow = crownIM.castShadow = true;
      if (LEAF) crownIM.customDepthMaterial = CBZ.vegetationKit.depthMaterial("foliage");
      trunkIM.receiveShadow = crownIM.receiveShadow = true;
      trunkIM.frustumCulled = false; crownIM.frustumCulled = false;   // r128 instanced cull bug

      const dummy = new THREE.Object3D();
      const col = new THREE.Color();
      const tCol = new Float32Array(N * 3), cCol = new Float32Array(N * 3);
      // TREES_V2 (config.js): island trunks sat exactly ON y=0 — V2 sinks
      // the base 0.2 under the island floor (top of trunk unchanged) and
      // registers every tree with world/treeaudit.js. Crown math already
      // obeyed the overlap law at every jitter extreme — verified, untouched.
      const TREES2 = !!(CBZ.CONFIG && CBZ.CONFIG.TREES_V2 !== false && CBZ.treeRegisterTree);
      if (TREES2 && CBZ.treeAuditResetSite) CBZ.treeAuditResetSite("island");
      const tbb = TREES2 && CBZ.treeGeoBounds ? CBZ.treeGeoBounds(trunkGeo) : null;
      const cbb = TREES2 && CBZ.treeGeoBounds ? CBZ.treeGeoBounds(crownGeo) : null;
      for (let i = 0; i < N; i++) {
        const t = trees[i];
        // trunk
        dummy.position.set(t.x, TREES2 ? -0.2 : 0, t.z);
        dummy.rotation.set(t.lean, t.rot, t.lean * 0.5);
        dummy.scale.set(t.tr, TREES2 ? t.h + 0.2 : t.h, t.tr);
        dummy.updateMatrix(); trunkIM.setMatrixAt(i, dummy.matrix);
        let parts = null;
        if (TREES2 && tbb) {
          parts = [];
          CBZ.treeAabbPush(parts, dummy.matrix, tbb.min.x, tbb.min.y, tbb.min.z, tbb.max.x, tbb.max.y, tbb.max.z);
        }
        // crown (broadleaf = round; conifer = stretched tall+narrow)
        dummy.position.set(t.x, t.cY, t.z);
        dummy.rotation.set(t.lean, t.rot, t.lean * 0.5);
        if (t.broad) dummy.scale.set(t.cR, t.cH * 0.9, t.cR);
        else dummy.scale.set(t.cR, t.cH, t.cR * 0.92);
        dummy.updateMatrix(); crownIM.setMatrixAt(i, dummy.matrix);
        if (parts && cbb) {
          CBZ.treeAabbPush(parts, dummy.matrix, cbb.min.x, cbb.min.y, cbb.min.z, cbb.max.x, cbb.max.y, cbb.max.z);
          CBZ.treeRegisterTree("island", 0, parts);
        }
        // colours
        const s = 0.32 + rng() * 0.14; col.setRGB(s, s * 0.62, s * 0.36);    // bark
        tCol[i * 3] = col.r; tCol[i * 3 + 1] = col.g; tCol[i * 3 + 2] = col.b;
        if (t.broad) col.setRGB(0.24 + rng() * 0.16, 0.46 + rng() * 0.16, 0.18 + rng() * 0.08);
        else col.setRGB(0.10 + rng() * 0.08, 0.30 + rng() * 0.14, 0.14 + rng() * 0.07);
        cCol[i * 3] = col.r; cCol[i * 3 + 1] = col.g; cCol[i * 3 + 2] = col.b;
      }
      trunkIM.instanceColor = new THREE.InstancedBufferAttribute(tCol, 3);
      crownIM.instanceColor = new THREE.InstancedBufferAttribute(cCol, 3);
      trunkIM.instanceMatrix.needsUpdate = true;
      crownIM.instanceMatrix.needsUpdate = true;
      root.add(trunkIM); root.add(crownIM);

      // SPARSE colliders: only the biggest few trunks (the old code made every
      // tree a noCam solid box; thousands of AABBs aren't worth it, but a
      // handful keep the island feeling solid). Pick the tallest, cap at 14.
      const byH = trees.slice().sort((a, b) => b.h - a.h);
      for (let i = 0; i < byH.length && i < 14; i++) {
        const t = byH[i];
        const r = t.tr * 0.32 + 0.22;
        CBZ.colliders.push({ minX: t.x - r, maxX: t.x + r, minZ: t.z - r, maxZ: t.z + r, y0: 0, y1: t.h, noCam: true });
      }
    })();
    const CAR_COLORS = [0xe24b4b, 0x3c6fd6, 0xf2c43d, 0x4caf6e, 0xe8e8ee, 0x2a2d33, 0xe88a3c];
    for (let i = 0; i < roadSegs.length; i += 2) {
      const r = roadSegs[i], off = (rng() < 0.5 ? -1 : 1) * ROADW * 0.25, along = (rng() - 0.5) * r.len * 0.65;
      const x = r.x + (r.vertical ? off : along), z = r.z + (r.vertical ? along : off);
      if (!blocked(x, z)) parkedCar(x, z, r.vertical, CAR_COLORS[(rng() * CAR_COLORS.length) | 0], false);
    }

    const annex = {
      cx, cz, radius: R, lots, towers, roads: roadSegs,
      xLines: islandXLines, zLines: islandZLines,
      center: { x: cx, z: cz },
    };
    city.annex = annex;

    // ---- THE ANNEX IS A PLACE, AND NOTHING IN THE WORLD KNEW IT -----------
    // The commerce island has existed since the game had two landmasses and it
    // has NEVER been in `city.regions`. Everything that asks "what places are
    // there" reads that list: roadrules.js's clearance law ("roads connect
    // places, they do not overlap them"), continent.js's inSolidRegion (a POI
    // is never carved into water) and its dressing skip, the full map's
    // labels, and worldLayoutAudit — which had to SYNTHESISE the annex by hand
    // precisely because it is missing. So a 240 m city island was invisible to
    // every no-build and clearance rule in the game, and anything routed past
    // it was routed straight THROUGH it. One registration ends that; the disc
    // is its real footprint, and the sand ring is the pad.
    if (CBZ.registerCityRegion && !(city.regions || []).some(function (r) { return r && r.biome === "annex"; })) {
      CBZ.registerCityRegion(city, {
        name: "Commerce Annex", subtitle: "East Island District", biome: "annex",
        kind: "circle", cx: cx, cz: cz, r: R, pad: 14,
      });
    }
    // BUILT GROUND IS FLAT (city/continent.js). continent.js carries a
    // hard-coded `city.annex` special case for exactly this, but it stops at
    // radius + 2 and so leaves the outer sand ring ungated. Declaring the real
    // extent through the shared registry covers the beach too, and it is the
    // path any future island should use instead of another special case.
    if (CBZ.terrainFlattenUnder) {
      CBZ.terrainFlattenUnder({ name: "Commerce Annex", cx: cx, cz: cz, r: R + 14, pad: 2 });
    }
    return annex;
  };
})();
