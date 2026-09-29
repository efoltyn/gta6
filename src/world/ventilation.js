/* ============================================================
   world/ventilation.js — THE DUCT RUNS.

   OWNER: "the vents are in random dumb spots."

   HE WAS DESCRIBING A REAL BUG, not a taste. The four grates were four hard
   world coordinates typed into this file, and three of the four were WRONG
   about the room they named:

     · the exit point was computed as `x ± 1.2` off the GRATE, always toward
       x = 0. For the "Locked Armory" grate at x = 18.6 that put you down at
       x = 17.4 — and the armory's west wall is at x = 19, so the vent that is
       the whole point of the keycard/gun-room chain spat you out IN THE YARD,
       one and a half metres SHORT of the room it was named after. Same
       arithmetic, same result, for "Staff Lounge" (17.4 vs a wall at 19) and
       "Mess Hall" (-17.4 vs a wall at -19).
     · the grate MESH stood 0.1 m proud of the masonry rather than flush in it,
       because its x was typed independently of the wall's inner face.
     · and nothing about any of it was derived, so the day a room moved the
       vent stayed where it was and nobody would ever know.

   PRISON_VENTS_V2 rebuilds all of that from the ROOMS THEMSELVES. Every prison
   interior registers a shell record on `CBZ.prisonShells` (world/cafeteria.js's
   kit) carrying its rect, its height and WHICH WALL ITS DOOR IS IN; the cell
   wing publishes its own bounds through CBZ.WORLD.cellBlock. So a grate is now
   declared as {room, side, at} and this file solves:

     · the wall PLANE (flush — the grate is in the masonry, not beside it),
     · the FACING (into the room),
     · the CRAWL POINT (1.35 m inside the room, on the inward normal — which is
       what makes the destination the room instead of the ground outside it),
     · and a REFUSAL if the grate would land in the room's doorway, because a
       duct through a door opening is the same class of mistake as the one
       above.

   THE RUNS ARE PLAUSIBLE, WHICH IS THE OTHER HALF OF "NOT RANDOM". A duct goes
   where a building's services go: the kitchen extract, the laundry/workshop
   riser, the staff side, and the one maintenance crawl the cell wing already
   has an alcove for (world/cellblock.js's WEST_ROW leaves a utility recess at
   z[-34.5,-30.9] precisely so this route can never be locked away).

     T1  Cell Block utility alcove  <->  Armory duct        (the gun-room spine)
     T2  Kitchen extract            <->  Staff lounge riser
     T3  Workshop laundry crawl     <->  Mess hall riser

   THE MESS HALL IS THE JUNCTION and it is a PLACE, not a menu: it carries two
   grates in two different walls, so a man who comes up the laundry crawl can
   cross the kitchen and go out the extract into the staff side. That is a
   network with a hub, built out of rooms. A literal hub node was considered and
   REFUSED: systems/interactions.js's crawl verb takes ONE `vent.dest`, so a
   junction would have to ask you which way to go — and a menu inside a
   crawlspace is a UI, not a place.

   THE GRILLE (2026-09-28). The mesh used to stand 16 cm PROUD of the wall
   (its centre pushed along the INWARD normal, i.e. into the room) with a
   black "throat" box 30 cm out in front of it: from inside the room it read
   as a black 1 m cube parked against the wall. Now it is a real return-air
   grille set in the wall: a 12 mm steel frame, a dark void plane a hair off
   the masonry, angled louvre blades and four screws, merged by the kit.
   THE GRILLE COMES OFF (2026-09-28, owner: "vents, and the buttons to jump
   into vents are also dumb"). The louvre panel is its own mesh now, held by
   its four screws: systems/interactions.js unscrews it with a blade (or
   wrenches it off by hand, slowly and loudly) and it is set down leaning
   on the wall beside the opening, which is left as a dark 1.1 x 0.8 m duct
   mouth a man fits through. vent.cover = {open, set(v)} is that state;
   vent.mouth = {kind:"wall", x, z, nx, nz, y, sill} is the opening the crawl
   drives the body into. The crawl itself (a prone crawl in, a stretch of
   real duct, a crawl out of the far grille) is CBZ.ventDuct below plus the
   driver in systems/interactions.js; there is no fade and no teleport card.
   Ratchet: CBZ.ventAudit() — `anchored` (grates solved off a real room rect)
   may only go UP, and `outsideDest` (crawl points that do not land inside the
   room they are named after) is pinned at 0.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  // Built when the prison is first needed, as if at this script's parse
  // point (core/prisonlazy.js). Body left at its old indent.
  CBZ.definePrison("world/ventilation.js", function () {
  if (!CBZ || !CBZ.scene) return;
  const scene = CBZ.prisonRoot || CBZ.scene;

  CBZ.vents = CBZ.vents || [];
  const solved = [];        // every grate this file placed, for the audit
  const K = CBZ.prisonKit || null;

  /* ==========================================================
     1. THE ROOMS. Shell records first (they carry the door, which is the one
        thing a grate must not share a wall opening with); the cell wing falls
        back to CBZ.WORLD, which is where its bounds have always lived.
     ========================================================== */
  const SHELLS = CBZ.prisonShells || [];
  // The prison's interiors do not carry ids on every record, so a room is found
  // by its RECT — the same rect its own file typed — and never by a name that
  // could drift. `want` is {x0,x1,z0,z1}; the match is the closest centre.
  function roomAt(x0, x1, z0, z1) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    let best = null, bd = 9;
    for (let i = 0; i < SHELLS.length; i++) {
      const s = SHELLS[i];
      if (!s || !isFinite(+s.x0)) continue;
      const d = Math.abs((+s.x0 + +s.x1) / 2 - cx) + Math.abs((+s.z0 + +s.z1) / 2 - cz);
      if (d < bd) { bd = d; best = s; }
    }
    // Degrade: no shell registry (an older merge, or the dress kit off) → the
    // rect the caller asked for, with no door known. A grate then still lands
    // in the right room; it just cannot check itself against a doorway.
    // world/roombuild.js's roomShell CENTRES each wall on the declared plane
    // with T = 0.5 thickness, so the room's INNER FACE is 0.25 in from x0/x1/
    // z0/z1. A grate placed on the declared plane would sit buried inside the
    // masonry and never be seen — which is why the inset is carried, not
    // assumed. (The cell wing's walls are 1.0 thick; it declares its own.)
    const rec = best || { x0: x0, x1: x1, z0: z0, z1: z1, h: 6, door: null };
    if (rec.inset == null) rec.inset = 0.25;
    return rec;
  }
  const CB = (CBZ.WORLD && CBZ.WORLD.cellBlock) || { x0: -16, x1: 16, z0: -44, z1: -8 };

  const ROOM = {
    // the wing's own walls are 1.0 thick and centred on these planes
    // (world/cellblock.js §0), so its inner face is 0.5 in.
    cell:     { x0: CB.x0, x1: CB.x1, z0: CB.z0, z1: CB.z1, inset: 0.5,
                door: { side: "S", center: 0, width: 6 } },
    armory:   roomAt(19, 29, -6, 8),
    mess:     roomAt(-29, -19, 6, 22),
    lounge:   roomAt(19, 29, 30, 44),
    workshop: roomAt(-42, -24, 58, 80),
  };

  /* ==========================================================
     2. ONE GRATE, SOLVED. `side` is the wall it sits in (N = the -z wall,
        S = +z, W = -x, E = +x) and `at` is the coordinate ALONG that wall.
        Everything else — plane, facing, crawl point — is derived.
     ========================================================== */
  const GH = 0.90;              // grate height (a duct a man crawls, not a door)
  const GW = 1.20;              // grate width
  const GY = 0.66;              // centre: sill clear of the skirting (0.16), head under the dado rail (1.26)
  const IN = 1.35;              // how far inside the room the crawl point lands
  const FW = 0.05, FD = 0.02, P = 0.01;   // grille flange width/depth; P: clear of a room dado

  const C_FRAME = 0x6b737c, C_VOID = 0x0b0d10;
  // the inward normal + the wall plane for one side of a rect
  function wall(room, side) {
    if (side === "W") return { px: +room.x0, pz: null, nx: 1, nz: 0, along: "z", a0: +room.z0, a1: +room.z1 };
    if (side === "E") return { px: +room.x1, pz: null, nx: -1, nz: 0, along: "z", a0: +room.z0, a1: +room.z1 };
    if (side === "N") return { px: null, pz: +room.z0, nx: 0, nz: 1, along: "x", a0: +room.x0, a1: +room.x1 };
    return { px: null, pz: +room.z1, nx: 0, nz: -1, along: "x", a0: +room.x0, a1: +room.x1 };
  }
  // does `at` fall inside this room's DOORWAY on this wall? A duct through a
  // door opening is the same mistake as a duct that misses its room.
  function inDoorway(room, side, at) {
    const d = room.door;
    if (!d || d.side !== side) return false;
    return Math.abs(at - (+d.center || 0)) < (+d.width || 0) / 2 + GW / 2 + 0.2;
  }

  // `lean` (+1/-1 along the wall's increasing coordinate) forces the side the
  // removed panel is leaned on, where the wall the solver sees is longer than
  // the bay the grille is really in (the cell wing's utility alcove).
  function grate(name, room, side, at, lean) {
    if (!room || !isFinite(+room.x0)) return null;
    const w = wall(room, side);
    // keep the grate off the corners — 1.1 m of return is what a wall needs to
    // still read as a wall on either side of an opening.
    const lo = Math.min(w.a0, w.a1) + 1.1, hi = Math.max(w.a0, w.a1) - 1.1;
    if (hi <= lo) { refused++; return null; }
    let a = Math.max(lo, Math.min(hi, at));
    if (inDoorway(room, side, a)) {
      // slide clear of the doorway rather than silently sitting in it; if the
      // wall is too short to hold both, refuse the grate and say so.
      const d = room.door, half = (+d.width || 0) / 2 + GW / 2 + 0.35;
      const lower = (+d.center) - half, upper = (+d.center) + half;
      a = (lower >= lo) ? lower : (upper <= hi ? upper : NaN);
      if (!isFinite(a)) { refused++; return null; }
    }
    const horiz = (side === "W" || side === "E");
    // step in off the declared plane to the wall's real INNER FACE, so the
    // grate is IN the masonry the player can see rather than inside it.
    const ins = (+room.inset || 0);
    const gx = horiz ? (w.px + w.nx * ins) : a;
    const gz = horiz ? a : (w.pz + w.nz * ins);

    // which side of the opening has more wall to lean the panel on, in the
    // grille's local +x (local +x = world (nz, -nx) for a frame turned by ry)
    const more = lean || ((Math.max(w.a0, w.a1) - a) >= (a - Math.min(w.a0, w.a1)) ? 1 : -1);
    const localX = horiz ? -w.nx : w.nz;          // the world "along" axis sign of local +x
    const panel = drawGrille(gx, gz, Math.atan2(w.nx, w.nz), more * localX);

    // ---- THE CRAWL POINT. On the INWARD normal, inside the room. This is the
    //      line the old file got wrong on three grates out of four.
    const vent = {
      x: gx + w.nx * IN,
      z: gz + w.nz * IN,
      y: 0.1,
      name: name,
      dest: null,
      grate: { x: gx, z: gz, side: side },
      room: room,
      mouth: { kind: "wall", x: gx, z: gz, nx: w.nx, nz: w.nz, y: GY, sill: GY - GH / 2 + FW },
      cover: cover(panel),
    };
    CBZ.vents.push(vent);
    solved.push(vent);
    return vent;
  }
  let refused = 0;

  // the removable louvre panel's two poses. Closed: in the frame, screwed.
  // Open: turned on its end and leaned on the wall beside the opening, its
  // foot on the floor (portrait, so it always fits the 1.1 m of wall the
  // solver keeps either side of a grille).
  const PH = (GW - 2 * FW) / 2;           // half the panel's long side (it sits inside the flange)
  const LEAN = Math.asin(0.24 / (2 * PH));
  function cover(panel) {
    const c = {
      open: false,
      set: function (v) {
        c.open = !!v;
        if (!panel) return;
        const p = panel.pivot, m = panel.mesh;
        if (c.open) {
          m.rotation.z = Math.PI / 2;
          p.rotation.x = -LEAN;
          p.position.set(panel.side * (GW / 2 + 0.1 + GH / 2), -GY + PH * Math.cos(LEAN) + 0.012, 0.03 + PH * Math.sin(LEAN) - (P + 0.012));
        } else {
          m.rotation.z = 0;
          p.rotation.x = 0;
          p.position.set(0, 0, 0);
        }
      },
    };
    return c;
  }

  /* ONE GRILLE, drawn in a local frame (x along the wall, +z out of it into
     the room) and turned onto the wall. The FRAME (a 50 mm steel flange round
     the opening) and the dark duct mouth are static and merged by the kit;
     the LOUVRE PANEL (its border, blades, mullion and four screw heads) is
     one merged mesh on a pivot so it can come off. Nothing here is solid
     (a grille in a wall is the wall). */
  let panelGeo = null;
  function louvreGeo() {
    if (panelGeo) return panelGeo;
    const parts = [];
    const add = (g, x, y, z, tilt) => { if (tilt) g.rotateX(tilt); g.translate(x, y, z); parts.push(g.index ? g.toNonIndexed() : g); };
    const iw = GW - 2 * FW, ih = GH - 2 * FW;
    // the panel's own border (it sits INSIDE the flange, a few mm proud of it)
    add(new THREE.BoxGeometry(iw, 0.03, 0.016), 0, ih / 2 - 0.015, 0);
    add(new THREE.BoxGeometry(iw, 0.03, 0.016), 0, -ih / 2 + 0.015, 0);
    add(new THREE.BoxGeometry(0.03, ih - 0.06, 0.016), -iw / 2 + 0.015, 0, 0);
    add(new THREE.BoxGeometry(0.03, ih - 0.06, 0.016), iw / 2 - 0.015, 0, 0);
    // louvre blades, 75 mm pitch, tipped 40 degrees so you see slots, not bars
    const n = Math.floor((ih - 0.06) / 0.075);
    for (let i = 0; i < n; i++) add(new THREE.BoxGeometry(iw - 0.06, 0.07, 0.004), 0, -ih / 2 + 0.03 + 0.0375 + i * 0.075, 0.002, -0.7);
    add(new THREE.BoxGeometry(0.02, ih - 0.06, 0.02), 0, 0, 0);                    // centre mullion
    // four pan-head screws through the border into the flange
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const g = new THREE.CylinderGeometry(0.009, 0.009, 0.006, 8); g.rotateX(Math.PI / 2);
      add(g, sx * (iw / 2 - 0.015), sy * (ih / 2 - 0.015), 0.011);
    }
    for (const g of parts) for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal" && k !== "uv") g.deleteAttribute(k);
    panelGeo = THREE.BufferGeometryUtils.mergeBufferGeometries(parts, false);
    return panelGeo;
  }
  function drawGrille(gx, gz, ry, side) {
    const frame = K ? K.skin("steel", C_FRAME) : CBZ.cmat(C_FRAME);
    const voidM = K ? K.skin("steel", C_VOID, 0.95) : CBZ.cmat(C_VOID);
    const put = (geo, lx, ly, lz, mat) => {
      geo.translate(lx, ly, lz);
      if (K) K.stat(geo, mat, gx, GY, gz, { ry: ry, cast: false });
      else { const m = new THREE.Mesh(geo, mat); m.position.set(gx, GY, gz); m.rotation.y = ry; scene.add(m); }
    };
    put(new THREE.PlaneGeometry(GW - FW, GH - FW), 0, 0, P + 0.002, voidM);                     // the duct mouth, dark
    put(new THREE.BoxGeometry(GW, FW, FD), 0, GH / 2 - FW / 2, P + FD / 2, frame);                 // flange: head
    put(new THREE.BoxGeometry(GW, FW, FD), 0, -GH / 2 + FW / 2, P + FD / 2, frame);                // sill
    put(new THREE.BoxGeometry(FW, GH - 2 * FW, FD), -GW / 2 + FW / 2, 0, P + FD / 2, frame);       // jambs
    put(new THREE.BoxGeometry(FW, GH - 2 * FW, FD), GW / 2 - FW / 2, 0, P + FD / 2, frame);
    // the removable panel: a group on the grille's frame, a pivot for the lean
    const base = new THREE.Group();
    base.position.set(gx, GY, gz); base.rotation.y = ry;
    base.userData.dynamic = true;
    const pivot = new THREE.Group();
    pivot.userData.dynamic = true;
    const mesh = new THREE.Mesh(louvreGeo(), frame);
    mesh.position.z = P + 0.012;
    mesh.castShadow = false; mesh.receiveShadow = true;
    mesh.userData.dynamic = true;
    pivot.add(mesh); base.add(pivot); scene.add(base);
    return { base: base, pivot: pivot, mesh: mesh, side: side || 1 };
  }

  /* ==========================================================
     2b. THE DUCT. One stretch of real sheet-metal duct, built once, parked
         70 m under the compound (out of every guard's sight range and every
         camera's), shown only while somebody is crawling it. It is the
         middle of every crawl: systems/interactions.js drives the prone body
         along it with the camera low behind his boots, toward the slots of
         the grille at the far end. Galvanised panels (BackSide: you are
         inside the box), a standing seam every 1.2 m, a dim leak of light so
         it is never pitch black. No lamp: the far grille IS the light.
     ========================================================== */
  CBZ.ventDuct = (function () {
    const DW = 0.82, DH = 0.74, DL = 9.0;
    const O = { x: 0, y: -70, z: 20 };                  // the near end; the duct runs toward -z
    const g = new THREE.Group();
    g.position.set(O.x, O.y, O.z);
    g.visible = false;
    g.userData.dynamic = true;
    const tag = (m) => { m.userData.dynamic = true; m.castShadow = false; m.receiveShadow = false; g.add(m); return m; };
    const skinM = K ? K.skin("galv", 0x8a9299) : CBZ.cmat(0x8a9299);
    const inner = skinM.clone();
    inner.side = THREE.BackSide;
    if (inner.emissive) inner.emissive.setHex(0x1c1f22);
    const shell = tag(new THREE.Mesh(new THREE.BoxGeometry(DW, DH, DL), inner));
    shell.position.set(0, DH / 2, -DL / 2);
    // standing seams: a flat bar round the inside every 1.2 m
    const seamM = K ? K.skin("steel", 0x5d656c) : CBZ.cmat(0x5d656c);
    const parts = [];
    for (let z = -1.2; z > -DL + 0.3; z -= 1.2) {
      for (const sy of [0.012, DH - 0.012]) { const b = new THREE.BoxGeometry(DW - 0.02, 0.012, 0.03); b.translate(0, sy, z); parts.push(b); }
      for (const sx of [-1, 1]) { const b = new THREE.BoxGeometry(0.012, DH - 0.02, 0.03); b.translate(sx * (DW / 2 - 0.012), DH / 2, z); parts.push(b); }
    }
    tag(new THREE.Mesh(THREE.BufferGeometryUtils.mergeBufferGeometries(parts, false), seamM));
    // the far grille: daylight through louvre slots (unlit: it IS the light)
    const c = document.createElement("canvas"); c.width = 64; c.height = 64;
    const x2 = c.getContext("2d");
    x2.fillStyle = "#15181b"; x2.fillRect(0, 0, 64, 64);
    x2.fillStyle = "#b9c0c6";
    for (let i = 0; i < 9; i++) x2.fillRect(4, 4 + i * 6.6, 56, 3);
    x2.fillStyle = "#15181b"; x2.fillRect(31, 0, 2, 64);
    const slots = tag(new THREE.Mesh(new THREE.PlaneGeometry(DW - 0.06, DH - 0.06), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c) })));
    slots.position.set(0, DH / 2, -DL + 0.01);
    scene.add(g);
    return {
      group: g, width: DW, height: DH, length: DL,
      // the world point `s` metres down the duct's centre line, on its floor
      at: function (s, out) { out = out || {}; out.x = O.x; out.y = O.y + 0.02; out.z = O.z - s; return out; },
      yaw: Math.PI,                       // a body facing down the duct (-z)
      show: function (v) { g.visible = !!v; },
    };
  })();

  /* ==========================================================
     3. THE THREE RUNS.
     ========================================================== */
  // T1 — THE SPINE. The cell wing's own utility alcove (cellblock.js WEST_ROW
  //      leaves the recess at z[-34.5,-30.9] for exactly this) into the armory. This
  //      is the keycard/gun-room chain's second door and the reason the owner
  //      ran the jail hundreds of times; it is the one run that must never be
  //      lockable, which is why it starts in an alcove and not in a cell.
  // -32.2: the middle of the alcove (z[-34.5,-30.9]); at -31 the 1.2 m grille
  // ran into the B-1 partition. Clear of the mop basin at z -33.8.
  const cellVent = grate("Cell Block Utility", ROOM.cell, "W", -32.2, -1);
  const armoryVent = grate("Armory Duct", ROOM.armory, "W", -3.2);
  if (cellVent && armoryVent) { cellVent.dest = armoryVent; armoryVent.dest = cellVent; }

  // T2 — THE KITCHEN EXTRACT. Every canteen has one and it runs to the staff
  //      side, because that is where the plant room is.
  const messExtract = grate("Kitchen Extract", ROOM.mess, "N", -24.5);
  const loungeVent = grate("Staff Lounge Riser", ROOM.lounge, "W", 41.6);
  if (messExtract && loungeVent) { messExtract.dest = loungeVent; loungeVent.dest = messExtract; }

  // T3 — THE LAUNDRY CRAWL, south block to the mess hall. This is what makes
  //      the mess a JUNCTION: two grates, two different walls, so the room is
  //      the hub and the hub is a place you stand in.
  const shopVent = grate("Workshop Laundry Crawl", ROOM.workshop, "N", -33);
  const messRiser = grate("Mess Hall Riser", ROOM.mess, "S", -22.5);
  if (shopVent && messRiser) { shopVent.dest = messRiser; messRiser.dest = shopVent; }

  /* ==========================================================
     4. THE RATCHET. Numbers, not screenshots.
        anchored     — grates solved off a real room rect (may only go UP)
        outsideDest  — crawl points that do NOT land inside the room they are
                       named after. THE OLD FILE SCORED 3. Pinned at 0.
        inDoorways   — grates sharing an opening with their room's door. 0.
        hubs         — rooms carrying more than one grate (the mess hall).
     ========================================================== */
  CBZ.ventAudit = function () {
    let outside = 0, doorways = 0, paired = 0;
    const perRoom = new Map();
    for (let i = 0; i < solved.length; i++) {
      const v = solved[i], r = v.room;
      if (!(v.x > +r.x0 && v.x < +r.x1 && v.z > +r.z0 && v.z < +r.z1)) outside++;
      if (inDoorway(r, v.grate.side, v.grate.side === "W" || v.grate.side === "E" ? v.grate.z : v.grate.x)) doorways++;
      if (v.dest) paired++;
      perRoom.set(r, (perRoom.get(r) || 0) + 1);
    }
    let hubs = 0;
    perRoom.forEach(function (n) { if (n > 1) hubs++; });
    return {
      vents: solved.length,
      anchored: solved.length,          // every V2 grate is solved off a rect
      outsideDest: outside,             // MUST be 0
      inDoorways: doorways,             // MUST be 0
      paired: paired,
      hubs: hubs,                       // the mess hall
      rooms: perRoom.size,
      refused: refused,
      shells: SHELLS.length,
    };
  };
  });
})();
