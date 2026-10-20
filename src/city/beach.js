/* ============================================================
   city/beach.js — THE CITY BEACH (remade 2026-10-20).

   The owner called the old one "very shitty", and it was, for reasons a
   photo of any real city beach makes obvious:

   · THE WATERLINE WAS IN THE WRONG PLACE. The sand was dry for 12 m past
     the point where the shore field (the thing swim.js, the sea's land cut,
     boats and sharks all read) said the sea began, so you started wading on
     dry sand. The shoreline was also a ruler: one straight edge for 160 m.
   · THE SAND WAS ONE CREAM SHEET. Vertex colours authored as display hexes
     on a linear pipeline (it renders brighter than it is written), no wet
     sand, no sheen, no swash, no foam, no berm, no dune, no texture.
   · THE PROPS WERE BOXES. Cone umbrellas, a white box "lifeguard chair",
     square palm posts with frond planks, a plank strip boardwalk.

   What a real urban beach is, read off South Beach, Santa Monica, Venice and
   Bondi (references in the commit message):

     road → promenade (here a timber boardwalk) → a planted FOREDUNE behind a
     slatted sand fence, cut by ACCESS PATHS with a shower and bins at each
     → the dry BACKSHORE (soft, pale, churned by feet: towels, umbrellas,
     towers, a volleyball court) → the BERM crest → the FORESHORE, a gentle
     beach face that is permanently damp below the high-water mark, glassy
     where the swash film is on it, foam at the run-up front and a bubble
     line where the last big wave stopped → a WRACK LINE of weed and
     driftwood at the high-tide mark → the white-water band of the surf zone.

   THE SHORELINE IS ONE FUNCTION. CBZ.cityBeachBulge (below) is how far the
   sand pushes past the QUAY line at each x: a crescent between the seawall
   ends with beach cusps on it. city/continent.js folds it into the ONE shore
   field, and this file then finds the real zero crossing of that field per
   column, so the drawn waterline, the wading line, the sea's cut and the
   swash all sit on the same line by construction.

   THE SAND IS ONE MESH, ONE SHADER (MeshStandardMaterial + chunks): albedo
   from the profile (linear colours, decoded), damp below the high-water
   mark, the live swash film (glassy, roughness ~0.06 so the sun and sky
   streak on it), the advancing foam front, the residual bubble line, wind
   ripples and churned footprints as a distance-faded derivative bump, and a
   shallow-water tint below sea level. The run-up comes from
   CBZ.waterSwashPair — the same expression the sea shader's cbzSwash() uses.

   THE SURF is a ribbon on the live water (heights from CBZ.citySeaHeightAt,
   the same swell the sea draws): bores that roll in and spread, a broken
   inner surf zone that brightens as each run-up starts. The baked surf in the
   sea shader is suppressed here (this beach faces the 67 m harbour ring, and
   "surf needs open water"), so this is the only surf the beach would have.

   DRAW CALLS: sand 1 · surf 1 · ALL static structure (boardwalk, plaza,
   dune fence, crossovers, towers, pier, umbrellas, towels, court, showers,
   bins, rocks, wrack) merged into 1 vertex-colour mesh · dune grass 1
   (instanced) · palms 4 (2 variants x trunk/crown, instanced) · loot 5-8 ·
   furniture (furnish pieces, batched by core/batch.js) · the floating dock.

   Walkable: the sand is a CBZ.registerCityGroundHeight provider (the berm,
   the dune and the crossovers are walked on as drawn); boardwalk, plaza,
   pier, tower decks and their ramps are CBZ.platforms; everything solid is a
   CBZ.colliders box. Deterministic: CBZ.seedStream('beach') + CBZ.hash01.

   Publishes:
     CBZ.cityBuildBeach(city)       — world.js calls this once at build
     CBZ.cityBeachBulge(city, x, z) — the shoreline offset (continent.js)
     CBZ.cityBeachBedY(x, z)        — drawn bed under the shallows (swim.js)
     CBZ.cityBeachLoot()/LootReset()— the rifle-able coolers and bags
     CBZ.cityBeachPalms()           — the takeable-palm kit (tsunami.js)
     CBZ.cityBeachSeats()           — usable loungers/chairs/towels count
     CBZ.beachSwimwear(r, skin, h)  — Shark Sim's beach dresser
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  const cmat = CBZ.cmat || CBZ.mat;

  const REACH = 2.2;          // [E] rifle reach
  const RESPAWN = 280;        // s — the beach crowd "comes back" with new valuables

  let rng = null;
  function armRng() { rng = CBZ.seedStream ? CBZ.seedStream('beach') : (function () { let s = 51420; return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })(); }
  armRng();

  function ss(e0, e1, x) { let t = (x - e0) / (e1 - e0); t = t < 0 ? 0 : (t > 1 ? 1 : t); return t * t * (3 - 2 * t); }
  function h01(x, z, s) { return CBZ.hash01 ? CBZ.hash01(x, z, s) : (Math.abs(Math.sin(x * 12.9898 + z * 78.233 + s) * 43758.5453) % 1); }
  // smooth value noise on a `cell` lattice, [0,1)
  function vn(x, z, cell, salt) {
    const gx = x / cell, gz = z / cell, ix = Math.floor(gx), iz = Math.floor(gz);
    let fx = gx - ix, fz = gz - iz; fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
    const a = h01(ix, iz, salt), b = h01(ix + 1, iz, salt), c = h01(ix, iz + 1, salt), d = h01(ix + 1, iz + 1, salt);
    return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fz;
  }
  // display hex -> LINEAR rgb (this pipeline is sRGB out: a hex written
  // straight into a colour renders paler than it reads, the old cream sand)
  function sl(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function lin(hex) { return [sl((hex >> 16) & 255), sl((hex >> 8) & 255), sl(hex & 255)]; }
  function mul(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }
  function mix3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

  /* ---- THE SHORELINE ------------------------------------------------------
     Metres the beach pushes past the QUAY line (continent.js BAY0) at x: a
     6.5 m base so the sand clears the harbour apron's 29 m asphalt edge, a
     crescent that peaks mid-beach (a beach between two hard points is a
     pocket, wider in the middle), beach CUSPS at ~29 m (the scalloped
     waterline every swash beach carries) and a slow wander. Ramps to 0 over
     12 m outside the span, where riprap covers the seawall ends. Smooth at
     the sea mask's 26 m texels within the 1.5 m land-cut margin. */
  const BASE_OUT = 6.5, END_RAMP = 12;
  function bulgeAt(x0, x1, x) {
    if (x <= x0 - END_RAMP || x >= x1 + END_RAMP) return 0;
    if (x < x0) return BASE_OUT * ss(x0 - END_RAMP, x0, x);
    if (x > x1) return BASE_OUT * (1 - ss(x1, x1 + END_RAMP, x));
    const u = (x - x0) / (x1 - x0), env = Math.sin(Math.PI * u);
    return BASE_OUT + 3.6 * Math.pow(env, 0.8)
      + 0.5 * Math.sin(x * (2 * Math.PI / 29) + 0.7) * env
      + 1.1 * Math.sin(x * 0.047 + 1.9) * env * env;
  }
  CBZ.cityBeachBulge = function (city, x, z) {
    const S = city && city.shore;
    if (!S || !S.beach || !(z < city.minZ)) return 0;
    return bulgeAt(S.beach.x0, S.beach.x1, x);
  };

  // ---- module state -------------------------------------------------------
  const loot = [];           // { x, z, body, bag, looted, t }
  const chairs = [];         // { rec, lie } usable furniture (propuse anchors)
  const lifeguardSpots = []; // { seat, post }
  const stallSpots = [];     // vendors: { x, z, face, floorY }
  const anglerSpots = [];    // { x, z, face, y } at each rod on the pier head
  let built = false;
  let palmField = null;
  let sand = null;           // the sand mesh + its swash state
  let surf = null;           // the surf ribbon
  let dock = null;           // the floating dock + its gangway
  let PROF = null;           // the solved profile (provider + bed read it)

  // =========================================================================
  //  THE GEOMETRY ACCUMULATOR — every static piece in one vertex-colour mesh
  // =========================================================================
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(),
    _v = new THREE.Vector3(), _s = new THREE.Vector3(), _n3 = new THREE.Matrix3();
  const geoCache = Object.create(null);
  function unitBox() { return geoCache.box || (geoCache.box = new THREE.BoxGeometry(1, 1, 1)); }
  function cylGeo(rt, rb, seg) {
    const k = "c" + rt + "," + rb + "," + seg;
    return geoCache[k] || (geoCache[k] = new THREE.CylinderGeometry(rt, rb, 1, seg, 1, false));
  }
  /* REPLAY: a baked accumulator (core/bakecache.js hit) keeps every call
     site running (the colliders, seats, platforms and the shared rng stream
     interleaved with the geometry calls stay exactly as they were) but adds
     no vertices: build() wraps the arrays this same code produced last
     visit. */
  function Acc(baked) { this.p = []; this.n = []; this.c = []; this.i = []; this.baked = baked || null; }
  Acc.prototype.geo = function (gm, m4, col) {
    if (this.baked) return;
    const P = gm.attributes.position, N = gm.attributes.normal, base = this.p.length / 3;
    _n3.getNormalMatrix(m4);
    for (let k = 0; k < P.count; k++) {
      _v.set(P.getX(k), P.getY(k), P.getZ(k)).applyMatrix4(m4);
      this.p.push(_v.x, _v.y, _v.z);
      _v.set(N.getX(k), N.getY(k), N.getZ(k)).applyMatrix3(_n3).normalize();
      this.n.push(_v.x, _v.y, _v.z);
      this.c.push(col[0], col[1], col[2]);
    }
    if (gm.index) { const I = gm.index.array; for (let k = 0; k < I.length; k++) this.i.push(base + I[k]); }
    else for (let k = 0; k < P.count; k++) this.i.push(base + k);
  };
  // a box centred at (x,y,z), size (w,h,d), rotated (rx, ry, rz) in YXZ order
  Acc.prototype.box = function (x, y, z, w, h, d, col, ry, rx, rz) {
    if (this.baked) return;
    _e.set(rx || 0, ry || 0, rz || 0, "YXZ"); _q.setFromEuler(_e);
    _m4.compose(_v.set(x, y, z), _q, _s.set(w, h, d));
    this.geo(unitBox(), _m4.clone(), col);
  };
  // a cylinder from base point (x,y,z) running `len` along its axis, tilted
  // by (rx, rz) about its base; axis is +Y before the tilt
  Acc.prototype.cyl = function (x, y, z, rt, rb, len, seg, col, rx, rz, ry) {
    if (this.baked) return;
    _e.set(rx || 0, ry || 0, rz || 0, "YXZ"); _q.setFromEuler(_e);
    const off = new THREE.Vector3(0, len / 2, 0).applyQuaternion(_q);
    _m4.compose(_v.set(x + off.x, y + off.y, z + off.z), _q, _s.set(1, len, 1));
    this.geo(cylGeo(rt, rb, seg), _m4.clone(), col);
  };
  // a cylinder between two points
  Acc.prototype.rod = function (ax, ay, az, bx, by, bz, r, seg, col) {
    if (this.baked) return;
    const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz);
    if (!(L > 1e-4)) return;
    _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / L, dy / L, dz / L));
    _m4.compose(_v.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), _q, _s.set(1, L, 1));
    this.geo(cylGeo(r, r, seg), _m4.clone(), col);
  };
  // a flat quad (a,b,c,d CCW seen from the side its normal faces); twoSided
  // adds the reversed face with `back` colour
  Acc.prototype.quad = function (a, b, c, d, col, twoSided, back) {
    if (this.baked) return;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
    const add = (pts, n, cc) => {
      const base = this.p.length / 3;
      for (const q of pts) { this.p.push(q[0], q[1], q[2]); this.n.push(n[0], n[1], n[2]); this.c.push(cc[0], cc[1], cc[2]); }
      this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    add([a, b, c, d], [nx, ny, nz], col);
    if (twoSided) add([a, d, c, b], [-nx, -ny, -nz], back || col);
  };
  Acc.prototype.tri = function (a, b, c, col, twoSided, back) { this.quad(a, b, c, c, col, twoSided, back); };
  // the arrays build() draws, as typed arrays (what the bake stores)
  Acc.prototype.arrays = function (gm) {
    if (this.baked) return this.baked;
    const a = gm.attributes, s = gm.boundingSphere;
    return { p: a.position.array, n: a.normal.array, c: a.color.array, i: gm.index.array,
      s: new Float32Array([s.center.x, s.center.y, s.center.z, s.radius]) };
  };
  Acc.prototype.build = function (name, mat) {
    const B = this.baked;
    if (!(B ? B.i.length : this.i.length)) return null;
    const gm = new THREE.BufferGeometry();
    if (B) {
      gm.setAttribute("position", new THREE.BufferAttribute(B.p, 3));
      gm.setAttribute("normal", new THREE.BufferAttribute(B.n, 3));
      gm.setAttribute("color", new THREE.BufferAttribute(B.c, 3));
      gm.setIndex(new THREE.BufferAttribute(B.i, 1));
      gm.boundingSphere = new THREE.Sphere(new THREE.Vector3(B.s[0], B.s[1], B.s[2]), B.s[3]);
    } else {
      gm.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
      gm.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
      gm.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
      const nv = this.p.length / 3;
      gm.setIndex(nv > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
      gm.computeBoundingSphere();
    }
    const m = new THREE.Mesh(gm, mat);
    m.name = name;
    m.matrixAutoUpdate = false;
    // non-empty userData: core/batch.js must not swap in a material that
    // ignores vertex colours (the iter-1 "mottle gone" lesson)
    m.userData.beach = name;
    return m;
  };

  // =========================================================================
  //  PALETTE (display hexes; decoded to linear where they become vertex colour)
  // =========================================================================
  const C = {
    sandDry: lin(0xd9c8a2), sandBleach: lin(0xe6d9bb), sandChurn: lin(0xcdb98f), sandShade: lin(0xb7a37f),
    sandWrack: lin(0xb19a73),
    deck: [lin(0x9c7f5c), lin(0x8f7352), lin(0xa58a66), lin(0x86694a)],
    deckDark: lin(0x3a2f24), wood: lin(0x8a7258), woodGrey: lin(0x9a9184), woodDk: lin(0x5a4835),
    white: lin(0xf1efe8), offWhite: lin(0xe3ded2), steel: lin(0xb9bec4), steelDk: lin(0x5d6369),
    concrete: lin(0xb7b2a6), concreteDk: lin(0x8f8a80), glass: lin(0x3c5763), black: lin(0x22252a),
    rope: lin(0x1d4f9c), net: lin(0x1b1d20), rock: [lin(0x7d786f), lin(0x6a665f), lin(0x8b8478), lin(0x5f5b55)],
    drift: lin(0x9a9082),
    wrack: [lin(0x3f4424), lin(0x56482a), lin(0x8a6c33), lin(0x2c2c1e), lin(0x6b5a35)],
    binGreen: lin(0x2f5a46), binLid: lin(0x22352c),
  };
  // the South Beach tower palettes (William Lane's six: body / trim / roof)
  const TOWER_PALETTES = [
    { body: lin(0xf2a7c3), trim: lin(0x4fb37a), roof: lin(0xf28c3a) },   // pink, green, orange
    { body: lin(0x3fb7b2), trim: lin(0x2a4fb0), roof: lin(0xb6dc4a) },   // teal, royal blue, lime
    { body: lin(0x6a3f8f), trim: lin(0xc9b6e6), roof: lin(0xf6b48a) },   // purple, lavender, peach
  ];
  const UMB = [0xd8372f, 0xf2b631, 0x2563b8, 0x1f9a8a, 0xf07a2a, 0x2c2f6b, 0x7bbf3a, 0xe85a8a];
  const TOWEL = [0xe88a3c, 0x2f6fc8, 0xd8372f, 0xf2eee0, 0x3aa86a, 0x8a4ae2, 0xf2c94a, 0x1fa7a8, 0xe85a8a];

  // =========================================================================
  //  THE BUILD
  // =========================================================================
  CBZ.cityBuildBeach = function (city) {
    if (built || !city || !city.shore || !city.shore.beach) return;
    built = true;
    armRng();
    const root = city.root;
    const S = city.shore, B = S.beach;
    const cx = city.center.x, cz = city.center.z;
    const minX = city.minX, minZ = city.minZ;
    const ES = S.ES;
    const X0 = B.x0, X1 = B.x1, BW = X1 - X0;
    const AX0 = X0 - END_RAMP, AX1 = X1 + END_RAMP;
    const SEA = CBZ.SEA_Y != null ? CBZ.SEA_Y : -0.48;
    const pierX = X1 - 26;
    const WALL_D = (minZ - ES) + 0.75;           // seaward face of the seawall, in d
    const APRON_D = 29.25;                        // streetkit's harbour apron edge (+ a hair)
    const zOf = (d) => minZ - d;                  // d = metres seaward of the last road edge
    const dOf = (z) => minZ - z;

    // ---- 0) THE WATERLINE, read off the real shore field -----------------
    // Bisection on the same signed field the sea, swim.js and the boats use
    // (continent.js shoreField, bulge folded in). Fallback: QUAY + bulge.
    const shoreAt = city.mapTerrain && typeof city.mapTerrain.shoreAt === "function" ? city.mapTerrain.shoreAt : null;
    const WSTEP = 2;
    const WN = Math.ceil((AX1 - AX0) / WSTEP) + 1;
    const Wtab = new Float32Array(WN);
    /* BAKED ONCE PER VERSION (core/bakecache.js). The remade beach cost ~41 ms
       at boot against the old one's ~8: ~1.9k raw shore-field samples for
       this waterline (each walks every river and lake), ~46k profile
       evaluations for the sand grid and its analytic normals, and ~55k
       vertices pushed one by one into the structure mesh. All three are a
       pure function of the shore (the continent plate's signature names its
       every input), this span, the seed and the code (?v= of beach.js is in
       bakeSig), so a later visit takes last visit's arrays. Everything with a
       side effect (colliders, seats, platforms, the rng stream) still runs. */
    const BSIG = (CBZ.bakeSig && CBZ.bakeGet && CBZ._plateSig && shoreAt)
      ? CBZ.bakeSig("beach|" + CBZ._plateSig + "|" + CBZ.bakeHash({ AX0: AX0, AX1: AX1, X0: X0, X1: X1, minX: minX, minZ: minZ, ES: ES, cx: cx, cz: cz, SEA: SEA, WSTEP: WSTEP, WN: WN, B: B }))
      : null;
    let BAKE = null;
    try { BAKE = BSIG ? CBZ.bakeGet("city-beach", BSIG) : null; } catch (e) { BAKE = null; }
    if (BAKE && !(BAKE.w && BAKE.w.length === WN && BAKE.pos && BAKE.col && BAKE.sh && BAKE.nrm && BAKE.idx &&
        BAKE.sp && BAKE.sn && BAKE.sc && BAKE.si && BAKE.ss && BAKE.ss.length === 4 && BAKE.sp.length === BAKE.sn.length && BAKE.sp.length === BAKE.sc.length &&
        BAKE.gm && BAKE.gc && BAKE.gm.length / 16 === BAKE.gc.length / 3)) BAKE = null;
    const bakeOut = {};
    if (BAKE) Wtab.set(BAKE.w);
    else for (let i = 0; i < WN; i++) {
      const x = AX0 + i * WSTEP;
      let w = 28 + bulgeAt(X0, X1, x);
      if (shoreAt) {
        let lo = 20, hi = 60;                     // s(lo) > 0 (land), s(hi) < 0 (water)
        let sLo = +shoreAt(x, zOf(lo)), sHi = +shoreAt(x, zOf(hi));
        if (sLo > 0 && sHi < 0) {
          for (let k = 0; k < 18; k++) {
            const mid = (lo + hi) / 2, sm = +shoreAt(x, zOf(mid));
            if (sm > 0) lo = mid; else hi = mid;
          }
          w = (lo + hi) / 2;
        }
      }
      Wtab[i] = w;
    }
    function W(x) {
      const f = (x - AX0) / WSTEP;
      if (f <= 0) return Wtab[0];
      if (f >= WN - 1) return Wtab[WN - 1];
      const i = Math.floor(f), t = f - i;
      return Wtab[i] + (Wtab[i + 1] - Wtab[i]) * t;
    }
    // where the sand starts: the road edge inside the span, the seawall face
    // in the ramp zones either side, nothing beyond them
    function dStart(x) {
      if (x >= X0 && x <= X1) return 0.3;
      if (x >= AX0 && x <= AX1) return WALL_D;
      return Infinity;
    }

    // ---- the plan (alongshore, metres from X0) ----------------------------
    const GAPS = [X0 + 20, X0 + 56, X0 + 108];                  // dune access paths
    const PIER_GAP = pierX;
    const allGaps = GAPS.concat([PIER_GAP]);
    const PLAZA = { x0: X0 + 66, x1: X0 + 94, d0: 6.0, d1: 10.4 };
    const BWK = { x0: X0 + 0.45, x1: X1 - 0.45, d0: 1.2, d1: 6.0, top: 0.30 };
    const GAP_HW = 1.6;                                          // half width of a dune cut
    const CROSS_HW = 0.9;                                        // half width of a crossover walk

    function duneMask(x) {
      let m = ss(0, 7, x - X0) * ss(0, 7, X1 - x);
      for (const gx of allGaps) m *= ss(GAP_HW, GAP_HW + 2.2, Math.abs(x - gx));
      if (x > PLAZA.x0 - 3.5 && x < PLAZA.x1 + 3.5) m *= 1 - ss(PLAZA.x0 - 3.5, PLAZA.x0 - 0.5, x) * (1 - ss(PLAZA.x1 + 0.5, PLAZA.x1 + 3.5, x));
      return m;
    }
    function duneH(x) { return (0.5 + 0.5 * vn(x, 7.3, 13, 0xd0e)) * duneMask(x); }
    function rampStart(x) {
      const inPlaza = ss(PLAZA.x0 - 3, PLAZA.x0, x) * (1 - ss(PLAZA.x1, PLAZA.x1 + 3, x));
      return 5.0 + (PLAZA.d1 + 0.2 - 5.0) * inPlaza;
    }
    const Y_BACK = 0.50;
    // the profile: y at (x, d). Pure, no allocation — the ground provider runs it.
    function sandYd(x, d) {
      const w = W(x), dl = w - d;
      const s0 = rampStart(x);
      const yBW = 0.11 + 0.006 * d;
      let y = yBW + (Y_BACK - yBW) * ss(s0, s0 + 4.0, d);
      // backshore hummocks: soft sand never lies flat
      y += 0.045 * (vn(x, d, 6.5, 0x51a) - 0.5) * ss(s0 + 2.5, s0 + 6, d) * ss(4, 9, dl);
      // the foredune
      const h = duneH(x);
      if (h > 0.001) {
        const sh = ss(5.5, 8.3, d) * (1 - ss(9.0, 12.7, d));
        y += h * sh * (0.62 + 0.10 * (vn(x * 1.7, d, 3.2, 0xd1e) - 0.5));
      }
      // berm lip + beach face + the shallows
      const lip = 0.05 * Math.exp(-((dl - 9.4) * (dl - 9.4)) / 1.4);
      // The face is a gentle 1:15 down to mean-tide grade (y 0) 1.6 m above
      // the waterline, then the BEACH STEP: a 1:3 drop to the water, the
      // way a swash beach ends. The step is also what keeps the walkable
      // floor (every ground provider is clamped at 0) on the drawn sand to
      // within a stride of the water instead of floating over the last 4 m.
      let yF;
      if (dl >= 1.6) yF = (Y_BACK - 0.02) * Math.pow(Math.min(1, (dl - 1.6) / 7.4), 0.9);
      else if (dl >= 0) yF = SEA - SEA * (dl / 1.6);
      else yF = Math.max(-2.6, SEA + 0.13 * dl - 0.0025 * dl * dl);
      const k = ss(8.2, 10.6, dl);
      y = yF + (y + lip - yF) * k;
      if (d < APRON_D && y < 0.035) y = 0.035;   // never let the harbour apron's asphalt show through
      return y;
    }
    // the crossovers ride 5 cm proud of the sand they lie on
    function crossBump(x, d) {
      if (d < BWK.d1 - 0.05 || d > 13.9) return 0;
      for (const gx of GAPS) if (Math.abs(x - gx) <= CROSS_HW) return 0.05;
      return 0;
    }

    PROF = {
      AX0, AX1, minZ, W, dStart, sandYd, crossBump,
      ground(x, z) {
        if (x < AX0 || x > AX1) return 0;
        const d = minZ - z, ds = dStart(x);
        if (!(d >= ds)) return 0;
        const w = W(x);
        if (d > w + 0.5) return 0;                // the sea owns it from here
        const y = sandYd(x, d) + crossBump(x, d);
        return y > 0 ? y : 0;
      },
      bed(x, z) {
        if (x < AX0 || x > AX1) return null;
        const d = minZ - z;
        if (!(d >= dStart(x))) return null;
        const w = W(x);
        if (d < w - 1 || d > w + 13) return null;
        return sandYd(x, d);
      },
    };
    if (CBZ.registerCityGroundHeight) CBZ.registerCityGroundHeight(function (x, z) { return PROF.ground(x, z); }, { name: "city-beach" });

    const solid = function (x0, x1, z0, z1, ref, y0, y1, extra) {
      // noBreach: these are props on a beach, not building walls — the
      // carve law (buildings.js carveHole) must never pick one to hide
      const c = { minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1), ref, noCam: true, noBreach: true };
      if (y0 != null) c.y0 = y0;
      if (y1 != null) c.y1 = y1;
      if (extra) Object.assign(c, extra);
      CBZ.colliders.push(c);
      return c;
    };
    const platform = function (x0, x1, z0, z1, top) {
      CBZ.platforms.push({ minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1), top });
    };

    const A = new Acc(BAKE ? { p: BAKE.sp, n: BAKE.sn, c: BAKE.sc, i: BAKE.si, s: BAKE.ss } : null);   // the one static structure mesh
    const structMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    structMat.name = "beach-structures";
    let structMesh = null;                        // assigned at the end; colliders ref a proxy until then
    const REF = new THREE.Object3D();             // stable collider ref for the merged statics
    REF.name = "beach-structure-ref"; REF.userData.beach = "ref";
    root.add(REF);

    // =====================================================================
    //  1) THE SAND — one grid, columns along the shore, rows from the road
    //  to 14 m under the water, densest through the swash zone.
    // =====================================================================
    (function buildSand() {
      const xs = [];
      for (let x = AX0; x <= AX1 + 1e-6; x += 1.25) xs.push(x);
      xs.push(X0 - 0.03, X0, X1, X1 + 0.03, AX1);
      for (const gx of allGaps) xs.push(gx - GAP_HW, gx + GAP_HW);
      xs.sort(function (a, b) { return a - b; });
      const XS = [];
      for (const x of xs) if (!XS.length || x - XS[XS.length - 1] > 0.02) XS.push(x);
      const NC = XS.length;
      const LAND = [0.3, 0.9, 1.5, 2.5, 3.5, 4.5, 5.2, 5.8, 6.4, 7.0, 7.6, 8.2, 8.8, 9.4, 10.0, 10.6, 11.2, 11.8, 12.4, 13.0, 13.8, 14.6];
      const MID = 6;
      const SEAW = [10.5, 9.5, 8.75];
      for (let dl = 8.0; dl >= -2.001; dl -= 0.5) SEAW.push(+dl.toFixed(2));
      SEAW.push(-3.0, -4.5, -6.5, -9.0, -11.5, -14.0);
      const NR = LAND.length + MID + SEAW.length;
      const bandR0 = LAND.length + MID + 3, bandR1 = LAND.length + MID + 3 + 21;   // the swash rows [dl 8 .. -2]
      const n = NC * NR;
      const hit = !!(BAKE && BAKE.pos.length === n * 3 && BAKE.col.length === n * 3 && BAKE.sh.length === n && BAKE.nrm.length === n * 3 &&
        BAKE.idx.length === (NC - 1) * (NR - 1) * 6);
      const pos = hit ? BAKE.pos : new Float32Array(n * 3), col = hit ? BAKE.col : new Float32Array(n * 3);
      const aShore = hit ? BAKE.sh : new Float32Array(n), aSw = new Float32Array(n * 4);
      if (hit) for (let k = 0; k < n; k++) {
        const dl = aShore[k];
        aSw[k * 4] = dl > 9 ? -9 : 0; aSw[k * 4 + 2] = dl > 9 ? -9 : 0; aSw[k * 4 + 3] = -9;
      }
      if (!hit) for (let j = 0; j < NR; j++) {
        for (let i = 0; i < NC; i++) {
          const x = XS[i], w = W(x), ds = dStart(x);
          let d;
          if (j < LAND.length) d = LAND[j];
          else if (j < LAND.length + MID) { const t = (j - LAND.length + 1) / (MID + 1); d = 14.6 + (w - 10.5 - 14.6) * t; }
          else d = w - SEAW[j - LAND.length - MID];
          if (d < ds) d = ds;
          const k = j * NC + i;
          // monotone seaward within the column (a clamped row may not overtake)
          if (j > 0) { const prev = minZ - pos[((j - 1) * NC + i) * 3 + 2]; if (d < prev) d = prev; }
          const z = zOf(d), y = sandYd(x, d);
          pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
          const dl = w - d;
          aShore[k] = dl;
          // static swash state: dry inland of the band, flooded seaward of it
          aSw[k * 4] = dl > 9 ? -9 : 0; aSw[k * 4 + 2] = dl > 9 ? -9 : 0; aSw[k * 4 + 3] = -9;
          // ---- albedo (linear), the broad zones a texture would carry ----
          const grain = 1 + (vn(x, d, 0.9, 0x6a1) - 0.5) * 0.07 + (vn(x, d, 7.0, 0x6a2) - 0.5) * 0.08;
          let c = C.sandDry;
          const dh = duneH(x) * ss(5.5, 8.3, d) * (1 - ss(9.0, 12.7, d));
          c = mix3(c, C.sandBleach, Math.min(1, dh * 1.4));                        // wind-bleached dune crest
          c = mix3(c, C.sandChurn, 0.55 * ss(rampStart(x) + 3, rampStart(x) + 6, d) * ss(7, 11, dl) * (1 - dh)); // trampled backshore
          if (d < BWK.d1 + 0.5 && x > BWK.x0 && x < BWK.x1) c = mix3(c, C.sandShade, 0.6);  // under the boardwalk
          const wr = Math.exp(-Math.pow((dl - (6.9 + 0.8 * (vn(x, 0, 23, 0x7a3) - 0.5))) / 0.55, 2));
          c = mix3(c, C.sandWrack, 0.65 * wr);                                       // the strandline stain
          col[k * 3] = c[0] * grain; col[k * 3 + 1] = c[1] * grain; col[k * 3 + 2] = c[2] * grain;
        }
      }
      const idx = hit ? BAKE.idx : new Uint32Array((NC - 1) * (NR - 1) * 6);
      let w = 0;
      // rows run seaward (z decreases with j): (a,b,c)/(b,d,c) faces +Y
      if (!hit) for (let j = 0; j < NR - 1; j++) for (let i = 0; i < NC - 1; i++) {
        const a = j * NC + i, b = a + 1, c = a + NC, d = c + 1;
        idx[w++] = a; idx[w++] = b; idx[w++] = c;
        idx[w++] = b; idx[w++] = d; idx[w++] = c;
      }
      const gm = new THREE.BufferGeometry();
      gm.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      gm.setAttribute("color", new THREE.BufferAttribute(col, 3));
      gm.setAttribute("aShore", new THREE.BufferAttribute(aShore, 1));
      const swA = new THREE.BufferAttribute(aSw, 4);
      swA.setUsage(THREE.DynamicDrawUsage);
      gm.setAttribute("aSw", swA);
      gm.setIndex(new THREE.BufferAttribute(idx, 1));
      // ANALYTIC normals off the profile itself: computeVertexNormals would
      // average in the zero-area rows the seawall clamp collapses and the
      // 3 cm sliver at each span end, and print a dark seam down x = X0/X1
      const nrm = hit ? BAKE.nrm : new Float32Array(n * 3), E = 0.3;
      if (!hit) for (let k = 0; k < n; k++) {
        const x = pos[k * 3], d = minZ - pos[k * 3 + 2];
        const gx = (sandYd(x + E, d) - sandYd(x - E, d)) / (2 * E);
        const gd = (sandYd(x, d + E) - sandYd(x, d - E)) / (2 * E);   // dy/dd; d runs along -z
        const nx = -gx, ny = 1, nz = gd, L = Math.hypot(nx, ny, nz);
        nrm[k * 3] = nx / L; nrm[k * 3 + 1] = ny / L; nrm[k * 3 + 2] = nz / L;
      }
      gm.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
      gm.computeBoundingSphere();
      bakeOut.pos = pos; bakeOut.col = col; bakeOut.sh = aShore; bakeOut.nrm = nrm; bakeOut.idx = idx;

      const mat = sandMaterial();
      const m = new THREE.Mesh(gm, mat);
      m.name = "beach-dry-sand";
      m.receiveShadow = true; m.castShadow = false; m.matrixAutoUpdate = false;
      // batch.js hands off (vertex colours + custom attributes); `dynamic`
      // keeps farcull off a mesh whose buffer is rewritten every frame;
      // beachSwash keeps the beach-shores preset's census meaningful
      m.userData.beachSand = true; m.userData.beachSwash = true; m.userData.dynamic = true;
      root.add(m);

      // per-column swash state
      const colX = new Float32Array(NC), colZW = new Float32Array(NC);
      for (let i = 0; i < NC; i++) { colX[i] = XS[i]; colZW[i] = zOf(W(XS[i])); }
      sand = {
        mesh: m, mat, attr: swA, arr: aSw, nc: NC, r0: bandR0, r1: Math.min(NR - 1, bandR1),
        colX, colZW, wl: new Float32Array(NC), fl: new Float32Array(NC),
        live: typeof CBZ.waterSwashPair === "function" && (CBZ.CONFIG || {}).WATER_SWASH !== false && (CBZ.CONFIG || {}).WATER_V2 !== false,
        cx: (AX0 + AX1) / 2, cz: zOf(20), pair: { s: 0, v: 0 },
      };
    })();

    // =====================================================================
    //  1b) THE SURF — white water on the live sea surface
    // =====================================================================
    (function buildSurf() {
      const XS = [];
      for (let x = AX0 + 3; x <= AX1 - 3 + 1e-6; x += 2.5) XS.push(x);
      const NC = XS.length;
      const DL = [1.2, 0.2, -1.2, -3.0, -5.5, -8.5, -12.0, -16.5];
      const NR = DL.length, n = NC * NR;
      const pos = new Float32Array(n * 3), aOff = new Float32Array(n), aRun = new Float32Array(n * 2);
      for (let j = 0; j < NR; j++) for (let i = 0; i < NC; i++) {
        const k = j * NC + i, x = XS[i], d = W(x) - DL[j];
        pos[k * 3] = x; pos[k * 3 + 1] = SEA + 0.03; pos[k * 3 + 2] = zOf(d);
        aOff[k] = -DL[j];
      }
      const idx = new Uint16Array((NC - 1) * (NR - 1) * 6);
      let w = 0;
      for (let j = 0; j < NR - 1; j++) for (let i = 0; i < NC - 1; i++) {
        const a = j * NC + i, b = a + 1, c = a + NC, d = c + 1;
        idx[w++] = a; idx[w++] = b; idx[w++] = c; idx[w++] = b; idx[w++] = d; idx[w++] = c;
      }
      const gm = new THREE.BufferGeometry();
      const pA = new THREE.BufferAttribute(pos, 3); pA.setUsage(THREE.DynamicDrawUsage);
      const rA = new THREE.BufferAttribute(aRun, 2); rA.setUsage(THREE.DynamicDrawUsage);
      gm.setAttribute("position", pA);
      gm.setAttribute("aOff", new THREE.BufferAttribute(aOff, 1));
      gm.setAttribute("aRun", rA);
      const nrm = new Float32Array(n * 3); for (let k = 0; k < n; k++) nrm[k * 3 + 1] = 1;
      gm.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
      gm.setIndex(new THREE.BufferAttribute(idx, 1));
      gm.computeBoundingSphere();
      gm.boundingSphere.radius += 4;              // it heaves with the swell
      const mat = surfMaterial();
      const m = new THREE.Mesh(gm, mat);
      m.name = "beach-surf";                     // (no "water"/"sea" in the name: the
      m.renderOrder = 3;                         //  terrain-water test counts ONE sea mesh)
      m.castShadow = false; m.receiveShadow = false; m.frustumCulled = true;
      m.userData.beachSurf = true; m.userData.dynamic = true;
      root.add(m);
      // the heights are sampled at three rows per column and interpolated
      const SAMPLE = [1, 4, 7];
      surf = { mesh: m, pos: pA, run: rA, nc: NC, nr: NR, dl: DL, xs: XS, sample: SAMPLE,
        zs: XS.map(function (x) { return DL.map(function (dl) { return zOf(W(x) - dl); }); }),
        hs: new Float32Array(NC * 3) };
    })();

    // =====================================================================
    //  2) THE BOARDWALK + THE PLAZA — timber decks at 0.30
    // =====================================================================
    function deckPlanks(xa, xb, da, db, top) {
      // boards run ACROSS (along d), 14 cm wide with a 1.2 cm gap, each its own tone
      const PW = 0.14, GAP = 0.012;
      for (let x = xa; x + PW <= xb + 1e-6; x += PW + GAP) {
        const t = C.deck[(h01(x * 7.1, da, 0xb0a) * C.deck.length) | 0];
        const k = 0.93 + h01(x * 3.3, db, 0xb0b) * 0.12;
        const c = mul(t, k), za = zOf(da), zb = zOf(db);
        A.quad([x, top, za], [x + PW, top, za], [x + PW, top, zb], [x, top, zb], c);
      }
      // the dark under-deck that shows through the gaps
      A.quad([xa, top - 0.06, zOf(da)], [xb, top - 0.06, zOf(da)], [xb, top - 0.06, zOf(db)], [xa, top - 0.06, zOf(db)], C.deckDark);
    }
    function fascia(xa, xb, d, top, depth) {
      A.box((xa + xb) / 2, top - depth / 2, zOf(d), xb - xa, depth, 0.05, C.woodDk);
    }
    (function boardwalk() {
      const T = BWK.top;
      deckPlanks(BWK.x0, BWK.x1, BWK.d0, BWK.d1, T);
      fascia(BWK.x0, BWK.x1, BWK.d0, T, 0.24);
      // the seaward fascia only where the plaza does not continue the deck
      fascia(BWK.x0, PLAZA.x0, BWK.d1, T, 0.24); fascia(PLAZA.x1, BWK.x1, BWK.d1, T, 0.24);
      platform(BWK.x0, BWK.x1, zOf(BWK.d0), zOf(BWK.d1), T);
      // ---- the plaza: the deck widens for the concession and its stalls
      deckPlanks(PLAZA.x0, PLAZA.x1, PLAZA.d0, PLAZA.d1, T);
      fascia(PLAZA.x0, PLAZA.x1, PLAZA.d1, T, 0.28);
      A.box(PLAZA.x0, T - 0.14, zOf((PLAZA.d0 + PLAZA.d1) / 2), 0.05, 0.28, PLAZA.d1 - PLAZA.d0, C.woodDk);
      A.box(PLAZA.x1, T - 0.14, zOf((PLAZA.d0 + PLAZA.d1) / 2), 0.05, 0.28, PLAZA.d1 - PLAZA.d0, C.woodDk);
      platform(PLAZA.x0, PLAZA.x1, zOf(PLAZA.d0), zOf(PLAZA.d1), T);
      // a broad timber step down off the plaza's seaward edge onto the sand
      const xm = (PLAZA.x0 + PLAZA.x1) / 2;
      A.box(xm, 0.17, zOf(PLAZA.d1 + 0.4), 8, 0.12, 0.8, C.deck[2]);
      // ---- the seaward rail, open at every access path and at the plaza
      const openings = GAPS.map(function (gx) { return [gx - 1.6, gx + 1.6]; })
        .concat([[PIER_GAP - 1.6, PIER_GAP + 1.6], [PLAZA.x0 - 0.05, PLAZA.x1 + 0.05]]);
      const isOpen = function (x) { for (const o of openings) if (x > o[0] && x < o[1]) return true; return false; };
      const runs = [];
      let r0 = null;
      for (let x = BWK.x0 + 0.1; x <= BWK.x1 - 0.1; x += 0.1) {
        if (!isOpen(x)) { if (r0 == null) r0 = x; }
        else if (r0 != null) { runs.push([r0, x - 0.1]); r0 = null; }
      }
      if (r0 != null) runs.push([r0, BWK.x1 - 0.1]);
      const rd = BWK.d1 - 0.08, rz = zOf(rd);
      for (const run of runs) {
        const L = run[1] - run[0];
        if (L < 0.8) continue;
        const np = Math.max(1, Math.round(L / 2.4));
        for (let k = 0; k <= np; k++) A.box(run[0] + L * k / np, T + 0.5, rz, 0.1, 1.0, 0.1, C.wood);
        A.box((run[0] + run[1]) / 2, T + 1.0, rz, L + 0.1, 0.06, 0.14, C.wood);      // cap rail
        A.box((run[0] + run[1]) / 2, T + 0.55, rz, L, 0.09, 0.04, C.wood);           // mid rail
        solid(run[0] - 0.05, run[1] + 0.05, rz - 0.1, rz + 0.1, REF, T, T + 1.05);
      }
      // ---- benches on the landward edge, facing the water (real seats)
      for (const bx of [X0 + 12, X0 + 40, X0 + 100, X0 + 128, X0 + 150]) {
        const bz = zOf(1.75);
        bench(bx, T, bz, Math.PI, 1.8);
      }
      // ---- the kerb between the road and the sand (hides the sheet's edge)
      A.box((X0 + X1) / 2, 0.08, zOf(0.15), BW, 0.22, 0.3, C.concrete);
      // ---- the low returns where the sand meets the quay at each span end
      for (const ex of [X0 - 0.2, X1 + 0.2]) {
        A.box(ex, 0.26, zOf(WALL_D / 2), 0.4, 0.72, WALL_D, C.concreteDk);
        solid(ex - 0.2, ex + 0.2, zOf(0), zOf(WALL_D), REF, null, 0.62);
      }
    })();

    // a slatted bench seen from the boardwalk: two seats registered with propuse
    function bench(x, y, z, face, len) {
      const fwd = [Math.sin(face), Math.cos(face)];
      // the bench runs along x (face is +/- z)
      for (const s of [-1, 1]) {
        A.box(x + s * (len / 2 - 0.15), y + 0.22, z, 0.06, 0.44, 0.42, C.steelDk);
        A.box(x + s * (len / 2 - 0.15), y + 0.62, z - fwd[1] * 0.2, 0.06, 0.4, 0.05, C.steelDk);
      }
      for (let k = 0; k < 3; k++) A.box(x, y + 0.45, z + fwd[1] * (0.12 - k * 0.12), len, 0.035, 0.09, C.wood);
      for (let k = 0; k < 2; k++) A.box(x, y + 0.6 + k * 0.14, z - fwd[1] * 0.22, len, 0.09, 0.03, C.wood);
      solid(x - len / 2, x + len / 2, z - 0.25, z + 0.25, REF, y, y + 0.48);
      if (CBZ.propRegisterSeat) for (const s of [-1, 1]) {
        CBZ.propRegisterSeat(x + s * len * 0.25, y, z + fwd[1] * 0.02, face, "bench", null, { cushion: 0.47, floorBelow: 0 });
      }
    }

    // =====================================================================
    //  3) THE DUNE: grass, sea oats, the sand fence, the crossovers
    // =====================================================================
    (function dune() {
      // ---- crossovers: a 1.8 m timber walk down each cut, boardwalk → backshore
      // (geometry only: nothing to do when the structure mesh is baked)
      if (!A.baked) for (const gx of GAPS) {
        const da = BWK.d1, db = 13.9;
        for (let d = da; d < db - 0.01; d += 0.16) {
          const d2 = Math.min(db, d + 0.14);
          const ya = sandYd(gx, d) + 0.05, yb = sandYd(gx, d2) + 0.05;
          const tone = mul(C.deck[(h01(gx, d * 9, 0xc70) * 4) | 0], 0.95);
          A.quad([gx - CROSS_HW, ya, zOf(d)], [gx + CROSS_HW, ya, zOf(d)], [gx + CROSS_HW, yb, zOf(d2)], [gx - CROSS_HW, yb, zOf(d2)], tone);
        }
        for (const s of [-1, 1]) {                 // edge boards
          for (let d = da; d < db - 0.01; d += 1.0) {
            const d2 = Math.min(db, d + 1.0), y = (sandYd(gx, d) + sandYd(gx, d2)) / 2;
            A.box(gx + s * (CROSS_HW + 0.03), y + 0.03, zOf((d + d2) / 2), 0.06, 0.1, d2 - d, C.woodDk);
          }
        }
      }
      // ---- the sand fence: posts + slats along the dune's seaward toe
      const FD = 12.3;
      const fenceRuns = [];
      let f0 = null;
      for (let x = X0 + 3; x <= X1 - 3; x += 0.25) {
        const blocked = allGaps.some(function (gx) { return Math.abs(x - gx) < GAP_HW + 0.4; }) ||
          (x > PLAZA.x0 - 1.5 && x < PLAZA.x1 + 1.5);
        if (!blocked) { if (f0 == null) f0 = x; }
        else if (f0 != null) { fenceRuns.push([f0, x - 0.25]); f0 = null; }
      }
      if (f0 != null) fenceRuns.push([f0, X1 - 3]);
      const fz = zOf(FD);
      for (const run of fenceRuns) {
        const L = run[1] - run[0];
        if (L < 2) continue;
        const np = Math.max(1, Math.round(L / 2.5));
        if (!A.baked) for (let k = 0; k <= np; k++) {
          const px = run[0] + L * k / np, py = sandYd(px, FD);
          A.box(px, py + 0.45, fz, 0.08, 1.2, 0.08, C.woodGrey);
        }
        // slats: 4 cm wide, 11 cm apart, a few leaning or sand-buried
        if (!A.baked) for (let x = run[0] + 0.06; x < run[1] - 0.04; x += 0.11) {
          const y0 = sandYd(x, FD) - 0.08;
          const hgt = 0.86 + (h01(x * 13, 1, 0xfe1) - 0.5) * 0.12;
          const lean = (h01(x * 13, 2, 0xfe2) - 0.5) * 0.06;
          const c = mul(C.woodGrey, 0.85 + h01(x * 13, 3, 0xfe3) * 0.25);
          const a = [x - 0.02, y0, fz], b = [x + 0.02, y0, fz], cc = [x + 0.02 + lean, y0 + hgt, fz], dd = [x - 0.02 + lean, y0 + hgt, fz];
          A.quad(a, b, cc, dd, c, true, mul(c, 0.8));
        }
        for (const wy of [0.22, 0.7]) {          // the twisted wires
          const y = sandYd((run[0] + run[1]) / 2, FD) + wy;
          A.box((run[0] + run[1]) / 2, y, fz, L, 0.012, 0.012, C.steelDk);
        }
        solid(run[0], run[1], fz - 0.08, fz + 0.08, REF, null, sandYd(run[0], FD) + 0.95);
      }

      // ---- dune grass + sea oats: ONE instanced tuft, scattered by hash
      const tuftGeo = (function () {
        const P = [], Cc = [];
        const tri = function (a, b, c, ca, cb) { P.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); Cc.push(ca[0], ca[1], ca[2], ca[0], ca[1], ca[2], cb[0], cb[1], cb[2]); };
        const base = lin(0x5b6a35), tip = lin(0xb9b277), oat = lin(0xc8b07a);
        for (let k = 0; k < 9; k++) {           // the blades: thin, arching out of a clump
          const a = k / 9 * Math.PI * 2 + h01(k, 1, 0x7f1) * 0.6;
          const r = 0.02 + h01(k, 2, 0x7f2) * 0.06, hgt = 0.35 + h01(k, 3, 0x7f3) * 0.4, lean = 0.12 + h01(k, 4, 0x7f4) * 0.22;
          const ca = Math.cos(a), sa = Math.sin(a), px = -sa * 0.025, pz = ca * 0.025;
          tri([ca * r - px, 0, sa * r - pz], [ca * r + px, 0, sa * r + pz], [ca * (r + lean), hgt, sa * (r + lean)], base, tip);
        }
        for (let k = 0; k < 2; k++) {            // two sea-oat stems with their seed panicles
          const a = k * 2.6 + 0.8, ca = Math.cos(a), sa = Math.sin(a), hgt = 1.05 + k * 0.2;
          tri([-0.008, 0, 0], [0.008, 0, 0], [ca * 0.08, hgt, sa * 0.08], base, tip);
          for (let s = 0; s < 4; s++) {
            const y = hgt - 0.05 - s * 0.07, ox = ca * 0.08 + Math.cos(a + s) * 0.035, oz = sa * 0.08 + Math.sin(a + s) * 0.035;
            tri([ca * 0.08, y + 0.03, sa * 0.08], [ox + 0.025, y - 0.04, oz], [ox - 0.025, y - 0.06, oz], oat, oat);
          }
        }
        const gm = new THREE.BufferGeometry();
        gm.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
        gm.setAttribute("color", new THREE.Float32BufferAttribute(Cc, 3));
        // up-biased normals: blades light as a canopy, not as flipped cards
        const N = []; for (let k = 0; k < P.length; k += 3) { const l = Math.hypot(P[k], 0.6, P[k + 2]) || 1; N.push(P[k] / l * 0.5, 0.85, P[k + 2] / l * 0.5); }
        gm.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
        gm.computeBoundingSphere();
        return gm;
      })();
      const spots = [];
      const gHit = !!(BAKE && BAKE.gm.length);
      if (!gHit) for (let x = X0 + 2; x < X1 - 2; x += 0.55) {
        for (let d = 5.6; d < 13.6; d += 0.55) {
          const jx = x + (h01(x, d, 0xa11) - 0.5) * 0.5, jd = d + (h01(x, d, 0xa12) - 0.5) * 0.5;
          const cover = duneH(jx) * ss(5.6, 7.4, jd) * (1 - ss(10.5, 13.0, jd));
          const p = cover * 1.35 - 0.12 + (vn(jx, jd, 4, 0xa13) - 0.5) * 0.6;
          if (h01(jx, jd, 0xa14) > p) continue;
          if (jd < BWK.d1 + 0.3) continue;
          spots.push([jx, jd]);
        }
      }
      const nG = gHit ? BAKE.gm.length / 16 : spots.length;
      if (!gHit) { bakeOut.gm = new Float32Array(0); bakeOut.gc = new Float32Array(0); }
      if (nG) {
        const gMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide });
        gMat.name = "beach-dune-grass";
        const im = new THREE.InstancedMesh(tuftGeo, gMat, nG);
        const dm = new THREE.Object3D(), tint = new THREE.Color();
        if (gHit) {
          im.instanceMatrix.array.set(BAKE.gm);
          if (im.setColorAt) { im.setColorAt(0, tint.setRGB(1, 1, 1)); im.instanceColor.array.set(BAKE.gc); }
        }
        if (!gHit) spots.forEach(function (s, i) {
          const y = sandYd(s[0], s[1]) - 0.03, k = 0.7 + h01(s[0], s[1], 0xa15) * 0.7;
          dm.position.set(s[0], y, zOf(s[1]));
          dm.rotation.set(0, h01(s[0], s[1], 0xa16) * Math.PI * 2, 0);
          dm.scale.set(k, k * (0.8 + h01(s[0], s[1], 0xa17) * 0.5), k);
          dm.updateMatrix(); im.setMatrixAt(i, dm.matrix);
          const t = h01(s[0], s[1], 0xa18);
          tint.setRGB(0.85 + t * 0.25, 0.85 + t * 0.2, 0.75 + t * 0.15);
          if (im.setColorAt) im.setColorAt(i, tint);
        });
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        if (!gHit) { bakeOut.gm = im.instanceMatrix.array; bakeOut.gc = im.instanceColor ? im.instanceColor.array : new Float32Array(nG * 3); }
        im.castShadow = false; im.receiveShadow = true;
        im.name = "beach-dune-grass"; im.userData.beach = "grass";
        root.add(im);
      }
    })();

    // =====================================================================
    //  4) PALMS — the vegetation kit's coconut palm (one palm for every coast)
    // =====================================================================
    (function palmsBuild() {
      const VK = CBZ.vegetationKit;
      const list = [];
      for (let x = X0 + 6; x < X1 - 4; x += 13) {
        if (allGaps.some(function (gx) { return Math.abs(x - gx) < 3.2; })) continue;
        list.push({ x: x + (rng() - 0.5) * 2, d: 0.75, h: 7.0 + rng() * 2.6 });
      }
      for (const c of [[X0 + 31, 9.4], [X0 + 34, 8.2], [X0 + 63.5, 8.6], [X0 + 97, 9.2], [X0 + 127, 8.4], [X0 + 130.5, 9.6]]) {
        list.push({ x: c[0], d: c[1], h: 5.6 + rng() * 3.2 });
      }
      const palms = list.map(function (p, i) {
        return { x: p.x, z: zOf(p.d), y: sandYd(p.x, p.d), h: p.h, v: (h01(p.x, p.d, 0x9a0) * 2) | 0, yaw: rng() * Math.PI * 2, crownYaw: rng() * Math.PI * 2, i };
      });
      if (!VK || !VK.palmTrunk || !VK.palmCrown || !palms.length) { palmField = { list: [], take() { return null; } }; return; }
      const trunkMat = VK.material ? VK.material("wood", 0x8a7a66) : new THREE.MeshLambertMaterial({ vertexColors: true, color: 0x8a7a66 });
      const crownMat = new THREE.MeshLambertMaterial({ color: 0x2a5214, vertexColors: true, side: THREE.DoubleSide });
      crownMat.name = "beach-palm-frond";
      const TREES2 = !!(CBZ.CONFIG && CBZ.CONFIG.TREES_V2 !== false && CBZ.treeRegisterTree);
      if (TREES2 && CBZ.treeAuditResetSite) CBZ.treeAuditResetSite("beach");
      const pools = [];
      for (let v = 0; v < 2; v++) {
        const mine = palms.filter(function (p) { return p.v === v; });
        if (!mine.length) { pools.push(null); continue; }
        const tg = VK.palmTrunk(v), cg = VK.palmCrown(v);
        const tIM = new THREE.InstancedMesh(tg, trunkMat, mine.length);
        const cIM = new THREE.InstancedMesh(cg, crownMat, mine.length);
        tIM.castShadow = true; cIM.castShadow = true; tIM.receiveShadow = cIM.receiveShadow = true;
        tIM.name = "beach-palm-trunks"; cIM.name = "beach-palm-crowns";
        tIM.userData.beach = cIM.userData.beach = "palm";
        const tb = TREES2 && CBZ.treeGeoBounds ? CBZ.treeGeoBounds(tg) : null;
        const cb = TREES2 && CBZ.treeGeoBounds ? CBZ.treeGeoBounds(cg) : null;
        mine.forEach(function (p, k) {
          const t = palmMatrices(p, tg);
          tIM.setMatrixAt(k, t.trunk); cIM.setMatrixAt(k, t.crown);
          p.pool = v; p.slot = k;
          if (TREES2 && tb && cb) {
            const parts = [];
            CBZ.treeAabbPush(parts, t.trunk, tb.min.x, tb.min.y, tb.min.z, tb.max.x, tb.max.y, tb.max.z);
            CBZ.treeAabbPush(parts, t.crown, cb.min.x, cb.min.y, cb.min.z, cb.max.x, cb.max.y, cb.max.z);
            CBZ.treeRegisterTree("beach", p.y, parts);
          }
          p.col = solid(p.x - 0.24, p.x + 0.24, p.z - 0.24, p.z + 0.24, tIM, null, null);
        });
        tIM.instanceMatrix.needsUpdate = cIM.instanceMatrix.needsUpdate = true;
        root.add(tIM); root.add(cIM);
        pools.push({ t: tIM, c: cIM, tg, cg });
      }
      function palmMatrices(p, tg) {
        const sy = p.h + 0.3, base = p.y - 0.3;
        const tm = new THREE.Matrix4().compose(new THREE.Vector3(p.x, base, p.z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.yaw, 0)), new THREE.Vector3(1, sy, 1));
        // the crown hub sits on the trunk's bent tip, read off its own curve
        const tp = tg.userData.top || new THREE.Vector3(0, 1, 0), bx = tp.x * sy;
        const cm = new THREE.Matrix4().compose(
          new THREE.Vector3(p.x + bx * Math.cos(p.yaw), base + sy * tp.y - 0.05, p.z - bx * Math.sin(p.yaw)),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.crownYaw, 0)), new THREE.Vector3(1, 1, 1));
        return { trunk: tm, crown: cm };
      }
      if (CBZ.treeFoot) {
        const feet = [];
        for (const p of palms) feet.push(p.x, p.y, p.z, 2.4, 0);
        CBZ.treeFoot.add(root, feet, { name: "beach-palms" });
      }
      /* THE PALMS CAN BE TAKEN (tsunami.js's real-debris doctrine): take(i)
         zero-scales the palm's two instances, pulls its trunk collider and
         hands back a REAL group of the same geometry and material, pivoted
         at the trunk's middle so it tumbles like a tree. */
      const zero = new THREE.Matrix4().makeScale(0, 0, 0);
      palmField = {
        list: palms,
        take(i) {
          const p = palms[i];
          if (!p || p._taken || !pools[p.pool]) return null;
          p._taken = 1;
          const pool = pools[p.pool];
          pool.t.setMatrixAt(p.slot, zero); pool.c.setMatrixAt(p.slot, zero);
          pool.t.instanceMatrix.needsUpdate = pool.c.instanceMatrix.needsUpdate = true;
          const ci = CBZ.colliders.indexOf(p.col);
          if (ci >= 0) { CBZ.colliders.splice(ci, 1); if (CBZ.markCollidersDirty) CBZ.markCollidersDirty(); }
          const M = palmMatrices(p, pool.tg);
          const mid = p.y - 0.3 + (p.h + 0.3) / 2;
          const grp = new THREE.Group();
          const inv = new THREE.Matrix4().makeTranslation(-p.x, -mid, -p.z);
          const tr = new THREE.Mesh(pool.tg, pool.t.material); tr.applyMatrix4(M.trunk.clone().premultiply(inv));
          const cr = new THREE.Mesh(pool.cg, pool.c.material); cr.applyMatrix4(M.crown.clone().premultiply(inv));
          grp.add(tr); grp.add(cr);
          grp.position.set(p.x, mid, p.z);
          root.add(grp);
          return { group: grp, x: p.x, z: p.z };
        },
      };
    })();

    // =====================================================================
    //  5) LIFEGUARD TOWERS — South Beach stations: stilts, a deck, a cabin
    //  with a raked window band, a coloured roof, a ramp, a flag
    // =====================================================================
    function tower(tx, pal, style) {
      const w = W(tx), dc = w - 15.5;            // cabin centre, 15.5 m above the waterline
      const tz = zOf(dc), ys = sandYd(tx, dc);
      const H = 2.4, YD = ys + H + 0.15;          // deck top
      const S2 = 1.6;                             // half deck (3.2 m square)
      // local: u = +x, v = SEAWARD (-z). world z = tz - v
      const Z = function (v) { return tz - v; };
      // stilts + cross bracing
      for (const su of [-1, 1]) for (const sv of [-1, 1]) {
        A.box(tx + su * 1.3, ys + (H - 0.3) / 2, Z(sv * 1.3), 0.2, H + 0.3, 0.2, C.offWhite);
        solid(tx + su * 1.3 - 0.13, tx + su * 1.3 + 0.13, Z(sv * 1.3) - 0.13, Z(sv * 1.3) + 0.13, REF, null, YD - 0.15);
      }
      for (const su of [-1, 1]) {
        A.rod(tx + su * 1.3, ys + 0.3, Z(-1.3), tx + su * 1.3, ys + H - 0.1, Z(1.3), 0.045, 5, C.offWhite);
        A.rod(tx + su * 1.3, ys + 0.3, Z(1.3), tx + su * 1.3, ys + H - 0.1, Z(-1.3), 0.045, 5, C.offWhite);
      }
      A.box(tx, ys + H + 0.07, tz, 3.3, 0.15, 3.3, pal.trim);                // deck slab (trim edge)
      A.box(tx, YD + 0.005, tz, 3.1, 0.01, 3.1, C.deck[1]);                  // decking
      platform(tx - S2, tx + S2, Z(-S2), Z(S2), YD);
      // the cabin at the back: v -1.5 .. 0.4
      const cv0 = -1.5, cv1 = 0.35, cvm = (cv0 + cv1) / 2, cw = 2.6, cd = cv1 - cv0;
      A.box(tx, YD + 0.5, Z(cvm), cw, 1.0, cd, pal.body);                    // lower body
      // window band: dark glass, the front face raked out at the top
      A.box(tx, YD + 1.45, Z(cvm - 0.04), cw - 0.12, 0.9, cd - 0.12, C.glass);
      A.box(tx, YD + 1.45, Z(cv1 + 0.06), cw + 0.02, 0.92, 0.05, C.glass, 0, 0.22);
      for (const su of [-1, 1]) A.box(tx + su * (cw / 2), YD + 1.45, Z(cvm), 0.1, 0.9, cd + 0.05, pal.trim);
      A.box(tx, YD + 1.45, Z(cvm), 0.08, 0.9, cd + 0.06, pal.trim);
      A.box(tx, YD + 2.0, Z(cvm), cw + 0.1, 0.22, cd + 0.1, pal.trim);          // header band
      // a door in the back face, onto the ramp landing
      A.box(tx, YD + 0.95, Z(cv0 - 0.01), 0.8, 1.85, 0.04, mul(pal.body, 0.82));
      // the roof
      if (style === 0) {                          // "sunburst": a rising raked slab with a fan of fins
        A.box(tx, YD + 2.32, Z(cvm + 0.35), cw + 1.2, 0.1, cd + 1.9, pal.roof, 0, -0.16);
        for (let k = -2; k <= 2; k++) A.box(tx + k * 0.62, YD + 2.48, Z(cv1 + 0.85), 0.06, 0.36, 0.9, pal.trim, k * 0.18, -0.16);
      } else {                                    // "swoop": a curved shell built from five staves
        for (let k = 0; k < 5; k++) {
          const a = -0.55 + k * 0.28, v = cvm - 1.0 + k * 0.62;
          A.box(tx, YD + 2.3 + Math.cos(a) * 0.25 - 0.1 + (k === 4 ? 0.12 : 0), Z(v), cw + 0.9, 0.09, 0.66, pal.roof, 0, a * 0.6);
        }
      }
      solid(tx - cw / 2, tx + cw / 2, Z(cv0), Z(cv1), REF, YD - 0.05, YD + 2.4);
      // the porch parapet: solid painted panels at the sides, a rail at the front
      for (const su of [-1, 1]) {
        A.box(tx + su * (S2 - 0.04), YD + 0.5, Z((cv1 + S2) / 2), 0.06, 1.0, S2 - cv1, pal.trim);
        solid(tx + su * (S2 - 0.04) - 0.06, tx + su * (S2 - 0.04) + 0.06, Z(cv1), Z(S2), REF, YD, YD + 1.05);
      }
      A.box(tx, YD + 1.0, Z(S2 - 0.04), 3.2, 0.06, 0.08, C.white);
      A.box(tx, YD + 0.55, Z(S2 - 0.04), 3.2, 0.05, 0.05, C.white);
      for (const su of [-1, -0.33, 0.33, 1]) A.box(tx + su * (S2 - 0.04), YD + 0.5, Z(S2 - 0.04), 0.06, 1.0, 0.06, C.white);
      solid(tx - S2, tx + S2, Z(S2) - 0.06, Z(S2) + 0.06, REF, YD, YD + 1.05);
      // the ramp: from the back edge of the deck down to the sand, landward
      const RUN = 5.6, RW = 1.0, rv0 = -S2, rv1 = -S2 - RUN;
      const yTop = YD, yBot = sandYd(tx, dc - S2 - RUN) + 0.04;
      const pitch = Math.atan2(yTop - yBot, RUN);
      A.box(tx, (yTop + yBot) / 2 - 0.05, Z((rv0 + rv1) / 2), RW, 0.08, Math.hypot(RUN, yTop - yBot), C.deck[0], 0, pitch);
      for (let k = 1; k < 10; k++) {              // cleats
        const t = k / 10, yy = yTop + (yBot - yTop) * t;
        A.box(tx, yy, Z(rv0 + (rv1 - rv0) * t), RW - 0.1, 0.03, 0.05, C.woodDk);
      }
      for (const su of [-1, 1]) {
        A.rod(tx + su * (RW / 2), yTop + 0.95, Z(rv0), tx + su * (RW / 2), yBot + 0.95, Z(rv1), 0.03, 5, C.white);
        A.rod(tx + su * (RW / 2), yTop, Z(rv0), tx + su * (RW / 2), yTop + 0.95, Z(rv0), 0.03, 5, C.white);
        A.rod(tx + su * (RW / 2), yBot, Z(rv1), tx + su * (RW / 2), yBot + 0.95, Z(rv1), 0.03, 5, C.white);
        const ym = (yTop + yBot) / 2;            // a support post under the ramp's middle
        A.box(tx + su * (RW / 2), (ym + ys - 0.2) / 2, Z((rv0 + rv1) / 2), 0.12, ym - ys + 0.2, 0.12, C.offWhite);
        solid(tx + su * (RW / 2) - 0.05, tx + su * (RW / 2) + 0.05, Z(rv1), Z(rv0), REF, null, YD + 1.0);
      }
      // the ramp as walkable steps (a platform is flat; STEP_UP climbs 0.32)
      const NS = Math.max(4, Math.ceil((yTop - yBot) / 0.3));
      for (let k = 0; k < NS; k++) {
        const v0 = rv1 + (rv0 - rv1) * k / NS, v1 = rv1 + (rv0 - rv1) * (k + 1) / NS;
        platform(tx - RW / 2, tx + RW / 2, Z(v0), Z(v1), yBot + (yTop - yBot) * (k + 1) / NS);
      }
      // a lifeguard stool on the porch, a rescue can on the rail, a flag on the roof
      A.box(tx + 0.5, YD + 0.24, Z(1.0), 0.42, 0.04, 0.42, C.white);
      for (const su of [-1, 1]) for (const sv of [-1, 1]) A.box(tx + 0.5 + su * 0.17, YD + 0.12, Z(1.0 + sv * 0.17), 0.04, 0.24, 0.04, C.steelDk);
      A.box(tx - 0.9, YD + 0.85, Z(S2 + 0.02), 0.62, 0.16, 0.12, lin(0xd8372f));
      A.cyl(tx - cw / 2 - 0.25, YD + 2.2, Z(cv0 + 0.2), 0.025, 0.025, 2.1, 5, C.steel);
      A.quad([tx - cw / 2 - 0.25, YD + 4.2, Z(cv0 + 0.2)], [tx - cw / 2 - 1.15, YD + 4.15, Z(cv0 + 0.2)],
        [tx - cw / 2 - 1.15, YD + 3.85, Z(cv0 + 0.2)], [tx - cw / 2 - 0.25, YD + 3.9, Z(cv0 + 0.2)], lin(0xd8372f), true);
      A.quad([tx - cw / 2 - 0.25, YD + 3.9, Z(cv0 + 0.2)], [tx - cw / 2 - 1.15, YD + 3.85, Z(cv0 + 0.2)],
        [tx - cw / 2 - 1.15, YD + 3.6, Z(cv0 + 0.2)], [tx - cw / 2 - 0.25, YD + 3.62, Z(cv0 + 0.2)], lin(0xf2c431), true);
      // a rescue board leaning on a stilt
      A.box(tx + 1.55, ys + 1.25, Z(-0.9), 0.55, 2.7, 0.09, lin(0xf2c431), 0, 0.12, -0.06);
      const seat = CBZ.propRegisterSeat
        ? CBZ.propRegisterSeat(tx + 0.5, YD, Z(1.0), Math.PI, "chair", null, { cushion: 0.26, floorBelow: 0 })
        : null;
      lifeguardSpots.push({ seat, post: { x: tx + 1.3, z: Z(rv1 + 1.0), face: Math.PI } });
    }
    tower(X0 + 38, TOWER_PALETTES[0], 0);
    tower(X0 + 120, TOWER_PALETTES[1], 1);

    // =====================================================================
    //  6) THE CONCESSION + TWO STALLS on the plaza
    // =====================================================================
    (function concession() {
      const T = BWK.top;
      const sx = (PLAZA.x0 + PLAZA.x1) / 2, d0 = 7.3, d1 = 10.2, w = 6.0;
      const z0 = zOf(d0), z1 = zOf(d1), zm = zOf((d0 + d1) / 2);
      const body = lin(0x9ed9c8), trim = C.white, awn = [lin(0xf06a4a), C.white];
      // walls: back + sides full height, front has the serving opening
      A.box(sx, T + 1.4, z1, w, 2.8, 0.15, body);
      for (const s of [-1, 1]) A.box(sx + s * w / 2, T + 1.4, zm, 0.15, 2.8, d1 - d0, body);
      A.box(sx, T + 0.5, z0, w, 1.0, 0.15, body);                            // under the counter
      A.box(sx, T + 2.45, z0, w, 0.7, 0.15, body);                           // above the opening
      for (const s of [-1, 0, 1]) A.box(sx + s * (w / 2 - 0.08), T + 1.55, z0, 0.16, 1.3, 0.17, trim);
      A.box(sx, T + 1.03, z0 + 0.12, w + 0.1, 0.06, 0.45, C.wood);             // the counter shelf
      A.box(sx, T + 2.05, z0 - 0.01, w - 0.3, 0.12, 0.1, C.steelDk);           // rolled-up shutter
      A.box(sx, T + 2.88, zm, w + 0.5, 0.16, d1 - d0 + 0.5, trim);             // roof slab
      A.box(sx + 1.4, T + 3.15, zm, 1.0, 0.4, 0.8, C.steel);                   // condenser on the roof
      // a striped awning over the opening
      for (let k = 0; k < 10; k++) {
        const ax = sx - w / 2 + (k + 0.5) * (w / 10);
        A.box(ax, T + 2.6, z0 + 0.62, w / 10, 0.05, 1.3, awn[k % 2], 0, 0.32);
      }
      A.box(sx, T + 0.03, zm, w - 0.3, 0.02, d1 - d0 - 0.3, C.concreteDk);      // inside floor
      // colliders: the walls, the counter (the vendor stands inside behind it)
      solid(sx - w / 2, sx + w / 2, z1 - 0.1, z1 + 0.1, REF, null, null);
      for (const s of [-1, 1]) solid(sx + s * w / 2 - 0.1, sx + s * w / 2 + 0.1, z1, z0, REF, null, null);
      solid(sx - w / 2, sx + w / 2, z0 - 0.1, z0 + 0.35, REF, null, T + 1.06);
      stallSpots.push({ x: sx - 1.2, z: zOf(d0 + 0.9), face: 0, floorY: T });
      // two vendor stalls either side: goods table, posts, a striped canopy
      for (const st of [[PLAZA.x0 + 4.5, lin(0xf2b631)], [PLAZA.x1 - 4.5, lin(0x2563b8)]]) {
        const x = st[0], tdz = 7.4, tz = zOf(tdz);
        A.box(x, T + 0.42, tz, 2.2, 0.84, 0.9, C.wood);
        A.box(x, T + 0.86, tz, 2.3, 0.04, 1.0, C.offWhite);
        for (const su of [-1, 1]) for (const sv of [-1, 1]) A.box(x + su * 1.1, T + 1.15, tz + sv * 0.85, 0.07, 2.3, 0.07, C.steelDk);
        for (let k = 0; k < 6; k++) A.box(x - 1.15 + (k + 0.5) * (2.3 / 6), T + 2.32, tz, 2.3 / 6, 0.05, 1.9, k % 2 ? C.white : st[1], 0, 0, 0.0);
        solid(x - 1.15, x + 1.15, tz - 0.5, tz + 0.5, REF, null, T + 0.9);
        stallSpots.push({ x, z: zOf(tdz + 1.0), face: 0, floorY: T });
      }
    })();

    // =====================================================================
    //  7) THE BACKSHORE: umbrellas, towels, furniture, the court, showers,
    //  bins — and the loot that lives with the sunbathers
    // =====================================================================
    function umbrella(x, d, colHex, stripe) {
      const ys = sandYd(x, d), z = zOf(d);
      const tiltX = (h01(x, d, 0x0b1) - 0.5) * 0.3, tiltZ = (h01(x, d, 0x0b2) - 0.5) * 0.3;
      const base = new THREE.Vector3(x, ys - 0.25, z);
      const M = new THREE.Matrix4().compose(base, new THREE.Quaternion().setFromEuler(new THREE.Euler(tiltX, h01(x, d, 0x0b3) * 6.28, tiltZ)), new THREE.Vector3(1, 1, 1));
      const P = function (px, py, pz) { const v = new THREE.Vector3(px, py, pz).applyMatrix4(M); return [v.x, v.y, v.z]; };
      // pole (2.45 m, the bottom 0.25 driven into the sand)
      A.rod.apply(A, P(0, 0, 0).concat(P(0, 2.45, 0)).concat([0.022, 6, C.steel]));
      const apex = P(0, 2.48, 0), R = 1.05, NP = 8, rimY = 2.1, c1 = lin(colHex), c2 = stripe ? C.white : c1;
      for (let k = 0; k < NP; k++) {
        const a0 = k / NP * Math.PI * 2, a1 = (k + 1) / NP * Math.PI * 2;
        const r0 = P(Math.cos(a0) * R, rimY, Math.sin(a0) * R), r1 = P(Math.cos(a1) * R, rimY, Math.sin(a1) * R);
        const mid = P(Math.cos((a0 + a1) / 2) * R * 0.96, rimY + 0.06, Math.sin((a0 + a1) / 2) * R * 0.96);
        const cc = k % 2 ? c2 : c1;
        A.tri(apex, r1, mid, cc, true, mul(cc, 0.55));
        A.tri(apex, mid, r0, cc, true, mul(cc, 0.55));
        // the valance: a short scalloped skirt under the rim
        const v0 = P(Math.cos(a0) * R, rimY - 0.12, Math.sin(a0) * R), v1 = P(Math.cos(a1) * R, rimY - 0.12, Math.sin(a1) * R);
        A.quad(r0, r1, v1, v0, cc, true, mul(cc, 0.5));
      }
      A.box.apply(A, P(0, 2.5, 0).concat([0.06, 0.06, 0.06, C.offWhite]));
      solid(x - 0.08, x + 0.08, z - 0.08, z + 0.08, REF, null, null);
    }
    function towel(x, d, yaw, hex) {
      const ys = sandYd(x, d), z = zOf(d), c = lin(hex), c2 = h01(x, d, 0x70e) > 0.5 ? C.white : mul(c, 0.55);
      const L = 1.75, Wd = 0.9, ca = Math.cos(yaw), sa = Math.sin(yaw);
      const P = function (u, v, dy) { return [x + ca * u - sa * v, ys + 0.012 + (dy || 0), z - sa * u - ca * v]; };
      // three bands across the long axis, the ends in the stripe colour
      const bands = [[-L / 2, -L / 2 + 0.22, c2], [-L / 2 + 0.22, L / 2 - 0.22, c], [L / 2 - 0.22, L / 2, c2]];
      for (const b of bands) A.quad(P(b[0], -Wd / 2), P(b[1], -Wd / 2), P(b[1], Wd / 2), P(b[0], Wd / 2), b[2]);
      // lying people: a towel is a bed (propuse); sunbathers are posted onto it
      if (CBZ.propRegisterBed) {
        const rec = CBZ.propRegisterBed(x, ys, z, ca, -sa, L, ys + 0.02, "towel");
        if (rec) chairs.push({ rec, lie: 1 });
      }
    }
    const SEAWARD = Math.PI;
    function furnBox(bx, by, bz, w, h, d, color, o) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), cmat(color));
      m.position.set(bx, by, bz);
      m.castShadow = !!(o && o.cast); m.receiveShadow = true;
      root.add(m);
      if (o && o.solid) {
        const c = { minX: bx - w / 2, maxX: bx + w / 2, minZ: bz - d / 2, maxZ: bz + d / 2, ref: m, noCam: true };
        if (o.y0 != null) c.y0 = o.y0;
        if (o.y1 != null) c.y1 = o.y1;
        if (o.noStep) c.noStep = true;
        CBZ.colliders.push(c);
      }
      return m;
    }
    function lounger(x, d, yaw, cloth) {
      if (!CBZ.furnish) return;
      const o = { box: furnBox, solid: true, tone: { cloth: cloth, frame: 0xd9d2bd } };
      const r = CBZ.furnish.lounger(x, sandYd(x, d), zOf(d), yaw, o);
      if (r && r.beds && r.beds[0]) chairs.push({ rec: r.beds[0], lie: 1 });
    }
    function deckchair(x, d, yaw, cloth) {
      if (!CBZ.furnish) return;
      const o = { box: furnBox, solid: true, tone: { cloth: cloth, frame: 0xd9d2bd } };
      const r = CBZ.furnish.deckchair(x, sandYd(x, d), zOf(d), yaw, o);
      if (r && r.seats && r.seats[0] && r.seats[0].rec) chairs.push({ rec: r.seats[0].rec, lie: 0 });
    }
    const lootSpots = [];
    (function backshore() {
      // ---- personal camps: an umbrella, a towel or two, maybe a chair
      const camps = [9, 27.5, 46.5, 99, 113.5];
      camps.forEach(function (ox, i) {
        const x = X0 + ox + (rng() - 0.5) * 2.0, w = W(x);
        const d = w - 13.2 - rng() * 2.6;
        const hex = UMB[(rng() * UMB.length) | 0];
        umbrella(x, d, hex, rng() < 0.6);
        const nt = 1 + (rng() < 0.65 ? 1 : 0);
        for (let k = 0; k < nt; k++) {
          const tx = x + (k ? 1.25 : -1.15) + (rng() - 0.5) * 0.4;
          const yaw = (rng() - 0.5) * 0.5 + (rng() < 0.5 ? 0 : Math.PI / 2 * 0.15);
          towel(tx, d + 0.6 + (rng() - 0.5) * 0.5, Math.PI / 2 + yaw, TOWEL[(rng() * TOWEL.length) | 0]);
        }
        if (rng() < 0.55) deckchair(x + (rng() < 0.5 ? -2.3 : 2.3), d - 1.4, SEAWARD + (rng() - 0.5) * 0.5, [0xe24b4b, 0x3c6fd6, 0xf2c43d, 0x4caf6e][(rng() * 4) | 0]);
        lootSpots.push({ x: x + (rng() < 0.5 ? -0.55 : 0.6), d: d + 1.6 + rng() * 0.4, bag: i >= 3 });
      });
      // ---- a hotel rental row: matching umbrellas, two loungers under each
      const rowD = function (x) { return W(x) - 14.0; };
      for (let k = 0; k < 4; k++) {
        const x = X0 + 141.5 + k * 4.6, d = rowD(x);
        umbrella(x, d, 0x2c2f6b, false);
        lounger(x - 0.55, d - 0.35, SEAWARD, 0xf1efe8);
        lounger(x + 0.55, d - 0.35, SEAWARD, 0xf1efe8);
      }
      // a couple of loungers near the first tower, rented out by the day
      lounger(X0 + 31, W(X0 + 31) - 12.8, SEAWARD + 0.15, 0x2563b8);
      lounger(X0 + 32.2, W(X0 + 32.2) - 12.9, SEAWARD - 0.1, 0x2563b8);
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();

      // ---- the volleyball court (16 x 8 m), seaward of the plaza
      const vx = (PLAZA.x0 + PLAZA.x1) / 2, vd = 17.6;
      const cl = function (xa, da, xb, db) {    // a rope boundary line, seated on the sand
        const n = Math.max(1, Math.round(Math.hypot(xb - xa, db - da) / 2));
        for (let k = 0; k < n; k++) {
          const x1 = xa + (xb - xa) * k / n, d1 = da + (db - da) * k / n, x2 = xa + (xb - xa) * (k + 1) / n, d2 = da + (db - da) * (k + 1) / n;
          const y = (sandYd(x1, d1) + sandYd(x2, d2)) / 2 + 0.012;
          A.box((x1 + x2) / 2, y, zOf((d1 + d2) / 2), Math.abs(x2 - x1) + 0.05, 0.02, Math.abs(d2 - d1) + 0.05, C.rope);
        }
      };
      cl(vx - 8, vd - 4, vx + 8, vd - 4); cl(vx - 8, vd + 4, vx + 8, vd + 4);
      cl(vx - 8, vd - 4, vx - 8, vd + 4); cl(vx + 8, vd - 4, vx + 8, vd + 4);
      const ny = sandYd(vx, vd), nb = ny + 1.43, nt2 = ny + 2.43;
      for (const s of [-1, 1]) {
        const pz = zOf(vd + s * 4.9);
        A.cyl(vx, ny - 0.4, pz, 0.05, 0.05, 2.95, 8, C.steel);
        A.box(vx, ny + 0.6, pz, 0.14, 1.2, 0.14, lin(0x2563b8));          // post pad
        solid(vx - 0.1, vx + 0.1, pz - 0.1, pz + 0.1, REF, null, null);
      }
      const zA = zOf(vd - 4.5), zB = zOf(vd + 4.5);
      A.quad([vx, nt2 - 0.07, zA], [vx, nt2 - 0.07, zB], [vx, nt2, zB], [vx, nt2, zA], C.white, true);          // top tape
      A.quad([vx, nb, zA], [vx, nb, zB], [vx, nb + 0.05, zB], [vx, nb + 0.05, zA], C.white, true);             // bottom tape
      for (let k = 0; k <= 90; k++) {                                         // the mesh
        const z = zA + (zB - zA) * k / 90;
        A.quad([vx, nb, z - 0.006], [vx, nb, z + 0.006], [vx, nt2 - 0.07, z + 0.006], [vx, nt2 - 0.07, z - 0.006], C.net, true);
      }
      for (let k = 1; k < 10; k++) {
        const y = nb + (nt2 - 0.07 - nb) * k / 10;
        A.quad([vx, y, zA], [vx, y, zB], [vx, y + 0.012, zB], [vx, y + 0.012, zA], C.net, true);
      }
      for (const s of [-1, 1]) {                                             // antennae, red and white
        const az = zOf(vd + s * 4.0);
        for (let k = 0; k < 8; k++) A.cyl(vx, nb + k * 0.22, az, 0.006, 0.006, 0.22, 5, k % 2 ? C.white : lin(0xd8372f));
      }
      solid(vx - 0.04, vx + 0.04, zA, zB, REF, nb - 0.05, nt2 + 0.05);

      // ---- showers at the foot of each crossover (a stainless post, two
      //      heads, a timber pad), and bins at both ends of each path
      for (const gx of GAPS) {
        const sx = gx - 2.4, sd = 14.0, sz = zOf(sd), sy = sandYd(sx, sd);
        for (let k = 0; k < 8; k++) A.box(sx, sy + 0.04, sz - 0.5 + k * 0.143, 1.1, 0.06, 0.12, C.deck[3]);
        A.cyl(sx, sy, sz, 0.05, 0.05, 2.3, 8, C.steel);
        for (const s of [-1, 1]) {
          A.rod(sx, sy + 2.2, sz, sx + s * 0.32, sy + 2.25, sz, 0.02, 5, C.steel);
          A.cyl(sx + s * 0.32, sy + 2.12, sz, 0.07, 0.035, 0.12, 8, C.steel);
        }
        A.box(sx, sy + 1.0, sz + 0.06, 0.08, 0.12, 0.06, C.steelDk);            // the push valve
        solid(sx - 0.08, sx + 0.08, sz - 0.08, sz + 0.08, REF, null, null);
        bin(gx + 2.3, 14.2);
        bin(gx + 2.3, BWK.d1 - 0.75, BWK.top);
      }
      bin(PLAZA.x0 + 1.0, PLAZA.d1 - 0.6, BWK.top);
      bin(PLAZA.x1 - 1.0, PLAZA.d1 - 0.6, BWK.top);
      bin(pierX - 3.4, 18.5);
    })();
    // a round slatted beach bin with a dark liner and lid
    function bin(x, d, floorY) {
      const z = zOf(d), y = floorY != null ? floorY : sandYd(x, d) - 0.05;
      A.cyl(x, y, z, 0.3, 0.27, 0.95, 12, C.binGreen);
      A.cyl(x, y + 0.95, z, 0.33, 0.33, 0.06, 12, C.binLid);
      A.cyl(x, y + 1.01, z, 0.12, 0.2, 0.06, 10, C.binLid);
      solid(x - 0.32, x + 0.32, z - 0.32, z + 0.32, REF, null, y + 1.05);
    }
    // the valuables: a cooler or a beach bag beside each personal camp
    lootSpots.forEach(function (sp) {
      const ys = sandYd(sp.x, sp.d), z = zOf(sp.d);
      let body;
      if (sp.bag) {
        body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.36, 0.2), BAG_FULL());
        body.position.set(sp.x, ys + 0.17, z);
        body.rotation.set(0, rng() * Math.PI, 0.06);
      } else {
        body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.36, 0.38), LOOT_FULL());
        body.position.set(sp.x, ys + 0.18, z);
        body.rotation.y = rng() * Math.PI;
        const lid = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.07, 0.42), cmat(0xe8ebee));
        lid.position.set(0, 0.215, 0); lid.castShadow = false;
        body.add(lid);
      }
      body.castShadow = false; body.receiveShadow = true;
      body.userData.beachLoot = true;              // material swaps at runtime: batch must keep its hands off
      root.add(body);
      loot.push({ x: sp.x, z, body, bag: sp.bag, looted: false, t: 0 });
    });

    // =====================================================================
    //  8) THE STRANDLINE — weed, sargassum and driftwood at the high-tide
    //  mark, a fainter second line from the last tide below it
    // =====================================================================
    (function wrack() {
      const blob = new THREE.OctahedronGeometry(1, 0);   // 24 verts: a flattened clump at any yaw
      const dm = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
      const line = function (dl0, density, salt) {
        for (let x = AX0 + 4; x < AX1 - 4; x += 0.42) {
          if (h01(x, salt, salt + 1) > density * (0.4 + vn(x, 0, 9, salt + 2) * 1.2)) continue;
          if (Math.abs(x - pierX) < 3.0) continue;
          const xx = x + (h01(x, salt, salt + 3) - 0.5) * 0.4;
          const dl = dl0 + 0.8 * (vn(xx, 0, 23, 0x7a3) - 0.5) + (h01(xx, salt, salt + 4) - 0.5) * 0.9;
          const d = W(xx) - dl, y = sandYd(xx, d);
          const sx = 0.12 + h01(xx, d, salt + 5) * 0.32, sz = 0.07 + h01(xx, d, salt + 6) * 0.2;
          e.set(0, h01(xx, d, salt + 7) * 6.28, 0); q.setFromEuler(e);
          dm.compose(p.set(xx, y + 0.006, zOf(d)), q, s.set(sx, 0.025 + h01(xx, d, salt + 8) * 0.03, sz));
          A.geo(blob, dm, C.wrack[(h01(xx, d, salt + 9) * C.wrack.length) | 0]);
        }
      };
      line(6.9, 0.85, 0x3a10);
      line(3.6, 0.35, 0x3b20);
      for (let k = 0; k < 14; k++) {             // driftwood
        const x = AX0 + 8 + rng() * (AX1 - AX0 - 16);
        if (Math.abs(x - pierX) < 4) continue;
        const dl = 6.9 + (rng() - 0.5) * 1.6, d = W(x) - dl, y = sandYd(x, d);
        const L = 0.5 + rng() * 1.8, a = rng() * Math.PI, r = 0.03 + rng() * 0.06;
        A.rod(x - Math.cos(a) * L / 2, y + r * 0.6, zOf(d) - Math.sin(a) * L / 2, x + Math.cos(a) * L / 2, y + r * 0.5, zOf(d) + Math.sin(a) * L / 2, r, 6, mul(C.drift, 0.85 + rng() * 0.3));
      }
    })();

    // =====================================================================
    //  9) RIPRAP where the sand meets each seawall end
    // =====================================================================
    (function riprap() {
      const rock = new THREE.DodecahedronGeometry(1, 0);
      const dm = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
      for (const end of [[X0, -1], [X1, 1]]) {
        for (let k = 0; k < 22; k++) {
          const t = k / 21;
          const d = WALL_D - 1.2 + t * 9.5 + (rng() - 0.5) * 1.2;
          const x = end[0] + end[1] * (-0.8 + rng() * 3.2) - end[1] * t * 1.5;
          const r = 0.45 + rng() * 0.6;
          const ground = Math.max(sandYd(x, d), SEA - 1.2);
          e.set(rng() * 3, rng() * 3, rng() * 3); q.setFromEuler(e);
          dm.compose(p.set(x, ground + r * 0.35, zOf(d)), q, s.set(r, r * (0.6 + rng() * 0.3), r * (0.8 + rng() * 0.4)));
          A.geo(rock, dm, C.rock[(rng() * C.rock.length) | 0]);
          if (ground + r * 0.9 > 0.2) solid(x - r * 0.7, x + r * 0.7, zOf(d) - r * 0.7, zOf(d) + r * 0.7, REF, null, ground + r * 0.9);
        }
      }
    })();

    // =====================================================================
    //  10) THE PIER — pile bents, cap beams, stringers, a planked deck,
    //  timber railings, benches and lamps on the head. The deck is a platform
    //  at 0.85 (under STEP_UP: stroll on from the sand, dive off the end).
    // =====================================================================
    (function pier() {
      const pw = 5.2, top = 0.85;
      const z0 = ES + 5, z1 = ES - 36;                     // sand → open water
      const headW = 9.4, headZ1 = z1 - 8;
      const d0 = dOf(z0), d1 = dOf(z1), dH = dOf(headZ1);
      // deck
      const PL = 0.15, GP = 0.014;
      for (let d = d0; d < dH - 0.01; d += PL + GP) {
        const hw = (d >= d1 ? headW : pw) / 2, za = zOf(d), zb = zOf(Math.min(dH, d + PL));
        const c = mul(C.deck[(h01(d * 5, 3, 0xe01) * 4) | 0], 0.9 + h01(d * 5, 4, 0xe02) * 0.15);
        A.quad([pierX - hw, top, za], [pierX + hw, top, za], [pierX + hw, top, zb], [pierX - hw, top, zb], c);
      }
      A.box(pierX, top - 0.07, zOf((d0 + d1) / 2), pw, 0.1, d1 - d0, C.deckDark);
      A.box(pierX, top - 0.07, zOf((d1 + dH) / 2), headW, 0.1, dH - d1, C.deckDark);
      for (const s of [-1, 1]) {
        A.box(pierX + s * pw / 2, top - 0.15, zOf((d0 + d1) / 2), 0.06, 0.3, d1 - d0, C.woodDk);
        A.box(pierX + s * headW / 2, top - 0.15, zOf((d1 + dH) / 2), 0.06, 0.3, dH - d1, C.woodDk);
      }
      A.box(pierX, top - 0.15, headZ1, headW, 0.3, 0.06, C.woodDk);
      // entry: a step up off the berm onto the deck
      const sy = sandYd(pierX, d0 - 0.6);
      A.box(pierX, (sy + top - 0.17) / 2, zOf(d0 - 0.55), pw - 0.6, top - 0.17 - sy + 0.1, 0.9, C.deck[2]);
      platform(pierX - (pw - 0.6) / 2, pierX + (pw - 0.6) / 2, zOf(d0 - 1.0), zOf(d0 - 0.1), top - 0.12);
      platform(pierX - pw / 2, pierX + pw / 2, z1, z0, top);
      platform(pierX - headW / 2, pierX + headW / 2, headZ1, z1, top);
      // pile bents every 4 m: round piles into the bed, a cap beam, x-bracing
      for (let d = d0 + 1.5; d <= dH - 0.3; d += 4.0) {
        const hw = (d >= d1 ? headW : pw) / 2 - 0.25, z = zOf(d);
        const xs = d >= d1 ? [-hw, -hw / 2, 0, hw / 2, hw] : [-hw, 0, hw];
        const bedY = Math.min(sandYd(pierX, d), SEA - 0.2) - 0.6;
        for (const ox of xs) A.cyl(pierX + ox, bedY, z, 0.17, 0.19, top - 0.2 - bedY, 8, C.woodDk);
        A.box(pierX, top - 0.3, z, hw * 2 + 0.6, 0.24, 0.3, C.woodDk);
        if (bedY < SEA - 0.5) {
          A.rod(pierX - hw, SEA - 0.2, z, pierX + hw, top - 0.4, z, 0.05, 5, C.woodDk);
          A.rod(pierX + hw, SEA - 0.2, z, pierX - hw, top - 0.4, z, 0.05, 5, C.woodDk);
        }
      }
      for (const ox of [-1.6, 0, 1.6]) A.box(pierX + ox, top - 0.2, zOf((d0 + dH) / 2), 0.15, 0.2, dH - d0, C.woodDk);  // stringers
      // railings: the walkway sides, the head's west side, its seaward end, and
      // the east side with an opening where the dock's gangway lands
      const rail = function (xa, za, xb, zb) {
        const L = Math.hypot(xb - xa, zb - za), n = Math.max(1, Math.round(L / 2.0));
        for (let k = 0; k <= n; k++) A.box(xa + (xb - xa) * k / n, top + 0.52, za + (zb - za) * k / n, 0.12, 1.05, 0.12, C.wood);
        const mx = (xa + xb) / 2, mz = (za + zb) / 2, along = Math.abs(xb - xa) > Math.abs(zb - za);
        A.box(mx, top + 1.06, mz, along ? L + 0.12 : 0.16, 0.07, along ? 0.16 : L + 0.12, C.wood);
        for (const ry of [0.38, 0.72]) A.box(mx, top + ry, mz, along ? L : 0.05, 0.08, along ? 0.05 : L, C.wood);
        CBZ.colliders.push({ minX: Math.min(xa, xb) - 0.12, maxX: Math.max(xa, xb) + 0.12, minZ: Math.min(za, zb) - 0.12, maxZ: Math.max(za, zb) + 0.12, ref: REF, y0: top, y1: top + 1.0, noCam: true, noBreach: true });
      };
      for (const s of [-1, 1]) rail(pierX + s * (pw / 2 - 0.08), z0 - 0.4, pierX + s * (pw / 2 - 0.08), z1);
      const hx = headW / 2 - 0.08, GW_Z = headZ1 + 3.0;
      rail(pierX - hx, z1 - 0.1, pierX - hx, headZ1 + 0.1);
      rail(pierX - hx, headZ1 + 0.1, pierX + hx, headZ1 + 0.1);
      rail(pierX + hx, z1 - 0.1, pierX + hx, GW_Z + 1.3);
      rail(pierX + hx, GW_Z - 1.3, pierX + hx, headZ1 + 0.1);
      rail(pierX - pw / 2 + 0.08, z1 - 0.08, pierX - hx, z1 - 0.08);
      rail(pierX + pw / 2 - 0.08, z1 - 0.08, pierX + hx, z1 - 0.08);
      // lamps down the walkway (unlit standards: no extra lights in the scene)
      for (let d = d0 + 6; d < dH; d += 12) {
        const lz = zOf(d), lx = pierX - pw / 2 + 0.2;
        A.cyl(lx, top, lz, 0.05, 0.07, 3.4, 8, C.black);
        A.box(lx, top + 3.55, lz, 0.32, 0.36, 0.32, C.black);
        A.box(lx, top + 3.52, lz, 0.26, 0.26, 0.26, lin(0xf3ecd2));
      }
      // benches on the head, facing the open water
      bench(pierX - 2.2, top, headZ1 + 4.8, Math.PI, 2.0);
      // two rods leaning on the head rail mark real fishing stations
      for (const rx of [pierX - headW / 2 + 1.2, pierX + headW / 2 - 2.0]) {
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.025, 2.6, 5), cmat(0x2a2f36));
        rod.position.set(rx, top + 1.2, headZ1 + 0.7); rod.rotation.x = -0.5; rod.castShadow = false;
        rod.userData.beach = "rod";
        root.add(rod);
        anglerSpots.push({ x: rx, z: headZ1 + 1.5, face: Math.PI, y: top });
        if (CBZ.fishSpotRegister) {
          CBZ.fishSpotRegister(rx, headZ1 + 1.5, {
            name: "Pier Head", face: Math.PI, y: top, rod: false,
            water: { x: rx, z: headZ1 - 6 },
          });
        }
      }
    })();

    // =====================================================================
    //  10b) THE FLOATING DOCK + ITS GANGWAY (systems/platforms_moving.js)
    //  Their walk surfaces live in the parents' LOCAL frames so they stay
    //  correct while the raft heaves on CBZ.waterRideAt. Freeboard is
    //  load-bearing: the deck sits 1.50 above the ride surface so swim.js's
    //  1.08 m wade band can never close on it.
    // =====================================================================
    (function floatingDock() {
      if (!CBZ.movingPlatform) return;
      const PIER_TOP = 0.85, headW = 9.4, headZ1 = (ES - 36) - 8;
      const GW_Z = headZ1 + 3.0;
      const HINGE_X = pierX + headW / 2 - 0.25;
      const DOCK_X = pierX + headW / 2 + 8.3;
      const DOCK_Z = GW_Z;
      const DECK_TOP = 1.50;
      const DW = 7.0, DD = 5.0;
      const LAND_IN = 2.9;
      const GW_W = 1.7;
      const GW_L = (DOCK_X - LAND_IN - HINGE_X) + 1.4;
      const WOOD_A = 0x9a7b52, WOOD_B = 0x8a6d47, WOOD_DK = 0x5e4a30;

      const dockGrp = new THREE.Group();
      dockGrp.position.set(DOCK_X, SEA, DOCK_Z);
      dockGrp.userData.dynamic = true;
      root.add(dockGrp);
      function part(parent, x, y, z, w, h, d, col, cast) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), cmat(col));
        m.position.set(x, y, z); m.castShadow = !!cast; m.receiveShadow = true;
        parent.add(m); return m;
      }
      part(dockGrp, 0, 0.05, 0, DW + 0.2, 1.30, DD + 0.2, 0x6f6a60);
      part(dockGrp, 0, 0.72, 0, DW + 0.3, 0.10, DD + 0.3, 0x2e3238);
      for (let ix = -1; ix <= 1; ix += 2) for (let iz = -1; iz <= 1; iz += 2)
        part(dockGrp, ix * 2.9, 1.05, iz * 2.1, 0.26, 0.72, 0.26, WOOD_DK);
      part(dockGrp, 0, 1.42, 0, DW, 0.16, DD, WOOD_A, true);
      for (const sz of [-1, 1]) part(dockGrp, 0, 1.95, sz * 2.56, DW, 0.90, 0.12, 0xd9d2bd);

      const gwGrp = new THREE.Group();
      gwGrp.userData.dynamic = true;
      root.add(gwGrp);
      part(gwGrp, 0, -0.05, 0, GW_L, 0.10, GW_W, WOOD_B);
      for (const sz of [-1, 1]) {
        part(gwGrp, 0, 0.52, sz * 0.85, GW_L, 0.08, 0.08, 0xe8ebee);
        for (let i = 0; i < 5; i++)
          part(gwGrp, -GW_L / 2 + (i + 0.5) * (GW_L / 5), 0.26, sz * 0.85, 0.07, 0.55, 0.07, 0xe8ebee);
      }
      const dockRig = CBZ.movingPlatform(dockGrp, {
        id: "beach-floating-dock",
        decks: [{ x: 0, z: 0, w: DW, d: DD, top: DECK_TOP }],
        walls: [
          { x: 0, z: -2.56, w: DW, d: 0.12, y0: DECK_TOP, y1: DECK_TOP + 0.9 },
          { x: 0, z: 2.56, w: DW, d: 0.12, y0: DECK_TOP, y1: DECK_TOP + 0.9 },
        ],
      });
      const gwRig = CBZ.movingPlatform(gwGrp, {
        id: "beach-dock-gangway",
        decks: [{ x: 0, z: 0, w: GW_L, d: GW_W, top: 0 }],
        walls: [
          { x: 0, z: -0.9, w: GW_L, d: 0.10, y0: 0, y1: 1.0 },
          { x: 0, z: 0.9, w: GW_L, d: 0.10, y0: 0, y1: 1.0 },
        ],
      });
      dock = {
        grp: dockGrp, gw: gwGrp, rig: dockRig, gwRig: gwRig,
        x: DOCK_X, z: DOCK_Z, deckTop: DECK_TOP, len: DW + 0.2, beam: DD + 0.2,
        hingeX: HINGE_X, hingeY: PIER_TOP, gwZ: GW_Z, landIn: LAND_IN,
        ride: { y: 0, pitch: 0, roll: 0 },
      };
    })();

    // ---- the structure mesh: everything above, one draw call -------------
    structMesh = A.build("beach-structures", structMat);
    if (BSIG && !BAKE && CBZ.bakePut && bakeOut.pos && bakeOut.gm) {
      try {
        const SA = structMesh ? A.arrays(structMesh.geometry) : { p: new Float32Array(0), n: new Float32Array(0), c: new Float32Array(0), i: new Uint16Array(0), s: new Float32Array(4) };
        CBZ.bakePut("city-beach", BSIG, { w: Wtab, pos: bakeOut.pos, col: bakeOut.col, sh: bakeOut.sh, nrm: bakeOut.nrm, idx: bakeOut.idx,
          sp: SA.p, sn: SA.n, sc: SA.c, si: SA.i, ss: SA.s, gm: bakeOut.gm || new Float32Array(0), gc: bakeOut.gc || new Float32Array(0) });
      } catch (e) { /* a full disk is a miss next time, never a broken beach */ }
    }
    if (structMesh) {
      structMesh.castShadow = true; structMesh.receiveShadow = true;
      root.add(structMesh);
      REF.userData.mesh = structMesh;
    }

    /* =====================================================================
       11) THE WEST QUAY PARKING LOT — two real double-loaded modules (ULI
       2.74 x 5.49 stalls, 7.32 m aisle) north and south of the military
       causeway's mouth, so beach traffic has somewhere to leave a car.
       ===================================================================== */
    const beachBays = [];
    (function parking() {
      const STALL_W = 2.74, STALL_D = 5.49, AISLE = 7.32;
      const MODULE = STALL_D * 2 + AISLE;
      const x1 = minX - 4.5, x0 = x1 - MODULE;
      const rowCx = [x0 + STALL_D / 2, x1 - STALL_D / 2];
      const _MILW = (CBZ.worldOff && CBZ.worldOff("military")) || { dx: 0, dz: 0 };
      const wgz = cz + _MILW.dz, GAP = 16;
      const P = new Acc();
      const stripe = lin(0xd8dce0), kerb = lin(0xb4b8bc);
      function block(z0, z1) {
        const n = Math.floor((z1 - z0) / STALL_W);
        if (n < 4) return;
        const zBase = z0 + ((z1 - z0) - n * STALL_W) / 2;
        for (let r = 0; r < 2; r++) {
          for (let i = 0; i <= n; i++) P.box(rowCx[r], 0.03, zBase + i * STALL_W, STALL_D, 0.012, 0.2, stripe);
          const kx = r === 0 ? x0 + 0.07 : x1 - 0.07;
          P.box(kx, 0.07, (zBase + zBase + n * STALL_W) / 2, 0.14, 0.14, n * STALL_W, kerb);
          for (let i = 0; i < n; i++) beachBays.push({ x: rowCx[r], z: zBase + (i + 0.5) * STALL_W });
        }
        P.box((x0 + x1) / 2, 0.03, (zBase + zBase + n * STALL_W) / 2, 0.18, 0.012, n * STALL_W, stripe);
      }
      block(cz - 88, wgz - GAP);
      block(wgz + GAP, cz + 88);
      const pm = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
      pm.name = "beach-parking-paint";
      const m = P.build("beach-parking", pm);
      if (m) { m.receiveShadow = true; root.add(m); }
    })();
    if (CBZ.onUpdate && beachBays.length) {
      let beachParked = false;
      CBZ.onUpdate(55.3, function () {
        if (beachParked) return;
        if (!CBZ.cityMakeCar || !CBZ.cityEcon || !CBZ.cityEcon.CARS || !CBZ.city || !CBZ.city.arena) return;
        beachParked = true;
        const CARS = CBZ.cityEcon.CARS;
        if (!CARS.length) return;
        const n = Math.min(16, Math.max(1, Math.round(beachBays.length * 0.22)));
        const stride = Math.max(1, Math.floor(beachBays.length / n));
        for (let k = 0, i = (rng() * stride) | 0; k < n && i < beachBays.length; k++, i += stride) {
          const s = beachBays[i];
          try {
            // heading PI/2 = nose along +x, the axis these stalls run on
            const c = CBZ.cityMakeCar(s.x, s.z, Math.PI / 2, false, CARS[(rng() * CARS.length) | 0], 0);
            if (c) { c.ai = false; c.v = 0; c.baseV = 0; c.road = null; }
          } catch (e) { /* no vehicle path in this build — the stalls stay empty */ }
        }
      });
    }

    // =====================================================================
    //  12) THE PEOPLE WHO WORK THE BEACH (city/citystaff.js posts ordinary
    //  peds when you are near enough to see them; propuse seats the guards)
    // =====================================================================
    if (CBZ.cityStaffPost && CBZ.cityStaffVenue) {
      CBZ.cityStaffVenue("beach", { stations: lifeguardSpots.length + stallSpots.length + anglerSpots.length, note: "2 lifeguard towers, concession + 2 stalls, 2 rods" });
      lifeguardSpots.forEach(function (L, i) {
        CBZ.cityStaffPost({
          venue: "beach", id: i ? "beach:lifeguard:" + i : "beach:lifeguard", job: "lifeguard", archetype: "worker",
          x: L.post.x, z: L.post.z, face: L.post.face,
          seat: function () { return L.seat; },
          opts: { outfit: 0xc23434, wealth: 0.35, aggr: 0.1 },
        });
      });
      stallSpots.forEach(function (s, i) {
        CBZ.cityStaffPost({
          venue: "beach", id: "beach:vendor:" + i, job: "street vendor", archetype: "merchant",
          x: s.x, z: s.z, face: s.face, pose: "table",
          opts: { wealth: 0.4, floorY: s.floorY },
        });
      });
      anglerSpots.forEach(function (s, i) {
        CBZ.cityStaffPost({
          venue: "beach", id: "beach:angler:" + i, job: "fisherman", archetype: "laborer",
          x: s.x, z: s.z, face: s.face, pose: "table",
          opts: { wealth: 0.28, floorY: s.y },
          after: function (ped) { if (CBZ.fishWorkRod) CBZ.fishWorkRod(ped, s); },
        });
      });
    }

    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  };

  // the drawn bed under the shallows, for swim.js's wading model
  CBZ.cityBeachBedY = function (x, z) { return PROF ? PROF.bed(x, z) : null; };

  // =========================================================================
  //  THE SAND SHADER (MeshStandardMaterial + chunks)
  // =========================================================================
  const SAND_U = {
    uBSea: { value: -0.48 }, uBRunShift: { value: 0 }, uBTime: { value: 0 },
    uBShallow: { value: new THREE.Vector3(0.10, 0.36, 0.34) },
  };
  const NOISE_GLSL = [
    "float bHash( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }",
    "float bNoise( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );",
    "  return mix( mix( bHash( i ), bHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( bHash( i + vec2( 0.0, 1.0 ) ), bHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y ); }",
  ].join("\n");
  function sandMaterial() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.95, metalness: 0, envMapIntensity: 0.55 });
    mat.name = "beach-dry-sand";
    mat.extensions = { derivatives: true };
    // the sand always owns the 3.5 cm it floats over the harbour apron
    mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -2;
    mat.onBeforeCompile = function (sh) {
      const vs = sh.vertexShader, fs = sh.fragmentShader;
      if (vs.indexOf("#include <project_vertex>") < 0 || fs.indexOf("#include <color_fragment>") < 0 ||
          fs.indexOf("#include <roughnessmap_fragment>") < 0 || fs.indexOf("#include <normal_fragment_maps>") < 0) return;
      Object.assign(sh.uniforms, SAND_U);
      sh.vertexShader = vs
        .replace("#include <common>", "#include <common>\nattribute float aShore;\nattribute vec4 aSw;\nvarying float vBShore;\nvarying vec4 vBSw;\nvarying vec3 vBW;")
        .replace("#include <project_vertex>", "#include <project_vertex>\nvBShore = aShore; vBSw = aSw;\nvBW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;");
      sh.fragmentShader = fs
        .replace("#include <common>", "#include <common>\nvarying float vBShore;\nvarying vec4 vBSw;\nvarying vec3 vBW;\n" +
          "uniform float uBSea;\nuniform float uBRunShift;\nuniform float uBTime;\nuniform vec3 uBShallow;\n" + NOISE_GLSL + "\n" +
          "vec3 bPerturb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float fd ) {\n" +
          "  vec3 vSigmaX = vec3( dFdx( surf_pos.x ), dFdx( surf_pos.y ), dFdx( surf_pos.z ) );\n" +
          "  vec3 vSigmaY = vec3( dFdy( surf_pos.x ), dFdy( surf_pos.y ), dFdy( surf_pos.z ) );\n" +
          "  vec3 R1 = cross( vSigmaY, surf_norm ); vec3 R2 = cross( surf_norm, vSigmaX );\n" +
          "  float fDet = dot( vSigmaX, R1 ) * fd;\n" +
          "  vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );\n" +
          "  return normalize( abs( fDet ) * surf_norm - vGrad ); }\n")
        .replace("#include <color_fragment>", "#include <color_fragment>\n" + SAND_MAIN)
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = bRough;")
        .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\n" +
          "normal = bPerturb( - vViewPosition, normal, vec2( dFdx( bH ), dFdy( bH ) ) * bBumpK, faceDirection );");
    };
    mat.customProgramCacheKey = function () { return "cbzBeachSand2"; };
    if (CBZ.terrainFogScale) CBZ.terrainFogScale(mat, 0.10);
    return mat;
  }
  const SAND_MAIN = [
    "float bRough = 0.95; float bH = 0.0; float bBumpK = 0.0;",
    "{",
    "  vec2 xz = vBW.xz;",
    "  float dl = vBShore - uBRunShift;                  // metres inland of the waterline",
    "  float run = vBSw.x, vel = vBSw.y, wl = vBSw.z, fl = vBSw.w;",
    "  float dist = length( vViewPosition );",
    // the swash film (covered now), recently covered, the damp zone below the high-water mark
    "  float film = 1.0 - smoothstep( run - 0.12, run + 0.30, dl );",
    "  float glisten = 1.0 - smoothstep( wl - 0.15, wl + 0.9, dl );",
    "  float nD = bNoise( xz * 0.45 + 3.1 );",
    "  float damp = 1.0 - smoothstep( 5.2 + nD * 1.2, 8.2 + nD * 1.4, dl );",
    "  vec3 dry = diffuseColor.rgb;",
    "  vec3 dampC = dry * vec3( 0.60, 0.575, 0.53 );",
    "  vec3 c = mix( dry, dampC, max( damp * 0.88, glisten ) );",
    "  c = mix( c, dampC * vec3( 0.80, 0.82, 0.86 ), film );",
    // faint swash lines: the marks each spent run-up leaves on the damp face
    "  float sl = smoothstep( 0.82, 0.98, sin( dl * 7.0 + bNoise( xz * 0.35 ) * 9.0 ) ) * damp * ( 1.0 - glisten );",
    "  c *= 1.0 - 0.10 * sl;",
    // foam: the advancing front, the froth behind it, the bubble line it leaves
    "  float lace = smoothstep( 0.30, 0.78, bNoise( xz * 2.6 + vec2( uBTime * 0.15, -uBTime * 0.1 ) ) * 0.65 + bNoise( xz * 7.0 ) * 0.35 );",
    "  float adv = smoothstep( -0.15, 0.55, vel );",
    "  float front = ( 1.0 - smoothstep( 0.0, 0.42, abs( dl - run - 0.08 ) ) ) * ( 0.35 + 0.65 * adv );",
    "  float froth = film * smoothstep( run - 2.2, run, dl ) * adv * 0.55;",
    "  float bub = ( 1.0 - smoothstep( 0.0, 0.14, abs( dl - fl ) ) ) * ( 1.0 - smoothstep( 0.4, 3.5, fl - run ) ) * step( run + 0.25, fl );",
    "  float foam = clamp( max( max( front, froth ), bub * 0.8 ) * lace * 1.25, 0.0, 1.0 ) * step( -0.5, dl );",
    "  c = mix( c, vec3( 0.80, 0.82, 0.82 ), foam );",
    // dry sand: grain mottle, wind ripples, churned footprints (bump, faded with distance)
    "  float dryK = ( 1.0 - max( damp, glisten ) );",
    "  float mott = bNoise( xz * 3.1 ) * 0.5 + bNoise( xz * 11.0 ) * 0.5;",
    "  c *= 1.0 + ( mott - 0.5 ) * 0.10 * dryK;",
    "  float rip = sin( dot( xz, vec2( 0.42, 0.91 ) ) * 52.0 + bNoise( xz * 0.6 ) * 14.0 );",
    "  vec2 cell = floor( xz / 0.42 ); vec2 fr = fract( xz / 0.42 ) - 0.5;",
    "  float pr = bHash( cell + 17.0 );",
    "  vec2 off = vec2( bHash( cell + 3.0 ), bHash( cell + 9.0 ) ) - 0.5;",
    "  float ang = bHash( cell + 23.0 ) * 6.2832; vec2 dir = vec2( cos( ang ), sin( ang ) );",
    "  vec2 q = fr - off * 0.4; vec2 qq = vec2( dot( q, dir ), dot( q, vec2( -dir.y, dir.x ) ) );",
    "  float foot = ( 1.0 - smoothstep( 0.6, 1.0, length( qq / vec2( 0.14, 0.06 ) ) ) ) * step( 0.42, pr );",
    "  float churn = smoothstep( 9.5, 12.5, dl ) * ( 0.55 + 0.45 * bNoise( xz * 0.15 ) );",
    "  foot *= churn;",
    "  c *= 1.0 - 0.07 * foot * dryK;",
    "  float nearK = 1.0 - smoothstep( 6.0, 32.0, dist );",
    "  bH = ( rip * 0.010 * ( 1.0 - churn * 0.7 ) - foot * 0.035 ) * dryK;",
    "  bBumpK = nearK;",
    // the light: dry sand is matte, damp sand smoother, the film a mirror
    "  bRough = mix( 0.95, 0.72, damp );",
    "  bRough = mix( bRough, 0.30, glisten );",
    "  bRough = mix( bRough, 0.06, film * ( 1.0 - foam ) );",
    "  bRough = mix( bRough, 0.65, foam );",
    // under the sea surface: the shallows go turquoise and darken with depth
    "  float depth = uBSea - vBW.y;",
    "  if ( depth > 0.0 ) {",
    "    float k = smoothstep( 0.0, 0.5, depth );",
    "    c = mix( c, uBShallow * ( 0.85 + 0.3 * bNoise( xz * 0.8 + uBTime * 0.05 ) ), k * 0.55 ) * exp( -depth * 0.32 );",
    "    bRough = mix( bRough, 0.5, k );",
    "  }",
    "  diffuseColor.rgb = c;",
    "}",
  ].join("\n");

  // =========================================================================
  //  THE SURF SHADER (lit Lambert, alpha from travelling foam bands)
  // =========================================================================
  const SURF_U = { uFTime: { value: 0 } };
  function surfMaterial() {
    const mat = new THREE.MeshLambertMaterial({ color: 0xe9f0f0, transparent: true, depthWrite: false, opacity: 1 });
    mat.name = "beach-surf-foam";
    mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -4;
    mat.onBeforeCompile = function (sh) {
      if (sh.vertexShader.indexOf("#include <project_vertex>") < 0 || sh.fragmentShader.indexOf("#include <color_fragment>") < 0) return;
      Object.assign(sh.uniforms, SURF_U);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float aOff;\nattribute vec2 aRun;\nvarying float vFOff;\nvarying vec2 vFRun;\nvarying vec3 vFW;")
        .replace("#include <project_vertex>", "#include <project_vertex>\nvFOff = aOff; vFRun = aRun;\nvFW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vFOff;\nvarying vec2 vFRun;\nvarying vec3 vFW;\nuniform float uFTime;\n" + NOISE_GLSL)
        .replace("#include <color_fragment>", "#include <color_fragment>\n" + [
          "{",
          "  vec2 p = vFW.xz; float off = vFOff; float t = uFTime;",
          "  float ph0 = dot( p, vec2( 0.0031, 0.0047 ) ) * 1.7;",
          "  float n1 = bNoise( p * 0.5 + vec2( t * 0.06, -t * 0.09 ) );",
          "  float n2 = bNoise( p * 1.6 - vec2( t * 0.11, t * 0.05 ) );",
          "  float n3 = bNoise( p * 4.3 + vec2( t * 0.2, 0.0 ) );",
          // two sets of bores rolling in: thin and bright offshore, spreading thin near shore
          "  float a = 0.0;",
          "  for ( int k = 0; k < 2; k++ ) {",
          "    float ph = fract( t / 8.5 + ph0 + float( k ) * 0.53 );",
          "    float c0 = 15.5 * ( 1.0 - ph ) + 0.4;",
          "    float w = 0.5 + 2.6 * ph;",
          "    float b = 1.0 - smoothstep( 0.0, w, abs( off - c0 - w * 0.45 ) );",
          "    b *= smoothstep( 0.0, 0.12, ph ) * ( 1.0 - 0.45 * ph ) * ( k == 0 ? 1.0 : 0.65 );",
          "    a = max( a, b );",
          "  }",
          "  a *= smoothstep( 0.25, 0.7, n1 * 0.6 + n2 * 0.4 + 0.12 );",
          // the inner surf zone: broken white water, brightest as a run-up starts
          "  float inner = ( 1.0 - smoothstep( 0.0, 5.0, off ) ) * ( 0.30 + 0.7 * smoothstep( -0.2, 0.7, vFRun.y ) );",
          "  a = max( a, inner * smoothstep( 0.35, 0.8, n2 * 0.55 + n3 * 0.45 ) );",
          "  a *= 1.0 - smoothstep( 13.5, 16.5, off );",
          "  a *= smoothstep( -1.2, -0.3, off );",
          "  diffuseColor.a = clamp( a, 0.0, 1.0 ) * 0.88;",
          "  diffuseColor.rgb *= 0.92 + 0.12 * n3;",
          "}",
        ].join("\n"));
    };
    mat.customProgramCacheKey = function () { return "cbzBeachSurf1"; };
    return mat;
  }

  // =========================================================================
  //  THE LOOT LOOP — [E] rifles a full cooler/bag for cash. Petty theft if
  //  witnessed (the existing chokepoint decides), restocks after minutes.
  // =========================================================================
  function LOOT_FULL()  { return cmat(0x2e6a8e, { emissive: 0x4caf6e, ei: 0.18 }); }
  function LOOT_EMPTY() { return cmat(0x24323c, { emissive: 0x000000, ei: 0 }); }
  function BAG_FULL()   { return cmat(0x7a4a8a, { emissive: 0xffb347, ei: 0.18 }); }
  function BAG_EMPTY()  { return cmat(0x4a3354, { emissive: 0x000000, ei: 0 }); }
  function setLook(L, full) {
    L.body.material = full ? (L.bag ? BAG_FULL() : LOOT_FULL()) : (L.bag ? BAG_EMPTY() : LOOT_EMPTY());
  }
  function byHand(key, x, y, z, kind, fn) {
    const V = CBZ.verbs;
    if (V && V.pickup && CBZ.player) V.pickup(CBZ.player, { x: x, y: y, z: z, kind: kind }, { key: key, pose: kind === "cash" ? "card" : "grip", onTaken: fn });
    else fn();
  }
  function rifle(L) {
    L.looted = true;
    L.t = RESPAWN * (0.8 + Math.random() * 0.6);
    setLook(L, false);
    const cash = 40 + ((Math.random() * 120) | 0) + (L.bag ? 30 : 0);
    CBZ.city.addCash(cash);
    if (CBZ.sfx) CBZ.sfx("coin");
    CBZ.city.note("Rifled the " + (L.bag ? "beach bag" : "cooler") + ". $" + cash + ".", 2.2);
    if (CBZ.cityCrime) CBZ.cityCrime(20, { type: "theft", x: L.x, z: L.z });
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  function lootNear() {
    const P = CBZ.player; if (!P) return null;
    for (const L of loot) {
      if (L.looted) continue;
      if (Math.abs(P.pos.y - L.body.position.y) > 1.6) continue;
      if (Math.hypot(P.pos.x - L.x, P.pos.z - L.z) <= REACH) return L;
    }
    return null;
  }

  // =========================================================================
  //  THE SUNBATHERS — ordinary peds posted onto the furniture and towels
  // =========================================================================
  let peopled = false;
  const SUNBATHERS_MAX = 7;
  function populate() {
    if (peopled) return;
    if (!chairs.length || !CBZ.cityPostNpc || !CBZ.cityPeds || !CBZ.propSit) return;
    peopled = true;
    let n = 0;
    for (let i = 0; i < chairs.length && n < SUNBATHERS_MAX; i++) {
      const c = chairs[i], rec = c.rec;
      if (!rec || rec.occupant) continue;
      if (CBZ.hash01 && CBZ.hash01(rec.x, rec.z, 0xb3ac) > 0.62) continue;   // some are simply empty
      const ped = CBZ.cityPostNpc(rec.x, rec.z, { archetype: "tourist", job: "tourist", src: "beach:sunbather" });
      if (!ped) continue;
      const took = c.lie
        ? (CBZ.propSleep && CBZ.propSleep(ped, rec, { instant: true }))
        : CBZ.propSit(ped, rec, { instant: true });
      if (!took) { if (CBZ.cityUnpostNpc) CBZ.cityUnpostNpc(ped); continue; }
      n++;
    }
  }

  CBZ.onUpdate(36.9, function (dt) {
    if (g.mode !== "city" || !built) return;
    populate();
    for (const L of loot) {
      if (!L.looted) continue;
      L.t -= dt;
      if (L.t <= 0) { L.looted = false; setLook(L, true); }
    }
  });

  let zoned = false;
  CBZ.onUpdate(99.64, function () {
    if (zoned || !CBZ.interactions || !CBZ.interactions.registerZone) return;
    zoned = true;
    CBZ.interactions.describe("beachbag", function () { return { label: "Somebody's things", note: "" }; });
    CBZ.interactions.registerZone({
      id: "zone-beachbag", kind: "beachbag", prio: 11,
      find: function () { return (built && g.mode === "city") ? lootNear() : null; },
      options: [{
        id: "beachbag-rifle", slot: "e", bad: true,
        label: "Go through",
        onSelect: function (L) {
          if (!L || L.looted || L._taking) return;
          L._taking = true;
          const y = (CBZ.player && CBZ.player.pos ? CBZ.player.pos.y || 0 : 0) + 0.25;
          byHand(L, L.x, y, L.z, "cash", function () { L._taking = false; if (!L.looted) rifle(L); });
        },
      }],
    });
  });

  // =========================================================================
  //  THE DOCK TICK — 9.4: the raft moves, 9.5 platforms_moving carries its
  //  riders, 10 updatePlayer resolves them. All in one frame, in that order.
  // =========================================================================
  const DOCK_SWAY = 0.085, DOCK_SURGE = 0.45;
  CBZ.onUpdate(9.4, function () {
    const D = dock;
    if (!D || g.mode !== "city") return;
    const t = CBZ.waterClock ? CBZ.waterClock() : 0;
    const yaw = Math.sin(t * 0.13) * DOCK_SWAY;
    const px = D.x + Math.sin(t * 0.09) * DOCK_SURGE;
    const pz = D.z + Math.cos(t * 0.071) * (DOCK_SURGE * 0.6);
    let y, pitch = 0, roll = 0;
    if (CBZ.waterRideAt) {
      const r = CBZ.waterRideAt(px, pz, { heading: yaw, len: D.len, beam: D.beam, t: t }, D.ride) || D.ride;
      y = r.y; pitch = r.pitch || 0; roll = r.roll || 0;
    } else {
      y = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(px, pz) : (CBZ.SEA_Y != null ? CBZ.SEA_Y : -0.48);
    }
    if (!(y === y)) return;
    D.grp.position.set(px, y, pz);
    D.grp.rotation.set(pitch, yaw, roll);
    const landX = px - D.landIn;
    const landY = y + D.deckTop;
    const run = Math.max(0.5, landX - D.hingeX);
    D.gw.position.set((D.hingeX + landX) / 2, (D.hingeY + landY) / 2, D.gwZ);
    D.gw.rotation.set(0, 0, Math.atan((landY - D.hingeY) / run));
  });

  // =========================================================================
  //  THE SWASH + SURF TICK — on the always chain behind the sea's own clock
  //  (93 / 93.5), so the beach keeps moving while paused like the sea does.
  //  Per column: the shared run-up (CBZ.waterSwashPair), a wet line that
  //  dries back slowly, and the bubble line the last big run-up left. Only
  //  the swash rows' slice of the attribute is uploaded.
  // =========================================================================
  const DRY_RATE = 0.16;        // m/s the wet line retreats down the face
  const BUBBLE_CREEP = 0.06;    // m/s the bubble line slides back
  const RANGE_M = 300;          // beyond this the beach is not worth a frame
  CBZ.onAlways(93.7, function (dt) {
    const S = sand;
    if (!S || g.mode !== "city" || !S.mesh.parent) return;
    const P = CBZ.player;
    const far = P && Math.hypot(P.pos.x - S.cx, P.pos.z - S.cz) > RANGE_M;
    const t = CBZ.waterClock ? CBZ.waterClock() : 0;
    SAND_U.uBTime.value = t; SURF_U.uFTime.value = t;
    const seaY = CBZ.waterSeaY ? CBZ.waterSeaY() : (CBZ.SEA_Y != null ? CBZ.SEA_Y : -0.48);
    SAND_U.uBSea.value = seaY;
    // a surge (storm tide, tsunami drawdown) walks the waterline up the face
    const surge = CBZ.waterSurge ? (+CBZ.waterSurge() || 0) : 0;
    SAND_U.uBRunShift.value = surge * 12.0;
    if (far || !S.live) return;
    const NC = S.nc, arr = S.arr, pr = S.pair;
    const dtc = Math.min(0.1, Math.max(0, dt || 0));
    for (let i = 0; i < NC; i++) {
      CBZ.waterSwashPair(S.colX[i], S.colZW[i], t, pr);
      const run = pr.s > 0 ? pr.s : 0, vel = pr.v;
      let wl = S.wl[i] - DRY_RATE * dtc; if (run > wl) wl = run; S.wl[i] = wl;
      let fl = S.fl[i] - BUBBLE_CREEP * dtc; if (run > fl) fl = run; if (fl < 0) fl = 0; S.fl[i] = fl;
      for (let j = S.r0; j <= S.r1; j++) {
        const k = (j * NC + i) * 4;
        arr[k] = run; arr[k + 1] = vel; arr[k + 2] = wl; arr[k + 3] = fl;
      }
    }
    S.attr.updateRange.offset = S.r0 * NC * 4;
    S.attr.updateRange.count = (S.r1 - S.r0 + 1) * NC * 4;
    S.attr.needsUpdate = true;

    // ---- the surf ribbon rides the live swell
    const F = surf;
    if (!F || !CBZ.citySeaHeightAt) return;
    const pos = F.pos.array, ra = F.run.array, nc = F.nc, nr = F.nr, SM = F.sample, hs = F.hs;
    for (let i = 0; i < nc; i++) {
      const x = F.xs[i], zs = F.zs[i];
      for (let s = 0; s < 3; s++) {
        let h = +CBZ.citySeaHeightAt(x, zs[SM[s]]);
        if (!Number.isFinite(h)) h = seaY;
        hs[i * 3 + s] = h;
      }
      CBZ.waterSwashPair(x, zs[1], t, pr);
      for (let j = 0; j < nr; j++) {
        let h;
        if (j <= SM[0]) h = hs[i * 3];
        else if (j <= SM[1]) h = hs[i * 3] + (hs[i * 3 + 1] - hs[i * 3]) * (j - SM[0]) / (SM[1] - SM[0]);
        else h = hs[i * 3 + 1] + (hs[i * 3 + 2] - hs[i * 3 + 1]) * (j - SM[1]) / (SM[2] - SM[1]);
        const k = j * nc + i;
        pos[k * 3 + 1] = h + 0.035;
        ra[k * 2] = pr.s > 0 ? pr.s : 0; ra[k * 2 + 1] = pr.v;
      }
    }
    F.pos.needsUpdate = true; F.run.needsUpdate = true;
  });

  // ---- PUBLIC --------------------------------------------------------------
  CBZ.cityBeachLoot = function () { return loot; };
  CBZ.cityBeachPalms = function () { return palmField; };
  // usable beach furniture: counts ANCHORS (a lounger with no propuse rec
  // behind it would be a prop pretending to be furniture). Towels are beds.
  CBZ.cityBeachSeats = function () {
    let lie = 0, sit = 0, taken = 0;
    for (let i = 0; i < chairs.length; i++) {
      const c = chairs[i];
      if (c.lie) lie++; else sit++;
      if (c.rec && c.rec.occupant) taken++;
    }
    return { loungers: lie, deckchairs: sit, occupied: taken };
  };
  CBZ.cityBeachLootReset = function () {
    for (const L of loot) { L.looted = false; L.t = 0; setLook(L, true); }
  };

  /* ================================================================
     WHAT A BEACH WEARS (Shark Sim's crowd, 2026-09-27).

     men    bare-chested in board shorts or trunks (most), a rash guard, or
            a T-shirt over the shorts
     women  a one-piece, a two-piece (top + bottoms, bare midriff), a rash
            guard over bottoms, or a T-shirt over the swimsuit
     all    bare arms and legs below the suit, BARE FEET (the shoe box is
            skin), and a straw sun hat or a cap on about a quarter of them.

     Every piece is a colour on a box the rig already has, so a dressed body
     costs exactly the draw calls an undressed one did. Deterministic: every
     choice is a draw from the caller's own stream `r`. Returns null outside
     Shark Sim, so Natural Disaster (which shares this crowd) keeps its
     street clothes. No sand, khaki, cream or white in the suits: on a box
     body at thirty metres a skin-toned swimsuit reads as no swimsuit.
     ================================================================ */
  const SWIM = [0x1f3a68, 0x13161c, 0xc8322f, 0xf0674f, 0x1fa7a8, 0x2b63c6,
                0x0f7c6e, 0xf28c28, 0xf2c230, 0xd94f86, 0x6c7a3a, 0x8a4fb8,
                0x35b0e8, 0x7b1f2e];
  const GUARD = [0x13161c, 0x1f3a68, 0xeae6dc, 0x1fa7a8, 0x2b63c6, 0x9fd13c, 0xd94f86];
  const TEE = [0xf2f0ea, 0xb9bec6, 0x9cc4e4, 0xf3e3a0, 0xf2b8c6, 0x9fd4b0, 0x3c4450];
  const HATS = [0xe6d3a3, 0xd9c18c, 0xf2f0ea, 0x1f3a68];
  const CAPS = [0xc8322f, 0x1f3a68, 0xf2f0ea, 0x13161c, 0x1fa7a8, 0xf28c28];
  const pk = (a, u) => a[(u * a.length) | 0];

  CBZ.beachSwimwear = function (r, skin, hairs) {
    if (!(CBZ.game && CBZ.game.mode === "sharksim")) return null;
    const fem = r() < 0.5;
    const look = r();
    const suit = pk(SWIM, r());
    const alt = r() < 0.35 ? pk(SWIM, r()) : suit;
    const hatU = r(), hatC = r();
    const c = {
      build: fem ? "f" : "m", skin: skin, hair: pk(hairs, r()),
      longHair: fem && hatC < 0.6,
      arms: skin, collar: skin, torso: skin, waist: skin,
      legs: skin, pelvis: skin, shins: skin, shoes: skin,
    };
    let wear;
    if (!fem) {
      c.pelvis = c.legs = suit;
      if (look < 0.58) wear = look < 0.36 ? "board shorts" : "swim trunks";
      else if (look < 0.78) { c.torso = c.waist = c.collar = c.arms = pk(GUARD, hatC); wear = "rash guard + board shorts"; }
      else { c.torso = c.waist = c.collar = c.arms = pk(TEE, hatC); c.shortSleeve = true; wear = "T-shirt over trunks"; }
    } else if (look < 0.36) {
      c.torso = c.waist = c.pelvis = suit; wear = "one-piece";
    } else if (look < 0.70) {
      c.torso = suit; c.pelvis = alt; wear = "two-piece";
    } else if (look < 0.85) {
      c.torso = c.waist = c.collar = c.arms = pk(GUARD, hatC); c.pelvis = c.legs = suit; wear = "rash guard + board shorts";
    } else {
      c.torso = c.waist = c.collar = c.arms = pk(TEE, hatC); c.shortSleeve = true; c.pelvis = suit; wear = "T-shirt over swimsuit";
    }
    if (hatU < 0.14) { c.hat = "sun"; c.hatColor = pk(HATS, hatC); wear += " + sun hat"; }
    else if (hatU < 0.26) { c.hat = "cap"; c.hatColor = pk(CAPS, hatC); wear += " + cap"; }
    c.cloth = c.torso !== skin ? c.torso : suit;
    c.wear = wear;
    return c;
  };
})();
