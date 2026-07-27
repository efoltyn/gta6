/* ============================================================
   city/island_military.js — THE MILITARY BASE ISLAND.

   A walled army installation off the mainland's west edge, joined
   by a single guarded causeway. WHY each thing exists (owner's
   #1 law — no prop without an in-world reason):

     • CAUSEWAY + CHECKPOINT — a base is SEALED; there is exactly
       one way on or off (the bridge), and a manned gate decides
       who passes. Drive in, the barrier + guard shack + soldiers
       are the reason you slow down. The perimeter FENCE makes the
       gate matter (you can't just walk in over open ground).
     • AIRSTRIP w/ parked JETS + a BOMBER — this is an AIR base;
       the runway and the hardware on it are why it's here.
     • HELIPADS w/ HELICOPTERS — rotary wing alongside fixed wing.
     • MOTOR POOL of TANKS + armored trucks — the ground fleet,
       lined up the way real motor pools stage vehicles.
     • HANGARS — enterable sheds that shelter/repair the aircraft.
     • BARRACKS — soldiers have to sleep somewhere.
     • COMMAND HQ w/ ARMORY — the brain of the base, and the one
       reason a player WALKS in: the armory ("Browse the armory").
     • WATCHTOWERS / SANDBAG BUNKERS / radar / fuel / flag — the
       texture of a base that's actively defended.

   ENGINE CONTRACT: registers as an archipelago landmass (see
   worldmap.js). Every parked machine is a solid collider so it
   reads as real and blocks movement. Repeats (fence posts, parade
   formation, sandbags) are InstancedMesh / merged geometry on a
   single shared material — draw-call frugal, as the engine demands.
   Plain IIFE, window.CBZ, THREE r128, no build step.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  // ---- FOOTPRINT (owner-specified) ---------------------------------------
  const _WOFF = (CBZ.worldOff && CBZ.worldOff("military")) || { dx: 0, dz: 0 };   // world-layout dial (zero today)
  const CEN_X = -620 + _WOFF.dx, CEN_Z = -700 + _WOFF.dz;    // base centre
  const HX = 240, HZ = 250;                   // half-extents
  const MINX = CEN_X - HX, MAXX = CEN_X + HX; // -860 .. -380
  const MINZ = CEN_Z - HZ, MAXZ = CEN_Z + HZ; // -950 .. -450

  // causeway deck (drivable bridge, widened to the 24m highway) from the
  // mainland west edge to the base gate. z-span = 24m about the centreline.
  // Island end = the base's east edge (tracks the world-layout dial); the
  // MAINLAND end stays pinned at the authored shore point x=-133 — moving
  // the island only stretches the deck, it never detaches either shore.
  const CW_MINX = MAXX, CW_MAXX = -133;
  const CW_MINZ = CEN_Z - 12, CW_MAXZ = CEN_Z + 12;
  const CW_CZ = (CW_MINZ + CW_MAXZ) / 2;      // == CEN_Z, lines up with the base gate

  // ---- local seeded RNG (owner rule: deterministic world) ----------------
  // seeded from CBZ.WORLD_SEED via the named-stream registry (core/seed.js)
  let rng = null;
  function armRng() { rng = CBZ.seedStream ? CBZ.seedStream("military") : (function () { let s = 0x5eed ^ 0x4d494c54; return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })(); }
  armRng();
  function rr(a, b) { return a + rng() * (b - a); }

  // ---- shared material palette (one material per colour, reused) ----------
  // cmat() is the engine's CACHED-material factory: identical colour → same
  // material instance → the batcher can collapse draw calls.
  const M = {
    tarmac: 0x33373b, dirt: 0x6b5d44, runway: 0x2c2f33, paint: 0xd8d8c8,
    olive: 0x4a5238, oliveD: 0x3a4230, oliveL: 0x5c6648, steel: 0x5a6068,
    steelD: 0x3c4046, tire: 0x14161a, glassDark: 0x223044, jetGrey: 0x77808a,
    jetGreyD: 0x5a626b, canopy: 0x2a3b4d, sand: 0xb6a373, sandbag: 0x9a8a5e,
    fence: 0x9aa0a6, fenceP: 0x6a7077, fuel: 0x7d8a6a, red: 0xb43a32,
    warn: 0xd4a017, dark: 0x202327, hangarRoof: 0x6e7682, flagRed: 0xc0392b,
    flagWhite: 0xecf0f1, flagBlue: 0x2c3e6b,
  };
  function cm(hex, opts) { return CBZ.cmat ? CBZ.cmat(hex, opts) : CBZ.mat(hex, opts); }
  function bg(w, h, d) { return CBZ.boxGeom ? CBZ.boxGeom(w, h, d) : new THREE.BoxGeometry(w, h, d); }

  // place a box mesh under `parent` (local coords). Optionally a world collider.
  function box(parent, x, y, z, w, h, d, hex, opts) {
    opts = opts || {};
    const m = new THREE.Mesh(bg(w, h, d), cm(hex, opts.matOpts));
    m.position.set(x, y, z);
    m.castShadow = opts.cast !== false;
    m.receiveShadow = opts.receive !== false;
    parent.add(m);
    return m;
  }
  // a vertical-span world collider (engine AABB). wx/wz are WORLD coords.
  // Returns the collider object so callers can keep a handle to it (a stolen
  // vehicle must take its parked collider WITH it — see placeModel).
  function col(wx, wz, w, d, y0, y1, ref) {
    const c = { minX: wx - w / 2, maxX: wx + w / 2, minZ: wz - d / 2, maxZ: wz + d / 2, y0: y0 || 0, y1: y1 == null ? 0 : y1, ref: ref || null };
    CBZ.colliders.push(c);
    return c;
  }
  // cylinder (barrels, rotors, fuel tanks, gun barrels) — fresh geo (few used).
  function cyl(parent, x, y, z, rt, rb, h, hex, seg) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 12), cm(hex));
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m);
    return m;
  }

  // ---- vehicle-detail helpers (the "look at all vehicles" pass) ------------
  // NEW MATERIAL API (world/carfx.js loads before the islands): military hulls
  // stay deliberately MATTE Lambert (army paint doesn't gleam) — vehicleMat is
  // only for the accents that SHOULD catch light: canopy glass, gun steel,
  // rubber. All three roles are shared carfx singletons → zero extra material
  // cost per vehicle. Falls back to flat Lambert when carfx is absent.
  function vmat(role, fallbackHex) {
    if (CBZ.vehicleMat) {
      try { const m = CBZ.vehicleMat(role); if (m && m.isMaterial) return m; } catch (e) {}
    }
    return cm(fallbackHex != null ? fallbackHex : M.dark);
  }
  // box/cylinder with an EXPLICIT material (glass, gun steel, rubber)
  function mbox(parent, x, y, z, w, h, d, material) {
    const m = new THREE.Mesh(bg(w, h, d), material);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m);
    return m;
  }
  function mcyl(parent, x, y, z, rt, rb, h, material, seg) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 12), material);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m);
    return m;
  }
  // small static emissive marker (wingtip nav lights) — cached per colour.
  function navBox(parent, x, y, z, s, hex) {
    return box(parent, x, y, z, s, s, s, hex, { matOpts: { emissive: hex, ei: 0.9 }, cast: false });
  }

  // ONE reusable rocket exhaust component for every propelled machine in the
  // game.  The military fighter defines it early; playeraircraft.js and the
  // chop-shop booster consume the same geometry/power contract later.  A hot
  // white core, translucent orange envelope, shock diamonds and nozzle light
  // replace the old single opaque cone while keeping the cheap primitive look.
  if (!CBZ.createRocketPlume) {
    CBZ.createRocketPlume = function (opts) {
      opts = opts || {};
      const grp = new THREE.Group();
      grp.name = opts.name || "rocket-exhaust";
      grp.rotation.x = -Math.PI / 2; // local +Y extends aft along world/local -Z
      const outerMat = new THREE.MeshBasicMaterial({
        color: opts.outer == null ? 0xff7a24 : opts.outer,
        transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide,
      });
      const coreMat = new THREE.MeshBasicMaterial({
        color: opts.core == null ? 0xfff4c7 : opts.core,
        transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      // Base stays exactly on the nozzle; scaling Y only lengthens aft.
      const outerGeo = new THREE.ConeGeometry(0.34, 1, 12, 1, true); outerGeo.translate(0, 0.5, 0);
      const coreGeo = new THREE.ConeGeometry(0.16, 0.72, 10, 1, true); coreGeo.translate(0, 0.36, 0);
      const outer = new THREE.Mesh(outerGeo, outerMat), core = new THREE.Mesh(coreGeo, coreMat);
      grp.add(outer); grp.add(core);
      const diamonds = [];
      for (let i = 0; i < 3; i++) {
        const d = new THREE.Mesh(new THREE.OctahedronGeometry(0.12 - i * 0.018, 0), coreMat);
        d.position.y = 0.24 + i * 0.23; d.scale.y = 1.7; grp.add(d); diamonds.push(d);
      }
      const light = new THREE.PointLight(opts.light == null ? 0xff8a35 : opts.light, 0, opts.lightRange || 9, 2);
      light.position.y = 0.08; grp.add(light);
      grp.visible = false;
      grp.userData.rocketPlume = true;
      grp.userData.outer = outer; grp.userData.core = core; grp.userData.diamonds = diamonds;
      grp.userData.outerMaterial = outerMat; grp.userData.coreMaterial = coreMat; grp.userData.light = light;
      return grp;
    };
    CBZ.setRocketPlume = function (grp, power, time, lengthMul, radiusMul) {
      if (!grp || !grp.userData || !grp.userData.rocketPlume) return false;
      power = Math.max(0, Math.min(1, +power || 0));
      grp.visible = power > 0.015;
      const u = grp.userData;
      if (!grp.visible) {
        u.outerMaterial.opacity = 0; u.coreMaterial.opacity = 0; u.light.intensity = 0;
        return true;
      }
      time = +time || 0;
      const flick = 0.94 + Math.sin(time * 37) * 0.045 + Math.sin(time * 71) * 0.018;
      const len = (0.42 + power * 1.58) * flick * (lengthMul || 1);
      const rad = (0.62 + power * 0.42) * (radiusMul || 1);
      grp.scale.set(rad, len, rad);
      u.outerMaterial.opacity = 0.18 + power * 0.48;
      u.coreMaterial.opacity = 0.34 + power * 0.62;
      for (let i = 0; i < u.diamonds.length; i++) {
        const d = u.diamonds[i];
        d.scale.x = d.scale.z = 0.82 + Math.sin(time * 46 + i * 1.7) * 0.12;
      }
      u.light.intensity = 0.35 + power * 2.8;
      return true;
    };
  }
  // SHAPE HELPERS (r128 idiom — sculpt the position attribute, recompute
  // normals; same pattern as aircraft.js taperBox/bladeGeo). Fully constant
  // per inputs → deterministic worlds.
  // taperBox: scales each vertex's X/Y by a factor of its Z (nose=+Z → nz,
  // tail=-Z → tz) with optional roofline (top) / keel (bot) narrowing.
  // taperBox lives ONCE in world/carfx.js now (was copied into 6 builders).
  function taperBox(w, h, d, opt) { return CBZ.taperBox(w, h, d, opt); }
  // sculpted taperBox mesh (fuselage fairings, canopies, hulls)
  function tbox(parent, x, y, z, w, h, d, opt, material) {
    const m = new THREE.Mesh(taperBox(w, h, d, opt), material);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m);
    return m;
  }
  // WING slab rooted at the fuselage flank, reaching outboard along ±X
  // (side −1/+1): as a vertex goes outboard (t 0→1) the chord narrows (taper),
  // shifts rearward (sweep), the slab thins (thin) and optionally droops
  // (rotor blades). Root edge sits AT the mesh position → bury it in the hull.
  function wingGeo(side, span, chord, thick, sweep, taper, thin, droop) {
    const geo = new THREE.BoxGeometry(span, thick, chord, 6, 1, 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), t = (x + span / 2) / span;    // 0 root → 1 tip
      pos.setX(i, side * (x + span / 2));                  // root edge at x=0
      pos.setZ(i, pos.getZ(i) * (1 - (taper || 0) * t) - (sweep || 0) * t);
      pos.setY(i, pos.getY(i) * (1 - (thin || 0) * t) - (droop || 0) * t * t);
    }
    pos.needsUpdate = true; geo.computeVertexNormals();
    return geo;
  }
  function wing(parent, x, y, z, side, span, chord, thick, sweep, taper, thin, hexOrMat, droop) {
    const mat = (hexOrMat && hexOrMat.isMaterial) ? hexOrMat : cm(hexOrMat);
    const m = new THREE.Mesh(wingGeo(side, span, chord, thick, sweep, taper, thin, droop), mat);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m);
    return m;
  }

  // ========================================================================
  //   REUSABLE LOW-POLY MILITARY MODEL FUNCTIONS
  //   Each returns a THREE.Group, built from boxes/cylinders on shared
  //   materials. Caller positions/rotates it and registers the collider.
  //   (Research idiom: low-poly hardware = primitives only, no external mesh.)
  // ========================================================================

  // FIGHTER JET — sculpted swept/tapered wings (position-attribute wing slabs,
  // not rotation-faked boxes), glass canopy, intake trunks, twin canted fins,
  // FULL LANDING GEAR (the old jet had none and sat on its belly) and wingtip
  // nav lights. ~12.5m long, nose +Z, parked on its wheels at y=0.
  // returns {group, footW, footL, height} for collider sizing.
  function makeJet() {
    const g = new THREE.Group();
    const cy = 1.15;                                        // body centreline (on gear)
    const GLASS = vmat("glass", M.canopy), GUN = vmat("plastic", M.dark), RUBBER = vmat("tire", M.tire);
    const RIM = vmat("rim", 0xb9bdc4), TRIM = vmat("interior", 0x0d0e10);
    const SKIN = cm(M.jetGrey), SKIND = cm(M.jetGreyD), STORE = cm(0xd4d9df);

    // ---- LOFT ---------------------------------------------------------------
    // Skin a chain of cross-sections (each a ring of [x,y] in its own section
    // plane) laid out along Z, NOSE FIRST. Rings wind CCW seen from +Z so every
    // quad faces outward, and the result is de-indexed before computing normals
    // so each facet shades FLAT. That flat shading is the whole point: it is what
    // makes a CHINE read as a knife edge instead of a soft bulge, and it is why
    // this jet no longer needs a cone stuck on the front. Pure function of its
    // arguments (no rng, no external state) → determinism-safe.
    function loft(rings, mat) {
      const n = rings[0].p.length, m = rings.length, pos = [], idx = [];
      for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) pos.push(rings[i].p[j][0], rings[i].p[j][1], rings[i].z);
      for (let i = 0; i < m - 1; i++) for (let j = 0; j < n; j++) {
        const a = i * n + j, b = i * n + (j + 1) % n;
        idx.push(a, a + n, b, b, a + n, b + n);
      }
      for (let e = 0; e < 2; e++) {                          // end caps: fan about the ring centroid
        const r = rings[e ? m - 1 : 0], base = e ? (m - 1) * n : 0;
        let sx = 0, sy = 0;
        for (let j = 0; j < n; j++) { sx += r.p[j][0]; sy += r.p[j][1]; }
        const c = pos.length / 3;
        pos.push(sx / n, sy / n, r.z);
        for (let j = 0; j < n; j++) {
          const u = base + j, v = base + (j + 1) % n;
          if (e) idx.push(c, v, u); else idx.push(c, u, v);  // tail cap faces -Z
        }
      }
      const src = new THREE.BufferGeometry();
      src.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      src.setIndex(idx);
      const geo = src.toNonIndexed();
      geo.computeVertexNormals();
      // core/batch.js concatenates position/normal/uv when it merges a bucket —
      // hand it a real (zeroed) uv so this geometry is attribute-compatible.
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh);
      return mesh;
    }

    // ---- FUSELAGE — CHINED, BLENDED FOREBODY --------------------------------
    // ONE lofted skin from radome to boat-tail. Every station is a HEXAGON: a
    // flat upper deck (tw), a flat keel (bw) and a sharp lateral CHINE (hw)
    // where the two meet. Forward, hw is ~2.4x the deck half-width, so the
    // forebody is a knife-edged wedge — an F-22 forebody, not a cone — and the
    // chine sits BELOW the centreline (chy<0) exactly where a real one does.
    // Aft, hw/tw converge so the chine dissolves and the body squares up into
    // the nozzle pack. dy droops the whole radome, so the nose rakes down.
    //             z      hw     top    bot    tw     bw     chy     dy
    const FUS = [
      [  6.30, 0.035, 0.040, 0.040, 0.018, 0.018,  0.000, -0.085],
      [  5.72, 0.190, 0.145, 0.135, 0.075, 0.090, -0.010, -0.062],
      [  5.02, 0.380, 0.255, 0.230, 0.155, 0.200, -0.030, -0.040],
      [  4.18, 0.600, 0.345, 0.300, 0.245, 0.315, -0.055, -0.022],
      [  3.22, 0.790, 0.415, 0.360, 0.330, 0.425, -0.065, -0.008],
      [  2.15, 0.920, 0.460, 0.415, 0.400, 0.520, -0.055,  0.000],
      [  0.95, 1.000, 0.490, 0.460, 0.450, 0.600, -0.030,  0.000],
      [ -0.45, 1.020, 0.500, 0.500, 0.480, 0.640,  0.000,  0.000],
      [ -2.05, 0.980, 0.490, 0.520, 0.480, 0.640,  0.030,  0.000],
      [ -3.60, 0.885, 0.450, 0.490, 0.460, 0.580,  0.050,  0.000],
      [ -4.90, 0.760, 0.380, 0.420, 0.420, 0.480,  0.060,  0.000],
      [ -5.80, 0.660, 0.310, 0.330, 0.380, 0.400,  0.060,  0.000],
    ];
    loft(FUS.map(function (st) {
      const c = st[6] + st[7], t = st[2] + st[7], b = -st[3] + st[7];
      return { z: st[0], p: [[st[1], c], [st[4], t], [-st[4], t], [-st[1], c], [-st[5], b], [st[5], b]] };
    }), SKIN).position.y = cy;
    // chin sensor turret — a faceted gem under the forebody chine (the thing a
    // player standing at the nose actually looks at).
    const eots = new THREE.Mesh(new THREE.OctahedronGeometry(0.27, 0), GUN);
    eots.position.set(0, cy - 0.40, 3.55); eots.scale.set(1.0, 0.60, 1.45);
    eots.rotation.y = Math.PI / 4; eots.castShadow = true; eots.receiveShadow = true; g.add(eots);
    // belly weapons-bay doors — twin recessed panels with a centreline seam
    // (y/height chosen so the panel top stays ABOVE the keel line across the
    // whole z-span — the keel rises from -0.508 aft to -0.428 forward — so the
    // doors are proud of the belly everywhere and float nowhere.)
    [-1, 1].forEach(function (s) { box(g, s * 0.31, cy - 0.46, 0.35, 0.52, 0.12, 2.9, M.jetGreyD); });

    // ---- CHEEK INTAKES ------------------------------------------------------
    // Trunks hung low and outboard, each with its OWN chine (top:0.62 narrows
    // the upper face so the widest line is at mid height), a raked CARET mouth
    // (yawed + pitched dark plate recessed behind the lip) and a boundary-layer
    // diverter plate bridging trunk-to-flank so no daylight shows through.
    [-1, 1].forEach(function (s) {
      tbox(g, s * 1.28, cy - 0.34, 1.05, 0.68, 0.72, 4.30, { nz: 0.90, tz: 0.66, top: 0.62, bot: 0.82, segD: 6 }, SKIN);
      const mo = mbox(g, s * 1.28, cy - 0.34, 3.04, 0.50, 0.60, 0.12, GUN);
      mo.rotation.y = s * 0.34; mo.rotation.x = -0.20;
      box(g, s * 0.96, cy - 0.28, 1.55, 0.09, 0.56, 3.10, M.jetGreyD);
    });

    // ---- WINGS / TAILS ------------------------------------------------------
    // Trapezoidal planform: 43° swept leading edge, 0.32 tip/root taper, a
    // separate FLAPERON slab hung off the trailing edge (a real control-surface
    // step, not a painted seam), all-moving stabilators aft, and underwing
    // pylons carrying finned stores. Roots sit at x=±0.80 — deep inside the
    // flank — and emerge THROUGH the intake fairing, so there is no seam.
    [-1, 1].forEach(function (s) {
      wing(g, s * 0.80, cy + 0.04, -0.35, s, 3.70, 4.00, 0.30, 2.10, 0.68, 0.55, SKIND);
      wing(g, s * 1.10, cy + 0.05, -2.66, s, 3.00, 0.62, 0.16, 0.51, 0.28, 0.45, SKIN);   // flaperon
      wing(g, s * 0.66, cy + 0.06, -4.05, s, 1.90, 1.95, 0.20, 1.05, 0.58, 0.50, SKIND);  // stabilator
      box(g, s * 2.70, cy - 0.22, -1.20, 0.13, 0.36, 1.35, M.jetGreyD);                   // pylon
      mcyl(g, s * 2.70, cy - 0.44, -1.00, 0.105, 0.105, 1.90, STORE, 10).rotation.x = Math.PI / 2;
      const og = new THREE.Mesh(new THREE.ConeGeometry(0.105, 0.46, 10), STORE);
      og.rotation.x = -Math.PI / 2; og.position.set(s * 2.70, cy - 0.44, 0.18);
      og.castShadow = true; og.receiveShadow = true; g.add(og);
      box(g, s * 2.70, cy - 0.44, -1.72, 0.60, 0.035, 0.30, M.dark);
      box(g, s * 2.70, cy - 0.44, -1.72, 0.035, 0.60, 0.30, M.dark);
    });
    // TWIN CANTED FINS — sculpted slabs stood on end (rotation.z) and raked out
    // 23° from vertical, each rising out of a THICKER fairing on the same cant
    // so the root is swallowed instead of stabbed into the spine.
    [-1, 1].forEach(function (s) {
      wing(g, s * 0.24, cy + 0.06, -3.45, s, 1.05, 3.00, 0.38, 0.85, 0.55, 0.55, SKIN).rotation.z = s * 1.16;
      wing(g, s * 0.30, cy + 0.34, -3.55, s, 2.05, 2.50, 0.20, 1.45, 0.60, 0.50, SKIN).rotation.z = s * 1.16;
    });

    // ---- COCKPIT ------------------------------------------------------------
    // A lofted one-piece bubble (5-point arc sections) whose sill sinks under
    // the upper deck at every station, a torus canopy bow at the windscreen
    // join, and a real interior — coaming, raked seat, headrest — because the
    // shared vehicle glass is genuinely transparent and an empty tub shows.
    //             z      w     base    h
    const CAN = [
      [  2.72, 0.120, 0.415, 0.115],
      [  2.28, 0.280, 0.425, 0.290],
      [  1.55, 0.405, 0.440, 0.455],
      [  0.60, 0.435, 0.455, 0.480],
      [ -0.40, 0.400, 0.460, 0.425],
      [ -1.15, 0.295, 0.450, 0.235],
    ];
    mbox(g, 0, cy + 0.52, 2.02, 0.42, 0.16, 0.42, TRIM);                       // instrument coaming
    tbox(g, 0, cy + 0.56, 0.88, 0.40, 0.58, 0.24, { top: 0.78, segD: 2 }, TRIM).rotation.x = -0.22;
    mbox(g, 0, cy + 0.80, 0.70, 0.24, 0.15, 0.16, TRIM);                       // headrest
    const canopy = loft(CAN.map(function (st) {
      const w = st[1], b = st[2], t = st[2] + st[3];
      return { z: st[0], p: [[w, b], [w * 0.86, b + st[3] * 0.62], [0, t], [-w * 0.86, b + st[3] * 0.62], [-w, b]] };
    }), GLASS);
    canopy.position.y = cy;
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.038, 6, 14, Math.PI), SKIND);
    bow.position.set(0, cy + 0.425, 2.28); bow.scale.y = 0.95;
    bow.castShadow = true; bow.receiveShadow = true; g.add(bow);
    // dorsal spine fairing — carries the canopy line aft into the fin roots
    tbox(g, 0, cy + 0.44, -1.60, 0.62, 0.42, 4.40, { nz: 0.75, tz: 0.45, top: 0.55, segD: 5 }, SKIND);

    // ---- NOZZLES — twin 2D THRUST-VECTORING PACK ----------------------------
    // Not round cones: rectangular convergent housings with a dark throat and
    // upper/lower vectoring paddles that pinch shut going aft. Two plumes, one
    // per engine (the userData.plume contract is an array).
    const plumes = [];
    [-1, 1].forEach(function (s) {
      tbox(g, s * 0.40, cy + 0.02, -5.55, 0.66, 0.66, 1.10, { tz: 0.68, top: 0.88, bot: 0.88, segD: 3 }, SKIND);
      mbox(g, s * 0.40, cy + 0.02, -6.02, 0.42, 0.42, 0.14, GUN);
      box(g, s * 0.40, cy + 0.28, -5.95, 0.58, 0.08, 0.62, M.steelD).rotation.x = 0.22;
      box(g, s * 0.40, cy - 0.24, -5.95, 0.58, 0.08, 0.62, M.steelD).rotation.x = -0.22;
      const p = CBZ.createRocketPlume({ name: "fighter-afterburner", lightRange: 13 });
      p.position.set(s * 0.40, cy + 0.02, -6.18); g.add(p); CBZ.setRocketPlume(p, 0, 0);
      plumes.push(p);
    });
    g.userData.plume = plumes; g.userData.plumeMat = plumes[0].userData.outerMaterial;

    // ---- LANDING GEAR — oleo struts, hubbed wheels, hanging doors -----------
    mcyl(g, 0, 0.56, 3.40, 0.065, 0.075, 0.62, GUN, 8);                        // nose oleo
    mcyl(g, 0, 0.26, 3.40, 0.26, 0.26, 0.22, RUBBER, 12).rotation.z = Math.PI / 2;
    mcyl(g, 0, 0.26, 3.40, 0.13, 0.13, 0.24, RIM, 10).rotation.z = Math.PI / 2;
    box(g, 0.22, 0.68, 3.40, 0.05, 0.50, 1.15, M.jetGreyD);                    // nose bay door
    [-1, 1].forEach(function (s) {
      mcyl(g, s * 1.05, 0.60, -0.25, 0.075, 0.088, 0.58, GUN, 8);              // main oleo
      mcyl(g, s * 1.05, 0.34, -0.25, 0.34, 0.34, 0.26, RUBBER, 12).rotation.z = Math.PI / 2;
      mcyl(g, s * 1.05, 0.34, -0.25, 0.17, 0.17, 0.28, RIM, 10).rotation.z = Math.PI / 2;
      box(g, s * 0.86, 0.72, -0.25, 0.06, 0.62, 1.50, M.jetGreyD);             // main bay door
    });

    // nav lights: red port wingtip, green starboard, white tail
    navBox(g, -4.42, cy + 0.04, -2.20, 0.15, 0xff4a3d);
    navBox(g, 4.42, cy + 0.04, -2.20, 0.15, 0x37d67a);
    navBox(g, 0, cy + 0.40, -5.05, 0.13, 0xf2f4ff);
    // Exact visible launch socket. The generic fallback multiplied the already
    // world-sized footprint by this group's 1.5 scale and spawned missiles far
    // in front of the jet, which looked like no rocket left the aircraft.
    // Sits on the drooped radome boresight, just clear of the loft's tip.
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, cy - 0.06, 6.42); g.add(muzzle);
    g.userData.muzzle = muzzle; g.userData.muzzleLocal = muzzle.position.clone();
    const scale = 1.5;
    const dims = { family: "F-22-class", length: 18.6, span: 13.5, height: 5.25 };
    g.scale.setScalar(scale); g.userData.aircraftDims = dims;
    return { group: g, footW: dims.span, footL: dims.length, height: dims.height, aircraftDims: dims };
  }

  // HEAVY BOMBER — a SCULPTED airframe, not a tube with cones on both ends
  // (which is exactly what it used to be). Four hexagonal-section fuselage
  // stations with a waist and a keel; a blunt drooped forebody with chines, a
  // raised flight deck and an overhanging graphite brow; a beaver-tail aft
  // body that sweeps UP onto an armoured bulkhead carrying a remote tail
  // barbette; shoulder wings with hard sweep and real anhedral; four podded
  // turbofans with rolled intake lips, recessed fan faces and spinners; a
  // bulged bomb bay; and long-legged gear on two four-wheel bogies.
  // ~82 meshes. Nose +Z, tyres on y=0.
  function makeBomber() {
    const g = new THREE.Group();
    const cy = 2.7;                                         // body centreline y — it stands TALL on its legs
    const GLASS = vmat("glass", M.canopy), GUN = vmat("plastic", M.dark), RUBBER = vmat("tire", M.tire);
    // Deliberately DARKER than the fighter: low-vis strategic-bomber grey.
    // Three cached tones only — hull / shadowed fairings / lighter surfaces.
    const HULL = cm(M.jetGreyD), SHADE = cm(0x464d56), PANEL = cm(M.jetGrey);

    // ===================== FUSELAGE =====================
    // FOUR sculpted stations, each a hexagonal-section taperBox (top/bot
    // narrowing fakes a round-shouldered hull in low-poly). There is no tube
    // and no cone anywhere on this airframe: the body has a real waist, real
    // shoulders and a keel line that sweeps UP into the tail.
    tbox(g, 0, cy, -0.10, 3.00, 3.20, 9.20, { nz: 0.99, tz: 0.86, top: 0.56, bot: 0.64, segD: 6 }, HULL);       // centre / wing box
    tbox(g, 0, cy + 0.06, 7.45, 2.97, 3.17, 6.10, { nz: 0.66, tz: 0.99, top: 0.54, bot: 0.62, segD: 8 }, HULL); // forebody

    // NOSE — the cone is GONE. The forebody keeps real width and real depth
    // all the way forward, DROOPS a couple of degrees so it looks down at you,
    // and finishes on a blunt oval radome instead of resolving to a point.
    const noseCap = tbox(g, 0, cy - 0.06, 11.85, 1.96, 2.09, 3.00, { nz: 0.34, tz: 1.0, top: 0.50, bot: 0.60, segD: 8 }, HULL);
    noseCap.rotation.x = 0.04;
    const radome = new THREE.Mesh(new THREE.SphereGeometry(0.52, 10, 6), SHADE);
    radome.scale.set(0.95, 1.0, 1.35); radome.position.set(0, cy - 0.10, 12.90);
    radome.castShadow = true; radome.receiveShadow = true; g.add(radome);
    // forebody CHINES — half-buried strakes carrying the flank line forward,
    // sweeping inboard as they go. This is what stops the front reading as a
    // separate shape stuck on the end of a pipe.
    [-1, 1].forEach(function (s) {
      const chine = tbox(g, s * 0.88, cy - 0.25, 10.25, 0.50, 0.34, 3.50, { nz: 0.42, tz: 0.85, top: 0.4, bot: 0.4, segD: 6 }, HULL);
      chine.rotation.y = -s * 0.13;
    });
    // CHIN — a bomb-aiming/sensor blister under the forebody ending in a
    // manned BARBETTE. Walk under the nose on the apron and two cannon are
    // pointed at you; that is why the front of this thing reads as hostile.
    tbox(g, 0, cy - 1.05, 10.10, 1.85, 0.95, 4.00, { nz: 0.42, tz: 0.80, bot: 0.50, segD: 6 }, SHADE);
    tbox(g, 0, cy - 1.42, 11.30, 1.10, 0.80, 1.20, { nz: 0.72, top: 0.78, bot: 0.62, segD: 4 }, cm(M.steelD));
    [-1, 1].forEach(function (s) {
      mcyl(g, s * 0.26, cy - 1.50, 12.35, 0.075, 0.085, 1.70, GUN, 8).rotation.x = Math.PI / 2;
    });

    // ===================== FLIGHT DECK =====================
    // A raised deck shell standing proud of the roofline, a raked wrap-around
    // windscreen, quarter lights down the flanks — and a heavy graphite BROW
    // overhanging the glass. That overhang is the scowl: seen from the tarmac
    // the aeroplane is frowning at you.
    tbox(g, 0, cy + 1.28, 8.85, 2.05, 1.00, 3.90, { nz: 0.60, tz: 0.90, top: 0.62, segD: 6 }, HULL);
    tbox(g, 0, cy + 1.30, 10.40, 1.40, 0.72, 1.00, { nz: 0.72, tz: 1.0, top: 0.66, bot: 0.92, segD: 4 }, GLASS);
    const brow = tbox(g, 0, cy + 1.62, 10.35, 1.42, 0.26, 1.50, { nz: 0.72, tz: 1.0, top: 0.60, segD: 4 }, SHADE);
    brow.rotation.x = 0.10;                                 // the lip tips DOWN over the glass
    [-1, 1].forEach(function (s) { mbox(g, s * 0.80, cy + 1.35, 9.40, 0.14, 0.44, 1.70, GLASS); });

    // ===================== SPINE & DORSAL FILLET =====================
    // A raised spine running back from the deck, then a fillet that RISES aft
    // into the fin root. From above the aircraft has a backbone, not a pipe.
    tbox(g, 0, cy + 1.42, 2.20, 1.55, 0.90, 9.60, { nz: 0.55, tz: 0.90, top: 0.55, segD: 8 }, HULL);
    tbox(g, 0, cy + 1.28, -4.00, 1.25, 1.30, 6.40, { nz: 0.35, tz: 0.98, top: 0.35, segD: 8 }, HULL);

    // ===================== AFT BODY & TAIL BARBETTE =====================
    // The classic bomber "beaver tail": instead of pinching into a cone the
    // hull sweeps UP and boat-tails onto a flat armoured bulkhead carrying a
    // remote turret. The rear three-quarter view gets a real shoulder line.
    const aft = tbox(g, 0, cy + 0.28, -7.60, 2.55, 2.80, 6.20, { nz: 0.98, tz: 0.66, top: 0.55, bot: 0.60, segD: 8 }, HULL);
    aft.rotation.x = 0.09;
    const boat = tbox(g, 0, cy + 0.68, -12.00, 1.72, 1.89, 2.80, { nz: 0.98, tz: 0.60, top: 0.60, bot: 0.55, segD: 6 }, HULL);
    boat.rotation.x = 0.09;
    tbox(g, 0, cy + 0.83, -13.75, 1.03, 1.13, 1.00, { tz: 0.78, top: 0.72, bot: 0.72, segD: 4 }, cm(M.steelD));
    mbox(g, 0, cy + 0.93, -14.28, 0.58, 0.30, 0.10, GLASS);       // gunner's vision slit
    [-1, 1].forEach(function (s) {
      mcyl(g, s * 0.26, cy + 0.70, -14.10, 0.085, 0.095, 1.40, GUN, 8).rotation.x = Math.PI / 2;
    });
    // ===================== TAIL GROUP =====================
    // Tall raked fin growing OUT of the dorsal fillet (not planted on a tube),
    // capped by an ECM fairing; hard-swept stabilizers with anhedral echoing
    // the wings so the whole tail reads as one family of shapes.
    wing(g, 0, cy + 0.50, -9.00, 1, 3.70, 4.40, 0.46, 2.60, 0.55, 0.40, PANEL).rotation.z = Math.PI / 2;
    tbox(g, 0, 6.68, -11.55, 0.44, 0.42, 2.20, { nz: 0.50, tz: 0.45, top: 0.7, bot: 0.7, segD: 4 }, SHADE);
    [-1, 1].forEach(function (s) {
      wing(g, s * 0.55, cy + 0.62, -10.20, s, 4.30, 3.40, 0.34, 2.30, 0.55, 0.40, PANEL, 0.30);
    });

    // ===================== WINGS =====================
    // 27m of shoulder-mounted wing (40.5m at world scale): hard sweep, strong
    // taper, thinning tips and real ANHEDRAL — the tips HANG, the way a laden
    // heavy's wings do. Roots buried inside the wing-body fairings so the slab
    // grows out of a blister instead of being stuck on a flank.
    [-1, 1].forEach(function (s) {
      tbox(g, s * 1.40, cy + 0.10, 0.70, 1.90, 2.00, 10.40, { nz: 0.34, tz: 0.50, top: 0.55, bot: 0.60, segD: 8 }, SHADE);
      wing(g, s * 0.95, cy + 0.92, 0.90, s, 12.55, 6.40, 0.66, 4.40, 0.62, 0.50, HULL, 0.62);
      // flap-track fairings under the trailing edge — the detail you actually
      // see when you are standing underneath it on the apron
      tbox(g, s * 5.90, 3.24, -2.75, 0.50, 0.48, 3.20, { nz: 0.80, tz: 0.20, top: 0.7, bot: 0.7, segD: 4 }, SHADE);
      // wingtip ECM/fuel pod straddling the tip chord
      tbox(g, s * 13.15, cy + 0.30, -3.50, 0.62, 0.55, 3.60, { nz: 0.45, tz: 0.40, top: 0.7, bot: 0.7, segD: 6 }, SHADE);
    });

    // ===================== ENGINES =====================
    // Four big turbofans podded FORWARD of and UNDER the wing on swept pylons.
    // Every one is a real engine — a rolled intake lip (a torus, not a washer),
    // a dark recessed fan face with a spinner, a boat-tailed cowl and a
    // converging nozzle. No drums with cones glued on the back.
    const ENG = [
      // x, y, z, length, radius, pylonY, pylonZ, pylonHeight
      [4.30, 2.16, 3.30, 3.70, 0.70, 2.92, 2.35, 1.55],
      [7.95, 2.02, 1.45, 3.35, 0.64, 2.76, 0.60, 1.45],
    ];
    [-1, 1].forEach(function (s) {
      ENG.forEach(function (e) {
        const ex = s * e[0], ey = e[1], ez = e[2], eL = e[3], er = e[4];
        const fz = ez + eL / 2, az = ez - eL / 2;           // cowl front / aft faces
        tbox(g, ex, e[5], e[6], 0.42, e[7], 2.50, { nz: 0.55, tz: 0.70, top: 0.80, bot: 0.85, segD: 4 }, SHADE);
        cyl(g, ex, ey, ez, er, er * 0.84, eL, M.jetGrey, 14).rotation.x = Math.PI / 2;
        const lip = new THREE.Mesh(new THREE.TorusGeometry(er * 0.90, er * 0.16, 6, 16), cm(M.steelD));
        lip.position.set(ex, ey, fz - er * 0.10); lip.castShadow = true; lip.receiveShadow = true; g.add(lip);
        mcyl(g, ex, ey, fz - er * 0.55, er * 0.85, er * 0.85, 0.12, GUN, 14).rotation.x = Math.PI / 2;
        const hub = new THREE.Mesh(new THREE.ConeGeometry(er * 0.22, er * 0.80, 8), cm(M.steelD));
        hub.rotation.x = Math.PI / 2; hub.position.set(ex, ey, fz - er * 0.55);
        hub.castShadow = true; hub.receiveShadow = true; g.add(hub);
        mcyl(g, ex, ey, az + 0.10, er * 0.80, er * 0.62, 0.72, GUN, 12).rotation.x = Math.PI / 2;
      });
    });

    // ===================== BOMB BAY =====================
    // A long bulged bay with twin door leaves — the reason the aeroplane
    // exists, and the first thing you see looking up from underneath.
    box(g, 0, cy - 1.62, 1.40, 1.85, 0.50, 9.00, M.dark);
    [-1, 1].forEach(function (s) { box(g, s * 0.62, cy - 1.72, 1.40, 0.62, 0.16, 8.80, M.jetGreyD); });

    // ===================== LANDING GEAR =====================
    // Long-legged: a twin-wheel nose leg braced up into the chin bay, and TWO
    // FOUR-WHEEL BOGIES tucked into the wing-body fairings. Tyres on y=0.
    box(g, 0, 1.20, 9.00, 0.40, 2.05, 0.36, M.steelD);                          // nose oleo
    box(g, 0, 1.45, 8.72, 0.22, 1.40, 0.22, M.steel).rotation.x = -0.45;        // drag brace
    [-1, 1].forEach(function (s) {
      mcyl(g, s * 0.30, 0.58, 9.00, 0.58, 0.58, 0.30, RUBBER, 12).rotation.z = Math.PI / 2;
    });
    [-1, 1].forEach(function (s) {
      box(g, s * 1.72, 1.55, 0.40, 0.46, 2.60, 0.48, M.steelD);                 // main oleo
      box(g, s * 1.72, 2.00, 0.95, 0.26, 1.70, 0.26, M.steel).rotation.x = 0.42; // drag stay
      box(g, s * 1.72, 0.68, 0.40, 0.54, 0.30, 3.00, M.steelD);                 // bogie beam
      [-1.05, 1.05].forEach(function (wz) {
        [-1, 1].forEach(function (ws) {
          mcyl(g, s * 1.72 + ws * 0.40, 0.68, 0.40 + wz, 0.68, 0.68, 0.34, RUBBER, 12).rotation.z = Math.PI / 2;
        });
      });
    });
    // nav lights: red port wingtip, green starboard, white on the fin tip
    navBox(g, -13.35, cy + 0.30, -3.50, 0.22, 0xff4a3d);
    navBox(g, 13.35, cy + 0.30, -3.50, 0.22, 0x37d67a);
    navBox(g, 0, 6.72, -12.75, 0.20, 0xf2f4ff);
    const scale = 1.5;
    const dims = { family: "heavy-bomber", length: 42, span: 40.5, height: 10.35 };
    g.scale.setScalar(scale); g.userData.aircraftDims = dims;
    return { group: g, footW: dims.span, footL: dims.length, height: dims.height, aircraftDims: dims };
  }

  // HELICOPTER — sculpted cabin + glass greenhouse nose, tapered tail boom,
  // rotor mast/hub with 4 sculpted drooped blades in ONE spinnable group
  // (userData.rotor), a crossed tail rotor group (userData.tailRotor), skids,
  // a door gun stub and nav lights. Parked rotors DON'T spin — the flyable
  // path (playeraircraft citySpawnFlyableFromProp) drives the tagged groups.
  function makeHeli() {
    const g = new THREE.Group();
    const GLASS = vmat("glass", M.canopy), GUN = vmat("plastic", M.dark);
    // cabin (nose narrows, keel tucks) + glass greenhouse + chin block
    tbox(g, 0, 1.55, 0.2, 1.9, 1.6, 4.4, { nz: 0.75, tz: 0.8, bot: 0.85 }, cm(M.olive));
    tbox(g, 0, 1.5, 2.5, 1.6, 1.2, 1.8, { nz: 0.5, top: 0.6 }, GLASS);
    box(g, 0, 0.95, 2.6, 1.2, 0.55, 1.2, M.oliveD);       // chin/avionics block
    // engine deck + twin exhaust stubs
    box(g, 0, 2.55, -0.3, 1.5, 0.55, 2.8, M.oliveD);
    [-1, 1].forEach(function (s) { mcyl(g, s * 0.62, 2.62, -1.5, 0.15, 0.15, 0.5, GUN, 8).rotation.x = Math.PI / 2; });
    // tapered tail boom (front buried in the cabin) + fin + stab
    tbox(g, 0, 2.0, -3.5, 0.72, 0.72, 4.8, { tz: 0.5 }, cm(M.olive));
    box(g, 0, 2.8, -5.7, 0.22, 1.5, 0.9, M.oliveD);       // tail fin
    box(g, 0, 2.15, -5.3, 1.7, 0.16, 0.6, M.oliveD);      // horizontal stab
    // MAIN ROTOR — static mast on the deck; hub + 4 tapered drooped blades in
    // ONE group so the flyable path can spin it (rotation.y).
    cyl(g, 0, 2.95, -0.2, 0.15, 0.17, 0.7, M.steelD, 8);  // mast
    const rotor = new THREE.Group();
    rotor.position.set(0, 3.32, -0.2);
    const hub = new THREE.Mesh(bg(0.5, 0.26, 0.5), cm(M.steelD));
    hub.castShadow = true; rotor.add(hub);
    for (let i = 0; i < 4; i++) {
      const bl = wing(rotor, 0, 0.02, 0, 1, 4.8, 0.42, 0.09, 0.12, 0.55, 0.3, M.dark, 0.14);
      bl.rotation.y = i * Math.PI / 2;
    }
    g.add(rotor);
    g.userData.rotor = rotor;                             // flyable contract: spin .rotation.y
    // TAIL ROTOR — hub + crossed blade bars on the fin's starboard cheek, its
    // own group on a short shaft so the flyable path can spin it (rotation.x).
    mcyl(g, 0.18, 2.75, -5.75, 0.07, 0.07, 0.28, GUN, 8).rotation.z = Math.PI / 2; // shaft
    const trot = new THREE.Group();
    trot.position.set(0.32, 2.75, -5.75);
    const thub = new THREE.Mesh(bg(0.22, 0.22, 0.22), cm(M.steelD));
    thub.castShadow = true; trot.add(thub);
    const tb1 = new THREE.Mesh(bg(0.09, 1.7, 0.26), cm(M.dark));
    tb1.castShadow = true; trot.add(tb1);
    const tb2 = new THREE.Mesh(bg(0.09, 1.7, 0.26), cm(M.dark));
    tb2.rotation.x = Math.PI / 2; tb2.castShadow = true; trot.add(tb2);
    g.add(trot);
    g.userData.tailRotor = trot;                          // flyable contract: spin .rotation.x
    // SKIDS — chunky rails + 4 struts rising into the cabin floor
    [-1, 1].forEach(function (s) {
      box(g, s * 0.85, 0.18, 0.2, 0.16, 0.16, 4.0, M.steelD);
      [1.4, -1.0].forEach(function (z) { box(g, s * 0.8, 0.55, z, 0.16, 0.75, 0.16, M.steelD); });
    });
    // DOOR GUN stub on the starboard door: pintle post + receiver + barrel
    box(g, 0.95, 1.3, 0.6, 0.12, 0.4, 0.12, M.steelD);
    mbox(g, 1.08, 1.5, 0.75, 0.24, 0.24, 0.6, GUN);
    mcyl(g, 1.08, 1.5, 1.25, 0.06, 0.06, 0.55, GUN, 8).rotation.x = Math.PI / 2;
    // nav lights: red port cheek, green starboard, white tail fin
    navBox(g, -0.84, 1.7, 1.5, 0.14, 0xff4a3d);
    navBox(g, 0.84, 1.7, 1.5, 0.14, 0x37d67a);
    navBox(g, 0, 3.4, -6.05, 0.14, 0xf2f4ff);
    const scale = 1.45;
    const dims = { family: "utility-helicopter", length: 17.55, span: 13.92, height: 5.22 };
    g.scale.setScalar(scale); g.userData.aircraftDims = dims;
    return { group: g, footW: dims.span, footL: dims.length, height: dims.height, aircraftDims: dims };
  }

  // MAIN BATTLE TANK — hull with side skirts over rubber track runs, road
  // wheels + drive sprocket/idler, tow hooks; angular sculpted turret with
  // mantlet, barrel + chunky muzzle end block, commander cupola w/ MG, smoke
  // launcher clusters, stowage basket and antenna.
  function makeTank() {
    const g = new THREE.Group();
    const GUN = vmat("plastic", M.dark), RUBBER = vmat("tire", M.tire);
    // hull — upper + lower, sloped glacis, rear plate + exhausts
    box(g, 0, 1.05, 0, 3.0, 0.8, 5.6, M.olive);
    box(g, 0, 0.6, 0, 2.4, 0.45, 5.8, M.oliveD);
    const glacis = box(g, 0, 0.88, 2.72, 2.4, 0.72, 1.1, M.oliveD);
    glacis.rotation.x = 0.5;
    box(g, 0, 0.95, -2.75, 2.4, 0.65, 0.5, M.oliveD);     // rear plate
    [-1, 1].forEach(function (s) { mbox(g, s * 0.85, 1.2, -2.9, 0.5, 0.3, 0.3, GUN); }); // exhausts
    // tow hooks — two on the glacis toe, one on the rear plate
    [-1, 1].forEach(function (s) { box(g, s * 0.7, 0.62, 3.2, 0.2, 0.2, 0.35, M.steelD); });
    box(g, 0, 0.7, -3.05, 0.2, 0.2, 0.3, M.steelD);
    // RUNNING GEAR — side skirt over a rubber track run; 4 road wheels roll
    // beneath it with a dark-steel drive sprocket (rear) + idler (front)
    [-1, 1].forEach(function (s) {
      box(g, s * 1.42, 1.08, 0, 0.22, 0.5, 5.9, M.oliveD);          // side skirt
      mbox(g, s * 1.42, 0.55, 0, 0.68, 0.7, 6.1, RUBBER);           // track run
      [-1.8, -0.6, 0.6, 1.8].forEach(function (wz) {
        mcyl(g, s * 1.44, 0.44, wz, 0.44, 0.44, 0.5, RUBBER, 10).rotation.z = Math.PI / 2;
      });
      [-2.75, 2.75].forEach(function (wz) {
        mcyl(g, s * 1.44, 0.5, wz, 0.5, 0.5, 0.46, GUN, 10).rotation.z = Math.PI / 2;
      });
    });
    // TURRET — its OWN sub-group so the player tank can SLEW it independently of
    // the hull (militaryvehicles.js eases turret.rotation.y toward the aim, then
    // fires a shell from userData.muzzleLocal via turret.localToWorld). The turret
    // pivots about the ring centre at hull-top; every child keeps the exact local
    // transform it had on the hull, just re-parented to the turret + offset by the
    // pivot so the parked look is byte-identical. WHY a real turret: a tank you
    // can drive but can't aim is half a tank — the felt power is laying the gun.
    const turret = new THREE.Group();
    const TPY = 1.65;                                     // turret ring pivot height
    turret.position.set(0, TPY, 0);
    g.add(turret);
    g.userData.turret = turret;
    // local-space muzzle node (barrel tip, in TURRET space): the gun fires here.
    g.userData.muzzleLocal = new THREE.Vector3(0, 1.62 - TPY, 6.6);
    // angular turret body (narrows to the face) + mantlet + barrel + muzzle block
    tbox(turret, 0, 1.65 - TPY, -0.2, 2.3, 0.8, 3.0, { nz: 0.72, tz: 0.92 }, cm(M.olive));
    box(turret, 0, 1.62 - TPY, 1.4, 1.15, 0.6, 0.6, M.oliveD);      // gun mantlet
    mcyl(turret, 0, 1.62 - TPY, 3.85, 0.12, 0.16, 4.4, GUN, 10).rotation.x = Math.PI / 2;
    mbox(turret, 0, 1.62 - TPY, 6.2, 0.36, 0.36, 0.55, GUN);        // muzzle end block
    // commander cupola + hatch + pintle MG (all turn with the turret)
    cyl(turret, 0.55, 2.15 - TPY, -0.75, 0.34, 0.36, 0.28, M.oliveD, 10);
    box(turret, 0.55, 2.31 - TPY, -0.75, 0.5, 0.08, 0.5, M.olive);
    box(turret, 0.55, 2.43 - TPY, -0.55, 0.1, 0.22, 0.1, M.steelD); // MG post
    mbox(turret, 0.55, 2.55 - TPY, -0.25, 0.14, 0.14, 0.85, GUN);   // MG
    // smoke launcher clusters angled off both turret cheeks
    [-1, 1].forEach(function (s) {
      const base = box(turret, s * 0.98, 1.75 - TPY, 0.55, 0.5, 0.24, 0.24, M.oliveD);
      base.rotation.y = s * 0.55;
      const tubes = mbox(turret, s * 1.12, 1.75 - TPY, 0.78, 0.44, 0.18, 0.18, GUN);
      tubes.rotation.y = s * 0.55;
    });
    cyl(turret, -0.85, 2.25 - TPY, -1.35, 0.03, 0.03, 1.3, M.dark, 6); // antenna
    box(turret, 0, 1.67 - TPY, -1.95, 1.9, 0.55, 0.6, M.oliveD);       // stowage basket
    return { group: g, footW: 3.5, footL: 6.4, height: 2.7 };
  }

  // ARMY TRUCK (6x6) — glass cab with sloped hood, brush guard + bumper +
  // grille + headlights, mirrors, canvas bed with visible rib bows and a
  // tailgate, fenders over every axle, jerry cans on the bed side, exhaust
  // stack. Chunky voxel blocks in olive two-tone.
  function makeTruck() {
    const g = new THREE.Group();
    const GLASS = vmat("glass", M.glassDark), GUN = vmat("plastic", M.dark), RUBBER = vmat("tire", M.tire);
    box(g, 0, 0.55, 0.2, 1.9, 0.35, 7.4, M.steelD);       // chassis rails
    // CAB — body + sculpted sloped hood + raked windshield + door glass
    box(g, 0, 1.4, 2.1, 2.2, 1.3, 1.6, M.oliveD);
    tbox(g, 0, 1.0, 3.45, 2.0, 0.7, 1.2, { nz: 0.85, top: 0.75 }, cm(M.oliveD));
    const ws = mbox(g, 0, 1.75, 2.95, 1.85, 0.6, 0.12, GLASS);
    ws.rotation.x = -0.1;                                 // raked back
    [-1, 1].forEach(function (s) { mbox(g, s * 1.11, 1.62, 2.1, 0.08, 0.5, 0.85, GLASS); });
    // FRONT END — bumper, dark grille, headlights, brush guard over it all
    box(g, 0, 0.6, 4.1, 2.1, 0.4, 0.3, M.steelD);         // bumper
    mbox(g, 0, 1.1, 4.07, 1.3, 0.5, 0.12, GUN);           // grille
    [-1, 1].forEach(function (s) {
      box(g, s * 0.82, 1.1, 4.06, 0.22, 0.22, 0.1, 0xffe9b0, { matOpts: { emissive: 0xffe9b0, ei: 0.35 }, cast: false });
      box(g, s * 0.65, 1.05, 4.12, 0.12, 0.85, 0.12, M.steelD); // guard upright
    });
    box(g, 0, 1.35, 4.12, 1.7, 0.14, 0.12, M.steelD);     // guard cross bar
    // mirrors off the cab front corners
    [-1, 1].forEach(function (s) { box(g, s * 1.25, 1.8, 2.8, 0.36, 0.3, 0.08, M.steelD); });
    // COVERED BED — lower sides, tailgate, canvas volume + 3 rib bows proud of
    // the canvas, jerry cans racked on the port side
    box(g, 0, 1.0, -1.35, 2.3, 0.6, 3.6, M.oliveD);       // bed sides
    box(g, 0, 1.05, -3.22, 2.3, 0.7, 0.14, M.oliveD);     // tailgate
    box(g, 0, 1.95, -1.35, 2.26, 1.3, 3.5, M.olive);      // canvas cover
    [-0.35, -1.35, -2.35].forEach(function (z) { box(g, 0, 2.62, z, 2.34, 0.1, 0.14, M.oliveL); });
    box(g, -1.21, 1.05, -2.6, 0.14, 0.5, 0.34, M.sand);   // jerry can (flush on the side wall)
    box(g, -1.21, 1.05, -3.0, 0.14, 0.5, 0.34, M.red);    // fuel can (red = petrol)
    // fenders over every axle + 6 wheels (single front, paired rear)
    [-1, 1].forEach(function (s) {
      box(g, s * 1.08, 1.0, 2.5, 0.4, 0.3, 1.4, M.oliveD);
      box(g, s * 1.18, 0.95, -1.5, 0.42, 0.28, 2.9, M.oliveD);
      [2.5, -0.7, -2.3].forEach(function (z) {
        mcyl(g, s * 1.05, 0.55, z, 0.55, 0.55, 0.44, RUBBER, 12).rotation.z = Math.PI / 2;
      });
    });
    mcyl(g, 1.02, 1.75, 1.24, 0.09, 0.09, 1.5, GUN, 8);   // exhaust stack behind the cab
    return { group: g, footW: 2.8, footL: 7.7, height: 2.7 };
  }

  // ========================================================================
  //   PERIMETER FENCE — InstancedMesh posts (the draw-call-frugal repeat)
  //   plus full-height world colliders forming a sealed wall, with a GAP
  //   at the east causeway gate.
  // ========================================================================
  function buildFence(root) {
    const SPAN = 4;                                       // metres between posts
    // gate gap on the EAST edge, centred on the causeway lane (widened to the
    // 24m highway deck so the road actually passes through).
    const gateMin = CW_CZ - 13, gateMax = CW_CZ + 13;
    const segs = [];                                      // {a:{x,z}, b:{x,z}, skip?}
    // four edges as point pairs
    const edges = [
      [{ x: MINX, z: MINZ }, { x: MAXX, z: MINZ }],       // north (-Z)
      [{ x: MAXX, z: MINZ }, { x: MAXX, z: MAXZ }],       // east (+X) — has the gate
      [{ x: MAXX, z: MAXZ }, { x: MINX, z: MAXZ }],       // south (+Z)
      [{ x: MINX, z: MAXZ }, { x: MINX, z: MINZ }],       // west (-X)
    ];
    // PEDESTRIAN water-access gaps on the three SEAWARD edges (N/S/W). ~3m wide
    // — wider than the 0.55 player radius so you can WALK through to the sea
    // (swim.js auto-engages past the shore), narrower than a car so NPC cars
    // (pinned by clampToCity) can't drive into the ocean. The causeway side
    // (east) keeps its full fence + checkpoint gate untouched.
    const PG = 3;                              // pedestrian gap half-span ≈1.5m
    // gap centres along each seaward edge (mid-edge)
    const gapCN = CEN_X;                       // north/south gap at x = base centre
    const gapCW = CEN_Z;                       // west gap at z = base centre
    // collect post positions + build collider wall segments
    const posts = [];
    edges.forEach(function (e, ei) {
      const a = e[0], b = e[1];
      const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
      const n = Math.max(1, Math.round(L / SPAN));
      const ux = dx / L, uz = dz / L;
      const horiz = Math.abs(dx) > Math.abs(dz);
      for (let i = 0; i <= n; i++) {
        const px = a.x + ux * (L * i / n), pz = a.z + uz * (L * i / n);
        // east edge: skip posts inside the gate gap
        if (ei === 1 && pz > gateMin && pz < gateMax) continue;
        // seaward edges: skip posts inside the pedestrian water-access gap
        if (ei !== 1 && horiz && px > gapCN - PG && px < gapCN + PG) continue;   // N/S (along X)
        if (ei !== 1 && !horiz && pz > gapCW - PG && pz < gapCW + PG) continue;  // W (along Z)
        posts.push({ x: px, z: pz });
      }
      // collider wall: each edge splits around its gap
      if (ei === 1) {
        // east: wall from north corner down to gate, and gate to south corner
        col(MAXX, (MINZ + gateMin) / 2, 0.4, gateMin - MINZ, 0, 2.4);
        col(MAXX, (gateMax + MAXZ) / 2, 0.4, MAXZ - gateMax, 0, 2.4);
      } else if (horiz) {
        // N/S: split around the centre water-access gap (along X)
        const z = a.z;
        col((MINX + (gapCN - PG)) / 2, z, (gapCN - PG) - MINX, 0.4, 0, 2.4);
        col(((gapCN + PG) + MAXX) / 2, z, MAXX - (gapCN + PG), 0.4, 0, 2.4);
      } else {
        // W: split around the centre water-access gap (along Z)
        const x = a.x;
        col(x, (MINZ + (gapCW - PG)) / 2, 0.4, (gapCW - PG) - MINZ, 0, 2.4);
        col(x, ((gapCW + PG) + MAXZ) / 2, 0.4, MAXZ - (gapCW + PG), 0, 2.4);
      }
    });
    // decorative sand/ramp APRONS (no collider) at each seaward gap → slipway.
    (function aprons() {
      function apron(x, z, w, d) {
        const m = new THREE.Mesh(bg(w, 0.06, d), cm(M.sand));
        m.position.set(x, 0.03, z); m.receiveShadow = true; m.castShadow = false; root.add(m);
      }
      apron(gapCN, MINZ - 4, PG * 2 + 2, 10);   // north slipway
      apron(gapCN, MAXZ + 4, PG * 2 + 2, 10);   // south slipway
      apron(MINX - 4, gapCW, 10, PG * 2 + 2);   // west slipway
    })();
    // INSTANCED chain-link posts (one draw call for all of them)
    const postGeo = bg(0.18, 2.3, 0.18);
    const im = new THREE.InstancedMesh(postGeo, cm(M.fenceP), posts.length);
    im.castShadow = true; im.receiveShadow = true;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < posts.length; i++) {
      dummy.position.set(posts[i].x, 1.15, posts[i].z);
      dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
    root.add(im);
    // a thin translucent "mesh" band between posts so it reads as chain-link,
    // not floating poles: one merged thin box per edge (cheap, 3 meshes).
    edges.forEach(function (e, ei) {
      const a = e[0], b = e[1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const horiz = Math.abs(dx) > Math.abs(dz);
      if (ei === 1) {                                     // east split for the gate
        mkLink(root, MAXX, (MINZ + gateMin) / 2, 0.06, gateMin - MINZ);
        mkLink(root, MAXX, (gateMax + MAXZ) / 2, 0.06, MAXZ - gateMax);
      } else if (horiz) {                                 // N/S split for the water gap
        const z = a.z;
        mkLink(root, (MINX + (gapCN - PG)) / 2, z, (gapCN - PG) - MINX, 0.06);
        mkLink(root, ((gapCN + PG) + MAXX) / 2, z, MAXX - (gapCN + PG), 0.06);
      } else {                                            // W split for the water gap
        const x = a.x;
        mkLink(root, x, (MINZ + (gapCW - PG)) / 2, 0.06, (gapCW - PG) - MINZ);
        mkLink(root, x, ((gapCW + PG) + MAXZ) / 2, 0.06, MAXZ - (gapCW + PG));
      }
    });
  }
  function mkLink(root, cx, cz, w, d) {
    const m = new THREE.Mesh(bg(w, 1.9, d), new THREE.MeshLambertMaterial({ color: M.fence, transparent: true, opacity: 0.25 }));
    m.position.set(cx, 1.1, cz); m.castShadow = false; m.receiveShadow = false; root.add(m);
  }

  // ========================================================================
  //   GROUND PLANES — dirt apron over the whole island, tarmac runway/pads.
  // ========================================================================
  function buildGround(root) {
    // One textured plane owns dirt and runway. The former dirt box plus asphalt
    // box remained overlapping even after their tops were separated by 8cm;
    // the flight frustum quantised that gap and produced the recurring runway
    // flicker. Baking the runway into the land skin removes the hidden faces.
    const W = MAXX - MINX, D = MAXZ - MINZ;
    const RW_X = CEN_X, RW_Z = MAXZ - 70, RW_L = 360, RW_W = 26;
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1024;
    const ctx = canvas.getContext("2d");
    function css(c) { return "#" + (c >>> 0).toString(16).padStart(6, "0"); }
    function rect(x, z, w, d, color) {
      ctx.fillStyle = css(color);
      ctx.fillRect((x - w / 2 - MINX) / W * canvas.width,
        (z - d / 2 - MINZ) / D * canvas.height,
        w / W * canvas.width, d / D * canvas.height);
    }
    ctx.fillStyle = css(M.dirt); ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 0.08;
    for (let z = MINZ; z < MAXZ; z += 34) rect(CEN_X, z + 8, W, 16, 0x8a7754);
    ctx.globalAlpha = 1;
    rect(RW_X, RW_Z, RW_L, RW_W, M.runway);
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = Math.min(8, CBZ.renderer && CBZ.renderer.capabilities ? CBZ.renderer.capabilities.getMaxAnisotropy() : 1);
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshLambertMaterial({ color: 0xffffff, map: tex }));
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(CEN_X, 0, CEN_Z); apron.receiveShadow = true; apron.castShadow = false;
    apron.userData.terrain = true; apron.userData.worldSurface = true;
    apron.userData.surfaceOwner = "military";
    apron.userData.unifiedSurface = true;
    apron.name = "military-island-surface";
    root.add(apron);
    // RUNWAY: long tarmac strip down the south part of the island, with
    // centreline dashes (merged into one dash material).
    // dashed centreline via InstancedMesh (frugal repeat)
    const nDash = 18, dashGeo = bg(8, 0.02, 0.6);
    const dim = new THREE.InstancedMesh(dashGeo, cm(M.paint), nDash);
    const dd = new THREE.Object3D();
    for (let i = 0; i < nDash; i++) {
      dd.position.set(RW_X - RW_L / 2 + 18 + i * 18, 0.05, RW_Z);
      dd.updateMatrix(); dim.setMatrixAt(i, dd.matrix);
    }
    dim.instanceMatrix.needsUpdate = true; dim.receiveShadow = true; root.add(dim);
    // runway threshold piano keys (both ends)
    [-RW_L / 2 + 6, RW_L / 2 - 6].forEach(function (ex) {
      for (let k = -3; k <= 3; k++) box(root, RW_X + ex, 0.05, RW_Z + k * 2.6, 5, 0.02, 1.1, M.paint, { cast: false });
    });
    return { RW_X: RW_X, RW_Z: RW_Z, RW_L: RW_L, RW_W: RW_W };
  }

  // ========================================================================
  //   CAUSEWAY — drivable bridge deck + curb colliders + the gate.
  // ========================================================================
  function buildCauseway(root) {
    const w = CW_MAXX - CW_MINX, cx = (CW_MINX + CW_MAXX) / 2;
    // REAL HIGHWAY: a wide multi-lane causeway from the mainland west edge to
    // the base gate (merged deck + baked lanes + instanced guardrails/lights +
    // continuous curb colliders). Falls back to the old bespoke deck if absent.
    if (CBZ.buildHighway) {
      CBZ.buildHighway(root, {
        path: [{ x: CW_MINX, z: CW_CZ }, { x: CW_MAXX, z: CW_CZ }],
        width: 24, lanesPerDir: 3, median: true, medianW: 1.2, laneW: 3.6, theme: "asphalt",
        guardrail: false, elevated: false, rng: rng,
      });
    } else {
      // ---- fallback: bespoke narrow deck (only if buildHighway absent) ----
      const deck = new THREE.Mesh(bg(w, 0.2, CW_MAXZ - CW_MINZ + 0.5), cm(M.tarmac));
      deck.position.set(cx, 0.0, CW_CZ); deck.receiveShadow = true; deck.castShadow = false; root.add(deck);
      // curbs (low walls each side) — visual + collider so you can't drive off
      [CW_MINZ - 0.1, CW_MAXZ + 0.1].forEach(function (z) {
        box(root, cx, 0.35, z, w, 0.7, 0.5, M.steelD);
        col(cx, z, w, 0.5, 0, 0.7);
      });
      // support pylons under the deck (visual depth; the sea is at y=-0.5)
      for (let i = 0; i <= 6; i++) {
        const px = CW_MINX + (w) * i / 6;
        [CW_MINZ, CW_MAXZ].forEach(function (z) { cyl(root, px, -0.8, z, 0.5, 0.6, 1.6, M.steelD, 8); });
      }
    }

    // ---- CHECKPOINT GATE at the base (west) end of the causeway ----
    const gx = CW_MINX + 6;                               // just inside the base
    // guard shack
    box(root, gx, 1.4, CW_MAXZ + 4, 3, 2.8, 3, M.olive);
    box(root, gx, 2.6, CW_MAXZ + 4, 3.4, 0.3, 3.4, M.oliveD);   // roof
    // window — OWNER RULE (bda61ab): no gray panes; same clear tinted glass as
    // every city facade. FRESH material (never cmat(): transparent glass must
    // stay out of the shared cache, and batch.js skips transparent from merge).
    const shackWin = new THREE.Mesh(bg(2.6, 1.0, 0.1), new THREE.MeshLambertMaterial({
      color: 0xbfe9f7, emissive: 0x3f8aa6, emissiveIntensity: 0.5, transparent: true, opacity: 0.6 }));
    shackWin.position.set(gx, 1.7, CW_MAXZ + 2.5);
    shackWin.castShadow = false; shackWin.receiveShadow = true;
    root.add(shackWin);
    col(gx, CW_MAXZ + 4, 3, 3, 0, 2.8);
    // boom barriers — one raised arm per carriageway at the GATE. THE FLOATING-
    // YELLOW-LINE FIX (owner: "still a floating yellow line at the highway near
    // Fort Brandt"): the old code sized the bar with `w` — the causeway LENGTH
    // (~547m post-move), not the road width — so a single amber box spanned 90%
    // of the causeway along its centreline at y=1.1 with a 0.04 roll that
    // floated its far tip ~10m in the air over the deck: THE floating yellow
    // line. It also dropped a `w*0.9`-long chest-height collider down the whole
    // median (an invisible wall against lane changes). Real checkpoint grammar
    // instead: a short striped arm per side pivoting at the kerb, parked RAISED
    // (the base is open to traffic — matching the old behaviour, where the
    // median collider never actually blocked the travel lanes), with the pivot
    // posts as the only (tiny) colliders. Geometry-only + fixed constants —
    // deterministic, and paint/deck stay solely owned by buildHighway above.
    const ARM_L = 9.5, ARM_A = 1.15;            // arm length / raised angle (rad)
    [[CW_MINZ + 1.2, 1], [CW_MAXZ - 1.2, -1]].forEach(function (pv) {
      const pz = pv[0], toward = pv[1];         // arm reaches toward the median
      cyl(root, gx, 0.7, pz, 0.16, 0.2, 1.4, M.red, 8);           // pivot post
      col(gx, pz, 0.5, 0.5, 0, 1.4);
      const arm = box(root, gx,
        0.9 + Math.sin(ARM_A) * ARM_L / 2,
        pz + toward * Math.cos(ARM_A) * ARM_L / 2,
        0.16, 0.16, ARM_L, M.warn);
      // rotation.x = r maps the box's +Z to (0, -sin r, cos r): the +Z-reaching
      // arm raises with r = -a, the -Z-reaching one with r = +a (box symmetry).
      arm.rotation.x = -toward * ARM_A;         // raised — the gate reads manned but open
    });
    // sandbag stack beside the gate (bunkered guard post)
    sandbagBunker(root, gx + 4, CW_MINZ - 3);
    return { gx: gx };
  }

  // ========================================================================
  //   SANDBAG BUNKER — instanced sandbag rows in a short L (frugal repeat).
  // ========================================================================
  function sandbagBunker(root, cx, cz) {
    const rows = [];
    // build an L-shaped low wall of bag positions
    for (let i = 0; i < 6; i++) rows.push({ x: cx - 3 + i, z: cz, layer: 0 });
    for (let i = 0; i < 5; i++) rows.push({ x: cx - 3 + i + 0.5, z: cz, layer: 1 });
    for (let j = 1; j < 5; j++) rows.push({ x: cx - 3, z: cz + j, layer: 0 });
    const geo = bg(1.0, 0.45, 0.7);
    const im = new THREE.InstancedMesh(geo, cm(M.sandbag), rows.length);
    im.castShadow = true; im.receiveShadow = true;
    const d = new THREE.Object3D();
    for (let i = 0; i < rows.length; i++) {
      d.position.set(rows[i].x, 0.22 + rows[i].layer * 0.45, rows[i].z);
      d.updateMatrix(); im.setMatrixAt(i, d.matrix);
    }
    im.instanceMatrix.needsUpdate = true; root.add(im);
    col(cx - 0.5, cz, 7, 0.9, 0, 1.0);                   // wall collider
    col(cx - 3, cz + 2.5, 0.9, 5, 0, 1.0);
  }

  // ========================================================================
  //   WATCHTOWER — legs, cabin, ladder hint. Solid collider footprint.
  // ========================================================================
  function watchtower(root, cx, cz) {
    const g = new THREE.Group(); g.position.set(cx, 0, cz); root.add(g);
    [-1, 1].forEach(function (sx) {
      [-1, 1].forEach(function (sz) { box(g, sx * 1.4, 3.0, sz * 1.4, 0.25, 6.0, 0.25, M.oliveD); });
    });
    box(g, 0, 6.2, 0, 3.4, 0.3, 3.4, M.olive);           // platform
    box(g, 0, 7.0, 0, 3.2, 1.4, 3.2, M.olive);           // cabin (open sides)
    box(g, 0, 8.0, 0, 3.6, 0.3, 3.6, M.oliveD);          // roof
    // searchlight
    cyl(g, 0, 7.1, 1.6, 0.3, 0.35, 0.5, M.warn, 8).rotation.x = Math.PI / 2;
    col(cx, cz, 3.4, 3.4, 0, 6.0);                        // base legs block
  }

  // ========================================================================
  //   PARADE GROUND FORMATION — reusable REAL-ACTOR anchors.
  //   Identity/build belongs to npcLife + cityMakePed; this function expresses
  //   only where a formation member stands. The old InstancedMesh silhouettes
  //   looked human but could not react, fight, die, or leave their post.
  // ========================================================================
  function paradeFormation(cx, cz) {
    const ROWS = 4, COLS = 8, GAP = 1.6;
    const anchors = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      anchors.push({
        x: cx - (COLS - 1) * GAP / 2 + c * GAP,
        z: cz - (ROWS - 1) * GAP / 2 + r * GAP,
        yaw: 0, row: r, column: c,
      });
    }
    return anchors;
  }

  // ========================================================================
  //   STATIC HARDWARE PLACEMENT — drop a model, register a solid collider.
  // ========================================================================
  // module-local capture of every BOARDABLE machine placed on the base, so we can
  // hand them to militaryvehicles.js as stealable vehicles. _reg guards the
  // one-shot deferred registration (the islands load BEFORE militaryvehicles.js).
  const placed = [];
  let _reg = false;

  // kind/name (optional) tag a placed group as a boardable military vehicle:
  //   kind 'tank' | 'heli' | 'plane' | 'ground' (the militaryvehicles.js taxonomy)
  function placeModel(root, modelFn, wx, wz, rotY, footScale, kind, name) {
    const made = modelFn();
    made.group.position.set(wx, 0, wz);
    made.group.rotation.y = rotY || 0;
    made.group.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    root.add(made.group);
    // collider: rotate the footprint roughly by snapping to nearest axis.
    // Height is PER MODEL (each maker measures itself): the old flat y1=3.0
    // let you jump straight through the bomber's ~7m tail fin.
    const fw = made.footW * (footScale || 1), fl = made.footL * (footScale || 1);
    const sideways = Math.abs(Math.sin(rotY || 0)) > 0.5;
    const cw = sideways ? fl : fw, cd = sideways ? fw : fl;
    const solid = col(wx, wz, cw, cd, 0, made.height != null ? made.height : 3.0, made.group);
    if (kind) {
      made.group.userData.milKind = kind;
      made.group.userData.milName = name || kind;
      // Parked hardware can become a live, moving machine under a named pilot.
      // Keep the authored group out of the static world merger so dispatch can
      // move THIS helicopter/tank instead of spawning a visual copy.
      made.group.userData.dynamic = true;
      if (made.aircraftDims) made.group.userData.aircraftDims = made.aircraftDims;
      placed.push({
        group: made.group, pos: made.group.position, heading: rotY || 0,
        kind: kind, model: { name: name || kind },
        // the parked collider rides on the record so STEALING the machine can
        // remove it (militaryvehicles/playeraircraft detach it via the shared
        // rec._colliderDetached protocol; without this an invisible solid
        // block haunted the empty slot forever). Same field the airport uses.
        collider: solid,
        // flight-model hints for playeraircraft's fly-the-actual-prop path:
        // these models face +Z = flight forward (no yaw offset) and park on
        // their gear/tracks at y=0 (no ground offset).
        modelYawOffset: 0, groundOffset: 0,
        aircraftDims: made.aircraftDims || null,
        footW: fw, footL: fl, taken: false, hot: true,
      });
    }
    return made.group;
  }

  // ========================================================================
  //   MAIN BUILDER
  // ========================================================================
  CBZ.addLandmass(function (city) {
    const root = city.root || (CBZ.scene);

    // a city rebuild re-runs this whole builder → fresh prop groups. Clear the
    // boardable capture + the one-shot guard so the rebuilt hardware re-registers
    // (the militaryvehicles.js registry was cleared by its reset chain).
    placed.length = 0; _reg = false;

    buildGround(root);
    buildFence(root);
    const cw = buildCauseway(root);

    // ---- AIRSTRIP: parked fighter jets in a row + a heavy bomber ----
    const rwZ = MAXZ - 70;                                // runway centre Z
    const jetZ = rwZ - 22;                                // parked just north of runway
    for (let i = 0; i < 5; i++) {
      placeModel(root, makeJet, MINX + 90 + i * 34, jetZ, Math.PI, 1, "plane", "Fighter Jet");   // nose pointing -Z (toward runway)
    }
    placeModel(root, makeBomber, MAXX - 95, jetZ - 12, Math.PI, 1, "plane", "Heavy Bomber");      // the big one, set back

    // ---- HELIPADS: a row, each with a parked helicopter ----
    const padZ = CEN_Z + 30;
    for (let i = 0; i < 4; i++) {
      const px = MINX + 70 + i * 30;
      // pad disc + painted H
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 0.08, 20), cm(M.tarmac));
      pad.position.set(px, 0.02, padZ); pad.receiveShadow = true; root.add(pad);
      box(root, px, 0.06, padZ, 1.0, 0.02, 4.0, M.paint, { cast: false });           // H verticals
      box(root, px - 1.4, 0.06, padZ, 0.02 + 2.8, 0.02, 0.8, M.paint, { cast: false }); // H crossbar
      const ring = new THREE.Mesh(new THREE.TorusGeometry(6.2, 0.12, 6, 24), cm(M.paint));
      ring.rotation.x = Math.PI / 2; ring.position.set(px, 0.05, padZ); root.add(ring);
      placeModel(root, makeHeli, px, padZ, rng() * 0.4 - 0.2, 1, "heli", "Helicopter");
    }

    // ---- MOTOR POOL: a line of tanks + armored trucks ----
    const mpZ = CEN_Z - 70;
    for (let i = 0; i < 5; i++) placeModel(root, makeTank, MINX + 70 + i * 26, mpZ, Math.PI / 2, 1, "tank", "Main Battle Tank");
    for (let i = 0; i < 4; i++) placeModel(root, makeTruck, MINX + 70 + i * 26, mpZ - 18, Math.PI / 2, 1, "ground", "Armored Truck");

    // ---- HANGARS: big enterable sheds (engine building shells) ----
    // door faces -Z toward the apron/runway. Single big storey.
    const hangars = [];
    for (let i = 0; i < 3; i++) {
      const hx = MINX + 110 + i * 80, hz = CEN_Z - 130;
      let b = null;
      try {
        b = CBZ.cityMakeBuilding(root, hx, hz, 40, 30, 1, M.hangarRoof, 0, { facade: "office" });
      } catch (e) { /* keep building the rest of the base */ }
      hangars.push({ x: hx, z: hz, b: b });
    }

    // ---- BARRACKS: row of long low buildings ----
    for (let i = 0; i < 4; i++) {
      const bx = MAXX - 60, bz = MINZ + 60 + i * 34;
      try { CBZ.cityMakeBuilding(root, bx, bz, 22, 26, 2, 0x6f7560, 3, { facade: "office" }); } catch (e) {}
    }

    // ---- COMMAND HQ (enterable) + ARMORY interaction inside ----
    const hqX = CEN_X + 60, hqZ = CEN_Z - 40;
    let hq = null;
    try { hq = CBZ.cityMakeBuilding(root, hqX, hqZ, 34, 28, 3, 0x55603f, 1, { facade: "office" }); } catch (e) {}
    // flagpole + flag in front of HQ (the base's heart reads as the HQ)
    cyl(root, hqX - 12, 6, hqZ + 18, 0.12, 0.14, 12, M.steel, 8);
    box(root, hqX - 11.0, 11, hqZ + 18, 2.0, 1.3, 0.05, M.flagBlue, { cast: false });
    box(root, hqX - 10.0, 10.5, hqZ + 18, 3.0, 0.45, 0.05, M.flagRed, { cast: false });
    box(root, hqX - 10.0, 11.4, hqZ + 18, 3.0, 0.45, 0.05, M.flagWhite, { cast: false });

    // ARMORY ZONE: a spot just inside the HQ door where the player can browse
    // weapons. WHY a zone, not a wall-store: the engine's gunstore.js is bound
    // to a specifically-STAMPED gun-shop lot (buildings.js sets lot.building
    // .gunstore); this island's HQ isn't that lot, so we surface our own
    // interaction. If a real city gun store exists, we hand the player off to
    // it (CBZ.cityOpenShop / the gunstore wall); otherwise it's an in-world note.
    const armoryX = hqX, armoryZ = hqZ - 4;              // inside, behind the door
    let armoryWired = "note";
    try {
      if (CBZ.interactions && CBZ.interactions.registerZone) {
        const tok = { x: armoryX, z: armoryZ, kind: "armory" };
        CBZ.interactions.registerZone({
          id: "military-armory", kind: "armory", radius: 4.5,
          find: function (px, pz) {
            const dx = tok.x - px, dz = tok.z - pz;
            return (dx * dx + dz * dz) < 4.5 * 4.5 ? tok : null;
          },
          options: [
            {
              id: "armory-browse", slot: "e",
              label: function () { return "Browse the armory"; },
              onSelect: function () {
                // prefer a REAL shop if the engine exposes one
                if (typeof CBZ.cityOpenShop === "function") { CBZ.cityOpenShop("guns", tok); return; }
                if (typeof CBZ.cityOpenGunStore === "function") { CBZ.cityOpenGunStore(); return; }
                const msg = "Base armory — racked M4s, sidearms and crates. Quartermaster's out; help yourself at the city gun store.";
                if (CBZ.city && CBZ.city.note) CBZ.city.note(msg, 3.2);
              },
            },
          ],
        });
        if (CBZ.interactions.describe) {
          CBZ.interactions.describe("armory", function () {
            return { label: "Armory", note: "Weapons, ammo and gear — Command HQ" };
          });
        }
        armoryWired = (typeof CBZ.cityOpenShop === "function" || typeof CBZ.cityOpenGunStore === "function") ? "shop" : "note";
      }
    } catch (e) { armoryWired = "note"; }

    // ---- WATCHTOWERS at the four corners (the base is WATCHED) ----
    watchtower(root, MINX + 18, MINZ + 18);
    watchtower(root, MAXX - 18, MINZ + 18);
    watchtower(root, MINX + 18, MAXZ - 18);
    watchtower(root, MAXX - 18, MAXZ - 18);

    // ---- SANDBAG BUNKERS scattered at posts ----
    sandbagBunker(root, CEN_X - 30, MINZ + 40);
    sandbagBunker(root, CEN_X + 90, CEN_Z + 60);

    // ---- FUEL DEPOT: cylindrical tanks (collider) near the apron ----
    for (let i = 0; i < 3; i++) {
      const fx = MAXX - 40, fz = CEN_Z + 80 + i * 14;
      const t = cyl(root, fx, 3, fz, 4, 4, 6, M.fuel, 16);
      box(root, fx, 6.3, fz, 8.2, 0.4, 8.2, M.steelD);   // domed top hint
      col(fx, fz, 8, 8, 0, 6);
    }

    // ---- RADAR DISH on a mast (the base SEES) ----
    const radX = CEN_X + 30, radZ = MINZ + 50;
    cyl(root, radX, 4, radZ, 0.4, 0.5, 8, M.steel, 8);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), cm(M.steel));
    dish.position.set(radX, 8, radZ); dish.rotation.x = -0.6; dish.castShadow = true; root.add(dish);
    col(radX, radZ, 1.2, 1.2, 0, 8);

    // ---- PARADE GROUND — anchors are filled by real troops below ----
    const paradeAnchors = paradeFormation(CEN_X - 90, CEN_Z + 40);

    // ========================================================================
    //   TROOPS — live soldiers via cityMakePed: armed, olive patrol cap (the
    //   peds.js "soldier" job paints the cap). The city ped brain drives their
    //   roaming; because this region is registered as walkable, clampToCity
    //   keeps them inside the wire. A few are STATIONED idle at posts (gate,
    //   towers) by parking their target on the spot and idling them.
    // ========================================================================
    const troops = [], troopSpecs = [];
    CBZ.cityMilitaryPersonnel = troops;
    let troopRespawn = -1;
    function spawnTrooper(spec) {
      if (!CBZ.cityMakePed) return null;
      const opts = spec.opts || {};
      const actorOpts = Object.assign({
        job: "soldier", kind: "civilian", armed: true, weapon: "AK-47",
        aggr: 0.45, hp: 140,
      }, opts);
      const p = CBZ.npcLife
        ? CBZ.npcLife.spawnCity(spec.profile || "militarySoldier", { x: spec.x, z: spec.z, parent: root, rng: rng }, actorOpts)
        : CBZ.cityMakePed(spec.x, spec.z, rng, actorOpts);
      if (p && !CBZ.npcLife) { root.add(p.group); CBZ.cityPeds.push(p); }
      if (p) {
        p.organization = "military";
        p.organizationLoyalty = 100;
        troops.push(p);
        if (spec.setup) spec.setup(p);
      }
      return p;
    }
    function trooper(x, z, opts, profile, setup) {
      const spec = { x: x, z: z, opts: opts || {}, profile: profile || "militarySoldier", setup: setup || null };
      troopSpecs.push(spec);
      return spawnTrooper(spec);
    }
    // Every former proxy slot is now an ordinary live soldier. The formation
    // metadata controls only the post/drill; normal ped combat and damage can
    // interrupt it, after which a survivor returns to the same reusable anchor.
    let paradeCursor = 0;
    function fillParade(budget) {
      let made = 0;
      while (paradeCursor < paradeAnchors.length && made < budget) {
        const i = paradeCursor++, a = paradeAnchors[i];
        const p = trooper(a.x, a.z, { aggr: 0.35 }, "militaryDrill", function (p) {
          p.group.rotation.y = a.yaw;
          p.state = "idle"; p.pause = 2;
          p._stationed = { x: a.x, z: a.z, yaw: a.yaw };
          p._drill = { index: i, row: a.row, column: a.column, phase: (i % 8) * 0.35 };
          p.activityState = "stand";
        });
        if (!p) continue;
        made++;
      }
      return made;
    }
    fillParade(2);                       // establish the post; finish incrementally
    // gate guards (stationed — stand the post)
    const guardSetup = function (g) { g.state = "idle"; g.pause = 9e9; g._stationed = { x: g.pos.x, z: g.pos.z }; };
    trooper(cw.gx + 2, CW_MINZ + 2, { aggr: 0.35 }, null, guardSetup);
    trooper(cw.gx + 2, CW_MAXZ - 2, { aggr: 0.35 }, null, guardSetup);
    // NO-SPAWN keep-out: the active runway strip (owner's rule — nobody
    // spawns or idles on a runway, not even patrols). Registered BEFORE the
    // patrol scatter below so cityScatterInRegion already steers around it.
    // Rect recomputed from the same anchors the runway build uses
    // (RW_X=CEN_X, RW_Z=MAXZ-70, RW_L=360, RW_W=26) plus a small margin.
    if (CBZ.registerNoSpawnZone) {
      CBZ.registerNoSpawnZone(city, {
        minX: CEN_X - 188, maxX: CEN_X + 188,
        minZ: (MAXZ - 70) - 17, maxZ: (MAXZ - 70) + 17,
        label: "military-runway",
      });
    }
    // patrolling soldiers scattered across the base
    if (CBZ.cityScatterInRegion) {
      const reg = { kind: "rect", minX: MINX, maxX: MAXX, minZ: MINZ, maxZ: MAXZ, pad: 0 };
      const pts = CBZ.cityScatterInRegion(reg, 10, rng, 24);
      pts.forEach(function (pt) { trooper(pt.x, pt.z); });
    }

    // light patrol nudge: stationed guards drift back to their post if shoved.
    if (CBZ.onUpdate) {
      CBZ.onUpdate(38.7, function (dt) {
        const g = window.CBZ.game || window.g;
        if (g && g.mode !== "city") return;
        // clearCityPeds removes the bodies but the authored formation persists.
        // Detect that reset boundary and refill the SAME specs incrementally;
        // the updater is registered once with this landmass, so it never stacks.
        const roster = CBZ.cityPeds || [];
        let liveOwned = 0;
        for (let i = 0; i < troops.length; i++) if (roster.indexOf(troops[i]) >= 0) liveOwned++;
        if (troops.length && liveOwned === 0 && troopSpecs.length) { troops.length = 0; troopRespawn = 0; }
        if (!CBZ.citySpawnDraining && troopRespawn >= 0) {
          let budget = 2;
          while (troopRespawn < troopSpecs.length && budget-- > 0) spawnTrooper(troopSpecs[troopRespawn++]);
          if (troopRespawn >= troopSpecs.length) troopRespawn = -1;
        }
        // Finish replaying the already-authored specs before authoring the
        // remaining parade rows. Otherwise a reset during incremental build
        // lets the replay cursor chase newly appended specs and spawn each new
        // drill soldier twice.
        if (!CBZ.citySpawnDraining && troopRespawn < 0 && paradeCursor < paradeAnchors.length) fillParade(2);
        for (let i = 0; i < troops.length; i++) {
          const t = troops[i];
          if (!t || t.dead) continue;
          // AIRCREW: a soldier flying one of this base's aircraft is off the
          // parade tick. He used to be force-HIDDEN every frame, which was
          // correct while the "crew" was an invisible bookkeeping entry — but
          // aircraft.js now SEATS these bodies in the airframe (npclife anchor,
          // visible through the canopy, shootable). An attached rig owns its own
          // visibility (attach() shows it, peds.js re-applies distance LOD), so
          // hiding it here would erase the crew the owner asked for. Only an
          // UNSEATED aircrew — the legacy bookkeeping case — still hides.
          if (t._milPilot) {
            t.speed = 0;
            if (!t._npcAttached) t.group.visible = false;
            else {
              // SEATED AIRCREW carry their own render LOD here, because the
              // `continue` below skips every other visibility pass they would
              // normally get — without it three character rigs draw from any
              // distance forever. 120 m is past peds.js's 95 m street cutoff on
              // purpose: these bodies are ~95 m UP, and the slant range to a
              // gunship overhead is most of that budget.
              const PL = CBZ.player;
              t.group.visible = !PL || !PL.pos ? true
                : ((t.pos.x - PL.pos.x) * (t.pos.x - PL.pos.x) +
                   (t.pos.y - (PL.pos.y || 0)) * (t.pos.y - (PL.pos.y || 0)) +
                   (t.pos.z - PL.pos.z) * (t.pos.z - PL.pos.z)) < 120 * 120;
            }
            continue;
          }
          const combat = !!(t.rage || t.npcWanted || t.state === "fight" || t.state === "flee" || t.state === "shoot");
          if (combat) { t.pause = 0; t.activityState = t.state; continue; }
          if (t._stationed) {
            const dx = t._stationed.x - t.pos.x, dz = t._stationed.z - t.pos.z;
            const postRadius2 = t._drill ? 0.16 : 9;
            if (dx * dx + dz * dz > postRadius2) {          // wandered/shoved off post
              if (t.target && t.target.set) t.target.set(t._stationed.x, 0, t._stationed.z);
              t.state = "walk"; t.pause = 0; t.activityState = "return-to-post";
            } else {
              t.state = "idle"; t.pause = Math.max(t.pause, 2);
              t.group.rotation.y = CBZ.lerpAngle ? CBZ.lerpAngle(t.group.rotation.y, t._stationed.yaw || 0, 0.14) : (t._stationed.yaw || 0);
              t.activityState = t._drill ? "drill" : "stand";
              // One rank at a time moves through a short inspection/salute
              // beat. The rest remain at attention; legs never run in place.
              if (t._drill && t.char && t.char.parts) {
                t._drill.phase += (dt || 0) * 0.75;
                const salute = ((t._drill.phase + t._drill.row * 0.7) % 6) < 1.2;
                const ra = t.char.parts.ra, la = t.char.parts.la;
                if (ra) { ra.rotation.x = salute ? -1.45 : 0; ra.rotation.z = salute ? -0.28 : 0; }
                if (la) { la.rotation.x = 0; la.rotation.z = 0; }
              }
            }
          }
        }

        // Military escalation is deliberately the rare top tier.  Soldiers do
        // not care about a 1–4 star city police case; at 5★ (or the base's own
        // incursion floor, which is also 5★) a LIMITED squad receives the order
        // and physically travels from wherever it was already standing.
        const stars = (window.CBZ.game && window.CBZ.game.wanted) | 0;
        const playerActor = CBZ.city && CBZ.city.playerActor;
        let responders = 0;
        for (let i = 0; i < troops.length; i++) {
          const t = troops[i];
          if (!t || t.dead || t._milPilot) continue;
          if (t._milResponding) responders++;
        }
        if (stars >= 5 && playerActor) {
          for (let i = 0; i < troops.length && responders < 8; i++) {
            const t = troops[i];
            if (!t || t.dead || t._milPilot || t._milResponding) continue;
            t._milResponding = true; t.rage = playerActor; t.state = "fight";
            t.pause = 0; t.targetActor = playerActor; t.alarmed = Math.max(t.alarmed || 0, 20);
            responders++;
          }
        } else {
          for (let i = 0; i < troops.length; i++) {
            const t = troops[i];
            if (!t || !t._milResponding) continue;
            t._milResponding = false;
            if (t.rage === playerActor) t.rage = null;
            if (t.targetActor === playerActor) t.targetActor = null;
            if (!t.dead) { t.state = t._stationed ? "walk" : "idle"; t.pause = 0; }
          }
        }
      });
    }

    // ========================================================================
    //   WORK-ANCHOR — the soldier's beat: the gate + a patrol ring of posts
    //   (the checkpoint, the HQ flag, the motor pool, a tower corner). The
    //   aigoals brain walks soldiers this ring on the same schedule/nav. WHY:
    //   a base is GUARDED — the soldier's job is to walk the wire. Barracks =
    //   home. Reuses coords already built; no new geometry.
    // ========================================================================
    if (CBZ.registerWorkAnchor) {
      CBZ.registerWorkAnchor({
        biome: "military", kind: "armory", role: "soldier", patrol: true,
        x: cw.gx + 2, z: CW_CZ, cap: 8,
        home: { x: MAXX - 60, z: MINZ + 60 },              // the barracks row
        spots: [
          { x: cw.gx + 2, z: CW_CZ },                       // the checkpoint gate
          { x: hqX - 12, z: hqZ + 18 },                     // the HQ flagpole
          { x: CEN_X - 70, z: CEN_Z - 70 },                 // the motor pool
          { x: MINX + 18, z: MAXZ - 18 },                   // a watchtower corner
        ],
      });
    }

    // ========================================================================
    //   REGISTER THE WALKABLE REGIONS (archipelago contract)
    // ========================================================================
    CBZ.registerCityRegion(city, {
      name: "Fort Brandt", subtitle: "Military Reservation", biome: "military", kind: "rect",
      minX: MINX, maxX: MAXX, minZ: MINZ, maxZ: MAXZ, pad: 6,
    });
    CBZ.registerCityRegion(city, {
      name: "Brandt Bridge", subtitle: "Military Reservation", kind: "rect",
      minX: CW_MINX, maxX: CW_MAXX, minZ: CW_MINZ, maxZ: CW_MAXZ, pad: 1,
    });
    // give traffic a road across the causeway (runs along X → not vertical)
    if (city.roads) {
      city.roads.push({ x: (CW_MINX + CW_MAXX) / 2, z: CW_CZ, vertical: false, len: CW_MAXX - CW_MINX, district: "highway", w: 24, lanesPerDir: 3, laneW: 3.6, median: true, medianW: 1.2 });
    }

    // ========================================================================
    //   MAKE THE HARDWARE STEALABLE — register every parked tank / heli / jet /
    //   bomber / truck as a boardable so the player can climb in and TAKE it (the
    //   #1 law: a machine you can only walk around is a dead prop). militaryvehicles
    //   .js loads AFTER this island, so DEFER the hand-off one tick (onUpdate 55.1,
    //   after worldgen) and run it ONCE. Feature-detected: no module → the props
    //   are still solid scenery, nothing throws.
    // ========================================================================
    if (CBZ.onUpdate) {
      CBZ.onUpdate(55.1, function () {
        if (_reg) return;
        if (!CBZ.cityRegisterMilitaryVehicle) return;
        placed.forEach(function (p) { CBZ.cityRegisterMilitaryVehicle(p); });
        _reg = true;
      });
    }

    // expose a tiny debug handle (no UI, no hidden stats — just a console aid)
    CBZ._militaryBase = { center: { x: CEN_X, z: CEN_Z }, minX: MINX, maxX: MAXX, minZ: MINZ, maxZ: MAXZ, armoryWired: armoryWired, boardable: placed.length };
  }, 22);
})();
