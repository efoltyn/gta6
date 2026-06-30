/* ============================================================
   city/world.js — the GTA-style open CITY map.

   A bright low-poly downtown built FAR from the prison and the
   disaster island (z≈-700) so all three worlds coexist with zero
   refactor: an escape/survival match never sees it, a city match
   teleports here. Everything lives in one group (city.root) so the
   other modes just hide it.

   This file lays the FOUNDATION only — a flat ground, a regular grid
   of streets with lane lines + crosswalks, sidewalks ringing every
   block, and the descriptor (lots / roads / intersections / waypoint
   helpers + the DISTRICT personality field: density-weighted spawn
   pickers so downtown is packed and the docks are quiet BY DESIGN —
   crime pacing needs busy and dead streets) that the rest of the city
   is built on. Buildings, the
   connected island district, shops, props and traffic lights are added
   by sibling modules through the hooks at the end of buildCity().

   WHY the coast + ground identity (this pass): the map edge used to be
   raw void — now ONE huge day/night-tinted sea plane sits under city +
   island so every edge reads as coastline, the bridge gap reads as a
   working harbor (sand, rip-rap, moored hulls), and the GROUND tells
   you where the money is without a map: grass yards (the island's own
   checker) in residential/projects, poured plazas downtown, stained
   sidewalks + work-yard dirt in projects/industrial, double-yellow
   arterials + painted turn arrows through the Midtown core, red fire
   curbs at hydrants. Photo textures (assets/textures/*.jpg) layer into
   the procedural canvases when present — procedural stays the fallback.

   CBZ.buildCity() builds once and returns the city descriptor.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const mat = CBZ.mat;

  let city = null;

  // deterministic RNG so the city is the same each run (learnable streets)
  let _s = 90210;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }

  CBZ.buildCity = function () {
    if (city) return city;
    _s = 90210;
    const C = CBZ.CITY;
    const cx = C.center.x, cz = C.center.z;
    const N = C.blocks, BLK = C.block, ROAD = C.road;
    const step = BLK + ROAD;
    const half = (N * step) / 2;

    const root = new THREE.Group();
    CBZ.scene.add(root);

    // grid road centre-lines (N+1 lines bounding N blocks, both axes)
    const xLines = [], zLines = [];
    for (let k = 0; k <= N; k++) { xLines.push(cx - half + k * step); zLines.push(cz - half + k * step); }
    const minX = xLines[0] - ROAD / 2, maxX = xLines[N] + ROAD / 2;
    const minZ = zLines[0] - ROAD / 2, maxZ = zLines[N] + ROAD / 2;
    const spanX = maxX - minX, spanZ = maxZ - minZ;

    // PHOTO LAYER: when assets/textures/*.jpg exist, draw the photo into an
    // existing procedural canvas texture, then let `after` re-tint it so the
    // game palette survives the photo grain. Missing file / tainted canvas →
    // the procedural pattern simply stays. Full fallback, no error path.
    function photoLayer(tex, url, after) {
      if (!tex || !tex.image || !tex.image.getContext) return;
      const img = new Image();
      img.onload = function () {
        try {
          const c = tex.image, g2 = c.getContext("2d");
          g2.drawImage(img, 0, 0, c.width, c.height);
          if (after) after(g2, c);
          tex.magFilter = THREE.LinearFilter;
          tex.needsUpdate = true;
        } catch (e) { /* keep the procedural fallback */ }
      };
      img.src = url;
    }

    // ---- ground: asphalt base, then sidewalk + lot slabs on top ----
    const baseTex = CBZ.checkerTex ? CBZ.checkerTex("#2b2e33", "#26292e", 2) : null;   // dark asphalt base
    if (baseTex) baseTex.repeat.set(spanX / 8, spanZ / 8);
    photoLayer(baseTex, "assets/textures/asphalt512.jpg", function (g2, c) {
      // keep the near-black city base tone over the photo grain
      g2.globalAlpha = 0.55; g2.fillStyle = "#26292e"; g2.fillRect(0, 0, c.width, c.height); g2.globalAlpha = 1;
    });
    // ground stops just past the seawall line (bounds+26): the city meets the
    // WATER, not an endless gray apron — the +29 edge tucks under the rip-rap
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(spanX + 58, spanZ + 58),
      baseTex ? new THREE.MeshLambertMaterial({ map: baseTex }) : mat(0x3a3e45));
    ground.rotation.x = -Math.PI / 2; ground.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    ground.receiveShadow = true; root.add(ground);

    // ---- THE SEA: one giant water plane under city + island, so every map
    //      edge reads as COASTLINE instead of void (the perimeter wall becomes
    //      a seawall; the east bridge crosses a real harbor). ONE Lambert
    //      material with fog:true so the horizon melts into the daynight fog;
    //      its colour is lerped per-frame from the daynight cycle — a single
    //      material write, effectively free. It deliberately shares the island
    //      ocean's exact colour/shadow flags (expansion.js) so the batch pass
    //      folds both planes into one mesh still driven by THIS material. ----
    const seaMat = new THREE.MeshLambertMaterial({ color: 0x2f6f9e, fog: true });
    // widened to 6200 so the whole archipelago (worldmap.js's far islands &
    // biomes, out past ±1500) sits ON open water, not past the plane's edge.
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(6200, 6200), seaMat);
    sea.rotation.x = -Math.PI / 2; sea.position.set(cx + 150, -0.5, cz - 200);   // recentred over the spread-out island ring
    sea.receiveShadow = false; root.add(sea);
    // ---- PROCEDURAL BACKDROP TERRAIN (world/terrain.js): a snow-capped
    //      mountain range + rolling hills in the FAR ring around the map.
    //      It is EXACTLY flat (y=0) across the whole playable archipelago, so
    //      physics is untouched where anyone walks/drives — relief only rises
    //      out past the seawall ring on the horizon. Parented to root so it
    //      hides with the city in other modes. One relief mesh + one merged
    //      hero-peak mesh (≈3 draw calls). No-ops if terrain.js / window.noise
    //      is absent or CBZ.PROC_TERRAIN === false. ----
    if (CBZ.buildTerrain) { try { CBZ.buildTerrain(root); } catch (e) { console.error("[city terrain]", e); } }

    const seaDay = new THREE.Color(0x2f6f9e), seaNight = new THREE.Color(0x0e2233), seaDusk = new THREE.Color(0x6b5a78);
    CBZ.onAlways(93, function () {
      if (!root.visible) return;                 // city hidden → other modes untouched
      const k = CBZ.dayness != null ? CBZ.dayness : 1;
      seaMat.color.copy(seaNight).lerp(seaDay, k);
      if (CBZ.duskness) seaMat.color.lerp(seaDusk, CBZ.duskness * 0.5);
    });

    // flat plane helper (decor, no collider)
    function plane(x, z, w, d, color, y, basic) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
        basic ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshLambertMaterial({ color }));
      m.rotation.x = -Math.PI / 2; m.position.set(x, y == null ? 0.02 : y, z);
      m.receiveShadow = !basic; root.add(m);
      return m;
    }

    // merged QUAD FIELD: many ground rects → ONE textured mesh. The batch
    // pass (core/batch.js) deliberately skips textured materials, so any
    // surface that wants a map must pre-merge here or pay a draw call per
    // rect. UVs are world-scaled (~8 m per texture repeat) so one repeating
    // texture fits every rect size.
    function quadField(rects, material, y) {
      const n = rects.length;
      const pos = new Float32Array(n * 18), nrm = new Float32Array(n * 18), uvA = new Float32Array(n * 12);
      let p = 0, u = 0;
      for (const r of rects) {
        const x0 = r.x - r.w / 2, x1 = r.x + r.w / 2, z0 = r.z - r.d / 2, z1 = r.z + r.d / 2;
        const ux = r.w / 8, uz = r.d / 8;
        const V = [[x0, z0, 0, uz], [x0, z1, 0, 0], [x1, z1, ux, 0], [x0, z0, 0, uz], [x1, z1, ux, 0], [x1, z0, ux, uz]];
        for (const v of V) {
          pos[p] = v[0]; pos[p + 1] = y; pos[p + 2] = v[1];
          nrm[p] = 0; nrm[p + 1] = 1; nrm[p + 2] = 0; p += 3;
          uvA[u] = v[2]; uvA[u + 1] = v[3]; u += 2;
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
      geo.setAttribute("uv", new THREE.BufferAttribute(uvA, 2));
      const m = new THREE.Mesh(geo, material);
      m.receiveShadow = true; m.matrixAutoUpdate = false; root.add(m);
      return m;
    }

    // ---- roads: one strip per grid line, full span ----
    // Surface: ONE shared asphalt canvas (photo-layered when the jpg exists,
    // flat #282a30 otherwise) across two merged quad-field meshes — 14 strips
    // cost 2 draw calls instead of 14 unmergeable textured planes.
    const roadCv = document.createElement("canvas"); roadCv.width = roadCv.height = 256;
    const roadCg = roadCv.getContext("2d"); roadCg.fillStyle = "#282a30"; roadCg.fillRect(0, 0, 256, 256);
    const roadTex = new THREE.CanvasTexture(roadCv);
    roadTex.wrapS = roadTex.wrapT = THREE.RepeatWrapping;
    photoLayer(roadTex, "assets/textures/asphalt512.jpg", function (g2, c) {
      g2.globalAlpha = 0.42; g2.fillStyle = "#26282e"; g2.fillRect(0, 0, c.width, c.height); g2.globalAlpha = 1;
    });
    const roadMat = new THREE.MeshLambertMaterial({ map: roadTex });
    const roads = [];     // {x,z,vertical,len} drivable centre-line segments
    // LANE PAINT (multi-lane US street): off the centreline we paint, per side,
    // (lanesPerDir-1) DASHED WHITE lane dividers at ±k*laneW and a SOLID WHITE
    // edge/fog line near the curb (±road/2-0.3); on the centreline a SINGLE
    // yellow on ordinary streets, solid DOUBLE-YELLOW on the two avenues FRAMING
    // the Midtown core (xLines[2]/xLines[4]) so the arterials read at a glance —
    // you know you're downtown (money) without the map. PERF: every stripe on
    // every street is folded into TWO merged meshes (one white, one yellow) via
    // a tiny rect→geometry baker, so 14 multi-lane streets cost 2 draw calls for
    // ALL paint instead of hundreds of dash meshes. No rng draws (deterministic).
    const TRAF = (C.traf) || {};
    const lanesPerDir = Math.max(1, (TRAF.lanesPerDir != null ? TRAF.lanesPerDir : 2) | 0);
    const laneW = (TRAF.laneW != null ? TRAF.laneW : 3.6);
    const whiteRects = [], yellowRects = [];   // {x,z,w,d}
    // one centred white DASHED line down a span (axis: 'v' along z, 'h' along x)
    function pushDashes(cx, cz, vertical, len, off) {
      const n = Math.max(1, Math.floor(len / 7));
      const seg = len / n, dashL = Math.min(2.6, seg * 0.55);
      for (let i = 0; i < n; i++) {
        const t = -len / 2 + (i + 0.5) * seg;
        if (vertical) whiteRects.push({ x: cx + off, z: cz + t, w: 0.22, d: dashL });
        else whiteRects.push({ x: cx + t, z: cz + off, w: dashL, d: 0.22 });
      }
    }
    // one centred SOLID line (white edge / yellow centre) down a span
    function pushSolid(cx, cz, vertical, len, off, yellow) {
      const arr = yellow ? yellowRects : whiteRects;
      if (vertical) arr.push({ x: cx + off, z: cz, w: 0.18, d: len });
      else arr.push({ x: cx, z: cz + off, w: len, d: 0.18 });
    }
    // paint the whole lane set for ONE street centred at (cx,cz)
    function paintStreet(cx, cz, vertical, len, core) {
      // centre line
      if (core) { pushSolid(cx, cz, vertical, len, -0.26, true); pushSolid(cx, cz, vertical, len, 0.26, true); }
      else pushSolid(cx, cz, vertical, len, 0, true);
      // dashed dividers between lanes on each side
      for (let s = -1; s <= 1; s += 2) {
        for (let k = 1; k < lanesPerDir; k++) pushDashes(cx, cz, vertical, len, s * k * laneW);
        // solid edge/fog line just inside the curb
        pushSolid(cx, cz, vertical, len, s * (ROAD / 2 - 0.3), false);
      }
    }
    const aveRects = [], crossRects = [];
    xLines.forEach((x, i) => {              // avenues (run along z)
      aveRects.push({ x, z: (minZ + maxZ) / 2, w: ROAD, d: spanZ });
      paintStreet(x, (minZ + maxZ) / 2, true, spanZ, i === 2 || i === 4);
      roads.push({ x, z: (minZ + maxZ) / 2, vertical: true, len: spanZ });
    });
    zLines.forEach((z) => {                 // cross-streets (run along x)
      crossRects.push({ x: (minX + maxX) / 2, z, w: spanX, d: ROAD });
      paintStreet((minX + maxX) / 2, z, false, spanX, false);
      roads.push({ x: (minX + maxX) / 2, z, vertical: false, len: spanX });
    });
    quadField(aveRects, roadMat, 0.04);
    quadField(crossRects, roadMat, 0.045);
    // bake ALL lane paint into two merged flat meshes (white + yellow).
    function paintMesh(rects, color, y) {
      if (!rects.length) return;
      const flat = new THREE.MeshBasicMaterial({ color });
      const m = quadField(rects, flat, y);
      m.receiveShadow = false;
      return m;
    }
    paintMesh(whiteRects, 0xeef1f5, 0.06);
    paintMesh(yellowRects, 0xf2c83a, 0.062);
    // optional raised concrete MEDIAN on the two core avenues (flag-gated).
    if (CBZ.CONFIG && CBZ.CONFIG.CITY_MEDIANS) {
      const medMat = mat(0x9aa0a6);
      [2, 4].forEach((i) => {
        const x = xLines[i];
        const med = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.28, spanZ), medMat);
        med.position.set(x, 0.14, (minZ + maxZ) / 2); med.castShadow = false; root.add(med);
      });
    }

    // ---- intersections + crosswalk stripes ----
    const intersections = [];
    xLines.forEach((x, i) => zLines.forEach((z, j) => {
      plane(x, z, ROAD, ROAD, 0x202227, 0.05);   // darker box at the crossing
      // zebra stripes on all four approaches — stripe COUNT scales with the
      // road width (ceil(road/1.2)) so a wide multi-lane road gets a full
      // crosswalk that spans it instead of a fixed 5-stripe band.
      const zk = Math.max(2, Math.ceil(ROAD / 1.2) >> 1);
      for (let s = -1; s <= 1; s += 2) {
        for (let k = -zk; k <= zk; k++) {
          plane(x + k * 1.1, z + s * (ROAD / 2 + 1.2), 0.7, 2.0, 0xeef1f5, 0.07, true);
          plane(x + s * (ROAD / 2 + 1.2), z + k * 1.1, 2.0, 0.7, 0xeef1f5, 0.07, true);
        }
      }
      intersections.push({ x, z, i, j, phase: (i + j) % 2 === 0 ? 0 : 1, t: rng() * 6, ns: true, light: null });
    }));

    // ---- blocks: a sidewalk slab + a DISTRICT-flavoured lot pad ----
    // GROUND IDENTITY (why: you should know WHERE you are — and where the
    // money is — without the map): residential + projects keep grass yards
    // wearing the island's exact checker (the two landmasses read as one
    // world), the core + commercial blocks get poured concrete plazas,
    // industrial gets an oil-stained work yard, and projects/industrial
    // sidewalks run darker (stained, unwashed) than downtown's bright beige.
    // (district field hoisted here — the lot pads need it at build time;
    // the spawn-weight pickers further down reuse these same definitions)
    const DISTRICTS = (C.districts && C.districts.length) ? C.districts : [];
    const dSpan = Math.ceil(N / 3);
    function districtQ(i, j) {
      const di = Math.min(2, (i / dSpan) | 0), dj = Math.min(2, (j / dSpan) | 0);
      return dj * 3 + di;
    }
    const grassTex = CBZ.checkerTex ? CBZ.checkerTex(CBZ.COL.GRASS_A, CBZ.COL.GRASS_B, 2) : null;
    if (grassTex) photoLayer(grassTex, "assets/textures/grass512.jpg", function (g2, c) {
      // keep the island's checker identity visible over the photo grain
      const s = c.width / 2; g2.globalAlpha = 0.38;
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
        g2.fillStyle = (i + j) % 2 ? CBZ.COL.GRASS_A : CBZ.COL.GRASS_B;
        g2.fillRect(i * s, j * s, s, s);
      }
      g2.globalAlpha = 1;
    });
    const grassMat = grassTex ? new THREE.MeshLambertMaterial({ map: grassTex })
                              : new THREE.MeshLambertMaterial({ color: 0x55903f });
    const lots = [], grassRects = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const bx = (xLines[i] + xLines[i + 1]) / 2;
      const bz = (zLines[j] + zLines[j + 1]) / 2;
      const dq = districtQ(i, j);
      const dk = (DISTRICTS[dq] && DISTRICTS[dq].kind) || "";
      // sidewalk ring (concrete) frames the block but must NOT pave over
      // the road gap — BLK+ROAD covered the streets, so the dark asphalt read as
      // beige/white. Keep it to the block + a ~2m walk so the roads show.
      plane(bx, bz, BLK + 4, BLK + 4,
        (dk === "projects" || dk === "industrial") ? 0xa39a7e : 0xc2b896, 0.08);
      // lot/yard pad in the centre (buildings sit on it)
      const lotW = BLK - 1.5, lotD = BLK - 1.5;
      if (dk === "core" || dk === "commercial") plane(bx, bz, lotW, lotD, 0xaab0b6, 0.10);   // poured plaza
      else if (dk === "industrial") plane(bx, bz, lotW, lotD, 0x767064, 0.10);               // dusty work yard
      else grassRects.push({ x: bx, z: bz, w: lotW, d: lotD });                              // grass yard
      lots.push({ cx: bx, cz: bz, w: lotW, d: lotD, i, j, district: dq, kind: null, building: null });
    }
    // every grass yard in ONE textured mesh (the batch pass skips maps)
    if (grassRects.length) quadField(grassRects, grassMat, 0.10);

    // ---- perimeter: a WATERFRONT, not a wall. The collider line is identical
    //      (you still can't wander off the map) but the visual is a knee-high
    //      concrete seawall cap with the sea right behind it — what a coastal
    //      city actually has at its edge. No more 6m gray prison walls. ----
    function wall(x, z, w, d) {
      // visible cap: full length along the seawall, 1.4m thick, knee-high.
      // The collider is HEIGHT-GATED to the cap (y0/y1): walking into it stops
      // you like any wall, but a JUMP clears it — over the lip and into the
      // harbor (city/swim.js owns you from there). Peds/cops never jump, so
      // the population still can't wander into the sea.
      const vw = w >= d ? w : 1.4, vd = d > w ? d : 1.4;
      const m = new THREE.Mesh(new THREE.BoxGeometry(vw, 0.55, vd), mat(0x9aa0a6));
      m.position.set(x, 0.275, z); m.castShadow = false; m.receiveShadow = true; root.add(m);
      const pad = 22;
      CBZ.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, ref: m, y0: 0, y1: 0.8 });
      return pad;
    }
    const EW = minX - 26, EE = maxX + 26, ES = minZ - 26, EN = maxZ + 26, T = 4;
    // THE BEACH GAP: the south seawall opens over one stretch — city/beach.js
    // lays sand there and the shore must run straight into the water (no
    // knee-wall, no cap). The wall resumes either side of the span.
    const BX0 = cx - 110, BX1 = cx - 10;
    wall((EW + BX0) / 2, ES, BX0 - EW, T); wall((BX1 + EE) / 2, ES, EE - BX1, T);
    // THE NORTH CAUSEWAY GATE: city/island_airport.js runs a 24m-wide highway
    // causeway straight across the harbor from the mainland's NORTH edge (centred
    // on cx) up to the airport island. The north seawall MUST open for it, or the
    // player hits an invisible knee-wall at the causeway mouth while NPC cars
    // (which navigate by region-clamp, not colliders) drive right through. The
    // gap matches the deck width; the causeway's own side curbs carry the
    // fall-guard line across the opening, so no car can slip off into the sea.
    const NGATE = 26;                                   // ≥ 24m deck width
    wall((EW + (cx - NGATE / 2)) / 2, EN, (cx - NGATE / 2) - EW, T);
    wall(((cx + NGATE / 2) + EE) / 2, EN, EE - (cx + NGATE / 2), T);
    // THE WEST CAUSEWAY GATE: city/island_military.js runs the 24m-wide highway
    // causeway from the mainland's WEST edge (centred on cz, z=-700) out to the
    // military base. Same fix as the north gate — open the seawall or the player
    // hits an invisible knee-wall at the mouth while NPC cars (region-clamp, not
    // colliders) drive through. The causeway's side curbs carry the fall-guard.
    const WGATE = 26;                                   // ≥ 24m deck width
    wall(EW, (ES + (cz - WGATE / 2)) / 2, T, (cz - WGATE / 2) - ES);
    wall(EW, ((cz + WGATE / 2) + EN) / 2, T, EN - (cz + WGATE / 2));
    // The east wall has a real road gate. city/expansion.js continues this
    // centre cross-street across a bridge into the island district.
    const GATE = 22;
    wall(EE, (ES + (cz - GATE / 2)) / 2, T, cz - GATE / 2 - ES);
    wall(EE, ((cz + GATE / 2) + EN) / 2, T, EN - (cz + GATE / 2));

    // ---- waypoint helpers ----
    function lotAt(i, j) { return lots.find((l) => l.i === i && l.j === j); }
    function randomSidewalkPoint() {
      // a point on the sidewalk ring around a random block
      const l = lots[(rng() * lots.length) | 0];
      const edge = (rng() * 4) | 0, t = (rng() - 0.5) * l.w;
      const off = l.w / 2 + 1.6;
      if (edge === 0) return { x: l.cx + t, z: l.cz - off };
      if (edge === 1) return { x: l.cx + t, z: l.cz + off };
      if (edge === 2) return { x: l.cx - off, z: l.cz + t };
      return { x: l.cx + off, z: l.cz + t };
    }
    function randomRoadPoint() {
      const r = roads[(rng() * roads.length) | 0];
      const along = (rng() - 0.5) * r.len * 0.9;
      const lane = (rng() < 0.5 ? -1 : 1) * (ROAD * 0.22);
      return r.vertical ? { x: r.x + lane, z: r.z + along, vertical: true }
                        : { x: r.x + along, z: r.z + lane, vertical: false };
    }
    function nearestIntersection(x, z) {
      // Intersections are a regular (N+1)² grid. The nearest 2D point is
      // exactly the independently nearest x-line and z-line, so avoid scanning
      // the whole grid for every traffic car, every frame.
      const i = Math.max(0, Math.min(N, Math.round((x - xLines[0]) / step)));
      const j = Math.max(0, Math.min(N, Math.round((z - zLines[0]) / step)));
      return intersections[i * (N + 1) + j];
    }
    // ---- DISTRICT FIELD: busy and quiet by DESIGN -----------------------
    // WHY: pacing. config.js CITY.districts gives every 2×2-lot quadrant a
    // personality (downtown packed, docks sparse) so foot traffic, casting
    // and cop beats differ by neighbourhood and "where do I do this crime"
    // is a real decision. Same 3×3 carve + names as turf.js zones, so the
    // takeover map and the population field agree. All weights live in
    // config; the pickers below are deterministic from the caller's rng,
    // so the harness world stays stable.
    // (DISTRICTS / districtQ now live ABOVE the lot loop — the lot pads need
    // the district kind at build time, and each lot is stamped at push.)
    function districtAt(x, z) {
      const i = Math.max(0, Math.min(N - 1, ((x - xLines[0]) / step) | 0));
      const j = Math.max(0, Math.min(N - 1, ((z - zLines[0]) / step) | 0));
      return DISTRICTS[districtQ(i, j)] || null;
    }
    // OFFICE-TOWER POLICY (consumed by city/buildings.js): which TALL towers read
    // as workplaces instead of homes. WHY: downtown/midtown should be glass office
    // stacks full of seated workers (witnesses + payroll), not just apartments —
    // the skyline tells you where the 9-to-5 money is. Deterministic (NO rng draw,
    // so the world build stays byte-identical): only the busy commercial cores
    // (core = Midtown, commercial = Eastgate/Westend/Harborside) qualify, and a
    // stable ~half of THOSE lots flip — a lot-index parity hash — so a believable
    // MIX of offices and flats lines each downtown block rather than all-or-none.
    // buildings.js further gates on storeys>=3 and never overrides a listed home.
    function officeLot(lot) {
      if (!lot) return false;
      const D = DISTRICTS[lot.district];
      if (!D || (D.kind !== "core" && D.kind !== "commercial")) return false;
      return (((lot.i | 0) * 3 + (lot.j | 0)) & 1) === 0;   // stable subset (~half)
    }
    // cumulative lot weights, built once per key (no rng draws → world build
    // is byte-identical to before; only the CALLERS' picks redistribute).
    function lotCum(key) {
      const cum = new Float64Array(lots.length);
      let t = 0;
      for (let k = 0; k < lots.length; k++) {
        const d = DISTRICTS[lots[k].district];
        t += d && d[key] != null ? d[key] : 1;
        cum[k] = t;
      }
      return { cum, total: t };
    }
    const popW = lotCum("pop"), copW = lotCum("cops");
    function pickWeightedLot(w, r) {
      if (!(w.total > 0)) return lots[(r() * lots.length) | 0];
      const x = r() * w.total;
      for (let k = 0; k < w.cum.length; k++) if (x <= w.cum[k]) return lots[k];
      return lots[lots.length - 1];
    }
    function sidewalkOf(l, r) {           // a point on a lot's sidewalk ring
      const edge = (r() * 4) | 0, t = (r() - 0.5) * l.w;
      const off = l.w / 2 + 1.6;
      if (edge === 0) return { x: l.cx + t, z: l.cz - off };
      if (edge === 1) return { x: l.cx + t, z: l.cz + off };
      if (edge === 2) return { x: l.cx - off, z: l.cz + t };
      return { x: l.cx + off, z: l.cz + t };
    }
    // density-weighted sidewalk point: downtown draws ~4× the docks. Pass your
    // own rng for a deterministic stream; defaults to the city rng.
    function weightedSidewalkPoint(r) { r = r || rng; return sidewalkOf(pickWeightedLot(popW, r), r); }
    // cop-beat point: a road lane point bordering a cops-weighted lot, so
    // police presence follows the money (heavy downtown, thin at the docks).
    // police.js can swap its randomRoadPoint() calls for this — same shape.
    function copBeatPoint(r) {
      r = r || rng;
      const l = pickWeightedLot(copW, r);
      const lane = (r() < 0.5 ? -1 : 1) * (ROAD * 0.22);
      if (r() < 0.5) {                    // a bordering avenue (runs along z)
        const x = xLines[l.i + (r() < 0.5 ? 0 : 1)];
        return { x: x + lane, z: l.cz + (r() - 0.5) * l.d, vertical: true };
      }
      const z = zLines[l.j + (r() < 0.5 ? 0 : 1)];   // a bordering cross-street
      return { x: l.cx + (r() - 0.5) * l.w, z: z + lane, vertical: false };
    }

    function clampRect(p, x0, x1, z0, z1) {
      return { x: Math.max(x0, Math.min(x1, p.x)), z: Math.max(z0, Math.min(z1, p.z)) };
    }
    function clampCircle(p, x, z, radius) {
      const dx = p.x - x, dz = p.z - z, d = Math.hypot(dx, dz) || 1;
      const s = radius / d;
      return { x: x + dx * s, z: z + dz * s };
    }
    function clampToCity(p, r) {
      r = r || 0.6;
      const x0 = minX - 22 + r, x1 = maxX + 22 - r;
      const z0 = minZ - 22 + r, z1 = maxZ + 22 - r;
      if (p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1) return;

      // city/expansion.js installs these after the base descriptor exists.
      // Treat the mainland, bridge and island as one connected walkable union.
      const A = city && city.annex, B = city && city.bridge;
      if (B && p.x >= B.minX + r && p.x <= B.maxX - r && p.z >= B.minZ + r && p.z <= B.maxZ - r) return;
      if (A && Math.hypot(p.x - A.cx, p.z - A.cz) <= A.radius - r) return;

      // worldmap.js islands & biomes (+ their bridges) register here as a
      // connected walkable union — same treatment as the mainland/annex.
      const regs = city && city.regions;
      if (regs && CBZ.cityRegionHit) {
        for (let i = 0; i < regs.length; i++) if (CBZ.cityRegionHit(regs[i], p.x, p.z, r)) return;
      }

      const spots = [clampRect(p, x0, x1, z0, z1)];
      if (B) spots.push(clampRect(p, B.minX + r, B.maxX - r, B.minZ + r, B.maxZ - r));
      if (A) spots.push(clampCircle(p, A.cx, A.cz, A.radius - r));
      if (regs && CBZ.cityRegionClamp) {
        for (let i = 0; i < regs.length; i++) spots.push(CBZ.cityRegionClamp(regs[i], p.x, p.z, r));
      }
      let best = spots[0], bd = Infinity;
      for (const q of spots) {
        const d = (q.x - p.x) * (q.x - p.x) + (q.z - p.z) * (q.z - p.z);
        if (d < bd) { bd = d; best = q; }
      }
      p.x = best.x; p.z = best.z;
    }

    city = {
      root, center: { x: cx, z: cz },
      N, step, BLK, ROAD, xLines, zLines, minX, maxX, minZ, maxZ,
      lots, roads, intersections, rng,
      // the day/night-tinted water material — expansion.js's island ocean can
      // share it so the whole sea shifts tone together
      seaMat,
      // the waterfront lines + the south seawall's beach gap (city/beach.js
      // builds sand/boardwalk/pier inside this span; the wall above skips it)
      shore: { EW, EE, ES, EN, beach: { x0: BX0, x1: BX1 } },
      // Universal ground-height oracle (mode.js routes CBZ.floorAt here in
      // city mode). The procedural backdrop terrain returns EXACTLY 0 over the
      // whole playable region (city + biomes + islands + roads + spawns), so
      // this is byte-identical to flat anywhere a person/vehicle can stand —
      // only the far backdrop ring has relief. Falls back to flat 0 if
      // terrain.js / PROC_TERRAIN is off.
      groundHeightAt(x, z) { return (window.CBZ.terrainHeight ? CBZ.terrainHeight(x, z) : 0); },
      lotAt, randomSidewalkPoint, randomRoadPoint, nearestIntersection, clampToCity,
      // district personality field (peds/crowd density, casting, cop beats)
      districts: DISTRICTS, districtAt, weightedSidewalkPoint, copBeatPoint,
      // which tall towers are OFFICES (workplaces) vs homes — buildings.js reads it
      officeLot,
      // a clear spawn: the central intersection sidewalk corner
      spawn: { x: cx + ROAD / 2 + 2, z: cz + ROAD / 2 + 2 },
      transients: [],
      reset() {
        // remove any per-run transient meshes (crashed cars, drops, fx) so a
        // replay starts clean; permanent geometry (roads/buildings) stays.
        for (let i = root.children.length - 1; i >= 0; i--) {
          const ch = root.children[i];
          if (ch.userData && ch.userData.transient) {
            root.remove(ch);
            if (ch.geometry && ch.geometry.dispose) ch.geometry.dispose();
            if (ch.material && ch.material.dispose) ch.material.dispose();
          }
        }
        if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
      },
    };

    // =====================================================================
    //  ROAD + SIDEWALK SURFACE DETAIL — cheap flat geometry that makes the
    //  streets read as REAL: raised curbs along every block, painted stop-bars
    //  at intersections, manhole covers + storm-drain grates, sidewalk
    //  expansion joints, and a sprinkle of asphalt patches/oil stains. All
    //  decor: no colliders, nothing placed in a driving lane.
    // =====================================================================
    let paintRedCurb = null;   // set inside roadDetail; used after the props hook
    (function roadDetail() {
      // shared materials so hundreds of marks cost almost nothing
      const M = new Map();
      function dm(color, basic) {
        let m = M.get(color + "|" + (basic ? 1 : 0));
        if (!m) { m = basic ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshLambertMaterial({ color }); M.set(color + "|" + (basic ? 1 : 0), m); }
        return m;
      }
      // a flat decal quad lying on the ground
      function decal(x, z, w, d, color, y, basic, rotY) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), dm(color, basic));
        m.rotation.x = -Math.PI / 2; if (rotY) m.rotation.z = rotY;
        m.position.set(x, y == null ? 0.085 : y, z);
        m.receiveShadow = !basic; root.add(m);
        return m;
      }
      // a low raised curb box (a sliver of height so it reads as a kerb edge)
      const curbM = dm(0xb9ad88);
      function curb(x, z, len, vertical) {
        const w = vertical ? 0.34 : len, d = vertical ? len : 0.34;
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.22, d), curbM);
        m.position.set(x, 0.11, z); m.receiveShadow = true; root.add(m);
      }

      // ---- 1) curbs ringing every block (just inside the sidewalk band) ----
      // The sidewalk slab is BLK+4 wide; the kerb runs along the road-facing edge
      // a touch in from the asphalt so cars visibly mount it but it never blocks.
      const sidewalkHalf = (BLK + 4) / 2;
      for (const lot of lots) {
        const cx2 = lot.cx, cz2 = lot.cz, e = sidewalkHalf - 0.2, span = BLK + 3.2;
        curb(cx2, cz2 - e, span, false);
        curb(cx2, cz2 + e, span, false);
        curb(cx2 - e, cz2, span, true);
        curb(cx2 + e, cz2, span, true);
        // sidewalk expansion-joint lines (subtle scored concrete grid)
        for (let s = -1; s <= 1; s += 2) {
          for (let j = -1; j <= 1; j += 1) {
            if (j === 0) continue;
            decal(cx2 + j * (BLK / 4), cz2 + s * (sidewalkHalf - 1.0), 0.06, 2.2, 0xa89e7c, 0.088, true);
            decal(cx2 + s * (sidewalkHalf - 1.0), cz2 + j * (BLK / 4), 2.2, 0.06, 0xa89e7c, 0.088, true);
          }
        }
      }

      // ---- 2) painted STOP-BAR at every intersection approach --------------
      const stopOff = ROAD / 2 + 2.6;
      intersections.forEach((it) => {
        // thick white bar across each of the four entries, set back behind the zebra
        decal(it.x - ROAD / 4, it.z - stopOff, ROAD / 2 - 0.4, 0.4, 0xeef1f5, 0.072, true);
        decal(it.x + ROAD / 4, it.z + stopOff, ROAD / 2 - 0.4, 0.4, 0xeef1f5, 0.072, true);
        decal(it.x - stopOff, it.z + ROAD / 4, 0.4, ROAD / 2 - 0.4, 0xeef1f5, 0.072, true);
        decal(it.x + stopOff, it.z - ROAD / 4, 0.4, ROAD / 2 - 0.4, 0xeef1f5, 0.072, true);
      });

      // ---- 3) manhole covers + storm-drain grates -------------------------
      // covers down the centre of avenues; grates hug the kerb at corners where
      // gutter water would drain. Both are flush decals.
      const manholeG = new THREE.CircleGeometry(0.55, 12);
      const manM = dm(0x35383d), grateM = dm(0x202327);
      function manhole(x, z) {
        const m = new THREE.Mesh(manholeG, manM);
        m.rotation.x = -Math.PI / 2; m.position.set(x, 0.066, z); root.add(m);
        // a couple of concentric scribe rings via thin ring decals
        decal(x, z, 0.84, 0.84, 0x2a2d32, 0.067, true);
      }
      for (const r of roads) {
        const n = Math.max(1, Math.floor(r.len / 40));
        for (let i = 1; i < n; i++) {
          if (rng() > 0.6) continue;
          const t = -r.len / 2 + i * (r.len / n) + (rng() - 0.5) * 6;
          const x = r.vertical ? r.x + (rng() - 0.5) * 1.2 : r.x + t;
          const z = r.vertical ? r.z + t : r.z + (rng() - 0.5) * 1.2;
          if (Math.abs(x) < 9990) manhole(x, z);
        }
      }
      // gutter grates near intersection corners
      intersections.forEach((it) => {
        for (let sx = -1; sx <= 1; sx += 2) for (let sz = -1; sz <= 1; sz += 2) {
          if (rng() > 0.5) continue;
          const gx = it.x + sx * (ROAD / 2 + 0.5), gz = it.z + sz * (ROAD / 2 + 0.5);
          const g = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), grateM);
          g.rotation.x = -Math.PI / 2; g.position.set(gx, 0.066, gz); root.add(g);
        }
      });

      // ---- 4) asphalt patches + oil stains + tyre marks (grime/realism) ----
      const patchCols = [0x1b1d22, 0x222429, 0x303236];
      for (const r of roads) {
        const n = Math.max(2, Math.floor(r.len / 30));
        for (let i = 0; i < n; i++) {
          if (rng() > 0.55) continue;
          const t = -r.len / 2 + (i + rng()) * (r.len / n);
          const lane = (rng() - 0.5) * (ROAD - 2);
          const x = r.vertical ? r.x + lane : r.x + t;
          const z = r.vertical ? r.z + t : r.z + lane;
          if (Math.abs(x) > 9990) continue;
          const w = 1.5 + rng() * 3, d = 1.0 + rng() * 2.5;
          decal(x, z, r.vertical ? d : w, r.vertical ? w : d, patchCols[(rng() * patchCols.length) | 0], 0.055 + rng() * 0.006, false, (rng() - 0.5) * 0.4);
        }
      }
      // skid/oil stains right in the intersection boxes (where cars launch off)
      intersections.forEach((it) => {
        if (rng() > 0.5) return;
        for (let s = 0; s < 2; s++) {
          decal(it.x + (rng() - 0.5) * ROAD * 0.5, it.z + (rng() - 0.5) * ROAD * 0.5, 0.18, 1.4 + rng() * 1.2, 0x141519, 0.058, true, (rng() - 0.5) * 1.4);
        }
      });

      // ---- 5) painted TURN ARROWS at the Midtown-core intersections --------
      //  (why: managed, money-side streets — the core LOOKS administered).
      //  Shared geometry + the dm() cache; no rng draws, so everything the
      //  sibling modules build from city.rng stays byte-identical.
      const arrowM = dm(0xeef1f5, true);
      const shaftGV = new THREE.PlaneGeometry(0.26, 1.5), shaftGH = new THREE.PlaneGeometry(1.5, 0.26);
      const headG = new THREE.CircleGeometry(0.42, 3);   // 3-segment circle = clean triangle head
      function turnArrow(x, z, fx, fz, rotZ) {
        // shaft along the lane; the head sits at the shaft's front, rotated
        // 90° toward the curb — reads as a right-turn lane marking
        const sM = new THREE.Mesh(fx ? shaftGH : shaftGV, arrowM);
        sM.rotation.x = -Math.PI / 2; sM.position.set(x, 0.072, z); root.add(sM);
        const h = new THREE.Mesh(headG, arrowM);
        h.rotation.x = -Math.PI / 2; h.rotation.z = rotZ;
        h.position.set(x + fx * 0.95, 0.072, z + fz * 0.95); root.add(h);
      }
      // PER-LANE turn arrows at the new lane centres (laneW*(idx+0.5)): the
      // outermost lane on each approach gets the right-turn marking, so the
      // arrows sit ON the real lanes the traffic AI drives in.
      const aOff = stopOff + 1.7, outLane = laneW * (lanesPerDir - 1 + 0.5);
      intersections.forEach((it) => {
        if (it.i < 2 || it.i > 4 || it.j < 2 || it.j > 4) return;   // the Midtown frame only
        turnArrow(it.x + outLane, it.z - aOff, 0, 1, 0);              // south approach → head +x
        turnArrow(it.x - outLane, it.z + aOff, 0, -1, Math.PI);       // north approach → head -x
        turnArrow(it.x - aOff, it.z - outLane, 1, 0, Math.PI / 2);    // west approach → head -z
        turnArrow(it.x + aOff, it.z + outLane, -1, 0, -Math.PI / 2);  // east approach → head +z
      });

      // ---- 6) RED CURB painter (fire lanes) --------------------------------
      //  props.js places hydrants AFTER this pass, so expose a painter the
      //  post-props pass at the bottom of buildCity uses. A slightly larger
      //  box wraps the existing curb segment — no z-fight, pure decor.
      paintRedCurb = function (x, z, vertical) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(vertical ? 0.38 : 4.2, 0.24, vertical ? 4.2 : 0.38), dm(0xc23434));
        m.position.set(x, 0.115, z); m.receiveShadow = true; root.add(m);
      };
    })();

    // ---- let sibling modules furnish the city (buildings, props, lights) ----
    if (CBZ.cityBuildings) try { CBZ.cityBuildings(city); } catch (e) { console.error("[city buildings]", e); }
    if (CBZ.cityExpansion) try { CBZ.cityExpansion(city); } catch (e) { console.error("[city expansion]", e); }
    // worldmap.js: 3 new islands (speedway/airport/military) + 4 biome
    // landmasses (desert/forest/farmland/snow). Runs AFTER the original island
    // so it can read city.maxX/annex and register its own walkable regions.
    if (CBZ.cityWorldGeo) try { CBZ.cityWorldGeo(city); } catch (e) { console.error("[city worldgeo]", e); }
    if (CBZ.cityProps) try { CBZ.cityProps(city); } catch (e) { console.error("[city props]", e); }

    // ---- RED CURBS at hydrants (props.js just placed them): paint the curb
    //      beside every other hydrant — the fire lane explains itself and
    //      blocks stop reading copy-paste identical. Runs AFTER the hooks
    //      because hydrants don't exist until cityProps; draws no rng. ----
    if (paintRedCurb && city.streetProps) {
      const e = (BLK + 4) / 2 - 0.2;   // the curb line's offset from a lot centre
      let painted = 0, idx = 0;
      for (const p of city.streetProps) {
        if (p.type !== "hydrant") continue;
        if ((idx++ & 1) || painted >= 8) continue;     // every other one, max 8
        let lot = null, bd = 1e9;
        for (const l of lots) {
          const d = Math.abs(p.x - l.cx) + Math.abs(p.z - l.cz);
          if (d < bd) { bd = d; lot = l; }
        }
        if (!lot) break;
        const dx = p.x - lot.cx, dz = p.z - lot.cz;
        if (Math.abs(dx) > Math.abs(dz)) paintRedCurb(lot.cx + Math.sign(dx) * e, p.z, true);
        else paintRedCurb(p.x, lot.cz + Math.sign(dz) * e, false);
        painted++;
      }
    }

    // ---- EAST HARBOR: the bridge-approach gap used to be bare void over
    //      nothing. A sand shoulder under the seawall, rip-rap armour at the
    //      waterline (it also hides the ground apron's hard edge) and a few
    //      moored hulls make the crossing READ as a working harbor. Decor
    //      only — it all sits OUTSIDE the perimeter wall, so no colliders.
    //      LOCAL rng: the shared city/runtime stream stays untouched. ----
    (function eastHarbor() {
      let hs = 70707;
      function hr() { hs = (hs * 1103515245 + 12345) & 0x7fffffff; return hs / 0x7fffffff; }
      const hm = new Map();
      function hmat(c) { let m = hm.get(c); if (!m) { m = new THREE.MeshLambertMaterial({ color: c }); hm.set(c, m); } return m; }
      const EEx = maxX + 26;                  // the east seawall line
      // sand shoulder either side of the bridge gate
      const sand = new THREE.Mesh(new THREE.PlaneGeometry(20, 150), hmat(0xe6d49a));
      sand.rotation.x = -Math.PI / 2; sand.position.set(EEx + 10, 0.02, cz);
      sand.receiveShadow = true; root.add(sand);
      // rip-rap: rock armour where the sand meets the water
      const rockM = hmat(0x6a7076);
      for (let i = 0; i < 16; i++) {
        const s = 1.1 + hr() * 1.9;
        const rx = EEx + 17.5 + hr() * 4.5, ry = -0.4 + hr() * 0.5;
        const rz = cz - 72 + i * 9 + (hr() - 0.5) * 4;
        const yaw = hr() * Math.PI, tilt = (hr() - 0.5) * 0.3;
        if (Math.abs(rz - cz) < 12) continue;          // keep the bridge span clear
        const r = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.8, s * 1.2), rockM);
        r.position.set(rx, ry, rz); r.rotation.y = yaw; r.rotation.z = tilt;
        r.castShadow = false; r.receiveShadow = true; root.add(r);
      }
      // moored hulls riding the gap, clear of the bridge's z-band
      function boat(x, z, yaw, hullC) {
        const b = new THREE.Group(); b.position.set(x, 0, z); b.rotation.y = yaw; root.add(b);
        const hull = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.1, 7.0), hmat(hullC));
        hull.position.y = -0.05; hull.castShadow = true; b.add(hull);
        const deck = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.25, 6.2), hmat(0xd9d2bd));
        deck.position.y = 0.55; b.add(deck);
        const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 2.0), hmat(0xe8ebee));
        cab.position.set(0, 1.15, -1.2); cab.castShadow = true; b.add(cab);
      }
      boat(EEx + 34, cz - 26, 0.35, 0x9e3434);
      boat(EEx + 46, cz + 24, -0.5, 0x2f5d8a);
      boat(EEx + 38, cz + 44, 0.15, 0x9e3434);

      // ---- THE WATERFRONT RING: the other three coasts get the same harbor
      //      treatment (the east already has it) — rip-rap rock armour where
      //      the quay meets the water, mooring bollards along the promenade,
      //      a few hulls riding offshore. Decor only, outside the seawall
      //      colliders; same shared materials, ~70 small meshes total. ----
      const WQ = minX - 26, SQ = minZ - 26, NQ = maxZ + 26;   // seawall lines
      const bollM = hmat(0x2e3238);
      function bollard(x, z) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.7, 0.42), bollM);
        b.position.set(x, 0.35, z); b.castShadow = false; b.receiveShadow = true; root.add(b);
      }
      function riprap(x, z, count, vertical, skipX0, skipX1) {
        for (let i = 0; i < count; i++) {
          const s = 1.0 + hr() * 1.8;
          const along = (i / count - 0.5) * (vertical ? (NQ - SQ) - 18 : (EEx - WQ) - 18);
          const out = 1.6 + hr() * 3.2;
          const rx = vertical ? x + (x < cx ? -out : out) : x + along;
          const rz = vertical ? z + along : z + (z < cz ? -out : out);
          if (skipX0 != null && rx > skipX0 && rx < skipX1) continue;   // the beach span: sand, not rock armour
          const r = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.7, s * 1.15), rockM);
          r.position.set(rx, -0.45 + hr() * 0.55, rz);
          r.rotation.y = hr() * Math.PI; r.rotation.z = (hr() - 0.5) * 0.35;
          r.castShadow = false; r.receiveShadow = true; root.add(r);
        }
      }
      riprap(cx, SQ, 14, false, BX0, BX1);   // south shore (beach span stays bare sand)
      riprap(cx, NQ, 14, false);   // north shore
      riprap(WQ, cz, 14, true);    // west shore
      for (let i = 0; i < 7; i++) {  // bollards every ~30m, set in from the cap
        const t = (i / 6 - 0.5) * ((EEx - WQ) - 30);
        if (cx + t < BX0 || cx + t > BX1) bollard(cx + t, SQ + 2.0);   // none on the beach
        bollard(cx + t, NQ - 2.0);
        const tz = (i / 6 - 0.5) * ((NQ - SQ) - 30);
        bollard(WQ + 2.0, cz + tz);
      }
      boat(WQ - 18, cz - 40, 2.0, 0x2f5d8a);   // hulls riding the other coasts
      boat(cx - 60, SQ - 16, 1.25, 0x9e3434);
      boat(cx + 70, NQ + 17, -1.0, 0xd9a13a);
    })();

    // ---- THE WATERFRONT WITH A PURPOSE (city/beach.js): sand beach +
    //      boardwalk + pier in the south seawall gap, parking lot + container
    //      dockyard breaking up the rest of the gray apron. Runs LAST so the
    //      seawall lines / harbor decor already exist around it. ----
    if (CBZ.cityBuildBeach) try { CBZ.cityBuildBeach(city); } catch (e) { console.error("[city beach]", e); }

    root.visible = false;     // hidden until city mode activates
    return city;
  };
})();
