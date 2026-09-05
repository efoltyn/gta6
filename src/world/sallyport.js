/* ============================================================
   world/sallyport.js — THE EXIT IS A BUILDING.

   OWNER (2026-09-05), with three photographs of real sally ports: "the
   green light and stupid red thing in front aren't exits — exits have an
   exit sign and look like this." The photographs: a chain-link walkway
   under concertina running straight into a concrete block with a dark
   glass door and a small blue plate over it; a block-wall vestibule, green
   to shoulder height and cream above, a steel door with a wired window,
   a red EXIT sign; a barred grille across a polished corridor, one panel
   fixed and one sliding on a heavy header, EXIT sign over the bars.

   WHAT WAS THERE: two checkpoint pillars with a red boom across them,
   jersey barriers, and world/exit.js's glowing green frame, pad and light
   shaft in the gap in the south wall. None of it is a thing a prison has.

   WHAT IS HERE, on the same gap, holding every authored coordinate:
     · the WALKWAY  x±4.7, z 113..121 — chain-link both sides, coil on top,
                    the stop line still painted across it.
     · the BUILDING x±5.2, z 121..135, 7 m, straddling the wall line: a
                    glazed entry pair on the north face under a blue plate
                    and a caged lamp; a 9 m vestibule of painted block
                    (green band, cream above) over polished concrete under
                    strip lights; the GRILLE at z=128 — the wall line — a
                    fixed barred panel and a sliding leaf on a steel header,
                    bars to the ceiling; then the outer steel door at the
                    south face with a wired window and a crash bar.
     · the BOOTH    x 5.2..9.4 off the vestibule's east side, a window on
                    the corridor, a desk, the key board.
     · EXIT SIGNS   over the grille and over the outer door, always lit.

   THE LOCK IS A PHYSICAL KEY. The grille takes the GATE KEY and nothing
   electric: not the keycard, not the control room's throw. Where the key
   is: on the belt of the gate detail (systems/economy.js rollLoadout — the
   officer whose post is the exit carries the exit's key, every shift), and
   on the board in the booth behind a carded door. Or 5 lb of C4 on the
   bars. The outer door is a crash bar: it opens for anyone who is past
   the grille, which is what a fire exit is.

   CBZ.EXIT (the win point, world/exit.js) sits between the grille and the
   outer door, so the compound side of the bars is not a win and the far
   side is.

   CBZ.corridorKit publishes the pieces the corridor wave will build a
   thousand metres of: lining(), grille(), door(), exitSign(), strips.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !CBZ.prisonKit || !CBZ.addBox || !CBZ.WORLD) return;
  const K = CBZ.prisonKit;
  const { addBox } = CBZ;
  const ROOT = CBZ.prisonRoot || CBZ.scene;
  const PD = CBZ.prisonDress || null;
  const W = CBZ.WORLD;
  const EX = W.exit.x, EZ = W.exit.z;                      // (0, 128): the wall line
  const stat = K.stat;

  const steelDark = K.skin("steel", 0x3a4048), steelBlue = K.skin("steel", 0x1f3a5f), steelGreen = K.skin("steel", 0x4f6f60);
  const bars = K.skin("galv", 0x9aa3a8), glass = K.skin("glass"), galv = K.skin("galv", 0xb4bcc4);
  const BLOCK_LOW = 0x7d9787, BLOCK_HIGH = 0xe4e0d4;

  /* ==========================================================
     1. THE DOOR PRIMITIVES. The same registry contract every prison door
        speaks (CBZ._prisonDoorSpecs -> systems/interactions.js), the same
        collider splice, the same breach row. Two shapes: a leaf that
        SLIDES along its wall (a grille) and a leaf that SWINGS on a hinge.
     ========================================================== */
  const doors = [];
  function keyTest(keys) {
    return function () {
      const g = CBZ.game;
      if (g && g.role === "cop") return true;
      if (!keys || !keys.length) return true;
      if (keys.indexOf("Keycard") >= 0 && g && g.hasKey) return true;
      const econ = CBZ.econ;
      for (const k of keys) if (econ && econ.hasItem && econ.hasItem(k)) return true;
      return false;
    };
  }
  function registerDoor(d, cfg) {
    d.open = false; d.t = 0; d.openT = 0; d.blown = false;
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
  // bars between x0..x1 (local), y0..y1, every `pitch`, in a group
  function barField(group, x0, x1, y0, y1, pitch, z, mat) {
    const n = Math.max(1, Math.round((x1 - x0) / pitch));
    for (let i = 0; i <= n; i++) {
      const g = new THREE.BoxGeometry(0.035, y1 - y0, 0.035);
      g.translate(x0 + (i * (x1 - x0)) / n, (y0 + y1) / 2, z);
      group.add(new THREE.Mesh(g, mat));
    }
  }
  function flat(group, x0, x1, y, z, h, mat) {
    const g = new THREE.BoxGeometry(x1 - x0, h, 0.05);
    g.translate((x0 + x1) / 2, y, z);
    group.add(new THREE.Mesh(g, mat));
  }
  /* a sliding grille across a corridor running along x at wall plane `z`:
     cfg { id, label, x0, x1, z, h, keys, lb, fixedTo } — the fixed panel spans
     x0..fixedTo, the leaf fixedTo..x1 and slides west over the fixed panel */
  function grille(cfg) {
    const h = cfg.h || 3.55, fx = cfg.fixedTo;
    const fixed = new THREE.Group(); fixed.userData.prisonKit = true;
    barField(fixed, cfg.x0 + 0.05, fx, 0.06, h, 0.14, cfg.z - 0.1, bars);
    flat(fixed, cfg.x0, fx + 0.03, 0.30, cfg.z - 0.1, 0.10, steelDark);
    flat(fixed, cfg.x0, fx + 0.03, 1.55, cfg.z - 0.1, 0.10, steelDark);
    flat(fixed, cfg.x0, fx + 0.03, h - 0.06, cfg.z - 0.1, 0.10, steelDark);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, h, 0.24), steelDark);
    post.position.set(fx, h / 2, cfg.z - 0.1); fixed.add(post);
    ROOT.add(fixed);
    CBZ.colliders.push({ minX: cfg.x0, maxX: fx + 0.08, minZ: cfg.z - 0.25, maxZ: cfg.z + 0.05, grille: true, noBreach: true });
    // the header the leaf hangs from, full width, and the bars above it
    const header = new THREE.Mesh(new THREE.BoxGeometry(cfg.x1 - cfg.x0 + 0.3, 0.42, 0.42), steelDark);
    header.position.set((cfg.x0 + cfg.x1) / 2, 2.72, cfg.z); header.userData.prisonKit = true; ROOT.add(header);
    // the leaf
    const leaf = new THREE.Group(); leaf.userData.mover = true;
    const lw = cfg.x1 - fx;
    barField(leaf, 0.08, lw - 0.08, 0.06, h, 0.14, 0, bars);
    flat(leaf, 0, lw, 0.30, 0, 0.10, steelDark);
    flat(leaf, 0, lw, 1.55, 0, 0.10, steelDark);
    flat(leaf, 0, lw, h - 0.06, 0, 0.10, steelDark);
    for (const lx of [0.04, lw - 0.04]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.09, h, 0.2), steelDark); p.position.set(lx, h / 2, 0); leaf.add(p); }
    // the lock box on the leading edge, and its lamp
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.5, 0.12), steelDark); lock.position.set(0.16, 1.02, 0.14); leaf.add(lock);
    const lampMat = new THREE.MeshLambertMaterial({ color: 0xff3b3b, emissive: 0xff0000, emissiveIntensity: 1.0 });
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.06), lampMat); lamp.position.set(0.16, 1.4, 0.19); leaf.add(lamp);
    // rollers on the header
    for (const lx of [0.3, lw - 0.3]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.08, 10), galv); r.rotation.x = Math.PI / 2; r.position.set(lx, h + 0.05, 0.08); leaf.add(r); }
    leaf.position.set(fx, 0, cfg.z + 0.1);
    ROOT.add(leaf);
    const d = {
      id: cfg.id, x: (fx + cfg.x1) / 2, z: cfg.z, group: leaf, lamp: lampMat, kind: "grille",
      shutX: fx, openX: fx - (lw - 0.5), leaf: leaf,
      collider: { minX: fx, maxX: cfg.x1, minZ: cfg.z - 0.05, maxZ: cfg.z + 0.25, ref: post },
      autoShut: cfg.autoShut != null ? cfg.autoShut : 5,
    };
    return registerDoor(d, cfg);
  }
  /* a swinging leaf in a wall along x at plane `z`: cfg { id, label, x0, x1,
     z, h, keys, lb, swing (+1 opens toward +z), hinge (-1 = at x0), build(group, w, h) } */
  function door(cfg) {
    // axis "x": the doorway runs along x in the wall plane z (a0..a1 = x0..x1)
    // axis "z": it runs along z in the wall plane x (a0..a1 = z0..z1)
    const along = cfg.axis === "z";
    const a0 = along ? cfg.z0 : cfg.x0, a1 = along ? cfg.z1 : cfg.x1, fixed = along ? cfg.x : cfg.z;
    const w = a1 - a0, h = cfg.h || 2.3, hingeA = cfg.hinge < 0 ? a0 : a1, dir = cfg.hinge < 0 ? 1 : -1;
    const pivot = new THREE.Group(); pivot.userData.mover = true;
    pivot.position.set(along ? fixed : hingeA, 0, along ? hingeA : fixed);
    const g = new THREE.Group(); g.position.set(0, 0, 0); pivot.add(g);
    cfg.build(g, w, h, dir);
    ROOT.add(pivot);
    const base = along ? -Math.PI / 2 : 0;            // local +x lies along the doorway
    pivot.rotation.y = base;
    const d = {
      id: cfg.id, x: along ? fixed : (a0 + a1) / 2, z: along ? (a0 + a1) / 2 : fixed, group: pivot, kind: "swing", base: base,
      swing: (cfg.swing || 1) * dir * (Math.PI / 2) * 0.94,
      collider: along ? { minX: fixed - 0.1, maxX: fixed + 0.1, minZ: a0, maxZ: a1, ref: pivot }
        : { minX: a0, maxX: a1, minZ: fixed - 0.1, maxZ: fixed + 0.1, ref: pivot },
      autoShut: cfg.autoShut != null ? cfg.autoShut : 4,
    };
    if (cfg.lamp) d.lamp = cfg.lamp;
    return registerDoor(d, cfg);
  }
  // the tick: leaves move, doors shut behind you
  CBZ.onUpdate(41.46, function (dt) {
    const P = CBZ.player && CBZ.player.pos;
    for (let i = 0; i < doors.length; i++) {
      const d = doors[i];
      const want = d.open ? 1 : 0;
      if (d.t !== want) {
        d.t += Math.sign(want - d.t) * Math.min(Math.abs(want - d.t), dt * (d.kind === "grille" ? 0.9 : 1.8));
        if (d.kind === "grille") d.leaf.position.x = d.shutX + (d.openX - d.shutX) * d.t;
        else d.group.rotation.y = d.base + d.swing * d.t;
      }
      if (d.open && !d.blown) {
        d.openT += dt;
        const near = P ? (P.x - d.x) * (P.x - d.x) + (P.z - d.z) * (P.z - d.z) < 3.2 * 3.2 : false;
        if (d.openT > d.autoShut && !near) d.setOpen(false);
      }
    }
  });

  /* ==========================================================
     2. FINISHES. Block lining, a polished floor, a ceiling with strips,
        and the EXIT sign.
     ========================================================== */
  // an inner lining on a wall face: two bands of painted block, world-metre
  // joints. `n` is the face normal (+x/-x/+z/-z), (x,z) the face plane.
  function lining(x0, x1, z0, z1, h, band) {
    band = band || 1.2;
    const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const low = addBox(cx, band / 2, cz, w, band, d, 0x8a9a90, { cast: false });
    K.skinBox(low, "block", BLOCK_LOW);
    const high = addBox(cx, band + (h - band) / 2, cz, w, h - band, d, 0xe4e0d4, { cast: false });
    K.skinBox(high, "block", BLOCK_HIGH);
    // a painted cap line where the bands meet
    addBox(cx, band, cz, w + 0.002, 0.03, d + 0.002, 0x4f6f60, { cast: false });
  }
  function exitSign(x, y, z, ry) {
    const c = document.createElement("canvas"); c.width = 256; c.height = 96;
    const g = c.getContext("2d");
    g.fillStyle = "#151515"; g.fillRect(0, 0, 256, 96);
    g.fillStyle = "#ff2a1a"; g.font = "900 62px Arial, Helvetica, sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("EXIT", 128, 50);
    const t = new THREE.CanvasTexture(c);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.24, 0.07),
      new THREE.MeshLambertMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.9 }));
    m.position.set(x, y, z); m.rotation.y = ry || 0; m.userData.sign = true;
    ROOT.add(m);
    // its stem
    addBox(x, y + 0.2, z, 0.05, 0.16, 0.05, 0x3a4048, { cast: false });
    return m;
  }
  function strip(x, y, z, len, axis) {
    if (PD && PD.strip) { try { return PD.strip(x, y, z, len, axis); } catch (e) {} }
    return addBox(x, y - 0.05, z, axis === "x" ? len : 0.13, 0.05, axis === "x" ? 0.13 : len, 0xfdf6d8, { emissive: 0xffe9a8, ei: 0.85, cast: false });
  }
  function cagedLamp(x, y, z, face) {
    // face: unit normal the lamp throws along
    stat(new THREE.BoxGeometry(0.5, 0.28, 0.16), steelDark, x, y, z, { ry: Math.atan2(face.x, face.z), cast: false });
    const lamp = addBox(x + face.x * 0.05, y, z + face.z * 0.05, 0.42, 0.2, 0.2, 0x2b2b2b, { cast: false });
    lamp.userData.mover = true;
    const rec = { x: x + face.x * 3, z: z + face.z * 3, r: 9, kind: "flood", mesh: lamp, color: 0xfff4d2, emissive: 0xffd88a, off: 0x2b2b2b };
    if (CBZ.prisonLights && CBZ.prisonLights.register) { try { CBZ.prisonLights.register(rec); } catch (e) {} }
    else (CBZ._prisonLateFixtures || (CBZ._prisonLateFixtures = [])).push(rec);
    return lamp;
  }
  CBZ.corridorKit = { grille, door, lining, exitSign, strip, cagedLamp, keyTest, doors };

  /* ==========================================================
     3. THE BUILDING.
     ========================================================== */
  const BX = 5.2, IW = 4.6, Z0 = EZ - 7, Z1 = EZ + 7, H = 7, CH = 3.6, T = 0.6;
  const WALL = 0x9aa3ad;
  function wall(x, y, z, w, h, d, y0) {
    // a head over a doorway carries a HEIGHT-GATED collider (y0..top), so a
    // body walks under it and a bullet still stops on it
    const m = addBox(x, y, z, w, h, d, WALL, y0 != null ? { solid: true, blockLOS: true, y0: y0, y1: y + h / 2 } : { solid: true, blockLOS: true });
    if (m.userData.collider) m.userData.collider.noBreach = true;
    K.skinBox(m, "panel", WALL);
    return m;
  }
  // side walls, full height; the yard wall's runs die into them
  wall(-BX + T / 2, H / 2, (Z0 + Z1) / 2, T, H, Z1 - Z0);
  wall(BX - T / 2, H / 2, (Z0 + Z1) / 2, T, H, Z1 - Z0);
  // north face: two runs either side of the entry, the head over it, the upper storey
  const DW = 2.5;
  wall((-BX - DW / 2) / 2, H / 2, Z0 + T / 2, BX - DW / 2, H, T);
  wall((BX + DW / 2) / 2, H / 2, Z0 + T / 2, BX - DW / 2, H, T);
  wall(0, 2.5 + (H - 2.5) / 2, Z0 + T / 2, DW, H - 2.5, T, 2.5);
  // south face: the outer door's runs and head
  const OW = 1.4;
  wall((-BX - OW / 2) / 2, H / 2, Z1 - T / 2, BX - OW / 2, H, T);
  wall((BX + OW / 2) / 2, H / 2, Z1 - T / 2, BX - OW / 2, H, T);
  wall(0, 2.35 + (H - 2.35) / 2, Z1 - T / 2, OW, H - 2.35, T, 2.35);
  // the roof, and the upper-storey windows on the north face
  if (CBZ.prisonRoof) CBZ.prisonRoof({ id: "sallyport", x0: -BX, x1: BX, z0: Z0, z1: Z1, top: H, over: 0.2, cast: true, plant: false });
  for (const wx of [-2.6, 0, 2.6]) {
    stat(new THREE.BoxGeometry(1.5, 1.1, 0.12), steelDark, wx, 5.3, Z0 + 0.04, { cast: false });
    stat(new THREE.PlaneGeometry(1.3, 0.9), glass, wx, 5.3, Z0 - 0.03, { ry: Math.PI, cast: false });
  }
  // the entry: a blue plate, a caged lamp, a camera
  K.sign("GATE 3", 0, 3.0, Z0 - 0.02, 0.9, 0.34, Math.PI, "#f3f3ef", "#1f3a5f");
  cagedLamp(-2.2, 3.15, Z0 - 0.1, { x: 0, z: -1 });
  stat(new THREE.BoxGeometry(0.18, 0.18, 0.34), steelDark, 2.4, 3.3, Z0 - 0.2, { ry: -0.5, rx: 0.4, cast: false });
  stat(new THREE.SphereGeometry(0.16, 10, 8), K.skin("glass", 0x202830), 2.4, 3.3, Z0 - 0.3, { cast: false });

  // interior: lining, floor, ceiling, strips
  const IZ0 = Z0 + T, IZ1 = Z1 - T;
  lining(-IW - 0.08, -IW, IZ0, IZ1, CH);                 // west
  lining(IW, IW + 0.08, IZ0, IZ1, CH);                   // east
  lining(-IW, -DW / 2, IZ0, IZ0 + 0.08, CH);             // north, either side of the entry
  lining(DW / 2, IW, IZ0, IZ0 + 0.08, CH);
  lining(-IW, -OW / 2, IZ1 - 0.08, IZ1, CH);             // south, either side of the outer door
  lining(OW / 2, IW, IZ1 - 0.08, IZ1, CH);
  const floor = addBox(0, 0.03, (IZ0 + IZ1) / 2, IW * 2, 0.06, IZ1 - IZ0, 0x8e939a, { cast: false });
  K.skinBox(floor, "polished", 0x9a9fa6);
  addBox(0, CH + 0.08, (IZ0 + IZ1) / 2, IW * 2, 0.16, IZ1 - IZ0, 0xdedbd2, { cast: false });
  for (const z of [IZ0 + 2.0, IZ0 + 4.6, EZ + 2.2, IZ1 - 1.6]) {
    const fx = strip(0, CH - 0.02, z, 3.6, "x");
    if (fx && fx.material && CBZ.exitSignal) CBZ.exitSignal.register(fx.material);
  }
  // the wall stubs at the grille's ends wear a steel jamb, not the yard's panels
  for (const s of [-1, 1]) stat(new THREE.BoxGeometry(0.75, CH, 1.25), steelDark, s * (IW - 0.3), CH / 2, EZ, {});
  // the room is an interior to the night rig
  CBZ.onUpdate(21.38, (function () { let done = false; return function () {
    if (done || !CBZ.prisonLights || !CBZ.prisonLights.rooms) return; done = true;
    CBZ.prisonLights.rooms.push({ id: "sallyport", x0: -IW, x1: IW, z0: Z0, z1: Z1 });
  }; })());

  // THE GRILLE, on the wall line
  const gate = grille({ id: "prison-exit-grille", label: "The exit grille", x0: -IW + 0.6, x1: IW - 0.6, fixedTo: -0.55, z: EZ, h: CH - 0.05, keys: ["Gate Key"], lb: 5 });
  if (CBZ.exitSignal) { CBZ.exitSignal.register(gate.lamp); gate.lamp._exitSignal = true; }
  // signs read by a man walking SOUTH face north (ry = PI: a plane's front is +z)
  exitSign(0, 3.22, EZ - 0.55, Math.PI);
  exitSign(0, 2.72, IZ1 - 0.35, Math.PI);
  K.sign("AUTHORIZED PERSONNEL ONLY\nBEYOND THIS POINT", -3.0, 2.05, EZ - 0.42, 1.3, 0.42, Math.PI, "#f3f3ef", "#b3261e");

  // THE ENTRY PAIR: blue steel frames, glass, swing in
  const entryLamp = new THREE.MeshLambertMaterial({ color: 0x39ff88, emissive: 0x14c258, emissiveIntensity: 1.0 });
  function glassLeaf(g, w, h, dir) {
    const fr = (x, y, sx, sy) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, 0.08), steelBlue); m.position.set(x, y, 0); g.add(m); };
    fr(dir * w / 2, 0.04, w, 0.08); fr(dir * w / 2, h - 0.04, w, 0.08); fr(dir * w / 2, h / 2 - 0.02, w, 0.06);
    fr(dir * 0.04, h / 2, 0.08, h); fr(dir * (w - 0.04), h / 2, 0.08, h);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.14, h - 0.14), glass); pane.position.set(dir * w / 2, h / 2, 0); g.add(pane);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w - 0.3, 0.05, 0.05), galv); bar.position.set(dir * w / 2, 1.02, 0.1); g.add(bar);
  }
  door({ id: "prison-exit-entry-w", label: "The sally port", x0: -DW / 2, x1: 0, z: Z0 + T / 2, h: 2.4, keys: null, hinge: -1, swing: 1, build: glassLeaf });
  door({ id: "prison-exit-entry-e", label: "The sally port", x0: 0, x1: DW / 2, z: Z0 + T / 2, h: 2.4, keys: null, hinge: 1, swing: 1, build: glassLeaf });

  // THE OUTER DOOR: a green steel leaf with a wired window and a crash bar, swings out
  door({ id: "prison-exit-out", label: "The way out", x0: -OW / 2, x1: OW / 2, z: Z1 - T / 2, h: 2.3, keys: null, hinge: -1, swing: -1, lb: 0,
    build: function (g, w, h, dir) {
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(w - 0.04, h - 0.03, 0.06), steelGreen); leaf.position.set(dir * w / 2, h / 2, 0); g.add(leaf);
      const win = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.62), K.skin("glass", 0x8a9a9a)); win.position.set(dir * (w / 2 + 0.2), 1.62, -0.04); win.rotation.y = Math.PI; g.add(win);
      const win2 = win.clone(); win2.position.z = 0.04; win2.rotation.y = 0; g.add(win2);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w - 0.3, 0.07, 0.07), galv); bar.position.set(dir * w / 2, 1.0, -0.08); g.add(bar);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.02), galv); plate.position.set(dir * (w / 2 + 0.25), 1.0, 0.04); g.add(plate);
    } });
  // outside the outer door: a step, a lamp over it, the ground beyond
  const step = addBox(0, 0.08, Z1 + 0.6, 2.4, 0.16, 1.2, 0x8f959c, { cast: false }); K.skinBox(step, "concrete", 0xa0a5aa);
  cagedLamp(0, 2.9, Z1 + 0.1, { x: 0, z: 1 });

  /* ==========================================================
     4. THE BOOTH. Off the vestibule's east wall: a window on the corridor
        (the officer sees who is at the grille), a desk, the key board with
        the Gate Key on it, behind a carded door onto the yard.
     ========================================================== */
  const B = { x0: BX, x1: BX + 4.2, z0: EZ - 5.4, z1: EZ - 0.4, h: 3.4 };
  CBZ.roomShell({ x0: B.x0, x1: B.x1, z0: B.z0, z1: B.z1, h: B.h, wall: WALL, floor: 0x6a6f78, skin: "panel",
    doors: [{ side: "E", center: (B.z0 + B.z1) / 2, width: 1.2 }] });
  addBox(B.x1, (2.3 + B.h) / 2, (B.z0 + B.z1) / 2, 0.5, B.h - 2.3, 1.2, WALL, { cast: false });
  if (CBZ.prisonRoof) CBZ.prisonRoof({ id: "sallyport-booth", x0: B.x0, x1: B.x1, z0: B.z0, z1: B.z1, top: B.h, over: 0.2, cast: true, plant: false });
  // the window onto the vestibule: cut through the vestibule's east wall, glass, a speak grille
  const WZ0 = EZ - 4.6, WZ1 = EZ - 1.2, WY0 = 1.1, WY1 = 2.15;
  // (the vestibule's east wall is one box; the window is a lit pane laid on
  //  both faces with a dark reveal — the wall stays solid and LOS-blocking,
  //  which is what glass between a booth and a corridor is to a bullet)
  for (const face of [-1, 1]) {
    const px = face < 0 ? IW - 0.005 : BX + 0.005;
    stat(new THREE.BoxGeometry(0.06, WY1 - WY0 + 0.16, WZ1 - WZ0 + 0.16), steelDark, px, (WY0 + WY1) / 2, (WZ0 + WZ1) / 2, { cast: false });
    stat(new THREE.PlaneGeometry(WZ1 - WZ0, WY1 - WY0), K.skin("glass", 0x2c3d4a), px + face * 0.04, (WY0 + WY1) / 2, (WZ0 + WZ1) / 2, { ry: face < 0 ? -Math.PI / 2 : Math.PI / 2, cast: false });
  }
  stat(new THREE.BoxGeometry(0.02, 0.22, 0.34), galv, IW - 0.06, 1.35, EZ - 2.9, { cast: false });   // the speak-through
  // desk, chair, the key board with the key
  addBox(B.x0 + 1.2, 0.74, EZ - 2.9, 0.7, 0.06, 2.6, 0x8a939d, { solid: true });
  addBox(B.x0 + 1.2, 0.36, EZ - 2.9, 0.6, 0.7, 0.5, 0x5b6470, { cast: false });
  if (CBZ.roomSeatAnchor) { try { CBZ.roomSeatAnchor(B.x0 + 2.0, 0, EZ - 2.9, -Math.PI / 2, "chair", null, { cushion: 0.46, floorBelow: 0 }); } catch (e) {} }
  const KBX = B.x0 + 2.4, KBZ = B.z0 + 0.3;
  addBox(KBX, 1.55, KBZ, 0.9, 0.7, 0.06, 0x6a563c, { cast: false });
  for (let i = 0; i < 6; i++) addBox(KBX - 0.32 + i * 0.13, 1.72 - (i % 2) * 0.22, KBZ + 0.04, 0.02, 0.05, 0.02, 0x8b95a1, { cast: false });
  if (CBZ.prisonPlaceItem) { try { CBZ.prisonPlaceItem("Gate Key", KBX + 0.1, 1.42, KBZ + 0.08); } catch (e) {} }
  strip(B.x0 + 2.1, B.h - 0.02, EZ - 2.9, 2.2, "z");
  // the booth's own door: carded, on the yard side
  door({ id: "prison-exit-booth", label: "The gate booth", axis: "z", x: B.x1, z0: (B.z0 + B.z1) / 2 - 0.6, z1: (B.z0 + B.z1) / 2 + 0.6, h: 2.2, keys: ["Keycard"], lb: 5, hinge: -1, swing: 1,
    build: function (g, w, h, dir) {
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(w - 0.04, h - 0.03, 0.06), steelGreen); leaf.position.set(dir * w / 2, h / 2, 0); g.add(leaf);
      const win = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.5), K.skin("glass", 0x8a9a9a)); win.position.set(dir * w / 2, 1.6, 0.04); g.add(win);
    } });
  K.sign("AUTHORIZED\nPERSONNEL ONLY", B.x1 + 0.28, 2.6, (B.z0 + B.z1) / 2, 0.9, 0.42, Math.PI / 2, "#f3f3ef", "#b3261e");

  /* ==========================================================
     5. THE WALKWAY. Chain-link both sides from the stop line to the door,
        coil on top, the plate every real one carries.
     ========================================================== */
  const WX = 4.7, WKZ = EZ - 15;
  CBZ.prisonFence({ x0: -WX, z0: WKZ, x1: -WX, z1: Z0 + 0.1, h: 3.6 });
  CBZ.prisonFence({ x0: WX, z0: WKZ, x1: WX, z1: Z0 + 0.1, h: 3.6 });
  K.program("exit-walkway", -WX, WX, WKZ, Z0);
  K.program("sallyport", -BX, B.x1, Z0, Z1);
  K.flush();
})();
