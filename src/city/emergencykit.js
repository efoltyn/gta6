/* ============================================================
   city/emergencykit.js — THE EMERGENCY FLEET, built like real ones.

   OWNER: the emergency vehicles were bad. They were: an ambulance and a fire
   engine stacked out of ~60 scaled unit cubes each in traffic.js (a 5.4 m
   "van" with a red cross made of two slabs), a police "car" that was the
   4.69 m Model-3 saloon with a trapezoid on the roof, and a SWAT "van" that
   was the cargo van with five black slabs glued to its flanks.

   WHAT THIS FILE IS. Every emergency vehicle as a first-class car body on
   the shared kit (CBZ.cityCarKit = playercars.js's materials, lofted shells,
   hinged doors, the ONE cabin solver, real wheels), at real proportions,
   with liveries drawn ONCE on a canvas and laid on the body, and ONE light
   rig whose two flash phases are the meshes city/police.js already flips by
   name (police_lightbar / lb_red / lb_blue / lb_mid). Nothing here drives,
   dispatches or flashes on a timer: traffic.js, police.js and medics.js keep
   their jobs and ask this file for the body.

     interceptor  2020+ Police Interceptor Utility (Explorer)   loft row, playercars BODY
     pursuit      Charger Pursuit                               loft row, playercars BODY
       -> livery: policeLivery() (model.livery "police", via carparts)
     ambulance    Type III: E-450 cutaway cab + 14 ft box module  builder here
     firetruck    custom-cab pumper (Enforcer class)            builder here
     bearcat      armoured rescue truck (BearCat G3 class)      builder here
       -> registered as CBZ.carStyleBuilders[style]; playercars.js's
          makeProcedural builds them like any other style, vehicles.js
          merges, bakes the doors, LODs and instances them like any car.

   THE NUMBERS (researched 2026-10-19, metres; sources in the commit):
     Police Interceptor Utility 2020+   L 5.05  W 2.00  H 1.76  WB 3.025
                                        255/60R18 -> tyre 0.76 m
     Charger Pursuit 2015-2023          L 5.04  W 1.905 H 1.48  WB 3.05
                                        225/60R18 -> tyre 0.73 m
     Type III ambulance, E-450 158" WB  module 4.27 L x 2.44 W, overall
                                        H 2.74, overall L ~7.0, WB 4.01,
                                        LT225/75R16 duals -> tyre 0.75 m
     Custom-cab pumper (Enforcer)       L 9.0-9.4  W 2.54  H 2.8-3.0,
                                        WB 4.46-5.0, 315/80R22.5 -> 1.08 m
     Armoured rescue truck (G3)         L 6.59  W 2.6  H 2.82, F-550 class
                                        chassis WB ~4.2, 37 in tyres -> 0.94 m

   THE LIGHT RIG. One Group named "police_lightbar" per vehicle holds:
     lb_base  the housings (dark)                     always drawn
     lb_dimR/lb_dimB/lb_dimW/lb_dimA  unlit lenses     always drawn
     lb_red   phase A lit heads                       flipped by police.js
     lb_blue  phase B lit heads (red on fire/EMS)     flipped by police.js
     lb_mid   white takedowns / pops                  flipped by the flasher
   so a car on routine patrol reads as an unlit LED bar (tinted lenses), not
   a black slab, and a responding unit flashes with zero material swaps.
   Each layer is ONE merged mesh, so the whole rig is <= 8 draws.

   DECALS. Canvas-drawn once per design, shared material, alphaTest edges.
   On a lofted body (the cruisers, the ambulance cab) a decal is a COPY of
   the skin's own triangles in its rectangle, lifted 4 mm along their normal
   and UV-mapped by projection (skinDecal) — so "POLICE" wraps the door's
   curve instead of floating off it, and rides inside the door group so it
   swings open with the door. On the boxy bodies it is a flat plane.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ, THREE = window.THREE;
  if (!CBZ || !THREE) return;

  const kit = () => CBZ.cityCarKit;
  const parts = () => CBZ.carParts;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const ONE = new THREE.Vector3(1, 1, 1);

  /* ============================================================
     GEOMETRY
  ============================================================ */
  const geoCache = new Map();
  function cached(key, fn) {
    let g = geoCache.get(key);
    if (!g) { g = fn(); g._shared = true; geoCache.set(key, g); }
    return g;
  }
  const k3 = (a) => a.map((v) => (+v).toFixed(3)).join("|");
  /* ROUNDED BOX. A 3x3x3-segment box whose inner rings are moved to sit `r`
     in from every edge, then every vertex outside the inner core is pushed
     onto the rounding: flat faces stay flat, every edge and corner turns
     through a 45-degree facet with smooth normals — a radiused extrusion,
     not a brick, for ~108 triangles. */
  function rbGeo(w, h, d, r) {
    return cached("rb|" + k3([w, h, d, r]), function () {
      r = Math.max(0.002, Math.min(r, w * 0.45, h * 0.45, d * 0.45));
      const g = new THREE.BoxGeometry(1, 1, 1, 3, 3, 3).toNonIndexed();
      const P = g.attributes.position, N = g.attributes.normal;
      const H = [w / 2, h / 2, d / 2], I = [w / 2 - r, h / 2 - r, d / 2 - r];
      const map = (c, ax) => {
        const a = Math.abs(c), s = c < 0 ? -1 : 1;
        return s * (a > 0.4 ? H[ax] : a > 0.1 ? I[ax] : 0);
      };
      for (let i = 0; i < P.count; i++) {
        const x = map(P.getX(i), 0), y = map(P.getY(i), 1), z = map(P.getZ(i), 2);
        const cx = clamp(x, -I[0], I[0]), cy = clamp(y, -I[1], I[1]), cz = clamp(z, -I[2], I[2]);
        let nx = x - cx, ny = y - cy, nz = z - cz;
        const l = Math.hypot(nx, ny, nz);
        if (l > 1e-6) {
          nx /= l; ny /= l; nz /= l;
          P.setXYZ(i, cx + nx * r, cy + ny * r, cz + nz * r);
          N.setXYZ(i, nx, ny, nz);
        } else P.setXYZ(i, x, y, z);
      }
      g.computeBoundingSphere();
      return g;
    });
  }
  function boxGeo(w, h, d) { return cached("bx|" + k3([w, h, d]), () => new THREE.BoxGeometry(w, h, d)); }
  // cylinder along local Y; `open` leaves the caps off; theta for a part ring
  function cylGeo(rt, rb, h, seg, open, t0, tl) {
    return cached("cy|" + k3([rt, rb, h, seg || 16, open ? 1 : 0, t0 || 0, tl == null ? 6.2832 : tl]),
      () => new THREE.CylinderGeometry(rt, rb, h, seg || 16, 1, !!open, t0 || 0, tl == null ? Math.PI * 2 : tl));
  }
  function torusGeo(R, r, arc) { return cached("to|" + k3([R, r, arc]), () => new THREE.TorusGeometry(R, r, 6, 20, arc)); }
  function planeGeo(w, h) { return cached("pl|" + k3([w, h]), () => new THREE.PlaneGeometry(w, h)); }

  function put(root, geo, mat, x, y, z, rx, ry, rz) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.castShadow = false;
    m.userData.noSeal = true;            // authored exact: vehicles.js's hole-proofing must not inflate it
    root.add(m);
    return m;
  }
  // a rounded box from its min/max corners (most of the bodies are laid out this way)
  function RB(root, mat, x0, x1, y0, y1, z0, z1, r) {
    const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0), d = Math.abs(z1 - z0);
    return put(root, rbGeo(w, h, d, r == null ? 0.02 : r), mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  }
  function BX(root, mat, x0, x1, y0, y1, z0, z1) {
    return put(root, boxGeo(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)), mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  }
  // both sides at once: f(s) with s = +1 (left, +x) and -1 (right, -x)
  const sides = (f) => { f(1); f(-1); };
  // cylinder pointing along an axis
  function CYL(root, mat, r, len, x, y, z, axis, seg, rb) {
    const g = cylGeo(r, rb == null ? r : rb, len, seg || 16);
    if (axis === "x") return put(root, g, mat, x, y, z, 0, 0, Math.PI / 2);
    if (axis === "z") return put(root, g, mat, x, y, z, Math.PI / 2, 0, 0);
    return put(root, g, mat, x, y, z);
  }
  // a wheel-well liner: an open half drum over the tyre, inside the body side
  function wellLiner(root, x, y, z, r, depth) {
    put(root, cylGeo(r, r, depth, 18, true, -Math.PI / 2, Math.PI), M.well(), x, y, z, 0, 0, Math.PI / 2);
  }
  // a fender crown: half a torus hugging the well opening on the skin
  function fenderCrown(root, mat, x, y, z, R, tube) {
    put(root, torusGeo(R, tube, Math.PI), mat, x, y, z, 0, Math.PI / 2, 0);
  }

  function mergeGeos(items) {
    let n = 0;
    const src = items.map(function (it) {
      const g = it.geo.index ? it.geo.toNonIndexed() : it.geo;
      n += g.attributes.position.count;
      return [g, it.m];
    });
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    const v = new THREE.Vector3(), nm = new THREE.Matrix3();
    let o = 0;
    src.forEach(function (gm) {
      const g = gm[0], M4 = gm[1], P = g.attributes.position, N = g.attributes.normal;
      nm.getNormalMatrix(M4);
      for (let i = 0; i < P.count; i++, o += 3) {
        v.set(P.getX(i), P.getY(i), P.getZ(i)).applyMatrix4(M4);
        pos[o] = v.x; pos[o + 1] = v.y; pos[o + 2] = v.z;
        if (N) {
          v.set(N.getX(i), N.getY(i), N.getZ(i)).applyMatrix3(nm).normalize();
          nor[o] = v.x; nor[o + 1] = v.y; nor[o + 2] = v.z;
        }
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    geo.computeBoundingSphere();
    geo._shared = true;
    return geo;
  }

  /* ============================================================
     MATERIALS — through the kit (carfx roles) so the fleet shares one
     material family; the colours here that matter are the livery's.
  ============================================================ */
  const matCache = new Map();
  function once(key, fn) {
    let m = matCache.get(key);
    if (!m) { m = fn(); m._shared = true; matCache.set(key, m); }
    return m;
  }
  // a coloured standard material with the env reflection (carfx's generic role)
  const coat = (key, col, metal, rough) => kit().roleMat("emg-" + key, "coat", col, { metalness: metal, roughness: rough });
  // a fleet livery paint that a respray must NOT touch (not _bodyPaint)
  function liveryPaint(key, col) {
    return once("lp-" + key, function () {
      const m = kit().vmat("paint", col, { metalness: 0.28, roughness: 0.4 });
      if (m.flatShading) { m.flatShading = false; m.needsUpdate = true; }
      m._bodyPaint = false;
      return m;
    });
  }
  const basic = (key, col) => once("bs-" + key, () => new THREE.MeshBasicMaterial({ color: col }));
  // emissive lens tints: red emissive stays UNDER vehicles.js's tail-lamp
  // detector (r > 0.78) so a dark beacon is never mistaken for a brake lamp
  const lens = (key, col, em) => once("ln-" + key, () => new THREE.MeshLambertMaterial({ color: col, emissive: em, emissiveIntensity: 1 }));
  const M = {
    dark: () => kit().roleMat("body-trim", "plastic", 0x14171c),
    chrome: () => kit().chromeMat(),
    glass: () => kit().glassMat(),
    head: () => kit().lightFrontMat(),
    tail: () => kit().lightTailMat(),
    white: () => liveryPaint("white", 0xf1f3f5),
    red: () => liveryPaint("red", 0xc0141c),
    alu: () => coat("alu", 0xbfc4ca, 0.85, 0.36),
    plate: () => coat("diamond", 0x9ea4ab, 0.9, 0.5),
    steel: () => coat("steel", 0x1d2024, 0.35, 0.62),
    tint: () => coat("tint", 0x0b1016, 0.5, 0.12),       // a window onto a closed volume: dark, glossy, opaque
    rubber: () => coat("rubber", 0x121315, 0.0, 0.9),
    amber: () => kit().sharedMat("emg-amber", 0xffb347, { emissive: 0xffa028, ei: 0.7 }),
    rev: () => kit().sharedMat("emg-rev", 0xe8ecf0, { emissive: 0x30343a, ei: 0.35 }),
    well: () => kit().sharedMat("emg-well", 0x0b0c0e, { double: true }),
    ceil: () => kit().sharedMat("emg-ceil", 0xf4f6f8, { emissive: 0xdfe6ee, ei: 0.85 }),
    vinyl: () => coat("vinyl", 0x5c636b, 0.0, 0.7),
    cushion: () => coat("cushion", 0x1f3f78, 0.0, 0.6),
    cab: () => coat("cabinet", 0xe9ecef, 0.1, 0.45),
    dimR: () => lens("r", 0x4a080c, 0x3a0408),
    dimB: () => lens("b", 0x0a1440, 0x040a30),
    dimW: () => lens("w", 0x7d858e, 0x1c2026),
    dimA: () => lens("a", 0x6a3c06, 0x3a2004),
    litR: () => basic("litR", 0xff2a33),
    litB: () => basic("litB", 0x2f63ff),
    litR2: () => basic("litR2", 0xff2a33),
    litW: () => basic("litW", 0xf2f6ff),
  };

  /* ============================================================
     CANVAS DECALS — drawn once, one shared material each.
  ============================================================ */
  const decals = new Map();
  function decalMat(key, W, H, draw) {
    if (decals.has(key)) return decals.get(key);
    let m = null;
    try {
      if (typeof document !== "undefined" && THREE.CanvasTexture) {
        const cv = document.createElement("canvas");
        cv.width = W; cv.height = H;
        const c = cv.getContext("2d");
        if (c && c.fillText) {
          draw(c, W, H);
          const tex = new THREE.CanvasTexture(cv);
          if (THREE.sRGBEncoding != null) tex.encoding = THREE.sRGBEncoding;
          tex.anisotropy = 4;
          m = new THREE.MeshLambertMaterial({
            map: tex, emissiveMap: tex, emissive: 0x262626, emissiveIntensity: 1,
            alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
          });
          m._shared = true;
        }
      }
    } catch (e) { m = null; }
    decals.set(key, m);
    return m;
  }
  const FONT = "Arial Black, Arial, Helvetica, sans-serif";
  function fitText(c, text, x, y, maxW, px, fill, opts) {
    opts = opts || {};
    let size = px;
    c.font = (opts.weight || "900") + " " + size + "px " + FONT;
    const w0 = c.measureText(text).width;
    if (w0 > maxW) { size = Math.floor(px * maxW / w0); c.font = (opts.weight || "900") + " " + size + "px " + FONT; }
    c.textAlign = opts.align || "center"; c.textBaseline = "middle";
    if (opts.stroke) { c.lineWidth = opts.strokeW || Math.max(2, size * 0.08); c.strokeStyle = opts.stroke; c.lineJoin = "round"; c.strokeText(text, x, y); }
    c.fillStyle = fill;
    c.fillText(text, x, y);
  }
  function star(c, cx, cy, ro, ri, n, rot) {
    c.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const a = rot + i * Math.PI / n, r = i & 1 ? ri : ro;
      c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    c.closePath();
  }
  const D = {
    // front doors of a cruiser: a gold seven-point badge and the word, black on the white door
    policeDoor: () => decalMat("policeDoor", 512, 160, function (c, W, H) {
      c.fillStyle = "#c9a227"; star(c, 78, 80, 66, 34, 7, -Math.PI / 2); c.fill();
      c.lineWidth = 4; c.strokeStyle = "#1a1a1a"; c.stroke();
      c.beginPath(); c.arc(78, 80, 26, 0, Math.PI * 2); c.fillStyle = "#1b2a5a"; c.fill();
      c.lineWidth = 3; c.strokeStyle = "#c9a227"; c.stroke();
      fitText(c, "POLICE", 318, 84, 350, 118, "#111215");
    }),
    // the word alone, for a tailgate or a dark panel
    word: (txt, fill, stroke) => decalMat("word|" + txt + "|" + fill + "|" + (stroke || ""), 512, 112, function (c, W, H) {
      fitText(c, txt, W / 2, H / 2 + 4, W - 24, 96, fill, stroke ? { stroke: stroke, strokeW: 6 } : null);
    }),
    // a wide word (side of a box body)
    wide: (txt, fill, stroke, mirror) => decalMat("wide|" + txt + "|" + fill + "|" + (stroke || "") + (mirror ? "|m" : ""), 1024, 160, function (c, W, H) {
      if (mirror) { c.translate(W, 0); c.scale(-1, 1); }
      fitText(c, txt, W / 2, H / 2 + 6, W - 40, 140, fill, stroke ? { stroke: stroke, strokeW: 8 } : null);
    }),
    // unit number: big digits for a roof or a quarter panel
    unit: (txt, fill) => decalMat("unit|" + txt + "|" + fill, 256, 128, function (c, W, H) {
      fitText(c, txt, W / 2, H / 2 + 6, W - 16, 118, fill);
    }),
    // THE STAR OF LIFE: a blue six-armed star, white-edged, the staff and serpent in white
    starOfLife: () => decalMat("starOfLife", 256, 256, function (c, W, H) {
      const cx = W / 2, cy = H / 2, L = 108, B = 22;
      c.save(); c.translate(cx, cy);
      for (let pass = 0; pass < 2; pass++) {
        c.fillStyle = pass ? "#1f4ea8" : "#ffffff";
        const e = pass ? 0 : 8;
        for (let i = 0; i < 3; i++) {
          c.save(); c.rotate(i * Math.PI / 3);
          c.fillRect(-B - e, -L - e, (B + e) * 2, (L + e) * 2);
          c.restore();
        }
      }
      c.fillStyle = "#ffffff";
      c.fillRect(-5, -86, 10, 172);                       // the staff
      c.lineWidth = 9; c.strokeStyle = "#ffffff"; c.beginPath();
      for (let t = 0; t <= 1.0001; t += 0.02) {           // the serpent
        const y = -70 + t * 140, x = Math.sin(t * Math.PI * 3.2) * 18;
        if (t === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
      c.beginPath(); c.arc(Math.sin(0) * 18 + 2, -74, 9, 0, Math.PI * 2); c.fill();
      c.restore();
    }),
    // REAR CHEVRONS (NFPA 1901/1917): alternating red and fluorescent
    // yellow-green, 6 in bands sloping down and away from the centre at 45 deg
    chevL: () => chevron("chevL", -1),
    chevR: () => chevron("chevR", 1),
    // a solid band (stripes laid on a curved cab), transparent rim so a clamped
    // UV off the rectangle draws nothing
    band: (col) => decalMat("band|" + col, 64, 16, function (c, W, H) { c.fillStyle = col; c.fillRect(1, 1, W - 2, H - 2); }),
    // reflective fire-service stripe: white with gold pinstripes
    fireStripe: () => decalMat("fireStripe", 256, 32, function (c, W, H) {
      c.fillStyle = "#f4f2ea"; c.fillRect(1, 5, W - 2, H - 10);
      c.fillStyle = "#c9a227"; c.fillRect(1, 1, W - 2, 3); c.fillRect(1, H - 4, W - 2, 3);
    }),
    // the fire-department door emblem: a gold Maltese cross and the name
    fireDoor: () => decalMat("fireDoor", 512, 256, function (c, W, H) {
      const cx = 118, cy = 128, R = 96;
      c.save(); c.translate(cx, cy);
      c.fillStyle = "#c9a227"; c.strokeStyle = "#2a1a05"; c.lineWidth = 5;
      c.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2;
        const p = (r, da) => [Math.cos(a + da) * r, Math.sin(a + da) * r];
        const pts = [p(18, -0.75), p(R, -0.42), p(R * 0.78, 0), p(R, 0.42), p(18, 0.75)];
        pts.forEach(function (q, j) { if (i === 0 && j === 0) c.moveTo(q[0], q[1]); else c.lineTo(q[0], q[1]); });
      }
      c.closePath(); c.fill(); c.stroke();
      c.beginPath(); c.arc(0, 0, 36, 0, Math.PI * 2); c.fillStyle = "#a3121a"; c.fill(); c.stroke();
      c.restore();
      fitText(c, "FIRE", 360, 92, 270, 96, "#d8b441", { stroke: "#2a1a05", strokeW: 6 });
      fitText(c, "DEPT", 360, 180, 270, 96, "#d8b441", { stroke: "#2a1a05", strokeW: 6 });
    }),
    // brushed aluminium roll-up door: slats with a shadow line and a highlight
    rollup: () => decalMat("rollup", 128, 256, function (c, W, H) {
      c.fillStyle = "#b9bfc6"; c.fillRect(0, 0, W, H);
      for (let y = 0; y < H; y += 10) {
        c.fillStyle = "#8e959d"; c.fillRect(0, y, W, 2);
        c.fillStyle = "#d5dade"; c.fillRect(0, y + 2, W, 1);
      }
      c.fillStyle = "#6c737b"; c.fillRect(0, H - 14, W, 14);           // bottom rail
    }),
    // the pump operator's panel: stainless with colour-coded discharge tags and gauges
    pump: () => decalMat("pump", 256, 512, function (c, W, H) {
      c.fillStyle = "#c3c8ce"; c.fillRect(0, 0, W, H);
      for (let x = 0; x < W; x += 3) { c.fillStyle = x % 6 ? "#bcc1c7" : "#cbd0d5"; c.fillRect(x, 0, 1, H); }
      c.strokeStyle = "#7f868e"; c.lineWidth = 4; c.strokeRect(6, 6, W - 12, H - 12);
      const gauge = (x, y, r) => {
        c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fillStyle = "#f6f6f2"; c.fill();
        c.lineWidth = 3; c.strokeStyle = "#2c2f33"; c.stroke();
        for (let i = 0; i <= 10; i++) { const a = Math.PI * (0.75 + i * 0.15); c.beginPath(); c.moveTo(x + Math.cos(a) * r * 0.78, y + Math.sin(a) * r * 0.78); c.lineTo(x + Math.cos(a) * r * 0.95, y + Math.sin(a) * r * 0.95); c.stroke(); }
        c.strokeStyle = "#b51d1d"; c.beginPath(); c.moveTo(x, y); c.lineTo(x + r * 0.6, y - r * 0.4); c.stroke();
      };
      gauge(84, 92, 50); gauge(172, 92, 50);
      gauge(60, 190, 26); gauge(128, 190, 26); gauge(196, 190, 26);
      ["#c22b2b", "#2a5bc2", "#e3c21c", "#2e9a4a", "#f2f2f2"].forEach(function (col, i) {
        c.fillStyle = col; c.fillRect(30 + (i % 3) * 70, 250 + ((i / 3) | 0) * 46, 56, 24);
      });
      c.fillStyle = "#30353b"; c.fillRect(20, 360, W - 40, 6);
    }),
  };
  function chevron(key, dir) {
    return decalMat(key, 256, 256, function (c, W, H) {
      c.save();
      c.beginPath(); c.rect(1, 1, W - 2, H - 2); c.clip();
      c.fillStyle = "#c8102e"; c.fillRect(0, 0, W, H);
      c.fillStyle = "#d9ff2e";
      c.translate(W / 2, H / 2); c.rotate(dir * Math.PI / 4);
      for (let x = -W; x < W; x += 72) c.fillRect(x, -H, 36, H * 2);
      c.restore();
    });
  }

  /* A FLAT DECAL on a flat panel. `face` is the way it looks: "+x"/"-x"
     (a side, text reading nose->tail on the left side and tail->nose on
     the right, as a person standing there reads it), "+z" (the nose),
     "-z" (the tail), "+y" (the roof, the top of the text toward the nose). */
  function flatDecal(root, mat, w, h, x, y, z, face) {
    if (!mat) return null;
    const g = planeGeo(w, h);
    const r = face === "+x" ? [0, Math.PI / 2, 0] : face === "-x" ? [0, -Math.PI / 2, 0]
      : face === "-z" ? [0, Math.PI, 0] : face === "+y" ? [-Math.PI / 2, 0, Math.PI] : [0, 0, 0];
    return put(root, g, mat, x, y, z, r[0], r[1], r[2]);
  }

  /* A SKIN DECAL: the triangles of `geo` (any mesh's own geometry, in that
     mesh's frame) that face `axis`*`sign` and overlap the rectangle, copied,
     lifted `lift` metres along their normal and UV-mapped by projection.
     U runs u0 -> u1 along the first in-plane axis, V v0 -> v1 along the
     second (x: z then y; z: x then y; y: x then z). Cached per (geometry,
     rectangle), so every car of a style shares one decal geometry. */
  const skinCache = new Map();
  function skinDecal(geo, o) {
    if (!geo || !geo.attributes || !geo.attributes.position) return null;
    const key = geo.uuid + "|" + o.axis + o.sign + "|" + k3([o.u0, o.u1, o.v0, o.v1, o.lift || 0.004]);
    if (skinCache.has(key)) return skinCache.get(key);
    const src = geo.index ? geo.toNonIndexed() : geo;
    const P = src.attributes.position, N = src.attributes.normal;
    const A = o.axis === "x" ? 0 : o.axis === "y" ? 1 : 2;
    const U = o.axis === "x" ? 2 : 0, V = o.axis === "y" ? 2 : 1;
    const lift = o.lift || 0.004;
    const pos = [], nor = [], uv = [];
    const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
    const get = (i, out) => { out[0] = P.getX(i); out[1] = P.getY(i); out[2] = P.getZ(i); return out; };
    for (let i = 0; i + 2 < P.count; i += 3) {
      get(i, a); get(i + 1, b); get(i + 2, c);
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz);
      if (l < 1e-9) continue;
      nx /= l; ny /= l; nz /= l;
      const nA = A === 0 ? nx : A === 1 ? ny : nz;
      if (nA * o.sign < 0.35) continue;
      const tri = [a, b, c];
      let allLoU = true, allHiU = true, allLoV = true, allHiV = true;
      const uvs = tri.map(function (p) {
        const u = (p[U] - o.u0) / (o.u1 - o.u0), v = (p[V] - o.v0) / (o.v1 - o.v0);
        if (u > 0) allLoU = false; if (u < 1) allHiU = false;
        if (v > 0) allLoV = false; if (v < 1) allHiV = false;
        return [u, v];
      });
      if (allLoU || allHiU || allLoV || allHiV) continue;
      for (let k = 0; k < 3; k++) {
        const p = tri[k], vi = i + k;
        let qx = nx, qy = ny, qz = nz;
        if (N) { qx = N.getX(vi); qy = N.getY(vi); qz = N.getZ(vi); }
        pos.push(p[0] + nx * lift, p[1] + ny * lift, p[2] + nz * lift);
        nor.push(qx, qy, qz);
        uv.push(uvs[k][0], uvs[k][1]);
      }
    }
    let out = null;
    if (pos.length) {
      out = new THREE.BufferGeometry();
      out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
      out.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      out.computeBoundingSphere();
      out._shared = true;
    }
    if (src !== geo) src.dispose();
    skinCache.set(key, out);
    return out;
  }
  function addSkinDecal(parent, geo, mat, o) {
    if (!mat) return null;
    const g = skinDecal(geo, o);
    return g ? put(parent, g, mat, 0, 0, 0) : null;
  }
  // the paint mesh of a loft body zone ("body" / "upper") or of a door group
  function zoneMesh(root, zone) {
    for (let i = 0; i < root.children.length; i++) {
      const o = root.children[i];
      if (o.geometry && o.userData && o.userData.paintZone === zone) return o;
    }
    return null;
  }
  function doorGroups(root) {
    const out = [];
    for (let i = 0; i < root.children.length; i++) { const o = root.children[i]; if (o.userData && o.userData.carDoor) out.push(o); }
    return out;
  }
  // a decal on a loft door, in the door's own frame (it swings with the leaf).
  // fz0/fz1 are fractions of the door length from its FRONT edge, y0/y1 metres
  function doorDecal(door, mat, fz0, fz1, y0, y1) {
    const d = door.userData.carDoor, pm = zoneMesh(door, "door");
    if (!pm || !mat) return null;
    const zf = d.z1 - d.len * fz0 - d.hz, zb = d.z1 - d.len * fz1 - d.hz;
    return addSkinDecal(door, pm.geometry, mat, {
      axis: "x", sign: d.side, u0: d.side > 0 ? zf : zb, u1: d.side > 0 ? zb : zf, v0: y0, v1: y1,
    });
  }
  // a decal on a loft body side (car frame): zf/zb front/back of the rectangle
  function sideDecal(root, zone, mat, side, zf, zb, y0, y1) {
    const m = zoneMesh(root, zone);
    if (!m || !mat) return null;
    return addSkinDecal(root, m.geometry, mat, { axis: "x", sign: side, u0: side > 0 ? zf : zb, u1: side > 0 ? zb : zf, v0: y0, v1: y1 });
  }

  /* ============================================================
     THE LIGHT RIG
  ============================================================ */
  const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3();
  function Rig(phaseBRed) { this.k = {}; this.bRed = !!phaseBRed; }
  Rig.prototype.push = function (kind, geo, x, y, z, ry) {
    _e.set(0, ry || 0, 0); _q.setFromEuler(_e); _p.set(x, y, z);
    (this.k[kind] || (this.k[kind] = [])).push({ geo: geo, m: new THREE.Matrix4().compose(_p, _q, ONE) });
  };
  // the lit layer a colour/phase goes to: A -> lb_red, B -> lb_blue, W -> lb_mid
  const LIT = { A: "red", B: "blue", W: "mid" };
  const DIM = { r: "dimR", b: "dimB", w: "dimW", a: "dimA" };
  /* A LAMP HEAD on a surface, facing `ry` (0 = +z): a housing, a tinted lens
     and the lit overlay a few mm over it. col r/b/w/a, phase A/B/W or null
     (an unlit lamp: scene light, marker). */
  Rig.prototype.lamp = function (col, phase, x, y, z, w, h, ry, housing) {
    const s = Math.sin(ry || 0), c = Math.cos(ry || 0);
    const at = (d) => [x + s * d, z + c * d];
    if (housing !== false) { const p = at(-0.01); this.push("base", rbGeo(w + 0.035, h + 0.035, 0.05, 0.012), p[0], y, p[1], ry); }
    const p1 = at(0.018);
    this.push(DIM[col], rbGeo(w, h, 0.02, Math.min(w, h) * 0.2), p1[0], y, p1[1], ry);
    if (phase) { const p2 = at(0.024); this.push(LIT[phase], rbGeo(w + 0.006, h + 0.006, 0.02, Math.min(w, h) * 0.2), p2[0], y, p2[1], ry); }
  };
  // a bar module, visible from every side (sits in a roof bar's housing)
  Rig.prototype.module = function (col, phase, x, y, z, w, h, d) {
    this.push(DIM[col], rbGeo(w, h, d, 0.008), x, y, z, 0);
    if (phase) this.push(LIT[phase], rbGeo(w + 0.008, h + 0.006, d + 0.008, 0.008), x, y + 0.001, z, 0);
  };
  /* A LOW-PROFILE LED BAR (Liberty/Legacy class) centred at (x, y0 = its
     foot, z): `len` long, 0.30 deep, modules coloured by `scheme(i, n, x)`
     -> [col, phase]. Two end-cap alley lights (white, W). */
  Rig.prototype.bar = function (x, y0, z, len, scheme, opt) {
    opt = opt || {};
    const d = opt.depth || 0.30, h = opt.h || 0.075, yb = y0 + (opt.feet || 0.03);
    this.push("base", rbGeo(len, 0.03, d, 0.014), x, yb + 0.015, z, 0);
    this.push("base", rbGeo(len, h * 0.5, d * 0.92, 0.02), x, yb + h * 0.55, z, 0);
    if (opt.feet !== 0) [-1, 1].forEach((s) => this.push("base", boxGeo(0.06, (opt.feet || 0.03) + 0.01, d * 0.6), x + s * len * 0.38, y0 + (opt.feet || 0.03) / 2, z, 0));
    const n = opt.n || 10, mw = (len - 0.12) / n;
    for (let i = 0; i < n; i++) {
      const mx = x - len / 2 + 0.06 + mw * (i + 0.5);
      const sc = scheme(i, n, mx - x);
      this.module(sc[0], sc[1], mx, yb + h * 0.62, z, mw - 0.012, h * 0.62, d - 0.06);
    }
    if (opt.alley !== false) [-1, 1].forEach((s) => this.lamp("w", null, x + s * (len / 2 + 0.005), yb + h * 0.6, z, 0.12, h * 0.5, s * Math.PI / 2, false));
  };
  const RIG_MAT = {
    base: () => M.dark(), dimR: () => M.dimR(), dimB: () => M.dimB(), dimW: () => M.dimW(), dimA: () => M.dimA(),
    red: () => M.litR(), mid: () => M.litW(),
  };
  // the built group's geometries, cached per key so every clone shares them
  const rigGeos = new Map();
  Rig.prototype.group = function (key) {
    let gs = key ? rigGeos.get(key) : null;
    if (!gs) {
      gs = {};
      for (const kind in this.k) gs[kind] = mergeGeos(this.k[kind]);
      if (key) rigGeos.set(key, gs);
    }
    return rigGroup(gs, this.bRed);
  };
  function rigGroup(gs, bRed) {
    const g = new THREE.Group();
    g.name = "police_lightbar";
    for (const kind in gs) {
      const mat = kind === "blue" ? (bRed ? M.litR2() : M.litB()) : RIG_MAT[kind]();
      const m = new THREE.Mesh(gs[kind], mat);
      m.name = "lb_" + kind.replace(/^dim/, "dim");
      m.castShadow = false;
      m.userData.noSeal = true;
      // the lit layers start dark: a unit lights up when something puts it on a call
      if (kind === "red" || kind === "blue" || kind === "mid") m.visible = false;
      g.add(m);
    }
    return g;
  }

  /* ============================================================
     THE POLICE BLACK-AND-WHITE (model.livery "police")
  ============================================================ */
  const policeRigs = new WeakMap();
  function policeLivery(root, ctx, model) {
    const K = kit(), PT = parts();
    if (!K || !PT || !ctx) return;
    const white = M.white();
    // doors + roof/pillars white over the black body (a respray keeps the livery)
    root.traverse(function (o) {
      const z = o.userData && o.userData.paintZone;
      if (o.material && (z === "upper" || z === "door")) o.material = white;
    });
    const unit = String((model && model.unit) || "12");
    const w = ctx.w;
    const topAt = (z) => PT.topAt(ctx, z);
    // ---- decals ----
    const doors = doorGroups(root);
    doors.forEach(function (dg) {
      const d = dg.userData.carDoor;
      const yB = d.y0 + (d.belt - d.y0) * 0.30, yT = d.y0 + (d.belt - d.y0) * 0.80;
      if (d.row === 0) doorDecal(dg, D.policeDoor(), 0.07, 0.93, yB, yT);
    });
    const rear = doors.filter((d) => d.userData.carDoor.row === 1);
    const qz = rear.length ? Math.min.apply(null, rear.map((d) => d.userData.carDoor.z0)) - 0.08 : ctx.rearZ + 1.0;
    const beltY = ctx.beltY || (ctx.roofY - 0.45);
    sides(function (s) { sideDecal(root, "body", D.unit(unit, "#f2f4f6"), s, qz, qz - 0.34, beltY - 0.27, beltY - 0.09); });
    // the tailgate / boot lid: POLICE in white over the black paint
    let tTop = Math.min((ctx.tailTopY || ctx.tailY + 0.2) - 0.04, ctx.tailY + 0.17), tBot = tTop - 0.09;
    // A LID THAT OPENS carries the word (playercars.js loftLid): laid on the
    // lid's own skin, in the lid's frame, so it lifts with the boot
    let lidG = null;
    for (let i = 0; i < root.children.length; i++) { const o = root.children[i]; if (o.userData && o.userData.carLid) { lidG = o; break; } }
    const lidSkin = lidG ? zoneMesh(lidG, "lid") : null;
    if (lidSkin && ctx.lidCutY != null) {
      const hy = lidG.position.y;
      tBot = ctx.lidCutY + 0.015;
      tTop = Math.max(tBot + 0.04, Math.min((ctx.tailTopY || ctx.tailY + 0.2) - 0.025, tBot + 0.09));
      addSkinDecal(lidG, lidSkin.geometry, D.word("POLICE", "#f2f4f6"), { axis: "z", sign: -1, u0: 0.36, u1: -0.36, v0: tBot - hy, v1: tTop - hy });
    } else {
      const body = zoneMesh(root, "body");
      if (body) addSkinDecal(root, body.geometry, D.word("POLICE", "#f2f4f6"), { axis: "z", sign: -1, u0: 0.36, u1: -0.36, v0: tBot, v1: tTop });
    }
    // the roof number, for the helicopter
    const upper = zoneMesh(root, "upper");
    const rz = ctx.roofZ || 0, rl = ctx.roofLen || 1;
    if (upper) addSkinDecal(root, upper.geometry, D.unit(unit, "#111215"), { axis: "y", sign: 1, u0: 0.34, u1: -0.34, v0: rz - rl * 0.38, v1: rz - rl * 0.38 + 0.34 });

    // ---- the light rig (bar, grille heads, push-bumper heads) ----
    let gs = policeRigs.get(ctx);
    if (!gs) {
      const R = new Rig(false);
      const zBar = rz + rl * 0.5 - Math.min(0.46, rl * 0.24);
      const len = Math.min(1.22, (ctx.roofW || w * 0.8) * 0.92);
      R.bar(0, topAt(zBar) - 0.012, zBar, len, function (i, n, dx) {
        if (Math.abs(dx) < len * 0.09) return ["w", "W"];       // takedowns
        return dx > 0 ? ["r", "A"] : ["b", "B"];               // red driver side, blue passenger side
      }, { n: 12 });
      // grille heads, low in the fascia, either side of centre
      const gy = ctx.headY - 0.10;
      sides(function (s) {
        const x = s * w * 0.14, z = PT.surfZ(ctx, 1, x, gy);
        R.lamp(s > 0 ? "r" : "b", s > 0 ? "B" : "A", x, gy, z + 0.005, 0.13, 0.035, 0, false);
      });
      // rear: a pair in the tail, inboard of the lamps
      // (under the lip of an opening lid: the bar is one merged rig, it cannot lift with it)
      let ty = (ctx.tailTopY || ctx.tailY + 0.2) - 0.03;
      if (ctx.lidCutY != null) ty = Math.min(ty, ctx.lidCutY - 0.035);
      sides(function (s) {
        const x = s * w * 0.17, z = PT.surfZ(ctx, -1, x, ty);
        R.lamp(s > 0 ? "r" : "b", s > 0 ? "B" : "A", x, ty + 0.01, z - 0.005, 0.12, 0.03, Math.PI, false);
      });
      // ---- the push bumper (the heads ride its top tube) ----
      const pbTop = Math.min(ctx.noseTopY - 0.03, ctx.headY + 0.04), pbBot = ctx.baseY - 0.04;
      const zf = Math.max(PT.surfZ(ctx, 1, 0, pbBot + 0.08), PT.surfZ(ctx, 1, 0, ctx.headY), PT.surfZ(ctx, 1, w * 0.2, pbBot + 0.08)) + 0.09;
      sides(function (s) { R.lamp(s > 0 ? "r" : "b", s > 0 ? "A" : "B", s * w * 0.105, pbTop - 0.035, zf + 0.035, 0.1, 0.035, 0, false); });
      gs = { rig: R, pb: { top: pbTop, bot: pbBot, z: zf } };
      gs.geos = {};
      for (const kind in R.k) gs.geos[kind] = mergeGeos(R.k[kind]);
      policeRigs.set(ctx, gs);
    }
    root.add(rigGroup(gs.geos, false));
    // push bumper: two uprights, a top and a middle tube, the plate between
    const pb = gs.pb, dk = M.steel();
    sides(function (s) {
      RB(root, dk, s * w * 0.20 - 0.035, s * w * 0.20 + 0.035, pb.bot, pb.top, pb.z - 0.03, pb.z + 0.03, 0.02);
      RB(root, dk, s * w * 0.20 - 0.025, s * w * 0.20 + 0.025, pb.bot + 0.06, pb.bot + 0.12, pb.z - 0.16, pb.z, 0.015);   // the foot back to the frame
    });
    RB(root, dk, -w * 0.21, w * 0.21, pb.top - 0.06, pb.top, pb.z - 0.03, pb.z + 0.03, 0.02);
    RB(root, dk, -w * 0.21, w * 0.21, (pb.top + pb.bot) / 2 - 0.03, (pb.top + pb.bot) / 2 + 0.03, pb.z - 0.03, pb.z + 0.03, 0.02);
    RB(root, M.rubber(), -w * 0.18, w * 0.18, pb.bot + 0.03, pb.bot + 0.10, pb.z - 0.02, pb.z + 0.045, 0.02);
    // A-PILLAR SPOTLIGHT, driver's side: the post through the pillar, a chrome head
    const zS = (ctx.zCowl != null ? ctx.zCowl : 0.8) - 0.22, yS = beltY + 0.06, xS = w * 0.465;
    CYL(root, M.dark(), 0.012, 0.16, xS, yS + 0.05, zS, "y", 8);
    CYL(root, M.chrome(), 0.06, 0.15, xS + 0.01, yS + 0.15, zS + 0.02, "z", 14, 0.052);
    put(root, cylGeo(0.05, 0.05, 0.004, 14), M.head(), xS + 0.01, yS + 0.15, zS + 0.097, Math.PI / 2, 0, 0);
    // ANTENNAS: two pucks and a whip behind the bar
    const za = rz - rl * 0.12;
    [[-0.22, 0.03, 0.05], [0.22, 0.03, 0.05], [0, 0.008, 0.42]].forEach(function (a, i) {
      const y = topAt(za - i * 0.05);
      if (a[2] > 0.1) { CYL(root, M.dark(), 0.02, 0.03, a[0], y + 0.015, za - 0.1, "y", 10); CYL(root, M.dark(), a[1], a[2], a[0], y + 0.03 + a[2] / 2, za - 0.1, "y", 5, 0.004); }
      else put(root, rbGeo(0.07, a[2], 0.1, 0.02), M.dark(), a[0], y + a[2] / 2 - 0.005, za, 0, 0, 0);
    });
  }

  /* ============================================================
     A HAND-BUILT DOOR (the box bodies) on the loft door's contract:
     a Group named door_<id> hinged at its FRONT edge on the skin, its
     children in the hinge frame, and userData.carDoor — which is what
     boarding.js, vehicles.js's bakeShutDoors / CBZ.carDoorPose and the
     cabin solver read. The opening behind it is real (the cab walls are
     built around it), so a door that swings shows a cab, not a wall.
  ============================================================ */
  function boxDoor(root, o) {
    const side = o.side, len = o.z1 - o.z0, t = o.t || 0.06;
    const hx = side * o.x, hz = o.z1;
    const g = new THREE.Group();
    g.name = "door_" + o.id;
    g.position.set(hx, 0, hz);
    const xc = -side * t / 2, paint = o.paint, dark = o.dark || M.dark();
    // window: [wz0, wz1] metres back from the hinge, [wy0, wy1] in height
    const wz0 = o.wz0 != null ? o.wz0 : 0.07, wz1 = o.wz1 != null ? o.wz1 : len - 0.07;
    const wy0 = o.wy0 != null ? o.wy0 : o.belt, wy1 = o.wy1 != null ? o.wy1 : o.y1 - 0.07;
    const P = (y0, y1, z0, z1) => put(g, rbGeo(t, y1 - y0, z1 - z0, 0.012), paint, xc, (y0 + y1) / 2, -(z0 + z1) / 2);
    P(o.y0, wy0, 0.004, len - 0.004);                                  // the skin below the glass
    P(wy1, o.y1, 0.004, len - 0.004);                                  // the header rail
    if (wz0 > 0.01) P(wy0, wy1, 0.004, wz0);                           // front post
    if (len - wz1 > 0.01) P(wy0, wy1, wz1, len - 0.004);               // rear post
    put(g, boxGeo(0.012, wy1 - wy0, wz1 - wz0), o.glass || M.glass(), xc, (wy0 + wy1) / 2, -(wz0 + wz1) / 2);
    // the door card inside, and the handle outside, aft
    put(g, boxGeo(0.02, wy0 - o.y0 - 0.06, len - 0.12), dark, -side * (t + 0.01), (o.y0 + wy0) / 2, -len / 2);
    const hy = o.handleY != null ? o.handleY : wy0 - 0.14;
    put(g, rbGeo(0.03, 0.045, 0.2, 0.012), o.handleMat || M.chrome(), side * 0.012, hy, -len + 0.16);
    if (o.decal) o.decal(g, len, xc, side);
    g.userData.carDoor = {
      id: o.id, side: side, row: o.row || 0, z0: o.z0, z1: o.z1, len: len,
      hx: hx, hz: hz, y0: o.y0, belt: wy0, y1: o.y1,
      handle: { x: side * 0.014, y: hy, z: -len + 0.16, tilt: 0 },
    };
    root.add(g);
    return g;
  }
  // a flat decal ON a hand-built door leaf (door frame coordinates)
  function leafDecal(g, mat, w, h, side, zBack, y) {
    return flatDecal(g, mat, w, h, side * 0.004, y, -zBack, side > 0 ? "+x" : "-x");
  }

  function wheelsAt(root, R, W, x, z, rim, frac, dualGap) {
    sides(function (s) {
      const wh = kit().makeWheel(R, W, rim, frac);
      wh.rotation.z = -s * Math.PI / 2;
      wh.position.set(s * x, R, z);
      root.add(wh);
      if (dualGap) {
        const tw = kit().makeWheel(R, W * 0.96, rim, frac);
        tw.rotation.z = -s * Math.PI / 2;
        tw.position.set(s * (x - dualGap), R, z);
        root.add(tw);
      }
    });
  }

  // a recessed compartment door outline on a flat side: a proud panel, the
  // seam round it, a chrome handle (side s, outer skin x)
  function hingedPanel(root, s, x, z0, z1, y0, y1, mat, handleZ) {
    const zf = Math.max(z0, z1), zb = Math.min(z0, z1);
    RB(root, mat, s * x - 0.006, s * x + 0.006, y0, y1, zb, zf, 0.01);
    const dk = M.dark();
    BX(root, dk, s * x - 0.004, s * x + 0.008, y0 - 0.012, y0, zb, zf);
    BX(root, dk, s * x - 0.004, s * x + 0.008, y1, y1 + 0.012, zb, zf);
    BX(root, dk, s * x - 0.004, s * x + 0.008, y0, y1, zf, zf + 0.012);
    BX(root, dk, s * x - 0.004, s * x + 0.008, y0, y1, zb - 0.012, zb);
    const hz = handleZ != null ? handleZ : zb + 0.12;
    put(root, rbGeo(0.03, 0.05, 0.14, 0.012), M.chrome(), s * (x + 0.012), (y0 + y1) / 2, hz);
  }
  function rollupDoor(root, s, x, z0, z1, y0, y1) {
    const zf = Math.max(z0, z1), zb = Math.min(z0, z1);
    const dk = M.dark();
    RB(root, dk, s * x - 0.004, s * x + 0.006, y0 - 0.02, y1 + 0.02, zb - 0.02, zf + 0.02, 0.008);
    const m = D.rollup();
    if (m) flatDecal(root, m, zf - zb, y1 - y0, s * (x + 0.008), (y0 + y1) / 2, (zf + zb) / 2, s > 0 ? "+x" : "-x");
    else RB(root, M.alu(), s * x, s * x + 0.008, y0, y1, zb, zf, 0.004);
    BX(root, M.chrome(), s * x, s * (x + 0.035), y0 + 0.03, y0 + 0.07, zb + 0.06, zf - 0.06);   // the lift bar
  }

  /* ============================================================
     THE AMBULANCE — Type III: an E-450 cutaway cab and a box module.
     The cab is a LOFTED van front (the same shell + face as the cargo van,
     real arches, two real hinged doors, the shared cabin). The loft runs the
     full length under the module, which hides it: what shows below the box
     is the chassis' own flank and rear arch, which is where a cutaway's are.
     The module is a hollow room: the rear doors open (medics.js swings them
     when the crew loads) onto a floor, a cot, a bench and cabinets.
  ============================================================ */
  const AMB = { L: 6.9, W: 2.02, FO: 0.95, WB: 4.01, R: 0.375, WW: 0.225, gap: 0.07, yB: 0.33,
    MW: 2.44, mFront: 0.80, mBack: -3.47, mBot: 0.62, mFloor: 0.98, mTop: 2.68 };
  function buildAmbulance() {
    const K = kit(), A = AMB;
    const root = new THREE.Group();
    const paint = K.paintMat("ambulance", 0xf2f4f6, { metalness: 0.3, roughness: 0.42, envMapIntensity: 0.8 });
    const glass = K.glassMat(), trim = M.dark();
    const zN = A.L / 2, zT = -A.L / 2;
    const zF = zN - A.FO, zR = zF - A.WB, Ra = A.R + A.gap;
    const zCowl = zF - 0.22, zRoofF = zCowl - 0.72;
    const yRoof = 2.08, roofC = 0.03;
    const cabBack = 0.90;
    const S = {
      L: A.L, W: A.W, axles: [zF, zR], wheelR: A.R, wheelW: A.WW, archGap: A.gap,
      yB: A.yB, noseLift: 0.10, tailLift: 0.0,
      zCowl: zCowl, zRoofF: zRoofF, zRoofR: zT - 0.5, zDeck: zT - 1.0,
      yNose: 1.14, yCowl: 1.33, yDeck: 1.34, yTail: 1.34, yRoof: yRoof,
      hoodKeys: [[zN - 0.22, 1.22], [(zCowl + zN) / 2, 1.29]],
      roofKeys: [[zRoofF, yRoof - 0.04], [zRoofF - 0.45, yRoof], [zT, yRoof]],
      hoodCrown: 0.035, roofCrown: roofC, deckCrown: 0.02,
      tumble: 0.95, beltIn: 0.015, shoulderIn: 0.015, shoulderDrop: 0.025,
      rcNose: 0.30, rcTail: 0.02, endTaperN: 0.06, endTaperT: 0,
      bulge: 0.022, tuck: 0.004, winF: 0.12, winR: 0,
      sideGlassR: cabBack + 0.06, archTrim: true, valance: 0.3,
      openTail: true, floorY: 0.64,
    };
    const sh0 = CBZ.carBody.makeShape(Object.assign({}, S, { trackHalf: 1 }));
    S.trackHalf = Math.min(sh0.planHalf(zF), sh0.planHalf(zR)) + S.bulge - 0.02 - A.WW / 2;
    const lead = Math.min(zCowl + 0.02, zF - Ra - 0.05);
    S.doors = [];
    sides(function (s) { S.doors.push({ id: "F" + (s > 0 ? "L" : "R"), side: s, row: 0, z0: cabBack, z1: +lead.toFixed(4) }); });
    const B = CBZ.carBody.loft(S);
    K.addBody(root, B.geos.paint, paint, "body");
    K.addBody(root, B.geos.paintU, paint, "upper");
    K.addBody(root, B.geos.glass, glass);
    K.addBody(root, B.geos.trim, trim);
    K.addBody(root, B.geos.under, trim);
    root.userData.loftBody = true;
    const doors = B.doors.map(function (Dd) { return K.loftDoor(root, Dd, paint, glass, K.cabinMat()); });
    const midCab = B.section((zCowl + cabBack) / 2);
    K.dressCabin(root, {
      cabW: midCab.xG0 * 2, zR: cabBack + 0.02, zF: zCowl - 0.02,
      zTR: cabBack + 0.04, zTF: zRoofF, roofW: (midCab.xG0 * S.tumble - 0.05) * 2,
      beltY: midCab.yEdge, roofY: yRoof - roofC - 0.03,
      floorY: S.floorY, rows: 1, seatLayout: "cab2",
      doorSpans: S.doors.filter((d) => d.side > 0).map((d) => [d.z0, d.z1]),
      doors: S.doors.map((d) => ({ id: d.id, side: d.side, row: d.row, z0: d.z0, z1: d.z1 })),
    });
    K.addMirrors(root, B.section, lead - 0.1, trim, trim, 1.45);

    // ---- THE MODULE: a hollow aluminium box on the chassis ----
    const hw = A.MW / 2, t = 0.05, mf = A.mFront, mb = A.mBack;
    const wf = zR + 0.64, wb = zR - 0.64, wTop = A.mFloor - 0.04;     // the module's rear well (duals); its ceiling is the floor's underside
    // lower skirts fore and aft of the well, under the floor
    RB(root, paint, -hw, hw, A.mBot, A.mFloor, wf, mf, 0.03);
    RB(root, paint, -hw, hw, A.mBot, A.mFloor, mb, wb, 0.03);
    sides(function (s) {
      BX(root, M.well(), s * (hw - 0.30), s * hw, wTop - 0.02, wTop, wb, wf);          // well ceiling liner
      fenderCrown(root, M.alu(), s * (hw + 0.004), A.R, zR, 0.66, 0.03);
    });
    // floor slab, side walls, roof, front wall
    BX(root, M.vinyl(), -hw + t, hw - t, A.mFloor - 0.04, A.mFloor, mb + t, mf - t);
    sides(function (s) { RB(root, paint, s * (hw - t), s * hw, A.mFloor - 0.02, A.mTop - 0.04, mb, mf, 0.012); });
    RB(root, paint, -hw, hw, A.mTop - t, A.mTop, mb, mf, 0.02);
    RB(root, paint, -hw, hw, A.mFloor - 0.02, A.mTop - 0.02, mf - t, mf, 0.012);
    // the rear frame round the door opening (posts, header, sill)
    const dX = 0.82, dY0 = 1.02, dY1 = 2.40;
    sides(function (s) { RB(root, paint, s * dX, s * hw, A.mBot, A.mTop, mb, mb + t, 0.012); });
    RB(root, paint, -dX, dX, dY1, A.mTop, mb, mb + t, 0.012);
    RB(root, paint, -dX, dX, A.mFloor - 0.02, dY0, mb, mb + t, 0.012);
    // radiused corner extrusions: four posts and the roof-edge rails
    sides(function (s) {
      [mf, mb].forEach(function (z) { RB(root, M.alu(), s * hw - 0.05, s * hw + 0.05, A.mBot + 0.01, A.mTop + 0.01, z - 0.05, z + 0.05, 0.045); });
      RB(root, M.alu(), s * hw - 0.045, s * hw + 0.045, A.mTop - 0.05, A.mTop + 0.03, mb + 0.02, mf - 0.02, 0.04);
    });
    [mf, mb].forEach(function (z) { RB(root, M.alu(), -hw + 0.02, hw - 0.02, A.mTop - 0.05, A.mTop + 0.03, z - 0.045, z + 0.045, 0.04); });
    // the interior: ceiling lights, cabinets (street side), the squad bench
    // (curb side), the cot, oxygen
    [-0.6, -1.8, -2.8].forEach(function (z) { BX(root, M.ceil(), -0.32, 0.32, A.mTop - t - 0.012, A.mTop - t, z - 0.25, z + 0.25); });
    RB(root, M.cab(), hw - t - 0.42, hw - t, 1.62, A.mTop - t - 0.02, -2.95, 0.70, 0.02);
    RB(root, M.tint(), hw - t - 0.425, hw - t - 0.415, 1.72, A.mTop - t - 0.12, -2.85, 0.60, 0.004);
    RB(root, M.cab(), hw - t - 0.45, hw - t, A.mFloor, 1.32, -2.95, 0.70, 0.02);
    RB(root, M.alu(), hw - t - 0.48, hw - t, 1.32, 1.36, -2.95, 0.70, 0.01);
    RB(root, M.cushion(), -hw + t, -hw + t + 0.48, 1.36, 1.48, -2.9, -0.7, 0.04);
    RB(root, M.cushion(), -hw + t, -hw + t + 0.10, 1.48, 2.02, -2.9, -0.7, 0.04);
    RB(root, M.cab(), -hw + t, -hw + t + 0.48, A.mFloor, 1.36, -2.9, -0.7, 0.02);
    // the cot: a yellow frame, a white mattress, a rail
    const cotX = 0.12;
    BX(root, coat("cotframe", 0xe2b21c, 0.3, 0.5), cotX - 0.28, cotX + 0.28, A.mFloor + 0.02, A.mFloor + 0.08, -3.05, -1.05);
    [-2.95, -1.15].forEach(function (z) { sides(function (s) { BX(root, M.alu(), cotX + s * 0.24 - 0.02, cotX + s * 0.24 + 0.02, A.mFloor + 0.08, A.mFloor + 0.52, z - 0.02, z + 0.02); }); });
    RB(root, coat("mattress", 0xe9ecef, 0.0, 0.7), cotX - 0.29, cotX + 0.29, A.mFloor + 0.52, A.mFloor + 0.62, -3.0, -1.1, 0.04);
    CYL(root, coat("o2", 0x2f8f4a, 0.2, 0.5), 0.09, 1.0, -hw + 0.18, 1.85, 0.45, "y", 12);

    // ---- exterior furniture ----
    // compartments: street side (+x) a tall O2 bay behind the cab, a bay over
    // the wheel, a tall rear bay; curb side (-x) the side entry door, then the same
    const pX = hw;
    hingedPanel(root, 1, pX, 0.70, 0.04, 1.06, 2.46, paint, 0.12);
    hingedPanel(root, 1, pX, wf - 0.06, wb + 0.06, 1.12, 1.98, paint);
    hingedPanel(root, 1, pX, -2.26, -3.34, 1.06, 2.46, paint, -3.22);
    hingedPanel(root, -1, pX, wf - 0.06, wb + 0.06, 1.12, 1.98, paint);
    hingedPanel(root, -1, pX, -2.26, -3.34, 1.06, 2.46, paint, -3.22);
    // curb-side entry door: a panel with a window, grab rails, a step
    hingedPanel(root, -1, pX, 0.70, -0.18, A.mFloor + 0.02, 2.46, paint, -0.08);
    BX(root, M.tint(), -pX - 0.010, -pX - 0.004, 1.78, 2.30, -0.02, 0.56);
    [0.76, -0.24].forEach(function (z) { CYL(root, M.chrome(), 0.016, 0.9, -pX - 0.045, 1.70, z, "y", 8); });
    RB(root, M.plate(), -pX - 0.22, -pX + 0.02, 0.44, 0.50, -0.20, 0.70, 0.01);
    // rear step bumper (diamond plate) and the plate skirt
    RB(root, M.plate(), -hw + 0.04, hw - 0.04, 0.48, 0.60, mb - 0.16, mb + 0.02, 0.015);
    // ---- the rear doors (opening groups, medics.js swings them) ----
    const doorMat = paint;
    sides(function (s) {
      const g = new THREE.Group();
      g.name = s > 0 ? "emg_rear_L" : "emg_rear_R";
      g.position.set(s * dX, 0, mb);
      const lw = dX - 0.005;                                        // the leaf runs from the hinge to the centre seam
      const xl = (a, b) => [-s * a, -s * b];                         // local x span measured inward from the hinge
      const pan = (a, b, y0, y1) => { const q = xl(a, b); RB(g, doorMat, Math.min(q[0], q[1]), Math.max(q[0], q[1]), y0, y1, 0.0, 0.045, 0.012); };
      pan(0, lw, dY0 + 0.01, 1.84);
      pan(0, lw, 2.30, dY1 - 0.01);
      pan(0, 0.12, 1.84, 2.30);
      pan(lw - 0.10, lw, 1.84, 2.30);
      const wq = xl(0.12, lw - 0.10);
      BX(g, M.glass(), Math.min(wq[0], wq[1]), Math.max(wq[0], wq[1]), 1.84, 2.30, 0.015, 0.025);
      const cx = -s * lw / 2;
      flatDecal(g, D.starOfLife(), 0.40, 0.40, cx, 1.60, -0.004, "-z");
      flatDecal(g, s > 0 ? D.chevL() : D.chevR(), lw - 0.04, 0.28, cx, dY0 + 0.17, -0.005, "-z");
      put(g, rbGeo(0.16, 0.04, 0.03, 0.012), M.chrome(), -s * (lw - 0.10), 1.55, -0.016);    // handle at the seam
      [1.25, 2.15].forEach(function (y) { put(g, rbGeo(0.05, 0.12, 0.03, 0.01), M.alu(), -s * 0.02, y, -0.012); });   // hinges
      root.add(g);
    });
    // chevrons on the rear posts, beside the doors
    sides(function (s) { flatDecal(root, s > 0 ? D.chevL() : D.chevR(), hw - dX - 0.08, 0.80, s * (dX + hw) / 2, 1.96, mb - 0.003, "-z"); });

    // ---- livery: the red band, the word, the Star of Life, the unit ----
    const bY0 = 1.12, bY1 = 1.28;
    const band = D.band("#c8102e");
    sides(function (s) {
      flatDecal(root, band, mf - mb - 0.1, bY1 - bY0, s * (hw + 0.02), (bY0 + bY1) / 2, (mf + mb) / 2, s > 0 ? "+x" : "-x");
      flatDecal(root, D.wide("AMBULANCE", "#c8102e"), 2.3, 0.36, s * (hw + 0.021), 1.62, -1.25, s > 0 ? "+x" : "-x");
      flatDecal(root, D.starOfLife(), 0.62, 0.62, s * (hw + 0.022), 2.0, -2.82, s > 0 ? "+x" : "-x");
      flatDecal(root, D.starOfLife(), 0.48, 0.48, s * (hw + 0.022), 2.1, 0.34, s > 0 ? "+x" : "-x");
      // the cab: the band along the fender and the door, the unit under it
      sideDecal(root, "body", band, s, zF + 0.30, lead + 0.01, bY0, bY1);
    });
    doors.forEach(function (dg) {
      const d = dg.userData.carDoor;
      if (!band) return;
      const pm = zoneMesh(dg, "door"); if (!pm) return;
      const zf = d.z1 - d.hz, zb = d.z0 - d.hz;
      addSkinDecal(dg, pm.geometry, band, { axis: "x", sign: d.side, u0: d.side > 0 ? zf : zb, u1: d.side > 0 ? zb : zf, v0: bY0, v1: bY1 });
      doorDecal(dg, D.word("MEDIC 7", "#c8102e"), 0.12, 0.88, 0.78, 1.04);
    });
    flatDecal(root, D.wide("AMBULANCE", "#c8102e", null, true), 1.6, 0.25, 0, 2.47, mf + 0.003, "+z");
    flatDecal(root, D.unit("7", "#111215"), 0.8, 0.4, 0, A.mTop + 0.002, -1.4, "+y");
    // the hood: AMBULANCE mirrored, to read in the mirror of the car ahead
    const bodyM = zoneMesh(root, "body");
    if (bodyM) addSkinDecal(root, bodyM.geometry, D.wide("AMBULANCE", "#c8102e", null, true), { axis: "y", sign: 1, u0: -0.62, u1: 0.62, v0: zN - 0.18, v1: zCowl + 0.32 });

    // ---- the warning lights: module corners, sides, the header ----
    const R = new Rig(true);
    const yU = A.mTop - 0.18;
    sides(function (s) {
      // front header corners (red) and a centre white; rear corners
      R.lamp("r", s > 0 ? "A" : "B", s * (hw - 0.22), yU, mf + 0.002, 0.24, 0.12, 0);
      R.lamp("r", s > 0 ? "B" : "A", s * (hw - 0.22), yU, mb - 0.002, 0.24, 0.12, Math.PI);
      // sides, high, fore and aft
      R.lamp("r", s > 0 ? "A" : "B", s * (hw + 0.002), yU, mf - 0.32, 0.22, 0.12, s * Math.PI / 2);
      R.lamp("r", s > 0 ? "B" : "A", s * (hw + 0.002), yU, mb + 0.32, 0.22, 0.12, s * Math.PI / 2);
      // scene lights (white, unlit) mid-side, and the rear load lights
      R.lamp("w", null, s * (hw + 0.002), yU, -1.25, 0.30, 0.10, s * Math.PI / 2);
      R.lamp("w", null, s * 0.42, dY1 + 0.12, mb - 0.002, 0.18, 0.07, Math.PI);
      // amber clearance markers on the header
      R.lamp("a", null, s * 0.6, A.mTop - 0.04, mf + 0.002, 0.08, 0.04, 0, false);
    });
    R.lamp("w", "W", 0, yU, mf + 0.002, 0.22, 0.12, 0);
    R.lamp("a", null, 0, yU, mb - 0.002, 0.30, 0.10, Math.PI);
    root.userData._ambRig = true;
    root.add(R.group("ambulance"));

    // ---- wheels: singles in front, duals behind ----
    const rim = parts() ? parts().rimStyleFor("ambulance") : "steel";
    wheelsAt(root, A.R, A.WW, S.trackHalf, zF, rim, 0.56, 0);
    wheelsAt(root, A.R, A.WW, S.trackHalf, zR, rim, 0.56, A.WW + 0.02);

    root.userData.vehicleDims = { width: A.MW, length: zN - (mb - 0.16), height: A.mTop, wheelbase: A.WB };
    // the face: the van's front on the loft nose; its tail lamps, plate and
    // tips laid FLAT on the module's rear posts (no rear grid: the loft's
    // tail is buried inside the box)
    const ctx = K.loftCtx("ambulance", S, B, Object.assign({ W: A.W, L: A.L }, A), paint);
    ctx.rz = null;
    ctx.rearZ = mb;
    ctx.tailX = (hw + dX) / 2; ctx.tailW = hw - dX - 0.10;
    ctx.tailY = 1.30; ctx.tailTopY = 1.95;
    ctx.rearPlateY = 0.80;
    ctx.rearFlat = true;
    root.userData.partCtx = ctx;
    return root;
  }

  /* ============================================================
     THE FIRE ENGINE — a custom-cab pumper. 9.0 m, 2.5 m wide, a flat-faced
     four-door tilt cab over the front axle (white roof), a side-mount pump
     panel, roll-up compartments, crosslays and a hose bed on top, ladders on
     the officer's side, hard suction on the driver's, a tailboard, chevrons,
     a stainless bumper with a mechanical Q siren and air horns.
  ============================================================ */
  /* The cab layout, front to back (z, metres): bumper 4.50..4.06, the front
     wheel under the front door (axle 3.40, well 2.80..4.00 up to 1.13), the
     front door 3.66..2.70 with its sill ABOVE the well (1.17: on a custom
     cab you climb the steps behind the wheel into a seat over the axle), the
     B pillar, the crew door 2.58..1.64 down to the cab skirt, the cab back
     at 1.55. Body 1.52..-4.18: pump panel, then four compartments a side. */
  const FE = { L: 9.0, W: 2.5, R: 0.53, WW: 0.31, zF: 3.40, WB: 4.90,
    cabF: 4.06, cabB: 1.55, cabBot: 0.60, belt: 1.80, wsTop: 2.60, roofY: 2.86,
    bodyF: 1.52, bodyB: -4.18, bodyBot: 0.55, bodyTop: 2.35 };
  function buildFireEngine() {
    const K = kit(), F = FE;
    const root = new THREE.Group();
    const paint = K.paintMat("firetruck", 0xb3121a, { metalness: 0.42, roughness: 0.32, envMapIntensity: 1.0 });
    const white = M.white(), chrome = M.chrome(), dark = M.dark(), alu = M.alu(), glass = K.glassMat();
    const hw = F.W / 2, zN = F.L / 2, zT = -F.L / 2;
    const zF = F.zF, zR = F.zF - F.WB, Ra = F.R + 0.07;
    const t = 0.06;
    const fD = { z0: 2.70, z1: 3.66, y0: 1.17 }, cD = { z0: 1.64, z1: 2.58, y0: F.cabBot + 0.02 };
    const lip = 1.10;

    /* ---- THE CAB ---- */
    // the front fascia below the windscreen
    RB(root, paint, -hw, hw, F.cabBot, F.belt, F.cabF - 0.10, F.cabF, 0.04);
    sides(function (s) {
      // the front quarter ahead of the front door, below and above the belt
      RB(root, paint, s * (hw - t), s * hw, lip, F.belt, fD.z1, F.cabF - 0.02, 0.015);
      RB(root, paint, s * (hw - t), s * hw, F.belt - 0.01, F.wsTop + 0.12, fD.z1, F.cabF - 0.15, 0.015);
      // the fender lip over the wheel, under the front door's sill
      RB(root, paint, s * (hw - t), s * hw, lip, fD.y0 + 0.005, cD.z1, F.cabF - 0.02, 0.012);
      // behind the well: the step riser, the B pillar, the post behind the crew door
      RB(root, paint, s * (hw - t), s * hw, F.cabBot, lip, cD.z1, zF - Ra + 0.02, 0.012);
      RB(root, paint, s * (hw - t), s * hw, lip, F.roofY, cD.z1, fD.z0, 0.008);
      RB(root, paint, s * (hw - t), s * hw, F.cabBot, F.roofY, F.cabB, cD.z0, 0.01);
      RB(root, paint, s * (hw - 0.14), s * hw, F.belt - 0.02, F.roofY, F.cabF - 0.16, F.cabF, 0.03);   // the A pillar
      wellLiner(root, s * (hw - 0.26), F.R, zF, Ra + 0.02, 0.5);
      fenderCrown(root, chrome, s * (hw + 0.004), F.R, zF, Ra + 0.02, 0.028);
    });
    // header over the doors and the screen; the white roof; the cab's back wall
    sides(function (s) { RB(root, paint, s * (hw - t), s * hw, F.wsTop + 0.10, F.roofY, F.cabB, F.cabF, 0.01); });
    RB(root, paint, -hw + 0.1, hw - 0.1, F.wsTop, F.roofY, F.cabF - 0.10, F.cabF, 0.02);
    RB(root, white, -hw, hw, F.roofY - 0.02, F.roofY + 0.08, F.cabB - 0.02, F.cabF + 0.01, 0.04);
    RB(root, paint, -hw + 0.02, hw - 0.02, F.cabBot, F.roofY, F.cabB, F.cabB + 0.06, 0.01);
    // the windscreen: two big panes either side of a centre post, raked back a touch
    sides(function (s) {
      put(root, boxGeo(hw - 0.20, F.wsTop - F.belt - 0.02, 0.02), glass, s * (hw - 0.14) / 2 + s * 0.015, (F.belt + F.wsTop) / 2, F.cabF - 0.06, -0.06, 0, 0);
    });
    BX(root, paint, -0.03, 0.03, F.belt, F.wsTop, F.cabF - 0.10, F.cabF - 0.02);
    // ---- the four doors ----
    const doorOpts = { x: hw, belt: F.belt, y1: F.wsTop + 0.08, t: t, paint: paint, glass: glass, wy1: F.wsTop };
    const stripeY0 = 1.24, stripeY1 = 1.40;
    const doors = [];
    sides(function (s) {
      doors.push(boxDoor(root, Object.assign({}, doorOpts, {
        id: "F" + (s > 0 ? "L" : "R"), side: s, row: 0, z0: fD.z0, z1: fD.z1, y0: fD.y0,
        decal: function (g, len, xc, sd) {
          leafDecal(g, D.fireDoor(), len * 0.80, len * 0.40, sd, len / 2, 1.61);
          leafDecal(g, D.fireStripe(), len - 0.02, stripeY1 - stripeY0, sd, len / 2, (stripeY0 + stripeY1) / 2);
        },
      })));
      doors.push(boxDoor(root, Object.assign({}, doorOpts, {
        id: "R" + (s > 0 ? "L" : "R"), side: s, row: 1, z0: cD.z0, z1: cD.z1, y0: cD.y0,
        decal: function (g, len, xc, sd) {
          leafDecal(g, D.word("ENGINE 7", "#d8b441", "#2a1a05"), len * 0.86, 0.17, sd, len / 2, 1.62);
          leafDecal(g, D.fireStripe(), len - 0.02, stripeY1 - stripeY0, sd, len / 2, (stripeY0 + stripeY1) / 2);
        },
      })));
      // steps behind the front wheel up to the front door; a tread under the
      // crew door; grab rails beside both
      [0.50, 0.86].forEach(function (y) { RB(root, M.plate(), s * (hw - 0.02), s * (hw + 0.15), y - 0.03, y + 0.02, cD.z1 + 0.02, zF - Ra - 0.02, 0.01); });
      RB(root, M.plate(), s * (hw - 0.02), s * (hw + 0.16), 0.40, 0.45, cD.z0 + 0.06, cD.z1 - 0.06, 0.01);
      CYL(root, chrome, 0.016, 0.85, s * (hw + 0.035), 1.70, fD.z0 - 0.04, "y", 8);
      CYL(root, chrome, 0.016, 0.85, s * (hw + 0.035), 1.45, cD.z0 - 0.04, "y", 8);
      // the stripe on the quarter ahead of the front door and on the cab's rear post
      flatDecal(root, D.fireStripe(), F.cabF - fD.z1 - 0.06, stripeY1 - stripeY0, s * (hw + 0.004), (stripeY0 + stripeY1) / 2, (F.cabF + fD.z1) / 2 - 0.02, s > 0 ? "+x" : "-x");
    });
    K.dressCabin(root, {
      cabW: (hw - t) * 2, zR: F.cabB + 0.08, zF: F.cabF - 0.16,
      zTR: F.cabB + 0.08, zTF: F.cabF - 0.14, roofW: (hw - t) * 2,
      beltY: F.belt, roofY: F.roofY - 0.06,
      floorY: 1.22, rows: 2, seatLayout: "van6",
      doorSpans: [[cD.z0, cD.z1], [fD.z0, fD.z1]],
      doors: doors.map(function (g) { const d = g.userData.carDoor; return { id: d.id, side: d.side, row: d.row, z0: d.z0, z1: d.z1 }; }),
    });
    // ---- the face: chrome grille, quad lamps, the bumper, the Q, horns ----
    const fz = F.cabF;
    RB(root, chrome, -0.58, 0.58, 1.02, 1.62, fz - 0.02, fz + 0.03, 0.03);
    for (let i = 0; i < 6; i++) BX(root, dark, -0.50, 0.50, 1.08 + i * 0.088, 1.115 + i * 0.088, fz + 0.025, fz + 0.04);
    sides(function (s) {
      [0.76, 1.02].forEach(function (x) {
        RB(root, chrome, s * x - 0.13, s * x + 0.13, 0.93, 1.13, fz - 0.01, fz + 0.04, 0.02);
        BX(root, M.head(), s * x - 0.11, s * x + 0.11, 0.95, 1.11, fz + 0.04, fz + 0.05);
      });
      BX(root, M.amber(), s * 0.90 - 0.10, s * 0.90 + 0.10, 1.17, 1.23, fz, fz + 0.04);
    });
    flatDecal(root, D.word("ENGINE 7", "#d8b441", "#2a1a05"), 1.3, 0.2, 0, F.wsTop + 0.13, fz + 0.004, "+z");
    // the bumper: stainless, a diamond-plate top, a hose well
    RB(root, chrome, -hw - 0.05, hw + 0.05, 0.60, 0.92, F.cabF, zN, 0.05);
    RB(root, M.plate(), -hw - 0.03, hw + 0.03, 0.92, 0.95, F.cabF, zN - 0.02, 0.01);
    BX(root, dark, -0.55, 0.55, 0.93, 0.96, F.cabF + 0.08, zN - 0.10);
    // the Q siren on its pedestal, centre; air horns in the bumper face
    CYL(root, chrome, 0.16, 0.30, 0, 1.12, zN - 0.22, "z", 18);
    put(root, cylGeo(0.13, 0.13, 0.01, 18), dark, 0, 1.12, zN - 0.065, Math.PI / 2, 0, 0);
    BX(root, chrome, -0.05, 0.05, 0.95, 0.98, zN - 0.30, zN - 0.14);
    sides(function (s) { CYL(root, chrome, 0.07, 0.36, s * 0.62, 0.76, zN - 0.12, "z", 12, 0.025); });
    // west-coast mirrors out on the A pillars
    sides(function (s) {
      BX(root, chrome, s * hw, s * (hw + 0.22), 2.08, 2.11, F.cabF - 0.30, F.cabF - 0.26);
      RB(root, dark, s * (hw + 0.17), s * (hw + 0.24), 1.86, 2.40, F.cabF - 0.40, F.cabF - 0.18, 0.03);
      BX(root, chrome, s * (hw + 0.165), s * (hw + 0.172), 1.90, 2.36, F.cabF - 0.38, F.cabF - 0.20);
    });
    // frame rails under it all
    sides(function (s) { BX(root, M.steel(), s * 0.40, s * 0.52, 0.48, 0.72, zT + 0.4, F.cabF); });

    /* ---- THE BODY ---- */
    const wf = zR + 0.66, wb = zR - 0.66, wTop = 1.24;
    RB(root, paint, -hw, hw, F.bodyBot, wTop, wf, F.bodyF, 0.03);
    RB(root, paint, -hw, hw, F.bodyBot, wTop, F.bodyB, wb, 0.03);
    RB(root, paint, -hw, hw, wTop, F.bodyTop, F.bodyB, F.bodyF, 0.03);
    sides(function (s) {
      BX(root, M.well(), s * (hw - 0.40), s * hw, wTop - 0.02, wTop + 0.001, wb, wf);
      fenderCrown(root, chrome, s * (hw + 0.004), F.R, zR, 0.68, 0.03);
      // hose-bed walls up to the top line
      RB(root, paint, s * (hw - 0.05), s * hw, F.bodyTop - 0.02, F.bodyTop + 0.20, F.bodyB, F.bodyF, 0.012);
      // the chrome rub rail and the reflective stripe
      BX(root, chrome, s * hw, s * (hw + 0.022), 0.56, 0.61, F.bodyB + 0.02, F.bodyF - 0.02);
      flatDecal(root, D.fireStripe(), F.bodyF - F.bodyB - 0.04, stripeY1 - stripeY0, s * (hw + 0.026), (stripeY0 + stripeY1) / 2, (F.bodyF + F.bodyB) / 2, s > 0 ? "+x" : "-x");
      // THE PUMP PANEL (both sides): stainless, gauges, discharges, the intake
      const pz0 = 0.75, pz1 = F.bodyF - 0.02, pzm = (pz0 + pz1) / 2;
      const pm = D.pump();
      if (pm) flatDecal(root, pm, pz1 - pz0, F.bodyTop - 0.62 - 0.05, s * (hw + 0.004), (0.62 + F.bodyTop - 0.05) / 2, pzm, s > 0 ? "+x" : "-x");
      else RB(root, alu, s * hw, s * (hw + 0.006), 0.62, F.bodyTop - 0.05, pz0, pz1, 0.004);
      CYL(root, chrome, 0.13, 0.12, s * (hw + 0.06), 0.98, pzm, "x", 16);                                   // the steamer intake
      put(root, cylGeo(0.10, 0.10, 0.01, 16), dark, s * (hw + 0.122), 0.98, pzm, 0, 0, Math.PI / 2);
      [pz1 - 0.12, pz0 + 0.12].forEach(function (z) {
        CYL(root, chrome, 0.065, 0.12, s * (hw + 0.06), 1.00, z, "x", 12);                                  // discharges
        CYL(root, chrome, 0.075, 0.03, s * (hw + 0.13), 1.00, z, "x", 8);
        BX(root, chrome, s * (hw + 0.01), s * (hw + 0.09), 1.30, 1.33, z - 0.10, z + 0.10);                 // valve T-handle
      });
      [[pzm - 0.13, 1.92, 0.07], [pzm + 0.13, 1.92, 0.07], [pzm, 1.62, 0.045]].forEach(function (gq) {
        CYL(root, chrome, gq[2] + 0.012, 0.03, s * (hw + 0.012), gq[1], gq[0], "x", 16);                    // gauge bezels
      });
      RB(root, M.plate(), s * (hw - 0.02), s * (hw + 0.16), 0.46, 0.52, pz0, pz1, 0.01);                   // operator's step
      // COMPARTMENTS: ahead of the axle, over it (short), behind it, the rear
      rollupDoor(root, s, hw, 0.70, wf - 0.04, 0.66, F.bodyTop - 0.08);
      rollupDoor(root, s, hw, wf - 0.08, wb + 0.08, wTop + 0.06, F.bodyTop - 0.08);
      rollupDoor(root, s, hw, wb - 0.06, -3.12, 0.66, F.bodyTop - 0.08);
      rollupDoor(root, s, hw, -3.20, F.bodyB + 0.08, 0.66, F.bodyTop - 0.08);
    });
    // crosslays over the pump house, the main bed behind (hose folds), dividers
    [[1.30, coat("hoseY", 0xe3bd22, 0.0, 0.8)], [1.02, coat("hoseR", 0xb8202a, 0.0, 0.8)]].forEach(function (c2) {
      RB(root, c2[1], -hw + 0.06, hw - 0.06, F.bodyTop, F.bodyTop + 0.13, c2[0] - 0.12, c2[0] + 0.12, 0.05);
    });
    [[0.40, 1.16, coat("hoseW", 0xe8e6dc, 0.0, 0.8)], [-0.34, 0.34, coat("hoseR", 0xb8202a, 0.0, 0.8)], [-1.16, -0.40, coat("hoseB", 0x2a4fa8, 0.0, 0.8)]].forEach(function (ln) {
      RB(root, ln[2], ln[0], ln[1], F.bodyTop, F.bodyTop + 0.16, F.bodyB + 0.06, 0.70, 0.05);
      for (let z = -0.45; z > F.bodyB + 0.2; z -= 0.42) BX(root, dark, ln[0] + 0.02, ln[1] - 0.02, F.bodyTop + 0.155, F.bodyTop + 0.165, z - 0.01, z + 0.01);
    });
    [-0.37, 0.37].forEach(function (x) { BX(root, alu, x - 0.012, x + 0.012, F.bodyTop, F.bodyTop + 0.20, F.bodyB + 0.04, 0.76); });
    // LADDERS on the officer's side (-x): a 24 ft extension and a roof ladder
    [[-hw - 0.045, 2.30, 2.62, -0.40, -4.00], [-hw - 0.09, 2.34, 2.58, -0.90, -3.50]].forEach(function (Ld, li) {
      const lx = Ld[0], y0 = Ld[1], y1 = Ld[2];
      [y0, y1].forEach(function (y) { BX(root, alu, lx - 0.015, lx + 0.015, y - 0.03, y + 0.03, Ld[4], Ld[3]); });
      for (let z = Ld[3] - 0.15; z > Ld[4] + 0.1; z -= 0.30) BX(root, alu, lx - 0.012, lx + 0.012, y0, y1, z - 0.015, z + 0.015);
      if (li === 0) [-0.8, -2.2, -3.6].forEach(function (z) { BX(root, dark, -hw - 0.11, -hw, 2.42, 2.50, z - 0.04, z + 0.04); });
    });
    // HARD SUCTION on the driver's side (+x), above the compartments
    [2.43, 2.27].forEach(function (y) {
      CYL(root, coat("suction", 0x1a1c1f, 0.1, 0.7), 0.065, 3.1, hw + 0.08, y, -2.15, "z", 12);
      [-0.62, -3.68].forEach(function (z) { CYL(root, chrome, 0.075, 0.08, hw + 0.08, y, z, "z", 12); });
    });
    [-1.0, -3.3].forEach(function (z) { BX(root, dark, hw, hw + 0.15, 2.18, 2.52, z - 0.03, z + 0.03); });
    // THE REAR: a centre roll-up, chevron panels, round stacked tails, the tailboard
    const rz = F.bodyB;
    BX(root, dark, -0.58, 0.58, 0.64, F.bodyTop - 0.06, rz - 0.006, rz);
    if (D.rollup()) flatDecal(root, D.rollup(), 1.10, F.bodyTop - 0.75, 0, (0.66 + F.bodyTop - 0.09) / 2, rz - 0.008, "-z");
    sides(function (s) {
      flatDecal(root, s > 0 ? D.chevL() : D.chevR(), hw - 0.64, F.bodyTop - 0.62, s * (hw + 0.62) / 2, (0.62 + F.bodyTop) / 2, rz - 0.004, "-z");
      [[0.86, M.tail()], [1.08, M.amber()], [1.30, M.rev()]].forEach(function (lp) {
        CYL(root, chrome, 0.085, 0.04, s * 0.96, lp[0], rz - 0.02, "z", 16);
        put(root, cylGeo(0.07, 0.07, 0.012, 16), lp[1], s * 0.96, lp[0], rz - 0.042, Math.PI / 2, 0, 0);
      });
      CYL(root, chrome, 0.018, 1.2, s * (hw - 0.04), 1.55, rz - 0.06, "y", 8);           // grab rails
    });
    RB(root, M.plate(), -hw, hw, 0.47, 0.60, zT, rz, 0.015);
    // ---- the warning lights ----
    const R = new Rig(true);
    R.bar(0, F.roofY + 0.08, F.cabF - 0.32, 2.2, function (i, n, dx) {
      if (Math.abs(dx) < 0.25) return ["w", "W"];
      return [(i & 1) ? "w" : "r", (i & 1) ? "W" : (dx > 0 ? "A" : "B")];
    }, { n: 11, depth: 0.32, h: 0.09 });
    sides(function (s) {
      R.lamp("r", s > 0 ? "A" : "B", s * (hw - 0.24), F.wsTop + 0.13, F.cabF + 0.003, 0.24, 0.13, 0);          // upper front corners
      R.lamp("r", s > 0 ? "B" : "A", s * 0.80, 1.40, F.cabF + 0.003, 0.20, 0.10, 0);                         // lower front
      R.lamp("w", "W", s * 0.42, 1.71, F.cabF + 0.003, 0.14, 0.07, 0);
      R.lamp("r", s > 0 ? "A" : "B", s * (hw + 0.002), 1.62, F.cabF - 0.55, 0.20, 0.10, s * Math.PI / 2);   // cab side
      R.lamp("r", s > 0 ? "B" : "A", s * (hw + 0.002), F.bodyTop - 0.06, F.bodyB + 0.30, 0.22, 0.11, s * Math.PI / 2);   // body side, rear
      R.lamp("r", s > 0 ? "A" : "B", s * (hw + 0.002), 1.38, wf + 0.04, 0.16, 0.08, s * Math.PI / 2);         // mid-ship
      R.lamp("r", s > 0 ? "B" : "A", s * (hw - 0.22), F.bodyTop - 0.12, rz - 0.003, 0.24, 0.13, Math.PI);   // rear upper corners
      R.lamp("w", null, s * (hw + 0.002), F.roofY - 0.12, (F.cabB + F.cabF) / 2, 0.40, 0.10, s * Math.PI / 2);   // scene lights
    });
    for (let i = -2; i <= 2; i++) R.lamp("a", null, i * 0.15, F.bodyTop + 0.10, rz - 0.003, 0.11, 0.06, Math.PI);   // traffic advisor
    root.add(R.group("firetruck"));

    // ---- wheels: steer singles, drive duals ----
    const rim = parts() ? parts().rimStyleFor("firetruck") : "sixlug";
    wheelsAt(root, F.R, F.WW, hw - 0.18, zF, rim, 0.6, 0);
    wheelsAt(root, F.R, F.WW, hw - 0.18, zR, rim, 0.6, F.WW + 0.03);

    root.userData.loftBody = true;           // a sealed authored body: no hole-proofing shell through the cab
    root.userData.vehicleDims = { width: F.W, length: F.L, height: F.roofY + 0.17, wheelbase: F.WB };
    return root;
  }

  /* ============================================================
     THE SWAT TRUCK — armoured rescue vehicle on a heavy pickup chassis:
     a long flat-panelled hood with a louvred armour grille and a ram, a
     short two-pane screen in a thick frame, one tall steel box from the
     screen back with gun ports, small windows, a roof hatch, running boards
     and rear doors. Black, POLICE / SWAT in white.
  ============================================================ */
  const BC = { L: 6.6, W: 2.44, R: 0.47, WW: 0.33, zF: 2.10, WB: 4.19,
    hoodB: 1.50, hoodF: 3.05, cabB: 0.10, bot: 0.80, top: 2.80 };
  function buildBearcat() {
    const K = kit(), A = BC;
    const root = new THREE.Group();
    const paint = K.paintMat("bearcat", 0x15181b, { metalness: 0.3, roughness: 0.55, envMapIntensity: 0.6 });
    const dark = M.dark(), steel = M.steel(), chrome = M.chrome(), glass = K.glassMat();
    const hw = A.W / 2, zN = A.L / 2, zT = -A.L / 2;
    const zF = A.zF, zR = A.zF - A.WB, Ra = A.R + 0.08;
    const t = 0.07;
    const hhw = 1.04;                         // the hood is narrower than the box behind it
    // ---- THE HOOD + FRONT CLIP: flat armour plate, chamfered ----
    K.addPrism(root, hhw * 2, [
      [A.hoodB, 0], [A.hoodB, 0.72], [A.hoodF - 0.14, 0.54], [A.hoodF, 0.40], [A.hoodF, 0],
    ], 1.02, paint);
    RB(root, paint, -hhw, hhw, 0.72, 1.04, zF + Ra - 0.02, A.hoodF, 0.03);                 // the valance ahead of the wheels
    RB(root, paint, -hhw, hhw, 0.72, 1.04, A.hoodB, zF - Ra + 0.02, 0.02);
    sides(function (s) {
      wellLiner(root, s * (hhw - 0.24), A.R, zF, Ra, 0.46);
      // bolted armour flare over the well
      put(root, torusGeo(Ra + 0.02, 0.05, Math.PI), steel, s * (hhw + 0.03), A.R, zF, 0, Math.PI / 2, 0);
    });
    put(root, rbGeo(0.9, 0.04, 0.6, 0.015), dark, 0, 1.02 + 0.66, (A.hoodB + A.hoodF) / 2 - 0.15, 0.127, 0, 0);   // hood vent, on the hood's fall
    // ---- the grille, lamps, the ram ----
    const fz = A.hoodF;
    RB(root, dark, -0.62, 0.62, 1.08, 1.40, fz - 0.03, fz + 0.01, 0.02);
    for (let i = 0; i < 9; i++) BX(root, steel, -0.56 + i * 0.14 - 0.02, -0.56 + i * 0.14 + 0.02, 1.10, 1.38, fz, fz + 0.04);
    sides(function (s) {
      RB(root, dark, s * 0.86 - 0.14, s * 0.86 + 0.14, 1.12, 1.34, fz - 0.02, fz + 0.03, 0.02);
      BX(root, M.head(), s * 0.86 - 0.11, s * 0.86 + 0.11, 1.15, 1.31, fz + 0.03, fz + 0.04);
      BX(root, M.amber(), s * 0.86 - 0.10, s * 0.86 + 0.10, 1.04, 1.09, fz, fz + 0.03);
    });
    RB(root, steel, -hhw - 0.06, hhw + 0.06, 0.62, 0.96, fz, fz + 0.18, 0.03);             // the bumper
    sides(function (s) { RB(root, steel, s * 0.52 - 0.05, s * 0.52 + 0.05, 0.62, 1.30, fz + 0.12, zN, 0.02); });
    RB(root, steel, -0.62, 0.62, 1.18, 1.28, zN - 0.08, zN, 0.02);                          // the ram's top bar
    RB(root, M.rubber(), -0.58, 0.58, 0.70, 0.88, zN - 0.06, zN, 0.02);                     // and its pad
    sides(function (s) { BX(root, coat("hook", 0xb81d1d, 0.3, 0.5), s * 0.80 - 0.04, s * 0.80 + 0.04, 0.66, 0.74, fz + 0.18, fz + 0.26); });

    // ---- THE CAB: a shell round two real doors ----
    const dz0 = 0.24, dz1 = 1.26, dy0 = 0.95, dbelt = 1.90, dy1 = 2.52;
    const wsB = 1.76, wsT = 2.34, zWsB = A.hoodB - 0.02, zWsT = 1.24;
    sides(function (s) {
      RB(root, paint, s * (hw - t), s * hw, A.bot, A.top, dz1, A.hoodB, 0.02);           // A pillar block
      RB(root, paint, s * (hw - t), s * hw, A.bot, A.top, A.cabB, dz0, 0.02);            // B post
      RB(root, paint, s * (hw - t), s * hw, dy1, A.top, dz0, dz1, 0.01);                 // header
      RB(root, paint, s * (hw - t), s * hw, A.bot, dy0, dz0, dz1, 0.01);                 // sill
      // the cowl wing between the hood and the box side
      RB(root, paint, s * hhw, s * hw, A.bot, wsB, A.hoodB - 0.06, A.hoodB + 0.02, 0.02);
    });
    // the screen: two thick panes in a heavy frame, raked
    const rake = Math.atan2(zWsB - zWsT, wsT - wsB);
    const wsLen = (wsT - wsB) / Math.cos(rake), paneW = hw - t - 0.05;
    sides(function (s) {
      put(root, boxGeo(paneW, wsLen, 0.04), glass, s * (0.05 + paneW / 2), (wsB + wsT) / 2, (zWsB + zWsT) / 2, -rake, 0, 0);
      put(root, boxGeo(0.14, wsLen + 0.04, 0.12), paint, s * (hw - 0.07), (wsB + wsT) / 2, (zWsB + zWsT) / 2, -rake, 0, 0);
    });
    put(root, boxGeo(0.10, wsLen + 0.04, 0.10), paint, 0, (wsB + wsT) / 2, (zWsB + zWsT) / 2, -rake, 0, 0);
    RB(root, paint, -hw, hw, wsB - 0.08, wsB, zWsB - 0.10, zWsB + 0.06, 0.02);               // the cowl
    put(root, rbGeo(A.W, A.top - wsT, 0.16, 0.03), paint, 0, (wsT + A.top) / 2, zWsT - 0.04, 0, 0, 0);   // the brow
    RB(root, paint, -hw, hw, A.top - 0.07, A.top, A.cabB, zWsT, 0.03);                        // cab roof
    RB(root, paint, -hw + t, hw - t, A.bot, 1.15, A.cabB, A.hoodB, 0.01);                    // cab floor pan
    const doors = [];
    sides(function (s) {
      doors.push(boxDoor(root, {
        id: "F" + (s > 0 ? "L" : "R"), side: s, row: 0, z0: dz0, z1: dz1, x: hw, y0: dy0, belt: dbelt, y1: dy1,
        t: t, paint: paint, glass: glass, wz0: 0.10, wz1: 0.60, wy0: dbelt + 0.04, wy1: dy1 - 0.10, handleMat: dark,
        decal: function (g, len, xc, sd) {
          leafDecal(g, D.word("SWAT", "#f2f4f6"), len * 0.70, 0.22, sd, len / 2, 1.42);
          put(g, cylGeo(0.05, 0.05, 0.03, 12), dark, sd * 0.012, 1.74, -0.80, 0, 0, Math.PI / 2);   // gun port
        },
      }));
      RB(root, M.plate(), s * (hw - 0.02), s * (hw + 0.20), 0.52, 0.58, -1.45, 1.42, 0.012);   // running board
      BX(root, steel, s * (hw - 0.02), s * (hw + 0.04), 0.50, 0.60, -1.40, -1.30);
      BX(root, steel, s * (hw - 0.02), s * (hw + 0.04), 0.50, 0.60, 1.30, 1.40);
    });
    K.dressCabin(root, {
      cabW: (hw - t) * 2, zR: A.cabB + 0.06, zF: A.hoodB - 0.10,
      zTR: A.cabB + 0.06, zTF: zWsT, roofW: (hw - t) * 2,
      beltY: dbelt, roofY: A.top - 0.10,
      floorY: 1.15, rows: 1, seatLayout: "cab2",
      doorSpans: [[dz0, dz1]],
      doors: doors.map(function (g) { const d = g.userData.carDoor; return { id: d.id, side: d.side, row: d.row, z0: d.z0, z1: d.z1 }; }),
    });
    // ---- THE BOX behind the cab ----
    const wf = zR + Ra, wb = zR - Ra, wTop = 1.06;
    RB(root, paint, -hw, hw, wTop, A.top, zT + 0.05, A.cabB, 0.04);
    RB(root, paint, -hw, hw, A.bot, wTop, wf, A.cabB, 0.03);
    RB(root, paint, -hw, hw, A.bot, wTop, zT + 0.05, wb, 0.03);
    sides(function (s) {
      BX(root, M.well(), s * (hw - 0.36), s * hw, wTop - 0.02, wTop + 0.001, wb, wf);
      put(root, torusGeo(Ra + 0.02, 0.05, Math.PI), steel, s * (hw + 0.03), A.R, zR, 0, Math.PI / 2, 0);
      // small armoured windows with a gun port under each, the POLICE side word
      [-0.55, -2.15].forEach(function (z) {
        RB(root, steel, s * hw - 0.01, s * hw + 0.02, 1.98, 2.36, z - 0.22, z + 0.22, 0.02);
        BX(root, M.tint(), s * (hw + 0.02), s * (hw + 0.026), 2.03, 2.31, z - 0.17, z + 0.17);
        put(root, cylGeo(0.05, 0.05, 0.03, 12), dark, s * (hw + 0.012), 1.84, z, 0, 0, Math.PI / 2);
      });
      flatDecal(root, D.wide("POLICE", "#f2f4f6"), 2.1, 0.33, s * (hw + 0.004), 1.48, -1.35, s > 0 ? "+x" : "-x");
      // roof rails
      BX(root, steel, s * (hw - 0.14), s * (hw - 0.10), A.top + 0.10, A.top + 0.14, zT + 0.3, A.cabB - 0.1);
      [-0.2, -1.4, -2.6].forEach(function (z) { BX(root, steel, s * (hw - 0.14), s * (hw - 0.10), A.top, A.top + 0.12, z - 0.02, z + 0.02); });
    });
    // the roof hatch: a ring and a lid
    CYL(root, steel, 0.48, 0.12, 0, A.top + 0.06, -0.95, "y", 22);
    CYL(root, paint, 0.42, 0.06, 0, A.top + 0.14, -0.95, "y", 22);
    put(root, rbGeo(0.24, 0.04, 0.06, 0.015), dark, 0, A.top + 0.19, -0.95);
    flatDecal(root, D.unit("S1", "#f2f4f6"), 0.8, 0.4, 0, A.top + 0.002, -2.2, "+y");
    // the rear: two doors with windows and ports, a step, tails
    const rz = zT + 0.05;
    BX(root, dark, -0.012, 0.012, 1.02, 2.62, rz - 0.012, rz);
    sides(function (s) {
      RB(root, steel, s * 0.30 - 0.18, s * 0.30 + 0.18, 2.02, 2.36, rz - 0.02, rz + 0.01, 0.02);
      BX(root, M.tint(), s * 0.30 - 0.13, s * 0.30 + 0.13, 2.06, 2.32, rz - 0.026, rz - 0.02);
      put(root, cylGeo(0.05, 0.05, 0.03, 12), dark, s * 0.30, 1.86, rz - 0.012, Math.PI / 2, 0, 0);
      put(root, rbGeo(0.14, 0.04, 0.04, 0.01), dark, s * 0.08, 1.55, rz - 0.02);
      [1.25, 2.30].forEach(function (y) { put(root, rbGeo(0.05, 0.14, 0.04, 0.01), steel, s * (hw - 0.10), y, rz - 0.02); });
      BX(root, M.tail(), s * (hw - 0.17) - 0.07, s * (hw - 0.17) + 0.07, 1.16, 1.40, rz - 0.03, rz - 0.01);
      BX(root, M.amber(), s * (hw - 0.17) - 0.07, s * (hw - 0.17) + 0.07, 1.06, 1.14, rz - 0.03, rz - 0.01);
      BX(root, M.rev(), s * (hw - 0.17) - 0.07, s * (hw - 0.17) + 0.07, 0.96, 1.04, rz - 0.03, rz - 0.01);
      flatDecal(root, D.word("SWAT", "#f2f4f6"), 0.62, 0.20, s * 0.31, 1.66, rz - 0.004, "-z");
    });
    RB(root, steel, -hw + 0.05, hw - 0.05, 0.52, 0.72, zT - 0.05, rz, 0.02);               // rear step bumper
    // ---- the lights ----
    const R = new Rig(false);
    R.bar(0, A.top, A.cabB + 0.55, 1.10, function (i, n, dx) {
      if (Math.abs(dx) < 0.1) return ["w", "W"];
      return dx > 0 ? ["r", "A"] : ["b", "B"];
    }, { n: 10, depth: 0.26 });
    sides(function (s) {
      R.lamp(s > 0 ? "r" : "b", s > 0 ? "A" : "B", s * (hw - 0.16), A.top - 0.16, zWsT + 0.045, 0.18, 0.08, 0);      // brow corners
      R.lamp(s > 0 ? "r" : "b", s > 0 ? "B" : "A", s * (hw - 0.18), A.top - 0.16, rz - 0.003, 0.20, 0.09, Math.PI); // rear corners
      R.lamp(s > 0 ? "r" : "b", s > 0 ? "B" : "A", s * 0.40, 1.24, fz + 0.045, 0.12, 0.04, 0, false);              // grille heads
      R.lamp(s > 0 ? "r" : "b", s > 0 ? "A" : "B", s * (hw + 0.002), A.top - 0.18, -1.35, 0.18, 0.08, s * Math.PI / 2);   // side
      R.lamp("w", null, s * (hw + 0.002), A.top - 0.18, -2.75, 0.30, 0.09, s * Math.PI / 2);                     // scene light
    });
    root.add(R.group("bearcat"));
    // spotlights at the brow corners, antennas
    sides(function (s) {
      CYL(root, chrome, 0.07, 0.16, s * (hw - 0.30), A.top + 0.10, zWsT - 0.05, "z", 14, 0.06);
      CYL(root, dark, 0.006, 0.5, s * (hw - 0.4), A.top + 0.25, -2.9, "y", 5, 0.01);
    });
    // ---- wheels ----
    const rim = parts() ? parts().rimStyleFor("bearcat") : "steel";
    wheelsAt(root, A.R, A.WW, 0.98, zF, rim, 0.55, 0);
    wheelsAt(root, A.R, A.WW + 0.04, 0.98, zR, rim, 0.55, 0);

    root.userData.loftBody = true;
    root.userData.vehicleDims = { width: A.W, length: A.L, height: A.top + 0.2, wheelbase: A.WB };
    return root;
  }

  CBZ.carStyleBuilders = CBZ.carStyleBuilders || {};
  CBZ.carStyleBuilders.ambulance = buildAmbulance;
  CBZ.carStyleBuilders.firetruck = buildFireEngine;
  CBZ.carStyleBuilders.bearcat = buildBearcat;

  /* ============================================================
     THE FLEET'S MODELS — the one place each emergency vehicle's catalogue
     record is written, so traffic.js / police.js / motorcade / custody all
     spawn the same thing. `unit` is the number painted on it.
  ============================================================ */
  const MODELS = {
    interceptor: [12, 27, 41].map(function (u) {
      return { name: "Police Interceptor", value: 4200, rarity: 0.6, color: 0x111317, body: "suv", detailStyle: "interceptor", livery: "police", unit: String(u) };
    }),
    pursuit: [8, 33].map(function (u) {
      return { name: "Police Pursuit", value: 4000, rarity: 0.65, color: 0x111317, body: "muscle", detailStyle: "pursuit", livery: "police", unit: String(u) };
    }),
    ambulance: { name: "Ambulance", value: 3800, rarity: 0.5, color: 0xf2f4f6, body: "van", detailStyle: "ambulance", s: 1 },
    firetruck: { name: "Fire Engine", value: 6500, rarity: 0.45, color: 0xb3121a, body: "truck", detailStyle: "firetruck", s: 1 },
    bearcat: { name: "SWAT Armored Truck", value: 12000, rarity: 0.55, color: 0x15181b, body: "truck", detailStyle: "bearcat", armor: 0.6, s: 1 },
  };
  let cruiserN = 0;
  // a police unit: Interceptors outnumber Pursuits about 3:2, as on a real fleet
  function cruiserModel() {
    const i = cruiserN++ % 5;
    return i < 3 ? MODELS.interceptor[i] : MODELS.pursuit[i - 3];
  }

  /* ============================================================
     THE FLASHER. Every system that lights a unit up (police.js's roadblock,
     patrol, SWAT; traffic.js's dispatch; checkpoints; the motorcade) flips
     the same three named layers.
  ============================================================ */
  function barOf(grp) {
    if (!grp) return null;
    let bar = null;
    grp.traverse(function (o) { if (!bar && o.name === "police_lightbar") bar = o; });
    if (!bar) return null;
    const find = (n) => { let r = null; bar.traverse(function (o) { if (!r && o.name === n) r = o; }); return r; };
    return { red: find("lb_red"), blue: find("lb_blue"), mid: find("lb_mid"), phase: 0 };
  }
  function flash(bar, t) {
    if (!bar) return;
    const on = ((t * 4.4) | 0) & 1;
    if (bar.red) bar.red.visible = !!on;
    if (bar.blue) bar.blue.visible = !on;
    if (bar.mid) bar.mid.visible = (((t * 8.8) | 0) & 3) === 1;
  }
  function dark(bar) {
    if (!bar) return;
    if (bar.red) bar.red.visible = false;
    if (bar.blue) bar.blue.visible = false;
    if (bar.mid) bar.mid.visible = false;
  }
  /* THE AMBULANCE'S REAR DOORS: t 0 shut .. 1 open (~100 degrees, the leaves
     swung out and round). False when the body has none. */
  function rearDoors(car, t) {
    const grp = car && car.group;
    if (!grp) return false;
    if (car._emgRear === undefined) {
      const L = grp.getObjectByName("emg_rear_L"), Rr = grp.getObjectByName("emg_rear_R");
      car._emgRear = (L || Rr) ? { L: L || null, R: Rr || null } : null;
    }
    const d = car._emgRear;
    if (!d) return false;
    t = clamp(+t || 0, 0, 1);
    const a = 1.75 * t;
    if (d.L && Math.abs(d.L.rotation.y + a) < 1e-4 && d.R && Math.abs(d.R.rotation.y - a) < 1e-4) return true;
    if (car._proxy && CBZ.cityWakeCar) CBZ.cityWakeCar(car);
    if (d.L) d.L.rotation.y = -a;
    if (d.R) d.R.rotation.y = a;
    return true;
  }

  CBZ.emergencyKit = {
    policeLivery: policeLivery,
    models: MODELS,
    cruiserModel: cruiserModel,
    barOf: barOf, flash: flash, dark: dark,
    rearDoors: rearDoors,
    // exported for audits / future liveries
    skinDecal: skinDecal, decalMat: decalMat, Rig: Rig,
  };
})();
