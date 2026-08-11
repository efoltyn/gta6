/* ============================================================
   systems/prisonrest.js — BODIES USE THE FURNITURE.

   OWNER, 2026-08-11: the inmates in the cells "don't sit or lie on beds —
   they stand overlapping them."

   He is describing three separate faults that all look like one:

   1. THE BUNKS WERE NEVER BEDS. world/cellblock.js has registered every bunk
      as a propuse bed since the day it was written — `useBed()` at :237, one
      call per cell, counted on `CBZ._prisonProps`. Measured in a live escape
      run, that counter read {props:21, seats:0, beds:0, plain:21}: NOT ONE of
      them had ever registered, because `city/propuse.js` is index.html:817 and
      cellblock.js is :480, so `CBZ.propRegisterBed` does not exist yet when the
      wing is built and every call took the silent degrade branch. The prison's
      entire "props with purpose" layer was documentation. Fixed at the source
      (cellblock.js now queues its fittings and drains them on its own first
      tick); the counter reads {props:25, seats:12, beds:13, plain:0}.

   2. NOTHING EVER ASKED ANYBODY TO LIE DOWN. Even with the anchors live, the
      only consumer was cellblock.js's cell leash, which hard-snapped a
      `_cellPose === "bunk"` inmate to `bunkSpot(c)` — the near long EDGE of
      the mattress — and gave him `setCharPose(char,"sit")`. A seated body
      perched on the rail of a bed it is standing beside. `CBZ.propSleep`, the
      real lie-down (city/propuse.js:1258, with the sleep pose, the breathing,
      the per-body back/side style and the mattress-clearance solve), had no
      caller anywhere outside src/city/.

   3. THERE WERE NOT ENOUGH BEDS TO LIE IN. Thirteen cells against ~32 live
      inmates. That is the prison's own published arithmetic — CBZ.prisonBeds()
      puts this wing at 185% of design capacity, deliberately, citing Brown v.
      Plata — and the answer a real overcrowded prison gives is the one in the
      photographs from that case: ISSUE MATS ON THE FLOOR OF THE WING. So the
      overflow gets mats, the mats are registered beds like any other, and at
      two in the morning the block is rows of horizontal men instead of a
      standing crowd in the dark.

   WHAT DRIVES IT: `CBZ.prisonSchedule`, and never a second clock.

       wake              everybody up and out of the bedding
       yard / work       the yard tables and benches get sat at
       mess / supper     the chow hall benches get sat at
       count             the muster owns them; this file keeps its hands off
       secure            drift to your own bunk
       night             LIGHTS OUT — everybody horizontal

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
   without a measured SPL is exactly the fake-prop fault docs/claude/sound.md
   exists to stop. The night is quiet because the men are asleep.

   Flags PRISON_REST_V1 · PRISON_REST_MATS · PRISON_REST_WARDEN.
   Ratchet CBZ.prisonRestAudit().bunkStanders — bodies standing inside a
   mattress, which is the owner's complaint stated as a number — pinned at 0.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || typeof CBZ.onUpdate !== "function") return;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.PRISON_REST_V1 == null) CFG.PRISON_REST_V1 = true;
  if (CFG.PRISON_REST_MATS == null) CFG.PRISON_REST_MATS = true;
  if (CFG.PRISON_REST_WARDEN == null) CFG.PRISON_REST_WARDEN = true;

  function on() { return CFG.PRISON_REST_V1 !== false && CBZ.game && CBZ.game.mode === "escape"; }
  function sched() { return CBZ.prisonSchedule || null; }

  const beds = [];          // every bed record in the wing: bunks, then mats
  const messSeats = [];     // chow-hall benches
  const yardSeats = [];     // yard tables + benches
  let built = false, wardenBed = null;

  /* ==========================================================
     1. THE MATS, AND THE COUNT IS DERIVED, NOT TYPED.

        `CBZ.prisonBeds()` (world/cellblock.js) is the number every population
        constant in this game is a subtraction against: THE BUILDING SLEEPS 26,
        thirteen cells at two bunks each. Measured, the wing draws four DOUBLE
        bunks (the north row) and nine SINGLES — `bunkRig(..., dbl = north)` —
        so thirteen of the twenty-six places the prison has always claimed do
        not physically exist, and thirteen men had nowhere to lie down. That is
        not a reason to shrink the claim: this compound is deliberately run at
        185% of design capacity, citing Brown v. Plata, and what a real prison
        at that number does is exactly what the photographs from that case
        show — ISSUE MATS ON THE FLOOR.

        So the mat count is `prisonBeds().beds − bunks`. It cannot drift: draw
        a second bunk in the side cells and the mats disappear on their own;
        add a cell and they reappear. `CBZ.prisonRestAudit().sleepGap` is that
        subtraction, pinned at 0 — the wing physically sleeps what it says it
        sleeps.

        Placement is the two lanes the muster already uses: clear of the
        x[-3,3] patrol spine, of the day tables at (±6.6,−26) and of
        world/escape_routes.js's two wing hatches. Thin, drab, NON-SOLID and
        shadowless — a mat is not an obstacle, it is a place — and they stay
        down in daylight, because that is what an overcrowded wing looks like
        at every hour and not only at lights out.
     ========================================================== */
  const MAT_LEN = 1.95, MAT_W = 0.72, MAT_TOP = 0.075;
  const MAT_X = [-7.9, -4.6, 4.6, 7.9];
  const MAT_Z = [-13.0, -16.2, -19.4, -22.6, -30.0, -33.2];   // −26 is the day tables
  function buildMats(want) {
    if (!CFG.PRISON_REST_MATS || !CBZ.addBox || want <= 0) return;
    const reg = CBZ.propRegisterBed || CBZ.roomBedAnchor;
    if (!reg) return;
    let i = 0;
    for (let r = 0; r < MAT_Z.length && i < want; r++) {
      for (let c = 0; c < MAT_X.length && i < want; c++) {
        const x = MAT_X[c], z = MAT_Z[r];
        const tone = [0x3d4753, 0x44505c, 0x39434e][i % 3];
        CBZ.addBox(x, MAT_TOP / 2, z, MAT_W, MAT_TOP, MAT_LEN, tone, { cast: false });
        // the rolled blanket at the head end — the one detail that stops it
        // reading as a painted rectangle on the floor
        CBZ.addBox(x, 0.135, z - MAT_LEN / 2 + 0.22, MAT_W - 0.08, 0.19, 0.34,
          [0x6b7280, 0x5d6470, 0x767d8a][i % 3], { cast: false });
        let rec = null;
        try { rec = reg(x, 0, z, 0, -1, MAT_LEN, MAT_TOP, "mat", null); } catch (e) { rec = null; }
        if (rec) beds.push(rec);
        i++;
      }
    }
  }

  /* ==========================================================
     2. THE INVENTORY. Bunks come from the wing's own cell records (the
        SAME record `CBZ.propRegisterBed` handed back, so nothing here can
        drift off the mesh); seats come from propuse's rect query, once,
        by room — never a per-frame scan of the city's 3,375 chairs.
     ========================================================== */
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
    if (CBZ.roomAnchorsFlush) { try { CBZ.roomAnchorsFlush(); } catch (e) {} }
    const cb = CBZ.cellblock;
    if (cb && cb.cells) for (let i = 0; i < cb.cells.length; i++) {
      const c = cb.cells[i];
      if (c.bed) { c.bed._cell = c; beds.push(c.bed); }
    }
    const claim = (CBZ.prisonBeds && CBZ.prisonBeds().beds) | 0;
    buildMats(claim - beds.length);
    if (CBZ.propSeatsIn) {
      try {
        CBZ.propSeatsIn(-28.8, -19.2, 6.2, 21.8, 0, messSeats);        // chow hall
        CBZ.propSeatsIn(-30, 30, -8, 52, 0, yardSeats);                // the north yard
      } catch (e) {}
    }
    if (CFG.PRISON_REST_WARDEN && CBZ.propNearestBed) {
      // world/adminwing.js furnishes the warden's quarters through the shared
      // kit, which registers its own bed anchor; find it rather than typing a
      // coordinate that a re-furnish would silently invalidate.
      try { wardenBed = CBZ.propNearestBed(11.5, -59.5, 7.0, 0) || null; } catch (e) { wardenBed = null; }
    }
  }

  /* ==========================================================
     3. HAND-OFFS. Each one saves the actor's WALK RATE across a propuse
        call that zeroes `speed` (see the header) and refuses any body whose
        brain outranks a bed — the same precedence entities/poses.js states
        and cellblock.js's leash already honours.
     ========================================================== */
  // A REAL BRAIN STATE OUTRANKS THE FURNITURE (entities/poses.js's precedence,
  // and cellblock.js's leash honours the same list). NOTE what is deliberately
  // NOT in here: `propArcActive`. A live arc is this file's OWN hand-off in
  // progress, and treating it as "busy" is how the first draft woke every man
  // on the sweep after it put him to bed — the settle beat had not finished, so
  // the next tick read the arc, called it a brain state and stood him back up.
  // An arc is checked separately, and the answer there is "leave him alone",
  // never "get him up".
  function busy(a) {
    return !a || a.dead || a.escaped || (a.ko | 0) > 0 || a._npcAttached || a.intimidMode
      || (a.huntPlayer || 0) > 0 || a.aiState === "fight" || a.aiState === "flee";
  }
  function inTransition(a) { return !!(CBZ.propArcActive && CBZ.propArcActive(a)); }
  function keepRate(a) { if (a._restRate == null && a.speed > 0) a._restRate = a.speed; }
  function giveRate(a) { if (a._restRate != null) { a.speed = a._restRate; a._restRate = null; } }

  function goTo(a, x, z) {
    if (!a.target) return false;
    a.target.set(x, 0, z);
    a.pause = 0;
    const g = a.group.position;
    return (g.x - x) * (g.x - x) + (g.z - z) * (g.z - z) < 2.6 * 2.6;
  }

  // walk him to it, then let propuse's own arc do the last two metres
  function bedDown(a, bed) {
    if (busy(a) || inTransition(a) || !bed || bed.occupant) return false;
    const e = (CBZ.propEntryPoint && CBZ.propEntryPoint(bed)) || null;
    const tx = (e && e.ok) ? e.x : bed.x, tz = (e && e.ok) ? e.z : bed.z;
    if (!goTo(a, tx, tz)) return false;
    keepRate(a);
    let ok = false;
    try { ok = !!CBZ.propSleep(a, bed); } catch (err) { ok = false; }
    if (!ok) giveRate(a);
    return ok;
  }
  function sitAt(a, seat) {
    if (busy(a) || inTransition(a) || !seat || seat.occupant) return false;
    const e = (CBZ.propEntryPoint && CBZ.propEntryPoint(seat)) || null;
    const tx = (e && e.ok) ? e.x : seat.x, tz = (e && e.ok) ? e.z : seat.z;
    if (!goTo(a, tx, tz)) return false;
    keepRate(a);
    let ok = false;
    try { ok = !!CBZ.propSit(a, seat); } catch (err) { ok = false; }
    if (!ok) giveRate(a);
    return ok;
  }
  function getUp(a) {
    if (!a || (!a._propBed && !a._propSeat && !a._propLie)) return false;
    try { if (a._propBed) CBZ.propWake(a); else CBZ.propStand(a); } catch (e) {}
    giveRate(a);
    a.pause = 0;
    return true;
  }

  /* ==========================================================
     4. WHO SLEEPS WHERE. A cell owner has HIS OWN bunk — that is what
        owning a cell means, and it is stable for the whole run so the same
        man is in the same bed every night. Everybody else takes the nearest
        free bed once and keeps it, so the wing does not reshuffle at 22:00
        every night like a game of musical chairs.
     ========================================================== */
  function inmateOf(a) { return a && !a._crowd && a.role === "inmate" && a.group; }
  function assign(a) {
    if (a._restBed && !a._restBed.occupant) return a._restBed;
    if (a._restBed && a._restBed.occupant === a) return a._restBed;
    const cb = CBZ.cellblock;
    if (a._cellIdx != null && cb && cb.cells[a._cellIdx] && cb.cells[a._cellIdx].bed) {
      const own = cb.cells[a._cellIdx].bed;
      if (!own.occupant || own.occupant === a) { a._restBed = own; return own; }
    }
    const g = a.group.position;
    let best = null, bd = Infinity;
    for (let i = 0; i < beds.length; i++) {
      const b = beds[i];
      if (b.occupant || b._claim) continue;
      if (b._cell && b._cell.owner && b._cell.owner !== a) continue;   // somebody's own cell
      const d = (b.x - g.x) * (b.x - g.x) + (b.z - g.z) * (b.z - g.z);
      if (d < bd) { bd = d; best = b; }
    }
    if (best) { best._claim = a; a._restBed = best; }
    return best;
  }

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
      const list = CBZ.npcs || [];
      for (let i = 0; i < list.length; i++) { getUp(list[i]); list[i]._restBed = null; }
      for (let i = 0; i < beds.length; i++) beds[i]._claim = null;
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
        // ONLY BODIES ALREADY IN THE WING. Getting a man from the far yard to
        // his bunk is somebody else's job and it is already done: npc.js's
        // curfew branch walks him through the x[-3,3] throat and
        // prisonschedule.js's herd() stops him dawdling. Writing `target` at
        // an inmate two hundred metres away would be a second mover pulling
        // the same body at a wall — so this file takes over only once he is
        // inside, and until then it does not touch him at all.
        const p = a.group.position;
        if (S.inBlock && !S.inBlock(p.x, p.z, -0.4)) continue;
        if (acted >= MAX_ACT) continue;
        const bed = assign(a);
        if (bed && bedDown(a, bed)) acted++;
        else if (bed) {
          // still walking: keep him aimed at it, which is all the wing's own
          // mover needs. He will be offered the bed again next sweep.
          const e = (CBZ.propEntryPoint && CBZ.propEntryPoint(bed)) || null;
          goTo(a, (e && e.ok) ? e.x : bed.x, (e && e.ok) ? e.z : bed.z);
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
      for (let i = 0; i < beds.length; i++) if (!beds[i].occupant) beds[i]._claim = null;
    }

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
  const MAT_HX = 0.52, MAT_HZ = 1.18;         // the mattress a body may not stand in
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
      if (a._propLie) continue;
      const g = a.group.position;
      for (let k = 0; k < beds.length; k++) {
        const b = beds[k];
        if (b.kind === "mat") continue;                 // you may stand on a floor mat
        if (Math.abs(g.x - b.x) < MAT_HX && Math.abs(g.z - b.z) < MAT_HZ) { standers++; break; }
      }
    }
    const S = sched();
    const w = warden();
    const claim = (CBZ.prisonBeds && CBZ.prisonBeds().beds) | 0;
    return {
      on: on(), block: S && S.enabled() ? S.id() : null,
      beds: beds.length, bunks: bunkBeds, mats: matBeds, claimed: taken,
      // the wing must physically sleep what CBZ.prisonBeds() says it sleeps
      sleepGap: built ? claim - beds.length : null, capacity: claim,
      inmates: housedIn, lying: inBed, seated: sat,
      bunkStanders: standers,
      messSeats: messSeats.length, yardSeats: yardSeats.length,
      wardenBed: !!wardenBed, wardenAsleep: !!(w && w.asleep),
      fittings: CBZ._prisonProps || null,
    };
  };
})();
