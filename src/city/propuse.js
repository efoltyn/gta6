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

   ---- BODY ARCS V2 (owner: "fix sitting and lying in bed" — sitting
   down must not be a teleport with a pose) ---------------------------
   Sitting, standing, lying down and getting up are now ARCS, not state
   flips. Every transition runs a phased walk→turn→settle machine (the
   aircraft_doors.js / elevators.js boarding grammar, generalised):

     SIT   walk to the seat's ENTRY POINT → turn to the seat facing →
           lower (crouch dip, then the seated pose folds in as the body
           backs onto the cushion).                       ~0.6s + walk
     STAND push  (anticipation: lean forward over the knees, weight
           shifts onto the feet) → rise (legs extend, body travels
           forward off the cushion) → settle.  Deliberately SLOWER than
           sitting down — getting up costs effort.               ~0.78s
     LIE   walk to the BEDSIDE → perch (sit on the mattress edge, feet
           on the floor) → swing (legs up, body rolls flat onto the
           pillow).                                        ~0.94s + walk
     RISE  unroll back to a perch on the edge → stand up.       ~1.34s

   The phase proportions are the four-phase sit-to-stand model from the
   kinesiology literature (flexion-momentum ≈ a third of the cycle, then
   momentum-transfer + extension, then a short stabilisation): our push is
   28% of the stand arc, rise 51%, settle 21%. Standing up is ~25% longer
   than sitting down because it genuinely is. Skipping the bed perch is
   the exact defect Cyberpunk 2077 shipped, was mocked for, and patched.

   REFUSE, NEVER SNAP: beyond ARC_MAX the arc declines and the caller gets
   the honest instant commit. A half-played approach that teleports the
   remainder is worse than no approach at all.

   Nothing about the arc is new machinery: the player's body is owned via
   the SAME `player._doorArc` early-return systems/physics.js already
   honours for aircraft boarding (no new freeze flag), the rig is posed
   through fields entities/character.js already reads (`ch.sitting`,
   `ch.seatRef`, `ch.crouch`), and NPCs ride peds.js's own `state==="sit"`
   branch exactly as before — the arc only overrides the visual transform
   for the handful of frames the transition lasts (this updater runs at
   order 42, AFTER peds.js at 34 and physics at 10, so it wins the frame).

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
     CBZ.propSit / propStand    — seat/release now (arc; claim is instant)
     CBZ.propSleep / propWake   — the bed pair
     CBZ.propLiePlace(actor,bed) — {x,y,z} for the rig's ORIGIN (its FEET) when
                                  this actor lies on this bed. THE ONE placement
                                  solve: both commits, both arc beats, the NPC
                                  hold and the player pin call it, so a sleeper
                                  is never in two places. Never place a lying
                                  body off `bed.x/z/lieY` again — that put the
                                  feet at the mattress CENTRE and threw the head
                                  a body-length past the headboard.
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

   Revert: CBZ.CONFIG.PROPS_PURPOSE = false (everything no-ops; live arcs
             abort cleanly rather than stranding the body).
           CBZ.CONFIG.PROPS_BODY_ARC = false (instant commit, V1 exactly).
           CBZ.CONFIG.PROPS_SEAT_GEOM = false (legacy squat pose everywhere,
             aircraft cabins included).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.PROPS_PURPOSE == null) CBZ.CONFIG.PROPS_PURPOSE = true;
  // PROPS_BODY_ARC — owner: "fix sitting and lying in bed ... not a teleport
  // with a pose". On → sit/stand/lie/rise run a phased walk-turn-settle arc
  // that owns the body for ~0.6-1.0s. Flip false (or ?cfg_PROPS_BODY_ARC=0)
  // for a one-line revert to the instant V1 teleport.
  if (CBZ.CONFIG.PROPS_BODY_ARC == null) CBZ.CONFIG.PROPS_BODY_ARC = true;
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
  function arcOn() { return CBZ.CONFIG.PROPS_BODY_ARC !== false; }
  function geomOn() { return CBZ.CONFIG.PROPS_SEAT_GEOM !== false; }

  const HALF = Math.PI / 2;
  function lerpA(a, b, t) {
    if (CBZ.lerpAngle) return CBZ.lerpAngle(a, b, t);
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }
  function eOut(u) { const k = 1 - u; return 1 - k * k * k; }              // decelerate in
  function eInOut(u) { return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; }

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
    // END live arcs, never truncate: `arcs.length = 0` orphaned `_doorArc`,
    // leaving the player permanently un-simulated through a world rebuild.
    for (let i = arcs.length - 1; i >= 0; i--) endArc(arcs[i]);
    arcs.length = 0;
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
  // One description of "sitting on this bed", shared by the perch beat going
  // to sleep and the edge beat getting up, so the two can never disagree.
  function bedSeatRef(rec) {
    return {
      cushion: Math.max(0.30, rec.top - rec.y),
      floorBelow: 0,
      kind: rec.kind || null,
      ceiling: rec.ceiling != null ? rec.ceiling - (rec.y || 0) : null,
    };
  }
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
    const anc = { x: seat.x, y: seat.y, z: seat.z, face: seat.face, lot: seat.lot, kind: seat.kind };
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
     THE ARC ENGINE — one phased transition machine for every furniture
     mount/dismount. Phases are just {name, dur} rows; stepArc reads the
     phase name and writes an absolute transform + absolute rig-flag state
     for that frame. Nothing accumulates, so an arc can be abandoned at any
     instant (death, KO, demolition) with a single splice.
  ===================================================================== */
  const arcs = [];
  const PLAN = {
    // sitting down: brisk, decelerating into the cushion
    sit: [["walk", 0], ["turn", 0.20], ["lower", 0.42]],
    // standing up: anticipation first, then the push — deliberately the
    // longest arc. Getting out of a chair costs more than falling into one.
    stand: [["push", 0.22], ["rise", 0.40], ["settle", 0.16]],
    // going to bed: you sit on the edge first, THEN swing your legs up.
    // The perch is deliberately long enough to READ as a seated beat. Cyberpunk
    // 2077 shipped a bed animation without one, got publicly mocked for it, and
    // patched it back in — skipping straight from standing to horizontal is the
    // failure mode this whole arc exists to avoid.
    lie: [["walk", 0], ["perch", 0.42], ["swing", 0.52]],
    // getting out of bed: roll up to the edge, sit a beat, then stand.
    rise: [["unroll", 0.46], ["edge", 0.20], ["push", 0.16], ["riseUp", 0.38], ["settle", 0.14]],
  };
  const WALK_CAP = 1.8;        // seconds the walk-in leg is allowed
  const WALK_SPD = 3.4;
  // REFUSE, NEVER SNAP. If the body is further from the furniture than the walk
  // leg can cover, we do NOT play a partial approach and teleport the remainder
  // — a half-walk that ends in a jump is the exact defect this whole change
  // exists to remove. Beyond this radius the caller gets the honest instant
  // commit instead (and an NPC that wants to walk over properly uses
  // CBZ.propGoSit, which routes through the ped brain's own pathfinding).
  const ARC_MAX = WALK_CAP * WALK_SPD * 0.95;   // ≈ 6.1m (interaction REACH is 3.8m)
  const DISMOUNT_MAX = 1.6;                     // how far off its seat a body may be and still "get up"

  function arcOf(a) { for (let i = 0; i < arcs.length; i++) if (arcs[i].actor === a) return arcs[i]; return null; }
  function dropArc(a) { for (let i = arcs.length - 1; i >= 0; i--) if (arcs[i].actor === a) arcs.splice(i, 1); }
  // Seam for neighbours (occupied-buildings / roles agents): true while a
  // transition owns this body — don't retarget, don't re-pose, don't shoot a
  // screenshot. Degrade-safe: `CBZ.propArcActive ? CBZ.propArcActive(p) : false`.
  CBZ.propArcActive = function (actor) { return !!arcOf(actor || CBZ.player); };

  function charOf(actor) { return actor === CBZ.player ? CBZ.playerChar : actor.char; }
  function groupOf(actor) { const ch = charOf(actor); return ch && ch.group ? ch.group : actor.group; }

  function place(actor, x, y, z, yaw) {
    if (actor.pos && actor.pos.set) actor.pos.set(x, y, z);
    const grp = groupOf(actor);
    if (grp) { grp.position.set(x, y, z); if (yaw != null) grp.rotation.y = yaw; }
  }

  // ---- WHERE A BODY LIES ------------------------------------------------------
  // THE ONE answer to "where does THIS actor's rig go when it lies on THIS bed".
  // Every lie path routes through it — both instant commits, both arc beats
  // (swing/unroll), the NPC hold and the player pin — so the player and an NPC
  // can never again lie in two different places on the same mattress.
  //
  // THE BUG IT DELETES (owner: "laying in bed looks f-ing dumb, player is far too
  // high up on the bed, head is over it"): all six sites placed the rig's ORIGIN
  // on the mattress CENTRE. entities/character.js stacks the entire body UP from
  // the origin — THE ORIGIN IS THE FEET, not the middle — and the lie is that
  // standing rig rolled 90° about Z (physics.js's KO look). So putting the feet
  // at the centre threw a whole body length (~1.8 m) toward the pillow: on a
  // 2.0 m bed the crown finished ~0.85 m PAST the head end, hanging in the air
  // over the headboard, with the foot half of the mattress empty.
  //
  // Two numbers fall out of the RIG, and neither may be a constant again:
  //   ALONG the bed — the anchor is where the FEET go, offset from the centre by
  //     the sleeper's own stature, so a child and an adult both lie in the same
  //     bed correctly and no caller has to know the rig's height.
  //   VERTICALLY — under that roll the axis that becomes UP is the body's
  //     LATERAL one, so the mattress clearance is half a SHOULDER, not the
  //     standing capsule and not the KO-on-the-floor 0.3 this inherited from
  //     `lieY` (that constant is measured against a FLOOR, where sinking is
  //     invisible; a mattress top is a surface you can see the body miss).
  // Degrade-safe: a rig with no published metric/profile gets the old numbers.
  const LIE_HEAD_PAD = 0.06;   // gap the crown keeps off the head end of the mattress
  const LIE_SINK = 0.04;       // a real mattress takes this much of the shoulder
  const lieTmp = { x: 0, y: 0, z: 0 };
  const lieM = { len: 1.80, rise: 0.30 };     // scratch: this runs in the per-frame pin

  /* ---- WHO SLEEPS HOW ---------------------------------------------------
     THE SECOND HALF of the sleep pose: entities/character.js owns the joints,
     this owns the CHOICE — back or side, near arm folded in or laid down —
     because the choice belongs to the person, not to the animation frame.

     Stable per BODY, so the same person always sleeps the same way and a
     shared dorm still reads as five different people. The key is built from
     numbers that exist the moment the rig is BUILT and never change after
     (the tone it was painted with, the exact segment lengths its profile
     produced), so it survives a despawn/respawn and never depends on where
     the body happens to be standing. Hashed with CBZ.hash01 — the
     order-independent position hash, never Math.random and never a shared
     stream draw, so two clients on one seed put the same person to bed in
     the same pose (the determinism law). */
  const SLEEP_SALT_A = 0x51EE9, SLEEP_SALT_B = 0x1EEB;
  function sleepStyle(actor) {
    if (actor._propSleepS) return actor._propSleepS;
    const ch = charOf(actor), pf = ch && ch.profile;
    const k = (((ch && ch.skinTone) | 0) >>> 0)
      + Math.round(((ch && ch.hipY) || 0.95) * 1000) * 7
      + Math.round(((pf && pf.torsoW) || 0.90) * 1000) * 31
      + Math.round(((pf && pf.armUp) || 0.46) * 1000) * 131;
    const h1 = CBZ.hash01 ? CBZ.hash01(k * 0.1, (k >>> 7) * 0.1, SLEEP_SALT_A) : 0.5;
    const h2 = CBZ.hash01 ? CBZ.hash01((k >>> 3) * 0.1, k * 0.1, SLEEP_SALT_B) : 0.5;
    // ~38% back sleepers, the rest on their side — which is roughly what the
    // sleep-posture surveys report, and it matters here because the two need
    // DIFFERENT mattress clearances (see lieMetrics below).
    const s = { back: h1 < 0.38, fold: h2 < 0.55, vary: h2, phase: h1 * 6.283 };
    actor._propSleepS = s;
    return s;
  }
  // THE ONE seam between "this body is in a bed" and the rig's sleep pose.
  // Reuses the live record when there is one so the breathing phase keeps
  // running across the frame the arc hands over to the hold.
  function setLying(actor) {
    const ch = charOf(actor);
    if (!ch) return;
    const s = sleepStyle(actor);
    if (ch.lying) { ch.lying.back = s.back; ch.lying.fold = s.fold; ch.lying.vary = s.vary; }
    else ch.lying = { back: s.back, phase: s.phase, fold: s.fold, vary: s.vary };
    ch.sitting = false;
  }
  // Clearing is all the blend-out this needs: character.js's sleep branch
  // publishes ch._stanceNk (the neck recovery every full-rig pose here arms)
  // and refunds any seat solve it inherited, and every joint it writes is a
  // channel the locomotion path damps back on its own the next frame — so a
  // body that stands up walks off straight-legged, not bent.
  function clearLying(actor) {
    const ch = charOf(actor);
    if (ch && ch.lying) ch.lying = null;
  }
  CBZ.propLieStyle = sleepStyle;     // read-only seam for presets/diagnostics

  function lieMetrics(actor) {
    const ch = charOf(actor);
    const m = ch && ch.metric;
    const pf = ch && ch.profile;
    const hs = (ch && ch.group && ch.group.userData && ch.group.userData.humanScale) || 1;
    // feet -> crown, in metres (character.js publishes the metric per rig)
    lieM.len = (m && m.height > 0.6) ? m.height : 1.80;
    // VERTICAL — the group's 90° roll makes the body's LATERAL axis the up
    // axis, so a SIDE sleeper presents half a shoulder to the mattress. A BACK
    // sleeper does not: entities/character.js rolls his chest toward the
    // ceiling INSIDE the rig (body.rotation.y about the body's own long axis),
    // which turns half a shoulder into half a torso DEPTH — ~3cm of visible
    // float if we kept quoting the shoulder at him. Half-extent of a box
    // rotated by θ is (w·cosθ + d·sinθ)/2, and CBZ.charLieRoll publishes the
    // two θ the pose actually uses, so the number can never drift from it.
    const R = CBZ.charLieRoll;
    const posed = !!(R && actor && CBZ.CONFIG.CHAR_SLEEP_POSE !== false);
    if (pf && pf.torsoW > 0) {
      const th = posed ? (sleepStyle(actor).back ? R.back : R.side) : 0;
      const halfW = (pf.torsoW * Math.cos(th) + (pf.torsoD || pf.torsoW) * Math.sin(th)) * 0.5 * hs;
      lieM.rise = Math.max(0.14, halfW - LIE_SINK);
    } else {
      lieM.rise = 0.30;
    }
    return lieM;
  }
  // Returns {x,y,z} for the rig's ORIGIN (its feet) — pass `out` to avoid the
  // shared scratch when you need to hold the result across another call.
  CBZ.propLiePlace = function (actor, bed, out) {
    out = out || lieTmp;
    if (!bed) {                      // no record: the honest answer is "don't move"
      const g0 = actor && groupOf(actor);
      out.x = g0 ? g0.position.x : 0; out.y = g0 ? g0.position.y : 0; out.z = g0 ? g0.position.z : 0;
      return out;
    }
    const M = lieMetrics(actor);
    const half = (bed.len || 2.0) * 0.5;
    // Feet offset from the mattress centre along the head axis (hx,hz): crown one
    // pad short of the head end, and NEVER past the foot end — a body longer than
    // its bed is CENTRED instead, so the overhang is shared at both ends rather
    // than dumped on the pillow. |s| can therefore never exceed half a body
    // length, which is what keeps the dismount arc inside DISMOUNT_MAX.
    const s = Math.max(half - LIE_HEAD_PAD - M.len, -M.len * 0.5);
    out.x = bed.x + bed.hx * s;
    out.z = bed.z + bed.hz * s;
    out.y = (bed.top != null ? bed.top
      : (bed.lieY != null ? bed.lieY - 0.3 : (bed.y || 0))) + M.rise;
    return out;
  };

  function beginArc(actor, kind, rec) {
    if (!arcOn()) return false;
    // Arcs are for REGISTERED WORLD anchors only. Ad-hoc seat literals (the
    // airliner cabin's per-row seats, any future scripted seat) belong to a
    // moving/parented host and keep the instant V1 commit — walking a body
    // through world space toward a seat that is itself moving is a lie.
    if (!rec || !rec._reg) return false;
    const ch = charOf(actor);
    if (!ch || !ch.group) return false;
    const isP = actor === CBZ.player;
    // Somebody else's arc already owns this body (aircraft boarding, a cutscene
    // walk) — never fight it; fall back to the instant path.
    if (isP && actor._doorArc && !actor._propOwnsBody) return false;
    const g = ch.group;
    const A = {
      actor: actor, kind: kind, rec: rec, isP: isP,
      i: 0, t: 0,
      plan: PLAN[kind],
      sx: g.position.x, sy: g.position.y, sz: g.position.z, syaw: g.rotation.y, sroll: g.rotation.z,
      mode: (CBZ.game && CBZ.game.mode) || null,
      lean: 0,
      // the yaw a standing body leaves with. A seat's is its own facing; a bed's
      // is the outward perch facing, resolved when the perch beat runs.
      outFace: (rec.lieY != null) ? g.rotation.y : rec.face,
    };
    // dynamic walk-in leg: only if we're actually away from the entry point
    if (A.plan[0][0] === "walk") {
      const ex = entryX(rec), ez = entryZ(rec);
      const d = Math.hypot(ex - A.sx, ez - A.sz);
      if (d > ARC_MAX) return false;          // too far to walk it honestly — refuse
      A.walkTo = { x: ex, z: ez };
      A.skipWalk = d < 0.34;
    } else if (Math.hypot(rec.x - A.sx, rec.z - A.sz) > DISMOUNT_MAX) {
      // A dismount arc eases the body from where it IS to the furniture's entry
      // point. If the body isn't actually on the furniture any more (something
      // else moved it — a blast, a script, a net correction) that ease would be
      // a long slide across the room. Refuse; the instant release is honest.
      return false;
    }
    // Only NOW is the arc certain to run. Every `return false` above must leave
    // the previous state untouched — an earlier draft dropped the running arc
    // first, so a refused second request stranded `_doorArc` true with an empty
    // arcs[], invisible to both the hold and the dead-man switch.
    dropArc(actor);
    if (isP) {
      actor._doorArc = true;
      actor._propOwnsBody = true;
      // OWNER TOKEN. `_doorArc` is a shared boolean (city/aircraft_doors.js sets
      // it too). Sharing a flag is not sharing ownership: without a token, an
      // aircraft boarding beat started during a sit arc would have its
      // `_doorArc` cleared out from under it when our arc ended, handing WASD
      // back mid-walk. We only ever clear what we still own.
      actor._doorArcOwner = "prop";
      actor._propArcT = (CBZ.now || 0);
    }
    arcs.push(A);
    return true;
  }

  function endArc(A) {
    dropArc(A.actor);
    const a = A.actor;
    if (A.isP && a._propOwnsBody) {
      a._propOwnsBody = false;
      // Hand the flag back ONLY if nobody else has taken the body since. The
      // aircraft door arc is the other writer of this boolean and publishes its
      // own liveness, so we ask it directly rather than trusting a token it
      // never sets. Clearing `_doorArc` out from under a live boarding beat
      // would resume WASD mid-walk and fight its guide().
      const other = CBZ.aircraftDoorArc && CBZ.aircraftDoorArc.active;
      if (a._doorArcOwner === "prop" && !other) { a._doorArc = false; }
      if (a._doorArcOwner === "prop") a._doorArcOwner = null;
    }
    const ch = charOf(A.actor);
    if (ch) ch.crouch = false;
  }

  // walk the body toward (tx,tz); returns true on arrival. Animates the rig with
  // the REAL step speed so the walk-in is a walk, not a slide (the one thing
  // aircraft_doors.js's own guide() never got to do).
  const walkScratch = { x: 0, y: 0, z: 0 };
  function guide(actor, tx, tz, y, dt) {
    const grp = groupOf(actor);
    const cx = grp.position.x, cz = grp.position.z;
    const dx = tx - cx, dz = tz - cz;
    const d = Math.hypot(dx, dz);
    if (d < 0.22) { if (actor.speed != null) actor.speed = 0; return true; }
    const step = Math.min(d, WALK_SPD * dt);
    walkScratch.x = cx + (dx / d) * step;
    walkScratch.z = cz + (dz / d) * step;
    walkScratch.y = y;
    // The APPROACH obeys walls (systems/physics.js's gold-standard slide) — an
    // arc that walks a body through a partition is worse than the teleport it
    // replaced. The SETTLE beats deliberately do NOT collide: the anchor is an
    // authored seat point and a seated body must never be shoved around by the
    // desk/sofa colliders it is sitting in (the same rule peds.js's own sit
    // branch states).
    if (CBZ.collideSlide) { try { CBZ.collideSlide(walkScratch, 0.30, y, y + 1.7, 3); } catch (e) {} }
    place(actor, walkScratch.x, y, walkScratch.z, Math.atan2(dx, dz));
    if (actor.speed != null) actor.speed = WALK_SPD;
    return false;
  }

  // one arc, one frame. Returns true when the whole arc is finished.
  function stepArc(A, dt) {
    const actor = A.actor, rec = A.rec, ch = charOf(actor);
    if (!ch || !ch.group) return true;
    const grp = ch.group;
    let row = A.plan[A.i];
    if (!row) return true;
    const name = row[0];
    let spd = 0;

    // ---- WALK-IN (dynamic length) ----
    if (name === "walk") {
      // Wedged against something for the whole walk leg and still far away.
      // REFUSE, NEVER SNAP: dropping the claim leaves the body where it stalled.
      // (Merely ending the arc would hand it to the pin below, which hard-
      // teleports onto the seat — measured at 4.45m in one frame. That is the
      // exact defect this file exists to delete, so it must not be the failure
      // mode of the fix.)
      if (A.t > WALK_CAP && Math.hypot(A.walkTo.x - grp.position.x, A.walkTo.z - grp.position.z) > 1.6) {
        A.abandon = true;
        return true;
      }
      if (A.skipWalk || guide(actor, A.walkTo.x, A.walkTo.z, rec.y, dt) || A.t > WALK_CAP) {
        A.i++; A.t = 0;
        const g2 = groupOf(actor);
        A.sx = g2.position.x; A.sy = g2.position.y; A.sz = g2.position.z; A.syaw = g2.rotation.y;
        if (A.skipWalk) { A.sx = g2.position.x; A.sz = g2.position.z; }
        return false;
      }
      A.t += dt;
      if (CBZ.animChar) CBZ.animChar(ch, WALK_SPD, dt);
      return false;
    }

    const dur = row[1] || 0.001;
    const u = Math.min(1, A.t / dur);
    const ex = entryX(rec), ez = entryZ(rec);

    switch (name) {
      // ---------- SIT ----------
      case "turn":
        // plant and turn to the seat's facing (you turn your back on the chair)
        place(actor, A.sx, rec.y, A.sz, lerpA(A.syaw, rec.face, eInOut(u)));
        ch.crouch = false; ch.sitting = false;
        break;
      case "lower": {
        // back onto the cushion. The crouch dip carries the weight; the seated
        // pose folds in at 35% so the legs are already bending as the hips land.
        const e = eOut(u);
        place(actor, A.sx + (rec.x - A.sx) * e, rec.y, A.sz + (rec.z - A.sz) * e, rec.face);
        ch.crouch = u > 0.08 && u < 0.55;
        if (u >= 0.35 && !ch.sitting) { ch.sitting = true; ch.seatRef = CBZ.propSeatRef(rec); }
        break;
      }
      // ---------- STAND ----------
      case "push": {
        // ANTICIPATION: still seated, but the torso comes forward over the knees
        // and the head drops — the weight moving onto the feet. A small forward
        // creep off the back of the cushion sells it. The origin is ALWAYS where
        // the body actually is at phase start (A.sx/A.sz), so this beat is
        // identical whether we're leaving a chair or the edge of a bed.
        const e = eInOut(u);
        place(actor, A.sx + (ex - A.sx) * 0.09 * e, rec.y, A.sz + (ez - A.sz) * 0.09 * e, A.outFace);
        ch.sitting = true; ch.crouch = false;
        A.lean = 0.10 + 0.34 * e;
        break;
      }
      case "rise":
      case "riseUp": {
        // THE PUSH: legs extend (crouch → stand blend does the work), body
        // travels forward off the seat. character.js's own _seatSunk recovery
        // damps the model back up out of the cushion over the same beat.
        const e = eOut(u);
        place(actor, A.sx + (ex - A.sx) * e, rec.y, A.sz + (ez - A.sz) * e, A.outFace);
        if (ch.sitting) { ch.sitting = false; ch.seatRef = null; }
        ch.crouch = u < 0.75;
        A.lean = 0.44 * (1 - eInOut(u)) + 0.06;
        spd = 0.6 * (1 - u);
        break;
      }
      case "settle":
        place(actor, ex, rec.y, ez, A.outFace);
        ch.crouch = false; ch.sitting = false;
        A.lean *= 0.6;
        break;
      // ---------- LIE ----------
      case "perch":
      case "edge": {
        // sit on the mattress EDGE, feet on the floor, facing out of the bed.
        // The seat is DESCRIBED, not just measured: a bed anchor carries its
        // own `kind` (a bunk is not a four-poster) and, when something is
        // racked above it, the underside of that rack. entities/character.js
        // turns the pair into a posture and, on a bottom bunk, into the duck
        // that keeps this beat's head out of the steel.
        const sx = rec.hz, sz = -rec.hx;
        const side = ((ex - rec.x) * sx + (ez - rec.z) * sz) >= 0 ? 1 : -1;
        const px = rec.x + sx * side * (0.34), pz = rec.z + sz * side * (0.34);
        const outFace = Math.atan2(sx * side, sz * side);
        const e = eOut(u);
        if (name === "perch") {
          place(actor, A.sx + (px - A.sx) * e, rec.y, A.sz + (pz - A.sz) * e, lerpA(A.syaw, outFace, e));
          ch.crouch = u > 0.06 && u < 0.35;
          if (u >= 0.24 && !ch.sitting) { ch.sitting = true; ch.seatRef = bedSeatRef(rec); }
          grp.rotation.z = 0;
        } else {
          place(actor, px, rec.y, pz, outFace);
          ch.sitting = true; ch.seatRef = bedSeatRef(rec);
          grp.rotation.z = 0;
          // the arc that follows is a plain stand-up FROM the edge: hand the
          // stand phases the perch position and the outward facing so they
          // never reach back for the bed's own centre/lying yaw.
          A.sx = px; A.sz = pz; A.outFace = outFace;
        }
        break;
      }
      case "swing": {
        // legs come up, body rolls flat onto the pillow. Releasing `sitting` at
        // the top of the beat lets the idle pose straighten the legs exactly as
        // the roll carries them off the floor.
        const sx = rec.hz, sz = -rec.hx;
        const side = ((ex - rec.x) * sx + (ez - rec.z) * sz) >= 0 ? 1 : -1;
        const px = rec.x + sx * side * 0.34, pz = rec.z + sz * side * 0.34;
        const e = eInOut(u);
        // Hold the perch a beat into the swing, then hand the rig to the SLEEP
        // pose (entities/character.js, ch.lying) at the same instant the seat
        // is released — the knees never straighten in between, because the two
        // full-rig branches are adjacent in animChar's precedence chain and a
        // lying body outranks a seated one.
        if (ch.sitting && u > 0.16) { ch.sitting = false; ch.seatRef = null; }
        if (u > 0.16 && !ch.lying) setLying(actor);
        ch.crouch = false;
        // The target is the SHARED lie spot, never the anchor itself: the rig's
        // origin is its FEET, so the legs slide down toward the foot end as the
        // roll carries the head onto the pillow (see CBZ.propLiePlace).
        const L = CBZ.propLiePlace(actor, rec);
        place(actor, px + (L.x - px) * e, rec.y + (L.y - rec.y) * e, pz + (L.z - pz) * e,
          lerpA(A.syaw, rec.face, e));
        grp.rotation.z = HALF * e;
        break;
      }
      // ---------- RISE (out of bed) ----------
      case "unroll": {
        // reverse of `swing`: roll up off the pillow onto the edge of the bed.
        const sx = rec.hz, sz = -rec.hx;
        const side = ((ex - rec.x) * sx + (ez - rec.z) * sz) >= 0 ? 1 : -1;
        const px = rec.x + sx * side * 0.34, pz = rec.z + sz * side * 0.34;
        const outFace = Math.atan2(sx * side, sz * side);
        const e = eInOut(u);
        // The body un-curls as it comes up: releasing ch.lying at the TOP of
        // the unroll lets the locomotion damps straighten the knees over the
        // same 0.46s the roll takes, so nobody ever stands up folded.
        ch.sitting = false; ch.crouch = false;
        if (u > 0.10) clearLying(actor);
        const L = CBZ.propLiePlace(actor, rec);          // where the body actually IS
        place(actor, L.x + (px - L.x) * e, L.y + (rec.y - L.y) * e, L.z + (pz - L.z) * e,
          lerpA(rec.face, outFace, e));
        grp.rotation.z = HALF * (1 - e);
        break;
      }
      default: break;
    }

    // rig update — the arc drives animChar itself so the transition animates
    // even while physics.js is handing us the body.
    if (CBZ.animChar) CBZ.animChar(ch, spd, dt);
    // POST-anim absolute writes: the lean is the "weight" in the stand-up and
    // is applied after animChar so it wins the frame (absolute, never additive
    // — the grapple brace-pose lesson).
    if (A.lean) {
      if (ch.body) ch.body.rotation.x = A.lean;
      if (ch.neck) ch.neck.rotation.x = 0.04 + A.lean * 0.28;
      // Publish what we wrote, exactly as character.js's own stance poses do
      // (slidePose/pronePose keep ch.lean in sync and arm ch._stanceNk so the
      // neck recovers). Without this an arc aborted mid-push parks a lean the
      // locomotion path has to walk off — and the KO/death branches blend
      // RELATIVELY from the current value, so a parked lean biases the corpse.
      ch.lean = A.lean;
      ch._stanceNk = 1;
    }

    A.t += dt;
    if (A.t >= dur) {
      A.i++; A.t = 0;
      const g2 = groupOf(actor);
      A.sx = g2.position.x; A.sy = g2.position.y; A.sz = g2.position.z; A.syaw = g2.rotation.y;
      if (A.i >= A.plan.length) return true;
    }
    return false;
  }

  // ---- SIT / STAND ------------------------------------------------------------
  // actor = CBZ.player or a peds.js ped (anything with .char + .pos + .group).
  // opts.instant → the V1 teleport (used by force-exits and by callers that
  // genuinely need the body there this frame).
  CBZ.propSit = function (actor, seat, opts) {
    if (!on() || !actor || !seat || !isFree(seat)) return false;
    if (actor.dead || (actor.ko | 0) > 0 || actor.driving) return false;
    CBZ.propSeatRelease(actor);            // moving off a previous seat/bed
    clearLying(actor);                     // a body that was in a bed is not any more
    seat.occupant = actor;                 // the CLAIM is instant; only the body takes time
    markClaimed(seat);
    actor._propSeat = seat;
    // The rig's real chair solve (entities/character.js): every seat now
    // declares its cushion, so the feet land on the floor instead of the body
    // squatting on top of the cushion. PROPS_SEAT_GEOM=0 restores the legacy fake.
    const seatRef = CBZ.propSeatRef(seat);
    if (actor === CBZ.player) {
      const P = CBZ.player, ch = CBZ.playerChar;
      if (!(opts && opts.instant) && beginArc(actor, "sit", seat)) return true;
      P.pos.set(seat.x, seat.y, seat.z);
      P.vy = 0; P.grounded = true;
      if (ch) { ch.sitting = true; ch.group.rotation.y = seat.face; ch.seatRef = seatRef; }
      return true;                         // the onUpdate(42) hold does the rest
    }
    // NPC: the exact office-worker sit mechanism — peds.js's state==="sit"
    // branch re-pins from _deskAnchor every frame and zeroes speed. The arc
    // (when it runs) only overrides the VISUAL transform for the settle beat,
    // so the brain's bookkeeping is identical either way.
    // carry the DECLARED cushion onto the anchor so peds.js's own sit branch
    // can hand the rig the same solve without knowing anything about seats.
    actor._deskAnchor = {
      x: seat.x, y: seat.y, z: seat.z, face: seat.face, lot: seat.lot, kind: seat.kind,
      cushionH: seat.cushionH, floorBelow: seat.floorBelow,
    };
    actor.state = "sit";
    actor.speed = 0; actor.path = null;
    if (actor.char) { actor.char.sitting = true; actor.char.seatRef = seatRef; }
    if (!(opts && opts.instant) && beginArc(actor, "sit", seat)) return true;
    if (actor.pos && actor.pos.set) actor.pos.set(seat.x, seat.y, seat.z);
    if (actor.group) { actor.group.position.set(seat.x, seat.y, seat.z); actor.group.rotation.y = seat.face; }
    return true;
  };
  CBZ.propStand = function (actor, opts) {
    if (!actor) return;
    const had = actor._propSeat || actor._propBed;
    const seat = actor._propSeat;
    CBZ.propSeatRelease(actor);
    clearLying(actor);
    if (had) actor._deskAnchor = null;     // only clear OUR anchor, never an office desk claim
    if (actor !== CBZ.player && actor.state === "sit") actor.state = "walk";
    if (!(opts && opts.instant) && seat && beginArc(actor, "stand", seat)) return;
    dropArc(actor);
    if (actor === CBZ.player) {
      const ch = CBZ.playerChar;
      if (actor._propOwnsBody) { actor._doorArc = false; actor._propOwnsBody = false; }
      if (ch) { ch.sitting = false; ch.seatRef = null; ch.crouch = false; ch.group.rotation.z = 0; ch.group.rotation.x = 0; }
      CBZ.player.stun = 0;
      return;
    }
    if (actor.char) { actor.char.sitting = false; actor.char.seatRef = null; actor.char.crouch = false; if (actor.group) { actor.group.rotation.z = 0; } }
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
    if ((P.hp | 0) < cap) { P.hp = cap; out = " Rough sleep — patched up, not fixed."; }
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
    CBZ.propSeatRelease(actor);
    bed.occupant = actor;
    markClaimed(bed);
    actor._propBed = bed;
    if (actor === CBZ.player) {
      const P = CBZ.player, ch = CBZ.playerChar;
      if (!(opts && opts.instant) && beginArc(actor, "lie", bed)) { arcOf(actor).onDone = bedDown; return true; }
      const L = CBZ.propLiePlace(P, bed, {});   // own object: outlives the shared scratch
      P.pos.set(L.x, L.y, L.z);
      P.vy = 0; P.grounded = true;
      if (ch) { ch.sitting = false; ch.group.position.set(L.x, L.y, L.z); ch.group.rotation.y = bed.face; }
      setLying(actor);
      // The heal + the trespass risk ride inside bedDown → restPayoff
      // (INTERIOR_SLEEP_STAKES); the owned-safehouse sleepHeal is still the
      // one special FULL reset, and an owned bed here changes nothing.
      bedDown(actor, bed);
      return true;
    }
    // NPC lie-down: sit-state pin at the SHARED lie spot + the roll flag; the
    // per-frame roll is applied by the hold below (peds' sit branch owns x/z,
    // and it re-pins from this anchor every frame — so the anchor must be where
    // the body lies, not the mattress centre it used to be).
    const LN = CBZ.propLiePlace(actor, bed, {});   // own object: outlives the shared scratch
    actor._deskAnchor = { x: LN.x, y: LN.y, z: LN.z, face: bed.face, lot: bed.lot };
    actor.state = "sit";
    actor.speed = 0; actor.path = null;
    actor._propLie = true;
    if (actor.char) actor.char.sitting = false;
    if (!(opts && opts.instant) && beginArc(actor, "lie", bed)) return true;
    if (actor.pos && actor.pos.set) actor.pos.set(LN.x, LN.y, LN.z);
    if (actor.group) { actor.group.position.set(LN.x, LN.y, LN.z); actor.group.rotation.y = bed.face; }
    setLying(actor);
    return true;
  };
  CBZ.propWake = function (actor, opts) {
    if (!actor) return;
    const bed = actor._propBed;
    CBZ.propSeatRelease(actor);
    if (!(opts && opts.instant) && bed && beginArc(actor, "rise", bed)) {
      actor._propLie = false;
      actor._deskAnchor = null;
      // ch.lying stays live for the first tenth of the unroll and is released
      // inside that beat — the body must not snap straight the instant the
      // verb is pressed, it has to un-curl as it rolls up.
      if (actor !== CBZ.player && actor.state === "sit") actor.state = "walk";
      return;
    }
    dropArc(actor);
    clearLying(actor);
    if (actor === CBZ.player) {
      const ch = CBZ.playerChar;
      if (actor._propOwnsBody) { actor._doorArc = false; actor._propOwnsBody = false; }
      if (ch) { ch.sitting = false; ch.seatRef = null; ch.crouch = false; ch.group.rotation.z = 0; ch.group.rotation.x = 0; }
      CBZ.player.stun = 0;
      return;
    }
    actor._propLie = false;
    actor._deskAnchor = null;
    if (actor.state === "sit") actor.state = "walk";
    if (actor.char) { actor.char.sitting = false; actor.char.seatRef = null; actor.char.crouch = false; }
    if (actor.group) actor.group.rotation.z = 0;
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

     REFUSE, NEVER SNAP (this file's house rule, ARC_MAX): the radius is
     CLAMPED to what the lie arc can honestly walk. Beyond it propSleep would
     fall through to the instant commit and teleport a body into a bed across
     the room, which is the exact defect the arc engine exists to delete — so
     a far bed simply isn't offered, and the caller tries again next sweep
     from wherever the ped's own brain has wandered to. Returns the bed taken,
     or null. Degrade-safe: never throws, never leaves a broken ped. */
  CBZ.propBedNpc = function (ped, radius) {
    if (!on() || !ped || ped === CBZ.player || !ped.pos || !ped.group) return null;
    if (ped.dead || ped.driving || (ped.ko | 0) > 0) return null;
    if (ped._npcAttached || ped._propBed || ped._propSeat || ped._propLie) return null;
    const r = Math.min(radius || 6, ARC_MAX);
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
    for (let i = 0; i < claimed.length; i++) {
      const o = claimed[i].occupant;
      if (o && o !== CBZ.player && o.char && o.char.lying) sleepers++;
    }
    return {
      seats: seats.length, beds: beds.length, noGeom: noGeom, blocked: blocked,
      sleepers: sleepers, postured: postured,
    };
  };

  // ---- the DEAD-MAN SWITCH ----------------------------------------------------
  // The hold below is an onUpdate, so it only runs while g.state === "playing".
  // An arc owns the player's body through `_doorArc` (systems/physics.js's early
  // return) — if the state leaves "playing" mid-transition (pause, menu, death
  // screen, mode change) the hold would never run again and the flag would
  // strand the player permanently un-simulated. onAlways runs regardless of
  // state, so this is the one place that can always let go. Cheap: one truthy
  // check per frame in the common case.
  if (CBZ.onAlways) CBZ.onAlways(52, function () {
    if (!arcs.length) return;
    const g = CBZ.game;
    if (g && g.state === "playing") return;      // the hold owns it, nothing to do
    for (let i = arcs.length - 1; i >= 0; i--) {
      const A = arcs[i];
      endArc(A);
      const ch = charOf(A.actor);
      if (ch) {
        ch.crouch = false;
        if (A.kind === "stand" || A.kind === "rise") { ch.sitting = false; ch.seatRef = null; ch.lying = null; }
        if (ch.group && (A.kind === "stand" || A.kind === "rise")) { ch.group.rotation.z = 0; ch.group.rotation.x = 0; }
      }
    }
    arcs.length = 0;
  });

  // ---- the per-frame HOLD -----------------------------------------------------
  // onUpdate(42): AFTER physics (10, writes player.pos/group), peds.js's brain
  // (34, which re-pins seated NPCs) and the interaction scan (39), BEFORE the
  // camera reads the group (onAlways 50) — so both the arc and the pin win the
  // frame. Runs only while g.state === "playing".
  if (CBZ.onUpdate) CBZ.onUpdate(42, function (dt) {
    const P = CBZ.player || null, ch = CBZ.playerChar || null, g = CBZ.game;
    /* THE GUARD USED TO BE `if (!P || !ch) return`, AND IT GATED THE WHOLE
       UPDATER — every NPC's transition arc and every NPC's seat/bed hold —
       ON THE PLAYER'S OWN RIG EXISTING. In the city that is always true and
       the bug is invisible. Anywhere else it is fatal and SILENT: nothing
       throws, nothing logs, `CBZ.propArcActive` simply latches true forever,
       so systems/rest.js (which correctly refuses to touch a body mid-arc)
       deadlocks and no NPC ever sits or lies down again. Measured in
       games/night-watch.html, whose player is a plain object with no
       CBZ.playerChar: a night porter stood beside his cot for the whole of a
       260-second museum day with inTransition() true the entire time.

       Sections 1 and 2 below need no player at all — they walk `arcs` and
       `claimed`. Section 3 is the player pin and already returns unless the
       PLAYER holds a seat or a bed. So the guard is now "is there anything to
       do", and P/ch are dereferenced only behind the checks that imply them. */
    if (!arcs.length && !claimed.length && !(P && (P._propSeat || P._propBed))) return;
    // NOTE: the `on()` gate lives INSIDE the loop below, never above it.
    // Flipping PROPS_PURPOSE off mid-arc used to skip the whole updater, which
    // left the arc un-advanced and `_doorArc` latched true forever — the
    // documented one-line revert was a hard player freeze. The revert now
    // ABORTS live arcs instead of orphaning them.

    // ---- 1. advance every live transition -------------------------------
    for (let i = arcs.length - 1; i >= 0; i--) {
      const A = arcs[i];
      const actor = A.actor;
      // an arc never survives the body being claimed by something bigger
      const bad = !on() || !g || g.state !== "playing" || g.mode !== A.mode
        || actor.dead || (actor.ko | 0) > 0 || actor.driving || actor._death
        || (A.isP && (P._aircraft || P._swim))            // another mount claimed the body
        || (A.isP && ((P._phys && (P._phys.air || (P._phys.down | 0) > 0)) || (CBZ.cineActive && CBZ.cineActive())))
        || (A.isP && P._doorArcOwner && P._doorArcOwner !== "prop")   // someone else took the body
        || (A.isP && CBZ.aircraftDoorArc && CBZ.aircraftDoorArc.active) // a boarding beat started: yield
        || (!A.isP && isStale(actor));
      if (bad) {
        // An abandoned arc must never leave a half-posed body behind: clear
        // every rig flag it could have set, then drop any claim it was mid-way
        // through making. Absolute writes only — nothing to unwind.
        endArc(A);
        const cb = charOf(actor);
        if (cb) {
          cb.sitting = false; cb.seatRef = null; cb.crouch = false; cb.lying = null;
          if (cb.group) { cb.group.rotation.z = 0; cb.group.rotation.x = 0; }
        }
        if (actor._propSeat) CBZ.propStand(actor, { instant: true });
        else if (actor._propBed) CBZ.propWake(actor, { instant: true });
        continue;
      }
      let done = false;
      try { done = stepArc(A, dt); } catch (e) { done = true; }
      // the stun top-up holds the body still DURING the arc — it must not be
      // re-applied on the frame the arc completes, or a stand-up hands control
      // back 0.15s late (and the `P.stun = 0` below was silently overwritten).
      if (A.isP && !done) { P.vy = 0; P.grounded = true; P.stun = Math.max(P.stun || 0, 0.15); }
      if (done) {
        endArc(A);
        if (A.abandon) {                    // the body never reached the furniture
          if (actor._propSeat) CBZ.propStand(actor, { instant: true });
          else if (actor._propBed) CBZ.propWake(actor, { instant: true });
          continue;
        }
        if (A.onDone) { try { A.onDone(actor, A.rec); } catch (e) {} }
        if (A.kind === "stand" || A.kind === "rise") {
          const c2 = charOf(actor);
          if (c2) { c2.sitting = false; c2.seatRef = null; c2.crouch = false; c2.lying = null; if (c2.group) { c2.group.rotation.z = 0; c2.group.rotation.x = 0; } }
          if (actor === P) P.stun = 0;
        }
      }
    }

    const pArc = P ? arcOf(P) : null;
    const seat = P ? P._propSeat : null, bed = P ? P._propBed : null;

    // ---- 2. NPC holds ---------------------------------------------------
    // These used to sweep EVERY seat and EVERY bed in the world once a frame
    // looking for occupants — thousands of records, almost always none of them
    // claimed. `claimed` is the short list of records that actually have an
    // occupant, compacted in place as claims lapse, so the common case is a
    // zero-length loop.
    for (let i = claimed.length - 1; i >= 0; i--) {
      const rec = claimed[i], o = rec.occupant;
      if (!o || isStale(o)) { claimed.splice(i, 1); continue; }
      if (o === P || arcOf(o)) continue;
      if (rec.lieY != null) {
        // peds' own sit branch pins x/z + yaw but forces char.sitting=true and
        // y=0 every frame — re-pin the body onto the mattress and apply the
        // roll AFTER peds ran (this updater is later in the order). Never
        // touch an ATTACHED body: npclife's seat re-assert owns that
        // transform, and a lie-pin fighting it is exactly the class of
        // unguarded world-space write syncAttached exists to defend against.
        if (o._propLie && o.group && !o._npcAttached) {
          // The WHOLE transform, off the same solve the player pin uses — an NPC
          // whose _deskAnchor was cleared by another system would otherwise be
          // left lying at whatever x/z it last held.
          const L = CBZ.propLiePlace(o, rec);
          if (o.pos && o.pos.set) o.pos.set(L.x, L.y, L.z);
          o.group.position.set(L.x, L.y, L.z);
          o.group.rotation.z = Math.PI / 2;
          if (o.char) o.char.sitting = false;
          // Re-assert the sleep pose here, AFTER peds.js's own sit branch has
          // run (34) and forced char.sitting — the same reason the transform
          // is re-pinned at this order. A body someone else re-posed mid-night
          // is back asleep on the next frame instead of lying to attention.
          if (!o.char || !o.char.lying) setLying(o);
        }
      } else if (geomOn() && o.char && o.char.sitting && !o.char.seatRef) {
        // a seated NPC whose seat DECLARED its geometry gets the real chair
        // solve; an undeclared one gets null back and keeps the legacy pose.
        o.char.seatRef = CBZ.propSeatRef(rec);
      }
    }
    if (pArc || (!seat && !bed)) return;

    // ---- 3. the player pin ----------------------------------------------
    // force-exit: anything else claiming the body wins (shot, KO'd, died,
    // thrown, entered a car, a cutscene grabbed the camera, mode change).
    if (!g || g.mode !== "city" || g.state !== "playing"
        || P.dead || (P.ko | 0) > 0 || P.driving || P._death
        || (P._phys && (P._phys.air || (P._phys.down | 0) > 0))
        || (CBZ.cineActive && CBZ.cineActive())) {
      if (seat) CBZ.propStand(P, { instant: true }); else CBZ.propWake(P, { instant: true });
      return;
    }
    const a = seat || bed;
    const l = a.lot || (a._lotR ? null : lotOf(a));
    if (l && l.demolished) {               // the building came down around you
      if (seat) CBZ.propStand(P, { instant: true }); else CBZ.propWake(P, { instant: true });
      return;
    }
    // A seat is pinned AT its anchor; a bed is not — the lying rig's origin is
    // its feet, so the one solve in CBZ.propLiePlace owns the spot (identical
    // call to the NPC hold above: the two bodies cannot diverge again).
    let lx = a.x, ly = a.y, lz = a.z;
    if (!seat) { const L = CBZ.propLiePlace(P, a); lx = L.x; ly = L.y; lz = L.z; }
    P.pos.set(lx, ly, lz);
    P.vy = 0; P.grounded = true;
    ch.group.position.set(lx, ly, lz);
    ch.group.rotation.y = a.face;
    if (seat) {
      ch.sitting = true;
      if (!ch.seatRef) ch.seatRef = CBZ.propSeatRef(a);
    } else {
      ch.sitting = false;
      if (!ch.lying) setLying(P);        // the sleep pose, re-asserted like the transform
      // damp the roll toward the lie — matches physics.js's own rotation.z
      // ease so waking/KO transitions never pop. The ORIENTATION is still
      // this roll; entities/character.js poses the body INSIDE it, so the two
      // never fight over the same channel.
      const k = 1 - Math.exp(-10 * (dt || 0.016));
      ch.group.rotation.z += (Math.PI / 2 - ch.group.rotation.z) * k;
      ch.group.rotation.x = 0;
    }
    // stun top-up: physics zeroes WASD + blocks jump while stun > 0 (the
    // drinking.js piggyback idiom) — no new freeze flag. The interact panel
    // ignores stun, so "Stand up" stays live.
    P.stun = Math.max(P.stun || 0, 0.15);
  });
})();
