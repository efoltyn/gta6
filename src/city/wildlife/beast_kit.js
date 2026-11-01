/* ============================================================
   city/wildlife/beast_kit.js — CBZ.beastKit: THE BESTIARY'S BODIES.

   Every land animal the open world spawns (wildlife.js), the beast pit
   (arena_fights.js), the pelt hood (pelts.js) and the cavalry bake
   (warlord/mounts.js) is the posed group a species row's build(ctx) returns.
   They used to be thirty coloured boxes each. This kit draws them as REAL
   bodies: lofted shells (CBZ.loftKit, the same rings-along-a-line maths the
   battle's skinned animals use) with the coat baked into vertex colours, a
   procedural pattern texture for the animals that are their pattern (tiger,
   cheetah, leopard, snow leopard, zebra, giraffe, Holstein), eyes, real ears,
   hooves, pads, horns, antlers, tusks, a trunk.

   THE CONTRACT IT KEEPS (city/wildlife_rig.js, systems/predator_anim.js,
   systems/quadruped_ragdoll.js, city/pelts.js and the warlord bake all
   DISCOVER the body from its children, so the shape of the group is law):
     * metres, FEET AT y = 0, NOSE TOWARD +X, a flat group of plain Meshes.
     * every mesh's .position is its geometry's bounding-box CENTRE (the rig
       reads bottom = position.y - height / 2, exactly as it did for boxes).
     * one mesh per LEG, taller than wide, planted on the ground: a column.
     * the head (plus the neck on grazers, plus the lower jaw on predators)
       is far forward and up off the ground: the head cluster. The lower jaw
       sits low and forward in it, which is what predator_anim's maw opens.
     * the torso is the longest mesh (the saddle finder's pick), and the
       group carries userData.saddle {x, y, width} for wildlife_tame.js.
     * the neck mesh carries userData.pivot [x, y] (its root in the
       shoulders) so the graze rotates the head down instead of sliding it,
       and the head mesh carries userData.eyes (mesh-local) for the glow.
   Geometry is cached per species variant and shared (geo._shared, never
   disposed by unfillBody); the materials are TWO shared Lambert materials
   plus one per coat pattern. An animal is 7 to 10 draw calls, down from
   20 to 30 boxes.

   AUTHORING: real adult dimensions in metres. The kit divides by the row's
   `scale` (the engine multiplies it back in), so the rendered animal stands
   at its real height while the row keeps its gameplay class.

   API
     CBZ.beastKit.build(id, P, ctx)   P = a body description (see quad()),
                                      returns the posed THREE.Group
     CBZ.beastKit.quad(o)             family generator -> a body description
     CBZ.beastKit.mix / shade         colour helpers for species paint hooks
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const TAU = Math.PI * 2;
  const W1 = [0, 1];

  // ---------------------------------------------------------------- colour
  function rgb(h) { return [(h >> 16) & 255, (h >> 8) & 255, h & 255]; }
  function mix(a, b, t) {
    if (t <= 0) return a; if (t >= 1) return b;
    const A = rgb(a), B = rgb(b);
    return (Math.round(A[0] + (B[0] - A[0]) * t) << 16) | (Math.round(A[1] + (B[1] - A[1]) * t) << 8) | Math.round(A[2] + (B[2] - A[2]) * t);
  }
  function shade(a, k) {
    const A = rgb(a);
    return (Math.min(255, Math.round(A[0] * k)) << 16) | (Math.min(255, Math.round(A[1] * k)) << 8) | Math.min(255, Math.round(A[2] * k));
  }
  function K_grain(x, y, z) { return grain(x, y, z) * (0.92 + 0.16 * Math.abs(Math.sin(z * 40 + x * 13))); }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function smooth(a, b, v) { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); }
  // fur grain: a cheap position hash, +-5 % brightness, so a coat is not plastic
  function grain(x, y, z) {
    const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
    return 0.95 + 0.1 * (s - Math.floor(s));
  }

  // ---------------------------------------------------------------- maths
  // Catmull-Rom through key rows (column 0 is the parameter, monotonic)
  function sampleKeys(keys, n) {
    const out = [];
    const x0 = keys[0][0], x1 = keys[keys.length - 1][0];
    for (let i = 0; i < n; i++) {
      const x = x0 + (x1 - x0) * i / (n - 1);
      let k = 0;
      while (k < keys.length - 2 && keys[k + 1][0] < x) k++;
      const p1 = keys[k], p2 = keys[k + 1], p0 = keys[Math.max(0, k - 1)], p3 = keys[Math.min(keys.length - 1, k + 2)];
      const t = (x - p1[0]) / ((p2[0] - p1[0]) || 1);
      const row = [x];
      for (let c = 1; c < p1.length; c++) {
        const a = p0[c], b = p1[c], cc = p2[c], d = p3[c];
        const t2 = t * t, t3 = t2 * t;
        let v = 0.5 * ((2 * b) + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
        // never overshoot below zero (radii)
        row.push(Math.max(Math.min(b, cc) * 0.5, v));
      }
      out.push(row);
    }
    return out;
  }
  // resample a polyline chain [[x,y,z?,r...]] to n points by arc length
  function chain(pts, n) {
    const L = [0];
    for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], (pts[i][2] || 0) - (pts[i - 1][2] || 0)));
    const tot = L[L.length - 1] || 1, out = [];
    for (let i = 0; i < n; i++) {
      const s = tot * i / (n - 1);
      let k = 0; while (k < pts.length - 2 && L[k + 1] < s) k++;
      const t = (s - L[k]) / ((L[k + 1] - L[k]) || 1), a = pts[k], b = pts[k + 1], row = [];
      for (let c = 0; c < Math.max(a.length, b.length); c++) row.push((a[c] || 0) + ((b[c] || 0) - (a[c] || 0)) * t);
      row.push(s / tot);
      out.push(row);
    }
    return out;
  }

  // ---------------------------------------------------------------- a part
  // One Part = one mesh: a loftKit shell with a colour function, an optional
  // pattern uv. `plain` lofts (eyes, nose, hooves, horns) sample the white
  // half of the pattern texture so a tiger's eyes are not striped.
  function Part(name, uv) {
    this.name = name; this.G = CBZ.loftKit.geo(); this.G.uvOn = !!uv; this.uv = !!uv;
    this.ud = {};
  }
  // The renderer writes sRGB (outputEncoding) and r128 takes vertex colours
  // as LINEAR, so a hex authored as the colour you SEE has to be linearised
  // or every coat comes out bleached (the old box tiger read butter-yellow).
  const LIN = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function toLinearHex(h) {
    return (Math.round(LIN[(h >> 16) & 255] * 255) << 16) | (Math.round(LIN[(h >> 8) & 255] * 255) << 8) | Math.round(LIN[h & 255] * 255);
  }
  Part.prototype.loft = function (st, segs, colour, opts, plain) {
    const G = this.G, i0 = G.uv.length;
    CBZ.loftKit.loft(G, st, segs, function (x, y, z, ca, sa, R, t) { return toLinearHex(colour(x, y, z, ca, sa, R, t)); }, opts);
    if (this.uv) {
      for (let i = i0; i < G.uv.length; i += 2) {
        // flipY: the canvas's TOP half (the pattern) is v 0.5..1
        if (plain) { G.uv[i] = 0.5; G.uv[i + 1] = 0.22; }
        else G.uv[i + 1] = 0.5 + G.uv[i + 1] * 0.5;
      }
    }
  };
  Part.prototype.ellipsoid = function (cx, cy, cz, rx, ry, rz, segs, colour, plain, rings) {
    const st = [], n = rings || 4;
    for (let i = 0; i < n; i++) {
      const t = -0.86 + 1.72 * i / (n - 1), k = Math.sqrt(1 - t * t);
      st.push({ x: cx + t * rx, y: cy, z: cz, rt: ry * k, rb: ry * k, w: rz * k, wts: W1 });
    }
    this.loft(st, segs, typeof colour === "function" ? colour : function () { return colour; }, { capLen: 0.55, capN: segs <= 6 ? 1 : 2 }, plain !== false);
  };
  // a tapered tube through 3-D points [[x,y,z,r],...] (horns, antler tines,
  // tusks, toes); r may be a [rt, rb, w] triple
  Part.prototype.tube = function (pts, n, segs, colour, plain, opts) {
    const c = chain(pts, n), st = [];
    for (let i = 0; i < c.length; i++) {
      const r = c[i][3];
      st.push({ x: c[i][0], y: c[i][1], z: c[i][2], rt: r, rb: r, w: r * ((opts && opts.flat) || 1), wts: W1, t: c[i][c[i].length - 1] });
    }
    this.loft(st, segs, typeof colour === "function" ? colour : function () { return colour; },
      Object.assign({ capLen: 0.8, capA: false, capN: 1, side: (opts && opts.side) || pickSide(pts) }, opts || {}), plain !== false);
  };
  function pickSide(pts) {
    const a = pts[0], b = pts[pts.length - 1];
    const d = [b[0] - a[0], b[1] - a[1], (b[2] || 0) - (a[2] || 0)];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    return Math.abs(d[2] / l) > 0.8 ? [1, 0, 0] : [0, 0, 1];
  }

  // ---------------------------------------------------------------- textures
  // Coat patterns, painted once per pattern on a 256 x 512 canvas. The top
  // half (v 0..0.5) is the tiling pattern (it wraps round every body ring and
  // repeats along it); the bottom half is plain white for the parts that
  // must not wear it. The texture MULTIPLIES the vertex colour: dark marks
  // on white.
  const PATTERNS = {};
  function lcg(seed) { let s = seed >>> 0 || 1; return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
  function blob(g, cx, cy, rx, ry, rot, W, H) {
    // draw wrapped (the tile repeats both ways inside the pattern half)
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
      g.save(); g.translate(cx + ox * W, cy + oy * H); g.rotate(rot || 0); g.scale(rx, ry);
      g.beginPath(); g.arc(0, 0, 1, 0, TAU); g.restore(); g.fill();
    }
  }
  const PAINT = {
    // tiger: paired, forked dark stripes running round the body
    tiger: function (g, W, H, r) {
      g.fillStyle = "#141010";
      const n = 9;
      for (let i = 0; i < n; i++) {
        const x0 = (i + 0.2 + r() * 0.5) * W / n, wv = 3 + r() * 4;
        g.beginPath();
        // a stripe tapers to a point toward the belly (v = 0 and v = H)
        const L = H * (0.3 + r() * 0.17);
        g.moveTo(x0, H / 2 - L);
        for (let k = 0; k <= 12; k++) { const t = k / 12; g.lineTo(x0 + Math.sin(t * 6 + i) * 5 + wv * Math.sin(t * Math.PI), H / 2 - L + 2 * L * t); }
        for (let k = 12; k >= 0; k--) { const t = k / 12; g.lineTo(x0 + Math.sin(t * 6 + i) * 5 - wv * Math.sin(t * Math.PI), H / 2 - L + 2 * L * t); }
        g.fill();
        if (r() < 0.6) {           // the fork
          const y = H / 2 + (r() - 0.5) * H * 0.4, s = r() < 0.5 ? -1 : 1;
          g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + s * 14, y + 26); g.lineTo(x0 + s * 10, y + 30); g.lineTo(x0 - s * 2, y + 6); g.fill();
        }
      }
    },
    // cheetah: solid round black spots, dense and even
    cheetah: function (g, W, H, r) {
      g.fillStyle = "#17110c";
      for (let i = 0; i < 70; i++) { const s = 4 + r() * 3; blob(g, r() * W, r() * H, s, s * (0.85 + r() * 0.3), 0, W, H); }
    },
    // leopard / snow leopard rosettes: a broken ring round a darker centre
    rosette: function (g, W, H, r, ink, core) {
      for (let i = 0; i < 26; i++) {
        const cx = r() * W, cy = r() * H, R = 9 + r() * 6;
        if (core) { g.fillStyle = core; blob(g, cx, cy, R * 0.75, R * 0.65, r(), W, H); }
        g.fillStyle = ink;
        const k = 4 + Math.floor(r() * 3);
        for (let j = 0; j < k; j++) {
          const a = j / k * TAU + r() * 0.5;
          blob(g, cx + Math.cos(a) * R, cy + Math.sin(a) * R * 0.85, 3.2 + r() * 2.2, 2.4 + r() * 1.6, a, W, H);
        }
      }
      g.fillStyle = ink;
      for (let i = 0; i < 30; i++) blob(g, r() * W, r() * H, 2 + r() * 1.6, 2 + r() * 1.6, 0, W, H);
    },
    leopard: function (g, W, H, r) { PAINT.rosette(g, W, H, r, "#1b130c", "#c49a5c"); },
    snow_leopard: function (g, W, H, r) { PAINT.rosette(g, W, H, r, "#3b3a3c", "#c9c7c4"); },
    // zebra: bold black stripes, even ground, round the body to the belly
    zebra: function (g, W, H, r) {
      g.fillStyle = "#121212";
      const n = 12;
      for (let i = 0; i < n; i++) {
        const x0 = (i + 0.5) * W / n, wv = 6 + r() * 3;
        g.beginPath();
        g.moveTo(x0 - wv, 0);
        for (let k = 0; k <= 16; k++) { const t = k / 16; g.lineTo(x0 + Math.sin(t * TAU + i * 0.7) * 4 - wv * (0.7 + 0.3 * Math.sin(t * Math.PI)), H * t); }
        for (let k = 16; k >= 0; k--) { const t = k / 16; g.lineTo(x0 + Math.sin(t * TAU + i * 0.7) * 4 + wv * (0.7 + 0.3 * Math.sin(t * Math.PI)), H * t); }
        g.fill();
      }
    },
    // giraffe: big chestnut polygons with a cream net between them
    giraffe: function (g, W, H, r) {
      g.fillStyle = "#f4ead8"; g.fillRect(0, 0, W, H);
      g.fillStyle = "#8a4b22";
      const cells = 5;
      for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) {
        const cx = (i + 0.5 + (r() - 0.5) * 0.3) * W / cells, cy = (j + 0.5 + (r() - 0.5) * 0.3) * H / cells;
        const R = W / cells * 0.42;
        for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
          g.beginPath();
          const k = 6 + Math.floor(r() * 2);
          for (let s = 0; s < k; s++) {
            const a = s / k * TAU + i, rr = R * (0.82 + r() * 0.24);
            const px = cx + ox * W + Math.cos(a) * rr, py = cy + oy * H + Math.sin(a) * rr;
            if (s) g.lineTo(px, py); else g.moveTo(px, py);
          }
          g.closePath(); g.fill();
        }
      }
    },
    // Holstein: big hard-edged black patches on white
    holstein: function (g, W, H, r) {
      g.fillStyle = "#151313";
      for (let i = 0; i < 6; i++) {
        const cx = r() * W, cy = r() * H;
        for (let k = 0; k < 7; k++) blob(g, cx + (r() - 0.5) * 50, cy + (r() - 0.5) * 50, 16 + r() * 18, 14 + r() * 16, r() * 3, W, H);
      }
    },
  };
  function patternMat(name) {
    if (PATTERNS[name]) return PATTERNS[name];
    let tex = null;
    try {
      const cv = document.createElement("canvas");
      cv.width = 256; cv.height = 512;
      const g = cv.getContext("2d");
      g.fillStyle = "#ffffff"; g.fillRect(0, 0, 256, 512);
      g.save(); g.beginPath(); g.rect(0, 0, 256, 256); g.clip();
      PAINT[name](g, 256, 256, lcg(name.length * 7919 + 13));
      g.restore();
      tex = new THREE.CanvasTexture(cv);
      tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.anisotropy = 2;
    } catch (e) { tex = null; }
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, map: tex });
    m._shared = true; m.name = "beast-coat:" + name;
    PATTERNS[name] = m;
    return m;
  }
  let plainMat = null;
  function coatMat() {
    if (!plainMat) { plainMat = new THREE.MeshLambertMaterial({ vertexColors: true }); plainMat._shared = true; plainMat.name = "beast-coat"; }
    return plainMat;
  }

  // ---------------------------------------------------------------- builder
  // P (a body description, built by quad() or by hand):
  //   pattern, uScale       coat texture + tiles per metre
  //   parts: { name: Part } with ud (userData) on each
  //   saddle {x,y,width}
  // build() centres every part, scales by 1/row.scale, caches per key.
  const CACHE = new Map();
  function finish(P, k) {
    const out = [];
    const order = P.order || Object.keys(P.parts);
    for (let n = 0; n < order.length; n++) {
      const part = P.parts[order[n]]; if (!part || !part.G.n) continue;
      const G = part.G, p = G.p;
      let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
      for (let i = 0; i < p.length; i += 3) {
        p[i] *= k; p[i + 1] *= k; p[i + 2] *= k;
        if (p[i] < x0) x0 = p[i]; if (p[i] > x1) x1 = p[i];
        if (p[i + 1] < y0) y0 = p[i + 1]; if (p[i + 1] > y1) y1 = p[i + 1];
        if (p[i + 2] < z0) z0 = p[i + 2]; if (p[i + 2] > z1) z1 = p[i + 2];
      }
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
      for (let i = 0; i < p.length; i += 3) { p[i] -= cx; p[i + 1] -= cy; p[i + 2] -= cz; }
      const geo = CBZ.loftKit.toGeometry(G, { static: true });
      geo.computeBoundingBox(); geo.computeBoundingSphere();
      geo._shared = true; geo.userData = { _shared: true };
      const ud = Object.assign({}, part.ud);
      if (ud.pivot) ud.pivot = [ud.pivot[0] * k, ud.pivot[1] * k];
      if (ud.eyes) ud.eyes = ud.eyes.map(function (e) { return [e[0] * k - cx, e[1] * k - cy, e[2] * k - cz, e[3] * k]; });
      out.push({ name: part.name, geo: geo, pos: [cx, cy, cz], ud: ud, uv: part.uv });
    }
    const sad = P.saddle ? { x: P.saddle.x * k, y: P.saddle.y * k, width: P.saddle.width * k } : null;
    return { parts: out, saddle: sad, pattern: P.pattern || null };
  }
  function build(id, key, make, ctx) {
    const sp = CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES[id];
    const sc = (sp && sp.scale) || 1;
    const ck = id + "|" + key;
    let B = CACHE.get(ck);
    if (!B) { B = finish(make(), 1 / sc); CACHE.set(ck, B); }
    const g = new THREE.Group();
    g.name = "beast:" + id;
    const pm = B.pattern ? patternMat(B.pattern) : null, cm = coatMat();
    for (let i = 0; i < B.parts.length; i++) {
      const q = B.parts[i];
      const m = new THREE.Mesh(q.geo, q.uv && pm ? pm : cm);
      m.name = id + ":" + q.name;
      m.position.set(q.pos[0], q.pos[1], q.pos[2]);
      for (const u in q.ud) m.userData[u] = q.ud[u];
      g.add(m);
    }
    if (B.saddle) g.userData.saddle = B.saddle;
    return g;
  }

  // ================================================================ QUAD
  // The family generator. Every number is real metres / degrees. Missing
  // fields default from the family. Returns P for build().
  //
  //   fam      "hoof" (ungulates) | "cat" | "dog" | "bear" | "pig" | "hare"
  //   L        body length, point of shoulder to point of buttock
  //   WH, HH   withers height, hip (croup) height
  //   chest    chest depth (withers top to brisket)
  //   belly    ground to belly line at the waist
  //   W        half-width of the barrel
  //   hump     extra height over the withers (bison, grizzly)
  //   neck     { len, ang (deg above horizontal), r0 (root radius), r1 }
  //   head     { len, D (depth), Wd (half-width), ang (deg below horizontal),
  //              prof: [[t, rt, rb, w], ...] fractions along the head }
  //   leg      { f: front radius at the forearm, c: cannon radius, h: hind thigh }
  //   tail     { len, r, droop (deg), tuft }
  //   ear      { len, w, kind, up (deg), out (deg), back (deg) }
  //   eye      { r, t, up, side } on the head frame
  //   coat     { back, body, belly, leg, sock, sockH, hoof, face, muzzle,
  //              nose, earIn, eye, tail, tailTip, mane }
  //   paint    optional (part, x, y, z, ca, sa, t, c) -> hex override
  //   extra    optional (K) -> adds horns/antlers/mane via K.head / K.torso
  //   grazer   true: the neck is its own mesh in the head cluster (graze pivot)
  //   jaw      true: a separate lower jaw (predators: the maw opens)
  // ================================================================
  const FAM = {
    hoof: { prof: [[-0.04, 0.36, 0.42, 0.42], [0.12, 0.5, 0.5, 0.5], [0.32, 0.46, 0.5, 0.44], [0.55, 0.34, 0.42, 0.34], [0.8, 0.3, 0.36, 0.3], [0.96, 0.3, 0.33, 0.31], [1.0, 0.22, 0.24, 0.24]] },
    cat: { prof: [[-0.05, 0.4, 0.4, 0.42], [0.15, 0.5, 0.5, 0.5], [0.42, 0.46, 0.5, 0.5], [0.62, 0.34, 0.44, 0.42], [0.82, 0.3, 0.36, 0.34], [0.96, 0.27, 0.3, 0.28], [1.0, 0.18, 0.2, 0.2]] },
    dog: { prof: [[-0.05, 0.4, 0.38, 0.4], [0.15, 0.5, 0.46, 0.5], [0.38, 0.46, 0.44, 0.46], [0.5, 0.32, 0.38, 0.3], [0.78, 0.22, 0.3, 0.2], [0.97, 0.2, 0.24, 0.18], [1.0, 0.14, 0.16, 0.13]] },
    bear: { prof: [[-0.05, 0.42, 0.42, 0.44], [0.15, 0.52, 0.5, 0.54], [0.42, 0.46, 0.48, 0.5], [0.56, 0.34, 0.4, 0.34], [0.8, 0.27, 0.32, 0.25], [0.97, 0.25, 0.28, 0.23], [1.0, 0.17, 0.2, 0.17]] },
    pig: { prof: [[-0.05, 0.42, 0.44, 0.44], [0.2, 0.5, 0.52, 0.5], [0.5, 0.4, 0.44, 0.38], [0.8, 0.3, 0.32, 0.28], [0.97, 0.3, 0.3, 0.3], [1.0, 0.29, 0.29, 0.29]] },
    hare: { prof: [[-0.05, 0.4, 0.4, 0.42], [0.2, 0.5, 0.5, 0.5], [0.5, 0.44, 0.46, 0.42], [0.8, 0.32, 0.36, 0.3], [0.97, 0.24, 0.26, 0.22], [1.0, 0.16, 0.18, 0.16]] },
  };

  function quad(o) {
    const fam = o.fam || "hoof", F = FAM[fam];
    const L = o.L, WH = o.WH, HH = o.HH || WH * 0.98;
    const chest = o.chest || WH * 0.45, belly = o.belly != null ? o.belly : WH - chest;
    const BW = o.W || L * 0.16, hump = o.hump || 0, sag = o.sag != null ? o.sag : WH * 0.02;
    const C = Object.assign({ back: 0x806040, body: 0x8a6a48, belly: 0xd0b890, leg: null, sock: null, sockH: 0, hoof: 0x2a2520, face: null, muzzle: null, nose: 0x1d1a18, earIn: 0xc9a58a, eye: 0x1a120c, tail: null, tailTip: null, mane: null, pad: 0x242020, claw: 0x2c2620 }, o.coat || {});
    if (C.leg == null) C.leg = C.body;
    if (C.face == null) C.face = C.body;
    if (C.muzzle == null) C.muzzle = C.face;
    if (C.tail == null) C.tail = C.body;
    if (C.tailTip == null) C.tailTip = C.tail;
    const pat = o.pattern || null, UV = !!pat;
    const paint = o.paint || null;
    const P = { parts: {}, pattern: pat, order: ["torso", "neck", "head", "jaw", "legFL", "legFR", "legHL", "legHR", "tail"] };
    const torso = P.parts.torso = new Part("body", UV);
    const xr = -L / 2, xf = L / 2;
    const bellyY = belly, brisket = WH - chest;
    const rumpD = o.rumpD || (HH - bellyY) * 0.95;
    const tk = o.tuck != null ? o.tuck : 0.05 * WH;    // flank tuck-up toward the stifle
    // torso keys: [x, top, bottom, halfWidth]
    const keys = o.torsoKeys || [
      [xr - 0.02 * L, HH - rumpD * 0.42, HH - rumpD * 0.8, BW * 0.5],
      [xr + 0.05 * L, HH - 0.03 * WH, HH - rumpD, BW * 0.8],
      [xr + 0.2 * L, HH + 0.005 * WH, bellyY + tk, BW * 0.92],
      [-0.05 * L, (HH + WH) / 2 - sag + hump * 0.25, bellyY, BW * (o.barrel || 1)],
      [0.2 * L, WH + hump * 0.9 - 0.01 * WH, brisket + 0.15 * chest * 0, BW * 0.95],
      [0.34 * L, WH + hump - 0.03 * WH, brisket, BW * 0.82],
      [xf, WH - chest * (o.chestFront || 0.3), brisket + chest * 0.12, BW * 0.6],
      [xf + 0.04 * L, WH - chest * 0.5, brisket + chest * 0.3, BW * 0.38],
    ];
    const rows = sampleKeys(keys, o.torsoRings || 13);
    const st = rows.map(function (r) { const y = (r[1] + r[2]) / 2, h = (r[1] - r[2]) / 2; return { x: r[0], y: y, rt: h, rb: h, w: r[3], sq: o.sq || 0.92, wts: W1 }; });
    const uS = o.uScale || 1.6;
    function bodyCol(x, y, z, ca, sa, R, t, part) {
      let c = C.body;
      if (ca > 0.25) c = mix(c, C.back, smooth(0.25, 0.95, ca));
      if (ca < -0.15) c = mix(c, C.belly, smooth(-0.15, -0.75, ca));
      if (paint) c = paint(part, x, y, z, ca, sa, t, c);
      return shade(c, grain(x, y, z));
    }
    torso.loft(st, o.torsoSegs || 16, function (x, y, z, ca, sa, R, t) { return bodyCol(x, y, z, ca, sa, R, t, "torso"); }, { capLen: 0.7, uScale: uS });
    const sx = o.saddleX != null ? o.saddleX : 0.1 * L;
    let sTop = WH;
    for (let i = 0, best = 1e9; i < rows.length; i++) { const d = Math.abs(rows[i][0] - sx); if (d < best) { best = d; sTop = rows[i][1]; } }
    P.saddle = { x: sx, y: o.saddleY || sTop, width: BW * 2 };

    // ---- neck: root inside the shoulders, up to the poll
    const N = Object.assign({ len: 0.5 * L, ang: 40, r0: chest * 0.42, r1: chest * 0.24, w0: null, w1: null }, o.neck || {});
    const na = N.ang * Math.PI / 180;
    const nx0 = xf - 0.12 * L, ny0 = WH - chest * 0.38 + hump * 0.4;
    const nx1 = nx0 + Math.cos(na) * N.len, ny1 = ny0 + Math.sin(na) * N.len;
    const neckPart = o.grazer ? (P.parts.neck = new Part("neck", UV)) : torso;
    const nst = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6, bend = Math.sin(t * Math.PI) * (N.arch || 0.04) * N.len;
      const r = N.r0 + (N.r1 - N.r0) * Math.pow(t, 0.8);
      const w = (N.w0 || N.r0 * 0.8) + ((N.w1 || N.r1 * 0.85) - (N.w0 || N.r0 * 0.8)) * t;
      nst.push({ x: nx0 + (nx1 - nx0) * t - Math.sin(na) * bend, y: ny0 + (ny1 - ny0) * t + Math.cos(na) * bend, rt: r * (N.crest || 0.9), rb: r * (N.dewlap || 1.1), w: w, wts: W1 });
    }
    neckPart.loft(nst, 12, function (x, y, z, ca, sa, R, t) {
      let c = mix(C.body, C.face, t * 0.6);
      if (ca > 0.4 && C.mane) c = mix(c, C.mane, smooth(0.4, 0.8, ca));
      if (ca < -0.3) c = mix(c, C.belly, smooth(-0.3, -0.85, ca) * (o.throatPale != null ? o.throatPale : 0.8));
      if (paint) c = paint("neck", x, y, z, ca, sa, t, c);
      return shade(c, grain(x, y, z));
    }, { capA: false, capN: 2, uScale: uS });
    if (o.grazer) P.parts.neck.ud.pivot = [nx0, ny0];

    // ---- head: along its own axis from the poll, angled nose-down
    const H = Object.assign({ len: 0.3 * L, D: chest * 0.55, Wd: chest * 0.3, ang: 45 }, o.head || {});
    const ha = H.ang * Math.PI / 180;
    const ax = [Math.cos(ha), -Math.sin(ha)], up = [Math.sin(ha), Math.cos(ha)];
    const hx0 = nx1 + (H.dx || 0), hy0 = ny1 + (H.dy || 0);
    function hp(t, u, s) { return [hx0 + ax[0] * t * H.len + up[0] * u, hy0 + ax[1] * t * H.len + up[1] * u, s]; }
    const head = P.parts.head = new Part("head", UV);
    const prof = H.prof || F.prof;
    const hrows = sampleKeys(prof, 10);
    const hst = hrows.map(function (r) { const q = hp(r[0], (r[1] - r[2]) * H.D * 0.5 * 0, 0); return { x: q[0], y: q[1], z: 0, rt: r[1] * H.D, rb: r[2] * H.D, w: r[3] * H.Wd * 2, sq: H.sq || 0.95, wts: W1, t: r[0] }; });
    const mz = H.muzzleAt != null ? H.muzzleAt : 0.62;
    head.loft(hst, 14, function (x, y, z, ca, sa, R, t) {
      const tt = R.t != null ? R.t : t;
      let c = C.face;
      if (tt > mz) c = mix(c, C.muzzle, smooth(mz, mz + 0.15, tt));
      if (ca < -0.35 && C.chin) c = mix(c, C.chin, smooth(-0.35, -0.8, ca));
      if (tt > 0.97 && ca > -0.3) c = mix(c, C.nose, smooth(0.97, 1.0, tt));
      if (paint) c = paint("head", x, y, z, ca, sa, tt, c);
      return shade(c, grain(x, y, z));
    }, { capLen: 0.6, uScale: uS * 1.4 });
    // nose leather / nostrils
    const tipR = prof[prof.length - 2];
    const nq = hp(1.0, H.D * tipR[1] * (H.noseUp != null ? H.noseUp : 0.25), 0);
    if (H.nosePad !== false) head.ellipsoid(nq[0] - ax[0] * 0.01, nq[1], 0, H.len * 0.035, H.D * tipR[1] * 0.45, H.Wd * 2 * tipR[3] * 0.85, 10, C.nose);
    // eyes
    const E = Object.assign({ r: H.D * 0.11, t: 0.3, up: 0.28, side: 0.92 }, o.eye || {});
    head.ud.eyes = [];
    [-1, 1].forEach(function (s) {
      const pr = sampleKeys(prof, 30).reduce(function (b, r) { return Math.abs(r[0] - E.t) < Math.abs(b[0] - E.t) ? r : b; });
      const q = hp(E.t, H.D * pr[1] * E.up, s * H.Wd * 2 * pr[3] * E.side);
      // the eye: a dark glossy ball set in a lid ring of the face colour,
      // and one catch-light so it reads as wet at a distance
      head.ellipsoid(q[0] + ax[0] * E.r * 0.1, q[1], q[2] + s * E.r * 0.2, E.r * 1.2, E.r * 0.9, E.r * 0.8, 7, function (x, y, z, ca, sa) {
        return (s * sa) > 0.55 ? C.eye : (E.lid || shade(C.face, 0.6));
      });
      if (E.shine !== false) head.ellipsoid(q[0] + ax[0] * E.r * 0.45, q[1] + E.r * 0.32, q[2] + s * E.r * 0.72, E.r * 0.22, E.r * 0.22, E.r * 0.16, 4, 0xf4f0e8, true, 3);
      head.ud.eyes.push([q[0] + ax[0] * E.r * 0.3, q[1], q[2] + s * E.r * 0.7, E.r]);
    });
    // ears
    const EA = o.ear;
    if (EA) {
      [-1, 1].forEach(function (s) {
        const pr = prof[1];
        const base = hp(EA.t != null ? EA.t : 0.05, H.D * pr[1] * (EA.u != null ? EA.u : 0.85), s * H.Wd * (EA.s != null ? EA.s : 0.75));
        const upA = (EA.up != null ? EA.up : 60) * Math.PI / 180, outA = (EA.out != null ? EA.out : 30) * Math.PI / 180, bk = (EA.back != null ? EA.back : 10) * Math.PI / 180;
        // direction: start pointing up, lean out sideways and back
        const d = [-Math.sin(bk) * Math.cos(upA) - 0.0, Math.sin(upA), s * Math.cos(upA)];
        const dl = Math.hypot(d[0], d[1], d[2]); d[0] /= dl; d[1] /= dl; d[2] /= dl;
        const k = EA.kind || "point", n = 6, est = [];
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          let wv;
          if (k === "round") wv = Math.sqrt(Math.max(0, 1 - Math.pow(2 * t - 1, 2))) * 0.6 + (1 - t) * 0.4;
          else if (k === "long") wv = Math.sin(Math.min(1, t * 1.15 + 0.15) * Math.PI) * 0.9 + 0.1 * (1 - t);
          else if (k === "floppy") wv = 0.6 + 0.4 * Math.sin(t * Math.PI);
          else wv = (1 - t) * 0.9 + Math.sin(t * Math.PI) * 0.25;
          wv = Math.max(0.04, wv);
          const droop = k === "floppy" ? t * t * EA.len * 0.7 : 0;
          est.push({ x: base[0] + d[0] * EA.len * t - Math.sin(bk) * droop * 0.3, y: base[1] + d[1] * EA.len * t - droop, z: base[2] + d[2] * EA.len * t, rt: EA.w * 0.13 * (1 - t * 0.6), rb: EA.w * 0.13 * (1 - t * 0.6), w: EA.w * 0.5 * wv, sq: 1, wts: W1, t: t });
        }
        // the flat of the ear faces forward-out; its cup (front) is the pale side
        head.loft(est, 6, function (x, y, z, ca, sa, R, t) {
          let c = ca < -0.2 ? mix(C.face, C.earIn, smooth(-0.2, -0.7, ca) * (1 - smooth(0.7, 1, R.t != null ? R.t : t) * 0.4)) : (EA.back_c || C.face);
          if (EA.tip && (R.t != null ? R.t : t) > 0.72) c = EA.tip;
          return shade(c, grain(x, y, z));
        }, { side: EA.face === "side" ? [1, 0, 0] : [0, 0, 1], capLen: 0.5, capN: 1 }, true);
      });
    }
    // lower jaw (predators): its own mesh, low and forward in the cluster
    if (o.jaw) {
      const jaw = P.parts.jaw = new Part("jaw", UV);
      const jst = [];
      const J = [[0.32, 0.2, 0.32], [0.55, 0.18, 0.28], [0.8, 0.15, 0.22], [0.97, 0.12, 0.17]];
      for (let i = 0; i < J.length; i++) {
        const pr = sampleKeys(prof, 30).reduce(function (b, r) { return Math.abs(r[0] - J[i][0]) < Math.abs(b[0] - J[i][0]) ? r : b; });
        const q = hp(J[i][0], -H.D * pr[2] * 0.82, 0);
        jst.push({ x: q[0], y: q[1], z: 0, rt: H.D * J[i][1], rb: H.D * J[i][1] * 0.9, w: H.Wd * 2 * J[i][2], wts: W1, t: J[i][0] });
      }
      jaw.loft(jst, 12, function (x, y, z, ca, sa, R, t) {
        let c = mix(C.chin || C.muzzle, C.belly, ca < 0 ? 0.3 : 0);
        if (paint) c = paint("jaw", x, y, z, ca, sa, t, c);
        return shade(c, grain(x, y, z));
      }, { capLen: 0.8, capN: 2, uScale: uS });
    }

    // ---- legs
    const LG = Object.assign({ f: chest * 0.2, c: chest * 0.085, h: chest * 0.26 }, o.leg || {});
    const lz = o.legZ != null ? o.legZ : BW * 0.6;
    function legChains(front) {
      const x = front ? (o.frontX != null ? o.frontX : 0.3 * L) : (o.hindX != null ? o.hindX : -0.33 * L);
      const c = LG.c, f = LG.f, h = LG.h;
      if (fam === "hoof" || fam === "pig") {
        const hoofH = o.hoofH || Math.max(0.05, WH * 0.05);
        if (front) return [
          [x - 0.02 * L, WH - chest * 0.45, f * 1.25, f * 1.2, f * 0.95],
          [x - 0.035 * L, brisket - chest * 0.02, f * 1.05, f, f * 0.82],
          [x - 0.025 * L, brisket - (brisket * 0.55), f * 0.62, f * 0.66, f * 0.55],
          [x - 0.02 * L, WH * 0.27, c * 1.25, c * 1.2, c * 1.1],     // knee (carpus)
          [x - 0.015 * L, WH * 0.2, c, c, c * 0.9],
          [x - 0.01 * L, hoofH * 2.2, c * 1.15, c * 1.15, c * 1.0],    // fetlock
          [x + 0.012 * L, hoofH * 1.2, c * 1.0, c * 0.9, c * 0.92],   // pastern
          [x + 0.02 * L, hoofH, c * 1.12, c * 1.0, c * 1.02],
          [x + 0.03 * L, 0.004, c * 1.3, c * 1.15, c * 1.15],
        ];
        return [
          [x + 0.02 * L, HH - chest * 0.25, h * 1.25, h * 1.15, h * 0.7],
          [x + 0.07 * L, HH * 0.66, h * 1.0, h * 1.05, h * 0.72],          // stifle
          [x - 0.01 * L, HH * 0.47, h * 0.62, h * 0.75, h * 0.55],
          [x - 0.065 * L, HH * 0.34, c * 1.25, c * 1.55, c * 1.0],        // hock
          [x - 0.055 * L, HH * 0.24, c, c * 1.05, c * 0.9],
          [x - 0.045 * L, hoofH * 2.2, c * 1.12, c * 1.12, c * 1.0],
          [x - 0.025 * L, hoofH * 1.2, c, c * 0.9, c * 0.92],
          [x - 0.015 * L, hoofH, c * 1.12, c, c * 1.02],
          [x - 0.005 * L, 0.004, c * 1.3, c * 1.15, c * 1.15],
        ];
      }
      if (fam === "bear") {
        if (front) return [
          [x, WH - chest * 0.4, f * 1.3, f * 1.3, f * 1.0],
          [x - 0.03 * L, brisket, f * 1.15, f * 1.15, f * 0.9],
          [x - 0.01 * L, WH * 0.22, f * 0.9, f * 0.95, f * 0.8],
          [x + 0.01 * L, WH * 0.08, f * 0.95, f * 0.9, f * 0.95],
          [x + 0.06 * L, 0.035, f * 0.55, f * 0.5, f * 1.0],
          [x + 0.1 * L, 0.004, f * 0.3, f * 0.3, f * 0.85],
        ];
        return [
          [x + 0.02 * L, HH - chest * 0.25, h * 1.3, h * 1.2, h * 1.0],
          [x + 0.05 * L, HH * 0.5, h * 1.05, h * 1.05, h * 0.85],
          [x - 0.01 * L, HH * 0.2, h * 0.75, h * 0.8, h * 0.7],
          [x - 0.03 * L, 0.07, h * 0.65, h * 0.6, h * 0.7],
          [x + 0.04 * L, 0.03, h * 0.45, h * 0.4, h * 0.72],
          [x + 0.08 * L, 0.004, h * 0.25, h * 0.25, h * 0.6],
        ];
      }
      if (fam === "hare") {
        if (front) return [
          [x, WH - chest * 0.4, f, f, f * 0.85],
          [x - 0.01 * L, brisket, f * 0.8, f * 0.8, f * 0.7],
          [x, WH * 0.12, f * 0.55, f * 0.55, f * 0.55],
          [x + 0.05 * L, 0.02, f * 0.5, f * 0.45, f * 0.55],
          [x + 0.08 * L, 0.004, f * 0.3, f * 0.3, f * 0.45],
        ];
        return [
          [x + 0.06 * L, HH * 0.75, h * 1.2, h * 1.1, h * 0.9],
          [x + 0.08 * L, HH * 0.38, h * 1.05, h * 1.1, h * 0.85],
          [x - 0.05 * L, HH * 0.14, h * 0.6, h * 0.6, h * 0.5],
          [x - 0.03 * L, 0.03, h * 0.45, h * 0.4, h * 0.5],
          [x + 0.1 * L, 0.004, h * 0.3, h * 0.25, h * 0.45],
        ];
      }
      // digitigrade: cats and dogs
      const pawR = o.paw || f * 0.85;
      if (front) return [
        [x - 0.02 * L, WH - chest * 0.4, f * 1.35, f * 1.25, f * 1.0],
        [x - 0.05 * L, brisket + chest * 0.05, f * 1.1, f * 1.05, f * 0.85],
        [x - 0.02 * L, WH * 0.32, f * 0.8, f * 0.75, f * 0.68],
        [x - 0.005 * L, WH * 0.1, f * 0.58, f * 0.58, f * 0.58],
        [x + 0.015 * L, pawR * 0.9, pawR * 0.75, pawR * 0.7, pawR * 0.8],
        [x + 0.035 * L, pawR * 0.45, pawR * 0.95, pawR * 0.85, pawR * 0.9],
        [x + 0.05 * L, 0.004, pawR * 0.6, pawR * 0.55, pawR * 0.75],
      ];
      return [
        [x + 0.03 * L, HH - chest * 0.25, h * 1.3, h * 1.2, h * 0.95],
        [x + 0.09 * L, HH * 0.58, h * 1.0, h * 1.0, h * 0.8],             // stifle
        [x - 0.02 * L, HH * 0.42, h * 0.65, h * 0.72, h * 0.55],
        [x - 0.075 * L, HH * 0.27, f * 0.55, f * 0.68, f * 0.5],           // hock
        [x - 0.05 * L, HH * 0.1, f * 0.5, f * 0.5, f * 0.5],
        [x - 0.03 * L, pawR * 0.9, pawR * 0.7, pawR * 0.65, pawR * 0.75],
        [x - 0.01 * L, pawR * 0.45, pawR * 0.9, pawR * 0.8, pawR * 0.88],
        [x + 0.005 * L, 0.004, pawR * 0.58, pawR * 0.52, pawR * 0.7],
      ];
    }
    const hoofH = o.hoofH || Math.max(0.05, WH * 0.05);
    ["FL", "FR", "HL", "HR"].forEach(function (nm) {
      const front = nm[0] === "F", s = nm[1] === "L" ? 1 : -1;
      const pts = o.legPts ? o.legPts(front) : legChains(front);
      const leg = P.parts["leg" + nm] = new Part("leg" + nm, UV);
      const z = s * (front ? lz : lz * (o.hindZ || 1.02));
      const lst = [];
      // the leg's root sits INSIDE the body (shoulder blade / thigh under the
      // skin), splaying out to the foot's track: its top never pokes out
      // through the flank as a flap
      const inK = o.legRoot != null ? o.legRoot : 0.62;
      for (let i = 0; i < pts.length; i++) {
        const u = i / (pts.length - 1), k2 = Math.min(1, inK + (1 - inK) * Math.min(1, u * 2.2));
        lst.push({ x: pts[i][0], y: pts[i][1], z: z * k2, rt: pts[i][2], rb: pts[i][3], w: i === 0 ? Math.min(pts[i][4], Math.max(0.01, BW * 0.92 - Math.abs(z) * inK) * 0.9) : pts[i][4], wts: W1, t: u });
      }
      const hooved = fam === "hoof" || fam === "pig";
      leg.loft(lst, o.legSegs || 9, function (x, y, z2, ca, sa, R, t) {
        let c = mix(C.body, C.leg, smooth(WH * 0.62, WH * 0.4, y));
        if (C.sock && y < C.sockH) c = mix(c, C.sock, smooth(C.sockH, C.sockH * 0.8, y));
        if (hooved && y < hoofH * 1.05) c = C.hoof;
        if (!hooved && y < 0.012) c = C.pad;
        if (paint) c = paint(front ? "legF" : "legH", x, y, z2, ca, sa, t, c);
        return y < hoofH * 1.05 && hooved ? shade(c, 0.9 + 0.2 * clamp01(y / hoofH)) : shade(c, grain(x, y, z2));
      }, { side: [0, 0, 1], capA: true, capB: true, capLen: 0.3, capN: 2, uScale: uS }, false);
      // a flat sole: the end cap must not dip under the ground plane (the
      // rig reads a leg's bottom off its bounding box)
      for (let i = 1; i < leg.G.p.length; i += 3) if (leg.G.p[i] < 0) leg.G.p[i] = 0;
      // claws on paws (bears / dogs / cats show them little; bears a lot)
      if (o.claws) {
        const last = pts[pts.length - 1];
        for (let k = -1.5; k <= 1.5; k += 1) {
          const cz = z + k * last[4] * 0.45;
          leg.tube([[last[0] + last[2] * 0.6, 0.04, cz, o.claws], [last[0] + last[2] * 0.6 + o.claws * 4, 0.012, cz, o.claws * 0.3]], 3, 5, C.claw, true);
        }
      }
    });

    // ---- tail
    const T = o.tail;
    if (T) {
      const tail = P.parts.tail = new Part("tail", UV);
      const da = (T.droop != null ? T.droop : 60) * Math.PI / 180;
      const tx0 = xr + 0.02 * L, ty0 = HH - rumpD * 0.15 + (T.dy || 0);
      const pts = [];
      const n = 8;
      for (let i = 0; i <= n; i++) {
        const t = i / n, a = da * (0.4 + 0.6 * t) + (T.curl || 0) * t * t;
        const prev = pts.length ? pts[pts.length - 1] : [tx0, ty0];
        const step = T.len / n;
        pts.push(i === 0 ? [tx0, ty0] : [prev[0] - Math.cos(a) * step, prev[1] - Math.sin(a) * step]);
      }
      const tst = pts.map(function (p, i) {
        const t = i / n, r = T.r * (1 - t * (T.taper != null ? T.taper : 0.6)) * (T.bush ? (1 + T.bush * Math.sin(t * Math.PI * 0.9)) : 1);
        return { x: p[0], y: p[1], z: 0, rt: r, rb: r, w: r * (T.flat || 1), wts: W1, t: t };
      });
      tail.loft(tst, 7, function (x, y, z, ca, sa, R, t) {
        const tt = R.t != null ? R.t : t;
        let c = mix(C.tail, C.tailTip, smooth(T.tipAt || 0.75, 1, tt));
        if (paint) c = paint("tail", x, y, z, ca, sa, tt, c);
        return shade(c, grain(x, y, z));
      }, { capLen: 0.9, capN: 2, uScale: uS * 1.5 });
      if (T.tuft) {
        const e = pts[pts.length - 1];
        tail.ellipsoid(e[0] - T.tuft * 0.5, e[1] - T.tuft * 0.4, 0, T.tuft * 1.2, T.tuft * 0.8, T.tuft * 0.75, 10, C.tailTip);
      }
      if (T.switch) {     // a horse/cow switch: long hair falling from the dock
        const e = pts[Math.floor(n * 0.35)], end = T.hairTo != null ? T.hairTo : Math.max(0.35, e[1] - T.len * 1.05);
        const dz = e[1] - end;
        tail.tube([[e[0], e[1], 0, T.switch], [e[0] - dz * 0.18, e[1] - dz * 0.2, 0, T.switch * 1.2], [e[0] - dz * 0.24, e[1] - dz * 0.55, 0, T.switch * 1.25], [e[0] - dz * 0.2, end + dz * 0.12, 0, T.switch * 0.95], [e[0] - dz * 0.16, end, 0, T.switch * 0.35]], 9, 9, function (x, y, z, ca, sa, R) { return shade(C.tailTip, K_grain(x * 9, y * 2, z * 9)); }, false, { flat: 0.65 });
      }
    }

    // ---- species extras (horns, antlers, manes, tusks, trunks, humps)
    // a point on the neck's crest (t 0 root .. 1 poll), for manes
    function crestAt(t, lift) {
      const f = t * (nst.length - 1), i = Math.min(nst.length - 2, Math.floor(f)), u = f - i, a = nst[i], b = nst[i + 1];
      const tx = b.x - a.x, ty = b.y - a.y, tl = Math.hypot(tx, ty) || 1;
      const r = (a.rt + (b.rt - a.rt) * u) * (lift != null ? lift : 0.92);
      return [a.x + tx * u - ty / tl * r, a.y + ty * u + tx / tl * r];
    }
    // the torso's top line at x (for ridges, humps, saddles)
    function topAt(x) {
      for (let i = 0; i < rows.length - 1; i++) if (x >= rows[i][0] && x <= rows[i + 1][0]) { const u = (x - rows[i][0]) / ((rows[i + 1][0] - rows[i][0]) || 1); return rows[i][1] + (rows[i + 1][1] - rows[i][1]) * u; }
      return x < rows[0][0] ? rows[0][1] : rows[rows.length - 1][1];
    }
    if (o.extra) o.extra({ P: P, crestAt: crestAt, topAt: topAt, head: head, torso: torso, neck: neckPart, hp: hp, H: H, ax: ax, up: up, C: C, L: L, WH: WH, HH: HH, chest: chest, BW: BW, nx0: nx0, ny0: ny0, nx1: nx1, ny1: ny1, xr: xr, xf: xf, mix: mix, shade: shade, grain: grain, smooth: smooth, Part: Part });
    return P;
  }

  CBZ.beastKit = { build: build, quad: quad, mix: mix, shade: shade, smooth: smooth, grain: grain, Part: Part, sampleKeys: sampleKeys, patternMat: patternMat, PAINT: PAINT };
})();
