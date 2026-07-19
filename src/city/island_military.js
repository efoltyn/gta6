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
  const CW_MINX = -380, CW_MAXX = -133;
  const CW_MINZ = -712, CW_MAXZ = -688;
  const CW_CZ = (CW_MINZ + CW_MAXZ) / 2;      // -700, lines up with base centre

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
  function taperBox(w, h, d, opt) {
    opt = opt || {};
    const nz = opt.nz != null ? opt.nz : 1, tz = opt.tz != null ? opt.tz : 1;
    const top = opt.top != null ? opt.top : 1, bot = opt.bot != null ? opt.bot : 1;
    const geo = new THREE.BoxGeometry(w, h, d, opt.segW || 2, opt.segH || 2, opt.segD || 6);
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
    // fuselage tube + faceted forebody + afterbody. A radar radome resolves to
    // a continuous point, not the old long cylinder with a blunt round cap.
    cyl(g, 0, cy, 0.2, 0.5, 0.5, 8.6, M.jetGrey, 14).rotation.x = Math.PI / 2;
    tbox(g, 0, cy, 4.35, 0.92, 0.78, 2.7, { nz: 0.18, tz: 0.98, top: 0.72, bot: 0.66, segD: 6 }, cm(M.jetGrey));
    const radome = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.95, 10), cm(M.jetGreyD));
    radome.rotation.x = -Math.PI / 2; radome.position.set(0, cy - 0.01, 6.15); radome.castShadow = true; g.add(radome);
    cyl(g, 0, cy, -4.6, 0.42, 0.5, 2.0, M.jetGreyD, 14).rotation.x = Math.PI / 2;  // afterbody
    mcyl(g, 0, cy, -5.85, 0.3, 0.38, 0.6, GUN, 12).rotation.x = Math.PI / 2;       // nozzle
    const plume = CBZ.createRocketPlume({ name: "fighter-afterburner", lightRange: 13 });
    plume.position.set(0, cy, -6.12); g.add(plume); CBZ.setRocketPlume(plume, 0, 0);
    g.userData.plume = [plume]; g.userData.plumeMat = plume.userData.outerMaterial;
    // glass canopy (tapers to the windscreen) + spine fairing flowing aft
    tbox(g, 0, cy + 0.5, 1.7, 0.72, 0.5, 2.2, { nz: 0.45, tz: 0.85, top: 0.55 }, GLASS);
    tbox(g, 0, cy + 0.38, -1.9, 0.55, 0.45, 4.6, { tz: 0.6 }, cm(M.jetGreyD));
    // intake trunks flanking the fuselage, dark mouths up front
    [-1, 1].forEach(function (s) {
      box(g, s * 0.75, cy - 0.05, 0.9, 0.6, 0.72, 2.8, M.jetGreyD);
      mbox(g, s * 0.75, cy - 0.05, 2.35, 0.5, 0.6, 0.16, GUN);
    });
    // WINGS — sculpted slabs: swept leading edge, tapering chord, thinning tip.
    // Root edge buried in the round flank → no gap, no rotation seam.
    [-1, 1].forEach(function (s) {
      wing(g, s * 0.5, cy + 0.05, -0.4, s, 3.9, 3.6, 0.22, 2.2, 0.62, 0.35, M.jetGreyD);
      wing(g, s * 0.45, cy + 0.1, -4.7, s, 1.8, 1.6, 0.16, 1.0, 0.5, 0.3, M.jetGreyD); // tailplane
      box(g, s * 2.25, cy - 0.25, 0.1, 0.12, 0.18, 1.25, M.jetGreyD); // launch rail
      const mb = cyl(g, s * 2.25, cy - 0.47, 0.15, 0.10, 0.10, 1.65, 0xd4d9df, 8);
      mb.rotation.x = Math.PI / 2;
      const mc = new THREE.Mesh(new THREE.ConeGeometry(0.10, 0.38, 8), cm(0xd4d9df));
      mc.rotation.x = -Math.PI / 2; mc.position.set(s * 2.25, cy - 0.47, 1.16); g.add(mc);
      box(g, s * 2.25, cy - 0.47, -0.58, 0.54, 0.035, 0.26, M.dark);
      box(g, s * 2.25, cy - 0.47, -0.58, 0.035, 0.54, 0.26, M.dark);
    });
    // TWIN FINS — a sculpted "wing" stood upright (rotation.z), raked by its
    // sweep, canted outboard; root wedge buried in the afterbody so no float.
    [-1, 1].forEach(function (s) {
      const fin = wing(g, s * 0.28, cy + 0.3, -4.3, s, 1.9, 2.0, 0.16, 1.1, 0.55, 0.3, M.jetGrey);
      fin.rotation.z = s * 1.25;                            // ~72°: up + canted out
      box(g, s * 0.28, cy + 0.25, -4.3, 0.2, 0.4, 1.6, M.jetGrey); // root wedge
    });
    // LANDING GEAR — chunky voxel legs, wheels touch y=0 (nose + two mains)
    box(g, 0, 0.5, 3.2, 0.3, 0.55, 0.3, M.steelD);          // nose strut
    mcyl(g, 0, 0.3, 3.2, 0.3, 0.3, 0.26, RUBBER, 10).rotation.z = Math.PI / 2;
    [-1, 1].forEach(function (s) {
      box(g, s * 0.85, 0.62, 0.2, 0.3, 0.6, 0.3, M.steelD); // main strut (under trunk)
      mcyl(g, s * 0.85, 0.36, 0.2, 0.36, 0.36, 0.3, RUBBER, 10).rotation.z = Math.PI / 2;
    });
    // nav lights: red port wingtip, green starboard, white tail
    navBox(g, -4.3, cy + 0.05, -2.55, 0.16, 0xff4a3d);
    navBox(g, 4.3, cy + 0.05, -2.55, 0.16, 0x37d67a);
    navBox(g, 0, cy + 0.45, -5.35, 0.14, 0xf2f4ff);
    // Exact visible launch socket. The generic fallback multiplied the already
    // world-sized footprint by this group's 1.5 scale and spawned missiles far
    // in front of the jet, which looked like no rocket left the aircraft.
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, cy, 6.48); g.add(muzzle);
    g.userData.muzzle = muzzle; g.userData.muzzleLocal = muzzle.position.clone();
    const scale = 1.5;
    const dims = { family: "F-22-class", length: 18.6, span: 13.5, height: 5.25 };
    g.scale.setScalar(scale); g.userData.aircraftDims = dims;
    return { group: g, footW: dims.span, footL: dims.length, height: dims.height, aircraftDims: dims };
  }

  // HEAVY BOMBER — round body, sculpted swept wings, 4 DIFFERENTIATED engine
  // nacelles (dark intake lip + tapered exhaust, not four identical drums),
  // cockpit glass band, aft tail-gunner blister with twin guns, bomb-bay door
  // seams on the belly, full landing gear (nose + twin main bogies — the old
  // bomber levitated 1m off the tarmac with nothing under it) and nav lights.
  function makeBomber() {
    const g = new THREE.Group();
    const cy = 2.2;                                         // body centreline y
    const GLASS = vmat("glass", M.canopy), GUN = vmat("plastic", M.dark), RUBBER = vmat("tire", M.tire);
    // round fuselage tube + tapered nose + tail cone
    cyl(g, 0, cy, 0, 1.2, 1.2, 20.8, M.jetGrey, 16).rotation.x = Math.PI / 2;
    cyl(g, 0, cy, 11.5, 0.14, 1.2, 4.0, M.jetGrey, 16).rotation.x = Math.PI / 2;
    cyl(g, 0, cy, -11.5, 0.5, 1.2, 4.0, M.jetGrey, 16).rotation.x = Math.PI / 2;
    // cockpit glass band on the nose slope + graphite brow frame
    mbox(g, 0, cy + 0.62, 10.4, 1.4, 0.55, 1.6, GLASS);
    box(g, 0, cy + 0.95, 10.4, 1.46, 0.14, 1.7, M.jetGreyD);
    // TAIL GUNNER BLISTER — glass pod facing aft, twin gun tubes poking out
    tbox(g, 0, cy, -13.55, 0.95, 0.8, 1.4, { tz: 0.45 }, GLASS);
    [-1, 1].forEach(function (s) {
      mcyl(g, s * 0.2, cy, -14.4, 0.06, 0.06, 1.0, GUN, 8).rotation.x = Math.PI / 2;
    });
    // WINGS — sculpted: swept, tapered, thinning; roots buried in the flank
    [-1, 1].forEach(function (s) {
      wing(g, s * 1.0, cy + 0.15, 1.2, s, 12.5, 5.6, 0.5, 3.4, 0.6, 0.4, M.jetGreyD);
      // 2 nacelles per wing, slung under it, noses proud of the leading edge
      [[4.2, 1.5], [8.2, 0.2]].forEach(function (p) {
        const off = p[0], pz = p[1];
        cyl(g, s * off, 1.55, pz, 0.62, 0.62, 3.0, M.steel, 12).rotation.x = Math.PI / 2;
        mcyl(g, s * off, 1.55, pz + 1.42, 0.66, 0.62, 0.35, GUN, 12).rotation.x = Math.PI / 2;   // intake lip
        mcyl(g, s * off, 1.55, pz - 1.6, 0.34, 0.48, 0.5, GUN, 12).rotation.x = Math.PI / 2;     // exhaust
        box(g, s * off, 1.95, pz - 0.4, 0.34, 0.8, 1.4, M.jetGreyD);                             // pylon
      });
    });
    // tall swept fin (sculpted wing stood upright) + swept stabilizers
    wing(g, 0, cy + 0.8, -10.4, 1, 3.8, 3.2, 0.34, 2.0, 0.5, 0.3, M.jetGrey).rotation.z = Math.PI / 2;
    [-1, 1].forEach(function (s) {
      wing(g, s * 0.5, cy + 0.55, -11.6, s, 4.4, 2.4, 0.28, 1.5, 0.5, 0.3, M.jetGreyD);
    });
    // BOMB BAY — recessed belly panel + twin door seam strips
    box(g, 0, cy - 1.16, 2.0, 1.4, 0.14, 7.5, M.jetGreyD);
    [-1, 1].forEach(function (s) { box(g, s * 0.36, cy - 1.21, 2.0, 0.1, 0.06, 7.3, M.dark); });
    // LANDING GEAR — nose leg with twin wheels + two main bogies under the wings
    box(g, 0, 0.6, 9.0, 0.3, 1.0, 0.3, M.steelD);
    [-1, 1].forEach(function (s) {
      mcyl(g, s * 0.24, 0.42, 9.0, 0.42, 0.42, 0.24, RUBBER, 10).rotation.z = Math.PI / 2;
    });
    [-1, 1].forEach(function (s) {
      box(g, s * 2.6, 1.3, 0.2, 0.34, 1.8, 0.34, M.steelD);   // main strut (into wing)
      box(g, s * 2.6, 0.5, 0.2, 0.4, 0.28, 2.3, M.steelD);    // bogie beam
      [-0.85, 0.85].forEach(function (wz) {
        mcyl(g, s * 2.6, 0.5, 0.2 + wz, 0.5, 0.5, 0.44, RUBBER, 10).rotation.z = Math.PI / 2;
      });
    });
    // nav lights: red port wingtip, green starboard, white on the fin tip
    navBox(g, -13.4, cy + 0.15, -2.15, 0.2, 0xff4a3d);
    navBox(g, 13.4, cy + 0.15, -2.15, 0.2, 0x37d67a);
    navBox(g, 0, 6.6, -12.3, 0.18, 0xf2f4ff);
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
    // boom barrier (a striped bar across the lane), raised slightly so it reads
    const boom = box(root, cx, 1.1, CW_CZ, w * 0.9, 0.18, 0.18, M.warn);
    boom.rotation.z = 0.04;
    col(cx, CW_CZ, w * 0.9, 0.4, 0.9, 1.3);              // low collider (chest height)
    // red/white pylon posts flanking the lane
    [CW_MINZ + 1, CW_MAXZ - 1].forEach(function (z) { cyl(root, cx + 4, 0.7, z, 0.16, 0.2, 1.4, M.red, 8); });
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
          if (t._milPilot) { t.speed = 0; t.group.visible = false; continue; }
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
