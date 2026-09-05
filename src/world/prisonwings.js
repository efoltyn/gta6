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
   in it, i.e. a hole in the perimeter) both pinned at 0, and `doorsInWalls`
   (a leaf that swings inside somebody else's collider) pinned at 1.
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
  /* PRISON_PROP_HONESTY_V1 (declared world/cellblock.js, which parses first)
     is the one-line revert for the 2026-08-15 prop pass in this file: the
     three cage racks, segregation's registered bunks, the powerhouse plant
     and central control's video wall all fall back to the geometry they
     shipped with. Read `!== false` so this file still degrades on its own if
     the cell house is absent. */
  const HONEST = CBZ.CONFIG.PRISON_PROP_HONESTY_V1 !== false;
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
  function perim(x, z, w, d) {
    const m = addBox(x, YH / 2, z, w, YH, d, WALL, { solid: true, blockLOS: true });
    if (m && m.userData && m.userData.collider) m.userData.collider.noBreach = true;
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
  for (const s of [-1, 1]) {
    const a = s < 0 ? OUT.x0 : S.x1, b = s < 0 ? S.x0 : OUT.x1;
    perim((a + b) / 2, OUT.z1, b - a, 1);
    trim((a + b) / 2, OUT.z1, b - a, "x");
  }

  /* ---- ground. The new wings are hardstanding, not grass: a prison yard is
       poured, and world/ground.js's own texture verb keeps the two halves of
       the compound reading as one surface. Four slabs, laid AROUND the old
       compound so nothing is drawn twice over authored paving. ---- */
  const GV2 = !!(CBZ.CONFIG && CBZ.CONFIG.PRISON_GROUND_V2 && CBZ.prisonGroundTex);
  function slab(x, z, w, d, a, b, kind) {
    const tex = GV2 ? CBZ.prisonGroundTex(kind || "concrete", { a: a, b: b })
      : (CBZ.checkerTex ? CBZ.checkerTex(a, b, 2) : null);
    if (!tex) return null;
    tex.repeat.set(Math.max(1, Math.round(w / 6.3)), Math.max(1, Math.round(d / 6.3)));
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
      new THREE.MeshLambertMaterial({ map: tex }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.011, z);
    m.receiveShadow = true; ROOT.add(m);
    return m;
  }
  const GA = "#5b636c", GB = "#535b64";
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

  /* ---- corner towers. world/towers.js rings the OLD wall and keeps doing
       exactly that; these four stand on the new corners so the enlarged
       perimeter is watched rather than merely long. ---- */
  // world/prisonkit.js's tower, same deck height as the wall towers; NOT
  // registered in CBZ.towers (capture.js's fire came from the eight old
  // posts and still does), ladder and eave light facing the compound.
  const d7 = 0.7071;
  if (CBZ.guardTower) {
    CBZ.guardTower(OUT.x0 + 4, OUT.z0 + 4, { register: false, face: { x: d7, z: d7 } });
    CBZ.guardTower(OUT.x1 - 4, OUT.z0 + 4, { register: false, face: { x: -d7, z: d7 } });
    CBZ.guardTower(OUT.x0 + 4, OUT.z1 - 4, { register: false, face: { x: d7, z: -d7 } });
    CBZ.guardTower(OUT.x1 - 4, OUT.z1 - 4, { register: false, face: { x: -d7, z: -d7 } });
  }

  /* ==========================================================
     2. THE DOOR PRIMITIVE. One shape for every lock in this file, and it is
        world/adminwing.js's verbatim: a leaf on a pivot, its collider
        SPLICED in and out of CBZ.colliders (never merely hidden), the LOS
        blocker moved with it, and a status lamp that is the entire HUD.

        `bars` draws the leaf as a welded grille over a transparent pane
        instead of a slab — gun-room grammar rule (a): you must be able to
        SEE what the lock is holding, or the lock motivates nothing.
     ========================================================== */
  const DH = 2.6;
  const doors = [];
  function makeDoor(cfg) {
    const d = {
      id: cfg.id, label: cfg.label, keys: cfg.keys || null, pick: cfg.pick || 0,
      open: false, t: 0, picked: 0, blown: false, shutT: 0,
      axis: cfg.axis || "x",                       // 'x' = the opening runs along x
      a0: cfg.a0, a1: cfg.a1, fixed: cfg.fixed,
    };
    const span = cfg.a1 - cfg.a0;
    d.x = d.axis === "x" ? (cfg.a0 + cfg.a1) / 2 : cfg.fixed;
    d.z = d.axis === "x" ? cfg.fixed : (cfg.a0 + cfg.a1) / 2;
    const pivot = new THREE.Group();
    pivot.position.set(d.axis === "x" ? cfg.a0 : cfg.fixed, 0, d.axis === "x" ? cfg.fixed : cfg.a0);
    if (d.axis === "z") pivot.rotation.y = -Math.PI / 2;
    pivot.userData.mover = true;
    ROOT.add(pivot);
    // the leaf, built INTO the pivot (addBox parents to CBZ.prisonRoot, so a
    // leaf that has to ride a pivot must be built here, not adopted out).
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(span - 0.06, DH - 0.06, 0.12),
      CBZ.mat(cfg.color != null ? cfg.color : 0x3f4a57, {}));
    leaf.position.set(span / 2, (DH - 0.06) / 2, 0);
    leaf.castShadow = false; leaf.receiveShadow = true;
    if (cfg.bars) {
      leaf.material = new THREE.MeshLambertMaterial({ color: 0x39424e, transparent: true, opacity: 0.06, depthWrite: false });
      const bar = (w, h, px, py) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.09), CBZ.mat(0x2a2f38, {}));
        m.position.set(px, py, 0); m.castShadow = false; pivot.add(m); return m;
      };
      const nb = Math.max(3, Math.round(span / 0.42));
      for (let i = 0; i <= nb; i++) bar(0.075, DH - 0.1, 0.05 + i * (span - 0.1) / nb, (DH - 0.06) / 2);
      bar(span - 0.06, 0.1, span / 2, 0.35);
      bar(span - 0.06, 0.1, span / 2, DH - 0.35);
    }
    pivot.add(leaf);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.06), CBZ.mat(0x21262e, {}));
    plate.position.set(span - 0.26, 1.02, 0.085); pivot.add(plate);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.07),
      new THREE.MeshLambertMaterial({ color: 0xff3b3b, emissive: 0xff0000, emissiveIntensity: 1.0 }));
    lamp.position.set(span - 0.26, 1.44, 0.1); pivot.add(lamp);
    d.pivot = pivot; d.leaf = leaf; d.lamp = lamp;
    d.collider = d.axis === "x"
      ? { minX: cfg.a0, maxX: cfg.a1, minZ: cfg.fixed - 0.1, maxZ: cfg.fixed + 0.1, ref: leaf }
      : { minX: cfg.fixed - 0.1, maxX: cfg.fixed + 0.1, minZ: cfg.a0, maxZ: cfg.a1, ref: leaf };
    CBZ.colliders.push(d.collider);
    if (CBZ.losBlockers) CBZ.losBlockers.push(leaf);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    d.setOpen = function (v, quiet) {
      v = !!v;
      if (v === d.open) return v;
      d.open = v;
      const i = CBZ.colliders.indexOf(d.collider);
      if (v && i >= 0) CBZ.colliders.splice(i, 1);
      else if (!v && i < 0) CBZ.colliders.push(d.collider);
      if (CBZ.losBlockers) {
        const li = CBZ.losBlockers.indexOf(leaf);
        if (v && li >= 0) CBZ.losBlockers.splice(li, 1);
        else if (!v && li < 0) CBZ.losBlockers.push(leaf);
      }
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
      lamp.material.color.setHex(v ? 0x39ff88 : 0xff3b3b);
      lamp.material.emissive.setHex(v ? 0x14c258 : 0xff0000);
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
        defeat: function () { d.setOpen(true); d.blown = true; d.leaf.visible = false; },
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
      at: function () { return { x: d.x, y: 1.4, z: d.z }; },
      pick: function () { return [pivot]; },
      col: function () { return d.collider; },
      isOpen: function () { return !!d.open; },
      permanent: function () { return !!(d.blown || RELEASE.thrown); },
      canUse: function () {
        if (d.keys) return !!(CBZ.game && (CBZ.game.hasKey || CBZ.game.role === "cop"));
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
    // the wall above the opening: never solid (systems/actorcollide.js clamps
    // an actor against any box with no vertical span, so a y-gated solid head
    // reads full height to every body and seals the gate for the whole cast).
    addBox(g.fixed, (DH + YH) / 2, g.c, 1, YH - DH, GATE_W, WALL, { cast: false, blockLOS: true });
    addBox(g.fixed, DH + 0.2, g.c, 1.3, 0.34, GATE_W + 0.5, 0x39424e, { cast: false });
    for (const s of [-1, 1]) addBox(g.fixed, 1.5, g.c + s * (GATE_W / 2), 1.3, 3.0, 0.28, 0x39424e, { cast: false });
    if (PD && PD.lamp) { try { PD.lamp(g.fixed + 0.62, 3.0, g.c, "x+"); } catch (e) {} }
    return makeDoor({
      id: g.id, label: g.label, keys: ["Keycard"], bars: true, lb: 5,
      axis: "z", a0: g.c - GATE_W / 2, a1: g.c + GATE_W / 2, fixed: g.fixed,
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
      wall: cfg.wall, floor: cfg.floor, skin: "panel",
      doors: [{ side: cfg.side, center: cfg.dc, width: cfg.dw }],
    });
    if (CBZ.prisonRoof) CBZ.prisonRoof({
      id: cfg.id, x0: cfg.x0, x1: cfg.x1, z0: cfg.z0, z1: cfg.z1, top: cfg.h, over: 0.25,
    });
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
    if (PD && typeof PD.strip === "function") {
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
    const openS = cfg.open || "S";                 // which side faces the room
    if (openS === "S" || openS === "N") {
      const zf = openS === "S" ? z1 : z0;
      for (const r of runs(x0, x1)) {
        const w = r[1] - r[0];
        if (w <= 0.02) continue;
        pane((r[0] + r[1]) / 2, zf, w, 0.12);
        for (let i = 0; i * 0.44 < w - 0.2; i++) addBox(r[0] + 0.2 + i * 0.44, ch / 2, zf, 0.08, ch - 0.04, 0.08, 0x2a2f38, { cast: false });
      }
      addBox((x0 + x1) / 2, ch + 0.02, zf, x1 - x0, 0.12, 0.12, 0x2a2f38, { cast: false });
    }
    const xf = cfg.side === "W" ? x0 : x1;
    pane(xf, (z0 + z1) / 2, 0.12, z1 - z0);
    for (let i = 0; i * 0.44 < z1 - z0 - 0.2; i++) addBox(xf, ch / 2, z0 + 0.2 + i * 0.44, 0.08, ch - 0.04, 0.08, 0x2a2f38, { cast: false });
    addBox(xf, ch + 0.02, (z0 + z1) / 2, 0.12, 0.12, z1 - z0, 0x2a2f38, { cast: false });
    // the three room-sized "shelves" this used to end with — see cageRack below
    if (!HONEST) for (let s2 = 0; s2 < 3; s2++)
      addBox((x0 + x1) / 2, 0.62 + s2 * 0.72, (z0 + z1) / 2, (x1 - x0) - 1.6, 0.07, (z1 - z0) - 1.6, 0xb9a184, { cast: false });
    return cfg;
  }

  /* ---- THE RACK THE CAGE IS ACTUALLY HOLDING SOMETHING ON ---------------
     WHAT WAS HERE, and it was the worst thing in the compound. `cage()` ended
     with three "shelves" sized to the WHOLE cage:
         addBox(cx, 0.62 + s*0.72, cz, (x1-x0)-1.6, 0.07, (z1-z0)-1.6, 0xb9a184)
     In the tool crib that is a 10.4 x 14.4 m cream plane, 7 cm thick, three of
     them stacked, and it was the entire visible content of the room. Measured
     by tools/visual-presets/prison-rooms.mjs against the baseline in
     artifacts/visual-comparisons/prison-rooms-audit: deadPropVolume 10.48 m3
     in the tool crib, 7.57 in the knife cage, 9.03 in the property cage —
     27.08 m3 of "shelf" a body walked straight through, in three rooms that
     exist to hold three or four placed items each.

     What replaces it is sized to the ITEMS, not to the room. One steel rack
     on the cage's back wall: four decks, four uprights, a back sheet, and ONE
     collider over its own footprint, so a body is stopped by it and it is
     cover. The deck at 0.80 m is the surface the cage's placed items lie on —
     the same 0.80 m every stockCage() row below already declared, which is
     what "standing where they lie" means here.

     0.55 m DEEP IS THE LOAD-BEARING NUMBER. systems/prisondrops.js:78 picks a
     floor item up inside AUTO_R = 1.15 m; with a 0.55 m rack and the items set
     0.12 m proud of its centre line, a man stopped against the face stands
     ~0.73 m from the prize. Deeper than that and making the rack solid would
     lock the cage's own contents away behind it.

     NOT blockLOS, deliberately: gun-room grammar rule (a) is that you can SEE
     what the lock is holding, and a rack that occludes it removes the only
     reason the 3.2-5.6 s pick is worth starting.                            */
  const RACK_D = 0.55, RACK_DECKS = [0.40, 0.80, 1.24, 1.70], RACK_H = 1.86;
  function cageRack(cfg) {
    if (!HONEST) return cfg;
    const L = cfg.len, F = cfg.face || 1;        // F: which way the back sheet faces
    for (const y of RACK_DECKS)
      addBox(cfg.x, y - 0.025, cfg.z, L - 0.16, 0.05, RACK_D - 0.08, 0x9aa2aa, { cast: false });
    for (const s of [-1, 1]) for (const t of [-1, 1])
      addBox(cfg.x + s * (L / 2 - 0.05), RACK_H / 2, cfg.z + t * (RACK_D / 2 - 0.05),
        0.08, RACK_H, 0.08, 0x5b6470, { cast: false });
    addBox(cfg.x, RACK_H / 2, cfg.z + F * (RACK_D / 2 - 0.025), L, RACK_H, 0.05, 0x6f7883, { cast: false });
    // ONE collider for the unit. addBox's own `solid:` would give each deck a
    // rect of its own and the frame none: a rack is one piece of furniture and
    // is stopped against as one.
    const col = { minX: cfg.x - L / 2, maxX: cfg.x + L / 2,
      minZ: cfg.z - RACK_D / 2, maxZ: cfg.z + RACK_D / 2, y0: 0, y1: RACK_H };
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
    wall: 0x7c8590, floor: 0x69707a, side: "E", dc: 20, dw: 6 });
  addBox(-66, 6.6, 20, 0.2, 0.9, 5.0, 0xc85c00, { cast: false });        // sign band
  // shop floor: benches down the middle, stock racks on the back wall. Solid,
  // because world/clutter.js's rule is that anything a body can approach is
  // solid or it reads as a decoy.
  for (let i = 0; i < 5; i++) {
    const z = 2 + i * 9;
    addBox(-100, 0.8, z, 5.0, 0.18, 1.4, 0x8a939d, { solid: true });
    addBox(-102.2, 0.4, z, 0.22, 0.8, 1.1, 0x5b6470, { cast: false });
    addBox(-97.8, 0.4, z, 0.22, 0.8, 1.1, 0x5b6470, { cast: false });
    addBox(-99.0, 1.02, z, 0.42, 0.32, 0.42, 0x2a2f38, { cast: false });   // vice
    addBox(-84, 0.8, z, 5.0, 0.18, 1.4, 0x8a939d, { solid: true });
    addBox(-86.2, 0.4, z, 0.22, 0.8, 1.1, 0x5b6470, { cast: false });
    addBox(-81.8, 0.4, z, 0.22, 0.8, 1.1, 0x5b6470, { cast: false });
  }
  for (let i = 0; i < 6; i++) addBox(-70, 1.3, -1 + i * 7.6, 2.2, 2.6, 2.4, 0x6b7480, { solid: true });  // stock racks
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
  stockCage(HONEST
    ? [["Hacksaw Blade", -110, 0.80, 43.23], ["Lockpick", -108, 0.80, 43.23], ["Pickaxe", -112, 0.80, 43.23]]
    : [["Hacksaw Blade", -110, 0.80, 36], ["Lockpick", -108.4, 0.80, 34.6], ["Pickaxe", -111.6, 0.80, 34.6]]);
  const cribDoor = makeDoor({
    id: "prison-tool-crib", label: "The tool crib", pick: 3.2, bars: true, lb: 5,
    axis: "x", a0: CRIB_DOOR.a0, a1: CRIB_DOOR.a1, fixed: CRIB_DOOR.fixed, color: 0x39424e,
  });

  /* POWERHOUSE — deliberately UNLOCKED. An empty-handed room is a legitimate
     authored outcome (world/roombuild.js says so about "empty"), and a
     compound where every door is a puzzle is a puzzle box, not a place. What
     it gives is COVER and a second way to cross the west wing at night. */
  room({ id: "powerhouse", x0: -112, x1: -84, z0: 62, z1: 94, h: 8,
    wall: 0x6f7883, floor: 0x5e656e, side: "E", dc: 78, dw: 5 });
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
  if (!HONEST) {                                     // the shipped powerhouse, byte for byte
    for (let i = 0; i < 3; i++) {
      addBox(-104 + i * 8, 2.0, 70, 4.0, 4.0, 4.0, 0x7d8794, { solid: true });
      addBox(-104 + i * 8, 4.6, 70, 1.1, 1.2, 1.1, 0x5b6470, { cast: false });
      addBox(-104 + i * 8, 5.9, 70, 0.7, 1.4, 0.7, 0x4a525c, { cast: false });
    }
    for (let i = 0; i < 5; i++) addBox(-98, 6.4, 76 + i * 3.4, 24, 0.34, 0.34, 0x66717c, { cast: false });
    addBox(-88, 1.1, 88, 2.4, 2.2, 1.2, 0x515a66, { solid: true });
    addBox(-88, 1.7, 87.35, 1.8, 0.9, 0.08, 0x9fd6ff, { emissive: 0x3a6ea5, ei: 0.5, cast: false });
  }
  for (let i = 0; HONEST && i < 3; i++) {
    const bx = -104 + i * 8;
    addBox(bx, 2.0, 70, 4.0, 4.0, 4.0, 0x7d8794, { solid: true });                    // boiler
    addBox(bx, 4.6, 70, 1.1, 1.2, 1.1, 0x5b6470, { cast: false });                    // header drum, on the boiler's own footprint
    // the uptake: a full-height duct off the boiler's west shoulder. It used
    // to be a 0.7 x 1.4 box floating at 5.9 m with four metres of air under it.
    addBox(bx - 2.6, 4.0, 70, 0.8, 8.0, 0.8, 0x4a525c, { solid: true, blockLOS: true });
  }
  /* A PIPE BANK IS PIPES. Three runs stacked to 1.6 m on stanchions every
     3.5 m, each run its own collider — cover you crouch behind and a wall you
     cannot walk through, which is what the five overhead lines were pretending
     to be. blockLOS only on the middle run: one blocker per bank is what a
     guard's sight line needs, three would be two wasted rays per bank. */
  function pipeBank(bx0, bx1, z) {
    const len = bx1 - bx0, cx = (bx0 + bx1) / 2;
    const ys = [0.62, 1.02, 1.42];
    for (let i = 0; i < ys.length; i++)
      addBox(cx, ys[i], z, len, 0.34, 0.34, i === 1 ? 0x5b6470 : 0x66717c,
        { solid: true, blockLOS: i === 1 });
    for (let s = 0; s * 3.5 <= len; s++)
      addBox(bx0 + Math.min(s * 3.5, len), 0.80, z, 0.16, 1.60, 0.52, 0x515a66, { solid: true });
  }
  if (HONEST) { pipeBank(-110, -98, 76); pipeBank(-96, -85, 83); pipeBank(-110, -99, 89); }
  // switchgear: a row, not a lone cabinet. Each carries its own live panel.
  for (let i = 0; HONEST && i < 3; i++) {
    const sx = -88 - i * 6;
    addBox(sx, 1.1, 92, 2.4, 2.2, 1.1, 0x515a66, { solid: true });
    // the live panel: 5 cm of emissive skin on the cabinet's own face, inside
    // the cabinet's collider rect. A facing, like a sign band — not a prop.
    addBox(sx, 1.7, 91.42, 1.8, 0.9, 0.05, 0x9fd6ff, { emissive: 0x3a6ea5, ei: 0.5, cast: false });
  }

  // ---------------------------------------------------------------- EAST WING
  /* SEGREGATION. A second cell house, and the one place in the compound with
     nobody in the corridor — which is exactly why the map is in it. Its
     control door takes the Keycard, so the card that gets you out of the
     housing unit is also the card that gets you into the one nobody walks. */
  room({ id: "segregation", x0: 58, x1: 112, z0: -4, z1: 44, h: 7,
    wall: 0x848d98, floor: 0x646b74, side: "W", dc: 20, dw: 5 });
  addBox(58, 6.1, 20, 0.2, 0.9, 4.2, 0x9a3b3b, { cast: false });
  // sixteen singles in two facing rows off a central corridor. Partitions are
  // real colliders and deliberately NOT noBreach: blowing through a seg wall
  // is precisely the route the charge table exists for.
  for (let r = 0; r < 2; r++) {
    const zf = r ? 34 : 6;                                  // the cell-front plane
    for (let i = 0; i < 8; i++) {
      const cx = 62 + i * 6.2;
      addBox(cx - 3.1, 1.75, zf + (r ? 4 : -4), 0.3, 3.5, 8, 0x6f7883, { solid: true, blockLOS: true });
      // the barred front: a welded grille you can see the bunk through
      for (let b = 0; b < 6; b++) addBox(cx - 2.6 + b * 1.0, 1.6, zf, 0.09, 3.2, 0.09, 0x2a2f38, { cast: false });
      addBox(cx, 3.24, zf, 6.0, 0.14, 0.14, 0x2a2f38, { cast: false });
      addBox(cx, 1.75, zf, 6.0, 3.5, 0.16, 0x39424e, { solid: true, blockLOS: false });
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
      if (HONEST && CBZ.prisonBunk) CBZ.prisonBunk({ id: "seg-" + r + "-" + i, x: cx - 1.5, z: bz, along: "x", double: false, blanket: 0x4a5b46, punitive: true });
      else {
        addBox(cx - 1.5, 0.44, bz, 1.9, 0.2, 0.86, 0x8a939d, { solid: true });
        addBox(cx - 1.5, 0.60, bz, 1.75, 0.14, 0.78, 0x4a5b46, { cast: false });
      }
      // the combo is SOLID here where it is not in the cell house: a seg cell
      // is 6.2 x 8 m against the cell house's 3.8 m, so there is floor to
      // spare and no reason a man should walk through the toilet.
      addBox(cx + 2.0, 0.36, zf + (r ? 7.2 : -7.2), 0.62, 0.72, 0.64, 0xc7ccd2, { solid: HONEST });
    }
    addBox(87, 1.75, zf + (r ? 8 : -8), 54, 3.5, 0.3, 0x6f7883, { solid: true, blockLOS: true });  // back wall
  }
  stockCage([["Contraband Map", 104.5, 0.62, 41.0]]);
  const segDoor = makeDoor({
    id: "prison-segregation", label: "The segregation gate", keys: ["Keycard"], bars: true, lb: 5,
    axis: "x", a0: 99, a1: 102.6, fixed: 44, color: 0x39424e,
  });

  /* KITCHEN. A prison this size feeds nine hundred men from one room, and
     that room is where every edged weapon in the yard comes from. The cage
     in the corner is the only reason it is on the map. */
  room({ id: "kitchen", x0: 58, x1: 110, z0: 60, z1: 96, h: 7,
    wall: 0xb6bcc2, floor: 0x9aa2aa, side: "W", dc: 78, dw: 5 });
  addBox(58, 6.1, 78, 0.2, 0.9, 4.2, 0x2f9e6a, { cast: false });
  for (let i = 0; i < 4; i++) {                            // ranges + steam kettles
    addBox(64 + i * 7, 0.5, 66, 4.4, 1.0, 2.2, 0x8a939d, { solid: true });
    addBox(64 + i * 7, 1.06, 66, 4.0, 0.12, 1.9, 0x5b6470, { cast: false });
  }
  for (let i = 0; i < 5; i++) addBox(66 + i * 8, 0.5, 80, 5.4, 1.0, 1.4, 0xc7ccd2, { solid: true });  // prep tables
  // WALK-IN COOLER: a room inside a room, and the only place in the compound
  // out of every sightline in it. Not a locked prize — a hiding place.
  addBox(64, 1.55, 92.2, 12, 3.1, 0.3, 0x9aa2aa, { solid: true, blockLOS: true });
  addBox(58.15, 1.55, 88.6, 0.3, 3.1, 7.2, 0x9aa2aa, { solid: true, blockLOS: true });
  addBox(70, 1.55, 88.6, 0.3, 3.1, 7.2, 0x9aa2aa, { solid: true, blockLOS: true });
  addBox(64, 3.2, 90.4, 12, 0.2, 7.4, 0x8892a0, { cast: false, blockLOS: true });
  const KNIFE_DOOR = { a0: 102.2, a1: 105.2, fixed: 84 };
  cage({ x0: 98, x1: 110, z0: 84, z1: 96, side: "W", open: "N", h: 2.9, gap: KNIFE_DOOR });
  cageRack({ x: 104, z: 95.35, len: 5.0, face: 1 });
  stockCage(HONEST
    ? [["Shiv", 104, 0.80, 95.23], ["Razor Blade", 105.6, 0.80, 95.23], ["Hatchet", 102.4, 0.80, 95.23]]
    : [["Shiv", 104, 0.80, 90], ["Razor Blade", 105.6, 0.80, 91.4], ["Hatchet", 102.4, 0.80, 91.4]]);
  const knifeDoor = makeDoor({
    id: "prison-knife-cage", label: "The knife cage", pick: 4.4, bars: true, lb: 5,
    axis: "x", a0: KNIFE_DOOR.a0, a1: KNIFE_DOOR.a1, fixed: KNIFE_DOOR.fixed, color: 0x39424e,
  });

  /* VISITATION & PROPERTY. The room a man is processed through, and the room
     his own things are kept in while he is inside — which is why the property
     cage holds valuables and a phone rather than a weapon. */
  room({ id: "visitation", x0: 62, x1: 110, z0: 104, z1: 126, h: 6,
    wall: 0xc0b8a6, floor: 0x7d7466, side: "W", dc: 115, dw: 4 });
  addBox(62, 5.2, 115, 0.2, 0.9, 3.4, 0x3a6ea5, { cast: false });
  for (let i = 0; i < 6; i++) {                            // visit booths: a counter and a screen
    const x = 66 + i * 5;
    addBox(x, 0.55, 110, 3.4, 1.1, 0.9, 0xa9a294, { solid: true });
    addBox(x, 1.7, 110, 3.2, 1.2, 0.1, 0xa9d9ea, { cast: false });
    if (CBZ.roomSeatAnchor) {
      try {
        CBZ.roomSeatAnchor(x, 0, 108.4, Math.PI, "stool", null, { cushion: 0.46, floorBelow: 0 });
        CBZ.roomSeatAnchor(x, 0, 111.6, 0, "stool", null, { cushion: 0.46, floorBelow: 0 });
      } catch (e) {}
    }
    for (const s of [-1, 1]) { addBox(x, 0.42, 110 + s * 1.6, 0.44, 0.08, 0.44, 0x52606d, { cast: false }); addBox(x, 0.21, 110 + s * 1.6, 0.14, 0.42, 0.14, 0x9aa0a8, { cast: false }); }
  }
  const PROP_DOOR = { a0: 101.5, a1: 104.5, fixed: 116 };
  cage({ x0: 96, x1: 110, z0: 104, z1: 116, side: "W", open: "S", h: 2.9, gap: PROP_DOOR });
  // this cage opens SOUTH, so its back wall is z=104 and the rack faces -z.
  cageRack({ x: 103, z: 104.65, len: 6.0, face: -1 });
  stockCage(HONEST
    ? [["Stolen Wallet", 102, 0.80, 104.77], ["Cash Roll", 104, 0.80, 104.77],
      ["Luxury Watch", 100.4, 0.80, 104.77], ["Burner Phone", 105.6, 0.80, 104.77]]
    : [["Stolen Wallet", 102, 0.80, 110], ["Cash Roll", 104, 0.80, 111.4],
      ["Luxury Watch", 100.4, 0.80, 108.6], ["Burner Phone", 105.6, 0.80, 109.2]]);
  const propDoor = makeDoor({
    id: "prison-property", label: "The property cage", pick: 5.6, bars: true, lb: 5,
    axis: "x", a0: PROP_DOOR.a0, a1: PROP_DOOR.a1, fixed: PROP_DOOR.fixed, color: 0x39424e,
  });

  // -------------------------------------------------------------- THE BUBBLE
  /* CENTRAL CONTROL. The second armoury, and it answers to the same key the
     first one's inner cage does — the Warden's own. What it gives is not a
     thing you carry: it is a CONSOLE, and pressing it throws every lock in
     the compound at once. That is the category change rule (c): you stop
     being a man with a key and become the man who runs the doors. */
  room({ id: "control", x0: -26, x1: 26, z0: -108, z1: -78, h: 6.5,
    wall: 0x8d9099, floor: 0x4a525c, side: "S", dc: 0, dw: 4 });
  const ctrlDoor = makeDoor({
    id: "prison-control", label: "Central control", keys: ["Gun-Room Key"], lb: 7,
    axis: "x", a0: -2, a1: 2, fixed: -78, color: 0x5c4326,
  });
  // the console: a desk of panels facing a bank of monitors. The BUTTON is the
  // one thing in this room that is not scenery.
  addBox(0, 0.62, -96, 16, 1.24, 2.0, 0x39424e, { solid: true });
  addBox(0, 1.28, -96, 15.4, 0.12, 1.8, 0x2a2f38, { cast: false });
  for (let i = 0; i < 12; i++)
    addBox(-7.0 + i * 1.27, 1.36, -96.5, 0.55, 0.06, 0.34, [0x6fb7ff, 0x39ff88, 0xffb347][i % 3],
      { emissive: [0x2a5e85, 0x14c258, 0x7a4f18][i % 3], ei: 0.7, cast: false });
  /* THE VIDEO WALL. What was here: eight 3.0 x 1.0 x 0.1 black slabs (0x0d1117)
     with an emissive face on each, hung at y 2.5 and y 3.9 on the north wall
     with nothing behind them and nothing under them — sixteen boxes a body
     walks straight through, and the upper row was four screens at 3.9 m that
     nobody standing in the room can read.
     The relay gear that throws every lock in the compound has to be somewhere,
     and this is the room that claims to do it: it is a 2 m equipment run along
     the north wall now, solid, four cabinets with a metre of service gap
     between them, and ONE row of screens skinned onto their faces at 1.45 m —
     the height a duty officer actually reads. The bezel is gone; a screen is
     the lit face, the same way a sign band is a lit face. */
  for (let i = 0; !HONEST && i < 8; i++) {          // the shipped monitor wall, byte for byte
    const x = -12.5 + (i % 4) * 8.4, y = i < 4 ? 3.9 : 2.5;
    addBox(x, y, -107.5, 3.0, 1.0, 0.1, 0x0d1117, { cast: false });
    addBox(x, y, -107.42, 2.7, 0.82, 0.05, 0x2f6b8f, { emissive: 0x1b4c6b, ei: 0.6, cast: false });
  }
  for (let i = 0; HONEST && i < 4; i++) {
    const x = -12.6 + i * 8.4;
    addBox(x, 1.0, -107.2, 7.4, 2.0, 1.0, 0x2a2f38, { solid: true });                // relay cabinet
    addBox(x, 1.45, -106.68, 5.6, 1.05, 0.05, 0x2f6b8f, { emissive: 0x1b4c6b, ei: 0.6, cast: false });
  }
  const RELEASE = { x: 0, z: -95.0, thrown: false };
  const releaseLamp = addBox(0, 1.44, -95.0, 0.4, 0.16, 0.4, 0xff3b3b,
    { emissive: 0xff0000, ei: 1.0, cast: false });
  releaseLamp.userData.dynamic = true;
  addBox(0, 1.30, -95.0, 0.7, 0.22, 0.7, 0x21262e, { cast: false });

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
        d.pivot.rotation.y = (d.axis === "z" ? -Math.PI / 2 : 0) - d.t * 1.9;
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
            const have = !!(g.hasKey || g.role === "cop");
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
      if (d.leaf) d.leaf.visible = true;
      d.setOpen(false, true);
      d.t = 0; d.pivot.rotation.y = (d.axis === "z" ? -Math.PI / 2 : 0);
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
                         occupied by somebody else's collider. It is REPORTED,
                         not thrown: `prison-segregation` is a known standing
                         instance (its leaf sits in the seg block's south
                         exterior wall, behind the cell backs — the room is
                         entered by its west doorway and the gate gates
                         nothing), so the honest pin today is 1, and a 2 means
                         a new one was just built.
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
      doorsInWalls: inWall.length,                // pinned at 1 (see the header)
      doorsInWallsIds: inWall,
      stocked: stock.length, laid: laid,
      consoleThrown: RELEASE.thrown,
      openNow: doors.filter(function (d) { return d.open; }).length,
    };
  };
})();
