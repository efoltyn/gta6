/* ============================================================
   src/world/hull_loft.js — CBZ.hullLoft: A HULL IS A LOFTED SURFACE.

   THE PROBLEM THIS FILE EXISTS TO KILL
   ------------------------------------------------------------
   Every boat in this game was a stack of 3-6 stepped BOXES. water_hulls.js
   draws a 14 m cruiser as four `addPrism()` slabs of decreasing width;
   yachts.js draws an 18 m trawler the same way; and prismGeo() at
   water_hulls.js:144 falls all the way back to a plain BoxGeometry. A box
   has vertical sides, a flat bottom, a plan that changes in STEPS and a
   normal field that is 100% hard edges. Nothing about that is a boat.

   A hull is a SURFACE, and it is defined by lines, not by blocks:

     the SHEER    the line where the topsides meet the deck, seen from the
                  side — low amidships, sweeping up at the bow and (less) aft
     the CHINE    the corner where the bottom meets the topsides. On a
                  planing hull it is the widest part of the section, it is
                  the ONE hard edge on the whole surface, and it exits the
                  water forward — that exit is why a bow looks like a bow
     the KEEL     the line the hull sits on, with rocker: deepest a little
                  aft of amidships, sweeping up to the stem
     DEADRISE     the V of the bottom, measured at the transom and rising
                  (warping) toward the bow
     FLARE        topsides leaning OUT at the bow (throws spray down)
     TUMBLEHOME   topsides leaning IN aft (a workboat/kayak signature)
     the TRANSOM  the flat plate that closes the stern, usually raked
     the STEM     where the two halves of the hull MEET at x = 0

   Give this file those lines and it returns one welded, smooth-shaded
   BufferGeometry with exactly two hard edges (the chine and the transom) —
   which is what a real hull looks like, and what audit() measures.

   THE BLOCK
   ------------------------------------------------------------
     CBZ.hullLoft.surface(stations, o)      -> THREE.BufferGeometry
     CBZ.hullLoft.stationsFromLines(o)      -> stations   (the common hull)
     CBZ.hullLoft.mesh(stations, mat, o)    -> THREE.Mesh
     CBZ.hullLoft.outline(stations)         -> sheer/keel polylines + closures
     CBZ.hullLoft.strip(points, r, mat, o)  -> a swept tube along a polyline
     CBZ.hullLoft.audit(geo)                -> {tris, verts, faceted}

   STATION FORMAT (the input contract)
     stations: ordered STERN -> BOW, each { z, pts:[[y,x],...], chine? }
       · pts is HALF a section: from the keel (x = 0, lowest y) up to the
         sheer (x = half-beam, y = sheer height). y is relative to the
         WATERLINE, so the keel is negative and the sheer is positive.
       · a point may carry a third element: [y, x, dz] — a per-point z
         offset. That is how a RAKED TRANSOM is expressed: the station is
         still planar in the data, the cap leans.
       · `chine` is an index into pts. It is a RESAMPLING FEATURE — it keeps
         the loft's quad grid aligned to the corner across every station. It
         does NOT by itself create a hard edge; o.chine does that.

   FACETED, THE NUMBER THAT SAYS "THIS IS BOXES"
     audit(geo).faceted = the fraction of adjacent face pairs whose normals
     differ by more than 25 degrees. A single BoxGeometry scores 0.67 (its 12
     real corners are hard, its 6 face diagonals are not); a STACK of stepped
     prisms — which is what every hull in this game used to be — scores
     higher still. A lofted hull with only the chine and the transom hard
     lands at 0.05-0.20. It is measured off the geometry itself, so nobody
     can claim a smooth hull without shipping one.

   WATERTIGHTNESS IS MEASURED BY POSITION, NOT BY INDEX. Every hard edge in
   here is a POSITIONAL DUPLICATE of a vertex (that is the only way one
   position gets two normals), so an index-keyed edge count would call a
   perfectly closed hull open. Hash the rounded position instead and the
   surface is manifold everywhere except the sheer rim and the cockpit rim,
   which are supposed to be open.

   r128: BufferGeometry with index + position/normal/uv only. No
   ExtrudeGeometry, no LatheGeometry, no BufferGeometryUtils dependency.
   Determinism: no Math.random anywhere in this file, ever.
============================================================ */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});
  const THREE = window.THREE;
  if (!THREE) return;

  const DEG = Math.PI / 180;
  const EPS = 1e-6;
  const COLLAPSE = 1e-4;          // |x| under this and the station is on the centreline

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function num(v, d) { return (typeof v === "number" && isFinite(v)) ? v : d; }
  function fn(v, d) {
    if (typeof v === "function") return v;
    if (typeof v === "number" && isFinite(v)) return function () { return v; };
    return d;
  }

  // ============================================================
  //  1. RESAMPLING — an even quad grid out of uneven author input
  // ============================================================
  // Every station is redistributed to the SAME number of points by arc
  // length so consecutive stations can be joined with quads instead of a
  // triangulation nobody can reason about. When a station names a `chine`,
  // the split is honoured exactly: a sample lands ON the corner, because a
  // corner that gets averaged away is a corner that stops being an edge.
  function segLen(a, b) { const dy = b[0] - a[0], dx = b[1] - a[1]; return Math.sqrt(dx * dx + dy * dy); }

  function polyLen(pts, i0, i1) {
    let L = 0;
    for (let i = i0; i < i1; i++) L += segLen(pts[i], pts[i + 1]);
    return L;
  }

  // n+1 samples spanning pts[i0..i1] inclusive, evenly spaced by arc length.
  function sampleRun(pts, i0, i1, n, out) {
    const total = polyLen(pts, i0, i1);
    if (!(total > EPS)) {                       // a degenerate run: repeat the point
      for (let k = 0; k <= n; k++) out.push({ x: pts[i0][1], y: pts[i0][0], dz: num(pts[i0][2], 0) });
      return;
    }
    let seg = i0, acc = 0, segL = segLen(pts[i0], pts[i0 + 1]);
    for (let k = 0; k <= n; k++) {
      const want = total * (k / n);
      while (want > acc + segL && seg < i1 - 1) { acc += segL; seg++; segL = segLen(pts[seg], pts[seg + 1]); }
      const f = segL > EPS ? clamp((want - acc) / segL, 0, 1) : 0;
      const a = pts[seg], b = pts[seg + 1];
      out.push({
        x: a[1] + (b[1] - a[1]) * f,
        y: a[0] + (b[0] - a[0]) * f,
        dz: num(a[2], 0) + (num(b[2], 0) - num(a[2], 0)) * f,
      });
    }
  }

  // rings samples across the half-section. `split` (or null) is the index in
  // `pts` that must survive as sample number `at`.
  function resampleHalf(pts, rings, split, at) {
    const out = [];
    if (split == null || split <= 0 || split >= pts.length - 1) {
      sampleRun(pts, 0, pts.length - 1, rings - 1, out);
    } else {
      sampleRun(pts, 0, split, at, out);
      const tail = [];
      sampleRun(pts, split, pts.length - 1, rings - 1 - at, tail);
      tail.shift();                              // the chine sample is already in
      for (const p of tail) out.push(p);
    }
    if (out.length && Math.abs(out[0].x) < EPS) out[0].x = 0;
    return out;
  }

  // ============================================================
  //  2. surface() — the loft
  // ============================================================
  function surface(stations, o) {
    o = o || {};
    if (!Array.isArray(stations) || stations.length < 2) return new THREE.BufferGeometry();
    const rings = Math.max(3, Math.round(num(o.rings, 9)));
    const mirror = o.mirror !== false;
    const transom = o.transom == null ? "flat" : o.transom;
    const stemRound = Math.max(0, num(o.stemRound, 0));

    // ---- normalise the author's stations -----------------------------------
    const raw = [];
    for (const st of stations) {
      if (!st || !Array.isArray(st.pts) || st.pts.length < 2) continue;
      let pts = st.pts.map(function (p) { return [p[0], Math.abs(p[1]), num(p[2], 0)]; });
      let chine = (typeof st.chine === "number") ? st.chine : null;
      if (pts[0][1] > EPS) {                     // flat-bottom section with no centreline point
        pts = [[pts[0][0], 0, pts[0][2]]].concat(pts);
        if (chine != null) chine++;
      }
      raw.push({ z: st.z, pts: pts, chine: chine });
    }
    if (raw.length < 2) return new THREE.BufferGeometry();

    // ONE chine ring index for the whole loft. If it were solved per station
    // the grid would shear and the "hard edge" would wander diagonally across
    // the hull, which is worse than no chine at all.
    let chineRing = null;
    if (raw.some(function (s) { return s.chine != null; })) {
      let sum = 0, n = 0;
      for (const s of raw) {
        if (s.chine == null) continue;
        const a = polyLen(s.pts, 0, s.chine), b = polyLen(s.pts, s.chine, s.pts.length - 1);
        if (a + b > EPS) { sum += a / (a + b); n++; }
      }
      if (n) chineRing = clamp(Math.round((rings - 1) * (sum / n)), 1, rings - 2);
    }

    const half = raw.map(function (s) {
      return resampleHalf(s.pts, rings, s.chine != null ? s.chine : null, chineRing == null ? 1 : chineRing);
    });
    if (stemRound > 0) {
      const last = half[half.length - 1];
      for (const p of last) p.x = Math.max(p.x, stemRound);
    }

    // hard-edge rings: o.chine "auto" | index | [indices]
    const hard = new Set();
    if (o.chine === "auto") { if (chineRing != null) hard.add(chineRing); }
    else if (typeof o.chine === "number") hard.add(clamp(Math.round(o.chine), 1, rings - 2));
    else if (Array.isArray(o.chine)) for (const c of o.chine) hard.add(clamp(Math.round(c), 1, rings - 2));

    // ---- the ring slot list: which half-index, which side, which copy ------
    // A hard edge is a POSITION with two normals, so the chine ring appears
    // twice: the "lo" copy is welded to the bottom panels, the "hi" copy to
    // the topsides, and the zero-area quad between them is dropped.
    const slots = [];
    if (mirror) {
      for (let k = rings - 1; k >= 1; k--) {
        if (hard.has(k)) { slots.push({ k: k, s: -1, t: "hi" }); slots.push({ k: k, s: -1, t: "lo" }); }
        else slots.push({ k: k, s: -1, t: "" });
      }
      slots.push({ k: 0, s: 1, t: "" });
      for (let k = 1; k <= rings - 1; k++) {
        if (hard.has(k)) { slots.push({ k: k, s: 1, t: "lo" }); slots.push({ k: k, s: 1, t: "hi" }); }
        else slots.push({ k: k, s: 1, t: "" });
      }
    } else {
      for (let k = 0; k <= rings - 1; k++) {
        if (hard.has(k)) { slots.push({ k: k, s: 1, t: "lo" }); slots.push({ k: k, s: 1, t: "hi" }); }
        else slots.push({ k: k, s: 1, t: "" });
      }
    }
    const M = slots.length;

    const pos = [], uv = [], idx = [];
    function vert(x, y, z, u, v) { pos.push(x, y, z); uv.push(u, v); return (pos.length / 3) - 1; }
    function tri(a, b, c) {
      if (a === b || b === c || a === c) return;
      const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
      const bx = pos[b * 3] - ax, by = pos[b * 3 + 1] - ay, bz = pos[b * 3 + 2] - az;
      const cx = pos[c * 3] - ax, cy = pos[c * 3 + 1] - ay, cz = pos[c * 3 + 2] - az;
      const nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx;
      if (nx * nx + ny * ny + nz * nz < 1e-14) return;          // zero-area: the chine seam
      idx.push(a, b, c);
    }
    function quad(a, b, c, d) { tri(a, b, c); tri(a, c, d); }

    // ---- the hull vertices -------------------------------------------------
    const N = raw.length;
    const ring = [];                       // ring[i][m] -> vertex index
    const collapsed = [];
    const zAt = raw.map(function (s) { return s.z; });
    const z0 = zAt[0], z1 = zAt[N - 1], zSpan = Math.abs(z1 - z0) > EPS ? (z1 - z0) : 1;
    for (let i = 0; i < N; i++) {
      const h = half[i];
      let flat = true;
      for (const p of h) if (Math.abs(p.x) > COLLAPSE) { flat = false; break; }
      collapsed.push(flat);
      const row = new Array(M);
      const seen = flat ? new Map() : null;
      const v = (zAt[i] - z0) / zSpan;
      for (let m = 0; m < M; m++) {
        const sl = slots[m], p = h[sl.k];
        if (flat) {
          const key = sl.k + "|" + sl.t;
          if (seen.has(key)) { row[m] = seen.get(key); continue; }
          const id = vert(0, p.y, zAt[i] + p.dz, m / (M - 1), v);
          seen.set(key, id); row[m] = id;
        } else {
          row[m] = vert(sl.s * p.x, p.y, zAt[i] + p.dz, m / (M - 1), v);
        }
      }
      ring.push(row);
    }
    for (let i = 0; i < N - 1; i++) {
      for (let m = 0; m < M - 1; m++) {
        quad(ring[i][m], ring[i][m + 1], ring[i + 1][m + 1], ring[i + 1][m]);
      }
    }

    // ---- deck lid ----------------------------------------------------------
    // A flat lid across the sheer with `deckCamber` metres of crown, welded to
    // the sheer BY POSITION (its own vertices, so the deck edge stays a hard
    // corner) and holed where the cockpit is.
    let deckTris = 0, deckRow = null, deckCols = 0;
    if (o.deck) {
      const camber = num(o.deckCamber, 0);
      const ck = o.cockpit || null;
      const cols = Math.max(3, Math.round(num(o.deckCols, mirror ? 7 : 4)));
      const xs = [];
      for (let k = 0; k < cols; k++) xs.push(mirror ? (-1 + 2 * k / (cols - 1)) : (k / (cols - 1)));
      const drow = [];
      for (let i = 0; i < N; i++) {
        const hb = half[i][rings - 1].x, sy = half[i][rings - 1].y, dz = half[i][rings - 1].dz;
        const row = new Array(cols);
        if (hb < COLLAPSE) {
          const id = vert(0, sy, zAt[i] + dz, 0.5, i / (N - 1));
          for (let k = 0; k < cols; k++) row[k] = id;
        } else {
          for (let k = 0; k < cols; k++) {
            const f = xs[k];
            row[k] = vert(f * hb, sy + camber * (1 - f * f), zAt[i] + dz, 0.5 + f * 0.5, i / (N - 1));
          }
        }
        drow.push(row);
      }
      deckRow = drow; deckCols = cols;
      const before = idx.length;
      for (let i = 0; i < N - 1; i++) {
        const zc = (zAt[i] + zAt[i + 1]) * 0.5;
        for (let k = 0; k < cols - 1; k++) {
          if (ck) {
            const hbm = (half[i][rings - 1].x + half[i + 1][rings - 1].x) * 0.5;
            const xc = (xs[k] + xs[k + 1]) * 0.5 * hbm;
            if (zc > ck.z0 && zc < ck.z1 && Math.abs(xc) < ck.halfW) continue;
          }
          const A = drow[i][k], B = drow[i][k + 1], C = drow[i + 1][k + 1], D = drow[i + 1][k];
          tri(A, C, B); tri(A, D, C);
        }
      }
      deckTris = (idx.length - before) / 3;
    }

    // ---- the end plates (their own verts: a transom is a HARD edge) --------
    // The rim walks the hull section from the port sheer, round the keel, up
    // to the starboard sheer — and then, WHEN THERE IS A DECK, back across
    // the deck's cambered crown. Closing to the straight sheer chord instead
    // leaves a wedge of daylight between the transom and a crowned deck, and
    // that gap is exactly the size of the camber.
    function cap(i, outward) {
      const h = half[i];
      if (collapsed[i]) return;
      let cx = 0, cy = 0, cz = 0, n = 0;
      const rimA = [];
      function put(x, y, z) {
        rimA.push(vert(x, y, z, 0.5 + x * 0.02, 0.5 + y * 0.02));
        cx += x; cy += y; cz += z; n++;
      }
      for (let m = 0; m < M; m++) {
        const sl = slots[m];
        if (sl.t === "lo") continue;                       // one copy per position
        const p = h[sl.k];
        put(sl.s * p.x, p.y, zAt[i] + p.dz);
      }
      if (deckRow) {
        const hb = h[rings - 1].x, sy = h[rings - 1].y, dz = h[rings - 1].dz;
        const camber = num(o.deckCamber, 0);
        for (let k = deckCols - 2; k >= 1; k--) {
          const f = mirror ? (-1 + 2 * k / (deckCols - 1)) : (k / (deckCols - 1));
          put(f * hb, sy + camber * (1 - f * f), zAt[i] + dz);
        }
      }
      if (n < 3) return;
      const c = vert(cx / n, cy / n, cz / n, 0.5, 0.5);
      for (let m = 0; m < rimA.length; m++) {
        const a = rimA[m], b = rimA[(m + 1) % rimA.length];
        if (outward > 0) tri(c, a, b); else tri(c, b, a);
      }
    }
    if (transom === "flat") cap(0, -1);
    if (stemRound > 0) cap(N - 1, 1);

    const geo = new THREE.BufferGeometry();
    geo.setIndex(idx);
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    geo.userData.hullLoft = {
      rings: rings, ringSlots: M, stations: N, chineRing: chineRing,
      hardRings: Array.from(hard), deckTris: deckTris,
      tris: idx.length / 3, verts: pos.length / 3,
    };
    return geo;
  }

  // ============================================================
  //  3. stationsFromLines() — the common hull, from lines a human knows
  // ============================================================
  // THE ONE PLACE the naval-architecture relations live. Every hull in the
  // fleet is these numbers with different values; nobody types a section
  // point by hand again.
  function stationsFromLines(opts) {
    const o = opts || {};
    const loa = num(o.loa, 6);
    const beam = num(o.beam, 2);
    const draft = num(o.draft, 0.4);
    const freeboard = num(o.freeboard, 0.5);
    const sheerBow = num(o.sheerBow, freeboard * 0.55);
    const sheerStern = num(o.sheerStern, freeboard * 0.12);
    const n = Math.max(5, Math.round(num(o.n, 13)));
    const roundBilge = !!o.roundBilge;
    const bilgeN = num(o.bilgeN, 2.4);
    const deadT = num(o.deadrise, 12) * DEG;
    const deadB = num(o.deadriseBow, Math.min(62, num(o.deadrise, 12) + 26)) * DEG;
    const flare = num(o.flareBow, 12) * DEG;
    const tumble = num(o.tumblehome, 0) * DEG;
    const rake = num(o.transomRake, 12) * DEG;
    const chineBeamFrac = num(o.chineBeamFrac, 0.99);
    const rockerAft = num(o.rockerAft, 0.92);
    // THE PARALLEL MIDBODY. A hull is not a lens: it carries its full beam
    // over a long middle run and only then tapers. yachts.js's beamFrac()
    // proved the shape (full beam from 0.19 to 0.675 of the length, then a
    // 1.7-power knife entry) and this is that curve in 0..1 form.
    const mb0 = clamp(num(o.midBody0, 0.20), 0.02, 0.90);
    const mb1 = clamp(num(o.midBody1, 0.66), mb0 + 0.02, 0.98);
    const tKeel = clamp(num(o.tKeel, (mb0 + mb1) * 0.5), 0.05, 0.95);
    const transomBeam = clamp(num(o.transomBeamFrac, 0.86), 0.02, 1);
    const entryPow = num(o.entryPow, 1.7);
    const maxBeamFrac = clamp(num(o.maxBeamHeight, roundBilge ? 0.66 : 1), 0.05, 1);

    // half-beam in PLAN: 1.0 across the midbody, 0 at the stem.
    const plan = fn(o.planHalfBeam, function (t) {
      if (t < mb0) return transomBeam + (1 - transomBeam) * Math.pow(t / mb0, 0.75);
      if (t <= mb1) return 1;
      return Math.pow(clamp((1 - t) / (1 - mb1), 0, 1), entryPow);
    });
    // keel ROCKER: deepest in the middle of the midbody, sweeping to the stem.
    const keelProf = fn(o.keelProfile, function (t) {
      if (t <= tKeel) return rockerAft + (1 - rockerAft) * Math.pow(t / tKeel, 0.9);
      return 1 - Math.pow(clamp((t - tKeel) / (1 - tKeel), 0, 1), 1.9) * 0.98;
    });
    // SHEER: exactly `freeboard` amidships, rising to both ends. Both terms are
    // zero at t = 0.5 so "freeboard" means what a spec sheet means by it.
    const sheerProf = fn(o.sheerProfile, function (t) {
      const b = t > 0.5 ? Math.pow((t - 0.5) * 2, 2) : 0;
      const s = t < 0.5 ? Math.pow((0.5 - t) * 2, 2) : 0;
      return freeboard + sheerBow * b + sheerStern * s;
    });
    const chineY = o.chineY != null ? fn(o.chineY, null) : null;

    // Evenly spaced stations, then the THREE parameters that define the hull
    // (both ends of the midbody and the deepest point of the keel) are pulled
    // onto the nearest station. Without that, "beam" and "draft" are numbers
    // the mesh misses by whatever the station spacing happens to be — which is
    // exactly the beamFitErr the fleet preset measures.
    const ts = [];
    for (let i = 0; i < n; i++) ts.push(i / (n - 1));
    for (const forced of [mb0, mb1, tKeel]) {
      let best = 1, bd = Infinity;
      for (let i = 1; i < n - 1; i++) { const d = Math.abs(ts[i] - forced); if (d < bd) { bd = d; best = i; } }
      ts[best] = forced;
    }
    ts.sort(function (a, b) { return a - b; });

    const stations = [];
    for (let i = 0; i < n; i++) {
      const t = ts[i];
      const z = -loa * 0.5 + loa * t;
      const hb = Math.max(0, beam * 0.5 * plan(t));
      const yk = -draft * keelProf(t);
      const ys = sheerProf(t);
      const beta = deadT + (deadB - deadT) * Math.pow(t, 1.3);
      // topside lean: tumblehome aft (in), flare forward (out)
      const lean = flare * Math.pow(t, 1.6) - tumble * Math.pow(1 - t, 1.4);
      const depth = Math.max(0.02, ys - yk);
      let pts, chineIdx = null;

      if (hb < 1e-4) {                                   // the STEM: a line at x = 0
        pts = [[yk, 0], [yk + depth * 0.45, 0], [ys, 0]];
        chineIdx = 1;
      } else if (roundBilge) {
        // A superellipse from the keel up to the maximum-beam point, then a
        // straight run in to the sheer. That curve IS the round bilge — a
        // kayak has no corner anywhere on it.
        const ym = yk + depth * maxBeamFrac;
        const xs = clamp(hb + (ys - ym) * Math.tan(lean), hb * 0.25, hb);
        pts = [];
        const LOW = 6;
        for (let k = 0; k <= LOW; k++) {
          const f = k / LOW;
          const x = hb * f;
          const y = ym - (ym - yk) * Math.pow(Math.max(0, 1 - Math.pow(f, bilgeN)), 1 / bilgeN);
          pts.push([y, x]);
        }
        chineIdx = pts.length - 1;                        // the turn of the bilge
        pts.push([ym + (ys - ym) * 0.5, hb + (xs - hb) * 0.5]);
        pts.push([ys, xs]);
      } else {
        // HARD CHINE. Solve the chine so the widest point of the section is
        // exactly hb whichever way the topsides lean — otherwise the measured
        // beam and the spec sheet stop agreeing, which is the bug the box
        // hulls had.
        let xc, yc;
        if (chineY) {
          yc = clamp(-chineY(t), yk + depth * 0.06, ys - depth * 0.10);
          xc = lean >= 0 ? clamp(hb - (ys - yc) * Math.tan(lean), hb * 0.25, hb) : hb;
        } else if (lean >= 0) {
          const tb = Math.tan(beta), tl = Math.tan(lean);
          xc = clamp((hb - depth * tl) / Math.max(0.15, 1 - tb * tl), hb * 0.25, hb);
          yc = clamp(yk + xc * tb, yk + depth * 0.06, ys - depth * 0.10);
        } else {
          xc = hb;
          yc = clamp(yk + xc * Math.tan(beta), yk + depth * 0.06, ys - depth * 0.10);
        }
        const xs = lean >= 0 ? hb : clamp(hb + (ys - yc) * Math.tan(lean), hb * 0.25, hb);
        pts = [[yk, 0], [yc, xc], [ys, xs]];
        chineIdx = 1;
      }

      // THE RAKED TRANSOM: the stern station leans aft with height. Expressed
      // as a per-point z offset so the station stays one row of the grid.
      if (i === 0 && Math.abs(rake) > 1e-4) {
        const tr = Math.tan(rake);
        for (const p of pts) p[2] = -(p[0] - yk) * tr;
      }
      stations.push({ z: z, pts: pts, chine: chineIdx });
    }
    return stations;
  }

  // ============================================================
  //  4. outline() — where the fittings go
  // ============================================================
  // Deck hardware placed at "roughly the right offset" is how a cleat ends up
  // hanging in the air beside a hull that got 4 cm narrower. Read the sheer.
  function outline(stations) {
    const stbd = [], port = [], keel = [], zs = [], hbs = [], sy = [], ky = [];
    for (const st of stations) {
      if (!st || !Array.isArray(st.pts) || !st.pts.length) continue;
      const last = st.pts[st.pts.length - 1];
      let hb = 0;
      for (const p of st.pts) hb = Math.max(hb, Math.abs(p[1]));
      const zTop = st.z + num(last[2], 0), zKeel = st.z + num(st.pts[0][2], 0);
      stbd.push([Math.abs(last[1]), last[0], zTop]);
      port.push([-Math.abs(last[1]), last[0], zTop]);
      keel.push([0, st.pts[0][0], zKeel]);
      zs.push(st.z); hbs.push(hb); sy.push(last[0]); ky.push(st.pts[0][0]);
    }
    function interp(arr, z) {
      if (!zs.length) return 0;
      if (z <= zs[0]) return arr[0];
      if (z >= zs[zs.length - 1]) return arr[arr.length - 1];
      for (let i = 0; i < zs.length - 1; i++) {
        if (z <= zs[i + 1]) {
          const f = (z - zs[i]) / Math.max(EPS, zs[i + 1] - zs[i]);
          return arr[i] + (arr[i + 1] - arr[i]) * f;
        }
      }
      return arr[arr.length - 1];
    }
    return {
      sheer: stbd.concat(port.slice().reverse()),
      sheerStarboard: stbd, sheerPort: port, keel: keel,
      z0: zs.length ? zs[0] : 0, z1: zs.length ? zs[zs.length - 1] : 0,
      halfBeamAt: function (z) { return interp(hbs, z); },
      sheerYAt: function (z) { return interp(sy, z); },
      keelYAt: function (z) { return interp(ky, z); },
      maxHalfBeam: hbs.length ? Math.max.apply(null, hbs) : 0,
    };
  }

  // ============================================================
  //  5. strip() — rails, rubbing strakes, bungees, RIB collars
  // ============================================================
  function strip(points, r, material, o) {
    o = o || {};
    const pts = [];
    for (const p of points || []) {
      const v = Array.isArray(p) ? new THREE.Vector3(p[0], p[1], p[2]) : new THREE.Vector3(p.x, p.y, p.z);
      if (pts.length && pts[pts.length - 1].distanceTo(v) < 1e-4) continue;
      pts.push(v);
    }
    if (pts.length < 2) return null;
    const curve = new THREE.CatmullRomCurve3(pts, !!o.closed, o.curveType || "catmullrom", num(o.tension, 0.5));
    const seg = Math.max(2, Math.round(num(o.segments, Math.min(160, pts.length * 4))));
    const rad = Math.max(3, Math.round(num(o.radial, 6)));
    const geo = new THREE.TubeGeometry(curve, seg, Math.max(0.002, num(r, 0.03)), rad, !!o.closed);
    const m = new THREE.Mesh(geo, material);
    m.castShadow = o.castShadow !== false;
    return m;
  }

  // ============================================================
  //  6. mesh() / audit()
  // ============================================================
  function mesh(stations, material, o) {
    const m = new THREE.Mesh(surface(stations, o), material);
    m.castShadow = !(o && o.castShadow === false);
    return m;
  }

  // THE NUMBER THAT SAYS "BOXES". Adjacency is keyed by rounded POSITION, not
  // by index, because every hard edge in surface() is a positional duplicate.
  function audit(geo) {
    const out = { tris: 0, verts: 0, faceted: 0, edges: 0, openEdges: 0, nonManifold: 0 };
    if (!geo || !geo.attributes || !geo.attributes.position) return out;
    const p = geo.attributes.position.array;
    const index = geo.index ? geo.index.array : null;
    const triCount = index ? index.length / 3 : p.length / 9;
    out.verts = p.length / 3;
    out.tris = triCount | 0;
    if (!triCount) return out;
    const Q = 1e4;
    function key(i) {
      return (Math.round(p[i * 3] * Q) + "," + Math.round(p[i * 3 + 1] * Q) + "," + Math.round(p[i * 3 + 2] * Q));
    }
    const normals = new Float64Array(triCount * 3);
    const edges = new Map();
    for (let f = 0; f < triCount; f++) {
      const a = index ? index[f * 3] : f * 3, b = index ? index[f * 3 + 1] : f * 3 + 1, c = index ? index[f * 3 + 2] : f * 3 + 2;
      const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
      const ux = p[b * 3] - ax, uy = p[b * 3 + 1] - ay, uz = p[b * 3 + 2] - az;
      const vx = p[c * 3] - ax, vy = p[c * 3 + 1] - ay, vz = p[c * 3 + 2] - az;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const L = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= L; ny /= L; nz /= L;
      normals[f * 3] = nx; normals[f * 3 + 1] = ny; normals[f * 3 + 2] = nz;
      const ka = key(a), kb = key(b), kc = key(c);
      const pairs = [[ka, kb], [kb, kc], [kc, ka]];
      for (const e of pairs) {
        const k = e[0] < e[1] ? e[0] + "|" + e[1] : e[1] + "|" + e[0];
        let l = edges.get(k);
        if (!l) { l = []; edges.set(k, l); }
        l.push(f);
      }
    }
    let pairsSeen = 0, hardPairs = 0;
    const COS = Math.cos(25 * DEG);
    edges.forEach(function (l) {
      out.edges++;
      if (l.length === 1) out.openEdges++;
      else if (l.length > 2) out.nonManifold++;
      for (let i = 0; i < l.length; i++) {
        for (let j = i + 1; j < l.length; j++) {
          const a = l[i] * 3, b = l[j] * 3;
          const d = normals[a] * normals[b] + normals[a + 1] * normals[b + 1] + normals[a + 2] * normals[b + 2];
          pairsSeen++;
          if (d < COS) hardPairs++;
        }
      }
    });
    out.faceted = pairsSeen ? hardPairs / pairsSeen : 0;
    return out;
  }

  CBZ.hullLoft = {
    surface: surface,
    stationsFromLines: stationsFromLines,
    mesh: mesh,
    outline: outline,
    strip: strip,
    audit: audit,
  };
})();
