/* ============================================================
   city/airframes.js — EVERY CIVIL AIRCRAFT IN THE GAME, DRAWN FOR REAL.

   OWNER: "It's all poorly drawn right now, but close. Just redraw it all,
   like you did with cars."

   What was wrong: the airliner was 30 box primitives scaled 1.45x (a 54 m
   "A320"), its windows a single glass slit over an open band, its wing one
   swept slab, its engines boxes with a box for an intake. The private jet had
   a 13.5 m span on a 21.5 m body. The light plane was taperBoxes with a plank
   wing. Nothing had control surfaces, no gear retracted, no light blinked.

   What this is: six real types at real dimensions, each lofted from the kit
   (city/airframe_kit.js):
     narrowbody   A320-class twinjet          37.57 x 35.80 m, h 11.76
     widebody     787-9-class twinjet         62.81 x 60.12 m, h 17.02
     turboprop    ATR 72-class regional       27.17 x 27.05 m, h  7.65
     bizjet       super-midsize business jet  20.92 x 21.00 m, h  6.10
     single       C172-class high-wing single  8.28 x 11.00 m, h  2.72
     heli         light twin helicopter        rotor 9.44 m (civil, police,
                  news, medical, VIP and the player's own gunship variant)
   Each has a lofted fuselage with its real nose and tail cone and REAL window
   holes (cells cut through the skin with a reveal and glass), NACA-section
   wings with the right planform, flaps and ailerons on hinges, turbofans with
   intakes/fans/cores or turboprops/props with blur discs, retracting gear,
   hinged/plug doors, nav lights, strobes and beacons, and a hollow cabin with
   seats and a flight deck.

   FRAME: nose +Z, port +X, up +Y, wheels on y = 0 (gear down). The airport
   convention (nose +X) is a quarter-turn wrapper: build(type, {noseX:true}).

   COST: every type's geometry is built ONCE and shared by every instance
   (a livery is a material, not a mesh). Per instance: ~20 merged meshes. The
   cabin and flight deck draw only within INTERIOR_R of the camera; the
   perforated skin swaps to the same skin with its window holes filled by
   the same glass beyond NEAR_R — nothing but sub-pixel detail changes.
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.airframeKit) return;
  const THREE = window.THREE;
  const KT = CBZ.airframeKit;
  const TAU = Math.PI * 2, HP = Math.PI / 2;
  const clamp = KT.clamp, lerp = KT.lerp;

  const NEAR_R = 150;           // m: perforated skin + small detail within this
  const INTERIOR_R = 75;        // m: cabin furniture and flight deck
  const LOD_HYST = 1.12;

  // ---------------------------------------------------------------------------
  //  MATERIALS — shared by the whole fleet; liveries are cached per colour
  // ---------------------------------------------------------------------------
  const cmat = CBZ.cmat || CBZ.mat || function (c) { return new THREE.MeshLambertMaterial({ color: c }); };
  function vmat(role, color, opts) {
    if (CBZ.vehicleMat) { try { const m = CBZ.vehicleMat(role, color, opts); if (m && m.isMaterial) return m; } catch (e) {} }
    return cmat(color, opts);
  }
  function basic(color, opts) {
    const m = new THREE.MeshBasicMaterial(Object.assign({ color: color }, opts || {}));
    m._shared = true;
    return m;
  }
  function lam(color, opts) {
    const m = new THREE.MeshLambertMaterial(Object.assign({ color: color }, opts || {}));
    m._shared = true;
    return m;
  }
  let MAT = null;
  function mats() {
    if (MAT) return MAT;
    const sh = function (m) { if (m) m._shared = true; return m; };
    MAT = {
      paint: sh(vmat("paint", 0xf1f3f5, { roughness: 0.42, metalness: 0.2 })),
      belly: sh(vmat("paint", 0xbfc5cc, { roughness: 0.5, metalness: 0.25 })),
      metal: sh(vmat("metal", 0xaeb5bd)),
      bare: sh(vmat("chrome", 0xd9dde2)),
      dark: sh(vmat("plastic", 0x17191d)),
      inlet: sh(lam(0x0a0c0f)),
      tire: sh(vmat("tire", 0x171819)),
      glass: sh(vmat("glass", 0x0f1a25)),
      liner: sh(lam(0xe3e5e7)),
      floor: sh(lam(0x3d4452)),
      fabric: sh(lam(0x2c3a56)),
      leather: sh(lam(0xcdbb9c)),
      cover: sh(lam(0xeceeef)),
      shell: sh(lam(0x8f969f)),
      panel: sh(lam(0x2a2e34)),
      wood: sh(lam(0x5a3d28)),
      screen: sh(cmat(0x0b1622, { emissive: 0x12304a, ei: 0.85 })),
      clight: sh(cmat(0xfff3dc, { emissive: 0xffeac4, ei: 0.8 })),
      blade: sh(vmat("metal", 0x24292f)),
      navR: basic(0xff2a1e), navG: basic(0x1eff4a), navW: basic(0xf4f8ff),
      strobe: basic(0xffffff), beacon: basic(0xff1a10), land: basic(0xfff6e0),
    };
    return MAT;
  }
  const _liv = new Map();
  function livMat(hex, role) {
    const k = (role || "paint") + ":" + hex;
    let m = _liv.get(k);
    if (!m) { m = vmat(role || "paint", hex, { roughness: 0.4, metalness: 0.25 }); if (m) m._shared = true; _liv.set(k, m); }
    return m;
  }
  function blurMat() {
    return new THREE.MeshBasicMaterial({ color: 0x1a1d22, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  }

  // Neutral invented liveries — colour schemes, never a real carrier.
  const LIVERIES = [
    { accent: 0x1f4f9a, accent2: 0x0f2446, belly: 0xc4cad1 },
    { accent: 0xb3262c, accent2: 0x3a0f12, belly: 0xc8ccd2 },
    { accent: 0x167a55, accent2: 0x0a3326, belly: 0xc2c8ce },
    { accent: 0xd08a16, accent2: 0x4a2c06, belly: 0xc6cad0 },
    { accent: 0x5a3a8a, accent2: 0x21143a, belly: 0xc5c9cf },
    { accent: 0x2a8fb0, accent2: 0x0c3444, belly: 0xc6cbd1 },
  ];
  function livery(v) {
    if (v && typeof v === "object") return Object.assign({}, LIVERIES[0], v);
    if (typeof v === "number") {
      // a bare colour: use it as the accent, derive a deep second tone
      const r = (v >> 16) & 255, gg = (v >> 8) & 255, b = v & 255;
      const d = ((r * 0.35) << 16) | ((gg * 0.35) << 8) | (b * 0.35);
      return { accent: v, accent2: d, belly: 0xc4cad1 };
    }
    return LIVERIES[0];
  }

  // ---------------------------------------------------------------------------
  //  THE BUILD CONTEXT — buckets per LOD tier, movers, meta
  // ---------------------------------------------------------------------------
  function Ctx(id) {
    this.id = id;
    this.b = { all: KT.bucket(), near: KT.bucket(), far: KT.bucket(), int: KT.bucket(), deck: KT.bucket() };
    this.movers = [];
    this.meta = { id: id, doors: {}, gear: [], surfaces: [], props: [], fans: [], rotors: [] };
  }
  Ctx.prototype.put = function (tier, key, g) { return this.b[tier].put(key, g); };
  Ctx.prototype.finish = function () {
    const root = new THREE.Group();
    root.name = "af:" + this.id;
    const tiers = ["all", "near", "far", "int", "deck"];
    for (const t of tiers) {
      const baked = this.b[t].bake();
      let holder = root;
      if (t === "deck") { holder = new THREE.Group(); holder.name = "af:deck"; root.add(holder); }
      for (const k in baked) {
        if (!baked[k]) continue;
        const m = new THREE.Mesh(baked[k], mats().paint);
        m.name = "af:mesh:" + t + ":" + k;
        m.userData.mk = k; m.userData.lod = t;
        m.castShadow = t === "all" || t === "near" || t === "far";
        m.receiveShadow = true;
        holder.add(m);
      }
    }
    for (const mv of this.movers) root.add(mv);
    return { template: root, meta: this.meta };
  };
  // a mover: a Group whose meshes come from per-material bucket
  function moverGroup(name, parts, ud) {
    const g = new THREE.Group();
    g.name = name;
    Object.assign(g.userData, ud || {});
    for (const k in parts) {
      const geo = KT.merge(parts[k]);
      if (!geo) continue;
      const m = new THREE.Mesh(geo, mats().paint);
      m.name = "afm:" + name + ":" + k; m.userData.mk = k;
      m.castShadow = true; m.receiveShadow = true;
      g.add(m);
    }
    return g;
  }
  function parts() {
    const p = {};
    return { p: p, put: function (k, g) { (p[k] = p[k] || []).push(g); return g; } };
  }

  // a Group whose local +X runs along the hinge p0->p1, local Y as close to
  // `up` as it can be; geometry given in the parent frame is moved into it
  function hinge(name, p0, p1, up, geoList, key, extra) {
    const X = new THREE.Vector3(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]).normalize();
    const U = new THREE.Vector3(up[0], up[1], up[2]);
    const Z = new THREE.Vector3().crossVectors(X, U).normalize();
    const Y = new THREE.Vector3().crossVectors(Z, X).normalize();
    const basis = new THREE.Matrix4().makeBasis(X, Y, Z);
    const g = new THREE.Group();
    g.name = name;
    g.position.set(p0[0], p0[1], p0[2]);
    g.quaternion.setFromRotationMatrix(basis);
    g.updateMatrix();
    const inv = new THREE.Matrix4().copy(g.matrix).invert();
    const list = {};
    list[key] = geoList.map(function (gg) { return gg.applyMatrix4(inv); });
    const mg = moverGroup(name + ":m", list);
    while (mg.children.length) g.add(mg.children[0]);
    g.userData.q0 = [g.quaternion.x, g.quaternion.y, g.quaternion.z, g.quaternion.w];
    g.userData.p0 = [p0[0], p0[1], p0[2]];
    Object.assign(g.userData, extra || {});
    return g;
  }

  // ---------------------------------------------------------------------------
  //  SKIN — regions of the (z, th) parameter plane, some perforated
  // ---------------------------------------------------------------------------
  // region: {z0, z1, t0, t1, hole?, key?, pane?, glassKey?}
  // opts: {zStep, tStep, wall, zone:[zFwd, zAft] (liner inside), noLiner}
  function skin(C, B, regions, o) {
    // big panes (windscreens, doors' glass) follow the curve with rings;
    // a cabin window is small enough to be a flat fan
    for (const r of regions) if (r.hole && r.paneRings == null && r.hole.length < 30 && (r.z0 - r.z1) > 0.7) r.paneRings = 3;
    const step = { zStep: o.zStep, tStep: o.tStep, rings: 2 };
    const wall = o.wall || 0.1;
    for (const r of regions) {
      const key = r.key || "paint";
      if (r.hole) {
        C.put("near", key, KT.cell(B, r.z0, r.z1, r.t0, r.t1, r.hole, 0, step));
        C.put("far", key, KT.solidCell(B, r.z0, r.z1, r.t0, r.t1, 0, step));
        if (r.pane !== false) {
          C.put("near", r.glassKey || "glass", KT.pane(B, r.hole, -wall * 0.35, r.paneRings || 1));
          C.put("far", r.glassKey || "glass", KT.pane(B, r.hole, 0.006, r.paneRings || 1));
        }
        C.put("near", r.revealKey || "liner", KT.reveal(B, r.hole, 0, -wall));
      } else {
        C.put("all", key, KT.solidCell(B, r.z0, r.z1, r.t0, r.t1, 0, step));
      }
      // the inside liner, within the pressurised zone
      if (o.zone && r.liner !== false) {
        const z0 = Math.min(r.z0, o.zone[0]), z1 = Math.max(r.z1, o.zone[1]);
        if (z0 - z1 > 0.05) {
          const inside = r.hole && r.z0 <= o.zone[0] + 1e-6 && r.z1 >= o.zone[1] - 1e-6;
          const lk = r.linerKey || "liner";
          if (inside) C.put("int", lk, KT.cell(B, z0, z1, r.t0, r.t1, r.hole, -wall, Object.assign({ flip: true }, step)));
          else C.put("int", lk, KT.solidCell(B, z0, z1, r.t0, r.t1, -wall, Object.assign({ flip: true }, step)));
        }
      }
    }
  }
  // split a z-band into cells around features {zc, half, hole} (nose first)
  function bandCells(zA, zB, t0, t1, feats, key) {
    const f = feats.slice().sort(function (a, b) { return b.zc - a.zc; });
    const out = [];
    let cur = zA;
    for (let i = 0; i < f.length; i++) {
      const a = f[i];
      let top = Math.min(cur, a.zc + a.half), bot = a.zc - a.half;
      const nx = f[i + 1];
      if (nx && bot < nx.zc + nx.half) bot = (a.zc - a.half + nx.zc + nx.half) / 2;
      if (top < cur - 0.02) out.push({ z0: cur, z1: top, t0: t0, t1: t1, key: key });
      out.push({ z0: top, z1: bot, t0: t0, t1: t1, key: key, hole: a.hole, pane: a.pane, liner: a.liner });
      cur = bot;
    }
    if (cur > zB + 0.02) out.push({ z0: cur, z1: zB, t0: t0, t1: t1, key: key });
    return out;
  }
  // (z, y) on the port side → (z, th); mirror th for starboard
  function zth(B, z, y) { return [z, B.thAtY(z, y)]; }
  function mirT(poly) { return poly.map(function (p) { return [p[0], Math.PI - p[1]]; }).reverse(); }

  // ---------------------------------------------------------------------------
  //  LIFTING SURFACES — wing box + hinged control surfaces
  // ---------------------------------------------------------------------------
  // spec: {st: [{le, c, t}] authored along the span (axis 0 = x for wings,
  //   axis 1 = y for a fin), tipExtra: [...] stations beyond (winglet),
  //   surfaces: [{s0, s1, cf, id, kind}], key, mirror, up, M}
  function stationAt(st, axis, s) {
    for (let i = 1; i < st.length; i++) {
      const a = st[i - 1], b = st[i];
      if (s <= b.le[axis] + 1e-9 || i === st.length - 1) {
        const t = clamp((s - a.le[axis]) / ((b.le[axis] - a.le[axis]) || 1), 0, 1);
        return { le: [lerp(a.le[0], b.le[0], t), lerp(a.le[1], b.le[1], t), lerp(a.le[2], b.le[2], t)],
          c: lerp(a.c, b.c, t), t: lerp(a.t, b.t, t), cam: lerp(a.cam || 0, b.cam || 0, t) };
      }
    }
    return Object.assign({}, st[st.length - 1]);
  }
  function lifting(C, spec) {
    const axis = spec.axis || 0, st = spec.st, surf = spec.surfaces || [];
    const sOf = function (x) { return x.le[axis]; };
    const brk = new Set(st.map(sOf));
    for (const s of surf) { brk.add(s.s0); brk.add(s.s1); }
    const xs = Array.from(brk).sort(function (a, b) { return a - b; });
    const cutAt = function (s, side) {
      for (const q of surf) if ((side < 0 ? s > q.s0 + 1e-6 && s <= q.s1 + 1e-6 : s >= q.s0 - 1e-6 && s < q.s1 - 1e-6)) return 1 - q.cf;
      return 1;
    };
    const list = [];
    for (const s of xs) {
      const base = stationAt(st, axis, s);
      const cl = cutAt(s, -1), cr = cutAt(s, +1);
      list.push(Object.assign({}, base, { cut: cl }));
      if (cr !== cl) list.push(Object.assign({}, base, { cut: cr }));
    }
    for (const e of (spec.tipExtra || [])) list.push(e);
    const up = spec.up || [0, 1, 0];
    const key = spec.key || "paint";
    const main = KT.wing(list, { M: spec.M || 22, up: up });
    C.put(spec.tier || "all", key, main);
    if (spec.mirror) C.put(spec.tier || "all", key, KT.mirrorX(main));
    // control surfaces (flaps, ailerons, elevators, rudder)
    for (const q of surf) {
      const sides = spec.mirror ? [1, -1] : [1];
      for (const sd of sides) {
        const a = stationAt(st, axis, q.s0), b = stationAt(st, axis, q.s1);
        const mk = function (s) {
          const cut = 1 - q.cf;
          const le = [s.le[0], s.le[1], s.le[2] - s.c * cut - 0.025];
          return { le: le, c: s.c * q.cf - 0.03, t: Math.min(0.5, 2 * KT.naca(cut, s.t) / q.cf * 0.92), cam: 0 };
        };
        const inner = [];
        for (const s of xs) if (s > q.s0 + 1e-6 && s < q.s1 - 1e-6) inner.push(mk(stationAt(st, axis, s)));
        const sts = [mk(a)].concat(inner, [mk(b)]);
        // pull the ends in 2 cm so the surface sits in its cut-out
        const pull = function (s0, s1) { const d = [s1.le[0] - s0.le[0], s1.le[1] - s0.le[1], s1.le[2] - s0.le[2]]; const l = Math.hypot(d[0], d[1], d[2]) || 1; for (let k = 0; k < 3; k++) s0.le[k] += d[k] / l * 0.02; };
        pull(sts[0], sts[1]); pull(sts[sts.length - 1], sts[sts.length - 2]);
        let g = KT.wing(sts, { M: 16, up: up });
        let p0 = [sts[0].le[0], sts[0].le[1], sts[0].le[2]], p1 = [sts[sts.length - 1].le[0], sts[sts.length - 1].le[1], sts[sts.length - 1].le[2]];
        if (sd < 0) { g = KT.mirrorX(g); p0 = [-p0[0], p0[1], p0[2]]; p1 = [-p1[0], p1[1], p1[2]]; }
        if (sd < 0 && axis === 0) { const t = p0; p0 = p1; p1 = t; }
        // hinge a little aft of the surface LE, on its chord line
        const aftA = sts[0].c * 0.12, aftB = sts[sts.length - 1].c * 0.12;
        const hp0 = [p0[0], p0[1], p0[2] - (sd < 0 && axis === 0 ? aftB : aftA)];
        const hp1 = [p1[0], p1[1], p1[2] - (sd < 0 && axis === 0 ? aftA : aftB)];
        const name = "af:surf:" + q.kind + ":" + q.id + (spec.mirror ? (sd > 0 ? "P" : "S") : "");
        const hg = hinge(name, hp0, hp1, axis === 1 ? [1, 0, 0] : up, [g], q.key || key,
          { kind: q.kind, side: sd, max: q.max || 0.35, fowler: q.fowler || 0 });
        // which rotation sign carries the trailing edge DOWN (or to port for a rudder)
        const te = new THREE.Vector3(0, 0, -1);
        const qq = new THREE.Quaternion().fromArray(hg.userData.q0);
        const inv = qq.clone().invert();
        const tl = te.clone().applyQuaternion(inv);                 // TE direction in hinge frame
        const r = new THREE.Vector3(tl.x, tl.y * Math.cos(0.1) - tl.z * Math.sin(0.1), tl.y * Math.sin(0.1) + tl.z * Math.cos(0.1)).applyQuaternion(qq);
        const wantAxis = axis === 1 ? 0 : 1;                          // rudder: +x (port); others: y
        const delta = axis === 1 ? r.x - te.x : r.y - te.y;
        hg.userData.sgn = axis === 1 ? (delta > 0 ? 1 : -1) : (delta < 0 ? 1 : -1);
        hg.userData.aft = [tl.x, tl.y, tl.z];
        void wantAxis;
        C.movers.push(hg);
        C.meta.surfaces.push(name);
      }
    }
  }

  // ---------------------------------------------------------------------------
  //  ENGINES
  // ---------------------------------------------------------------------------
  // high-bypass turbofan: lip at (x, y, z), fan radius r, nacelle length len
  function turbofan(C, o, idx) {
    const r = o.r, L = o.len, x = o.x, y = o.y, z = o.z;
    const outer = [[r * 0.90, 0], [r * 0.98, -0.05 * r], [r * 1.04, -0.22 * r], [r * 1.07, -0.7 * r], [r * 1.06, -L * 0.45],
      [r * 1.0, -L * 0.62], [r * 0.9, -L * 0.74], [r * 0.82, -L * 0.78]];
    const lip = [[r * 0.84, -0.14 * r], [r * 0.88, -0.02 * r], [r * 0.93, 0.0], [r * 0.985, -0.05 * r]];
    const duct = [[r * 0.84, -0.14 * r], [r * 0.83, -0.5 * r], [r * 0.8, -0.62 * r]];
    const core = [[r * 0.6, -L * 0.74], [r * 0.6, -L * 0.8], [r * 0.54, -L * 0.9], [r * 0.42, -L]];
    const plug = [[r * 0.34, -L * 0.99], [r * 0.3, -L * 1.03], [r * 0.14, -L * 1.13], [0.001, -L * 1.16]];
    const xfp = function (g) { return g.translate(x, y, z); };
    C.put("all", o.key || "paint", xfp(KT.lathe(outer, 32)));
    C.put("all", "bare", xfp(KT.lathe(lip, 32)));
    C.put("all", "inlet", xfp(KT.lathe(duct, 28)));
    C.put("all", "metal", xfp(KT.lathe(core, 24)));
    C.put("all", "dark", xfp(KT.lathe(plug, 20)));
    // the exhaust annulus you look into from behind
    C.put("all", "inlet", xfp(KT.lathe([[r * 0.8, -L * 0.77], [r * 0.62, -L * 0.77]], 28)));
    // fan face: spinner + blades on a mover that spins with N1
    const P = parts();
    P.put("blade", KT.lathe([[0.001, 0.12 * r], [r * 0.14, 0.02 * r], [r * 0.26, -0.18 * r], [r * 0.3, -0.3 * r]], 18));
    C.put("all", "inlet", KT.lathe([[r * 0.3, -0.3 * r - 0.02], [r * 0.8, -0.3 * r - 0.02]], 28).translate(x, y, z - 0.42 * r));
    const nb = o.blades || 22;
    for (let i = 0; i < nb; i++) {
      const a = i / nb * TAU;
      const bl = KT.wing([{ le: [0, r * 0.28, 0.03 * r], c: r * 0.2, t: 0.08 }, { le: [0, r * 0.8, 0.0], c: r * 0.28, t: 0.05 }], { M: 8, chordDir: [0.55, 0, -0.83], up: [1, 0, 0], cap: false });
      bl.rotateZ(a);
      P.put("blade", bl);
    }
    const fan = moverGroup("af:fan:" + idx, P.p, { spin: "z" });
    fan.position.set(x, y, z - 0.42 * r);
    C.movers.push(fan);
    C.meta.fans.push(fan.name);
    // pylon from the nacelle crown up into the wing
    if (o.pylon) {
      const p = o.pylon;
      C.put("all", o.key || "paint", KT.wing([
        { le: [x, y + r * 0.9, z - L * 0.18], c: L * 0.66, t: 0.1 },
        { le: [x, p.y, p.z], c: p.c, t: 0.09 },
      ], { M: 14, up: [1, 0, 0] }));
    }
  }
  // propeller: n blades radius r, spinner radius rs, at (x,y,z) facing +Z
  function propeller(C, o, idx) {
    const P = parts(), r = o.r, rs = o.rs || r * 0.12;
    P.put(o.spinKey || "paint", KT.lathe([[0.001, rs * 1.9], [rs * 0.55, rs * 1.5], [rs * 0.92, rs * 0.7], [rs, 0], [rs, -rs * 0.6]], 18));
    const n = o.n || 2;
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU;
      const bl = KT.wing([
        { le: [0, rs * 0.7, 0.04], c: r * 0.085, t: 0.18 },
        { le: [0, r * 0.35, 0.05], c: r * 0.13, t: 0.1 },
        { le: [0, r * 0.8, 0.02], c: r * 0.1, t: 0.07 },
        { le: [0, r, -0.01], c: r * 0.05, t: 0.06 },
      ], { M: 10, chordDir: [0.72, 0, -0.69], up: [0, 0, 1], cap: true });
      bl.rotateZ(a);
      P.put("blade", bl);
    }
    const g = moverGroup("af:prop:" + idx, P.p, { spin: "z", r: r });
    g.position.set(o.x, o.y, o.z);
    const disc = new THREE.Mesh(new THREE.RingGeometry(rs * 1.1, r, 40, 1), mats().paint);
    disc.name = "af:blur:" + idx; disc.userData.mk = "blur";
    disc.position.set(o.x, o.y, o.z - 0.02);
    C.movers.push(g, disc);
    C.meta.props.push({ name: g.name, disc: disc.name, r: r });
  }

  // ---------------------------------------------------------------------------
  //  LANDING GEAR
  // ---------------------------------------------------------------------------
  function wheel(P, x, y, z, r, w) {
    const tyre = [[r * 0.72, w / 2], [r * 0.9, w / 2], [r * 0.99, w * 0.36], [r, 0], [r * 0.99, -w * 0.36], [r * 0.9, -w / 2], [r * 0.72, -w / 2]];
    const g = KT.lathe(tyre, 22); g.rotateY(HP); g.translate(x, y, z);
    P.put("tire", g);
    const hub = KT.lathe([[0.001, w * 0.42], [r * 0.5, w * 0.44], [r * 0.72, w * 0.4], [r * 0.72, -w * 0.4], [r * 0.5, -w * 0.44], [0.001, -w * 0.42]], 16);
    hub.rotateY(HP); hub.translate(x, y, z);
    P.put("metal", hub);
  }
  // o: {id, x, z, top (pivot y), r, w, n wheels (2 or 4), track (wheel sep),
  //     bogie length, axis ("z" retract sideways / "x" retract fore-aft), up}
  function gearLeg(C, o) {
    const P = parts();
    const yA = o.r;                                    // axle height (gear down)
    const top = o.top;
    const ox = o.offX || 0;
    // oleo: outer cylinder + chromed slider
    P.put("metal", KT.tube([[ox, top, 0], [ox, yA + o.r * 0.9, 0]], o.strutR || 0.12, 6, 10));
    P.put("bare", KT.tube([[ox, yA + o.r * 1.1, 0], [ox, yA + 0.05, 0]], (o.strutR || 0.12) * 0.72, 4, 10));
    // torque link scissors
    P.put("dark", KT.tube([[ox, yA + o.r * 1.4, 0.06], [ox, yA + o.r * 0.95, o.r * 0.35], [ox, yA + o.r * 0.5, 0.06]], 0.025, 6, 5));
    // drag brace back to the structure
    if (o.brace) P.put("metal", KT.tube([[ox, top - 0.1, 0], [ox + o.brace[0], o.brace[1], o.brace[2]]], (o.strutR || 0.12) * 0.45, 4, 8));
    const n = o.n || 2, wr = o.r, ww = o.w;
    if (n === 4 || n === 6) {
      const bl = o.bogie || 1.6;
      P.put("metal", KT.tube([[ox, yA, bl / 2], [ox, yA, -bl / 2]], 0.09, 2, 8));
      const rows = n === 6 ? [bl / 2, 0, -bl / 2] : [bl / 2, -bl / 2];
      for (const zz of rows) for (const s of [1, -1]) wheel(P, ox + s * (o.track / 2), yA, zz, wr, ww);
      P.put("metal", KT.tube([[ox - o.track / 2, yA, rows[0]], [ox + o.track / 2, yA, rows[0]]], 0.06, 2, 6));
      P.put("metal", KT.tube([[ox - o.track / 2, yA, rows[rows.length - 1]], [ox + o.track / 2, yA, rows[rows.length - 1]]], 0.06, 2, 6));
    } else if (n === 2) {
      for (const s of [1, -1]) wheel(P, ox + s * (o.track / 2), yA, 0, wr, ww);
      P.put("metal", KT.tube([[ox - o.track / 2, yA, 0], [ox + o.track / 2, yA, 0]], 0.05, 2, 6));
    } else {
      wheel(P, ox + (o.wheelSide || 0) * (ww / 2 + 0.05), yA, 0, wr, ww);
      P.put("metal", KT.tube([[ox, yA, 0], [ox + (o.wheelSide || 0) * (ww + 0.1), yA, 0]], 0.04, 2, 6));
    }
    if (o.spat) {
      // fixed-gear wheel spat (a lofted fairing round the wheel)
      const sp = KT.lathe([[0.001, wr * 1.35], [wr * 0.55, wr * 1.1], [wr * 0.72, 0.1], [wr * 0.62, -wr * 1.0], [0.001, -wr * 1.5]], 16);
      sp.scale(ww * 1.7 / (wr * 1.44), 1.05, 1); sp.translate(ox + (o.wheelSide || 0) * (ww / 2 + 0.05), yA + wr * 0.18, 0);
      P.put(o.spatKey || "paint", sp);
    }
    if (o.legDoor) {
      const d = o.legDoor;
      P.put(o.doorKey || "paint", KT.xf(KT.rbox(0.05, d.h, d.w, 0.02, 1), ox + d.x, yA + wr + d.h / 2 + (d.y || 0), d.z || 0));
    }
    // move everything into a group pivoting at the top of the leg; the leg is
    // two draws (rubber + everything metal), a door is its own paint
    const lp = {};
    for (const k in P.p) {
      const kk = (k === "bare" || k === "dark") ? "metal" : k;
      lp[kk] = (lp[kk] || []).concat(P.p[k].map(function (g) { return g.translate(0, -top, 0); }));
    }
    const g = moverGroup("af:gear:" + o.id, lp, { axis: o.axis || "z", up: o.up || 0, fixed: !!o.fixed });
    g.position.set(o.x, top, o.z);
    C.movers.push(g);
    C.meta.gear.push(g.name);
    return g;
  }
  // a gear-bay door on a hinge: closed when the gear is up, open when down
  function gearDoor(C, id, p0, p1, w, open, key, flipSide) {
    const g = KT.xf(KT.rbox(Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]), 0.04, w, 0.015, 1), 0, 0, 0);
    // the plate spans +X in hinge space; its width hangs off the hinge on -Z
    g.translate(Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]) / 2, 0, (flipSide ? 1 : -1) * w / 2);
    const h = new THREE.Group(); h.name = "af:gdoor:" + id;
    const X = new THREE.Vector3(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]).normalize();
    const Y = new THREE.Vector3(0, 1, 0); const Z = new THREE.Vector3().crossVectors(X, Y).normalize(); Y.crossVectors(Z, X);
    h.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    h.position.set(p0[0], p0[1], p0[2]);
    const m = new THREE.Mesh(g, mats().paint); m.userData.mk = key || "belly"; m.name = "afm:" + h.name;
    h.add(m);
    h.userData.q0 = [h.quaternion.x, h.quaternion.y, h.quaternion.z, h.quaternion.w];
    h.userData.open = open;
    C.movers.push(h);
  }

  // ---------------------------------------------------------------------------
  //  LIGHTS
  // ---------------------------------------------------------------------------
  function bead(r) { return new THREE.SphereGeometry(r, 8, 6); }
  function lights(C, L) {
    for (const p of L.navR || []) C.put("all", "navR", KT.xf(bead(0.09), p[0], p[1], p[2]));
    for (const p of L.navG || []) C.put("all", "navG", KT.xf(bead(0.09), p[0], p[1], p[2]));
    for (const p of L.navW || []) C.put("all", "navW", KT.xf(bead(0.08), p[0], p[1], p[2]));
    const S = parts(); for (const p of L.strobe || []) S.put("strobe", KT.xf(bead(0.1), p[0], p[1], p[2]));
    const Bc = parts(); for (const p of L.beacon || []) Bc.put("beacon", KT.xf(bead(0.12), p[0], p[1], p[2], 0, 0, 0, 1.4, 0.7, 1.4));
    const Ld = parts(); for (const p of L.land || []) Ld.put("land", KT.xf(bead(0.13), p[0], p[1], p[2], 0, 0, 0, 1, 1, 0.4));
    if (L.strobe && L.strobe.length) C.movers.push(moverGroup("af:strobe", S.p));
    if (L.beacon && L.beacon.length) C.movers.push(moverGroup("af:beacon", Bc.p));
    if (L.land && L.land.length) C.movers.push(moverGroup("af:land", Ld.p));
  }

  // ---------------------------------------------------------------------------
  //  CABIN FURNITURE
  // ---------------------------------------------------------------------------
  // one economy seat block facing +Z, origin at floor under the block centre
  function seatBlock(n, sw, opts) {
    opts = opts || {};
    const P = parts();
    const cush = opts.cushion || 0.43, depth = opts.depth || 0.46, backH = opts.backH || 0.74;
    const W = n * sw;
    for (let i = 0; i < n; i++) {
      const cx = -W / 2 + sw * (i + 0.5);
      P.put(opts.fabric || "fabric", KT.xf(KT.rbox(sw - 0.05, 0.11, depth, 0.04, 2), cx, cush - 0.05, 0.02));
      // back: slightly curved shell leaning aft
      P.put(opts.fabric || "fabric", KT.xf(KT.rbox(sw - 0.06, backH, 0.1, 0.04, 2), cx, cush + backH / 2 - 0.02, -depth / 2 + 0.02, -0.16));
      P.put("shell", KT.xf(KT.rbox(sw - 0.04, backH * 0.9, 0.04, 0.02, 1), cx, cush + backH * 0.45 - 0.04, -depth / 2 - 0.06, -0.16));
      P.put("cover", KT.xf(KT.rbox(sw - 0.1, 0.22, 0.02, 0.01, 1), cx, cush + backH - 0.14, -depth / 2 + 0.085, -0.16));
    }
    for (let i = 0; i <= n; i++) {
      const ax = -W / 2 + sw * i;
      P.put("shell", KT.xf(KT.rbox(0.05, 0.05, depth * 0.85, 0.02, 1), ax, cush + 0.2, 0.0));
    }
    // legs and the spreader beam
    for (const lx of [-W / 2 + 0.12, W / 2 - 0.12]) {
      P.put("metal", KT.tube([[lx, 0, 0.18], [lx, cush - 0.1, 0.05], [lx, 0, -0.2]], 0.022, 6, 5));
    }
    P.put("metal", KT.tube([[-W / 2 + 0.05, cush - 0.12, 0], [W / 2 - 0.05, cush - 0.12, 0]], 0.028, 2, 6));
    return P.p;
  }
  function place(C, tier, block, x, y, z, ry) {
    for (const k in block) for (const g of block[k]) {
      const c = g.clone(); if (ry) c.rotateY(ry); c.translate(x, y, z);
      C.put(tier, k, c);
    }
  }
  function disposeBlock(block) { for (const k in block) for (const g of block[k]) g.dispose(); }
  // a flight-deck pilot seat facing +Z, origin on the floor
  function pilotSeat(P, x, y, z, cushion) {
    P.put("leather", KT.xf(KT.rbox(0.5, 0.12, 0.5, 0.05, 2), x, y + cushion - 0.06, z));
    P.put("leather", KT.xf(KT.rbox(0.5, 0.78, 0.12, 0.05, 2), x, y + cushion + 0.38, z - 0.25, -0.2));
    P.put("leather", KT.xf(KT.rbox(0.3, 0.2, 0.12, 0.04, 2), x, y + cushion + 0.86, z - 0.36, -0.2));
    for (const s of [1, -1]) P.put("dark", KT.xf(KT.rbox(0.06, 0.05, 0.36, 0.02, 1), x + s * 0.28, y + cushion + 0.22, z + 0.02));
    P.put("metal", KT.tube([[x, y + 0.02, z], [x, y + cushion - 0.12, z]], 0.07, 2, 10));
    P.put("dark", KT.xf(KT.rbox(0.42, 0.06, 0.62, 0.02, 1), x, y + 0.04, z + 0.05));
  }
  // flight-deck furniture shared by the jets: panel, glareshield, pedestal,
  // overhead. `dk` = {floorY, zPanel, zSeat, halfW, eyeY, overheadY, pedestal}
  function flightDeck(C, dk) {
    const F = dk.floorY;
    const D = parts();
    // main instrument panel: tilted face with its displays, as wide as the
    // nose is at the panel's TOP edge (the taper narrows fast up there)
    const pTop = dk.eyeY - 0.34, pBot = F + 0.62;
    const pw = dk.B ? Math.min(dk.halfW * 2 - 0.1, (dk.B.halfWidthAt(dk.zPanel, pTop + 0.05) - 0.1) * 2) : dk.halfW * 2 - 0.1;
    D.put("panel", KT.xf(KT.rbox(pw, pTop - pBot, 0.3, 0.04, 2), 0, (pTop + pBot) / 2, dk.zPanel, -0.18));
    const nScr = dk.screens || 6;
    for (let i = 0; i < nScr; i++) {
      const sx = (-(nScr - 1) / 2 + i) * (pw / nScr) * 0.95;
      D.put("screen", KT.xf(new THREE.PlaneGeometry(pw / nScr * 0.78, (pTop - pBot) * 0.62), sx, (pTop + pBot) / 2 + 0.02, dk.zPanel - 0.17, -0.18 + Math.PI, Math.PI, 0));
    }
    // glareshield with its control panel strip
    D.put("dark", KT.xf(KT.rbox(pw * 0.95, 0.1, 0.36, 0.04, 2), 0, pTop + 0.03, dk.zPanel - 0.14));
    D.put("panel", KT.xf(KT.rbox(pw * 0.6, 0.07, 0.03, 0.01, 1), 0, pTop - 0.02, dk.zPanel - 0.33));
    // centre pedestal with thrust levers
    if (dk.pedestal !== false) {
      const pz0 = dk.zPanel - 0.3, pz1 = dk.zSeat + 0.1;
      D.put("panel", KT.xf(KT.rbox(0.42, 0.62, pz0 - pz1, 0.04, 2), 0, F + 0.31, (pz0 + pz1) / 2));
      D.put("screen", KT.xf(new THREE.PlaneGeometry(0.34, (pz0 - pz1) * 0.45), 0, F + 0.625, (pz0 + pz1) / 2 - 0.05, -HP));
      for (const s of [-1, 1]) D.put("metal", KT.tube([[s * 0.07, F + 0.62, pz0 - 0.2], [s * 0.07, F + 0.8, pz0 - 0.32]], 0.018, 3, 5));
    }
    C.b.deck.put("panel", null);
    for (const k in D.p) for (const g of D.p[k]) C.put("deck", k, g);
    // the rest belongs to the room, not the instrument feed: seats, overhead,
    // side consoles, rudder pedals, a jump seat
    const R = parts();
    for (const s of [1, -1]) pilotSeat(R, s * dk.seatX, F, dk.zSeat, dk.cushion || 0.5);
    if (dk.overheadY && dk.B) {
      // the overhead panel follows the flight-deck ceiling from just behind
      // the windscreen back over the pilots' heads; its switch rows are
      // lighter strips set into it
      const B = dk.B, za = dk.zSeat + 0.45, zb = dk.zSeat - 0.55;
      const hw = Math.min(0.42, (dk.overheadW || 0.9) / 2) / Math.max(0.5, B.st(B.uOfZ(dk.zSeat)).w);
      R.put("panel", KT.patch(B, za, zb, HP - hw, HP + hw, -0.2, 8, 6, true));
      for (let i = 0; i < 4; i++) {
        const z0 = za - 0.08 - i * 0.24, z1 = z0 - 0.12;
        R.put("screen", KT.patch(B, z0, z1, HP - hw * 0.8, HP + hw * 0.8, -0.205, 2, 4, true));
      }
    }
    for (const s of [1, -1]) {
      R.put("panel", KT.xf(KT.rbox(0.22, 0.12, 0.7, 0.03, 1), s * (dk.halfW - 0.14), F + 0.66, dk.zSeat + 0.28));
      for (const q of [-1, 1]) R.put("dark", KT.xf(KT.rbox(0.09, 0.05, 0.2, 0.02, 1), s * dk.seatX + q * 0.09, F + 0.04, dk.zPanel - 0.42, -0.5));
    }
    for (const k in R.p) for (const g of R.p[k]) C.put("int", k, g);
  }
  // a partition wall of the section at z, above the floor, with an opening
  function bulkhead(C, B, z, floorY, opening, face, key, off) {
    const sec = B.section(z, off == null ? -0.12 : off, 48).filter(function (p) { return p[1] >= floorY; });
    // close the outline along the floor
    const hw = B.halfWidthAt(z, floorY) - 0.12;
    const out = [[hw, floorY]].concat(sec.filter(function (p) { return p[0] > 0; }).sort(function (a, b) { return a[1] - b[1]; }),
      sec.filter(function (p) { return p[0] <= 0; }).sort(function (a, b) { return b[1] - a[1]; }), [[-hw, floorY]]);
    const holes = [];
    let outline = out;
    if (opening) {
      // cut the door down to the floor by notching the outline
      const w = opening.w / 2, h = floorY + opening.h, ox = opening.x || 0;
      outline = [[hw, floorY]].concat(out.slice(1, out.length - 1), [[-hw, floorY], [ox - w, floorY], [ox - w, h], [ox + w, h], [ox + w, floorY]]);
    }
    C.put("int", key || "liner", KT.flat(outline, holes, z, face > 0));
    C.put("int", key || "liner", KT.flat(outline, holes, z - face * 0.05, face < 0));
  }
  // a floor strip following the section width
  function floorStrip(C, B, zF, zA, y, key, inset) {
    const zs = KT.axisSamples(zF, zA, 0.5), pos = [], idx = [];
    for (let i = 0; i < zs.length; i++) {
      const hw = Math.max(0.05, B.halfWidthAt(zs[i], y) - (inset || 0.12));
      pos.push(hw, y, zs[i], -hw, y, zs[i]);
    }
    for (let i = 0; i < zs.length - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    // normals must face up
    if (g.attributes.normal.getY(0) < 0) { const a = g.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } g.computeVertexNormals(); }
    g.setAttribute("uv", new THREE.Float32BufferAttribute(new Array(pos.length / 3 * 2).fill(0), 2));
    C.put("int", key || "floor", g);
  }

  // ---------------------------------------------------------------------------
  //  JETLINERS (narrowbody and widebody share one builder)
  // ---------------------------------------------------------------------------
  function jetliner(P) {
    const C = new Ctx(P.id);
    const N = P.L / 2, k = P.k;               // nose z; nose/cockpit scale vs the A320
    const zd = function (d) { return N - d; };
    const CY = P.CY, FL = P.floorY;
    // ---- fuselage stations: nose (scaled A320 shape), barrel, tail cone
    const S = [];
    for (const s of P.nose) S.push([zd(s[0] * k), CY + s[1] * k, s[2] * k, s[3] * k, s[4] * k, 2.0]);
    S.push([zd(P.barrel[0]), CY, P.R, P.Rt, P.Rb, 2.05]);
    S.push([zd(P.barrel[1]), CY, P.R, P.Rt, P.Rb, 2.05]);
    for (const s of P.tail) S.push([zd(P.barrel[1] + s[0] * P.tk), CY + s[1] * P.tk, s[2] * P.R, s[3] * P.Rt, s[4] * P.Rb, 2.0]);
    const B = KT.body(S);
    C.meta.body = B;
    const opts = { zStep: P.zStep || 0.3, tStep: TAU / 72, wall: P.wall || 0.12 };
    // ---- the skin, zone by zone
    const cw0 = zd(2.3 * k), cw1 = zd(4.7 * k);            // cockpit-window zone
    const bandA = cw1, bandB = zd(P.bandEnd);
    const tailZ = zd(P.L);
    const regions = [];
    // the belly colour follows ONE line (just under the door sill) from the
    // nose cap to the tail cone, so the livery never steps between zones
    const tSplit = B.thAtY(zd(P.doors.L1.d), FL) - 0.07;
    const ring = function (z0, z1) {
      regions.push({ z0: z0, z1: z1, t0: tSplit, t1: Math.PI - tSplit });
      regions.push({ z0: z0, z1: z1, t0: Math.PI - tSplit, t1: TAU + tSplit, key: "belly" });
    };
    // nose cap
    ring(N, cw0);
    // flight-deck windows (port polygons; starboard mirrored)
    const W1 = KT.quadHole([[zd(2.46 * k), 1.52], [zd(3.28 * k), 1.52], [zd(3.24 * k), 1.05], [zd(2.66 * k), 1.03]], 0.18);
    const W2 = KT.quadHole([[zd(2.86 * k), 0.56], [zd(3.25 * k), 0.93], [zd(3.98 * k), 0.66], [zd(3.98 * k), 0.37]], 0.16);
    const W3 = KT.quadHole([[zd(4.1 * k), 0.39], [zd(4.1 * k), 0.63], [zd(4.55 * k), 0.58], [zd(4.55 * k), 0.41]], 0.2);
    const tA0 = 0.2, tAB = 1.0;
    const zc1 = zd(4.05 * k), zc2 = zd(3.4 * k);
    regions.push({ z0: cw0, z1: zc1, t0: tA0, t1: tAB, hole: W2 }, { z0: zc1, z1: cw1, t0: tA0, t1: tAB, hole: W3 });
    regions.push({ z0: cw0, z1: zc2, t0: tAB, t1: HP, hole: W1 }, { z0: zc2, z1: cw1, t0: tAB, t1: HP });
    regions.push({ z0: cw0, z1: zc2, t0: HP, t1: Math.PI - tAB, hole: mirT(W1) }, { z0: zc2, z1: cw1, t0: HP, t1: Math.PI - tAB });
    regions.push({ z0: cw0, z1: zc1, t0: Math.PI - tAB, t1: Math.PI - tA0, hole: mirT(W2) }, { z0: zc1, z1: cw1, t0: Math.PI - tAB, t1: Math.PI - tA0, hole: mirT(W3) });
    regions.push({ z0: cw0, z1: cw1, t0: Math.PI - tA0, t1: Math.PI - tSplit });
    regions.push({ z0: cw0, z1: cw1, t0: Math.PI - tSplit, t1: TAU + tSplit, key: "belly" });
    regions.push({ z0: cw0, z1: cw1, t0: TAU + tSplit, t1: TAU + tA0 });
    // cabin band: port and starboard window rows, the L1 door on port
    const L1 = P.doors.L1;
    const zL1 = zd(L1.d);
    const tSill = B.thAtY(zL1, FL), tTop = B.thAtY(zL1, FL + L1.h);
    const t0 = tSplit, t1 = Math.max(tTop + 0.08, B.thAtY(zd(P.win.d0), FL + P.win.y + P.win.h));
    const winT = B.thAtY(zd((P.win.d0 + P.win.d1) / 2), FL + P.win.y);
    const winDT = (B.thAtY(zd((P.win.d0 + P.win.d1) / 2), FL + P.win.y + P.win.h / 2) - B.thAtY(zd((P.win.d0 + P.win.d1) / 2), FL + P.win.y - P.win.h / 2)) / 2;
    const featsP = [], featsS = [];
    const doorT = (tSill + tTop) / 2, doorDT = (tTop - tSill) / 2;
    const doorHole = KT.roundRect(zL1, doorT, L1.w / 2, doorDT, 6, 40);
    featsP.push({ zc: zL1, half: L1.w / 2 + 0.16, hole: doorHole, pane: false });
    const skipAt = function (d) {
      for (const dd in P.doors) { const q = P.doors[dd]; if (Math.abs(d - q.d) < q.w / 2 + 0.26) return true; }
      return false;
    };
    for (let d = P.win.d0; d <= P.win.d1 + 1e-6; d += P.win.pitch) {
      if (skipAt(d)) continue;
      const z = zd(d);
      const hole = KT.roundRect(z, winT, P.win.w / 2, winDT, 3.2, 24);
      featsP.push({ zc: z, half: P.win.pitch / 2, hole: hole });
      featsS.push({ zc: z, half: P.win.pitch / 2, hole: mirT(hole) });
    }
    for (const r of bandCells(bandA, bandB, t0, t1, featsP)) regions.push(r);
    for (const r of bandCells(bandA, bandB, Math.PI - t1, Math.PI - t0, featsS)) regions.push(r);
    regions.push({ z0: bandA, z1: bandB, t0: t1, t1: Math.PI - t1 });
    regions.push({ z0: bandA, z1: bandB, t0: Math.PI - t0, t1: TAU + t0, key: "belly" });
    // tail cone
    ring(bandB, tailZ);
    const zone = [zd(1.9 * k), zd(P.aftBulk)];
    skin(C, B, regions, Object.assign({ zone: zone }, opts));
    // ---- the L1 door (a plug door on a parallelogram arm), its seams
    {
      const Pd = parts();
      const hole = doorHole;
      Pd.put("paint", KT.pane(B, hole, -0.004, 3));
      Pd.put("liner", KT.pane(B, hole, -opts.wall + 0.02, 3));
      // door window
      const dwin = KT.roundRect(zL1, doorT + doorDT * 0.42, 0.11, winDT * 0.9, 3, 20);
      Pd.put("glass", KT.pane(B, dwin, 0.004, 2));
      Pd.put("dark", KT.seam(B, hole, 0.004, 0.012));
      // hinge at the door's FORWARD frame edge, 0.25 m outboard of the skin
      const pz = zL1 + L1.w / 2 + 0.06;
      const sk = B.at(zL1, doorT, 0);
      const px = sk[0] + 0.25, py = sk[1];
      const lp = {};
      for (const kk in Pd.p) lp[kk] = Pd.p[kk].map(function (g) { return g.translate(-px, -py, -pz); });
      const leaf = moverGroup("af:doorLeaf:L1", lp);
      const arm = new THREE.Group(); arm.name = "af:door:L1";
      arm.position.set(px, py, pz);
      arm.add(leaf);
      // the arm itself
      const armGeo = KT.tube([[0, 0.25, 0], [-0.22, 0.25, -L1.w / 2 - 0.06]], 0.035, 4, 6);
      const am = new THREE.Mesh(armGeo, mats().paint); am.userData.mk = "metal"; am.name = "afm:doorArm:L1";
      arm.add(am);
      C.movers.push(arm);
      C.meta.doors.L1 = { kind: "plug", hinge: [px, py, pz], z: zL1, sillY: FL, w: L1.w, h: L1.h, side: 1, skinX: sk[0] };
    }
    // other doors (seams only): service doors, aft doors, cargo doors, exits
    for (const id in P.doors) {
      if (id === "L1") continue;
      const q = P.doors[id], z = zd(q.d);
      const ts = B.thAtY(z, FL), tt = B.thAtY(z, FL + q.h);
      let h = KT.roundRect(z, (ts + tt) / 2, q.w / 2, (tt - ts) / 2, 6, 36);
      if (q.side < 0) h = mirT(h);
      C.put("all", "dark", KT.seam(B, h, 0.004, 0.011));
      // the door's own window
      const dw = KT.roundRect(z, (ts + tt) / 2 + (tt - ts) * 0.21, 0.1, winDT * 0.85, 3, 16);
      C.put("all", "glass", KT.pane(B, q.side < 0 ? mirT(dw) : dw, 0.006, 2));
    }
    for (const q of (P.cargo || [])) {
      const z = zd(q.d);
      const tc = B.thAtY(z, CY - P.Rb * 0.62);
      C.put("all", "dark", KT.seam(B, mirT(KT.roundRect(z, tc, q.w / 2, q.h / 2 / P.Rb, 8, 32)), 0.004, 0.01));
    }
    for (const d of (P.exits || [])) for (const sd of [1, -1]) {
      const z = zd(d);
      let h = KT.roundRect(z, winT, 0.27, winDT * 2.7, 6, 28);
      if (sd < 0) h = mirT(h);
      C.put("all", "dark", KT.seam(B, h, 0.004, 0.009));
    }
    // ---- livery: cheatline under the windows, accent on the tail, belly
    for (const sd of [1, -1]) {
      const ta = t0 + 0.03, tb = winT - winDT - 0.05;
      const a0 = sd > 0 ? ta : Math.PI - tb, a1 = sd > 0 ? tb : Math.PI - ta;
      C.put("all", "accent", KT.solidCell(B, zd(5.2 * k), zd(P.bandEnd - 1.5), a0, a1, 0.012, { zStep: 0.6, tStep: 0.05 }));
    }
    // ---- wings
    const Wg = P.wing;
    const wst = Wg.st.map(function (s) { return { le: [s[0], Wg.y + s[0] * Wg.dih, zd(s[1])], c: s[2], t: s[3], cam: 0.35 }; });
    const tip = wst[wst.length - 1];
    const tipExtra = (Wg.tip || []).map(function (s) { return { le: [s[0], tip.le[1] + s[1], zd(s[2])], c: s[3], t: s[4] || 0.1, cut: 1 }; });
    lifting(C, { st: wst, tipExtra: tipExtra, mirror: true, key: "paint", surfaces: Wg.surfaces, M: 24 });
    // wing-root fairing (belly fairing) — the long blister that houses the box
    {
      const f = KT.body([
        [zd(Wg.st[0][1] - 2.2 * k), CY - P.Rb * 0.72, 0.02, 0.02, 0.02, 2],
        [zd(Wg.st[0][1] - 0.8 * k), CY - P.Rb * 0.7, P.R * 0.9, 0.5, 0.35, 2.2],
        [zd(Wg.st[0][1] + Wg.st[0][2] * 0.35), CY - P.Rb * 0.72, P.R * 1.02, 0.6, 0.45, 2.6],
        [zd(Wg.st[0][1] + Wg.st[0][2] * 0.95), CY - P.Rb * 0.7, P.R * 0.98, 0.6, 0.42, 2.6],
        [zd(Wg.st[0][1] + Wg.st[0][2] * 1.5), CY - P.Rb * 0.66, P.R * 0.5, 0.3, 0.2, 2.2],
        [zd(Wg.st[0][1] + Wg.st[0][2] * 1.8), CY - P.Rb * 0.6, 0.02, 0.02, 0.02, 2],
      ]);
      C.put("all", "belly", KT.patch(f, f.z0, f.z1, Math.PI + 0.35, TAU - 0.35, 0, 26, 14));
    }
    // flap-track fairings (canoes) under the trailing edge
    for (const fx of (Wg.canoes || [])) for (const sd of [1, -1]) {
      const s = stationAt(wst, 0, fx);
      const zte = s.le[2] - s.c * 0.62, len = s.c * 0.75 + 1.0 * k;
      const g = KT.lathe([[0.001, 0.25 * len], [0.12 * k, 0.1 * len], [0.2 * k, -0.2 * len], [0.14 * k, -0.6 * len], [0.001, -0.75 * len]], 12);
      g.scale(1, 1.6, 1); g.translate(sd * fx, s.le[1] - s.c * s.t * 0.4, zte + 0.2 * len);
      C.put("near", "paint", g);
    }
    // ---- engines
    P.engines.forEach(function (e, i) {
      for (const sd of [1, -1]) {
        const s = stationAt(wst, 0, e.x);
        turbofan(C, { x: sd * e.x, y: e.y, z: zd(e.lipD), r: e.r, len: e.len, key: "paint",
          pylon: { y: s.le[1] - s.c * s.t * 0.3, z: s.le[2] - 0.2, c: s.c * 0.8 } }, i * 2 + (sd > 0 ? 0 : 1));
        // accent inlet cowl band (the livery on the nacelle)
        C.put("all", "accent", KT.lathe([[e.r * 1.075, -0.55 * e.r], [e.r * 1.08, -0.62 * e.r], [e.r * 1.082, -0.95 * e.r], [e.r * 1.076, -1.02 * e.r]], 32).translate(sd * e.x, e.y, zd(e.lipD)));
      }
    });
    // ---- tail: fin with rudder, tailplane with elevators
    const Fn = P.fin;
    const finRootY = B.at(zd(Fn.rootD + Fn.rootC * 0.4), HP, 0)[1] - 0.25;
    lifting(C, {
      axis: 1, up: [1, 0, 0], key: "accent", M: 22,
      st: [
        { le: [0, finRootY - 0.4, zd(Fn.rootD - 0.4)], c: Fn.rootC + 0.4, t: 0.11 },
        { le: [0, finRootY, zd(Fn.rootD)], c: Fn.rootC, t: 0.11 },
        { le: [0, P.H - 0.02, zd(Fn.rootD) - Fn.sweep * (P.H - finRootY)], c: Fn.tipC, t: 0.1 },
      ],
      surfaces: [{ s0: finRootY + 0.15, s1: P.H - 0.35, cf: 0.3, id: "rud", kind: "rudder", max: 0.45, key: "accent" }],
    });
    // dorsal fillet in front of the fin
    C.put("all", "paint", KT.wing([
      { le: [0, finRootY - 0.2, zd(Fn.rootD - 3.2 * P.tk)], c: 3.4 * P.tk, t: 0.06 },
      { le: [0, finRootY + 0.55 * P.tk, zd(Fn.rootD - 0.1)], c: 0.6, t: 0.1 },
    ], { M: 12, up: [1, 0, 0] }));
    const Ht = P.ht;
    const htRoot = { le: [0, Ht.y, zd(Ht.rootD)], c: Ht.rootC, t: 0.1 };
    const htTip = { le: [Ht.span / 2, Ht.y + (Ht.span / 2) * Ht.dih, zd(Ht.rootD) - Ht.sweep * Ht.span / 2], c: Ht.tipC, t: 0.09 };
    lifting(C, { st: [htRoot, htTip], mirror: true, key: "paint", M: 20,
      surfaces: [{ s0: P.R * 0.55, s1: Ht.span / 2 - 0.25, cf: 0.3, id: "elev", kind: "elevator", max: 0.4 }] });
    // APU exhaust in the tail cone
    C.put("all", "dark", KT.lathe([[0.001, 0.02], [0.18 * P.tk, 0], [0.2 * P.tk, -0.25]], 14).translate(0, CY + P.tail[P.tail.length - 1][1] * P.tk, tailZ + 0.12));
    // ---- landing gear (down pose authored; pivots at the top)
    const G = P.gear;
    const noseTop = B.at(zd(G.noseD), -HP, 0)[1] + 0.35;
    gearLeg(C, { id: "N", x: 0, z: zd(G.noseD), top: noseTop, r: G.noseR, w: G.noseR * 0.62, n: 2, track: G.noseR * 0.95,
      axis: "x", up: -1.62, strutR: 0.1 * P.k });
    for (const sd of [1, -1]) {
      const s = stationAt(wst, 0, G.mainX);
      gearLeg(C, { id: sd > 0 ? "MP" : "MS", x: sd * G.mainX, z: zd(G.mainD), top: s.le[1] - s.c * s.t * 0.2,
        r: G.mainR, w: G.mainR * 0.6, n: G.bogie ? 4 : 2, track: G.mainR * 1.28, bogie: G.bogie || 0,
        axis: "z", up: sd * 1.55, strutR: 0.16 * P.k,
        brace: [-sd * 0.7, s.le[1] - 0.8, 0.9], legDoor: { x: sd * 0.3, w: G.mainR * 1.9, h: (s.le[1] - G.mainR) * 0.55, z: 0.3 } });
    }
    // nose-gear doors: two long doors either side of the well
    for (const sd of [1, -1]) {
      const y = B.at(zd(G.noseD), -HP, 0)[1] + 0.02;
      gearDoor(C, "N" + (sd > 0 ? "P" : "S"), [sd * 0.34, y, zd(G.noseD - 0.9)], [sd * 0.34, y, zd(G.noseD + 1.3)], 0.32, sd * 1.35, "belly", sd < 0);
    }
    // ---- lights
    const wt = tip.le, sharkTop = tipExtra.length ? tipExtra[tipExtra.length - 1].le : wt;
    lights(C, {
      navR: [[wt[0] + 0.05, wt[1] + 0.02, wt[2] - 0.15]],
      navG: [[-wt[0] - 0.05, wt[1] + 0.02, wt[2] - 0.15]],
      navW: [[0, CY + P.tail[P.tail.length - 1][1] * P.tk, tailZ - 0.05], [wt[0], wt[1] + 0.05, wt[2] - tip.c + 0.1], [-wt[0], wt[1] + 0.05, wt[2] - tip.c + 0.1]],
      strobe: [[wt[0] + 0.05, wt[1], wt[2] - 0.35], [-wt[0] - 0.05, wt[1], wt[2] - 0.35], [0, CY + P.tail[P.tail.length - 1][1] * P.tk + 0.1, tailZ - 0.1]],
      beacon: [[0, CY + P.Rt + 0.06, zd(P.L * 0.5)], [0, CY - P.Rb - 0.06, zd(P.L * 0.38)]],
      land: [[P.R * 0.6, CY - P.Rb * 0.8, zd(Wg.st[0][1] + 0.4)], [-P.R * 0.6, CY - P.Rb * 0.8, zd(Wg.st[0][1] + 0.4)], [0, noseTop - 0.6, zd(G.noseD) + 0.25]],
    });
    void sharkTop;
    // ---- interior
    jetlinerCabin(C, B, P, zd);
    const out = C.finish();
    out.meta.dims = { family: P.family, length: P.L, span: P.span, height: P.H, fuselage: P.R * 2 };
    return out;
  }

  function jetlinerCabin(C, B, P, zd) {
    const k = P.k, FL = P.floorY;
    const zCockFront = zd(1.95 * k), zCockWall = zd(P.cockpitWall), zAft = zd(P.aftBulk);
    // floor through the whole pressurised length (cockpit included)
    floorStrip(C, B, zCockFront, zAft, FL, "floor", P.wall + 0.02);
    // aisle carpet strips
    for (const ax of P.aisles) {
      const g = new THREE.PlaneGeometry(0.46, zd(P.seats.d0 - 0.3) - zd(P.seats.d1 + 0.5));
      g.rotateX(-HP); g.translate(ax, FL + 0.006, (zd(P.seats.d0 - 0.3) + zd(P.seats.d1 + 0.5)) / 2);
      C.put("int", "fabric", g);
    }
    // bulkheads: cockpit rear wall (with doorway), the forward nose wall under
    // the panel, and the aft pressure bulkhead
    bulkhead(C, B, zCockWall, FL, { w: 0.86, h: 1.98 }, -1, "shell");
    bulkhead(C, B, zAft, FL, null, 1, "liner");
    // ceiling panel over the aisle(s) and the overhead bins
    const ceilY = FL + P.ceil;
    const zS0 = zd(P.cockpitWall + 0.3), zS1 = zd(P.aftBulk - 0.3);
    const binZ0 = zd(P.seats.d0 - 0.6), binZ1 = zd(P.seats.d1 + 0.4);
    const binBot = FL + 1.62;
    for (const sd of [1, -1]) {
      const wIn = B.halfWidthAt(zd(P.L * 0.45), binBot) - P.wall - 0.02;
      const x0 = P.binInner, x1 = wIn;
      const prof = [[x0, ceilY - 0.04], [x0 + 0.02, binBot + 0.3], [x0 + 0.08, binBot + 0.02], [x1, binBot - 0.02],
        [x1 - 0.02, binBot + 0.28], [x1 - 0.3, ceilY + 0.05]].map(function (p) { return [p[0] * sd, p[1]]; });
      if (sd < 0) prof.reverse();
      C.put("int", "cover", KT.sweep(prof, binZ0, binZ1));
      // passenger-service strip with the reading lights under the bins
      C.put("int", "clight", KT.xf(new THREE.BoxGeometry(0.06, 0.02, binZ0 - binZ1), sd * (x0 + 0.2), binBot - 0.02, (binZ0 + binZ1) / 2));
      C.put("int", "clight", KT.xf(new THREE.BoxGeometry(0.03, 0.02, binZ0 - binZ1), sd * (x0 + 0.01), ceilY - 0.06, (binZ0 + binZ1) / 2));
    }
    C.put("int", "liner", KT.xf(new THREE.PlaneGeometry(P.binInner * 2 + 0.04, zS0 - zS1).rotateX(HP), 0, ceilY, (zS0 + zS1) / 2));
    // monuments: galleys and lavatories as real cabinets
    for (const m of P.monuments) {
      const z0 = zd(m.d0), z1 = zd(m.d1), zc = (z0 + z1) / 2, dz = z0 - z1;
      const hw = B.halfWidthAt(zc, FL + 1.0) - P.wall - 0.03;
      const x0 = m.side > 0 ? hw - m.w : -hw, x1 = m.side > 0 ? hw : -hw + m.w;
      C.put("int", m.key || "shell", KT.xf(KT.rbox(x1 - x0, m.h, dz, 0.03, 1), (x0 + x1) / 2, FL + m.h / 2, zc));
      if (m.galley) {
        // stowage fronts: a grid of cart bays and ovens facing the aisle
        const fx = m.side > 0 ? x0 - 0.005 : x1 + 0.005;
        for (let r = 0; r < 3; r++) for (let q = 0; q < Math.max(1, Math.floor(dz / 0.35)); q++) {
          C.put("int", "metal", KT.xf(new THREE.PlaneGeometry(0.3, 0.28), fx, FL + 1.1 + r * 0.3, z0 - 0.2 - q * 0.35, 0, m.side > 0 ? -HP : HP, 0));
        }
      } else {
        const fx = m.side > 0 ? x0 - 0.005 : x1 + 0.005;
        C.put("int", "cover", KT.xf(new THREE.PlaneGeometry(0.62, 1.9), fx, FL + 0.97, zc, 0, m.side > 0 ? -HP : HP, 0));
      }
    }
    // the seats
    const seatRecs = [];
    const blocks = P.seats.blocks.map(function (b) { return { x: b.x, n: b.n, geo: seatBlock(b.n, P.seats.width) }; });
    let row = 0;
    for (let d = P.seats.d0; d <= P.seats.d1 + 1e-6; d += P.seats.pitch) {
      let dd = d;
      for (const e of (P.exits || [])) if (Math.abs(dd - e) < P.seats.pitch * 0.55) dd = null;
      if (dd == null) continue;
      const z = zd(dd);
      for (const b of blocks) {
        place(C, "int", b.geo, b.x, FL, z, 0);
        for (let i = 0; i < b.n; i++) {
          const sx = b.x - b.n * P.seats.width / 2 + P.seats.width * (i + 0.5);
          seatRecs.push({ x: sx, y: FL + 0.43, z: z + 0.04, row: row, col: i, window: Math.abs(sx) > P.R - 0.8, block: b.x });
        }
      }
      row++;
    }
    for (const b of blocks) disposeBlock(b.geo);
    // the flight deck
    const dk = { B: B, floorY: FL, zPanel: zd(2.64 * k), zSeat: zd(3.42 * k), halfW: B.halfWidthAt(zd(3.0 * k), FL + 0.9) - 0.12,
      eyeY: FL + 0.52 + 0.8, seatX: 0.52, cushion: 0.52, overheadY: FL + 2.02, overheadW: 0.86 };
    flightDeck(C, dk);
    // the cockpit door (hinged, opens into the flight deck)
    {
      const Pd = parts();
      Pd.put("shell", KT.xf(KT.rbox(0.82, 1.95, 0.05, 0.015, 1), 0.41, 0.975, 0));
      Pd.put("dark", KT.xf(new THREE.BoxGeometry(0.04, 0.12, 0.05), 0.72, 1.0, 0.04));
      const g = moverGroup("af:cdoor", Pd.p);
      g.position.set(-0.43, FL, zCockWall + 0.03);
      C.movers.push(g);
    }
    // publish the cabin geometry (Z-nose frame; build() converts)
    C.meta.cabin = {
      floorY: FL, seats: seatRecs, abreast: P.seats.blocks.reduce(function (a, b) { return a + b.n; }, 0), rows: row,
      cockpitWallZ: zCockWall, cockpitFrontZ: zd(2.6 * k), aftZ: zAft + 0.3, halfW: P.R - P.wall - 0.25,
      deckHalfW: dk.halfW - 0.1, pilots: [{ x: dk.seatX, z: dk.zSeat, id: "seat-captain", job: "pilot" }, { x: -dk.seatX, z: dk.zSeat, id: "seat-firstofficer", job: "co-pilot" }],
      crew: { x: 0, z: zd(P.doors.L1.d + 1.2) }, deckStand: { x: 0, z: dk.zSeat + 0.1 },
      cushion: 0.43, pilotCushion: 0.52,
      bodyY: [P.CY - P.Rb, P.CY + P.Rt],
    };
  }

  // A320-class nose shape (metres, k = 1): [d, cyOff, halfW, hTop, hBot]
  const NOSE_A = [
    [0.00, -0.40, 0.03, 0.03, 0.03],
    [0.30, -0.40, 0.46, 0.38, 0.38],
    [0.90, -0.46, 0.95, 0.72, 0.74],
    [1.60, -0.54, 1.33, 0.90, 1.00],
    [2.40, -0.60, 1.62, 1.06, 1.20],
    [3.30, -0.36, 1.84, 1.60, 1.58],
    [4.30, -0.10, 1.94, 1.92, 1.92],
    [5.40, 0.00, 1.975, 2.07, 2.02],
  ];

  const TYPES = {};
  TYPES.narrowbody = function () {
    return jetliner({
      id: "narrowbody", family: "narrowbody twinjet (A320 class)", L: 37.57, span: 35.80, H: 11.76,
      R: 1.975, Rt: 2.07, Rb: 2.02, CY: 4.0, floorY: 3.40, k: 1, wall: 0.12,
      nose: NOSE_A, barrel: [6.4, 24.5],
      // tail cone, d beyond the barrel end (scaled by tk), cyOff, and radii as fractions
      tail: [[1.5, 0.05, 0.995, 1.0, 0.98], [4.0, 0.22, 0.92, 0.95, 0.85], [6.5, 0.48, 0.77, 0.83, 0.65],
        [9.0, 0.78, 0.54, 0.63, 0.42], [11.1, 1.02, 0.29, 0.36, 0.22], [12.7, 1.18, 0.1, 0.13, 0.08], [13.07, 1.22, 0.01, 0.01, 0.01]],
      tk: 1, bandEnd: 30.9, aftBulk: 31.3, cockpitWall: 4.62, ceil: 2.18, binInner: 0.93,
      win: { d0: 7.25, d1: 29.3, pitch: 0.533, w: 0.24, h: 0.34, y: 1.0 },
      doors: { L1: { d: 5.85, w: 0.81, h: 1.85 }, R1: { d: 5.85, w: 0.81, h: 1.85, side: -1 },
        L2: { d: 30.35, w: 0.81, h: 1.85 }, R2: { d: 30.35, w: 0.81, h: 1.85, side: -1 } },
      exits: [16.35, 17.15], cargo: [{ d: 8.4, w: 1.8, h: 1.25 }, { d: 25.2, w: 1.8, h: 1.25 }],
      seats: { d0: 7.7, d1: 27.9, pitch: 0.79, width: 0.46, blocks: [{ x: 1.05, n: 3 }, { x: -1.05, n: 3 }] },
      aisles: [0],
      monuments: [
        { d0: 4.7, d1: 5.35, side: 1, w: 0.95, h: 2.05 },
        { d0: 4.7, d1: 6.95, side: -1, w: 0.95, h: 2.05, galley: true, key: "metal" },
        { d0: 28.3, d1: 29.3, side: 1, w: 0.92, h: 2.05 },
        { d0: 28.3, d1: 29.3, side: -1, w: 0.92, h: 2.05 },
        { d0: 30.95, d1: 31.25, side: 1, w: 1.5, h: 2.0, galley: true, key: "metal" },
        { d0: 30.95, d1: 31.25, side: -1, w: 1.5, h: 2.0, galley: true, key: "metal" },
      ],
      wing: {
        y: 2.62, dih: Math.tan(5.1 * Math.PI / 180),
        // [x, d of leading edge, chord, t/c]
        st: [[0, 12.35, 7.2, 0.155], [2.0, 13.39, 6.16, 0.15], [6.3, 15.63, 3.92, 0.13], [17.3, 21.35, 1.5, 0.105]],
        tip: [[17.46, 0.14, 21.47, 1.34, 0.1], [17.62, 0.58, 21.7, 1.02, 0.1], [17.72, 1.3, 22.06, 0.78, 0.1], [17.8, 2.43, 22.58, 0.52, 0.1]],
        surfaces: [
          { s0: 2.1, s1: 6.3, cf: 0.28, id: "fi", kind: "flap", max: 0.62, fowler: 0.55 },
          { s0: 6.3, s1: 12.9, cf: 0.28, id: "fo", kind: "flap", max: 0.55, fowler: 0.5 },
          { s0: 12.9, s1: 16.4, cf: 0.25, id: "ail", kind: "aileron", max: 0.35 },
        ],
        canoes: [4.3, 8.3, 11.4],
      },
      engines: [{ x: 5.75, y: 1.62, lipD: 10.3, r: 0.98, len: 4.3 }],
      fin: { rootD: 29.4, rootC: 5.9, tipC: 2.1, sweep: 0.66 },
      ht: { rootD: 32.2, span: 12.45, rootC: 3.6, tipC: 1.45, sweep: 0.62, dih: 0.105, y: 4.62 },
      gear: { noseD: 5.07, noseR: 0.38, mainD: 17.75, mainX: 3.8, mainR: 0.57 },
    });
  };
  TYPES.widebody = function () {
    const k = 1.46;
    return jetliner({
      id: "widebody", family: "widebody twinjet (787-9 class)", L: 62.81, span: 60.12, H: 17.02,
      R: 2.885, Rt: 3.0, Rb: 2.97, CY: 5.45, floorY: 4.72, k: k, wall: 0.15,
      nose: NOSE_A, barrel: [6.4 * k, 45.2],
      tail: [[2.0, 0.05, 0.995, 1.0, 0.98], [5.2, 0.24, 0.92, 0.95, 0.84], [8.5, 0.52, 0.77, 0.83, 0.64],
        [11.8, 0.84, 0.54, 0.62, 0.41], [14.6, 1.1, 0.29, 0.35, 0.21], [16.9, 1.28, 0.1, 0.12, 0.08], [17.61, 1.32, 0.01, 0.01, 0.01]],
      tk: 1, bandEnd: 53.5, aftBulk: 54.0, cockpitWall: 4.62 * k, ceil: 2.45, binInner: 1.02,
      win: { d0: 10.5, d1: 51.2, pitch: 0.62, w: 0.28, h: 0.47, y: 1.02 },
      doors: { L1: { d: 9.4, w: 1.07, h: 1.93 }, R1: { d: 9.4, w: 1.07, h: 1.93, side: -1 },
        L2: { d: 20.2, w: 1.07, h: 1.93 }, R2: { d: 20.2, w: 1.07, h: 1.93, side: -1 },
        L3: { d: 38.1, w: 1.07, h: 1.93 }, R3: { d: 38.1, w: 1.07, h: 1.93, side: -1 },
        L4: { d: 52.8, w: 1.07, h: 1.93 }, R4: { d: 52.8, w: 1.07, h: 1.93, side: -1 } },
      exits: [], cargo: [{ d: 13.6, w: 2.7, h: 1.7 }, { d: 43.0, w: 2.7, h: 1.7 }],
      seats: { d0: 11.0, d1: 50.6, pitch: 0.81, width: 0.46,
        blocks: [{ x: 1.95, n: 3 }, { x: 0, n: 3 }, { x: -1.95, n: 3 }] },
      aisles: [0.97, -0.97],
      monuments: [
        { d0: 7.3, d1: 8.6, side: 1, w: 1.0, h: 2.1 },
        { d0: 7.3, d1: 8.9, side: -1, w: 1.3, h: 2.1, galley: true, key: "metal" },
        { d0: 21.0, d1: 22.2, side: 1, w: 1.0, h: 2.1 },
        { d0: 21.0, d1: 22.2, side: -1, w: 1.0, h: 2.1 },
        { d0: 37.0, d1: 37.8, side: 1, w: 1.0, h: 2.1 },
        { d0: 37.0, d1: 37.8, side: -1, w: 1.0, h: 2.1 },
        { d0: 51.2, d1: 52.1, side: 1, w: 1.8, h: 2.1, galley: true, key: "metal" },
        { d0: 51.2, d1: 52.1, side: -1, w: 1.8, h: 2.1, galley: true, key: "metal" },
      ],
      wing: {
        y: 3.35, dih: Math.tan(6 * Math.PI / 180),
        st: [[0, 20.2, 13.4, 0.15], [2.9, 22.02, 11.2, 0.145], [10.2, 26.6, 6.9, 0.12], [27.4, 37.4, 2.3, 0.1]],
        // raked tip: swept back, no winglet
        tip: [[28.6, 0.12, 38.6, 1.6, 0.095], [29.6, 0.22, 40.0, 0.9, 0.09], [30.06, 0.26, 41.1, 0.45, 0.09]],
        surfaces: [
          { s0: 3.0, s1: 10.2, cf: 0.27, id: "fi", kind: "flap", max: 0.6, fowler: 0.9 },
          { s0: 10.2, s1: 21.5, cf: 0.25, id: "fo", kind: "flap", max: 0.55, fowler: 0.8 },
          { s0: 21.5, s1: 26.4, cf: 0.23, id: "ail", kind: "aileron", max: 0.35 },
        ],
        canoes: [6.8, 12.8, 17.2, 21.0],
      },
      engines: [{ x: 9.9, y: 2.95, lipD: 17.4, r: 1.52, len: 7.3 }],
      fin: { rootD: 49.8, rootC: 8.6, tipC: 3.0, sweep: 0.72 },
      ht: { rootD: 54.9, span: 19.8, rootC: 5.6, tipC: 1.9, sweep: 0.66, dih: 0.12, y: 6.3 },
      gear: { noseD: 7.5, noseR: 0.55, mainD: 30.3, mainX: 4.9, mainR: 0.64, bogie: 1.5 },
      zStep: 0.4,
    });
  };

  // ---------------------------------------------------------------------------
  //  BUSINESS JET — rear-mounted engines, T-tail, integrated airstair door
  // ---------------------------------------------------------------------------
  TYPES.bizjet = function () {
    const C = new Ctx("bizjet");
    const L = 20.92, N = L / 2, zd = function (d) { return N - d; };
    const R = 1.09, CY = 1.86, FL = 1.30, k = 0.56;
    const S = [];
    for (const s of NOSE_A) S.push([zd(s[0] * k * 1.25), CY + s[1] * k, s[2] * k * (R / (1.975 * k)), s[3] * k * (R / (1.975 * k)) * 1.02, s[4] * k * (R / (1.975 * k)), 2.0]);
    S.push([zd(6.2), CY, R, R * 1.03, R, 2.0]);
    S.push([zd(13.6), CY, R, R * 1.03, R, 2.0]);
    S.push([zd(15.2), CY + 0.1, R * 0.95, R * 0.98, R * 0.85, 2.0]);
    S.push([zd(17.0), CY + 0.3, R * 0.72, R * 0.78, R * 0.55, 2.0]);
    S.push([zd(18.9), CY + 0.5, R * 0.42, R * 0.48, R * 0.28, 2.0]);
    S.push([zd(20.4), CY + 0.62, R * 0.12, R * 0.14, R * 0.08, 2.0]);
    S.push([zd(20.92), CY + 0.64, 0.01, 0.01, 0.01, 2.0]);
    const B = KT.body(S);
    const opts = { zStep: 0.2, tStep: TAU / 64, wall: 0.08 };
    const nk = k * 1.25;
    const cw0 = zd(2.3 * nk), cw1 = zd(4.7 * nk);
    const regions = [{ z0: N, z1: cw0, t0: -HP, t1: 3 * HP }];
    const W1 = KT.quadHole([[zd(2.46 * nk), 1.5], [zd(3.28 * nk), 1.5], [zd(3.24 * nk), 1.02], [zd(2.66 * nk), 1.0]], 0.2);
    const W2 = KT.quadHole([[zd(2.9 * nk), 0.55], [zd(3.25 * nk), 0.9], [zd(4.0 * nk), 0.7], [zd(4.0 * nk), 0.36]], 0.2);
    const tA0 = 0.2, tAB = 0.97;
    const zc2 = zd(3.4 * nk);
    regions.push({ z0: cw0, z1: cw1, t0: tA0, t1: tAB, hole: W2 });
    regions.push({ z0: cw0, z1: zc2, t0: tAB, t1: HP, hole: W1 }, { z0: zc2, z1: cw1, t0: tAB, t1: HP });
    regions.push({ z0: cw0, z1: zc2, t0: HP, t1: Math.PI - tAB, hole: mirT(W1) }, { z0: zc2, z1: cw1, t0: HP, t1: Math.PI - tAB });
    regions.push({ z0: cw0, z1: cw1, t0: Math.PI - tAB, t1: Math.PI - tA0, hole: mirT(W2) });
    regions.push({ z0: cw0, z1: cw1, t0: Math.PI - tA0, t1: TAU + tA0 });
    // airstair door right behind the flight deck, port
    const dD = 3.55, dW = 0.86, dH = 1.72;
    const zD = zd(dD);
    const tS = B.thAtY(zD, FL), tT = B.thAtY(zD, FL + dH);
    const t0 = tS - 0.08, t1 = tT + 0.06;
    const doorHole = KT.roundRect(zD, (tS + tT) / 2, dW / 2, (tT - tS) / 2, 7, 40);
    const winY = FL + 0.78, winT = B.thAtY(zd(9), winY), winDT = 0.2;
    const fP = [{ zc: zD, half: dW / 2 + 0.12, hole: doorHole, pane: false }], fS = [];
    for (let i = 0; i < 7; i++) {
      const z = zd(5.2 + i * 1.12);
      const h = KT.roundRect(z, winT, 0.2, winDT, 2.6, 26);
      fP.push({ zc: z, half: 0.5, hole: h }); fS.push({ zc: z, half: 0.5, hole: mirT(h) });
    }
    const bandA = cw1, bandB = zd(14.2);
    for (const r of bandCells(bandA, bandB, t0, t1, fP)) regions.push(r);
    for (const r of bandCells(bandA, bandB, Math.PI - t1, Math.PI - t0, fS)) regions.push(r);
    regions.push({ z0: bandA, z1: bandB, t0: t1, t1: Math.PI - t1 });
    regions.push({ z0: bandA, z1: bandB, t0: Math.PI - t0, t1: TAU + t0, key: "belly" });
    regions.push({ z0: bandB, z1: zd(L), t0: -HP, t1: 3 * HP });
    skin(C, B, regions, Object.assign({ zone: [zd(1.9 * nk), zd(14.0)] }, opts));
    // livery: a sweeping accent band from the nose along the waist
    for (const sd of [1, -1]) {
      const a0 = sd > 0 ? t0 + 0.03 : Math.PI - (winT - winDT - 0.06), a1 = sd > 0 ? winT - winDT - 0.06 : Math.PI - (t0 + 0.03);
      C.put("all", "accent", KT.solidCell(B, zd(1.2), zd(18.5), a0, a1, 0.01, { zStep: 0.5, tStep: 0.05 }));
    }
    // the airstair door: hinged at its sill, steps on its inner face
    {
      const Pd = parts();
      Pd.put("paint", KT.pane(B, doorHole, -0.004, 3));
      Pd.put("liner", KT.pane(B, doorHole, -0.07, 3));
      Pd.put("dark", KT.seam(B, doorHole, 0.004, 0.01));
      const dwin = KT.roundRect(zD, (tS + tT) / 2 + (tT - tS) * 0.22, 0.14, 0.13, 3, 18);
      Pd.put("glass", KT.pane(B, dwin, 0.004, 2));
      const sill = B.at(zD, tS, 0);
      const hx = sill[0], hy = sill[1];
      // steps: horizontal treads on the inner face, which faces UP once open
      for (let i = 0; i < 5; i++) {
        const y = hy + 0.2 + i * 0.3;
        const hw = B.halfWidthAt(zD, y) - 0.1;
        Pd.put("dark", KT.xf(KT.rbox(0.22, 0.05, dW - 0.12, 0.015, 1), hw - 0.02, y, zD));
      }
      // handrail cables fold with the door
      for (const s of [1, -1]) Pd.put("metal", KT.tube([[hx - 0.06, hy + 0.1, zD + s * (dW / 2 - 0.04)], [hx - 0.12, hy + 1.1, zD + s * (dW / 2 - 0.04)], [hx - 0.2, hy + 1.5, zD + s * (dW / 2 - 0.08)]], 0.016, 8, 5));
      const lp = {};
      for (const kk in Pd.p) lp[kk] = Pd.p[kk].map(function (g) { return g.translate(-hx, -hy, -zD); });
      const leaf = moverGroup("af:door:L1", lp, { stair: true });
      leaf.position.set(hx, hy, zD);
      C.movers.push(leaf);
      C.meta.doors.L1 = { kind: "airstair", z: zD, sillY: hy, skinX: hx, w: dW, h: dH, side: 1, open: -2.3 };
    }
    // wings: low, swept, with winglets
    const wy = CY - R * 0.62, dih = Math.tan(3 * Math.PI / 180), sw = Math.tan(27 * Math.PI / 180);
    const wd0 = 8.6;
    const ws = [[0, wd0, 4.5, 0.14], [1.1, wd0 + 1.1 * sw, 3.9, 0.135], [3.6, wd0 + 3.6 * sw, 2.95, 0.12], [9.6, wd0 + 9.6 * sw, 1.25, 0.1]];
    const wst = ws.map(function (s) { return { le: [s[0], wy + s[0] * dih, zd(s[1])], c: s[2], t: s[3], cam: 0.3 }; });
    const tip = wst[wst.length - 1];
    const tipExtra = [[9.78, 0.1, 13.9, 1.12], [9.95, 0.4, 14.1, 0.92], [10.2, 1.0, 14.45, 0.72], [10.5, 1.55, 14.9, 0.5]]
      .map(function (s) { return { le: [s[0], tip.le[1] + s[1], zd(s[2])], c: s[3], t: 0.1 }; });
    lifting(C, { st: wst, tipExtra: tipExtra, mirror: true, M: 22, surfaces: [
      { s0: 1.2, s1: 6.2, cf: 0.27, id: "f", kind: "flap", max: 0.6, fowler: 0.25 },
      { s0: 6.2, s1: 9.0, cf: 0.25, id: "ail", kind: "aileron", max: 0.35 },
    ] });
    C.put("all", "accent", KT.wing(tipExtra.slice(1), { M: 16 }));
    C.put("all", "accent", KT.mirrorX(KT.wing(tipExtra.slice(1), { M: 16 })));
    // rear engines on stub pylons
    const ex = R + 0.78, ey = CY + 0.42, eL = 3.3, er = 0.56;
    for (const sd of [1, -1]) {
      turbofan(C, { x: sd * ex, y: ey, z: zd(14.3), r: er, len: eL, key: "paint", blades: 20 }, sd > 0 ? 0 : 1);
      C.put("all", "paint", KT.wing([
        { le: [sd * (R * 0.7), ey - 0.05, zd(15.4)], c: 1.7, t: 0.13 },
        { le: [sd * (ex - er * 0.9), ey, zd(15.2)], c: 1.4, t: 0.12 },
      ], { M: 14 }));
    }
    // T-tail
    const finRootY = B.at(zd(17.0), HP, 0)[1] - 0.2;
    const finTopY = 6.1 - 0.15;
    lifting(C, { axis: 1, up: [1, 0, 0], key: "accent", M: 20,
      st: [{ le: [0, finRootY - 0.3, zd(15.5)], c: 3.6, t: 0.12 }, { le: [0, finRootY, zd(15.8)], c: 3.3, t: 0.12 },
        { le: [0, finTopY, zd(15.8 + (finTopY - finRootY) * 0.72)], c: 2.0, t: 0.11 }],
      surfaces: [{ s0: finRootY + 0.15, s1: finTopY - 0.2, cf: 0.3, id: "rud", kind: "rudder", max: 0.45, key: "accent" }] });
    const htZ = zd(15.8 + (finTopY - finRootY) * 0.72 + 0.05);
    lifting(C, { st: [{ le: [0, 6.1, htZ], c: 1.95, t: 0.1 }, { le: [3.45, 6.1 + 0.08, htZ - 3.45 * 0.38], c: 0.95, t: 0.09 }],
      mirror: true, M: 18, surfaces: [{ s0: 0.25, s1: 3.2, cf: 0.32, id: "elev", kind: "elevator", max: 0.4 }] });
    // gear
    gearLeg(C, { id: "N", x: 0, z: zd(2.4), top: CY - R + 0.2, r: 0.27, w: 0.16, n: 2, track: 0.26, axis: "x", up: -1.62, strutR: 0.06 });
    for (const sd of [1, -1]) {
      gearLeg(C, { id: sd > 0 ? "MP" : "MS", x: sd * 1.95, z: zd(11.35), top: wy + 1.95 * dih - 0.05, r: 0.36, w: 0.2, n: 2, track: 0.28,
        axis: "z", up: sd * 1.62, strutR: 0.08, legDoor: { x: sd * 0.14, w: 0.72, h: 0.3, z: 0 } });
    }
    lights(C, {
      navR: [[tip.le[0] + 0.05, tip.le[1], tip.le[2] - 0.1]], navG: [[-tip.le[0] - 0.05, tip.le[1], tip.le[2] - 0.1]],
      navW: [[0, finTopY - 0.2, zd(19.6)]],
      strobe: [[tip.le[0] + 0.06, tip.le[1], tip.le[2] - 0.35], [-tip.le[0] - 0.06, tip.le[1], tip.le[2] - 0.35]],
      beacon: [[0, 6.2, htZ - 1.0], [0, CY - R - 0.05, zd(9.5)]],
      land: [[0, CY - R + 0.1, zd(2.2)]],
    });
    // interior: flight deck, club four, divan, galley, lav
    floorStrip(C, B, zd(1.9 * nk), zd(14.0), FL, "floor", 0.1);
    bulkhead(C, B, zd(14.0), FL, null, 1, "wood");
    const dk = { B: B, floorY: FL, zPanel: zd(2.64 * nk), zSeat: zd(3.35 * nk), halfW: B.halfWidthAt(zd(3.0 * nk), FL + 0.8) - 0.08,
      eyeY: FL + 0.46 + 0.8, seatX: 0.42, cushion: 0.46, overheadY: FL + 1.62, overheadW: 0.6, screens: 4, pedestal: true };
    flightDeck(C, dk);
    const seats = [];
    const club = function (x, z, face) {
      const P = parts();
      P.put("leather", KT.xf(KT.rbox(0.6, 0.14, 0.58, 0.06, 2), 0, 0.4, 0));
      P.put("leather", KT.xf(KT.rbox(0.62, 0.7, 0.16, 0.06, 2), 0, 0.78, -0.32, -0.12));
      for (const s of [1, -1]) P.put("leather", KT.xf(KT.rbox(0.1, 0.22, 0.55, 0.04, 2), s * 0.33, 0.55, -0.02));
      P.put("dark", KT.xf(KT.rbox(0.5, 0.33, 0.45, 0.03, 1), 0, 0.17, -0.02));
      place(C, "int", P.p, x, FL, z, face);
      disposeBlock(P.p);
      seats.push({ x: x, y: FL + 0.47, z: z, face: face });
    };
    const hwc = B.halfWidthAt(zd(8), FL + 0.5) - 0.42;
    club(hwc, zd(6.4), 0); club(hwc, zd(8.1), Math.PI);
    club(-hwc, zd(6.4), 0); club(-hwc, zd(8.1), Math.PI);
    for (const s of [1, -1]) C.put("int", "wood", KT.xf(KT.rbox(0.36, 0.05, 0.8, 0.02, 1), s * (hwc - 0.05), FL + 0.68, zd(7.25)));
    // three-place divan along the starboard wall
    C.put("int", "leather", KT.xf(KT.rbox(0.55, 0.16, 1.8, 0.06, 2), -hwc, FL + 0.38, zd(10.6)));
    C.put("int", "leather", KT.xf(KT.rbox(0.14, 0.62, 1.8, 0.06, 2), -hwc - 0.26, FL + 0.7, zd(10.6)));
    for (let i = 0; i < 3; i++) seats.push({ x: -hwc + 0.02, y: FL + 0.46, z: zd(10.0 + i * 0.6), face: -HP });
    C.put("int", "wood", KT.xf(KT.rbox(0.6, 1.05, 1.1, 0.03, 1), hwc - 0.05, FL + 0.52, zd(4.95)));      // galley
    C.put("int", "wood", KT.xf(KT.rbox(1.6, 1.8, 0.06, 0.02, 1), 0, FL + 0.9, zd(12.6)));                 // lav partition
    C.put("int", "clight", KT.xf(new THREE.BoxGeometry(0.03, 0.02, 7.5), 0.52, FL + 1.78, zd(8.5)));
    C.put("int", "clight", KT.xf(new THREE.BoxGeometry(0.03, 0.02, 7.5), -0.52, FL + 1.78, zd(8.5)));
    const out = C.finish();
    out.meta.body = B;
    out.meta.cabin = { floorY: FL, seats: seats, club: true, cockpitWallZ: zd(4.62 * nk), aftZ: zd(12.5), halfW: 0.8,
      pilots: [{ x: dk.seatX, z: dk.zSeat, id: "seat-captain", job: "pilot" }, { x: -dk.seatX, z: dk.zSeat, id: "seat-firstofficer", job: "co-pilot" }],
      cushion: 0.47, pilotCushion: 0.46, bodyY: [CY - R, CY + R] };
    out.meta.dims = { family: "business jet (super-midsize)", length: L, span: 21.0, height: 6.1, fuselage: R * 2 };
    return out;
  };

  // ---------------------------------------------------------------------------
  //  REGIONAL TURBOPROP — high wing, T-tail, six-blade props, rear airstair
  // ---------------------------------------------------------------------------
  TYPES.turboprop = function () {
    const C = new Ctx("turboprop");
    const L = 27.17, N = L / 2, zd = function (d) { return N - d; };
    const R = 1.435, CY = 2.2, FL = 1.62, k = 0.74;
    const S = [];
    for (const s of NOSE_A) S.push([zd(s[0] * k), CY + s[1] * k, s[2] * (R / 1.975), s[3] * (R / 1.975) * 0.98, s[4] * (R / 1.975), 2.0]);
    S.push([zd(5.4), CY, R, R * 1.01, R, 2.05]);
    S.push([zd(18.8), CY, R, R * 1.01, R, 2.05]);
    S.push([zd(21.0), CY + 0.2, R * 0.93, R * 0.98, R * 0.72, 2.0]);
    S.push([zd(23.4), CY + 0.55, R * 0.7, R * 0.8, R * 0.42, 2.0]);
    S.push([zd(25.6), CY + 0.86, R * 0.4, R * 0.5, R * 0.2, 2.0]);
    S.push([zd(26.9), CY + 1.0, R * 0.12, R * 0.14, R * 0.08, 2.0]);
    S.push([zd(27.17), CY + 1.02, 0.01, 0.01, 0.01, 2.0]);
    const B = KT.body(S);
    const opts = { zStep: 0.25, tStep: TAU / 64, wall: 0.08 };
    const cw0 = zd(2.3 * k), cw1 = zd(4.7 * k);
    const regions = [{ z0: N, z1: cw0, t0: -HP, t1: 3 * HP }];
    const W1 = KT.quadHole([[zd(2.46 * k), 1.5], [zd(3.28 * k), 1.5], [zd(3.24 * k), 1.02], [zd(2.66 * k), 1.0]], 0.18);
    const W2 = KT.quadHole([[zd(2.9 * k), 0.55], [zd(3.25 * k), 0.9], [zd(4.0 * k), 0.68], [zd(4.0 * k), 0.36]], 0.18);
    const tA0 = 0.2, tAB = 0.97, zc2 = zd(3.4 * k);
    regions.push({ z0: cw0, z1: cw1, t0: tA0, t1: tAB, hole: W2 });
    regions.push({ z0: cw0, z1: zc2, t0: tAB, t1: HP, hole: W1 }, { z0: zc2, z1: cw1, t0: tAB, t1: HP });
    regions.push({ z0: cw0, z1: zc2, t0: HP, t1: Math.PI - tAB, hole: mirT(W1) }, { z0: zc2, z1: cw1, t0: HP, t1: Math.PI - tAB });
    regions.push({ z0: cw0, z1: cw1, t0: Math.PI - tAB, t1: Math.PI - tA0, hole: mirT(W2) });
    regions.push({ z0: cw0, z1: cw1, t0: Math.PI - tA0, t1: TAU + tA0 });
    // the passenger door is at the REAR on the port side, with its own airstair
    const dD = 19.9, dW = 0.72, dH = 1.75, zD = zd(dD);
    const tS = B.thAtY(zD, FL), tT = B.thAtY(zD, FL + dH);
    const t0 = tS - 0.08, t1 = tT + 0.06;
    const doorHole = KT.roundRect(zD, (tS + tT) / 2, dW / 2, (tT - tS) / 2, 7, 40);
    const winT = B.thAtY(zd(10), FL + 0.98), winDT = 0.13;
    const fP = [{ zc: zD, half: dW / 2 + 0.12, hole: doorHole, pane: false }], fS = [];
    for (let d = 5.0; d <= 19.0; d += 0.76) {
      const z = zd(d);
      const h = KT.roundRect(z, winT, 0.13, winDT, 2.4, 22);
      if (Math.abs(d - dD) > dW / 2 + 0.3) fP.push({ zc: z, half: 0.38, hole: h });
      if (d > 7.0) fS.push({ zc: z, half: 0.38, hole: mirT(h) });
    }
    const bandA = cw1, bandB = zd(20.5);
    for (const r of bandCells(bandA, bandB, t0, t1, fP)) regions.push(r);
    for (const r of bandCells(bandA, bandB, Math.PI - t1, Math.PI - t0, fS)) regions.push(r);
    regions.push({ z0: bandA, z1: bandB, t0: t1, t1: Math.PI - t1 });
    regions.push({ z0: bandA, z1: bandB, t0: Math.PI - t0, t1: TAU + t0, key: "belly" });
    regions.push({ z0: bandB, z1: zd(L), t0: -HP, t1: 3 * HP });
    skin(C, B, regions, Object.assign({ zone: [zd(1.9 * k), zd(20.3)] }, opts));
    // forward cargo door (port) and service door (starboard) — seams
    C.put("all", "dark", KT.seam(B, KT.roundRect(zd(4.4), (tS + tT) / 2, 0.65, (tT - tS) / 2 * 0.8, 7, 30), 0.004, 0.01));
    C.put("all", "dark", KT.seam(B, mirT(KT.roundRect(zd(19.9), (tS + tT) / 2, 0.34, (tT - tS) / 2 * 0.75, 7, 30)), 0.004, 0.01));
    for (const sd of [1, -1]) {
      const a0 = sd > 0 ? t0 + 0.02 : Math.PI - (winT - winDT - 0.05), a1 = sd > 0 ? winT - winDT - 0.05 : Math.PI - (t0 + 0.02);
      C.put("all", "accent", KT.solidCell(B, zd(1.0), zd(24.5), a0, a1, 0.01, { zStep: 0.6, tStep: 0.05 }));
    }
    // rear airstair door
    {
      const Pd = parts();
      Pd.put("paint", KT.pane(B, doorHole, -0.004, 3));
      Pd.put("liner", KT.pane(B, doorHole, -0.07, 3));
      Pd.put("dark", KT.seam(B, doorHole, 0.004, 0.01));
      const sill = B.at(zD, tS, 0), hx = sill[0], hy = sill[1];
      for (let i = 0; i < 5; i++) {
        const y = hy + 0.22 + i * 0.3, hw = B.halfWidthAt(zD, y) - 0.1;
        Pd.put("dark", KT.xf(KT.rbox(0.22, 0.05, dW - 0.1, 0.015, 1), hw - 0.02, y, zD));
      }
      for (const s of [1, -1]) Pd.put("metal", KT.tube([[hx - 0.06, hy + 0.1, zD + s * (dW / 2 - 0.04)], [hx - 0.14, hy + 1.2, zD + s * (dW / 2 - 0.04)]], 0.016, 6, 5));
      const lp = {};
      for (const kk in Pd.p) lp[kk] = Pd.p[kk].map(function (g) { return g.translate(-hx, -hy, -zD); });
      const leaf = moverGroup("af:door:L1", lp, { stair: true });
      leaf.position.set(hx, hy, zD);
      C.movers.push(leaf);
      C.meta.doors.L1 = { kind: "airstair", z: zD, sillY: hy, skinX: hx, w: dW, h: dH, side: 1, open: -(Math.PI - Math.acos(hy / 1.75)) };
    }
    // high wing on the crown
    const wy = CY + R * 0.93, sw = 0.05;
    const ws = [[0, 10.6, 2.57, 0.18], [5.6, 10.6 + 5.6 * sw, 2.57, 0.17], [13.5, 10.9 + 13.5 * sw, 1.42, 0.13]];
    const dih = Math.tan(2.5 * Math.PI / 180);
    const wst = ws.map(function (s) { return { le: [s[0], wy + Math.max(0, s[0] - 5.6) * dih, zd(s[1])], c: s[2], t: s[3], cam: 0.5 }; });
    const tip = wst[wst.length - 1];
    lifting(C, { st: wst, mirror: true, M: 22, surfaces: [
      { s0: 1.5, s1: 3.1, cf: 0.3, id: "fi", kind: "flap", max: 0.6, fowler: 0.2 },
      { s0: 5.0, s1: 9.6, cf: 0.3, id: "fo", kind: "flap", max: 0.55, fowler: 0.2 },
      { s0: 9.6, s1: 12.9, cf: 0.27, id: "ail", kind: "aileron", max: 0.35 },
    ] });
    // wing-to-body fairing on top
    const fb = KT.body([[zd(9.8), wy - 0.1, 0.01, 0.01, 0.01, 2], [zd(10.4), wy, 0.9, 0.3, 0.2, 2.2], [zd(13.2), wy, 1.1, 0.34, 0.2, 2.6], [zd(15.2), wy - 0.1, 0.4, 0.2, 0.1, 2], [zd(16.0), wy - 0.2, 0.01, 0.01, 0.01, 2]]);
    C.put("all", "paint", KT.patch(fb, fb.z0, fb.z1, -0.2, Math.PI + 0.2, 0, 24, 12));
    // nacelles and six-blade props
    for (const sd of [1, -1]) {
      const nx = sd * 4.05, ny = wy - 0.62;
      const nb = KT.body([[zd(7.95), ny, 0.2, 0.22, 0.22, 2], [zd(8.3), ny, 0.52, 0.55, 0.58, 2.2], [zd(9.3), ny + 0.02, 0.6, 0.66, 0.68, 2.4],
        [zd(11.2), ny + 0.1, 0.56, 0.62, 0.62, 2.4], [zd(13.6), ny + 0.1, 0.44, 0.5, 0.4, 2.2], [zd(15.2), ny + 0.2, 0.18, 0.2, 0.14, 2], [zd(15.6), ny + 0.24, 0.02, 0.02, 0.02, 2]], nx);
      C.put("all", "paint", KT.patch(nb, nb.z0, nb.z1, -HP, 3 * HP, 0, 40, 20));
      // intake scoop under the spinner, exhaust stack on the outboard side
      C.put("all", "inlet", KT.xf(KT.rbox(0.36, 0.2, 0.5, 0.06, 2), nx, ny - 0.62, zd(8.9)));
      C.put("all", "dark", KT.xf(KT.lathe([[0.16, 0.2], [0.18, 0], [0.18, -0.3]], 12), nx + sd * 0.55, ny + 0.2, zd(11.6), 0, sd * 0.5, 0));
      propeller(C, { x: nx, y: ny, z: zd(7.9), r: 1.965, rs: 0.34, n: 6, spinKey: "paint" }, sd > 0 ? 0 : 1);
    }
    // T-tail
    const finRootY = B.at(zd(22.4), HP, 0)[1] - 0.2;
    lifting(C, { axis: 1, up: [1, 0, 0], key: "accent", M: 20,
      st: [{ le: [0, finRootY - 0.3, zd(20.6)], c: 4.4, t: 0.12 }, { le: [0, finRootY, zd(21.2)], c: 3.9, t: 0.12 }, { le: [0, 7.5, zd(23.9)], c: 1.95, t: 0.11 }],
      surfaces: [{ s0: finRootY + 0.2, s1: 7.3, cf: 0.3, id: "rud", kind: "rudder", max: 0.45, key: "accent" }] });
    lifting(C, { st: [{ le: [0, 7.56, zd(23.7)], c: 1.95, t: 0.1 }, { le: [3.65, 7.56, zd(24.4)], c: 1.15, t: 0.09 }],
      mirror: true, M: 18, surfaces: [{ s0: 0.25, s1: 3.4, cf: 0.33, id: "elev", kind: "elevator", max: 0.4 }] });
    // gear: nose, and mains that fold up into the fuselage sponsons
    gearLeg(C, { id: "N", x: 0, z: zd(2.2), top: CY - R + 0.25, r: 0.3, w: 0.18, n: 2, track: 0.3, axis: "x", up: -1.62, strutR: 0.07 });
    for (const sd of [1, -1]) {
      const sp = KT.body([[zd(11.0), 0.95, 0.02, 0.02, 0.02, 2], [zd(11.6), 1.0, 0.42, 0.45, 0.4, 2.2], [zd(14.2), 1.0, 0.5, 0.55, 0.45, 2.4], [zd(15.8), 1.1, 0.3, 0.3, 0.2, 2.2], [zd(16.6), 1.2, 0.02, 0.02, 0.02, 2]], sd * 1.6);
      C.put("all", "belly", KT.patch(sp, sp.z0, sp.z1, -HP, 3 * HP, 0, 28, 16));
      gearLeg(C, { id: sd > 0 ? "MP" : "MS", x: sd * 2.05, z: zd(13.1), top: 1.3, r: 0.44, w: 0.28, n: 2, track: 0.4, axis: "x", up: 1.45, strutR: 0.08 });
    }
    lights(C, {
      navR: [[tip.le[0] + 0.04, tip.le[1], tip.le[2] - 0.2]], navG: [[-tip.le[0] - 0.04, tip.le[1], tip.le[2] - 0.2]],
      navW: [[0, CY + 1.0, zd(L) + 0.05]],
      strobe: [[tip.le[0] + 0.05, tip.le[1], tip.le[2] - 0.5], [-tip.le[0] - 0.05, tip.le[1], tip.le[2] - 0.5]],
      beacon: [[0, 7.62, zd(24.3)], [0, CY - R - 0.05, zd(12.5)]],
      land: [[3.0, wy - 0.12, zd(10.6)], [-3.0, wy - 0.12, zd(10.6)]],
    });
    // interior: 2+2 at 76 cm
    floorStrip(C, B, zd(1.9 * k), zd(20.3), FL, "floor", 0.1);
    bulkhead(C, B, zd(4.62 * k), FL, { w: 0.7, h: 1.85 }, -1, "shell");
    bulkhead(C, B, zd(20.3), FL, null, 1, "liner");
    const dk = { B: B, floorY: FL, zPanel: zd(2.64 * k), zSeat: zd(3.4 * k), halfW: B.halfWidthAt(zd(3.0 * k), FL + 0.8) - 0.1,
      eyeY: FL + 0.48 + 0.8, seatX: 0.46, cushion: 0.48, overheadY: FL + 1.7, overheadW: 0.62, screens: 5 };
    flightDeck(C, dk);
    const seatRecs = [];
    const blk = seatBlock(2, 0.46);
    let row = 0;
    for (let d = 5.2; d <= 18.6; d += 0.76) {
      const z = zd(d);
      for (const bx of [0.78, -0.78]) {
        place(C, "int", blk, bx, FL, z, 0);
        for (let i = 0; i < 2; i++) seatRecs.push({ x: bx - 0.46 + 0.46 * (i + 0.5), y: FL + 0.43, z: z + 0.04, row: row, col: i, window: i === (bx > 0 ? 1 : 0) });
      }
      row++;
    }
    disposeBlock(blk);
    for (const sd of [1, -1]) {
      const binBot = FL + 1.5, x1 = B.halfWidthAt(zd(10), binBot) - 0.1;
      const prof = [[0.55, FL + 1.93], [0.56, binBot + 0.2], [0.6, binBot], [x1, binBot - 0.02], [x1 - 0.1, FL + 1.9]].map(function (p) { return [p[0] * sd, p[1]]; });
      if (sd < 0) prof.reverse();
      C.put("int", "cover", KT.sweep(prof, zd(4.9), zd(19.0)));
    }
    const out = C.finish();
    out.meta.body = B;
    out.meta.cabin = { floorY: FL, seats: seatRecs, abreast: 4, rows: row, cockpitWallZ: zd(4.62 * k), aftZ: zd(20.1), halfW: R - 0.35,
      pilots: [{ x: dk.seatX, z: dk.zSeat, id: "seat-captain", job: "pilot" }, { x: -dk.seatX, z: dk.zSeat, id: "seat-firstofficer", job: "co-pilot" }],
      cushion: 0.43, pilotCushion: 0.48, bodyY: [CY - R, CY + R] };
    out.meta.dims = { family: "regional turboprop (ATR 72 class)", length: L, span: 27.05, height: 7.65, fuselage: R * 2 };
    return out;
  };

  // ---------------------------------------------------------------------------
  //  LIGHT SINGLE — high wing on struts, fixed gear with spats, two doors
  // ---------------------------------------------------------------------------
  TYPES.single = function () {
    const C = new Ctx("single");
    const L = 8.28, N = L / 2 - 0.25, zd = function (d) { return N - d; };
    const CY = 1.32, FL = 0.74;
    const B = KT.body([
      [zd(0.30), CY - 0.05, 0.3, 0.3, 0.32, 2.2],
      [zd(0.55), CY - 0.04, 0.45, 0.42, 0.5, 2.6],
      [zd(1.0), CY - 0.02, 0.5, 0.5, 0.58, 2.8],
      [zd(1.62), CY, 0.54, 0.54, 0.6, 3.0],
      [zd(2.0), CY + 0.08, 0.56, 0.64, 0.6, 3.2],
      [zd(2.45), CY + 0.18, 0.57, 0.62, 0.62, 3.4],
      [zd(3.2), CY + 0.18, 0.56, 0.62, 0.6, 3.4],
      [zd(3.9), CY + 0.1, 0.48, 0.55, 0.5, 3.0],
      [zd(4.8), CY + 0.02, 0.34, 0.38, 0.36, 2.6],
      [zd(6.2), CY + 0.02, 0.2, 0.24, 0.22, 2.2],
      [zd(7.4), CY + 0.06, 0.1, 0.13, 0.12, 2.0],
      [zd(7.75), CY + 0.08, 0.02, 0.02, 0.02, 2.0],
    ]);
    const opts = { zStep: 0.12, tStep: TAU / 64, wall: 0.03 };
    const zW0 = zd(1.62), zW1 = zd(2.2), zDr0 = zd(2.0), zDr1 = zd(3.05);
    const regions = [{ z0: B.z0, z1: zW0, t0: -HP, t1: 3 * HP }];
    // windscreen: one big curved pane over the top front, centre strip
    const ws = KT.quadHole([[zd(1.66), 1.52], [zd(2.18), 1.52], [zd(2.18), 0.62], [zd(1.72), 0.52]], 0.12);
    regions.push({ z0: zW0, z1: zW1, t0: 0.3, t1: HP, hole: ws }, { z0: zW0, z1: zW1, t0: HP, t1: Math.PI - 0.3, hole: mirT(ws) });
    regions.push({ z0: zW0, z1: zW1, t0: Math.PI - 0.3, t1: TAU + 0.3 });
    // doors + door windows, rear side windows, rear window
    const tS = B.thAtY(zd(2.5), FL + 0.05), tT = B.thAtY(zd(2.5), CY + 0.7);
    const doorH = KT.quadHole([[zd(2.22), tS], [zd(2.22), tT], [zd(3.0), tT - 0.03], [zd(3.0), tS]], 0.12);
    const rearW = KT.quadHole([[zd(3.18), 0.25], [zd(3.18), 0.95], [zd(3.85), 0.85], [zd(3.85), 0.35]], 0.25);
    regions.push({ z0: zW1, z1: zDr1 - 0.0, t0: tS - 0.05, t1: tT + 0.05, hole: doorH, pane: false });
    regions.push({ z0: zW1, z1: zDr1, t0: Math.PI - tT - 0.05, t1: Math.PI - tS + 0.05, hole: mirT(doorH), pane: false });
    regions.push({ z0: zW1, z1: zDr1, t0: tT + 0.05, t1: Math.PI - tT - 0.05 });
    regions.push({ z0: zW1, z1: zDr1, t0: Math.PI - tS + 0.05, t1: TAU + tS - 0.05, key: "belly" });
    const zR1 = zd(3.95);
    regions.push({ z0: zDr1, z1: zR1, t0: 0.15, t1: 1.05, hole: rearW }, { z0: zDr1, z1: zR1, t0: Math.PI - 1.05, t1: Math.PI - 0.15, hole: mirT(rearW) });
    const topW = KT.quadHole([[zd(3.12), 1.25], [zd(3.12), Math.PI - 1.25], [zd(4.3), Math.PI - 1.4], [zd(4.3), 1.4]], 0.3);
    regions.push({ z0: zDr1, z1: zd(4.45), t0: 1.05, t1: Math.PI - 1.05, hole: topW });
    regions.push({ z0: zR1, z1: zd(4.45), t0: 0.15, t1: 1.05 }, { z0: zR1, z1: zd(4.45), t0: Math.PI - 1.05, t1: Math.PI - 0.15 });
    regions.push({ z0: zDr1, z1: zd(4.45), t0: Math.PI - 0.15, t1: TAU + 0.15, key: "belly" });
    regions.push({ z0: zd(4.45), z1: B.z1, t0: -HP, t1: 3 * HP });
    skin(C, B, regions, Object.assign({ zone: [zd(1.62), zd(4.2)] }, opts));
    // cheat stripe
    for (const sd of [1, -1]) {
      const a = B.thAtY(zd(5), CY - 0.02), b = B.thAtY(zd(5), CY + 0.08);
      C.put("all", "accent", KT.solidCell(B, zd(0.5), zd(7.2), sd > 0 ? a : Math.PI - b, sd > 0 ? b : Math.PI - a, 0.006, { zStep: 0.3, tStep: 0.04 }));
    }
    // the two doors, hinged at the front edge
    for (const sd of [1, -1]) {
      const Pd = parts(), h = sd > 0 ? doorH : mirT(doorH);
      Pd.put("paint", KT.pane(B, h, -0.003, 3));
      Pd.put("liner", KT.pane(B, h, -0.04, 3));
      const dw = KT.quadHole([[zd(2.3), tT - 0.02], [zd(2.95), tT - 0.05], [zd(2.95), B.thAtY(zd(2.6), CY + 0.12)], [zd(2.3), B.thAtY(zd(2.4), CY + 0.08)]], 0.15);
      Pd.put("glass", KT.pane(B, sd > 0 ? dw : mirT(dw), 0.004, 2));
      Pd.put("dark", KT.seam(B, h, 0.003, 0.007));
      const hp = B.at(zd(2.22), (tS + tT) / 2, 0);
      const hx = sd * Math.abs(hp[0]);
      const lp = {};
      for (const kk in Pd.p) lp[kk] = Pd.p[kk].map(function (g) { return g.translate(-hx, -hp[1], -zd(2.22)); });
      const g = moverGroup("af:door:" + (sd > 0 ? "L" : "R"), lp, { swing: sd });
      g.position.set(hx, hp[1], zd(2.22));
      C.movers.push(g);
      C.meta.doors[sd > 0 ? "L" : "R"] = { kind: "car", z: zd(2.6), sillY: FL, skinX: hx, w: 0.8, h: 0.95, side: sd };
    }
    // high wing on the cabin roof, struts to the lower fuselage
    const wy = CY + 0.72, wd = 2.02;
    const wst = [{ le: [0, wy, zd(wd)], c: 1.63, t: 0.15, cam: 0.8 }, { le: [2.6, wy + 0.08, zd(wd)], c: 1.63, t: 0.15, cam: 0.8 },
      { le: [5.5, wy + 0.17, zd(wd + 0.25)], c: 1.12, t: 0.12, cam: 0.6 }];
    lifting(C, { st: wst, mirror: true, M: 20, tipExtra: [{ le: [5.55, wy + 0.18, zd(wd + 0.3)], c: 1.0, t: 0.1 }],
      surfaces: [{ s0: 0.62, s1: 2.6, cf: 0.3, id: "f", kind: "flap", max: 0.55, fowler: 0.15 }, { s0: 2.75, s1: 5.2, cf: 0.3, id: "ail", kind: "aileron", max: 0.35 }] });
    for (const sd of [1, -1]) {
      C.put("all", "paint", KT.wing([{ le: [sd * 0.52, 0.86, zd(2.62)], c: 0.2, t: 0.25 }, { le: [sd * 2.55, wy - 0.06, zd(2.35)], c: 0.2, t: 0.25 }], { M: 10, up: [0, 0, 1], chordDir: [0, 0, -1] }));
    }
    // tail
    lifting(C, { axis: 1, up: [1, 0, 0], key: "accent", M: 16,
      st: [{ le: [0, CY + 0.08, zd(6.2)], c: 1.55, t: 0.1 }, { le: [0, 2.7, zd(7.25)], c: 0.8, t: 0.09 }],
      surfaces: [{ s0: CY + 0.2, s1: 2.6, cf: 0.4, id: "rud", kind: "rudder", max: 0.45, key: "accent" }] });
    C.put("all", "accent", KT.wing([{ le: [0, CY + 0.15, zd(5.2)], c: 1.0, t: 0.06 }, { le: [0, CY + 0.36, zd(6.25)], c: 0.3, t: 0.08 }], { M: 10, up: [1, 0, 0] }));
    lifting(C, { st: [{ le: [0, CY + 0.06, zd(6.7)], c: 1.1, t: 0.1 }, { le: [1.72, CY + 0.06, zd(6.9)], c: 0.78, t: 0.09 }], mirror: true, M: 14,
      surfaces: [{ s0: 0.2, s1: 1.62, cf: 0.42, id: "elev", kind: "elevator", max: 0.4 }] });
    // fixed gear: nose leg + spring-steel mains with spats
    gearLeg(C, { id: "N", x: 0, z: zd(0.95), top: CY - 0.45, r: 0.19, w: 0.13, n: 1, track: 0, wheelSide: 0, fixed: true, strutR: 0.035, spat: true });
    for (const sd of [1, -1]) {
      const P = parts();
      P.put("metal", KT.tube([[sd * 0.45, 0.82, zd(2.9)], [sd * 0.9, 0.5, zd(2.92)], [sd * 1.24, 0.24, zd(2.95)]], 0.035, 8, 6));
      P.put("dark", KT.xf(new THREE.CylinderGeometry(0.02, 0.02, 0.14, 8), sd * 1.3, 0.21, zd(2.95), 0, 0, HP));
      const ww = KT.lathe([[0.14, 0.07], [0.2, 0.06], [0.215, 0], [0.2, -0.06], [0.14, -0.07]], 18); ww.rotateY(HP); ww.translate(sd * 1.33, 0.215, zd(2.95));
      P.put("tire", ww);
      const sp = KT.lathe([[0.001, 0.3], [0.11, 0.24], [0.16, 0.0], [0.13, -0.26], [0.001, -0.36]], 14); sp.scale(1.1, 1.5, 1.1); sp.translate(sd * 1.33, 0.26, zd(2.95));
      P.put("paint", sp);
      for (const kk in P.p) for (const g of P.p[kk]) C.put("all", kk, g);
    }
    // engine cowl detail: nostril intakes + exhaust
    C.put("all", "inlet", KT.xf(KT.rbox(0.16, 0.1, 0.08, 0.03, 2), 0.2, CY - 0.28, zd(0.36)));
    C.put("all", "inlet", KT.xf(KT.rbox(0.16, 0.1, 0.08, 0.03, 2), -0.2, CY - 0.28, zd(0.36)));
    C.put("all", "dark", KT.tube([[0.18, CY - 0.55, zd(1.2)], [0.2, CY - 0.66, zd(1.45)]], 0.04, 4, 8));
    propeller(C, { x: 0, y: CY - 0.06, z: zd(0.2), r: 0.95, rs: 0.13, n: 2, spinKey: "accent" }, 0);
    lights(C, {
      navR: [[5.57, wy + 0.18, zd(wd + 0.4)]], navG: [[-5.57, wy + 0.18, zd(wd + 0.4)]], navW: [[0, 2.7, zd(7.9)]],
      strobe: [[5.58, wy + 0.18, zd(wd + 0.8)], [-5.58, wy + 0.18, zd(wd + 0.8)]], beacon: [[0, 2.75, zd(7.4)]],
      land: [[1.2, wy - 0.07, zd(wd) + 0.01]],
    });
    // interior: four seats, panel, yokes
    floorStrip(C, B, zd(1.65), zd(4.1), FL, "floor", 0.04);
    const P = parts();
    for (const sd of [1, -1]) {
      P.put("fabric", KT.xf(KT.rbox(0.44, 0.12, 0.46, 0.05, 2), sd * 0.25, FL + 0.32, zd(2.72)));
      P.put("fabric", KT.xf(KT.rbox(0.44, 0.66, 0.12, 0.05, 2), sd * 0.25, FL + 0.7, zd(2.98), -0.2));
      P.put("metal", KT.tube([[sd * 0.25, FL + 0.02, zd(2.6)], [sd * 0.25, FL + 0.26, zd(2.72)]], 0.03, 2, 6));
    }
    P.put("fabric", KT.xf(KT.rbox(0.95, 0.12, 0.46, 0.05, 2), 0, FL + 0.3, zd(3.62)));
    P.put("fabric", KT.xf(KT.rbox(0.95, 0.6, 0.12, 0.05, 2), 0, FL + 0.66, zd(3.9), -0.18));
    for (const kk in P.p) for (const g of P.p[kk]) C.put("int", kk, g);
    const D = parts();
    D.put("panel", KT.xf(KT.rbox(0.98, 0.34, 0.12, 0.03, 2), 0, CY + 0.2, zd(1.78), -0.12));
    D.put("dark", KT.xf(KT.rbox(1.0, 0.07, 0.22, 0.03, 2), 0, CY + 0.39, zd(1.75)));
    for (const sd of [1, -1]) {
      D.put("screen", KT.xf(new THREE.PlaneGeometry(0.3, 0.2), sd * 0.24, CY + 0.2, zd(1.845), -0.12 + Math.PI, Math.PI, 0));
      D.put("dark", KT.tube([[sd * 0.25, CY + 0.12, zd(1.86)], [sd * 0.25, CY + 0.12, zd(2.1)]], 0.015, 2, 6));
      D.put("dark", KT.xf(new THREE.TorusGeometry(0.1, 0.014, 5, 14, Math.PI), sd * 0.25, CY + 0.05, zd(2.12)));
    }
    for (const kk in D.p) for (const g of D.p[kk]) C.put("deck", kk, g);
    const out = C.finish();
    out.meta.body = B;
    out.meta.cabin = { floorY: FL, seats: [{ x: -0.25, y: FL + 0.38, z: zd(2.72) }, { x: -0.24, y: FL + 0.36, z: zd(3.62) }, { x: 0.24, y: FL + 0.36, z: zd(3.62) }],
      pilots: [{ x: 0.25, z: zd(2.72), id: "seat-captain", job: "pilot" }], cushion: 0.38, pilotCushion: 0.38, bodyY: [CY - 0.62, CY + 0.72] };
    out.meta.dims = { family: "light single (C172 class)", length: L, span: 11.0, height: 2.72, fuselage: 1.12 };
    return out;
  };

  // ---------------------------------------------------------------------------
  //  HELICOPTER — the lofted light twin, all civil variants
  // ---------------------------------------------------------------------------
  function heliStations(vip) {
    const L = vip ? 0.55 : 0;
    return [
      [3.62, 0.06, 0.03, 0.03, 0.03, 2.0], [3.45, 0.06, 0.40, 0.34, 0.38, 2.2], [3.05, 0.14, 0.76, 0.62, 0.62, 2.5],
      [2.45, 0.24, 0.98, 0.84, 0.72, 3.0], [1.60, 0.27, 1.08, 0.90, 0.76, 3.6], [0.40, 0.27, 1.10, 0.90, 0.77, 3.8],
      [-0.70 - L, 0.27, 1.08, 0.88, 0.75, 3.6], [-1.55 - L, 0.36, 0.86, 0.74, 0.56, 3.0], [-2.35 - L, 0.52, 0.48, 0.44, 0.30, 2.4],
      [-3.10 - L, 0.60, 0.29, 0.28, 0.22, 2.1], [-4.60 - L * 0.5, 0.66, 0.21, 0.20, 0.17, 2.0], [-6.05, 0.72, 0.15, 0.15, 0.13, 2.0],
      [-6.42, 0.74, 0.09, 0.10, 0.08, 2.0], [-6.52, 0.74, 0.02, 0.02, 0.02, 2.0],
    ];
  }
  function plate(stations, C3, T3) {
    // aerofoil plate along explicit mid-chord stations (fins, stabiliser)
    const S = stations.map(function (s) { return { le: [s.o[0] + C3[0] * s.c / 2, s.o[1] + C3[1] * s.c / 2, s.o[2] + C3[2] * s.c / 2], c: s.c, t: s.t / s.c }; });
    return KT.wing(S, { M: 14, chordDir: [-C3[0], -C3[1], -C3[2]], up: T3 });
  }
  // variant: "civil" | "police" | "news" | "medical" | "vip" | "gunship"
  function heliTemplate(variant) {
    const vip = variant === "vip", armed = variant === "gunship";
    const wheels = vip;
    const C = new Ctx("heli-" + variant);
    const H = KT.body(heliStations(vip));
    // skin: cockpit glass as holes, cabin windows, the rest solid; livery split
    const opts = { zStep: 0.15, tStep: TAU / 72, wall: 0.04 };
    const SPLIT = -0.22;
    const regions = [];
    const W = KT.quadHole([[3.1, 0.54], [3.1, HP - 0.03], [2.2, HP - 0.03], [2.2, 0.36]], 0.22);
    const Wc = KT.roundRect(2.92, -0.62, 0.3, 0.34, 3, 22);
    const DZ = 1.72, DTH = Math.PI - 0.30, DDZ = 0.46, DDTH = 0.50;
    const doorP = KT.roundRect(DZ, DTH, DDZ, DDTH, 4, 36);                      // pilot door (starboard side)
    const doorC = KT.roundRect(DZ, 0.30, DDZ, DDTH, 4, 36);                     // co-pilot door (port side)
    regions.push({ z0: 3.62, z1: 3.12, t0: -HP, t1: 3 * HP });
    regions.push({ z0: 3.12, z1: 2.18, t0: 0.2, t1: HP, hole: W }, { z0: 3.12, z1: 2.18, t0: HP, t1: Math.PI - 0.2, hole: mirT(W) });
    regions.push({ z0: 3.12, z1: 2.18, t0: Math.PI - 0.2, t1: Math.PI + 0.36 }, { z0: 3.12, z1: 2.18, t0: TAU - 0.36, t1: TAU + 0.2 });
    regions.push({ z0: 3.12, z1: 2.18, t0: Math.PI + 0.36, t1: Math.PI * 1.5, hole: mirT(KT.roundRect(2.66, -0.62 + TAU, 0.3, 0.3, 3, 22)).map(function (p) { return [p[0], p[1]]; }), key: "belly" });
    regions.push({ z0: 3.12, z1: 2.18, t0: Math.PI * 1.5, t1: TAU - 0.36, hole: KT.roundRect(2.66, TAU - 0.62, 0.3, 0.3, 3, 22), key: "belly" });
    void Wc;
    // cockpit doors band (z 2.18..1.26) and cabin
    regions.push({ z0: 2.18, z1: 1.26, t0: -0.2, t1: 0.8, hole: doorC, pane: true }, { z0: 2.18, z1: 1.26, t0: Math.PI - 0.8, t1: Math.PI + 0.2, hole: doorP, pane: true });
    regions.push({ z0: 2.18, z1: 1.26, t0: 0.8, t1: Math.PI - 0.8 });
    regions.push({ z0: 2.18, z1: 1.26, t0: Math.PI + 0.2, t1: TAU - 0.2, key: "belly" });
    const winZ = vip ? [0.88, 0.02, -0.84] : [0.62, -0.26];
    const cabP = [], cabS = [];
    for (const z of winZ) {
      cabP.push({ zc: z, half: 0.42, hole: KT.roundRect(z, 0.28, 0.27, 0.26, 3.2, 24) });
      cabS.push({ zc: z, half: 0.42, hole: mirT(KT.roundRect(z, 0.28, 0.27, 0.26, 3.2, 24)) });
    }
    const zc0 = 1.26, zc1 = vip ? -1.4 : -1.1;
    for (const r of bandCells(zc0, zc1, -0.2, 0.8, cabP)) regions.push(r);
    for (const r of bandCells(zc0, zc1, Math.PI - 0.8, Math.PI + 0.2, cabS)) regions.push(r);
    regions.push({ z0: zc0, z1: zc1, t0: 0.8, t1: Math.PI - 0.8 });
    regions.push({ z0: zc0, z1: zc1, t0: Math.PI + 0.2, t1: TAU - 0.2, key: "belly" });
    // boom: upper paint, lower belly colour split at the livery line
    regions.push({ z0: zc1, z1: -6.52, t0: SPLIT, t1: Math.PI - SPLIT });
    regions.push({ z0: zc1, z1: -6.52, t0: Math.PI - SPLIT, t1: TAU + SPLIT, key: "belly" });
    skin(C, H, regions, Object.assign({ zone: [3.0, zc1 + 0.1] }, opts));
    // cheat line
    for (const s of [1, -1]) {
      const th = s > 0 ? SPLIT : Math.PI - SPLIT;
      C.put("all", "accent", KT.solidCell(H, 3.2, -5.6, th - 0.05, th + 0.05, 0.006, { zStep: 0.3, tStep: 0.05 }));
    }
    // cockpit doors: hinged at the forward edge, both sides
    for (const sd of [1, -1]) {
      const hole = sd > 0 ? doorC : doorP;
      const Pd = parts();
      Pd.put("paint", KT.pane(H, hole, -0.002, 3));
      Pd.put("dark", KT.seam(H, hole, 0.004, 0.012));
      const win = KT.roundRect(DZ + 0.02, sd > 0 ? 0.5 : Math.PI - 0.5, DDZ * 0.72, DDTH * 0.46, 4, 22);
      Pd.put("glass", KT.pane(H, win, 0.006, 2));
      const hp = H.at(DZ + DDZ, sd > 0 ? 0.3 : Math.PI - 0.3, 0);
      const lp = {};
      for (const kk in Pd.p) lp[kk] = Pd.p[kk].map(function (g) { return g.translate(-hp[0], -hp[1], -hp[2]); });
      const g = moverGroup("af:door:" + (sd > 0 ? "L" : "R"), lp, { swing: sd });
      g.position.set(hp[0], hp[1], hp[2]);
      C.movers.push(g);
      C.meta.doors[sd > 0 ? "L" : "R"] = { kind: "car", z: DZ, side: sd, skinX: hp[0] };
    }
    if (vip || variant === "medical" || variant === "police" || variant === "news" || variant === "civil") {
      // sliding cabin door outline + track on the port side
      C.put("all", "dark", KT.seam(H, KT.roundRect(0.18, 0.28, 0.62, 0.5, 7, 32), 0.006, 0.011));
      C.put("all", "dark", KT.line(H, [[1.0, 0.86], [-1.1, 0.86]], 0.012, 0.015));
    }
    // engine deck (doghouse), intakes, exhausts, mast
    const DH = KT.body([[1.25, 1.02, 0.02, 0.02, 0.02, 2.2], [1.05, 1.06, 0.42, 0.30, 0.20, 2.6], [0.30, 1.10, 0.62, 0.42, 0.24, 3.2],
      [-0.90, 1.10, 0.62, 0.40, 0.24, 3.2], [-1.80 - (vip ? 0.4 : 0), 1.02, 0.44, 0.28, 0.20, 2.8], [-2.40 - (vip ? 0.45 : 0), 0.90, 0.08, 0.08, 0.08, 2.2]]);
    C.put("all", "paint", KT.patch(DH, 1.25, -2.40 - (vip ? 0.45 : 0), -0.25, Math.PI + 0.25, 0, 30, 18));
    for (const s of [1, -1]) {
      C.put("all", "inlet", KT.pane(DH, KT.roundRect(0.62, s > 0 ? 0.35 : Math.PI - 0.35, 0.26, 0.30, 3, 20), 0.01, 2));
      const ex = new THREE.CylinderGeometry(0.13, 0.16, 0.5, 14, 1, true);
      C.put("all", "dark", KT.xf(ex, s * 0.52, 1.20, -1.55 - (vip ? 0.4 : 0), HP + 0.25, 0, -s * 0.55));
    }
    const HUBY = 1.86;
    C.put("all", "paint", KT.xf(new THREE.SphereGeometry(0.42, 18, 10, 0, TAU, 0, HP), 0, 1.40, 0.05, 0, 0, 0, 1, 0.55, 1.15));
    C.put("all", "dark", KT.xf(new THREE.CylinderGeometry(0.11, 0.14, HUBY - 1.40, 12), 0, (HUBY + 1.40) / 2, 0.05));
    C.put("all", "metal", KT.xf(new THREE.CylinderGeometry(0.30, 0.30, 0.06, 20), 0, 1.66, 0.05));
    // tail: fin, ventral fin, stabiliser with end plates, tail-rotor gearbox
    const FZ = -6.02;
    C.put("all", "accent", plate([{ o: [0, 0.78, FZ + 0.05], c: 1.05, t: 0.15 }, { o: [0, 1.35, FZ - 0.28], c: 0.82, t: 0.12 }, { o: [0, 1.92, FZ - 0.58], c: 0.56, t: 0.08 }], [0, 0, 1], [1, 0, 0]));
    C.put("all", "belly", plate([{ o: [0, 0.62, FZ + 0.1], c: 0.7, t: 0.1 }, { o: [0, 0.18, FZ - 0.12], c: 0.42, t: 0.07 }], [0, 0, 1], [1, 0, 0]));
    C.put("all", "dark", KT.tube([[0, 0.24, FZ + 0.05], [0, 0.04, FZ - 0.15], [0, 0.05, FZ - 0.45]], 0.028, 10));
    const SZ = -5.05 + (vip ? 0.15 : 0);
    C.put("all", "paint", plate([{ o: [-1.12, 0.70, SZ], c: 0.46, t: 0.06 }, { o: [0, 0.70, SZ + 0.04], c: 0.60, t: 0.09 }, { o: [1.12, 0.70, SZ], c: 0.46, t: 0.06 }], [0, 0, 1], [0, 1, 0]));
    for (const s of [1, -1]) C.put("all", "accent", plate([{ o: [s * 1.13, 0.55, SZ - 0.04], c: 0.34, t: 0.04 }, { o: [s * 1.13, 0.94, SZ - 0.12], c: 0.26, t: 0.03 }], [0, 0, 1], [1, 0, 0]));
    const TRX = 0.30, TRY = 1.42, TRZ = FZ - 0.36;
    C.put("all", "paint", KT.xf(new THREE.SphereGeometry(0.16, 14, 10), 0.07, TRY, TRZ, 0, 0, 0, 1, 1, 1.3));
    // landing gear: skids or the VIP's wheels in sponsons
    if (!wheels) {
      const SY = -1.02, SX = 1.02;
      for (const s of [1, -1]) {
        C.put("all", "dark", KT.tube([[s * SX, SY + 0.02, -1.55], [s * SX, SY, -0.8], [s * SX, SY, 1.2], [s * SX, SY + 0.05, 1.85], [s * SX * 0.98, SY + 0.28, 2.2]], 0.055, 30, 8));
        C.put("all", "dark", KT.xf(new THREE.SphereGeometry(0.055, 10, 8), s * SX, SY + 0.02, -1.55));
      }
      for (const cz of [1.05, -0.95]) C.put("all", "metal", KT.tube([[-SX, SY, cz], [-0.99, -0.72, cz], [-0.74, -0.51, cz], [0, -0.55, cz], [0.74, -0.51, cz], [0.99, -0.72, cz], [SX, SY, cz]], 0.06, 36, 8));
    } else {
      for (const s of [1, -1]) {
        const SP = KT.body([[0.95, -0.32, 0.02, 0.02, 0.02, 2.2], [0.70, -0.30, 0.20, 0.20, 0.22, 2.6], [-0.10, -0.26, 0.26, 0.26, 0.28, 3.0], [-1.10, -0.20, 0.22, 0.22, 0.22, 2.8], [-1.60, -0.12, 0.02, 0.02, 0.02, 2.2]], s * 1.08);
        C.put("all", "belly", KT.patch(SP, 0.95, -1.60, -HP, 3 * HP, 0, 26, 18));
        gearLeg(C, { id: s > 0 ? "MP" : "MS", x: s * 1.08, z: -0.30, top: -0.4, r: 0.3, w: 0.2, n: 1, wheelSide: 0, axis: "x", up: 1.5, strutR: 0.06, fixed: false });
      }
      gearLeg(C, { id: "N", x: 0, z: 2.55, top: -0.32, r: 0.19, w: 0.12, n: 2, track: 0.2, axis: "x", up: -1.5, strutR: 0.05 });
    }
    // role equipment
    if (variant === "police") {
      // searchlight on the starboard skid mount + a stabilised camera ball under the chin
      // the searchlight hangs on a gimbal under the belly centre (the beam
      // police.js casts starts here)
      C.put("all", "dark", KT.xf(new THREE.CylinderGeometry(0.12, 0.18, 0.2, 12), 0, -0.6, 0.1));
      C.put("all", "dark", KT.xf(new THREE.CylinderGeometry(0.2, 0.24, 0.3, 16), 0, -0.78, 0.1));
      C.put("all", "land", KT.xf(new THREE.CircleGeometry(0.19, 16).rotateX(HP), 0, -0.935, 0.1));
      C.put("all", "dark", KT.xf(new THREE.SphereGeometry(0.22, 16, 12), 0, -0.52, 3.0));
      C.put("all", "glass", KT.xf(new THREE.CircleGeometry(0.08, 12), 0, -0.52, 3.215));
      C.put("all", "dark", KT.xf(KT.rbox(0.5, 0.14, 0.22, 0.05, 2), 0.95, -0.35, 1.2));        // loudspeaker
    } else if (variant === "news") {
      C.put("all", "metal", KT.xf(new THREE.SphereGeometry(0.28, 18, 12), 0, -0.55, 3.05));
      C.put("all", "glass", KT.xf(new THREE.CircleGeometry(0.11, 14), 0, -0.55, 3.325));
      C.put("all", "dark", KT.xf(new THREE.CylinderGeometry(0.06, 0.08, 0.2, 10), 0, -0.36, 3.05));
      C.put("all", "dark", KT.tube([[0.3, 1.2, -0.5], [0.3, 1.45, -0.7]], 0.02, 4, 6));      // microwave link mast
    } else if (variant === "medical") {
      C.put("all", "metal", KT.xf(KT.rbox(0.18, 0.22, 0.5, 0.04, 2), -0.9, 0.6, 0.2));          // hoist
      C.put("all", "dark", KT.tube([[-0.9, 0.6, 0.2], [-1.35, 0.8, 0.2]], 0.04, 4, 6));
    } else if (armed) {
      for (const s of [1, -1]) {
        C.put("all", "metal", plate([{ o: [s * 0.95, 0.00, 0.35], c: 0.95, t: 0.16 }, { o: [s * 1.95, 0.08, 0.28], c: 0.70, t: 0.11 }], [0, 0, 1], [0, 1, 0]));
        const POD = KT.body([[1.30, -0.28, 0.03, 0.03, 0.03, 2], [1.05, -0.28, 0.22, 0.22, 0.22, 2], [-0.30, -0.28, 0.25, 0.25, 0.25, 2], [-0.55, -0.28, 0.20, 0.20, 0.20, 2]], s * 1.62);
        C.put("all", "dark", KT.patch(POD, 1.30, -0.55, -HP, 3 * HP, 0, 16, 14));
        C.put("all", "dark", KT.xf(new THREE.BoxGeometry(0.1, 0.22, 0.6), s * 1.62, -0.08, 0.35));
      }
      C.put("all", "dark", KT.xf(new THREE.SphereGeometry(0.24, 16, 12), 0, -0.48, 2.85));
      C.put("all", "metal", KT.xf(new THREE.CylinderGeometry(0.045, 0.05, 0.9, 10), 0, -0.52, 3.3, HP, 0, 0));
    }
    // interior: floor, two crew seats up front, passenger bench/club behind,
    // panel under the glareshield (the live panel replaces it in first person)
    floorStrip(C, H, 3.0, zc1 + 0.15, -0.5, "floor", 0.05);
    const R = parts();
    for (const s of [1, -1]) pilotSeat(R, s * 0.42, -0.5, 1.55, 0.42);
    const pax = vip ? [[0.45, -0.1, Math.PI], [-0.45, -0.1, Math.PI], [0.45, -0.95, 0], [-0.45, -0.95, 0]] : [[0.5, -0.75, 0], [0, -0.75, 0], [-0.5, -0.75, 0]];
    const paxSeats = [];
    for (const p of pax) {
      R.put(vip ? "leather" : "fabric", KT.xf(KT.rbox(0.46, 0.12, 0.46, 0.05, 2), p[0], -0.5 + 0.42, p[1]));
      R.put(vip ? "leather" : "fabric", KT.xf(KT.rbox(0.46, 0.62, 0.12, 0.05, 2), p[0], -0.5 + 0.75, p[1] + (p[2] ? 0.26 : -0.26), p[2] ? 0.18 : -0.18));
      paxSeats.push({ x: p[0], y: -0.5 + 0.42, z: p[1], face: p[2] });
    }
    if (variant === "medical") R.put("cover", KT.xf(KT.rbox(0.6, 0.12, 1.9, 0.04, 2), 0.35, -0.1, -0.3));   // stretcher
    for (const kk in R.p) for (const g of R.p[kk]) C.put("int", kk, g);
    const D = parts();
    D.put("panel", KT.xf(KT.rbox(1.2, 0.34, 0.24, 0.05, 2), 0, 0.2, 2.62, 0.3));
    for (let i = 0; i < 3; i++) D.put("screen", KT.xf(new THREE.PlaneGeometry(0.28, 0.2), (i - 1) * 0.36, 0.22, 2.5, -0.3 + Math.PI, Math.PI, 0));
    D.put("panel", KT.xf(KT.rbox(0.26, 0.34, 0.5, 0.04, 2), 0, -0.3, 2.3));
    for (const kk in D.p) for (const g of D.p[kk]) C.put("deck", kk, g);
    // rotor: two bars 90 degrees apart (four blades), tail rotor on the port side
    const Rr = 4.72;
    const bladeSt = function () {
      const st = [];
      for (let i = 0; i <= 8; i++) {
        const x = 0.42 + (Rr - 0.42) * i / 8, t = i / 8, tip = t > 0.9 ? (t - 0.9) / 0.1 : 0;
        st.push({ le: [x, -0.07 * t * t - 0.02 * tip, 0.19 * (1 - 0.25 * tip) - 0.04 * tip], c: 0.38 * (1 - 0.25 * tip), t: 0.14 * (1 - 0.35 * t) });
      }
      return st;
    };
    const bar = function (name, withHub) {
      const Pb = parts();
      for (const s of [1, -1]) {
        const b = KT.wing(bladeSt(), { M: 12, up: [0, 1, 0] }); if (s < 0) b.rotateY(Math.PI);
        Pb.put("blade", b);
        Pb.put("blade", KT.xf(new THREE.CylinderGeometry(0.07, 0.085, 0.5, 10), s * 0.36, 0, 0, 0, 0, HP));
      }
      if (withHub) {
        Pb.put("blade", new THREE.CylinderGeometry(0.30, 0.30, 0.09, 4).rotateY(Math.PI / 4));
        Pb.put("blade", KT.xf(new THREE.CylinderGeometry(0.12, 0.18, 0.18, 14), 0, 0.12, 0));
      }
      const g = moverGroup(name, Pb.p, { spin: "y" });
      g.position.set(0, HUBY, 0.05);
      return g;
    };
    const r1 = bar("af:rotor:0", true), r2 = bar("af:rotor:1", false);
    r2.rotation.y = HP;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(Rr, 48), mats().paint);
    disc.rotation.x = -HP; disc.position.set(0, HUBY, 0.05); disc.name = "af:rotorDisc"; disc.userData.mk = "blur";
    const tbar = function (name) {
      const Pb = parts();
      for (const s of [1, -1]) Pb.put("blade", plate([{ o: [0, s * 0.10, 0], c: 0.17, t: 0.03 }, { o: [0, s * 0.80, 0], c: 0.12, t: 0.02 }], [0, 0, 1], [1, 0, 0]));
      Pb.put("blade", KT.xf(new THREE.CylinderGeometry(0.08, 0.08, 0.1, 12), 0, 0, 0, 0, 0, HP));
      const g = moverGroup(name, Pb.p, { spin: "x" });
      g.position.set(TRX, TRY, TRZ);
      return g;
    };
    const t1 = tbar("af:trotor:0"), t2 = tbar("af:trotor:1"); t2.rotation.x = HP;
    C.movers.push(r1, r2, disc, t1, t2);
    // lights: port red (+X), starboard green, white tail, beacons, strobes
    lights(C, {
      navR: [[armed ? 2.0 : 1.12, armed ? 0.08 : 0.55, armed ? 0.28 : -0.3]], navG: [[armed ? -2.0 : -1.12, armed ? 0.08 : 0.55, armed ? 0.28 : -0.3]],
      navW: [[0, 1.0, -6.5]], beacon: [[0, 1.3, -2.2 - (vip ? 0.45 : 0)], [0, -0.78, 0.2]], strobe: [[0, 1.95, FZ - 0.6], [1.13, 0.95, SZ - 0.1], [-1.13, 0.95, SZ - 0.1]],
      land: [[0.2, -0.72, 2.6], [-0.2, -0.72, 2.6]],
    });
    const out = C.finish();
    out.meta.body = H;
    out.meta.heli = { hubY: HUBY, R: Rr, vip: vip, armed: armed, wheels: wheels };
    out.meta.cabin = { floorY: -0.5, seats: paxSeats, pilots: [{ x: -0.42, z: 1.55, id: "seat-captain", job: "pilot" }, { x: 0.42, z: 1.55, id: "seat-firstofficer", job: "co-pilot" }], cushion: 0.42, pilotCushion: 0.42 };
    out.meta.dims = { family: "light twin helicopter", length: 10.14 + 0.45, span: Rr * 2, height: 3.0, fuselage: 2.2 };
    return out;
  }

  // ---------------------------------------------------------------------------
  //  TEMPLATE CACHE, INSTANCES, RIG
  // ---------------------------------------------------------------------------
  const CACHE = new Map();
  // which flight class playeraircraft.js flies each type as
  const FLIGHT_KIND = { narrowbody: "airliner", widebody: "airliner", bizjet: "privatejet", turboprop: "turboprop", single: "prop" };
  function template(id) {
    let t = CACHE.get(id);
    if (!t) {
      if (id.indexOf("heli-") === 0) t = heliTemplate(id.slice(5));
      else if (TYPES[id]) t = TYPES[id]();
      else throw new Error("airframes: unknown type " + id);
      t.template.traverse(function (o) { if (o.geometry) o.geometry._shared = true; });
      CACHE.set(id, t);
    }
    return t;
  }
  const _live = new Set();
  // build(type, opts) -> THREE.Group
  //   opts.livery   colour or {accent, accent2, belly, body}
  //   opts.noseX    wrap so the nose points down local +X (airport convention)
  //   opts.variant  helicopter variant
  function build(type, opts) {
    opts = opts || {};
    const id = type === "heli" ? "heli-" + (opts.variant || "civil") : type;
    const T = template(id);
    const lv = livery(opts.livery);
    const M = mats();
    const inner = T.template.clone(true);
    const rig = { id: id, type: type, meta: T.meta, gear: [], gdoors: [], surf: [], props: [], fans: [], rotors: [], trotors: [],
      doors: {}, strobe: null, beacon: null, land: null, deck: null, blur: [], near: [], far: [], int: [], disc: null,
      state: { gear: 1, t: Math.random() * 10, lastRoll: 0, lastPitch: 0, lastHdg: 0, spin: 0, ail: 0, elev: 0, rud: 0, flap: 0 }, lod: -1 };
    const bodyMat = opts.livery && opts.livery.body != null ? livMat(opts.livery.body) : M.paint;
    inner.traverse(function (o) {
      if (o.isMesh) {
        const k = o.userData.mk;
        if (k === "accent") o.material = livMat(lv.accent);
        else if (k === "accent2") o.material = livMat(lv.accent2);
        else if (k === "belly") o.material = livMat(lv.belly);
        else if (k === "paint") o.material = bodyMat;
        else if (k === "blur") { o.material = blurMat(); rig.blur.push(o); }
        else o.material = M[k] || M.paint;
        const lod = o.userData.lod;
        if (lod === "near") rig.near.push(o); else if (lod === "far") rig.far.push(o); else if (lod === "int") rig.int.push(o);
        if (lod === "far") o.visible = false;
        if (k === "strobe" || k === "beacon" || k === "land" || k === "navR" || k === "navG" || k === "navW") o.castShadow = false;
      }
      const n = o.name || "";
      if (n.indexOf("af:gear:") === 0) rig.gear.push(o);
      else if (n.indexOf("af:gdoor:") === 0) rig.gdoors.push(o);
      else if (n.indexOf("af:surf:") === 0) rig.surf.push(o);
      else if (n.indexOf("af:prop:") === 0) rig.props.push(o);
      else if (n.indexOf("af:fan:") === 0) rig.fans.push(o);
      else if (n.indexOf("af:rotor:") === 0) rig.rotors.push(o);
      else if (n.indexOf("af:trotor:") === 0) rig.trotors.push(o);
      else if (n === "af:rotorDisc") rig.disc = o;
      else if (n === "af:strobe") rig.strobe = o;
      else if (n === "af:beacon") rig.beacon = o;
      else if (n === "af:land") rig.land = o;
      else if (n === "af:deck") rig.deck = o;
      else if (n === "af:cdoor") rig.cdoor = o;
      else if (n.indexOf("af:door:") === 0) rig.doors[n.slice(8)] = { node: o, t: 0, spec: T.meta.doors[n.slice(8)] };
    });
    rig.surf.forEach(function (s) { s.userData._q0 = new THREE.Quaternion().fromArray(s.userData.q0); s.userData._p0 = new THREE.Vector3().fromArray(s.userData.p0); });
    rig.gdoors.forEach(function (s) { s.userData._q0 = new THREE.Quaternion().fromArray(s.userData.q0); });
    if (rig.strobe) rig.strobe.visible = false;
    if (rig.beacon) rig.beacon.visible = false;
    if (rig.land) rig.land.visible = false;
    let root = inner;
    if (opts.noseX) {
      root = new THREE.Group();
      inner.rotation.y = HP;
      root.add(inner);
      rig.noseX = true;
    }
    rig.inner = inner;
    root.name = "airframe:" + id;
    root.userData.airframe = rig.id;
    Object.defineProperty(root.userData, "_af", { value: rig, enumerable: false, writable: true, configurable: true });
    root.userData.aircraftDims = Object.assign({}, T.meta.dims);
    root.userData.flightKind = FLIGHT_KIND[type] || null;
    // every airframe models its own flight deck (cockpit.js dresses only the
    // live instruments over it)
    root.userData.flightDeck = true;
    rig.root = root;
    // the crew seats, in the shape cockpit.js's eye solver and npclife read
    // (city/island_airport.js replaces this with the full cabin record)
    const cs = cabinSpec(root);
    if (cs) {
      root.userData.cabin = { flightDeck: true, floorTop: cs.floorTop, seats: cs.pilots.map(function (p) {
        return { id: p.id, job: p.job, role: "pilot", kind: "cockpit-seat", cockpit: true, x: p.x, y: p.y, z: p.z, heading: p.heading,
          cushionH: cs.pilotCushion, floorBelow: cs.pilotCushion, reservedForNpc: false, occupant: null };
      }) };
    }
    // publish the parts the rest of the game already speaks to
    if (type === "heli") {
      root.userData.rotor = rig.rotors[0]; root.userData.rotor2 = rig.rotors[1];
      root.userData.trotor = rig.trotors[0]; root.userData.trotor2 = rig.trotors[1];
      root.userData.rotorDisc = rig.disc;
    }
    _live.add(rig);
    return root;
  }
  function rigOf(grp) { return grp && grp.userData ? grp.userData._af || null : null; }
  // Z-nose local → the root's frame (identity, or the airport's nose-+X turn)
  function toRoot(rig, x, y, z) { return rig && rig.noseX ? { x: z, y: y, z: -x } : { x: x, y: y, z: z }; }

  // ---------------------------------------------------------------------------
  //  ANIMATION
  // ---------------------------------------------------------------------------
  const _q = new THREE.Quaternion(), _ax = new THREE.Vector3(1, 0, 0);
  function poseSurface(s, a) {
    const u = s.userData;
    _q.setFromAxisAngle(_ax, a * (u.sgn || 1));
    s.quaternion.copy(u._q0).multiply(_q);
    if (u.fowler) {
      const f = Math.max(0, a / (u.max || 1)) * u.fowler;
      s.position.copy(u._p0);
      const v = new THREE.Vector3(u.aft[0], u.aft[1], u.aft[2]).applyQuaternion(u._q0);
      s.position.addScaledVector(v, f);
    }
  }
  function poseGear(rig, t) {
    // t: 1 = down and locked, 0 = up
    const e = t * t * (3 - 2 * t);
    for (const g of rig.gear) {
      if (g.userData.fixed) continue;
      const a = (1 - e) * (g.userData.up || 0);
      if (g.userData.axis === "x") g.rotation.set(a, 0, 0); else g.rotation.set(0, 0, a);
      g.visible = t > 0.02;
    }
    for (const d of rig.gdoors) {
      // doors open in the middle of the cycle and stay open with the gear down
      const o = d.userData.open * Math.min(1, t * 3);
      _q.setFromAxisAngle(_ax, o);
      d.quaternion.copy(d.userData._q0).multiply(_q);
    }
  }
  // s: {gear 0..1 target, ail -1..1, elev -1..1, rud -1..1, flap 0..1, power 0..1,
  //     lights: "off" | "nav" | "on", landing: bool, running: bool}
  function animate(grp, s, dt) {
    const rig = rigOf(grp);
    if (!rig) return false;
    const st = rig.state;
    st.t += dt;
    // gear
    if (s.gear != null) {
      const tgt = s.gear ? 1 : 0;
      if (st.gear !== tgt) { st.gear += Math.sign(tgt - st.gear) * Math.min(Math.abs(tgt - st.gear), dt / 7); poseGear(rig, st.gear); }
    }
    // control surfaces ease toward command
    const ease = Math.min(1, dt * 6);
    st.ail += ((s.ail || 0) - st.ail) * ease;
    st.elev += ((s.elev || 0) - st.elev) * ease;
    st.rud += ((s.rud || 0) - st.rud) * ease;
    st.flap += ((s.flap || 0) - st.flap) * Math.min(1, dt * 0.8);
    for (const q of rig.surf) {
      const u = q.userData;
      let a = 0;
      if (u.kind === "aileron") a = st.ail * u.max * (u.side || 1);
      else if (u.kind === "elevator") a = -st.elev * u.max;
      else if (u.kind === "rudder") a = st.rud * u.max;
      else if (u.kind === "flap") a = st.flap * u.max;
      poseSurface(q, a);
    }
    // props, fans and rotors spin with power; blur discs take over the blades
    const power = s.power || 0;
    st.spin += dt * (s.running === false ? 0 : (6 + 60 * power));
    const blurA = s.running === false ? 0 : clamp((power - 0.08) * 1.6, 0, 0.42);
    for (let i = 0; i < rig.props.length; i++) {
      rig.props[i].rotation.z = st.spin * (i % 2 ? -1 : 1);
      rig.props[i].visible = blurA < 0.36;
    }
    for (const f of rig.fans) f.rotation.z = st.spin * 1.4;
    for (const b of rig.blur) b.material.opacity += (blurA - b.material.opacity) * Math.min(1, dt * 3);
    if (rig.rotors.length && s.rotor !== false) {
      const rr = s.rotor != null ? s.rotor : (s.running === false ? 0 : 0.6 + power);
      st.rspin = (st.rspin || 0) + dt * rr * 28;
      rig.rotors[0].rotation.y = st.rspin; if (rig.rotors[1]) rig.rotors[1].rotation.y = st.rspin + HP;
      for (let i = 0; i < rig.trotors.length; i++) rig.trotors[i].rotation.x = st.rspin * 1.6 + i * HP;
      if (rig.disc) rig.disc.material.opacity += (clamp((rr - 0.3) * 0.3, 0, 0.3) - rig.disc.material.opacity) * Math.min(1, dt * 4);
    }
    // lights: beacon with engines running, strobes airborne, landing lights low
    const L = s.lights || "nav";
    if (rig.beacon) rig.beacon.visible = L !== "off" && s.running !== false && (st.t % 1.1) < 0.12;
    if (rig.strobe) { const p = st.t % 1.25; rig.strobe.visible = L === "on" && (p < 0.05 || (p > 0.14 && p < 0.19)); }
    if (rig.land) rig.land.visible = !!s.landing;
    return true;
  }
  // doors: t 0 shut .. 1 open
  function poseDoor(grp, id, t) {
    const rig = rigOf(grp); if (!rig) return;
    const d = rig.doors[id || "L1"] || rig.doors.L || rig.doors[Object.keys(rig.doors)[0]];
    if (!d) return;
    d.t = t;
    const sp = d.spec || {}, n = d.node;
    const e = t * t * (3 - 2 * t);
    if (sp.kind === "plug") {
      // push out and up, then swing forward on the arm keeping the leaf parallel
      const a = Math.max(0, (e - 0.12) / 0.88) * 2.9;
      n.rotation.y = a;
      const leaf = n.children[0];
      if (leaf) { leaf.rotation.y = -a; leaf.position.set(Math.min(1, e / 0.12) * 0.06, Math.min(1, e / 0.12) * 0.05, 0); }
    } else if (sp.kind === "airstair") {
      n.rotation.z = -e * Math.abs(sp.open || 2.3) * (sp.side || 1);
    } else if (sp.kind === "car") {
      n.rotation.y = e * 1.15 * (sp.side || 1);
    }
  }
  function poseCockpitDoor(grp, t) {
    const rig = rigOf(grp); if (!rig || !rig.cdoor) return;
    const e = t * t * (3 - 2 * t);
    rig.cdoor.rotation.y = -e * 1.7;
  }

  // ---------------------------------------------------------------------------
  //  LOD — interior and perforated skin by camera distance, hysteresis
  // ---------------------------------------------------------------------------
  const _cv = new THREE.Vector3(), _gv = new THREE.Vector3();
  let _lodAcc = 0;
  function lodTick(dt, camPos) {
    _lodAcc += dt;
    if (_lodAcc < 0.2) return;
    _lodAcc = 0;
    const cam = camPos || (CBZ.camera && CBZ.camera.position);
    if (!cam) return;
    _cv.copy(cam);
    _live.forEach(function (rig) {
      const g = rig.root;
      if (!g.parent) { if (rig._orphan && rig._orphan > 50) _live.delete(rig); rig._orphan = (rig._orphan || 0) + 1; return; }
      rig._orphan = 0;
      g.getWorldPosition(_gv);
      const d = _gv.distanceTo(_cv) - (rig.meta.dims.length || 10) * 0.35;
      const near = rig.lod === 0 ? d < NEAR_R * LOD_HYST : d < NEAR_R;
      const inside = rig.lodInt ? d < INTERIOR_R * LOD_HYST : d < INTERIOR_R;
      if ((near ? 0 : 1) !== rig.lod) {
        rig.lod = near ? 0 : 1;
        for (const m of rig.near) m.visible = near;
        for (const m of rig.far) m.visible = !near;
      }
      if (inside !== rig.lodInt) {
        rig.lodInt = inside;
        for (const m of rig.int) m.visible = inside;
        if (rig.deck) rig.deck.visible = inside && !rig.deckHidden;
      }
    });
  }
  if (CBZ.onUpdate) CBZ.onUpdate(56, function (dt) { lodTick(dt); });
  function dispose(grp) {
    const rig = rigOf(grp);
    if (rig) _live.delete(rig);
    if (grp && grp.traverse) grp.traverse(function (o) {
      if (o.isMesh && o.material && !o.material._shared) { try { o.material.dispose(); } catch (e) {} }
    });
  }

  // ---------------------------------------------------------------------------
  //  CABIN RECORDS in the root frame (what the airport, npclife and cockpit
  //  code read): seats, doors, walkable boxes
  // ---------------------------------------------------------------------------
  function cabinSpec(grp) {
    const rig = rigOf(grp); if (!rig || !rig.meta.cabin) return null;
    const c = rig.meta.cabin, d = rig.meta.doors.L1 || rig.meta.doors.L;
    const R = function (x, y, z) { return toRoot(rig, x, y, z); };
    const hd = rig.noseX ? HP : 0;
    const out = {
      floorTop: c.floorY,
      seats: c.seats.map(function (s) { const p = R(s.x, s.y, s.z); return { x: p.x, y: p.y, z: p.z, heading: (s.face || 0) + hd, row: s.row, col: s.col, window: s.window }; }),
      pilots: (c.pilots || []).map(function (s) { const p = R(s.x, c.floorY + (c.pilotCushion || 0.5), s.z); return { id: s.id, job: s.job, x: p.x, y: p.y, z: p.z, heading: hd }; }),
      rows: c.rows || 0, abreast: c.abreast || 0,
      cushion: c.cushion, pilotCushion: c.pilotCushion,
      bodyY: c.bodyY || null,
    };
    if (d) {
      const p = R(d.skinX + 0.02, d.sillY, d.z);
      out.door = { x: p.x, z: p.z, kind: d.kind, sillY: d.sillY };
      const o = R(d.skinX + 1.6, 0, d.z), i = R(d.skinX - 1.0, 0, d.z - 0.6);
      out.doorOut = { x: o.x, z: o.z }; out.doorIn = { x: i.x, z: i.z };
      const e = R(0.35, 0, d.z - 0.9); out.entry = { x: e.x, z: e.z };
      const ex = R(d.skinX + 3.0, 0, d.z); out.exit = { x: ex.x, z: ex.z };
    }
    if (c.cockpitWallZ != null) {
      // in the Z-nose frame: aft end, bulkhead, deck front; half widths
      const a = R(0, 0, c.aftZ || -5), w = R(0, 0, c.cockpitWallZ), f = R(0, 0, c.cockpitFrontZ || c.cockpitWallZ + 1.5);
      out.walk = { aft: rig.noseX ? a.x : a.z, wall: rig.noseX ? w.x : w.z, front: rig.noseX ? f.x : f.z,
        halfW: c.halfW || 1, deckHalfW: c.deckHalfW || (c.halfW || 1) * 0.8, doorHalfW: 0.4, wallT: 0.12 };
    }
    if (c.crew) { const p = R(c.crew.x, c.floorY, c.crew.z); out.crew = { x: p.x, y: p.y, z: p.z, heading: Math.PI + hd }; }
    if (c.deckStand) { const p = R(c.deckStand.x, 0, c.deckStand.z); out.deckStand = { x: p.x, z: p.z }; }
    return out;
  }

  // ---------------------------------------------------------------------------
  //  PUBLISH
  // ---------------------------------------------------------------------------
  const DIMS = {
    airliner: { family: "narrowbody twinjet (A320 class)", length: 37.57, span: 35.80, height: 11.76, fuselage: 3.95 },
    widebody: { family: "widebody twinjet (787-9 class)", length: 62.81, span: 60.12, height: 17.02, fuselage: 5.77 },
    turboprop: { family: "regional turboprop (ATR 72 class)", length: 27.17, span: 27.05, height: 7.65, fuselage: 2.87 },
    privatejet: { family: "business jet (super-midsize)", length: 20.92, span: 21.00, height: 6.10, fuselage: 2.18 },
    single: { family: "light single (C172 class)", length: 8.28, span: 11.00, height: 2.72, fuselage: 1.12 },
  };
  CBZ.CITY_AIRCRAFT_DIMS = Object.freeze(DIMS);
  CBZ.airframes = {
    build: build, rig: rigOf, animate: animate, poseDoor: poseDoor, poseCockpitDoor: poseCockpitDoor,
    poseGear: function (grp, t) { const r = rigOf(grp); if (r) { r.state.gear = t; poseGear(r, t); } },
    hideDeck: function (grp, on) { const r = rigOf(grp); if (r) { r.deckHidden = !!on; if (r.deck) r.deck.visible = !on && !!r.lodInt; } },
    cabin: cabinSpec, toRoot: toRoot, dispose: dispose, lodTick: lodTick,
    template: template, types: Object.keys(TYPES).concat(["heli"]), liveries: LIVERIES, livery: livery,
    heliVariants: ["civil", "police", "news", "medical", "vip", "gunship"],
    dims: DIMS, NEAR_R: NEAR_R, INTERIOR_R: INTERIOR_R,
  };
})();
