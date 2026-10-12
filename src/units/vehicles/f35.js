/* ============================================================
   units/vehicles/f35.js — F-35A Lightning II (USA), conventional take-off.

   Redrawn from scratch for NPC War (wave B). Before this file drew its own
   airframe the F-35 was city/mil_air.js's generic "fighter": a round tube
   with bombs and missiles hanging off four underwing pylons (the one thing
   a stealth fighter does not do), no weapons bays, no gun, no chines, a
   smooth bubble with no frame, and two GBU-12s per pass out of a load of four
   that never left the airframe.

   THE AIRFRAME (real metres, nose +Z, port +X, wheels on y = 0). F-35A
   figures: 15.67 m long, 10.70 m span, 4.38 m tall, wing 42.7 m2 with a 34 deg
   leading edge and a forward-swept trailing edge, all-moving stabilators, twin
   fins canted 20 deg outboard, one F135 under a low-observable nozzle with 15
   serrated petals. The fuselage is two lofted skins meeting at a sharp CHINE
   that runs from the nose tip back over the caret intakes into the wing's
   leading edge (the upper skin and the lower skin keep their own normals, so
   the chine reads as a crease, not a tube). Diverterless supersonic inlets
   (the DSI bump on the forebody inside each mouth), the one-piece canopy with
   its gold ITO tint and its bow frame, the EOTS faceted sapphire window under
   the chin, six DAS apertures, the boom receptacle on the spine, blade
   antennas, the GAU-22/A in its fairing over the LEFT intake with its port
   door, and a tricycle gear that retracts above 8 m.

   THE WEAPONS BAYS. Two bays in the belly either side of the keel, each a
   real cavity (the skin is cut, the bay is a light-grey box inside the body)
   behind an inboard and an outboard door with sawtooth (edge-aligned) ends.
   Each bay carries one AIM-120C on its inboard station and one air-to-ground
   load on its heavy station: a GBU-31(V)1 2,000 lb JDAM, or a BRU-61 with
   four GBU-39 Small Diameter Bombs. The doors stay shut (stealth) until the
   pilot is inside the release window, open in about a second, hold open
   through the release, and close behind it. A released store drops off its
   rack under the ejector's push, then the battle's own guided round takes it
   down (src/battle/vehicles.js vehRelease, fire.js homing).

   THE LOAD (the "only 2 bombs per pass" fix). The real internal loads are 2 x
   GBU-31 or 8 x GBU-39 (+ 2 x AIM-120C in both cases) and 182 rounds of 25 mm.
   The jet's mission load is picked by its first ground mark, the way a
   strike is tasked: armour gets the SDBs (eight precise kills, four per pass
   on separate marks), soft targets get the two 2,000 lb JDAMs (a 30 m kill
   core each, both in one pass). One bomb per mark is in the air at a time
   (a second one waits for the first's impact, or for another mark), except
   that a heavily armoured mark may take two SDBs. When the bombs and the gun
   are spent the jet goes home ("Winchester") and keeps its AMRAAMs for air
   threats. AMRAAMs go at helicopters and aircraft only.

   THE RIG (animate -> tick, on the battle clock): flaperons, stabilators and
   rudders follow the airframe's own roll / pitch / yaw rates; the bays and
   the gun door open and close; the gear retracts; the afterburner lights in
   steep climbs and on the way home; a hit jet trails smoke, a burning one
   flame, a dead one loses a stabilator and its lights and goes down in fire.
   The gun kicks, flashes and smokes; every store leaves its own rail.

   CONTRACT (docs/npcwar/ARCHITECTURE.md): build(ctx), rig.mark(nation,
   ground, side), rig.muzzleWorld(out, shot), rig.fire(shot), rig.canFire(shot)
   (bays / gun door open, one bomb per mark), rig.damage(vs, res),
   def.animate(veh, dt, ctx), def.moves(veh, tgt, ctx) (YOUR weapon for the
   mark), def.tactics. rig.pose({ bay, gun, gear }) stages the doors for a
   studio shot.

   Every geometry and material is built once per page and shared; per jet:
   one group of meshes, one InstancedMesh for the SDBs, two plume materials,
   no allocation per frame.

   Units: metres, m/s, kg, armour in mm RHA equivalent per face.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.unitKit) return;

  const PI = Math.PI, TAU = PI * 2, DEG = PI / 180;
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function wrap(a) { while (a > PI) a -= TAU; while (a < -PI) a += TAU; return a; }

  // ---- the real numbers -----------------------------------------------------
  const DIM = { length: 15.67, span: 10.70, height: 4.38, nozY: 1.86 };
  // the bays: between the keel (|x| 0.12) and the outer bay edge (0.88), ceiling 1.80
  const BAY = { z0: 2.65, z1: -1.55, xi: 0.12, xo: 0.88, y: 1.172, top: 1.80, zc: 0.55 };
  const GUNP = [0.92, 2.29, 2.45];             // the GAU-22/A muzzle port (port side, over the intake)
  const AIM = { x: 0.24, y: 1.56, len: 3.66, r: 0.089 };
  const JDAM = { x: 0.58, y: 1.50, len: 3.88, r: 0.229 };
  const SDB = { y: 1.62, len: 1.80, r: 0.095, pos: [[0.47, 0.95], [0.71, 0.95], [0.47, -0.95], [0.71, -0.95]] };

  /* THE WEAPONS. vehAirWeapon walks this list in order: the AMRAAM fits only
     an aircraft, so a ground mark gets the bomb load, then the gun. The load
     that was not tasked (see the header) is switched off on the hull. */
  const WEAPONS = [
    // AIM-120C AMRAAM: active radar, Mach 4, 22 kg blast-frag; launched from
    // the inboard bay station, fire-and-forget off boresight (±60 deg)
    { id: "aim120c", seat: "pilot", kind: "missile", vs: "air", mount: "fixed", arc: 1.0, rof: 0.5,
      mun: "aim120c", range: 15000, minRange: 800, ammo: 2 },
    // GBU-31(V)1: Mk 84 (429 kg tritonal) + JDAM GPS/INS kit, one per bay;
    // both can go in one pass on two aim points
    { id: "gbu31_jdam", seat: "pilot", kind: "bombs", vs: "any", guided: true, basket: 0.15, rof: 2, salvo: 2, reload: 20,
      mun: "gbu31v1", range: 15000, ammo: 2 },
    // GBU-39 SDB: 113 kg glide bomb, 17 kg AFX-757 penetrating warhead, four
    // abreast-and-tandem on a BRU-61 per bay; four per pass on four marks
    { id: "gbu39_sdb", seat: "pilot", kind: "bombs", vs: "any", guided: true, basket: 0.22, rof: 1.2, salvo: 4, reload: 20,
      mun: "gbu39", range: 15000, ammo: 8 },
    // GAU-22/A 25 mm four-barrel, 3,300 rounds/min, 182 rounds (PGU-32 SAPHEI):
    // gun runs are DIVES (alt, dive, pullOut), about 0.8 s bursts
    { id: "gau22_25mm", seat: "pilot", kind: "autocannon", mount: "fixed", alt: 1500, dive: 0.3, pullOut: 300, rof: 55, burst: 45, pause: 3,
      mun: "pgu32", grav: 9.8, range: 1800, ammo: 182 },
  ];
  const BOMB_IDS = { gbu31_jdam: "jdam", gbu39_sdb: "sdb" };

  // ---- colour ------------------------------------------------------------------
  const PAINT = 0x6a6f74;                    // the F-35's RAM grey (FS 36170-ish), lit by Phong
  const RGB = function (hex) { return [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255]; };
  const C = {
    seam: 0x4a4e52, dark: 0x101214, duct: 0x0b0c0d, nozzle: 0x55575a, nozzleIn: 0x2a2826, bay: 0xb7babd,
    gunmetal: 0x2d2f31, rubber: 0x151618, rim: 0xb5b8bc, strut: 0xc4c7ca, eots: 0x1b1814, das: 0x14171a,
    suit: 0x58604c, helmet: 0x2a2d31, visor: 0x0d0f10, seat: 0x232528,
    jdam: 0x575c3c, jdamTail: 0x8a8e92, yellow: 0xc9a227, sdb: 0x9da1a5, aim: 0xd6d8da, aimBand: 0x8a6a3a,
  };
  function hash(a, b) { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); }
  // the coating's panels: each panel a slightly different grey, sun on top, grime below
  function weather(x, y, z, ny) {
    let k = 1 + 0.05 * Math.max(0, ny) - 0.07 * Math.max(0, -ny);
    k *= 1 + 0.045 * (hash(Math.floor(z / 1.15), Math.floor(Math.abs(x) / 0.85) + (y > 1.95 ? 7 : 0)) - 0.5);
    if (z < -6.0) k *= 0.94;                 // heat-tinted aft end
    return k;
  }

  // =====================================================================
  //  THE TEMPLATE: every geometry built once per page
  // =====================================================================
  let TPL = null;
  function template() {
    if (TPL) return TPL;
    const THREE = window.THREE, K = CBZ.milAir && CBZ.milAir.kit;
    if (!THREE || !K || !K.loft || !K.wing || !K.planAt) return null;
    const xf = K.xf, xm = K.xm, mir = K.mir, box = K.box, rod = K.rod, rnd = K.rnd;

    // ---- nodes: name -> { o (model origin), q (hinge orientation: local +X on the axis) }
    const NODES = Object.create(null);
    const _M = new THREE.Matrix4(), _Q = new THREE.Quaternion(), _V = new THREE.Vector3(), _S = new THREE.Vector3(1, 1, 1);
    function node(name, o, axis) {
      const q = new THREE.Quaternion();
      if (axis) q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(axis[0], axis[1], axis[2]).normalize());
      const inv = new THREE.Matrix4().compose(new THREE.Vector3(o[0], o[1], o[2]), q, new THREE.Vector3(1, 1, 1)).invert();
      NODES[name] = { o: o, q: q, inv: inv };
    }
    node("body", [0, 0, 0]);
    const BK = Object.create(null);
    function colour(g, col) {
      const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv, N = p.count;
      const out = new Float32Array(N * 3);
      const fn = typeof col === "function" ? col : null;
      const paint = !fn && (col == null || typeof col === "object");
      const tint = paint && col && col.paint != null ? col.paint : 1, le = paint && col && col.le;
      const base = paint ? RGB(PAINT) : (fn ? null : RGB(col));
      for (let i = 0; i < N; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i), ny = n ? n.getY(i) : 0;
        let r, gg, b;
        if (fn) { const c = fn(x, y, z, ny); r = c[0]; gg = c[1]; b = c[2]; }
        else {
          let k = paint ? tint * weather(x, y, z, ny) : 1;
          if (le && uv && uv.getX(i) < 0.05) k *= 1.1;      // the leading edges' lighter coating
          r = base[0] * k; gg = base[1] * k; b = base[2] * k;
        }
        out[i * 3] = r; out[i * 3 + 1] = gg; out[i * 3 + 2] = b;
      }
      g.setAttribute("color", new THREE.BufferAttribute(out, 3));
    }
    // a MODEL-space geometry into a node's bucket (vc | glass | lamp | cav)
    function put(nd, g, col, bucket) {
      if (!g) return;
      if (Array.isArray(g)) { for (let i = 0; i < g.length; i++) put(nd, g[i], col, bucket); return; }
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      bucket = bucket || "vc";
      if (bucket !== "glass") colour(g, col);
      xm(g, NODES[nd].inv);
      const b = BK[nd] || (BK[nd] = { vc: [], glass: [], lamp: [], cav: [] });
      b[bucket].push(g);
    }
    function merge(list) {
      if (!list || !list.length) return null;
      let nv = 0, ni = 0;
      for (const g of list) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
      const P = new Float32Array(nv * 3), Nn = new Float32Array(nv * 3), U = new Float32Array(nv * 2);
      const hasC = list.every(function (g) { return !!g.attributes.color; });
      const Cc = hasC ? new Float32Array(nv * 3) : null;
      const I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
      let vo = 0, io = 0;
      for (const g of list) {
        const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
        P.set(p.array, vo * 3);
        if (n) Nn.set(n.array, vo * 3);
        if (u && u.itemSize === 2) U.set(u.array, vo * 2);
        if (Cc) Cc.set(g.attributes.color.array, vo * 3);
        if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i++) I[io + i] = a[i] + vo; io += a.length; }
        else { for (let i = 0; i < p.count; i++) I[io + i] = vo + i; io += p.count; }
        vo += p.count;
        g.dispose();
      }
      const out = new THREE.BufferGeometry();
      out.setAttribute("position", new THREE.BufferAttribute(P, 3));
      out.setAttribute("normal", new THREE.BufferAttribute(Nn, 3));
      out.setAttribute("uv", new THREE.BufferAttribute(U, 2));
      if (Cc) out.setAttribute("color", new THREE.BufferAttribute(Cc, 3));
      out.setIndex(new THREE.BufferAttribute(I, 1));
      out.computeBoundingSphere(); out.computeBoundingBox();
      out._shared = true;
      return out;
    }
    function flat(g) { const f = g.index ? g.toNonIndexed() : g; f.computeVertexNormals(); return f; }
    function at(g, x, y, z, rx, ry, rz) { return xf(g, x, y, z, rx, ry, rz); }
    function cylY(r0, r1, h, seg) { return new THREE.CylinderGeometry(r1, r0, h, seg || 12); }
    /* A GRID SKIN: rows of points (one row per station, same count), smooth
       normals inside the grid, wound so its faces look away from the axis
       (0, 1.86, z): a fuselage strip, a cap, a seam. */
    function grid(rows, closed) {
      const m = rows[0].length, pos = [], uv = [], idx = [];
      for (let i = 0; i < rows.length; i++) for (let j = 0; j < m; j++) {
        const p = rows[i][j]; pos.push(p[0], p[1], p[2]); uv.push(j / Math.max(1, m - 1), i / Math.max(1, rows.length - 1));
      }
      const jm = closed ? m : m - 1;
      for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < jm; j++) {
        const a = i * m + j, b = i * m + (j + 1) % m, c = a + m, d = b + m;
        idx.push(a, c, b, b, c, d);
      }
      // orientation: the middle triangle against the outward direction
      const ti = (Math.floor((rows.length - 1) / 2) * jm + Math.floor(jm / 2)) * 6;
      const A = idx[ti] * 3, B = idx[ti + 1] * 3, Cq = idx[ti + 2] * 3;
      const ux = pos[B] - pos[A], uy = pos[B + 1] - pos[A + 1], uz = pos[B + 2] - pos[A + 2];
      const vx = pos[Cq] - pos[A], vy = pos[Cq + 1] - pos[A + 1], vz = pos[Cq + 2] - pos[A + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz;
      const ox = pos[A], oy = pos[A + 1] - DIM.nozY;
      if (nx * ox + ny * oy < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    }

    // both faces (an annulus facing aft has no "outward" from the axis)
    function both(g) {
      const f = g.clone(), ix = f.index.array;
      for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
      f.computeVertexNormals();
      return [g, f];
    }
    // =================================================================
    //  FUSELAGE: the chined forebody, the intake band, the midbody
    //  row = [z, yt (top), xs, ys (shoulder), xc, yc (chine), xl, yl (trunk
    //  bottom corner), xb, yb (belly edge), y0 (keel)]
    // =================================================================
    const FORE = [
      [7.85, 1.93, 0.00, 1.93, 0.00, 1.93, 0.00, 1.93, 0.00, 1.93, 1.93],
      [7.45, 2.04, 0.10, 2.02, 0.20, 1.90, 0.17, 1.80, 0.08, 1.76, 1.75],
      [6.90, 2.17, 0.20, 2.13, 0.38, 1.88, 0.33, 1.66, 0.16, 1.58, 1.56],
      [6.20, 2.30, 0.30, 2.26, 0.53, 1.87, 0.46, 1.53, 0.24, 1.43, 1.41],
      [5.40, 2.40, 0.38, 2.36, 0.64, 1.88, 0.57, 1.42, 0.30, 1.33, 1.31],
      [4.60, 2.44, 0.44, 2.40, 0.72, 1.90, 0.66, 1.36, 0.36, 1.27, 1.25],
    ];
    const MID = [
      [4.15, 2.46, 0.46, 2.42, 1.10, 1.97, 1.04, 1.34, 0.80, 1.23, 1.21],
      [3.20, 2.50, 0.48, 2.45, 1.20, 1.99, 1.12, 1.32, 0.88, 1.20, 1.18],
      [2.00, 2.62, 0.50, 2.52, 1.32, 2.01, 1.18, 1.32, 0.88, 1.19, 1.18],
      [1.00, 2.66, 0.52, 2.52, 1.48, 2.02, 1.20, 1.33, 0.88, 1.19, 1.18],
      [-0.50, 2.62, 0.52, 2.50, 1.46, 2.02, 1.20, 1.35, 0.88, 1.19, 1.18],
      [-2.00, 2.55, 0.52, 2.46, 1.40, 2.02, 1.16, 1.40, 0.85, 1.24, 1.22],
      [-3.50, 2.42, 0.50, 2.38, 1.30, 2.02, 1.08, 1.45, 0.72, 1.30, 1.28],
      [-5.00, 2.36, 0.48, 2.32, 1.15, 2.00, 0.95, 1.46, 0.58, 1.31, 1.29],
      [-6.20, 2.38, 0.46, 2.34, 0.92, 1.95, 0.78, 1.42, 0.45, 1.30, 1.28],
      [-6.85, 2.44, 0.42, 2.38, 0.64, 1.88, 0.56, 1.40, 0.34, 1.30, 1.28],
    ];
    // non-uniform Catmull-Rom over a table, by z
    function sample(T, z) {
      let i = 0;
      while (i < T.length - 2 && z < T[i + 1][0]) i++;
      const a = T[Math.max(0, i - 1)], b = T[i], c = T[i + 1], d = T[Math.min(T.length - 1, i + 2)];
      const t = clamp((b[0] - z) / (b[0] - c[0]), 0, 1);
      const out = new Array(11); out[0] = z;
      const h = b[0] - c[0];
      for (let k = 1; k < 11; k++) {
        const m0 = (a === b ? (c[k] - b[k]) : (c[k] - a[k]) / (a[0] - c[0]) * h);
        const m1 = (d === c ? (c[k] - b[k]) : (d[k] - b[k]) / (b[0] - d[0]) * h);
        const t2 = t * t, t3 = t2 * t;
        out[k] = (2 * t3 - 3 * t2 + 1) * b[k] + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * c[k] + (t3 - t2) * m1;
      }
      return out;
    }
    function upperPts(s, e) {
      e = e || 0;
      const z = s[0], yt = s[1], xs = s[2], ys = s[3], xc = s[4], yc = s[5];
      const R = [[xc + e, yc], [0.5 * (xc + xs) + e * 0.7, 0.5 * (yc + ys) + 0.035 * (xc - xs) + e * 0.7], [xs + e * 0.5, ys + e * 0.8], [xs * 0.5, ys + (yt - ys) * 0.8 + e], [0, yt + e]];
      const out = [];
      for (let j = 0; j < R.length; j++) out.push([R[j][0], R[j][1], z]);
      for (let j = R.length - 2; j >= 0; j--) out.push([-R[j][0], R[j][1], z]);
      return out;
    }
    // lower: the chine down the trunk to the belly; `part` = all | side | rest | mouth
    function lowerSide(s) {
      const xc = s[4], yc = s[5], xl = s[6], yl = s[7], xb = s[8], yb = s[9];
      return [[xc, yc], [xl, yl], [0.5 * (xl + xb) + 0.03, 0.5 * (yl + yb) - 0.025], [xb, yb]];
    }
    function lowerPts(s, part) {
      const z = s[0], y0 = s[10], xb = s[8];
      const S = lowerSide(s), out = [];
      const belly = [[xb * 0.5, y0 + 0.005], [0, y0]];
      let R;
      if (part === "mouth") R = S.slice(0, 2);
      else if (part === "rest") R = S.slice(1).concat(belly);
      else R = S.concat(belly);
      for (let j = 0; j < R.length; j++) out.push([R[j][0], R[j][1], z]);
      const half = part === "mouth" ? 0 : 1;      // mouth: one side only (mirrored by the caller)
      if (!half) return out;
      for (let j = R.length - 2; j >= 0; j--) out.push([-R[j][0], R[j][1], z]);
      return out;
    }
    const FZ = [7.85, 7.72, 7.55, 7.35, 7.1, 6.8, 6.5, 6.2, 5.9, 5.6, 5.3, 5.0, 4.8, 4.6];
    const MZ = [4.15, 3.85, 3.5, 3.15, 2.85, BAY.z0, 2.3, 1.95, 1.6, 1.25, 0.9, 0.55, 0.2, -0.15, -0.5, -0.85, -1.2, BAY.z1,
      -1.9, -2.3, -2.7, -3.1, -3.5, -3.9, -4.3, -4.7, -5.1, -5.5, -5.9, -6.25, -6.55, -6.85];
    const FS = FZ.map(function (z) { return sample(FORE, z); }), MS = MZ.map(function (z) { return sample(MID, z); });
    const ALL = FS.concat(MS);
    function stationAt(z) { return z >= 4.6 ? sample(FORE, z) : z <= 4.15 ? sample(MID, z) : null; }
    // the upper skin, nose to tail, in one piece (the intake lip widens it at 4.6 -> 4.15)
    put("body", grid(ALL.map(function (s) { return upperPts(s); })), { paint: 1 });
    // the lower skin: forebody, the intake band, the midbody round the bays
    put("body", grid(FS.map(function (s) { return lowerPts(s, "all"); })), { paint: 1 });
    put("body", grid([lowerPts(FS[FS.length - 1], "rest"), lowerPts(MS[0], "rest")]), { paint: 1 });
    {
      // THE INTAKE MOUTHS: the swept band between the forebody side (the DSI
      // wall) and the outer lip, dark down the duct; the DSI bump inside
      const m = grid([lowerPts(FS[FS.length - 1], "mouth"), lowerPts(MS[0], "mouth")]);
      put("body", [m, mir(m)], C.duct);
      [-1, 1].forEach(function (s) {
        const S0 = FS[FS.length - 1], S1 = MS[0];
        put("body", at(new THREE.SphereGeometry(1, 14, 10).scale(0.11, 0.22, 0.36), s * 0.66, 1.62, 4.42), { paint: 1 });
        const L = lowerSide(S1);
        put("body", [rod([s * S1[4], S1[5], S1[0]], [s * L[1][0], L[1][1], S1[0]], 0.022, 6)], { paint: 0.9 });
        put("body", [rod([s * S0[4], S0[5] - 0.01, S0[0]], [s * S1[4], S1[5] - 0.01, S1[0]], 0.016, 5)], { paint: 0.95 });
      });
    }
    {
      // midbody belly: ahead of the bays, the bays' sides + keel, behind the bays
      const i0 = MZ.indexOf(BAY.z0), i1 = MZ.indexOf(BAY.z1);
      put("body", grid(MS.slice(0, i0 + 1).map(function (s) { return lowerPts(s, "all"); })), { paint: 1 });
      put("body", grid(MS.slice(i1).map(function (s) { return lowerPts(s, "all"); })), { paint: 1 });
      const bays = MS.slice(i0, i1 + 1);
      const side = grid(bays.map(function (s) { const L = lowerSide(s); return L.map(function (p) { return [p[0], p[1], s[0]]; }); }));
      put("body", [side, mir(side)], { paint: 1 });
      put("body", grid(bays.map(function (s) { return [[BAY.xi, s[10] + 0.003, s[0]], [0, s[10], s[0]], [-BAY.xi, s[10] + 0.003, s[0]]]; })), { paint: 1 });
      // the bays: light-grey cavities seen from inside (BackSide), with the
      // fore and aft bulkheads; doors cover them in flight
      [-1, 1].forEach(function (s) {
        const w = BAY.xo - BAY.xi, h = BAY.top - BAY.y + 0.02, L = BAY.z0 - BAY.z1;
        put("body", at(box(w, h, L), s * (BAY.xi + w / 2), BAY.y - 0.02 + h / 2, (BAY.z0 + BAY.z1) / 2), function (x, y) { return RGB(y > BAY.top - 0.05 ? 0x9a9da0 : C.bay); }, "cav");
        // the racks on the ceiling (heavy station and AMRAAM station)
        put("body", [at(box(0.10, 0.10, 2.4), s * JDAM.x, BAY.top - 0.06, BAY.zc), at(box(0.06, 0.08, 1.6), s * AIM.x, BAY.top - 0.05, BAY.zc)], C.seam);
      });
    }
    // the aft cap: the fuselage's last section closed onto the nozzle can
    {
      const S = MS[MS.length - 1];
      const ring = upperPts(S).concat(lowerPts(S, "all").slice(1, -1).reverse());
      const inner = ring.map(function (p) {
        const a = Math.atan2(p[1] - DIM.nozY, p[0]);
        return [Math.cos(a) * 0.58, DIM.nozY + Math.sin(a) * 0.58, S[0] - 0.01];
      });
      put("body", both(grid([ring, inner], true)), { paint: 0.85 });
    }
    // the panel seams: thin dark bands proud of the skin at the joints
    [5.25, 3.0, 1.45, -0.6, -2.75, -4.5, -6.0].forEach(function (z) {
      const s0 = stationAt(z + 0.012), s1 = stationAt(z - 0.012);
      if (!s0 || !s1) return;
      put("body", grid([upperPts(s0, 0.006), upperPts(s1, 0.006)]), C.seam);
    });
    // the radome joint: a sawtooth seam across the top of the nose
    {
      const s = stationAt(5.9), up = upperPts(s, 0.006), parts = [];
      for (let j = 0; j < up.length - 1; j++) {
        const a = up[j], b = up[j + 1];
        const mz = 5.9 + ((j & 1) ? 0.12 : -0.12);
        parts.push(rod([a[0], a[1], 5.9], [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.004, mz], 0.007, 4), rod([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.004, mz], [b[0], b[1], 5.9], 0.007, 4));
      }
      put("body", parts, C.seam);
    }

    // =================================================================
    //  COCKPIT: one-piece canopy (gold ITO tint), its frame, the pilot
    // =================================================================
    const CAN = [[5.15, 0.28, 0.03], [4.75, 0.41, 0.27], [4.15, 0.47, 0.48], [3.45, 0.48, 0.60], [2.75, 0.46, 0.55], [2.15, 0.40, 0.38], [1.75, 0.26, 0.17], [1.48, 0.05, 0.02]];
    function canY(z) { return 2.34 + (5.15 - z) * 0.012; }
    put("body", K.loft(CAN.map(function (c) { return { z: c[0], y: canY(c[0]), w: c[1], t: c[2], b: 0.06, p: 2.25 }; }), { n: 26 }), null, "glass");
    {
      const fr = [];
      // the sill both sides, and the bow between windscreen and canopy
      [-1, 1].forEach(function (s) {
        for (let i = 0; i < CAN.length - 1; i++) {
          const a = CAN[i], b = CAN[i + 1];
          fr.push(rod([s * a[1] * 0.98, canY(a[0]) + 0.01, a[0]], [s * b[1] * 0.98, canY(b[0]) + 0.01, b[0]], 0.028, 5));
        }
      });
      [4.18, 1.70].forEach(function (z) {
        let w = 0.47, t = 0.48;
        for (let i = 0; i < CAN.length - 1; i++) if (z <= CAN[i][0] && z >= CAN[i + 1][0]) { const k = (CAN[i][0] - z) / (CAN[i][0] - CAN[i + 1][0]); w = CAN[i][1] + (CAN[i + 1][1] - CAN[i][1]) * k; t = CAN[i][2] + (CAN[i + 1][2] - CAN[i][2]) * k; }
        const y = canY(z), P = [];
        for (let k = 0; k <= 10; k++) {
          const th = PI * k / 10, c = Math.cos(th), sn = Math.sin(th);
          P.push([(w + 0.012) * Math.sign(c) * Math.pow(Math.abs(c), 2 / 2.25), y + (t + 0.012) * Math.pow(sn, 2 / 2.25), z]);
        }
        for (let k = 0; k < P.length - 1; k++) fr.push(rod(P[k], P[k + 1], z > 4 ? 0.035 : 0.025, 5));
      });
      put("body", fr, { paint: 0.82 });
    }
    // the cockpit inside: coaming, panel (one big touchscreen), the US16E seat, the pilot in a Gen III HMDS helmet
    put("body", [at(box(0.70, 0.14, 0.45), 0, 2.36, 4.55), at(box(0.62, 0.30, 0.06), 0, 2.30, 4.33, 0.35)], C.dark);
    put("body", at(box(0.52, 0.17, 0.03), 0, 2.33, 4.30, 0.35), 0x203040, "lamp");
    put("body", [at(box(0.54, 0.12, 0.56), 0, 2.02, 3.40), at(box(0.54, 0.80, 0.15), 0, 2.42, 3.02, -0.22), at(box(0.40, 0.22, 0.18), 0, 2.76, 2.92, -0.22),
      at(box(0.06, 0.36, 0.5), 0.29, 2.20, 3.30), at(box(0.06, 0.36, 0.5), -0.29, 2.20, 3.30)], C.seat);
    put("body", [at(box(0.40, 0.52, 0.26), 0, 2.38, 3.20, -0.18), rod([0.13, 2.10, 3.30], [0.12, 1.95, 3.85], 0.07, 6), rod([-0.13, 2.10, 3.30], [-0.12, 1.95, 3.85], 0.07, 6),
      rod([0.22, 2.56, 3.20], [0.18, 2.25, 3.62], 0.05, 6), rod([-0.22, 2.56, 3.20], [-0.18, 2.25, 3.62], 0.05, 6)], C.suit);
    put("body", at(new THREE.SphereGeometry(0.15, 14, 10), 0, 2.74, 3.27), C.helmet);
    put("body", [at(box(0.24, 0.09, 0.06), 0, 2.72, 3.41), at(box(0.06, 0.05, 0.12), 0, 2.88, 3.30)], C.visor);

    // =================================================================
    //  SENSORS + FITTINGS: EOTS, DAS, the boom receptacle, antennas, gun
    // =================================================================
    put("body", flat(at(cylY(0.17, 0.10, 0.13, 7), 0, 1.36, 6.05)), C.eots);
    [[0, 2.69, 1.10, 0, 0], [0, 1.30, 5.20, PI, 0], [0.57, 1.98, 5.55, 0, -PI / 2 + 0.25], [-0.57, 1.98, 5.55, 0, PI / 2 - 0.25], [0.95, 2.08, -5.6, 0, -PI / 2 + 0.6], [-0.95, 2.08, -5.6, 0, PI / 2 - 0.6]].forEach(function (d) {
      put("body", at(new THREE.CylinderGeometry(0.065, 0.065, 0.014, 6), d[0], d[1], d[2], d[3], 0, d[4]), C.das);
    });
    {
      // the boom receptacle door on the spine (an outline and the slipway slot)
      const y = 2.668, z0 = 0.35, z1 = -0.25;
      put("body", [rod([0.17, y, z0], [0.17, y, z1], 0.008, 4), rod([-0.17, y, z0], [-0.17, y, z1], 0.008, 4), rod([0.17, y, z0], [-0.17, y, z0], 0.008, 4), rod([0.17, y, z1], [-0.17, y, z1], 0.008, 4)], C.seam);
      put("body", at(box(0.08, 0.01, 0.42), 0, y + 0.002, 0.08), C.dark);
    }
    put("body", [at(box(0.02, 0.16, 0.24), 0, 2.70, -1.2, 0, 0, 0), at(box(0.02, 0.12, 0.20), 0, 2.48, -3.4), at(box(0.02, 0.14, 0.22), 0, 1.10, 3.5), at(box(0.02, 0.12, 0.18), 0, 1.22, -3.0)], { paint: 0.8 });
    // GAU-22/A: the fairing over the port intake, the muzzle port
    put("body", K.loft([{ z: 2.44, x: GUNP[0], y: 2.25, w: 0.07, t: 0.05, b: 0.03 }, { z: 2.36, x: GUNP[0], y: 2.25, w: 0.12, t: 0.10, b: 0.04 },
      { z: 1.2, x: GUNP[0], y: 2.27, w: 0.13, t: 0.10, b: 0.05 }, { z: -0.2, x: GUNP[0], y: 2.30, w: 0.10, t: 0.07, b: 0.05 }, { z: -0.8, x: GUNP[0], y: 2.31, w: 0.02, t: 0.02, b: 0.02 }], { n: 12 }), { paint: 0.98 });
    put("body", at(new THREE.CircleGeometry(0.05, 10), GUNP[0], GUNP[1], 2.445), C.dark);

    // =================================================================
    //  WINGS, STABILATORS, FINS (+ hinged flaperons, rudders)
    // =================================================================
    const WK = [{ x: 1.0, le: 1.04, te: -4.33, tc: 0.05, y: 2.00 }, { x: 5.35, le: -1.90, te: -3.25, tc: 0.04, y: 2.02 }];
    const FC = 0.58, F0 = 1.88, F1 = 4.57;
    {
      const P = function (x, cut) { return K.planAt(WK, x, cut); };
      const wg = K.wing([P(1.0), P(F0), P(F0, FC), P(F1, FC), P(F1), P(5.35)], { K: 8 });
      put("body", [wg, mir(wg)], { paint: 1, le: true });
      [-1, 1].forEach(function (s) {
        const a = P(F0 + 0.03, FC), b = P(F1 - 0.03, FC);
        const ha = [s * a.x, a.y, a.le - a.c], hb = [s * b.x, b.y, b.le - b.c];
        node(s > 0 ? "flapL" : "flapR", ha, [hb[0] - ha[0], hb[1] - ha[1], hb[2] - ha[2]]);
        let fg = K.wing([{ x: a.x, le: a.le - a.c - 0.01, c: FC, tc: 0.07, y: a.y }, { x: b.x, le: b.le - b.c - 0.01, c: FC * 0.95, tc: 0.07, y: b.y }], { K: 4 });
        if (s < 0) fg = mir(fg);
        put(s > 0 ? "flapL" : "flapR", fg, { paint: 0.96 });
        // wingtip nav lights: red port, green starboard
        put("body", at(new THREE.SphereGeometry(0.04, 8, 6), s * 5.34, 2.03, -2.4), s > 0 ? 0xff3b30 : 0x30d070, "lamp");
      });
    }
    [-1, 1].forEach(function (s) {
      const nm = s > 0 ? "stabL" : "stabR";
      node(nm, [s * 1.0, 1.95, -6.0], [s, 0, 0]);
      let sg = K.wing([{ x: 0.85, le: -4.75, c: 2.5, tc: 0.045, y: 1.95 }, { x: 3.35, le: -6.55, c: 0.85, tc: 0.04, y: 1.92 }], { K: 6 });
      if (s < 0) sg = mir(sg);
      put(nm, sg, { paint: 1, le: true });
    });
    const CANT = 20 * DEG, FIN_X = 0.80, FIN_Y = 2.18;
    const FK = [{ x: 0, le: -3.70, te: -6.45, tc: 0.05 }, { x: 2.35, le: -5.55, te: -6.60, tc: 0.045 }];
    const RC = 0.45, R0 = 0.30, R1 = 1.95;
    function finM(s) {
      return new THREE.Matrix4().compose(new THREE.Vector3(s * FIN_X, FIN_Y, 0),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, s > 0 ? PI / 2 - CANT : PI / 2 + CANT)), new THREE.Vector3(1, 1, 1));
    }
    const FINM = [finM(-1), finM(1)];
    [-1, 1].forEach(function (s) {
      const M = FINM[s > 0 ? 1 : 0], P = function (x, cut) { return K.planAt(FK, x, cut); };
      put("body", xm(K.wing([P(0), P(R0), P(R0, RC), P(R1, RC), P(R1), P(2.35)], { K: 6 }), M), { paint: 1, le: true });
      const a = P(R0 + 0.03, RC), b = P(R1 - 0.03, RC);
      const pa = new THREE.Vector3(a.x, 0, a.le - a.c).applyMatrix4(M), pb = new THREE.Vector3(b.x, 0, b.le - b.c).applyMatrix4(M);
      const nm = s > 0 ? "rudL" : "rudR";
      node(nm, [pa.x, pa.y, pa.z], [pb.x - pa.x, pb.y - pa.y, pb.z - pa.z]);
      put(nm, xm(K.wing([{ x: a.x, le: a.le - a.c - 0.01, c: RC, tc: 0.07 }, { x: b.x, le: b.le - b.c - 0.01, c: RC * 0.9, tc: 0.07 }], { K: 4 }), M), { paint: 0.96 });
      // the fin-tip light
      put("body", at(new THREE.SphereGeometry(0.035, 8, 6), 0, 0, 0).applyMatrix4(new THREE.Matrix4().makeTranslation(2.33, 0, -6.1)).applyMatrix4(M), 0xf2f4ff, "lamp");
    });

    // =================================================================
    //  NOZZLE: the F135's low-observable can, 15 serrated petals
    // =================================================================
    {
      const N = 30, rows = [[], [], []], inner = [[], []];
      for (let k = 0; k < N; k++) {
        const a = k / N * TAU, c = Math.cos(a), sn = Math.sin(a), tooth = (k & 1) ? 1 : 0;
        rows[0].push([c * 0.585, DIM.nozY + sn * 0.585, -6.84]);
        rows[1].push([c * 0.56, DIM.nozY + sn * 0.56, -7.30]);
        const r2 = 0.505 - tooth * 0.02;
        rows[2].push([c * r2, DIM.nozY + sn * r2, -7.70 - tooth * 0.17]);
        inner[0].push([c * 0.49, DIM.nozY + sn * 0.49, -7.72]);
        inner[1].push([c * 0.40, DIM.nozY + sn * 0.40, -7.25]);
      }
      put("body", grid(rows, true), C.nozzle);
      put("body", both(grid([rows[2], inner[0]], true)), C.nozzle);
      const inn = grid(inner, true);
      const ix = inn.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
      inn.computeVertexNormals();
      put("body", inn, C.nozzleIn);
    }

    // =================================================================
    //  BAY DOORS (sawtooth ends), GUN DOOR, GEAR
    // =================================================================
    function sawDoor(w, z0, z1) {
      // a plate from x 0..w (hinge at 0), from z0 (front) to z1 (back), sawtooth ends
      const sh = new THREE.Shape(), T = 3, d = 0.13;
      sh.moveTo(0, z0);
      for (let i = 0; i < T; i++) { sh.lineTo(w * (i + 0.5) / T, z0 - d); sh.lineTo(w * (i + 1) / T, z0); }
      sh.lineTo(w, z1);
      for (let i = T - 1; i >= 0; i--) { sh.lineTo(w * (i + 0.5) / T, z1 + d); sh.lineTo(w * i / T, z1); }
      sh.lineTo(0, z0);
      const g = new THREE.ExtrudeGeometry(sh, { depth: 0.022, bevelEnabled: false });
      g.rotateX(PI / 2);               // shape y -> z, extrusion -> down
      return flat(g);
    }
    const DOOR = { iw: 0.25, z0: BAY.z0 + 0.06, z1: BAY.z1 - 0.06 };
    DOOR.ow = BAY.xo - BAY.xi - DOOR.iw;
    [-1, 1].forEach(function (s) {
      const sfx = s > 0 ? "L" : "R";
      node("dIn" + sfx, [s * BAY.xi, BAY.y, 0]);
      node("dOut" + sfx, [s * BAY.xo, BAY.y, 0]);
      let gi = sawDoor(DOOR.iw, DOOR.z0, DOOR.z1), go = sawDoor(DOOR.ow, DOOR.z0, DOOR.z1);
      // inboard plate runs outboard from the keel hinge, the outboard one inboard from its hinge
      xf(go, -DOOR.ow, 0, 0);
      if (s < 0) { gi = mir(gi); go = mir(go); }
      // translate into model space for put()
      xf(gi, s * BAY.xi, BAY.y, 0); xf(go, s * BAY.xo, BAY.y, 0);
      const dcol = function (x, y, z, ny) { return ny > 0.5 ? RGB(C.bay) : RGB(Math.round(PAINT)).map(function (v) { return v * (0.97 + 0.03 * hash(Math.floor(z), 3)); }); };
      put("dIn" + sfx, gi, dcol); put("dOut" + sfx, go, dcol);
    });
    node("gunDoor", [GUNP[0], GUNP[1] + 0.06, 2.452], [1, 0, 0]);
    put("gunDoor", at(box(0.13, 0.12, 0.012), GUNP[0], GUNP[1], 2.452), { paint: 0.95 });
    node("gear", [0, 1.30, 0]);
    {
      const nw = K.wheel(0.29, 0.17), mw = K.wheel(0.38, 0.25);
      put("gear", [rod([0, 1.30, 5.0], [0, 0.29, 5.08], 0.055, 8), rod([0, 1.22, 4.55], [0, 0.62, 5.04], 0.032, 6), rod([0.09, 0.42, 5.08], [-0.09, 0.42, 5.08], 0.03, 6)], C.strut);
      put("gear", at(nw.tire, 0, 0.29, 5.08), C.rubber); put("gear", at(nw.hub, 0, 0.29, 5.08), C.rim);
      put("gear", [at(box(0.02, 0.42, 1.05), 0.19, 1.02, 4.95), at(box(0.02, 0.42, 1.05), -0.19, 1.02, 4.95)], { paint: 0.95 });
      [-1, 1].forEach(function (s) {
        put("gear", [rod([s * 1.16, 1.34, -0.95], [s * 1.58, 0.38, -1.05], 0.08, 8), rod([s * 0.96, 1.30, -1.55], [s * 1.46, 0.78, -1.05], 0.045, 6),
          rod([s * 1.50, 0.60, -1.05], [s * 1.70, 0.38, -1.05], 0.06, 6)], C.strut);
        put("gear", at(mw.tire.clone(), s * 1.62, 0.38, -1.05), C.rubber); put("gear", at(mw.hub.clone(), s * 1.62, 0.38, -1.05), C.rim);
        put("gear", at(box(0.025, 0.62, 1.30), s * 1.24, 0.98, -1.05, 0, 0, s * 0.12), { paint: 0.95 });
      });
    }

    // ---- bake the buckets ----------------------------------------------------------
    const G = Object.create(null);
    for (const k in BK) G[k] = { vc: merge(BK[k].vc), glass: merge(BK[k].glass), lamp: merge(BK[k].lamp), cav: merge(BK[k].cav) };

    // =================================================================
    //  STORES (store space: nose +Z, centred)
    // =================================================================
    function store(parts, fn) {
      parts.forEach(function (p) { if (!p.attributes.normal) p.computeVertexNormals(); if (!p.attributes.uv) p.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(p.attributes.position.count * 2), 2)); colour(p, fn); });
      return merge(parts);
    }
    {
      // GBU-31(V)1: Mk 84 body, JDAM strakes, the tail kit's X fins, a yellow HE band
      const h = JDAM.len / 2, r = JDAM.r;
      const parts = [K.loft([rnd(h, 0.025), rnd(h - 0.12, 0.10), rnd(h - 0.45, 0.19), rnd(h - 0.95, r), rnd(-h + 0.85, r), rnd(-h + 0.35, 0.19), rnd(-h, 0.14)], { n: 14 })];
      [-1, 1].forEach(function (s) { parts.push(at(box(0.035, 0.012, 1.1), s * (r + 0.01), 0, 0.15)); });
      for (let k = 0; k < 4; k++) parts.push(xf(K.wing([{ x: 0.12, le: -h + 0.62, c: 0.55, tc: 0.05 }, { x: 0.40, le: -h + 0.40, c: 0.36, tc: 0.05 }], { K: 3 }), 0, 0, 0, 0, 0, k * PI / 2 + PI / 4));
      G.jdam = store(parts, function (x, y, z) { return RGB(z < -h + 0.85 ? C.jdamTail : (z > h - 0.62 && z < h - 0.52 ? C.yellow : C.jdam)); });
    }
    {
      // GBU-39: the square-section glide bomb, its folded Diamondback wing on top
      const h = SDB.len / 2, r = SDB.r;
      const parts = [K.loft([rnd(h, 0.02, 0, 0, { p: 3 }), rnd(h - 0.18, 0.065, 0, 0, { p: 3.5 }), rnd(h - 0.4, r, 0, 0, { p: 4 }), rnd(-h + 0.15, r, 0, 0, { p: 4 }), rnd(-h, 0.07, 0, 0, { p: 4 })], { n: 16 })];
      parts.push(at(box(0.15, 0.018, 1.05), 0, r + 0.01, 0.05));
      for (let k = 0; k < 4; k++) parts.push(xf(K.wing([{ x: 0.07, le: -h + 0.24, c: 0.22, tc: 0.05 }, { x: 0.17, le: -h + 0.15, c: 0.13, tc: 0.05 }], { K: 3 }), 0, 0, 0, 0, 0, k * PI / 2 + PI / 4));
      G.sdb = store(parts, function (x, y, z) { return RGB(z > h - 0.5 && z < h - 0.44 ? C.yellow : C.sdb); });
    }
    {
      const parts = K.missile(AIM.len, AIM.r);
      G.aim = store(parts, function (x, y, z) { return RGB(z > AIM.len / 2 - 0.42 ? 0xbfc2c4 : (z > 0.55 && z < 0.62 ? C.aimBand : C.aim)); });
    }
    // the afterburner: an outer envelope, a hot core, four shock diamonds (aft = -Z)
    {
      const o = new THREE.ConeGeometry(0.5, 1, 16, 1, true); o.translate(0, 0.5, 0); o.rotateX(-PI / 2);
      const c = new THREE.ConeGeometry(0.28, 0.62, 12, 1, true); c.translate(0, 0.31, 0); c.rotateX(-PI / 2);
      const d = new THREE.SphereGeometry(0.16, 8, 6); d.scale(1, 1, 2.2);
      G.abOuter = o; G.abCore = c; G.abDia = d; o._shared = c._shared = d._shared = true;
      G.glow = new THREE.CircleGeometry(0.40, 20); G.glow.rotateY(PI); G.glow._shared = true;
    }
    // the fin flags: a quad on the outer face of each fin (hoist forward)
    G.flag = [];
    [-1, 1].forEach(function (s) {
      const M = FINM[s > 0 ? 1 : 0], y = s > 0 ? -0.052 : 0.052;
      const P = [[0.95, y, -5.0], [0.95, y, -5.85], [1.48, y, -5.85], [1.48, y, -5.0]].map(function (p) { return new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(M); });
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute([P[0].x, P[0].y, P[0].z, P[1].x, P[1].y, P[1].z, P[2].x, P[2].y, P[2].z, P[3].x, P[3].y, P[3].z], 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
      g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals(); g._shared = true;
      G.flag.push(g);
    });

    // ---- materials ----------------------------------------------------------------
    const M = {
      // the RAM coating's satin sheen
      vc: new THREE.MeshPhongMaterial({ color: 0xffffff, vertexColors: true, specular: 0x2b2e31, shininess: 22 }),
      cav: new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, side: THREE.BackSide }),
      glass: new THREE.MeshPhongMaterial({ color: 0x3a3424, specular: 0xd8b860, shininess: 110, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
      lamp: new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true }),
    };
    for (const k in M) M[k]._shared = true;
    TPL = { G: G, M: M, NODES: NODES };
    return TPL;
  }

  // ---- nation flags (low-visibility toned) ---------------------------------------------
  const FLAGM = Object.create(null);
  function flagMat(id, design) {
    if (FLAGM[id] !== undefined) return FLAGM[id];
    const THREE = window.THREE, F = CBZ.flags;
    let m = null;
    try {
      const d = design || (F && F.designFor ? F.designFor(id) : null);
      if (THREE && F && F.paint && d && typeof document !== "undefined") {
        const c = document.createElement("canvas"); c.width = 160; c.height = 100;
        const g = c.getContext && c.getContext("2d");
        if (g) {
          F.paint(g, d, 160, 100, { grain: false });
          const t = new THREE.CanvasTexture(c);
          if (THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding;
          // toned toward the coating, the way a stealth jet wears its insignia
          m = new THREE.MeshLambertMaterial({ map: t, color: 0xb4b6b8, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
          m._shared = true;
        }
      }
    } catch (e) { m = null; }
    return (FLAGM[id] = m);
  }

  // =====================================================================
  //  BUILD: one airframe, sharing every geometry and material
  // =====================================================================
  function build(ctx) {
    const T = template();
    if (!T) return null;
    const THREE = window.THREE, G = T.G, M = T.M;
    const root = new THREE.Group(); root.name = "f35a";
    const body = new THREE.Group(); body.name = "f35a-body"; root.add(body);
    const N = Object.create(null);
    N.body = body;
    for (const k in T.NODES) {
      if (k === "body") continue;
      const d = T.NODES[k];
      const h = new THREE.Group(); h.name = "f35a-" + k + ":hinge";
      h.position.set(d.o[0], d.o[1], d.o[2]); h.quaternion.copy(d.q);
      const n = new THREE.Group(); n.name = "f35a-" + k; h.add(n);
      body.add(h); N[k] = n;
    }
    function mesh(geo, mat, parent, shadow) {
      if (!geo) return null;
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = shadow !== false; m.receiveShadow = shadow !== false;
      parent.add(m); return m;
    }
    const lamps = [];
    for (const k in G) {
      if (!N[k] || !G[k] || !G[k].vc && !G[k].glass) continue;
      mesh(G[k].vc, M.vc, N[k]);
      mesh(G[k].glass, M.glass, N[k], false);
      mesh(G[k].cav, M.cav, N[k], false);
      const lm = mesh(G[k].lamp, M.lamp, N[k], false); if (lm) lamps.push(lm);
    }
    // ---- the stores in the bays ------------------------------------------------------
    const aims = [], jdams = [];
    [1, -1].forEach(function (s) {
      const a = mesh(G.aim, M.vc, body); a.position.set(s * AIM.x, AIM.y, BAY.zc); aims.push(a);
      const j = mesh(G.jdam, M.vc, body); j.position.set(s * JDAM.x, JDAM.y, BAY.zc); jdams.push(j);
    });
    const sdbPos = [];
    [1, -1].forEach(function (s) { for (let i = 0; i < 4; i++) sdbPos.push([s * SDB.pos[i][0], SDB.y, BAY.zc + SDB.pos[i][1]]); });
    // order: alternate bays, front pair first
    const sdbOrder = [0, 4, 1, 5, 2, 6, 3, 7];
    const sdb = new THREE.InstancedMesh(G.sdb, M.vc, 8);
    const _m = new THREE.Matrix4();
    for (let i = 0; i < 8; i++) sdb.setMatrixAt(i, _m.makeTranslation(sdbPos[i][0], sdbPos[i][1], sdbPos[i][2]));
    sdb.frustumCulled = false; sdb.castShadow = false; body.add(sdb);
    // ---- the afterburner and the nozzle throat ------------------------------------------
    const abOuterM = new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const abCoreM = new THREE.MeshBasicMaterial({ color: 0xfff1c8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const glowM = new THREE.MeshBasicMaterial({ color: 0x140c08 });
    const ab = new THREE.Group(); ab.name = "f35a-afterburner"; ab.position.set(0, DIM.nozY, -7.62); body.add(ab);
    mesh(G.abOuter, abOuterM, ab, false); mesh(G.abCore, abCoreM, ab, false);
    const dias = [];
    for (let i = 0; i < 4; i++) { const d = mesh(G.abDia, abCoreM, ab, false); d.position.z = -0.9 - i * 0.75; dias.push(d); }
    ab.visible = false;
    const glow = mesh(G.glow, glowM, body, false); glow.position.set(0, DIM.nozY, -7.24);
    // ---- fin flags ------------------------------------------------------------------------
    const flags = G.flag.map(function (g) { const f = new THREE.Mesh(g, M.vc); f.visible = false; f.castShadow = false; body.add(f); return f; });

    const R = {
      group: root, body: body, nodes: N, lamps: lamps, aims: aims, jdams: jdams, sdb: sdb, sdbPos: sdbPos, sdbOrder: sdbOrder,
      ab: ab, abOuterM: abOuterM, abCoreM: abCoreM, dias: dias, glowM: glowM, flags: flags,
      clock: 0, px: 0, py: 0, pz: 0, h0: 0, r0: 0, p0: 0, vx: 0, vy: 0, vz: 0, seeded: false,
      cr: 0, cp: 0, cy: 0, bay: 0, gunDoor: 0, gearK: 1, abK: 0, rec: 0, bayHold: -1, gunHold: -1,
      nA: 0, nJ: 0, nS: 0, nG: 0, load: null, veh: null, dead: false, broken: false,
      hurt: 0, puffT: 0, fallers: null, flight: [], flightN: 0,
      force: null,
    };
    const rig = {
      turret: null,
      settle: function () { R.seeded = false; tick(R, true, 0, null, null); },
      muzzleWorld: function (out, shot) { return muzzle(R, out, shot); },
      fire: function (shot) { fire(R, shot); },
      canFire: function (shot) { return canFire(R, shot); },
      damage: function (vs, res) {
        if (res && res.pen) R.hurt = Math.max(R.hurt, 1);
        if (vs && vs.burning) R.hurt = 2;
      },
      reload: function () {},                  // stores do not come back in flight
      mark: function (nation, ground, side) {
        const design = side && side.flag || null;
        const id = nation || (side && side.flagId) || null;
        const m = id || design ? flagMat(String(id || "flag"), design) : null;
        for (let i = 0; i < flags.length; i++) { flags[i].material = m || M.vc; flags[i].visible = !!m; }
        return !!m;
      },
      setNation: function (id, design) { return rig.mark(id, null, { flag: design }); },
      // studio: hold the doors / gear where asked ({ bay, gun, gear } 0..1), null = let the flight decide
      pose: function (o) { R.force = o || null; tick(R, true, 0, null, R.veh); },
      state: R,
    };
    R.rig = rig;
    root.userData.rig = rig;
    root.userData.aircraftDims = { family: "F-35A", length: DIM.length, span: DIM.span, height: DIM.height, bodyW: 2.9, bodyL: DIM.length };
    root.userData.crewSeats = [{ job: "Pilot", x: 0, y: 2.14, z: 3.40, yaw: 0, cushionH: 0.42, floorBelow: 0.42 }];
    if (ctx && (ctx.nation || ctx.flag)) rig.mark(ctx.nation || ctx.flagId, ctx.ground, { flag: ctx.flag });
    tick(R, true, 0, null, null);
    return { group: root, rig: rig, footW: DIM.span, footL: DIM.length, height: DIM.height };
  }

  // ---- the weapons' ends -------------------------------------------------------------
  let _w = null, _w2 = null;
  function vec() { return new window.THREE.Vector3(); }
  function worldAt(R, x, y, z, out) {
    if (!_w) { _w = vec(); _w2 = vec(); }
    out = out || _w;
    R.group.updateMatrixWorld(true);
    return R.body.localToWorld(out.set(x, y, z));
  }
  function muzzle(R, out, shot) {
    const wid = shot && shot.wid;
    if (wid === "aim120c") { const s = (R.nA & 1) ? -1 : 1; return worldAt(R, s * AIM.x, AIM.y - 0.2, BAY.zc + AIM.len / 2, out); }
    if (wid === "gbu31_jdam") { const s = (R.nJ & 1) ? -1 : 1; return worldAt(R, s * JDAM.x, JDAM.y - 0.3, BAY.zc, out); }
    if (wid === "gbu39_sdb") { const p = R.sdbPos[R.sdbOrder[Math.min(7, R.nS)]]; return worldAt(R, p[0], p[1] - 0.3, p[2], out); }
    return worldAt(R, GUNP[0], GUNP[1], GUNP[2] + 0.05, out);
  }
  /* a store leaves its rack: the ejector kicks it down (the falling copy),
     the rack is empty; the battle flies the guided round from here on */
  function faller(R, geo, x, y, z, kick, life) {
    const THREE = window.THREE, T = template();
    if (!R.fallers) R.fallers = [];
    let f = null;
    for (let i = 0; i < R.fallers.length; i++) if (R.fallers[i].t <= 0) { f = R.fallers[i]; break; }
    if (!f) {
      if (R.fallers.length >= 4) f = R.fallers[0];
      else { f = { m: new THREE.Mesh(geo, T.M.vc), vx: 0, vy: 0, vz: 0, t: 0 }; f.m.castShadow = true; f.m.matrixAutoUpdate = true; R.fallers.push(f); }
    }
    f.m.geometry = geo;
    const scene = R.group.parent;
    if (!scene) return;
    if (f.m.parent !== scene) scene.add(f.m);
    worldAt(R, x, y, z, f.m.position);
    f.m.quaternion.copy(R.group.quaternion);
    f.vx = R.vx; f.vy = R.vy - kick; f.vz = R.vz; f.t = life;
    f.m.visible = true;
  }
  function fire(R, shot) {
    const wid = shot && shot.wid, T = template();
    if (wid === "gau22_25mm") {
      R.rec = 1; R.gunHold = R.clock + 1.2;
      if ((R.nG++ % 3) === 0 && CBZ.muzzleFlash) { try { CBZ.muzzleFlash(worldAt(R, GUNP[0], GUNP[1], GUNP[2] + 0.1), { scale: 1.6 }); } catch (e) {} }
      if ((R.nG % 5) === 0 && CBZ.munitions && CBZ.munitions.smoke) {
        const p = worldAt(R, GUNP[0], GUNP[1] + 0.05, GUNP[2] - 0.4);
        try { CBZ.munitions.smoke(p.x, p.y, p.z, R.vx * 0.2, 0.5, R.vz * 0.2, 0.4, 2.2, 1.2, 0.35, 0.8, 0.8, 0.78, { drag: 2.5, rise: 0.3 }); } catch (e) {}
      }
      return;
    }
    R.bayHold = R.clock + 2.2;
    if (wid === "aim120c" && R.nA < 2) {
      const i = R.nA++, s = (i & 1) ? -1 : 1;
      R.aims[i & 1].visible = false;
      faller(R, T.G.aim, s * AIM.x, AIM.y - 0.15, BAY.zc, 9, 0.45);
      const p = worldAt(R, s * AIM.x, AIM.y - 1.2, BAY.zc - 1.6);
      try { if (CBZ.muzzleFlash) CBZ.muzzleFlash(p, { scale: 1.8, color: 0xffd6a0, life: 0.1 }); } catch (e) {}
      return;
    }
    let geo = null, x = 0, y = 0, z = 0;
    if (wid === "gbu31_jdam" && R.nJ < 2) {
      const i = R.nJ++, s = (i & 1) ? -1 : 1;
      R.jdams[i & 1].visible = false;
      geo = T.G.jdam; x = s * JDAM.x; y = JDAM.y; z = BAY.zc;
    } else if (wid === "gbu39_sdb" && R.nS < 8) {
      const k = R.sdbOrder[R.nS++], p = R.sdbPos[k];
      if (!fire._zero) fire._zero = new window.THREE.Matrix4().makeScale(0, 0, 0);
      R.sdb.setMatrixAt(k, fire._zero); R.sdb.instanceMatrix.needsUpdate = true;
      geo = T.G.sdb; x = p[0]; y = p[1]; z = p[2];
    }
    if (geo) faller(R, geo, x, y, z, 6, 3.5);
    /* NO BOMB INTO ANOTHER BOMB'S KILL ZONE: remember where each one is
       going (its mark, the mark's place, the warhead's kill radius) and when
       it lands; canFire holds the next one off that ground */
    const t = shot.target;
    if (t && t.pos) {
      const agl = R.agl > 10 ? R.agl : 500, w = shot.w || {};
      const i = R.flightN++ & 7;
      const F = R.flight[i] || (R.flight[i] = { t: null, x: 0, z: 0, r: 0, until: 0 });
      F.t = t; F.x = t.pos.x; F.z = t.pos.z; F.r = ((w.he && w.he.blast) || 10) * 0.55;
      F.until = R.clock + Math.sqrt(2 * agl / 9.81) + 1.5;
    }
  }
  // how many of our bombs in the air are going to this mark, or onto the ground it stands on
  function inFlightOn(R, t) {
    let n = 0;
    for (let i = 0; i < R.flight.length; i++) {
      const F = R.flight[i];
      if (!F || F.until <= R.clock) continue;
      if (F.t === t || Math.hypot(t.pos.x - F.x, t.pos.z - F.z) < F.r) n++;
    }
    return n;
  }
  function canFire(R, shot) {
    const wid = shot && shot.wid;
    if (wid === "gau22_25mm") return R.gunDoor > 0.95;
    if (R.bay < 0.95) return false;
    if (wid === "gbu31_jdam" || wid === "gbu39_sdb") {
      const v = R.veh, t = v && v.tgt;
      if (!t || !t.pos || v.you) return true;
      // a heavily armoured mark may take a second SDB (two hits for one kill)
      const heavy = wid === "gbu39_sdb" && t.vehicle && ((t.def && t.def.stats && t.def.stats.armour || {}).front || 0) >= 300;
      return inFlightOn(R, t) < (heavy ? 2 : 1);
    }
    return true;
  }

  // ---- the mission: the load, the doors, Winchester --------------------------------------
  function ammoOf(veh, id) { for (let k = 0; k < veh.wpn.length; k++) if (veh.wpn[k].w.id === id) return veh.wpn[k].ammo; return 0; }
  function setLoad(R, veh, load) {
    R.load = load;
    for (let k = 0; k < veh.wpn.length; k++) {
      const W = veh.wpn[k], l = BOMB_IDS[W.w.id];
      if (l && l !== load) { W.ammo = 0; W.off = true; }
    }
    for (let i = 0; i < 2; i++) R.jdams[i].visible = load === "jdam";
    R.sdb.visible = load === "sdb";
  }
  function mission(R, veh, ctx) {
    if (!veh || !veh.wpn) return;
    const t = veh.tgt && !veh.tgt.dead ? veh.tgt : null;
    if (!R.load && ((t && !t.air) || veh.you)) setLoad(R, veh, t && t.vehicle ? "sdb" : "jdam");
    if (R.load && !veh.egress && !veh.you) {
      const left = ammoOf(veh, "gbu31_jdam") + ammoOf(veh, "gbu39_sdb") + ammoOf(veh, "gau22_25mm");
      if (left <= 0 && !(t && t.air && ammoOf(veh, "aim120c") > 0)) veh.egress = true;      // Winchester: home
    }
  }
  function wantDoors(R, veh, ctx, out) {
    out.bay = false; out.gun = false;
    if (!veh || !veh.wpn || !ctx || ctx.dead) return out;
    // YOU at the stick: the master arm is on, the bays and the gun are ready for your trigger
    if (veh.you) {
      out.bay = ammoOf(veh, "gbu31_jdam") + ammoOf(veh, "gbu39_sdb") + ammoOf(veh, "aim120c") > 0;
      out.gun = ammoOf(veh, "gau22_25mm") > 0;
      return out;
    }
    const t = ctx.target;
    if (!t || !t.pos) return out;
    const dx = t.pos.x - veh.pos.x, dz = t.pos.z - veh.pos.z, d = Math.hypot(dx, dz);
    const spd = Math.max(80, ctx.speed || 200), inbound = ctx.phase !== "out" && !veh.egress;
    if (t.air) {
      if (ammoOf(veh, "aim120c") > 0) out.bay = (inbound || veh.you) && d < 15000 * 0.85 + spd * 3;
      else out.gun = d < 3000;
    } else {
      const bombs = ammoOf(veh, "gbu31_jdam") + ammoOf(veh, "gbu39_sdb");
      if (bombs > 0) {
        const fall = spd * Math.sqrt(2 * Math.max(10, ctx.agl) / 9.81);
        out.bay = (inbound || veh.you) && d < fall * 1.3 + spd * 3;
      } else out.gun = (inbound || veh.you) && d < 3500;
    }
    return out;
  }
  const _want = { bay: false, gun: false };

  // ---- the rig: every moving part, once per animate (the battle clock) --------------------
  function tick(R, snap, dt, ctx, veh) {
    if (!(dt > 0)) dt = 0;
    if (dt > 0.25) dt = 0.25;
    R.clock += dt;
    const g = R.group, N = R.nodes;
    if (ctx && ctx.dead) R.dead = true;
    const dead = R.dead;
    // motion off the airframe's own transform
    const px = g.position.x, py = g.position.y, pz = g.position.z;
    const h = g.rotation.y, rz = g.rotation.z, rx = g.rotation.x;
    if (!R.seeded || snap) { R.px = px; R.py = py; R.pz = pz; R.h0 = h; R.r0 = rz; R.p0 = rx; R.seeded = true; }
    if (dt > 0) {
      const k = Math.min(1, dt * 5);
      R.vx += ((px - R.px) / dt - R.vx) * k; R.vy += ((py - R.py) / dt - R.vy) * k; R.vz += ((pz - R.pz) / dt - R.vz) * k;
      const kk = Math.min(1, dt * 6);
      R.cr += (clamp((rz - R.r0) / dt * 1.5, -1, 1) - R.cr) * kk;
      R.cp += (clamp(-(rx - R.p0) / dt * 2.0, -1, 1) - R.cp) * kk;
      R.cy += (clamp(wrap(h - R.h0) / dt * 2.0, -1, 1) - R.cy) * kk;
    }
    R.px = px; R.py = py; R.pz = pz; R.h0 = h; R.r0 = rz; R.p0 = rx;
    let agl;
    if (ctx && isFinite(ctx.agl)) agl = ctx.agl;
    else { let gy0 = 0; try { gy0 = CBZ.floorAt ? (+CBZ.floorAt(px, pz) || 0) : 0; } catch (e) { gy0 = 0; } agl = py - gy0; }
    R.agl = agl;
    if (veh) R.veh = veh;
    // ---- the mission and the doors ------------------------------------------------------
    if (veh && !dead) mission(R, veh, ctx);
    const F = R.force;
    wantDoors(R, veh, ctx, _want);
    let bayT = (_want.bay || R.clock < R.bayHold) ? 1 : 0, gunT = (_want.gun || R.clock < R.gunHold) ? 1 : 0;
    let gearT = agl < 8 && !dead ? 1 : 0;
    if (F) { if (F.bay != null) bayT = F.bay; if (F.gun != null) gunT = F.gun; if (F.gear != null) gearT = F.gear; }
    if (dead) { bayT = R.bay; gunT = R.gunDoor; }
    if (snap) { R.bay = bayT; R.gunDoor = gunT; R.gearK = gearT; }
    else {
      R.bay += clamp(bayT - R.bay, -dt / 1.2, dt / 1.0);          // ~1 s to open, 1.2 s to close
      R.gunDoor += clamp(gunT - R.gunDoor, -dt / 0.5, dt / 0.35);
      R.gearK += clamp(gearT - R.gearK, -dt / 1.6, dt / 2.5);
    }
    const eb = R.bay * R.bay * (3 - 2 * R.bay);
    N.dInL.rotation.z = -1.57 * eb; N.dOutL.rotation.z = 1.66 * eb;
    N.dInR.rotation.z = 1.57 * eb; N.dOutR.rotation.z = -1.66 * eb;
    const showStores = R.bay > 0.02;
    for (let i = 0; i < 2; i++) { R.aims[i].visible = showStores && i >= R.nA; R.jdams[i].visible = showStores && R.load !== "sdb" && i >= R.nJ; }
    R.sdb.visible = showStores && R.load !== "jdam" && R.nS < 8;
    N.gunDoor.rotation.x = -1.2 * R.gunDoor;
    N.gear.visible = R.gearK > 0.02;
    N.gear.scale.y = Math.max(0.02, R.gearK);
    // ---- control surfaces ---------------------------------------------------------------
    if (!dead || !R.broken) {
      const ail = -0.35 * R.cr, pit = 0.30 * R.cp, yaw = -0.4 * R.cy;
      N.flapL.rotation.x = ail; N.flapR.rotation.x = ail;
      N.stabL.rotation.x = pit + ail * 0.4; N.stabR.rotation.x = -pit + ail * 0.4;
      N.rudL.rotation.x = yaw; N.rudR.rotation.x = yaw;
    }
    // ---- the engine: the nozzle throat glows with power, afterburner in a climb or going home
    const climbing = ctx && ctx.air && (ctx.gamma > 0.12 || (veh && veh.egress));
    const abT = !dead && climbing ? 1 : 0;
    R.abK += clamp(abT - R.abK, -dt * 1.5, dt * 2.5);
    const thr = dead ? 0 : (ctx && ctx.air ? 0.55 + 0.45 * R.abK : 0.15);
    R.glowM.color.setRGB(0.06 + 0.8 * thr * thr, 0.03 + 0.38 * thr * thr * thr, 0.02 + 0.1 * R.abK);
    R.ab.visible = R.abK > 0.03;
    if (R.ab.visible) {
      const fl = 0.93 + 0.07 * Math.sin(R.clock * 41) + 0.03 * Math.sin(R.clock * 73);
      R.ab.scale.set(1, 1, (2.5 + 4.5 * R.abK) * fl);
      R.abOuterM.opacity = 0.35 * R.abK; R.abCoreM.opacity = 0.75 * R.abK;
      for (let i = 0; i < R.dias.length; i++) R.dias[i].scale.set(1, 1, 1 / Math.max(0.5, R.ab.scale.z) * 2.2);
    }
    // ---- the gun's kick -----------------------------------------------------------------
    R.rec = Math.max(0, R.rec - dt * 12);
    // ---- fallers: stores off their racks --------------------------------------------------
    if (R.fallers && dt > 0) {
      for (let i = 0; i < R.fallers.length; i++) {
        const f = R.fallers[i];
        if (f.t <= 0) continue;
        f.t -= dt;
        if (f.t <= 0) { f.m.visible = false; continue; }
        f.vy -= 9.81 * dt;
        f.m.position.x += f.vx * dt; f.m.position.y += f.vy * dt; f.m.position.z += f.vz * dt;
        _w2.set(f.m.position.x + f.vx, f.m.position.y + f.vy, f.m.position.z + f.vz);
        f.m.lookAt(_w2);
      }
    }
    // ---- damage: smoke from a hit, flame when burning, a wreck's fire ------------------------
    if (dead && !R.broken) {
      R.broken = true;
      for (let i = 0; i < R.lamps.length; i++) R.lamps[i].visible = false;
      N.stabR.parent.visible = false;                 // the starboard stabilator is gone
      N.rudR.rotation.x = 0.5; N.flapL.rotation.x = 0.3; N.flapR.rotation.x = -0.35;
      R.ab.visible = false; R.abK = 0;
      R.hurt = 3;
    }
    if (R.hurt > 0 && dt > 0 && CBZ.munitions && CBZ.munitions.smoke) {
      R.puffT -= dt;
      if (R.puffT <= 0 && (!dead || R.agl > 1 || (ctx && ctx.burning))) {
        R.puffT = R.hurt >= 2 ? 0.07 : 0.12;
        const p = worldAt(R, (Math.random() - 0.5) * 0.6, 2.0, -6.4);
        const dk = R.hurt >= 2 ? 0.16 : 0.42;
        try { CBZ.munitions.smoke(p.x, p.y, p.z, -R.vx * 0.05, 0.6, -R.vz * 0.05, 1.2, R.hurt >= 2 ? 6 : 3.5, R.hurt >= 2 ? 6 : 3, 0.5, dk, dk, dk * 0.96, { drag: 1.5, rise: 0.4 }); } catch (e) {}
        if (R.hurt >= 2 && CBZ.munitions.fire) { try { CBZ.munitions.fire(p.x, p.y, p.z, 0, 0.5, 0, 1.0, 2.6, 0.45, 0.9, 1, 0.55, 0.2); } catch (e) {} }
      }
    }
  }

  // ---- YOU at the stick: the weapon for the mark ---------------------------------------
  function moves(veh, tgt, ctx) {
    if (!veh || !tgt) return null;
    const d = ctx && ctx.dist != null ? ctx.dist : Math.hypot(tgt.pos.x - veh.pos.x, tgt.pos.z - veh.pos.z);
    if (tgt.air) return ammoOf(veh, "aim120c") > 0 && d > 800 ? "aim120c" : "gau22_25mm";
    if (d < 1800 && ammoOf(veh, "gau22_25mm") > 0) return "gau22_25mm";
    if (ammoOf(veh, "gbu39_sdb") > 0) return "gbu39_sdb";
    if (ammoOf(veh, "gbu31_jdam") > 0) return "gbu31_jdam";
    return "gau22_25mm";
  }

  CBZ.unitKit.register("f35", {
    kind: "vehicle",
    domain: "air",
    drive: "jet",
    /* F-35A: 13,290 kg empty, ~22,470 kg with an internal strike load and
       fuel; 250 m/s at the attack (Mach 0.8 at 4.6 km). No armour: the skin
       stops nothing heavier than fragments; rifle fire cannot reach it at
       altitude, a SAM or a 30 mm burst kills it. */
    stats: { hp: 320, mass: 22470, speed: 250, accel: 30, turn: 0.35, alt: 4600, length: DIM.length, width: DIM.span, height: DIM.height,
      armour: { front: 3, side: 2, rear: 2, top: 2 }, standoff: 0 },
    crew: [{ seat: "pilot", pos: [0, 2.55, 3.30] }],
    passengers: 0,
    weapons: WEAPONS,
    build: function (ctx) {
      try { return build(ctx); } catch (e) { if (window.console) console.warn("[f35] build failed:", e); return null; }
    },
    animate: function (veh, dt, ctx) {
      const r = veh && veh.rig;
      if (r && r.state) tick(r.state, false, dt, ctx, veh);
    },
    moves: moves,
    // for the AI layer (src/battle/ai/*): a strike fighter, not a ground unit
    tactics: {
      role: "strike",
      engage: { aim120c: 15000, bombs: 9000, gun: 1800 },
      priorities: ["air", "armour", "launcher", "men"],
      hullDown: false, faceThreat: false, reverseOut: false, screen: false,
      loads: { armour: "8 x GBU-39 SDB", soft: "2 x GBU-31 JDAM", always: "2 x AIM-120C, 182 x 25 mm" },
    },
  });
})();
