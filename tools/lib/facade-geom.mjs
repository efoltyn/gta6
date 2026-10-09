/* tools/lib/facade-geom.mjs — the arithmetic behind tools/facade-census.mjs.

   Everything here works on plain records so any builder (a city shell, a
   metro tile, a prison wing) can be measured the same way:

     quads   axis-aligned rectangles with an outward normal:
             { ax: 0|1|2, sg: +1|-1, off, u0, u1, v0, v1, key, vc, src }
             (ax = the normal's axis, off = the plane coordinate, u/v = the
             other two axes in x,y,z order). `key` is the surface's look
             (material colour + map + emissive); `vc` marks vertex-coloured
             (shaded per vertex) surfaces.
     boxes   opaque world AABBs { x0, x1, y0, y1, z0, z1 } that can block a
             view onto a window.

   Z-FIGHT (zfight): two quads with the SAME outward normal whose planes are
   within `tol` and whose rectangles overlap by more than 1 cm2 (and 2 mm in
   both directions), unless they would draw the identical pixel: same look
   and neither one shaded per vertex. That is exactly the case the depth
   buffer cannot resolve: it alternates between the two surfaces by angle and
   distance, which is the flicker.                                           */

export function meshQuads(THREE, root, opts) {
  opts = opts || {};
  const quads = [];
  const boxes = [];
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  root.updateMatrixWorld(true);
  root.traverse(function (o) {
    if (!o.isMesh || o.isInstancedMesh) return;
    if (o.visible === false) return;
    const g = o.geometry;
    if (!g || !g.attributes || !g.attributes.position) return;
    const m = o.material;
    if (!m || Array.isArray(m)) return;
    if (m.visible === false) return;
    const P = g.attributes.position.array;
    const I = g.index ? g.index.array : null;
    const nTri = I ? I.length / 3 : P.length / 9;
    const look = lookKey(m);
    const vc = !!(m.vertexColors && g.attributes.color);
    const transparent = !!m.transparent;
    const W = o.matrixWorld;
    const side = m.side;
    // pair consecutive triangles into rectangles (every box face is two)
    let pend = null;
    let bx0 = Infinity, by0 = Infinity, bz0 = Infinity, bx1 = -Infinity, by1 = -Infinity, bz1 = -Infinity;
    let boxCount = 0;
    const isBoxChunks = !!(g._cbzBoxSource) || (g.type === "BoxGeometry") || (g.parameters && g.parameters.width != null && g.parameters.depth != null && g.parameters.height != null) ||
      mergedBoxes(P, I, nTri);
    for (let t = 0; t < nTri; t++) {
      for (let k = 0; k < 3; k++) {
        const vi = I ? I[t * 3 + k] : t * 3 + k;
        v[k].set(P[vi * 3], P[vi * 3 + 1], P[vi * 3 + 2]).applyMatrix4(W);
      }
      // the triangle's normal
      const ax = v[1].x - v[0].x, ay = v[1].y - v[0].y, az = v[1].z - v[0].z;
      const bxv = v[2].x - v[0].x, byv = v[2].y - v[0].y, bzv = v[2].z - v[0].z;
      let nx = ay * bzv - az * byv, ny = az * bxv - ax * bzv, nz = ax * byv - ay * bxv;
      const nl = Math.hypot(nx, ny, nz);
      if (nl < 1e-9) continue;
      nx /= nl; ny /= nl; nz /= nl;
      // world AABB of the mesh's boxes (24 verts per box when built from boxes)
      for (let k = 0; k < 3; k++) {
        if (v[k].x < bx0) bx0 = v[k].x; if (v[k].x > bx1) bx1 = v[k].x;
        if (v[k].y < by0) by0 = v[k].y; if (v[k].y > by1) by1 = v[k].y;
        if (v[k].z < bz0) bz0 = v[k].z; if (v[k].z > bz1) bz1 = v[k].z;
      }
      if (isBoxChunks && (t % 12) === 11) {
        if (!transparent) boxes.push({ x0: bx0, x1: bx1, y0: by0, y1: by1, z0: bz0, z1: bz1, look: look });
        bx0 = by0 = bz0 = Infinity; bx1 = by1 = bz1 = -Infinity; boxCount++;
      }
      const a = Math.abs(nx) > 0.999 ? 0 : Math.abs(ny) > 0.999 ? 1 : Math.abs(nz) > 0.999 ? 2 : -1;
      if (a < 0) { pend = null; continue; }
      let sg = a === 0 ? Math.sign(nx) : a === 1 ? Math.sign(ny) : Math.sign(nz);
      if (side === 1) sg = -sg;                       // BackSide: the visible face is the other way
      const off = a === 0 ? v[0].x : a === 1 ? v[0].y : v[0].z;
      const cu = a === 0 ? "y" : "x", cv = a === 2 ? "y" : "z";
      let u0 = Math.min(v[0][cu], v[1][cu], v[2][cu]), u1 = Math.max(v[0][cu], v[1][cu], v[2][cu]);
      let v0 = Math.min(v[0][cv], v[1][cv], v[2][cv]), v1 = Math.max(v[0][cv], v[1][cv], v[2][cv]);
      const pts = [[v[0][cu], v[0][cv]], [v[1][cu], v[1][cv]], [v[2][cu], v[2][cv]]];
      if (pend && pend.ax === a && pend.sg === sg && Math.abs(pend.off - off) < 1e-6) {
        pend.u0 = Math.min(pend.u0, u0); pend.u1 = Math.max(pend.u1, u1);
        pend.v0 = Math.min(pend.v0, v0); pend.v1 = Math.max(pend.v1, v1);
        // outside a box mesh, only a true RECTANGLE is a quad: two triangles of
        // a polygon (a bow front's floor, a fan) would claim their bounding box
        if (isBoxChunks || isRect(pend.pts.concat(pts), pend)) quads.push(pend);
        pend = null;
        continue;
      }
      if (pend && isBoxChunks) quads.push(pend);
      pend = { pts: pts, ax: a, sg: sg, off: off, u0: u0, u1: u1, v0: v0, v1: v1, key: look, vc: vc, tr: transparent,
        src: (o.name || (g._cbzBoxSource ? "deco" : g.type || "")) + "#" + look, dbl: side === 2, q: [+(v[0].x).toFixed(2), +(v[0].y).toFixed(2), +(v[0].z).toFixed(2)] };
    }
    if (pend && isBoxChunks) quads.push(pend);
    if (!isBoxChunks && !transparent && isFinite(bx0) && opts.meshBounds !== false) {
      // a non-box solid (column, dome, cylinder): its bounds block like a box.
      // A big MERGED mesh of mixed parts (a whole house's dressing) is not a
      // solid: its bounds would swallow the building; it is left out.
      const bb = new THREE.Box3().setFromObject(o);
      const ex = bb.max.x - bb.min.x, ey = bb.max.y - bb.min.y, ez = bb.max.z - bb.min.z;
      if (Math.max(ex, ey, ez) < 6) boxes.push({ x0: bb.min.x, x1: bb.max.x, y0: bb.min.y, y1: bb.max.y, z0: bb.min.z, z1: bb.max.z, look: look, round: true });
    }
  });
  return { quads: quads, boxes: boxes };
}

