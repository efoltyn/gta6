/* ============================================================
   world/armorykit.js — CBZ.armoryKit: KIT ON DISPLAY IS THE KIT PEOPLE WEAR.

   Owner (2026-10-20): "armor on people is very real, but armor in the armor
   room is not very real." The vests on the gun room's wall were a green box
   each with box "straps" (world/gunroom.js, July), while every SWAT man and
   soldier in the game wears entities/combatkit.js's fitted plate carrier and
   entities/headwear.js's real lids. Two drawings of one object, and the
   display one was the toy.

   So the display does not draw armour at all. It builds ONE reference body
   (CBZ.human.build — the same rig every person is), DRESSES it with the real
   kit (CBZ.combatKit.wear / CBZ.headwear.wear), and HARVESTS the worn meshes
   in the body's standing frame (feet at y 0, facing +z). Those geometries are
   then placed, at their true size, on:
     • a MANNEQUIN — the reference body's own torso, collar, pelvis and head
       (no arms, no legs: a dress form) on a chrome pole and a weighted base,
       wearing the carrier and helmet exactly where they sit on a man;
     • a WALL HOOK — the carrier alone, hung by its drag handle off a J-hook,
       back plate to the wall (a carrier is a shell; it holds its shape);
     • a SHELF — a helmet resting on its own lowest point, strap tucked.
   Plus the armory hardware that is not worn: riot shields (24 x 36 in clear
   polycarbonate, curved, rubber edge trim, rear handle + arm pads) in a
   floor rack, M2A1 ammo cans, angle-post steel shelving and a gear-locker
   bank. Everything real-dimension (see the reference rows by each builder).

   COST. Nothing here is live: every piece goes into a Bin, and a Bin merges
   by material at flush() — the whole armory display is a handful of static
   meshes (carrier kit, mannequin cloth, each helmet role, the vertex-colour
   steel, the clear polycarbonate), and core/batch.js may fold the opaque
   ones further. The reference rig is built once, never added to a scene.

   API (CBZ.armoryKit)
     bin()                                  a merge bin: .flush(parent)
     mannequin(bin, x, z, yaw, spec)        spec {loadout, nation, helmet:{kind,variant,color}}
     hungCarrier(bin, x, y, z, yaw, spec)   hook point on the wall face, carrier faces yaw
     helmet(bin, x, y, z, yaw, hspec)       resting on a surface whose top is y
     riotShield(bin, x, y, z, yaw)          bottom edge at y, convex face toward yaw
     shieldRack(bin, x, z, yaw, n)          a floor rack holding n shields; returns footprint
     ammoCan(bin, x, y, z, yaw, o)          an M2A1 can on a surface at y
     shelving(bin, x, z, yaw, o)            angle-post steel shelving; returns shelf tops
     lockers(bin, x, z, yaw, n)             a bank of n gear lockers, back to the wall
     vc(bin, geo, color, m4)                add any geometry in a flat colour
     yawM(x, y, z, yaw)                     a placement matrix
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ, THREE = window.THREE;
  if (!CBZ || !THREE) return;

  const M4 = () => new THREE.Matrix4();
  function yawM(x, y, z, yaw) {
    const m = new THREE.Matrix4().makeRotationY(yaw || 0);
    m.setPosition(x || 0, y || 0, z || 0);
    return m;
  }
  const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);

  // ---- the merge bin -------------------------------------------------------
  let VC = null;
  function vcMat() {
    if (!VC) { VC = new THREE.MeshLambertMaterial({ vertexColors: true }); VC.name = "armory-vc"; VC._shared = true; }
    return VC;
  }
  let PC = null;
  function polyMat() {
    if (!PC) {
      PC = new THREE.MeshPhongMaterial({ color: 0xd8e4ea, specular: 0xffffff, shininess: 90, transparent: true,
        opacity: 0.26, depthWrite: false, side: THREE.DoubleSide });
      PC.name = "armory-polycarbonate"; PC._shared = true;
    }
    return PC;
  }
  function clean(geo, keepColor) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) {
      if (k === "position" || k === "normal" || (keepColor && k === "color")) continue;
      g.deleteAttribute(k);
    }
    g.morphAttributes = {};
    if (!g.attributes.normal) g.computeVertexNormals();
    return g;
  }
  function Bin() { this.sets = new Map(); }
  Bin.prototype.add = function (geo, mat, m4, o) {
    if (!geo || !mat) return this;
    const vcol = !!mat.vertexColors;
    const g = clean(geo, vcol);
    if (vcol && !g.attributes.color) return this;
    if (m4) g.applyMatrix4(m4);
    let s = this.sets.get(mat);
    if (!s) { s = { mat: mat, geos: [], cast: false }; this.sets.set(mat, s); }
    if (o && o.cast) s.cast = true;
    s.geos.push(g);
    return this;
  };
  Bin.prototype.flush = function (parent) {
    const BGU = THREE.BufferGeometryUtils, out = [];
    this.sets.forEach(function (s) {
      if (!s.geos.length) return;
      const geo = s.geos.length === 1 ? s.geos[0] : (BGU && BGU.mergeBufferGeometries ? BGU.mergeBufferGeometries(s.geos, false) : null);
      if (!geo) return;
      if (s.geos.length > 1) for (const q of s.geos) q.dispose();
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, s.mat);
      m.castShadow = s.cast && !s.mat.transparent;
      m.receiveShadow = !s.mat.transparent;
      if (s.mat.transparent) m.renderOrder = 2;
      m.userData.debrisKind = "metal";
      if (parent) parent.add(m);
      out.push(m);
    });
    this.sets.clear();
    return out;
  };
  // a geometry in one flat colour into the vertex-colour set
  function vc(bin, geo, color, m4, o) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    const n = g.attributes.position.count, c = new THREE.Color(color), a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute("color", new THREE.BufferAttribute(a, 3));
    bin.add(g, vcMat(), m4, o);
    g.dispose();
    return bin;
  }
  // a local-frame painter over one placement matrix
  function Pen(bin, m4, cast) { this.b = bin; this.m = m4; this.cast = !!cast; }
  Pen.prototype.box = function (x, y, z, w, h, d, col, rx, ry, rz) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); if (rz) g.rotateZ(rz);
    g.translate(x, y, z);
    vc(this.b, g, col, this.m, { cast: this.cast });
    return this;
  };
  Pen.prototype.cyl = function (x, y, z, r0, r1, h, col, seg, rx, rz, ry) {
    const g = new THREE.CylinderGeometry(r0, r1, h, seg || 12);
    if (rx) g.rotateX(rx); if (rz) g.rotateZ(rz); if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    vc(this.b, g, col, this.m, { cast: this.cast });
    return this;
  };
  Pen.prototype.geo = function (g, col) { vc(this.b, g, col, this.m, { cast: this.cast }); return this; };
  // a straight round bar between two local points
  Pen.prototype.bar = function (a, b, r, col, seg) {
    const A = new THREE.Vector3(a[0], a[1], a[2]), B = new THREE.Vector3(b[0], b[1], b[2]);
    const d = B.clone().sub(A), L = d.length();
    if (L < 1e-4) return this;
    const g = new THREE.CylinderGeometry(r, r, L, seg || 8);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q));
    const mid = A.add(B).multiplyScalar(0.5);
    g.translate(mid.x, mid.y, mid.z);
    vc(this.b, g, col, this.m, { cast: this.cast });
    return this;
  };

  /* ==========================================================
     THE REFERENCE BODY AND WHAT IT WEARS
     ========================================================== */
  let REF = null;
  function ref() {
    if (REF !== null) return REF;
    REF = false;
    const H = CBZ.human;
    if (!H || typeof H.build !== "function" || !CBZ.combatKit) return REF;
    try {
      const ch = H.build({ torso: 0x3a3c40, collar: 0x3a3c40, arms: 0x3a3c40, legs: 0x3a3c40, skin: 0xcf9a72, hair: 0x2a2420, shoes: 0x1c1c1c });
      if (!ch || !ch.group || !ch.torsoShape) return REF;
      ch.group.position.set(0, 0, 0);
      ch.group.rotation.set(0, 0, 0);
      ch.group.updateMatrixWorld(true);
      // the dress form: chest, waist, collar, pelvis, head — in the standing frame
      const R = H.regions ? H.regions(ch) : null;
      const form = [];
      let pelvisMinY = Infinity;
      if (R) {
        const list = [].concat(R.torso || [], R.waist || [], R.pelvis || [], R.head || []);
        for (const m of list) {
          if (!m || !m.geometry || !m.geometry.attributes || !m.geometry.attributes.position) continue;
          const g = clean(m.geometry, false);
          g.applyMatrix4(m.matrixWorld);
          form.push(g);
          if ((R.pelvis || []).indexOf(m) >= 0) { g.computeBoundingBox(); pelvisMinY = Math.min(pelvisMinY, g.boundingBox.min.y); }
        }
      }
      let neckTop = 1.5;
      if (ch.neck) { const v = new THREE.Vector3(); ch.neck.getWorldPosition(v); neckTop = v.y; }
      REF = { ch: ch, form: form, pelvisMinY: isFinite(pelvisMinY) ? pelvisMinY : 0.9, neckY: neckTop, gear: Object.create(null) };
      // the rig never draws; take it off the face registry's hands
      ch._faceOrphan = 1e9;
    } catch (e) { REF = false; }
    return REF;
  }
  function harvestMeshes(meshes, filter) {
    const out = [];
    for (const m of meshes) {
      if (!m || !m.isMesh || !m.geometry || (filter && !filter(m))) continue;
      m.updateMatrixWorld(true);
      const g = clean(m.geometry, !!m.material.vertexColors);
      g.applyMatrix4(m.matrixWorld);
      out.push({ geo: g, mat: m.material, role: m.userData.hatRole || null });
    }
    return out;
  }
  // the carrier a loadout wears, in the standing frame
  function carrier(spec) {
    const R = ref();
    if (!R) return null;
    const key = "c|" + spec.loadout + "|" + (spec.nation || "");
    if (R.gear[key] !== undefined) return R.gear[key];
    let out = null;
    try {
      const K = CBZ.combatKit.wear(R.ch, { loadout: spec.loadout, nation: spec.nation });
      R.ch.group.updateMatrixWorld(true);
      if (K && K.carrier) {
        out = harvestMeshes([K.carrier])[0] || null;
        if (out) { out.geo.computeBoundingBox(); out.box = out.geo.boundingBox.clone(); }
      }
      CBZ.combatKit.strip(R.ch);
    } catch (e) { out = null; }
    R.gear[key] = out;
    return out;
  }
  // a helmet on the reference head, in the standing frame
  function lid(h) {
    const R = ref();
    if (!R || !CBZ.headwear || !h) return null;
    const key = "h|" + h.kind + "|" + (h.variant || "") + "|" + (h.color != null ? h.color : "");
    if (R.gear[key] !== undefined) return R.gear[key];
    let out = null;
    try {
      const grp = CBZ.headwear.wear(R.ch, h.kind, { owner: "armor", variant: h.variant, color: h.color, accent: h.accent });
      R.ch.group.updateMatrixWorld(true);
      if (grp) {
        const ms = [];
        grp.traverse(function (o) { if (o.isMesh) ms.push(o); });
        out = harvestMeshes(ms);
      }
      CBZ.headwear.wear(R.ch, null, { owner: "armor" });
    } catch (e) { out = null; }
    R.gear[key] = out;
    return out;
  }

  /* ==========================================================
     MANNEQUIN — a dress form of the real body on a pole and base.
     A torso display form on a 0.40 m weighted base, 25 mm chrome pole
     into the pelvis, the form in matte charcoal jersey.
     ========================================================== */
  let FORM_MAT = null;
  function formMat() {
    if (!FORM_MAT) FORM_MAT = CBZ.cmat ? CBZ.cmat(0x2c2e32) : new THREE.MeshLambertMaterial({ color: 0x2c2e32 });
    return FORM_MAT;
  }
  function mannequin(bin, x, z, yaw, spec) {
    const R = ref();
    if (!R) return null;
    const M = yawM(x, 0, z, yaw);
    for (const g of R.form) bin.add(g, formMat(), M, { cast: true });
    const P = new Pen(bin, M, true), CHROME = 0xb8bec6, BASE = 0x1c1e21;
    P.cyl(0, 0.012, 0, 0.2, 0.2, 0.024, BASE, 28);                    // weighted base plate
    P.cyl(0, 0.03, 0, 0.06, 0.08, 0.016, CHROME, 18);                 // pole boss
    P.cyl(0, (0.03 + R.pelvisMinY + 0.04) / 2, 0, 0.0125, 0.0125, R.pelvisMinY + 0.01, CHROME, 10);   // the pole
    P.cyl(0, R.pelvisMinY - 0.06, 0, 0.022, 0.022, 0.05, CHROME, 12);   // height collar + thumbscrew
    P.cyl(0.03, R.pelvisMinY - 0.06, 0, 0.006, 0.006, 0.04, CHROME, 6, 0, Math.PI / 2);
    const c = spec && spec.loadout ? carrier(spec) : null;
    if (c) bin.add(c.geo, c.mat, M, { cast: true });
    const h = spec && spec.helmet ? lid(spec.helmet) : null;
    if (h) for (const p of h) bin.add(p.geo, p.mat, M, { cast: p.role === "main" });
    if (CBZ.colliders) {
      const col = { minX: x - 0.27, maxX: x + 0.27, minZ: z - 0.27, maxZ: z + 0.27, noBreach: true, rack: true };
      CBZ.colliders.push(col);
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    }
    return { x: x, z: z };
  }

  /* ==========================================================
     A CARRIER ON A HOOK. (x, y, z) is the hook's root on the wall face;
     the carrier faces `yaw` (away from the wall) and hangs by the drag
     handle on the back plate's top: a 6 cm steel J-hook, the bag 3 cm
     off the wall.
     ========================================================== */
  function hungCarrier(bin, x, y, z, yaw, spec) {
    const c = carrier(spec);
    const M = yawM(x, y, z, yaw);
    const P = new Pen(bin, M, false), STEEL = 0x8b95a1;
    P.box(0, 0, 0.004, 0.05, 0.08, 0.008, STEEL);                     // the hook's plate
    P.bar([0, 0, 0.008], [0, 0, 0.07], 0.006, STEEL);                  // arm out
    P.bar([0, 0, 0.07], [0, 0.035, 0.085], 0.006, STEEL);              // the J's upturn
    if (!c) return null;
    const b = c.box, cx = (b.min.x + b.max.x) / 2;
    // the drag handle hooks over the arm: the bag's top 1 cm under it,
    // its back face 3 cm off the wall, centred on the hook
    const L = new THREE.Matrix4().multiplyMatrices(M, T(-cx, -b.max.y - 0.01, -b.min.z + 0.03));
    bin.add(c.geo, c.mat, L, { cast: true });
    return { depth: b.max.z - b.min.z + 0.03, height: b.max.y - b.min.y };
  }

  /* ==========================================================
     A HELMET ON A SHELF, resting on its own lowest point. The chinstrap
     tucks inside the shell the way an armourer stows one, and a riot
     lid's neck curtain is folded up into it.
     ========================================================== */
  function helmet(bin, x, y, z, yaw, h) {
    const parts = lid(h);
    if (!parts || !parts.length) return null;
    const keep = parts.filter(function (p) { return p.role !== "strap" && !(h.kind === "riot" && p.role === "under"); });
    const bb = new THREE.Box3();
    for (const p of keep) { p.geo.computeBoundingBox(); bb.union(p.geo.boundingBox); }
    const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
    const M = new THREE.Matrix4().multiplyMatrices(yawM(x, y, z, yaw), T(-cx, -bb.min.y, -cz));
    for (const p of keep) bin.add(p.geo, p.mat, M, { cast: p.role === "main" });
    return { w: bb.max.x - bb.min.x, d: bb.max.z - bb.min.z, h: bb.max.y - bb.min.y };
  }

  /* ==========================================================
     THE RIOT SHIELD. Reference: the standard 24 x 36 in (610 x 915 mm)
     4-6 mm clear polycarbonate body shield (Defense Technology Peacekeeper,
     Pro-Gard, Battle Steel 24x36), curved across its width, a black rubber
     U-channel round the whole edge, a rear handle on an aluminium mount
     with two foam arm pads above it. Built standing: bottom edge at local
     y 0, convex face toward +z.
     ========================================================== */
  const SH = { w: 0.61, h: 0.915, R: 0.95, t: 0.005 };
  let SHIELD = null;
  function shieldGeo() {
    if (SHIELD) return SHIELD;
    const half = SH.w / 2 / SH.R;
    const sheet = new THREE.CylinderGeometry(SH.R, SH.R, SH.h, 20, 1, true, -half, half * 2);
    sheet.translate(0, SH.h / 2, -SH.R);
    // the trim + the back hardware, local to the curved sheet
    const parts = [];
    const add = (g, col) => parts.push([g, col]);
    const RUB = 0x121315, AL = 0x6d737a, FOAM = 0x1b1c1e;
    for (const yy of [0.006, SH.h - 0.006]) {                         // top + bottom channel
      const arc = new THREE.TorusGeometry(SH.R, 0.008, 5, 20, half * 2);
      arc.rotateX(Math.PI / 2);
      arc.rotateY(half - Math.PI / 2);
      arc.translate(0, yy, -SH.R);
      add(arc, RUB);
    }
    for (const s of [-1, 1]) {                                        // side channels
      const a = s * half, g = new THREE.CylinderGeometry(0.008, 0.008, SH.h, 6);
      g.translate(Math.sin(a) * SH.R, SH.h / 2, Math.cos(a) * SH.R - SH.R);
      add(g, RUB);
    }
    const back = -0.012;                                              // behind the sheet's centre
    add(new THREE.BoxGeometry(0.04, 0.3, 0.01).translate(0, 0.42, back), AL);          // handle mount rail
    add(new THREE.BoxGeometry(0.03, 0.03, 0.06).translate(0, 0.33, back - 0.03), AL);  // standoffs
    add(new THREE.BoxGeometry(0.03, 0.03, 0.06).translate(0, 0.51, back - 0.03), AL);
    const grip = new THREE.CylinderGeometry(0.016, 0.016, 0.21, 10);
    grip.translate(0, 0.42, back - 0.065);
    add(grip, 0x1a1a1a);                                              // the vertical grip
    for (const yy of [0.62, 0.72]) add(new THREE.BoxGeometry(0.14, 0.06, 0.025).translate(0, yy, back - 0.012), FOAM);  // arm pads
    add(new THREE.BoxGeometry(0.03, 0.12, 0.012).translate(0.07, 0.67, back - 0.02), 0x2a2b2d);   // arm strap
    SHIELD = { sheet: sheet, parts: parts };
    return SHIELD;
  }
  function riotShield(bin, x, y, z, yaw) {
    const S = shieldGeo();
    const M = yawM(x, y, z, yaw);
    bin.add(S.sheet, polyMat(), M);
    for (const p of S.parts) vc(bin, p[0].clone(), p[1], M, { cast: true });
  }
  /* A FLOOR SHIELD RACK: a steel base channel with a slot per shield and a
     top rail with matching fingers, the shields standing in it face to
     face. Runs along local x; n shields at 11 cm pitch; the rack faces +z
     (a shield's convex face). Returns its footprint half-extents. */
  function shieldRack(bin, x, z, yaw, n) {
    n = n || 5;
    const pitch = 0.13, L = (n - 1) * pitch + 0.2, Dd = SH.w + 0.08;
    const M = yawM(x, 0, z, yaw), P = new Pen(bin, M, true), STEEL = 0x3b424b, PAD = 0x17191b;
    const S = shieldGeo();
    // the shields stand across the rack: each one a quarter turn (convex face
    // toward local +x, its width along the rack's depth), stepped along the run
    for (let i = 0; i < n; i++) {
      const lx = -((n - 1) * pitch) / 2 + i * pitch + 0.03;
      const C = new THREE.Matrix4().multiplyMatrices(M, yawM(lx, 0.035, 0, Math.PI / 2));
      bin.add(S.sheet, polyMat(), C);
      for (const p of S.parts) vc(bin, p[0].clone(), p[1], C, { cast: true });
    }
    P.box(0, 0.015, 0, L, 0.03, Dd, STEEL);                          // base channel
    P.box(0, 0.033, 0, L - 0.04, 0.006, Dd - 0.06, PAD);              // its rubber liner
    for (const s of [-1, 1]) {
      P.box(s * L / 2, 0.45, -Dd / 2 + 0.02, 0.04, 0.9, 0.04, STEEL);  // end posts (the back pair)
      P.box(s * L / 2, 0.06, Dd / 2 - 0.02, 0.04, 0.12, 0.04, STEEL);  // front stubs
    }
    P.box(0, 0.88, -Dd / 2 + 0.02, L, 0.04, 0.04, STEEL);             // top rail
    for (let i = 0; i < n; i++) {
      const lx = -((n - 1) * pitch) / 2 + i * pitch;
      for (const dx of [0.02, -0.065]) P.box(lx + 0.03 + dx, 0.86, -Dd / 2 + 0.06, 0.006, 0.05, 0.08, PAD);   // rubber fingers either side of each shield
    }
    return { hx: L / 2, hz: Dd / 2 };
  }

  /* ==========================================================
     M2A1 .50-CAL AMMO CAN. Reference: exterior 11.75 x 6 x 7.5 in
     (298 x 152 x 190 mm), OD steel, the lid a pressed cap with a raised
     rib, a fold-flat wire carry handle on it, the cam latch lever down one
     end, hinge at the other. On a surface at y, long axis along local x.
     ========================================================== */
  const OD = 0x4a5232, OD_D = 0x3c4329, LATCH = 0x2e3423;
  function ammoCan(bin, x, y, z, yaw, o) {
    o = o || {};
    const L = 0.298, W = 0.152, H = 0.19, col = o.color != null ? o.color : OD;
    const P = new Pen(bin, yawM(x, y, z, yaw), false);
    P.box(0, (H - 0.035) / 2, 0, L, H - 0.035, W, col);                       // body
    P.box(0, 0.006, 0, L - 0.01, 0.012, W - 0.01, OD_D);                      // base flange shadow
    P.box(0, H - 0.0175, 0, L + 0.008, 0.035, W + 0.008, col);                // the lid
    P.box(0, H + 0.002, 0, L - 0.05, 0.004, W - 0.05, OD_D);                  // its pressed rib
    P.box(-L / 2 - 0.006, H - 0.06, 0, 0.012, 0.09, 0.07, LATCH);             // cam latch lever, down the end
    P.box(-L / 2 - 0.004, H - 0.015, 0, 0.01, 0.02, 0.09, LATCH);             // latch pivot
    P.box(L / 2 + 0.004, H - 0.03, 0, 0.008, 0.025, W - 0.02, OD_D);          // the hinge
    // the wire carry handle, folded flat on the lid
    P.bar([-0.06, H + 0.006, -0.03], [-0.06, H + 0.006, 0.03], 0.004, LATCH, 6);
    P.bar([0.06, H + 0.006, -0.03], [0.06, H + 0.006, 0.03], 0.004, LATCH, 6);
    P.bar([-0.06, H + 0.008, 0.03], [0.06, H + 0.008, 0.03], 0.006, LATCH, 6);
    return { top: y + H + 0.01, L: L, W: W };
  }

  /* ==========================================================
     STEEL SHELVING: boltless angle-post shelving. 4 slotted angle posts,
     steel deck shelves with a turned-down front lip, a kick shelf 10 cm off
     the floor. o { len, deep, h, n } — runs along local x, back at -z.
     Returns { tops: [y...] }.
     ========================================================== */
  function shelving(bin, x, z, yaw, o) {
    o = o || {};
    const Lw = o.len || 1.22, D = o.deep || 0.46, H = o.h || 1.83, n = o.n || 4;
    const P = new Pen(bin, yawM(x, 0, z, yaw), false), ST = 0x4a525c, DECK = 0x5d6670, HOLE = 0x262b31;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const px = sx * (Lw / 2 - 0.02), pz = sz * (D / 2 - 0.02);
      P.box(px, H / 2, pz + sz * 0.0, 0.04, H, 0.004, ST);                  // the angle's two legs
      P.box(px + sx * 0.0, H / 2, pz, 0.004, H, 0.04, ST);
      for (let k = 0; k < 12; k++) P.box(px, 0.12 + k * (H - 0.2) / 12, pz + sz * 0.0025, 0.012, 0.03, 0.002, HOLE);  // keyhole slots
    }
    const tops = [];
    for (let i = 0; i < n; i++) {
      const y = 0.1 + i * (H - 0.14) / (n - 1);
      P.box(0, y, 0, Lw - 0.01, 0.012, D - 0.01, DECK);                      // deck
      P.box(0, y - 0.02, D / 2 - 0.004, Lw, 0.04, 0.008, ST);                // front lip beam
      P.box(0, y - 0.02, -D / 2 + 0.004, Lw, 0.04, 0.008, ST);               // back beam
      tops.push(y + 0.006);
    }
    return { tops: tops, L: Lw, D: D, H: H };
  }

  /* ==========================================================
     GEAR LOCKERS: a bank of single-tier steel lockers, 15 x 18 x 72 in
     (381 x 457 x 1829 mm) on a 100 mm closed base, louvred door tops, a
     recessed lift handle with a padlock hasp, a sloped top. Back at local
     -z, doors toward +z, the bank runs along local x.
     ========================================================== */
  function lockers(bin, x, z, yaw, n) {
    n = n || 4;
    const W = 0.381, D = 0.457, H = 1.829, BASE = 0.1;
    const P = new Pen(bin, yawM(x, 0, z, yaw), true);
    const BODY = 0x55606b, DOOR = 0x5f6b77, DARK = 0x1d2126, CHR = 0xa9b0b8;
    const Lw = W * n;
    P.box(0, BASE / 2, 0, Lw, BASE, D - 0.02, 0x23272c);                      // closed base
    P.box(0, BASE + (H - BASE) / 2, -0.01, Lw, H - BASE, D - 0.02, BODY);     // carcass
    const top = new THREE.BoxGeometry(Lw, 0.02, D);
    top.rotateX(-0.2); top.translate(0, H + 0.05, -0.01);
    P.geo(top, BODY);                                                          // sloped top
    for (let i = 0; i < n; i++) {
      const lx = -Lw / 2 + W * (i + 0.5), fz = D / 2 - 0.01;
      P.box(lx, BASE + (H - BASE) / 2, fz, W - 0.012, H - BASE - 0.03, 0.012, DOOR);   // door
      for (let k = 0; k < 6; k++) P.box(lx, H - 0.12 - k * 0.035, fz + 0.007, W - 0.12, 0.012, 0.006, DARK);   // top louvres
      for (let k = 0; k < 6; k++) P.box(lx, BASE + 0.14 + k * 0.035, fz + 0.007, W - 0.12, 0.012, 0.006, DARK); // bottom louvres
      P.box(lx + W / 2 - 0.06, BASE + 0.95, fz + 0.008, 0.035, 0.16, 0.01, DARK);       // recessed handle cup
      P.box(lx + W / 2 - 0.06, BASE + 0.95, fz + 0.014, 0.02, 0.1, 0.008, CHR);         // lift handle
      P.box(lx + W / 2 - 0.06, BASE + 0.86, fz + 0.016, 0.02, 0.03, 0.01, CHR);         // padlock hasp
      for (const hy of [0.25, H - 0.25]) P.cyl(lx - W / 2 + 0.012, hy, fz, 0.006, 0.006, 0.07, CHR, 6);   // hinges
    }
    if (CBZ.colliders) {
      // one collider over the bank, whatever the yaw (cardinal in practice)
      const c = Math.abs(Math.cos(yaw || 0)) > 0.5;
      const hx = c ? Lw / 2 : D / 2, hz = c ? D / 2 : Lw / 2;
      CBZ.colliders.push({ minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz, noBreach: true, rack: true });
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    }
    return { L: Lw, D: D, H: H };
  }

  /* ==========================================================
     A WOODEN MUNITIONS CRATE (the M548 / demolition-block box pattern):
     painted pine boards with visible joints, a cleat frame round each end,
     a hinged lid with two battens, rope handles in the end cleats, a steel
     hasp on the front. Long axis along local x, on the floor (or y0).
     ========================================================== */
  function crate(bin, x, y0, z, yaw, w, h, d, color) {
    const P = new Pen(bin, yawM(x, y0 || 0, z, yaw), true);
    const C = color != null ? color : 0x4a5233, J = 0x2a2f1d, CL = 0x3c4329, ST = 0x6e7378, ROPE = 0x9a8a66;
    const lid = 0.05, bh = h - lid;
    P.box(0, bh / 2, 0, w - 0.04, bh, d, C);                                        // the box
    for (let k = 1; k < 4; k++) {                                                   // board joints
      P.box(0, k * bh / 4, d / 2 + 0.001, w - 0.06, 0.004, 0.002, J);
      P.box(0, k * bh / 4, -d / 2 - 0.001, w - 0.06, 0.004, 0.002, J);
    }
    for (const e of [-1, 1]) {
      const ex = e * (w / 2 - 0.01);
      P.box(ex, bh / 2, 0, 0.02, bh, d + 0.02, CL);                                 // end panel
      P.box(ex + e * 0.012, bh / 2, d / 2 - 0.02, 0.025, bh, 0.04, CL);             // end cleats
      P.box(ex + e * 0.012, bh / 2, -d / 2 + 0.02, 0.025, bh, 0.04, CL);
      P.box(ex + e * 0.012, bh - 0.03, 0, 0.025, 0.05, d - 0.06, CL);
      P.box(ex + e * 0.012, 0.03, 0, 0.025, 0.05, d - 0.06, CL);
      const rope = new THREE.TorusGeometry(0.045, 0.008, 5, 10, Math.PI);           // rope handle
      rope.rotateY(Math.PI / 2); rope.rotateX(Math.PI);
      rope.translate(ex + e * 0.03, bh - 0.11, 0);
      P.geo(rope, ROPE);
    }
    P.box(0, bh + lid / 2, 0, w, lid, d + 0.02, C);                                 // the lid
    for (const lx of [-w * 0.3, w * 0.3]) P.box(lx, bh + lid + 0.01, 0, 0.06, 0.02, d + 0.02, CL);   // its battens
    P.box(0, bh - 0.02, d / 2 + 0.008, 0.05, 0.07, 0.008, ST);                     // hasp
    P.cyl(0, bh - 0.05, d / 2 + 0.014, 0.008, 0.008, 0.01, ST, 8, Math.PI / 2);    // staple
    return { top: (y0 || 0) + h + 0.02 };
  }

  /* ==========================================================
     A DETENTION KEY ON ITS RING: the long brass "Folger Adams" style jail
     key (a 10-12 cm bit key: round bow with its hole, a long shank, the
     bit with its wards cut), a split ring, a red fibre tag. Built hanging
     from the ring's top at the origin, in the x-y plane. Returns a Group
     of three meshes (brass / ring steel / tag) so a caller can hide it.
     ========================================================== */
  function keyGroup(o) {
    o = o || {};
    const k = o.scale || 1;
    const g = new THREE.Group();
    const mt = (hex, em) => (CBZ.mat ? CBZ.mat(hex, em ? { emissive: em, ei: 0.35 } : {}) : new THREE.MeshLambertMaterial({ color: hex }));
    const brass = mt(o.brass != null ? o.brass : 0xd6a33b, o.glow ? 0x4a3308 : null);
    const parts = [];
    const ring = new THREE.TorusGeometry(0.014 * k, 0.0025 * k, 5, 14).translate(0, -0.014 * k, 0);
    const bow = new THREE.TorusGeometry(0.016 * k, 0.006 * k, 6, 16).translate(0, -0.034 * k, 0);
    const shank = new THREE.CylinderGeometry(0.0045 * k, 0.0045 * k, 0.085 * k, 8).translate(0, -0.093 * k, 0);
    const collar = new THREE.CylinderGeometry(0.007 * k, 0.007 * k, 0.006 * k, 10).translate(0, -0.055 * k, 0);
    const bit = new THREE.BoxGeometry(0.018 * k, 0.022 * k, 0.004 * k).translate(0.011 * k, -0.122 * k, 0);
    const ward = new THREE.BoxGeometry(0.006 * k, 0.006 * k, 0.0045 * k).translate(0.016 * k, -0.118 * k, 0);
    for (const q of [bow, shank, collar, bit, ward]) parts.push(q.index ? q.toNonIndexed() : q);
    for (const q of parts) { if (q.attributes.uv) q.deleteAttribute("uv"); }
    const BGU = THREE.BufferGeometryUtils;
    const key = new THREE.Mesh(BGU ? BGU.mergeBufferGeometries(parts, false) : shank, brass);
    key.position.set(0.004 * k, 0, 0.002 * k);
    key.rotation.z = 0.08;
    const ringM = new THREE.Mesh(ring, mt(0x9aa3ad));
    const tag = new THREE.Mesh(new THREE.BoxGeometry(0.032 * k, 0.052 * k, 0.003 * k), mt(0xb3362a, o.glow ? 0x3a0c08 : null));
    tag.position.set(-0.018 * k, -0.05 * k, -0.003 * k);
    tag.rotation.z = -0.15;
    g.add(ringM, key, tag);
    g.traverse(function (m) { if (m.isMesh) m.castShadow = false; });
    return g;
  }

  CBZ.armoryKit = {
    keyGroup: keyGroup,
    crate: crate,
    version: 1,
    bin: function () { return new Bin(); },
    Pen: Pen, vc: vc, yawM: yawM, vcMat: vcMat, polyMat: polyMat,
    ref: ref, carrier: carrier, lid: lid,
    mannequin: mannequin, hungCarrier: hungCarrier, helmet: helmet,
    riotShield: riotShield, shieldRack: shieldRack,
    ammoCan: ammoCan, shelving: shelving, lockers: lockers,
    SHIELD: SH,
  };
})();
