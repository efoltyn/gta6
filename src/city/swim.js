/* ============================================================
   city/swim.js — BEING IN THE WATER (the WATER V2 swimmer).

   The city is ringed by ocean and the shoreline is a real signed field
   (city/waterfield.js), so leaving land has to put you IN the water — not
   standing on an invisible floor under a blue plane. It always did that
   much. What it did NOT do was feel like water:

     • the body's altitude was ASSIGNED (`P.pos.y = seaY - 1.28`) with a
       hardcoded sine bob and `P.vy = 0` every frame — no buoyancy, no
       momentum, nothing to dive with;
     • "in water" was a BOOLEAN, so wading off a beach snapped you from a
       6.4 m/s sprint into a 0.9 m/s paddle in one frame;
     • there was no vertical axis at all — you could not go under;
     • air was P.stamina, the same bar combat and sprinting spend, drained
       at 16.5/s and called drowning.

   THIS FILE NOW OWNS FOUR THINGS.

   1. GRADUATED SUBMERGENCE, NOT A FLAG. Every water decision reads a 0..1
      scalar `sub = clamp01((surfaceY - feetY) / BODY_H)` and derives
      `swimFactor = min(1, sub / SWIM_BLEND)` from it. Control, speed and
      drag are BLENDED by that factor, so wading into a beach slows you
      progressively instead of toggling a state. There is no frame where
      you are "half in" and behaving like you are fully out.

   2. REAL DYNAMICS. The swimmer carries its own velocity. Every frame:
      drag first (`v *= 1 - WATER_DRAG * sub * dt`), THEN stroke
      acceleration toward the desired velocity, capped by SWIM_ACCEL — so
      you glide when you let go and you keep the momentum you brought in
      off a bridge. Vertically it is a damped buoyancy oscillator around
      the live wave surface (`vy += G_WATER * (BUOYANCY * sub - 1) * dt`,
      `vy *= exp(-VDRAG * dt)`), which is unconditionally stable at any dt
      and self-centres on the float line: the head genuinely rides above
      and below the waterline as swells roll under you, and a dive comes
      back up on its own because a human body is positively buoyant.

   3. A VERTICAL AXIS. Hold the crouch key (Ctrl/C — free while swimming,
      the stance machine stands down) to dive, hold Space to rise. Both
      are acceleration-limited approaches, never instant. Depth is capped
      by waterfield's bathymetry so you cannot swim through the seabed.

   4. BREATH, NOT STAMINA. `P.breath` is its own resource (seconds of air,
      BREATH_MAX ≈ 28s — GTA V's published base) and only drains while the
      HEAD is actually under. It refills fast at the surface. Stamina still
      pays for hard strokes (the existing sprint economy in city/mode.js
      already drains it — we only cancel the idle regen), so tiring out and
      running out of air are finally two different things. Damage routes
      through the ONE pipeline, `CBZ.cityHurtPlayer(.., "drowned", ..)` —
      the substring "drown" is load-bearing for city/death.js's wound
      filter and modes/survival.js's feed colouring.

   HOW THIS COOPERATES WITH systems/physics.js (which we never edit): the
   main pass runs at order 45.8, AFTER movement/collision and BEFORE the
   camera (50) and the rigs read positions, so the water owns the final
   altitude and pose for the frame. Horizontal INTENT is recovered from
   the displacement physics applied this frame (pos - lastPos), which is
   why we anchor `lastX/lastZ` at the end of every pass. A second, tiny
   pass at order 9.9 runs just BEFORE physics purely to catch a fall into
   the sea: the walkable floor is flat y=0 EVERYWHERE over open water
   (only registered landmasses raise it), so physics would otherwise land
   a bridge dive on that phantom floor and bill it as fall damage. We take
   the entry a beat early, bank the impact speed as plunge momentum and
   zero `_fallPeak`.

   NEIGHBOUR SEAM — anything that needs to know about the swimmer (shark
   and predator AI, missions, HUD) should call ONE function:

       CBZ.citySwimState()  ->  { swimming, submergence, depth, breath,
                                  diving, treading, x, y, z,
                                  surfaceY, headUnder, speed }

   It is allocation-free (one reused object) and safe to call every frame
   from anywhere. `CBZ.citySwimming()` (bool) and the `CBZ.cityWaterAt`
   fallback are kept unchanged because other files already call them.

   FLAGS (all default ON, each an independent one-line revert):
     WATER_SWIM_V2 — the dynamics above. OFF -> the exact legacy direct-Y
                     swim, kept intact below as legacyStep().
     WATER_BREATH  — the breath meter. OFF -> the legacy stamina-as-air.
     WATER_DIVE    — the vertical axis. OFF -> you stay at the surface.
   `CFG.WATER_V2 === false` (world/water_spec.js) stands all three down.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});

  // ---- FLAGS ---------------------------------------------------------------
  // WATER_SWIM_V2 (owner: "water that is real to be IN"). ON → graduated
  // submergence, carried velocity + drag, buoyancy instead of an assigned Y,
  // momentum-preserving water entry, two animation moods.
  // Flip false (or ?cfg_WATER_SWIM_V2=0) for the exact prior swim.
  if (CFG.WATER_SWIM_V2 == null) CFG.WATER_SWIM_V2 = true;
  // WATER_BREATH. ON → P.breath is its own air meter; drowning damage starts
  // only after it empties and only while the head is under. OFF (or
  // ?cfg_WATER_BREATH=0) → the legacy behaviour: swimming drains P.stamina at
  // DRAIN/s and an empty stamina bar is what drowns you.
  if (CFG.WATER_BREATH == null) CFG.WATER_BREATH = true;
  // WATER_DIVE. ON → Ctrl/C dives, Space rises, depth capped by bathymetry.
  // OFF (or ?cfg_WATER_DIVE=0) → the swimmer is pinned to the surface as before.
  if (CFG.WATER_DIVE == null) CFG.WATER_DIVE = true;
  // WATER_BOARD_BOATS. ON → a floating hull in reach is a way OUT of the water:
  // the same "[Space] climb out" haul-up that gets you onto a quay also gets you
  // aboard a boat, over its transom. OFF → boats are not offered and the
  // haul-out considers only static land, exactly as before.
  //
  // WHY THIS EXISTS: every existing climbSpot() candidate is a piece of STATIC
  // land — the city quay, the bridge, the annex, a registered region shore. Swim
  // out to your own moored yacht and there was no way aboard at all; you could
  // buy a hull and then tread water beside it. A boat is also the first spot in
  // this function that can MOVE, which is why the record it returns carries its
  // own landing height and a hull reference instead of assuming CBZ.floorAt.
  if (CFG.WATER_BOARD_BOATS == null) CFG.WATER_BOARD_BOATS = true;
  // ---- SWIM_SINK -----------------------------------------------------------
  // OWNER, verbatim: "WHEN IN WATER, YOU SHOULD SINK UNLESS PRESSING SPACE TO
  // GO TO SURFACE, LIKE HOW GTA WORKS."
  //
  // Everything the sink model needs was ALREADY HERE and is reused untouched:
  // the damped vertical oscillator, the bathymetry floor clamp, the 28 s breath
  // meter, the drown routing through cityHurtPlayer("drowned") — which is what
  // puts a drowning in city/death.js's wound filter and therefore in
  // killfeed.js's player-death wrap. This flag changes exactly ONE thing: the
  // sign of the body's resting buoyancy. OFF → the body is positively buoyant
  // and floats at FLOAT_SUB with its head clear (every prior behaviour). ON →
  // the body is NEGATIVELY buoyant, so it settles under on its own, and SPACE
  // is what holds you up.
  //
  // WHY THIS IS NOT MERELY CRUEL: the vertical axis was already there (Space
  // rose, Ctrl dived) but it had nothing to fight, so water had no depth as a
  // decision. With a sink rate, staying at the surface is an ACT, the breath
  // meter finally means something (you go under because you stopped swimming,
  // not only because you chose to), and going down deliberately costs nothing
  // extra — you just stop pressing. The sink is deliberately slower than the
  // ascent (0.85 vs 2.0 m/s) so Space always wins, immediately, from any depth.
  if (CFG.SWIM_SINK == null) CFG.SWIM_SINK = true;
  // SWIM_CHUM — a wounded swimmer bleeds into the water and sharks smell it.
  // One-line revert: false and the goreChum handle is never opened, which is
  // byte-identical to the behaviour before this existed.
  if (CFG.SWIM_CHUM == null) CFG.SWIM_CHUM = true;

  function v2On() { return CFG.WATER_SWIM_V2 !== false && CFG.WATER_V2 !== false; }

  // ---- BODY + WATER CONSTANTS ---------------------------------------------
  const BODY_H = 1.7;          // matches physics.js BODY_H — the submergence unit
  const EYE_H = 1.55;          // head/eye height above P.pos.y (the feet)
  const CHEST_H = 0.95;        // where "depth" is measured from, for predators
  // Resting depth of the feet below the surface: the body floats with the head
  // and shoulders clear. 1.275 = 0.75 of a body height, which makes the resting
  // submergence 0.75 — the equilibrium the buoyancy term below is tuned to.
  const FLOAT_DEPTH = 1.275;
  const FLOAT_SUB = FLOAT_DEPTH / BODY_H;          // 0.75
  const BUOYANCY = 1 / FLOAT_SUB;                  // 1.333 — net lift at full submergence
  // How far ABOVE the live surface you can still be and count as entering.
  // (Kept from the previous implementation: it is the old absolute `y <= 0.6`
  // expressed relative to mean sea level, so calm-water behaviour is unchanged.)
  const WADE_ABOVE = 1.08;
  const QUAY = 28;             // land extends this far past the road grid (world.js)

  // ---- BOARDING A HULL FROM THE WATER -------------------------------------
  // The boarding point on any boat is the TRANSOM / swim platform — the one
  // place on a hull that sits at water level, and on a real motor yacht it is
  // literally the embarkation point (the tender ties up there). So we offer the
  // stern and land you a step FORWARD of it, in the cockpit, rather than on the
  // platform lip where the next swell would wash you back off.
  const BOARD_REACH = 3.2;     // m from the transom you can reach up and haul in
  const BOARD_MAX_V = 3.0;     // m/s — you cannot board a hull that is under way
  const BOARD_STEP_IN = 0.9;   // m forward of the transom the landing sits
  // Generic moving-deck probe (a pontoon, a gangway, a yacht's side deck).
  const DECK_PROBE_R = 2.4;    // m out from the swimmer the ring is sampled at
  const DECK_PROBES = 8;       // ring samples — 45deg apart
  const DECK_REACH_UP = 1.9;   // m above the LIVE surface you can still haul up
                               // onto. Higher than this needs a ladder, and a
                               // superyacht's main deck is deliberately out of
                               // reach — you board it over the swim platform.

  // "Is this vehicle a boat" is written out identically in city/vehicles.js
  // (isMarineCar) and world/water_buoyancy.js (isMarine). world/water_hulls.js
  // publishes the single shared predicate; we consume THAT and keep the same
  // body inline as the degrade-safe fallback, so this file never adds a fourth
  // independent copy of the test.
  // ---- STANDING ON SOMETHING THAT FLOATS ----------------------------------
  // The wade test claims you the moment your feet drop below the LIVE surface
  // plus WADE_ABOVE. That is correct over open water and wrong the instant you
  // are standing on something floating ON it: a boat's cockpit sole sits only
  // ~0.7m over mean sea level, so the first swell crest that rolls under a
  // moored hull raises `surf` past your feet and the water claims a player who
  // is plainly standing on a deck — you would get dragged off your own yacht
  // every few seconds. Same for a marina's floating pontoon, which by
  // definition tracks the water it is floating on.
  //
  // The general answer, not a boat special case: if a moving-platform rig is
  // currently carrying you (systems/platforms_moving.js), a DECK owns your feet
  // this frame and the water does not get a vote. Feature-detected — with that
  // module absent this is always false and every water decision is byte-
  // identical to before.
  function onFloatingDeck() {
    return !!(CBZ.movingPlatformRiding && CBZ.movingPlatformRiding());
  }

  function marineHull(car) {
    if (CBZ.isMarineHull) return !!CBZ.isMarineHull(car);
    if (!car) return false;
    const feel = car._playerCarFeel;
    if (feel) return !!feel.marine;
    return !!(car.model && car.model.body === "boat");
  }

  // Water column depth model near the coast. The rendered world has NO
  // queryable submerged geometry — the continent plate carves a seabed into
  // its vertices but CBZ.cityGroundHeightAt clamps every provider at 0, and
  // waterfield's own depthAt already starts at 1.1m AT the waterline. So the
  // wade band is synthesised from waterfield's signed shore distance:
  // SHELF_SLOPE metres of depth per metre out, capped by that bathymetry.
  // KEPT DELIBERATELY NARROW (~1.2m of wading): the same shore field describes
  // a vertical harbour seawall as well as a beach, and a wide synthetic shelf
  // would let you "stand" in open water beside a quay. The haul-out prompt is
  // therefore offered in the wade band too, so the seawall escape never
  // depends on being in the swim state.
  const SHELF_SLOPE = 1.10;    // ~1.2m of wading before you are off your feet
  const SWIM_DEPTH = 1.35;     // water this deep and you are swimming, not wading
  const STAND_DEPTH = 1.05;    // shallower than this and you get your feet back
  const SWIM_BLEND = 0.5;      // submergence at which control is FULLY aquatic

  // ---- SWIM DYNAMICS -------------------------------------------------------
  // Drag is what kills the floaty feel: applied BEFORE the stroke every frame,
  // so releasing the stick is a glide with a ~0.75s time constant rather than a
  // dead stop, and a sprint carried off a quay bleeds off in the water.
  const WATER_DRAG = 1.35;     // 1/s at full submergence
  const SWIM_ACCEL = 7.0;      // m/s^2 — how hard the stroke can change velocity
  const SWIM_SPEED = 1.35;     // m/s cruise (a real steady front crawl)
  const SWIM_SPEED_FAST = 2.15;// m/s while holding shift (costs stamina, below)
  const WADE_SLOW = 0.58;      // fraction of the walk step removed at full wade
  // Vertical. G_WATER is deliberately NOT the world's cartoon gravity (22):
  // everything underwater is slower, and this pairs with VDRAG to give a
  // ~2.4s bob period at damping ratio ~0.5 — an underdamped settle that reads
  // as a body riding a swell instead of a lift arriving at a floor.
  const G_WATER = 9.0;
  const VDRAG = 2.6;           // 1/s exponential damping on vertical velocity
  const DIVE_SPEED = 2.2, DIVE_ACCEL = 4.5;   // m/s, m/s^2 downward kick
  const RISE_SPEED = 2.0, RISE_ACCEL = 5.0;   // m/s, m/s^2 upward kick
  const DIVE_BUOY = 0.30;      // lungs emptied: buoyancy scale while actively diving
  // ---- SWIM_SINK numbers ---------------------------------------------------
  // SINK_BUOY < 1 makes the resting equilibrium UNREACHABLE (buoy*sub can never
  // reach 1, because sub caps at 1), so the body carries a steady net downward
  // acceleration instead of oscillating about a float line.
  //
  // THE NUMBER IS DERIVED, NOT PICKED. Terminal sink speed is where that
  // acceleration balances the VDRAG damping this file already runs:
  //     v_inf = G_WATER * (1 - SINK_BUOY) / VDRAG
  // A real human body is only slightly denser than water once the lungs are
  // emptied (~1005-1070 kg/m3 against 1025 for seawater), which is why a
  // passive body descends at a few tenths of a m/s and a streamlined freediver
  // in the "free fall" phase below neutral buoyancy reaches about 1.0-1.4 m/s.
  // 0.85 m/s sits between those: a swimmer who has stopped swimming, not a
  // stone. Solving for it: SINK_BUOY = 1 - 0.85*VDRAG/G_WATER = 1 - 0.2456
  // = 0.7544.
  //
  // AND IT IS A REACTION BEAT, WHICH MATTERS MORE THAN THE TERMINAL SPEED. The
  // solve is exponential with time constant 1/VDRAG = 0.38 s, so from the float
  // line the head (0.28 m of freeboard) does not go under for ~0.85 s, and the
  // 28 s breath tank starts only then. Sinking is a state you notice and can
  // answer, not a punishment.
  const SINK_BUOY = 0.7544;
  // Holding Space does not merely accelerate you up, it restores POSITIVE
  // buoyancy — so at the surface you HOLD there instead of porpoising out of
  // the water and dropping back. Same number the float model always used.
  const SURFACE_BUOY = BUOYANCY;
  const BED_CLEAR = 0.35;      // never let the feet go below the bed by more than this
  const ENTRY_KEEP = 0.45;     // fraction of the fall speed kept as plunge momentum
  const ENTRY_MAX = 6.5;       // m/s cap on that plunge (a bridge dive, not a torpedo)
  const ENTRY_HMAX = 4.0;      // m/s cap on the horizontal momentum carried in
  const FALL_GUARD = 3.0;      // metres above the surface at which we claim the fall
  const TELEPORT_V = 14;       // m/s of applied step above which we assume a teleport

  // ---- BREATH --------------------------------------------------------------
  const BREATH_MAX = 28;       // seconds of air (GTA V's published base ~25-30s)
  const BREATH_REFILL = 9.0;   // seconds-of-air recovered per second at the surface
  const BREATH_WARN = 0.30;    // fraction at which the warning starts flashing
  const DROWN_GRACE = 1.2;     // soft-fail window after the air runs out
  const DROWN_DPS = 6;         // hp/s once that window closes (applied per second)
  // The legacy (WATER_BREATH=0) numbers, unchanged.
  const DRAIN = 16.5;          // stamina/s — beats mode.js's 14/s regen by ~2.5
  const DROWN = 5;             // hp/s once the tank is empty
  // Swimming should tire you even when you are not sprinting. mode.js regens
  // 14/s whenever P.sprint is false, so this only has to cancel it and leave a
  // slow bleed; holding shift already drains 24/s through the existing sprint
  // economy (physics.js sets P.sprint at order 10, mode.js spends it at 31 —
  // we do not need, and must not add, a second drain for that).
  const SWIM_TIRE = 15;

  // ---- STATE ---------------------------------------------------------------
  let swimming = false;
  let px = 0, pz = 0;                  // last pass's position (the intent anchor)
  const S = {
    vx: 0, vz: 0, vy: 0,               // the swimmer's own velocity
    y: 0,                              // the altitude we own
    stroke: 0, tread: 0, mood: 0,      // animation phases + the glide/tread blend
    sub: 0, surf: 0, bed: 0,           // last sampled submergence / surface / depth
    diving: false, treading: false, headUnder: false, sinking: false,
    hurtT: 0, drownT: 0, gaspAt: -9e9,
  };
  let drownDeaths = 0;          // SWIM_SINK ratchet: real drownings this session
  let breath = BREATH_MAX;
  let climbPress = false;              // consumed keydown/tap edge (see below)
  // The live haul-out offer, refreshed by climbStep and read by publish(). ""
  // means "no way out in reach"; otherwise it is the worded verb ("Climb out" /
  // "Climb aboard"), because WHERE the haul-up puts you is the thing the label
  // has to say when a quay and a moored hull are both within arm's length.
  let climbVerb = "";
  let touchVert = 0, touchVertT = -9;  // touch-driven dive/rise, with a stale sweep
  const swimCurrent = { x: 0, z: 0 };

  /* ============================================================
     THE DISASTER ISLAND IS WATER TOO (SURV_SHARED_SWIM).

     This module was gated to `g.mode === "city"` for its whole life, so the
     survival mode — the one whose headline event is a TSUNAMI — had no
     swimmer at all. systems/disasters.js had therefore hand-rolled a second
     one: a private buoyancy step, stamina-as-air, a duplicate stroke pose at
     order 46.5, and an 18 hp/s damage-over-time on anyone standing in more
     than 1.5 m of water. The owner's verdict on that was "when in water you
     just insta die it's so dumb", and he was describing a DOT with no breath
     meter, no surface to reach for and no decision in it.

     Nothing here is re-implemented for the island. The arena publishes the
     same three answers the city's waterfield publishes — CBZ.survSeaHeightAt
     (the shared swell table), CBZ.survFloodDepthAt, CBZ.survWaterAt — and the
     four seams below route to them. Everything else (graduated submergence,
     carried velocity, the buoyancy oscillator, SWIM_SINK, the 28 s breath
     tank, the climb-out) is the code the city already runs, untouched.

     SURV_SHARED_SWIM=false restores the old gate: no swimmer on the island.
     ============================================================ */
  if (CFG.SURV_SHARED_SWIM == null) CFG.SURV_SHARED_SWIM = true;
  function survOn() {
    return CFG.SURV_SHARED_SWIM !== false && g.mode === "survival" &&
      !!(CBZ.surv && CBZ.surv.arena && CBZ.survSeaHeightAt);
  }
  // A descriptor with the shape the rest of this file expects. `minX` must be
  // finite (every gate tests `A.minX == null`); the rect is the island's own
  // bounding box, and `surv` is what routes the four seams below.
  const _survA = { surv: true, minX: 0, maxX: 0, minZ: 0, maxZ: 0, A: null };
  function survArena() {
    const A = CBZ.surv.arena, c = A.center, r = A.radius;
    _survA.A = A;
    _survA.minX = c.x - r; _survA.maxX = c.x + r;
    _survA.minZ = c.z - r; _survA.maxZ = c.z + r;
    return _survA;
  }
  function arena() {
    if (survOn()) return survArena();
    return g.mode === "city" ? (CBZ.city && CBZ.city.arena) : null;
  }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  /* DROWNING GOES THROUGH THE MODE'S OWN DEATH PIPELINE, and there is exactly
     one of those per mode. In the city that is cityHurtPlayer -> death.js ->
     cityKillPlayer (which killfeed.js wraps). On the island it is
     CBZ.surv.hurt, which owns placement, the ragdoll death-cam and the
     spectate handover — routing an island drowning through cityHurtPlayer
     would kill the player without any of that. The CAUSE STRING is identical
     either way, because "drown" is what city/death.js's wound filter and
     modes/survival.js's feed colouring both pattern-match on. */
  /* A MOVING BODY OF WATER MOVES YOU. The city's current comes from
     waterfield.js (coastline-aware, so it drifts you along a beach but never
     conveyor-belts you through it). The island's comes from the ONE published
     disaster-water descriptor (water_spec.js's waterEventSample) — which is
     the tsunami's own flow, so being swept downstream in the inundation is
     the same code path as being carried by a tide. Neither one is a second
     current model; this function only chooses which field is speaking. */
  const _curSample = {};
  function applyCurrent(P, step) {
    if (survOn()) {
      if (!CBZ.waterEventSample) return;
      const s = CBZ.waterEventSample(P.pos.x, P.pos.z, null, _curSample);
      if (!s.active || !s.wet) return;
      const nx = P.pos.x + (s.currentX || 0) * step * 0.34;
      const nz = P.pos.z + (s.currentZ || 0) * step * 0.34;
      if (CBZ.survWaterAt(nx, nz)) { P.pos.x = nx; P.pos.z = nz; }
      return;
    }
    // a live disaster-water event (a CITY tsunami's undertow) outranks the
    // ambient coastal drift — same seam the island uses, one current model
    if (CBZ.waterEventSample) {
      const s = CBZ.waterEventSample(P.pos.x, P.pos.z, null, _curSample);
      if (s && s.active && s.wet && (s.currentX || s.currentZ)) {
        const nx = P.pos.x + (s.currentX || 0) * step * 0.34;
        const nz = P.pos.z + (s.currentZ || 0) * step * 0.34;
        if (!CBZ.waterField || !CBZ.waterField.isSurfaceWater || CBZ.waterField.isSurfaceWater(nx, nz, 0.5) || (CBZ.cityWaterAt && CBZ.cityWaterAt(nx, nz))) { P.pos.x = nx; P.pos.z = nz; }
        return;
      }
    }
    if (!CBZ.waterField || !CBZ.waterField.currentAt) return;
    const cur = CBZ.waterField.currentAt(P.pos.x, P.pos.z, undefined, swimCurrent);
    const nx = P.pos.x + cur.x * step * 0.34, nz = P.pos.z + cur.z * step * 0.34;
    if (CBZ.waterField.isSurfaceWater(nx, nz, 0.5)) { P.pos.x = nx; P.pos.z = nz; }
  }

  function hurtDrowning(P, dmg) {
    if (survOn() && CBZ.surv && CBZ.surv.hurt) {
      CBZ.surv.hurt(CBZ.surv.playerActor, dmg, { cause: "drowned" });
      return;
    }
    if (CBZ.cityHurtPlayer) CBZ.cityHurtPlayer(dmg, P.pos.x, P.pos.z, "drowned", false, null, false);
  }

  // is (x,z) over open water? (outside every walkable land mass)
  function waterAt(A, x, z) {
    // THE ISLAND: "water" is not a coastline test at all — the sea LEVEL moves
    // (CBZ.waterSurgeSet), so the only honest question is whether there is
    // water standing over the ground here. A flooded street answers yes.
    if (A && A.surv) return !!(CBZ.survWaterAt && CBZ.survWaterAt(x, z));
    // waterfield.js owns the rendered continent's exact signed coast.  Keep
    // the rect/circle branch only as a boot/legacy fallback.
    if (CBZ.waterField && CBZ.waterField.isSurfaceWater) {
      return CBZ.waterField.isSurfaceWater(x, z, 0);
    }
    if (x >= A.minX - QUAY && x <= A.maxX + QUAY && z >= A.minZ - QUAY && z <= A.maxZ + QUAY) return false;
    const B = A.bridge;
    if (B && x >= B.minX && x <= B.maxX && z >= B.minZ && z <= B.maxZ) return false;
    const I = A.annex;
    if (I && Math.hypot(x - I.cx, z - I.cz) <= I.radius + 1.5) return false;
    // worldmap.js islands & biomes are dry land too
    const regs = A.regions;
    if (regs && CBZ.cityRegionHit) {
      for (let i = 0; i < regs.length; i++) if (CBZ.cityRegionHit(regs[i], x, z, 0)) return false;
    }
    return true;
  }

  // Live surface Y at a point — the same crest the shader displaces and the
  // boats ride (world/water_spec.js owns the one swell table).
  function surfAt(x, z) {
    if (survOn()) return CBZ.survSeaHeightAt(x, z);
    return CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z)
      : (CBZ.waterSeaY ? CBZ.waterSeaY() : (CBZ.SEA_Y != null ? CBZ.SEA_Y : -0.48));
  }

  // Metres of water over the bed. Near the waterline this is a synthesised
  // beach shelf (see SHELF_SLOPE above); offshore it defers to waterfield's
  // bathymetry. Never read CBZ.floorAt/groundAt out here: the walkable floor
  // is flat 0 over the whole sea, which is exactly the phantom floor this
  // module exists to stop you standing on.
  function bedDepthAt(x, z) {
    // THE ISLAND has a real, queryable bed — the arena's own height field —
    // so no synthetic shelf is needed or wanted here.
    //
    // MEAN, NOT THE LIVE CREST. The city's shelf (cityBedDepthAt, below) is
    // built from waterfield's static shore distance, so a wave rolling past
    // never changes how deep the water is here. The island's was being read off
    // the wavy surface, which made THIS number swing by metres at wave
    // frequency during a tsunami — and the swim/wade hysteresis right below
    // (enter at 1.35 m, leave at 1.05 m) turned that into several
    // enterWater/exitWater round-trips a second, each one a splash, an sfx, a
    // shake and a velocity reset. survFloodDepthMeanAt is the same water column
    // measured against mean sea level; the SURFACE query (surfAt) stays wavy.
    if (survOn()) {
      return Math.max(0, CBZ.survFloodDepthMeanAt
        ? CBZ.survFloodDepthMeanAt(x, z) : CBZ.survFloodDepthAt(x, z));
    }
    return cityBedDepthAt(x, z);
  }

  // THE CITY SEA'S WATER COLUMN, published so the world can be DRAWN from the
  // same model the swimmer is clamped against. world/terrain_overhaul.js reads
  // it to shape the visual shelf and world/water_underwater.js reads it to
  // grade the underwater colour, so "the bottom you can see" and "the bottom
  // you stop at" are one surface instead of two guesses 60 m apart. Pure
  // analytic field arithmetic — allocation-free, no rng.
  function cityBedDepthAt(x, z) {
    const wf = CBZ.waterField;
    let shelf = 99;
    if (wf && wf.shoreAt) shelf = Math.max(0, -wf.shoreAt(x, z)) * SHELF_SLOPE;
    const deep = CBZ.cityWaterDepthAt ? CBZ.cityWaterDepthAt(x, z) : 24;
    const d = Math.min(shelf, deep > 0 ? deep : 24);
    return Number.isFinite(d) ? Math.max(0, d) : 0;
  }
  CBZ.citySeaBedDepthAt = cityBedDepthAt;
  // World Y of that bed — what a renderer actually wants.
  CBZ.citySeaBedYAt = function (x, z) {
    const surf = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z)
      : (CBZ.SEA_Y != null ? CBZ.SEA_Y : -0.48);
    return surf - cityBedDepthAt(x, z);
  };

  // 0..1 body submergence at a feet position. Prefers the shared field if a
  // neighbour has published one; the inline form is the same definition.
  function submergenceAt(x, y, z, surf) {
    if (CBZ.waterSubmergenceAt) {
      const s = +CBZ.waterSubmergenceAt(x, y, z, BODY_H);
      if (Number.isFinite(s)) return clamp01(s);
    }
    return clamp01((surf - y) / BODY_H);
  }

  // nearest dry land in reach: REACH is measured to the water's EDGE (the
  // swimmer presses against the seawall collider and can never get closer
  // than that), but the LANDING point steps well past the wall's own collider
  // box so the haul-up can't be shoved straight back off the lip.
  /* THE ISLAND'S WAY OUT. The city's climb-out is closed-form because its land
     is a handful of declared rectangles; the island's is a height field over
     which the sea can stand at any level, so the answer has to be SAMPLED.
     Sixteen bearings x four ranges = 64 probes, run only while you are
     actually swimming and only against a cheap analytic height field.
     CBZ.groundAt is preferred over the bare terrain so a building floor, a
     stairwell landing or a roof standing clear of the flood is a way out —
     which is what makes climbing INTO a tower the answer to a tsunami. */
  // 12 bearings x 4 ranges is 48 probes; the answer is CACHED for a fifth of a
  // second and against movement, the same discipline city/tsunami.js's
  // nearestWaterDir uses. A haul-out point does not move quickly and being one
  // beat stale costs nothing.
  let _scT = -1e9, _scX = 0, _scZ = 0, _scR = null;
  function survClimbSpot(A, x, z, reach) {
    const now = CBZ.now || 0;
    if (now - _scT < 200 && Math.abs(x - _scX) < 1.2 && Math.abs(z - _scZ) < 1.2) return _scR;
    _scT = now; _scX = x; _scZ = z;
    const ground = A.A.groundHeightAt;
    const surf = surfAt(x, z);
    const step = Math.max(0.9, reach / 4);
    let best = null, bd = 1e9;
    for (let a = 0; a < 12; a++) {
      const th = (a / 12) * Math.PI * 2, dx = Math.cos(th), dz = Math.sin(th);
      for (let d = 1.2; d <= reach; d += step) {
        const sx = x + dx * d, sz = z + dz * d;
        let top = ground(sx, sz);
        // Only ask the platform stack where the bare terrain has NOT already
        // answered — a building floor, stairwell landing or roof standing
        // clear of the flood is a way out, and that is what makes climbing
        // INTO a tower the right answer to a tsunami.
        if (top < surf + 0.15 && CBZ.groundAt) {
          const t2 = CBZ.groundAt(sx, sz, surf + 1.2);
          if (t2 > top) top = t2;
        }
        if (top < surf + 0.15 || top > surf + DECK_REACH_UP) continue;
        if (d < bd) { bd = d; best = { x: sx + dx * 0.8, z: sz + dz * 0.8, y: top, deck: true }; }
        break;                        // this bearing has answered; try the next
      }
    }
    _scR = best;
    return best;
  }

  function climbSpot(A, x, z, reach) {
    if (A && A.surv) return survClimbSpot(A, x, z, reach);
    let best = null, bd = reach;
    function consider(ex, ez2, lx, lz) {
      const d = Math.hypot(ex - x, ez2 - z);
      if (d < bd) { bd = d; best = { x: lx, z: lz }; }
    }
    // city slab: edge = the quay line, landing = 5.5 inside it
    const cxq = Math.max(A.minX - QUAY, Math.min(A.maxX + QUAY, x));
    const czq = Math.max(A.minZ - QUAY, Math.min(A.maxZ + QUAY, z));
    consider(cxq, czq,
      cxq + (cxq <= A.minX - QUAY + 0.01 ? 5.5 : cxq >= A.maxX + QUAY - 0.01 ? -5.5 : 0),
      czq + (czq <= A.minZ - QUAY + 0.01 ? 5.5 : czq >= A.maxZ + QUAY - 0.01 ? -5.5 : 0));
    const B = A.bridge;
    if (B) {
      const bx = Math.max(B.minX, Math.min(B.maxX, x)), bz = Math.max(B.minZ, Math.min(B.maxZ, z));
      consider(bx, bz, Math.max(B.minX + 1.5, Math.min(B.maxX - 1.5, x)), Math.max(B.minZ + 1.5, Math.min(B.maxZ - 1.5, z)));
    }
    const I = A.annex;
    if (I) {
      const d = Math.hypot(x - I.cx, z - I.cz) || 1;
      consider(I.cx + ((x - I.cx) / d) * I.radius, I.cz + ((z - I.cz) / d) * I.radius,
               I.cx + ((x - I.cx) / d) * (I.radius - 2.5), I.cz + ((z - I.cz) / d) * (I.radius - 2.5));
    }
    // worldmap.js islands/biomes: haul out onto the nearest registered shore
    const regs = A.regions;
    if (regs && CBZ.cityRegionClamp) {
      for (let i = 0; i < regs.length; i++) {
        const edge = CBZ.cityRegionClamp(regs[i], x, z, 0);
        const land = CBZ.cityRegionClamp(regs[i], x, z, 3.0);
        consider(edge.x, edge.z, land.x, land.z);
      }
    }
    // MOVING DECKS (WATER_BOARD_BOATS): a floating pontoon, a gangway, a yacht's
    // side deck — anything registered with systems/platforms_moving.js. Every
    // candidate above is a piece of STATIC land found by closed-form geometry;
    // a rig's deck is in its parent's local frame and only the rig can say where
    // it is right now. So we PROBE: ask the rig system's own ground query for a
    // deck at a ring of points around the swimmer, and take the nearest one that
    // is within haul-up reach of the water. Reusing CBZ.mpGroundAt rather than
    // reaching into the rig list means this keeps working for rig kinds that do
    // not exist yet, and costs nothing when no rigs are registered (the seam
    // early-outs on its own counter). Without that module this whole pass is
    // skipped and the haul-out is byte-identical to before.
    //
    // WITHOUT THIS you can fall off a floating dock and never get back on: the
    // static candidates know only the quay and the shore, so the nearest way out
    // of the water beside your own yacht was the beach.
    if (CFG.WATER_BOARD_BOATS !== false && CBZ.mpGroundAt && CBZ.movingPlatformCount && CBZ.movingPlatformCount() > 0) {
      const surf = surfAt(x, z);
      // A deck you can haul onto from the water: at most DECK_REACH_UP above the
      // live surface (higher than that and you would need a ladder), and never
      // below it (that is not a deck, that is the sea).
      const fromY = surf + DECK_REACH_UP;
      for (let a = 0; a < DECK_PROBES; a++) {
        const th = (a / DECK_PROBES) * Math.PI * 2;
        const pxp = x + Math.cos(th) * DECK_PROBE_R, pzp = z + Math.sin(th) * DECK_PROBE_R;
        const top = CBZ.mpGroundAt(pxp, pzp, fromY, -Infinity);
        if (!(top > surf - 0.2) || !(top < surf + DECK_REACH_UP)) continue;
        const d = DECK_PROBE_R;                       // every probe sits at the same radius
        if (d >= bd) continue;
        bd = d;
        best = { x: pxp, z: pzp, y: top, deck: true };
      }
    }
    // OPEN HULLS (WATER_BOARD_BOATS): a boat with no walkable deck is not
    // something you stand ON — climbing aboard a runabout or a RIB means taking
    // the helm. Hulls that DO have a deck rig are already covered by the probe
    // above, so they are skipped here.
    // Scored on the same distance ladder as the land spots, so if you are two
    // metres off a quay and twenty off a yacht you still get offered the quay.
    if (CFG.WATER_BOARD_BOATS !== false && CBZ.cityCars) {
      const cars = CBZ.cityCars;
      for (let i = 0; i < cars.length; i++) {
        const c = cars[i];
        // c.player: you are already aboard. c.dead: a swamped wreck is not a
        // refuge — it is the thing that just sank under you.
        if (!c || c.dead || c.player || !c.pos || !c.group) continue;
        // cheap reject first: this runs every frame you are in the water and
        // CBZ.cityCars is the whole fleet. BOARD_REACH is ~3m and the longest
        // hull is ~34m, so nothing beyond 40m of the origin can possibly reach.
        const rx = c.pos.x - x, rz = c.pos.z - z;
        if (rx * rx + rz * rz > 1600) continue;
        if (!marineHull(c)) continue;
        if (Math.abs(+c.v || 0) > BOARD_MAX_V) continue;   // no boarding a hull under way
        const hs = c._hullSpec;
        const dims = c._visualDims || c.dims;
        const len = (hs && +hs.loa > 1) ? +hs.loa
          : (dims && +dims.length > 1) ? +dims.length : 6.2;
        const h = +c.heading || 0;
        const fx = Math.sin(h), fz = Math.cos(h);        // vehicles.js forward convention
        const aft = (hs && Number.isFinite(+hs.sternOffset)) ? +hs.sternOffset : len * 0.5;
        // the transom itself — what you swim up to and grab
        const ex = c.pos.x - fx * aft, ez2 = c.pos.z - fz * aft;
        const d = Math.hypot(ex - x, ez2 - z);
        if (d >= bd || d > BOARD_REACH) continue;
        bd = d;
        // TWO KINDS OF BOARDING, and the hull decides which.
        //  • A hull with a WALKABLE DECK (world/water_hulls.js registers one
        //    through CBZ.movingPlatform — a cruiser, a yacht) hauls you out ONTO
        //    the deck: you stand up in the cockpit and can walk the boat.
        //  • An open hull (a RIB, the runabout) has no deck to stand on, so
        //    climbing aboard means taking the helm — the existing
        //    CBZ.cityEnterVehicle path, unchanged.
        // Without the deck branch we would haul you onto a hull that groundAt()
        // knows nothing about and you would drop straight back into the sea, so
        // the deck flag is REQUIRED, never assumed.
        // land a step INBOARD of the transom so the next swell can't wash you
        // straight back off the platform lip.
        const lx = ex + fx * BOARD_STEP_IN, lz = ez2 + fz * BOARD_STEP_IN;
        // Height comes from the RIG, never from a second guess: ask the same
        // ground query physics.js asks, so the deck we stand you on is the deck
        // you will actually be supported by next frame. A hull that claims a
        // deck rig but has no surface at the transom (a mis-authored spec) falls
        // through to the helm branch rather than dropping you in the sea.
        let deckY = null;
        if (c._deckRig && CBZ.mpGroundAt) {
          const surfL = surfAt(lx, lz);
          const t = CBZ.mpGroundAt(lx, lz, surfL + DECK_REACH_UP, -Infinity);
          if (t > surfL - 0.2 && t < surfL + DECK_REACH_UP) deckY = t;
        }
        best = (deckY != null)
          ? { x: lx, z: lz, y: deckY, boat: c, deck: true }
          : { x: lx, z: lz, boat: c, helm: true };
      }
    }
    return best;
  }

  // ---- the haul-out prompt -------------------------------------------------
  // A walk-up prompt element of our own (the city/storage.js pattern), NOT a
  // repeating city.note toast: the HUD doctrine reserves popups for the
  // killfeed, and the old code fired a note every 1.6s for as long as you were
  // near a wall. On touch the string becomes a tappable verb pill through the
  // shared layer (CBZ.touchActionPrompt) — no parallel touch handler.
  let _promptEl = null;
  function promptEl() {
    if (_promptEl) return _promptEl;
    if (typeof document === "undefined" || !document.body) return null;
    const d = document.createElement("div");
    d.id = "citySwimPrompt";
    d.style.cssText = "position:fixed;left:50%;bottom:118px;transform:translateX(-50%);" +
      "font:700 15px/1.4 ui-sans-serif,system-ui,sans-serif;color:#bfe2ff;text-align:center;" +
      "background:rgba(8,12,18,0.6);padding:7px 16px;border-radius:9px;border:1px solid rgba(120,180,255,0.35);" +
      "pointer-events:none;z-index:60;display:none;text-shadow:0 1px 3px #000";
    document.body.appendChild(d);
    _promptEl = d;
    return d;
  }
  function showPrompt(html) { const e = promptEl(); if (!e) return; if (e.style.display !== "block") e.style.display = "block"; if (e._h !== html) { e._h = html; e.innerHTML = html; } }
  // Hiding the prompt and withdrawing the offer are the same event — every
  // caller (left the water, went under, walked out of reach, hauled out) means
  // both — so the offer is retired HERE rather than at five call sites, one of
  // which would eventually be missed and leave a CLIMB OUT button standing over
  // open water. climbStep re-arms it after this runs.
  function hidePrompt() { climbVerb = ""; if (_promptEl && _promptEl.style.display !== "none") _promptEl.style.display = "none"; }

  // ---- input ---------------------------------------------------------------
  // Climb-out is an EDGE, latched from a real keydown rather than polled off
  // CBZ.keys, because a verb-pill tap synthesises a keydown+keyup in the same
  // tick (systems/touch.js CBZ.touchKeyTap) — a polled level would miss it.
  if (typeof addEventListener === "function") {
    addEventListener("keydown", function (e) {
      // Only while the haul-out prompt is actually up, so Space keeps meaning
      // "rise" underwater and "jump" everywhere else.
      if (e && e.key === " " && _promptEl && _promptEl.style.display === "block") climbPress = true;
    });
  }
  // Public one-liners so the touch layer (or a mission) can drive the swimmer
  // without reaching into this file: a verb pill can use "@citySwimClimbOut".
  CBZ.citySwimClimbOut = function () { climbPress = true; };
  // Hold-style vertical for touch: call every frame with -1 (dive) / +1 (rise)
  // / 0. It expires after 0.25s without a refresh, so a stale touch (the
  // failure mode systems/touch.js sweeps for) can never pin you underwater.
  CBZ.citySwimVertical = function (v) {
    touchVert = v > 0 ? 1 : (v < 0 ? -1 : 0);
    touchVertT = CBZ.now != null ? CBZ.now : (typeof performance !== "undefined" ? performance.now() : 0);
  };
  function touchVertical() {
    if (!touchVert) return 0;
    const now = CBZ.now != null ? CBZ.now : (typeof performance !== "undefined" ? performance.now() : 0);
    if (now - touchVertT > 250) { touchVert = 0; return 0; }
    return touchVert;
  }
  // -1 dive / +1 rise / 0. Reuses the game's existing vertical grammar (Space
  // is up everywhere, Ctrl/C is down everywhere); the stance machine stands
  // down while `player._swim` is set, so both keys are genuinely free here.
  function verticalInput() {
    const k = CBZ.keys;
    let v = touchVertical();
    if (!k) return v;
    if (k[" "]) v = 1;
    if (k["control"] || k["c"]) v = -1;
    return v;
  }

  // ---- entry / exit --------------------------------------------------------
  // `startY` is the feet altitude the swim should BEGIN at. It matters because
  // physics.js has already snapped P.pos.y up to the phantom flat floor (y=0)
  // by the time our main pass runs, so the caller passes the last altitude the
  // water actually owned; without it, walking off a beach popped you half a
  // metre into the air before buoyancy pulled you back down.
  function enterWater(P, fallSpeed, startY, hvx, hvz) {
    swimming = true;
    P._swim = true;
    if (CBZ.playerChar) CBZ.playerChar.swimming = true;
    const fall = Math.max(0, fallSpeed != null ? fallSpeed : -(P.vy || 0));
    // Impact splash scales with how hard you hit it — a step off the quay
    // barely dimples the surface, a fall off a bridge throws real spray.
    // world/water_wake.js owns the particles; the audio cue below is unchanged.
    if (CBZ.waterSplashAt) {
      CBZ.waterSplashAt(P.pos.x, P.pos.y, P.pos.z, 0.55 + Math.min(1.6, fall * 0.16));
    }
    // Carry the fall in as plunge momentum instead of discarding it: a dive
    // off the bridge should take you UNDER and let buoyancy bring you back.
    S.vy = -Math.min(ENTRY_MAX, fall * ENTRY_KEEP);
    // Carry the run/jump you arrived with as well — drag is what bleeds it off
    // over the next second, which is the whole point of having drag at all.
    const hm = Math.hypot(hvx || 0, hvz || 0);
    const hk = hm > ENTRY_HMAX ? ENTRY_HMAX / hm : 1;
    S.vx = (hvx || 0) * hk; S.vz = (hvz || 0) * hk;
    S.y = Number.isFinite(startY) ? Math.min(startY, P.pos.y) : P.pos.y;
    S.drownT = 0; S.hurtT = 0;
    climbPress = false;           // never carry a stale press into the water
    P.vy = 0;
    P._fallPeak = 0;              // the water caught you — never bill this as a fall
    px = P.pos.x; pz = P.pos.z;   // anchor the drag HERE — never against the
    // last on-land spot (a bail-out/teleport into water would snap you back)
    // BANK has no "splash" entry — the old call here logged
    // "[audio] unmapped sfx: splash" on every single water entry. BANK.water
    // is the real one, and its sample list already includes splash1.mp3.
    if (CBZ.sfx) { try { CBZ.sfx("water", { volume: Math.min(1.2, 0.7 + fall * 0.06), force: true }); } catch (e) {} }
    if (CBZ.shake) CBZ.shake(Math.min(0.6, 0.3 + fall * 0.02));
    // The island says nothing. In survival the water arriving IS the message
    // (SHOW DON'T TELL) — the splash, the shake and the breath bar are the
    // whole readout, and a line of prose over a tsunami is noise.
    if (!survOn() && CBZ.city && CBZ.city.note) CBZ.city.note("In the drink, swim to the seawall before you tire out", 2.6);
  }

  function exitWater(P, spot) {
    swimming = false;
    P._swim = false;
    chumStop();                  // out of the water is out of the food chain
    S.vx = S.vz = S.vy = 0;
    S.drownT = 0; S.hurtT = 0;
    P._fallPeak = 0;
    hidePrompt();
    if (CBZ.playerChar) CBZ.playerChar.swimming = false;
    // hauling out drags a sheet of water up with you
    if (CBZ.waterSplashAt) CBZ.waterSplashAt(P.pos.x, P.pos.y, P.pos.z, 0.55);
    if (spot) {
      P.pos.x = spot.x; P.pos.z = spot.z;
      // A spot that carries its own height is a BOAT deck (climbSpot's boat
      // pass) — CBZ.floorAt is the flat y=0 phantom floor out here and knows
      // nothing about a hull, so trusting it would drop you through the boat
      // into the sea you just left. Land on the sole and settle, don't launch:
      // the quay haul-up needs +1.0/vy 2.2 to clear the seawall cap's height
      // gate (y1=0.8), a deck has no such lip to beat.
      if (Number.isFinite(spot.y)) {
        P.pos.y = spot.y + 0.05; P.vy = 0; P.grounded = true;
      } else {
        const gy = CBZ.floorAt ? (CBZ.floorAt(spot.x, spot.z) || 0) : 0;
        P.pos.y = gy + 1.0; P.vy = 2.2; P.grounded = false;
      }
      if (CBZ.sfx) { try { CBZ.sfx("water", { volume: 0.55 }); CBZ.sfx("step"); } catch (e) {} }
      // An open hull has no deck to stand on: climbing aboard IS taking the
      // helm. Routed through the existing enter path (which owns the crime
      // check, the visual promotion and the camera) — never a parallel one.
      // Deliberately last, and after P._swim is already false, so the vehicle
      // controller takes a body the water has finished with.
      if (spot.helm && spot.boat && !spot.boat.dead && CBZ.cityEnterVehicle) {
        try { CBZ.cityEnterVehicle(spot.boat); } catch (e) {}
      }
    }
    px = P.pos.x; pz = P.pos.z;
  }

  // ============================================================
  //  PRE-PHYSICS: claim a fall into the sea (order 9.9)
  // ============================================================
  // The walkable floor is flat y=0 across the whole ocean (only registered
  // landmasses raise CBZ.cityGroundHeightAt), so physics.js lands a bridge
  // dive on that phantom floor and bills it through cityFallLand BEFORE this
  // module's main pass ever runs. Claim the entry a few metres early: bank the
  // impact speed as plunge momentum, then zero the fall bookkeeping.
  CBZ.onUpdate(9.9, function () {
    if (!v2On() || swimming) return;
    const A = arena(), P = CBZ.player;
    if (!A || !P || A.minX == null || P.dead || P.driving || P._aircraft || P._doorArc || P._aquaticMount) return;
    if (P.grounded || (P.vy || 0) >= 0) return;
    if (!waterAt(A, P.pos.x, P.pos.z)) return;
    const surf = surfAt(P.pos.x, P.pos.z);
    if (P.pos.y - surf > FALL_GUARD) return;
    if (bedDepthAt(P.pos.x, P.pos.z) < SWIM_DEPTH) return;   // too shallow to break a fall
    const fall = Math.max(-(P.vy || 0), P._fallPeak || 0);
    const step = Math.max(1e-3, (CBZ.feelDt != null ? CBZ.feelDt : 0.016));
    const hvx = (P.pos.x - px) / step, hvz = (P.pos.z - pz) / step;
    P.pos.y = Math.min(P.pos.y, surf - 0.05);
    enterWater(P, fall, P.pos.y, hvx, hvz);
  });

  // ============================================================
  //  THE MAIN PASS (order 45.8)
  // ============================================================
  // Runs AFTER movement/collision and BEFORE the camera (50) and the rigs copy
  // positions for render, so the water owns the player's altitude cleanly.
  CBZ.onUpdate(45.8, function (dt) {
    const A = arena();
    const P = CBZ.player;
    if (!A || !P || A.minX == null) { bail(P, dt); return; }
    // The mounted creature owns the water-column root until dismount. Clearing
    // the swimmer's private state here prevents buoyancy from fighting it while
    // preserving the ordinary swim owner for the instant the rider lets go.
    if (P._aquaticMount) { bail(P, dt); P._swim = false; return; }
    if (P.dead || P.driving || P._aircraft) { bail(P, dt); return; }
    if (!v2On()) { legacyStep(A, P, dt); return; }
    v2Step(A, P, dt);
  });

  /* ==================================================================
     BLOOD IN THE WATER — a wounded swimmer is chum.

     OWNER: "sharks like blood that's a huge feature."

     The seam already existed and was almost unconsumed: gore.js publishes
     CBZ.goreChumList() (a live, allocation-free array of every bleeder in
     water), predator.js's chumNear() polls it at 2.5 Hz, and every shark's
     chumR is 200+ units — nearly twice its sense radius. But there were only
     TWO producers in the whole game (gore.js's own wet-kill branch and the
     ocean minigame), so the one thing that should obviously make a shark come
     for you — being hurt and then swimming — did nothing at all.

     This is that producer. It is deliberately NOT a new blood system: one
     goreChum handle, whose x/y/z are FUNCTIONS (the shape gore.js already
     supports at gore.js:545, `cval`), so the trail follows the swimmer for
     free and the plume/slick FX come from gore.js's own emitter.

     WHEN IT RUNS is the whole design, and it is a threshold, not a dice roll:
     below CHUM_HP of your health you are bleeding, and bleeding in water is a
     dinner bell. Above it you are not. That makes "can I make it to the boat"
     a decision you can actually reason about — which is the difference between
     a scare and a tax.

     `strength` scales with how badly you are hurt, so a scratch draws a shark
     that happens to be nearby and a near-death swim pulls one in from 220 u.

     This is also the FIRST caller of CBZ.goreChumStop anywhere in the repo —
     the handle is released the moment you leave the water or stop bleeding,
     rather than being left to time out inside gore.js's 12-slot cap.
  ================================================================== */
  const CHUM_HP = 0.72;                 // bleed below 72% health
  const CHUM_TTL = 6;                   // s — refreshed while it still applies
  let chumH = null, chumT = 0;
  function playerHurtFrac(P) {
    const g = CBZ.game;
    const hp = (P && P.hp != null) ? +P.hp : (g && g.health != null ? +g.health : 100);
    const max = (P && P.hpMax) || (g && g.healthMax) || 100;
    if (!(max > 0)) return 0;
    return Math.max(0, Math.min(1, 1 - hp / max));
  }
  function chumStop() {
    if (!chumH) return;
    if (CBZ.goreChumStop) { try { CBZ.goreChumStop(chumH); } catch (e) {} }
    chumH = null; chumT = 0;
  }
  function chumStep(P, dt, sub) {
    if (CFG.SWIM_CHUM === false || !CBZ.goreChum) { chumStop(); return; }
    // Genuinely IN the water — a wet ankle is not a blood trail.
    if (!P || P.dead || sub < 0.25) { chumStop(); return; }
    const hurt = playerHurtFrac(P);
    if (hurt < 1 - CHUM_HP) { chumStop(); return; }
    chumT -= dt;
    if (chumH && chumT > 0) return;
    chumStop();
    // rate 0.25 at the threshold, 1.0 at death's door
    const rate = Math.max(0.2, Math.min(1, (hurt - (1 - CHUM_HP)) / CHUM_HP * 1.4 + 0.22));
    chumH = CBZ.goreChum(
      function () { return P.pos.x; },
      function () { return P.pos.y + 0.35; },
      function () { return P.pos.z; },
      rate, CHUM_TTL);
    chumT = CHUM_TTL * 0.6;             // refresh well before it expires
  }
  // Anything that ends the swim ends the trail. Exported so a caller outside
  // the water column (a rescue, a mode change) can end it too.
  CBZ.citySwimChumStop = chumStop;
  CBZ.citySwimBleeding = function () { return !!chumH; };

  function bail(P, dt) {
    if (swimming) {
      swimming = false;
      if (P) { P._swim = false; S.vx = S.vz = S.vy = 0; }
      if (CBZ.playerChar) CBZ.playerChar.swimming = false;
      hidePrompt();
    }
    chumStop();
    S.sub = 0; S.headUnder = false; S.diving = false; S.treading = false;
    if (P && P.pos) { px = P.pos.x; pz = P.pos.z; S.y = P.pos.y; }
    // Death / a vehicle / leaving the mode all give you your air back.
    if (P && P.dead) breath = BREATH_MAX;
    else recoverBreath(P, dt);
    publish(P);
  }

  // Air comes back out of the water too — otherwise a dive leaves you on a
  // permanently empty tank until the next time you happen to float.
  function recoverBreath(P, dt) {
    if (CFG.WATER_BREATH === false || breath >= BREATH_MAX) return;
    breath = Math.min(BREATH_MAX, breath + BREATH_REFILL * (dt || 0));
    S.drownT = 0;
    if (P) P.breath = breath;
  }

  // ---- V2 ------------------------------------------------------------------
  function v2Step(A, P, dt) {
    // The LOCAL body integrates on the wall-clock delta (the cross-agent
    // feelDt contract) exactly like physics.js does, so the swimmer never
    // slides in slow-motion under load. Gameplay resources use `dt`.
    let fdt = CBZ.feelDt != null ? CBZ.feelDt : dt;
    if (!(fdt > 0)) fdt = dt;
    fdt = Math.min(0.1, Math.max(0.0005, fdt));

    const overWater = waterAt(A, P.pos.x, P.pos.z);
    const surf = surfAt(P.pos.x, P.pos.z);
    const bed = bedDepthAt(P.pos.x, P.pos.z);
    S.surf = surf; S.bed = bed;

    // The wade test is measured against the LIVE surface at your feet (the
    // same swell the shader displaces), not a flat absolute height blind to
    // every wave rolling under you.
    const inWater = overWater && P.pos.y <= surf + WADE_ABOVE && !onFloatingDeck();
    if (!inWater) {
      if (swimming) exitWater(P, null);
      else { S.sub = 0; S.headUnder = false; hidePrompt(); }
      S.y = P.pos.y;
      px = P.pos.x; pz = P.pos.z;
      recoverBreath(P, dt);
      publish(P);
      return;
    }

    // ---- the horizontal intent physics applied this frame -------------------
    let stepX = P.pos.x - px, stepZ = P.pos.z - pz;
    let stepLen = Math.hypot(stepX, stepZ);
    if (stepLen > TELEPORT_V * fdt) {                         // a bail-out / mission warp
      // RE-ANCHOR ON THE NEW SPOT. Zeroing the step alone was not enough: the
      // swim write below is `P.pos.x = px + S.vx * fdt`, so with px still on
      // the PRE-warp anchor and the velocity zeroed, the very next line put
      // the player straight back where they were teleported from — a mission
      // warp, a bail-out or a net correction into open water was silently
      // undone every time. Same for the altitude (P.pos.y = S.y below).
      px = P.pos.x; pz = P.pos.z; S.y = P.pos.y;
      stepX = stepZ = 0; stepLen = 0; S.vx = S.vz = S.vy = 0;
    }

    // Enter / leave the swim on the WATER COLUMN, not on the body's altitude:
    // physics has already stomped P.pos.y onto the phantom flat floor by now.
    // Hysteresis (1.35m in / 1.05m out) keeps the surf line from chattering.
    if (!swimming && bed >= SWIM_DEPTH) {
      enterWater(P, -(P.vy || 0), S.y, stepX / fdt, stepZ / fdt);
      stepX = stepZ = 0; stepLen = 0;          // enterWater re-anchored px/pz
    } else if (swimming && bed <= STAND_DEPTH) {
      exitWater(P, null);                      // feet back — wade out of the surf
      stepX = stepZ = 0; stepLen = 0;
    }

    if (!swimming) { wadeStep(A, P, stepX, stepZ, surf, bed, fdt, dt); return; }

    // ---- SWIMMING -----------------------------------------------------------
    const sub = submergenceAt(P.pos.x, S.y, P.pos.z, surf);
    S.sub = sub;
    const swimFactor = Math.min(1, sub / SWIM_BLEND);

    // 1. DRAG FIRST. This is the single biggest contributor to the feel: it is
    //    what turns "released the key, stopped dead" into a glide and what
    //    bleeds a sprint's momentum off over ~a second in the water.
    const drag = Math.max(0, 1 - WATER_DRAG * Math.max(0.25, sub) * fdt);
    S.vx *= drag; S.vz *= drag;

    // 2. THEN the stroke. Direction comes from what physics tried to move us;
    //    the magnitude is ours, so the water sets the pace, not the walk speed.
    // A hard stroke needs shift AND actual input: holding shift while treading
    // must not buy you mode.js's idle stamina regen for free.
    const hard = !!(CBZ.keys && CBZ.keys["shift"]) && stepLen > 1e-4 &&
      (P.stamina == null || P.stamina > 0);
    const want = (hard ? SWIM_SPEED_FAST : SWIM_SPEED) * swimFactor;
    let desX = 0, desZ = 0;
    if (stepLen > 1e-4) { desX = (stepX / stepLen) * want; desZ = (stepZ / stepLen) * want; }
    let dvx = desX - S.vx, dvz = desZ - S.vz;
    const dm = Math.hypot(dvx, dvz);
    const amax = SWIM_ACCEL * fdt;
    if (dm > amax && dm > 1e-6) { dvx *= amax / dm; dvz *= amax / dm; }
    S.vx += dvx; S.vz += dvz;

    // 3. Position from OUR velocity, anchored at the pre-input spot, then a
    //    real wall resolve so the seawall/hull still stops you.
    P.pos.x = px + S.vx * fdt;
    P.pos.z = pz + S.vz * fdt;

    // A weak coastline-aware current makes the sea feel like a moving body of
    // water. waterfield removes any shoreward component near land, so it can
    // drift a swimmer along a beach but never conveyor-belt them through it.
    applyCurrent(P, fdt);
    if (CBZ.collideSlide) CBZ.collideSlide(P.pos, P.radius || 0.55, S.y + 0.25, S.y + BODY_H);
    else if (CBZ.collide) CBZ.collide(P.pos, P.radius || 0.55, S.y + 0.25, S.y + BODY_H);
    // If a wall ate the step, the velocity has to lose it too — otherwise you
    // build up a spring against the seawall and shoot off when you slide free.
    S.vx = (P.pos.x - px) / fdt; S.vz = (P.pos.z - pz) / fdt;

    // 4. VERTICAL — a damped buoyancy oscillator around the live surface.
    const vin = CFG.WATER_DIVE === false ? 0 : verticalInput();
    S.diving = vin < 0;
    // SWIM_SINK: the body's RESTING buoyancy is negative — you go under unless
    // you swim up. Holding Space (vin > 0) restores the positive-buoyancy body
    // so you rise AND then hold at the surface rather than porpoising. The
    // whole model is this one branch; the oscillator below is unchanged.
    const sinkOn = CFG.SWIM_SINK !== false;
    let buoy = sinkOn ? (vin > 0 ? SURFACE_BUOY : SINK_BUOY) : BUOYANCY;
    if (S.diving) buoy *= DIVE_BUOY;                       // lungs emptied, kicking down
    S.sinking = sinkOn && vin <= 0 && !S.diving;
    S.vy += G_WATER * (buoy * sub - 1) * fdt;
    if (vin < 0 && S.vy > -DIVE_SPEED) S.vy = Math.max(-DIVE_SPEED, S.vy - DIVE_ACCEL * fdt);
    if (vin > 0 && S.vy < RISE_SPEED) S.vy = Math.min(RISE_SPEED, S.vy + RISE_ACCEL * fdt);
    S.vy *= Math.exp(-VDRAG * fdt);                        // stable at ANY dt
    S.y += S.vy * fdt;

    // The bed and the ceiling. Depth is capped by waterfield's bathymetry so
    // you cannot swim through the seabed, and nothing pins you to a plane at
    // the top — you break the surface and fall back through it.
    const bedY = surf - Math.max(SWIM_DEPTH, bed) + BED_CLEAR;
    if (S.y < bedY) { S.y = bedY; if (S.vy < 0) S.vy = 0; }
    const ceil = surf + 0.55;                              // a stroke can lift you clear
    if (S.y > ceil) { S.y = ceil; if (S.vy > 0) S.vy = 0; }

    // 5. Animation moods. Moving = the long glide-heavy stroke; stationary =
    //    a shorter, more vigorous tread with its own per-cycle bob.
    const spd = Math.hypot(S.vx, S.vz);
    S.treading = spd < 0.35;
    const moodTarget = S.treading ? 1 : 0;
    S.mood += (moodTarget - S.mood) * (1 - Math.exp(-4.5 * fdt));
    S.stroke += fdt * (2.0 + Math.min(3, spd) * 0.55);     // ~3s glide cycle
    S.tread += fdt * 2.55;                                 // ~2.5s tread cycle
    P._swimPhase = S.stroke;
    // The tread's own vertical pulse, ON TOP of the buoyancy solve: you sink a
    // few centimetres between eggbeater kicks and pop back on each one.
    const treadBob = Math.sin(S.tread * 2) * 0.055 * S.mood;

    P.pos.y = S.y + treadBob;
    P.vy = 0;                    // nothing outside this file integrates our Y
    P._fallPeak = 0;             // and nothing may bill the water as a fall
    P.grounded = false;          // NOT grounded: this is what stops physics.js
                                 // firing a jump (and its sfx) every frame you
                                 // hold Space to rise or to climb out.
    P.speed = spd;               // publish the REAL water speed, not the walk one

    px = P.pos.x; pz = P.pos.z;

    poseSwimmer(P, spd);
    breathStep(P, surf, dt);
    tireStep(P, dt, hard);
    climbStep(A, P, dt, sub);
    chumStep(P, dt, sub);
    publish(P);
  }

  // Wading: still physics's body, just progressively heavier. We only own the
  // altitude (the feet ride the synthesised shelf) and scale the step.
  function wadeStep(A, P, stepX, stepZ, surf, bed, fdt, dt) {
    const bedY = surf - bed;
    // The world has no submerged geometry, and mean sea level sits ~0.5m below
    // the beach ramp, so crossing the waterline is a real step down. Ease the
    // feet onto the shelf over ~0.25s instead of teleporting them there.
    const targetY = Math.min(P.pos.y, Math.max(bedY, surf - BODY_H));
    const sub = submergenceAt(P.pos.x, targetY, P.pos.z, surf);
    S.sub = sub;
    const swimFactor = Math.min(1, sub / SWIM_BLEND);
    if (sub > 0.02) {
      S.y += (targetY - S.y) * (1 - Math.exp(-12 * fdt));
      const keep = 1 - WADE_SLOW * swimFactor;
      P.pos.x = px + stepX * keep;
      P.pos.z = pz + stepZ * keep;
      P.pos.y = S.y;
      P.speed = Math.hypot(stepX, stepZ) * keep / fdt;
      // A wave washing over you still costs air — but the legacy
      // stamina-as-air model only ever ran while genuinely swimming, so it
      // stays out of the wade band.
      if (CFG.WATER_BREATH !== false) breathStep(P, surf, dt);
    } else { S.y = P.pos.y; recoverBreath(P, dt); }
    S.vx = stepX / fdt; S.vz = stepZ / fdt; S.vy = 0;
    S.treading = false; S.diving = false;
    px = P.pos.x; pz = P.pos.z;
    // Thigh-deep against a harbour wall is still "in the drink" — the
    // synthesised shelf must never be the reason you cannot haul yourself out.
    if (sub > 0.25) climbStep(A, P, dt, 0);
    else { climbPress = false; hidePrompt(); }
    publish(P);
  }

  // ---- the two moods -------------------------------------------------------
  // Physics synced the rig before this pass, so without this the visible
  // character would stand on its pre-swim floor. Water owns the final pose and
  // transform for the frame.
  function poseSwimmer(P, spd) {
    const ch = CBZ.playerChar;
    if (!ch || !ch.group) return;
    ch.swimming = true;
    ch.group.position.copy(P.pos);
    const m = S.mood;                       // 0 = gliding crawl, 1 = treading
    const sw = Math.sin(S.stroke);
    const tw = Math.sin(S.tread);
    // Body attitude: flat and prone while swimming, near-vertical while
    // treading, nose-down/up when you are actively driving through the column.
    const pitchDrive = Math.max(-0.55, Math.min(0.55, -S.vy * 0.22));
    ch.group.rotation.x = 0;
    if (ch.body) {
      ch.body.rotation.x = (0.30 + pitchDrive) * (1 - m) + 0.95 * m;
      ch.body.position.y = (Math.sin(S.stroke * 2) * 0.028) * (1 - m) + (tw * 0.02) * m;
    }
    if (ch.parts) {
      // crawl: big alternating overhead sweep. tread: short sculling arcs.
      const laC = -1.20 + sw * 0.62, raC = -1.20 - sw * 0.62;
      const laT = -0.35 + Math.sin(S.tread * 2) * 0.42, raT = -0.35 - Math.sin(S.tread * 2) * 0.42;
      if (ch.parts.la) { ch.parts.la.rotation.x = laC * (1 - m) + laT * m; ch.parts.la.rotation.z = -0.28 - 0.34 * m; }
      if (ch.parts.ra) { ch.parts.ra.rotation.x = raC * (1 - m) + raT * m; ch.parts.ra.rotation.z = 0.28 + 0.34 * m; }
      // crawl: flutter kick. tread: eggbeater — the legs circle out of phase.
      const llC = sw * 0.30, rlC = -sw * 0.30;
      const llT = 0.55 + Math.sin(S.tread * 2) * 0.42, rlT = 0.55 - Math.cos(S.tread * 2) * 0.42;
      if (ch.parts.ll) ch.parts.ll.rotation.x = llC * (1 - m) + llT * m;
      if (ch.parts.rl) ch.parts.rl.rotation.x = rlC * (1 - m) + rlT * m;
    }
    if (ch.low) {
      if (ch.low.la) ch.low.la.rotation.x = -0.45 * (1 - m) - 0.85 * m;
      if (ch.low.ra) ch.low.ra.rotation.x = -0.45 * (1 - m) - 0.85 * m;
      if (ch.low.ll) ch.low.ll.rotation.x = (0.35 + Math.max(0, -sw) * 0.25) * (1 - m) + (0.9 + Math.max(0, tw) * 0.3) * m;
      if (ch.low.rl) ch.low.rl.rotation.x = (0.35 + Math.max(0, sw) * 0.25) * (1 - m) + (0.9 + Math.max(0, -tw) * 0.3) * m;
    }
  }

  // ---- breath --------------------------------------------------------------
  function breathStep(P, surf, dt) {
    if (CFG.WATER_BREATH === false) { legacyAir(P, dt); return; }
    if (P.breathMax !== BREATH_MAX) P.breathMax = BREATH_MAX;
    // Only the HEAD costs air. The band around the waterline is graded so
    // spluttering in the chop half-drains instead of flipping a switch.
    const headY = P.pos.y + EYE_H;
    const headSub = clamp01((surf - headY) / 0.35);
    S.headUnder = headSub > 0.5;
    if (headSub > 0) {
      breath = Math.max(0, breath - headSub * dt);
    } else if (breath < BREATH_MAX) {
      const was = breath;
      const nowMs = CBZ.now != null ? CBZ.now : 0;
      breath = Math.min(BREATH_MAX, breath + BREATH_REFILL * dt);
      // one gasp when you break the surface genuinely short of air
      if (was < BREATH_MAX * 0.55 && nowMs - S.gaspAt > 2500) {
        S.gaspAt = nowMs;
        if (CBZ.sfx) { try { CBZ.sfx("water", { volume: 0.5 }); } catch (e) {} }
      }
      S.drownT = 0;
    }
    P.breath = breath;
    if (breath > 0) { S.drownT = 0; return; }
    // Out of air: a soft-fail grace window, then health bleeds. Never instant.
    S.drownT += dt;
    if (S.drownT < DROWN_GRACE) return;
    S.hurtT += dt;
    if (S.hurtT >= 0.5) {
      S.hurtT = 0;
      if (CBZ.shake) CBZ.shake(0.3);
      // "drown" is load-bearing: city/death.js:183 and modes/survival.js:51
      // both pattern-match it.
      // ONE pipeline: cityHurtPlayer -> death.js -> cityKillPlayer, which
      // killfeed.js wraps. "drowned" survives normCause verbatim, so the corner
      // feed reads "You — drowned" with no bespoke toast of any kind here.
      const wasDead = !!P.dead;
      hurtDrowning(P, DROWN_DPS * 0.5);
      if (!wasDead && P.dead) drownDeaths++;
    }
  }

  // WATER_BREATH=0 — the exact prior model: stamina IS air.
  function legacyAir(P, dt) {
    if (P.stamina == null) return;
    P.stamina = Math.max(0, P.stamina - DRAIN * dt);
    if (P.stamina > 0) return;
    S.hurtT += dt;
    if (S.hurtT >= 1) {
      S.hurtT = 0;
      const wasDead = !!P.dead;
      hurtDrowning(P, DROWN);
      if (!wasDead && P.dead) drownDeaths++;
    }
  }

  // Surface swimming still tires you — but it is STAMINA, not air. Holding
  // shift already spends 24/s through the existing sprint economy
  // (physics.js order 10 -> mode.js order 31); all we add is enough bleed to
  // cancel the 14/s idle regen so a long crossing is genuinely draining.
  function tireStep(P, dt, hard) {
    if (CFG.WATER_BREATH === false || P.stamina == null) return;
    if (hard) return;                       // the sprint drain already owns this
    P.stamina = Math.max(0, P.stamina - SWIM_TIRE * dt);
  }

  // ---- the way out ---------------------------------------------------------
  function climbStep(A, P, dt, sub) {
    const spot = climbSpot(A, P.pos.x, P.pos.z, 4.6);
    if (!spot) { climbPress = false; climbVerb = ""; hidePrompt(); return; }
    // Only offer (and consume) the haul-out at the surface: deep under a quay
    // the Space press belongs to the ascent. The margin clears the buoyancy
    // oscillator's own overshoot on a passing crest (a bob must not blink the
    // prompt), but not a deliberate duck under. With SWIM_SINK the resting
    // depth is no longer FLOAT_SUB, so the window is DERIVED instead of tuned:
    // the head clears the water while sub < (BODY_H - EYE_H)/BODY_H = 0.912, so
    // 0.90 is "you can see the quay you are reaching for" and nothing else.
    const atSurface = sub <= (CFG.SWIM_SINK !== false ? 0.90 : FLOAT_SUB + 0.17);
    if (!atSurface) { climbPress = false; climbVerb = ""; hidePrompt(); return; }
    // A hull says "climb aboard", land says "climb out" — the verb tells you
    // WHERE the haul-up is about to put you, which matters when a moored boat
    // and a quay are both in reach.
    const aboard = !!spot.boat;
    const verb = aboard ? "Climb aboard" : "Climb out";
    // THE DISASTER MODE'S TOUCH VERB MOVED TO THE VERB DOCK (owner: "I want
    // climb out placed like" the throw/grab buttons). A centre-screen prompt
    // band is the right home for a walk-up verb you meet standing still, and
    // the wrong one for a verb you need while both thumbs are already busy
    // steering and diving — so in survival, systems/survival_interact.js puts
    // this in #survVerbs beside the right thumb, in the same .svbtn grammar as
    // Grab / Throw / Set down, off the `climb` flag published below.
    //
    // The CITY keeps the prompt-band pill: #survVerbs is a survival-only dock,
    // and a city swimmer with no pill would have no touch surface at all.
    // Desktop is untouched everywhere — same string, same place.
    const docked = !!CBZ.touchMode && survOn();
    if (docked) hidePrompt();
    else showPrompt(CBZ.touchActionPrompt
      ? CBZ.touchActionPrompt("@citySwimClimbOut", verb, "[Space] " + verb.toLowerCase())
      : "[Space] " + verb.toLowerCase());
    climbVerb = verb;             // after hidePrompt(), which retires the offer
    if (climbPress) { climbPress = false; exitWater(P, spot); }
  }

  // ============================================================
  //  LEGACY PATH — WATER_SWIM_V2=0 (the prior direct-Y swim)
  // ============================================================
  // Dynamics, drag, drain and climb-out are the pre-V2 code verbatim; only the
  // limb poser is shared with V2 (its glide mood is the same cycle).
  // ============================================================
  let legacyHintT = 0;
  function legacyStep(A, P, dt) {
    const liveSurf = surfAt(P.pos.x, P.pos.z);
    const inWater = waterAt(A, P.pos.x, P.pos.z) && P.pos.y <= liveSurf + WADE_ABOVE && !onFloatingDeck();
    if (inWater && !swimming) enterWater(P, -(P.vy || 0), P.pos.y);
    if (!swimming) { px = P.pos.x; pz = P.pos.z; publish(P); return; }
    if (!inWater) { exitWater(P, null); publish(P); return; }

    P.pos.x = px + (P.pos.x - px) * 0.45;
    P.pos.z = pz + (P.pos.z - pz) * 0.45;
    applyCurrent(P, dt);
    px = P.pos.x; pz = P.pos.z;
    P._swimPhase = (P._swimPhase || 0) + dt * (2.6 + Math.min(3, P.speed || 0) * 0.22);
    S.stroke = P._swimPhase; S.mood = 0;
    const seaY = surfAt(P.pos.x, P.pos.z);
    P.pos.y = seaY - 1.28 + Math.sin(P._swimPhase * 2) * 0.045;
    S.y = P.pos.y; S.surf = seaY; S.sub = submergenceAt(P.pos.x, S.y, P.pos.z, seaY);
    P.vy = 0; P.grounded = true; P.sprint = false;
    poseSwimmer(P, P.speed || 0);
    legacyAir(P, dt);

    const spot = climbSpot(A, P.pos.x, P.pos.z, 4.6);
    if (spot) {
      legacyHintT -= dt;
      if (legacyHintT <= 0 && !survOn() && CBZ.city && CBZ.city.note) { legacyHintT = 1.6; CBZ.city.note("[Space] climb out", 1.4); }
      if (CBZ.keys && CBZ.keys[" "]) exitWater(P, spot);
    }
    climbPress = false;
    publish(P);
  }

  // ============================================================
  //  PUBLIC SURFACE
  // ============================================================
  CBZ.citySwimming = function () { return swimming; };
  // Explicit ownership hand-off from an aquatic mount. This is the same entry
  // function used by bridge dives, with mount momentum carried into the swim;
  // it is public only so riding does not grow a second buoyancy implementation.
  CBZ.citySwimBegin = function (opts) {
    const P = CBZ.player;
    if (!P || !P.pos || P.dead || P._aquaticMount) return false;
    const o = opts || {};
    if (swimming) swimming = false;
    const sy = surfAt(P.pos.x, P.pos.z);
    const startY = Math.min(Number.isFinite(o.y) ? o.y : P.pos.y, sy - 0.05);
    P.pos.y = startY;
    enterWater(P, Math.max(0, -(P.vy || 0)), startY,
      Number.isFinite(o.vx) ? o.vx : 0, Number.isFinite(o.vz) ? o.vz : 0);
    return true;
  };

  // THE neighbour seam. One allocation-free call with everything a predator,
  // a mission or a HUD needs. `depth` is measured from the surface down to the
  // swimmer's CHEST (what a shark should home on), `submergence` is the same
  // 0..1 scalar this file steers by, `breath` is 0..1 of a full tank.
  const _state = {
    swimming: false, submergence: 0, depth: 0, breath: 1,
    diving: false, treading: false, sinking: false, x: 0, y: 0, z: 0,
    surfaceY: 0, headUnder: false, speed: 0,
    // THE HAUL-OUT, PUBLISHED. climbStep already knew every frame whether a
    // way out was in reach and what it was called; it just kept the answer to
    // itself and spent it on a centre-screen prompt. Exported, the touch layer
    // can put the verb where every other touch verb lives — in the thumb
    // column beside DIVE/RISE — instead of the middle of the water.
    climb: false, climbVerb: "",
  };
  function publish(P) {
    _state.swimming = swimming;
    _state.submergence = S.sub;
    _state.breath = CFG.WATER_BREATH === false
      ? (P && P.stamina != null ? P.stamina / 100 : 1)
      : breath / BREATH_MAX;
    _state.diving = swimming && S.diving;
    _state.sinking = swimming && S.sinking;
    _state.treading = swimming && S.treading;
    _state.headUnder = swimming && S.headUnder;
    _state.surfaceY = S.surf;
    _state.speed = swimming ? Math.hypot(S.vx, S.vz) : 0;
    _state.climbVerb = swimming ? climbVerb : "";
    _state.climb = !!_state.climbVerb;
    if (P && CFG.WATER_BREATH !== false) { P.breath = breath; P.breathMax = BREATH_MAX; }
    if (P && P.pos) {
      _state.x = P.pos.x; _state.y = P.pos.y; _state.z = P.pos.z;
      _state.depth = Math.max(0, S.surf - (P.pos.y + CHEST_H));
    }
  }
  CBZ.citySwimState = function () { return _state; };

  /* ==================================================================
     CBZ.swimAudit() — the water column as numbers.

     sinkRate / ascendRate are the TERMINAL speeds the model actually
     produces, solved from the constants rather than re-typed beside them
     (a number typed twice is a number that drifts): the vertical solve is
     `vy += G_WATER*(buoy*sub - 1)*dt` damped by `vy *= exp(-VDRAG*dt)`, so
     terminal v = G_WATER*(buoy*sub - 1)/VDRAG at full submergence, and the
     ascent additionally floors at RISE_SPEED because the kick is a
     rate-limited approach. `drowned` counts real deaths routed through the
     ONE death pipeline this session — it is what proves the drown is not a
     stat fiction.
  ================================================================== */
  CBZ.swimAudit = function () {
    const on = CFG.SWIM_SINK !== false;
    const restBuoy = on ? SINK_BUOY : BUOYANCY;
    const sinkRate = Math.max(0, G_WATER * (1 - restBuoy) / VDRAG);
    const buoyUp = on ? SURFACE_BUOY : BUOYANCY;
    const ascendRate = Math.max(RISE_SPEED, G_WATER * (buoyUp - 1) / VDRAG);
    return {
      sinkRate: +sinkRate.toFixed(2),          // m/s downward with no input
      ascendRate: +ascendRate.toFixed(2),      // m/s upward holding Space
      breathSec: CFG.WATER_BREATH === false ? 0 : BREATH_MAX,
      drowned: drownDeaths,
      diveRate: DIVE_SPEED,                    // Ctrl/C, the deliberate dive
      sinkOn: on,
      breath: +(breath / BREATH_MAX).toFixed(3),
      swimming: swimming,
      // BLOOD IN THE WATER. `bleeding` is whether a live chum handle is open
      // right now; `chumOn` proves which side of the flag the build is on;
      // `chumSources` is gore.js's whole live bleeder list, so a probe can see
      // this producer land in the array predator.js actually reads.
      bleeding: !!chumH,
      chumOn: CFG.SWIM_CHUM !== false,
      chumSources: (function () { try { return CBZ.goreChumList ? CBZ.goreChumList().length : -1; } catch (e) { return -1; } })(),
    };
  };

  // is this point over open water? (humancontact's land clamp + anything else
  // that needs to leave a swimmer alone)
  // waterfield.js normally publishes this before swim.js loads. Preserve a
  // standalone fallback for old pages/tests that load only this module.
  if (!CBZ.waterField) CBZ.cityWaterAt = function (x, z) {
    const A = arena();
    return !!(A && A.minX != null && waterAt(A, x, z));
  };
})();
