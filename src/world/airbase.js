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

   Flags: AIRBASE_V1 (master), AIRBASE_FIGHTERS, AIRBASE_LIGHTS.
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
  if (C.AIRBASE_LIGHTS == null) C.AIRBASE_LIGHTS = true;
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
  airbase.build = function (opts) {
    opts = opts || {};
    const CX = opts.x || 0, CZ = opts.z || 0;
    const HEAD = opts.heading || 0;                       // runway bearing, radians
    const groundAt = opts.groundAt || function () { return 0; };
    // seed 0 is a seed. Swept up with the gearDrop fix below: the other `||`
    // defaults in this function guard dimensions (a 0 m runway is not a
    // request) or already default to 0, so this was the only other one where
    // a falsy value the caller meant could be silently overruled.
    const rng = CBZ.seedStream ? CBZ.seedStream(opts.seed != null ? opts.seed : "airbase") : Math.random;
    const rr = function (a, b) { return a + rng() * (b - a); };

    const RW_LEN = opts.runwayLength || 1800;
    const RW_W = 60;
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
    // Writing the "obvious" (cos, +sin) / (−sin, cos) instead is not a
    // rotation at all — it is a REFLECTION about the base's own axis, and
    // because every published landmark and every collider went through it
    // together, nothing looked wrong: the spawn was still the right distance
    // from the bomber, the pad still contained the runway. They were all
    // just mirrored off the meshes they described. What actually gives it
    // away is a camera: point one at base.hangars[1] and you photograph
    // empty apron, because the hangar is on the other side.
    const cosH = Math.cos(HEAD), sinH = Math.sin(HEAD);
    function wx(lx, lz) { return CX + lx * cosH + lz * sinH; }
    function wz(lx, lz) { return CZ - lx * sinH + lz * cosH; }
    // A rotated box has no exact AABB; use the circumscribed square, which
    // over-blocks by at most 41% on a 45° base and never lets you inside a
    // hangar wall. Bases are placed axis-ish in practice, so this is cheap
    // honesty rather than a compromise.
    function solidAt(lx, lz, w, d, y0, y1, tag) {
      const R = Math.max(w, d) / 2 * (Math.abs(cosH) + Math.abs(sinH)) * 0.5 + Math.min(w, d) / 2 * 0.5;
      const cx = wx(lx, lz), cz = wz(lx, lz);
      const ew = (Math.abs(cosH) * w + Math.abs(sinH) * d) / 2;
      const ed = (Math.abs(sinH) * w + Math.abs(cosH) * d) / 2;
      return collide({
        minX: cx - ew, maxX: cx + ew, minZ: cz - ed, maxZ: cz + ed,
        y0: y0 != null ? padY + y0 : undefined, y1: y1 != null ? padY + y1 : undefined,
        tag: tag || "base", _r: R,
      });
    }

    const base = {
      root: root, x: CX, z: CZ, y: padY, heading: HEAD,
      parked: [], hangars: [], props: [],
      pad: { length: PAD_L, width: PAD_W },
      groundY: padY,
    };

    // ---- the slab + its skirt
    (function pad() {
      const slab = new THREE.Mesh(bg(PAD_L, 1.2, PAD_W), cm(M.concrete));
      slab.position.set(0, -0.6, 0);
      slab.receiveShadow = true;
      root.add(slab);
      const skirt = new THREE.Mesh(bg(PAD_L + 26, 18, PAD_W + 26), cm(M.sand));
      skirt.position.set(0, -10, 0);
      root.add(skirt);
    })();

    // ---- runway, threshold bars, centreline, edge lights
    (function runway() {
      // THE CONVENTION SEAM, PUBLISHED ONCE. This file lays a base out along
      // its local +X, so a heading here means "the runway points at
      // (cos H, sin H)". systems/airframe.js puts the nose down local −Z, so
      // the SAME direction is a different number to an aeroplane. Every
      // caller that ever put an aircraft on this runway had to re-derive
      // that conversion, and the first one to get it wrong took off across
      // the runway instead of down it. So the base states both.
      // runway runs toward (cos HEAD, −sin HEAD); an airframe's nose is −Z,
      // i.e. (−sin h, −cos h). Solving the two gives:
      const AIR_HEAD = Math.atan2(-Math.cos(HEAD), Math.sin(HEAD));

      const rw = new THREE.Mesh(bg(RW_LEN, 0.5, RW_W), cm(M.runway));
      rw.position.set(0, 0.25, -PAD_W * 0.22);
      rw.receiveShadow = true;
      root.add(rw);
      const RZ = rw.position.z;
      base.runway = {
        length: RW_LEN, width: RW_W,
        heading: HEAD,          // base convention: runway runs toward (cos,sin)
        airHeading: AIR_HEAD,   // airframe convention: hand this to af.place()
        cx: wx(0, RZ), cz: wz(0, RZ), y: padY,
        startX: wx(-RW_LEN / 2 + 60, RZ), startZ: wz(-RW_LEN / 2 + 60, RZ),
        endX: wx(RW_LEN / 2 - 60, RZ), endZ: wz(RW_LEN / 2 - 60, RZ),
      };

      const paint = cm(M.paint, { emissive: 0x2a2a24, ei: 0.35 });
      // centreline dashes — one instanced mesh
      const n = Math.floor(RW_LEN / 60);
      const dash = new THREE.InstancedMesh(bg(30, 0.06, 1.6), paint, n);
      const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        mtx.compose(v.set(-RW_LEN / 2 + 30 + i * 60, 0.53, RZ), q, s);
        dash.setMatrixAt(i, mtx);
      }
      dash.instanceMatrix.needsUpdate = true;
      dash.frustumCulled = false;
      root.add(dash);

      // threshold piano keys at both ends
      const keys = new THREE.InstancedMesh(bg(26, 0.06, 4), paint, 16);
      let k = 0;
      for (let e = -1; e <= 1; e += 2) for (let i = 0; i < 8; i++) {
        const off = (i - 3.5) * 6.4;
        mtx.compose(v.set(e * (RW_LEN / 2 - 30), 0.53, RZ + off), q, s);
        keys.setMatrixAt(k++, mtx);
      }
      keys.instanceMatrix.needsUpdate = true;
      keys.frustumCulled = false;
      root.add(keys);

      // edge lights — a runway you can find at night is the whole point
      if (C.AIRBASE_LIGHTS) {
        const cnt = Math.floor(RW_LEN / 50) * 2;
        const lights = new THREE.InstancedMesh(
          new THREE.SphereGeometry(0.7, 5, 4),
          new THREE.MeshBasicMaterial({ color: 0xfff0b0 }), cnt);
        let li = 0;
        for (let i = 0; i * 50 < RW_LEN && li < cnt - 1; i++) {
          const x = -RW_LEN / 2 + i * 50;
          mtx.compose(v.set(x, 1.1, RZ - RW_W / 2 - 2), q, s); lights.setMatrixAt(li++, mtx);
          mtx.compose(v.set(x, 1.1, RZ + RW_W / 2 + 2), q, s); lights.setMatrixAt(li++, mtx);
        }
        lights.count = li;
        lights.instanceMatrix.needsUpdate = true;
        lights.frustumCulled = false;
        root.add(lights);
      }

      // taxiway linking runway to apron
      const taxi = new THREE.Mesh(bg(RW_LEN * 0.72, 0.4, 26), cm(M.tarmac));
      taxi.position.set(0, 0.3, RZ + RW_W / 2 + 70);
      root.add(taxi);
      for (let s2 = -1; s2 <= 1; s2 += 2) {
        const link = new THREE.Mesh(bg(26, 0.4, 140), cm(M.tarmac));
        link.position.set(s2 * RW_LEN * 0.3, 0.3, RZ + RW_W / 2 + 70);
        root.add(link);
      }
    })();

    // ---- apron: where the aeroplanes actually stand
    // An aeroplane stands on the apron's TOP FACE, not on its centre and not
    // on the pad slab underneath it — three surfaces within half a metre of
    // each other, which is exactly the spread a hand-tuned constant gets
    // wrong. Derive the top from the geometry that defines it and hand THAT
    // to seat(), so the slab and the aircraft on it can never drift apart.
    const APRON_Z = -PAD_W * 0.22 + RW_W / 2 + 190;
    const APRON_Y = 0.32, APRON_H = 0.45, APRON_TOP = APRON_Y + APRON_H / 2;
    (function apron() {
      const ap = new THREE.Mesh(bg(RW_LEN * 0.66, APRON_H, 210), cm(M.tarmac));
      ap.position.set(0, APRON_Y, APRON_Z);
      ap.receiveShadow = true;
      root.add(ap);
      base.apron = { x: wx(0, APRON_Z), z: wz(0, APRON_Z), y: padY };
    })();

    // ---- hangars, tower, fuel farm, radar, barracks
    (function structures() {
      const HZ = APRON_Z + 150;
      const wall = cm(M.olive), roofM = cm(M.greyD);
      for (let i = 0; i < 4; i++) {
        const hx = (i - 1.5) * 190;
        const hgr = new THREE.Group();
        hgr.position.set(hx, 0, HZ);
        const shell = new THREE.Mesh(new THREE.CylinderGeometry(34, 34, 120, 14, 1, false, 0, Math.PI), roofM);
        shell.rotation.z = Math.PI / 2;
        shell.rotation.y = Math.PI / 2;
        shell.position.y = 0.5;
        shell.castShadow = true;
        hgr.add(shell);
        const back = new THREE.Mesh(bg(70, 34, 2), wall);
        back.position.set(0, 17, 59);
        hgr.add(back);
        const frameL = new THREE.Mesh(bg(6, 30, 3), wall); frameL.position.set(-32, 15, -59); hgr.add(frameL);
        const frameR = new THREE.Mesh(bg(6, 30, 3), wall); frameR.position.set(32, 15, -59); hgr.add(frameR);
        root.add(hgr);
        solidAt(hx, HZ, 70, 120, 0, 34, "hangar");
        base.hangars.push({ lx: hx, lz: HZ, x: wx(hx, HZ), z: wz(hx, HZ) });
      }

      // control tower — the tallest thing on the field, and the landmark a
      // player walking the apron navigates by
      const TX = -RW_LEN * 0.30, TZ = APRON_Z + 120;
      const shaft = new THREE.Mesh(bg(16, 40, 16), cm(M.grey));
      shaft.position.set(TX, 20, TZ);
      shaft.castShadow = true;
      root.add(shaft);
      const cab = new THREE.Mesh(bg(26, 9, 26), cm(M.steelD));
      cab.position.set(TX, 44, TZ);
      cab.castShadow = true;
      root.add(cab);
      const glass = new THREE.Mesh(bg(26.5, 5.5, 26.5), new THREE.MeshLambertMaterial({
        color: M.glass, emissive: 0x18303f, emissiveIntensity: 0.9, transparent: true, opacity: 0.85,
      }));
      glass.position.set(TX, 44.5, TZ);
      root.add(glass);
      const capT = new THREE.Mesh(bg(30, 1.4, 30), cm(M.greyD));
      capT.position.set(TX, 49.4, TZ);
      root.add(capT);
      solidAt(TX, TZ, 16, 16, 0, 50, "tower");
      base.tower = { x: wx(TX, TZ), z: wz(TX, TZ), y: padY + 50 };

      // rotating beacon on the tower cap
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.6, 6, 5), new THREE.MeshBasicMaterial({ color: 0x59ff8a }));
      beacon.position.set(TX, 51, TZ);
      root.add(beacon);
      base.props.push({ kind: "beacon", mesh: beacon });

      // fuel farm
      for (let i = 0; i < 4; i++) {
        const fx = RW_LEN * 0.30 + (i % 2) * 40, fz = APRON_Z + 116 + Math.floor(i / 2) * 44;
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 16, 14), cm(0x8d9683));
        tank.position.set(fx, 8, fz);
        tank.castShadow = true;
        root.add(tank);
        solidAt(fx, fz, 30, 30, 0, 16, "fuel");
      }

      // radar
      const mast = new THREE.Mesh(bg(3, 26, 3), cm(M.steel));
      mast.position.set(RW_LEN * 0.40, 13, APRON_Z + 190);
      root.add(mast);
      const dish = new THREE.Mesh(new THREE.BoxGeometry(22, 7, 1.4), cm(0xc9c6bb));
      dish.position.set(RW_LEN * 0.40, 27, APRON_Z + 190);
      root.add(dish);
      base.props.push({ kind: "radar", mesh: dish });

      // barracks + ops block
      for (let i = 0; i < 5; i++) {
        const bx = -RW_LEN * 0.42 + i * 58, bz = APRON_Z + 205;
        const b = new THREE.Mesh(bg(46, 11, 22), cm(M.oliveD));
        b.position.set(bx, 5.5, bz);
        b.castShadow = true; b.receiveShadow = true;
        root.add(b);
        const rf = new THREE.Mesh(bg(48, 1.4, 24), cm(M.greyD));
        rf.position.set(bx, 11.6, bz);
        root.add(rf);
        solidAt(bx, bz, 46, 22, 0, 12, "barracks");
      }
    })();

    /* ---- HELIPADS AND THE MOTOR POOL ------------------------------------
       An air base is not only fixed wing, and now that the real rotary and
       ground hardware is reachable (CBZ.milModels, published by
       city/island_military.js) there is no reason for the field to be bare.
       Everything here is CONDITIONAL: no city files loaded → no helicopters,
       no tanks, and the base still builds. The pads and the parking bays are
       drawn either way, because a marked-out empty pad reads as a base
       waiting for its aircraft, and a blank apron reads as a mistake. */
    (function fleet() {
      const padMat = cm(M.tarmac), lineMat = cm(M.paint, { emissive: 0x2a2a24, ei: 0.3 });
      const HELI_Z = APRON_Z - 96;
      // the discs stand slightly proud of the apron; their top is its own
      // surface and the helicopters are seated on it, not on the apron
      const HELI_Y = 0.35, HELI_H = 0.4, HELI_TOP = HELI_Y + HELI_H / 2;
      for (let i = 0; i < 4; i++) {
        const hx = RW_LEN * 0.10 + i * 74;
        const pad = new THREE.Mesh(new THREE.CylinderGeometry(24, 24, HELI_H, 20), padMat);
        pad.position.set(hx, HELI_Y, HELI_Z);
        pad.receiveShadow = true;
        root.add(pad);
        // the H every helipad wears, so the circle reads as a landing point
        const bar1 = new THREE.Mesh(bg(3, 0.06, 20), lineMat); bar1.position.set(hx - 6, 0.58, HELI_Z); root.add(bar1);
        const bar2 = new THREE.Mesh(bg(3, 0.06, 20), lineMat); bar2.position.set(hx + 6, 0.58, HELI_Z); root.add(bar2);
        const cross = new THREE.Mesh(bg(12, 0.06, 3), lineMat); cross.position.set(hx, 0.58, HELI_Z); root.add(cross);

        const heli = airbase.heli({ name: "HELO " + (i + 1) });
        if (heli) {
          const yaw = Math.PI + (i % 2 ? 0.3 : -0.3);
          const hy = seat(heli, hx, HELI_Z, HELI_TOP, yaw);
          root.add(heli);
          base.parked.push({
            kind: "heli", group: heli, x: wx(hx, HELI_Z), z: wz(hx, HELI_Z),
            y: padY + hy, heading: HEAD + yaw, airframe: heli.userData.airframe,
          });
          solidAt(hx, HELI_Z, 14, 18, 0, 5, "heli");
        }
      }

      // motor pool: tanks nose-out in a row, trucks staged behind them, the
      // way a real pool lines up so nothing has to be shunted to move one
      const POOL_X = -RW_LEN * 0.44, POOL_Z = APRON_Z - 70;
      const POOL_Y = 0.32, POOL_H = 0.4, POOL_TOP = POOL_Y + POOL_H / 2;
      const apronPool = new THREE.Mesh(bg(240, POOL_H, 120), padMat);
      apronPool.position.set(POOL_X + 90, POOL_Y, POOL_Z);
      apronPool.receiveShadow = true;
      root.add(apronPool);
      for (let i = 0; i < 6; i++) {
        const tx = POOL_X + 18 + i * 34, tz = POOL_Z - 28;
        const t = airbase.tank({ name: "TANK " + (i + 1) });
        if (!t) break;
        const ty = seat(t, tx, tz, POOL_TOP, Math.PI);
        root.add(t);
        solidAt(tx, tz, 9, 12, 0, 4, "tank");
        base.parked.push({ kind: "tank", group: t, x: wx(tx, tz), z: wz(tx, tz), y: padY + ty, heading: HEAD + Math.PI });
      }
      for (let i = 0; i < 5; i++) {
        const tx = POOL_X + 26 + i * 40, tz = POOL_Z + 26;
        const t = airbase.truck({ name: "TRUCK " + (i + 1) });
        if (!t) break;
        const ty = seat(t, tx, tz, POOL_TOP, Math.PI);
        root.add(t);
        solidAt(tx, tz, 8, 14, 0, 4, "truck");
        base.parked.push({ kind: "truck", group: t, x: wx(tx, tz), z: wz(tx, tz), y: padY + ty, heading: HEAD + Math.PI });
      }

      // one transport on the far apron — the thing that brought everyone here
      const cargo = airbase.cargo({ name: "TRANSPORT" });
      if (cargo) {
        const cx = -RW_LEN * 0.30, cz = APRON_Z + 40;
        const cy = seat(cargo, cx, cz, APRON_TOP, Math.PI - 0.4);
        root.add(cargo);
        solidAt(cx, cz, 40, 44, 0, 12, "aircraft");
        base.parked.push({ kind: "cargo", group: cargo, x: wx(cx, cz), z: wz(cx, cz), y: padY + cy, heading: HEAD + Math.PI - 0.4 });
      }
    })();

    // ---- perimeter fence + the one gate (a base is SEALED; that is what
    //      makes the gate mean anything)
    (function fence() {
      const postM = cm(M.fence);
      const HW = PAD_W / 2 + 8, HL = PAD_L / 2 + 8;
      const step = 24;
      const nx = Math.floor(HL * 2 / step), nz = Math.floor(HW * 2 / step);
      const posts = new THREE.InstancedMesh(bg(0.7, 6, 0.7), postM, (nx + nz) * 2 + 4);
      const mesh = new THREE.InstancedMesh(bg(step, 5.4, 0.18),
        new THREE.MeshLambertMaterial({ color: 0x8f959b, transparent: true, opacity: 0.42, side: THREE.DoubleSide }),
        (nx + nz) * 2 + 4);
      const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), qr = new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
      const s = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
      let pi = 0, mi = 0;
      const GATE_X = 0;   // the gate is the pad's south face, centre
      for (let i = 0; i <= nx; i++) {
        const x = -HL + i * step;
        for (let e = -1; e <= 1; e += 2) {
          const z = e * HW;
          if (e > 0 && Math.abs(x - GATE_X) < 30) continue;          // gate gap
          mtx.compose(v.set(x, 3, z), q, s); posts.setMatrixAt(pi++, mtx);
          mtx.compose(v.set(x + step / 2, 3, z), q, s); mesh.setMatrixAt(mi++, mtx);
        }
      }
      for (let i = 0; i <= nz; i++) {
        const z = -HW + i * step;
        for (let e = -1; e <= 1; e += 2) {
          const x = e * HL;
          mtx.compose(v.set(x, 3, z), q, s); posts.setMatrixAt(pi++, mtx);
          mtx.compose(v.set(x, 3, z + step / 2), qr, s); mesh.setMatrixAt(mi++, mtx);
        }
      }
      posts.count = pi; mesh.count = mi;
      posts.instanceMatrix.needsUpdate = true;
      mesh.instanceMatrix.needsUpdate = true;
      posts.frustumCulled = false; mesh.frustumCulled = false;
      root.add(posts); root.add(mesh);

      // guard shack + barrier at the gate
      const shack = new THREE.Mesh(bg(9, 7, 9), cm(M.oliveD));
      shack.position.set(GATE_X + 22, 3.5, HW);
      root.add(shack);
      solidAt(GATE_X + 22, HW, 9, 9, 0, 7, "shack");
      const barrier = new THREE.Mesh(bg(28, 0.7, 0.7), cm(M.warn));
      barrier.position.set(GATE_X, 2.6, HW);
      root.add(barrier);
      base.gate = { x: wx(GATE_X, HW), z: wz(GATE_X, HW) };
    })();

    // ---- the aeroplanes. The bomber gets the centre stand; the fighters
    //      line the apron either side of it, nose-out, the way a real ramp
    //      parks alert aircraft.
    (function park() {
      const bomber = airbase.bomber({});
      // WAS: `bomber.userData.gearDrop || 3.2`, and that `||` is the whole
      // bug — adopt() sets a legitimate 0 for models already standing on
      // their wheels, 0 is falsy, so the real B-2 inherited the PRIMITIVE
      // wing's 3.2 m undercarriage and hovered over the apron. `!= null`
      // would have patched it; measuring the model instead means the next
      // airframe with no gearDrop at all lands on the concrete too.
      const by = seat(bomber, 0, APRON_Z, APRON_TOP, Math.PI);  // nose out, toward the taxiway
      root.add(bomber);
      // hold the RECORD, not an index: the helipads and the motor pool push
      // into base.parked before this runs, so parked[0] is a helicopter now
      const rec = {
        kind: "bomber", group: bomber,
        x: wx(0, APRON_Z), z: wz(0, APRON_Z), y: padY + by,
        heading: HEAD + Math.PI, airframe: bomber.userData.airframe,
      };
      base.parked.push(rec);
      base.bomber = rec;
      // a mission marker on the concrete so the stand reads as THE stand
      const ring = new THREE.Mesh(new THREE.RingGeometry(30, 33, 40, 1), cm(M.warn, { emissive: 0x3a2c05, ei: 0.5 }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(0, 0.56, APRON_Z);
      root.add(ring);

      const NF = C.AIRBASE_FIGHTERS | 0;
      for (let i = 0; i < NF; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const row = Math.floor(i / 2);
        const lx = side * (95 + row * 62);
        const lz = APRON_Z + (row % 2 === 0 ? -34 : 30);
        const f = airbase.fighter({ color: row % 2 ? M.jet : M.jetD, name: "FIGHTER " + (i + 1) });
        // same trap as the bomber above: `gearDrop || 2.1` lifted all eight
        const fy = seat(f, lx, lz, APRON_TOP, Math.PI + side * 0.16);
        root.add(f);
        base.parked.push({
          kind: "fighter", group: f,
          x: wx(lx, lz), z: wz(lx, lz), y: padY + fy,
          heading: HEAD + Math.PI + side * 0.16, airframe: f.userData.airframe,
        });
        // parked aircraft are solid: they read as real and they block you
        solidAt(lx, lz, 14, 18, 0, 5, "aircraft");
      }
    })();

    // ---- where a player standing at this base begins: off the bomber's
    //      starboard quarter, far enough back to see the whole aeroplane
    //      (a 52 m wing filling the screen reads as a wall, not an
    //      aircraft), and already LOOKING at it. Published so a caller
    //      never guesses coordinates — and the heading is derived from the
    //      two positions, so moving either one keeps the gaze correct.
    (function spawn() {
      const sx = wx(52, APRON_Z + 74), sz = wz(52, APRON_Z + 74);
      const b = base.bomber;      // never parked[0] — the pool fills first
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
