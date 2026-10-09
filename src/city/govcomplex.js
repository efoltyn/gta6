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
    lawn: 0x55693b, lawnD: 0x46583a, hedge: 0x33512f, gravel: 0x7d7767,
    dirt: 0x7f6a4c, water: 0x2f6f9e, pool: 0x3fa4c8, paint: 0xd8d8c8,
    steel: 0x5a6068, steelD: 0x3c4046, fence: 0x9aa0a6, fenceP: 0x6a7077,
    dark: 0x202327, warn: 0xd4a017, red: 0xb43a32, glassSteel: 0x39444f,
    brick: 0x8d5b46, adobe: 0xd8c39c, tileRoof: 0x9c4f3a, timber: 0x6b4a2a,
    flagRed: 0xc0392b,
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
  // GROUND is decoded (CBZ.groundLinear): the lawns, forecourts, aprons and
  // pools every complex lays flat are seen from the air beside the continent
  // plate, which reads its colours as real reflectance. Taken as linear a
  // 0x4f7445 lawn reflected 45% (pale lime) and a 0x9a9a94 forecourt 32%
  // (chalk). One shared material per colour, so core/batch.js still merges.
  const GMAT = {};
  function gm(hex) {
    if (!CBZ.groundLinear) return cm(hex);
    if (GMAT[hex]) return GMAT[hex];
    // a GREEN pad is a lawn: it wears the one ground skin (the turf), not a
    // flat colour (City Hall's and the Capitol's lawns were one flat green)
    const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
    if (CBZ.groundSkin && g > r * 1.1 && g > b * 1.2) {
      GMAT[hex] = CBZ.groundSkin({ name: "gov-lawn", srgb: true, far: 300, sandY: [-9, -8], wear: 0.15, extra: { vertexColors: false, color: hex } });
      return GMAT[hex];
    }
    return (GMAT[hex] = new THREE.MeshLambertMaterial({ color: CBZ.groundLinear(hex) }));
  }
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
    const m = new THREE.Mesh(g, gm(hex));
    m.position.set(x, y == null ? 0.05 : y, z);
    m.receiveShadow = true; m.castShadow = false;
    m.matrixAutoUpdate = false; m.updateMatrix();
    root.add(m);
    return m;
  }
  function disc(root, x, z, r, hex, y, seg) {
    const g = new THREE.CircleGeometry(r, seg || 24);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, gm(hex));
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

  // PARTERRE HEDGES. A clipped 1.4-1.6 m box hedge is a wall of wood you
  // walk AROUND — the parterre's paths are the 0.8 m gaps and the 9 m aisles
  // between rows, which is the whole point of a parterre. These were the
  // solidityAudit's undecided "gov:hedge" row (99 of them, 0 colliders); the
  // decision is SOLID, noCam (a camera may look through foliage), measured
  // per instance off the drawn InstancedMesh by systems/meshcollider.js so
  // the box can never drift from the hedge. Park hedges stay brushable
  // decoys — those line public walks where a chase must not snag.
  function hedges(root, geo, pts, yFn) {
    const im = repeat(root, geo, M.hedge, pts, yFn);
    if (im && CBZ.solidFromMesh) CBZ.solidFromMesh(im, { noCam: true, ref: null, tag: "gov-hedge" });
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
  // `surf` (optional): an estate surface kind (§1b) — the pad then wears
  // that textured material with its UVs in world metres, so the lawn's grain
  // runs continuously under every path and bed laid on it.
  function pad(root, rect, hex, name, surf) {
    const w = rect.maxX - rect.minX, d = rect.maxZ - rect.minZ;
    const g = new THREE.PlaneGeometry(w, d, surf ? 8 : 1, surf ? 8 : 1);
    g.rotateX(-Math.PI / 2);
    if (surf && SURF[surf] && SURF[surf].tile) {
      const P = g.attributes.position, U = g.attributes.uv, t = SURF[surf].tile;
      const ox = (rect.minX + rect.maxX) / 2, oz = (rect.minZ + rect.maxZ) / 2;
      for (let i = 0; i < P.count; i++) U.setXY(i, (P.getX(i) + ox) / t, -(P.getZ(i) + oz) / t);
    }
    // a plain pad is GROUND: its display hex decoded to real reflectance
    // (CBZ.groundLinear), as the plate round it is. Taken as linear, a 0x9a9a92
    // forecourt reflected 32% and read chalk white from the air.
    const m = new THREE.Mesh(g, surf ? estateMat(surf) : gm(hex));
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
      if (gw > 0 && o.leaves !== false) gateLeaves(root, rect, gs, gw, 0.08, h, cx, cz);
      return;
    }
    for (const e of edges) {
      const horiz = e[4] < 2;
      const gapC = horiz ? cx : cz;
      wallRun(root, e[0], e[1], e[2], e[3], h, thick, hex, gapC, e[4] === gs ? gw : 0);
    }
    if (gw > 0 && o.leaves !== false) gateLeaves(root, rect, gs, gw, thick, h, cx, cz);
  }
  // THE GATE THAT WAS NEVER HUNG. Every walled complex left a 16-24 m hole
  // in its perimeter with nothing that could ever close it: the solidity
  // audit's "gov:perimeter-GATE-opening" row, which it rightly called a
  // missing OBJECT, not a missing collider. Sealing the hole would be wrong —
  // it is the complex's only road in, and the gatehouse arms stand raised
  // because the compound is MANNED, not locked. So the object is hung the way
  // a real wide compound gate is: two steel SLIDING leaves on a ground track,
  // parked OPEN behind the wall on its inner face, clear of the opening.
  // Each leaf is solid, its collider measured off the drawn rails, stiles and
  // bars (systems/meshcollider.js), so it is exactly the steel you see.
  // `o.leaves:false` for a site that builds its own working barrier (the
  // Executive Mansion's checkpoint, whose planter return sits where a leaf
  // would park).
  function gateLeaves(root, rect, side, gw, thick, h, cx, cz) {
    const horiz = side < 2;
    const line = side === 0 ? rect.minZ : side === 1 ? rect.maxZ : side === 2 ? rect.minX : rect.maxX;
    const inward = (side === 0 || side === 2) ? 1 : -1;
    const n = line + inward * (thick / 2 + 0.3);     // 0.3 m off the inner face
    const gapC = horiz ? cx : cz;
    const H = Math.max(1.6, Math.min(h - 0.2, 2.6)), L = gw / 2;
    for (const s of [-1, 1]) {
      const c = gapC + s * (gw / 2 + L / 2);          // parked behind its own wall run
      const g = new THREE.Group();
      g.name = "gov-gate-leaf";
      root.add(g);
      const at = function (t, y, lenT, hh, dN, hex) {
        return box(g, horiz ? t : n, y, horiz ? n : t, horiz ? lenT : dN, hh, horiz ? dN : lenT, hex);
      };
      at(c, 0.1, L, 0.12, 0.1, M.steelD);                              // bottom rail on the track
      at(c, H - 0.05, L, 0.1, 0.08, M.steelD);                         // top rail
      at(c, H * 0.55, L, 0.06, 0.06, M.steelD);                        // mid rail
      at(c - L / 2 + 0.05, H / 2 + 0.02, 0.1, H - 0.04, 0.1, M.steelD); // end stiles
      at(c + L / 2 - 0.05, H / 2 + 0.02, 0.1, H - 0.04, 0.1, M.steelD);
      const bars = [], nb = Math.max(2, Math.round(L / 0.16));
      for (let i = 1; i < nb; i++) {
        const t = c - L / 2 + i * L / nb;
        bars.push(horiz ? { x: t, z: n } : { x: n, z: t });
      }
      repeat(g, bg(0.035, H - 0.2, 0.035), M.steel, bars, function () { return H / 2 + 0.02; });
      if (CBZ.solidFromMesh) CBZ.solidFromMesh(g, { merge: true, ref: null, tag: "gov-gate-leaf" });
      else col(horiz ? c : n, horiz ? n : c, horiz ? L : 0.12, horiz ? 0.12 : L, 0, H);
    }
  }
  // collision thickness of a chain-link run — the same 0.32 the venue site kit
  // uses, declared once so the two cannot drift apart
  const FENCE_COL_T = 0.32;
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
      // COLLIDE THE FENCE, NOT A SLAB OF AIR AROUND IT. The band drawn two
      // lines up is 0.08 m thick; this registered 0.5, so every compound
      // perimeter in the game — the Freeport's bonded yard most visibly —
      // held you 0.21 m off a chain-link you could see straight through, on
      // both faces. 0.32 is the venue kit's own chain-link figure (a 0.16
      // half-thickness, speedway_structures.js's fence()), which is thick
      // enough that nothing steps across it in one 0.35 m collision slice and
      // honest about where the metal is.
      col(x, z, horiz ? w : FENCE_COL_T, horiz ? FENCE_COL_T : d, 0, h);
    }
  }

  // GATEHOUSE. A walk-in booth (lodge(), below) and two boom arms parked
  // RAISED — the compound is MANNED, not sealed.
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
  // `o.noArms`: a site that builds its OWN working barrier (the Executive
  // Mansion's checkpoint, §2b) keeps the booth and drops the two parked arms
  // and their pivots, so there is one barrier at the gate and it moves.
  function gatehouse(root, x, z, laneAlongZ, hex, o) {
    // `o.booth`: how far off the lane centre the booth stands (8 m on the
    // wide state gates; a narrower gate keeps it inside its own opening)
    const off = (o && o.booth != null) ? o.booth : 8;
    const bx = laneAlongZ ? x - off : x, bz = laneAlongZ ? z : z - off;
    // the booth watches the lane: its big window faces it, its door is on
    // the far side, away from the traffic
    // a walk-in booth: its walls, desk and chair carry their own colliders
    lodge(root, bx, bz, 3.4, 3.2, 3.0, hex, laneAlongZ ? { x: 1, z: 0 } : { x: 0, z: 1 });
    if (o && o.noArms) return;
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

  /* A LODGE YOU WALK INTO — the gatehouse booth and the estate's sentry
     posts. It was a solid 3.4 m cube with a glowing slab stuck to each face
     and one collider over the lot: a guard post nobody could stand in.

     Now it is a small masonry building: a floor slab one short step over
     the ground (its top, FT, is registered as the walk surface), 0.22 m
     walls on a plinth course, glazed windows on the three faces a guard
     watches from (sill at desk height, stone surround, sill slab), a doorway
     on the fourth with its leaf parked open against the wall, a cornice and
     a flat roof slab whose top stays at h + 0.26 (president_regime.js stands
     its searchlights there). Inside: a desk under the lane window with a
     monitor and keyboard, a swivel chair, a ceiling light. `face` is the
     OUTWARD unit normal of the watching side; the door is opposite it.
     The walls collide except at the doorway; the desk and chair collide.
     One Kit per lodge: its walls (painted ashlar where the lodge is stone),
     trim, glass and lamps are a handful of draws. */
  const LODGE_FT = 0.15;
  function lodge(root, x, z, w, d, h, hex, face) {
    const n = face || { x: 0, z: 1 };
    const T = 0.22, FT = LODGE_FT, top = h - 0.1;
    const kit = new Kit();
    const wallK = (hex === M.stone || hex === M.stoneD || hex === M.marble) ? "ashlar" : hex;
    const TRIM = M.stoneD, DARK = M.stoneDk;
    // the slab and the walk surface on it (the doorway's threshold included)
    kit.box(0x8d8a82, x, FT / 2, z, w - 0.04, FT, d - 0.04);
    plat(x, z, w - 2 * T + 0.02, d - 2 * T + 0.02, FT);
    // the plinth course the walls stand on, proud of them
    for (const s of [-1, 1]) {
      kit.box(DARK, x, 0.18, z + s * (d / 2 + 0.025), w + 0.1, 0.36, 0.05);
      kit.box(DARK, x + s * (w / 2 + 0.025), 0.18, z, 0.05, 0.36, d);
    }
    // faces: the watched one, its two neighbours, and the door face behind
    const back = { x: -n.x, z: -n.z };
    const faces = [n, { x: -n.z, z: n.x }, { x: n.z, z: -n.x }, back];
    const sill = FT + 0.9, head = Math.min(top - 0.35, FT + 2.2);
    for (let i = 0; i < 4; i++) {
      const f = faces[i], alongX = Math.abs(f.z) > 0.5;
      const spanW = alongX ? w : d - 2 * T;
      const opens = [];
      if (i < 3) {
        const ww = Math.min(spanW - 0.7, i === 0 ? 2.2 : 1.1);
        if (ww > 0.5) opens.push({ t: 0, w: ww, y0: sill, y1: head });
      } else {
        opens.push({ t: 0, w: 0.96, y0: 0, y1: FT + 2.12, door: true });
        // the threshold under the doorway walks at the slab top too
        const tq = alongX ? { x: x, z: z + f.z * (d / 2 - T / 2) } : { x: x + f.x * (w / 2 - T / 2), z: z };
        plat(tq.x, tq.z, alongX ? 0.96 : T + 0.04, alongX ? T + 0.04 : 0.96, FT);
      }
      const W = wallFace(kit, wallK, x, z, f, w, d, T, 0, top, opens, true);
      const po = W.off + T / 2;                         // the outer plane
      const at = function (t, nOff) { return alongX ? { x: x + t, z: z + f.z * (po + nOff) } : { x: x + f.x * (po + nOff), z: z + t }; };
      const bx = function (key, t, y, nOff, len, hh, dep) {
        const q = at(t, nOff);
        kit.box(key, q.x, y, q.z, alongX ? len : dep, hh, alongX ? dep : len);
      };
      for (const o of opens) {
        if (o.door) {
          // the surround, and the leaf swung right round onto the wall
          bx(TRIM, -o.w / 2 - 0.07, (o.y1 + 0.1) / 2, 0.03, 0.14, o.y1 + 0.1, 0.06);
          bx(TRIM, o.w / 2 + 0.07, (o.y1 + 0.1) / 2, 0.03, 0.14, o.y1 + 0.1, 0.06);
          bx(TRIM, 0, o.y1 + 0.1, 0.04, o.w + 0.42, 0.2, 0.08);
          if (spanW / 2 - (o.w / 2 + 0.14) >= 0.9) {
            bx(0x3a2c22, o.w / 2 + 0.14 + 0.44, FT + 1.03, 0.035, 0.86, 2.02, 0.045);
            bx(0xb99347, o.w / 2 + 0.14 + 0.1, FT + 1.0, 0.07, 0.04, 0.16, 0.03);
          } else {
            // no wall to fold it back on: it stands open square to the face
            const q = at(o.w / 2 - 0.03, 0.45);
            kit.box(0x3a2c22, q.x, FT + 1.03, q.z, alongX ? 0.045 : 0.86, 2.02, alongX ? 0.86 : 0.045);
          }
          continue;
        }
        // glass mid-wall; a stone surround proud of the face; the sill slab
        // one pane mesh per face: a flat sheet of glass, never a box of air
        const q = at(o.t, -T / 2);
        kit.box("glass" + i, q.x, (o.y0 + o.y1) / 2, q.z, alongX ? o.w : 0.03, o.y1 - o.y0, alongX ? 0.03 : o.w);
        bx(TRIM, 0, o.y1 + 0.07, 0.025, o.w + 0.3, 0.14, 0.05);
        bx(TRIM, -o.w / 2 - 0.08, (o.y0 + o.y1) / 2, 0.025, 0.16, o.y1 - o.y0, 0.05);
        bx(TRIM, o.w / 2 + 0.08, (o.y0 + o.y1) / 2, 0.025, 0.16, o.y1 - o.y0, 0.05);
        bx(M.stone, 0, o.y0 - 0.05, 0.08, o.w + 0.42, 0.1, 0.16);
        // a mullion on the wide lane window
        if (o.w > 1.6) { const m = at(o.t, -T / 2 + 0.03); kit.box(0x2a2d30, m.x, (o.y0 + o.y1) / 2, m.z, alongX ? 0.05 : 0.04, o.y1 - o.y0, alongX ? 0.04 : 0.05); }
      }
    }
    // cornice and roof slab (top at h + 0.26)
    kit.box(TRIM, x, top - 0.12, z, w + 0.36, 0.2, d + 0.36);
    kit.box(M.stone, x, h + 0.08, z, w + 0.18, 0.36, d + 0.18);
    // ---- inside: the desk under the watched window, facing out
    const inW = (Math.abs(n.z) > 0.5 ? w : d) - 2 * T;
    const DW = Math.min(1.4, inW - 0.2), DD = 0.58, DT = FT + 0.76;
    const wallIn = (Math.abs(n.z) > 0.5 ? d : w) / 2 - T;     // inner face distance, along n
    const L = function (a, b) { return { x: x + n.x * a + (-n.z) * b, z: z + n.z * a + n.x * b }; };   // a along n, b across
    const lb = function (key, a, b, y, la, hh, lb2) {        // la along n, lb2 across
      const q = L(a, b);
      kit.box(key, q.x, y, q.z, Math.abs(n.x) > 0.5 ? la : lb2, hh, Math.abs(n.x) > 0.5 ? lb2 : la);
    };
    const dA = wallIn - DD / 2 - 0.02;                      // desk centre, along n
    const WOOD = 0x5b4633, STEEL = 0x2b2f34;
    lb(WOOD, dA, 0, DT - 0.02, DD, 0.04, DW);                                     // top
    for (const s of [-1, 1]) lb(WOOD, dA, s * (DW / 2 - 0.02), FT + (DT - 0.04 - FT) / 2, DD - 0.04, DT - 0.04 - FT, 0.04);   // end panels
    lb(WOOD, dA + DD / 2 - 0.06, 0, FT + 0.2 + (DT - 0.24 - FT) / 2, 0.03, DT - 0.24 - FT, DW - 0.1);                      // modesty panel
    { const q = L(dA, 0), nx = Math.abs(n.x) > 0.5; col(q.x, q.z, nx ? DD : DW, nx ? DW : DD, FT, DT); }
    // the monitor: foot, neck, body, a lit face turned to the chair; keyboard
    lb(STEEL, dA + 0.08, 0, DT + 0.008, 0.16, 0.016, 0.22);
    lb(STEEL, dA + 0.1, 0, DT + 0.016 + 0.13, 0.04, 0.26, 0.05);
    lb(0x16181b, dA + 0.07, 0, DT + 0.3, 0.04, 0.34, 0.56);
    lb("lit:" + 0x6fa8d8 + ":0.55", dA + 0.048, 0, DT + 0.3, 0.004, 0.29, 0.5);
    lb(0x202326, dA - 0.14, 0, DT + 0.012, 0.15, 0.02, 0.44);
    // the chair: a five-star foot, a column, a seat at 0.45, a back
    const cA = dA - DD / 2 - 0.34;
    if (cA - 0.26 > -wallIn + 0.05) {
      lb(STEEL, cA, 0, FT + 0.025, 0.56, 0.05, 0.07);
      lb(STEEL, cA, 0, FT + 0.025, 0.07, 0.05, 0.56);
      lb(STEEL, cA, 0, FT + 0.05 + (0.4 - 0.05) / 2, 0.06, 0.35, 0.06);
      lb(0x23262b, cA, 0, FT + 0.45 - 0.04, 0.46, 0.08, 0.46);
      lb(STEEL, cA - 0.22, 0, FT + 0.5, 0.04, 0.16, 0.05);
      lb(0x23262b, cA - 0.24, 0, FT + 0.8, 0.05, 0.46, 0.44);
      const q = L(cA - 0.02, 0);
      col(q.x, q.z, 0.56, 0.56, FT, FT + 1.03);
    }
    // a steel locker in the back corner beside the door (the post's radio,
    // its logbook, the long gun), and the ceiling light
    {
      const inA = (Math.abs(n.z) > 0.5 ? w : d) / 2 - T;      // inner half-width across n
      const la = -wallIn + 0.25, lbq = inA - 0.28;
      if (lbq - 0.25 > 0.62 && la + 0.25 < cA - 0.3) {
        lb(0x4a5058, la, lbq, FT + 0.925, 0.46, 1.85, 0.5);
        lb(0x3a3f45, la + 0.235, lbq, FT + 0.925, 0.012, 1.7, 0.012);       // the door seam
        lb(0xb9bec6, la + 0.24, lbq - 0.12, FT + 1.05, 0.02, 0.16, 0.03);    // the handle
        const q = L(la, lbq), nx = Math.abs(n.x) > 0.5;
        col(q.x, q.z, nx ? 0.46 : 0.5, nx ? 0.5 : 0.46, FT, FT + 1.85);
      }
    }
    kit.box("lit:" + 0xfff1d6 + ":0.9", x, top - 0.02, z, 0.5, 0.04, 0.5);
    kit.flush(root, "lodge");
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
  // `base` (optional): the height of the ground the flight lands ON (a
  // forecourt of setts at 0.10, not the bare grade), so the bottom tread is
  // one riser over what you walk off, never a slab flush with the paving
  function steps(root, x, z, w, depth, top, hex, dir, axis, landing, base) {
    base = base > 0 ? base : 0;
    if (!(top - base > 0.02) || !(depth > 0.2) || !(w > 0.2)) return 0;
    /* THE RISER COUNT IS SOLVED FROM BOTH DIMENSIONS, never typed. The rise
       may not exceed RISE_MAX (that is what makes every tread auto-climbable),
       and the GOING may not be so deep that a "flight" reads as one kerb — a
       0.42 m going is the shallow end of real stair practice, and the cap of
       four extra treads stops a 12 m ceremonial band from becoming thirty. */
    const n = base > 0
      ? Math.max(1, Math.round((top - base) / 0.1))
      : Math.max(1, Math.ceil(top / RISE_MAX - 1e-6), Math.min(4, Math.round(depth / 0.42)));
    const rise = (top - base) / n;
    const tread = depth / n;
    const flank = top >= STEP_UP;
    for (let i = 0; i < n; i++) {
      const back = dir * (depth / 2 - tread * (i + 0.5));   // outer lip -> facade
      const cxs = axis === "x" ? x + back : x;
      const czs = axis === "x" ? z : z + back;
      const sw = axis === "x" ? tread : w, sd = axis === "x" ? w : tread;
      const y = base + rise * (i + 1);
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
  // `o.base`: the paving the flight lands on (steps(), above). `o.deck(rect,
  // top)`: the host lays the deck TOP itself (an estate's York-stone sheet),
  // so the stone mass stops 1 cm under it and the two never share a plane.
  function perron(root, fx, fz, w, depth, hex, dir, axis, o) {
    o = o || {};
    depth = Math.max(PERRON_FLIGHT + 0.8, depth);
    const deckD = depth - PERRON_FLIGHT;
    const dcx = axis === "x" ? fx + dir * deckD / 2 : fx;
    const dcz = axis === "x" ? fz : fz + dir * deckD / 2;
    const dw = axis === "x" ? deckD : w, dd = axis === "x" ? w : deckD;
    const mass = o.deck ? PERRON_TOP - 0.01 : PERRON_TOP;
    box(root, dcx, mass / 2, dcz, dw, mass, dd, hex, { cast: false });
    plat(dcx, dcz, dw, dd, PERRON_TOP);
    if (o.deck) o.deck({ minX: dcx - dw / 2, maxX: dcx + dw / 2, minZ: dcz - dd / 2, maxZ: dcz + dd / 2 }, PERRON_TOP);
    const scx = axis === "x" ? fx + dir * (deckD + PERRON_FLIGHT / 2) : fx;
    const scz = axis === "x" ? fz : fz + dir * (deckD + PERRON_FLIGHT / 2);
    steps(root, scx, scz, w - 1.4, PERRON_FLIGHT, PERRON_TOP, hex, dir, axis, PERRON_TOP, o.base);
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
  /* THE LOT WAS COMPACT-CAR SIZED AND IT DID NOT KNOW WHERE ITS OWN STALLS
     WERE (2026-08-15). Two separate faults, and they compounded:

     1. THE DIMENSIONS. STALL 2.6 x ROWD 15.0 are compact-car numbers with a
        5 m aisle. ULI (Dimensions of Parking) puts a standard 90-degree stall
        at 2.74 x 5.49 m on a 7.32 m two-way aisle, so a double-loaded module
        is 18.30 m deep, not 15. The old lot therefore painted stalls that a
        pickup overhangs, down aisles a pickup cannot turn out of, and claimed
        more capacity than the tarmac it drew could hold. island_speedway.js
        had already been through exactly this and solved it to those three
        numbers; this is the second consumer of the same solve, not a second
        opinion about it.

     2. THE BAY RECORD. `_bays` filed an x RANGE and a list of row z's, so §8
        parked cars at a CONTINUOUS random x — cars landing half a metre apart,
        straddling their own painted stripes, in a lot whose whole visual point
        is the grid. It now files the actual STALL CENTRES the stripes were
        drawn from, so a parked car stands in a bay by construction.

     `d` is the lot's declared depth; the module count is floored out of it and
     the surplus becomes the perimeter drive aisle, which is what gives the lot
     a way in from the road rather than cars materialising inside the grid. */
  const P_STALL_W = 2.74, P_STALL_D = 5.49, P_AISLE = 7.32;
  const P_MODULE = P_STALL_D * 2 + P_AISLE;             // 18.30 m, double-loaded
  function parkingSea(root, cx, cz, w, d, hex) {
    slab(root, cx, cz, w, d, M.asphalt, YG);
    // THE PERIMETER DRIVE. A sea of stalls with no lane around it is a sea
    // you can only enter by driving over the painted rows. 6 m off each edge
    // (a one-way lane plus a door's clearance) is taken out of the depth
    // before any module is laid, and the modules are centred in what is left.
    const RIM = Math.min(6, Math.max(0, (d - P_MODULE) / 2));
    const usable = d - RIM * 2;
    const rows = Math.max(1, Math.floor(usable / P_MODULE));
    const grid = rows * P_MODULE;
    const nStall = Math.max(1, Math.floor((w - 4) / P_STALL_W));
    const gx0 = cx - (nStall * P_STALL_W) / 2;
    const stripes = [], slots = [];
    for (let r = 0; r < rows; r++) {
      const z0 = cz - grid / 2 + P_MODULE * (r + 0.5);    // module centreline
      const bayZ = [z0 - P_AISLE / 2 - P_STALL_D / 2, z0 + P_AISLE / 2 + P_STALL_D / 2];
      for (let i = 0; i <= nStall; i++) {
        const x0 = gx0 + i * P_STALL_W;
        stripes.push({ x: x0, z: bayZ[0] });
        stripes.push({ x: x0, z: bayZ[1] });
        // the stall BETWEEN this stripe and the next one along
        if (i < nStall) for (let k = 0; k < 2; k++) slots.push({ x: x0 + P_STALL_W / 2, z: bayZ[k] });
      }
    }
    // kerbed planting islands down the middle of each row — the thing that
    // stops a car park reading as one flat rectangle of tarmac. Laid BEFORE
    // the stripes so the paint is the topmost rung. They sit in the AISLE
    // centreline, which is where a real lot's island is; the old ones sat on
    // top of the stall rows the cars were meant to be parked in.
    for (let r = 0; r < rows; r++) {
      const z0 = cz - grid / 2 + P_MODULE * (r + 0.5);
      slab(root, cx, z0, nStall * P_STALL_W, 1.2, M.lawnD, YS);
    }
    repeat(root, bg(0.16, 0.02, P_STALL_D), hex || M.paint, stripes, function () { return YM; });
    if (_curSite) _bays.push({ site: _curSite, slots: slots, stalls: slots.length });
  }

  // WATCHTOWER — legs, a deck you can actually stand on, a roof, and a caged
  // ladder up the face toward the estate (world/ladderkit.js draws it,
  // systems/climb.js climbs it). The deck was a platform nobody could reach
  // (props.js's solidity ledger listed it: "deck is unreachable (no ladder)
  // AND unfenced, fix the ladder first") on top of a solid 3.6 m column. Now
  // the legs are the columns, and the waist-high rail is a collider with a
  // gap where the ladder comes over. `inX`: the estate's centre x.
  function watchtower(root, x, z, hex, inX) {
    const DECK = 6.25, HW = 2.2;
    const s = (inX == null ? x + 1 : inX) >= x ? 1 : -1;       // the ladder face, +x or -x
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      box(root, x + sx * 1.6, 3.0, z + sz * 1.6, 0.3, 6.0, 0.3, M.timber);
      col(x + sx * 1.6, z + sz * 1.6, 0.34, 0.34, 0, 6.0);
    }
    box(root, x, 6.1, z, 4.4, 0.3, 4.4, hex || M.timber);
    for (const f of [[0, -1], [0, 1], [-s, 0]]) {
      box(root, x + f[0] * 2.1, 6.7, z + f[1] * 2.1, f[0] ? 0.2 : 4.4, 0.9, f[1] ? 0.2 : 4.4, hex || M.timber, { cast: false });
    }
    // the ladder face: two lengths of parapet either side of the gap
    for (const sz of [-1, 1]) box(root, x + s * 2.1, 6.7, z + sz * 1.31, 0.2, 0.9, 1.78, hex || M.timber, { cast: false });
    box(root, x, 8.5, z, 5.0, 0.24, 5.0, M.steelD);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(root, x + sx * 2.0, 7.6, z + sz * 2.0, 0.16, 1.6, 0.16, M.steelD);
    if (CBZ.ladderKit) {
      CBZ.ladderKit.deck({
        minX: x - HW, maxX: x + HW, minZ: z - HW, maxZ: z + HW, top: DECK, rail: 1.0,
        gaps: [{ x: x + s * HW, z: z, w: 0.42 }],
      });
      CBZ.ladderKit.build(root, {
        x: x + s * (HW + 0.05), z: z, nx: s, nz: 0, y0: 0, y1: DECK,
        name: "watchtower", tag: "gov:watchtower", mode: "city",
      }, cm(M.steelD));
    } else {
      plat(x, z, 4.4, 4.4, DECK);
    }
  }

  /* A FLAG ON A POLE: a stepped stone base under city/flags.js's pole (the
     one flag system: tapered pole, truck, finial, halyard, cleat, and the
     nation's own flag in cloth, instanced per complex). */
  function flagpole(root, x, z, h) {
    box(root, x, 0.2, z, 1.2, 0.4, 1.2, M.stoneD);
    box(root, x, 0.55, z, 0.8, 0.3, 0.8, M.stone);
    if (CBZ.flags) CBZ.flags.pole(root, { x: x, y: 0.7, z: z, height: h - 0.7, finial: h >= 16 ? "eagle" : "ball" });
    col(x, z, 1.2, 1.2, 0, 0.7);
    col(x, z, 0.3, 0.3, 0.7, h);          // the pole stands ON its base
  }

  // Concatenate geometries (indexed or not) into one non-indexed geometry with
  // position/normal/uv, so a multi-part fixture is ONE instanced draw.
  function mergeGeos(list) {
    const pos = [], nor = [], uv = [];
    for (let k = 0; k < list.length; k++) {
      let g = list[k];
      if (!g) continue;
      if (g.index) g = g.toNonIndexed();
      if (!g.attributes.normal) g.computeVertexNormals();
      const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
      for (let i = 0; i < p.count; i++) {
        pos.push(p.getX(i), p.getY(i), p.getZ(i));
        nor.push(n.getX(i), n.getY(i), n.getZ(i));
        uv.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
      }
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    out.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    out.computeBoundingSphere(); out.computeBoundingBox();
    return out;
  }
  function lathe(profile, seg) {
    const pts = profile.map(function (p) { return new THREE.Vector2(p[0], p[1]); });
    const g = new THREE.LatheGeometry(pts, seg || 16);
    g.computeVertexNormals();
    return g;
  }

  /* A LANTERN STANDARD — the lamp that lines a ceremonial drive. It was a
     6 m square stick with a flat box on top. Now: a moulded cast base, a
     tapered fluted-read post, a collar, a hexagonal lantern that is the only
     lit part, and its cap. Iron is ONE instanced draw for every standard in
     the world; the glass is a second. */
  let _lampG = null;
  function lampGeos() {
    if (_lampG) return _lampG;
    const iron = mergeGeos([
      lathe([[0, 0], [0.26, 0], [0.26, 0.12], [0.2, 0.2], [0.17, 0.62], [0.12, 0.7], [0, 0.7]], 12),
      (function () { const g = new THREE.CylinderGeometry(0.06, 0.095, 3.5, 10); g.translate(0, 0.7 + 1.75, 0); return g; })(),
      lathe([[0, 4.18], [0.1, 4.18], [0.15, 4.28], [0.15, 4.34], [0, 4.34]], 10),
      (function () { const g = new THREE.CylinderGeometry(0.02, 0.23, 0.3, 6); g.translate(0, 4.99, 0); return g; })(),
      (function () { const g = new THREE.SphereGeometry(0.05, 8, 6); g.translate(0, 5.18, 0); return g; })(),
    ]);
    const glass = (function () { const g = new THREE.CylinderGeometry(0.2, 0.15, 0.5, 6); g.translate(0, 4.59, 0); return g; })();
    return (_lampG = { iron: iron, glass: glass, top: 5.23 });
  }
  function lampRow(root, pts) {
    if (!pts.length) return;
    const G = lampGeos();
    repeat(root, G.iron, 0x24282c, pts, function () { return 0; });
    repeat(root, G.glass, M.lampHead, pts, function () { return 0; }, null, { emissive: M.lampHead, ei: 0.85 });
    // SOLID. Every OTHER standing object this kit makes — the flagpole, the
    // watchtower legs, the comms tower, the floodlight masts — takes a col();
    // the lamp standards lining the ceremonial approaches never did, so the
    // avenue you drove up was the one thing on the estate you could drive
    // through. city/towngen.js already collides its own town lamp posts.
    for (let i = 0; i < pts.length; i++) col(pts[i].x, pts[i].z, 0.52, 0.52, 0, 4.4);
  }

  /* ====================================================================
     PAINTED SURFACES — the ground an estate is built from. The world texture
     library (world/textures_surface.js) ships grass and asphalt; granite
     setts, York-stone flags, gravel, a planted bed and a helipad deck it does
     not, so they are painted here ONCE per session into canvases (colour +
     a height field turned into a normal map), deterministic, no Math.random.
     Headless (no document) every painter returns null and the surface falls
     back to its flat shared colour, so node checks and tier 0 still build.
     ==================================================================== */
  function hsh(i, salt) {
    const s = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
    return s - Math.floor(s);
  }
  function mkCanvas(n) {
    if (typeof document === "undefined" || !document.createElement) return null;
    try { const c = document.createElement("canvas"); c.width = n; c.height = n; return c.getContext ? c : null; } catch (e) { return null; }
  }
  function heightToNormal(hc, strength) {
    const n = hc.width, src = hc.getContext("2d").getImageData(0, 0, n, n).data;
    const out = mkCanvas(n); if (!out) return null;
    const ctx = out.getContext("2d"), img = ctx.createImageData(n, n), d = img.data;
    const H = function (x, y) { x = (x + n) % n; y = (y + n) % n; return src[(y * n + x) * 4] / 255; };
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * n + x) * 4;
      d[i] = (-dx / l * 0.5 + 0.5) * 255; d[i + 1] = (dy / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return out;
  }
  function rgb(r, g, b) { return "rgb(" + (r | 0) + "," + (g | 0) + "," + (b | 0) + ")"; }
  // each painter fills a colour canvas `c` and a height canvas `h` (white =
  // proud) of the same size; both must tile seamlessly.
  const PAINT = {
    // granite setts, 100 x 200 mm in stretcher bond: 32 courses x 16 per
    // course over a 3.2 m tile
    sett: function (c, h, N) {
      c.fillStyle = "#4a4843"; c.fillRect(0, 0, N, N);
      h.fillStyle = "#1a1a1a"; h.fillRect(0, 0, N, N);
      const rows = 32, per = 16, rh = N / rows, sw = N / per, j = 1.6;
      let k = 0;
      for (let r = 0; r < rows; r++) {
        const off = (r % 2) ? sw / 2 : 0;
        for (let i = -1; i < per; i++) {
          const x = i * sw + off, y = r * rh, t = hsh(k++, 3);
          const g = 118 + t * 46 + (hsh(k, 5) - 0.5) * 14;
          c.fillStyle = rgb(g, g * 0.98, g * 0.94);
          c.fillRect(x + j, y + j, sw - 2 * j, rh - 2 * j);
          // a lighter face with a darker arris reads as a dressed stone
          c.fillStyle = "rgba(255,255,255," + (0.04 + t * 0.05).toFixed(3) + ")";
          c.fillRect(x + j + 2, y + j + 2, sw - 2 * j - 4, rh - 2 * j - 4);
          h.fillStyle = rgb(170 + t * 50, 170 + t * 50, 170 + t * 50);
          h.fillRect(x + j, y + j, sw - 2 * j, rh - 2 * j);
          h.fillStyle = "rgb(240,240,240)";
          h.fillRect(x + j + 3, y + j + 3, sw - 2 * j - 6, rh - 2 * j - 6);
        }
      }
    },
    // York-stone flags: four 0.8 m courses of random-length slabs
    flag: function (c, h, N) {
      c.fillStyle = "#6a6358"; c.fillRect(0, 0, N, N);
      h.fillStyle = "#202020"; h.fillRect(0, 0, N, N);
      const rows = 4, rh = N / rows, lens = [[0.3, 0.45, 0.25], [0.2, 0.35, 0.45], [0.4, 0.3, 0.3], [0.25, 0.25, 0.5]];
      let k = 0;
      for (let r = 0; r < rows; r++) {
        let x = hsh(r, 11) * N;
        const L = lens[r];
        for (let i = 0; i < L.length; i++) {
          const w = L[i] * N, t = hsh(k++, 7);
          const base = [196 + t * 22, 186 + t * 18, 166 + t * 14];
          for (const ox of [0, -N]) {
            c.fillStyle = rgb(base[0], base[1], base[2]);
            c.fillRect(x + ox + 2, r * rh + 2, w - 4, rh - 4);
            h.fillStyle = rgb(200 + t * 40, 200 + t * 40, 200 + t * 40);
            h.fillRect(x + ox + 2, r * rh + 2, w - 4, rh - 4);
          }
          x += w; if (x >= N) x -= N;
        }
      }
      // weathering: faint mottles, deterministic
      for (let i = 0; i < 900; i++) {
        const px = hsh(i, 21) * N, py = hsh(i, 22) * N, r = 2 + hsh(i, 23) * 6;
        c.fillStyle = hsh(i, 24) < 0.5 ? "rgba(60,55,45,0.06)" : "rgba(255,250,235,0.06)";
        c.fillRect(px, py, r, r);
      }
    },
    // raked gravel: a buff ground and a few thousand pebbles, each drawn
    // wrapped across the tile edge so the tile never seams
    gravel: function (c, h, N) {
      c.fillStyle = "#a39679"; c.fillRect(0, 0, N, N);
      h.fillStyle = "#5a5a5a"; h.fillRect(0, 0, N, N);
      for (let i = 0; i < 5200; i++) {
        const x = hsh(i, 31) * N, y = hsh(i, 32) * N, r = 1.4 + hsh(i, 33) * 3.2, t = hsh(i, 34);
        const col = t < 0.33 ? [196, 186, 162] : t < 0.66 ? [150, 138, 116] : [120, 112, 98];
        for (const ox of [0, -N, N]) for (const oy of [0, -N, N]) {
          if (x + ox < -8 || x + ox > N + 8 || y + oy < -8 || y + oy > N + 8) continue;
          c.fillStyle = rgb(col[0], col[1], col[2]);
          c.beginPath(); c.ellipse(x + ox, y + oy, r, r * 0.75, t * 3, 0, Math.PI * 2); c.fill();
          h.fillStyle = rgb(150 + t * 100, 150 + t * 100, 150 + t * 100);
          h.beginPath(); h.ellipse(x + ox, y + oy, r, r * 0.75, t * 3, 0, Math.PI * 2); h.fill();
        }
      }
    },
    // a planted bed: dark tilth with low bedding plants in flower
    bed: function (c, h, N) {
      c.fillStyle = "#3a2d22"; c.fillRect(0, 0, N, N);
      h.fillStyle = "#303030"; h.fillRect(0, 0, N, N);
      for (let i = 0; i < 1500; i++) {
        const x = hsh(i, 41) * N, y = hsh(i, 42) * N, r = 3 + hsh(i, 43) * 6, t = hsh(i, 44);
        for (const ox of [0, -N, N]) for (const oy of [0, -N, N]) {
          if (x + ox < -12 || x + ox > N + 12 || y + oy < -12 || y + oy > N + 12) continue;
          c.fillStyle = t < 0.62 ? rgb(52 + t * 30, 86 + t * 40, 44) : t < 0.8 ? rgb(176, 46, 58) : t < 0.92 ? rgb(236, 228, 214) : rgb(222, 170, 60);
          c.beginPath(); c.arc(x + ox, y + oy, r * (t < 0.62 ? 1 : 0.55), 0, Math.PI * 2); c.fill();
          h.fillStyle = rgb(120 + t * 110, 120 + t * 110, 120 + t * 110);
          h.beginPath(); h.arc(x + ox, y + oy, r, 0, Math.PI * 2); h.fill();
        }
      }
    },
    // COURSED ASHLAR for walls: eight 0.45 m courses over a 3.6 m tile,
    // blocks 0.6-1.4 m long in broken bond, a recessed lime joint, each block
    // its own shade of the same limestone and faintly tooled
    ashlar: function (c, h, N) {
      c.fillStyle = "#9d978a"; c.fillRect(0, 0, N, N);
      h.fillStyle = "#282828"; h.fillRect(0, 0, N, N);
      const rows = 8, rh = N / rows, j = 2.2;
      let k = 0;
      for (let r = 0; r < rows; r++) {
        let x = hsh(r, 61) * N * 0.3;
        const y = r * rh;
        while (x < N + 1) {
          const len = N * (0.17 + hsh(k, 62) * 0.22), t = hsh(k++, 63);
          const g = 196 + t * 30;
          for (const ox of [0, -N]) {
            const x0 = x + ox;
            c.fillStyle = rgb(g, g * 0.975, g * 0.93);
            c.fillRect(x0 + j, y + j, len - 2 * j, rh - 2 * j);
            // a lighter bed on the top arris, a darker drip under it
            c.fillStyle = "rgba(255,252,240,0.10)"; c.fillRect(x0 + j, y + j, len - 2 * j, 3);
            c.fillStyle = "rgba(40,36,28,0.10)"; c.fillRect(x0 + j, y + rh - j - 3, len - 2 * j, 3);
            h.fillStyle = rgb(200 + t * 40, 200 + t * 40, 200 + t * 40);
            h.fillRect(x0 + j, y + j, len - 2 * j, rh - 2 * j);
          }
          x += len;
        }
      }
      for (let i = 0; i < 2600; i++) {
        c.fillStyle = hsh(i, 64) < 0.5 ? "rgba(70,62,50,0.05)" : "rgba(255,250,235,0.05)";
        c.fillRect(hsh(i, 65) * N, hsh(i, 66) * N, 1 + hsh(i, 67) * 3, 1 + hsh(i, 68) * 3);
      }
    },
    // SLATE: 0.3 m courses of 0.25 m wide slates, each course half-lapped on
    // the last, a blue-grey that varies slate to slate, the lower edge of
    // every course shadowed (the lap)
    slate: function (c, h, N) {
      c.fillStyle = "#2e3238"; c.fillRect(0, 0, N, N);
      h.fillStyle = "#303030"; h.fillRect(0, 0, N, N);
      const rows = 8, per = 10, rh = N / rows, sw = N / per;
      let k = 0;
      for (let r = 0; r < rows; r++) {
        const off = (r % 2) ? sw / 2 : 0;
        for (let i = -1; i < per; i++) {
          const x = i * sw + off, y = r * rh, t = hsh(k++, 71);
          const g = 72 + t * 26;
          c.fillStyle = rgb(g * 0.92, g * 0.98, g * 1.1);
          c.fillRect(x + 1.5, y, sw - 3, rh - 1);
          c.fillStyle = "rgba(0,0,0,0.28)"; c.fillRect(x + 1.5, y + rh - 5, sw - 3, 4);
          c.fillStyle = "rgba(255,255,255,0.05)"; c.fillRect(x + 1.5, y, sw - 3, 3);
          const grd = 120 + t * 40;
          h.fillStyle = rgb(grd, grd, grd); h.fillRect(x + 1.5, y, sw - 3, rh - 1);
        }
      }
    },
    // the helipad deck: NOT a tile. One square of brushed concrete with its
    // expansion joints, the white perimeter, the yellow touchdown circle and
    // the H, painted at 1024 so the markings are crisp from the approach.
    helipad: function (c, h, N) {
      c.fillStyle = "#77797a"; c.fillRect(0, 0, N, N);
      for (let i = 0; i < 9000; i++) {
        const t = hsh(i, 51);
        c.fillStyle = t < 0.5 ? "rgba(40,40,40,0.10)" : "rgba(235,235,230,0.08)";
        c.fillRect(hsh(i, 52) * N, hsh(i, 53) * N, 1 + (i % 3), 1);
      }
      h.fillStyle = "#b0b0b0"; h.fillRect(0, 0, N, N);
      c.strokeStyle = "rgba(40,40,40,0.35)"; c.lineWidth = 2;
      h.strokeStyle = "#303030"; h.lineWidth = 3;
      for (let k = 1; k < 4; k++) {
        for (const g of [c, h]) {
          g.beginPath(); g.moveTo(k * N / 4, 0); g.lineTo(k * N / 4, N); g.stroke();
          g.beginPath(); g.moveTo(0, k * N / 4); g.lineTo(N, k * N / 4); g.stroke();
        }
      }
      c.strokeStyle = "rgba(240,240,234,0.97)"; c.lineWidth = N * 0.022;
      c.strokeRect(N * 0.03, N * 0.03, N * 0.94, N * 0.94);
      c.strokeStyle = "rgba(236,188,36,0.97)"; c.lineWidth = N * 0.036;
      c.beginPath(); c.arc(N / 2, N / 2, N * 0.335, 0, Math.PI * 2); c.stroke();
      c.fillStyle = "rgba(242,242,236,0.98)";
      const hw = N * 0.105, hh = N * 0.15, st = N * 0.045;
      c.fillRect(N / 2 - hw, N / 2 - hh, st, hh * 2);
      c.fillRect(N / 2 + hw - st, N / 2 - hh, st, hh * 2);
      c.fillRect(N / 2 - hw, N / 2 - st / 2, hw * 2, st);
      for (let i = 0; i < 7; i++) {
        c.fillStyle = "rgba(18,18,18,0.09)";
        c.save(); c.translate(N * (0.34 + hsh(i, 55) * 0.32), N * (0.34 + hsh(i, 56) * 0.32)); c.rotate(hsh(i, 57) * 3);
        c.fillRect(-N * 0.07, -N * 0.008, N * 0.14, N * 0.016); c.restore();
      }
    },
  };
  const PAINTED = {};
  function paintedTex(kind) {
    if (PAINTED[kind] !== undefined) return PAINTED[kind];
    PAINTED[kind] = null;
    const N = kind === "helipad" ? 1024 : 512;
    /* PAINTED ON FIRST SIGHT (core/texfree.js): the estates are far from
       downtown and mostly parked, so their skins (7 MB of canvas) are painted
       the first frame one is drawn and handed back after the upload. The
       painters are deterministic, so a re-upload paints the same picture. */
    if (CBZ.lazyCanvasTexture && PAINT[kind] && mkCanvas(1)) {
      try {
        const aniso = (function () { try { return Math.min(8, CBZ.renderer.capabilities.getMaxAnisotropy()); } catch (e) { return 4; } })();
        const map = CBZ.lazyCanvasTexture(N, N, function (ctx) {
          const h = mkCanvas(N); PAINT[kind](ctx, h.getContext("2d"), N); h.width = 1; h.height = 1;
        }, { name: "estate-" + kind });
        map.wrapS = map.wrapT = kind === "helipad" ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
        map.anisotropy = aniso;
        if (THREE.sRGBEncoding) map.encoding = THREE.sRGBEncoding;
        const wantN = kind !== "helipad" && !!(CBZ.pbrMaterialsOn && CBZ.pbrMaterialsOn());
        let normal = null;
        if (wantN) {
          normal = CBZ.lazyCanvasTexture(N, N, function (ctx) {
            const c = mkCanvas(N), h = mkCanvas(N);
            PAINT[kind](c.getContext("2d"), h.getContext("2d"), N);
            const nc = heightToNormal(h, kind === "gravel" ? 3.0 : 4.0);
            if (nc) ctx.drawImage(nc, 0, 0);
            c.width = h.width = 1; if (nc) nc.width = 1;
          }, { name: "estate-" + kind + "-n" });
          normal.wrapS = normal.wrapT = map.wrapS;
          normal.anisotropy = aniso;
        }
        PAINTED[kind] = { map: map, normal: normal };
      } catch (e) { PAINTED[kind] = null; }
      return PAINTED[kind];
    }
    const cc = mkCanvas(N), hc = mkCanvas(N);
    if (!cc || !hc || !PAINT[kind]) return null;
    try {
      PAINT[kind](cc.getContext("2d"), hc.getContext("2d"), N);
      const aniso = (function () { try { return Math.min(8, CBZ.renderer.capabilities.getMaxAnisotropy()); } catch (e) { return 4; } })();
      const map = new THREE.CanvasTexture(cc);
      map.wrapS = map.wrapT = kind === "helipad" ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
      map.anisotropy = aniso;
      if (THREE.sRGBEncoding) map.encoding = THREE.sRGBEncoding;
      let normal = null;
      // the normal map only feeds the PBR path (Lambert has no normalMap in
      // r128), and the helipad deck is paint on a slab, not a relief
      const wantN = kind !== "helipad" && !!(CBZ.pbrMaterialsOn && CBZ.pbrMaterialsOn());
      const nc = wantN ? heightToNormal(hc, kind === "gravel" ? 3.0 : 4.0) : null;
      if (nc) {
        normal = new THREE.CanvasTexture(nc);
        normal.wrapS = normal.wrapT = map.wrapS;
        normal.anisotropy = aniso;
      }
      PAINTED[kind] = { map: map, normal: normal };
    } catch (e) { PAINTED[kind] = null; }
    return PAINTED[kind];
  }

  /* THE ESTATE SURFACES. `tile` is metres per texture repeat (0 = a decal
     mapped 0..1 over its own square). `flat` is the shared colour a surface
     wears when textures are unavailable (headless, tier 0). */
  const SURF = {
    // (decoded: a mown lawn ~0.09/0.14/0.05 and its lighter mowing stripe;
    // 0x587f45/0x6a9651 were lime even once decoded, g/b 3.6)
    lawn:    { lib: "grass", tint: 0x586a42, tile: 3.2, flat: 0x586a42 },
    lawnB:   { lib: "grass", tint: 0x62744a, tile: 3.2, flat: 0x62744a },
    asphalt: { lib: "asphalt", tint: 0x3d4043, tile: 5.0, flat: 0x33373b },
    sett:    { paint: "sett", tint: 0xffffff, tile: 3.2, flat: 0x8f8b82 },
    settD:   { paint: "sett", tint: 0x9a968e, tile: 3.2, flat: 0x6c6962 },
    flag:    { paint: "flag", tint: 0xffffff, tile: 3.2, flat: 0xb8b0a0 },
    gravel:  { paint: "gravel", tint: 0xffffff, tile: 2.0, flat: 0xa99d82 },
    bed:     { paint: "bed", tint: 0xffffff, tile: 2.4, flat: 0x43362a },
    heli:    { paint: "helipad", tint: 0xffffff, tile: 0, flat: 0x6f7274 },
    // wall and roof skins (box-mapped in world metres by Kit, below)
    ashlar:  { paint: "ashlar", tint: 0xffffff, tile: 3.6, flat: 0xcdc6b6 },
    slate:   { paint: "slate", tint: 0xffffff, tile: 2.4, flat: 0x464b53 },
  };
  const EMAT = {};
  function estateMat(kind) {
    if (EMAT[kind]) return EMAT[kind];
    const d = SURF[kind];
    let m = null;
    // A LAWN IS THE ONE GROUND. Was the 3.2 m grass map tiled on a flat
    // tint: the tile counted from the drive, and mip-averaged to one flat
    // green across the parterre. Now the ground skin with this lawn's
    // colour: the same turf (hue, bare soil, clumps to blades) the country
    // round the estate wears, on every quality tier. lawnB keeps its
    // lighter tint, so the mowing stripes stay.
    if (d.lib === "grass" && CBZ.groundSkin) {
      m = CBZ.groundSkin({ name: "estate-" + kind, srgb: true, far: 300, sandY: [-9, -8], wear: 0.15, extra: { vertexColors: false, color: d.tint } });
      m._shared = true;
      EMAT[kind] = m;
      return m;
    }
    try {
      const pbr = !!(CBZ.pbrMaterialsOn && CBZ.pbrMaterialsOn());
      // THE AUTHORED COLOURS ARE sRGB DISPLAY HEXES; decoded to reflectance
      // (CBZ.groundLinear). The lawn's 0x587f45 used to reach the lights as
      // 50% green: pale lime stripes from the air. (0xffffff tints: no-op.)
      const lin = function (h) { return CBZ.groundLinear ? CBZ.groundLinear(h) : new THREE.Color(h); };
      let map = null, normal = null, rough = null, tint = lin(d.tint);
      if (d.lib && CBZ.surfaceMaps) {
        const mp = CBZ.surfaceMaps(d.lib, { repeat: 1 });
        if (mp) {
          map = mp.map; normal = mp.normalMap; rough = mp.roughnessMap;
          // the library map carries its own brightness; divide it back out so
          // the lawn is the green authored here and the map adds only grain
          const mean = CBZ.surfaceMapMean ? CBZ.surfaceMapMean(map) : [1, 1, 1];
          const c = lin(d.tint);
          c.r /= Math.max(0.05, mean[0]); c.g /= Math.max(0.05, mean[1]); c.b /= Math.max(0.05, mean[2]);
          tint = c;
        }
      } else if (d.paint) {
        const t = paintedTex(d.paint);
        if (t) { map = t.map; normal = t.normal; }
      }
      if (map) {
        m = pbr
          ? new THREE.MeshStandardMaterial({ color: tint, map: map, normalMap: normal, roughnessMap: rough, roughness: 0.94, metalness: 0, envMap: CBZ.ENV || null })
          : new THREE.MeshLambertMaterial({ color: tint, map: map });
        if (pbr && normal && m.normalScale) m.normalScale.set(0.8, 0.8);
        m._shared = true;
        m.name = "estate-" + kind;
      }
    } catch (e) { m = null; }
    if (!m) m = gm(d.flat);
    EMAT[kind] = m;
    return m;
  }

  /* A SHEET: every flat piece of one surface on one estate, accumulated in
     WORLD metres and emitted as ONE mesh. A textured material is the one
     thing core/batch.js will not merge, so the merge happens here instead:
     the whole ground of a head of state's estate is a handful of draws. UVs
     are world metres / tile, so a path and the forecourt it joins share one
     continuous pattern. Every triangle is wound to face up. */
  function Sheet(kind) { this.kind = kind; this.pos = []; this.uv = []; this.idx = []; this.n = 0; this.tile = SURF[kind].tile; }
  Sheet.prototype.v = function (x, y, z, u, w) {
    this.pos.push(x, y, z);
    if (u != null) this.uv.push(u, w);
    else if (this.tile) this.uv.push(x / this.tile, -z / this.tile);
    else this.uv.push(0, 0);
    return this.n++;
  };
  Sheet.prototype.tri = function (a, b, c) {
    const P = this.pos;
    const ux = P[b * 3] - P[a * 3], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const wx = P[c * 3] - P[a * 3], wz = P[c * 3 + 2] - P[a * 3 + 2];
    if (uz * wx - ux * wz < 0) this.idx.push(a, c, b); else this.idx.push(a, b, c);
  };
  Sheet.prototype.quad = function (x0, z0, x1, z1, y) {
    if (!(Math.abs(x1 - x0) > 0.01 && Math.abs(z1 - z0) > 0.01)) return;
    const a = this.v(x0, y, z0), b = this.v(x1, y, z0), c = this.v(x1, y, z1), d = this.v(x0, y, z1);
    this.tri(a, b, c); this.tri(a, c, d);
  };
  Sheet.prototype.rect = function (r, y) { this.quad(r.minX, r.minZ, r.maxX, r.maxZ, y); };
  // an oriented strip of width w from p0 to p1 (a path at any angle)
  Sheet.prototype.strip = function (p0, p1, w, y) {
    const dx = p1.x - p0.x, dz = p1.z - p0.z, L = Math.hypot(dx, dz);
    if (L < 0.05) return;
    const nx = -dz / L * w / 2, nz = dx / L * w / 2;
    const a = this.v(p0.x + nx, y, p0.z + nz), b = this.v(p1.x + nx, y, p1.z + nz);
    const c = this.v(p1.x - nx, y, p1.z - nz), d = this.v(p0.x - nx, y, p0.z - nz);
    this.tri(a, b, c); this.tri(a, c, d);
  };
  Sheet.prototype.disc = function (cx, cz, r, y, seg) {
    seg = seg || 40;
    const c = this.v(cx, y, cz);
    let prev = this.v(cx + r, y, cz);
    for (let i = 1; i <= seg; i++) {
      const a = i / seg * Math.PI * 2;
      const q = this.v(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r);
      this.tri(c, prev, q); prev = q;
    }
  };
  Sheet.prototype.ring = function (cx, cz, r0, r1, y, seg) {
    seg = seg || 48;
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
      const p = this.v(cx + Math.cos(a0) * r0, y, cz + Math.sin(a0) * r0);
      const q = this.v(cx + Math.cos(a0) * r1, y, cz + Math.sin(a0) * r1);
      const s = this.v(cx + Math.cos(a1) * r1, y, cz + Math.sin(a1) * r1);
      const t = this.v(cx + Math.cos(a1) * r0, y, cz + Math.sin(a1) * r0);
      this.tri(p, q, s); this.tri(p, s, t);
    }
  };
  // a rectangle with a round hole (a forecourt round its island): a polar fan
  // from the hole's edge out to the rectangle, the four corners always sampled
  Sheet.prototype.rectHole = function (r, hx, hz, hr, y, seg) {
    seg = seg || 64;
    const angs = [];
    for (let i = 0; i < seg; i++) angs.push(i / seg * Math.PI * 2);
    for (const c of [[r.maxX, r.maxZ], [r.minX, r.maxZ], [r.minX, r.minZ], [r.maxX, r.minZ]]) {
      let a = Math.atan2(c[1] - hz, c[0] - hx); if (a < 0) a += Math.PI * 2; angs.push(a);
    }
    angs.sort(function (a, b) { return a - b; });
    const edge = function (a) {
      const dx = Math.cos(a), dz = Math.sin(a);
      let t = Infinity;
      if (dx > 1e-6) t = Math.min(t, (r.maxX - hx) / dx); else if (dx < -1e-6) t = Math.min(t, (r.minX - hx) / dx);
      if (dz > 1e-6) t = Math.min(t, (r.maxZ - hz) / dz); else if (dz < -1e-6) t = Math.min(t, (r.minZ - hz) / dz);
      return { x: hx + dx * t, z: hz + dz * t };
    };
    for (let i = 0; i < angs.length; i++) {
      const a0 = angs[i], a1 = i + 1 < angs.length ? angs[i + 1] : angs[0] + Math.PI * 2;
      if (a1 - a0 < 1e-5) continue;
      const e0 = edge(a0), e1 = edge(a1);
      const p = this.v(hx + Math.cos(a0) * hr, y, hz + Math.sin(a0) * hr);
      const q = this.v(e0.x, y, e0.z), s = this.v(e1.x, y, e1.z);
      const t = this.v(hx + Math.cos(a1) * hr, y, hz + Math.sin(a1) * hr);
      this.tri(p, q, s); this.tri(p, s, t);
    }
  };
  Sheet.prototype.finish = function (root, name) {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    const nor = new Float32Array(this.n * 3);
    for (let i = 0; i < this.n; i++) nor[i * 3 + 1] = 1;
    g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere(); g.computeBoundingBox();
    const m = new THREE.Mesh(g, estateMat(this.kind));
    m.receiveShadow = true; m.castShadow = false;
    m.matrixAutoUpdate = false; m.updateMatrix();
    m.name = name || ("estate-" + this.kind);
    root.add(m);
    return m;
  }

  /* A KIT: every box of ONE object (a lodge, a garage wall, a house's
     dressing), merged per material into one mesh when the object is done.
     Keys: a hex number (the shared colour pool), a SURF name ("ashlar",
     "slate": the painted estate skins, box-mapped in metres so the courses
     run true on every face), NAME + "~uv" (that skin, the geometry's own
     UVs kept: a roof slope), "glass" (one shared see-through pane), or
     "lit:HEX:EI" (an emissive lamp face — rationed: a handful per object).
     A textured material is the one thing core/batch.js cannot merge, so the
     merge is done here: an outbuilding is a few draws, not a hundred. */
  function Kit() { this.g = new Map(); }
  Kit.prototype.add = function (key, g) {
    let l = this.g.get(key);
    if (!l) this.g.set(key, (l = []));
    l.push(g);
    return g;
  };
  Kit.prototype.box = function (key, x, y, z, w, h, d, ry, rz, rx) {
    if (!(w > 0.002 && h > 0.002 && d > 0.002)) return null;
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx) g.rotateX(rx);
    if (rz) g.rotateZ(rz);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    return this.add(key, g);
  };
  // a prototype geometry, scaled / yawed / placed (the source is not touched)
  Kit.prototype.geo = function (key, src, x, y, z, ry, sx, sy, sz) {
    const g = src.clone();
    if (sx != null) g.scale(sx, sy == null ? sx : sy, sz == null ? sx : sz);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    return this.add(key, g);
  };
  function boxUV(g, tile) {
    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      const ax = Math.abs(N.getX(i)), ay = Math.abs(N.getY(i)), az = Math.abs(N.getZ(i));
      if (ay >= ax && ay >= az) U.setXY(i, x / tile, z / tile);
      else if (ax >= az) U.setXY(i, z / tile, y / tile);
      else U.setXY(i, x / tile, y / tile);
    }
    U.needsUpdate = true;
  }
  let _paneM = null;
  function paneMat() {
    return _paneM || (_paneM = new THREE.MeshLambertMaterial({ color: 0x9db4c2, emissive: 0x1a2630, transparent: true, opacity: 0.3, depthWrite: false }));
  }
  Kit.prototype.flush = function (parent, name) {
    const out = [];
    this.g.forEach(function (list, key) {
      const geo = mergeGeos(list);
      for (const g of list) g.dispose();
      let mat, cast = true;
      const glass = typeof key === "string" && key.indexOf("glass") === 0;
      if (glass) { mat = paneMat(); cast = false; }
      else if (typeof key === "string" && key.indexOf("lit:") === 0) {
        const p = key.split(":");
        const hx = parseInt(p[1], 10);
        mat = cm(hx, { emissive: hx, ei: +p[2] || 0.8 }); cast = false;
      } else if (typeof key === "string") {
        const keep = key.slice(-3) === "~uv", k = keep ? key.slice(0, -3) : key;
        if (!keep && SURF[k]) boxUV(geo, SURF[k].tile);
        mat = SURF[k] ? estateMat(k) : cm(M.stone);
      } else mat = cm(key);
      const m = new THREE.Mesh(geo, mat);
      m.name = (name || "kit") + "-" + key;
      m.castShadow = cast; m.receiveShadow = !glass;
      if (glass) m.renderOrder = 1;
      m.matrixAutoUpdate = false; m.updateMatrix();
      parent.add(m);
      out.push(m);
    });
    this.g.clear();
    return out;
  };

  /* A WALL WITH OPENINGS, as the pieces a mason lays round them. `f` is the
     OUTWARD axis normal of the face; the face spans the full `w` on the +-z
     faces and sits between them on the +-x faces, so the corners are closed.
     Openings: [{t, w, y0, y1, door}] with t along +x (z faces) or +z (x
     faces) from the building centre. Every piece is a Kit box; a collider
     runs the whole face except the doorways (a window is glass, and glass is
     solid), so what you can see through is still what you cannot walk
     through, and a doorway is the one gap. */
  function wallFace(kit, key, x, z, f, w, d, T, y0, y1, opens, solid) {
    const alongX = Math.abs(f.z) > 0.5;
    const off = (alongX ? d : w) / 2 - T / 2;
    const span = alongX ? w : d - 2 * T;
    const nx = x + f.x * off, nz = z + f.z * off;
    const O = (opens || []).slice().sort(function (a, b) { return a.t - b.t; });
    const piece = function (t0, t1, ya, yb) {
      if (t1 - t0 < 0.01 || yb - ya < 0.01) return;
      const t = (t0 + t1) / 2;
      if (alongX) kit.box(key, x + t, (ya + yb) / 2, nz, t1 - t0, yb - ya, T);
      else kit.box(key, nx, (ya + yb) / 2, z + t, T, yb - ya, t1 - t0);
    };
    const colAt = function (t0, t1, ya, yb) {
      if (!solid || t1 - t0 < 0.01) return;
      const t = (t0 + t1) / 2;
      if (alongX) col(x + t, nz, t1 - t0, T, ya, yb);
      else col(nx, z + t, T, t1 - t0, ya, yb);
    };
    let a = -span / 2, ca = -span / 2;
    for (const o of O) {
      const t0 = o.t - o.w / 2, t1 = o.t + o.w / 2;
      piece(a, t0, y0, y1);
      piece(t0, t1, y0, o.y0);
      piece(t0, t1, o.y1, y1);
      a = t1;
      if (o.door) { colAt(ca, t0, y0, y1); colAt(t0, t1, o.y1, y1); ca = t1; }
    }
    piece(a, span / 2, y0, y1);
    colAt(ca, span / 2, y0, y1);
    return { alongX: alongX, off: off, span: span };
  }

  /* THE ORDERS' SHAPES, lathed once and shared.
     A baluster is unit tall (instanced with sy = its height): a square-read
     foot, a pear belly, a neck and a cap. A column is built for its radius
     and height (base mouldings do not stretch with the shaft): a moulded
     base, a shaft with entasis, an astragal, an echinus and a square
     abacus, so its top is exactly `H` above its foot. */
  let _balG = null;
  function balusterGeo() {
    if (_balG) return _balG;
    return (_balG = lathe([[0, 0], [0.078, 0], [0.078, 0.07], [0.056, 0.11], [0.05, 0.16], [0.078, 0.34], [0.07, 0.5],
      [0.042, 0.66], [0.036, 0.74], [0.05, 0.8], [0.062, 0.86], [0.062, 0.92], [0.078, 0.95], [0.078, 1.0], [0, 1.0]], 10));
  }
  const _colGeos = {};
  function columnGeo(R, H, ionic) {
    const k = R.toFixed(3) + ":" + H.toFixed(3) + ":" + (ionic ? 1 : 0);
    if (_colGeos[k]) return _colGeos[k];
    const plinth = new THREE.BoxGeometry(R * 2.5, R * 0.55, R * 2.5); plinth.translate(0, R * 0.275, 0);
    const b0 = R * 0.55, capH = R * 0.9, s0 = b0 + R * 0.36, s1 = H - capH;
    const prof = [[0, b0], [R * 1.3, b0], [R * 1.3, b0 + R * 0.12], [R * 1.18, b0 + R * 0.2], [R * 1.08, b0 + R * 0.28], [R * 1.02, s0]];
    // the shaft: straight for its lower third, then swelling in to 0.86 R
    for (let i = 1; i <= 6; i++) {
      const t = i / 6, y = s0 + (s1 - s0) * t;
      const r = t < 0.33 ? R : R * (1 - 0.14 * Math.pow((t - 0.33) / 0.67, 1.4));
      prof.push([r, y]);
    }
    prof.push([R * 0.98, s1], [R * 0.98, s1 + R * 0.08], [R * 0.9, s1 + R * 0.12], [R * 1.28, s1 + R * 0.46], [R * 1.28, s1 + R * 0.5], [0, s1 + R * 0.5]);
    const shaft = lathe(prof, 20);
    const abacus = new THREE.BoxGeometry(R * 2.7, capH - R * 0.5, R * 2.7); abacus.translate(0, s1 + R * 0.5 + (capH - R * 0.5) / 2, 0);
    const parts = [plinth, shaft, abacus];
    if (ionic) for (const s of [-1, 1]) {
      const v = new THREE.CylinderGeometry(R * 0.32, R * 0.32, R * 2.3, 12);
      v.rotateX(Math.PI / 2); v.translate(s * R * 1.05, s1 + R * 0.34, 0); parts.push(v);
    }
    return (_colGeos[k] = mergeGeos(parts));
  }
  // a unit PEDIMENT prism (span 1 along x, rise 1, depth 1 along z, base at
  // y 0) and a unit SEGMENTAL one: instanced over a window with sx/sy/sz
  let _pedG = null;
  function pedimentGeos() {
    if (_pedG) return _pedG;
    const tri = new THREE.Shape();
    tri.moveTo(-0.5, 0); tri.lineTo(0.5, 0); tri.lineTo(0, 1); tri.lineTo(-0.5, 0);
    const seg = new THREE.Shape();
    seg.moveTo(-0.5, 0); seg.lineTo(0.5, 0);
    for (let i = 1; i < 12; i++) { const a = i / 12 * Math.PI; seg.lineTo(0.5 * Math.cos(a), Math.sin(a)); }
    seg.lineTo(-0.5, 0);
    const ex = function (s) { const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, curveSegments: 12 }); g.translate(0, 0, -0.5); g.computeVertexNormals(); return g; };
    return (_pedG = { tri: ex(tri), seg: ex(seg) });
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

  /* HELIPAD — a raised concrete TLOF slab you can stand on, the painted deck
     (the H, the yellow touchdown circle, the white perimeter) as ONE decal,
     green edge lights on the slab lip (one instanced draw), and, when the
     caller gives it room, a windsock clear of the approach. It was an asphalt
     disc with a torus lying on it and three grey boxes for an H. */
  const HELI_TOP = 0.15;
  let _heliLightG = null, _sockM = null;
  function helipad(root, x, z, r, o) {
    o = o || {};
    const S = r * 2;
    box(root, x, HELI_TOP / 2, z, S + 0.5, HELI_TOP, S + 0.5, 0x8c8e8d, { cast: false });
    box(root, x, 0.02, z, S + 1.1, 0.04, S + 1.1, M.concreteD, { cast: false });   // the mowing strip round it
    plat(x, z, S + 0.5, S + 0.5, HELI_TOP);
    const deck = new Sheet("heli");
    const a = deck.v(x - r, HELI_TOP + 0.004, z - r, 0, 1), b = deck.v(x + r, HELI_TOP + 0.004, z - r, 1, 1);
    const c = deck.v(x + r, HELI_TOP + 0.004, z + r, 1, 0), d = deck.v(x - r, HELI_TOP + 0.004, z + r, 0, 0);
    deck.tri(a, b, c); deck.tri(a, c, d);
    deck.finish(root, "helipad-deck");
    if (!_heliLightG) {
      _heliLightG = mergeGeos([
        (function () { const g = new THREE.CylinderGeometry(0.12, 0.14, 0.05, 10); g.translate(0, 0.025, 0); return g; })(),
        (function () { const g = new THREE.SphereGeometry(0.075, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2); g.translate(0, 0.05, 0); return g; })(),
      ]);
    }
    const lp = [], per = Math.max(3, Math.round(S / 4.5));
    for (let i = 0; i < per; i++) {
      const t = -r + (i + 0.5) * S / per;
      lp.push({ x: x + t, z: z - r - 0.12 }, { x: x + t, z: z + r + 0.12 }, { x: x - r - 0.12, z: z + t }, { x: x + r + 0.12, z: z + t });
    }
    repeat(root, _heliLightG, 0x2fbf55, lp, function () { return HELI_TOP; }, null, { emissive: 0x3dff72, ei: 0.9 });
    if (o.sock) windsock(root, o.sock.x, o.sock.z, o.sock.yaw || 0);
  }
  function windsock(root, x, z, yaw) {
    box(root, x, 0.15, z, 0.9, 0.3, 0.9, M.concreteD, { cast: false });
    cyl(root, x, 0.3 + 2.9, z, 0.045, 0.075, 5.8, 0xd8dadc, 10);
    col(x, z, 0.5, 0.5, 0, 6.0);
    if (!_sockM) {
      // five hard bands, orange / white, coloured per TRIANGLE so the band
      // edges are crisp rather than smeared across a shared vertex
      const g = new THREE.CylinderGeometry(0.34, 0.14, 2.4, 14, 5, true).toNonIndexed();
      const p = g.attributes.position, colr = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i += 3) {
        const ym = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
        const band = Math.max(0, Math.min(4, Math.floor((1.2 - ym) / 2.4 * 5)));
        const orange = band % 2 === 0;
        for (let k = 0; k < 3; k++) {
          colr[(i + k) * 3] = 0.95; colr[(i + k) * 3 + 1] = orange ? 0.42 : 0.94; colr[(i + k) * 3 + 2] = orange ? 0.12 : 0.92;
        }
      }
      g.setAttribute("color", new THREE.BufferAttribute(colr, 3));
      g.rotateZ(-Math.PI / 2);                    // the wide mouth to +x...
      g.translate(-1.1, 0, 0);                    // ...and sat on the hoop at x 0.1; the tail runs to -x
      g.computeVertexNormals();
      _sockM = { g: g, m: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }) };
    }
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.025, 6, 16), cm(0xd8dadc));
    const sock = new THREE.Mesh(_sockM.g, _sockM.m);
    const grp = new THREE.Group();
    grp.position.set(x, 5.75, z); grp.rotation.y = yaw;
    hoop.rotation.y = Math.PI / 2; hoop.position.x = 0.1; grp.add(hoop);
    sock.rotation.z = 0.22; grp.add(sock);                  // a light breeze: the tail droops
    root.add(grp);
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
    return { inner: inner, height: H, apothem: A, rot0: rot0, FH: FH, storeys: ST, innerFace: inner };
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
      // dress:false — the facade kit's city-wide hash pick stays OFF these
      // shells. A civic shell already wears buildings_civic.js's order and
      // crown; letting the kit roll a second grammar over it is how the
      // Executive Mansion shipped as a Tudor manor with a dome through its
      // roof and a pagoda for a West Wing. A caller may still pass its own
      // `dress` (the Freeport's shed does) and that wins.
      const base = spec ? { facade: "civic", civic: spec, district: "core", dress: false } : { facade: "office", district: "core", dress: false };
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
    opts = Object.assign({ facade: "office", dress: false }, opts || {});   // plain shells stay plain (see civic())
    try { b = CBZ.cityMakeBuilding(root, x, z, w, d, storeys, hex, side, opts); }
    catch (e) { b = null; }
    if (b && _curSite) _shells.push({ site: _curSite, b: b, name: null });
    return b;
  }

  /* ====================================================================
     §1b  THE ESTATE KIT — land a rich man owns, drawn as a place.

     OWNER (on the Executive Mansion): "the entire presidential lot is
     horrible slop — the ground and the helicopter, all slop." It was: one
     flat green plane 248 m square, a grey disc for a motor court, NO DRIVE
     AT ALL between the gate and the house (the lamps stood in the grass), a
     helipad that was an asphalt disc with a torus lying on it, thirty-two
     hedge-coloured boxes for a garden, and a 3.4 m blank wall all round.

     A head of state's residence is read from the gate inwards, so this kit
     builds it in that order and every piece answers what it is FOR:
       the perimeter    stone plinth + iron railing on piers (you can see the
                        house from the road, you cannot walk in), a gate
                        framed by lantern piers, sliding leaves parked open
       the drive        asphalt between sett bands and granite kerbs, lit by
                        lantern standards, under an allee of trees
       the forecourt    granite setts with a darker border, round a kerbed
                        lawn island and its fountain: the carriage ring the
                        motorcade actually drives
       the house        the civic shell at a real storey height, dressed from
                        its own built record (houseDress: rusticated base,
                        window pediments, balustrade, slate roof, chimneys,
                        porticoes, lights), its wings, a covered colonnade
                        from the office wing to the court
       the grounds      clipped lawns (mown stripes), flank walks to a rear
                        terrace, a central walk to a rondel and basin, two
                        parterres of box hedge, beds and topiary
       the working bits a raised, lit helipad with its windsock off to one
                        side, a staff car park by the office wing, a motor
                        pool with drive-in bays, walk-in sentry lodges in
                        the corners, flags on the court

     ONE KIT, EVERY RICH MAN. Nothing here knows it is the President's. A row
     hands `estate(c, spec)` a spec (footprint comes from the row's hx/hz,
     everything else is metres in a GATE-UP frame: v runs from the house to
     the gate, u across), and the tier fills whatever the spec leaves out.
     A warlord's villa is a smaller house, a wall instead of railings, a
     gravel court and watchtowers; a millionaire's is tier 3 and no helipad.
     `CBZ.estateKit.register(row)` adds such a row before the world builds.

     THE GROUND IS A HANDFUL OF DRAWS. Every flat piece of one surface on one
     estate is one mesh (Sheet, above): textured materials never merge, so
     the merge is done here. Kerbs, piers, lodges and plinths are plain
     static boxes in the shared colour pool that core/batch.js folds away.
     Repeats (railing panels, pickets' gilt, lamps, hedges, trees, urns) are
     InstancedMesh. Nothing floats: every piece stands on y = 0, the pad, a
     kerb or the slab it names, and the node check in the commit measures it.
     ==================================================================== */
  const EST = {
    iron: 0x1c1f23, gilt: 0xb99347, kerb: 0xc2beb3, hedge: 0x2d4a29, hedgeD: 0x274225,
    topiary: 0x315530, urn: 0xcfc8b8, bark: 0x6b5a48,
  };
  // what a tier gets when its spec does not say
  const EST_TIER = {
    5: { perimeter: "railing", h: 3.4, gateW: 26, lodges: 4, flags: 2, lamps: true, allee: true },
    4: { perimeter: "railing", h: 3.0, gateW: 24, lodges: 2, flags: 1, lamps: true, allee: true },
    3: { perimeter: "wall", h: 2.8, gateW: 18, lodges: 0, flags: 0, lamps: true, allee: false },
    2: { perimeter: "wall", h: 3.2, gateW: 16, lodges: 0, flags: 0, lamps: false, allee: false },
    1: { perimeter: "fence", h: 3.0, gateW: 14, lodges: 0, flags: 0, lamps: false, allee: false },
  };

  /* THE FRAME. Local (u, v) with +v toward the gate. The four gate sides are
     quarter turns of the same frame, so an axis-aligned local box is an
     axis-aligned world box with its extents swapped on the quarter turns. */
  function estateFrame(c, side) {
    const R = c.rect, cx = c.cx, cz = c.cz;
    const s = side == null ? 1 : side;
    const rot = s === 3 ? Math.PI / 2 : s === 0 ? Math.PI : s === 2 ? -Math.PI / 2 : 0;
    const swap = s === 2 || s === 3;
    function p(u, v) {
      if (s === 1) return { x: cx + u, z: cz + v };
      if (s === 0) return { x: cx - u, z: cz - v };
      if (s === 3) return { x: cx + v, z: cz - u };
      return { x: cx - v, z: cz + u };
    }
    function sideOf(du, dv) {
      const a = p(du, dv), dx = a.x - cx, dz = a.z - cz;
      if (Math.abs(dz) >= Math.abs(dx)) return dz < 0 ? 0 : 1;
      return dx < 0 ? 2 : 3;
    }
    const root = c.root;
    return {
      s: s, rot: rot, swap: swap, cx: cx, cz: cz, rect: R, root: root, p: p, sideOf: sideOf,
      hu: swap ? (R.maxZ - R.minZ) / 2 : (R.maxX - R.minX) / 2,
      hv: swap ? (R.maxX - R.minX) / 2 : (R.maxZ - R.minZ) / 2,
      wr: function (u0, v0, u1, v1) {
        const a = p(u0, v0), b = p(u1, v1);
        return { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) };
      },
      box: function (u, y, v, wu, h, wv, hex, o) {
        const q = p(u, v);
        return box(root, q.x, y, q.z, swap ? wv : wu, h, swap ? wu : wv, hex, o);
      },
      col: function (u, v, wu, wv, y0, y1) {
        const q = p(u, v);
        return col(q.x, q.z, swap ? wv : wu, swap ? wu : wv, y0, y1);
      },
      plat: function (u, v, wu, wv, top) {
        const q = p(u, v);
        return plat(q.x, q.z, swap ? wv : wu, swap ? wu : wv, top);
      },
      // a local rect onto a sheet
      fill: function (sh, u0, v0, u1, v1, y) { sh.rect(this.wr(u0, v0, u1, v1), y); },
    };
  }

  // instanced repeats that need a per-instance yaw AND scale (railing panels,
  // hedges, trees): items {x, y, z, ry, sx, sy, sz}
  function instances(root, geo, mat, items, cast) {
    if (!items.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, items.length);
    im.castShadow = cast !== false; im.receiveShadow = true;
    const d = new THREE.Object3D();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      d.position.set(it.x, it.y || 0, it.z);
      d.rotation.set(0, it.ry || 0, 0);
      d.scale.set(it.sx || 1, it.sy || 1, it.sz || 1);
      d.updateMatrix(); im.setMatrixAt(i, d.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere && im.computeBoundingSphere();
    root.add(im);
    return im;
  }

  /* ---- THE RAILING ----------------------------------------------------- */
  const _railG = {};
  function railGeos(H) {
    const k = H.toFixed(2);
    if (_railG[k]) return _railG[k];
    const L = 2.0, n = 14, pitch = L / n, iron = [], gold = [];
    for (let i = 0; i < n; i++) {
      const x = -L / 2 + (i + 0.5) * pitch;
      const g = new THREE.BoxGeometry(0.026, H - 0.14, 0.026); g.translate(x, (H - 0.14) / 2, 0); iron.push(g);
      const f = new THREE.ConeGeometry(0.036, 0.14, 4); f.translate(x, H - 0.07, 0); gold.push(f);
    }
    for (const y of [0.1, H - 0.36, H - 0.46]) {
      const g = new THREE.BoxGeometry(L, 0.045, 0.042); g.translate(0, y, 0); iron.push(g);
    }
    return (_railG[k] = { iron: mergeGeos(iron), gold: mergeGeos(gold) });
  }
  let _pierG = null;
  function pierGeos() {
    if (_pierG) return _pierG;
    const cap = mergeGeos([
      (function () { const g = new THREE.BoxGeometry(1.04, 0.16, 1.04); g.translate(0, 0.08, 0); return g; })(),
      (function () { const g = new THREE.BoxGeometry(0.5, 0.14, 0.5); g.translate(0, 0.23, 0); return g; })(),
      (function () { const g = new THREE.SphereGeometry(0.2, 12, 8); g.translate(0, 0.49, 0); return g; })(),
    ]);
    return (_pierG = { cap: cap });
  }
  // perimeter with a gate gap on the frame's gate edge; returns the gate
  // piers' world points. Plinth and piers are masonry boxes (batched), the
  // railing two instanced draws for the whole estate.
  function railingPerimeter(F, o) {
    const R = F.rect, root = F.root;
    const h = o.h, plH = o.plinth || 0.9, T = 0.7, gw = o.gateW;
    const g = F.p(0, F.hv);
    const edges = [
      [R.minX, R.minZ, R.maxX, R.minZ, 0], [R.minX, R.maxZ, R.maxX, R.maxZ, 1],
      [R.minX, R.minZ, R.minX, R.maxZ, 2], [R.maxX, R.minZ, R.maxX, R.maxZ, 3],
    ];
    const piers = [], panels = [], seen = Object.create(null), gatePts = [];
    const railH = h - plH - 0.12;
    function pierAt(x, z) {
      const k = Math.round(x * 10) + ":" + Math.round(z * 10);
      if (seen[k]) return; seen[k] = true;
      piers.push({ x: x, z: z });
    }
    for (const e of edges) {
      const horiz = e[4] < 2, a = horiz ? e[0] : e[1], b = horiz ? e[2] : e[3], fixed = horiz ? e[1] : e[0];
      const gapC = horiz ? g.x : g.z;
      const gated = e[4] === F.s && gw > 0;
      const spans = gated ? [[a, gapC - gw / 2, 1], [gapC + gw / 2, b, 0]] : [[a, b, -1]];
      for (const sp of spans) {
        let s0 = sp[0], s1 = sp[1];
        if (s1 - s0 < 1.0) continue;
        const mid = (s0 + s1) / 2, len = s1 - s0;
        const x = horiz ? mid : fixed, z = horiz ? fixed : mid;
        box(root, x, plH / 2, z, horiz ? len : T, plH, horiz ? T : len, M.stoneD);
        box(root, x, plH + 0.06, z, horiz ? len + 0.1 : T + 0.16, 0.12, horiz ? T + 0.16 : len + 0.1, M.stone, { cast: false });
        col(x, z, horiz ? len : T, horiz ? T : len, 0, h);
        // the gate end of a span carries the big gate pier instead of a plain one
        const gEnd = sp[2];
        if (gEnd === 1) { const gp = horiz ? { x: s1 - 0.65, z: fixed } : { x: fixed, z: s1 - 0.65 }; gatePts.push(gp); s1 -= 1.3; }
        if (gEnd === 0) { const gp = horiz ? { x: s0 + 0.65, z: fixed } : { x: fixed, z: s0 + 0.65 }; gatePts.push(gp); s0 += 1.3; }
        const L2 = s1 - s0;
        const nb = Math.max(1, Math.round(L2 / 8.4)), step = L2 / nb;
        const stations = [];
        for (let i = 0; i <= nb; i++) {
          const t = s0 + i * step;
          const atGate = (gEnd === 1 && i === nb) || (gEnd === 0 && i === 0);
          if (!atGate) pierAt(horiz ? t : fixed, horiz ? fixed : t);
          stations.push({ t: t, half: atGate ? 0 : 0.4 });
        }
        for (let i = 0; i < nb; i++) {
          const b0 = stations[i].t + stations[i].half, b1 = stations[i + 1].t - stations[i + 1].half;
          const bl = b1 - b0;
          if (bl < 0.4) continue;
          const k = Math.max(1, Math.round(bl / 2)), sc = bl / k / 2;
          for (let j = 0; j < k; j++) {
            const t = b0 + (j + 0.5) * bl / k;
            panels.push({ x: horiz ? t : fixed, y: plH + 0.12, z: horiz ? fixed : t, ry: horiz ? 0 : Math.PI / 2, sx: sc });
          }
        }
      }
    }
    const G = railGeos(railH), PG = pierGeos();
    instances(root, G.iron, cm(EST.iron), panels);
    instances(root, G.gold, cm(EST.gilt), panels, false);
    const ph = h + 0.2;
    repeat(root, bg(0.8, ph, 0.8), M.stoneD, piers, function () { return ph / 2; });
    repeat(root, PG.cap, M.stone, piers, function () { return ph; });
    for (let i = 0; i < piers.length; i++) col(piers[i].x, piers[i].z, 0.8, 0.8, 0, ph);
    // THE GATE PIERS: rusticated, capped, a lantern on each
    for (const gp of gatePts) {
      const H = h + 1.0;
      box(root, gp.x, H / 2, gp.z, 1.3, H, 1.3, M.stone);
      for (let k = 1; k <= 4; k++) box(root, gp.x, k * (H / 5), gp.z, 1.36, 0.06, 1.36, M.stoneD, { cast: false });
      box(root, gp.x, H + 0.1, gp.z, 1.6, 0.2, 1.6, M.stoneD);
      box(root, gp.x, H + 0.3, gp.z, 0.6, 0.2, 0.6, M.stone);
      const lg = lampGeos();
      const lan = { x: gp.x, z: gp.z };
      // just the lantern and its cap off the standard, sat on the pier
      repeat(root, lg.glass, M.lampHead, [lan], function () { return H + 0.4 - 4.34; }, null, { emissive: M.lampHead, ei: 0.85 });
      box(root, gp.x, H + 0.96, gp.z, 0.56, 0.12, 0.56, EST.iron, { cast: false });       // the lantern cap
      col(gp.x, gp.z, 1.3, 1.3, 0, H);
    }
    return gatePts;
  }
  // chain-link and masonry keep the existing kit (perimeter()); this picks
  function estatePerimeter(F, T) {
    if (T.perimeter === "railing") return railingPerimeter(F, { h: T.h, gateW: T.gateW });
    perimeter(F.root, F.rect, { style: T.perimeter === "fence" ? "fence" : "wall", h: T.h, thick: 0.6, hex: M.stoneD, gate: F.s, gateW: T.gateW });
    return [];
  }
  // the gate leaves, SLID OPEN along the inside of the railing (a real
  // compound gate runs on a track; the working barrier is the checkpoint)
  function estateGateLeaves(F, gw, h) {
    const G = railGeos(h - 0.3), items = [];
    for (const sgn of [-1, 1]) {
      const u0 = sgn * (gw / 2 + 1.5), u1 = sgn * (gw / 2 + 1.5 + gw / 2);
      const k = Math.max(1, Math.round(Math.abs(u1 - u0) / 2)), sc = Math.abs(u1 - u0) / k / 2;
      const v = F.hv - 1.1;
      for (let j = 0; j < k; j++) {
        const u = u0 + (u1 - u0) * (j + 0.5) / k, q = F.p(u, v);
        items.push({ x: q.x, y: 0.12, z: q.z, ry: F.rot, sx: sc });
      }
      const um = (u0 + u1) / 2, len = Math.abs(u1 - u0);
      F.box(um, 0.06, v, len + 0.2, 0.12, 0.18, 0x3a3e42, { cast: false });                 // the track
      F.box(um, 0.12 + (h - 0.3) - 0.2, v, len, 0.12, 0.09, EST.iron);                      // head rail
      F.box(u1 + sgn * 0.05, 0.12 + (h - 0.3) / 2, v, 0.12, h - 0.3, 0.12, EST.iron);        // stile
      F.col(um, v, len, 0.3, 0, h - 0.2);
    }
    instances(F.root, G.iron, cm(EST.iron), items);
    instances(F.root, G.gold, cm(EST.gilt), items, false);
  }

  /* ---- KERB, HEDGE, URN, TREE, TOPIARY ----------------------------------- */
  // a granite kerb along a local segment (axis-aligned), 0.3 wide, 0.24 tall
  function kerb(F, u0, v0, u1, v1) {
    const alongU = Math.abs(u1 - u0) > Math.abs(v1 - v0);
    const len = alongU ? Math.abs(u1 - u0) : Math.abs(v1 - v0);
    if (len < 0.2) return;
    F.box((u0 + u1) / 2, 0.12, (v0 + v1) / 2, alongU ? len : 0.3, 0.24, alongU ? 0.3 : len, EST.kerb, { cast: false });
    // a kerb is ground you step up onto, not a wall: it joins the estate's
    // height oracle at its top instead of taking a collider
    if (F.eg) {
      const r = alongU ? F.wr(Math.min(u0, u1), (v0 + v1) / 2 - 0.15, Math.max(u0, u1), (v0 + v1) / 2 + 0.15)
                       : F.wr((u0 + u1) / 2 - 0.15, Math.min(v0, v1), (u0 + u1) / 2 + 0.15, Math.max(v0, v1));
      r.y = 0.24; F.eg.rects.push(r);
    }
  }
  // kerb a local rect's edges, leaving named openings: gaps = [{edge:"n"|"s"|"e"|"w", c, w}]
  // n = +v (toward the gate), s = -v, e = +u, w = -u. `inset` puts the kerb just outside the rect.
  function kerbRect(F, u0, v0, u1, v1, gaps, skip) {
    const G = gaps || [], SK = skip || [];
    const run = function (edge, a0, a1, fixed, alongU) {
      if (SK.indexOf(edge) >= 0) return;
      let cuts = G.filter(function (g) { return g.edge === edge; }).map(function (g) { return [g.c - g.w / 2, g.c + g.w / 2]; });
      cuts.sort(function (p, q) { return p[0] - q[0]; });
      let a = a0;
      for (const ct of cuts) {
        if (ct[0] > a) alongU ? kerb(F, a, fixed, ct[0], fixed) : kerb(F, fixed, a, fixed, ct[0]);
        a = Math.max(a, ct[1]);
      }
      if (a < a1) alongU ? kerb(F, a, fixed, a1, fixed) : kerb(F, fixed, a, fixed, a1);
    };
    run("n", u0 - 0.3, u1 + 0.3, v1 + 0.15, true);
    run("s", u0 - 0.3, u1 + 0.3, v0 - 0.15, true);
    run("e", v0, v1, u1 + 0.15, false);
    run("w", v0, v1, u0 - 0.15, false);
  }
  // a clipped hedge: a box whose top edges are rounded off (an extruded
  // rounded profile), unit size, instanced with per-run length/height/depth
  let _hedgeG = null;
  function hedgeGeo() {
    if (_hedgeG) return _hedgeG;
    const sh = new THREE.Shape(), r = 0.16;
    sh.moveTo(-0.5, 0); sh.lineTo(0.5, 0); sh.lineTo(0.5, 1 - r);
    sh.quadraticCurveTo(0.5, 1, 0.5 - r, 1); sh.lineTo(-0.5 + r, 1);
    sh.quadraticCurveTo(-0.5, 1, -0.5, 1 - r); sh.lineTo(-0.5, 0);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false, curveSegments: 4 });
    g.translate(0, 0, -0.5);
    g.rotateY(Math.PI / 2);                 // the run is local +x, the profile across z
    g.computeVertexNormals();
    return (_hedgeG = g);
  }
  // hedge runs: list of {u0, v0, u1, v1, h, w} (axis-aligned); collected, then one draw
  function hedgeRuns(F, runs, hex) {
    const items = [];
    for (const r of runs) {
      const alongU = Math.abs(r.u1 - r.u0) >= Math.abs(r.v1 - r.v0);
      const len = alongU ? Math.abs(r.u1 - r.u0) : Math.abs(r.v1 - r.v0);
      if (len < 0.3) continue;
      const q = F.p((r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2);
      items.push({ x: q.x, y: 0, z: q.z, ry: F.rot + (alongU ? 0 : Math.PI / 2), sx: len, sy: r.h, sz: r.w });
      F.col((r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2, alongU ? len : r.w, alongU ? r.w : len, 0, r.h);
    }
    instances(F.root, hedgeGeo(), cm(hex || EST.hedge), items);
  }
  let _urnG = null;
  function urnGeos() {
    if (_urnG) return _urnG;
    const urn = mergeGeos([
      (function () { const g = new THREE.BoxGeometry(0.8, 0.5, 0.8); g.translate(0, 0.25, 0); return g; })(),
      (function () { const g = new THREE.BoxGeometry(0.9, 0.08, 0.9); g.translate(0, 0.54, 0); return g; })(),
      lathe([[0, 0.58], [0.26, 0.58], [0.26, 0.64], [0.14, 0.72], [0.12, 0.84], [0.3, 0.94], [0.44, 1.12], [0.47, 1.3], [0.52, 1.34], [0.52, 1.4], [0.4, 1.4], [0, 1.36]], 18),
    ]);
    const shrub = new THREE.SphereGeometry(0.46, 12, 9); shrub.translate(0, 1.66, 0);
    return (_urnG = { urn: urn, shrub: shrub });
  }
  function urns(F, pts) {
    if (!pts.length) return;
    const G = urnGeos(), W = pts.map(function (p) { return F.p(p[0], p[1]); });
    repeat(F.root, G.urn, EST.urn, W, function () { return 0; });
    repeat(F.root, G.shrub, EST.topiary, W, function () { return 0; });
    for (const w of W) col(w.x, w.z, 0.8, 0.8, 0, 1.4);
  }
  function topiary(F, pts) {
    if (!pts.length) return;
    const g = new THREE.ConeGeometry(0.42, 1.5, 12); g.translate(0, 0.75, 0);
    const W = pts.map(function (p) { return F.p(p[0], p[1]); });
    repeat(F.root, g, EST.topiary, W, function () { return 0; });
    for (const w of W) col(w.x, w.z, 0.6, 0.6, 0, 1.5);
  }
  // TREES from the shared vegetation kit (leaf-card crowns, painted bark) —
  // the same trees the streets use, instanced, each with a trunk collider.
  function trees(F, pts, big) {
    if (!pts.length || !CBZ.treeTrunkGeo || !CBZ.treeCrownGeo) return 0;
    const VK = CBZ.vegetationKit;
    let trunk = null, crown = null;
    try {
      trunk = CBZ.treeTrunkGeo({ rTop: 0.14, rBase: 0.24, h: big ? 4.2 : 3.2, seg: 8, roots: 5, rise: 0.2, dip: 0.04, spread: 1.8, flare: 1.4, uvRepeat: 3, site: "estate" });
      crown = CBZ.treeCrownGeo({ tiers: 3, r: big ? 2.9 : 2.1, h: big ? 5.6 : 4.2, seg: 8, taper: 0.72, site: "estate", leaf: !!VK, cards: 18 });
    } catch (e) { return 0; }
    if (!trunk || !crown) return 0;
    const tm = VK ? VK.material("wood", 0x8c6a48) : cm(EST.bark);
    const crm = VK ? VK.material("foliage", 0x5a8a45) : cm(0x3f6e38);
    const ti = [], ci = [], feet = [], base = big ? 3.6 : 2.7;
    for (const p of pts) {
      const q = F.p(p[0], p[1]);
      const sc = 0.92 + h01(q.x, q.z, 0x7e5) * 0.22, ry = h01(q.x, q.z, 0x7e6) * 6.283;
      // the base sits on the PAD (YP) and the lawn (YG) covers its foot: seated 4 cm
      ti.push({ x: q.x, y: YP, z: q.z, ry: ry, sx: sc, sy: sc, sz: sc });
      ci.push({ x: q.x, y: base * sc, z: q.z, ry: ry, sx: sc, sy: sc, sz: sc });
      col(q.x, q.z, 0.5, 0.5, 0, 3.0);
      // a groundskeeper's mulch ring, and the crown's shade on the lawn
      feet.push(q.x, YG, q.z, (big ? 3.1 : 2.3) * sc, (big ? 1.2 : 0.95) * sc);
    }
    const a = instances(F.root, trunk, tm, ti);
    const b = instances(F.root, crown, crm, ci);
    if (CBZ.treeFoot) CBZ.treeFoot.add(F.root, feet, { name: "estate-trees" });
    if (VK && VK.depthMaterial && b) { const dm = VK.depthMaterial("foliage"); if (dm) b.customDepthMaterial = dm; }
    return ti.length;
  }

  /* ---- THE FOUNTAIN ------------------------------------------------------
     A basin with a moulded rim, a baluster pedestal, an upper dish and a jet.
     The two water surfaces stay at y 0.59 (r 3.45) and 1.63 (r 1.15): the
     regime dressing tints exactly those, and they are published on layout. */
  let _fountG = null;
  function fountain(root, x, z) {
    if (!_fountG) {
      _fountG = {
        basin: lathe([[3.45, 0.62], [3.62, 0.62], [3.95, 0.58], [4.12, 0.5], [4.12, 0.12], [4.3, 0.06], [4.3, 0], [3.2, 0], [3.2, 0.5], [3.45, 0.5]], 40),
        stem: lathe([[0, 0.5], [0.8, 0.5], [0.8, 0.62], [0.56, 0.72], [0.42, 0.9], [0.5, 1.15], [0.36, 1.36], [0.3, 1.48], [0, 1.48]], 24),
        dish: lathe([[0, 1.48], [0.3, 1.48], [0.9, 1.52], [1.3, 1.6], [1.42, 1.7], [1.42, 1.74], [1.15, 1.72], [1.15, 1.64], [0, 1.64]], 32),
        spout: lathe([[0, 1.63], [0.3, 1.63], [0.26, 1.8], [0.14, 2.1], [0.2, 2.34], [0.08, 2.46], [0, 2.52]], 16),
      };
    }
    for (const k of ["basin", "stem", "dish", "spout"]) {
      const m = new THREE.Mesh(_fountG[k], cm(k === "basin" ? M.stone : k === "dish" ? M.marble : M.stoneD));
      m.position.set(x, 0, z); m.castShadow = true; m.receiveShadow = true;
      m.matrixAutoUpdate = false; m.updateMatrix(); root.add(m);
    }
    disc(root, x, z, 3.45, M.pool, 0.59, 36);
    disc(root, x, z, 1.15, M.pool, 1.63, 24);
    for (const q of [[-0.7, 0], [0.7, 0], [0, -0.7], [0, 0.7]])
      cyl(root, x + q[0], 1.95, z + q[1], 0.04, 0.07, 0.8, 0xbfe3ee, 7);
    col(x, z, 8.4, 8.4, 0, 0.62);
    return { x: x, z: z, pools: [{ y: 0.59, r: 3.45 }, { y: 1.63, r: 1.15 }] };
  }

  /* ---- THE COLONNADE: a covered walk, columns both sides, flat roof ----- */
  let _colG = null;
  function colonnade(F, a, b, w) {
    if (!_colG) _colG = lathe([[0, 0], [0.34, 0], [0.34, 0.14], [0.26, 0.24], [0.22, 0.32], [0.2, 2.9], [0.24, 3.0], [0.3, 3.12], [0.34, 3.2], [0, 3.2]], 16);
    const alongU = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
    const len = alongU ? Math.abs(b[0] - a[0]) : Math.abs(b[1] - a[1]);
    const n = Math.max(1, Math.round(len / 3.2)), pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = a[0] + (b[0] - a[0]) * t, v = a[1] + (b[1] - a[1]) * t;
      for (const s of [-1, 1]) {
        const q = F.p(alongU ? u : u + s * (w / 2 - 0.35), alongU ? v + s * (w / 2 - 0.35) : v);
        pts.push(q);
      }
    }
    repeat(F.root, _colG, M.marble, pts, function () { return 0; });
    for (const q of pts) col(q.x, q.z, 0.6, 0.6, 0, 3.2);
    const um = (a[0] + b[0]) / 2, vm = (a[1] + b[1]) / 2;
    F.box(um, 3.36, vm, alongU ? len + 0.8 : w + 0.2, 0.32, alongU ? w + 0.2 : len + 0.8, M.stone);          // architrave + roof
    F.box(um, 3.6, vm, alongU ? len + 1.1 : w + 0.5, 0.16, alongU ? w + 0.5 : len + 1.1, M.stoneD, { cast: false }); // cornice
  }

  /* ---- THE HOUSE, DRESSED -------------------------------------------------
     OWNER (President mode, iPad): "that building is so low quality ... all
     the buildings in the presidential mode just need to be redone, inside
     and out." From outside the Mansion was a marble office block: a 26 m
     GLASS SHOPFRONT either side of the door (buildings.js glazes the whole
     door storey of any shell as a storefront), ten colossal columns on a
     pitch of their own standing across half the windows, a Capitol dome
     on a house, a plain parapet, no roof, no chimneys, and a back with
     nothing on it at all.

     houseDress() dresses a civic() shell FROM ITS OWN BUILT RECORD — the
     window panes it glazed (b.windows), the order it stood (b.civicOrder),
     its door, storey height and parapet — so no number here can drift from
     the building it hangs on:
       clad       the door storey becomes a RUSTICATED BASE: coursed stone
                  0.27 m proud of the shell, punched with windows on the
                  bays of the storey above (the shell's glass is now the
                  back of a deep reveal), a doorcase with pilasters, an
                  entablature, a segmental pediment, a lit fanlight, two
                  wall lanterns. Solid, cut round the column shafts (they
                  carry their own bodies).
       windows    keystones on the ground storey, alternating triangular
                  and segmental pediments with balustered aprons on the
                  principal floor.
       balustrade the parapet as a balustrade: a plinth on the cornice,
                  turned balusters (one instanced draw), dados on every
                  other pier of the bay rhythm, capped.
       roof       a hipped slate roof over the plate, inset 5.3 m so the
                  roof walk (and the counter-sniper stands on it) stays
                  clear, eaves cornice, lead ridge, solid.
       chimneys   stone stacks with bands, oversailing caps and pots.
       portico    a PROJECTING pedimented portico on the perron: free-
                  standing columns on an even ~4.8 m rhythm, entablature
                  returned to the wall, a coffered ceiling, a slate-roofed
                  pediment with the seal in its tympanum, a hanging
                  lantern, uplights at the column feet.
       south      the garden front's bowed portico: columns on a half
                  ring, a curved entablature, a balustraded roof, and a
                  balcony on the principal floor inside it.
     Everything is merged per material into the shell's own group (it is
     part of the building: demolition and the batcher treat it as such). */
  function shadeX(hex, f) {
    const r = Math.max(0, Math.min(255, (((hex >> 16) & 255) * f) | 0));
    const g = Math.max(0, Math.min(255, (((hex >> 8) & 255) * f) | 0));
    const b = Math.max(0, Math.min(255, ((hex & 255) * f) | 0));
    return (r << 16) | (g << 8) | b;
  }
  // a shell's face frame: s 0..3 = -z, +z, -x, +x; t runs along the face
  // (+x on the z faces, +z on the x faces), n is the distance out from the
  // shell centre
  function shellFaces(w, d) {
    return [0, 1, 2, 3].map(function (s) {
      const horiz = s < 2;
      return { s: s, horiz: horiz, out: (s === 0 || s === 2) ? -1 : 1, span: horiz ? w : d, halfN: (horiz ? d : w) / 2 };
    });
  }
  function facePt(f, t, n) { return f.horiz ? { x: t, z: f.out * n } : { x: f.out * n, z: t }; }
  function faceBoxK(kit, key, f, t, y, n, L, h, dn) {
    const q = facePt(f, t, n);
    kit.box(key, q.x, y, q.z, f.horiz ? L : dn, h, f.horiz ? dn : L);
  }
  // a box whose long (along-t) axis is tilted up toward +t by `ang`
  function faceSlant(kit, key, f, t, y, n, L, h, dn, ang) {
    const q = facePt(f, t, n);
    if (f.horiz) kit.box(key, q.x, y, q.z, L, h, dn, 0, ang, 0);
    else kit.box(key, q.x, y, q.z, dn, h, L, 0, 0, -ang);
  }
  // re-seat a geometry authored in (x = t, y = n out from `n0`, z = up) onto
  // face f at height y0 — winding flipped where the map is a mirror
  function seatOnFace(g, f, n0, y0, mirror) {
    if (g.index) g = g.toNonIndexed();
    const P = g.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const t = P.getX(i), nn = P.getY(i), up = P.getZ(i);
      const q = facePt(f, t, n0 + nn);
      P.setXYZ(i, q.x, y0 + up, q.z);
    }
    const det = (f.horiz ? -f.out : f.out) * (mirror ? -1 : 1);
    if (det < 0) {
      for (let i = 0; i < P.count; i += 3) {
        const x = P.getX(i + 1), y = P.getY(i + 1), z = P.getZ(i + 1);
        P.setXYZ(i + 1, P.getX(i + 2), P.getY(i + 2), P.getZ(i + 2));
        P.setXYZ(i + 2, x, y, z);
      }
    }
    P.needsUpdate = true;
    g.computeVertexNormals();
    return g;
  }
  function halfRing(r0, r1, h, seg) {
    const sh = new THREE.Shape();
    sh.absarc(0, 0, r1, 0, Math.PI, false);
    sh.absarc(0, 0, r0, Math.PI, 0, true);
    return new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false, curveSegments: seg || 28 });
  }
  function halfDisc(r, h) {
    const sh = new THREE.Shape();
    sh.moveTo(r, 0); sh.absarc(0, 0, r, 0, Math.PI, false); sh.lineTo(r, 0);
    return new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false, curveSegments: 28 });
  }
  // the glazed openings of a shell, per face and storey, merged from its
  // panes (a mullioned opening is several panes; a storefront band is one)
  function shellOpenings(b) {
    const WT = b.wt || 0.4, out = [[], [], [], []];
    for (const r of (b.windows || [])) {
      const lx = r.x - b.ox, lz = r.z - b.oz;
      let s = -1, t = 0, hw = 0;
      if (r.hd < 0.1 && Math.abs(Math.abs(lz) - (b.d / 2 - WT / 2)) < 0.4) { s = lz < 0 ? 0 : 1; t = lx; hw = r.hw; }
      else if (r.hw < 0.1 && Math.abs(Math.abs(lx) - (b.w / 2 - WT / 2)) < 0.4) { s = lx < 0 ? 2 : 3; t = lz; hw = r.hd; }
      if (s < 0) continue;
      const k = Math.max(0, Math.floor(r.y / b.FH));
      (out[s][k] = out[s][k] || []).push({ t0: t - hw, t1: t + hw, y0: r.y - r.hh, y1: r.y + r.hh });
    }
    for (const F of out) for (const k in F) {
      const L = F[k].sort(function (a, c) { return a.t0 - c.t0; }), M2 = [];
      for (const o of L) {
        const p = M2[M2.length - 1];
        if (p && o.t0 <= p.t1 + 0.12) { p.t1 = Math.max(p.t1, o.t1); p.y0 = Math.min(p.y0, o.y0); p.y1 = Math.max(p.y1, o.y1); }
        else M2.push({ t0: o.t0, t1: o.t1, y0: o.y0, y1: o.y1 });
      }
      F[k] = M2;
    }
    return out;
  }

  function houseDress(sh, D, o) {
    const b = sh && sh.b;
    if (!b || !b.group || !D) return null;
    o = o || {};
    const G = b.group, ox = b.ox, oz = b.oz, w = b.w, d = b.d, FH = b.FH;
    const rTop = b.h, pp = b.parapetH || 0.8;
    const ord = b.civicOrder || null;
    const ld = b.localDoor || { x: 0, z: d / 2, nx: 0, nz: -1 };
    const doorS = ld.nz < -0.5 ? 1 : ld.nz > 0.5 ? 0 : ld.nx < -0.5 ? 3 : 2;
    const FACE = shellFaces(w, d), fD = FACE[doorS];
    const WALL = b.wallColor || M.marble, TRIM = shadeX(WALL, 1.03), RUST = shadeX(WALL, 0.97);
    const SHADOW = shadeX(WALL, 0.42), COLC = shadeX(WALL, 1.05), SOFFIT = shadeX(WALL, 0.86);
    const kit = new Kit();
    const fb = function (key, f, t, y, n, L, h, dn) { faceBoxK(kit, key, f, t, y, n, L, h, dn); };
    const fc = function (f, t, n, L, dn, y0, y1) { const q = facePt(f, t, n); return col(ox + q.x, oz + q.z, f.horiz ? L : dn, f.horiz ? dn : L, y0, y1); };
    const OPEN = shellOpenings(b);
    const info = { clad: false, portico: null, south: null, roofTop: rTop };
    const lamps = [];                                   // {f, t, y, n}: wall lanterns
    const ups = [];                                     // {x, z, y}: uplights (shell-local)
    const deck = o.deck != null ? o.deck : (ord ? ord.deck : 0);

    // ---- the rusticated base on the door storey --------------------------
    const band = OPEN[doorS][0] || [];
    const bandW = band.reduce(function (a, q) { return a + q.t1 - q.t0; }, 0);
    const clad = D.clad !== false && bandW > fD.span * 0.4;
    if (clad) {
      info.clad = true;
      const hN = fD.halfN, TH = 0.2, RU = 0.07, y1c = FH - 0.24;
      // what hangs on this front must stand clear of the base: its face is
      // `out` proud of the shell wall, up to `top`
      info.base = { out: TH + RU, top: y1c };
      const dt = fD.horiz ? ld.x : ld.z;
      const doorO = { t0: dt - 1.1, t1: dt + 1.1, y0: 0, y1: 3.05, door: true };
      const wins = (OPEN[doorS][1] || []).map(function (q) { return { t0: q.t0, t1: q.t1, y0: q.y0 - FH, y1: q.y1 - FH }; })
        .filter(function (q) { return q.t1 < doorO.t0 - 0.6 || q.t0 > doorO.t1 + 0.6; });
      const holes = wins.concat([doorO]).sort(function (a, c) { return a.t0 - c.t0; });
      const colT = (ord && ord.face === doorS) ? ord.cols.slice().sort(function (a, c) { return a - c; }) : [];
      const colHalf = ord ? ord.R * 1.25 : 0;
      // bodies already standing against this base: the order's shafts, and
      // the cheek walls of a civic terrace (buildings_civic.js stands them
      // at +-(span/2 - 0.55), 0.55 wide) — the cladding is cut round both
      const cuts = colT.map(function (t) { return [t - colHalf, t + colHalf]; });
      if (o.terrace) for (const sg of [-1, 1]) { const t = sg * (fD.span / 2 - 0.55); cuts.push([t - 0.28, t + 0.28]); }
      cuts.sort(function (p, q) { return p[0] - q[0]; });
      const courses = [];
      for (let y = deck + 0.04; y < y1c - 0.12; y += 0.52) courses.push([y, Math.min(y + 0.44, y1c)]);
      const piece = function (t0, t1, ya, yb) {
        if (t1 - t0 < 0.02 || yb - ya < 0.02) return;
        fb(WALL, fD, (t0 + t1) / 2, (ya + yb) / 2, hN + TH / 2, t1 - t0, yb - ya, TH);
        for (const c of courses) {
          const a = Math.max(ya, c[0]), e = Math.min(yb, c[1]);
          if (e - a > 0.05) fb(RUST, fD, (t0 + t1) / 2, (a + e) / 2, hN + TH + RU / 2, t1 - t0, e - a, RU);
        }
      };
      const solidRun = function (t0, t1, ya, yb) {
        let a = t0;
        for (const cu of cuts) {
          if (cu[1] <= a || cu[0] >= t1) continue;
          if (cu[0] > a + 0.02) fc(fD, (a + cu[0]) / 2, hN + (TH + RU) / 2, cu[0] - a, TH + RU, ya, yb);
          a = Math.max(a, cu[1]);
        }
        if (t1 > a + 0.02) fc(fD, (a + t1) / 2, hN + (TH + RU) / 2, t1 - a, TH + RU, ya, yb);
      };
      let a = -fD.span / 2;
      for (const hO of holes) {
        piece(a, hO.t0, 0, y1c); solidRun(a, hO.t0, 0, y1c);
        piece(hO.t0, hO.t1, 0, hO.y0);
        if (hO.y0 > 0.5) solidRun(hO.t0, hO.t1, 0, hO.y0);
        piece(hO.t0, hO.t1, hO.y1, y1c);
        a = hO.t1;
        if (hO.door) continue;
        const tc = (hO.t0 + hO.t1) / 2, ww = hO.t1 - hO.t0;
        fb(TRIM, fD, tc, hO.y0 - 0.07, hN + 0.21, ww + 0.36, 0.14, 0.42);            // the sill
        for (let v = -2; v <= 2; v++) {                                                // a flat arch of five voussoirs
          const vw = (ww + 0.2) / 5;
          fb(v === 0 ? TRIM : RUST, fD, tc + v * vw, hO.y1 + 0.24 + (v === 0 ? 0.04 : 0), hN + TH + (v === 0 ? 0.1 : 0.05), vw - 0.04, v === 0 ? 0.56 : 0.44, v === 0 ? 0.2 : 0.1);
        }
      }
      piece(a, fD.span / 2, 0, y1c); solidRun(a, fD.span / 2, 0, y1c);
      // THE DOORCASE: pilasters, capitals, an entablature, a segmental
      // pediment; a transom bar and a lit fanlight over the leaf; the
      // shell's glass either side of the leaf reads as sidelights
      // Where the order already stands a column either side of the door
      // (an odd bay count puts two piers there), those shafts ARE the
      // doorcase's supports: the entablature and pediment span between them.
      const nO = hN + TH + RU;
      let near = Infinity;
      for (const ct of colT) near = Math.min(near, Math.abs(ct - dt));
      const framed = near - colHalf < 2.0;
      const half = framed ? near - colHalf - 0.02 : 1.7;
      if (!framed) for (const sg of [-1, 1]) {
        fb(TRIM, fD, dt + sg * 1.36, 3.2 / 2, nO + 0.1, 0.46, 3.2, 0.2);
        fb(COLC, fD, dt + sg * 1.36, 3.27, nO + 0.12, 0.56, 0.14, 0.24);
        fc(fD, dt + sg * 1.36, nO + 0.1, 0.46, 0.2, 0, 3.2);
      }
      fb(TRIM, fD, dt, 3.52, nO + 0.16, 2 * half, 0.36, 0.32);
      fb(COLC, fD, dt, 3.75, nO + 0.2, 2 * half + 0.3, 0.1, 0.4);
      info.doorPed = { f: fD, t: dt, y: 3.8, n: nO + 0.2, span: 2 * half + 0.2, rise: 0.36, dep: 0.36 };
      fb(TRIM, fD, dt, 2.36, hN + 0.06, 2.2, 0.08, 0.12);
      fb("lit:" + 0xffdfa6 + ":0.5", fD, dt, 2.72, hN + 0.03, 2.0, 0.62, 0.04);
      if (!framed) for (const sg of [-1, 1]) lamps.push({ f: fD, t: dt + sg * 2.25, y: 2.55, n: nO });
    }

    // ---- window dressings --------------------------------------------------
    const PG = pedimentGeos(), triI = [], segI = [];
    const pedAt = function (f, t, y, n, span, rise, dep, segm) {
      const q = facePt(f, t, n);
      (segm ? segI : triI).push({ x: q.x, y: y, z: q.z, ry: f.horiz ? 0 : Math.PI / 2, sx: span, sy: rise, sz: dep });
    };
    if (D.windows !== false) {
      for (const f of FACE) {
        const L = OPEN[f.s];
        for (const k in L) {
          const kk = +k;
          if (clad && f.s === doorS && kk === 0) continue;
          const ops = L[k], c = (ops.length - 1) / 2;
          for (let i = 0; i < ops.length; i++) {
            const q = ops[i], tc = (q.t0 + q.t1) / 2, ww = q.t1 - q.t0, hN = f.halfN;
            if (ww > 4.5) continue;                                   // a band, not a window
            if (kk === 0) {
              fb(TRIM, f, tc, q.y1 + 0.3, hN + 0.12, 0.38, 0.58, 0.24);           // keystone
            } else if (kk === 1) {
              if (q.y1 + 0.72 > (kk + 1) * FH - 0.12) continue;
              fb(TRIM, f, tc, q.y1 + 0.35, hN + 0.15, ww + 0.8, 0.1, 0.3);         // the pediment's bed moulding
              pedAt(f, tc, q.y1 + 0.4, hN + 0.15, ww + 0.7, Math.floor(Math.abs(i - c)) % 2 ? 0.24 : 0.3, 0.28, Math.floor(Math.abs(i - c)) % 2 === 1);
              fb(TRIM, f, tc, q.y0 - 0.74, hN + 0.03, ww - 0.1, 0.36, 0.06);       // the apron
              fb(RUST, f, tc, q.y0 - 0.74, hN + 0.07, ww - 0.44, 0.2, 0.03);
            } else if (q.y1 + 0.55 < rTop - 0.7) {
              fb(TRIM, f, tc, q.y1 + 0.42, hN + 0.14, ww + 0.62, 0.12, 0.28);      // a cornice hood
            }
          }
        }
      }
    }
    if (info.doorPed) { const p = info.doorPed; pedAt(p.f, p.t, p.y, p.n, p.span, p.rise, p.dep, true); }

    // the portico's column line, solved here because the balustrade has to
    // stop either side of its pediment
    const R0 = ord ? Math.max(ord.R, ord.orderH / 18) : 0.5;
    let POUT = 0, PGAP = 0;
    if (D.portico && ord && ord.face === doorS) {
      const want = Math.min(fD.span * 0.225, D.portico.half || 12);
      POUT = want;
      if (ord.cols.length) { let best = Infinity; for (const t of ord.cols) { const e = Math.abs(Math.abs(t) - want); if (e < best) { best = e; POUT = Math.abs(t); } } }
      PGAP = POUT + R0 * 1.3 + 0.55 + 0.3;                    // the pediment's half span + a dado
    }

    // ---- the balustrade on the parapet --------------------------------------
    const bals = [];
    if (D.balustrade) {
      const yb0 = rTop + 0.08, yb1 = rTop + pp;
      for (const f of FACE) {
        const hN = f.halfN, span = f.span;
        const st = [-span / 2 + 0.32, span / 2 - 0.32];
        const gap = (f.s === doorS && PGAP > 0) ? PGAP : 0;
        if (gap) st.push(-gap, gap);
        const B = CBZ.civicBays ? CBZ.civicBays(span) : null;
        if (B) for (let i = 0; i <= B.nBay; i++) {
          if (Math.round(Math.abs(i - B.nBay / 2) * 2) % 4 !== (B.nBay % 2 ? 1 : 0)) continue;
          if (Math.abs(B.piers[i]) < span / 2 - 1.4 && Math.abs(B.piers[i]) > gap + 1.2) st.push(B.piers[i]);
        }
        st.sort(function (a, c) { return a - c; });
        fb(TRIM, f, 0, rTop, hN + 0.15, span + 0.3, 0.16, 0.3);                       // plinth on the cornice
        if (!gap) fb(SHADOW, f, 0, (yb0 + yb1) / 2, hN + 0.012, span - 0.2, yb1 - yb0, 0.024);   // the shadow behind the balusters
        else for (const sg of [-1, 1]) { const a0 = gap, a1 = span / 2 - 0.1; fb(SHADOW, f, sg * (a0 + a1) / 2, (yb0 + yb1) / 2, hN + 0.012, a1 - a0, yb1 - yb0, 0.024); }
        for (const t of st) {
          fb(TRIM, f, t, (yb0 + yb1) / 2, hN + 0.17, 0.5, yb1 - yb0, 0.34);
          fb(COLC, f, t, yb1 + 0.18, hN + 0.19, 0.6, 0.12, 0.38);
        }
        for (let j = 0; j + 1 < st.length; j++) {
          if (gap && st[j] === -gap) continue;                    // behind the pediment
          const a0 = st[j] + 0.33, a1 = st[j + 1] - 0.33, len = a1 - a0;
          const nb = Math.max(1, Math.floor(len / 0.27));
          for (let i = 0; i < nb; i++) {
            const q = facePt(f, a0 + (i + 0.5) * len / nb, hN + 0.15);
            bals.push({ x: q.x, y: yb0, z: q.z, sy: yb1 - yb0 });
          }
        }
      }
    }

    // ---- the roof and its chimneys -------------------------------------------
    let roofBase = rTop, roofTop = rTop;
    const RW = w - 2 * (D.roofInset || 5.3), RD = d - 2 * (D.roofInset || 5.3);
    if (D.roof === "hip" && RW > 4 && RD > 4) {
      const e1 = rTop + 0.6;
      kit.box(WALL, 0, (rTop + e1) / 2, 0, RW, e1 - rTop, RD);                       // the attic the roof sits on
      kit.box(TRIM, 0, e1 + 0.09, 0, RW + 0.6, 0.18, RD + 0.6);                     // eaves cornice
      const base = e1 + 0.18, hx = RW / 2 + 0.2, hz = RD / 2 + 0.2;
      const along = hx >= hz, a = along ? hx : hz, c = along ? hz : hx;
      const rise = c * (D.pitch || 0.36), top = base + rise;
      const pos = [], uv = [], T = SURF.slate.tile;
      // one slope: a polygon of (along, across) corners, UV = along / slope distance
      const tri = function (p, q2, s2) {
        const ux = q2[0] - p[0], uy = q2[1] - p[1], uz = q2[2] - p[2], vx = s2[0] - p[0], vy = s2[1] - p[1], vz = s2[2] - p[2];
        const ny = uz * vx - ux * vz;
        const L = ny >= 0 ? [p, q2, s2] : [p, s2, q2];
        for (const v of L) pos.push(v[0], v[1], v[2]);
        return L;
      };
      const X = function (al, ac, y) { return along ? [al, y, ac] : [ac, y, al]; };
      const slopeLen = Math.hypot(c, rise);
      const pushUV = function (L, alongAxis, sgn) {
        for (const v of L) {
          const al = along ? v[0] : v[2], ac = along ? v[2] : v[0];
          const up = (v[1] - base) / rise * slopeLen;
          uv.push((alongAxis ? al : ac) / T, (up + (sgn > 0 ? 0 : 0.37)) / T);
        }
      };
      for (const sg of [-1, 1]) {
        // the long slopes (trapezoids) and the hips (triangles)
        const p0 = X(-a, sg * c, base), p1 = X(a, sg * c, base), p2 = X(a - c, 0, top), p3 = X(-(a - c), 0, top);
        pushUV(tri(p0, p1, p2), true, sg); pushUV(tri(p0, p2, p3), true, sg);
        const q0 = X(sg * a, -c, base), q1 = X(sg * a, c, base), q2 = X(sg * (a - c), 0, top);
        pushUV(tri(q0, q1, q2), false, sg);
      }
      const rg = new THREE.BufferGeometry();
      rg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      rg.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      rg.computeVertexNormals();
      kit.add("slate~uv", rg);
      // the lead ridge
      if (a - c > 0.1) kit.box(0x3b3f45, along ? 0 : 0, top + 0.05, 0, along ? 2 * (a - c) + 0.3 : 0.3, 0.14, along ? 0.3 : 2 * (a - c) + 0.3);
      col(ox, oz, RW, RD, rTop, base + rise * 0.55);
      roofBase = base + rise * 0.55; roofTop = top;
      info.roofTop = top;
    }
    const nCh = D.chimneys | 0;
    if (nCh > 0) {
      const hip = D.roof === "hip" && RW > 4 && RD > 4;
      const cx0 = hip ? Math.max(1.5, RW / 2 * 0.56) : w / 2 - 4.2, cz0 = hip ? RD / 4 : d / 2 - 3.2;
      const topC = hip ? roofTop + 1.3 : rTop + 2.4;
      const baseC = hip ? rTop + 0.6 : rTop;
      const slots = nCh >= 4 ? [[-1, -1], [1, -1], [-1, 1], [1, 1]] : [[-1, -1], [1, 1]];
      for (let i = 0; i < Math.min(nCh, slots.length); i++) {
        const x = slots[i][0] * cx0, z = slots[i][1] * cz0 * (hip ? 1 : 0.2);
        const SW = 2.6, SD = 1.0;
        kit.box(WALL, x, (baseC + topC) / 2, z, SW, topC - baseC, SD);
        kit.box(TRIM, x, topC - 0.62, z, SW + 0.14, 0.14, SD + 0.14);
        kit.box(TRIM, x, topC + 0.08, z, SW + 0.3, 0.16, SD + 0.3);
        for (const p of [-0.75, 0, 0.75]) kit.geo(0x9a5c43, chimneyPotGeo(), x + p, topC + 0.16, z);
        col(ox + x, oz + z, SW, SD, hip ? roofBase : rTop, topC + 0.16);
      }
    }

    // ---- the portico ---------------------------------------------------------
    if (POUT > 0) {
      const f = fD, hN = f.halfN, PO = D.portico, outer = POUT;
      const m = Math.max(1, Math.round((outer + 2) / 4)), n = 2 * m;
      const step = 2 * outer / (n - 1);
      const R = R0, capTop = ord.entY, base = ord.deck;
      const depth = Math.min(PO.depth || 7, (o.deckDepth || 99) - R * 1.3 - 0.1);
      const nF = hN + depth;
      const cg = columnGeo(R, capTop - base, !!D.ionic);
      const colI = [];
      const put = function (t, nn) {
        const q = facePt(f, t, nn);
        colI.push({ x: q.x, y: base, z: q.z });
        fc(f, t, nn, R * 2.4, R * 2.4, 0, capTop);
      };
      for (let i = 0; i < n; i++) put(-outer + i * step, nF);
      if (depth > 4.2) for (const sg of [-1, 1]) put(sg * outer, hN + depth * 0.45);
      instances(G, cg, cm(COLC), colI);
      // uplights at the column feet, on the deck beside each plinth (the
      // deck ends a hand's width in front of the plinths)
      for (let i = 0; i < n; i++) { const t = -outer + i * step, q = facePt(f, t + (t < 0 ? 1 : -1) * (R * 1.25 + 0.25), nF + R * 0.6); ups.push({ x: q.x, z: q.z, y: base }); }
      // the entablature, returned along both flanks to the wall
      const EW = outer + R * 1.3 + 0.3;                       // = PGAP - 0.55 (the balustrade's stop)
      const beam = function (key, yC, h, dep, extra) {
        fb(key, f, 0, yC, nF, 2 * (EW + extra), h, dep);
        for (const sg of [-1, 1]) {
          const len = nF - hN + dep / 2, q = facePt(f, sg * (outer + (extra > 0 ? extra * 0.5 : 0)), hN + len / 2);
          kit.box(key, q.x, yC, q.z, f.horiz ? dep : len, h, f.horiz ? len : dep);
        }
      };
      beam(TRIM, capTop + 0.18, 0.26, R * 2.3, 0);
      beam(RUST, capTop + 0.56, 0.46, R * 2.1, 0);
      beam(COLC, capTop + 0.94, 0.24, R * 2.3 + 0.5, 0.25);
      if (ord.deck != null && D.ionic !== true) {                        // doric triglyphs on the front frieze
        const tn = Math.max(4, Math.round(2 * EW / 1.2));
        for (let i = 0; i <= tn; i++) fb(COLC, f, -EW + 0.2 + i * (2 * EW - 0.4) / tn, capTop + 0.56, nF + R * 1.05 + 0.02, 0.26, 0.46, 0.06);
      }
      // the coffered ceiling, at the architrave soffit
      const cy = capTop + 0.05;
      fb(SOFFIT, f, 0, cy + 0.42, (hN + nF) / 2, 2 * outer - R * 2, 0.16, depth - R * 1.2);
      const nr = Math.max(2, Math.round(depth / 2.4));
      for (let i = 1; i < nr; i++) fb(TRIM, f, 0, cy + 0.2, hN + i * (depth / nr), 2 * outer - R * 2, 0.3, 0.22);
      for (let i = 1; i < n - 1; i++) {
        const t = -outer + i * step, q = facePt(f, t, (hN + nF) / 2);
        kit.box(TRIM, q.x, cy + 0.2, q.z, f.horiz ? 0.22 : depth - R * 1.2, 0.3, f.horiz ? depth - R * 1.2 : 0.22);
      }
      // THE PEDIMENT: a gable over the portico, slate on its slopes, a
      // recessed tympanum with the seal, raking cornices
      const yb = capTop + 1.06, PW = EW + 0.25, rise = PW * Math.tan(13.5 * Math.PI / 180);
      // the tympanum stands 0.45 behind the raking cornice, whose face is
      // flush with the horizontal cornice's (both R*1.15 + 0.25 out)
      const n1 = nF + R * 1.15 + 0.25, n0 = hN - 0.02;
      const gl = new THREE.Shape();
      gl.moveTo(-PW, 0); gl.lineTo(PW, 0); gl.lineTo(0, rise); gl.lineTo(-PW, 0);
      // the gable mass, extruded from the wall to the tympanum
      const gm = new THREE.ExtrudeGeometry(gl, { depth: n1 - 0.45 - n0, bevelEnabled: false });
      // ExtrudeGeometry: shape in x/y, depth along +z → remap (x=t, y=up, z=n)
      const P2 = gm.attributes.position;
      for (let i = 0; i < P2.count; i++) { const tx = P2.getX(i), up = P2.getY(i), nn = P2.getZ(i); P2.setXYZ(i, tx, nn, up); }
      kit.add(TRIM, seatOnFace(gm, f, n0, yb, true));          // the y/z swap above is a mirror
      const slopeL = Math.hypot(PW, rise) + 0.35, ang = Math.atan2(rise, PW);
      for (const sg of [-1, 1]) {
        // raking cornice on the front, and the slate slope over the gable
        faceSlant(kit, COLC, f, sg * PW / 2, yb + rise / 2 + 0.12, n1 - 0.25, slopeL, 0.26, 0.5, -sg * ang);
        const t0 = sg > 0 ? 0 : -PW - 0.2, t1 = sg > 0 ? PW + 0.2 : 0;
        const yA = function (t) { return yb + rise * (1 - Math.abs(t) / PW) + 0.03; };
        const q = new THREE.BufferGeometry();
        const cN = [n0, n1 + 0.1];
        const vs = [[t0, cN[0], yA(t0)], [t1, cN[0], yA(t1)], [t1, cN[1], yA(t1)], [t0, cN[0], yA(t0)], [t1, cN[1], yA(t1)], [t0, cN[1], yA(t0)]];
        const pa = [], ua = [];
        for (const v of vs) { pa.push(v[0], v[1], v[2] - yb); ua.push(v[0] / 2.4, (v[1] + (yA(v[0]) - yb) * 1.2) / 2.4); }
        q.setAttribute("position", new THREE.Float32BufferAttribute(pa, 3));
        q.setAttribute("uv", new THREE.Float32BufferAttribute(ua, 2));
        let g2 = seatOnFace(q, f, 0, yb);
        // both slopes must face up: flip where they do not
        g2.computeVertexNormals();
        if (g2.attributes.normal.getY(0) < 0) {
          const PP = g2.attributes.position, UU = g2.attributes.uv;
          for (let i = 0; i < PP.count; i += 3) {
            const x = PP.getX(i + 1), y = PP.getY(i + 1), z = PP.getZ(i + 1), u = UU.getX(i + 1), v = UU.getY(i + 1);
            PP.setXYZ(i + 1, PP.getX(i + 2), PP.getY(i + 2), PP.getZ(i + 2)); UU.setXY(i + 1, UU.getX(i + 2), UU.getY(i + 2));
            PP.setXYZ(i + 2, x, y, z); UU.setXY(i + 2, u, v);
          }
          g2.computeVertexNormals();
        }
        kit.add("slate~uv", g2);
      }
      // the seal in the tympanum
      if (CBZ.civicSealTex) {
        try {
          const sr = Math.min(1.15, rise * 0.34);
          const sm = new THREE.Mesh(new THREE.PlaneGeometry(sr * 2, sr * 2), new THREE.MeshBasicMaterial({ map: CBZ.civicSealTex(D.seal || "mansion"), transparent: true }));
          const q = facePt(f, 0, n1 - 0.43);
          sm.position.set(q.x, yb + rise * 0.4, q.z);
          sm.rotation.y = f.horiz ? (f.out > 0 ? 0 : Math.PI) : (f.out > 0 ? Math.PI / 2 : -Math.PI / 2);
          sm.renderOrder = 2; G.add(sm);
        } catch (e) { /* headless */ }
      }
      // the hanging lantern, on the door axis, clear of the balcony below
      {
        const q = facePt(f, 0, hN + Math.max(4.6, depth * 0.72)), yl = Math.max(FH + 3.0, 7.2);
        kit.box(0x24282c, q.x, (yl + 0.9 + cy) / 2, q.z, 0.05, cy - yl - 0.9, 0.05);
        kit.box(0x24282c, q.x, yl + 0.86, q.z, 0.5, 0.1, 0.5);
        kit.box("lit:" + 0xffe0a8 + ":0.85", q.x, yl + 0.45, q.z, 0.4, 0.7, 0.4);
        kit.box(0x24282c, q.x, yl + 0.05, q.z, 0.46, 0.1, 0.46);
      }
      info.portico = { cols: n, outer: outer, depth: depth, top: yb + rise, R: R };
    }
    // uplights at the feet of the engaged order
    if (ord && ord.face === doorS && D.uplights !== false) {
      for (const t of ord.cols) { const q = facePt(fD, t, ord.colN + ord.R * 1.25 + 0.3); ups.push({ x: q.x, z: q.z, y: ord.deck }); }
    }

    // ---- the garden front's bowed portico, with its balcony -------------------
    if (D.south && ord) {
      const f = FACE[doorS ^ 1], hN = f.halfN, S = D.south;
      const r = S.r || 5.6, nC = S.n || 6, R = R0 * 0.92, base = YS, capTop = ord.entY;
      const cg = columnGeo(R, capTop - base, !!D.ionic), colI = [];
      for (let i = 0; i < nC; i++) {
        const th = (i + 0.5) / nC * Math.PI, t = -r * Math.cos(th), nn = hN + r * Math.sin(th);
        const q = facePt(f, t, nn);
        colI.push({ x: q.x, y: base, z: q.z });
        fc(f, t, nn, R * 2.0, R * 2.0, 0, capTop);          // the shaft on its base (an AABB on a ring)
        const u2 = facePt(f, t * (r + R * 1.25 + 0.3) / r, hN + (nn - hN) * (r + R * 1.25 + 0.3) / r);
        ups.push({ x: u2.x, z: u2.z, y: base });
      }
      instances(G, cg, cm(COLC), colI);
      const rIn = r - R * 1.2, rOut = r + R * 1.2;
      kit.add(TRIM, seatOnFace(halfRing(rIn, rOut, 0.78, 32), f, hN, capTop + 0.05));
      kit.add(COLC, seatOnFace(halfRing(rIn - 0.1, rOut + 0.35, 0.24, 32), f, hN, capTop + 0.83));
      kit.add(SOFFIT, seatOnFace(halfDisc(rIn, 0.2), f, hN, capTop + 0.63));
      kit.add(TRIM, seatOnFace(halfDisc(rOut + 0.2, 0.16), f, hN, capTop + 1.07));
      // a balustrade round the roof of the bow
      const rb = rOut - 0.05, yr = capTop + 1.23, bh = 0.72;
      const na = Math.max(8, Math.floor(Math.PI * rb / 0.28));
      for (let i = 0; i < na; i++) {
        const th = (i + 0.5) / na * Math.PI, q = facePt(f, -rb * Math.cos(th), hN + rb * Math.sin(th));
        bals.push({ x: q.x, y: yr, z: q.z, sy: bh });
      }
      kit.add(COLC, seatOnFace(halfRing(rb - 0.16, rb + 0.16, 0.1, 32), f, hN, yr + bh));
      // THE BALCONY, on the principal floor inside the columns
      const fl = Array.isArray(b.floorTops) ? b.floorTops[1] : null;
      if (fl != null && fl < capTop - 3) {
        const top = fl + 0.15, rd = rIn - 0.15;
        kit.add(TRIM, seatOnFace(halfDisc(rd, 0.3), f, hN, top - 0.3));
        kit.add(RUST, seatOnFace(halfRing(rd - 0.02, rd + 0.12, 0.16, 32), f, hN, top - 0.46));
        const rr = rd - 0.25, nb2 = Math.max(8, Math.floor(Math.PI * rr / 0.26));
        for (let i = 0; i < nb2; i++) {
          const th = (i + 0.5) / nb2 * Math.PI, q = facePt(f, -rr * Math.cos(th), hN + rr * Math.sin(th));
          bals.push({ x: q.x, y: top, z: q.z, sy: 0.86 });
        }
        kit.add(COLC, seatOnFace(halfRing(rr - 0.14, rr + 0.14, 0.1, 32), f, hN, top + 0.86));
        // its rail holds you (an arc of short bodies) and its floor carries
        // you: strips inscribed inside the rail, so the walk never overhangs
        const segs = 20;
        for (let i = 0; i < segs; i++) {
          const a0 = i / segs * Math.PI, a1 = (i + 1) / segs * Math.PI;
          const p0 = facePt(f, -rr * Math.cos(a0), hN + rr * Math.sin(a0)), p1 = facePt(f, -rr * Math.cos(a1), hN + rr * Math.sin(a1));
          const cxr = (p0.x + p1.x) / 2, czr = (p0.z + p1.z) / 2;
          const ew = Math.max(0.12, Math.abs(p1.x - p0.x)), ed = Math.max(0.12, Math.abs(p1.z - p0.z));
          col(ox + cxr, oz + czr, ew, ed, top, top + 0.96);
        }
        const strips = 4, ri = rr - 0.2;
        for (let j = 0; j < strips; j++) {
          const n0 = j * ri / strips, n1 = (j + 1) * ri / strips, half = Math.sqrt(Math.max(0, ri * ri - n1 * n1));
          if (half < 0.3) continue;
          const q = facePt(f, 0, hN + (n0 + n1) / 2);
          plat(ox + q.x, oz + q.z, f.horiz ? 2 * half : n1 - n0, f.horiz ? n1 - n0 : 2 * half, top);
        }
        info.southBalcony = { top: top, r: rr };
      }
      info.south = { r: r, cols: nC };
    }

    // ---- the lights: uplights and wall lanterns --------------------------------
    for (const u of ups) {
      kit.box(0x26292d, u.x, u.y + 0.06, u.z, 0.3, 0.12, 0.3);
      kit.box("lit:" + 0xffe6b8 + ":0.9", u.x, u.y + 0.125, u.z, 0.2, 0.012, 0.2);
    }
    for (const L of lamps) {
      const q = facePt(L.f, L.t, L.n + 0.14), qb = facePt(L.f, L.t, L.n + 0.06);
      kit.box(0x24282c, qb.x, L.y - 0.1, qb.z, L.f.horiz ? 0.08 : 0.14, 0.08, L.f.horiz ? 0.14 : 0.08);
      kit.box(0x24282c, q.x, L.y + 0.33, q.z, 0.3, 0.08, 0.3);
      kit.box("lit:" + 0xffdfa0 + ":0.85", q.x, L.y + 0.08, q.z, 0.24, 0.42, 0.24);
      kit.box(0x24282c, q.x, L.y - 0.16, q.z, 0.28, 0.08, 0.28);
    }

    if (triI.length) instances(G, PG.tri, cm(TRIM), triI);
    if (segI.length) instances(G, PG.seg, cm(TRIM), segI);
    if (bals.length) instances(G, balusterGeo(), cm(TRIM), bals, false);
    kit.flush(G, "house");
    return info;
  }
  let _potG = null;
  function chimneyPotGeo() {
    return _potG || (_potG = lathe([[0, 0], [0.16, 0], [0.16, 0.06], [0.13, 0.1], [0.14, 0.42], [0.17, 0.46], [0.17, 0.52], [0.11, 0.52], [0.11, 0.2], [0, 0.2]], 10));
  }

  /* ---- THE MOTOR POOL -------------------------------------------------------
     A head of state's cars live in a garage, not on the lawn. The Governor's
     "garage" was a 1-storey shell with buildings.js's flagship parking deck
     on it: glass on all four sides. This is a real one: a stone block of
     drive-in bays on the court side, each with a sectional door (some
     raised under the ceiling on their tracks, some down and solid), a
     concrete floor at the apron's own level so a car rolls straight in (the
     floor is the estate ground there, and a walk platform), coursed ashlar
     walls with a side door and high windows, a flat roof behind a parapet,
     a strip light over every bay, a workbench and a tool chest at the back.
     `G` is gate-up frame metres: {u, v, w (across the doors' axis), d (along
     the door face), bays}. The doors face the house. */
  function motorPool(F, G, EG) {
    const root = F.root;
    const toHouse = Math.sign(-G.u) || 1;
    const c = F.p(G.u, G.v), R = F.wr(G.u - G.w / 2, G.v - G.d / 2, G.u + G.w / 2, G.v + G.d / 2);
    const x = c.x, z = c.z, wW = R.maxX - R.minX, dW = R.maxZ - R.minZ;
    const fp = F.p(G.u + toHouse, G.v);
    const nf = { x: Math.round(fp.x - c.x), z: Math.round(fp.z - c.z) };
    const H = G.h || 4.4, T = 0.3, FL = YS, CLR = 2.9;
    const alongX = Math.abs(nf.z) > 0.5;
    const faceLen = alongX ? wW : dW, halfN = (alongX ? dW : wW) / 2;
    const nb = G.bays || 4, pier = 0.8, bayW = (faceLen - (nb + 1) * pier) / nb;
    const at = function (t, n) { return alongX ? { x: x + t, z: z + nf.z * n } : { x: x + nf.x * n, z: z + t }; };
    const B = function (t, y, n, L, h, dn, hex, o) { const q = at(t, n); return box(root, q.x, y, q.z, alongX ? L : dn, h, alongX ? dn : L, hex, o); };
    const C = function (t, n, L, dn, y0, y1) { const q = at(t, n); return col(q.x, q.z, alongX ? L : dn, alongX ? dn : L, y0, y1); };
    // the floor
    box(root, x, FL / 2, z, wW - 0.02, FL, dW - 0.02, 0x7b7c79, { cast: false });
    plat(x, z, wW - 2 * T, dW - 2 * T, FL);
    if (EG) EG.rects.push({ minX: R.minX, maxX: R.maxX, minZ: R.minZ, maxZ: R.maxZ, y: FL });
    // THE DOOR FACE: piers, a header over the bays, a sectional door per bay
    const nD = halfN - T / 2, doors = [];
    const openSet = G.open || [0, 1];
    for (let i = 0; i <= nb; i++) {
      const t = -faceLen / 2 + pier / 2 + i * (pier + bayW);
      B(t, CLR / 2, nD, pier, CLR, T + 0.06, M.stone);
      C(t, nD, pier, T + 0.06, 0, CLR);
    }
    B(0, (CLR + H) / 2, nD, faceLen, H - CLR, T, M.stone);
    C(0, nD, faceLen, T, CLR, H);
    B(0, CLR + 0.1, nD + T / 2 + 0.04, faceLen - 0.2, 0.2, 0.1, M.stoneD, { cast: false });   // the lintel course
    const kitUp = new Kit();
    for (let i = 0; i < nb; i++) {
      const t = -faceLen / 2 + pier + bayW / 2 + i * (pier + bayW);
      const open = openSet.indexOf(i) >= 0;
      doors.push({ bay: i, open: open, at: at(t, halfN) });
      if (!open) {
        B(t, (FL + CLR) / 2, nD, bayW, CLR - FL, 0.06, 0xd9d5cb);
        for (let k = 1; k < 4; k++) B(t, FL + k * (CLR - FL) / 4, nD + 0.035, bayW - 0.04, 0.03, 0.02, 0xb9b5ab, { cast: false });
        B(t, FL + 0.5, nD + 0.05, 0.3, 0.05, 0.04, M.steel, { cast: false });
        C(t, nD, bayW, 0.12, 0, CLR);
      } else {
        // the raised door, parked flat under the ceiling on its two tracks
        const len = CLR - FL, n0 = nD - T / 2;
        const qp = at(t, n0 - len / 2);
        kitUp.box(0xd9d5cb, qp.x, CLR + 0.14, qp.z, alongX ? bayW : len, 0.05, alongX ? len : bayW);
        for (const sg of [-1, 1]) {
          const qt = at(t + sg * (bayW / 2 - 0.03), n0 - (len + 0.3) / 2);
          kitUp.box(0x4d5157, qt.x, CLR + 0.09, qt.z, alongX ? 0.06 : len + 0.3, 0.06, alongX ? len + 0.3 : 0.06);
        }
      }
    }
    // THE OTHER THREE WALLS: coursed ashlar, merged per face; a side door and
    // high windows
    const sides = [{ x: -nf.z, z: nf.x }, { x: nf.z, z: -nf.x }, { x: -nf.x, z: -nf.z }];
    for (let k = 0; k < 3; k++) {
      const f = sides[k], fAlongX = Math.abs(f.z) > 0.5;
      const span = fAlongX ? wW : dW - 2 * T;
      const opens = [];
      if (k < 2) {
        opens.push({ t: -span / 4, w: 1.2, y0: 2.1, y1: 3.1 }, { t: span / 4, w: 1.2, y0: 2.1, y1: 3.1 });
        if (k === 0) opens.push({ t: 0, w: 0.96, y0: 0, y1: FL + 2.12, door: true });
      } else {
        for (const tt of [-faceLen / 3, 0, faceLen / 3]) opens.push({ t: tt, w: 1.4, y0: 2.2, y1: 3.1 });
      }
      const kw = new Kit();
      const Wf = wallFace(kw, "ashlar", x, z, f, wW, dW, T, 0, H, opens, true);
      const po = Wf.off + T / 2;
      for (const o2 of opens) {
        const q = fAlongX ? { x: x + o2.t, z: z + f.z * (po - T / 2) } : { x: x + f.x * (po - T / 2), z: z + o2.t };
        if (o2.door) {
          const qd = fAlongX ? { x: x + o2.t + o2.w / 2 + 0.52, z: z + f.z * (po + 0.03) } : { x: x + f.x * (po + 0.03), z: z + o2.t + o2.w / 2 + 0.52 };
          kw.box(0x3d4a52, qd.x, FL + 1.03, qd.z, fAlongX ? 0.9 : 0.05, 2.02, fAlongX ? 0.05 : 0.9);
          const ql = fAlongX ? { x: x + o2.t, z: z + f.z * (po + 0.04) } : { x: x + f.x * (po + 0.04), z: z + o2.t };
          kw.box(M.stoneD, ql.x, o2.y1 + 0.1, ql.z, fAlongX ? o2.w + 0.4 : 0.08, 0.2, fAlongX ? 0.08 : o2.w + 0.4);
          continue;
        }
        kw.box("glass" + k, q.x, (o2.y0 + o2.y1) / 2, q.z, fAlongX ? o2.w : 0.03, o2.y1 - o2.y0, fAlongX ? 0.03 : o2.w);
        const qs = fAlongX ? { x: x + o2.t, z: z + f.z * (po + 0.06) } : { x: x + f.x * (po + 0.06), z: z + o2.t };
        kw.box(M.stone, qs.x, o2.y0 - 0.05, qs.z, fAlongX ? o2.w + 0.3 : 0.14, 0.1, fAlongX ? 0.14 : o2.w + 0.3);
      }
      kw.flush(root, "garage-wall");
    }
    // cornice, roof slab, parapet and its coping
    box(root, x, H - 0.12, z, wW + 0.3, 0.2, dW + 0.3, M.stoneD, { cast: false });
    box(root, x, H + 0.05, z, wW, 0.3, dW, 0x6f6c66);
    for (const s of [-1, 1]) {
      box(root, x, H + 0.45, z + s * (dW / 2 - 0.15), wW, 0.5, 0.3, M.stone);
      box(root, x + s * (wW / 2 - 0.15), H + 0.45, z, 0.3, 0.5, dW - 0.6, M.stone);
      box(root, x, H + 0.74, z + s * (dW / 2 - 0.15), wW + 0.12, 0.08, 0.42, M.stoneD, { cast: false });
      box(root, x + s * (wW / 2 - 0.15), H + 0.74, z, 0.42, 0.08, dW - 0.6, M.stoneD, { cast: false });
    }
    // strip lights, one over every bay
    for (let i = 0; i < nb; i++) {
      const t = -faceLen / 2 + pier + bayW / 2 + i * (pier + bayW), q = at(t, 0);
      kitUp.box("lit:" + 0xf4f6ff + ":0.9", q.x, H - 0.13, q.z, alongX ? 0.16 : 1.8, 0.05, alongX ? 1.8 : 0.16);
    }
    kitUp.flush(root, "garage-over");
    // the back: a workbench under a tool board, and a tool chest
    const kb = new Kit(), nBk = -halfN + T;
    const bench = at(-faceLen / 4, nBk + 0.36);
    kb.box(0x6b5236, bench.x, FL + 0.87, bench.z, alongX ? 3.0 : 0.7, 0.06, alongX ? 0.7 : 3.0);
    for (const sg of [-1, 1]) {
      const lg = at(-faceLen / 4 + sg * 1.42, nBk + 0.36);
      kb.box(0x3c4046, lg.x, FL + 0.42, lg.z, alongX ? 0.06 : 0.62, 0.84, alongX ? 0.62 : 0.06);
    }
    const shelf = at(-faceLen / 4, nBk + 0.36);
    kb.box(0x6b5236, shelf.x, FL + 0.2, shelf.z, alongX ? 2.9 : 0.62, 0.04, alongX ? 0.62 : 2.9);
    C(-faceLen / 4, nBk + 0.36, 3.0, 0.7, 0, FL + 0.9);
    const board = at(-faceLen / 4, nBk + 0.02);
    kb.box(0x8a7a5e, board.x, FL + 1.7, board.z, alongX ? 2.8 : 0.03, 1.0, alongX ? 0.03 : 2.8);
    for (let i = 0; i < 7; i++) {
      const tl = at(-faceLen / 4 - 1.2 + i * 0.4, nBk + 0.05);
      kb.box(0x3a3d42, tl.x, FL + 1.55 + (i % 3) * 0.18, tl.z, alongX ? 0.05 : 0.04, 0.3, alongX ? 0.04 : 0.05);
    }
    const chest = at(faceLen / 4, nBk + 0.27);
    kb.box(0xa8322c, chest.x, FL + 0.55, chest.z, alongX ? 0.9 : 0.5, 1.1, alongX ? 0.5 : 0.9);
    for (let k = 0; k < 5; k++) { const dq = at(faceLen / 4, nBk + 0.53); kb.box(0x2a2c30, dq.x, FL + 0.2 + k * 0.2, dq.z, alongX ? 0.8 : 0.02, 0.02, alongX ? 0.02 : 0.8); }
    C(faceLen / 4, nBk + 0.27, 0.9, 0.5, 0, FL + 1.1);
    kb.flush(root, "garage-back");
    // bay lines on the floor
    for (let i = 0; i <= nb; i++) {
      const t = -faceLen / 2 + pier / 2 + i * (pier + bayW);
      B(t, FL + 0.005, 0, 0.1, 0.01, 2 * halfN - 2 * T - 1.2, M.paint, { cast: false });
    }
    return { rect: R, face: F.sideOf(toHouse, 0), doors: doors, floor: FL, bays: nb, bayW: bayW, doorN: nf };
  }

  /* ---- A SENTRY LODGE -------------------------------------------------- */
  function sentry(F, u, v, faceU, faceV) {
    const q = F.p(u, v), f = F.p(faceU, faceV);
    const n = { x: Math.sign(Math.round(f.x - F.cx)), z: Math.sign(Math.round(f.z - F.cz)) };
    if (n.x && n.z) n.z = 0;
    // big enough to stand a man at a desk in: 2.6 m square, 2.9 m to the roof
    lodge(F.root, q.x, q.z, 2.6, 2.6, 2.9, M.stone, n.x || n.z ? n : { x: 0, z: 1 });
  }

  /* ====================================================================
     estate(c, spec) — the whole estate from one spec. Returns
     { gate, main, wings, layout }: `gate` and `main` are the registry's
     { gate, seat }, `layout` is published on the site for every consumer
     that hangs things on this ground (motorcade, regime dressing, balcony,
     situation room, helicopter).
     ==================================================================== */
  function estate(c, spec) {
    const root = c.root;
    const T = Object.assign({}, EST_TIER[spec.tier || 3] || EST_TIER[3], spec.security || {});
    const F = estateFrame(c, spec.gateSide != null ? spec.gateSide : ((c.site && c.site.def && c.site.def.gateSide != null) ? c.site.def.gateSide : 1));
    const hu = F.hu, hv = F.hv;
    const SH = {};
    const sheet = function (k) { return SH[k] || (SH[k] = new Sheet(k)); };
    // THE GROUND YOU STAND ON IS THE GROUND YOU SEE. Every drawn surface
    // enters this estate's height record at the height it is drawn, and the
    // one provider below (§1c) answers CBZ.cityGroundHeightAt from it — the
    // query the player, the peds, the cars and the projectiles all read.
    const EG = { rect: c.rect, base: YG, rects: [], discs: [] };
    ESTATE_GROUND.push(EG);
    F.eg = EG;
    const hard = function (k, u0, v0, u1, v1, y) {
      F.fill(sheet(k), u0, v0, u1, v1, y);
      const r = F.wr(Math.min(u0, u1), Math.min(v0, v1), Math.max(u0, u1), Math.max(v0, v1));
      r.y = y; EG.rects.push(r);
    };
    const layout = { frame: { side: F.s, rot: F.rot }, tier: spec.tier || 3 };

    // ---- THE GROUND ------------------------------------------------------
    const padM = pad(root, c.rect, M.lawn, spec.name || (c.site && c.site.id) || "estate", "lawn");
    layout.pad = padM ? padM.name : null;
    // clipped lawn: mown stripes running from the house to the gate
    if (spec.stripes !== false) {
      const SW = 6.0;
      for (let u = -hu, i = 0; u < hu - 0.5; u += SW, i++) {
        if (i % 2) F.fill(sheet("lawnB"), u, -hv + 0.6, Math.min(hu - 0.6, u + SW), hv - 0.6, YG);
      }
    }

    // ---- THE HOUSE -------------------------------------------------------
    const H = spec.house;
    const hp = F.p(H.u || 0, H.v);
    const front = F.sideOf(0, 1);
    // THE HOUSE'S DRESS (houseDress, below): tier 4+ gets the rusticated
    // base, the window dressings and the balustrade unless it says otherwise.
    // A balustrade tells the civic grammar to keep its parapet piers off it.
    const HD = H.dress !== undefined ? H.dress : ((spec.tier || 3) >= 4 ? { clad: true, balustrade: true } : { windows: true, clad: false });
    const civSpec = H.civic ? Object.assign({}, H.civic, HD && HD.balustrade ? { balustrade: true } : {}) : null;
    const main = civic(root, hp.x, hp.z, F.swap ? H.d : H.w, F.swap ? H.w : H.d, H.storeys, H.hex || M.marble, front,
      civSpec, H.name || "Residence", H.fh ? { fh: H.fh } : null);
    const facadeV = H.v + H.d / 2;
    const perronD = H.perron == null ? 9 : H.perron;
    if (perronD > 0) {
      const fp = F.p(H.u || 0, facadeV);
      const axis = F.swap ? "x" : undefined, dir = (F.s === 1 || F.s === 3) ? 1 : -1;
      // it lands on the forecourt's setts, and its deck wears York stone:
      // the flag sheet IS the deck top, filed in the ground record at the
      // platform's own height
      perron(root, fp.x, fp.z, H.w, perronD, M.stone, dir, axis, {
        base: YS,
        deck: function (r, top) { sheet("flag").rect(r, top); r.y = top; EG.rects.push(r); },
      });
    }
    layout.house = { u: H.u || 0, v: H.v, w: H.w, d: H.d, facadeV: facadeV, facade: F.p(H.u || 0, facadeV), perronD: perronD };
    // THE HOUSE, DRESSED from its own built record (rusticated base, window
    // pediments, balustrade, roof, chimneys, porticoes, lights)
    try {
      layout.houseDress = HD ? houseDress(main, HD, { deck: PERRON_TOP, deckDepth: perronD > 0 ? perronD - PERRON_FLIGHT : 0 }) : null;
    } catch (e) { console.error("[govcomplex] house dress", e); }

    // ---- THE WINGS -------------------------------------------------------
    const wings = [];
    for (const W of (spec.wings || [])) {
      const wp = F.p(W.u, W.v);
      const toHouse = Math.sign((H.u || 0) - W.u) || 1;
      const side = W.face === "front" ? front : F.sideOf(toHouse, 0);
      let b = null;
      if (W.civic) b = civic(root, wp.x, wp.z, F.swap ? W.d : W.w, F.swap ? W.w : W.d, W.storeys, W.hex || M.stone, side,
        W.dress && W.dress.balustrade ? Object.assign({}, W.civic, { balustrade: true }) : W.civic, W.name || null, W.fh ? { fh: W.fh } : null);
      else {
        const raw = block(root, wp.x, wp.z, F.swap ? W.d : W.w, F.swap ? W.w : W.d, W.storeys, W.hex || M.stoneD, side, Object.assign({ facade: "office" }, W.opts || {}, W.fh ? { fh: W.fh } : {}));
        b = raw ? { b: raw } : null;
      }
      wings.push(b);
      // the wing's own face: its base, windows and balustrade (a civic wing
      // stands its door on the civic order's 2.5 m terrace and steps)
      const terr = !!(W.civic && !W.civic.externalPerron);
      if (b && W.dress) {
        try { (layout.wingDress = layout.wingDress || []).push(houseDress(b, W.dress, { deck: terr ? 0.30 : 0, deckDepth: terr ? 1.6 : 0, terrace: terr })); }
        catch (e) { console.error("[govcomplex] wing dress", e); }
      }
      // the covered walk from the wing's door to the house flank path. It
      // starts past the foot of the wing's entrance steps: its first pair of
      // columns used to stand ON the terrace and through the order's plinths
      if (W.colonnade && b) {
        const doorU = W.u + toHouse * W.w / 2, cv = W.v;
        const nearU = (H.u || 0) - toHouse * (H.w / 2 + 2.0);
        colonnade(F, [doorU + toHouse * (terr ? 2.95 : 0.6), cv], [nearU, cv], 3.6);
        hard("sett", Math.min(doorU, nearU), cv - 1.8, Math.max(doorU, nearU), cv + 1.8, YS);
      }
    }

    // ---- THE FORECOURT -----------------------------------------------------
    const FC = Object.assign({ v0: facadeV + perronD - 0.2, v1: facadeV + perronD + 55, hw: H.w / 2 + 4, island: 13, fountain: true, band: 0.9 }, spec.forecourt || {});
    const islandV = FC.islandV != null ? FC.islandV : (FC.v0 + FC.v1) / 2 - 1.5;
    const ic = F.p(0, islandV);
    const fieldR = F.wr(-FC.hw + FC.band, FC.v0, FC.hw - FC.band, FC.v1 - FC.band);
    sheet("sett").rectHole(fieldR, ic.x, ic.z, FC.island, YS, 72);
    { const r = F.wr(-FC.hw, FC.v0, FC.hw, FC.v1); r.y = YS; EG.rects.push(r); }
    EG.discs.push({ x: ic.x, z: ic.z, r: FC.island, y: 0.24, r0: FC.island - 0.32, y0: 0.17 });
    // the darker border band on the three open sides
    hard("settD", -FC.hw, FC.v0, -FC.hw + FC.band, FC.v1, YS);
    hard("settD", FC.hw - FC.band, FC.v0, FC.hw, FC.v1, YS);
    hard("settD", -FC.hw + FC.band, FC.v1 - FC.band, FC.hw - FC.band, FC.v1, YS);
    // the island: a stone kerb ring, a raised lawn, a ring of bedding, the fountain
    {
      const ringOuter = new THREE.CylinderGeometry(FC.island, FC.island, 0.24, 64, 1, true); ringOuter.translate(0, 0.12, 0);
      const ringTop = new THREE.RingGeometry(FC.island - 0.32, FC.island, 64, 1); ringTop.rotateX(-Math.PI / 2); ringTop.translate(0, 0.24, 0);
      const ringIn = new THREE.CylinderGeometry(FC.island - 0.32, FC.island - 0.32, 0.08, 64, 1, true); ringIn.translate(0, 0.2, 0);
      const km = new THREE.Mesh(mergeGeos([ringOuter, ringTop, ringIn]), cm(EST.kerb));
      km.material = cm(EST.kerb); km.position.set(ic.x, 0, ic.z); km.receiveShadow = true; km.castShadow = false;
      km.matrixAutoUpdate = false; km.updateMatrix(); root.add(km);
      sheet("lawn").disc(ic.x, ic.z, FC.island - 0.3, 0.17, 64);
      if (FC.island > 8) {
        sheet("bed").ring(ic.x, ic.z, 4.9, 6.3, 0.2, 56);
        EG.discs.push({ x: ic.x, z: ic.z, r: 6.3, y: 0.2, r0: 4.9, y0: 0.17 });
      }
      layout.fountain = FC.fountain ? fountain(root, ic.x, ic.z) : null;
      if (!FC.fountain) col(ic.x, ic.z, FC.island * 1.4, FC.island * 1.4, 0, 0.24);
    }
    layout.court = { center: ic, r: FC.island, rect: F.wr(-FC.hw, FC.v0, FC.hw, FC.v1), v0: FC.v0, v1: FC.v1, hw: FC.hw };
    // THE MOTOR POOL: its bays open onto a real apron that runs to the court
    const aprons = [];
    if (spec.garage) {
      const GR = spec.garage;
      const toHouse = Math.sign((H.u || 0) - GR.u) || 1;
      const doorU = GR.u + toHouse * GR.w / 2, edgeU = toHouse > 0 ? -FC.hw : FC.hw;
      const half = GR.d / 2 - 0.6;
      hard("asphalt", Math.min(doorU, edgeU), GR.v - half, Math.max(doorU, edgeU), GR.v + half, YS);
      kerb(F, Math.min(doorU, edgeU), GR.v + half + 0.15, Math.max(doorU, edgeU), GR.v + half + 0.15);
      kerb(F, Math.min(doorU, edgeU), GR.v - half - 0.15, Math.max(doorU, edgeU), GR.v - half - 0.15);
      aprons.push({ edge: toHouse > 0 ? "w" : "e", c: GR.v, w: half * 2 + 0.1 });
      try { layout.garage = motorPool(F, GR, EG); } catch (e) { console.error("[govcomplex] motor pool", e); }
    }

    // ---- THE DRIVE ---------------------------------------------------------
    const DW = spec.driveW || 11;
    const dv0 = FC.v1, dv1 = hv - 0.4;
    hard("asphalt", -DW / 2, dv0, DW / 2, dv1, YS);
    for (const s of [-1, 1]) hard("settD", s > 0 ? DW / 2 : -DW / 2 - 0.45, dv0, s > 0 ? DW / 2 + 0.45 : -DW / 2, dv1 - 9.5, YS);
    const gw = T.gateW;
    // the gate apron: the drive opens out to the gate, the pedestrian lane
    // (east, where the checkpoint's walk-through arch stands) is setts
    const ped = spec.pedLane || [DW / 2 + 1.0, Math.min(gw / 2 - 0.6, DW / 2 + 7.0)];
    hard("asphalt", -Math.min(gw / 2 - 0.6, DW / 2 + 0.6), hv - 9.5, ped[0], dv1, YS);
    hard("sett", ped[0], hv - 9.5, ped[1], dv1, YS);
    const footU = [ped[0] + 1.6, ped[0] + 3.8];
    hard("sett", footU[0], dv0, footU[1], hv - 9.5, YS);
    // kerbs: along both drive edges, stopping at the apron; the forecourt's
    // front kerb leaves the drive mouth and the footpath open
    for (const s of [-1, 1]) kerb(F, s * (DW / 2 + 0.6), dv0 + 0.2, s * (DW / 2 + 0.6), hv - 9.6);
    kerb(F, footU[1] + 0.15, dv0 + 0.2, footU[1] + 0.15, hv - 9.6);
    layout.drive = { a: F.p(0, dv0), b: F.p(0, dv1), w: DW, lane: [F.p(-DW / 4, 0), F.p(DW / 4, 0)] };

    // ---- FLANK WALKS, REAR TERRACE, CENTRAL WALK, RONDEL --------------------
    const backV = H.v - H.d / 2;
    const flank0 = H.w / 2 + 1.2, flank1 = H.w / 2 + 4.0;
    for (const s of [-1, 1]) hard("sett", s > 0 ? flank0 : -flank1, backV, s > 0 ? flank1 : -flank0, FC.v0 + 0.01, YS);
    hard("flag", -flank1, backV - 7, flank1, backV, YS);
    const flankC = (flank0 + flank1) / 2, flankW = flank1 - flank0 + 0.1;
    kerbRect(F, -flank1, backV - 7, flank1, backV, [{ edge: "s", c: 0, w: 5.2 }, { edge: "s", c: -flankC, w: flankW }, { edge: "s", c: flankC, w: flankW }], ["n", "e", "w"]);
    const rear = spec.rear || {};
    const rondelV = rear.rondelV != null ? rear.rondelV : Math.max(-hv + 16, backV - 48);
    // the rear walk and its rondel only where no parterre already is
    const rearClear = (spec.parterres || []).every(function (P) {
      return P.u - P.w / 2 > 8.6 || P.u + P.w / 2 < -8.6 || P.v - P.d / 2 > backV - 7 || P.v + P.d / 2 < rondelV - 8.6;
    });
    if (rearClear && rondelV < backV - 16) {
      hard("gravel", -2.4, rondelV + 8, 2.4, backV - 7, YS);
      const rc = F.p(0, rondelV);
      sheet("gravel").disc(rc.x, rc.z, 8.2, YS, 48);
      EG.discs.push({ x: rc.x, z: rc.z, r: 8.2, y: YS });
      // a low round basin in the rondel, one stone ring and its water
      const basin = new THREE.Mesh(lathe([[2.6, 0.5], [3.0, 0.5], [3.0, 0.05], [3.1, 0], [2.4, 0], [2.4, 0.42], [2.6, 0.42]], 36), cm(M.stone));
      basin.position.set(rc.x, 0, rc.z); basin.matrixAutoUpdate = false; basin.updateMatrix(); root.add(basin);
      disc(root, rc.x, rc.z, 2.45, M.pool, 0.38, 32);
      col(rc.x, rc.z, 6.0, 6.0, 0, 0.5);
      layout.rondel = rc;
    }

    // ---- PARTERRES -----------------------------------------------------------
    const PT = spec.parterres || [];
    const hedgeList = [], lowList = [], topi = [], urnPts = [];
    for (const P of PT) {
      const u0 = P.u - P.w / 2, u1 = P.u + P.w / 2, v0 = P.v - P.d / 2, v1 = P.v + P.d / 2;
      hard("gravel", u0, v0, u1, v1, YS);
      // the border hedge, opened at the middle of each side for the walks
      const gap = 3.2;
      hedgeList.push({ u0: u0, v0: v1, u1: P.u - gap / 2, v1: v1, h: 0.95, w: 0.8 }, { u0: P.u + gap / 2, v0: v1, u1: u1, v1: v1, h: 0.95, w: 0.8 });
      hedgeList.push({ u0: u0, v0: v0, u1: P.u - gap / 2, v1: v0, h: 0.95, w: 0.8 }, { u0: P.u + gap / 2, v0: v0, u1: u1, v1: v0, h: 0.95, w: 0.8 });
      hedgeList.push({ u0: u0, v0: v0 + 0.4, u1: u0, v1: P.v - gap / 2, h: 0.95, w: 0.8 }, { u0: u0, v0: P.v + gap / 2, u1: u0, v1: v1 - 0.4, h: 0.95, w: 0.8 });
      hedgeList.push({ u0: u1, v0: v0 + 0.4, u1: u1, v1: P.v - gap / 2, h: 0.95, w: 0.8 }, { u0: u1, v0: P.v + gap / 2, u1: u1, v1: v1 - 0.4, h: 0.95, w: 0.8 });
      // four beds, each edged in low box, cross walks between them
      const bw = (P.w - 2.4 - 3.0) / 2, bd = (P.d - 2.4 - 3.0) / 2;
      for (const su of [-1, 1]) for (const sv of [-1, 1]) {
        const bu = P.u + su * (1.5 + bw / 2), bvc = P.v + sv * (1.5 + bd / 2);
        const a0 = bu - bw / 2, a1 = bu + bw / 2, b0 = bvc - bd / 2, b1 = bvc + bd / 2;
        hard("bed", a0 + 0.3, b0 + 0.3, a1 - 0.3, b1 - 0.3, YS + 0.04);
        lowList.push({ u0: a0, v0: b0, u1: a1, v1: b0, h: 0.5, w: 0.45 }, { u0: a0, v0: b1, u1: a1, v1: b1, h: 0.5, w: 0.45 });
        lowList.push({ u0: a0, v0: b0 + 0.22, u1: a0, v1: b1 - 0.22, h: 0.5, w: 0.45 }, { u0: a1, v0: b0 + 0.22, u1: a1, v1: b1 - 0.22, h: 0.5, w: 0.45 });
        topi.push([P.u + su * 2.45, P.v + sv * 2.45]);       // a cone in each bed's inner corner
      }
      urnPts.push([P.u, P.v]);
      // the walk from the house flank to this parterre's inner gap
      const inner = P.u > 0 ? u0 : u1, fl = P.u > 0 ? flank1 : -flank1;
      hard("gravel", Math.min(inner, fl), P.v - 1.3, Math.max(inner, fl), P.v + 1.3, YS);
    }
    // the flank walks carry on past the terrace to the parterres' cross walks
    if (PT.length) {
      let far = backV - 7;
      for (const P of PT) far = Math.min(far, P.v - 1.3);
      if (far < backV - 7) for (const s of [-1, 1]) hard("sett", s > 0 ? flank0 : -flank1, far, s > 0 ? flank1 : -flank0, backV - 7, YS);
    }
    hedgeRuns(F, hedgeList, EST.hedge);
    hedgeRuns(F, lowList, EST.hedgeD);
    topiary(F, topi);

    // ---- THE HELIPAD ----------------------------------------------------------
    if (spec.helipad) {
      const HP = spec.helipad, hc = F.p(HP.u, HP.v);
      const sock = F.p(HP.u + HP.r + 7, HP.v + HP.r + 3);
      helipad(root, hc.x, hc.z, HP.r, { sock: { x: sock.x, z: sock.z, yaw: F.rot + 0.6 } });
      { const r = { minX: hc.x - HP.r - 0.25, maxX: hc.x + HP.r + 0.25, minZ: hc.z - HP.r - 0.25, maxZ: hc.z + HP.r + 0.25, y: HELI_TOP }; EG.rects.push(r); }
      // the walk from the court to the pad: along the court's side, then out
      const s = Math.sign(HP.u) || 1, pv = Math.min(FC.v1 - 6, Math.max(FC.v0 + 6, HP.v));
      hard("sett", s > 0 ? FC.hw : HP.u - 1.4, pv - 1.4, s > 0 ? HP.u + 1.4 : -FC.hw, pv + 1.4, YS);
      const edgeV = HP.v > pv ? HP.v - HP.r - 0.6 : HP.v + HP.r + 0.6;
      hard("sett", HP.u - 1.4, Math.min(pv, edgeV), HP.u + 1.4, Math.max(pv, edgeV), YS);
      const hh = F.p(H.u || 0, H.v);
      layout.helipad = { x: hc.x, z: hc.z, r: HP.r, top: HELI_TOP, yaw: Math.atan2(hh.x - hc.x, hh.z - hc.z), pathV: pv };
    }

    // ---- THE STAFF CAR PARK ------------------------------------------------------
    if (spec.parking) {
      const PK = spec.parking;
      const u0 = PK.u - PK.w / 2, u1 = PK.u + PK.w / 2, v0 = PK.v - PK.d / 2, v1 = PK.v + PK.d / 2;
      hard("asphalt", u0, v0, u1, v1, YS);
      // the lane from the court's side into it
      const s = Math.sign(PK.u) || -1, laneV = PK.v;
      const cEdge = s < 0 ? -FC.hw : FC.hw, lEdge = s < 0 ? u1 : u0;
      hard("asphalt", Math.min(cEdge, lEdge), laneV - 3.6, Math.max(cEdge, lEdge), laneV + 3.6, YS);
      kerbRect(F, u0, v0, u1, v1, [{ edge: s < 0 ? "e" : "w", c: laneV, w: 7.4 }]);
      kerb(F, Math.min(cEdge, lEdge), laneV + 3.75, Math.max(cEdge, lEdge), laneV + 3.75);
      kerb(F, Math.min(cEdge, lEdge), laneV - 3.75, Math.max(cEdge, lEdge), laneV - 3.75);
      // two rows of ULI stalls facing a 7.3 m aisle along u
      const SWd = P_STALL_W, SD = P_STALL_D, AI = P_AISLE;
      const n = Math.floor((PK.w - 4) / SWd), gu0 = PK.u - n * SWd / 2;
      const rowV = [PK.v - AI / 2 - SD / 2, PK.v + AI / 2 + SD / 2];
      const stripes = [], slots = [];
      for (let r = 0; r < 2; r++) for (let i = 0; i <= n; i++) {
        const q = F.p(gu0 + i * SWd, rowV[r]); stripes.push(q);
        if (i < n) { const m = F.p(gu0 + (i + 0.5) * SWd, rowV[r]); slots.push({ x: m.x, z: m.z, heading: F.rot + (r ? Math.PI : 0) }); }
      }
      repeat(root, bg(0.14, 0.02, SD), M.paint, stripes, function () { return YM; }, function () { return F.rot; });
      if (_curSite) _bays.push({ site: _curSite, slots: slots, stalls: slots.length });
      layout.parking = { rect: F.wr(u0, v0, u1, v1), stalls: slots.length };
    }

    // ---- KERBS ROUND THE COURT (openings where anything joins it) ------------
    {
      const gaps = [{ edge: "n", c: 0, w: DW + 1.3 }, { edge: "n", c: (footU[0] + footU[1]) / 2, w: footU[1] - footU[0] + 0.1 }];
      if (spec.parking) gaps.push({ edge: spec.parking.u < 0 ? "w" : "e", c: spec.parking.v, w: 7.4 });
      for (const a of aprons) gaps.push(a);
      if (layout.helipad) gaps.push({ edge: spec.helipad.u < 0 ? "w" : "e", c: layout.helipad.pathV, w: 2.9 });
      kerbRect(F, -FC.hw, FC.v0 + 0.3, FC.hw, FC.v1, gaps, ["s"]);
    }

    // ---- THE PERIMETER, THE GATE, THE LODGES -----------------------------------
    estatePerimeter(F, T);
    if (T.perimeter === "railing") estateGateLeaves(F, T.gateW, T.h);
    const gq = F.p(0, hv - 6);
    if (spec.gatehouse !== false) {
      // the parked boom arms pivot 11 m off the lane: only a gate wide enough
      // to clear its own piers carries them; a narrow one is the booth alone
      const boothOff = Math.min(8, gw / 2 - 1.9);
      gatehouse(root, gq.x, gq.z, !F.swap, M.stone, { noArms: !!spec.checkpoint || gw < 23.5, booth: boothOff });
      // where gatehouse() actually stood the booth, so a consumer never re-derives it
      layout.gatehouse = { x: F.swap ? gq.x : gq.x - boothOff, z: F.swap ? gq.z - boothOff : gq.z, roofY: 3.26 };
    }
    const lodgeAt = [[hu - 4, -hv + 4], [-hu + 4, -hv + 4], [hu - 4, hv - 5], [-hu + 4, hv - 5]];
    for (let i = 0; i < Math.min(T.lodges | 0, 4); i++) sentry(F, lodgeAt[i][0], lodgeAt[i][1], 0, Math.sign(lodgeAt[i][1]) * -1);
    layout.lodges = lodgeAt.slice(0, Math.min(T.lodges | 0, 4)).map(function (q) { return F.p(q[0], q[1]); });

    // ---- LIGHT, TREES, URNS, FLAGS -------------------------------------------------
    if (T.lamps) {
      const lp = [];
      for (let v = dv0 + 6; v < hv - 12; v += 12) for (const s of [-1, 1]) lp.push(F.p(s * (DW / 2 + 1.7), v));
      // round the court, clear of every opening a car or a walker uses
      const open = [];
      if (spec.parking) open.push({ s: Math.sign(spec.parking.u) || -1, v: spec.parking.v, w: 7.4 });
      if (layout.helipad) open.push({ s: Math.sign(spec.helipad.u) || 1, v: layout.helipad.pathV, w: 2.9 });
      if (spec.garage) open.push({ s: Math.sign(spec.garage.u) || 1, v: spec.garage.v, w: spec.garage.d - 1.0 });
      for (let v = FC.v0 + 5; v < FC.v1 - 8; v += 12) for (const s of [-1, 1]) {
        if (open.some(function (o) { return o.s === s && Math.abs(o.v - v) < o.w / 2 + 2.0; })) continue;
        lp.push(F.p(s * (FC.hw - 1.3), v));
      }
      lampRow(root, lp);
    }
    const tp = [];
    if (T.allee) for (let v = dv0 + 12; v < hv - 16; v += 12) for (const s of [-1, 1]) tp.push([s * (DW / 2 + 8.5), v]);
    for (const t of (spec.trees || [])) tp.push(t);
    layout.trees = trees(F, tp, true);
    const up = [];
    for (const s of [-1, 1]) { up.push([s * (FC.hw - 2.2), FC.v1 - 2.2]); up.push([s * (DW / 2 + 1.9), FC.v1 + 2.4]); }
    urns(F, up.concat(urnPts));
    const nf = T.flags | 0;
    if (nf) for (let i = 0; i < Math.min(2, nf); i++) {
      const s = i ? 1 : -1, q = F.p(s * (FC.hw - 5.5), FC.v1 - 3.0);
      flagpole(root, q.x, q.z, 13);
    }

    // ---- EMIT THE GROUND ---------------------------------------------------------
    for (const k in SH) SH[k].finish(root, "estate-" + ((c.site && c.site.id) || "x") + "-" + k);
    layout.gate = F.p(0, hv);
    layout.frameFn = F.p;
    return { gate: layout.gate, main: main, wings: wings, layout: layout, F: F };
  }

  /* ====================================================================
     §1c  THE ESTATES' GROUND, answered where everything asks.

     OWNER: the lot "literally has no colliders". The height the world
     reported inside a compound was the graded country, y 0, while the
     drive, the court and the terrace were drawn 6-24 cm above it: feet in
     the setts, tyres in the asphalt, a kerb you walked through. Every
     estate files what it drew (above) and this ONE provider answers
     CBZ.cityGroundHeightAt from it — the oracle world.js's groundHeightAt
     already folds in, i.e. the floor physics.js, the peds, the car
     suspension and the projectiles read. No second ground system.
     ==================================================================== */
  const ESTATE_GROUND = [];
  let _egReg = false;
  function estateGroundAt(x, z) {
    let best = 0;
    for (let i = 0; i < ESTATE_GROUND.length; i++) {
      const E = ESTATE_GROUND[i], R = E.rect;
      if (x < R.minX || x > R.maxX || z < R.minZ || z > R.maxZ) continue;
      let h = E.base;
      const rs = E.rects;
      for (let k = 0; k < rs.length; k++) {
        const r = rs[k];
        if (r.y > h && x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) h = r.y;
      }
      const ds = E.discs;
      for (let k = 0; k < ds.length; k++) {
        const d = ds[k], dd = Math.hypot(x - d.x, z - d.z);
        if (dd > d.r) continue;
        const y = (d.r0 != null && dd <= d.r0) ? d.y0 : d.y;
        if (y > h) h = y;
      }
      if (h > best) best = h;
    }
    return best;
  }
  function registerEstateGround() {
    if (_egReg || !CBZ.registerCityGroundHeight) return;
    _egReg = true;
    CBZ.registerCityGroundHeight(estateGroundAt, { owner: "govcomplex-estates" });
  }
  CBZ.estateGroundAt = estateGroundAt;

  /* ====================================================================
     §1d  THE GRAND STAIR — how a head of state goes upstairs.

     A state entrance hall has a STAIR IN IT: two straight flights of 13
     marble risers (0.168 m on a 0.44 m going, a 21 degree ceremonial pitch)
     along the west wall with a half landing between them, rising toward the
     back onto the first floor in front of the service core, so the two
     stairs meet on one floor.

     OWNER: "when you walk through the stairs, you have to go through the
     floor". Measured causes, both fixed here and in the shared kit:
       · the walk surface was ONE straight ramp from the bottom nosing to the
         top one, i.e. a riser UNDER every tread (feet in the marble all the
         way up). The flights now pass `steps`, so the walk surface is the
         treads themselves, to the millimetre (systems/stairs.js).
       · everything the state hall hung under its ceiling (coffers, cornice,
         chandeliers) ran across the stairwell, so the climb went through
         them. The opening is reserved per LEVEL now and buildings.js clips
         whatever a program draws in that slab's band out of it.
     Everything it stands on is the shared kit: CBZ.stairs.flight (walk
     surface + AI link), CBZ.cityCarveShaft (opens exactly slab 1 and reserves
     it), CBZ.interiorPartition (the stair hall's wall upstairs). The flights
     are a SOLID stepped mass with a collider per tread (you walk round it on
     the ground floor, never under it), a balustrade on the open side with a
     rail that is solid, and a brass rail on brackets along the wall.

     Authored for the shell this row builds (door on the +z face); any other
     shell returns null and keeps the service core as its only stair.
     ==================================================================== */
  const GS = { RISE: 0.168, GO: 0.44, LAND: 1.8, W: 3.2, RH: 0.95 };
  function grandStair(main, layout) {
    const b = main && main.b;
    if (!b || typeof b.lbox !== "function" || !CBZ.stairs || !CBZ.stairs.flight) return null;
    const dn = b.localDoor;
    if (!dn || !(dn.nz < -0.5) || !Array.isArray(b.floorTops) || b.floorTops.length < 3) return null;
    const wt = b.wt != null ? b.wt : 0.4, ox = b.ox, oz = b.oz;
    const y0 = b.floorTops[0], y1 = b.floorTops[1];
    const nTot = Math.max(8, Math.round((y1 - y0) / GS.RISE)), n1 = Math.ceil(nTot / 2), n2 = nTot - n1;
    const rise = (y1 - y0) / nTot, go = GS.GO, yL = y0 + n1 * rise;
    const xW = -b.w / 2 + wt;                 // inner face of the west wall
    const W = GS.W, x0 = xW + 0.12, x1 = x0 + W, xc = (x0 + x1) / 2;
    const zTop = -3.0;                        // the top nosing: it climbs toward the back
    const zL0 = zTop + n2 * go, zL1 = zL0 + GS.LAND, zBot = zL1 + n1 * go;
    const xPart = x1 + 0.45;                  // the stair hall's wall on the first floor
    const MARBLE = 0xe4e0d6, NOSE = 0xf1eee6, RUN = 0x7a2c2e, BRASS = 0xb99347, STRING = 0xd8d2c4;
    // 1. open the first-floor slab over both flights and the landing (only that slab)
    if (CBZ.cityCarveShaft) {
      CBZ.cityCarveShaft(b, ox + (xW + xPart - 0.1) / 2, oz + (zTop + zBot + 0.4) / 2,
        (xPart - 0.1 - xW) / 2, (zBot + 0.4 - zTop) / 2, { levels: [1], reserve: true });
    }
    // ...and fix where the SERVICE core goes, on the far (west) side of the
    // plan, so the stair hall's wall can meet it. This is exactly the
    // reservation elevators.js's cityStairCore makes when it plans a core
    // itself; planning it here only decides the side first.
    if (!b.stairPlan && CBZ.cityStairPlan) {
      const P = CBZ.cityStairPlan(b, -1);
      if (P) {
        b.stairPlan = P;
        if (b.shaftRects) b.shaftRects.push(P.rect);
        if (b.keepRects) b.keepRects.push(P.mouth);
        if (main.lot && main.lot.building) main.lot.building.stairPlan = P;
      }
    }
    // 2. the walk surface: two stepped flights and the landing between them
    const plats = b.platforms || undefined, cols = b.colliders || undefined;
    const f1 = CBZ.stairs.flight({
      bottom: { x: ox + xc, y: y0, z: oz + zBot }, top: { x: ox + xc, y: yL, z: oz + zL1 },
      width: W, overlap: 0.3, steps: n1, owner: b, plats: plats, cols: cols, kind: "stair",
    });
    const f2 = CBZ.stairs.flight({
      bottom: { x: ox + xc, y: yL, z: oz + zL0 }, top: { x: ox + xc, y: y1, z: oz + zTop },
      width: W, overlap: 0.3, steps: n2, owner: b, plats: plats, cols: cols, kind: "stair",
    });
    const landP = { minX: ox + x0, maxX: ox + x1, minZ: oz + zL0 - 0.02, maxZ: oz + zL1 + 0.02, top: yL };
    CBZ.platforms.push(landP);
    if (b.platforms) b.platforms.push(landP);
    function solid(xa, xb, za, zb, ya, yb) {
      const c = { minX: ox + xa, maxX: ox + xb, minZ: oz + za, maxZ: oz + zb, y0: ya, y1: yb, ref: null };
      CBZ.colliders.push(c);
      if (b.colliders) b.colliders.push(c);
      return c;
    }
    // 3. the stair you see: a stepped marble mass, a lighter nosing on every
    // tread, a runner up the middle held by brass rods. Tread i of a flight
    // covers the i-th n-th of its run with its top at base + i*rise: exactly
    // the rule the stepped walk surface answers with.
    const treads = [];
    // THE FINISH the fit-out lays on it when you walk in (interior_programs.js
    // THE FINISH OF A HOUSE OF STATE): veined marble on every tread and riser,
    // a woven runner, the string and the newels in stone. The eager stair
    // stays what the street and the physics see.
    const FS = CBZ.stateFinish ? CBZ.stateFinish(b, "grandStair") : null;
    const fin = function (kind, x, y, z, w, h, d, tint, mask) { if (FS) FS.box(kind, x, y, z, w, h, d, tint, mask); };
    // THE EAGER STAIR IS THE STREET'S AND THE PHYSICS'S, THE FINISH IS ITS
    // FACE. Each eager mass is DRAWN 1.5 cm under its top, the finish riser stands 1 cm proud of its face
    // (the collider keeps the full box: buildings.js lbox o.shrink), and the
    // nosing, the runner and its rods are finish only: the eager copies lay
    // 3-6 mm under the finish ones and fought them for depth (the flicker).
    // Each finish piece owns its own patch of surface (tread, nosing and
    // riser meet edge to edge, never overlapping).
    const IN = 0.015;            // 1.5 cm: the finish face 1.9 cm off, the drawn tread still within a stride check of the walk top
    function flightMass(zStart, base, n) {
      for (let i = 1; i <= n; i++) {
        const top = base + i * rise, zc = zStart - (i - 0.5) * go, zFront = zStart - (i - 1) * go;
        b.lbox(xc, top / 2, zc, W, top, go + 0.004, MARBLE, { cast: i === n, stair: true, shrink: [0, 0, 0, IN, 0, 0] });
        fin("marble", xc, top + 0.002, zc - 0.035, W, 0.004, go - 0.066, 0xf2efe8, 1 | 2 | 4);    // the tread, behind its nosing (only its seen faces: a buried face fights)
        fin("marble", xc, (top - rise + top - 0.035) / 2, zFront + 0.010, W, rise - 0.035, 0.004, 0xe8e3d8, 1 | 2 | 16);   // the riser, under it
        fin("marble", xc, top - 0.0145, zFront - 0.024, W + 0.048, 0.039, 0.088, 0xf6f3ec, 63 & ~32);    // the nosing, 1.6 cm proud of the riser
        fin("rug", xc, top + 0.0125, zc, 1.904, 0.003, go - 0.016, 0xb04a44, 63 & ~8);          // the runner
        fin("flat", xc, top + 0.021, zFront - 0.06, 1.98, 0.014, 0.014, BRASS, 128 | 3);         // its brass rod (a round)
        // the mass is solid from the hall floor to this tread (a body ON the
        // flight has the next treads' tops within a step of its feet)
        solid(x0, x1, zc - go / 2, zc + go / 2, y0 - 0.05, top);
        treads.push({ x: ox + xc, z: oz + zc, top: top, w: W, go: go });
      }
    }
    flightMass(zBot, y0, n1);
    // the half landing: a marble block with the runner turned across it
    b.lbox(xc, yL / 2, (zL0 + zL1) / 2, W, yL, zL1 - zL0 + 0.004, MARBLE, { stair: true, shrink: [0, 0, 0, IN, 0, 0] });
    fin("marble", xc, yL + 0.002, (zL0 + zL1 - 0.002) / 2, W, 0.004, zL1 - zL0 - 0.002, 0xf2efe8, 1 | 2 | 4);   // to the last tread's edge, not over it
    fin("rug", xc, yL + 0.0125, (zL0 + zL1) / 2, 1.904, 0.003, zL1 - zL0 - 0.096, 0xb04a44, 63 & ~8);
    solid(x0, x1, zL0, zL1, y0 - 0.05, yL);
    flightMass(zL0, yL, n2);
    // the open side's face: a closed string with a moulded cap, stepped to the flights
    b.lbox(x1 + 0.03, yL / 2, (zL0 + zBot) / 2, 0.06, yL, zBot - zL0, STRING, { cast: false, stair: true, shrink: [0.03, 0.01, 0, 0.05, IN, IN] });
    b.lbox(x1 + 0.03, y1 / 2, (zTop + zL0) / 2, 0.06, y1, zL0 - zTop, STRING, { cast: false, stair: true, shrink: [0.03, 0.01, 0, 0.05, IN, IN] });
    fin("marble", x1 + 0.032, (yL - 0.04) / 2, (zL0 + zBot) / 2, 0.064, yL - 0.04, zBot - zL0 + 0.008, 0xe2ddd2, 63 & ~8);   // its inner face ON the mass side, never over it; its cap under the nosings
    fin("marble", x1 + 0.032, (y1 - 0.04) / 2, (zTop + zL0) / 2, 0.064, y1 - 0.04, zL0 - zTop + 0.008, 0xe2ddd2, 63 & ~8);
    // 4. THE BALUSTRADE on the open (east) side: two turned balusters a tread,
    //    a sloped rail per flight and a level one across the landing, newels
    //    at the foot, both landing corners and the head. The rail is SOLID.
    const railX = x1 - 0.08, RH = GS.RH;
    function railRun(zStart, base, n) {
      for (let i = 0; i < n; i++) {
        const t = base + (i + 1) * rise;
        for (const f of [0.28, 0.72]) {
          const zz = zStart - (i + f) * go;
          // standing ON the finished tread (its foot was buried in the tread, face to face)
          b.lbox(railX, t + 0.004 + (RH - 0.054) / 2, zz, 0.045, RH - 0.054, 0.045, MARBLE, { cast: false, stair: true });
        }
      }
      if (b.group) {
        const len = Math.hypot(n * go, n * rise);
        const rail = new THREE.Mesh(bg(0.09, 0.07, len), cm(BRASS));
        rail.position.set(railX, base + (n * rise) / 2 + rise / 2 + RH, zStart - n * go / 2);
        rail.rotation.x = Math.atan2(n * rise, n * go);           // rises toward -z
        rail.castShadow = false; rail.matrixAutoUpdate = false; rail.updateMatrix();
        b.group.add(rail);
      }
      // the solid rail: a banded collider per half metre, from the tread under
      // it to a hand over the rail (stops a body stepping off the open side)
      const segs = Math.ceil(n * go / 0.5);
      for (let k = 0; k < segs; k++) {
        const za = zStart - k * n * go / segs, zb = zStart - (k + 1) * n * go / segs;
        const lo = base + Math.floor(k * n / segs) * rise, hi = base + Math.ceil((k + 1) * n / segs) * rise;
        solid(x1 - 0.12, x1 + 0.06, zb, za, lo + 0.1, hi + RH + 0.05);
      }
    }
    railRun(zBot, y0, n1);
    railRun(zL0, yL, n2);
    // across the landing, level
    for (let zz = zL0 + 0.25; zz < zL1 - 0.1; zz += 0.3)
      b.lbox(railX, yL + 0.004 + (RH - 0.054) / 2, zz, 0.045, RH - 0.054, 0.045, MARBLE, { cast: false, stair: true });
    b.lbox(railX, yL + RH + 0.02, (zL0 + zL1) / 2, 0.09, 0.07, zL1 - zL0, BRASS, { cast: false, stair: true });
    solid(x1 - 0.12, x1 + 0.06, zL0, zL1, yL + 0.1, yL + RH + 0.05);
    const newels = [[zBot + 0.18, y0], [zL1, yL], [zL0, yL], [zTop - 0.2, y1]];
    for (const e of newels) {
      b.lbox(railX, e[1] + 0.6, e[0], 0.3, 1.2, 0.3, MARBLE, { stair: true, shrink: [0.03, 0.03, 0, 0.03, 0.03, 0.03] });
      fin("marble", railX, e[1] + 0.6, e[0], 0.308, 1.204, 0.308, 0xf0ece4, 63 & ~8);   // its foot is in the floor
      b.lbox(railX, e[1] + 1.25, e[0], 0.36, 0.1, 0.36, NOSE, { cast: false, stair: true });
      b.lbox(railX, e[1] + 1.36, e[0], 0.16, 0.12, 0.16, BRASS, { cast: false, stair: true });
    }
    solid(x1 - 0.2, x1 + 0.1, zBot + 0.03, zBot + 0.33, y0, y0 + 1.3);
    // the WALL rail: brass on brackets along the west wall, pitched with each flight
    if (b.group) {
      for (const f of [[zBot, y0, n1], [zL0, yL, n2]]) {
        const len = Math.hypot(f[2] * go, f[2] * rise);
        const wr = new THREE.Mesh(bg(0.06, 0.06, len), cm(BRASS));
        wr.position.set(xW + 0.09, f[1] + (f[2] * rise) / 2 + rise / 2 + 0.9, f[0] - f[2] * go / 2);
        wr.rotation.x = Math.atan2(f[2] * rise, f[2] * go);
        wr.castShadow = false; wr.matrixAutoUpdate = false; wr.updateMatrix();
        b.group.add(wr);
        for (let i = 1; i < f[2]; i += 4) {
          const t = f[1] + (i + 0.5) * rise;
          b.lbox(xW + 0.05, t + 0.86, f[0] - (i + 0.5) * go, 0.08, 0.03, 0.03, BRASS, { cast: false, stair: true });
        }
      }
    }
    // 5. upstairs: THE WELL IS GUARDED BY A BALUSTRADE, not a parapet. It was
    //    a solid marble block across the far end, so from the first floor the
    //    opening read as a hole in the floor behind a kerb. Now every open edge
    //    of the well on the first floor carries the same balustrade the flights
    //    do: a newel at each end and corner, turned balusters on a plinth at
    //    12 cm centres, a brass-capped handrail at RH, and one solid collider
    //    the length of the run (nobody steps or falls through).
    //      · the far (front) edge, across the whole opening;
    //      · the head edge, from the head newel to the stair hall's wall (the
    //        strip between the flight's string and that wall is open well).
    function wellRail(xa, xb, z, newels) {
      const len = xb - xa;
      if (len < 0.2) return;
      const inset = newels ? 0.15 : 0.03;
      const xm = (xa + xb) / 2;
      b.lbox(xm, y1 + 0.05, z, len, 0.1, 0.16, MARBLE, { cast: false, stair: true });                       // the plinth
      b.lbox(xm, y1 + RH - 0.035, z, len, 0.07, 0.12, MARBLE, { cast: false, stair: true });                 // the rail's bed
      b.lbox(xm, y1 + RH + 0.02, z, len + 0.02, 0.05, 0.09, BRASS, { cast: false, stair: true });            // the handrail
      const n = Math.max(1, Math.round((len - 2 * inset) / 0.12));
      for (let i = 0; i < n; i++) {
        const x = xa + inset + (i + 0.5) * (len - 2 * inset) / n;
        b.lbox(x, y1 + 0.1 + (RH - 0.17) / 2, z, 0.045, RH - 0.17, 0.045, MARBLE, { cast: false, stair: true });
      }
      if (newels) for (const x of [xa + 0.12, xb - 0.12]) {
        b.lbox(x, y1 + 0.6, z, 0.24, 1.2, 0.24, MARBLE, { stair: true });
        b.lbox(x, y1 + 1.25, z, 0.3, 0.1, 0.3, NOSE, { cast: false, stair: true });
        b.lbox(x, y1 + 1.36, z, 0.14, 0.12, 0.14, BRASS, { cast: false, stair: true });
      }
      solid(xa, xb, z - 0.12, z + 0.12, y1, y1 + RH + 0.05);
    }
    const zGuard = zBot + 0.52;
    wellRail(xW, xPart - 0.1, zGuard, true);
    // (from the head newel's face to the wall: its own newel is the head one)
    wellRail(railX + 0.15, xPart - 0.1, zTop - 0.2, false);
    const room1 = CBZ.interiorFloorRoom ? CBZ.interiorFloorRoom(b, 1) : null;
    const landingZ = zTop - 2.2;
    // it starts at the service core's front face: behind that the core's own
    // shaft wall closes the stair hall
    const core = b.stairPlan || null;
    let zFrom = -b.d / 2 + wt;
    if (core && core.rect && core.rect.x1 > xPart - 0.6 && core.rect.x0 < xPart) zFrom = core.rect.z1;
    if (room1 && CBZ.interiorPartition) {
      CBZ.interiorPartition(room1, { b: b, opts: {} }, { axis: "z", at: xPart, from: zFrom, to: b.d / 2 - wt, gap: landingZ, gapW: 2.6 });
    } else {
      const zs = [[zFrom, landingZ - 1.3], [landingZ + 1.3, b.d / 2 - wt]];
      for (const q of zs) b.lbox(xPart, y1 + (b.FH - 0.3) / 2, (q[0] + q[1]) / 2, 0.2, b.FH - 0.3, q[1] - q[0], 0xd9d4c8, { solid: true, los: true, stair: true });
    }
    // 6. light over the well: a lantern hung from the second floor's slab on
    //    the stair's centre line, clear of the head path (2.1 m over the landing)
    {
      const ly = Math.max(yL + 2.6, b.floorTops[2] - 0.2 - 1.1);
      b.lbox(xc, (ly + b.floorTops[2] - 0.2) / 2, (zL0 + zL1) / 2, 0.04, b.floorTops[2] - 0.2 - ly, 0.04, BRASS, { cast: false, stair: true });
      b.lbox(xc, ly - 0.25, (zL0 + zL1) / 2, 0.6, 0.5, 0.6, 0xfff0c8, { emissive: 0xffe6b0, ei: 0.9, cast: false, stair: true });
    }
    // the first-floor programme furnishes the plate EAST of that wall
    const trim = { x0: xPart + 0.15 };
    b._roomTrim = { 1: trim };
    if (main.lot && main.lot.building) main.lot.building._roomTrim = b._roomTrim;
    const W2 = function (x, y, z) { return { x: ox + x, y: y, z: oz + z }; };
    return {
      bottom: W2(xc, y0, zBot), top: W2(xc, y1, zTop), landing: W2((xW + xPart) / 2, y1, landingZ),
      halfLanding: W2(xc, yL, (zL0 + zL1) / 2),
      width: W, risers: nTot, rise: rise, going: go, treads: treads,
      opening: { minX: ox + xW, maxX: ox + xPart - 0.1, minZ: oz + zTop, maxZ: oz + zBot + 0.4, level: 1 },
      links: [f1 && f1.link ? f1.link.id : null, f2 && f2.link ? f2.link.id : null],
    };
  }

  /* THE MANSION'S PUBLISHED FRAME. Four files hang things on this front and
     ground — the balcony (president_public.js), the regime's banners
     (president_regime.js), the Situation Room (presidency.js) and Executive
     One (motorcade.js) — and each used to re-derive the numbers from a copy
     of this file's constants in a comment. They read these instead. World
     metres; the row's frame is gate-up on +z, so "front" is +z. */
  function publishMansionLayout(site, E) {
    const L = E.layout, main = E.main, b = main && main.b;
    const o = b && b.civicOrder;
    L.facadeZ = L.house.facade.z;
    L.storeyH = b ? b.FH : null;
    L.floorTops = b && b.floorTops ? b.floorTops.slice() : null;
    L.roofY = b ? b.h : null;
    if (o && o.horiz) {
      const cols = o.cols.slice().sort(function (p, q) { return p - q; });
      const mids = [];
      for (let i = 0; i + 1 < cols.length; i++) {
        if (cols[i] < 0 && cols[i + 1] > 0) continue;          // the door bay
        mids.push((cols[i] + cols[i + 1]) / 2);
      }
      L.order = {
        deck: o.deck, entY: o.entY, archUnder: o.archUnder, corniceTop: o.corniceTop, R: o.R,
        colZ: b.oz + o.out * o.colN, colsX: cols.map(function (t) { return b.ox + t; }),
        midsDX: mids,                                         // offsets from the centre line
        doorHead: o.doorHead,
      };
    } else L.order = null;
    // the Situation Room: the east bay at the back of the state floor
    L.sitRoom = { minX: site.cx + 12.5, maxX: site.cx + 25.5, minZ: site.cz - 47.5, maxZ: site.cz - 34.5, wallH: b ? b.FH - 0.2 : 3.0 };
    if (L.helipad) L.heli = { x: L.helipad.x, z: L.helipad.z, y: L.helipad.top, heading: Math.PI };
    L.barrierZ = site.cz + 40;
    return L;
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

  /* ====================================================================
     §2b  THE EXECUTIVE MANSION'S SECURITY GROUND.

     What a real head-of-state residence has at its front gate and on its
     roof, built as geometry and handed to city/protection.js, which owns
     every body and every decision (who gets screened, when the arm lifts,
     who the counter-snipers shoot). Nothing here thinks.

     THE CHECKPOINT (the 24 m gate gap, looking in from the road):
       west  a stone planter from the wall to the vehicle lane, so nobody
             walks round anything
       mid   the VEHICLE LANE (12 m): a red-and-white drop arm across it
             just inside the gate line, and behind that a row of steel
             anti-ram bollards that sink into the road for the motorcade.
             Both carry real colliders while they are up.
       east  the PEDESTRIAN LANE behind a steel rail: an X-ray belt table,
             then a walk-through magnetometer arch with a status lamp on
             its header, rope stanchions sealing either side of it, and a
             sentry kiosk just inside. The only way in on foot is through
             the arch.
     The gatehouse booth on the west side is the guard booth.

     THE ROOF: two counter-sniper stands on opposite parapet corners of the
     Mansion (front-west and rear-east, so between them they see all four
     sides), each a small walkable platform at roof height with a steel
     shield plate and a spotting scope on a tripod.

     THE WALL WALK: a loop 5 m inside the perimeter wall for the agents who
     walk it.

     Every static piece goes through box/col/cyl so the batcher merges it.
     The three MOVING pieces (the arm, the bollards, the lamp) carry
     userData so the batcher leaves them alone, and `gate.step(dt)` animates
     them toward whatever protection.js last asked for.
     ==================================================================== */
  function mansionSecurity(root, R, cx, cz, main, wing) {
    const gz = R.maxZ;                       // the gate line; inside is -Z
    const out = { gate: null, roof: null, walk: [], doors: {}, safe: null, footprints: [], gatePosts: [] };

    // ---- the vehicle lane's west edge: a planter from the wall to the lane
    const planterZ = gz - 2.0;
    box(root, cx - 9.05, 0.45, planterZ, 6.5, 0.9, 0.8, M.stoneD);
    box(root, cx - 9.05, 0.93, planterZ, 6.3, 0.08, 0.6, M.hedge, { cast: false });
    col(cx - 9.05, planterZ, 6.5, 0.8, 0, 0.95);
    // the return to the wall, so the planter's end is not a doorway
    box(root, cx - 12.3, 0.45, gz - 1.2, 0.8, 0.9, 1.6, M.stoneD);
    col(cx - 12.3, gz - 1.2, 0.8, 1.6, 0, 0.95);

    // ---- the lane divider: a steel rail between cars and people
    const divX = cx + 6.3;
    box(root, divX, 0.95, gz - 3.4, 0.08, 0.08, 5.2, M.steel, { cast: false });
    box(root, divX, 0.5, gz - 3.4, 0.05, 0.05, 5.2, M.steel, { cast: false });
    for (const dz of [-0.8, -3.4, -6.0]) cyl(root, divX, 0.5, gz + dz, 0.05, 0.05, 1.0, M.steelD, 6);
    col(divX, gz - 3.4, 0.16, 5.2, 0, 1.0);

    // ---- the walk-through magnetometer
    const ax = cx + 8.4, az = gz - 2.6;
    for (const s of [-1, 1]) {
      box(root, ax + s * 0.66, 1.1, az, 0.22, 2.2, 0.56, M.blank);
      box(root, ax + s * 0.66, 1.1, az, 0.06, 1.9, 0.6, M.blankD, { cast: false });   // the detector panels
      col(ax + s * 0.66, az, 0.22, 0.56, 0, 2.2);
    }
    box(root, ax, 2.35, az, 1.56, 0.3, 0.6, M.blank);
    box(root, ax, 0.02, az, 1.2, 0.04, 0.9, M.dark, { cast: false });               // the mat you stand on
    // THE LAMP. One fresh emissive material shared by the lamp on each face,
    // so recolouring it is one write.
    const lampMat = new THREE.MeshLambertMaterial({ color: 0x1f8f3a, emissive: 0x1f8f3a, emissiveIntensity: 0.55 });
    for (const s of [-1, 1]) {
      const lm = new THREE.Mesh(bg(0.34, 0.12, 0.06), lampMat);
      lm.position.set(ax, 2.35, az + s * 0.33);
      lm.castShadow = false; lm.userData.dynamic = true;
      root.add(lm);
    }
    // rope stanchions either side of the arch, back to the rail and the wall
    function stanchions(x0, x1, z) {
      const n = Math.max(1, Math.round(Math.abs(x1 - x0) / 1.4));
      for (let i = 0; i <= n; i++) cyl(root, x0 + (x1 - x0) * i / n, 0.5, z, 0.04, 0.12, 1.0, M.steelD, 8);
      box(root, (x0 + x1) / 2, 0.86, z, Math.abs(x1 - x0), 0.05, 0.05, M.flagRed, { cast: false });
      col((x0 + x1) / 2, z, Math.abs(x1 - x0), 0.2, 0, 1.0);
    }
    stanchions(divX + 0.1, ax - 0.78, az);
    stanchions(ax + 0.78, cx + 12.4, az);
    box(root, cx + 12.4, 0.5, gz - 1.45, 0.2, 1.0, 2.3, M.steelD);
    col(cx + 12.4, gz - 1.45, 0.2, 2.3, 0, 1.0);

    // ---- the X-ray belt, outside the arch, where you put your bag down
    const tx = cx + 10.6, tz = gz - 0.7;
    box(root, tx, 0.4, tz, 0.7, 0.8, 2.8, M.steelD);
    box(root, tx, 0.82, tz, 0.62, 0.04, 2.8, M.dark, { cast: false });              // the belt
    box(root, tx, 1.15, tz, 0.84, 0.66, 1.1, M.blank);                              // the tunnel
    box(root, tx, 1.15, tz, 0.86, 0.5, 0.9, M.dark, { cast: false });               // its mouth
    box(root, tx + 0.55, 1.2, tz - 1.1, 0.08, 0.4, 0.5, M.dark);                    // the operator's screen
    box(root, tx + 0.55, 0.5, tz - 1.1, 0.1, 1.0, 0.1, M.steelD, { cast: false });   // ...on its stand
    col(tx, tz, 0.84, 2.8, 0, 1.5);

    // ---- the sentry kiosk just inside the pedestrian lane
    const kx = cx + 11.0, kz = gz - 5.6;
    box(root, kx, 1.2, kz, 1.5, 2.4, 1.5, M.stone);
    box(root, kx, 2.47, kz, 1.8, 0.14, 1.8, M.concreteD);
    box(root, kx - 0.76, 1.55, kz, 0.04, 0.8, 1.1, M.glassSteel, { cast: false });
    col(kx, kz, 1.5, 1.5, 0, 2.4);

    // ---- THE DROP ARM (moves). A group at the pivot; up = rotation.z < 0.
    const armZ = gz - 1.6, armY = 1.0, armL = 11.9;
    box(root, divX, 0.55, armZ, 0.5, 1.1, 0.5, M.warn);                             // the pivot housing
    col(divX, armZ, 0.5, 0.5, 0, 1.1);
    const arm = new THREE.Group();
    arm.position.set(divX, armY, armZ);
    arm.userData.dynamic = true;
    const white = cm(0xeeeeea), red = cm(M.red);
    const shaft = new THREE.Mesh(bg(armL, 0.12, 0.12), white);
    shaft.position.set(-armL / 2 - 0.2, 0, 0); shaft.userData.dynamic = true; arm.add(shaft);
    for (let i = 0; i < 6; i++) {
      const st = new THREE.Mesh(bg(0.9, 0.13, 0.13), red);
      st.position.set(-1.0 - i * 2.0, 0, 0); st.userData.dynamic = true; arm.add(st);
    }
    root.add(arm);
    const armCol = { minX: cx - 5.8, maxX: divX - 0.3, minZ: armZ - 0.15, maxZ: armZ + 0.15, y0: 0.0, y1: 1.2, ref: null };

    // ---- THE BOLLARDS (move): one InstancedMesh, raised by rewriting Y.
    const bolZ = gz - 4.2, BR = 0.17, BH = 1.0;
    const bolPts = [];
    for (let i = 0; i < 8; i++) bolPts.push(cx - 5.1 + i * 1.5);
    const bolMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(BR, BR + 0.02, BH, 10), cm(M.steelD), bolPts.length);
    bolMesh.castShadow = true; bolMesh.receiveShadow = true; bolMesh.userData.dynamic = true;
    bolMesh.frustumCulled = false;
    root.add(bolMesh);
    const bolCols = bolPts.map(function (x) { return { minX: x - BR, maxX: x + BR, minZ: bolZ - BR, maxZ: bolZ + BR, y0: 0, y1: BH, ref: null }; });
    for (let i = 0; i < bolPts.length; i++) box(root, bolPts[i], 0.015, bolZ, 0.6, 0.03, 0.6, M.steel, { cast: false });   // the sleeves in the road
    const _o = new THREE.Object3D();
    function placeBollards(t) {
      const y = -BH / 2 + t * BH;            // t 1 = fully up, 0 = flush with the road
      for (let i = 0; i < bolPts.length; i++) {
        _o.position.set(bolPts[i], y, bolZ); _o.rotation.set(0, 0, 0); _o.updateMatrix();
        bolMesh.setMatrixAt(i, _o.matrix);
      }
      bolMesh.instanceMatrix.needsUpdate = true;
      bolMesh.visible = t > 0.02;
    }
    function colOn(c, on) {
      const L = (CBZ.colliders = CBZ.colliders || []);
      const i = L.indexOf(c);
      if (on && i < 0) L.push(c); else if (!on && i >= 0) L.splice(i, 1); else return false;
      return true;
    }

    const LAMP = { idle: [0x1f8f3a, 0.55], pass: [0x2bd65a, 1.3], alarm: [0xff2a1a, 1.8], off: [0x2a2a2a, 0.0] };
    const G = {
      x: cx, z: gz, outX: 0, outZ: 1,
      arch: { x: ax, y: 0, z: az, halfW: 0.55 },
      lane: { minX: divX + 0.1, maxX: cx + 12.4 },          // the pedestrian lane
      vehicle: { minX: cx - 5.8, maxX: divX, z: armZ },     // the vehicle lane
      barrier: { x: cx, z: armZ },
      bollards: { x: cx, z: bolZ },
      lineZ: az,                                            // the screening line
      arm: arm, armT: 0, armWant: 0, bolT: 1, bolWant: 1, lamp: "idle",
      setArm: function (up) { G.armWant = up ? 1 : 0; },
      setBollards: function (up) { G.bolWant = up ? 1 : 0; },
      setLamp: function (k) {
        if (G.lamp === k || !LAMP[k]) return;
        G.lamp = k;
        lampMat.color.setHex(LAMP[k][0]); lampMat.emissive.setHex(LAMP[k][0]); lampMat.emissiveIntensity = LAMP[k][1];
      },
      open: function () { return G.armT > 0.9 && G.bolT < 0.1; },
      // animate toward the wanted state; colliders follow the physical state
      step: function (dt) {
        let dirty = false;
        if (G.armT !== G.armWant) {
          G.armT += Math.sign(G.armWant - G.armT) * Math.min(Math.abs(G.armWant - G.armT), dt / 2.2);
          arm.rotation.z = -G.armT * 1.45;
          dirty = colOn(armCol, G.armT < 0.35) || dirty;
        }
        if (G.bolT !== G.bolWant) {
          G.bolT += Math.sign(G.bolWant - G.bolT) * Math.min(Math.abs(G.bolWant - G.bolT), dt / 3.0);
          placeBollards(G.bolT);
          const up = G.bolT > 0.4;
          for (let i = 0; i < bolCols.length; i++) dirty = colOn(bolCols[i], up) || dirty;
        }
        if (dirty && CBZ.markCollidersDirty) { try { CBZ.markCollidersDirty(); } catch (e) {} }
      },
    };
    // closed at build: arm down, bollards up
    placeBollards(1);
    colOn(armCol, true);
    for (let i = 0; i < bolCols.length; i++) colOn(bolCols[i], true);
    out.gate = G;

    // the posts at the gate (x, z, facing out to the road); `lockdown` posts
    // are manned only while the capital is locked down
    out.gatePosts = [
      { id: "arch", x: ax - 1.1, z: az - 1.4, face: 0, role: "gate" },
      { id: "lane", x: cx + 4.6, z: gz - 6.4, face: 0, role: "gate" },
      { id: "booth", x: cx - 5.4, z: gz - 6.0, face: 0, role: "gate" },
      { id: "lock0", x: cx - 2.2, z: gz - 5.8, face: 0, role: "gate", lockdown: true },
      { id: "lock1", x: cx + 2.0, z: gz - 5.8, face: 0, role: "gate", lockdown: true },
    ];

    // ---- THE ROOF STANDS
    const mb = main && main.b;
    const roofY = (mb && Array.isArray(mb.floorTops) && mb.floorTops.length) ? mb.floorTops[mb.floorTops.length - 1]
      : (mb && mb.h) || 6.4;
    const mx = cx, mz = cz - 34, hw = 28, hd = 17;
    const stands = [
      { team: "A", x: mx - hw + 2.4, z: mz + hd - 2.4, ox: -1, oz: 1 },    // front-west
      { team: "B", x: mx + hw - 2.4, z: mz - hd + 2.4, ox: 1, oz: -1 },    // rear-east
    ];
    const roofPosts = [];
    for (let i = 0; i < stands.length; i++) {
      const s = stands[i];
      plat(s.x, s.z, 4.2, 4.2, roofY);
      const face = Math.atan2(s.ox, s.oz);
      // the shield plate stands at the outer corner of the stand
      const px = s.x + s.ox * 1.3, pz = s.z + s.oz * 1.3;
      box(root, px, roofY + 0.55, pz, 1.7, 1.1, 0.1, M.steelD, { rotY: face });
      col(px, pz, 1.3, 1.3, roofY, roofY + 1.1);
      // a spotting scope on a tripod
      const sx = s.x + s.ox * 0.4 + s.oz * 0.9, sz = s.z + s.oz * 0.4 - s.ox * 0.9;
      cyl(root, sx, roofY + 0.62, sz, 0.02, 0.09, 1.24, M.dark, 6);
      box(root, sx, roofY + 1.3, sz, 0.1, 0.1, 0.5, M.dark, { rotY: face });
      roofPosts.push({ team: s.team, role: "sniper", x: s.x - s.oz * 0.6, y: roofY, z: s.z + s.ox * 0.6, face: face });
      roofPosts.push({ team: s.team, role: "spotter", x: s.x + s.oz * 0.8, y: roofY, z: s.z - s.ox * 0.8, face: face });
    }
    out.roof = { y: roofY, posts: roofPosts };

    // ---- THE WALL WALK (a loop 5 m inside the wall, 10 m behind the gate)
    out.walk = [
      { x: R.minX + 5, z: R.maxZ - 10 }, { x: R.minX + 5, z: R.minZ + 5 },
      { x: R.maxX - 5, z: R.minZ + 5 }, { x: R.maxX - 5, z: R.maxZ - 10 },
    ];

    // ---- doors, the safe point, the footprints the detail treats as indoors
    if (main && main.door) {
      out.doors.mansion = { x: main.door.x, z: main.door.z, nx: main.door.nx, nz: main.door.nz };
      out.safe = { x: main.door.x + main.door.nx * 6, z: main.door.z + main.door.nz * 6 };
    }
    if (wing && wing.door) out.doors.wing = { x: wing.door.x, z: wing.door.z, nx: wing.door.nx, nz: wing.door.nz };
    out.footprints = [
      { name: "mansion", minX: mx - hw, maxX: mx + hw, minZ: mz - hd, maxZ: mz + hd },
      { name: "wing", minX: cx - 58 - 17, maxX: cx - 58 + 17, minZ: cz - 30 - 11, maxZ: cz - 30 + 11 },
    ];
    return out;
  }

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

  /* THE TWO STATE RESIDENCES AS ESTATE SPECS (§1b). Gate-up frame, metres
     from the site centre: v toward the gate, u across. Everything the kit is
     not told, the tier decides. */
  const MANSION_ESTATE = {
    tier: 5, name: "execmansion", checkpoint: true,
    // A real head-of-state house: 56 x 34 m on plan (the White House is
    // 51 x 26), THREE storeys at 4.5 m (state rooms, the family floor, the
    // private floor) under a colossal doric order: 13.5 m to the roof
    // instead of the 6.4 m dollhouse two 3.2 m office storeys made. A HOUSE,
    // not a capitol: no dome. It is roofed in slate behind a balustrade, with
    // chimneys, a projecting pedimented portico on the carriage front and a
    // bowed portico with a balcony on the garden front (houseDress).
    house: {
      v: -34, w: 56, d: 34, storeys: 3, fh: 4.5, hex: M.marble, name: "Executive Mansion", perron: 9,
      civic: { kind: "mansion", crown: "none", order: "doric", stone: true, monumental: true, externalPerron: true, balustrade: true, seal: false },
      dress: { clad: true, balustrade: true, roof: "hip", chimneys: 4, portico: { depth: 7, half: 12 }, south: { r: 5.6, n: 6 }, seal: "mansion" },
    },
    // the office wing, its door on the house side, a colonnade to the court:
    // a low stone block with its own rusticated entrance front
    wings: [{
      u: -58, v: -30, w: 34, d: 22, storeys: 2, fh: 4.2, hex: M.stone, name: "West Wing", colonnade: true,
      civic: { kind: "federal", crown: "flat", order: "pilaster", stone: true, monumental: true, balustrade: true },
      dress: { clad: true, balustrade: true, chimneys: 2 },
    }],
    // the motorcade's garage: four drive-in bays on the east side of the
    // court, doors toward the house, an apron to the carriage ring
    garage: { u: 60, v: 4, w: 12, d: 18.4, bays: 4, open: [0, 1] },
    // the carriage court: the motorcade's ring (motorcade.js §3) runs at
    // 22-26 m round the island at v 18 and stops at the steps at v -4.5
    forecourt: { v0: -8.2, v1: 46, hw: 32, island: 13, islandV: 18 },
    driveW: 11,
    pedLane: [6.4, 12.4],                 // the checkpoint's walk-through lane (§2b)
    helipad: { u: 74, v: 62, r: 12 },      // the east lawn, 42 m clear of the court
    parking: { u: -72, v: 12, w: 50, d: 26 },
    parterres: [{ u: -81, v: -66, w: 38, d: 26 }, { u: 81, v: -66, w: 38, d: 26 }],
    rear: { rondelV: -104 },
    // specimen trees on the lawns, none within 45 m of the helipad's approach
    trees: [[-60, 70], [-92, 58], [-78, 100], [-108, 84], [-48, 104], [44, 100], [108, 106],
      [-40, -100], [40, -100], [-110, -20], [110, -22], [-110, -100], [110, -100], [-104, -44], [60, -24], [100, 12]],
  };
  const GOVERNOR_ESTATE = {
    tier: 4, name: "governor",
    house: {
      v: -26, w: 42, d: 28, storeys: 2, fh: 4.2, hex: M.stone, name: "Governor's Residence", perron: 7,
      civic: { kind: "cityannex", crown: "clock", order: "pilaster", stone: true, monumental: true, externalPerron: true, balustrade: true, seal: false },
      dress: { clad: true, balustrade: true, chimneys: 2, portico: { depth: 5.2, half: 10 }, ionic: true, seal: "cityannex" },
    },
    // the garage: three drive-in bays, doors toward the house (it was a
    // one-storey shell with the downtown flagship's glass parking deck on it)
    garage: { u: -54, v: 2, w: 12, d: 14.2, bays: 3, open: [0] },
    forecourt: { v1: 40, hw: 25, island: 9 },
    driveW: 9,
    parterres: [{ u: -36, v: -62, w: 26, d: 20 }, { u: 36, v: -62, w: 26, d: 20 }],
    rear: { rondelV: -74 },
    trees: [[-60, 60], [60, 60], [-70, -20], [70, -20], [-40, 76], [40, 76]],
  };

  /* ====================================================================
     §2c  THE FEDERAL KIT — what turns an office block into a headquarters.

     Rows 4 (the Bureau) and 5 (the Defence HQ) draw from it; nothing else
     does. The base shell stays the city's glass office building ("our glass
     is perfect"). What a real federal headquarters adds over that glass is
     a FRAME, a way of meeting the ground, one way in, and plant on the roof
     that is there because the building needs it:

       fedFrame     tripartite precast dress: a solid granite base course, a
                    deep belt course at the first floor, precast fins on a
                    3 m module so the glass reads as tall window strips set
                    half a metre back, a band at every floor line, corner
                    piers, and a deep cornice over the parapet. Nothing is
                    proud of the wall below head height except the base
                    course and the corner piers, and both are solid.
       fedEntrance  the one door: a stepped stylobate (§1 perron), a flat
                    canopy cantilevered off four columns with downlights in
                    its soffit, and the fins stop over the entrance bay so
                    the doorway reads from 200 m as a tall slot of glass.
       fedRoof      a louvred mechanical penthouse, cooling towers with fan
                    shrouds, exhaust stacks and a comms mast with dishes,
                    every piece placed off the stair core the shell reserved
                    and inside the parapet, every piece solid.

     Fins are two InstancedMeshes per building, bands and caps are plain
     static boxes the batcher folds: a headquarters costs a handful of draws.
     ==================================================================== */
  const FEDM = {
    precast: 0xd3cfc4, precastD: 0xaeaa9f, granite: 0x55575b, canopy: 0xdcd8ce, soffit: 0x3b3f45,
    downlight: 0xfff0d2, plant: 0x9a9fa3, plantD: 0x676c71, louvre: 0x4a4f55, glass: 0x28323c,
  };
  // the four faces of a shell, each with its outward normal and its span
  function faces4(b) {
    const ox = b.ox, oz = b.oz, hw = b.w / 2, hd = b.d / 2;
    return [
      { ax: "x", nx: 0, nz: -1, cx: ox, cz: oz - hd, span: b.w },
      { ax: "x", nx: 0, nz: 1, cx: ox, cz: oz + hd, span: b.w },
      { ax: "z", nx: -1, nz: 0, cx: ox - hw, cz: oz, span: b.d },
      { ax: "z", nx: 1, nz: 0, cx: ox + hw, cz: oz, span: b.d },
    ];
  }
  // a box standing proud of face f: `t` along the face, p0..p1 metres out
  // from the wall plane (negative = into the wall), y0..y1
  function faceXZ(f, t, p) {
    return f.ax === "x" ? { x: f.cx + t, z: f.cz + f.nz * p } : { x: f.cx + f.nx * p, z: f.cz + t };
  }
  function onFace(root, f, t, len, y0, y1, p0, p1, hex, o) {
    const q = faceXZ(f, t, (p0 + p1) / 2), dep = p1 - p0;
    return box(root, q.x, (y0 + y1) / 2, q.z, f.ax === "x" ? len : dep, y1 - y0, f.ax === "x" ? dep : len, hex, o);
  }
  function faceCol(f, t, len, p0, p1, y0, y1) {
    const q = faceXZ(f, t, (p0 + p1) / 2), dep = p1 - p0;
    return col(q.x, q.z, f.ax === "x" ? len : dep, f.ax === "x" ? dep : len, y0, y1);
  }
  function isDoorFace(f, S) { return f.nx === -S.n.x && f.nz === -S.n.z; }
  function doorAlong(f, S) { return f.ax === "x" ? S.door.x - f.cx : S.door.z - f.cz; }

  function fedFrame(root, S, o) {
    o = o || {};
    const b = S.b, FH = b.FH, ST = b.storeys, rTop = ST * FH, pp = b.parapetH || 0.8;
    const gap = o.gap == null ? 12 : o.gap, pitch = o.pitch || 3.0;
    const BASE = 0.95, BELT0 = FH - 0.45, BELT1 = FH + 0.45;
    const TOP = rTop + pp + 0.2;
    const finX = [], finZ = [];
    for (const f of faces4(b)) {
      const door = isDoorFace(f, S), dt = door ? doorAlong(f, S) : 0, half = f.span / 2;
      // THE BASE COURSE: granite to 0.95 m with a weathered cap, split at the door
      const segs = door ? [[-half, dt - gap / 2], [dt + gap / 2, half]] : [[-half, half]];
      for (const s of segs) {
        if (s[1] - s[0] < 0.3) continue;
        const t = (s[0] + s[1]) / 2, len = s[1] - s[0];
        onFace(root, f, t, len, 0, BASE, -0.04, 0.24, FEDM.granite, { cast: false });
        onFace(root, f, t, len, BASE, BASE + 0.08, -0.04, 0.30, FEDM.precastD, { cast: false });
        faceCol(f, t, len, -0.04, 0.30, 0, BASE + 0.08);
      }
      // THE BELT COURSE at the first floor, a BAND at every floor line above
      onFace(root, f, 0, f.span, BELT0, BELT1, -0.04, 0.62, FEDM.precast);
      for (let k = 2; k < ST; k++) onFace(root, f, 0, f.span, k * FH - 0.28, k * FH + 0.22, -0.04, 0.34, FEDM.precast, { cast: false });
      // THE CORNICE over the parapet: a deep cap, the shadow line under it, a coping
      onFace(root, f, 0, f.span + 0.2, rTop - 0.55, TOP, -0.04, 0.9, FEDM.precast);
      onFace(root, f, 0, f.span, rTop - 0.75, rTop - 0.55, -0.04, 0.55, FEDM.precastD, { cast: false });
      onFace(root, f, 0, f.span + 0.4, TOP, TOP + 0.12, -0.04, 1.0, FEDM.precastD, { cast: false });
      // THE FINS on the module; the corner piers own the corners, the entrance
      // bay stays open glass from the canopy to the cornice
      const n = Math.max(2, Math.round(f.span / pitch));
      for (let i = 1; i < n; i++) {
        const t = -half + f.span * i / n;
        if (door && Math.abs(t - dt) < gap / 2) continue;
        (f.ax === "x" ? finX : finZ).push(faceXZ(f, t, 0.27));
      }
    }
    const fy = (BELT1 + rTop - 0.55) / 2, fh = rTop - 0.55 - BELT1;
    if (fh > 0.5) {
      repeat(root, bg(0.42, fh, 0.62), FEDM.precast, finX, function () { return fy; });
      repeat(root, bg(0.62, fh, 0.42), FEDM.precast, finZ, function () { return fy; });
    }
    // CORNER PIERS, grade to cornice, solid
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x = b.ox + sx * (b.w / 2 + 0.05), z = b.oz + sz * (b.d / 2 + 0.05);
      box(root, x, TOP / 2, z, 1.3, TOP, 1.3, FEDM.precast);
      col(x, z, 1.3, 1.3, 0, TOP);
    }
    return { rTop: rTop, top: TOP };
  }

  // THE ONE WAY IN. `o.w` the canopy's width, `o.reach` how far it and the
  // stylobate reach out from the facade.
  function fedEntrance(root, S, o) {
    o = o || {};
    const n = S.n, ox = -n.x, oz = -n.z;                  // outward
    const fx = S.door.x + ox * 1.6, fz = S.door.z + oz * 1.6;   // the facade point at the door
    const axis = Math.abs(ox) > 0.5 ? "x" : null, dir = axis ? ox : oz;
    const tx = -oz, tz = ox;                               // along the facade
    const W = o.w || 16, R = o.reach || 7.2;
    perron(root, fx, fz, W - 2, R - 1.2, M.stone, dir, axis);
    // the canopy: a flat plate cantilevered out, its soffit dark, a fascia lip
    const y0 = o.soffit || 3.3, th = 0.34;
    const cx0 = fx + ox * R / 2, cz0 = fz + oz * R / 2;
    const cw = axis ? R : W, cd = axis ? W : R;
    box(root, cx0, y0 + th / 2, cz0, cw, th, cd, FEDM.canopy);
    box(root, cx0, y0 - 0.015, cz0, cw - 0.5, 0.03, cd - 0.5, FEDM.soffit, { cast: false });
    box(root, fx + ox * (R - 0.08), y0 + th / 2, fz + oz * (R - 0.08), axis ? 0.16 : W + 0.1, th + 0.14, axis ? W + 0.1 : 0.16, FEDM.precastD, { cast: false });
    // four columns on the outer edge, clear of the stylobate, on the ground
    for (const s of [-1, -1 / 3, 1 / 3, 1]) {
      const lat = s * (W / 2 - 0.6);
      const x = fx + ox * (R - 0.6) + tx * lat, z = fz + oz * (R - 0.6) + tz * lat;
      cyl(root, x, y0 / 2, z, 0.22, 0.24, y0, FEDM.plantD, 12);
      box(root, x, 0.06, z, 0.7, 0.12, 0.7, FEDM.granite, { cast: false });
      col(x, z, 0.5, 0.5, 0, y0);
    }
    // downlights in the soffit: one instanced, lit draw
    const pts = [];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
      const lat = (i - 1.5) * (W / 4.4), dep = R * (0.3 + j * 0.4);
      pts.push({ x: fx + ox * dep + tx * lat, z: fz + oz * dep + tz * lat });
    }
    repeat(root, bg(0.36, 0.03, 0.36), FEDM.downlight, pts, function () { return y0 - 0.045; }, null, { emissive: FEDM.downlight, ei: 0.9 });
    return { x: fx, z: fz };
  }

  // ROOF PLANT that belongs there. Everything is kept `margin` inside the
  // parapet and off the stair/lift reservations the shell made at build.
  function fedRoof(root, S, o) {
    o = o || {};
    const b = S.b, y = b.storeys * b.FH, M0 = o.margin == null ? 3.2 : o.margin;
    const busy = (b.shaftRects || []).concat(b.keepRects || []).map(function (q) {
      return { x0: b.ox + q.x0 - 1.5, x1: b.ox + q.x1 + 1.5, z0: b.oz + q.z0 - 1.5, z1: b.oz + q.z1 + 1.5 };
    });
    const X0 = b.ox - b.w / 2 + M0, X1 = b.ox + b.w / 2 - M0, Z0 = b.oz - b.d / 2 + M0, Z1 = b.oz + b.d / 2 - M0;
    const taken = [];
    function free(x, z, w, d) {
      if (x - w / 2 < X0 || x + w / 2 > X1 || z - d / 2 < Z0 || z + d / 2 > Z1) return false;
      const all = busy.concat(taken);
      for (const q of all) if (x - w / 2 < q.x1 && x + w / 2 > q.x0 && z - d / 2 < q.z1 && z + d / 2 > q.z0) return false;
      return true;
    }
    function place(w, d, prefer) {
      for (let i = 0; i < prefer.length; i++) {
        const p = prefer[i];
        if (free(p.x, p.z, w, d)) { taken.push({ x0: p.x - w / 2 - 1.2, x1: p.x + w / 2 + 1.2, z0: p.z - d / 2 - 1.2, z1: p.z + d / 2 + 1.2 }); return p; }
      }
      return null;
    }
    const long = b.w >= b.d, L = long ? b.w : b.d;
    function along(f, off) { return long ? { x: b.ox + f * L, z: b.oz + (off || 0) } : { x: b.ox + (off || 0), z: b.oz + f * L }; }
    const cands = [0, 0.18, -0.18, 0.3, -0.3, 0.1, -0.1].map(function (f) { return along(f); });
    // 1. THE PENTHOUSE: a louvred enclosure the air handlers live in
    const pw = Math.min((long ? b.w : b.d) * 0.26, o.penthouse || 26), pd = Math.min((long ? b.d : b.w) * 0.42, 12), ph = 4.2;
    const P = place(long ? pw : pd, long ? pd : pw, cands);
    if (P) {
      const w = long ? pw : pd, d = long ? pd : pw;
      box(root, P.x, y + ph / 2, P.z, w, ph, d, FEDM.plant);
      for (let i = 0; i < 4; i++) box(root, P.x, y + 1.1 + i * 0.7, P.z, w + 0.06, 0.16, d + 0.06, FEDM.louvre, { cast: false });
      box(root, P.x, y + ph + 0.12, P.z, w + 0.5, 0.24, d + 0.5, FEDM.plantD);
      col(P.x, P.z, w, d, y, y + ph + 0.24);
      // two upblast fans on its lid
      for (const s of [-1, 1]) {
        const fx = P.x + (long ? s * w * 0.25 : 0), fz = P.z + (long ? 0 : s * d * 0.25);
        cyl(root, fx, y + ph + 0.24 + 0.45, fz, 0.9, 1.05, 0.9, FEDM.plantD, 14);
        cyl(root, fx, y + ph + 0.24 + 0.95, fz, 0.7, 0.9, 0.1, FEDM.louvre, 14);
      }
    }
    // 2. COOLING TOWERS: two boxes with fan shrouds
    for (let k = 0; k < 2; k++) {
      const C = place(4.4, 4.4, [along(0.36, 0), along(-0.36, 0), along(0.42, 0), along(-0.42, 0), along(0.24, 0), along(-0.24, 0)]);
      if (!C) continue;
      box(root, C.x, y + 1.6, C.z, 4.2, 3.2, 4.2, FEDM.plant);
      for (let i = 0; i < 5; i++) box(root, C.x, y + 0.5 + i * 0.5, C.z, 4.26, 0.08, 4.26, FEDM.louvre, { cast: false });
      cyl(root, C.x, y + 3.2 + 0.5, C.z, 1.7, 1.9, 1.0, FEDM.plantD, 16);
      col(C.x, C.z, 4.2, 4.2, y, y + 4.2);
    }
    // 3. EXHAUST STACKS in a row
    const E = place(1.4, 5.0, [along(-0.12, (long ? b.d : b.w) * 0.22), along(0.12, -(long ? b.d : b.w) * 0.22), along(0.4, (long ? b.d : b.w) * 0.2)]);
    if (E) for (let i = -1; i <= 1; i++) {
      const x = E.x + (long ? 0 : i * 1.5), z = E.z + (long ? i * 1.5 : 0);
      cyl(root, x, y + 1.6, z, 0.34, 0.38, 3.2, FEDM.plantD, 10);
      col(x, z, 0.8, 0.8, y, y + 3.2);
    }
    // 4. THE COMMS MAST with its dishes (the reason an agency has a roof)
    if (o.mast !== false) {
      const Q = place(3.0, 3.0, [along(-0.4, 0), along(0.4, 0), along(-0.33, 0), along(0.33, 0)]);
      if (Q) {
        const mh = o.mast || 14;
        box(root, Q.x, y + 0.2, Q.z, 2.6, 0.4, 2.6, FEDM.plantD, { cast: false });
        cyl(root, Q.x, y + 0.4 + mh / 2, Q.z, 0.14, 0.24, mh, M.steel, 8);
        for (const s of [-1, 1]) {
          const d = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.2, 0.35, 16), cm(FEDM.canopy));
          d.position.set(Q.x + s * 0.55, y + 0.4 + mh * (s > 0 ? 0.62 : 0.48), Q.z);
          d.rotation.z = s * Math.PI / 2 * 0.8; d.castShadow = true; root.add(d);
        }
        box(root, Q.x, y + 0.4 + mh + 0.1, Q.z, 0.12, 0.2, 0.12, M.red, { cast: false, matOpts: { emissive: M.red, ei: 0.8 } });
        col(Q.x, Q.z, 0.6, 0.6, y, y + 0.4 + mh);
      }
    }
  }

  /* THE RING'S WINDOWS. ringHQ drew five rings of blank 23 m bands, which is
     a silhouette and not a building. Every storey of the outer ring's outer
     face, and of the innermost ring's courtyard face, gets its punched
     windows: dark glass set into the stone with a pale sill, on a 2.6 m
     module, kept 5 m off every corner. Two instanced draws for all of them.
     The light wells between rings (9 m slots you only see from the air) stay
     plain on purpose. */
  function ringWindows(root, cx, cz, R) {
    const G = [], S = [];
    const TAN = Math.tan(Math.PI / 5);
    const faces = [{ apo: R.apothem, out: 1 }];
    if (R.innerFace > 8) faces.push({ apo: R.innerFace, out: -1 });
    for (const F of faces) {
      const half = F.apo * TAN - 5.0;
      if (half < 3) continue;
      const n = Math.floor((half * 2) / 2.6);
      for (let s = 0; s < 5; s++) {
        const a = R.rot0 + s * (Math.PI * 2 / 5);
        const nx = Math.cos(a), nz = Math.sin(a), tx = -Math.sin(a), tz = Math.cos(a);
        const yaw = -(a + Math.PI / 2);
        const off = F.apo + F.out * 0.03;
        for (let i = 0; i <= n; i++) {
          const t = -half + (half * 2) * (i / n);
          for (let k = 0; k < R.storeys; k++) {
            const y = k * R.FH + 1.05;
            G.push({ x: cx + nx * off + tx * t, z: cz + nz * off + tz * t, y: y + 1.0, r: yaw });
            S.push({ x: cx + nx * (F.apo + F.out * 0.08) + tx * t, z: cz + nz * (F.apo + F.out * 0.08) + tz * t, y: y - 0.06, r: yaw });
          }
        }
      }
    }
    repeat(root, bg(1.35, 2.0, 0.12), FEDM.glass, G, null, null);
    repeat(root, bg(1.6, 0.12, 0.2), FEDM.precastD, S, null, null);
    return G.length;
  }

  /* THE PUBLIC PRECINCTS' GROUND (the Capitol, City Hall). They are not
     estates, but the law is §1c's: the height you stand on is the height that
     is drawn there. The row files each surface it lays and the one provider
     (estateGroundAt) answers for it — the pad at YP, a lawn at YG, paving at
     YS, a kerb at its top — so nobody walks 10 cm inside the forecourt. */
  function civicGround(c) {
    const EG = { rect: c.rect, base: YP, rects: [], discs: [] };
    ESTATE_GROUND.push(EG);
    return {
      eg: EG,
      slab: function (root, x, z, w, d, hex, y) {
        slab(root, x, z, w, d, hex, y);
        EG.rects.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, y: y });
      },
      // building-local rects {x0,x1,z0,z1,y} a shell's own kit drew
      file: function (b, list) {
        for (const r of list || []) EG.rects.push({ minX: b.ox + r.x0, maxX: b.ox + r.x1, minZ: b.oz + r.z0, maxZ: b.oz + r.z1, y: r.y });
      },
    };
  }

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
      // the centre block: the rotunda under the dome on the ground floor, the
      // galleries round its well with committee rooms and members' offices on
      // the two floors above. Each wing is a CHAMBER: the house floor on the
      // ground, the public gallery and committee rooms over it
      // (city/interior_programs.js, "THE LEGISLATURE").
      interiors: { main: ["rotunda", "capitolfloor", "capitolfloor"], aux: ["chamber", "chambergallery"] },
      build: function (c) {
        const R = c.rect, root = c.root, cx = c.cx, cz = c.cz;
        pad(root, R, M.paving, "capitol");
        const G = civicGround(c);
        /* THE CAPITOL, AT A LEGISLATURE'S SCALE. The old row was a 92 m office
           box three 3.2 m storeys tall (9.6 m: lower than a town hall) with a
           30 cm perron and a registry line asking for a dome and an order that
           the renderer had switched off. Now: three 5 m storeys (15 m to the
           cornice), a projecting portico on the principal floor reached by two
           broad flights, the public door at grade through the arcade under it,
           and a peristyle drum and dome that put the lantern at ~52 m. The
           wings are the two chambers, each with its own pedimented front. */
        const SPEC = { kind: "capitol", crown: "dome", order: "ionic", stone: true,
          monumental: true, externalPerron: true, hostOrder: true, hostCrown: true };
        const main = civic(root, cx, cz - 40, 92, 56, 3, M.marble, 1, SPEC, "The Capitol", { fh: 5.0 });   // front face z -12
        c.main = main;
        const wings = [];
        for (const w of [{ s: -1, name: "Senate Wing", motto: "SENATE", house: "senate" }, { s: 1, name: "Assembly Wing", motto: "ASSEMBLY", house: "assembly" }]) {
          const wb = civic(root, cx + w.s * 80, cz - 34, 44, 38, 2, M.stone, 1,
            { kind: "capitol", crown: "pediment", order: "ionic", motto: w.motto, stone: true,
              monumental: true, externalPerron: true, hostCrown: true }, w.name, { fh: 5.0 });     // front face z -15
          if (!wb) continue;
          // the full width of the front: the engaged order stands on the deck,
          // every column of it (a 30 m perron left the outer ones in the air)
          perron(root, cx + w.s * 80, cz - 15, 42.6, 8, M.stone, 1);                                 // z -15..-7
          wb.b._civicPlan = { kind: "chamber", house: w.house };
          wings.push(wb);
        }
        const K = CBZ.civicMonument;
        let por = null, dom = null;
        if (main && K) {
          try { por = K.portico(main.b, { depth: 11, half: 19, flightW: 8, ground: YS, stone: M.marble, stoneD: 0xc9c4b4 }); }
          catch (e) { console.error("[govcomplex] capitol portico", e); }
          try { dom = K.dome(main.b, { R: 12.9, stone: M.marble }); }
          catch (e) { console.error("[govcomplex] capitol dome", e); }
          if (por) G.file(main.b, por.ground);
          // the plan the rotunda and the gallery floors are drawn from: the
          // well under the dome is a square inside the drum's inner circle
          // (the column ring at 11.2 m, the well 14.8 m square: its corners stay
          // inside the drum's inner wall, 12.3 m out, and inside the ring beam)
          const plan = { kind: "capitol", rotunda: { x: 0, z: 0, r: 11.2, well: 7.4, band: 12.5 }, dome: dom, portico: por };
          main.b._civicPlan = plan;
          if (main.lot && main.lot.building) main.lot.building._civicPlan = plan;
        }
        // THE FORECOURT between the flights and the MALL beyond it: paving
        // under the arcade's mouth, the stone axis with the reflecting pool in
        // its kerb, lawn either side. Nothing is drawn where the flights and
        // their aprons already are (a second slab there is a z-fight).
        const zFoot = por ? por.zBot + (main.b.oz - cz) + 2.0 : 16;       // relative z of the aprons' outer edge
        G.slab(root, cx, cz + (-1 + zFoot) / 2, 38, zFoot + 1, M.stone, YS);                  // x -19..+19, z -1..foot
        G.slab(root, cx, cz + (zFoot + 104) / 2, 44, 104 - zFoot, M.stone, YS);              // x -22..+22, z foot..+104
        G.slab(root, cx - 58, cz + 54, 58, 100, M.lawn, YG);                                  // x -87..-29, z +4..+104
        G.slab(root, cx + 58, cz + 54, 58, 100, M.lawn, YG);                                  // x +29..+87
        const pz0 = cz + 40, pz1 = cz + 98;
        slab(root, cx, (pz0 + pz1) / 2, 17, pz1 - pz0, M.water, YM);
        for (const e of [[cx, pz0 - 0.2, 17.8, 0.4], [cx, pz1 + 0.2, 17.8, 0.4], [cx - 8.7, (pz0 + pz1) / 2, 0.4, pz1 - pz0], [cx + 8.7, (pz0 + pz1) / 2, 0.4, pz1 - pz0]]) {
          box(root, e[0], 0.2, e[1], e[2], 0.4, e[3], M.stoneD, { cast: false });
          G.eg.rects.push({ minX: e[0] - e[2] / 2, maxX: e[0] + e[2] / 2, minZ: e[1] - e[3] / 2, maxZ: e[1] + e[3] / 2, y: 0.4 });
        }
        // THE HYPHENS: an open colonnade from the centre block to each wing
        if (K) for (const s of [-1, 1]) {
          try {
            const hy = K.colonnade(root, { x0: cx + s * 46 - (s > 0 ? 0 : 12), x1: cx + s * 46 + (s > 0 ? 12 : 0), z0: cz - 31, z1: cz - 22, h: 4.2, stone: M.marble, ground: YS });
            if (hy) G.eg.rects.push({ minX: hy.ground.x0, maxX: hy.ground.x1, minZ: hy.ground.z0, maxZ: hy.ground.z1, y: hy.ground.y });
          } catch (e) { console.error("[govcomplex] capitol colonnade", e); }
        }
        flagpole(root, cx - 34, cz + 20, 16);
        flagpole(root, cx + 34, cz + 20, 16);
        const lamps = [];
        for (let i = 0; i < 7; i++) {
          lamps.push({ x: cx - 26, z: cz + 26 + i * 11 });         // z +26..+92
          lamps.push({ x: cx + 26, z: cz + 26 + i * 11 });
        }
        lampRow(root, lamps);
        // a public building is protected by BOLLARDS, not by a wall. This is
        // the whole difference between the Capitol and the Agency.
        bollardLine(root, cx, cz + 30, 21.6, new THREE.CylinderGeometry(0.24, 0.28, 1.0, 8), 0.28, 1.0);
        // VISITOR PARKING, one lot per flank, off the ceremonial axis and 2 m
        // clear of the lawns' outer edges at x +/-87.
        parkingSea(root, cx - 108, cz + 64, 42, 88);               // x -129..-87, z +20..+108
        parkingSea(root, cx + 108, cz + 64, 42, 88);               // x  +87..+129, z +20..+108
        G.eg.rects.push({ minX: cx - 129, maxX: cx - 87, minZ: cz + 20, maxZ: cz + 108, y: YG });
        G.eg.rects.push({ minX: cx + 87, maxX: cx + 129, minZ: cz + 20, maxZ: cz + 108, y: YG });
        if (c.site) c.site.capitol = { portico: por, dome: dom, wings: wings.length };
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
      interiors: { main: ["statehall", "stateresidence", "stateprivate"], aux: ["cabinetroom", "ovaloffice"] },
      // the service stair takes the WEST back corner: the Situation Room
      // (presidency.js) owns the east bay and the grand stair the west flank
      stairSide: -1,
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
        const E = estate(c, MANSION_ESTATE);
        const main = E.main, wing = E.wings[0];
        c.main = main;
        if (c.site) {
          c.site.layout = E.layout;
          publishMansionLayout(c.site, E);
          try { c.site.grandStair = grandStair(main, E.layout); }
          catch (e) { console.error("[govcomplex] grand stair", e); }
          // THE SECRET SERVICE'S GROUND (§2b): the checkpoint at the gate, the
          // counter-sniper stands on the roof, the wall walk. Geometry here;
          // every body and every decision is protection.js's.
          try { c.site.security = mansionSecurity(root, R, cx, cz, main, wing); }
          catch (e) { console.error("[govcomplex] mansion security", e); }
        }
        return { gate: E.gate, seat: main };
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
      // a HOUSE: hall, drawing room, dining room, study downstairs; the
      // principal bedroom, a guest room and the family sitting room upstairs
      interiors: { main: ["govresidence", "govprivate"], aux: ["storage"] },
      household: [
        { job: "housekeeper", at: "door", outfit: 0xd8dce0 },
        { job: "estate cook", at: "yard", outfit: 0xe8eaec },
        { job: "chauffeur", at: "court", pose: "foldarms", outfit: 0x2b2f36 },
        { job: "groundskeeper", at: "garden", outfit: 0x4f6a3a },
      ],
      build: function (c) {
        const E = estate(c, GOVERNOR_ESTATE);
        c.main = E.main;
        if (c.site) c.site.layout = E.layout;
        return { gate: E.gate, seat: E.main };
      },
    },
    /* ================================================================
       4. THE BUREAU — an intelligence headquarters on a fenced campus.

       Read from the gate inwards, the way you arrive: a guarded east gate,
       a lit approach drive with the two staff lots off it, a paved plaza
       with three flags, and the one way in, a canopy over a stepped
       stylobate in the middle of a long precast-and-glass slab (six storeys
       at 4 m, the proportions of a real headquarters block rather than a
       stack of 3.2 m shop floors). A taller wing stands east of it with its
       own staff door on the car-park side, and a low operations annex sits
       behind across a service yard. The antenna farm and the plant are
       where plant goes: the north fence and the roofs. No seal, no name,
       no signage anywhere; the ABSENCE of a sign is still the identity.

       Inside the slab, floor by floor: the security lobby (screening and a
       wall-to-wall turnstile line), the watch floor, a desk floor, the
       briefing room, a second desk floor, and the Director's suite on top.
       ================================================================ */
    {
      id: "agency", name: "Bureau Headquarters", subtitle: "Restricted Federal Facility",
      hx: 154, hz: 132, bearing: 248, keepOut: "hard", gateSide: 3,
      principal: { key: null, tier: 4, org: "agency", lawful: true, role: "Director of the Bureau", job: "official", wealth: 0.8 },
      // the wing and the annex share `aux`: an arrival floor, then desks
      interiors: {
        main: ["securitylobby", "opscenter", "deskfarm", "briefingroom", "deskfarm", "directorsuite"],
        aux: ["lobby", "deskfarm"],
      },
      build: function (c) {
        const R = c.rect, root = c.root, cx = c.cx, cz = c.cz;
        pad(root, R, M.concrete, "agency");
        // chain link, not masonry: this place is WATCHED, not walled
        perimeter(root, R, { style: "fence", h: 3.4, hex: M.fence, gate: 3, gateW: 20 });
        gatehouse(root, R.maxX - 6, cz, false, M.concreteD);
        // ---- THE BUILDINGS ------------------------------------------------
        // main slab x -82..+42, z -61..-27 (door on its south face, z -27)
        const main = civic(root, cx - 20, cz - 44, 124, 34, 6, M.blank, 1, null, "Bureau Headquarters", { fh: 4.0 });
        c.main = main;
        // east wing x +58..+94, z -74..-30 (its staff door faces the car park)
        const wing = civic(root, cx + 76, cz - 52, 36, 44, 7, M.blank, 1, null, "Bureau East Wing", { fh: 3.8 });
        // operations annex behind the slab, x -68..+28, z -103..-81, across a
        // 20 m service yard from the slab's back wall
        const annex = civic(root, cx - 20, cz - 92, 96, 22, 2, M.blankD, 1, null, "Bureau Annex", { fh: 4.2 });
        if (main) { fedFrame(root, main, { gap: 17 }); fedEntrance(root, main, { w: 18, reach: 7.4 }); fedRoof(root, main, { mast: 16 }); }
        if (wing) { fedFrame(root, wing, { gap: 8.2, pitch: 2.6 }); fedEntrance(root, wing, { w: 9, reach: 4.6 }); fedRoof(root, wing, { mast: false, penthouse: 12 }); }
        if (annex) { fedFrame(root, annex, { gap: 8.2, pitch: 3.6 }); fedEntrance(root, annex, { w: 9, reach: 4.6 }); fedRoof(root, annex, { mast: 10 }); }
        // ---- THE GROUND, gate inwards -------------------------------------
        // the approach drive: the east gate to the plaza, z -6..+6
        slab(root, cx + 27, cz, 254, 12, M.asphalt, YG);                 // x -100..+154
        for (const s of [-1, 1]) slab(root, cx + 27, cz + s * 6.2, 254, 0.25, M.paint, YM);   // edge lines
        // the plaza in front of both doors, z -21..-7, and the service yard
        slab(root, cx + 19, cz - 14, 162, 14, M.paving, YS);              // x -62..+100
        slab(root, cx - 34, cz - 71, 124, 20, M.asphalt, YG);             // x -96..+28, z -81..-61 (the yard)
        slab(root, cx - 90, cz - 43.5, 12, 75, M.asphalt, YG);            // x -96..-84: the yard's lane to the drive
        // three flags on the plaza, the middle one taller
        flagpole(root, cx - 46, cz - 12, 13);
        flagpole(root, cx - 40, cz - 12, 15);
        flagpole(root, cx - 34, cz - 12, 13);
        // bollards along the plaza's kerb (a gap every 1.5 m to walk through)
        bollardLine(root, cx + 19, cz - 7.2, 80, new THREE.CylinderGeometry(0.2, 0.24, 0.95, 8), 0.24, 0.95);
        // THE PARKING SEAS, off the drive and clear of it by a verge: the
        // aerial photograph of every real one of these is mostly car park
        parkingSea(root, cx - 53, cz + 68, 184, 108);                     // x -145..+39, z +14..+122
        parkingSea(root, cx + 88, cz + 68, 78, 108);                      // x  +49..+127, z +14..+122
        slab(root, cx - 24, cz + 10, 12, 8, M.asphalt, YG);                // the lots' two mouths
        slab(root, cx + 80, cz + 10, 12, 8, M.asphalt, YG);
        // the antenna farm along the north fence, west of the annex
        for (let i = 0; i < 3; i++) {
          const dx = cx - 140 + i * 18, dz = cz - 112;
          cyl(root, dx, 2.0, dz, 0.34, 0.44, 4.0, M.steel, 8);
          const dish = new THREE.Mesh(new THREE.SphereGeometry(3.4, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), cm(M.stoneD));
          dish.position.set(dx, 4.4, dz); dish.rotation.x = -0.7; dish.castShadow = true; root.add(dish);
          col(dx, dz, 1.4, 1.4, 0, 4.0);
        }
        // the lattice tower and the standby generators on the east side
        cyl(root, cx + 118, 17, cz - 108, 0.4, 0.7, 34, M.steelD, 8);
        col(cx + 118, cz - 108, 1.6, 1.6, 0, 34);
        for (let i = 0; i < 4; i++) box(root, cx + 104 + i * 6, 1.4, cz - 84, 4.2, 2.8, 3.2, M.steelD);
        col(cx + 113, cz - 84, 26, 3.2, 0, 2.8);
        // ---- LIGHT: lantern standards both sides of the drive, masts on the lots
        const lamps = [];
        for (let x = cx - 76; x <= cx + 140; x += 26) { lamps.push({ x: x, z: cz - 8.4 }); lamps.push({ x: x + 13, z: cz + 8.4 }); }
        lampRow(root, lamps);
        for (const p of [[-149.5, 17], [-149.5, 119], [44, 17], [44, 119], [140, 119]]) floodMast(root, cx + p[0], cz + p[1], 10);
        return { gate: { x: R.maxX, z: cz }, seat: main, service: true };
      },
    },
    /* ================================================================
       5. THE DEFENCE HEADQUARTERS — five concentric five-sided rings
       around a courtyard. The concentric rings ARE the silhouette; get
       the shape right and the building needs no sign at all.

       GEOMETRY NOTE, because the numbers here are load-bearing: the outer
       ring's apothem is 146, so its CIRCUMRADIUS is 146/cos(36) = 180.5 and
       its southern apex reaches cz+180.5. Everything else on this site is
       placed against a separating plane of the pentagon rather than by eye
       (the staff parks sit outside the 126-degree and 54-degree faces). It
       was 150; the four metres went to the entrance pavilion, so the
       pavilion keeps a real 24 m plate and its stylobate still ends where
       garrison.js posts the approach sentry (22 m in from the gate).

       THE WAY IN is the real building's: an entrance pavilion built against
       the middle of the flat north face, on the parade axis from the gate,
       exactly where a real ring HQ puts its ceremonial entrance. It was a
       command annex parked 82 m off the axis on the parade ground, with its
       stair core butting the ring's colliders; now the gate, the forecourt,
       the stylobate, the portico and the ring are one line. Inside the
       pavilion: the security lobby, the operations centre, the briefing
       floor, and the Chief of the General Staff's suite on top.
       ================================================================ */
    {
      id: "defence", name: "Defence Headquarters", subtitle: "Joint Command",
      hx: 196, hz: 194, bearing: 204, keepOut: "hard", gateSide: 0,
      principal: { key: null, tier: 5, org: "army", lawful: true, role: "Chief of the General Staff", job: "official", wealth: 0.75 },
      interiors: { main: ["securitylobby", "opscenter", "briefingroom", "directorsuite"] },
      build: function (c) {
        const R = c.rect, root = c.root, cx = c.cx, cz = c.cz;
        pad(root, R, M.concrete, "defence");
        perimeter(root, R, { style: "fence", h: 3.6, hex: M.fence, gate: 0, gateW: 22 });
        gatehouse(root, cx, R.minZ + 6, true, M.concreteD);
        // THE RINGS, in limestone, and their windows
        const ring = ringHQ(root, cx, cz, { apothem: 146, rings: 5, depth: 18, well: 9, storeys: 5, wall: M.stone, roof: M.concreteD });
        ringWindows(root, cx, cz, ring);
        // THE COURTYARD — lawn, a path cross, trees, and a pavilion you can
        // stand under (its roof clears 3 m; its posts are solid)
        const ci = Math.max(8, ring.inner - 2);
        disc(root, cx, cz, ci, M.lawn, YG, 26);
        slab(root, cx, cz, 5.0, ci * 2, M.paving, YS);
        slab(root, cx, cz, ci * 2, 5.0, M.paving, YS);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          cyl(root, cx + sx * 3.4, 1.5, cz + sz * 3.4, 0.2, 0.22, 3.0, M.stone, 12);
          col(cx + sx * 3.4, cz + sz * 3.4, 0.44, 0.44, 0, 3.0);
        }
        box(root, cx, 3.16, cz, 8.4, 0.32, 8.4, M.stoneD);
        box(root, cx, 3.38, cz, 7.6, 0.12, 7.6, M.concreteD, { cast: false });
        for (const s of [-1, 1]) {                                        // two benches under it
          box(root, cx + s * 1.6, 0.22, cz, 0.5, 0.44, 2.6, M.timber, { cast: false });
          col(cx + s * 1.6, cz, 0.5, 2.6, 0, 0.44);
        }
        if (ci > 14) {
          const tp = [];
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) tp.push({ x: cx + sx * ci * 0.55, z: cz + sz * ci * 0.55 });
          for (const t of tp) {
            cyl(root, t.x, 1.6, t.z, 0.18, 0.26, 3.2, EST.bark, 8);
            const cr = new THREE.Mesh(new THREE.SphereGeometry(2.6, 12, 9), cm(M.lawnD));
            cr.position.set(t.x, 4.6, t.z); cr.castShadow = true; root.add(cr);
            col(t.x, t.z, 0.5, 0.5, 0, 3.0);
          }
        }
        // ---- THE ENTRANCE PAVILION on the flat north face (z -170..-146),
        // its back bonded 0.1 m into the ring so no slit shows between them;
        // its stylobate's deck is where garrison.js posts the approach sentry
        const main = civic(root, cx, cz - 158.05, 60, 24.1, 4, M.stone, 0,
          { kind: "federal", crown: "flat", order: "pilaster", stone: true, monumental: true, externalPerron: true },
          "Joint Command Annex", { fh: 4.2 });
        c.main = main;
        if (main) {
          perron(root, cx, cz - 170.1, 30, 5.2, M.stone, -1);              // z -170.1..-175.3
          fedRoof(root, main, { mast: 12, penthouse: 16 });
          // granite base course along the two flanks the portico does not own
          for (const s of [-1, 1]) {
            box(root, cx + s * 30.12, 0.475, cz - 158.05, 0.28, 0.95, 24.1, FEDM.granite, { cast: false });
            col(cx + s * 30.12, cz - 158.05, 0.28, 24.1, 0, 0.95);
          }
        }
        // the forecourt from the gate to the stylobate, the flags either side
        slab(root, cx, cz - 184.65, 44, 18.7, M.paving, YS);               // z -194..-175.3
        flagpole(root, cx - 26, cz - 177, 18);
        flagpole(root, cx + 26, cz - 177, 18);
        const lamps = [];
        for (const s of [-1, 1]) { lamps.push({ x: cx + s * 21, z: cz - 190 }); lamps.push({ x: cx + s * 36, z: cz - 173 }); }
        lampRow(root, lamps);
        // STAFF PARKING in the two southern rect corners, which are outside
        // the 126-degree / 54-degree faces (see the geometry note above).
        // SOLVED AGAINST THE PENTAGON, not eyeballed: the south-east edge runs
        // from the apex (0, +185) to the vertex (+176, +57.2), so at the lot's
        // inner edge x=110 the ring reaches only z=+105, and a lot starting at
        // z=+112 clears it along its whole width. Two more sit in the NORTH
        // strip either side of the forecourt, north of the flat face at cz-150.
        parkingSea(root, cx - 150, cz + 151, 80, 78);              // x -190..-110, z +112..+190
        parkingSea(root, cx + 150, cz + 151, 80, 78);              // x +110..+190, z +112..+190
        parkingSea(root, cx - 156, cz - 170, 68, 40);              // x -190..-122, z -190..-150
        parkingSea(root, cx + 156, cz - 170, 68, 40);              // x +122..+190, z -190..-150
        floodMast(root, cx - 193, cz + 110, 10);
        floodMast(root, cx + 193, cz + 110, 10);
        floodMast(root, cx - 120, cz - 188, 10);
        floodMast(root, cx + 120, cz - 188, 10);
        helipad(root, cx + 152, cz - 118, 13);
        helipad(root, cx + 152, cz - 86, 13);
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
      // the public lobby (and the strongroom off it), the council floor, the
      // mayor's floor at the top — the floor you are not allowed on
      interiors: { main: ["lobby", "councilchamber", "mayorsoffice"], aux: ["deskfarm"] },
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
        const G = civicGround(c);
        G.slab(root, cx - 48, cz + 6, 40, 60, M.lawn, YG);         // x -68..-28
        G.slab(root, cx + 48, cz + 6, 40, 60, M.lawn, YG);         // x +28..+68
        // a municipal building at a municipal building's height: three 4.2 m
        // storeys under the clock tower, the monumental facade on (it was a
        // 9.6 m glass box asking for an order and a clock the flag dropped)
        const main = civic(root, cx, cz - 24, 50, 32, 3, M.stone, 1,
          { kind: "cityhall", crown: "clock", order: "pilaster", motto: "CITY HALL", stone: true,
            monumental: true, externalPerron: true }, "City Hall", { fh: 4.2 });
        c.main = main;
        perron(root, cx, cz - 8, 48.6, 8, M.stone, 1);             // facade z -8, out to 0; the order's full width
        flagpole(root, cx - 18, cz + 6, 12);
        flagpole(root, cx + 18, cz + 6, 12);
        bollardLine(root, cx, cz + 12, 19.2, new THREE.CylinderGeometry(0.22, 0.26, 0.95, 8), 0.26, 0.95);
        // PUBLIC PARKING. The forecourt lot was 44 x 34 — one module deep once
        // it is given the drive aisle it always needed — for the building the
        // whole city is supposed to be able to walk into. It now takes the
        // forecourt to the rect edge (bollards at cz+12 are its north kerb,
        // R.maxZ = cz+68 its south), staying inside the ceremonial lamp
        // columns at x +/-28, and TWO more sit on the strip south of the two
        // lawns, which end at cz+36 and left 28 m of empty pad behind them.
        parkingSea(root, cx, cz + 42, 52, 50);                     // x -26..+26, z +17..+67
        parkingSea(root, cx - 50, cz + 52, 40, 28);                // x -70..-30, z +38..+66
        parkingSea(root, cx + 50, cz + 52, 40, 28);                // x +30..+70, z +38..+66
        for (const q of [[cx, cz + 42, 52, 50], [cx - 50, cz + 52, 40, 28], [cx + 50, cz + 52, 40, 28]])
          G.eg.rects.push({ minX: q[0] - q[2] / 2, maxX: q[0] + q[2] / 2, minZ: q[1] - q[3] / 2, maxZ: q[1] + q[3] / 2, y: YG });
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
        watchtower(root, R.minX + 16, R.minZ + 16, M.timber, cx);
        watchtower(root, R.maxX - 16, R.minZ + 16, M.timber, cx);
        // the stock the money pretends to come from
        const hedge = [];
        for (let i = 0; i < 13; i++) hedge.push({ x: cx - 80 + i * 6.2, z: cz - 78 });
        hedges(root, bg(5.4, 1.6, 1.6), hedge, function () { return 0.8; });
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
      // the people who commute HERE do a job, and it is not clerking — and it
      // is the SHERIFF'S job: "sheriff's deputy" is a jobFit row (CAT.sheriff,
      // county khaki + campaign hat), so the detail walking this yard reads as
      // officers instead of anonymous rent-a-guards (owner, 2026-08-16). The
      // khaki still carries no cop flag — a look, not a skeleton key.
      work: { kind: "security", role: "sheriff's deputy", patrol: true },
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
        // The two flanks are 32 m of clear pad each, running the full 116 m of
        // the rect: the jail block is only x +/-27 and the walled court x +/-YX
        // (34), so nothing but the fence bounds these lots in z. They were 24
        // x 44 in the middle of that, which is a quarter of the ground.
        parkingSea(root, cx - 50, cz - 16, 28, 76);       // staff, west of the court
        parkingSea(root, cx + 50, cz - 16, 28, 76);       // impound, east — the way out runs through it
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
        // (east of the dock's own stair, whose top tread ran through its wall
        // at cx + 38: the walk check found a 0.6 m tread inside the annex)
        block(root, cx + 45, Z(-8), 20, 16, 2, M.blank, GZ > 0 ? 1 : 0, { facade: "office" });

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
        watchtower(root, R.minX + 16, Z(36), M.steelD, cx);
        for (const p of [[R.minX + 14, R.minZ + 14], [R.maxX - 14, R.minZ + 14], [R.minX + 14, R.maxZ - 14], [R.maxX - 14, R.maxZ - 14]]) {
          floodMast(root, p[0], p[1], 11.0);
        }
        const lamps = [];
        for (let i = 0; i < 4; i++) { lamps.push({ x: cx - 16, z: Z(42 - i * 11) }); lamps.push({ x: cx + 16, z: Z(42 - i * 11) }); }
        lampRow(root, lamps);
        // staff + collection parking down the east flank. A bonded yard runs
        // shifts; 22 x 30 held one module and a fraction of a row.
        parkingSea(root, R.maxX - 30, Z(32), 32, 52);

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

  /* CBZ.estateKit — AN ESTATE FOR ANY RICH MAN, IN ONE CALL.

       CBZ.estateKit.register({
         id: "villa-marchetti", name: "Villa Marchetti", subtitle: "Private Estate",
         hx: 90, hz: 80,                       // footprint half-extents (m)
         bearing: 120,                         // compass bearing to search along (optional)
         principal: { key: null, tier: 3, org: "private", role: "Owner", wealth: 0.9, family: true },
         household: [{ job: "housekeeper", at: "door" }, { job: "groundskeeper", at: "garden" }],
         interiors: { main: ["room:lounge", "bosssuite"] },
         estate: {                             // §1b; everything omitted, the tier decides
           tier: 3,                            // 5 head of state .. 1 compound
           house: { v: -22, w: 30, d: 20, storeys: 2, fh: 3.8, civic: { crown: "pediment", order: "ionic", stone: true, monumental: true, externalPerron: true } },
           helipad: { u: 50, v: 40, r: 10 },   // or omit
           security: { perimeter: "wall", lodges: 2 },
         },
       });

     Call it at script load, before the world builds (landmass order 42): the
     row joins the same placement search, land claim, road, staff and
     interior passes as the ten seats of power, and its principal is seated
     by power.js like every other. The Executive Mansion is this kit's tier-5
     instance and the Governor's Residence its tier-4 one. */
  CBZ.govComplexDefs = COMPLEXES;          // the registry rows, for probes and node checks
  CBZ.estateKit = {
    build: estate,
    frame: estateFrame,
    tiers: EST_TIER,
    register: function (row) {
      if (!row || !row.id || !row.estate) return null;
      for (let i = 0; i < COMPLEXES.length; i++) if (COMPLEXES[i].id === row.id) return null;
      let hsh = 0;
      for (let i = 0; i < row.id.length; i++) hsh = (hsh * 31 + row.id.charCodeAt(i)) >>> 0;
      const def = Object.assign({ hx: 90, hz: 80, bearing: hsh % 360, keepOut: "civ", gateSide: 1 }, row);
      if (typeof def.build !== "function") {
        def.build = function (c) {
          const E = estate(c, def.estate);
          c.main = E.main;
          if (c.site) c.site.layout = E.layout;
          return { gate: E.gate, seat: E.main };
        };
      }
      COMPLEXES.push(def);
      return def;
    },
  };

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
    //     "<Name> Approach" and deliberately does NOT contain the word
    //     "Link": highwaynet.js uses that word precisely because its route
    //     segments ARE bridges and must not hold land. Ours are country
    //     roads and must.
    // The name is internal. Every leg shares it (it used to be numbered per
    // leg, and the map printed "The Capitol Approach 2" across the country);
    // `road: true` keeps it off every map. An access road is not a place.
    // (Nothing depends on the name for OUR audit — skipRegion() drops any
    //  region carrying `_govOwner` before it ever looks at a name.)
    for (let i = 0; i < clean.length - 1; i++) {
      const a = clean[i], b = clean[i + 1];
      if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.z - b.z) < 0.5) continue;
      const HALF = 13;
      const reg = CBZ.registerCityRegion(city, {
        name: site.def.name + " Approach", subtitle: site.def.subtitle, kind: "rect", road: true,
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
    // a floor that gave part of its plate to something built INTO it (the
    // Mansion's stair hall, §1d) hands its programme only the rest
    const trim = bld._roomTrim && bld._roomTrim[k];
    if (trim) {
      if (trim.x0 != null) room.x0 = Math.max(room.x0, trim.x0);
      if (trim.x1 != null) room.x1 = Math.min(room.x1, trim.x1);
    }
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
        try { CBZ.cityStairCore(site.lot, site.def.stairSide ? { side: site.def.stairSide } : undefined); } catch (e) {}
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
          if (t.what === "key" || t.what === "rack" || t.what === "seal") return "Take";
          return v.key ? "Unlock" : "Try";
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
            if (v.key) return;
            // TAKEN WITH A HAND (systems/verbs_pickup.js): the fob leaves the
            // hook in the hand; the key is yours on the grab frame
            const took = function () {
              v.key = true;
              if (v.keyMesh) v.keyMesh.visible = false;
              // the reader goes green. Wrapped because a THROW out of onSelect
              // lands in the interaction registry's own dispatch and would eat
              // every verb on the card, not just this one.
              try { v.lampMat.color.setHex(SRM.lockGrn); v.lampMat.emissive.setHex(SRM.lockGrn); } catch (e) {}
              srNote("A brass key on a tagged fob.", 2.8);
            };
            if (CBZ.verbs && CBZ.verbs.pickup) CBZ.verbs.pickup(CBZ.player, v.keyMesh || null, { pose: "card", key: v, onTaken: took });
            else took();
            return;
          }
          if (t.what === "door") {
            if (!v.key) {
              srNote("Steel. The reader wants a card.", 2.6);
              return;
            }
            // THE FOB GOES ON THE READER (systems/verbs_pickup.js CBZ.verbs.touch
            // "card"): the reader's lobby face (the box 0.10 deep under the lamp,
            // facing -x), and the bolts go back on the touch
            if (CBZ.verbs && CBZ.verbs.touch && v.lamp && v.lamp.parent) {
              const par = v.lamp.parent;
              par.updateWorldMatrix(true, false);
              const lp = par.localToWorld(v.lamp.position.clone().add(new THREE.Vector3(0.02, -0.12, 0)));
              const ln = new THREE.Vector3(-1, 0, 0).transformDirection(par.matrixWorld);
              CBZ.verbs.touch(CBZ.player, { point: lp, normal: ln,
                kind: "card", key: "gov-reader", onTouch: function () { srOpen(v); } });
            } else srOpen(v);
            return;
          }
          if (t.what === "rack") {
            if (v.rack) return;
            v.rack = true;
            // the hand takes a gun off the rack (systems/verbs_pickup.js)
            const at = v.rackAt || t;
            if (CBZ.verbs && CBZ.verbs.pickup) CBZ.verbs.pickup(CBZ.player, { x: at.x, y: (v.floorY || 0) + 1.1, z: at.z, kind: "gun" }, { key: v, pose: "grip", keep: true, onTaken: function () { srTakeRack(v); } });
            else srTakeRack(v);
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
    if (CBZ.city && CBZ.city.big) CBZ.city.big("CONFISCATED ARMS: " + (name || "the rack") + " + plates");
    else srNote("You take " + (name || "what is on the rack") + " off the rack.", 2.4);
  }

  /* THE CATEGORY CHANGE — the seal. Not a number: from here on every
     government floor in the world reads you as VIP, through occupy.js's own
     one-line grant, which the §7 tick re-applies to each complex as its
     occupancy comes up (a building 4 km away has no `_occupancy` record yet,
     so granting once here would silently cover only what happens to be live).
     That is the whole reward and it is a CATEGORY: the trespass sweep stops
     seeing you, and the men on the mayor's floor stop being a problem. */
  // TAKEN WITH A HAND (systems/verbs_pickup.js): the seal leaves the desk in
  // the hand; the writ lands on the grab frame
  function srTakeSeal(v) {
    if (v._sealTaking) return;
    v._sealTaking = true;
    const took = function () { v._sealTaking = false; srTakeSealNow(v); };
    if (CBZ.verbs && CBZ.verbs.pickup) CBZ.verbs.pickup(CBZ.player, v.sealMesh || null, { pose: "grip", onTaken: took });
    else took();
  }
  function srTakeSealNow(v) {
    if (v.sealMesh) v.sealMesh.visible = false;
    if (CBZ.game) CBZ.game.cityGovWrit = true;
    // THE SEAL IS AN OBJECT, not only a boolean: it goes in the bag as a real
    // `key`-tagged row (city/economy.js), so it can be carried, dropped and
    // stashed like anything else, and any door that wants it can simply ask
    // whether you have one. city/hitman.js's office contract is the first.
    if (CBZ.cityEcon && CBZ.cityEcon.add) { try { CBZ.cityEcon.add("City Seal", 1); } catch (e) {} }
    srGrantAll();
    if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(2400);
    if (CBZ.city && CBZ.city.addRespect) { try { CBZ.city.addRespect(6); } catch (e) {} }
    if (CFG.GOV_STRONGROOM_WRIT === false) {
      if (CBZ.city && CBZ.city.big) CBZ.city.big("THE CITY SEAL");
      return;
    }
    if (CBZ.city && CBZ.city.big) CBZ.city.big("THE CITY SEAL");
    srNote("The city seal.", 3.4);
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
    SITES.length = 0; _bays.length = 0; _shells.length = 0; ESTATE_GROUND.length = 0;
    registerEstateGround();
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

    // published BEFORE the rows build (same array), so a room programme run
    // inside a build can already find its own site
    CBZ.govComplexes = SITES;
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
      // A slice / the streamed city (core/citystream.js) furnishes a complex
      // only when it comes within sight: the rooms were most of the builder's
      // ~51k meshes, and a phone at the downtown spawn built all ten sites'.
      // With no slice, sliceAt runs it right here, exactly as before.
      const dressIt = function () { try { dressComplex(site); } catch (e) { console.error("[govcomplex] interiors " + def.id, e); } };
      // NEVER FREED, only parked: the rooms are drawn INTO the shells' own
      // groups, which this job does not own (it captures what lands at the
      // top of the city root), so a free took the colliders and left every
      // mesh standing, and the re-run drew the whole interior a second time
      // over it: two leaves in every doorway, the old one shut with no
      // collider and a dead door record in front of the live one, so E at the
      // Oval Office door "opened" a door that was no longer there. (metro.js's
      // far tiles are noFree for the same reason.)
      const ij = CBZ.sliceAt ? CBZ.sliceAt(site.rect, dressIt, { name: "gov interiors " + def.id }) : (dressIt(), null);
      if (ij) ij.noFree = true;

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
    // every enterable shell each complex raised ({site, b, name}): the walk
    // check (tools/estate-check.mjs) and any audit read the real buildings
    CBZ.govShells = function () { return _shells.slice(); };
    if (CBZ.flags) CBZ.flags.flush();     // the complexes' flags, one pool per design and cell
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
        // THE PLAYER HAS NO STAND-IN. When the player holds this seat the
        // row's body used to stay posted at the door with _sid "player": a
        // second President standing on the perron, and shooting HIM ran the
        // player's own succession through officials.js's kill wrap. The
        // officeholder is the player; the NPC body goes home, and its ring
        // with it. It is re-staffed the moment the seat changes hands.
        {
          const hh = holderOf(s);
          if (hh && hh.sid === ((CBZ.officials && CBZ.officials.PLAYER_SID) || "player")) {
            if (s.actor && !s.actor.dead) {
              if (CBZ.powerDissolve) { try { CBZ.powerDissolve(s.actor); } catch (e) {} }
              if (CBZ.cityUnpostNpc) { try { CBZ.cityUnpostNpc(s.actor); } catch (e) {} }
            }
            s.actor = null; s.power = null; s.seated = false;
            continue;
          }
        }
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
      // cannot change when a site's parking layout does.
      //
      // FILL RATE, NOT A FIXED SIX. Six cars was right for a 30-stall lot and
      // is invisible in a 900-stall one; a rate keeps the lots reading as lots
      // at every size. It is a rate AND a hard ceiling, because metal is the
      // expensive part — the same rule island_speedway.js's PARK_CARS applies,
      // and the ceiling bites in stall order so what does exist clusters near
      // the building rather than scattering to the far fence.
      const FILL = 0.18, PER_BAY = 22;
      let _parked = 0;
      for (let b = 0; b < _bays.length; b++) {
        const bay = _bays[b];
        const slots = bay.slots;
        if (!slots || !slots.length) continue;
        const r = streamFor(bay.site + ":cars:" + b);
        const n = Math.min(PER_BAY, Math.max(1, Math.round(slots.length * FILL)));
        // A STALL HOLDS ONE CAR. Walking the row with a stride drawn off the
        // bay's own stream picks distinct stalls without a rejection loop —
        // two cars in one stall is the failure the old continuous-x pick made
        // routine, and it looks exactly like a crash nobody cleared.
        const stride = Math.max(1, Math.floor(slots.length / n));
        let idx = (r() * stride) | 0;
        for (let k = 0; k < n && idx < slots.length; k++, idx += stride) {
          const s = slots[idx];
          const model = CARS[(r() * CARS.length) | 0];
          try {
            // heading 0 = nose down the bay, which is the axis the painted
            // stalls run on (stripes 5.49 m long in Z, 2.74 m apart in X)
            const c = CBZ.cityMakeCar(s.x, s.z, s.heading || 0, true, model, 0);
            if (c) { c.ai = false; c.v = 0; c.baseV = 0; c.road = null; c._govParked = true; _parked++; }
          } catch (e) { /* no vehicle path in this build — the stalls stay empty */ }
        }
      }
      AUDIT.parked = _parked;
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
      /* §8 — THE CAR PARKS. `stalls` is recounted from the bay records the
         paint was drawn from, so it can never disagree with the stripes;
         `parked` is what §8 actually managed to mint into them. A lot that
         reports stalls and zero metal is the "reads abandoned" failure the
         speedway's own audit was written to catch. */
      lots: _bays.length,
      stalls: _bays.reduce(function (n, b) { return n + (b.stalls | 0); }, 0),
      // LIVE, not the mint-time counter. §8 runs once; spawnCityTraffic
      // rebuilds cityCars, the player can blow a lot up, and a stored number
      // would go on reporting the cars this file MEANT to put there. Read the
      // stamp off the cars that are actually standing in the world.
      parked: (function () {
        const cars = CBZ.cityCars || [];
        let n = 0;
        for (let i = 0; i < cars.length; i++) if (cars[i] && cars[i]._govParked && !cars[i].dead) n++;
        return n;
      })(),
      parkedMinted: AUDIT.parked | 0,
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
