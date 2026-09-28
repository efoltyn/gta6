/* ============================================================
   city/playercars.js - promoted player-car visuals.

   Ambient traffic stays on the tiny city/vehicles.js box rig. Only the car
   currently controlled by the player gets one richer child visual. This keeps
   traffic simulation and draw cost independent from garage variety.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  /* Where src/ is, derived from this file's own URL (the idiom core/studio.js
     uses) so a page in games/ and a page at the repo root both resolve the
     vendored Draco decoder correctly. Captured at LOAD — document.currentScript
     is null by the time preloadFerrari() runs. */
  const SRC_ROOT = (function () {
    const u = (document.currentScript && document.currentScript.src) || "";
    const cut = u.indexOf("city/playercars.js");
    return cut >= 0 ? u.slice(0, cut) : "src/";
  })();
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
    // same rule as `semi`: a real, buildable body (the Rampart crew-cab
    // pickup) with a name, but NOT a stop on the [C] ring — inserting it into
    // STYLE_ORDER would renumber every saved index after it.
    pickup: "Bison Rampart",
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
    pickup:     { class: "suv",    accel: 0.98, top: 0.94, turn: 0.82, grip: 0.86, brake: 0.90, drift: 1.1, roll: 1.2 },
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

  const mats = new Map();
  const boxes = new Map();
  const prisms = new Map();
  const spheres = new Map();
  const procTemplates = new Map();
  const tplCtx = new WeakMap();        // template -> its full brand-face context
  let ferrariTemplate = null;
  let ferrariLoading = false;
  let active = null;

  /* A CABIN MATERIAL SHADES BY ITS VERTICES (opts.vcol). Lambert multiplies
     the diffuse by the colour attribute on its own; the emissive lift — which
     is most of what a roofed cabin renders at — does not, so the baked shade
     would only ever darken the ambient half. One line in the fragment shader
     applies the same shade to the lift, and the cabin gets real gradients
     from a flat-lit material. Every mesh drawn with a vcol material MUST
     carry a colour attribute (a missing one reads as black): dressCabin's
     shade bake and buildDoor's card bake are the only writers. */
  function shadeEmissive(shader) {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      "#include <emissivemap_fragment>\n#ifdef USE_COLOR\n\ttotalEmissiveRadiance *= vColor;\n#endif");
  }
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
        vertexColors: !!opts.vcol,
      });
    if (opts.vcol && !opts.basic) m.onBeforeCompile = shadeEmissive;
    m._shared = true;
    mats.set(key, m);
    return m;
  }
  const _dir = new THREE.Vector3(), _zAxis = new THREE.Vector3(0, 0, 1);

  // ---- ROLE materials, cached & SHINY (via carfx vmat) ---------------------
  // Per-STYLE body PAINT: a fresh shiny clearcoat material, tagged _bodyPaint so
  // recolorBody clones+recolours it per car, and _shared so the template copy is
  // never disposed. Keyed by style so each silhouette keeps its showroom default.
  function paintMat(style, color, opts) {
    const key = "paint-" + style;
    let m = mats.get(key);
    if (m) return m;
    m = vmat("paint", color, opts);
    // SMOOTH, not faceted: the body is a lofted shell whose authored normals
    // ARE the curvature (carfx's paint role defaults to flatShading, which
    // would facet every panel back into the low-poly box it replaced).
    if (m.flatShading) { m.flatShading = false; m.needsUpdate = true; }
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
  // car glass = carfx 'autoGlass' (reflective Physical transmission pane; the
  // tint stays inside crashdeform's frost window). Aircraft keep THE ONE GLASS.
  const glassMat = () => roleMat("glass", "autoGlass", 0x1c3346);
  const chromeMat = () => roleMat("chrome", "chrome", 0xc4ccd4, { emissive: 0x262b31, ei: 0.3 });
  const lightFrontMat = () => roleMat("lightFront", "lightFront", 0xeaf8ff, { emissive: 0xc8efff, ei: 0.9 });
  const lightTailMat = () => roleMat("lightTail", "lightTail", 0xff3344, { emissive: 0xff2233, ei: 0.95 });
  // a real plate (carfx atlas: light field, dark registration). Each call
  // takes the next of eight variants, so styles do not all share one number.
  const plateMat = () => (CBZ.carPlateMat ? CBZ.carPlateMat() : roleMat("plate", "plastic", 0xe8edf2));

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
  // ---- the hull's WIDTH as a function of (z, y) ----------------------------
  // A profile carries its width scale per POINT; the flank between points is
  // whatever the triangulation makes of it. Anything that has to sit flush on
  // that flank at an arbitrary point — a door aperture's rim, the door skin
  // that fills it — needs one agreed answer, so this is it: the bottom edge's
  // scale interpolated along z, blended toward the top edge's scale with
  // height. Points on the profile itself get exactly their own scale back.
  function hullWidthFn(profile, half) {
    const ws = (p) => (p.length > 2 && p[2] != null ? p[2] : 1);
    let yTop = 0;
    for (let i = 0; i < profile.length; i++) yTop = Math.max(yTop, profile[i][1]);
    const split = yTop * 0.5;
    const bottom = [], top = [];
    for (let i = 0; i < profile.length; i++) (profile[i][1] < split ? bottom : top).push([profile[i][0], ws(profile[i])]);
    bottom.sort((a, b) => a[0] - b[0]); top.sort((a, b) => a[0] - b[0]);
    function interp(list, z) {
      if (!list.length) return 1;
      if (z <= list[0][0]) return list[0][1];
      for (let i = 0; i + 1 < list.length; i++) {
        if (z <= list[i + 1][0]) {
          const span = list[i + 1][0] - list[i][0];
          const u = span > 1e-6 ? (z - list[i][0]) / span : 0;
          return list[i][1] + (list[i + 1][1] - list[i][1]) * u;
        }
      }
      return list[list.length - 1][1];
    }
    return function (z, y) {
      const u = yTop > 1e-6 ? Math.max(0, Math.min(1, y / yTop)) : 0;
      return half * (interp(bottom, z) * (1 - u) + interp(top, z) * u);
    };
  }

  // Triangulate a (z,y) polygon with holes. Answers an index list over the
  // COMBINED vertex list [contour..., hole0..., hole1...] with every triangle
  // wound CLOCKWISE in (z,y) — which faces +x under the [x, y, z] mapping the
  // callers use, so a `side < 0` swap gives each flank an outward face.
  // Ear-clipping, not a fan: a fan assumes the polygon is star-shaped from one
  // corner, and a flank with fender bumps and door holes is nothing of the
  // kind. Earcut's output orientation follows its input and can flip per ear,
  // so the winding is normalised by signed area afterwards.
  function flankTris(contour, holes) {
    const cV = contour.map((p) => new THREE.Vector2(p[0], p[1]));
    const hV = (holes || []).map((h) => h.map((p) => new THREE.Vector2(p[0], p[1])));
    const tris = THREE.ShapeUtils.triangulateShape(cV, hV);
    const verts = cV.slice();
    for (let h = 0; h < hV.length; h++) for (let k = 0; k < hV[h].length; k++) verts.push(hV[h][k]);
    for (let t = 0; t < tris.length; t++) {
      const A = verts[tris[t][0]], B = verts[tris[t][1]], C = verts[tris[t][2]];
      const area = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x);
      if (area > 0) { const tmp = tris[t][1]; tris[t][1] = tris[t][2]; tris[t][2] = tmp; }
    }
    return { tris: tris, verts: verts };
  }
  // one quad (a,b,c,d), wound so its face normal points toward `toward`
  function quadToward(pos, a, b, c, d, toward) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const dot = nx * (toward[0] - a[0]) + ny * (toward[1] - a[1]) + nz * (toward[2] - a[2]);
    if (dot >= 0) pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]);
    else pos.push(a[0], a[1], a[2], c[0], c[1], c[2], b[0], b[1], b[2], a[0], a[1], a[2], d[0], d[1], d[2], c[0], c[1], c[2]);
  }

  // profile points are [z, y] OR [z, y, wScale] — an optional per-point WIDTH
  // SCALE (relative to the `width` arg) so the extrusion can bulge/tuck in X as
  // it runs along its length instead of staying a constant-width slab. This is
  // what turns a flat-flanked box into a body with fender bulges over the
  // wheels and a tucked waist between them (real automotive character line),
  // while staying 100% backward compatible: points with no 3rd element behave
  // exactly as before (scale 1 = the old constant-width prism).
  //
  // opts.holes     polygons ([[z,y],...]) cut through BOTH flanks — the door
  //                apertures. A car with doors is HOLLOW where its doors are.
  // opts.jamb      how far inboard (m) each aperture's rim walls run, so the
  //                cut has a painted edge and not a paper-thin one.
  // opts.jambFloor profile-local y the aperture's bottom rim drops to on its
  //                inner edge — the rocker's inner face, down to the floor pan.
  // Without holes the geometry is byte-identical to the plain prism.
  function prismGeo(width, profile, opts) {
    const holes = (opts && opts.holes && opts.holes.length) ? opts.holes : null;
    const jamb = holes && opts.jamb ? opts.jamb : 0;
    const jambFloor = holes && opts.jambFloor != null ? opts.jambFloor : null;
    /* opts.deckCut / opts.floorCut  { z0, z1, half }
       THE LID OVER THE SEATS. A closed prism sweeps every profile edge across
       its full width, and a hull's deck edge runs from the tail deck to the
       hood — straight through the cabin at belt height. Measured from the
       driver's seat: a painted plate 8 cm under the eye, hiding the seats,
       the console and the floor of a cabin the dresser had fully built; from
       above, the same plate is why a furnished car read as a filled solid.
       The glass tub had the same fault upside down: its bottom edge was a
       pane of tinted glass lying across the cabin at the sill.
       A cut removes the swept edge at the prism's TOP (deckCut) or BOTTOM
       (floorCut) between z0 and z1, leaving `half`-wide strips only outboard
       of |x| = half (0 = remove it entirely). Everything else is byte-identical. */
    const deckCut = opts && opts.deckCut ? opts.deckCut : null;
    const floorCut = opts && opts.floorCut ? opts.floorCut : null;
    const cutKey = (c) => c ? "$" + c.z0 + "," + c.z1 + "," + c.half : "";
    const key = width + "|" + profile.map((p) => p.join(",")).join("|") +
      (holes ? "#" + holes.map((h) => h.map((p) => p.join(",")).join(";")).join("|") + "#" + jamb + "," + jambFloor : "") +
      cutKey(deckCut) + "^" + cutKey(floorCut);
    let geo = prisms.get(key);
    if (geo) return geo;
    const pos = [];
    const half = width / 2;
    function hw(i) { const p = profile[i]; return half * (p.length > 2 && p[2] != null ? p[2] : 1); }
    function tri(a, b, c) { pos.push(...a, ...b, ...c); }
    const hwAt = hullWidthFn(profile, half);
    // Flank (end-cap) faces: the profile's (z,y) outline, minus the holes.
    const F = flankTris(profile, holes);
    const tris = F.tris, verts = F.verts;
    const xOf = (i) => (i < profile.length ? hw(i) : hwAt(verts[i].x, verts[i].y));
    for (let side = -1; side <= 1; side += 2) {
      for (let t = 0; t < tris.length; t++) {
        const ia = tris[t][0], ib = tris[t][1], ic = tris[t][2];
        const a = [side * xOf(ia), verts[ia].y, verts[ia].x];
        const b = [side * xOf(ib), verts[ib].y, verts[ib].x];
        const c = [side * xOf(ic), verts[ic].y, verts[ic].x];
        if (side < 0) tri(a, c, b); else tri(a, b, c);
      }
    }
    let topY = -Infinity, botY = Infinity;
    for (let i = 0; i < profile.length; i++) { topY = Math.max(topY, profile[i][1]); botY = Math.min(botY, profile[i][1]); }
    // one swept face between z=za (width wa) and z=zb (width wb) at height y;
    // xIn > 0 leaves only the two outboard strips, xIn === 0 the full span
    const sweep = function (za, wa, zb, wb, y, xIn) {
      // (a,c,b)/(a,d,c): the profiles run CLOCKWISE in (z,y), so the old
      // (a,b,c)/(a,c,d) wound every sweep face INWARD — the deck/nose/tail
      // skins were invisible from outside and only the slab bolt-ons hid it
      // (isolated-hull orbit shots + a DoubleSide A/B proved it).
      if (!xIn) {
        const a = [-wa, y[0], za], b = [wa, y[0], za], c = [wb, y[1], zb], d = [-wb, y[1], zb];
        tri(a, c, b); tri(a, d, c);
        return;
      }
      if (xIn >= Math.min(wa, wb)) return;
      const a1 = [xIn, y[0], za], b1 = [wa, y[0], za], c1 = [wb, y[1], zb], d1 = [xIn, y[1], zb];
      tri(a1, c1, b1); tri(a1, d1, c1);
      const a2 = [-wa, y[0], za], b2 = [-xIn, y[0], za], c2 = [-xIn, y[1], zb], d2 = [-wb, y[1], zb];
      tri(a2, c2, b2); tri(a2, d2, c2);
    };
    for (let i = 0; i < profile.length; i++) {
      const j = (i + 1) % profile.length;
      const zi = profile[i][0], zj = profile[j][0], yi = profile[i][1], yj = profile[j][1];
      const wi = hw(i), wj = hw(j);
      const cut = (deckCut && yi === topY && yj === topY) ? deckCut
        : (floorCut && yi === botY && yj === botY) ? floorCut : null;
      const lo = Math.min(zi, zj), hi = Math.max(zi, zj);
      if (!cut || cut.z1 <= lo || cut.z0 >= hi || hi - lo < 1e-6) { sweep(zi, wi, zj, wj, [yi, yj], 0); continue; }
      // split the edge at the cut, walking in the edge's own direction so the
      // winding of every sub-face matches the uncut face
      const wAt = (z) => wi + (wj - wi) * (z - zi) / (zj - zi);
      const c0 = Math.max(lo, cut.z0), c1 = Math.min(hi, cut.z1);
      const segs = zi < zj
        ? [[zi, c0, 0], [c0, c1, cut.half], [c1, zj, 0]]
        : [[zi, c1, 0], [c1, c0, cut.half], [c0, zj, 0]];
      for (let k = 0; k < segs.length; k++) {
        const za = segs[k][0], zb = segs[k][1];
        if (Math.abs(zb - za) < 1e-6) continue;
        if (segs[k][2] === 0 && k === 1) continue;                 // half 0: the span is simply gone
        sweep(za, wAt(za), zb, wAt(zb), [yi, yj], k === 1 ? segs[k][2] : 0);
      }
    }
    // THE APERTURE HAS A RIM. A hole in a shell is a paper edge — from any
    // angle but dead-on you would look straight through the flank's thickness
    // into culled backfaces. Each hole edge gets a wall running `jamb` inboard
    // (facing INTO the hole, which is the only way you ever see it) and the
    // bottom edge drops from there to the floor pan, so looking down through
    // an open door you land on a sill and a floor, not on daylight.
    if (holes) {
      for (let h = 0; h < holes.length; h++) {
        const poly = holes[h];
        let cz = 0, cy = 0, yMin = Infinity;
        for (let i = 0; i < poly.length; i++) { cz += poly[i][0]; cy += poly[i][1]; yMin = Math.min(yMin, poly[i][1]); }
        cz /= poly.length; cy /= poly.length;
        for (let side = -1; side <= 1; side += 2) {
          const centre = [side * (hwAt(cz, cy) - jamb * 0.5), cy, cz];
          for (let i = 0; i < poly.length; i++) {
            const j = (i + 1) % poly.length;
            const zi = poly[i][0], yi = poly[i][1], zj = poly[j][0], yj = poly[j][1];
            const oi = hwAt(zi, yi), oj = hwAt(zj, yj);
            const a = [side * oi, yi, zi], b = [side * oj, yj, zj];
            const c = [side * (oj - jamb), yj, zj], d = [side * (oi - jamb), yi, zi];
            quadToward(pos, a, b, c, d, centre);
            if (jambFloor != null && Math.abs(yi - yMin) < 1e-6 && Math.abs(yj - yMin) < 1e-6 && jambFloor < yi) {
              const e = [side * (oi - jamb), jambFloor, zi], f = [side * (oj - jamb), jambFloor, zj];
              quadToward(pos, d, c, f, e, [side * (oi + 1), (yi + jambFloor) * 0.5, (zi + zj) * 0.5]);
            }
          }
        }
      }
    }
    geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    geo._shared = true;
    prisms.set(key, geo);
    return geo;
  }

  // several non-indexed geometries → one (positions + normals), for the
  // three-mesh door below
  function concatGeos(list) {
    const flat = list.map((g) => (g.index ? g.toNonIndexed() : g));
    let n = 0;
    for (let i = 0; i < flat.length; i++) n += flat[i].attributes.position.count;
    const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
    let k = 0;
    for (let i = 0; i < flat.length; i++) {
      const g = flat[i];
      if (!g.attributes.normal) g.computeVertexNormals();
      pos.set(g.attributes.position.array, k);
      nrm.set(g.attributes.normal.array, k);
      k += g.attributes.position.array.length;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    geo.computeBoundingSphere();
    return geo;
  }

  // the door card's own shade (see shadeCabin): dark at the sill, brightest
  // at the belt, an armrest's underside in its own shadow
  function shadeDoorCard(geo, yLow, yHigh) {
    const pos = geo.attributes.position, nor = geo.attributes.normal;
    const n = pos.count, col = new Float32Array(n * 3);
    const span = Math.max(0.2, yHigh - yLow);
    for (let i = 0; i < n; i++) {
      const y = pos.getY(i), ny = nor ? nor.getY(i) : 0;
      let s = 0.50 + 0.65 * Math.max(0, Math.min(1, (y - yLow) / span));
      s += ny > 0 ? 0.15 * ny : -0.25 * -ny;
      s = Math.max(0.25, Math.min(1.3, s));
      col[i * 3] = s; col[i * 3 + 1] = s; col[i * 3 + 2] = s;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  }

  // ---- WHEELS live in city/carwheels.js: one lathed tyre + dished rim +
  // spokes + rotor per wheel as ONE mesh (vertex colours + carfx's 'wheel'
  // ramp material), built once per (radius, width, style, rimFrac) and
  // shared by every car. The old CylinderGeometry tyre, box-spoke rim and
  // flat brake disc (three meshes a wheel) are gone. ----

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

  // ONE wheel at the origin, axle along the mesh's own Y (+Y = rim face,
  // outboard); the caller lays it on its side with rotation.z = -+PI/2.
  // Tagged playerWheel: spared by the static merge, spun by the drive loops.
  // rotation.order YXZ = Ry(steer) * Rx(spin) * Rz(lay-down): see carwheels.js.
  function makeWheel(radius, width, rimStyle, rimFrac) {
    const W = CBZ.carWheels;
    const wheel = new THREE.Mesh(W.wheelGeo(radius, width, rimStyle || "sport5", rimFrac || 0.66), W.wheelMat());
    wheel.castShadow = false;
    wheel.rotation.order = "YXZ";
    wheel.userData.playerWheel = true;
    return wheel;
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

  function addPrism(root, width, profile, y, material, opts) {
    const mesh = new THREE.Mesh(prismGeo(width, profile, opts), material);
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
      // brake CALIPER: an arc block straddling the rotor edge INSIDE the
      // barrel, behind the spokes, near the top of the wheel. A root child, so
      // it never spins (the rotor does, it is part of the wheel mesh) and the
      // static merge bakes all four into one draw. Default: dark grey.
      const cal = new THREE.Mesh(CBZ.carWheels.caliperGeo(radius, wheelWidth, rimFrac || 0.66, Math.sign(p[0]) || 1, rimStyle || "sport5"),
        caliperMat || sharedMat("caliper-dk", 0x3a3f45));
      cal.position.set(p[0], radius, p[1]);
      cal.castShadow = false;
      cal.userData.noSeal = true;
      root.add(cal);
    });
  }

  function collectWheels(root) {
    const out = [];
    root.traverse(function (o) {
      if ((o.userData && o.userData.playerWheel) || (o.name && /^wheel_(fl|fr|rl|rr)$/.test(o.name))) out.push(o);
    });
    root.userData.playerWheels = out;
    if (CBZ.carWheels) CBZ.carWheels.tagSteer(out);   // front axle yaws (userData.steers)
  }

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

  /* THE CABIN'S LIGHT, in one paragraph (the long history lives in git).
     This is a Lambert world with no bounce: the sun cannot reach a roofed
     room, so every cabin surface renders at the ambient floor and then passes
     through a 0.35-opacity pane. The fix is an emissive LIFT standing in for
     the bounce light a real cabin gets off its own glass, carried mostly by
     the emissive and little by the diffuse (a pale diffuse clips to white
     where the windscreen lets sun onto the dash). crashdeform.js frosts any
     material whose hue reads as glass, so the cabin material stays warm-grey
     and vertex-coloured (which crashdeform skips). */
  const rings = new Map();
  function ringGeo(r, tube) {
    const key = r.toFixed(3) + "|" + tube.toFixed(3);
    let geo = rings.get(key);
    if (!geo) {
      // a steering-wheel-sized ring at half a metre is the most looked-at
      // object in a first-person cabin; small rings keep the cheap tessellation
      geo = r >= 0.12 ? new THREE.TorusGeometry(r, tube, 9, 30) : new THREE.TorusGeometry(r, tube, 5, 14);
      geo._shared = true;
      rings.set(key, geo);
    }
    return geo;
  }
  /* ============================================================
     THE CABIN, BUILT AS ONE ROOM (car wave 2026-09-27).

     OWNER: "especially the interior and what it looks like for the driver
     and being a passenger or car ride ... with two seats and six seats".

     What the previous cabin was, measured by reading it: ~150 loose BOXES in
     ELEVEN materials (structure, lite, seat, leather, belt, mirror, trim,
     screen, cyan, red, amber) — i.e. up to eleven merged draw calls per car
     for the interior alone — seats that were two slabs and a brick, a
     steering wheel welded into the static merge so it could never turn, a
     cluster made of 40 tick-mark boxes, and exactly two front seats and one
     bench for every body from a Ferrari to a van.

     What it is now:
       • THE SEATS COME FROM city/carseats.js — the ONE seat model the rig,
         the NPC occupancy, boarding and the passenger code all read. A
         coupe gets two buckets, a sedan 2+3, a 2+2 gets its jump seats, the
         six-seat SUV three rows of captain's chairs, a pickup a 3-across
         bench, a van a 3-across cab bench. dressCabin only upholsters what
         that model says is there.
       • ONE GEOMETRY, ONE MATERIAL. Every static piece is baked into a single
         buffer with a per-vertex colour = the room's light (shadeCabin) x the
         piece's own TONE (headliner pale, seats in the class's upholstery,
         trim satin, carpet dark). The material's emissive lift is multiplied
         by that colour (sharedMat vcol), so value AND hue live in the vertex
         and the whole room is one draw call.
       • THE LIT GLASS IS ONE MESH on one shared canvas atlas: a hooded
         cluster (speedo + tach faces, drawn once for the whole fleet) and a
         centre screen. No needle is painted — a gauge that lies is worse than
         none (carcluster.js's rule); the needles are live meshes only in the
         car the player sits in (vehicles.js seatDriver).
       • THE WHEEL IS ITS OWN GROUP ("cabin_steer" > "cabin_steer_spin"), so
         the driven car turns it with the steering input and the driver's
         hands (vehicles.js) hold its rim.
     Net draw cost for a dressed car: 3 (room, glass, wheel), down from ~11.
  ============================================================ */
  const cabinMat = () => sharedMat("interior-v5", 0x0f1114, { emissive: 0x141719, ei: 1.0, vcol: true });
  // the body builders still read these two (roof tumble, pillar trims)
  if (CFG.CAR_CABIN_V3 == null) CFG.CAR_CABIN_V3 = true;
  const cabinV3 = () => CFG.CAR_CABIN_V3 !== false;
  // which style dressCabin is dressing right now (makeProcedural sets it), so
  // a body that does not pass `seatLayout` still gets its class's seats
  let _cabinStyle = null;

  /* TONES — multipliers on the one dark material (base 0x0f1114, lift
     0x141719). sRGB + ACES: a vertex colour of ~2 is the old pale headliner,
     ~1.3 the old seat, 1 the old structure. Nothing here may push a big
     surface past ~2.2 or the sun through the windscreen bleaches it. */
  const TONE = {
    struct: [1, 1, 1], carpet: [0.74, 0.72, 0.7], head: [1.95, 1.9, 1.82],
    trim: [2.15, 2.15, 2.22], chrome: [2.9, 2.9, 3.0], leather: [0.9, 0.88, 0.86],
    belt: [0.84, 0.85, 0.9], mirror: [0.5, 0.58, 0.68], pedal: [1.6, 1.6, 1.62],
    grille: [0.55, 0.55, 0.56], lamp: [2.4, 2.3, 2.1],
  };
  // upholstery per seat model: the body, and the centre insert panels
  const THEMES = {
    coupe2: { seat: [1.02, 1.0, 0.99], insert: [1.75, 0.5, 0.42] },     // black hide, red inserts
    coupe4: { seat: [1.62, 1.14, 0.78], insert: [1.42, 0.98, 0.66] },   // tan leather
    sedan5: { seat: [1.24, 1.25, 1.28], insert: [1.04, 1.05, 1.09] },   // grey cloth
    suv6:   { seat: [1.5, 1.1, 0.8], insert: [1.3, 0.94, 0.68] },       // saddle brown
    suv7:   { seat: [1.3, 1.3, 1.32], insert: [1.12, 1.12, 1.16] },
    pickup6: { seat: [1.06, 1.12, 1.22], insert: [0.94, 0.99, 1.08] },  // work vinyl
    van3:   { seat: [1.06, 1.12, 1.22], insert: [0.94, 0.99, 1.08] },
    van6:   { seat: [1.06, 1.12, 1.22], insert: [0.94, 0.99, 1.08] },
    cab2:   { seat: [1.1, 1.1, 1.12], insert: [0.98, 0.98, 1.0] },
  };

  /* A ROUNDED BOX. BoxGeometry with two segments a side, every vertex pulled
     onto a radius-r round of its inner box, normals from the same solve —
     the cheapest shape that reads as upholstery instead of lumber. `crown`
     domes the top face (a cushion, a headrest). Cached; never mutated. */
  const rboxes = new Map();
  function rboxGeo(w, h, d, r, crown) {
    const key = [w, h, d, r, crown || 0].map((v) => (+v).toFixed(3)).join("|");
    let geo = rboxes.get(key);
    if (geo) return geo;
    r = Math.max(0.002, Math.min(r, w * 0.45, h * 0.45, d * 0.45));
    geo = new THREE.BoxGeometry(w, h, d, 2, 2, 2).toNonIndexed();
    const pos = geo.attributes.position, nor = geo.attributes.normal;
    const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const cx = Math.max(-hx, Math.min(hx, x)), cy = Math.max(-hy, Math.min(hy, y)), cz = Math.max(-hz, Math.min(hz, z));
      let nx = x - cx, ny = y - cy, nz = z - cz;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      let px = cx + nx * r, py = cy + ny * r, pz = cz + nz * r;
      if (crown && ny > 0.5) py += crown * (1 - (x / (w / 2)) * (x / (w / 2))) * (1 - (z / (d / 2)) * (z / (d / 2)));
      pos.setXYZ(i, px, py, pz);
      nor.setXYZ(i, nx, ny, nz);
    }
    geo._shared = true;
    rboxes.set(key, geo);
    return geo;
  }
  const _cm = new THREE.Matrix4(), _cq = new THREE.Quaternion(), _ce = new THREE.Euler(), _cs = new THREE.Vector3(1, 1, 1), _cp = new THREE.Vector3();
  function mtx(x, y, z, rx, ry, rz) {
    _ce.set(rx || 0, ry || 0, rz || 0, "XYZ");
    _cq.setFromEuler(_ce);
    _cp.set(x || 0, y || 0, z || 0);
    return new THREE.Matrix4().compose(_cp, _cq, _cs);
  }
  // an accumulator of transformed, toned pieces → one buffer
  function cabinAcc() {
    const list = [];
    const A = {
      list: list,
      put: function (geo, tone, m) {
        const g = geo.index ? geo.toNonIndexed() : geo.clone();
        if (!g.attributes.normal) g.computeVertexNormals();
        if (m) g.applyMatrix4(m);
        list.push({ geo: g, tone: tone || TONE.struct });
        return g;
      },
      box: function (w, h, d, x, y, z, tone, rx, ry, rz) {
        return A.put(boxGeo(w, h, d), tone, mtx(x, y, z, rx, ry, rz));
      },
      rbox: function (w, h, d, r, x, y, z, tone, rx, ry, rz, crown) {
        return A.put(rboxGeo(w, h, d, r, crown), tone, mtx(x, y, z, rx, ry, rz));
      },
      // a box from point a to point b (a strap, a pillar trim, a stalk)
      bar: function (a, b, w, h, tone) {
        const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
        const len = Math.max(0.005, Math.hypot(dx, dy, dz));
        _dir.set(dx, dy, dz).normalize();
        _cq.setFromUnitVectors(_zAxis, _dir);
        _cp.set((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5);
        return A.put(boxGeo(w, h, len), tone, new THREE.Matrix4().compose(_cp, _cq, _cs));
      },
      ring: function (r, tube, m, tone) { return A.put(ringGeo(r, tube), tone, m); },
    };
    return A;
  }
  // non-indexed pieces (position/normal/color) → one geometry
  function bakeAcc(A, f) {
    shadeCabin(A.list, f);
    let n = 0;
    for (let i = 0; i < A.list.length; i++) n += A.list[i].geo.attributes.position.count;
    const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), col = new Float32Array(n * 3);
    let k = 0;
    for (let i = 0; i < A.list.length; i++) {
      const g = A.list[i].geo;
      pos.set(g.attributes.position.array, k);
      nrm.set(g.attributes.normal.array, k);
      col.set(g.attributes.color.array, k);
      k += g.attributes.position.array.length;
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    geo._shared = true;
    return geo;
  }

  /* ---- THE GLASS ATLAS: one canvas for the whole fleet ------------------
     512 x 512. Rows 0..163: the instrument cluster (speedometer left, tach
     right, faces only). Rows 176..486: the centre screen (a map with a
     route). No brand, no clock, no number the game does not know. */
  const ATLAS = { W: 512, H: 512, cl: [0, 0, 512, 163], sc: [0, 176, 512, 310],
    dials: [{ cx: 128, cy: 84, r: 70, kind: "speed", max: 160 }, { cx: 384, cy: 84, r: 70, kind: "tach", max: 8 }],
    a0: Math.PI * 1.25, a1: -Math.PI * 0.25 };
  let _atlasMat = null;
  function drawAtlas(ctx) {
    const W = ATLAS.W;
    ctx.fillStyle = "#020304"; ctx.fillRect(0, 0, W, ATLAS.H);
    // cluster backing: a soft pool of light behind each dial
    ATLAS.dials.forEach(function (d) {
      const gr = ctx.createRadialGradient(d.cx, d.cy, 4, d.cx, d.cy, d.r + 10);
      gr.addColorStop(0, "#0b1a24"); gr.addColorStop(1, "#020304");
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(d.cx, d.cy, d.r + 10, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#5c6a74"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(d.cx, d.cy, d.r, 0, Math.PI * 2); ctx.stroke();
      const steps = d.kind === "speed" ? 16 : 16, major = d.kind === "speed" ? 2 : 2;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps, a = ATLAS.a0 + (ATLAS.a1 - ATLAS.a0) * t;
        const big = i % major === 0;
        const red = d.kind === "tach" && t * d.max >= 6.5;
        ctx.strokeStyle = red ? "#ff4a3a" : big ? "#e8eef2" : "#9aa6ae";
        ctx.lineWidth = big ? 3 : 1.5;
        const r0 = d.r - (big ? 14 : 8), r1 = d.r - 3;
        ctx.beginPath();
        ctx.moveTo(d.cx + Math.cos(a) * r0, d.cy - Math.sin(a) * r0);
        ctx.lineTo(d.cx + Math.cos(a) * r1, d.cy - Math.sin(a) * r1);
        ctx.stroke();
        if (big) {
          const v = d.kind === "speed" ? Math.round(t * d.max) : Math.round(t * d.max);
          ctx.fillStyle = red ? "#ff6a5a" : "#cfd8de";
          ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          const rt = d.r - 26;
          ctx.fillText(String(v), d.cx + Math.cos(a) * rt, d.cy - Math.sin(a) * rt);
        }
      }
      if (d.kind === "tach") {
        ctx.strokeStyle = "#ff3a2a"; ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(d.cx, d.cy, d.r - 2, -(ATLAS.a0 + (ATLAS.a1 - ATLAS.a0) * (6.5 / 8)), -ATLAS.a1);
        ctx.stroke();
      }
      ctx.fillStyle = "#3cd8f8"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center";
      ctx.fillText(d.kind === "speed" ? "MPH" : "RPM x1000", d.cx, d.cy + d.r * 0.52);
      ctx.fillStyle = "#11181d"; ctx.beginPath(); ctx.arc(d.cx, d.cy, 9, 0, Math.PI * 2); ctx.fill();
    });
    // the strip between the dials: gear letters, a fuel bar outline
    ctx.fillStyle = "#cfd8de"; ctx.font = "bold 22px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("D", 256, 70);
    ctx.fillStyle = "#6c7880"; ctx.font = "bold 11px sans-serif";
    ctx.fillText("P R N", 256, 96);
    ctx.strokeStyle = "#5c6a74"; ctx.lineWidth = 1.5; ctx.strokeRect(222, 124, 68, 9);
    ctx.fillStyle = "#3cd8f8"; ctx.fillRect(224, 126, 44, 5);
    // ---- the centre screen: a street map with a route ------------------
    const S = ATLAS.sc, x0 = S[0], y0 = S[1], w = S[2], h = S[3];
    ctx.fillStyle = "#0a1015"; ctx.fillRect(x0, y0, w, h);
    ctx.strokeStyle = "#1f2a33"; ctx.lineWidth = 6;
    for (let i = 0; i < 7; i++) {
      ctx.beginPath(); ctx.moveTo(x0 + i * 82 + 20, y0); ctx.lineTo(x0 + i * 82 - 30, y0 + h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x0, y0 + i * 52 + 14); ctx.lineTo(x0 + w, y0 + i * 52 + 34); ctx.stroke();
    }
    ctx.fillStyle = "#12301f"; ctx.fillRect(x0 + 300, y0 + 40, 120, 70);        // a park block
    ctx.fillStyle = "#0e2230"; ctx.fillRect(x0 + 40, y0 + 200, 150, 60);         // water
    ctx.strokeStyle = "#3cd8f8"; ctx.lineWidth = 7; ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(x0 + 250, y0 + h - 40); ctx.lineTo(x0 + 262, y0 + 190); ctx.lineTo(x0 + 350, y0 + 176);
    ctx.lineTo(x0 + 372, y0 + 70); ctx.stroke();
    ctx.fillStyle = "#ffaa24";
    ctx.beginPath(); ctx.moveTo(x0 + 250, y0 + h - 62); ctx.lineTo(x0 + 238, y0 + h - 30); ctx.lineTo(x0 + 262, y0 + h - 30); ctx.fill();
    // bottom bar: fan + seat-heat marks (icons, no values)
    ctx.fillStyle = "#050809"; ctx.fillRect(x0, y0 + h - 22, w, 22);
    ctx.fillStyle = "#9aa6ae";
    for (let i = 0; i < 4; i++) ctx.fillRect(x0 + 200 + i * 10, y0 + h - 8 - i * 3, 6, 4 + i * 3);
    ctx.fillRect(x0 + 30, y0 + h - 14, 22, 5); ctx.fillRect(x0 + w - 52, y0 + h - 14, 22, 5);
  }
  function screenMat() {
    if (_atlasMat) return _atlasMat;
    let tex = null;
    try {
      if (typeof document !== "undefined" && document.createElement) {
        const cv = document.createElement("canvas");
        cv.width = ATLAS.W; cv.height = ATLAS.H;
        const ctx = cv.getContext && cv.getContext("2d");
        if (ctx) { drawAtlas(ctx); tex = new THREE.CanvasTexture(cv); }
      }
    } catch (e) { tex = null; }
    if (!tex) { _atlasMat = sharedMat("interior-screen-v5", 0x04060a, { emissive: 0x0c1e2c, ei: 0.9 }); return _atlasMat; }
    if (THREE.sRGBEncoding != null) tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = 4;
    _atlasMat = new THREE.MeshLambertMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.92 });
    _atlasMat._shared = true;
    mats.set("interior-atlas", _atlasMat);
    return _atlasMat;
  }
  // a quad facing -Z (the occupants), UVs cut from an atlas rect
  function atlasQuad(w, h, rect, m) {
    const g = new THREE.PlaneGeometry(w, h);
    g.rotateY(Math.PI);                       // face the seats: u runs to the driver's right
    const uv = g.attributes.uv;
    const u0 = rect[0] / ATLAS.W, u1 = (rect[0] + rect[2]) / ATLAS.W;
    const v1 = 1 - rect[1] / ATLAS.H, v0 = 1 - (rect[1] + rect[3]) / ATLAS.H;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) < 0.5 ? u0 : u1, uv.getY(i) < 0.5 ? v0 : v1);
    g.applyMatrix4(m);
    return g.toNonIndexed();
  }

  // atlas quads → one geometry that KEEPS its uvs (mergeGeo drops them)
  function quadsGeo(list) {
    let n = 0;
    for (let i = 0; i < list.length; i++) n += list[i].attributes.position.count;
    const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uvs = new Float32Array(n * 2);
    let k = 0, u = 0;
    for (let i = 0; i < list.length; i++) {
      const g = list[i];
      pos.set(g.attributes.position.array, k); nrm.set(g.attributes.normal.array, k);
      uvs.set(g.attributes.uv.array, u);
      k += g.attributes.position.array.length; u += g.attributes.uv.array.length;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    out.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    out.computeBoundingSphere();
    return out;
  }

  /* dressCabin(root, o) -> cabinInfo (also written to root.userData.cabinInfo)
       o.cabW    cabin base width (the glass tub's base width)
       o.zR/zF   cabin base rear/front z
       o.zTR/zTF roof rear/front z (optional; defaults to a 20% rake each end)
       o.roofW   roof width (optional)
       o.beltY   beltline: where the glass starts
       o.roofY   headliner height
       o.floorY  cabin floor pan top
       o.rows    1 / 2 / 3 seat rows (optional; a HINT for an unnamed layout)
       o.seatLayout  (optional) a city/carseats.js kind: coupe2 coupe4 sedan5
                 suv6 suv7 pickup6 van3 van6 cab2. Absent: the style's kind
                 (carseats KIND_BY_STYLE), else read off the cabin box.
       o.doorSpans [[z0,z1],...] the real doors (buildCarDoors) — no card there */
  function dressCabin(root, o) {
    const SEATS = CBZ.carSeats;
    if (!SEATS) return null;
    const kind = o.seatLayout || (SEATS.KIND_BY_STYLE[_cabinStyle] || null);
    const Lay = SEATS.layout({
      cabW: o.cabW, zR: o.zR, zF: o.zF, zTR: o.zTR, zTF: o.zTF, roofW: o.roofW,
      beltY: o.beltY, roofY: o.roofY, floorY: o.floorY, rows: o.rows,
    }, kind);
    const D = Lay.drive;
    const theme = THEMES[Lay.kind] || THEMES.sedan5;
    const A = cabinAcc();
    const cabW = D.cabW, halfW = D.halfW, zR = D.zR, zF = D.zF, cl = D.cl, cz = D.cz;
    const beltY = D.beltY, roofY = D.roofY, gh = D.gh, zTR = D.zTR, zTF = D.zTF;
    const roofW = D.roofW, floorY = D.floorY, wallH = D.wallH;
    const dashTopY = D.dashTopY, dashZ = D.dashZ, dashD = D.dashD, fz = D.dashFaceZ;
    const wheelX = D.wheelX, wheelY = D.wheelY, wheelZ = D.wheelZ, wheelR = D.wheelR;
    const cushionY = D.cushionY;
    const seats = Lay.seats, driver = seats[0];
    const front = seats.filter((s) => s.row === 0);
    const benchFront = front.length === 3;
    const lastZ = seats[seats.length - 1].z;
    const bpZ = (zTR + zTF) * 0.5;
    const RAKE = 0.42;

    // ---- THE BOX. Sealed on five sides; the sixth is the glass. -----------
    // THE SKIN RULE: the loft glass leans inboard and the windscreen curves,
    // so every piece stays inside |x| <= cabW/2 - 0.05 below the belt and
    // roofW/2 - 0.04 at the roof, or it pokes out through the body.
    A.box(cabW - 0.10, 0.06, cl, 0, floorY - 0.03, cz, TONE.carpet);                       // floor pan
    seats.forEach(function (s) {                                                        // a mat in every footwell
      const z1 = s.row === 0 ? zF - 0.10 : s.z + 0.62, z0 = s.z + 0.12;
      if (z1 - z0 > 0.12) A.rbox(Math.min(0.46, s.w * 0.9), 0.014, z1 - z0, 0.006, s.x, floorY + 0.008, (z0 + z1) * 0.5, TONE.carpet.map((v) => v * 0.8));
    });
    const spans = o.doorSpans && o.doorSpans.length ? o.doorSpans.slice().sort((a, b) => a[0] - b[0]) : null;
    [1, -1].forEach(function (s) {
      const segs = [];
      if (!spans) segs.push([zR + cl * 0.02, zF - cl * 0.02]);
      else {
        let z = zR + 0.02;
        for (let i = 0; i < spans.length; i++) {
          if (spans[i][0] - z > 0.04) segs.push([z, spans[i][0]]);
          z = Math.max(z, spans[i][1]);
        }
        if (zF - 0.02 - z > 0.04) segs.push([z, zF - 0.02]);
      }
      segs.forEach(function (sg) {
        const len = sg[1] - sg[0], zc = (sg[0] + sg[1]) * 0.5, xw = s * (halfW - 0.08);
        A.box(0.06, wallH, len, xw, floorY + wallH * 0.5, zc, TONE.struct);             // card
        if (len < 0.35) return;
        A.rbox(0.06, 0.06, len * 0.9, 0.02, xw - s * 0.05, beltY - 0.06, zc, TONE.trim);  // belt ledge
        A.rbox(0.06, 0.07, Math.min(0.42, len * 0.5), 0.025, xw - s * 0.06, beltY - 0.22, zc, TONE.leather);  // armrest
        A.rbox(0.04, 0.03, 0.12, 0.012, xw - s * 0.04, beltY - 0.13, zc + len * 0.22, TONE.chrome);        // handle
        // the speaker: a grille disc low on the card
        A.ring(0.07, 0.012, mtx(xw - s * 0.035, floorY + 0.16, zc - len * 0.18, 0, s * Math.PI / 2, 0), TONE.trim);
        A.put(new THREE.CircleGeometry(0.066, 14), TONE.grille, mtx(xw - s * 0.034, floorY + 0.16, zc - len * 0.18, 0, -s * Math.PI / 2, 0));
      });
    });
    const fwH = Math.max(0.12, dashTopY - 0.05 - floorY);
    A.box(cabW - 0.12, fwH, 0.07, 0, floorY + fwH * 0.5, zF - 0.05, TONE.struct);          // firewall
    A.box(cabW - 0.12, wallH, 0.07, 0, floorY + wallH * 0.5, zR + 0.05, TONE.struct);      // rear bulkhead
    // headliner: PALE — the biggest surface a camera above the belt sees, and a
    // dark one turns the cabin into a hole
    A.rbox(Math.max(0.4, roofW - 0.10), 0.035, Math.max(0.30, (zTF - zTR) * 0.98), 0.012, 0, roofY - 0.028, (zTR + zTF) * 0.5, TONE.head);

    // ---- PILLARS, handles, the sill -------------------------------------
    [1, -1].forEach(function (s) {
      const xIn = s * (halfW - 0.11), xTop = s * (roofW * 0.5 - 0.075);
      // no A-pillar trim: pulled inboard of the curved loft windscreen it read,
      // from both front seats, as a second pale pillar floating in the glass a
      // hand's width from the body's own (measured in the car-showcase FP plates)
      A.bar([xIn, beltY - 0.02, zR + 0.05], [xTop, roofY - 0.065, zTR + 0.01], 0.07, 0.04, TONE.head);   // C-pillar
      A.box(0.045, gh - 0.06, 0.10, s * ((halfW - 0.09) + (roofW * 0.5 - 0.07)) * 0.5, beltY + gh * 0.5 - 0.03, bpZ, TONE.head, 0, 0, s * Math.atan2((halfW - 0.09) - (roofW * 0.5 - 0.07), gh));   // B-pillar
      // grab handles over every passenger door
      seats.forEach(function (st) {
        if (st.side !== s || st.isDriver) return;
        A.rbox(0.03, 0.028, 0.18, 0.01, s * (roofW * 0.5 - 0.08), roofY - 0.07, st.z + 0.05, TONE.struct);
      });
      A.box(0.065, 0.012, Math.min(1.3, cl * 0.7), s * (halfW - 0.09), floorY + 0.008, cz + 0.05, TONE.trim);   // sill scuff
    });

    // ---- SEATS: the model's seats, upholstered --------------------------
    const RECL = -0.2;
    function backHeight(s) {
      const want = Math.max(0.30, Math.min(0.72, beltY + gh * 0.06 - s.cushionY)) * (s.row === 0 ? 1 : 0.9);
      // headrest crown must clear the roof over this row
      const room = (s.roofY - 0.05) - s.cushionY - 0.23;
      return Math.max(0.24, Math.min(want, room / Math.cos(RECL)));
    }
    function bucket(s) {
      const w = s.w, x = s.x, z = s.z, cy = s.cushionY, bh = backHeight(s);
      // rails + pedestal
      const baseH = Math.max(0.04, cy - 0.10 - floorY);
      A.box(w * 0.7, baseH, 0.40, x, floorY + baseH * 0.5, z, TONE.struct);
      // cushion: a crowned insert between two raised bolsters, a front roll
      A.rbox(w * 0.66, 0.1, 0.44, 0.03, x, cy - 0.05, z + 0.01, theme.insert, 0, 0, 0, 0.018);
      [1, -1].forEach(function (b) {
        A.rbox(w * 0.19, 0.14, 0.47, 0.045, x + b * w * 0.40, cy - 0.035, z, theme.seat);
      });
      A.rbox(w * 0.9, 0.09, 0.09, 0.04, x, cy - 0.07, z + 0.215, theme.seat);
      // backrest in its own reclined frame
      const bf = mtx(x, cy, z - 0.22, RECL, 0, 0);
      const at = (lx, ly, lz, rx, ry, rz) => bf.clone().multiply(mtx(lx, ly, lz, rx, ry, rz));
      A.put(rboxGeo(w * 0.64, bh * 0.94, 0.1, 0.03, 0.012), theme.insert, at(0, bh * 0.49, 0));
      [1, -1].forEach(function (b) {
        A.put(rboxGeo(w * 0.2, bh * 0.92, 0.17, 0.05), theme.seat, at(b * w * 0.40, bh * 0.47, 0.035, 0, -b * 0.28, 0));
      });
      A.put(rboxGeo(w * 0.78, 0.08, 0.13, 0.035), theme.seat, at(0, bh - 0.02, -0.005));      // shoulder roll
      A.put(rboxGeo(w * 0.52, 0.17, 0.11, 0.045, 0.01), theme.seat, at(0, bh + 0.14, -0.01)); // headrest
      [-0.07, 0.07].forEach(function (px) { A.put(boxGeo(0.014, 0.08, 0.014), TONE.chrome, at(px, bh + 0.03, 0)); });
      A.put(rboxGeo(w * 0.7, bh * 0.9, 0.03, 0.012), TONE.struct, at(0, bh * 0.47, -0.065));  // the seat's back shell
    }
    function bench(row) {
      const rs = seats.filter((s) => s.row === row);
      const s0 = rs[0], cy = s0.cushionY, z = s0.z, bh = Math.min.apply(null, rs.map(backHeight));
      const x0 = Math.max.apply(null, rs.map((s) => s.x + s.w * 0.5)), x1 = Math.min.apply(null, rs.map((s) => s.x - s.w * 0.5));
      const W = x0 - x1, xc = (x0 + x1) * 0.5;
      const baseH = Math.max(0.04, cy - 0.10 - floorY);
      A.box(W * 0.9, baseH, 0.40, xc, floorY + baseH * 0.5, z, TONE.struct);
      A.rbox(W, 0.12, 0.48, 0.04, xc, cy - 0.06, z, theme.seat, 0, 0, 0, 0.012);
      A.rbox(W * 0.98, 0.09, 0.09, 0.04, xc, cy - 0.075, z + 0.225, theme.seat);
      const bf = mtx(xc, cy, z - 0.22, RECL * 0.8, 0, 0);
      const at = (lx, ly, lz) => bf.clone().multiply(mtx(lx, ly, lz));
      A.put(rboxGeo(W, bh, 0.12, 0.04, 0.01), theme.seat, at(0, bh * 0.5, 0));
      rs.forEach(function (s) {
        // each place: an insert panel, a headrest, the seam between places
        A.rbox(s.w * 0.62, 0.012, 0.36, 0.005, s.x, cy + 0.003, z + 0.01, theme.insert);
        A.put(rboxGeo(s.w * 0.6, bh * 0.8, 0.02, 0.008), theme.insert, at(s.x - xc, bh * 0.5, 0.062));
        A.put(rboxGeo(Math.min(0.28, s.w * 0.5), 0.15, 0.1, 0.04, 0.008), theme.seat, at(s.x - xc, bh + 0.12, -0.01));
        [-0.06, 0.06].forEach(function (px) { A.put(boxGeo(0.013, 0.07, 0.013), TONE.chrome, at(s.x - xc + px, bh + 0.025, 0)); });
      });
      // a fold-down centre armrest in the middle place's back
      if (rs.length === 3) A.put(rboxGeo(0.2, 0.07, 0.3, 0.03), theme.seat, at(0, 0.24, 0.12));
    }
    const rowsDone = {};
    seats.forEach(function (s) {
      if (s.bench) { if (!rowsDone[s.row]) { rowsDone[s.row] = true; bench(s.row); } }
      else bucket(s);
      // THE BELT: pillar loop over the outboard shoulder, across the chest to
      // the inboard buckle, and the lap strap. The one object that crosses a
      // first-person frame at the shoulder.
      if (s.side) {
        const sg = s.side;
        const inX = s.x - sg * s.w * 0.5;
        const loopX = Math.min(Math.abs(s.x) + s.w * 0.42, (halfW + roofW * 0.5) * 0.5 - 0.10);
        const loop = [sg * loopX, Math.min(s.roofY - 0.10, beltY + 0.26), s.z - 0.30];
        A.bar(loop, [inX + sg * 0.02, s.cushionY + 0.115, s.z - 0.06], 0.048, 0.006, TONE.belt);
        A.bar([s.x + sg * s.w * 0.46, s.cushionY + 0.07, s.z - 0.02], [inX, s.cushionY + 0.10, s.z - 0.08], 0.048, 0.006, TONE.belt);
        A.box(0.03, 0.06, 0.03, loop[0], loop[1], loop[2], TONE.trim);
        A.box(0.034, 0.05, 0.034, inX, s.cushionY + 0.07, s.z - 0.10, TONE.struct, 0, 0, -sg * 0.14);   // buckle
      }
    });
    // behind the last row: a parcel shelf (a saloon) or a cargo floor + cover
    const shelfD = (lastZ - 0.30) - (zR + 0.09);
    if (shelfD > 0.12) {
      A.box(cabW * 0.86, 0.05, shelfD, 0, beltY - 0.06, (lastZ - 0.30 + zR + 0.09) * 0.5, TONE.struct);
    }

    // ---- DASH: a deep slab to the glass, a sloped padded top, a rolled
    //      leading edge, a knee wall, and a HOOD over the cluster ----------
    const dW = cabW - 0.12;
    A.box(dW, 0.15, dashD, 0, dashTopY - 0.075, dashZ, TONE.struct);
    A.rbox(dW, 0.04, dashD * 0.96, 0.015, 0, dashTopY - 0.008, dashZ + 0.01, TONE.struct, 0.1);     // top pad, falling to the glass
    A.put(new THREE.CylinderGeometry(0.05, 0.05, dW - 0.02, 10), TONE.struct, mtx(0, dashTopY - 0.035, fz + 0.03, 0, 0, Math.PI / 2));   // the roll
    const kneeH = Math.max(0.10, dashTopY - 0.15 - (floorY + 0.28));
    A.rbox(dW, kneeH, 0.12, 0.03, 0, (dashTopY - 0.15 + floorY + 0.28) * 0.5, fz + 0.12, TONE.struct);
    A.box(dW, 0.022, 0.02, 0, dashTopY - 0.085, fz - 0.004, TONE.trim);                         // satin accent strip
    // the cluster: a bezel, the atlas face, and a hood that shades it
    const clW = Math.min(0.32, cabW * 0.19), clH = clW * 0.32;
    const clY = dashTopY - clH * 0.1, clZ = fz - 0.04;
    A.rbox(clW + 0.04, clH + 0.04, 0.06, 0.018, wheelX, clY, clZ + 0.02, TONE.struct);
    const hood = new THREE.CylinderGeometry(1, 1, 0.17, 14, 1, true, Math.PI / 2, Math.PI);
    hood.rotateX(Math.PI / 2);
    hood.scale((clW + 0.06) * 0.5, clH * 0.75, 1);
    A.put(hood, TONE.struct, mtx(wheelX, clY + 0.005, clZ - 0.03));
    // outer round vents at the dash corners, two slot vents over the screen
    [1, -1].forEach(function (s) {
      const vx = s * cabW * 0.40, m = mtx(vx, dashTopY - 0.055, fz - 0.004, 0, Math.PI, 0);
      A.ring(0.042, 0.009, m, TONE.trim);
      A.put(new THREE.CircleGeometry(0.036, 12), TONE.grille, mtx(vx, dashTopY - 0.055, fz - 0.002, 0, Math.PI, 0));
      A.box(0.06, 0.004, 0.012, vx, dashTopY - 0.055, fz - 0.012, TONE.trim);
      A.rbox(0.12, 0.034, 0.02, 0.008, s * 0.075, dashTopY - 0.035, fz - 0.006, TONE.trim);
      A.box(0.1, 0.02, 0.022, s * 0.075, dashTopY - 0.035, fz - 0.008, TONE.grille);
      // tweeter at the A-pillar foot
      A.ring(0.022, 0.006, mtx(s * (halfW - 0.1), dashTopY + 0.004, zF - 0.10, -Math.PI / 2, 0, 0), TONE.trim);
    });
    // glovebox on the side away from the wheel
    const gx = -Math.sign(wheelX || 1) * Math.min(0.42, cabW * 0.24);
    A.box(0.38, 0.012, 0.015, gx, dashTopY - 0.12, fz - 0.004, TONE.grille);
    A.box(0.06, 0.018, 0.022, gx - Math.sign(gx) * 0.12, dashTopY - 0.105, fz - 0.012, TONE.trim);
    // ---- CENTRE STACK: screen housing, climate row, down to the console --
    const scW = Math.min(0.28, cabW * 0.16), scH = scW * 0.6;
    const scY = dashTopY - 0.075 - scH * 0.1, scZ = fz - 0.018;
    // housing and glass share ONE frame, so the tilted glass can never dip into its bezel
    const scF = mtx(0, scY, scZ, -0.12, -0.15 * Math.sign(wheelX || 1), 0);
    A.put(rboxGeo(scW + 0.03, scH + 0.03, 0.035, 0.01), TONE.struct, scF.clone().multiply(mtx(0, 0, 0.012)));
    const stackTop = dashTopY - 0.15, stackBot = benchFront ? floorY + 0.18 : cushionY + 0.02;
    if (stackTop - stackBot > 0.08) {
      A.rbox(0.30, stackTop - stackBot, 0.14, 0.03, 0, (stackTop + stackBot) * 0.5, fz + 0.03, TONE.struct);
      [-0.08, 0, 0.08].forEach(function (kx, i) {
        const ky = stackTop - 0.05;
        if (i === 1) A.box(0.032, 0.025, 0.012, 0, ky, fz - 0.045, [1.8, 0.5, 0.45]);   // hazard
        else A.ring(0.018, 0.007, mtx(kx, ky, fz - 0.045, 0, Math.PI, 0), TONE.trim);
      });
    }
    if (!benchFront) {
      // ---- CONSOLE between two buckets: tunnel, shifter, cups, armrest --
      const cz0 = fz + 0.02, cz1 = driver.z - 0.28;
      const conW = Math.max(0.16, Math.min(0.24, Math.abs(front[0].x - front[front.length - 1].x) - front[0].w - 0.02));
      const conTop = cushionY + 0.07;
      A.rbox(conW, conTop - floorY, cz0 - cz1, 0.02, 0, (conTop + floorY) * 0.5, (cz0 + cz1) * 0.5, TONE.struct);
      const shZ = driver.z + 0.14;
      A.rbox(conW * 0.8, 0.012, 0.16, 0.004, 0, conTop + 0.006, shZ, TONE.trim);                 // gate plate
      A.rbox(0.07, 0.05, 0.08, 0.025, 0, conTop + 0.03, shZ, TONE.leather);                      // boot
      A.box(0.018, 0.07, 0.018, 0, conTop + 0.08, shZ, TONE.chrome, -0.15);                       // lever
      A.rbox(0.05, 0.05, 0.06, 0.02, 0, conTop + 0.12, shZ - 0.01, TONE.leather, 0, 0, 0, 0.01);  // knob
      [-0.035, 0.035].forEach(function (dz) {
        A.ring(0.034, 0.006, mtx(0, conTop + 0.004, driver.z + dz - 0.02, -Math.PI / 2, 0, 0), TONE.trim);
        A.put(new THREE.CircleGeometry(0.03, 12), TONE.grille, mtx(0, conTop + 0.002, driver.z + dz - 0.02, -Math.PI / 2, 0, 0));
      });
      A.rbox(conW * 0.95, 0.05, 0.30, 0.022, 0, conTop + 0.03, driver.z - 0.16, theme.seat, 0, 0, 0, 0.01);   // armrest lid
    } else {
      // a bench cab shifts on the column
      A.bar([wheelX - 0.05, wheelY - 0.03, wheelZ + 0.10], [wheelX - 0.20, wheelY - 0.07, wheelZ + 0.02], 0.016, 0.016, TONE.chrome);
      A.rbox(0.03, 0.03, 0.03, 0.012, wheelX - 0.205, wheelY - 0.072, wheelZ + 0.018, TONE.leather);
    }

    // ---- THE COLUMN and its stalks (static); the wheel itself is live ------
    const colF = mtx(wheelX, wheelY, wheelZ, RAKE, 0, 0);
    const col = (lx, ly, lz, rx, ry, rz) => colF.clone().multiply(mtx(lx, ly, lz, rx, ry, rz));
    A.put(rboxGeo(0.08, 0.08, 0.30, 0.03), TONE.struct, col(0, 0, 0.19));
    A.put(rboxGeo(0.13, 0.09, 0.08, 0.035), TONE.struct, col(0, -0.005, 0.07));          // shroud
    [1, -1].forEach(function (s) {
      A.put(boxGeo(0.11, 0.016, 0.016), TONE.struct, col(s * 0.10, -0.01, 0.07, 0, 0, s * 0.2));
      A.put(rboxGeo(0.026, 0.022, 0.022, 0.008), TONE.trim, col(s * 0.155, 0.0, 0.07));
    });

    // ---- PEDALS in the driver's well -----------------------------------
    A.box(0.07, 0.08, 0.02, wheelX - 0.05, floorY + 0.11, zF - 0.09, TONE.pedal, 0.22);          // brake
    A.box(0.018, 0.10, 0.03, wheelX - 0.05, floorY + 0.17, zF - 0.07, TONE.struct, 0.22);
    A.box(0.045, 0.12, 0.018, wheelX + 0.07, floorY + 0.095, zF - 0.09, TONE.pedal, 0.22);       // throttle
    A.box(0.016, 0.10, 0.03, wheelX + 0.07, floorY + 0.16, zF - 0.07, TONE.struct, 0.22);
    A.box(0.06, 0.14, 0.02, wheelX + 0.17, floorY + 0.09, zF - 0.11, TONE.struct, 0.25);         // dead pedal

    // ---- HEADER: mirror, visors, dome ------------------------------------
    A.rbox(0.26, 0.075, 0.045, 0.02, 0, roofY - 0.10, zTF - 0.02, TONE.struct);                  // mirror housing
    A.box(0.24, 0.062, 0.008, 0, roofY - 0.10, zTF - 0.045, TONE.mirror);                         // its glass
    A.box(0.03, 0.06, 0.05, 0, roofY - 0.06, zTF + 0.01, TONE.struct);                            // mount stem
    [1, -1].forEach(function (s) {
      A.rbox(roofW * 0.34, 0.025, 0.17, 0.01, s * roofW * 0.24, roofY - 0.062, zTF - 0.05, TONE.head, -0.10);   // stowed visor
      A.box(0.012, 0.02, 0.05, s * roofW * 0.07, roofY - 0.058, zTF - 0.05, TONE.trim);          // its clip
    });
    A.rbox(0.18, 0.022, 0.13, 0.008, 0, roofY - 0.038, zTF - 0.16, TONE.struct);                 // dome console
    [-0.05, 0.05].forEach(function (lx) { A.box(0.038, 0.006, 0.045, lx, roofY - 0.05, zTF - 0.16, TONE.lamp); });
    if (Lay.rows > 1) A.box(0.12, 0.006, 0.08, 0, roofY - 0.035, Lay.seats[Lay.seats.length - 1].z + 0.1, TONE.lamp);   // rear dome lamp

    // ---- BAKE: the room is one mesh ----------------------------------------
    const roomGeo = bakeAcc(A, { floorY: floorY, roofY: roofY, dashTopY: dashTopY, dashFaceZ: fz, cushionY: cushionY, zF: zF, halfW: halfW });
    const room = new THREE.Mesh(roomGeo, cabinMat());
    room.name = "cabin_room";
    room.castShadow = false;
    room.userData.noSeal = true;
    root.add(room);

    // ---- THE LIT GLASS: cluster face + centre screen, one mesh ---------------
    const glassGeo = quadsGeo([
      atlasQuad(clW, clH, ATLAS.cl, mtx(wheelX, clY, clZ - 0.012)),
      atlasQuad(scW, scH, ATLAS.sc, scF.clone().multiply(mtx(0, 0, -0.008))),
    ]);
    glassGeo._shared = true;
    const glassM = new THREE.Mesh(glassGeo, screenMat());
    glassM.name = "cabin_screens";
    glassM.castShadow = false;
    glassM.userData.noSeal = true;
    glassM.userData.carScreen = 0.03;
    root.add(glassM);

    // ---- THE WHEEL: a live group so it can turn ----------------------------
    const W = cabinAcc();
    W.ring(wheelR, 0.024, null, TONE.leather);                                                // the rim
    W.rbox(0.12, 0.10, 0.06, 0.03, 0, 0, 0.012, TONE.struct);                                 // hub
    W.rbox(0.09, 0.07, 0.02, 0.012, 0, 0, -0.025, TONE.leather);                              // horn pad
    [1, -1].forEach(function (s) {
      W.rbox(wheelR * 0.86, 0.034, 0.022, 0.01, s * wheelR * 0.5, -0.01, 0.004, TONE.struct); // 3 and 9 o'clock spokes
      W.rbox(0.03, 0.03, 0.012, 0.008, s * wheelR * 0.42, -0.005, -0.012, TONE.trim);        // spoke buttons
    });
    W.rbox(0.035, wheelR * 0.8, 0.02, 0.01, 0, -wheelR * 0.52, 0.006, TONE.struct);          // 6 o'clock spoke
    const wheelGeo2 = bakeAcc(W, { floorY: -0.6, roofY: 0.6, dashTopY: 10, dashFaceZ: 10, cushionY: -10, zF: 10, halfW: 10 });
    const steer = new THREE.Group();
    steer.name = "cabin_steer";
    steer.position.set(wheelX, wheelY, wheelZ);
    steer.rotation.x = RAKE;
    const spin = new THREE.Group();
    spin.name = "cabin_steer_spin";
    steer.add(spin);
    const wheelMesh = new THREE.Mesh(wheelGeo2, cabinMat());
    wheelMesh.castShadow = false;
    wheelMesh.userData.noSeal = true;
    spin.add(wheelMesh);
    root.add(steer);

    // ---- WHAT THE REST OF THE GAME READS -----------------------------------
    const dialsOut = ATLAS.dials.map(function (d) {
      // atlas u runs to the driver's RIGHT (-X): the left dial sits at +X
      return {
        kind: d.kind, max: d.max, a0: ATLAS.a0, a1: ATLAS.a1,
        x: wheelX + clW * 0.5 - (d.cx / ATLAS.W) * clW,
        y: clY + clH * 0.5 - (d.cy / ATLAS.cl[3]) * clH,
        z: clZ - 0.016, r: (d.r / ATLAS.W) * clW,
      };
    });
    const rear = seats.find((s) => s.row === 1);
    const info = {
      // legacy four (occupancy has read these for ages)
      baseY: beltY, peakY: gh, cx: cz, w: cabW,
      floorY: floorY, roofY: roofY, beltY: beltY,
      zRear: zR, zFront: zF, rows: Lay.rows, kind: Lay.kind,
      zRoofRear: zTR,
      cushionY: cushionY, seatX: D.seatX, seatZ: D.seatZ, rearSeatZ: rear ? rear.z : null,
      wheel: { x: wheelX, y: wheelY, z: wheelZ, r: wheelR, rake: RAKE },
      steerName: "cabin_steer",
      cluster: { dials: dialsOut },
      dashFaceZ: fz, dashTopY: dashTopY,
      eye: { x: driver.eye.x, y: driver.eye.y, z: driver.eye.z },
      doorX: halfW, windowTopY: roofY - 0.05,
      // THE SEAT MODEL (city/carseats.js), plain JSON so a template clone carries it
      seatLayout: { kind: Lay.kind, rows: Lay.rows, seats: seats, doors: Lay.doors },
      dressed: true,
    };
    root.userData.cabinInfo = info;
    return info;
  }

  /* LIVE PARTS for the car the player sits in (city/vehicles.js hangs these
     on the cabin while he is in it and takes them off when he leaves):
       needles  two thin lit bars, pivoting on the cluster dials
       hands    systems/fphands.js's hands closed on the rim, parented to the
                wheel's spin group so they turn with it; the ARMS are not —
                they hang off the steer group and are solved every tick from
                the driver's shoulders (the arms of the rig are at the lens in
                first person and have to be hidden, see seatDriver)
     Materials are the rig's OWN (skin, sleeve) passed in, never cloned. */
  // the builder itself, for a body built outside this file and for node checks
  CBZ.carDressCabin = function (root, o, style) {
    const was = _cabinStyle;
    if (style) _cabinStyle = style;
    try { return dressCabin(root, o); } finally { _cabinStyle = was; }
  };
  const needleMat = () => sharedMat("cabin-needle", 0x330c0c, { emissive: 0xff5a3a, ei: 1.0 });
  CBZ.carCabinNeedles = function (ci) {
    if (!ci || !ci.cluster || !ci.cluster.dials) return null;
    const g = new THREE.Group();
    g.name = "cabin_needles";
    ci.cluster.dials.forEach(function (d) {
      const piv = new THREE.Group();
      piv.position.set(d.x, d.y, d.z);
      const len = d.r * 0.86;
      const geo = new THREE.BoxGeometry(len, Math.max(0.002, d.r * 0.07), 0.003);
      geo.translate(len * 0.5, 0, 0);
      const m = new THREE.Mesh(geo, needleMat());
      m.castShadow = false;
      piv.add(m);
      piv.userData.dial = { kind: d.kind, max: d.max, a0: d.a0, a1: d.a1 };
      g.add(piv);
    });
    return g;
  };
  /* THE DRIVER'S HANDS. They used to be a rounded box on the rim with a
     forearm box parented to the SPINNING wheel group, so the whole arm turned
     with the rim like a clock hand — at full lock the right elbow stood up in
     the windscreen. Now: fphands' real hands closed round the rim (they DO
     turn with it), and two arms that do NOT — each is solved every tick from
     the driver's shoulder to the wrist with the elbow down and out on its own
     side, so the forearms follow the hands round the wheel and never cross.
     Returns the hands group (goes on the spin group); `userData.arms` goes on
     the steer group; `userData.tick(spin, shoulders)` poses the arms. */
  const WHEEL_POSE = { wrap: 0.021, thumb: [[-0.34, -0.66, -0.67], [-0.12, -0.96, -0.24], [0.18, -0.62, -0.76]], cup: 0.005, name: "rim" };
  CBZ.carCabinHands = function (skin, sleeve, rimR, upper) {
    const FPH = CBZ.fpHands;
    const g = new THREE.Group();
    g.name = "cabin_hands";
    const arms = new THREE.Group();
    arms.name = "cabin_arms";
    g.userData.arms = arms;
    if (!FPH) return g;
    const R = rimR || 0.18, K = 1.08, TH = 0.22;
    const fore = sleeve || skin, up = upper || fore;
    const rig = [];
    [-1, 1].forEach(function (x) {
      // x = car-local side; the driver's RIGHT is -X, so the right hand is on -X
      const side = x < 0 ? 1 : -1;
      const c = Math.cos(TH), s = Math.sin(TH);
      const radial = new THREE.Vector3(x * c, s, 0);
      const tangentUp = new THREE.Vector3(-x * s, c, 0);
      // back of the hand OUTWARD and a touch forward: the fingers then run forward
      // over the rim from the outside and the wrist sits behind it, toward the driver
      const dorsal = radial.clone().add(new THREE.Vector3(0, 0.05, 0.2));
      const hand = FPH.attachGrip(g, {
        side: side, pose: WHEEL_POSE, scale: K,
        center: new THREE.Vector3(x * R * c, R * s, 0), axis: tangentUp, dorsal: dorsal,
      }, skin);
      hand.castShadow = false;
      const arm = FPH.makeArm({ fore: fore, upper: up });
      arms.add(arm);
      rig.push({ x: x, side: side, hand: hand, arm: arm });
    });
    const sleeved = !!(fore && skin && fore.color && skin.color && !fore.color.equals(skin.color));
    const W = new THREE.Vector3(), E = new THREE.Vector3(), Q = new THREE.Quaternion();
    const Sa = [0, 0, 0], Wa = [0, 0, 0], pole = [0, -1, -0.3];
    g.userData.tick = function (spin, shoulders) {
      for (let i = 0; i < rig.length; i++) {
        const r = rig[i], S = shoulders[r.x < 0 ? 0 : 1];
        W.copy(r.hand.position).applyQuaternion(spin.quaternion);
        Q.copy(spin.quaternion).multiply(r.hand.quaternion);
        Sa[0] = S.x; Sa[1] = S.y; Sa[2] = S.z; Wa[0] = W.x; Wa[1] = W.y; Wa[2] = W.z;
        pole[0] = r.x * 0.8;
        const e = FPH.math.solveElbow(Sa, Wa, pole, 0.29, 0.27);
        E.set(e[0], e[1], e[2]);
        FPH.poseArm(r.arm, W, E, S, Q, K, sleeved);
      }
    };
    return g;
  };

  /* shadeCabin — the light a cabin has, baked into its vertices.
     This is a LAMBERT world with no bounce and no occlusion budget, and a
     cabin is a roofed room: the sun cannot reach any surface in it, so every
     one of them renders at the ambient floor plus the flat emissive lift the
     cabin material carries. A real interior is read by GRADIENTS: the
     headliner is bright, the footwell is black, an upward face catches the
     sky through the glass, a downward face is in its own shadow, and the well
     under the dash is a cave. Each vertex gets that shade from its height,
     its normal and where it sits, times its piece's TONE (value and hue). */
  const _sv = new THREE.Vector3(), _sn = new THREE.Vector3();
  function shadeCabin(pieces, f) {
    const span = Math.max(0.3, f.roofY - f.floorY);
    for (let p = 0; p < pieces.length; p++) {
      const geo = pieces[p].geo, tone = pieces[p].tone;
      const pos = geo.attributes.position, nor = geo.attributes.normal;
      const n = pos.count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        _sv.fromBufferAttribute(pos, i);
        _sn.fromBufferAttribute(nor, i);
        const t = Math.max(0, Math.min(1, (_sv.y - f.floorY) / span));
        let s = 0.42 + 0.80 * t;                                   // floor dark, headliner bright
        if (_sn.y > 0) s += 0.22 * _sn.y;                          // catches the sky
        else s -= 0.28 * -_sn.y;                                   // its own shadow underneath
        s += 0.10 * Math.abs(_sn.x);                               // side glass light
        if (_sv.z > f.dashFaceZ + 0.02 && _sv.y < f.dashTopY - 0.08) s *= 0.68;   // the cave under the dash
        if (_sv.y < f.cushionY - 0.03) s *= 0.72;                                  // the well under a seat
        if (Math.abs(_sv.x) > f.halfW - 0.12 && _sv.y < f.floorY + 0.10) s *= 0.75;
        s = Math.max(0.22, Math.min(1.35, s));
        col[i * 3] = s * tone[0]; col[i * 3 + 1] = s * tone[1]; col[i * 3 + 2] = s * tone[2];
      }
      geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    }
  }

  /* ============================================================
     ROAD BODIES — one lofted-shell generator, one spec row per class.

     OWNER: "completely improving car ... it's going to look freaking car."
     The old road car was a flat-sided extruded prism + a trapezoid glass
     tub + ~30 slabs (hood clamshell, roof cap, pillar bars, rocker strips,
     splitter, brows), flat-shaded, with the wheels parked beside the flanks.
     It is gone. Every road body — sedan, hatch, crossover, SUV, pickup,
     sports/super, muscle, lowrider and the van's cab — is ONE sectional
     loft from city/carbody.js (curved hood, crowned roof, tumblehome, raked
     glass that IS the shell, round arches the tyres sit in) and the numbers
     below are the only thing that differs between classes.

     Row fields (metres; car frame +z = nose):
       L W        length, body width at the fenders
       FO WB      front overhang (bumper to front axle), wheelbase
       R WW gap   tyre radius, tyre width, arch clearance
       yB         rocker bottom (ride), nL/tL overhang lift of the valance
       cowl rf rr deck   windshield base / roof front / roof rear / deck
                  line, as z measured from the FRONT AXLE (negative = aft)
       yN yC yD yT      hood leading edge / cowl / deck line / tail edge heights
       roof       roof centre height (= overall height)
       tum        tumblehome (roof rail x / glass base x)
       rcN rcT    bumper plan corner radius
       bulge tuck fender flare / waist
       doors      1 (coupe) or 2 per side;  bp  B-pillar z from the front axle
       sgR        side-glass rear limit (z from front axle; paint behind)
       dp         extra black pillar strips (D-pillars), z from front axle
       rows       seat rows handed to the cabin (3 = six seats)
       roll hoodBow   nose roll-off of the hood edge / hood bow (m)
       fp         fender peak: hood edge rises, centre sinks, over the front wheel
       cl cy      character line: M point proud by cl (m) at cy of the flank height
       shIn shD   shoulder inset / drop (a flatter shelf = a brighter crease)
       bgR        back-glass rear limit (z from front axle): paint behind it —
                  a mid-engine car's sloping engine cover, the wedge truck's sail
       cwD        cowl grille depth (shallow on a low, raked sports hood)
       lid        rear shut line: "boot" | "gate" | "engine"
       ant si fuel    shark-fin antenna / mid-engine side intake / fuel flap (default on)
  ============================================================ */
  const BODY = {
    // -- sedans (the taxi and the police cruiser are liveries on tesla-3) --
    // Model 3: 4.69 L, 2.875 WB, 1.44 H, overhangs 0.84 / 0.97, a short
    // boot lid, the screen base well forward, small fender humps
    "tesla-3":   { L: 4.69, W: 1.85, FO: 0.84, WB: 2.875, R: 0.335, WW: 0.235, gap: 0.04, yB: 0.15, nL: 0.08, tL: 0.10,
                   cowl: -0.44, rf: -1.38, rr: -2.32, deck: -3.10, yN: 0.68, yC: 0.97, yD: 1.02, yT: 0.96, roof: 1.44,
                   tum: 0.80, rcN: 0.30, rcT: 0.26, bulge: 0.02, tuck: 0.012, doors: 2, bp: -1.55, sgR: -2.55, rows: 2,
                   hoodC: 0.04, roofC: 0.05, winF: 0.25, winR: 0.7, eTN: 0.06, eTT: 0.03, roll: 0.05, fp: 0.02,
                   lid: "boot", ant: true },
    "tesla-s":   { L: 4.97, W: 1.96, FO: 0.93, WB: 2.96, R: 0.35, WW: 0.245, gap: 0.04, yB: 0.15, nL: 0.08, tL: 0.10,
                   cowl: -0.52, rf: -1.46, rr: -2.35, deck: -3.40, yN: 0.66, yC: 0.97, yD: 1.02, yT: 0.96, roof: 1.44,
                   tum: 0.79, rcN: 0.32, rcT: 0.28, bulge: 0.022, tuck: 0.012, doors: 2, bp: -1.60, sgR: -2.62, rows: 2,
                   hoodC: 0.04, roofC: 0.05, winF: 0.25, winR: 0.9, eTN: 0.06, eTT: 0.03, roll: 0.05, fp: 0.025,
                   lid: "boot", ant: true },
    // -- compact hatch (Golf: 4.28 L, 2.64 WB, 1.46 H) --
    hatch:       { L: 4.20, W: 1.79, FO: 0.84, WB: 2.62, R: 0.315, WW: 0.215, gap: 0.04, yB: 0.16, nL: 0.08, tL: 0.10,
                   cowl: -0.50, rf: -1.34, rr: -2.66, deck: -3.26, yN: 0.72, yC: 0.99, yD: 1.02, yT: 1.00, roof: 1.47,
                   tum: 0.84, rcN: 0.26, rcT: 0.18, bulge: 0.018, tuck: 0.01, doors: 2, bp: -1.32, sgR: -2.78, rows: 2,
                   hoodC: 0.045, roofC: 0.045, winF: 0.25, winR: 0.2, eTN: 0.05, eTT: 0.02, roll: 0.05, fp: 0.012,
                   lid: "gate", ant: true },
    // -- crossovers / SUVs --
    "tesla-y":   { L: 4.75, W: 1.92, FO: 0.90, WB: 2.89, R: 0.36, WW: 0.255, gap: 0.045, yB: 0.23, nL: 0.08, tL: 0.10,
                   cowl: -0.52, rf: -1.48, rr: -2.62, deck: -3.55, yN: 0.81, yC: 1.07, yD: 1.10, yT: 1.08, roof: 1.62,
                   tum: 0.81, rcN: 0.30, rcT: 0.24, bulge: 0.022, tuck: 0.01, doors: 2, bp: -1.58, sgR: -2.95, rows: 2,
                   hoodC: 0.04, roofC: 0.05, winF: 0.25, winR: 0.8, eTN: 0.05, eTT: 0.03, archTrim: true, roll: 0.05, fp: 0.018,
                   lid: "gate", ant: true },
    "tesla-x":   { L: 5.04, W: 2.00, FO: 0.98, WB: 2.97, R: 0.375, WW: 0.265, gap: 0.045, yB: 0.24, nL: 0.08, tL: 0.10,
                   cowl: -0.56, rf: -1.58, rr: -2.95, deck: -3.78, yN: 0.82, yC: 1.09, yD: 1.14, yT: 1.10, roof: 1.68,
                   tum: 0.82, rcN: 0.32, rcT: 0.24, bulge: 0.022, tuck: 0.01, doors: 2, bp: -1.62, sgR: -3.20, rows: 3,
                   hoodC: 0.04, roofC: 0.05, winF: 0.25, winR: 0.7, eTN: 0.05, eTT: 0.03, archTrim: true, roll: 0.05, fp: 0.018,
                   lid: "gate", ant: true },
    // -- full-size SUV (Tahoe 5.35 / Range Rover 5.05 L, WB 3.0-3.07, H 1.87):
    //    a LONG front overhang under a tall, square, nearly flat hood, an
    //    upright screen, the roof carried to a near-vertical tailgate --
    suv:         { L: 5.20, W: 2.04, FO: 1.00, WB: 3.05, R: 0.405, WW: 0.275, gap: 0.06, yB: 0.30, nL: 0.10, tL: 0.10,
                   cowl: -0.60, rf: -1.25, rr: -4.00, deck: -4.10, yN: 1.17, yC: 1.22, yD: 1.20, yT: 1.19, roof: 1.88,
                   tum: 0.89, rcN: 0.14, rcT: 0.12, bulge: 0.03, tuck: 0.008, doors: 2, bp: -1.66, sgR: -4.08, dp: [-2.84], rows: 3,
                   hoodC: 0.025, roofC: 0.03, winF: 0.12, winR: 0.05, eTN: 0.025, eTT: 0.01, archTrim: true, roll: 0.012, hoodBow: 0.004,
                   lid: "gate", ant: true, shIn: 0.045, shD: 0.03 },
    // -- pickup: crew cab + open bed (F-150 SuperCrew 5.5 ft: 5.89 L, 3.68 WB) --
    pickup:      { L: 5.85, W: 2.03, FO: 1.00, WB: 3.66, R: 0.42, WW: 0.28, gap: 0.07, yB: 0.36, nL: 0.08, tL: 0.04,
                   cowl: -0.62, rf: -1.22, rr: -2.56, deck: -2.64, yN: 1.24, yC: 1.29, yD: 1.28, yT: 1.28, roof: 1.93,
                   tum: 0.90, rcN: 0.14, rcT: 0.07, bulge: 0.03, tuck: 0.006, doors: 2, bp: -1.70, sgR: -2.60, rows: 2,
                   hoodC: 0.03, roofC: 0.03, winF: 0.15, winR: 0.0, eTN: 0.03, eTT: 0.0, archTrim: true, seats: "pickup6", roll: 0.015, hoodBow: 0.006,
                   lid: "gate", ant: true, shIn: 0.045, shD: 0.03,
                   bed: { z0: 0.07, z1: -2.70, floor: 0.92 } },
    // -- sports / super: low, wide, one door a side. The MID-ENGINE cars are
    //    NOT fastbacks: the glass stops right behind the seats and a high,
    //    near-flat engine cover runs to a ducktail that sits ABOVE the nose
    //    (the wedge). The nose is low and sharp: small plan radius, a strong
    //    plan taper, almost no roll, the hood sunk between two fender ridges.
    // 911 (992): 4.52 L, 2.45 WB, 1.30 H; rear engine, so it IS a fastback
    porsche:     { L: 4.52, W: 1.90, FO: 0.97, WB: 2.45, R: 0.345, WW: 0.27, gap: 0.03, yB: 0.13, nL: 0.05, tL: 0.10,
                   cowl: -0.62, rf: -1.40, rr: -2.02, deck: -3.10, yN: 0.60, yC: 0.83, yD: 0.92, yT: 0.90, roof: 1.30, cwD: 0.05,
                   tum: 0.78, rcN: 0.32, rcT: 0.30, bulge: 0.05, tuck: 0.02, doors: 1, sgR: -2.20, rows: 2,
                   hoodC: 0.03, roofC: 0.055, winF: 0.35, winR: 1.3, eTN: 0.08, eTT: 0.02, roll: 0.05, fp: 0.06, cl: 0.004,
                   lid: "engine" },
    // F8: 4.61 L, 2.65 WB, 1.21 H, 0.69 m wheels, overhangs ~1.03 / 0.93
    ferrari:     { L: 4.61, W: 1.98, FO: 1.03, WB: 2.65, R: 0.35, WW: 0.285, gap: 0.028, yB: 0.12, nL: 0.03, tL: 0.08,
                   cowl: -0.40, rf: -1.30, rr: -1.78, deck: -2.95, yN: 0.50, yC: 0.85, yD: 0.98, yT: 0.93, bgR: -2.15, roof: 1.21,
                   tum: 0.74, rcN: 0.26, rcT: 0.28, bulge: 0.06, tuck: 0.03, doors: 1, sgR: -1.92, rows: 1, deckC: 0.06,
                   hoodC: 0.03, roofC: 0.05, winF: 0.4, winR: 0.9, eTN: 0.12, eTT: 0.06, roll: 0.02, hoodBow: 0.015, cwD: 0.04,
                   fp: 0.06, cl: 0.008, cy: 0.62, lid: "engine", si: true },
    enzo:        { L: 4.70, W: 2.03, FO: 1.05, WB: 2.65, R: 0.35, WW: 0.29, gap: 0.028, yB: 0.12, nL: 0.03, tL: 0.08,
                   cowl: -0.36, rf: -1.28, rr: -1.76, deck: -2.95, yN: 0.48, yC: 0.82, yD: 0.97, yT: 0.92, bgR: -2.12, roof: 1.15, deckC: 0.06, cwD: 0.04,
                   tum: 0.72, rcN: 0.34, rcT: 0.26, bulge: 0.07, tuck: 0.03, doors: 1, sgR: -1.90, rows: 1,
                   hoodC: 0.03, roofC: 0.05, winF: 0.45, winR: 0.9, eTN: 0.13, eTT: 0.02, roll: 0.02, hoodBow: 0.015,
                   fp: 0.07, cl: 0.008, cy: 0.60, lid: "engine", si: true },
    aventador:   { L: 4.78, W: 2.03, FO: 1.10, WB: 2.70, R: 0.355, WW: 0.30, gap: 0.028, yB: 0.11, nL: 0.03, tL: 0.08,
                   cowl: -0.30, rf: -1.40, rr: -1.88, deck: -3.00, yN: 0.49, yC: 0.77, yD: 0.96, yT: 0.93, bgR: -2.25, roof: 1.14, deckC: 0.045, cwD: 0.035,
                   tum: 0.70, rcN: 0.24, rcT: 0.16, bulge: 0.06, tuck: 0.03, doors: 1, sgR: -2.00, rows: 1,
                   hoodC: 0.02, roofC: 0.04, winF: 0.1, winR: 0.2, eTN: 0.13, eTT: 0.03, roll: 0.01, hoodBow: 0.01,
                   fp: 0.04, cl: 0.01, cy: 0.62, lid: "engine", si: true },
    veyron:      { L: 4.46, W: 1.99, FO: 0.98, WB: 2.71, R: 0.35, WW: 0.29, gap: 0.03, yB: 0.12, nL: 0.04, tL: 0.08,
                   cowl: -0.40, rf: -1.30, rr: -1.85, deck: -2.85, yN: 0.58, yC: 0.83, yD: 0.97, yT: 0.92, bgR: -2.15, roof: 1.20, deckC: 0.06, cwD: 0.045,
                   tum: 0.76, rcN: 0.40, rcT: 0.30, bulge: 0.05, tuck: 0.02, doors: 1, sgR: -2.00, rows: 1,
                   hoodC: 0.04, roofC: 0.055, winF: 0.45, winR: 0.8, eTN: 0.06, eTT: 0.03, roll: 0.05,
                   fp: 0.04, cl: 0.006, lid: "engine" },
    // -- muscle: long hood, short deck, blunt nose --
    muscle:      { L: 5.02, W: 1.96, FO: 0.95, WB: 2.95, R: 0.36, WW: 0.275, gap: 0.035, yB: 0.15, nL: 0.06, tL: 0.08,
                   cowl: -0.86, rf: -1.66, rr: -2.52, deck: -3.18, yN: 0.88, yC: 0.99, yD: 1.02, yT: 1.00, roof: 1.40,
                   tum: 0.80, rcN: 0.12, rcT: 0.12, bulge: 0.03, tuck: 0.012, doors: 1, sgR: -2.62, rows: 2,
                   hoodC: 0.03, roofC: 0.04, winF: 0.1, winR: 0.3, eTN: 0.02, eTT: 0.01, cl: 0.009,
                   lid: "boot", ant: true },
    // -- lowrider: a long, low sixties hardtop --
    lowrider:    { L: 5.40, W: 2.00, FO: 1.05, WB: 3.00, R: 0.33, WW: 0.23, gap: 0.05, yB: 0.13, nL: 0.04, tL: 0.06,
                   cowl: -0.80, rf: -1.62, rr: -2.78, deck: -3.26, yN: 0.84, yC: 0.93, yD: 0.95, yT: 0.92, roof: 1.36,
                   tum: 0.84, rcN: 0.12, rcT: 0.12, bulge: 0.01, tuck: 0.004, doors: 1, sgR: -2.86, rows: 2,
                   hoodC: 0.03, roofC: 0.035, winF: 0.1, winR: 0.3, eTN: 0.02, eTT: 0.01, cl: 0.01, cy: 0.78,
                   lid: "boot" },
    // -- the stainless wedge truck: faceted (flat), one straight rake from
    //    the nose over the apex, a long metal sail down to the tail --
    cybertruck:  { L: 5.68, W: 2.03, FO: 1.05, WB: 3.81, R: 0.44, WW: 0.30, gap: 0.09, yB: 0.40, nL: 0.02, tL: 0.02,
                   cowl: -0.30, rf: -1.52, rr: -1.56, deck: -4.62, yN: 1.02, yC: 1.34, yD: 1.32, yT: 1.30, roof: 1.80,
                   tum: 0.78, rcN: 0.05, rcT: 0.03, bulge: 0.0, tuck: 0.0, doors: 2, bp: -1.72, sgR: -2.35, rows: 2,
                   hoodC: 0.12, roofC: 0.0, deckC: 0.06, winF: 0.0, winR: 0.0, eTN: 0.0, eTT: 0.0, archTrim: true,
                   roll: 0, hoodBow: 0.0, flat: true, bgR: -2.05, cl: 0, fuel: false },
  };
  const BODY_COLOR = {
    "tesla-s": 0xd1262f, "tesla-3": 0x67717b, "tesla-x": 0x185bd6, "tesla-y": 0x1470e3,
    porsche: 0xf3cf39, aventador: 0xf28c28, ferrari: 0xd1262f, enzo: 0xe02025, veyron: 0x202225,
    muscle: 0x161922, lowrider: 0x7d2bd6, hatch: 0x2ec4d6, suv: 0x2e3a4a, pickup: 0xe24b4b, cybertruck: 0xa8afb2,
  };
  const PAINT_OPTS_EXTRA = { cybertruck: { metalness: 0.86, roughness: 0.32, envMapIntensity: 1.2 }, suv: { metalness: 0.45, roughness: 0.42, envMapIntensity: 0.9 }, pickup: { metalness: 0.46, roughness: 0.40, envMapIntensity: 0.95 } };

  // the full loft spec for a body row (absolute z), doors laid out on it
  function loftSpec(b) {
    const zF = b.L / 2 - b.FO, zR = zF - b.WB;
    const Ra = b.R + b.gap;
    const W2 = b.W / 2;
    const S = {
      L: b.L, W: b.W, axles: [zF, zR], wheelR: b.R, wheelW: b.WW, archGap: b.gap,
      yB: b.yB, noseLift: b.nL, tailLift: b.tL,
      zCowl: zF + b.cowl, zRoofF: zF + b.rf, zRoofR: zF + b.rr, zDeck: zF + b.deck,
      yNose: b.yN, yCowl: b.yC, yDeck: b.yD, yTail: b.yT, yRoof: b.roof,
      hoodCrown: b.hoodC, roofCrown: b.roofC, deckCrown: b.deckC != null ? b.deckC : 0.035,
      tumble: b.tum, rcNose: b.rcN, rcTail: b.rcT, endTaperN: b.eTN, endTaperT: b.eTT,
      bulge: b.bulge, tuck: b.tuck, winF: b.winF, winR: b.winR,
      sideGlassR: b.sgR != null ? zF + b.sgR : null,
      archTrim: !!b.archTrim, blackPillars: !!b.blackPillars, glassRoof: !!b.glassRoof,
      floorY: b.yB + 0.13, flat: !!b.flat,
      backGlassR: b.bgR != null ? zF + b.bgR : null,
      // feature lines + panel detail (carbody.js addDetails)
      fenderPeak: b.fp || 0, charLine: b.cl, charY: b.cy,
      shoulderIn: b.shIn, shoulderDrop: b.shD, cowlDepth: b.cwD,
      rearLid: b.lid || null, antenna: !!b.ant, fuelFlap: b.fuel !== false, sideIntake: !!b.si,
    };
    // hood bows up between the leading edge and the cowl; the belt kicks
    // up a touch toward the tail (a real car's wedge)
    const zN = b.L / 2;
    S.hoodKeys = [[lerpN(S.zCowl, zN, 0.55), lerpN(b.yC, b.yN, 0.55) + (b.hoodBow != null ? b.hoodBow : 0.035)]];
    // the NOSE ROLL: the hood edge falls away over the last ~0.25 m, so the
    // top of the fascia rakes back into the hood (where the lamps sit)
    // instead of standing as a flat wall under a lip
    const roll = b.roll != null ? b.roll : 0.08;
    if (roll > 0) S.hoodKeys.push([zN - 0.24, b.yN + roll]);
    S.beltKeys = [[lerpN(S.zDeck, S.zCowl, 0.5), lerpN(b.yD, b.yC, 0.5) + 0.005]];
    // tyre outer face 2 cm inside the fender at the axle
    const sh = CBZ.carBody.makeShape(Object.assign({}, S, { trackHalf: 1 }));
    const hwAx = Math.min(sh.planHalf(zF), sh.planHalf(zR)) + (b.bulge || 0) * 1.0;
    S.trackHalf = hwAx - 0.02 - b.WW / 2;
    // doors: clear of the arches, the front one up to the cowl
    const lead = Math.min(S.zCowl + 0.02, zF - Ra - 0.05);
    const trail = zR + Ra + 0.06;
    const plan = [];
    if (b.doors === 1) plan.push({ row: 0, z0: Math.max(trail, lead - 1.32), z1: lead });
    else {
      // the two doors MEET at the B-pillar: one shut line (two 6 mm leaf
      // insets over a black jamb), not two lines around a 9 cm painted strip.
      // The black pillar in the glass band stays 9 cm (S.pillars): the door
      // frames carry it.
      const bp = zF + b.bp;
      plan.push({ row: 0, z0: bp, z1: lead });
      plan.push({ row: 1, z0: Math.max(trail, S.zDeck + 0.1), z1: bp });
      S.pillars = [bp];
    }
    if (b.dp) S.pillars = (S.pillars || []).concat(b.dp.map((z) => zF + z));
    S.doors = [];
    plan.filter((d) => d.z1 - d.z0 > 0.45).forEach(function (d) {
      [1, -1].forEach(function (side) {
        S.doors.push({ id: (d.row ? "R" : "F") + (side > 0 ? "L" : "R"), side: side, row: d.row, z0: +d.z0.toFixed(4), z1: +d.z1.toFixed(4) });
      });
    });
    if (b.bed) S.bed = { z0: -b.L / 2 + b.bed.z0, z1: zF + b.bed.z1, floorY: b.bed.floor };
    return S;
  }
  function lerpN(a, b, t) { return a + (b - a) * t; }

  /* ---- the door leaf as a hinged group (the contract boarding.js,
     vehicles.js bakeShutDoors / CBZ.carDoorPose, view.js lean and
     crashdeform's door sag all pose) ---------------------------------- */
  function loftDoor(root, D, paint, glass, dark) {
    const d = D.spec, side = d.side;
    const hx = D.hx, hz = d.z1;
    const g = new THREE.Group();
    g.name = "door_" + d.id;
    g.position.set(hx, 0, hz);
    const darkGeos = D.geos.dark ? [D.geos.dark] : [];
    const len = d.z1 - d.z0, zc = (d.z0 + d.z1) * 0.5;
    const inner = Math.abs(D.hx) - 0.075;          // the card's inner face
    const box = (w, h, dd, x, y, z) => { const b = new THREE.BoxGeometry(w, h, dd).toNonIndexed(); b.translate(x, y, z); return b; };
    darkGeos.push(box(0.05, 0.07, len * 0.42, side * (inner - 0.025), D.belt - 0.13, zc - 0.04));   // armrest
    darkGeos.push(box(0.04, 0.16, len * 0.30, side * (inner - 0.02), D.y0 + 0.17, zc + 0.02));      // door pocket
    darkGeos.push(box(0.03, 0.03, 0.09, side * (inner - 0.035), D.belt - 0.10, zc - 0.10));         // window switch pod
    darkGeos.push(box(0.04, 0.03, 0.14, side * (inner - 0.02), D.belt - 0.24, zc + 0.14));          // pull
    /* OUTSIDE HANDLE, lying on the skin (tilted to the panel's lean): a dark
       recess plate flush with the door and a body-colour pull bar standing
       proud of it with rounded-off ends, so it reads as a handle with a
       shadow behind it, not a black tab. */
    const H = D.handle, tilt = (H.tilt || 0) * side;
    const onSkin = (g, out) => { g.rotateZ(tilt); g.translate(H.x + side * out, H.y, H.z); return g; };
    darkGeos.push(onSkin(new THREE.BoxGeometry(0.006, 0.046, 0.19).toNonIndexed(), 0.002));            // recess
    const bar = new THREE.CylinderGeometry(0.0125, 0.0125, 0.16, 8, 1).toNonIndexed();
    bar.rotateX(Math.PI / 2); bar.scale(0.9, 1, 1);
    const paintGeos = [D.geos.paint, onSkin(bar, 0.014)];
    const mk = (geos, mat, shade) => {
      const list = geos.filter(Boolean).map((x) => (x.index ? x.toNonIndexed() : x));
      if (!list.length) return null;
      const geo = concatGeos(list);
      if (shade) shadeDoorCard(geo, D.y0, D.belt);
      geo.translate(-hx, 0, -hz);
      geo._shared = true;
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = false;
      m.userData.noSeal = true;
      g.add(m);
      return m;
    };
    const pm = mk(paintGeos, paint);
    if (pm) pm.userData.paintZone = "door";
    mk(darkGeos, dark, true);
    mk([D.geos.glass], glass);
    g.userData.carDoor = {
      id: d.id, side: side, row: d.row, z0: d.z0, z1: d.z1, len: len,
      hx: hx, hz: hz, y0: D.y0, belt: D.belt, y1: D.y1,
    };
    root.add(g);
    return g;
  }

  // body mesh from a loft geometry; noSeal because it is authored exact
  function addBody(root, geo, mat, zone) {
    if (!geo) return null;
    geo._shared = true;
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = false;
    m.userData.noSeal = true;
    if (zone) m.userData.paintZone = zone;
    root.add(m);
    return m;
  }
  // a small shaped part: a box with its top/ends sloped (cached per params)
  function addShaped(root, w, h, d, x, y, z, mat, opts) {
    const m = addSculpt(root, w, h, d, x, y, z, mat, opts);
    m.userData.noSeal = true;
    return m;
  }
  // wing mirror: arm + a pod that is wider at the glass than at the arm
  /* WING MIRRORS, on the door at the A-pillar base: a short black stalk out
     of the belt and a rounded housing (~0.22 x 0.12 x 0.10) in body colour,
     its flat back the dark glass. The old pod was a paint-coloured slab
     standing on the fender, and read as a block hovering off the hood. */
  let mirrorGeo = null, mirrorGlassGeo = null;
  function mirrorGeos() {
    if (mirrorGeo) return;
    const g = new THREE.SphereGeometry(1, 20, 12);
    g.scale(0.11, 0.06, 0.055);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getZ(i) < -0.012) p.setZ(i, -0.012);   // the flat back the glass sits in
    g.computeVertexNormals();
    // smooth normals come from the INDEXED sphere; recomputing them after
    // toNonIndexed() gave every triangle its own face normal (a faceted blob)
    mirrorGeo = g.toNonIndexed(); mirrorGeo._shared = true;
    mirrorGlassGeo = new THREE.BoxGeometry(0.19, 0.095, 0.006); mirrorGlassGeo._shared = true;
  }
  function addMirrors(root, sec, zM, paint, trim, k) {
    mirrorGeos();
    k = k || 1;
    const s = sec(zM), P = CBZ.carBody.P;
    const xg = s.pts[P.G0][0], xs = s.pts[P.S][0], y0 = s.pts[P.G0][1];
    [1, -1].forEach(function (side) {
      const armOut = xs + 0.04;
      const arm = addShaped(root, armOut - (xg - 0.02), 0.03, 0.05, side * ((armOut + xg - 0.02) / 2), y0 + 0.035, zM, trim);
      arm.rotation.z = side * 0.18;
      const cx = side * (armOut + 0.10 * k), cy = y0 + 0.075, cz = zM - 0.005;
      const h = new THREE.Mesh(mirrorGeo, paint);
      h.position.set(cx, cy, cz); h.scale.setScalar(k); h.rotation.y = side * -0.12;
      h.castShadow = false; h.userData.noSeal = true;
      root.add(h);
      const gl = new THREE.Mesh(mirrorGlassGeo, trim);
      gl.position.set(cx - side * 0.004, cy, cz - 0.014 * k); gl.scale.setScalar(k); gl.rotation.y = side * -0.12;
      gl.castShadow = false; gl.userData.noSeal = true;
      root.add(gl);
    });
  }

  function makeRoadCar(style) {
    const b = BODY[style] || BODY["tesla-3"];
    const root = new THREE.Group();
    const paint = paintMat(style, BODY_COLOR[style] || 0xd1262f, PAINT_OPTS[style] || PAINT_OPTS_EXTRA[style]);
    const glass = glassMat();
    const trim = roleMat("body-trim", "plastic", 0x14171c);
    const under = trim;                        // underbody + wheel-well liner: same black, one bucket
    const S = loftSpec(b);
    const B = CBZ.carBody.loft(S);
    const P = CBZ.carBody.P;
    addBody(root, B.geos.paint, paint, "body");
    addBody(root, B.geos.paintU, paint, "upper");
    addBody(root, B.geos.glass, glass);
    addBody(root, B.geos.trim, trim);
    addBody(root, B.geos.under, under);
    root.userData.loftBody = true;
    // the doors, cut from the shell (see carbody.js pass 4)
    const cabDark = cabinMat();
    B.doors.forEach(function (D) { loftDoor(root, D, paint, glass, cabDark); });
    // the cabin, read off the same shell
    const zF = S.axles[0], zR = S.axles[1];
    const midCab = B.section((S.zRoofF + S.zRoofR) / 2);
    const xG0 = midCab.xG0, xRail = xG0 * S.tumble;
    // the room runs to the backlight base: a saloon's parcel shelf, a hatch's
    // or an SUV's cargo floor (the third row lives there on a six-seater)
    // (a mid-engine car's glass stops at backGlassR: the room ends at the
    // engine bulkhead there, not under the painted cover behind it)
    const cabRear = (S.backGlassR != null && !S.flat ? Math.max(S.zDeck, S.backGlassR - 0.1) : S.zDeck) + 0.05;
    const spans = [];
    B.doors.forEach(function (D) { if (D.spec.side > 0) spans.push([D.spec.z0, D.spec.z1]); });
    // THE DASH STAYS UNDER THE GLASS. carseats puts the dash top at
    // belt + 5% of the greenhouse and its front edge 2 cm ahead of the room's
    // zF; under a steeply raked screen (every sports car) a room that starts
    // at the cowl pushed the dash out THROUGH the windscreen base as a black
    // slab across the hood. Walk the room's front back until the glass, at
    // half the cabin width, clears the dash top.
    const roofIn = S.yRoof - S.roofCrown - 0.02;
    const dashTop = midCab.yEdge + Math.max(0.16, roofIn - midCab.yEdge) * 0.05;
    let cabFront = S.zCowl - 0.02;
    for (let z = cabFront; z > S.zRoofF + 0.2; z -= 0.01) {
      const sc = B.section(z + 0.03);
      cabFront = z;
      if (CBZ.carBody.upperY(sc, sc.xG0 * 0.55) > dashTop + 0.01) break;
    }
    dressCabin(root, {
      cabW: xG0 * 2, zR: cabRear, zF: cabFront,
      zTR: S.zRoofR, zTF: S.zRoofF, roofW: (xRail - 0.05) * 2,
      beltY: midCab.yEdge, roofY: S.yRoof - S.roofCrown - 0.02,
      floorY: S.floorY, rows: b.rows, doorSpans: spans, seatLayout: b.seats || undefined,
      doors: S.doors.map((d) => ({ id: d.id, side: d.side, row: d.row, z0: d.z0, z1: d.z1 })),
    });
    // mirrors at the A-pillar base, plates/lamps/grilles come with the brand face
    // on the front door, just behind its leading edge (the A-pillar base)
    const fd = S.doors.filter((d) => d.row === 0)[0];
    addMirrors(root, B.section, fd ? fd.z1 - 0.1 : S.zCowl - 0.12, paint, trim);
    // per-model accents that ride the shell
    const top = (z) => B.section(z).pts[P.RC][1];
    const wingZ = -b.L / 2 + 0.22;
    if (style === "aventador" || style === "porsche" || style === "enzo") {
      const yT = top(wingZ);
      const span = b.W * (style === "enzo" ? 0.9 : 0.78);
      [1, -1].forEach(function (sd) { addShaped(root, 0.04, 0.10, 0.08, sd * span * 0.38, yT + 0.05, wingZ + 0.02, trim); });
      addShaped(root, span, 0.035, 0.24, 0, yT + 0.115, wingZ, style === "porsche" ? paint : trim, { noseDrop: 0.02 });
    }
    if (style === "muscle") {
      const zS = S.zCowl + 0.55;
      addShaped(root, 0.62, 0.075, 0.70, 0, top(zS) + 0.02, zS, trim, { noseDrop: 0.06, topTaper: 0.12 });   // hood scoop
      addShaped(root, b.W * 0.8, 0.03, 0.14, 0, top(-b.L / 2 + 0.1) + 0.03, -b.L / 2 + 0.1, paint, { tailDrop: -0.03 });  // ducktail lip
    }
    if (style === "hatch") {
      const zS = S.zRoofR - 0.02;
      addShaped(root, (xRail - 0.02) * 2, 0.04, 0.18, 0, top(zS) + 0.012, zS - 0.04, paint, { tailDrop: 0.03 });   // roof spoiler
    }
    if (style === "suv" || style === "tesla-x") {
      // roof rails on low feet
      const rl = (S.zRoofF - S.zRoofR) * 0.84, rz = (S.zRoofF + S.zRoofR) / 2;
      const rail = sharedMat("suv-rail", 0x596069, { emissive: 0x1a1d22, ei: 0.3 });
      [1, -1].forEach(function (sd) {
        addShaped(root, 0.05, 0.05, rl, sd * (xRail - 0.07), S.yRoof - S.roofCrown + 0.035, rz, rail, { noseDrop: 0.02, tailDrop: 0.02 });
      });
    }
    if (b.bed) makeBedDetails(root, S, B, trim, paint);
    if (style === "cybertruck") {
      // the full-width light bar along the nose's top edge, and the single
      // bright crease down each flank at the shoulder
      const nz = b.L / 2 - 0.03, ns = B.section(nz);
      addShaped(root, ns.xG0 * 2, 0.03, 0.05, 0, ns.yEdge + 0.01, nz, lightFrontMat());
      const crease = sharedMat("cyber-crease", 0xd4d9dc, { emissive: 0x2e3236, ei: 0.35 });
      const ms = B.section(0);
      [1, -1].forEach(function (sd) { addShaped(root, 0.012, 0.02, b.WB * 0.8, sd * (ms.hwS + 0.004), ms.pts[P.S][1], (S.axles[0] + S.axles[1]) / 2, crease); });
    }
    // wheels: tucked into the arches (the tyre's outer face 2 cm inside the fender)
    const rimStyle = CBZ.carParts ? CBZ.carParts.rimStyleFor(style) : "sport5";
    const calMat = /ferrari|enzo|aventador|veyron|porsche|muscle/.test(style)
      ? sharedMat("caliper-red", 0xc23030, { emissive: 0x2a0808, ei: 0.4 })
      : sharedMat("caliper-dk", 0x3a3f45);
    const rf = ({ ferrari: 0.72, enzo: 0.72, aventador: 0.73, veyron: 0.72, porsche: 0.71, muscle: 0.62, lowrider: 0.57,
      hatch: 0.63, suv: 0.58, pickup: 0.56, "tesla-x": 0.64, "tesla-y": 0.64 })[style] || 0.67;
    placeWheels(root, S, rimStyle, calMat, rf);
    root.userData.vehicleDims = { width: b.W, length: b.L, height: S.yRoof, wheelbase: b.WB };
    root.userData.partCtx = loftCtx(style, S, B, b, paint);
    return root;
  }
  // wheels at the real axle positions (addWheels is symmetric about z=0, so
  // the parts it adds are shifted onto the axle midpoint afterwards)
  function placeWheels(root, S, rimStyle, calMat, rf) {
    const zF = S.axles[0], zR = S.axles[1];
    const n0 = root.children.length;
    addWheels(root, S.trackHalf * 2, (zF - zR) / 0.64, S.wheelR, S.wheelW, null, rimStyle, calMat, rf);
    const mid = (zF + zR) / 2;
    for (let i = n0; i < root.children.length; i++) root.children[i].position.z += mid;
  }
  // anchors for the carparts brand face + accessories: the fascia grids let
  // lamps/grilles sit ON the curved skin instead of on a flat plane
  function loftCtx(style, S, B, b, paint) {
    const P = CBZ.carBody.P;
    const secN = B.section(b.L / 2 - 0.02), secT = B.section(-b.L / 2 + 0.02);
    const noseTop = secN.pts[P.RC][1], tailTop = secT.pts[P.RC][1];
    const faceBot = (s) => s.pts[P.R][1];
    const midCab = B.section((S.zRoofF + S.zRoofR) / 2);
    return {
      w: b.W, len: b.L, style: style, loft: true, noBumpers: true,
      frontZ: b.L / 2, rearZ: -b.L / 2,
      baseY: faceBot(secN) + 0.02,
      headY: lerpN(faceBot(secN), noseTop, 0.72), tailY: lerpN(faceBot(secT), tailTop, 0.68),
      noseTopY: noseTop, tailTopY: tailTop, bodyY: S.yB, baseH: Math.max(noseTop, tailTop) - S.yB,
      roofY: S.yRoof, roofZ: (S.zRoofF + S.zRoofR) / 2, roofW: midCab.xG0 * S.tumble * 2, roofLen: S.zRoofF - S.zRoofR,
      zCowl: S.zCowl, zDeck: S.zDeck, beltY: midCab.yEdge,
      // fine grids (4-5 cm): the lamps and intakes are LAID ON these, so a
      // coarse grid's chord error would sink them into the curved corners
      fz: CBZ.carBody.faceGrid(B, 1, 25, 19), rz: CBZ.carBody.faceGrid(B, -1, 25, 19),
      sport: /^(porsche|ferrari|enzo|aventador|veyron)$/.test(style),
      lines: CBZ.carBody.lines(B, 32),
      doors: S.doors.map((d) => [d.z0, d.z1, d.side]),
      paint: paint,
    };
  }
  // pickup bed: rail caps, a ribbed floor, tie-down hooks, a tailgate seam
  function makeBedDetails(root, S, B, trim, paint) {
    const bed = S.bed, P = CBZ.carBody.P;
    const mid = B.section((bed.z0 + bed.z1) / 2);
    const xw = mid.pts[P.G0][0];
    const blen = bed.z1 - bed.z0, bz = (bed.z0 + bed.z1) / 2;
    const n = Math.max(4, Math.round(blen / 0.28));
    for (let i = 0; i < n; i++) {
      addShaped(root, xw * 2 - 0.04, 0.018, 0.05, 0, bed.floorY + 0.009, bed.z0 + blen * (i + 0.5) / n, trim);   // floor ribs
    }
    [1, -1].forEach(function (sd) {
      addShaped(root, 0.075, 0.025, blen + 0.02, sd * (mid.pts[P.S][0] - 0.03), mid.yEdge + 0.012, bz, trim);    // rail caps
    });
    const tail = B.section(-S.L / 2 + 0.03);
    addShaped(root, tail.xG0 * 1.2, 0.05, 0.03, 0, tail.yEdge - 0.08, -S.L / 2 - 0.004, trim);                  // tailgate handle
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

  /* --- THE VAN: a lofted cab-forward body wrapped round a walk-in hold. ---
     The shell is the same loft as every road car (short raked nose, steep
     windscreen, a flat roof running to the tail, real arches) with its TAIL
     LEFT OPEN: the VAN_HOLD_V1 room — floor, sides, roof and bulkhead as
     thick noSeal panels just inside the skin — and the bottom-hinged
     tailgate close it. The hold is carved around the rear wheel tubs (a real
     van's load floor has them too), so the tyres sit in round arches instead
     of inside a painted slab. Contract unchanged: holdSpec + the named
     "van_tailgate" node (city/vehicle_hold.js), dressed cab, two real cab
     doors (boarding.js poses them like a car's). */
  const VAN = { L: 5.60, W: 2.10, FO: 0.92, WB: 3.40, R: 0.36, WW: 0.235, gap: 0.07, yB: 0.25 };
  function makeVan() {
    const root = new THREE.Group();
    const paint = paintMat("van", 0xe9ebee, { metalness: 0.4, roughness: 0.48, envMapIntensity: 0.8 });
    const glass = glassMat();
    const trim = roleMat("van-trim", "plastic", 0x202428);
    const under = trim;                        // underbody + wheel-well liner: same black, one bucket
    const v = VAN, zN = v.L / 2, zT = -v.L / 2;
    const zF = zN - v.FO, zR = zF - v.WB, Ra = v.R + v.gap;
    const zCowl = zF - 0.18, zRoofF = zCowl - 0.62;
    const yRoof = 2.04, roofC = 0.03;
    const vanHold = CFG.VAN_HOLD_V1 !== false;
    const holdFront = zCowl - 1.36;                 // the bulkhead behind the seats
    const S = {
      L: v.L, W: v.W, axles: [zF, zR], wheelR: v.R, wheelW: v.WW, archGap: v.gap,
      yB: v.yB, noseLift: 0.08, tailLift: 0.0,
      zCowl: zCowl, zRoofF: zRoofF, zRoofR: zT - 0.5, zDeck: zT - 1.0,
      yNose: 0.98, yCowl: 1.16, yDeck: 1.17, yTail: 1.17, yRoof: yRoof,
      hoodKeys: [[zN - 0.22, 1.06], [(zCowl + zN) / 2, 1.12]],
      roofKeys: [[zRoofF, yRoof - 0.03], [zRoofF - 0.5, yRoof], [zT, yRoof]],
      hoodCrown: 0.03, roofCrown: roofC, deckCrown: 0.02,
      tumble: 0.975, beltIn: 0.012, shoulderIn: 0.012, shoulderDrop: 0.02,
      rcNose: 0.26, rcTail: 0.02, endTaperN: 0.04, endTaperT: 0,
      bulge: 0.018, tuck: 0.004, winF: 0.1, winR: 0,
      sideGlassR: holdFront + 0.1, archTrim: true, valance: 0.3,
      openTail: vanHold, floorY: v.yB + 0.15,
    };
    const sh0 = CBZ.carBody.makeShape(Object.assign({}, S, { trackHalf: 1 }));
    S.trackHalf = Math.min(sh0.planHalf(zF), sh0.planHalf(zR)) + S.bulge - 0.02 - v.WW / 2;
    const lead = Math.min(zCowl + 0.02, zF - Ra - 0.05);
    S.doors = [];
    [1, -1].forEach(function (side) {
      S.doors.push({ id: "F" + (side > 0 ? "L" : "R"), side: side, row: 0, z0: +(holdFront + 0.14).toFixed(4), z1: +lead.toFixed(4) });
    });
    const B = CBZ.carBody.loft(S);
    const P = CBZ.carBody.P;
    addBody(root, B.geos.paint, paint, "body");
    addBody(root, B.geos.paintU, paint, "upper");
    addBody(root, B.geos.glass, glass);
    addBody(root, B.geos.trim, trim);
    addBody(root, B.geos.under, under);
    root.userData.loftBody = true;
    B.doors.forEach(function (D) { loftDoor(root, D, paint, glass, cabinMat()); });
    // ---- THE HOLD, just inside the skin ----
    const tail = B.section(zT + 0.01);
    const railX = tail.pts[P.G1][0];
    const wallT = 0.05;
    const holdHalf = Math.min(railX - 0.012, tail.pts[P.S][0] - 0.02);
    const holdW = holdHalf * 2;
    const floorTop = 0.52;
    const roofY = tail.pts[P.G1][1] - 0.02 - wallT;       // the panel's top stays under the rail
    const boxBack = zT, boxFront = holdFront;
    const boxD = boxFront - boxBack, boxZ = (boxFront + boxBack) / 2;
    const archTop = v.R + Ra + 0.02;
    const xIn = S.trackHalf - v.WW / 2 - 0.05;
    const a0 = zR - Ra - 0.02, a1 = zR + Ra + 0.02;       // the rear arch's z-span
    const deck = roleMat("van-deck", "metal", 0x4e545c);
    const mark = function (m) { m.userData.noSeal = true; m.userData.holdShell = true; return m; };
    const pbox = (w, h, d, x, y, z, m) => mark(addBox(root, w, h, d, x, y, z, m));
    if (vanHold) {
      const seg = (z0, z1) => [Math.max(boxBack, z0), Math.min(boxFront, z1)];
      // floor: full width fore and aft of the arch, between the tubs over it
      [[boxBack, a0, holdW], [a0, a1, xIn * 2], [a1, boxFront, holdW]].forEach(function (f) {
        const s2 = seg(f[0], f[1]);
        if (s2[1] - s2[0] > 0.02) pbox(f[2], wallT, s2[1] - s2[0], 0, floorTop - wallT / 2, (s2[0] + s2[1]) / 2, deck);
      });
      [1, -1].forEach(function (sd) {
        const x = sd * (holdHalf - wallT / 2);
        [[boxBack, a0, floorTop], [a0, a1, archTop], [a1, boxFront, floorTop]].forEach(function (f) {
          const s2 = seg(f[0], f[1]);
          if (s2[1] - s2[0] > 0.02) pbox(wallT, roofY - f[2], s2[1] - s2[0], x, (f[2] + roofY) / 2, (s2[0] + s2[1]) / 2, paint);
        });
        // the wheel tub: an inverted U over the tyre (a lid at the arch top,
        // an inner wall down to the floor), hollow so the tyre has its well
        const tw = holdHalf - wallT - xIn;
        pbox(tw + wallT, wallT, a1 - a0, sd * (xIn + tw / 2), archTop + wallT / 2, (a0 + a1) / 2, deck);
        pbox(wallT, archTop - floorTop + wallT, a1 - a0, sd * (xIn + wallT / 2), (floorTop - wallT + archTop) / 2, (a0 + a1) / 2, deck);
      });
      pbox(holdW, wallT, boxD, 0, roofY + wallT / 2, boxZ, paint);                                 // roof lining
      pbox(holdW, roofY - floorTop + wallT * 2, wallT, 0, (floorTop + roofY) / 2, boxFront - wallT / 2, paint);  // bulkhead
      // the rear frame: posts, header and a bumper step close the ring
      // between the skin and the opening
      const hw = tail.hwLow + 0.005;
      [1, -1].forEach(function (sd) {
        pbox(hw - holdHalf + wallT, roofY - v.yB, 0.07, sd * (holdHalf - wallT + (hw - holdHalf + wallT) / 2), (roofY + v.yB) / 2, zT + 0.035, trim);
      });
      pbox(hw * 2, tail.pts[P.RC][1] - roofY + 0.01, 0.07, 0, (tail.pts[P.RC][1] + roofY) / 2, zT + 0.035, trim);
      pbox(hw * 2, floorTop - wallT - v.yB, 0.12, 0, (floorTop - wallT + v.yB) / 2, zT + 0.02, trim);
    }
    // cab
    const midCab = B.section(zCowl - 0.6);
    dressCabin(root, {
      cabW: midCab.xG0 * 2, zR: holdFront + 0.04, zF: zCowl - 0.02,
      zTR: holdFront + 0.06, zTF: zRoofF, roofW: (midCab.xG0 * S.tumble - 0.05) * 2,
      beltY: midCab.yEdge, roofY: yRoof - roofC - 0.03,
      floorY: S.floorY, rows: 1, seatLayout: "van3",
      doorSpans: S.doors.filter((d) => d.side > 0).map((d) => [d.z0, d.z1]),
      doors: S.doors.map((d) => ({ id: d.id, side: d.side, row: d.row, z0: d.z0, z1: d.z1 })),
    });
    addMirrors(root, B.section, lead - 0.1, trim, trim, 1.25);
    // kerb-side (-x) sliding-door shut lines + its roller track
    const sd0 = holdFront - 0.02, sd1 = holdFront - 1.12;
    const flank = B.section((sd0 + sd1) / 2);
    const fx = -(flank.pts[P.M][0] + 0.004), yLo = flank.pts[P.R][1] + 0.02, yHi = flank.pts[P.G1][1] - 0.04;
    [sd0, sd1].forEach(function (z) { addShaped(root, 0.01, yHi - yLo, 0.012, fx, (yLo + yHi) / 2, z, trim); });
    addShaped(root, 0.012, 0.03, sd0 - sd1 + 0.4, fx - 0.004, flank.pts[P.S][1] - 0.05, (sd0 + sd1) / 2 - 0.2, trim);
    // three amber clearance markers on the cab roof's leading edge
    const marker = sharedMat("van-marker", 0xffb347, { emissive: 0xffa028, ei: 0.7 });
    [-0.3, 0, 0.3].forEach(function (f) { addShaped(root, 0.10, 0.04, 0.06, f * v.W, yRoof + 0.005, zRoofF - 0.12, marker); });
    const vanLeaf = Math.min(1.5, roofY - floorTop + 0.06);
    if (vanHold) {
      addTailgate(root, "van_tailgate", {
        w: holdW - 0.01, len: vanLeaf, sillZ: boxBack, sillTop: floorTop,
        closedRx: 1.552, mat: paint, ribMat: trim, trimMat: trim, leafT: 0.06,
      });
    }
    const rimStyle = CBZ.carParts ? CBZ.carParts.rimStyleFor("van") : "steel";
    placeWheels(root, S, rimStyle, sharedMat("caliper-dk", 0x3a3f45), 0.56);
    root.userData.vehicleDims = { width: v.W, length: v.L, height: yRoof, wheelbase: v.WB };
    const ctx = loftCtx("van", S, B, Object.assign({ W: v.W, L: v.L }, v), paint);
    // the tail lamps ride the rear posts, the plate the bumper step — never
    // the tailgate, which swings away with anything glued to it
    ctx.tailX = (tail.hwLow + holdHalf - wallT) / 2;
    ctx.tailW = Math.max(0.06, tail.hwLow - holdHalf + wallT - 0.02);
    ctx.tailY = floorTop + 0.35;
    ctx.rearPlateY = (floorTop - wallT + v.yB) / 2;
    ctx.rearFlat = true;
    root.userData.partCtx = ctx;
    if (vanHold) {
      root.userData.holdSpec = {
        id: "van-box", label: "Cargo bay",
        floor: { x: 0, z: boxZ, w: holdW - wallT * 2, d: boxD - wallT * 2, top: floorTop },
        roof: roofY,
        walls: [
          { x: -(holdHalf - wallT / 2), z: boxZ, w: wallT, d: boxD - wallT * 2, y0: floorTop, y1: roofY },
          { x: (holdHalf - wallT / 2), z: boxZ, w: wallT, d: boxD - wallT * 2, y0: floorTop, y1: roofY },
          { x: 0, z: boxFront - wallT / 2, w: holdW, d: wallT, y0: floorTop, y1: roofY },
        ],
        ramp: {
          nodeName: "van_tailgate", w: holdW - 0.01, len: vanLeaf,
          sillZ: boxBack, sillTop: floorTop,
          closedRx: 1.552, openRx: -Math.asin(Math.min(0.98, floorTop / vanLeaf)),
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
    // the helmet is a real full-face moto lid (entities/headwear.js, built in
    // the adult 0.60 head frame: skull centre (0, 0.30, 0), face +z = the
    // bike's forward) shrunk to this dummy's 0.15 head and centred where the
    // head is. A page without headwear.js keeps the dark ball.
    const lid = CBZ.headwear && CBZ.headwear.build("moto", { color: 0x0d0f12 });
    if (lid) {
      const k = 0.15 / 0.33;
      lid.scale.setScalar(k);
      lid.position.set(0, axleY + 1.02 - 0.30 * k, 0.34);
      lid.traverse(function (o) { if (o.isMesh) o.castShadow = false; });
      r.add(lid);
    } else {
      addSphere(r, 0.15, 0, axleY + 1.02, 0.34, sharedMat("moto-helmet", 0x0d0f12, { emissive: 0x05080a, ei: 0.3 }), 1, 0.92, 1.1);
    }
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

  // --- speedboat: THE GEOMETRY MOVED. It used to be five width-stepped
  //     prisms and a rotated box for a "deep-V keel" right here, and the
  //     marine registry carried `build: null` for key "boat" so that
  //     CBZ.marineHulls.build("boat") bounced back into this file. That split
  //     is why the runabout was the one hull in the fleet nobody could audit.
  //     world/water_hulls.js buildSpeedboat() owns it now — a lofted deep-V
  //     with a hard chine, spray rails, a real three-pane wraparound screen
  //     and a sterndrive — and this is the delegate.
  //
  //     RESOLVED AT CALL TIME, never at parse: index.html parses this file at
  //     :1262 and water_hulls.js at :2158, so CBZ.marineHulls does not exist
  //     while this IIFE runs. It always exists by the time a car is built.
  function makeBoat() {
    const MH = CBZ.marineHulls;
    if (MH && MH.buildable && MH.buildable("boat")) {
      const g = MH.build("boat");
      if (g) return g;
    }
    // No registry at all (water_hulls.js dropped from the build): an empty
    // group is the honest failure. A road car standing in for a boat, or a
    // second copy of the hull maintained here, are both worse.
    console.warn("[playercars] marine registry absent: no hull for style \"boat\"");
    return new THREE.Group();
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
     modshop's respray keys off `_playerCarOwned`, so neither changes meaning.

     AND `STAYS SET` HAS TO BE WRITTEN DOWN, NOT ASSUMED. The block above was
     already correct about WHY the flag must survive — and it still did not,
     because `THREE.Material.clone()` is `new this.constructor().copy(this)`
     and `Material.copy()` only copies the properties three.js itself knows
     about. Every custom tag we hang on a material — `_bodyPaint`, `_shared`,
     `_playerCarOwned` — is dropped on the floor by the clone. The two lines
     below that set `_shared`/`_playerCarOwned` explicitly are why THOSE two
     survived; `_bodyPaint` was left to a comment, so it did not, and the exact
     failure this file predicted happened anyway:

       CBZ.cityRecolorCarBody(car.group, 0x00ff00) on a live race car turned
       ZERO meshes green, and CBZ.carPaintAudit() counted 0 body-paint
       materials on all 391 cars in the world.

     So the tag is re-applied on the clone, in code. A car built through this
     path is paintable for the rest of its life, which is what makes the race
     livery, the parked-car repaint and the respray land at all. */
  function recolorBody(root, color) {
    if (root && root.userData && root.userData.marineLivery) return;
    const c = CBZ.carPaintColor ? CBZ.carPaintColor(color) : new THREE.Color(color);
    const swapped = new Map();
    root.traverse(function (o) {
      // A SHUT DOOR IS NOT IN THE TREE. vehicles.js parks the live door groups
      // off the graph while their baked shut copy draws (bakeShutDoors), so a
      // respray has to reach into the rig or the first door you open comes
      // out in the showroom colour.
      const rig = o._cbzDoorRig;
      if (rig && rig.doors) for (let i = 0; i < rig.doors.length; i++) if (!rig.doors[i].parent) rig.doors[i].traverse(paintOne);
      paintOne(o);
    });
    function paintOne(o) {
      const m = o.material;
      if (!m || Array.isArray(m) || !m._bodyPaint) return;
      if (m._playerCarOwned) {                 // ours already — repaint, don't mint
        if (m.color && m.color.copy) m.color.copy(c);
        if (m.emissive && m.emissive.copy) m.emissive.copy(c).multiplyScalar(0.03);
        if (CBZ.carPaintFinish) CBZ.carPaintFinish(m, color);   // solid or metallic, per colour
        return;
      }
      let nm = swapped.get(m.id);
      if (!nm) {
        nm = m.clone();
        nm.color = c.clone();
        if (nm.emissive) nm.emissive = c.clone().multiplyScalar(0.03);
        nm._shared = false; nm._playerCarOwned = true;
        // RE-APPLIED, NOT INHERITED: Material.clone() does not carry custom
        // props (see the block comment). Without this line the car becomes
        // unpaintable the instant it is first painted.
        nm._bodyPaint = CFG.CAR_PAINT_HANDLE_V2 !== false;
        if (CBZ.carPaintFinish) CBZ.carPaintFinish(nm, color);
        swapped.set(m.id, nm);
      }
      o.material = nm;
    }
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
      _cabinStyle = style;                 // dressCabin: which seat model to upholster
      if (style === "van") template = makeVan();
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
      // THE FULL FACE CONTEXT STAYS WITH THE TEMPLATE. Object3D.clone deep-
      // copies userData through JSON, so a partCtx carrying the paint material
      // and the fascia grids was serialised again for EVERY car in the city.
      // The instance keeps a slim, numbers-only copy (same keys, minus the
      // heavy ones); the face builder reads the full one from here.
      const full = template.userData.partCtx;
      if (full) {
        tplCtx.set(template, full);
        const slim = {};
        for (const k in full) if (k !== "paint" && k !== "fz" && k !== "rz" && k !== "lines") slim[k] = full[k];
        template.userData.partCtx = slim;
      }
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
    const ctx = tplCtx.get(template) || template.userData.partCtx;
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
      /* VENDORED, NOT FETCHED. This used to pull the Draco decoder off
         unpkg.com at runtime — a CDN round trip on the critical path of the
         first Ferrari, a hard failure with no network, and code downloaded
         from a third party at run time, which is the one thing an App Store
         build may not do. The decoder now lives in src/vendor/draco/gltf/
         (three r128's own copy, 0.8 MB, still lazy: DRACOLoader fetches it
         only when a Draco-compressed mesh actually arrives). */
      draco.setDecoderPath(SRC_ROOT + "vendor/draco/gltf/");
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
    if (/f-150|f150|rampart|silverado|ram 1500|pickup|tacoma|tundra/i.test(name)) return "pickup";
    if (/cherokee|escalade|suburban|tahoe|suv|range/i.test(name)) return "suv";
    if (/mercedes/i.test(name)) return "tesla-s";
    if (/prius|civic|golf|hatch/i.test(name)) return "hatch";
    if (/caravan/i.test(name)) return "tesla-y";
    // body-class fallback so generic traffic still gets a fitting silhouette
    const body = model && model.body;
    if (body === "muscle") return "muscle";
    if (body === "suv") return "suv";
    if (body === "van") return "van";
    if (body === "pickup") return "pickup";
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
    if (CBZ.carWheelSteer) CBZ.carWheelSteer(car, list, dt, visual);
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
