/* ============================================================
   world/materials.js — material factory, box helper, textures.
   These are the building blocks every world/* module uses.

   WET ROADS (rain tie-in): CBZ.roadMat() hands out a shared, cached
   MeshStandardMaterial (asphalt look, textured with checkerTex — same
   canvas approach ground.js already uses for the Lambert path) that
   this file itself keeps damp-looking while it rains. weather.js is
   the source of truth for rain intensity (CBZ.weather.intensity) but
   loads AFTER this file in index.html, so we never touch it at
   module-load time — only inside the per-frame tick below, feature-
   detected every call. "Wet" here is the cheap, definitely-works
   version the research pass calls for: darken the base colour toward
   wet-asphalt black, drop roughness (shinier/tighter highlight) and
   raise metalness a touch so it picks up whatever envMap exists,
   ALL interpolated (never snapped) so puddles build up over the
   seconds rain intensity rises and dry back out the same way. No
   render-target planar reflection pass — a second scene render per
   frame for every wet road tile is exactly the draw-call regression
   this engine's budget forbids, and MeshStandardMaterial's specular
   response already sells "wet" convincingly at zero extra draw calls.
   Existing MeshLambertMaterial road tiles (ground.js, world.js, etc.)
   are untouched — Lambert has no roughness/metalness to animate, and
   this file must not change what OTHER files already construct.

   ------------------------------------------------------------------
   TIERED PBR (2026-07): CBZ.cmat() now has TWO bodies for every cache
   key — the original MeshLambertMaterial and a MeshStandardMaterial
   "twin" with sane roughness/metalness and the shared PMREM
   environment. Which one a call site receives depends on the live
   quality tier (CBZ.gfxTier.pbr, tiers 3-4 by default). The signature,
   the cache semantics and the `_shared` contract are IDENTICAL, so all
   ~250 existing CBZ.cmat() call sites are untouched and unaware.

   WHY TWINS AND NOT A STRAIGHT SWAP — this is the single biggest
   performance trap in the whole render stack. core/batch.js's
   mergeableKeyV2() refuses to merge anything that is not
   MeshLambertMaterial/MeshBasicMaterial ("Standard/Phong keep their
   look") and refuses anything carrying a `.map`. Handing Standard
   materials to the world builders would therefore have silently
   un-merged the entire static city shell and resurrected the ~2200
   draw calls batching exists to kill. Keeping BOTH bodies alive, each
   pointing at the other through `_cbzTwin`, lets core/gfx.js swap the
   whole scene back to Lambert for the duration of the batch pass and
   restore Standard on the survivors afterwards — so the merge set is
   byte-for-byte what it always was, and the draw-call count does not
   move by one. Merged geometry gets its PBR back a different way: gfx
   promotes the batcher's own output materials, of which there are a
   handful, at zero draw-call cost.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  CBZ.CONFIG = CBZ.CONFIG || {};

  // GFX_PBR_MATERIALS (owner: "make the world like 100x realer feeling").
  // On → CBZ.cmat() hands out MeshStandardMaterial twins on quality tiers that
  // ask for them (CBZ.gfxTier.pbr), so shared surfaces gain roughness,
  // metalness and environment reflection instead of flat Lambert. Flip false
  // (or ?cfg_GFX_PBR_MATERIALS=0) and every call site silently returns to the
  // exact Lambert material it got before — a true one-line revert.
  if (CBZ.CONFIG.GFX_PBR_MATERIALS == null) CBZ.CONFIG.GFX_PBR_MATERIALS = true;
  // GFX_ROAD_DETAIL — procedural asphalt normal/roughness maps on CBZ.roadMat.
  // Roads are the largest continuous surface in the game AND already the only
  // material with live roughness/metalness (the wet-rain tie-in below), so a
  // normal map is what finally makes wet highlights scatter instead of mirror.
  // Draw-call safe: roadMat instances are already textured/Standard and were
  // therefore ALREADY excluded from every batch pass — adding more maps to
  // them cannot change the merge set.
  if (CBZ.CONFIG.GFX_ROAD_DETAIL == null) CBZ.CONFIG.GFX_ROAD_DETAIL = true;
  // Jail geometry belongs to one mode-owned root. Survival's builder reparents
  // the handful of addBox results it creates into its own arena immediately.
  const scene = CBZ.prisonRoot || CBZ.scene;

  // basic lambert material with optional emissive glow. FRESH every call —
  // use this when something will MUTATE the material per-instance (e.g.
  // reactions.js flashes each NPC's head emissive; sharing would bleed).
  function mat(color, opts) {
    opts = opts || {};
    return new THREE.MeshLambertMaterial({
      color,
      emissive: opts.emissive || 0x000000,
      emissiveIntensity: opts.ei != null ? opts.ei : 1,
    });
  }

  // ---- shared caches (the scaling foundation: with hundreds of NPCs we
  //      reuse ~10 geometries + a handful of materials instead of ~16 geoms
  //      + ~12 materials PER character). Anything tagged `_shared` must NEVER
  //      be disposed (see entities/survivorbot.js clear). Only use cmat() for
  //      surfaces nothing mutates per-instance — the head stays mat(). ----
  const matCache = new Map();
  // Every Standard twin ever built, so core/gfx.js can drive the batch-safe
  // swap protocol and backfill the environment map when carfx builds it late.
  const pbrTwins = [];
  CBZ.pbrTwins = pbrTwins;

  // Is the live quality tier asking for PBR shared materials? Read fresh on
  // every call (never cached) so a tier change takes effect for new geometry
  // immediately; already-built geometry is re-synced by CBZ.gfxSyncMaterials().
  function pbrWanted() {
    if (!CBZ.CONFIG.GFX_PBR_MATERIALS) return false;
    // Not armed until core/gfx.js has seen the one-shot window-load batch pass
    // finish. Everything built before that point (the prison, the boot scene)
    // therefore reaches core/batch.js as Lambert exactly as it always has, and
    // gets its Standard twin swapped in afterwards.
    if (!CBZ.gfxPbrArmed) return false;
    const t = CBZ.gfxTier;
    return !!(t && t.pbr);
  }
  CBZ.pbrMaterialsOn = pbrWanted;

  // Build (once) the MeshStandardMaterial body for a Lambert cache entry.
  // Roughness is high and metalness ~0 by default: the point is not to make
  // the city shiny, it is to give it an ENERGY-CONSERVING response plus the
  // PMREM environment as a cheap indirect-light term. A dark material stays
  // dark; a light one now picks up sky bounce the way a real one does.
  function makeTwin(lam, color, em, ei) {
    const std = new THREE.MeshStandardMaterial({
      color: color,
      emissive: em,
      emissiveIntensity: ei,
      roughness: 0.86,
      metalness: 0.03,
      envMap: CBZ.ENV || null,
      envMapIntensity: 0.55,
    });
    std._shared = true;
    std._cbzPbr = true;
    std._cbzTwin = lam;
    lam._cbzTwin = std;
    lam._cbzPbr = false;
    pbrTwins.push(std);
    return std;
  }

  function cmat(color, opts) {
    opts = opts || {};
    const em = opts.emissive || 0, ei = opts.ei != null ? opts.ei : 1;
    const k = color + "|" + em + "|" + ei;
    let m = matCache.get(k);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color: color, emissive: em, emissiveIntensity: ei });
      m._shared = true;
      matCache.set(k, m);
    }
    if (!pbrWanted()) return m;
    return m._cbzTwin || makeTwin(m, color, em, ei);
  }

  // CBZ.pbrMat(color, opts) — explicit shared PBR material for callers that
  // WANT roughness/metalness regardless of tier (glass, chrome, wet stone).
  // Same cache/`_shared` contract as cmat; opts.roughness/.metalness/.surface
  // (a world/textures_surface.js name) are all optional.
  const pbrCache = new Map();
  function pbrMat(color, opts) {
    opts = opts || {};
    const em = opts.emissive || 0, ei = opts.ei != null ? opts.ei : 1;
    const r = opts.roughness != null ? +opts.roughness : 0.8;
    const mt = opts.metalness != null ? +opts.metalness : 0.05;
    const k = color + "|" + em + "|" + ei + "|" + r + "|" + mt + "|" + (opts.surface || "");
    let m = pbrCache.get(k);
    if (m) return m;
    m = new THREE.MeshStandardMaterial({
      color: color, emissive: em, emissiveIntensity: ei,
      roughness: r, metalness: mt,
      envMap: CBZ.ENV || null,
      envMapIntensity: opts.envMapIntensity != null ? +opts.envMapIntensity : 0.7,
    });
    m._shared = true;
    m._cbzPbr = true;
    if (opts.surface && CBZ.surfaceApply) {
      CBZ.surfaceApply(m, opts.surface, { color: opts.surfaceColor !== false, repeat: opts.repeat, roughness: r, metalness: mt });
    }
    pbrTwins.push(m);
    pbrCache.set(k, m);
    return m;
  }

  const geomCache = new Map();
  function boxGeom(w, h, d) {
    const k = w + "," + h + "," + d;
    let g = geomCache.get(k);
    if (!g) { g = new THREE.BoxGeometry(w, h, d); g._shared = true; geomCache.set(k, g); }
    return g;
  }

  // the workhorse: place a box, optionally make it a collider / LOS blocker
  function addBox(x, y, z, w, h, d, color, opts) {
    opts = opts || {};
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
    m.position.set(x, y, z);
    m.castShadow = opts.cast !== false;
    m.receiveShadow = opts.receive !== false;
    scene.add(m);
    if (opts.solid) {
      const col = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, ref: m };
      // optional vertical span → a height-gated wall (window sill / doorway /
      // upper-floor wall). Actors only collide when their body overlaps [y0,y1];
      // colliders without it stay full-height, so the prison is unaffected.
      if (opts.y0 != null) col.y0 = opts.y0;
      if (opts.y1 != null) col.y1 = opts.y1;
      CBZ.colliders.push(col);
      m.userData.collider = col;
    }
    if (opts.blockLOS) CBZ.losBlockers.push(m);
    return m;
  }

  // 2-tone checker texture (grass / asphalt)
  function checkerTex(a, b, n) {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d");
    const s = 256 / n;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        g.fillStyle = (i + j) % 2 ? a : b;
        g.fillRect(i * s, j * s, s, s);
      }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.NearestFilter;
    return t;
  }

  // speckled concrete texture for indoor floors / walls
  function concreteTex(base, speck) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    g.fillStyle = base; g.fillRect(0, 0, 128, 128);
    g.fillStyle = speck;
    for (let i = 0; i < 220; i++) {
      const x = (i * 53) % 128, y = (i * 97) % 128;     // deterministic specks
      g.globalAlpha = 0.06 + ((i * 7) % 10) / 60;
      g.fillRect(x, y, 2, 2);
    }
    g.globalAlpha = 1;
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  // ---- wet asphalt (Technique 3: rain-reactive road material) --------
  // Dry/wet endpoints authored once; every road material this factory
  // hands out lerps its live .color between them and eases roughness/
  // metalness the same way, driven by CBZ.weather.intensity each frame.
  // Kept as plain objects (not THREE.Color instances) so this block has
  // zero cost when THREE.Color isn't needed yet (module-load time, no
  // renderer/weather present).
  const DRY_COL = 0x5b626c;   // matches CBZ.COL.ASPHALT_A's midtone
  const WET_COL = 0x24272c;   // darker, wet-slick asphalt
  const DRY_ROUGH = 0.92, WET_ROUGH = 0.32;   // wetter = shinier (lower roughness)
  const DRY_METAL = 0.02, WET_METAL = 0.12;   // a touch of metalness picks up envMap specular

  const roadMats = [];         // every material this factory ever produced
  let wetK = 0;                // smoothed 0..1 "how wet the road looks" (own damping — weather's own intensity already eases, this just avoids a second snap on top)
  const _dryC = new THREE.Color(DRY_COL), _wetC = new THREE.Color(WET_COL), _roadC = new THREE.Color();

  // color: hex (defaults to the shared asphalt tone) — pass a checkerTex()
  // canvas map via opts.map for the textured look ground.js/world.js use.
  // Standard (not Lambert) ON PURPOSE: it's the only material type in this
  // codebase with roughness/metalness to animate (carfx.js already uses
  // MeshStandardMaterial for exactly this reason) — everything else here
  // stays Lambert so this is an additive option, not a swap of the default.
  function roadMat(opts) {
    opts = opts || {};
    const m = new THREE.MeshStandardMaterial({
      color: opts.color != null ? opts.color : DRY_COL,
      map: opts.map || null,
      roughness: DRY_ROUGH,
      metalness: DRY_METAL,
      envMap: CBZ.ENV || null, // carfx.js may not have built this yet; opportunistic only
      envMapIntensity: 0.9,
    });
    // SURFACE DETAIL. The asphalt normal map is what turns the wet-road
    // specular from a mirror sheet into scattered highlights, and the
    // roughness map is what makes the dry road stop reading as poured rubber.
    // The caller may already own the albedo (city/world.js hands us its own
    // checkerTex) — in that case we take normal+roughness only and leave
    // .map alone. Tier-gated inside surfaceApply: nothing happens on tier 0.
    if (CBZ.CONFIG.GFX_ROAD_DETAIL && CBZ.surfaceApply) {
      CBZ.surfaceApply(m, "asphalt", {
        color: false,                     // never fight the caller's albedo
        repeat: opts.detailRepeat != null ? opts.detailRepeat : 34,
        roughness: DRY_ROUGH,
        metalness: DRY_METAL,
      });
      m._roadNormalScale = m.normalScale ? m.normalScale.x : 0;
    }
    m._roadWet = true;
    m._roadBase = new THREE.Color(opts.color != null ? opts.color : DRY_COL);
    roadMats.push(m);
    return m;
  }

  // Runs late (after weather's own order-90 intensity update) so we react
  // to THIS frame's rain, not last frame's. Cheap: a couple of lerps per
  // live road material, only when any exist (headless/menu builds pay ~0).
  CBZ.onAlways(92, function (dt) {
    if (!roadMats.length) return;
    const rainI = (CBZ.weather && typeof CBZ.weather.intensity === "number") ? CBZ.weather.intensity : 0;
    // ease our own wetness a beat behind rain intensity — puddles form/drain
    // over a couple seconds, they don't snap with every gust of rain.
    const rate = dt ? Math.min(1, dt * 0.6) : 0;
    wetK += (rainI - wetK) * rate;
    if (wetK < 0.002) wetK = 0;
    _roadC.copy(_dryC).lerp(_wetC, wetK);
    const rough = DRY_ROUGH + (WET_ROUGH - DRY_ROUGH) * wetK;
    const metal = DRY_METAL + (WET_METAL - DRY_METAL) * wetK;
    for (let i = 0; i < roadMats.length; i++) {
      const m = roadMats[i];
      // multiply the material's OWN base tint by the shared dry/wet ratio
      // instead of overwriting .color outright, so callers that pass a
      // custom `opts.color` (a different asphalt shade) still darken
      // proportionally rather than all converging on one grey.
      const k = _dryC.r > 0.001 ? (_roadC.r / _dryC.r) : 1;
      m.color.copy(m._roadBase).multiplyScalar(k);
      m.roughness = rough;
      m.metalness = metal;
      // Standing water FILLS the aggregate. A wet road is physically smoother
      // than a dry one, so the same normal map has to flatten as it soaks —
      // otherwise rain makes the asphalt look like hammered metal.
      if (m._roadNormalScale && m.normalScale) {
        const ns = m._roadNormalScale * (1 - wetK * 0.72);
        m.normalScale.set(ns, ns);
      }
      // A wet surface reflects the sky far harder than a dry one.
      if ("envMapIntensity" in m) m.envMapIntensity = 0.9 + wetK * 1.5;
      if (!m.envMap && CBZ.ENV) { m.envMap = CBZ.ENV; m.needsUpdate = true; } // backfill if carfx's env built later
    }
  });

  // ============================================================
  //  CBZ.glass(opts) — THE ONE GLASS.
  //
  //  OWNER, on seeing the game: "our OG glass buildings that populate the
  //  whole map are amazing and the glass is perfectly see-thru and behaves
  //  like glass — the cockpit has some glass but it's not good at all."
  //
  //  He is right, and the reason is not that cockpit glass was tuned badly.
  //  It is that there was no such thing as "the game's glass". There was a
  //  private `glassMat()` closure inside city/buildings.js that nobody else
  //  could reach, and then every other surface that needed to be see-through
  //  guessed its own recipe from scratch:
  //     buildings.js  0xbfe9f7 + emissive 0x3f8aa6 @0.5, opacity 0.60  <- the good one
  //     island_airport  flat grey 0x66717d, no emissive, opacity 0.52  <- murky
  //     cockpit_shapes  glassMats: []  — literally "no glass here by design"
  //  Three surfaces that are all glass, three unrelated answers, and only the
  //  one nobody could import looked right.
  //
  //  THE CHARACTER, and why it works: a cool blue-white tint with an EMISSIVE
  //  LIFT under it. The emissive is what makes it read as glass rather than as
  //  a translucent plastic sheet — real glass never goes fully dark, because
  //  it is always bouncing some sky back at you. Opacity 0.6 is see-through
  //  enough to read the world behind it while still catching a highlight.
  //  That is the whole trick, and it is now available to anything with a
  //  window in it.
  //
  //  Pooled per (tint, opacity, side, lift) so a thousand windows across the
  //  map stay ONE material and ONE draw-call bucket — the same discipline
  //  cmat() enforces. Callers must never mutate the returned material; ask for
  //  a different variant instead.
  //
  //    CBZ.glass()                                 the building curtain wall
  //    CBZ.glass({ opacity: 0.34 })                a windscreen you fly through
  //    CBZ.glass({ tint: 0x9fdcf2, side: 2 })      cabin windows, seen both ways
  // ============================================================
  const GLASS_TINT = 0xbfe9f7;     // buildings.js's exact cool blue
  const GLASS_LIFT = 0x3f8aa6;     // and its exact emissive underlight
  const glassCache = new Map();
  function glass(opts) {
    opts = opts || {};
    const tint = opts.tint != null ? (opts.tint | 0) : GLASS_TINT;
    const lift = opts.lift != null ? (opts.lift | 0) : GLASS_LIFT;
    const ei = opts.ei != null ? +opts.ei : 0.5;
    const op = opts.opacity != null ? +opts.opacity : 0.6;
    // FrontSide(0) by default; pass side: THREE.DoubleSide for a pane you can
    // be on either side of (a cabin window, a canopy you sit inside).
    const side = opts.side != null ? (opts.side | 0) : THREE.FrontSide;
    // depthWrite defaults FALSE for double-sided panes: a canopy that writes
    // depth sorts against the instrument panel behind it and punches a hole in
    // its own cockpit. Single-sided building glass keeps writing, as it always
    // has, so the city is byte-identical.
    const dw = opts.depthWrite != null ? !!opts.depthWrite : (side === THREE.FrontSide);
    // fog:false for panes rendered in a separate fog-free pass (the cockpit
    // interior scene). A fogged windscreen inside a fog-free cockpit turns
    // milky at range and reads as frosted glass.
    const fog = opts.fog !== false;
    const k = tint + "|" + lift + "|" + ei + "|" + op + "|" + side + "|" + (dw ? 1 : 0) + "|" + (fog ? 1 : 0);
    let m = glassCache.get(k);
    if (!m) {
      m = new THREE.MeshLambertMaterial({
        color: tint, emissive: lift, emissiveIntensity: ei,
        transparent: true, opacity: op, side: side, depthWrite: dw, fog: fog,
      });
      m._shared = true;
      m._cbzGlass = true;      // colliders/LOS already test material.transparent
      glassCache.set(k, m);
    }
    return m;
  }
  CBZ.glass = glass;
  CBZ.GLASS_TINT = GLASS_TINT;

  CBZ.mat = mat;
  CBZ.cmat = cmat;
  CBZ.pbrMat = pbrMat;
  CBZ.boxGeom = boxGeom;
  CBZ.addBox = addBox;
  CBZ.checkerTex = checkerTex;
  CBZ.concreteTex = concreteTex;
  CBZ.roadMat = roadMat;
})();
