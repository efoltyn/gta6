/* ============================================================
   world/corridorkit.js — THE PRISON'S ONE DOOR KIT, and the pieces a
   prison corridor is made of.

   OWNER (2026-09-29): "near where the warden is, there's some really
   realistic doors ... these old doors that are like bar doors ... make
   those doors realistic, like the ones near the warden; they can all be
   normal doors ... every jail just has many, many sets of those real
   doors." And: "if you want to keep the bar-style doors in any places,
   you need to remake them so they look correct and animate and work
   correctly."

   WHAT A REAL JAIL HANGS (research, 2026-09-29; sources in the commit):
     · Detention-grade HOLLOW-METAL steel doors in heavy steel frames, a
       narrow security-glass VISION LITE, a paracentric lock in a surface
       lock case, a pull, a kick plate; card readers / key switches and
       door-position lamps on the frame, intercoms beside them, and the
       doors released remotely from control. That is what stands between
       every two zones: corridors, units, rooms, the armory.
     · SALLY PORTS: a vestibule with two of those doors, INTERLOCKED so
       only one opens at a time. A housing unit's entrance is one.
     · BARS survive where the building is old and LINEAR: barred cell
       fronts on a tiered cell house (the owner's own reference photo),
       and wire/bar cages inside a room (a tool crib, a property cage, a
       weapons cage). Not as corridor gates in a modern build.

   So this file is:
     CBZ.corridorKit.doorSet(cfg)       a frame that wraps the wall, stops,
                                        architraves, hinges, the leaves
     CBZ.corridorKit.detentionLeaf(o)   THE steel door leaf (the warden
                                        area's door, grown up: vision lite,
                                        lock case, pull, kick plates)
     CBZ.corridorKit.steelLeaf(color)   = detentionLeaf({ color }) (the old
                                        name every caller already used)
     CBZ.corridorKit.barLeaf(o)         THE barred leaf, remade: round bars
                                        at 125 mm, flat straps, channel
                                        frame, a lock box; casts shadow
     CBZ.corridorKit.BARS               the bar spec cell fronts share
     CBZ.corridorKit.door(cfg)          a working door (single or PAIR):
                                        keys, C4 row, auto-shut, staff open
                                        it, the shared door registry
     CBZ.corridorKit.crossDoor(cfg)     a partition across an opening with
                                        a steel PAIR in it (corridor doors,
                                        a sally port's inner door)
     CBZ.corridorKit.infill(cfg)        the solid wall either side of a door
     CBZ.corridorKit.cardReader(...)    reader + LED on a wall face
     CBZ.corridorKit.intercom(...)      a call station on a wall face
     CBZ.corridorKit.lining/exitSign/strip/cagedLamp   finishes
     CBZ.buildSallyPort(cfg)            the exit building

   KEYS ARE FEW. A door takes ONE ring — the Corridor Key or the Gate Key
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
  const BLOCK_LOW = 0x7d9787, BLOCK_HIGH = 0xe4e0d4;

  /* ==========================================================
     0. THE LEAVES. Built in the leaf's own frame: from the hinge edge
        along +dir x, floor at y 0, centred on z 0, LT thick. Everything
        on a leaf is ONE merged vertex-coloured mesh (a leaf is a mover,
        core/batch.js never merges under one, so a door of forty parts
        would be forty live draws).
     ========================================================== */
  const LT = 0.05;
  let VC = null;
  function vcMat() {
    if (!VC) VC = new THREE.MeshLambertMaterial({ vertexColors: true });
    return VC;
  }
  function Paint() { this.g = []; }
  Paint.prototype.add = function (g, color) {
    if (g.index) { const t = g.toNonIndexed(); g.dispose(); g = t; }
    for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal") g.deleteAttribute(k);
    const n = g.attributes.position.count, c = new THREE.Color(color), a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute("color", new THREE.BufferAttribute(a, 3));
    this.g.push(g);
    return this;
  };
  Paint.prototype.box = function (x, y, z, w, h, d, color) {
    return this.add(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);
  };
  // an upright round bar (or a round boss when rx turns it to face z)
  Paint.prototype.cyl = function (x, y, z, r, h, color, seg, rx) {
    const g = new THREE.CylinderGeometry(r, r, h, seg || 8, 1, false);
    if (rx) g.rotateX(rx);
    return this.add(g.translate(x, y, z), color);
  };
  Paint.prototype.mesh = function (parent, cast) {
    const BGU = THREE.BufferGeometryUtils;
    if (!this.g.length) return null;
    const geo = this.g.length === 1 ? this.g[0]
      : (BGU && BGU.mergeBufferGeometries ? BGU.mergeBufferGeometries(this.g, false) : null);
    if (!geo) return null;
    if (this.g.length > 1) for (const q of this.g) q.dispose();
    this.g = [];
    const m = new THREE.Mesh(geo, vcMat());
    m.castShadow = cast !== false; m.receiveShadow = true;
    if (parent) parent.add(m);
    return m;
  };
  function ledMesh(r) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r || 0.01, r || 0.01, 0.006, 12).rotateX(Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0xff3b3b, emissive: 0xff0000, emissiveIntensity: 1.0 }));
    m.userData.dynamic = true;
    return m;
  }

  /* THE DETENTION DOOR. The warden's staff door was the one leaf in the
     compound a visitor would believe; this is it, finished the way a
     detention hollow-metal door is actually made:
       - a 50 mm steel slab, one colour, no panels (panels are for offices)
       - a NARROW vision lite at the lock side, eye height, security glass
         in a welded glazing stop on both faces (100-200 mm wide in the
         trade; 200 x 620 here), not a window
       - a surface lock case on the secure face, the key cylinder rose on
         the other, a welded steel D-pull on both (no lever: a lever is a
         ligature point, which is why detention doors do not carry one)
       - stainless kick plates both faces
     opts { color, lite (default true), hold, lockOn (the leaf index that
     carries the status LED), led (y) } */
  function detentionLeaf(opts) {
    opts = opts || {};
    const C = opts.color != null ? opts.color : 0x4f5d6b;
    const STOP = 0x363f49, KICK = 0xa7adb3, HW = 0x9aa2aa, CASE = 0x2a3038;
    const glass = K.skin("glass", 0xa9bcc4);
    return function (g, w, h, dir, i) {
      const P = new Paint(), xs = function (u) { return dir * u; };
      const lite = opts.lite !== false && w >= 0.7;
      const vw = Math.min(0.2, w * 0.2), vx1 = w - 0.26, vx0 = vx1 - vw;
      const vy0 = 1.3, vy1 = Math.min(h - 0.3, vy0 + 0.62);
      if (lite) {
        P.box(xs(vx0 / 2), h / 2, 0, vx0, h, LT, C);                                   // hinge side
        P.box(xs((vx1 + w) / 2), h / 2, 0, w - vx1, h, LT, C);                          // lock side
        P.box(xs((vx0 + vx1) / 2), vy0 / 2, 0, vw, vy0, LT, C);                          // under the lite
        P.box(xs((vx0 + vx1) / 2), (vy1 + h) / 2, 0, vw, h - vy1, LT, C);                // over it
      } else P.box(xs(w / 2), h / 2, 0, w, h, LT, C);
      for (const f of [-1, 1]) {
        P.box(xs(w / 2), 0.16, f * (LT / 2 + 0.001), w - 0.05, 0.28, 0.002, KICK);        // kick plate
        if (lite) {                                                                       // the glazing stop
          const sz = f * (LT / 2 + 0.006), sw = 0.025;
          P.box(xs((vx0 + vx1) / 2), vy0 - sw / 2, sz, vw + 2 * sw, sw, 0.012, STOP);
          P.box(xs((vx0 + vx1) / 2), vy1 + sw / 2, sz, vw + 2 * sw, sw, 0.012, STOP);
          P.box(xs(vx0 - sw / 2), (vy0 + vy1) / 2, sz, sw, vy1 - vy0, 0.012, STOP);
          P.box(xs(vx1 + sw / 2), (vy0 + vy1) / 2, sz, sw, vy1 - vy0, 0.012, STOP);
        }
        // the welded D-pull: a 25 mm grip on two standoffs, lock stile
        const px = xs(w - 0.085), pz = f * (LT / 2 + 0.045);
        P.cyl(px, 1.02, pz, 0.0125, 0.26, HW, 10);
        P.box(px, 1.13, f * (LT / 2 + 0.022), 0.02, 0.02, 0.045, HW);
        P.box(px, 0.91, f * (LT / 2 + 0.022), 0.02, 0.02, 0.045, HW);
      }
      // a FOOD / CUFF PASS (a cell door's): a welded frame through the leaf
      // at waist height, its flap shut and padlock-tabbed, both faces
      if (opts.pass) {
        for (const f of [-1, 1]) {
          const fz = f * (LT / 2 + 0.012);
          P.box(xs(w / 2 - 0.05), 1.02, fz, 0.42, 0.2, 0.024, STOP);
          P.box(xs(w / 2 - 0.05), 1.02, f * (LT / 2 + 0.026), 0.36, 0.14, 0.006, C);
        }
        P.box(xs(w / 2 - 0.05), 0.935, LT / 2 + 0.03, 0.34, 0.018, 0.018, HW);           // the flap hinge
        P.box(xs(w / 2 + 0.13), 1.06, LT / 2 + 0.035, 0.03, 0.05, 0.02, HW);
      }
      // the lock: surface case on +z, the key cylinder rose on -z
      P.box(xs(w - 0.085), 1.36, LT / 2 + 0.016, 0.1, 0.24, 0.032, CASE);
      P.cyl(xs(w - 0.085), 1.42, LT / 2 + 0.034, 0.016, 0.006, HW, 12, Math.PI / 2);
      P.cyl(xs(w - 0.085), 1.36, -(LT / 2 + 0.004), 0.02, 0.008, HW, 12, Math.PI / 2);
      const slab = P.mesh(g, true);
      if (slab) slab.userData.doorLeaf = "steel";
      if (lite) {
        const pane = new THREE.Mesh(new THREE.BoxGeometry(vw, vy1 - vy0, 0.008), glass);
        pane.position.set(xs((vx0 + vx1) / 2), (vy0 + vy1) / 2, 0);
        g.add(pane);
      }
      if (opts.hold && opts.lockOn === i) {
        const lamp = ledMesh(0.009);
        lamp.position.set(xs(w - 0.085), 1.3, LT / 2 + 0.034);
        g.add(lamp);
        opts.hold.lamp = lamp;
      }
      return slab;
    };
  }
  function steelLeaf(color) { return detentionLeaf({ color: color }); }

  /* THE BARRED LEAF, REMADE. The old ones were square 9 cm sticks at 36-45
     cm (a head goes through 42 cm) with no straps, a cube for a lock, and
     no shadow. A real barred door: 25 mm round bars at 125 mm centres run
     through flat straps (64 x 16) every half metre, in a channel frame,
     with a lock box on the lock stile. ONE spec, shared by the cell fronts
     (world/cellblock.js) so every bar in the prison is the same bar. */
  const BARS = { r: 0.0125, pitch: 0.125, strap: 0.064, strapT: 0.016, strapEvery: 0.52, color: 0x2a2f38 };
  function barLeaf(opts) {
    opts = opts || {};
    const C = opts.color != null ? opts.color : BARS.color;
    return function (g, w, h, dir, i) {
      const P = new Paint(), xs = function (u) { return dir * u; };
      const FW = 0.07, FD = 0.06;
      P.box(xs(FW / 2), h / 2, 0, FW, h, FD, C);                          // hinge stile
      P.box(xs(w - FW / 2), h / 2, 0, FW, h, FD, C);                      // lock stile
      P.box(xs(w / 2), 0.05, 0, w - 2 * FW, 0.1, FD, C);                   // bottom channel
      P.box(xs(w / 2), h - 0.05, 0, w - 2 * FW, 0.1, FD, C);               // top channel
      const n = Math.max(2, Math.round((w - 2 * FW) / BARS.pitch));
      for (let k = 1; k < n; k++) P.cyl(xs(FW + k * (w - 2 * FW) / n), h / 2, 0, BARS.r, h - 0.2, C, 8);
      const ns = Math.max(1, Math.round((h - 0.2) / BARS.strapEvery));
      for (let k = 1; k < ns; k++) P.box(xs(w / 2), 0.1 + k * (h - 0.2) / ns, 0, w - 2 * FW, BARS.strap, BARS.strapT, C);
      // the lock box on the lock stile, a keyway on each face
      P.box(xs(w - 0.1), 1.08, 0, 0.16, 0.34, 0.1, 0x21262e);
      for (const f of [-1, 1]) P.cyl(xs(w - 0.1), 1.14, f * 0.052, 0.014, 0.006, 0x9aa2aa, 10, Math.PI / 2);
      const m = P.mesh(g, true);
      if (m) m.userData.doorLeaf = "bars";
      if (opts.hold && opts.lockOn === i) {
        const lamp = ledMesh(0.01);
        lamp.position.set(xs(w - 0.1), 1.2, 0.053);
        g.add(lamp);
        opts.hold.lamp = lamp;
      }
      return m;
    };
  }
  // a glazed leaf in a blue steel frame (the chapel and visits doors: a
  // normal building door, not a security door)
  function glassLeaf(g, w, h, dir) {
    const steelBlue = K.skin("steel", 0x1f3a5f), glass = K.skin("glass");
    const fr = (x, y, sx, sy) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, 0.08), steelBlue); m.position.set(x, y, 0); g.add(m); };
    fr(dir * w / 2, 0.04, w, 0.08); fr(dir * w / 2, h - 0.04, w, 0.08); fr(dir * w / 2, h / 2 - 0.02, w, 0.06);
    fr(dir * 0.04, h / 2, 0.08, h); fr(dir * (w - 0.04), h / 2, 0.08, h);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.14, h - 0.14), glass); pane.position.set(dir * w / 2, h / 2, 0); g.add(pane);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w - 0.3, 0.05, 0.05), galv); bar.position.set(dir * w / 2, 1.02, 0.1); g.add(bar);
  }

  /* ==========================================================
     1. ON THE WALL BESIDE A DOOR. (x, y, z) is the WALL FACE; (nx, nz) the
        way it faces. Static parts are plain addBox; the LED keeps its own
        material, because interactions and the doors recolour it.
     ========================================================== */
  function onFace(x, y, z, nx, nz, w, h, d, off, color, skin) {
    const ax = Math.abs(nx) > 0.5;
    const m = addBox(x + nx * (off + d / 2), y, z + nz * (off + d / 2), ax ? d : w, h, ax ? w : d, color, { cast: false });
    if (skin) K.skinBox(m, skin, color);
    return m;
  }
  function cardReader(x, y, z, nx, nz) {
    onFace(x, y, z, nx, nz, 0.1, 0.17, 0.012, 0, 0xaeb7c0, "galv");            // back plate
    const body = onFace(x, y, z, nx, nz, 0.084, 0.145, 0.03, 0.012, 0x1b1e22);
    body.material = K.skin("steel", 0x1b1e22, 0.5);
    onFace(x, y - 0.02, z, nx, nz, 0.06, 0.07, 0.002, 0.042, 0x2c3138);        // read pad
    const led = ledMesh(0.012);
    led.rotation.y = Math.atan2(nx, nz);
    led.position.set(x + nx * 0.045, y + 0.045, z + nz * 0.045);
    root().add(led);
    return {
      led: led, body: body,
      readerPos: { x: led.position.x, y: led.position.y, z: led.position.z },
      padPos: { x: x + nx * 0.0435, y: y - 0.02, z: z + nz * 0.0435 },
      padN: { x: nx, y: 0, z: nz },
    };
  }
  // a stainless call station: speaker grille, call button, a camera dome
  // over it is the caller's business
  function intercom(x, y, z, nx, nz) {
    onFace(x, y, z, nx, nz, 0.14, 0.22, 0.014, 0, 0xb4bcc4, "galv");
    for (let k = 0; k < 4; k++) onFace(x, y + 0.05 - k * 0.022, z, nx, nz, 0.08, 0.006, 0.003, 0.014, 0x2a2f36);
    onFace(x, y - 0.07, z, nx, nz, 0.03, 0.03, 0.01, 0.014, 0x1c6fd1);
  }

  /* THE WALL EITHER SIDE OF A DOOR. A 2.4 m pair does not fill a 4.5 m
     corridor or a 6 m gate gap, and a leaf wider than 1.2 m is not a door.
     infill cfg { axis "x" (wall along x at z = fixed) | "z", a0, a1 (the
     whole opening), c0, c1 (the door's rough opening inside it), fixed, t,
     top (full height), head (door head), color, skin, bands (two-tone block
     paint, the corridors' finish) }. The piers are solid to their full
     height; the head over the door is LOS-only (actors are 2-D boxes: a
     solid lintel would seal the doorway for every body). */
  function infill(cfg) {
    const along = cfg.axis === "z", f = cfg.fixed, t = cfg.t || 0.3, top = cfg.top || 3.6;
    const color = cfg.color != null ? cfg.color : BLOCK_HIGH, skin = cfg.skin === undefined ? "block" : cfg.skin;
    const piece = function (p0, p1, y0, y1, solid) {
      if (p1 - p0 < 0.02 || y1 - y0 < 0.02) return null;
      const c = (p0 + p1) / 2, hgt = y1 - y0;
      const m = along ? addBox(f, y0 + hgt / 2, c, t, hgt, p1 - p0, color, { solid: solid, blockLOS: true, cast: true })
        : addBox(c, y0 + hgt / 2, f, p1 - p0, hgt, t, color, { solid: solid, blockLOS: true, cast: true });
      if (m.userData.collider) m.userData.collider.noBreach = true;
      if (skin) K.skinBox(m, skin, color);
      if (cfg.bands) {
        // the dado band and its rail, on both faces (corridor paint)
        const bh = Math.min(1.2, y1) - y0;
        if (bh > 0.02) for (const s of [-1, 1]) {
          const o = s * (t / 2 + 0.006);
          if (along) {
            stat(new THREE.BoxGeometry(0.012, bh, p1 - p0), K.skin("block", K.toneUp(BLOCK_LOW)), f + o, y0 + bh / 2, c, { uv: 1.6, cast: false });
            stat(new THREE.BoxGeometry(0.016, 0.03, p1 - p0), K.skin("steel", 0x4f6f60), f + o, 1.2, c, { cast: false });
          } else {
            stat(new THREE.BoxGeometry(p1 - p0, bh, 0.012), K.skin("block", K.toneUp(BLOCK_LOW)), c, y0 + bh / 2, f + o, { uv: 1.6, cast: false });
            stat(new THREE.BoxGeometry(p1 - p0, 0.03, 0.016), K.skin("steel", 0x4f6f60), c, 1.2, f + o, { cast: false });
          }
        }
      }
      return m;
    };
    piece(cfg.a0, cfg.c0, 0, top, true);
    piece(cfg.c1, cfg.a1, 0, top, true);
    if (cfg.head != null && top > cfg.head) piece(cfg.c0, cfg.c1, cfg.head, top, false);
  }

  /* ==========================================================
     2. THE DOOR SET. A leaf in a hole is not a door (owner, 2026-09-28: "look
     at how stupid the opening to the warden's room is ... his door doesn't
     have physics"). A real door set is a frame that wraps the opening (two
     jambs and a head, the full depth of the wall), a stop the leaf closes
     against, an architrave on both faces that covers the joint with the
     wall, and a leaf hung on three hinges at the FACE of the frame on the
     side it opens to, so it swings clear of the jamb and stops square to
     the wall.

     cfg: { axis "x" (wall along x, plane z = fixed) | "z" (plane x = fixed),
            a0, a1        the rough opening along the wall
            t             wall thickness (the frame wraps all of it)
            h             head height; y0 the finished floor the leaf clears
            open          +1 | -1: which side of the wall the leaf swings to,
                          in LOCAL z (axis x: world z; axis z: world -x)
            hinge         -1 hung at a0, +1 at a1, 0 = a PAIR meeting mid-span
            meet          this set is one half of a pair drawn as two sets:
                          no jamb or stop on the free side
            build(g, w, h, dir, i)  draws leaf i from its hinge edge along
                          +dir x, centred on g's z = 0, LT thick
            frame         frame colour; max  fraction of 90 deg it opens }
     -> { leaves: [{ pivot, base, swing, slab }], set(t 0..1), clear }     */
  const JW = 0.05, AW = 0.075, AP = 0.025;
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
      const pz = open * (t / 2);
      const pivot = new THREE.Group(); pivot.userData.mover = true;
      const p = W(hx, pz);
      pivot.position.set(p[0], 0, p[1]);
      pivot.rotation.y = ry;
      const g = new THREE.Group();
      g.position.set(0, y0 + 0.008, -open * LT / 2);
      pivot.add(g);
      const slab = cfg.build(g, s[2] - s[1] - 0.004, lh, dir, leaves.length) || null;
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

  /* ==========================================================
     3. WORKING DOORS. One registry contract (systems/interactions.js), a
        single leaf or a PAIR, either axis.
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
  /* A LEAF IS SOLID UNTIL IT HAS PHYSICALLY MOVED OUT OF THE WAY (owner,
     2026-09-28: "you don't actually open it up. You just walk straight
     through it"). An opening leaf keeps its collider until it has swung 40%
     clear; a closing one is solid again at once — unless a body is standing
     in the doorway, in which case the leaf waits for him (a closer does not
     crush a man into the frame, and a box that appears around him would). */
  function colIn(d) { return CBZ.colliders.indexOf(d.collider) >= 0; }
  function colAdd(d) {
    if (colIn(d)) return;
    CBZ.colliders.push(d.collider);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }
  function colDrop(d) {
    const i = CBZ.colliders.indexOf(d.collider);
    if (i < 0) return;
    CBZ.colliders.splice(i, 1);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }
  // a shut steel leaf blocks sight; a barred one never did
  function losSet(d, on) {
    const L = CBZ.losBlockers;
    if (!L || !d.slabs) return;
    for (const s of d.slabs) {
      const i = L.indexOf(s);
      if (on && i < 0) L.push(s);
      else if (!on && i >= 0) L.splice(i, 1);
    }
  }
  const BODY_R = 0.42;
  function bodyIn(d) {
    const c = d.collider;
    const hit = function (p) {
      return !!p && p.x > c.minX - BODY_R && p.x < c.maxX + BODY_R && p.z > c.minZ - BODY_R && p.z < c.maxZ + BODY_R;
    };
    if (hit(CBZ.player && CBZ.player.pos)) return true;
    const lists = [CBZ.guards, CBZ.npcs];
    for (let L = 0; L < lists.length; L++) {
      const list = lists[L] || [];
      for (let i = 0; i < list.length; i++) {
        const n = list[i];
        if (!n || n.dead || n._crowd || !n.group) continue;
        const p = n.group.position;
        if (Math.abs(p.x - d.x) > 4 || Math.abs(p.z - d.z) > 4) continue;
        if (hit(p)) return true;
      }
    }
    return false;
  }
  function lampTo(d, v) {
    if (d.lamp && !d.lamp._exitSignal) {
      d.lamp.color.setHex(v ? 0x39ff88 : 0xff3b3b);
      d.lamp.emissive.setHex(v ? 0x14c258 : 0xff0000);
    }
  }
  // an interlocked leaf (a sally port's out door) may open only while the
  // inner door behind it is home and shut, or gone
  function interlockClear(d) {
    const q = d.interlock;
    return !q || q.blown || (!q.open && q.t <= 0.001);
  }
  function registerDoor(d, cfg) {
    d.open = false; d.t = 0; d.openT = 0; d.blown = false; d.keys = cfg.keys || null;
    d.pending = false;
    colAdd(d); losSet(d, true);
    d.setOpen = function (v, quiet) {
      v = !!v;
      if (v === d.open) { if (!v) d.pending = false; return v; }
      if (v && !d.blown && !interlockClear(d)) {
        // THE INTERLOCK: the out door will not release while the inner door
        // is open. Pushing it cycles the port: the inner door swings home
        // first, the buzzer sounds, and this one releases once it is shut.
        if (!d.pending && !quiet) buzz(d.x, d.z);
        d.pending = true;
        if (d.interlock.open) d.interlock.setOpen(false, false);
        return d.open;
      }
      d.pending = false;
      d.open = v; d.openT = 0;
      // a closing leaf is solid again at once (the tick holds it for a body
      // in the doorway); an opening one keeps its collider until it clears
      if (!v && !bodyIn(d)) colAdd(d);
      if (!v) losSet(d, true);
      else if (d.blown) { colDrop(d); losSet(d, false); }
      lampTo(d, v);
      if (!quiet && CBZ.worldSfx) CBZ.worldSfx(v ? "door_open" : "door_close", d.x, d.z, { ref: 10 });
      if (v && !quiet && d.alarm && d._by === "player") portAlarm(d);
      return v;
    };
    if (CBZ.registerBreachTarget && cfg.lb) {
      CBZ.registerBreachTarget({
        id: cfg.id, lb: cfg.lb, reach: 2.6,
        at: function () { return { x: d.x, y: 1.4, z: d.z }; },
        done: function () { return d.open; },
        defeat: function () {
          d.blown = true; d.setOpen(true); colDrop(d); losSet(d, false);
          for (const p of d.pivots) p.visible = false;
          if (d.alarm) portAlarm(d);
        },
      });
    }
    (CBZ._prisonDoorSpecs || (CBZ._prisonDoorSpecs = [])).push({
      id: cfg.id, label: cfg.label, autoR: 2.5, openByTap: true,
      keyed: !!(cfg.keys && cfg.keys.length),   // needs a card (systems/prisondoorwatch.js)
      at: function () { return { x: d.x, y: 1.4, z: d.z }; },
      pick: function () { return d.pivots; },
      col: function () { return d.collider; },
      isOpen: function () { return !!d.open; },
      permanent: function () { return !!d.blown; },
      canUse: keyTest(cfg.keys),
      // the player's own hand on it (systems/interactions.js doorAct)
      set: function (v) { d._by = "player"; d.setOpen(v); d._by = null; return d.open === !!v; },
    });
    doors.push(d);
    return d;
  }
  /* THE PORT WAKES UP. A sally port's inner door opened by an inmate (the
     Gate Key in its lock, or a charge) shows on the booth console the moment
     it moves: the klaxon sounds from the port, the heat jumps and every screw
     within earshot is sent to the gate. Nothing is printed; the prison reacts. */
  function portAlarm(d) {
    const g = CBZ.game;
    if (!g || g.mode !== "escape" || g.role === "cop" || g.state !== "playing") return;
    if (CBZ.worldSfx) CBZ.worldSfx("lockdown", d.x, d.z, { ref: 30, volume: 0.9, gap: 2 });
    if (CBZ.reportCrime) { try { CBZ.reportCrime(45, { type: "escape" }); } catch (e) {} }
    if (CBZ.addHeat) { try { CBZ.addHeat(30); } catch (e) {} }
    if (CBZ.guardHear) { try { CBZ.guardHear(d.x, d.z, 60, { type: "alarm", player: true }); } catch (e) {} }
  }
  /* The out door's buzzer: a short square-wave rasp on the sfx bus (the
     same door into the mix every synthesised voice uses). */
  function buzz(x, z) {
    const ctx = CBZ.getAudioCtx && CBZ.getAudioCtx(), bus = CBZ.audioSfxBus && CBZ.audioSfxBus();
    const P = CBZ.player && CBZ.player.pos;
    if (!ctx || !bus || !P) return;
    const dd = Math.hypot(P.x - x, P.z - z), near = 1 / (1 + (dd / 8) * (dd / 8));
    if (near < 0.05) return;
    try {
      const t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = "square"; o.frequency.value = 118;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900;
      const gn = ctx.createGain(); gn.gain.setValueAtTime(0, t);
      gn.gain.linearRampToValueAtTime(0.07 * near, t + 0.02);
      gn.gain.setValueAtTime(0.07 * near, t + 0.42);
      gn.gain.linearRampToValueAtTime(0, t + 0.48);
      o.connect(lp); lp.connect(gn); gn.connect(bus);
      o.start(t); o.stop(t + 0.5);
    } catch (e) {}
  }
  /* A door-position lamp over the head, both faces: what control sees on
     the console, and what a man in the corridor sees go green. One
     material for both lenses. */
  function headLamp(cfg, h, t) {
    const along = cfg.axis === "z", mid = (cfg.a0 + cfg.a1) / 2, y = h + AW + 0.09;
    const mat = new THREE.MeshLambertMaterial({ color: 0xff3b3b, emissive: 0xff0000, emissiveIntensity: 1.0 });
    for (const s of [-1, 1]) {
      const off = s * (t / 2 + AP + 0.02);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 14).rotateX(Math.PI / 2), mat);
      if (along) { m.rotation.y = Math.PI / 2; m.position.set(cfg.fixed + off, y, mid); }
      else m.position.set(mid, y, cfg.fixed + off);
      m.userData.dynamic = true;
      root().add(m);
      const b = along ? addBox(cfg.fixed + s * (t / 2 + AP + 0.01), y, mid, 0.02, 0.1, 0.1, 0x2a2f36, { cast: false })
        : addBox(mid, y, cfg.fixed + s * (t / 2 + AP + 0.01), 0.1, 0.1, 0.02, 0x2a2f36, { cast: false });
      b.userData.dynamic = true;
    }
    return mat;
  }
  /* cfg: { id, label, axis, a0, a1, fixed, t, h, y0, keys, lb, alarm,
            swing, hinge (-1 at a0, +1 at a1, 0 a PAIR), meet,
            build(group, w, h, dir, i), frame, lamp, autoShut, staffR,
            reader (a card reader each face: default when keys hold the
            Keycard) }
     `swing` keeps its historic meaning in the LOCAL frame: the leaf goes to
     local z = -swing (for axis "x" that is world -z at swing +1; for axis
     "z", world +x). The door set hangs it on that face. */
  function door(cfg) {
    const along = cfg.axis === "z";
    const a0 = cfg.a0, a1 = cfg.a1, fixed = cfg.fixed, t = cfg.t || 0.3, h = cfg.h || 2.3;
    const hinge = cfg.hinge === 0 ? 0 : (cfg.hinge < 0 ? -1 : 1);
    const set = doorSet({ axis: cfg.axis, a0: a0, a1: a1, fixed: fixed, t: t, h: h, y0: cfg.y0,
      open: -(cfg.swing || 1), hinge: hinge, meet: cfg.meet, build: cfg.build || detentionLeaf(), frame: cfg.frame });
    const L = set.leaves[0];
    const d = {
      id: cfg.id, x: along ? fixed : (a0 + a1) / 2, z: along ? (a0 + a1) / 2 : fixed,
      group: L.pivot, pivots: set.leaves.map(function (q) { return q.pivot; }), set: set, kind: "swing",
      slabs: set.leaves.map(function (q) { return q.slab; }).filter(Boolean),
      collider: along ? { minX: fixed - t / 2, maxX: fixed + t / 2, minZ: a0, maxZ: a1, ref: L.pivot }
        : { minX: a0, maxX: a1, minZ: fixed - t / 2, maxZ: fixed + t / 2, ref: L.pivot },
      autoShut: cfg.autoShut != null ? cfg.autoShut : 4,
      staffR: cfg.staffR || 2.4, alarm: !!cfg.alarm,
    };
    const keyed = !!(cfg.keys && cfg.keys.length);
    if (cfg.lamp) d.lamp = cfg.lamp;
    else if (keyed && cfg.headLamp !== false) d.lamp = headLamp(cfg, h, t);
    const wantReader = cfg.reader != null ? cfg.reader : (keyed && cfg.keys.indexOf("Keycard") >= 0);
    if (wantReader) {
      // on the lock jamb's side, clear of the architrave, both faces
      const lx = (hinge > 0 ? a0 - 0.28 : a1 + 0.28);
      for (const s of [-1, 1]) {
        const off = s * (t / 2);
        if (along) cardReader(fixed + off, 1.2, lx, s, 0);
        else cardReader(lx, 1.2, fixed + off, 0, s);
      }
    }
    return registerDoor(d, cfg);
  }
  /* A PARTITION ACROSS AN OPENING WITH A STEEL PAIR IN IT: the corridor
     doors and a sally port's inner door. cfg { id, label, axis, a0, a1 (the
     opening to close), fixed, t, top, head, clear (door width, <= 2.4),
     keys, lb, alarm, swing, color, staffR, autoShut, bands, skin, wall } */
  function crossDoor(cfg) {
    const mid = (cfg.a0 + cfg.a1) / 2, cw = Math.min(cfg.clear || 2.2, 2.4, cfg.a1 - cfg.a0);
    const c0 = mid - cw / 2, c1 = mid + cw / 2, head = cfg.head || 2.4, t = cfg.t || 0.3;
    infill({ axis: cfg.axis, a0: cfg.a0, a1: cfg.a1, c0: c0, c1: c1, fixed: cfg.fixed, t: t,
      top: cfg.top || 3.6, head: head, bands: cfg.bands, skin: cfg.skin, color: cfg.wall });
    return door({ id: cfg.id, label: cfg.label, axis: cfg.axis, a0: c0, a1: c1, fixed: cfg.fixed, t: t, h: head,
      keys: cfg.keys, lb: cfg.lb, alarm: cfg.alarm, hinge: cw > 1.3 ? 0 : -1, swing: cfg.swing,
      build: detentionLeaf({ color: cfg.color }), staffR: cfg.staffR, autoShut: cfg.autoShut, reader: cfg.reader });
  }
  /* STAFF OPEN THE DOORS THEY HOLD KEYS TO. A movement officer walking the
     spine carries the Corridor Key; when he reaches a door it opens and it
     shuts behind him — the same tailgating window world/prisonwings.js
     leaves at its card doors, and the reason a man can follow an officer
     through a section he has no key for. Who opens what: any officer for an
     unlocked door; rank 2+ for a card door; the corridor post for the
     Corridor Key; the gate post for the Gate Key. */
  function staffFor(d) {
    const list = CBZ.guards || [];
    const R = d.staffR || 2.4;
    for (let i = 0; i < list.length; i++) {
      const g = list[i];
      if (!g || g.dead || g.ko > 0 || !g.group) continue;
      const dx = g.group.position.x - d.x, dz = g.group.position.z - d.z;
      if (dx * dx + dz * dz > R * R) continue;
      const k = d.keys;
      if (!k || !k.length) return g;
      if (k.indexOf("Corridor Key") >= 0 && (g.post === "corridor" || g.kind === "warden")) return g;
      if (k.indexOf("Gate Key") >= 0 && (g.post === "gate" || g.kind === "warden")) return g;
      if (k.indexOf("Keycard") >= 0 && ((g.rank || 0) >= 2 || g.kind === "warden")) return g;
    }
    return null;
  }
  /* A NEW RUN FINDS EVERY DOOR SHUT AND WHOLE. Same hook world/prisonwings.js
     uses (CBZ.jailBoost's state-exit list), taken lazily because this file
     parses before entities/guards.js publishes it. */
  function resetDoors() {
    for (let i = 0; i < doors.length; i++) {
      const d = doors[i];
      d.blown = false; d.pending = false; d._by = null;
      for (const p of d.pivots) p.visible = true;
      d.t = 0; d.openT = 0;
      d.set.set(0);
      colAdd(d); losSet(d, true);
      d.setOpen(false, true);
    }
  }
  CBZ.resetCorridorDoors = resetDoors;
  let resetHooked = false;
  CBZ.onUpdate(41.46, function (dt) {
    if (!resetHooked && CBZ.jailBoost && CBZ.jailBoost.onStateExit) {
      resetHooked = true;
      CBZ.jailBoost.onStateExit(resetDoors, ["title", "won", "lost"]);
    }
    const P = CBZ.player && CBZ.player.pos;
    for (let i = 0; i < doors.length; i++) {
      const d = doors[i];
      if (!d.open && !d.blown && !d.pending) { const g = staffFor(d); if (g) d.setOpen(true); }
      // an interlocked door waiting on its partner releases when that one is
      // home; it gives up if the man who pushed it walks away
      if (d.pending) {
        const far = P ? (P.x - d.x) * (P.x - d.x) + (P.z - d.z) * (P.z - d.z) > 5 * 5 : true;
        if (far && !staffFor(d)) d.pending = false;
        else if (interlockClear(d)) d.setOpen(true);
      }
      // a shut leaf held off a body in the doorway closes on the frame once he is clear
      if (!d.open && !d.blown && !colIn(d) && !bodyIn(d)) colAdd(d);
      const want = d.open ? 1 : 0;
      if (d.t !== want) {
        // a leaf waiting on a body stands just off the frame
        const goal = (!d.open && !colIn(d)) ? Math.min(d.t, 0.4) : want;
        const sw = dt * 1.8;
        if (sw >= Math.abs(goal - d.t)) d.t = goal; else d.t += Math.sign(goal - d.t) * sw;
        d.set.set(d.t);
        if (want === 1 && d.t >= 0.4) { colDrop(d); losSet(d, false); }   // swung clear enough to pass
      }
      if (d.open && !d.blown) {
        d.openT += dt;
        const near = (P ? (P.x - d.x) * (P.x - d.x) + (P.z - d.z) * (P.z - d.z) < 3.2 * 3.2 : false) || !!staffFor(d);
        if (d.openT > d.autoShut && !near) d.setOpen(false);
      }
    }
  });

  /* ==========================================================
     4. FINISHES.
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
     5. THE SALLY PORT. cfg { id, x, z (the wall line), dir (+1: the way out
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
    CBZ.onUpdate(21.38, (function () { let done = false; return function () {
      if (done || !CBZ.prisonLights || !CBZ.prisonLights.rooms) return; done = true;
      CBZ.prisonLights.rooms.push({ id: cfg.id, x0: X - IW, x1: X + IW, z0: wz0, z1: wz1 });
    }; })());
    /* THE INNER DOOR on the wall line: a block partition across the
       vestibule with a steel pair in it, on the Gate Key. It was a 7.8 m
       barred slider on a motor; a sally port is two DOORS (research: "a
       security vestibule with two or more doors ... releasing only one at a
       time"), and the out door below is interlocked with this one. */
    const gate = crossDoor({ id: cfg.id + "-inner", label: "The inner door", axis: "x", a0: X - IW, a1: X + IW, fixed: Z,
      t: 0.3, top: CH, head: 2.5, clear: 2.2, keys: [cfg.gateKey || "Gate Key"], lb: 5, alarm: true, swing: -D,
      bands: true, staffR: 3.2, autoShut: 5, color: 0x4f5d6b });
    if (cfg.signal && CBZ.exitSignal) { CBZ.exitSignal.register(gate.lamp); gate.lamp._exitSignal = true; }
    { const ip = P(1.6, -0.15); intercom(ip[0], 1.45, ip[1], 0, -D); }
    const es1 = P(0, -0.19), es2 = P(0, IZ1 - 0.35);
    exitSign(es1[0], 3.22, es1[1], D > 0 ? Math.PI : 0);
    exitSign(es2[0], 2.72, es2[1], D > 0 ? Math.PI : 0);
    const rp = P(-3.0, -0.16);
    K.sign("AUTHORIZED PERSONNEL ONLY\nBEYOND THIS POINT", rp[0], 2.05, rp[1], 1.3, 0.42, D > 0 ? Math.PI : 0, "#f3f3ef", "#b3261e");
    // the entry pair and the way out
    const ez = P(0, Z0 + T / 2)[1], oz = P(0, Z1 - T / 2)[1];
    door({ id: cfg.id + "-entry", label: "The sally port", axis: "x", a0: X - DW / 2, a1: X + DW / 2, fixed: ez, t: T, h: 2.5, keys: null, hinge: 0, swing: -D, build: detentionLeaf() });
    // THE WAY OUT is interlocked with the inner door: it releases only while
    // the door behind you is home and shut. Pushed from inside.
    const outDoor = door({ id: cfg.id + "-out", label: "The way out", axis: "x", a0: X - OW / 2, a1: X + OW / 2, fixed: oz, t: T, h: 2.35, keys: null, hinge: -1, swing: D, lb: 0, build: detentionLeaf({ color: 0x4f6f60 }) });
    outDoor.interlock = gate;
    const stp = P(0, Z1 + 0.6);
    const step = addBox(stp[0], 0.08, stp[1], 2.4, 0.16, 1.2, 0x8f959c, { cast: false }); K.skinBox(step, "concrete", 0xa0a5aa);
    // the step is a thing you stand on, not a slab your shins pass through
    (CBZ.platforms || (CBZ.platforms = [])).push({ minX: stp[0] - 1.2, maxX: stp[0] + 1.2, minZ: stp[1] - 0.6, maxZ: stp[1] + 0.6, top: 0.16 });
    if (CBZ.markPlatformsDirty) CBZ.markPlatformsDirty();
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
      door({ id: cfg.id + "-booth", label: "The gate booth", axis: "z", fixed: side > 0 ? B.x1 : B.x0, a0: wc - 0.6, a1: wc + 0.6, t: 0.5, h: 2.3, keys: ["Keycard"], lb: 5, hinge: -1, swing: side, headLamp: false, build: detentionLeaf({ color: 0x4f6f60 }) });
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
    // the win: THE exit, or an alternative one. It stands OUTSIDE, 3.2 m past
    // the out door's face, 3 m round: nobody reaches it without the inner
    // door open, shut again behind him, and the out door swung (it sat
    // inside the vestibule, so the run ended on a door nobody opened).
    const win = P(0, Z1 + 3.2);
    if (cfg.altExit) (CBZ.altExitZones || (CBZ.altExitZones = [])).push({ x: win[0], z: win[1], r: 3, name: cfg.id });
    return { gate: gate, win: { x: win[0], z: win[1] } };
  }

  CBZ.corridorKit = {
    door, crossDoor, doorSet, infill, detentionLeaf, steelLeaf, barLeaf, glassLeaf, BARS, Paint,
    cardReader, intercom, lining, exitSign, strip, cagedLamp, keyTest, doors,
  };
  CBZ.buildSallyPort = buildSallyPort;
})();