export function lookKey(m) {
  const c = m.color ? m.color.getHex() : 0;
  const e = m.emissive ? m.emissive.getHex() : 0;
  return (m.type || "M") + ":" + c.toString(16) + ":" + e.toString(16) + (m.map ? ":map" + (m.map.uuid || "").slice(0, 6) : "") + (m.transparent ? ":t" : "");
}

// a world-AABB record (pooled glass pane, veneer tile, room deco) → its quads
export function boxQuads(b, key, faces) {
  faces = faces || "xyz";
  const out = [];
  const add = (ax, sg, off, u0, u1, v0, v1) => out.push({ ax, sg, off, u0, u1, v0, v1, key, vc: false, src: key });
  if (faces.includes("x")) { add(0, 1, b.x1, b.y0, b.y1, b.z0, b.z1); add(0, -1, b.x0, b.y0, b.y1, b.z0, b.z1); }
  if (faces.includes("y")) { add(1, 1, b.y1, b.x0, b.x1, b.z0, b.z1); add(1, -1, b.y0, b.x0, b.x1, b.z0, b.z1); }
  if (faces.includes("z")) { add(2, 1, b.z1, b.x0, b.x1, b.y0, b.y1); add(2, -1, b.z0, b.x0, b.x1, b.y0, b.y1); }
  return out;
}

