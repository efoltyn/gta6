"use strict";
/* src/battle/arenas/dress.js — NPC War: THE DRESSING. The real objects a
   battlefield is full of, at their real sizes, and where they go.

   Every arena used to be a ground and nothing on it (the yard aside): open
   sand where the only thing between two armies was the sand, a downtown
   whose streets were clean from kerb to kerb, an airfield apron as bare as
   a car park. Real ground is full of things men fight from, and each of
   those things is a REAL ARTICLE here, built once, instanced everywhere:

     sandbag wall   2.4 m run, seven courses of 0.6 x 0.32 x 0.15 m bags laid
                    stretcher-bond two deep, a slight batter, the top course
                    slumped. Burlap, darker where it sat in the dirt.
     hesco          the wire-mesh geotextile basket a forward base is built of:
                    1.07 m cells, 1.37 m tall, four to a chain, bulging.
     jersey         the yard's own F-shape precast barrier (one profile).
     burnt car      a burnt-out sedan sitting on its rims: lofted body, empty
                    window frames, a black cabin, rust and soot over what is
                    left of the paint.
     boulder        the erg's own welded lump rock, sandstone or granite.
     deadfall       a fallen trunk with its bark, a broken end and moss on the
                    top, some with the root plate torn up.
     dry wall       a battered dry-stone field wall with its coping stones.
     bale           a 1.5 m round bale of straw in its net wrap.
     rubble         a heap of broken concrete with rebar sticking out.
     containers     the yard's ISO boxes, stacked.

   Every one registers with CBZ.battleCover (a collider, its cover points and
   its hit points). Visuals are InstancedMesh pools: one draw per kind, the
   geometry shared, so a field with two hundred sandbag walls costs what one
   does plus its triangles. A destroyed instance is re-posed as its own
   collapse (a slumped heap) or put away.

   PUBLIC  CBZ.battleDress = { begin(ctx), place(kind, x, z, yaw, opts),
     flush(), open(ctx), city(ctx), stats() }
   ctx = { cx, cz, gap, groundAt, theme, blocked(x, z, r), roads } */

