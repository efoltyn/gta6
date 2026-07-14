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
  };
  const DEFAULT_FEEL = { class: "sedan", accel: 1.0, top: 1.0, turn: 1.0, grip: 1.0, brake: 1.0, drift: 1.0, roll: 0.6 };

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
    // CABIN INTERIOR: a matte-dark block filling the tub's lower half so a
    // look through the glass shows a plausible cockpit mass (seats/dash),
    // not the hollow inside of the far flank.
    const interior = sharedMat("interior", 0x2a2f36);
    addBox(root, cabW * 0.88, Math.max(0.08, peakY * 0.45), Math.max(0.3, (cb + ct)) , 0, cabBaseY + peakY * 0.24, cabCx, interior);

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
    addBox(root, cabWs * 0.88, peakY * 0.45, cb + ct, 0, cabBaseY + peakY * 0.24, cabCx, sharedMat("interior", 0x2a2f36));
    const roofWs = cabWs * roofTuck;
    const sideMidZ = (rT[0] + fT[0]) * 0.5;
    const sideLen = (fT[0] - rT[0]) * 1.0;
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
    // big slab cargo box (the dominant tall mass)
    addBox(root, w, boxH, len * 0.74, 0, bodyY + boxH * 0.5, -len * 0.1, paint);
    // sliding-door crease line + lower rocker trim down the slab
    addBox(root, w + 0.02, 0.05, len * 0.7, 0, bodyY + boxH * 0.6, -len * 0.1, trim);
    addBox(root, w + 0.02, 0.18, len * 0.72, 0, bodyY + 0.1, -len * 0.1, trim);
    // sloped short hood up front (rises toward the cab, merging into the box)
    addPrism(root, w * 0.96, [[len * 0.18, 0], [len * 0.18, boxH * 0.9], [len * 0.5, boxH * 0.55], [len * 0.5, 0.2]], bodyY + 0.06, paint);
    // raked windshield: a dark panel LYING ON the hood's rake plane (the old
    // vertical slab poked through the slope and floated off the nose —
    // orbit-diagnosed). Face runs (len*0.5, boxH*0.55) -> (len*0.18, boxH*0.9).
    (function () {
      const botZ = len * 0.5, botY = boxH * 0.55, topZ = len * 0.18, topY = boxH * 0.9;
      const dz = topZ - botZ, dy = topY - botY, fl = Math.hypot(dz, dy);
      const nz = dy / fl, ny = -dz / fl;               // outward (up-forward) normal
      const m = new THREE.Mesh(boxGeo(w * 0.84, fl * 0.72, 0.03), dark);
      m.position.set(0, bodyY + 0.06 + (botY + topY) * 0.5 + ny * 0.02, (botZ + topZ) * 0.5 + nz * 0.02);
      m.rotation.x = Math.atan2(dz, dy);
      root.add(m);
    })();
    [1, -1].forEach(function (side) {
      addBox(root, 0.03, boxH * 0.28, len * 0.14, side * (w * 0.505), bodyY + boxH * 0.62, len * 0.32, dark);  // cab side window
      addBox(root, 0.025, boxH * 0.72, 0.035, side * (w * 0.505), bodyY + boxH * 0.51, -len * 0.1, trim);
      addBox(root, 0.17, 0.13, 0.28, side * (w * 0.55), bodyY + boxH * 0.66, len * 0.4, trim);  // mirrors
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
    addBox(root, 0.035, boxH * 0.74, 0.04, 0, bodyY + boxH * 0.5, -len * 0.47, trim);   // split rear doors
    [1, -1].forEach(function (side) {                                                   // rear-door hinges + handle bar
      [0.30, 0.72].forEach(function (fy) {
        addBox(root, 0.035, 0.09, 0.05, side * (w * 0.5 - 0.05), bodyY + boxH * fy, -len * 0.47 - 0.02, trim);
      });
    });
    addBox(root, 0.03, 0.26, 0.04, 0.11, bodyY + boxH * 0.45, -len * 0.47 - 0.025, trim);
    // trucker jewellery: three amber clearance markers along the front roof edge
    // (kills the "rolling fridge" read — the roofline gets a working-vehicle cue).
    const marker = sharedMat("van-marker", 0xffb347, { emissive: 0xffa028, ei: 0.7 });
    [-0.3, 0, 0.3].forEach(function (fx) {
      addBox(root, 0.12, 0.06, 0.09, fx * w, bodyY + boxH - 0.06, len * 0.27, marker);
    });
    addWheels(root, w + 0.1, len, wheelR, 0.32, trim, "sixlug", sharedMat("caliper-dk", 0x3a3f45), 0.52);
    root.userData.vehicleDims = { width: w, length: len, height: boxTop, wheelbase: len * 0.68 };
    // Bison face anchors: lamps low on the nose, VERTICAL tails riding the tall
    // box rear corners (rearZ is the box face, not len/2 — the box is set back).
    root.userData.partCtx = {
      w: w, len: len, style: "van",
      // headY well ABOVE the bumper band (baseY): the first render buried the
      // grille + quad lamps behind the bumper block (both landed at y≈0.49).
      frontZ: len * 0.5, rearZ: -len * 0.47,
      baseY: wheelR + 0.12, headY: bodyY + 0.68, tailY: bodyY + boxH - 0.46,
      noseTopY: bodyY + boxH * 0.55, bodyY: bodyY, baseH: boxH,
      roofY: boxTop, roofZ: -len * 0.1, roofW: w * 0.9, roofLen: len * 0.5,
      paint: paint,
    };
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
    const deck = roleMat("boat-deck", "plastic", 0xb4885c);      // teak-ish deck
    const pad = roleMat("boat-pad", "interior", 0xd8dde4);       // white vinyl
    const glass = glassMat();
    const dark = roleMat("boat-dark", "plastic", 0x101317);
    const chrome = chromeMat();
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
    return root;
  }

  // Recolour the body PAINT of a freshly-cloned visual to `color`, leaving every
  // accent material (glass, trim, sills, stripes, chrome, lights) untouched. The
  // template's paint material is tagged `_bodyPaint`; clone(true) shares material
  // refs, so we swap those meshes onto a per-car cloned material (one per unique
  // source paint) and tag it `_playerCarOwned` so detach()/dispose can clean up.
  function recolorBody(root, color) {
    const c = new THREE.Color(color);
    const swapped = new Map();
    root.traverse(function (o) {
      const m = o.material;
      if (!m || Array.isArray(m) || !m._bodyPaint) return;
      let nm = swapped.get(m.id);
      if (!nm) {
        nm = m.clone();
        nm.color = c.clone();
        if (nm.emissive) nm.emissive = c.clone().multiplyScalar(0.16);
        nm._shared = false; nm._bodyPaint = false; nm._playerCarOwned = true;
        swapped.set(m.id, nm);
      }
      o.material = nm;
    });
  }

  function makeProcedural(style, color, model) {
    let template = procTemplates.get(style);
    if (!template) {
      if (style === "cybertruck") template = makeCybertruck();
      else if (style === "suv") template = makeSUV();
      else if (style === "van") template = makeVan();
      else if (style === "motorcycle") template = makeMotorcycle();
      else if (style === "helicopter") template = makeHelicopter();
      else if (style === "boat") template = makeBoat();
      else template = makeRoadCar(style);
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
    car._playerCarFeel = FEEL[style] || DEFAULT_FEEL;
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
    if (model && model.detailStyle && STYLE_LABEL[model.detailStyle]) return model.detailStyle;
    const name = model ? (model.name || "") : "";
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
      car._playerCarFeel = FEEL[car.detailStyle] || DEFAULT_FEEL;
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
    car._playerCarFeel = FEEL[style] || DEFAULT_FEEL;
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
  // public handling-feel lookup so the driving sim / other systems can branch on
  // vehicle class (e.g. air/marine/twoWheel flags) and apply the multipliers.
  CBZ.cityPlayerCarFeel = function (style) {
    return FEEL[style] || (active && active._playerCarFeel) || DEFAULT_FEEL;
  };
  preloadFerrari();

  addEventListener("keydown", function (e) {
    const g = CBZ.game;
    if (!g || g.mode !== "city" || g.state !== "playing" || !CBZ.player.driving || e.repeat) return;
    if (e.key.toLowerCase() === "c") {
      e.preventDefault();
      CBZ.cityCyclePlayerCarStyle();
    }
  });
})();
