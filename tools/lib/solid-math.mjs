/* tools/lib/solid-math.mjs — THE MATH HALF OF THE SOLID CENSUS.

   Pure functions over two ledgers dumped from the live world (see
   tools/lib/solid-dump.js):

     walls   [owner, x0,z0, x1,z1, y0,y1]   drawn vertical faces
     solids  {minX,maxX,minZ,maxZ,y0,y1[,cx,cz,hw,hd,yaw]}   CBZ.colliders

   Six measurements, all of them arithmetic — no frames, no eyes:

     merge()      drawn faces -> BARRIER RUNS (the two faces of one wall are
                  one wall; a superellipse's 29 chords are 29 runs)
     coverage()   metres of drawn barrier with no solid under it   -> GHOST
     phantom()    m2 of wall-thin solid with no barrier drawn in it -> INVISIBLE WALL
     solidClash() m2 where two solids occupy the same ground        -> DOUBLE WALL
     pierce()     one structure's wall crossing another's, interior
                  to both, with overlapping height                  -> INTERPENETRATION
     roadClash()  solid / barrier standing in a carriageway         -> BLOCKED ROAD

   Every one is a length or an area, so every one is comparable across the
   whole map and a leaderboard means something. */

// ------------------------------------------------------------ small geometry
const TAU = Math.PI * 2;

export function segLen(r) { return Math.hypot(r.x1 - r.x0, r.z1 - r.z0); }

/* Point inside a collider footprint, expanded by tol. Honours the oriented
   body when the record has one — an OBB tested as its AABB is exactly the bug
   this census exists to count, so the census must not commit it itself. */
export function inSolid(x, z, s, tol) {
  if (s.yaw != null) {
    const c = Math.cos(s.yaw), si = Math.sin(s.yaw);
    // world->local is the inverse rotation. r128 maps local (x,z) to
    // (x*c + z*si, -x*si + z*c), so local = (dx*c - dz*si, dx*si + dz*c).
    const dx = x - s.cx, dz = z - s.cz;
    const lx = dx * c - dz * si, lz = dx * si + dz * c;
    return Math.abs(lx) <= s.hw + tol && Math.abs(lz) <= s.hd + tol;
  }
  return x >= s.minX - tol && x <= s.maxX + tol && z >= s.minZ - tol && z <= s.maxZ + tol;
}

export function ySpansOverlap(a0, a1, b0, b1) {
  if (b0 == null) return true;                 // full-height solid
  return a0 <= b1 + 0.05 && a1 >= b0 - 0.05;
}

/* Footprint corners of a solid, in order. */
export function solidCorners(s) {
  if (s.yaw != null) {
    const c = Math.cos(s.yaw), si = Math.sin(s.yaw);
    const P = (lx, lz) => [s.cx + lx * c + lz * si, s.cz - lx * si + lz * c];
    return [P(-s.hw, -s.hd), P(s.hw, -s.hd), P(s.hw, s.hd), P(-s.hw, s.hd)];
  }
  return [[s.minX, s.minZ], [s.maxX, s.minZ], [s.maxX, s.maxZ], [s.minX, s.maxZ]];
}

export function solidArea(s) {
  return s.yaw != null ? 4 * s.hw * s.hd : (s.maxX - s.minX) * (s.maxZ - s.minZ);
}

/* Sutherland-Hodgman clip of convex polygon `subject` by convex `clip`, then
   shoelace. Exact overlap area for two rotated boxes — no sampling. */
