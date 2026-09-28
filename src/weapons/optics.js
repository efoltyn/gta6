/* ============================================================
   weapons/optics.js — THE riflescope factory (CBZ.createWeaponOptic).

   The sniper's factory scope and every gunsmith scope (city/gunmods.js) are
   this one model, so a bought scope never looks different from the issued
   one. It is a real riflescope, not a stack of cylinders:

   · ONE turned shell (LatheGeometry) for the whole body — eyepiece, ocular
     taper, 30 mm-class main tube, objective bell — with a real wall: look
     into either end and you see the bore of the scope and the glass set
     INTO it, not a disc stuck on a pipe.
   · highMag (Leupold Mark 4 / M3A 10x42 class): a knurled fast-focus ring
     on the eyepiece, the square turret saddle, tall target turrets
     (elevation on top, windage on the right) with knurled caps, and a
     side-focus (parallax) knob on the left.
     !highMag (a compact 1-4x class): a big power ring with its throw lever,
     low capped turrets, a short bell.
   · two split scope rings (lower half + cap, four cap screws each) whose
     feet are Picatinny clamps with a cross-bolt nut, on a toothed base.
   · coated glass (the tinted lens material) at the objective and the ocular,
     with a duplex reticle seated just inside the ocular glass.

   Geometry is cached by its PARAMETERS (a second scope with the same size
   reuses every buffer); materials are module-shared unless the caller hands
   in its own `materials` table.

   opts: name, x, y, z (the TUBE AXIS centre), length, radius (main tube),
   objectiveRadius, ocularRadius, highMag, tint, materials {dark, steel},
   scale, mountDrop (tube axis -> bottom of the base, default radius+0.068),
   mag, k (model units per real metre, default 2.0).

   It stamps its own anchor record (userData.opticAnchors, the contract at
   the top of weapons/appearances/sidearm.js): rear = the ocular lens centre,
   front = the objective lens centre, the eye point eyeRelief (real metres)
   x k behind the ocular.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  const THREE = window.THREE;
  if (!THREE) return;

  /* ---------------------------------------------------------- materials */
  const shared = {};
  function material(name, make) {
    if (!shared[name]) { shared[name] = make(); shared[name]._shared = true; }
    return shared[name];
  }
  const fallbackDark = () => material("optic-dark", () => new THREE.MeshStandardMaterial({ color: 0x11151a, roughness: 0.36, metalness: 0.72 }));
  const fallbackSteel = () => material("optic-steel", () => new THREE.MeshStandardMaterial({ color: 0x4c5661, roughness: 0.3, metalness: 0.84 }));
  // coated glass: the tint is the coating's colour seen in reflection
  function lensMat(hex) {
    const key = "lens-" + (hex >>> 0).toString(16);
    return material(key, () => new THREE.MeshPhysicalMaterial({
      color: hex, emissive: hex, emissiveIntensity: 0.18,
      roughness: 0.04, metalness: 0.08, transparent: true, opacity: 0.72,
      depthWrite: false, side: THREE.DoubleSide,
    }));
  }
  const reticleMat = () => material("reticle", () => new THREE.MeshBasicMaterial({ color: 0x050607, transparent: true, opacity: 0.92, depthWrite: false, side: THREE.DoubleSide }));
  function tintHex(v) {
    if (typeof v === "number") return v;
    if (typeof v === "string") { try { return new THREE.Color(v).getHex(); } catch (e) {} }
    return 0x9cdcff;
  }

  /* ---------------------------------------------------------- geometry */
  const GEO = new Map();
  function geo(key, make) {
    let g = GEO.get(key);
    if (!g) {
      g = make();
      g._shared = true;
      // a bundle of buffers: every one is shared (disposers skip _shared)
      if (!g.isBufferGeometry) for (const k in g) if (g[k] && g[k].isBufferGeometry) g[k]._shared = true;
      GEO.set(key, g);
    }
    return g;
  }
  const n4 = (v) => (+v).toFixed(4);
  function add(g, geometry, m, x, y, z, rx, ry, rz) {
    const mesh = new THREE.Mesh(geometry, m);
    mesh.position.set(x || 0, y || 0, z || 0);
    mesh.rotation.set(rx || 0, ry || 0, rz || 0);
    mesh.castShadow = false;
    g.add(mesh);
    return mesh;
  }
  // [r, f] turned about the bore (f forward = -z); a third element true
  // doubles the point so the lathe keeps a crisp edge there
  function latheGeo(pts, segs, alongY) {
    const v = [];
    pts.forEach(function (p) {
      const q = new THREE.Vector2(Math.max(0, p[0]), p[1]);
      v.push(q);
      if (p[2]) v.push(q.clone());
    });
    const g = new THREE.LatheGeometry(v, segs);
    if (!alongY) g.rotateX(-Math.PI / 2);   // +y (forward) -> -z
    return g;
  }
  function poly(Ctor, pts) {
    const s = new Ctor();
    s.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
    s.closePath();
    return s;
  }
  function arcPts(cx, cy, r, a0, a1, n) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * (i / n);
      out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return out;
  }
  // a front profile (x, y) extruded along the bore, centred on z = 0
  function extrudeZ(shapes, depth, bevel) {
    const d = Math.max(0.0005, depth - 2 * bevel);
    const g = new THREE.ExtrudeGeometry(shapes, {
      depth: d, steps: 1, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel,
      bevelSegments: 1, curveSegments: 6,
    });
    g.translate(0, 0, -d / 2);
    g.computeVertexNormals();
    return g;
  }
  // knurled band: flat-topped ribs round a ring, extruded along z
  function knurlGeo(rOut, rIn, n, len) {
    return geo("knurl:" + [n4(rOut), n4(rIn), n, n4(len)].join(":"), function () {
      const pts = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2, w = Math.PI * 2 / n;
        pts.push([Math.cos(a) * rOut, Math.sin(a) * rOut], [Math.cos(a + w * 0.5) * rOut, Math.sin(a + w * 0.5) * rOut],
          [Math.cos(a + w * 0.62) * rIn, Math.sin(a + w * 0.62) * rIn], [Math.cos(a + w * 0.88) * rIn, Math.sin(a + w * 0.88) * rIn]);
      }
      return extrudeZ(poly(THREE.Shape, pts), len, 0);
    });
  }

  /* The main shell: outside from the eyepiece lip to the objective lip,
     then the inner wall back to where it started (a closed section, so the
     ends are real hollow bells). u runs 0 (rear lip) .. 1 (front lip). */
  function shellLayout(L, tR, ocR, bR, high) {
    const F = (u) => -L / 2 + u * L, w = tR * 0.14;
    const S = high
      ? { eyeEnd: 0.17, tube0: 0.27, tube1: 0.66, bell: 0.885, knurl: [0.055, 0.150] }
      : { eyeEnd: 0.30, tube0: 0.39, tube1: 0.76, bell: 0.88, knurl: [0.17, 0.285] };
    const outer = high ? [
      [ocR * 0.90, F(0), true], [ocR, F(0.012), true], [ocR, F(S.eyeEnd), true], [ocR * 0.95, F(S.eyeEnd + 0.006), true],
      [tR * 1.07, F(0.25)], [tR, F(S.tube0), true], [tR, F(S.tube1), true], [tR * 1.05, F(0.69)],
      [bR * 0.96, F(0.86)], [bR, F(S.bell), true], [bR, F(0.995), true], [bR * 0.95, F(1), true],
    ] : [
      [ocR * 0.90, F(0), true], [ocR, F(0.015), true], [ocR, F(S.eyeEnd), true], [ocR * 0.94, F(S.eyeEnd + 0.01), true],
      [tR * 1.05, F(0.37)], [tR, F(S.tube0), true], [tR, F(S.tube1), true], [tR * 1.04, F(0.79)],
      [bR, F(S.bell), true], [bR, F(0.995), true], [bR * 0.95, F(1), true],
    ];
    const inner = [
      [bR - w, F(1), true], [bR - w, F(0.965)], [tR - w, F(high ? 0.80 : 0.84)], [tR - w, F(high ? 0.26 : 0.38)],
      [ocR - w, F(high ? 0.10 : 0.22)], [ocR - w, F(0), true], [ocR * 0.90, F(0)],
    ];
    return {
      pts: outer.concat(inner), F: F, S: S,
      ocZ: -F(0.02), ocLensR: ocR - w, objZ: -F(0.97), objLensR: bR - w,
    };
  }

  /* One split ring (lower half with its stem and Picatinny clamp, the cap,
     four cap screws, the cross-bolt nut), all in the ring's own space with
     the tube axis at the origin. */
  function ringGeos(tR, ringW, drop) {
    const key = [n4(tR), n4(ringW), n4(drop)].join(":");
    return geo("ring:" + key, function () {
      const ri = tR * 1.0, ro = tR * 1.28, e = tR * 0.34, earH = tR * 0.30, gap = tR * 0.03;
      const stemW = tR * 0.52, clampW = tR * 0.84, railHalf = tR * 0.70;
      const yb = -drop, railTop = yb + tR * 0.30, teethTop = railTop + tR * 0.16;
      const clampTop = Math.min(teethTop + tR * 0.22, -ro - tR * 0.04), clampBot = railTop - tR * 0.16;
      const aEar = Math.asin(Math.min(0.95, earH / ro)), aStem = Math.acos(Math.min(0.95, stemW / ro));
      const lower = [[ri, 0], [ro + e, 0], [ro + e, -earH]]
        .concat(arcPts(0, 0, ro, -aEar, -aStem, 5))
        .concat([[stemW, clampTop], [clampW, clampTop], [clampW, clampBot], [railHalf, clampBot], [railHalf, teethTop],
          [-railHalf, teethTop], [-railHalf, clampBot], [-clampW, clampBot], [-clampW, clampTop], [-stemW, clampTop]])
        .concat(arcPts(0, 0, ro, -Math.PI + aStem, -Math.PI + aEar, 5))
        .concat([[-ro - e, -earH], [-ro - e, 0], [-ri, 0]])
        .concat(arcPts(0, 0, ri, Math.PI, 2 * Math.PI, 14).slice(1, -1));
      const cap = [[ro + e, gap], [ro + e, gap + earH]]
        .concat(arcPts(0, gap, ro, aEar, Math.PI - aEar, 12))
        .concat([[-ro - e, gap + earH], [-ro - e, gap], [-ri, gap]])
        .concat(arcPts(0, gap, ri, Math.PI, 0, 14).slice(1, -1))
        .concat([[ri, gap]]);
      const bevel = Math.min(0.002, ringW * 0.08);
      // four hex screw heads on the cap's ears (shapes in x, -z; extruded up)
      const heads = [];
      const hr = e * 0.36, hz = ringW * 0.24;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const cx = sx * (ro + e * 0.5), cy = -sz * hz, hex = [];
        for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; hex.push([cx + Math.cos(a) * hr, cy + Math.sin(a) * hr]); }
        heads.push(poly(THREE.Shape, hex));
      }
      const hg = new THREE.ExtrudeGeometry(heads, { depth: tR * 0.10, bevelEnabled: false, curveSegments: 1 });
      hg.rotateX(-Math.PI / 2);
      hg.translate(0, gap + earH, 0);
      hg.computeVertexNormals();
      // cross-bolt nut out of the clamp's left jaw
      const nut = new THREE.CylinderGeometry(tR * 0.20, tR * 0.20, tR * 0.22, 6);
      nut.rotateZ(Math.PI / 2);
      nut.translate(-clampW - tR * 0.09, (clampTop + clampBot) / 2, 0);
      return {
        lower: extrudeZ(poly(THREE.Shape, lower), ringW, bevel),
        cap: extrudeZ(poly(THREE.Shape, cap), ringW, bevel),
        heads: hg, nut: nut, railTop: railTop, teethTop: teethTop, railHalf: railHalf, yb: yb,
      };
    });
  }
  // the toothed Picatinny base the rings clamp to, z0 (rear) .. z1 (front)
  function baseGeo(tR, z0, z1, yb, railTop, teethTop, railHalf) {
    return geo("base:" + [n4(tR), n4(z0), n4(z1), n4(yb)].join(":"), function () {
      const f0 = -z0, f1 = -z1, pitch = tR * 0.66, pts = [[f0, yb], [f1, yb], [f1, railTop]];
      for (let f = f1 - pitch * 0.25; f - pitch * 0.5 > f0 + pitch * 0.2; f -= pitch) {
        pts.push([f, railTop], [f, teethTop], [f - pitch * 0.5, teethTop], [f - pitch * 0.5, railTop]);
      }
      pts.push([f0, railTop]);
      const d = railHalf * 2 - 0.002;
      const g = new THREE.ExtrudeGeometry(poly(THREE.Shape, pts), { depth: d, bevelEnabled: true, bevelThickness: 0.001, bevelSize: 0.001, bevelSegments: 1 });
      g.translate(0, 0, -d / 2);
      g.rotateY(Math.PI / 2);                 // shape x (forward) -> -z, depth -> x
      g.computeVertexNormals();
      return g;
    });
  }
  // rounded-square turret saddle round the tube
  function saddleGeo(tR, len) {
    return geo("saddle:" + n4(tR) + ":" + n4(len), function () {
      const b = tR * 0.06, s = tR * 1.22 - b, c = tR * 0.38, pts = [];
      for (const [cx, cy, a0] of [[s - c, s - c, 0], [-(s - c), s - c, Math.PI / 2], [-(s - c), -(s - c), Math.PI], [s - c, -(s - c), Math.PI * 1.5]]) {
        arcPts(cx, cy, c, a0, a0 + Math.PI / 2, 3).forEach((p) => pts.push(p));
      }
      return extrudeZ(poly(THREE.Shape, pts), len, b);
    });
  }
  // a turret: collar out of the saddle face, knurled cap band, domed top.
  // Built standing on +Y; windage/parallax meshes are rotated onto x.
  function turretGeos(tR, tT, low) {
    return geo("turret:" + n4(tR) + ":" + n4(tT) + ":" + (low ? 1 : 0), function () {
      const y0 = tR * 0.95, sTop = tR * 1.22;
      const c1 = sTop + tT * (low ? 0.10 : 0.28), c2 = c1 + tT * (low ? 0.34 : 0.52);
      const body = latheGeo([
        [0, y0], [tT * 0.70, y0, true], [tT * 0.70, c1, true], [tT * 0.74, c1, true], [tT * 0.74, c2, true],
        [tT * 0.68, c2, true], [tT * 0.68, c2 + tT * 0.05], [tT * 0.58, c2 + tT * 0.10, true], [0, c2 + tT * 0.11],
      ], 20, true);
      const knurl = knurlGeo(tT * 0.82, tT * 0.77, 22, c2 - c1).clone();
      knurl.rotateX(-Math.PI / 2);               // extrusion z -> +y
      knurl.translate(0, (c1 + c2) / 2, 0);
      const knob = latheGeo([
        [0, y0], [tT * 0.56, y0, true], [tT * 0.56, sTop + tT * 0.16, true], [tT * 0.80, sTop + tT * 0.22],
        [tT * 0.80, sTop + tT * 0.46, true], [tT * 0.70, sTop + tT * 0.54, true], [0, sTop + tT * 0.56],
      ], 22, true);
      return { body: body, knurl: knurl, knob: knob };
    });
  }
  // duplex reticle: thick outer posts, a fine centre cross
  function reticleGeo(r) {
    return geo("reticle:" + n4(r), function () {
      const fine = r * 0.018, thick = r * 0.07, inR = r * 0.34, rects = [];
      const rect = (x0, y0, x1, y1) => rects.push(poly(THREE.Shape, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]));
      rect(-inR, -fine, inR, fine); rect(-fine, -inR, fine, inR);
      rect(inR, -thick, r, thick); rect(-r, -thick, -inR, thick);
      rect(-thick, inR, thick, r); rect(-thick, -r, thick, -inR);
      return new THREE.ShapeGeometry(rects);
    });
  }

  /* An optic's anchors, CBZ.gunAnchors.optic when the kit is loaded;
     inlined (same record) on a page where this file runs first. */
  function stampAnchors(g, o) {
    const GA = CBZ.gunAnchors;
    if (GA && GA.optic) return GA.optic(THREE, g, o);
    const rear = new THREE.Vector3().fromArray(o.rear), front = new THREE.Vector3().fromArray(o.front);
    const dir = front.clone().sub(rear).normalize();
    const zAx = dir.clone().negate(), xAx = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), zAx).normalize();
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAx, new THREE.Vector3().crossVectors(zAx, xAx), zAx));
    const rec = {
      optic: { type: o.type, mag: o.mag },
      sight: { pos: rear.clone().addScaledVector(dir, -o.eyeRelief * o.k), quat: q, eyeRelief: o.eyeRelief, rear: rear, front: front },
      lens: { pos: rear.clone(), quat: q.clone(), radius: o.lensR },
    };
    g.userData.opticAnchors = rec;
    return rec;
  }

  CBZ.createWeaponOptic = function (opts) {
    opts = opts || {};
    const high = opts.highMag !== false;
    const L = opts.length || (high ? 0.46 : 0.22);
    const tR = opts.radius || (high ? 0.043 : 0.033);
    const bR = opts.objectiveRadius || tR * (high ? 1.58 : 1.28);
    const ocR = opts.ocularRadius || tR * 1.28;
    const drop = Math.max(tR * 2.05, opts.mountDrop || (tR + 0.068));
    const mats = opts.materials || {};
    const dark = mats.dark || fallbackDark();
    const steel = mats.steel || fallbackSteel();
    const glass = lensMat(tintHex(opts.tint));
    const g = new THREE.Group();
    g.name = opts.name || "weapon-optic";
    g.userData.isWeaponOptic = true;

    // THE SHELL: eyepiece, taper, main tube, objective bell — one lathe
    const lay = shellLayout(L, tR, ocR, bR, high);
    const shellKey = "shell:" + [n4(L), n4(tR), n4(ocR), n4(bR), high ? 1 : 0].join(":");
    add(g, geo(shellKey, () => latheGeo(lay.pts, 28)), dark);
    const F = lay.F, S = lay.S;
    // focus ring (high) / power ring (low): a knurled band on the eyepiece
    const kf0 = F(S.knurl[0]), kf1 = F(S.knurl[1]);
    add(g, knurlGeo(ocR * 1.035, ocR * 0.99, high ? 36 : 30, kf1 - kf0), dark, 0, 0, -(kf0 + kf1) / 2);
    if (!high) {
      // the power ring's throw lever, standing off the ring at two o'clock
      const lev = geo("throw:" + n4(ocR) + ":" + n4(kf1 - kf0), () => extrudeZ(poly(THREE.Shape, [
        [-ocR * 0.10, ocR * 0.98], [ocR * 0.10, ocR * 0.98], [ocR * 0.07, ocR * 1.42], [-ocR * 0.07, ocR * 1.42],
      ]), (kf1 - kf0) * 0.6, 0.001));
      add(g, lev, dark, 0, 0, -(kf0 + kf1) / 2, 0, 0, -0.9);
    }

    // TURRET SADDLE + turrets, rings clear of it on the straight tube
    const tube0 = F(S.tube0), tube1 = F(S.tube1), straight = tube1 - tube0;
    const saddleLen = Math.min(tR * 2.2, straight * 0.46);
    const ringW = Math.min(tR * 0.95, straight * 0.20);
    const sF = (tube0 + tube1) / 2 + (high ? 0 : straight * 0.04);
    add(g, saddleGeo(tR, saddleLen), dark, 0, 0, -sF);
    const tT = Math.min(tR, saddleLen / 2.0);
    const T = turretGeos(tR, tT, !high);
    add(g, T.body, dark, 0, 0, -sF);                                   // elevation, top
    add(g, T.knurl, dark, 0, 0, -sF);
    add(g, T.body, dark, 0, 0, -sF, 0, 0, -Math.PI / 2);               // windage, right
    add(g, T.knurl, dark, 0, 0, -sF, 0, 0, -Math.PI / 2);
    if (high) add(g, T.knob, dark, 0, 0, -sF, 0, 0, Math.PI / 2);      // side focus, left

    // RINGS on their Picatinny base
    const gap = tR * 0.08 + ringW / 2 + saddleLen / 2;
    const ringF = [Math.max(tube0 + ringW * 0.55, sF - gap - (high ? straight * 0.06 : 0)), Math.min(tube1 - ringW * 0.55, sF + gap + (high ? straight * 0.06 : 0))];
    const R = ringGeos(tR, ringW, drop);
    for (const f of ringF) {
      add(g, R.lower, dark, 0, 0, -f);
      add(g, R.cap, dark, 0, 0, -f);
      add(g, R.heads, steel, 0, 0, -f);
      add(g, R.nut, steel, 0, 0, -f);
    }
    add(g, baseGeo(tR, -(ringF[0] - ringW * 1.1), -(ringF[1] + ringW * 1.1), R.yb, R.railTop, R.teethTop, R.railHalf), dark);

    // GLASS: objective (facing out the front), ocular (facing the eye),
    // the reticle just inside the ocular
    add(g, geo("disc:" + n4(lay.objLensR), () => new THREE.CircleGeometry(lay.objLensR, 28)), glass, 0, 0, lay.objZ, 0, Math.PI, 0);
    add(g, geo("disc:" + n4(lay.ocLensR), () => new THREE.CircleGeometry(lay.ocLensR, 28)), glass, 0, 0, lay.ocZ);
    add(g, reticleGeo(lay.ocLensR * 0.98), reticleMat(), 0, 0, lay.ocZ - tR * 0.10);

    g.position.set(opts.x || 0, opts.y || 0, opts.z || 0);
    const s = opts.scale == null ? 1 : opts.scale;
    g.scale.setScalar(s);
    stampAnchors(g, {
      type: "scope", mag: opts.mag || (high ? 10 : 4),
      rear: [0, 0, lay.ocZ], front: [0, 0, lay.objZ], lensR: lay.ocLensR,
      eyeRelief: high ? 0.09 : 0.08, k: opts.k || 2.0,
    });
    return g;
  };
})();
