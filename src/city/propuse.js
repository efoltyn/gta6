/* ============================================================
   city/propuse.js — PROPS WITH PURPOSE: every chair/bench/couch is
   SITTABLE and every bed is SLEEPABLE (owner order: "no other props
   exist without purpose").

   The design is an ANCHORS-ONLY registry: furniture builders
   (buildings.js furniture sets, props.js patio/shelter/camps,
   city/furniture.js's shared kit) register a seat/bed ANCHOR (world
   position + facing yaw) as they place each piece. The mesh itself is
   never touched — it stays batch-folded (core/batch.js) and costs
   nothing; sitting is a pose + a position pin, not a mesh mutation.
   city/interact.js surfaces the verbs ("Sit down" / "Sleep til morning"
   / "Stand up") through the ONE interaction registry.

   ---- THE BODY --------------------------------------------------------
   How a body gets onto and off a piece of furniture is NOT this file's any
   more: entities/moves_posture.js (CBZ.moves.sit / lie / climb / stand) is
   the one posture sequencer for every game, and it also holds a seated or
   lying body on its spot. propSit / propStand / propSleep / propWake are the
   furniture side of those verbs: the claim, the occupancy, the NPC
   bookkeeping, the sleep payoff. See the block above CBZ.propArcActive.

   ---- SEAT GEOMETRY -----------------------------------------------------
   SEAT_H is the kit's SOURCE OF TRUTH for "how high is a seat of this kind",
   and it is meant to be READ, not copied: a builder that draws a cushion at
   propSeatHeight(kind) and then declares that same number can never drift out
   of agreement with the body it seats. island_airport.js's airliner cabin and
   gate lounge both do exactly that ("aircraft-seat", "waiting"); a builder that
   retypes a literal is one edit away from burying a body in its own furniture.

   entities/character.js has a real feet-on-the-floor chair solve gated on
   `ch.seatRef = {cushion, floorBelow}` — but until now ONLY the airliner
   passed that data, so every other chair in the game fell back to the
   legacy "squat on top of the cushion" fake. `propRegisterSeat` now takes
   an optional `geom = {cushion, floorBelow}` 7th argument, and any seat
   that declares one gets the real solve. Seats that don't keep the legacy
   pose byte-identically — deliberately: most legacy furniture is a single
   tall block whose TOP FACE is the seating surface, nothing like the
   real-world cushion height its `kind` implies, so inferring the number
   would bury bodies inside sofas (the full survey is in propSeatRef's
   comment). SEAT_H holds the real-world numbers for builders that DO draw
   real furniture — `CBZ.furnish` (city/furniture.js) declares on every
   piece, so the fix lands exactly as fast as callers move onto the shared
   kit, and `CBZ.propUseAudit().noGeom` counts what's left.

   NPC API (for the schedules / occupied-building / roles agents):
     CBZ.propBedNpc(ped, r)     — the BED half of propSeatNpc. "Put this NPC
                                  to bed at whatever is nearby." Exists because
                                  propSeatNpc's `prefer` substring only ever
                                  scans seats[], so the night sweep's
                                  propSeatNpc(a, 6.5, "bed") could never reach
                                  a real bed record — it matched a seat whose
                                  kind happened to contain "bed" ("bedside") or
                                  nothing at all.
     CBZ.propSeatNpc(ped, r, prefer) — THE ONE-LINER. "Seat this NPC at
                                  whatever is nearby, on its own floor."
                                  `prefer` is a kind substring tried first —
                                  pass "throne" for a gang boss so he takes
                                  the high-backed chair, not a guest seat.
     CBZ.propGoSit(ped, seat)   — route a ped to a specific seat: walks it
                                  there via peds.js's OWN finalGoal.sitDesk
                                  machinery (no new brain, no new loop) and
                                  reserves the seat for the walk.
     CBZ.propSeatsIn(x0,x1,z0,z1,y) — every seat in a rect on one floor.
     CBZ.propSit / propStand    — seat/release now (CBZ.moves sequence; claim is instant)
     CBZ.propSleep / propWake   — the bed pair
     CBZ.propLiePlace(actor,bed) — {x,y,z} for the rig's ORIGIN (its FEET) when
                                  this actor lies on this bed. Published by
                                  entities/moves_posture.js (CBZ.moves.liePlace),
                                  which is the only thing that places a sleeper.
     CBZ.propSeatRef(rec|kind)  — {cushion, floorBelow} → ch.seatRef, the one
                                  seam between "what seat is this" and the
                                  rig's chair solve. null for an undeclared
                                  seat (see its comment — this is deliberate).
     CBZ.propSeatHeight(kind)   — the kit's real-world cushion heights.
     CBZ.propRegisterSeat(...,geom) — geom.requireEntry refuses to register an
                                  anchor nothing can walk to, so a builder in an
                                  interior it doesn't own can only push
                                  propUseAudit().blocked DOWN, never up.
     CBZ.propEntryPoint(rec)    — the walkable standing spot for a piece.
     CBZ.propArcActive(actor)   — true while a transition owns the body.
                                  Neighbours: don't retarget or re-pose a
                                  body while this is true.
     CBZ.propUseAudit()         — the ratchet counter (see below)
   Seats are single-occupancy with stale-claim tolerance (a dead/recycled
   occupant frees the seat lazily — correctness never depends on a release
   call), and a walk-claim expires on its own if its owner never arrives.

   Revert: CBZ.CONFIG.PROPS_PURPOSE = false (nothing registers or claims).
           CBZ.CONFIG.PROPS_SEAT_GEOM = false (legacy squat pose everywhere,
             aircraft cabins included).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.PROPS_PURPOSE == null) CBZ.CONFIG.PROPS_PURPOSE = true;
  // PROPS_SEAT_GEOM — on → a seat whose builder DECLARED its cushion height
  // gets entities/character.js's real feet-on-the-floor chair solve. Flip false
  // (or ?cfg_PROPS_SEAT_GEOM=0) and NO seat gets it — every body in the game,
  // aircraft cabins included, falls back to the legacy squat pose. That is the
  // one-line revert for the whole seated-pose change.
  if (CBZ.CONFIG.PROPS_SEAT_GEOM == null) CBZ.CONFIG.PROPS_SEAT_GEOM = true;
  // wake-up time as a dayPhase fraction: sun y = sin(t·2π)·95, noon = 0.25,
  // so 0.08 ≈ climbing morning sun (~7:50am), clearly lit.
  if (CBZ.CONFIG.PROPS_MORNING_PHASE == null) CBZ.CONFIG.PROPS_MORNING_PHASE = 0.08;
  /* INTERIOR_SLEEP_STAKES — this file used to say it in one line, two lines
     below the verb: "No heal, no heat change". Sleeping in a bed that was not
     yours skipped the clock and did NOTHING else, which is one of the named
     reasons interiors read as scenery: a verb with no payoff and no cost is a
     button, not a decision.

     ON, a bed you don't own becomes a real trade. PAYOFF: rough sleep patches
     you back toward a CAP (a fraction of what the owned-safehouse reset gives
     — realestate.js's sleepHeal restores hp/stamina/hunger to full, dresses
     wounds AND bleeds heat; this gives you part of the first two and none of
     the rest, so a safehouse is still worth buying). COST: it is somebody's
     bedroom, and lying down in it is a break-in you slept through — charged
     through CBZ.cityCrime's ordinary WITNESS path, so an empty house at 3am
     costs nothing and a household that sees you is a trespass call.

     Your own bed is untouched by all of it: an owned lot keeps today's
     behaviour exactly, because the safehouse menu's full reset is the reward
     this is deliberately worse than. Flip false (or ?cfg_INTERIOR_SLEEP_STAKES=0)
     for the old no-heal / no-heat sleep. */
  if (CBZ.CONFIG.INTERIOR_SLEEP_STAKES == null) CBZ.CONFIG.INTERIOR_SLEEP_STAKES = true;

  function on() { return CBZ.CONFIG.PROPS_PURPOSE !== false; }
  function geomOn() { return CBZ.CONFIG.PROPS_SEAT_GEOM !== false; }

  const HALF = Math.PI / 2;

  // ---- SEAT GEOMETRY ---------------------------------------------------------
  // Cushion height in metres ABOVE the anchor's floor y, keyed on the seat KIND
  // every registration site already passes. This is the whole retrofit: the rig
  // solve exists, it was only ever starved of data.
  const SEAT_H = {
    chair: 0.45, seat: 0.45, dining: 0.46, table: 0.46, kitchen: 0.46,
    desk: 0.47, office: 0.47, work: 0.47, terminal: 0.47,
    patio: 0.45, park: 0.45, bench: 0.45, pew: 0.45, booth: 0.44, waiting: 0.44,
    // counter/bar heights from the standard furniture metric tables: a 0.65m
    // stool pairs with a 0.90m counter, a 0.75m stool with a 1.10m bar.
    // Counter/bar stools: the standard tables give 0.65 for a 0.90 counter and
    // 0.75 for a 1.10 bar. These are held at what CBZ.furnish actually DRAWS so
    // propSeatHeight() can't disagree with the kit it documents.
    stool: 0.68, counter: 0.68, bar: 0.75,
    sofa: 0.40, couch: 0.40, armchair: 0.42, lounge: 0.40,
    lounger: 0.34, recliner: 0.36,
    // outdoor seating sits lower than indoor seating — a folding deck chair
    // slings its canvas well below a dining chair's 0.45.
    deck: 0.38, deckchair: 0.38, patiochair: 0.42,
    throne: 0.50, boss: 0.50, exec: 0.48,
    cabin: 0.45, bedside: 0.55, cell: 0.42,
    // TRANSPORT seating. An economy airliner seat's cushion sits 0.43 above the
    // cabin floor (the published narrowbody figure that goes with a 0.79 m /
    // 31" pitch and a 0.44 m / 17.5" width); a flight-deck seat is a proper
    // adjustable chair and rides slightly higher. `waiting` above is the gate
    // lounge / departure bench. These are here so island_airport.js's cabin can
    // READ the number instead of retyping it — the seat is drawn at exactly the
    // height the rig is posed against, and one edit moves both.
    "aircraft-seat": 0.43, aircraft: 0.43, airline: 0.43, economy: 0.43,
    "cockpit-seat": 0.45, cockpit: 0.45, flightdeck: 0.45,
    gate: 0.44, lounge_gate: 0.44,
  };
  const SEAT_H_DEFAULT = 0.45;
  function cushionOf(kind) {
    const h = SEAT_H[String(kind || "chair").toLowerCase()];
    return h != null ? h : SEAT_H_DEFAULT;
  }
  CBZ.propSeatHeight = cushionOf;      // the kit's source of truth for a kind

  // The ONE way anything in the game turns a seat into the rig's chair-solve
  // input. One line, degrade-safe:  ch.seatRef = CBZ.propSeatRef(seatRec);
  //
  // THE MESH IS TRUTH, NOT THE KIND. An earlier draft of this inferred every
  // seat's cushion height from its `kind` so the whole world would get the V2
  // solve for free. A survey of the real geometry killed that: most legacy
  // furniture is a SINGLE TALL BLOCK whose top face IS the seating surface —
  // buildings.js draws "chairs" at 0.90 (:5304), bar stools at 0.90 (:5294),
  // waiting chairs at 0.62 (:3927), sofas at 0.70-0.83 (:3882, :5075, :5287) —
  // while the real-world numbers in SEAT_H are 0.45/0.75/0.44/0.40. Handing the
  // rig a 0.40 cushion for a block whose top is 0.83 would bury the body inside
  // the sofa. So: a seat gets the real solve ONLY when its builder DECLARED the
  // geometry it actually drew. Everything else keeps the legacy pose,
  // byte-identical. `CBZ.furnish` declares on every piece, so the fix arrives
  // exactly as fast as callers migrate onto the shared kit — and
  // CBZ.propUseAudit().noGeom counts what's left, which is the ratchet.
  //
  // A bare kind STRING is an explicit opt-in and does return the table value.
  //
  // ---- WHAT KIND OF SEAT IS THIS (added with CHAR_SEAT_POSTURE) ----------
  // The record has always known whether it was a sofa or a stool — every
  // registration site passes `kind`, and SEAT_H right above keys its cushion
  // heights on it. The rig never saw it, so a throne, a bar stool, a park
  // bench and an office chair all produced ONE identical upright pose. The
  // two ADDITIVE fields below close that gap:
  //   kind  — passed straight through; entities/character.js maps it to a
  //           posture family via CBZ.charSeatPosture (one table, over there,
  //           because that is where the pose lives). An unknown kind and a
  //           missing one both mean "sit up straight", i.e. today's pose.
  //   vary  — a stable 0..1 hashed off THIS ANCHOR's own coordinates, so five
  //           people on one long sofa lean five slightly different ways and
  //           the same chair always poses the same body the same way. Position
  //           hash, not a stream: order-independent and identical per seed on
  //           every client (the determinism law).
  // Backward-compatible by construction: every existing consumer reads only
  // cushion/floorBelow, and a consumer that never learns about kind gets
  // exactly the object it got before plus two fields it ignores.
  const SEAT_VARY_SALT = 0x5EA7;
  function varyOf(rec) {
    if (!CBZ.hash01) return 0.5;
    return CBZ.hash01(rec.x || 0, rec.z || 0, SEAT_VARY_SALT);
  }
  CBZ.propSeatRef = function (src) {
    if (!geomOn()) return null;
    if (src && typeof src === "object") {
      if (src.cushionH == null) return null;        // undeclared → legacy pose
      return {
        cushion: src.cushionH, floorBelow: src.floorBelow || 0,
        kind: src.kind || null, vary: varyOf(src),
      };
    }
    if (src == null) return null;
    return { cushion: cushionOf(src), floorBelow: 0, kind: String(src), vary: 0.5 };
  };

  // ---- registries -----------------------------------------------------------
  // Seat rec: { x,y,z, face, kind, lot, occupant, cushionH, floorBelow }
  //   (y = FLOOR level the sitter's FEET rest on; cushionH = cushion top above it)
  // Bed rec:  { x,y,z, face, hx,hz, len, top, lieY, kind, lot, occupant }
  //   (top = the mattress TOP surface, world y — the one number a lying body is
  //    placed off. lieY is the legacy `top + 0.3` KO-lie height and is now only
  //    the "this record is a BED" discriminator: WHERE A BODY ACTUALLY LIES IS
  //    CBZ.propLiePlace, which solves it from the sleeper's own rig.)
  // Poster rec: { mesh, x,y,z, entry }  (entry = props.js's dynAds record; its
  //   lastKey tells whether the board is CURRENTLY showing a wanted ad)
  const seats = CBZ.propSeats = CBZ.propSeats || [];
  const beds = CBZ.propBeds = CBZ.propBeds || [];
  const posters = CBZ.propWantedPosters = CBZ.propWantedPosters || [];

  // fresh-world reset — called at the top of CBZ.cityBuildings (the whole-city
  // build entry, world.js runs it before cityProps) so anchors rebuild in
  // lockstep with the furniture that owns them.
  const seatKeys = new Set(), bedKeys = new Set();
  CBZ.propPurposeReset = function () {
    seats.length = 0; beds.length = 0; posters.length = 0;
    seatKeys.clear(); bedKeys.clear();
    // END every live transition and hold (CBZ.moves hands the player's body
    // back), never just forget them: a forgotten one strands `_doorArc`.
    if (CBZ.moves && CBZ.moves.postureReset) CBZ.moves.postureReset();
    claimed.length = 0;
    if (CBZ.playerChar) CBZ.playerChar.lying = null;   // never carry a sleep pose into a new world
    if (CBZ.player) { CBZ.player._propSleepS = null; }
    // ACTOR-SIDE RESIDUE (the owner's "people laying down under planes"):
    // the registries above die with the old world, but the CLAIM lived on
    // the actor — `_propLie`/`_propBed`/`_propSeat` plus the `_deskAnchor`
    // THIS file wrote — and peds.js's sit branch re-pins from `_deskAnchor`
    // every frame. After a rebuild that held bodies at a mattress lieY
    // (~0.7) whose bed no longer exists, at coordinates the NEW world may
    // have parked an airliner over (measured: 3 stale-pinned sleepers inside
    // gate-airliner footprints, none within 40m of any live bed). Clear OUR
    // residue and hand the body back to locomotion; a desk anchor another
    // system owns (no propuse claim on the actor) is never touched.
    const residuePeds = CBZ.cityPeds;
    if (residuePeds) for (let i = 0; i < residuePeds.length; i++) {
      const p = residuePeds[i];
      if (!p || (!p._propLie && !p._propBed && !p._propSeat)) continue;
      p._propLie = false; p._propBed = null; p._propSeat = null; p._deskAnchor = null;
      // the SLEEP POSE is actor-side residue too: a rig left holding ch.lying
      // through a rebuild would walk the new world curled up.
      if (p.char) p.char.lying = null;
      if (!p.dead && !p._npcAttached && p.state === "sit") p.state = "walk";
    }
    // the furniture kit's own ledger rebuilds in lockstep. A direct feature-
    // detected CALL, not a wrapper: it works no matter which of the two files
    // parses first, so city/furniture.js is free to load early enough for the
    // parse-time world/* room builders to use it.
    if (CBZ.furnishReset) { try { CBZ.furnishReset(); } catch (e) {} }
  };

  // ---- registration (build-time, deterministic: piggybacks placement) -------
  // O(1) coordinate-keyed dedupe (a re-run furnisher must not double-register).
  function dedupe(keys, x, y, z) {
    const k = Math.round(x * 10) + "," + Math.round(y * 10) + "," + Math.round(z * 10);
    if (keys.has(k)) return true;
    keys.add(k);
    return false;
  }
  // face = yaw the seated body faces (ped convention: body looks along
  // (sin face, cos face) — same as peds' _deskAnchor.face).
  // geom (OPTIONAL, additive): {cushion, floorBelow} in metres — the cushion's
  // real top above this anchor's floor y. PASS IT whenever you know what you
  // drew: it is the only way the body gets the real chair solve. Absent is a
  // legitimate answer ("I don't know what my mesh looks like") and keeps the
  // legacy pose; CBZ.propUseAudit().noGeom counts those.
  //
  // geom.requireEntry (OPTIONAL): refuse to register at all when every approach
  // to this spot is blocked, instead of adding one more record to
  // propUseAudit().blocked. THE OTHER HALF OF THAT RATCHET: the audit counts
  // anchors nothing can walk to (487 of ~6000 at the last census) and until now
  // there was no way for a caller to stop MAKING them. A builder placing
  // furniture into an interior it does not control — a procedurally furnished
  // room, a concourse, a shop floor — should pass it, so its pieces can only
  // ever push that number down. Costs one collider probe per anchor at build
  // time and nothing afterwards (the entry solve is cached on the rec either
  // way). Omitted = today's behaviour, byte-identical, for every caller that
  // authored its own floor and knows the spot is clear.
  CBZ.propRegisterSeat = function (x, y, z, face, kind, lot, geom) {
    if (!on()) return null;
    const rec = {
      x, y: y || 0, z, face: face || 0, kind: kind || "chair", lot: lot || null, occupant: null,
      // DECLARED geometry only — see CBZ.propSeatRef's note on why an inferred
      // cushion would be a regression. null = "this builder didn't say", which
      // the audit counts and the rig reads as "use the legacy pose".
      cushionH: (geom && geom.cushion != null) ? geom.cushion : null,
      floorBelow: (geom && geom.floorBelow) || 0,
      _reg: 1,
    };
    // Checked BEFORE the dedupe claim: a refused anchor must not burn its
    // coordinate key, or a later builder that CAN reach the same spot would be
    // silently turned away by a registration that never happened.
    if (geom && geom.requireEntry && !entryOf(rec)._eok) return null;
    if (dedupe(seatKeys, x, y || 0, z)) return null;
    seats.push(rec);
    return rec;
  };
  // (hx,hz) = direction from mattress CENTER toward the pillow/head end.
  // The lying roll is group.rotation.z = π/2 with rotation.y = face; under
  // three.js 'XYZ' euler that maps the body's up-axis (head) to world
  // (-cos face, 0, sin face), so face = atan2(hz, -hx) puts the head on the
  // pillow. topY = the mattress TOP surface (world y).
  CBZ.propRegisterBed = function (x, y, z, hx, hz, len, topY, kind, lot) {
    if (!on()) return null;
    if (dedupe(bedKeys, x, y || 0, z)) return null;
    const hl = Math.hypot(hx || 0, hz || 0) || 1;
    const rec = {
      x, y: y || 0, z,
      hx: (hx || 0) / hl, hz: (hz || 0) / hl,
      face: Math.atan2(hz || 0, -(hx || 0) || 0),
      len: len || 2.0, top: (topY || 0.6), lieY: (topY || 0.6) + 0.3,
      kind: kind || "bed", lot: lot || null, occupant: null, _reg: 1,
    };
    beds.push(rec);
    return rec;
  };
  // called by props.js's regDynAd for every board that can carry the live
  // WANTED poster. entry.lastKey (the props.js dynAds record) is the live
  // "is a wanted ad actually up right now" signal.
  CBZ.propRegisterWantedPoster = function (mesh, x, y, z, entry) {
    if (!on()) return null;
    const rec = { mesh, x, y: y || 0, z, entry: entry || null, kind: "wanted" };
    posters.push(rec);
    return rec;
  };

  // ---- ENTRY POINTS ----------------------------------------------------------
  // "Entry point matching" (the Sims smart-object / navmesh action-point idea):
  // furniture advertises WHERE you stand to use it. A chair is approached from
  // the front and backed into; a bed is approached from whichever long side is
  // actually walkable. Solved lazily against the live collider set and cached,
  // so it costs nothing until something sits.
  const ENTRY_R = 0.78;      // how far out from the cushion the stander's feet go
  const BED_SIDE = 0.95;     // half a mattress + a body
  const BODY_R = 0.30;
  const probe = [];
  function clearAt(x, z, y) {
    if (!CBZ.queryCollidersNear || !CBZ.colliders || !CBZ.colliders.length) return true;
    const list = CBZ.queryCollidersNear(x, z, BODY_R + 0.05, probe);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.y1 != null && c.y1 <= y + 0.30) continue;    // a kerb/step you walk over
      if (c.y0 != null && c.y0 >= y + 1.75) continue;    // overhead, not in the way
      if (x > c.minX - BODY_R && x < c.maxX + BODY_R && z > c.minZ - BODY_R && z < c.maxZ + BODY_R) return false;
    }
    return true;
  }
  // Resolves rec._ex/_ez (world standing spot) and rec._eok (0 = every candidate
  // was blocked; the anchor is unreachable and the audit counts it).
  function entryOf(rec) {
    if (rec._ex != null) return rec;
    const built = CBZ.colliders && CBZ.colliders.length;
    let cand;
    if (rec.lieY != null) {
      // BED: both long sides, then a WIDER pass on both sides, then the foot.
      // The second pass matters: a bed with a real solid frame (CBZ.furnish
      // draws a 1.4m-wide one) is wider than a single fixed offset assumes, so
      // a one-shot 0.95 probe hits the frame and falls through to the foot end
      // — which makes the perch beat ease the body diagonally across the corner
      // of the mattress. Widening keeps the approach on the long side, which is
      // how anyone actually gets into a bed.
      const sx = rec.hz, sz = -rec.hx;
      const wide = BED_SIDE + 0.42;
      cand = [
        [rec.x + sx * BED_SIDE, rec.z + sz * BED_SIDE],
        [rec.x - sx * BED_SIDE, rec.z - sz * BED_SIDE],
        [rec.x + sx * wide, rec.z + sz * wide],
        [rec.x - sx * wide, rec.z - sz * wide],
        [rec.x - rec.hx * (rec.len * 0.5 + 0.5), rec.z - rec.hz * (rec.len * 0.5 + 0.5)],
      ];
    } else {
      // SEAT: straight out front (back into it), then either side, then behind.
      // …then the SAME FOUR AGAIN, one body further out. The bed branch above
      // has had that second, wider pass since it shipped, for exactly the
      // reason a seat needs it too: ENTRY_R is one fixed offset, and a piece
      // whose authored footprint is bigger than the offset assumes puts its own
      // body inside every candidate. Measured — the staff lounge's armchair
      // (world/lounge.js:128) is 0.94 x 0.88 of solid kit; its corner half-
      // diagonal (0.64) plus propuse's own BODY_R (0.30) needs 0.94 m of
      // clearance and ENTRY_R is 0.78, so all four marks landed in the chair
      // and it was the ONE anchor in the whole prison that `blocked` counted.
      // Purely additive: the loop below returns on the first clear candidate,
      // so every anchor that already resolves keeps the identical entry point
      // and only a would-be `blocked` record ever reaches these four.
      const f = rec.face;
      const dirs = [f, f + HALF, f - HALF, f + Math.PI];
      cand = [];
      for (let r = 0; r < 2; r++) {
        const R = r === 0 ? ENTRY_R : ENTRY_R + 0.42;
        for (let i = 0; i < dirs.length; i++)
          cand.push([rec.x + Math.sin(dirs[i]) * R, rec.z + Math.cos(dirs[i]) * R]);
      }
    }
    for (let i = 0; i < cand.length; i++) {
      if (clearAt(cand[i][0], cand[i][1], rec.y)) {
        if (built) { rec._ex = cand[i][0]; rec._ez = cand[i][1]; rec._eok = 1; }
        return built ? rec : { _ex: cand[i][0], _ez: cand[i][1], _eok: 1, x: rec.x, z: rec.z, y: rec.y };
      }
    }
    if (built) { rec._ex = cand[0][0]; rec._ez = cand[0][1]; rec._eok = 0; }
    return rec._ex != null ? rec : { _ex: cand[0][0], _ez: cand[0][1], _eok: 0, x: rec.x, z: rec.z, y: rec.y };
  }
  function entryX(rec) { const e = entryOf(rec); return e._ex != null ? e._ex : rec.x; }
  function entryZ(rec) { const e = entryOf(rec); return e._ez != null ? e._ez : rec.z; }
  CBZ.propEntryPoint = function (rec) {
    if (!rec) return null;
    const e = entryOf(rec);
    return { x: e._ex, z: e._ez, y: rec.y, ok: !!e._eok };
  };

  // ---- occupancy -------------------------------------------------------------
  function isStale(a) {
    if (!a) return true;
    if (a.dead || a._recycled || a._despawned) return true;
    if (a !== CBZ.player && !a.group) return true;
    return false;
  }
  // A WALK-CLAIM (propGoSit) reserves a seat while its owner walks over, so two
  // NPCs never converge on the same chair. It expires on its own if the walker
  // gets distracted — as everywhere in this file, correctness never depends on a
  // release call.
  // The short list of records that currently have an occupant. Every claim path
  // pushes here; the per-frame hold compacts it. Without it the hold's NPC pass
  // is an O(every seat + every bed) sweep that finds nothing.
  const claimed = [];
  function markClaimed(rec) { if (rec && claimed.indexOf(rec) < 0) claimed.push(rec); }

  const CLAIM_TTL = 45;
  function claimExpired(rec) {
    if (!rec._claimT) return false;
    const o = rec.occupant;
    if (o && o.char && o.char.sitting) { rec._claimT = 0; return false; }   // arrived
    if (o && o._propLie) { rec._claimT = 0; return false; }
    return ((CBZ.now || 0) - rec._claimT) > CLAIM_TTL;
  }
  function isFree(rec) { return !rec.occupant || isStale(rec.occupant) || claimExpired(rec); }

  // lazily resolve the lot an interior anchor sits in (so demolished buildings
  // stop offering their furniture — mirrors officejobs' demolished-desk skip).
  function lotsList() {
    const c = CBZ.city;
    if (!c) return null;
    if (c.arena && c.arena.lots) return c.arena.lots;
    return c.lots || null;
  }
  function lotOf(rec) {
    if (rec.lot !== null || rec._lotR) return rec.lot;
    const lots = lotsList();
    if (!lots) return null;               // city not up yet — retry next query
    rec._lotR = true;
    for (let i = 0; i < lots.length; i++) {
      const l = lots[i];
      const hw = l.w / 2 + 0.5, hd = (l.d != null ? l.d : l.w) / 2 + 0.5;
      if (Math.abs(rec.x - l.cx) <= hw && Math.abs(rec.z - l.cz) <= hd) { rec.lot = l; break; }
    }
    return rec.lot;
  }
  function usable(rec, py) {
    if (!isFree(rec)) return false;
    if (py != null && Math.abs(rec.y - py) > 2.0) return false;   // wrong floor
    const l = lotOf(rec);
    if (l && l.demolished) return false;
    return true;
  }

  // ---- queries (also the NPC-schedules agent's API) --------------------------
  function nearestIn(list, px, pz, r, py) {
    if (!on() || !list.length) return null;
    let best = null, bd = (r || 3.8) * (r || 3.8);
    for (let i = 0; i < list.length; i++) {
      const rec = list[i];
      const dx = rec.x - px, dz = rec.z - pz, d = dx * dx + dz * dz;
      if (d >= bd) continue;
      if (!usable(rec, py)) continue;
      bd = d; best = rec;
    }
    return best;
  }
  CBZ.propNearestSeat = function (px, pz, r, py) { return nearestIn(seats, px, pz, r, py); };
  CBZ.propNearestBed = function (px, pz, r, py) { return nearestIn(beds, px, pz, r, py); };
  // nearest board CURRENTLY displaying the live WANTED poster. Returns the
  // (stable-identity) rec, refreshed with a live wanted/bounty snapshot —
  // the object handed to CBZ.bountyFromPoster.
  CBZ.propNearestWantedPoster = function (px, pz, r) {
    if (!on() || !posters.length) return null;
    const g = CBZ.game;
    let best = null, bd = (r || 3.8) * (r || 3.8);
    for (let i = 0; i < posters.length; i++) {
      const rec = posters[i];
      // showing a wanted ad right now? (adKey embeds "|wanted|" for that kind)
      if (rec.entry && String(rec.entry.lastKey || "").indexOf("|wanted|") < 0) continue;
      const dx = rec.x - px, dz = rec.z - pz, d = dx * dx + dz * dz;
      if (d >= bd) continue;
      bd = d; best = rec;
    }
    if (best && g) {
      best.wanted = g.wanted | 0;
      best.bounty = (g.wanted | 0) * 2500 + (g.cityKills | 0) * 250;
    }
    return best;
  };

  // Every seat inside a rect on one floor — the query the occupied-building /
  // roles agents need to staff a storey ("who sits where on floor 7").
  CBZ.propSeatsIn = function (x0, x1, z0, z1, y, out) {
    out = out || [];
    out.length = 0;
    if (!on()) return out;
    const lo = Math.min(x0, x1), hi = Math.max(x0, x1), lz = Math.min(z0, z1), hz = Math.max(z0, z1);
    for (let i = 0; i < seats.length; i++) {
      const r = seats[i];
      if (r.x < lo || r.x > hi || r.z < lz || r.z > hz) continue;
      if (y != null && Math.abs(r.y - y) > 2.0) continue;
      out.push(r);
    }
    return out;
  };

  // ---- THE ONE-LINE NPC SEATING VERB ----------------------------------------
  // "Send this NPC to sit in that chair." Walks them to the seat's entry point
  // and hands off to peds.js's OWN `finalGoal.sitDesk` routing, which already
  // knows how to arrive, snap, pose and hold a seat for a whole shift — no new
  // brain, no new update loop, no new roster. This is the primitive the census
  // said was missing: `ped.guard = {x,z}` posts a body, this one seats it.
  //   CBZ.propGoSit(ped, CBZ.propNearestSeat(x, z, 20, floorY));
  CBZ.propGoSit = function (ped, seat) {
    if (!on() || !ped || !seat || ped === CBZ.player) return false;
    if (!isFree(seat) || ped.dead || ped.driving || (ped.ko | 0) > 0) return false;
    CBZ.propSeatRelease(ped);
    seat.occupant = ped;                     // reserve for the walk (TTL-expiring)
    markClaimed(seat);
    seat._claimT = CBZ.now || 0;
    ped._propSeat = seat;
    // the DECLARED cushion rides along, so the sit at the far end gets the real
    // chair solve (peds.js hands the last metre to CBZ.moves.sit)
    const anc = { x: seat.x, y: seat.y, z: seat.z, face: seat.face, lot: seat.lot, kind: seat.kind,
      cushionH: seat.cushionH, floorBelow: seat.floorBelow };
    const e = CBZ.propEntryPoint(seat);
    ped.finalGoal = { x: anc.x, z: anc.z, sitDesk: true, anchor: anc };
    ped.path = (e && e.ok) ? [{ x: e.x, z: e.z }, ped.finalGoal] : [ped.finalGoal];
    if (ped.target && ped.target.set) ped.target.set(ped.path[0].x, 0, ped.path[0].z);
    ped.state = "walk"; ped.pause = 0; ped.rage = null;
    return true;
  };

  // The whole verb in ONE line, for the occupied-building / roles / schedules
  // agents: "seat this NPC at whatever is nearby, on its own floor."
  //   CBZ.propSeatNpc && CBZ.propSeatNpc(ped, 8, "throne");
  // `prefer` (optional) is a kind substring tried first — pass "throne"/"boss"
  // for the gang boss so he takes the high-backed chair behind the desk and not
  // a guest seat. Returns the seat taken, or null. Degrade-safe: never throws,
  // never leaves the ped in a broken state.
  CBZ.propSeatNpc = function (ped, radius, prefer) {
    if (!on() || !ped || ped === CBZ.player || !ped.pos) return null;
    const r = radius || 8, y = ped.pos.y;
    let best = null, bd = r * r;
    if (prefer) {
      const p = String(prefer).toLowerCase();
      for (let i = 0; i < seats.length; i++) {
        const s = seats[i];
        if (String(s.kind).toLowerCase().indexOf(p) < 0) continue;
        const dx = s.x - ped.pos.x, dz = s.z - ped.pos.z, d = dx * dx + dz * dz;
        if (d >= bd || !usable(s, y)) continue;
        bd = d; best = s;
      }
    }
    if (!best) best = nearestIn(seats, ped.pos.x, ped.pos.z, r, y);
    if (!best) return null;
    return CBZ.propGoSit(ped, best) ? best : null;
  };

  // ---- claim / release --------------------------------------------------------
  function releaseFrom(list, actor) {
    for (let i = 0; i < list.length; i++) if (list[i].occupant === actor) {
      list[i].occupant = null; list[i]._claimT = 0;
      const k = claimed.indexOf(list[i]); if (k >= 0) claimed.splice(k, 1);
    }
  }
  CBZ.propSeatRelease = function (actor) {
    if (!actor) return;
    releaseFrom(seats, actor); releaseFrom(beds, actor);
    actor._propSeat = null; actor._propBed = null;
  };

  /* =====================================================================
     THE BODY IS CBZ.moves'. This file decides WHICH piece of furniture and
     WHO holds it (the claim is instant, the occupancy rules are here); the
     one posture sequencer in entities/moves_posture.js decides how a body
     gets onto it and off it: the walk in, the turn, the back-step, the hips
     going down onto the cushion with the soles planted, the swing onto the
     pillow, the ladder of a top bunk, the push up and the walk out. It also
     HOLDS a seated or lying body on its spot every frame after, so there is
     one writer of a furniture-held transform in the whole game.

     This file used to carry its own copy of all of that (a 500-line "arc
     engine" of phase rows, an ease-and-teleport walk-in, a per-frame seat
     and bed re-pin for three actor shapes) while world/cellblock.js carried a
     second, worse one for the prison bunks. Both are gone.

     REFUSE, NEVER SNAP still holds, one level up: CBZ.moves refuses a walk
     longer than it can honestly play; the verbs below then commit instantly,
     because a caller asking a far body to sit (a spawn, a restore, a moving
     airliner row that is not a registered world anchor) is asking for the
     body there NOW, and that is honest. An NPC that wants to walk over first
     uses propGoSit, which routes through its own brain.
  ===================================================================== */
  // true while a transition owns the body. Neighbours: don't retarget, don't re-pose.
  CBZ.propArcActive = function (actor) {
    const M = CBZ.moves;
    return !!(M && M.busy && M.busy(actor || CBZ.player));
  };
  // the furniture lost the body some other way (death, a KO, a car, a mode
  // change, a walk-in that stalled). The posture layer already stood it up;
  // only the claim and the bookkeeping are ours to undo.
  function lostBody(actor) {
    if (!actor) return;
    const had = actor._propSeat || actor._propBed;
    CBZ.propSeatRelease(actor);
    actor._propLie = false;
    if (actor !== CBZ.player) {
      if (had) actor._deskAnchor = null;
      if (actor.state === "sit") actor.state = "walk";
    }
  }
  // NPC bookkeeping once the hips are actually down: peds.js's own sit
  // branch holds a ped from `_deskAnchor` + state "sit" for a whole shift
  // a ped whose brain turned urgent while he was sitting down (a threat, a
  // hit) is not seated on arrival: he gets straight back up
  function urgent(a) { return !!(a.rage || a.surrender || a.state === "flee" || a.state === "fight" || a.state === "surrender"); }
  function seatNpcDone(actor, seat) {
    if (actor._propSeat !== seat) return;
    if (urgent(actor)) { CBZ.propStand(actor); return; }
    actor._deskAnchor = {
      x: seat.x, y: seat.y, z: seat.z, face: seat.face, lot: seat.lot, kind: seat.kind,
      cushionH: seat.cushionH, floorBelow: seat.floorBelow,
    };
    actor.state = "sit";
  }
  function bedNpcDone(actor, bed) {
    if (actor._propBed !== bed) return;
    const L = CBZ.propLiePlace ? CBZ.propLiePlace(actor, bed, {}) : bed;
    actor._deskAnchor = { x: L.x, y: L.y, z: L.z, face: bed.face, lot: bed.lot };
    actor.state = "sit";
  }
  // a body already posed somewhere else gets up from it before claiming anew
  function freeFromPosture(M, actor) {
    const p = M.posture ? M.posture(actor) : "stand";
    if (p !== "stand" && p !== "crouch") M.stand(actor, { instant: true });
  }

  // ---- SIT / STAND ------------------------------------------------------------
  // actor = CBZ.player or any NPC (a peds.js ped, a prison actor, a package
  // body). opts.instant = no sequence (force-exits, restores, spawns).
  CBZ.propSit = function (actor, seat, opts) {
    if (!on() || !actor || !seat || !isFree(seat)) return false;
    if (actor.dead || (actor.ko | 0) > 0 || actor.driving) return false;
    const M = CBZ.moves;
    if (!M || !M.sit || M.busy(actor)) return false;
    freeFromPosture(M, actor);
    CBZ.propSeatRelease(actor);
    actor._propLie = false;
    seat.occupant = actor;                 // the CLAIM is instant; only the body takes time
    markClaimed(seat);
    actor._propSeat = seat;
    const isP = actor === CBZ.player;
    // the mode this sit belongs to: the pin below force-exits on a mode CHANGE
    if (isP) actor._propMode = (CBZ.game && CBZ.game.mode) || "city";
    // a ped's speed/path are per-frame values its own brain rebuilds; a plain
    // actor's are fields its game owns (systems/rest.js), so only peds are reset
    else if (actor.pos) { actor.speed = 0; actor.path = null; }
    const o = {
      onDone: isP ? null : seatNpcDone, onAbort: lostBody,
      // an unregistered seat belongs to a moving host (an airliner row): no walk-in
      instant: !!(opts && opts.instant) || !seat._reg,
    };
    if (M.sit(actor, seat, o)) return true;
    o.instant = true;                      // too far to walk honestly: the caller wants him seated now
    if (M.sit(actor, seat, o)) return true;
    CBZ.propSeatRelease(actor);
    return false;
  };
  CBZ.propStand = function (actor, opts) {
    if (!actor) return;
    const had = actor._propSeat || actor._propBed;
    CBZ.propSeatRelease(actor);
    actor._propLie = false;
    if (had) actor._deskAnchor = null;     // only clear OUR anchor, never an office desk claim
    if (actor !== CBZ.player && actor.state === "sit") actor.state = "walk";
    const M = CBZ.moves;
    if (M && M.stand) M.stand(actor, opts && opts.instant ? { instant: true } : null);
    if (actor === CBZ.player && opts && opts.instant) CBZ.player.stun = 0;
  };

  // ---- SLEEP / WAKE -----------------------------------------------------------
  function skipToMorning() {
    // guests never write the shared world clock (host owns it — netpersist).
    if (CBZ.net && CBZ.net.active && CBZ.net.guest && CBZ.net.guest()) return false;
    if (!CBZ.dayPhase || !CBZ.dayCount) return false;
    const MORNING = CBZ.CONFIG.PROPS_MORNING_PHASE;
    const cur = CBZ.dayPhase();
    if (MORNING <= cur) CBZ.dayCount(CBZ.dayCount() + 1);   // wrapped past midnight
    CBZ.dayPhase(MORNING);
    return true;
  }
  /* ---- IS THIS BED YOURS -------------------------------------------------
     Three ways a lot can be the player's, asked in the order they cost:
     the safehouse he sleeps in (realestate.js's g.cityHome), the ownership
     flag realestate/housing write onto the building itself, and finally
     CBZ.cityOwnsLot — zillow.js's declared source of truth for the deeds
     (construction.js calls it "the one ownership source of truth"). All three
     are READ-ONLY calls into files this one does not own, and every one is
     guarded: with any of them absent the answer is "not yours", which is the
     conservative direction — you get the weaker heal and the risk. */
  function bedOwned(bed) {
    const g = CBZ.game;
    const lot = bed.lot || lotOf(bed);
    if (!lot) return false;
    if (g && g.cityHome && g.cityHome.lot === lot) return true;
    const b = lot.building;
    if (b && b.home && b.home.owned) return true;
    if (CBZ.cityOwnsLot) { try { if (CBZ.cityOwnsLot(lot)) return true; } catch (e) {} }
    return false;
  }

  /* ---- WHAT SLEEPING SOMEWHERE ELSE IS WORTH, AND WHAT IT COSTS ----------
     Derived, not invented: realestate.js's sleepHeal is the FULL reset (hp and
     stamina to max, hunger full, wounds dressed, heat bled) and it is the
     reward for owning a roof. This is deliberately a fraction of it —
     REST_FRAC of max HP as a CAP you are pulled UP to and never above, so a
     healthy player gains nothing by napping in strangers' houses and a hurt
     one gets a real but partial second chance. Nothing here dresses a wound,
     feeds you, or touches heat DOWNWARD; those stay the safehouse's alone.
     Returns the sentence to append to the wake-up note (never throws). */
  const REST_FRAC = 0.60;        // rough sleep gets you 60% of the way a bed does
  const REST_STAM = 0.85;        // you do rest, even badly
  const TRESPASS_SEV = 30;       // wanted.js: "trespass" is a 1★ charge
  function restPayoff(bed) {
    if (CBZ.CONFIG.INTERIOR_SLEEP_STAKES === false) return "";
    if (bedOwned(bed)) return "";              // your own bed keeps the full reset
    const P = CBZ.player;
    if (!P) return "";
    let out = "";
    const cap = Math.round((P.maxHp || 100) * REST_FRAC);
    if ((P.hp | 0) < cap) { P.hp = cap; out = " Rough sleep, patched up, not fixed."; }
    const sCap = Math.round((P.maxStamina || 100) * REST_STAM);
    if ((P.stamina || 0) < sCap) P.stamina = sCap;
    if (CBZ.cityHudDirty) { try { CBZ.cityHudDirty(); } catch (e) {} }
    // THE RISK. This is somebody's bedroom. cityCrime's ORDINARY path (no
    // `instant`) tags whoever is within 30m as a witness and only reports if a
    // cop can see it — so an empty house at 3am genuinely costs nothing, and
    // a household or a patrol that watches you climb into their bed is a
    // trespass call. No new heat system, no new flag: one existing seam, the
    // same one interior_programs.js's robbery uses.
    if (CBZ.cityCrime) {
      try { CBZ.cityCrime(TRESPASS_SEV, { x: bed.x, z: bed.z, type: "trespass" }); } catch (e) {}
    }
    return out;
  }

  // the time-skip fires ONCE, and only when the body has actually finished
  // lying down — you sleep after you're in the bed, not on the way to it.
  function bedDown(actor, bed) {
    if (actor !== CBZ.player) return;
    const skipped = skipToMorning();
    const g = CBZ.game;
    if (g && g.tired != null) g.tired = 0;                 // rested
    let msg = skipped ? "Slept until morning." : "Resting…";
    try { msg += restPayoff(bed); } catch (e) {}
    if (CBZ.city && CBZ.city.note) CBZ.city.note(msg, 2.6);
  }
  CBZ.propSleep = function (actor, bed, opts) {
    if (!on() || !actor || !bed || !isFree(bed)) return false;
    if (actor.dead || (actor.ko | 0) > 0 || actor.driving) return false;
    const M = CBZ.moves;
    if (!M || !M.lie || M.busy(actor)) return false;
    freeFromPosture(M, actor);
    CBZ.propSeatRelease(actor);
    bed.occupant = actor;
    markClaimed(bed);
    actor._propBed = bed;
    const isP = actor === CBZ.player;
    if (isP) actor._propMode = (CBZ.game && CBZ.game.mode) || "city";
    else {
      // "this body belongs to a bed" from the first frame: the prison mover
      // (entities/npc.js) and every sweep read it and keep their hands off
      actor._propLie = true;
      if (actor.pos) { actor.speed = 0; actor.path = null; }
    }
    // the time-skip and the heal fire once the body is actually IN the bed
    const o = { onDone: isP ? bedDown : bedNpcDone, onAbort: lostBody, instant: !!(opts && opts.instant) || !bed._reg };
    if (M.lie(actor, bed, o)) return true;
    o.instant = true;
    if (M.lie(actor, bed, o)) return true;
    CBZ.propSeatRelease(actor);
    actor._propLie = false;
    return false;
  };
  CBZ.propWake = function (actor, opts) {
    if (!actor) return;
    CBZ.propSeatRelease(actor);
    actor._propLie = false;
    if (actor !== CBZ.player) {
      actor._deskAnchor = null;
      if (actor.state === "sit") actor.state = "walk";
    }
    const M = CBZ.moves;
    if (M && M.stand) M.stand(actor, opts && opts.instant ? { instant: true } : null);
    if (actor === CBZ.player && opts && opts.instant) CBZ.player.stun = 0;
  };
  /* ---- THE BED HALF OF THE ONE-LINE NPC VERB -----------------------------
     "Put this NPC to bed at whatever is nearby, on its own floor."
       CBZ.propBedNpc && CBZ.propBedNpc(ped, 6);
     THE LATENT SEAM THIS CLOSES: propSeatNpc's `prefer` argument is a kind
     substring matched against seats[] ONLY — beds live in their own registry
     — so the night sweep's `propSeatNpc(a, 6.5, "bed")` could never once put
     anybody in a bed. It either matched a SEAT whose kind contains "bed"
     ("bedside" tables do) or fell through to the nearest chair. A caller
     asking for a bed deserves a primitive that has one.

     The guards are citystaff.js's willSeat test in the same order: a body
     that is dead, driving, KO'd, already claimed by furniture or held by
     npclife's attach() is not available to be put anywhere.

     REFUSE, NEVER SNAP (BED_WALK_MAX): the radius is
     CLAMPED to what the lie sequence can honestly walk. Beyond it propSleep would
     fall through to the instant commit and teleport a body into a bed across
     the room, which is the exact defect the arc engine exists to delete — so
     a far bed simply isn't offered, and the caller tries again next sweep
     from wherever the ped's own brain has wandered to. Returns the bed taken,
     or null. Degrade-safe: never throws, never leaves a broken ped. */
  const BED_WALK_MAX = 6.1;      // a bed further than this is not offered (CBZ.moves walks 6.5)
  CBZ.propBedNpc = function (ped, radius) {
    if (!on() || !ped || ped === CBZ.player || !ped.pos || !ped.group) return null;
    if (ped.dead || ped.driving || (ped.ko | 0) > 0) return null;
    if (ped._npcAttached || ped._propBed || ped._propSeat || ped._propLie) return null;
    const r = Math.min(radius || 6, BED_WALK_MAX);
    const bed = nearestIn(beds, ped.pos.x, ped.pos.z, r, ped.pos.y);
    if (!bed) return null;
    const e = CBZ.propEntryPoint(bed);
    if (e && !e.ok) return null;                // nothing can stand beside it
    let ok = false;
    try { ok = !!CBZ.propSleep(ped, bed); } catch (err) { ok = false; }
    return ok ? bed : null;
  };

  // ---- THE RATCHET ------------------------------------------------------------
  // Physical-plausibility invariant, the tree-connection-law shape
  // (world/treeaudit.js): every seat/bed anchor must (a) declare its cushion
  // geometry so the rig can solve feet-on-the-floor, and (b) have at least one
  // walkable standing spot, or the body can never legitimately reach it.
  // CORRECTION (2026-07-26, the first time anyone actually MEASURED it): this
  // said `blocked` was a hard invariant to pin at 0, because an anchor nothing
  // can walk to is furniture that lies. A live build reads 487 blocked out of
  // ~6000 anchors — so zero was an aspiration that had never been checked, and
  // pinning it there would have failed the gate on day one for reasons nobody
  // had introduced. It is pinned in tools/math-gate.mjs at 487 as a RATCHET
  // that may only go DOWN. Driving it to zero is real outstanding work; it is
  // not a property this file may claim.
  // `noGeom` is an ADOPTION counter, nonzero by design
  // today: pin it at whatever the current build reports, and it may only ever
  // go DOWN as builders move onto CBZ.furnish. Do NOT pin noGeom at 0.
  // TWO NEW COUNTERS, and they do NOT mean what noGeom/blocked mean — read
  // this before pinning either:
  //   postured — COVERAGE, not a defect. Seats that (a) declared a cushion, so
  //     the V2 solve runs at all, and (b) carry a `kind` that
  //     CBZ.charSeatPosture resolves to a real posture family. It is the count
  //     of chairs in this world that are visibly a sofa/throne/stool/bench
  //     rather than a generic chair, so it should RISE as furnishers pass
  //     honest kinds. Do not pin it as a may-only-decrease ratchet.
  //   sleepers — a LIVE gauge: bodies whose rig is in the sleep pose this
  //     instant. Zero in a daytime world is correct; it exists so a probe can
  //     prove the pose is reachable at all (the old bug was invisible because
  //     the plank pose IS the KO pose and nothing ever counted it).
  // noGeom and blocked are untouched in meaning and in arithmetic.
  CBZ.propUseAudit = function () {
    let noGeom = 0, blocked = 0, postured = 0, sleepers = 0;
    const classify = CBZ.charSeatPosture;
    for (let i = 0; i < seats.length; i++) {
      const r = seats[i];
      if (r.cushionH == null) noGeom++;      // builder never declared its cushion
      else if (classify && classify(r.kind)) postured++;
      if (!entryOf(r)._eok) blocked++;
    }
    for (let i = 0; i < beds.length; i++) {
      const r = beds[i];
      if (r.lieY == null || r.top == null) noGeom++;
      if (!entryOf(r)._eok) blocked++;
    }
    const pch = CBZ.playerChar;
    if (pch && pch.lying) sleepers++;
    /* THE RATCHET (SIT_PHYS_V1): airSitters — claimed seats whose occupant is
       in the seated pose but NOT at the seat. This is the owner's sentence as
       a number ("sit on air, close to a chair, but not on the chair"): before
       the seat re-pin it read 1 within a minute of the first chow block
       (2.13 m off a yard stool); with the pin it is 0 by construction, and a
       new mover that drags seated bodies shows up here before it ships.
       Mid-arc bodies are excluded — a transition legitimately holds the flag
       away from the anchor for a beat. Pinned at 0 by
       tools/prison-sit-check.mjs. */
    let airSitters = 0;
    for (let i = 0; i < claimed.length; i++) {
      const rec = claimed[i], o = rec.occupant;
      if (o && o !== CBZ.player && o.char && o.char.lying) sleepers++;
      if (rec.lieY == null && o && o !== CBZ.player && o.char && o.char.sitting
          && !CBZ.propArcActive(o) && !o._npcAttached && !((o.ko | 0) > 0) && o.group) {
        const gp = o.group.position;
        if (Math.hypot(gp.x - rec.x, gp.z - rec.z) > 0.35) airSitters++;
      }
    }
    return {
      seats: seats.length, beds: beds.length, noGeom: noGeom, blocked: blocked,
      sleepers: sleepers, postured: postured, airSitters: airSitters,
    };
  };

  // ---- the per-frame HOLD -----------------------------------------------------
  // The transform and the pose of every furniture-held body are CBZ.moves'
  // (its hold runs at 41.5, after every mover). What is left here is what only
  // the furniture knows: lapsed claims leave the short list, and the player
  // is stood up when the thing he sits on stops existing (the building came
  // down) or the game he sat down in is not the one running.
  if (CBZ.onUpdate) CBZ.onUpdate(42, function () {
    for (let i = claimed.length - 1; i >= 0; i--) {
      const o = claimed[i].occupant;
      if (!o || isStale(o)) claimed.splice(i, 1);
    }
    const P = CBZ.player;
    if (!P || (!P._propSeat && !P._propBed) || CBZ.propArcActive(P)) return;
    const g = CBZ.game, a = P._propSeat || P._propBed;
    const sitMode = P._propMode || "city";
    const l = a.lot || (a._lotR ? null : lotOf(a));
    if (!g || g.mode !== sitMode || (l && l.demolished)) {
      if (P._propSeat) CBZ.propStand(P, { instant: true }); else CBZ.propWake(P, { instant: true });
    }
  });
})();
