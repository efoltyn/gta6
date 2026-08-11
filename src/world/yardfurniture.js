/* ============================================================
   world/yardfurniture.js — THE YARD IS A PRISON YARD.

   OWNER'S RULE: a real jail, not a prop dump. No treasure chests, no random
   crates of loot in the yard.

   world/crates.js already killed the container VERB (PRISON_NO_CHESTS): five
   packing cases stood in the exercise yard with the pry beat, the payout and
   the chip stripped out, kept purely because they BREAK GUARD LINE OF SIGHT
   and are the yard's whole stealth layer. That was the right call at the time
   and it is still half a job. Nothing bolts a packing case to the middle of
   an exercise yard. Five of them in a row is a prop dump that has been told
   to stop talking.

   So the COVER SURVIVES AND THE BOXES DO NOT. Every installation below sits
   on a spot a crate used to hold, blocks at least as much sightline as the
   2.6 m case it replaces, and is a thing a real yard actually contains:

     handball wall (-9, 22)   the canonical yard object: a poured concrete
                              wall you play off. 6.0 x 3.2 — MORE cover than
                              the crate, and the reason a yard has one wall
                              standing in the middle of it.
     weight pile  (8, 28)     a squat rack with a loaded bar, a bench and a
                              plate tree. The rack's own back plate is the
                              LOS blocker.
     pavilion    (-12, 36)    a covered shelter with a solid back wall and
                              two bolted chow tables under it, out of the sun
                              and out of the tower's view.
     phone bank  (11, 17)     three hooded payphones on a back panel, on the
                              armoury approach — the one place in a prison
                              where standing still for two minutes is normal.
     notice board (3.6, 11)   the yard board, and a pair of tables opposite
                              it. Both sit BESIDE the central walkway rather
                              than in it: cover on each side of a lane reads
                              better, and world/clutter.js's own keep-out
                              already calls that lane sacred.

   Seating is CBZ.furnish/CBZ.prisonDress, never new geometry: PD.roundTable
   is the bolted four-stool chow table this compound already uses indoors,
   with real propuse anchors, so an inmate can sit at a yard table for the
   same reason he can sit at a mess table.

   ---- THE TWO TOOLS GET AN ADDRESS ------------------------------------
   The Hacksaw Blade and the Lockpick were lying ON TOP of two of the crates,
   which is better than inside them and still arbitrary. They are the keys to
   world/gunroom.js's inner cage and world/adminwing.js's office, so where
   they live is level design, not decoration:

       Hacksaw Blade -> the WORKSHOP bench, beside the vise and the stripped
                        gun already laid out on it (world/southblock.js).
       Lockpick      -> the LAUNDRY, on a linen cart. Contraband is made
                        where the machines are loud and the screws are not.

   Both are in the SOUTH BLOCK — which is where the schedule's `work` block
   (13:00) sends the whole population anyway. The prison hands you the tools
   during the hour it makes you walk past them.

   Flag PRISON_YARD_FURNITURE (world/crates.js reads the same flag to stand
   its five cases down). Ratchet CBZ.yardFurnitureAudit().cover — LOS
   blockers standing in the north yard — may never fall below the 5 the
   crates provided.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.addBox) return;
  const { addBox } = CBZ;
  const ROOT = CBZ.prisonRoot || CBZ.scene;
  const PD = CBZ.prisonDress || null;

  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.PRISON_YARD_FURNITURE == null) CBZ.CONFIG.PRISON_YARD_FURNITURE = true;
  if (CBZ.CONFIG.PRISON_YARD_FURNITURE === false) return;

  const C_CONC = 0xa9a396, C_CONC_D = 0x8d8779, C_STEEL = 0x6b7480, C_STEEL_D = 0x4a525c;
  let cover = 0;                 // LOS blockers this file stands up
  function blocker(x, y, z, w, h, d, color, opts) {
    opts = opts || {};
    opts.solid = true; opts.blockLOS = true;
    cover++;
    return addBox(x, y, z, w, h, d, color, opts);
  }

  /* ==========================================================
     1. THE HANDBALL WALL. One poured slab, a painted service line, and the
        scuff where forty years of balls have hit it. It is the single best
        piece of cover in the yard and it needs no explanation at all.
     ========================================================== */
  (function handball(x, z) {
    const W = 6.0, HH = 3.2;
    blocker(x, HH / 2, z, W, HH, 0.5, C_CONC);
    addBox(x, HH + 0.12, z, W + 0.2, 0.24, 0.66, C_CONC_D, { cast: false });      // coping
    // the service line and the strike scuff, on the side you play from
    addBox(x, 1.72, z + 0.27, W - 0.3, 0.09, 0.04, 0xc94d3a, { cast: false });
    addBox(x, 0.95, z + 0.27, W - 1.8, 1.3, 0.03, 0x9b968a, { cast: false, receive: false });
    // buttress piers, because a free-standing 3 m wall has them
    for (const s of [-1, 1]) addBox(x + s * (W / 2 - 0.4), 0.9, z - 0.55, 0.5, 1.8, 0.7, C_CONC_D, {});
    // the poured pad it stands on
    addBox(x, 0.025, z + 3.2, W + 1.6, 0.05, 6.4, 0x8f8a80, { cast: false });
  })(-9, 22);

  /* ==========================================================
     2. THE WEIGHT PILE. world/props.js already has a bench and a dumbbell
        rack at (-22,32) and world/southblock.js has two more in the lower
        yard, so this is the SQUAT RACK neither of them has — and the rack's
        back plate is what does the sightline work the crate used to.
     ========================================================== */
  (function weights(x, z) {
    // rubber matting
    addBox(x, 0.03, z, 4.4, 0.06, 3.6, 0x2f3238, { cast: false });
    // the rack: two uprights, a back plate, a top bar
    for (const s of [-1, 1]) addBox(x + s * 0.85, 1.15, z - 0.6, 0.16, 2.3, 0.16, C_STEEL_D, { solid: true });
    blocker(x, 1.15, z - 0.72, 1.86, 2.3, 0.12, C_STEEL_D, { cast: false });
    addBox(x, 2.24, z - 0.6, 2.0, 0.12, 0.12, C_STEEL, { cast: false });
    // J-hooks and the loaded bar sitting in them
    for (const s of [-1, 1]) addBox(x + s * 0.85, 1.42, z - 0.44, 0.2, 0.1, 0.22, C_STEEL, { cast: false });
    addBox(x, 1.5, z - 0.44, 2.3, 0.07, 0.07, 0x9aa0a8, { cast: false });
    for (const s of [-1, 1]) {
      addBox(x + s * 1.0, 1.5, z - 0.44, 0.13, 0.52, 0.52, 0x14181d, {});
      addBox(x + s * 0.86, 1.5, z - 0.44, 0.12, 0.44, 0.44, 0x14181d, { cast: false });
    }
    // THE THREE LOOSE THINGS IN THE WEIGHT PILE. The rack is bolted through
    // the mat and stays; the bench, the plate tree and the chalk bucket are
    // free-standing kit and every one of them prices its own shove. This is
    // where the differential is easiest to feel: the bucket skitters off your
    // shin, the bench takes a shoulder, and a loaded plate tree barely gives.
    const wBench = addBox(x, 0.46, z + 0.55, 0.62, 0.16, 1.9, 0x222831, { solid: true });
    const wFeet = [];
    for (const s of [-1, 1]) wFeet.push(addBox(x, 0.23, z + 0.55 + s * 0.7, 0.44, 0.46, 0.4, C_STEEL, { cast: false }));
    if (CBZ.pushProp) CBZ.pushProp({
      parts: [wBench].concat(wFeet), x: x, z: z + 0.55, hx: 0.31, hz: 0.95, y1: 0.54,
      mass: 45, kind: "bench", leash: 4.0, stand: true,
    });
    // plate tree — four 20 kg plates on a steel post: it moves, grudgingly
    const tree = [addBox(x + 2.0, 0.55, z + 0.4, 0.5, 1.1, 0.5, C_STEEL_D, { solid: true })];
    for (let i = 0; i < 4; i++)
      tree.push(addBox(x + 2.0, 0.42 + (i % 2) * 0.44, z + 0.4 + (i < 2 ? -0.3 : 0.3), 0.5, 0.5, 0.13, 0x14181d, { cast: false }));
    if (CBZ.pushProp) CBZ.pushProp({
      parts: tree, x: x + 2.0, z: z + 0.4, hx: 0.25, hz: 0.28, y1: 1.10,
      mass: 110, kind: "platetree", leash: 2.5,
    });
    // chalk bucket — 4 kg, and it is the lightest thing in the compound
    const bucket = addBox(x - 1.9, 0.18, z + 1.0, 0.36, 0.36, 0.36, 0xd8d2c4, { cast: false });
    if (CBZ.pushProp) CBZ.pushProp({
      parts: [bucket], x: x - 1.9, z: z + 1.0, hx: 0.18, hz: 0.18, y1: 0.36,
      mass: 4, kind: "bucket", solid: true, leash: 6.0,
    });
  })(8, 28);

  /* ==========================================================
     3. THE PAVILION. A shade shelter with one solid back wall — the only
        square of the yard the towers cannot see into, which is exactly why
        the tables are under it and why it is worth walking to.
     ========================================================== */
  (function pavilion(x, z) {
    const W = 6.4, D = 5.0, HH = 2.7;
    // the back wall (north side): the LOS blocker
    blocker(x, 1.2, z - D / 2, W, 2.4, 0.34, C_CONC);
    // posts
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      if (sz < 0) continue;                                  // the back wall carries that side
      addBox(x + sx * (W / 2 - 0.2), HH / 2, z + sz * (D / 2 - 0.2), 0.24, HH, 0.24, C_STEEL_D, { solid: true });
    }
    // the roof. Non-solid + blockLOS, the same contract world/roofs.js uses:
    // a tower cannot see through it, and no body is ever walled out by it.
    addBox(x, HH + 0.12, z, W, 0.24, D, 0x59616b, { solid: false, cast: false, blockLOS: true });
    addBox(x, HH + 0.3, z, W + 0.3, 0.12, D + 0.3, 0x4a525c, { cast: false });
    for (let i = -1; i <= 1; i++) addBox(x + i * 2.0, HH - 0.06, z, 0.14, 0.16, D, C_STEEL_D, { cast: false });
    // the slab and its two bolted tables — the shared kit's, with real seats
    addBox(x, 0.025, z, W + 0.8, 0.05, D + 0.8, 0x8f8a80, { cast: false });
    if (PD && typeof PD.roundTable === "function") {
      PD.roundTable(x - 1.5, z + 0.5, { tone: 0xb9b3a4, seatTone: 0x54606d });
      PD.roundTable(x + 1.5, z + 0.5, { tone: 0xb9b3a4, seatTone: 0x54606d, spin: 0.35 });
    }
  })(-12, 36);

  /* ==========================================================
     4. THE PHONE BANK. On the armoury approach, where the crate that
        carried the hacksaw used to be. A man on the phone is a man standing
        still with his back to the yard — the one legitimate reason to be
        stationary within sight of the gun-room door.
     ========================================================== */
  (function phones(x, z) {
    blocker(x, 1.2, z, 3.6, 2.4, 0.36, C_CONC);
    addBox(x, 2.48, z, 3.9, 0.2, 0.62, C_CONC_D, { cast: false });                 // hood
    addBox(x, 0.08, z + 0.4, 4.0, 0.16, 1.2, 0x8f8a80, { cast: false });           // kerb
    for (let i = -1; i <= 1; i++) {
      const px = x + i * 1.15;
      addBox(px, 1.42, z + 0.28, 0.44, 0.62, 0.22, 0x2b3038, { cast: false });      // body
      addBox(px, 1.72, z + 0.30, 0.34, 0.16, 0.2, 0x1a1d22, { cast: false });       // handset cradle
      addBox(px - 0.26, 1.32, z + 0.34, 0.06, 0.3, 0.1, 0x1a1d22, { cast: false }); // handset
      addBox(px, 0.92, z + 0.30, 0.2, 0.28, 0.16, 0x9aa0a8, { cast: false });       // coin box
      addBox(px, 2.05, z + 0.2, 0.7, 0.5, 0.1, C_STEEL_D, { cast: false });         // acoustic wing
    }
  })(11, 17);

  /* ==========================================================
     5. THE BOARD AND THE TABLES, either side of the central lane.
        world/clutter.js keeps x[-3,3] clear from the wing door to the gate
        and it is right to: that lane is the yard's spine. So the cover goes
        BESIDE it — which is also better cover, because a lane with a blocker
        on each side is a lane you can cross unseen.
     ========================================================== */
  (function board(x, z) {
    for (const s of [-1, 1]) addBox(x + s * 1.35, 1.15, z, 0.16, 2.3, 0.16, C_STEEL_D, { solid: true });
    blocker(x, 1.85, z, 3.0, 1.5, 0.14, 0x16202a, { cast: false });
    // the sheets pinned to it: the count times, the rules, the visiting list.
    // The prison's timetable, as an object rather than a caption.
    for (let i = 0; i < 6; i++)
      addBox(x - 1.05 + (i % 3) * 1.05, 2.16 - ((i / 3) | 0) * 0.56, z - 0.08, 0.72, 0.44, 0.02,
        i % 2 ? 0xe8e2d2 : 0xd2cdbe, { cast: false });
    addBox(x, 2.68, z, 3.2, 0.16, 0.4, C_STEEL_D, { cast: false });                 // rain hood
  })(3.6, 11);
  if (PD && typeof PD.roundTable === "function") {
    addBox(-4.0, 0.025, 11, 5.0, 0.05, 4.4, 0x8f8a80, { cast: false });
    PD.roundTable(-3.0, 10.0, { tone: 0xb9b3a4, seatTone: 0x54606d });
    PD.roundTable(-5.0, 12.4, { tone: 0xb9b3a4, seatTone: 0x54606d, spin: 0.35 });
  }

  /* ==========================================================
     6. THE TOOLS. Same deferral world/crates.js used: systems/prisondrops.js
        registers its prop TYPE on the first tick, so a parse-time placement
        would silently do nothing. `world:true` inside prisonPlaceItem means
        a blade on a workbench survives a restart, which is what makes the
        route learnable.
     ========================================================== */
  const TOOLS = [
    // on the workshop bench, beside the vise and the stripped pistol
    { item: "Hacksaw Blade", x: -36.35, y: 0.95, z: 76.3 },
    // in a laundry cart, in the room with the loudest machines in the prison
    { item: "Lockpick", x: -31.0, y: 1.22, z: 92.0 },
  ];
  let laid = 0;
  CBZ.onUpdate(41.85, function () {
    if (laid || !CBZ.prisonPlaceItem) return;
    if (!CBZ.game || CBZ.game.mode !== "escape") return;
    for (let i = 0; i < TOOLS.length; i++) {
      const t = TOOLS[i];
      try { if (CBZ.prisonPlaceItem(t.item, t.x, t.y, t.z)) laid++; } catch (e) {}
    }
    if (!laid) laid = -1;                       // do not retry forever
  });

  /* ==========================================================
     7. THE RATCHET. `cover` is the owner's stealth layer stated as a number.
        The five crates were five LOS blockers in the north yard; a "fix"
        that de-props the yard by DELETING the cover would break the stealth
        game the yard exists for, so this may never read below 5.
     ========================================================== */
  CBZ.yardFurnitureAudit = function () {
    let placedTools = 0;
    const pl = (CBZ.prisonPlacedAudit && CBZ.prisonPlacedAudit()) || null;
    if (pl) placedTools = pl.standing;
    return {
      on: true,
      cover: cover,                       // >= 5: the crates' own count
      installations: 5,
      tools: TOOLS.length, toolsPlaced: laid > 0 ? laid : 0,
      placedStanding: placedTools,
      containers: 0,                      // MUST be 0 — nothing here opens
    };
  };
})();
