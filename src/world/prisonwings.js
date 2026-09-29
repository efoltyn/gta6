/* ============================================================
   world/prisonwings.js — THE COMPOUND GETS ITS REAL SIZE.

   OWNER (2026-08-11): "the prison game should be bigger … think of scale of
   human vs prison size and really make it bigger adding rooms — don't worry
   too much about design of rooms, worry about SCALE and INTERACTABLE THINGS
   THAT MATTER. The armoury is a great example of something that matters
   hugely: you need a key to get in and then you get guns, it's awesome."

   ---- WHAT WAS ACTUALLY WRONG: A MAN IS 1.82 m AND THE PRISON WAS 1.8 ha ---
   Measured before a wall was drawn. The whole compound was
       admin      40 x 20      cell wing  32 x 36
       north yard 60 x 60      south block 88 x 76
   i.e. 92 m across and 195 m deep — 1.79 hectares inside the wire, and the
   longest walk in the game (the freedom gate to the warden's desk) is 195 m,
   about sixty-five seconds. A real medium-security facility is 20-60 ha and
   its secure perimeter alone runs 300-400 m a side; even the tightest urban
   jail is three or four times what this was. At 1.82 m per body the old yard
   was FIFTY body-lengths across. That is a car park with walls on it, and it
   is why the place reads small no matter how well the rooms are dressed.

   ---- THE ONE RULE THAT MADE THIS SAFE: HOLD EVERY AUTHORED COORDINATE ----
   world/layout.js's stage-5 desert is the precedent, and it is stated there:
   a 10x basin worked because it grew EAST AND SOUTH off a held north-west
   corner, so every dock, strait and causeway that had already been measured
   stayed measured. The same discipline applies here and is the reason this
   file exists at all rather than a rewrite of five others:

     NOT ONE EXISTING PRISON COORDINATE MOVES. The cell wing, the admin wing,
     the north yard, the south block, both yard gates, the armoury, the
     chapel, the workshop, the infirmary, the laundry, the dorm, the sally
     port, the freedom gate, CBZ.SPAWN, every escape route, every ventilation
     crawl, every patrol waypoint and every propuse anchor are byte-identical.

   The compound GROWS AROUND them. A new outer perimeter is thrown at
   x +-124, z -116..128, and what was the yard's own boundary wall becomes an
   INTERNAL division fence — which is what a real prison has, and which is
   why the four new gates below are worth something. The freedom gate does
   not move either: the south wall at z=128 is still the outside, the new
   south wall is simply the same line carried out to the corners.

       inside the wire   92 x 195  ->  248 x 244        1.79 ha -> 6.05 ha
       longest walk         195 m  ->  ~350 m           (corner to corner)

   ---- INTERACTABLE THINGS THAT MATTER: THE LADDER, NOT NEW KEYS -----------
   The armoury works because of a LADDER (world/gunroom.js): a lock you can
   see through, a key you have to take off a person, and a category change
   when you get it. The cheap way to fill 4 ha would have been four new key
   items. That is exactly wrong — it dilutes the one key the whole game is
   built around. So this file invents NO item. It hangs six new doors off the
   three answers the prison already has, and every one of them is now worth
   more than it was yesterday:

     KEYCARD (tier 1, already the spine)  the FOUR SALLY GATES between the
        old compound and the new wings, and the segregation control door.
        The card used to open one door; it now opens the map.
     LOCKPICK (tier 2, world/adminwing.js gave it its first verb) the TOOL
        CRIB (3.2 s), the KNIFE CAGE (4.4 s) and the PROPERTY ROOM (5.6 s) —
        three caged rooms you can see into, each holding a specific thing.
     GUN-ROOM KEY (tier 3, off the warden) CENTRAL CONTROL. The bubble is the
        second armoury: from the console every locked door in the compound —
        the yard door, all four sally gates, the segregation control — throws
        at once. The top key now has a top ROOM.

   Every one of them also states a price in pounds of C4 (systems/breach.js),
   because that is the shared unit and declaring it is one line.

   ---- WHAT IS BEHIND EACH LOCK, AND WHY IT IS THAT ------------------------
   Rule (a) of the gun-room grammar is that you can SEE the prize through the
   lock, so every cage below is BARS on a transparent collider pane, never a
   slab, and everything inside is a real placed object (CBZ.prisonPlaceItem)
   lying where it lies — never a payout roll.

     TOOL CRIB (industries)   Hacksaw Blade, Lockpick, Pickaxe — the escape
                              tools, in the room a prison actually keeps them
                              in, behind the cage a prison actually uses.
     KNIFE CAGE (kitchen)     Shiv, Razor Blade, Hatchet. A kitchen is where
                              the edged weapons in a prison come from.
     PROPERTY ROOM (visits)   Stolen Wallet, Cash Roll, Luxury Watch, Burner
                              Phone — what was taken off men on the way in.
     SEGREGATION              Contraband Map, in the one block nobody walks.

   ---- FLAGS AND THE REVERT ----------------------------------------------
   PRISON_WINGS_V1 = false  -> this file draws nothing and world/yard.js's
   walls close back up (it reads the same flag for its four gate gaps), so
   the compound is byte-for-byte the 1.8 ha it was. One line.

   Ratchet: CBZ.prisonWingsAudit() — `unreachable` (a locked thing with no
   route in the build) and `orphanGates` (a gap cut in a wall with no gate
   in it, i.e. a hole in the perimeter) and `doorsInWalls` (a leaf that
   swings inside somebody else's collider) all pinned at 0.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.addBox || !CBZ.WORLD || !CBZ.roomShell) return;
  const THREE = window.THREE;
  const { addBox } = CBZ;
  const ROOT = CBZ.prisonRoot || CBZ.scene;
  const PD = CBZ.prisonDress || null;              // world/cafeteria.js; degrade-safe

  CBZ.CONFIG = CBZ.CONFIG || {};
  // Declared with the idempotent `== null` idiom world/southblock.js documents:
  // world/yard.js parses BEFORE this file and reads the same flag for its gate
  // gaps, so whichever runs first sets it and the other no-ops.
  if (CBZ.CONFIG.PRISON_WINGS_V1 == null) CBZ.CONFIG.PRISON_WINGS_V1 = true;
  if (!CBZ.CONFIG.PRISON_WINGS_V1) return;

  const OUT = CBZ.WORLD.wings || { x0: -124, x1: 124, z0: -116, z1: 128 };
  const N = CBZ.WORLD.northYard, S = CBZ.WORLD.southBlock;
  const YH = (CBZ.DIM && CBZ.DIM.YH) || 11;
  const WALL = (CBZ.COL && CBZ.COL.WALL) || 0x9aa0a8;
  const TRIM = (CBZ.COL && CBZ.COL.TRIM) || 0xb44534;

  /* ==========================================================
     1. THE OUTER PERIMETER. Same one-line policy world/yard.js states and
        for the same reason: `noBreach` on every segment. The blast still
        scars it, shakes the camera and throws debris — it does not open.
        Delete that line and the escape game collapses into one verb.
     ========================================================== */
  const K = CBZ.prisonKit;
  // as tall as it is drawn: the wall and the heavier coil on its coping
  // (razorwire.js: centre YH + 0.55, radius 0.45), not a slab to the sky
  // (see world/yard.js), and no climbing through the wire
  function perim(x, z, w, d) {
    const m = addBox(x, YH / 2, z, w, YH, d, WALL, { solid: true, blockLOS: true, y0: 0, y1: YH + 1.0 });
    if (m && m.userData && m.userData.collider) { m.userData.collider.noBreach = true; m.userData.collider.noClimb = true; }
    if (K) K.skinBox(m, "panel", WALL);               // precast panels, joints in world metres
    return m;
  }
  // a concrete coping on the wall top, not a red stripe: it is what a wall has
  function trim(x, z, len, ax) {
    const m = ax === "z" ? addBox(x, YH + 0.18, z, 1.5, 0.36, len, 0x8f959c, { cast: false })
      : addBox(x, YH + 0.18, z, len, 0.36, 1.5, 0x8f959c, { cast: false });
    if (K) K.skinBox(m, "concrete", 0x9ea3a8);
  }
  const OW = OUT.x1 - OUT.x0, OD = OUT.z1 - OUT.z0;
  const OCX = (OUT.x0 + OUT.x1) / 2, OCZ = (OUT.z0 + OUT.z1) / 2;
  perim(OUT.x0, OCZ, 1, OD);                       // west
  perim(OUT.x1, OCZ, 1, OD);                       // east
  /* THE NORTH WALL HAS A VEHICLE GATE. A prison this size takes trucks in
     through a sally port, not through the freedom gate; the gap is a fixed
     span of the north wall and world/prisongrounds.js stands the port in it
     — two solid steel leaves, shut, `noBreach`, LOS-blocking, so the
     perimeter is exactly as closed as it was (it is drawn as a gate; it
     behaves as the wall). Published so razorwire.js leaves the span clear. */
  const VG = CBZ.prisonVehicleGate = { x0: 92, x1: 112, z: OUT.z0 };
  perim((OUT.x0 + VG.x0) / 2, OUT.z0, VG.x0 - OUT.x0, 1);   // north, west of the gate
  perim((VG.x1 + OUT.x1) / 2, OUT.z0, OUT.x1 - VG.x1, 1);   // north, east of it
  trim(OUT.x0, OCZ, OD, "z"); trim(OUT.x1, OCZ, OD, "z");
  trim((OUT.x0 + VG.x0) / 2, OUT.z0, VG.x0 - OUT.x0, "x"); trim((VG.x1 + OUT.x1) / 2, OUT.z0, OUT.x1 - VG.x1, "x");
  // SOUTH: the existing wall (world/yard.js) already closes x[-44,44] and owns
  // the freedom gate. Only the two new shoulders out to the corners are ours,
  // so the gate keeps its exact geometry, its exact gap and its exact meaning.
  // Two more sally ports stand in this wall (world/corridors.js, at ±50):
  // each is a gap the building's own noBreach walls and grille close.
  const PORT = CBZ.prisonSpinePorts = { x: 50, half: 4.6 };
  for (const s of [-1, 1]) {
    const a = s < 0 ? OUT.x0 : S.x1, b = s < 0 ? S.x0 : OUT.x1;
    const g0 = s * PORT.x - PORT.half, g1 = s * PORT.x + PORT.half;
    for (const r of [[a, Math.min(b, g0)], [Math.max(a, g1), b]]) {
      if (r[1] - r[0] < 0.5) continue;
      perim((r[0] + r[1]) / 2, OUT.z1, r[1] - r[0], 1);
      trim((r[0] + r[1]) / 2, OUT.z1, r[1] - r[0], "x");
    }
  }

  /* ---- ground. The new wings are hardstanding, not grass: a prison yard is
       poured, and world/ground.js's own texture verb keeps the two halves of
       the compound reading as one surface. Four slabs, laid AROUND the old
       compound so nothing is drawn twice over authored paving. ---- */
  // OUTDOOR hardstanding: sRGB-tagged with real poured-concrete tones, the
  // same path world/southblock.js's apron and prisonkit's ground() take (it
  // was untagged #5b636c, which the sRGB output lifted to a pale blue sheet).
  // Tiles stay SQUARE (6.3 m, two pours per tile) and the slab is the lowest
  // layer, pushed back in depth so every patch laid on it wins at distance.
  function slab(x, z, w, d, a, b, kind) {
    const tex = CBZ.prisonGroundTex ? CBZ.prisonGroundTex(kind || "concrete", { a: a, b: b, srgb: true })
      : (CBZ.checkerTex ? CBZ.checkerTex(a, b, 2) : null);
    if (!tex) return null;
    tex.repeat.set(Math.max(1, Math.round(w / 6.3)), Math.max(1, Math.round(d / 6.3)));
    const mat = new THREE.MeshLambertMaterial({ map: tex });
    mat.polygonOffset = true; mat.polygonOffsetFactor = 10; mat.polygonOffsetUnits = 20;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.011, z);
    m.receiveShadow = true; ROOT.add(m);
    return m;
  }
  const GA = "#8a8c87", GB = "#81837e";
  slab((OUT.x0 + S.x0) / 2, (N.z0 + OUT.z1) / 2, S.x0 - OUT.x0, OUT.z1 - N.z0, GA, GB, "concrete");   // west wing
  slab((S.x1 + OUT.x1) / 2, (N.z0 + OUT.z1) / 2, OUT.x1 - S.x1, OUT.z1 - N.z0, GA, GB, "concrete");   // east wing
  /* THE NORTH GROUND STOPS AT THE CELL HOUSE. This slab used to run the full
     width from the outer wire to the yard's north edge — straight UNDER the
     cell block, 1 mm above the block's own floor (world/ground.js, top at
     y 0.01) — so what you saw inside the wing was this yard hardstanding,
     bleeding through the building, and the wing's floor was never once
     visible. Three pieces now: everything north of the block, and a strip
     either side of it. The block's footprint is CBZ.WORLD.cellBlock. */
  const CBK = CBZ.WORLD.cellBlock || { x0: -16, x1: 16, z0: -44, z1: -8 };
  slab(OCX, (OUT.z0 + CBK.z0) / 2, OW, CBK.z0 - OUT.z0, GA, GB, "concrete");                          // north of the block
  slab((OUT.x0 + CBK.x0) / 2, (CBK.z0 + N.z0) / 2, CBK.x0 - OUT.x0, N.z0 - CBK.z0, GA, GB, "concrete"); // west of it
  slab((CBK.x1 + OUT.x1) / 2, (CBK.z0 + N.z0) / 2, OUT.x1 - CBK.x1, N.z0 - CBK.z0, GA, GB, "concrete"); // east of it

  /* ---- corner towers. world/towers.js rings the OLD wall; these four
       stand on the outer wire's corners so the enlarged perimeter is
       watched rather than merely long. world/prisonkit.js's tower, set back
       off the corner, its catwalk out over both walls: over the rail on the
       outside is out of the prison (a twelve-metre drop). NOT registered in
       CBZ.towers (capture.js's fallback fire and the four searchlights are
       the old posts'), but MANNED: an officer with a carbine on each
       (entities/towerwatch.js), because a corner of the wire nobody stands
       on is not a corner, it is the way out. ---- */
  if (CBZ.guardTower) {
    for (const cx of [-1, 1]) for (const cz of [-1, 1]) {
      const l = Math.SQRT1_2;
      CBZ.guardTower(cx < 0 ? OUT.x0 : OUT.x1, cz < 0 ? OUT.z0 : OUT.z1, {
        register: false, manned: true, inward: { x: -cx, z: -cz }, perimeter: { x: cx * l, z: cz * l },
      });
    }
  }

  /* ==========================================================
     2. THE DOOR PRIMITIVE. One shape for every lock in this file, and it is
        world/adminwing.js's verbatim: a leaf on a pivot, its collider
        SPLICED in and out of CBZ.colliders (never merely hidden), the LOS
        blocker moved with it, and a status lamp that is the entire HUD.

        `bars` (the three cages only) hangs the kit's barred leaf, which you
        see and shoot through and which never blocks sight — gun-room
        grammar rule (a): you must be able to SEE what the lock is holding.
        Everything else is the kit's steel detention door.
     ========================================================== */
  const DH = 2.6;
  const doors = [];
  /* THE LEAVES (2026-09-28). This primitive hung a slab (or a 6 m grille)
     on a pivot at the wall's CENTRE LINE, in a raw hole, and swung it 109
     degrees: past square, back through the wall it stood in. The sally gates
     were single 6 m leaves. Every leaf now hangs in a real door set
     (world/corridorkit.js's CBZ.corridorKit.doorSet: frame, stop,
     architraves, three hinges at the face it opens to), openings wider than
     2.4 m are a PAIR, and open means square to the wall. The lock is a lock
     box on the lock stile with a 20 mm LED lens in it (it was a 13 cm
     glowing cube). */
  const CK = CBZ.corridorKit;
  /* cfg { id, label, keys, pick, bars, lb, axis, a0, a1, fixed, t (wall), h,
          color, top (wall height to fill to), wall (its colour) }
     THE LEAVES ARE THE KIT'S (world/corridorkit.js): a steel detention leaf,
     or — for a CAGE, the one place in this file bars stay — the kit's
     remade barred leaf. An opening wider than a real pair (2.4 m) gets block
     infill either side instead of a 3 m leaf. */
  function makeDoor(cfg) {
    let a0 = cfg.a0, a1 = cfg.a1;
    if (!cfg.bars && a1 - a0 > 2.5) {
      const mid = (a0 + a1) / 2;
      CK.infill({ axis: cfg.axis || "x", a0: a0, a1: a1, c0: mid - 1.2, c1: mid + 1.2, fixed: cfg.fixed, t: cfg.t || 0.5,
        top: cfg.top || cfg.h || DH, head: cfg.h || DH, color: cfg.wall != null ? cfg.wall : WALL, skin: "panel" });
      a0 = mid - 1.2; a1 = mid + 1.2;
    }
    const d = {
      id: cfg.id, label: cfg.label, keys: cfg.keys || null, pick: cfg.pick || 0,
      open: false, t: 0, picked: 0, blown: false, shutT: 0,
      axis: cfg.axis || "x",                       // 'x' = the opening runs along x
      a0: a0, a1: a1, fixed: cfg.fixed,
    };
    d.x = d.axis === "x" ? (a0 + a1) / 2 : cfg.fixed;
    d.z = d.axis === "x" ? cfg.fixed : (a0 + a1) / 2;
    const T = cfg.t || 0.5, pair = a1 - a0 > 1.6, hold = {};
    // the leaves open to local +z, the side the old pivot swung them to
    const lockOn = pair ? 1 : 0;
    d.set = CK.doorSet({ axis: d.axis, a0: a0, a1: a1, fixed: cfg.fixed, t: T, h: cfg.h || DH,
      open: 1, hinge: pair ? 0 : -1, frame: 0x39424e,
      build: cfg.bars ? CK.barLeaf({ hold: hold, lockOn: lockOn })
        : CK.detentionLeaf({ color: cfg.color, hold: hold, lockOn: lockOn }) });
    if (!cfg.bars && cfg.keys && cfg.keys.indexOf("Keycard") >= 0) {
      // the card reader on each face of the lock jamb
      const lx = a1 + 0.36;
      for (const s of [-1, 1]) {
        if (d.axis === "x") CK.cardReader(lx, 1.2, cfg.fixed + s * T / 2, 0, s);
        else CK.cardReader(cfg.fixed + s * T / 2, 1.2, lx, s, 0);
      }
    }
    d.pivots = d.set.leaves.map(function (L) { return L.pivot; });
    // a steel leaf blocks sight when shut; bars never did
    const leafMeshes = d.set.leaves.map(function (L) { return L.slab; }).filter(Boolean);
    d.slabs = cfg.bars ? [] : leafMeshes;
    d.lamp = hold.lamp || null;
    const leaf = leafMeshes[0] || d.pivots[0];
    d.leaf = leaf;
    // the shut leaf: its own slab, floor to frame head (world/corridorkit.js
    // leafCollider), not the wall's whole depth to the sky
    d.collider = CK.leafCollider(d.set, a0, a1, 0, cfg.h || DH, leaf);
    CBZ.colliders.push(d.collider);
    if (CBZ.losBlockers) for (const sl of d.slabs) CBZ.losBlockers.push(sl);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    d.setOpen = function (v, quiet) {
      v = !!v;
      if (v === d.open) return v;
      d.open = v;
      // SOLID UNTIL IT HAS MOVED: an opening leaf keeps its collider until it
      // has swung 40% clear (the tick below drops it); a blown one is a hole
      // now, and a closing one is solid at once.
      const i = CBZ.colliders.indexOf(d.collider);
      if (v && i >= 0 && d.blown) CBZ.colliders.splice(i, 1);
      else if (!v && i < 0) CBZ.colliders.push(d.collider);
      if (CBZ.losBlockers) for (const sl of d.slabs) {
        const li = CBZ.losBlockers.indexOf(sl);
        if (v && li >= 0) CBZ.losBlockers.splice(li, 1);
        else if (!v && li < 0) CBZ.losBlockers.push(sl);
      }
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
      if (d.lamp) {
        d.lamp.material.color.setHex(v ? 0x39ff88 : 0xff3b3b);
        d.lamp.material.emissive.setHex(v ? 0x14c258 : 0xff0000);
      }
      if (!quiet && CBZ.worldSfx) CBZ.worldSfx(v ? "door_open" : "door_close", d.x, d.z, { ref: 10 });
      if (!v) d.picked = 0;
      return v;
    };
    // ---- the breach route, one line, in the shared unit (systems/breach.js).
    // 5 lb is the doctrinal row for an opening one man moves through
    // (FM 90-10-1 app.M) — the same row the yard door and the staff door
    // already declare. A CAGE is lighter mesh on a lighter frame, so it takes
    // the 2 lb mousehole row plus the man-sized row's own reach: 5 lb either
    // way keeps one number in the player's head.
    if (CBZ.registerBreachTarget) {
      CBZ.registerBreachTarget({
        id: d.id, lb: cfg.lb || 5, reach: 2.6,
        at: function () { return { x: d.x, y: 1.4, z: d.z }; },
        done: function () { return d.open; },
        defeat: function () {
          d.blown = true; d.setOpen(true);
          const i = CBZ.colliders.indexOf(d.collider);
          if (i >= 0) { CBZ.colliders.splice(i, 1); if (CBZ.markCollidersDirty) CBZ.markCollidersDirty(); }
          for (const p of d.pivots) p.visible = false;
        },
      });
    }
    /* ---- AND A WAY TO SHUT IT ------------------------------------------
       One declaration per leaf into systems/interactions.js's shared door
       registry, so a tap on the bars and the polled [E] both end in the
       setOpen above — this file gains no second implementation of "open".
       The credential is the SAME test the tick below runs: a card door wants
       the Keycard (or the uniform), a cage wants the Lockpick that picks it.
       `openByTap` is false for the cages: their opening is a hold-to-defeat
       beat and a tap must not shortcut 3.2-5.6 seconds of work.
       `permanent` covers both irreversible states — a blown leaf and the
       control-room release, which are holes, not doors. */
    (CBZ._prisonDoorSpecs || (CBZ._prisonDoorSpecs = [])).push({
      id: d.id, label: d.label, autoR: 2.5, openByTap: !d.pick,   // tick opens at near2 < 6.2
      keyed: !!(d.keys || d.pick),   // needs a card or a pick (systems/prisondoorwatch.js)
      at: function () { return { x: d.x, y: 1.4, z: d.z }; },
      pick: function () { return d.pivots; },
      col: function () { return d.collider; },
      isOpen: function () { return !!d.open; },
      permanent: function () { return !!(d.blown || RELEASE.thrown); },
      canUse: function () {
        if (d.keys) return !!(CBZ.game && (CBZ.game.hasKey || (CBZ.prisonStaffKey ? CBZ.prisonStaffKey() : CBZ.game.role === "cop")));
        const econ = CBZ.econ;
        return !!(econ && econ.hasItem && econ.hasItem("Lockpick"));
      },
      set: function (v) { d.setOpen(v); return d.open === !!v; },
    });
    doors.push(d);
    return d;
  }

  /* ==========================================================
     3. THE FOUR SALLY GATES — what makes the enlargement a MAP rather than
        a bigger empty field.

        world/yard.js leaves a 6 m gap in each of the four inner boundary
        walls when this flag is on (it reads PRISON_WINGS_V1, declared
        above). This file is what stands in the gaps; if it did not, the
        compound would have four holes in it, which is why the audit counts
        exactly that (`orphanGates`).

        They take the KEYCARD — deliberately the card the whole escape game
        already hunts. A key that opens one door is an errand; a key that
        opens the map is the reason the owner ran the jail for hours.
     ========================================================== */
  const GATE_W = 6;
  const GATES = [
    { id: "prison-sally-w1", label: "The west yard gate", axis: "z", fixed: N.x0, c: 22 },
    { id: "prison-sally-e1", label: "The east yard gate", axis: "z", fixed: N.x1, c: 22 },
    { id: "prison-sally-w2", label: "The lower west gate", axis: "z", fixed: S.x0, c: 84 },
    { id: "prison-sally-e2", label: "The lower east gate", axis: "z", fixed: S.x1, c: 84 },
  ];
  const gates = GATES.map(function (g) {
    // the wall above the opening, up under the coping: solid as drawn
    // (2026-09-29; it was LOS-only, so a body falling past it from a tower
    // went through eight metres of drawn wall). Banded from the door head,
    // so it clears every body walking through (systems/actorcollide.js and
    // the movers honour y0/y1).
    const head = addBox(g.fixed, (DH + YH) / 2, g.c, 1, YH - DH, GATE_W, WALL, { cast: false, blockLOS: true, solid: true, y0: DH, y1: YH + 0.36 });
    head.userData.doorHead = true;
    if (head.userData.collider) { head.userData.collider.noBreach = true; head.userData.collider.noClimb = true; head.userData.collider.doorHead = true; }
    // (2026-09-29: the 6 m barred pair and the steel lintel over it are
    // gone. The gap is walled either side of a 2.4 m steel pair, card
    // readers on the jamb, the way a yard door in a wall is actually built.)
    if (PD && PD.lamp) { try { PD.lamp(g.fixed + 0.56, 3.0, g.c, "x+"); } catch (e) {} }
    return makeDoor({
      id: g.id, label: g.label, keys: ["Keycard"], lb: 5,
      axis: "z", a0: g.c - GATE_W / 2, a1: g.c + GATE_W / 2, fixed: g.fixed, t: 1, top: DH,
    });
  });

  /* ==========================================================
     4. THE ROOMS. Owner: "don't worry too much about design of rooms, worry
        about scale and interactable things that matter." So each room below
        is a SHELL, a ROOF, one shared furnishing call, and then the thing it
        is actually for. Nothing here hand-authors a chair the kit ships.
     ========================================================== */
  const rooms = [];
  function room(cfg) {
    CBZ.roomShell({
      x0: cfg.x0, x1: cfg.x1, z0: cfg.z0, z1: cfg.z1, h: cfg.h,
      wall: cfg.wall, floor: cfg.fin && PD && PD.finish ? null : cfg.floor, skin: null,
      doors: [{ side: cfg.side, center: cfg.dc, width: cfg.dw }],
    });
    if (CBZ.prisonRoof) CBZ.prisonRoof({
      id: cfg.id, x0: cfg.x0, x1: cfg.x1, z0: cfg.z0, z1: cfg.z1, top: cfg.h, over: 0.25,
      soffit: cfg.fin ? false : undefined,
    });
    /* THE FINISH (2026-09-27): a real floor, block walls (no skin: world/
       prisonlook.js paints an unskinned slab as block), base + dado, and a
       closed ceiling at the room's REAL height with its fittings, instead of
       precast panels to 7 m and fluorescent sticks hung under the roof. */
    if (cfg.fin && PD && PD.finish) {
      PD.finish({ x0: cfg.x0 + 0.25, x1: cfg.x1 - 0.25, z0: cfg.z0 + 0.25, z1: cfg.z1 - 0.25 },
        Object.assign({ id: cfg.id, base: 0x2b2d30,
          doors: [{ side: cfg.side, a0: cfg.dc - cfg.dw / 2, a1: cfg.dc + cfg.dw / 2 }] }, cfg.fin));
    }
    // A DOORWAY NEEDS A HEAD. roomShell splits its wall floor-to-top for the
    // gap, so without this every door in the new wings is an h-metre slot.
    const east = cfg.side === "E", west = cfg.side === "W";
    let headBox;
    if (east || west) {
      const wx = east ? cfg.x1 : cfg.x0;
      headBox = addBox(wx, (3.1 + cfg.h) / 2, cfg.dc, 0.5, cfg.h - 3.1, cfg.dw, cfg.wall, { cast: false });
    } else {
      const wz = cfg.side === "N" ? cfg.z0 : cfg.z1;
      headBox = addBox(cfg.dc, (3.1 + cfg.h) / 2, wz, cfg.dw, cfg.h - 3.1, 0.5, cfg.wall, { cast: false });
    }
    if (K) K.skinBox(headBox, "panel", cfg.wall);
    // the interior lives on the shared schedule: a strip drawn through
    // CBZ.prisonDress dies at lights-out for free (world/roofs.js flushes it).
    if (!cfg.fin && PD && typeof PD.strip === "function") {
      const w = cfg.x1 - cfg.x0, dd = cfg.z1 - cfg.z0;
      const along = w >= dd ? "x" : "z";
      const n = Math.max(3, Math.min(9, Math.round(Math.max(w, dd) / 7)));
      const len = Math.max(1.8, Math.min(4.2, (along === "x" ? w : dd) * 0.16));
      const rows = (along === "x" ? dd : w) > 14 ? 2 : 1;
      for (let r = 0; r < rows; r++) {
        const t = rows === 1 ? 0.5 : (r + 1) / (rows + 1);
        for (let i = 0; i < n; i++) {
          const u = (i + 1) / (n + 1);
          const x = along === "x" ? cfg.x0 + u * w : cfg.x0 + t * w;
          const z = along === "x" ? cfg.z0 + t * dd : cfg.z0 + u * dd;
          try { PD.strip(x, cfg.h - 0.42, z, len, along); } catch (e) {}
        }
      }
    }
    // the wing is an INTERIOR to systems/prisonnight.js's sensors — a body in
    // here is lit by these fittings, not by the sky.
    CBZ.onUpdate(21.36, (function () {
      let done = false;
      return function () {
        if (done || !CBZ.prisonLights || !CBZ.prisonLights.rooms) return;
        done = true;
        CBZ.prisonLights.rooms.push({ id: cfg.id, x0: cfg.x0, x1: cfg.x1, z0: cfg.z0, z1: cfg.z1 });
      };
    })());
    if (PD && PD.shell) {
      try {
        PD.shell({ id: cfg.id, x0: cfg.x0, x1: cfg.x1, z0: cfg.z0, z1: cfg.z1, h: cfg.h,
          door: cfg.side, dc: cfg.dc, dw: cfg.dw, tone: cfg.wall, face: cfg.side });
      } catch (e) {}
    }
    rooms.push(cfg);
    return cfg;
  }

  /* ---- THE CAGE. Gun-room grammar rule (a) made into a primitive: bars on
       a transparent collider pane, so the prize is visible from outside and
       unreachable until the lock gives. Used three times below.

       `gap: {a0, a1}` IS THE DOORWAY, and it is not dressing — it is the
       difference between a cage and a sealed box. The pane below is ONE solid
       collider spanning the whole face, and `makeDoor` only ever splices out
       its own 0.2 m leaf (see :239) — it never cuts the wall the leaf stands
       in, because every other door in this file stands in a gap `roomShell`
       already left. A cage paned across its own door therefore stays shut
       after the lock gives, which is exactly what the knife cage and the
       property cage were: 116 m2 and 137 m2 of floor and seven placed items
       with no route in by key, pick or charge. Measured by flood-filling the
       compound's collider set at 0.25 m, not by reading walls.

       So the paned face is built as the RUNS EITHER SIDE of the door span.
       The head rail stays one piece — it rides above the 2.6 m leaf. ---- */
  function cage(cfg) {
    const { x0, x1, z0, z1 } = cfg, ch = cfg.h || 2.9;
    const pane = function (x, z, w, d) {
      const p = addBox(x, ch / 2, z, w, ch, d, 0x39424e, { solid: true });
      p.material = new THREE.MeshLambertMaterial({ color: 0x39424e, transparent: true, opacity: 0.05, depthWrite: false });
      p.castShadow = false; p.receiveShadow = false;
      return p;
    };
    // the door span, subtracted from whichever run it falls in. No gap
    // declared -> one unbroken run, byte-identical to before.
    const gap = cfg.gap || null;
    function runs(a0, a1) {
      if (!gap || !(gap.a1 > a0) || !(gap.a0 < a1)) return [[a0, a1]];
      const out = [];
      if (gap.a0 > a0) out.push([a0, gap.a0]);
      if (gap.a1 < a1) out.push([gap.a1, a1]);
      return out;
    }
    // only the two faces that look INTO the room are drawn; the other two are
    // the host room's own walls, which is how a real crib is built.
    /* THE BARS ARE THE KIT'S BARS (2026-09-29): 25 mm round at 125 mm
       centres on flat straps, channel rails top and bottom, square-tube
       posts at the ends and either side of the door, ONE merged mesh that
       casts. They were square 8 cm sticks 44 cm apart (a man's head fits
       through 44 cm). The panes stay the colliders: you see and shoot
       through the gaps, you do not walk through them. */
    const B = CK.BARS, BC = 0x2a2f38, P = new CK.Paint();
    const face = function (along, f, a, b) {
      const w = b - a;
      if (w <= 0.05) return;
      const at = function (u) { return along ? [f, u] : [u, f]; };
      const n = Math.max(1, Math.round(w / B.pitch));
      for (let k = 1; k < n; k++) { const p = at(a + k * w / n); P.cyl(p[0], ch / 2, p[1], B.r, ch - 0.2, BC, 8); }
      const m = at((a + b) / 2);
      const bx = function (y, hh, thin) { along ? P.box(m[0], y, m[1], thin, hh, w, BC) : P.box(m[0], y, m[1], w, hh, thin, BC); };
      bx(0.05, 0.1, 0.06); bx(ch - 0.05, 0.1, 0.06);
      const ns = Math.max(1, Math.round((ch - 0.2) / B.strapEvery));
      for (let k = 1; k < ns; k++) bx(0.1 + k * (ch - 0.2) / ns, B.strap, B.strapT);
      for (const u of [a, b]) { const p = at(u); P.box(p[0], ch / 2, p[1], 0.08, ch, 0.08, BC); }
    };
    const openS = cfg.open || "S";                 // which side faces the room
    if (openS === "S" || openS === "N") {
      const zf = openS === "S" ? z1 : z0;
      for (const r of runs(x0, x1)) {
        const w = r[1] - r[0];
        if (w <= 0.02) continue;
        pane((r[0] + r[1]) / 2, zf, w, 0.12);
        face(false, zf, r[0], r[1]);
      }
    }
    const xf = cfg.side === "W" ? x0 : x1;
    pane(xf, (z0 + z1) / 2, 0.12, z1 - z0);
    face(true, xf, z0, z1);
    P.mesh(CBZ.prisonRoot || CBZ.scene, true);
    return cfg;
  }

  /* ---- THE RACK THE CAGE IS ACTUALLY HOLDING SOMETHING ON ---------------
     Sized to the ITEMS, not to the room (it replaced three 10 x 14 m "shelf"
     planes a body walked through). Bolted slotted-angle shelving (rebuilt
     2026-09-28 from four slabs, four square sticks and a back sheet): 40 x 40
     x 4 mm angle posts with their slot rows, one post per bay line (bays set
     so no post stands at an x a placed item lies at), pressed shelves with
     folded lips bolted inside the angles, an X of flat strap across the back
     of each bay, a foot plate under every post, and ONE collider over the
     footprint, so a body is stopped by it and it is cover.

     The 0.80 m shelf's top face is the surface the cage's placed items lie
     on, the same 0.80 every stockCage() row declares.

     0.55 m DEEP IS THE LOAD-BEARING NUMBER. systems/prisondrops.js:78 picks a
     floor item up inside AUTO_R = 1.15 m; with a 0.55 m rack and the items set
     0.12 m proud of its centre line, a man stopped against the face stands
     ~0.73 m from the prize. Deeper than that and making the rack solid would
     lock the cage's own contents away behind it.

     NOT blockLOS, deliberately: gun-room grammar rule (a) is that you can SEE
     what the lock is holding, and the open X back keeps it that way. */
  const FL = 0.06;                                  // finished floor top (PD.finish lays an 80 mm slab to 0.06)
  const NC = { cast: false };
  function kb(mat, x, y, z, w, h, d, o) { return K.stat(new THREE.BoxGeometry(w, h, d), mat, x, y, z, o || NC); }
  function kc(mat, x, y, z, r0, r1, h, seg, o) { return K.stat(new THREE.CylinderGeometry(r0, r1, h, seg || 10), mat, x, y, z, o || NC); }
  // a seeded 0..1 (so dressing varies bay to bay and is the same every build)
  function hh(a, b, c) { const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return s - Math.floor(s); }
  // one corrugated carton, its tape seam along the long side and down both
  // ends; `taped` puts the strip over the top (a carton with one on it has none)
  function carton(x, y, z, w, h, d, kraft, taped) {
    const tape = K.skin("steel", 0xa88a5c, 0.3);
    kb(kraft, x, y + h / 2, z, w, h, d, { uv: 1, cast: false });
    const alongX = w >= d, L = alongX ? w : d;
    if (taped) kb(tape, x, y + h + 0.001, z, alongX ? L + 0.002 : 0.048, 0.002, alongX ? 0.048 : L + 0.002);
    for (const s of [-1, 1]) {
      if (alongX) kb(tape, x + s * (w / 2 + 0.001), y + h - 0.035, z, 0.002, 0.07, 0.048);
      else kb(tape, x, y + h - 0.035, z + s * (d / 2 + 0.001), 0.048, 0.07, 0.002);
    }
  }
  const RACK_D = 0.55, RACK_DECKS = [0.40, 0.80, 1.24, 1.70], RACK_H = 1.86;
  function cageRack(cfg) {
    const L = cfg.len, F = cfg.face || 1, cx = cfg.x, cz = cfg.z;   // F: which way the back faces
    const post = K.skin("steel", 0x5b6470, 0.5), shelfM = K.skin("steel", 0x9aa2aa, 0.45);
    const slot = K.skin("steel", 0x1b1f24, 0.8), strap = K.skin("steel", 0x4a525c, 0.5);
    const hl = L / 2, hd = RACK_D / 2, A = 0.04, T = 0.004, LIP = 0.035;
    const bays = Math.max(1, Math.round(L / 1.7));
    const px = []; for (let b = 0; b <= bays; b++) px.push(-hl + b * L / bays);
    const y0 = FL + 0.004, hU = RACK_H - y0, yU = (y0 + RACK_H) / 2;
    for (let b = 0; b <= bays; b++) {
      const end = b === 0 || b === bays;
      const dx = b === bays ? -1 : 1;                         // which way the angle's face leg runs
      const x = cx + px[b];
      for (const sz of [-1, 1]) {
        const zc = cz + sz * hd;                              // the angle's heel line, on the face
        kb(post, x + dx * A / 2, yU, zc - sz * T / 2, A, hU, T);                  // face leg
        kb(post, x + dx * T / 2, yU, zc - sz * A / 2, T, hU, A);                  // side leg
        kb(post, x + dx * 0.035, FL + 0.002, zc - sz * 0.035, 0.07, 0.004, 0.07); // foot plate
        // the slot row punched in the face leg (and in the side leg on the end posts)
        for (let y = y0 + 0.06; y < RACK_H - 0.04; y += 0.075) {
          kb(slot, x + dx * 0.02, y, zc + sz * 0.001, 0.012, 0.032, 0.002);
          if (end) kb(slot, x - dx * 0.001, y, zc - sz * 0.02, 0.002, 0.032, 0.012);
        }
        for (const y of RACK_DECKS) {                          // shelf bolt heads through the face leg
          const g = new THREE.CylinderGeometry(0.007, 0.007, 0.006, 6); g.rotateX(Math.PI / 2);
          K.stat(g, slot, x + dx * 0.02, y - LIP / 2, zc + sz * 0.003, NC);
        }
      }
    }
    for (let b = 0; b < bays; b++) {
      // a shelf spans between the side legs of its two posts (every side leg
      // runs +x from its heel except the last post's, which runs -x)
      const a0 = cx + px[b] + T, a1 = cx + px[b + 1] - (b + 1 === bays ? T : 0);
      const w = a1 - a0, mx = (a0 + a1) / 2, dd = RACK_D - 2 * T;
      for (const y of RACK_DECKS) {
        kb(shelfM, mx, y - 0.0015, cz, w, 0.003, dd, { uv: 1, cast: false });   // top face exactly at y
        for (const sz of [-1, 1]) kb(shelfM, mx, y - LIP / 2, cz + sz * (dd / 2 - 0.0015), w, LIP, 0.003);   // folded lips
        for (const e of [a0 + 0.0015, a1 - 0.0015]) kb(shelfM, e, y - LIP / 2, cz, 0.003, LIP, dd - 0.006);
      }
      // the back X: two flat straps, one proud of the other so they cross clear
      const hb = RACK_H - y0 - 0.1, len = Math.hypot(w, hb), ang = Math.atan2(hb, w);
      for (const k of [0, 1]) {
        K.stat(new THREE.BoxGeometry(len, 0.025, 0.003), strap, mx, yU, cz + F * (hd + 0.0035 + k * 0.004),
          { rz: k ? -ang : ang, cast: false });
      }
    }
    // ONE collider for the unit. A rack is one piece of furniture and is
    // stopped against as one.
    const col = { minX: cx - hl, maxX: cx + hl, minZ: cz - hd, maxZ: cz + hd, y0: 0, y1: RACK_H };
    CBZ.colliders.push(col);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    return cfg;
  }

  // items are laid ONCE, on the first tick — systems/prisondrops.js parses far
  // later than the world block, so this is the deferred-reach idiom
  // world/crates.js and world/adminwing.js already use.
  const stock = [];
  function stockCage(list) { for (const s of list) stock.push(s); }
  let laid = false;
  CBZ.onUpdate(41.42, function () {
    if (laid || !CBZ.prisonPlaceItem || !CBZ.game || CBZ.game.mode !== "escape") return;
    laid = true;
    for (const s of stock) { try { CBZ.prisonPlaceItem(s[0], s[1], s[2], s[3]); } catch (e) {} }
  });

  // ---------------------------------------------------------------- WEST WING
  /* PRISON INDUSTRIES — the biggest single room in the compound (50 x 48 m).
     A prison this size runs a shop, and a shop is where the TOOLS are, which
     is the only reason the crib in the corner is worth a lock. */
  room({ id: "industries", x0: -116, x1: -66, z0: -4, z1: 44, h: 7.5,
    wall: 0x7c8590, floor: 0x69707a, side: "E", dc: 20, dw: 6,
    fin: { floor: "slab", floorTint: 0x9ea2a5, dado: 0x5f6975, dadoH: 1.4,
      ceilingY: 6.2, ceiling: { kind: "slab", tint: 0xc9ccce, lights: "pendant", nx: 7, nz: 7, drop: 1.0 } } });
  // shop floor: benches down the middle, stock racks on the back wall. Solid,
  // because world/clutter.js's rule is that anything a body can approach is
  // solid or it reads as a decoy.
  // (world/prisonkit.js workbench: hardwood top, steel frame, a vice)
  for (let i = 0; i < 5; i++) {
    const z = 2 + i * 9;
    if (K) { K.workbench(-100, z, 5.0, 1.4, { vice: 1 }); K.workbench(-84, z, 5.0, 1.4, { vice: i & 1 ? -1 : 0, clutter: !!(i & 1) }); }
  }
  /* STOCK RACKS (rebuilt 2026-09-28; each bay's load was one plain box on a
     plain box pallet). Six back-to-back runs of selective pallet racking on
     the same 2.2 x 2.4 m footprints and the same full-height colliders: two
     0.9 m frames of blue uprights with their slot rows, zig-zag braced and
     standing on anchored foot plates, tied across the 0.24 m flue by row
     spacers; orange beams on hooked connector plates at 1.35 and 2.6 m with
     wire decks on them; and on every face and level either two block
     pallets (bottom boards, nine blocks, stringer boards, seven deck boards)
     carrying a real load (taped cartons in three sizes, a shrink-wrapped
     stack under a cap sheet, four drums) or a banded bundle of steel bar
     stock on timber bearers. Seeded, so the runs differ and every build is
     the same. All kit-merged: a handful of draw calls for the lot. */
  (function racks() {
    const blue = K.skin("steel", 0x2f4f7a, 0.5), orange = K.skin("steel", 0xd9772a, 0.45);
    const dark = K.skin("steel", 0x1b1f24, 0.8), zinc = K.skin("galv", 0xb3bac1);
    const woods = [K.skin("concrete", 0x9c7a4e), K.skin("concrete", 0x857055)];
    const krafts = [K.skin("concrete", 0xc2a274, 0.9), K.skin("concrete", 0xab8b60, 0.9)];
    const barM =K.skin("steel", 0x6d737a, 0.35), band = K.skin("steel", 0x30353b, 0.5);
    const drumM = [0x2f5e8a, 0x2a2d31, 0x8a2b22, 0x3f5a46].map((c) => K.skin("steel", c, 0.5));
    const film = new THREE.MeshStandardMaterial({ color: 0xdde3e6, roughness: 0.16, metalness: 0.0, envMap: CBZ.ENV || null, envMapIntensity: 0.9 });
    film.name = "prison-shrinkwrap";
    const UX = [-1.06, -0.16, 0.16, 1.06];              // upright centres across the run (x)
    const UY1 = 3.7, BEAMS = [1.35, 2.6], DECK = 0.04, MAXH = 0.82;
    const up0 = FL + 0.01;
    const U = { cast: true, uv: 1 };

    // a 1.0 x 1.0 block pallet; returns its deck top
    function pallet(xc, y, zc, wood) {
      for (const k of [-0.45, 0, 0.45]) kb(wood, xc, y + 0.011, zc + k, 1.0, 0.022, 0.1);              // bottom boards
      for (const i of [-0.45, 0, 0.45]) for (const j of [-0.45, 0, 0.45]) kb(wood, xc + i, y + 0.061, zc + j, 0.1, 0.078, 0.1);
      for (const k of [-0.45, 0, 0.45]) kb(wood, xc + k, y + 0.111, zc, 0.1, 0.022, 1.0);              // stringer boards
      for (let t = 0; t < 7; t++) kb(wood, xc, y + 0.133, zc - 0.45 + t * 0.15, 1.0, 0.022, 0.1);     // deck boards
      return y + 0.144;
    }
    const CARTONS = [{ nx: 2, nz: 2, h: 0.30 }, { nx: 3, nz: 2, h: 0.28 }, { nx: 3, nz: 3, h: 0.24 }];
    function cartons(xc, y, zc, seed) {
      const c = CARTONS[Math.floor(hh(seed, 1, 3) * 3) % 3], kraft = krafts[hh(seed, 2, 5) < 0.5 ? 0 : 1];
      const cw = 1.0 / c.nx, cd = 1.0 / c.nz;
      const layers = Math.max(1, Math.floor(MAXH / c.h) - (hh(seed, 3, 7) < 0.35 ? 1 : 0));
      const top = layers - 1;
      for (let a = 0; a < c.nx; a++) for (let b = 0; b < c.nz; b++) {
        const gone = hh(seed + a, b, 11) < 0.28;          // a carton already picked off the top layer
        const n = gone ? top : layers;
        for (let l = 0; l < n; l++)
          carton(xc - 0.5 + (a + 0.5) * cw, y + l * c.h, zc - 0.5 + (b + 0.5) * cd, cw - 0.006, c.h, cd - 0.006, kraft, l === n - 1);
      }
    }
    function wrapped(xc, y, zc, seed) {
      const h = MAXH * (0.78 + hh(seed, 4, 13) * 0.2);
      K.stat(new THREE.BoxGeometry(1.004, h + 0.05, 1.004), film, xc, y + h / 2 - 0.025, zc, NC);   // hugs the deck boards
      for (const t of [0.12, 0.6]) K.stat(new THREE.BoxGeometry(1.01, 0.16, 1.01), film, xc, y + h * t + 0.08, zc, NC);   // overlapping turns
      kb(krafts[0], xc, y + h + 0.003, zc, 0.98, 0.006, 0.98);                                            // cap sheet
    }
    function drums(xc, y, zc, seed) {
      const m = drumM[Math.floor(hh(seed, 5, 17) * drumM.length) % drumM.length];
      for (const dx of [-0.25, 0.25]) for (const dz of [-0.25, 0.25]) {
        const x = xc + dx, z = zc + dz;
        kc(m, x, y + 0.37, z, 0.225, 0.225, 0.74, 16, { cast: true });
        for (const t of [0.01, 0.73]) K.stat(new THREE.TorusGeometry(0.225, 0.012, 4, 16), dark, x, y + t, z, { rx: Math.PI / 2, cast: false });   // chimes
        for (const t of [0.25, 0.49]) K.stat(new THREE.TorusGeometry(0.228, 0.009, 4, 16), m, x, y + t, z, { rx: Math.PI / 2, cast: false });     // rolling hoops
        kc(dark, x + 0.12, y + 0.746, z + 0.05, 0.03, 0.03, 0.012, 8);                                                                            // bung
      }
    }
    // two banded bundles of 44 mm bar across the whole bay, on three bearers
    function barStock(xc, y, z, wood) {
      for (const k of [-0.85, 0, 0.85]) kb(wood, xc, y + 0.04, z + k, 0.95, 0.08, 0.08);
      for (const bx of [xc - 0.22, xc + 0.22]) {
        for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++)
          K.stat(new THREE.CylinderGeometry(0.022, 0.022, 2.15, 8), barM, bx - 0.092 + c * 0.046, y + 0.102 + r * 0.044, z, { rx: Math.PI / 2, cast: false });
        const yb = y + 0.08, yt = y + 0.212, hw = 0.1165;
        for (const zb of [z - 0.45, z + 0.45]) {
          kb(band, bx, yt + 0.0015, zb, hw * 2 + 0.006, 0.003, 0.032);
          kb(band, bx, yb - 0.0015, zb, hw * 2 + 0.006, 0.003, 0.032);
          for (const s of [-1, 1]) kb(band, bx + s * (hw + 0.0015), (yb + yt) / 2, zb, 0.003, yt - yb, 0.032);
        }
      }
    }

    for (let i = 0; i < 6; i++) {
      const x = -70, z = -1 + i * 7.6;
      for (const ze of [z - 1.15, z + 1.15]) {
        for (const ux of UX) {
          kb(blue, x + ux, (up0 + UY1) / 2, ze, 0.08, UY1 - up0, 0.07, U);
          kb(zinc, x + ux, FL + 0.005, ze, 0.12, 0.01, 0.1);                            // foot plate
          for (const s of [-1, 1]) kc(dark, x + ux + s * 0.05, FL + 0.018, ze, 0.009, 0.009, 0.016, 6);   // anchors
        }
        // the slot rows on the aisle face of each front upright
        for (const s of [-1, 1]) for (let y = 0.2; y < UY1 - 0.1; y += 0.1)
          for (const dz of [-0.018, 0.018]) kb(dark, x + s * 1.101, y, ze + dz, 0.002, 0.035, 0.012);
        // each 0.9 m frame: a bottom and top horizontal and a zig-zag between
        for (const fr of [[UX[0], UX[1]], [UX[2], UX[3]]]) {
          const xa = x + fr[0] + 0.04, xb = x + fr[1] - 0.04;
          for (const y of [0.25, 3.55]) K.tube(xa, y, ze, xb, y, ze, 0.016, blue, NC);
          for (let k = 0; k < 5; k++) {
            const ya = 0.25 + k * 0.66, yb = ya + 0.66;
            if (k & 1) K.tube(xb, ya, ze, xa, yb, ze, 0.014, blue, NC);
            else K.tube(xa, ya, ze, xb, yb, ze, 0.014, blue, NC);
          }
        }
        for (const y of [1.0, 2.3, 3.4]) kb(blue, x, y, ze, 0.24, 0.05, 0.04);          // row spacers across the flue
      }
      for (const Y of BEAMS) {
        for (const ux of UX) {
          kb(orange, x + ux, Y - 0.055, z, 0.05, 0.11, 2.23, { cast: true });
          for (const s of [-1, 1]) kb(orange, x + ux, Y - 0.09, z + s * 1.111, 0.07, 0.18, 0.008);   // connector plates
        }
        for (const xc of [x - 0.61, x + 0.61]) {                                           // wire decks
          for (const k of [-0.8, 0, 0.8]) kb(zinc, xc, Y + 0.015, z + k, 0.95, 0.03, 0.03);
          for (let t = 0; t < 10; t++) kb(zinc, xc - 0.45 + (t + 0.5) * 0.09, Y + 0.0325, z, 0.005, 0.005, 2.2);
          for (let t = 0; t <= 10; t++) kb(zinc, xc, Y + 0.0375, z - 1.0 + t * 0.2, 0.95, 0.005, 0.005);
        }
      }
      // the loads: per face (the two frames) and level (floor, beam 1, beam 2)
      for (let f = 0; f < 2; f++) {
        const xc = x + (f ? 0.61 : -0.61);
        for (let lv = 0; lv < 3; lv++) {
          const base = lv ? BEAMS[lv - 1] + DECK : FL;
          const wood = woods[hh(i, f, lv) < 0.6 ? 0 : 1];
          if (lv && hh(i, f + 3, lv * 3 + 9) < 0.2) { barStock(xc, base, z, wood); continue; }
          for (const zc of [z - 0.55, z + 0.55]) {
            const seed = i * 97 + f * 31 + lv * 7 + (zc > z ? 3 : 0);
            const r = hh(seed, 7, 19);
            if (r < 0.08) continue;                                                            // an empty slot
            const top = pallet(xc, base, zc, hh(seed, 8, 23) < 0.7 ? wood : woods[1]);
            if (r < 0.5) cartons(xc, top, zc, seed);
            else if (r < 0.7) wrapped(xc, top, zc, seed);
            else if (r < 0.86) drums(xc, top, zc, seed);
            else cartons(xc, top, zc, seed + 5);
          }
        }
      }
      CBZ.colliders.push({ minX: x - 1.1, maxX: x + 1.1, minZ: z - 1.2, maxZ: z + 1.2 });
    }
  })();
  /* The crib sits in the shop's SOUTH-WEST corner, so its host walls are the
     room's own x=-116 and z=44 and the faces that look INTO the shop are
     x=-104 and z=28. `open:"S"` paned z=44 — the exterior wall it already
     had — and left z=28, the face a man walks at, with nothing on it: the
     3.2 s pick gated an open doorway. `open:"N"` panes the face that needs
     it, and the door moves onto that same face with it. */
  const CRIB_DOOR = { a0: -110.4, a1: -107.4, fixed: 28 };
  cage({ x0: -116, x1: -104, z0: 28, z1: 44, side: "E", open: "N", h: 2.9, gap: CRIB_DOOR });
  // the rack stands on the crib's back wall (z=44, the shop's own), facing the
  // door: the three tools are the first thing you see through the bars.
  cageRack({ x: -110, z: 43.35, len: 5.0, face: 1 });
  stockCage([["Hacksaw Blade", -110, 0.80, 43.23], ["Lockpick", -108, 0.80, 43.23], ["Pickaxe", -112, 0.80, 43.23]]);
  const cribDoor = makeDoor({
    id: "prison-tool-crib", label: "The tool crib", pick: 3.2, bars: true, lb: 5,
    axis: "x", a0: CRIB_DOOR.a0, a1: CRIB_DOOR.a1, fixed: CRIB_DOOR.fixed, t: 0.12, h: 2.84,
  });

  /* POWERHOUSE — deliberately UNLOCKED. An empty-handed room is a legitimate
     authored outcome (world/roombuild.js says so about "empty"), and a
     compound where every door is a puzzle is a puzzle box, not a place. What
     it gives is COVER and a second way to cross the west wing at night. */
  room({ id: "powerhouse", x0: -112, x1: -84, z0: 62, z1: 94, h: 8,
    wall: 0x6f7883, floor: 0x5e656e, side: "E", dc: 78, dw: 5,
    fin: { floor: "slab", floorTint: 0x8f9498, dado: 0x55606b, dadoH: 1.4,
      ceilingY: 6.6, ceiling: { kind: "slab", tint: 0xbfc3c6, lights: "pendant", nx: 5, nz: 6, drop: 1.2 } } });
  /* PLANT A BODY MOVES THROUGH — not three cubes in 896 m2.
     WHAT WAS MEASURED (prison-rooms baseline): 35 props, 10 solid, 15 dead.
     Three 4 m grey cubes, each carrying a smaller cube and a "flue" that
     started at 5.2 m, plus five 24 m pipe lines drawn at y 6.4. The comment
     above states this room's whole purpose — COVER, and a second way to cross
     the west wing at night — and NOTHING in it was cover: every piece a man
     could have used was two metres over his head, and the walk from the door
     to the far wall was a straight line across an empty 28 x 32 m slab.
     The fix is not more boxes, it is the same boxes at body height. The flues
     come down to the FLOOR as uptake columns standing beside their boilers,
     and the pipe runs come down to chest height as three staggered banks. All
     of it solid, the banks LOS-blocking, and laid so that straight line from
     the door to the far wall no longer exists. Still unlocked, still
     empty-handed: an authored outcome, now with authored geometry. */
  /* THE PLANT, BUILT AS PLANT (2026-09-28). The three boilers were 4 m grey
     cubes with a smaller cube on top, the pipe banks were square boxes and
     the switchgear a grey box with a glowing blue slab on its face. Same
     footprints, same colliders, same sightline blockers (the uptakes and the
     middle run of each bank), now the real things: a horizontal fire-tube
     boiler in aluminium-clad insulation on concrete saddles, its burner on
     the east end and the flue breeching off the west end into a round stack
     that goes up through the ceiling; insulated pipe runs in three colours
     on stanchions with flanges; a switchboard of steel sections with doors,
     handles, a meter window and pilot lamps. */
  const clad = K.skin("galv", 0xc9ced3), plantDark = K.skin("steel", 0x4a525c), plantRed = K.skin("steel", 0x8a2b22, 0.5);
  const plantGreen = K.skin("steel", 0x3f5a46, 0.5), plantConc = K.skin("concrete", 0xa0a5aa), gauge = K.skin("steel", 0xe6e7e3, 0.3);
  const stat = K.stat;
  for (let i = 0; i < 3; i++) {
    const bx = -104 + i * 8, bz = 70;
    CBZ.colliders.push({ minX: bx - 2.0, maxX: bx + 2.3, minZ: bz - 2.0, maxZ: bz + 2.0 });
    for (const sx of [-1.1, 1.1]) stat(new THREE.BoxGeometry(0.4, 0.75, 2.4), plantConc, bx + sx, 0.375, bz, { uv: 1 });     // saddles
    stat(new THREE.CylinderGeometry(1.4, 1.4, 3.6, 28), clad, bx, 2.05, bz, { rz: Math.PI / 2 });                          // the shell
    for (let k = 0; k < 5; k++) stat(new THREE.TorusGeometry(1.41, 0.022, 4, 28), plantDark, bx - 1.6 + k * 0.8, 2.05, bz, { ry: Math.PI / 2, cast: false });
    for (const ex of [-1, 1]) stat(new THREE.CylinderGeometry(1.36, 1.36, 0.1, 28), plantDark, bx + ex * 1.83, 2.05, bz, { rz: Math.PI / 2, cast: false });   // end plates
    // the burner on the east door, its fan housing and the gas train under it
    stat(new THREE.BoxGeometry(0.4, 0.8, 0.8), plantRed, bx + 2.08, 1.9, bz, {});
    stat(new THREE.CylinderGeometry(0.28, 0.28, 0.3, 16), plantRed, bx + 2.08, 1.9, bz + 0.55, { rx: Math.PI / 2, cast: false });
    K.tube(bx + 2.1, 0.0, bz - 0.5, bx + 2.1, 1.5, bz - 0.5, 0.05, K.skin("steel", 0xd9b233), { cast: false });
    // the header: a steam drum on two risers, a stop valve with its wheel, a gauge
    for (const hx of [-0.6, 0.6]) K.tube(bx + hx, 3.4, bz, bx + hx, 3.75, bz, 0.09, plantDark, { cast: false });
    stat(new THREE.CylinderGeometry(0.34, 0.34, 1.6, 18), clad, bx, 4.05, bz, { rz: Math.PI / 2, cast: false });
    K.tube(bx, 4.35, bz, bx, 4.75, bz, 0.08, plantDark, { cast: false });
    stat(new THREE.TorusGeometry(0.2, 0.02, 5, 16), plantRed, bx, 4.8, bz, { rx: Math.PI / 2, cast: false });
    stat(new THREE.CylinderGeometry(0.12, 0.12, 0.05, 16), gauge, bx + 1.2, 2.9, bz - 1.2, { rx: Math.PI / 2, cast: false });
    // the flue breeching off the west end into the stack, up through the 6.6 m ceiling
    K.tube(bx - 1.85, 2.6, bz, bx - 2.3, 2.6, bz, 0.3, plantDark, { cast: false });
    const up = addBox(bx - 2.6, 4.0, bz, 0.8, 8.0, 0.8, 0x4a525c, { solid: true, blockLOS: true, cast: false });
    up.visible = false;                                 // the sightline blocker and collider; the stack is drawn round
    stat(new THREE.CylinderGeometry(0.38, 0.38, 6.6, 18), clad, bx - 2.6, 3.3, bz, {});
    for (const y of [1.2, 3.0, 4.8]) stat(new THREE.TorusGeometry(0.39, 0.025, 4, 18), plantDark, bx - 2.6, y, bz, { rx: Math.PI / 2, cast: false });
  }
  /* A PIPE BANK IS PIPES. Three runs stacked to 1.6 m on stanchions every
     3.5 m, cover you crouch behind and a wall you cannot walk through. The
     collider is the bank's footprint; the sightline blocker is its middle run. */
  function pipeBank(bx0, bx1, z) {
    const len = bx1 - bx0, cx = (bx0 + bx1) / 2;
    const ys = [0.62, 1.02, 1.42], mats = [clad, plantRed, plantGreen];
    CBZ.colliders.push({ minX: bx0, maxX: bx1, minZ: z - 0.26, maxZ: z + 0.26 });
    const los = addBox(cx, ys[1], z, len, 0.34, 0.34, 0x5b6470, { blockLOS: true, cast: false });
    los.visible = false;
    for (let i = 0; i < ys.length; i++) {
      stat(new THREE.CylinderGeometry(0.16, 0.16, len, 16), mats[i], cx, ys[i], z, { rz: Math.PI / 2 });
      for (let f = 0; f * 3.5 + 1.75 < len; f++)
        stat(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 16), plantDark, bx0 + 1.75 + f * 3.5, ys[i], z, { rz: Math.PI / 2, cast: false });   // flanges
    }
    for (let s = 0; s * 3.5 <= len; s++) {
      const px = bx0 + Math.min(s * 3.5, len);
      stat(new THREE.BoxGeometry(0.12, 1.66, 0.12), plantDark, px, 0.83, z, { cast: false });
      stat(new THREE.BoxGeometry(0.3, 0.02, 0.5), plantDark, px, 0.01, z, { cast: false });                         // base plate
      for (const y of ys) stat(new THREE.BoxGeometry(0.1, 0.04, 0.46), plantDark, px, y - 0.18, z, { cast: false });   // pipe shoe
    }
  }
  pipeBank(-110, -98, 76); pipeBank(-96, -85, 83); pipeBank(-110, -99, 89);
  // switchgear: a row of sections, not a lone cabinet
  const panelGrey = K.skin("steel", 0x8a939d, 0.5), meterGlass = K.skin("steel", 0x141b22, 0.12);
  const pilot = [0xc0392b, 0x2e9e4f, 0xd9a21b].map((c) => new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 0.5 }));
  for (let i = 0; i < 3; i++) {
    const sx = -88 - i * 6, sz = 92, fz = sz - 0.55;
    CBZ.colliders.push({ minX: sx - 1.2, maxX: sx + 1.2, minZ: sz - 0.55, maxZ: sz + 0.55 });
    stat(new THREE.BoxGeometry(2.4, 0.1, 1.1), plantDark, sx, 0.05, sz, { cast: false });                        // plinth
    stat(new THREE.BoxGeometry(2.4, 2.1, 1.1), panelGrey, sx, 1.15, sz, { uv: 1 });
    for (let d = 0; d < 3; d++) {
      const dx = sx - 0.8 + d * 0.8;
      stat(new THREE.BoxGeometry(0.02, 2.0, 0.012), plantDark, dx + 0.4, 1.15, fz - 0.006, { cast: false });   // door seam
      stat(new THREE.BoxGeometry(0.03, 0.18, 0.04), plantDark, dx + 0.28, 1.2, fz - 0.02, { cast: false });   // handle
      stat(new THREE.BoxGeometry(0.34, 0.22, 0.012), meterGlass, dx, 1.75, fz - 0.006, { cast: false });      // meter window
      for (let k = 0; k < 3; k++) {
        const g = new THREE.CylinderGeometry(0.018, 0.018, 0.02, 8); g.rotateX(Math.PI / 2);
        stat(g, pilot[k], dx - 0.1 + k * 0.1, 1.5, fz - 0.01, { cast: false });
      }
      stat(new THREE.BoxGeometry(0.5, 0.3, 0.01), plantDark, dx, 0.45, fz - 0.005, { cast: false });         // louvre plate
    }
  }

  // ---------------------------------------------------------------- EAST WING
  /* SEGREGATION. A second cell house, and the one place in the compound with
     nobody in the corridor — which is exactly why the map is in it. Its
     control door takes the Keycard, so the card that gets you out of the
     housing unit is also the card that gets you into the one nobody walks. */
  /* THE CONTROL GATE IS THE UNIT'S ONE DOOR (2026-09-28). The Keycard gate
     used to stand at x 99..102.6 in the unit's SOUTH exterior wall (z=44),
     behind the cell backs: roomShell's wall ran solid right through its
     opening, so it opened onto concrete and gated nothing, while the real
     doorway (west, z 17.5..22.5) stood open and a metre off the corridor
     that feeds it (world/corridors.js wing-seg, z 19.25..23.75). The doorway
     now matches the corridor exactly and the gate hangs IN it, so the route
     is: corridor key at the unit-mouth grille, then the card at this gate. */
  const SEG_DOOR = { c: 21.5, w: 4.5 };
  room({ id: "segregation", x0: 58, x1: 112, z0: -4, z1: 44, h: 7,
    wall: 0x848d98, floor: 0x646b74, side: "W", dc: SEG_DOOR.c, dw: SEG_DOOR.w,
    fin: { floor: "slab", floorTint: 0x969b9f, dado: 0x5d6873, dadoH: 1.3,
      ceilingY: 4.2, ceiling: { kind: "slab", tint: 0xc9ccce, lights: "vapor", nx: 8, nz: 5 } } });
  // sixteen singles in two facing rows off a central corridor. Partitions are
  // real colliders and deliberately NOT noBreach: blowing through a seg wall
  // is precisely the route the charge table exists for.
  const MAP_CELL = 7;                                      // south row, east end: the open cell (below)
  for (let r = 0; r < 2; r++) {
    const zf = r ? 34 : 6;                                  // the cell-front plane
    for (let i = 0; i < 8; i++) {
      const cx = 62 + i * 6.2;
      const openCell = r === 1 && i === MAP_CELL;
      const part = addBox(cx - 3.1, 1.75, zf + (r ? 4 : -4), 0.3, 3.5, 8, 0x6f7883, { solid: true, blockLOS: true });
      K.skinBox(part, "block", 0x7d8691);
      // the end cell's east side: it had no partition, so the last cell of
      // each row stood open to the 3.5 m strip against the unit's east wall
      if (i === 7) K.skinBox(addBox(cx + 3.1, 1.75, zf + (r ? 4 : -4), 0.3, 3.5, 8, 0x6f7883, { solid: true, blockLOS: true }), "block", 0x7d8691);
      /* THE FRONT IS A WALL WITH A STEEL DOOR (2026-09-29). It was a 6 m
         barred grille with a barred leaf and a food slot stuck on the bars.
         A segregation cell is the one place every modern jail agrees on a
         SOLID door: a detention steel leaf with a vision lite and a food /
         cuff pass (a man in seg is fed and cuffed through that slot, not
         through bars he could reach through). Block either side, the leaf in
         a steel frame, hinged on the old hinge-stile line, opening onto the
         corridor. The map cell (below) stands with its leaf swung back. */
      {
        const open = r ? -1 : 1, d0 = cx + 0.1, d1 = cx + 1.1, ST = 0.2;
        CK.infill({ axis: "x", a0: cx - 3.0, a1: cx + 3.0, c0: d0, c1: d1, fixed: zf, t: ST, top: 3.5, head: 2.3,
          color: 0x7d8691, skin: "block" });
        const set = CK.doorSet({ axis: "x", a0: d0, a1: d1, fixed: zf, t: ST, h: 2.3, open: open, hinge: 1, frame: 0x39424e,
          build: CK.detentionLeaf({ color: 0x5b6572, pass: true }) });
        if (openCell) set.set(1);
        else {
          CBZ.colliders.push({ minX: d0, maxX: d1, minZ: zf - ST / 2, maxZ: zf + ST / 2, ref: set.leaves[0].slab || set.leaves[0].pivot });
          if (CBZ.losBlockers && set.leaves[0].slab) CBZ.losBlockers.push(set.leaves[0].slab);
        }
      }
      /* and what is inside it: a bunk, a stainless combo, nothing else.

         THE BUNK IS A BED NOW. It was two raw addBox slabs — a 1.9 x 0.2
         "frame" and a 1.75 x 0.14 "mattress" — with no useBed, no
         CBZ.propRegisterBed and no CBZ.prisonBunk anywhere near them: sixteen
         mattresses no body in the game could lie on, which is the same fault
         world/cellblock.js:300 records against its own thirteen and fixed by
         registering the geometry it had already drawn. It goes through the
         SAME canonical builder the cell house and world/southblock.js's dorm
         use, so there is exactly one bunk in this game and one place it is
         registered from. `unit` is deliberately left null: these racks are
         real propuse anchors, but segregation is not a housing block a
         schedule routes a body to, and `punitive` keeps sixteen isolation
         racks out of the wing's published CAPACITY (see world/cellblock.js's
         prisonBunk for why: `houses` is what becomes anonymous population, and
         systems/prisonrest.js musters only the buildings men are housed in).
         They stay singles, which is what a segregation cell is.
         Degrade (no cellblock.js) redraws the two slabs it always was. */
      const bz = zf + (r ? 6.4 : -6.4);
      if (CBZ.prisonBunk) CBZ.prisonBunk({ id: "seg-" + r + "-" + i, x: cx - 1.5, z: bz, along: "x", double: false, blanket: 0x4a5b46, punitive: true });
      // the stainless combi against the cell's back wall (world/prisonkit.js).
      // SOLID here where it is not in the cell house: a seg cell is 6.2 x 8 m,
      // so there is floor to spare and no reason a man walks through the toilet.
      const wf = zf + (r ? 7.85 : -7.85), inn = r ? -1 : 1;
      if (K) K.combi(cx + 2.0, wf, 0, inn);
      CBZ.colliders.push({ minX: cx + 1.7, maxX: cx + 2.3, minZ: Math.min(wf, wf + inn * 0.66), maxZ: Math.max(wf, wf + inn * 0.66), y0: 0, y1: 0.8 });
    }
    const back = addBox(87, 1.75, zf + (r ? 8 : -8), 54, 3.5, 0.3, 0x6f7883, { solid: true, blockLOS: true });  // back wall
    if (K) K.skinBox(back, "block", 0x7d8691);
  }
  /* THE MAP LIES ON THE BUNK IN THE LAST CELL, AND THAT CELL STANDS OPEN.
     The last cell on the south row is being turned over: its steel leaf is
     swung back against the corridor wall (above), its doorway has no
     collider, and the map is on the mattress. */
  const mcx = 62 + MAP_CELL * 6.2, mzf = 34;
  // the bunk of that cell is at (mcx - 1.5, 40.4), along x, mattress top at 0.62
  stockCage([["Contraband Map", mcx - 1.1, 0.64, 40.4]]);
  const segDoor = makeDoor({
    id: "prison-segregation", label: "The segregation door", keys: ["Keycard"], lb: 5,
    axis: "z", a0: SEG_DOOR.c - SEG_DOOR.w / 2, a1: SEG_DOOR.c + SEG_DOOR.w / 2, fixed: 58, t: 0.5, top: 3.1, wall: 0x848d98,
  });

  /* KITCHEN. A prison this size feeds nine hundred men from one room, and
     that room is where every edged weapon in the yard comes from. The cage
     in the corner is the only reason it is on the map. */
  room({ id: "kitchen", x0: 58, x1: 110, z0: 60, z1: 96, h: 7,
    wall: 0xb6bcc2, floor: 0x9aa2aa, side: "W", dc: 78, dw: 5,
    fin: { floor: "quarry", floorTint: 0xffffff, dado: 0xffffff, tile: 0xf1f0ea, dadoH: 2.0, rail: 0x9aa3ad,
      ceilingY: 4.2, ceiling: { kind: "slab", tint: 0xdfe1e0, lights: "vapor", nx: 10, nz: 7 } } });
  /* THE KITCHEN FLOOR (rebuilt 2026-09-28; every piece of it was a steel-
     skinned box: box ovens with box knobs, a box hood, cylinders on sticks
     for kettles, slab tables, and a cooler that was three corrugated slabs
     open along one whole side). Now, all kit-merged:
       THE COOK LINE  one back-to-back island (x 62-88, z 65-67) of 28 heavy-
         duty units a side on a shared backguard and high shelf. Ranges:
         recessed plinth, oven door with a window and a pull bar on
         standoffs, a sloped control rail with knobs and a pilot, six burner
         heads under three cast-iron bar grates. Every fourth is a griddle.
       THE CANOPY     a hollow double-island hood (skirts, sloped sides, end
         plates) with a V bank of baffle filters over a grease trough, hung
         on threaded rods, two ducts up through the ceiling.
       TWO TILTING KETTLES  a jacketed round pan with a rolled rim and a
         pour lip on trunnions between two pedestals, the tilt handwheel on
         its gear housing, a floor drain under each lip.
       FIVE PREP TABLES  turned-edge top with a splash, six tube legs on
         bullet feet, an undershelf on collars; a board, two hotel pans and a
         lidded stock pot on top. No knives anywhere: they live in the cage.
       A POT SINK on the north wall, WIRE SHELVING in the dry-store aisle
         behind the cooler and inside it, and
       THE WALK-IN COOLER (the hiding place, same footprint, still solid and
         sightline-blocking): an insulated panel box with seams, corner and
         top trims and a kick plate, a real doorway in its east wall with the
         door standing open on strap hinges (latch, pull, vision window,
         inside release), a threshold plate, an evaporator inside and the
         condensing unit on the roof with its line set.
     Island, kettle, table and cooler colliders are the old rects; the sink,
     the shelving runs and the open cooler door have their own. */
  (function kitchen() {
    const ss = K.skin("steel", 0xc3c9cf, 0.32), ssDk = K.skin("steel", 0x8f979f, 0.4);
    const iron = K.skin("steel", 0x1c1f23, 0.8), knobM = K.skin("steel", 0x202328, 0.5);
    const glassDk = K.skin("steel", 0x141b22, 0.12), plinthM = K.skin("steel", 0x2a2f36, 0.6);
    const galv = K.skin("galv", 0xaab2ba), rodM = K.skin("steel", 0x4a525c, 0.5), pvc = K.skin("steel", 0x9aa0a6, 0.6);
    const chrome = K.skin("galv", 0xc9ced3);
    const pilotM = new THREE.MeshLambertMaterial({ color: 0xffb347, emissive: 0xff9a1a, emissiveIntensity: 0.6 });
    const UVC = { uv: 1, cast: true }, UVN = { uv: 1, cast: false };
    const zRod = (g, m, x, y, z) => K.stat(g, m, x, y, z, { rx: Math.PI / 2, cast: false });   // a cylinder lying along z

    /* ---- THE COOK LINE ------------------------------------------------ */
    const IZ = 66, IX0 = 62, IX1 = 88, NU = 28, W = (IX1 - IX0) / NU;
    CBZ.colliders.push({ minX: IX0, maxX: IX1, minZ: IZ - 1, maxZ: IZ + 1, y0: 0, y1: 0.95 });
    // the units stand back to back on a 20 mm backguard sheet, fronts at IZ +/-0.91
    // so the rail, knobs and pull bars all stay inside the island's collider
    kb(ss, (IX0 + IX1) / 2, (FL + 1.30) / 2, IZ, IX1 - IX0, 1.30 - FL, 0.02, UVC);    // backguard
    kb(ss, (IX0 + IX1) / 2, 1.315, IZ, IX1 - IX0, 0.03, 0.56, UVC);                    // high shelf
    for (let gx = IX0 + 0.6; gx < IX1; gx += 2.6) for (const s of [-1, 1])
      K.tube(gx, 1.10, IZ + s * 0.01, gx, 1.30, IZ + s * 0.25, 0.012, ss, NC);        // shelf stays
    for (const hx of [64.5, 71.5, 78.5, 85.5]) {                                        // nested hotel pans up there
      kb(ss, hx, 1.33 + 0.04, IZ, 0.53, 0.08, 0.325, NC);
      for (let k = 0; k < 3; k++) kb(ss, hx, 1.352 + k * 0.024, IZ, 0.55, 0.004, 0.345);
    }
    // the control rail's section: lz is outward from the body face, y is height
    const RAIL = [[0, 0.66], [0.085, 0.66], [0.085, 0.70], [0.02, 0.84], [0, 0.84]];
    const TILT = Math.atan2(0.065, 0.14);                 // the rail face leans back 25 deg
    const nL = Math.cos(TILT), nY = Math.sin(TILT);       // its outward normal (lz, y)
    for (const s of [-1, 1]) {
      const zF = IZ + s * 0.91, ry = s > 0 ? 0 : Math.PI;
      const Z = (lz) => zF + s * lz;
      for (let u = 0; u < NU; u++) {
        const ux = IX0 + (u + 0.5) * W, bw = W - 0.004;
        const griddle = (u + (s > 0 ? 2 : 0)) % 4 === 2;
        kb(plinthM, ux, FL + 0.05, Z(-0.485), bw, 0.10, 0.83);                          // recessed kick
        kb(ss, ux, 0.50, Z(-0.45), bw, 0.68, 0.9, UVC);                                  // body
        kb(ss, ux, 0.85, Z(-0.44), bw, 0.02, 0.92, UVN);                                 // top plate
        K.stat(K.profileGeo(RAIL, bw, 0), ss, ux, 0, zF, { ry: ry, uv: 1, cast: false });   // control rail
        // oven door: panel, window, a vent under it, the pull bar on standoffs
        kb(ss, ux, 0.43, Z(0.015), bw - 0.1, 0.42, 0.03, UVN);
        kb(glassDk, ux, 0.45, Z(0.031), 0.44, 0.16, 0.002);
        kb(iron, ux, 0.19, Z(0.002), bw - 0.12, 0.025, 0.004);
        K.stat(new THREE.CylinderGeometry(0.012, 0.012, bw - 0.24, 10), ssDk, ux, 0.585, Z(0.075), { rz: Math.PI / 2, cast: false });
        for (const sx of [-1, 1]) zRod(new THREE.CylinderGeometry(0.008, 0.008, 0.045, 8), ssDk, ux + sx * (bw / 2 - 0.16), 0.585, Z(0.0525));
        // knobs stand square off the sloped rail face, and one pilot lamp
        const kn = griddle ? [-0.3, -0.1, 0.1, 0.3] : [-0.33, -0.22, -0.11, 0, 0.11, 0.22, 0.33];
        const fL = 0.0525, fY = 0.77;                     // mid-point of the rail face
        for (const lx of kn)
          K.stat(new THREE.CylinderGeometry(0.019, 0.019, 0.032, 8), knobM, ux + lx, fY + nY * 0.016, Z(fL + nL * 0.016),
            { rx: Math.PI / 2 - TILT, ry: ry, cast: false });
        K.stat(new THREE.CylinderGeometry(0.008, 0.008, 0.01, 8), pilotM, ux + 0.41, fY + nY * 0.005, Z(fL + nL * 0.005),
          { rx: Math.PI / 2 - TILT, ry: ry, cast: false });
        if (griddle) {
          kb(iron, ux, 0.875, Z(-0.47), bw - 0.1, 0.03, 0.74, UVN);                    // the plate
          kb(plinthM, ux, 0.87, Z(-0.06), bw - 0.1, 0.02, 0.06);                         // grease trough
          kb(ss, ux, 0.94, Z(-0.845), bw - 0.08, 0.1, 0.01);                             // splash, back
          for (const sx of [-1, 1]) kb(ss, ux + sx * (bw / 2 - 0.045), 0.94, Z(-0.47), 0.01, 0.1, 0.74);
        } else {
          for (const lx of [-0.305, 0, 0.305]) {
            const gx = ux + lx;
            for (const lz of [-0.25, -0.64]) kc(iron, gx, 0.875, Z(lz), 0.075, 0.08, 0.03, 10);   // burner heads
            // one cast-iron grate over the pair: two rails, three bars, fingers, feet
            for (const rx of [-0.13, 0.13]) {
              kb(iron, gx + rx, 0.9125, Z(-0.45), 0.02, 0.025, 0.84);
              for (const fz of [-0.05, -0.85]) kb(iron, gx + rx, 0.88, Z(fz), 0.02, 0.04, 0.02);
            }
            for (const cz of [-0.04, -0.445, -0.86]) kb(iron, gx, 0.9125, Z(cz), 0.24, 0.025, 0.02);
            for (const seg of [[-0.05, -0.435], [-0.455, -0.85]])
              for (const fx of [-0.035, 0.035]) kb(iron, gx + fx, 0.9125, Z((seg[0] + seg[1]) / 2), 0.016, 0.025, seg[0] - seg[1]);
          }
        }
      }
    }

    /* ---- THE CANOPY ---------------------------------------------------- */
    const HX0 = IX0 - 0.3, HX1 = IX1 + 0.3, HL = HX1 - HX0, HC = (HX0 + HX1) / 2;
    const hoodM = K.skin("steel", 0xc0c6cc, 0.35);
    // one long side as a bent 15 mm sheet: skirt from 2.05 to 2.35, then in to the top
    const SIDE = [[1.6, 2.05], [1.6, 2.35], [1.1, 2.75], [1.0906, 2.7383], [1.585, 2.3428], [1.585, 2.05]];
    for (const s of [-1, 1]) K.stat(K.profileGeo(SIDE.map((p) => [p[0] * s, p[1]]), HL - 0.04, 0), hoodM, HC, 0, IZ, UVC);
    const END = [[-1.6, 2.05], [1.6, 2.05], [1.6, 2.35], [1.1, 2.75], [-1.1, 2.75], [-1.6, 2.35]];
    for (const ex of [HX0 + 0.01, HX1 - 0.01]) K.stat(K.profileGeo(END, 0.02, 0), hoodM, ex, 0, IZ, UVN);
    kb(hoodM, HC, 2.7425, IZ, HL - 0.04, 0.015, 2.2, UVN);                               // top
    // the V bank: baffle filters from the top (lz 0.6) down to a trough at the middle
    const FA = Math.atan2(0.435, 0.52), fsin = Math.sin(FA), fcos = Math.cos(FA);
    const nF = Math.floor((HL - 0.04) / 0.5), f0 = HC - (nF - 1) * 0.25;
    for (const s of [-1, 1]) {
      const cz = IZ + s * 0.34, cy = 2.5175, th = -s * FA;
      const oz = s * fsin * 0.0275, oy = -fcos * 0.0275;  // out along the visible face's normal
      for (let k = 0; k < nF; k++) {
        const fx = f0 + k * 0.5;
        K.stat(new THREE.BoxGeometry(0.49, 0.03, 0.66), galv, fx, cy, cz, { rx: th, cast: false });
        for (const bx of [-0.18, -0.06, 0.06, 0.18])
          K.stat(new THREE.BoxGeometry(0.01, 0.025, 0.62), galv, fx + bx, cy + oy, cz + oz, { rx: th, cast: false });
      }
    }
    kb(galv, HC, 2.28, IZ, HL - 0.04, 0.04, 0.2);                                         // grease trough
    for (const rx of [IX0 + 0.5, 70.3, 79.7, IX1 - 0.5]) for (const s of [-1, 1])
      K.tube(rx, 2.75, IZ + s * 0.9, rx, 4.2, IZ + s * 0.9, 0.009, rodM, NC);            // hanger rods
    for (const dx of [68.5, 81.5]) {
      kb(galv, dx, (2.75 + 4.2) / 2, IZ, 1.0, 4.2 - 2.75, 0.6, UVC);                      // exhaust duct
      for (const y of [2.79, 3.45]) kb(galv, dx, y, IZ, 1.04, 0.04, 0.64);                // collar, joint
    }

    /* ---- THE KETTLES --------------------------------------------------- */
    const KP = 0.80;                                      // trunnion height
    const PAN = [[0.001, -0.40], [0.18, -0.385], [0.31, -0.32], [0.40, -0.22], [0.45, -0.10], [0.46, 0.02], [0.46, 0.28],
      [0.445, 0.30], [0.425, 0.28], [0.425, 0.02], [0.415, -0.08], [0.37, -0.18], [0.28, -0.27], [0.16, -0.325], [0.001, -0.34]]
      .map((p) => new THREE.Vector2(p[0], p[1]));          // jacket out and up, the pan's bowl back down inside
    for (const kd of [[90.2, -1], [92.2, 1]]) {           // each pours away from the other
      const kx = kd[0], dir = kd[1];
      CBZ.colliders.push({ minX: kx - 0.6, maxX: kx + 0.6, minZ: IZ - 0.8, maxZ: IZ + 0.8, y0: 0, y1: 1.1 });
      K.stat(new THREE.LatheGeometry(PAN, 28), ss, kx, KP, IZ, UVC);
      K.stat(new THREE.TorusGeometry(0.445, 0.015, 6, 28), ss, kx, KP + 0.292, IZ, { rx: Math.PI / 2, cast: false });    // rolled rim
      K.stat(new THREE.TorusGeometry(0.462, 0.008, 4, 28), ssDk, kx, KP + 0.02, IZ, { rx: Math.PI / 2, cast: false });   // jacket seam
      K.stat(new THREE.BoxGeometry(0.07, 0.015, 0.18), ss, kx + dir * 0.475, KP + 0.29, IZ, { rz: -0.25 * dir, cast: false });   // pour lip
      for (const sz of [-1, 1]) {
        const pz = IZ + sz * 0.58;
        zRod(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 14), ssDk, kx, KP, IZ + sz * 0.48);        // trunnion boss
        zRod(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 10), ssDk, kx, KP, IZ + sz * 0.515);     // stub axle
        kb(ss, kx, (FL + 0.92) / 2, pz, 0.28, 0.92 - FL, 0.12, UVC);                                 // pedestal
        K.stat(new THREE.CylinderGeometry(0.14, 0.14, 0.12, 16), ss, kx, 0.92, pz, { rx: Math.PI / 2, uv: 1, cast: true });
        kb(ssDk, kx, FL + 0.0075, pz, 0.36, 0.015, 0.2);                                            // foot flange
      }
      // the tilt: gear housing, shaft, handwheel with three spokes and a spinner
      kb(ssDk, kx, KP, IZ + 0.67, 0.2, 0.22, 0.06);
      zRod(new THREE.CylinderGeometry(0.012, 0.012, 0.06, 8), ssDk, kx, KP, IZ + 0.73);
      K.stat(new THREE.TorusGeometry(0.13, 0.012, 6, 24), ssDk, kx, KP, IZ + 0.765, NC);
      zRod(new THREE.CylinderGeometry(0.025, 0.025, 0.03, 10), ssDk, kx, KP, IZ + 0.765);
      for (let k = 0; k < 3; k++) {
        const a = k * Math.PI * 2 / 3 + 0.3;
        K.stat(new THREE.BoxGeometry(0.13, 0.012, 0.012), ssDk, kx + Math.cos(a) * 0.065, KP + Math.sin(a) * 0.065, IZ + 0.765, { rz: a, cast: false });
      }
      zRod(new THREE.CylinderGeometry(0.013, 0.013, 0.035, 8), knobM, kx + Math.cos(0.3) * 0.13, KP + Math.sin(0.3) * 0.13, IZ + 0.7875);
      // steam in through the far pedestal, and the floor drain under the lip
      K.tube(kx, FL, IZ - 0.70, kx, 0.5, IZ - 0.70, 0.02, ssDk, NC);
      K.tube(kx, 0.5, IZ - 0.70, kx, 0.5, IZ - 0.64, 0.02, ssDk, NC);
      kb(iron, kx + dir * 0.9, FL + 0.002, IZ, 0.4, 0.004, 0.6);
    }

    /* ---- PREP TABLES --------------------------------------------------- */
    const boards = [K.skin("concrete", 0xe9e6dc, 0.8), K.skin("concrete", 0x6f9a6a, 0.8)];
    const alu = K.skin("galv", 0xc9ced3), binM = K.skin("concrete", 0xeceae4, 0.6);
    function hotelPan(x, y, z, w, d, h) {                 // open, 6 mm walls, a 20 mm flange
      const t = 0.006;
      kb(ss, x, y + t / 2, z, w - 2 * t, t, d - 2 * t);
      for (const s of [-1, 1]) {
        kb(ss, x, y + h / 2, z + s * (d / 2 - t / 2), w, h, t);
        kb(ss, x + s * (w / 2 - t / 2), y + h / 2, z, t, h, d - 2 * t);
        kb(ss, x, y + h - 0.003, z + s * (d / 2 + 0.01), w + 0.04, 0.006, 0.02);
        kb(ss, x + s * (w / 2 + 0.01), y + h - 0.003, z, 0.02, 0.006, d);
      }
    }
    for (let i = 0; i < 5; i++) {
      const x = 66 + i * 8, z = 80, TY = 0.91, m = i & 1 ? -1 : 1;
      CBZ.colliders.push({ minX: x - 1.5, maxX: x + 1.5, minZ: z - 0.45, maxZ: z + 0.45, y0: 0, y1: 0.95 });
      kb(ss, x, TY - 0.006, z, 3.0, 0.012, 0.9, UVC);                                      // top
      for (const sz of [-1, 1]) kb(ss, x, TY - 0.032, z + sz * 0.444, 3.0, 0.04, 0.012);   // turned edges
      for (const sx of [-1, 1]) kb(ss, x + sx * 1.494, TY - 0.032, z, 0.012, 0.04, 0.876);
      kb(ss, x, TY + 0.06, z + 0.444, 3.0, 0.12, 0.012, UVN);                               // splash
      for (const lx of [-1.42, 0, 1.42]) for (const lz of [-0.38, 0.38]) {
        kc(ssDk, x + lx, FL + 0.02, z + lz, 0.02, 0.013, 0.04, 10);                         // bullet foot
        kc(ss, x + lx, (0.10 + 0.848) / 2, z + lz, 0.0205, 0.0205, 0.748, 10);              // leg
        kc(ss, x + lx, 0.873, z + lz, 0.03, 0.03, 0.05, 10);                                // gusset socket
        kc(ss, x + lx, 0.25, z + lz, 0.026, 0.026, 0.04, 10);                               // shelf collar
      }
      kb(ss, x, 0.25, z, 2.8, 0.012, 0.72, UVN);                                            // undershelf
      // on top: a board, two hotel pans, a lidded stock pot with loop handles
      kb(boards[i % 3 === 1 ? 1 : 0], x - 0.9 * m, TY + 0.0125, z - 0.05, 0.6, 0.025, 0.45, UVN);
      hotelPan(x - 0.22 * m, TY, z - 0.05, 0.325, 0.53, 0.1);
      hotelPan(x + 0.16 * m, TY, z - 0.05, 0.325, 0.53, 0.1);
      const px = x + 0.85 * m, pz = z - 0.02;
      kc(ss, px, TY + 0.16, pz, 0.2, 0.2, 0.32, 20, UVC);
      kc(ss, px, TY + 0.326, pz, 0.206, 0.206, 0.012, 20);
      kc(knobM, px, TY + 0.347, pz, 0.018, 0.022, 0.03, 10);
      for (const s of [-1, 1])
        K.stat(new THREE.TorusGeometry(0.045, 0.008, 5, 10, Math.PI), ssDk, px + s * 0.195, TY + 0.27, pz, { rz: -s * Math.PI / 2, rx: Math.PI / 2, cast: false });
      // underneath: a stack of sheet pans, or two lidded ingredient bins
      if (!(i & 1)) for (let k = 0; k < 8; k++) kb(alu, x - 0.6 * m, 0.256 + 0.0125 + k * 0.028, z, 0.66, 0.025, 0.46);
      else for (const bx of [-0.5, 0.1]) {
        kb(binM, x + bx * m, 0.256 + 0.2, z, 0.4, 0.4, 0.6, UVN);
        kb(ssDk, x + bx * m, 0.666, z, 0.42, 0.02, 0.62);
      }
    }

    /* ---- THE POT SINK (north wall, x 95-98) ---------------------------- */
    CBZ.colliders.push({ minX: 95.0, maxX: 98.0, minZ: 60.25, maxZ: 61.05, y0: 0, y1: 1.0 });
    kb(ss, 96.5, 1.06, 60.2875, 3.0, 0.30, 0.015, UVN);                                    // splash
    kb(ss, 96.5, 0.895, 60.35, 3.0, 0.03, 0.11, UVN);                                       // back deck
    kb(ss, 96.5, 0.555, 60.6825, 1.8, 0.01, 0.555);                                         // bowl bottoms
    for (const wz of [60.41, 60.955]) kb(ss, 96.5, 0.73, wz, 1.8, 0.36, 0.01);             // bowl back, front
    for (const wx of [95.605, 96.2, 96.8, 97.395]) kb(ss, wx, 0.73, 60.6825, 0.01, 0.36, 0.535);   // ends, dividers
    kb(ss, 96.5, 0.89, 60.995, 3.0, 0.04, 0.07);                                            // front rail
    K.stat(new THREE.CylinderGeometry(0.02, 0.02, 3.0, 10), ss, 96.5, 0.89, 61.03, { rz: Math.PI / 2, cast: false });   // its bull nose
    for (const e of [[95.3, 95.006], [97.7, 97.994]]) {                                     // drainboards with a raised edge
      kb(ss, e[0], 0.904, 60.6825, 0.6, 0.012, 0.555, UVN);
      kb(ss, e[1], 0.93, 60.6825, 0.012, 0.04, 0.555);
    }
    for (const lx of [95.03, 96.5, 97.97]) for (const lz of [60.45, 60.93]) {
      kc(ss, lx, FL + 0.02, lz, 0.02, 0.013, 0.04, 10);
      const top = lx === 96.5 ? 0.55 : 0.898;
      kc(ss, lx, (0.10 + top) / 2, lz, 0.02, 0.02, top - 0.10, 10);
    }
    for (const lz of [60.45, 60.93]) K.tube(95.05, 0.2, lz, 97.95, 0.2, lz, 0.014, ss, NC);  // stretchers
    for (const bx of [95.9, 96.5, 97.1]) {
      kc(iron, bx, 0.5615, 60.68, 0.04, 0.04, 0.003, 12);                                   // strainer
      K.tube(bx, 0.55, 60.68, bx, 0.36, 60.68, 0.022, pvc, NC);                              // tailpiece
      // a wall faucet: body out of the splash, swing spout, tip, two levers
      K.tube(bx, 1.12, 60.295, bx, 1.12, 60.40, 0.018, ss, NC);
      K.tube(bx, 1.12, 60.40, bx, 1.16, 60.62, 0.012, ss, NC);
      K.tube(bx, 1.16, 60.62, bx, 1.10, 60.66, 0.012, ss, NC);
      K.tube(bx - 0.08, 1.12, 60.32, bx + 0.08, 1.12, 60.32, 0.01, ss, NC);
      for (const s of [-1, 1]) kb(knobM, bx + s * 0.08, 1.155, 60.32, 0.015, 0.06, 0.015);
    }
    K.tube(95.9, 0.36, 60.68, 97.1, 0.36, 60.68, 0.025, pvc, NC);                           // waste manifold
    K.tube(97.1, 0.36, 60.68, 97.1, 0.36, 60.25, 0.025, pvc, NC);                           // into the wall
    kb(ss, 96.5, 1.62, 60.43, 3.0, 0.025, 0.3, UVN);                                        // wall shelf over it
    for (const bx of [95.2, 96.5, 97.8]) {
      kb(ssDk, bx, 1.5, 60.29, 0.02, 0.22, 0.02);
      K.tube(bx, 1.40, 60.30, bx, 1.605, 60.55, 0.008, ssDk, NC);
    }
    for (const hx of [95.6, 96.3]) {
      kb(ss, hx, 1.6325 + 0.04, 60.43, 0.53, 0.08, 0.26, NC);
      for (let k = 0; k < 3; k++) kb(ss, hx, 1.655 + k * 0.024, 60.43, 0.55, 0.004, 0.28);
    }

    /* ---- WIRE SHELVING (dry store, and inside the cooler) --------------
       1.22 m units, chrome posts on levellers, four wire shelves each with
       a frame, a truss chord, the deck wires and split collars on the posts.
       `fill` puts what is on each shelf; `zb` is the wall side. */
    const SH = [0.20, 0.66, 1.14, 1.62], UW = 1.22, PH = 1.86;
    function wireRun(x0, n, zb, zf, fill, seed) {
      const D = Math.abs(zf - zb), zc = (zb + zf) / 2, hx = UW / 2 - 0.02, hz = D / 2 - 0.015;
      CBZ.colliders.push({ minX: x0, maxX: x0 + n * UW, minZ: Math.min(zb, zf), maxZ: Math.max(zb, zf), y0: 0, y1: 1.9 });
      for (let u = 0; u < n; u++) {
        const ux = x0 + (u + 0.5) * UW;
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          kc(chrome, ux + sx * hx, FL + 0.015, zc + sz * hz, 0.016, 0.016, 0.03, 8);
          kc(chrome, ux + sx * hx, (FL + 0.03 + PH) / 2, zc + sz * hz, 0.0125, 0.0125, PH - FL - 0.03, 8);
        }
        for (let k = 0; k < SH.length; k++) {
          const y = SH[k];
          for (const sz of [-1, 1]) {
            kb(chrome, ux, y - 0.006, zc + sz * hz, 2 * hx - 0.025, 0.012, 0.006);
            kb(chrome, ux, y - 0.036, zc + sz * hz, 2 * hx - 0.025, 0.006, 0.006);
          }
          for (const sx of [-1, 1]) kb(chrome, ux + sx * hx, y - 0.006, zc, 0.006, 0.012, 2 * hz - 0.025);
          for (let t = 1; t < 12; t++) kb(chrome, ux - hx + t * (2 * hx / 12), y - 0.003, zc, 0.004, 0.004, 2 * hz - 0.02);
          for (const f of [-0.5, 0.5]) kb(chrome, ux, y - 0.008, zc + f * hz, 2 * hx - 0.02, 0.004, 0.004);
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) kb(chrome, ux + sx * hx, y - 0.02, zc + sz * hz, 0.034, 0.04, 0.034);   // split collars
          fill(ux, y, zc, k, seed + u * 13 + k);
        }
      }
    }
    const krafts = [K.skin("concrete", 0xc2a274, 0.9), K.skin("concrete", 0xab8b60, 0.9)];
    const tin = K.skin("galv", 0xc9ced3), labels = [0xb8332a, 0x3f7a3a, 0xd9a21b, 0x2f5e8a].map((c) => K.skin("steel", c, 0.6));
    const sacks = [K.skin("concrete", 0xe6dfcc, 0.95), K.skin("concrete", 0xcdbb95, 0.95)];
    function cartonRow(ux, y, zc, seed) {
      const kr = krafts[hh(seed, 1, 2) < 0.5 ? 0 : 1];
      for (const cx of [-0.38, 0, 0.38]) if (hh(seed, cx, 3) > 0.15) carton(ux + cx, y, zc, 0.36, 0.3, 0.38, kr, true);
    }
    function dryFill(ux, y, zc, k, seed) {
      const r = hh(seed, k, 5);
      if (r < 0.35) {                                     // #10 cans, two deep, stacked on the lower shelves
        const lab = labels[Math.floor(hh(seed, 2, 7) * 4) % 4], layers = k < 3 ? 2 : 1;
        for (let l = 0; l < layers; l++) for (let c = 0; c < 6; c++) for (const dz of [-0.1, 0.1]) {
          const cy = y + l * 0.178 + 0.089;
          kc(tin, ux - 0.45 + c * 0.18, cy, zc + dz, 0.078, 0.078, 0.176, 10);
          kc(lab, ux - 0.45 + c * 0.18, cy, zc + dz, 0.0795, 0.0795, 0.12, 10);
        }
      } else if (r < 0.7) {                               // 25 kg sacks laid flat, two high
        for (const sx of [-0.3, 0.3]) for (let l = 0; l < (k < 3 ? 2 : 1); l++) {
          const sm = sacks[hh(seed, sx, l) < 0.5 ? 0 : 1], by = y + l * 0.14;
          kb(sm, ux + sx, by + 0.055, zc, 0.56, 0.11, 0.40, UVN);
          kb(sm, ux + sx, by + 0.125, zc, 0.46, 0.03, 0.30, UVN);                          // the fill's crown
        }
      } else cartonRow(ux, y, zc, seed);
    }
    const crateM = [0x2f6e3a, 0x2a2d31, 0x2f5e8a].map((c) => K.skin("steel", c, 0.7));
    const produce = [[0xb8332a, 0.036], [0xc9a25a, 0.04], [0x5f9a3a, 0.07], [0x8a6a44, 0.045]]
      .map((p) => ({ m: K.skin("concrete", p[0], 0.8), r: p[1] }));
    const cambroM = K.skin("concrete", 0xe8ecee, 0.4);
    function coldFill(ux, y, zc, k, seed) {
      const r = hh(seed, k, 9);
      if (r < 0.5) {                                      // two lug crates of produce
        for (const cx of [-0.285, 0.285]) {
          const x = ux + cx, w = 0.52, h = 0.26, d = 0.38, t = 0.012;
          const cm = crateM[Math.floor(hh(seed, cx, 1) * 3) % 3], pr = produce[Math.floor(hh(seed, cx, 2) * 4) % 4];
          kb(cm, x, y + t / 2, zc, w, t, d);
          for (const s of [-1, 1]) {
            kb(cm, x, y + h / 2, zc + s * (d / 2 - t / 2), w, h, t);
            kb(cm, x + s * (w / 2 - t / 2), y + h / 2, zc, t, h, d - 2 * t);
            kb(iron, x + s * (w / 2 + 0.001), y + h - 0.05, zc, 0.002, 0.03, 0.1);          // hand hole
          }
          const fy = y + h * 0.55;
          kb(pr.m, x, fy - 0.005, zc, w - 2 * t, 0.01, d - 2 * t);
          const nx = Math.floor((w - 2 * t) / (pr.r * 2)), nz = Math.floor((d - 2 * t) / (pr.r * 2));
          for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++)
            K.stat(new THREE.SphereGeometry(pr.r, 6, 3), pr.m, x - (nx - 1) * pr.r + a * pr.r * 2, fy + pr.r * 0.8,
              zc - (nz - 1) * pr.r + b * pr.r * 2, NC);
        }
      } else if (r < 0.75) {                              // three lidded food-storage tubs
        for (const cx of [-0.38, 0, 0.38]) {
          kc(cambroM, ux + cx, y + 0.15, zc, 0.16, 0.15, 0.3, 16);
          kc(ssDk, ux + cx, y + 0.31, zc, 0.168, 0.168, 0.02, 16);
        }
      } else cartonRow(ux, y, zc, seed);
    }
    // the dry store: the aisle behind the cooler, shelving on the south wall
    wireRun(58.6, 9, 95.72, 95.26, dryFill, 0x51);

    /* ---- THE WALK-IN COOLER -------------------------------------------- */
    const CX0 = 58.25, CX1 = 70.15, CZ0 = 85.0, CZ1 = 92.35, CT = 0.12, CH = 3.0;
    const CD0 = 86.3, CD1 = 87.7, CDH = 2.1;             // its doorway in the east wall (1.4 m clear)
    const PANEL = 0xd3d8dc;
    const cw = (x, y, z, w, h, d, solid) => {
      const m = addBox(x, y, z, w, h, d, PANEL, solid ? { solid: true, blockLOS: true } : { blockLOS: true, cast: false });
      K.skinBox(m, "steel", PANEL);
      return m;
    };
    cw((CX0 + CX1) / 2, CH / 2, CZ0 + CT / 2, CX1 - CX0, CH, CT, true);                  // north
    cw((CX0 + CX1) / 2, CH / 2, CZ1 - CT / 2, CX1 - CX0, CH, CT, true);                  // south
    cw(CX1 - CT / 2, CH / 2, (CZ0 + CT + CD0) / 2, CT, CH, CD0 - CZ0 - CT, true);        // east, north of the door
    cw(CX1 - CT / 2, CH / 2, (CD1 + CZ1 - CT) / 2, CT, CH, CZ1 - CT - CD1, true);        // east, south of it
    // over the door: sightline only (a y-gated solid head seals a doorway for every actor)
    cw(CX1 - CT / 2, (CDH + CH) / 2, (CD0 + CD1) / 2, CT, CH - CDH, CD1 - CD0, false);
    cw((CX0 + CX1) / 2, CH + 0.06, (CZ0 + CZ1) / 2, CX1 - CX0, 0.12, CZ1 - CZ0, false);  // roof panels
    const liner = K.skin("steel", PANEL, 0.5), seam = K.skin("steel", 0x6b7480, 0.6);
    const trimM = K.skin("galv", 0xb9c0c7), kick = K.skin("steel", 0x8f979f, 0.45);
    kb(liner, 58.2875, (FL + CH) / 2, (CZ0 + CZ1) / 2, 0.025, CH - FL, CZ1 - CZ0 - 2 * CT, UVN);   // on the room wall inside
    const hS = CH - FL - 0.02, yS = (FL + CH) / 2;
    for (let x = CX0 + 1.15; x < CX1 - 0.1; x += 1.15) {                                   // panel joints
      kb(seam, x, yS, CZ0 - 0.001, 0.008, hS, 0.002);
      kb(seam, x, yS, CZ1 + 0.001, 0.008, hS, 0.002);
    }
    for (let z = CZ0 + 1.15; z < CZ1 - 0.1; z += 1.15)
      if (z < CD0 - 0.08 || z > CD1 + 0.08) kb(seam, CX1 + 0.001, yS, z, 0.002, hS, 0.008);
    for (const zc of [CZ0, CZ1]) {                                                          // corner angles
      const o = zc === CZ0 ? -1 : 1;
      kb(trimM, CX1 - 0.025, yS, zc + o * 0.002, 0.05, CH - FL, 0.004);
      kb(trimM, CX1 + 0.002, yS, zc - o * 0.025, 0.004, CH - FL, 0.05);
      kb(trimM, (CX0 + CX1) / 2, CH + 0.06, zc + o * 0.003, CX1 - CX0, 0.14, 0.004);       // roof-edge flashing
      kb(kick, (CX0 + CX1) / 2 - 0.025, FL + 0.15, zc + o * 0.0025, CX1 - CX0 - 0.05, 0.3, 0.003);
    }
    kb(trimM, CX1 + 0.003, CH + 0.06, (CZ0 + CZ1) / 2, 0.004, 0.14, CZ1 - CZ0 + 0.006);
    for (const r of [[CZ0 + 0.05, CD0 - 0.06], [CD1 + 0.06, CZ1 - 0.05]])
      kb(kick, CX1 + 0.0025, FL + 0.15, (r[0] + r[1]) / 2, 0.003, 0.3, r[1] - r[0]);
    // the door set: jambs and head proud of the face, a tread plate on the sill
    for (const jz of [CD0 - 0.03, CD1 + 0.03]) kb(trimM, CX1 + 0.01, (FL + CDH) / 2, jz, 0.02, CDH - FL, 0.06);
    kb(trimM, CX1 + 0.01, CDH + 0.03, (CD0 + CD1) / 2, 0.02, 0.06, CD1 - CD0 + 0.12);
    kb(kick, CX1 - CT / 2, FL + 0.006, (CD0 + CD1) / 2, 0.34, 0.012, CD1 - CD0);
    kb(trimM, CX1 + 0.015, 1.05, CD1 + 0.09, 0.03, 0.2, 0.05);                            // the latch keeper
    /* the leaf, hooked open flat to the room at 90 degrees on its north
       jamb: 100 mm insulated, exterior face north */
    const LX0 = CX1 + 0.09, LX1 = LX0 + 1.4, LZ = CD0 - 0.08, LF = LZ - 0.05;
    const leafM = K.skin("steel", PANEL, 0.4), hw = K.skin("steel", 0x7d868f, 0.35);
    CBZ.colliders.push({ minX: CX1, maxX: LX1 + 0.02, minZ: LZ - 0.23, maxZ: LZ + 0.075, y0: 0, y1: CDH });
    kb(leafM, (LX0 + LX1) / 2, (FL + 0.02 + CDH - 0.02) / 2, LZ, 1.4, CDH - 0.04 - FL, 0.1, UVC);
    for (const y of [0.46, 1.1, 1.8]) {                   // strap hinges: frame leaf, knuckle, strap (clear of the kick plate)
      kb(hw, CX1 + 0.025, y, LZ - 0.035, 0.05, 0.14, 0.012);
      kc(hw, CX1 + 0.05, y, LZ - 0.035, 0.02, 0.02, 0.14, 10);
      kb(hw, CX1 + 0.28, y, LF - 0.003, 0.46, 0.05, 0.006);
    }
    kb(hw, LX1 - 0.1, 1.05, LF - 0.02, 0.07, 0.3, 0.04);                                   // latch body
    K.tube(LX1 - 0.2, 0.93, LF - 0.08, LX1 - 0.2, 1.17, LF - 0.08, 0.014, hw, NC);         // pull
    for (const y of [0.96, 1.14]) K.tube(LX1 - 0.2, y, LF, LX1 - 0.2, y, LF - 0.08, 0.009, hw, NC);
    zRod(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 12), K.skin("steel", 0xa3261c, 0.5), LX1 - 0.1, 1.05, LZ + 0.07);   // inside release
    kb(glassDk, LX0 + 0.85, 1.55, LZ, 0.36, 0.36, 0.104);                                  // vision window
    for (const s of [-1, 1]) {
      kb(trimM, LX0 + 0.85, 1.55 + s * 0.19, LF - 0.003, 0.4, 0.02, 0.006);
      kb(trimM, LX0 + 0.85 + s * 0.19, 1.55, LF - 0.003, 0.02, 0.36, 0.006);
    }
    kb(kick, (LX0 + LX1) / 2, FL + 0.17, LF - 0.0015, 1.3, 0.3, 0.003);                     // kick plate
    // inside: the evaporator hung off the ceiling on the back wall, its drain and line set
    const evap = K.skin("steel", 0xe4e7e9, 0.5), insul = K.skin("steel", 0x1e2124, 0.9), copper = K.skin("steel", 0xb87333, 0.35);
    kb(evap, 58.6, 2.725, 88.6, 0.5, 0.35, 1.4, UVN);
    for (const rz of [88.05, 89.15]) K.tube(58.6, 2.9, rz, 58.6, CH, rz, 0.008, rodM, NC);
    for (const fz of [88.25, 88.95]) {
      for (const rr of [0.15, 0.09]) K.stat(new THREE.TorusGeometry(rr, 0.008, 4, 20), iron, 58.856, 2.725, fz, { ry: Math.PI / 2, cast: false });
      kb(iron, 58.856, 2.725, fz, 0.006, 0.3, 0.006);
      kb(iron, 58.856, 2.725, fz, 0.006, 0.006, 0.3);
    }
    // the condensate drain: out of the pan, back to the wall, down it to a floor drain
    K.tube(58.4, 2.55, 89.2, 58.4, 2.52, 89.2, 0.012, pvc, NC);
    K.tube(58.4, 2.52, 89.2, 58.315, 2.52, 89.2, 0.012, pvc, NC);
    K.tube(58.315, 2.52, 89.2, 58.315, FL + 0.03, 89.2, 0.012, pvc, NC);
    kc(iron, 58.36, FL + 0.002, 89.2, 0.05, 0.05, 0.004, 12);
    K.tube(59.2, CH, 88.55, 59.2, 2.72, 88.55, 0.022, insul, NC);
    K.tube(59.2, 2.72, 88.55, 58.85, 2.72, 88.55, 0.022, insul, NC);
    K.tube(59.25, CH, 88.65, 59.25, 2.68, 88.65, 0.006, copper, NC);
    K.tube(59.25, 2.68, 88.65, 58.85, 2.68, 88.65, 0.006, copper, NC);
    // on the roof: the condensing unit on its rails, the line set across to a boot over the evaporator
    const RT = CH + 0.12, cu = K.skin("steel", 0xb9bec2, 0.5);
    for (const rx of [67.9, 68.7]) kb(rodM, rx, RT + 0.03, 88.6, 0.06, 0.06, 0.8);
    kb(cu, 68.3, RT + 0.06 + 0.3, 88.6, 1.0, 0.6, 0.55, UVC);
    const cuY = RT + 0.36;
    for (const rr of [0.22, 0.14, 0.06]) K.stat(new THREE.TorusGeometry(rr, 0.008, 4, 24), iron, 68.3, cuY, 88.885, NC);   // fan guard
    kb(iron, 68.3, cuY, 88.885, 0.44, 0.008, 0.008);
    kb(iron, 68.3, cuY, 88.885, 0.008, 0.44, 0.008);
    for (let k = 0; k < 6; k++) kb(cu, 68.3, RT + 0.13 + k * 0.08, 88.318, 0.9, 0.012, 0.014);   // coil louvres
    K.tube(67.8, RT + 0.2, 88.55, 67.6, RT + 0.2, 88.55, 0.022, insul, NC);
    K.tube(67.6, RT + 0.2, 88.55, 67.6, RT + 0.022, 88.55, 0.022, insul, NC);
    K.tube(67.6, RT + 0.022, 88.55, 59.2, RT + 0.022, 88.55, 0.022, insul, NC);
    K.tube(67.8, RT + 0.15, 88.65, 67.65, RT + 0.15, 88.65, 0.006, copper, NC);
    K.tube(67.65, RT + 0.15, 88.65, 67.65, RT + 0.006, 88.65, 0.006, copper, NC);
    K.tube(67.65, RT + 0.006, 88.65, 59.25, RT + 0.006, 88.65, 0.006, copper, NC);
    kb(insul, 59.22, RT + 0.05, 88.6, 0.14, 0.1, 0.22);                                     // roof boot
    // shelving along both long walls inside (the middle stays open floor to hide on)
    wireRun(58.35, 7, CZ0 + CT, CZ0 + CT + 0.46, coldFill, 0x77);
    wireRun(58.35, 9, CZ1 - CT, CZ1 - CT - 0.46, coldFill, 0x99);
  })();
  const KNIFE_DOOR = { a0: 102.2, a1: 105.2, fixed: 84 };
  cage({ x0: 98, x1: 110, z0: 84, z1: 96, side: "W", open: "N", h: 2.9, gap: KNIFE_DOOR });
  cageRack({ x: 104, z: 95.35, len: 5.0, face: 1 });
  stockCage([["Shiv", 104, 0.80, 95.23], ["Razor Blade", 105.6, 0.80, 95.23], ["Hatchet", 102.4, 0.80, 95.23]]);
  const knifeDoor = makeDoor({
    id: "prison-knife-cage", label: "The knife cage", pick: 4.4, bars: true, lb: 5,
    axis: "x", a0: KNIFE_DOOR.a0, a1: KNIFE_DOOR.a1, fixed: KNIFE_DOOR.fixed, t: 0.12, h: 2.84,
  });

  /* VISITATION & PROPERTY. The room a man is processed through, and the room
     his own things are kept in while he is inside — which is why the property
     cage holds valuables and a phone rather than a weapon. */
  room({ id: "visitation", x0: 62, x1: 110, z0: 104, z1: 126, h: 6,
    wall: 0xc0b8a6, floor: 0x7d7466, side: "W", dc: 115, dw: 4,
    fin: { floor: "vct", floorTint: 0xc4bcaa, dado: 0x8f8574, dadoH: 1.1,
      ceilingY: 3.0, ceiling: { kind: "acoustic", lights: "troffer", nx: 12, nz: 5 } } });
  /* VISIT BOOTHS (rebuilt 2026-09-28): six stalls across the room, each a
     laminate counter on a steel base, a glazed partition in a steel frame
     from the counter to head height, side screens between the stalls, a
     handset on each side, and a bolted pedestal stool each side. The
     "screen" was an opaque pale-blue slab. */
  const boothBase = K.skin("steel", 0x8f8574, 0.6), boothTop = K.skin("steel", 0xa9a294, 0.45);
  const boothFrame = K.skin("steel", 0x39424e), boothGlass = K.skin("glass"), phone = K.skin("steel", 0x1c1e22, 0.6);
  const stoolSeat = K.skin("steel", 0x52606d, 0.5), stoolPost = K.skin("galv", 0x9aa0a8);
  for (let i = 0; i < 6; i++) {
    const x = 66 + i * 5, z = 110;
    CBZ.colliders.push({ minX: x - 1.7, maxX: x + 1.7, minZ: z - 0.45, maxZ: z + 0.45 });
    stat(new THREE.BoxGeometry(3.4, 0.72, 0.5), boothBase, x, 0.36, z, { uv: 1 });
    stat(new THREE.BoxGeometry(3.5, 0.04, 0.9), boothTop, x, 0.74, z, { uv: 1 });
    // the glazing: a pane in a frame from the counter to 2.3 m
    const pg = new THREE.PlaneGeometry(3.2, 1.5); stat(pg, boothGlass, x, 1.51, z, { cast: false });
    stat(new THREE.BoxGeometry(3.3, 0.06, 0.08), boothFrame, x, 2.29, z, { cast: false });
    stat(new THREE.BoxGeometry(3.3, 0.05, 0.08), boothFrame, x, 0.78, z, { cast: false });
    // side screens between the stalls, both sides of the glass
    for (const s of [-1, 1]) {
      stat(new THREE.BoxGeometry(0.05, 1.55, 0.9), boothFrame, x + s * 1.66, 1.535, z, { cast: false });
      // the handsets, on the side screens at ear height, one each side of the glass
      for (const f of [-1, 1]) stat(new THREE.BoxGeometry(0.05, 0.2, 0.07), phone, x + s * 1.6, 1.35, z + f * 0.3, { cast: false });
    }
    // bolted pedestal stools, one each side
    for (const f of [-1, 1]) {
      const sz = z + f * 1.6;
      stat(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 16), stoolSeat, x, 0.43, sz, {});
      stat(new THREE.CylinderGeometry(0.035, 0.05, 0.4, 8), stoolPost, x, 0.2, sz, { cast: false });
      stat(new THREE.CylinderGeometry(0.16, 0.18, 0.02, 12), stoolPost, x, 0.01, sz, { cast: false });
    }
    if (CBZ.roomSeatAnchor) {
      try {
        CBZ.roomSeatAnchor(x, 0, 108.4, Math.PI, "stool", null, { cushion: 0.46, floorBelow: 0 });
        CBZ.roomSeatAnchor(x, 0, 111.6, 0, "stool", null, { cushion: 0.46, floorBelow: 0 });
      } catch (e) {}
    }
  }
  const PROP_DOOR = { a0: 101.5, a1: 104.5, fixed: 116 };
  cage({ x0: 96, x1: 110, z0: 104, z1: 116, side: "W", open: "S", h: 2.9, gap: PROP_DOOR });
  // this cage opens SOUTH, so its back wall is z=104 and the rack faces -z.
  cageRack({ x: 103, z: 104.65, len: 6.0, face: -1 });
  stockCage([["Stolen Wallet", 102, 0.80, 104.77], ["Cash Roll", 104, 0.80, 104.77],
      ["Luxury Watch", 100.4, 0.80, 104.77], ["Burner Phone", 105.6, 0.80, 104.77]]);
  const propDoor = makeDoor({
    id: "prison-property", label: "The property cage", pick: 5.6, bars: true, lb: 5,
    axis: "x", a0: PROP_DOOR.a0, a1: PROP_DOOR.a1, fixed: PROP_DOOR.fixed, t: 0.12, h: 2.84,
  });

  // -------------------------------------------------------------- THE BUBBLE
  /* CENTRAL CONTROL. The second armoury, and it answers to the same key the
     first one's inner cage does — the Warden's own. What it gives is not a
     thing you carry: it is a CONSOLE, and pressing it throws every lock in
     the compound at once. That is the category change rule (c): you stop
     being a man with a key and become the man who runs the doors. */
  room({ id: "control", x0: -26, x1: 26, z0: -108, z1: -78, h: 6.5,
    wall: 0x8d9099, floor: 0x4a525c, side: "S", dc: 0, dw: 4,
    fin: { floor: "vct", floorTint: 0x8c9196, dado: 0x5d636c, dadoH: 1.1,
      ceilingY: 3.0, ceiling: { kind: "acoustic", lights: "troffer", nx: 10, nz: 6 } } });
  const ctrlDoor = makeDoor({
    id: "prison-control", label: "Central control", keys: ["Gun-Room Key"], lb: 7,
    axis: "x", a0: -2, a1: 2, fixed: -78, top: 3.1, wall: 0x8d9099, color: 0x4f5d6b,
  });
  /* THE CONSOLE (rebuilt 2026-09-28): one 16 m operator desk drawn from its
     side profile (a toe kick, the writing ledge on the officer's side, the
     sloped panel rising to a monitor shelf), with twelve switch panels on
     the slope, their pilot lamps, a row of monitors on the shelf and, at the
     officer's edge, THE BUTTON: a red mushroom in a yellow guard collar. It
     was a grey 16 m box with twelve glowing coloured tiles. The BUTTON is
     the one thing in this room that is not scenery. */
  const deskMat = K.skin("steel", 0x39424e, 0.55), deskTop = K.skin("steel", 0x5d636c, 0.4), inset = K.skin("steel", 0x1c1f23, 0.6);
  const bezel = K.skin("steel", 0x14171b, 0.5);
  const screen = new THREE.MeshLambertMaterial({ color: 0x1d3f55, emissive: 0x1b4c6b, emissiveIntensity: 0.45 });
  const leds = [0x2e9e4f, 0xd9a21b, 0xc0392b].map((c) => new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 0.6 }));
  CBZ.colliders.push({ minX: -8, maxX: 8, minZ: -97, maxZ: -95 });
  const desk = K.profileGeo([[0.92, 0], [0.92, 0.1], [1.0, 0.1], [1.0, 0.9], [1.06, 0.93], [1.06, 0.97], [0.45, 0.97], [-0.45, 1.3], [-1.0, 1.3], [-1.0, 0]], 16, 0.02);
  stat(desk, deskMat, 0, 0, -96, {});
  const slope = Math.atan2(0.33, 0.9);
  for (let i = 0; i < 12; i++) {
    const px = -7.0 + i * 1.27;
    const g = new THREE.BoxGeometry(0.9, 0.012, 0.8); g.rotateX(slope); stat(g, inset, px, 1.16, -96.0, { cast: false });
    for (let k = 0; k < 6; k++) {
      const lg = new THREE.BoxGeometry(0.04, 0.02, 0.03); lg.rotateX(slope);
      const t = (k % 3) / 2 - 0.5, row = k < 3 ? 0.2 : -0.1;
      stat(lg, leds[(i + k) % 3], px + t * 0.6, 1.175 + row * Math.sin(slope), -96.0 - row * Math.cos(slope), { cast: false });
    }
  }
  stat(new THREE.BoxGeometry(16.1, 0.03, 0.62), deskTop, 0, 1.0, -95.3, { cast: false });                    // the writing ledge
  for (let i = 0; i < 8; i++) {
    const mx = -7.0 + i * 2.0;
    stat(new THREE.BoxGeometry(0.62, 0.4, 0.05), bezel, mx, 1.62, -96.72, {});
    stat(new THREE.BoxGeometry(0.57, 0.35, 0.01), screen, mx, 1.62, -96.69, { cast: false });
    stat(new THREE.BoxGeometry(0.06, 0.14, 0.06), bezel, mx, 1.37, -96.75, { cast: false });
  }
  /* THE EQUIPMENT RUN: four relay cabinets along the north wall, solid, a
     metre of service gap between them, vented doors, and the duty screens on
     their tops at reading height. (Where eight 3 m black slabs used to hang
     with nothing behind them.) */
  const cab = K.skin("steel", 0x2a2f38, 0.5), vent = K.skin("steel", 0x1a1d22, 0.7);
  for (let i = 0; i < 4; i++) {
    const x = -12.6 + i * 8.4;
    const c = addBox(x, 1.0, -107.2, 7.4, 2.0, 1.0, 0x2a2f38, { solid: true });
    K.skinBox(c, "steel", 0x2a2f38);
    for (let d = 0; d < 6; d++) {
      const dx = x - 3.08 + d * 1.233;
      stat(new THREE.BoxGeometry(0.015, 1.9, 0.01), vent, dx + 0.616, 1.0, -106.695, { cast: false });   // door seams
      stat(new THREE.BoxGeometry(0.7, 0.25, 0.01), vent, dx, 1.65, -106.695, { cast: false });             // vent grille
      stat(new THREE.BoxGeometry(0.03, 0.2, 0.04), vent, dx + 0.5, 1.1, -106.68, { cast: false });         // handle
    }
    for (let m = 0; m < 3; m++) {
      const mx = x - 2.4 + m * 2.4;
      stat(new THREE.BoxGeometry(1.1, 0.66, 0.06), bezel, mx, 2.45, -107.25, {});
      stat(new THREE.BoxGeometry(1.03, 0.59, 0.01), screen, mx, 2.45, -107.215, { cast: false });
      stat(new THREE.BoxGeometry(0.1, 0.12, 0.1), bezel, mx, 2.06, -107.3, { cast: false });
    }
  }
  const RELEASE = { x: 0, z: -95.0, thrown: false };
  // the guard collar and the mushroom (the lamp is the button's own cap, and
  // the tick recolours it: red armed, green thrown)
  stat(new THREE.CylinderGeometry(0.16, 0.18, 0.05, 20), K.skin("steel", 0xd9b233), 0, 1.04, -95.25, { cast: false });
  stat(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 12), deskMat, 0, 1.08, -95.25, { cast: false });
  const releaseLamp = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0xff3b3b, emissive: 0xff0000, emissiveIntensity: 1.0 }));
  releaseLamp.scale.y = 0.55; releaseLamp.position.set(0, 1.12, -95.25);
  releaseLamp.userData.dynamic = true; releaseLamp.userData.mover = true;
  ROOT.add(releaseLamp);

  /* ==========================================================
     5. THE TICK. Leaves swing, cards read, picks turn, and the console
        throws. Order 41.44 sits beside world/adminwing.js's 41.4 so the two
        wings resolve their doors in the same frame batch, deterministically.
     ========================================================== */
  const READER_R2 = 3.4 * 3.4;
  function staffNear(d) {
    const list = CBZ.guards || [];
    for (let i = 0; i < list.length; i++) {
      const g = list[i];
      if (g.dead || g.ko > 0 || !g.group) continue;
      const dx = g.group.position.x - d.x, dz = g.group.position.z - d.z;
      if (dx * dx + dz * dz < READER_R2) return g;
    }
    return null;
  }
  // ONE hold-to-defeat beat, shared by all three cages — world/adminwing.js's
  // shape verbatim: a polled [E], a touch pill, and a PHYSICAL tell (the lamp
  // beats faster the closer the shackle is to giving) rather than a percentage.
  function pickBeat(d, dt) {
    const econ = CBZ.econ;
    const has = !!(econ && econ.hasItem && econ.hasItem("Lockpick"));
    const pid = d.id;
    if (!has) { if (CBZ.prisonPromptClear) CBZ.prisonPromptClear(pid); d.picked = 0; tell(d, 0, 0); return; }
    if (CBZ.prisonPrompt) CBZ.prisonPrompt(pid, "e", "Pick", { at: { x: d.x, y: 1.5, z: d.z }, hold: true });
    const working = !!(CBZ.keys && CBZ.keys.e);
    if (!working) { d.picked = Math.max(0, (d.picked || 0) - dt * 1.6); tell(d, d.picked / d.pick, 0); return; }
    d.picked = (d.picked || 0) + dt;
    tell(d, d.picked / d.pick, 1);
    if (CBZ.shake && d.picked % 0.55 < dt) CBZ.shake(0.02);
    if (d.picked >= d.pick) {
      d.picked = 0;
      if (CBZ.prisonPromptClear) CBZ.prisonPromptClear(pid);
      tell(d, 0, 0);
      d.setOpen(true);
    }
  }
  function tell(d, p, live) {
    const lamp = d.lamp;
    if (!lamp || d.open) return;
    if (!p && !live) { lamp.material.color.setHex(0xff3b3b); lamp.material.emissive.setHex(0xff0000); return; }
    const beat = live ? (Math.sin((CBZ.now || 0) * (0.010 + p * 0.024)) > 0) : true;
    lamp.material.color.setHex(beat ? 0xffb347 : 0x7a4f18);
    lamp.material.emissive.setHex(beat ? 0xff7a1a : 0x2a1a06);
  }

  function throwEverything() {
    if (RELEASE.thrown) return false;
    RELEASE.thrown = true;
    releaseLamp.material.color.setHex(0x39ff88);
    releaseLamp.material.emissive.setHex(0x14c258);
    for (let i = 0; i < doors.length; i++) if (doors[i] !== ctrlDoor) doors[i].setOpen(true);
    if (CBZ.openDoor) { try { CBZ.openDoor(); } catch (e) {} }       // the yard door itself
    if (CBZ.worldSfx) CBZ.worldSfx("door_open", RELEASE.x, RELEASE.z, { ref: 14 });
    // Every screw in the compound heard the racks go. This is the price: the
    // console is not a stealth answer, it is a LOUD one, exactly like the 5 lb
    // brick on the yard door (world/door.js) is the loud answer to the keycard.
    if (CBZ.addHeat) CBZ.addHeat(70);
    if (CBZ.guards) for (const gd of CBZ.guards) { gd.alert = 1; gd.hunt = Math.max(gd.hunt || 0, 8); }
    if (CBZ.jailTell) CBZ.jailTell.hint("EVERY DOOR IN THE HOUSE JUST OPENED", 2.6);
    else if (CBZ.flashHint) CBZ.flashHint("EVERY DOOR IN THE HOUSE JUST OPENED", 2.6);
    return true;
  }
  if (CBZ.registerBreachTarget) {
    CBZ.registerBreachTarget({
      id: "prison-control-console", lb: 7, reach: 2.4,
      at: function () { return { x: RELEASE.x, y: 1.3, z: RELEASE.z }; },
      done: function () { return RELEASE.thrown; },
      defeat: function () { throwEverything(); },
    });
  }

  let lockReg = false;
  CBZ.onUpdate(41.44, function (dt) {
    const g = CBZ.game;
    if (!g || g.mode !== "escape") return;
    if (pollNewRun && pollNewRun()) CBZ.resetPrisonWings();
    if (!lockReg && CBZ.cityLockRegister) {
      lockReg = true;
      for (let i = 0; i < doors.length; i++) if (doors[i].keys) CBZ.cityLockRegister(doors[i].id);
    }
    for (let i = 0; i < doors.length; i++) {
      const d = doors[i];
      const want = d.open ? 1 : 0;
      if (d.t !== want) {
        d.t += (want - d.t) * Math.min(1, dt * 4.4);
        if (Math.abs(want - d.t) < 0.01) d.t = want;
        d.set.set(d.t);
        if (want === 1 && d.t >= 0.4) {
          const ci = CBZ.colliders.indexOf(d.collider);
          if (ci >= 0) { CBZ.colliders.splice(ci, 1); if (CBZ.markCollidersDirty) CBZ.markCollidersDirty(); }
        }
      }
    }
    if (g.state !== "playing") return;
    const P = CBZ.player && CBZ.player.pos;
    if (!P) return;

    for (let i = 0; i < doors.length; i++) {
      const d = doors[i];
      const dx = P.x - d.x, dz = P.z - d.z, near2 = dx * dx + dz * dz;
      if (!d.open) {
        // a card door OPENS FOR STAFF — which is what makes tailgating a real
        // answer and a guard's route legible from across the yard.
        if (d.keys && staffNear(d)) { d.setOpen(true); continue; }
        if (near2 < 6.2) {
          if (d.keys) {
            // LAW 3: a door the player deliberately shut stays shut while he
            // is still inside this radius. Only the PROXIMITY open is latched
            // out — staffNear above is untouched, because a guard with a card
            // opens his own door and that is the tailgating window.
            if (CBZ.prisonDoorLatched && CBZ.prisonDoorLatched(d.id)) continue;
            const have = !!(g.hasKey || (CBZ.prisonStaffKey ? CBZ.prisonStaffKey() : g.role === "cop"));
            const L = CBZ.cityLock
              ? CBZ.cityLock({ id: d.id, verb: "press", label: d.label, have: have,
                  keys: d.keys, orgs: ["police"], power: false })
              : { open: have, line: "" };
            if (L.open) d.setOpen(true);
          } else if (d.pick) pickBeat(d, dt);
        } else if (d.pick && CBZ.prisonPromptClear) CBZ.prisonPromptClear(d.id);
      } else if (!d.blown && !RELEASE.thrown) {
        // it shuts behind whoever went through: a WINDOW, never a permanent hole
        const hold = near2 < 11 || (d.keys && !!staffNear(d));
        d.shutT = hold ? 3.0 : (d.shutT || 0) - dt;
        if (d.shutT <= 0) d.setOpen(false);
      }
    }

    // ---- THE CONSOLE ----
    if (!RELEASE.thrown) {
      const dx = P.x - RELEASE.x, dz = P.z - RELEASE.z;
      if (dx * dx + dz * dz < 5.0) {
        // "Throw", over the release lamp: the racks are the console you stand at.
        if (CBZ.prisonPrompt) CBZ.prisonPrompt("prison-control-console", "e", "Throw", { at: { x: RELEASE.x, y: 1.7, z: RELEASE.z }, d2: dx * dx + dz * dz });
        if (CBZ.keys && CBZ.keys.e) throwEverything();
      } else if (CBZ.prisonPromptClear) CBZ.prisonPromptClear("prison-control-console");
    }
  });

  /* A NEW RUN RE-LOCKS EVERYTHING — hooked off CBZ.jailBoost's run watcher and
     its state-exit list, exactly like world/adminwing.js, rather than by
     editing systems/state.js's reset (which already has a dozen owners). Tear
     down on the RUN ending, never on a pause: unlocking the compound behind
     the pause card and re-locking it on resume is the exact bug that list
     exists to prevent. */
  CBZ.resetPrisonWings = function () {
    for (let i = 0; i < doors.length; i++) {
      const d = doors[i];
      d.blown = false; d.picked = 0; d.shutT = 0;
      for (const p of d.pivots) p.visible = true;
      d.setOpen(false, true);
      d.t = 0; d.set.set(0);
    }
    RELEASE.thrown = false;
    releaseLamp.material.color.setHex(0xff3b3b);
    releaseLamp.material.emissive.setHex(0xff0000);
  };
  if (CBZ.jailBoost && CBZ.jailBoost.onStateExit)
    CBZ.jailBoost.onStateExit(CBZ.resetPrisonWings, ["title", "won", "lost"]);
  const pollNewRun = CBZ.jailBoost ? CBZ.jailBoost.newRunWatcher(0.5) : null;

  // ---- ratchet declaration (CBZ.prisonPromptAudit, systems/interactions.js)
  (CBZ._prisonPromptSites || (CBZ._prisonPromptSites = [])).push(
    "prison-tool-crib", "prison-knife-cage", "prison-property", "prison-control-console");

  /* ==========================================================
     6. THE RATCHET.
        `unreachable`  — a locked thing whose declared routes are ALL absent
                         from the build (a door nothing in the world opens).
        `orphanGates`  — a gap world/yard.js cut in a boundary wall with no
                         gate standing in it. That is a hole in the prison,
                         and it is the one way this file can fail silently.
        `insideHa`     — the compound's area, reported so a future change that
                         quietly shrinks it is visible as a number.
        `doorsInWalls` — GEOMETRY, and the one this file was missing. Every
                         check above asks about INVENTORY: do you own a card,
                         a pick, a charge. None of them can see a leaf that
                         swings inside a solid wall, so `unreachable` read 0
                         while the knife cage and the property cage had no
                         route in by any means and the tool crib had no wall
                         at all. This counts leaves whose own opening is still
                         occupied by somebody else's collider. PIN AT 0: the
                         one standing instance (the segregation gate in the
                         unit's solid south wall) moved into the unit's west
                         doorway on 2026-09-28, so any count now is a new one.
     ========================================================== */
  CBZ.prisonWingsAudit = function () {
    const econ = CBZ.econ;
    const canPick = !!(econ && econ.hasItem);
    const canBlast = !!CBZ.registerBreachTarget;
    const canCard = !!CBZ.cityLock;
    let unreachable = 0;
    for (let i = 0; i < doors.length; i++) {
      const d = doors[i];
      const routes = (d.keys ? (canCard ? 1 : 0) : 0) + (d.pick ? (canPick ? 1 : 0) : 0) + (canBlast ? 1 : 0);
      if (!routes) unreachable++;
    }
    // a gate gap with nothing in it. world/yard.js publishes what it cut.
    const cut = CBZ.prisonWallGaps || [];
    let orphan = 0;
    for (let i = 0; i < cut.length; i++) {
      const c = cut[i];
      let found = false;
      for (let j = 0; j < gates.length; j++) {
        const d = gates[j];
        if (Math.abs(d.x - c.x) < 1.2 && Math.abs(d.z - c.z) < 1.2) { found = true; break; }
      }
      if (!found) orphan++;
    }
    /* A LEAF THAT SWINGS INSIDE A WALL. Test the middle 60% of each opening
       so a jamb or the host room's wall meeting the span at its very end is
       not counted; anything else standing there is concrete the lock cannot
       move, because setOpen only ever splices out the leaf's own collider. */
    const cols = CBZ.colliders || [];
    const inWall = [];
    for (let i = 0; i < doors.length; i++) {
      const d = doors[i];
      const ax = d.axis === "x";
      const mid = (d.a0 + d.a1) / 2, half = (d.a1 - d.a0) * 0.3;
      const x0 = ax ? mid - half : d.fixed - 0.2, x1 = ax ? mid + half : d.fixed + 0.2;
      const z0 = ax ? d.fixed - 0.2 : mid - half, z1 = ax ? d.fixed + 0.2 : mid + half;
      for (let j = 0; j < cols.length; j++) {
        const c = cols[j];
        if (!c || c._city || c === d.collider || !isFinite(c.minX)) continue;
        if (c.minX < x1 && c.maxX > x0 && c.minZ < z1 && c.maxZ > z0) { inWall.push(d.id); break; }
      }
    }
    const w = OUT.x1 - OUT.x0, dz = OUT.z1 - OUT.z0;
    return {
      on: true,
      rect: { x0: OUT.x0, x1: OUT.x1, z0: OUT.z0, z1: OUT.z1 },
      insideM: { w: w, d: dz },
      insideHa: Math.round(w * dz / 100) / 100,
      rooms: rooms.length, doors: doors.length, gates: gates.length,
      wallGapsCut: cut.length,
      unreachable: unreachable,                   // MUST be 0
      orphanGates: orphan,                        // MUST be 0
      doorsInWalls: inWall.length,                // MUST be 0
      doorsInWallsIds: inWall,
      stocked: stock.length, laid: laid,
      consoleThrown: RELEASE.thrown,
      openNow: doors.filter(function (d) { return d.open; }).length,
    };
  };
})();
