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
    if (CBZ.ENV === undefined) CBZ.ENV = null;
    return;
  }

  const THREE = window.THREE;

  // REAL GLASS feature flag — one-line revert to the old opaque vehicle glass.
  if (CBZ.CONFIG && CBZ.CONFIG.VEHICLE_REAL_GLASS == null) CBZ.CONFIG.VEHICLE_REAL_GLASS = true;

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
      return shared("glass", function () {
        // REAL GLASS (owner ask): the ONE shared vehicle glass game-wide is now
        // genuinely transparent — a light smoke-blue automotive tint you can see
        // seats/occupants THROUGH (and the world through, from inside). Every
        // car greenhouse, canopy and airliner pane shares THIS instance, and
        // each vehicle merges its panes into ~one mesh, so the transparent-sort
        // cost is ~1 draw per vehicle (same class as the building panes).
        // COLOR STAYS INSIDE crashdeform.js's frost-glass detector window
        // (b - r > 0.045, b < 0.4, r < 0.25) so crash frosting keeps working.
        // Flag CBZ.CONFIG.VEHICLE_REAL_GLASS=false reverts to the opaque slab.
        const clear = !CBZ.CONFIG || CBZ.CONFIG.VEHICLE_REAL_GLASS !== false;
        return new THREE.MeshStandardMaterial({
          color: clear ? 0x1d3a4a : 0x10161c,
          metalness: num(opts.metalness, clear ? 0.55 : 0.9),
          roughness: num(opts.roughness, 0.07),
          envMap: CBZ.ENV || null,
          envMapIntensity: num(opts.envMapIntensity, 1.0),
          transparent: clear,
          opacity: clear ? 0.34 : 1,
          depthWrite: !clear,
        });
      });
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

  // ---- wire up exports + readiness backstops ------------------------------
  CBZ.buildVehicleEnv = buildVehicleEnv;
  CBZ.vehicleMat = vehicleMat;
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