/* THE Z-FIGHT LEDGER. Returns { pairs, area, samples[] }. */
export function zfight(quads, tol, opts) {
  opts = opts || {};
  const hid = opts.solids ? solidIndex(opts.solids) : null;
  tol = tol == null ? 0.005 : tol;
  const MIN_A = 1e-4, MIN_D = 0.002;
  const buckets = new Map();
  const cell = Math.max(tol * 2, 0.01);
  for (let i = 0; i < quads.length; i++) {
    const q = quads[i];
    if (q.u1 - q.u0 < MIN_D || q.v1 - q.v0 < MIN_D) continue;
    // a face looking DOWN at or under the lot pad (y <= 0.10) is never seen:
    // the ground covers it
    if (q.ax === 1 && q.sg < 0 && q.off <= (opts.groundY != null ? opts.groundY : 0.1)) continue;
    const k = q.ax * 2 + (q.sg > 0 ? 1 : 0);
    const c = Math.floor(q.off / cell);
    const key = k + "|" + c;
    let a = buckets.get(key); if (!a) { a = []; buckets.set(key, a); } a.push(i);
  }
  let pairs = 0, area = 0;
  const samples = [];
  const byKind = new Map();
  const seen = new Set();
  buckets.forEach(function (list, key) {
    const [k, c] = key.split("|").map(Number);
    const near = [];
    for (const dc of [0, 1]) { const l2 = buckets.get(k + "|" + (c + dc)); if (l2) near.push(l2); }
    for (const i of list) {
      const a = quads[i];
      for (const l2 of near) for (const j of l2) {
        if (j <= i && l2 === list) continue;
        if (j === i) continue;
        const b = quads[j];
        if (Math.abs(a.off - b.off) > tol) continue;
        if (a.key === b.key && !a.vc && !b.vc) continue;      // the same pixel twice: no flicker
        const du = Math.min(a.u1, b.u1) - Math.max(a.u0, b.u0);
        const dv = Math.min(a.v1, b.v1) - Math.max(a.v0, b.v0);
        if (du < MIN_D || dv < MIN_D || du * dv < MIN_A) continue;
        // buried: the air just in front of both faces is inside a solid
        // (a face inside a wall is never drawn to the screen)
        if (hid && buried(hid, a, Math.max(a.u0, b.u0), Math.min(a.u1, b.u1), Math.max(a.v0, b.v0), Math.min(a.v1, b.v1), Math.max(a.off, b.off) * (a.sg > 0 ? 1 : 1))) continue;
        const pk = i < j ? i + ":" + j : j + ":" + i;
        if (seen.has(pk)) continue;
        seen.add(pk);
        pairs++; area += du * dv;
        const kind = [a.src.split("#")[0] + ":" + "xyz"[a.ax] + (a.sg > 0 ? "+" : "-"), b.src.split("#")[0]].sort().join(" | ");
        byKind.set(kind, (byKind.get(kind) || 0) + 1);
        if (samples.length < (opts.samples || 6)) samples.push({ ax: "xyz"[a.ax], sg: a.sg, off: +a.off.toFixed(4), d: +(b.off - a.off).toFixed(4), area: +(du * dv).toFixed(4), a: a.src, b: b.src, pa: a.q, pb: b.q, ra: [a.u0, a.u1, a.v0, a.v1].map((x) => +x.toFixed(2)), rb: [b.u0, b.u1, b.v0, b.v1].map((x) => +x.toFixed(2)) });
      }
    }
  });
  return { pairs: pairs, area: +area.toFixed(3), samples: samples, byKind: byKind };
}

