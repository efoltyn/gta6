/* ============================================================
   city/govcomplex.js — SEATS OF POWER. The complexes that DO NOT FIT
   INSIDE A CITY BLOCK, placed on their own land OUTSIDE the urban grid.

   OWNER (verbatim, 2026-07-27): "add gov buildings but NOT inside cities
   because when you do that it overlaps — like the pentagon and white house,
   not called that, but those type of massive buildings that have their own
   land plot. Add gov buildings like a capitol building where senators go,
   city hall where the mayor goes, where governors and presidents live, and
   where agencies like the CIA are headquartered, and army for top generals
   like a Pentagon-like place. Just ways to make the terrain absolutely
   massive and fill it with structures... this makes gov and politics much
   more meaningful, and assassinations etc and security etc." And: "not just
   gov complexes — could be a mansion with a rich person and security, or a
   mob boss and soldiers protecting, or gov and police protecting, etc."

   ------------------------------------------------------------------
   THE BUG THE OWNER ACTUALLY REPORTED, AND THE FIX
   ------------------------------------------------------------------
   The complaint is not "we have no government buildings" — city/buildings.js
   and city/buildings_civic.js already stamp a City Hall, a courthouse, a
   federal building and four more civic trades onto mainland LOTS. The
   complaint is that a lot is ~29 m square and a capitol is 300 m across, so
   anything of that class dropped into the grid PUNCHES THROUGH its
   neighbours. A Pentagon does not go on a city block. It goes on its own
   square kilometre, behind its own fence, at the end of its own road.

   So the unit of work here is not a building, it is a COMPLEX: a footprint,
   a silhouette, a perimeter, a gate, an access road and a person at the top
   — and the ONE thing this file guarantees above all others is that the
   footprint is CLEAR LAND. Every candidate rectangle is tested against every
   registered region, the mainland grid, the annex, every lot in the world,
   the map-reservation ledger and the placement hash BEFORE it is claimed,
   and the search walks outward until it finds ground nobody owns. The count
   of rejected candidates per site is published in the audit, because a
   placer that never rejects anything has not actually looked.

   ------------------------------------------------------------------
   WHAT IT AUTHORS, AND — MUCH LONGER LIST — WHAT IT DOES NOT
   ------------------------------------------------------------------
   AUTHORS: a footprint search, a silhouette kit (perimeter walls, chain
   fence, gatehouse, monumental steps, parking seas, and the one genuinely
   new shape in the repo — a five-sided CONCENTRIC RING block, which is the
   whole readable identity of a defence headquarters), and a registry of nine
   sites that say where each silhouette goes and who sits at the top.

   DOES NOT AUTHOR — every one of these is somebody else's shipped system:
     · GUARDS. Not one. `CBZ.powerPrincipal(actor, {tier, org, role, seat})`
       (city/power.js) is the entire security implementation: the ring, the
       weapons, the hp, the standoff distance, the tolerance, the reaction to
       your standing, the floor-by-floor ladder inside the building and the
       police response to his death all fall out of ONE tier number. A
       capitol's detail is state officers; the finca's is cartel soldiers;
       the cliff house's is private contractors — and the difference between
       them is the `org` string and nothing else. Guard-called throughout, so
       a build without power.js still places every complex.
     · THE HOUSEHOLD. Five of the nine sites are RESIDENCES and every one of
       them contained exactly one person plus his gunmen — no cook, no driver,
       no housekeeper, no gardener, no nanny, on grounds with hedge parterres,
       two pools and a helipad. §5b fixes that with a five-word `household` row
       per site and NO coordinates: the stations are derived from the rect, the
       gate and the threshold this file already publishes, and
       city/citystaff.js owns when a body exists (inside 170 m — nineteen staff
       across nine estates therefore cost nothing while you are elsewhere).
     · THE PEOPLE AT THE TOP. city/officials.js and city/polity.js already
       run a president, governors, mayors and their deputies as real ledger
       identities with real terms, real approval and real succession. This
       file does not invent a second president — it GIVES THE EXISTING ONE AN
       ADDRESS, by stamping the live `office.holder` sid onto the body it
       stands at the door of the Executive Mansion, re-read every few seconds
       so an election or an assassination moves the occupant for free. That
       one field is also what makes city/officialdom.js's four verbs
       (PETITION / GREASE / ENDORSE / LEAN ON) light up at these doors with
       zero lines here — `seatOf(p)` matches on `p._sid`.
     · THE MONUMENTAL GRAMMAR. `CBZ.cityMakeBuilding(..., {facade:"civic",
       civic:{crown,order,motto}})` already builds the podium, the entry
       steps, the engaged column order, the entablature, the carved motto,
       the seal, the flagpoles and the DOME (buildings_civic.js). The Capitol
       is one call to it. So is City Hall.
     · THE ROAD. `CBZ.buildHighway(root, {path})` draws the deck AND pushes
       the real `city.roads` records that traffic.js, vehicles.js and
       roadrules.js read. Each complex gets an L from its gate to the nearest
       point on the nearest EXISTING segment, so you can drive there from the
       city without a single bespoke road primitive. The short spur that runs
       PAST the barrier into a restricted compound is tagged `access:
       "service"` — city/roadrules.js documents that vehicle-class filter, so
       ambient traffic is excluded from it by the shipped rule rather than by
       a keep-out hack of ours.
     · THE LAND CONTRACT. `CBZ.registerCityRegion` / `CBZ.registerNoSpawnZone`
       (city/worldmap.js) — the same two calls island_military.js and
       island_airport.js make. Region = walkable, clamped, flattened by
       continent.js's grade pass, drawn on the map. Keep-out = nobody spawns
       or idles there. The Agency and the Defence HQ are hard keep-outs; the
       residences are `civ:true` (posted staff belong, tourists do not); the
       Capitol's plaza and City Hall's forecourt are PUBLIC and register no
       keep-out at all, because a legislature you cannot walk up to is a wall.

   ------------------------------------------------------------------
   PLACEMENT — the no-overlap algorithm, in full
   ------------------------------------------------------------------
   1. UNION. Take the union U of the mainland rect, the annex circle and
      every region registered so far (this file builds at landmass order 42,
      after the islands (20-22), the biomes (30-33), the mini-cities (34),
      the countries (35), the bunkers (40) and strategic (41) — so every
      authored land claim in the world is already on the books).
   2. RING OUT. Each site declares a compass BEARING. Walk the ray from U's
      centre along that bearing to where it exits U, then step outward in
      rings; at each ring, fan the bearing left and right in small steps. The
      first candidate that passes every clearance test wins. Nothing is ever
      searched INSIDE U — that is the owner's whole complaint — and nothing
      is placed beyond a bounded belt, because the continent plate is sized
      from this union and a complex parked in open ocean would both look
      absurd and stretch the plate.
   3. CLEARANCE, and a candidate must survive all of it:
        · not within CLEAR m of the mainland city rect or the annex circle
        · not within CLEAR m of ANY registered region (its own pad included),
          skipping only the continent's deliberate `underlay` bands
        · not within CLEAR m of ANY lot in `city.lots` / `city.shopLots`
        · not within GAP m of a complex this file already claimed
        · no road centreline crosses it (you approach a compound, you do not
          have a freeway through the middle of it)
        · `CBZ.worldLayout.mapConflict()` — the map-reservation ledger's own
          "would this interpenetrate a peer landmass" query, which its author
          wrote FOR a future POI placer and which had no callers until now
        · `CBZ.placement.isFree()` — the prop-level occupancy hash, seeded
          from live colliders at the top of every world build
      Rejections are counted per site and reported.
   4. CLAIM. Register the region (+ `terrainGrade`, so continent.js's relief
      pass grades the ground flat under it exactly as it does for a runway),
      reserve it in BOTH ledgers so everything built after this file steers
      around it, lay the pad, build the silhouette, run the road, staff it.

   DETERMINISM: not one Math.random. Every placement decision is
   `CBZ.hash01`; every body is spawned from a per-site `CBZ.seedStream`, so
   the number of draws on any one stream cannot depend on how many candidates
   the search rejected. Same seed, same world, byte-identical on every client.

   DRAW CALLS: repeats (fence posts, parking-stall stripes, bollards, hedge
   runs, lamp posts) are InstancedMesh; every flat colour comes from the
   cached `CBZ.cmat` pool so core/batch.js can collapse the static
   architecture; nothing static carries `userData`, so nothing static is
   spared from the merge. Only the ground pads are tagged (`worldSurface`),
   which is exactly what earns them their exemption.

   AUDIT / RATCHET: `CBZ.govComplexAudit()` ->
     { complexes, placed, rejected, overlaps, urbanAdjacent, staffed, roadless,
       sites:[…] }
   `overlaps` and `roadless` are the ratchets and are pinned at 0. Neither is
   a stored guess: both are RECOMPUTED from the live world every call, which
   is the lesson CLAUDE.md draws from the propuse audit nobody had ever run.
   `urbanAdjacent` is the ONE declared exception, reported separately so it
   can never quietly absorb a real overlap: an `edgeOfCity` site (City Hall)
   is MEANT to sit against the urban grid.

   MEASURED on the stock world (seed 90210, the shipped region set):
     9 complexes, 9 placed, 25 candidate rectangles rejected, 0 overlaps,
     0 roadless, 9 staffed; every footprint 44 m+ clear of every foreign
     region; two runs of one seed byte-identical.

   Revert: CBZ.CONFIG.GOV_COMPLEX = false (or ?cfg_GOV_COMPLEX=0).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});

  /* ---------------- flags (self-defaulted; each a one-line revert) --------
     GOV_COMPLEX       — the whole file. Off → not one complex is placed and
       every export answers empty, which is byte-for-byte the prior world.
     GOV_COMPLEX_STAFF — the principals. Off → the architecture is built and
       stands empty. This is the flag to flip if bodies misbehave.
     GOV_COMPLEX_ROADS — the access roads. Off → the complexes are still
       there, you just have to drive overland to reach them. */
  if (CFG.GOV_COMPLEX == null) CFG.GOV_COMPLEX = true;
  if (CFG.GOV_COMPLEX_STAFF == null) CFG.GOV_COMPLEX_STAFF = true;
  if (CFG.GOV_COMPLEX_ROADS == null) CFG.GOV_COMPLEX_ROADS = true;
  // How near the player must be before a seated principal's floor ladder is
  // built. occupy.js has a citywide body budget (OCCUPY_MAX_PEDS) and nine
  // simultaneous seats would eat most of it at boot for buildings nobody is
  // standing in. Deferring the seat is power.js's own presence doctrine.
  if (CFG.GOV_COMPLEX_SEAT_NEAR == null) CFG.GOV_COMPLEX_SEAT_NEAR = 260;

  function on() { return CFG.GOV_COMPLEX !== false; }

  /* ====================================================================
     §0  SMALL SHARED HELPERS — materials, boxes, colliders, platforms.
     Every colour goes through the cached-material factory so the batcher
     can bucket it; every geometry through the cached box factory.
     ==================================================================== */
  const M = {
    stone: 0xd6d2c4, stoneD: 0xb8b3a3, stoneDk: 0x8f8b7d, marble: 0xe6e3d8,
    paving: 0x9a9a94, concrete: 0xa8aaa6, concreteD: 0x86888a, asphalt: 0x33373b,
    lawn: 0x4f7445, lawnD: 0x3e5d38, hedge: 0x33512f, gravel: 0x7d7767,
    dirt: 0x7f6a4c, water: 0x2f6f9e, pool: 0x3fa4c8, paint: 0xd8d8c8,
    steel: 0x5a6068, steelD: 0x3c4046, fence: 0x9aa0a6, fenceP: 0x6a7077,
    dark: 0x202327, warn: 0xd4a017, red: 0xb43a32, glassSteel: 0x39444f,
    brick: 0x8d5b46, adobe: 0xd8c39c, tileRoof: 0x9c4f3a, timber: 0x6b4a2a,
    flagRed: 0xc0392b, flagWhite: 0xecf0f1, flagBlue: 0x2c3e6b,
    lampHead: 0xffe9b0, blank: 0xb9bcc0, blankD: 0x9aa0a4,
  };
  /* THE HEIGHT LADDER for flat ground layers, and it is not decoration: two
     coplanar slabs 5 mm apart Z-FIGHT the moment the camera is 200 m away and
     the depth buffer quantises the gap — which is the same class of bug that
     produced the recurring runway flicker on the military island. Every flat
     layer in this file picks one of these four rungs, and each rung is 4 cm
     clear of the last, which is the separation the shipped runway markings
     already use and are known to hold at flight distance. */
  const YP = 0.02;    // the complex's own ground pad
  const YG = 0.06;    // ground cover ON the pad — lawn, gravel, dirt, tarmac
  const YS = 0.10;    // hard surfacing over ground cover — paving, plaza, court
  const YM = 0.14;    // paint, markings, water
  function cm(hex, o) { return CBZ.cmat ? CBZ.cmat(hex, o) : (CBZ.mat ? CBZ.mat(hex, o) : new THREE.MeshLambertMaterial({ color: hex })); }
  function bg(w, h, d) { return CBZ.boxGeom ? CBZ.boxGeom(w, h, d) : new THREE.BoxGeometry(w, h, d); }
  function h01(x, z, salt) { return CBZ.hash01 ? CBZ.hash01(x, z, salt) : 0.5; }

  // a plain static box in WORLD coordinates. No userData → core/batch.js is
  // free to merge it into the city-wide static bucket.
  function box(root, x, y, z, w, h, d, hex, opts) {
    opts = opts || {};
    const m = new THREE.Mesh(bg(w, h, d), cm(hex, opts.matOpts));
    m.position.set(x, y, z);
    if (opts.rotY) m.rotation.y = opts.rotY;
    m.castShadow = opts.cast !== false;
    m.receiveShadow = opts.receive !== false;
    root.add(m);
    return m;
  }
  // an engine AABB collider. Deliberately ref-less: a collider that points at
  // a mesh is what tells the batcher to spare that mesh, and none of this
  // architecture needs sparing.
  function col(x, z, w, d, y0, y1) {
    const c = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, y0: y0 || 0, y1: y1 == null ? 0 : y1, ref: null };
    (CBZ.colliders = CBZ.colliders || []).push(c);
    return c;
  }
  // a walkable horizontal surface (steps, terraces, podiums)
  function plat(x, z, w, d, top) {
    const p = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: top };
    (CBZ.platforms = CBZ.platforms || []).push(p);
    return p;
  }
  function cyl(root, x, y, z, rt, rb, h, hex, seg) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 12), cm(hex));
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; root.add(m);
    return m;
  }
  // flat ground decoration (lawn, paving inlay, pool, apron). Never a collider.
  function slab(root, x, z, w, d, hex, y) {
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, cm(hex));
    m.position.set(x, y == null ? 0.05 : y, z);
    m.receiveShadow = true; m.castShadow = false;
    m.matrixAutoUpdate = false; m.updateMatrix();
    root.add(m);
    return m;
  }
  function disc(root, x, z, r, hex, y, seg) {
    const g = new THREE.CircleGeometry(r, seg || 24);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, cm(hex));
    m.position.set(x, y == null ? 0.06 : y, z);
    m.receiveShadow = true; m.castShadow = false;
    m.matrixAutoUpdate = false; m.updateMatrix();
    // deliberately NO userData: a disc is ordinary decorative floor, and an
    // empty userData is what lets core/batch.js fold it into the merge. (The
    // `nonRectSurface` hint continent.js reads only matters on meshes tagged
    // `worldSurface`, and the only mesh here that carries that tag is pad().)
    root.add(m);
    return m;
  }
  // one InstancedMesh for a repeat. The single most effective draw-call tool
  // in this engine and the reason a 400-post fence costs one call.
  function repeat(root, geo, hex, pts, yFn, rotFn, mo) {
    if (!pts.length) return null;
    const im = new THREE.InstancedMesh(geo, cm(hex, mo), pts.length);
    im.castShadow = true; im.receiveShadow = true;
    const d = new THREE.Object3D();
    for (let i = 0; i < pts.length; i++) {
      d.position.set(pts[i].x, yFn ? yFn(pts[i], i) : (pts[i].y || 0), pts[i].z);
      d.rotation.set(0, rotFn ? rotFn(pts[i], i) : (pts[i].r || 0), 0);
      d.updateMatrix(); im.setMatrixAt(i, d.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
    root.add(im);
    return im;
  }

  /* ====================================================================
     §1  THE SILHOUETTE KIT — the vocabulary every complex is drawn from.

     Nine complexes share these eight primitives. That is the point: the
     difference between a cartel finca and an intelligence campus should be
     which pieces you pick and what colour they are, not eight hundred more
     lines of one-off geometry.
     ==================================================================== */

  // GROUND PAD. Tagged `worldSurface` so continent.js carves its plate out
  // from under us instead of z-fighting through, and `terrain` so the far-
  // distance culler never disposes the floor a player is standing on. This
  // is the ONE mesh per complex that deliberately carries userData.
  function pad(root, rect, hex, name) {
    const w = rect.maxX - rect.minX, d = rect.maxZ - rect.minZ;
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, cm(hex));
    m.position.set((rect.minX + rect.maxX) / 2, 0.02, (rect.minZ + rect.maxZ) / 2);
    m.receiveShadow = true; m.castShadow = false;
    m.matrixAutoUpdate = false; m.updateMatrix();
    m.userData.terrain = true;
    m.userData.worldSurface = true;
    m.userData.surfaceOwner = "govcomplex";
    m.name = "gov-" + name + "-surface";
    root.add(m);
    return m;
  }

  // A STRAIGHT RUN of solid wall, split around an optional gate gap, as one
  // merged-friendly box per piece plus a matching collider per piece.
  function wallRun(root, ax, az, bx, bz, h, thick, hex, gapC, gapW) {
    const horiz = Math.abs(bx - ax) > Math.abs(bz - az);
    const a = horiz ? Math.min(ax, bx) : Math.min(az, bz);
    const b = horiz ? Math.max(ax, bx) : Math.max(az, bz);
    const fixed = horiz ? az : ax;
    const pieces = [];
    if (gapW > 0 && gapC > a && gapC < b) {
      pieces.push([a, Math.max(a, gapC - gapW / 2)]);
      pieces.push([Math.min(b, gapC + gapW / 2), b]);
    } else pieces.push([a, b]);
    for (const p of pieces) {
      const len = p[1] - p[0];
      if (len < 0.5) continue;
      const c = (p[0] + p[1]) / 2;
      const x = horiz ? c : fixed, z = horiz ? fixed : c;
      const w = horiz ? len : thick, d = horiz ? thick : len;
      box(root, x, h / 2, z, w, h, d, hex);
      // a coping course, so the wall has a top and not just a cut edge
      box(root, x, h + 0.09, z, w + 0.24, 0.18, d + 0.24, hex === M.stone ? M.stoneD : M.concreteD, { cast: false });
      col(x, z, w, d, 0, h + 0.2);
    }
  }

  // PERIMETER. `style:"wall"` is masonry; `style:"fence"` is chain link —
  // instanced posts, one translucent mesh band per edge, full-height
  // colliders — the idiom island_military.js proved on the base fence.
  // `gate` names the side (0=-Z, 1=+Z, 2=-X, 3=+X) and the gap width.
  function perimeter(root, rect, o) {
    o = o || {};
    const h = o.h == null ? 3.2 : o.h, thick = o.thick == null ? 0.6 : o.thick;
    const hex = o.hex == null ? M.stoneD : o.hex;
    const gs = o.gate == null ? 1 : o.gate, gw = o.gateW == null ? 22 : o.gateW;
    const cx = (rect.minX + rect.maxX) / 2, cz = (rect.minZ + rect.maxZ) / 2;
    const edges = [
      [rect.minX, rect.minZ, rect.maxX, rect.minZ, 0],   // north (-Z)
      [rect.minX, rect.maxZ, rect.maxX, rect.maxZ, 1],   // south (+Z)
      [rect.minX, rect.minZ, rect.minX, rect.maxZ, 2],   // west  (-X)
      [rect.maxX, rect.minZ, rect.maxX, rect.maxZ, 3],   // east  (+X)
    ];
    if (o.style === "fence") {
      const posts = [], SPAN = 4.2;
      for (const e of edges) {
        const horiz = e[4] < 2;
        const gapC = horiz ? cx : cz;
        const a = horiz ? e[0] : e[1], b = horiz ? e[2] : e[3];
        const n = Math.max(1, Math.round((b - a) / SPAN));
        for (let i = 0; i <= n; i++) {
          const t = a + (b - a) * i / n;
          if (e[4] === gs && t > gapC - gw / 2 && t < gapC + gw / 2) continue;
          posts.push(horiz ? { x: t, z: e[1] } : { x: e[0], z: t });
        }
        wallRunFence(root, e, horiz, gapC, e[4] === gs ? gw : 0, h, hex);
      }
      repeat(root, bg(0.16, h, 0.16), M.fenceP, posts, function () { return h / 2; });
      return;
    }
    for (const e of edges) {
      const horiz = e[4] < 2;
      const gapC = horiz ? cx : cz;
      wallRun(root, e[0], e[1], e[2], e[3], h, thick, hex, gapC, e[4] === gs ? gw : 0);
    }
  }
  // the chain-link BAND + its colliders for one fence edge (split at the gate)
  function wallRunFence(root, e, horiz, gapC, gw, h, hex) {
    const a = horiz ? e[0] : e[1], b = horiz ? e[2] : e[3];
    const fixed = horiz ? e[1] : e[0];
    const spans = (gw > 0 && gapC > a && gapC < b)
      ? [[a, gapC - gw / 2], [gapC + gw / 2, b]] : [[a, b]];
    for (const s of spans) {
      const len = s[1] - s[0]; if (len < 0.5) continue;
      const c = (s[0] + s[1]) / 2;
      const x = horiz ? c : fixed, z = horiz ? fixed : c;
      const w = horiz ? len : 0.08, d = horiz ? 0.08 : len;
      // transparent → a FRESH material (never the shared cache; batch.js also
      // skips transparent from the merge, which is what we want here).
      const m = new THREE.Mesh(bg(w, h - 0.3, d), new THREE.MeshLambertMaterial({ color: hex, transparent: true, opacity: 0.26 }));
      m.position.set(x, h / 2 - 0.1, z); m.castShadow = false; m.receiveShadow = false;
      root.add(m);
      col(x, z, horiz ? w : 0.5, horiz ? 0.5 : d, 0, h);
    }
  }

  // GATEHOUSE. A booth, a lit window and two boom arms parked RAISED — the
  // compound is MANNED, not sealed. Only the pivot posts are colliders.
  //
  // THE BAR IS NEVER LAID ACROSS THE LANE, and that is not a style choice: a
  // bar sized off the wrong axis is exactly what once left a ten-metre
  // floating yellow line hanging over the military causeway. `laneAlongZ`
  // says which way traffic runs through the gap, so the pivots sit on the
  // kerbs ACROSS that axis and each arm rises back over its own kerb.
  //
  // The raised-arm transform is island_military.js's, verbatim, because that
  // one is known-correct: for an arm reaching along Z the centre lifts by
  // sin(a)*L/2, shifts by toward*cos(a)*L/2 and rotates rotation.x =
  // -toward*a. The X case is its mirror: rotation.z = +toward*a (rotation.z
  // maps local +X to (cos, sin), so the `toward` end is the one that climbs).
  function gatehouse(root, x, z, laneAlongZ, hex) {
    const bx = laneAlongZ ? x - 8 : x, bz = laneAlongZ ? z : z - 8;
    box(root, bx, 1.5, bz, 3.4, 3.0, 3.2, hex);
    box(root, bx, 3.12, bz, 3.9, 0.28, 3.7, M.concreteD);
    // FRESH material: transparent glass must stay out of the shared cache
    // (and core/batch.js skips transparent from the merge anyway).
    const win = new THREE.Mesh(bg(laneAlongZ ? 0.12 : 2.6, 1.1, laneAlongZ ? 2.6 : 0.12),
      new THREE.MeshLambertMaterial({ color: 0xbfe9f7, emissive: 0x3f8aa6, emissiveIntensity: 0.5, transparent: true, opacity: 0.6 }));
    win.position.set(bx + (laneAlongZ ? 1.75 : 0), 1.8, bz + (laneAlongZ ? 0 : 1.65));
    win.castShadow = false; root.add(win);
    col(bx, bz, 3.4, 3.2, 0, 3.0);
    const L = 9.0, A = 1.15;                       // arm length / parked angle
    const lift = Math.sin(A) * L / 2, reach = Math.cos(A) * L / 2;
    for (const s of [-1, 1]) {
      const px = laneAlongZ ? x + s * 11 : x;
      const pz = laneAlongZ ? z : z + s * 11;
      cyl(root, px, 0.7, pz, 0.16, 0.2, 1.4, M.red, 8);
      col(px, pz, 0.5, 0.5, 0, 1.4);
      const toward = -s;                           // the arm reaches back to the lane centre
      const arm = laneAlongZ
        ? box(root, px + toward * reach, 0.9 + lift, pz, L, 0.16, 0.16, M.warn)
        : box(root, px, 0.9 + lift, pz + toward * reach, 0.16, 0.16, L, M.warn);
      if (laneAlongZ) arm.rotation.z = toward * A; else arm.rotation.x = -toward * A;
    }
  }

  // MONUMENTAL STEPS. Real stacked treads with real platforms, so the front
  // of a capitol is something you WALK UP rather than something you clip
  // through. `dir` is the OUTWARD normal (+1/-1); the flight climbs inward,
  // so tread 0 is the lowest and sits at the outer lip. `axis:"x"` runs the
  // same flight up an east/west facade.
  function steps(root, x, z, w, depth, rise, n, hex, dir, axis) {
    const tread = depth / n;
    for (let i = 0; i < n; i++) {
      const back = dir * (depth / 2 - tread * (i + 0.5));   // outer lip -> facade
      const cxs = axis === "x" ? x + back : x;
      const czs = axis === "x" ? z : z + back;
      const sw = axis === "x" ? tread : w, sd = axis === "x" ? w : tread;
      const y = rise * (i + 1);
      box(root, cxs, y / 2, czs, sw, y, sd, hex, { cast: false });
      plat(cxs, czs, sw, sd, y);
    }
  }

  // PARKING SEA. Painted stalls only — one InstancedMesh for every stripe in
  // the lot, plus kerbed islands. The Agency's identity is a blank building
  // behind an ocean of parking; this is that ocean, for one draw call.
  // Every lot it lays is recorded on `_bays` against the site currently under
  // construction, so §8's deferred car-parker can put REAL cars on REAL stalls
  // instead of scattering them at a guessed offset from the complex centre —
  // a guess is exactly how you end up with a sedan inside a wall.
  const _bays = [];
  let _curSite = null;
  function parkingSea(root, cx, cz, w, d, hex) {
    slab(root, cx, cz, w, d, M.asphalt, YG);
    const STALL = 2.6, ROWD = 15.0;
    const rows = Math.max(1, Math.floor(d / ROWD));
    const nStall = Math.max(1, Math.floor(w / STALL));
    const stripes = [], rowZ = [];
    for (let r = 0; r < rows; r++) {
      const z0 = cz - d / 2 + ROWD * (r + 0.5);
      rowZ.push(z0 - 2.6 - 2.5, z0 + 2.6 + 2.5);          // the two bays of the row
      for (let i = 0; i <= nStall; i++) {
        const x0 = cx - w / 2 + i * STALL;
        stripes.push({ x: x0, z: z0 - 2.6 });
        stripes.push({ x: x0, z: z0 + 2.6 });
      }
    }
    // kerbed planting islands down the middle of each row — the thing that
    // stops a car park reading as one flat rectangle of tarmac. Laid BEFORE
    // the stripes so the paint is the topmost rung.
    for (let r = 0; r < rows; r++) {
      const z0 = cz - d / 2 + ROWD * (r + 0.5);
      slab(root, cx, z0, w, 1.2, M.lawnD, YS);
    }
    repeat(root, bg(0.16, 0.02, 5.0), hex || M.paint, stripes, function () { return YM; });
    if (_curSite) _bays.push({ site: _curSite, x0: cx - w / 2 + 3, x1: cx + w / 2 - 3, rows: rowZ });
  }

  // WATCHTOWER — legs, a deck you can actually stand on, a roof.
  function watchtower(root, x, z, hex) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      box(root, x + sx * 1.6, 3.0, z + sz * 1.6, 0.3, 6.0, 0.3, M.timber);
    }
    box(root, x, 6.1, z, 4.4, 0.3, 4.4, hex || M.timber);
    plat(x, z, 4.4, 4.4, 6.25);
    for (const s of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      box(root, x + s[0] * 2.1, 6.7, z + s[1] * 2.1, s[0] ? 0.2 : 4.4, 0.9, s[1] ? 0.2 : 4.4, hex || M.timber, { cast: false });
    }
    box(root, x, 8.5, z, 5.0, 0.24, 5.0, M.steelD);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(root, x + sx * 2.0, 7.6, z + sz * 2.0, 0.16, 1.6, 0.16, M.steelD);
    col(x, z, 3.6, 3.6, 0, 6.0);
  }

  function flagpole(root, x, z, h) {
    cyl(root, x, h / 2, z, 0.1, 0.13, h, M.steel, 8);
    box(root, x + 1.0, h - 1.2, z, 2.0, 1.3, 0.05, M.flagBlue, { cast: false });
    box(root, x + 1.5, h - 1.75, z, 3.0, 0.42, 0.05, M.flagRed, { cast: false });
    box(root, x + 1.5, h - 0.85, z, 3.0, 0.42, 0.05, M.flagWhite, { cast: false });
    col(x, z, 0.5, 0.5, 0, h);
  }

  // an avenue of lamp standards — posts instanced, heads instanced + emissive
  // (the cached-material factory takes the emissive kit, so all the heads in
  // the world still share ONE material and ONE draw call).
  function lampRow(root, pts) {
    if (!pts.length) return;
    repeat(root, bg(0.18, 6.0, 0.18), M.steelD, pts, function () { return 3.0; });
    repeat(root, bg(0.7, 0.24, 0.7), M.lampHead, pts, function () { return 6.15; }, null,
      { emissive: M.lampHead, ei: 0.8 });
  }

  // HELIPAD — the disc, the ring and a painted H, on the shared paint colour.
  function helipad(root, x, z, r) {
    disc(root, x, z, r, M.asphalt, YG, 24);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r - 0.9, 0.14, 6, 26), cm(M.paint));
    ring.rotation.x = Math.PI / 2; ring.position.set(x, YM, z); ring.castShadow = false; root.add(ring);
    box(root, x - 1.5, YM, z, 0.7, 0.02, r * 0.9, M.paint, { cast: false });
    box(root, x + 1.5, YM, z, 0.7, 0.02, r * 0.9, M.paint, { cast: false });
    box(root, x, YM, z, 3.0, 0.02, 0.7, M.paint, { cast: false });
  }

  /* --------------------------------------------------------------------
     THE FIVE-SIDED CONCENTRIC RING BLOCK — the one genuinely new
     silhouette in this file, and the whole readable identity of a defence
     headquarters. Get the shape right and nobody needs a sign.

     Five rings of five sides. Ring k sits at apothem A - k*(depth+light
     well); each side is a slab whose length is the polygon's side length at
     that apothem (2*a*tan(pi/5)) and which is yawed to face outward. Because
     the engine's colliders are axis-aligned AABBs, each rotated slab is
     approximated by a chain of sub-boxes along its own tangent — coarser on
     the inner rings, which you can only reach through the outer one anyway.
     -------------------------------------------------------------------- */
  function ringHQ(root, cx, cz, o) {
    o = o || {};
    const RINGS = o.rings == null ? 5 : o.rings;
    const A = o.apothem == null ? 150 : o.apothem;
    const RD = o.depth == null ? 18 : o.depth;      // ring depth (the built band)
    const G = o.well == null ? 9 : o.well;          // light well between rings
    const FH = 4.6, ST = o.storeys == null ? 5 : o.storeys;
    const H = FH * ST;
    const wall = o.wall == null ? M.concrete : o.wall;
    const roof = o.roof == null ? M.concreteD : o.roof;
    const SIDES = 5, TAN = Math.tan(Math.PI / SIDES);
    const rot0 = o.rot == null ? -Math.PI / 2 : o.rot;   // flat side facing north
    let inner = 0;
    for (let k = 0; k < RINGS; k++) {
      const apo = A - k * (RD + G);
      if (apo <= RD + 6) break;
      inner = apo - RD;
      const len = 2 * apo * TAN + RD;          // + RD closes the corner mitre
      const rad = apo - RD / 2;
      for (let s = 0; s < SIDES; s++) {
        const a = rot0 + s * (Math.PI * 2 / SIDES);
        const nx = Math.cos(a), nz = Math.sin(a);
        const tx = -Math.sin(a), tz = Math.cos(a);
        const x = cx + nx * rad, z = cz + nz * rad;
        const yaw = -(a + Math.PI / 2);
        // the storey band, its roof slab and a string course at each floor
        box(root, x, H / 2, z, len, H, RD, wall, { rotY: yaw });
        box(root, x, H + 0.35, z, len + 0.9, 0.7, RD + 0.9, roof, { rotY: yaw });
        for (let f = 1; f < ST; f++) {
          box(root, x, f * FH, z, len + 0.5, 0.22, RD + 0.5, roof, { rotY: yaw, cast: false });
        }
        // AABB collider chain along the slab's own tangent
        const segs = Math.max(3, Math.ceil(len / (k === 0 ? 24 : 40)));
        const segLen = len / segs;
        for (let i = 0; i < segs; i++) {
          const t = (i + 0.5) / segs - 0.5;
          const sx = x + tx * t * len, sz = z + tz * t * len;
          const cw = Math.abs(tx) * segLen + Math.abs(nx) * RD;
          const cd = Math.abs(tz) * segLen + Math.abs(nz) * RD;
          col(sx, sz, cw, cd, 0, H);
        }
      }
    }
    return { inner: inner, height: H };
  }

  /* --------------------------------------------------------------------
     THE CIVIC SHELL. One call into buildings.js's monumental grammar plus
     the lot record every downstream system (occupy.js's floor ladder,
     power.js's seat, officialdom's door lookup) already knows how to read.
     -------------------------------------------------------------------- */
  function civic(root, x, z, w, d, storeys, hex, side, spec, name) {
    let b = null;
    try {
      b = CBZ.cityMakeBuilding(root, x, z, w, d, storeys, hex, side,
        spec ? { facade: "civic", civic: spec, district: "core" } : { facade: "office", district: "core" });
    } catch (e) { b = null; }
    if (!b) return null;
    // doorInfo's normal points INWARD; doorPt is the standing spot just
    // inside the threshold — the exact record shape buildings.js stamps.
    const n = side === 0 ? { x: 0, z: 1 } : side === 1 ? { x: 0, z: -1 } : side === 2 ? { x: 1, z: 0 } : { x: -1, z: 0 };
    const dx = side === 0 ? x : side === 1 ? x : (side === 2 ? x - w / 2 : x + w / 2);
    const dz = side === 0 ? z - d / 2 : side === 1 ? z + d / 2 : z;
    const doorPt = { x: dx + n.x * 1.6, z: dz + n.z * 1.6, nx: n.x, nz: n.z };
    const lot = {
      cx: x, cz: z, w: w, d: d, kind: "gov", district: "core",
      building: Object.assign({}, b, { name: name || "Government Building", sign: M.stone, side: side, door: doorPt }),
    };
    return { b: b, lot: lot, door: doorPt, n: n };
  }
  // a plain block (barracks, annex, warehouse, garage) with no civic dressing
  function block(root, x, z, w, d, storeys, hex, side, opts) {
    try { return CBZ.cityMakeBuilding(root, x, z, w, d, storeys, hex, side, opts || { facade: "office" }); }
    catch (e) { return null; }
  }

  /* ====================================================================
     §2  THE REGISTRY — footprint, silhouette, and WHO SITS AT THE TOP.

     Every entry answers three questions and nothing else:
       WHERE  — half-extents + a compass bearing to search along.
       WHAT   — a `build(ctx)` that draws it from the kit above.
       WHO    — a `principal` spec handed STRAIGHT to CBZ.powerPrincipal.
                `holder` (optional) resolves a LIVE officeholder sid out of
                city/polity.js, which is how a real president ends up living
                in the Executive Mansion instead of a lookalike we minted.

     `tier` is the only security number anywhere in this file. Everything a
     detail does — how many bodies, what they carry, how much armour, how
     close you may walk, how fast they escalate, how many floors are his,
     how many stars his murder is worth — is derived from it by
     CBZ.powerKit. That is the whole reason this file has no guard code.
     ==================================================================== */

  // ---- officeholder resolvers. Each returns a sid or null, read LIVE, so a
  // succession or an election moves the occupant with no bookkeeping here.
  function polList(kind) {
    if (!CBZ.polity || !CBZ.polity.list) return [];
    try { return CBZ.polity.list(kind) || []; } catch (e) { return []; }
  }
  function firstOffice(kind, wantDeputy) {
    const l = polList(kind);
    for (let i = 0; i < l.length; i++) {
      const r = l[i];
      if (!r || !r.office) continue;
      const sid = wantDeputy ? r.office.deputy : r.office.holder;
      if (sid) return { sid: sid, rec: r, deputy: !!wantDeputy };
    }
    return null;
  }
  const HOLDER = {
    // the head of state — country record, sitting holder
    president: function () { return firstOffice("country", false); },
    // the state's chief executive
    governor: function () { return firstOffice("state", false) || firstOffice("federal", false); },
    // the deputy of the state seat. In every real bicameral system the
    // lieutenant governor PRESIDES OVER THE SENATE, so the deputy is exactly
    // the ledger person who belongs at the head of the legislative chamber —
    // and officialdom.js already titles a deputy and lets you petition,
    // grease, endorse or lean on one.
    speaker: function () { return firstOffice("state", true) || firstOffice("state", false); },
    // the local mayor
    mayor: function () { return firstOffice("city", false); },
  };

  // EVERY SILHOUETTE BELOW STAYS INSIDE ITS OWN HALF-EXTENTS. That is not a
  // style note: the whole reason this file exists is that a complex which
  // spills past its declared footprint is a complex that overlaps something,
  // and the region we register — the thing every other builder in the world
  // steers around — is exactly `cx ± hx, cz ± hz`. Every coordinate here is
  // written as an offset from the centre and every one of them is inside.
  const COMPLEXES = [
    /* ================================================================
       1. THE CAPITOL — a domed legislature at the head of a public mall.
       PUBLIC on purpose: no wall, no keep-out, bollards instead of a gate.
       ================================================================ */
    {
      id: "capitol", name: "The Capitol", subtitle: "Legislative Assembly",
      hx: 132, hz: 112, bearing: 0, keepOut: null, gateSide: 1,
      principal: { key: "speaker", tier: 4, org: "state", lawful: true, role: "President of the Senate", job: "official", wealth: 0.85 },
      build: function (c) {
        const R = c.rect, root = c.root, cx = c.cx, cz = c.cz;
        pad(root, R, M.paving, "capitol");
        // the ceremonial approach: lawn either side of a stone axis, with a
        // reflecting pool down the middle. The single element that makes an
        // approach read as ceremonial rather than as a service yard.
        slab(root, cx - 58, cz + 50, 58, 92, M.lawn, YG);          // x -87..-29
        slab(root, cx + 58, cz + 50, 58, 92, M.lawn, YG);          // x +29..+87
        slab(root, cx, cz + 52, 44, 96, M.stone, YS);              // x -22..+22
        slab(root, cx, cz + 58, 18, 66, M.water, YM);
        // THE CHAMBER. One call buys the podium, the engaged ionic order, the
        // entablature, the carved motto, the seal, the flagpoles and the
        // copper dome with its drum, lantern and gilded finial.
        const main = civic(root, cx, cz - 26, 92, 56, 3, M.marble, 1,
          { kind: "capitol", crown: "dome", order: "ionic", motto: "THE PEOPLE'S HOUSE", stone: true }, "The Capitol");
        c.main = main;
        // a bicameral house is TWO chambers — the wings are the reason the
        // silhouette reads as a legislature and not as a museum.
        civic(root, cx - 80, cz - 20, 44, 38, 2, M.stone, 1,
          { kind: "capitol", crown: "pediment", order: "ionic", motto: "SENATE", stone: true }, "Senate Wing");
        civic(root, cx + 80, cz - 20, 44, 38, 2, M.stone, 1,
          { kind: "capitol", crown: "pediment", order: "ionic", motto: "ASSEMBLY", stone: true }, "Assembly Wing");
        steps(root, cx, cz + 8, 62, 12, 0.32, 9, M.stone, 1);      // z +2..+14
        flagpole(root, cx - 34, cz + 18, 16);
        flagpole(root, cx + 34, cz + 18, 16);
        const lamps = [];
        for (let i = 0; i < 7; i++) {
          lamps.push({ x: cx - 26, z: cz + 26 + i * 11 });         // z +26..+92
          lamps.push({ x: cx + 26, z: cz + 26 + i * 11 });
        }
        lampRow(root, lamps);
        // a public building is protected by BOLLARDS, not by a wall. This is
        // the whole difference between the Capitol and the Agency.
        const bol = [];
        for (let i = -9; i <= 9; i++) bol.push({ x: cx + i * 3.4, z: cz + 20 });
        repeat(root, new THREE.CylinderGeometry(0.24, 0.28, 1.0, 8), M.steelD, bol, function () { return 0.5; });
        // visitor parking, off the ceremonial axis and 2 m clear of the west
        // lawn's edge at -87 (two coplanar slabs is a z-fight, not a detail)
        parkingSea(root, cx - 108, cz + 66, 38, 60);               // x -127..-89, z +36..+96
        return { gate: { x: cx, z: R.maxZ }, seat: main };
      },
    },
    /* ================================================================
       2. THE EXECUTIVE MANSION — the head of state's residence AND
       workplace: walled grounds, a lawn, a gatehouse, a motor court.
       ================================================================ */
    {
      id: "execmansion", name: "The Executive Mansion", subtitle: "Residence of the Head of State",
      hx: 124, hz: 122, bearing: 334, keepOut: "civ", gateSide: 1,
      principal: { key: "president", tier: 5, org: "state", lawful: true, role: "Head of State", job: "official", wealth: 0.95, family: true },
      // THE RESIDENCE HALF OF "residence AND workplace". Five words per job,
      // no coordinates — §5b derives every station from the rect, the gate
      // and the threshold this builder already published.
      household: [
        { job: "butler", at: "door", pose: "foldarms", outfit: 0x23262c },
        { job: "estate cook", at: "yard", outfit: 0xe8eaec },
        { job: "chauffeur", at: "court", pose: "foldarms", outfit: 0x2b2f36 },
        { job: "groundskeeper", at: "garden", outfit: 0x4f6a3a },
        { job: "nanny", at: "yard", outfit: 0xc8d4e0 },
      ],
      build: function (c) {
        const R = c.rect, root = c.root, cx = c.cx, cz = c.cz;
        pad(root, R, M.lawn, "execmansion");
        perimeter(root, R, { style: "wall", h: 3.4, thick: 0.7, hex: M.stoneD, gate: 1, gateW: 24 });
        gatehouse(root, cx, R.maxZ - 6, true, M.stone);
        const main = civic(root, cx, cz - 34, 56, 34, 2, M.marble, 1,
          { kind: "mansion", crown: "dome", order: "doric", motto: "EXECUTIVE MANSION", stone: true }, "Executive Mansion");
        c.main = main;
        steps(root, cx, cz - 12, 30, 8, 0.3, 6, M.stone, 1);       // z -16..-8
        // the WEST WING: the office half of "residence and workplace"
        civic(root, cx - 58, cz - 30, 34, 22, 2, M.stone, 3,
          { kind: "federal", crown: "flat", order: "pilaster", motto: "WEST WING", stone: true }, "West Wing");
        // the motor court — a ring of paving round a fountain, which is what
        // the front of a state residence actually is
        disc(root, cx, cz + 18, 34, M.paving, YS, 28);
        disc(root, cx, cz + 18, 9, M.lawn, YM, 20);
        cyl(root, cx, 0.55, cz + 18, 3.4, 3.8, 1.1, M.stone, 16);
        cyl(root, cx, 1.9, cz + 18, 0.5, 0.7, 1.6, M.stoneD, 10);
        disc(root, cx, cz + 18, 3.0, M.pool, 1.14, 18);
        col(cx, cz + 18, 7.6, 7.6, 0, 1.1);
        // formal parterre gardens either flank of the house — instanced hedge,
        // set back to z -78..-51 so the west wing (which reaches cz-19) is clear
        const hedge = [];
        for (let r = 0; r < 4; r++) for (let i = 0; i < 8; i++) {
          hedge.push({ x: cx - 100 + i * 5.4, z: cz - 78 + r * 9 });   // x -100..-62
          hedge.push({ x: cx + 62 + i * 5.4, z: cz - 78 + r * 9 });    // x +62..+100
        }
        repeat(root, bg(4.6, 1.5, 1.5), M.hedge, hedge, function () { return 0.75; });
        // the lawn a helicopter lands on. Every real one has this.
        helipad(root, cx + 74, cz + 62, 12);
        flagpole(root, cx - 22, cz - 8, 14);
        const lamps = [];
        for (let i = 0; i < 5; i++) { lamps.push({ x: cx - 16, z: cz + 58 + i * 11 }); lamps.push({ x: cx + 16, z: cz + 58 + i * 11 }); }
        lampRow(root, lamps);
        return { gate: { x: cx, z: R.maxZ }, seat: main };
      },
    },
    /* ================================================================
       3. THE GOVERNOR'S RESIDENCE — the owner asked for "where governors
       AND presidents live", so the state's chief executive gets his own
       address rather than sharing the head of state's.
       ================================================================ */
    {
      id: "governor", name: "The Governor's Residence", subtitle: "State Executive Residence",
      hx: 94, hz: 88, bearing: 308, keepOut: "civ", gateSide: 1,
      principal: { key: "governor", tier: 4, org: "state", lawful: true, role: "Governor", job: "official", wealth: 0.9, family: true },
      household: [
        { job: "housekeeper", at: "door", outfit: 0xd8dce0 },
        { job: "estate cook", at: "yard", outfit: 0xe8eaec },
        { job: "chauffeur", at: "court", pose: "foldarms", outfit: 0x2b2f36 },
        { job: "groundskeeper", at: "garden", outfit: 0x4f6a3a },
      ],
      build: function (c) {
        const R = c.rect, root = c.root, cx = c.cx, cz = c.cz;
        pad(root, R, M.lawn, "governor");
        perimeter(root, R, { style: "wall", h: 3.0, thick: 0.6, hex: M.stoneD, gate: 1, gateW: 20 });
        gatehouse(root, cx, R.maxZ - 6, true, M.stone);
        const main = civic(root, cx, cz - 26, 42, 28, 2, M.stone, 1,
          { kind: "cityannex", crown: "clock", order: "pilaster", motto: "GOVERNOR'S RESIDENCE", stone: true }, "Governor's Residence");
        c.main = main;
        steps(root, cx, cz - 8, 22, 6, 0.3, 5, M.stone, 1);        // z -11..-5
        disc(root, cx, cz + 16, 24, M.paving, YS, 24);
        disc(root, cx, cz + 16, 7, M.lawn, YM, 18);
        block(root, cx - 54, cz + 2, 22, 16, 1, M.stoneD, 3, { facade: "office", garageGround: true });
        const hedge = [];
        for (let i = 0; i < 11; i++) { hedge.push({ x: cx - 56 + i * 5.2, z: cz - 62 }); hedge.push({ x: cx - 56 + i * 5.2, z: cz - 54 }); }
        repeat(root, bg(4.4, 1.4, 1.4), M.hedge, hedge, function () { return 0.7; });
        flagpole(root, cx + 28, cz - 2, 12);
        return { gate: { x: cx, z: R.maxZ }, seat: main };
      },
    },
    /* ================================================================
       4. THE AGENCY — an intelligence headquarters. Blank campus behind a
       fence, one guarded gate, an ocean of parking, no signage anywhere.
       Deliberately anonymous: the ABSENCE of a seal is the identity.
       ================================================================ */
    {
      id: "agency", name: "Bureau Headquarters", subtitle: "Restricted Federal Facility",
      hx: 154, hz: 132, bearing: 248, keepOut: "hard", gateSide: 3,
      principal: { key: null, tier: 4, org: "agency", lawful: true, role: "Director of the Bureau", job: "official", wealth: 0.8 },
      build: function (c) {
        const R = c.rect, root = c.root, cx = c.cx, cz = c.cz;
        pad(root, R, M.concrete, "agency");
        // chain link, not masonry: this place is WATCHED, not walled
        perimeter(root, R, { style: "fence", h: 3.4, hex: M.fence, gate: 3, gateW: 20 });
        gatehouse(root, R.maxX - 6, cz, false, M.concreteD);
        // THE BUILDING. A long blank slab with reflective glass, a lower
        // annex behind it and a wing off one end. No motto, no crown, no
        // seal — `civic()` is called with a null spec on purpose.
        const main = civic(root, cx - 14, cz - 44, 118, 44, 5, M.blank, 1, null, "Bureau Headquarters");
        c.main = main;
        block(root, cx - 14, cz - 2, 118, 22, 3, M.blankD, 1, { facade: "office" });
        block(root, cx + 76, cz - 44, 32, 44, 4, M.blank, 2, { facade: "office" });
        // the parking sea — two of them, because that is what the aerial
        // photograph of every real one of these actually shows
        parkingSea(root, cx - 50, cz + 70, 140, 74);               // x -120..+20, z +33..+107
        parkingSea(root, cx + 92, cz + 34, 76, 76);                // x +54..+130, z -4..+72
        // the antenna farm along the north fence
        for (let i = 0; i < 3; i++) {
          const dx = cx - 110 + i * 26, dz = cz - 100;
          cyl(root, dx, 2.0, dz, 0.34, 0.44, 4.0, M.steel, 8);
          const dish = new THREE.Mesh(new THREE.SphereGeometry(3.4, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), cm(M.stoneD));
          dish.position.set(dx, 4.4, dz); dish.rotation.x = -0.7; dish.castShadow = true; root.add(dish);
          col(dx, dz, 1.4, 1.4, 0, 4.0);
        }
        cyl(root, cx + 118, 17, cz - 108, 0.4, 0.7, 34, M.steelD, 8);
        col(cx + 118, cz - 108, 1.6, 1.6, 0, 34);
        for (let i = 0; i < 4; i++) box(root, cx + 96 + i * 6, 1.4, cz - 78, 4.2, 2.8, 3.2, M.steelD);
        col(cx + 105, cz - 78, 26, 3.2, 0, 2.8);
        const lamps = [];
        for (let i = 0; i < 9; i++) lamps.push({ x: R.maxX - 26, z: R.minZ + 20 + i * 26 });
        lampRow(root, lamps);
        return { gate: { x: R.maxX, z: cz }, seat: main, service: true };
      },
    },
    /* ================================================================
       5. THE DEFENCE HEADQUARTERS — five concentric five-sided rings
       around a courtyard. The concentric rings ARE the silhouette; get
       the shape right and the building needs no sign at all.

       GEOMETRY NOTE, because the numbers here are load-bearing: the outer
       ring's apothem is 150, so its CIRCUMRADIUS is 150/cos(36) = 185 and
       its southern apex reaches cz+185. Everything else on this site is
       therefore placed against a separating plane of the pentagon rather
       than by eye — the staff parks sit outside the 126-degree and
       54-degree faces, and the command annex sits north of the flat
       northern face at cz-150 with real daylight to spare.
       ================================================================ */
    {
      id: "defence", name: "Defence Headquarters", subtitle: "Joint Command",
      hx: 196, hz: 194, bearing: 204, keepOut: "hard", gateSide: 0,
      principal: { key: null, tier: 5, org: "army", lawful: true, role: "Chief of the General Staff", job: "official", wealth: 0.75 },
      build: function (c) {
        const R = c.rect, root = c.root, cx = c.cx, cz = c.cz;
        pad(root, R, M.concrete, "defence");
        perimeter(root, R, { style: "fence", h: 3.6, hex: M.fence, gate: 0, gateW: 22 });
        gatehouse(root, cx, R.minZ + 6, true, M.concreteD);
        const ring = ringHQ(root, cx, cz, { apothem: 150, rings: 5, depth: 18, well: 9, storeys: 5, wall: M.concrete, roof: M.concreteD });
        // THE COURTYARD — lawn, a path cross, and a pavilion in the middle
        const ci = Math.max(8, ring.inner - 2);
        disc(root, cx, cz, ci, M.lawn, YG, 26);
        slab(root, cx, cz, 5.0, ci * 2, M.paving, YS);
        slab(root, cx, cz, ci * 2, 5.0, M.paving, YS);
        box(root, cx, 1.6, cz, 7.0, 0.4, 7.0, M.stone, { cast: false });
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(root, cx + sx * 2.8, 0.8, cz + sz * 2.8, 0.22, 0.24, 1.6, M.stone, 10);
        plat(cx, cz, 7.0, 7.0, 1.8);
        // the parade approach from the north gate to the outer ring's flat
        // northern face (z from R.minZ = cz-194 up to cz-150)
        slab(root, cx, cz - 172, 26, 44, M.paving, YS);
        // THE COMMAND ANNEX — the general's actual door. The ring block has
        // no ordinary lot, so his seat is a real enterable shell on the
        // parade ground, facing NORTH (door side 0) so his forecourt is the
        // approach and not the six metres between him and the ring wall.
        const main = civic(root, cx - 82, cz - 168, 40, 24, 3, M.concreteD, 0,
          { kind: "federal", crown: "flat", order: "pilaster", motto: "JOINT COMMAND", stone: true }, "Joint Command Annex");
        c.main = main;
        // staff parking in the two southern rect corners, which are outside
        // the 126-degree / 54-degree faces (see the geometry note above)
        parkingSea(root, cx - 165, cz + 150, 50, 60);
        parkingSea(root, cx + 165, cz + 150, 50, 60);
        helipad(root, cx + 152, cz - 118, 13);
        helipad(root, cx + 152, cz - 86, 13);
        flagpole(root, cx - 16, cz - 164, 18);
        flagpole(root, cx + 16, cz - 164, 18);
        return { gate: { x: cx, z: R.minZ }, seat: main, service: true };
      },
    },
    /* ================================================================
       6. CITY HALL — the mayor's seat. The one entry the brief allows to
       sit at the EDGE of a city, because that is where a real one is.
       Public forecourt, no keep-out.
       ================================================================ */
    {
      id: "cityhall", name: "City Hall", subtitle: "Office of the Mayor",
      hx: 74, hz: 68, bearing: null, edgeOfCity: true, keepOut: null, gateSide: 1,
      // the full 360-degree sweep — see claim(): the nearest clear ground
      // beside a city is not a direction this file may assume.
      fan: 22, fanStep: 16 * Math.PI / 180,
      principal: { key: "mayor", tier: 3, org: "state", lawful: true, role: "Mayor", job: "official", wealth: 0.7 },
      build: function (c) {
        const R = c.rect, root = c.root, cx = c.cx, cz = c.cz;
        pad(root, R, M.paving, "cityhall");
        slab(root, cx - 48, cz + 6, 40, 60, M.lawn, YG);           // x -68..-28
        slab(root, cx + 48, cz + 6, 40, 60, M.lawn, YG);           // x +28..+68
        const main = civic(root, cx, cz - 24, 50, 32, 3, M.stone, 1,
          { kind: "cityhall", crown: "clock", order: "pilaster", motto: "CITY HALL", stone: true }, "City Hall");
        c.main = main;
        steps(root, cx, cz - 4, 30, 8, 0.3, 6, M.stone, 1);        // z -8..0
        flagpole(root, cx - 18, cz + 6, 12);
        flagpole(root, cx + 18, cz + 6, 12);
        const bol = [];
        for (let i = -6; i <= 6; i++) bol.push({ x: cx + i * 3.2, z: cz + 12 });
        repeat(root, new THREE.CylinderGeometry(0.22, 0.26, 0.95, 8), M.steelD, bol, function () { return 0.48; });
        parkingSea(root, cx, cz + 44, 44, 34);                     // x -22..+22, z +27..+61
        const lamps = [];
        for (let i = 0; i < 4; i++) { lamps.push({ x: cx - 28, z: cz + 20 + i * 11 }); lamps.push({ x: cx + 28, z: cz + 20 + i * 11 }); }
        lampRow(root, lamps);
        return { gate: { x: cx, z: R.maxZ }, seat: main };
      },
    },
    /* ================================================================
       7. THE COMPOUND — a mob boss and the men who protect him.

       SAME MACHINERY, DIFFERENT OWNER, and that is the owner's second
       sentence in full. `org:"gang"` picks factions.js's already-declared
       street outfit, whose heat multiplier (1.25 — witnesses shout when
       they see colours) is what tells power.js this detail is NOT the law.
       So the ring is made men rather than officers, walking up costs you a
       different conversation, and killing him brings reprisals instead of
       stars. Not one line of that is written here.
       ================================================================ */
    {
      id: "compound", name: "The Compound", subtitle: "Private Estate",
      hx: 78, hz: 74, bearing: 138, keepOut: "civ", gateSide: 2,
      principal: { key: null, tier: 4, org: "gang", lawful: false, role: "The Boss", job: "criminal", wealth: 0.85, family: true },
      // A crew boss keeps a household too, and it is the same three jobs —
      // which is the point of a shared vocabulary: no "mob" trade exists.
      household: [
        { job: "housekeeper", at: "door", outfit: 0xd8dce0 },
        { job: "estate cook", at: "yard", outfit: 0xe8eaec },
        { job: "nanny", at: "garden", outfit: 0xc8d4e0 },
      ],
      build: function (c) {
        const R = c.rect, root = c.root, cx = c.cx, cz = c.cz;
        pad(root, R, M.gravel, "compound");
        perimeter(root, R, { style: "wall", h: 3.6, thick: 0.6, hex: M.concreteD, gate: 2, gateW: 16 });
        gatehouse(root, R.minX + 6, cz, false, M.concreteD);
        const main = civic(root, cx + 14, cz - 28, 34, 24, 2, M.brick, 1, null, "The House");
        c.main = main;
        // the yard: a shed big enough to hide a truck in, a hardstanding, a
        // stack of containers and floodlights that make the wall mean something
        block(root, cx - 30, cz + 28, 36, 22, 1, M.steelD, 0, { facade: "office" });
        slab(root, cx + 18, cz + 24, 48, 32, M.asphalt, YG);
        const cont = [];
        for (let i = 0; i < 4; i++) cont.push({ x: cx + 44, z: cz - 6 + i * 7.0 });
        repeat(root, bg(12.0, 2.8, 2.6), M.red, cont, function () { return 1.4; });
        for (let i = 0; i < 4; i++) col(cx + 44, cz - 6 + i * 7.0, 12.0, 2.6, 0, 2.8);
        for (const p of [[R.minX + 14, R.minZ + 14], [R.maxX - 14, R.minZ + 14], [R.minX + 14, R.maxZ - 14], [R.maxX - 14, R.maxZ - 14]]) {
          cyl(root, p[0], 4.5, p[1], 0.16, 0.22, 9.0, M.steelD, 8);
          box(root, p[0], 9.2, p[1], 1.2, 0.5, 0.6, M.lampHead, { cast: false, matOpts: { emissive: M.lampHead, ei: 0.85 } });
          col(p[0], p[1], 0.7, 0.7, 0, 9.0);
        }
        return { gate: { x: R.minX, z: cz }, seat: main };
      },
    },
    /* ================================================================
       8. LA FINCA — a cartel estate. The dirt strip and the windsock are
       the TELL: they are the difference between a rich man's ranch and a
       trafficking operation, and they are a real place to put a plane down.
       ================================================================ */
    {
      id: "finca", name: "La Finca", subtitle: "Private Estate",
      hx: 114, hz: 98, bearing: 98, keepOut: "civ", gateSide: 2,
      principal: { key: null, tier: 5, org: "cartel", lawful: false, role: "El Patron", job: "criminal", wealth: 0.95, family: true },
      household: [
        { job: "housekeeper", at: "door", outfit: 0xd8dce0 },
        { job: "estate cook", at: "yard", outfit: 0xe8eaec },
        { job: "groundskeeper", at: "garden", outfit: 0x4f6a3a },
        { job: "nanny", at: "court", outfit: 0xc8d4e0 },
      ],
      build: function (c) {
        const R = c.rect, root = c.root, cx = c.cx, cz = c.cz;
        pad(root, R, M.dirt, "finca");
        perimeter(root, R, { style: "wall", h: 3.0, thick: 0.55, hex: M.adobe, gate: 2, gateW: 16 });
        gatehouse(root, R.minX + 6, cz, false, M.adobe);
        // the hacienda: a main house with two wings round a walled courtyard
        const main = civic(root, cx + 8, cz - 34, 44, 26, 2, M.adobe, 1, null, "La Casa Grande");
        c.main = main;
        box(root, cx + 8, 9.6, cz - 34, 47, 0.7, 29, M.tileRoof, { cast: false });
        block(root, cx - 30, cz - 2, 20, 32, 1, M.adobe, 3, { facade: "brick" });
        block(root, cx + 46, cz - 2, 20, 32, 1, M.adobe, 2, { facade: "brick" });
        slab(root, cx + 8, cz - 2, 52, 32, M.paving, YS);
        disc(root, cx + 8, cz - 2, 7, M.pool, YM, 20);
        // the airstrip, along the southern boundary
        slab(root, cx, cz + 74, 190, 22, M.asphalt, YG);           // z +63..+85
        const dash = [];
        for (let i = 0; i < 9; i++) dash.push({ x: cx - 80 + i * 20, z: cz + 74 });
        repeat(root, bg(9, 0.02, 0.6), M.paint, dash, function () { return YM; });
        cyl(root, cx - 96, 4.0, cz + 58, 0.12, 0.16, 8.0, M.steel, 8);
        box(root, cx - 93, 7.4, cz + 58, 4.4, 1.1, 0.06, M.warn, { cast: false });
        watchtower(root, R.minX + 16, R.minZ + 16, M.timber);
        watchtower(root, R.maxX - 16, R.minZ + 16, M.timber);
        // the stock the money pretends to come from
        const hedge = [];
        for (let i = 0; i < 13; i++) hedge.push({ x: cx - 80 + i * 6.2, z: cz - 78 });
        repeat(root, bg(5.4, 1.6, 1.6), M.hedge, hedge, function () { return 0.8; });
        return { gate: { x: R.minX, z: cz }, seat: main };
      },
    },
    /* ================================================================
       9. THE CLIFF HOUSE — tech money. Built terraces, a glass pavilion,
       an infinity pool, a pad, and a screen instead of a wall.

       `secco` is careers.js's DECLARED private-security outfit, and
       `lawful:false` is deliberate rather than a contradiction: the
       contractors are licensed, but the law does not come running when one
       of them puts you down on private ground — and that is precisely the
       question power.js reads off this flag.
       ================================================================ */
    {
      id: "cliffhouse", name: "The Cliff House", subtitle: "Private Estate",
      hx: 84, hz: 78, bearing: 58, keepOut: "civ", gateSide: 1,
      principal: { key: null, tier: 4, org: "secco", lawful: false, role: "Founder", job: "executive", wealth: 1.0, family: true },
      household: [
        { job: "housekeeper", at: "door", outfit: 0xd8dce0 },
        { job: "chauffeur", at: "court", pose: "foldarms", outfit: 0x2b2f36 },
        { job: "groundskeeper", at: "garden", outfit: 0x4f6a3a },
      ],
      build: function (c) {
        const R = c.rect, root = c.root, cx = c.cx, cz = c.cz;
        pad(root, R, M.stoneD, "cliffhouse");
        // THE CLIFF IS BUILT, NOT SCULPTED: three broad stone platforms you
        // can walk down, stepping away from the house toward the view.
        // Heights 1.8 / 1.2 / 0.6 — never zero, never negative.
        for (let i = 0; i < 3; i++) {
          const w = 140 - i * 28, d = 34, hgt = 1.8 - i * 0.6;
          const z0 = cz + 4 + i * 22;                              // z +4 / +26 / +48
          box(root, cx, hgt / 2, z0, w, hgt, d, M.stone, { cast: false });
          plat(cx, z0, w, d, hgt);
        }
        const main = civic(root, cx, cz - 32, 46, 22, 2, M.glassSteel, 1, null, "The Cliff House");
        c.main = main;
        block(root, cx - 48, cz - 28, 24, 18, 1, M.stoneD, 3, { facade: "office", glassKind: "clear", garageGround: true });
        // the infinity pool, cut into the TOP terrace (whose deck is at 1.8)
        // and finished with a marble lip at the terrace edge
        slab(root, cx, cz + 2, 34, 12, M.pool, 1.84);
        box(root, cx, 1.9, cz + 9.2, 34, 0.2, 0.5, M.marble, { cast: false });
        helipad(root, cx + 58, cz + 44, 11);
        // a low glass/steel screen rather than a wall: the security here is
        // PEOPLE, not masonry, which is the whole point of the tier
        perimeter(root, R, { style: "fence", h: 2.4, hex: 0x7f8c94, gate: 1, gateW: 16 });
        gatehouse(root, cx, R.maxZ - 6, true, M.stoneD);
        const lamps = [];
        for (let i = 0; i < 4; i++) { lamps.push({ x: cx - 14, z: cz + 30 + i * 10 }); lamps.push({ x: cx + 14, z: cz + 30 + i * 10 }); }
        lampRow(root, lamps);
        return { gate: { x: cx, z: R.maxZ }, seat: main };
      },
    },
  ];

  /* ====================================================================
     §3  PLACEMENT — the no-overlap search.
     ==================================================================== */
  const CLEAR = 44;        // metres of daylight required around every claim
  const GAP = 70;          // metres between two of OUR complexes
  const BELT = 700;        // how far outside the settled union we may reach
  const RINGS = 16, STEP = 48, FAN = 6, FAN_STEP = 8 * Math.PI / 180;

  const SITES = [];        // live placement records, one per COMPLEXES entry
  const AUDIT = { complexes: 0, placed: 0, rejected: 0, overlaps: 0, urbanAdjacent: 0, staffed: 0, roadless: 0, household: 0, householdWanted: 0, householdStations: 0 };

  function rectOf(cx, cz, hx, hz) { return { minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz }; }
  function hit(a, b, m) {
    m = m || 0;
    return a.minX - m < b.maxX && a.maxX + m > b.minX && a.minZ - m < b.maxZ && a.maxZ + m > b.minZ;
  }
  // a region's true footprint, circles normalised and its own pad included
  function regRect(r) {
    const p = r.pad || 0;
    if (r.kind === "circle") return { minX: r.cx - r.r - p, maxX: r.cx + r.r + p, minZ: r.cz - r.r - p, maxZ: r.cz + r.r + p };
    return { minX: r.minX - p, maxX: r.maxX + p, minZ: r.minZ - p, maxZ: r.maxZ + p };
  }
  // WHICH REGIONS DO NOT COUNT AS AN OVERLAP, and why each exemption is the
  // repo's own established semantics rather than a convenience:
  //   · `underlay` / biome "wilds" — continent.js's country bands are laid
  //     OVER everything on purpose; worldmap.js's own mapAudit skips them by
  //     the same field.
  //   · a LINK corridor (bridge / causeway / link) — a connector
  //     legitimately touches the thing it connects to at both ends. This is
  //     exactly the exclusion CLAUDE.md records for the math gate's own
  //     region sweep ("nested venues and causeway links are legitimately
  //     excluded"), and it is why highwaynet.js names every route segment
  //     "<route> Link N". Our own access corridors carry the same word for
  //     the same reason.
  //   · anything this file owns — complex-vs-complex is tested directly off
  //     the SITES list instead, at zero margin, so nothing is hidden by it.
  // `forAudit` is the only place the LINK exemption applies. The PLACEMENT
  // pass stays strict about corridors and keeps its full CLEAR margin off
  // them; the AUDIT forgives a connector that grazes a complex it serves,
  // because that is what a connector does.
  const LINK_RE = /bridge|causeway|link/i;
  function skipRegion(r, forAudit) {
    if (!r) return true;
    if (r._govOwner) return true;                 // ours: SITES-vs-SITES covers it
    if (r.underlay === true) return true;
    if (r.biome === "wilds") return true;
    if (forAudit && r.name && LINK_RE.test(r.name)) return true;
    return false;
  }

  // union of everything already settled: the mainland grid, the annex and
  // every registered region. This is the shape we ring OUTSIDE of.
  function settledUnion(city) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    function grow(a) {
      if (a.minX < minX) minX = a.minX; if (a.maxX > maxX) maxX = a.maxX;
      if (a.minZ < minZ) minZ = a.minZ; if (a.maxZ > maxZ) maxZ = a.maxZ;
    }
    if (isFinite(city.minX)) grow({ minX: city.minX, maxX: city.maxX, minZ: city.minZ, maxZ: city.maxZ });
    const a = city.annex;
    if (a && isFinite(a.cx)) grow({ minX: a.cx - a.radius, maxX: a.cx + a.radius, minZ: a.cz - a.radius, maxZ: a.cz + a.radius });
    const regs = city.regions || [];
    for (let i = 0; i < regs.length; i++) { if (regs[i].underlay === true) continue; grow(regRect(regs[i])); }
    if (!isFinite(minX)) return { minX: -400, maxX: 400, minZ: -1100, maxZ: -300 };
    return { minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ };
  }

  // lot bounding box, computed once, so the per-lot loop is skipped outright
  // for the (overwhelming majority of) candidates that are nowhere near one.
  function lotBounds(city) {
    const lists = [city.lots, city.shopLots];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, n = 0;
    for (const L of lists) {
      if (!L) continue;
      for (let i = 0; i < L.length; i++) {
        const l = L[i]; if (!l || l.cx == null) continue;
        const hw = (l.w || 24) / 2, hd = (l.d || 24) / 2;
        if (l.cx - hw < minX) minX = l.cx - hw;
        if (l.cx + hw > maxX) maxX = l.cx + hw;
        if (l.cz - hd < minZ) minZ = l.cz - hd;
        if (l.cz + hd > maxZ) maxZ = l.cz + hd;
        n++;
      }
    }
    return n ? { minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ, n: n } : null;
  }

  // does a road centreline (widened by its own deck) cross this rectangle?
  function roadCrosses(city, rect, m) {
    const roads = city.roads; if (!roads) return false;
    for (let i = 0; i < roads.length; i++) {
      const r = roads[i]; if (!r) continue;
      const hw = (r.w != null ? r.w : 18) / 2 + m, hl = (r.len || 0) / 2;
      const rr = r.vertical
        ? { minX: r.x - hw, maxX: r.x + hw, minZ: r.z - hl, maxZ: r.z + hl }
        : { minX: r.x - hl, maxX: r.x + hl, minZ: r.z - hw, maxZ: r.z + hw };
      if (hit(rect, rr, 0)) return true;
    }
    return false;
  }

  // THE CLEARANCE TEST. Returns null when the ground is free, else the name
  // of the thing that refused it (which is what the per-site reject count is
  // actually counting).
  function whyBlocked(city, rect, ownId, LB, belt) {
    if (rect.minX < belt.minX || rect.maxX > belt.maxX || rect.minZ < belt.minZ || rect.maxZ > belt.maxZ) return "belt";
    if (isFinite(city.minX) && hit(rect, { minX: city.minX, maxX: city.maxX, minZ: city.minZ, maxZ: city.maxZ }, CLEAR)) return "mainland";
    const a = city.annex;
    if (a && isFinite(a.cx) && hit(rect, { minX: a.cx - a.radius, maxX: a.cx + a.radius, minZ: a.cz - a.radius, maxZ: a.cz + a.radius }, CLEAR)) return "annex";
    const regs = city.regions || [];
    for (let i = 0; i < regs.length; i++) {
      if (skipRegion(regs[i], false)) continue;
      if (hit(rect, regRect(regs[i]), CLEAR)) return "region:" + (regs[i].name || i);
    }
    for (let i = 0; i < SITES.length; i++) {
      const s = SITES[i];
      if (!s.rect || s.id === ownId) continue;
      if (hit(rect, s.rect, GAP)) return "complex:" + s.id;
    }
    if (LB && hit(rect, LB, CLEAR)) {
      const lists = [city.lots, city.shopLots];
      for (const L of lists) {
        if (!L) continue;
        for (let i = 0; i < L.length; i++) {
          const l = L[i]; if (!l || l.cx == null) continue;
          const lr = { minX: l.cx - (l.w || 24) / 2, maxX: l.cx + (l.w || 24) / 2, minZ: l.cz - (l.d || 24) / 2, maxZ: l.cz + (l.d || 24) / 2 };
          if (hit(rect, lr, CLEAR)) return "lot";
        }
      }
    }
    if (roadCrosses(city, rect, 6)) return "road";
    // the map-reservation ledger's own peer-interpenetration query. Its author
    // wrote it "for a future POI/biome placer"; this is that placer.
    if (CBZ.worldLayout && CBZ.worldLayout.mapConflict) {
      try {
        const c = CBZ.worldLayout.mapConflict(rect, { owner: "gov:" + ownId, minContain: 0.02 });
        if (c) return "mapledger:" + (c.entry && c.entry.owner);
      } catch (e) { /* ledger absent or off — the tests above already stand */ }
    }
    // the prop-level occupancy hash, seeded from live colliders at the top of
    // every world build (worldmap.js cityWorldGeo)
    if (CBZ.placement && CBZ.placement.isFree) {
      try { if (!CBZ.placement.isFree({ minX: rect.minX, maxX: rect.maxX, minZ: rect.minZ, maxZ: rect.maxZ })) return "placement"; }
      catch (e) { /* same */ }
    }
    return null;
  }

  // ray-box exit distance from the union centre along a unit direction
  function exitDist(U, dx, dz) {
    const hx = (U.maxX - U.minX) / 2, hz = (U.maxZ - U.minZ) / 2;
    let t = Infinity;
    if (Math.abs(dx) > 1e-6) t = Math.min(t, hx / Math.abs(dx));
    if (Math.abs(dz) > 1e-6) t = Math.min(t, hz / Math.abs(dz));
    return isFinite(t) ? t : Math.max(hx, hz);
  }

  // THE SEARCH. Deterministic in every particular: the base bearing is
  // hash-jittered off the world seed, the ring/fan walk is a fixed order, and
  // nothing here ever touches an rng stream — so the number of candidates
  // rejected can never shift a draw somewhere else in the world.
  function claim(city, def, U, LB, belt) {
    // City Hall is the deliberate exception the brief calls out: a real city
    // hall stands at the edge of its city, so it rings out from the MAINLAND
    // rather than from the settled union.
    let ox, oz, base;
    if (def.edgeOfCity && isFinite(city.minX)) {
      ox = (city.minX + city.maxX) / 2; oz = (city.minZ + city.maxZ) / 2;
      base = Math.PI;                                     // south of downtown
    } else {
      ox = (U.minX + U.maxX) / 2; oz = (U.minZ + U.maxZ) / 2;
      base = ((def.bearing || 0) % 360) * Math.PI / 180;
    }
    // ±10 degrees of seed-dependent jitter, so two worlds do not put the
    // capitol on precisely the same compass line.
    base += (h01(def.hx, def.hz, 0x60c0) - 0.5) * (20 * Math.PI / 180);
    const anchor = def.edgeOfCity && isFinite(city.minX)
      ? { minX: city.minX, maxX: city.maxX, minZ: city.minZ, maxZ: city.maxZ } : U;
    const reach = Math.max(def.hx, def.hz);
    // A site may widen its own fan. City Hall does, to the FULL circle: it is
    // anchored on the city rather than on the settled union, and the compass
    // direction that has clear ground beside a city is not something this file
    // gets to assume — the airport is south of downtown on the stock seed, the
    // base is west and the annex is east. "At the edge of the city" means the
    // NEAREST clear ground on any bearing, so it sweeps for it.
    const fanN = def.fan == null ? FAN : def.fan;
    const fanStep = def.fanStep == null ? FAN_STEP : def.fanStep;
    let rejected = 0;
    for (let k = 0; k < RINGS; k++) {
      for (let f = 0; f <= fanN * 2; f++) {
        // 0, +1, -1, +2, -2 … — sweep out from the declared bearing
        const j = (f === 0) ? 0 : (f & 1 ? (f + 1) / 2 : -f / 2);
        const th = base + j * fanStep;
        const dx = Math.sin(th), dz = -Math.cos(th);       // 0 rad = due north (-Z)
        const t = exitDist(anchor, dx, dz) + CLEAR + reach + k * STEP;
        const cx = Math.round(ox + dx * t), cz = Math.round(oz + dz * t);
        const rect = rectOf(cx, cz, def.hx, def.hz);
        const why = whyBlocked(city, rect, def.id, LB, belt);
        if (!why) return { cx: cx, cz: cz, rect: rect, rejected: rejected };
        rejected++;
      }
    }
    return { cx: 0, cz: 0, rect: null, rejected: rejected };
  }

  /* ====================================================================
     §4  THE ACCESS ROAD — an L from the gate to the nearest existing road.

     buildHighway draws the deck AND registers the drivable segments, so the
     only thing owed here is picking the junction and tagging what comes
     back. The short spur INSIDE a restricted compound is tagged
     `access:"service"`, which is roadrules.js's documented vehicle-class
     filter: ambient traffic is excluded from it by the shipped rule.
     ==================================================================== */
  // the nearest point on each open road segment, nearest first. We keep a
  // SHORTLIST rather than only the winner, because the closest junction is not
  // always the one whose approach can be laid without ploughing through
  // somebody else's biome floor — see the scoring in linkRoad below.
  function roadJunctions(city, x, z, n) {
    const roads = city.roads; if (!roads || !roads.length) return [];
    const out = [];
    for (let i = 0; i < roads.length; i++) {
      const r = roads[i];
      if (!r || !r.len) continue;
      if (r.access && r.access !== "ambient") continue;    // never tie into a service spur
      if (r.noTraffic) continue;
      const hl = r.len / 2;
      const px = r.vertical ? r.x : Math.max(r.x - hl, Math.min(r.x + hl, x));
      const pz = r.vertical ? Math.max(r.z - hl, Math.min(r.z + hl, z)) : r.z;
      out.push({ x: px, z: pz, seg: r, d: Math.hypot(px - x, pz - z) });
    }
    out.sort(function (a, b) { return a.d - b.d; });
    return out.slice(0, n || 10);
  }

  function linkRoad(city, site, rng) {
    if (CFG.GOV_COMPLEX_ROADS === false) return [];
    const root = city.root; if (!root) return [];
    const g = site.gate;
    const cands = roadJunctions(city, g.x, g.z, 10);
    if (!cands.length) return [];
    // SCORE EVERY (junction x elbow) PAIR: shortest route that does not run
    // through RESTRICTED ground.
    //
    // What counts as restricted is deliberately NOT "any region". A road that
    // crosses farmland or desert is a road that crosses farmland — the
    // continent's own frontier loop does it for kilometres and it is correct.
    // What must not be crossed is ground somebody has DECLARED closed, and the
    // repo already has exactly that declaration: `arena.noSpawn`, the keep-out
    // list the airport's airside, the military runway, the bunkers and our own
    // restricted compounds all register into. Plus built lots, because driving
    // a deck through somebody's building is not a routing preference, it is a
    // bug. A crossing costs 600 m of notional length: enough that a moderately
    // longer clean route always wins, never enough to send an approach round
    // the world when the only route is the direct one.
    const zones = city.noSpawn || [];
    const lots = [city.lots, city.shopLots];
    function legRect(a, b) {
      return { minX: Math.min(a.x, b.x) - 9, maxX: Math.max(a.x, b.x) + 9,
        minZ: Math.min(a.z, b.z) - 9, maxZ: Math.max(a.z, b.z) + 9 };
    }
    function score(path) {
      let len = 0, bad = 0;
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i], b = path[i + 1];
        len += Math.abs(b.x - a.x) + Math.abs(b.z - a.z);
        const lr = legRect(a, b);
        // the first leg legitimately starts ON our own gate; only judge the rest
        if (i > 0 && hit(lr, site.rect, -4)) bad += 2;
        // AND IT MUST NOT CROSS ANOTHER COMPLEX. The whole reason these things
        // stand on their own land is that putting them in a city overlapped —
        // but govComplexAudit only ever measured the complex RECTS, never the
        // access roads this function builds, so `overlaps: 0` was a true
        // statement about the wrong thing. On seed 1337 the Governor's
        // approach ran 124 m straight through The Executive Mansion and the
        // audit reported a clean world.
        //
        // roadrules.js's clearance law already knows how to answer this, and
        // its DESTINATION rule is what makes it usable here: a road may end in
        // the place it is going to, so passing our own gate coordinates as
        // `dest` keeps the legitimate final approach legal while a path that
        // merely passes THROUGH somebody else's grounds is scored out.
        if (CBZ.roadClearance) {
          try {
            const rc = CBZ.roadClearance(a.x, a.z, b.x, b.z, {
              w: 18, owner: "gov-" + site.id, dest: { x: g.x, z: g.z },     // `g` is `site.gate` (declared above)
            });
            if (rc && !rc.ok) bad += 4;
          } catch (e) {}
        }
        for (let k = 0; k < zones.length; k++) {
          const s = zones[k];
          if (!s || (s.label && s.label === "gov-" + site.id)) continue;   // our own
          const zr = s.r != null
            ? { minX: s.cx - s.r, maxX: s.cx + s.r, minZ: s.cz - s.r, maxZ: s.cz + s.r }
            : s;
          if (hit(lr, zr, 0)) bad++;
        }
        for (const L of lots) {
          if (!L) continue;
          for (let k = 0; k < L.length; k++) {
            const l = L[k]; if (!l || l.cx == null) continue;
            const hw = (l.w || 24) / 2, hd = (l.d || 24) / 2;
            if (hit(lr, { minX: l.cx - hw, maxX: l.cx + hw, minZ: l.cz - hd, maxZ: l.cz + hd }, 0)) { bad++; break; }
          }
        }
      }
      return len + bad * 600;
    }
    let path = null, bestScore = Infinity;
    for (let c = 0; c < cands.length; c++) {
      const j = cands[c];
      const A = [{ x: g.x, z: g.z }, { x: g.x, z: j.z }, { x: j.x, z: j.z }];
      const B = [{ x: g.x, z: g.z }, { x: j.x, z: g.z }, { x: j.x, z: j.z }];
      for (const p of [A, B]) {
        const s = score(p);
        if (s < bestScore) { bestScore = s; path = p; }
      }
    }
    if (!path) return [];
    // drop degenerate joints so buildHighway never sees a zero-length leg
    const clean = [path[0]];
    for (let i = 1; i < path.length; i++) {
      const p = path[i], q = clean[clean.length - 1];
      if (Math.abs(p.x - q.x) > 0.5 || Math.abs(p.z - q.z) > 0.5) clean.push(p);
    }
    if (clean.length < 2) return [];

    let made = [];
    if (CBZ.buildHighway) {
      try {
        const rec = CBZ.buildHighway(root, {
          path: clean, width: 18, lanesPerDir: 1, laneW: 4.2, median: false,
          theme: "asphalt", guardrail: false, elevated: false, rng: rng,
          cityRoads: city.roads,
        });
        made = (rec && rec.roads) ? rec.roads : [];
      } catch (e) { made = []; }
    }
    if (!made.length && city.roads) {
      // degrade-safe: no highway builder, so push the plain records by hand —
      // exactly the shape island_airport.js's causeway pushes.
      for (let i = 0; i < clean.length - 1; i++) {
        const a = clean[i], b = clean[i + 1];
        const adx = Math.abs(b.x - a.x), adz = Math.abs(b.z - a.z);
        if (adx < 0.5 && adz < 0.5) continue;
        const seg = adx > adz
          ? { x: (a.x + b.x) / 2, z: a.z, vertical: false, len: adx }
          : { x: a.x, z: (a.z + b.z) / 2, vertical: true, len: adz };
        seg.w = 18; seg.lanesPerDir = 1; seg.laneW = 4.2;
        city.roads.push(seg); made.push(seg);
      }
    }
    // An approach to a compound is a real posted road, but it is not Main
    // Street: roadrules.js reads `trafficWeight` directly, so one field says
    // "legal, signposted, quiet" without inventing a district.
    for (const s of made) {
      s.district = "arterial"; s.speedLimit = 45; s.trafficWeight = 0.35;
      s._govOwner = site.id;
    }
    // THE SERVICE SPUR: from the gate INTO the compound. Restricted ground,
    // so it is reserved to the service class and carries no ambient traffic.
    if (city.roads && site.def.keepOut === "hard") {
      const inX = site.cx - g.x, inZ = site.cz - g.z;
      const len = Math.min(60, Math.max(20, Math.hypot(inX, inZ) * 0.45));
      const vertical = Math.abs(inZ) > Math.abs(inX);
      const spur = vertical
        ? { x: g.x, z: g.z + Math.sign(inZ) * len / 2, vertical: true, len: len }
        : { x: g.x + Math.sign(inX) * len / 2, z: g.z, vertical: false, len: len };
      spur.w = 14; spur.lanesPerDir = 1; spur.laneW = 4.0;
      spur.district = "industrial"; spur.speedLimit = 15;
      spur.access = "service";        // roadrules.js's vehicle-class filter
      spur.trafficWeight = 0;
      spur._govOwner = site.id;
      city.roads.push(spur); made.push(spur);
    }
    // THE CORRIDOR REGION, one thin rect per leg. Three things it buys:
    //   · `terrainGrade` — continent.js's relief pass grades the ground flat
    //     under the deck, so an 18 m ribbon never hovers over a backcountry
    //     hill (the contract the speedway's own pad uses).
    //   · walkable + clampable ground, so a player who steps out of the car
    //     halfway there is standing on registered land.
    //   · LAND. continent.js's shore field forces `s = 12` inside any
    //     registered region that is NOT named bridge/causeway/link — so an
    //     approach that has to reach across a bay becomes an isthmus rather
    //     than a road deck over open water. The name is deliberately
    //     "<Name> Approach N" and deliberately does NOT contain the word
    //     "Link": highwaynet.js uses that word precisely because its route
    //     segments ARE bridges and must not hold land. Ours are country
    //     roads and must.
    // (Nothing depends on the name for OUR audit — skipRegion() drops any
    //  region carrying `_govOwner` before it ever looks at a name.)
    for (let i = 0; i < clean.length - 1; i++) {
      const a = clean[i], b = clean[i + 1];
      if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.z - b.z) < 0.5) continue;
      const HALF = 13;
      const reg = CBZ.registerCityRegion(city, {
        name: site.def.name + " Approach " + (i + 1), subtitle: site.def.subtitle, kind: "rect",
        minX: Math.min(a.x, b.x) - HALF, maxX: Math.max(a.x, b.x) + HALF,
        minZ: Math.min(a.z, b.z) - HALF, maxZ: Math.max(a.z, b.z) + HALF,
        pad: 1, terrainGrade: true,
      });
      if (reg) { reg._govOwner = site.id; site.regions.push(reg); }
    }
    return made;
  }

  /* ====================================================================
     §5  STAFFING — one call per complex, and power.js does the rest.
     ==================================================================== */
  function streamFor(id) {
    if (CBZ.seedStream) { try { return CBZ.seedStream("govcomplex:" + id); } catch (e) {} }
    let s = (0x67f1 ^ (CBZ.WORLD_SEED | 0)) >>> 0;
    for (let i = 0; i < id.length; i++) s = (s * 31 + id.charCodeAt(i)) >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  // resolve the LIVE officeholder this complex belongs to, if it has one
  function holderOf(site) {
    const key = site.def.principal && site.def.principal.key;
    if (!key || !HOLDER[key]) return null;
    let h = null;
    try { h = HOLDER[key](); } catch (e) { h = null; }
    return h;
  }
  function ledgerName(sid) {
    if (!sid) return null;
    if (CBZ.officials && CBZ.officials.identityOf) {
      try { const i = CBZ.officials.identityOf(sid); if (i && i.name) return i.name; } catch (e) {}
    }
    if (CBZ.cityLedgerEntry) {
      try { const e = CBZ.cityLedgerEntry(sid); if (e && e.name) return e.name; } catch (e) {}
    }
    return null;
  }

  // declare (or re-declare) the principal. powerPrincipal is idempotent by
  // actor — a repeat call is a promotion/seat change, never a second detail.
  function declarePrincipal(site, withSeat) {
    const p = site.actor;
    if (!p || p.dead || !CBZ.powerPrincipal) return;
    const spec = site.def.principal;
    site.power = CBZ.powerPrincipal(p, {
      id: "gov:" + site.id,
      tier: spec.tier, org: spec.org, role: spec.role, lawful: spec.lawful,
      // `spec.family` is an ARRAY OF LIVE BODIES (power.js:387 does
      // `Array.isArray(spec.family) ? …slice() : []`), for a caller that
      // already has the people. We do not — so `true` here has never done
      // anything, and passing a COUNT would not either.
      //
      // That is not the bug it looks like: power.js fills the array itself.
      // `kit.family` is a tier-derived count (:299, clamp(tier-2, 0, 3)) that
      // the floor ladder uses to populate the top-floor suite, and :436 pushes
      // any ped that comes back flagged `isFamily` into rec.family. So the
      // dependants arrive with the occupancy, not from here. Passing null is
      // the honest expression of "we have no bodies to hand over"; leaving
      // `true` in place implied a contract that does not exist.
      family: Array.isArray(spec.family) ? spec.family : null,
      seat: (withSeat && site.lot) ? { lot: site.lot } : null,
    });
    if (withSeat) site.seated = true;
  }

  /* ====================================================================
     §5b  THE HOUSEHOLD — a residence is a WORKPLACE.

     OWNER (2026-07-27): "every place should have the people who work there."

     Before this, a complex contained exactly ONE person: the officeholder, plus
     whatever detail power.js hangs off his tier. That is defensible for the
     Capitol and the Defence HQ, which are offices — and indefensible for the
     five RESIDENCES. The Executive Mansion, the Governor's Residence, the mob
     compound, the cartel finca and the tech cliff house are all declared
     `family: true`, all have walled grounds, hedge parterres, motor courts,
     pools and helipads, and NOBODY cleaned, cooked, drove or gardened in any of
     them. A mansion with nothing in it but guards is a stage set.

     WHAT THIS FILE STILL DOES NOT AUTHOR: no bodies, no brains, no schedule.
     A row says WHO works there and WHERE the job is in the abstract; the
     coordinates are derived from what the builder already published (the
     threshold it stood the principal on, the gate it pushed a road to, its own
     rectangle), so a new complex declares five words and no numbers.
     city/citystaff.js decides when a body exists — inside 170 m and no closer,
     which is why nineteen household staff across nine estates cost nothing
     while you are anywhere else in the world.
     ==================================================================== */
  // Each resolver returns a station in world space. Every one is SIGN-SAFE
  // against the door normal (lateral offsets, midpoints and rect corners
  // only), because `seatPoint.face` is the builder's convention and this file
  // should not be the second place that has to agree with it.
  const HOUSE_AT = {
    // either side of the principal's own threshold — the butler/housekeeper
    // post, and the one you meet first.
    door: function (s, i) {
      const f = s.seatPoint.face, side = (i % 2) ? 1 : -1, r = 3.4 + ((i / 2) | 0) * 1.8;
      return { x: s.seatPoint.x + Math.cos(f) * r * side, z: s.seatPoint.z - Math.sin(f) * r * side, face: f };
    },
    // the motor court: on the line the car takes from the gate to the door.
    court: function (s) {
      const t = 0.34;
      const x = s.seatPoint.x + (s.gate.x - s.seatPoint.x) * t;
      const z = s.seatPoint.z + (s.gate.z - s.seatPoint.z) * t;
      return { x: x, z: z, face: Math.atan2(s.gate.x - x, s.gate.z - z) };
    },
    // service side of the house — where a kitchen door and the bins are.
    yard: function (s, i) {
      const c = corner(s, 2 + i), t = 0.34;
      return { x: s.cx + (c.x - s.cx) * t, z: s.cz + (c.z - s.cz) * t, face: Math.atan2(s.cx - c.x, s.cz - c.z) };
    },
    // out in the grounds, where the hedges and the lawn actually are.
    garden: function (s, i) {
      const c = corner(s, i), t = 0.62;
      return { x: s.cx + (c.x - s.cx) * t, z: s.cz + (c.z - s.cz) * t, face: Math.atan2(c.x - s.cx, c.z - s.cz) };
    },
  };
  function corner(s, i) {
    const R = s.rect;
    const xs = [R.minX + 14, R.maxX - 14], zs = [R.minZ + 14, R.maxZ - 14];
    return { x: xs[(i | 0) % 2], z: zs[(((i | 0) >> 1) % 2)] };
  }

  function staffHousehold(city, site) {
    if (CFG.GOV_COMPLEX_STAFF === false) return 0;
    const list = site.def.household;
    if (!list || !list.length || !site.rect || !site.seatPoint || !CBZ.cityStaffPost) return 0;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const h = list[i];
      const res = HOUSE_AT[h.at] || HOUSE_AT.yard;
      let p = null;
      try { p = res(site, i); } catch (e) { p = null; }
      if (!p) continue;
      CBZ.cityStaffPost({
        venue: "govcomplex", id: "gov:" + site.id + ":" + h.job.replace(/\s+/g, "-") + ":" + i,
        job: h.job, archetype: "worker", pose: h.pose || null,
        x: p.x, z: p.z, face: p.face,
        // They belong to the household, not to the org — a cook is not a
        // guard and must never read as one. Unarmed, low aggression, and
        // powerReactionTo is untouched because we declare no principal here.
        opts: { wealth: 0.3, aggr: 0.08, armed: false, outfit: h.outfit || 0xd8dce0 },
      });
      n++;
    }
    return n;
  }

  function staffSite(city, site) {
    if (CFG.GOV_COMPLEX_STAFF === false) return;
    if (!CBZ.cityPostNpc && !CBZ.cityMakePed) return;
    const spec = site.def.principal;
    const seat = site.seatPoint;
    const rng = streamFor(site.id + ":ped");
    let p = null;
    const opts = {
      parent: city.root, pin: true, face: seat.face, rng: rng,
      job: spec.job, kind: "civilian", armed: false, aggr: 0.1,
      wealth: spec.wealth, archetype: "official",
      src: "govcomplex:" + site.id,
    };
    if (CBZ.cityPostNpc) { try { p = CBZ.cityPostNpc(seat.x, seat.z, opts); } catch (e) { p = null; } }
    if (!p && CBZ.cityMakePed && CBZ.cityPeds) {
      try {
        p = CBZ.cityMakePed(seat.x, seat.z, rng, opts);
        if (p) { city.root.add(p.group); CBZ.cityPeds.push(p); p.staffPost = { x: seat.x, z: seat.z, face: seat.face }; p.state = "idle"; p.speed = 0; }
      } catch (e) { p = null; }
    }
    if (!p) return;
    p.controlled = true; p.nameKnown = true;
    p.organization = spec.org;
    p.organizationLoyalty = 100;
    p._govSite = site.id;
    site.actor = p;
    bindHolder(site);                      // give the LIVE officeholder his address
    declarePrincipal(site, false);         // the ring now; the floor ladder on approach
  }

  // Stamp the current officeholder's sid + name onto the body. This is the
  // whole of "give them an address rather than inventing a duplicate person":
  // one field, re-read live, and city/officialdom.js's four verbs, contracts
  // .js's hit on that sid and the succession machinery all follow it for free.
  function bindHolder(site) {
    const h = holderOf(site);
    if (!h || !site.actor) return false;
    if (site.actor._sid === h.sid) return false;
    site.actor._sid = h.sid;
    site.actor._seatT = 0;                 // officialdom caches seatOf(); invalidate it
    const nm = ledgerName(h.sid);
    if (nm) { site.actor.name = nm; site.actor.nameKnown = true; }
    // the title the pill shows follows the ledger too — a deputy presiding
    // over the chamber is not the same person as the governor.
    if (CBZ.officialdom && CBZ.officialdom.titleOf && h.rec) {
      try {
        const t = CBZ.officialdom.titleOf(h.rec, h.deputy);
        if (t) site.actor.vipTitle = site.def.principal.role || t;
      } catch (e) {}
    }
    return true;
  }

  /* ====================================================================
     §6  THE BUILDER — one landmass step, order 42.

     AFTER: speedway(20) airport(21) military(22) snow(30) desert(31)
     forest(32) farmland(33) minicities(34) official_assets(34.6)
     countries(35) bunkers(40) arena_fights(40) strategic(41).
     BEFORE: marina(66) highways(90) highwaynet(91) continent(97) and the
     nature scatter passes(98-99) — so the ground we claim is known to the
     relief grader, the road network and every tree pass that follows.
     ==================================================================== */
  // guarded, not early-returned: the audit + the ticks below must still be
  // exported in a build where worldmap.js is absent (they answer empty).
  if (CBZ.addLandmass) CBZ.addLandmass(function (city) {
    if (!on()) return;
    const root = city.root || CBZ.scene;
    if (!root || !CBZ.registerCityRegion) return;

    // a rebuild re-runs this builder; start from an empty ledger so stale
    // records can never be counted by the audit or re-staffed by the tick.
    SITES.length = 0; _bays.length = 0;
    AUDIT.complexes = COMPLEXES.length;
    AUDIT.placed = 0; AUDIT.rejected = 0;
    AUDIT.overlaps = 0; AUDIT.urbanAdjacent = 0; AUDIT.staffed = 0; AUDIT.roadless = 0;
    // how many household jobs the registry DECLARES, against how many were
    // actually posted. A residence whose staff silently failed to declare is
    // the empty-mansion bug coming back, and this is where it shows.
    AUDIT.household = 0; AUDIT.householdWanted = 0; AUDIT.householdStations = 0;
    // cityStaffVenue CLEARS this venue's posts — the same "no ghosts from the
    // last arena" contract the SITES ledger above starts from.
    if (CBZ.cityStaffVenue) CBZ.cityStaffVenue("govcomplex", { stations: 0, note: "household staff at the five residences" });
    for (let i = 0; i < COMPLEXES.length; i++) {
      const hh = COMPLEXES[i].household;
      if (hh) AUDIT.householdWanted += hh.length;
    }

    const U = settledUnion(city);
    const LB = lotBounds(city);
    const belt = { minX: U.minX - BELT, maxX: U.maxX + BELT, minZ: U.minZ - BELT, maxZ: U.maxZ + BELT };

    for (let i = 0; i < COMPLEXES.length; i++) {
      const def = COMPLEXES[i];
      const site = { id: def.id, def: def, rect: null, cx: 0, cz: 0, roads: [], rejected: 0, regions: [], seated: false };
      SITES.push(site);

      const got = claim(city, def, U, LB, belt);
      site.rejected = got.rejected;
      AUDIT.rejected += got.rejected;
      if (!got.rect) { console.warn("[govcomplex] no clear ground for " + def.id + " after " + got.rejected + " candidates"); continue; }
      site.rect = got.rect; site.cx = got.cx; site.cz = got.cz;

      // ---- claim the land, in BOTH ledgers -------------------------------
      // `terrainGrade` is the field continent.js's relief pass reads to grade
      // the ground flat under an authored pad — the same contract the
      // speedway's circle uses. No biome string: these are paved compounds,
      // not a new climate, and cityBiomeAt must keep answering for the
      // country around them.
      const reg = CBZ.registerCityRegion(city, {
        name: def.name, subtitle: def.subtitle, kind: "rect",
        minX: site.rect.minX, maxX: site.rect.maxX, minZ: site.rect.minZ, maxZ: site.rect.maxZ,
        pad: 8, terrainGrade: true,
      });
      if (reg) { reg._govOwner = def.id; site.regions.push(reg); }
      if (CBZ.worldLayout && CBZ.worldLayout.mapReserve) {
        try {
          CBZ.worldLayout.mapReserve("gov:" + def.id, site.rect, { owner: "gov:" + def.id, kind: "region", peer: true });
        } catch (e) {}
      }
      if (CBZ.placement && CBZ.placement.reserve) {
        try { CBZ.placement.reserve({ minX: site.rect.minX, maxX: site.rect.maxX, minZ: site.rect.minZ, maxZ: site.rect.maxZ, zone: "world" }); } catch (e) {}
      }

      // ---- draw it -------------------------------------------------------
      let out = null;
      _curSite = def.id;                 // parkingSea() files its bays under this
      try {
        out = def.build({ root: root, rect: site.rect, cx: site.cx, cz: site.cz, site: site });
      } catch (e) { console.error("[govcomplex] build " + def.id, e); }
      _curSite = null;
      site.gate = (out && out.gate) || { x: site.cx, z: site.rect.maxZ };
      const main = (out && out.seat) || null;
      if (main) {
        site.lot = main.lot;
        // the principal stands on his own threshold, facing out: visible,
        // guarded, and — the owner's word — assassinable.
        const d = main.door, n = main.n;
        site.seatPoint = { x: d.x - n.x * 4.2, z: d.z - n.z * 4.2, face: Math.atan2(-n.x, -n.z) };
      } else {
        site.seatPoint = { x: site.cx, z: site.cz + 6, face: 0 };
      }

      // ---- keep-out ------------------------------------------------------
      // hard  → nobody at all (the Agency, the Defence HQ)
      // civ   → posted staff belong here; the public does not (residences)
      // null  → PUBLIC (the Capitol plaza, City Hall forecourt) — a seat of
      //         government you cannot walk up to is a wall, not a building.
      if (def.keepOut && CBZ.registerNoSpawnZone) {
        CBZ.registerNoSpawnZone(city, {
          minX: site.rect.minX, maxX: site.rect.maxX, minZ: site.rect.minZ, maxZ: site.rect.maxZ,
          label: "gov-" + def.id, civ: def.keepOut === "civ",
        });
      }

      // ---- the road, then the people -------------------------------------
      site.roads = linkRoad(city, site, streamFor(def.id + ":road"));
      staffSite(city, site);
      if (def.household) AUDIT.householdStations += def.household.length;
      AUDIT.household += staffHousehold(city, site);
      if (CBZ.cityStaffStations) CBZ.cityStaffStations("govcomplex", AUDIT.householdStations);

      // ---- the job people do here ---------------------------------------
      // Anchors are pure data on the schedule/goal brain aigoals.js already
      // runs; the gate and the forecourt are real posts, so staff commute to
      // a real place instead of standing in an empty field.
      if (CBZ.registerWorkAnchor) {
        CBZ.registerWorkAnchor({
          biome: "city", kind: def.keepOut === "hard" ? "security" : "cityhall",
          role: def.keepOut === "hard" ? "security guard" : "office worker",
          x: site.gate.x, z: site.gate.z, cap: 4, patrol: def.keepOut === "hard",
          home: { x: site.cx, z: site.cz },
          spots: [
            { x: site.gate.x, z: site.gate.z },
            { x: site.seatPoint.x, z: site.seatPoint.z },
            { x: site.cx, z: site.cz },
          ],
        });
        // ...and a SECOND anchor for the household, because a cook and a
        // groundskeeper do not commute to a gatehouse. `kind: "estate"` is what
        // citystaff.js's TRADES registers every household trade against, so
        // these six jobs route through aigoals.js's existing schedule/goal
        // brain exactly like a farmer routes to a field.
        if (def.household && def.household.length) {
          CBZ.registerWorkAnchor({
            biome: "city", kind: "estate", role: "housekeeper",
            x: site.cx, z: site.cz, cap: def.household.length,
            home: { x: site.cx, z: site.cz },
            spots: [
              { x: site.seatPoint.x, z: site.seatPoint.z },
              { x: site.cx, z: site.cz },
              { x: (site.cx + site.gate.x) / 2, z: (site.cz + site.gate.z) / 2 },
            ],
          });
        }
      }

      AUDIT.placed++;
    }

    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    // a console handle, not a HUD surface (HUD doctrine: the only popup is
    // the killfeed) — the placements, in one object, for a probe to read.
    CBZ.govComplexes = SITES;
  }, 42);

  /* ====================================================================
     §7  THE TICK — successions, the deferred floor ladder, and respawn.

     Order 38.74 sits with the rest of the civic family (island_military's
     post drift 38.7, officialdom's registration 38.72). Everything here is
     throttled to a few times a second; nothing here moves a body — the
     principal is pinned by peds.js's own staffPost brain and his detail is
     driven by power.js.
     ==================================================================== */
  let acc = 0;
  if (CBZ.onUpdate) {
    CBZ.onUpdate(38.74, function (dt) {
      if (!on() || !SITES.length) return;
      const g = CBZ.game || window.g;
      if (g && g.mode !== "city") return;
      acc += dt || 0;
      if (acc < 1.2) return;
      acc = 0;
      const roster = CBZ.cityPeds || [];
      const P = CBZ.player;
      const city = CBZ.city && CBZ.city.arena;
      for (let i = 0; i < SITES.length; i++) {
        const s = SITES[i];
        if (!s.rect) continue;
        // (a) the body left the world (clearCityPeds on a mode change, or he
        //     was killed). A dead officeholder is REAL — officials.js's
        //     succession machinery owns that outcome — so we only rebuild a
        //     body that was swept, never one that was shot.
        if (s.actor && s.actor.dead) { s.actor = null; s.power = null; s.seated = false; continue; }
        if (s.actor && roster.indexOf(s.actor) < 0) { s.actor = null; s.power = null; s.seated = false; }
        if (!s.actor && city && !CBZ.citySpawnDraining) { staffSite(city, s); continue; }
        if (!s.actor) continue;
        // (b) SUCCESSION. Re-read the live ledger; if the seat changed hands
        //     the body's sid follows it and the whole officialdom verb set
        //     re-points with no state of ours.
        if (bindHolder(s) && s.power) declarePrincipal(s, s.seated);
        // (c) the floor ladder, on approach. Deferred because occupy.js has a
        //     citywide body budget and nine seats at boot would spend most of
        //     it on buildings nobody is standing in.
        if (!s.seated && s.lot && P && P.pos) {
          const d = Math.hypot(P.pos.x - s.cx, P.pos.z - s.cz);
          if (d < (CFG.GOV_COMPLEX_SEAT_NEAR | 0)) declarePrincipal(s, true);
        }
      }
    });
  }

  /* ====================================================================
     §8  THE DEFERRED CAR PARK. cityMakeCar reaches into CBZ.city.arena,
     which mode.js only assigns AFTER buildCity() returns — so parking real,
     stealable cars in the sea of stalls has to happen post-build. One shot,
     fully feature-detected: no vehicle module, no cars, nothing thrown.
     ==================================================================== */
  let parked = false;
  if (CBZ.onUpdate) {
    CBZ.onUpdate(55.2, function () {
      if (parked || !on()) return;
      if (!CBZ.cityMakeCar || !CBZ.cityEcon || !CBZ.cityEcon.CARS || !CBZ.city || !CBZ.city.arena) return;
      parked = true;
      const CARS = CBZ.cityEcon.CARS;
      if (!CARS.length) return;
      // one stream per BAY (not per site), so the draw count on any one stream
      // cannot change when a site's parking layout does
      for (let b = 0; b < _bays.length; b++) {
        const bay = _bays[b];
        if (!bay.rows.length) continue;
        const r = streamFor(bay.site + ":cars:" + b);
        const n = 6;
        for (let k = 0; k < n; k++) {
          const z = bay.rows[(r() * bay.rows.length) | 0];
          const x = bay.x0 + r() * Math.max(1, bay.x1 - bay.x0);
          const model = CARS[(r() * CARS.length) | 0];
          try {
            // heading 0 = nose down the bay, which is the axis the painted
            // stalls run on (the stripes are 5 m long in Z, 2.6 m apart in X)
            const c = CBZ.cityMakeCar(x, z, 0, true, model, 0);
            if (c) { c.ai = false; c.v = 0; c.baseV = 0; c.road = null; }
          } catch (e) { /* no vehicle path in this build — the stalls stay empty */ }
        }
      }
    });
  }

  /* ====================================================================
     §9  THE AUDIT — and it is a MEASUREMENT, not a stored guess.

     `overlaps` and `roadless` are the ratchets and are pinned at 0. Both are
     recomputed from the LIVE world on every call: overlaps re-runs the same
     rectangle test the placer used, against the region list and lot list as
     they stand AFTER every later builder has had its turn, so a complex that
     something else later grew on top of is caught here rather than believed
     away. CLAUDE.md's sharpest lesson is that an audit nobody has executed is
     not a measurement; this one executes on every call.
     ==================================================================== */
  function recount() {
    const A = CBZ.city && (CBZ.city.arena || CBZ.city);
    let overlaps = 0, urbanAdjacent = 0, roadless = 0, staffed = 0, placed = 0;
    const regs = (A && A.regions) || [];
    const lots = [(A && A.lots) || null, (A && A.shopLots) || null];
    for (let i = 0; i < SITES.length; i++) {
      const s = SITES[i];
      if (!s.rect) continue;
      placed++;
      let bad = false;
      if (A && isFinite(A.minX) && hit(s.rect, { minX: A.minX, maxX: A.maxX, minZ: A.minZ, maxZ: A.maxZ }, 0)) bad = true;
      if (!bad) for (let k = 0; k < regs.length; k++) {
        if (skipRegion(regs[k], true)) continue;
        if (hit(s.rect, regRect(regs[k]), 0)) { bad = true; break; }
      }
      if (!bad) for (const L of lots) {
        if (!L || bad) continue;
        for (let k = 0; k < L.length; k++) {
          const l = L[k]; if (!l || l.cx == null) continue;
          const lr = { minX: l.cx - (l.w || 24) / 2, maxX: l.cx + (l.w || 24) / 2, minZ: l.cz - (l.d || 24) / 2, maxZ: l.cz + (l.d || 24) / 2 };
          if (hit(s.rect, lr, 0)) { bad = true; break; }
        }
      }
      if (!bad) for (let k = 0; k < SITES.length; k++) {
        const o = SITES[k];
        if (k === i || !o.rect) continue;
        if (hit(s.rect, o.rect, 0)) { bad = true; break; }
      }
      // THE DECLARED EXCEPTION. `edgeOfCity` sites (City Hall) are MEANT to
      // touch the urban grid — a real city hall is in the city; that is what
      // makes it a city hall rather than a federal campus. Counting it as an
      // overlap made this ratchet read 1 forever, which would have trained
      // whoever came next to ignore the number. Excluded here and reported
      // separately as `urbanAdjacent`, so the exception is VISIBLE and cannot
      // quietly grow to cover a complex that overlapped by accident.
      if (bad) { if (s.def && s.def.edgeOfCity) urbanAdjacent++; else overlaps++; }
      if (!s.roads || !s.roads.length) roadless++;
      if (s.power && s.power.live) staffed++;
      else if (s.actor && !s.actor.dead) staffed++;   // declared, power.js absent
    }
    AUDIT.overlaps = overlaps;
    AUDIT.urbanAdjacent = urbanAdjacent;
    AUDIT.roadless = roadless;
    AUDIT.staffed = staffed;
    AUDIT.placed = placed;
  }

  CBZ.govComplexAudit = function () {
    recount();
    return {
      complexes: AUDIT.complexes,
      placed: AUDIT.placed,
      rejected: AUDIT.rejected,
      overlaps: AUDIT.overlaps,
      urbanAdjacent: AUDIT.urbanAdjacent,   // the DECLARED exception (City Hall)
      staffed: AUDIT.staffed,
      roadless: AUDIT.roadless,
      // §5b — the residences' cooks/drivers/gardeners. `household` must equal
      // `householdWanted` on a world where every complex found ground.
      household: AUDIT.household,
      householdWanted: AUDIT.householdWanted,
      householdPlaced: AUDIT.householdStations,   // rows belonging to complexes that found ground
      // the per-site working, so a probe can say WHICH one moved and why
      sites: SITES.map(function (s) {
        return {
          id: s.id, name: s.def.name,
          placed: !!s.rect,
          cx: s.cx, cz: s.cz,
          hx: s.def.hx, hz: s.def.hz,
          rejected: s.rejected,
          roads: (s.roads || []).length,
          keepOut: s.def.keepOut || null,
          tier: s.def.principal.tier,
          org: s.def.principal.org,
          role: s.def.principal.role,
          sid: (s.actor && s.actor._sid) || null,
          seated: !!s.seated,
        };
      }),
    };
  };
})();
