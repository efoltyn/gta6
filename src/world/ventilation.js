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
   z = -31 precisely so this route can never be locked away).

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

   REVERT: CBZ.CONFIG.PRISON_VENTS_V2 = false restores the original four
   hard-coded grates, byte for byte, exit-point bug included.
   Ratchet: CBZ.ventAudit() — `anchored` (grates solved off a real room rect)
   may only go UP, and `outsideDest` (crawl points that do not land inside the
   room they are named after) is pinned at 0.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.scene) return;
  const scene = CBZ.prisonRoot || CBZ.scene;
  const { addBox } = CBZ;

  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.PRISON_VENTS_V2 == null) CBZ.CONFIG.PRISON_VENTS_V2 = true;

  CBZ.vents = CBZ.vents || [];   // world/prisonkit.js's tower ladders are vents too, registered before this parses
  const solved = [];        // every grate this file placed, for the audit

  /* ----------------------------------------------------------
     LEGACY — the original file, kept callable so the flag is a true
     one-line revert and the before-state stays inspectable.
     ---------------------------------------------------------- */
  function buildLegacy() {
    function makeGrate(x, y, z, ax, name) {
      const w = ax === "x" ? 0.1 : 1.2;
      const d = ax === "x" ? 1.2 : 0.1;
      addBox(x, y, z, w, 1.2, d, 0x515a66, { solid: false, cast: false });
      for (let i = -2; i <= 2; i++) {
        const sx = ax === "x" ? x : x + i * 0.22;
        const sz = ax === "x" ? z + i * 0.22 : z;
        addBox(sx, y, sz, ax === "x" ? 0.12 : 0.14, 1.0, 0.08, 0x1a1d22, { cast: false });
      }
      const vent = {
        x: x + (ax === "x" ? (x < 0 ? 1.2 : -1.2) : 0),
        z: z + (ax === "z" ? (z < 0 ? 1.2 : -1.2) : 0),
        y: 0.1, name: name, dest: null,
      };
      CBZ.vents.push(vent);
      return vent;
    }
    const cellVent = makeGrate(-15.4, 0.8, -31, "x", "Cell Block Aisle");
    const armoryVent = makeGrate(18.6, 0.8, -4.5, "x", "Locked Armory");
    cellVent.dest = armoryVent; armoryVent.dest = cellVent;
    const cafeVent = makeGrate(-18.6, 0.8, 8.5, "x", "Mess Hall");
    const loungeVent = makeGrate(18.6, 0.8, 41.5, "x", "Staff Lounge");
    cafeVent.dest = loungeVent; loungeVent.dest = cafeVent;
  }

  if (CBZ.CONFIG.PRISON_VENTS_V2 === false) {
    buildLegacy();
    CBZ.ventAudit = function () {
      return { v2: false, vents: CBZ.vents.length, anchored: 0, outsideDest: 0, hubs: 0, rooms: 0, refused: 0 };
    };
    return;
  }

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
  const GH = 1.05;              // grate height (a duct a man crawls, not a door)
  const GW = 1.20;              // grate width
  const GY = 0.62;              // centre height: LOW on the wall, where a duct is
  const IN = 1.35;              // how far inside the room the crawl point lands
  const WT = 0.16;              // how deep the grate sits into the masonry

  const C_FRAME = 0x515a66, C_SLAT = 0x1a1d22, C_SCREW = 0x8b95a1;

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

  function grate(name, room, side, at) {
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

    // ---- the mesh. FLUSH: the frame's centre is pushed HALF ITS DEPTH into the
    //      masonry along the inward normal, so its outer face is the wall face.
    const fx = gx + w.nx * (WT / 2), fz = gz + w.nz * (WT / 2);
    const fw = horiz ? WT : GW, fd = horiz ? GW : WT;
    addBox(fx, GY, fz, fw, GH, fd, C_FRAME, { solid: false, cast: false });
    // recessed dark throat behind the slats — what makes it read as a HOLE
    addBox(gx + w.nx * (WT * 1.4), GY, gz + w.nz * (WT * 1.4),
      horiz ? WT : GW - 0.16, GH - 0.14, horiz ? GW - 0.16 : WT, 0x0a0d11, { cast: false });
    // ---- louvred slats, angled-looking (four thin bars) + four corner screws
    for (let i = -2; i <= 2; i++) {
      const sy = GY + i * 0.19;
      if (Math.abs(sy - GY) > GH / 2 - 0.10) continue;
      addBox(gx + w.nx * 0.03, sy, gz + w.nz * 0.03,
        horiz ? 0.06 : GW - 0.14, 0.075, horiz ? GW - 0.14 : 0.06, C_SLAT, { cast: false });
    }
    for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
      const oa = sa * (GW / 2 - 0.12), ob = sb * (GH / 2 - 0.11);
      addBox(gx + w.nx * 0.02 + (horiz ? 0 : oa), GY + ob, gz + w.nz * 0.02 + (horiz ? oa : 0),
        horiz ? 0.05 : 0.07, 0.07, horiz ? 0.07 : 0.05, C_SCREW, { cast: false });
    }

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
    };
    CBZ.vents.push(vent);
    solved.push(vent);
    return vent;
  }
  let refused = 0;

  /* ==========================================================
     3. THE THREE RUNS.
     ========================================================== */
  // T1 — THE SPINE. The cell wing's own utility alcove (cellblock.js WEST_ROW
  //      leaves the recess at z = -31 for exactly this) into the armory. This
  //      is the keycard/gun-room chain's second door and the reason the owner
  //      ran the jail hundreds of times; it is the one run that must never be
  //      lockable, which is why it starts in an alcove and not in a cell.
  const cellVent = grate("Cell Block Utility", ROOM.cell, "W", -31);
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
      v2: true,
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
})();