/* Is a pane visible from the street? Sample a 4x4 grid over the pane's outer
   face and march outward along the face normal for `reach` metres: a sample
   is blocked when an opaque box (that is not the pane's own frame/mullion,
   i.e. thinner than `bar` across the face) stands in front of it.
   Returns the visible fraction. */
export function paneVisible(p, nrm, boxes, reach, bar) {
  reach = reach || 1.2; bar = bar == null ? 0.09 : bar;
  const ax = nrm.ax, sg = nrm.sg;
  let vis = 0, n = 0;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    n++;
    const fu = (i + 0.5) / 4, fv = (j + 0.5) / 4;
    let x, y, z;
    if (ax === 0) { x = sg > 0 ? p.x1 : p.x0; y = p.y0 + (p.y1 - p.y0) * fv; z = p.z0 + (p.z1 - p.z0) * fu; }
    else { z = sg > 0 ? p.z1 : p.z0; y = p.y0 + (p.y1 - p.y0) * fv; x = p.x0 + (p.x1 - p.x0) * fu; }
    let blocked = false;
    for (let k = 0; k < boxes.length && !blocked; k++) {
      const b = boxes[k];
      // thin bars (mullions, muntins, frame members) do not "cover" a window
      const tw = ax === 0 ? Math.min(b.z1 - b.z0, b.y1 - b.y0) : Math.min(b.x1 - b.x0, b.y1 - b.y0);
      if (tw <= bar) continue;
      if (y <= b.y0 || y >= b.y1) continue;
      if (ax === 0) {
        if (z <= b.z0 || z >= b.z1) continue;
        const s0 = sg > 0 ? x + 0.003 : x - reach, s1 = sg > 0 ? x + reach : x - 0.003;
        if (b.x1 > s0 && b.x0 < s1) blocked = true;
      } else {
        if (x <= b.x0 || x >= b.x1) continue;
        const s0 = sg > 0 ? z + 0.003 : z - reach, s1 = sg > 0 ? z + reach : z - 0.003;
        if (b.z1 > s0 && b.z0 < s1) blocked = true;
      }
    }
    if (!blocked) vis++;
  }
  return vis / n;
}

