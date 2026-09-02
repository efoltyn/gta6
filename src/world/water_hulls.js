/* ============================================================
   src/world/water_hulls.js — THE MARINE HULL REGISTRY + the fleet.

   THE PROBLEM THIS FILE EXISTS TO KILL
   ------------------------------------------------------------
   There was exactly ONE boat hull in this game: makeBoat() (city/playercars.js
   :1409), a 6.2m runabout. And inferStyle() mapped
   /boat|speedboat|jetmax|yacht|dinghy/i ALL onto that same mesh — so a "Yacht"
   and a "Dinghy" were name-regex ALIASES of a runabout, not boats. That is a
   stat fiction with a hull attached to the wrong thing (CLAUDE.md's BLOCK LAW
   bans the flavour where the hull is missing entirely; this was the flavour
   where the hull is a lie).

   THE BLOCK (one line to adopt, degrade-safe, zero ceremony)
   ------------------------------------------------------------
     CBZ.marineHulls.register(key, {label, marque, model, build, hull, feel,
                                    price, deck})
     CBZ.marineHulls.get(key)        -> record | null
     CBZ.marineHulls.buildable(key)  -> true iff the record owns a build()
     CBZ.marineHulls.build(key)      -> THREE.Group (a fresh visual)
     CBZ.marineHulls.feel(key)       -> the _playerCarFeel record (marine:true)
     CBZ.marineHulls.spec(key)       -> the frozen physics record (car._hullSpec)
     CBZ.marineHulls.styleFor(name, model) -> key | null   <-- REPLACES the
                                     name-regex aliasing in inferStyle()
     CBZ.marineHulls.keys() / .list()
     CBZ.isMarineHull(car)           -> the ONE "is this a boat" predicate
     CBZ.marineHullAudit()           -> ratchet: remaining name-regex resolvers

   CONSUMERS MIGRATED IN THIS SAME CHANGE (the BLOCK LAW's >= 3):
     1. city/playercars.js inferStyle()  — styleFor() runs BEFORE the regex.
     2. city/playercars.js makeProcedural() — builds registered hulls.
     3. city/playercars.js FEEL lookup   — falls back to marineHulls.feel().
     4. world/water_buoyancy.js          — reads car._hullSpec for len/beam/
                                           ride/plane/wave-gain, and its private
                                           isMarine() now calls CBZ.isMarineHull.
     5. world/water_helm.js              — the whole physics model is the spec.
     6. the ECONOMY — three new hulls pushed onto cityEcon.SPECIAL_VEHICLES, so
        they are buyable/garageable/net-worth-bearing with zero new save code.

   THE FLEET (research numbers, not vibes — 1 kn = 0.514444 m/s)
     dinghy   Calanque Tender 15   4.5m  2.0m  0.4m draft   0.7t   35kn
     boat     Speedboat (EXISTING) 6.2m  2.1m  0.5m draft   1.6t   45kn
     cruiser  Bellamar Corsa 46   14.0m  4.2m  1.1m draft  16.0t   32kn
     yacht    Nordholm Aurelia 112 34.0m 7.6m  2.2m draft 260.0t   16kn  <-- SLOW

   ART RULES OBSERVED
   - Every surface routes through playercars.js's OWN material helpers
     (CBZ.cityCarKit: roleMat/sharedMat/glassMat/chromeMat, all on carfx's
     vehicleMat) so the whole fleet uplifts together. There is a self-contained
     fallback kit here ONLY so this file cannot break if that export is absent.
   - Nav lights copy makeBoat()'s EXACT colour/emissive constraints (port red
     r<0.78, starboard green b<0.6 and body b-r<0.045) — those numbers keep the
     lamps outside three separate detector contracts. Do not "clean them up".
   - Every hull's meshes live in a NESTED group, and this file merges them by
     material itself. That is deliberate: city/vehicles.js's buildUnifiedCar
     runs sealSeams() + addInteriorShell() on any style whose name doesn't match
     /motorcycle|helicopter|boat/, and an interior shell inside a 34m yacht
     would be a 6x3x26m black box sitting in the middle of the sun deck. Both
     of those passes only look at root.children, so one level of nesting is the
     whole fix — and doing our own merge keeps the draw-call budget.
   - Determinism: the fleet is fully AUTHORED. No Math.random, no rng draws, no
     hash — a build path with no random numbers is trivially byte-identical.

   FLAGS
     CBZ.CONFIG.WATER_HULLS   (default true)  registry live; false -> styleFor()
                                              returns null and the old regex owns
                                              boats again, nothing is registered
                                              into the economy, no deck rigs.
     CBZ.CONFIG.BOAT_DECKS    (default true)  walkable decks via CBZ.movingPlatform
     CBZ.CONFIG.BOAT_ECONOMY  (default true)  push hulls into SPECIAL_VEHICLES
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.WATER_HULLS == null) CFG.WATER_HULLS = true;
  if (CFG.BOAT_DECKS == null) CFG.BOAT_DECKS = true;
  if (CFG.BOAT_ECONOMY == null) CFG.BOAT_ECONOMY = true;

  const KN = 0.514444;                 // knots -> m/s
  const G = 9.81;

  // ============================================================
  //  0. THE MATERIAL / GEOMETRY KIT
  // ============================================================
  // playercars.js publishes its private builders as CBZ.cityCarKit so the
  // marine fleet draws from the SAME cached materials and geometry as every
  // road car (one chrome, one glass, one cached box per size). The local
  // fallback below exists only so this file degrades instead of throwing if
  // that export is ever missing — it is never the intended path.
  const _mats = new Map(), _boxes = new Map(), _cyls = new Map();
  function K() { return CBZ.cityCarKit || null; }
  function vmat(role, color, opts) {
    if (CBZ.vehicleMat) return CBZ.vehicleMat(role, color, opts);
    if (CBZ.cmat) return CBZ.cmat(color == null ? 0x888888 : color, opts);
    return new THREE.MeshLambertMaterial({ color: color == null ? 0x888888 : color });
  }
  function roleMat(key, role, color, opts) {
    const k = K(); if (k && k.roleMat) return k.roleMat(key, role, color, opts);
    let m = _mats.get(key); if (m) return m;
    m = vmat(role, color, opts); m._shared = true; _mats.set(key, m); return m;
  }
  function sharedMat(key, color, opts) {
    const k = K(); if (k && k.sharedMat) return k.sharedMat(key, color, opts);
    let m = _mats.get(key); if (m) return m;
    opts = opts || {};
    m = new THREE.MeshLambertMaterial({
      color: color,
      emissive: opts.emissive || 0,
      emissiveIntensity: opts.ei == null ? 1 : opts.ei,
      side: opts.double ? THREE.DoubleSide : THREE.FrontSide,
    });
    m._shared = true; _mats.set(key, m); return m;
  }
  function glassMat() {
    const k = K(); if (k && k.glassMat) return k.glassMat();
    return roleMat("mh-glass", "glass", 0x16242e, { emissive: 0x070f15, ei: 0.25, double: true });
  }
  function chromeMat() {
    const k = K(); if (k && k.chromeMat) return k.chromeMat();
    return roleMat("mh-chrome", "chrome", 0xc4ccd4, { emissive: 0x262b31, ei: 0.3 });
  }
  function boxGeo(w, h, d) {
    const k = K(); if (k && k.boxGeo) return k.boxGeo(w, h, d);
    const key = w + "|" + h + "|" + d;
    let g = _boxes.get(key);
    if (!g) { g = new THREE.BoxGeometry(w, h, d); g._shared = true; _boxes.set(key, g); }
    return g;
  }
  // profile points are [z, y] (+ optional per-point width scale) wound
  // CLOCKWISE in (z,y) — the same convention makeBoat()'s prisms use.
  function prismGeo(width, profile) {
    const k = K(); if (k && k.prismGeo) return k.prismGeo(width, profile);
    // Degenerate fallback: a plain box spanning the profile's bounds. Only
    // reachable if playercars.js never loaded, in which case there is no fleet
    // to match anyway.
    let z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of profile) {
      if (p[0] < z0) z0 = p[0]; if (p[0] > z1) z1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    const g = new THREE.BoxGeometry(width, Math.max(0.02, y1 - y0), Math.max(0.02, z1 - z0));
    g.translate(0, (y0 + y1) / 2, (z0 + z1) / 2);
    g._shared = true;
    return g;
  }
  function cylGeo(rt, rb, h, seg) {
    const key = rt + "|" + rb + "|" + h + "|" + seg;
    let g = _cyls.get(key);
    if (!g) { g = new THREE.CylinderGeometry(rt, rb, h, seg); g._shared = true; _cyls.set(key, g); }
    return g;
  }

  function addBox(root, w, h, d, x, y, z, material) {
    const m = new THREE.Mesh(boxGeo(w, h, d), material);
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = false;
    root.add(m);
    return m;
  }
  function addPrism(root, width, profile, y, material) {
    const m = new THREE.Mesh(prismGeo(width, profile), material);
    m.position.y = y || 0;
    m.castShadow = false;
    root.add(m);
    return m;
  }
  function addCyl(root, r, h, x, y, z, material, seg) {
    const m = new THREE.Mesh(cylGeo(r, r, h, seg || 10), material);
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = false;
    root.add(m);
    return m;
  }
  // Rigging authored as "a long box near the mast, then rotate until it looks
  // close" is how a stay or outrigger winds up floating at both ends. This is
  // the marine primitive instead: two real attachment points are the input and
  // the cylinder is solved between them. The audit lives on the unmerged body
  // because finish() deliberately batches same-material meshes afterwards.
  function addTubeBetween(root, a, b, r, material, seg) {
    const p0 = Array.isArray(a) ? new THREE.Vector3(a[0], a[1], a[2]) : new THREE.Vector3(a.x, a.y, a.z);
    const p1 = Array.isArray(b) ? new THREE.Vector3(b[0], b[1], b[2]) : new THREE.Vector3(b.x, b.y, b.z);
    const delta = p1.clone().sub(p0), len = delta.length();
    const audit = root.userData.marineRigAudit || (root.userData.marineRigAudit = { anchors: 0, segments: 0, gaps: 0 });
    if (!(len > 0.001)) { audit.gaps++; return null; }
    const m = new THREE.Mesh(cylGeo(r, r, len, seg || 8), material);
    m.position.copy(p0).add(p1).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    m.castShadow = false;
    m.userData.marineRigSegment = true;
    root.add(m);
    audit.anchors += 2;
    audit.segments++;
    return m;
  }

  function declareRoom(root, id, label) {
    const rooms = root.userData.marineRooms || (root.userData.marineRooms = []);
    if (!rooms.some(function (r) { return r.id === id; })) rooms.push({ id: id, label: label || id });
  }
  function markFixture(root, mesh, kind) {
    root.userData.marineFixtureCount = (root.userData.marineFixtureCount || 0) + 1;
    if (mesh) mesh.userData.marineFixture = kind || true;
    return mesh;
  }
  function addFixtureBox(root, kind, w, h, d, x, y, z, material) {
    return markFixture(root, addBox(root, w, h, d, x, y, z, material), kind);
  }
  function addFixtureCyl(root, kind, r, h, x, y, z, material, seg) {
    return markFixture(root, addCyl(root, r, h, x, y, z, material, seg), kind);
  }
  // Compact, human-scale furniture shared by every enclosed boat. These are
  // intentionally low-poly, but their anatomy is explicit: bases meet floors,
  // backs meet seats, tables have pedestals, and screens sit on consoles.
  function addSeat(root, x, y, z, yaw, pad, frame) {
    const g = new THREE.Group();
    g.position.set(x, y, z); g.rotation.y = yaw || 0;
    addBox(g, 0.58, 0.16, 0.58, 0, 0.48, 0, pad);
    addBox(g, 0.58, 0.58, 0.14, 0, 0.78, -0.25, pad);
    addBox(g, 0.10, 0.48, 0.10, 0, 0.24, 0, frame);
    root.add(g);
    return markFixture(root, g, "seat");
  }
  function addTable(root, x, y, z, w, d, top, frame) {
    addBox(root, w, 0.10, d, x, y + 0.75, z, top);
    const leg = addBox(root, 0.16, 0.72, 0.16, x, y + 0.36, z, frame);
    return markFixture(root, leg, "table");
  }
  function addCabinet(root, x, y, z, w, h, d, material) {
    return addFixtureBox(root, "cabinet", w, h, d, x, y + h * 0.5, z, material);
  }
  function addScreen(root, x, y, z, w, h, yaw, material) {
    const m = addFixtureBox(root, "display", w, h, 0.035, x, y, z, material);
    m.rotation.y = yaw || 0;
    return m;
  }
  // An enterable deckhouse. Old boat cabins were closed prisms with dark glass
  // pasted over opaque paint; their collision could have a doorway, but their
  // pixels still showed a solid wall. This draws the actual shell surfaces and
  // leaves a central aft opening. `z0` is aft, `z1` forward.
  function addCabinShell(root, o) {
    const w = o.width, hb = w * 0.5, z0 = o.z0, z1 = o.z1;
    const y0 = o.y0, y1 = o.y1, h = y1 - y0, span = z1 - z0, mid = (z0 + z1) * 0.5;
    const body = o.body, liner = o.liner || o.body, glass = o.glass;
    const doorW = Math.min(o.doorW || 1.10, w * 0.48);
    const lowerH = h * 0.30, upperH = h * 0.18, winH = h * 0.42;
    const winY = y0 + h * 0.57;
    addBox(root, w, 0.16, span, 0, y1 - 0.08, mid, body);            // landed roof
    [1, -1].forEach(function (side) {
      addBox(root, 0.14, lowerH, span, side * hb, y0 + lowerH * 0.5, mid, liner);
      addBox(root, 0.14, upperH, span, side * hb, y1 - upperH * 0.5, mid, liner);
      addBox(root, 0.07, winH, span * 0.88, side * (hb + 0.015), winY, mid, glass);
      const bays = Math.max(2, Math.min(7, Math.round(span / 2.6)));
      for (let i = 1; i < bays; i++) {
        addBox(root, 0.10, winH + 0.08, 0.08, side * (hb + 0.025), winY, z0 + (span * i) / bays, liner);
      }
    });
    // Aft wall pieces stop at the doorway; the glass sliders are parked to the
    // sides, making the opening visible from the cockpit as well as walkable.
    const sideW = Math.max(0.18, (w - doorW) * 0.5);
    [1, -1].forEach(function (side) {
      addBox(root, sideW, h, 0.14, side * (doorW * 0.5 + sideW * 0.5), y0 + h * 0.5, z0, body);
      addBox(root, doorW * 0.46, h * 0.68, 0.055, side * (doorW * 0.52), y0 + h * 0.40, z0 - 0.075, glass);
    });
    addBox(root, doorW, h * 0.18, 0.14, 0, y1 - h * 0.09, z0, liner); // doorway header
    // Forward face: low dash-height coaming, broad screen, light roof header.
    addBox(root, w, lowerH, 0.14, 0, y0 + lowerH * 0.5, z1, body);
    addBox(root, w * 0.90, winH, 0.075, 0, winY, z1 + 0.015, glass);
    addBox(root, w, upperH, 0.14, 0, y1 - upperH * 0.5, z1, liner);
    return { width: w, z0: z0, z1: z1, y0: y0, y1: y1, doorW: doorW };
  }
  // A railed run of stanchions + a top rail along one side, z0..z1 at x.
  function addRail(root, x, z0, z1, y, mat, spacing) {
    const len = Math.abs(z1 - z0), mid = (z0 + z1) * 0.5;
    addBox(root, 0.05, 0.05, len, x, y + 0.92, mid, mat);          // top rail
    addBox(root, 0.04, 0.04, len, x, y + 0.50, mid, mat);          // intermediate
    const step = spacing || 1.6;
    const n = Math.max(2, Math.round(len / step));
    for (let i = 0; i <= n; i++) {
      addBox(root, 0.05, 0.92, 0.05, x, y + 0.46, z0 + (z1 - z0) * (i / n), mat);
    }
  }
  // A flight of steps as VISUAL boxes. The matching walkable decks are authored
  // separately in the deck spec (same numbers) so the geometry and the physics
  // are read off one place in this file.
  function addStairs(root, x, w, zBase, dir, y0, y1, steps, mat) {
    const rise = (y1 - y0) / steps, run = 0.36;
    for (let i = 0; i < steps; i++) {
      addBox(root, w, 0.08, run, x, y0 + rise * (i + 1), zBase + dir * (run * (i + 0.5)), mat);
    }
  }
  // The same flight expressed as movingPlatform decks.
  function stairDecks(out, x, w, zBase, dir, y0, y1, steps) {
    const rise = (y1 - y0) / steps, run = 0.36;
    for (let i = 0; i < steps; i++) {
      out.push({ x: x, z: zBase + dir * (run * (i + 0.5)), w: w, d: run, top: y0 + rise * (i + 1) });
    }
  }

  // ---- OUR OWN MERGE PASS (see the header note) ----------------------------
  function concatGeos(geos) {
    let n = 0;
    for (const g of geos) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
    let at = 0;
    for (const g of geos) {
      pos.set(g.attributes.position.array, at);
      if (g.attributes.normal) nrm.set(g.attributes.normal.array, at);
      at += g.attributes.position.array.length;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    out.computeBoundingSphere();
    return out;
  }
  function mergeByMaterial(grp) {
    const isMesh = (o) => !!(o && o.geometry && o.material && !Array.isArray(o.material));
    const buckets = new Map();
    for (const m of grp.children) {
      if (!isMesh(m) || (m.userData && m.userData.noMerge)) continue;
      const geo = m.geometry;
      // Lightweight/test renderers don't implement geometry baking — skip the
      // whole pass rather than half-merge.
      if (!geo.attributes || !geo.attributes.position || !geo.clone || !geo.applyMatrix4) return;
      const key = m.material.id;
      let list = buckets.get(key);
      if (!list) { list = []; buckets.set(key, list); }
      list.push(m);
    }
    buckets.forEach(function (list) {
      if (list.length < 2) return;
      const copies = [];
      for (const m of list) {
        m.updateMatrix();
        const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        g.applyMatrix4(m.matrix);
        copies.push(g);
      }
      const merged = new THREE.Mesh(concatGeos(copies), list[0].material);
      copies.forEach(function (g) { if (g.dispose) g.dispose(); });
      merged.castShadow = false;
      merged.matrixAutoUpdate = false;
      grp.add(merged);
      for (const m of list) grp.remove(m);
    });
  }
  // Every builder ends here: nest + merge + stamp dims.
  function finish(body, dims) {
    mergeByMaterial(body);
    const root = new THREE.Group();
    root.add(body);
    root.userData.vehicleDims = dims;
    // Fleet liveries are authored identity (working-blue trawler, cream yacht,
    // white sportfisher), not random car paint. playercars.js respects this on
    // procedural clones instead of turning every Captain trawler black.
    root.userData.marineLivery = true;
    root.userData.marineRooms = (body.userData.marineRooms || []).slice();
    root.userData.marineFixtureCount = body.userData.marineFixtureCount || 0;
    root.userData.marineRigAudit = Object.assign({ anchors: 0, segments: 0, gaps: 0 }, body.userData.marineRigAudit || {});
    // The lofted-shell census, so a consumer can ask "is this hull a surface
    // or a pile of boxes" without walking the geometry itself.
    if (body.userData.marineHullAudit) root.userData.marineHullAudit = Object.assign({}, body.userData.marineHullAudit);
    const prop = body.getObjectByName("boat_prop");
    if (prop) root.userData.boatProp = prop;
    return root;
  }

  // ============================================================
  //  1. THE PHYSICS SPEC — derived, not typed twice
  // ============================================================
  // A hull author writes the REAL numbers (LOA, beam, draft, tonnes, top speed
  // in knots) and this derives every coefficient the helm integrates, so
  // nobody ever hand-tunes a drag constant against a top speed again.
  //
  // The drag law (research §A):
  //     R(v) = dragL*v + dragQ*v^2*(1 - 0.55*plane) + waveK*v^2*wf(Fn)
  //     wf(Fn) = exp(-((Fn - 0.5)/0.15)^2)        <- the wave-making HUMP
  //     Fn = v / sqrt(g * Lwl)
  //
  // THE INVERSION THAT MAKES THIS TUNABLE: an author writes two numbers they
  // can actually feel — `accel0` (standstill acceleration at full throttle,
  // m/s^2) and `topKts` — and every coefficient is solved from them:
  //
  //     thrust = accel0                                (drag is 0 at v = 0)
  //     waveK  = humpFrac * thrust / vHump^2           <- "the hump costs you
  //                                                       humpFrac of your
  //                                                       thrust, right AT the
  //                                                       hump"
  //     dragL + dragQ absorb whatever thrust is LEFT at topMs
  //
  // so R(topMs) == thrust identically. A hull's equilibrium speed IS its spec
  // sheet number and nothing can ever run away, while `accel0` alone controls
  // how long it takes to get there. That is why a 260-tonne yacht takes ~27s
  // to work up to 16 knots and a RIB is there in 8 — mass expressed as a
  // number a human can reason about, not as a drag constant nobody can tune.
  //
  // The yacht is the case that proves the model, and it falls out for free:
  // its hump sits at Fn 0.5 -> 8.76 m/s (17.0 kn) and its top speed is 8.23
  // m/s (16.0 kn), so it lives PERMANENTLY on the near side of the hump,
  // paying ~60% of its thrust in wave-making at full power and never planing.
  // No special case anywhere — just its own length and its own spec sheet.
  // ---- THE STABILITY BLOCK -------------------------------------------------
  // world/water_stability.js integrates a real roll ODE and it needs four
  // numbers per hull that nobody was writing down: metacentric height (how
  // stiff she is), the angle of vanishing stability (past which she stays
  // over), how many seconds of green water over the sheer fills her, and how
  // many people she carries. They belong HERE, beside LOA and draft, because
  // they are spec-sheet facts about the hull, not physics-engine tuning.
  //
  // A row may author `hull.stab`. Everything it leaves out comes from this
  // table by key, and a key nobody listed is interpolated off LOA — so a hull
  // added tomorrow still capsizes like something its own size instead of
  // reading zeros.
  const STAB = {
    kayak: { gm: 0.05, phiV: 0.70, swampT: 2, crew: 1 },
    jetski: { gm: 0.25, phiV: 1.00, swampT: 4, crew: 2 },
    skiff: { gm: 0.35, phiV: 0.95, swampT: 5, crew: 3 },
    dinghy: { gm: 0.60, phiV: 1.15, swampT: 20, crew: 4 },
    boat: { gm: 0.90, phiV: 1.25, swampT: 14, crew: 5 },
    console: { gm: 0.90, phiV: 1.20, swampT: 18, crew: 4 },
    pirate_skiff: { gm: 0.50, phiV: 1.05, swampT: 8, crew: 6 },
    sloop: { gm: 0.80, phiV: 2.10, swampT: 40, crew: 4 },   // ballast keel: she comes back
    sportfish: { gm: 1.20, phiV: 1.40, swampT: 50, crew: 6 },
    cruiser: { gm: 1.40, phiV: 1.45, swampT: 60, crew: 8 },
    trawler: { gm: 1.00, phiV: 1.30, swampT: 90, crew: 6 },
    yacht: { gm: 2.40, phiV: 1.90, swampT: 999, crew: 14 },
    yacht46: { gm: 3.00, phiV: 2.00, swampT: 999, crew: 16 },
    yacht88: { gm: 3.00, phiV: 2.00, swampT: 999, crew: 26 },
    yacht156: { gm: 3.00, phiV: 2.00, swampT: 999, crew: 42 },
  };
  // A hull's freeboard is the sheer above the waterline amidships. Authored
  // where the builder knows it; otherwise this curve, which was fitted to the
  // fleet's own drawn sheer heights (RIB 0.49, cruiser 1.16, yacht 2.26).
  function freeboardFor(h) {
    if (h.stab && isFinite(h.stab.freeboard)) return h.stab.freeboard;
    if (isFinite(h.freeboard)) return h.freeboard;
    return Math.max(0.24, Math.min(4.2, 0.16 * Math.pow(h.loa, 0.75)));
  }
  // Seats a row did not author. One at the helm, the rest in pairs working
  // aft down the centre of the boat. y is the PELVIS, which is a seated eye
  // (deckY + 1.24 on a planing hull) less the 0.80 m from hip to eye.
  function deriveSeats(h, spec, crew) {
    const sole = isFinite(h.deckY) ? h.deckY : 0;
    const y = sole + 0.44;
    const helm = spec.helm || { x: 0, y: y + 0.80, z: spec.loa * 0.13 };
    const seats = [{ x: helm.x, y: y, z: helm.z, yaw: 0 }];
    const halfX = Math.max(0.28, spec.beam * 0.22);
    const back = spec.loa * 0.40;
    for (let i = 1; i < crew; i++) {
      const rank = Math.floor((i - 1) / 2) + 1;
      const side = (i % 2) ? 1 : -1;
      const z = Math.max(-back, helm.z - 0.95 - (rank - 1) * 0.85);
      // pairs to port and starboard, and a lone last man on the centreline
      const lone = (i === crew - 1) && (crew % 2 === 0);
      seats.push({ x: lone ? 0 : side * halfX, y: y, z: z, yaw: 0 });
    }
    return seats;
  }
  function deriveStab(key, h, spec) {
    const a = h.stab || {};
    const t = STAB[key] || null;
    const loa = spec.loa;
    const gm = a.gm != null ? a.gm : (t ? t.gm : Math.max(0.05, Math.min(3.2, 0.10 + 0.062 * loa)));
    const phiV = a.phiV != null ? a.phiV : (t ? t.phiV : Math.max(0.70, Math.min(2.0, 0.85 + 0.032 * loa)));
    const swampT = a.swampT != null ? a.swampT : (t ? t.swampT : Math.max(2, Math.min(999, 2 + 3.2 * loa)));
    const crew = Math.max(1, Math.round(a.crew != null ? a.crew : (t ? t.crew : 1 + 0.38 * loa)));
    const seats = (Array.isArray(a.seats) && a.seats.length) ? a.seats.map(function (s) {
      return { x: +s.x || 0, y: +s.y || 0, z: +s.z || 0, yaw: +s.yaw || 0 };
    }) : deriveSeats(h, spec, crew);
    return { gm: gm, phiV: phiV, freeboard: freeboardFor(h), swampT: swampT, crew: crew, seats: seats };
  }

  function deriveSpec(key, h) {
    const loa = h.loa, Lwl = loa * 0.92;
    const topMs = h.topKts * KN;
    const planeMs = h.planeKts != null ? h.planeKts * KN : 0;
    const canPlane = !!h.canPlane;
    const root = Math.sqrt(G * Lwl);
    const vHump = 0.5 * root;
    const fnTop = topMs / root;
    const wfTop = Math.exp(-Math.pow((fnTop - 0.5) / 0.15, 2));
    const planeTop = canPlane ? 1 : 0;

    const thrust = h.accel0;
    const humpFrac = h.humpFrac != null ? h.humpFrac : 0.55;
    const waveK = humpFrac * thrust / (vHump * vHump);
    const waveAtTop = waveK * topMs * topMs * wfTop;
    // Floor at 8%: if an author asks for a hump so big it eats the whole
    // budget, the hull simply tops out a little under its stated speed rather
    // than producing a negative drag coefficient and launching.
    const rest = Math.max(thrust * 0.08, thrust - waveAtTop);
    const linShare = h.linShare != null ? h.linShare : 0.25;
    const dragL = rest * linShare / topMs;
    const dragQ = rest * (1 - linShare) / (topMs * topMs * (1 - 0.55 * planeTop));

    const spec = {
      key: key,
      loa: loa, Lwl: Lwl, beam: h.beam, draft: h.draft, massT: h.massT,
      topMs: topMs, cruiseMs: (h.cruiseKts != null ? h.cruiseKts : h.topKts * 0.8) * KN,
      planeMs: planeMs, canPlane: canPlane,
      reverseMs: topMs * (h.reverseFrac != null ? h.reverseFrac : 0.16),
      vHump: vHump,
      thrust: thrust, dragL: dragL, dragQ: dragQ, waveK: waveK,
      // sway (lateral) damping — Fossen: ~3x surge's linear term, higher
      // quadratic. FINITE: the hull must visibly slip sideways of its heading
      // and recover. That drift IS the boat feel.
      swayL: h.swayL != null ? h.swayL : 1.9,
      swayQ: h.swayQ != null ? h.swayQ : 0.30,
      steerKind: h.steerKind,                    // "thrust" | "rudder"
      steerLock: h.steerLock != null ? h.steerLock : 0.52,
      steerRate: h.steerRate != null ? h.steerRate : 4.5,
      // Class inertia: "big things commit to a turn" is a cap on yaw
      // ACCELERATION (~1/(length^2 * mass)), not just a lower yaw rate.
      yawRate: h.yawRate, yawAccel: h.yawAccel,
      yawDamp: h.yawDamp != null ? h.yawDamp : 1.6,
      // Bow/stern thruster: the yaw rate available BELOW manoeuvring speed,
      // where a rudder has no authority at all. Outboard hulls have none —
      // they pivot by blipping the throttle against the helm, which is exactly
      // how you turn a RIB in a slip.
      thrusterYaw: h.thrusterYaw != null ? h.thrusterYaw : 0,
      // The pivot point is AFT: yaw is applied about a point astern of the CG
      // so the BOW sweeps the wide arc and the stern is the fulcrum.
      pivotAft: h.pivotAft != null ? h.pivotAft : loa * 0.26,
      // trim curve, radians, bow-up positive (research §A: 2.5 -> 7.0 -> 3.0 deg)
      trimRest: (h.trimRestDeg != null ? h.trimRestDeg : 2.5) * Math.PI / 180,
      trimHump: (h.trimHumpDeg != null ? h.trimHumpDeg : 7.0) * Math.PI / 180,
      trimPlane: (h.trimPlaneDeg != null ? h.trimPlaneDeg : 3.0) * Math.PI / 180,
      // Heel: planing powerboats heel INTO the turn (dynamic lift asymmetry
      // loads the inside chine), displacement hulls heel OUT.
      heelSign: h.heelSign, heelGain: h.heelGain != null ? h.heelGain : 0.012,
      maxHeel: h.maxHeel != null ? h.maxHeel : 0.22,
      // Seakeeping (read by water_buoyancy.js): wave-slope-following gain is
      // HIGH for slow/heavy hulls (they sit IN the water and follow the normal)
      // and LOW for fast planing hulls (stiff, they PLOUGH and SLAM).
      rideAbove: h.rideAbove != null ? h.rideAbove : 0.06,
      waveGain: h.waveGain != null ? h.waveGain : 1.0,
      slamV: h.slamV != null ? h.slamV : 3.5,
      // Geometry the boarding / marina / wake layers read.
      deckY: h.deckY, boardY: h.boardY,
      sternOffset: h.sternOffset != null ? h.sternOffset : loa * 0.5,
      // THE HELM STATION, hull-local: where a body drives her from, and the
      // first-person eye (city/view.js) / the take-the-helm walk-up point
      // (city/boatwalk.js). Authored per hull wherever the wheelhouse is
      // somewhere no ratio can know (a flybridge, an upper-deck bridge);
      // derived otherwise from the trawler proportions captain.js already
      // proves reproduce a real wheelhouse (helmZ = loa*0.13 + 0.70). Planing
      // hulls are driven SEATED at a console, displacement hulls STANDING at
      // a wheel — that difference is the eye height.
      helm: h.helm || {
        x: 0,
        y: (h.deckY != null ? h.deckY : 0.8) + (canPlane ? 1.24 : 1.58),
        z: Math.min(loa * 0.130, 6) + 0.70,
      },
      wakeScale: h.wakeScale != null ? h.wakeScale : 1,
      audio: h.audio || "truck",
      topKts: h.topKts, cruiseKts: h.cruiseKts, planeKts: h.planeKts,
      // Paddled/pedalled craft have no engine at all. Consumers that assume
      // one (the boatyard catalog, engine audio, the wake) read this instead
      // of inferring "boat therefore motor".
      engine: h.engine !== false,
    };
    // stab last: it reads the helm station and the beam this object just fixed.
    spec.stab = deriveStab(key, h, spec);
    return spec;
  }

  // ============================================================
  //  2. THE REGISTRY
  // ============================================================
  const REG = new Map();
  const NAME_INDEX = new Map();        // lowercased catalog/label name -> key
  const templates = new Map();

  function register(key, rec) {
    if (!key || !rec) return null;
    rec.key = key;
    rec.spec = deriveSpec(key, rec.hull);
    // the _playerCarFeel record: marine:true is what every downstream branch
    // (vehicles.js isMarineCar, water_buoyancy, this file) reads.
    rec.feel = Object.assign(
      { class: "boat", accel: 1, top: 1, turn: 1, grip: 1, brake: 0.7, drift: 1.4, roll: 0.6 },
      rec.feel || {},
      { marine: true, hull: key }
    );
    REG.set(key, rec);
    NAME_INDEX.set(String(rec.label || key).toLowerCase(), key);
    if (rec.model) NAME_INDEX.set(String(rec.model).toLowerCase(), key);
    return rec;
  }

  function get(key) { return (key && REG.get(key)) || null; }
  function buildable(key) { const r = get(key); return !!(r && r.build); }
  function build(key) {
    const r = get(key);
    if (!r) return null;
    if (!r.build) {
      // Registered for its SPEC only (the existing runabout keeps its own
      // authored builder in playercars.js — see the `boat` record below).
      return CBZ.cityBuildPlayerCarVisual ? CBZ.cityBuildPlayerCarVisual(key) : null;
    }
    let t = templates.get(key);
    if (!t) { t = r.build(); templates.set(key, t); }
    const clone = t.clone(true);
    // clone(true) copies userData by reference, so animated handles still point
    // at the template — re-resolve against THIS instance (same contract
    // makeProcedural uses for the runabout's prop).
    if (t.userData.boatProp) clone.userData.boatProp = clone.getObjectByName("boat_prop");
    clone.userData.vehicleDims = t.userData.vehicleDims;
    return clone;
  }

  // ---- styleFor: what REPLACES the name-regex aliasing ----------------------
  // Resolution order: an explicitly registered detailStyle, then an exact
  // catalog/label name, then class keywords. The keyword tier is split into
  // STRONG words (self-identifying — "yacht" is never a car) and WEAK words
  // that need corroboration from model.body === "boat".
  //
  // THIS SPLIT IS NOT COSMETIC. police.js:2068 registers a vehicle literally
  // named "Police Cruiser" with body:"sedan". A single flat /cruiser/ regex
  // here would turn every squad car in the city into a 14-metre motor yacht.
  // "cruiser" and "boat" are therefore WEAK; only words that cannot name a
  // road car are STRONG. Anything unmatched returns null and playercars.js's
  // legacy regex still owns it — that is the ratchet.
  const PATTERNS = [
    { key: "yacht", strong: /\b(yacht|superyacht|megayacht|motoryacht)\b/i },
    { key: "cruiser", strong: /\b(flybridge|sport\s*cruiser|sportcruiser)\b/i, weak: /\bcruiser\b/i },
    { key: "dinghy", strong: /\b(dinghy|inflatable|rib|tender)\b/i, weak: /\b(skiff|jolly)\b/i },
    { key: "boat", strong: /\b(speedboat|runabout|bowrider|powerboat)\b/i, weak: /\bboat\b/i },
  ];
  function styleFor(name, model) {
    if (CFG.WATER_HULLS === false) return null;
    const ds = model && model.detailStyle;
    if (ds && REG.has(ds)) return ds;
    let n = name;
    if (n == null) n = model && model.name;
    n = String(n || "");
    if (!n) return null;
    const exact = NAME_INDEX.get(n.toLowerCase());
    if (exact) return exact;
    const marine = !!(model && model.body === "boat");
    for (let i = 0; i < PATTERNS.length; i++) {
      const p = PATTERNS[i];
      if (p.strong.test(n)) return p.key;
      if (marine && p.weak && p.weak.test(n)) return p.key;
    }
    return null;
  }

  // ---- CBZ.isMarineHull — the ONE "is this a boat" predicate ---------------
  // Was hand-copied in city/vehicles.js:104 (isMarineCar), water_buoyancy.js:74
  // (isMarine) and about to be a fourth in city/swim.js. Same three-line body
  // every time. This is that body ONCE, plus the registry so a cruiser or a
  // yacht whose _playerCarFeel hasn't been promoted yet still reads marine.
  CBZ.isMarineHull = function (car) {
    if (!car) return false;
    const feel = car._playerCarFeel;
    if (feel) return !!feel.marine;
    if (car._hullSpec) return true;
    const m = car.model;
    if (m) {
      if (m.body === "boat") return true;
      if (m.detailStyle && REG.has(m.detailStyle)) return true;
    }
    return !!(car.detailStyle && REG.has(car.detailStyle));
  };

  // The physics record for a car, resolved and cached on first ask. This is
  // what water_helm.js integrates and water_buoyancy.js reads.
  // Deliberately re-resolved rather than trusting the cached `_hullSpec`: the
  // [C] style-cycler can turn a boat into a road car mid-drive, and a stale
  // marine spec left hanging on a car is exactly the kind of ghost state that
  // makes another package (swim.js reads _hullSpec.loa) do something absurd.
  // Resolution is two map lookups; it is called at most a handful of times a
  // frame. The field is still written so consumers can read it directly.
  function specFor(car) {
    if (!car) return null;
    if (CFG.WATER_HULLS === false) { if (car._hullSpec) car._hullSpec = null; return null; }
    const key = (car.detailStyle && REG.has(car.detailStyle)) ? car.detailStyle
      : (car._playerCarFeel && car._playerCarFeel.hull) ? car._playerCarFeel.hull
      : styleFor(null, car.model);
    const rec = get(key);
    if (!rec) { if (car._hullSpec) car._hullSpec = null; return null; }
    if (car._hullSpec !== rec.spec) car._hullSpec = rec.spec;
    return rec.spec;
  }

  CBZ.marineHulls = {
    register: register,
    get: get,
    buildable: buildable,
    build: build,
    spec: function (key) { const r = get(key); return r ? r.spec : null; },
    // The stability block, by key. Every registered hull has one — authored
    // where a row knows its own numbers, table/LOA-derived otherwise — so a
    // caller never has to carry "if the hull has no stab" defaults of its own.
    stab: function (key) { const r = get(key); return r && r.spec ? r.spec.stab : null; },
    feel: function (key) { const r = get(key); return r ? r.feel : null; },
    label: function (key) { const r = get(key); return r ? r.label : null; },
    styleFor: styleFor,
    specFor: specFor,
    keys: function () { return Array.from(REG.keys()); },
    list: function () { return Array.from(REG.values()); },
  };

  // ============================================================
  //  3. THE FLEET
  // ============================================================
  // Shared palette. Keys are namespaced "mh-" so they never collide with the
  // road fleet's cached singletons, EXCEPT glass/chrome which deliberately
  // reuse the fleet's own (a boat's windscreen is the same glass as a car's).
  const M = {
    hull: () => roleMat("mh-hull", "paint", 0xf1f4f7),        // gelcoat white
    hullDark: () => roleMat("mh-hulldark", "paint", 0x1d2b3a), // navy topsides
    boot: () => sharedMat("mh-boot", 0x14181d),                 // boot stripe / antifoul
    stripe: () => roleMat("mh-stripe", "paint", 0x1574d6),
    // carfx's generic plastic/interior roles intentionally collapse to one
    // dark cabin material. Marine teak, vinyl and headliners need their actual
    // authored colours, so these use the shared Lambert pool directly.
    teak: () => sharedMat("mh-teak", 0xb4885c, { emissive: 0x2b1a0d, ei: 0.20 }),
    teakDk: () => sharedMat("mh-teakdk", 0x8c6743, { emissive: 0x241408, ei: 0.18 }),
    pad: () => sharedMat("mh-pad", 0xd8dde4, { emissive: 0x363b42, ei: 0.30 }),
    liner: () => sharedMat("mh-liner", 0xe7e0d2, { emissive: 0x4a4336, ei: 0.34, double: true }),
    wood: () => sharedMat("mh-wood", 0x6f4b30, { emissive: 0x24150b, ei: 0.22 }),
    screen: () => sharedMat("mh-screen", 0x183b50, { emissive: 0x0d5f7a, ei: 0.72 }),
    warm: () => sharedMat("mh-warm", 0xe8c889, { emissive: 0x9a6830, ei: 0.28 }),
    dark: () => sharedMat("mh-dark", 0x101317),
    grey: () => sharedMat("mh-grey", 0x6d757e, { emissive: 0x121519, ei: 0.18 }),
    tube: () => sharedMat("mh-tube", 0x2b3138),                 // hypalon collar
    glass: glassMat,
    chrome: chromeMat,
    // NAV LIGHTS — colours/emissives copied verbatim from makeBoat():1483-1484.
    // red emissive r < 0.78; green emissive b < 0.6; green BODY colour keeps
    // b-r < 0.045 so it cannot read as glass. Three detector contracts depend
    // on these exact values.
    navPort: () => sharedMat("mh-port", 0x8e1c24, { emissive: 0xb02030, ei: 0.8 }),
    navStbd: () => sharedMat("mh-stbd", 0x28642c, { emissive: 0x1f9e4b, ei: 0.8 }),
    // White stern / masthead lights: deliberately DIM. makeBoat() used plain
    // chrome for its stem light rather than risk a bright white emissive
    // tripping a headlight detector; this keeps that caution while still
    // reading as a lit lamp at night.
    navWhite: () => sharedMat("mh-white", 0xdfe8ee, { emissive: 0x9fb4c0, ei: 0.55 }),
    // LOFTED SHELLS get their own material each, and that is on purpose:
    // mergeByMaterial() only batches meshes that share one, so a unique
    // material keeps the hull surface a single addressable mesh that
    // boat-fleet.mjs can audit. `double` is not decoration either — an OPEN
    // boat is seen from inside, and a FrontSide hull is a hull you can see
    // the sea through from the helm.
    kayakHull: () => sharedMat("mh-kayak", 0xf2761b, { emissive: 0x3a1a04, ei: 0.22 }),
    kayakDeck: () => sharedMat("mh-kayakdk", 0xf9a13c, { emissive: 0x3d2408, ei: 0.20 }),
    pwcHull: () => sharedMat("mh-pwc", 0xf4f7fa, { emissive: 0x3a4148, ei: 0.20 }),
    pwcTrim: () => sharedMat("mh-pwctrim", 0x1a3f8c, { emissive: 0x081733, ei: 0.26 }),
    pwcAccent: () => sharedMat("mh-pwcacc", 0xd8352c, { emissive: 0x3a0b08, ei: 0.24 }),
    alu: () => sharedMat("mh-alu", 0xb9c2c9, { emissive: 0x22272c, ei: 0.20, double: true }),
    pangaHull: () => sharedMat("mh-panga", 0x9fb0b8, { emissive: 0x1b2126, ei: 0.18, double: true }),
    ribHull: () => sharedMat("mh-rib", 0xeef2f6, { emissive: 0x363c42, ei: 0.20, double: true }),
    sbHull: () => sharedMat("mh-speedboat", 0xeceff2, { emissive: 0x343a40, ei: 0.20, double: true }),
    ccHull: () => sharedMat("mh-console", 0xf3f6f8, { emissive: 0x383e44, ei: 0.20, double: true }),
  };

  // A three-blade screw group named "boat_prop" so
  // CBZ.cityUpdatePlayerCarVisual() spins it with zero new code.
  function propGroup(scale, offsets) {
    const g = new THREE.Group();
    g.name = "boat_prop";
    const chrome = M.chrome();
    for (const o of offsets) {
      const sub = new THREE.Group();
      sub.position.set(o[0], o[1], o[2]);
      for (let i = 0; i < 3; i++) {
        const b = new THREE.Mesh(boxGeo(0.05 * scale, 0.44 * scale, 0.14 * scale), chrome);
        b.rotation.z = (i / 3) * Math.PI * 2;
        sub.add(b);
      }
      g.add(sub);
    }
    g.userData.noMerge = true;
    return g;
  }

  // Port red / starboard green at the bow, white astern, white masthead.
  // COLREGs: red to port (+x here), green to starboard (-x) — the same sign
  // convention makeBoat() established.
  function navLights(root, halfBeam, y, zBow, zStern, mastY) {
    const s = Math.max(0.05, halfBeam * 0.024);
    addBox(root, s, s * 0.9, s * 1.4, halfBeam * 0.97, y, zBow, M.navPort());
    addBox(root, s, s * 0.9, s * 1.4, -halfBeam * 0.97, y, zBow, M.navStbd());
    addBox(root, s, s * 0.9, s, 0, y, zStern, M.navWhite());
    if (mastY != null) addBox(root, s, s * 1.2, s, 0, mastY, zBow * 0.35, M.navWhite());
  }

  // ---- THE LOFT BRIDGE -----------------------------------------------------
  // world/hull_loft.js parses immediately before this file and owns the ONE
  // primitive that draws a hull as a surface instead of a stack of prisms.
  // Read lazily and feature-detected at CALL time so a build that drops
  // hull_loft.js still boots (it just gets no lofted hulls).
  function LOFT() { return CBZ.hullLoft || null; }
  // The hull SHELL: one lofted mesh, its own material, its own draw call.
  // Named so tools/visual-presets/boat-fleet.mjs can find the surface it is
  // auditing rather than guessing which merged bucket is the hull.
  function loftHull(root, stations, material, o) {
    const L = LOFT();
    if (!L) return null;
    const m = L.mesh(stations, material, o);
    if (!m) return null;
    m.name = "hull_surface";
    m.castShadow = false;
    m.userData.hullSurface = true;
    // NEVER merged. mergeByMaterial() batches by material id, so the moment a
    // fitting shares the hull's paint the shell stops being an addressable
    // mesh and its `faceted` audit starts measuring boxes bolted to it.
    m.userData.noMerge = true;
    root.add(m);
    const a = L.audit(m.geometry);
    const au = root.userData.marineHullAudit || (root.userData.marineHullAudit = { tris: 0, faceted: 0, surfaces: 0 });
    au.tris += a.tris;
    au.faceted = (au.faceted * au.surfaces + a.faceted) / (au.surfaces + 1);
    au.surfaces++;
    return m;
  }

  // ---- FITTINGS ON A LOFTED SKIN -------------------------------------------
  // outline() answers "where is the SHEER". Everything below the sheer — a
  // boot stripe, a rubbing strake, a hull window, a bow-thruster tunnel, a
  // spray rail — needs "where is the skin at THIS height", and guessing that
  // is how a window ends up floating 8 cm off a hull that got narrower toward
  // the bow. These read it off the same stations the shell was lofted from, so
  // a fitting cannot disagree with the surface it is bolted to.
  function nz(v) { return (typeof v === "number" && isFinite(v)) ? v : 0; }
  function stationX(st, y) {
    const p = st.pts;
    if (y <= p[0][0]) return Math.abs(p[0][1]);
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], c = p[i + 1];
      if (y <= c[0]) {
        const d = c[0] - a[0];
        const f = Math.abs(d) > 1e-6 ? (y - a[0]) / d : 0;
        return Math.abs(a[1]) + (Math.abs(c[1]) - Math.abs(a[1])) * f;
      }
    }
    return Math.abs(p[p.length - 1][1]);
  }
  // Half-width of the lofted skin at (z, y). Clamps to the ends of a section.
  function hullSectionX(stations, z, y) {
    if (!Array.isArray(stations) || !stations.length) return 0;
    const N = stations.length;
    if (N === 1 || z <= stations[0].z) return stationX(stations[0], y);
    if (z >= stations[N - 1].z) return stationX(stations[N - 1], y);
    for (let i = 0; i < N - 1; i++) {
      if (z <= stations[i + 1].z) {
        const dz = stations[i + 1].z - stations[i].z;
        const f = Math.abs(dz) > 1e-6 ? (z - stations[i].z) / dz : 0;
        return stationX(stations[i], y) * (1 - f) + stationX(stations[i + 1], y) * f;
      }
    }
    return stationX(stations[N - 1], y);
  }
  // A run of points ON the skin, z0 -> z1. `y` is a height or a function of z;
  // `outset` pushes the run proud of the plating (a strake stands off, a boot
  // stripe is painted flush). Feed it to CBZ.hullLoft.strip().
  function skinRun(stations, side, z0, z1, y, outset, step) {
    const pts = [];
    const n = Math.max(2, Math.round(Math.abs(z1 - z0) / Math.max(0.05, step || 0.6)));
    for (let i = 0; i <= n; i++) {
      const z = z0 + (z1 - z0) * (i / n);
      const yy = (typeof y === "function") ? y(z) : y;
      pts.push([side * (hullSectionX(stations, z, yy) + (outset || 0)), yy, z]);
    }
    return pts;
  }
  // The CHINE — or, on a round hull, the turn of the bilge: the point each
  // station itself calls the corner. A spray rail goes here and nowhere else.
  function chineRun(stations, side, outset, dy) {
    const pts = [];
    for (const st of stations) {
      const i = (typeof st.chine === "number") ? st.chine : 0;
      const p = st.pts[Math.min(Math.max(0, i), st.pts.length - 1)];
      const x = Math.abs(p[1]);
      if (x < 1e-3) continue;
      pts.push([side * (x + (outset || 0)), p[0] + (dy || 0), st.z + nz(p[2])]);
    }
    return pts;
  }
  function skinNormal(stations, side, z, y) {
    const d = 0.28;
    const Xz = (hullSectionX(stations, z + d, y) - hullSectionX(stations, z - d, y)) / (2 * d);
    const Xy = (hullSectionX(stations, z, y + d) - hullSectionX(stations, z, y - d)) / (2 * d);
    const v = new THREE.Vector3(side, -Xy, -Xz);
    return v.lengthSq() > 1e-9 ? v.normalize() : new THREE.Vector3(side, 0, 0);
  }
  // Face a mesh's local +X along the skin normal while its local +Z keeps
  // running fore-and-aft. setFromUnitVectors on its own is DEGENERATE on the
  // port side — a 180-degree turn has no preferred axis — and stands the panel
  // on end, which is how you get a hull window mounted vertically.
  function orientToSkin(m, n) {
    const X = n.clone().normalize();
    const Z = new THREE.Vector3(0, 0, 1);
    Z.addScaledVector(X, -Z.dot(X));
    if (Z.lengthSq() < 1e-8) { Z.set(0, 1, 0); Z.addScaledVector(X, -X.y); }
    Z.normalize();
    const Y = new THREE.Vector3().crossVectors(Z, X).normalize();
    m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
  }
  // A flat fitting ON the topsides: a hull window, a dark inset panel, a name
  // board. `len` runs fore/aft, `h` is vertical, the face is the skin normal.
  function hullPanel(root, stations, side, z, y, len, h, material, o) {
    o = o || {};
    const x = hullSectionX(stations, z, y) + (o.outset == null ? 0.012 : o.outset);
    const m = addBox(root, o.thick || 0.05, h, len, side * x, y, z, material);
    orientToSkin(m, skinNormal(stations, side, z, y));
    return m;
  }
  // A round fitting ON the topsides: a bow-thruster tunnel, a porthole, an
  // anchor pocket. Its axis is the skin normal, which a bare cylinder cannot
  // be given without composing two rotations by hand and getting one wrong.
  const _axisZ = new THREE.Vector3(0, 0, 1);
  function hullDisc(root, stations, side, z, y, r, material, o) {
    o = o || {};
    const x = hullSectionX(stations, z, y) + (o.outset == null ? 0.01 : o.outset);
    const m = new THREE.Mesh(cylGeo(r, r, o.thick || 0.06, o.seg || 14), material);
    m.position.set(side * x, y, z);
    m.castShadow = false;
    // A cylinder's axis is its local +Y, so the skin basis is composed with a
    // quarter turn that sends +Y to +X FIRST. Parenting it inside a rotated
    // Group would work too and would cost a draw call per porthole, because
    // mergeByMaterial() only ever batches a group's direct mesh children.
    orientToSkin(m, skinNormal(stations, side, z, y));
    m.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(_axisZ, -Math.PI / 2));
    root.add(m);
    return m;
  }
  // A quad-grid SURFACE from rows of points: a bulwark, a side deck that
  // follows the deck edge, a whaleback, a coaming. Every one of those is a
  // ribbon in the real world and a row of stepped boxes in this game, and the
  // stepping is the artefact. rows[i][k] = [x, y, z]; all rows the same length.
  function sheet(root, rows, material, o) {
    o = o || {};
    if (!Array.isArray(rows) || rows.length < 2) return null;
    const cols = rows[0].length;
    if (cols < 2) return null;
    for (const r of rows) if (!r || r.length !== cols) return null;
    const pos = [], uv = [], idx = [];
    for (let i = 0; i < rows.length; i++) {
      for (let k = 0; k < cols; k++) {
        const p = rows[i][k];
        pos.push(p[0], p[1], p[2]);
        uv.push(k / (cols - 1), i / (rows.length - 1));
      }
    }
    for (let i = 0; i < rows.length - 1; i++) {
      for (let k = 0; k < cols - 1; k++) {
        const A = i * cols + k, B = A + 1, C = A + cols, D = C + 1;
        if (o.flip) idx.push(A, B, C, B, D, C);
        else idx.push(A, C, B, B, C, D);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setIndex(idx);
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, material);
    m.castShadow = false;
    root.add(m);
    return m;
  }
  function ribbon(root, lower, upper, material, o) { return sheet(root, [lower, upper], material, o); }
  // A BULWARK: the outboard plate, the inboard liner and the capping, all
  // following the sheer. Two ribbons wound opposite ways is what makes it
  // solid from the deck AND from the water without a double-sided material.
  function bulwark(root, out, side, z0, z1, h, thick, outMat, inMat, capMat, step) {
    const lowO = [], upO = [], lowI = [], upI = [];
    const n = Math.max(3, Math.round(Math.abs(z1 - z0) / Math.max(0.2, step || 0.8)));
    for (let i = 0; i <= n; i++) {
      const z = z0 + (z1 - z0) * (i / n);
      const y = out.sheerYAt(z), hb = out.halfBeamAt(z);
      const xo = side * Math.max(0.05, hb - 0.02), xi = side * Math.max(0.04, hb - 0.02 - thick);
      lowO.push([xo, y - 0.06, z]); upO.push([xo, y + h, z]);
      lowI.push([xi, y - 0.06, z]); upI.push([xi, y + h, z]);
    }
    ribbon(root, lowO, upO, outMat, { flip: side < 0 });
    ribbon(root, lowI, upI, inMat || outMat, { flip: side > 0 });
    ribbon(root, upI, upO, capMat || outMat, { flip: side < 0 });
    return { top: upO };
  }
  // A rail that FOLLOWS the sheer. addRail() draws a straight run at one
  // height: right on a flat sheer, floating at both ends of a real one.
  function sheerRail(root, out, side, z0, z1, dy, material, o) {
    o = o || {};
    const L = LOFT();
    const h = o.height == null ? 0.92 : o.height;
    const inset = o.inset == null ? 0.10 : o.inset;
    const n = Math.max(2, Math.round(Math.abs(z1 - z0) / (o.spacing || 1.7)));
    const top = [], mid = [];
    for (let i = 0; i <= n; i++) {
      const z = z0 + (z1 - z0) * (i / n);
      const x = side * Math.max(0.05, out.halfBeamAt(z) - inset);
      const y = out.sheerYAt(z) + (dy || 0);
      addBox(root, 0.05, h, 0.05, x, y + h * 0.5, z, material);
      top.push([x, y + h, z]);
      mid.push([x, y + h * 0.52, z]);
    }
    if (L) {
      [[top, 0.028], [mid, 0.022]].forEach(function (r) {
        const s = L.strip(r[0], r[1], material, { segments: Math.max(8, n * 4), radial: 5 });
        if (s) { s.castShadow = false; root.add(s); }
      });
    }
    return top;
  }
  // A RAKED STEM, expressed the way the loft already expresses a raked
  // transom: a per-point z offset on the forward stations. Positive `rake`
  // leans the top of the stem AFT — the reverse/plumb-negative stem every
  // modern sport cruiser wears; negative leans it forward.
  function rakeStem(stations, rake, reach) {
    const N = stations.length;
    if (N < 2 || !(Math.abs(rake) > 1e-4)) return stations;
    const z1 = stations[N - 1].z, z0 = stations[0].z;
    const span = Math.max(0.001, Math.abs(z1 - z0) * (reach == null ? 0.28 : reach));
    const t = Math.tan(rake);
    for (const st of stations) {
      const f = clampN((st.z - (z1 - span)) / span, 0, 1);
      if (f <= 0) continue;
      const yk = st.pts[0][0];
      for (const p of st.pts) p[2] = nz(p[2]) - (p[0] - yk) * t * f * f;
    }
    return stations;
  }
  // ROUND FORWARD, HARD-CHINED AFT — every semi-displacement hull ever drawn.
  // stationsFromLines() takes ONE bilge exponent for the whole boat, so this
  // re-solves each station's bilge curve with its own exponent, blended along
  // the length. The point COUNT and the chine index are untouched, so the
  // loft's quad grid survives; only the shape of the turn changes.
  function warpBilge(stations, nAft, nFwd, t0, t1) {
    const N = stations.length;
    for (let i = 0; i < N; i++) {
      const st = stations[i], p = st.pts;
      if (typeof st.chine !== "number" || st.chine < 2) continue;
      const t = N > 1 ? i / (N - 1) : 0;
      const u = clampN((t - t0) / Math.max(1e-3, t1 - t0), 0, 1);
      const nb = Math.max(1.2, nAft + (nFwd - nAft) * (u * u * (3 - 2 * u)));
      const c = st.chine, ym = p[c][0], xm = Math.abs(p[c][1]), yk = p[0][0];
      if (!(xm > 1e-4) || !(ym - yk > 1e-4)) continue;
      for (let k = 0; k <= c; k++) {
        const fr = k / c;
        p[k][1] = xm * fr;
        p[k][0] = ym - (ym - yk) * Math.pow(Math.max(0, 1 - Math.pow(fr, nb)), 1 / nb);
      }
    }
    return stations;
  }

  // ---- THE OUTBOARD --------------------------------------------------------
  // Every open boat in the fleet had its own four-boxes-on-the-transom motor,
  // and every one of them was a different shape. An outboard is a real object:
  // a cowl, a mid-section, a gearcase with a torpedo bullet, an anti-
  // ventilation plate, a skeg and a tilt bracket bolted to the transom. This
  // is that object once, sized off horsepower.
  //
  // It deliberately does NOT add the screw: propGroup() names its group
  // "boat_prop" and cityUpdatePlayerCarVisual resolves that name ONCE, so a
  // twin-engine boat must build ONE prop group with two offsets. outboard()
  // therefore returns where its screw goes and the caller collects them.
  // `y` IS THE ANTI-VENTILATION PLATE, and that is the whole point of the
  // signature: on a real boat that plate sits level with the hull's bottom at
  // the transom, and the shaft length is chosen to put it there. Pass the
  // hull's KEEL height at the stern (outline().keelYAt) and the motor mounts
  // itself correctly on any transom instead of being nudged until it looks
  // right — which is how the fleet ended up with props spinning in mid-air
  // half a metre above the water.
  function outboard(root, x, y, z, hp) {
    // TWO SCALES, and conflating them is what buried the last motor inside the
    // transom: an outboard's POWERHEAD grows with horsepower, but its SHAFT
    // does not — 15", 20" and 25" are the only lengths there are, and a 40 hp
    // and a 300 hp on the same transom put their cavitation plates in exactly
    // the same place. So girth scales with hp^(1/3) and the leg is a constant
    // 0.72 m from the plate up to the mounting bracket.
    const s = clampN(Math.pow(Math.max(2, hp || 90) / 90, 1 / 3), 0.6, 1.5);
    const SHAFT = 0.72;
    const cowl = M.dark(), leg = M.grey(), plate = M.chrome();
    const g = new THREE.Group();
    g.position.set(x || 0, y || 0, z || 0);
    // gearcase: a torpedo with a skeg, not a slab
    const bullet = addCyl(g, 0.072 * s, 0.50 * s, 0, -0.12 * s, -0.06 * s, leg, 10);
    bullet.rotation.x = Math.PI / 2;
    addBox(g, 0.11 * s, 0.24 * s, 0.30 * s, 0, 0.02 * s, -0.02 * s, leg);
    addBox(g, 0.28 * s, 0.022 * s, 0.32 * s, 0, 0, -0.06 * s, plate);            // anti-vent plate
    addBox(g, 0.042 * s, 0.19 * s, 0.20 * s, 0, -0.25 * s, 0.02 * s, leg);       // skeg
    // the leg: a fixed-length column from the plate up to the transom bracket
    addBox(g, 0.15 * s, SHAFT - 0.08, 0.22 * s, 0, 0.06 + (SHAFT - 0.08) * 0.5, -0.02 * s, leg);
    addBox(g, 0.30 * s, 0.34, 0.10, 0, SHAFT - 0.04, 0.15 * s, plate);           // transom bracket
    addCyl(g, 0.035, 0.30 * s, 0, SHAFT - 0.04, 0.15 * s, plate, 8).rotation.z = Math.PI / 2;
    // powerhead
    addBox(g, 0.42 * s, 0.09, 0.56 * s, 0, SHAFT + 0.10, -0.06 * s, leg);        // lower pan
    addBox(g, 0.40 * s, 0.42 * s, 0.54 * s, 0, SHAFT + 0.16 + 0.21 * s, -0.06 * s, cowl);
    root.add(g);
    return {
      group: g, scale: s,
      propAt: [x || 0, (y || 0) - 0.12 * s, (z || 0) - 0.34 * s],
      top: (y || 0) + SHAFT + 0.16 + 0.42 * s,
    };
  }
  function clampN(v, a, b) { return v < a ? a : (v > b ? b : v); }

  // ============================================================
  //  3b. THE KIT — the drawing surface every OTHER hull author uses
  // ============================================================
  // BLOCK LAW. city/yachts.js needs exactly the helpers above: the same cached
  // materials (or it becomes raw-material construction #567), the same cached
  // box/prism/cylinder geometry, the same rail/stair grammar, the same
  // merge-by-material pass that keeps a whole vessel inside a handful of draw
  // calls, and the same `finish()` nesting that stops city/vehicles.js's
  // buildUnifiedCar dropping a black interior shell inside a superyacht.
  //
  // Publishing it is what makes a new hull a ROW rather than a second copy of
  // this file. It is deliberately the PRIVATE surface verbatim — no wrapper, no
  // adapter — so a consumer that draws through it draws exactly what the fleet
  // below draws.
  //
  // LOAD ORDER, and it is the whole reason this is a lazy read: city/yachts.js
  // parses at index.html:969 and this file at :1333, so `CBZ.marineHulls.kit`
  // does not exist when yachts.js runs its IIFE. Every consumer therefore reads
  // it INSIDE its build() — which is only ever called when a hull is actually
  // spawned, long after boot.
  const KIT = {
    THREE: THREE,
    roleMat: roleMat, sharedMat: sharedMat, glassMat: glassMat, chromeMat: chromeMat,
    boxGeo: boxGeo, prismGeo: prismGeo, cylGeo: cylGeo,
    addBox: addBox, addPrism: addPrism, addCyl: addCyl,
    addTubeBetween: addTubeBetween,
    declareRoom: declareRoom, markFixture: markFixture,
    addFixtureBox: addFixtureBox, addFixtureCyl: addFixtureCyl,
    addSeat: addSeat, addTable: addTable, addCabinet: addCabinet, addScreen: addScreen,
    addCabinShell: addCabinShell,
    addRail: addRail, addStairs: addStairs, stairDecks: stairDecks,
    mergeByMaterial: mergeByMaterial, finish: finish,
    M: M, propGroup: propGroup, navLights: navLights,
    // THE LOFT. Every hull author reaches the surface primitive through here
    // (or through window.CBZ.hullLoft directly — same object, read lazily).
    loft: LOFT, loftHull: loftHull, outboard: outboard,
    // FITTINGS ON THE SKIN. A hull author who lofts a shell and then bolts
    // boxes on at guessed offsets has drawn half a boat; these are how the
    // other half stays attached to it.
    hullSectionX: hullSectionX, skinRun: skinRun, chineRun: chineRun,
    hullPanel: hullPanel, hullDisc: hullDisc,
    sheet: sheet, ribbon: ribbon, bulwark: bulwark, sheerRail: sheerRail,
    rakeStem: rakeStem, warpBilge: warpBilge,
  };
  CBZ.marineHulls.kit = KIT;
  // The named parts a hull author reuses verbatim. Same surface as KIT, split
  // out because "give me the outboard" should not require knowing that the
  // whole drawing kit exists.
  CBZ.marineHulls.parts = {
    outboard: outboard, propGroup: propGroup, navLights: navLights,
    loftHull: loftHull, loft: LOFT,
  };

  // ---- THE DEFERRED REGISTRATION QUEUE -------------------------------------
  // Same load-order fact, the other way round: a file that parses BEFORE this
  // one cannot call register(). It pushes a register-shaped record onto
  // CBZ.marineHullPending instead and this drains it in section 4, so the hull
  // is derived, registered, priced and pushed into the economy by exactly the
  // code path the authored fleet uses. Nothing gets a second registration
  // function. A file that parses AFTER us simply calls register() directly and
  // then CBZ.marineHulls.pushEconomy() to catch the catalog up.
  if (!Array.isArray(CBZ.marineHullPending)) CBZ.marineHullPending = [];
  function drainPending() {
    const q = CBZ.marineHullPending;
    if (!Array.isArray(q)) return 0;
    let n = 0;
    while (q.length) {
      const e = q.shift();
      if (!e || !e.key || REG.has(e.key)) continue;
      try { if (register(e.key, e)) n++; } catch (err) { /* one bad row must never cost the fleet */ }
    }
    return n;
  }

  // ---- KAYAK — Sandbar 14 (4.2 m sit-on-top sea kayak) ---------------------
  // The smallest hull in the game and the one that proves the primitive: a
  // kayak is ALL surface. Round bilge, no chine anywhere, a cambered deck
  // welded to the sheer, a rockered keel and ends that sweep up out of the
  // water. There is nothing on it a box could have drawn.
  //
  // It is PADDLED. No engine, no prop, rudder-style steering — the registry
  // carries craft, not just motorboats.
  function buildKayak() {
    const b = new THREE.Group();
    const L = 4.2, W = 0.72, FB = 0.28;
    const hull = M.kayakHull(), deck = M.kayakDeck(), dark = M.dark();
    const grey = M.grey(), pad = M.pad(), chrome = M.chrome();
    declareRoom(b, "kayak-well", "Seat well");
    const HL = LOFT();
    const lines = {
      loa: L, beam: W, draft: 0.12, freeboard: FB,
      sheerBow: 0.20, sheerStern: 0.14,          // upswept ends
      roundBilge: true, bilgeN: 2.6, tumblehome: 18, flareBow: 0,
      transomRake: 0, maxBeamHeight: 0.62,
      midBody0: 0.30, midBody1: 0.62, transomBeamFrac: 0.62,
      entryPow: 1.35, rockerAft: 0.42, tKeel: 0.46, n: 21,
    };
    const CK = { z0: -0.34, z1: 0.62, halfW: 0.185 };
    let out = null;
    if (HL) {
      const st = HL.stationsFromLines(lines);
      loftHull(b, st, hull, { rings: 11, transom: "none", deck: true, deckCamber: 0.045, deckCols: 9, cockpit: CK });
      out = HL.outline(st);
    }
    const sheerAt = (z) => (out ? out.sheerYAt(z) : FB);
    const hbAt = (z) => (out ? out.halfBeamAt(z) : W * 0.5);

    // THE SEAT WELL. A sit-on-top's well is a moulded tray a hand's width
    // below the deck, not a hole into the hull — so the hole in the deck gets
    // a floor, or you would be looking at the inside of the bottom.
    const wy = sheerAt(0.1) - 0.085;
    addBox(b, CK.halfW * 2 - 0.02, 0.035, CK.z1 - CK.z0 - 0.04, 0, wy, (CK.z0 + CK.z1) * 0.5, deck);
    [1, -1].forEach(function (side) {
      addBox(b, 0.03, 0.11, CK.z1 - CK.z0 - 0.04, side * (CK.halfW - 0.012), wy + 0.06, (CK.z0 + CK.z1) * 0.5, deck);
    });
    addBox(b, CK.halfW * 2 - 0.02, 0.11, 0.03, 0, wy + 0.06, CK.z0 + 0.02, deck);
    addBox(b, CK.halfW * 2 - 0.02, 0.11, 0.03, 0, wy + 0.06, CK.z1 - 0.02, deck);
    // seat pad + backrest, thigh braces, moulded footwells
    addBox(b, 0.30, 0.05, 0.36, 0, wy + 0.05, -0.02, pad);
    const back = addBox(b, 0.30, 0.28, 0.05, 0, wy + 0.20, -0.26, pad);
    back.rotation.x = 0.22;
    markFixture(b, back, "seat-back");
    [1, -1].forEach(function (side) {
      addBox(b, 0.05, 0.07, 0.22, side * 0.16, wy + 0.10, 0.24, deck);   // thigh brace
      addBox(b, 0.11, 0.03, 0.13, side * 0.10, wy + 0.02, 0.50, grey);   // footwell pad
    });
    // SCUPPERS — the holes that make it a sit-on-top. Dark discs, not holes:
    // a real hole would be a 3 cm tube through a 1 cm shell nobody can see.
    [-0.20, 0.18, 0.44].forEach(function (z) {
      [1, -1].forEach(function (side) {
        const d = addCyl(b, 0.026, 0.012, side * 0.10, sheerAt(z) - 0.004, z, dark, 8);
        d.userData.marineFixture = "scupper";
      });
    });
    // HATCHES fore and aft: a rim and a lid, both round.
    [[1.36, 0.115], [-1.05, 0.095]].forEach(function (h) {
      const z = h[0], r = h[1], y = sheerAt(z);
      addCyl(b, r + 0.018, 0.014, 0, y + 0.005, z, deck, 14);
      addCyl(b, r, 0.020, 0, y + 0.016, z, dark, 14);
      markFixture(b, addCyl(b, 0.020, 0.030, 0, y + 0.030, z + r * 0.55, grey, 8), "hatch-catch");
    });
    // DECK LINES. Bungee cross-lacing on the foredeck and a perimeter line
    // aft, run through real pad-eyes and drawn with the loft's own strip().
    if (HL) {
      const lace = [];
      for (let i = 0; i < 5; i++) {
        const z = 0.86 + i * 0.20, s = i % 2 ? -1 : 1;
        lace.push([s * (hbAt(z) - 0.055), sheerAt(z) + 0.012, z]);
      }
      const l1 = HL.strip(lace, 0.008, dark, { segments: 40, radial: 5 });
      if (l1) { l1.castShadow = false; b.add(l1); }
      [1, -1].forEach(function (side) {
        const run = [];
        for (let i = 0; i <= 6; i++) {
          const z = -1.55 + i * 0.32;
          run.push([side * (hbAt(z) - 0.030), sheerAt(z) + 0.010, z]);
        }
        const l2 = HL.strip(run, 0.007, grey, { segments: 42, radial: 5 });
        if (l2) { l2.castShadow = false; b.add(l2); }
      });
      // carry toggles at both ends
      [L * 0.47, -L * 0.47].forEach(function (z) {
        const t = HL.strip([[0, sheerAt(z) + 0.02, z], [0, sheerAt(z) - 0.02, z + (z > 0 ? 0.10 : -0.10)]], 0.010, dark, { segments: 6, radial: 5 });
        if (t) { t.castShadow = false; b.add(t); }
      });
    }
    // THE PADDLE, laid across the well the way it is actually carried: one
    // shaft athwartships, two feathered blades over the water either side.
    const paddle = new THREE.Group();
    paddle.position.set(0, sheerAt(0.72) + 0.055, 0.72);
    const shaft = addCyl(paddle, 0.017, 1.30, 0, 0, 0, dark, 8);
    shaft.rotation.z = Math.PI / 2;
    [1, -1].forEach(function (side) {
      const blade = addBox(paddle, 0.15, 0.015, 0.42, side * 0.78, -0.005, 0, M.pwcAccent());
      blade.rotation.z = side * 0.10;
      blade.rotation.y = side * 0.42;                       // feathered
      addBox(paddle, 0.045, 0.014, 0.14, side * 0.60, -0.002, 0, dark);
    });
    markFixture(b, paddle, "paddle");
    b.add(paddle);
    addBox(b, 0.05, 0.03, 0.05, 0, sheerAt(-1.86) + 0.02, -1.86, chrome);   // stern grab
    navLights(b, W * 0.5, FB + 0.02, L * 0.40, -L * 0.44, null);
    b.userData.marineFixtureCount += 2;                                      // seat + well
    return finish(b, { width: W, length: L, height: 0.46, wheelbase: L * 0.6 });
  }

  // ---- JETSKI — Vareo GT (3.3 m personal watercraft) -----------------------
  // A PWC IS MOULDINGS ALL THE WAY UP. The first pass got the hull right and
  // then bolted BOXES to it — a flat-topped box saddle, a box dash, a box
  // step — and it read as a small boat with crates on it. There is not a flat
  // top or a square corner anywhere on a real ski: the hood is a sculpted
  // volume that rises out of the bow and swells into the handlebar pod, the
  // saddle is a rounded ridge tapering to the rear between two footwell
  // troughs, and the sponsons blend into the deck.
  //
  // So EVERY shape above the sheer is its own loft. pod() is that idea: a
  // closed round-bilge body whose TOP LINE is authored as a function of
  // station, and whose flat underside is deliberately BURIED in the deck —
  // because a moulding is not a thing that sits on a boat, it is a thing the
  // boat's own surface swells into.
  function buildJetski() {
    const b = new THREE.Group();
    const L = 3.3, W = 1.2, FB = 0.30, HW = W * 0.5;
    const hull = M.pwcHull(), trim = M.pwcTrim(), acc = M.pwcAccent();
    const dark = M.dark(), grey = M.grey(), chrome = M.chrome();
    const glass = M.glass(), screen = M.screen();
    const seat = sharedMat("mh-pwcseat", 0x191c20, { emissive: 0x0a0c0e, ei: 0.16 });
    declareRoom(b, "jetski-saddle", "Saddle");
    const HL = LOFT();
    // The lower hull. Its deck is the FOOTWELL FLOOR — a gentle crown and
    // nothing more, because on a ski every bit of height above it belongs to
    // a moulding, not to the deck.
    const CAMBER = 0.13;
    const lines = {
      loa: L, beam: W, draft: 0.30, freeboard: FB,
      sheerBow: 0.22, sheerStern: 0.02,
      deadrise: 21, deadriseBow: 46, flareBow: 6, tumblehome: 13,
      transomRake: 4, chineBeamFrac: 1,          // the SPONSON is the widest point
      midBody0: 0.20, midBody1: 0.62, transomBeamFrac: 0.90,
      entryPow: 1.5, rockerAft: 1, tKeel: 0.30, n: 17,
    };
    let out = null;
    if (HL) {
      const st = HL.stationsFromLines(lines);
      loftHull(b, st, hull, { rings: 9, chine: "auto", transom: "flat", deck: true, deckCamber: CAMBER, deckCols: 9 });
      out = HL.outline(st);
    }
    const sheerAt = (z) => (out ? out.sheerYAt(z) : FB);
    const hbAt = (z) => (out ? out.halfBeamAt(z) : HW);
    const deckAt = (z) => sheerAt(z) + CAMBER;            // the footwell floor

    // ---- pod(): one moulded volume ---------------------------------------
    // THREE authored lines, and all three matter:
    //   top(t)    the crown, so a moulding FOLLOWS the deck it grows out of
    //             instead of being a slab parked at one height
    //   bottom(t) the underside, likewise — a hood buried at a constant depth
    //             stands a foot proud of a deck that has risen underneath it
    //   plan(t)   the half-breadth, read off the HULL. A moulding wider than
    //             the hull it sits on is the one thing that made the previous
    //             attempt look like a blue wall with a boat behind it.
    function pod(o, material) {
      if (!HL) return null;
      const st = HL.stationsFromLines({
        loa: o.len, beam: o.plan ? 2 : o.wide, freeboard: 0.1,
        draft: o.bottom ? 1 : o.deep,
        planHalfBeam: o.plan,
        roundBilge: true, bilgeN: o.bilge == null ? 2.6 : o.bilge,
        maxBeamHeight: o.shoulder == null ? 0.60 : o.shoulder,
        tumblehome: o.tumble == null ? 8 : o.tumble, flareBow: 0, transomRake: 0,
        midBody0: o.mid0 == null ? 0.06 : o.mid0,
        midBody1: o.mid1 == null ? 0.50 : o.mid1,
        transomBeamFrac: o.tail == null ? 0.86 : o.tail,
        entryPow: o.entry == null ? 1.5 : o.entry,
        keelProfile: o.bottom ? function (t) { return -o.bottom(t); }
                              : function () { return 1; },   // flat and BURIED
        sheerProfile: o.top,
        n: o.n == null ? 13 : o.n,
      });
      const m = HL.mesh(st, material, {
        rings: o.rings == null ? 9 : o.rings, transom: "flat",
        deck: true, deckCamber: o.camber == null ? 0.05 : o.camber, deckCols: 7,
        stemRound: o.nose || 0, castShadow: false,
      });
      if (!m) return null;
      m.castShadow = false;
      m.position.set(o.x || 0, o.y || 0, o.z || 0);
      if (o.yaw) m.rotation.y = o.yaw;
      if (o.roll) m.rotation.z = o.roll;
      b.add(m);
      return { mesh: m, out: HL.outline(st), x: o.x || 0, y: o.y || 0, z: o.z || 0 };
    }

    // ---- THE HOOD: bow tip -> handlebar pod ------------------------------
    // Widest and tallest at its AFT end (where your hands go), tapering to a
    // rounded point at the stem. Its crown is the deck plus a swell that dies
    // out forward — that curve IS the shape people recognise as a ski.
    const HZ0 = 0.30, HZ1 = 1.62, HC = (HZ0 + HZ1) * 0.5;
    const hoodTopAt = function (t) {
      const wz = HZ0 + (HZ1 - HZ0) * t;
      return deckAt(wz) + 0.05 + 0.20 * Math.pow(1 - t, 1.15);
    };
    const hoodZ = function (t) { return HZ0 + (HZ1 - HZ0) * t; };
    const hood = pod({
      len: HZ1 - HZ0, z: HC, y: 0, top: hoodTopAt,
      bottom: function (t) { return deckAt(hoodZ(t)) - 0.09; },
      plan: function (t) { return Math.min(hbAt(hoodZ(t)) * 0.86, 0.30); },
      nose: 0.04, camber: 0.11, tumble: 6, shoulder: 0.58, n: 13,
    }, trim);
    // the graphic flash, laid ON the hood's own shoulder line
    if (hood && HL) {
      [1, -1].forEach(function (side) {
        const run = [];
        for (let i = 0; i <= 6; i++) {
          const wz = 0.44 + i * 0.175, lz = wz - hood.z;
          run.push([side * hood.out.halfBeamAt(lz) * 0.94, hood.out.sheerYAt(lz) + hood.y - 0.015, wz]);
        }
        const f = HL.strip(run, 0.022, acc, { segments: 20, radial: 4 });
        if (f) { f.castShadow = false; b.add(f); }
      });
    }

    // ---- THE SADDLE: a rounded ridge that tapers to the rear -------------
    // Built BACKWARDS and turned round, because stationsFromLines always
    // tapers toward its own bow: the pod's bow becomes the ski's stern, which
    // is the end a seat actually tapers to. Its transom butts the hood.
    const SZ0 = 0.45, SZ1 = -1.35, SC = (SZ0 + SZ1) * 0.5;
    const saddleTopAt = function (t) {
      const wz = SZ0 + (SZ1 - SZ0) * t;
      return deckAt(wz) + 0.30 + 0.06 * Math.pow(t, 1.4);   // steps up for the pillion
    };
    const saddleZ = function (t) { return SZ0 + (SZ1 - SZ0) * t; };
    const saddleW = function (t, k, cap) {
      return Math.min(hbAt(saddleZ(t)) * k, cap) * (1 - Math.pow(t, 2.6) * 0.92);
    };
    pod({                                                      // the seat base skirt
      len: Math.abs(SZ1 - SZ0) + 0.08, z: SC, y: 0, yaw: Math.PI,
      top: function (t) { return saddleTopAt(t) - 0.20; },
      bottom: function (t) { return deckAt(saddleZ(t)) - 0.06; },
      plan: function (t) { return saddleW(t, 0.82, 0.255); },
      nose: 0.04, camber: 0.03, tumble: 2, shoulder: 0.5, n: 11, rings: 5,
    }, trim);
    const saddle = pod({
      len: Math.abs(SZ1 - SZ0), z: SC, y: 0, yaw: Math.PI, top: saddleTopAt,
      bottom: function (t) { return deckAt(saddleZ(t)) + 0.02; },
      plan: function (t) { return saddleW(t, 0.72, 0.235); },
      nose: 0.035, camber: 0.09, tumble: 5, shoulder: 0.55, n: 13,
    }, seat);
    if (saddle) markFixture(b, saddle.mesh, "saddle");

    // ---- THE FOOTWELL TROUGHS -------------------------------------------
    // The floor is the deck, the inboard wall is the saddle skirt, and this
    // rounded lip along the sheer is the outboard one. Three surfaces, no box.
    if (HL) {
      [1, -1].forEach(function (side) {
        const run = [];
        for (let i = 0; i <= 7; i++) {
          const z = -1.32 + i * 0.27;
          run.push([side * (hbAt(z) - 0.020), deckAt(z) - 0.010, z]);
        }
        const lip = HL.strip(run, 0.026, hull, { segments: 26, radial: 5 });
        if (lip) { lip.castShadow = false; b.add(lip); }
      });
    }

    // ---- SPONSONS: rounded blades that blend into the chine --------------
    [1, -1].forEach(function (side) {
      const sp = pod({
        len: 0.84, wide: 0.15, deep: 0.10, n: 7, rings: 5, nose: 0.02,
        x: side * (hbAt(-0.95) + 0.010), y: 0.02, z: -0.95, roll: side * 0.34,
        top: function () { return 0.075; }, camber: 0.02,
        mid0: 0.10, mid1: 0.55, tail: 0.70, entry: 1.3, tumble: 0, shoulder: 0.5,
      }, acc);
      if (sp) markFixture(b, sp.mesh, "sponson");
    });

    // ---- TWO-TONE TOPSIDES ----------------------------------------------
    // A broad coloured band under the sheer with a thin accent over it: the
    // shape only reads if the light has something to break across.
    if (HL) {
      [1, -1].forEach(function (side) {
        const band = [];
        for (let i = 0; i <= 8; i++) {
          const z = -1.55 + i * 0.40;
          band.push([side * (hbAt(z) + 0.010), sheerAt(z) - 0.105 - i * 0.012, z]);
        }
        const g1 = HL.strip(band, 0.052, trim, { segments: 28, radial: 5 });
        if (g1) { g1.castShadow = false; b.add(g1); }
      });
    }

    // ---- HANDLEBAR POD, BARS, MIRRORS ------------------------------------
    // The pod is a small dome growing out of the top of the hood; the mirrors
    // are discs on short stalks. Nothing here is a slab.
    const podY = hoodTopAt(0.06) - 0.10;
    const dash = pod({
      len: 0.38, wide: 0.32, deep: 0.10, n: 7, rings: 6, nose: 0.03,
      x: 0, y: podY, z: HZ0 + 0.06, top: function () { return 0.16; }, camber: 0.05,
      mid0: 0.10, mid1: 0.55, tail: 0.80, entry: 1.4, tumble: 6, shoulder: 0.55,
    }, dark);
    if (dash) markFixture(b, dash.mesh, "dash");
    addScreen(b, 0, podY + 0.12, HZ0 + 0.205, 0.15, 0.065, 0, screen);
    const barY = podY + 0.20, barZ = HZ0 - 0.08;
    const bar = addCyl(b, 0.018, 0.56, 0, barY, barZ, dark, 10);
    bar.rotation.z = Math.PI / 2;
    markFixture(b, bar, "handlebar");
    [1, -1].forEach(function (side) {
      addCyl(b, 0.024, 0.13, side * 0.22, barY, barZ, seat, 10).rotation.z = Math.PI / 2;
      addTubeBetween(b, [side * 0.185, barY + 0.01, barZ], [side * 0.225, barY + 0.11, barZ - 0.03], 0.010, grey, 6);
      const mir = addCyl(b, 0.048, 0.014, side * 0.228, barY + 0.135, barZ - 0.035, glass, 12);
      mir.rotation.x = Math.PI / 2 - 0.35;
      mir.rotation.z = side * 0.5;
      markFixture(b, mir, "mirror");
    });

    // ---- THE REAR PLATFORM ----------------------------------------------
    // A rounded pad, not a plank: you climb onto it out of the water.
    pod({
      len: 0.40, wide: 0.46, deep: 0.06, n: 7, rings: 5, nose: 0.05,
      x: 0, y: deckAt(-1.50) - 0.020, z: -1.50,
      top: function () { return 0.030; }, camber: 0.012,
      mid0: 0.05, mid1: 0.70, tail: 0.96, entry: 1.2, tumble: 0, shoulder: 0.5,
    }, seat);
    markFixture(b, addCyl(b, 0.016, 0.26, 0, deckAt(-1.34) + 0.055, -1.34, chrome, 8), "boarding-handle").rotation.z = Math.PI / 2;
    // JET PUMP. A ski has no propeller — that is the point of it — so this
    // hull deliberately never calls propGroup().
    const nozzle = addCyl(b, 0.085, 0.24, 0, -0.05, -L * 0.5 - 0.06, grey, 14);
    nozzle.rotation.x = Math.PI / 2;
    addCyl(b, 0.062, 0.12, 0, -0.05, -L * 0.5 - 0.20, dark, 14).rotation.x = Math.PI / 2;
    addCyl(b, 0.075, 0.06, 0, -0.05, -L * 0.5 - 0.27, dark, 14).rotation.x = Math.PI / 2;   // steering vane
    // front hatch and tow eye
    addCyl(b, 0.095, 0.016, 0, hoodTopAt(0.52) - 0.008, HZ0 + (HZ1 - HZ0) * 0.52, dark, 16);
    addBox(b, 0.05, 0.05, 0.07, 0, 0.16, L * 0.5 - 0.04, chrome);
    navLights(b, HW, FB + 0.14, L * 0.36, -L * 0.44, null);
    b.userData.marineFixtureCount += 3;
    return finish(b, { width: W, length: L, height: 1.05, wheelbase: L * 0.6 });
  }

  // ---- THE STERNDRIVE ------------------------------------------------------
  // An outboard carries its engine on the transom; a STERNDRIVE leaves the
  // engine inboard under the sun pad and puts only the leg outside. So it has
  // no cowl at all — a transom shield, a short upper housing, the gearcase
  // torpedo with its anti-ventilation plate and skeg, and the trim rams that
  // tilt it. Drawing an outboard here (which is what the runabout did) is the
  // difference between a 6 m bowrider and a fishing skiff.
  // `y` is the anti-ventilation plate, same contract as outboard().
  function sterndrive(root, x, y, z, hp) {
    const s = clampN(Math.pow(Math.max(40, hp || 260) / 260, 1 / 3), 0.7, 1.6);
    const leg = M.grey(), plate = M.chrome(), dark = M.dark();
    const g = new THREE.Group();
    g.position.set(x || 0, y || 0, z || 0);
    // transom shield: the plate the whole drive hangs off, bolted to the hull
    addBox(g, 0.46 * s, 0.60 * s, 0.10, 0, 0.30 * s, 0.12 * s, plate);
    addBox(g, 0.30 * s, 0.46 * s, 0.26 * s, 0, 0.30 * s, -0.02 * s, leg);   // upper housing
    addBox(g, 0.17 * s, 0.34 * s, 0.24 * s, 0, 0.05 * s, -0.02 * s, leg);   // vertical leg
    addBox(g, 0.44 * s, 0.024 * s, 0.40 * s, 0, 0, -0.06 * s, plate);       // anti-vent plate
    const bullet = addCyl(g, 0.085 * s, 0.56 * s, 0, -0.13 * s, -0.06 * s, leg, 10);
    bullet.rotation.x = Math.PI / 2;
    addBox(g, 0.05 * s, 0.22 * s, 0.22 * s, 0, -0.27 * s, 0.02 * s, leg);   // skeg
    // trim rams: two short chrome cylinders from the shield to the housing
    [1, -1].forEach(function (side) {
      const ram = addCyl(g, 0.028 * s, 0.30 * s, side * 0.20 * s, 0.34 * s, 0.05 * s, plate, 8);
      ram.rotation.x = Math.PI / 2 - 0.5;
    });
    addBox(g, 0.30 * s, 0.10 * s, 0.06, 0, 0.62 * s, 0.10 * s, dark);       // bellows boot
    root.add(g);
    return {
      group: g, scale: s,
      propAt: [x || 0, (y || 0) - 0.13 * s, (z || 0) - 0.40 * s],
      top: (y || 0) + 0.68 * s,
    };
  }

  // ---- THE RIB COLLAR ------------------------------------------------------
  // A rigid inflatable's tube is ONE object: it starts at the port transom,
  // runs the length of the gunwale, wraps round the stem and comes back to
  // starboard. The old build drew it as four straight cylinders, which is why
  // it crossed the topsides wherever the sheer rose — a straight cylinder
  // cannot follow a curve. Swept along the sheer the loft reports, it cannot
  // do anything else. Returns the collar's own half-beam function so the
  // fittings (grab lines, cleats, nav lights) land ON the tube.
  function ribCollar(root, out, r, material, o) {
    const HL = LOFT();
    if (!HL || !out) return null;
    o = o || {};
    const lift = num2(o.lift, 0.06), inset = num2(o.inset, r - 0.02);
    const z0 = out.z0 + num2(o.aftTrim, 0.10);
    const xAt = function (z) { return Math.max(0, out.halfBeamAt(z) - inset); };
    const yAt = function (z) { return out.sheerYAt(z) + lift; };
    // where the two runs meet on the centreline: the bow cone is not a
    // separate part, it is the same tube with its half-beam gone to zero.
    let zNose = out.z1;
    for (let z = out.z1; z > z0; z -= 0.01) { if (xAt(z) > 0.012) { zNose = z; break; } }
    const port = [];
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
      const z = z0 + (zNose - z0) * (i / steps);
      port.push([xAt(z), yAt(z), z]);
    }
    const apexZ = Math.min(out.z1 - 0.02, zNose + r * 0.75);
    const path = port.concat([[0, yAt(apexZ), apexZ]],
      port.slice().reverse().map(function (p) { return [-p[0], p[1], p[2]]; }));
    const tube = HL.strip(path, r, material, { segments: 120, radial: 9 });
    if (tube) { tube.castShadow = false; tube.name = "rib_collar"; root.add(tube); }
    // The aft ends are CONES, which is what closes a real tube, and they are
    // the reason a RIB's stern looks like a RIB's stern.
    [1, -1].forEach(function (side) {
      const cone = new THREE.Mesh(cylGeo(0.05, r, 0.34, 10), material);
      cone.position.set(side * xAt(z0), yAt(z0), z0 - 0.17);
      cone.rotation.x = -Math.PI / 2;
      cone.castShadow = false;
      root.add(cone);
    });
    return { tube: tube, xAt: xAt, yAt: yAt, r: r, zNose: zNose, z0: z0 };
  }
  function num2(v, d) { return (typeof v === "number" && isFinite(v)) ? v : d; }

  // ---- DINGHY — Calanque Tender 15 (4.5 m RIB) -----------------------------
  // Rigid-hull inflatable. The pan is a lofted deep-V with a hard chine (20°
  // of deadrise at the transom warping to a fine entry) and the collar is one
  // swept tube along the sheer — because on a RIB the collar IS the
  // silhouette. It was three stepped prisms and four straight cylinders.
  //
  // THE BEAM: on a RIB the rigid pan carries the full beam at the chine and
  // the tubes are bonded inboard with their outer faces flush, which is why
  // the overall beam and the hull beam are the same 2.0 m while the INSIDE
  // beam is only 1.06 m. Drawing a narrow pan with the tubes hung outboard of
  // it is the mistake that makes a RIB read as a rowboat wearing a life ring.
  function buildDinghy() {
    const b = new THREE.Group();
    const L = 4.5, W = 2.0, hw = W * 0.5, FB = 0.32, TR = 0.24;
    const hull = M.ribHull(), tube = M.tube(), dark = M.dark(), grey = M.grey();
    const chrome = M.chrome(), pad = M.pad(), teak = M.teakDk(), screen = M.screen();
    const glass = M.glass();
    declareRoom(b, "dinghy-helm", "Open helm");
    const HL = LOFT();
    const lines = {
      loa: L, beam: W, draft: 0.34, freeboard: FB,
      sheerBow: 0.26, sheerStern: 0.03,
      deadrise: 20, deadriseBow: 46,          // deep-V aft, warping to a fine entry
      flareBow: 10, tumblehome: 7,            // the gunwale tucks in aft, under the tube
      transomRake: 8,
      midBody0: 0.16, midBody1: 0.68, transomBeamFrac: 0.94,
      entryPow: 1.5, rockerAft: 1.0, tKeel: 0.34, n: 15,
    };
    let out = null;
    if (HL) {
      const st = HL.stationsFromLines(lines);
      loftHull(b, st, hull, { rings: 9, chine: "auto", transom: "flat" });
      out = HL.outline(st);
    }
    const sheerAt = (z) => (out ? out.sheerYAt(z) : FB);
    const hbAt = (z) => (out ? out.halfBeamAt(z) : hw);
    const keelAt = (z) => (out ? out.keelYAt(z) : -0.34);
    const collar = ribCollar(b, out, TR, tube, { lift: 0.06, inset: TR - 0.02, aftTrim: 0.10 });
    const tubeX = collar ? collar.xAt : hbAt;
    const tubeY = collar ? collar.yAt : sheerAt;

    // THE SOLE. Self-bailing means the floor is ABOVE the waterline and the
    // water that comes over the tube runs aft and out through the transom
    // scuppers. Draw the floor where it drains from, not at y = 0.
    // Its width is the INSIDE beam (the tubes' inner faces), not the hull's.
    const SOLE = 0.10, INSIDE = (hbAt(0) - TR * 2 + 0.02) * 2;
    addBox(b, INSIDE, 0.05, 2.40, 0, SOLE, -0.35, teak);
    for (let i = 0; i < 5; i++) {                                   // deck slats
      addBox(b, INSIDE - 0.06, 0.012, 0.05, 0, SOLE + 0.032, -1.35 + i * 0.52, dark);
    }
    [1, -1].forEach(function (side) {                               // transom scuppers
      const sc = addCyl(b, 0.035, 0.05, side * 0.30, SOLE - 0.01, -L * 0.5 + 0.10, dark, 8);
      sc.rotation.x = Math.PI / 2;
    });
    // stringers under the sole, so it is a floor on frames rather than a slab
    [1, -1].forEach(function (side) {
      addBox(b, 0.05, 0.10, 2.30, side * 0.42, SOLE - 0.07, -0.35, hull);
    });

    // THE CONSOLE + JOCKEY SEAT. A 4.5 m RIB is driven standing at a small
    // moulded pod with a straddle seat right behind it.
    const cz = 0.34;
    addPrism(b, 0.52, [[cz - 0.26, 0], [cz - 0.22, 0.68], [cz + 0.18, 0.72], [cz + 0.24, 0]], SOLE, dark);
    const scr = addBox(b, 0.46, 0.26, 0.03, 0, SOLE + 0.90, cz + 0.20, glass);
    scr.rotation.x = -0.35;
    markFixture(b, scr, "windscreen");
    markFixture(b, addBox(b, 0.24, 0.24, 0.035, -0.12, SOLE + 0.70, cz + 0.10, dark), "wheel");
    addScreen(b, 0.14, SOLE + 0.70, cz + 0.115, 0.17, 0.12, 0, screen);
    addFixtureBox(b, "throttle", 0.06, 0.24, 0.06, 0.30, SOLE + 0.62, cz - 0.05, chrome);
    addBox(b, 0.50, 0.04, 0.04, 0, SOLE + 0.78, cz + 0.28, chrome);          // console grab rail
    const jockey = addBox(b, 0.44, 0.16, 0.58, 0, SOLE + 0.42, -0.42, pad);   // straddle seat
    markFixture(b, jockey, "jockey-seat");
    addBox(b, 0.44, 0.34, 0.10, 0, SOLE + 0.66, -0.74, pad);                  // backrest
    addBox(b, 0.20, 0.36, 0.34, 0, SOLE + 0.20, -0.42, hull);                 // seat pedestal
    addFixtureBox(b, "fuel-locker", 0.46, 0.24, 0.40, 0, SOLE + 0.14, -1.32, hull);

    // GRAB LINES along the tubes, run through real pad-eyes — a RIB's rope is
    // the thing you actually hold, and it is laid ON the tube the loft drew.
    if (HL && collar) {
      [1, -1].forEach(function (side) {
        const run = [], eyes = [];
        for (let i = 0; i <= 7; i++) {
          const z = -L * 0.44 + (L * 0.80) * (i / 7);
          const x = side * (tubeX(z) + TR * 0.80), y = tubeY(z) + TR * 0.42;
          run.push([x, y, z]);
          if (i % 2 === 1) eyes.push([x, y, z]);
        }
        const rope = HL.strip(run, 0.011, dark, { segments: 44, radial: 5 });
        if (rope) { rope.castShadow = false; b.add(rope); }
        for (const e of eyes) addBox(b, 0.05, 0.05, 0.05, e[0] * 0.94, e[1], e[2], grey);
      });
    }
    // TOWING EYE on the stem, cleats ON TOP OF THE TUBE (which is the only
    // thing at gunwale height on a RIB — a cleat at the hull's own sheer would
    // be buried inside the collar).
    markFixture(b, addBox(b, 0.07, 0.07, 0.13, 0, keelAt(2.07) + 0.24, 2.18, chrome), "tow-eye");
    [-1.90, 1.20].forEach(function (z) {
      [1, -1].forEach(function (side) {
        markFixture(b, addBox(b, 0.15, 0.05, 0.06, side * tubeX(z), tubeY(z) + TR + 0.02, z, chrome), "cleat");
      });
    });

    // THE OUTBOARD — the fleet's shared part. `y` is the anti-ventilation
    // plate and on a real boat that plate is level with the bottom AT THE
    // TRANSOM, so it is read off the keel line rather than guessed.
    const props = [];
    const ob = outboard(b, 0, keelAt(-L * 0.5) + 0.03, -L * 0.5 - 0.16, 60);
    props.push(ob.propAt);
    if (props.length) b.add(propGroup(0.7, props));
    // The lamps sit on the TUBE's outer shoulder near the bow, because that is
    // the widest thing at eye height on a boat with a collar.
    const nz = 1.30;
    navLights(b, (tubeX(nz) + TR * 0.72) / 0.97, tubeY(nz) + TR * 0.72, nz, -L * 0.46, null);
    return finish(b, { width: W, length: L, height: 1.05, wheelbase: L * 0.6 });
  }

  // ---- BOAT — Bellamar Speedboat (6.2 m bowrider runabout) ------------------
  // THIS GEOMETRY USED TO LIVE IN city/playercars.js makeBoat(): five
  // width-stepped prisms with a rotated box for a "deep-V keel" and flat glass
  // panels rotated until they looked close. It was the last hull in the fleet
  // outside the registry and the only one whose art nobody could audit,
  // because build() for key "boat" bounced back into playercars. Now it is a
  // lofted deep-V with a hard chine and playercars.js's makeBoat() is a
  // four-line delegate to this.
  function buildSpeedboat() {
    const b = new THREE.Group();
    const L = 6.2, W = 2.1, hw = W * 0.5, FB = 0.62;
    const hull = M.sbHull(), dark = M.dark(), grey = M.grey(), chrome = M.chrome();
    const pad = M.pad(), teak = M.teakDk(), glass = M.glass(), screen = M.screen();
    const stripe = M.stripe();
    declareRoom(b, "speedboat-cockpit", "Open runabout cockpit");
    const HL = LOFT();
    const CK = { z0: -2.30, z1: 1.16, halfW: 0.74 };
    const lines = {
      loa: L, beam: W, draft: 0.40, freeboard: FB,
      sheerBow: 0.30, sheerStern: 0.02,
      deadrise: 18, deadriseBow: 44,          // the warped deep-V of a runabout
      flareBow: 16, tumblehome: 0,            // FLARE forward: it throws spray down
      transomRake: 13,                        // a raked transom and a raked stem
      midBody0: 0.17, midBody1: 0.64, transomBeamFrac: 0.93,
      entryPow: 1.55, rockerAft: 1.0, tKeel: 0.32, n: 17,
    };
    let out = null, ST = null;
    if (HL) {
      ST = HL.stationsFromLines(lines);
      loftHull(b, ST, hull, {
        rings: 9, chine: "auto", transom: "flat",
        deck: true, deckCamber: 0.05, deckCols: 9, cockpit: CK,
      });
      out = HL.outline(ST);
    }
    const sheerAt = (z) => (out ? out.sheerYAt(z) : FB);
    const hbAt = (z) => (out ? out.halfBeamAt(z) : hw);
    const keelAt = (z) => (out ? out.keelYAt(z) : -0.40);

    // SPRAY RAILS on the bottom panel and the gelcoat stripe on the topsides.
    // EVERY ONE OF THESE IS READ OFF THE SKIN (skinRun -> hullSectionX), and
    // the first render of this hull is why: laid at a FRACTION OF THE MAX
    // HALF-BEAM they floated in mid-air, because on a deep-V the widest point
    // of the section is the chine, more than half way up — so a rail "at 30%
    // of the depth" was drawn at nearly twice the width the hull has down
    // there. It read as two black whiskers sticking out of the bow.
    if (HL && ST) {
      [1, -1].forEach(function (side) {
        [0.26, 0.44].forEach(function (up, k) {
          const yOf = (z) => keelAt(z) + (sheerAt(z) - keelAt(z)) * up;
          const rail = HL.strip(skinRun(ST, side, -L * 0.44, L * 0.44, yOf, 0.012, 0.34),
            0.026 - k * 0.006, hull, { segments: 46, radial: 5 });
          if (rail) { rail.castShadow = false; b.add(rail); }
        });
        const line = HL.strip(skinRun(ST, side, -L * 0.42, L * 0.44, (z) => sheerAt(z) - 0.13, 0.012, 0.34),
          0.032, stripe, { segments: 46, radial: 4 });
        if (line) { line.castShadow = false; b.add(line); }
        // a chrome rubbing strake ON the chine — chineRun reads the corner the
        // stations themselves name, so it cannot wander off it.
        const rub = HL.strip(chineRun(ST, side, 0.014, 0.0), 0.020, chrome, { segments: 44, radial: 5 });
        if (rub) { rub.castShadow = false; b.add(rub); }
      });
    }

    // COCKPIT SOLE, above the waterline, with a bow pad on the foredeck and a
    // sun pad over the engine box aft — a bowrider's whole layout.
    const SOLE = 0.24;
    // The moulded DECK the loft already drew is the bow deck and the aft engine
    // hatch; everything below just fills the well the cockpit hole opened.
    const deckY = (z) => sheerAt(z) + 0.05;
    addBox(b, CK.halfW * 2 - 0.06, 0.06, CK.z1 - CK.z0 - 0.10, 0, SOLE, (CK.z0 + CK.z1) * 0.5, teak);
    addBox(b, CK.halfW * 2 - 0.04, deckY(CK.z1) - SOLE, 0.12, 0, (deckY(CK.z1) + SOLE) * 0.5, CK.z1 - 0.05, hull);
    addBox(b, W * 0.62, 0.16, 0.80, 0, deckY(-2.62) + 0.09, -2.62, pad);              // stern sun pad
    addBox(b, W * 0.58, 0.32, 0.62, 0, SOLE + 0.24, -1.98, hull);                     // engine box
    addBox(b, W * 0.58, 0.14, 0.42, 0, SOLE + 0.47, -1.86, pad);                      // stern bench
    addBox(b, W * 0.58, 0.34, 0.12, 0, SOLE + 0.68, -2.12, pad);                      // its back
    addBox(b, W * 0.44, 0.06, 0.86, 0, deckY(1.55) + 0.04, 1.55, pad);                // bow sun pad
    // two buckets at the console, helm to starboard (-x; navLights puts port
    // red at +x, and this fleet keeps that sign convention everywhere)
    [-0.42, 0.42].forEach(function (x) {
      addBox(b, 0.44, 0.14, 0.46, x, SOLE + 0.40, -0.18, pad);
      addBox(b, 0.44, 0.36, 0.11, x, SOLE + 0.62, -0.41, pad);
      addBox(b, 0.16, 0.32, 0.16, x, SOLE + 0.17, -0.18, grey);
    });
    // CONSOLE + a wraparound windscreen made of THREE REAL PANES: a centre
    // pane over the dash and a wing each side raked and swept back to the
    // gunwale, with a chrome header capping the centre.
    addPrism(b, W * 0.62, [[0.24, 0], [0.28, 0.44], [0.72, 0.50], [0.80, 0]], SOLE, dark);
    markFixture(b, addBox(b, 0.26, 0.26, 0.04, -0.34, SOLE + 0.60, 0.44, dark), "wheel");
    addScreen(b, 0.22, SOLE + 0.58, 0.46, 0.30, 0.18, 0, screen);
    addFixtureBox(b, "throttle", 0.06, 0.26, 0.06, 0.02, SOLE + 0.54, 0.28, chrome);
    const wsY = SOLE + 0.62, wsZ = 0.78;
    const mid = addBox(b, W * 0.56, 0.34, 0.03, 0, wsY + 0.14, wsZ, glass);
    mid.rotation.x = -0.42;
    markFixture(b, mid, "windscreen");
    [1, -1].forEach(function (side) {
      const wing = addBox(b, 0.36, 0.30, 0.03, side * (W * 0.30), wsY + 0.10, wsZ - 0.08, glass);
      wing.rotation.x = -0.42;
      wing.rotation.y = side * 0.55;
    });
    const cap = addBox(b, W * 0.58, 0.035, 0.035, 0, wsY + 0.30, wsZ - 0.065, chrome);
    cap.rotation.x = -0.42;

    // THE BOW RAIL, laid on the sheer the loft reports rather than at a
    // guessed offset — the whole reason outline() exists.
    if (HL) {
      const rail = [];
      for (let i = 0; i <= 6; i++) {
        const z = 1.05 + (2.72 - 1.05) * (i / 6);
        // clamped OFF the centreline: at the stem the half-beam is 1 cm and an
        // unclamped inset walks the rail through the boat and out the far side.
        rail.push([Math.max(0.05, hbAt(z) - 0.09), sheerAt(z) + 0.22, z]);
      }
      const nose = [[0, sheerAt(2.95) + 0.20, 2.98]];
      const path = rail.concat(nose, rail.slice().reverse().map(function (p) { return [-p[0], p[1], p[2]]; }));
      const r = HL.strip(path, 0.019, chrome, { segments: 60, radial: 6 });
      if (r) { r.castShadow = false; b.add(r); }
      for (const p of rail) {
        [1, -1].forEach(function (side) {
          addBox(b, 0.03, 0.22, 0.03, side * p[0], p[1] - 0.11, p[2], chrome);
        });
      }
    }
    // SWIM PLATFORM, integrated into the transom the way a sterndrive boat
    // has it: a moulded step each side of the drive with a boarding handle.
    [1, -1].forEach(function (side) {
      addBox(b, 0.52, 0.07, 0.56, side * 0.56, 0.14, -L * 0.5 - 0.20, teak);
      addBox(b, 0.52, 0.20, 0.06, side * 0.56, 0.25, -L * 0.5 - 0.46, hull);
      markFixture(b, addBox(b, 0.05, 0.05, 0.22, side * 0.56, 0.40, -L * 0.5 - 0.10, chrome), "boarding-handle");
      markFixture(b, addBox(b, 0.16, 0.05, 0.06, side * (hbAt(-L * 0.44) - 0.12), sheerAt(-L * 0.44) + 0.04, -L * 0.44, chrome), "cleat");
      markFixture(b, addBox(b, 0.14, 0.05, 0.06, side * (hbAt(1.55) - 0.12), sheerAt(1.55) + 0.06, 1.55, chrome), "cleat");
    });
    // THE STERNDRIVE. The engine is inboard under that sun pad, so what hangs
    // on the transom is a leg, not an outboard with a cowl on it.
    const dr = sterndrive(b, 0, keelAt(-L * 0.5) + 0.02, -L * 0.5 - 0.06, 300);
    b.add(propGroup(0.8, [dr.propAt]));
    const nz = L * 0.30;
    navLights(b, (hbAt(nz) + 0.01) / 0.97, sheerAt(nz) + 0.06, nz, -L * 0.46, null);
    return finish(b, { width: W, length: L, height: 1.35, wheelbase: L * 0.6 });
  }

  // ---- CONSOLE — Baymaster 25 (7.5 m centre console) -----------------------
  // The boat the sea is actually full of, and the fleet did not have one: a
  // deep-V centre console with a T-top, twin outboards, rod holders down both
  // gunwales, a bow casting deck and a livewell. It is also the hull the shark
  // rules need in the middle of the ladder — big enough that a great white
  // cannot swallow it and small enough that a megalodon can.
  function buildConsole() {
    const b = new THREE.Group();
    const L = 7.5, W = 2.6, hw = W * 0.5, FB = 0.72;
    const hull = M.ccHull(), dark = M.dark(), grey = M.grey(), chrome = M.chrome();
    const pad = M.pad(), teak = M.teakDk(), glass = M.glass(), screen = M.screen();
    const liner = M.liner();
    declareRoom(b, "console-helm", "Centre console");
    const HL = LOFT();
    const CK = { z0: -3.35, z1: 1.55, halfW: 0.95 };
    const lines = {
      loa: L, beam: W, draft: 0.42, freeboard: FB,
      sheerBow: 0.42, sheerStern: 0.02,
      deadrise: 22, deadriseBow: 50,          // a real offshore V, warping hard forward
      flareBow: 18, tumblehome: 0,
      transomRake: 9,
      midBody0: 0.16, midBody1: 0.66, transomBeamFrac: 0.92,
      entryPow: 1.7, rockerAft: 1.0, tKeel: 0.34, n: 17,
    };
    let out = null, ST = null;
    if (HL) {
      ST = HL.stationsFromLines(lines);
      loftHull(b, ST, hull, {
        rings: 9, chine: "auto", transom: "flat",
        deck: true, deckCamber: 0.06, deckCols: 9, cockpit: CK,
      });
      out = HL.outline(ST);
    }
    const sheerAt = (z) => (out ? out.sheerYAt(z) : FB);
    const hbAt = (z) => (out ? out.halfBeamAt(z) : hw);
    const keelAt = (z) => (out ? out.keelYAt(z) : -0.42);

    // spray rails on the bottom panel, a strake on the chine and the black
    // rubbing band under the gunwale — all three read off the skin.
    if (HL && ST) {
      [1, -1].forEach(function (side) {
        [0.24, 0.42].forEach(function (up, k) {
          const yOf = (z) => keelAt(z) + (sheerAt(z) - keelAt(z)) * up;
          const rail = HL.strip(skinRun(ST, side, -L * 0.45, L * 0.45, yOf, 0.014, 0.36),
            0.030 - k * 0.007, hull, { segments: 48, radial: 5 });
          if (rail) { rail.castShadow = false; b.add(rail); }
        });
        const ch = HL.strip(chineRun(ST, side, 0.016, 0.0), 0.024, hull, { segments: 46, radial: 5 });
        if (ch) { ch.castShadow = false; b.add(ch); }
        const r = HL.strip(skinRun(ST, side, -L * 0.46, L * 0.45, (z) => sheerAt(z) - 0.05, 0.016, 0.36),
          0.038, dark, { segments: 48, radial: 5 });
        if (r) { r.castShadow = false; b.add(r); }
      });
    }
    // COCKPIT SOLE + BOW CASTING DECK. A centre console is a walk-around: a
    // low self-bailing sole aft and a raised casting platform forward with a
    // step up to it and stowage underneath.
    // THE CASTING DECK IS THE LOFT'S OWN DECK LID. Forward of the cockpit hole
    // the moulded deck already runs the full beam at sheer height, so a
    // "raised platform" box laid on top of it would be a second floor 6 cm
    // above the first — and it would overhang the sheer wherever the hull
    // narrows faster than the box does. What is missing is the bulkhead that
    // makes it a step, and the step itself.
    const SOLE = 0.26, deckY = (z) => sheerAt(z) + 0.06;
    const CAST = deckY(1.90);
    addBox(b, CK.halfW * 2 - 0.06, 0.06, CK.z1 - CK.z0 - 0.10, 0, SOLE, (CK.z0 + CK.z1) * 0.5, teak);
    addBox(b, CK.halfW * 2 - 0.04, deckY(CK.z1) - SOLE, 0.12, 0, (deckY(CK.z1) + SOLE) * 0.5, CK.z1 - 0.05, liner);
    addBox(b, 0.96, 0.06, 0.36, 0, (deckY(CK.z1) + SOLE) * 0.5 + 0.04, CK.z1 - 0.34, teak);   // the step up
    addBox(b, hbAt(1.90) * 1.70, 0.03, 1.10, 0, CAST + 0.045, 1.90, teak);                    // non-skid
    addFixtureBox(b, "anchor-locker", 0.44, 0.05, 0.42, 0, deckY(2.55) + 0.035, 2.55, liner);
    // THE CONSOLE + LEANING POST. A centre console is exactly that: a box on
    // the centreline you stand behind, and a padded post you lean against.
    const cz = -0.15;
    addPrism(b, 0.78, [[cz - 0.42, 0], [cz - 0.38, 1.02], [cz + 0.34, 1.08], [cz + 0.42, 0]], SOLE, liner);
    addBox(b, 0.72, 0.10, 0.62, 0, SOLE + 1.10, cz, dark);                        // dash top
    markFixture(b, addBox(b, 0.30, 0.30, 0.05, -0.20, SOLE + 0.92, cz + 0.36, dark), "wheel");
    addScreen(b, 0.18, SOLE + 0.94, cz + 0.375, 0.34, 0.22, 0, screen);
    addFixtureBox(b, "throttle", 0.07, 0.30, 0.07, 0.30, SOLE + 0.86, cz + 0.10, chrome);
    const wsc = addBox(b, 0.66, 0.28, 0.03, 0, SOLE + 1.24, cz + 0.24, glass);
    wsc.rotation.x = -0.38;
    markFixture(b, wsc, "windscreen");
    addFixtureBox(b, "console-door", 0.40, 0.66, 0.04, 0, SOLE + 0.42, cz - 0.44, dark);
    // leaning post: a padded backrest on a frame with a cooler slid under it
    addBox(b, 0.82, 0.14, 0.34, 0, SOLE + 0.78, cz - 0.86, pad);
    addBox(b, 0.82, 0.42, 0.12, 0, SOLE + 1.02, cz - 1.02, pad);
    [1, -1].forEach(function (side) {
      addBox(b, 0.07, 0.76, 0.07, side * 0.34, SOLE + 0.38, cz - 0.86, grey);
    });
    addFixtureBox(b, "cooler", 0.68, 0.42, 0.50, 0, SOLE + 0.21, cz - 0.86, M.pwcHull());
    addFixtureBox(b, "livewell", 0.86, 0.52, 0.46, 0, SOLE + 0.26, -2.62, liner);
    addFixtureBox(b, "transom-door", 0.46, 0.56, 0.05, 0.62, SOLE + 0.28, -3.30, liner);

    // THE T-TOP: four raked tubes off the sole, a hardtop with an overhang,
    // and a rocket launcher of rod holders across its aft edge.
    const TOP = SOLE + 2.06;
    if (HL) {
      [[0.40, cz + 0.46], [-0.40, cz + 0.46], [0.40, cz - 0.72], [-0.40, cz - 0.72]].forEach(function (p) {
        const legPath = [
          [p[0], SOLE + 0.02, p[1]],
          [p[0] * 1.06, SOLE + 1.00, p[1] + (p[1] > cz ? 0.06 : -0.06)],
          [p[0] * 1.02, TOP - 0.03, p[1] + (p[1] > cz ? 0.10 : -0.10)],
        ];
        const leg = HL.strip(legPath, 0.032, grey, { segments: 14, radial: 7 });
        if (leg) { leg.castShadow = false; b.add(leg); }
      });
    }
    const hard = addBox(b, 1.44, 0.09, 1.90, 0, TOP, cz - 0.10, liner);
    markFixture(b, hard, "hardtop");
    addBox(b, 1.30, 0.05, 1.76, 0, TOP - 0.075, cz - 0.10, dark);                 // its underside
    [-0.46, -0.16, 0.16, 0.46].forEach(function (x) {                             // rocket launcher
      const rh = addCyl(b, 0.026, 0.34, x, TOP + 0.15, cz - 0.98, chrome, 8);
      rh.rotation.x = 0.42;
      markFixture(b, rh, "rod-holder");
    });
    [1, -1].forEach(function (side) {                                             // spreader lights
      addBox(b, 0.10, 0.05, 0.08, side * 0.62, TOP - 0.04, cz + 0.82, M.navWhite());
    });
    // ROD HOLDERS bored through the gunwale capping, angled outboard — solved
    // from the capping down to where the tube actually lands inside the boat.
    [1, -1].forEach(function (side) {
      [-2.40, -1.85, -1.30, 0.40].forEach(function (z) {
        addTubeBetween(b,
          [side * (hbAt(z) - 0.09), sheerAt(z) + 0.05, z],
          [side * (hbAt(z) - 0.20), sheerAt(z) - 0.34, z - 0.10], 0.028, dark, 8);
      });
      // grab rail on the console side and a cleat at each quarter
      markFixture(b, addBox(b, 0.16, 0.05, 0.06, side * (hbAt(-L * 0.44) - 0.12), sheerAt(-L * 0.44) + 0.04, -L * 0.44, chrome), "cleat");
      markFixture(b, addBox(b, 0.15, 0.05, 0.06, side * (hbAt(0.6) - 0.10), sheerAt(0.6) + 0.04, 0.6, chrome), "cleat");
    });
    // BOW RAIL on the sheer, meeting at the stem.
    if (HL) {
      const rail = [];
      for (let i = 0; i <= 6; i++) {
        const z = 1.35 + (3.30 - 1.35) * (i / 6);
        // clamped OFF the centreline for the same reason the speedboat's is.
        rail.push([Math.max(0.06, hbAt(z) - 0.10), sheerAt(z) + 0.28, z]);
      }
      const path = rail.concat([[0, sheerAt(3.55) + 0.24, 3.58]],
        rail.slice().reverse().map(function (p) { return [-p[0], p[1], p[2]]; }));
      const r = HL.strip(path, 0.022, chrome, { segments: 64, radial: 6 });
      if (r) { r.castShadow = false; b.add(r); }
      for (const p of rail) {
        [1, -1].forEach(function (side) {
          addBox(b, 0.035, 0.28, 0.035, side * p[0], p[1] - 0.14, p[2], chrome);
        });
      }
      markFixture(b, addBox(b, 0.20, 0.10, 0.26, 0, deckY(2.95) + 0.09, 2.95, chrome), "windlass");
    }
    // TWIN OUTBOARDS on a bracket. 150 hp each, and their plates are read off
    // the keel line at the transom rather than nudged until they looked right.
    const props = [];
    [0.42, -0.42].forEach(function (x) {
      const ob = outboard(b, x, keelAt(-L * 0.5) + 0.03, -L * 0.5 - 0.18, 150);
      props.push(ob.propAt);
    });
    b.add(propGroup(0.85, props));
    const nz = L * 0.32;
    navLights(b, (hbAt(nz) + 0.01) / 0.97, sheerAt(nz) + 0.08, nz, -L * 0.46, TOP + 0.30);
    return finish(b, { width: W, length: L, height: TOP + 0.5, wheelbase: L * 0.6 });
  }

  // ---- CRUISER — Bellamar Corsa 46 (14m sport cruiser) ---------------------
  // Two levels plus a flybridge. Swim platform and cockpit aft, saloon
  // amidships, side decks to the foredeck, EXTERNAL ladder up to the flybridge
  // helm (research §F: under 20m the helm IS on the flybridge).
  function buildCruiser() {
    const b = new THREE.Group();
    const len = 14, w = 4.2, hw = w * 0.5;
    const hull = M.hull(), topside = M.hullDark(), boot = M.boot(), teak = M.teak();
    const dark = M.dark(), glass = M.glass(), chrome = M.chrome(), pad = M.pad();
    const liner = M.liner(), wood = M.wood(), screen = M.screen(), warm = M.warm();
    const SHEER = 1.30, KEEL = -1.10;
    declareRoom(b, "cruiser-cockpit", "Aft cockpit");
    declareRoom(b, "cruiser-saloon", "Main saloon and lower helm");
    declareRoom(b, "cruiser-flybridge", "Flybridge");
    // ---- THE HULL: ONE LOFTED SHELL -----------------------------------------
    // Was four width-stepped prisms — vertical sides, a flat bottom and a plan
    // that changed in three visible jumps. A 14 m sport cruiser is a planing
    // deep-V: a hard chine that is the widest point of every section and
    // exits the water forward, deadrise warping from 18 degrees at the transom
    // to 52 at the entry, a flared bow, and a REVERSE-RAKED stem (the top of
    // the stem aft of the forefoot — the one line that dates a modern hull).
    const HL = LOFT();
    let st = null, out = null;
    if (HL) {
      st = HL.stationsFromLines({
        loa: len, beam: w, draft: -KEEL, freeboard: SHEER,
        sheerBow: 0.55, sheerStern: 0.06,
        deadrise: 18, deadriseBow: 52, flareBow: 16, tumblehome: 0,
        transomRake: 6, midBody0: 0.15, midBody1: 0.70, transomBeamFrac: 0.97,
        // entryPow is a TAPER RATE, not a "fineness" dial: above 1 the plan
        // collapses the instant the midbody ends and the forebody becomes a
        // needle with a 3 m foredeck balanced on it. 1.15 reproduces the beam
        // the stepped prisms actually carried at 84% of the length (1.05 m
        // half-beam) while still coming to a real point at the stem.
        entryPow: 1.15, rockerAft: 0.94, tKeel: 0.42, n: 19,
        // THE CHINE, authored. Solved from the deadrise it folds: the plan
        // narrows forward faster than the flare pushes the corner out, so the
        // corner CLIMBED to 0.83 above the waterline at z 2.8 and then dived
        // back to -0.09 by z 5.4 — a crease that ran uphill and then downhill
        // on a planing hull, which is the one thing a chine never does. It
        // is deepest aft, exits the water at about 70% of the length, and
        // sweeps up to the stem from there.
        chineY: function (t) { return 0.34 - 1.55 * Math.pow(Math.max(0, t - 0.34), 1.35); },
      });
      rakeStem(st, 15 * Math.PI / 180, 0.26);
      // The deck lid IS the deck: the cockpit sole, side decks and foredeck
      // all land on the sheer, so the shell closes at the sheer with a crown
      // instead of leaving the hull an open trough seen from the flybridge.
      loftHull(b, st, hull, {
        rings: 11, chine: "auto", transom: "flat",
        deck: true, deckCamber: 0.10, deckCols: 9,
      });
      out = HL.outline(st);
    }
    const sheerAt = (z) => (out ? out.sheerYAt(z) : SHEER);
    const hbAt = (z) => (out ? out.halfBeamAt(z) : hw);
    const keelAt = (z) => (out ? out.keelYAt(z) : KEEL);
    if (HL && st) {
      [1, -1].forEach(function (side) {
        // BOOT STRIPE at the waterline and a dark topside band under the
        // sheer, both laid ON the skin — a straight box could only be right
        // amidships, which is why the old one hung off the bow.
        const bs = HL.strip(skinRun(st, side, -6.7, 6.2, 0.04, 0.012, 0.55), 0.075, boot, { segments: 56, radial: 5 });
        if (bs) { bs.castShadow = false; b.add(bs); }
        const band = HL.strip(skinRun(st, side, -6.7, 6.0, (z) => sheerAt(z) - 0.34, 0.010, 0.55), 0.14, topside, { segments: 56, radial: 5 });
        if (band) { band.castShadow = false; b.add(band); }
        // SPRAY RAIL on the chine itself — the corner the loft reports, not a
        // height somebody guessed. This is the strake that throws the sheet of
        // water down and outboard and keeps the topsides dry.
        const rail = HL.strip(chineRun(st, side, 0.035, 0.01).filter((p) => p[2] > -6.6), 0.055, hull, { segments: 48, radial: 4 });
        if (rail) { rail.castShadow = false; b.add(rail); }
        // HULL WINDOWS: dark panels INSET into the topsides, each one turned to
        // the surface normal at its own station, so they lie on the hull the
        // way glass in a moulding does instead of hovering beside it.
        [[-0.5, 2.4], [2.6, 1.5]].forEach(function (win) {
          const z = win[0], y = sheerAt(z) - 0.62;
          hullPanel(b, st, side, z, y, win[1] + 0.16, 0.44, topside, { thick: 0.05, outset: 0.016 });
          hullPanel(b, st, side, z, y, win[1], 0.30, glass, { thick: 0.05, outset: 0.004 });
        });
      });
    }
    // INTEGRATED SWIM PLATFORM: it is the moulding the transom ends in, so its
    // width is the hull's own width at the transom, not a number.
    const platW = Math.max(2.2, hbAt(-6.95) * 1.72);
    addBox(b, platW, 0.14, 1.0, 0, 0.24, -7.5, teak);
    // the fillet that ties it to the raked transom instead of leaving a step
    addBox(b, platW * 0.94, 0.42, 0.28, 0, 0.42, -7.02, hull);
    addBox(b, 0.34, 0.60, 0.14, 1.20, -0.05, -7.4, chrome);                 // ladder into the water
    addBox(b, 0.34, 0.60, 0.14, 1.20, -0.55, -7.4, chrome);
    // TRANSOM STEPS, platform -> cockpit. Without these the swim platform is a
    // DEAD END: 1.04m in one go is past physics.js's 0.45m STEP_UP, so anyone
    // who climbed aboard from the water could never get into the boat.
    addStairs(b, 1.20, 0.70, -7.0, 1, 0.31, 1.35, 3, teak);
    // COCKPIT: teak sole aft with an L-settee and a wet bar against the saloon.
    addBox(b, 3.6, 0.10, 4.4, 0, SHEER, -4.4, teak);
    addBox(b, 3.4, 0.42, 0.55, 0, SHEER + 0.26, -6.4, pad);                 // transom settee
    addBox(b, 0.55, 0.42, 2.0, 1.45, SHEER + 0.26, -5.2, pad);              // side settee
    addBox(b, 1.2, 0.85, 0.5, -1.0, SHEER + 0.47, -2.5, dark);              // wet bar
    // SALOON / superstructure. Half-width 1.40 so the side decks (1.40..2.10)
    // stay clear — that gap IS the circulation loop.
    const SUP = 3.60;
    addCabinShell(b, { width: 2.80, z0: -2.20, z1: 2.85, y0: SHEER, y1: SUP,
      doorW: 1.05, body: hull, liner: liner, glass: glass });
    [1, -1].forEach(function (side) {
      // SIDE DECK: a ribbon between the deck edge and the saloon side, so it
      // follows the sheer up toward the bow and narrows with the hull instead
      // of being a 7.2 m box that stands proud of the topsides forward.
      const inner = [], outer = [];
      for (let i = 0; i <= 12; i++) {
        const z = -2.2 + (8.4 * i) / 12;
        const y = sheerAt(z) + 0.05;
        outer.push([side * Math.max(0.30, hbAt(z) - 0.10), y, z]);
        inner.push([side * Math.max(0.20, Math.min(1.40, hbAt(z) - 0.78)), y, z]);
      }
      sheet(b, [inner, outer], teak, { flip: side > 0 });
      // BULWARK + capping along the same deck edge, as a wall rather than a
      // straight slab: the toe rail a person's foot actually meets.
      bulwark(b, out || { sheerYAt: () => SHEER, halfBeamAt: () => hw },
        side, -2.2, 6.1, 0.52, 0.09, hull, liner, chrome, 0.7);
      sheerRail(b, out || { sheerYAt: () => SHEER, halfBeamAt: () => hw },
        side, -2.0, 6.0, 0.52, chrome, { spacing: 1.7, inset: 0.16, height: 0.80 });
    });
    // A real saloon inside the shell: warm sole and headliner, a clear central
    // aisle from the sliding door, lounge/dinette, compact galley and a lower
    // helm. Keeping furniture to the sides makes the room traversable.
    addBox(b, 2.58, 0.08, 4.72, 0, SHEER + 0.08, 0.22, wood);
    addBox(b, 2.54, 0.06, 4.55, 0, SUP - 0.20, 0.22, liner);
    addFixtureBox(b, "settee", 0.58, 0.52, 2.10, 0.98, SHEER + 0.36, -0.55, pad);
    addFixtureBox(b, "settee-back", 0.12, 0.74, 2.10, 1.23, SHEER + 0.73, -0.55, pad);
    addTable(b, 0.28, SHEER + 0.08, -0.55, 0.82, 1.05, wood, chrome);
    addCabinet(b, -1.02, SHEER + 0.08, 0.25, 0.46, 0.88, 1.35, liner);
    addFixtureBox(b, "galley-counter", 0.52, 0.10, 1.42, -0.98, SHEER + 1.00, 0.25, wood);
    addFixtureBox(b, "helm-console", 2.10, 0.72, 0.55, 0, SHEER + 0.48, 2.20, dark);
    addScreen(b, -0.48, SHEER + 1.03, 1.91, 0.48, 0.27, 0, screen);
    addScreen(b, 0.10, SHEER + 1.03, 1.91, 0.48, 0.27, 0, screen);
    addSeat(b, 0.62, SHEER + 0.08, 1.25, 0, pad, chrome);
    addFixtureBox(b, "saloon-light", 0.75, 0.04, 0.28, 0, SUP - 0.25, 0.0, warm);
    // FOREDECK: the deck BETWEEN the coachroof and the stem, so it is the
    // shape of the deck edge there — narrowing, rising with the sheer — not a
    // 3 x 3 m slab that hung a metre outboard of a hull this fine forward.
    (function () {
      const fwd = [], mid = [], cl = [];
      for (let i = 0; i <= 10; i++) {
        const z = 3.1 + (3.5 * i) / 10;
        const y = sheerAt(z) + 0.04, x = Math.max(0.05, hbAt(z) - 0.08);
        fwd.push([x, y, z]); mid.push([0, y + 0.03, z]); cl.push([-x, y, z]);
      }
      sheet(b, [fwd, mid, cl], teak, {});
    })();
    addBox(b, 1.9, 0.16, 1.7, 0, sheerAt(4.4) + 0.16, 4.4, pad);            // sunpad
    addBox(b, 0.40, 0.24, 0.40, 0, sheerAt(6.1) + 0.20, 6.1, chrome);       // windlass
    // EXTERNAL LADDER to the flybridge, on the starboard side aft of the saloon
    addStairs(b, 1.55, 0.75, -2.05, 1, SHEER + 0.15, 3.75, 6, chrome);
    // FLYBRIDGE: sole, helm console, twin seats, radar arch.
    addBox(b, 3.0, 0.12, 4.2, 0, 3.75, 0.5, teak);
    addPrism(b, 2.0, [[1.6, 0], [1.7, 0.95], [2.4, 1.0], [2.5, 0]], 3.81, dark);   // helm console
    const fbGlass = addBox(b, 2.3, 0.60, 0.06, 0, 4.95, 2.55, glass);
    fbGlass.rotation.x = -0.45;
    addBox(b, 0.28, 0.28, 0.05, 0.45, 4.62, 1.95, dark);                    // wheel
    [0.65, -0.65].forEach(function (x) {
      addBox(b, 0.52, 0.16, 0.52, x, 3.97, 1.15, pad);
      addBox(b, 0.52, 0.42, 0.12, x, 4.26, 0.90, pad);
    });
    addBox(b, 2.6, 0.14, 1.4, 0, 3.90, -1.1, pad);                          // aft sunpad
    addRail(b, 1.48, -1.5, 2.4, 3.81, chrome, 1.4);
    addRail(b, -1.48, -1.5, 2.4, 3.81, chrome, 1.4);
    // radar arch over the flybridge aft edge, solved from deck sockets to the
    // cross member so neither leg can float after a proportion change.
    [1, -1].forEach(function (side) {
      addTubeBetween(b, [side * 1.30, 3.82, -1.35], [side * 1.10, 5.28, -1.60], 0.075, M.grey(), 8);
    });
    addTubeBetween(b, [-1.10, 5.28, -1.60], [1.10, 5.28, -1.60], 0.09, M.grey(), 8);
    addCyl(b, 0.30, 0.10, 0, 5.42, -1.6, M.grey(), 10);                     // radome
    b.userData.marineFixtureCount += 8;                                      // cockpit + flybridge authored fittings
    // twin sterndrives under the transom
    // sterndrives hung off the transom at the KEEL the loft drew, not at a
    // depth typed in beside a prism that no longer exists
    b.add(propGroup(1.5, [[0.85, keelAt(-6.9) + 0.10, -7.15], [-0.85, keelAt(-6.9) + 0.10, -7.15]]));
    // nav lights on the DECK EDGE where they belong: the hull is 1.0 m wide at
    // z 5.6, so the old hw (2.1) put both lamps in mid-air off the bow.
    navLights(b, hbAt(5.6), sheerAt(5.6) + 0.10, 5.6, -6.9, 5.42);
    return finish(b, { width: w, length: len, height: 5.6, wheelbase: len * 0.6 });
  }

  // ---- YACHT — Nordholm Aurelia 112 (34m motor yacht) ----------------------
  // Research §F's deck stack, stern to bow / bottom to top. This hull is SLOW
  // (16 kn top, 13 kn cruise) and never planes — that is the whole character.
  // Four levels connected by ONE central staircase per level, and side decks
  // running the full length both sides: for a game, that loop is the anatomy
  // that matters, because it is the only fore/aft route that isn't interior.
  const Y = {
    LEN: 34, BEAM: 7.6, HB: 3.8,
    KEEL: -2.20,          // moulded depth below the waterline
    MAIN: 2.30,           // main-deck sole
    SUP1: 5.10,           // main-deck superstructure top / upper-deck underside
    UPPER: 5.30,          // upper-deck sole
    SUP2: 7.95,           // upper superstructure top
    SUN: 8.20,            // sun-deck sole
    PLAT: 0.35,           // swim platform (the boarding point) — at water level
    GAR: 1.05,            // tender-garage floor
  };
  function buildYacht() {
    const b = new THREE.Group();
    const L = Y.LEN, hw = Y.HB;
    const hull = M.hull(), topside = M.hullDark(), boot = M.boot(), teak = M.teak();
    const dark = M.dark(), glass = M.glass(), chrome = M.chrome(), pad = M.pad();
    const grey = M.grey(), liner = M.liner(), wood = M.wood(), screen = M.screen(), warm = M.warm();
    const FB = Y.MAIN;    // freeboard: main deck sits 2.30 above the waterline
    declareRoom(b, "yacht34-saloon", "Main saloon and dining room");
    declareRoom(b, "yacht34-skylounge", "Upper skylounge");
    declareRoom(b, "yacht34-wheelhouse", "Wheelhouse");
    declareRoom(b, "yacht34-garage", "Tender garage");
    declareRoom(b, "yacht34-sundeck", "Sun deck");

    // ---- THE HULL: ONE LOFTED SHELL -----------------------------------------
    // Was FIVE width-stepped prisms — three visible plan jumps and a vertical
    // side. A 34 m semi-displacement motor yacht is round-bilged forward
    // (which is why she is quiet at 13 knots) and hard-chined aft (which is
    // why she can be pushed to 16), carries a pronounced sheer, and closes on
    // a broad low transom. warpBilge() is what makes ONE loft do both ends:
    // stationsFromLines takes a single bilge exponent, so the aft sections get
    // their turn re-solved almost square while the forebody stays round.
    const HL = LOFT();
    let st = null, out = null;
    if (HL) {
      st = HL.stationsFromLines({
        loa: L, beam: Y.BEAM, draft: -Y.KEEL, freeboard: FB,
        sheerBow: 0.80, sheerStern: 0,
        roundBilge: true, bilgeN: 2.2, maxBeamHeight: 0.72,
        flareBow: 22, tumblehome: 4, transomRake: 4,
        tKeel: 0.42, rockerAft: 0.97, n: 21,
        // THE PLAN. The default taper is a power of the REMAINING length, so
        // it starts shedding beam the instant the midbody ends and the
        // forebody becomes a spike. A ship holds her beam and then loses it
        // fast at the very end — the `1 - u^1.75` curve yachts.js proved.
        // It must reach EXACTLY zero at the stem. A plan that floors at 0.02
        // leaves the bow station 7.6 cm wide, which is wider than the loft's
        // collapse threshold — so the two halves never meet and the ship ends
        // in an open rectangular hole you can see the inside of the hull
        // through. THE STEM IS WHERE THE HULL CLOSES.
        planHalfBeam: function (t) {
          if (t < 0.16) return 0.94 + 0.06 * Math.pow(t / 0.16, 0.75);
          if (t <= 0.62) return 1;
          const u = clampN((t - 0.62) / 0.38, 0, 1);
          return Math.max(0, 1 - Math.pow(u, 1.75));
        },
      });
      warpBilge(st, 5.0, 1.9, 0.26, 0.60);
      loftHull(b, st, hull, { rings: 13, transom: "flat" });
      out = HL.outline(st);
    }
    const sheerAt = (z) => (out ? out.sheerYAt(z) : FB);
    const hbAt = (z) => (out ? out.halfBeamAt(z) : hw);
    const keelAt = (z) => (out ? out.keelYAt(z) : Y.KEEL);
    if (HL && st) {
      [1, -1].forEach(function (side) {
        // Boot stripe, topside band and the AFT CHINE STRAKE, all read off the
        // skin so they stay on it as the hull narrows.
        const bs = HL.strip(skinRun(st, side, -16.6, 15.4, 0.10, 0.02, 1.1), 0.14, boot, { segments: 70, radial: 5 });
        if (bs) { bs.castShadow = false; b.add(bs); }
        const band = HL.strip(skinRun(st, side, -16.6, 14.6, (z) => sheerAt(z) - 0.62, 0.02, 1.1), 0.22, topside, { segments: 70, radial: 5 });
        if (band) { band.castShadow = false; b.add(band); }
        const chine = HL.strip(chineRun(st, side, 0.05, 0).filter((p) => p[2] < 3.0), 0.10, hull, { segments: 40, radial: 4 });
        if (chine) { chine.castShadow = false; b.add(chine); }
        // BOW THRUSTER TUNNEL — a real ship has one and you can see it: a dark
        // disc a third of the way down the stem, one each side of the same
        // athwartships tube.
        hullDisc(b, st, side, 13.2, keelAt(13.2) * 0.52, 0.46, dark, { thick: 0.10, seg: 16 });
        // ANCHOR POCKET: the recess the hook sits in, and the pipe above it.
        // Proud by 8 mm, not sunk: a panel pushed INTO the skin grazes it and
        // z-fights, which reads as a dithered black rectangle bolted to the bow.
        hullPanel(b, st, side, 15.1, FB - 0.35, 0.90, 0.62, dark, { thick: 0.05, outset: 0.008 });
        // HULL PORTLIGHTS: the lower-deck cabin row, on the skin, each turned
        // to the surface normal at its own station.
        [-7.6, -5.4, -3.2, -1.0, 1.2, 3.4, 5.6].forEach(function (z) {
          hullDisc(b, st, side, z, FB - 1.35, 0.20, glass, { thick: 0.07, seg: 12, outset: 0.005 });
        });
      });
    }
    // BULBOUS BOW, seated on the forefoot the loft actually drew.
    const bulbZ = 15.2;
    addCyl(b, 0.55, 2.4, 0, keelAt(bulbZ) - 0.30, bulbZ, hull, 10).rotation.x = Math.PI / 2;
    addCyl(b, 0.40, 0.40, 0, keelAt(bulbZ) - 0.30, bulbZ + 1.15, hull, 10).rotation.x = Math.PI / 2;

    // ---- SWIM PLATFORM / TRANSOM (water level) — THE boarding point.
    addBox(b, 5.2, 0.18, 1.6, 0, Y.PLAT, -17.4, teak);
    addBox(b, 1.0, 0.10, 0.30, 2.0, Y.PLAT - 0.45, -17.2, chrome);   // boarding steps
    addBox(b, 1.0, 0.10, 0.30, 2.0, Y.PLAT - 0.90, -17.2, chrome);
    // fresh-water shower post + a pair of cleats
    addBox(b, 0.10, 0.85, 0.10, -2.2, Y.PLAT + 0.45, -17.1, chrome);
    // ---- TENDER GARAGE just forward of it, hinged transom door.
    addBox(b, 4.6, 0.14, 2.4, 0, Y.GAR, -15.4, grey);
    addBox(b, 4.8, 1.30, 0.12, 0, Y.GAR + 0.75, -16.55, topside);    // transom door
    // The tender is the actual registry RIB builder, stowed athwartships—not a
    // blue box labelled "RIB". Rename its prop so the yacht's own screws remain
    // the animated boatProp selected by finish().
    const storedTender = buildDinghy();
    storedTender.name = "yacht34_stowed_tender";
    // The tender is a REGISTRY BUILD, so it arrives carrying its own
    // `hull_surface` mesh and its own hullSurface flag. Anything that asks
    // "which mesh is this vessel's shell" then finds the RIB's 3.9 m loft
    // inside a 34 m yacht and reports the yacht's beam as 3.9 m out. Same
    // reason its prop is renamed two lines down.
    storedTender.traverse(function (o) {
      if (o.name === "hull_surface") o.name = "yacht34_stowed_hull";
      if (o.userData && o.userData.hullSurface) delete o.userData.hullSurface;
    });
    storedTender.position.set(0, Y.GAR + 0.30, -15.20);
    storedTender.rotation.y = Math.PI / 2;
    storedTender.scale.setScalar(0.86);
    const storedProp = storedTender.getObjectByName("boat_prop");
    if (storedProp) storedProp.name = "yacht34_stowed_prop";
    delete storedTender.userData.boatProp;
    b.add(storedTender);
    addFixtureBox(b, "tender-cradle", 0.18, 0.28, 1.80, 0.86, Y.GAR + 0.17, -15.2, chrome);
    addFixtureBox(b, "tender-cradle", 0.18, 0.28, 1.80, -0.86, Y.GAR + 0.17, -15.2, chrome);
    addCabinet(b, -1.80, Y.GAR + 0.07, -14.65, 0.48, 0.82, 1.25, liner);
    addFixtureBox(b, "garage-light", 1.25, 0.05, 0.24, 0, Y.GAR + 2.05, -15.25, warm);
    // TRANSOM STAIRS, swim platform -> beach club, one flight each side of the
    // garage door. 1.93m in one step is far past physics.js's 0.45m STEP_UP:
    // without these the boarding point is a dead end and a swimmer who hauls
    // out onto the platform can never reach the rest of the boat.
    [1, -1].forEach(function (side) {
      addStairs(b, side * 2.55, 0.80, -16.5, 1, Y.PLAT + 0.09, Y.MAIN + 0.07, 6, teak);
      addBox(b, 0.06, 1.00, 2.3, side * 2.95, Y.PLAT + 1.20, -15.4, chrome);   // stair rail
    });
    // ---- AFT DECK / "BEACH CLUB": the social hub, day beds and a bar.
    addBox(b, 6.8, 0.14, 4.6, 0, Y.MAIN, -13.4, teak);
    addBox(b, 6.4, 0.42, 0.55, 0, Y.MAIN + 0.28, -15.4, pad);        // aft day bed
    [1, -1].forEach(function (side) {
      addBox(b, 0.60, 0.42, 2.6, side * 2.9, Y.MAIN + 0.28, -13.2, pad);
      addRail(b, side * 3.35, -16.0, -11.6, Y.MAIN + 0.07, chrome, 1.7);
    });
    addBox(b, 3.0, 0.95, 0.60, 0, Y.MAIN + 0.55, -11.5, dark);       // bar

    // ---- MAIN DECK: alfresco dining cockpit, then the saloon behind sliding
    // glass. Superstructure half-width 2.60 so the side decks (2.60..3.50,
    // 0.90m wide) run clear the full length. That is the critical loop.
    addBox(b, 6.4, 0.14, 3.0, 0, Y.MAIN, -10.0, teak);               // cockpit sole
    addBox(b, 2.6, 0.10, 1.6, 0, Y.MAIN + 0.72, -10.0, teak);        // dining table
    addCabinShell(b, { width: 5.20, z0: -8.60, z1: 9.40, y0: Y.MAIN, y1: Y.SUP1,
      doorW: 1.65, body: hull, liner: liner, glass: glass });
    [1, -1].forEach(function (side) {
      // SIDE DECKS both sides, railed — as a ribbon on the deck EDGE. The
      // 20 m box they used to be ran at a constant 3.50 m half-width through a
      // bow that is 2.78 m wide at z 10, so the last four metres of each side
      // deck hung in the air outboard of the ship.
      const inner = [], outer = [];
      for (let i = 0; i <= 16; i++) {
        const z = -9.6 + (16.0 * i) / 16;
        const y = sheerAt(z) + 0.08;
        outer.push([side * Math.max(0.4, hbAt(z) - 0.16), y, z]);
        inner.push([side * Math.max(0.3, Math.min(2.60, hbAt(z) - 1.02)), y, z]);
      }
      sheet(b, [inner, outer], teak, { flip: side > 0 });
      bulwark(b, out || { sheerYAt: () => FB, halfBeamAt: () => hw },
        side, -9.6, 12.4, 0.78, 0.14, hull, liner, chrome, 1.1);
      sheerRail(b, out || { sheerYAt: () => FB, halfBeamAt: () => hw },
        side, -9.4, 11.6, 0.78, chrome, { spacing: 2.0, inset: 0.24, height: 0.85 });
    });
    // Main saloon: the shell now contains a deliberate room with an open
    // centre aisle. The long lounge, dining zone and galley each occupy a side
    // instead of being one giant console-shaped obstruction.
    addBox(b, 4.96, 0.08, 17.0, 0, Y.MAIN + 0.08, 0.35, wood);
    addBox(b, 4.84, 0.06, 16.3, 0, Y.SUP1 - 0.20, 0.15, liner);
    addFixtureBox(b, "saloon-settee", 0.68, 0.50, 4.1, 1.88, Y.MAIN + 0.35, -4.4, pad);
    addFixtureBox(b, "saloon-settee-back", 0.14, 0.78, 4.1, 2.18, Y.MAIN + 0.72, -4.4, pad);
    addTable(b, 0.72, Y.MAIN + 0.08, -4.4, 1.35, 1.25, wood, chrome);
    addTable(b, 0, Y.MAIN + 0.08, 1.25, 2.1, 1.25, wood, chrome);
    [[-1.30, 0.45], [1.30, 0.45], [-1.30, 2.05], [1.30, 2.05]].forEach(function (p) {
      addSeat(b, p[0], Y.MAIN + 0.08, p[1], p[1] < 1 ? Math.PI : 0, pad, chrome);
    });
    addCabinet(b, -2.05, Y.MAIN + 0.08, 4.05, 0.62, 0.94, 3.0, liner);
    addFixtureBox(b, "galley-counter", 0.72, 0.10, 3.0, -2.00, Y.MAIN + 1.07, 4.05, wood);
    addScreen(b, 2.28, Y.MAIN + 1.45, -1.5, 1.15, 0.72, Math.PI / 2, screen);
    [-5.0, 0.0, 5.0].forEach(function (z) {
      addFixtureBox(b, "ceiling-light", 0.95, 0.04, 0.28, 0, Y.SUP1 - 0.25, z, warm);
    });
    // ---- FOREDECK: windlass, anchor locker, forward sunpad. The deck is the
    // shape of the DECK EDGE — it narrows to the stem and climbs with the
    // sheer, which a 5 x 4.4 m slab at one height cannot do on a bow that
    // loses 2 m of half-beam over its own length.
    (function () {
      const p = [], m = [], s = [];
      for (let i = 0; i <= 12; i++) {
        const z = 9.6 + (7.0 * i) / 12;
        const y = sheerAt(z) + 0.08, x = Math.max(0.06, hbAt(z) - 0.16);
        p.push([x, y, z]); m.push([0, y + 0.05, z]); s.push([-x, y, z]);
      }
      sheet(b, [p, m, s], teak, {});
    })();
    addBox(b, 2.9, 0.20, 2.6, 0, sheerAt(12.0) + 0.22, 12.0, pad);   // forward sunpad
    addBox(b, 0.70, 0.36, 0.70, 0, sheerAt(14.9) + 0.28, 14.9, chrome);  // windlass
    addBox(b, 0.30, 0.50, 0.70, 0, sheerAt(16.2) - 0.15, 16.2, chrome);  // anchor in the pocket

    // ---- ONE CENTRAL STAIRCASE, main -> upper, on the centreline aft of the
    // saloon. The visual boxes and the walkable decks are generated from the
    // SAME call arguments (addStairs / stairDecks below).
    addStairs(b, 0, 1.40, -9.3, 1, Y.MAIN + 0.14, Y.UPPER, 8, teak);
    [1, -1].forEach(function (side) {
      addBox(b, 0.08, 1.00, 3.0, side * 0.74, Y.MAIN + 1.7, -7.9, chrome);   // stair rail
    });

    // ---- UPPER DECK: skylounge aft, WHEELHOUSE FORWARD ON THIS DECK (§F: not
    // at the very top on a hull this size).
    addBox(b, 5.6, 0.16, 17.6, 0, Y.UPPER, 0.2, teak);
    addCabinShell(b, { width: 4.60, z0: -6.60, z1: 7.40, y0: Y.UPPER, y1: Y.SUP2,
      doorW: 1.45, body: hull, liner: liner, glass: glass });
    [1, -1].forEach(function (side) {
      // upper side decks
      addBox(b, 0.80, 0.12, 12.0, side * 2.65, Y.UPPER + 0.16, 1.0, teak);
      addRail(b, side * 3.00, -6.0, 8.0, Y.UPPER + 0.22, chrome, 2.0);
    });
    // Skylounge aft of the bridge, distinct in palette and arrangement from
    // the main saloon below.
    addBox(b, 4.30, 0.06, 12.8, 0, Y.SUP2 - 0.20, 0.15, liner);
    addFixtureBox(b, "skylounge-settee", 3.45, 0.48, 0.72, 0, Y.UPPER + 0.34, -4.95, pad);
    addFixtureBox(b, "skylounge-settee-back", 3.45, 0.78, 0.14, 0, Y.UPPER + 0.72, -5.26, pad);
    addTable(b, 0, Y.UPPER + 0.08, -3.25, 1.45, 1.1, wood, chrome);
    addCabinet(b, 1.88, Y.UPPER + 0.08, -1.8, 0.54, 0.92, 2.6, liner);
    addFixtureBox(b, "skylounge-bar", 0.65, 0.10, 2.6, 1.85, Y.UPPER + 1.08, -1.8, wood);
    // wheelhouse: raked screen, console, two helm chairs
    const wh = addBox(b, 4.2, 1.30, 0.12, 0, Y.UPPER + 1.75, 7.05, glass);
    wh.rotation.x = -0.32;
    addPrism(b, 3.60, [[5.2, Y.UPPER + 0.16], [5.3, Y.UPPER + 1.05], [6.6, Y.UPPER + 1.10], [6.8, Y.UPPER + 0.16]], 0, dark);
    addBox(b, 0.34, 0.34, 0.06, 0.0, Y.UPPER + 1.28, 5.9, dark);
    [-1.10, 0, 1.10].forEach(function (x) {
      addScreen(b, x, Y.UPPER + 1.32, 5.36, 0.82, 0.42, 0, screen);
    });
    [0.85, -0.85].forEach(function (x) {
      addBox(b, 0.56, 0.18, 0.56, x, Y.UPPER + 0.55, 4.9, pad);
      addBox(b, 0.56, 0.50, 0.14, x, Y.UPPER + 0.90, 4.62, pad);
    });
    addTable(b, 1.65, Y.UPPER + 0.08, 3.55, 0.90, 1.20, wood, chrome);     // chart table
    addCabinet(b, -1.92, Y.UPPER + 0.08, 3.45, 0.46, 0.88, 1.55, liner);

    // ---- SECOND STAIRCASE, upper -> sun deck.
    addStairs(b, 0, 1.30, -6.4, 1, Y.UPPER + 0.16, Y.SUN, 8, teak);

    // ---- SUN DECK (top): sunpads, jacuzzi, bar, davit. No helipad — research
    // §F is explicit that nothing under ~65m carries one.
    addBox(b, 4.8, 0.16, 11.0, 0, Y.SUN, -0.6, teak);
    addBox(b, 3.6, 0.22, 2.8, 0, Y.SUN + 0.19, -4.0, pad);           // sunpads
    addBox(b, 2.4, 0.70, 2.4, 0, Y.SUN + 0.35, 1.2, M.grey());       // jacuzzi shell
    addBox(b, 2.0, 0.10, 2.0, 0, Y.SUN + 0.62, 1.2, glass);          // the water in it
    addBox(b, 2.6, 0.95, 0.60, 0, Y.SUN + 0.48, 3.6, dark);          // bar
    [1, -1].forEach(function (side) {
      addRail(b, side * 2.30, -5.6, 4.4, Y.SUN + 0.08, chrome, 1.8);
    });
    // mast / radar arch: sockets on the sun deck, exact crossbar endpoints.
    [1, -1].forEach(function (side) {
      addTubeBetween(b, [side * 1.20, Y.SUN + 0.08, 4.28], [side * 1.02, Y.SUN + 2.05, 4.60], 0.085, grey, 8);
    });
    addTubeBetween(b, [-1.02, Y.SUN + 2.05, 4.60], [1.02, Y.SUN + 2.05, 4.60], 0.10, grey, 8);
    addCyl(b, 0.34, 0.14, 0, Y.SUN + 2.22, 4.6, grey, 10);
    addTubeBetween(b, [0, Y.SUN + 2.05, 4.60], [0, Y.SUN + 3.40, 4.60], 0.055, grey, 8);
    b.userData.marineFixtureCount += 9;                               // exterior social/helm fittings

    // twin shafts + screws well under the counter
    b.add(propGroup(2.6, [[1.55, Y.KEEL * 0.72, -15.6], [-1.55, Y.KEEL * 0.72, -15.6]]));
    // lamps on the DECK EDGE at z 13.8, where the hull is 1.5 m wide — not at
    // the maximum half-beam, which floated them 2.3 m off the bow.
    navLights(b, hbAt(13.8), sheerAt(13.8) + 0.20, 13.8, -16.6, Y.SUN + 3.30);
    return finish(b, { width: Y.BEAM, length: Y.LEN, height: 11.4, wheelbase: Y.LEN * 0.6 });
  }

  // ---- DECK SPECS (LOCAL space, consumed by CBZ.movingPlatform) ------------
  function cruiserDeck() {
    const SHEER = 1.30;
    const decks = [
      { x: 0, z: -7.5, w: 3.0, d: 1.0, top: 0.24 + 0.07 },        // swim platform
      { x: 0, z: -4.4, w: 3.6, d: 4.4, top: SHEER + 0.05 },       // cockpit sole
      // the side decks are a ribbon on the sheer now, so their sole is the
      // sheer + 0.06 rather than a hand-typed SHEER + 0.20
      { x: 1.70, z: 1.4, w: 0.66, d: 7.2, top: SHEER + 0.09 },    // side deck port
      { x: -1.70, z: 1.4, w: 0.66, d: 7.2, top: SHEER + 0.09 },   // side deck stbd
      { x: 0, z: 0.2, w: 2.58, d: 4.72, top: SHEER + 0.12 },      // enterable saloon sole
      { x: 0, z: 4.6, w: 2.0, d: 2.8, top: SHEER + 0.29 },        // foredeck
      { x: 0, z: 0.5, w: 3.0, d: 4.2, top: 3.81 },                // flybridge
    ];
    stairDecks(decks, 1.20, 0.70, -7.0, 1, 0.31, 1.35, 3);        // transom -> cockpit
    stairDecks(decks, 1.55, 0.75, -2.05, 1, SHEER + 0.15, 3.75, 6);
    return {
      decks: decks,
      walls: [
        // Saloon perimeter, not one solid blocker. The 1.0 m opening in the
        // aft face matches the sliding door and makes the authored room real.
        { x: 1.40, z: 0.2, w: 0.10, d: 4.8, y0: SHEER + 0.12, y1: 3.60 },
        { x: -1.40, z: 0.2, w: 0.10, d: 4.8, y0: SHEER + 0.12, y1: 3.60 },
        { x: 0.92, z: -2.18, w: 0.84, d: 0.10, y0: SHEER + 0.12, y1: 3.60 },
        { x: -0.92, z: -2.18, w: 0.84, d: 0.10, y0: SHEER + 0.12, y1: 3.60 },
        { x: 0, z: 2.82, w: 2.70, d: 0.10, y0: SHEER + 0.12, y1: 3.60 },
        { x: 2.03, z: 1.4, w: 0.10, d: 7.2, y0: SHEER + 0.09, y1: SHEER + 1.10 },
        { x: -2.03, z: 1.4, w: 0.10, d: 7.2, y0: SHEER + 0.09, y1: SHEER + 1.10 },
        { x: 1.48, z: 0.45, w: 0.08, d: 3.9, y0: 3.81, y1: 4.75 },  // flybridge rails
        { x: -1.48, z: 0.45, w: 0.08, d: 3.9, y0: 3.81, y1: 4.75 },
      ],
      riders: true, yaw: true, camYaw: false, bodyYaw: true, tilt: true,
      onLeave: "upward", id: "cruiser-decks",
    };
  }
  function yachtDeck() {
    const decks = [
      { x: 0, z: -17.4, w: 5.2, d: 1.6, top: Y.PLAT + 0.09 },       // swim platform
      { x: 0, z: -15.4, w: 4.6, d: 2.4, top: Y.GAR + 0.07 },        // tender garage
      { x: 0, z: -13.4, w: 6.8, d: 4.6, top: Y.MAIN + 0.07 },       // beach club
      { x: 0, z: -10.0, w: 6.4, d: 3.0, top: Y.MAIN + 0.07 },       // dining cockpit
      // the side decks follow the deck edge now: 16 m of run, inside the
      // half-beam at BOTH ends (they used to be 20 m boxes at a constant 3.50
      // through a bow 2.78 m wide)
      { x: 3.02, z: -1.6, w: 0.86, d: 16.0, top: Y.MAIN + 0.14 },   // side deck port
      { x: -3.02, z: -1.6, w: 0.86, d: 16.0, top: Y.MAIN + 0.14 },  // side deck stbd
      { x: 0, z: 0.35, w: 4.96, d: 17.0, top: Y.MAIN + 0.12 },      // enterable main saloon
      { x: 0, z: 11.6, w: 3.6, d: 3.6, top: Y.MAIN + 0.42 },        // foredeck
      { x: 0, z: 0.2, w: 5.6, d: 17.6, top: Y.UPPER + 0.08 },       // upper deck
      { x: 2.65, z: 1.0, w: 0.80, d: 12.0, top: Y.UPPER + 0.22 },   // upper side deck
      { x: -2.65, z: 1.0, w: 0.80, d: 12.0, top: Y.UPPER + 0.22 },
      { x: 0, z: -0.6, w: 4.8, d: 11.0, top: Y.SUN + 0.08 },        // sun deck
    ];
    // transom -> beach club, both sides (the boarding route off the platform)
    stairDecks(decks, 2.55, 0.80, -16.5, 1, Y.PLAT + 0.09, Y.MAIN + 0.07, 6);
    stairDecks(decks, -2.55, 0.80, -16.5, 1, Y.PLAT + 0.09, Y.MAIN + 0.07, 6);
    stairDecks(decks, 0, 1.40, -9.3, 1, Y.MAIN + 0.14, Y.UPPER, 8);   // main -> upper
    stairDecks(decks, 0, 1.30, -6.4, 1, Y.UPPER + 0.16, Y.SUN, 8);    // upper -> sun
    return {
      decks: decks,
      walls: [
        // Main saloon perimeter with an aft double-door opening.
        { x: 2.60, z: 0.4, w: 0.12, d: 18.0, y0: Y.MAIN + 0.12, y1: Y.SUP1 },
        { x: -2.60, z: 0.4, w: 0.12, d: 18.0, y0: Y.MAIN + 0.12, y1: Y.SUP1 },
        { x: 1.75, z: -8.56, w: 1.70, d: 0.12, y0: Y.MAIN + 0.12, y1: Y.SUP1 },
        { x: -1.75, z: -8.56, w: 1.70, d: 0.12, y0: Y.MAIN + 0.12, y1: Y.SUP1 },
        { x: 0, z: 9.38, w: 5.10, d: 0.12, y0: Y.MAIN + 0.12, y1: Y.SUP1 },
        // Upper skylounge / wheelhouse perimeter, also entered at the aft glass.
        { x: 2.30, z: 0.4, w: 0.12, d: 14.0, y0: Y.UPPER + 0.12, y1: Y.SUP2 },
        { x: -2.30, z: 0.4, w: 0.12, d: 14.0, y0: Y.UPPER + 0.12, y1: Y.SUP2 },
        { x: 1.55, z: -6.56, w: 1.45, d: 0.12, y0: Y.UPPER + 0.12, y1: Y.SUP2 },
        { x: -1.55, z: -6.56, w: 1.45, d: 0.12, y0: Y.UPPER + 0.12, y1: Y.SUP2 },
        { x: 0, z: 7.38, w: 4.50, d: 0.12, y0: Y.UPPER + 0.12, y1: Y.SUP2 },
        { x: 3.52, z: -1.6, w: 0.14, d: 16.0, y0: Y.MAIN + 0.14, y1: Y.MAIN + 1.30 },
        { x: -3.52, z: -1.6, w: 0.14, d: 16.0, y0: Y.MAIN + 0.14, y1: Y.MAIN + 1.30 },
        { x: 3.00, z: 1.0, w: 0.10, d: 12.0, y0: Y.UPPER + 0.22, y1: Y.UPPER + 1.20 },
        { x: -3.00, z: 1.0, w: 0.10, d: 12.0, y0: Y.UPPER + 0.22, y1: Y.UPPER + 1.20 },
        { x: 2.30, z: -0.6, w: 0.10, d: 10.0, y0: Y.SUN + 0.08, y1: Y.SUN + 1.05 },
        { x: -2.30, z: -0.6, w: 0.10, d: 10.0, y0: Y.SUN + 0.08, y1: Y.SUN + 1.05 },
      ],
      riders: true, yaw: true, camYaw: false, bodyYaw: true,
      // tilt: the rig reads the hull's live pitch/roll, so a pitching deck
      // raises and lowers a standing rider correctly at the bow. On a 34m hull
      // in a swell that is the difference between a deck and a floor.
      tilt: true, onLeave: "upward", id: "yacht-decks",
    };
  }

  // ============================================================
  //  4. REGISTRATION
  // ============================================================
  // kayak — 4.2 m sit-on-top. PADDLED: no engine, no prop, no audio. It is
  // here because the sea should have things on it small enough to be eaten
  // whole, and because a hull with no motor proves the registry carries
  // CRAFT rather than just motorboats.
  register("kayak", {
    label: "Sandbar 14", marque: "Sandbar", model: "Sandbar 14",
    price: 900, build: buildKayak,
    hull: {
      loa: 4.2, beam: 0.72, draft: 0.12, massT: 0.03, freeboard: 0.28,
      topKts: 5, cruiseKts: 3.2, planeKts: 0, canPlane: false,
      engine: false,
      // A paddler makes ~60 W of useful thrust against 30 kg of boat and 80 kg
      // of body: quick off the mark for a second and then that is all there is.
      accel0: 0.55, humpFrac: 0.30,
      // A kayak turns on a stroke and a hip, not on thrust vectoring.
      steerKind: "rudder", steerLock: 0.75, steerRate: 6.0,
      yawRate: 1.90, yawAccel: 6.5, yawDamp: 3.4, pivotAft: 0.35,
      swayL: 3.4, swayQ: 0.60,
      trimRestDeg: 0.4, trimHumpDeg: 1.0, trimPlaneDeg: 0.4,
      heelSign: 1, heelGain: 0.090, maxHeel: 0.40,     // tippy, and it should feel it
      rideAbove: 0.02, waveGain: 1.25, slamV: 1.6,     // every ripple moves it
      deckY: 0.24, boardY: 0.26, sternOffset: 2.10,
      helm: { x: 0, y: 1.02, z: 0.10 },                // a seated paddler's eye
      wakeScale: 0.18, audio: "none",
      stab: {
        gm: 0.05, phiV: 0.70, freeboard: 0.28, swampT: 2, crew: 1,
        seats: [{ x: 0, y: 0.20, z: 0.05, yaw: 0 }],
      },
    },
    feel: { accel: 0.30, top: 0.12, turn: 1.9, drift: 1.8, roll: 1.4 },
  });

  // jetski — 3.3 m PWC. Nothing else in the fleet accelerates like this, and
  // nothing else in the fleet has no propeller.
  register("jetski", {
    label: "Vareo GT", marque: "Vareo", model: "Vareo GT",
    price: 14000, build: buildJetski,
    hull: {
      loa: 3.3, beam: 1.2, draft: 0.30, massT: 0.38, freeboard: 0.30,
      topKts: 55, cruiseKts: 38, planeKts: 6, canPlane: true,
      // 380 kg on a 160 hp pump: on the plane in under two seconds, and its
      // hump (Fn 0.5 = 2.7 m/s) is behind it before you finish squeezing.
      accel0: 6.2, humpFrac: 0.30,
      // A JET has no rudder: no throttle, no steering. steerKind "thrust" is
      // exactly that contract in water_helm.js.
      steerKind: "thrust", steerLock: 0.80, steerRate: 11.0,
      yawRate: 3.10, yawAccel: 12.0, yawDamp: 3.6, pivotAft: 0.90,
      swayL: 3.0, swayQ: 0.52,
      trimRestDeg: 2.0, trimHumpDeg: 9.0, trimPlaneDeg: 4.2,
      heelSign: -1, heelGain: 0.055, maxHeel: 0.42,    // leans hard into a turn
      rideAbove: 0.03, waveGain: 1.15, slamV: 2.2,
      deckY: 0.42, boardY: 0.26, sternOffset: 1.65,
      helm: { x: 0, y: 1.34, z: 0.16 },                // seated at the bars
      wakeScale: 0.55, audio: "bike",
      stab: {
        gm: 0.25, phiV: 1.00, freeboard: 0.30, swampT: 4, crew: 2,
        seats: [{ x: 0, y: 0.78, z: 0.12, yaw: 0 }, { x: 0, y: 0.84, z: -0.84, yaw: 0 }],
      },
    },
    feel: { accel: 1.9, top: 1.25, turn: 2.1, drift: 1.7, roll: 1.1 },
  });

  // dinghy — RIB tender. Planes almost instantly, turns in 1-2 boat lengths.
  register("dinghy", {
    label: "Calanque Tender 15", marque: "Calanque", model: "Calanque Tender 15",
    price: 46000, build: buildDinghy,
    hull: {
      loa: 4.5, beam: 2.0, draft: 0.4, massT: 0.7,
      topKts: 35, cruiseKts: 25, planeKts: 7, canPlane: true,
      // 0 -> 35 kn in ~8s; barely notices the hump (Fn 0.5 is only 3.2 m/s
      // for a 4.5m hull, so it is over it almost the instant you open up).
      accel0: 4.2, humpFrac: 0.42,
      steerKind: "thrust", steerLock: 0.62, steerRate: 8.0,
      // 18.0/2.35 = 7.7m turning radius = 1.7 boat lengths (research §E).
      yawRate: 2.35, yawAccel: 7.0, yawDamp: 3.0, pivotAft: 1.15,
      swayL: 2.7, swayQ: 0.42,
      trimRestDeg: 2.0, trimHumpDeg: 8.0, trimPlaneDeg: 3.4,
      heelSign: -1, heelGain: 0.030, maxHeel: 0.26,     // planing: heels INTO the turn
      rideAbove: 0.04, waveGain: 1.0, slamV: 2.8,       // thrown around by everything
      deckY: 0.15, boardY: 0.30, sternOffset: 2.25,
      // driven STANDING at the little console, one hand on the grab rail
      helm: { x: 0, y: 1.62, z: 0.30 },
      wakeScale: 0.6, audio: "bike",                    // small outboard buzz
      // A RIB's freeboard is the TOP OF THE TUBE, not the sheer: the collar is
      // what green water has to get over, and it is 0.24 m of it above a
      // gunwale that is already 0.38 up at the bow. She is also self-bailing,
      // which is the whole reason swampT is 20 s on a boat this small.
      stab: {
        gm: 0.60, phiV: 1.15, freeboard: 0.55, swampT: 20, crew: 4,
        seats: [
          { x: 0, y: 0.58, z: -0.42, yaw: 0 },          // the jockey seat: the helm
          { x: 0.60, y: 0.64, z: -1.25, yaw: 0 },       // two aft, sitting on the tubes
          { x: -0.60, y: 0.64, z: -1.25, yaw: 0 },
          { x: 0, y: 0.56, z: 0.95, yaw: 0 },           // one forward of the console
        ],
      },
    },
    feel: { accel: 1.25, top: 0.80, turn: 1.5, drift: 1.5, roll: 0.9 },
  });

  // boat — the 6.2 m runabout. Its geometry USED to live in playercars.js
  // makeBoat() and this row carried `build: null` so the registry bounced back
  // there. That split is gone: buildSpeedboat() above owns the art like every
  // other hull in the fleet, and makeBoat() is now a delegate to this row.
  register("boat", {
    label: "Speedboat", marque: "Bellamar", model: "Speedboat",
    price: 15000, build: buildSpeedboat,
    hull: {
      loa: 6.2, beam: 2.1, draft: 0.5, massT: 1.6,
      topKts: 45, cruiseKts: 30, planeKts: 12, canPlane: true,
      // The hump at 3.74 m/s (7.3 kn) eats 58% of the thrust — this is the
      // hull where "wall, then it lets go and surges" is most obvious.
      accel0: 3.6, humpFrac: 0.58,
      steerKind: "thrust", steerLock: 0.55, steerRate: 6.0,
      // 23.1/1.45 = 16m radius = 2.6 boat lengths ("tens of metres", §E).
      yawRate: 1.45, yawAccel: 3.6, yawDamp: 2.2, pivotAft: 1.62,
      swayL: 2.0, swayQ: 0.32,
      trimRestDeg: 2.5, trimHumpDeg: 7.0, trimPlaneDeg: 3.0,
      heelSign: -1, heelGain: 0.022, maxHeel: 0.22,
      // rideAbove WAS 0.36 because the old playercars art was modelled with
      // its keel 0.36 above the group origin and the number was the offset
      // that cancelled it. The lofted hull uses the fleet convention —
      // waterline at local y = 0 — so this is now the same small ride-high
      // every other planing hull in the registry carries.
      rideAbove: 0.05, waveGain: 1.0, slamV: 3.5,
      deckY: 0.24, boardY: 0.14, sternOffset: 3.10,     // sole 0.24, swim step 0.14
      // seated at the console, helm to STARBOARD (-x; navLights puts port red
      // at +x and the whole fleet keeps that sign)
      helm: { x: -0.42, y: 1.48, z: -0.18 },
      wakeScale: 1.0, audio: "sports",                  // big V8 sterndrive
      stab: {
        gm: 0.90, phiV: 1.25, freeboard: 0.62, swampT: 14, crew: 5,
        seats: [
          { x: -0.42, y: 0.70, z: -0.18, yaw: 0 },      // helm bucket
          { x: 0.42, y: 0.70, z: -0.18, yaw: 0 },       // companion bucket
          { x: 0.52, y: 0.62, z: -1.70, yaw: 0 },       // the stern bench, three up
          { x: 0, y: 0.62, z: -1.70, yaw: 0 },
          { x: -0.52, y: 0.62, z: -1.70, yaw: 0 },
        ],
      },
    },
    feel: { accel: 1.0, top: 1.1, turn: 1.0, drift: 1.4, roll: 0.6 },
  });

  // console — Baymaster 25. The middle of the ladder, and the boat the sea is
  // actually full of: a 7.5 m centre console on twin 150s. It is also the hull
  // the shark rules need between the RIB and the sport cruiser — too big for a
  // great white to swallow, exactly the right size for a megalodon.
  register("console", {
    label: "Baymaster 25", marque: "Baymaster", model: "Baymaster 25",
    price: 68000, build: buildConsole,
    hull: {
      loa: 7.5, beam: 2.6, draft: 0.55, massT: 2.2,
      topKts: 42, cruiseKts: 28, planeKts: 11, canPlane: true,
      // 2.2 t on twin 150s: onto the plane in about four seconds, and the
      // hump (Fn 0.5 = 3.8 m/s) is gone almost as soon as she trims out.
      accel0: 3.4, humpFrac: 0.55,
      steerKind: "thrust", steerLock: 0.56, steerRate: 6.4,
      // 21.6/1.35 = 16 m radius = 2.1 boat lengths.
      yawRate: 1.35, yawAccel: 3.4, yawDamp: 2.2, pivotAft: 1.95,
      swayL: 2.1, swayQ: 0.34,
      trimRestDeg: 2.4, trimHumpDeg: 7.4, trimPlaneDeg: 3.2,
      heelSign: -1, heelGain: 0.022, maxHeel: 0.22,
      rideAbove: 0.05, waveGain: 0.90, slamV: 3.6,
      deckY: 0.26, boardY: 0.26, sternOffset: 3.75,
      // driven STANDING against the leaning post behind the console
      helm: { x: 0, y: 1.86, z: 0.20 },
      wakeScale: 1.1, audio: "sports",
      stab: {
        gm: 0.90, phiV: 1.20, freeboard: 0.72, swampT: 18, crew: 4,
        seats: [
          { x: 0, y: 1.05, z: -1.01, yaw: 0 },          // the leaning post: the helm
          { x: 0.62, y: 0.73, z: -2.10, yaw: 0 },       // two working the gunwales aft
          { x: -0.62, y: 0.73, z: -2.10, yaw: 0 },
          { x: 0, y: 0.89, z: 1.95, yaw: 0 },           // one on the casting deck
        ],
      },
    },
    feel: { accel: 0.95, top: 1.0, turn: 1.1, drift: 1.35, roll: 0.7 },
  });

  // cruiser — sport cruiser. The turn takes a beat to develop.
  register("cruiser", {
    label: "Bellamar Corsa 46", marque: "Bellamar", model: "Bellamar Corsa 46",
    price: 2400000, build: buildCruiser, deck: cruiserDeck(),
    hull: {
      loa: 14, beam: 4.2, draft: 1.1, massT: 16,
      topKts: 32, cruiseKts: 26, planeKts: 17, canPlane: true,
      // 16 tonnes: ~20s to work up to 32 kn, and a long grind through the
      // hump at 5.6 m/s before it climbs onto its own bow wave.
      accel0: 1.5, humpFrac: 0.55,
      steerKind: "rudder", steerLock: 0.42, steerRate: 3.2,
      // 16.5/0.58 = 28m radius = 2.0 boat lengths; 0.76s to answer the helm.
      yawRate: 0.58, yawAccel: 0.75, yawDamp: 1.15, pivotAft: 3.9,
      thrusterYaw: 0.35,                                // 20 deg/s in a slip
      swayL: 1.15, swayQ: 0.20,
      trimRestDeg: 2.2, trimHumpDeg: 6.0, trimPlaneDeg: 2.6,
      heelSign: -1, heelGain: 0.020, maxHeel: 0.16,
      rideAbove: 0.05, waveGain: 0.55, slamV: 4.2,
      deckY: 1.35, boardY: 0.31, sternOffset: 7.50,
      // driven from the FLYBRIDGE (research §F: under 20m the helm IS the
      // flybridge) — sole 3.81, seated eye behind the console at z 1.6-2.5.
      // The derived formula would seat you inside the saloon below it.
      helm: { x: 0, y: 5.11, z: 1.0 },
      wakeScale: 2.2, audio: "truck",                   // diesels
    },
    feel: { accel: 0.55, top: 0.78, turn: 0.45, drift: 1.1, roll: 0.5 },
  });

  // yacht — 34m motor yacht. SLOW. Seconds of lag between helm and heading.
  // Permanently below the wave-making hump: it can never plane and its top
  // speed is set by hull speed, not by power.
  register("yacht", {
    label: "Nordholm Aurelia 112", marque: "Nordholm", model: "Nordholm Aurelia 112",
    price: 24000000, build: buildYacht, deck: yachtDeck(),
    hull: {
      loa: 34, beam: 7.6, draft: 2.2, massT: 260,
      topKts: 16, cruiseKts: 13, planeKts: 0, canPlane: false,
      // 260 tonnes on ~2 MW: 0.55 m/s^2 from rest, ~27s to reach 16 kn. Its
      // hump is at 8.76 m/s and its top speed is 8.23 — it spends 61% of full
      // power on wave-making at the top end and can never get over.
      accel0: 0.55, humpFrac: 0.72,
      steerKind: "rudder", steerLock: 0.30, steerRate: 1.5,
      // 8.2/0.11 = 75m radius = 2.2 hull lengths, and 2.4s of yaw-accel lag
      // before the hull even begins to answer. Plan your turns.
      yawRate: 0.11, yawAccel: 0.045, yawDamp: 0.55, pivotAft: 9.2,
      thrusterYaw: 0.10,                                // 5.7 deg/s on the thrusters alone
      swayL: 0.50, swayQ: 0.09,
      trimRestDeg: 1.2, trimHumpDeg: 2.6, trimPlaneDeg: 1.2,
      heelSign: 1, heelGain: 0.030, maxHeel: 0.075,     // displacement: heels OUT
      // A 34m 260-tonne hull in a 0.4m swell should BARELY move.
      rideAbove: 0.05, waveGain: 0.22, slamV: 6.0,
      deckY: 2.37, boardY: 0.44, sternOffset: 17.40,
      // the WHEELHOUSE is forward on the upper deck (buildYacht §F): helm
      // chairs at z 4.9 on the Y.UPPER (5.30) sole, console at z 5.2-6.8.
      // Seated eye in the starboard chair, screens on the crosshair.
      helm: { x: -0.85, y: 6.62, z: 4.92 },
      wakeScale: 5.0, audio: "truck",
    },
    feel: { accel: 0.22, top: 0.40, turn: 0.16, drift: 0.7, roll: 0.35 },
  });

  // Every hull queued by an earlier-parsing file joins the fleet HERE — after
  // the authored four, before the economy push, so a queued hull is indexed,
  // priced, buyable and berth-sizable exactly like an authored one.
  drainPending();

  // ============================================================
  //  5. THE ECONOMY — push, never edit economy.js
  // ============================================================
  // cityEcon.SPECIAL_VEHICLES is the LIVE array carByName() closes over, and
  // nothing random ever draws from it (pickCar/traffic/the flip market are all
  // CARS-only), so appending is determinism-safe. A hull that lands here is
  // buyable, garageable and counted in net worth (economy.js holdingsWorth()
  // resolves g.cityGarage through carByName) with ZERO new save code.
  let econPushed = 0;
  function pushEconomy() {
    if (CFG.WATER_HULLS === false || CFG.BOAT_ECONOMY === false) return 0;
    const econ = CBZ.cityEcon;
    const list = econ && econ.SPECIAL_VEHICLES;
    if (!list || !Array.isArray(list)) return 0;
    let n = 0;
    REG.forEach(function (rec, key) {
      if (!rec.model || key === "boat") return;            // "Speedboat" is already in the catalog
      if (list.some(function (c) { return c.name === rec.model; })) return;
      list.push({
        name: rec.model,
        value: rec.price,
        rarity: Math.min(0.99, 0.4 + Math.log10(Math.max(1, rec.price / 10000)) * 0.16),
        color: 0xf1f4f7,
        s: 1,
        body: "boat",
        detailStyle: key,
        designStyle: key,
        marine: true,
        loa: rec.spec.loa,
        beam: rec.spec.beam,
      });
      n++;
    });
    econPushed = n;
    return n;
  }
  if (!pushEconomy()) {
    // economy.js parses long before this file, so the guard above should always
    // succeed. This retry exists only so a load-order surprise degrades into a
    // one-frame delay instead of a missing fleet.
    if (CBZ.onUpdate) {
      let tries = 0, done = false;
      CBZ.onUpdate(99.9, function () {
        if (done) return;
        if (pushEconomy() || ++tries > 240) done = true;
      });
    }
  }

  // ============================================================
  //  6. WALKABLE DECKS — CBZ.movingPlatform, feature-detected
  // ============================================================
  // WP-1 owns the primitive. If it is absent there is simply no deck rig and
  // every hull still drives, floats and can be boarded at the helm — the
  // degrade path is a full-featured boat, just not a walkable one.
  //
  // Runs at 9.4, ahead of the platform tick (9.5) and updatePlayer (10), and
  // only re-scans when the car list changes or twice a second, so this costs
  // nothing on a world with no boats in it.
  let deckScanT = 0, deckSeen = -1;
  CBZ.onUpdate(9.4, function (dt) {
    if (CFG.WATER_HULLS === false || CFG.BOAT_DECKS === false) return;
    if (!CBZ.movingPlatform) return;
    const g = CBZ.game;
    if (!g || g.mode !== "city") return;
    const cars = CBZ.cityCars;
    if (!cars) return;
    deckScanT += dt;
    if (deckScanT < 0.5 && cars.length === deckSeen) return;
    deckScanT = 0; deckSeen = cars.length;
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      if (!car || !car.group) continue;
      if (car._deckRig) {
        // a dead/despawned hull releases its rig (never leave a phantom floor)
        if (car.dead) { try { car._deckRig.release(); } catch (e) { /* ignore */ } car._deckRig = null; }
        continue;
      }
      if (car._deckTried || car.dead) continue;
      if (!CBZ.isMarineHull(car)) continue;
      const key = (car.detailStyle && REG.has(car.detailStyle)) ? car.detailStyle : styleFor(null, car.model);
      const rec = get(key);
      if (!rec) { car._deckTried = true; continue; }
      car._deckTried = true;
      if (!rec.deck) continue;                 // open hulls (RIB, runabout) have no walkable deck
      try {
        // THE contract with city/swim.js: `_deckRig` truthy means there IS a
        // registered walkable surface, so it is safe to haul a swimmer out
        // onto the deck. Never set it speculatively — an INERT handle (the rig
        // cap was hit) is truthy, so test for it explicitly, otherwise swim.js
        // would offer a walk-aboard onto a surface that does not exist.
        //
        // ORDERING, deliberately accepted: rigs tick at 9.5, ahead of
        // updatePlayer at 10, so riders resolve against a pose the helm (11)
        // and water_buoyancy (38.5) wrote LAST frame. At the yacht's 13-knot
        // cruise that is ~11cm of deck lag per frame, and it reads as the deck
        // trailing the hull by a hair. Moving the helm earlier is not an
        // option — it needs carDynamics and the frame's input state — and only
        // hulls slow enough for the lag to be invisible get a deck rig at all
        // (the RIB and the runabout deliberately have none).
        const rig = CBZ.movingPlatform(car.group, rec.deck);
        if (rig && !rig.inert) car._deckRig = rig;
      } catch (e) { /* a broken platform must never break a boat */ }
    }
  });

  // ============================================================
  //  7. THE RATCHET
  // ============================================================
  // Counts the sites that still resolve a boat by NAME REGEX rather than
  // through the registry. This is a LIVE probe, not a hardcoded number: it
  // feeds inferStyle() a name only the legacy regex can resolve ("Jetmax" is a
  // GTA-ism that is deliberately absent from PATTERNS above) and checks
  // whether anything still turns it into a hull. Deleting playercars.js:1697's
  // /boat|speedboat|jetmax|yacht|dinghy/i takes this to 0.
  // MAY ONLY EVER GO DOWN.
  CBZ.marineHullAudit = function () {
    let legacy = 0;
    try {
      if (CBZ.cityInferCarStyle) {
        const probe = { name: "Jetmax", body: "coupe" };
        if (!styleFor("Jetmax", probe) && CBZ.cityInferCarStyle(probe) === "boat") legacy++;
      }
    } catch (e) { /* an audit must never throw */ }
    return legacy;
  };

  // Late registrants (a file parsing after us) get the same catalog treatment
  // with one call instead of a copy of pushEconomy's body.
  CBZ.marineHulls.pushEconomy = function () { return pushEconomy(); };
  CBZ.marineHulls.drainPending = drainPending;

  // Diagnostics for the marina / dealer packages.
  CBZ.marineHullReport = function () {
    const out = [];
    REG.forEach(function (r, k) {
      out.push({
        key: k, label: r.label, price: r.price, loa: r.spec.loa, beam: r.spec.beam,
        topKts: r.spec.topKts, massT: r.spec.massT, model: r.model,
        walkable: !!r.deck, built: !!r.build,
      });
    });
    return { hulls: out, economy: econPushed, legacy: CBZ.marineHullAudit() };
  };
})();
