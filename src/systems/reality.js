/* ============================================================
   systems/reality.js — fast static-world geometry invariants

   A visible prop is not "grounded" because its y looks plausible. Static
   geometry is a graph:

     primitive AABBs = nodes
     physical contact = edges
     ground / authored walk surfaces = anchors

   Any connected component without an anchor is floating. The broad phase is
   a one-shot 3D uniform hash, so audits scale with nearby contacts instead of
   comparing every primitive with every other primitive.

   This is deliberately geometry-only. Gameplay systems keep owning their
   actual support state; reality.js is the invariant checker shared by browser
   audits, venues, demolition phases, and future build-time world tests.
============================================================ */
(function () {
  "use strict";
  var CBZ = window.CBZ;
  if (!CBZ) return;

  var R = CBZ.reality || (CBZ.reality = {});

  function finite(n) { return typeof n === "number" && isFinite(n); }
  function now() {
    return (typeof performance !== "undefined" && performance.now)
      ? performance.now() : Date.now();
  }

  function normaliseBoxes(input) {
    var out = [];
    input = input || [];
    for (var i = 0; i < input.length; i++) {
      var b = input[i];
      if (!b || !finite(+b.minX) || !finite(+b.maxX) ||
          !finite(+b.minY) || !finite(+b.maxY) ||
          !finite(+b.minZ) || !finite(+b.maxZ)) continue;
      out.push({
        minX: Math.min(+b.minX, +b.maxX), maxX: Math.max(+b.minX, +b.maxX),
        minY: Math.min(+b.minY, +b.maxY), maxY: Math.max(+b.minY, +b.maxY),
        minZ: Math.min(+b.minZ, +b.maxZ), maxZ: Math.max(+b.minZ, +b.maxZ),
        id: b.id == null ? i : b.id,
        kind: b.kind || "box",
        anchor: !!b.anchor,
        inputIndex: i,
        source: b
      });
    }
    return out;
  }

  // Exact world AABB of the unit-box transform arena/world instancers use.
  // Matrix terms match THREE.Euler's XYZ and YXZ orders without depending on
  // THREE, so Node contract tests can exercise the same geometry.
  R.boxFromTransform = function (it, meta) {
    it = it || {};
    var hx = Math.abs(+it.sx || 0) * 0.5;
    var hy = Math.abs(+it.sy || 0) * 0.5;
    var hz = Math.abs(+it.sz || 0) * 0.5;
    var x = +it.rx || 0, y = +it.ry || 0, z = +it.rz || 0;
    var a = Math.cos(x), b = Math.sin(x);
    var c = Math.cos(y), d = Math.sin(y);
    var e = Math.cos(z), f = Math.sin(z);
    var m0, m4, m8, m1, m5, m9, m2, m6, m10;

    if ((it.eo || "XYZ") === "YXZ") {
      var ce = c * e, cf = c * f, de = d * e, df = d * f;
      m0 = ce + df * b; m4 = de * b - cf; m8 = a * d;
      m1 = a * f;      m5 = a * e;       m9 = -b;
      m2 = cf * b - de; m6 = df + ce * b; m10 = a * c;
    } else {
      m0 = c * e;         m4 = -c * f;        m8 = d;
      m1 = a * f + b*d*e; m5 = a*e - b*d*f;  m9 = -b * c;
      m2 = b*f - a*d*e;   m6 = b*e + a*d*f;  m10 = a * c;
    }

    var ex = Math.abs(m0) * hx + Math.abs(m4) * hy + Math.abs(m8) * hz;
    var ey = Math.abs(m1) * hx + Math.abs(m5) * hy + Math.abs(m9) * hz;
    var ez = Math.abs(m2) * hx + Math.abs(m6) * hy + Math.abs(m10) * hz;
    var cx = +it.x || 0, cy = +it.y || 0, cz = +it.z || 0;
    var out = {
      minX: cx - ex, maxX: cx + ex,
      minY: cy - ey, maxY: cy + ey,
      minZ: cz - ez, maxZ: cz + ez
    };
    if (meta) {
      for (var k in meta) if (Object.prototype.hasOwnProperty.call(meta, k)) out[k] = meta[k];
    }
    if (out.anchor == null && it.anchor != null) out.anchor = !!it.anchor;
    return out;
  };

  function broadphase(input, opts) {
    opts = opts || {};
    var boxes = normaliseBoxes(input);
    var n = boxes.length;
    var cell = Math.max(0.05, +opts.cell || 3);
    var inv = 1 / cell;
    var eps = Math.max(0, +opts.eps || 0);
    var maxCells = Math.max(64, opts.maxCells == null ? 32768 : opts.maxCells | 0);
    var ranges = new Int32Array(n * 6);
    var minGX = 2147483647, minGY = 2147483647, minGZ = 2147483647;
    var maxGX = -2147483648, maxGY = -2147483648, maxGZ = -2147483648;
    var i;

    for (i = 0; i < n; i++) {
      var b = boxes[i], q = i * 6;
      var gx0 = Math.floor((b.minX - eps) * inv), gx1 = Math.floor((b.maxX + eps) * inv);
      var gy0 = Math.floor((b.minY - eps) * inv), gy1 = Math.floor((b.maxY + eps) * inv);
      var gz0 = Math.floor((b.minZ - eps) * inv), gz1 = Math.floor((b.maxZ + eps) * inv);
      ranges[q] = gx0; ranges[q + 1] = gx1;
      ranges[q + 2] = gy0; ranges[q + 3] = gy1;
      ranges[q + 4] = gz0; ranges[q + 5] = gz1;
      if (gx0 < minGX) minGX = gx0; if (gx1 > maxGX) maxGX = gx1;
      if (gy0 < minGY) minGY = gy0; if (gy1 > maxGY) maxGY = gy1;
      if (gz0 < minGZ) minGZ = gz0; if (gz1 > maxGZ) maxGZ = gz1;
    }

    var spanY = n ? maxGY - minGY + 1 : 1;
    var spanZ = n ? maxGZ - minGZ + 1 : 1;
    var plane = spanY * spanZ;
    var numericKeys = plane * (n ? maxGX - minGX + 1 : 1) < 9007199254740000;
    function key(gx, gy, gz) {
      return numericKeys
        ? (gx - minGX) * plane + (gy - minGY) * spanZ + (gz - minGZ)
        : gx + ":" + gy + ":" + gz;
    }

    var buckets = new Map();
    var large = new Uint8Array(n), largeCount = 0;
    // The large boxes as a LIST, not just a flag per box: visit() used to find
    // them by scanning every later index on every iteration — an n² pass over
    // the whole collider table hiding inside a build that is already 15 s.
    // (load-profile 2026-09-01: `visit` was the single hottest JS function of
    // the world build, 1.06 s self time.)
    var largeList = [];
    for (i = 0; i < n; i++) {
      var r = i * 6;
      var cells = (ranges[r + 1] - ranges[r] + 1) *
                  (ranges[r + 3] - ranges[r + 2] + 1) *
                  (ranges[r + 5] - ranges[r + 4] + 1);
      if (cells > maxCells) { large[i] = 1; largeCount++; largeList.push(i); continue; }
      for (var gx = ranges[r]; gx <= ranges[r + 1]; gx++) {
        for (var gy = ranges[r + 2]; gy <= ranges[r + 3]; gy++) {
          for (var gz = ranges[r + 4]; gz <= ranges[r + 5]; gz++) {
            var kk = key(gx, gy, gz), bucket = buckets.get(kk);
            if (!bucket) { bucket = []; buckets.set(kk, bucket); }
            bucket.push(i);
          }
        }
      }
    }

    function near(a0, b0) {
      return a0.maxX + eps >= b0.minX && b0.maxX + eps >= a0.minX &&
             a0.maxY + eps >= b0.minY && b0.maxY + eps >= a0.minY &&
             a0.maxZ + eps >= b0.minZ && b0.maxZ + eps >= a0.minZ;
    }

    function visit(fn) {
      var seen = new Int32Array(n), candidates = 0, hits = 0;
      var ii = 0, stamp = 0;
      // one closure for the whole pass (it used to be re-created per box)
      function offer(jj) {
        if (jj <= ii || seen[jj] === stamp) return;
        seen[jj] = stamp;
        candidates++;
        if (near(boxes[ii], boxes[jj])) {
          hits++;
          fn(ii, jj, boxes[ii], boxes[jj]);
        }
      }
      for (ii = 0; ii < n; ii++) {
        stamp = ii + 1;
        var rr = ii * 6;
        if (!large[ii]) {
          for (var xg = ranges[rr]; xg <= ranges[rr + 1]; xg++) {
            for (var yg = ranges[rr + 2]; yg <= ranges[rr + 3]; yg++) {
              for (var zg = ranges[rr + 4]; zg <= ranges[rr + 5]; zg++) {
                var arr = buckets.get(key(xg, yg, zg));
                if (!arr) continue;
                for (var bi = 0; bi < arr.length; bi++) offer(arr[bi]);
              }
            }
          }
          // large boxes touch everything: pair with each one exactly once
          for (var li = 0; li < largeList.length; li++) offer(largeList[li]);
        } else {
          for (var all = ii + 1; all < n; all++) offer(all);
        }
      }
      return { candidates: candidates, hits: hits };
    }

    return {
      boxes: boxes,
      visit: visit,
      bucketCount: buckets.size,
      largeCount: largeCount,
      cell: cell,
      eps: eps
    };
  }

  // Low-level reusable neighbour pass. Callers supply the narrow-phase work.
  R.broadphasePairs = function (boxes, opts, visit) {
    var t0 = now(), bp = broadphase(boxes, opts);
    var p = bp.visit(function (i, j, a, b) {
      if (visit) visit(a.source, b.source, a, b, i, j);
    });
    return {
      total: bp.boxes.length,
      candidatePairs: p.candidates,
      nearPairs: p.hits,
      buckets: bp.bucketCount,
      large: bp.largeCount,
      ms: +(now() - t0).toFixed(2)
    };
  };

  function markSurfaceAnchors(boxes, surfaces, anchored, opts) {
    surfaces = surfaces || [];
    if (!surfaces.length || !boxes.length) return 0;
    var cell = Math.max(0.1, +opts.surfaceCell || +opts.cell || 4);
    var inv = 1 / cell, eps = Math.max(0, +opts.surfaceEps || 0.2);
    var penetration = Math.max(0, opts.surfacePenetration == null
      ? eps : +opts.surfacePenetration);
    var valid = [], minGX = 2147483647, minGZ = 2147483647;
    var maxGX = -2147483648, maxGZ = -2147483648;
    var i;
    for (i = 0; i < surfaces.length; i++) {
      var s = surfaces[i];
      if (!s || !finite(+s.minX) || !finite(+s.maxX) ||
          !finite(+s.minZ) || !finite(+s.maxZ) || !finite(+s.top)) continue;
      var q = {
        minX: Math.min(+s.minX, +s.maxX), maxX: Math.max(+s.minX, +s.maxX),
        minZ: Math.min(+s.minZ, +s.maxZ), maxZ: Math.max(+s.minZ, +s.maxZ),
        top: +s.top
      };
      q.gx0 = Math.floor(q.minX * inv); q.gx1 = Math.floor(q.maxX * inv);
      q.gz0 = Math.floor(q.minZ * inv); q.gz1 = Math.floor(q.maxZ * inv);
      if (q.gx0 < minGX) minGX = q.gx0; if (q.gx1 > maxGX) maxGX = q.gx1;
      if (q.gz0 < minGZ) minGZ = q.gz0; if (q.gz1 > maxGZ) maxGZ = q.gz1;
      valid.push(q);
    }
    if (!valid.length) return 0;
    var spanZ = maxGZ - minGZ + 1;
    var numericKeys = spanZ * (maxGX - minGX + 1) < 9007199254740000;
    function key(gx, gz) {
      return numericKeys ? (gx - minGX) * spanZ + (gz - minGZ) : gx + ":" + gz;
    }
    var buckets = new Map();
    for (i = 0; i < valid.length; i++) {
      var sf = valid[i];
      for (var gx = sf.gx0; gx <= sf.gx1; gx++) {
        for (var gz = sf.gz0; gz <= sf.gz1; gz++) {
          var kk = key(gx, gz), a = buckets.get(kk);
          if (!a) { a = []; buckets.set(kk, a); }
          a.push(i);
        }
      }
    }
    var seen = new Int32Array(valid.length), found = 0;
    for (i = 0; i < boxes.length; i++) {
      if (anchored[i]) continue;
      var b = boxes[i], stamp = i + 1;
      var gx0 = Math.floor(b.minX * inv), gx1 = Math.floor(b.maxX * inv);
      var gz0 = Math.floor(b.minZ * inv), gz1 = Math.floor(b.maxZ * inv);
      var hit = false;
      for (var xg = gx0; xg <= gx1 && !hit; xg++) {
        for (var zg = gz0; zg <= gz1 && !hit; zg++) {
          var list = buckets.get(key(xg, zg));
          if (!list) continue;
          for (var si = 0; si < list.length; si++) {
            var sj = list[si];
            if (seen[sj] === stamp) continue;
            seen[sj] = stamp;
            var surface = valid[sj], dy = b.minY - surface.top;
            if (dy < -penetration || dy > eps) continue;
            if (b.maxX < surface.minX || surface.maxX < b.minX ||
                b.maxZ < surface.minZ || surface.maxZ < b.minZ) continue;
            anchored[i] = 1; found++; hit = true; break;
          }
        }
      }
    }
    return found;
  }

  // AABBs are the cheap broad phase. Rotated/slender parts can have touching
  // AABBs while the actual solids are separated, so assembly audits may pass
  // `touches(sourceA, sourceB, broadA, broadB, contactEps)`. Returning false
  // rejects that broad-phase pair before it becomes a support-graph edge.
  R.supportAudit = function (input, opts) {
    opts = opts || {};
    var t0 = now();
    var contactEps = opts.contactEps == null ? 0.075 : Math.max(0, +opts.contactEps);
    var bp = broadphase(input, {
      cell: opts.cell || 3,
      eps: contactEps,
      maxCells: opts.maxCells
    });
    var boxes = bp.boxes, n = boxes.length;
    var parent = new Int32Array(n), rank = new Uint8Array(n);
    var anchored = new Uint8Array(n), i;
    for (i = 0; i < n; i++) parent[i] = i;
    function find(x) {
      var r = x;
      while (parent[r] !== r) r = parent[r];
      while (parent[x] !== x) { var p = parent[x]; parent[x] = r; x = p; }
      return r;
    }
    function union(a, b) {
      var ra = find(a), rb = find(b);
      if (ra === rb) return;
      if (rank[ra] < rank[rb]) parent[ra] = rb;
      else {
        parent[rb] = ra;
        if (rank[ra] === rank[rb]) rank[ra]++;
      }
    }
    var contacts = 0;
    var pairs = bp.visit(function (a, b, boxA, boxB) {
      if (opts.touches &&
          opts.touches(boxA.source, boxB.source, boxA, boxB, contactEps) === false) return;
      contacts++;
      union(a, b);
    });

    var directAnchors = 0;
    var groundY = opts.groundY != null && finite(+opts.groundY) ? +opts.groundY : null;
    var groundEps = opts.groundEps == null ? 0.12 : Math.max(0, +opts.groundEps);
    for (i = 0; i < n; i++) {
      var box = boxes[i];
      if (box.anchor ||
          (groundY != null && box.minY <= groundY + groundEps &&
           box.maxY >= groundY - contactEps)) {
        anchored[i] = 1; directAnchors++;
      }
    }
    directAnchors += markSurfaceAnchors(boxes, opts.surfaces, anchored, opts);

    var rootAnchor = new Uint8Array(n), componentSize = new Int32Array(n);
    var componentSeen = new Uint8Array(n), components = 0;
    for (i = 0; i < n; i++) {
      var root = find(i);
      componentSize[root]++;
      if (anchored[i]) rootAnchor[root] = 1;
      if (!componentSeen[root]) { componentSeen[root] = 1; components++; }
    }
    var unsupportedCount = 0, unsupportedRoots = new Uint8Array(n);
    var unsupportedComponents = 0, byKind = {}, samples = [], sampleByKind = {};
    var componentSamples = [], componentSampleIndex = new Map();
    var sampleLimit = opts.sampleLimit == null ? 16 : Math.max(0, opts.sampleLimit | 0);
    var componentSampleLimit = opts.componentSampleLimit == null
      ? 24 : Math.max(0, opts.componentSampleLimit | 0);
    function describe(index, componentRoot) {
      return {
        id: boxes[index].id,
        kind: boxes[index].kind,
        componentSize: componentSize[componentRoot],
        bottom: +boxes[index].minY.toFixed(3),
        center: [
          +((boxes[index].minX + boxes[index].maxX) * 0.5).toFixed(2),
          +((boxes[index].minY + boxes[index].maxY) * 0.5).toFixed(2),
          +((boxes[index].minZ + boxes[index].maxZ) * 0.5).toFixed(2)
        ]
      };
    }
    for (i = 0; i < n; i++) {
      var rr = find(i);
      if (rootAnchor[rr]) continue;
      unsupportedCount++;
      if (!unsupportedRoots[rr]) { unsupportedRoots[rr] = 1; unsupportedComponents++; }
      var kind = boxes[i].kind;
      byKind[kind] = (byKind[kind] || 0) + 1;
      var desc = null;
      if (samples.length < sampleLimit || !sampleByKind[kind]) desc = describe(i, rr);
      if (samples.length < sampleLimit) samples.push(desc);
      if (!sampleByKind[kind]) sampleByKind[kind] = desc;
      var csi = componentSampleIndex.get(rr);
      if (csi == null && componentSamples.length < componentSampleLimit) {
        csi = componentSamples.length;
        componentSampleIndex.set(rr, csi);
        componentSamples.push({
          size: componentSize[rr],
          first: desc || describe(i, rr),
          kinds: {}
        });
      }
      if (csi != null) {
        var csk = componentSamples[csi].kinds;
        csk[kind] = (csk[kind] || 0) + 1;
      }
    }
    return {
      total: n,
      supportedCount: n - unsupportedCount,
      unsupportedCount: unsupportedCount,
      components: components,
      unsupportedComponents: unsupportedComponents,
      directAnchors: directAnchors,
      contacts: contacts,
      nearPairs: pairs.hits,
      candidatePairs: pairs.candidates,
      buckets: bp.bucketCount,
      large: bp.largeCount,
      unsupportedByKind: byKind,
      samples: samples,
      sampleByKind: sampleByKind,
      componentSamples: componentSamples,
      contactEps: contactEps,
      ms: +(now() - t0).toFixed(2)
    };
  };

  // Deliberate structural joints often overlap, so this is a narrow primitive:
  // consumers provide ignore(a,b) for authored joints and receive only real
  // positive-volume penetrations, never mere face contact.
  R.overlapAudit = function (input, opts) {
    opts = opts || {};
    var t0 = now(), minDepth = opts.minDepth == null ? 0.01 : Math.max(0, +opts.minDepth);
    var bp = broadphase(input, { cell: opts.cell || 3, eps: 0, maxCells: opts.maxCells });
    var count = 0, volume = 0, byPair = {}, samples = [];
    var sampleLimit = opts.sampleLimit == null ? 16 : Math.max(0, opts.sampleLimit | 0);
    var pairs = bp.visit(function (i, j, a, b) {
      if (opts.ignore && opts.ignore(a.source, b.source, a, b)) return;
      var dx = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
      var dy = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
      var dz = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
      if (dx <= minDepth || dy <= minDepth || dz <= minDepth) return;
      count++; volume += dx * dy * dz;
      var ka = a.kind, kb = b.kind, key = ka < kb ? ka + "|" + kb : kb + "|" + ka;
      byPair[key] = (byPair[key] || 0) + 1;
      if (samples.length < sampleLimit) {
        samples.push({
          a: a.id, b: b.id, kinds: [ka, kb],
          depth: [+dx.toFixed(3), +dy.toFixed(3), +dz.toFixed(3)]
        });
      }
    });
    return {
      total: bp.boxes.length,
      overlapCount: count,
      overlapVolume: +volume.toFixed(3),
      candidatePairs: pairs.candidates,
      buckets: bp.bucketCount,
      large: bp.largeCount,
      byPair: byPair,
      samples: samples,
      ms: +(now() - t0).toFixed(2)
    };
  };
})();
