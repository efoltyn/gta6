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

    return {
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
      wakeScale: h.wakeScale != null ? h.wakeScale : 1,
      audio: h.audio || "truck",
      topKts: h.topKts, cruiseKts: h.cruiseKts, planeKts: h.planeKts,
    };
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
  };
  CBZ.marineHulls.kit = KIT;

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

  // ---- DINGHY — Calanque Tender 15 (4.5m RIB) ------------------------------
  // Rigid-hull inflatable: GRP deep-V pan, a hypalon tube collar running the
  // full length and wrapping the transom, a jockey console, a single outboard.
  // Planes almost instantly and turns inside 1-2 boat lengths.
  function buildDinghy() {
    const b = new THREE.Group();
    const len = 4.5, w = 2.0, hw = w * 0.5;
    const hull = M.hull(), tube = M.tube(), dark = M.dark(), grey = M.grey();
    const chrome = M.chrome(), pad = M.pad(), teak = M.teakDk(), screen = M.screen();
    declareRoom(b, "dinghy-helm", "Open helm");
    // GRP pan: waterline at y=0, keel 0.34 below, sheer 0.30 above.
    addPrism(b, w * 0.86, [[-len * 0.5, -0.30], [-len * 0.5, 0.30], [len * 0.18, 0.30], [len * 0.24, -0.30]], 0, hull);
    addPrism(b, w * 0.62, [[len * 0.16, -0.26], [len * 0.16, 0.32], [len * 0.42, 0.36], [len * 0.44, -0.14]], 0, hull);
    addPrism(b, w * 0.26, [[len * 0.40, -0.12], [len * 0.40, 0.36], [len * 0.50, 0.38], [len * 0.49, 0.06]], 0, hull);
    // deep-V keel: a rotated slab under the centreline
    const keel = addBox(b, 0.30, 0.18, len * 0.74, 0, -0.30, len * 0.04, hull);
    keel.rotation.z = Math.PI / 4;
    // TUBE COLLAR: two long cylinders along the sheer + a transom wrap. This is
    // the whole silhouette of a RIB — nothing else reads as "inflatable".
    [1, -1].forEach(function (side) {
      const t = addCyl(b, 0.26, len * 0.86, side * (hw - 0.20), 0.24, len * 0.02, tube, 8);
      t.rotation.x = Math.PI / 2;
      t.rotation.z = side * 0.05;
      // tapered nose cone forward
      const c = new THREE.Mesh(cylGeo(0.10, 0.26, len * 0.20, 8), tube);
      c.position.set(side * (hw - 0.30), 0.26, len * 0.42);
      c.rotation.x = Math.PI / 2;
      c.rotation.y = side * 0.20;
      c.castShadow = false;
      b.add(c);
      // rubbing strake along the tube
      addBox(b, 0.05, 0.05, len * 0.80, side * (hw - 0.02), 0.24, 0, grey);
    });
    const tr = addCyl(b, 0.26, w * 0.80, 0, 0.24, -len * 0.5 + 0.02, tube, 8);
    tr.rotation.z = Math.PI / 2;
    // deck sole (self-bailing, slatted) + the small console + jockey seat
    addBox(b, w * 0.70, 0.06, len * 0.70, 0, 0.06, -len * 0.02, teak);
    addPrism(b, 0.52, [[-0.24, 0], [-0.20, 0.62], [0.16, 0.66], [0.22, 0]], 0.09, dark);   // console
    const scr = addBox(b, 0.46, 0.26, 0.03, 0, 0.86, 0.20, M.glass());
    scr.rotation.x = -0.35;
    addBox(b, 0.20, 0.20, 0.03, 0.13, 0.70, 0.02, dark);                                    // wheel
    addBox(b, 0.44, 0.14, 0.52, 0, 0.44, -0.62, pad);                                       // jockey seat
    addBox(b, 0.44, 0.34, 0.10, 0, 0.68, -0.90, pad);
    addScreen(b, -0.13, 0.70, 0.015, 0.17, 0.12, 0, screen);                                  // chart / sounder
    addFixtureBox(b, "throttle", 0.06, 0.24, 0.06, -0.30, 0.62, -0.05, chrome);
    markFixture(b, scr, "windscreen");
    b.userData.marineFixtureCount += 2;                                                        // wheel + jockey seat
    // grab rail on the console + bow towing eye + cleats
    addBox(b, 0.50, 0.04, 0.04, 0, 0.74, 0.28, chrome);
    addBox(b, 0.06, 0.06, 0.12, 0, 0.16, len * 0.49, chrome);
    [1, -1].forEach(function (side) {
      addBox(b, 0.13, 0.04, 0.05, side * (hw - 0.30), 0.30, -len * 0.44, chrome);
    });
    // OUTBOARD on the transom: cowl, leg, anti-vent plate, screw.
    addBox(b, 0.34, 0.30, 0.38, 0, 0.44, -len * 0.5 - 0.16, M.stripe());
    addBox(b, 0.28, 0.09, 0.32, 0, 0.26, -len * 0.5 - 0.16, dark);
    addBox(b, 0.12, 0.46, 0.17, 0, -0.02, -len * 0.5 - 0.16, dark);
    addBox(b, 0.26, 0.03, 0.26, 0, -0.14, -len * 0.5 - 0.16, dark);
    b.add(propGroup(0.7, [[0, -0.22, -len * 0.5 - 0.28]]));
    navLights(b, hw, 0.34, len * 0.36, -len * 0.46, null);
    return finish(b, { width: w, length: len, height: 1.05, wheelbase: len * 0.6 });
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
    // HULL in width steps: full-beam transom, carried beam amidships, fine bow.
    addPrism(b, w, [[-7.0, KEEL], [-7.0, SHEER], [-0.2, SHEER], [0.4, KEEL * 0.9]], 0, hull);
    addPrism(b, w * 0.90, [[-0.6, KEEL * 0.92], [-0.6, SHEER], [3.6, SHEER + 0.10], [4.0, KEEL * 0.62]], 0, hull);
    addPrism(b, w * 0.62, [[3.4, KEEL * 0.66], [3.4, SHEER + 0.10], [6.0, SHEER + 0.26], [6.2, KEEL * 0.22]], 0, hull);
    addPrism(b, w * 0.24, [[5.8, KEEL * 0.26], [5.8, SHEER + 0.26], [7.0, SHEER + 0.30], [6.9, 0.10]], 0, hull);
    // boot stripe at the waterline + a dark topside band along the sheer
    [1, -1].forEach(function (side) {
      addBox(b, 0.04, 0.16, 12.2, side * (hw - 0.02), 0.02, -0.3, boot);
      addBox(b, 0.04, 0.30, 11.4, side * (hw - 0.04), SHEER - 0.34, -0.6, topside);
    });
    // SWIM PLATFORM at the transom, essentially at water level — the boarding
    // point from the water or a tender.
    addBox(b, 3.0, 0.14, 1.0, 0, 0.24, -7.5, teak);
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
      // side deck sole + bulwark + rail
      addBox(b, 0.70, 0.10, 7.2, side * 1.75, SHEER + 0.15, 1.4, teak);
      addBox(b, 0.10, 0.55, 7.2, side * 2.08, SHEER + 0.42, 1.4, hull);
      addRail(b, side * 2.05, -2.0, 6.0, SHEER + 0.20, chrome, 1.8);
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
    // FOREDECK + sunpad + windlass
    addBox(b, 3.0, 0.10, 3.0, 0, SHEER + 0.25, 4.7, teak);
    addBox(b, 2.2, 0.16, 1.9, 0, SHEER + 0.38, 4.4, pad);
    addBox(b, 0.40, 0.24, 0.40, 0, SHEER + 0.42, 6.1, chrome);
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
    b.add(propGroup(1.5, [[0.85, -0.95, -7.15], [-0.85, -0.95, -7.15]]));
    navLights(b, hw, SHEER + 0.55, 5.6, -6.9, 5.42);
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

    // ---- HULL: full-beam transom, carried beam, fine flared bow. Freeboard
    // tapers to near water level at the transom (research §F).
    addPrism(b, Y.BEAM, [[-17.0, Y.KEEL], [-17.0, 0.95], [-13.0, FB], [-11.0, Y.KEEL * 0.96]], 0, hull);
    addPrism(b, Y.BEAM, [[-12.0, Y.KEEL * 0.98], [-12.0, FB], [4.0, FB], [5.0, Y.KEEL * 0.86]], 0, hull);
    addPrism(b, Y.BEAM * 0.86, [[3.5, Y.KEEL * 0.88], [3.5, FB], [11.0, FB + 0.30], [11.8, Y.KEEL * 0.50]], 0, hull);
    addPrism(b, Y.BEAM * 0.52, [[10.5, Y.KEEL * 0.54], [10.5, FB + 0.28], [15.4, FB + 0.62], [15.8, Y.KEEL * 0.16]], 0, hull);
    addPrism(b, Y.BEAM * 0.18, [[15.0, Y.KEEL * 0.18], [15.0, FB + 0.60], [17.0, FB + 0.70], [16.8, 0.20]], 0, hull);
    // boot stripe + dark topside band + a bulbous forefoot
    [1, -1].forEach(function (side) {
      addBox(b, 0.06, 0.26, 30.0, side * (hw - 0.02), 0.06, -0.6, boot);
      addBox(b, 0.06, 0.50, 27.0, side * (hw - 0.05), FB - 0.60, -1.5, topside);
    });
    addCyl(b, 0.55, 2.2, 0, Y.KEEL * 0.72, 14.6, hull, 8).rotation.x = Math.PI / 2;

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
      // SIDE DECKS both sides, full length, railed.
      addBox(b, 0.90, 0.12, 20.0, side * 3.05, Y.MAIN + 0.14, 0.4, teak);
      addBox(b, 0.14, 0.75, 20.0, side * 3.48, Y.MAIN + 0.50, 0.4, hull);      // bulwark
      addRail(b, side * 3.42, -9.4, 10.4, Y.MAIN + 0.20, chrome, 2.0);
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
    // ---- FOREDECK: windlass, anchor locker, forward sunpad.
    addBox(b, 5.0, 0.14, 4.4, 0, Y.MAIN + 0.30, 12.6, teak);
    addBox(b, 3.6, 0.20, 2.6, 0, Y.MAIN + 0.46, 12.0, pad);
    addBox(b, 0.70, 0.36, 0.70, 0, Y.MAIN + 0.55, 14.9, chrome);     // windlass
    addBox(b, 0.30, 0.50, 0.70, 0, Y.MAIN + 0.30, 16.2, chrome);     // anchor in the pocket

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
    navLights(b, hw, Y.MAIN + 0.85, 13.8, -16.6, Y.SUN + 3.30);
    return finish(b, { width: Y.BEAM, length: Y.LEN, height: 11.4, wheelbase: Y.LEN * 0.6 });
  }

  // ---- DECK SPECS (LOCAL space, consumed by CBZ.movingPlatform) ------------
  function cruiserDeck() {
    const SHEER = 1.30;
    const decks = [
      { x: 0, z: -7.5, w: 3.0, d: 1.0, top: 0.24 + 0.07 },        // swim platform
      { x: 0, z: -4.4, w: 3.6, d: 4.4, top: SHEER + 0.05 },       // cockpit sole
      { x: 1.75, z: 1.4, w: 0.70, d: 7.2, top: SHEER + 0.20 },    // side deck port
      { x: -1.75, z: 1.4, w: 0.70, d: 7.2, top: SHEER + 0.20 },   // side deck stbd
      { x: 0, z: 0.2, w: 2.58, d: 4.72, top: SHEER + 0.12 },      // enterable saloon sole
      { x: 0, z: 4.7, w: 3.0, d: 3.0, top: SHEER + 0.30 },        // foredeck
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
        { x: 2.08, z: 1.4, w: 0.10, d: 7.2, y0: SHEER + 0.15, y1: SHEER + 1.15 },
        { x: -2.08, z: 1.4, w: 0.10, d: 7.2, y0: SHEER + 0.15, y1: SHEER + 1.15 },
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
      { x: 3.05, z: 0.4, w: 0.90, d: 20.0, top: Y.MAIN + 0.20 },    // side deck port
      { x: -3.05, z: 0.4, w: 0.90, d: 20.0, top: Y.MAIN + 0.20 },   // side deck stbd
      { x: 0, z: 0.35, w: 4.96, d: 17.0, top: Y.MAIN + 0.12 },      // enterable main saloon
      { x: 0, z: 12.6, w: 5.0, d: 4.4, top: Y.MAIN + 0.37 },        // foredeck
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
        { x: 3.48, z: 0.4, w: 0.14, d: 20.0, y0: Y.MAIN + 0.20, y1: Y.MAIN + 1.30 },
        { x: -3.48, z: 0.4, w: 0.14, d: 20.0, y0: Y.MAIN + 0.20, y1: Y.MAIN + 1.30 },
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
      deckY: 0.12, boardY: 0.24, sternOffset: 2.25,
      wakeScale: 0.6, audio: "bike",                    // small outboard buzz
    },
    feel: { accel: 1.25, top: 0.80, turn: 1.5, drift: 1.5, roll: 0.9 },
  });

  // boat — THE EXISTING 6.2m runabout. NO `build`: playercars.js's makeBoat()
  // stays the authority on its geometry (it had a deliberate art pass and this
  // registration must not regress a single vertex). What it gains here is a
  // real physics spec, a price and a place in the registry.
  register("boat", {
    label: "Speedboat", marque: "Bellamar", model: "Speedboat",
    price: 15000, build: null,
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
      // rideAbove 0.36 is vehicles.js's WATER_Y (-0.12) minus SEA_Y (-0.48) —
      // the EXACT height this hull floats at today. Do not "correct" it; the
      // runabout's art is modelled with its keel above the group origin.
      rideAbove: 0.36, waveGain: 1.0, slamV: 3.5,
      deckY: 0.80, boardY: 0.80, sternOffset: 3.10,
      wakeScale: 1.0, audio: "sports",                  // big V6 outboard
    },
    feel: { accel: 1.0, top: 1.1, turn: 1.0, drift: 1.4, roll: 0.6 },
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
