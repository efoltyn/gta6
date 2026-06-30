/* ============================================================
   city/highways.js — the shared REAL-highway builder.

   CBZ.buildHighway(root, opts) lays a multi-lane highway ribbon along a
   centreline polyline (straight or L-shaped). It is the one builder the
   island causeways CALL — the island module owns placement + region
   registration; this file only knows how to make ONE highway cheaply.

   WHY draw-call discipline (the engine is draw-call bound): everything that
   repeats is MERGED or INSTANCED, and ALL lane markings are BAKED into the
   deck's CanvasTexture (UV-mapped along the ribbon) so painting the centre
   line + dashed dividers + edge/fog lines costs ZERO extra draw calls. A
   whole highway is ~5-6 draw calls: deck, (rumble shoulders share the deck),
   one guardrail InstancedMesh per side, one light-pole InstancedMesh, and —
   if elevated — one pylon InstancedMesh + a couple of ramp wedges.

   Deterministic: no global rng — jitter (if any) comes from opts.rng, the
   caller's seeded fn. Headless-safe: no <canvas> → flat coloured deck.

   Returns { group, deckTop(x,z)->y, footprint:{minX,maxX,minZ,maxZ} }.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  const _highways = [];
  CBZ.cityHighways = function () { return _highways; };

  const THEME = {
    asphalt:  { deck: "#2a2c32", edge: "#23252a", rumble: 0x3a3d44 },
    concrete: { deck: "#9498a0", edge: "#80848c", rumble: 0xa8acb4 },
    dirt:     { deck: "#6b5a42", edge: "#5a4b37", rumble: 0x7a6850 }
  };

  // SMALL TILING ASPHALT texture (no baked lane lines). WHY the rewrite: lane
  // lines baked into a 128px-wide canvas and stretched over a 24m × up-to-286m
  // ribbon MIP-COLLAPSED at grazing angle into a broken, shimmering stripe that
  // read as a yellow line FLOATING in the air, over a flat untextured slab. Now
  // the deck is plain tiling tarmac and the markings are crisp merged GEOMETRY
  // just above it (buildLanePaint) — the exact look the good in-city roads use.
  function bakeAsphalt(theme) {
    let cv;
    try { cv = document.createElement("canvas"); } catch (e) { return null; }
    if (!cv || !cv.getContext) return null;
    const S = 64; cv.width = S; cv.height = S;
    const g = cv.getContext("2d"); if (!g) return null;
    g.fillStyle = theme.deck; g.fillRect(0, 0, S, S);
    // faint grain so the tarmac reads as a real surface, not a flat slab
    for (let i = 0; i < 800; i++) {
      const lvl = (Math.random() - 0.5) * 0.12;
      g.fillStyle = (lvl >= 0 ? "rgba(255,255,255," : "rgba(0,0,0,") + Math.abs(lvl).toFixed(3) + ")";
      g.fillRect((Math.random() * S) | 0, (Math.random() * S) | 0, 1, 1);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;     // tiles across AND along
    tex.anisotropy = 4;
    return tex;
  }

  // CRISP LANE PAINT as merged flat geometry coplanar just above the deck. WHY:
  // geometry lines can NEVER mip-collapse into a floating smear the way baked
  // texture lines did. Exactly TWO meshes total (one white, one yellow) no matter
  // how long the road — every dash/line accumulates into shared arrays then builds
  // once (the world.js paintMesh discipline). Lane offsets match the lanes the
  // traffic AI drives (±k·laneW dividers, ±(width/2−0.4) edge lines).
  function buildLanePaint(path, width, lanesPerDir, laneW, deckY, median) {
    const white = [], yellow = [], y = deckY + 0.015;
    function quad(arr, ax, az, bx, bz, dx, dz, off, hw) {
      const px = -dz, pz = dx, oL = off - hw, oR = off + hw;        // unit perpendicular
      const aLx = ax + px * oL, aLz = az + pz * oL, aRx = ax + px * oR, aRz = az + pz * oR;
      const bLx = bx + px * oL, bLz = bz + pz * oL, bRx = bx + px * oR, bRz = bz + pz * oR;
      arr.push(aLx, y, aLz, aRx, y, aRz, bRx, y, bRz, aLx, y, aLz, bRx, y, bRz, bLx, y, bLz);
    }
    function solid(arr, off, hw) {
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i], b = path[i + 1]; let dx = b.x - a.x, dz = b.z - a.z;
        const L = Math.hypot(dx, dz) || 1e-3; dx /= L; dz /= L;
        quad(arr, a.x, a.z, b.x, b.z, dx, dz, off, hw);
      }
    }
    function dashed(arr, off, hw) {
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i], b = path[i + 1]; let dx = b.x - a.x, dz = b.z - a.z;
        const L = Math.hypot(dx, dz) || 1e-3; dx /= L; dz /= L;
        for (let t = 0; t + 2.4 <= L; t += 7) quad(arr, a.x + dx * t, a.z + dz * t, a.x + dx * (t + 2.4), a.z + dz * (t + 2.4), dx, dz, off, hw);
      }
    }
    if (median) solid(yellow, 0, laneW * 0.25);                       // a median band
    else { solid(yellow, -0.26, 0.08); solid(yellow, 0.26, 0.08); }   // double yellow centreline
    for (let s = -1; s <= 1; s += 2) {
      for (let k = 1; k < lanesPerDir; k++) dashed(white, s * k * laneW, 0.07);   // lane dividers
      solid(white, s * (width / 2 - 0.4), 0.08);                                  // edge/fog line
    }
    const out = [];
    function mesh(arr, color) {
      if (!arr.length) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(arr), 3));
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: color }));
      m.matrixAutoUpdate = false; m.receiveShadow = false; m.renderOrder = 1;
      out.push(m);
    }
    mesh(white, 0xeef1f5); mesh(yellow, 0xf2c83a);
    return out;
  }

  // turn the centreline polyline into per-segment quads (a flat ribbon at y),
  // accumulating positions/uvs into a merged BufferGeometry. UV: u across
  // (0..1), v along (metres → texture repeat handled by tex.repeat).
  function buildDeck(path, width, y, mat, vRepeatPerM) {
    const pos = [], uv = [], nrm = [];
    let vAcc = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      let dx = b.x - a.x, dz = b.z - a.z;
      const segLen = Math.hypot(dx, dz) || 1e-3;
      dx /= segLen; dz /= segLen;
      const px = -dz * width / 2, pz = dx * width / 2;   // half-width perpendicular
      const v0 = vAcc, v1 = vAcc + segLen * vRepeatPerM; vAcc = v1;
      // corners: left/right at a and b
      const aL = [a.x - px, a.z - pz], aR = [a.x + px, a.z + pz];
      const bL = [b.x - px, b.z - pz], bR = [b.x + px, b.z + pz];
      const quad = [
        [aL, 0, v0], [aR, 1, v0], [bR, 1, v1],
        [aL, 0, v0], [bR, 1, v1], [bL, 0, v1]
      ];
      for (const c of quad) {
        pos.push(c[0][0], y, c[0][1]);
        nrm.push(0, 1, 0);
        uv.push(c[1], c[2]);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(nrm), 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uv), 2));
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true; m.matrixAutoUpdate = false;
    return { mesh: m, length: vAcc / vRepeatPerM };
  }

  CBZ.buildHighway = function (root, opts) {
    opts = opts || {};
    const path = (opts.path && opts.path.length >= 2) ? opts.path : [{ x: 0, z: 0 }, { x: 0, z: 100 }];
    const width = opts.width != null ? opts.width : 24;
    const lanesPerDir = Math.max(1, (opts.lanesPerDir != null ? opts.lanesPerDir : 2) | 0);
    const laneW = opts.laneW != null ? opts.laneW : 3.6;
    const elevated = !!opts.elevated;
    const theme = THEME[opts.theme] || THEME.asphalt;
    const median = !!opts.median;
    const rng = typeof opts.rng === "function" ? opts.rng : Math.random;
    const deckY = elevated ? 2.5 : 0.05;

    const group = new THREE.Group();
    (root || CBZ.scene).add(group);

    // total length (for texture detail + light/pylon spacing)
    let totLen = 0;
    for (let i = 0; i < path.length - 1; i++) totLen += Math.hypot(path[i + 1].x - path[i].x, path[i + 1].z - path[i].z);

    // ---- deck ribbon: plain TILING tarmac + crisp GEOMETRY lane paint above it
    //      (was a stretched baked-line canvas → the floating-yellow-line bug) ----
    const tex = bakeAsphalt(theme);
    let deckMat;
    if (tex) { tex.repeat.set(width / 8, 1); deckMat = new THREE.MeshLambertMaterial({ map: tex }); }
    else deckMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(theme.deck) });
    const vRepeatPerM = tex ? (1 / 8) : 0.0625;        // tile every ~8m along (U tiles via tex.repeat.x)
    const deck = buildDeck(path, width, deckY, deckMat, vRepeatPerM);
    group.add(deck.mesh);
    const lanePaint = buildLanePaint(path, width, lanesPerDir, laneW, deckY, median);
    for (let i = 0; i < lanePaint.length; i++) group.add(lanePaint[i]);

    // footprint (axis-aligned bounds over all corners)
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const p of path) {
      minX = Math.min(minX, p.x - width / 2); maxX = Math.max(maxX, p.x + width / 2);
      minZ = Math.min(minZ, p.z - width / 2); maxZ = Math.max(maxZ, p.z + width / 2);
    }

    // helper: walk the polyline at ~`spacing` metres, calling fn(x,z,dx,dz)
    function alongPath(spacing, fn) {
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i], b = path[i + 1];
        let dx = b.x - a.x, dz = b.z - a.z;
        const L = Math.hypot(dx, dz) || 1e-3; dx /= L; dz /= L;
        const n = Math.max(1, Math.floor(L / spacing));
        for (let k = 0; k <= n; k++) {
          if (i > 0 && k === 0) continue;   // skip shared joints
          const t = (k / n) * L;
          fn(a.x + dx * t, a.z + dz * t, dx, dz);
        }
      }
    }

    // ---- ONE continuous curb collider per side (the fall-guard) + a thin
    //      visible curb strip baked into the deck edge is enough; we only add
    //      colliders, not a mesh per post. ----
    function addCurbColliders() {
      if (!CBZ.colliders) return;
      const hw = width / 2;
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i], b = path[i + 1];
        let dx = b.x - a.x, dz = b.z - a.z;
        const L = Math.hypot(dx, dz) || 1e-3; dx /= L; dz /= L;
        const px = -dz, pz = dx;            // unit perpendicular
        for (let s = -1; s <= 1; s += 2) {
          const x0 = a.x + s * px * hw, z0 = a.z + s * pz * hw;
          const x1 = b.x + s * px * hw, z1 = b.z + s * pz * hw;
          CBZ.colliders.push({
            minX: Math.min(x0, x1) - 0.25, maxX: Math.max(x0, x1) + 0.25,
            minZ: Math.min(z0, z1) - 0.25, maxZ: Math.max(z0, z1) + 0.25,
            y0: deckY, y1: deckY + (opts.guardrail ? 1.1 : 0.4)
          });
        }
      }
    }
    addCurbColliders();

    // ---- ONE InstancedMesh W-beam guardrail per side (decorative posts+beam) ----
    if (opts.guardrail) {
      const hw = width / 2 - 0.2;
      const spots = [];
      alongPath(4, (x, z, dx, dz) => {
        const px = -dz, pz = dx, h = Math.atan2(dx, dz);
        spots.push({ x: x - px * hw, z: z - pz * hw, h });
        spots.push({ x: x + px * hw, z: z + pz * hw, h });
      });
      if (spots.length) {
        const railGeo = new THREE.BoxGeometry(0.12, 0.9, 3.8);
        const railMat = new THREE.MeshLambertMaterial({ color: 0xbfc4cb });
        const im = new THREE.InstancedMesh(railGeo, railMat, spots.length);
        const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
        const v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
        spots.forEach((s, i) => {
          e.set(0, s.h, 0); q.setFromEuler(e); v.set(s.x, deckY + 0.55, s.z);
          m4.compose(v, q, one); im.setMatrixAt(i, m4);
        });
        im.instanceMatrix.needsUpdate = true; im.castShadow = false;
        group.add(im);
      }
    }

    // ---- ONE InstancedMesh light poles (~40m), emissive head ----
    if (opts.lights) {
      const hw = width / 2 - 0.6, poles = [];
      let toggle = 0;
      alongPath(40, (x, z, dx, dz) => {
        const px = -dz, pz = dx, side = (toggle++ % 2 === 0) ? 1 : -1;   // alternate sides
        poles.push({ x: x + side * px * hw, z: z + side * pz * hw });
      });
      if (poles.length) {
        const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 7, 6);
        const poleMat = new THREE.MeshLambertMaterial({ color: 0x4b5158 });
        const pim = new THREE.InstancedMesh(poleGeo, poleMat, poles.length);
        const headGeo = new THREE.BoxGeometry(0.5, 0.25, 1.0);
        const headMat = new THREE.MeshBasicMaterial({ color: 0xfff0c0 });
        const him = new THREE.InstancedMesh(headGeo, headMat, poles.length);
        const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), q0 = new THREE.Quaternion();
        poles.forEach((s, i) => {
          p.set(s.x, deckY + 3.5, s.z); m4.compose(p, q0, one); pim.setMatrixAt(i, m4);
          p.set(s.x, deckY + 7, s.z); m4.compose(p, q0, one); him.setMatrixAt(i, m4);
        });
        pim.instanceMatrix.needsUpdate = true; him.instanceMatrix.needsUpdate = true;
        pim.castShadow = false; him.castShadow = false;
        group.add(pim); group.add(him);
      }
    }

    // ---- elevated: ONE InstancedMesh tapered pylons (~24m) + end ramp wedges ----
    if (elevated) {
      const pylonsAt = [];
      alongPath(24, (x, z) => pylonsAt.push({ x, z }));
      if (pylonsAt.length) {
        const pyGeo = new THREE.CylinderGeometry(0.9, 1.4, deckY, 8);
        const pyMat = new THREE.MeshLambertMaterial({ color: 0x8b9097 });
        const pim = new THREE.InstancedMesh(pyGeo, pyMat, pylonsAt.length);
        const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q0 = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
        pylonsAt.forEach((s, i) => { p.set(s.x, deckY / 2, s.z); m4.compose(p, q0, one); pim.setMatrixAt(i, m4); });
        pim.instanceMatrix.needsUpdate = true; pim.castShadow = false;
        group.add(pim);
      }
      // simple ramp wedge at each end down to grade (one mesh each)
      const rampMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(theme.deck) });
      [[path[0], path[1]], [path[path.length - 1], path[path.length - 2]]].forEach(([end, prev]) => {
        let dx = end.x - prev.x, dz = end.z - prev.z;
        const L = Math.hypot(dx, dz) || 1e-3; dx /= L; dz /= L;
        const rampLen = 14;
        const geo = new THREE.PlaneGeometry(width, rampLen);
        const ramp = new THREE.Mesh(geo, rampMat);
        ramp.rotation.x = -Math.PI / 2;
        // tilt down toward grade along the heading
        const h = Math.atan2(dx, dz);
        ramp.rotation.z = 0; ramp.rotation.y = h;
        ramp.position.set(end.x + dx * rampLen / 2, deckY / 2, end.z + dz * rampLen / 2);
        ramp.receiveShadow = true; group.add(ramp);
      });
    }

    // ---- HWY-3: REGISTER DRIVABLE ROAD SEGMENTS (the WHY: a highway you can
    //      SEE but cars never use is dead scenery — register each axis-aligned
    //      leg as a drivable centre-line so vehicles.js findRoad snaps onto it
    //      and traffic.js recycles cars onto it, exactly like the in-grid roads
    //      and the island causeways the callers already hand-push). Same record
    //      shape {x,z,vertical,len,district} those consumers read. Idempotent:
    //      skip a leg if an identical (x,z,vertical) segment already exists, so
    //      a caller that still pushes its own (until HWY-7 retires those) never
    //      ends up with double segments. Pure data — no extra draw calls. -------
    const builtRoads = [];
    const _cityRoads = opts.cityRoads || (CBZ.city && CBZ.city.roads);
    if (opts.registerRoads !== false && _cityRoads) {
      const roads = _cityRoads;
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i], b = path[i + 1];
        const ax = a.x, az = a.z, bx = b.x, bz = b.z;
        const adx = Math.abs(bx - ax), adz = Math.abs(bz - az);
        if (adx < 0.5 && adz < 0.5) continue;             // degenerate joint
        let seg;
        if (adx > adz) seg = { x: (ax + bx) / 2, z: az, vertical: false, len: adx, district: "highway" };
        else seg = { x: ax, z: (az + bz) / 2, vertical: true, len: adz, district: "highway" };
        // dedupe against any existing identical centre-line (caller push or a
        // prior buildHighway over the same axis) — match by axis + the two
        // coords within a tight tolerance so we never carpet city.roads.
        let dup = false;
        for (let k = 0; k < roads.length; k++) {
          const r = roads[k];
          if (!!r.vertical !== !!seg.vertical) continue;
          if (Math.abs(r.x - seg.x) < 1.0 && Math.abs(r.z - seg.z) < 1.0) { dup = true; break; }
        }
        if (dup) continue;
        roads.push(seg);
        builtRoads.push(seg);
      }
    }

    const rec = {
      group,
      deckTop: function () { return deckY; },           // flat deck → constant height
      footprint: { minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ },
      length: totLen, deckY: deckY, width: width,
      roads: builtRoads                                  // HWY-3: the drivable segs this highway registered
    };
    _highways.push(rec);
    return rec;
  };

  // ---- HWY-4: CAUSEWAY → GRID CONNECTORS (pure road DATA, no geometry — the
  //      seawall gates + causeway decks already exist in world.js). The WHY: a
  //      car on a grid avenue reaching the map edge needs ONE overlapping road
  //      segment that bridges the grid intersection and the causeway mouth so
  //      vehicles.js findRoad (9m snap tolerance) can turn the car NORTH onto the
  //      causeway instead of dead-ending at the seawall. Each connector is a
  //      single short segment laid EXACTLY on an existing grid line (so the snap
  //      lands) that overlaps both the grid edge and the first causeway segment.
  //      Registered via the same HWY-3 city.roads path; idempotent by coord.
  function pushConnector(roads, seg) {
    if (!roads) return false;
    for (let k = 0; k < roads.length; k++) {
      const r = roads[k];
      if (!!r.vertical !== !!seg.vertical) continue;
      if (Math.abs(r.x - seg.x) < 1.0 && Math.abs(r.z - seg.z) < 1.0) return false;   // already connected
    }
    seg.district = seg.district || "highway";
    roads.push(seg);
    return true;
  }
  CBZ.buildHighwayConnector = function (opts, roads) {
    opts = opts || {};
    roads = roads || (CBZ.city && CBZ.city.roads);
    if (!roads) return false;
    // {x,z,vertical,len} describing the short overlap segment; defaults give the
    // airport causeway connector (x=0 avenue → causeway start at z≈-558).
    const seg = {
      x: opts.x != null ? opts.x : 0,
      z: opts.z != null ? opts.z : -558,
      vertical: opts.vertical != null ? !!opts.vertical : true,
      len: opts.len != null ? opts.len : 24,
      district: "highway"
    };
    return pushConnector(roads, seg);
  };

  // ---- HWY-4 driver + HWY-5 arterial: ONE registrar the world tail runs after
  //      every landmass/causeway is built. It lays the causeway connectors and
  //      the long city→desert arterial, then registers both via city.roads so
  //      HWY-3/traffic pick them up. Operates on the LIVE city descriptor passed
  //      in (city.roads) — robust during the build phase where CBZ.city may not
  //      be wired yet. Self-guards if the grid lines aren't present (headless). -
  CBZ.buildArterials = function (city) {
    city = city || CBZ.city;
    const roads = city && city.roads;
    if (!roads) return;
    const root = (city.arena && city.arena.root) || (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || CBZ.scene;

    // HWY-4: the causeway mouths that meet the CITY GRID (coords VERIFIED against
    // config CITY center 0,-700, block 34 + road 16 → step 50, grid lines
    // xLines[-150..150 step 50], zLines[-850..-550 step 50]). Each connector is
    // ONE short segment laid EXACTLY on an existing grid line that OVERLAPS both
    // the grid edge and the causeway's first registered segment, so vehicles.js
    // findRoad (9m snap) can turn a car off the grid onto the causeway.
    //   • airport : causeway x=0 (avenue xLines[3]), z=-566..-280. Grid north
    //     cross-street is z=-550. Connector at x=0 spans z=-546..-570 → bridges
    //     the grid (z≈-550) to the causeway south end (z=-566).
    //   • military: causeway z=-700 (cross-street zLines[3]), x=-380..-133. Grid
    //     west avenue is x=-150. Connector at z=-700 spans x=-129..-153 → bridges
    //     the grid (x≈-150) to the causeway east end (x=-133).
    // (Speedway/other islands reached by their OWN bridges — already internally
    //  connected at their L-corner — are out of this connector's scope.)
    CBZ.buildHighwayConnector({ x: 0, z: -558, vertical: true, len: 24 }, roads);            // airport
    CBZ.buildHighwayConnector({ x: -141, z: -700, vertical: false, len: 24 }, roads);        // military

    // HWY-5: ONE long arterial from the city EAST edge out to the desert basin's
    // west edge, as an L of two axis-aligned legs (so vehicles.js can drive +
    // turn it). East grid edge ≈ x150 on cross-street z=-700; desert center
    // 1050,-20 half-X 380 → west edge ≈670. Build it as a real highway ribbon so
    // it's visibly an arterial (and HWY-3 auto-registers both legs as drivable).
    // The WHY: the desert is currently an island with no road IN — this is the
    // overland route, so traffic actually flows out to the dunes town/outposts.
    if (!city._arterialDesertBuilt && CBZ.buildHighway) {
      city._arterialDesertBuilt = true;
      CBZ.buildHighway(root, {
        path: [{ x: 158, z: -700 }, { x: 670, z: -700 }, { x: 670, z: -20 }],
        width: 18, lanesPerDir: 2, laneW: 3.6, lights: true, guardrail: true,
        theme: "asphalt", registerRoads: true, cityRoads: roads
      });
    }
  };

  // SELF-REGISTER the arterial/connector registrar as a LATE landmass builder so
  // it runs in cityWorldGeo AFTER every island/biome causeway has pushed its own
  // road segments (default order 50 → we use 90). This is the wiring HWY-5 asks
  // for "called from world.js's cityWorldGeo tail" — done without touching
  // world.js: addLandmass IS that tail. Headless-safe (addLandmass is a no-op if
  // worldmap.js didn't load; the build phase just skips us).
  if (CBZ.addLandmass) {
    CBZ.addLandmass(function (city) {
      try { CBZ.buildArterials(city); } catch (e) { /* never break the world build */ }
    }, 90);
  }
})();