/* a coarse grid over opaque boxes, for "is this point inside a solid" */
export function solidIndex(boxes) {
  const C = 4, m = new Map();
  for (const b of boxes) {
    if (b.round) continue;
    if (b.x1 - b.x0 < 0.004 || b.y1 - b.y0 < 0.004 || b.z1 - b.z0 < 0.004) continue;
    const i0 = Math.floor(b.x0 / C), i1 = Math.floor(b.x1 / C), k0 = Math.floor(b.z0 / C), k1 = Math.floor(b.z1 / C);
    if ((i1 - i0 + 1) * (k1 - k0 + 1) > 400) continue;
    for (let i = i0; i <= i1; i++) for (let k = k0; k <= k1; k++) { const key = i + "," + k; let a = m.get(key); if (!a) { a = []; m.set(key, a); } a.push(b); }
  }
  return { C, m };
}
export function insideSolid(ix, x, y, z, eps) {
  eps = eps == null ? 2e-4 : eps;
  const a = ix.m.get(Math.floor(x / ix.C) + "," + Math.floor(z / ix.C));
  if (!a) return false;
  for (const b of a) if (x > b.x0 + eps && x < b.x1 - eps && y > b.y0 + eps && y < b.y1 - eps && z > b.z0 + eps && z < b.z1 - eps) return true;
  return false;
}
function buried(ix, q, u0, u1, v0, v1, off) {
  // EXACT: the overlap rect minus every solid the air 1.5 mm in front of it
  // lies inside. Anything left over is a surface you can see.
  const o = off + q.sg * 0.0015;
  const ax = q.ax;
  const U = ax === 0 ? "y" : "x", Vv = ax === 2 ? "y" : "z", N = "xyz"[ax];
  const xs0 = ax === 0 ? o : u0, xs1 = ax === 0 ? o : u1;
  const zs0 = ax === 2 ? o : (Vv === "z" ? v0 : o), zs1 = ax === 2 ? o : (Vv === "z" ? v1 : o);
  const holes = [];
  const seen = new Set();
  for (let i = Math.floor(xs0 / ix.C); i <= Math.floor(xs1 / ix.C); i++) for (let k = Math.floor(zs0 / ix.C); k <= Math.floor(zs1 / ix.C); k++) {
    const L = ix.m.get(i + "," + k); if (!L) continue;
    for (const b of L) {
      if (seen.has(b)) continue; seen.add(b);
      if (!(o > b[N + "0"] + 2e-4 && o < b[N + "1"] - 2e-4)) continue;
      if (b[U + "1"] <= u0 || b[U + "0"] >= u1 || b[Vv + "1"] <= v0 || b[Vv + "0"] >= v1) continue;
      holes.push([b[U + "0"], b[U + "1"], b[Vv + "0"], b[Vv + "1"]]);
    }
  }
  if (!holes.length) return false;
  let rest = [[u0, u1, v0, v1]];
  for (const h of holes) {
    const next = [];
    for (const r of rest) {
      if (h[1] <= r[0] || h[0] >= r[1] || h[3] <= r[2] || h[2] >= r[3]) { next.push(r); continue; }
      if (h[0] > r[0]) next.push([r[0], h[0], r[2], r[3]]);
      if (h[1] < r[1]) next.push([h[1], r[1], r[2], r[3]]);
      const a0 = Math.max(r[0], h[0]), a1 = Math.min(r[1], h[1]);
      if (h[2] > r[2]) next.push([a0, a1, r[2], h[2]]);
      if (h[3] < r[3]) next.push([a0, a1, h[3], r[3]]);
    }
    rest = next.filter((r) => r[1] - r[0] > 0.002 && r[3] - r[2] > 0.002);
    if (!rest.length) return true;
  }
  return false;
}

/* Is this a merge of whole boxes (BufferGeometryUtils over BoxGeometry, 24
   vertices and 12 triangles a box, in order)? Then each 12-triangle run is a
   solid box the census can use, instead of the mesh's whole bounding box. */
function mergedBoxes(P, I, nTri) {
  if (!I || nTri % 12 !== 0 || (P.length / 3) % 24 !== 0 || nTri / 12 !== (P.length / 3) / 24) return false;
  const nb = Math.min(nTri / 12, 64);
  for (let b = 0; b < nb; b++) {
    const xs = new Set(), ys = new Set(), zs = new Set();
    for (let v = b * 24; v < b * 24 + 24; v++) {
      xs.add(Math.round(P[v * 3] * 1e4)); ys.add(Math.round(P[v * 3 + 1] * 1e4)); zs.add(Math.round(P[v * 3 + 2] * 1e4));
    }
    if (xs.size > 2 || ys.size > 2 || zs.size > 2) return false;
    for (let t = b * 12; t < b * 12 + 12; t++) for (let k = 0; k < 3; k++) {
      const vi = I[t * 3 + k];
      if (vi < b * 24 || vi >= b * 24 + 24) return false;
    }
  }
  return true;
}

function isRect(pts, q) {
  const key = (p) => Math.round(p[0] * 1e4) + "," + Math.round(p[1] * 1e4);
  const set = new Set(pts.map(key));
  if (set.size !== 4) return false;
  for (const c of [[q.u0, q.v0], [q.u0, q.v1], [q.u1, q.v0], [q.u1, q.v1]]) if (!set.has(key(c))) return false;
  return true;
}
