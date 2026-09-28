/* ============================================================
   world/ladderkit.js — THE LADDER, DRAWN. One rung ladder for every tower.

   systems/climb.js is the ONE climb (the body on the rungs, the verb, the
   NPC nav link). This file is the ONE ladder it climbs: the steel you see,
   built from the SAME numbers climb.js reads, so every rung a hand closes on
   is a rung that is drawn, at the height climb.js puts the hand.

     CBZ.ladderKit.spec(o)        the climb record (defaults filled in)
     CBZ.ladderKit.parts(o)       indexed BufferGeometries (stiles, rungs,
                                  stand-off brackets, a safety cage over 6 m)
                                  in the caller's frame — for a kit that merges
                                  its own shapes (city/compoundkit.js)
     CBZ.ladderKit.build(root, o) parts merged into ONE mesh under `root`, and
                                  the ladder registered with climb.js
     CBZ.ladderKit.register(o)    climb.js's add(), or its parse-order queue
                                  (CBZ.ladderSpecs) when climb.js is not up yet
     CBZ.ladderKit.deck(o)        a landing you can stand on: the platform
                                  record (CBZ.platforms) + height-gated rail
                                  colliders round its edge with a gap where the
                                  ladder comes over, and (opts.root) the rails
                                  drawn to match

   o (the ladder): x, z the rung line at the foot; nx, nz unit normal from the
   rungs toward the side the climber hangs on; y0 floor at the foot; y1 the
   landing floor; rungTop (default y1; above y1 for a hatch ladder); r0 (0.35),
   rung (0.30); ext: how far the stiles run on above the landing (1.1, the
   grab rails you step off between); standoff: metres from the rung line back
   to the structure (brackets drawn every ~3 m; 0 = none); cage: true/false
   (default: rise over 6 m); top/bottom stand points, name, tag, mode — passed
   straight to climb.js.

   Cheap by construction: one merged geometry and one shared material per
   ladder, no lights, r128 API only.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE) return;
  if (CBZ.ladderKit) return;

  const HALF = 0.24;          // stile half-spacing (climb.js slides its hands down the stiles at 0.24)
  const CAGE_R = 0.42;        // hoop radius; its ends land on the stiles
  const CAGE_DELTA = Math.acos(HALF / CAGE_R);            // the arc runs this far past a half-circle each side
  const CAGE_C = CAGE_R * Math.sin(CAGE_DELTA);           // hoop centre out along n (so the ends sit ON the stiles)

  let _mat = null;
  function galv() {
    if (_mat) return _mat;
    _mat = CBZ.cmat ? CBZ.cmat(0x9aa1a8) : new THREE.MeshLambertMaterial({ color: 0x9aa1a8 });
    return _mat;
  }

  function num(v, d) { v = +v; return isFinite(v) ? v : d; }

  function spec(o) {
    let nx = num(o.nx, 0), nz = num(o.nz, 1);
    const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
    const y0 = num(o.y0, 0), y1 = num(o.y1, y0 + 3);
    const s = {
      x: +o.x, z: +o.z, nx: nx, nz: nz, y0: y0, y1: y1,
      rung: num(o.rung, 0.30), r0: num(o.r0, 0.35),
      rungTop: o.rungTop != null ? +o.rungTop : y1,
      stand: o.stand, name: o.name || "", tag: o.tag || "", meta: o.meta || null,
      mode: o.mode || null,
    };
    if (o.top) s.top = { x: +o.top.x, z: +o.top.z };
    if (o.bottom) s.bottom = { x: +o.bottom.x, z: +o.bottom.z };
    if (o.onAdd) s.onAdd = o.onAdd;
    if (o.topVia) s.topVia = o.topVia;
    return s;
  }
  // the rung heights, EXACTLY climb.js's rungPt: y0 + r0 + i * rung, i = 0..iMax
  function rungYs(s) {
    const iMax = Math.max(1, Math.floor((s.rungTop - s.y0 - s.r0) / s.rung + 1e-6));
    const out = [];
    for (let i = 0; i <= iMax; i++) out.push(s.y0 + s.r0 + i * s.rung);
    return out;
  }

  /* THE FRAME. Every part is authored with X across the ladder, Y up and Z
     out toward the climber (n), then turned into the caller's frame by one
     basis matrix: X = (nz, 0, -nx), Y = up, Z = n (X x Y = Z, a rotation). */
  const _m = new THREE.Matrix4(), _bx = new THREE.Vector3(), _by = new THREE.Vector3(0, 1, 0), _bz = new THREE.Vector3();
  function frame(s) {
    _bx.set(s.nz, 0, -s.nx); _bz.set(s.nx, 0, s.nz);
    _m.makeBasis(_bx, _by, _bz);
    _m.setPosition(s.x, 0, s.z);
    return _m;
  }

  function parts(o) {
    const s = spec(o);
    const P = [];
    const ys = rungYs(s);
    const topY = Math.max(s.rungTop, s.y1) + num(o.ext, 1.1);
    const H = topY - s.y0;
    // stiles (flat bar), foot to the grab-rail tops
    for (const sx of [-1, 1]) {
      const g = new THREE.BoxGeometry(0.055, H, 0.065);
      g.translate(sx * HALF, s.y0 + H / 2, 0);
      P.push(g);
    }
    // rungs: round bar between the stiles
    for (let i = 0; i < ys.length; i++) {
      const g = new THREE.CylinderGeometry(0.017, 0.017, HALF * 2, 6);
      g.rotateZ(Math.PI / 2);
      g.translate(0, ys[i], 0);
      P.push(g);
    }
    // stand-off brackets back to the structure
    const so = num(o.standoff, 0);
    if (so > 0.02) {
      const n = Math.max(2, Math.ceil(H / 3));
      for (let k = 0; k < n; k++) {
        const y = s.y0 + 0.6 + (H - 1.2) * (n === 1 ? 0.5 : k / (n - 1));
        for (const sx of [-1, 1]) {
          const g = new THREE.BoxGeometry(0.05, 0.05, so);
          g.translate(sx * HALF, y, -so / 2);
          P.push(g);
        }
      }
    }
    // the safety cage: hoops from head height up, five straps down the outside
    const cage = o.cage != null ? !!o.cage : (s.y1 - s.y0 > 6);
    if (cage) {
      const c0 = s.y0 + num(o.cageFrom, 2.3), c1 = topY - 0.05;
      if (c1 - c0 > 0.8) {
        for (let y = c0; y <= c1 + 1e-6; y += 1.0) {
          const g = new THREE.TorusGeometry(CAGE_R, 0.014, 4, 12, Math.PI + 2 * CAGE_DELTA);
          g.rotateZ(-CAGE_DELTA);
          g.rotateX(Math.PI / 2);
          g.translate(0, y, CAGE_C);
          P.push(g);
        }
        const len = c1 - c0;
        for (let k = -2; k <= 2; k++) {
          const t = Math.PI / 2 + k * 0.62;
          const g = new THREE.BoxGeometry(0.035, len, 0.012);
          g.rotateY(-(t - Math.PI / 2));
          g.translate(Math.cos(t) * CAGE_R, c0 + len / 2, CAGE_C + Math.sin(t) * CAGE_R);
          P.push(g);
        }
      }
    }
    const M = frame(s);
    for (let i = 0; i < P.length; i++) P[i].applyMatrix4(M);
    return P;
  }

  function merge(list) {
    const BGU = THREE.BufferGeometryUtils;
    if (list.length > 1 && BGU && BGU.mergeBufferGeometries) {
      const g = BGU.mergeBufferGeometries(list, false);
      if (g) { for (let i = 0; i < list.length; i++) list[i].dispose(); g.computeBoundingSphere(); return g; }
    }
    return null;
  }
  function meshOf(root, list, mat, opts) {
    const m = mat || galv();
    const g = merge(list);
    let obj;
    if (g) obj = new THREE.Mesh(g, m);
    else { obj = new THREE.Group(); for (let i = 0; i < list.length; i++) obj.add(new THREE.Mesh(list[i], m)); }
    obj.castShadow = !(opts && opts.cast === false);
    obj.receiveShadow = true;
    if (obj.isGroup) obj.traverse(function (c) { if (c.isMesh) { c.castShadow = obj.castShadow; c.receiveShadow = true; } });
    if (root) root.add(obj);
    return obj;
  }

  function register(o) {
    const s = spec(o);
    if (CBZ.climb && CBZ.climb.add) return CBZ.climb.add(s);
    (CBZ.ladderSpecs = CBZ.ladderSpecs || []).push(s);
    return null;
  }

  function build(root, o, mat) {
    const s = spec(o);
    const mesh = meshOf(root, parts(o), mat, o);
    mesh.userData.ladder = true;
    const L = o.register === false ? null : register(s);
    return { mesh: mesh, spec: s, ladder: L };
  }

  /* THE LANDING. o: minX, maxX, minZ, maxZ, top; rail (1.1 m); gaps
     [{x, z, w}] (half-width w, default 0.45) cut out of any edge that passes
     within 0.6 m of the point — where the ladder comes over the edge; skip
     ["minX"|"maxX"|"minZ"|"maxZ"] edges that need no rail (a wall is there);
     platform:false when the caller already pushed the floor; root/mat draw
     posts + top rail + knee rail to match the colliders; floor:true draws the
     plate too (hole {minX,maxX,minZ,maxZ}: leave that rect out of it). The colliders are
     height-gated (y0 = the landing) so they never stand in the street. */
  function deck(o) {
    const top = +o.top, rail = num(o.rail, 1.1);
    const out = { platform: null, colliders: [], parts: [] };
    if (o.platform !== false) {
      out.platform = { minX: o.minX, maxX: o.maxX, minZ: o.minZ, maxZ: o.maxZ, top: top };
      (CBZ.platforms = CBZ.platforms || []).push(out.platform);
    }
    const gaps = o.gaps || [], skip = o.skip || [];
    const edges = [
      { k: "minZ", ax: "x", a: o.minX, b: o.maxX, at: o.minZ },
      { k: "maxZ", ax: "x", a: o.minX, b: o.maxX, at: o.maxZ },
      { k: "minX", ax: "z", a: o.minZ, b: o.maxZ, at: o.minX },
      { k: "maxX", ax: "z", a: o.minZ, b: o.maxZ, at: o.maxX },
    ];
    const cols = (CBZ.colliders = CBZ.colliders || []);
    const T = 0.06;
    for (const e of edges) {
      if (skip.indexOf(e.k) >= 0) continue;
      // the spans of this edge left after the gaps are cut out
      let spans = [[e.a, e.b]];
      for (const g of gaps) {
        const off = e.ax === "x" ? Math.abs(g.z - e.at) : Math.abs(g.x - e.at);
        if (off > 0.6) continue;
        const c = e.ax === "x" ? g.x : g.z, w = g.w != null ? g.w : 0.45;
        const next = [];
        for (const sp of spans) {
          if (c + w <= sp[0] || c - w >= sp[1]) { next.push(sp); continue; }
          if (c - w > sp[0] + 0.05) next.push([sp[0], c - w]);
          if (c + w < sp[1] - 0.05) next.push([c + w, sp[1]]);
        }
        spans = next;
      }
      for (const sp of spans) {
        const c = e.ax === "x"
          ? { minX: sp[0], maxX: sp[1], minZ: e.at - T, maxZ: e.at + T }
          : { minX: e.at - T, maxX: e.at + T, minZ: sp[0], maxZ: sp[1] };
        c.y0 = top; c.y1 = top + rail; c.rail = true; c.noBreach = true;
        cols.push(c); out.colliders.push(c);
        if (o.root) {
          const len = sp[1] - sp[0], mid = (sp[0] + sp[1]) / 2;
          const bar = function (h, y) {
            const g = e.ax === "x" ? new THREE.BoxGeometry(len, h, 0.05) : new THREE.BoxGeometry(0.05, h, len);
            if (e.ax === "x") g.translate(mid, y, e.at); else g.translate(e.at, y, mid);
            out.parts.push(g);
          };
          bar(0.05, top + rail);            // hand rail
          bar(0.04, top + rail * 0.5);      // knee rail
          const n = Math.max(1, Math.ceil(len / 1.5));
          for (let k = 0; k <= n; k++) {
            const u = sp[0] + len * (k / n);
            const g = new THREE.BoxGeometry(0.05, rail, 0.05);
            if (e.ax === "x") g.translate(u, top + rail / 2, e.at); else g.translate(e.at, top + rail / 2, u);
            out.parts.push(g);
          }
        }
      }
    }
    // the floor plate (grating), optionally round a hole (a tank sits in it)
    if (o.root && o.floor) {
      const plate = function (x0, x1, z0, z1) {
        if (x1 - x0 < 0.05 || z1 - z0 < 0.05) return;
        const g = new THREE.BoxGeometry(x1 - x0, 0.06, z1 - z0);
        g.translate((x0 + x1) / 2, top - 0.03, (z0 + z1) / 2);
        out.parts.push(g);
      };
      const h = o.hole;
      if (!h) plate(o.minX, o.maxX, o.minZ, o.maxZ);
      else {
        plate(o.minX, o.maxX, o.minZ, h.minZ); plate(o.minX, o.maxX, h.maxZ, o.maxZ);
        plate(o.minX, h.minX, h.minZ, h.maxZ); plate(h.maxX, o.maxX, h.minZ, h.maxZ);
      }
    }
    if (o.root && out.parts.length) out.mesh = meshOf(o.root, out.parts, o.mat, { cast: false });
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    if (CBZ.markPlatformsDirty) CBZ.markPlatformsDirty();
    return out;
  }

  CBZ.ladderKit = {
    spec: spec, parts: parts, build: build, register: register, deck: deck,
    rungYs: rungYs, mat: galv, mesh: meshOf,
    HALF: HALF,
  };
})();
