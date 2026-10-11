/* ============================================================
   world/airbase.js — AN AIR BASE, ANYWHERE, WITH AEROPLANES ON IT.

   WHY THIS EXISTS, AND WHY IT IS NOT city/island_military.js. Fort
   Brandt (`city/island_military.js`, 90 kB) is a PLACE in the shipped
   world: it registers as an archipelago landmass, hangs off the world
   layout dial, feeds the causeway checkpoint, the armory, the militia
   roster and the strategic-weapons chain in `city/strategic.js`. All of
   that is correct and none of it is portable — you cannot ask it for
   "an air base at these coordinates on this terrain" because it does
   not take coordinates, it takes the whole city.

   This file is the PORTABLE answer to the same question. Give it a
   position, a heading and a ground-height function and it returns a
   working installation: runway, taxiway, apron, hangars, tower, fuel
   farm, radar, fence, gate — plus real aeroplanes parked on it. It has
   exactly one dependency (THREE) and two optional ones (CBZ.cmat /
   CBZ.micro.addCollider), so it stands up on a slice page or inside the
   full engine without changing a line.

   THE PAD. Terrain is not flat and an air base is. Rather than deform
   the terrain (which would mean owning a heightmap this file cannot
   see), the base builds itself on a CONCRETE PLATFORM raised to the
   highest ground under its footprint and skirted down 16 m. That is
   also how real installations on rough ground are built, so the honest
   engineering answer and the cheap rendering answer are the same one.

   THE AIRFRAMES ARE THE POINT. `CBZ.airbase.bomber()` and
   `.fighter()` are exported on their own, because "I need a flying wing
   / a delta fighter as a THREE.Group at the origin, nose down -Z" is a
   thing half a dozen callers want and none of them want the base
   attached. Both are built from a 2-D PLANFORM extruded to thickness —
   the same way the shape is actually specified in the real world — so
   the silhouette from above (the only view that matters for an aircraft
   seen from a cockpit or a map) is right by construction rather than by
   stacking boxes until it looks close.

     bomber   flying wing, 52.4 m span / 21 m length (the real 2.50
              ratio), 33° leading edge, W sawtooth trailing edge, no
              tail surfaces at all — a tailless wing IS the shape.
     fighter  17 m delta, twin canted stabilators, bubble canopy,
              wingtip rails. Reads as a fighter at 800 m, which is the
              distance it will be read from.

   NOSE CONVENTION: every airframe returned points down −Z with +Y up,
   so `group.rotation.y = heading` aims it and nothing has to remember
   an offset. `group.userData.airframe` carries {span,length,kind}.

   Flags: AIRBASE_V1 (master), AIRBASE_FIGHTERS (flight-line count).
   THE LAYOUT is world/basekit.js's plan (the same planner Fort Brandt uses);
   this file owns the slab, the rotation, world colliders and seating.
   Audit: CBZ.airbaseAudit().
============================================================ */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});
  const THREE = window.THREE;
  if (!THREE) return;

  CBZ.CONFIG = CBZ.CONFIG || {};
  const C = CBZ.CONFIG;
  if (C.AIRBASE_V1 == null) C.AIRBASE_V1 = true;
  if (C.AIRBASE_FIGHTERS == null) C.AIRBASE_FIGHTERS = 8;
  if (C.AIRBASE_V1 === false) return;

  function cm(hex, o) { return CBZ.cmat ? CBZ.cmat(hex, o) : new THREE.MeshLambertMaterial({ color: hex }); }
  function bg(w, h, d) { return CBZ.boxGeom ? CBZ.boxGeom(w, h, d) : new THREE.BoxGeometry(w, h, d); }
  function collide(b) { return (CBZ.micro && CBZ.micro.addCollider) ? CBZ.micro.addCollider(b) : b; }

  /* ---- WHEELS ON CONCRETE: MEASURE, DON'T TRUST A HAND-PASSED DROP ------
     Where a parked machine's undercarriage is depends on who modelled it,
     and every scheme that answers that from a number carried alongside the
     model eventually meets a model whose number is missing, stale or — the
     bug this replaces — a legitimate ZERO that a `||` default swallowed.
     The geometry always knows: the lowest point of a parked aeroplane IS
     its wheels. So ask the bounding box, once, at placement time. Right for
     the primitives, right for the shipped gang-city models, and right for
     whatever model gets pointed at this file next with no call site edited. */
  const _bb = new THREE.Box3();
  function boxOf(g) { return _bb.setFromObject(g); }

  // Seat `g` at pad-local (lx,lz) with yaw `yaw` so its lowest point rests on
  // the slab top `top`. CALL BEFORE root.add(g): Box3.setFromObject reads
  // world matrices, so an unparented group measures in its own frame — which
  // is the same pad-local frame `top` is expressed in. Once it is inside the
  // root, the same measurement comes back in world metres and the sum is off
  // by the whole pad height.
  function seat(g, lx, lz, top, yaw) {
    g.rotation.y = yaw;
    g.position.set(lx, 0, lz);
    const low = boxOf(g).min.y;               // empty group ⇒ +Infinity
    g.position.y = top - (isFinite(low) ? low : 0);
    return g.position.y;
  }

  const M = {
    concrete: 0x9a978d, runway: 0x33363a, paint: 0xe4e0d2, tarmac: 0x4a4d52,
    olive: 0x4a5238, oliveD: 0x39402e, steel: 0x5c626a, steelD: 0x3d424a,
    grey: 0x6d737b, greyD: 0x474c53, glass: 0x2a3b4d, tire: 0x14161a,
    fence: 0x8f959b, warn: 0xd4a017, red: 0xb43a32, sand: 0xb6a373,
    jet: 0x7a838d, jetD: 0x5b636c, stealth: 0x3a3f45, stealthD: 0x2b2f34,
  };

  // ---------------------------------------------------------------- SHAPES
  // Build a THREE.Shape from a flat list [x0,y0, x1,y1, …] and extrude it to
  // `thick`, then lay it flat: shape +y becomes world −z (nose forward) and
  // the extrusion becomes world +y (thickness). One helper, both airframes.
  function planform(pts, thick) {
    const s = new THREE.Shape();
    s.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) s.lineTo(pts[i], pts[i + 1]);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false, curveSegments: 2 });
    g.rotateX(-Math.PI / 2);          // (x,y,z) → (x, z, −y)
    g.translate(0, -thick / 2, 0);    // centre the thickness on y=0
    return g;
  }

  const airbase = (CBZ.airbase = CBZ.airbase || {});

  /* ======================================================================
     REAL HARDWARE FIRST. THE PRIMITIVES ARE THE FALLBACK.

     The engine already owns this hardware and owns it far better than this
     file ever will: `city/strategic.js` lofts the actual B-2 (aerofoil
     thickness law, the double-W trailing edge falling out of the planform,
     a windscreen cut from the hull itself) and `city/island_military.js`
     builds the fighter, the heavy bomber, the transport, the helicopter,
     the tank and the truck. Both were unreachable from a standalone page
     because they were welded to the archipelago — so both now publish
     their model factories (CBZ.strategicModels / CBZ.milModels) and this
     file ASKS FOR THEM BEFORE IT BUILDS ANYTHING.

     The primitives below are not the plan. They are what a page falls back
     to when those files are not loaded, so a slice that wants a runway and
     two shapes on it does not have to pull in 220 kB of city to get one.
     Load the city files and every airframe on the field upgrades in place,
     with no call site changed. `airbase.usingReal()` reports which you got.

     TWO CONVENTIONS TO RECONCILE, both handled in adopt():
       • gang-city models point their nose down +Z; every airframe this file
         hands out points −Z (so `group.rotation.y = heading` just works).
       • some factories return {group, footW, footL, height}, some return a
         bare Group. The adopter takes either.
  ====================================================================== */
  function adopt(made, meta) {
    const raw = (made && made.isObject3D) ? made : (made && made.group);
    if (!raw) return null;
    const g = new THREE.Group();
    raw.rotation.y = Math.PI;                 // nose +Z → nose −Z
    g.add(raw);
    // These models are authored standing on their own wheels at y ≈ 0, so
    // this used to be a flat `= 0`. That literal zero is what floated the
    // whole field: every placement read it as `userData.gearDrop || 3.2`,
    // and a legitimate zero is falsy, so each real airframe took the
    // PRIMITIVE's fallback drop and parked three metres in the air.
    // Publish the MEASURED offset instead — same sign convention as
    // addGear() (how far the lowest point hangs BELOW the group origin, so
    // a model standing proud of its own origin reports a negative), which
    // also stops the field lying about heli skids that sit at +0.145.
    g.userData.gearDrop = -boxOf(g).min.y;
    g.userData.airframe = meta || {};
    g.userData.real = true;
    if (made && made.footW != null) {
      g.userData.footprint = { w: made.footW, l: made.footL, h: made.height };
    }
    return g;
  }
  function realModel(path, meta) {
    const parts = path.split(".");
    const ns = CBZ[parts[0]];
    const fn = ns && ns[parts[1]];
    if (typeof fn !== "function") return null;
    try { return adopt(fn(), meta); }
    catch (e) { console.warn("[airbase] " + path + " present but failed; using primitives", e); return null; }
  }
  airbase.usingReal = function () {
    return {
      b2: !!(CBZ.strategicModels && CBZ.strategicModels.b2),
      mil: !!CBZ.milModels,
      models: CBZ.milModels ? Object.keys(CBZ.milModels) : [],
    };
  };

  // THE FLYING WING. Half the outline is authored; the mirror is generated,
  // so the aeroplane cannot come out asymmetric by a typo.
  airbase.bomber = function (opts) {
    opts = opts || {};
    if (opts.primitive !== true) {
      // the REAL B-2 first; then the base's own heavy bomber; then ours
      const real = realModel("strategicModels.b2", { kind: "bomber", span: 52.4, length: 21, name: "B-2 SPIRIT" }) ||
        realModel("milModels.bomber", { kind: "bomber", span: 48, length: 40, name: "HEAVY BOMBER" });
      if (real) return real;
    }
    const g = new THREE.Group();
    const SPAN = opts.span || 52.4, LEN = opts.length || 21;
    const hx = SPAN / 2, hz = LEN / 2;

    // half planform, nose at +y, trailing edge at −y (shape space)
    const half = [
      0, hz,                       // nose
      hx, -hz * 0.61,              // leading edge, 33° sweep to the tip
      hx * 0.80, -hz,              // sawtooth: aft point
      hx * 0.61, -hz * 0.66,       // sawtooth: forward notch
      hx * 0.40, -hz,              // sawtooth: aft point
      hx * 0.21, -hz * 0.66,       // sawtooth: forward notch
      0, -hz,                      // centreline trailing edge
    ];
    const pts = half.slice();
    for (let i = half.length - 4; i >= 0; i -= 2) { pts.push(-half[i], half[i + 1]); }

    const wing = new THREE.Mesh(planform(pts, 1.5), cm(M.stealth));
    wing.castShadow = true; wing.receiveShadow = true;
    g.add(wing);

    // centre body — the wing is thickest on the centreline and that bulge is
    // the crew compartment and the bomb bay
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 7), cm(M.stealthD));
    body.scale.set(5.2, 2.1, 9.5);
    body.position.set(0, 0.5, -1);
    body.castShadow = true;
    g.add(body);

    // cockpit glass, set into the leading centre section
    const glass = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshLambertMaterial({
      color: M.glass, emissive: 0x0e1a26, emissiveIntensity: 0.7,
    }));
    glass.scale.set(2.1, 1.15, 3.0);
    glass.position.set(0, 1.5, -hz * 0.42);
    g.add(glass);

    // engine humps: the engines are INSIDE the wing — that is the airframe's
    // whole argument — so what shows is the intake shoulder, not a nacelle
    for (let s = -1; s <= 1; s += 2) {
      const hump = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), cm(M.stealthD));
      hump.scale.set(3.0, 1.15, 5.0);
      hump.position.set(s * 7.2, 0.9, -1.5);
      g.add(hump);
      const intake = new THREE.Mesh(bg(4.4, 0.9, 2.0), cm(0x14171a));
      intake.position.set(s * 7.2, 1.1, -4.6);
      g.add(intake);
      const exhaust = new THREE.Mesh(bg(5.2, 0.5, 1.4), cm(0x101214));
      exhaust.position.set(s * 7.4, 0.55, 3.4);
      g.add(exhaust);
    }

    // bomb bay doors on the belly — the reason this aeroplane is here
    const bay = new THREE.Mesh(bg(4.6, 0.3, 9.0), cm(0x22262b));
    bay.position.set(0, -0.85, 0.5);
    g.add(bay);

    if (opts.gear !== false) addGear(g, [[0, -hz * 0.5], [-6.5, hz * 0.18], [6.5, hz * 0.18]], 2.6);
    g.userData.airframe = { kind: "bomber", span: SPAN, length: LEN, name: opts.name || "STEALTH BOMBER" };
    return g;
  };

  airbase.fighter = function (opts) {
    opts = opts || {};
    if (opts.primitive !== true) {
      const real = realModel("milModels.jet", { kind: "fighter", span: 9, length: 12.5, name: opts.name || "FIGHTER" });
      if (real) return real;
    }
    const g = new THREE.Group();
    const SPAN = opts.span || 11.6, LEN = opts.length || 17;
    const hx = SPAN / 2, hz = LEN / 2;
    const skin = cm(opts.color != null ? opts.color : M.jet);

    // delta planform: sharp nose, straight leading edge, clipped tips
    const half = [
      0, hz,
      hx * 0.30, hz * 0.10,
      hx, -hz * 0.52,
      hx, -hz * 0.72,
      hx * 0.24, -hz * 0.72,
      0, -hz * 0.86,
    ];
    const pts = half.slice();
    for (let i = half.length - 4; i >= 0; i -= 2) pts.push(-half[i], half[i + 1]);
    const wing = new THREE.Mesh(planform(pts, 0.55), skin);
    wing.castShadow = true;
    g.add(wing);

    // fuselage: a tapered spine sitting on the delta
    const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.25, LEN * 0.86, 8), skin);
    fus.rotation.x = Math.PI / 2;
    fus.position.set(0, 0.7, -hz * 0.06);
    fus.castShadow = true;
    g.add(fus);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.95, 4.4, 8), skin);
    nose.rotation.x = -Math.PI / 2;
    nose.position.set(0, 0.7, -hz * 0.86);
    g.add(nose);

    // bubble canopy
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshLambertMaterial({
      color: M.glass, emissive: 0x122334, emissiveIntensity: 0.8,
    }));
    canopy.scale.set(0.95, 0.8, 2.4);
    canopy.position.set(0, 1.5, -hz * 0.30);
    g.add(canopy);

    // twin canted stabilators + ventral fins — the fighter read at distance
    for (let s = -1; s <= 1; s += 2) {
      const tail = new THREE.Mesh(bg(0.35, 3.6, 3.2), cm(M.jetD));
      tail.position.set(s * 1.9, 2.1, hz * 0.62);
      tail.rotation.z = s * 0.34;
      tail.castShadow = true;
      g.add(tail);
      const rail = new THREE.Mesh(bg(0.4, 0.4, 2.6), cm(M.greyD));
      rail.position.set(s * (hx - 0.5), 0.1, -hz * 0.30);
      g.add(rail);
      const msl = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 3.0, 6), cm(0xd8d3c6));
      msl.rotation.x = Math.PI / 2;
      msl.position.set(s * (hx - 0.5), -0.25, -hz * 0.34);
      g.add(msl);
    }
    // exhaust cans
    for (let s = -1; s <= 1; s += 2) {
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.85, 1.6, 8), cm(0x22262b));
      can.rotation.x = Math.PI / 2;
      can.position.set(s * 0.85, 0.7, hz * 0.80);
      g.add(can);
    }

    if (opts.gear !== false) addGear(g, [[0, -hz * 0.52], [-2.6, hz * 0.12], [2.6, hz * 0.12]], 1.5);
    g.userData.airframe = { kind: "fighter", span: SPAN, length: LEN, name: opts.name || "FIGHTER" };
    return g;
  };

  /* ---- THE REST OF THE MOTOR POOL. No primitive fallback, and that is the
     honest answer: this file never modelled a helicopter, a tank, a truck or
     a transport, so it returns null rather than inventing a fifth one. A
     caller checks the result and simply places nothing — which is exactly
     what a base without city/island_military.js loaded should look like. */
  airbase.heli = function (o) { return realModel("milModels.heli", { kind: "heli", name: (o && o.name) || "HELICOPTER" }); };
  airbase.tank = function (o) { return realModel("milModels.tank", { kind: "tank", name: (o && o.name) || "TANK" }); };
  airbase.truck = function (o) { return realModel("milModels.truck", { kind: "truck", name: (o && o.name) || "TRUCK" }); };
  airbase.cargo = function (o) { return realModel("milModels.cargo", { kind: "cargo", name: (o && o.name) || "TRANSPORT" }); };

  // shared undercarriage: strut + wheel at each [x,z], group sits wheels-down
  function addGear(g, legs, drop) {
    const strutM = cm(M.steelD), tireM = cm(M.tire);
    for (let i = 0; i < legs.length; i++) {
      const x = legs[i][0], z = legs[i][1];
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, drop, 6), strutM);
      strut.position.set(x, -drop / 2, z);
      g.add(strut);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.5, 10), tireM);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, -drop, z);
      g.add(wheel);
    }
    g.userData.gearDrop = drop + 0.62;
  }

  // ---------------------------------------------------------------- BUILD
  /* THE LAYOUT IS NOT AUTHORED HERE ANY MORE. world/basekit.js plans every
     military base in the repo (CBZ.basePlan) and raises its structures
     (CBZ.baseKit.raise) — Fort Brandt in the shipped world and this portable
     field are the same plan at two sizes. This function owns only what is
     portable about it: the slab on rough ground, the rotation, the colliders
     in world space, and seating the aeroplanes on their wheels. */
  airbase.build = function (opts) {
    opts = opts || {};
    const CX = opts.x || 0, CZ = opts.z || 0;
    const HEAD = opts.heading || 0;                       // runway bearing, radians
    const groundAt = opts.groundAt || function () { return 0; };
    if (!CBZ.basePlan || !CBZ.baseKit || !CBZ.baseKit.raise) {
      console.warn("[airbase] world/basekit.js is not loaded; no base to build");
      return null;
    }

    const RW_LEN = opts.runwayLength || 1800;
    const PAD_L = RW_LEN + 240, PAD_W = 760;

    // THE PAD (see header): find the highest ground under the footprint and
    // stand the whole installation on a slab at that height.
    let padY = -Infinity;
    for (let i = -6; i <= 6; i++) for (let j = -3; j <= 3; j++) {
      const lx = (i / 6) * (PAD_L / 2), lz = (j / 3) * (PAD_W / 2);
      const wx = CX + lx * Math.cos(HEAD) + lz * Math.sin(HEAD);
      const wz = CZ - lx * Math.sin(HEAD) + lz * Math.cos(HEAD);
      const h = groundAt(wx, wz);
      if (h > padY) padY = h;
    }
    if (!isFinite(padY)) padY = 0;
    padY += 0.6;

    const root = new THREE.Group();
    root.position.set(CX, padY, CZ);
    root.rotation.y = HEAD;
    root.name = "airbase";
    (opts.parent || CBZ.scene).add(root);

    // ---- LOCAL → WORLD, and it must be THREE's rotation, not a plausible
    // one. `root.rotation.y = HEAD` builds the matrix
    //        [  cos 0 sin ]
    //        [   0  1  0  ]
    //        [ -sin 0 cos ]
    // so local +X lands on world (cos, −sin) and local +Z on (sin, cos).
    // Writing (cos, +sin) / (−sin, cos) instead is a REFLECTION, and every
    // landmark and collider went through it together, so nothing looked wrong
    // until a camera pointed at a hangar photographed empty apron.
    const cosH = Math.cos(HEAD), sinH = Math.sin(HEAD);
    function wx(lx, lz) { return CX + lx * cosH + lz * sinH; }
    function wz(lx, lz) { return CZ - lx * sinH + lz * cosH; }
    // A rotated box has no exact AABB; take the box's own extent along the
    // world axes (exact for an axis-aligned base, a slight over-block at 45°).
    function solidAt(lx, lz, w, d, y0, y1, tag) {
      const cx = wx(lx, lz), cz = wz(lx, lz);
      const ew = (Math.abs(cosH) * w + Math.abs(sinH) * d) / 2;
      const ed = (Math.abs(sinH) * w + Math.abs(cosH) * d) / 2;
      return collide({
        minX: cx - ew, maxX: cx + ew, minZ: cz - ed, maxZ: cz + ed,
        y0: y0 != null ? padY + y0 : undefined, y1: y1 != null ? padY + y1 : undefined,
        tag: tag || "base",
      });
    }

    const P = CBZ.basePlan({
      hx: PAD_L / 2, hz: PAD_W / 2, northGate: null, runwayLength: RW_LEN,
      fighters: Math.max(0, C.AIRBASE_FIGHTERS | 0), hangars: 4,
    });
    const base = {
      root: root, x: CX, z: CZ, y: padY, heading: HEAD,
      parked: [], hangars: [], props: [],
      pad: { length: PAD_L, width: PAD_W },
      groundY: padY, plan: P,
    };

    // ---- the slab + its skirt (the painted skin sits on its top face)
    (function pad() {
      const slab = new THREE.Mesh(bg(PAD_L, 1.2, PAD_W), cm(M.concrete));
      slab.position.set(0, -0.6, 0);
      slab.receiveShadow = true;
      root.add(slab);
      const skirt = new THREE.Mesh(bg(PAD_L + 26, 18, PAD_W + 26), cm(M.sand));
      skirt.position.set(0, -10, 0);
      root.add(skirt);
    })();

    // ---- THE PLAN, RAISED: ground skin, shelters, hangars, tower, fuel farm,
    //      sheds, revetments, igloos, range, towers, HESCO
    const axis = Math.abs(Math.sin(2 * HEAD)) < 1e-6;
    const out = CBZ.baseKit.raise(P, {
      root: root, y: 0, worldY: padY, groundLift: 0.03, res: 2048,
      axisAligned: axis, ladders: false,
      toWorld: function (lx, lz) { return { x: wx(lx, lz), z: wz(lx, lz) }; },
      solid: solidAt,
    });
    base.groundMesh = out.ground || null;

    // ---- the runway, both conventions published once
    (function runway() {
      // This base lays out along local +X, so a heading here means "the runway
      // points at (cos H, −sin H)". systems/airframe.js puts the nose down
      // local −Z, so the SAME direction is a different number to an aeroplane:
      const AIR_HEAD = Math.atan2(-Math.cos(HEAD), Math.sin(HEAD));
      const R = P.runway, RZ = R.z;
      base.runway = {
        length: R.len, width: R.w,
        heading: HEAD,          // base convention: runway runs toward (cos,−sin)
        airHeading: AIR_HEAD,   // airframe convention: hand this to af.place()
        cx: wx(0, RZ), cz: wz(0, RZ), y: padY,
        startX: wx(R.x0 + 60, RZ), startZ: wz(R.x0 + 60, RZ),
        endX: wx(R.x1 - 60, RZ), endZ: wz(R.x1 - 60, RZ),
      };
      const az = (P.apron.z0 + P.apron.z1) / 2, ax = (P.apron.x0 + P.apron.x1) / 2;
      base.apron = { x: wx(ax, az), z: wz(ax, az), y: padY };
      P.build.forEach(function (b) {
        if (b.kind === "hangar") base.hangars.push({ lx: b.x, lz: b.z, x: wx(b.x, b.z), z: wz(b.x, b.z) });
      });
      const tw = P.build.filter(function (b) { return b.kind === "tower"; })[0];
      if (tw) base.tower = { x: wx(tw.x, tw.z), z: wz(tw.x, tw.z), y: padY + (out.tower ? out.tower.h : 33) };
    })();

    // ---- the fleet, on the plan's stands. Every airframe this file hands
    //      out points −Z, the plan's yaw is +Z-forward: add π.
    (function park() {
      const SURF = 0.03;                       // the painted skin's top
      const make = {
        fighter: function (i) { return airbase.fighter({ color: i % 2 ? M.jet : M.jetD, name: "FIGHTER " + (i + 1) }); },
        b2: function () { return airbase.bomber({}); },
        bomber: function () { return realModel("milModels.bomber", { kind: "bomber", name: "B-52" }); },
        cargo: function () { return airbase.cargo({ name: "TRANSPORT" }); },
        drone: function () { return realModel("milModels.drone", { kind: "drone", name: "RECON DRONE" }); },
        heli: function (i) { return airbase.heli({ name: "HELO " + (i + 1) }); },
        attackHeli: function () { return realModel("milModels.attackHeli", { kind: "heli", name: "GUNSHIP" }) || airbase.heli({ name: "GUNSHIP" }); },
        tank: function (i) { return airbase.tank({ name: "TANK " + (i + 1) }); },
        truck: function (i) { return airbase.truck({ name: "TRUCK " + (i + 1) }); },
        ifv: function () { return realModel("milModels.ifv", { kind: "ifv" }); },
        apc: function () { return realModel("milModels.apc", { kind: "apc" }); },
        luv: function () { return realModel("milModels.luv", { kind: "luv" }); },
        patriot: function () { return realModel("milModels.patriot", { kind: "patriot" }); },
        mlrs: function () { return realModel("milModels.mlrs", { kind: "mlrs" }); },
      };
      const D = CBZ.baseKit.DIMS;
      P.stands.forEach(function (s, i) {
        const fn = make[s.kind];
        const g = fn ? fn(i) : null;
        if (!g) return;
        const yaw = (s.yaw || 0) + Math.PI;
        const gy = seat(g, s.x, s.z, SURF, yaw);
        root.add(g);
        const kind = s.kind === "b2" ? "bomber" : s.kind;
        const rec = {
          kind: kind, group: g, x: wx(s.x, s.z), z: wz(s.x, s.z), y: padY + gy,
          heading: HEAD + yaw, airframe: g.userData.airframe, stand: s,
        };
        base.parked.push(rec);
        if (s.kind === "b2" || (s.kind === "bomber" && !base.bomber)) base.bomber = rec;
        const dm = D[s.kind];
        if (dm && !s.shelter) {
          const side = Math.abs(Math.sin(s.yaw || 0)) > 0.5;
          // the solid is the body, not the wing: a span-wide box walls off the apron
          const bw = /fighter|drone|b2|bomber|cargo/.test(s.kind) ? Math.min(dm.w, 9) : dm.w;
          solidAt(s.x, s.z, side ? dm.l : bw, side ? bw : dm.l, 0, 5, /heli/.test(s.kind) ? "heli" : "aircraft");
        }
      });
    })();

    // ---- the wire: instanced posts, chain-link fabric, one gate on the east face
    (function fence() {
      const HL = PAD_L / 2 - 2, HW = PAD_W / 2 - 2, step = 4, GATE = 14;
      const pts = [];
      const runs = [
        [-HL, -HW, HL, -HW], [-HL, HW, HL, HW], [-HL, -HW, -HL, HW],
        [HL, -HW, HL, -GATE], [HL, GATE, HL, HW],
      ];
      runs.forEach(function (r) {
        const len = Math.hypot(r[2] - r[0], r[3] - r[1]), n = Math.max(1, Math.round(len / step));
        for (let i = 0; i <= n; i++) pts.push([r[0] + (r[2] - r[0]) * i / n, r[1] + (r[3] - r[1]) * i / n]);
        CBZ.baseKit.chainLink(root, r[0], r[1], r[2], r[3], 2.05, 0.1);
        const horiz = Math.abs(r[2] - r[0]) > Math.abs(r[3] - r[1]);
        solidAt((r[0] + r[2]) / 2, (r[1] + r[3]) / 2, horiz ? len : 0.4, horiz ? 0.4 : len, 0, 2.4, "fence");
      });
      const posts = new THREE.InstancedMesh(bg(0.14, 2.4, 0.14), cm(M.steelD), pts.length);
      const d = new THREE.Object3D();
      pts.forEach(function (p, i) { d.position.set(p[0], 1.2, p[1]); d.updateMatrix(); posts.setMatrixAt(i, d.matrix); });
      posts.instanceMatrix.needsUpdate = true; posts.castShadow = true;
      root.add(posts);
      base.gate = { x: wx(HL, 0), z: wz(HL, 0) };
    })();

    // ---- where a player standing at this base begins: off the bomber's
    //      quarter on the open ground behind the flight line, already LOOKING
    //      at it. Derived from the two positions, so moving either keeps the gaze.
    (function spawn() {
      const b = base.bomber;
      const s = b && b.stand ? b.stand : { x: 0, z: P.apron.z0 };
      const lx = s.x + 40, lz = P.apron.z0 - 7;
      const sx = wx(lx, lz), sz = wz(lx, lz);
      const dx = (b ? b.x : CX) - sx, dz = (b ? b.z : CZ) - sz;
      base.spawn = { x: sx, z: sz, y: padY, heading: Math.atan2(-dx, -dz) };
    })();
    base.ground = function () { return padY; };
    base.contains = function (x, z) {
      const dx = x - CX, dz = z - CZ;
      // inverse of wx/wz above: [cos −sin; sin cos]
      const lx = dx * cosH - dz * sinH, lz = dx * sinH + dz * cosH;
      return Math.abs(lx) <= PAD_L / 2 && Math.abs(lz) <= PAD_W / 2;
    };
    // the ground height a walker should stand on here: the pad inside the
    // fence, natural terrain outside it. One function, no seam to remember.
    base.floorAt = function (x, z, fallback) {
      return base.contains(x, z) ? padY : (fallback != null ? fallback : groundAt(x, z));
    };

    airbase.last = base;
    (airbase.all = airbase.all || []).push(base);
    return base;
  };

  CBZ.airbaseAudit = function () {
    const all = airbase.all || [];
    return {
      bases: all.length,
      parked: all.reduce(function (n, b) { return n + b.parked.length; }, 0),
      hangars: all.reduce(function (n, b) { return n + b.hangars.length; }, 0),
      last: all.length ? { x: airbase.last.x, z: airbase.last.z, y: airbase.last.y } : null,
    };
  };
})();
