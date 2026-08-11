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

  /* THE TWO BUSES addBox WRITES HAVE TO EXIST BEFORE IT DOES. config.js
     declares both and a one-shot page never loads config.js, so `{solid:true}`
     was already safe (core/microboot.js publishes CBZ.colliders) while
     `{blockLOS:true}` THREW — which is every wall world/roombuild.js's
     roomShell stamps, so a slice page could not raise a room at all. Declared
     here, beside the only writer, yielding to whoever declared it first. */
  if (!CBZ.colliders) CBZ.colliders = [];
  if (!CBZ.losBlockers) CBZ.losBlockers = [];

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

  // ============================================================
  //  CBZ.prisonGroundTex(kind, opts) — INSTITUTIONAL GROUND.
  //
  //  OWNER, on the prison escape game: "the checkered ground is dumb."
  //
  //  He is right, and it is not a taste call. checkerTex(a, b, 2) draws a
  //  literal two-tone draughts board — the universal DEBUG texture, the thing
  //  every engine ships as "this surface has no material yet".
  //  world/disaster_arena.js:111 already named the disease in its own comment
  //  ("the old two-tone checker tiling read as a debug texture") and then
  //  solved it privately, for one arena. This is the SHARED answer, so no
  //  ground surface in the compound has to reach for the checker again.
  //
  //  KINDS — each is a real institutional surface, never a pattern:
  //    "yard-grass"   worn exercise-yard turf: an irregular light/dark mottle
  //                   with bald khaki patches where feet killed the grass.
  //    "field-grass"  the same author, calmer — the open country outside the
  //                   wall, which has nobody walking on it.
  //    "asphalt"      near-uniform bitumen: fine aggregate speckle, faint
  //                   repair blotching, tyre/oil staining, hairline cracks.
  //    "concrete"     a poured slab with real EXPANSION JOINTS on a panel
  //                   grid, plus pore speckle, water staining and cracks.
  //
  //  THE JOINT GRID IS ALSO THE SEAM HIDER. Joints are drawn at u/v = 0 as
  //  well as mid-tile, so the place where the texture wraps IS a joint. A
  //  repeating concrete slab is the one tiling surface allowed to show you
  //  exactly where it repeats, because a real slab does.
  //
  //  TONES COME FROM CBZ.COL AND THE MEAN IS PRESERVED. Each kind mottles
  //  between the SAME two tones the checker used, so the average colour of
  //  every surface — and therefore how it reads under the compound's lights —
  //  is what it always was. Only the pattern changed.
  //
  //  WHY NOT world/textures_surface.js's asphalt/concrete/grass. That library
  //  is the right answer for a MeshStandardMaterial and stays the right answer
  //  everywhere it fits, but it cannot serve these call sites:
  //    - it hands back CACHED, SHARED texture instances with a uniform repeat
  //      already baked in. The prison ground needs per-surface, NON-uniform
  //      repeats (the walkway is 1 x 6), and writing .repeat on a shared
  //      instance would corrupt every other consumer of that cache entry;
  //    - it tags colour maps THREE.sRGBEncoding, correct on its own terms, but
  //      this compound's palette (mat / cmat / checkerTex / concreteTex) is
  //      authored UNTAGGED, so a tagged map reads visibly darker than the wall
  //      it meets;
  //    - it is tier-gated off entirely on quality tier 0, and the ground may
  //      not vanish on a weak GPU;
  //    - and it authors no expansion joints and no worn turf, which is the
  //      whole institutional character being asked for.
  //  What IS reused: the house determinism law (CBZ.hashN, world-seed folded,
  //  never Math.random) and the periodic-lattice trick that makes a value
  //  noise field wrap seamlessly.
  //
  //  Returns a FRESH THREE.CanvasTexture over a CACHED canvas, so a caller may
  //  set .repeat freely while the expensive part — the noise bake — is shared.
  // ============================================================
  const GROUND_KINDS = ["yard-grass", "field-grass", "asphalt", "concrete"];
  const groundCanvases = new Map();     // bake key -> HTMLCanvasElement
  let groundTexCalls = 0;

  function ci(v) { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }
  function cl(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }
  // "#rrggbb" | 0xrrggbb -> {r,g,b} in 0..255
  function rgb255(c) {
    let n;
    if (typeof c === "string") {
      const s = c.charAt(0) === "#" ? c.slice(1) : c;
      n = parseInt(s, 16);
      if (!isFinite(n)) n = 0x808080;
    } else n = c | 0;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function shadeHex(c, k) {
    const p = rgb255(c);
    return (ci(p.r * k) << 16) | (ci(p.g * k) << 8) | ci(p.b * k);
  }

  // ---- deterministic periodic value noise ---------------------------------
  // CBZ.hashN (core/seed.js) folds CBZ.WORLD_SEED, so a texture is stable for
  // a seed and differs between seeds — the determinism law, never Math.random.
  // Lattice points are wrapped modulo the octave period BEFORE hashing, which
  // is exactly what makes every field below tile without a visible seam.
  function gHash(x, y, salt) {
    if (CBZ.hashN) return CBZ.hashN(x | 0, y | 0, salt | 0) / 4294967296;
    let h = (Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(salt | 0, 2246822519)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function latGrid(per, salt) {
    const a = new Float32Array(per * per);
    for (let y = 0; y < per; y++) for (let x = 0; x < per; x++) a[y * per + x] = gHash(x, y, salt);
    return a;
  }
  function smoothT(t) { return t * t * (3 - 2 * t); }
  function vsample(a, per, u, v) {
    const x = u * per, y = v * per;
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = smoothT(x - xi), fy = smoothT(y - yi);
    const x0 = ((xi % per) + per) % per, y0 = ((yi % per) + per) % per;
    const x1 = (x0 + 1) % per, y1 = (y0 + 1) % per;
    const p = a[y0 * per + x0], q = a[y0 * per + x1];
    const r = a[y1 * per + x0], s = a[y1 * per + x1];
    const t0 = p + (q - p) * fx, t1 = r + (s - r) * fx;
    return t0 + (t1 - t0) * fy;
  }
  // fbm with its octave lattices PRE-BUILT: the per-pixel loop then costs a
  // handful of typed-array reads instead of a hash call, which is the whole
  // reason a 512px bake is affordable at boot.
  function fbmField(base, oct, salt) {
    const lay = [];
    let per = Math.max(2, base | 0), amp = 0.5, norm = 0;
    for (let o = 0; o < oct; o++) {
      lay.push([latGrid(per, salt + o * 7919), per, amp]);
      norm += amp; amp *= 0.5; per *= 2;
    }
    const inv = 1 / (norm || 1);
    return function (u, v) {
      let s = 0;
      for (let i = 0; i < lay.length; i++) s += vsample(lay[i][0], lay[i][1], u, v) * lay[i][2];
      return s * inv;
    };
  }
  // Rasterise an fbm field into a full NxN Float32Array so the per-pixel loop
  // below is pure typed-array reads. THE BAKE IS BOOT-TIME WORK, so a field is
  // evaluated on the COARSEST grid that can still carry it and bilinearly
  // upsampled: a mottle whose finest octave has an 18 px period holds no
  // information at 1 px, and sampling it per-pixel is what would have made a
  // 512px bake cost a visible fraction of a second. Only the grain/aggregate
  // fields (period ~1-4 px) actually run at full resolution.
  function rasterField(N, base, oct, salt) {
    const top = Math.max(2, base | 0) << Math.max(0, oct - 1);   // finest lattice period
    let M = 4;
    while (M < top * 4 && M < N) M <<= 1;                        // >= 4 samples per cell
    if (M > N) M = N;
    const f = fbmField(base, oct, salt);
    const coarse = new Float32Array(M * M);
    for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) coarse[y * M + x] = f(x / M, y / M);
    if (M === N) return coarse;
    const out = new Float32Array(N * N);
    const s = M / N;
    for (let y = 0; y < N; y++) {
      const fy = y * s, y0 = fy | 0, ty = fy - y0;
      const r0 = y0 * M, r1 = ((y0 + 1) % M) * M;
      const row = y * N;
      for (let x = 0; x < N; x++) {
        const fx = x * s, x0 = fx | 0, tx = fx - x0, x1 = (x0 + 1) % M;
        const a = coarse[r0 + x0], b = coarse[r0 + x1];
        const c = coarse[r1 + x0], e = coarse[r1 + x1];
        const p = a + (b - a) * tx, q = c + (e - c) * tx;
        out[row + x] = p + (q - p) * ty;
      }
    }
    return out;
  }
  // x^40 by repeated squaring — this runs once per pixel and Math.pow is the
  // single most expensive call in the whole bake.
  //
  // WHY 40 AND NOT 24. A crack is the level set of the ridged field, so TWO
  // numbers control it and they pull opposite ways: the field's frequency sets
  // how MANY cracks cross the tile, the exponent sets how WIDE each one is.
  // Tuning only the exponent is what produced a measurably crazed surface —
  // at base 9 / exponent 24 the bake came out 9% darker than the tone it was
  // supposed to preserve, i.e. the "hairline" cracks covered several percent
  // of the ground. Frequency is now low (a crack every ~1.5 m) and the
  // exponent high (a ~3 px line), which is a cracked road instead of a
  // shattered one, and the mean tone survives.
  function pow40(x) { const a = x * x, b = a * a, c = b * b, d = c * c, e = d * d; return e * c; }

  // kind string -> a stable salt (FNV-1a), so two kinds never share a field
  function strSalt(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return (h & 0x7fffffff) | 0;
  }

  // SIZE IS A BUDGET, NOT A CONSTANT. The bake is synchronous boot work, so
  // each kind gets the smallest power of two that still carries what it is
  // FOR at the scale it is actually seen (a POT edge is required: these wrap,
  // and WebGL1 refuses RepeatWrapping + mipmaps on a NPOT texture).
  //   yard-grass 512 — a 12 m tile you stand on; the worn patches are the point
  //   asphalt    512 — a 9 m tile down the walkway you spend the game on
  //   concrete   256 — a 6.3 m apron tile, ~40 px/m, and its detail is joints
  //   field-grass 256 — a 26 m tile out past the wall, seen at distance
  function groundDefaults(kind) {
    const C = CBZ.COL || {};
    if (kind === "field-grass") {
      // The open country plane outside the wall. These two tones average to
      // 0x4ea84e — the exact flat green that plane used to be painted — so the
      // horizon tone does not move, it only stops being a sheet of one colour.
      return { a: "#56b156", b: "#469f46", size: 256, wear: 0.20, patch: 3, grain: 48, joint: 0 };
    }
    if (kind === "asphalt") {
      return { a: C.ASPHALT_A || "#5b626c", b: C.ASPHALT_B || "#535a64", size: 512, wear: 0, patch: 3, grain: 96, joint: 0 };
    }
    if (kind === "concrete") {
      const cc = C.CONCRETE != null ? C.CONCRETE : 0x6e7682;
      return { a: cc, b: shadeHex(cc, 0.92), size: 256, wear: 0, patch: 3, grain: 80, joint: 2 };
    }
    return { a: C.GRASS_A || "#57b257", b: C.GRASS_B || "#4aa14a", size: 512, wear: 0.58, patch: 4, grain: 64, joint: 0 };
  }

  function bakeGround(kind, o) {
    const N = o.size;
    const cv = document.createElement("canvas");
    cv.width = cv.height = N;
    const ctx = cv.getContext("2d");
    const img = ctx.createImageData(N, N);
    const d = img.data;
    const salt = strSalt(kind);
    const A = rgb255(o.a), B = rgb255(o.b);

    if (kind === "yard-grass" || kind === "field-grass") {
      // Worn earth DERIVED from the turf tone (warmer, lighter, desaturated),
      // so a palette change to GRASS_A/B drags the bald patches with it.
      const mr = (A.r + B.r) * 0.5, mg = (A.g + B.g) * 0.5, mb = (A.b + B.b) * 0.5;
      const Er = mr * 0.55 + 96, Eg = mg * 0.42 + 44, Eb = mb * 0.50 + 28;
      const fPatch = rasterField(N, o.patch, 3, salt + 11);   // light/dark mottle
      const fWear = rasterField(N, 9, 2, salt + 29);          // where feet killed it
      const fGrain = rasterField(N, o.grain, 2, salt + 47);   // blade grain
      const thr = 1 - o.wear * 0.72, span = (1 - thr) || 1;
      const worn = o.wear > 0;
      for (let i = 0, n = N * N; i < n; i++) {
        const p = fPatch[i];
        let r = B.r + (A.r - B.r) * p, g = B.g + (A.g - B.g) * p, b = B.b + (A.b - B.b) * p;
        if (worn) {
          let w = (fWear[i] - thr) / span;
          if (w > 0) {
            if (w > 1) w = 1;
            w *= 0.9;
            r += (Er - r) * w; g += (Eg - g) * w; b += (Eb - b) * w;
          }
        }
        const k = 1 + (fGrain[i] - 0.5) * 0.16;
        const i4 = i * 4;
        d[i4] = cl(r * k); d[i4 + 1] = cl(g * k); d[i4 + 2] = cl(b * k); d[i4 + 3] = 255;
      }
    } else if (kind === "asphalt") {
      const mr = (A.r + B.r) * 0.5, mg = (A.g + B.g) * 0.5, mb = (A.b + B.b) * 0.5;
      const fBlot = rasterField(N, 3, 3, salt + 3);        // repair patches / sun bleach
      const fAgg = rasterField(N, o.grain, 2, salt + 13);  // aggregate speckle
      const fStain = rasterField(N, 5, 2, salt + 23);      // oil + tyre staining
      const fCrack = rasterField(N, 3, 2, salt + 31);      // hairline cracks
      for (let i = 0, n = N * N; i < n; i++) {
        let l = 1 + (fBlot[i] - 0.5) * 0.10 + (fAgg[i] - 0.5) * 0.15;
        const st = fStain[i];
        l -= st * st * st * 0.20;
        l -= pow40(1 - Math.abs(fCrack[i] * 2 - 1)) * 0.50;
        const i4 = i * 4;
        // bitumen reads faintly cool, the way real asphalt does
        d[i4] = cl(mr * l * 0.99); d[i4 + 1] = cl(mg * l); d[i4 + 2] = cl(mb * l * 1.03); d[i4 + 3] = 255;
      }
    } else {
      const fStain = rasterField(N, o.patch, 3, salt + 5);
      const fPore = rasterField(N, o.grain, 2, salt + 17);
      const fCrack = rasterField(N, 3, 2, salt + 37);
      const panels = Math.max(1, o.joint | 0);
      const pw = N / panels;
      const core = Math.max(1, N / 380), soft = core + 3.5;
      for (let y = 0; y < N; y++) {
        const my = y % pw, dy = my < pw - my ? my : pw - my;
        const row = y * N;
        for (let x = 0; x < N; x++) {
          const i = row + x;
          const s = fStain[i];
          const r = B.r + (A.r - B.r) * s, g = B.g + (A.g - B.g) * s, b = B.b + (A.b - B.b) * s;
          let l = 1 + (fPore[i] - 0.5) * 0.08;
          l -= pow40(1 - Math.abs(fCrack[i] * 2 - 1)) * 0.30;
          // EXPANSION JOINT: distance in pixels to the nearest panel gridline.
          // Squared falloff = a dark hairline with a soft grime halo, which is
          // what a swept sealant joint actually looks like. Joints land on
          // u/v = 0 as well as mid-tile, so the wrap seam IS a joint.
          const mx = x % pw, dx = mx < pw - mx ? mx : pw - mx;
          const dj = dx < dy ? dx : dy;
          if (dj < soft) {
            const jk = dj <= core ? 1 : 1 - (dj - core) / (soft - core);
            l *= 1 - 0.38 * jk * jk;
          }
          const i4 = i * 4;
          d[i4] = cl(r * l); d[i4 + 1] = cl(g * l); d[i4 + 2] = cl(b * l); d[i4 + 3] = 255;
        }
      }
    }

    ctx.putImageData(img, 0, 0);
    return cv;
  }

  function groundAniso() {
    try {
      const r = CBZ.renderer;
      const max = r && r.capabilities && r.capabilities.getMaxAnisotropy ? r.capabilities.getMaxAnisotropy() : 1;
      return Math.max(1, Math.min(8, max));
    } catch (e) { return 1; }
  }

  function prisonGroundTex(kind, opts) {
    opts = opts || {};
    const k = GROUND_KINDS.indexOf(kind) >= 0 ? kind : "concrete";
    const def = groundDefaults(k);
    const o = {
      a: opts.a != null ? opts.a : def.a,
      b: opts.b != null ? opts.b : def.b,
      size: opts.size ? Math.max(64, opts.size | 0) : def.size,
      wear: opts.wear != null ? +opts.wear : def.wear,
      patch: opts.patch != null ? (opts.patch | 0) : def.patch,
      grain: opts.grain != null ? (opts.grain | 0) : def.grain,
      joint: opts.joint != null ? (opts.joint | 0) : def.joint,
    };
    if (o.b == null) o.b = o.a;
    const key = k + "|" + o.a + "|" + o.b + "|" + o.size + "|" + o.wear + "|" + o.patch + "|" + o.grain + "|" + o.joint;
    let canvas = groundCanvases.get(key);
    if (!canvas) { canvas = bakeGround(k, o); groundCanvases.set(key, canvas); }
    groundTexCalls++;
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (opts.repeat && opts.repeat.length === 2) t.repeat.set(+opts.repeat[0], +opts.repeat[1]);
    t.anisotropy = groundAniso();
    // Deliberately NOT tagged THREE.sRGBEncoding — see the WHY NOT note above.
    // Everything else in this compound is authored untagged; a tagged map here
    // would read visibly darker than the wall standing on it.
    t.needsUpdate = true;
    t._cbzGround = k;
    return t;
  }
  CBZ.prisonGroundTex = prisonGroundTex;
  CBZ.PRISON_GROUND_KINDS = GROUND_KINDS;

  // Ratchet. `legacy` counts GROUND surfaces in the compound (a plane laid
  // flat, or a slab wider than it is thick) still wearing a map that did NOT
  // come from prisonGroundTex — i.e. the remaining checker/legacy debt. It may
  // only ever go DOWN. `adopted` is printed beside it so a "fix" that simply
  // stops drawing ground cannot pass. NOT YET PINNED: run it and write the
  // number in rather than pinning a guess.
  CBZ.prisonGroundAudit = function () {
    let adopted = 0, legacy = 0;
    const root = CBZ.prisonRoot || CBZ.scene;
    if (root && root.traverse) {
      root.traverse(function (ob) {
        if (!ob.isMesh || !ob.material || !ob.material.map || !ob.geometry) return;
        const g = ob.geometry, p = g.parameters;
        if (!p) return;
        const flat = (g.type === "PlaneGeometry" || g.type === "PlaneBufferGeometry") &&
          Math.abs(ob.rotation.x + Math.PI / 2) < 0.02;
        const slab = (g.type === "BoxGeometry" || g.type === "BoxBufferGeometry") &&
          p.height != null && p.height < 0.6 && p.width > 4 && p.depth > 4;
        if (!flat && !slab) return;
        if (ob.material.map._cbzGround) adopted++; else legacy++;
      });
    }
    return {
      kinds: GROUND_KINDS.length, calls: groundTexCalls,
      canvases: groundCanvases.size, adopted: adopted, legacy: legacy,
    };
  };

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
  let glassCalls = 0;              // adoption counter — see CBZ.glassPool()
  function glass(opts) {
    opts = opts || {};
    glassCalls++;
    const tint = opts.tint != null ? (opts.tint | 0) : GLASS_TINT;
    // `lift` is this factory's word for the underlight; `emissive` is the word
    // every OTHER factory here uses (mat/cmat/pbrMat all take opts.emissive),
    // and it is what ~15 vehicle call sites already type. Accepting it as an
    // alias is what let world/carfx.js hand a caller's own tuning straight
    // through instead of dropping it on the floor. `lift` still wins if both
    // are given, so no existing call site changes behaviour.
    const lift = opts.lift != null ? (opts.lift | 0)
      : (opts.emissive != null ? (opts.emissive | 0) : GLASS_LIFT);
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
  CBZ.GLASS_LIFT = GLASS_LIFT;
  // Live census of THE ONE GLASS, for CBZ.glassAudit() (world/carfx.js).
  // `variants` is how many DISTINCT panes the pool holds (a curtain wall, a
  // cockpit pane, a terminal window and a canopy are four different asks off
  // one recipe); `calls` is how often anything in the game asked for glass at
  // all. Both are the adoption signal: a variant count of 1 means only
  // buildings.js ever found this, which is where it started.
  CBZ.glassPool = function () {
    const mats = [];
    glassCache.forEach(function (m) { mats.push(m); });
    return { mats: mats, variants: mats.length, calls: glassCalls };
  };

  CBZ.mat = mat;
  CBZ.cmat = cmat;
  CBZ.pbrMat = pbrMat;
  CBZ.boxGeom = boxGeom;
  CBZ.addBox = addBox;
  CBZ.checkerTex = checkerTex;
  CBZ.concreteTex = concreteTex;
  CBZ.roadMat = roadMat;
})();
