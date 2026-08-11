/* ============================================================
   world/carfx.js — vehicle-only PBR materials + a cheap fake-reflection
   environment map. Adds ~ZERO draw calls (it is materials + ONE prefiltered
   env texture); the city stays on Lambert (cmat) and is untouched.

   WHY a separate factory: the city is draw-call bound and Lambert ignores
   envMap, so giving CARS MeshStandardMaterial + a stylized PMREM env makes
   bodywork/glass/chrome read as reflective metal WITHOUT touching the
   thousands of static Lambert city meshes (setting scene.environment only
   affects Standard/Physical mats — i.e. only what this file makes).

   EXPORTS:
     CBZ.ENV          — a THREE.Texture (prefiltered PMREM cubemap-ish) used as
                        envMap on every reflective vehicle material. May be null
                        briefly before the renderer exists; back-filled lazily.
     CBZ.vehicleMat(role, color, opts) — see the role table below.
     CBZ.buildVehicleEnv()  — (idempotent) force the env to build if a renderer
                        is present; normally called for you.

   Renderer-readiness: the PMREM env REQUIRES a live WebGLRenderer. carfx.js is
   wired AFTER core/renderer.js so CBZ.renderer usually exists at load and the
   env builds eagerly. If it does NOT (headless / different load order), we
   DEFER: every created material is recorded in a registry, the env is retried
   on the first CBZ.vehicleMat() call that sees a renderer AND on a per-frame
   CBZ.onAlways hook, and once built we back-fill .envMap onto everything
   already made. Nothing here ever throws when the renderer/THREE is absent.

   Gate: set window.CBZ.VEHICLE_FX = false BEFORE this loads to disable — then
   CBZ.vehicleMat() falls back to plain Lambert (CBZ.cmat / CBZ.mat) so callers
   keep working and the recolor flag is still honoured.
============================================================ */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});

  // Default ON; honour an explicit opt-out set before this file loads.
  if (CBZ.VEHICLE_FX === false) {
    // Disabled path: still provide the contract so B/C agents don't break.
    // Fall back to the existing Lambert factory + honour the _bodyPaint flag.
    if (!CBZ.vehicleMat) {
      CBZ.vehicleMat = function (role, color, opts) {
        opts = opts || {};
        const cmat = CBZ.cmat || CBZ.mat;
        let m;
        if (role === "paint") {
          // fresh, recolourable
          m = (CBZ.mat || cmat)(color != null ? color : 0xb0b4ba, {
            emissive: 0x000000,
          });
          m._bodyPaint = true;
          return m;
        }
        if (role === "lightFront") return cmat(0x222018, { emissive: 0xfff2cc, ei: 1.15 });
        if (role === "lightTail") return cmat(0x220404, { emissive: 0xff2020, ei: 1.1 });
        const fallbackColor = {
          glass: 0x10161c, chrome: 0xc8ccd2, metal: 0xc8ccd2, rim: 0xb9bdc4,
          tire: 0x14161a, plastic: 0x1b1d20, interior: 0x0d0e10,
        }[role];
        return cmat(fallbackColor != null ? fallbackColor : (color != null ? color : 0xb0b4ba), {});
      };
    }
    CBZ.buildVehicleEnv = CBZ.buildVehicleEnv || function () {};
    // The audit is part of the contract too — a gate that calls it must not
    // throw just because vehicle FX are off. Nothing here is glass in the
    // material sense (the kill switch hands back opaque Lambert), so say so.
    CBZ.glassAudit = CBZ.glassAudit || function () {
      return { vehicleGlassMode: "fx-off", flagOn: false, oneGlassConsumers: 0, oneGlassCalls: 0,
        buildingGlassInPool: false, vehicleGlassVariants: 0, vehicleGlassTints: [], tintRefused: 0,
        tintInFrostWindow: true, frostMargin: null, worstTint: null,
        transparent: false, opacity: 1, doubleSided: false };
    };
    if (CBZ.ENV === undefined) CBZ.ENV = null;
    // taperBox is pure geometry, NOT a material/env concern — the six aircraft
    // builders call it unconditionally, so it must survive this kill switch too
    // (function declarations hoist, so the definition below is already bound).
    CBZ.taperBox = taperBox;
    return;
  }

  const THREE = window.THREE;

  // REAL GLASS feature flag — one-line revert to the old opaque vehicle glass.
  if (CBZ.CONFIG && CBZ.CONFIG.VEHICLE_REAL_GLASS == null) CBZ.CONFIG.VEHICLE_REAL_GLASS = true;
  // VEHICLE_GLASS_V2 — route the 'glass' role through CBZ.glass (materials.js),
  // i.e. the SAME material the city's curtain walls are made of. False falls all
  // the way back to the MeshStandardMaterial recipe below, byte for byte.
  if (CBZ.CONFIG && CBZ.CONFIG.VEHICLE_GLASS_V2 == null) CBZ.CONFIG.VEHICLE_GLASS_V2 = true;

  // Registry of EVERY material this factory has produced, so we can back-fill
  // .envMap once CBZ.ENV exists (and bump .needsUpdate to recompile shaders).
  const envClients = [];
  function registerForEnv(mat) {
    if (mat) envClients.push(mat);
    return mat;
  }
  function applyEnv(mat) {
    if (mat && CBZ.ENV && "envMap" in mat) {
      mat.envMap = CBZ.ENV;
      if (mat.envMapIntensity == null) mat.envMapIntensity = 1.0;
      mat.needsUpdate = true;
    }
  }
  function backfillEnv() {
    if (!CBZ.ENV) return;
    for (let i = 0; i < envClients.length; i++) applyEnv(envClients[i]);
  }

  // ---- the stylized 2-stop gradient sky used to bake the env map ----------
  // Sky-bright top -> ground-dark bottom. Cheap, deterministic, no assets.
  function gradientCanvas() {
    const c = document.createElement("canvas");
    c.width = 8;
    c.height = 256; // tall + thin: it's a vertical gradient, sampled equirect-style
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0.0, "#9fc4ff"); // sky-bright top
    grad.addColorStop(0.45, "#7d96bf"); // horizon-ish midband
    grad.addColorStop(0.55, "#5b5560");
    grad.addColorStop(1.0, "#35303a"); // ground-dark bottom
    g.fillStyle = grad;
    g.fillRect(0, 0, 8, 256);
    return c;
  }

  // Build a tiny Scene whose backdrop IS the gradient, then PMREM-prefilter it
  // into a roughness-aware env texture. One texture, reused by every car mat.
  let envBuilding = false;
  function buildVehicleEnv() {
    if (CBZ.ENV) return CBZ.ENV; // idempotent
    if (envBuilding) return null;
    if (!THREE || !CBZ.renderer) return null; // defer — no live renderer yet
    if (!THREE.PMREMGenerator || !THREE.CanvasTexture || !THREE.Scene) return null;
    envBuilding = true;
    try {
      const tex = new THREE.CanvasTexture(gradientCanvas());
      if (THREE.EquirectangularReflectionMapping) tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.needsUpdate = true;

      const envScene = new THREE.Scene();
      envScene.background = tex;

      const pmrem = new THREE.PMREMGenerator(CBZ.renderer);
      // compileEquirectangularShader avoids a first-frame stall on r128.
      if (pmrem.compileEquirectangularShader) pmrem.compileEquirectangularShader();
      const rt = pmrem.fromScene(envScene); // r128: returns a WebGLRenderTarget
      CBZ.ENV = rt.texture;

      // gradient source no longer needed; PMREM holds the baked result
      tex.dispose();
      pmrem.dispose();

      // Bake into scene.environment too (only Standard/Physical mats react,
      // i.e. the vehicle mats — Lambert city is unaffected, by design).
      if (CBZ.scene && CBZ.scene.environment == null) CBZ.scene.environment = CBZ.ENV;

      backfillEnv();
    } catch (e) {
      // Never throw out of a foundation module. Leave ENV null; retried later.
      CBZ.ENV = CBZ.ENV || null;
    } finally {
      envBuilding = false;
    }
    return CBZ.ENV;
  }

  // ---- shared material cache (one instance per role; NEVER for 'paint') ----
  const sharedCache = new Map();
  function shared(role, make) {
    let m = sharedCache.get(role);
    if (!m) {
      m = make();
      m._shared = true; // clearers must never dispose these
      sharedCache.set(role, m);
      registerForEnv(m);
      applyEnv(m); // in case ENV already exists
    }
    return m;
  }

  function num(v, d) { return typeof v === "number" ? v : d; }

  // ---- VEHICLE GLASS: the tint law and the emissive floor ------------------
  //
  //  THE TINT IS NOT A FREE CHOICE. city/crashdeform.js recognises "this mesh
  //  is a window, craze it after a crash" by pure colour arithmetic — there is
  //  no flag, no userData, no registry, just isGlassMat():
  //
  //        b - r > 0.045   &&   b < 0.4   &&   r < 0.25        (0..1 channels)
  //
  //  so a tint outside that box silently kills crash frosting for whatever
  //  wears it, and nothing anywhere reports it. The default below sits well
  //  inside on all three sides:
  //
  //    0x24435a → r 36/255 = .1412 · g 67/255 = .2627 · b 90/255 = .3529
  //      b - r = .2118 ✓ (clears by .167)
  //      b     = .3529 ✓ (clears by .047)
  //      r     = .1412 ✓ (clears by .109)
  //
  //  Every shipped caller tint clears it too, but only just in one case —
  //  island_airport's 0x10161c clears b-r by .0021 — so a tint that FAILS is
  //  refused here and swapped for the default rather than being drawn and
  //  quietly un-frostable. CBZ.glassAudit() re-runs this arithmetic against
  //  the LIVE materials, so the day somebody nudges a canopy toward grey the
  //  number moves instead of the behaviour.
  const GLASS_TINT_VEH = 0x24435a;
  const GLASS_OPACITY = 0.35;
  //  THE UNDERLIGHT IS A FLOOR, NOT A SETTING. Real glass never goes fully
  //  dark — it is always bouncing some sky back at you — and that emissive lift
  //  is the entire reason the city's curtain walls read as glass instead of as
  //  tinted cellophane (materials.js's own note). A canopy without it is a
  //  black void the moment the sun sets, which is most of what the owner was
  //  looking at. This is buildings.js's EXACT lift hex at 0.36 of its strength:
  //  a windscreen is a little over half the density of a curtain wall (0.35 vs
  //  0.60 opacity), so the same lift at full power would frost it. A caller may
  //  ask for MORE (per-channel max, below); it may not ask for less.
  const GLASS_LIFT_VEH = 0x3f8aa6, GLASS_LIFT_EI = 0.36;

  const vehGlass = [];          // every vehicle-glass material minted, for the audit
  let glassTintRefused = 0;     // caller tints rejected by the frost window

  function frostOk(hex) {
    const r = ((hex >> 16) & 255) / 255, b = (hex & 255) / 255;
    return (b - r > 0.045) && (b < 0.4) && (r < 0.25);
  }
  function glassTint(color) {
    const hex = color != null ? ((color | 0) & 0xffffff) : GLASS_TINT_VEH;
    if (frostOk(hex)) return hex;
    glassTintRefused++;
    return GLASS_TINT_VEH;
  }
  // Fold a caller's { emissive, ei } into the floor. The caller's lift is first
  // rescaled into the floor's intensity (so ei is comparable), then taken
  // per channel against the floor — brighter wins, darker is ignored. Result is
  // one hex to hand CBZ.glass at GLASS_LIFT_EI, so the common case (no caller
  // emissive) is the building lift EXACTLY, with no rounding.
  function glassLift(opts) {
    const em = opts.emissive != null ? ((opts.emissive | 0) & 0xffffff) : 0;
    if (!em) return GLASS_LIFT_VEH;
    const k = (opts.ei != null ? +opts.ei : 1) / GLASS_LIFT_EI;
    let out = 0;
    for (let s = 16; s >= 0; s -= 8) {
      const floor = (GLASS_LIFT_VEH >> s) & 255;
      const want = Math.min(255, Math.round(((em >> s) & 255) * k));
      out |= (want > floor ? want : floor) << s;
    }
    return out;
  }

  // ---- the public factory --------------------------------------------------
  // role table (B and C agents depend on this exact contract):
  //   'paint'      FRESH MeshStandardMaterial per call, _bodyPaint=true,
  //                metalness .55 / roughness .38 / flatShading, subtle emissive
  //   'glass'      SHARED dark reflective, opaque (no transparent sort cost)
  //   'chrome'/'metal' SHARED bright metal
  //   'rim'        SHARED alloy
  //   'tire'       SHARED matte rubber (no envMap)
  //   'lightFront' SHARED emissive warm white
  //   'lightTail'  SHARED emissive red
  //   'plastic'    SHARED dark matte (slight env)
  //   'interior'   SHARED very dark matte (no envMap)
  // opts may override { roughness, metalness, emissiveIntensity }.
  function vehicleMat(role, color, opts) {
    opts = opts || {};

    // Headless / THREE missing: hand back a harmless object so callers don't
    // crash. (In the real game THREE is always present here.)
    if (!THREE || !THREE.MeshStandardMaterial) {
      const cmat = CBZ.cmat;
      if (cmat) {
        const m = cmat(color != null ? color : 0xb0b4ba, {});
        if (role === "paint") { const mm = (CBZ.mat || cmat)(color != null ? color : 0xb0b4ba, {}); mm._bodyPaint = true; return mm; }
        return m;
      }
      return {};
    }

    // Opportunistically build the env the moment a renderer is available.
    if (!CBZ.ENV) buildVehicleEnv();

    if (role === "paint") {
      // ALWAYS fresh — per-car recolor clones the FIRST instance, but each
      // vehicle template gets its own paint material to recolour independently.
      const col = color != null ? color : 0xb0b4ba;
      const m = new THREE.MeshStandardMaterial({
        color: col,
        metalness: num(opts.metalness, 0.55),
        roughness: num(opts.roughness, 0.38),
        flatShading: true,
        envMap: CBZ.ENV || null,
        envMapIntensity: num(opts.envMapIntensity, 1.0),
      });
      // subtle self-glow so paint doesn't go black in shadow (recolorBody also
      // expects an .emissive to exist — it sets it to color*0.16 on the clone).
      m.emissive = new THREE.Color(col).multiplyScalar(0.04);
      m.emissiveIntensity = num(opts.emissiveIntensity, 1.0);
      m._bodyPaint = true; // <-- EXACT flag matched from playercars.js recolorBody
      registerForEnv(m); // back-fill envMap if ENV builds after this
      return m;
    }

    if (role === "glass") {
      // ==========================================================
      //  VEHICLE GLASS **IS** THE ONE GLASS.
      //
      //  OWNER: "a huge thing is the plane cockpit doesn't have windows like
      //  buildings that you see through."
      //
      //  It already WAS transparent (VEHICLE_REAL_GLASS, opacity .34) and it
      //  still read as a black slab, because transparency was never the fault.
      //  The fault was the material TYPE. This branch built a
      //  MeshStandardMaterial whose only light was CBZ.ENV — an 8x256 grey-blue
      //  gradient — with NO emissive at all, inside a world lit for Lambert.
      //  city/buildings.js wrote the post-mortem before this file ever made the
      //  mistake: "r128 has no PMREM/envMap reflection that works under a
      //  Lambert world (MeshStandard+envMap renders near-black)". The curtain
      //  wall the owner is comparing against is Lambert + an emissive lift, and
      //  the lift is the whole trick. So the canopy now asks for the SAME
      //  OBJECT OUT OF THE SAME POOL — not a lookalike.
      //
      //  Two more defects died with it, both invisible, both at every call site:
      //    • every caller passed { emissive, ei } — the repo-wide mat
      //      convention — and this branch read NEITHER. Dead tuning in
      //      aircraft.js, playeraircraft.js, playercars.js, vehicles.js,
      //      island_military.js and water_hulls.js alike. It is honoured now
      //      (as a floor: see glassLift).
      //    • shared() keyed the cache on the bare string "glass", so whichever
      //      vehicle happened to be built FIRST chose the pane for the airliner,
      //      the gunship, the bomber, every car and every boat at once. The key
      //      is role+resolved tint now, so the bomber's 0x2a3b4d and the police
      //      gunship's 0x121b22 are finally two different windows.
      //
      //  DoubleSide is not a preference: a camera can sit BEHIND this pane
      //  (cockpit_shapes.js says the same thing about its own glazing), and a
      //  FrontSide canopy is simply absent from the pilot's seat. depthWrite
      //  follows CBZ.glass's own rule for a double-sided pane — off, so a
      //  canopy cannot sort in front of its own instrument panel.
      //
      //  Batch-safe: still transparent, and core/batch.js refuses anything
      //  transparent (mergeableKeyV2) AND anything with a non-zero emissive, so
      //  the merge set cannot move. Deliberately NOT registered for the envMap
      //  back-fill — r128's Lambert envMap is a reflection COMBINE against a
      //  non-PMREM lookup, i.e. exactly the near-black this change removes.
      // ==========================================================
      const clear = !CBZ.CONFIG || CBZ.CONFIG.VEHICLE_REAL_GLASS !== false;
      const v2 = !CBZ.CONFIG || CBZ.CONFIG.VEHICLE_GLASS_V2 !== false;
      const tint = glassTint(color);
      if (v2 && clear && CBZ.glass) {
        const m = CBZ.glass({
          tint: tint,
          lift: glassLift(opts),
          ei: GLASS_LIFT_EI,
          opacity: num(opts.opacity, GLASS_OPACITY),
          // opts.side wins if a builder really means FrontSide; `double:false`
          // is NOT honoured, because the two call sites that pass `double` pass
          // it TRUE and the ones that omit it are the cockpits that need it most.
          side: opts.side != null ? (opts.side | 0) : THREE.DoubleSide,
          fog: opts.fog !== false,
        });
        if (vehGlass.indexOf(m) < 0) vehGlass.push(m);
        return m;
      }
      // LEGACY (flag off, or materials.js stripped): the MeshStandard recipe
      // that shipped before, with the cache-key bug fixed anyway so a revert
      // does not also revert every vehicle back to one shared tint.
      const m = shared("glass|" + tint, function () {
        return new THREE.MeshStandardMaterial({
          color: clear ? tint : 0x10161c,
          metalness: num(opts.metalness, clear ? 0.55 : 0.9),
          roughness: num(opts.roughness, 0.07),
          envMap: CBZ.ENV || null,
          envMapIntensity: num(opts.envMapIntensity, 1.0),
          transparent: clear,
          opacity: clear ? 0.34 : 1,
          depthWrite: !clear,
        });
      });
      if (vehGlass.indexOf(m) < 0) vehGlass.push(m);
      return m;
    }

    if (role === "chrome" || role === "metal") {
      return shared("chrome", function () {
        return new THREE.MeshStandardMaterial({
          color: 0xc8ccd2,
          metalness: num(opts.metalness, 0.95),
          roughness: num(opts.roughness, 0.22),
          envMap: CBZ.ENV || null,
          envMapIntensity: num(opts.envMapIntensity, 1.0),
        });
      });
    }

    if (role === "rim") {
      return shared("rim", function () {
        return new THREE.MeshStandardMaterial({
          color: 0xb9bdc4,
          metalness: num(opts.metalness, 0.85),
          roughness: num(opts.roughness, 0.3),
          envMap: CBZ.ENV || null,
          envMapIntensity: num(opts.envMapIntensity, 1.0),
        });
      });
    }

    if (role === "tire") {
      return shared("tire", function () {
        // matte rubber — no envMap (rubber barely reflects; saves the lookup)
        return new THREE.MeshStandardMaterial({
          color: 0x14161a,
          metalness: num(opts.metalness, 0.0),
          roughness: num(opts.roughness, 0.95),
        });
      });
    }

    if (role === "lightFront") {
      return shared("lightFront", function () {
        return new THREE.MeshStandardMaterial({
          color: 0x222018,
          emissive: 0xfff2cc,
          emissiveIntensity: num(opts.emissiveIntensity, 1.15),
          metalness: 0.0,
          roughness: 0.4,
        });
      });
    }

    if (role === "lightTail") {
      return shared("lightTail", function () {
        return new THREE.MeshStandardMaterial({
          color: 0x220404,
          emissive: 0xff2020,
          emissiveIntensity: num(opts.emissiveIntensity, 1.1),
          metalness: 0.0,
          roughness: 0.4,
        });
      });
    }

    if (role === "plastic") {
      return shared("plastic", function () {
        return new THREE.MeshStandardMaterial({
          color: 0x1b1d20,
          metalness: num(opts.metalness, 0.1),
          roughness: num(opts.roughness, 0.72),
          envMap: CBZ.ENV || null,
          envMapIntensity: num(opts.envMapIntensity, 1.0),
        });
      });
    }

    if (role === "interior") {
      return shared("interior", function () {
        // very dark matte cabin — no envMap (it's enclosed; reflection unseen)
        return new THREE.MeshStandardMaterial({
          color: 0x0d0e10,
          metalness: num(opts.metalness, 0.0),
          roughness: num(opts.roughness, 0.85),
        });
      });
    }

    // Unknown role: safe generic painted-ish surface so callers never get null.
    const col = color != null ? color : 0xb0b4ba;
    const gm = new THREE.MeshStandardMaterial({
      color: col,
      metalness: num(opts.metalness, 0.2),
      roughness: num(opts.roughness, 0.6),
      envMap: CBZ.ENV || null,
      envMapIntensity: num(opts.envMapIntensity, 1.0),
    });
    return registerForEnv(gm);
  }

  // ---- SHARED VEHICLE/AIRCRAFT GEOMETRY SCULPTOR ---------------------------
  //  taperBox() was hand-copied into SIX builders (aircraft.js, airtraffic.js,
  //  island_military.js, playerair.js, playeraircraft.js, strategic.js). Five
  //  copies were byte-identical; the sixth differed only in variable names and
  //  comments — same math, same defaults, same return. Verified by extracting
  //  each brace-matched body and diffing (2026-07-26 duplication census), then
  //  collapsed here. carfx.js is the natural home: it is already the shared
  //  vehicle-construction module (CBZ.vehicleMat/CBZ.ENV) and it loads at
  //  index.html:344, well before every consumer (585-739), so the handle always
  //  exists by the time a builder runs.
  //
  //  Scales each vertex's X/Y by a factor that depends on its Z (nose=+Z → nz,
  //  tail=-Z → tz), with optional roofline (top) / keel (bot) narrowing.
  //  Returns a BoxGeometry; callers flag it _shared so the cache disposer
  //  leaves it alone. Pure function of its arguments — no external state.
  function taperBox(w, h, d, opt) {
    opt = opt || {};
    // Resolve THREE off window, NOT the module-scoped `const THREE` below: on
    // the CBZ.VEHICLE_FX === false kill-switch path this function is exported
    // before that const is ever evaluated, so touching it would throw a
    // temporal-dead-zone ReferenceError. (Verified by executing both paths.)
    const T = window.THREE;
    const nz = opt.nz != null ? opt.nz : 1, tz = opt.tz != null ? opt.tz : 1;
    const top = opt.top != null ? opt.top : 1, bot = opt.bot != null ? opt.bot : 1;
    const geo = new T.BoxGeometry(w, h, d, opt.segW || 2, opt.segH || 2, opt.segD || 6);
    const pos = geo.attributes.position, hd = d / 2, hh = h / 2;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const f = z / hd, zt = f >= 0 ? (1 + (nz - 1) * f) : (1 + (tz - 1) * -f);
      let sx = zt, sy = zt;
      const vy = hh > 0 ? y / hh : 0;
      if (vy > 0) sx *= (1 + (top - 1) * vy);
      if (vy < 0) sx *= (1 + (bot - 1) * -vy);
      pos.setX(i, x * sx); pos.setY(i, y * sy);
    }
    pos.needsUpdate = true; geo.computeVertexNormals();
    return geo;
  }

  // ---- CBZ.glassAudit() ----------------------------------------------------
  //  Two questions, both answered off the LIVE materials rather than off the
  //  constants above — the constants cannot lie, but a caller's tint can.
  //
  //  (1) IS VEHICLE GLASS ACTUALLY THE ONE GLASS? `vehicleGlassMode` reads
  //      "one-glass" only when the material a vehicle is really wearing is the
  //      Lambert pane out of materials.js's pool. `oneGlassConsumers` is that
  //      pool's size: DISTINCT panes minted game-wide (a curtain wall, a
  //      cockpit pane, a terminal window and a canopy are four different asks
  //      off one recipe). It started at 1 — buildings.js was the only file that
  //      could reach the recipe at all — so this number is the adoption ratchet
  //      and may only ever go UP.
  //
  //  (2) CAN A CRASH STILL FROST IT? city/crashdeform.js finds windows by pure
  //      colour arithmetic and by nothing else, so a tint change is a silent
  //      way to delete crash frosting from the whole game. Every vehicle glass
  //      material ever minted is re-tested here against that exact window;
  //      `frostMargin` is how much slack the WORST of them has left (metres of
  //      nothing — it is a 0..1 colour margin; negative means broken).
  //      `tintInFrostWindow` is the hard invariant and must stay true.
  function glassAudit() {
    const pool = (CBZ.glassPool ? CBZ.glassPool() : null) || { mats: [], variants: 0, calls: 0 };
    let buildingGlass = false;
    for (let i = 0; i < pool.mats.length; i++) {
      const c = pool.mats[i] && pool.mats[i].color;
      if (c && c.getHex && c.getHex() === ((CBZ.GLASS_TINT | 0) & 0xffffff)) buildingGlass = true;
    }
    let inWindow = true, worst = null, worstMargin = null;
    const tints = [];
    for (let i = 0; i < vehGlass.length; i++) {
      const m = vehGlass[i];
      if (!m || !m.color) continue;
      const r = m.color.r, b = m.color.b;
      // the three clearances of crashdeform.js's isGlassMat, smallest wins
      const margin = Math.min(b - r - 0.045, 0.4 - b, 0.25 - r);
      const hex = "0x" + m.color.getHexString();
      if (tints.indexOf(hex) < 0) tints.push(hex);
      if (margin <= 0) inWindow = false;
      if (worstMargin == null || margin < worstMargin) { worstMargin = margin; worst = hex; }
    }
    const first = vehGlass[0] || null;
    return {
      vehicleGlassMode: !first ? "unbuilt"
        : (first.isMeshLambertMaterial ? "one-glass" : "legacy-standard"),
      flagOn: !CBZ.CONFIG || CBZ.CONFIG.VEHICLE_GLASS_V2 !== false,
      oneGlassConsumers: pool.variants,     // distinct panes in THE ONE GLASS pool
      oneGlassCalls: pool.calls,            // how often anything asked for glass
      buildingGlassInPool: buildingGlass,   // the curtain wall and the canopy share a pool
      vehicleGlassVariants: vehGlass.length,
      vehicleGlassTints: tints,
      tintRefused: glassTintRefused,        // caller tints the frost window rejected
      tintInFrostWindow: inWindow,
      frostMargin: worstMargin == null ? null : +worstMargin.toFixed(4),
      worstTint: worst,
      transparent: !!(first && first.transparent),
      opacity: first ? first.opacity : null,
      doubleSided: !!(first && THREE && first.side === THREE.DoubleSide),
    };
  }

  // ---- wire up exports + readiness backstops ------------------------------
  CBZ.buildVehicleEnv = buildVehicleEnv;
  CBZ.vehicleMat = vehicleMat;
  CBZ.glassAudit = glassAudit;
  CBZ.taperBox = taperBox;
  if (CBZ.ENV === undefined) CBZ.ENV = null;

  // Try once at load (renderer usually already exists here).
  buildVehicleEnv();

  // Per-frame backstop: if the renderer wasn't ready at load, build the env on
  // the first frame it IS, then back-fill, then stop trying. Cheap no-op once
  // built. Guarded so headless (no onAlways) still loads fine.
  if (!CBZ.ENV && typeof CBZ.onAlways === "function") {
    let tries = 0;
    CBZ.onAlways(1, function () {
      if (CBZ.ENV) return; // done
      if (tries++ > 600) return; // give up after ~a few seconds; stay graceful
      buildVehicleEnv();
    });
  }
})();