CBZ.battleDress = (function () {
  const D = { pools: {}, ctx: null, placed: [], counts: {} };
  function h01(a, b, s) {
    let h = (Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(s | 0, 2246822519)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  // a private dice stream: the world's sWorld() is never touched, so the
  // spawn jitter and every other consumer of it draw exactly what they did
  let _ds = 0x5eed1;
  function rnd() { _ds = (Math.imul(_ds, 1103515245) + 12345) & 0x7fffffff; return _ds / 0x7fffffff; }

  /* ---- geometry plumbing ------------------------------------------------ */
  function flat(g) { return g.index ? g.toNonIndexed() : g; }
  // merge non-indexed pieces that carry position/normal/color (+ uv)
  function merge(parts) {
    let n = 0; parts.forEach(function (g) { n += g.attributes.position.count; });
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3), U = new Float32Array(n * 2);
    let o = 0;
    parts.forEach(function (g) {
      const c = g.attributes.position.count;
      P.set(g.attributes.position.array, o * 3);
      N.set(g.attributes.normal.array, o * 3);
      if (g.attributes.color) C.set(g.attributes.color.array, o * 3); else C.fill(1, o * 3, (o + c) * 3);
      if (g.attributes.uv) U.set(g.attributes.uv.array, o * 2);
      o += c;
    });
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(P, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(N, 3));
    out.setAttribute("color", new THREE.BufferAttribute(C, 3));
    out.setAttribute("uv", new THREE.BufferAttribute(U, 2));
    out.computeBoundingSphere();
    return out;
  }
  function paint(g, fn) {
    const p = g.attributes.position, n = g.attributes.normal;
    const c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const col = fn(p.getX(i), p.getY(i), p.getZ(i), n ? n.getY(i) : 0, i);
      c[i * 3] = col[0]; c[i * 3 + 1] = col[1]; c[i * 3 + 2] = col[2];
    }
    g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    return g;
  }
  // GeoBatch (yard.js) into a geometry, without putting it in the scene
  function batchGeo(B) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(B.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(B.n, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(B.u, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(B.c, 3));
    g.computeBoundingSphere();
    return g;
  }

  /* ---- THE SHARED SKIN PATCH. Props are authored with their feet at y = 0,
     so the object's own height says where it meets the ground: grime and
     damp in the bottom 30-60 cm, a world-space mottle so two instances of
     one model never read as twins, and burlap / geotextile weave where the
     kind asks for it. One program per weave, every prop kind on it. */
  function propMat(o) {
    o = o || {};
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, map: o.map || null });
    const weave = o.weave || 0;
    m.onBeforeCompile = function (sh) {
      sh.vertexShader = "varying vec3 vPW;\nvarying float vPY;\nvarying vec3 vPO;\n" + sh.vertexShader.replace("#include <project_vertex>",
        "#include <project_vertex>\n{ vec4 w = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\n w = instanceMatrix * w;\n#endif\n" +
        " vPW = (modelMatrix * w).xyz; vPY = transformed.y; vPO = transformed; }");
      sh.fragmentShader = "varying vec3 vPW;\nvarying float vPY;\nvarying vec3 vPO;\n" +
        "float pH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n" +
        "float pN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);\n" +
        "  return mix(mix(pH(i), pH(i + vec2(1.0, 0.0)), f.x), mix(pH(i + vec2(0.0, 1.0)), pH(i + vec2(1.0, 1.0)), f.x), f.y); }\n" +
        sh.fragmentShader.replace("#include <color_fragment>",
          "#include <color_fragment>\n" +
          "{ float m = 0.86 + 0.22 * pN(vPW.xz * 0.37 + vPW.yy * 0.21) + 0.08 * (pN(vPW.xz * 2.3 + vPW.y) - 0.5);\n" +
          "  diffuseColor.rgb *= m;\n" +
          (weave === 1 ?
            // burlap: a tight plain weave at 4 mm, only where the lens is close
            "  float d = length(vPW - cameraPosition); float k = 1.0 - smoothstep(6.0, 22.0, d);\n" +
            "  vec2 q = (vPO.xz + vPO.yy) * 160.0; float wv = abs(sin(q.x)) * abs(sin(q.y));\n" +
            "  diffuseColor.rgb *= 1.0 - k * 0.12 * (1.0 - wv);\n" : "") +
          (weave === 2 ?
            // hesco: the welded wire grid over the geotextile, 76 mm squares
            "  vec3 g = abs(fract(vPO / 0.0762 + 0.5) - 0.5); float wire = 1.0 - smoothstep(0.03, 0.09, min(min(g.x, g.y), g.z));\n" +
            "  float d = length(vPW - cameraPosition); wire *= 1.0 - smoothstep(25.0, 70.0, d);\n" +
            "  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.26, 0.25, 0.22), wire * 0.55);\n" : "") +
          "  float low = 1.0 - smoothstep(0.0, 0.35 + 0.25 * pN(vPW.xz * 1.3), vPY);\n" +
          "  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.66, 0.6, 0.52), low * 0.6); }");
    };
    m.customProgramCacheKey = function () { return "npcwar-prop" + weave + (o.map ? "m" : ""); };
    return m;
  }

  /* ---- THE ARTICLES ------------------------------------------------------ */
  const GEO = {};
  function once(key, fn) { return GEO[key] || (GEO[key] = fn()); }

  function bagGeo(seed) {
    const g = flat(new THREE.SphereGeometry(1, 7, 4));
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      // a filled bag is a pillow: square in plan, flat top and bottom, the
      // seam ends pinched
      const sq = 1.25;
      x = Math.sign(x) * Math.pow(Math.abs(x), 1 / sq); z = Math.sign(z) * Math.pow(Math.abs(z), 1 / sq);
      y = Math.sign(y) * Math.min(Math.abs(y), 0.72) * (1 - 0.18 * x * x);
      p.setXYZ(i, x * 0.3, y * 0.1, z * 0.16);
    }
    g.computeVertexNormals();
    const tone = 0.9 + h01(seed, 1, 7) * 0.2;
    return paint(g, function (x, y, z) {
      const k = tone * (0.92 + 0.08 * Math.sin(x * 31 + z * 17));
      const dirt = y < -0.03 ? 0.82 : 1;
      return [0.66 * k * dirt, 0.57 * k * dirt, 0.41 * k * dirt];
    });
  }
  function sandbagWallGeo() {
    return once("sandbags", function () {
      const parts = [];
      const L = 2.4, courses = 7, bagL = 0.6, H = 0.15;
      for (let c = 0; c < courses; c++) {
        const off = (c % 2) * bagL * 0.5;
        const batter = c * 0.035;                  // the wall leans back into its fill
        for (let row = 0; row < 2; row++) {
          for (let b = -1; b < L / bagL; b++) {
            const x = -L / 2 + off + b * bagL + bagL / 2;
            if (x < -L / 2 + 0.05 || x > L / 2 - 0.05) continue;
            const seed = c * 31 + row * 7 + b;
            const g = bagGeo(seed % 5).clone();
            const tilt = (h01(seed, 3, 9) - 0.5) * 0.12, yaw = (h01(seed, 4, 9) - 0.5) * 0.14;
            const slump = c === courses - 1 ? 0.75 + h01(seed, 5, 9) * 0.25 : 1;
            g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(tilt, yaw, 0)));
            g.scale(1, slump, 1);
            g.translate(x, H * 0.5 + c * H * 0.94, (row ? -0.17 : 0.17) - batter);
            parts.push(g);
          }
        }
      }
      return merge(parts);
    });
  }
  // the wire basket is the base kit's (world/basekit.js): ONE HESCO in the
  // repo, the same geometry Fort Brandt's revetments and gate walls stand on
  function hescoGeo() {
    return once("hesco", function () { return CBZ.baseKit.hescoGeo(true); });
  }
  function jerseyGeo() {
    return once("jersey", function () {
      const B = new GeoBatch();
      B.xf(0, 0, 0, 0);
      jerseyInto(B, 3.0, [1, 1, 0.98]);
      return batchGeo(B);
    });
  }
  /* THE BURNT-OUT SEDAN. Lofted: each station is (x, half-width, sill, belt,
     roof|null). The lower body is one closed tube; the glasshouse is a roof
     panel on six pillars with the windows gone; the cabin floor and seat
     frames show black through them. */
  function hulkGeo(v) {
    return once("hulk" + v, function () {
      const ST = [
        [-2.36, 0.74, 0.34, 0.72], [-2.2, 0.86, 0.3, 0.84], [-1.6, 0.9, 0.28, 0.9], [-1.0, 0.9, 0.27, 0.92],
        [-0.3, 0.9, 0.27, 0.93], [0.6, 0.9, 0.27, 0.92], [1.3, 0.9, 0.28, 0.88], [2.0, 0.86, 0.3, 0.8], [2.38, 0.72, 0.36, 0.66],
      ];
      const seed = v * 13 + 5;
      const sink = 0.06 + v * 0.05;                    // on the rims, one corner lower
      const SEG = 10;
      const pos = [], col = [];
      const burnt = function (x, y, z) {
        const n = h01(Math.round(x * 3 + seed), Math.round(y * 5 + z * 3), 21);
        const rust = [0.38 + n * 0.12, 0.2 + n * 0.06, 0.1 + n * 0.03];
        const soot = [0.07, 0.065, 0.06];
        const ash = [0.52, 0.5, 0.47];
        const t = h01(Math.round(x * 1.7 + seed), Math.round(z * 2 + y * 2), 23);
        if (t < 0.32) return soot;
        if (t > 0.86 && y > 0.6) return ash;
        return rust;
      };
      const ring = function (s) {
        const out = [];
        for (let k = 0; k <= SEG; k++) {
          const a = (k / SEG) * Math.PI * 2;
          const cy = (s[2] + s[3]) / 2, hy = (s[3] - s[2]) / 2;
          const c = Math.cos(a), sn = Math.sin(a);
          const e = 0.35;                                // superellipse: boxy with rounded edges
          const x = Math.sign(c) * Math.pow(Math.abs(c), e) * s[1], y = cy + Math.sign(sn) * Math.pow(Math.abs(sn), e) * hy;
          out.push([s[0], y - sink * (s[0] + 2.4) / 4.8, x]);
        }
        return out;
      };
      const tri = function (a, b, c, ca, cb, cc) { pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); col.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], cc[0], cc[1], cc[2]); };
      const quad = function (a, b, c, d) { const ca = burnt(a[0], a[1], a[2]); tri(a, b, c, ca, ca, ca); tri(a, c, d, ca, ca, ca); };
      let prev = ring(ST[0]);
      for (let i = 1; i < ST.length; i++) {
        const cur = ring(ST[i]);
        for (let k = 0; k < SEG; k++) quad(prev[k], cur[k], cur[k + 1], prev[k + 1]);
        prev = cur;
      }
      // end caps
      for (const end of [0, ST.length - 1]) {
        const r = ring(ST[end]), c = [ST[end][0], (ST[end][2] + ST[end][3]) / 2, 0];
        for (let k = 0; k < SEG; k++) {
          const a = r[k], b = r[k + 1];
          if (end === 0) tri(c, b, a, burnt(0, 0.5, 0), burnt(0, 0.5, 0), burnt(0, 0.5, 0));
          else tri(c, a, b, burnt(0, 0.5, 0), burnt(0, 0.5, 0), burnt(0, 0.5, 0));
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      g.computeVertexNormals();
      const parts = [g];
      // the glasshouse: roof panel + A/B/C pillars, windows gone
      const box = function (x, y, z, w, h, d, c, rx, rz) {
        const b = flat(new THREE.BoxGeometry(w, h, d));
        if (rx || rz) b.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx || 0, 0, rz || 0)));
        b.translate(x, y - sink * (x + 2.4) / 4.8, z);
        paint(b, function (px, py, pz) { return c || burnt(px + x, py + y, pz + z); });
        parts.push(b);
      };
      const belt = 0.9, roof = 1.36 - v * 0.04;       // one has the roof sagging
      box(-0.05, roof, 0, 1.55, 0.06, 1.42);
      for (const sz of [-1, 1]) {
        box(0.92, (belt + roof) / 2, sz * 0.74, 0.07, roof - belt + 0.08, 0.07, null, 0, 0.62);   // A pillar, raked
        box(-0.12, (belt + roof) / 2, sz * 0.76, 0.08, roof - belt, 0.07);                       // B
        box(-0.98, (belt + roof) / 2, sz * 0.74, 0.07, roof - belt + 0.06, 0.07, null, 0, -0.55); // C
      }
      const black = [0.045, 0.04, 0.038];
      box(-0.05, belt + 0.01, 0, 1.9, 0.04, 1.62, black);                  // the burnt cabin floor
      box(0.32, belt + 0.28, 0.42, 0.08, 0.5, 0.46, [0.12, 0.1, 0.09]);    // seat frames
      box(0.32, belt + 0.28, -0.42, 0.08, 0.5, 0.46, [0.12, 0.1, 0.09]);
      box(-0.55, belt + 0.22, 0, 0.1, 0.4, 1.3, [0.1, 0.09, 0.08]);
      // rims: the tyres burnt away
      for (const wx of [-1.42, 1.38]) for (const wz of [-0.8, 0.8]) {
        const r = flat(new THREE.CylinderGeometry(0.22, 0.22, 0.2, 12));
        r.rotateX(Math.PI / 2);
        r.translate(wx, 0.2 - sink * (wx + 2.4) / 4.8 - 0.05, wz);
        paint(r, function () { return [0.24, 0.16, 0.11]; });
        parts.push(r);
      }
      parts.forEach(function (q) { if (!q.attributes.normal) q.computeVertexNormals(); });
      return merge(parts.map(flat));
    });
  }
  function boulderGeo(v, granite) {
    return once("boulder" + v + (granite ? "g" : "s"), function () {
      const g = lumpRock(2, 7 + v * 13, 0.62 + v * 0.08, granite ? function (x, y, z, ny) {
        const n = vn2(x * 3 + v, z * 3 + y * 2, 19);
        let r = 0.46 + n * 0.1, gg = 0.46 + n * 0.1, b = 0.45 + n * 0.1;
        const lich = vn2(x * 5 + 2, z * 5 + y * 4, 23);
        if (lich > 0.62 && ny > 0) { r = 0.52; gg = 0.55; b = 0.36; }      // lichen on the lit side
        if (ny > 0.55) { r *= 0.9; gg *= 0.95; b *= 0.85; }
        return [r, gg, b];
      } : function (x, y, z, ny) {
        const band = Math.sin(y * 7.5 + vn2(x * 1.3, z * 1.3, 5) * 2.4);
        let r = 0.6 + band * 0.045, gg = 0.47 + band * 0.03, b = 0.36 + band * 0.02;
        if (ny > 0.55) { const k = (ny - 0.55) * 0.5; r -= r * k; gg -= gg * k; b -= b * k * 0.8; }
        return [r, gg, b];
      });
      if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      return flat(g);
    });
  }
  /* A FALLEN TRUNK along +x, 1 m long at radius 1 (scaled per log): bark
     ridges in the shell, a jagged broken end, two branch stubs, moss on the
     upper side. v=1 carries the torn-up root plate at its foot. */
  function logGeo(v) {
    return once("log" + v, function () {
      const SEG = 12, N = 10;
      const pos = [], uv = [], col = [];
      const rad = function (t, a) {
        const taper = 1 - 0.32 * t;
        const ridge = 1 + 0.05 * Math.sin(a * 9 + t * 3) + 0.03 * Math.sin(a * 23 + t * 17);
        return taper * ridge;
      };
      const P = function (t, a) {
        const r = rad(t, a);
        // a broken end: the last station is jagged
        const x = t === 1 ? 1 + (h01(Math.round(a * 10), 1, 31 + v) - 0.5) * 0.18 : t;
        return [x - 0.5, Math.sin(a) * r * 0.5 + 0.5 * 0.92, Math.cos(a) * r * 0.5];
      };
      const C = function (t, a) {
        const up = Math.sin(a);
        const moss = Math.max(0, up - 0.35) * (0.6 + 0.4 * h01(Math.round(t * 12), Math.round(a * 6), 37));
        return [0.55 - moss * 0.22, 0.47 - moss * 0.02, 0.38 - moss * 0.2];
      };
      for (let i = 0; i < N; i++) {
        const t0 = i / N, t1 = (i + 1) / N;
        for (let k = 0; k < SEG; k++) {
          const a0 = (k / SEG) * Math.PI * 2, a1 = ((k + 1) / SEG) * Math.PI * 2;
          const q = [[t0, a0], [t1, a0], [t1, a1], [t0, a1]];
          const idx = [0, 1, 2, 0, 2, 3];
          for (let j = 0; j < 6; j++) {
            const w = q[idx[j]], p = P(w[0], w[1]), c = C(w[0], w[1]);
            pos.push(p[0], p[1], p[2]); uv.push(w[1] / (Math.PI * 2) * 2, w[0] * 4); col.push(c[0], c[1], c[2]);
          }
        }
      }
      // the broken end's face: pale heartwood
      for (let k = 0; k < SEG; k++) {
        const a0 = (k / SEG) * Math.PI * 2, a1 = ((k + 1) / SEG) * Math.PI * 2;
        const pa = P(1, a0), pb = P(1, a1), c = [0.5, 0.92 * 0.5 - 0.0, 0];
        pos.push(0.5 + 0.02, 0.46, 0, pb[0], pb[1], pb[2], pa[0], pa[1], pa[2]);
        uv.push(0.5, 0.5, 0.5, 0.5, 0.5, 0.5);
        col.push(0.72, 0.62, 0.46, 0.66, 0.56, 0.42, 0.66, 0.56, 0.42);
        // and the foot's sawn/rotten face
        const fa = P(0, a0), fb = P(0, a1);
        pos.push(-0.5, 0.46, 0, fa[0], fa[1], fa[2], fb[0], fb[1], fb[2]);
        uv.push(0.5, 0.5, 0.5, 0.5, 0.5, 0.5);
        col.push(0.42, 0.34, 0.25, 0.46, 0.38, 0.28, 0.46, 0.38, 0.28);
        void c;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      g.computeVertexNormals();
      const parts = [g];
      // branch stubs, broken short
      for (let b = 0; b < 2; b++) {
        const s = flat(new THREE.CylinderGeometry(0.05, 0.11, 0.55, 6));
        s.translate(0, 0.27, 0);
        s.rotateZ(-0.5 - b * 0.4); s.rotateX(b ? 0.9 : -0.7);
        s.translate(-0.1 + b * 0.35, 0.8, 0);
        paint(s, function () { return [0.46, 0.4, 0.32]; });
        parts.push(s);
      }
      if (v === 1) {
        // the root plate: a disc of soil and roots torn up on edge at the foot
        const d = flat(new THREE.CylinderGeometry(1.15, 1.25, 0.32, 14, 1));
        const p = d.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x);
          const k = 0.8 + 0.3 * h01(Math.round(a * 4), 2, 41);
          p.setXYZ(i, x * k, p.getY(i), z * k);
        }
        d.computeVertexNormals();
        d.rotateZ(Math.PI / 2);
        d.translate(-0.52, 0.55, 0);
        paint(d, function (x, y, z, ny) { return ny > 0.5 || ny < -0.5 ? [0.27, 0.21, 0.15] : [0.33, 0.26, 0.18]; });
        parts.push(d);
      }
      parts.forEach(function (q) { if (!q.attributes.uv) q.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(q.attributes.position.count * 2), 2)); });
      return merge(parts.map(flat));
    });
  }
  function wallGeo() {
    return once("drywall", function () {
      const parts = [];
      // the hearting: a battered core, 0.65 m at the foot, 0.42 at the cap
      const core = flat(new THREE.BoxGeometry(3.0, 1.0, 0.65, 6, 3, 1));
      const p = core.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i) + 0.5, z = p.getZ(i);
        const k = 1 - 0.35 * y;
        p.setXYZ(i, p.getX(i), y, z * k + (vn2(p.getX(i) * 3, y * 4, 51) - 0.5) * 0.04);
      }
      core.computeVertexNormals();
      paint(core, function (x, y, z) {
        // courses of stone: light faces, dark joints, by a lattice of irregular blocks
        const row = Math.floor(y / 0.17), off = row * 0.37;
        const cx = Math.floor((x + off) / (0.28 + 0.12 * h01(row, 0, 61))), jt = (x + off) % 0.3;
        const n = h01(cx, row, 63), joint = Math.abs(jt) < 0.025 || (y % 0.17) < 0.02;
        const t = joint ? 0.42 : 0.72 + n * 0.22;
        return [t * 0.93, t * 0.9, t * 0.84];
      });
      parts.push(core);
      // the coping: stones set on edge along the top
      for (let i = 0; i < 12; i++) {
        const s = boulderGeo(i % 3, true).clone();
        s.scale(0.13, 0.2, 0.22);
        s.rotateY((h01(i, 3, 67) - 0.5) * 0.3);
        s.translate(-1.4 + i * 0.255, 1.06, 0);
        parts.push(s);
      }
      return merge(parts.map(flat));
    });
  }
  function baleGeo() {
    return once("bale", function () {
      const g = flat(new THREE.CylinderGeometry(0.75, 0.75, 1.2, 18, 2));
      g.rotateZ(Math.PI / 2);
      g.translate(0, 0.72, 0);
      return paint(g, function (x, y, z, ny) {
        const r = Math.hypot(y - 0.72, z);
        const end = Math.abs(x) > 0.59;
        if (end) { const sp = 0.5 + 0.5 * Math.sin(r * 38 + Math.atan2(z, y - 0.72)); return [0.74 - sp * 0.1, 0.62 - sp * 0.1, 0.36 - sp * 0.06]; }
        const s = h01(Math.round(x * 20), Math.round(Math.atan2(z, y - 0.72) * 9), 71);
        return [0.72 + s * 0.08, 0.6 + s * 0.06, 0.34 + s * 0.04];
      });
    });
  }
  function rubbleGeo(v) {
    return once("rubble" + v, function () {
      const parts = [];
      for (let i = 0; i < 14; i++) {
        const a = h01(i, v, 81) * 6.28, d = Math.sqrt(h01(i, v, 83)) * 1.3;
        const s = boulderGeo(i % 3, true).clone();
        const sz = 0.35 + h01(i, v, 85) * 0.5;
        s.scale(sz, sz * (0.5 + h01(i, v, 87) * 0.4), sz * 0.8);
        s.rotateY(a * 2);
        s.translate(Math.cos(a) * d, (1.3 - d) * 0.45, Math.sin(a) * d * 0.7);
        paint(s, function (x, y, z) { const t = 0.5 + h01(i, Math.round(y * 9), 89) * 0.18; return [t, t * 0.98, t * 0.95]; });
        parts.push(s);
      }
      for (let i = 0; i < 4; i++) {                    // rebar
        const r = flat(new THREE.CylinderGeometry(0.012, 0.012, 1.4, 4));
        r.rotateZ(0.6 + i * 0.35); r.rotateY(i * 1.4);
        r.translate((i - 1.5) * 0.4, 0.7, (h01(i, v, 91) - 0.5) * 0.6);
        paint(r, function () { return [0.3, 0.17, 0.1]; });
        parts.push(r);
      }
      parts.forEach(function (q) { if (!q.attributes.uv) q.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(q.attributes.position.count * 2), 2)); });
      return merge(parts.map(flat));
    });
  }

  /* ---- POOLS: one InstancedMesh per article, built at flush() ------------- */
  const MAT = {};
  function matFor(kind) {
    if (MAT[kind]) return MAT[kind];
    let m;
    if (kind === "sandbags") m = propMat({ weave: 1 });
    else if (kind === "hesco") m = propMat({ weave: 2 });
    else if (kind === "jersey") {
      const pc = precastTex();
      m = propMat({ map: pc.map });
    } else if (kind === "log") {
      const VK = CBZ.vegetationKit;
      const bark = VK && VK.barkTexture ? VK.barkTexture() : null;
      m = propMat({ map: bark });
    } else m = propMat({});
    return (MAT[kind] = m);
  }
  function pool(key, geoFn, kind) {
    if (D.pools[key]) return D.pools[key];
    return (D.pools[key] = { key: key, geo: geoFn, kind: kind, items: [], mesh: null });
  }
  function put(P, x, y, z, yaw, sx, sy, sz, tilt) {
    const it = { x: x, y: y, z: z, yaw: yaw, sx: sx, sy: sy == null ? sx : sy, sz: sz == null ? sx : sz, tilt: tilt || 0, i: P.items.length };
    // AFTER THE FLUSH: a late article (a tree felled into a log, a wreck
    // pushed over) takes one of the pool's spare slots
    if (P.mesh) {
      if (P.items.length >= P.cap) return it;
      it.i = P.items.length;
      P.items.push(it);
      P.mesh.setMatrixAt(it.i, matOf(it, new THREE.Matrix4()));
      P.mesh.count = P.items.length;
      P.mesh.instanceMatrix.needsUpdate = true;
      return it;
    }
    P.items.push(it);
    return it;
  }
  function matOf(it, m4) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(it.tilt || 0, it.yaw, it.roll || 0, "YXZ"));
    return m4.compose(new THREE.Vector3(it.x, it.y, it.z), q, new THREE.Vector3(it.sx, it.sy, it.sz));
  }
  // the node sim has the colliders and the cover; it never draws
  function drawing() { return !!(CBZ.renderer || (CBZ.micro && CBZ.micro.renderer)) && typeof document !== "undefined"; }
  function flush() {
    if (!drawing()) return;
    flushContainers();
    const m4 = new THREE.Matrix4();
    Object.keys(D.pools).forEach(function (k) {
      const P = D.pools[k];
      if (P.mesh || !P.items.length) return;
      const geo = typeof P.geo === "function" ? P.geo() : P.geo;
      P.cap = P.items.length + (P.kind === "log" ? 96 : 12);
      const mesh = new THREE.InstancedMesh(geo, matFor(P.kind), P.cap);
      for (let i = 0; i < P.items.length; i++) mesh.setMatrixAt(i, matOf(P.items[i], m4));
      mesh.count = P.items.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.userData.dynamic = true;                 // instances re-pose when blown apart
      mesh.name = "dress-" + k;
      CBZ.scene.add(mesh);
      P.mesh = mesh;
    });
  }
  // a destroyed article: re-pose its instance as its own collapse
  function slump(P, it, kind) {
    if (!P.mesh) return;
    const m4 = new THREE.Matrix4();
    if (kind === "bale" || kind === "crate") { m4.makeScale(0, 0, 0); }
    else {
      const s = Object.assign({}, it);
      s.sy = it.sy * (kind === "hulk" ? 0.7 : 0.3); s.sx = it.sx * 1.08; s.sz = it.sz * 1.35;
      s.tilt = (it.tilt || 0) + 0.08; s.y = it.y - 0.05;
      matOf(s, m4);
    }
    P.mesh.setMatrixAt(it.i, m4);
    P.mesh.instanceMatrix.needsUpdate = true;
  }

  /* ---- BREAK-UP: what a destroyed article throws ---------------------------
     Its own stuff, in its own colour (the pool's vertex paint averaged once):
     sandbags burst into sand and torn sacking, a gabion spills its fill, a
     jersey barrier or a dry-stone wall goes to broken stone, a burnt-out hulk
     sheds torn plate, a log splinters, a bale goes to straw. Irregular
     instanced shapes from CBZ.debris (never boxes), plus a dust cloud. */
  const BREAK = {
    sandbags: [{ kind: "sand", n: 14, size: 0.12 }, { kind: "foliage", shape: "flake", n: 6, size: 0.3 }],
    hesco:    [{ kind: "dirt", n: 18, size: 0.14 }, { kind: "metal", shape: "plate", n: 3, size: 0.5 }],
    jersey:   [{ kind: "concrete", n: 14, size: 0.2 }],
    drywall:  [{ kind: "rock", n: 16, size: 0.18 }],
    hulk:     [{ kind: "metal", shape: "plate", n: 6, size: 0.6 }],
    log:      [{ kind: "wood", n: 12, size: 0.16 }],
    bale:     [{ kind: "foliage", shape: "flake", n: 18, size: 0.2 }],
  };
  function poolTone(P) {
    if (P.tone != null) return P.tone;
    let hex = 0x8a8478;
    const g = P.mesh && P.mesh.geometry, vc = g && g.attributes.color;
    if (vc && vc.count) {
      let r = 0, gg = 0, b = 0, n = 0;
      const step = Math.max(1, Math.floor(vc.count / 400));
      for (let i = 0; i < vc.count; i += step, n++) { r += vc.getX(i); gg += vc.getY(i); b += vc.getZ(i); }
      hex = (Math.min(255, Math.round(r / n * 255)) << 16) | (Math.min(255, Math.round(gg / n * 255)) << 8) | Math.min(255, Math.round(b / n * 255));
    }
    return (P.tone = hex);
  }
  function breakUp(P, kind, x, gy, z, hw, hd, h) {
    const Db = CBZ.debris, list = BREAK[kind];
    if (!Db || !Db.chips || !list || !P.mesh) return;
    const cam = CBZ.camera && CBZ.camera.position;
    if (!cam || (cam.x - x) * (cam.x - x) + (cam.z - z) * (cam.z - z) > 260 * 260) return;
    const tone = poolTone(P), span = Math.max(hw, hd);
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      try {
        Db.chips(x, gy + h * 0.6, z, { kind: b.kind, shape: b.shape, color: i === 0 || b.kind === "foliage" ? tone : undefined,
          count: b.n, size: b.size, power: 1.6, dir: { x: 0, y: 1, z: 0 }, spread: span * 1.6, dust: i === 0, radius: span });
      } catch (e) {}
    }
  }

  /* ---- place(kind, x, z, yaw): one article, its collider, its cover ------- */
  const SPEC = {
    sandbags: { hw: 1.2, hd: 0.42, h: 1.05, hp: 170, rubble: 0.45 },
    hesco:    { hw: 2.14, hd: 0.6, h: 1.37, hp: 520, rubble: 0.7 },
    jersey:   { hw: 1.5, hd: 0.31, h: 0.81, hp: 420, rubble: 0.4 },
    hulk:     { hw: 2.36, hd: 0.92, h: 1.3, hp: 900, rubble: 0.85 },
    boulder:  { hw: 1, hd: 1, h: 1.5, hp: 1e9, rubble: 0 },
    log:      { hw: 0.5, hd: 0.5, h: 0.9, hp: 650, rubble: 0.5 },
    drywall:  { hw: 1.5, hd: 0.36, h: 1.12, hp: 300, rubble: 0.5 },
    bale:     { hw: 0.62, hd: 0.76, h: 1.5, hp: 70, rubble: 0 },
    rubble:   { hw: 1.4, hd: 1.0, h: 1.0, hp: 1e9, rubble: 0 },
  };
  function place(kind, x, z, yaw, o) {
    o = o || {};
    const C = D.ctx || {};
    const g = C.groundAt ? C.groundAt(x, z) : 0;
    const S = SPEC[kind];
    if (!S) return null;
    let P, it, hw = S.hw, hd = S.hd, h = S.h;
    if (kind === "sandbags") { P = pool("sandbags", sandbagWallGeo, "sandbags"); it = put(P, x, g - 0.04, z, yaw, 1); }
    else if (kind === "hesco") { P = pool("hesco", hescoGeo, "hesco"); it = put(P, x, g - 0.05, z, yaw, 1); }
    else if (kind === "jersey") { P = pool("jersey", jerseyGeo, "jersey"); it = put(P, x, g - 0.02, z, yaw, 1); }
    else if (kind === "hulk") {
      const v = o.v != null ? o.v : (h01(x * 10, z * 10, 3) * 3) | 0;
      P = pool("hulk" + v, function () { return hulkGeo(v); }, "hulk");
      it = put(P, x, g - 0.02, z, yaw, 1);
    } else if (kind === "boulder") {
      const v = (h01(x * 7, z * 7, 5) * 3) | 0, gr = !!C.granite, s = o.size || 1.4;
      P = pool("boulder" + v + (gr ? "g" : "s"), function () { return boulderGeo(v, gr); }, "boulder");
      // sunk a third into the ground, the way stone sits
      it = put(P, x, g + s * 0.18, z, yaw, s, s * 0.85, s * 1.1);
      hw = s * 0.82; hd = s * 0.95; h = s * 0.95;
    } else if (kind === "log") {
      const L = o.len || 8, r = o.r || 0.42, v = o.root ? 1 : 0;
      P = pool("log" + v, function () { return logGeo(v); }, "log");
      it = put(P, x, g - r * 0.35, z, yaw, L, r * 2, r * 2);
      hw = L / 2; hd = r; h = r * 1.6;
    } else if (kind === "drywall") { P = pool("drywall", wallGeo, "drywall"); it = put(P, x, g - 0.06, z, yaw, 1); }
    else if (kind === "bale") { P = pool("bale", baleGeo, "bale"); it = put(P, x, g - 0.04, z, yaw, 1); }
    else if (kind === "rubble") {
      const v = (h01(x * 3, z * 3, 9) * 2) | 0;
      P = pool("rubble" + v, function () { return rubbleGeo(v); }, "rubble");
      it = put(P, x, g - 0.1, z, yaw, 1);
    }
    D.counts[kind] = (D.counts[kind] || 0) + 1;
    const rec = CBZ.battleCover.add({
      kind: kind, x: x, z: z, yaw: yaw, hw: hw, hd: hd, h: h, hp: S.hp, rubbleH: S.rubble,
      onDestroy: function () { breakUp(P, kind, x, g, z, hw, hd, h); slump(P, it, kind); if (CBZ.battleGround && CBZ.battleGround.scorch) CBZ.battleGround.scorch(x, z, Math.max(hw, hd) * 1.6); },
    });
    D.placed.push({ kind: kind, x: x, z: z, rec: rec });
    return rec;
  }

  /* ---- WHERE THINGS GO --------------------------------------------------- */
  const taken = [];
  function free(x, z, r) {
    const C = D.ctx;
    for (let i = 0; i < taken.length; i++) {
      const t = taken[i], dx = t[0] - x, dz = t[1] - z, need = t[2] + r;
      if (dx * dx + dz * dz < need * need) return false;
    }
    if (C.blocked) {
      if (C.blocked(x, z, r)) return false;
    }
    if (C.keepOut) for (let i = 0; i < C.keepOut.length; i++) {
      const k = C.keepOut[i];
      if (Math.abs(x - k.x) < k.hx + r && Math.abs(z - k.z) < k.hz + r) return false;
    }
    return true;
  }
  function flatEnough(x, z, r, tol) {
    const g = D.ctx.groundAt;
    const a = g(x - r, z), b = g(x + r, z), c = g(x, z - r), d = g(x, z + r), m = g(x, z);
    return Math.max(a, b, c, d, m) - Math.min(a, b, c, d, m) < (tol || 0.6);
  }
  function claim(x, z, r) { taken.push([x, z, r]); }

  // a fighting position: sandbags in a U facing the enemy, or a hesco line
  // with sandbag returns. `face` is the yaw that looks at the enemy.
  function position(x, z, face, big) {
    const fx = Math.sin(face), fz = Math.cos(face);       // the facing (local +z after yaw)
    const rx = Math.cos(face), rz = -Math.sin(face);      // the right
    if (big) {
      place("hesco", x + fx * 1.2, z + fz * 1.2, face);
      place("sandbags", x + rx * 3.3 + fx * 0.2, z + rz * 3.3 + fz * 0.2, face + Math.PI / 2 - 0.35);
      place("sandbags", x - rx * 3.3 + fx * 0.2, z - rz * 3.3 + fz * 0.2, face + Math.PI / 2 + 0.35);
    } else {
      place("sandbags", x + fx * 1.0, z + fz * 1.0, face);
      place("sandbags", x + rx * 1.65 - fx * 0.05, z + rz * 1.65 - fz * 0.05, face + Math.PI / 2 - 0.25);
      place("sandbags", x - rx * 1.65 - fx * 0.05, z - rz * 1.65 - fz * 0.05, face + Math.PI / 2 + 0.25);
    }
  }
  /* CONTAINERS: the yard's own ISO boxes (yard.js containerInto), stacked
     one or two high on an apron or a quay. Steel boxes do not blow over:
     static, one merged mesh per paint, colliders and cover like the rest. */
  const contB = {};
  function containers(x, z, yaw, tiers, L) {
    const paints = CONT_PAINT;
    for (let t = 0; t < tiers; t++) {
      const hex = paints[(rnd() * paints.length) | 0];
      const B = contB[hex] || (contB[hex] = new GeoBatch());
      B.xf(x, D.ctx.groundAt(x, z) + t * CN.H, z, yaw);
      containerInto(B, L);
    }
    CBZ.battleCover.add({ kind: "container", x: x, z: z, yaw: yaw, hw: L / 2, hd: CN.W / 2, h: tiers * CN.H, hp: 1e9 });
    D.counts.container = (D.counts.container || 0) + 1;
  }
  function flushContainers() {
    if (!drawing()) return;
    Object.keys(contB).forEach(function (hex) {
      const skin = containerSkin(+hex);
      contB[hex].mesh(yardPatch(new THREE.MeshPhongMaterial({ map: skin.map, specular: 0x262626, shininess: 22 }), { mottle: 0.16, grime: 0.5 }));
      delete contB[hex];
    });
  }
  function barricade(x, z, yaw) {
    const c = Math.cos(yaw), s = -Math.sin(yaw);
    place("jersey", x - c * 1.6, z - s * 1.6, yaw + (rnd() - 0.5) * 0.08);
    place("jersey", x + c * 1.6, z + s * 1.6, yaw + (rnd() - 0.5) * 0.08);
    if (rnd() < 0.6) place("sandbags", x + c * 4.4 + Math.sin(yaw) * 0.4, z + s * 4.4 + Math.cos(yaw) * 0.4, yaw + 0.2);
  }

  /* OPEN GROUND (the erg, the fields, a raised venue's apron): clusters in
     the band between the start lines, each one a reason to be somewhere.
     Forward positions near each side's line face the other side; the middle
     gets the things a fought-over field collects — wrecks, rocks, a
     barricade across the obvious lane. */
  function open(ctx) {
    D.ctx = ctx; taken.length = 0;
    _ds = 0x5eed1 ^ ((ctx.seed || 7) * 2654435761);
    const theme = ctx.theme || "desert";
    const cx = ctx.cx, cz = ctx.cz, gap = ctx.gap;
    const half = gap / 2;
    let made = 0;
    const tryAt = function (fn, r, n, xs, zs) {
      for (let t = 0; t < n; t++) {
        const x = cx + xs(), z = cz + zs();
        if (!free(x, z, r) || !flatEnough(x, z, r * 0.7, ctx.tol || 1.2)) continue;
        claim(x, z, r);
        fn(x, z);
        made++;
        return true;
      }
      return false;
    };
    // forward positions: two to three a side, a little ahead of each line
    for (const side of [-1, 1]) {
      const face = side < 0 ? Math.PI / 2 : -Math.PI / 2;     // red (west) looks east, blue looks west
      const nPos = theme === "forest" ? 2 : 3;
      for (let k = 0; k < nPos; k++) {
        tryAt(function (x, z) { position(x, z, face, theme === "desert" && k === 0); }, 5,
          12, function () { return side * (half - 14 - rnd() * 16); }, function () { return (k - 1) * 34 + (rnd() - 0.5) * 18; });
      }
    }
    // no-man's land
    const mid = function () { return (rnd() - 0.5) * (gap - 36); };
    const wide = function () { return (rnd() - 0.5) * 220; };
    const want = ctx.density || 1;
    const set = {
      desert: [["hulk", 5], ["boulders", 6], ["sandbag", 4], ["barricade", 1]],
      snow:   [["boulders", 8], ["hulk", 2], ["sandbag", 3], ["logs", 3]],
      field:  [["bales", 5], ["hulk", 2], ["sandbag", 3], ["boulders", 2]],
      forest: [["sandbag", 2]],
      apron:  [["containers", 5], ["hulk", 4], ["barricade", 4], ["sandbag", 4], ["rubble", 2], ["hesco", 2]],
      urban:  [["hulk", 6], ["barricade", 4], ["sandbag", 3], ["rubble", 4]],
    }[theme] || [];
    set.forEach(function (row) {
      const n = Math.round(row[1] * want);
      for (let i = 0; i < n; i++) {
        const kind = row[0];
        if (kind === "hulk") tryAt(function (x, z) { place("hulk", x, z, rnd() * 6.28); }, 3.2, 10, mid, wide);
        else if (kind === "boulders") tryAt(function (x, z) {
          const m = 2 + ((rnd() * 3) | 0);
          for (let b = 0; b < m; b++) place("boulder", x + (rnd() - 0.5) * 6, z + (rnd() - 0.5) * 6, rnd() * 6.28, { size: 1.1 + rnd() * 1.4 });
        }, 5, 10, mid, wide);
        else if (kind === "sandbag") tryAt(function (x, z) {
          place("sandbags", x, z, Math.PI / 2 + (rnd() - 0.5) * 0.6);
          if (rnd() < 0.5) place("sandbags", x + (rnd() - 0.5) * 1.2, z + 2.5, Math.PI / 2 + (rnd() - 0.5) * 0.6);
        }, 3, 10, mid, wide);
        else if (kind === "barricade") tryAt(function (x, z) { barricade(x, z, Math.PI / 2 + (rnd() - 0.5) * 0.4); }, 6, 10, mid, wide);
        else if (kind === "hesco") tryAt(function (x, z) {
          place("hesco", x, z, Math.PI / 2); place("hesco", x, z + 4.4, Math.PI / 2);
        }, 6, 10, mid, wide);
        else if (kind === "rubble") tryAt(function (x, z) { place("rubble", x, z, rnd() * 6.28); }, 2.5, 10, mid, wide);
        else if (kind === "containers") tryAt(function (x, z) {
          // broadside to the fire line, a pair or a single, one or two high
          const L = rnd() < 0.6 ? 6.058 : 12.192, yaw = Math.PI / 2 + (rnd() - 0.5) * 0.1;
          containers(x, z, yaw, rnd() < 0.35 ? 2 : 1, L);
          if (rnd() < 0.4) containers(x + CN.W + 0.3, z + (rnd() - 0.5) * 2, yaw, 1, L);
        }, 7.5, 12, mid, wide);
        else if (kind === "logs") tryAt(function (x, z) { place("log", x, z, rnd() * 6.28, { len: 6 + rnd() * 5, r: 0.3 + rnd() * 0.15 }); }, 6, 10, mid, wide);
        else if (kind === "bales") tryAt(function (x, z) {
          const m = 2 + ((rnd() * 4) | 0), yaw = rnd() * 6.28;
          for (let b = 0; b < m; b++) place("bale", x + Math.cos(yaw) * b * 1.35, z - Math.sin(yaw) * b * 1.35, yaw + (rnd() - 0.5) * 0.2);
        }, 4, 10, mid, wide);
      }
    });
    return made;
  }

  /* THE DOWNTOWN. Cover follows the street: burnt cars along the kerbs,
     a barricade across some of the avenues the armies come down, sandbag
     nests at junction corners, and rubble where a facade came down. Each
     is tested against the real buildings (blocked) so nothing stands in a
     wall. `roads` are the town's own records: {x, z, len, w, vertical}. */
  function city(ctx) {
    D.ctx = ctx; taken.length = 0;
    _ds = 0xc17 ^ ((ctx.seed || 3) * 2654435761);
    const roads = ctx.roads || [];
    const R = ctx.reach || 260;
    let made = 0;
    roads.forEach(function (rd, ri) {
      if (Math.abs(rd.x - ctx.cx) > R || Math.abs(rd.z - ctx.cz) > R) return;
      // along the street (ax, az) and across it (az, ax)
      const ax = rd.vertical ? 0 : 1, az = rd.vertical ? 1 : 0;
      const carYaw = rd.vertical ? Math.PI / 2 : 0, acrossYaw = rd.vertical ? 0 : Math.PI / 2;
      const kerb = (rd.w || 14) / 2 - 1.3;
      const len = rd.len || 40;
      const at = function (s, off) { return [rd.x + ax * s + az * off, rd.z + az * s + ax * off]; };
      // cars along both kerbs
      for (let s = -len / 2 + 6; s < len / 2 - 6; s += 9 + rnd() * 14) {
        if (rnd() < 0.45) continue;
        const side = rnd() < 0.5 ? -1 : 1;
        const p = at(s, side * kerb);
        if (!free(p[0], p[1], 2.6)) continue;
        claim(p[0], p[1], 2.6);
        place("hulk", p[0], p[1], carYaw + (side > 0 ? Math.PI : 0) + (rnd() - 0.5) * 0.35);
        made++;
      }
      // a barricade across the street, leaving a lane open on one side
      if (rnd() < 0.45) {
        const s = (rnd() - 0.5) * len * 0.5;
        const p = at(s, (rnd() < 0.5 ? -1 : 1) * (rd.w || 14) * 0.18);
        if (free(p[0], p[1], 5)) { claim(p[0], p[1], 5); barricade(p[0], p[1], acrossYaw); made++; }
      }
      // rubble off a facade at the kerb line
      if (rnd() < 0.35) {
        const p = at((rnd() - 0.5) * len * 0.8, (rnd() < 0.5 ? -1 : 1) * ((rd.w || 14) / 2 + 1.5));
        if (free(p[0], p[1], 2)) { claim(p[0], p[1], 2); place("rubble", p[0], p[1], rnd() * 6.28); made++; }
      }
      void ri;
    });
    // nests at junctions near the middle
    for (let k = 0; k < 6; k++) {
      const x = ctx.cx + (rnd() - 0.5) * ctx.gap * 0.8, z = ctx.cz + (rnd() - 0.5) * 180;
      let best = null, bd = 1e9;
      roads.forEach(function (rd) {
        const d = Math.hypot(rd.x - x, rd.z - z);
        if (d < bd) { bd = d; best = rd; }
      });
      if (!best) break;
      const px = best.vertical ? best.x + (rnd() < 0.5 ? -1 : 1) * ((best.w || 14) / 2 - 2) : x;
      const pz = best.vertical ? z : best.z + (rnd() < 0.5 ? -1 : 1) * ((best.w || 14) / 2 - 2);
      if (!free(px, pz, 4)) continue;
      claim(px, pz, 4);
      position(px, pz, px < ctx.cx ? Math.PI / 2 : -Math.PI / 2, false);
      made++;
    }
    return made;
  }

  return {
    begin: function (ctx) { D.ctx = ctx; D.placed.length = 0; taken.length = 0; D.counts = {}; Object.keys(D.pools).forEach(function (k) { delete D.pools[k]; }); },
    place: place, flush: flush, open: open, city: city,
    claim: claim, free: function (x, z, r) { return free(x, z, r); },
    geo: { log: logGeo, boulder: boulderGeo, hulk: hulkGeo, sandbags: sandbagWallGeo },
    material: matFor,
    stats: function () { return Object.assign({ placed: D.placed.length }, D.counts); },
  };
})();
