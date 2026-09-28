/* ============================================================
   world/corridorkit.js — THE PIECES A PRISON CORRIDOR IS MADE OF.

   The owner's photographs (2026-09-05): a block-wall corridor, green to
   shoulder height and cream above, a polished floor, strip lights, a red
   EXIT sign; a barred grille across it, one panel fixed and one sliding on
   a heavy header; a steel door with a wired window; a chain-link walkway
   under coil into a concrete sally port.

   This file is those pieces, generic enough that world/corridors.js lays
   a kilometre of them and world/sallyport.js is one call:

     CBZ.corridorKit.grille(cfg)      a sliding barred gate across a corridor.
                                      axis "x" (gate plane z, spans x0..x1)
                                      or "z" (plane x, spans z0..z1). Keys,
                                      C4 row, the registry contract every
                                      prison door speaks (systems/
                                      interactions.js), auto-shut.
     CBZ.corridorKit.door(cfg)        a swinging leaf, same contract, same
                                      two axes; `build(group, w, h, dir)`
                                      draws the leaf.
     CBZ.corridorKit.lining(...)      painted block on a wall face, two bands
     CBZ.corridorKit.exitSign(...)    the red sign, always lit
     CBZ.corridorKit.strip(...)       a ceiling strip (24 h, merged)
     CBZ.corridorKit.cagedLamp(...)   an outdoor fitting on the flood circuit
     CBZ.buildSallyPort(cfg)          the exit building: walkway, vestibule,
                                      grille on the Gate Key, booth, out door

   KEYS ARE FEW. A grille takes ONE ring — the Corridor Key or the Gate Key
   — never a key of its own; that is how a real key-control policy works
   (one issued ring per post, restricted sets for the perimeter) and it is
   why the owner's "not a dumb amount of keys" is also the realistic one.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !CBZ.prisonKit || !CBZ.addBox) return;
  const K = CBZ.prisonKit;
  const { addBox } = CBZ;
  const root = () => CBZ.prisonRoot || CBZ.scene;
  const stat = K.stat;

  const steelDark = K.skin("steel", 0x3a4048), galv = K.skin("galv", 0xb4bcc4);
  const bars = K.skin("galv", 0x9aa3a8);
  const BLOCK_LOW = 0x7d9787, BLOCK_HIGH = 0xe4e0d4;

  /* ==========================================================
     1. DOORS. One registry contract, two shapes, two axes.
     ========================================================== */
  const doors = [];
  function keyTest(keys) {
    return function () {
      const g = CBZ.game;
      if (g && (CBZ.prisonStaffKey ? CBZ.prisonStaffKey() : g.role === "cop")) return true;
      if (!keys || !keys.length) return true;
      if (keys.indexOf("Keycard") >= 0 && g && g.hasKey) return true;
      const econ = CBZ.econ;
      for (const k of keys) if (econ && econ.hasItem && econ.hasItem(k)) return true;
      return false;
    };
  }
  function registerDoor(d, cfg) {
    d.open = false; d.t = 0; d.openT = 0; d.blown = false; d.keys = cfg.keys || null;
    CBZ.colliders.push(d.collider);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    d.setOpen = function (v, quiet) {
      v = !!v;
      if (v === d.open) return v;
      d.open = v; d.openT = 0;
      const i = CBZ.colliders.indexOf(d.collider);
      if (v && i >= 0) CBZ.colliders.splice(i, 1);
      else if (!v && i < 0) CBZ.colliders.push(d.collider);
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
      if (d.lamp && !d.lamp._exitSignal) {
        d.lamp.color.setHex(v ? 0x39ff88 : 0xff3b3b);
        d.lamp.emissive.setHex(v ? 0x14c258 : 0xff0000);
      }
      if (!quiet && CBZ.worldSfx) CBZ.worldSfx(v ? "door_open" : "door_close", d.x, d.z, { ref: 10 });
      return v;
    };
    if (CBZ.registerBreachTarget && cfg.lb) {
      CBZ.registerBreachTarget({
        id: cfg.id, lb: cfg.lb, reach: 2.6,
        at: function () { return { x: d.x, y: 1.4, z: d.z }; },
        done: function () { return d.open; },
        defeat: function () { d.setOpen(true); d.blown = true; d.group.visible = false; },
      });
    }
    (CBZ._prisonDoorSpecs || (CBZ._prisonDoorSpecs = [])).push({
      id: cfg.id, label: cfg.label, autoR: 2.5, openByTap: true,
      keyed: !!(cfg.keys && cfg.keys.length),   // needs a card (systems/prisondoorwatch.js)
      at: function () { return { x: d.x, y: 1.4, z: d.z }; },
      pick: function () { return [d.group]; },
      col: function () { return d.collider; },
      isOpen: function () { return !!d.open; },
      permanent: function () { return !!d.blown; },
      canUse: keyTest(cfg.keys),
      set: function (v) { d.setOpen(v); return d.open === !!v; },
    });
    doors.push(d);
    return d;
  }
  // one mesh per field of bars (a grille was ~80 draws; it is 4)
  function barField(group, x0, x1, y0, y1, pitch, z, mat) {
    const n = Math.max(1, Math.round((x1 - x0) / pitch));
    const geos = [];
    for (let i = 0; i <= n; i++) {
      const g = new THREE.BoxGeometry(0.035, y1 - y0, 0.035);
      g.translate(x0 + (i * (x1 - x0)) / n, (y0 + y1) / 2, z);
      geos.push(g);
    }
    const BGU = THREE.BufferGeometryUtils;
    const merged = BGU && BGU.mergeBufferGeometries ? BGU.mergeBufferGeometries(geos, false) : geos[0];
    group.add(new THREE.Mesh(merged, mat));
  }
  function flat(group, x0, x1, y, z, h, mat) {
    const g = new THREE.BoxGeometry(x1 - x0, h, 0.05);
    g.translate((x0 + x1) / 2, y, z);
    group.add(new THREE.Mesh(g, mat));
  }
  /* cfg: { id, label, axis: "x"|"z", a0, a1 (the span across the corridor),
            fixed (the gate plane), fixedTo (where the fixed panel ends and
            the leaf begins; default a0 + 30%), h, keys, lb, autoShut }
     In local space the gate spans local x from a0..a1 at local z = 0 and
     the leaf slides toward a0. axis "z" rotates that into the x = fixed
     plane spanning z. */
  function grille(cfg) {
    const along = cfg.axis === "z";
    const a0 = cfg.a0, a1 = cfg.a1, fixed = cfg.fixed;
    const h = cfg.h || 3.55, fx = cfg.fixedTo != null ? cfg.fixedTo : a0 + (a1 - a0) * 0.3;
    const G = new THREE.Group(); G.userData.mover = true;     // the whole gate: fixed panel, header, leaf
    const fixedG = new THREE.Group();
    barField(fixedG, a0 + 0.05, fx, 0.06, h, 0.14, -0.1, bars);
    flat(fixedG, a0, fx + 0.03, 0.30, -0.1, 0.10, steelDark);
    flat(fixedG, a0, fx + 0.03, 1.55, -0.1, 0.10, steelDark);
    flat(fixedG, a0, fx + 0.03, h - 0.06, -0.1, 0.10, steelDark);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, h, 0.24), steelDark);
    post.position.set(fx, h / 2, -0.1); fixedG.add(post);
    G.add(fixedG);
    const header = new THREE.Mesh(new THREE.BoxGeometry(a1 - a0 + 0.3, 0.42, 0.42), steelDark);
    header.position.set((a0 + a1) / 2, 2.72, 0); G.add(header);
    const leaf = new THREE.Group();
    const lw = a1 - fx;
    barField(leaf, 0.08, lw - 0.08, 0.06, h, 0.14, 0, bars);
    flat(leaf, 0, lw, 0.30, 0, 0.10, steelDark);
    flat(leaf, 0, lw, 1.55, 0, 0.10, steelDark);
    flat(leaf, 0, lw, h - 0.06, 0, 0.10, steelDark);
    for (const lx of [0.04, lw - 0.04]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.09, h, 0.2), steelDark); p.position.set(lx, h / 2, 0); leaf.add(p); }
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.5, 0.12), steelDark); lock.position.set(0.16, 1.02, 0.14); leaf.add(lock);
    const lampMat = new THREE.MeshLambertMaterial({ color: 0xff3b3b, emissive: 0xff0000, emissiveIntensity: 1.0 });
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.06), lampMat); lamp.position.set(0.16, 1.4, 0.19); leaf.add(lamp);
    for (const lx of [0.3, lw - 0.3]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.08, 10), galv); r.rotation.x = Math.PI / 2; r.position.set(lx, h + 0.05, 0.08); leaf.add(r); }
    leaf.position.set(fx, 0, 0.1);
    G.add(leaf);
    if (along) { G.rotation.y = -Math.PI / 2; G.position.set(fixed, 0, 0); }   // local +x -> world +z
    else G.position.set(0, 0, fixed);
    root().add(G);
    // colliders: the fixed panel is a wall; the leaf's is spliced with the door
    const band = (p0, p1) => along ? { minX: fixed - 0.25, maxX: fixed + 0.25, minZ: p0, maxZ: p1 }
      : { minX: p0, maxX: p1, minZ: fixed - 0.25, maxZ: fixed + 0.25 };
    const fixedCol = Object.assign(band(a0, fx + 0.08), { grille: true, noBreach: true, ref: post });
    CBZ.colliders.push(fixedCol);
    const d = {
      id: cfg.id, x: along ? fixed : (fx + a1) / 2, z: along ? (fx + a1) / 2 : fixed, group: G, lamp: lampMat, kind: "grille",
      shutX: fx, openX: fx - (lw - 0.5), leaf: leaf,
      collider: Object.assign(band(fx, a1), { ref: post }),
      autoShut: cfg.autoShut != null ? cfg.autoShut : 5,
    };
    return registerDoor(d, cfg);
  }
  /* ==========================================================
     THE DOOR SET. A leaf in a hole is not a door (owner, 2026-09-28: "look
     at how stupid the opening to the warden's room is ... his door doesn't
     have physics"). Every swinging leaf in the compound was a slab pivoting
     on the wall's CENTRE LINE in a raw hole: no frame, no stop, no hinges,
     and opened past 90 degrees it swung back through the wall it hung in.
     A real door set is a frame that wraps the opening (two jambs and a head,
     the full depth of the wall), a stop the leaf closes against, an
     architrave on both faces that covers the joint with the wall, and a
     leaf hung on three hinges at the FACE of the frame on the side it opens
     to, so it swings clear of the jamb and stops square to the wall.

     cfg: { axis "x" (wall along x, plane z = fixed) | "z" (plane x = fixed),
            a0, a1        the rough opening along the wall
            t             wall thickness (the frame wraps all of it)
            h             head height; y0 the finished floor the leaf clears
            open          +1 | -1: which side of the wall the leaf swings to,
                          in LOCAL z (axis x: world z; axis z: world -x)
            hinge         -1 hung at a0, +1 at a1, 0 = a PAIR meeting mid-span
            meet          this set is one half of a pair drawn as two sets:
                          no jamb or stop on the free side
            build(g, w, h, dir)  draws one leaf from its hinge edge along
                          +dir x, centred on g's z = 0, LT thick
            frame         frame colour; max  fraction of 90 deg it opens }
     -> { leaves: [{ pivot, base, swing, slab }], set(t 0..1), clear }     */
  const JW = 0.05, AW = 0.075, AP = 0.025, LT = 0.05;
  function doorSet(cfg) {
    const along = cfg.axis === "z";
    const a0 = Math.min(cfg.a0, cfg.a1), a1 = Math.max(cfg.a0, cfg.a1), fixed = cfg.fixed;
    const t = cfg.t || 0.3, h = cfg.h || 2.3, y0 = cfg.y0 || 0, open = cfg.open < 0 ? -1 : 1;
    const hinge = cfg.hinge == null ? -1 : cfg.hinge;
    const fmat = K.skin("steel", cfg.frame != null ? cfg.frame : 0x5b636d, 0.5);
    const hmat = K.skin("galv", 0xa9b0b7);
    // local (lx along the wall, lz across it) -> world
    const W = (lx, lz) => along ? [fixed - lz, lx] : [lx, fixed + lz];
    const ry = along ? -Math.PI / 2 : 0;
    function piece(w, hh, d, lx, y, lz, mat) {
      const p = W(lx, lz);
      stat(new THREE.BoxGeometry(w, hh, d), mat || fmat, p[0], y, p[1], { ry: ry, cast: false });
    }
    // which jambs this set owns: a pair-half has only its hinge jamb
    const jamb0 = !(cfg.meet && hinge > 0), jamb1 = !(cfg.meet && hinge < 0);
    const in0 = a0 + (jamb0 ? JW : 0), in1 = a1 - (jamb1 ? JW : 0);
    // FRAME: jambs + head wrap the wall's full depth (+1 cm proud each face)
    if (jamb0) piece(JW, h, t + 0.02, a0 + JW / 2, h / 2, 0);
    if (jamb1) piece(JW, h, t + 0.02, a1 - JW / 2, h / 2, 0);
    piece(a1 - a0, JW, t + 0.02, (a0 + a1) / 2, h - JW / 2, 0);
    // STOP: the rebate the leaf shuts against, just behind the leaf's plane
    const sz = open * (t / 2) - open * (LT + 0.02);
    if (jamb0) piece(0.018, h - JW, 0.035, in0 + 0.009, (h - JW) / 2, sz);
    if (jamb1) piece(0.018, h - JW, 0.035, in1 - 0.009, (h - JW) / 2, sz);
    piece(in1 - in0, 0.018, 0.035, (in0 + in1) / 2, h - JW - 0.009, sz);
    // ARCHITRAVE, both faces
    for (const f of [-1, 1]) {
      const az = f * (t / 2 + AP / 2);
      if (jamb0) piece(AW, h + AW, AP, a0 - AW / 2, (h + AW) / 2, az);
      if (jamb1) piece(AW, h + AW, AP, a1 + AW / 2, (h + AW) / 2, az);
      const hx0 = a0 - (jamb0 ? AW : 0), hx1 = a1 + (jamb1 ? AW : 0);
      piece(hx1 - hx0, AW, AP, (hx0 + hx1) / 2, h + AW / 2, az);
    }
    // THE LEAVES, each on three hinges at the frame face it opens to
    const spans = hinge === 0 ? [[-1, in0, (in0 + in1) / 2 - 0.003], [1, (in0 + in1) / 2 + 0.003, in1]]
      : [[hinge < 0 ? -1 : 1, in0, in1]];
    const leaves = [];
    const lh = h - JW - y0 - 0.012;
    for (const s of spans) {
      const side = s[0], dir = side < 0 ? 1 : -1, hx = side < 0 ? s[1] : s[2];
      const lw = s[2] - s[1] - 0.004;
      const pz = open * (t / 2);
      const pivot = new THREE.Group(); pivot.userData.mover = true;
      const p = W(hx, pz);
      pivot.position.set(p[0], 0, p[1]);
      pivot.rotation.y = ry;
      const g = new THREE.Group();
      g.position.set(0, y0 + 0.008, -open * LT / 2);
      pivot.add(g);
      const slab = cfg.build(g, lw, lh, dir, leaves.length) || null;
      // hinges: knuckles on the frame at the pivot line (static), leaves on the leaf
      for (const hy of [0.24, lh * 0.5, lh - 0.26]) {
        const k = W(hx, pz + open * 0.004);
        stat(new THREE.CylinderGeometry(0.012, 0.012, 0.11, 10), hmat, k[0], y0 + hy, k[1], { cast: false });
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.004), hmat);
        m.position.set(dir * 0.03, hy - 0.008, open * (LT / 2 + 0.002)); g.add(m);
      }
      root().add(pivot);
      leaves.push({ pivot: pivot, base: ry, swing: -open * dir * (Math.PI / 2) * (cfg.max || 0.97), slab: slab });
    }
    return {
      leaves: leaves,
      clear: { a0: in0, a1: in1 },
      set: function (u) { for (const L of leaves) L.pivot.rotation.y = L.base + L.swing * u; },
    };
  }
  /* cfg: { id, label, axis, a0, a1, fixed, t, h, keys, lb, swing,
            hinge (-1 at a0), meet, build(group, w, h, dir), autoShut }
     `swing` keeps its historic meaning in the LOCAL frame: the leaf goes to
     local z = -swing (for axis "x" that is world -z at swing +1; for axis
     "z", world +x). The door set above hangs it on that face. */
  function door(cfg) {
    const along = cfg.axis === "z";
    const a0 = cfg.a0, a1 = cfg.a1, fixed = cfg.fixed, t = cfg.t || 0.3;
    const set = doorSet({ axis: cfg.axis, a0: a0, a1: a1, fixed: fixed, t: t, h: cfg.h || 2.3, y0: cfg.y0,
      open: -(cfg.swing || 1), hinge: cfg.hinge < 0 ? -1 : 1, meet: cfg.meet, build: cfg.build, frame: cfg.frame });
    const L = set.leaves[0];
    const d = {
      id: cfg.id, x: along ? fixed : (a0 + a1) / 2, z: along ? (a0 + a1) / 2 : fixed, group: L.pivot, kind: "swing", base: L.base,
      swing: L.swing,
      collider: along ? { minX: fixed - t / 2, maxX: fixed + t / 2, minZ: a0, maxZ: a1, ref: L.pivot }
        : { minX: a0, maxX: a1, minZ: fixed - t / 2, maxZ: fixed + t / 2, ref: L.pivot },
      autoShut: cfg.autoShut != null ? cfg.autoShut : 4,
    };
    if (cfg.lamp) d.lamp = cfg.lamp;
    return registerDoor(d, cfg);
  }
  /* STAFF OPEN THE DOORS THEY HOLD KEYS TO. A movement officer walking the
     spine carries the Corridor Key; when he reaches a grille it opens and it
     shuts behind him — the same tailgating window world/prisonwings.js
     leaves at its card doors, and the reason a man can follow an officer
     through a section he has no key for. Who opens what: any officer for an
     unlocked door; rank 2+ for a card door; the corridor post for the
     Corridor Key; the gate post for the Gate Key. */
  function staffFor(d) {
    const list = CBZ.guards || [];
    for (let i = 0; i < list.length; i++) {
      const g = list[i];
      if (!g || g.dead || g.ko > 0 || !g.group) continue;
      const dx = g.group.position.x - d.x, dz = g.group.position.z - d.z;
      if (dx * dx + dz * dz > 2.4 * 2.4) continue;
      const k = d.keys;
      if (!k || !k.length) return g;
      if (k.indexOf("Corridor Key") >= 0 && (g.post === "corridor" || g.kind === "warden")) return g;
      if (k.indexOf("Gate Key") >= 0 && (g.post === "gate" || g.kind === "warden")) return g;
      if (k.indexOf("Keycard") >= 0 && ((g.rank || 0) >= 2 || g.kind === "warden")) return g;
    }
    return null;
  }
  CBZ.onUpdate(41.46, function (dt) {
    const P = CBZ.player && CBZ.player.pos;
    for (let i = 0; i < doors.length; i++) {
      const d = doors[i];
      if (!d.open && !d.blown) { const g = staffFor(d); if (g) d.setOpen(true); }
      const want = d.open ? 1 : 0;
      if (d.t !== want) {
        d.t += Math.sign(want - d.t) * Math.min(Math.abs(want - d.t), dt * (d.kind === "grille" ? 0.9 : 1.8));
        if (d.kind === "grille") d.leaf.position.x = d.shutX + (d.openX - d.shutX) * d.t;
        else d.group.rotation.y = d.base + d.swing * d.t;
      }
      if (d.open && !d.blown) {
        d.openT += dt;
        const near = (P ? (P.x - d.x) * (P.x - d.x) + (P.z - d.z) * (P.z - d.z) < 3.2 * 3.2 : false) || !!staffFor(d);
        if (d.openT > d.autoShut && !near) d.setOpen(false);
      }
    }
  });
  // a steel leaf: painted, a wired window, a push bar on the pull side
  function steelLeaf(color) {
    const mat = K.skin("steel", color || 0x4f6f60);
    return function (g, w, h, dir) {
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(w - 0.04, h - 0.03, 0.06), mat); leaf.position.set(dir * w / 2, h / 2, 0); g.add(leaf);
      const win = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.62), K.skin("glass", 0x8a9a9a)); win.position.set(dir * (w / 2 + 0.2), 1.62, -0.04); win.rotation.y = Math.PI; g.add(win);
      const win2 = win.clone(); win2.position.z = 0.04; win2.rotation.y = 0; g.add(win2);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w - 0.3, 0.07, 0.07), galv); bar.position.set(dir * w / 2, 1.0, -0.08); g.add(bar);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.02), galv); plate.position.set(dir * (w / 2 + 0.25), 1.0, 0.04); g.add(plate);
    };
  }
  // a glazed leaf in a blue steel frame
  function glassLeaf(g, w, h, dir) {
    const steelBlue = K.skin("steel", 0x1f3a5f), glass = K.skin("glass");
    const fr = (x, y, sx, sy) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, 0.08), steelBlue); m.position.set(x, y, 0); g.add(m); };
    fr(dir * w / 2, 0.04, w, 0.08); fr(dir * w / 2, h - 0.04, w, 0.08); fr(dir * w / 2, h / 2 - 0.02, w, 0.06);
    fr(dir * 0.04, h / 2, 0.08, h); fr(dir * (w - 0.04), h / 2, 0.08, h);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.14, h - 0.14), glass); pane.position.set(dir * w / 2, h / 2, 0); g.add(pane);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w - 0.3, 0.05, 0.05), galv); bar.position.set(dir * w / 2, 1.02, 0.1); g.add(bar);
  }

  /* ==========================================================
     2. FINISHES.
     ========================================================== */
  // two bands of painted block over a rect (merged; no collider)
  function lining(x0, x1, z0, z1, h, band) {
    band = band || 1.2;
    if (x1 < x0) { const t = x0; x0 = x1; x1 = t; }
    if (z1 < z0) { const t = z0; z0 = z1; z1 = t; }
    const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    stat(new THREE.BoxGeometry(w, band, d), K.skin("block", K.toneUp(BLOCK_LOW)), cx, band / 2, cz, { uv: 1.6, cast: false });
    stat(new THREE.BoxGeometry(w, h - band, d), K.skin("block", K.toneUp(BLOCK_HIGH)), cx, band + (h - band) / 2, cz, { uv: 1.6, cast: false });
    stat(new THREE.BoxGeometry(w + 0.002, 0.03, d + 0.002), K.skin("steel", 0x4f6f60), cx, band, cz, { cast: false });
  }
  let exitTex = null;
  function exitSign(x, y, z, ry) {
    if (!exitTex) {
      const c = document.createElement("canvas"); c.width = 256; c.height = 96;
      const g = c.getContext("2d");
      g.fillStyle = "#151515"; g.fillRect(0, 0, 256, 96);
      g.fillStyle = "#ff2a1a"; g.font = "900 62px Arial, Helvetica, sans-serif";
      g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("EXIT", 128, 50);
      exitTex = new THREE.CanvasTexture(c);
    }
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.24, 0.07),
      new THREE.MeshLambertMaterial({ map: exitTex, emissive: 0xffffff, emissiveMap: exitTex, emissiveIntensity: 0.9 }));
    m.position.set(x, y, z); m.rotation.y = ry || 0; m.userData.sign = true;
    root().add(m);
    addBox(x, y + 0.2, z, 0.05, 0.16, 0.05, 0x3a4048, { cast: false });
    return m;
  }
  // a ceiling strip: housing + a lit tube, both merged (a corridor is lit 24 h)
  function strip(x, y, z, len, axis) {
    stat(new THREE.BoxGeometry(axis === "x" ? len : 0.2, 0.09, axis === "x" ? 0.2 : len), steelDark, x, y, z, { cast: false });
    stat(new THREE.BoxGeometry(axis === "x" ? len - 0.24 : 0.13, 0.05, axis === "x" ? 0.13 : len - 0.24), K.skin("lit"), x, y - 0.07, z, { cast: false });
  }
  /* An outdoor fitting on the flood circuit. It was a dark box with a second,
     UNROTATED 0.42 m glowing box stuck through its face (on an x-facing wall
     it poked 21 cm out sideways): at night, a floating white brick. It is
     the prison's one wall lamp now, CBZ.prisonDress.lamp — a cast bulkhead
     with a domed lens and a guard — on the flood schedule, its lit record 3 m
     out where the light lands. The sally ports are built from
     world/corridors.js, after world/cafeteria.js has published the kit. */
  function cagedLamp(x, y, z, face) {
    const PD = CBZ.prisonDress;
    if (PD && PD.lamp) {
      return PD.lamp(x, y, z, face, { w: 0.5, h: 0.32, tone: 0xfff4d2, emissive: 0xffd88a, r: 9, kind: "flood", reach: 3 });
    }
    stat(new THREE.BoxGeometry(0.5, 0.28, 0.16), steelDark, x, y, z, { ry: Math.atan2(face.x, face.z), cast: false });
    const lamp = addBox(x + face.x * 0.05, y, z + face.z * 0.05, 0.42, 0.2, 0.2, 0x2b2b2b, { cast: false });
    lamp.userData.mover = true;
    const rec = { x: x + face.x * 3, z: z + face.z * 3, r: 9, kind: "flood", mesh: lamp, color: 0xfff4d2, emissive: 0xffd88a, off: 0x2b2b2b };
    if (CBZ.prisonLights && CBZ.prisonLights.register) { try { CBZ.prisonLights.register(rec); } catch (e) {} }
    else (CBZ._prisonLateFixtures || (CBZ._prisonLateFixtures = [])).push(rec);
    return lamp;
  }

  /* ==========================================================
     3. THE SALLY PORT. cfg { id, x, z (the wall line), dir (+1: the way out
        is +z), gateKey, label, walkway (m of fenced approach, 0 = none),
        booth ("E"|"W"|null), altExit (register an alt win zone instead of
        being THE exit), signalHook }
        Local frame: the approach comes from -z, the wall line is z = 0,
        the way out is +z. `dir` -1 mirrors it.
     ========================================================== */
  function buildSallyPort(cfg) {
    const X = cfg.x, Z = cfg.z, D = cfg.dir || 1;
    const P = (lx, lz) => [X + lx, Z + lz * D];      // local -> world
    const BX = 5.2, IW = 4.6, H = 7, CH = 3.6, T = 0.6;
    const WALL = 0x9aa3ad;
    const glass = K.skin("glass");
    function wall(lx, y, lz, w, h, d, y0) {
      const p = P(lx, lz);
      const m = addBox(p[0], y, p[1], w, h, d, WALL, y0 != null ? { solid: true, blockLOS: true, y0: y0, y1: y + h / 2 } : { solid: true, blockLOS: true });
      if (m.userData.collider) m.userData.collider.noBreach = true;
      K.skinBox(m, "panel", WALL);
      return m;
    }
    const Z0 = -7, Z1 = 7;                            // local: the building's near and far faces
    wall(-BX + T / 2, H / 2, 0, T, H, Z1 - Z0);
    wall(BX - T / 2, H / 2, 0, T, H, Z1 - Z0);
    const DW = 2.5, OW = 1.4;
    wall((-BX - DW / 2) / 2, H / 2, Z0 + T / 2, BX - DW / 2, H, T);
    wall((BX + DW / 2) / 2, H / 2, Z0 + T / 2, BX - DW / 2, H, T);
    wall(0, 2.5 + (H - 2.5) / 2, Z0 + T / 2, DW, H - 2.5, T, 2.5);
    wall((-BX - OW / 2) / 2, H / 2, Z1 - T / 2, BX - OW / 2, H, T);
    wall((BX + OW / 2) / 2, H / 2, Z1 - T / 2, BX - OW / 2, H, T);
    wall(0, 2.35 + (H - 2.35) / 2, Z1 - T / 2, OW, H - 2.35, T, 2.35);
    const wz0 = Math.min(P(0, Z0)[1], P(0, Z1)[1]), wz1 = Math.max(P(0, Z0)[1], P(0, Z1)[1]);
    if (CBZ.prisonRoof) CBZ.prisonRoof({ id: cfg.id, x0: X - BX, x1: X + BX, z0: wz0, z1: wz1, top: H, over: 0.2, cast: true, plant: false });
    // the near face: upper windows, a gate number, a lamp, a camera
    const faceIn = { x: 0, z: -D };
    for (const wx of [-2.6, 0, 2.6]) {
      const p = P(wx, Z0 + 0.04), q = P(wx, Z0 - 0.03);
      stat(new THREE.BoxGeometry(1.5, 1.1, 0.12), steelDark, p[0], 5.3, p[1], { cast: false });
      stat(new THREE.PlaneGeometry(1.3, 0.9), glass, q[0], 5.3, q[1], { ry: D > 0 ? Math.PI : 0, cast: false });
    }
    const sp = P(0, Z0 - 0.02);
    K.sign(cfg.label || "GATE", sp[0], 3.0, sp[1], 0.9, 0.34, D > 0 ? Math.PI : 0, "#f3f3ef", "#1f3a5f");
    const lp = P(-2.2, Z0 - 0.06); cagedLamp(lp[0], 3.15, lp[1], faceIn);
    const cp = P(2.4, Z0 - 0.2), cq = P(2.4, Z0 - 0.3);
    stat(new THREE.BoxGeometry(0.18, 0.18, 0.34), steelDark, cp[0], 3.3, cp[1], { ry: -0.5 * D, rx: 0.4, cast: false });
    stat(new THREE.SphereGeometry(0.16, 10, 8), K.skin("glass", 0x202830), cq[0], 3.3, cq[1], { cast: false });
    // interior
    const IZ0 = Z0 + T, IZ1 = Z1 - T;
    const L = (lx0, lx1, lz0, lz1) => { const a = P(lx0, lz0), b = P(lx1, lz1); return [Math.min(a[0], b[0]), Math.max(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[1], b[1])]; };
    for (const r of [L(-IW - 0.08, -IW, IZ0, IZ1), L(IW, IW + 0.08, IZ0, IZ1), L(-IW, -DW / 2, IZ0, IZ0 + 0.08), L(DW / 2, IW, IZ0, IZ0 + 0.08), L(-IW, -OW / 2, IZ1 - 0.08, IZ1), L(OW / 2, IW, IZ1 - 0.08, IZ1)])
      lining(r[0], r[1], r[2], r[3], CH);
    const fr = L(-IW, IW, IZ0, IZ1);
    stat(new THREE.BoxGeometry(fr[1] - fr[0], 0.06, fr[3] - fr[2]), K.skin("polished", 0x9a9fa6), (fr[0] + fr[1]) / 2, 0.03, (fr[2] + fr[3]) / 2, { uv: 2, cast: false });
    K.skinBox(addBox((fr[0] + fr[1]) / 2, CH + 0.08, (fr[2] + fr[3]) / 2, fr[1] - fr[0], 0.16, fr[3] - fr[2], 0xdedbd2, { cast: false }), "concrete", 0xdedbd2);
    for (const lz of [IZ0 + 2.0, IZ0 + 4.6, 2.2, IZ1 - 1.6]) { const p = P(0, lz); strip(p[0], CH - 0.02, p[1], 3.6, "x"); }
    // the grille's jamb piers: block piers in the vestibule's own two-tone
    // paint (they were two full-height black steel slabs either side of it)
    for (const s of [-1, 1]) { const p = P(s * (IW - 0.3), 0); lining(p[0] - 0.375, p[0] + 0.375, p[1] - 0.625, p[1] + 0.625, CH); }
    CBZ.onUpdate(21.38, (function () { let done = false; return function () {
      if (done || !CBZ.prisonLights || !CBZ.prisonLights.rooms) return; done = true;
      CBZ.prisonLights.rooms.push({ id: cfg.id, x0: X - IW, x1: X + IW, z0: wz0, z1: wz1 });
    }; })());
    // the grille on the wall line
    const gate = grille({ id: cfg.id + "-grille", label: "The exit grille", axis: "x", a0: X - IW + 0.6, a1: X + IW - 0.6, fixedTo: X - 0.55, fixed: Z, h: CH - 0.05, keys: [cfg.gateKey || "Gate Key"], lb: 5 });
    if (cfg.signal && CBZ.exitSignal) { CBZ.exitSignal.register(gate.lamp); gate.lamp._exitSignal = true; }
    const es1 = P(0, -0.55), es2 = P(0, IZ1 - 0.35);
    exitSign(es1[0], 3.22, es1[1], D > 0 ? Math.PI : 0);
    exitSign(es2[0], 2.72, es2[1], D > 0 ? Math.PI : 0);
    const rp = P(-3.0, -0.42);
    K.sign("AUTHORIZED PERSONNEL ONLY\nBEYOND THIS POINT", rp[0], 2.05, rp[1], 1.3, 0.42, D > 0 ? Math.PI : 0, "#f3f3ef", "#b3261e");
    // the entry pair and the way out
    const ez = P(0, Z0 + T / 2)[1], oz = P(0, Z1 - T / 2)[1];
    door({ id: cfg.id + "-entry-w", label: "The sally port", axis: "x", a0: X - DW / 2, a1: X, fixed: ez, t: T, meet: true, h: 2.5, keys: null, hinge: -1, swing: -D, build: glassLeaf });
    door({ id: cfg.id + "-entry-e", label: "The sally port", axis: "x", a0: X, a1: X + DW / 2, fixed: ez, t: T, meet: true, h: 2.5, keys: null, hinge: 1, swing: -D, build: glassLeaf });
    door({ id: cfg.id + "-out", label: "The way out", axis: "x", a0: X - OW / 2, a1: X + OW / 2, fixed: oz, t: T, h: 2.35, keys: null, hinge: -1, swing: D, lb: 0, build: steelLeaf(0x4f6f60) });
    const stp = P(0, Z1 + 0.6);
    const step = addBox(stp[0], 0.08, stp[1], 2.4, 0.16, 1.2, 0x8f959c, { cast: false }); K.skinBox(step, "concrete", 0xa0a5aa);
    const olp = P(0, Z1 + 0.06); cagedLamp(olp[0], 2.9, olp[1], { x: 0, z: D });
    // the booth
    if (cfg.booth !== null) {
      const side = cfg.booth === "W" ? -1 : 1;
      const bx0 = side > 0 ? BX : -BX - 4.2, bx1 = side > 0 ? BX + 4.2 : -BX;
      const bz = L(0, 0, -5.4, -0.4);
      const B = { x0: X + bx0, x1: X + bx1, z0: bz[2], z1: bz[3], h: 3.4 };
      const doorSide = side > 0 ? "E" : "W";
      CBZ.roomShell({ x0: B.x0, x1: B.x1, z0: B.z0, z1: B.z1, h: B.h, wall: WALL, floor: 0x6a6f78, skin: "panel",
        doors: [{ side: doorSide, center: (B.z0 + B.z1) / 2, width: 1.2 }] });
      addBox(side > 0 ? B.x1 : B.x0, (2.3 + B.h) / 2, (B.z0 + B.z1) / 2, 0.5, B.h - 2.3, 1.2, WALL, { cast: false });
      if (CBZ.prisonRoof) CBZ.prisonRoof({ id: cfg.id + "-booth", x0: B.x0, x1: B.x1, z0: B.z0, z1: B.z1, top: B.h, over: 0.2, cast: true, plant: false });
      const wc = (B.z0 + B.z1) / 2, wl = 3.2, WY0 = 1.1, WY1 = 2.15;
      for (const face of [-1, 1]) {
        const px = X + side * (face < 0 ? IW - 0.005 : BX + 0.005);
        stat(new THREE.BoxGeometry(0.06, WY1 - WY0 + 0.16, wl + 0.16), steelDark, px, (WY0 + WY1) / 2, wc, { cast: false });
        stat(new THREE.PlaneGeometry(wl, WY1 - WY0), K.skin("glass", 0x2c3d4a), px + side * face * 0.04, (WY0 + WY1) / 2, wc, { ry: side * face < 0 ? -Math.PI / 2 : Math.PI / 2, cast: false });
      }
      stat(new THREE.BoxGeometry(0.02, 0.22, 0.34), galv, X + side * (IW - 0.06), 1.35, wc, { cast: false });
      const dx = X + side * (BX + 1.2);
      /* the officer's console: a steel counter on two end panels with a
         modesty panel between them (it was a slab on one grey block), and
         the chair its seat anchor always promised — the anchor was there
         with no chair drawn under it, so a body sat on air. */
      K.skinBox(addBox(dx, 0.74, wc, 0.7, 0.06, 2.6, 0x8a939d, { solid: true, y0: 0, y1: 0.77 }), "steel", 0x8a939d);
      for (const e of [-1, 1]) stat(new THREE.BoxGeometry(0.62, 0.71, 0.05), steelDark, dx, 0.355, wc + e * 1.22, { cast: false });
      stat(new THREE.BoxGeometry(0.03, 0.5, 2.4), steelDark, dx - side * 0.28, 0.42, wc, { cast: false });
      stat(new THREE.BoxGeometry(0.46, 0.02, 0.34), K.skin("steel", 0x24282d), dx + side * 0.08, 0.78, wc - 0.3, { cast: false });   // keyboard
      stat(new THREE.BoxGeometry(0.05, 0.36, 0.56), K.skin("steel", 0x1d2025), dx - side * 0.2, 1.0, wc - 0.3, { cast: false });    // monitor
      stat(new THREE.BoxGeometry(0.04, 0.2, 0.04), steelDark, dx - side * 0.2, 0.86, wc - 0.3, { cast: false });
      if (CBZ.furnish && typeof CBZ.furnish.chair === "function") {
        try { CBZ.furnish.chair(X + side * (BX + 2.0), 0, wc, side > 0 ? -Math.PI / 2 : Math.PI / 2, { tone: 0x2a2e34 }); } catch (e) {}
      }
      if (CBZ.roomSeatAnchor) { try { CBZ.roomSeatAnchor(X + side * (BX + 2.0), 0, wc, side > 0 ? -Math.PI / 2 : Math.PI / 2, "chair", null, { cushion: 0.46, floorBelow: 0 }); } catch (e) {} }
      const KBX = X + side * (BX + 2.4), KBZ = D > 0 ? B.z0 + 0.3 : B.z1 - 0.3;
      addBox(KBX, 1.55, KBZ, 0.9, 0.7, 0.06, 0x6a563c, { cast: false });
      for (let i = 0; i < 6; i++) addBox(KBX - 0.32 + i * 0.13, 1.72 - (i % 2) * 0.22, KBZ + 0.04 * D, 0.02, 0.05, 0.02, 0x8b95a1, { cast: false });
      const keyAt = [cfg.gateKey || "Gate Key", KBX + 0.1, 1.42, KBZ + 0.08 * D];
      if (CBZ.prisonPlaceItem) { try { CBZ.prisonPlaceItem.apply(null, keyAt); } catch (e) {} }
      else (CBZ._prisonLateItems || (CBZ._prisonLateItems = [])).push(keyAt);
      strip(X + side * (BX + 2.1), B.h - 0.02, wc, 2.2, "z");
      door({ id: cfg.id + "-booth", label: "The gate booth", axis: "z", fixed: side > 0 ? B.x1 : B.x0, a0: wc - 0.6, a1: wc + 0.6, t: 0.5, h: 2.3, keys: ["Keycard"], lb: 5, hinge: -1, swing: side, build: steelLeaf(0x4f6f60) });
      K.sign("AUTHORIZED\nPERSONNEL ONLY", (side > 0 ? B.x1 : B.x0) + side * 0.28, 2.6, wc, 0.9, 0.42, side > 0 ? Math.PI / 2 : -Math.PI / 2, "#f3f3ef", "#b3261e");
    }
    // the walkway
    if (cfg.walkway) {
      const WX = 4.7, a = P(0, Z0 + 0.1)[1], b = P(0, Z0 - cfg.walkway)[1];
      CBZ.prisonFence({ x0: X - WX, z0: Math.min(a, b), x1: X - WX, z1: Math.max(a, b), h: 3.6 });
      CBZ.prisonFence({ x0: X + WX, z0: Math.min(a, b), x1: X + WX, z1: Math.max(a, b), h: 3.6 });
      K.program(cfg.id + "-walkway", X - WX, X + WX, Math.min(a, b), Math.max(a, b));
    }
    K.program(cfg.id, X - BX, X + BX, wz0, wz1);
    // the win: THE exit, or an alternative one
    const win = P(0, 5);
    if (cfg.altExit) (CBZ.altExitZones || (CBZ.altExitZones = [])).push({ x: win[0], z: win[1], r: 2.2, name: cfg.id });
    return { gate: gate, win: { x: win[0], z: win[1] } };
  }

  CBZ.corridorKit = { grille, door, doorSet, lining, exitSign, strip, cagedLamp, keyTest, steelLeaf, glassLeaf, doors };
  CBZ.buildSallyPort = buildSallyPort;
})();
