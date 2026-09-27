/* ============================================================
   systems/debris.js — REAL DEBRIS. One fracture path for every game.

   THE LAW (owner, 2026-09-27): "I hate big cubes of fake debris. Make debris
   realer, all from the prop itself." Debris comes FROM THE THING THAT BROKE:
   its own triangles, its own material, its own UVs and paint. Nothing in this
   file invents a stand-in box.

   HOW
   1. GATHER. The source (any Object3D, or a world-space box + material, or a
      raw geometry) is read in WORLD space as a triangle soup carrying
      position / normal / uv / color / material-slot. Each mesh is a convex
      COMPONENT (every primitive three builds is convex); a merged geometry is
      split into welded connected components (a crate's planks come apart
      plank by plank because they were separate solids all along).
   2. FRACTURE. Each component is cut into Voronoi cells: every cell is the
      source solid clipped by the bisector half-spaces to its neighbours, and
      every cut is CLOSED with a cap polygon (convex solid => convex section).
      The outside faces of a piece are the source's own faces with the source
      UVs — the brick texture, the paint, the window mullion continue across
      the break. The cap faces are the INSIDE of the material: raw concrete,
      brick core, pale fresh wood, glass edge. Sites follow the material:
        concrete  — isotropic chunks, denser (smaller) around the impact
        brick     — flattened cells: stepped course-like blocks
        glass     — concentric ring sites around the impact: radial shards
        wood      — cells stretched along the grain: splinters and planks
        metal     — few cuts, pieces bent; poles SNAP at the hit height and
                    the stump stays standing
        foliage   — a few clumps plus a shower of leaf flecks
      Small components are not cut (a wheel, a lamp head, a bolt) — they
      come off whole, which is what small solid parts do.
   3. SIMULATE. Each piece is a rigid body: real gravity, a mass from its own
      volume x density, an isotropic inertia from its own extents, contact
      impulses at its own hull vertices against the floor (CBZ.floorAt),
      collider tops and a rubble height-field (pieces PILE on pieces), with
      restitution + Coulomb friction per material. A slab tips about its
      contact edge because the impulse is applied where it touches.
   4. FREEZE. A piece that has been still for a moment is baked (world
      transform applied) into a merged static mesh per (cell, material) —
      rubble that costs one draw call per material per 16 m cell and zero
      CPU. Live bodies are capped per device (the iPad gets fewer at once,
      never uglier ones); overflow freezes the oldest resting piece first.
   5. GRIT + DUST. Small chips (irregular convex hulls, instanced, coloured
      per chip from the source) and a pooled soft-dust cloud in the source's
      colour: brick dust is red, plaster white, dirt brown, leaves green.

   PUBLIC API (CBZ.debris)
     shatter(source, opts)        -> {pieces, grit}   the main entry
         source: Object3D | {box:{minX,maxX,minY,maxY,minZ,maxZ}, material}
                 | {geometry, matrixWorld?, material}
         opts.at {x,y,z}          impact point (smaller, faster pieces there)
         opts.dir {x,y,z}         push direction (blast normal / car velocity)
         opts.power  0.3..3       how violent (default 1)
         opts.kind                'concrete'|'brick'|'glass'|'wood'|'metal'|
                                  'foliage'|'plastic'|'rubber'|'rock'|'dirt'
                                  (auto from each material when omitted)
         opts.maxPieces           budget for this call (device-capped)
         opts.size                target piece size in metres (per kind default)
         opts.hide                hide the source Object3D (default true)
         opts.owner               tag; clear(owner) removes its rubble
         opts.dust / opts.grit    false to suppress; number to scale
         opts.snap                force pole-snap (true) / forbid it (false)
         opts.anchorStump         keep a snapped pole's base standing (default true)
         opts.solid               settled big pieces register colliders
     chips(x, y, z, opts)         grit + dust only, for a hit with no source
                                  solid (bullet on a wall, blast on asphalt).
                                  opts {kind, color, count, dir, power, dust}
     dust(x, y, z, opts)          a colour-matched dust cloud {color, kind, power, radius}
     kindOf(material)             the kind this file would infer
     tag(object, kind)            declare an object's material kind
     clear(owner?)                remove live + frozen debris (all, or one owner)
     clearNear(x, z, r)           haul off every piece within r (a crew clearing a lot)
     pile(o) / adopt(obj, o)      settled rubble mound / hand a whole part to the sim
     chunkGeo(i)                  shared irregular chunk geometry for authored scenery rubble
     stats()                      live/static/grit counts for audits
   Everything is headless-safe and never throws into a caller.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  // ---- seeded LCG (replay/MP determinism, same idiom as crashfx.js) --------
  let _rs = 60613;
  function rng() { _rs = (_rs * 1103515245 + 12345) & 0x7fffffff; return _rs / 0x7fffffff; }
  function rr(a, b) { return a + (b - a) * rng(); }

  const DEVICE = CBZ.deviceClass || "desktop";
  const PHONE = DEVICE === "phone", TABLET = DEVICE === "tablet";
  // Live rigid bodies at once. Pieces freeze fast, so this is a burst budget.
  const LIVE_CAP = PHONE ? 36 : TABLET ? 64 : 140;
  // Frozen pieces kept as merged rubble (oldest, farthest evicted first).
  const STATIC_CAP = PHONE ? 500 : TABLET ? 900 : 2400;
  const GRIT_CAP = PHONE ? 180 : TABLET ? 300 : 600;      // chips, all variants
  const DUST_CAP = PHONE ? 260 : TABLET ? 420 : 800;       // dust motes
  const PER_CALL_CAP = PHONE ? 14 : TABLET ? 22 : 40;      // pieces per shatter
  const G = 9.81;
  const CELL = 16;                                         // static bucket size (m)
  const HF = 0.3;                                          // rubble height-field cell (m)

  /* ---- MATERIAL KINDS -----------------------------------------------------
     density kg/m3, size = target piece diameter (m), e = restitution,
     mu = friction, core = the colour of the inside of the material, coreMix =
     how much the inside ignores the paint, dust/grit colours, drag = air. */
  const KINDS = {
    concrete: { density: 2400, size: 0.62, e: 0.16, mu: 0.8, core: 0x9d998f, coreMix: 0.7, dust: 0xb3ada2, grit: 0x8c877e, drag: 0.02, gritN: 16 },
    brick:    { density: 1900, size: 0.42, e: 0.14, mu: 0.85, core: 0xa35a3c, coreMix: 0.45, dust: 0xb88467, grit: 0x93503a, drag: 0.02, gritN: 20, flat: 2.1 },
    glass:    { density: 2500, size: 0.26, e: 0.12, mu: 0.35, core: 0xbfe0dc, coreMix: 0.0, dust: 0xdfe8ea, grit: 0xcfe6ea, drag: 0.35, gritN: 26, glass: true },
    wood:     { density: 650,  size: 0.5,  e: 0.3,  mu: 0.6, core: 0xd2ad74, coreMix: 0.65, dust: 0xbfa17a, grit: 0xb08a58, drag: 0.08, gritN: 14, grain: 0.28 },
    metal:    { density: 2700, size: 1.1,  e: 0.28, mu: 0.45, core: 0x8e9196, coreMix: 0.35, dust: 0x8a847a, grit: 0x5d6066, drag: 0.03, gritN: 6, bend: true },
    foliage:  { density: 380,  size: 0.7,  e: 0.08, mu: 0.9, core: 0x4f6a2e, coreMix: 0.3, dust: 0x6f8048, grit: 0x5d7a31, drag: 0.9, gritN: 30, leaves: true },
    plastic:  { density: 1100, size: 0.5,  e: 0.35, mu: 0.5, core: null, coreMix: 0.1, dust: 0xa8a8a0, grit: null, drag: 0.1, gritN: 6 },
    rubber:   { density: 1200, size: 9,    e: 0.45, mu: 0.9, core: 0x222222, coreMix: 0.2, dust: 0x77726a, grit: 0x2a2a2a, drag: 0.03, gritN: 0 },
    rock:     { density: 2600, size: 0.7,  e: 0.18, mu: 0.8, core: 0x8b8378, coreMix: 0.5, dust: 0xa39684, grit: 0x7d7568, drag: 0.02, gritN: 14 },
    dirt:     { density: 1500, size: 0.35, e: 0.05, mu: 0.95, core: 0x6f5a41, coreMix: 0.5, dust: 0x8c7658, grit: 0x5e4a35, drag: 0.05, gritN: 22 },
    asphalt:  { density: 2300, size: 0.45, e: 0.14, mu: 0.85, core: 0x3b3b3b, coreMix: 0.5, dust: 0x7c776e, grit: 0x2f2f30, drag: 0.02, gritN: 18 },
  };
  function K(kind) { return KINDS[kind] || KINDS.concrete; }

  const _c = new THREE.Color(), _c2 = new THREE.Color();
  function matColor(mat, out) {
    out = out || _c;
    if (mat && mat.color) out.copy(mat.color); else out.setRGB(0.6, 0.6, 0.6);
    return out;
  }
  /* What is this material made of? An explicit tag wins; then names; then the
     physical tells (see-through => glass, metalness => metal); then colour.
     Default is concrete — the city is mostly concrete. */
  function kindOf(mat, obj) {
    if (Array.isArray(mat)) mat = mat[0];
    const tagO = obj && obj.userData && obj.userData.debrisKind;
    if (tagO) return tagO;
    if (!mat) return "concrete";
    if (mat.userData && mat.userData.debrisKind) return mat.userData.debrisKind;
    const nm = ((mat.name || "") + " " + ((obj && obj.name) || "")).toLowerCase();
    if (/glass|window|pane|windshield|mirror/.test(nm)) return "glass";
    if (/brick/.test(nm)) return "brick";
    if (/wood|plank|timber|crate|fence|bark|trunk|log|pallet/.test(nm)) return "wood";
    if (/leaf|leaves|foliage|canopy|bush|hedge|grass/.test(nm)) return "foliage";
    if (/tire|tyre|rubber/.test(nm)) return "rubber";
    if (/metal|steel|iron|chrome|alumin|pole|lamp|sign|rail/.test(nm)) return "metal";
    if (/plastic|cone|bin/.test(nm)) return "plastic";
    if (/rock|stone|boulder/.test(nm)) return "rock";
    if (mat.transparent && mat.opacity < 0.9) return "glass";
    if (mat.metalness != null && mat.metalness > 0.45) return "metal";
    const c = matColor(mat, _c2), hsl = {};
    c.getHSL(hsl);
    // saturated green = plant; warm mid red-brown = brick; saturated warm
    // yellow-brown = wood. Everything grey-ish stays concrete.
    if (hsl.s > 0.25 && hsl.h > 0.18 && hsl.h < 0.45 && hsl.l < 0.55) return "foliage";
    if (hsl.s > 0.3 && (hsl.h < 0.045 || hsl.h > 0.97) && hsl.l > 0.2 && hsl.l < 0.55) return "brick";
    if (hsl.s > 0.3 && hsl.h >= 0.05 && hsl.h < 0.12 && hsl.l > 0.2 && hsl.l < 0.6) return "wood";
    return "concrete";
  }

  /* ---- shared materials ----------------------------------------------------
     CORE: the inside of every broken solid. One material for all kinds — the
     per-vertex colour carries the kind (raw concrete, brick core, fresh wood)
     and a small grain texture keeps a fracture face from reading as plastic. */
  let _coreMat = null;
  function coreMat() {
    if (_coreMat) return _coreMat;
    let map = null;
    try {
      const S = 64, cv = document.createElement("canvas"); cv.width = cv.height = S;
      const x = cv.getContext("2d"), img = x.createImageData(S, S);
      for (let i = 0; i < S * S; i++) {
        const v = 200 + ((rng() * 55) | 0) - (rng() < 0.08 ? 60 : 0);
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
      }
      x.putImageData(img, 0, 0);
      map = new THREE.CanvasTexture(cv);
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
    } catch (e) { map = null; }
    _coreMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, map });
    _coreMat.name = "debrisCore"; _coreMat._shared = true;
    return _coreMat;
  }
  // flat (zero-thickness) sources need both faces once they tumble
  const _dsCache = new WeakMap();
  function doubleSided(mat) {
    if (!mat || mat.side === THREE.DoubleSide) return mat;
    let m = _dsCache.get(mat);
    if (!m) { m = mat.clone(); m.side = THREE.DoubleSide; m._shared = true; _dsCache.set(mat, m); }
    return m;
  }

  /* ================= 1. GATHER ============================================ */
  // Triangle soup, stride S: px py pz | nx ny nz | u v | r g b | slot
  const S = 12;
  const CONVEX_TYPES = /^(Box|Cylinder|Cone|Sphere|Icosahedron|Dodecahedron|Octahedron|Tetrahedron|Capsule|Polyhedron)(Buffer)?Geometry$/;
  const _m4 = new THREE.Matrix4(), _n3 = new THREE.Matrix3(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

  // One mesh's triangles, world space, split by material group.
  function meshTris(geo, matrix, mats, slotOf, out) {
    const pos = geo.attributes.position; if (!pos) return;
    const nrm = geo.attributes.normal, uv = geo.attributes.uv, col = geo.attributes.color;
    const idx = geo.index;
    _n3.getNormalMatrix(matrix);
    const count = idx ? idx.count : pos.count;
    const groups = geo.groups && geo.groups.length ? geo.groups : [{ start: 0, count, materialIndex: 0 }];
    for (const g of groups) {
      const mat = Array.isArray(mats) ? mats[g.materialIndex || 0] : mats;
      if (!mat || mat.visible === false) continue;
      const slot = slotOf(mat);
      const end = Math.min(count, g.start + g.count);
      for (let k = g.start; k + 2 < end + 0 && k + 2 < count; k += 3) {
        for (let j = 0; j < 3; j++) {
          const i = idx ? idx.getX(k + j) : k + j;
          _v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
          out.push(_v.x, _v.y, _v.z);
          if (nrm) { _v2.fromBufferAttribute(nrm, i).applyMatrix3(_n3).normalize(); out.push(_v2.x, _v2.y, _v2.z); }
          else out.push(0, 1, 0);
          if (uv) out.push(uv.getX(i), uv.getY(i)); else out.push(0, 0);
          if (col) out.push(col.getX(i), col.getY(i), col.getZ(i)); else out.push(1, 1, 1);
          out.push(slot);
        }
      }
    }
  }
  // Recompute flat normals where the source had none.
  function fixNormals(t) {
    for (let i = 0; i < t.length; i += 3 * S) {
      if (t[i + 3] !== 0 || t[i + 4] !== 1 || t[i + 5] !== 0) continue;
      const ax = t[i + S] - t[i], ay = t[i + S + 1] - t[i + 1], az = t[i + S + 2] - t[i + 2];
      const bx = t[i + 2 * S] - t[i], by = t[i + 2 * S + 1] - t[i + 1], bz = t[i + 2 * S + 2] - t[i + 2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      for (let j = 0; j < 3; j++) { t[i + j * S + 3] = nx; t[i + j * S + 4] = ny; t[i + j * S + 5] = nz; }
    }
  }
  // Split a soup into welded connected components (union-find on positions).
  function components(t) {
    const nt = t.length / (3 * S);
    if (nt <= 12) return [t];
    const parent = new Int32Array(nt); for (let i = 0; i < nt; i++) parent[i] = i;
    const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    const owner = new Map();
    for (let tri = 0; tri < nt; tri++) for (let j = 0; j < 3; j++) {
      const o = (tri * 3 + j) * S;
      const key = Math.round(t[o] * 500) + "," + Math.round(t[o + 1] * 500) + "," + Math.round(t[o + 2] * 500);
      const prev = owner.get(key);
      if (prev == null) owner.set(key, tri);
      else { const a = find(prev), b = find(tri); if (a !== b) parent[a] = b; }
    }
    const byRoot = new Map();
    for (let tri = 0; tri < nt; tri++) {
      const r = find(tri); let arr = byRoot.get(r);
      if (!arr) { arr = []; byRoot.set(r, arr); }
      const o = tri * 3 * S;
      for (let k = 0; k < 3 * S; k++) arr.push(t[o + k]);
    }
    return Array.from(byRoot.values());
  }
  // A world-space box as a solid with world-metre UVs (masonry tiles repeat
  // at CBZ.masonryTile, so the brick coursing continues across the pieces).
  function boxTris(b, slot, out, tile) {
    const tu = (tile && tile.u) || 1, tv = (tile && tile.v) || 1;
    const x0 = b.minX, x1 = b.maxX, y0 = b.minY, y1 = b.maxY, z0 = b.minZ, z1 = b.maxZ;
    const quad = (p, n, uvOf) => {
      const ord = [0, 1, 2, 0, 2, 3];
      for (const i of ord) {
        const q = p[i], uv = uvOf(q);
        out.push(q[0], q[1], q[2], n[0], n[1], n[2], uv[0], uv[1], 1, 1, 1, slot);
      }
    };
    const uX = (q) => [q[2] / tu, q[1] / tv], uZ = (q) => [q[0] / tu, q[1] / tv], uY = (q) => [q[0] / tu, q[2] / tu];
    quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], uX);
    quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], uX);
    quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], uY);
    quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], uY);
    quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], uZ);
    quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], uZ);
  }

  /* ================= 2. FRACTURE ========================================== */
  // Clip a closed convex triangle soup by the half-space n.p <= off and close
  // the cut. Cap faces get the core slot, the plane normal, planar UVs and the
  // core colour.
  const _poly = [], _cap = [];
  function lerpInto(t, a, b, s, dst) {
    for (let k = 0; k < S; k++) dst.push(t[a + k] + (t[b + k] - t[a + k]) * s);
    dst[dst.length - 1] = t[a + S - 1];      // slot is not interpolated
  }
  function clipSolid(t, nx, ny, nz, off, cap) {
    const out = [];
    _cap.length = 0;
    const eps = 1e-6;
    for (let i = 0; i < t.length; i += 3 * S) {
      const d0 = nx * t[i] + ny * t[i + 1] + nz * t[i + 2] - off;
      const d1 = nx * t[i + S] + ny * t[i + S + 1] + nz * t[i + S + 2] - off;
      const d2 = nx * t[i + 2 * S] + ny * t[i + 2 * S + 1] + nz * t[i + 2 * S + 2] - off;
      if (d0 <= eps && d1 <= eps && d2 <= eps) { for (let k = 0; k < 3 * S; k++) out.push(t[i + k]); continue; }
      if (d0 > -eps && d1 > -eps && d2 > -eps) continue;
      // Sutherland-Hodgman on the triangle
      _poly.length = 0;
      const d = [d0, d1, d2];
      for (let j = 0; j < 3; j++) {
        const a = i + j * S, b = i + ((j + 1) % 3) * S, da = d[j], db = d[(j + 1) % 3];
        if (da <= eps) for (let k = 0; k < S; k++) _poly.push(t[a + k]);
        if ((da < -eps && db > eps) || (da > eps && db < -eps)) {
          const s = da / (da - db);
          const at = _poly.length;
          lerpInto(t, a, b, s, _poly);
          _cap.push(_poly[at], _poly[at + 1], _poly[at + 2]);
        } else if (Math.abs(da) <= eps) _cap.push(t[a], t[a + 1], t[a + 2]);
      }
      const nv = _poly.length / S;
      for (let j = 1; j + 1 < nv; j++) {
        for (const q of [0, j, j + 1]) for (let k = 0; k < S; k++) out.push(_poly[q * S + k]);
      }
    }
    if (cap && _cap.length >= 9) addCap(out, nx, ny, nz, cap);
    return out;
  }
  // Convex cap polygon over the section points, wound to face +n.
  function addCap(out, nx, ny, nz, cap) {
    // basis t1,t2 with t1 x t2 = n
    let ax = Math.abs(nx) < 0.9 ? 1 : 0, ay = ax ? 0 : 1, az = 0;
    let t1x = ay * nz - az * ny, t1y = az * nx - ax * nz, t1z = ax * ny - ay * nx;
    const l1 = Math.hypot(t1x, t1y, t1z) || 1; t1x /= l1; t1y /= l1; t1z /= l1;
    const t2x = ny * t1z - nz * t1y, t2y = nz * t1x - nx * t1z, t2z = nx * t1y - ny * t1x;
    const pts = [];
    for (let i = 0; i < _cap.length; i += 3) {
      const x = _cap[i], y = _cap[i + 1], z = _cap[i + 2];
      pts.push({ u: x * t1x + y * t1y + z * t1z, v: x * t2x + y * t2y + z * t2z, x, y, z });
    }
    pts.sort((a, b) => a.u - b.u || a.v - b.v);
    const uniq = [];
    for (const p of pts) { const q = uniq[uniq.length - 1]; if (!q || Math.abs(p.u - q.u) > 1e-5 || Math.abs(p.v - q.v) > 1e-5) uniq.push(p); }
    if (uniq.length < 3) return;
    const cr = (o, a, b) => (a.u - o.u) * (b.v - o.v) - (a.v - o.v) * (b.u - o.u);
    const lower = [], upper = [];
    for (const p of uniq) { while (lower.length >= 2 && cr(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-10) lower.pop(); lower.push(p); }
    for (let i = uniq.length - 1; i >= 0; i--) { const p = uniq[i]; while (upper.length >= 2 && cr(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-10) upper.pop(); upper.push(p); }
    lower.pop(); upper.pop();
    const hull = lower.concat(upper);
    if (hull.length < 3) return;
    let area = 0;
    for (let i = 1; i + 1 < hull.length; i++) area += cr(hull[0], hull[i], hull[i + 1]);
    if (area < 1e-7) return;
    const uvK = 1 / 0.45;                       // core grain: one tile per 45 cm
    const push = (p) => {
      const j = cap.jitter ? 1 + (rng() - 0.5) * cap.jitter : 1;
      out.push(p.x, p.y, p.z, nx, ny, nz, p.u * uvK, p.v * uvK,
        Math.min(1, cap.r * j), Math.min(1, cap.g * j), Math.min(1, cap.b * j), cap.slot);
    };
    for (let i = 1; i + 1 < hull.length; i++) { push(hull[0]); push(hull[i]); push(hull[i + 1]); }
  }
  function soupBounds(t) {
    const b = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
    for (let i = 0; i < t.length; i += S) {
      const x = t[i], y = t[i + 1], z = t[i + 2];
      if (x < b.minX) b.minX = x; if (x > b.maxX) b.maxX = x;
      if (y < b.minY) b.minY = y; if (y > b.maxY) b.maxY = y;
      if (z < b.minZ) b.minZ = z; if (z > b.maxZ) b.maxZ = z;
    }
    return b;
  }
  // signed volume + centroid of a closed soup
  function volumeOf(t) {
    let V = 0, cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < t.length; i += 3 * S) {
      const ax = t[i], ay = t[i + 1], az = t[i + 2];
      const bx = t[i + S], by = t[i + S + 1], bz = t[i + S + 2];
      const qx = t[i + 2 * S], qy = t[i + 2 * S + 1], qz = t[i + 2 * S + 2];
      const v = (ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx)) / 6;
      V += v; cx += v * (ax + bx + qx) / 4; cy += v * (ay + by + qy) / 4; cz += v * (az + bz + qz) / 4;
    }
    if (Math.abs(V) < 1e-9) return { V: 0, cx: 0, cy: 0, cz: 0 };
    return { V: Math.abs(V), cx: cx / V, cy: cy / V, cz: cz / V };
  }

  /* Voronoi sites for one component. Returned with the anisotropic metric
     (kx,ky,kz) the bisectors are taken in: stretched along a wood grain,
     flattened for brick coursing. */
  function sitesFor(b, kind, n, at, o) {
    const ex = b.maxX - b.minX, ey = b.maxY - b.minY, ez = b.maxZ - b.minZ;
    const k = K(kind);
    let kx = 1, ky = 1, kz = 1;
    if (k.grain) {                              // wood: long cells along the longest axis
      const L = Math.max(ex, ey, ez);
      if (L === ex) kx = k.grain; else if (L === ey) ky = k.grain; else kz = k.grain;
    }
    if (k.flat) ky = k.flat;                    // brick: cells wider than tall
    const sites = [];
    const inside = (x, y, z) => x > b.minX && x < b.maxX && y > b.minY && y < b.maxY && z > b.minZ && z < b.maxZ;
    const hit = at && inside(Math.min(b.maxX - 1e-3, Math.max(b.minX + 1e-3, at.x)), Math.min(b.maxY - 1e-3, Math.max(b.minY + 1e-3, at.y)), Math.min(b.maxZ - 1e-3, Math.max(b.minZ + 1e-3, at.z)))
      ? { x: Math.min(b.maxX - 1e-3, Math.max(b.minX + 1e-3, at.x)), y: Math.min(b.maxY - 1e-3, Math.max(b.minY + 1e-3, at.y)), z: Math.min(b.maxZ - 1e-3, Math.max(b.minZ + 1e-3, at.z)) }
      : null;
    if (k.glass && hit) {
      // radial + concentric: a star of wedge shards around the strike
      sites.push([hit.x, hit.y, hit.z]);
      const thin = ex < ez ? 0 : 2;             // pane normal axis (x or z); y is never a pane normal here
      const span = Math.max(ex, ey, ez);
      let ring = 1, left = n - 1;
      while (left > 0) {
        const r = span * 0.09 * ring * ring * 0.6 + span * 0.06 * ring;
        const m = Math.min(left, 5 + ring * 3);
        const a0 = rng() * 6.283;
        for (let i = 0; i < m; i++) {
          const a = a0 + (i + rr(-0.25, 0.25)) * 6.283 / m;
          const du = Math.cos(a) * r, dv = Math.sin(a) * r;
          const p = thin === 0 ? [hit.x, hit.y + dv, hit.z + du] : [hit.x + du, hit.y + dv, hit.z];
          if (inside(p[0], p[1], p[2])) sites.push(p);
        }
        left -= m; ring++;
        if (ring > 6) break;
      }
    } else {
      for (let i = 0; i < n; i++) {
        let x = rr(b.minX, b.maxX), y = rr(b.minY, b.maxY), z = rr(b.minZ, b.maxZ);
        // half the sites crowd toward the impact: small fast pieces there,
        // big slabs further out — how a struck solid actually breaks
        if (hit && rng() < 0.5) {
          const f = Math.pow(rng(), 1.6);
          x = hit.x + (x - hit.x) * f; y = hit.y + (y - hit.y) * f; z = hit.z + (z - hit.z) * f;
        }
        sites.push([x, y, z]);
      }
    }
    return { sites, kx, ky, kz };
  }

  // Cut one convex component into cells. Returns [{t, V, cx, cy, cz}]
  function fractureComponent(t, kind, n, at, o, cap) {
    const b = soupBounds(t);
    const { sites, kx, ky, kz } = sitesFor(b, kind, n, at, o);
    if (sites.length < 2) return null;
    const kx2 = kx * kx, ky2 = ky * ky, kz2 = kz * kz;
    const cells = [];
    for (let i = 0; i < sites.length; i++) {
      const a = sites[i];
      // nearest neighbours first: they bound the cell, so later planes are
      // usually no-ops (cheap rejects)
      const order = [];
      for (let j = 0; j < sites.length; j++) if (j !== i) {
        const q = sites[j];
        order.push([j, (q[0] - a[0]) ** 2 * kx2 + (q[1] - a[1]) ** 2 * ky2 + (q[2] - a[2]) ** 2 * kz2]);
      }
      order.sort((p, q) => p[1] - q[1]);
      let cell = t;
      const lim = Math.min(order.length, 18);
      for (let oi = 0; oi < lim && cell.length; oi++) {
        const q = sites[order[oi][0]];
        // bisector of a,q in the scaled metric: n.p = off, keep side nearer a
        let nx = (q[0] - a[0]) * kx2, ny = (q[1] - a[1]) * ky2, nz = (q[2] - a[2]) * kz2;
        let off = ((q[0] * q[0] - a[0] * a[0]) * kx2 + (q[1] * q[1] - a[1] * a[1]) * ky2 + (q[2] * q[2] - a[2] * a[2]) * kz2) / 2;
        const l = Math.hypot(nx, ny, nz); if (l < 1e-9) continue;
        nx /= l; ny /= l; nz /= l; off /= l;
        cell = clipSolid(cell, nx, ny, nz, off, cap);
      }
      if (cell.length < 4 * 3 * S) continue;
      const vol = volumeOf(cell);
      if (vol.V < 2e-6) continue;
      cells.push({ t: cell, V: vol.V, cx: vol.cx, cy: vol.cy, cz: vol.cz });
    }
    return cells;
  }
  // Pole snap: cut an elongated component across its long axis at the hit.
  function snapComponent(t, at, kind, cap, b) {
    const ex = b.maxX - b.minX, ey = b.maxY - b.minY, ez = b.maxZ - b.minZ;
    const L = Math.max(ex, ey, ez);
    const axis = L === ey ? 1 : (L === ex ? 0 : 2);
    const lo = axis === 0 ? b.minX : axis === 1 ? b.minY : b.minZ;
    const hitV = at ? (axis === 0 ? at.x : axis === 1 ? at.y : at.z) : lo + L * 0.35;
    const s = Math.max(lo + L * 0.12, Math.min(lo + L * 0.8, hitV));
    // a snapped member tears at an angle, not a saw cut
    const tilt = kind === "wood" ? 0.55 : 0.25;
    const n = [0, 0, 0]; n[axis] = 1;
    const o1 = (axis + 1) % 3, o2 = (axis + 2) % 3;
    n[o1] = rr(-tilt, tilt); n[o2] = rr(-tilt, tilt);
    const l = Math.hypot(n[0], n[1], n[2]); n[0] /= l; n[1] /= l; n[2] /= l;
    const c = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2]; c[axis] = s;
    const off = n[0] * c[0] + n[1] * c[1] + n[2] * c[2];
    const lower = clipSolid(t, n[0], n[1], n[2], off, cap);
    const upper = clipSolid(t, -n[0], -n[1], -n[2], -off, cap);
    const res = [];
    for (const part of [lower, upper]) {
      if (part.length < 4 * 3 * S) continue;
      const v = volumeOf(part); if (v.V < 1e-7) continue;
      res.push({ t: part, V: v.V, cx: v.cx, cy: v.cy, cz: v.cz, axis, stump: part === lower && axis === 1 });
    }
    return res;
  }
  // Bend a metal piece along its long axis: a sheet or bar that took a blow
  // is curved, not snapped clean.
  function bendCell(cell, amt) {
    const b = soupBounds(cell.t);
    const e = [b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ];
    const L = e.indexOf(Math.max(...e));
    const P = e.indexOf(Math.min(...e)) === L ? (L + 1) % 3 : e.indexOf(Math.min(...e));
    const half = e[L] / 2; if (half < 0.2) return;
    const c = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2];
    const k = amt / half;
    const t = cell.t;
    for (let i = 0; i < t.length; i += S) {
      const s = t[i + L] - c[L];
      t[i + P] += k * s * s * 0.5 * (e[L] > 2 ? 1 : 0.6);
    }
  }

  /* ================= piece build ========================================= */
  function buildPiece(cell, mats, coreSlot) {
    if (!isFinite(cell.cx) || !isFinite(cell.cy) || !isFinite(cell.cz)) { cell.cx = cell.cy = cell.cz = 0; }
    const t = cell.t, cx = cell.cx, cy = cell.cy, cz = cell.cz;
    const nv = t.length / S;
    // order by slot so each material is one contiguous group
    const bySlot = new Map();
    for (let v = 0; v < nv; v += 3) {
      const s = t[v * S + S - 1];
      let arr = bySlot.get(s); if (!arr) { arr = []; bySlot.set(s, arr); }
      arr.push(v);
    }
    const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), U = new Float32Array(nv * 2), C = new Float32Array(nv * 3);
    const geo = new THREE.BufferGeometry();
    const matList = [];
    let w = 0;
    for (const [slot, list] of bySlot) {
      const start = w;
      for (const v0 of list) for (let j = 0; j < 3; j++) {
        const o = (v0 + j) * S;
        P[w * 3] = t[o] - cx; P[w * 3 + 1] = t[o + 1] - cy; P[w * 3 + 2] = t[o + 2] - cz;
        let nx = t[o + 3], ny = t[o + 4], nz = t[o + 5]; const l = Math.hypot(nx, ny, nz) || 1;
        N[w * 3] = nx / l; N[w * 3 + 1] = ny / l; N[w * 3 + 2] = nz / l;
        U[w * 2] = t[o + 6]; U[w * 2 + 1] = t[o + 7];
        C[w * 3] = t[o + 8]; C[w * 3 + 1] = t[o + 9]; C[w * 3 + 2] = t[o + 10];
        w++;
      }
      geo.addGroup(start * 1, (w - start), matList.length);
      matList.push(slot === coreSlot ? coreMat() : mats[slot]);
    }
    for (let i = 0; i < P.length; i++) if (!isFinite(P[i])) return null;
    geo.setAttribute("position", new THREE.BufferAttribute(P, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(N, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(U, 2));
    geo.setAttribute("color", new THREE.BufferAttribute(C, 3));
    let material = matList;
    if (matList.length === 1) { geo.clearGroups(); material = matList[0]; }
    geo.computeBoundingSphere();
    // hull support points (deduped, farthest 28)
    const seen = new Set(), sup = [];
    for (let v = 0; v < nv; v++) {
      const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
      const key = Math.round(x * 100) + "," + Math.round(y * 100) + "," + Math.round(z * 100);
      if (seen.has(key)) continue; seen.add(key); sup.push([x, y, z, x * x + y * y + z * z]);
    }
    sup.sort((a, b) => b[3] - a[3]);
    const n = Math.min(64, sup.length), pts = new Float32Array(n * 3);
    let ex = 0, ey = 0, ez = 0;
    for (let i = 0; i < sup.length; i++) { ex = Math.max(ex, Math.abs(sup[i][0])); ey = Math.max(ey, Math.abs(sup[i][1])); ez = Math.max(ez, Math.abs(sup[i][2])); }
    for (let i = 0; i < n; i++) { pts[i * 3] = sup[i][0]; pts[i * 3 + 1] = sup[i][1]; pts[i * 3 + 2] = sup[i][2]; }
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(cx, cy, cz);
    mesh.userData.debrisPiece = true;
    return { mesh, pts, ext: [ex, ey, ez], radius: Math.sqrt(sup.length ? sup[0][3] : 0.01) };
  }

  /* ================= 3. SIMULATE ========================================= */
  const live = [];                      // rigid bodies in flight / settling
  const hf = new Map();                 // rubble height-field
  function hfKey(x, z) { return Math.floor(x / HF) * 73856093 ^ Math.floor(z / HF) * 19349663; }
  function hfAt(x, z) { const v = hf.get(hfKey(x, z)); return v == null ? -Infinity : v; }
  function floorAt(x, z, fromY) {
    let f = 0;
    try { f = CBZ.floorAt ? CBZ.floorAt(x, z, fromY) : (CBZ.groundAt ? CBZ.groundAt(x, z) : 0); } catch (e) { f = 0; }
    return isFinite(f) ? f : 0;
  }
  const _cols = [];
  const _q = new THREE.Quaternion(), _wq = new THREE.Quaternion(), _mm = new THREE.Matrix4(), _one = new THREE.Vector3(1, 1, 1);

  function addBody(piece, o, k, kind, V) {
    const scene = o.root || CBZ.scene;
    if (!scene) return null;
    scene.add(piece.mesh);
    const mass = Math.max(0.05, V * k.density);
    const [ex, ey, ez] = piece.ext;
    const I = mass * ((2 * ex) ** 2 + (2 * ey) ** 2 + (2 * ez) ** 2) / 18;
    const body = {
      mesh: piece.mesh, pts: piece.pts, radius: piece.radius, ext: piece.ext,
      v: new THREE.Vector3(), w: new THREE.Vector3(),
      invM: 1 / mass, invI: 1 / Math.max(1e-4, I), mass, V,
      e: k.e, mu: k.mu, drag: k.drag, kind, t: 0, quiet: 0,
      owner: o.owner || null, solid: !!o.solid, maxLife: o.maxLife || 7,
      ignore: null, px: piece.mesh.position.x, pz: piece.mesh.position.z, py: piece.mesh.position.y,
      floorT: -1, floorY: 0, contact: false, born: nowT,
    };
    // colliders the piece is born inside (its own wall, being removed this
    // frame) must not trap it
    if (CBZ.queryCollidersNear) {
      try {
        const p = piece.mesh.position;
        for (const c of CBZ.queryCollidersNear(p.x, p.z, 0.2, _cols)) {
          if (inCol(c, p.x, p.y, p.z)) (body.ignore || (body.ignore = new Set())).add(c);
        }
      } catch (e) {}
    }
    live.push(body);
    return body;
  }
  function inCol(c, x, y, z) {
    if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) return false;
    const y0 = c.y0 != null ? c.y0 : -Infinity, y1 = c.y1 != null ? c.y1 : 2.6;
    return y >= y0 && y <= y1;
  }

  let nowT = 0;
  const _cp = new Float32Array(24);
  const _wp = new THREE.Vector3(), _r = new THREE.Vector3(), _vr = new THREE.Vector3(), _tmp = new THREE.Vector3(), _tan = new THREE.Vector3();
  function stepBody(b, dt) {
    const m = b.mesh, p = m.position;
    b.t += dt;
    b.v.y -= G * dt;
    if (b.drag) { const f = Math.max(0, 1 - b.drag * dt); b.v.x *= f; b.v.z *= f; if (b.v.y < 0) b.v.y *= Math.max(0, 1 - b.drag * 0.6 * dt); }
    b.px = p.x; b.py = p.y; b.pz = p.z;
    p.x += b.v.x * dt; p.y += b.v.y * dt; p.z += b.v.z * dt;
    const wl = b.w.length();
    if (wl > 1e-5) {
      _tmp.copy(b.w).divideScalar(wl);
      _q.setFromAxisAngle(_tmp, wl * dt);
      m.quaternion.premultiply(_q);
    }
    // walls: resolve only a face we ENTERED (a piece born in its opening leaves freely)
    if (CBZ.queryCollidersNear && (b.t < 4)) {
      try {
        const cols = CBZ.queryCollidersNear(p.x, p.z, b.radius + 0.1, _cols);
        for (let i = 0; i < cols.length; i++) {
          const c = cols[i];
          if (b.ignore && b.ignore.has(c)) continue;
          if (c.debris) continue;
          if (!inCol(c, p.x, p.y, p.z)) continue;
          if (inCol(c, b.px, b.py, b.pz)) { (b.ignore || (b.ignore = new Set())).add(c); continue; }
          const y1 = c.y1 != null ? c.y1 : 2.6;
          if (b.py >= y1 - 0.02) { p.y = y1 + 0.001; if (b.v.y < 0) b.v.y *= -b.e; continue; }   // landed on top — contact below handles it
          if (b.px < c.minX) { p.x = c.minX - 0.001; b.v.x = -Math.abs(b.v.x) * b.e; }
          else if (b.px > c.maxX) { p.x = c.maxX + 0.001; b.v.x = Math.abs(b.v.x) * b.e; }
          else if (b.pz < c.minZ) { p.z = c.minZ - 0.001; b.v.z = -Math.abs(b.v.z) * b.e; }
          else if (b.pz > c.maxZ) { p.z = c.maxZ + 0.001; b.v.z = Math.abs(b.v.z) * b.e; }
          b.w.multiplyScalar(0.7);
        }
      } catch (e) {}
    }
    // floor under the piece: terrain/floorAt, sampled at 10 Hz per piece
    if (b.floorT < 0 || nowT - b.floorT > 0.1) {
      b.floorY = floorAt(p.x, p.z, p.y + b.radius);
      if (CBZ.queryCollidersNear) {
        try {
          for (const c of CBZ.queryCollidersNear(p.x, p.z, b.radius, _cols)) {
            if (c.y1 == null || c.debris) continue;
            if (b.ignore && b.ignore.has(c)) continue;
            if (p.x < c.minX || p.x > c.maxX || p.z < c.minZ || p.z > c.maxZ) continue;
            if (c.y1 <= p.y + 0.05 && c.y1 > b.floorY) b.floorY = c.y1;
          }
        } catch (e) {}
      }
      b.floorT = nowT;
    }
    // contacts at the hull vertices: sequential impulses per touching vertex
    // (a slab on its face is held by its corners; a piece on one edge tips)
    _mm.compose(p, m.quaternion, _one);
    const E = _mm.elements, pts = b.pts;
    let nC = 0, depth = 0;
    for (let i = 0; i < pts.length; i += 3) {
      const lx = pts[i], ly = pts[i + 1], lz = pts[i + 2];
      const wx = E[0] * lx + E[4] * ly + E[8] * lz + E[12];
      const wy = E[1] * lx + E[5] * ly + E[9] * lz + E[13];
      const wz = E[2] * lx + E[6] * ly + E[10] * lz + E[14];
      let fl = b.floorY;
      const h = hfAt(wx, wz); if (h > fl && h < wy + 0.5) fl = h;
      const d = fl - wy;
      if (d > -0.004 && nC < 8) { _cp[nC * 3] = wx - p.x; _cp[nC * 3 + 1] = wy - p.y; _cp[nC * 3 + 2] = wz - p.z; nC++; if (d > depth) depth = d; }
    }
    b.contact = nC > 0;
    if (nC) {
      let hardest = 0;
      for (let it = 0; it < 4; it++) {
        for (let c = 0; c < nC; c++) {
          _r.set(_cp[c * 3], _cp[c * 3 + 1], _cp[c * 3 + 2]);
          _vr.crossVectors(b.w, _r).add(b.v);
          const vn = _vr.y;
          if (vn >= 0) continue;
          if (it === 0 && -vn > hardest) hardest = -vn;
          const rn2 = _r.x * _r.x + _r.z * _r.z;
          const rest = it === 0 && -vn > 1.5 ? b.e : 0;
          const jn = -(1 + rest) * vn / (b.invM + b.invI * rn2);
          applyImpulse(b, 0, jn, 0);
          _vr.crossVectors(b.w, _r).add(b.v);
          _tan.set(_vr.x, 0, _vr.z);
          const vt = _tan.length();
          if (vt > 1e-6) {
            _tan.divideScalar(vt);
            _tmp.crossVectors(_r, _tan);
            const jt = Math.min(vt / (b.invM + b.invI * _tmp.lengthSq()), b.mu * jn);
            applyImpulse(b, -_tan.x * jt, 0, -_tan.z * jt);
          }
        }
      }
      if (hardest > 3 && b.mass > 4) { _wp.set(p.x + _cp[0], p.y + _cp[1], p.z + _cp[2]); impactFx(b, _wp, hardest); }
      if (depth > 0) p.y += depth;
      // rolling resistance: pieces are not balls; more when lying on 3+ points
      const f = Math.max(0, 1 - (nC >= 3 ? 6 : 2.5) * dt);
      b.w.multiplyScalar(f);
      if (nC >= 3) { const g = Math.max(0, 1 - 1.5 * dt); b.v.x *= g; b.v.z *= g; }
    }
    // sleep test
    const still = b.contact && b.v.lengthSq() < 0.06 && b.w.lengthSq() < 0.2;
    b.quiet = still ? b.quiet + dt : 0;
    if (b.quiet > 0.25) return 1;
    if (b.t > b.maxLife && b.contact) return 1;
    if (b.t > b.maxLife + 5) return 1;
    if (p.y < -60 || !isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z)) return 2;
    return 0;
    function applyImpulse(b, jx, jy, jz) {
      b.v.x += jx * b.invM; b.v.y += jy * b.invM; b.v.z += jz * b.invM;
      // w += invI * (r x j)
      b.w.x += b.invI * (_r.y * jz - _r.z * jy);
      b.w.y += b.invI * (_r.z * jx - _r.x * jz);
      b.w.z += b.invI * (_r.x * jy - _r.y * jx);
    }
  }
  function impactFx(b, pt, speed) {
    if (!b.lastFx || nowT - b.lastFx > 0.4) {
      b.lastFx = nowT;
      const k = K(b.kind);
      if (k.dust != null && speed > 4) dust(pt.x, pt.y, pt.z, { color: k.dust, power: Math.min(1.2, b.mass / 400) * Math.min(1, speed / 10), radius: Math.min(1.5, b.radius) });
    }
  }

  /* ================= 4. FREEZE ============================================ */
  // buckets: key -> {mesh, mat, parts:[{id, P,N,U,C, age, x, z, owner}], dirty}
  const buckets = new Map();
  let staticCount = 0, pieceSeq = 0;
  const dirtyQ = [];
  function bucketKey(owner, x, z, mat) {
    return (owner || "") + "|" + Math.floor(x / CELL) + "," + Math.floor(z / CELL) + "|" + mat.uuid;
  }
  // height-field cells each owner raised, so clear(owner) lowers them again
  const hfOwned = new Map();
  function ownKey(owner, k) { let s = hfOwned.get(owner); if (!s) { s = new Set(); hfOwned.set(owner, s); } s.add(k); }
  function freeze(b) {
    const m = b.mesh, geo = m.geometry;
    // never bake a piece into the ground: lift it by its deepest vertex
    if (!b.anchored) {
      _mm.compose(m.position, m.quaternion, _one);
      const e = _mm.elements, pts = b.pts;
      const fl = floorAt(m.position.x, m.position.z, m.position.y + b.radius);
      let low = Infinity;
      for (let i = 0; i < pts.length; i += 3) {
        const wy = e[1] * pts[i] + e[5] * pts[i + 1] + e[9] * pts[i + 2] + e[13];
        if (wy < low) low = wy;
      }
      if (low < fl) m.position.y += fl - low;
    }
    m.updateMatrix();
    const root = m.parent || CBZ.scene;
    const mw = m.matrix, nm = _n3.getNormalMatrix(mw);
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const groups = geo.groups.length ? geo.groups : [{ start: 0, count: geo.attributes.position.count, materialIndex: 0 }];
    const P = geo.attributes.position.array, N = geo.attributes.normal.array, U = geo.attributes.uv.array, C = geo.attributes.color.array;
    const id = ++pieceSeq;
    const pos = m.position;
    for (const g of groups) {
      const mat = mats[g.materialIndex || 0];
      const n = g.count, p = new Float32Array(n * 3), nn = new Float32Array(n * 3), u = new Float32Array(n * 2), c = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const s = g.start + i;
        _v.set(P[s * 3], P[s * 3 + 1], P[s * 3 + 2]).applyMatrix4(mw);
        p[i * 3] = _v.x; p[i * 3 + 1] = _v.y; p[i * 3 + 2] = _v.z;
        _v.set(N[s * 3], N[s * 3 + 1], N[s * 3 + 2]).applyMatrix3(nm).normalize();
        nn[i * 3] = _v.x; nn[i * 3 + 1] = _v.y; nn[i * 3 + 2] = _v.z;
        u[i * 2] = U[s * 2]; u[i * 2 + 1] = U[s * 2 + 1];
        c[i * 3] = C[s * 3]; c[i * 3 + 1] = C[s * 3 + 1]; c[i * 3 + 2] = C[s * 3 + 2];
      }
      const key = bucketKey(b.owner, pos.x, pos.z, mat);
      let bk = buckets.get(key);
      if (!bk) { bk = { key, mat, root, parts: [], mesh: null, dirty: false, owner: b.owner }; buckets.set(key, bk); }
      bk.parts.push({ id, p, n: nn, u, c, x: pos.x, z: pos.z, t: nowT, perm: !!b.permanent });
      if (!bk.dirty) { bk.dirty = true; dirtyQ.push(bk); }
    }
    // the height-field learns this piece's top so the next one piles on it
    _mm.compose(pos, m.quaternion, _one);
    const e = _mm.elements, pts = b.pts;
    let top = -Infinity;
    for (let i = 0; i < pts.length; i += 3) {
      const lx = pts[i], ly = pts[i + 1], lz = pts[i + 2];
      const wx = e[0] * lx + e[4] * ly + e[8] * lz + e[12];
      const wy = e[1] * lx + e[5] * ly + e[9] * lz + e[13];
      const wz = e[2] * lx + e[6] * ly + e[10] * lz + e[14];
      const k = hfKey(wx, wz); const h = hf.get(k); if (b.owner) ownKey(b.owner, k);
      if (h == null || wy > h) hf.set(k, wy);
      if (wy > top) top = wy;
    }
    // centre column: the top face over the piece's middle
    { const k = hfKey(pos.x, pos.z), h = hf.get(k); if (b.owner) ownKey(b.owner, k); const mid = (top + pos.y) / 2; if (h == null || mid > h) hf.set(k, mid); }
    if (b.solid && CBZ.colliders && top - pos.y > 0.35) {
      const r = Math.min(b.radius, Math.max(b.ext[0], b.ext[2]));
      const col = { minX: pos.x - r * 0.7, maxX: pos.x + r * 0.7, minZ: pos.z - r * 0.7, maxZ: pos.z + r * 0.7,
        y0: pos.y - 0.3, y1: top * 0.9 + pos.y * 0.1, debris: true, noBreach: true, debrisOwner: b.owner, debrisId: id };
      CBZ.colliders.push(col);
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    }
    staticCount++;
    b.pendingId = id;
    b.frozen = true;
  }
  function rebuildBucket(bk) {
    bk.dirty = false;
    let n = 0;
    for (const q of bk.parts) n += q.p.length / 3;
    if (bk.mesh) { if (bk.mesh.parent) bk.mesh.parent.remove(bk.mesh); bk.mesh.geometry.dispose(); bk.mesh = null; }
    if (!n) { buckets.delete(bk.key); return; }
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2), C = new Float32Array(n * 3);
    let o = 0;
    for (const q of bk.parts) { P.set(q.p, o * 3); N.set(q.n, o * 3); U.set(q.u, o * 2); C.set(q.c, o * 3); o += q.p.length / 3; }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(P, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(N, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(U, 2));
    g.setAttribute("color", new THREE.BufferAttribute(C, 3));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, bk.mat);
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    mesh.castShadow = !PHONE && !TABLET; mesh.receiveShadow = true;
    mesh.userData.debrisRubble = true;
    (bk.root || CBZ.scene).add(mesh);
    bk.mesh = mesh;
  }
  function camD2(x, z) {
    const c = CBZ.camera && CBZ.camera.position; if (!c) return 0;
    return (x - c.x) ** 2 + (z - c.z) ** 2;
  }
  // Too much frozen rubble: drop the oldest, preferring pieces out of view.
  function evictStatic() {
    if (staticCount <= STATIC_CAP) return;
    let want = staticCount - STATIC_CAP + 20;
    const cand = [];
    for (const bk of buckets.values()) for (const q of bk.parts) if (!q.perm) cand.push(q);
    cand.sort((a, b) => (camD2(b.x, b.z) > 3600 ? 1 : 0) - (camD2(a.x, a.z) > 3600 ? 1 : 0) || a.t - b.t);
    const drop = new Set();
    for (const q of cand) { if (want-- <= 0) break; drop.add(q.id); }
    for (const bk of buckets.values()) {
      const before = bk.parts.length;
      bk.parts = bk.parts.filter((q) => !drop.has(q.id));
      if (bk.parts.length !== before && !bk.dirty) { bk.dirty = true; dirtyQ.push(bk); }
    }
    staticCount = Math.max(0, staticCount - drop.size);
  }

  function retire(b) {
    if (b.mesh.parent) b.mesh.parent.remove(b.mesh);
    b.mesh.geometry.dispose();
  }

  /* ================= 5. GRIT (instanced chips) ============================ */
  let grit = null;
  let chunkGeos = null;
  function chipGeo(glass) {
    // an irregular convex chip: a unit solid cut by a few random planes —
    // the same clipper the big pieces use, so a chip is a small piece
    const t = [];
    if (glass) boxTris({ minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5, minZ: -0.04, maxZ: 0.04 }, 0, t);
    else boxTris({ minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5, minZ: -0.5, maxZ: 0.5 }, 0, t);
    let cell = t;
    const cuts = glass ? 3 : 6;
    for (let i = 0; i < cuts; i++) {
      const a = rng() * 6.283, z = glass ? 0 : rr(-1, 1), s = Math.sqrt(1 - z * z);
      const nx = Math.cos(a) * s, ny = Math.sin(a) * s, nz = z;
      cell = clipSolid(cell, nx, ny, nz, rr(0.12, 0.34), { r: 1, g: 1, b: 1, slot: 0 });
    }
    const vol = volumeOf(cell);
    const piece = buildPiece({ t: cell, V: vol.V, cx: vol.cx, cy: vol.cy, cz: vol.cz }, [null], 0);
    const g = piece.mesh.geometry; g.clearGroups();
    // normalise to ~1 m across so scale == size
    g.computeBoundingSphere(); const r = g.boundingSphere.radius || 0.5; g.scale(0.5 / r, 0.5 / r, 0.5 / r);
    g.deleteAttribute("color");
    return g;
  }
  function ensureGrit() {
    if (grit || !CBZ.scene) return grit;
    const variants = [];
    const stoneMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const glassMat = new THREE.MeshPhongMaterial({ color: 0xffffff, specular: 0xffffff, shininess: 120, transparent: true, opacity: 0.55, depthWrite: false });
    stoneMat._shared = glassMat._shared = true;
    const nStone = 5, nGlass = 2;
    const per = Math.max(16, Math.floor(GRIT_CAP / (nStone + nGlass)));
    for (let i = 0; i < nStone + nGlass; i++) {
      const glass = i >= nStone;
      const im = new THREE.InstancedMesh(chipGeo(glass), glass ? glassMat : stoneMat, per);
      im.frustumCulled = false; im.castShadow = false; im.receiveShadow = !glass;
      im.userData.debrisGrit = true;
      const zero = new THREE.Matrix4().makeScale(0, 0, 0);
      for (let k = 0; k < per; k++) { im.setMatrixAt(k, zero); im.setColorAt(k, _c.setRGB(1, 1, 1)); }
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      CBZ.scene.add(im);
      variants.push({ im, glass, slots: new Array(per).fill(null), next: 0 });
    }
    grit = { variants, moving: [] };
    return grit;
  }
  function spawnGrit(x, y, z, o) {
    const G0 = ensureGrit(); if (!G0) return 0;
    const k = K(o.kind);
    const n = Math.round(o.count);
    if (n <= 0) return 0;
    const glass = !!k.glass;
    const pool = G0.variants.filter((v) => v.glass === glass);
    const col = new THREE.Color(o.color != null ? o.color : (k.grit != null ? k.grit : 0x888888));
    const dir = o.dir || null, power = o.power || 1, size = o.size || (glass ? 0.05 : 0.07);
    for (let i = 0; i < n; i++) {
      const V = pool[(rng() * pool.length) | 0];
      const slot = V.next; V.next = (V.next + 1) % V.slots.length;
      const s = size * (0.45 + rng() * rng() * 2.2);
      const tone = 0.78 + rng() * 0.34;
      V.im.setColorAt(slot, _c2.copy(col).multiplyScalar(tone));
      const a = rng() * 6.283, up = rr(0.4, 1.0), sp = rr(1.2, 4.5) * power * (k.leaves ? 0.6 : 1);
      let vx = Math.cos(a) * sp * 0.7, vz = Math.sin(a) * sp * 0.7, vy = up * sp;
      if (dir) { vx += dir.x * sp * 0.9; vy += (dir.y || 0) * sp; vz += dir.z * sp * 0.9; }
      const q = {
        V, slot, x: x + rr(-0.2, 0.2) * (o.spread || 1), y, z: z + rr(-0.2, 0.2) * (o.spread || 1),
        vx, vy, vz, s, rx: rng() * 6, ry: rng() * 6, rz: rng() * 6, sx: rr(-14, 14), sy: rr(-14, 14),
        owner: o.owner || null, t: 0, floor: null, drag: k.leaves ? 2.6 : glass ? 0.4 : 0.1, flat: glass || k.leaves,
      };
      if (V.slots[slot]) { const old = V.slots[slot]; old.dead = true; }
      V.slots[slot] = q;
      G0.moving.push(q);
      writeChip(q);
    }
    for (const v of pool) if (v.im.instanceColor) v.im.instanceColor.needsUpdate = true;
    return n;
  }
  const _e = new THREE.Euler(), _s3 = new THREE.Vector3(), _p3 = new THREE.Vector3();
  function writeChip(q) {
    _e.set(q.rx, q.ry, q.rz); _q.setFromEuler(_e);
    const fl = q.flat ? 0.35 : 1;
    _s3.set(q.s, q.s * fl, q.s);
    _mm.compose(_p3.set(q.x, q.y, q.z), _q, _s3);
    q.V.im.setMatrixAt(q.slot, _mm);
    q.V.im.instanceMatrix.needsUpdate = true;
  }
  function stepGrit(dt) {
    if (!grit || !grit.moving.length) return;
    const mv = grit.moving;
    for (let i = mv.length - 1; i >= 0; i--) {
      const q = mv[i];
      if (q.dead) { mv.splice(i, 1); continue; }
      q.t += dt;
      q.vy -= G * dt;
      if (q.drag) { const f = Math.max(0, 1 - q.drag * dt); q.vx *= f; q.vz *= f; if (q.vy < 0) q.vy *= Math.max(0.2, 1 - q.drag * 0.5 * dt); }
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      q.rx += q.sx * dt; q.ry += q.sy * dt;
      if (q.floor == null || (q.t % 0.25) < dt) {
        q.floor = floorAt(q.x, q.z, q.y + 0.5);
        const h = hfAt(q.x, q.z); if (h > q.floor && h < q.y + 0.4) q.floor = h;
      }
      const rest = q.floor + q.s * (q.flat ? 0.12 : 0.3);
      if (q.y <= rest) {
        q.y = rest;
        if (q.vy < -1.2) { q.vy = -q.vy * 0.25; q.vx *= 0.5; q.vz *= 0.5; q.sx *= 0.5; q.sy *= 0.5; }
        else {
          // settle flat-ish and stop — an instance that never moves again costs nothing
          q.vx = q.vy = q.vz = 0;
          if (q.flat) { q.rx = 0; q.rz = 0; }
          else { q.rx = Math.round(q.rx / 1.57) * 1.57; q.rz = Math.round(q.rz / 1.57) * 1.57; }
          writeChip(q); mv.splice(i, 1); continue;
        }
      }
      if (q.t > 6) { mv.splice(i, 1); }
      writeChip(q);
    }
  }

  /* ================= DUST (pooled soft sprites) =========================== */
  let dustSys = null;
  function ensureDust() {
    if (dustSys || !CBZ.scene) return dustSys;
    const n = DUST_CAP;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), alpha = new Float32Array(n);
    for (let i = 0; i < n; i++) pos[i * 3 + 1] = -9999;
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aColor", new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 }, uLight: { value: 1 } },
      vertexShader: [
        "attribute vec3 aColor; attribute float aSize; attribute float aAlpha;",
        "uniform float uScale; varying vec3 vC; varying float vA;",
        "void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0);",
        " vC = aColor; vA = aAlpha * clamp(1.0 - (-mv.z - 120.0) / 120.0, 0.0, 1.0);",
        " gl_PointSize = aSize * uScale / max(0.5, -mv.z);",
        " gl_Position = projectionMatrix * mv; }",
      ].join("\n"),
      fragmentShader: [
        "uniform float uLight; varying vec3 vC; varying float vA;",
        "void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d) * 4.0;",
        " if (r > 1.0) discard; float a = vA * (1.0 - r) * (1.0 - r);",
        " gl_FragColor = vec4(vC * uLight, a); }",
      ].join("\n"),
      transparent: true, depthWrite: false,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false; pts.renderOrder = 2; pts.userData.debrisDust = true;
    CBZ.scene.add(pts);
    dustSys = { pts, g, pos, col, size, alpha, n, next: 0, motes: new Array(n).fill(null), liveN: 0 };
    return dustSys;
  }
  function dust(x, y, z, o) {
    o = o || {};
    const D = ensureDust(); if (!D) return;
    const k = K(o.kind);
    const color = new THREE.Color(o.color != null ? o.color : (k.dust != null ? k.dust : 0xa09a90));
    const P = Math.max(0.15, Math.min(3, o.power == null ? 1 : o.power));
    const R = o.radius || 0.8;
    const n = Math.round((PHONE ? 6 : TABLET ? 9 : 14) * P * (o.scale || 1)) + 2;
    for (let i = 0; i < n; i++) {
      const s = D.next; D.next = (D.next + 1) % D.n;
      const a = rng() * 6.283, sp = rr(0.4, 1.8) * Math.sqrt(P);
      const tone = 0.85 + rng() * 0.25;
      D.motes[s] = {
        x: x + Math.cos(a) * R * rng(), y: y + rng() * R * 0.5, z: z + Math.sin(a) * R * rng(),
        vx: Math.cos(a) * sp + (o.dir ? o.dir.x * sp : 0), vy: rr(0.3, 1.3) * Math.sqrt(P), vz: Math.sin(a) * sp + (o.dir ? o.dir.z * sp : 0),
        t: 0, life: rr(1.6, 3.4) * (0.7 + P * 0.3), s0: rr(0.5, 1.1) * R, s1: rr(2.2, 4.0) * R * (0.6 + P * 0.4),
        a0: rr(0.28, 0.5), r: color.r * tone, g: color.g * tone, b: color.b * tone,
      };
    }
  }
  function stepDust(dt) {
    if (!dustSys) return;
    const D = dustSys;
    let any = false;
    const cam = CBZ.camera, r = CBZ.renderer;
    if (cam && cam.isPerspectiveCamera) {
      let h = 800;
      try { h = r && r.domElement ? r.domElement.height : (window.innerHeight || 800); } catch (e) {}
      D.pts.material.uniforms.uScale.value = h / (2 * Math.tan((cam.fov * Math.PI / 180) / 2));
    }
    // dust takes the scene's light level so a night blast isn't a glowing cloud
    let L = 1;
    if (CBZ.dayLight != null) L = Math.max(0.18, Math.min(1, CBZ.dayLight));
    else if (CBZ.sun && CBZ.sun.intensity != null) L = Math.max(0.2, Math.min(1, CBZ.sun.intensity * 0.9 + 0.2));
    D.pts.material.uniforms.uLight.value = L;
    for (let i = 0; i < D.n; i++) {
      const m = D.motes[i];
      if (!m) continue;
      m.t += dt;
      const u = m.t / m.life;
      if (u >= 1) { D.motes[i] = null; D.pos[i * 3 + 1] = -9999; D.alpha[i] = 0; any = true; continue; }
      const f = Math.max(0, 1 - 1.4 * dt);
      m.vx *= f; m.vz *= f; m.vy = m.vy * f + 0.15 * dt;
      m.x += m.vx * dt; m.y += m.vy * dt; m.z += m.vz * dt;
      D.pos[i * 3] = m.x; D.pos[i * 3 + 1] = m.y; D.pos[i * 3 + 2] = m.z;
      D.col[i * 3] = m.r; D.col[i * 3 + 1] = m.g; D.col[i * 3 + 2] = m.b;
      D.size[i] = m.s0 + (m.s1 - m.s0) * (1 - (1 - u) * (1 - u));
      D.alpha[i] = m.a0 * Math.min(1, m.t * 6) * (1 - u) * (1 - u * 0.5);
      any = true;
    }
    if (any) {
      D.g.attributes.position.needsUpdate = true; D.g.attributes.aColor.needsUpdate = true;
      D.g.attributes.aSize.needsUpdate = true; D.g.attributes.aAlpha.needsUpdate = true;
    }
  }

  /* ================= SHATTER ============================================== */
  function sourceColor(mat, t, from, to) {
    // average paint of the source faces (material colour x vertex colour)
    matColor(mat, _c);
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = from; i < to; i += S * 3) { r += t[i + 8]; g += t[i + 9]; b += t[i + 10]; n++; }
    if (n && mat && mat.vertexColors) { _c.r *= r / n; _c.g *= g / n; _c.b *= b / n; }
    return _c;
  }
  function shatter(source, o) {
    o = o || {};
    const out = { pieces: 0, grit: 0, bodies: [] };
    if (!source || !CBZ.scene) return out;
    try {
      const mats = [];
      const slotMap = new Map();
      const slotOf = (m) => { let s = slotMap.get(m); if (s == null) { s = mats.length; mats.push(m); slotMap.set(m, s); } return s; };
      const comps = [];               // {t, kind, mat}
      const pushComps = (tris, obj, mat, convex) => {
        // drop any triangle carrying a non-finite value (a degenerate source
        // must never poison a piece or the merged rubble)
        for (let i = 0; i < tris.length; i += 3 * S) {
          let ok = true;
          for (let k = 0; k < 3 * S && ok; k++) if (!isFinite(tris[i + k])) ok = false;
          if (!ok) { tris.splice(i, 3 * S); i -= 3 * S; }
        }
        if (!tris.length) return;
        fixNormals(tris);
        const parts = (convex || o.whole === "one") ? [tris] : components(tris);
        for (const p of parts) comps.push({ t: p, kind: o.kind || kindOf(mat, obj), mat, obj });
      };
      if (source.isObject3D) {
        source.updateWorldMatrix(true, true);
        source.traverse((obj) => {
          if (!obj.isMesh || obj.isInstancedMesh || obj.userData.debrisPiece) return;
          // skip anything the viewer can't see (hidden sub-parts, LOD twins)
          for (let a = obj; a && a !== source.parent; a = a.parent) if (a.visible === false && a !== source) return;
          if (!obj.geometry || !obj.geometry.attributes.position) return;
          const mat = obj.material;
          const tris = [];
          meshTris(obj.geometry, obj.matrixWorld, mat, slotOf, tris);
          pushComps(tris, obj, Array.isArray(mat) ? mat[0] : mat, CONVEX_TYPES.test(obj.geometry.type));
        });
      } else if (source.box) {
        const tris = [];
        const tile = source.tile || (source.material && source.material.map && CBZ.masonryTile
          ? { u: CBZ.masonryTile.w || CBZ.masonryTile.x || 1.6, v: CBZ.masonryTile.h || CBZ.masonryTile.y || 0.8 } : null);
        boxTris(source.box, slotOf(source.material), tris, tile);
        pushComps(tris, null, source.material, true);
      } else if (source.geometry) {
        const tris = [];
        meshTris(source.geometry, source.matrixWorld || _m4.identity(), source.material, slotOf, tris);
        pushComps(tris, null, Array.isArray(source.material) ? source.material[0] : source.material, CONVEX_TYPES.test(source.geometry.type));
      }
      if (!comps.length) return out;
      const coreSlot = mats.length;               // virtual slot: the inside
      const power = Math.max(0.2, Math.min(3, o.power == null ? 1 : o.power));
      let budget = Math.min(o.maxPieces || PER_CALL_CAP, PER_CALL_CAP);
      // live cap: make room by freezing the oldest pieces (resting ones first)
      const room = LIVE_CAP - live.length;
      if (room < budget) makeRoom(budget - room);
      // volume per component decides who gets the budget
      for (const c of comps) {
        const b = soupBounds(c.t); c.b = b;
        c.ext = [b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ];
        c.V = volumeOf(c.t).V;
        if (c.V < 1e-6) c.V = c.ext[0] * c.ext[1] * c.ext[2];
        c.flat = Math.min(c.ext[0], c.ext[1], c.ext[2]) < 0.004;
      }
      comps.sort((a, b) => b.V - a.V);
      const totalV = comps.reduce((s, c) => s + c.V, 0) || 1;
      const fin = (v) => v && isFinite(v.x) && isFinite(v.y == null ? 0 : v.y) && isFinite(v.z);
      const at = fin(o.at) ? o.at : null;
      const dir = fin(o.dir) ? _tmp.set(o.dir.x || 0, o.dir.y || 0, o.dir.z || 0) : null;
      const dirV = dir && dir.lengthSq() > 1e-6 ? dir.clone().normalize() : null;
      let gritBudget = 0, dustDone = 0;
      const cells = [];
      for (let ci = 0; ci < comps.length; ci++) {
        const c = comps[ci];
        const k = K(c.kind);
        const slot0 = c.t[S - 1];
        const mat = mats[slot0];
        const pc = sourceColor(mat, c.t, 0, c.t.length);
        const cr = k.core != null ? _c2.set(k.core) : _c2.copy(pc);
        const cap = {
          r: pc.r + (cr.r - pc.r) * k.coreMix, g: pc.g + (cr.g - pc.g) * k.coreMix, b: pc.b + (cr.b - pc.b) * k.coreMix,
          slot: k.glass ? slot0 : coreSlot, jitter: 0.16,
        };
        c.cap = cap; c.gritCol = new THREE.Color(k.grit != null ? k.grit : 0x888888).lerp(new THREE.Color(cap.r, cap.g, cap.b), 0.5);
        const size = (o.size || k.size) * Math.pow(power, -0.25);
        const L = Math.max(...c.ext), W = Math.min(...c.ext);
        const small = L < size * 1.6;
        const remaining = budget - cells.length;
        if (remaining <= 0) { gritBudget += Math.min(10, 2 + c.V * 40); continue; }
        let parts = null;
        const snap = o.snap !== false && (o.snap === true || ((c.kind === "metal" || c.kind === "wood") && L > 1.6 && L / Math.max(0.02, sortMid(c.ext)) > 5));
        if (snap && !c.flat) parts = snapComponent(c.t, at, c.kind, cap, c.b);
        else if (!o.whole && !small && c.kind !== "rubber" && !c.flat) {
          const share = Math.max(2, Math.round(remaining * Math.min(1, c.V / totalV * 1.6 + 0.15)));
          const byVol = Math.ceil(c.V / (size * size * size * 0.7));
          const byArea = Math.ceil(c.ext[0] * c.ext[1] * c.ext[2] / Math.max(W, 0.02) / (size * size));
          let n = Math.max(2, Math.min(share, remaining, W < size * 0.4 ? byArea : byVol));
          if (k.bend) n = Math.min(n, 3);
          if (k.leaves) n = Math.min(n, 4);
          parts = n >= 2 ? fractureComponent(c.t, c.kind, n, at, o, cap) : null;
        }
        if (!parts || !parts.length) {
          const v = volumeOf(c.t);
          parts = [{ t: c.t, V: v.V || c.V, cx: v.V ? v.cx : (c.b.minX + c.b.maxX) / 2, cy: v.V ? v.cy : (c.b.minY + c.b.maxY) / 2, cz: v.V ? v.cz : (c.b.minZ + c.b.maxZ) / 2 }];
        }
        // THE RAGGED EDGE IS SURVIVING MATERIAL: cells on the rim of a wall
        // opening may stay put, welded, so the hole's edge is broken wall and
        // not a saw cut. Never the bottom rim (no kerb across a walk-through).
        if (o.keepEdge > 0 && parts.length > 2) {
          const bb = c.b, ax = [0, 1, 2].sort((i, j) => c.ext[j] - c.ext[i]).slice(0, 2);
          const lo = [bb.minX, bb.minY, bb.minZ], hi = [bb.maxX, bb.maxY, bb.maxZ];
          for (const p of parts) {
            const pb = soupBounds(p.t), plo = [pb.minX, pb.minY, pb.minZ], phi = [pb.maxX, pb.maxY, pb.maxZ];
            let edge = false;
            for (const a of ax) if (phi[a] > hi[a] - 1e-3 || plo[a] < lo[a] + 1e-3) edge = true;
            if (plo[1] < lo[1] + 1e-3 && !o.keepFloor) edge = false;
            if (edge && rng() < o.keepEdge) p.keep = true;
          }
        }
        for (const p of parts) { p.comp = c; cells.push(p); }
        gritBudget += k.gritN * Math.min(2, 0.4 + c.V * 2.5);
      }
      // build + launch
      const cx0 = at ? at.x : null;
      for (const cell of cells) {
        const c = cell.comp, k = K(c.kind);
        if (k.bend && !cell.stump) bendCell(cell, rr(0.05, 0.3) * (cell.axis != null ? 0.6 : 1));
        const cm = c.flat ? mats.map(doubleSided) : mats;
        const piece = buildPiece(cell, cm, coreSlot);
        if (!piece) continue;
        piece.mesh.castShadow = !PHONE && cell.V > 0.004;
        piece.mesh.receiveShadow = true;
        if ((cell.stump && o.anchorStump !== false) || cell.keep) {
          // the base of a snapped pole stays planted: straight to rubble
          const body = addBody(piece, o, k, c.kind, cell.V);
          if (body) { live.splice(live.indexOf(body), 1); body.anchored = true; freeze(body); frozenPending.push(body); }
          out.pieces++;
          continue;
        }
        const body = addBody(piece, o, k, c.kind, cell.V);
        if (!body) continue;
        out.pieces++;
        // launch: away from the hit, lighter pieces faster, plus the push dir
        const p = piece.mesh.position;
        let rx = 0, ry = 0, rz = 0, dist = 1;
        if (at) { rx = p.x - at.x; ry = p.y - at.y; rz = p.z - at.z; dist = Math.hypot(rx, ry, rz) || 1; rx /= dist; ry /= dist; rz /= dist; }
        const massF = Math.min(1.7, Math.pow(Math.max(0.2, body.mass) / 50, -0.2));
        const near = at ? Math.max(0.25, 1.6 - dist * 0.35) : 0.6;
        const sp = (o.speed != null ? o.speed : 3.2) * power * massF * near;
        body.v.set(rx * sp * 0.8, ry * sp * 0.5 + rr(0.2, 1.4) * power * massF, rz * sp * 0.8);
        if (dirV) body.v.addScaledVector(dirV, sp * rr(0.6, 1.1));
        if (cell.axis != null) {
          // a snapped member topples: spin about the horizontal axis
          // perpendicular to the push
          const dx = dirV ? dirV.x : rr(-1, 1), dz = dirV ? dirV.z : rr(-1, 1);
          const l = Math.hypot(dx, dz) || 1;
          body.w.set(dz / l * 1.6 * power, 0, -dx / l * 1.6 * power);
          body.v.multiplyScalar(0.45);
        } else {
          body.w.set(rr(-1, 1), rr(-1, 1), rr(-1, 1)).multiplyScalar(rr(2, 9) * power / Math.max(0.3, Math.sqrt(piece.radius * 3)));
        }
        if (o.launch === false) body.v.set(0, 0, 0), body.w.set(0, 0, 0);
        if (fin(o.velocity)) body.v.add(o.velocity);
        if (fin(o.angular)) body.w.add(o.angular);
        if (!isFinite(body.v.x + body.v.y + body.v.z)) body.v.set(0, 0, 0);
        if (!isFinite(body.w.x + body.w.y + body.w.z)) body.w.set(0, 0, 0);
        if (o.maxLife) body.maxLife = o.maxLife;
        if (out.bodies) out.bodies.push(body.mesh);
      }
      // hide the source now that its pieces stand in its place
      if (source.isObject3D && o.hide !== false) source.visible = false;
      // grit + dust in the source's colours
      if (o.grit !== false && comps.length) {
        const g0 = comps[0];
        const gscale = typeof o.grit === "number" ? o.grit : 1;
        const n = Math.min(PHONE ? 16 : TABLET ? 26 : 48, Math.round(gritBudget * power * gscale * (PHONE ? 0.5 : TABLET ? 0.7 : 1)));
        const ax = at ? at.x : (g0.b.minX + g0.b.maxX) / 2, ay = at ? at.y : (g0.b.minY + g0.b.maxY) / 2, az = at ? at.z : (g0.b.minZ + g0.b.maxZ) / 2;
        // leaves/glass get their own grit even when not the biggest component
        const kinds = new Map();
        for (const c of comps) if (!kinds.has(c.kind)) kinds.set(c.kind, c);
        let share = kinds.size;
        for (const [kd, c] of kinds) {
          const cnt = Math.round(n / share * (kd === "foliage" ? 2 : 1));
          out.grit += spawnGrit(ax, ay, az, { owner: o.owner, kind: kd, color: c.gritCol.getHex(), count: cnt, dir: dirV, power, spread: Math.min(3, Math.max(...c.ext) * 0.5) });
        }
      }
      if (o.dust !== false && comps.length) {
        const g0 = comps[0], k = K(g0.kind);
        if (k.dust != null) {
          const dc = new THREE.Color(k.dust).lerp(new THREE.Color(g0.cap.r, g0.cap.g, g0.cap.b), 0.35);
          const ax = at ? at.x : (g0.b.minX + g0.b.maxX) / 2, ay = at ? at.y : g0.b.minY + 0.3, az = at ? at.z : (g0.b.minZ + g0.b.maxZ) / 2;
          dust(ax, ay, az, { color: dc.getHex(), power: power * Math.min(1.6, 0.5 + Math.cbrt(totalV)) * (typeof o.dust === "number" ? o.dust : 1), radius: Math.min(2.5, 0.5 + Math.cbrt(totalV) * 0.6), dir: dirV });
          dustDone++;
        }
      }
    } catch (e) {
      if (CBZ.debris && CBZ.debris._debug) console.warn("[debris] shatter failed", e);
    }
    return out;
  }
  /* A settled rubble MOUND made of the thing that fell: blocks of the given
     material(s) are fractured exactly like a shatter, then seated one by one
     on the ground and on each other (biggest first) inside an ellipse, and
     frozen straight into static rubble. The aftermath of a collapse, built
     from the building's own wall, glass and trim — never a heap of boxes.
       o: {x, z, w, d, h, y?, material | materials:[{material, kind, weight}],
           kind?, owner?, count?, size?, solid?, permanent? (never evicted:
           authored scenery rubble)} */
  function pile(o) {
    o = o || {};
    const res = { pieces: 0 };
    if (!CBZ.scene) return res;
    try {
      const list = o.materials || [{ material: o.material, kind: o.kind, weight: 1 }];
      const cap = PHONE ? 60 : TABLET ? 110 : 240;
      const W = Math.max(0.6, o.w || 4), Dd = Math.max(0.6, o.d || 4), H = Math.max(0.2, o.h || 1.5);
      const total = Math.min(cap, o.count || Math.round(W * Dd * H * 2.2 + 6));
      const wsum = list.reduce((s, m) => s + (m.weight || 1), 0) || 1;
      const all = [];
      for (const m of list) {
        if (!m || !m.material) continue;
        const kind = m.kind || o.kind || kindOf(m.material);
        const k = K(kind);
        const want = Math.max(1, Math.round(total * (m.weight || 1) / wsum));
        const size = (o.size || k.size) * (0.8 + Math.min(1.2, H * 0.25));
        const mats = [m.material], coreSlot = 1;
        const pc = matColor(m.material, _c).clone();
        const cr = k.core != null ? new THREE.Color(k.core) : pc;
        const capC = { r: pc.r + (cr.r - pc.r) * k.coreMix, g: pc.g + (cr.g - pc.g) * k.coreMix, b: pc.b + (cr.b - pc.b) * k.coreMix, slot: k.glass ? 0 : coreSlot, jitter: 0.2 };
        let made = 0, guard = 0;
        while (made < want && guard++ < 40) {
          const bs = size * rr(1.8, 3.0), th = k.glass ? 0.012 : bs * rr(0.35, 0.8);
          const t = [];
          boxTris({ minX: 0, maxX: bs, minY: 0, maxY: th, minZ: 0, maxZ: bs * rr(0.6, 1) }, 0, t, { u: 1.6, v: 0.8 });
          const cells = fractureComponent(t, kind, Math.min(10, want - made + 1), null, o, capC) || [];
          for (const cell of cells) { if (made >= want) break; all.push({ cell, mats, coreSlot, kind }); made++; }
        }
      }
      all.sort((a, b) => b.cell.V - a.cell.V);
      const floorY = o.y != null ? o.y : floorAt(o.x, o.z, 50);
      const root = o.root || CBZ.scene;
      for (const it of all) {
        const piece = buildPiece(it.cell, it.mats, it.coreSlot);
        if (!piece) continue;
        const m = piece.mesh;
        // random attitude: mostly lying flat, some on edge
        _e.set(rr(-0.7, 0.7), rng() * 6.283, rr(-0.7, 0.7)); m.quaternion.setFromEuler(_e);
        // footprint: the big pieces spread, the small fill toward the middle
        let placed = false;
        for (let tries = 0; tries < 6 && !placed; tries++) {
          const a = rng() * 6.283, r = Math.sqrt(rng()) * (tries < 3 ? 1 : 0.6);
          const px = o.x + Math.cos(a) * r * W / 2, pz = o.z + Math.sin(a) * r * Dd / 2;
          m.position.set(px, 0, pz);
          _mm.compose(m.position, m.quaternion, _one);
          const e = _mm.elements, pts = piece.pts;
          let low = Infinity, seat = -Infinity;
          for (let i = 0; i < pts.length; i += 3) {
            const wx = e[0] * pts[i] + e[4] * pts[i + 1] + e[8] * pts[i + 2] + e[12];
            const wy = e[1] * pts[i] + e[5] * pts[i + 1] + e[9] * pts[i + 2] + e[13];
            const wz = e[2] * pts[i] + e[6] * pts[i + 1] + e[10] * pts[i + 2] + e[14];
            if (wy < low) low = wy;
            const h = hfAt(wx, wz); const s = Math.max(floorY, h);
            if (s > seat) seat = s;
          }
          // the mound's own profile caps how high a piece may sit here
          const prof = floorY + H * Math.max(0, 1 - r * r) + 0.15;
          if (seat > prof) continue;
          m.position.y = seat - low - Math.min(0.06, piece.radius * 0.15);
          placed = true;
        }
        if (!placed) { m.geometry.dispose(); continue; }
        root.add(m);
        const k = K(it.kind);
        const fake = { mesh: m, pts: piece.pts, radius: piece.radius, ext: piece.ext, owner: o.owner || null,
          solid: !!o.solid, anchored: true, kind: it.kind, mass: 1, e: k.e, permanent: !!o.permanent };
        freeze(fake); frozenPending.push(fake);
        res.pieces++;
      }
    } catch (e) {
      if (CBZ.debris && CBZ.debris._debug) console.warn("[debris] pile failed", e);
    }
    return res;
  }
  function sortMid(e) { const s = e.slice().sort((a, b) => a - b); return s[1]; }
  const frozenPending = [];
  function makeRoom(n) {
    // resting first, then oldest
    const order = live.slice().sort((a, b) => (b.contact ? 1 : 0) - (a.contact ? 1 : 0) || b.t - a.t);
    for (let i = 0; i < order.length && n > 0; i++) {
      const b = order[i];
      const idx = live.indexOf(b); if (idx < 0) continue;
      live.splice(idx, 1);
      if (b.contact || b.t > 1.2) { freeze(b); frozenPending.push(b); }
      else retire(b);
      n--;
    }
  }

  // sourceless hit: grit + dust off a surface (bullet on a wall, blast on the road)
  function chips(x, y, z, o) {
    o = o || {};
    const kind = o.kind || (o.material ? kindOf(o.material) : "concrete");
    const k = K(kind);
    let color = o.color;
    if (color == null && o.material) { matColor(o.material, _c); color = new THREE.Color(k.grit != null ? k.grit : 0x888888).lerp(_c, 0.55).getHex(); }
    const power = o.power == null ? 1 : o.power;
    const n = o.count != null ? o.count : Math.round(k.gritN * 0.6 * power);
    const dir = o.dir ? new THREE.Vector3(o.dir.x || 0, o.dir.y || 0, o.dir.z || 0) : null;
    if (dir && dir.lengthSq() > 1e-6) dir.normalize();
    const got = spawnGrit(x, y, z, { kind, color, count: Math.min(PHONE ? 14 : 40, n), dir, power, size: o.size, spread: o.spread, owner: o.owner });
    if (o.dust !== false && k.dust != null) dust(x, y, z, { color: o.dustColor != null ? o.dustColor : (color != null ? new THREE.Color(k.dust).lerp(new THREE.Color(color), 0.3).getHex() : k.dust), power: power * 0.7, radius: o.radius || 0.6, dir });
    return got;
  }

  /* ================= frame ================================================ */
  function update(dt) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.05);
    nowT += dt;
    if (live.length) {
      const sub = dt > 0.025 ? 2 : 1, h = dt / sub;
      for (let i = live.length - 1; i >= 0; i--) {
        const b = live[i];
        let r = 0;
        for (let s = 0; s < sub && !r; s++) r = stepBody(b, h);
        if (r === 1) { live.splice(i, 1); freeze(b); frozenPending.push(b); }
        else if (r === 2) { live.splice(i, 1); retire(b); }
      }
    }
    // rebuild a few dirty rubble buckets, then drop the live meshes they now draw
    if (dirtyQ.length) {
      evictStatic();
      const n = Math.min(dirtyQ.length, 3);
      for (let i = 0; i < n; i++) rebuildBucket(dirtyQ.shift());
      if (!dirtyQ.length) {
        for (const b of frozenPending) retire(b);
        frozenPending.length = 0;
      }
    }
    stepGrit(dt);
    stepDust(dt);
  }
  if (CBZ.onUpdate) CBZ.onUpdate(62, update);

  function clear(owner) {
    for (let i = live.length - 1; i >= 0; i--) {
      const b = live[i];
      if (owner != null && b.owner !== owner) continue;
      live.splice(i, 1); retire(b);
    }
    for (let i = frozenPending.length - 1; i >= 0; i--) {
      const b = frozenPending[i];
      if (owner != null && b.owner !== owner) continue;
      frozenPending.splice(i, 1); retire(b);
    }
    const gone = new Set();
    for (const bk of Array.from(buckets.values())) {
      if (owner != null && bk.owner !== owner) continue;
      for (const q of bk.parts) gone.add(q.id);
      bk.parts.length = 0; rebuildBucket(bk);
      const qi = dirtyQ.indexOf(bk); if (qi >= 0) dirtyQ.splice(qi, 1);
    }
    if (owner != null) { const ks = hfOwned.get(owner); if (ks) { for (const k of ks) hf.delete(k); hfOwned.delete(owner); } }
    else hfOwned.clear();
    staticCount = Math.max(0, staticCount - gone.size);
    if (CBZ.colliders) {
      let changed = false;
      for (let i = CBZ.colliders.length - 1; i >= 0; i--) {
        const c = CBZ.colliders[i];
        if (c && c.debris && (owner == null || c.debrisOwner === owner)) { CBZ.colliders.splice(i, 1); changed = true; }
      }
      if (changed && CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    }
    if (owner != null && grit) {
      const zero = new THREE.Matrix4().makeScale(0, 0, 0);
      for (const v of grit.variants) {
        let d = false;
        for (let k = 0; k < v.slots.length; k++) { const q = v.slots[k]; if (q && q.owner === owner) { q.dead = true; v.slots[k] = null; v.im.setMatrixAt(k, zero); d = true; } }
        if (d) v.im.instanceMatrix.needsUpdate = true;
      }
    }
    if (owner == null) {
      hf.clear();
      if (grit) for (const v of grit.variants) {
        const zero = new THREE.Matrix4().makeScale(0, 0, 0);
        for (let k = 0; k < v.slots.length; k++) { v.slots[k] = null; v.im.setMatrixAt(k, zero); }
        v.im.instanceMatrix.needsUpdate = true;
        grit.moving.length = 0;
      }
      if (dustSys) { dustSys.motes.fill(null); dustSys.pos.fill(-9999); dustSys.alpha.fill(0); }
    }
  }
  /* Haul off every piece within r of (x,z) — live bodies, frozen rubble,
     grit, colliders and the height-field under them. A crew clearing a lot. */
  function clearNear(x, z, r) {
    const r2 = r * r, inR = (px, pz) => (px - x) * (px - x) + (pz - z) * (pz - z) <= r2;
    let n = 0;
    for (let i = live.length - 1; i >= 0; i--) {
      const b = live[i], p = b.mesh.position;
      if (!inR(p.x, p.z)) continue;
      live.splice(i, 1); retire(b); n++;
    }
    for (let i = frozenPending.length - 1; i >= 0; i--) {
      const b = frozenPending[i], p = b.mesh.position;
      if (!inR(p.x, p.z)) continue;
      frozenPending.splice(i, 1); retire(b);
    }
    const gone = new Set();
    for (const bk of buckets.values()) {
      const before = bk.parts.length;
      bk.parts = bk.parts.filter((q) => { if (inR(q.x, q.z)) { gone.add(q.id); return false; } return true; });
      if (bk.parts.length !== before && !bk.dirty) { bk.dirty = true; dirtyQ.push(bk); }
    }
    staticCount = Math.max(0, staticCount - gone.size);
    n += gone.size;
    // the height-field is hashed, so walk the covered cells directly
    for (let gx = Math.floor((x - r) / HF); gx <= Math.floor((x + r) / HF); gx++)
      for (let gz = Math.floor((z - r) / HF); gz <= Math.floor((z + r) / HF); gz++)
        hf.delete(gx * 73856093 ^ gz * 19349663);
    if (grit) {
      const zero = new THREE.Matrix4().makeScale(0, 0, 0);
      for (const v of grit.variants) {
        let dirty = false;
        for (let k = 0; k < v.slots.length; k++) {
          const q = v.slots[k];
          if (q && inR(q.x, q.z)) { q.dead = true; v.slots[k] = null; v.im.setMatrixAt(k, zero); dirty = true; }
        }
        if (dirty) v.im.instanceMatrix.needsUpdate = true;
      }
    }
    if (CBZ.colliders) {
      let changed = false;
      for (let i = CBZ.colliders.length - 1; i >= 0; i--) {
        const c = CBZ.colliders[i];
        if (c && c.debris && gone.has(c.debrisId)) { CBZ.colliders.splice(i, 1); changed = true; }
      }
      if (changed && CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    }
    return n;
  }
  // a fresh scene (mode switch) drops the old pools: they belong to its scene
  function hardReset() {
    clear();
    if (grit) { for (const v of grit.variants) { if (v.im.parent) v.im.parent.remove(v.im); v.im.geometry.dispose(); } grit = null; }
    if (dustSys) { if (dustSys.pts.parent) dustSys.pts.parent.remove(dustSys.pts); dustSys.g.dispose(); dustSys = null; }
  }

  CBZ.debris = {
    shatter,
    shatterBox: (box, material, o) => shatter({ box, material }, o),
    // hand an existing part (a door, a bumper, a lamp head) to the rigid-body
    // sim whole: its own geometry becomes the body, the original is hidden
    adopt: (obj, o) => shatter(obj, Object.assign({ whole: "one", launch: false, grit: false, dust: false }, o || {})),
    pile,
    /* A shared irregular broken-chunk geometry (~1 m across, convex, cut by
       the same clipper) for SCENERY rubble authored at build time — a
       derelict parapet, a gabion's fill. Scale it per axis like a box.
       Shared: never dispose it. i picks one of 6 variants. */
    chunkGeo(i) {
      if (!chunkGeos) {
        chunkGeos = [];
        for (let v = 0; v < 6; v++) { const g = chipGeo(false); g._shared = true; chunkGeos.push(g); }
      }
      return chunkGeos[Math.abs(i | 0) % chunkGeos.length];
    },
    chips,
    dust: (x, y, z, o) => dust(x, y, z, o),
    kindOf,
    tag(obj, kind) { if (obj) { if (obj.userData) obj.userData.debrisKind = kind; else if (obj.material) obj.material.userData.debrisKind = kind; } return obj; },
    clear, clearNear, reset: hardReset,
    update,
    KINDS,
    stats() {
      let tris = 0; for (const bk of buckets.values()) for (const q of bk.parts) tris += q.p.length / 9;
      let gritLive = 0; if (grit) for (const v of grit.variants) for (const s of v.slots) if (s) gritLive++;
      let dustLive = 0; if (dustSys) for (const m of dustSys.motes) if (m) dustLive++;
      return { live: live.length, static: staticCount, buckets: buckets.size, staticTris: tris, grit: gritLive, dust: dustLive,
        caps: { live: LIVE_CAP, static: STATIC_CAP, grit: GRIT_CAP, perCall: PER_CALL_CAP }, device: DEVICE };
    },
    // test hooks (node checks drive the fracture without a scene)
    _internal: { boxTris, clipSolid, fractureComponent, snapComponent, volumeOf, soupBounds, buildPiece, S, kindOf },
  };
})();
