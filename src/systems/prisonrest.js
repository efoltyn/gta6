/* ============================================================
   systems/prisonrest.js — BODIES USE THE FURNITURE.

   OWNER, 2026-08-11: the inmates in the cells "don't sit or lie on beds —
   they stand overlapping them."

   The visible fault had three owners: the early-built bunks were losing their
   registration to load order; nobody called the shared lie-down verb; and the
   42-person cast was being "housed" by sixteen permanent floor mats spread
   through a dayroom. The first two remain fixed at their canonical seams. The
   third is now architecture: world/southblock.js adds a controlled 16-bed dorm
   using cellblock.js's exact bunk builder, so this system assigns real racks
   in two housing units and never manufactures bedding in circulation.

   ...AND A FOURTH, FOUND BY THE RATCHET ITSELF. `CBZ.propWake` clears a pose
      and never moves a body, which is right while its rise ARC is walking the
      man off the mattress and wrong the instant that arc is skipped — i.e. on
      a RESET, when the whole wing gets up on one frame. Measured: a security
      transfer taken at lights-out put 25 men on their feet INSIDE the beds
      they had been asleep in, which is the owner's original sentence restored
      by a restart. `CBZ.rest.up()` steps the body clear on EVERY wake rather
      than only on that one, and `CBZ.rest.sweep()` catches the bodies that
      were never assigned the bed they are standing in.

   WHAT DRIVES IT: `CBZ.prisonSchedule`, and never a second clock.

       wake              everybody up and out of the bedding
       yard / work       the yard tables and benches get sat at
       mess / supper     the chow hall benches get sat at
       count             the muster owns them; this file keeps its hands off
       secure            drift to your own bunk
       night             LIGHTS OUT — everybody horizontal

   WHAT IS NOT HERE. The verbs — claim a place, send a body to it, hand
   it to the pose, hold it, get it up, step it clear — and the three load-order
   repairs that make any of it reach a registry at all are systems/rest.js's
   now, because a ward, a barracks and a dormitory need every one of them and
   none of them is about a prison. What stays is assignment across the venue's
   authored housing and the schedule block that means bed, bench or hands-off.

   HOW IT HOLDS A BODY. A prison NPC is entities/npc.js's actor, not a
   city/peds.js ped: it has `group`/`target`/`pause` and no `pos`, no `path`,
   no `finalGoal`, and nothing re-pins a seated one each frame. So this file
   never calls the peds-shaped verbs (`propGoSit`, `propSeatNpc`, `propBedNpc`
   all read `ped.pos`); it walks the body with the mover the wing already uses
   — write `target`, clear `pause` — and hands over to `CBZ.propSleep` /
   `CBZ.propSit` only at arm's length, where propuse's own arc and its
   order-42 hold take the transform. cellblock.js's leash yields to that hold
   rather than fighting it for the same Vector3.

   ONE SHARED-BEHAVIOUR HAZARD, HANDLED HERE: `propSleep`/`propSit`/`guide`
   all write `actor.speed = 0`. For a city ped that is the CURRENT speed,
   recomputed next frame. For a prison NPC `speed` is the constant walk rate
   it was spawned with (npc.js:35), so letting propuse zero it leaves an
   inmate frozen at 0 m/s for the rest of the run. Every hand-off below saves
   the rate and restores it on wake.

   SHOW, DON'T TELL: this file prints nothing and adds no prompt. There is no
   snore, either — `systems/audio.js` has no such cue, and inventing one
   without a measured SPL is exactly the fake-prop fault scrolls/claude/sound.md
   exists to stop. The night is quiet because the men are asleep.

   ...AND A FIFTH, WHICH WAS THE MEASURING INSTRUMENT ITSELF (2026-08-15).
      OWNER: "Scale the number of cells so every single NPC has a bed."
      `sleepGap` answered 0 — every single NPC already had one — and it was
      wrong by eight men, because it asked `role === "inmate"` and `role` in
      this game is a TRADE. The prison's dealer, its two merchants and its
      five crew runners are convicts out of the same factory in the same
      orange (entities/npc.js:26 stamps `kind: "inmate"` on all fifty), and
      not one of them was in the count. §2's predicate now asks the factory,
      the gap read +8 the moment it did, and world/cellblock.js answered it
      with eleven more cells: 42 -> 66 beds against 50 -> 62 men, sleepGap -4
      at the night block. A ratchet that cannot see the fault is not a
      ratchet, and the men it could not see were the ones sleeping standing up.

   Flags PRISON_REST_V1 · PRISON_REST_WARDEN.
   Ratchet CBZ.prisonRestAudit().bunkStanders — bodies standing inside a
   mattress, which is the owner's complaint stated as a number — pinned at 0.
   Ratchet CBZ.prisonRestAudit().sleepGap — prisoner rigs minus registered
   mattresses, which is the 2026-08-15 ask stated as a number — pinned <= 0,
   held by tools/prison-beds-check.mjs at the night block and not at spawn.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  // systems/rest.js owns the VERBS (claim a place, send a body, hand it to the
  // pose, get it up, step it clear) and the load-order repairs that make any
  // of it reach a registry at all. This file owns which authored housing place
  // belongs to which inmate, and which schedule block means bed or bench.
  if (!CBZ || typeof CBZ.onUpdate !== "function" || !CBZ.rest) return;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.PRISON_REST_V1 == null) CFG.PRISON_REST_V1 = true;
  if (CFG.PRISON_REST_WARDEN == null) CFG.PRISON_REST_WARDEN = true;

  function on() { return CFG.PRISON_REST_V1 !== false && CBZ.game && CBZ.game.mode === "escape"; }
  function sched() { return CBZ.prisonSchedule || null; }

  const beds = [];          // every authored rack: cell house, then south dorm
  const messSeats = [];     // chow-hall benches
  const yardSeats = [];     // yard tables + benches
  let built = false, wardenBed = null;

  /* ==========================================================
     1. HOUSING INVENTORY.

        Beds are built only by world geometry. The cell house publishes its
        cell records; the south dorm publishes stack records carrying their
        unit and entrance route. A positive `sleepGap` is therefore an honest
        capacity failure to fix with architecture — never permission for this
        behaviour layer to draw another object into a common room.
     ========================================================== */
  function isFloorBed() { return false; }
  let matsRefused = 0;                    // retained in the audit schema: always zero

  /* ==========================================================
     2. THE INVENTORY. Bunks come from the wing's own cell records (the
        SAME record `CBZ.propRegisterBed` handed back, so nothing here can
        drift off the mesh); seats come from propuse's rect query, once,
        by room — never a per-frame scan of the city's 3,375 chairs.
     ========================================================== */
  /* EVERY BODY THIS FILE IS RESPONSIBLE FOR FINDING A PLACE FOR — and it used
     to be `a.role === "inmate"`, which is how a capacity ratchet reported 0
     while eight men had no bed.

     MEASURED 2026-08-15, live escape run: 50 prisoner rigs in CBZ.npcs —
     `inmate` x42, `thief` x5, `merchant` x2, `dealer` x1 — against 42
     mattresses. `sleepGap` read 42 - 42 = 0 and the wing looked solved,
     because `role` in this game is a TRADE (npc.js:315/329/345/380: the
     infirmary's med seller, the yard's dealer, the crew's runners) and not a
     statement about whether the man is doing time. Every one of those bodies
     comes out of the same factory, wearing the same orange, and
     entities/npc.js:26 stamps `kind: "inmate"` on all of them at birth.
     A bed is owed to a man, not to his trade.

     So the question is asked of the FACTORY, and the old `role` test is kept
     as an OR purely so nothing that was counted before can fall out (npclife's
     `jailInmate` sets both; entities/crowd.js sets both AND `_crowd`, which is
     what still excludes the anonymous city tier). `kind` is the tight half:
     modes/gungame.js:293 pushes its bots into this same CBZ.npcs and none of
     them carries it. The number went 0 -> +8 the moment this line changed,
     which is the whole reason world/cellblock.js then grew eleven cells. */
  function inmateOf(a) { return a && !a._crowd && a.group && (a.kind === "inmate" || a.role === "inmate"); }
  function population() {
    const list = CBZ.npcs || [];
    let n = 0;
    for (let i = 0; i < list.length; i++) { const a = list[i]; if (inmateOf(a) && !a.dead && !a.escaped) n++; }
    return n;
  }

  function build() {
    built = true;
    /* THE PRISON'S FURNITURE ANCHORS ARE WIPED BY THE CITY, AND NOBODY EVER
       PUT THEM BACK. world/roombuild.js queues every roomSeatAnchor/
       roomBedAnchor and flushes once, on `load`. But city/propuse.js's
       `propPurposeReset()` clears the whole registry whenever the city
       (re)builds — which happens after that flush — and the flush is wired to
       an event that has already fired. Measured in a live escape run: the chow
       hall reported 0 seats and the yard 0, and one re-flush restored 75
       anchors. It is idempotent by construction (propuse dedupes on a
       decimetre coordinate key), so calling it here costs nothing when the
       anchors are already live. */
    CBZ.rest.ready();
    const cb = CBZ.cellblock;
    if (cb && cb.cells) for (let i = 0; i < cb.cells.length; i++) {
      const c = cb.cells[i];
      // THE LOWER RACK IS THE CELL OWNER'S — that is what owning a cell means,
      // and `_cell` is how §4 reserves it for him. The TOP rack is a cellmate's
      // and belongs to nobody in particular, so it is left unmarked and the
      // nearest man without a place takes it.
      if (c.bed) { c.bed._cell = c; beds.push(c.bed); }
      if (c.bedTop) beds.push(c.bedTop);
    }
    const housing = CBZ.prisonHousing;
    if (housing && housing.beds) for (let i = 0; i < housing.beds.length; i++) {
      const stack = housing.beds[i];
      if (!stack) continue;
      if (stack.bed) beds.push(stack.bed);
      if (stack.bedTop) beds.push(stack.bedTop);
    }
    CBZ.rest.seatsIn(-28.8, -19.2, 6.2, 21.8, 0, messSeats);         // chow hall
    CBZ.rest.seatsIn(-30, 30, -8, 52, 0, yardSeats);                 // the north yard
    if (CFG.PRISON_REST_WARDEN) {
      // world/adminwing.js furnishes the warden's quarters through the shared
      // kit, which registers its own bed anchor; find it rather than typing a
      // coordinate that a re-furnish would silently invalidate.
      wardenBed = CBZ.rest.nearestBed(11.5, -59.5, 7.0, 0);
    }
  }

  /* ==========================================================
     3. HAND-OFFS. Each one saves the actor's WALK RATE across a propuse
        call that zeroes `speed` (see the header) and refuses any body whose
        brain outranks a bed — the same precedence entities/poses.js states
        and cellblock.js's leash already honours.
     ========================================================== */
  /* Every verb below is systems/rest.js's, and every one of them carries a
     lesson this file paid for:

       busy(a)          a real brain state outranks the furniture — and a live
                        TRANSITION ARC is deliberately NOT in that list, because
                        an arc is our own hand-off in progress and calling it
                        "busy" is how a first draft woke every man on the sweep
                        after it put him to bed.
       sleep/sit        walk to the piece's own solved entry point, then hand
                        over at arm's length — and save the actor's WALK RATE
                        across a pose verb that zeroes `speed` (for a plain
                        actor that is the constant it was spawned with, so
                        letting it be zeroed freezes the body for the run).
       up(a, instant)   the only correct way to end a pose: rate back, pause
                        cleared, and the body STEPPED OFF the bedding.
       sweep/standers   one footprint, asked identically by the thing that
                        fixes the fault and the thing that measures it. */
  const busy = CBZ.rest.busy;
  const inTransition = CBZ.rest.inTransition;
  const keepRate = CBZ.rest.keepRate, giveRate = CBZ.rest.giveRate;
  function goTo(a, x, z) { return CBZ.rest.send(a, x, z); }
  function bedDown(a, bed) { return CBZ.rest.sleep(a, bed); }
  function sitAt(a, seat) { return CBZ.rest.sit(a, seat); }
  function getUp(a, instant) { return CBZ.rest.up(a, instant, { skip: isFloorBed }); }
  /* THE SWEEP THAT ANSWERS TO THE RATCHET, IN THE RATCHET'S OWN WORDS. Doing
     the step-off per body as it wakes took a reset's standers from 25 to 2,
     and 2 is not 0: a body can be left inside a mattress it was never assigned
     — one it merely walked into and was standing in when the world reset, or
     one belonging to the OTHER rack of a stack it did not sleep on. Rather
     than enumerate those cases, the sweep asks the identical question
     `bunkStanders` asks, and moves anyone it finds. When the invariant and the
     thing enforcing it are the same test, the ratchet cannot pass by luck. */
  function clearBunks() {
    CBZ.rest.sweep(beds, CBZ.npcs || [], { skip: isFloorBed, eligible: inmateOf });
  }

  /* ==========================================================
     4. WHO SLEEPS WHERE. A cell owner has HIS OWN bunk — that is what
        owning a cell means, and it is stable for the whole run so the same
        man is in the same bed every night. Everybody else takes the nearest
        free bed once and keeps it, so the wing does not reshuffle at 22:00
        every night like a game of musical chairs.
     ========================================================== */
  // a rack inside somebody else's cell is not on offer, however near it is
  function someoneElses(b, a) { return !!(b._cell && b._cell.owner && b._cell.owner !== a); }
  function assign(a) {
    const held = a._restBed;
    if (held && (!held.occupant || held.occupant === a)) return held;
    const cb = CBZ.cellblock;
    if (a._cellIdx != null && cb && cb.cells[a._cellIdx] && cb.cells[a._cellIdx].bed) {
      const own = cb.cells[a._cellIdx].bed;
      if (!own.occupant || own.occupant === a) { a._restBed = own; return own; }
    }
    return CBZ.rest.claim(a, beds, { key: "_restBed", reserved: someoneElses });
  }

  /* ---- THE PLACE IS PUBLIC, because the MUSTER needs it -------------------
     systems/prisonschedule.js walks every inmate indoors at secure/lights-out
     and used to park him on a hash of a floor grid — a patch of concrete that
     had nothing to do with where he sleeps, so a man was herded to one spot
     and then, seconds later, walked to a bed somewhere else. Two systems
     aiming one body at two places is how a body vibrates in a doorway.

     So the schedule asks THIS file where the man lives, and there is exactly
     one answer for the whole run. `place()` is deliberately allowed to assign
     on demand: the first caller wins the claim and every later caller — this
     file's own sweep included — gets the same record back. Beds are laid on
     the first tick, so a caller before that gets null and falls back to its
     own floor spot, which is the correct answer for "the wing isn't built". */
  CBZ.prisonRest = {
    place: function (a) {
      if (!on() || !inmateOf(a) || a.dead || a.escaped) return null;
      if (!built) return null;
      return assign(a) || null;
    },
    beds: beds,
    capacity: function () { return beds.length; },
    population: population,
  };

  /* ==========================================================
     5. THE SWEEP. 2 Hz, and it only ever touches bodies whose state it is
        allowed to touch. Bounded work per tick: at most MAX_ACT hand-offs,
        so a block change never lands a hundred arcs on one frame.
     ========================================================== */
  const MAX_ACT = 4;
  let acc = 0, lastBlock = "", lastElapsed = 0;
  let lying = 0, seated = 0;

  CBZ.onUpdate(24, function (dt) {
    if (!on()) return;
    const g = CBZ.game;
    const el = +g.elapsed || 0;
    if (el < lastElapsed - 0.5) {                 // a fresh run: let everybody go
      // INSTANT, not arced. A new run is not a morning — animating forty rise
      // arcs on the frame the world resets is how a body ends up half-unrolled
      // inside a bunk with nothing driving it. `getUp(a, true)` skips the arc,
      // which is also what makes its step-off fire (CBZ.rest.up).
      const list = CBZ.npcs || [];
      for (let i = 0; i < list.length; i++) { getUp(list[i], true); list[i]._restBed = null; }
      for (let i = 0; i < beds.length; i++) beds[i]._claim = null;
      if (built) clearBunks();
      lastBlock = "";
    }
    lastElapsed = el;

    acc += dt;
    if (acc < 0.5) return;
    acc = 0;
    if (!built) build();
    const S = sched();
    if (!S || !S.enabled()) return;
    const id = S.id();
    const bedTime = id === "night" || id === "secure";
    const messTime = id === "mess" || id === "supper";
    const sitTime = id === "yard" || id === "work";
    const changed = id !== lastBlock;
    lastBlock = id;

    const list = CBZ.npcs || [];
    let acted = 0;
    lying = 0; seated = 0;

    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!inmateOf(a)) continue;
      if (a._propLie) lying++;
      else if (a._propSeat) seated++;

      // ---- a transition owns the body; a brain state outranks the furniture
      if (inTransition(a)) continue;
      if (busy(a)) { if (a._propBed || a._propSeat) getUp(a); continue; }

      if (bedTime) {
        if (a._propSeat) { getUp(a); continue; }
        if (a._propLie || a._propBed) { a.pause = Math.max(a.pause || 0, 2.5); continue; }
        // ONLY BODIES ALREADY IN THEIR ASSIGNED HOUSING. Getting a man from the
        // yard to either unit is prisonschedule/npc routing's job; this layer
        // takes over at the housing boundary and never pulls through a wall.
        const p = a.group.position;
        if (S.inAssignedHousing && !S.inAssignedHousing(a, p.x, p.z, -0.4)) continue;
        if (acted >= MAX_ACT) continue;
        const bed = assign(a);
        if (bed && bedDown(a, bed)) acted++;
        else if (bed) {
          // still walking: keep him aimed at it, which is all the wing's own
          // mover needs. He will be offered the bed again next sweep.
          const p2 = CBZ.rest.approach(bed);
          goTo(a, p2.x, p2.z);
        }
        continue;
      }

      // ---- every other block: nobody stays in bed --------------------------
      if (a._propBed || a._propLie) {
        if (acted < MAX_ACT) { getUp(a); acted++; }
        continue;
      }
      if (id === "wake" || id === "count") { if (a._propSeat) getUp(a); continue; }

      if ((messTime || sitTime) && !a._propSeat && acted < MAX_ACT) {
        // A THIRD of the block sits down, not all of it: a room where every
        // single body is seated at once reads as a screenshot. The share is a
        // hash taken ONCE, off where this body first stood — a hash of the LIVE
        // position re-rolls every time he takes a step, which makes "is this a
        // man who sits" flicker instead of being a trait.
        if (a._restSitter == null) {
          const h = CBZ.hash01 ? CBZ.hash01(a.group.position.x, a.group.position.z, 771) : 0.5;
          a._restSitter = h < 0.34;
        }
        if (!a._restSitter) continue;
        // SIT WHERE HE ALREADY IS. Walking him to a chair would mean writing
        // `target` at a body whose own brain rewrites it every think-tick, and
        // two movers on one Vector3 is a man vibrating in the aisle. So a seat
        // is taken only when he has wandered within reach of one — which is how
        // anybody sits down anyway.
        const pool = messTime ? messSeats : yardSeats;
        const gp = a.group.position;
        let best = null, bd = 3.4 * 3.4;
        for (let k = 0; k < pool.length; k++) {
          const s = pool[k];
          if (s.occupant) continue;
          const d = (s.x - gp.x) * (s.x - gp.x) + (s.z - gp.z) * (s.z - gp.z);
          if (d < bd) { bd = d; best = s; }
        }
        if (best && sitAt(a, best)) acted++;
      } else if (a._propSeat) {
        // hold the seat: the wing's mover only leaves a body alone while it
        // is paused, and propuse's hold owns the pose but not the brain.
        a.pause = Math.max(a.pause || 0, 2.5);
      }
    }

    if (changed && !bedTime) {
      // a block that empties the beds also drops every stale claim
      CBZ.rest.dropClaims(beds);
    }

    /* THE RATCHET, ENFORCED EVERY SWEEP AND NOT ONLY ON A RESET (2026-08-15).
       `clearBunks()` lived in the fresh-run branch alone, so between restarts
       nothing held `bunkStanders` down except `up()`'s per-body step-off — and
       that only catches a man who was PUT in the bed. A man who merely walks
       through a mattress on his way somewhere is the other half of the fault
       and it was never swept. Measured on bfaccbd it read 2 during lock-up and
       0 in daylight, which looked pinned; growing the wing from 42 racks to 66
       and widening §2's predicate to all 50 rigs turned the same drift into 6
       and 1, because both terms of an area-times-traffic problem got bigger.
       The scan is 66 rectangles against ~70 bodies at 2 Hz and it is the
       IDENTICAL call the audit makes, so the number cannot pass by luck.

       NOT during a bed block: at secure/night the wing is converging on its
       own bunks and a man standing at his rack a beat before propuse's arc
       takes him is not a fault, he is arriving — stepping him off there would
       be this file fighting its own hand-off. NOT during `count` either: the
       muster owns the bodies then, which is the rule stated at the top of
       this file and worth more than a number. */
    if (!bedTime && id !== "count") clearBunks();

    wardenTick(id);
  });

  /* ==========================================================
     6. THE WARDEN SLEEPS IN HIS OWN BED. world/adminwing.js already sends
        him to his quarters for `secure` and `night` and furnishes them with
        a real bed; he then stood beside it all night. entities/guards.js
        gets one `asleep` early-return — the shape its own KO branch already
        has — and this file owns the decision and the WAKING: a body walking
        into the room wakes him, which is the only alarm a sleeping man
        needs and is worth more than any camera on that door.
     ========================================================== */
  const WAKE_R = 4.2;
  function warden() {
    const list = CBZ.guards || [];
    for (let i = 0; i < list.length; i++) if (list[i].kind === "warden") return list[i];
    return null;
  }
  function wardenTick(id) {
    if (!CFG.PRISON_REST_WARDEN || !wardenBed) return;
    const w = warden();
    if (!w || w.dead) return;
    const p = w.group.position;
    const night = (id === "night" || id === "secure");
    const hot = (w.hunt || 0) > 0 || (w.alert || 0) > 0.25 || w.approach || (w.ko | 0) > 0;
    const P = CBZ.player && CBZ.player.pos;
    const seen = P && (P.x - wardenBed.x) * (P.x - wardenBed.x) + (P.z - wardenBed.z) * (P.z - wardenBed.z) < WAKE_R * WAKE_R;

    if (w._propBed || w._propLie) {
      if (!night || hot || seen) { try { CBZ.propWake(w); } catch (e) {} w.asleep = false; giveRate(w); }
      return;
    }
    if (!night || hot || seen || wardenBed.occupant) return;
    const d = (p.x - wardenBed.x) * (p.x - wardenBed.x) + (p.z - wardenBed.z) * (p.z - wardenBed.z);
    if (d > 3.0 * 3.0) return;                       // still walking his round
    keepRate(w);
    let ok = false;
    try { ok = !!CBZ.propSleep(w, wardenBed); } catch (e) { ok = false; }
    if (ok) w.asleep = true; else giveRate(w);
  }

  /* ==========================================================
     7. THE RATCHET. `bunkStanders` IS the owner's sentence as a number: a
        body whose feet are inside a mattress rectangle while it is not lying
        on it. Zero is the only correct value and there is no legitimate way
        to raise it — a man beside his bunk is beside it, a man in it is in it.
        `lying`/`seated` are live gauges, not invariants: they should be near
        the wing's population at 02:00 and zero at noon, and they exist so a
        probe can prove the pose is reachable at all.
     ========================================================== */
  // …and the same question, registered with the shared layer, so CBZ.restAudit()
  // answers for every game at once without knowing what any of them is.
  CBZ.restWatch("prison", function () { return beds; }, function () { return CBZ.npcs || []; },
    { skip: isFloorBed, eligible: inmateOf });

  CBZ.prisonRestAudit = function () {
    let standers = 0, housedIn = 0, inBed = 0, sat = 0, matBeds = 0, bunkBeds = 0, taken = 0;
    for (let i = 0; i < beds.length; i++) {
      if (beds[i].kind === "mat") matBeds++; else bunkBeds++;
      if (beds[i].occupant) taken++;
    }
    const list = CBZ.npcs || [];
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!inmateOf(a) || a.dead) continue;
      housedIn++;
      if (a._propLie) inBed++;
      if (a._propSeat) sat++;
    }
    // the identical question the sweep above asks, asked by the shared layer
    standers = CBZ.rest.standers(beds, list, { skip: isFloorBed, eligible: inmateOf });
    const S = sched();
    const w = warden();
    const claim = (CBZ.prisonBeds && CBZ.prisonBeds().beds) | 0;
    return {
      on: on(), block: S && S.enabled() ? S.id() : null,
      beds: beds.length, bunks: bunkBeds, mats: matBeds, claimed: taken,
      matsRefused: matsRefused,
      // EVERY MAN HAS A PLACE. Not "the wing sleeps what it claims" — that is
      // world/cellblock.js's job now and it counts its own mattresses — but the
      // thing the muster depends on: a body ordered to bed has a bed to be
      // ordered to. Positive = men with nowhere to lie down. `housedIn` is
      // every prisoner rig (§2), not every rig whose trade is "inmate": the
      // narrow reading is what let this sit at 0 with eight men on their feet.
      sleepGap: built ? housedIn - beds.length : null,
      racks: claim, capacity: beds.length,
      inmates: housedIn, lying: inBed, seated: sat,
      bunkStanders: standers,
      messSeats: messSeats.length, yardSeats: yardSeats.length,
      wardenBed: !!wardenBed, wardenAsleep: !!(w && w.asleep),
      fittings: CBZ._prisonProps || null,
    };
  };
})();
