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
   whole readable identity of a defence headquarters), and a registry of TEN
   sites that say where each silhouette goes and who sits at the top.

   THE TENTH IS THE COUNTY JAIL, and it is the proof the registry is a
   registry: the owner reported the jail as "an OPEN-TOP BUILDING IN THE
   MIDDLE OF TOWN with 0 effort", and the whole of the placement fix is one
   ROW — no second placer, no second land contract, no second shell factory.
   games/jail.js keeps every mechanic it had and builds INTO the plot this
   file claims for it (`site.jail`). See row 10.

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
     · THE HOUSEHOLD. Five of the ten sites are RESIDENCES and every one of
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

   MEASURED on the stock world (seed 90210) WHEN THE REGISTRY HELD NINE ROWS:
     9 complexes, 9 placed, 25 candidate rectangles rejected, 0 overlaps,
     0 roadless, 9 staffed; every footprint 44 m+ clear of every foreign
     region; two runs of one seed byte-identical.
   THE TENTH ROW (County Jail) HAS NOT BEEN RE-MEASURED — `complexes` and
   `placed` should now read 10 and `rejected` will move, but this file does
   not get to claim a number nobody has run. `overlaps` and `roadless` are
   the ratchets and remain pinned at 0; whoever runs the gate next writes the
   new census in. (CLAUDE.md's own lesson: an audit nobody has executed is
   not a measurement.)

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
  // One landmark-specific switch: monumental facade + authored presidential
  // room programs. It does not revive the retired citywide building extras.
  if (CFG.PRESIDENT_COMPOUND_V2 == null) CFG.PRESIDENT_COMPOUND_V2 = true;
  // How near the player must be before a seated principal's floor ladder is
  // built. occupy.js has a citywide body budget (OCCUPY_MAX_PEDS) and nine
  // simultaneous seats would eat most of it at boot for buildings nobody is
  // standing in. Deferring the seat is power.js's own presence doctrine.
  if (CFG.GOV_COMPLEX_SEAT_NEAR == null) CFG.GOV_COMPLEX_SEAT_NEAR = 260;

  function on() { return CFG.GOV_COMPLEX !== false; }
  // A ROW MAY CARRY ITS OWN FLAG (`flag:` on the registry entry) so a feature
  // that happens to need a plot can be reverted without taking the other ten
  // seats of power down with it. Defaulted here AND in the file that owns the
  // feature — idempotent, whichever parses first wins (interact.js's
  // PROPS_WIRED_V1 precedent).
  if (CFG.WAREHOUSE_COMPLEX_V1 == null) CFG.WAREHOUSE_COMPLEX_V1 = true;
  /* GOV_STRONGROOM — §5d. The locked room and everything that follows from it:
     the key press upstairs, the steel door with the barred panel you can see
     the prize through, the arms rack and the city seal. Off → City Hall is
     byte-for-byte the building it was before (its lobby simply keeps the bay
     the vault would have taken).
     GOV_STRONGROOM_WRIT — the CATEGORICAL half only. With the seal in your
     hands every government floor in the world reads you as VIP through
     occupy.js's own `cityOccupyGrant`, so you stop being an intruder in the
     buildings that used to shoot you for standing in them. Off → the vault
     still pays its gun and its cash and you are still a trespasser upstairs.
     This is the flag to flip if access control misbehaves. */
  if (CFG.GOV_STRONGROOM == null) CFG.GOV_STRONGROOM = true;
  if (CFG.GOV_STRONGROOM_WRIT == null) CFG.GOV_STRONGROOM_WRIT = true;

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
    // freight colours — shipping containers and the racking inside a shed
    boxRust: 0x8a4b32, boxTeal: 0x2c6f6a, boxOchre: 0xb08a3a, boxBlue: 0x2f5b8c,
    rackSteel: 0xd08a2a,
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

     Ten complexes share these nine primitives. That is the point: the
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

  /* ------------------------------------------------------------------
     A FLIGHT OF STEPS IS DEFINED BY WHAT IS AT THE TOP OF IT.

     THE BUG THE OWNER FILMED (iPad, the present-day city): "there's that,
     um, like, stairway thing that doesn't even have physics that's in front
     of the government building. That doesn't really make sense what it's
     there for." Both halves of that sentence were true and they are one
     fault — a flight whose HEIGHT was typed per call and never checked
     against the surface it arrives at:

       · IT ARRIVED NOWHERE. `rise * n` was authored four times by hand.
         City Hall's flight climbed 6 x 0.30 = 1.80 m and its top tread
         landed FLUSH against the front wall of a shell whose floor and
         threshold sit at y = 0 — `cityMakeBuilding` builds every building
         in this game on the ground, and buildings_civic.js's own monumental
         podium is 0.30 m tall for exactly that reason and says so in its
         comment ("the interior floor slab tops out at 0.14 and physics'
         STEP_UP is 0.45, so a rider walks up the flight and straight in").
         The Capitol's flight climbed 2.88 m and its top three treads stood
         ON its own doorway. So the "stairway" was a solid stone mass parked
         in front of a door, going up to a blank wall: a thing that answers
         no why, which is precisely what the owner saw and could not name.
       · IT HAD NO COLLIDER — only `plat()`, a walkable TOP. That is the
         correct, documented contract at 0.30 m (buildings.js:3755 states
         it: "NO collider: a monumental stair must never be able to seal a
         building's own front door") because a riser under physics.js's
         STEP_UP = 0.45 has no flank you could walk through that you would
         not simply step onto. At 1.8-2.9 m it is a LIE: the risers were not
         solid, so the whole mass was walk-through. Hence "doesn't even have
         physics".

     So: `top` is the height the flight ARRIVES AT and the caller must state
     it; the riser count and the rise fall out of it, and the flanks take
     real colliders per tread the moment the flight is taller than one
     auto-climb. `dir` is the OUTWARD normal (+1/-1) — the flight climbs
     inward, so tread 0 is the lowest and sits at the outer lip; `axis:"x"`
     runs the same flight up an east/west face.
     ------------------------------------------------------------------ */
  const STEP_UP = 0.45;      // physics.js's own auto-climb height, quoted once
  const RISE_MAX = 0.30;     // a comfortable tread rise, and strictly under it
  // every flight this file lays, so §9 can measure that each lands on something
  const _flights = [];
  function steps(root, x, z, w, depth, top, hex, dir, axis, landing) {
    if (!(top > 0.02) || !(depth > 0.2) || !(w > 0.2)) return 0;
    /* THE RISER COUNT IS SOLVED FROM BOTH DIMENSIONS, never typed. The rise
       may not exceed RISE_MAX (that is what makes every tread auto-climbable),
       and the GOING may not be so deep that a "flight" reads as one kerb — a
       0.42 m going is the shallow end of real stair practice, and the cap of
       four extra treads stops a 12 m ceremonial band from becoming thirty. */
    const n = Math.max(1, Math.ceil(top / RISE_MAX - 1e-6), Math.min(4, Math.round(depth / 0.42)));
    const rise = top / n;
    const tread = depth / n;
    const flank = top >= STEP_UP;
    for (let i = 0; i < n; i++) {
      const back = dir * (depth / 2 - tread * (i + 0.5));   // outer lip -> facade
      const cxs = axis === "x" ? x + back : x;
      const czs = axis === "x" ? z : z + back;
      const sw = axis === "x" ? tread : w, sd = axis === "x" ? w : tread;
      const y = rise * (i + 1);
      box(root, cxs, y / 2, czs, sw, y, sd, hex, { cast: false });
      plat(cxs, czs, sw, sd, y);
      // THE FLANKS, per tread and never across one: a collider on the two
      // SIDES of the run makes the stone solid from every direction the walk
      // platforms do not answer, while the treads themselves stay open so the
      // climb the platforms exist to allow still works.
      if (!flank) continue;
      for (const s of [-1, 1]) {
        if (axis === "x") col(cxs, czs + s * (w / 2 - 0.12), tread, 0.24, 0, y);
        else col(cxs + s * (w / 2 - 0.12), czs, 0.24, tread, 0, y);
      }
    }
    _flights.push({ x: x, z: z, top: top, landing: landing == null ? top : landing });
    return n;
  }

  /* THE MONUMENTAL ENTRANCE, and it is a PERRON, not a tower of stairs.
     A capitol is monumental because it stands on a STYLOBATE — a broad, low
     platform you step up onto and cross to the door — not because its steps
     are tall. That is the only shape available to us and it is also the
     historically correct one: the deck is 0.30 m (buildings_civic.js's solved
     number, quoted rather than re-derived), so the threshold at 0.14 is one
     16 cm lip away and NOTHING can be sealed out of its own front door.
     The caller passes the point ON THE FACADE and how far the platform reaches
     out from it, so the entrance's geometry is derived from the door instead
     of being a second set of constants that can drift away from it (the lamp
     -arm lesson). Returns the deck height, so a caller can stand something on
     it without re-typing the number. */
  const PERRON_TOP = 0.30;     // deck height — under STEP_UP, over the 0.14 slab
  const PERRON_FLIGHT = 1.2;   // the band the treads themselves occupy
  function perron(root, fx, fz, w, depth, hex, dir, axis) {
    depth = Math.max(PERRON_FLIGHT + 0.8, depth);
    const deckD = depth - PERRON_FLIGHT;
    const dcx = axis === "x" ? fx + dir * deckD / 2 : fx;
    const dcz = axis === "x" ? fz : fz + dir * deckD / 2;
    const dw = axis === "x" ? deckD : w, dd = axis === "x" ? w : deckD;
    box(root, dcx, PERRON_TOP / 2, dcz, dw, PERRON_TOP, dd, hex, { cast: false });
    plat(dcx, dcz, dw, dd, PERRON_TOP);
    const scx = axis === "x" ? fx + dir * (deckD + PERRON_FLIGHT / 2) : fx;
    const scz = axis === "x" ? fz : fz + dir * (deckD + PERRON_FLIGHT / 2);
    steps(root, scx, scz, w - 1.4, PERRON_FLIGHT, PERRON_TOP, hex, dir, axis, PERRON_TOP);
    // CHEEK WALLS either flank, capped — the piece that makes a low platform
    // read as a monumental entrance rather than as a kerb, and the one part of
    // the entrance that is SUPPOSED to stop you (so it takes a real collider).
    for (const s of [-1, 1]) {
      const t = s * (w / 2 + 0.45);
      const cw = axis === "x" ? depth : 0.9, cd = axis === "x" ? 0.9 : depth;
      const ccx = axis === "x" ? fx + dir * depth / 2 : fx + t;
      const ccz = axis === "x" ? fz + t : fz + dir * depth / 2;
      box(root, ccx, 0.34, ccz, cw, 0.68, cd, hex, { cast: false });
      box(root, ccx, 0.74, ccz, cw + 0.16, 0.12, cd + 0.16, hex === M.stone ? M.stoneD : M.concreteD, { cast: false });
      col(ccx, ccz, cw, cd, 0, 0.8);
    }
    return PERRON_TOP;
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
    // SOLID. Every OTHER standing object this kit makes — the flagpole, the
    // watchtower legs, the comms tower, the floodlight masts — takes a col();
    // the 42 lamp standards lining the ceremonial approaches never did, so the
    // avenue you drive up was the one thing on the estate you could drive
    // through. city/towngen.js already collides its own 0.36 m town lamp posts.
    for (let i = 0; i < pts.length; i++) col(pts[i].x, pts[i].z, 0.4, 0.4, 0, 6.0);
  }

  // A BOLLARD LINE IS A VEHICLE BARRIER OR IT IS DECORATION. The Capitol and
  // City Hall both declare in their own comments that bollards ARE their
  // protection ("a public building is protected by BOLLARDS, not by a wall"),
  // and both drew them with NO COLLIDER at a 3.2-3.4 m pitch — a ~2.6 m clear
  // opening, which every car in this game drives straight through. The claim
  // was untrue twice over. The pitch is now SOLVED rather than typed: the gap
  // has to be under a car's width and over a body's, so it is authored as the
  // GAP and the run is re-divided to fit whole bollards into it. Still one
  // InstancedMesh per line — the draw cost does not change with the count.
  const BOL_GAP = 1.35;         // clear opening: a 1.1 m body passes, a 1.9 m car cannot
  function bollardLine(root, cx, cz, half, geo, r, h) {
    const pitch = BOL_GAP + r * 2;
    const n = Math.max(1, Math.round((half * 2) / pitch));
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push({ x: cx - half + (half * 2) * (i / n), z: cz });
    repeat(root, geo, M.steelD, pts, function () { return h / 2; });
    for (let i = 0; i < pts.length; i++) col(pts[i].x, pts[i].z, r * 2, r * 2, 0, h);
    return pts.length;
  }

  // FLOODLIGHT MAST — a mast, a head and a real collider. The compound row
  // wrote this inline; a walled yard needs the same object and a second
  // hand-typed copy of a mast height is exactly how two constants describing
  // one thing drift apart (the lamp-arm bug). One author, two consumers.
  function floodMast(root, x, z, h) {
    h = h == null ? 9.0 : h;
    cyl(root, x, h / 2, z, 0.16, 0.22, h, M.steelD, 8);
    box(root, x, h + 0.2, z, 1.2, 0.5, 0.6, M.lampHead, { cast: false, matOpts: { emissive: M.lampHead, ei: 0.85 } });
    col(x, z, 0.7, 0.7, 0, h);
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
  // Every enterable shell a complex raises, in build order, so §5c can dress
  // the INSIDE of it. Filed exactly like parkingSea's `_bays`: the builder
  // functions declare nothing, the collector is the one that knows the site.
  const _shells = [];
  /* `bopts` — an optional buildings.js override for the ONE case where a seat
     of power is not an office block. Every existing caller passes nothing and
     is byte-identical; the Freeport's shed passes the INDUSTRIAL district kit,
     which is buildings.js's own desaturated/grimier wall palette, so a bonded
     warehouse does not photograph as a corporate HQ with a dock stuck to it.
     It deliberately does NOT ask for `facade:"brick"`: config.js pins
     BLD_MASONRY_V1 = false on the owner's instruction ("what goes is the
     MASONRY/BRICK residential facade"), so a brick request silently collapses
     to office and asking for it would only look like it worked. */
  function civic(root, x, z, w, d, storeys, hex, side, spec, name, bopts) {
    let b = null;
    try {
      const base = spec ? { facade: "civic", civic: spec, district: "core" } : { facade: "office", district: "core" };
      b = CBZ.cityMakeBuilding(root, x, z, w, d, storeys, hex, side,
        bopts ? Object.assign(base, bopts) : base);
    } catch (e) { b = null; }
    if (!b) return null;
    if (_curSite) _shells.push({ site: _curSite, b: b, name: name || null });
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
    let b = null;
    try { b = CBZ.cityMakeBuilding(root, x, z, w, d, storeys, hex, side, opts || { facade: "office" }); }
    catch (e) { b = null; }
    if (b && _curSite) _shells.push({ site: _curSite, b: b, name: null });
    return b;
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
      // arrival hall · committee floor · the chamber officer's suite; the two
      // wings are committee rooms over a clerks' floor.
      interiors: { main: ["lobby", "meeting", "bosssuite"], aux: ["meeting", "deskfarm"] },
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
        // THE STYLOBATE. `cz - 26 + 56/2` IS the front facade, so the entrance
        // is derived from the chamber's own wall and reaches 12 m out from it.
        perron(root, cx, cz + 2, 62, 12, M.stone, 1);              // z +2..+14
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
        bollardLine(root, cx, cz + 20, 30.6, new THREE.CylinderGeometry(0.24, 0.28, 1.0, 8), 0.28, 1.0);
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
      // "residence AND workplace", made literal: the house is a state entrance
      // hall under the family's floor, and the WEST WING is the work — a real
      // office over the ground floor's staff room, both laid out by roomPlan.
      interiors: CFG.PRESIDENT_COMPOUND_V2 !== false
        ? { main: ["statehall", "stateresidence"], aux: ["cabinetroom", "ovaloffice"] }
        : { main: ["lobby", "bosssuite"], aux: ["deskfarm", "room:bossoffice"] },
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
        const mansionSpec = { kind: "mansion", crown: "dome", order: "doric", motto: "EXECUTIVE MANSION", stone: true };
        if (CFG.PRESIDENT_COMPOUND_V2 !== false) {
          mansionSpec.monumental = true;       // landmark opt-in; ordinary masonry stays disabled
          mansionSpec.externalPerron = true;   // this builder's 9 m state stair remains authoritative
        }
        const main = civic(root, cx, cz - 34, 56, 34, 2, M.marble, 1, mansionSpec, "Executive Mansion");
        c.main = main;
        perron(root, cx, cz - 17, 30, 9, M.stone, 1);              // facade z -17, out to -8
        // the WEST WING: the office half of "residence and workplace"
        const wingSpec = { kind: "federal", crown: "flat", order: "pilaster", motto: "WEST WING", stone: true };
        if (CFG.PRESIDENT_COMPOUND_V2 !== false) wingSpec.monumental = true;
        civic(root, cx - 58, cz - 30, 34, 22, 2, M.stone, 3, wingSpec, "West Wing");
        // the motor court — a ring of paving round a fountain, which is what
        // the front of a state residence actually is
        disc(root, cx, cz + 18, 34, M.paving, YS, 28);
        disc(root, cx, cz + 18, 9, M.lawn, YM, 20);
        if (CFG.PRESIDENT_COMPOUND_V2 !== false) {
          // A low, tiered state fountain: it terminates the arrival axis but
          // never hides the Mansion behind the old 3.8 m stone stump.
          cyl(root, cx, 0.28, cz + 18, 3.8, 4.1, 0.56, M.stone, 20);
          disc(root, cx, cz + 18, 3.45, M.pool, 0.59, 24);
          cyl(root, cx, 0.88, cz + 18, 0.62, 0.78, 1.18, M.stoneD, 14);
          cyl(root, cx, 1.52, cz + 18, 1.36, 1.55, 0.18, M.marble, 18);
          disc(root, cx, cz + 18, 1.15, M.pool, 1.63, 20);
          cyl(root, cx, 2.08, cz + 18, 0.28, 0.42, 1.10, M.stoneD, 12);
          // four water arcs read as jets from the approach, while remaining
          // low enough to preserve the ceremonial facade sightline.
          for (const q of [[-0.7, 0], [0.7, 0], [0, -0.7], [0, 0.7]])
            cyl(root, cx + q[0], 1.95, cz + 18 + q[1], 0.055, 0.075, 1.0, M.pool, 7);
          col(cx, cz + 18, 8.2, 8.2, 0, 0.58);
        } else {
          cyl(root, cx, 0.55, cz + 18, 3.4, 3.8, 1.1, M.stone, 16);
          cyl(root, cx, 1.9, cz + 18, 0.5, 0.7, 1.6, M.stoneD, 10);
          disc(root, cx, cz + 18, 3.0, M.pool, 1.14, 18);
          col(cx, cz + 18, 7.6, 7.6, 0, 1.1);
        }
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
      interiors: { main: ["lobby", "bosssuite"], aux: ["storage"] },
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
        perron(root, cx, cz - 12, 22, 7, M.stone, 1);              // facade z -12, out to -5
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
      // INTENTIONALLY MONOTONOUS (archetype (c)): the annex and the wing are
      // the SAME desk floor, over and over, all the way up. That is the read a
      // building with no signage and no windows you can see into is going for,
      // and repeating one program is how the kit expresses it.
      interiors: { main: ["lobby", "deskfarm", "deskfarm", "storage", "bosssuite"], aux: ["deskfarm", "storage"] },
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
      // you clear a manned entrance before you reach the briefing floor.
      interiors: { main: ["checkpoint", "meeting", "bosssuite"], aux: ["quarters"] },
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
      interiors: { main: ["lobby", "deskfarm", "bosssuite"], aux: ["deskfarm"] },
      /* §5d — THE ONE LOCKED ROOM. Five words and no coordinates: the bay, the
         walls, the door and the key press are all derived from the shell's own
         floorplate and its stair core. `floor: 0` is deliberate and is the
         whole design — the strongroom opens off the PUBLIC lobby, so the first
         time you walk into City Hall you can see through the bars at the thing
         you cannot have. `keyFloor: "top"` is the floor you are not allowed on.
         A second complex that wants one adds this line and no geometry. */
      strongroom: {
        name: "City Hall Strongroom", floor: 0, keyFloor: "top",
        key: "the strongroom key", org: "state",
      },
      build: function (c) {
        const R = c.rect, root = c.root, cx = c.cx, cz = c.cz;
        pad(root, R, M.paving, "cityhall");
        slab(root, cx - 48, cz + 6, 40, 60, M.lawn, YG);           // x -68..-28
        slab(root, cx + 48, cz + 6, 40, 60, M.lawn, YG);           // x +28..+68
        const main = civic(root, cx, cz - 24, 50, 32, 3, M.stone, 1,
          { kind: "cityhall", crown: "clock", order: "pilaster", motto: "CITY HALL", stone: true }, "City Hall");
        c.main = main;
        perron(root, cx, cz - 8, 30, 8, M.stone, 1);               // facade z -8, out to 0
        flagpole(root, cx - 18, cz + 6, 12);
        flagpole(root, cx + 18, cz + 6, 12);
        bollardLine(root, cx, cz + 12, 19.2, new THREE.CylinderGeometry(0.22, 0.26, 0.95, 8), 0.26, 0.95);
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
      // a crew house has no lobby. You walk into somebody's front room, and the
      // shed out the back is where the stock is.
      interiors: { main: ["room:lounge", "bosssuite"], aux: ["storage"] },
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
        // the yard: a shed big enough to hide a truck in, open hardstanding and
        // floodlights. Primitive container boxes do not substitute for detail.
        block(root, cx - 30, cz + 28, 36, 22, 1, M.steelD, 0, { facade: "office" });
        slab(root, cx + 18, cz + 24, 48, 32, M.asphalt, YG);
        for (const p of [[R.minX + 14, R.minZ + 14], [R.maxX - 14, R.minZ + 14], [R.minX + 14, R.maxZ - 14], [R.maxX - 14, R.maxZ - 14]]) {
          floodMast(root, p[0], p[1], 9.0);
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
      // the two courtyard wings are where the men who work the strip sleep.
      interiors: { main: ["room:lounge", "bosssuite"], aux: ["quarters"] },
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
      interiors: { main: ["room:lounge", "bosssuite"], aux: ["storage"] },
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
    /* ================================================================
       10. THE COUNTY JAIL — the one complex the player is brought TO.

       OWNER (2026-07-27, verbatim): "the county jail is placed stupidly on
       the map and it's still where character goes when arrested — not the
       jail game — which is FAIR, it goes to jail not prison. But why an
       OPEN-TOP BUILDING IN THE MIDDLE OF TOWN with 0 effort." And, on the
       shape of the fix: "the issue with the jail is its not in a building,
       we have buildings — the jail tries to be its own building."

       Both halves of that are the same bug and this row is the answer to
       both. games/jail.js sited its compound 24 m off `cityPoliceStation()`'s
       door — and that function is a FALLBACK CHAIN onto the City Hall shop
       lot, so "the police station" is a downtown lot and the jail landed in
       the middle of the grid. It then hand-raised three cells and an open
       yard: no roof, no shell, no region, no road, nothing the rest of the
       world knew about. A county jail is a BUILDING ON ITS OWN LAND at the
       edge of town, and both of those are things this file already does for
       nine other addresses. So the jail becomes the tenth ROW — no second
       placer, no second land contract, no second shell factory.

       WHAT THIS ROW AUTHORS: the plot, the walled court, the sally port and
       the ONE weak point in the wall. THE BUILDING IS `civic()` — the same
       `CBZ.cityMakeBuilding` shell the Capitol and City Hall are, so the
       roof, the walls, the glass, the colliders, the stair core, the floor
       plates and the batch merge all arrive for free and the cellblock is
       INSIDE architecture rather than pretending to be some.

       WHAT IT DOES NOT AUTHOR: the cells, the booking desk, the guards, the
       inmates, the pry, the transport clock. Those are games/jail.js's and
       they stay there — this row publishes `site.jail`, the coordinates it
       reserved, and jail.js dresses the ground floor and the court it finds.
       One author per object: the shell and the walls are here, the furniture
       and the bars are there, and neither re-types the other's numbers.

       PLACEMENT: `edgeOfCity` (a county jail is a county-seat building, not a
       federal campus in the wilderness) with a `bearingFrom` hint at the
       law's own door, so the search STARTS on the civic side of town and
       fans the full circle if that side is built up. Modest: 132 x 116 m, the
       smallest footprint in the registry.
       ================================================================ */
    {
      id: "countyjail", name: "County Jail", subtitle: "County Sheriff's Detention Facility",
      hx: 66, hz: 58, bearing: null, edgeOfCity: true, keepOut: "civ", gateSide: 1,
      // the full sweep, City Hall's own numbers: which side of a city has
      // clear ground is not something this file may assume.
      fan: 22, fanStep: 16 * Math.PI / 180,
      // START the search on the law's side of town. `cityPoliceStation()` is
      // police.js's own answer and is asked FIRST; it needs `CBZ.city.arena`,
      // which mode.js publishes only after buildCity returns, so on the first
      // build we ask the same question of the arena we are being handed.
      bearingFrom: function (city) {
        if (CBZ.cityPoliceStation) {
          try { const st = CBZ.cityPoliceStation(); if (st) return { x: st.x, z: st.z }; } catch (e) {}
        }
        const L = (city && city.shopLots) || null;
        if (!L || !L.length) return null;
        const lot = L.find(function (l) { return l && l.kind === "cityhall"; })
          || L.find(function (l) { return l && l.kind === "bank"; })
          || L.find(function (l) { return l && l.building && l.building.door; });
        if (!lot) return null;
        const d = lot.building && lot.building.door;
        return d ? { x: d.x, z: d.z } : { x: lot.cx, z: lot.cz };
      },
      // A SHERIFF, NOT A WARDEN — the pen is systems/capture.js's and has its
      // own staff. tier 3 is City Hall's tier: a real detail of deputies (org
      // "police" → power.js's `presetFor` government preset → spawnCopGuard),
      // not a head-of-state ring.
      principal: { key: null, tier: 3, org: "police", lawful: true, role: "County Sheriff", job: "official", wealth: 0.55 },
      // the people who commute HERE do a job, and it is not clerking
      work: { kind: "security", role: "security guard", patrol: true },
      // FLOOR 0 IS DELIBERATELY "none": it is the cellblock and the booking
      // hall, and games/jail.js dresses it. dressShell skips a floor named
      // "none", so the two files cannot both furnish one plate. Floor 1 is the
      // sheriff's own office, and that IS this file's job.
      interiors: { main: ["none", "bosssuite"], aux: ["storage"] },
      build: function (c) {
        const R = c.rect, root = c.root, cx = c.cx, cz = c.cz;
        // ---- the numbers, declared ONCE and published to jail.js below ----
        const WALL_H = 4.6, WALL_T = 0.7;      // a real yard wall, not a garden wall
        const BW = 54, BD = 28, BCZ = cz - 32; // the jail building
        const BFZ = BCZ + BD / 2;              // its front face = the court's back wall
        const YX = 34, YFZ = cz + 26;          // the walled court
        const GATE_W = 12;                     // the sally port
        const WEAK_Z = cz + 6, WEAK_W = 2.6;   // THE ONE WEAK POINT, east wall
        pad(root, R, M.concrete, "countyjail");
        // the court floor and the public forecourt in front of the wall
        slab(root, cx, (BFZ + YFZ) / 2, YX * 2, YFZ - BFZ, M.concreteD, YG);
        slab(root, cx, (YFZ + R.maxZ) / 2, 52, R.maxZ - YFZ, M.paving, YS);

        // ---- THE BUILDING. One call to the shell factory every tower and
        // civic building in this game is made of: real walls, a real roof,
        // real colliders, a stair core, floor plates and the batch merge.
        const main = civic(root, cx, BCZ, BW, BD, 2, M.concrete, 1,
          { kind: "federal", crown: "flat", order: "pilaster", motto: "COUNTY JAIL", stone: true }, "County Jail");
        c.main = main;

        // ---- THE COURT. Four runs of wall closed on its fourth side by the
        // building's own front facade, so the yard is ATTACHED to the jail
        // rather than floating beside it.
        wallRun(root, cx - YX, YFZ, cx + YX, YFZ, WALL_H, WALL_T, M.concrete, cx, GATE_W);       // front + sally port
        wallRun(root, cx - YX, BFZ, cx - YX, YFZ, WALL_H, WALL_T, M.concrete, 0, 0);             // west
        wallRun(root, cx + YX, BFZ, cx + YX, YFZ, WALL_H, WALL_T, M.concrete, WEAK_Z, WEAK_W);   // east + THE WEAK POINT
        wallRun(root, cx - YX, BFZ, cx - BW / 2, BFZ, WALL_H, WALL_T, M.concrete, 0, 0);         // return to the west corner
        wallRun(root, cx + BW / 2, BFZ, cx + YX, BFZ, WALL_H, WALL_T, M.concrete, 0, 0);         // return to the east corner
        // razor wire along every coping, one InstancedMesh for the lot. `r` is
        // the yaw repeat() reads per point: a coil lies ALONG the wall it sits
        // on, so the side runs are turned a quarter — the geometry is 1.9 m long
        // on its own X and a wall running in Z would otherwise wear it crossways.
        const wire = [];
        for (let x = cx - YX + 1.1; x <= cx + YX - 1.0; x += 2.2) wire.push({ x: x, z: YFZ, r: 0 });
        for (let z = BFZ + 1.1; z <= YFZ - 1.0; z += 2.2) {
          wire.push({ x: cx - YX, z: z, r: Math.PI / 2 });
          wire.push({ x: cx + YX, z: z, r: Math.PI / 2 });
        }
        repeat(root, bg(1.9, 0.26, 0.26), M.fenceP, wire, function () { return WALL_H + 0.34; });

        // ---- THE ONE HONEST WEAK POINT. A service gate whose leaf hangs off
        // one pin and has not latched in years: the hinge posts and the leaf
        // are drawn, the leaf swung back against the wall, and the 2.6 m
        // opening carries NO COLLIDER. That opening is the whole escape, and
        // it is one hole in one wall — everything else here is solid.
        cyl(root, cx + YX, WALL_H / 2, WEAK_Z - WEAK_W / 2, 0.1, 0.12, WALL_H, M.steelD, 8);
        cyl(root, cx + YX, WALL_H / 2, WEAK_Z + WEAK_W / 2, 0.1, 0.12, WALL_H, M.steelD, 8);
        box(root, cx + YX + 0.16, 1.6, WEAK_Z + WEAK_W / 2 + 1.15, 0.1, 3.2, 2.2, M.steelD);
        // the bin line somebody stacked against the wall beside it
        box(root, cx + YX - 2.2, 0.78, WEAK_Z + 4.4, 2.4, 1.56, 1.4, M.steelD);
        col(cx + YX - 2.2, WEAK_Z + 4.4, 2.4, 1.4, 0, 1.56);

        // ---- the sally port is MANNED, and the yard is LIT ----------------
        gatehouse(root, cx, YFZ - 6, true, M.concreteD);
        floodMast(root, cx - YX + 3, BFZ + 4, 11.0);
        floodMast(root, cx + YX - 3, BFZ + 4, 11.0);
        floodMast(root, cx - YX + 3, YFZ - 4, 11.0);
        floodMast(root, cx + YX - 3, YFZ - 4, 11.0);
        // exercise-yard markings + a bench line against the west wall
        slab(root, cx - 14, (BFZ + YFZ) / 2 + 2, 22, 15, M.paint, YM);
        for (let i = 0; i < 3; i++) {
          box(root, cx - YX + 2.6, 0.45, BFZ + 12 + i * 7, 0.7, 0.28, 4.2, M.stoneDk, { cast: false });
          col(cx - YX + 2.6, BFZ + 12 + i * 7, 0.7, 4.2, 0, 0.45);
        }

        // ---- staff parking, the impound strip and the civic approach ------
        parkingSea(root, cx - 51, cz - 4, 24, 44);        // staff, west of the court
        parkingSea(root, cx + 50, cz - 4, 24, 44);        // impound, east — the way out runs through it
        flagpole(root, cx - 13, YFZ + 12, 12);
        flagpole(root, cx + 13, YFZ + 12, 12);
        const lamps = [];
        for (let i = 0; i < 3; i++) { lamps.push({ x: cx - 20, z: YFZ + 10 + i * 10 }); lamps.push({ x: cx + 20, z: YFZ + 10 + i * 10 }); }
        lampRow(root, lamps);

        // ---- WHAT games/jail.js IS HANDED. Every one of these is a number
        // this builder already committed to; jail.js re-derives none of them,
        // which is what keeps the bars in the doorway and the escape at the
        // gate that is actually open.
        c.site.jail = {
          origin: { x: cx, z: cz },
          building: main ? main.b : null,
          lot: main ? main.lot : null,
          door: main ? main.door : null,
          court: { minX: cx - YX, maxX: cx + YX, minZ: BFZ, maxZ: YFZ },
          wallH: WALL_H,
          sally: { x: cx, z: YFZ, w: GATE_W },
          stop: { x: cx, z: YFZ + 14 },              // the cruiser's kerb, outside the wire
          weak: { x: cx + YX, z: WEAK_Z, ox: 1, oz: 0, w: WEAK_W },
        };
        return { gate: { x: cx, z: R.maxZ }, seat: main };
      },
    },
    /* ================================================================
       11. THE FREEPORT — THE ONE COMPLEX THAT IS *YOURS*.

       OWNER (2026-08-02, verbatim): "drive [the stolen money] to a plot
       like the plot we put the fake pentagon on. they can buy a warehouse
       on a plot like this and then can store their money like gta — but
       gta is fake, you do choreographed mini-missions. this is
       interaction/animation options and physical assets… only driving to
       your own place can store the cash, not just rob… maybe you have a
       cargo plane there and then can load it up and fly somewhere else to
       a house you can buy with the z key."

       So this row is the OTHER END of city/inventory.js's cash bags. A
       vault pays in canvas duffels; nothing anywhere converts one back
       into money; and the place that finally does has to be a PLACE — on
       its own land, with a road you drive up, a dock you back a truck
       into and an apron a freighter can sit on. That is this file's whole
       job description, which is why this is a `COMPLEXES` ROW AND NOT A
       SECOND PLACER (the law in scrolls/claude/engine-systems.md).

       WHAT IS DIFFERENT ABOUT IT, and it is only two things:
         • `principal: null` — nobody sits here. Every other row is a seat
           of power with a body on the threshold; a freight yard you have
           not bought yet is EMPTY, and staffSite()/the tick/the audit all
           read the null and skip. That is the honest expression of "this
           is for sale", and it costs the file three guards.
         • `keepOut: null` — a bonded yard on a public road is not a
           restricted federal campus. Traffic drives past it; you can walk
           onto the forecourt before you own it, which is how you find the
           for-sale board in the first place.

       WHAT THIS ROW AUTHORS: the plot, the fence, the gate, the shed, the
       loading dock, the racking, the container yard and the cargo strip —
       geometry, and the coordinates of every rack slot, published on
       `site.warehouse`. WHAT IT DOES NOT AUTHOR: ownership, money, bags,
       persistence or a single verb. Those are city/cashstore.js's, exactly
       the way the county jail's cells belong to games/jail.js. One author
       per object.
       ================================================================ */
    {
      id: "freeport", name: "Freeport Compound", subtitle: "Bonded Freight & Storage",
      hx: 96, hz: 82, bearing: 172, keepOut: null, gateSide: 1,
      flag: "WAREHOUSE_COMPLEX_V1",
      // NOBODY LIVES HERE. See the header: the null is load-bearing.
      principal: null,
      // …but a bonded yard has a gate guard, and `work` is how a row names
      // its own trade (the county jail's line, for the same reason).
      work: { kind: "security", role: "security guard", patrol: true },
      // Floor 0 of the shed is the STRONGROOM and this row dresses it (the
      // racking below) — "none" is what stops interior_programs from
      // furnishing the same plate twice, the county jail's exact handshake.
      // Floor 1 and the office annex take the shipped `storage` archetype,
      // so the rest of the inside is a warehouse for free.
      interiors: { main: ["none", "storage"], aux: ["storage"] },
      build: function (c) {
        const R = c.rect, root = c.root, cx = c.cx, cz = c.cz;

        /* ---- WHICH WAY DOES THE YARD FACE? DERIVED, NEVER TYPED. -----------
           The first draft typed the gate onto the +Z edge and the placer put
           this plot SOUTH of the city, so §6's linkRoad — which always routes
           from the nearest junction to `site.gate` — drove an 18 m arterial
           the full 164 m THROUGH the compound and out the far side to reach
           it. Measured: every other complex read 9 m of road inside its own
           rect (the gate pad, correct) and this one read the whole plot.

           The rest of the file never had this bug because every other row's
           `bearing` happens to leave its gate on the city side. That is luck,
           not a rule, so this row states the rule: the gate goes on the edge
           FACING THE CITY, and the whole yard is laid out relative to it.
           `GZ` is that direction (+1 = gate on +Z, -1 = gate on -Z) and `Z(d)`
           reads "d metres INTO the yard from the gate side", so one sign flip
           mirrors the gatehouse, the dock, the racks, the container stacks and
           the cargo strip together and none of them can drift apart.

           GZ IS ASKED OF THE ROAD NETWORK, NOT OF THE COMPASS, and it is asked
           through `roadJunctions` — the exact function linkRoad uses to choose
           its start point — so the gate edge and the approach can never
           disagree. Degrade order: nearest junction · arena centre · +1 (the
           shipped layout). */
        const NJ = c.city ? roadJunctions(c.city, cx, cz, 1)[0] : null;
        const AC = (c.city && c.city.center) || (CBZ.city && CBZ.city.arena && CBZ.city.arena.center) || null;
        const GZ = NJ ? (NJ.z > cz ? 1 : -1) : ((AC && AC.z > cz) ? 1 : -1);
        const Z = function (d) { return cz + GZ * d; };

        // ---- the numbers, declared ONCE and published to cashstore.js ----
        const BW = 64, BD = 36, BCX = cx - 6, BCZ = Z(-26);    // the shed
        const BFZ = BCZ + GZ * BD / 2;                         // its GATE-facing face
        const DOCK_X = cx + 14, DOCK_W = 28, DOCK_D = 10, DOCK_H = 1.2;
        // back run first, front (door-side) run last — the shelf ledger below
        // reads this array backwards so bag #1 lands nearest the door.
        const RACK_Z = [BCZ - GZ * 8, BCZ, BCZ + GZ * 8];      // three rack runs
        const RACK_Y = [0.96, 2.30];                           // two shelf levels
        /* THE RACKING MUST FIT INSIDE THE SHED IT IS IN, and the arithmetic is
           the only thing that guarantees it: eight slots at PITCH, with an
           upright half a pitch outside each end, is 8×PITCH of steel. The
           shed's clear inside span is BW - 2×1.2 = 61.6 m centred on BCX, i.e.
           x ∈ [BCX-30.8, BCX+30.8]. (The first draft ran 64.8 m of beam from
           cx-39 and put eight metres of racking — and the first column of
           duffels — THROUGH the west wall.)

           PITCH WAS 7.2 AND THE STORYBOARD SHOWED WHY THAT WAS WRONG: one
           0.78 m duffel alone in a 7.2 m bay makes a FULL rack photograph as an
           empty one. A real pallet bay is 2.7-3.6 m; 4.8 keeps a forklift aisle
           honest and lets sixteen bags read as a pile. The run is then 38.4 m
           in a 61.6 m shed, centred, with a walkable end aisle either side. */
        const SLOTS = 8, PITCH = 4.8, SLOT_X0 = BCX - (SLOTS - 1) * 4.8 / 2;
        const STRIP_Z = Z(-66), STRIP_L = 172, STRIP_W = 26;
        const APRON_Z = Z(-44);

        pad(root, R, M.gravel, "freeport");
        // the yard is hardstanding, not lawn: one big asphalt apron inside
        // the fence, with the gravel pad showing at the margins.
        slab(root, cx, Z(6), 178, 96, M.asphalt, YG);

        // ---- THE SHED. One call to the same shell factory the Capitol is
        // made of: real walls, a real roof, real colliders, floor plates and
        // the batch merge. Its door is on the GATE side, so you drive in and
        // the roller shutters are facing you.
        const main = civic(root, BCX, BCZ, BW, BD, 2, M.steel, GZ > 0 ? 1 : 0, null, "Freeport Warehouse",
          { district: "industrial" });
        // a shallow monitor roof so the box does not read as a shoebox
        box(root, BCX, 9.5, BCZ, BW * 0.42, 1.4, BD + 0.6, M.steelD, { cast: false });

        // ---- THE LOADING DOCK. A truck-height deck against the shed's own
        // front face, with three roller doors, rubber bumpers and a stair
        // down to the yard at its east end. You back a bed up to it.
        const DOCK_Z = BFZ + GZ * (DOCK_D / 2 - 0.2);
        box(root, DOCK_X, DOCK_H / 2, DOCK_Z, DOCK_W, DOCK_H, DOCK_D, M.concreteD);
        plat(DOCK_X, DOCK_Z, DOCK_W, DOCK_D, DOCK_H);
        col(DOCK_X, DOCK_Z, DOCK_W, DOCK_D, 0, DOCK_H);
        for (let i = 0; i < 3; i++) {
          const dx = DOCK_X - DOCK_W / 2 + 4.6 + i * 9.4;
          // the roller shutter, recessed into the facade
          box(root, dx, 2.4, BFZ + GZ * 0.12, 4.2, 4.4, 0.22, M.blankD, { cast: false });
          box(root, dx, 4.72, BFZ + GZ * 0.18, 4.6, 0.3, 0.3, M.warn, { cast: false });
          // bumpers either side of the opening
          box(root, dx - 2.5, DOCK_H + 0.5, BFZ + GZ * 0.3, 0.4, 0.7, 0.3, M.dark, { cast: false });
          box(root, dx + 2.5, DOCK_H + 0.5, BFZ + GZ * 0.3, 0.4, 0.7, 0.3, M.dark, { cast: false });
        }
        // the flight's height is DOCK_H, not a second number that agrees with
        // it by luck: one author, two consumers (the deck and its stair).
        steps(root, DOCK_X + DOCK_W / 2 + 3.0, DOCK_Z, DOCK_D - 2, 6.0, DOCK_H, M.concreteD, 1, "x", DOCK_H);
        // the yellow safety line along the dock lip
        slab(root, DOCK_X, BFZ + GZ * (DOCK_D - 0.6), DOCK_W, 0.5, M.warn, DOCK_H + 0.02);

        /* ---- THE RACKING — and this is the point of the whole complex.
           OWNER: the pile IS the bank statement. Every slot below is a real
           coordinate published to cashstore.js, which drops ONE duffel mesh
           on it per deposit, so a room you have filled looks filled.
           Uprights are ONE InstancedMesh for all three runs (54 posts, one
           draw call); the beams and decks are ordinary batched boxes. The
           runs sit in the SOUTH half of the plate, clear of the far corner
           elevators.js's stair core takes on floor 0. */
        const posts = [];
        for (let r = 0; r < RACK_Z.length; r++) {
          const z = RACK_Z[r];
          for (let i = 0; i <= SLOTS; i++) {
            const x = SLOT_X0 + (i - 0.5) * PITCH;
            posts.push({ x: x, z: z - 0.62 }, { x: x, z: z + 0.62 });
          }
          // beam length = upright span, so a beam ENDS on its end upright
          // instead of cantilevering half a bay into the air.
          const len = SLOTS * PITCH;
          const midX = SLOT_X0 + (SLOTS / 2 - 0.5) * PITCH;
          for (let L = 0; L < RACK_Y.length; L++) {
            const y = RACK_Y[L] - 0.06;
            box(root, midX, y, z - 0.62, len, 0.14, 0.12, M.rackSteel, { cast: false });
            box(root, midX, y, z + 0.62, len, 0.14, 0.12, M.rackSteel, { cast: false });
            // THE DECK'S TOP FACE IS THE PUBLISHED SHELF HEIGHT. A duffel model
            // sits on its own origin, so anything else floats it — 8.5 cm in
            // the first draft, which at rack scale reads as a hovering bag.
            box(root, midX, RACK_Y[L] - 0.025, z, len, 0.05, 1.2, M.steelD, { cast: false });
          }
          box(root, midX, 3.34, z, len, 0.12, 1.3, M.rackSteel, { cast: false });
          col(midX, z, len, 1.3, 0, 3.4);
        }
        repeat(root, bg(0.14, 3.4, 0.14), M.rackSteel, posts, function () { return 1.7; });

        // ---- THE OFFICE ANNEX — the only other enterable shell, and the
        // reason the aux interior list exists. Two storeys of desk-and-rack.
        block(root, cx + 38, Z(-8), 20, 16, 2, M.blank, GZ > 0 ? 1 : 0, { facade: "office" });

        // ---- THE CONTAINER YARD. What makes a fenced rectangle read as a
        // freight terminal on sight. Colours are hash-picked per stack, so a
        // seed's yard is its own and no draw touches Math.random.
        const TONE = [M.boxRust, M.boxTeal, M.boxOchre, M.boxBlue, M.steelD];
        for (let s = 0; s < 7; s++) {
          const bx = R.minX + 22 + (s % 4) * 14.5;
          const bz = Z(14 + ((s / 4) | 0) * 8.0);
          const stack = 1 + Math.floor(h01(bx, bz, 0x0F17) * 2.4);
          for (let k = 0; k < stack; k++) {
            const t = TONE[Math.floor(h01(bx + k * 3.1, bz - k * 1.7, 0x0F18) * TONE.length) % TONE.length];
            box(root, bx, 1.3 + k * 2.62, bz, 12.2, 2.6, 2.5, t);
            box(root, bx, 1.3 + k * 2.62, bz, 12.3, 0.1, 2.6, M.dark, { cast: false });
          }
          col(bx, bz, 12.2, 2.5, 0, 1.3 + stack * 2.62);
        }

        /* ---- THE CARGO STRIP. La Finca proved a dirt strip is what turns a
           rich man's ranch into a trafficking operation; a freeport's version
           is paved, lit and 172 m long, with a hardstand apron off the middle
           of it. The sibling cargo-hold wave puts a freighter on that apron;
           until it does, the apron is still a real place to land one. */
        slab(root, cx, STRIP_Z, STRIP_L, STRIP_W, M.asphalt, YG);
        const dash = [];
        for (let i = 0; i < 11; i++) dash.push({ x: cx - 72 + i * 14.4, z: STRIP_Z });
        repeat(root, bg(9.0, 0.02, 0.7), M.paint, dash, function () { return YM; });
        slab(root, cx + 34, APRON_Z, 62, 30, M.asphalt, YG);               // the apron
        disc(root, cx + 34, APRON_Z, 11, M.paint, YM, 20);
        disc(root, cx + 34, APRON_Z, 9.4, M.asphalt, YM + 0.02, 20);
        // windsock at the west threshold — the tell that this is live
        cyl(root, cx - 82, 4.0, Z(-82), 0.12, 0.16, 8.0, M.steel, 8);
        box(root, cx - 79, 7.4, Z(-82), 4.4, 1.1, 0.06, M.warn, { cast: false });

        // ---- SECURITY + LIGHT. A fence, not a wall: this is a business.
        // The fence's gap, the gatehouse and the road §6 pushes all land on
        // the same edge because all three read GZ.
        perimeter(root, R, { style: "fence", h: 3.4, hex: M.fence, gate: GZ > 0 ? 1 : 0, gateW: 18 });
        gatehouse(root, cx, Z(74), true, M.concreteD);
        watchtower(root, R.minX + 16, Z(36), M.steelD);
        for (const p of [[R.minX + 14, R.minZ + 14], [R.maxX - 14, R.minZ + 14], [R.minX + 14, R.maxZ - 14], [R.maxX - 14, R.maxZ - 14]]) {
          floodMast(root, p[0], p[1], 11.0);
        }
        const lamps = [];
        for (let i = 0; i < 4; i++) { lamps.push({ x: cx - 16, z: Z(42 - i * 11) }); lamps.push({ x: cx + 16, z: Z(42 - i * 11) }); }
        lampRow(root, lamps);
        parkingSea(root, R.maxX - 26, Z(34), 22, 30);

        /* ---- WHAT city/cashstore.js IS HANDED. Every number here is one
           this builder already committed to; cashstore.js re-derives none of
           them, which is what keeps a deposited duffel ON a shelf that
           exists and the dock verb AT the dock. */
        /* SLOT ORDER IS FILL ORDER, and it is a design decision, not an
           iteration accident: cashstore.js drops bag N on slot N, so the room
           has to fill the way a room fills. Bottom level first (you do not
           lift a duffel over your head while the floor bay is empty), and the
           run NEAREST THE DOOR first (you do not walk the length of the shed
           with a bag on your shoulder). RACK_Z is ordered back-to-front, so
           the run loop reads it backwards. */
        const shelves = [];
        for (let L = 0; L < RACK_Y.length; L++) {
          for (let r = RACK_Z.length - 1; r >= 0; r--) {
            for (let i = 0; i < SLOTS; i++) {
              shelves.push({ x: SLOT_X0 + i * PITCH, y: RACK_Y[L], z: RACK_Z[r], rot: 0 });
            }
          }
        }
        c.site.warehouse = {
          origin: { x: cx, z: cz },
          building: main ? main.b : null,
          lot: main ? main.lot : null,
          door: main ? main.door : null,
          inside: { minX: BCX - BW / 2 + 1.2, maxX: BCX + BW / 2 - 1.2,
                    minZ: Math.min(BCZ - BD / 2, BCZ + BD / 2) + 1.2,
                    maxZ: Math.max(BCZ - BD / 2, BCZ + BD / 2) - 1.2 },
          dock: { x: DOCK_X, z: BFZ + GZ * (DOCK_D + 2.0), top: DOCK_H },
          apron: { x: cx + 34, z: APRON_Z, r: 26 },
          strip: { x: cx, z: STRIP_Z, len: STRIP_L, w: STRIP_W },
          office: { x: cx + 38, z: Z(-8) },
          board: { x: cx + 5.5, z: Z(69) },           // the for-sale board by the gate
          // WHICH WAY IS OUT. The unit vector from the yard toward the gate:
          // anything that wants to stand outside and look in (a camera, a
          // parked truck, a spawn) reads this instead of assuming a compass.
          out: { x: 0, z: GZ },
          shelves: shelves,
        };
        return { gate: { x: cx, z: GZ > 0 ? R.maxZ : R.minZ }, seat: main };
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
  const AUDIT = { complexes: 0, placed: 0, rejected: 0, overlaps: 0, urbanAdjacent: 0, staffed: 0, roadless: 0, household: 0, householdWanted: 0, householdStations: 0, govBuildings: 0, govFloors: 0, govBare: 0 };

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
      // A ROW MAY NAME THE SIDE OF TOWN IT BELONGS ON, and it names it with a
      // PLACE rather than a compass number: a county jail belongs on the law's
      // side of town, and where the law's door is depends on the seed. The hint
      // only moves the SEARCH START — every candidate still runs the full
      // clearance test, and the fan still sweeps the whole circle if that side
      // of town has no clear ground, so a hint can never place anything.
      if (def.bearingFrom) {
        let p = null;
        try { p = def.bearingFrom(city); } catch (e) { p = null; }
        if (p && isFinite(p.x) && isFinite(p.z) && (p.x !== ox || p.z !== oz)) {
          base = Math.atan2(p.x - ox, -(p.z - oz));       // 0 rad = due north (-Z)
        }
      }
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

  /* ====================================================================
     §5c  THE INSIDE — GOV_INTERIORS.

     OWNER (2026-07-27): "interiors of buildings feel very unintentional."

     Nine seats of power, and twenty-three enterable shells between them, of
     which exactly ZERO had an interior authored here. What dressing did exist
     arrived by accident and late: city/power.js seats a principal when you come
     within GOV_COMPLEX_SEAT_NEAR of him, that seat runs occupy.js's floor
     ladder, and the ladder happens to run a program on two or three of the main
     hall's storeys. Everything else — the Capitol's Senate and Assembly wings,
     the Executive Mansion's West Wing, the Bureau's annex and wing, the finca's
     two courtyard wings, the compound's shed, both garages — was a lit box you
     could walk into and find nothing in, forever.

     THIS AUTHORS NO FURNITURE. Every room comes from CBZ.interiorProgram (the
     archetype kit) or CBZ.roomFurnish (the layout planner, which itself draws
     only through CBZ.furnish). What is new here is the one thing this file is
     for: a REGISTRY LINE saying which room goes on which floor of which
     building — `interiors: { main: [...], aux: [...] }`, last entry repeating
     upward, so a tenth complex declares a list and no geometry.

     AND IT HANDS THE ROOMS TO THE PEOPLE RATHER THAN RACING THEM. occupy.js
     already keeps a per-building ledger of which floors have been dressed
     (`b._occupyProgrammed` / `b._occupyAnchors`) precisely so a second
     occupation cannot stack a second set of sandbags on the first. Stamping OUR
     floors into that ledger means power.js's later cast READS these rooms —
     the guard posts, the clerks' desks and the boss's own chair are the ones
     authored here — instead of re-dressing the storey. One ledger, one room.

     WHY AT BUILD TIME. The dressing is static geometry with no userData and no
     colliders, so running it inside the landmass pass puts it AHEAD of mode.js's
     one-shot batch, which swallows the whole lot for free — the merge occupy.js
     explicitly cannot use when it dresses a floor at runtime (see its
     RE-FREEZE note). It also means the Mansion is furnished whether or not
     anybody has walked within 260 m of the President.

     THE STAIRS COME FIRST, and that ordering is load-bearing: CBZ.cityStairCore
     registers the core's footprint through buildings.js's own shaft carve, and
     `clearFloorPoint` reads that list — so furnishing after it is what keeps a
     desk out of the stairwell. It is idempotent per building, so occupy.js's
     own later call returns this same core and every program still orients off
     the same stairhead.
     ==================================================================== */
  function interiorsOn() { return CFG.GOV_INTERIORS !== false && !!CBZ.interiorFloorRoom; }

  // the room on floor k of a shell, plus the way you ARRIVE on it: the front
  // door downstairs, the stairhead everywhere above — occupy.js's own rule.
  function arriveOn(bld, k) {
    if (k <= 0) return bld.localDoor || null;
    const core = bld._stairCore;
    return (core && core.head) || bld.localDoor || null;
  }
  // metres of the plate the stair core itself eats, so a program dresses the
  // ROOM and not the stairwell. Occupy.js's insetFor, to the number.
  function insetOn(bld, room) {
    const core = bld._stairCore;
    if (!core || !core.head || !room) return 0;
    const d = core.depth + 0.6;
    const along = Math.abs(core.head.nx) > 0.5;
    const depth = along ? (room.x1 - room.x0) : (room.z1 - room.z0);
    return (depth - d >= 9.0) ? d : 0;
  }

  /* A SEAT OF POWER HAS NO ROOM-SIZED FLOORPLATES, and that is the one thing
     that stops world/roombuild.js from being usable here as-is. roomPlan is a
     ROOM planner: its wall slots, its 0.90 m circulation band and its 25-40 %
     coverage law all assume a rect you can see across. Hand it the hacienda's
     44x26 hall and it puts four pieces in eleven hundred square metres, reports
     `sparse`, and it is right and useless.

     So on an oversized plate we BUILD THE ROOM instead of pretending the hall
     is one: a partitioned corner whose other two walls are the building's own,
     with ONE doorway, sited at the far end from the way you arrive so you cross
     the hall to reach it. The hall itself stays open, which is what the inside
     of a big house actually is. The wall comes from the shared kit
     (CBZ.interiorPartition) — this file draws no architecture of its own. */
  const ROOM_W = 8.5, ROOM_D = 7.5;      // a generous private room, not a hall
  function carveRoom(bld, k, room, ctx) {
    const dn = arriveOn(bld, k) || { x: 0, z: room.z0, nx: 0, nz: 1 };
    const W = room.x1 - room.x0, D = room.z1 - room.z0;
    // already room-sized: furnish the whole plate and draw nothing.
    if (W <= ROOM_W + 2.2 && D <= ROOM_D + 2.2)
      return { rect: { x0: room.x0, x1: room.x1, z0: room.z0, z1: room.z1, y: room.y }, door: { x: dn.x, z: dn.z } };
    const RW = Math.min(ROOM_W, W - 1.6), RD = Math.min(ROOM_D, D - 1.6);
    const alongX = Math.abs(dn.nx) > 0.5;
    const flip = h01(bld.ox + k * 3.7, bld.oz, 0x0C11) < 0.5 ? -1 : 1;
    let x0, x1, z0, z1;
    // the running axis of arrival puts the room at the FAR end; the other axis
    // is a deterministic coin, so two floors of one building are not identical
    // and two buildings are not either.
    const farX = alongX ? (dn.nx > 0) : (flip > 0);
    const farZ = alongX ? (flip > 0) : (dn.nz > 0);
    if (farX) { x1 = room.x1; x0 = x1 - RW; } else { x0 = room.x0; x1 = x0 + RW; }
    if (farZ) { z1 = room.z1; z0 = z1 - RD; } else { z0 = room.z0; z1 = z0 + RD; }
    // the two INNER walls are the ones not lying on a real facade; the doorway
    // goes on the one that faces the way you came in.
    const xi = farX ? x0 : x1, zi = farZ ? z0 : z1;
    const doorOnX = alongX;
    const gX = (x0 + x1) / 2, gZ = (z0 + z1) / 2;
    if (CBZ.interiorPartition) {
      // running along z at fixed x = xi
      CBZ.interiorPartition(room, ctx, { axis: "z", at: xi, from: z0, to: z1, gap: doorOnX ? gZ : null, gapW: 1.8 });
      // running along x at fixed z = zi
      CBZ.interiorPartition(room, ctx, { axis: "x", at: zi, from: x0, to: x1, gap: doorOnX ? null : gX, gapW: 1.8 });
    }
    return {
      rect: { x0: x0, x1: x1, z0: z0, z1: z1, y: room.y },
      door: doorOnX ? { x: xi, z: gZ } : { x: gX, z: zi },
    };
  }

  // ONE floor. `name` is either an archetype from CBZ.interiorProgramNames or
  // "room:<program>", which routes to world/roombuild.js's layout planner.
  // Returns the role-tagged anchors (empty for a planner room, which is honest:
  // a bedroom has no guard post in it).
  function dressFloor(bld, k, name, vault) {
    const room = CBZ.interiorFloorRoom(bld, k);
    if (!room) return null;
    // §5d reserved a bay off this plate: the room the PROGRAM is handed stops
    // at the strongroom's wall, which is what keeps the lobby's furniture out
    // of a room the lobby cannot reach (and is why the vault is carved before
    // anything is dressed rather than stamped over a finished floor).
    if (vault && vault.floor === k) room.x1 = vault.lobbyX1;
    const rect = { x0: room.x0, x1: room.x1, z0: room.z0, z1: room.z1, y: room.y };
    const ctx = { b: bld, opts: { door: arriveOn(bld, k), inset: insetOn(bld, room) } };
    if (name.slice(0, 5) === "room:") {
      const prog = name.slice(5);
      if (CFG.INTERIOR_ROOMPLAN === false || !CBZ.roomFurnish) {
        // degrade-safe: the planner is off or absent, so this floor takes the
        // nearest archetype the kit ships rather than coming out bare.
        const alt = prog === "bedroom" ? "quarters" : prog === "bossoffice" ? "bosssuite" : "lobby";
        const out = CBZ.interiorProgram(alt, rect, ctx);
        return (out && out.anchors) ? out.anchors : [];
      }
      // the floor covering + the ceiling strip are the SHELL, not the layout —
      // roomFurnish places furniture and deliberately draws no room.
      if (CBZ.interiorShell) CBZ.interiorShell(rect, ctx);
      const sub = carveRoom(bld, k, room, ctx);
      CBZ.roomFurnish(sub.rect, prog, {
        box: bld.lbox, ox: bld.ox, oz: bld.oz,
        // buildings.js's own aisle/stair/lift-chase predicate, in the same
        // building-local space as the rect. Without it the planner furnishes
        // the stairwell and the doorway.
        clear: bld.clearFloorPoint || null,
        door: sub.door,
        // determinism: the layout is a pure function of (rect, seed), and the
        // seed is the building's own origin — never Math.random, never a draw
        // on a shared stream.
        seed: (Math.round(bld.ox) * 401) ^ (Math.round(bld.oz) * 733) ^ (k * 97),
        tone: "exec",
      });
      return [];
    }
    const out = CBZ.interiorProgram(name, rect, ctx);
    return (out && out.anchors) ? out.anchors : [];
  }

  // one shell, floor by floor. `list` is the registry row; its LAST entry
  // repeats for every storey above it, which is how a five-storey annex and a
  // one-storey garage share one declaration.
  function dressShell(bld, list, ledgerHost, vault) {
    if (!bld || !list || !list.length || typeof bld.lbox !== "function") return 0;
    const n = CBZ.interiorFloorCount ? CBZ.interiorFloorCount(bld) : 0;
    if (n < 1) return 0;
    let done = 0;
    for (let k = 0; k < n; k++) {
      const name = list[Math.min(k, list.length - 1)];
      if (!name || name === "none") continue;
      // NEVER dress a floor somebody else already dressed. The ledger is
      // occupy.js's, and re-running its own idempotency rule here is what stops
      // a re-occupied building from getting two floor coverings.
      if (ledgerHost && ledgerHost._occupyProgrammed && ledgerHost._occupyProgrammed[k]) continue;
      let anchors = null;
      try { anchors = dressFloor(bld, k, name, vault); } catch (e) { anchors = null; }
      if (!anchors) continue;
      done++;
      AUDIT.govFloors++;
      if (!ledgerHost) continue;
      ledgerHost._occupyProgrammed = ledgerHost._occupyProgrammed || Object.create(null);
      ledgerHost._occupyAnchors = ledgerHost._occupyAnchors || Object.create(null);
      ledgerHost._occupyProgrammed[k] = name;
      ledgerHost._occupyAnchors[k] = anchors.map(function (a) {
        return {
          x: a.x, y: a.y, z: a.z, face: a.face, lx: a.lx, lz: a.lz,
          kind: a.kind, pose: a.pose, cushionH: a.cushionH, floorBelow: a.floorBelow,
        };
      });
    }
    return done;
  }

  function dressComplex(site) {
    if (!interiorsOn()) return 0;
    const plan = site.def.interiors;
    if (!plan) return 0;
    const mainB = site.lot && site.lot.building;
    // civic() hands the lot a SHALLOW COPY of the building record, and that copy
    // is what occupy.js's bldOf(lot) returns — so the ledger has to be stamped
    // on THAT object or the two files will not agree about which floors are
    // dressed. Both share every closure (lbox, clearFloorPoint) and the
    // shaftRects array by reference, so drawing through either is identical.
    let n = 0;
    if (mainB && plan.main) {
      if (CFG.OCCUPY_STAIRS !== false && CBZ.cityStairCore) {
        try { CBZ.cityStairCore(site.lot); } catch (e) {}
      }
      // THE STRONGROOM IS RESERVED BEFORE ANYTHING IS FURNISHED and built after,
      // for the same reason the stair core is asked for first: the bay it takes
      // out of the plate has to be known to the programs, and its own walls have
      // to stand on a floor covering that is already down.
      const vault = planStrongroom(site, mainB);
      const got = dressShell(mainB, plan.main, mainB, vault);
      n += got;
      if (got) AUDIT.govBuildings++; else AUDIT.govBare++;
      mainB._govDressed = got;
      if (vault) { try { buildStrongroom(site, vault); } catch (e) { console.error("[govcomplex] strongroom " + site.id, e); } }
    }
    for (let i = 0; i < _shells.length; i++) {
      const s = _shells[i];
      if (s.site !== site.id) continue;
      if (site.lot && s.b === site.lot._rawMain) continue;   // the main hall, already done
      if (!plan.aux) { AUDIT.govBare++; continue; }
      if (CFG.OCCUPY_STAIRS !== false && CBZ.cityStairCore) {
        try { CBZ.cityStairCore({ building: s.b }); } catch (e) {}
      }
      // an annex has no lot and nothing will ever occupy it, so it carries no
      // ledger — it is dressed once and that is the whole of its life.
      const got = dressShell(s.b, plan.aux, null);
      n += got;
      if (got) AUDIT.govBuildings++; else AUDIT.govBare++;
      s.b._govDressed = got;
    }
    return n;
  }

  /* ====================================================================
     §5d  THE STRONGROOM — the one LOCKED room, and the only reason any of
     this architecture is worth walking into.

     OWNER (verbatim, on the screenshot this wave came from): "The government
     building, in general, is kinda stupid."  He is right, and the audit says
     why in one line: before this block a seat of power was a shell, a
     furnished floorplate and a man on the threshold, and there was NOTHING
     ANYWHERE INSIDE IT THAT WAS SHUT. `keepOut` is a spawn zone. `access` is a
     trespass query. occupy.js states the gap in its own header — "it does not
     lock doors, because nothing in this engine has a lockable door yet" — and
     scrolls/claude/engine-systems.md books it as the NEXT OWED. A building with
     no closed door in it cannot make a gradient, and a building that makes no
     gradient is a prop with a marker on it, which is doctrine LAW 1's exact
     complaint.

     THE GUN-ROOM GRAMMAR, applied literally (doctrine's three conditions):
       (a) IT IS LOCKED, and the lock is real: a steel leaf with a real
           collider across a real doorway, which the player meets on his FIRST
           visit because the vault opens off the PUBLIC lobby. Nobody sends him
           there. He walks in the front door of a building he is allowed in,
           and there is a door he is not allowed through.
       (b) YOU CAN SEE THROUGH IT. The leaf carries a barred vision panel and
           the rack and the seal stand lit on the other side of it. A key is a
           promise, and a promise you can SEE out-motivates any quest marker.
       (c) THE REWARD CHANGES YOUR CATEGORY. The rack pays a real gun through
           `CBZ.cityGiveWeapon` (careers.js's Senior Guard seam — never a stat
           fiction). The SEAL pays the thing a number cannot: hold it and every
           government floor in the world stops reading you as an intruder,
           through occupy.js's OWN `cityOccupyGrant`. You go from "shot for
           standing on the mayor's floor" to "walks into government buildings",
           which is the jail's "only character with a gun" in civic dress.

     THE LADDER IS THE BUILDING, and it is four rungs you can see from the one
     below: the public lobby → the door you cannot open → the floor you are not
     allowed on (power.js already declares it `vip` and occupy.js already puts
     men on it) → the key press on its wall → back down to the door. That is
     the keycard story, one for one, and not one rung of it is a marker.

     WHAT IT AUTHORS: the bay, four walls, the leaf, the reader, the rack, the
     seal, the shelving, the key press. WHAT IT DOES NOT AUTHOR: the interaction
     card (city/interactions.js `registerZone`), the floor covering and ceiling
     light (`CBZ.interiorShell`), the guards on the key floor (power.js →
     occupy.js), the alarm (`cityOccupyAlarm`), the heat (`cityCrime`), the
     weapon (`cityGiveWeapon`), the money (`CBZ.city.addCash`), the item rows
     (`CBZ.cityEcon.add`) or the access model (`cityOccupyGrant`). Nine shipped
     systems; this block is a PLACE and a lock.

     DETERMINISM: every coordinate is derived from the shell's own floorplate
     and stair core. No rng, no hash, no Math.random in the build path.
     ==================================================================== */
  function srOn() { return CFG.GOV_STRONGROOM !== false; }
  const SR = [];                 // live strongrooms, one per complex that declares one
  // WHO HOLDS THE WRIT. One boolean, on CBZ.game so a save that serialises the
  // game object carries it, mirrored locally so a flag-off build reads false.
  function writHeld() { return !!(CBZ.game && CBZ.game.cityGovWrit) && CFG.GOV_STRONGROOM_WRIT !== false; }

  const SR_WT = 0.34;            // the strongroom wall's thickness, declared ONCE:
                                 // planStrongroom stops the lobby's floor
                                 // covering exactly at its outer face and
                                 // buildStrongroom stands the wall on it, so the
                                 // two cannot drift into a bare strip of slab.
  const SRM = {
    wall: 0xa9a49a, steel: 0x596069, steelD: 0x3a4048, bar: 0x8c939b,
    rackY: 0xb98a2e, gun: 0x2c2f34, crate: 0x6d6558, sealG: 0xd8b24a,
    lampW: 0xeaf0ff, lockRed: 0xd23b32, lockGrn: 0x35c06a,
  };
  function srMesh(b, geo, mat, lx, ly, lz, parent) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(lx, ly, lz);
    m.castShadow = false; m.receiveShadow = true;
    (parent || b.group).add(m);
    return m;
  }

  /* RESERVE THE BAY. Called before a single floor is furnished; returns null
     (and the building is untouched) whenever the shell cannot carry a vault —
     too few floors to hide a key on, or a plate so small that taking a bay out
     of it would leave no lobby. Nothing here draws. */
  function planStrongroom(site, bld) {
    if (!srOn() || !site.def.strongroom) return null;
    if (!bld || typeof bld.lbox !== "function" || !bld.group) return null;
    if (!CBZ.interiorFloorRoom || !CBZ.interiorFloorCount) return null;
    const spec = site.def.strongroom;
    const nF = CBZ.interiorFloorCount(bld) | 0;
    if (nF < 2) return null;                        // no floor to put the key on
    const kF = Math.max(0, Math.min(nF - 1, spec.floor | 0));
    const keyF = spec.keyFloor === "top" ? nF - 1 : Math.max(0, Math.min(nF - 1, spec.keyFloor | 0));
    if (keyF === kF) return null;                   // the key must not be IN the room
    const room = CBZ.interiorFloorRoom(bld, kF);
    // the key floor has to be a real floorplate too — a vault whose key press
    // has nowhere to hang is a locked door with no key, which is worse than no
    // door at all.
    if (!room || !CBZ.interiorFloorRoom(bld, keyF)) return null;
    const W = room.x1 - room.x0, D = room.z1 - room.z0;
    const BAY = Math.max(4.6, Math.min(7.0, W * 0.28));
    if (W - BAY < 7.0 || D < 7.0) return null;      // the lobby must still be a lobby
    return {
      id: site.id, site: site, b: bld, spec: spec,
      floor: kF, keyFloor: keyF,
      x0: room.x1 - BAY, x1: room.x1, z0: room.z0, z1: room.z1,
      y: room.y, fh: room.fh, lobbyX1: room.x1 - BAY - SR_WT / 2,
      // state
      locked: true, key: false, rack: false, seal: false,
      swing: 0, target: 0, pivot: null, lamp: null, keyMesh: null,
      doorCol: null, at: null, keyAt: null, rackAt: null, sealAt: null,
    };
  }

  /* BUILD IT. Everything below is building-LOCAL (buildings.js parks the shell
     group at (ox, 0, oz) with no rotation, so local y IS world y and local x/z
     plus the origin IS world x/z — which is what lets the interaction zone
     work in world space without a transform). */
  function buildStrongroom(site, v) {
    const b = v.b, y = v.y, WH = Math.max(2.6, v.fh - 0.12);
    const WT = SR_WT, GAP = 2.0, DH = Math.min(2.28, WH - 0.5);
    const gz = v.z1 - 3.4;                       // the doorway, at the lobby end
    const BAY = v.x1 - v.x0;
    const insideX = (v.x0 + v.x1) / 2;

    // ---- the room itself: floor covering + ceiling strip from the shared kit
    if (CBZ.interiorShell) {
      try { CBZ.interiorShell({ x0: v.x0, x1: v.x1, z0: v.z0, z1: v.z1, y: y }, { b: b }); } catch (e) {}
    }
    // ---- THE WALL. Solid, unlike every partition the interior kit draws —
    // that kit's walls carry no collider on purpose (they divide a room you are
    // allowed in), and a strongroom wall you can walk through is the whole bug.
    const segs = [[v.z0, gz - GAP / 2], [gz + GAP / 2, v.z1]];
    for (const s of segs) {
      const len = s[1] - s[0];
      if (len < 0.2) continue;
      b.lbox(v.x0, y + WH / 2, (s[0] + s[1]) / 2, WT, WH, len, SRM.wall, { solid: true, los: true, cast: false });
    }
    // the header over the opening, and the steel surround under it
    b.lbox(v.x0, y + DH + (WH - DH) / 2, gz, WT, WH - DH, GAP, SRM.wall, { solid: true, cast: false });
    b.lbox(v.x0, y + DH + 0.09, gz, WT + 0.12, 0.18, GAP + 0.24, SRM.steelD, { cast: false });
    for (const s of [-1, 1]) b.lbox(v.x0, y + DH / 2, gz + s * (GAP / 2 + 0.06), WT + 0.12, DH, 0.12, SRM.steelD, { cast: false });

    /* ---- THE LEAF. A pivot at the hinge so the door SWINGS rather than
       teleports; the collider is a separate world-space record we splice out of
       CBZ.colliders the moment it opens (physics.js rebuilds its bucket grid on
       any length change, so nothing has to be told). The leaf carries no
       userData and needs none — a mesh under a pivot Group is not in the static
       merge's flat scan path, and the pieces that ARE flat (the walls) are
       spared by their own collider refs, which is core/batch.js's own rule. */
    const HZ = gz - GAP / 2 + 0.05;              // hinge, on the -z jamb
    const LW = GAP - 0.14;                       // leaf width along +z from the hinge
    const pivot = new THREE.Group();
    pivot.position.set(v.x0, y, HZ);
    b.group.add(pivot);
    v.pivot = pivot;
    const steel = cm(SRM.steel);
    const WINY0 = 1.24, WINY1 = 1.78, WINH = 0.72;   // the vision panel
    const cz0 = LW / 2;
    srMesh(b, bg(0.16, WINY0, LW), steel, 0, WINY0 / 2, cz0, pivot);
    srMesh(b, bg(0.16, DH - WINY1, LW), steel, 0, (WINY1 + DH) / 2, cz0, pivot);
    for (const s of [-1, 1]) {
      const stile = (LW - WINH) / 2;
      srMesh(b, bg(0.16, WINY1 - WINY0, stile), steel, 0, (WINY0 + WINY1) / 2, cz0 + s * (LW - stile) / 2, pivot);
    }
    // the bars — five of them, and they are the reason the room is a promise
    const barMat = cm(SRM.bar);
    for (let i = 0; i < 5; i++) {
      srMesh(b, bg(0.05, WINY1 - WINY0, 0.05), barMat, 0, (WINY0 + WINY1) / 2,
        cz0 - WINH / 2 + (WINH / 4) * i, pivot);
    }
    srMesh(b, bg(0.09, 0.09, 0.34), cm(SRM.steelD), -0.13, 1.05, LW - 0.34, pivot);   // the handle
    // ---- THE READER, on the lobby side of the jamb. Its lamp is a FRESH
    // material on purpose: CBZ.cmat is a colour-keyed GLOBAL cache and this one
    // has to change colour when you are carrying the key.
    b.lbox(v.x0 - WT / 2 - 0.06, y + 1.32, gz - GAP / 2 - 0.34, 0.1, 0.34, 0.22, SRM.steelD, { cast: false });
    const lampMat = new THREE.MeshLambertMaterial({ color: SRM.lockRed, emissive: SRM.lockRed, emissiveIntensity: 0.9 });
    v.lamp = srMesh(b, bg(0.05, 0.09, 0.09), lampMat, v.x0 - WT / 2 - 0.13, y + 1.42, gz - GAP / 2 - 0.34);
    v.lampMat = lampMat;

    // ---- WHAT IS BEHIND THE BARS. Sited on the sightline through the panel so
    // the prize is what you see, not the back of a shelf.
    // THE ARMS RACK — the confiscated guns, on the far wall facing the door.
    const rz = gz + 0.4, rx = v.x1 - 0.55;
    b.lbox(rx, y + 1.05, rz, 0.34, 2.1, 3.0, SRM.steelD, { solid: true, cast: false });
    for (let i = 0; i < 2; i++) b.lbox(rx - 0.22, y + 0.72 + i * 0.72, rz, 0.1, 0.08, 2.9, SRM.rackY, { cast: false });
    for (let i = 0; i < 6; i++) {
      const gzz = rz - 1.25 + i * 0.5;
      b.lbox(rx - 0.3, y + 1.12, gzz, 0.1, 0.9, 0.12, SRM.gun, { cast: false });
      b.lbox(rx - 0.3, y + 0.72, gzz, 0.1, 0.34, 0.09, SRM.gun, { cast: false });
    }
    v.rackAt = { x: b.ox + rx - 0.9, z: b.oz + rz };
    // THE SEAL — the die the city stamps its writs with, on a lit plinth in the
    // middle of the sightline. One downlight over it: the room is CRAFTED, and
    // craft is the signal (doctrine's gun-room condition (b)).
    const sx = insideX + 0.2, sz = gz + 0.2;
    b.lbox(sx, y + 0.45, sz, 0.8, 0.9, 0.8, SRM.steelD, { solid: true, cast: false });
    b.lbox(sx, y + 0.94, sz, 1.0, 0.08, 1.0, SRM.wall, { cast: false });
    const sealMat = new THREE.MeshLambertMaterial({ color: SRM.sealG, emissive: SRM.sealG, emissiveIntensity: 0.35 });
    v.sealMesh = srMesh(b, new THREE.CylinderGeometry(0.3, 0.3, 0.24, 18), sealMat, sx, y + 1.1, sz);
    srMesh(b, new THREE.CylinderGeometry(0.14, 0.14, 0.3, 12), cm(SRM.steelD), sx, y + 1.37, sz);
    b.lbox(sx, y + v.fh - 0.28, sz, 0.5, 0.1, 0.5, SRM.lampW, { emissive: SRM.lampW, ei: 0.75, cast: false });
    v.sealAt = { x: b.ox + sx, z: b.oz + sz };
    // …and the rest of the bay is what a strongroom actually holds: evidence.
    for (let r = 0; r < 3; r++) {
      const ez = v.z0 + 1.6 + r * ((gz - 2.4 - v.z0) / 3);
      if (ez > gz - 1.6) break;
      b.lbox(insideX, y + 1.1, ez, BAY - 1.4, 0.09, 0.7, SRM.steelD, { cast: false });
      b.lbox(insideX, y + 1.85, ez, BAY - 1.4, 0.09, 0.7, SRM.steelD, { cast: false });
      // the boxes are spaced off the BAY the plate actually gave us — a typed
      // pitch is how the first draft of the Freeport's racking put a column of
      // duffels through the west wall.
      const pitch = (BAY - 2.0) / 3;
      for (let i = 0; i < 4; i++) {
        b.lbox(v.x0 + 1.0 + i * pitch, y + 1.36, ez, Math.min(0.7, pitch - 0.2), 0.42, 0.55, SRM.crate, { cast: false });
      }
    }

    // ---- THE KEY PRESS, on the floor you are not allowed on. Mounted flat on
    // the stair core's own wall beside the stairhead — the strip every interior
    // program insets AWAY from, so it can never be furnished over, and the
    // first thing you meet when you come up the stairs you should not be on.
    const kRoom = CBZ.interiorFloorRoom(b, v.keyFloor);
    const core = b._stairCore;
    let kx, kz, kn;
    if (core && core.head) {
      const n = { x: core.head.nx || 0, z: core.head.nz || 0 };
      const nl = Math.hypot(n.x, n.z) || 1;
      n.x /= nl; n.z /= nl;
      kn = n;
      kx = core.head.x + n.x * 0.2 + (-n.z) * 1.9;
      kz = core.head.z + n.z * 0.2 + (n.x) * 1.9;
    } else if (kRoom) {
      kn = { x: -1, z: 0 };
      kx = kRoom.x1 - 0.2; kz = kRoom.z0 + 1.9;
    } else { kx = null; }
    if (kx != null) {
      const ky = (kRoom ? kRoom.y : v.y) + 1.52;
      b.lbox(kx, ky, kz, 0.9 * Math.abs(kn.z) + 0.24 * Math.abs(kn.x), 0.72,
        0.9 * Math.abs(kn.x) + 0.24 * Math.abs(kn.z), SRM.steelD, { cast: false });
      const glass = new THREE.MeshLambertMaterial({ color: 0xbfe9f7, transparent: true, opacity: 0.4 });
      srMesh(b, bg(0.72 * Math.abs(kn.z) + 0.05 * Math.abs(kn.x), 0.54,
        0.72 * Math.abs(kn.x) + 0.05 * Math.abs(kn.z)), glass,
        kx + kn.x * 0.14, ky, kz + kn.z * 0.14);
      const keyMat = new THREE.MeshLambertMaterial({ color: SRM.sealG, emissive: SRM.sealG, emissiveIntensity: 0.4 });
      v.keyMesh = srMesh(b, bg(0.06 * Math.abs(kn.z) + 0.03, 0.26, 0.06 * Math.abs(kn.x) + 0.03), keyMat,
        kx + kn.x * 0.05, ky - 0.02, kz + kn.z * 0.05);
      v.keyAt = { x: b.ox + kx + kn.x * 0.7, z: b.oz + kz + kn.z * 0.7, y: (kRoom ? kRoom.y : v.y) };
    }

    // ---- the lock itself. World space, so it can be spliced out on open.
    v.at = { x: b.ox + v.x0, z: b.oz + gz, y: y };
    v.doorCol = col(v.at.x, v.at.z, WT + 0.2, GAP, y, y + DH);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    v.gz = gz; v.floorY = y;
    SR.push(v);
    site.strongroom = v;
    registerStrongroomZone();
    return v;
  }

  function srNote(s, t) { if (CBZ.city && CBZ.city.note) CBZ.city.note(s, t || 2.2); }

  function srOpen(v) {
    if (!v.locked) return;
    v.locked = false;
    v.target = -1.55;                                  // swings out into the lobby
    if (v.doorCol) {
      const i = (CBZ.colliders || []).indexOf(v.doorCol);
      if (i >= 0) CBZ.colliders.splice(i, 1);
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
      v.doorCol = null;
    }
    // A GOVERNMENT STRONGROOM COMING OPEN IS A CRIME AND THE BUILDING HEARS IT.
    // Both consequences are shipped systems; neither is written here.
    if (CBZ.cityCrime) { try { CBZ.cityCrime(230, { instant: true, x: v.at.x, z: v.at.z, type: "burglary" }); } catch (e) {} }
    if (CBZ.cityOccupyAlarm && v.site && v.site.lot) {
      try { CBZ.cityOccupyAlarm(v.site.lot, CBZ.player, v.floor, { secs: 22 }); } catch (e) {}
    }
    if (CBZ.cityPanicRaise) { try { CBZ.cityPanicRaise(v.at.x, v.at.z, 0.8); } catch (e) {} }
    srNote("The bolts go back. Somebody upstairs heard that.", 2.6);
  }

  // THE VERBS. One zone, one option, four targets — the registry's own slot
  // exclusivity keeps them from colliding, and no second popup exists.
  let srZoned = false;
  function srTargets(px, pz, py) {
    let best = null, bd = 3.4 * 3.4;
    for (let i = 0; i < SR.length; i++) {
      const v = SR[i];
      const pts = [];
      if (v.at && v.locked) pts.push({ x: v.at.x, z: v.at.z, y: v.floorY, what: "door" });
      if (v.keyAt && !v.key) pts.push({ x: v.keyAt.x, z: v.keyAt.z, y: v.keyAt.y, what: "key" });
      if (v.rackAt && !v.locked && !v.rack) pts.push({ x: v.rackAt.x, z: v.rackAt.z, y: v.floorY, what: "rack" });
      if (v.sealAt && !v.locked && !v.seal) pts.push({ x: v.sealAt.x, z: v.sealAt.z, y: v.floorY, what: "seal" });
      for (let k = 0; k < pts.length; k++) {
        const p = pts[k];
        // a tower stacks a floorplate every 3.2 m: the plan distance to the one
        // above you is zero, so Y is not optional here.
        if (py != null && Math.abs(p.y - py) > 2.2) continue;
        const dx = p.x - px, dz = p.z - pz, d = dx * dx + dz * dz;
        if (d >= bd) continue;
        bd = d; best = { x: p.x, z: p.z, what: p.what, v: v };
      }
    }
    return best;
  }
  function registerStrongroomZone() {
    if (srZoned || !CBZ.interactions || !CBZ.interactions.registerZone) return;
    srZoned = true;
    CBZ.interactions.registerZone({
      id: "gov-strongroom", kind: "gov-strongroom", radius: 3.4,
      find: function (px, pz) {
        if (!srOn()) return null;
        const P = CBZ.player;
        return srTargets(px, pz, P && P.pos ? P.pos.y : null);
      },
      options: [{
        id: "gov-strongroom-use", slot: "e",
        label: function (t) {
          if (!t) return "";
          const v = t.v;
          if (t.what === "key") return "Take " + (v.spec.key || "the key");
          if (t.what === "rack") return "Take a weapon off the rack";
          if (t.what === "seal") return "Take the city seal";
          return v.key ? "Unlock the strongroom" : "Strongroom — locked";
        },
        // deliberately NOT `bad`: that field is a static truthy in this registry
        // (interactions.js:363 subtracts 240 from the target score for it), so
        // flagging a door as a crime prompt would push the card behind any ped
        // standing in the lobby. The consequence is filed when the bolts go
        // back, which is the honest place for it.
        onSelect: function (t) {
          if (!t) return;
          const v = t.v;
          if (t.what === "key") {
            v.key = true;
            if (v.keyMesh) v.keyMesh.visible = false;
            // the reader goes green. Wrapped because a THROW out of onSelect
            // lands in the interaction registry's own dispatch and would eat
            // every verb on the card, not just this one.
            try { v.lampMat.color.setHex(SRM.lockGrn); v.lampMat.emissive.setHex(SRM.lockGrn); } catch (e) {}
            srNote("A brass key on a tagged fob. It opens one door in this building.", 2.8);
            return;
          }
          if (t.what === "door") {
            if (!v.key) {
              srNote("Steel, and the reader wants a card nobody down here carries. The key is upstairs.", 2.8);
              return;
            }
            srOpen(v);
            return;
          }
          if (t.what === "rack") {
            v.rack = true;
            srTakeRack(v);
            return;
          }
          if (t.what === "seal") {
            v.seal = true;
            srTakeSeal(v);
          }
        },
      }],
    });
  }

  // THE HAUL — the rack. `cityGiveWeapon` is careers.js's Senior-Guard seam:
  // an inventory row AND the real equipped weapon, so a gun on the wall is a
  // gun in your hands and never a number on a sheet.
  const SR_GUNS = ["AK-47", "Rifle", "Shotgun", "SMG", "Pistol"];
  function srTakeRack(v) {
    const econ = CBZ.cityEcon;
    let name = null;
    for (let i = 0; i < SR_GUNS.length && !name; i++) {
      const n = SR_GUNS[i];
      if (!econ || !econ.ITEMS || econ.ITEMS[n]) name = n;
    }
    if (name && econ && econ.add) { try { econ.add(name, 1); } catch (e) {} }
    if (name && CBZ.cityGiveWeapon) { try { CBZ.cityGiveWeapon(name); } catch (e) {} }
    if (CBZ.cityAddAmmo) { try { CBZ.cityAddAmmo(60); } catch (e) {} }
    if (econ && econ.add) { try { econ.add("Body Armor", 1); } catch (e) {} }
    if (CBZ.city && CBZ.city.big) CBZ.city.big("CONFISCATED ARMS — " + (name || "the rack") + " + plates");
    else srNote("You take " + (name || "what is on the rack") + " off the rack.", 2.4);
  }

  /* THE CATEGORY CHANGE — the seal. Not a number: from here on every
     government floor in the world reads you as VIP, through occupy.js's own
     one-line grant, which the §7 tick re-applies to each complex as its
     occupancy comes up (a building 4 km away has no `_occupancy` record yet,
     so granting once here would silently cover only what happens to be live).
     That is the whole reward and it is a CATEGORY: the trespass sweep stops
     seeing you, and the men on the mayor's floor stop being a problem. */
  function srTakeSeal(v) {
    if (v.sealMesh) v.sealMesh.visible = false;
    if (CBZ.game) CBZ.game.cityGovWrit = true;
    srGrantAll();
    if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(2400);
    if (CBZ.city && CBZ.city.addRespect) { try { CBZ.city.addRespect(6); } catch (e) {} }
    if (CFG.GOV_STRONGROOM_WRIT === false) {
      if (CBZ.city && CBZ.city.big) CBZ.city.big("THE CITY SEAL");
      return;
    }
    if (CBZ.city && CBZ.city.big) CBZ.city.big("THE CITY SEAL — you sign for yourself now");
    srNote("The seal of the city, in your pocket. No government door in this state is closed to you.", 3.4);
  }
  // idempotent, one line per complex — occupy.js stores the pass on the actor,
  // never a mirror here (the parallel-bookkeeping trap).
  function srGrantAll() {
    if (!writHeld() || !CBZ.cityOccupyGrant) return 0;
    let n = 0;
    for (let i = 0; i < SITES.length; i++) {
      const s = SITES[i];
      if (!s.lot || !s.lot._occupancy) continue;
      try { if (CBZ.cityOccupyGrant(s.lot, "vip")) n++; } catch (e) {}
    }
    return n;
  }

  // the leaf's swing — the only per-frame work this block does, and only while
  // a door is actually moving.
  if (CBZ.onUpdate) {
    CBZ.onUpdate(38.75, function (dt) {
      for (let i = 0; i < SR.length; i++) {
        const v = SR[i];
        if (!v.pivot || v.swing === v.target) continue;
        const step = (dt || 0) * 1.9;
        if (Math.abs(v.target - v.swing) <= step) v.swing = v.target;
        else v.swing += Math.sign(v.target - v.swing) * step;
        v.pivot.rotation.y = v.swing;
      }
    });
  }

  function staffSite(city, site) {
    if (CFG.GOV_COMPLEX_STAFF === false) return;
    if (!CBZ.cityPostNpc && !CBZ.cityMakePed) return;
    const spec = site.def.principal;
    // A ROW MAY DECLARE NOBODY. The Freeport is a business for sale, not a
    // seat: with no principal there is no body to post, no detail to raise
    // and nothing for the tick to rebuild. Every other consumer of `spec`
    // below would throw on the null, so the row states it once and this is
    // where it is honoured.
    if (!spec) return;
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
     forest(32) farmland(33) minicities(34)
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
    SITES.length = 0; _bays.length = 0; _shells.length = 0;
    // …and the same rule for the two ledgers this wave added: a stale flight or
    // a strongroom whose building left the scene must never be measured, and a
    // spliced-out door collider from the last world must never be spliced again.
    _flights.length = 0; SR.length = 0;
    // rows this build will actually TRY to place — a flag-reverted row is not
    // one of them, so `placed === complexes` stays the honest pass condition
    // however many rows carry their own flag.
    AUDIT.complexes = 0;
    for (let i = 0; i < COMPLEXES.length; i++) {
      const d = COMPLEXES[i];
      if (!(d.flag && CFG[d.flag] === false)) AUDIT.complexes++;
    }
    AUDIT.placed = 0; AUDIT.rejected = 0;
    AUDIT.overlaps = 0; AUDIT.urbanAdjacent = 0; AUDIT.staffed = 0; AUDIT.roadless = 0;
    AUDIT.govBuildings = 0; AUDIT.govFloors = 0; AUDIT.govBare = 0;
    // how many household jobs the registry DECLARES, against how many were
    // actually posted. A residence whose staff silently failed to declare is
    // the empty-mansion bug coming back, and this is where it shows.
    AUDIT.household = 0; AUDIT.householdWanted = 0; AUDIT.householdStations = 0;
    // cityStaffVenue CLEARS this venue's posts — the same "no ghosts from the
    // last arena" contract the SITES ledger above starts from.
    if (CBZ.cityStaffVenue) CBZ.cityStaffVenue("govcomplex", { stations: 0, note: "household staff at the five residences" });
    for (let i = 0; i < COMPLEXES.length; i++) {
      const d = COMPLEXES[i];
      if (d.flag && CFG[d.flag] === false) continue;
      if (d.household) AUDIT.householdWanted += d.household.length;
    }

    const U = settledUnion(city);
    const LB = lotBounds(city);
    const belt = { minX: U.minX - BELT, maxX: U.maxX + BELT, minZ: U.minZ - BELT, maxZ: U.maxZ + BELT };

    for (let i = 0; i < COMPLEXES.length; i++) {
      const def = COMPLEXES[i];
      if (def.flag && CFG[def.flag] === false) continue;     // this row, reverted
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
        // `city` rides along so a row can ask the SAME questions §6 asks (the
        // Freeport asks which way the nearest road junction is, because that
        // is what decides which edge its gate has to be on).
        out = def.build({ root: root, rect: site.rect, cx: site.cx, cz: site.cz, site: site, city: city });
      } catch (e) { console.error("[govcomplex] build " + def.id, e); }
      _curSite = null;
      site.gate = (out && out.gate) || { x: site.cx, z: site.rect.maxZ };
      const main = (out && out.seat) || null;
      if (main) {
        site.lot = main.lot;
        // which of the shells this complex raised IS the main hall, so §5c can
        // tell it apart from the wings (the lot carries a shallow COPY of the
        // record, so an identity test needs the original).
        site.lot._rawMain = main.b;
        // the principal stands on his own threshold, facing out: visible,
        // guarded, and — the owner's word — assassinable.
        const d = main.door, n = main.n;
        site.seatPoint = { x: d.x - n.x * 4.2, z: d.z - n.z * 4.2, face: Math.atan2(-n.x, -n.z) };
      } else {
        site.seatPoint = { x: site.cx, z: site.cz + 6, face: 0 };
      }

      // ---- THE INSIDE (§5c) ----------------------------------------------
      // Before the road and before the people: the rooms are static geometry
      // and belong to the same build pass the shells did, so mode.js's one-shot
      // batch swallows them. The bodies arrive later, through power.js, and
      // land in these rooms because of the ledger dressComplex stamps.
      try { dressComplex(site); } catch (e) { console.error("[govcomplex] interiors " + def.id, e); }

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
        // keepOut is a good proxy for "what kind of job is this" and it covers
        // nine of the ten rows — but not all: a county jail is a `civ` keep-out
        // (its posted staff belong there) and is emphatically not staffed by
        // office workers. A row may therefore name its own trade.
        const wk = def.work || null;
        CBZ.registerWorkAnchor({
          biome: "city", kind: wk ? wk.kind : (def.keepOut === "hard" ? "security" : "cityhall"),
          role: wk ? wk.role : (def.keepOut === "hard" ? "security guard" : "office worker"),
          x: site.gate.x, z: site.gate.z, cap: 4,
          patrol: wk ? !!wk.patrol : def.keepOut === "hard",
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
      // §5d — THE WRIT. A pass is stored on the ACTOR by occupy.js, against a
      // building's `_occupancy` record — and a complex four kilometres away has
      // no such record until power.js seats its principal. So the grant is not a
      // one-shot at the moment you pocket the seal: it is re-asserted here as
      // each seat of power comes up, which is the only way "no government door
      // in this state is closed to you" can be a true sentence rather than a
      // stat fiction about the one building you were standing in.
      if (writHeld()) srGrantAll();
      // …and a lazy re-try on the zone, because index.html's script order is the
      // one thing this file cannot assert about itself: if city/interactions.js
      // parsed after us, the build-time registration was a no-op and the vault
      // would have no verb for the rest of the session.
      if (SR.length && !srZoned) registerStrongroomZone();
      for (let i = 0; i < SITES.length; i++) {
        const s = SITES[i];
        if (!s.rect) continue;
        if (!s.def.principal) continue;      // an unstaffed row (the Freeport)
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
    const urbanIds = [];
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
      // …and it is now TWO rows that carry the exception (City Hall and the
      // County Jail), so the count alone is no longer enough to keep it
      // visible: the ids come out with it. An `edgeOfCity` row that shows up
      // here is a row to LOOK at, not a row to forgive by category.
      if (bad) { if (s.def && s.def.edgeOfCity) { urbanAdjacent++; urbanIds.push(s.id); } else overlaps++; }
      if (!s.roads || !s.roads.length) roadless++;
      if (s.power && s.power.live) staffed++;
      else if (s.actor && !s.actor.dead) staffed++;   // declared, power.js absent
    }
    AUDIT.overlaps = overlaps;
    AUDIT.urbanAdjacent = urbanAdjacent;
    AUDIT.urbanAdjacentIds = urbanIds;
    AUDIT.roadless = roadless;
    AUDIT.staffed = staffed;
    AUDIT.placed = placed;
  }

  // the §5c counters on their own, WITHOUT recount()'s full region/lot sweep —
  // city/interior_programs.js's CBZ.interiorAudit() reads these, and an audit
  // that costs a world scan is an audit nobody calls twice.
  CBZ.govInteriorCounts = function () {
    return { buildings: AUDIT.govBuildings, floors: AUDIT.govFloors, bare: AUDIT.govBare };
  };

  CBZ.govComplexAudit = function () {
    recount();
    return {
      complexes: AUDIT.complexes,
      placed: AUDIT.placed,
      rejected: AUDIT.rejected,
      overlaps: AUDIT.overlaps,
      urbanAdjacent: AUDIT.urbanAdjacent,   // the DECLARED exception (City Hall · County Jail)
      urbanAdjacentIds: (AUDIT.urbanAdjacentIds || []).slice(),
      staffed: AUDIT.staffed,
      roadless: AUDIT.roadless,
      // §5b — the residences' cooks/drivers/gardeners. `household` must equal
      // `householdWanted` on a world where every complex found ground.
      household: AUDIT.household,
      householdWanted: AUDIT.householdWanted,
      householdPlaced: AUDIT.householdStations,   // rows belonging to complexes that found ground
      // §5c — the INSIDE. `govBare` is the ratchet: an enterable shell on a
      // seat of power with no room in it. It may only ever go DOWN, and
      // `govBuildings`/`govFloors` are printed beside it so a "fix" that stops
      // raising the wings cannot pass.
      govBuildings: AUDIT.govBuildings,
      govFloors: AUDIT.govFloors,
      govBare: AUDIT.govBare,
      /* §1 — EVERY FLIGHT OF STEPS THIS FILE LAYS, AND WHETHER IT LANDS ON
         ANYTHING. `stairsFloating` is the ratchet and is PINNED AT 0: a flight
         whose top is more than one auto-climb (physics.js STEP_UP = 0.45) away
         from the surface it declares it arrives at is the owner's "stairway
         thing that doesn't make sense what it's there for", and it is now a
         number rather than a screenshot. `stairs` prints beside it so a "fix"
         that simply stops drawing steps cannot pass. Recomputed every call. */
      stairs: _flights.length,
      stairsFloating: _flights.reduce(function (n, f) {
        return n + (Math.abs(f.top - f.landing) > STEP_UP ? 1 : 0);
      }, 0),
      /* §5d — THE LOCKED ROOM. `strongroomsDeclared` counts registry rows that
         asked for one; `strongrooms` counts the ones a shell could actually
         carry. They must be equal on a world where the complex found ground —
         a row that silently failed to build its vault is a door that never
         existed, which is the stat fiction this whole block exists to avoid. */
      strongroomsDeclared: COMPLEXES.reduce(function (n, d) {
        return n + ((d.strongroom && !(d.flag && CFG[d.flag] === false)) ? 1 : 0);
      }, 0),
      strongrooms: SR.length,
      strongroomsLocked: SR.reduce(function (n, v) { return n + (v.locked ? 1 : 0); }, 0),
      strongroomKeys: SR.reduce(function (n, v) { return n + (v.key ? 1 : 0); }, 0),
      writ: writHeld(),
      // the per-site working, so a probe can say WHICH one moved and why
      sites: SITES.map(function (s) {
        // an unstaffed row (the Freeport) declares no principal at all — read
        // through a blank rather than making every row carry a fake one.
        const pr = s.def.principal || {};
        return {
          id: s.id, name: s.def.name,
          placed: !!s.rect,
          cx: s.cx, cz: s.cz,
          hx: s.def.hx, hz: s.def.hz,
          rejected: s.rejected,
          roads: (s.roads || []).length,
          keepOut: s.def.keepOut || null,
          tier: pr.tier == null ? null : pr.tier,
          org: pr.org || null,
          role: pr.role || null,
          sid: (s.actor && s.actor._sid) || null,
          seated: !!s.seated,
        };
      }),
    };
  };
})();
