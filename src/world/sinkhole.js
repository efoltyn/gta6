/* ============================================================
   world/sinkhole.js — THE SINKHOLE EVENT: the ground warns, gives way, eats
   its own edges and takes what was standing on it.

   world/groundshaft.js is the HOLE (cut a shaft, answer its floor, stop the
   ground drawing over it, hurt what falls in). This file is the EVENT a
   cover-collapse sinkhole actually is, in the order it happens:

   1. WARNING, at the site, in the world. Cracks spread through the asphalt
      (one ribbon mesh, every crack growing at its own pace from one
      drawRange); the cover SAGS — the disc of road over the cavity is
      replaced by REAL CRUST SLABS cut from the surface that was there (its
      own material and its own UVs, sampled off the ground meshes), and they
      sink and tilt in as the cavity takes them; water pools in the dip;
      lamp posts and trees on the doomed ground lean; doors in the building
      at the edge jam in their racked frames.
   2. COVER COLLAPSE. The slabs drop, and the hole is cut: a shaft through
      the actual ground (the mask stops the terrain and road meshes drawing
      inside it; the wall is the section through them), as deep as the
      setting allows, with a broken water main spraying into it.
   3. WIDENING. The edge calves in chunks: each step spawns the next ring of
      crust as slabs that tip inward off the lip and fall, re-cuts the shaft
      wider, and takes whatever the new rim no longer holds up.
   4. WHAT GOES IN. Cars, posts, trees and the crust are RIGID BODIES with
      box-corner contacts against the real floor (CBZ.floorAt: the shaft's
      carving answers inside the mouth, the ground outside it) and against
      the shaft wall. Nothing is scripted to "fall in": a car tips nose-first
      because its front corners lost their floor and its rear did not. A
      building whose footing the hole reaches is UNDERMINED: a corner drops,
      it tilts, and it goes — through CBZ.collapse.undermine when that
      exists, else the collapse engine's topple with this lean baked in.
   5. AFTERMATH. The hole stays. Water keeps rising, the main keeps spraying
      for a while, the road over it is closed to traffic and the nav grid
      treats the mouth as a void.

   PHONE LAW: no visible downgrade. The extra work is bounded (a body cap,
   crust slabs freed into CBZ.debris on landing, sleeping bodies cost a
   support check every 0.3 s), and everything that is drawn stays drawn at
   full quality.

   Hosts hand in what they own as plain providers (opts.cars / buildings /
   eachActor / roads); with none, the city's records are read. The lab's
   `sinkhole` kit runs this exact file on a real street.
   Audit: CBZ.sinkholeAudit(); per event: seq.report().
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const K = CBZ.groundShaftKit;
  if (!K) return;
  CBZ.CONFIG = CBZ.CONFIG || {};

  const TAU = Math.PI * 2;
  const G = (CBZ.PHYS && CBZ.PHYS.G_REAL) || 9.81;
  const PHONE = CBZ.deviceClass === "phone";
  // awake rigid bodies per event (a sleeping body costs nothing)
  const AWAKE_CAP = PHONE ? 22 : 40;

  const audit = { events: 0, bodies: 0, cars: 0, props: 0, slabs: 0, extracted: 0, instanced: 0,
    undermined: 0, roadsClosed: 0, doorsJammed: 0, pipes: 0, exempted: 0 };

  // Runtime spectacle over an already-decided outcome: Math.random is legal
  // here (the groundshaft licence); the SHAPE of a hole is the shaft's hash.
  function rnd() { return Math.random(); }
  function h01(a, b, c) {
    const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
    return s - Math.floor(s);
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(e0, e1, x) { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }

  function floorY(x, z, fromY) {
    let y = null;
    try { if (CBZ.floorAt) y = +CBZ.floorAt(x, z, fromY); } catch (e) { y = null; }
    if (y == null || !Number.isFinite(y)) y = K.rawFloor(x, z);
    return y;
  }

  /* ============================================================
     THE MASK TAKES ANY FRAGMENT IN ITS BAND, NOT ONLY THE GROUND.
     core/groundmask.js discards every fogged surface within a band 6 m deep
     under a hole's grade, inside its radius. That is right for the plate,
     the road and the sea, and it is wrong for a car going over the edge or
     a man falling past the lip: both VANISH for their first six metres.
     So whatever enters a hole is opted out — by an exempt CLONE of each of
     its materials (a #define, groundmask.js's own opt-out). A clone, never
     the shared original: CBZ.cmat caches by colour, and a pair of grey
     trousers can be the same material object as the pavement.
     ============================================================ */
  const exClones = new Map();
  function exemptMat(m) {
    if (!m || (m.defines && m.defines.CBZ_NOMASK)) return m;
    let c = exClones.get(m);
    if (!c) {
      c = m.clone();
      if (m.onBeforeCompile) c.onBeforeCompile = m.onBeforeCompile;
      if (m.customProgramCacheKey) c.customProgramCacheKey = m.customProgramCacheKey;
      if (CBZ.groundMaskExempt) CBZ.groundMaskExempt(c);
      exClones.set(m, c);
      audit.exempted++;
    }
    return c;
  }
  function exemptObject(obj, save) {
    if (!obj || !CBZ.groundMaskExempt) return;
    obj.traverse(function (o) {
      if (!o.isMesh || !o.material || o.isSkinnedMesh) return;
      const mm = o.material;
      const nm = Array.isArray(mm) ? mm.map(exemptMat) : exemptMat(mm);
      if (nm === mm) return;
      if (save) save.push([o, mm]);
      o.material = nm;
    });
  }

  /* ============================================================
     THE GROUND SAMPLER — what the surface IS at a point: its height, its
     material and its UV. Built once per event from the ground meshes
     under the site (triangles near grade, facing up), so the crust slabs
     wear the road they replace, texture and all, and the cracks lie on it.
     ============================================================ */
  function isRig(o) {
    for (let p = o; p; p = p.parent) {
      const u = p.userData;
      if (u && (u.groundShaft || u.sinkBody || u.debrisPiece || u.isActor)) return true;
    }
    return false;
  }
  function rigSet() {
    const s = new Set();
    const bots = CBZ.bots || [];
    for (let i = 0; i < bots.length; i++) if (bots[i] && bots[i].group) s.add(bots[i].group);
    const peds = CBZ.cityPeds || [];
    for (let i = 0; i < peds.length; i++) if (peds[i] && peds[i].group) s.add(peds[i].group);
    const npcs = CBZ.npcs || [];
    for (let i = 0; i < npcs.length; i++) if (npcs[i] && npcs[i].group) s.add(npcs[i].group);
    if (CBZ.playerChar && CBZ.playerChar.group) s.add(CBZ.playerChar.group);
    return s;
  }
  function underAny(o, set) {
    for (let p = o; p; p = p.parent) if (set.has(p)) return true;
    return false;
  }
  const _v0 = new THREE.Vector3(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
  const _box = new THREE.Box3();
  function buildSampler(x, z, R, gy, skip) {
    const tris = [];
    const CAP = 9000;
    const rigs = rigSet();
    K.root().traverse(function (o) {
      if (tris.length > CAP) return;
      if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.visible || !o.geometry || !o.material) return;
      if (isRig(o) || underAny(o, rigs) || (skip && underAny(o, skip))) return;
      const geo = o.geometry, pa = geo.attributes && geo.attributes.position;
      if (!pa) return;
      if (!geo.boundingBox) geo.computeBoundingBox();
      _box.copy(geo.boundingBox).applyMatrix4(o.matrixWorld);
      if (_box.max.x < x - R || _box.min.x > x + R || _box.max.z < z - R || _box.min.z > z + R) return;
      if (_box.min.y > gy + 0.35 || _box.max.y < gy - 0.6) return;
      const uv = geo.attributes.uv || null;
      const idx = geo.index ? geo.index.array : null;
      const nT = idx ? idx.length / 3 : pa.count / 3;
      const M = o.matrixWorld;
      const mats = Array.isArray(o.material) ? o.material : null;
      const groups = geo.groups || [];
      for (let t = 0; t < nT && tris.length <= CAP; t++) {
        const ia = idx ? idx[t * 3] : t * 3, ib = idx ? idx[t * 3 + 1] : t * 3 + 1, ic = idx ? idx[t * 3 + 2] : t * 3 + 2;
        _v0.fromBufferAttribute(pa, ia).applyMatrix4(M);
        _v1.fromBufferAttribute(pa, ib).applyMatrix4(M);
        _v2.fromBufferAttribute(pa, ic).applyMatrix4(M);
        if (Math.max(_v0.x, _v1.x, _v2.x) < x - R || Math.min(_v0.x, _v1.x, _v2.x) > x + R) continue;
        if (Math.max(_v0.z, _v1.z, _v2.z) < z - R || Math.min(_v0.z, _v1.z, _v2.z) > z + R) continue;
        const ymax = Math.max(_v0.y, _v1.y, _v2.y), ymin = Math.min(_v0.y, _v1.y, _v2.y);
        if (ymax > gy + 0.3 || ymin < gy - 0.5) continue;
        // facing up: a kerb face or a wall foot is not the surface
        const ex = _v1.x - _v0.x, ey = _v1.y - _v0.y, ez = _v1.z - _v0.z;
        const fx = _v2.x - _v0.x, fy = _v2.y - _v0.y, fz = _v2.z - _v0.z;
        const ny = ez * fx - ex * fz;
        const nl = Math.hypot(ey * fz - ez * fy, ny, ex * fy - ey * fx) || 1;
        if (Math.abs(ny) / nl < 0.85) continue;
        let mat = o.material;
        if (mats) {
          let mi = 0;
          for (let g = 0; g < groups.length; g++) { const gr = groups[g]; if (t * 3 >= gr.start && t * 3 < gr.start + gr.count) { mi = gr.materialIndex; break; } }
          mat = mats[mi] || mats[0];
        }
        const ca = geo.attributes.color || null;
        tris.push({
          a: [_v0.x, _v0.y, _v0.z], b: [_v1.x, _v1.y, _v1.z], c: [_v2.x, _v2.y, _v2.z],
          uv: uv ? [uv.getX(ia), uv.getY(ia), uv.getX(ib), uv.getY(ib), uv.getX(ic), uv.getY(ic)] : null,
          // a vertex-coloured ground (the island's turf and beach) keeps its
          // colour in the vertices, not the material
          col: ca ? [(ca.getX(ia) + ca.getX(ib) + ca.getX(ic)) / 3, (ca.getY(ia) + ca.getY(ib) + ca.getY(ic)) / 3, (ca.getZ(ia) + ca.getZ(ib) + ca.getZ(ic)) / 3] : null,
          mat: mat, ro: o.renderOrder || 0,
        });
      }
    });
    // barycentrics of (px, pz) in a triangle's xz projection
    function bary(t, px, pz, out) {
      const ax = t.a[0], az = t.a[2], bx = t.b[0], bz = t.b[2], cx = t.c[0], cz = t.c[2];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-9) return false;
      out[0] = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d;
      out[1] = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d;
      out[2] = 1 - out[0] - out[1];
      return true;
    }
    const W = [0, 0, 0];
    // a 2 m grid over the region, so a lookup tests a handful of triangles
    // (a slab asks ~20 times, the cracks ~800: a linear scan of 9000 was a
    // visible hitch on the first calving)
    const CELL = 2, x0 = x - R, z0 = z - R, NC = Math.max(1, Math.ceil((2 * R) / CELL));
    const grid = new Array(NC * NC);
    for (let i = 0; i < tris.length; i++) {
      const t = tris[i];
      const i0 = clamp(Math.floor((Math.min(t.a[0], t.b[0], t.c[0]) - x0) / CELL), 0, NC - 1);
      const i1 = clamp(Math.floor((Math.max(t.a[0], t.b[0], t.c[0]) - x0) / CELL), 0, NC - 1);
      const k0 = clamp(Math.floor((Math.min(t.a[2], t.b[2], t.c[2]) - z0) / CELL), 0, NC - 1);
      const k1 = clamp(Math.floor((Math.max(t.a[2], t.b[2], t.c[2]) - z0) / CELL), 0, NC - 1);
      for (let k = k0; k <= k1; k++) for (let j = i0; j <= i1; j++) { const c = k * NC + j; (grid[c] || (grid[c] = [])).push(t); }
    }
    const NONE = [];
    return {
      tris: tris,
      // the TOPMOST surface at (x, z): y, the triangle it lies on
      at: function (px, pz) {
        let best = null, by = -Infinity;
        const j = Math.floor((px - x0) / CELL), k = Math.floor((pz - z0) / CELL);
        const list = (j < 0 || k < 0 || j >= NC || k >= NC) ? NONE : (grid[k * NC + j] || NONE);
        for (let i = 0; i < list.length; i++) {
          const t = list[i];
          if (!bary(t, px, pz, W)) continue;
          if (W[0] < -1e-4 || W[1] < -1e-4 || W[2] < -1e-4) continue;
          const y = t.a[1] * W[0] + t.b[1] * W[1] + t.c[1] * W[2];
          // lane paint over asphalt: the higher, later-drawn one is on top
          if (y > by + 0.004 || (Math.abs(y - by) <= 0.004 && best && t.ro > best.ro)) { by = y; best = t; }
        }
        return best ? { y: by, tri: best } : null;
      },
      // a triangle's UV at ANY point of its plane (extrapolated affinely), so
      // a slab bigger than the triangle it was centred on stays continuous
      uvAt: function (t, px, pz, out) {
        if (!t || !t.uv || !bary(t, px, pz, W)) { out[0] = px * 0.25; out[1] = pz * 0.25; return; }
        out[0] = t.uv[0] * W[0] + t.uv[2] * W[1] + t.uv[4] * W[2];
        out[1] = t.uv[1] * W[0] + t.uv[3] * W[1] + t.uv[5] * W[2];
      },
    };
  }

  /* ============================================================
     CRUST SLABS — the cover itself. A polygon of the surface (world xz,
     counter-clockwise) extruded down through the top of the section: the
     top face in the ground's own material and UVs, the cut faces in the
     section's colours (asphalt, then base course, read from the shaft's
     own layer list). Local coordinates about the centroid.
     ============================================================ */
  let secMat = null, darkMat = null, puddleMat = null, crackMat = null, pipeMat = null, jetMat = null;
  function fxMats() {
    if (secMat) return;
    secMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    darkMat = new THREE.MeshLambertMaterial({ color: 0x15100b });
    puddleMat = new THREE.MeshPhongMaterial({ color: 0x4b555c, specular: 0x9aa4ac, shininess: 70, transparent: true, opacity: 0.78, depthWrite: false });
    crackMat = new THREE.MeshBasicMaterial({ color: 0x0b0907, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    pipeMat = new THREE.MeshLambertMaterial({ color: 0x3b3f42, side: THREE.DoubleSide });
    jetMat = new THREE.PointsMaterial({ color: 0xc9dbe2, size: 0.32, transparent: true, opacity: 0.72, depthWrite: false });
    if (CBZ.groundMaskExempt) [secMat, darkMat, puddleMat, pipeMat, jetMat].forEach(CBZ.groundMaskExempt);
  }
  function hexRGB(hex, k, out) {
    out[0] = (((hex >> 16) & 255) / 255) * k; out[1] = (((hex >> 8) & 255) / 255) * k; out[2] = ((hex & 255) / 255) * k;
  }
  function makeSlab(seq, poly, thick) {
    const S = seq.sampler;
    let cx = 0, cz = 0;
    for (let i = 0; i < poly.length; i++) { cx += poly[i][0]; cz += poly[i][1]; }
    cx /= poly.length; cz /= poly.length;
    const hit = S ? S.at(cx, cz) : null;
    const topY = hit ? hit.y : seq.gy;
    const tri = hit ? hit.tri : null;
    const n = poly.length;
    const P = [], U = [], C = [];
    const uv = [0, 0], col = [0, 0, 0];
    const yAt = function (px, pz) { const s = S ? S.at(px, pz) : null; return (s ? s.y : topY) - topY; };
    // the top: a fan about the centroid, in the surface's own material
    const yc = 0;
    for (let i = 0; i < n; i++) {
      const p = poly[i], q = poly[(i + 1) % n];
      const ya = yAt(p[0], p[1]), yb = yAt(q[0], q[1]);
      P.push(0, yc, 0, q[0] - cx, yb, q[1] - cz, p[0] - cx, ya, p[1] - cz);
      S.uvAt(tri, cx, cz, uv); U.push(uv[0], uv[1]);
      S.uvAt(tri, q[0], q[1], uv); U.push(uv[0], uv[1]);
      S.uvAt(tri, p[0], p[1], uv); U.push(uv[0], uv[1]);
      const tc = tri && tri.col;
      for (let k = 0; k < 3; k++) { if (tc) C.push(tc[0], tc[1], tc[2]); else C.push(1, 1, 1); }
    }
    const topCount = P.length / 3;
    // the cut faces: the section's own layers down to the slab's thickness
    const L = seq.layers;
    const bands = [];
    for (let i = 0; i < L.length && L[i].top < thick; i++) bands.push([L[i].top, Math.min(thick, L[i].bot), L[i].c]);
    for (let i = 0; i < n; i++) {
      const p = poly[i], q = poly[(i + 1) % n];
      const ya = yAt(p[0], p[1]), yb = yAt(q[0], q[1]);
      for (let b = 0; b < bands.length; b++) {
        const t0 = bands[b][0], t1 = bands[b][1];
        hexRGB(bands[b][2], 0.62 + h01(p[0], q[1], b) * 0.2, col);
        const ax = p[0] - cx, az = p[1] - cz, bx = q[0] - cx, bz = q[1] - cz;
        P.push(ax, ya - t0, az, bx, yb - t0, bz, bx, yb - t1, bz);
        P.push(ax, ya - t0, az, bx, yb - t1, bz, ax, ya - t1, az);
        for (let k = 0; k < 6; k++) { U.push(0, 0); C.push(col[0], col[1], col[2]); }
      }
    }
    // the underside
    hexRGB(bands.length ? bands[bands.length - 1][2] : 0x6a4d31, 0.4, col);
    for (let i = 0; i < n; i++) {
      const p = poly[i], q = poly[(i + 1) % n];
      P.push(0, -thick, 0, p[0] - cx, yAt(p[0], p[1]) - thick, p[1] - cz, q[0] - cx, yAt(q[0], q[1]) - thick, q[1] - cz);
      for (let k = 0; k < 3; k++) { U.push(0, 0); C.push(col[0], col[1], col[2]); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(C, 3));
    geo.computeVertexNormals();
    geo.addGroup(0, topCount, 0);
    geo.addGroup(topCount, P.length / 3 - topCount, 1);
    let topMat;
    if (tri && tri.mat) topMat = exemptMat(tri.mat);
    else {
      topMat = new THREE.MeshLambertMaterial({ color: seq.shaftTop != null ? seq.shaftTop : seq.surfaceColor });
      if (CBZ.groundMaskExempt) CBZ.groundMaskExempt(topMat);
    }
    const m = new THREE.Mesh(geo, [topMat, secMat]);
    m.position.set(cx, topY, cz);
    m.castShadow = true; m.receiveShadow = true;
    m.userData.sinkBody = true;
    m.userData.transient = true;
    K.root().add(m);
    return m;
  }
  // a polygon cell of an annulus: arc from a0 to a1 between radii r0 and r1,
  // its edges jittered the way a slab breaks (shared edges share the jitter)
  function annulusCell(seq, r0, r1, a0, a1) {
    const pts = [];
    const nArc = Math.max(2, Math.ceil((a1 - a0) * r1 / 1.4));
    const j = function (a, r, s) { return r * (1 + (h01(Math.cos(a) * 7 + s, Math.sin(a) * 7, r) - 0.5) * 0.06); };
    const ja = function (a, s) { return a + (h01(s, a * 3, 9) - 0.5) * 0.05; };
    const A0 = ja(a0, r0), A1 = ja(a1, r0);
    for (let i = 0; i <= nArc; i++) { const a = A0 + (A1 - A0) * (i / nArc); const r = j(a, r1, 1); pts.push([seq.x + Math.cos(a) * r, seq.z + Math.sin(a) * r]); }
    if (r0 > 0.05) {
      for (let i = nArc; i >= 0; i--) { const a = A0 + (A1 - A0) * (i / nArc); const r = j(a, r0, 2); pts.push([seq.x + Math.cos(a) * r, seq.z + Math.sin(a) * r]); }
    } else pts.push([seq.x, seq.z]);
    // shrink toward the centroid: the GAP between slabs is the crack
    let cx = 0, cz = 0;
    for (let i = 0; i < pts.length; i++) { cx += pts[i][0]; cz += pts[i][1]; }
    cx /= pts.length; cz /= pts.length;
    for (let i = 0; i < pts.length; i++) { pts[i][0] = cx + (pts[i][0] - cx) * 0.975; pts[i][1] = cz + (pts[i][1] - cz) * 0.975; }
    // the ring above walks outward-then-inward: clockwise in xz (y up) for a
    // positive arc, so reverse it for the fan's winding
    pts.reverse();
    return pts;
  }

  /* ============================================================
     RIGID BODIES — cars, posts, trees, the crust. A box (the object's own
     extents in its own frame) with mass and inertia, gravity, and contact
     impulses at its corners and edge midpoints against:
       · the FLOOR under each contact point on its own — CBZ.floorAt, so
         inside the mouth it is the shaft's floor (stair, talus) and outside
         it is the ground. Per point is the whole difference: a car whose
         nose is over the hole and whose tail is not TIPS, about the lip.
       · the SHAFT WALL — a point below grade outside the mouth is inside
         rock, and is pushed back in radially, so a falling car scrapes down
         the wall instead of passing through it.
     Sequential impulses with restitution and Coulomb friction, the same
     contact model systems/debris.js uses for its pieces (whose single
     centre-sample floor could never tip a car over an edge — the reason
     this is not handed there until something is lying still).
     ============================================================ */
  const _q = new THREE.Quaternion(), _m4 = new THREE.Matrix4(), _m4b = new THREE.Matrix4(), _one = new THREE.Vector3(1, 1, 1);
  const _r = new THREE.Vector3(), _n = new THREE.Vector3(), _vr = new THREE.Vector3(), _t = new THREE.Vector3(), _tmp = new THREE.Vector3();
  const _m3 = new THREE.Matrix3();
  const _s = new THREE.Vector3(), _p = new THREE.Vector3();

  function frameOf(objs, yaw) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw || 0);
    const qi = q.clone().invert();
    const mn = new THREE.Vector3(Infinity, Infinity, Infinity), mx = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    const c = new THREE.Vector3();
    for (let i = 0; i < objs.length; i++) {
      objs[i].updateWorldMatrix(true, true);
      objs[i].traverse(function (o) {
        if (!o.isMesh || !o.geometry || !o.visible) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        const bb = o.geometry.boundingBox;
        if (!isFinite(bb.min.x)) return;
        for (let k = 0; k < 8; k++) {
          c.set(k & 1 ? bb.max.x : bb.min.x, k & 2 ? bb.max.y : bb.min.y, k & 4 ? bb.max.z : bb.min.z)
            .applyMatrix4(o.matrixWorld).applyQuaternion(qi);
          mn.min(c); mx.max(c);
        }
      });
    }
    if (!isFinite(mn.x)) return null;
    const half = mx.clone().sub(mn).multiplyScalar(0.5);
    const centre = mn.clone().add(mx).multiplyScalar(0.5).applyQuaternion(q);
    return { q: q, half: half, centre: centre };
  }

  function makeBody(seq, objs, o) {
    const fr = o.frame || frameOf(objs, o.yaw || 0);
    if (!fr) return null;
    const hx = Math.max(0.05, fr.half.x), hy = Math.max(0.05, fr.half.y), hz = Math.max(0.05, fr.half.z);
    const mass = o.mass || Math.max(20, 8 * hx * hy * hz * (o.density || 600));
    const b = {
      kind: o.kind || "prop", seq: seq, objs: [],
      pos: fr.centre.clone(), q: fr.q.clone(),
      v: new THREE.Vector3(), w: new THREE.Vector3(),
      hx: hx, hy: hy, hz: hz, mass: mass, invM: 1 / mass,
      // solid box inertia, principal axes in the body frame
      iI: new THREE.Vector3(3 / (mass * (hy * hy + hz * hz)), 3 / (mass * (hx * hx + hz * hz)), 3 / (mass * (hx * hx + hy * hy))),
      e: o.e != null ? o.e : 0.12, mu: o.mu != null ? o.mu : 0.65,
      pts: [], asleep: false, calm: 0, supT: 0, t: 0, landed: false, maxDrop: 0, y0: fr.centre.y,
      lean: null, onLand: o.onLand || null, rec: o.rec || null, label: o.label || null,
      restore: [], mats: [], dead: false,
    };
    // contact points: the eight corners, plus edge midpoints on a long box
    // (a 4.6 m car balanced on the lip at mid-length needs a point there)
    const xs = hx > 1.2 ? [-hx, 0, hx] : [-hx, hx];
    const zs = hz > 1.2 ? [-hz, 0, hz] : [-hz, hz];
    const ys = hy > 1.5 ? [-hy, 0, hy] : [-hy, hy];
    for (let i = 0; i < xs.length; i++) for (let j = 0; j < ys.length; j++) for (let k = 0; k < zs.length; k++) {
      const outer = (Math.abs(xs[i]) > 0) + (Math.abs(ys[j]) > 0) + (Math.abs(zs[k]) > 0);
      if (outer >= 2) b.pts.push(new THREE.Vector3(xs[i], ys[j], zs[k]));
    }
    // each object rides the body at its current offset
    _m4.compose(b.pos, b.q, _one).invert();
    for (let i = 0; i < objs.length; i++) {
      const ob = objs[i];
      ob.updateWorldMatrix(true, true);
      b.objs.push({ o: ob, rel: _m4.clone().multiply(ob.matrixWorld) });
      b.restore.push({ o: ob, p: ob.position.clone(), q: ob.quaternion.clone(), s: ob.scale.clone(), vis: ob.visible });
      ob.userData.sinkBody = true;
      exemptObject(ob, b.mats);
    }
    seq.bodies.push(b);
    audit.bodies++;
    return b;
  }
  const _mBody = new THREE.Matrix4(), _mPar = new THREE.Matrix4();
  function writePose(b) {
    _mBody.compose(b.pos, b.q, _one);
    for (let i = 0; i < b.objs.length; i++) {
      const e = b.objs[i], ob = e.o;
      _m4.multiplyMatrices(_mBody, e.rel);
      // into the object's parent space (an identity root is the usual case)
      if (ob.parent) { ob.parent.updateWorldMatrix(true, false); _m4.premultiply(_mPar.copy(ob.parent.matrixWorld).invert()); }
      _m4.decompose(ob.position, ob.quaternion, ob.scale);
      ob.updateMatrixWorld(true);
    }
  }
  function applyIinv(b, vIn, out) {
    // world inverse inertia: R diag R^T
    out.copy(vIn).applyQuaternion(_q.copy(b.q).invert());
    out.x *= b.iI.x; out.y *= b.iI.y; out.z *= b.iI.z;
    out.applyQuaternion(b.q);
    return out;
  }
  const CON = [];
  for (let i = 0; i < 24; i++) CON.push({ r: new THREE.Vector3(), n: new THREE.Vector3(), pen: 0 });
  // what holds the point (px,py,pz) up, and from which side
  function contactAt(seq, px, py, pz, c) {
    const h = seq.shaft;
    if (h) {
      const dx = px - h.x, dz = pz - h.z, d = Math.hypot(dx, dz);
      const wallR = h.mouth;
      if (d >= wallR && py < h.gy - 0.45) {
        // inside the rock beside the shaft: back out through the wall
        c.n.set(-dx / d, 0, -dz / d); c.pen = d - wallR;
        return c.pen > 0;
      }
    }
    let fy = floorY(px, pz, py + 0.6);
    if (seq.phase === "warn" && seq.sagAt) fy -= seq.sagAt(px, pz);
    c.n.set(0, 1, 0); c.pen = fy - py;
    /* DEEP UNDER A SURFACE INSIDE THE MOUTH = INSIDE A LEDGE, FROM THE SIDE.
       The floor query answers a slump step's TOP for its whole column, so a
       car falling past the stair read "8 m under the floor" and was lifted
       onto the step — the car that climbed back out of the hole. Out of a
       ledge is sideways, toward the middle. */
    if (h && c.pen > 0.7) {
      const dx = px - h.x, dz = pz - h.z, d = Math.hypot(dx, dz) || 1;
      if (d < h.mouth) { c.n.set(-dx / d, 0, -dz / d); c.pen = Math.min(0.5, Math.max(0.05, d - h.stepIn)); }
    }
    return c.pen > 0;
  }
  function contacts(b) {
    _m3.setFromMatrix4(_m4.makeRotationFromQuaternion(b.q));
    let n = 0;
    for (let i = 0; i < b.pts.length && n < CON.length; i++) {
      const c = CON[n];
      c.r.copy(b.pts[i]).applyMatrix3(_m3);
      const px = b.pos.x + c.r.x, py = b.pos.y + c.r.y, pz = b.pos.z + c.r.z;
      if (contactAt(b.seq, px, py, pz, c)) n++;
    }
    return n;
  }
  function stepBody(b, dt) {
    b.t += dt;
    b.v.y -= G * dt;
    b.pos.addScaledVector(b.v, dt);
    const wl = b.w.length();
    if (wl > 1e-6) { _q.setFromAxisAngle(_tmp.copy(b.w).divideScalar(wl), wl * dt); b.q.premultiply(_q).normalize(); }
    const nC = contacts(b);
    let hardest = 0;
    if (nC) {
      for (let it = 0; it < 4; it++) {
        for (let k = 0; k < nC; k++) {
          const c = CON[k];
          _vr.crossVectors(b.w, c.r).add(b.v);
          const vn = _vr.dot(c.n);
          if (vn >= 0) continue;
          if (it === 0 && -vn > hardest) hardest = -vn;
          _t.crossVectors(c.r, c.n);
          applyIinv(b, _t, _s);
          const kN = b.invM + _p.crossVectors(_s, c.r).dot(c.n);
          const rest = it === 0 && -vn > 1.5 ? b.e : 0;
          const jn = -(1 + rest) * vn / kN;
          b.v.addScaledVector(c.n, jn * b.invM);
          _t.crossVectors(c.r, c.n).multiplyScalar(jn);
          b.w.add(applyIinv(b, _t, _s));
          // friction
          _vr.crossVectors(b.w, c.r).add(b.v);
          _t.copy(_vr).addScaledVector(c.n, -_vr.dot(c.n));
          const vt = _t.length();
          if (vt > 1e-5) {
            _t.divideScalar(vt);
            _p.crossVectors(c.r, _t);
            applyIinv(b, _p, _s);
            const kT = b.invM + _p.crossVectors(_s, c.r).dot(_t);
            const jt = Math.min(vt / kT, b.mu * jn);
            b.v.addScaledVector(_t, -jt * b.invM);
            _p.crossVectors(c.r, _t).multiplyScalar(-jt);
            b.w.add(applyIinv(b, _p, _s));
          }
        }
      }
      // positional correction: the deepest floor point and the deepest wall
      // point, each out along its own normal
      let fp = 0, wp = 0, wx = 0, wz = 0;
      for (let k = 0; k < nC; k++) {
        const c = CON[k];
        if (c.n.y > 0.5) { if (c.pen > fp) fp = c.pen; }
        else if (c.pen > wp) { wp = c.pen; wx = c.n.x; wz = c.n.z; }
      }
      if (fp > 0.002) b.pos.y += Math.min(fp, 0.6) * 0.85;
      if (wp > 0.002) { b.pos.x += wx * Math.min(wp, 0.6) * 0.9; b.pos.z += wz * Math.min(wp, 0.6) * 0.9; }
      const f = Math.max(0, 1 - (nC >= 3 ? 2.2 : 0.8) * dt);
      b.w.multiplyScalar(f);
    } else {
      b.w.multiplyScalar(Math.max(0, 1 - 0.05 * dt));
    }
    return { nC: nC, hard: hardest };
  }

  function tickBodies(seq, dt) {
    let awake = 0;
    for (let i = 0; i < seq.bodies.length; i++) {
      const b = seq.bodies[i];
      if (b.dead) continue;
      if (b.lean) { tickLean(seq, b, dt); continue; }
      if (b.asleep) {
        b.supT += dt;
        if (b.supT > 0.3) {
          b.supT = 0;
          // still held? (the hole widening under it wakes it)
          const nC = contacts(b);
          let held = 0;
          for (let k = 0; k < nC; k++) if (CON[k].n.y > 0.5 && CON[k].pen > -0.02) held++;
          if (nC < 3 && held < 3) { probeSupport(b); }
        }
        continue;
      }
      /* IN FREE FLIGHT A BODY TOUCHES NOTHING: well above the floor and
         clear of the wall, it is gravity and spin and nothing else, and that
         costs nothing. Only bodies near a surface run the contact solve, and
         only AWAKE_CAP of them a frame — the rest coast ballistically this
         frame (never frozen in the air, never dropped). */
      if (free(seq, b) || awake >= AWAKE_CAP) {
        ballistic(b, dt);
        const drop0 = b.y0 - b.pos.y;
        if (drop0 > b.maxDrop) b.maxDrop = drop0;
        writePose(b);
        continue;
      }
      awake++;
      const sub = 2, h = dt / sub;
      let res = null;
      for (let s = 0; s < sub; s++) res = stepBody(b, h);
      // never below the hole's floor (a numerical tunnel would lose it)
      if (seq.shaft && b.pos.y < seq.shaft.bottom - 2) { b.pos.y = seq.shaft.bottom + b.hy; b.v.set(0, 0, 0); }
      const drop = b.y0 - b.pos.y;
      if (drop > b.maxDrop) b.maxDrop = drop;
      if (res.hard > 3.5) landed(seq, b, res.hard);
      writePose(b);
      const still = res.nC >= 3 && b.v.lengthSq() < 0.05 && b.w.lengthSq() < 0.08;
      b.calm = still ? b.calm + dt : 0;
      if (b.calm > 0.6) { b.asleep = true; b.v.set(0, 0, 0); b.w.set(0, 0, 0); if (b.onSleep) b.onSleep(b); }
      if (b.t > 40 && res.nC) { b.asleep = true; b.v.set(0, 0, 0); b.w.set(0, 0, 0); }
    }
    seq.awake = awake;
  }
  function free(seq, b) {
    const h = seq.shaft;
    if (!h) return false;
    const R = Math.hypot(b.hx, b.hy, b.hz);
    const d = Math.hypot(b.pos.x - h.x, b.pos.z - h.z);
    if (d + R > h.stepIn - 0.2) return false;            // near the wall or the ledges
    if (b.pos.y - R < h.gy - 0.2 && b.pos.y - R > h.bottom + h.coneH + 1.5 + Math.max(0, -b.v.y * 0.05)) return true;
    return false;
  }
  function ballistic(b, dt) {
    b.t += dt;
    b.v.y -= G * dt;
    b.pos.addScaledVector(b.v, dt);
    const wl = b.w.length();
    if (wl > 1e-6) { _q.setFromAxisAngle(_tmp.copy(b.w).divideScalar(wl), wl * dt); b.q.premultiply(_q).normalize(); }
    // never through the floor, however it got here
    const fy = floorY(b.pos.x, b.pos.z, b.pos.y + 0.5);
    if (b.pos.y - b.hy < fy) { b.pos.y = fy + b.hy; if (b.v.y < 0) b.v.y = 0; }
  }
  // a sleeper whose support may be gone: look properly, wake it if so
  function probeSupport(b) {
    _m3.setFromMatrix4(_m4.makeRotationFromQuaternion(b.q));
    let under = 0;
    for (let i = 0; i < b.pts.length; i++) {
      const c = CON[0];
      c.r.copy(b.pts[i]).applyMatrix3(_m3);
      const px = b.pos.x + c.r.x, py = b.pos.y + c.r.y, pz = b.pos.z + c.r.z;
      contactAt(b.seq, px, py - 0.06, pz, c);
      if (c.pen > 0) under++;
    }
    if (under < 3) { b.asleep = false; b.calm = 0; b.t = Math.min(b.t, 30); }
  }
  // a hard landing: crush whoever it came down on, and crust breaks up
  function landed(seq, b, speed) {
    if (!b.landed) {
      b.landed = true;
      if (b.kind === "car" && seq.shaft && b.pos.y < seq.gy - 2) seq.carsDown++;
      if (CBZ.shake && K.nearCam(b.pos.x, b.pos.z, 40)) CBZ.shake(Math.min(0.5, 0.06 + speed * 0.02));
      if (speed > 6) K.sfx("collapse", b.pos.x, b.pos.z);
    }
    if (speed > 4 && seq.shaft) {
      const R = Math.max(b.hx, b.hz) + 0.6;
      eachActor(seq, function (a) {
        if (!a || !a.pos || a.dead) return;
        if (Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) > R) return;
        if (a.pos.y > b.pos.y + b.hy + 0.5 || a.pos.y < b.pos.y - b.hy - 2) return;
        K.stats.crushed++;
        K.hurt(a, Math.min(400, b.mass * speed * 0.004), "crushed under the collapsing street", { fromX: b.pos.x, fromZ: b.pos.z, force: 6, fling: 1 });
      });
    }
    if (b.kind === "slab" && speed > 4 && seq.shaft && b.pos.y < seq.gy - 1.5) breakSlab(seq, b);
  }
  // a crust slab that hits the bottom breaks into pieces OF ITSELF and the
  // debris system owns them from here (rubble that freezes into one draw)
  function breakSlab(seq, b) {
    const m = b.objs[0] && b.objs[0].o;
    b.dead = true;
    if (!m) return;
    if (CBZ.debris && CBZ.debris.shatter) {
      try {
        CBZ.debris.shatter(m, { kind: seq.road ? "asphalt" : "dirt", power: 0.5, maxPieces: PHONE ? 3 : 5, owner: "groundshaft", dust: 0.5, grit: 0.4,
          velocity: { x: b.v.x * 0.3, y: 0, z: b.v.z * 0.3 } });
      } catch (e) {}
    }
    if (m.parent) m.parent.remove(m);
    if (m.geometry) m.geometry.dispose();
    audit.slabs++;
  }

  /* ---- the LEAN: a post or a tree on the ground that is going, tipping
     about its own foot toward the hole before anything has fallen ---- */
  function startLean(seq, b, maxDeg) {
    const dx = seq.x - b.pos.x, dz = seq.z - b.pos.z, d = Math.hypot(dx, dz) || 1;
    b.lean = { nx: dx / d, nz: dz / d, max: maxDeg * Math.PI / 180, a: 0,
      foot: new THREE.Vector3(b.pos.x, b.pos.y - b.hy, b.pos.z), p0: b.pos.clone(), q0: b.q.clone() };
  }
  function tickLean(seq, b, dt) {
    const L = b.lean;
    const k = seq.phase === "warn" ? smooth(0.25, 1, seq.t / seq.warnSecs) : 1;
    const want = L.max * k;
    if (Math.abs(want - L.a) < 1e-4) { if (seq.phase !== "warn") releaseIfUnsupported(seq, b); return; }
    L.a += (want - L.a) * Math.min(1, dt * 3);
    const axis = _tmp.set(L.nz, 0, -L.nx).normalize();
    _q.setFromAxisAngle(axis, L.a);
    b.q.copy(L.q0).premultiply(_q);
    b.pos.copy(L.p0).sub(L.foot).applyQuaternion(_q).add(L.foot);
    writePose(b);
    if (seq.phase !== "warn") releaseIfUnsupported(seq, b);
  }
  function releaseIfUnsupported(seq, b) {
    const h = seq.shaft;
    if (!h) return;
    const L = b.lean;
    if (Math.hypot(L.foot.x - h.x, L.foot.z - h.z) > h.mouth + 0.5) return;
    // its footing is gone: it falls, already leaning, already turning
    b.lean = null;
    b.w.set(L.nz, 0, -L.nx).multiplyScalar(0.9);
    b.v.set(L.nx * 0.6, -0.2, L.nz * 0.6);
    b.asleep = false;
    audit.props++;
  }

  /* ============================================================
     WHAT STANDS ON THE GROUND: found once, at the start of the warning,
     inside the final radius plus a margin — and taken when the rim reaches
     it. Four shapes of "a thing standing there", one rule each:
       · a CAR       the host's records (opts.cars), else CBZ.cityCars
       · a PROP      a small mesh (or several sharing one footing: a trunk
                     and its crown) standing on the ground
       · a MERGED    a post inside a big merged dressing mesh (the island's
                     street furniture is ONE geometry): its triangles are
                     lifted out into their own mesh and the source's are
                     collapsed, so it is the same post, not a copy
       · an INSTANCE one slot of an InstancedMesh, the same way
     ============================================================ */
  function carList(seq) {
    if (seq.opts.cars) { try { return seq.opts.cars() || []; } catch (e) { return []; } }
    if (K.survMode()) return [];
    const C = CBZ.cityCars || [], out = [];
    for (let i = 0; i < C.length; i++) {
      const c = C[i];
      if (!c || !c.group || c.dead || c.sunk) continue;
      out.push({ obj: c.group, x: c.pos.x, z: c.pos.z, yaw: c.heading != null ? c.heading : c.group.rotation.y, rec: c,
        take: function () { c.dead = true; c.sunk = true; c.ai = false; c.v = 0; c.vx = 0; c.vz = 0; if (c.collider) removeCol(c.collider); },
        restore: function () { c.dead = false; c.sunk = false; } });
    }
    return out;
  }
  function removeCol(col) {
    if (CBZ.colliderRemove) { try { if (CBZ.colliderRemove(col)) return true; } catch (e) {} }
    const A = CBZ.colliders || [];
    const i = A.indexOf(col);
    if (i >= 0) { A.splice(i, 1); if (CBZ.markCollidersDirty) CBZ.markCollidersDirty(); return true; }
    return false;
  }
  function addCol(col) {
    if (CBZ.colliderAdd) { try { CBZ.colliderAdd(col); return; } catch (e) {} }
    if (CBZ.colliders && CBZ.colliders.indexOf(col) < 0) { CBZ.colliders.push(col); if (CBZ.markCollidersDirty) CBZ.markCollidersDirty(); }
  }
  /* NO INVISIBLE FLOORS, NO INVISIBLE WALLS. A bench, a bollard, a kerb box
     or a bus-stop slab registered a collider (or a walk-on platform) where
     the ground was; the ground is gone and so are they. Anything whose
     footprint now lies over the mouth and that stood at grade is taken out
     of the world's solids (and put back if the hole is ever reset). A
     building's own walls are not touched here — they go when it falls. */
  function clearSolids(seq) {
    const h = seq.shaft; if (!h) return;
    const keep = seq.keepCols || (seq.keepCols = (function () {
      const k = new Set();
      for (let i = 0; i < seq.buildings.length; i++) {
        const B = seq.buildings[i];
        (B.colliders || []).forEach(function (c) { k.add(c); });
        (B.platforms || []).forEach(function (c) { k.add(c); });
      }
      return k;
    })());
    const inMouth = function (c) {
      if (!c || keep.has(c) || c.debris) return false;
      if (!(c.maxX - c.minX < h.mouth * 1.5 && c.maxZ - c.minZ < h.mouth * 1.5)) return false;
      const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
      return Math.hypot(cx - h.x, cz - h.z) < h.mouth - 0.15;
    };
    const C = CBZ.colliders || [];
    for (let i = C.length - 1; i >= 0; i--) {
      const c = C[i];
      if (!inMouth(c)) continue;
      if (c.y1 != null && c.y1 > h.gy + 6) continue;           // something tall standing over it, not a floor
      if (c.y0 != null && c.y0 < h.bottom) continue;
      if (removeCol(c)) seq.solids.push(["col", c]);
    }
    const P = CBZ.platforms || [];
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      if (!inMouth(p)) continue;
      if (p.top != null && (p.top > h.gy + 6 || p.top < h.bottom)) continue;
      P.splice(i, 1);
      seq.solids.push(["plat", p]);
    }
    if (CBZ.markPlatformsDirty) CBZ.markPlatformsDirty();
  }
  function buildingList(seq) {
    if (seq.opts.buildings) { try { return seq.opts.buildings() || []; } catch (e) { return []; } }
    return [];
  }

  function scanProps(seq) {
    const R = seq.r * 1.25 + 1.5, x = seq.x, z = seq.z, gy = seq.gy;
    const skip = new Set();
    const cars = carList(seq);
    for (let i = 0; i < cars.length; i++) if (cars[i].obj) skip.add(cars[i].obj);
    const bl = buildingList(seq);
    for (let i = 0; i < bl.length; i++) if (bl[i].group) skip.add(bl[i].group);
    const rigs = rigSet();
    const feet = [], uppers = [];    // small meshes standing on the ground / hung above it
    const merged = [], inst = [];
    K.root().traverse(function (o) {
      if (!o.isMesh || !o.visible || !o.geometry) return;
      if (isRig(o) || underAny(o, rigs) || underAny(o, skip)) return;
      const geo = o.geometry;
      if (!geo.boundingBox) geo.computeBoundingBox();
      if (o.isInstancedMesh) { inst.push(o); return; }
      _box.copy(geo.boundingBox).applyMatrix4(o.matrixWorld);
      if (_box.max.x < x - R || _box.min.x > x + R || _box.max.z < z - R || _box.min.z > z + R) return;
      const sx = _box.max.x - _box.min.x, sz = _box.max.z - _box.min.z, sy = _box.max.y - _box.min.y;
      if (_box.max.y < gy + 0.3 || _box.min.y > gy + 9) return;          // ground paint, or a roof
      if (sx < 4.5 && sz < 4.5 && sy > 0.3) {
        // a separate small thing (a pole, a trunk, a crown, a hydrant)
        const fx = (_box.min.x + _box.max.x) / 2, fz = (_box.min.z + _box.max.z) / 2;
        if (Math.hypot(fx - x, fz - z) > R) return;
        (_box.min.y < gy + 0.6 ? feet : uppers).push({ o: o, x: fx, z: fz, x0: _box.min.x, x1: _box.max.x, z0: _box.min.z, z1: _box.max.z });
        return;
      }
      // a big mesh reaching above the ground here: a merged dressing to search
      if (sy > 0.6 && !o.isSkinnedMesh) merged.push(o);
    });
    seq.props = [];
    /* ONE THING = ONE FOOTING. Everything touching the ground within 0.8 m of
       another footing is the same thing (a pole and its base plate); every
       piece hung above (a crown, a lamp arm, a luminaire) joins the footing
       nearest under its own footprint, within 2.5 m. A piece with no footing
       under it is not standing on this ground and is left alone. */
    const G = [];
    for (let i = 0; i < feet.length; i++) {
      const f = feet[i];
      let g = null;
      for (let k = 0; k < G.length; k++) if (Math.hypot(G[k].x - f.x, G[k].z - f.z) < 0.8) { g = G[k]; break; }
      if (!g) { g = { x: f.x, z: f.z, objs: [] }; G.push(g); }
      g.objs.push(f.o);
    }
    for (let i = 0; i < uppers.length; i++) {
      const u = uppers[i];
      let best = null, bd = 2.5;
      for (let k = 0; k < G.length; k++) {
        const g = G[k];
        const dx = Math.max(u.x0 - g.x, 0, g.x - u.x1), dz = Math.max(u.z0 - g.z, 0, g.z - u.z1);
        const d = Math.hypot(dx, dz);
        if (d < bd) { bd = d; best = g; }
      }
      if (best) best.objs.push(u.o);
    }
    for (let k = 0; k < G.length; k++) seq.props.push({ objs: G[k].objs, x: G[k].x, z: G[k].z, kind: "prop" });
    for (let i = 0; i < merged.length && seq.props.length < 60; i++) extractMerged(seq, merged[i], R);
    for (let i = 0; i < inst.length && seq.props.length < 60; i++) extractInstances(seq, inst[i], R);
  }

  /* a merged dressing: the triangles of one standing thing, found by
     connectivity through a 0.3 m voxel grid of everything above the curb */
  function extractMerged(seq, o, R) {
    const geo = o.geometry, pa = geo.attributes.position;
    if (!pa || o.isSkinnedMesh) return;
    const idx = geo.index ? geo.index.array : null;
    const nT = idx ? idx.length / 3 : pa.count / 3;
    const M = o.matrixWorld, gy = seq.gy, x = seq.x, z = seq.z;
    const cand = [];
    const W = [];
    for (let t = 0; t < nT; t++) {
      const ia = idx ? idx[t * 3] : t * 3, ib = idx ? idx[t * 3 + 1] : t * 3 + 1, ic = idx ? idx[t * 3 + 2] : t * 3 + 2;
      _v0.fromBufferAttribute(pa, ia).applyMatrix4(M);
      if (Math.abs(_v0.x - x) > R + 3 || Math.abs(_v0.z - z) > R + 3) continue;
      _v1.fromBufferAttribute(pa, ib).applyMatrix4(M);
      _v2.fromBufferAttribute(pa, ic).applyMatrix4(M);
      const cx = (_v0.x + _v1.x + _v2.x) / 3, cy = (_v0.y + _v1.y + _v2.y) / 3, cz = (_v0.z + _v1.z + _v2.z) / 3;
      if (Math.hypot(cx - x, cz - z) > R + 2.5) continue;
      if (Math.max(_v0.y, _v1.y, _v2.y) < gy + 0.18) continue;   // the curb and the paint stay with the ground
      cand.push(t);
      W.push([_v0.x, _v0.y, _v0.z, _v1.x, _v1.y, _v1.z, _v2.x, _v2.y, _v2.z, ia, ib, ic]);
    }
    if (!cand.length) return;
    // union-find over voxels
    const VX = 0.3, parent = new Int32Array(cand.length);
    for (let i = 0; i < parent.length; i++) parent[i] = i;
    const find = function (i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const vox = new Map();
    for (let i = 0; i < cand.length; i++) {
      const w = W[i];
      for (let k = 0; k < 3; k++) {
        const key = Math.floor(w[k * 3] / VX) + "," + Math.floor(w[k * 3 + 1] / VX) + "," + Math.floor(w[k * 3 + 2] / VX);
        const o2 = vox.get(key);
        if (o2 == null) vox.set(key, i);
        else { const a = find(i), b = find(o2); if (a !== b) parent[a] = b; }
      }
    }
    const comps = new Map();
    for (let i = 0; i < cand.length; i++) { const r = find(i); (comps.get(r) || comps.set(r, []).get(r)).push(i); }
    comps.forEach(function (list) {
      if (seq.props.length >= 60) return;
      let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity, mnz = Infinity, mxz = -Infinity;
      for (let i = 0; i < list.length; i++) {
        const w = W[list[i]];
        for (let k = 0; k < 3; k++) {
          const px = w[k * 3], py = w[k * 3 + 1], pz = w[k * 3 + 2];
          if (px < mnx) mnx = px; if (px > mxx) mxx = px; if (py < mny) mny = py; if (py > mxy) mxy = py; if (pz < mnz) mnz = pz; if (pz > mxz) mxz = pz;
        }
      }
      // a standing thing: taller than a kerb, smaller than a fence line, on
      // this ground, within reach of the rim
      if (mxy - mny < 0.8 || mxx - mnx > 6 || mxz - mnz > 6 || mny > gy + 0.5) return;
      // its footing: the lowest triangles' centre
      let fx = 0, fz = 0, fn = 0;
      for (let i = 0; i < list.length; i++) {
        const w = W[list[i]];
        if (Math.min(w[1], w[4], w[7]) < mny + 0.35) { fx += (w[0] + w[3] + w[6]) / 3; fz += (w[2] + w[5] + w[8]) / 3; fn++; }
      }
      if (!fn) return;
      fx /= fn; fz /= fn;
      if (Math.hypot(fx - x, fz - z) > seq.r * 1.15 + 0.5) return;
      seq.props.push({ merged: { src: o, list: list.map(function (i) { return cand[i]; }), W: list.map(function (i) { return W[i]; }) }, x: fx, z: fz, kind: "post" });
    });
  }
  // lift a merged thing's triangles out into its own mesh; collapse them in
  // the source (degenerate, so the index/array keeps its layout)
  function liftMerged(seq, P) {
    const src = P.merged.src, geo = src.geometry, pa = geo.attributes.position;
    const idx = geo.index;
    const mats = Array.isArray(src.material) ? src.material : null;
    const col = geo.attributes.color || null, uv = geo.attributes.uv || null;
    const n = P.merged.list.length;
    const pos = new Float32Array(n * 9), cc = col ? new Float32Array(n * 9) : null, uu = uv ? new Float32Array(n * 6) : null;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { const w = P.merged.W[i]; cx += w[0] + w[3] + w[6]; cy += w[1] + w[4] + w[7]; cz += w[2] + w[5] + w[8]; }
    cx /= n * 3; cy /= n * 3; cz /= n * 3;
    const save = [];
    for (let i = 0; i < n; i++) {
      const w = P.merged.W[i];
      for (let k = 0; k < 3; k++) {
        pos[i * 9 + k * 3] = w[k * 3] - cx; pos[i * 9 + k * 3 + 1] = w[k * 3 + 1] - cy; pos[i * 9 + k * 3 + 2] = w[k * 3 + 2] - cz;
        const vi = w[9 + k];
        if (cc) { cc[i * 9 + k * 3] = col.getX(vi); cc[i * 9 + k * 3 + 1] = col.getY(vi); cc[i * 9 + k * 3 + 2] = col.getZ(vi); }
        if (uu) { uu[i * 6 + k * 2] = uv.getX(vi); uu[i * 6 + k * 2 + 1] = uv.getY(vi); }
      }
      const t = P.merged.list[i];
      if (idx) {
        const a = idx.array;
        save.push([t, a[t * 3], a[t * 3 + 1], a[t * 3 + 2]]);
        a[t * 3 + 1] = a[t * 3]; a[t * 3 + 2] = a[t * 3];
      } else {
        save.push([t, pa.getX(t * 3 + 1), pa.getY(t * 3 + 1), pa.getZ(t * 3 + 1), pa.getX(t * 3 + 2), pa.getY(t * 3 + 2), pa.getZ(t * 3 + 2)]);
        pa.setXYZ(t * 3 + 1, pa.getX(t * 3), pa.getY(t * 3), pa.getZ(t * 3));
        pa.setXYZ(t * 3 + 2, pa.getX(t * 3), pa.getY(t * 3), pa.getZ(t * 3));
      }
    }
    if (idx) idx.needsUpdate = true; else pa.needsUpdate = true;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    if (cc) g.setAttribute("color", new THREE.BufferAttribute(cc, 3));
    if (uu) g.setAttribute("uv", new THREE.BufferAttribute(uu, 2));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mats ? mats[0] : src.material);
    m.position.set(cx, cy, cz);
    m.castShadow = true;
    K.root().add(m);
    audit.extracted++;
    return { mesh: m, undo: function () {
      for (let i = 0; i < save.length; i++) {
        const s = save[i], t = s[0];
        if (idx) { idx.array[t * 3] = s[1]; idx.array[t * 3 + 1] = s[2]; idx.array[t * 3 + 2] = s[3]; }
        else { pa.setXYZ(t * 3 + 1, s[1], s[2], s[3]); pa.setXYZ(t * 3 + 2, s[4], s[5], s[6]); }
      }
      if (idx) idx.needsUpdate = true; else pa.needsUpdate = true;
      if (m.parent) m.parent.remove(m);
      g.dispose();
    } };
  }
  function extractInstances(seq, im, R) {
    const n = im.count || 0, x = seq.x, z = seq.z;
    const mm = new THREE.Matrix4(), w = new THREE.Matrix4(), p = new THREE.Vector3();
    for (let i = 0; i < n && seq.props.length < 60; i++) {
      im.getMatrixAt(i, mm);
      w.multiplyMatrices(im.matrixWorld, mm);
      p.setFromMatrixPosition(w);
      if (Math.hypot(p.x - x, p.z - z) > seq.r * 1.15 + 0.5) continue;
      if (Math.abs(p.y - seq.gy) > 1.2) continue;
      _s.setFromMatrixScale(w);
      if (_s.x < 1e-4) continue;
      seq.props.push({ inst: { im: im, i: i, m: mm.clone(), w: w.clone() }, x: p.x, z: p.z, kind: "prop" });
    }
  }
  function liftInstance(seq, P) {
    const I = P.inst;
    let mat = I.im.material;
    if (I.im.instanceColor) {
      const c = new THREE.Color().fromBufferAttribute(I.im.instanceColor, I.i);
      mat = (Array.isArray(mat) ? mat[0] : mat).clone();
      if (mat.color) mat.color.multiply(c);
    }
    const m = new THREE.Mesh(I.im.geometry, mat);
    I.w.decompose(m.position, m.quaternion, m.scale);
    m.castShadow = true;
    K.root().add(m);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    I.im.setMatrixAt(I.i, zero); I.im.instanceMatrix.needsUpdate = true;
    audit.instanced++;
    return { mesh: m, undo: function () { I.im.setMatrixAt(I.i, I.m); I.im.instanceMatrix.needsUpdate = true; if (m.parent) m.parent.remove(m); } };
  }

  // make a prop record into a body (once): leaning if it stands on doomed
  // ground in the warning, falling if its footing is already gone
  function takeProp(seq, P) {
    if (P.body || P.failed) return P.body;
    let objs = P.objs, undo = null;
    if (P.merged) { const L = liftMerged(seq, P); objs = [L.mesh]; undo = L.undo; }
    else if (P.inst) { const L = liftInstance(seq, P); objs = [L.mesh]; undo = L.undo; }
    const b = makeBody(seq, objs, { kind: P.kind, density: P.kind === "post" ? 900 : 450, e: 0.1, mu: 0.7 });
    if (!b) { P.failed = true; if (undo) undo(); return null; }
    b.undo = undo;
    b.asleep = true;
    P.body = b;
    return b;
  }

  /* ============================================================
     THE BUILDING AT THE EDGE — ONE ADAPTER. When the shared collapse system
     publishes CBZ.collapse.undermine(building, region) it owns the whole
     motion and this hands it the region; until then this stages what an
     undermined building does — a corner drops, it tilts, it goes — and
     hands the falling part to the collapse engine as a topple toward the
     hole, with the lean already baked into the shell it cuts.
     ============================================================ */
  function footprintOver(B, h, R) {
    let n = 0, tot = 0;
    for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) {
      const px = B.x + (i / 6 - 0.5) * B.w, pz = B.z + (j / 6 - 0.5) * B.d;
      tot++;
      if (Math.hypot(px - h.x, pz - h.z) < R) n++;
    }
    return n / tot;
  }
  function undermine(seq, B) {
    if (B.state) return;
    const dx = seq.x - B.x, dz = seq.z - B.z, d = Math.hypot(dx, dz) || 1;
    B.nx = dx / d; B.nz = dz / d;
    B.t = 0; B.tilt = 0; B.maxTilt = 0; B.drop = 0; B.om = 0;
    audit.undermined++;
    const region = { x: seq.x, z: seq.z, r: seq.r, rNow: seq.rNow, gy: seq.gy, depth: seq.depth,
      bottom: seq.shaft ? seq.shaft.bottom : seq.gy - seq.depth, nx: B.nx, nz: B.nz, shaft: seq.shaft };
    if (CBZ.collapse && typeof CBZ.collapse.undermine === "function") {
      try { B.job = CBZ.collapse.undermine(B.rec || B, region); B.state = "handed"; B.via = "collapse.undermine"; return; } catch (e) { B.job = null; }
    }
    B.state = "corner"; B.via = "lean+collapse.play";
    if (B.group) {
      exemptObject(B.group, (B._mats = []));
      B.group.updateWorldMatrix(true, true);
      B.m0 = B.group.matrixWorld.clone();
      B.save = { p: B.group.position.clone(), q: B.group.quaternion.clone(), s: B.group.scale.clone() };
    }
    // the hinge: the base edge on the hole's side of the footprint
    B.hinge = new THREE.Vector3(B.x + B.nx * B.w * 0.5, B.gy, B.z + B.nz * B.d * 0.5);
    jamDoors(seq, B);
  }
  function poseBuilding(B) {
    if (!B.group || !B.m0) return;
    const axis = _tmp.set(B.nz, 0, -B.nx).normalize();
    _q.setFromAxisAngle(axis, B.tilt);
    _m4.makeTranslation(-B.hinge.x, -B.hinge.y, -B.hinge.z);
    _m4.premultiply(_m4b.makeRotationFromQuaternion(_q));
    _m4.premultiply(_m4b.makeTranslation(B.hinge.x, B.hinge.y - B.drop, B.hinge.z));
    _m4.multiply(B.m0);
    if (B.group.parent) { B.group.parent.updateWorldMatrix(true, false); _m4.premultiply(_m4b.copy(B.group.parent.matrixWorld).invert()); }
    _m4.decompose(B.group.position, B.group.quaternion, B.group.scale);
    B.group.updateMatrixWorld(true);
  }
  function tickBuilding(seq, B, dt) {
    if (!B.state || B.state === "down" || B.state === "handed") return;
    B.t += dt;
    if (B.state === "corner") {
      // the corner over the void goes first: a settling, not yet a fall
      const k = smooth(0, 1.4, B.t);
      B.drop = 0.45 * k; B.tilt = 0.035 * k;
      if (B.t > 1.4) { B.state = "tilt"; B.t = 0; K.sfx("rumble", B.x, B.z); }
    } else if (B.state === "tilt") {
      // the real hinge equation, resisted by what is still holding it
      B.om += (3 * G / (2 * Math.max(4, B.h))) * Math.sin(B.tilt) * dt * 0.55;
      B.tilt += B.om * dt;
      B.drop = 0.45 + B.tilt * 2.2;
      if (!B.glass && B.tilt > 0.07) { B.glass = true; if (CBZ.shatterGlass) { try { CBZ.shatterGlass(B.x, B.z, Math.max(B.w, B.d) * 0.8); } catch (e) {} } }
      if (B.tilt > 0.17) fallBuilding(seq, B);
    } else if (B.state === "falling") {
      if (B.job && B.job.phase === 2) B.state = "down";
      if (B.body && B.body.asleep) B.state = "down";
      if (B.t > 25) B.state = "down";
    }
    if (B.tilt > B.maxTilt) B.maxTilt = B.tilt;
    if (B.state === "corner" || B.state === "tilt") poseBuilding(B);
    if (CBZ.shake && K.nearCam(B.x, B.z, 60) && B.state !== "falling") CBZ.shake(0.05 + B.tilt);
  }
  function fallBuilding(seq, B) {
    B.state = "falling"; B.t = 0;
    K.sfx("collapse", B.x, B.z);
    const off = function () {
      if (B.colliders) for (let i = 0; i < B.colliders.length; i++) removeCol(B.colliders[i]);
      if (B.platforms && CBZ.platforms) for (let i = 0; i < B.platforms.length; i++) { const k = CBZ.platforms.indexOf(B.platforms[i]); if (k >= 0) CBZ.platforms.splice(k, 1); }
      if (CBZ.markPlatformsDirty) CBZ.markPlatformsDirty();
    };
    // the host's ledger first (survival keeps fallen/killfeed/rubble rules)
    if (B.onFall) {
      try { B.job = B.onFall(B.nx, B.nz, { mode: "topple", tilt: B.tilt, groundAt: floorY, hole: seq.shaft }); } catch (e) { B.job = null; }
      if (B.job) return;
    }
    if (CBZ.collapse && CBZ.collapse.play && CBZ.CONFIG.COLLAPSE_V2 !== false) {
      B.job = CBZ.collapse.play({
        root: K.root(), ox: B.x, oz: B.z, gy: B.gy, group: B.group,
        w: B.w, d: B.d, h: B.h, storeys: B.storeys || Math.max(1, Math.round(B.h / 3.2)),
        FH: B.h / Math.max(1, B.storeys || Math.round(B.h / 3.2)),
        wall: B.color != null ? B.color : 0x8b9097, style: B.facadeStyle || null,
        groundAt: function (x, z) { return floorY(x, z, B.gy + 2); },
        key: "sink:" + Math.round(B.x) + "," + Math.round(B.z),
      }, { mode: "topple", wound: { nx: B.nx, nz: B.nz, floor: 0 }, preShudder: 0.05,
        onSwap: function () { off(); if (B.group) B.group.visible = false; } });
      if (B.job) return;
    }
    // no collapse engine: the building itself becomes a body and falls in
    off();
    if (B.group) {
      B.body = makeBody(seq, [B.group], { kind: "building", density: 220, e: 0.05, mu: 0.8 });
      if (B.body) { B.body.w.set(B.nz, 0, -B.nx).multiplyScalar(0.25); B.body.asleep = false; }
    }
  }

  /* DOORS JAM: the frame racks as the corner settles. A jammed door is one no
     body may open (systems/bodydoors.js reads `jammed`), which is what makes
     the nav grid route the people inside to another way out. */
  function jamDoors(seq, B) {
    const D = CBZ.bodyDoors;
    if (!D || !D.near) return;
    let list = [];
    try { list = D.near(B.x, B.z, Math.max(B.w, B.d) * 0.7 + 1) || []; } catch (e) { list = []; }
    for (let i = 0; i < list.length; i++) { if (!list[i].jammed) { list[i].jammed = true; seq.jammed.push(list[i]); audit.doorsJammed++; } }
  }

  /* ============================================================
     CRACKS — one ribbon mesh. Every crack is a polyline with a birth time
     per segment; triangles are sorted by birth so ONE drawRange that grows
     each frame lets every crack lengthen at its own pace: radial cracks
     running out from the cover, then the concentric tension cracks that
     mark where the rim will be.
     ============================================================ */
  function buildCracks(seq) {
    const S = seq.sampler, x = seq.x, z = seq.z;
    const lines = [];
    const nR = 11 + ((seq.seed * 7) | 0) % 4;
    for (let i = 0; i < nR; i++) {
      let a = (i / nR) * TAU + (h01(seq.seed, i, 1) - 0.5) * 0.4;
      let r = seq.coreR * 0.97;
      const end = seq.r * (1.05 + h01(seq.seed, i, 2) * 0.35);
      const pts = [];
      const t0 = h01(seq.seed, i, 3) * 0.25;
      let t = t0;
      while (r < end) {
        pts.push([x + Math.cos(a) * r, z + Math.sin(a) * r, t]);
        const st = 0.5 + h01(seq.seed, i, r) * 0.6;
        r += st; a += (h01(seq.seed + i, r, 4) - 0.5) * 0.18; t += st / (seq.r * 1.4);
      }
      lines.push({ pts: pts, w: 0.07 + h01(seq.seed, i, 5) * 0.06 });
    }
    const rings = [seq.coreR * 1.06, (seq.coreR + seq.r) * 0.5, seq.r * 0.98, seq.r * 1.18];
    for (let k = 0; k < rings.length; k++) {
      const nArc = 3 + (k % 2);
      for (let j = 0; j < nArc; j++) {
        const a0 = (j / nArc) * TAU + h01(seq.seed, k, j) * 0.8;
        const span = 0.5 + h01(seq.seed, j, k) * 0.9;
        const pts = [];
        let t = 0.3 + k * 0.14 + h01(k, j, 6) * 0.1;
        for (let a = a0; a < a0 + span; a += 0.09) {
          const rr = rings[k] * (1 + (h01(seq.seed, a, k) - 0.5) * 0.04);
          pts.push([x + Math.cos(a) * rr, z + Math.sin(a) * rr, t]);
          t += 0.012;
        }
        lines.push({ pts: pts, w: 0.05 + k * 0.012 });
      }
    }
    const tris = [];
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i], P = L.pts;
      for (let j = 0; j < P.length - 1; j++) {
        const a = P[j], b = P[j + 1];
        const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
        const wa = L.w * (1 - 0.6 * j / P.length), wb = L.w * (1 - 0.6 * (j + 1) / P.length);
        const ox = -dz / l, oz = dx / l;
        const ya = (S && S.at(a[0], a[1]) || { y: seq.gy }).y + 0.022, yb = (S && S.at(b[0], b[1]) || { y: seq.gy }).y + 0.022;
        tris.push({ t: a[2], v: [a[0] + ox * wa, ya, a[1] + oz * wa, b[0] + ox * wb, yb, b[1] + oz * wb, b[0] - ox * wb, yb, b[1] - oz * wb] });
        tris.push({ t: a[2], v: [a[0] + ox * wa, ya, a[1] + oz * wa, b[0] - ox * wb, yb, b[1] - oz * wb, a[0] - ox * wa, ya, a[1] - oz * wa] });
      }
    }
    tris.sort(function (p, q) { return p.t - q.t; });
    const pos = new Float32Array(tris.length * 9);
    const births = new Float32Array(tris.length);
    for (let i = 0; i < tris.length; i++) { pos.set(tris[i].v, i * 9); births[i] = tris[i].t; }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.computeVertexNormals();
    g.setDrawRange(0, 0);
    const m = new THREE.Mesh(g, crackMat);
    m.renderOrder = 3;
    m.userData.transient = true;
    m.frustumCulled = false;
    K.root().add(m);
    seq.cracks = { mesh: m, births: births, n: 0 };
  }
  function tickCracks(seq) {
    const C = seq.cracks;
    if (!C) return;
    const k = seq.phase === "warn" ? seq.t / seq.warnSecs : 1.2;
    let n = C.n;
    while (n < C.births.length && C.births[n] <= k) n++;
    if (n !== C.n) { C.n = n; C.mesh.geometry.setDrawRange(0, n * 3); }
  }

  /* ============================================================
     THE BROKEN MAIN — a pipe sheared at the wall in the soil layer, and the
     water it carries arcing into the hole: a ring of particles on their
     ballistic paths (one Points draw), filling the pool below.
     ============================================================ */
  function breakPipes(seq) {
    const n = 1 + (h01(seq.seed, 7, 7) > 0.45 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const a = h01(seq.seed, i, 8) * TAU;
      const main = i === 0;
      const pr = main ? 0.26 : 0.16;
      const depth = main ? 1.5 + h01(seq.seed, i, 9) * 0.5 : 1.0;
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(pr, pr, 2.4, 12, 1, true), pipeMat);
      pipe.userData.transient = true;
      const N = PHONE ? 44 : 80;
      const P = new Float32Array(N * 3);
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(P, 3));
      const pts = new THREE.Points(g, jetMat);
      pts.frustumCulled = false;
      pts.userData.transient = true;
      K.root().add(pipe, pts);
      const rec = { a: a, pr: pr, depth: depth, pipe: pipe, pts: pts, N: N, flow: main ? 1 : 0.45, speed: main ? 7.5 : 4.5, t: 0, life: main ? 45 : 30 };
      seq.pipes.push(rec);
      seatPipe(seq, rec);
      audit.pipes++;
    }
  }
  function seatPipe(seq, p) {
    const h = seq.shaft; if (!h) return;
    const R = h.r * 1.0;
    const ca = Math.cos(p.a), sa = Math.sin(p.a);
    // half buried in the wall, a metre standing out over the void
    p.mx = seq.x + ca * (R - 1.0); p.mz = seq.z + sa * (R - 1.0); p.my = seq.gy - p.depth;
    p.pipe.position.set(seq.x + ca * (R - 0.0), p.my, seq.z + sa * (R - 0.0));
    p.pipe.rotation.set(0, 0, 0);
    p.pipe.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-ca, 0, -sa));
  }
  function tickPipes(seq, dt) {
    const h = seq.shaft;
    for (let i = 0; i < seq.pipes.length; i++) {
      const p = seq.pipes[i];
      p.t += dt;
      const on = p.t < p.life;
      const fade = on ? Math.min(1, (p.life - p.t) / 6) : 0;
      const arr = p.pts.geometry.attributes.position.array;
      const ca = Math.cos(p.a), sa = Math.sin(p.a);
      const life = 1.6;
      const floorY = h ? h.bottom + (h.waterLevel || 0) : seq.gy - seq.depth;
      for (let k = 0; k < p.N; k++) {
        const ph = ((p.t * 1.0 + k / p.N * life) % life);
        const j = h01(k, p.a, 3), jj = h01(k, 5, p.a);
        const sp = p.speed * (0.75 + j * 0.45) * (0.4 + 0.6 * fade);
        const tx = -sa, tz = ca;
        const vx = -ca * sp + tx * (jj - 0.5) * 1.2, vz = -sa * sp + tz * (jj - 0.5) * 1.2, vy = 1.2 + (j - 0.5) * 1.5;
        const y = p.my + vy * ph - 0.5 * G * ph * ph;
        if (!on || fade <= 0.02 || y < floorY) { arr[k * 3 + 1] = -1e5; continue; }
        arr[k * 3] = p.mx + vx * ph; arr[k * 3 + 1] = y; arr[k * 3 + 2] = p.mz + vz * ph;
      }
      p.pts.geometry.attributes.position.needsUpdate = true;
      // the flow fills the pool: m^3/s over the shaft's floor area
      if (h && on) seq.inflow += p.flow * 0.9 * fade * dt;
    }
  }

  /* ============================================================
     ACTORS — through the host seam, else the shaft's own
     ============================================================ */
  function eachActor(seq, fn) {
    if (seq.opts.eachActor) { try { seq.opts.eachActor(fn); } catch (e) {} return; }
    K.eachActor(fn);
  }
  /* the expanding rim takes whoever is standing on it. Bodies go through
     CBZ.body (the airborne integrator) where it exists so a bot is flung and
     owned until it lands instead of being snapped to the new floor. */
  function entrainActors(seq, r) {
    eachActor(seq, function (a) {
      if (!a || !a.pos || a.dead) return;
      const dx = a.pos.x - seq.x, dz = a.pos.z - seq.z, d = Math.hypot(dx, dz);
      if (d > r * 1.04) return;
      if (a.pos.y > seq.gy + 3) return;
      if (a.group) exemptObject(a.group, null);
      if (a.isPlayer && CBZ.playerChar && CBZ.playerChar.group) exemptObject(CBZ.playerChar.group, null);
      if (CBZ.body && CBZ.body.hit && !(CBZ.body.busy && CBZ.body.busy(a))) {
        const m = d || 1;
        try { CBZ.body.hit(a, { dir: { x: -dx / m, z: -dz / m }, force: 2 + rnd() * 2.5, fling: 0.6 + rnd() * 0.6 }); } catch (e) {}
      }
      if (a.isPlayer && CBZ.doSlowmo && !seq._beat) { seq._beat = 1; CBZ.doSlowmo(0.45); }
      if (seq.fell.indexOf(a) < 0) seq.fell.push(a);
    });
  }
  // anyone over a mouth is opted out of the mask (see exemptObject)
  function exemptActorsOver(seq) {
    const h = seq.shaft; if (!h) return;
    eachActor(seq, function (a) {
      if (!a || !a.pos || a._sinkEx) return;
      if (Math.hypot(a.pos.x - h.x, a.pos.z - h.z) > h.r * 1.1) return;
      a._sinkEx = true;
      if (a.group) exemptObject(a.group, null);
      if (a.isPlayer && CBZ.playerChar && CBZ.playerChar.group) exemptObject(CBZ.playerChar.group, null);
    });
  }

  /* ============================================================
     ROADS, NAV — the world's records follow the hole
     ============================================================ */
  function segOf(r) {
    if (r.len != null && r.x != null) {
      const hl = r.len / 2;
      return r.vertical ? [r.x, r.z - hl, r.x, r.z + hl, (r.w || 8) / 2] : [r.x - hl, r.z, r.x + hl, r.z, (r.w || 8) / 2];
    }
    if (r.ax != null) return [r.ax, r.az, r.bx, r.bz, (r.w || r.width || 8) / 2];
    if (r.x1 != null) return [r.x1, r.z1, r.x2, r.z2, (r.w || r.width || 8) / 2];
    if (r.a && r.b && r.a.x != null) return [r.a.x, r.a.z, r.b.x, r.b.z, (r.w || r.width || 8) / 2];
    return null;
  }
  function closeRoads(seq) {
    const lists = [];
    if (seq.opts.roads) { try { lists.push(seq.opts.roads() || []); } catch (e) {} }
    if (CBZ.city && CBZ.city.arena && CBZ.city.arena.roads && !K.survMode()) lists.push(CBZ.city.arena.roads);
    if (CBZ.island && CBZ.island.roads && K.survMode()) lists.push(CBZ.island.roads);
    const h = seq.shaft; if (!h) return;
    for (let L = 0; L < lists.length; L++) {
      const A = lists[L];
      for (let i = 0; i < A.length; i++) {
        const r = A[i];
        if (!r || r.noTraffic) continue;
        const s = segOf(r); if (!s) continue;
        const ex = s[2] - s[0], ez = s[3] - s[1], l2 = ex * ex + ez * ez;
        let t = l2 > 0 ? ((h.x - s[0]) * ex + (h.z - s[1]) * ez) / l2 : 0;
        t = clamp(t, 0, 1);
        const d = Math.hypot(s[0] + ex * t - h.x, s[1] + ez * t - h.z);
        if (d > h.r + s[4] * 0.3) continue;
        r.noTraffic = true; r.sinkhole = true; r._openCache = null;
        seq.roads.push(r);
        audit.roadsClosed++;
      }
    }
  }
  /* CBZ.navVoids: the one list "the ground is gone here" for path planners.
     systems/navgrid.js marks every cell inside one as blocked and rebuilds
     its window when the version moves. */
  const navVoids = CBZ.navVoids = CBZ.navVoids || [];
  CBZ.navVoidsVersion = CBZ.navVoidsVersion || 0;
  function publishVoid(seq) {
    const h = seq.shaft; if (!h) return;
    if (!seq.void) { seq.void = { x: h.x, z: h.z, r: 0, src: "sinkhole" }; navVoids.push(seq.void); }
    seq.void.r = h.r + 0.4;
    CBZ.navVoidsVersion++;
  }

  /* ============================================================
     THE EVENT
     ============================================================ */
  CBZ.groundShaftCollapse = function (x, z, o) {
    if (CBZ.CONFIG.GROUND_SHAFT === false || !CBZ.groundShaft) return null;
    o = o || {};
    fxMats();
    const r = Math.max(3, o.r || 9);
    const gy = o.gy != null ? o.gy : K.rawFloor(x, z);
    const seq = {
      x: x, z: z, r: r, gy: gy, opts: o, t: 0, T: 0,
      depth: o.depth || r * 3.2,
      coreR: r * (o.core || 0.55), rNow: 0,
      warnSecs: o.warnSecs != null ? o.warnSecs : 6,
      dropSecs: o.dropSecs != null ? o.dropSecs : 0.8,
      growSecs: o.growSecs != null ? o.growSecs : 6,
      phase: "warn", shaft: null, done: false, seed: o.seed != null ? o.seed : h01(x, z, 1),
      surface: o.surface || "asphalt", road: o.road != null ? !!o.road : (o.surface || "asphalt") === "asphalt",
      bodies: [], props: [], cars: [], buildings: [], pipes: [], roads: [], jammed: [], fell: [], slabs: [], solids: [],
      inflow: 0, carsDown: 0, log: [], logT: 0, awake: 0, mask: null, sagS: 0,
    };
    seq.surfaceColor = seq.road ? 0x2f2e2c : (K.survMode() ? 0x4c5a34 : 0x554129);
    /* every world transform is read below (the ground, what stands on it):
       bring them up to date once, here, rather than trust the last render
       (a page that has not drawn yet — the lab, a frame skipped — has none) */
    K.root().updateMatrixWorld(true);
    // the section the slabs are cut through: the SAME layer list the wall uses
    seq.layers = K.layersOf({ depth: seq.depth, road: seq.road, seed: o.seed != null ? o.seed : (x * 0.37 + z * 0.11) });
    seq.sampler = buildSampler(x, z, r * 1.45, gy, null);
    seq.sagAt = function (px, pz) {
      const d = Math.hypot(px - x, pz - z);
      return d < seq.coreR ? seq.sagS * (1 - (d / seq.coreR) * (d / seq.coreR)) : 0;
    };
    // WHAT IS STANDING THERE, found once
    scanProps(seq);
    const bl = buildingList(seq);
    for (let i = 0; i < bl.length; i++) {
      const B = bl[i];
      const d = Math.hypot(B.x - x, B.z - z);
      if (d < r + Math.max(B.w, B.d) * 0.75) seq.buildings.push(B);
    }
    // the cover over the cavity: slabs that will sag and drop
    const rings = [[0, 0.36, 1], [0.36, 0.72, 6], [0.72, 1.0, 9]];
    const thick = seq.road ? 0.5 : 0.55;
    for (let i = 0; i < rings.length; i++) {
      const rg = rings[i];
      const n = rg[2], a0 = h01(seq.seed, i, 11) * TAU;
      for (let j = 0; j < n; j++) {
        const poly = n === 1
          ? (function () { const P = []; for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; const rr = seq.coreR * rg[1] * (0.97 + h01(k, 3, seq.seed) * 0.05); P.push([x + Math.cos(a) * rr, z + Math.sin(a) * rr]); } return P; })()
          : annulusCell(seq, seq.coreR * rg[0], seq.coreR * rg[1], a0 + (j / n) * TAU, a0 + ((j + 1) / n) * TAU);
        const m = makeSlab(seq, poly, thick);
        seq.slabs.push({ m: m, p0: m.position.clone(), d: Math.hypot(m.position.x - x, m.position.z - z), a: Math.atan2(m.position.z - z, m.position.x - x) });
      }
    }
    seq.mask = { x: x, z: z, r: seq.coreR, y: gy };
    // the cavity under the cover, seen only through the opening cracks
    seq.cavity = new THREE.Mesh(new THREE.CircleGeometry(seq.coreR, 24).rotateX(-Math.PI / 2), darkMat);
    seq.cavity.position.set(x, gy - 0.9, z);
    seq.cavity.userData.transient = true;
    seq.puddle = new THREE.Mesh(new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2), puddleMat);
    seq.puddle.visible = false; seq.puddle.renderOrder = 3;
    seq.puddle.userData.transient = true;
    K.root().add(seq.cavity, seq.puddle);
    buildCracks(seq);
    // posts and trees on the doomed ground start to lean
    for (let i = 0; i < seq.props.length; i++) {
      const P = seq.props[i];
      const d = Math.hypot(P.x - x, P.z - z);
      if (d > r * 1.12) continue;
      const b = takeProp(seq, P);
      if (b) startLean(seq, b, d < seq.coreR ? 7 : 2.5 + 3 * (1 - d / (r * 1.12)));
    }
    if (o.dust !== false && CBZ.fx && CBZ.fx.particleCloud) {
      try { seq.dust = CBZ.fx.particleCloud({ count: PHONE ? 120 : 210, radius: r * 1.2, top: 22, mode: "rise", vMin: 4, vMax: 14, color: 0xa9967c, size: 0.5, opacity: 0.5 }); seq.dust.setActive(0.05); } catch (e) { seq.dust = null; }
    }
    K.sfx("rumble", x, z);
    seq.tick = function (dt) { tickEvent(seq, dt); };
    seq.dispose = function () { disposeEvent(seq); };
    seq.report = function () { return report(seq); };
    K.seqs.push(seq);
    audit.events++;
    return seq;
  };

  function tickEvent(seq, dt) {
    seq.t += dt; seq.T += dt;
    if (seq.dust) { try { seq.dust.update(dt, seq.x, seq.gy - 1, seq.z); } catch (e) {} }
    if (seq.phase === "warn") tickWarn(seq, dt);
    else if (seq.phase === "drop") { if (seq.t >= seq.dropSecs) { seq.phase = "grow"; seq.t = 0; seq.stepAt = 0; } }
    else if (seq.phase === "grow") tickGrow(seq, dt);
    else if (seq.phase === "open") tickOpen(seq, dt);
    tickCracks(seq);
    tickBodies(seq, dt);
    for (let i = 0; i < seq.buildings.length; i++) tickBuilding(seq, seq.buildings[i], dt);
    if (seq.shaft) {
      tickPipes(seq, dt);
      // groundwater seeps in, the main pours in: the pool rises
      const area = Math.PI * seq.shaft.r * seq.shaft.r;
      const target = Math.min(seq.depth * 0.22, (seq.shaft.waterLevel || 0) + (0.012 * dt) + seq.inflow / area);
      seq.inflow = 0;
      CBZ.groundShaftWater(seq.shaft, target);
      exemptActorsOver(seq);
    }
    seq.logT -= dt;
    if (seq.logT <= 0) {
      seq.logT = 0.5;
      let carsIn = 0;
      for (let i = 0; i < seq.bodies.length; i++) { const b = seq.bodies[i]; if (b.kind === "car" && seq.shaft && b.pos.y < seq.gy - 1.5) carsIn++; }
      seq.log.push({ t: +seq.T.toFixed(2), phase: seq.phase, r: seq.shaft ? +seq.shaft.r.toFixed(2) : 0, depth: seq.shaft ? +seq.shaft.depth.toFixed(1) : 0,
        sag: +seq.sagS.toFixed(2), water: seq.shaft ? +(seq.shaft.waterLevel || 0).toFixed(2) : 0, carsIn: carsIn, awake: seq.awake });
    }
  }

  function tickWarn(seq, dt) {
    const k = clamp(seq.t / seq.warnSecs, 0, 1);
    // the cover sags: nothing until a quarter in, then most of half a metre
    seq.sagS = 0.6 * smooth(0.2, 1, k);
    for (let i = 0; i < seq.slabs.length; i++) {
      const S = seq.slabs[i], m = S.m;
      const s = seq.sagAt(m.position.x, m.position.z);
      m.position.y = S.p0.y - seq.sagAt(S.p0.x, S.p0.z);
      // tilted down toward the middle by the sag's own slope
      const slope = S.d > 0.1 ? Math.atan(2 * seq.sagS * S.d / (seq.coreR * seq.coreR)) : 0;
      m.quaternion.setFromAxisAngle(_tmp.set(-Math.sin(S.a), 0, Math.cos(S.a)), slope);
      void s;
    }
    // water finds the low point
    if (seq.sagS > 0.12) {
      const pr = seq.coreR * 0.5 * smooth(0.12, 0.6, seq.sagS);
      seq.puddle.visible = true;
      seq.puddle.scale.set(pr, 1, pr);
      seq.puddle.position.set(seq.x, seq.gy - seq.sagS + 0.05, seq.z);
    }
    // cars on the cover settle with it
    if (!seq._carsOnCover) {
      seq._carsOnCover = true;
      takeCars(seq, seq.coreR * 0.9);
    }
    for (let i = 0; i < seq.buildings.length; i++) {
      const B = seq.buildings[i];
      if (!B._racked && k > 0.5 && footprintOver(B, seq, seq.r * 1.02) > 0.02) { B._racked = true; jamDoors(seq, B); }
    }
    if (seq.dust) seq.dust.setActive(0.05 + k * 0.2);
    if (CBZ.shake && K.nearCam(seq.x, seq.z, 70)) CBZ.shake(0.015 + 0.06 * k);
    if (rnd() < dt * 0.6) K.sfx("rumble", seq.x, seq.z);
    if (seq.t >= seq.warnSecs) coverCollapse(seq);
  }

  function coverCollapse(seq) {
    seq.phase = "drop"; seq.t = 0;
    seq.rNow = seq.coreR;
    seq.shaft = CBZ.groundShaft(seq.x, seq.z, {
      r: seq.coreR, depth: seq.depth, gy: seq.gy, seed: seq.opts.seed, surface: seq.surface, road: seq.road,
      keepInside: true, water: 0.4,
    });
    if (!seq.shaft) { seq.phase = "open"; return; }
    seq.shaft.born = CBZ.now || 0;
    seq.mask = null;
    if (seq.cavity) { K.root().remove(seq.cavity); seq.cavity.geometry.dispose(); seq.cavity = null; }
    if (seq.puddle) seq.puddle.visible = false;
    // THE COVER GOES: every slab becomes a falling body at its sagged pose
    for (let i = 0; i < seq.slabs.length; i++) {
      const m = seq.slabs[i].m;
      const b = makeBody(seq, [m], { kind: "slab", density: 2300, e: 0.08, mu: 0.8, frame: slabFrame(m) });
      if (!b) continue;
      b.w.set((rnd() - 0.5) * 1.5, 0, (rnd() - 0.5) * 1.5);
      b.v.set(0, -1.5 - rnd(), 0);
    }
    seq.slabs.length = 0;
    breakPipes(seq);
    if (CBZ.debris && CBZ.debris.dust) { try { CBZ.debris.dust(seq.x, seq.gy + 0.5, seq.z, { color: 0x9a8a72, power: 2.4, radius: seq.coreR }); } catch (e) {} }
    if (seq.dust) seq.dust.setActive(1);
    if (CBZ.shake && K.nearCam(seq.x, seq.z, 90)) CBZ.shake(0.6);
    K.sfx("collapse", seq.x, seq.z);
    afterCut(seq, seq.coreR);
  }
  // a slab's frame is its own mesh's: identity rotation at birth is wrong
  // after the sag tilted it, so read it off the mesh as it stands
  function slabFrame(m) {
    m.updateWorldMatrix(true, true);
    const g = m.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox;
    const half = new THREE.Vector3().subVectors(bb.max, bb.min).multiplyScalar(0.5);
    const c = new THREE.Vector3().addVectors(bb.min, bb.max).multiplyScalar(0.5).applyMatrix4(m.matrixWorld);
    return { q: m.quaternion.clone(), half: half, centre: c };
  }

  // the widening, in steps: each one is a calving
  function tickGrow(seq, dt) {
    const k = clamp(seq.t / seq.growSecs, 0, 1);
    const want = seq.coreR + (seq.r - seq.coreR) * (1 - Math.pow(1 - k, 1.6));
    const step = Math.max(0.9, seq.r * 0.1);
    if (want >= seq.rNow + step || (k >= 1 && seq.rNow < seq.r - 0.01)) widen(seq, k >= 1 ? seq.r : want);
    if (seq.dust) seq.dust.setActive(0.85 - k * 0.45);
    if (k >= 1) {
      seq.phase = "open"; seq.t = 0;
      if (seq.opts.onOpen) { try { seq.opts.onOpen(seq.shaft); } catch (e) {} }
    }
  }
  function widen(seq, rNew) {
    const r0 = seq.rNow;
    seq.rNow = rNew;
    const h = seq.shaft;
    if (h) {
      // the next ring of crust breaks off and tips in
      calve(seq, r0, rNew);
      const keep = { gy: h.gy, depth: h.depth, seed: h.seed, born: h.born, top: h.topColor, topSampled: h.topSampled, water: h.waterLevel };
      K.disposeShaft(h);
      seq.shaft = CBZ.groundShaft(seq.x, seq.z, { r: rNew, depth: keep.depth, gy: keep.gy, seed: keep.seed, surface: seq.surface, road: seq.road,
        top: keep.top, topSampled: keep.topSampled, water: keep.water, keepInside: true });
      if (seq.shaft) seq.shaft.born = keep.born;
      for (let i = 0; i < seq.pipes.length; i++) seatPipe(seq, seq.pipes[i]);
    }
    // rim earth shears off with the crust
    for (let i = 0; i < 3; i++) {
      const a = rnd() * TAU, d = rNew * (0.6 + rnd() * 0.3), s = 0.7 + rnd() * 1.2;
      K.dropChunk({ x: seq.x + Math.cos(a) * d, z: seq.z + Math.sin(a) * d, y: seq.gy - 0.6,
        vy: 0.5, vx: -Math.cos(a) * 1.4, vz: -Math.sin(a) * 1.4, size: s, color: i % 2 ? 0x6a4d31 : 0x8f5434, dmg: 50 + s * 20 });
    }
    if (CBZ.shake && K.nearCam(seq.x, seq.z, 70)) CBZ.shake(0.2);
    K.sfx("collapse", seq.x, seq.z);
    afterCut(seq, rNew);
  }
  function calve(seq, r0, r1) {
    // slabs a road really breaks into: 3.5-4.5 m along the rim
    const n = Math.max(5, Math.round(TAU * r1 / (PHONE ? 4.5 : 3.6)));
    const a0 = rnd() * TAU, thick = seq.road ? 0.5 : 0.55;
    for (let j = 0; j < n; j++) {
      const a = a0 + (j / n) * TAU, b = a0 + ((j + 1) / n) * TAU;
      const poly = annulusCell(seq, r0, r1, a, b);
      const m = makeSlab(seq, poly, thick);
      const body = makeBody(seq, [m], { kind: "slab", density: 2300, e: 0.08, mu: 0.8, frame: slabFrame(m) });
      if (!body) continue;
      const am = (a + b) / 2;
      // it tips about its outer edge: the inner edge drops first
      body.w.set(-Math.sin(am), 0, Math.cos(am)).multiplyScalar(-(0.8 + rnd() * 0.9));
      body.v.set(-Math.cos(am) * 0.4, -0.3, -Math.sin(am) * 0.4);
    }
  }
  // what the new rim no longer holds up
  function afterCut(seq, R) {
    const h = seq.shaft; if (!h) return;
    takeCars(seq, R);
    for (let i = 0; i < seq.props.length; i++) {
      const P = seq.props[i];
      const d = Math.hypot(P.x - seq.x, P.z - seq.z);
      if (d > h.mouth + 0.6) continue;
      const b = takeProp(seq, P);
      if (b && !b.lean) { b.asleep = false; b.w.set((rnd() - 0.5), 0, (rnd() - 0.5)); }
    }
    for (let i = 0; i < seq.bodies.length; i++) { const b = seq.bodies[i]; if (b.asleep && !b.dead) { b.asleep = false; b.calm = 0; } }
    for (let i = 0; i < seq.buildings.length; i++) {
      const B = seq.buildings[i];
      if (!B.state && footprintOver(B, h, h.mouth + 0.4) > 0.015) undermine(seq, B);
    }
    entrainActors(seq, h.mouth);
    clearSolids(seq);
    closeRoads(seq);
    publishVoid(seq);
  }
  function takeCars(seq, R) {
    const cars = carList(seq);
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!c.obj || c.obj.userData.sinkBody) continue;
      const fr = frameOf([c.obj], c.yaw || 0);
      if (!fr) continue;
      const reach = Math.hypot(fr.half.x, fr.half.z);
      const d = Math.hypot(fr.centre.x - seq.x, fr.centre.z - seq.z);
      if (d > R + reach * 0.9) continue;
      // only what actually overlaps the opening (a box test, not the circle)
      const b = makeBody(seq, [c.obj], { kind: "car", mass: 1350, e: 0.12, mu: 0.75, frame: fr, rec: c });
      if (!b) continue;
      b.car = c;
      if (c.take) { try { c.take(); } catch (e) {} }
      seq.cars.push(b);
      audit.cars++;
    }
  }

  function tickOpen(seq, dt) {
    if (seq.dust) {
      const f = Math.max(0, 0.4 - seq.t * 0.1);
      seq.dust.setActive(f);
      if (f <= 0.001) { try { seq.dust.dispose(); } catch (e) {} seq.dust = null; }
    }
    if (seq.cracks && seq.t > 4) { K.root().remove(seq.cracks.mesh); seq.cracks.mesh.geometry.dispose(); seq.cracks = null; }
  }

  function disposeEvent(seq) {
    if (seq.done) return;
    seq.done = true;
    const R = K.root();
    for (let i = 0; i < seq.slabs.length; i++) { const m = seq.slabs[i].m; if (m.parent) m.parent.remove(m); m.geometry.dispose(); }
    for (let i = 0; i < seq.bodies.length; i++) {
      const b = seq.bodies[i];
      if (b.kind === "slab") { const m = b.objs[0] && b.objs[0].o; if (m && m.parent) { m.parent.remove(m); m.geometry.dispose(); } continue; }
      for (let k = 0; k < b.restore.length; k++) {
        const s = b.restore[k];
        s.o.position.copy(s.p); s.o.quaternion.copy(s.q); s.o.scale.copy(s.s); s.o.visible = s.vis;
        s.o.userData.sinkBody = false;
      }
      for (let k = 0; k < b.mats.length; k++) b.mats[k][0].material = b.mats[k][1];
      if (b.undo) b.undo();
      if (b.car && b.car.restore) { try { b.car.restore(); } catch (e) {} }
    }
    for (let i = 0; i < seq.buildings.length; i++) {
      const B = seq.buildings[i];
      if (B.save && B.group && B.state !== "falling" && B.state !== "down") { B.group.position.copy(B.save.p); B.group.quaternion.copy(B.save.q); B.group.scale.copy(B.save.s); }
      if (B._mats) for (let k = 0; k < B._mats.length; k++) B._mats[k][0].material = B._mats[k][1];
    }
    for (let i = 0; i < seq.pipes.length; i++) { const p = seq.pipes[i]; R.remove(p.pipe); R.remove(p.pts); p.pipe.geometry.dispose(); p.pts.geometry.dispose(); }
    if (seq.cracks) { R.remove(seq.cracks.mesh); seq.cracks.mesh.geometry.dispose(); }
    if (seq.cavity) { R.remove(seq.cavity); seq.cavity.geometry.dispose(); }
    if (seq.puddle) { R.remove(seq.puddle); seq.puddle.geometry.dispose(); }
    if (seq.dust) { try { seq.dust.dispose(); } catch (e) {} }
    for (let i = 0; i < seq.roads.length; i++) { const r = seq.roads[i]; r.noTraffic = false; r.sinkhole = false; r._openCache = null; }
    for (let i = 0; i < seq.jammed.length; i++) seq.jammed[i].jammed = false;
    for (let i = 0; i < seq.solids.length; i++) {
      const e = seq.solids[i];
      if (e[0] === "col") addCol(e[1]);
      else if (CBZ.platforms && CBZ.platforms.indexOf(e[1]) < 0) CBZ.platforms.push(e[1]);
    }
    if (seq.solids.length && CBZ.markPlatformsDirty) CBZ.markPlatformsDirty();
    if (seq.void) { const k = navVoids.indexOf(seq.void); if (k >= 0) navVoids.splice(k, 1); CBZ.navVoidsVersion++; }
    const k = K.seqs.indexOf(seq); if (k >= 0) K.seqs.splice(k, 1);
  }

  function report(seq) {
    const cars = seq.cars.map(function (b) {
      return { label: b.car && b.car.label, y: +b.pos.y.toFixed(2), drop: +b.maxDrop.toFixed(2), inHole: !!(seq.shaft && Math.hypot(b.pos.x - seq.x, b.pos.z - seq.z) < seq.shaft.mouth && b.pos.y < seq.gy - 1.5),
        pitchDeg: +(Math.asin(clamp(new THREE.Vector3(0, 0, 1).applyQuaternion(b.q).y, -1, 1)) * 180 / Math.PI).toFixed(1), asleep: b.asleep };
    });
    const props = seq.bodies.filter(function (b) { return b.kind === "prop" || b.kind === "post"; }).map(function (b) {
      return { kind: b.kind, y: +b.pos.y.toFixed(2), drop: +b.maxDrop.toFixed(2), leaning: !!b.lean, leanDeg: b.lean ? +(b.lean.a * 180 / Math.PI).toFixed(1) : null };
    });
    return {
      phase: seq.phase, r: seq.shaft ? seq.shaft.r : 0, mouth: seq.shaft ? seq.shaft.mouth : 0, depth: seq.shaft ? seq.shaft.depth : 0,
      bottom: seq.shaft ? seq.shaft.bottom : null, water: seq.shaft ? seq.shaft.waterLevel : 0,
      cars: cars, carsIn: cars.filter(function (c) { return c.inHole; }).length,
      props: props, slabsBroken: audit.slabs, bodies: seq.bodies.length,
      buildings: seq.buildings.map(function (B) { return { state: B.state || "standing", via: B.via || null, maxTiltDeg: +((B.maxTilt || 0) * 180 / Math.PI).toFixed(1) }; }),
      pipes: seq.pipes.length, roadsClosed: seq.roads.length, doorsJammed: seq.jammed.length, actorsTaken: seq.fell.length,
      layers: seq.layers.map(function (l) { return l.name; }).filter(function (v, i, a) { return a.indexOf(v) === i; }),
      log: seq.log,
    };
  }

  /* "is the ground going here" — for every brain that can run from it */
  CBZ.groundShaftHazard = function (x, z) {
    let best = null, bl = 0;
    const S = K.seqs;
    for (let i = 0; i < S.length; i++) {
      const s = S[i];
      if (s.done || !s.r) continue;
      const R = s.shaft ? s.shaft.r : s.r;
      const d = Math.hypot(x - s.x, z - s.z);
      const lv = clamp(1 - (d - R) / (s.r * 0.6 + 10), 0, 1) * (s.phase === "open" ? 0.6 : 1);
      if (lv > bl) { bl = lv; best = { x: s.x, z: s.z, r: R, distance: d, level: lv, kind: "hazard" }; }
    }
    return best;
  };

  CBZ.sinkholeAudit = function () {
    const S = K.seqs;
    let bodies = 0, awake = 0;
    for (let i = 0; i < S.length; i++) { bodies += (S[i].bodies || []).length; awake += S[i].awake || 0; }
    return Object.assign({ live: S.length, bodiesNow: bodies, awakeNow: awake, awakeCap: AWAKE_CAP, navVoids: navVoids.length }, audit);
  };

  /* ============================================================
     THE CITY EVENT. Default OFF (CITY_SINKHOLES): a sinkhole that can open
     under you at random is not a feature, it is weather. One call, and the
     placement law picks the intersection.
     ============================================================ */
  CBZ.cityOpenSinkhole = function (o) {
    o = o || {};
    if (CBZ.CONFIG.GROUND_SHAFT === false || CBZ.CONFIG.CITY_SINKHOLES === false) return null;
    const r = o.r || (9 + rnd() * 4);
    const site = o.x != null ? { x: o.x, z: o.z } : CBZ.groundShaftSite({ r: r, minDist: o.minDist || 45, maxDist: o.maxDist || 300 });
    if (!site) return null;
    return CBZ.groundShaftCollapse(site.x, site.z, Object.assign({}, o, { r: r, depth: o.depth || r * 3.2, surface: "asphalt" }));
  };
})();