export function convexOverlapArea(subject, clip) {
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const side = (p) => ex * (p[1] - a[1]) - ez * (p[0] - a[0]);
    const inp = out; out = [];
    for (let j = 0; j < inp.length; j++) {
      const p = inp[j], q = inp[(j + 1) % inp.length];
      const sp = side(p), sq = side(q);
      if (sp <= 0) out.push(p);
      if ((sp < 0 && sq > 0) || (sp > 0 && sq < 0)) {
        const t = sp / (sp - sq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
  }
  let a = 0;
  for (let i = 0; i < out.length; i++) {
    const p = out[i], q = out[(i + 1) % out.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

// ------------------------------------------------------------- uniform grid
export function gridOf(items, cell, bounds) {
  const g = new Map();
  const key = (i, j) => i * 100003 + j;
  for (let n = 0; n < items.length; n++) {
    const b = bounds(items[n]);
    const i0 = Math.floor(b[0] / cell), i1 = Math.floor(b[2] / cell);
    const j0 = Math.floor(b[1] / cell), j1 = Math.floor(b[3] / cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = key(i, j); let a = g.get(k); if (!a) g.set(k, a = []); a.push(n);
    }
  }
  return {
    cell,
    at(x, z) { return g.get(key(Math.floor(x / cell), Math.floor(z / cell))) || EMPTY; },
    range(x0, z0, x1, z1) {
      const seen = new Set();
      for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++)
        for (let j = Math.floor(z0 / cell); j <= Math.floor(z1 / cell); j++) {
          const a = g.get(key(i, j)); if (a) for (const n of a) seen.add(n);
        }
      return seen;
    },
  };
}
const EMPTY = [];

// ================================================================== 1. MERGE
/* A wall drawn as a box has two faces 0.3 m apart, and a fence panel is two
   triangles on one face. Both are ONE barrier. Collapse faces that share a
   line (same direction within `angTol`, same perpendicular offset within
   `perpTol`) and union their extents along it, so "drawn metres" counts the
   barrier once. Runs are per-owner: two structures meeting flush are still
   two structures, and the pierce test needs them apart. */
export function merge(walls, opt = {}) {
  const angTol = opt.angTol ?? 4 * Math.PI / 180;
  const perpTol = opt.perpTol ?? 0.75;
  const lines = new Map();
  for (const w of walls) {
    const [owner, x0, z0, x1, z1, y0, y1, g] = w;
    const gy = g == null ? 0 : g;
    let dx = x1 - x0, dz = z1 - z0;
    const L = Math.hypot(dx, dz);
    if (L < 1e-6) continue;
    dx /= L; dz /= L;
    // direction mod PI (a wall has no front), canonicalised to the upper half
    let ang = Math.atan2(dz, dx); if (ang < 0) ang += Math.PI; if (ang >= Math.PI) ang -= Math.PI;
    const ux = Math.cos(ang), uz = Math.sin(ang);
    const perp = -uz * x0 + ux * z0;             // signed distance of the line from origin
    const bucketA = Math.round(ang / angTol), bucketP = Math.round(perp / perpTol);
    // probe neighbouring buckets so a face landing on a boundary still joins
    let key = null;
    for (let da = -1; da <= 1 && key == null; da++)
      for (let dp = -1; dp <= 1 && key == null; dp++) {
        const k = owner + "|" + (bucketA + da) + "|" + (bucketP + dp);
        if (lines.has(k)) {
          const ln = lines.get(k);
          if (Math.abs(angDiff(ln.ang, ang)) <= angTol && Math.abs(ln.perp - perp) <= perpTol) key = k;
        }
      }
    if (key == null) {
      key = owner + "|" + bucketA + "|" + bucketP;
      lines.set(key, { owner, ang, ux, uz, perp, ivs: [], y0: y0, y1: y1, gy: gy });
    }
    const ln = lines.get(key);
    const t0 = ux * x0 + uz * z0, t1 = ux * x1 + uz * z1;
    ln.ivs.push([Math.min(t0, t1), Math.max(t0, t1), y0, y1, gy]);
    if (y0 < ln.y0) ln.y0 = y0;
    if (y1 > ln.y1) ln.y1 = y1;
    if (gy < ln.gy) ln.gy = gy;
  }
  const runs = [];
  for (const ln of lines.values()) {
    ln.ivs.sort((a, b) => a[0] - b[0]);
    let cur = null;
    for (const iv of ln.ivs) {
      if (cur && iv[0] <= cur[1] + 0.15) {
        if (iv[1] > cur[1]) cur[1] = iv[1];
        if (iv[2] < cur[2]) cur[2] = iv[2];
        if (iv[3] > cur[3]) cur[3] = iv[3];
        if (iv[4] < cur[4]) cur[4] = iv[4];
      } else { if (cur) push(ln, cur); cur = iv.slice(); }
    }
    if (cur) push(ln, cur);
  }
  function push(ln, iv) {
    const [t0, t1, y0, y1, gy] = iv;
    if (t1 - t0 < 0.2) return;
    const bx = ln.ux * ln.perp * 0 - ln.uz * ln.perp, bz = ln.uz * ln.perp * 0 + ln.ux * ln.perp;
    runs.push({
      owner: ln.owner,
      x0: bx + ln.ux * t0, z0: bz + ln.uz * t0,
      x1: bx + ln.ux * t1, z1: bz + ln.uz * t1,
      y0, y1, gy: gy == null ? 0 : gy,
      // how far the bottom of this barrier sits above the ground it stands
      // on. 0 = a fence; 8 = a fascia panel nobody can reach.
      lift: +((y0 - (gy == null ? 0 : gy))).toFixed(2),
    });
  }
  return runs;
}
function angDiff(a, b) { let d = a - b; while (d > Math.PI / 2) d -= Math.PI; while (d < -Math.PI / 2) d += Math.PI; return d; }

// =============================================================== 2. COVERAGE
/* Walk every drawn barrier at `step`, ask the collider ledger whether it is
   solid there. Returns per-owner metres and the contiguous unsolid stretches
   long enough to walk through. THIS IS THE "IT HAS NO COLLIDER" NUMBER. */
export function coverage(runs, solids, opt = {}) {
  const step = opt.step ?? 0.5;
  // …and the other end of the same judgement: a barrier is something you have
  // to go AROUND. Under `minLen` metres you simply walk past it, so a 0.6 m
  // stub of drawn wall is not a hole in anything.
  const minLen = opt.minLen ?? 2.0;
  const tol = opt.tol ?? 0.35;
  const minRun = opt.minRun ?? 1.5;
  // A barrier whose bottom edge starts above head height cannot be walked
  // through no matter how un-collided it is — a grandstand fascia, a soffit,
  // a sign face. It is still reported, but it is scored SEPARATELY, because
  // mixing it in makes an unreachable panel outrank a real hole in a fence.
  const reach = opt.reach ?? 2.2;
  const grid = gridOf(solids, 16, (s) => [s.minX, s.minZ, s.maxX, s.maxZ]);
  const per = new Map();
  const gaps = [];
  for (const r of runs) {
    const L = segLen(r);
    if (L < minLen) continue;
    const n = Math.max(1, Math.ceil(L / step));
    const dx = (r.x1 - r.x0) / n, dz = (r.z1 - r.z0) / n;
    const my = (r.y0 + r.y1) / 2;
    const reachable = (r.lift == null ? r.y0 : r.lift) <= reach;
    let rec = per.get(r.owner);
    if (!rec) per.set(r.owner, rec = { owner: r.owner, drawnM: 0, ghostM: 0, highM: 0, highGhostM: 0, runs: 0 });
    rec.runs++;
    if (reachable) rec.drawnM += L; else rec.highM += L;
    let gapFrom = null;
    for (let i = 0; i < n; i++) {
      const px = r.x0 + dx * (i + 0.5), pz = r.z0 + dz * (i + 0.5);
      const cand = grid.at(px, pz);
      let hit = false;
      for (let c = 0; c < cand.length; c++) {
        const s = solids[cand[c]];
        if (!ySpansOverlap(r.y0, r.y1, s.y0, s.y1)) continue;
        if (inSolid(px, pz, s, tol)) { hit = true; break; }
      }
      const segM = L / n;
      if (!hit) {
        if (reachable) rec.ghostM += segM; else rec.highGhostM += segM;
        if (gapFrom == null) gapFrom = i;
      } else if (gapFrom != null) {
        closeGap(r, gapFrom, i, n, L);
        gapFrom = null;
      }
    }
    if (gapFrom != null) closeGap(r, gapFrom, n, n, L);
  }
  function closeGap(r, i0, i1, n, L) {
    const len = (i1 - i0) / n * L;
    if (len < minRun) return;
    const t0 = i0 / n, t1 = i1 / n, tm = (t0 + t1) / 2;
    gaps.push({
      owner: r.owner, len: +len.toFixed(2),
      x: +(r.x0 + (r.x1 - r.x0) * tm).toFixed(1), z: +(r.z0 + (r.z1 - r.z0) * tm).toFixed(1),
      h: +(r.y1 - r.y0).toFixed(2), yTop: +r.y1.toFixed(2),
      lift: r.lift == null ? +r.y0.toFixed(2) : r.lift,
      reachable: (r.lift == null ? r.y0 : r.lift) <= reach,
    });
  }
  for (const rec of per.values()) {
    rec.drawnM = +rec.drawnM.toFixed(1);
    rec.ghostM = +rec.ghostM.toFixed(1);
    rec.highM = +rec.highM.toFixed(1);
    rec.highGhostM = +rec.highGhostM.toFixed(1);
    rec.coverPct = rec.drawnM ? +(100 * (1 - rec.ghostM / rec.drawnM)).toFixed(1) : 100;
  }
  gaps.sort((a, b) => b.len - a.len);
  return { per: [...per.values()].sort((a, b) => b.ghostM - a.ghostM), gaps,
           reachable: gaps.filter((g) => g.reachable) };
}

// ================================================================ 3. PHANTOM
/* The mirror question: solid ground with nothing drawn on it. Only asked of
   WALL-THIN solids (min footprint dimension <= maxThick) — a building's
   collider is legitimately solid all the way through, and counting its
   interior as phantom would drown the signal. Rasterised in the solid's own
   frame at `cell`, so a rotated box is measured as itself. */
export function phantom(runs, solids, opt = {}) {
  const cell = opt.cell ?? 0.5;
  const tol = opt.tol ?? 0.4;
  const maxThick = opt.maxThick ?? 2.0;
  const grid = gridOf(runs, 16, (r) => [Math.min(r.x0, r.x1) - 1, Math.min(r.z0, r.z1) - 1,
                                        Math.max(r.x0, r.x1) + 1, Math.max(r.z0, r.z1) + 1]);
  const out = [];
  let totalArea = 0, testedArea = 0;
  for (let si = 0; si < solids.length; si++) {
    const s = solids[si];
    const w = s.yaw != null ? 2 * s.hw : s.maxX - s.minX;
    const d = s.yaw != null ? 2 * s.hd : s.maxZ - s.minZ;
    if (Math.min(w, d) > maxThick) continue;               // a block, not a wall
    const area = solidArea(s);
    if (area < 0.05) continue;
    testedArea += area;
    const nx = Math.max(1, Math.round(w / cell)), nz = Math.max(1, Math.round(d / cell));
    const cellA = area / (nx * nz);
    let bad = 0;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const u = (i + 0.5) / nx - 0.5, v = (j + 0.5) / nz - 0.5;
      let px, pz;
      if (s.yaw != null) {
        const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
        const lx = u * 2 * s.hw, lz = v * 2 * s.hd;
        px = s.cx + lx * c + lz * sn; pz = s.cz - lx * sn + lz * c;
      } else {
        px = s.minX + (s.maxX - s.minX) * (i + 0.5) / nx;
        pz = s.minZ + (s.maxZ - s.minZ) * (j + 0.5) / nz;
      }
      if (!nearRun(px, pz, s)) bad++;
    }
    if (!bad) continue;
    const a = bad * cellA;
    totalArea += a;
    out.push({ i: s.i, area: +a.toFixed(2), frac: +(a / area).toFixed(2),
               x: +((s.minX + s.maxX) / 2).toFixed(1), z: +((s.minZ + s.maxZ) / 2).toFixed(1),
               w: +w.toFixed(2), d: +d.toFixed(2), yaw: s.yaw == null ? null : +s.yaw.toFixed(3),
               ref: s.ref || null });
  }
  function nearRun(px, pz, s) {
    for (const ri of grid.range(px - tol, pz - tol, px + tol, pz + tol)) {
      const r = runs[ri];
      if (!ySpansOverlap(r.y0, r.y1, s.y0, s.y1)) continue;
      if (pointSegDist(px, pz, r) <= tol) return true;
    }
    return false;
  }
  out.sort((a, b) => b.area - a.area);
  return { totalArea: +totalArea.toFixed(1), testedArea: +testedArea.toFixed(1), items: out };
}

export function pointSegDist(px, pz, r) {
  const dx = r.x1 - r.x0, dz = r.z1 - r.z0;
  const L2 = dx * dx + dz * dz;
  let t = L2 ? ((px - r.x0) * dx + (pz - r.z0) * dz) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (r.x0 + dx * t), pz - (r.z0 + dz * t));
}

// ============================================================= 4. SOLID×SOLID
/* Two colliders standing on the same ground. Abutting chain links share an
   edge and score ~0 area, so anything above `minArea` is a real double-wall:
   two builders each registering the same barrier, or one structure's collider
   swallowing another's doorway. */
export function solidClash(solids, opt = {}) {
  const minArea = opt.minArea ?? 0.75;
  const minFrac = opt.minFrac ?? 0.15;
  const grid = gridOf(solids, 16, (s) => [s.minX, s.minZ, s.maxX, s.maxZ]);
  const seen = new Set();
  const out = [];
  let total = 0;
  for (let a = 0; a < solids.length; a++) {
    const A = solids[a];
    const cand = grid.range(A.minX, A.minZ, A.maxX, A.maxZ);
    const pa = solidCorners(A), aa = solidArea(A);
    for (const b of cand) {
      if (b <= a) continue;
      const B = solids[b];
      const kk = a * 1e7 + b; if (seen.has(kk)) continue; seen.add(kk);
      if (A.maxX <= B.minX || B.maxX <= A.minX || A.maxZ <= B.minZ || B.maxZ <= A.minZ) continue;
      if (!ySpansOverlap(A.y0 ?? 0, A.y1 ?? 1e4, B.y0, B.y1)) continue;
      const area = convexOverlapArea(pa, solidCorners(B));
      if (area < minArea) continue;
      const ab = solidArea(B);
      const frac = area / Math.max(1e-6, Math.min(aa, ab));
      if (frac < minFrac) continue;
      total += area;
      out.push({ a: A.i, b: B.i, area: +area.toFixed(2), frac: +frac.toFixed(2),
                 x: +((Math.max(A.minX, B.minX) + Math.min(A.maxX, B.maxX)) / 2).toFixed(1),
                 z: +((Math.max(A.minZ, B.minZ) + Math.min(A.maxZ, B.maxZ)) / 2).toFixed(1),
                 refA: A.ref || null, refB: B.ref || null });
    }
  }
  out.sort((x, y) => y.area - x.area);
  return { totalArea: +total.toFixed(1), items: out };
}

// ================================================================= 5. PIERCE
/* Geometry passing THROUGH geometry. A crossing that is interior to BOTH
   runs by at least `bite` metres, with overlapping height, between two
   different structures. A wall ENDING on another wall (a T, an abutment) is
   how buildings are supposed to meet and scores nothing; a fence run that
   carries on out the far side of a grandstand is the bug. */
export function pierce(runs, opt = {}) {
  const bite = opt.bite ?? 0.5;
  const minAng = opt.minAng ?? 12 * Math.PI / 180;   // near-parallel faces are one wall
  const grid = gridOf(runs, 24, (r) => [Math.min(r.x0, r.x1), Math.min(r.z0, r.z1),
                                        Math.max(r.x0, r.x1), Math.max(r.z0, r.z1)]);
  const out = [];
  const seen = new Set();
  for (let a = 0; a < runs.length; a++) {
    const A = runs[a];
    const la = segLen(A);
    if (la < bite * 2) continue;
    for (const b of grid.range(Math.min(A.x0, A.x1), Math.min(A.z0, A.z1),
                               Math.max(A.x0, A.x1), Math.max(A.z0, A.z1))) {
      if (b <= a) continue;
      const B = runs[b];
      if (B.owner === A.owner) continue;
      const lb = segLen(B);
      if (lb < bite * 2) continue;
      const k = a * 1e7 + b; if (seen.has(k)) continue; seen.add(k);
      if (!ySpansOverlap(A.y0, A.y1, B.y0, B.y1)) continue;
      const hit = segCross(A, B);
      if (!hit) continue;
      // interior to both, by a real bite on both sides
      if (hit.ta * la < bite || (1 - hit.ta) * la < bite) continue;
      if (hit.tb * lb < bite || (1 - hit.tb) * lb < bite) continue;
      const ang = Math.abs(Math.atan2(A.z1 - A.z0, A.x1 - A.x0) - Math.atan2(B.z1 - B.z0, B.x1 - B.x0));
      const cross = Math.min(Math.abs(Math.sin(ang)), 1);
      if (Math.asin(cross) < minAng) continue;
      const oy0 = Math.max(A.y0, B.y0), oy1 = Math.min(A.y1, B.y1);
      out.push({
        a: A.owner, b: B.owner, x: +hit.x.toFixed(1), z: +hit.z.toFixed(1),
        // how deep the shallower run runs past the crossing: the bite you
        // would have to trim to un-pierce it.
        depth: +Math.min(Math.min(hit.ta, 1 - hit.ta) * la, Math.min(hit.tb, 1 - hit.tb) * lb).toFixed(2),
        yOverlap: +(oy1 - oy0).toFixed(2), ang: +(Math.asin(cross) * 180 / Math.PI).toFixed(0),
      });
    }
  }
  out.sort((x, y) => y.depth * y.yOverlap - x.depth * x.yOverlap);
  /* ROLLED UP BY PAIR. One grandstand deck meeting its own rake produced six
     near-identical rows on the first speedway run and pushed everything else
     off the table; what a reader wants is "these two structures interlock,
     N times, deepest here". The raw crossings stay on `.all`. */
  const byPair = new Map();
  for (const p of out) {
    const k = p.a < p.b ? p.a + "\u0000" + p.b : p.b + "\u0000" + p.a;
    let e = byPair.get(k);
    if (!e) byPair.set(k, e = { a: p.a < p.b ? p.a : p.b, b: p.a < p.b ? p.b : p.a,
                                n: 0, maxDepth: 0, maxDy: 0, x: p.x, z: p.z });
    e.n++;
    if (p.depth > e.maxDepth) { e.maxDepth = p.depth; e.maxDy = p.yOverlap; e.x = p.x; e.z = p.z; }
  }
  const pairs = [...byPair.values()].sort((x, y) => y.maxDepth * y.maxDy - x.maxDepth * x.maxDy);
  pairs.all = out;
  return pairs;
}

export function segCross(A, B) {
  const r1x = A.x1 - A.x0, r1z = A.z1 - A.z0;
  const r2x = B.x1 - B.x0, r2z = B.z1 - B.z0;
  const den = r1x * r2z - r1z * r2x;
  if (Math.abs(den) < 1e-9) return null;
  const qx = B.x0 - A.x0, qz = B.z0 - A.z0;
  const ta = (qx * r2z - qz * r2x) / den;
  const tb = (qx * r1z - qz * r1x) / den;
  if (ta < 0 || ta > 1 || tb < 0 || tb > 1) return null;
  return { ta, tb, x: A.x0 + r1x * ta, z: A.z0 + r1z * ta };
}

// =============================================================== 6. ROAD CLASH
/* A carriageway is the one place the world promises you can drive. Anything
   solid standing in one is a bug with a cost you can quote in square metres,
   and a barrier DRAWN across one is the same bug you can also see. */
export function roadClash(runs, solids, roads, opt = {}) {
  const maxY0 = opt.maxY0 ?? 2.5;        // a deck at y0=6 is a bridge, not a wall
  const inset = opt.inset ?? 0.6;        // ignore kerb-line grazes
  const minBlock = opt.minBlock ?? 0.15; // fraction of the carriageway width
  const out = { solidArea: 0, solids: [], barrierM: 0, barriers: [] };
  if (!roads.length) return out;
  const rgrid = gridOf(roads, 32, (r) => [r.minX, r.minZ, r.maxX, r.maxZ]);
  /* AREA IS THE WRONG QUESTION ON A ROAD. A wall running ALONGSIDE a
     carriageway, just inside its kerb line, has area in it and blocks
     nobody; a 0.3 m fence laid ACROSS it has almost no area and closes the
     road. What matters is how much of the WIDTH is gone, so every finding
     here is scored on the cross-axis: `block` is the fraction of the
     carriageway's width the obstruction spans. */
  function cross(R, x, z) { return R.maxX - R.minX > R.maxZ - R.minZ ? z : x; }
  function width(R) { return Math.min(R.maxX - R.minX, R.maxZ - R.minZ); }

  for (const s of solids) {
    if ((s.y0 ?? 0) > maxY0) continue;
    const pa = solidCorners(s);
    for (const ri of rgrid.range(s.minX, s.minZ, s.maxX, s.maxZ)) {
      const R = roads[ri];
      const clip = [[R.minX + inset, R.minZ + inset], [R.maxX - inset, R.minZ + inset],
                    [R.maxX - inset, R.maxZ - inset], [R.minX + inset, R.maxZ - inset]];
      const a = convexOverlapArea(pa, clip);
      if (a < 0.5) continue;
      // cross-extent of the box clipped to the carriageway
      let c0 = Infinity, c1 = -Infinity;
      for (const p of pa) {
        const cx = Math.min(Math.max(cross(R, p[0], p[1]),
          cross(R, R.minX + inset, R.minZ + inset)), cross(R, R.maxX - inset, R.maxZ - inset));
        if (cx < c0) c0 = cx; if (cx > c1) c1 = cx;
      }
      const block = (c1 - c0) / (width(R) || 1);
      if (block < minBlock) continue;
      out.solidArea += a;
      out.solids.push({ i: s.i, area: +a.toFixed(2), block: +block.toFixed(2),
                        x: +((s.minX + s.maxX) / 2).toFixed(1),
                        z: +((s.minZ + s.maxZ) / 2).toFixed(1), road: R.district, w: R.w });
    }
  }
  for (const r of runs) {
    if (r.y0 > maxY0) continue;
    const L = segLen(r), n = Math.max(1, Math.ceil(L / 0.5));
    const per = new Map();
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const px = r.x0 + (r.x1 - r.x0) * t, pz = r.z0 + (r.z1 - r.z0) * t;
      for (const ri of rgrid.at(px, pz)) {
        const R = roads[ri];
        if (px > R.minX + inset && px < R.maxX - inset && pz > R.minZ + inset && pz < R.maxZ - inset) {
          let e = per.get(ri);
          if (!e) per.set(ri, e = { m: 0, c0: Infinity, c1: -Infinity });
          e.m += L / n;
          const c = cross(R, px, pz);
          if (c < e.c0) e.c0 = c; if (c > e.c1) e.c1 = c;
          break;
        }
      }
    }
    for (const [ri, e] of per) {
      const R = roads[ri];
      const block = (e.c1 - e.c0) / (width(R) || 1);
      if (e.m < 1.0 || block < minBlock) continue;
      out.barrierM += e.m;
      out.barriers.push({ owner: r.owner, m: +e.m.toFixed(1), block: +block.toFixed(2),
                          road: R.district, w: R.w,
                          x: +((r.x0 + r.x1) / 2).toFixed(1), z: +((r.z0 + r.z1) / 2).toFixed(1),
                          h: +(r.y1 - r.y0).toFixed(2) });
    }
  }
  out.solidArea = +out.solidArea.toFixed(1);
  out.barrierM = +out.barrierM.toFixed(1);
  out.solids.sort((a, b) => b.block - a.block || b.area - a.area);
  out.barriers.sort((a, b) => b.block - a.block || b.m - a.m);
  return out;
}
