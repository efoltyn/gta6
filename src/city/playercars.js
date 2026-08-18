/* ============================================================
   city/playercars.js - promoted player-car visuals.

   Ambient traffic stays on the tiny city/vehicles.js box rig. Only the car
   currently controlled by the player gets one richer child visual. This keeps
   traffic simulation and draw cost independent from garage variety.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});

  /* CAR_CABIN_V2 — every drivable body style gets ONE real cabin: a sealed
     interior tub (floor pan, door cards, firewall, rear bulkhead, headliner)
     dressed with seats, a console, a dash and a wheel you can read through the
     glass, plus the anchors a seated body and a first-person eye need. OFF →
     the pre-V2 dressing (a seat deck and four slabs on the road cars, NOTHING
     on the SUV, van and cybertruck) and no seat/eye anchors, which is the
     one-line revert. See dressCabin() below for the why. */
  if (CFG.CAR_CABIN_V2 == null) CFG.CAR_CABIN_V2 = true;

  /* ============================================================
     FREIGHT YOU CAN WALK INTO — SEMI_TRUCK_V1 / VAN_HOLD_V1
     ============================================================
     OWNER, verbatim: "a semi truck with a cargo back that you can press on
     ipad or interact with E on desktop to open the back of the truck — and
     like elevators it is a space that can be filled by things. say you rob a
     bank: you bring a van and open the back of it, or bring a truck and open
     the back, and put the money in it... and drive to your warehouse."

     Both flags author ART AND A DECLARATION, nothing else. The room, the door
     arc, the verb, the touch pill, the latch and the audit line all come from
     city/vehicle_hold.js, which was written aircraft-first and says in its own
     adoption contract that a truck adopts "with exactly this and nothing else".
     This file's whole contribution is a `root.userData.holdSpec` — plain
     JSON-safe numbers plus the NAME of the hinged door node — and vehicles.js
     hands it to CBZ.vehicleHold when the record is built. No consumer here
     knows what a moving platform is.

     SEMI_TRUCK_V1 off  → makeSemi is never dispatched and the fleet placer
                          finds no builder, so no semi exists. One line.
     VAN_HOLD_V1  off   → makeVan draws the solid cargo box it always drew and
                          publishes no holdSpec, so the van is byte-identical
                          to the shipped one (the silhouette is identical
                          EITHER way — the shell's outer faces sit exactly
                          where the slab's did; only the inside changes).

     WHY THE SEMI IS RIGID, AND WHY THAT IS THE HONEST CALL. A real tractor and
     trailer articulate about a kingpin. This engine's car sim is a single-body
     bicycle model: ONE `heading`, ONE `pos`, ONE OBB half-extent pair derived
     from `vehicleDims` (vehicles.js collisionSupport), and ONE moving-platform
     rig per hold anchored to ONE group. An articulated trailer needs a second
     body, a hitch constraint, its own collider and its own rig — a parallel
     physics system, which is precisely what the Block Law forbids. So the
     tractor and the trailer are drawn as separate sub-assemblies of ONE group
     with a real fifth-wheel gap between them: the silhouette, the stacks, the
     catwalk and the swing clearance are all there, and it turns like a long
     rigid truck rather than jack-knifing. That is a stated limitation, not an
     accident — and if a kingpin solver is ever written, this art needs no
     change: the trailer sub-group is already its own node. */
  if (CFG.SEMI_TRUCK_V1 == null) CFG.SEMI_TRUCK_V1 = true;
  if (CFG.VAN_HOLD_V1 == null) CFG.VAN_HOLD_V1 = true;

  const STYLE_ORDER = [
    "ferrari", "enzo", "veyron", "aventador", "porsche", "muscle", "lowrider",
    "tesla-s", "tesla-3", "tesla-x", "tesla-y", "hatch", "suv", "van",
    "cybertruck", "motorcycle", "helicopter", "boat",
  ];
  // Fictional-marque labels (the manufacturer universe lives in
  // city/carparts.js + the economy.js catalog; these silhouette KEYS are
  // load-bearing across racing/modshop/net code and never change).
  const STYLE_LABEL = {
    ferrari: "Falcone Rondine",
    enzo: "Falcone Tempesta",
    veyron: "Vitesse Millenne",
    aventador: "Falcone Furia",
    porsche: "Adler 901",
    muscle: "Bison Stampede",
    lowrider: "Bison Eldorado",
    "tesla-s": "Voltra Surge",
    "tesla-3": "Voltra Ion",
    "tesla-x": "Voltra Nova",
    "tesla-y": "Voltra Halo",
    hatch: "Kotori Pip",
    suv: "Bison Frontier",
    van: "Bison Hauler",
    cybertruck: "Voltra Colossus",
    motorcycle: "Superbike",
    helicopter: "Helicopter",
    boat: "Speedboat",
    // DELIBERATELY LABELLED BUT NOT IN STYLE_ORDER. `semi` is a buildable
    // silhouette (makeProcedural dispatches it, feelFor answers for it) and it
    // needs a name for the HUD and the chop shop — but STYLE_ORDER is the [C]
    // style-cycler's ring AND is exported as CBZ.cityPlayerCarStyles, which
    // racing/modshop/net code indexes into. Adding a row would renumber every
    // index in a saved game and would let the cycler turn a hatchback into a
    // 14 m artic in place. A truck is a vehicle you go and find, not a paint
    // job you toggle.
    semi: "Bison Longhauler",
  };

  // ---- per-style HANDLING FEEL hooks (GTA vehicle-class inspired) ----
  // Multipliers the driving sim can read off car._playerCarFeel. Numbers are
  // tuned from GTA class behaviour: Super/Sports = grippy + fast, Muscle =
  // grunty but loose tail, Lowrider = floaty soft, SUV/Van = heavy & numb with
  // tippy body roll, Motorcycle = razor turn + low grip wheelspin. Helicopter
  // and Boat are flagged aircraft/marine so movement code can branch.
  const FEEL = {
    ferrari:    { class: "super",  accel: 1.18, top: 1.20, turn: 1.12, grip: 1.16, brake: 1.12, drift: 0.9, roll: 0.4 },
    enzo:       { class: "super",  accel: 1.20, top: 1.22, turn: 1.10, grip: 1.18, brake: 1.12, drift: 0.9, roll: 0.4 },
    veyron:     { class: "super",  accel: 1.24, top: 1.28, turn: 1.04, grip: 1.20, brake: 1.10, drift: 0.85, roll: 0.35 },
    aventador:  { class: "super",  accel: 1.16, top: 1.18, turn: 1.14, grip: 1.16, brake: 1.10, drift: 0.95, roll: 0.4 },
    porsche:    { class: "sports", accel: 1.12, top: 1.12, turn: 1.16, grip: 1.14, brake: 1.10, drift: 0.95, roll: 0.45 },
    muscle:     { class: "muscle", accel: 1.14, top: 1.10, turn: 0.92, grip: 0.88, brake: 0.95, drift: 1.35, roll: 0.7 },
    lowrider:   { class: "lowrider", accel: 0.92, top: 0.96, turn: 0.90, grip: 0.92, brake: 0.92, drift: 1.2, roll: 1.1 },
    "tesla-s":  { class: "sports", accel: 1.20, top: 1.08, turn: 1.04, grip: 1.10, brake: 1.05, drift: 0.9, roll: 0.5 },
    "tesla-3":  { class: "sedan",  accel: 1.10, top: 1.00, turn: 1.02, grip: 1.04, brake: 1.0, drift: 0.95, roll: 0.6 },
    "tesla-x":  { class: "suv",    accel: 1.02, top: 0.96, turn: 0.86, grip: 0.92, brake: 0.95, drift: 1.0, roll: 1.0 },
    "tesla-y":  { class: "suv",    accel: 1.04, top: 0.98, turn: 0.90, grip: 0.94, brake: 0.96, drift: 1.0, roll: 0.95 },
    hatch:      { class: "compact", accel: 1.0, top: 0.94, turn: 1.10, grip: 1.0, brake: 1.0, drift: 1.0, roll: 0.6 },
    suv:        { class: "suv",    accel: 0.96, top: 0.94, turn: 0.84, grip: 0.86, brake: 0.92, drift: 1.05, roll: 1.15 },
    van:        { class: "van",    accel: 0.86, top: 0.88, turn: 0.78, grip: 0.82, brake: 0.86, drift: 1.1, roll: 1.3 },
    cybertruck: { class: "suv",    accel: 1.06, top: 1.0, turn: 0.82, grip: 0.9, brake: 0.95, drift: 1.0, roll: 1.05 },
    motorcycle: { class: "motorcycle", accel: 1.22, top: 1.14, turn: 1.4, grip: 0.84, brake: 0.9, drift: 1.5, roll: 1.0, twoWheel: true },
    helicopter: { class: "helicopter", accel: 1.0, top: 1.3, turn: 1.0, grip: 1.0, brake: 1.0, drift: 1.0, roll: 0.0, air: true },
    boat:       { class: "boat",   accel: 1.0, top: 1.1, turn: 1.0, grip: 1.0, brake: 0.7, drift: 1.4, roll: 0.6, marine: true },
    // A loaded artic is the heaviest thing on the road and every number says
    // so. `class: "van"` is not laziness — engineFlavor(vehicles.js) reads the
    // FEEL class first and maps van/suv onto the "truck" engine voice, so the
    // motor sounds like a diesel with no audio file and no new voice. The
    // handling multipliers are what make it drive like sixteen metres: it will
    // not stop, it will not turn, and the tail rolls.
    semi:       { class: "van",    accel: 0.58, top: 0.74, turn: 0.52, grip: 0.70, brake: 0.62, drift: 1.25, roll: 1.5 },
  };
  const DEFAULT_FEEL = { class: "sedan", accel: 1.0, top: 1.0, turn: 1.0, grip: 1.0, brake: 1.0, drift: 1.0, roll: 0.6 };
  // (d) THE ONE FEEL LOOKUP. FEEL above covers the road silhouettes; a
  // REGISTERED MARINE HULL (world/water_hulls.js) carries its own feel record
  // — always with marine:true, which is what every downstream branch reads.
  // Degrade-safe: no registry, or an unknown key, and this is byte-identical
  // to the `FEEL[style] || DEFAULT_FEEL` it replaces.
  function feelFor(style) {
    const f = FEEL[style];
    if (f) return f;
    if (CBZ.marineHulls) {
      const mf = CBZ.marineHulls.feel(style);
      if (mf) return mf;
    }
    return DEFAULT_FEEL;
  }

  // ---- SHINY MATERIAL API ---------------------------------------------------
  // world/carfx.js (loads BEFORE this file) publishes CBZ.vehicleMat(role,color,
  // opts) — PBR-ish materials carrying a fake-reflection env map so every car
  // reads as polished clearcoat / chromed / glassy instead of flat matte. We
  // route ALL car surfaces through this so the whole fleet uplifts at once.
  // Roles: 'paint','glass','chrome','metal','rim','tire','lightFront',
  // 'lightTail','plastic','interior'. Graceful fallback to flat lambert when
  // carfx isn't loaded (headless / gallery audit) so nothing crashes.
  function vmat(role, color, opts) {
    return (CBZ.vehicleMat) ? CBZ.vehicleMat(role, color, opts)
                            : CBZ.cmat(color == null ? 0x888888 : color, opts);
  }

  // r128 position-attribute SCULPTING (legacy geo.vertices[] is removed). Edits
  // a box's top verts in place to slope a hood / rake a roof / taper a tail so
  // sports cars read sleek instead of brick-shaped. Operates on a CLONED geo
  // (caller passes a fresh BoxGeometry) then recomputes normals so lighting is
  // correct on the new slopes. All offsets are in local mesh space.
  //   noseDrop : push the top FRONT edge (+z) DOWN  (hood slope)
  //   tailDrop : push the top REAR  edge (-z) DOWN  (fastback / decklid drop)
  //   topTaper : pull the WHOLE top inward in X     (greenhouse tumblehome)
  //   frontPinch: pull top FRONT inward in X        (pointed nose)
  //   rearPinch : pull top REAR  inward in X        (coke-bottle tail)
  function slopeBox(geo, o) {
    o = o || {};
    const pos = geo.attributes.position;
    const arr = pos.array;
    // discover bounds so edits are proportional regardless of box size
    let maxY = -Infinity, maxZ = -Infinity, minZ = Infinity, maxX = -Infinity;
    for (let i = 0; i < arr.length; i += 3) {
      if (arr[i + 1] > maxY) maxY = arr[i + 1];
      if (arr[i + 2] > maxZ) maxZ = arr[i + 2];
      if (arr[i + 2] < minZ) minZ = arr[i + 2];
      if (arr[i] > maxX) maxX = arr[i];
    }
    const yTol = Math.max(1e-4, maxY * 0.01);
    const isTop = (y) => y >= maxY - yTol;
    const dz = (maxZ - minZ) || 1;
    for (let i = 0; i < arr.length; i += 3) {
      const x = arr[i], y = arr[i + 1], z = arr[i + 2];
      if (!isTop(y)) continue;
      const front = z > 0, rear = z < 0;
      if (o.noseDrop && front) arr[i + 1] = y - o.noseDrop;
      if (o.tailDrop && rear) arr[i + 1] = y - o.tailDrop;
      // X taper: scale x toward 0. topTaper applies everywhere on the roof,
      // front/rearPinch only at the matching end (lerped along z so it cones).
      let xs = 1;
      if (o.topTaper) xs *= (1 - o.topTaper);
      if (o.frontPinch && front) xs *= (1 - o.frontPinch * ((z) / (maxZ || 1)));
      if (o.rearPinch && rear) xs *= (1 - o.rearPinch * ((z) / (minZ || -1)));
      if (xs !== 1) arr[i] = x * xs;
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
  }

  // Generates the HULL SIDE PROFILE fed to addPrism/prismGeo, now with a per-
  // point WIDTH SCALE (see prismGeo) so the body doesn't stay a constant-width
  // slab: it bulges out over each wheel (a fender arch flare) and tucks back in
  // at the waist between the axles, with pinched bumper corners at the nose and
  // tail. This is the single change that turns every road car's flanks from a
  // flat plank into a real character-lined body — applied once here, every
  // style benefits, tuned per style via the small `o` knob table (STYLE_FLARE).
  function hullRing(len, baseH, deckRear, deckFront, archZ, o) {
    o = o || {};
    const shoulderF = o.shoulderF != null ? o.shoulderF : 0.78;
    const shoulderR = o.shoulderR != null ? o.shoulderR : 0.80;
    const bulge = o.bulge != null ? o.bulge : 1.04;
    const tuck = o.tuck != null ? o.tuck : 0.97;
    const noseTuck = o.noseTuck != null ? o.noseTuck : 0.90;
    const tailTuck = o.tailTuck != null ? o.tailTuck : 0.95;
    const nose = len * 0.5, tail = -len * 0.5;
    // The fender work is WIDTH-ONLY: every bottom-edge point stays at y=0 so
    // the rocker line runs straight and the flank stays a closed wall. (The
    // first pass raised the arch points to ~0.38*baseH — that SCOOPED the
    // whole lower mid-body out of the side profile, and from any street angle
    // you saw clean through the car to the far wheels. Orbit-sheet diagnosed.)
    return [
      [tail, 0, tailTuck],
      [tail, baseH * shoulderR, 1.0],
      [deckRear, baseH, 1.0],
      [deckFront, baseH, 1.0],
      [nose, baseH * shoulderF, 1.0],
      [nose, 0, noseTuck],
      // NOT exactly y=0: r128's ShapeUtils ear-clipper emits flipped ears for
      // collinear vertices (the whole mid-flank rendered inside-out and the
      // body read see-through from the street). 2cm of rocker rise breaks the
      // collinearity and is invisible behind the sill trim.
      [archZ, 0.02, bulge],            // front fender flare (width only)
      [0, 0.03, tuck],                 // waist tuck between the axles
      [-archZ, 0.02, bulge],           // rear fender flare (width only)
    ];
  }

  const mats = new Map();
  const boxes = new Map();
  const prisms = new Map();
  const wheels = new Map();
  const spheres = new Map();
  const procTemplates = new Map();
  let ferrariTemplate = null;
  let ferrariLoading = false;
  let active = null;

  function sharedMat(key, color, opts) {
    let m = mats.get(key);
    if (m) return m;
    opts = opts || {};
    m = opts.basic
      ? new THREE.MeshBasicMaterial({ color: color })
      : new THREE.MeshLambertMaterial({
        color: color,
        emissive: opts.emissive || 0,
        emissiveIntensity: opts.ei == null ? 1 : opts.ei,
        side: opts.double ? THREE.DoubleSide : THREE.FrontSide,
      });
    m._shared = true;
    mats.set(key, m);
    return m;
  }

  // ---- ROLE materials, cached & SHINY (via carfx vmat) ---------------------
  // Per-STYLE body PAINT: a fresh shiny clearcoat material, tagged _bodyPaint so
  // recolorBody clones+recolours it per car, and _shared so the template copy is
  // never disposed. Keyed by style so each silhouette keeps its showroom default.
  function paintMat(style, color, opts) {
    const key = "paint-" + style;
    let m = mats.get(key);
    if (m) return m;
    m = vmat("paint", color, opts);
    m._bodyPaint = true; m._shared = true;
    mats.set(key, m);
    return m;
  }
  // FLEET-shared accent singletons (one each for the whole city). Cached in the
  // same `mats` map and flagged _shared by sharedMat's twin below.
  function roleMat(key, role, color, opts) {
    let m = mats.get(key);
    if (m) return m;
    m = vmat(role, color, opts);
    m._shared = true;
    mats.set(key, m);
    return m;
  }
  const glassMat = () => roleMat("glass", "glass", 0x16242e, { emissive: 0x070f15, ei: 0.25, double: true });
  const chromeMat = () => roleMat("chrome", "chrome", 0xc4ccd4, { emissive: 0x262b31, ei: 0.3 });
  const lightFrontMat = () => roleMat("lightFront", "lightFront", 0xeaf8ff, { emissive: 0xc8efff, ei: 0.9 });
  const lightTailMat = () => roleMat("lightTail", "lightTail", 0xff3344, { emissive: 0xff2233, ei: 0.95 });
  const plateMat = () => roleMat("plate", "metal", 0xe8edf2, { emissive: 0x202428, ei: 0.3 });

  function boxGeo(w, h, d) {
    const key = w + "|" + h + "|" + d;
    let geo = boxes.get(key);
    if (!geo) {
      geo = new THREE.BoxGeometry(w, h, d);
      geo._shared = true;
      boxes.set(key, geo);
    }
    return geo;
  }

  // profile points are [z, y] OR [z, y, wScale] — an optional per-point WIDTH
  // SCALE (relative to the `width` arg) so the extrusion can bulge/tuck in X as
  // it runs along its length instead of staying a constant-width slab. This is
  // what turns a flat-flanked box into a body with fender bulges over the
  // wheels and a tucked waist between them (real automotive character line),
  // while staying 100% backward compatible: points with no 3rd element behave
  // exactly as before (scale 1 = the old constant-width prism).
  function prismGeo(width, profile) {
    const key = width + "|" + profile.map((p) => p.join(",")).join("|");
    let geo = prisms.get(key);
    if (geo) return geo;
    const pos = [];
    const half = width / 2;
    function hw(i) { const p = profile[i]; return half * (p.length > 2 && p[2] != null ? p[2] : 1); }
    function tri(a, b, c) { pos.push(...a, ...b, ...c); }
    // Flank (end-cap) faces: triangulate the profile's (z,y) outline with THREE's
    // ear-clipping (ShapeUtils.triangulateShape) instead of a naive fan from
    // vertex 0. A fan silently assumes the whole polygon is star-shaped from
    // that ONE corner — true for a plain hexagon, but false the moment the
    // "floor" edge gets a fender-arch bump (hullRing): the fan folds a couple
    // of its triangles back across the shape into a stray floating flap.
    // Ear-clipping triangulates any simple polygon correctly, bump or no bump.
    const contour = profile.map((p) => new THREE.Vector2(p[0], p[1]));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    // NORMALIZE WINDING: earcut's output orientation follows the input contour
    // and can flip per-ear around near-degenerate corners — half the flank
    // rendered inside-out (see-through car sides, orbit-diagnosed). Force every
    // triangle CW in (z,y): under the direct [side*hw, y, z] mapping below,
    // CW-in-(z,y) faces +x, so the `side<0` swap gives each flank an outward face.
    for (let t = 0; t < tris.length; t++) {
      const A = contour[tris[t][0]], B = contour[tris[t][1]], C = contour[tris[t][2]];
      const area = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x);
      if (area > 0) { const tmp = tris[t][1]; tris[t][1] = tris[t][2]; tris[t][2] = tmp; }
    }
    for (let side = -1; side <= 1; side += 2) {
      for (let t = 0; t < tris.length; t++) {
        const ia = tris[t][0], ib = tris[t][1], ic = tris[t][2];
        const a = [side * hw(ia), profile[ia][1], profile[ia][0]];
        const b = [side * hw(ib), profile[ib][1], profile[ib][0]];
        const c = [side * hw(ic), profile[ic][1], profile[ic][0]];
        if (side < 0) tri(a, c, b); else tri(a, b, c);
      }
    }
    for (let i = 0; i < profile.length; i++) {
      const j = (i + 1) % profile.length;
      const a = [-hw(i), profile[i][1], profile[i][0]];
      const b = [hw(i), profile[i][1], profile[i][0]];
      const c = [hw(j), profile[j][1], profile[j][0]];
      const d = [-hw(j), profile[j][1], profile[j][0]];
      // (a,c,b)/(a,d,c): the profiles run CLOCKWISE in (z,y), so the old
      // (a,b,c)/(a,c,d) wound every sweep face INWARD — the deck/nose/tail
      // skins were invisible from outside and only the slab bolt-ons hid it
      // (isolated-hull orbit shots + a DoubleSide A/B proved it).
      tri(a, c, b); tri(a, d, c);
    }
    geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    geo._shared = true;
    prisms.set(key, geo);
    return geo;
  }

  function wheelGeo(radius, width) {
    const key = radius + "|" + width;
    let geo = wheels.get(key);
    if (!geo) {
      // 28-seg sidewall (was 16): tires read as round cylinders instead of a
      // faceted drum at the close orbit-shot distances the studio tool uses.
      geo = new THREE.CylinderGeometry(radius, radius, width, 28);
      geo._shared = true;
      wheels.set(key, geo);
    }
    return geo;
  }

  // ---- one TIRE mesh per size: rounder 28-seg sidewall (the dark rubber). The
  // bright RIM (spokes + lip + hub) is a SEPARATE merged mesh added as a child
  // so it can carry the shiny vmat('rim') material while the tire stays
  // vmat('tire'). Rims are now OPENWORK (no solid face disc except the EV aero
  // wheel) built AT THE TIRE CAP PLANE, with a dark BRAKE DISC visible in the
  // gaps between spokes — the old design centred the rim assembly INSIDE the
  // closed tire cylinder, so all that ever showed was a ~2cm proud sliver:
  // the "flat coin rim" critique. Local y=0 in rimGeo = the tire cap plane.
  // Spoke style is a per-brand signature (carparts.js rimStyleFor). ----
  const RIM_PARAMS = {
    sport5:  { n: 5,  sw: 0.16, hub: 0.18 },                 // classic alloy
    twin10:  { n: 10, sw: 0.10, hub: 0.15 },                 // Falcone twin-five
    turbine: { n: 7,  sw: 0.13, hub: 0.17 },                 // Adler/Vitesse turbine
    aero:    { n: 0,  sw: 0,    hub: 0.15, disc: 0.80 },     // Voltra flush aero cover
    steel:   { n: 4,  sw: 0.20, hub: 0.22 },                 // Kotori steelie
    sixlug:  { n: 6,  sw: 0.17, hub: 0.24 },                 // Bison truck six-spoke
    wire:    { n: 12, sw: 0.07, hub: 0.13, dish: true },     // Eldorado wire wheel
  };
  const rimGeos = new Map();
  // rimFrac = rim-face radius / tire radius — THE sidewall knob. Real cars:
  // supercar low-profile ≈ 0.70-0.75 rim (thin rubber band of sidewall),
  // sedans ≈ 0.62-0.68, muscle/SUV ≈ 0.58-0.62, work van/truck ≈ 0.50-0.58
  // (fat sidewall). The old fixed 0.86-0.92 put rubber-band tires on
  // EVERYTHING — one reason the fleet's wheels read wrong.
  function rimGeo(radius, width, style, rimFrac) {
    const p = RIM_PARAMS[style] || RIM_PARAMS.sport5;
    const rf = rimFrac || 0.7;
    const rr = radius * rf;                   // rim face radius
    const key = radius + "|" + width + "|" + (style || "sport5") + "|" + rf;
    let geo = rimGeos.get(key);
    if (geo) return geo;
    const parts = [];
    const lipY = p.dish ? width * 0.10 : 0;   // wire wheels: lip proud, face sunk = deep dish
    // outer rim LIP: an open barrel straddling the cap plane, AT the rim
    // radius — the tire cylinder beyond it reads as sidewall.
    const lip = new THREE.CylinderGeometry(rr * 1.02, rr * 0.94, width * 0.22, 24, 1, true);
    lip.translate(0, lipY, 0);
    parts.push(lip);
    // spokes: hub → lip, mostly PROUD of the cap so they read as real metalwork.
    const spokeLen = rr * 0.97, spokeW = Math.max(0.028, rr * p.sw * 1.15), spokeT = width * 0.30;
    for (let i = 0; i < p.n; i++) {
      const a = (i / p.n) * Math.PI * 2;
      const s = new THREE.BoxGeometry(spokeLen, spokeT, spokeW);
      s.translate(spokeLen * 0.5, spokeT * 0.2 - (p.dish ? width * 0.06 : 0), 0);
      // spoke runs +X with its THICKNESS along the wheel axis (Y)
      s.applyMatrix4(new THREE.Matrix4().makeRotationY(a));
      parts.push(s);
    }
    // EV aero cover: one flush disc instead of spokes.
    if (p.disc) parts.push(new THREE.CylinderGeometry(rr * p.disc / 0.88, rr * p.disc / 0.88, width * 0.10, 24).translate(0, width * 0.03, 0));
    // hub cap, proud of everything.
    parts.push(new THREE.CylinderGeometry(rr * p.hub / 0.88, rr * p.hub / 0.88, width * 0.18, 12).translate(0, width * 0.07 - (p.dish ? width * 0.06 : 0), 0));
    geo = mergeGeo(parts);
    geo._shared = true;
    rimGeos.set(key, geo);
    return geo;
  }
  // brake disc: a thin dark-steel rotor sitting just proud of the tire cap,
  // filling the openwork behind the spokes (child of the tire → spins with it,
  // which is physically right for a rotor).
  const discGeos = new Map();
  function discGeo(radius) {
    const key = radius.toFixed(4);
    let geo = discGeos.get(key);
    if (!geo) {
      geo = new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, 0.03, 20);
      geo._shared = true;
      discGeos.set(key, geo);
    }
    return geo;
  }
  // dark-steel rotor: Lambert (carfx's 'metal' role returns the CHROME
  // singleton regardless of colour — a mirror rotor would kill the openwork
  // depth contrast the new rims exist for).
  function discMat() { return sharedMat("brake-disc", 0x3f444b, { emissive: 0x101317, ei: 0.3 }); }

  // minimal BufferGeometry merge (position+normal) — local to playercars so we
  // don't depend on BufferGeometryUtils. Inputs are disposed by caller if needed.
  // NOTE: primitives like CylinderGeometry/BoxGeometry are INDEXED in r128, so
  // toNonIndexed() EXPANDS the vertex count (one vert per triangle-corner,
  // no sharing). The size budget must be computed from the POST-conversion
  // (non-indexed) geometry, not the indexed source, or the Float32Array fill
  // below overruns its buffer (this used to throw "offset is out of bounds"
  // and take down every wheel build — rimGeo/makeWheel/addWheels — so ALL
  // road cars silently fell back to the legacy box rig via vehicles.js's
  // try/catch around cityBuildPlayerCarVisual).
  function mergeGeo(geos) {
    const parts = geos.map(function (g) {
      g.computeVertexNormals();
      return g.index ? g.toNonIndexed() : g;
    });
    let n = 0;
    for (const gp of parts) n += gp.attributes.position.count;
    const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
    let pi = 0;
    for (let i = 0; i < parts.length; i++) {
      const gp = parts[i], g = geos[i];
      const pa = gp.attributes.position.array, na = gp.attributes.normal.array;
      pos.set(pa, pi); nrm.set(na, pi); pi += pa.length;
      if (gp !== g && gp.dispose) gp.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    out.computeBoundingSphere();
    return out;
  }

  // Build ONE wheel (tire + bright rim child) at the origin, axle along the
  // mesh's own Y (caller rotates z=PI/2 to lay it on its side like the old rig).
  // The tire mesh is the one tagged playerWheel + kept OUT of the static merge;
  // its rim is a child so it spins/recolours with it as a unit. Shared geos +
  // shared shiny materials → ~2 meshes per wheel, draw-call friendly after merge.
  // a SCULPTED box geometry (BoxGeometry run through slopeBox) cached by its
  // params so abundant clones reuse one shared geo. Used for sloped hood
  // clamshells / raked roof caps on the road cars (the prompt's r128 vertex trick
  // applied where a box reads better sloped than flat).
  const sculptGeos = new Map();
  function sculptGeo(w, h, d, opts) {
    const key = [w, h, d, JSON.stringify(opts)].join("|");
    let geo = sculptGeos.get(key);
    if (geo) return geo;
    geo = new THREE.BoxGeometry(w, h, d);
    slopeBox(geo, opts);
    geo._shared = true;
    sculptGeos.set(key, geo);
    return geo;
  }
  function addSculpt(root, w, h, d, x, y, z, material, opts) {
    const mesh = new THREE.Mesh(sculptGeo(w, h, d, opts), material);
    mesh.position.set(x || 0, y || 0, z || 0);
    mesh.castShadow = false;
    root.add(mesh);
    return mesh;
  }

  // tire + rim materials are FLEET-shared singletons (one black rubber, one
  // bright alloy) cached here so every wheel in the city reuses them and so
  // clearCars (which disposes only un-_shared mats) can never dispose them.
  let _tireMat = null, _rimMat = null;
  function tireMat() { if (!_tireMat) { _tireMat = vmat("tire", 0x14161a); _tireMat._shared = true; } return _tireMat; }
  function rimMat() { if (!_rimMat) { _rimMat = vmat("rim", 0xc2c9d1, { emissive: 0x20242a, ei: 0.3 }); _rimMat._shared = true; } return _rimMat; }
  function makeWheel(radius, width, rimStyle, rimFrac) {
    const tire = new THREE.Mesh(wheelGeo(radius, width), tireMat());
    tire.castShadow = false;
    tire.userData.playerWheel = true;
    // brake rotor first (visually behind the spokes), flush on the cap plane —
    // sized to sit INSIDE the rim face, whatever the sidewall fraction.
    const disc = new THREE.Mesh(discGeo(radius * (rimFrac || 0.7) * 0.86 / 0.62), discMat());
    disc.position.y = width * 0.5 + 0.004;
    disc.castShadow = false;
    tire.add(disc);
    // openwork rim AT the cap plane (rimGeo local y=0 = cap); +Y is outboard
    // before the caller's z-rotation lays the wheel on its side.
    const rim = new THREE.Mesh(rimGeo(radius, width, rimStyle, rimFrac), rimMat());
    rim.position.y = width * 0.5 + 0.01;
    rim.castShadow = false;
    tire.add(rim);
    return tire;
  }

  function sphereGeo(radius) {
    let geo = spheres.get(radius);
    if (!geo) {
      geo = new THREE.SphereGeometry(radius, 10, 6);
      geo._shared = true;
      spheres.set(radius, geo);
    }
    return geo;
  }

  function addBox(root, w, h, d, x, y, z, material) {
    const mesh = new THREE.Mesh(boxGeo(w, h, d), material);
    mesh.position.set(x || 0, y || 0, z || 0);
    mesh.castShadow = false;
    root.add(mesh);
    return mesh;
  }

  function addPrism(root, width, profile, y, material) {
    const mesh = new THREE.Mesh(prismGeo(width, profile), material);
    mesh.position.y = y || 0;
    mesh.castShadow = false;
    root.add(mesh);
    return mesh;
  }

  function addSphere(root, radius, x, y, z, material, sx, sy, sz) {
    const mesh = new THREE.Mesh(sphereGeo(radius), material);
    mesh.position.set(x || 0, y || 0, z || 0);
    mesh.scale.set(sx || 1, sy || 1, sz || 1);
    mesh.castShadow = false;
    root.add(mesh);
    return mesh;
  }

  // ---- WHEEL-ARCH LIP: a partial torus (~200° — front-low, over the top, to
  // rear-low; open at the very bottom where the tire meets the ground) hugging
  // each tire so the wheel reads as sitting IN a cut arch instead of parked
  // beside a flat slab. Cached per radius (the torus is pre-rotated at build
  // time so the caller only ever needs one more rotation, keeping it a plain
  // direct child of the car root — that matters because vehicles.js's
  // mergeStaticCarParts only bakes DIRECT children of the root into its
  // per-material buckets, not grandchildren inside a wrapper group). ----
  const archGeos = new Map();
  function archGeo(radius) {
    const key = radius.toFixed(4);
    let geo = archGeos.get(key);
    if (geo) return geo;
    const ARC = Math.PI * 1.15;                 // ~207° of coverage, ~153° gap at the bottom
    geo = new THREE.TorusGeometry(radius * 1.14, radius * 0.11, 6, 14, ARC);
    geo.rotateZ(Math.PI / 2 - ARC / 2);          // center the covered arc at the TOP
    geo._shared = true;
    archGeos.set(key, geo);
    return geo;
  }
  function addWheelArch(root, x, y, z, radius, material) {
    const mesh = new THREE.Mesh(archGeo(radius), material);
    mesh.position.set(x, y, z);
    mesh.rotation.y = Math.PI / 2;               // ring plane XY -> ZY (Y stays vertical)
    mesh.castShadow = false;
    root.add(mesh);
    return mesh;
  }

  function addWheels(root, width, length, radius, wheelWidth, archMat, rimStyle, caliperMat, rimFrac) {
    const wz = length * 0.32;
    // Lay each wheel on its side. The rim child sits at local +Y; a z-rotation of
    // +PI/2 sends local +Y to world -X, and -PI/2 sends it to world +X. So +x
    // wheels use -PI/2 (rim faces +x = OUTboard) and -x wheels use +PI/2 — keeping
    // the bright alloy face pointing OUT on both sides.
    [[width / 2, wz, -1], [-width / 2, wz, 1], [width / 2, -wz, -1], [-width / 2, -wz, 1]].forEach(function (p) {
      const wheel = makeWheel(radius, wheelWidth, rimStyle, rimFrac);
      wheel.rotation.z = p[2] * Math.PI / 2;
      wheel.position.set(p[0], radius, p[1]);
      root.add(wheel);
      if (archMat) addWheelArch(root, p[0] + Math.sign(p[0]) * 0.03, radius, p[1], radius, archMat);
      // brake CALIPER: a static block hugging the rotor at the trailing edge —
      // a root child (calipers don't spin), sitting just outboard of the cap
      // where the openwork spokes sweep past it. Merged with the statics.
      if (caliperMat) {
        const cal = new THREE.Mesh(boxGeo(0.05, radius * 0.34, radius * 0.30), caliperMat);
        cal.position.set(p[0] + Math.sign(p[0]) * (wheelWidth * 0.5 + 0.02), radius + radius * 0.12, p[1] - radius * 0.42);
        cal.castShadow = false;
        root.add(cal);
      }
    });
  }

  function collectWheels(root) {
    const out = [];
    root.traverse(function (o) {
      if ((o.userData && o.userData.playerWheel) || (o.name && /^wheel_(fl|fr|rl|rr)$/.test(o.name))) out.push(o);
    });
    root.userData.playerWheels = out;
  }

  function addRoadDetails(root, style, w, len, wheelR, baseH, cabin, paint, glass, trim, bodyYIn, cabBaseYIn) {
    const bodyY = bodyYIn == null ? wheelR * 0.42 : bodyYIn, bodyTop = bodyY + baseH;
    const peakY = cabin[1][1];
    const plate = plateMat();
    const chrome = chromeMat();             // shiny chromed trim

    // Hood/trunk breaks, mirrors, door cuts and wheel-arch brows give every
    // silhouette readable vehicle anatomy. The FACE (grille, lamps, badge,
    // bumpers, exhaust) is a BRAND design language now — applied per instance
    // via carparts.js (see makeProcedural), NOT here, so two marques sharing
    // one silhouette still read as different manufacturers.
    addBox(root, w * 0.78, 0.035, len * 0.27, 0, bodyTop + 0.02, len * 0.31, paint);
    addBox(root, w * 0.74, 0.035, len * 0.18, 0, bodyTop + 0.02, -len * 0.39, paint);
    [1, -1].forEach(function (side) {
      // mirror on the greenhouse beltline (cabin base ~bodyTop), just below the glass
      addBox(root, 0.18, 0.12, 0.28, side * (w * 0.53), bodyTop + peakY * 0.28, len * 0.15, trim);
      // door-seam pillars on the upper flank of the tall hull
      [-len * 0.14, len * 0.12].forEach(function (z) {
        addBox(root, 0.025, baseH * 0.6, 0.028, side * (w * 0.505), bodyY + baseH * 0.62, z, trim);
        // chrome door-handle inset at the beltline just ahead of each seam
        addBox(root, 0.028, 0.032, 0.11, side * (w * 0.505), bodyY + baseH * 0.80, z - 0.11, chrome);
      });
      // wheel-arch brows over each axle (top of arch ~ mid-hull)
      [len * 0.32, -len * 0.32].forEach(function (z) {
        addBox(root, 0.06, 0.09, len * 0.2, side * (w * 0.505), bodyY + baseH * 0.42, z, trim);
      });
    });
    addBox(root, w * 0.28, 0.13, 0.025, 0, bodyY + baseH * 0.32, -len * 0.5 - 0.075, plate);
    addBox(root, w * 0.96, 0.12, 0.16, 0, bodyY + 0.04, len * 0.5 - 0.03, trim);
    addBox(root, w * 0.96, 0.13, 0.14, 0, bodyY + 0.05, -len * 0.5 + 0.02, trim);
    // thin chrome window-surround on the greenhouse beltline (catches light, reads
    // as a real DLO trim strip wrapping the glass). Cheap pair of low boxes.
    [1, -1].forEach(function (side) {
      addBox(root, 0.03, 0.035, (cabin[2][0] - cabin[1][0]) * 0.9, side * (w * 0.44 * 0.94), bodyTop + peakY * 0.08, (cabin[1][0] + cabin[2][0]) * 0.5, chrome);
    });
    // total height = hull top + greenhouse peak (greenhouse base sunk into deck).
    const cabBaseY = cabBaseYIn == null ? bodyTop - peakY * 0.08 : cabBaseYIn;
    root.userData.vehicleDims = { width: w, length: len, height: cabBaseY + peakY, wheelbase: len * 0.64 };
  }

  // per-style fender-flare / tumblehome knobs fed to hullRing() + the cabin
  // profile's roof-width taper. Supercars get the most pronounced bulge +
  // tightest tumblehome (wedge-y, aggressive); sedans/EVs/hatch stay subtle so
  // they still read as clean, low-drama shapes; muscle/lowrider get wide,
  // low arches (long hood, flat fenders) instead of a wedge taper.
  const STYLE_FLARE = {
    ferrari:    { bulge: 1.045, tuck: 0.95, noseTuck: 0.88, tailTuck: 0.94, archY: 0.40, roofTuck: 0.84 },
    enzo:       { bulge: 1.03, tuck: 0.95, noseTuck: 0.87, tailTuck: 0.94, archY: 0.40, roofTuck: 0.84 },
    aventador:  { bulge: 1.03, tuck: 0.94, noseTuck: 0.86, tailTuck: 0.93, archY: 0.40, roofTuck: 0.82 },
    veyron:     { bulge: 1.045, tuck: 0.95, noseTuck: 0.89, tailTuck: 0.95, archY: 0.40, roofTuck: 0.85 },
    porsche:    { bulge: 1.04, tuck: 0.96, noseTuck: 0.90, tailTuck: 0.95, archY: 0.38, roofTuck: 0.86 },
    muscle:     { bulge: 1.045, tuck: 0.96, noseTuck: 0.92, tailTuck: 0.96, archY: 0.36, roofTuck: 0.90 },
    lowrider:   { bulge: 1.04, tuck: 0.97, noseTuck: 0.92, tailTuck: 0.96, archY: 0.34, roofTuck: 0.92 },
    "tesla-s":  { bulge: 1.03, tuck: 0.97, noseTuck: 0.91, tailTuck: 0.96, archY: 0.38, roofTuck: 0.88 },
    "tesla-3":  { bulge: 1.03, tuck: 0.97, noseTuck: 0.91, tailTuck: 0.96, archY: 0.38, roofTuck: 0.88 },
    "tesla-x":  { bulge: 1.03, tuck: 0.97, noseTuck: 0.92, tailTuck: 0.96, archY: 0.38, roofTuck: 0.90 },
    "tesla-y":  { bulge: 1.03, tuck: 0.97, noseTuck: 0.92, tailTuck: 0.96, archY: 0.38, roofTuck: 0.90 },
    hatch:      { bulge: 1.03, tuck: 0.97, noseTuck: 0.92, tailTuck: 0.96, archY: 0.40, roofTuck: 0.90 },
  };

  // per-style CLEARCOAT tuning fed straight to vmat('paint', color, opts):
  // supercars run higher metalness + lower roughness + a hotter envMapIntensity
  // (wet-look showroom paint), the EV sedans stay a notch back (clean but not
  // showroom-wet), muscle/hatch are the most "factory" matte-ish clearcoat.
  // Undefined styles fall back to carfx's own defaults (0.55/0.38/1.0).
  const PAINT_OPTS = {
    ferrari:    { metalness: 0.62, roughness: 0.22, envMapIntensity: 1.35 },
    enzo:       { metalness: 0.63, roughness: 0.20, envMapIntensity: 1.4 },
    aventador:  { metalness: 0.64, roughness: 0.19, envMapIntensity: 1.4 },
    veyron:     { metalness: 0.66, roughness: 0.16, envMapIntensity: 1.45 },
    porsche:    { metalness: 0.60, roughness: 0.24, envMapIntensity: 1.3 },
    muscle:     { metalness: 0.48, roughness: 0.36, envMapIntensity: 1.0 },
    lowrider:   { metalness: 0.70, roughness: 0.14, envMapIntensity: 1.5 },   // deep wet candy paint
    "tesla-s":  { metalness: 0.56, roughness: 0.30, envMapIntensity: 1.15 },
    "tesla-3":  { metalness: 0.56, roughness: 0.30, envMapIntensity: 1.15 },
    "tesla-x":  { metalness: 0.54, roughness: 0.33, envMapIntensity: 1.1 },
    "tesla-y":  { metalness: 0.54, roughness: 0.33, envMapIntensity: 1.1 },
    hatch:      { metalness: 0.48, roughness: 0.38, envMapIntensity: 1.0 },
  };

  /* ============================================================
     THE CABIN — one builder, every body style (CAR_CABIN_V2)

     OWNER: "really make interior of car exist like how interior of building
     with glass exists and you can see npcs from outside" — and, separately,
     that his own car looks EMPTY coming toward the camera.

     Two different faults were producing one symptom:

     (1) THE ROOM WAS NOT A ROOM. The road cars had five loose slabs floating
         inside a transparent tub — a seat deck, two seat backs, a bench, a
         dash. Nothing enclosed anything, so a low camera looking through the
         side glass saw the INSIDE of the far flank, which is a backface, which
         is culled, which is daylight. The SUV had a single grey block; the van
         and the cybertruck had nothing at all behind their windows.
         A building interior does not read because it has furniture. It reads
         because it is a SEALED BOX with a glass wall — city/buildings.js's
         see-inside discipline. So this builds the box first (floor pan, two
         door cards, a firewall, a rear bulkhead, a headliner) and only then
         puts furniture in it. That is also what makes first person possible:
         you cannot sit inside a room that has no floor and no walls.

     (2) NOTHING WAS ANCHORED. `cabinInfo` carried four numbers, enough to
         park a merged blob roughly in the middle of the greenhouse and no
         more. This publishes the frame the rest of the wave needs — the two
         front SEATS (cushion height and all), the WHEEL, the FLOOR, and the
         EYE — so city/vehicles.js can seat the player's real dressed rig at
         the wheel and city/view.js can put a camera in his head, both reading
         the same authored numbers instead of each inventing their own.

     PROPORTIONS ARE REAL, NOT EYEBALLED. The cabin is derived off the same
     total-height law the silhouettes already obey: floor pan ~0.29·H, cushion
     a hand's width above it, driver's eye ~0.81·H (a Model 3's eye ellipse
     sits ~1.20 m up a 1.44 m car), headrest crown just under the eye — which
     is why the reference photo shows a head ABOVE the headrests, not behind
     them. Every number below falls out of the cabin box it is handed, so an
     SUV gets an SUV's high hip point and a supercar gets a supercar's low one
     with no per-style table to keep in sync.

     COST. Everything uses the ONE shared interior material, so the whole cabin
     merges into the interior bucket city/vehicles.js already makes — the car
     gains geometry, not draw calls. The single exception is the instrument
     face, which is emissive (a lit cluster is the whole reason a cabin reads
     at dusk) and therefore one extra bucket; that is the price and it is
     behind CAR_CABIN_V2 with everything else.
  ============================================================ */
  // Screens are authored 0.07 proud of their bezel, not the 0.025 SCREEN LAW
  // minimum, because vehicles.js's sealSeams() inflates every box thinner than
  // 0.09 on its thin axis by 0.04 — which eats 0.04 of any gap between two
  // thin boxes. 0.07 authored is ~0.03 shipped, i.e. still legal after the
  // seam pass. (Meshes that must NOT be inflated carry userData.noSeal.)
  const SCREEN_GAP = 0.07;
  const rings = new Map();
  function ringGeo(r, tube) {
    const key = r.toFixed(3) + "|" + tube.toFixed(3);
    let geo = rings.get(key);
    if (!geo) {
      geo = new THREE.TorusGeometry(r, tube, 5, 14);
      geo._shared = true;
      rings.set(key, geo);
    }
    return geo;
  }
  function addRing(root, r, tube, x, y, z, material) {
    const mesh = new THREE.Mesh(ringGeo(r, tube), material);
    mesh.position.set(x || 0, y || 0, z || 0);
    mesh.castShadow = false;
    root.add(mesh);
    return mesh;
  }
  /* WHY A CABIN NEEDS ITS OWN LIGHT.
     The first plates of this work were geometrically correct and read as a
     black void behind tinted glass — worse than the empty tub they replaced,
     because at least the old floating slab caught the sun. The reason is the
     same one world/carfx.js writes up at length about the glass itself: this
     is a LAMBERT world with no bounce and no ambient occlusion budget, and a
     cabin is a ROOFED ROOM. The sun physically cannot reach any surface in it,
     so every one of them renders at the ambient floor, i.e. near black, and
     then gets multiplied by a 0.35-opacity pane on the way out.
     carfx's fix for the pane was an emissive LIFT, and the same fix works one
     layer in: a small self-glow standing in for the bounce light a real cabin
     gets off its own glass. Three tones, because a real interior is not one
     colour and the read from outside depends entirely on contrast:
       interior       dark structure — floor, door cards, bulkheads, console
       interior-lite  upholstery and headliner: the big pale surfaces that ARE
                      what you see through a window from above
       interior-screen the one lit panel. It deliberately says NOTHING — no
                      needle, no number — because the game does not simulate a
                      value for it and a gauge that lies is worse than no gauge
                      (city/carcluster.js's own rule). It is a backlit panel,
                      and that is a true thing to be.
     Cost: two shared materials for the whole fleet, i.e. two extra merged
     buckets on an enclosed car, and only with CAR_CABIN_V2 on.

     The lift is carried mostly by the EMISSIVE and only a little by the base
     colour, on purpose. A pale base is the obvious way to make an interior
     show and it is the wrong one: the windscreen lets direct sun onto the dash
     roll, a pale Lambert under that sun clips to white, and the plate came
     back with a glowing bar across every car in traffic. A mid base plus a
     standing self-glow reads at the SAME level in sun and in shadow, which is
     what "a room with its own light" actually means.

     THE KEY IS "interior-v2", NOT "interior", AND THAT IS LOAD-BEARING.
     sharedMat is a first-caller-wins cache keyed on a string, and the pre-V2
     fallbacks below still ask for `sharedMat("interior", 0x2a2f36)` — one of
     them on the line ABOVE the dressCabin call that was supposed to replace
     it. So the flag-off material won the cache before the flag-on material
     ever asked for it, and every cabin in the fleet was silently drawn in the
     unlit dark tone while this file's own audit reported the lit one. It cost
     an entire measured iteration to find, because nothing is wrong with the
     geometry, the flag, the merge or the light — only with the NAME. A tone
     that belongs to V2 gets a key that belongs to V2. */
  const cabinMat = () => sharedMat("interior-v2", 0x333a44, { emissive: 0x1a202a, ei: 0.85 });
  const cabinLiteMat = () => sharedMat("interior-lite", 0x545b66, { emissive: 0x343b46, ei: 0.85 });
  const clusterMat = () => sharedMat("interior-screen", 0x0e141b, { emissive: 0x1d4560, ei: 0.9 });

  /* dressCabin(root, o) -> cabinInfo (also written to root.userData.cabinInfo)
       o.cabW    cabin base width (the glass tub's base width)
       o.zR/zF   cabin base rear/front z
       o.zTR/zTF roof rear/front z (optional; defaults to a 20% rake each end)
       o.roofW   roof width (optional)
       o.beltY   beltline: where the glass starts
       o.roofY   headliner height
       o.floorY  cabin floor pan top
       o.rows    1 or 2 seat rows (optional; derived from cabin length)     */
  function dressCabin(root, o) {
    if (CFG.CAR_CABIN_V2 === false) return null;
    const M = cabinMat(), L = cabinLiteMat(), SCRN = clusterMat();
    const cabW = o.cabW, halfW = cabW * 0.5;
    const zR = Math.min(o.zR, o.zF), zF = Math.max(o.zR, o.zF);
    const cl = Math.max(0.60, zF - zR), cz = (zR + zF) * 0.5;
    const beltY = o.beltY, roofY = o.roofY;
    const gh = Math.max(0.16, roofY - beltY);
    const roofW = o.roofW != null ? o.roofW : cabW * 0.86;
    const zTR = o.zTR != null ? o.zTR : zR + cl * 0.20;
    const zTF = o.zTF != null ? o.zTF : zF - cl * 0.20;
    const floorY = Math.min(o.floorY, beltY - 0.26);
    const wallH = Math.max(0.14, beltY - floorY);

    // ---- the driving position, derived once and shared by everything -----
    // THE COWL SITS AT THE SILL. This started at beltY + 0.20·gh — 8 cm PROUD
    // of the window line — and it quietly wrecked the whole wave: a dash that
    // stands above the sill is a wall across the bottom of the windscreen, and
    // it ate the headrests and the driver's head in every traffic plate while
    // the audit cheerfully reported them present. Real cowl point and real
    // beltline are within a couple of centimetres of each other (that is what
    // makes a modern car's glasshouse read as glass), and once they are, the
    // things ABOVE the dash — heads, headrests, the top of the wheel rim — are
    // exactly what an outside camera sees.
    const dashTopY = beltY + gh * 0.05;
    const dashZ = zF - 0.20;
    const wheelZ = dashZ - 0.16;
    const seatX = Math.min(0.42, cabW * 0.24);            // +X is the car's LEFT: LHD
    // THE REACH. A driver's chest sits ~0.40 m off the rim and his EYE ~0.55 —
    // and that second number is not cosmetic, it is the whole first-person
    // view: the eye below is offset forward of the seat to where a face
    // actually is, so a seat parked too close to the wheel puts the camera
    // inside its own occupant's chest. (It did. The first live plate of the
    // driver's seat was a wall of shirt at the near plane, and the cabin
    // behind it was fine the whole time.)
    const seatZ = Math.max(zR + 0.34, wheelZ - 0.60);
    // THE HIP POINT. SAE calls it H30 — the cushion's height over the floor
    // pan — and on a sedan it is ~0.10-0.15 m, not the third of the cabin wall
    // the first pass used. Getting it wrong is not a detail: it decides where
    // the seat BACK tops out, and a seat back that stops below the window sill
    // is a seat nobody outside the car can see.
    const cushionY = floorY + Math.max(0.10, wallH * 0.17);
    // THE EYE. A driver's eye sits just above the beltline — a Model 3's eye
    // ellipse is ~0.12 m over its window sill, an SUV's a little more, and NO
    // car puts it halfway up the glass however tall the greenhouse is (which
    // is why this is a clamped offset off the SILL and not a fraction of the
    // greenhouse: a van's glass is twice a coupe's and its driver is not
    // sitting twice as high). Clamped clear of the header at the top.
    const eyeY = Math.max(beltY + 0.04,
      Math.min(beltY + Math.max(0.12, Math.min(gh * 0.30, 0.42)), roofY - 0.20));
    // A seat back reaches the SILL — that is what makes the shoulder line of a
    // car interior, and it is the surface a high side camera actually lands on.
    const backH = Math.max(0.30, Math.min(0.72, beltY + gh * 0.06 - cushionY));
    const wheelR = Math.min(0.185, cabW * 0.108);
    const wheelY = Math.max(cushionY + 0.28, dashTopY - 0.11);
    const rearZ = Math.max(zR + 0.30, seatZ - 0.80);
    const rows = o.rows || ((rearZ < seatZ - 0.55) ? 2 : 1);

    // ---- THE BOX. Sealed on five sides; the sixth is the glass. -----------
    addBox(root, cabW * 0.96, 0.06, cl, 0, floorY - 0.03, cz, M);              // floor pan
    [1, -1].forEach(function (s) {
      const dc = addBox(root, 0.06, wallH, cl * 0.96, s * (halfW - 0.05), floorY + wallH * 0.5, cz, M);
      dc.userData.noSeal = true;                                              // exact door-card thickness
      addBox(root, 0.05, 0.05, 0.20, s * (halfW - 0.11), beltY - 0.13, cz + cl * 0.14, M);   // door pull
      addBox(root, 0.05, 0.10, cl * 0.5, s * (halfW - 0.10), beltY - 0.05, cz, M);           // armrest / beltline pad
    });
    const fwH = Math.max(0.12, dashTopY - 0.05 - floorY);
    const fw = addBox(root, cabW * 0.94, fwH, 0.07, 0, floorY + fwH * 0.5, zF - 0.05, M);    // firewall
    fw.userData.noSeal = true;
    const rw = addBox(root, cabW * 0.94, wallH, 0.07, 0, floorY + wallH * 0.5, zR + 0.05, M);// rear bulkhead
    rw.userData.noSeal = true;
    // headliner: PALE. It is the single biggest surface a camera above the
    // beltline sees through the glass, and a dark one turns the whole cabin
    // into a hole.
    const hl = addBox(root, roofW * 0.96, 0.035, Math.max(0.30, (zTF - zTR) * 0.98), 0,
      roofY - 0.028, (zTR + zTF) * 0.5, L);
    hl.userData.noSeal = true;

    // ---- SEATS. Base, back, headrest — the three shapes that read as a car
    //      seat from outside, and the crown of the headrest stops just under
    //      the eye so a driver's head sits ABOVE it (the reference photo).
    function seat(x, z, bh, hr) {
      addBox(root, 0.46, 0.13, 0.48, x, cushionY - 0.065, z, L);
      const back = addBox(root, 0.46, bh, 0.12, x, cushionY + bh * 0.5, z - 0.24, L);
      back.rotation.x = -0.12;                                                 // recline
      // bolsters: two dark uprights framing the pale back. Cheap, and the
      // difference between "a slab" and "a seat" at any distance.
      [0.20, -0.20].forEach(function (bx) {
        const bo = addBox(root, 0.07, bh * 0.86, 0.16, x + bx, cushionY + bh * 0.5, z - 0.22, M);
        bo.rotation.x = -0.12;
      });
      // HEADREST, in the PALE upholstery tone. A real one is ~0.25 m tall and
      // it is the ONLY part of a seat that clears the window sill — so it is
      // the entire outside read, the one shape a passing camera can use to
      // tell a furnished cabin from an empty one. Its base sits on the sill
      // and its crown stands a hand above, which puts it either side of the
      // driver's head rather than under it.
      if (hr) addBox(root, 0.25, 0.22, 0.13, x, cushionY + bh + 0.10, z - 0.27, L);
    }
    seat(seatX, seatZ, backH, true);
    seat(-seatX, seatZ, backH, true);
    if (rows > 1) {
      const rbh = Math.max(0.24, backH * 0.80);
      addBox(root, cabW * 0.80, 0.13, 0.44, 0, cushionY - 0.065, rearZ, L);
      const rb = addBox(root, cabW * 0.80, rbh, 0.12, 0, cushionY + rbh * 0.5, rearZ - 0.22, L);
      rb.rotation.x = -0.16;
      [seatX, -seatX].forEach(function (x) {
        addBox(root, 0.22, 0.14, 0.11, x, cushionY + rbh + 0.07, rearZ - 0.25, L);
      });
      // parcel shelf behind the bench, so the backlight has something under it
      addBox(root, cabW * 0.86, 0.05, Math.max(0.12, (rearZ - 0.30) - (zR + 0.09)), 0,
        beltY - 0.05, (rearZ - 0.30 + zR + 0.09) * 0.5, L);
    }
    // centre console + transmission tunnel between the front seats
    addBox(root, Math.max(0.16, cabW * 0.14), Math.max(0.14, cushionY + 0.10 - floorY),
      cl * 0.40, 0, floorY + (cushionY + 0.10 - floorY) * 0.5, seatZ - 0.06, M);

    // ---- DASH. A slab, a MATTE top roll, a binnacle hood over the cluster,
    //      two screens. The roll is deliberately the darkest thing in the
    //      cabin: seen from outside through a raked windscreen it is a
    //      1.8 x 0.34 m plate aimed at the sun, and the first plate of this
    //      wave came back with it as the single brightest object in the
    //      frame — a glowing bar across every car in traffic. Real dash tops
    //      are matte black for exactly the same reason (windscreen veiling
    //      glare), so the fix and the physics agree.
    addBox(root, cabW * 0.92, 0.15, 0.34, 0, dashTopY - 0.075, dashZ, M);
    addBox(root, cabW * 0.92, 0.04, 0.34, 0, dashTopY - 0.005, dashZ, M);
    const cowl = addBox(root, 0.44, 0.11, 0.24, seatX, dashTopY + 0.015, dashZ - 0.03, M);
    cowl.userData.noSeal = true;
    // instrument cluster: bezel face at (dashZ - 0.03) - 0.12, screen SCREEN_GAP proud of it
    const bezelFrontZ = dashZ - 0.15;
    const cl1 = addBox(root, 0.34, 0.10, 0.03, seatX, dashTopY - 0.015, bezelFrontZ - SCREEN_GAP - 0.015, SCRN);
    cl1.userData.noSeal = true;
    cl1.userData.carScreen = SCREEN_GAP;
    // centre stack screen, standing proud of the dash face
    const cs = addBox(root, Math.min(0.34, cabW * 0.20), 0.19, 0.03, 0, dashTopY + 0.03,
      dashZ - 0.17 - SCREEN_GAP - 0.015, SCRN);
    cs.rotation.x = 0.10;
    cs.userData.noSeal = true;
    cs.userData.carScreen = SCREEN_GAP;

    // ---- THE WHEEL. A real rim, a hub and three spokes, raked back at the
    //      top the way a column puts it — the single most recognisable object
    //      in a car interior, and the thing hands can be seen holding.
    const col = addBox(root, 0.07, 0.07, 0.22, seatX, wheelY - 0.05, wheelZ + 0.11, M);
    col.rotation.x = 0.42;
    const rim = addRing(root, wheelR, 0.028, seatX, wheelY, wheelZ, M);
    rim.rotation.x = 0.42;
    addBox(root, 0.10, 0.09, 0.05, seatX, wheelY, wheelZ, M);                  // hub
    [0, 2.094, -2.094].forEach(function (a) {
      const sp = addBox(root, 0.035, wheelR * 0.92, 0.025,
        seatX + Math.sin(a) * wheelR * 0.45,
        wheelY + Math.cos(a) * wheelR * 0.45 * Math.cos(0.42),
        wheelZ - Math.cos(a) * wheelR * 0.45 * Math.sin(0.42), M);
      sp.rotation.set(0.42, 0, -a);
      sp.userData.noSeal = true;
    });

    // ---- header furniture: mirror + two visors. Small, and the difference
    //      between "a box with windows" and "a car you are sitting in".
    const mir = addBox(root, 0.26, 0.075, 0.045, 0, roofY - 0.10, zTF - 0.02, M);
    mir.userData.noSeal = true;
    [1, -1].forEach(function (s) {
      const vz = addBox(root, roofW * 0.34, 0.03, 0.17, s * roofW * 0.24, roofY - 0.075, zTF - 0.04, M);
      vz.rotation.x = -0.5;
      vz.userData.noSeal = true;
    });

    const info = {
      // legacy four (city/vehicles.js occSeatAnchor has read these for ages)
      baseY: beltY, peakY: gh, cx: cz, w: cabW,
      // the V2 frame
      floorY: floorY, roofY: roofY, beltY: beltY,
      zRear: zR, zFront: zF, rows: rows,
      cushionY: cushionY, seatX: seatX, seatZ: seatZ, rearSeatZ: rows > 1 ? rearZ : null,
      wheel: { x: seatX, y: wheelY, z: wheelZ, r: wheelR },
      // THE FIRST-PERSON EYE. Offset forward of the seat frame by the depth
      // of a chest plus a face: entities/character.js puts the eye boxes
      // 0.315 of a head in front of the neck axis, and the torso is ~0.14
      // deep either side of it, so anything less than ~0.17 here seats the
      // camera INSIDE the driver rather than behind his eyes.
      eye: { x: seatX, y: eyeY, z: seatZ + 0.19 },
      dressed: true,
    };
    root.userData.cabinInfo = info;
    return info;
  }

  function makeRoadCar(style) {
    const root = new THREE.Group();
    const flare = STYLE_FLARE[style] || STYLE_FLARE["tesla-3"];
    const paint = paintMat(style, ({
      "tesla-s": 0xd1262f, "tesla-3": 0x67717b, "tesla-x": 0x185bd6,
      "tesla-y": 0x1470e3, porsche: 0xf3cf39, aventador: 0xf28c28,
      ferrari: 0xd1262f, enzo: 0xe02025, veyron: 0x202225,
      muscle: 0x161922, lowrider: 0x7d2bd6, hatch: 0x2ec4d6,
    })[style] || 0xd1262f, PAINT_OPTS[style]);   // shiny clearcoat, _bodyPaint-tagged for per-car recolour
    const dark = glassMat();   // reflective tinted glass

    // ===================================================================
    // PROPORTION LAW (drives the whole silhouette off total height H):
    //   wheelR     ~ 0.16*H        (tire diameter ~ 0.33*H)
    //   bodyY      = wheelR*0.42   (hull bottom just below axle)
    //   baseH      = hullFrac*H    (hull is the DOMINANT band, ~0.60-0.66*H)
    //   greenhouse peak ~ ghFrac*baseH  (0.34-0.46, NEVER > baseH)
    // Result: hull ~62% of H, greenhouse ~25% of H, wheel dia ~ half hull.
    // ===================================================================
    // Per-body table: [W, L, H, hullFrac, cabinLenFrac, cabinCenterX(frac of L), ghFrac]
    // Per-body table now carries REAL wheel math (derived from published tire
    // specs, e.g. 235/45R18 → 669mm on a 1443mm-tall Model 3):
    //   tD   = tire DIAMETER as a fraction of H. Real cars: supercar 0.55-0.60
    //          (the body is LOW, so the same ~700mm tire dominates), sedan/EV
    //          0.45-0.49, hatch 0.45, muscle 0.50, SUV 0.43 of a taller H.
    //          The old fixed 0.32 is why the whole fleet looked like it was
    //          rolling on shopping-cart casters.
    //   rf   = rim-face radius / tire radius (sidewall profile): supercar
    //          ~0.72 rubber-band, sedan ~0.66, muscle 0.62, lowrider wire 0.55.
    //   ride = hull-bottom clearance as a fraction of wheelR (rocker height):
    //          supercar ~0.38 (sills hug the ground), sedan ~0.55, crossover 0.62.
    const SPEC = {
      "tesla-s":  { W: 1.95, L: 4.70, H: 1.50, hull: 0.62, cab: 0.46, cx: 0.00, gh: 0.42, tD: 0.50, rf: 0.68, ride: 0.36 },
      "tesla-3":  { W: 1.92, L: 4.55, H: 1.50, hull: 0.62, cab: 0.46, cx: 0.00, gh: 0.42, tD: 0.48, rf: 0.67, ride: 0.40 },
      "tesla-x":  { W: 2.05, L: 4.85, H: 1.72, hull: 0.66, cab: 0.50, cx: -0.02, gh: 0.44, tD: 0.46, rf: 0.64, ride: 0.52 },
      "tesla-y":  { W: 2.02, L: 4.78, H: 1.66, hull: 0.65, cab: 0.50, cx: -0.02, gh: 0.44, tD: 0.46, rf: 0.64, ride: 0.48 },
      porsche:    { W: 1.94, L: 4.45, H: 1.40, hull: 0.64, cab: 0.42, cx: -0.05, gh: 0.40, tD: 0.54, rf: 0.71, ride: 0.30 },
      ferrari:    { W: 2.05, L: 4.60, H: 1.30, hull: 0.66, cab: 0.38, cx: -0.05, gh: 0.34, tD: 0.58, rf: 0.72, ride: 0.30 },
      enzo:       { W: 2.04, L: 4.62, H: 1.30, hull: 0.66, cab: 0.38, cx: -0.05, gh: 0.34, tD: 0.56, rf: 0.72, ride: 0.38 },
      aventador:  { W: 2.05, L: 4.65, H: 1.28, hull: 0.66, cab: 0.38, cx: -0.05, gh: 0.34, tD: 0.60, rf: 0.73, ride: 0.26 },
      veyron:     { W: 2.05, L: 4.55, H: 1.32, hull: 0.66, cab: 0.38, cx: -0.04, gh: 0.36, tD: 0.58, rf: 0.72, ride: 0.26 },
      muscle:     { W: 2.05, L: 4.95, H: 1.45, hull: 0.64, cab: 0.40, cx: -0.10, gh: 0.40, tD: 0.52, rf: 0.62, ride: 0.36 },
      lowrider:   { W: 2.04, L: 5.05, H: 1.42, hull: 0.66, cab: 0.44, cx: -0.02, gh: 0.36, tD: 0.43, rf: 0.57, ride: 0.22 },
      hatch:      { W: 1.84, L: 4.05, H: 1.50, hull: 0.60, cab: 0.50, cx: -0.04, gh: 0.46, tD: 0.45, rf: 0.63, ride: 0.40 },
    };
    const s = SPEC[style] || SPEC["tesla-3"];
    const w = s.W, len = s.L, H = s.H;
    const wheelR = +((s.tD || 0.46) * H / 2).toFixed(3);
    const bodyY = +(wheelR * (s.ride || 0.52)).toFixed(3);   // rocker clearance off the REAL wheel
    // hull band height rebalanced so roofline stays ≈ H despite the taller
    // ride: bodyY + baseH + gh*baseH ≈ H  →  baseH = (H − bodyY)/(1 + gh)
    const baseH = +((H - bodyY) / (1 + s.gh)).toFixed(3);
    const bodyTop = bodyY + baseH;
    const peakY = +(s.gh * baseH).toFixed(3);         // slim greenhouse, < baseH
    const cabLen = len * s.cab;
    const cabCx = len * s.cx;                          // cabin center (rearward = -)
    // cabin profile (z,y[,wScale]): [rear-bottom, rear-top, front-top, front-bottom].
    // top is shorter footprint than base (windshield/backlight rake) AND, via the
    // 3rd element (prismGeo's width-scale), NARROWER than the base — real
    // tumblehome, the glasshouse leaning inward toward the roof instead of
    // rising as a constant-width box. Base z half-extent = cabLen/2.
    const cb = cabLen * 0.5, ct = cabLen * 0.30;       // base vs top half-length (rake)
    const cabin = [
      [cabCx - cb, 0, 1.0], [cabCx - ct, peakY, flare.roofTuck], [cabCx + ct, peakY, flare.roofTuck], [cabCx + cb, 0, 1.0],
    ];

    // ---- HULL: the dominant painted mass, with a beltline + raked nose/tail ----
    // Deck top must enclose the cabin footprint so the greenhouse never overhangs
    // the sloped hood/tail. Derive deck edges from the cabin z-extent.
    const cabinRearZ = cabin[0][0], cabinFrontZ = cabin[cabin.length - 1][0];
    const deckRear = Math.max(-len * 0.5, Math.min(-len * 0.30, cabinRearZ - 0.14));
    const deckFront = Math.min(len * 0.5, Math.max(len * 0.28, cabinFrontZ + 0.14));
    // beltline at baseH; nose & tail dip slightly so the hull reads sculpted;
    // fender arches bulge over each axle with a tucked waist between them
    // (hullRing, driven by this style's STYLE_FLARE knobs).
    const archZ = len * 0.32;             // matches addWheels' wz = length*0.32
    const bodyProfile = hullRing(len, baseH, deckRear, deckFront, archZ, flare);
    addPrism(root, w, bodyProfile, bodyY, paint);

    // ---- GREENHOUSE: the cabin IS GLASS. A tinted trapezoidal prism (raked
    // ends via the profile, tumblehome via roofTuck width-scale) with a painted
    // ROOF CAP and painted B-PILLARS on top of it. This replaces the old
    // painted-shell-plus-glass-decal sandwich whose rake panels tipped the
    // wrong way (orbit-sheet diagnosed: windshields lay forward over the hood
    // like open flaps). A glass tub needs zero rake math, always reads as a
    // real glasshouse from any angle, and is fewer meshes.
    const cabW = w * 0.94;                              // greenhouse nearly full-width:
    // the old 0.86 left a wide bare shelf each side of the glass that read as
    // detached floating decks from 3/4 views (probe-diagnosed); real cars
    // start the tumblehome at the beltline edge, so the tub base hugs it
    const cabBaseY = bodyTop - peakY * 0.08;
    addPrism(root, cabW, cabin, cabBaseY, dark);        // the glass tub
    // CABIN INTERIOR (CAR_CABIN_V2): a sealed, dressed room behind the real
    // glass — see dressCabin's header. The pre-V2 five loose slabs are the
    // `else` arm below and remain the exact one-line revert.
    if (!dressCabin(root, {
      cabW: cabW, zR: cabin[0][0], zF: cabin[3][0],
      zTR: cabin[1][0], zTF: cabin[2][0], roofW: cabW * flare.roofTuck,
      beltY: cabBaseY, roofY: cabBaseY + peakY,
      floorY: bodyY + baseH * 0.18,
    })) {
      // pre-V2 dressing. The material is minted HERE, inside the fallback,
      // not above the dressCabin call — see the "interior-v2" note by the
      // cabin materials: minting it early handed the flag-OFF tone to the
      // flag-ON cabin through sharedMat's first-caller-wins cache.
      const interior = sharedMat("interior", 0x2a2f36);
      addBox(root, cabW * 0.88, Math.max(0.06, peakY * 0.22), Math.max(0.3, (cb + ct)), 0, cabBaseY + peakY * 0.12, cabCx, interior);   // seat deck / floor mass
      [1, -1].forEach(function (side) {
        addBox(root, cabW * 0.3, peakY * 0.62, 0.1, side * cabW * 0.22, cabBaseY + peakY * 0.5, cabCx - 0.12, interior);               // front seat backs
      });
      addBox(root, cabW * 0.7, peakY * 0.5, 0.1, 0, cabBaseY + peakY * 0.42, cabCx - cb * 0.62, interior);                             // rear bench back
      addBox(root, cabW * 0.8, 0.12, 0.24, 0, cabBaseY + peakY * 0.34, cabCx + cb * 0.62, interior);                                   // dash
      const swheel = addBox(root, 0.3, 0.26, 0.05, cabW * 0.22, cabBaseY + peakY * 0.4, cabCx + cb * 0.42, interior);                  // steering wheel
      swheel.rotation.x = -0.5;
      // occupant anchor: vehicles.js seats a visible low-poly driver/passenger
      // off this frame (baseY = tub base, peakY = tub height, cx = cabin centre)
      root.userData.cabinInfo = { baseY: cabBaseY, peakY: peakY, cx: cabCx, w: cabW };
    }

    // Decklid behind the cabin (not on fastbacks).
    const fastback = /^(ferrari|enzo|aventador|veyron)$/.test(style);
    if (!fastback) {
      const lidFront = cabin[0][0] - 0.02;
      const lidRear = deckRear - 0.04;
      const lidLen = Math.max(0.12, lidFront - lidRear);
      addBox(root, w * 0.72, 0.06, lidLen, 0, bodyTop + 0.02, (lidFront + lidRear) * 0.5, paint);
    }

    // ---- painted structure over the glass tub: roof cap + B-pillars ----
    // cabin corners: [0]=rear bottom, [1]=rear top, [2]=front top, [3]=front bottom
    const rB = cabin[0], rT = cabin[1], fT = cabin[2], fB = cabin[3];
    const roofW = cabW * flare.roofTuck;
    const roofLen = Math.max(0.2, fT[0] - rT[0]);
    // roof cap: slightly proud of the glass top so the paint edge reads as the
    // roof skin + header rails from every angle.
    addBox(root, roofW + 0.02, 0.05, roofLen + 0.06, 0, cabBaseY + peakY + 0.012, (fT[0] + rT[0]) * 0.5, paint);
    // pillars: painted bars along the glass edges so the roof visually
    // connects to the body instead of hovering on a dark band. A/C pillars
    // lie in the rake plane (one rotation.x each); B-pillars are vertical.
    const bpZ = (fT[0] + rT[0]) * 0.5;
    const pillarX = (cabW * 0.5 + roofW * 0.5) * 0.5 - 0.005;
    [1, -1].forEach(function (side) {
      const bp = addBox(root, 0.035, peakY * 0.94, 0.05, side * pillarX, cabBaseY + peakY * 0.48, bpZ, paint);
      bp.castShadow = false;
      // A-pillar (front rake edge) and C-pillar (rear rake edge)
      [[fB, fT, 1], [rB, rT, -1]].forEach(function (edge) {
        const bot = edge[0], top = edge[1];
        const dz = top[0] - bot[0], dy = top[1] - bot[1];
        const el = Math.hypot(dz, dy);
        const pm = addBox(root, 0.05, el * 1.02, 0.055, side * pillarX, cabBaseY + (bot[1] + top[1]) * 0.5, (bot[0] + top[0]) * 0.5, paint);
        pm.rotation.x = Math.atan2(dz, dy);
        pm.castShadow = false;
      });
    });
    // paint cowl at the windshield base so the glass meets bodywork, not air.
    addBox(root, cabW * 0.94, 0.10, 0.12, 0, cabBaseY + fB[1] + 0.05, fB[0] - 0.02, paint);

    // SLEEK NOSE: a thin painted hood clamshell over the front deck, sculpted to
    // SLOPE DOWN toward the nose (r128 vertex trick via slopeBox). Sports cars get
    // a steep wedge drop + a pinched point; teslas/hatch a gentler fall. This is
    // what turns a flat-top hull into a car that "leans forward".
    const noseDrop = ({ ferrari: 0.16, enzo: 0.16, aventador: 0.17, veyron: 0.13, porsche: 0.13, muscle: 0.08, lowrider: 0.07, hatch: 0.07 })[style] || 0.09;
    const hoodFront = Math.min(len * 0.5, deckFront);
    const hoodRear = cabin[cabin.length - 1][0] - 0.04;   // up to the windshield base
    const hoodLen = Math.max(0.4, hoodFront - hoodRear);
    addSculpt(root, w * 0.9, baseH * 0.16, hoodLen, 0, bodyTop - baseH * 0.05, (hoodFront + hoodRear) * 0.5, paint,
      { noseDrop: noseDrop, frontPinch: /ferrari|enzo|aventador|veyron|porsche/.test(style) ? 0.22 : 0.1 });

    // sculpted lower body: contrasting rocker/sill + a slim front splitter so the
    // nose reads as a real bumper, not a flat box face.
    const sill = sharedMat("sill-" + style, 0x14171c);
    addBox(root, w + 0.04, 0.14, len * 0.9, 0, wheelR + 0.08, 0, sill);
    addBox(root, w * 0.96, 0.1, 0.18, 0, wheelR + 0.06, len * 0.5 - 0.04, sill);   // front splitter
    addRoadDetails(root, style, w, len, wheelR, baseH, cabin, paint, dark, sill, bodyY, cabBaseY);

    // ---- per-model accents (Y anchors re-based on the TALL hull) ----
    const wingY = bodyTop + 0.14;   // wing/spoiler height above the tall hull
    if (style === "ferrari") {
      addBox(root, w * 0.22, 0.22, 0.08, -w * 0.29, bodyY + baseH * 0.34, len * 0.5 + 0.04, sill);
      addBox(root, w * 0.22, 0.22, 0.08, w * 0.29, bodyY + baseH * 0.34, len * 0.5 + 0.04, sill);
      addBox(root, w * 0.34, 0.18, 0.08, 0, bodyY + baseH * 0.30, len * 0.5 + 0.05, paint);
    }
    if (style === "aventador") addBox(root, w * 0.76, 0.12, 0.16, 0, wingY, -len * 0.42, paint);
    if (style === "porsche") addBox(root, w * 0.72, 0.1, 0.14, 0, wingY - 0.04, -len * 0.44, paint);
    if (style === "enzo") {
      addBox(root, w * 0.92, 0.1, 0.12, 0, wingY - 0.06, -len * 0.44, paint);
      addBox(root, w * 0.32, 0.1, 0.12, 0, wheelR + 0.34, len * 0.51, sharedMat("enzo-black", 0x101317));
    }
    if (style === "veyron") {
      const orange = sharedMat("veyron-orange", 0xff6b20);
      addBox(root, w + 0.02, 0.17, len * 0.94, 0, wheelR + 0.12, 0, orange);
      addBox(root, w * 0.74, 0.12, 0.14, 0, wingY - 0.02, -len * 0.42, paint);
    }
    if (style === "muscle") {
      const black = sharedMat("muscle-black", 0x0c0e12);
      // hood scoop + twin racing stripes up the long hood (on the tall hull deck)
      addBox(root, w * 0.34, 0.14, 0.6, 0, bodyTop + 0.06, len * 0.28, black);
      addBox(root, 0.18, 0.02, len * 0.9, -0.28, bodyTop + 0.005, 0, black);
      addBox(root, 0.18, 0.02, len * 0.9, 0.28, bodyTop + 0.005, 0, black);
      // chunky rear wing
      addBox(root, w * 0.78, 0.08, 0.16, 0, wingY + 0.08, -len * 0.46, black);
    }
    if (style === "lowrider") {
      const chrome = sharedMat("low-chrome", 0xc9ccd2, { emissive: 0x2a2d33, ei: 0.4 });
      const roof = sharedMat("low-roof", 0xf2f3f6);
      // chrome rocker trim down both sides + a painted hardtop roof cap
      addBox(root, w + 0.06, 0.07, len * 0.92, 0, wheelR + 0.05, 0, chrome);
      addBox(root, roofW + 0.04, 0.06, roofLen * 0.96, 0, cabBaseY + peakY + 0.035, (fT[0] + rT[0]) * 0.5, roof);
    }
    if (style === "hatch") {
      const black = sharedMat("hatch-black", 0x14171c);
      // roof-edge spoiler over the tailgate
      addBox(root, w * 0.82, 0.06, 0.14, 0, cabBaseY + peakY + 0.02, cabin[0][0] - 0.04, black);
    }
    // brand-signature rims + brake rotors; performance cars flash red calipers.
    const rimStyle = CBZ.carParts ? CBZ.carParts.rimStyleFor(style) : "sport5";
    const calMat = /ferrari|enzo|aventador|veyron|porsche|muscle/.test(style)
      ? sharedMat("caliper-red", 0xc23030, { emissive: 0x2a0808, ei: 0.4 })
      : sharedMat("caliper-dk", 0x3a3f45);
    addWheels(root, w + 0.08, len, wheelR, Math.max(0.26, wheelR * 0.92), sill, rimStyle, calMat, s.rf || 0.66);
    // anchor frame for the carparts.js brand face + per-model identity, applied
    // per INSTANCE in makeProcedural (templates stay faceless so one silhouette
    // can serve several marques). Read-only; cloned by reference with userData.
    root.userData.partCtx = {
      w: w, len: len, style: style,
      frontZ: len * 0.5, rearZ: -len * 0.5,
      baseY: wheelR + 0.10,
      headY: bodyY + baseH * 0.58, tailY: bodyY + baseH * 0.55,
      noseTopY: bodyTop, bodyY: bodyY, baseH: baseH,
      roofY: cabBaseY + peakY, roofZ: (fT[0] + rT[0]) * 0.5,
      roofW: roofW, roofLen: roofLen,
      paint: paint,
    };
    return root;
  }

  function makeCybertruck() {
    const root = new THREE.Group();
    // brushed-stainless body: a FRESH 'paint'-role standard material driven to
    // high metalness (cold steel sheen), _bodyPaint so it recolours per car.
    // (Was vmat('metal') — but that role returns the fleet-wide CHROME
    // SINGLETON with colour/opts ignored, so tagging it _bodyPaint made
    // recolorBody repaint every chrome trim piece on every car built after
    // the first cybertruck template. 'paint' is fresh-per-call by contract.)
    const silver = (function () {
      let m = mats.get("cyber-silver"); if (m) return m;
      m = vmat("paint", 0xa8afb2, { metalness: 0.86, roughness: 0.32, envMapIntensity: 1.2 }); m._bodyPaint = true; m._shared = true; mats.set("cyber-silver", m); return m;
    })();
    const creaseM = sharedMat("cyber-crease", 0xd4d9dc, { emissive: 0x2e3236, ei: 0.35 });
    const trim = roleMat("cyber-trim", "plastic", 0x20262a);
    const glass = glassMat();
    // PROPORTION LAW: pickup, tall hull + cab forward of an open bed. H~1.80.
    const w = 2.2, len = 5.35, H = 1.80;
    const wheelR = +(0.245 * H).toFixed(3);           // tire dia 0.49H (Cybertruck 285/65R20 = 879mm / 1795mm — Edmunds)
    const bodyY = +(wheelR * 0.62).toFixed(3);        // truck rocker rides high
    const baseH = +(0.58 * H).toFixed(3);             // ~1.04 tall hull (pickup body)
    const bodyTop = bodyY + baseH;
    // body shell (tall hull). bed crease via a lower trim band.
    addBox(root, w, baseH, len, 0, bodyY + baseH * 0.5, 0, silver);
    addBox(root, w + 0.08, 0.2, len * 0.82, 0, bodyY + 0.12, -0.08, trim);
    // CYBERTRUCK WEDGE identity: a body-COLORED angular cab prism forward, on the
    // tall hull deck (base sunk in), with INSET dark glass (no doubled dark mass).
    const peakY = +(0.40 * baseH).toFixed(3);         // slim cab band, < baseH
    const cabBaseY = bodyTop - peakY * 0.08;
    const cabCx = len * 0.05;                          // cab forward of an open bed
    const cb = len * 0.40 * 0.5, ct = len * 0.40 * 0.30;
    const cabProf = [[cabCx - cb, 0], [cabCx - ct, peakY], [cabCx + ct, peakY], [cabCx + cb, 0]];
    addPrism(root, w * 0.93, cabProf, cabBaseY, silver);
    // inset glass: windshield (front rake) + backlight (rear rake), ~0.7 of face.
    const rT = cabProf[1], fT = cabProf[2], rB = cabProf[0], fB = cabProf[3];
    function cyberGlass(zT, zB, sign) {
      const dz = zT - zB, dy = peakY;
      const fl = Math.hypot(dz, dy);
      const nz = (dy / fl) * sign, ny = (-dz / fl) * sign;
      const midZ = (zT + zB) * 0.5, midY = cabBaseY + peakY * 0.5;
      const m = new THREE.Mesh(boxGeo(w * 0.78, fl * 0.82, 0.02), glass);
      // proud, not inset: the cab prism is a thin shell, so glass pushed INWARD
      // sits fully behind opaque paint and never renders (see rakeGlass above).
      m.position.set(0, midY + ny * 0.016, midZ + nz * 0.016);
      m.rotation.x = -Math.atan2(dz, dy);
      m.material.polygonOffset = true; m.material.polygonOffsetFactor = -1;
      root.add(m);
    }
    cyberGlass(fT[0], fB[0], 1);
    cyberGlass(rT[0], rB[0], -1);
    // side windows
    [1, -1].forEach(function (side) {
      const sw = addBox(root, 0.02, peakY * 0.72, (ct + cb), side * (w * 0.93 * 0.5 + 0.011), cabBaseY + peakY * 0.55, cabCx, glass);
      sw.material.polygonOffset = true; sw.material.polygonOffsetFactor = -1;
    });
    // CAR_CABIN_V2: the wedge had four panes and an empty stainless box behind
    // them. Same cabin builder as every other body — the truck just gets a
    // higher hip point out of its own taller floor.
    dressCabin(root, {
      cabW: w * 0.93, zR: rB[0], zF: fB[0], zTR: rT[0], zTF: fT[0], roofW: w * 0.80,
      beltY: cabBaseY, roofY: cabBaseY + peakY,
      floorY: bodyY + baseH * 0.18,
    });
    [1, -1].forEach(function (side) {
      addBox(root, 0.08, 0.2, len * 0.84, side * (w * 0.51), bodyY + baseH * 0.3, 0, trim);
      addBox(root, 0.16, 0.13, 0.3, side * (w * 0.54), bodyTop - 0.08, len * 0.32, trim);   // mirrors
      // the SINGLE stamped crease line, nose to tail at door-top height — the
      // signature fold. Colour-true bright lambert so it reads as a caught
      // highlight whatever the body recolours to.
      addBox(root, 0.022, 0.05, len * 0.98, side * (w * 0.5 + 0.005), bodyY + baseH * 0.74, 0, creaseM);
    });
    // full-width LIGHT BAR capping the nose top edge (headlight-contract
    // emissive; the Voltra face brow lands just below and the two stack into
    // one tall bright band, the truck's face signature).
    addBox(root, w * 0.92, 0.035, 0.06, 0, bodyTop - 0.02, len * 0.5 - 0.01, lightFrontMat());
    // bed: ribbed roll-cover + bright rail caps + tailgate seam
    addBox(root, w * 0.84, 0.08, len * 0.3, 0, bodyTop + 0.04, -len * 0.29, trim);   // dark tonneau cover over bed
    [-0.18, -0.255, -0.33, -0.405].forEach(function (fz) {
      addBox(root, w * 0.78, 0.022, 0.055, 0, bodyTop + 0.088, len * fz, trim);      // roll-cover ribs
    });
    [1, -1].forEach(function (side) {
      addBox(root, 0.06, 0.03, len * 0.34, side * (w * 0.5 - 0.03), bodyTop + 0.015, -len * 0.29, creaseM);   // bed rail caps
    });
    addBox(root, w * 0.68, 0.025, 0.02, 0, bodyTop - 0.34, -len * 0.5 - 0.005, trim);   // tailgate seam
    // CHUNKY ANGULAR arch flares (the real truck's cue) instead of the round
    // torus lips: solid trapezoid prisms proud of each flank, wheel below.
    [len * 0.32, -len * 0.32].forEach(function (wz) {
      [1, -1].forEach(function (side) {
        const flare = addPrism(root, 0.18, [
          [wz - wheelR * 1.62, 0.30], [wz - wheelR * 0.78, wheelR * 2.2],
          [wz + wheelR * 0.78, wheelR * 2.2], [wz + wheelR * 1.62, 0.30],
        ], 0, trim);
        flare.position.x = side * (w * 0.5 + 0.03);
      });
    });
    addWheels(root, w + 0.13, len, wheelR, 0.34, null, "sixlug", sharedMat("caliper-dk", 0x3a3f45), 0.56);
    root.userData.vehicleDims = { width: w, length: len, height: cabBaseY + peakY, wheelbase: len * 0.68 };
    // Voltra face anchors (full-width LED brow + tail blade land on the wedge
    // hull faces); the angular EV truck skips the bumper blocks.
    root.userData.partCtx = {
      w: w, len: len, style: "cybertruck",
      frontZ: len * 0.5, rearZ: -len * 0.5,
      baseY: wheelR + 0.12, headY: bodyTop - 0.09, tailY: bodyTop - 0.06,
      noseTopY: bodyTop, bodyY: bodyY, baseH: baseH,
      roofY: cabBaseY + peakY, roofZ: cabCx, roofW: w * 0.8, roofLen: cb + ct,
      paint: silver, noBumpers: true,
    };
    return root;
  }

  // --- a tall boxy 3-box SUV: high greenhouse, roof rails, beefy fenders. ---
  function makeSUV() {
    const root = new THREE.Group();
    const paint = paintMat("suv", 0x2e3a4a, { metalness: 0.45, roughness: 0.42, envMapIntensity: 0.9 });
    const dark = glassMat();
    const trim = roleMat("suv-trim", "plastic", 0x14171c);
    // colour-true satin alu — vmat('metal') would hand back the bright chrome
    // singleton (colour ignored), and rack hardware should read duller than
    // the brightwork trim.
    const rail = sharedMat("suv-rail", 0x596069, { emissive: 0x1a1d22, ei: 0.3 });
    // PROPORTION LAW: tall 3-box SUV. H~1.74, tall hull + upright greenhouse.
    const w = 2.16, len = 5.1, H = 1.74;
    const wheelR = +(0.23 * H).toFixed(3);            // tire dia 0.46H (Grand Cherokee 245/70R17 → 0.44 + art bump)
    const bodyY = +(wheelR * 0.60).toFixed(3);
    const baseH = +(0.60 * H).toFixed(3);             // ~1.04 tall hull
    const bodyTop = bodyY + baseH;
    // hull as a hullRing prism (not a flat box): near-full height/width at the
    // very ends (shoulderF/R close to 1 keeps the 3-box SUV silhouette boxy)
    // but with real fender arches bulging over each wheel + a tucked waist,
    // so it doesn't read as a slab with wheels bolted beside it.
    const archZ = len * 0.32;
    const suvProfile = hullRing(len, baseH, -len * 0.47, len * 0.40, archZ,
      { shoulderF: 0.90, shoulderR: 0.92, archY: 0.36, bulge: 1.04, tuck: 0.97, noseTuck: 0.90, tailTuck: 0.95 });
    addPrism(root, w, suvProfile, bodyY, paint);
    addBox(root, w + 0.06, 0.22, len * 0.96, 0, bodyY + 0.12, 0, trim);   // wide fender flares
    // upright BODY-COLORED greenhouse (paint), base sunk ~8% into the hull deck.
    // Taller than the old 0.42*baseH: a 3-box SUV reads "boxy" mainly through a
    // substantial upright greenhouse, not just a flat-topped hull.
    const peakY = +(0.50 * baseH).toFixed(3);         // ~0.52 tall upright cabin
    const cabBaseY = bodyTop - peakY * 0.08;
    const cabCx = -len * 0.02;                         // slightly rearward (long hood)
    const cb = len * 0.52 * 0.5, ct = len * 0.52 * 0.38;   // upright => gentle rake
    // glass-tub cab (same pattern as makeRoadCar): tinted prism + painted
    // roof + pillars + interior. The old paint-shell + proud-glass sandwich
    // read as a small hut with fins on a limo body (orbit-diagnosed).
    const cabWs = w * 0.94, roofTuck = 0.88;
    const suvCab = [[cabCx - cb, 0, 1.0], [cabCx - ct, peakY, roofTuck], [cabCx + ct, peakY, roofTuck], [cabCx + cb, 0, 1.0]];
    addPrism(root, cabWs, suvCab, cabBaseY, dark);
    const rB = suvCab[0], rT = suvCab[1], fT = suvCab[2], fB = suvCab[3];
    const roofWs = cabWs * roofTuck;
    const sideMidZ = (rT[0] + fT[0]) * 0.5;
    const sideLen = (fT[0] - rT[0]) * 1.0;
    // CAR_CABIN_V2: the SUV's whole interior used to be ONE grey block — the
    // biggest greenhouse in the fleet with the least to look at inside it.
    // Same builder as every road car; the block is the flag-off fallback.
    if (!dressCabin(root, {
      cabW: cabWs, zR: rB[0], zF: fB[0], zTR: rT[0], zTF: fT[0], roofW: roofWs,
      beltY: cabBaseY, roofY: cabBaseY + peakY,
      floorY: bodyY + baseH * 0.18, rows: 2,
    })) {
      addBox(root, cabWs * 0.88, peakY * 0.45, cb + ct, 0, cabBaseY + peakY * 0.24, cabCx, sharedMat("interior", 0x2a2f36));
    }
    addBox(root, roofWs + 0.02, 0.08, sideLen + 0.08, 0, cabBaseY + peakY + 0.028, sideMidZ, paint);   // roof skin
    addBox(root, 0.07, 0.08, sideLen, w * 0.36, cabBaseY + peakY + 0.11, sideMidZ, rail);  // roof rails
    addBox(root, 0.07, 0.08, sideLen, -w * 0.36, cabBaseY + peakY + 0.11, sideMidZ, rail);
    [-0.28, 0.28].forEach(function (fz) {                                                  // rack crossbars between the rails
      addBox(root, w * 0.72 + 0.14, 0.045, 0.07, 0, cabBaseY + peakY + 0.13, sideMidZ + sideLen * fz, rail);
    });
    const pillarXs = (cabWs * 0.5 + roofWs * 0.5) * 0.5 - 0.005;
    [1, -1].forEach(function (side) {
      const bp = addBox(root, 0.04, peakY * 0.94, 0.06, side * pillarXs, cabBaseY + peakY * 0.48, sideMidZ, paint);
      bp.castShadow = false;
      [[fB, fT], [rB, rT]].forEach(function (edge) {
        const bot = edge[0], top = edge[1];
        const dz = top[0] - bot[0], dy = top[1] - bot[1];
        const el = Math.hypot(dz, dy);
        const pm = addBox(root, 0.055, el * 1.02, 0.06, side * pillarXs, cabBaseY + (bot[1] + top[1]) * 0.5, (bot[0] + top[0]) * 0.5, paint);
        pm.rotation.x = Math.atan2(dz, dy);
        pm.castShadow = false;
      });
    });
    [1, -1].forEach(function (side) {
      addBox(root, 0.16, 0.12, 0.24, side * (w * 0.55), bodyTop + 0.10, fB[0] - 0.05, trim);  // door mirrors at the A-pillar base
      // door seam insets + chrome handles at the beltline (front/rear door split)
      [-len * 0.135, len * 0.115].forEach(function (z) {
        addBox(root, 0.02, baseH * 0.5, 0.03, side * (w * 0.502), bodyY + baseH * 0.58, z, trim);
        addBox(root, 0.028, 0.032, 0.11, side * (w * 0.502), bodyY + baseH * 0.80, z - 0.12, chromeMat());
      });
    });
    // tailgate ladder (overlander cue): two rails + three rungs, in the gap
    // between the rear spare (|x| < ~0.49) and the Bison vertical tails (~0.76+)
    [0.54, 0.72].forEach(function (fx) {
      addBox(root, 0.035, baseH * 0.6, 0.04, fx, bodyY + baseH * 0.52, -len * 0.5 - 0.035, rail);
    });
    [0.30, 0.52, 0.74].forEach(function (fy) {
      addBox(root, 0.24, 0.032, 0.045, 0.63, bodyY + baseH * fy, -len * 0.5 - 0.035, rail);
    });
    const suvRoofY = cabBaseY + peakY + 0.05;
    addSphere(root, wheelR * 1.05, 0, bodyY + baseH * 0.56, -len * 0.51, trim, 1, 1, 0.3);   // rear spare, sized off the real wheel radius (was fixed at 0.46 — bigger than the road wheels on every SUV size)
    addWheels(root, w + 0.14, len, wheelR, 0.34, trim, "sixlug", sharedMat("caliper-dk", 0x3a3f45), 0.58);
    root.userData.vehicleDims = { width: w, length: len, height: suvRoofY + 0.05, wheelbase: len * 0.66 };
    // Bison face anchors (tall slatted grille, quad lamps, vertical tails).
    root.userData.partCtx = {
      w: w, len: len, style: "suv",
      frontZ: len * 0.5, rearZ: -len * 0.5,
      baseY: wheelR + 0.16, headY: bodyY + baseH * 0.52, tailY: bodyY + baseH * 0.55,
      noseTopY: bodyTop, bodyY: bodyY, baseH: baseH,
      roofY: suvRoofY, roofZ: sideMidZ, roofW: roofWs, roofLen: sideLen,
      paint: paint,
    };
    return root;
  }

  /* ============================================================
     THE HOLD SHELL — the one primitive both freight bodies are made of.
     ============================================================
     A cargo box the player can stand inside cannot be a solid slab, and it
     cannot be a single box flipped to DoubleSide either: r128 lights a
     back-face with the front face's normal, so an inside-out box is a room lit
     from the wrong side with no thickness at the door reveal. It is FIVE thin
     solid panels — floor, two sides, roof, front bulkhead — whose OUTER faces
     sit exactly where the old slab's faces sat, so the silhouette from thirty
     metres is unchanged and the inside is a room.

     Every panel is marked `noSeal`. vehicles.js's sealSeams inflates thin
     boxes and skirts wide flat ones 0.45 m DOWNWARD to hole-proof exterior
     panel work — correct on a wing mirror, catastrophic on a headliner, which
     is exactly why dressCabin already marks its own pieces. A roof panel
     dragged 0.45 m into the bay would hang through the cargo it is meant to
     cover. (`noSeal` is read by vehicles.js:507.)

     Returns nothing: it draws into `root` and the caller owns the numbers. */
  function addHoldShell(root, o) {
    const t = o.wall == null ? 0.11 : o.wall;              // panel thickness
    const halfW = o.w / 2, zC = (o.zFront + o.zBack) / 2, len = o.zFront - o.zBack;
    const mark = function (m) { m.userData.noSeal = true; m.userData.holdShell = true; return m; };
    // FLOOR — the deck you stand on. Its TOP is the hold's declared floor.
    mark(addBox(root, o.w, t, len, 0, o.floorTop - t / 2, zC, o.deckMat || o.mat));
    // SIDES, inner faces at ±(halfW - t)
    [1, -1].forEach(function (s) {
      mark(addBox(root, t, o.roofY - o.floorTop, len, s * (halfW - t / 2), (o.floorTop + o.roofY) / 2, zC, o.mat));
    });
    // ROOF
    mark(addBox(root, o.w, t, len, 0, o.roofY + t / 2, zC, o.mat));
    // FRONT BULKHEAD — the wall the load stops against under braking.
    mark(addBox(root, o.w, o.roofY - o.floorTop + t * 2, t, 0, (o.floorTop + o.roofY) / 2, o.zFront - t / 2, o.bulkMat || o.mat));
  }

  /* ============================================================
     THE TAILGATE — a bottom-hinged door that IS the ramp.
     ============================================================
     city/vehicle_hold.js's ramp is ONE slab hinged at the sill, rotating about
     local X: standing up it seals the aperture, laid down aft it is a real
     walk surface the ground query (CBZ.mpGroundAt) serves to feet AND to the
     drive sim. So a drop tailgate gives us the door and the ramp for one node
     and one arc — which is also what a moving truck, a step-deck trailer and a
     livestock float actually have. Barn doors would need a second hinge axis,
     a second arc and would still leave nothing to walk up.

     GEOMETRY CONTRACT (the sign convention is vehicle_hold's, not ours): the
     node's ORIGIN is the hinge, on the sill; the leaf hangs from it toward -Z
     and -Y at rotation 0 (lying flat, pointing aft). rotation.x = +closedRx
     stands it up across the opening; rotation.x = openRx lays it down with the
     toe on the ground. The node is a GROUP so vehicles.js's mergeStaticCarParts
     — which only ever bakes direct MESH children of the root — cannot swallow
     it, and it is NAMED because makeProcedural caches one template per style
     and hands out clone(true)s that share userData BY REFERENCE (its own
     comment, line ~1973): the live node is always re-resolved off the instance
     with getObjectByName, exactly as the rotor/prop handles are. */
  function addTailgate(root, name, o) {
    const node = new THREE.Group();
    node.name = name;
    node.position.set(0, o.sillTop, o.sillZ);
    const t = o.leafT == null ? 0.09 : o.leafT;
    // the leaf, hanging aft of the hinge and half a thickness BELOW it, so at
    // rotation 0 its top face is the sill plane and it is a flush deck
    const leaf = addBox(node, o.w, t, o.len, 0, -t / 2, -o.len / 2, o.mat);
    leaf.userData.noSeal = true;
    // ribs across the leaf: grip when it is a ramp, strength when it is a door
    const ribs = Math.max(3, Math.round(o.len / 0.42));
    for (let i = 0; i < ribs; i++) {
      const rz = -o.len * (i + 0.5) / ribs;
      addBox(node, o.w * 0.94, 0.035, 0.06, 0, -t - 0.012, rz, o.ribMat || o.mat).userData.noSeal = true;
    }
    // the hardware you already saw on the shut door, now ON the door
    if (o.trimMat) {
      addBox(node, 0.05, 0.05, o.len * 0.9, 0, -t - 0.02, -o.len / 2, o.trimMat).userData.noSeal = true;
      [1, -1].forEach(function (s) {
        addBox(node, 0.05, 0.05, o.len * 0.86, s * (o.w * 0.46), -t - 0.02, -o.len / 2, o.trimMat).userData.noSeal = true;
      });
      // handle bar, at what is head height when the door is shut
      addBox(node, o.w * 0.34, 0.05, 0.05, 0, -t - 0.05, -o.len * 0.72, o.trimMat).userData.noSeal = true;
    }
    node.rotation.x = o.closedRx;                    // shut until somebody opens it
    root.add(node);
    return node;
  }

  /* ============================================================
     THE SEMI — a day-cab tractor and a step-deck box trailer.
     ============================================================
     BUILT FROM THE INSIDE OUT, the same discipline island_military.js's cargo
     plane was built with, and for the same reason: the point of the object is
     the room, so the room is authored first and the truck is wrapped round it.

     THE BED HEIGHT IS SOLVED, NOT PICKED. The tailgate must reach the ground
     from the sill, and the arc that lays it there is asin(sillTop / leafLen) —
     but the leaf ALSO has to be tall enough to cover the aperture when it
     stands up, so leafLen is pinned by the interior height, not free. A
     standard 1.45 m fifth-wheel deck with a 2.3 m leaf lands the toe 0.4 m in
     the AIR (asin overflows: 1.45 > 2.3·sin is fine, but the slope is 39°, and
     the shipped cargo-plane ramp — the steepest surface the ground sim has
     ever been asked to drive — is 25°). So this is a STEP-DECK: bed at 0.95 m,
     which is the real answer the freight industry reached for exactly this
     problem, and the ramp comes out at 24°. Choose the trailer that fits the
     ramp, do not fight the arithmetic.

     Numbers, once, in metres, local frame, nose at +Z (this engine's forward:
     vehicles.js drives toward +Z at heading 0). */
  const SEMI = (function () {
    const w = 2.50, len = 14.5, wallT = 0.11;
    const noseZ = len / 2, tailZ = -len / 2;              // +7.25 / -7.25
    const cabBackZ = 2.85, gapZ = 2.35;                   // sleeper rear / trailer nose
    const floorTop = 0.95, roofY = 3.20;                  // THE ROOM: 2.25 m of headroom
    const boxTop = roofY + wallT;                         // 3.31 — the trailer's outside
    const holdFrontZ = gapZ - wallT;                      // inner face of the bulkhead
    const holdW = w - wallT * 2;                          // 2.28 clear width
    const leaf = 2.30;                                    // tailgate leaf length
    // asin, not a guess: this is the angle at which the toe touches y = 0.
    const openRx = -Math.asin(Math.min(0.98, floorTop / leaf));
    return {
      w: w, len: len, noseZ: noseZ, tailZ: tailZ, cabBackZ: cabBackZ, gapZ: gapZ,
      wallT: wallT, floorTop: floorTop, roofY: roofY, boxTop: boxTop,
      holdFrontZ: holdFrontZ, holdW: holdW, leaf: leaf, openRx: openRx,
      // 1.53 rad, not π/2: a leaf standing DEAD vertical is coplanar with the
      // trailer's rear face and z-fights it down the whole 2.3 m seam. Three
      // hundredths of a radian leans the top 3 cm proud and the fight is gone.
      closedRx: 1.53,
      cabRoofY: 3.15, wheelR: 0.52,
    };
  })();

  function makeSemi() {
    const S = SEMI;
    const root = new THREE.Group();
    const paint = paintMat("semi", 0xd8dde3, { metalness: 0.46, roughness: 0.42, envMapIntensity: 0.9 });
    const boxPaint = paintMat("semi-box", 0xeceff2, { metalness: 0.30, roughness: 0.60, envMapIntensity: 0.6 });
    const dark = glassMat();
    const trim = roleMat("semi-trim", "plastic", 0x1b1f24);
    const chrome = chromeMat();
    // scuffed steel — the bed, and the tailgate. It has to be a DIFFERENT tone
    // from the body: photographed on the Freeport's concrete, a ramp painted in
    // the trailer's own white lay on pale hardstanding and vanished, so the one
    // plate that is entirely about "the back is open and you can walk up it"
    // showed no ramp at all. Bare steel is also what a real load ramp is.
    // …and the ROLE is "plastic", not "metal", for the same reason. carfx's
    // metal role carries the fake-reflection env map, and a dark metal under
    // the Freeport's midday sun renders BRIGHTER than the white body it is
    // supposed to contrast with — the first re-shoot changed the colour and the
    // ramp stayed pale. "plastic" is the matte family, so the number authored
    // here is the tone that appears. It is also what makes the load space read
    // as a room: a dark floor under pale walls, instead of a white tunnel.
    const deck = roleMat("semi-deck", "plastic", 0x41474f);
    const w = S.w, wheelR = S.wheelR;

    /* ---- 1. THE ROOM ------------------------------------------------------
       Authored before anything it is inside of. */
    addHoldShell(root, {
      w: w, zFront: S.gapZ, zBack: S.tailZ, floorTop: S.floorTop, roofY: S.roofY,
      wall: S.wallT, mat: boxPaint, deckMat: deck, bulkMat: paint,
    });
    // corrugation: vertical ribs down both flanks, which is what makes a
    // trailer read as a trailer and not as a shipping crate
    const ribN = 14;
    for (let i = 0; i < ribN; i++) {
      const rz = S.tailZ + (S.gapZ - S.tailZ) * (i + 0.5) / ribN;
      [1, -1].forEach(function (s) {
        addBox(root, 0.03, S.roofY - S.floorTop - 0.12, 0.11, s * (w / 2 + 0.012), (S.floorTop + S.roofY) / 2, rz, trim);
      });
    }
    // skirt + underride bar: the two things that stop a trailer looking like a
    // box on stilts, and the bar is where the tail lamps live
    [1, -1].forEach(function (s) {
      addBox(root, 0.05, 0.62, (S.gapZ - S.tailZ) * 0.62, s * (w / 2 - 0.03), S.floorTop - 0.42, S.tailZ + (S.gapZ - S.tailZ) * 0.46, trim);
    });
    addBox(root, w * 0.92, 0.14, 0.10, 0, 0.42, S.tailZ - 0.16, trim);
    [1, -1].forEach(function (s) {
      addBox(root, 0.10, 0.46, 0.10, s * (w * 0.40), 0.66, S.tailZ - 0.14, trim);
    });
    // mudflaps behind the bogie
    [1, -1].forEach(function (s) {
      addBox(root, 0.42, 0.44, 0.03, s * (w * 0.36), 0.28, S.tailZ + 1.30, trim);
    });
    // roof rail + three clearance markers across the trailer's leading edge
    const marker = sharedMat("semi-marker", 0xffb347, { emissive: 0xffa028, ei: 0.7 });
    [-0.34, 0, 0.34].forEach(function (fx) {
      addBox(root, 0.13, 0.06, 0.10, fx * w, S.boxTop + 0.04, S.gapZ - 0.14, marker);
    });

    /* ---- 2. THE TAILGATE (the door AND the ramp) --------------------------- */
    addTailgate(root, "semi_tailgate", {
      w: S.holdW, len: S.leaf, sillZ: S.tailZ, sillTop: S.floorTop,
      closedRx: S.closedRx, mat: deck, ribMat: chrome, trimMat: trim, leafT: 0.09,
    });

    /* ---- 3. THE TRACTOR ---------------------------------------------------
       A conventional long-nose: bumper, bonnet, a day cab with a flat roof and
       a wind fairing, twin stacks, and a catwalk over the fifth wheel. The
       fifth-wheel GAP between cab and trailer is what reads as articulation
       even though the group is rigid — leave it out and this is a bus. */
    const cabF = 5.55, cabRoof = S.cabRoofY, frameY = 0.78;
    // chassis rails, cab to bogie, so the truck has something to be built on
    [1, -1].forEach(function (s) {
      addBox(root, 0.14, 0.26, S.len * 0.82, s * (w * 0.28), frameY - 0.10, -0.4, trim);
    });
    // fifth-wheel plate + catwalk under the trailer nose
    addBox(root, w * 0.72, 0.12, 1.30, 0, frameY + 0.10, S.gapZ + 0.55, trim);
    addBox(root, w * 0.86, 0.06, 0.70, 0, frameY + 0.22, S.cabBackZ + 0.32, deck);
    // the cab: a prism so the roof rakes forward into the windscreen instead of
    // sitting on it as a lid
    addPrism(root, w * 0.97, [
      [S.cabBackZ, 0], [S.cabBackZ, cabRoof - frameY],
      [cabF - 0.42, cabRoof - frameY], [cabF - 0.06, cabRoof - frameY - 1.02],
      [cabF, cabRoof - frameY - 1.18], [cabF, 0],
    ], frameY, paint);
    // the bonnet: a long sloped hood forward of the screen, the whole point of
    // a conventional tractor's silhouette
    addPrism(root, w * 0.88, [
      [cabF, 0], [cabF, 1.32],
      [S.noseZ - 0.62, 1.16], [S.noseZ - 0.12, 0.98], [S.noseZ - 0.12, 0],
    ], frameY, paint);
    // windscreen, lying ON the cab's own rake plane (a vertical slab here pokes
    // through the prism — the van's own orbit-diagnosed bug, not repeated)
    (function () {
      const botZ = cabF - 0.06, botY = frameY + cabRoof - frameY - 1.18 + 0.16;
      const topZ = cabF - 0.42, topY = frameY + cabRoof - frameY - 0.04;
      const dz = topZ - botZ, dy = topY - botY, fl = Math.hypot(dz, dy);
      const nz = dy / fl, ny = -dz / fl;
      const m = new THREE.Mesh(boxGeo(w * 0.80, fl * 0.96, 0.03), dark);
      m.position.set(0, (botY + topY) * 0.5 + ny * 0.02, (botZ + topZ) * 0.5 + nz * 0.02);
      m.rotation.x = Math.atan2(dz, dy);
      root.add(m);
    })();
    const beltY = frameY + 1.28;
    [1, -1].forEach(function (s) {
      // door glass, sill to header
      addBox(root, 0.03, cabRoof - beltY - 0.22, 1.28, s * (w * 0.478), (beltY + cabRoof) * 0.5 - 0.06, S.cabBackZ + 0.92, dark);
      // door cut + grab handle
      addBox(root, 0.03, cabRoof - frameY - 0.30, 0.04, s * (w * 0.492), frameY + (cabRoof - frameY) * 0.5, S.cabBackZ + 0.08, trim);
      addBox(root, 0.06, 0.07, 0.30, s * (w * 0.50), beltY - 0.22, S.cabBackZ + 0.55, chrome);
      // west-coast mirror on a bracket, out where a truck's mirror lives
      addBox(root, 0.05, 0.82, 0.05, s * (w * 0.56), beltY + 0.28, cabF - 0.30, trim);
      addBox(root, 0.05, 0.62, 0.22, s * (w * 0.585), beltY + 0.30, cabF - 0.30, chrome);
      // EXHAUST STACK — vertical chrome behind the cab, the identity cue
      addBox(root, 0.15, 2.05, 0.15, s * (w * 0.44), frameY + 1.05, S.cabBackZ + 0.14, chrome);
      // fuel tank, chrome cylinder-ish, under the door
      addBox(root, 0.34, 0.56, 1.50, s * (w * 0.40), frameY - 0.22, S.cabBackZ + 0.70, chrome);
      // step into the cab
      addBox(root, 0.42, 0.05, 0.34, s * (w * 0.38), frameY - 0.56, S.cabBackZ + 0.72, trim);
    });
    // grille + bumper + air dam
    addBox(root, w * 0.70, 0.86, 0.06, 0, frameY + 0.66, S.noseZ - 0.10, trim);
    addBox(root, w * 0.99, 0.34, 0.16, 0, frameY + 0.02, S.noseZ - 0.02, chrome);
    // roof fairing over the cab, angled back toward the trailer's leading edge
    addPrism(root, w * 0.88, [
      [S.cabBackZ - 0.10, 0], [S.cabBackZ - 0.10, S.boxTop - cabRoof],
      [cabF - 0.55, 0.06], [cabF - 0.55, 0],
    ], cabRoof, paint);
    addLightsSemi(root, w, frameY, S);

    /* ---- 4. THE CABIN, through the ONE shared solver ----------------------
       dressCabin is what publishes cushionY / seatX / eye / wheel, which is
       what puts the player's real dressed rig at the wheel (CAR_DRIVER_VISIBLE)
       and what view.js reads for the first-person eye. A truck that skipped it
       would be the fourth body style with no cabin — the exact defect
       carCabinAudit()'s `bare` counter exists to drive to zero. */
    dressCabin(root, {
      cabW: w * 0.90, zR: S.cabBackZ + 0.16, zF: cabF - 0.22,
      zTR: S.cabBackZ + 0.18, zTF: cabF - 0.48, roofW: w * 0.84,
      beltY: beltY, roofY: cabRoof - 0.06,
      floorY: frameY + 0.30, rows: 1,
    });

    /* ---- 5. WHEELS — six axles' worth, hand-placed ------------------------
       addWheels() lays exactly four at ±length·0.32, which is a car's axle
       pattern. A tractor-trailer is a steer axle, a drive TANDEM and a trailer
       BOGIE, and the tandem is most of what makes it read as heavy. Each tire
       is makeWheel's, so it is tagged playerWheel, spared by the static merge
       and spun by the drive loop like every other wheel in the city. */
    const axles = [S.noseZ - 1.55, S.cabBackZ - 0.15, S.cabBackZ - 1.55, S.tailZ + 1.15, S.tailZ + 2.55];
    axles.forEach(function (az, ai) {
      /* THE TRAILER BOGIE RUNS SMALLER RUBBER, AND IT IS ARITHMETIC, NOT STYLE.
         The step-deck's floor panel spans 0.84 to 0.95; a 0.52 m tyre tops out
         at 1.04, so on the first render the two rear axles — INCLUDING their
         inboard duals at x ±0.77, which is well inside a 2.28 m clear width —
         stood 9 cm through the cargo deck. The interior plate photographed
         eight dark slabs lying on the floor of the room and they were the
         wheels. 0.40 tops out at 0.80, under the deck, with no wheel wells to
         draw and no change to how it sits on the road (every wheel's contact
         patch is y = 0 either way). */
      const trailer = ai >= 3;
      const r = trailer ? 0.40 : wheelR;
      const outer = ai === 0 ? w / 2 - 0.06 : w / 2 - 0.14;   // duals inboard of the steer
      [1, -1].forEach(function (s) {
        const wheel = makeWheel(r, 0.30, "sixlug", 0.62);
        wheel.rotation.z = -s * Math.PI / 2;
        wheel.position.set(s * outer, r, az);
        root.add(wheel);
        if (ai > 0) {          // DUALS: a second tire inboard on every axle but the steer
          const twin = makeWheel(r, 0.28, "sixlug", 0.62);
          twin.rotation.z = -s * Math.PI / 2;
          twin.position.set(s * (outer - 0.34), r, az);
          root.add(twin);
        }
      });
    });
    // landing gear: the legs a trailer stands on, dropped because the tractor
    // is permanently attached — they are down, which is what a parked rig shows
    [1, -1].forEach(function (s) {
      addBox(root, 0.12, S.floorTop - 0.34, 0.12, s * (w * 0.30), (S.floorTop - 0.34) / 2 + 0.10, S.gapZ - 1.35, trim);
      addBox(root, 0.24, 0.10, 0.30, s * (w * 0.30), 0.10, S.gapZ - 1.35, trim);
    });

    /* ---- 6. THE DECLARATIONS ---------------------------------------------- */
    root.userData.vehicleDims = { width: w, length: S.len, height: S.boxTop, wheelbase: S.cabBackZ - S.tailZ - 1.15 };
    root.userData.partCtx = {
      w: w, len: S.len, style: "semi",
      frontZ: S.noseZ, rearZ: S.tailZ,
      baseY: frameY + 0.02, headY: frameY + 0.52, tailY: 0.66,
      noseTopY: frameY + 1.20, bodyY: frameY, baseH: S.roofY - S.floorTop,
      roofY: S.boxTop, roofZ: (S.gapZ + S.tailZ) / 2, roofW: w * 0.9, roofLen: (S.gapZ - S.tailZ) * 0.8,
      paint: paint,
    };
    /* THE HOLD DECLARATION. Plain numbers plus a NAME — nothing here is a
       THREE object, because makeProcedural's clones share userData by
       reference and a live node stashed in it would be the template's. Every
       coordinate is this group's own local frame, which is exactly the frame
       CBZ.vehicleHold's contract asks for. vehicles.js hands this over; this
       file never calls the hold API and does not need to know it exists. */
    root.userData.holdSpec = {
      id: "semi-trailer", label: "Trailer",
      floor: { x: 0, z: (S.holdFrontZ + S.tailZ) / 2, w: S.holdW, d: S.holdFrontZ - S.tailZ, top: S.floorTop },
      roof: S.roofY,
      walls: [
        { x: -(w / 2 - S.wallT / 2), z: (S.holdFrontZ + S.tailZ) / 2, w: S.wallT, d: S.holdFrontZ - S.tailZ, y0: S.floorTop, y1: S.roofY },
        { x: (w / 2 - S.wallT / 2), z: (S.holdFrontZ + S.tailZ) / 2, w: S.wallT, d: S.holdFrontZ - S.tailZ, y0: S.floorTop, y1: S.roofY },
        { x: 0, z: S.gapZ - S.wallT / 2, w: w, d: S.wallT, y0: S.floorTop, y1: S.roofY },
      ],
      ramp: {
        nodeName: "semi_tailgate", w: S.holdW, len: S.leaf,
        sillZ: S.tailZ, sillTop: S.floorTop,
        closedRx: S.closedRx, openRx: S.openRx, dir: -1, seconds: 2.4,
      },
    };
    return root;
  }

  // headlamps low on the bonnet + marker lamps along the cab roof. Kept out of
  // addLights() because that one places a car's lamp bar off len/2, and a
  // conventional's lamps live on the FENDERS, ahead of a two-metre bonnet.
  function addLightsSemi(root, w, frameY, S) {
    const head = vmat("lightFront", 0xeaf6ff, { emissive: 0xbfe6ff, ei: 0.85 });
    const tail = vmat("lightTail", 0xff3038, { emissive: 0xff2630, ei: 0.8 });
    [1, -1].forEach(function (s) {
      addBox(root, 0.34, 0.20, 0.06, s * (w * 0.33), frameY + 0.44, S.noseZ - 0.06, head);
      addBox(root, 0.16, 0.34, 0.06, s * (w * 0.34), 0.72, S.tailZ - 0.20, tail);
    });
  }

  // --- a tall long cargo van: flat slab sides (sliding-door crease), short hood. ---
  function makeVan() {
    const root = new THREE.Group();
    const paint = paintMat("van", 0xe9ebee, { metalness: 0.4, roughness: 0.48, envMapIntensity: 0.8 });
    const dark = glassMat();
    const trim = roleMat("van-trim", "plastic", 0x202428);
    // PROPORTION LAW: tall cab-forward box van. H~1.95, greenhouse merges into box.
    const w = 2.18, len = 5.6, H = 1.95;
    const wheelR = +(0.185 * H).toFixed(3);           // tire dia 0.37H (Transit low-roof: small wheels under a tall box IS correct)
    const bodyY = +(wheelR * 0.58).toFixed(3);
    const boxH = +(0.82 * H).toFixed(3);              // ~1.60 very tall cargo box
    const boxTop = bodyY + boxH;
    /* ---- THE VAN GOT A CAB (CAR_CABIN_V2) -----------------------------
       The old van had NO cab. Its cargo box ran forward to z = +0.27·len and
       the hood was one long 55° rake from the nose straight up to the box
       roof, so the entire volume where a driver sits was solid painted slab
       with a 0.14·len porthole in each flank. There was nowhere to put an
       interior, which is why it never had one.
       The box now stops at +0.13·len (its REAR is untouched at −0.47·len, so
       the doors, hinges and handle bar all still land) and the front body is
       one prism carrying a flat cab roof back over the driver plus a 45°
       Transit windscreen. Same silhouette read from 30 m — a tall white box
       with a short nose — but there is a room in it now. Flag off: the two
       ARE the same shape, minus the room. */
    const vanBoxZ = -len * 0.17, vanBoxD = len * 0.60;     // rear stays at -0.47·len
    const vanCabFrontZ = vanBoxZ + vanBoxD * 0.5;          // = +0.13·len, the box face
    const vanRoofTopY = boxH * 0.965;                      // cab roof, local to the prism base
    // A Transit's windscreen is ~26° off vertical over a SHORT bonnet, not a
    // 45° sheet running the whole nose (which is what the first pass drew, and
    // it read as a bus). Steep glass + a real bonnet in front of it is also
    // what leaves a flat cab roof long enough to sit a driver under.
    const vanWsBotY = boxH * 0.38, vanWsBotZ = len * 0.418, vanWsTopZ = len * 0.336;
    const vanNoseY = boxH * 0.35;
    /* ---- THE BOX IS A ROOM NOW (VAN_HOLD_V1) ---------------------------
       OWNER: "you bring a van and open the back of it, and put the money in
       it." That box was ONE SOLID SLAB — the single most-photographed cargo
       volume in the game and there was nothing inside it, not even air.

       The slab becomes five thin panels whose OUTER faces sit exactly where
       the slab's faces sat: 0 mm of silhouette change at any distance, and a
       2.08 × 1.39 × 3.14 m room behind the doors. It is not a room you can
       stand up straight in — a Transit is 1.4 m inside and this one honours
       that. It is a room you can crouch in, walk duffels into, and drive away
       with, and its floor is a real moving platform, so the money is still
       there at the other end.
       Flag off → the original slab, byte for byte. */
    const vanHold = CFG.VAN_HOLD_V1 !== false;
    const vanWallT = 0.05;
    const vanFloorTop = bodyY + vanWallT;
    const vanRoofY = bodyY + boxH - vanWallT;
    const vanHoldW = w - vanWallT * 2;
    const vanBoxBackZ = vanBoxZ - vanBoxD / 2, vanBoxFrontZ = vanBoxZ + vanBoxD / 2;
    if (vanHold) {
      addHoldShell(root, {
        w: w, zFront: vanBoxFrontZ, zBack: vanBoxBackZ,
        floorTop: vanFloorTop, roofY: vanRoofY, wall: vanWallT,
        mat: paint, deckMat: roleMat("van-deck", "metal", 0x4e545c), bulkMat: paint,
      });
    } else {
      addBox(root, w, boxH, vanBoxD, 0, bodyY + boxH * 0.5, vanBoxZ, paint);
    }
    // sliding-door crease line + lower rocker trim down the slab
    addBox(root, w + 0.02, 0.05, vanBoxD * 0.95, 0, bodyY + boxH * 0.6, vanBoxZ, trim);
    addBox(root, w + 0.02, 0.18, vanBoxD * 0.97, 0, bodyY + 0.1, vanBoxZ, trim);
    // CAB + SHORT BONNET as one prism: flat roof over the driver from the box
    // face forward, the windscreen rake, then the bonnet out to the nose.
    addPrism(root, w * 0.96, [
      [vanCabFrontZ, 0], [vanCabFrontZ, vanRoofTopY],
      [vanWsTopZ, vanRoofTopY], [vanWsBotZ, vanWsBotY],
      [len * 0.5, vanNoseY], [len * 0.5, 0.2],
    ], bodyY + 0.06, paint);
    // raked windscreen: a dark panel LYING ON the rake plane (the old vertical
    // slab poked through the slope and floated off the nose — orbit-diagnosed).
    (function () {
      const botZ = vanWsBotZ, botY = vanWsBotY, topZ = vanWsTopZ, topY = vanRoofTopY;
      const dz = topZ - botZ, dy = topY - botY, fl = Math.hypot(dz, dy);
      const nz = dy / fl, ny = -dz / fl;               // outward (up-forward) normal
      const m = new THREE.Mesh(boxGeo(w * 0.86, fl * 0.86, 0.03), dark);
      m.position.set(0, bodyY + 0.06 + (botY + topY) * 0.5 + ny * 0.02, (botZ + topZ) * 0.5 + nz * 0.02);
      m.rotation.x = Math.atan2(dz, dy);
      root.add(m);
    })();
    const vanBeltY = bodyY + boxH * 0.58, vanCabRoofY = bodyY + 0.06 + vanRoofTopY;
    [1, -1].forEach(function (side) {
      // a REAL cab side window, sill to header, from the box face to the
      // A-pillar — the thing you see the driver through from the kerb.
      addBox(root, 0.03, vanCabRoofY - vanBeltY - 0.09, vanWsTopZ - vanCabFrontZ - 0.04,
        side * (w * 0.485), (vanBeltY + vanCabRoofY) * 0.5, (vanCabFrontZ + vanWsTopZ) * 0.5, dark);
      addBox(root, 0.025, boxH * 0.72, 0.035, side * (w * 0.505), bodyY + boxH * 0.51, vanBoxZ, trim);
      addBox(root, 0.17, 0.13, 0.28, side * (w * 0.55), bodyY + boxH * 0.66, len * 0.4, trim);  // mirrors
    });
    dressCabin(root, {
      cabW: w * 0.92, zR: vanCabFrontZ + 0.07, zF: vanWsBotZ - 0.03,
      zTR: vanCabFrontZ + 0.08, zTF: vanWsTopZ - 0.06, roofW: w * 0.86,
      beltY: vanBeltY, roofY: vanCabRoofY - 0.03,
      floorY: bodyY + boxH * 0.20, rows: 1,
    });
    // fleet livery band down both flanks — an accent lambert that is NOT
    // _bodyPaint, so a recoloured van keeps its working-fleet stripe.
    const livery = sharedMat("van-livery", 0x2f5f9e, { emissive: 0x0c1828, ei: 0.35 });
    [1, -1].forEach(function (side) {
      addBox(root, 0.02, 0.40, len * 0.42, side * (w * 0.5 + 0.006), bodyY + boxH * 0.38, -len * 0.08, livery);
    });
    // kerb-side sliding-door gear: seam, lower roller track, grab handle
    addBox(root, 0.025, boxH * 0.52, 0.035, w * 0.505, bodyY + boxH * 0.40, len * 0.02, trim);
    addBox(root, 0.02, 0.035, len * 0.28, w * 0.505, bodyY + boxH * 0.10, -len * 0.06, trim);
    addBox(root, 0.03, 0.05, 0.15, w * 0.508, bodyY + boxH * 0.42, len * 0.09, trim);
    /* THE REAR DOOR. It used to be three decals painted on a solid slab: a
       split seam, four hinge blocks and a handle bar, all stuck to a face
       nothing was behind. They now ride the door LEAF, so the same hardware you
       always saw is the hardware that swings — and the hinges are on the hinge.
       A bottom-hinged tailgate rather than the barn doors the decals implied,
       because vehicle_hold's door IS the ramp (see addTailgate): one node, one
       arc, and a surface the money goes up. */
    const vanLeaf = 1.50;
    if (vanHold) {
      addTailgate(root, "van_tailgate", {
        w: vanHoldW, len: vanLeaf, sillZ: vanBoxBackZ, sillTop: vanFloorTop,
        closedRx: 1.552, mat: paint, ribMat: trim, trimMat: trim, leafT: 0.06,
      });
    } else {
      addBox(root, 0.035, boxH * 0.74, 0.04, 0, bodyY + boxH * 0.5, -len * 0.47, trim);   // split rear doors
      [1, -1].forEach(function (side) {                                                   // rear-door hinges + handle bar
        [0.30, 0.72].forEach(function (fy) {
          addBox(root, 0.035, 0.09, 0.05, side * (w * 0.5 - 0.05), bodyY + boxH * fy, -len * 0.47 - 0.02, trim);
        });
      });
      addBox(root, 0.03, 0.26, 0.04, 0.11, bodyY + boxH * 0.45, -len * 0.47 - 0.025, trim);
    }
    // trucker jewellery: three amber clearance markers along the front roof edge
    // (kills the "rolling fridge" read — the roofline gets a working-vehicle cue).
    const marker = sharedMat("van-marker", 0xffb347, { emissive: 0xffa028, ei: 0.7 });
    [-0.3, 0, 0.3].forEach(function (fx) {
      // on the CAB roof's leading edge now that there is a cab — the old z was
      // the cargo box's old front face, which the box no longer reaches.
      addBox(root, 0.12, 0.06, 0.09, fx * w, vanCabRoofY + 0.02, vanWsTopZ - 0.06, marker);
    });
    addWheels(root, w + 0.1, len, wheelR, 0.32, trim, "sixlug", sharedMat("caliper-dk", 0x3a3f45), 0.52);
    root.userData.vehicleDims = { width: w, length: len, height: Math.max(boxTop, vanCabRoofY), wheelbase: len * 0.68 };
    // Bison face anchors: lamps low on the nose, VERTICAL tails riding the tall
    // box rear corners (rearZ is the box face, not len/2 — the box is set back).
    root.userData.partCtx = {
      w: w, len: len, style: "van",
      // headY well ABOVE the bumper band (baseY): the first render buried the
      // grille + quad lamps behind the bumper block (both landed at y≈0.49).
      frontZ: len * 0.5, rearZ: -len * 0.47,
      baseY: wheelR + 0.12, headY: bodyY + 0.68, tailY: bodyY + boxH - 0.46,
      noseTopY: bodyY + boxH * 0.55, bodyY: bodyY, baseH: boxH,
      roofY: boxTop, roofZ: vanBoxZ, roofW: w * 0.9, roofLen: vanBoxD * 0.8,
      paint: paint,
    };
    // THE VAN'S HOLD. Same declaration shape as the semi's and read by the same
    // three lines in vehicles.js, which is the point: a second freight body
    // cost a spec object, not a system. See makeSemi for the contract notes.
    if (vanHold) {
      root.userData.holdSpec = {
        id: "van-box", label: "Cargo bay",
        floor: { x: 0, z: vanBoxZ, w: vanHoldW, d: vanBoxD - vanWallT * 2, top: vanFloorTop },
        roof: vanRoofY,
        walls: [
          { x: -(w / 2 - vanWallT / 2), z: vanBoxZ, w: vanWallT, d: vanBoxD - vanWallT * 2, y0: vanFloorTop, y1: vanRoofY },
          { x: (w / 2 - vanWallT / 2), z: vanBoxZ, w: vanWallT, d: vanBoxD - vanWallT * 2, y0: vanFloorTop, y1: vanRoofY },
          { x: 0, z: vanBoxFrontZ - vanWallT / 2, w: w, d: vanWallT, y0: vanFloorTop, y1: vanRoofY },
        ],
        ramp: {
          nodeName: "van_tailgate", w: vanHoldW, len: vanLeaf,
          sillZ: vanBoxBackZ, sillTop: vanFloorTop,
          closedRx: 1.552, openRx: -Math.asin(Math.min(0.98, vanFloorTop / vanLeaf)),
          dir: -1, seconds: 1.5,
        },
      };
    }
    return root;
  }

  // --- superbike (Fable art pass): true sportbike stance — raked twin forks,
  //     wrapping nose fairing + screen, sculpted tank with a rising tail over a
  //     real swingarm, side exhaust can, and a rider folded into the tank.
  //     PROPORTION LAW (real 1000cc sportbike, meters): wheel R≈0.33 (17" rim +
  //     tire), wheelbase 1.42, seat height 0.83, tank peak 0.95, screen 1.13.
  //     The old draft's 0.42m wheels + 1.56m wheelbase read as a cartoon
  //     minibike under a fridge-torso rider; every mass below is placed off
  //     the axle line (y = wheelR) the way the real machine hangs off its
  //     spine: engine slung LOW between the axles, tank ABOVE the frame spine,
  //     tail kicked UP past the rear axle. ---
  function makeMotorcycle() {
    const root = new THREE.Group();
    const paint = roleMat("moto-paint", "paint", 0x16a0e0);
    const black = roleMat("moto-black", "plastic", 0x101317);
    const chrome = chromeMat();
    const seat = roleMat("moto-seat", "interior", 0x18191c);
    const rider = roleMat("moto-rider", "plastic", 0x20242c);
    const glass = glassMat();
    const red = lightTailMat();
    const white = lightFrontMat();
    const R = 0.33;                 // wheel radius (17" + rubber)
    const wb = 0.71;                // wheelbase half-length → 1.42m total
    const axleY = R;                // both axles sit at wheel-center height
    // wheels: rear visibly fatter (190-section) than the front (120-section)
    [[wb, 0.13], [-wb, 0.19]].forEach(function (p) {
      const wheel = makeWheel(R, p[1]);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(0, axleY, p[0]);
      root.add(wheel);
    });
    // front fender hugging the tire
    const fender = addBox(root, 0.16, 0.07, 0.52, 0, axleY + R * 0.72, wb + 0.02, paint);
    fender.rotation.x = -0.12;
    // RAKED FORK: twin tubes at ~24° from vertical, steering head to axle.
    // Tube length spans head (y≈0.98) to axle (y=0.33) → ~0.72 at that angle.
    [0.075, -0.075].forEach(function (x) {
      const tube = addBox(root, 0.055, 0.74, 0.055, x, axleY + 0.33, wb - 0.145, chrome);
      tube.rotation.x = 0.42;       // rake: bottom kicks FORWARD to the axle
    });
    // engine/gearbox: the low-slung dense mass between the axles
    addBox(root, 0.40, 0.34, 0.62, 0, axleY + 0.04, -0.02, black);
    // belly pan closing the fairing under the engine
    addPrism(root, 0.42, [[0.42, 0.0], [0.42, 0.16], [-0.30, 0.16], [-0.22, 0.0]], axleY - 0.14, paint);
    // frame spine rising from steering head back over the engine
    const spine = addBox(root, 0.14, 0.10, 0.78, 0, axleY + 0.42, 0.22, black);
    spine.rotation.x = -0.10;
    // TANK: peak just behind the steering head, spilling back toward the seat
    addPrism(root, 0.40, [[0.44, 0.02], [0.34, 0.34], [0.02, 0.30], [-0.14, 0.04]], axleY + 0.36, paint);
    // seat dished BELOW the tank peak…
    addBox(root, 0.30, 0.08, 0.42, 0, axleY + 0.50, -0.34, seat);
    // …and the tail cowl kicking UP and back over the rear wheel
    addPrism(root, 0.28, [[-0.30, 0.0], [-0.42, 0.22], [-0.86, 0.30], [-0.78, 0.10]], axleY + 0.50, paint);
    addBox(root, 0.22, 0.10, 0.05, 0, axleY + 0.72, -1.10, red);      // LED tail strip in the cowl tip
    // SWINGARM: from the engine back to the rear axle (the old draft's rear
    // wheel floated unconnected), plus a chain-side detail plate
    const swing = addBox(root, 0.30, 0.09, 0.62, 0, axleY + 0.01, -0.42, black);
    swing.rotation.x = 0.06;
    addBox(root, 0.03, 0.10, 0.46, 0.14, axleY, -0.44, black);        // chain guard
    // EXHAUST: header sweeping under the engine into a fat side can, tipped up
    const can = addBox(root, 0.13, 0.13, 0.52, 0.20, axleY + 0.16, -0.62, chrome);
    can.rotation.x = -0.20;
    // header plumbing that actually CONNECTS head → belly → can (the can used
    // to float beside the engine with no pipework), plus a dark tip outlet
    const header = addBox(root, 0.075, 0.075, 0.34, 0.16, axleY - 0.02, 0.18, chrome);   // downpipe off the cylinder head
    header.rotation.x = -0.85;
    const link = addBox(root, 0.075, 0.075, 0.56, 0.185, axleY + 0.03, -0.15, chrome);   // link pipe under the engine
    link.rotation.x = 0.69;
    const tip = addBox(root, 0.105, 0.105, 0.05, 0.20, axleY + 0.11, -0.885, black);     // exhaust outlet
    tip.rotation.x = -0.20;
    // NOSE FAIRING wrapping the steering head: painted wedge + twin lamps + screen
    addPrism(root, 0.38, [[wb + 0.10, 0.28], [wb - 0.10, 0.62], [wb - 0.42, 0.56], [wb - 0.30, 0.20]], axleY + 0.16, paint);
    addBox(root, 0.32, 0.14, 0.035, 0, axleY + 0.655, wb + 0.03, black);    // dark bezel panel: lamps read as lenses set in it
    [0.09, -0.09].forEach(function (x) {
      addBox(root, 0.10, 0.09, 0.05, x, axleY + 0.66, wb + 0.055, white);   // twin projector lamps
    });
    const screen = addBox(root, 0.30, 0.24, 0.03, 0, axleY + 0.86, wb - 0.28, glass);
    screen.rotation.x = 0.62;       // double-bubble screen laid back over the clocks
    // clip-on bars BELOW the tank line (racing posture), bar-end mirrors
    [0.19, -0.19].forEach(function (x) {
      const bar = addBox(root, 0.16, 0.035, 0.035, x, axleY + 0.60, wb - 0.20, black);
      bar.rotation.y = x > 0 ? -0.35 : 0.35;
      addBox(root, 0.07, 0.04, 0.02, x * 1.35, axleY + 0.70, wb - 0.24, black);  // mirror
    });
    // SIDE FAIRING panels closing the mid-body (thin, tucked in at the knees)
    [0.185, -0.185].forEach(function (x) {
      const panel = addBox(root, 0.02, 0.30, 0.72, x, axleY + 0.22, 0.16, paint);
      panel.rotation.z = x > 0 ? -0.10 : 0.10;   // tumblehome: panels lean in
    });
    // RIDER folded onto the tank: hips over the seat, chest low, arms to the
    // clip-ons, helmet down in the bubble — reads "pinned" not "sitting".
    const r = new THREE.Group();
    addBox(r, 0.34, 0.24, 0.40, 0, axleY + 0.58, -0.36, rider);       // hips/thighs on the seat
    const chest = addBox(r, 0.36, 0.46, 0.26, 0, axleY + 0.84, 0.02, rider);
    chest.rotation.x = 0.78;        // chest folded toward the tank
    [0.20, -0.20].forEach(function (x) {
      const arm = addBox(r, 0.09, 0.09, 0.46, x, axleY + 0.72, 0.30, rider);
      arm.rotation.x = 0.30;
    });
    addSphere(r, 0.15, 0, axleY + 1.02, 0.34, sharedMat("moto-helmet", 0x0d0f12, { emissive: 0x05080a, ei: 0.3 }), 1, 0.92, 1.1);
    [0.17, -0.17].forEach(function (x) {
      const shin = addBox(r, 0.09, 0.34, 0.10, x, axleY + 0.22, -0.30, rider);  // boots on the rearsets
      shin.rotation.x = -0.5;
    });
    r.name = "moto_rider";
    root.add(r);
    root.userData.leanRider = r;
    root.userData.vehicleDims = { width: 0.74, length: wb * 2 + 0.7, height: 1.55, wheelbase: wb * 2 };
    return root;
  }

  // --- light helicopter (art pass): plan-tapered fuselage pod with a glass
  //     nose bubble, engine cowl + exhaust stub, TAPERED tail boom carrying a
  //     raked fin + stabilizer, 4-blade tapered main rotor on a real hub/mast,
  //     2-blade tapered tail rotor, skid gear with cross-tubes, and a two-tone
  //     accent livery that survives recolor. Ground-driven cosmetic skin by
  //     design for the garage cycler; the campaign also reuses this exact art
  //     asset as its flying prologue transport. Rotor groups keep their names
  //     so every cloned instance resolves and spins its own blades. ---
  // tapered rotor blade: a box along +X (root at the origin) whose chord (z)
  // and thickness (y) shrink toward the tip. Cached + _shared so clone
  // disposal never eats it; pure arithmetic, fully deterministic.
  const bladeGeos = new Map();
  function bladeGeo(len, rootW, tipW, rootT, tipT) {
    const key = [len, rootW, tipW, rootT, tipT].join("|");
    let geo = bladeGeos.get(key);
    if (geo) return geo;
    geo = new THREE.BoxGeometry(len, rootT, rootW);
    geo.translate(len / 2, 0, 0);
    const arr = geo.attributes.position.array;
    for (let i = 0; i < arr.length; i += 3) {
      const t = arr[i] / len;                    // 0 at the root -> 1 at the tip
      arr[i + 1] *= 1 + (tipT / rootT - 1) * t;  // thin toward the tip
      arr[i + 2] *= 1 + (tipW / rootW - 1) * t;  // narrow toward the tip
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
    geo._shared = true;
    bladeGeos.set(key, geo);
    return geo;
  }

  function makeHelicopter() {
    const root = new THREE.Group();
    const body = roleMat("heli-body", "paint", 0x1b2b3c);
    // two-tone accent: a fresh 'paint' material with _bodyPaint STRIPPED so
    // the livery keeps its signal-orange when recolorBody repaints the shell.
    const accent = (function () {
      let m = mats.get("heli-accent"); if (m) return m;
      m = vmat("paint", 0xd14a2a, { metalness: 0.5, roughness: 0.3 });
      m._bodyPaint = false; m._shared = true; mats.set("heli-accent", m); return m;
    })();
    const glass = glassMat();
    const dark = roleMat("heli-dark", "plastic", 0x14171c);
    // blades want DARK metal — vmat('metal') returns the bright chrome
    // singleton (colour ignored), so use a colour-true lambert instead.
    const blade = sharedMat("heli-blade", 0x23272c, { emissive: 0x0a0c0e, ei: 0.3 });
    const groundY = 0.34;   // skid clearance above the ground plane
    // fuselage pod, tapered in PLAN via prismGeo width scales (nose and tail
    // pull in) instead of running as a constant-width slab
    addPrism(root, 1.5, [
      [-1.4, 0, 0.72], [-1.1, 1.0, 0.95], [0.9, 1.0, 1.0], [1.7, 0.55, 0.66], [1.55, 0, 0.66],
    ], groundY, body);
    // canopy: raked glass tub over the front half + a rounded glass NOSE
    // BUBBLE (the light-heli signature). Both use the opaque reflective glass
    // singleton, which satisfies the b-r>0.045 glass value contract.
    addPrism(root, 1.36, [
      [-0.4, 0.08, 1.0], [0.2, 0.92, 0.94], [1.4, 0.5, 0.7], [1.3, 0.1, 0.7],
    ], groundY + 0.02, glass);
    addSphere(root, 0.5, 0, groundY + 0.5, 1.38, glass, 0.92, 0.8, 0.95);   // nose bubble
    // accent cheat-line down both flanks (two-tone livery, recolor-proof)
    [1, -1].forEach(function (side) {
      addBox(root, 0.025, 0.16, 1.7, side * 0.755, groundY + 0.52, 0, accent);
    });
    addBox(root, 0.16, 0.07, 0.07, 0, groundY + 0.16, 1.56, lightFrontMat());   // chin landing light
    // engine cowl on the roof + exhaust stub kicked back
    addBox(root, 0.66, 0.26, 1.15, 0, groundY + 1.1, -0.35, dark);
    const exh = addBox(root, 0.11, 0.11, 0.3, 0.2, groundY + 1.16, -0.98, dark);
    exh.rotation.x = 0.5;
    // TAPERED tail boom: slims in height AND width toward the tail, root
    // buried in the pod's upper rear, tip swept slightly up.
    addPrism(root, 0.4, [
      [-3.8, 0.54, 0.5], [-3.8, 0.78, 0.5], [-1.0, 0.9, 1.0], [-1.0, 0.38, 1.0],
    ], groundY, body);
    addBox(root, 0.36, 0.42, 0.22, 0, groundY + 0.64, -2.5, accent);   // accent band wrapping the boom
    // raked tail fin (accent) + horizontal stabilizer + anti-collision beacon
    addPrism(root, 0.09, [
      [-4.0, 0.30], [-3.86, 1.55], [-3.66, 1.55], [-3.6, 0.55],
    ], groundY, accent);
    addBox(root, 1.0, 0.05, 0.30, 0, groundY + 0.80, -3.0, accent);
    addBox(root, 0.055, 0.05, 0.055, 0, groundY + 1.58, -3.74, lightTailMat());
    // skid gear: tubes with upturned toes, down-struts, cross-tubes under the
    // belly (the old gear had struts floating with no cross members)
    const skidY = 0.06;
    [1, -1].forEach(function (side) {
      addBox(root, 0.07, 0.07, 2.3, side * 0.75, skidY, 0.2, dark);
      const toe = addBox(root, 0.07, 0.07, 0.34, side * 0.75, skidY + 0.09, 1.44, dark);
      toe.rotation.x = -0.55;
      [0.7, -0.3].forEach(function (z) {
        addBox(root, 0.075, 0.30, 0.085, side * 0.72, skidY + 0.16, z, dark);
      });
    });
    [0.7, -0.3].forEach(function (z) {
      addBox(root, 1.44, 0.075, 0.085, 0, skidY + 0.26, z, dark);
    });
    // MAIN ROTOR: cylindrical mast out of the cowl, hub disc + 4 tapered
    // blades with a touch of coning (tips ride up), spins about Y.
    const mastGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.44, 10);
    mastGeo._shared = true;
    const mastMesh = new THREE.Mesh(mastGeo, dark);
    mastMesh.position.set(0, groundY + 1.40, 0.05);
    mastMesh.castShadow = false;
    root.add(mastMesh);
    const rotorY = groundY + 1.58;
    const mainRotor = new THREE.Group();
    mainRotor.position.set(0, rotorY, 0.05);
    const hubGeo = new THREE.CylinderGeometry(0.11, 0.13, 0.13, 12);
    hubGeo._shared = true;
    const hub = new THREE.Mesh(hubGeo, dark);
    hub.castShadow = false;
    mainRotor.add(hub);
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(bladeGeo(2.95, 0.30, 0.16, 0.055, 0.03), blade);
      b.position.y = 0.03;
      b.rotation.set(0, (i / 4) * Math.PI * 2, 0.028);   // azimuth + coning (XYZ order: Z first)
      b.castShadow = false;
      mainRotor.add(b);
    }
    mainRotor.name = "heli_mainRotor";
    root.add(mainRotor);
    root.userData.mainRotor = mainRotor;
    // TAIL ROTOR: side-mounted hub + 2 tapered blades sweeping the Y-Z plane,
    // spins about X beside the fin. A static gearbox nub bridges the boom
    // face to the hub so the rotor doesn't float beside the fin.
    addBox(root, 0.14, 0.14, 0.14, 0.08, groundY + 1.02, -3.82, dark);
    const tailRotor = new THREE.Group();
    tailRotor.position.set(0.17, groundY + 1.02, -3.82);
    const tHubGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.11, 10);
    tHubGeo._shared = true;
    const tHub = new THREE.Mesh(tHubGeo, dark);
    tHub.rotation.z = Math.PI / 2;
    tHub.castShadow = false;
    tailRotor.add(tHub);
    [1, -1].forEach(function (dir) {
      const b = new THREE.Mesh(bladeGeo(0.62, 0.13, 0.08, 0.035, 0.025), blade);
      b.rotation.z = dir * Math.PI / 2;   // blade along ±Y, thickness along the X shaft
      b.castShadow = false;
      tailRotor.add(b);
    });
    tailRotor.name = "heli_tailRotor";
    root.add(tailRotor);
    root.userData.tailRotor = tailRotor;
    root.userData.vehicleDims = { width: 2.1, length: 5.8, height: 2.05, wheelbase: 2.8 };
    return root;
  }

  // --- speedboat (Fable art pass): the old draft was one constant-width slab
  //     with a glass triangle — no bow taper in PLAN, so it read as a barge.
  //     A prism only tapers in profile (z,y); plan taper is faked the way real
  //     low-poly boats do it: the hull is THREE width-stepped segments
  //     (stern→mid→bow) whose profiles overlap, capped by a narrow raked stem
  //     wedge — five prisms total and the silhouette finally points. Layout is
  //     a proper runabout: full-beam stern with a bench + sun pad over the
  //     engine well, console amidships behind a three-panel wraparound screen,
  //     bowrider nose with a chrome rail, deep-V spray strakes at the chine. ---
  function makeBoat() {
    const root = new THREE.Group();
    const hull = roleMat("boat-hull", "paint", 0xeceff2);
    const stripe = roleMat("boat-stripe", "paint", 0x1574d6);
    const deck = sharedMat("boat-deck", 0xb4885c, { emissive: 0x2b1a0d, ei: 0.20 }); // teak-ish deck
    const pad = sharedMat("boat-pad", 0xd8dde4, { emissive: 0x363b42, ei: 0.30 });    // white vinyl
    const glass = glassMat();
    const dark = sharedMat("boat-dark", 0x101317);
    const chrome = chromeMat();
    const screen = sharedMat("boat-screen", 0x183b50, { emissive: 0x0d5f7a, ei: 0.72 });
    const w = 2.1, len = 6.2;
    const baseY = 0.22;
    const H = 0.58;                                              // freeboard
    // HULL in three width steps — the plan-view taper. Segment seams hide
    // under the rubbing strake (chrome line) below.
    // stern block: full beam, transom to amidships
    addPrism(root, w, [[-len * 0.5, 0.0], [-len * 0.5, H], [len * 0.06, H], [len * 0.10, 0.0]], baseY, hull);
    // mid block: slightly pinched, carries the sheer forward
    addPrism(root, w * 0.86, [[len * 0.02, 0.0], [len * 0.02, H], [len * 0.30, H + 0.03], [len * 0.34, 0.0]], baseY, hull);
    // bow block: strongly pinched, sheer still rising
    addPrism(root, w * 0.60, [[len * 0.28, 0.0], [len * 0.28, H + 0.03], [len * 0.44, H + 0.07], [len * 0.46, 0.02]], baseY, hull);
    // stem wedge: the pointed nose itself, narrow + raked back to the deck
    addPrism(root, w * 0.26, [[len * 0.42, 0.0], [len * 0.42, H + 0.07], [len * 0.52, H + 0.08], [len * 0.50, 0.12]], baseY, hull);
    // deep-V keel line: a shallow angled slab under the centerline so the
    // boat reads as sitting ON a V, not a flat pan (visible in turns/wake)
    const keel = addBox(root, 0.42, 0.16, len * 0.82, 0, baseY - 0.04, len * 0.02, hull);
    keel.rotation.z = Math.PI / 4;
    // spray strakes at the chine — thin chrome rubbing strakes hide the seams
    [1, -1].forEach(function (side) {
      const strake = addBox(root, 0.04, 0.05, len * 0.78, side * (w * 0.5 - 0.02), baseY + H * 0.55, len * 0.0, chrome);
      strake.rotation.y = side * 0.045;                          // follow the taper in
    });
    // hull stripe along the sheer (the classic gelcoat accent)
    [1, -1].forEach(function (side) {
      const st = addBox(root, 0.025, 0.12, len * 0.62, side * (w * 0.5 - 0.045), baseY + H * 0.78, -len * 0.04, stripe);
      st.rotation.y = side * 0.045;
    });
    // DECK: teak cockpit sole aft, vinyl sun pad over the engine well at the
    // transom, and a raised bow deck the rail rings.
    addBox(root, w * 0.78, 0.05, len * 0.34, 0, baseY + H - 0.02, -len * 0.10, deck);      // cockpit sole
    addBox(root, w * 0.72, 0.12, len * 0.16, 0, baseY + H + 0.05, -len * 0.40, pad);       // stern sun pad
    addBox(root, w * 0.52, 0.06, len * 0.20, 0, baseY + H + 0.05, len * 0.36, pad);        // bow pad
    // stern bench + two bucket seats at the console
    addBox(root, w * 0.66, 0.26, 0.30, 0, baseY + H + 0.10, -len * 0.26, pad);             // bench back
    [0.48, -0.48].forEach(function (x) {
      addBox(root, 0.46, 0.14, 0.46, x, baseY + H + 0.04, -len * 0.02, pad);               // seat base
      addBox(root, 0.46, 0.34, 0.10, x, baseY + H + 0.22, -len * 0.02 - 0.20, pad);        // seat back
    });
    // CONSOLE amidships: dash pod + wheel + three-panel wraparound windscreen
    addPrism(root, w * 0.56, [[len * 0.06, 0.0], [len * 0.06, 0.30], [len * 0.16, 0.34], [len * 0.20, 0.0]], baseY + H, dark);
    const wheel = addBox(root, 0.26, 0.26, 0.04, 0.30, baseY + H + 0.34, len * 0.05, dark);
    wheel.rotation.x = -0.5;
    const nav = addBox(root, 0.30, 0.18, 0.035, -0.24, baseY + H + 0.34, len * 0.055, screen);
    nav.rotation.x = -0.36;
    addBox(root, 0.055, 0.24, 0.055, -0.54, baseY + H + 0.22, -len * 0.015, chrome);  // throttle
    addBox(root, 0.20, 0.035, 0.20, 0, baseY + H + 0.09, -len * 0.14, dark);           // cockpit drain / hatch
    const centerGlass = addBox(root, w * 0.58, 0.34, 0.03, 0, baseY + H + 0.44, len * 0.20, glass);
    centerGlass.rotation.x = -0.42;                              // raked back
    [1, -1].forEach(function (side) {
      const wing = addBox(root, 0.34, 0.30, 0.03, side * (w * 0.30), baseY + H + 0.40, len * 0.16, glass);
      wing.rotation.x = -0.42;
      wing.rotation.y = side * 0.55;                             // wrap around the console
    });
    // chrome bow rail: two side runs meeting at the stem + a nav-light stub
    [1, -1].forEach(function (side) {
      const rail = addBox(root, 0.035, 0.035, len * 0.30, side * (w * 0.24), baseY + H + 0.20, len * 0.34, chrome);
      rail.rotation.y = side * 0.16;                             // converge toward the point
      addBox(root, 0.035, 0.14, 0.035, side * (w * 0.28), baseY + H + 0.12, len * 0.26, chrome);  // stanchion
    });
    addBox(root, 0.05, 0.09, 0.05, 0, baseY + H + 0.16, len * 0.50, chrome);               // stem light
    // cleats at the stern quarters (the detail that says "boat", costs 2 boxes)
    [1, -1].forEach(function (side) {
      addBox(root, 0.16, 0.04, 0.05, side * (w * 0.36), baseY + H + 0.03, -len * 0.46, chrome);
      addBox(root, 0.14, 0.04, 0.05, side * (w * 0.22), baseY + H + 0.10, len * 0.30, chrome);   // bow cleats
    });
    // nav lights on the bow gunwales: port red (+x, facing the bow) /
    // starboard green — colours/emissives tuned to stay OUTSIDE all three
    // detector contracts (red emissive r<0.78; green emissive b<0.6; green
    // BODY colour keeps b-r<0.045 so it can't read as glass).
    addBox(root, 0.05, 0.045, 0.07, w * 0.255, baseY + H + 0.05, len * 0.31, sharedMat("boat-port", 0x8e1c24, { emissive: 0xb02030, ei: 0.8 }));
    addBox(root, 0.05, 0.045, 0.07, -w * 0.255, baseY + H + 0.05, len * 0.31, sharedMat("boat-stbd", 0x28642c, { emissive: 0x1f9e4b, ei: 0.8 }));
    // chrome header rail capping the centre windscreen panel (same rake)
    const wsFrame = addBox(root, w * 0.60, 0.035, 0.035, 0, baseY + H + 0.60, len * 0.189, chrome);
    wsFrame.rotation.x = -0.42;
    // OUTBOARD: cowled head (painted, like the real premium rigs), midsection
    // leg into the water, anti-vent plate, animated 3-blade screw
    addBox(root, 0.40, 0.34, 0.44, 0, baseY + H + 0.06, -len * 0.5 - 0.16, stripe);        // cowl
    addBox(root, 0.34, 0.10, 0.38, 0, baseY + H - 0.08, -len * 0.5 - 0.16, dark);          // cowl base
    addBox(root, 0.14, 0.52, 0.20, 0, baseY + 0.18, -len * 0.5 - 0.16, dark);              // leg
    addBox(root, 0.30, 0.03, 0.30, 0, baseY + 0.10, -len * 0.5 - 0.16, dark);              // anti-vent plate
    const prop = new THREE.Group();
    prop.position.set(0, baseY + 0.02, -len * 0.5 - 0.30);
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(boxGeo(0.05, 0.44, 0.14), chrome);
      b.rotation.z = (i / 3) * Math.PI * 2;
      prop.add(b);
    }
    prop.name = "boat_prop";
    root.add(prop);
    root.userData.boatProp = prop;
    root.userData.vehicleDims = { width: w, length: len, height: 1.35, wheelbase: len * 0.6 };
    root.userData.marineLivery = true;
    root.userData.marineRooms = [{ id: "speedboat-cockpit", label: "Open runabout cockpit" }];
    root.userData.marineFixtureCount = 11;
    root.userData.marineRigAudit = { anchors: 0, segments: 0, gaps: 0 };
    return root;
  }

  // Recolour the body PAINT of a freshly-cloned visual to `color`, leaving every
  // accent material (glass, trim, sills, stripes, chrome, lights) untouched. The
  // template's paint material is tagged `_bodyPaint`; clone(true) shares material
  // refs, so we swap those meshes onto a per-car cloned material (one per unique
  // source paint) and tag it `_playerCarOwned` so detach()/dispose can clean up.
  /* THE PAINT IS REPAINTABLE TWICE, AND THAT USED TO BE THE WHOLE BUG.
     This function used to clear `_bodyPaint` on the clone it minted, on the
     reasoning that a per-car material is no longer "the template's paint".
     But `_bodyPaint` is the only handle anything downstream has for finding a
     car's body, and TWO downstream passes need it after this one runs:

       • race_livery.js `recolorBase()` — the livery's BASE colour. It tests
         `m._bodyPaint`, matched zero materials on every car ever built, and
         silently discarded `livery.base`. Every AI racer on the grid wore its
         catalog paint and the league's team colours never reached the track.
       • CBZ.cityRecolorCar (vehicles.js) — the parked/scenery repaint hook,
         which `cityAddParkedCar(x,z,h,{color})` has always called and which
         had no definition at all.

     So the flag STAYS SET, and a material this instance already owns is
     repainted IN PLACE instead of cloned again — a second pass costs nothing
     and cannot leak. `crashdeform.js:317` already reads the pair as an OR, and
     modshop's respray keys off `_playerCarOwned`, so neither changes meaning. */
  function recolorBody(root, color) {
    if (root && root.userData && root.userData.marineLivery) return;
    const c = new THREE.Color(color);
    const swapped = new Map();
    root.traverse(function (o) {
      const m = o.material;
      if (!m || Array.isArray(m) || !m._bodyPaint) return;
      if (m._playerCarOwned) {                 // ours already — repaint, don't mint
        if (m.color && m.color.copy) m.color.copy(c);
        if (m.emissive && m.emissive.copy) m.emissive.copy(c).multiplyScalar(0.16);
        return;
      }
      let nm = swapped.get(m.id);
      if (!nm) {
        nm = m.clone();
        nm.color = c.clone();
        if (nm.emissive) nm.emissive = c.clone().multiplyScalar(0.16);
        nm._shared = false; nm._playerCarOwned = true;
        // _bodyPaint deliberately LEFT TRUE — see the block comment above.
        if (CFG.CAR_PAINT_HANDLE_V2 === false) nm._bodyPaint = false;
        swapped.set(m.id, nm);
      }
      o.material = nm;
    });
  }
  // THE ONE REPAINT VERB. Published so no other file re-implements the
  // `_bodyPaint` traversal (race_livery.js had a byte-copy of it, and that copy
  // is what went dead when this one changed a flag).
  CBZ.cityRecolorCarBody = recolorBody;

  /* THE SEE-INSIDE DISCIPLINE, BORROWED FROM THE BUILDINGS.
     city/buildings.js has one rule that makes a lit office read through a
     curtain wall from the street: interior dressing at renderOrder 0, the
     glass pane at renderOrder 1, the interior glow at -1. Car glass set no
     render order at all — it survived on the sort three.js happens to do
     (transparent after opaque, and CBZ.glass never writes depth), which is
     correct today and is nobody's contract tomorrow. One traverse per STYLE
     TEMPLATE — not per car — states it out loud: every transparent pane on a
     vehicle draws after every opaque thing inside it. Object3D.copy carries
     renderOrder, so all ~N clones of a style inherit it for free. */
  function markGlassOrder(root) {
    if (!root || !root.traverse) return 0;
    let n = 0;
    root.traverse(function (o) {
      const m = o.material;
      if (!m || Array.isArray(m) || !m.transparent) return;
      o.renderOrder = 1;
      o.userData.carGlass = true;
      n++;
    });
    root.userData.glassPanes = n;
    return n;
  }

  function makeProcedural(style, color, model) {
    let template = procTemplates.get(style);
    if (!template) {
      if (style === "cybertruck") template = makeCybertruck();
      else if (style === "suv") template = makeSUV();
      else if (style === "van") template = makeVan();
      // SEMI_TRUCK_V1 off → no builder answers, so the fleet placer below finds
      // nothing to place and no semi exists. Deliberately NOT a fallback to a
      // road car: a truck spawn that quietly becomes a hatchback is worse than
      // an empty yard, because it hides the revert.
      else if (style === "semi") { if (CFG.SEMI_TRUCK_V1 === false) return null; template = makeSemi(); }
      else if (style === "motorcycle") template = makeMotorcycle();
      else if (style === "helicopter") template = makeHelicopter();
      // (c) REGISTERED MARINE HULLS build themselves (world/water_hulls.js).
      // `buildable` is deliberately not `get`: the registry also carries a
      // record for "boat" — the physics spec + price for the runabout below —
      // and that record has NO build(), so the existing makeBoat() art stays
      // the one and only authority on the runabout's geometry.
      else if (CBZ.marineHulls && CBZ.marineHulls.buildable(style)) template = CBZ.marineHulls.build(style);
      else if (style === "boat") template = makeBoat();
      else template = makeRoadCar(style);
      markGlassOrder(template);
      procTemplates.set(style, template);
    }
    const clone = template.clone(true);
    // clone(true) copies userData by reference, so animated-group handles still
    // point at the (hidden) template. Re-resolve them against the clone by name
    // so the per-frame update spins THIS instance's rotors/prop/rider.
    if (template.userData.mainRotor) clone.userData.mainRotor = clone.getObjectByName("heli_mainRotor");
    if (template.userData.tailRotor) clone.userData.tailRotor = clone.getObjectByName("heli_tailRotor");
    if (template.userData.boatProp) clone.userData.boatProp = clone.getObjectByName("boat_prop");
    if (template.userData.leanRider) clone.userData.leanRider = clone.getObjectByName("moto_rider");
    // BRAND FACE (grille/lamps/badge/bumpers/exhaust) + per-model identity are
    // applied to the INSTANCE, not the template: several marques share one
    // silhouette (a Kanzler and a Surge are both "tesla-s"), so the face must
    // follow the catalog model, defaulting to the silhouette's home marque.
    // Applied BEFORE recolorBody so body-colour face panels get the car's paint.
    const ctx = template.userData.partCtx;
    if (ctx && CBZ.carParts) {
      const brand = (model && model.brand) || CBZ.carParts.brandForStyle(style);
      CBZ.carParts.applyBrandFace(clone, brand, ctx);
      if (model) CBZ.carParts.applyModelIdentity(clone, model, ctx);
    }
    if (color != null) recolorBody(clone, color);
    return clone;
  }

  // Pure visual builders for authored scenes. The campaign prologue asks for
  // this instead of maintaining a separate lower-detail helicopter stand-in.
  CBZ.debugBuildPlayerVehicle = CBZ.debugBuildPlayerVehicle || {};
  CBZ.debugBuildPlayerVehicle.helicopter = function () {
    return makeProcedural("helicopter", null, null);
  };

  function markFerrariShared(root) {
    root.traverse(function (o) {
      if (o.geometry) o.geometry._shared = true;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      list.forEach(function (m) { if (m) m._shared = true; });
    });
  }

  function preloadFerrari() {
    if (ferrariTemplate || ferrariLoading || !THREE.GLTFLoader) return;
    ferrariLoading = true;
    const loader = new THREE.GLTFLoader();
    if (THREE.DRACOLoader) {
      const draco = new THREE.DRACOLoader();
      draco.setDecoderPath("https://unpkg.com/three@0.128.0/examples/js/libs/draco/gltf/");
      loader.setDRACOLoader(draco);
    }
    loader.load("assets/cars/ferrari.glb", function (gltf) {
      ferrariTemplate = gltf.scene.children[0] || gltf.scene;
      markFerrariShared(ferrariTemplate);
      ferrariLoading = false;
      if (active && active.detailStyle === "ferrari") attach(active, "ferrari");
    }, undefined, function (err) {
      ferrariLoading = false;
      console.warn("[player car] Ferrari mesh unavailable; using lightweight sports fallback.", err);
    });
  }

  function importedFerrari(car) {
    if (!ferrariTemplate) return null;
    const root = ferrariTemplate.clone(true);
    const size = new THREE.Vector3();
    const bounds = new THREE.Box3().setFromObject(root);
    bounds.getSize(size);
    const scale = 4.72 / Math.max(size.x, size.z);
    root.scale.setScalar(scale);
    // ORIENT the import so its NOSE points local +z — this engine's forward
    // (procedural cars put the grille at +z, and vehicles.js drives toward +z at
    // heading 0). Derive the nose straight from the wheel nodes (front = wheel_fl/
    // fr, rear = wheel_rl/rr) so it's correct for ANY car GLB, not a guess: yaw the
    // model so the front→rear axis lands on +z. The bundled ferrari.glb is modelled
    // length-along-Z with its nose at -z (front wheels z≈-1.15, rears z≈+1.50,
    // wheelbase 2.65), so this resolves to a 180° spin — the OLD `size.x>size.z ?
    // -π/2` test never fired for this Z-long mesh, so the car drove tail-first.
    let fx = 0, fz = 0, fn = 0, rx = 0, rz = 0, rn = 0;
    const wp = new THREE.Vector3();
    root.updateMatrixWorld(true);
    root.traverse(function (o) {
      const m = o.name && /^wheel_(fl|fr|rl|rr)$/.exec(o.name);
      if (!m) return;
      o.getWorldPosition(wp);
      if (m[1].charAt(0) === "f") { fx += wp.x; fz += wp.z; fn++; } else { rx += wp.x; rz += wp.z; rn++; }
    });
    if (fn && rn) {
      const nx = fx / fn - rx / rn, nz = fz / fn - rz / rn;   // nose vector (front − rear)
      root.rotation.y = Math.atan2(-nx, nz);                  // yaw that lands the nose on +z
    } else if (size.x > size.z) {
      root.rotation.y = -Math.PI / 2;                         // fallback: a length-along-X import with no named wheels
    }
    root.position.y = -bounds.min.y * scale;
    root.userData.vehicleDims = { width: Math.min(size.x, size.z) * scale, length: Math.max(size.x, size.z) * scale, height: size.y * scale, wheelbase: 2.65 };
    const body = root.getObjectByName("body");
    if (body && body.material && body.material.clone) {
      body.material = body.material.clone();
      body.material.color.setHex(car.color || 0xd1262f);
      body.material._playerCarOwned = true;
    }
    collectWheels(root);
    return root;
  }

  function placeholder(car, hide) {
    if (!car._cityPlaceholder) car._cityPlaceholder = car.group.children.slice();
    car._cityPlaceholder.forEach(function (child) { child.visible = !hide; });
  }

  function detach(car) {
    if (!car) return;
    if (car._playerCarVisual) {
      car._playerCarVisual.traverse(function (o) {
        const list = Array.isArray(o.material) ? o.material : [o.material];
        list.forEach(function (m) { if (m && m._playerCarOwned && m.dispose) m.dispose(); });
      });
      car.group.remove(car._playerCarVisual);
      car._playerCarVisual = null;
    }
    car._visualDims = null;
    placeholder(car, false);
  }

  function attach(car, style) {
    if (!car) return false;
    if (active && active !== car) detach(active);
    detach(car);
    let visual = style === "ferrari" ? importedFerrari(car) : makeProcedural(style);
    if (!visual) visual = makeProcedural("aventador");
    collectWheels(visual);
    visual.name = "player-car-" + style;
    visual.userData.playerCarStyle = style;
    car.group.add(visual);
    car._playerCarVisual = visual;
    car._playerCarActualStyle = style;
    car._visualDims = visual.userData.vehicleDims || car.dims || null;
    // publish the handling-feel hook so the driving sim can read it per style.
    car._playerCarFeel = feelFor(style);
    active = car;
    placeholder(car, true);
    return true;
  }

  // Resolve a procedural STYLE for a car or a raw model. Named models carry a
  // valid `detailStyle` (e.g. "suv","muscle","tesla-3"); otherwise fall back to
  // the name, then the body class, then a clean sedan. Used for BOTH the driven
  // car AND every ambient car now (city/vehicles.js builds the same visual).
  function inferStyle(car) {
    const model = car && (car.model || car);   // accept a car OR a model directly
    // (b) a REGISTERED MARINE KEY is as valid a detailStyle as a STYLE_LABEL one.
    if (model && model.detailStyle
        && (STYLE_LABEL[model.detailStyle]
            || (CBZ.marineHulls && CBZ.marineHulls.get(model.detailStyle)))) return model.detailStyle;
    const name = model ? (model.name || "") : "";
    // (a) THE HULL REGISTRY OWNS BOATS (world/water_hulls.js). It resolves a
    // real class — RIB, runabout, sport cruiser, motor yacht — where the
    // regex below could only ever alias every marine name onto the ONE
    // 6.2m runabout mesh. Returns null for anything it doesn't recognise, so
    // the legacy regex stays as the fallback (and as the ratchet:
    // CBZ.marineHullAudit() counts it until it can be deleted).
    if (CBZ.marineHulls) {
      const mk = CBZ.marineHulls.styleFor(name, model);
      if (mk) return mk;
    }
    if (/ferrari/i.test(name)) return "ferrari";
    if (/charger|mustang|camaro|challenger/i.test(name)) return "muscle";
    if (/impala|cadillac|low\s*rider/i.test(name)) return "lowrider";
    if (/corvette|370z/i.test(name)) return "porsche";
    if (/harley|ducati|bike|moto|superbike|chopper/i.test(name)) return "motorcycle";
    if (/heli|chopper|buzzard|maverick/i.test(name)) return "helicopter";
    if (/boat|speedboat|jetmax|yacht|dinghy/i.test(name)) return "boat";
    if (/van|transit|sprinter|cargo/i.test(name)) return "van";
    if (/cybertruck/i.test(name)) return "cybertruck";
    if (/f-150|cherokee|escalade|suburban|tahoe|suv|range/i.test(name)) return "suv";
    if (/mercedes/i.test(name)) return "tesla-s";
    if (/prius|civic|golf|hatch/i.test(name)) return "hatch";
    if (/caravan/i.test(name)) return "tesla-y";
    // body-class fallback so generic traffic still gets a fitting silhouette
    const body = model && model.body;
    if (body === "muscle") return "muscle";
    if (body === "suv") return "suv";
    if (body === "van") return "van";
    if (body === "pickup") return "cybertruck";
    if (body === "coupe") return "porsche";
    if (body === "hatch") return "hatch";
    return "tesla-3";
  }
  CBZ.cityInferCarStyle = inferStyle;

  // Promotion no longer SWAPS the body — every car (city/vehicles.js) is already
  // built with its detailed, per-car-coloured visual. Promotion just registers
  // this car as the active one so the driving sim spins ITS wheels and reads its
  // handling feel. (Legacy fallback: a car built without a unified visual — e.g.
  // the headless box rig — still gets a hero overlay via attach.)
  CBZ.cityPromotePlayerCar = function (car) {
    if (!car) return;
    const grp = car.group, ud = grp && grp.userData;
    const visual = ud && ud.carVisual;
    if (visual) {
      collectWheels(visual);
      car._playerCarVisual = visual;
      car.detailStyle = ud.carStyle || inferStyle(car);
      car._playerCarFeel = feelFor(car.detailStyle);
      car._visualDims = visual.userData.vehicleDims || car.dims || null;
      active = car;
      return;
    }
    car.detailStyle = car.detailStyle || inferStyle(car);
    if (car.detailStyle === "ferrari") preloadFerrari();
    attach(car, car.detailStyle);
  };

  CBZ.cityDemotePlayerCar = function (car) {
    // Only tear down a LEGACY overlay (one that hid a box rig). The unified
    // visual IS the car's permanent body — leave it in place when you step out.
    if (car && car._cityPlaceholder) detach(car);
    if (active === car) active = null;
  };

  // Rebuild a car's unified visual for a new style, keeping its colour. Used by
  // the [C] style-cycler AND any system that re-skins a car in place.
  function setUnifiedVisual(car, style) {
    const grp = car && car.group; if (!grp) return false;
    /* A BODY WITH A ROOM IN IT CANNOT BE RE-BODIED. This function's whole job
       is `grp.remove(old)` followed by a fresh silhouette — which for a freight
       vehicle destroys the hinged door node city/vehicle_hold.js is holding a
       reference to, and the five shell panels that ARE the room, while leaving
       the hold's rig (anchored to `grp`, which survives) quietly carrying
       whatever was strapped inside a body that no longer exists.
       Every route in — the [C] cycler, the mod shop, the net re-skin — passes
       through here, so the refusal lives here rather than at three call sites.
       It is the same law as "one author per object": the load space is part of
       the vehicle, not a paint job over it. */
    if (grp.userData && grp.userData.holdSpec) return false;
    const ud = grp.userData;
    const old = ud.carVisual;
    if (old) {
      // crash deformation state (vertex rest snapshots, hung panels, dead-lamp
      // swaps) belongs to the OLD body — release it before the swap orphans it.
      if (CBZ.cityCarImpactReset) CBZ.cityCarImpactReset(car);
      old.traverse(function (o) {
        const list = Array.isArray(o.material) ? o.material : [o.material];
        list.forEach(function (m) { if (m && m._playerCarOwned && m.dispose) m.dispose(); });
      });
      grp.remove(old);
    }
    if (style === "ferrari") preloadFerrari();
    const visual = makeProcedural(style, car.color);
    grp.add(visual);
    ud.carVisual = visual; ud.carStyle = style;
    collectWheels(visual);
    car.detailStyle = style;
    car._playerCarVisual = visual;
    car._playerCarFeel = feelFor(style);
    car._visualDims = visual.userData.vehicleDims || car._visualDims || car.dims || null;
    return true;
  }
  CBZ.citySetCarVisual = setUnifiedVisual;

  CBZ.cityUpdatePlayerCarVisual = function (car, dt) {
    const visual = car && car._playerCarVisual;
    if (!visual) return;
    const ud = visual.userData;
    const list = ud.playerWheels || [];
    for (let i = 0; i < list.length; i++) list[i].rotation.x -= car.v * dt * 1.6;
    // motorcycle leans into the turn — read steering from heading change.
    if (ud.leanRider) {
      const dh = car.heading - (car._lastHeading == null ? car.heading : car._lastHeading);
      let d = dh; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      const bank = Math.max(-0.55, Math.min(0.55, (d / Math.max(dt, 0.001)) * 0.18 * Math.sign(car.v || 1)));
      visual.rotation.z += (bank - visual.rotation.z) * Math.min(1, dt * 8);
    }
    car._lastHeading = car.heading;
    // spinning rotors/props: faster with throttle, idle when parked. Blade blur
    // sells "running"; we keep the same mesh so draw cost is unchanged.
    const spin = (4 + Math.abs(car.v) * 0.5) * dt;
    if (ud.mainRotor) ud.mainRotor.rotation.y -= spin * 6;
    if (ud.tailRotor) ud.tailRotor.rotation.x -= spin * 10;
    if (ud.boatProp) ud.boatProp.rotation.z -= spin * 8;
  };

  CBZ.cityCyclePlayerCarStyle = function () {
    if (!active) return;
    // setUnifiedVisual refuses a freight body outright (see its note); say so
    // rather than silently doing nothing when somebody presses the key.
    if (active.group && active.group.userData && active.group.userData.holdSpec) {
      if (CBZ.city && CBZ.city.note) CBZ.city.note("The load space is part of this body, no restyle.", 1.4);
      return;
    }
    const at = Math.max(0, STYLE_ORDER.indexOf(active.detailStyle));
    const style = STYLE_ORDER[(at + 1) % STYLE_ORDER.length];
    // unified path when the car carries a permanent visual; else legacy overlay.
    if (active.group && active.group.userData && active.group.userData.carVisual) setUnifiedVisual(active, style);
    else { active.detailStyle = style; if (style === "ferrari") preloadFerrari(); attach(active, style); }
    if (CBZ.city && CBZ.city.note) CBZ.city.note("Car style: " + STYLE_LABEL[style], 1.2);
  };

  CBZ.cityPlayerCarStyles = STYLE_ORDER.slice();
  CBZ.cityPlayerCarStyleLabels = Object.assign({}, STYLE_LABEL);
  CBZ.cityBuildPlayerCarVisual = function (style, color, livery, model) {
    // The gallery uses the lightweight fallback so auditing all styles never
    // blocks on the optional high-poly GLB/network decoder. `color` (optional)
    // paints THIS instance's body without touching the shared style template.
    // `model` (optional catalog record) selects the BRAND face + model trim —
    // omitted, the silhouette's home marque is used (gallery/style-cycler).
    const v = makeProcedural(style, color, model);
    // RACE LIVERY (optional, additive seam): when a livery descriptor is passed,
    // paint a number + scheme onto THIS instance before it's returned/merged, so
    // both the showroom/AI field and ambient race cars opt in here with no change
    // to makeProcedural's body code. null/undefined livery = the byte-identical
    // no-op path for the whole street fleet. (race_livery.js publishes the layer.)
    if (livery && CBZ.cityApplyRaceLivery) {
      try { CBZ.cityApplyRaceLivery(v, livery); } catch (e) { /* never break a build */ }
    }
    return v;
  };
  // THE VEHICLE ART KIT. These cached builders — one chrome, one glass, one
  // geometry per size, all routed through carfx's vehicleMat — are what make
  // the whole fleet read as one material family instead of a pile of
  // one-offs. world/water_hulls.js's marine fleet draws from EXACTLY these, so
  // a change to the shine or the glass tint uplifts boats and cars together.
  // Any future vehicle builder that lives outside this file uses this and
  // never invents a parallel material path.
  CBZ.cityCarKit = {
    sharedMat, roleMat, paintMat, vmat,
    glassMat, chromeMat, lightFrontMat, lightTailMat,
    boxGeo, prismGeo, addBox, addPrism, addSphere, slopeBox,
  };
  /* ============================================================
     CBZ.carCabinAudit() — THE RATCHET for this wave.

     `bare` is the number that matters: enclosed body styles whose template
     publishes NO dressed cabin. It read 3 before this change (suv, van,
     cybertruck) plus every road car carrying only loose slabs; it must read 0
     and may only ever go DOWN. Everything else here is evidence, not a
     target: honest counts the orchestrator can photograph against.

     Templates are built lazily by makeProcedural, so this BUILDS the enclosed
     styles it has not seen yet — an audit that only measures what happened to
     be driven this session is the "audit nobody has executed" trap in
     doctrine.md. The cost is a handful of hidden groups, once. */
  const OPEN_FRAME = /^(motorcycle|helicopter|boat)$/;
  CBZ.carCabinAudit = function () {
    const out = {
      styles: 0, dressed: 0, bare: 0, bareStyles: [],
      glassPanes: 0, seatAnchors: 0, eyeAnchors: 0, minScreenGap: null,
    };
    for (let i = 0; i < STYLE_ORDER.length; i++) {
      const style = STYLE_ORDER[i];
      if (OPEN_FRAME.test(style)) continue;               // no cabin by design
      out.styles++;
      let t = procTemplates.get(style);
      if (!t) { try { t = makeProcedural(style, null, null); } catch (e) { t = null; } }
      if (!t) { out.bare++; out.bareStyles.push(style); continue; }
      const ci = t.userData.cabinInfo;
      if (ci && ci.dressed) out.dressed++; else { out.bare++; out.bareStyles.push(style); }
      if (ci && ci.seatX != null) out.seatAnchors++;
      if (ci && ci.eye) out.eyeAnchors++;
      t.traverse(function (o) {
        if (o.userData && o.userData.carGlass) out.glassPanes++;
        const g = o.userData && o.userData.carScreen;
        if (g != null && (out.minScreenGap == null || g < out.minScreenGap)) out.minScreenGap = g;
      });
    }
    // the two live halves of the same wave, folded in so the gate is ONE call
    if (CBZ.carDriverAudit) { const d = CBZ.carDriverAudit(); for (const k in d) out[k] = d[k]; }
    if (CBZ.carFpAudit) { const f = CBZ.carFpAudit(); for (const k in f) out[k] = f[k]; }
    return out;
  };

  // public handling-feel lookup so the driving sim / other systems can branch on
  // vehicle class (e.g. air/marine/twoWheel flags) and apply the multipliers.
  CBZ.cityPlayerCarFeel = function (style) {
    return FEEL[style] || (CBZ.marineHulls && CBZ.marineHulls.feel(style)) || (active && active._playerCarFeel) || DEFAULT_FEEL;
  };
  preloadFerrari();

  addEventListener("keydown", function (e) {
    const g = CBZ.game;
    // Aircraft also set player.driving, but C belongs to their held cinematic
    // camera. A flying B-2 must never cycle a road-car body before strategic.js
    // sees the same keydown.
    if (!g || g.mode !== "city" || g.state !== "playing" || !CBZ.player.driving ||
        CBZ.player._aircraft || e.repeat) return;
    if (e.key.toLowerCase() === "c") {
      e.preventDefault();
      CBZ.cityCyclePlayerCarStyle();
    }
  });
})();
