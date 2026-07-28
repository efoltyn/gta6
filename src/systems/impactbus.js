/* ============================================================
   systems/impactbus.js — THE ORDNANCE BUS.

   OWNER DOCTRINE (CLAUDE.md, THE BLOCK LAW): "every feature I came up with
   was built as an add-on with all new code when really it just needed to
   reuse other shit and draw some new shit and animate it."

   This file is the answer for the IMPACT & DESTRUCTION domain. Before it,
   every ordnance site in the game hand-wrote the SAME four-to-six calls in a
   slightly different order with slightly different numbers:

     city/aircraft.js wreckImpact:   cityExplosion + cityDamageBuilding
                                     + cityShatter + cityCrashSmoke
     city/buildings.js structuralBlast: cityScorch + cityChunk
                                     + cityDamageBuilding + fracture.blastAt
     city/demolition.js destroy:     cityScorch + cityChunk x3 + sfx
     city/playeraircraft.js:         cityDamageBuilding x3
     city/vehicles.js / police.js / airtraffic.js: cityDamageBuilding

   Adding a bomb meant writing that fan-out a seventh time. So the fan-out
   moves HERE, once, and every warhead becomes a ROW IN A TABLE:

       CBZ.detonate(x, y, z, "jdam", { by: player });

   NEW ORDNANCE IS A TABLE ROW, NOT A FILE. That is the whole point. The nuke,
   the B2's bomb stick, the JDAM and a 747 into a tower are all rows below;
   they differ in numbers and in which FX composer they name, not in code.

   ------------------------------------------------------------------
   THE KINETIC LAW (the second thing this file owns — see the block above the
   crash rows for the derivation). A table row is a CONSTANT, and a constant
   cannot tell an airliner clipping a roof at taxi speed from the same airliner
   driven into a tower at 240 m/s. That is not a tuning problem — no value of
   the row fixes it, because raising it to make the dive catastrophic makes the
   bump catastrophic too. So mass and speed are first-class:

       CBZ.detonate(x, y, z, "crashAirliner", { mass, speed, frontal, dirx, dirz });

   E = 1/2 m v^2 against the row's declared `refE`, then TWO exponents:
   (E/refE)^(1/3) sizes the FX (Hopkinson-Cranz — blast radius goes as the cube
   root of yield) and (E/refE)^(2/3) sizes the damage (the wrecked footprint is
   that radius squared). `frontal` is the projectile's width in metres, which
   city/structural.js turns into a SEVER — the fraction of the struck floor's
   load-bearing cross-section that is simply gone. Geometry no energy number
   can express, and the thing that makes a wing different from a warhead.

   Rows with `refE: 0` — every chemical warhead — ignore mass and speed
   entirely, and a caller that passes neither gets exactly the numbers it got
   before this existed. Degrade-safe by construction.
   ------------------------------------------------------------------

   ------------------------------------------------------------------
   THE FIVE-POINT BLOCK LAW COMPLIANCE (CLAUDE.md):
   1. ONE-LINE ADOPTION. `CBZ.detonate(x,y,z,kind,opts)` replaces the caller's
      whole fan-out. No schema to declare, no type to register, no lifecycle.
   2. DEGRADE-SAFE. Every consumer adopts as
        `CBZ.detonate ? CBZ.detonate(...) : <the old inline calls>`
      and every sub-call in here is feature-detected, so a partial load can
      never throw into a caller.
   3. >=3 REAL CONSUMERS MIGRATED IN THE SAME CHANGE — city/demolition.js
      (structural HP), city/fracture.js (facade wound escalation),
      city/explosives.js (C4), plus the new ordnance in city/ordnance.js and
      the aircraft-impact case. `cityDamageBuilding` is additionally WRAPPED
      below, which migrates its eight external call sites for free without
      editing files this domain does not own.
   4. NAMED IN CLAUDE.md — see the report; the owner must paste the block.
   5. RATCHET COUNTER — `CBZ.impactAudit()` at the bottom of this file counts
      the structural-damage accumulators that are still INDEPENDENT of the
      shared ledger. It may only ever go DOWN. Pin it in the math gate.
   ------------------------------------------------------------------

   WHAT THIS FILE DOES *NOT* DO: it draws nothing. Every visual routes into
   the systems that already exist and are already pooled/capped —
   crashfx.js's cityExplosion / cityAirstrikeExplosion / cityChunk /
   cityDustKick / cityScorch, buildings.js's cityDamageBuilding / cityShatter,
   fracture.js's blastAt. The one genuinely new draw is the nuke composer,
   which lives in city/nukefx.js and registers itself HERE by name. Adding a
   spectacle is `CBZ.impact.fx("nuke", fn)`.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  if (CBZ.impact) return;                     // idempotent (family guard idiom)

  CBZ.CONFIG = CBZ.CONFIG || {};
  // Master switch. false => CBZ.detonate degenerates to a bare cityExplosion
  // with the row's power/radius and nothing else, which is byte-identical to
  // what every legacy caller did before this file existed. One-line revert.
  if (CBZ.CONFIG.IMPACT_BUS == null) CBZ.CONFIG.IMPACT_BUS = true;
  // The propagating blast WAVE (nuke/MOAB class): damage arrives as an
  // expanding annulus over seconds instead of instantly at t=0. Off => the
  // classic instant radius query.
  if (CBZ.CONFIG.IMPACT_SHOCKWAVE == null) CBZ.CONFIG.IMPACT_SHOCKWAVE = true;
  // Let ordnance rows escalate structural damage through city/structural.js.
  // Off => blasts still do FX + people damage, buildings behave as before.
  if (CBZ.CONFIG.IMPACT_STRUCTURAL == null) CBZ.CONFIG.IMPACT_STRUCTURAL = true;
  // EVERY PAYLOAD SPEAKS THE BUS. The consumer-side switch that the migrated
  // hand-rolled detonations (fpsmode's rocket, combat's grenade, the tank
  // fallback, the aircraft missile pool, playeraircraft's fallback, the car
  // cook-off) read before choosing `CBZ.detonate(...)` over their own inline
  // cityExplosion call. Off => every one of them runs its ORIGINAL line,
  // byte-for-byte. It lives HERE rather than in config.js because this file is
  // what the callers already feature-detect (`CBZ.detonate ? … : …`), so one
  // null-check answers both questions.
  if (CBZ.CONFIG.ORDNANCE_BUS_ALL == null) CBZ.CONFIG.ORDNANCE_BUS_ALL = true;
  // A blast reaching the PARKED CARS around it (the 8th cityExplosion wrapper,
  // near the bottom of this file). Off => only the wave-carrying rows touch
  // vehicles, exactly as before.
  if (CBZ.CONFIG.IMPACT_CAR_BLAST == null) CBZ.CONFIG.IMPACT_CAR_BLAST = true;

  const I = (CBZ.impact = {});

  // Re-entrancy depths (not booleans — blasts nest, and a boolean would be
  // cleared by the inner one). See the BLAST SCOPE block further down for the
  // full rationale; in short they are what stop the same warhead being counted
  // by two different legacy hooks.
  //   blastDepth — inside CBZ.cityExplosion / cityAirstrikeExplosion
  //   busDepth   — inside a CBZ.detonate FX composer
  let blastDepth = 0, busDepth = 0;
  // Frame counter + the frame a blast last ran on. A blast's cosmetic partner
  // calls are not always INSIDE the blast call — city/aircraft.js's
  // wreckImpact fires cityExplosion and THEN, sequentially, cityDamageBuilding,
  // by which point the depth is already back to zero. Both are the same event
  // in the same frame, so the suppression window is "this frame", not "this
  // call stack". A standalone cityDamageBuilding in a frame with no blast at
  // all (a car ramming a storefront) still counts, which is the case the
  // bridge exists for.
  let frameNo = 0, lastBlastFrame = -1;
  I.inBlast = function () { return blastDepth > 0 || lastBlastFrame === frameNo; };
  I.inBusBlast = function () { return busDepth > 0; };

  /* ============================================================
     THE ORDNANCE TABLE
     ------------------------------------------------------------
     Every field is optional; the DEFAULTS row below fills the gaps, so a new
     warhead can genuinely be `{ power: 4, radius: 22 }` and still get the
     whole fan-out. Fields:

       power     blast strength. Feeds cityExplosion's own `power` (which
                 already scales its FX, its ped lethality and its structural
                 coupling), so the numbers here are in the SAME units every
                 existing caller already tuned against: grenade ~1, RPG ~1.9,
                 airstrike ~3.
       radius    NEAR-FIELD metres. **TRAP: the legacy blast API multiplies
                 radius BY power internally** (crashfx.js: `R = radius*power`),
                 and we pass both straight through so migrated callers keep
                 their exact old numbers. So the effective near-field radius of
                 a row is `radius * power`, NOT `radius` — "rpg" is now
                 13*1.9 = 24.7m, matching the shared rocket path.
                 For anything carrying a `wave`, keep `radius` SMALL: it is only
                 the fireball, and it is also where the wave starts. The reach
                 of a nuke is `wave.maxR`, not this. Setting a nuke's radius to
                 its real blast reach would make the legacy path instantly kill
                 everything out to radius*power and there would be nothing left
                 for the wave to roll over — the whole point of the wave is that
                 you SEE it coming.
       fx        which composer draws it: "blast" (cityExplosion),
                 "heavy" (cityAirstrikeExplosion), or any name registered via
                 I.fx(name, fn) — that is how city/nukefx.js plugs the nuke in
                 without this file knowing anything about it.
       struct    structural-damage multiplier into city/structural.js. 0 = a
                 warhead that hurts people but not the city (flashbang, the
                 heli ember). 1 = ordinary ordnance. 6+ = building-killer.
       pen       PENETRATION energy. >0 means the warhead does not stop at the
                 facade: it drives a hole INTO the structure and deposits its
                 damage at depth (city/aircraftimpact.js and the JDAM use
                 this). 0 = surface burst.
       fire      ignition strength 0..1 fed to the structural ledger's fire
                 stage. Fuel-carrying ordnance (aircraft, incendiary) is high;
                 a shaped charge is ~0.
       wave      { speed, maxR } => the blast arrives as a PROPAGATING RING at
                 `speed` m/s out to `maxR` metres, instead of instantly. Only
                 the big stuff wants this; a grenade should not make you wait.
       shake     camera-shake amplitude override (else derived from power).
       quake     seconds of LOW rumble after the shake (nuke/collapse class).
       sfx       sound name. Defaults to the composer's own.
       flashbang if true, the full-screen flash fires regardless of distance
                 (the nuke's whiteout, which must read from across the map).
       refE      REFERENCE KINETIC ENERGY, joules. See THE KINETIC LAW below.
                 0 (the default) means this warhead's damage comes from its
                 chemistry, not its motion, so `opts.mass`/`opts.speed` are
                 ignored and the row behaves exactly as it always did.
       kmin,kmax clamp band for the kinetic multiplier (defaults 0.25 / 6).

     WHY THE ROWS ARE THE NUMBERS THEY ARE: the conventional rows below were
     read off the existing call sites so migration is behaviour-preserving —
     "rpg" is fpsmode's rocket, "crashSmall"/"crashJet" are aircraft.js's
     wreckImpact (power 1.5 street / 1.9 building), "airstrike" is
     cityAirstrikeExplosion's own default. The NEW rows (jdam..nuke) are the
     only invented numbers in the file.
     ============================================================ */
  const DEFAULTS = {
    power: 1, radius: 6, fx: "blast", struct: 1, pen: 0, fire: 0,
    wave: null, shake: null, quake: 0, sfx: null, flashbang: false,
    // debris/dust multiplier — the one knob a quality tier scales.
    debris: 1,
    // THE KINETIC LAW (see the block below the table). 0 = chemistry-driven.
    refE: 0, kmin: 0.25, kmax: 6,
  };

  const TABLE = Object.create(null);

  I.define = function (id, spec) {
    const row = Object.assign({}, DEFAULTS, spec || {});
    row.id = id;
    TABLE[id] = row;
    return row;
  };
  I.row = function (id) { return TABLE[id] || null; };
  I.list = function () { return Object.keys(TABLE); };

  /* ---- conventional ordnance (migrated from existing call sites) ----------

     THESE SIX ROWS WERE DEFINED AND NEVER CALLED. They sat here for the whole
     life of this file while fpsmode's rocket, combat's grenade, the tank
     fallback, the aircraft missile pool, playeraircraft's fallback and
     vehicles.js's cook-off each hand-rolled power/radius straight into
     cityExplosion. Wiring the callers up (see the ORDNANCE_BUS_ALL flag)
     exposed that the rows had DRIFTED from the live numbers, every one of them
     downward — adopting them as written would have SHRUNK six explosions:

       row  →  live caller                            was      now
       rpg      fpsmode/weapon-data 1.9 x r13         8        13
       tank     militaryvehicles fallback 2.2 x r10   9        10
       missile  aircraft.js detonate() 3.0 x r16      2.6/11   3.0/16
       airstrike same call (5-star strike IS the      3.0/12   3.0/16
                 missile pool's detonate)
       carcook  vehicles.js explodeCar 1.15 x r6.5    0.9/5    1.15/6.5
       grenade  combat.js GREN 1.0 x r5.5             6        6 (kept — the
                 row was already the larger of the two)

     THE RULE THAT SETTLED EACH ONE: where the row and the live caller
     disagreed, THE LIVE CALLER WON. A migration that quietly makes the RPG's
     fireball 15 m instead of 25 m is not a migration, it is a nerf wearing a
     refactor's coat.

     `struct: 6` ON ALL SIX IS ARITHMETIC, NOT TASTE. Until now these blasts
     reached buildings through city/demolition.js's onBlast hook, which
     delegates `power * LEGACY_TO_LEDGER` (=6) per building into the structural
     ledger. The moment a caller routes through CBZ.detonate, demolition.js
     stands down (it checks `opts._impact` / `inBusBlast()`) and the ROW is the
     only thing feeding the ledger. So a row carrying anything less than 6
     would have silently made every migrated warhead weaker against the city
     than the un-migrated version of itself. 6 is the number that makes the
     per-building deposit identical — which is exactly what "migrate, don't
     retune" is supposed to mean. What the bus ADDS on top is the part the
     legacy path never had: penetration, fuel fire, the ejecta direction, and a
     seat height that is not a guess.
     ------------------------------------------------------------------------ */
  I.define("grenade",   { power: 1.0, radius: 6,  struct: 6,   fire: 0.05 });
  I.define("c4",        { power: 1.4, radius: 7,  struct: 1.6, fire: 0.10 });
  I.define("rpg",       { power: 1.9, radius: 13, struct: 6,   fire: 0.12 });
  I.define("tank",      { power: 2.2, radius: 10, struct: 6,   pen: 3,  fire: 0.05 });
  I.define("missile",   { power: 3.0, radius: 16, struct: 6,   pen: 5,  fire: 0.15, fx: "heavy" });
  I.define("airstrike", { power: 3.0, radius: 16, struct: 6,   fire: 0.20, fx: "heavy" });
  /* THE CAR COOK-OFF IS THE ONE CHEMICAL ROW THAT KNOWS ITS OWN SIZE.
     Every car in the game detonated with the identical 1.15 / 6.5 — a hatchback
     and a box van made the same fireball, which is the single loudest tell that
     the "explosion" was a constant and not an event. A cook-off is a FUEL
     event, and fuel load scales with the vehicle, so this row declares a
     reference energy and city/vehicles.js hands it the burning car's own mass
     factor. THE KINETIC LAW then does the rest for free and in the right
     proportions: the fireball rides the cube root (a 1.43x van is a 1.13x
     fireball, not a 1.43x one) and the damage the 2/3 power (1.27x). Nothing
     else in the file had to be told, and a hatchback still prices at exactly
     the numbers explodeCar always used.
     refE 8.4e6 J = 2 kg TNT-equivalent, the customary figure for a passenger
     car's tank deflagration — an order below the tank's chemical content
     because most of a car fire BURNS rather than detonating, which is also why
     this row's `fire` is its biggest field. kmin/kmax are deliberately tight:
     the whole spread from a coupe to an armoured van is under 2x, and a bad
     mass field must never be able to turn a saloon into a MOAB. */
  /* `fire: 0.24` IS ONE HUNDREDTH UNDER city/structural.js's FIRE_IGNITE_MIN
     (0.25), AND THAT IS DELIBERATE. `fire` does two jobs: it is the chance a
     blast lights a NEIGHBOURING CAR (systems/impactbus's vehicle coupling —
     the highest of any conventional row here, because a cook-off is the fuel
     event), and it is the term that lights a BUILDING FLOOR. The legacy path
     this row replaces passed `fire: 0`, so buildings have never caught from a
     car, and cars now cook off in CHAINS — one flipped character would have
     shipped "a parking-lot cascade can burn a block down" as a side effect of
     a migration. Raise it to 0.25 to turn that on deliberately, with the
     structural-fire arc in front of you. */
  I.define("carcook",   { power: 1.15, radius: 6.5, struct: 6, fire: 0.24,
                          refE: 8.4e6, kmin: 0.6, kmax: 1.9 });
  // cosmetic only — the helicopter ember. struct 0 so it can never wound a
  // facade (this is the `noDamage` case the legacy code special-cased inline).
  I.define("ember",     { power: 0.2, radius: 1.5, struct: 0, fire: 0 });

  /* ============================================================
     THE KINETIC LAW — mass x speed is ordnance.

     THE BUG THIS FIXES: before this block, a warhead's damage was a CONSTANT
     read off its table row. An airliner clipping a roof at taxi speed and an
     airliner driven into a tower at 240 m/s delivered the SAME number, because
     the table had no way to say "this one was going six times as fast". So the
     single most-wanted feature in the game — a plane into a skyscraper — could
     not be distinguished from a bird strike, and no amount of retuning the row
     could fix it: raising the row to make the dive catastrophic made the taxi
     bump catastrophic too.

     THE MODEL. E = 1/2 m v^2, in joules, compared against the row's declared
     REFERENCE energy `refE`. Two DIFFERENT exponents come out of it, and the
     asymmetry is the whole point:

       kPow = (E/refE)^(1/3)   -> FX size, blast radius, shake.
              Hopkinson-Cranz: for a given overpressure, blast RADIUS scales as
              the cube root of yield (R = R1 * Y^(1/3)). Our `power` multiplies
              `radius` inside the legacy blast path, so power IS a radius-like
              quantity and the cube root is its honest exponent. It is also what
              keeps the spectacle sane: 6x the energy is 1.8x the fireball, not
              6x, which is exactly the compression real explosions have.

       kStr = (E/refE)^(2/3)   -> damage into the structural ledger.
              The FOOTPRINT the blast wrecks is that radius squared, so damage
              (an area-like quantity) goes as the 2/3 power. 6.4x the energy is
              3.4x the structural damage.

     REAL NUMBERS this is calibrated against (kinetic energy only, before the
     fuel burns — the fuel is `fire`, a separate axis):
       car, 1500 kg @ 30 m/s          6.8e5 J       (0.16 kg TNT)
       Cessna, 1.1 t @ 34 m/s         6.4e5 J
       fighter, 24 t @ 250 m/s        7.5e8 J       (0.18 t TNT)
       767-class, 73 t @ 240 m/s      2.1e9 J       (0.50 t TNT)
       ...and the 20 kt device three rows down                8.4e13 J
     An airliner's KINETIC energy is about half a tonne of TNT — genuinely
     large, but four orders below its own FUEL load, which is precisely why the
     real sequence is "the impact does not fell the tower, the fire does". Our
     ledger reproduces that arc for free once the numbers are real: the strike
     severs the floor, `fire` burns the load path down over the next ~40 s, and
     city/structural.js's load-path check fells it. Get the energy wrong and
     that whole arc collapses into either a firecracker or an instant deletion.

     DEGRADE-SAFE (BLOCK LAW rule 2): a caller that passes no mass/speed gets
     multiplier 1.0 and byte-identical behaviour to before this block existed.
     A row with refE 0 (every chemical warhead) ignores mass/speed entirely.

     ADOPTION IS ONE PROPERTY: `CBZ.detonate(x,y,z,"crashAirliner", {mass, speed})`.
     ============================================================ */

  // ---- aircraft impacts --------------------------------------------------
  // A crash is a CONTAINED fuel fireball, NOT an airstrike (aircraft.js's
  // comment, preserved). What makes a plane strike catastrophic is not its
  // blast power — it is `pen` (it goes INSIDE), `fire` (jet fuel), and now
  // KINETIC ENERGY, which is exactly what the old numbers could not express.
  //
  // refE below is each class's NOMINAL impact energy, derived from the same
  // bounding-box mass model city/aircraftimpact.js authored (density x span x
  // length x height) at that class's nominal approach speed. That file used to
  // keep this arithmetic private and hand the bus a pre-chewed `scale`; the
  // reference now lives HERE, next to the row it calibrates, so a bomb dropped
  // from altitude, a meteor and a hijacked 767 all price their motion on one
  // scale instead of three.
  //   small    1109 kg @ 34 m/s
  //   jet     23725 kg @ 95 m/s
  //   airliner 72624 kg @ 95 m/s
  I.define("crashSmall",   { power: 1.5, radius: 7,  struct: 1.6, pen: 4,  fire: 0.55,
                             refE: 6.41e5,  kmax: 4 });
  I.define("crashJet",     { power: 1.9, radius: 9,  struct: 3.2, pen: 12, fire: 0.75, fx: "heavy",
                             refE: 1.071e8, kmax: 5 });
  I.define("crashAirliner",{ power: 2.6, radius: 14, struct: 9.0, pen: 26, fire: 1.00, fx: "heavy",
                             quake: 2.5, wave: { speed: 90, maxR: 70 },
                             refE: 3.277e8, kmax: 7 });

  // ---- NEW: real bombs ---------------------------------------------------
  // The RPG is the visual/gameplay baseline: 1.9*13 = 24.7 m. The B-2's
  // unguided weapon is explicitly a 2,000 lb Mk-84, while a JDAM is a guidance
  // kit around that same Mk-84/BLU-117 class warhead. Guidance changes where
  // the energy lands, not how much explosive exists, so their open-air blast
  // footprints now agree: 48 m and 51.2 m, roughly twice the RPG radius
  // (four times its area). The JDAM keeps its much greater penetration and
  // structural deposit; that is what accuracy/delay fuzing buys it.
  I.define("bomb",   { power: 2.4, radius: 20, struct: 4.0, pen: 6,  fire: 0.30, fx: "heavy" });
  I.define("jdam",   { power: 3.2, radius: 16, struct: 7.0, pen: 18, fire: 0.35, fx: "heavy",
                       quake: 1.2 });
  // The 18,700 lb H6 MOAB carries about twenty Mk-84 explosive fills. Cube-root
  // blast scaling makes its comparable-pressure radius about 2.7x larger, not
  // the old 1.25x. Its 120 m near field and 320 m pressure reach preserve that
  // relationship without pretending a conventional weapon is nuclear.
  // fx "moab" is city/nukefx.js's composer. Naming it here rather than leaving
  // "heavy" for that file to re-point is the preferred end state: the table is
  // the single declaration, and if nukefx never loads the lookup simply falls
  // through to COMPOSERS.heavy — which is the degrade path by construction.
  I.define("moab",   { power: 4.6, radius: 26, struct: 16,  pen: 10, fire: 0.60, fx: "moab",
                       quake: 4, wave: { speed: 140, maxR: 320 }, flashbang: true });

  // ---- NEW: the nuke -----------------------------------------------------
  // The biggest spectacle in the game. Its FX composer is city/nukefx.js,
  // registered by name; if that file is absent the row degrades to the heavy
  // composer and still works (rule 2). Everything about it that is EXPENSIVE
  // is in the wave, which is tick-bounded, not in a particle count.
  // `struct` is CALIBRATED AGAINST LEDGER CAPACITY, not picked for drama.
  // city/structural.js sizes a building at `12 + storeys*7 + (w*d)/26` — about
  // 23 for a corner shop, 55 for a fat 4-storey block, ~110 for an 11-storey.
  // struct*power = 495 at ground zero, so the core is unambiguously levelled;
  // the wave's squared falloff (see sweepRing) then gives the gradient the
  // spectacle actually needs — a flattened core, a ring of burning wrecks, and
  // a scorched-but-standing outer edge — instead of one uniform "everything
  // dies" radius. A struct in the hundreds would flatten the entire map out to
  // maxR and leave nothing to look at.
  // radius*power = 126m maximum visible fireball radius, matching the published
  // 50*W^(1/3) m relation at roughly a 15 kt event. The pressure front rolls
  // from there out to 900m over ~4.7s at 190 m/s. If city/nukefx.js is absent
  // this degrades to the "heavy" composer at that same 126m — a very large
  // airstrike plus a white flash, which is the right shape of wrong.
  I.define("nuke", {
    power: 9, radius: 14, struct: 55, pen: 0, fire: 1, fx: "nuke",
    quake: 14, flashbang: true, sfx: "explosion",
    /* THERMAL, RE-DERIVED AGAINST THE NEW maxR. The 1.25 this used to carry
       was a multiple of the OLD 900 m reach, and 900 m was the collapse
       radius wearing the name "reach" — so the multiplier read "ignition
       outranges destruction", which is true. maxR now means the 1 psi
       contour, so the same physical statement needs a different number:

         thermal ignition (light fuels catching, the firestorm boundary)
           Hiroshima's firestorm covered 11.4 km^2 => radius 1.9 km, and the
           spontaneous-ignition range for a 15 kt burst is ~2.0 km. Ours is
           2,016 m — the 2 psi contour, which is a coincidence of this yield
           and not a law.
         5 psi collapse contour                        1,109 m
         1 psi glass contour (= maxR)                  3,276 m

       => thermal = 2016 / 3276 = 0.615.
       The ordering the audit actually cares about is unchanged and is now
       stated in the right units: collapse 1,109 < ignition 2,016 < glass
       3,276. Ignition still outranges destruction by 1.82x; it just no
       longer outranges the whole wave, because the wave is bigger than the
       destruction now. This is gameplay only: nukefx deliberately draws no
       geometric ring or annulus on the terrain. */
    /* maxR IS NOW THE RESEARCHED 1 psi CONTOUR, not a framing number.
       city/nukefx.js inverts this row's own fireball radius back into a
       yield — W = (radius*power / 50)^3 = (126/50)^3 = 16.0 kt, a
       Hiroshima-class device — and Glasstone & Dolan's 1 kt surface-burst
       reference radii scaled by W^(1/3) = 2.520 give

           20 psi   200 m ->   504 m    total destruction
           10 psi   300 m ->   756 m    heavy structural failure
            5 psi   440 m -> 1,109 m    most ordinary buildings COLLAPSE
            2 psi   800 m -> 2,016 m    roofs and walls out, what is left burns
            1 psi 1,300 m -> 3,276 m    windows across the whole district

       900 m stopped inside the 2 psi ring — it was not even the collapse
       radius, let alone the reach. 3,276 m is where a 16 kt burst genuinely
       stops breaking things.

       THE SPEED IS UNCHANGED AND THAT IS DELIBERATE. A real front is much
       faster (roughly 500 m/s over the first kilometre, decaying toward
       sonic); 190 m/s is the same named readability compression the double
       flash takes, and it is what makes the front something you WATCH
       arrive. 3,276 / 190 = 17.2 s, comfortably inside nukefx's 34 s arc.

       THE PER-TICK COST DOES NOT GROW WITH maxR. sweepRing is a full scan of
       the ped roster with a distance test whatever the radius is, and the
       car pass is capped per tick — a wider wave costs more TICKS, not more
       work per tick, and WAVE_TICK already bounds those. */
    wave: { speed: 190, maxR: 3276, thermal: 0.615, lethal: "nuclear" },
  });

  // ---- environmental (city/disasters wiring) ------------------------------
  // A meteor is PURE kinetics — it has no chemistry at all — so it is the row
  // that most wants refE. Nominal: a 6 t stone at 200 m/s.
  I.define("meteor",  { power: 3.4, radius: 15, struct: 8, pen: 8, fire: 0.5, fx: "heavy", quake: 2,
                        refE: 1.2e8, kmax: 8 });
  I.define("tornado", { power: 1.2, radius: 9,  struct: 3.0, fire: 0, debris: 1.6 });

  // ---- NEW: the generic kinetic strike ------------------------------------
  // Anything heavy that hits a structure at speed and is not a warhead: a car
  // through a storefront, a train, a shipping container dropped off a crane, a
  // vehicle the tornado threw through a third-floor window. One row, priced by
  // mass and speed like everything else, so none of those cases ever needs its
  // own file. Nominal: a 1.5 t car at 30 m/s — a hard but survivable shunt.
  I.define("kinetic", { power: 0.8, radius: 4, struct: 0.9, pen: 1, fire: 0.05,
                        refE: 6.75e5, kmin: 0.15, kmax: 9 });

  /* ============================================================
     FX COMPOSER REGISTRY
     A composer is `fn(x, y, z, row, opts)` and owns ONLY drawing. Two are
     built in and simply forward to the pooled systems that already exist;
     anything else registers itself. city/nukefx.js does:
         CBZ.impact.fx("nuke", function (x, y, z, row, opts) { ... });
     ...and the "nuke" table row above starts working. No edit here.
     ============================================================ */
  const COMPOSERS = Object.create(null);
  I.fx = function (name, fn) { if (typeof fn === "function") COMPOSERS[name] = fn; };
  I.hasFx = function (name) { return !!COMPOSERS[name]; };

  function fxBlast(x, y, z, row, opts) {
    if (!CBZ.cityExplosion) return;
    CBZ.cityExplosion(x, z, {
      power: row.power * (opts.scale || 1),
      radius: row.radius,
      y: y,
      byPlayer: !!opts.byPlayer,
      noDamage: !!opts.noDamage,
      airburst: !!opts.airburst,
      // Carry the ordnance identity through the blast chain so every wrapper
      // downstream (demolition's onBlast, buildings' structuralBlast) can tell
      // a nuke from a car fire without re-deriving it from `power`.
      ordnance: row.id,
      _impact: true,
    });
  }
  function fxHeavy(x, y, z, row, opts) {
    const fn = CBZ.cityAirstrikeExplosion || CBZ.cityExplosion;
    if (!fn) return;
    fn(x, z, {
      power: row.power * (opts.scale || 1),
      radius: row.radius,
      y: y,
      byPlayer: !!opts.byPlayer,
      noDamage: !!opts.noDamage,
      ordnance: row.id,
      _impact: true,
    });
  }
  COMPOSERS.blast = fxBlast;
  COMPOSERS.heavy = fxHeavy;

  /* ============================================================
     KINETIC RESOLVER — the arithmetic behind THE KINETIC LAW above.

     `CBZ.impact.kinetic(mass, speed)` is also public, because three different
     neighbours want to ASK the question without detonating anything: the
     cockpit HUD ("how bad would this be"), the tornado (what its debris is
     worth when it hits a wall) and mission logic (was that strike big enough
     to count). One answer, one place.
     ============================================================ */
  const TNT_J = 4.184e6;                          // joules per kg of TNT

  // Accepts (mass, speed) or (mass, {x,y,z} velocity) or a full opts object.
  I.kinetic = function (mass, speed) {
    const m = +mass;
    let v = speed;
    if (v && typeof v === "object") v = Math.hypot(+v.x || 0, +v.y || 0, +v.z || 0);
    v = +v;
    if (!(m > 0) || !(v > 0) || !isFinite(m) || !isFinite(v)) return { E: 0, tnt: 0, v: 0, m: 0 };
    const E = 0.5 * m * v * v;
    return { E: E, tnt: E / TNT_J, v: v, m: m };
  };

  // Pull the energy out of an opts bag, however the caller chose to express it.
  //   {mass, speed}            the normal form
  //   {mass, vel:{x,y,z}}      a caller holding a velocity vector
  //   {energy}                 a caller that already did the arithmetic
  function energyOf(opts) {
    if (opts.energy > 0) return +opts.energy;
    const v = opts.speed != null ? opts.speed : opts.vel;
    const k = I.kinetic(opts.mass, v);
    return k.E;
  }

  // Returns {pow, str, E} — the FX multiplier and the ledger multiplier.
  // Both are 1 when the caller said nothing about motion, which is what makes
  // every pre-existing call site byte-identical (BLOCK LAW rule 2).
  function kineticMul(row, opts) {
    if (!(row.refE > 0)) return null;
    const E = energyOf(opts);
    if (!(E > 0)) return null;
    const ratio = E / row.refE;
    if (!isFinite(ratio) || ratio <= 0) return null;
    const lo = row.kmin > 0 ? row.kmin : 0.25;
    const hi = row.kmax > 0 ? row.kmax : 6;
    // clamp the RATIO, then take the roots — clamping after the root would let
    // an absurd input (a NaN speed, a debug teleport) still distort the shape
    // of the pair relative to each other.
    const r = Math.max(lo * lo * lo, Math.min(hi * hi * hi, ratio));
    return { pow: Math.cbrt(r), str: Math.cbrt(r * r), E: E };
  }
  I.kineticMul = function (kind, opts) {
    const row = TABLE[kind];
    return row ? kineticMul(row, opts || {}) : null;
  };

  /* ------------------------------------------------------------------
     SEVER — how much of the struck floor's load-bearing cross-section the
     projectile actually took out. This is the one number that separates "a
     hole in a wall" from "the tower is now standing on a severed floor", and
     it is GEOMETRY, not damage: a 34 m wingspan cuts most of the way across a
     44 m tower whatever the speed, and a 2 m warhead into the same tower does
     not, however fast it is going. Damage models cannot express that, which is
     precisely why a plane strike never felt different from a big rocket.

     NIST's finding on the real case is the calibration: the impact severed
     roughly two thirds of the impacted face's perimeter columns.

     We emit the EFFECTIVE SEVERED WIDTH IN METRES and let city/structural.js
     divide by the building it actually resolved — only that file knows which
     lot was hit and how wide it is, and computing it here would mean guessing.

     `coupling` gates it on ABSOLUTE energy, not on the ratio to the row's own
     reference — and that distinction matters more than it looks. A relative
     gate would let a light aircraft arriving at its own nominal speed claim
     its full 11 m wingspan as a structural cut, and a Cessna into a shopfront
     would sever the building. It cannot: a light airframe is thin aluminium
     and it disintegrates against a structural frame. Severing columns takes
     energy in an absolute sense, so the curve saturates against a fixed
     constant instead:

         coupling = E / (E + SEVER_E_HALF)

     SEVER_E_HALF is the energy at which a projectile achieves half of its
     geometric cut. CALIBRATED AGAINST THIS GAME'S ACTUAL BUILDINGS, which is
     the step that matters and the one that is easy to skip: the first pass
     here used 2e8, reasoned against a 44 m tower — but a city lot in this
     world is `BLK 34 - 4 - 2 = 28 m` (config.js's BLK, world.js's lot inset).
     Against the real 28 m the airliner severed 100% (a clean decapitation
     rather than NIST's ~2/3) and, much worse, a FIGHTER landed at 0.383 —
     which clears the sudden-load bar of 0.6405 by 3.7% and condemned a
     52-storey tower. The file's own comment claimed "a hole, not a gutting"
     while the arithmetic was felling skyscrapers with an F-22.

     At 1.2e9 J (~287 kg TNT), against this game's 28 m cross-section:
         Cessna, 1.1 t @ 40 m/s     8.9e5 J -> 0.0007 coupling -> sever ~0.00
         fighter, 24 t @ 250 m/s    7.4e8 J -> 0.38   coupling -> sever  0.15
                                    (floor 0.85 vs a 0.64 bar — a hole. Stands.)
         767-class, 73 t @ 240 m/s  2.1e9 J -> 0.63   coupling -> sever  0.66
                                    (NIST's ~2/3 of the impacted face, exactly)
     Never more than the projectile's actual width: geometry is geometry.
     ------------------------------------------------------------------ */
  const SEVER_E_HALF = 1.2e9;
  function severOf(row, opts, mul) {
    const frontal = +opts.frontal;
    if (!(frontal > 0) || !isFinite(frontal)) return 0;
    const E = mul ? mul.E : energyOf(opts);
    if (!(E > 0)) return 0;
    return frontal * (E / (E + SEVER_E_HALF));        // METRES; resolved against the target in structural.js
  }

  /* ============================================================
     CBZ.detonate(x, y, z, kind, opts) — THE ONE ORDNANCE VERB.

     opts: {
       by        actor credited (player object, cop, "army", ...) — passed to
                 the kill bus so the killfeed attributes deaths correctly.
       byPlayer  boolean the legacy blast path already understands (crime,
                 wanted level).
       scale     multiply this shot's power (a half-fuelled airliner).
       dirx,dirz travel direction of the round. Drives the EJECTA CONE —
                 debris and the penetration path go DOWNRANGE, which is the
                 single biggest "this had a direction" cue a strike has.
       noDamage  cosmetic only.
       quiet     no sound / no shake (replays, net application, save load).
       lot       pre-resolved target lot, if the caller already knows it.

       mass      kg of the thing that hit. THE KINETIC LAW (see above).
       speed     m/s at impact. Or pass `vel: {x,y,z}` and we take its length,
                 or `energy` in joules if you already did the arithmetic.
                 Ignored entirely by any row with refE 0 (all chemistry-driven
                 warheads), so passing them is always safe.
       frontal   FRONTAL WIDTH IN METRES of the thing that hit — an airliner's
                 34 m wingspan, a car's 1.8 m. city/structural.js divides it by
                 the struck building's own cross-section to get the SEVER: how
                 much of that floor's load-bearing width is simply gone. This
                 is what makes a plane a plane and not just a big rocket, and
                 it is why the same airframe guts a narrow block and merely
                 wounds a fat one.
     }
     Returns { kind, x, y, z, lot, stage } for callers that want to chain —
     `stage` is the target building's resulting CBZ.structure.STAGE, or 0.
     ============================================================ */
  CBZ.detonate = I.detonate = function (x, y, z, kind, opts) {
    opts = opts || {};
    const row = TABLE[kind];
    if (!row) {
      // Unknown warhead: never throw into a caller. Fall back to the plain
      // blast so a typo degrades to "something exploded" instead of silence.
      if (CBZ.cityExplosion) { try { CBZ.cityExplosion(x, z, { power: 1, radius: 6, y: y }); } catch (e) {} }
      return null;
    }
    if (y == null) y = (CBZ.floorAt ? CBZ.floorAt(x, z) : 0) + 1.2;

    // MASTER REVERT: behave exactly like a pre-bus caller.
    if (!CBZ.CONFIG.IMPACT_BUS) {
      try { fxBlast(x, y, z, row, opts); } catch (e) {}
      // Same SHAPE as the live path — a caller must not have to branch on a
      // config flag to read the result. (This returned `struct: 0` where every
      // other exit returns `stage`, so `r.stage` was undefined on the revert
      // path only: a null-check that passes for a year and then doesn't.)
      return { kind: kind, x: x, y: y, z: z, lot: null, stage: 0 };
    }

    // ---- 0) PRICE THE MOTION. One resolve, used by every stage below, so the
    //        FX, the ledger and the wave can never disagree about how hard this
    //        one arrived. Null (the overwhelmingly common case) means the
    //        caller said nothing about mass or speed and every number below is
    //        exactly what it was before THE KINETIC LAW existed.
    const kin = kineticMul(row, opts);
    const userScale = (opts.scale > 0 ? +opts.scale : 1);
    // FX ride the cube root; the ledger rides the 2/3 power. See THE KINETIC LAW.
    const fxScale = userScale * (kin ? kin.pow : 1);
    const strScale = userScale * (kin ? kin.str : 1);
    const sever = severOf(row, opts, kin);
    // The composers read `opts.scale`. Hand them the FX-side number rather than
    // teaching two more functions about kinetics — one substitution, and any
    // third-party composer registered by another file gets it for free.
    const fxOpts = (fxScale === userScale) ? opts : Object.assign({}, opts, { scale: fxScale });

    // ---- 1) DRAW. The composer owns every particle; we own no geometry. ---
    // The composer is raised inside the BUS SCOPE (see busDepth below). The
    // two built-in composers tag their opts `_impact` so demolition.js's blast
    // hook knows this warhead has already been accounted for; a THIRD-PARTY
    // composer (city/nukefx.js registers one) cannot be relied on to remember
    // that, so the scope makes it structural instead of a convention. Without
    // this, any custom composer that calls cityExplosion would have its
    // structural damage counted twice — once by the row, once by the wrap.
    const composer = COMPOSERS[row.fx] || COMPOSERS.heavy || COMPOSERS.blast;
    // ONE IDENTITY FOR THIS DETONATION, minted before anything draws. The
    // near-field vehicle pass runs inside the composer (it is a wrapper on the
    // blast primitives) and the wave runs seconds later off `opts`, so both
    // need the same number to agree they are the same event. `pendingCarId` is
    // the hand-off and is only ever read synchronously inside the composer —
    // the same discipline `busDepth` right below it relies on.
    opts._carBlastId = pendingCarId = ++carBlastSeq;
    busDepth++;
    try { composer(x, y, z, row, fxOpts); } catch (e) {}
    finally { busDepth--; if (busDepth < 0) busDepth = 0; pendingCarId = 0; }

    // ---- 2) FEEL. Shake / rumble / flash, scaled by camera distance so a
    //        strike across the map rumbles instead of slapping the lens. The
    //        blast composers already shake for their own power; we only ADD
    //        the ordnance-class extras (long rumble, forced whiteout).
    if (!opts.quiet) {
      const att = camAtten(x, y, z);
      if (row.shake != null && CBZ.shake) { try { CBZ.shake(row.shake * fxScale * att); } catch (e) {} }
      if (row.quake > 0) addRumble(x, z, row.quake, row.power * fxScale, att);
      if (row.flashbang && CBZ.el && CBZ.el.flash) {
        try {
          const fl = CBZ.el.flash;
          fl.classList.remove("go"); void fl.offsetWidth; fl.classList.add("go");
        } catch (e) {}
      }
      // SOUND LAGS LIGHT. You see a distant detonation, and the bang arrives
      // `distance / 343` seconds later. It is one extra argument and it is the
      // single cheapest cue in the game for making SCALE legible: a nuke seen
      // from two kilometres flashes in silence for six full seconds before it
      // reaches you, and no amount of geometry says "that was far away and
      // enormous" as clearly. `CBZ.sfx` already supports `delay` and `dist`
      // (dist drives its own attenuation + far-field muffle bus), so this is
      // reuse, not a new system. Capped so a bug can never schedule a cue
      // minutes out, and skipped entirely under ~40 m where it would just
      // read as a mistimed sound.
      if (row.sfx && CBZ.sfx) {
        try {
          const d = camDist(x, y, z);
          const vol = blastVolume(row.power * fxScale);
          CBZ.sfx(row.sfx, d > 40 ? { delay: Math.min(9, d / 343), dist: d, volume: vol } : { dist: d, volume: vol });
        } catch (e) {}
      }
    }

    // ---- 2b) GLASS. Ordinary blasts already blow out the windows near them
    //         (buildings.js's structuralBlast wrap -> cityDamageBuilding ->
    //         cityShatter, ~11m for a rocket). HEAVY ordnance should take the
    //         whole block's glass, and that read belongs HERE rather than
    //         re-hand-rolled at each ordnance site — which is exactly the
    //         duplication the migrated callers just deleted. cityShatter skips
    //         panes that are already shattered, so overlapping calls are free.
    //         THE GATE MOVED OFF `struct` (2026-07-27). It used to read
    //         `struct >= 4`, which was a fine proxy while `struct` was a
    //         per-row character number — but the six migrated conventional
    //         rows now all carry 6 (see the block above the table: it is
    //         demolition.js's LEGACY_TO_LEDGER, not a character), so `struct`
    //         had stopped saying anything about how HEAVY the round was and a
    //         hand grenade would have started blowing out a block of glass.
    //         POWER is the honest axis, with a struct escape hatch for the
    //         genuine building-killers whose power is modest (an airliner into
    //         a facade is 2.6). Every row that shattered before still does;
    //         "missile" and "airstrike" — the two 3.0-power rows — are new.
    const heavy = row.power >= 2.4 || row.struct >= 8;
    if (!opts.noDamage && heavy && CBZ.cityShatter) {
      try { CBZ.cityShatter(x, z, row.radius * row.power * fxScale * 0.8); } catch (e) {}
    }

    // ---- 3) STRUCTURE. One call. city/structural.js owns the ledger, the
    //        stage machine, the fire and the collapse choreography; this file
    //        only tells it what hit and how hard. Absent => no-op (rule 2).
    let structResult = 0;
    if (CBZ.CONFIG.IMPACT_STRUCTURAL && !opts.noDamage && row.struct > 0 && CBZ.structure) {
      try {
        structResult = CBZ.structure.hit(x, y, z, row.struct * row.power * strScale, {
          kind: kind, fire: row.fire,
          // Penetration DEPTH rides the cube root too. Newton's impact-depth
          // limit for an eroding penetrator is P/L = sqrt(rho_p / rho_t) — the
          // honest result is that penetration saturates hard with speed rather
          // than growing with it, so a warhead going twice as fast does NOT
          // go twice as deep. A compressed exponent is the whole lesson.
          pen: row.pen * (kin ? Math.min(2.2, kin.pow) : 1),
          // SEVER — the severed WIDTH IN METRES of the struck floor's
          // cross-section. Only geometry-carrying callers (an airframe, a
          // flung vehicle) set `frontal`, so this is 0 for every warhead and
          // the ledger's behaviour is unchanged for them.
          severWidth: sever,
          // A strike is a SUDDEN load; fire is a gradual one. NIST's number:
          // an intact floor survives ~6 floors' worth of suddenly-applied load
          // where it would have survived ~11 applied gradually — a dynamic
          // amplification factor of about 1.8. The ledger uses this to decide
          // whether the load path fails NOW or merely sits at its limit.
          sudden: true,
          dirx: opts.dirx, dirz: opts.dirz,
          by: opts.by, byPlayer: opts.byPlayer, lot: opts.lot,
        });
      } catch (e) {}
    }

    // ---- 3b) THE FACADE REACTS. The RPG has had `CBZ.cityBlastWall` since the
    //          owner filmed a rocket hit a tower and "a few windows popped" —
    //          a debris avalanche pouring down the face, a wound that smokes
    //          for a minute, a parapet block knocked loose near the roofline.
    //          NOTHING BIGGER THAN A ROCKET HAD IT. A JDAM into the same tower
    //          drew a fireball and left the wall serene, because that call
    //          lived at ONE call site (fpsmode's rocket branch) instead of on
    //          the shared verb, and every heavier warhead was authored in a
    //          file that had never read fpsmode.
    //
    //          THE SURFACE INFO IS CHEAP AND ALREADY HERE — no raycast is
    //          invented. `facadeAt` below is the SAME collider-AABB scan
    //          cityBlastWall itself runs to find the roofline, and the same one
    //          cityBreach/cityScorch use; it answers "did this detonation land
    //          on a wall, and which way does that wall face" by snapping to the
    //          nearest face of the box it is inside/beside. If the answer is
    //          "open air", we skip — a scar hanging four metres off a building
    //          is exactly the floating-decal failure this repo keeps catching.
    //          HEAVY ONLY, so a grenade never pays for the scan.
    if (!opts.noDamage && heavy && CBZ.cityBlastWall && CBZ.CONFIG.IMPACT_STRUCTURAL) {
      const face = facadeAt(x, y, z, 1.6);
      if (face) {
        try { CBZ.cityBlastWall(face, face.n, { power: row.power * fxScale }); } catch (e) {}
      }
    }

    // ---- 4) WAVE. Big ordnance arrives over TIME. The ring below applies
    //        the far-field damage as it sweeps; the composer already covered
    //        the near field at t=0. Queued, tick-bounded, quality-capped.
    if (row.wave && CBZ.CONFIG.IMPACT_SHOCKWAVE && !opts.noDamage) {
      queueWave(x, y, z, row, opts, fxScale, strScale);
    }

    // Return a SUMMARY, never the ledger's own record — handing callers a live
    // internal rec invites exactly the kind of outside mutation that makes a
    // shared block impossible to reason about later.
    return {
      kind: kind, x: x, y: y, z: z,
      lot: (structResult && structResult.lot) || null,
      stage: (structResult && structResult.stage) || 0,
    };
  };

  // Convenience shim so a caller holding a THREE.Vector3 / raycast hit does
  // not have to destructure. Same one-line adoption either way.
  I.at = function (pt, kind, opts) {
    if (pt && pt.point) pt = pt.point;
    if (!pt) return null;
    return CBZ.detonate(pt.x, pt.y, pt.z, kind, opts);
  };

  /* ============================================================
     CAMERA ATTENUATION + LOW RUMBLE
     The existing blast path already attenuates its own shake by camera
     distance (crashfx.js). We reuse the SAME curve so an ordnance row's extra
     rumble sits on the same scale as the blast it accompanies, rather than
     inventing a second distance model that disagrees with the first.
     ============================================================ */
  function camDist(x, y, z) {
    const cam = CBZ.camera;
    if (!cam || !cam.position) return 0;
    const d = Math.hypot(x - cam.position.x, y - cam.position.y, z - cam.position.z);
    return isFinite(d) ? d : 0;
  }
  function camAtten(x, y, z) {
    if (!CBZ.camera || !CBZ.camera.position) return 1;
    const d = camDist(x, y, z);
    return Math.max(0.08, Math.min(1, 1.25 - d / 420));   // gentler than the blast's /130: a nuke is felt a LONG way out
  }

  /* ------------------------------------------------------------------
     HOW LOUD IS A GIVEN PAYLOAD — the one curve, shared.

     A grenade and a JDAM made the IDENTICAL boom, because every explosion in
     the game called `CBZ.sfx("explosion")` with no options at all while
     systems/audio.js had supported `{dist, volume}` the whole time (and
     city/nukefx.js was the sole caller that had ever noticed). Scale is the
     cheapest thing an explosion can tell you and we were throwing it away.

     Sound pressure at a fixed range goes as roughly the cube root of yield —
     but `power` in this game is ALREADY a radius-like (cube-root) quantity
     (see THE KINETIC LAW), so pressure is close to linear in `power` and
     LOUDNESS, which is logarithmic in pressure, lands near its square root.
     Hence sqrt. Floored at 1 so nothing on the bus can ever get QUIETER than
     it is today — the distance term in audio.js is what makes far blasts
     recede, and that is a fade, not a nerf. Capped at 2.4 so a nuke saturates
     rather than clipping the bus.
     Exported because crashfx.js's two blast primitives feed the same curve —
     one answer, one place, and a legacy caller that never learned the bus
     still gets the right volume for its own `power`.
     ------------------------------------------------------------------ */
  function blastVolume(power) {
    const p = +power;
    if (!(p > 1) || !isFinite(p)) return 1;
    return Math.min(2.4, Math.sqrt(p));
  }
  I.volumeFor = blastVolume;
  CBZ.blastVolume = blastVolume;

  /* ------------------------------------------------------------------
     WHERE A GROUND-LEVEL DETONATION SITS — and the trap it exists to avoid.

     crashfx.js's cityExplosion reads `elevated = y > 3` and, above that,
     cancels its ground rings, its scorch, its road wash AND shrinks its damage
     footprint to `sqrt(R^2 - (y-1.2)^2)` — which goes IMAGINARY, i.e. NaN,
     i.e. no damage at all, once the seat is more than R above a standing
     chest. That test is an ABSOLUTE world height, and it has been correct for
     the whole life of the game only because every ground-level caller passed
     NO y and silently got 1.0.

     Now that cars sit on real terrain and towns stand on hills, a migrated
     caller that helpfully hands over `floorAt(x,z) + 1.2` would turn a grenade
     thrown on a 10 m rise into a silent dud. So a ground-level caller asks for
     its seat HERE: the real floor, so the fireball is on the hill rather than
     buried in it, hard-clamped strictly under the airburst line so it can
     never trip that branch. On flat ground it returns exactly the 1.0 every
     one of these call sites has always used.

     (The right long-term fix is for `elevated` to mean "above the LOCAL
     ground", not "above y=3" — but that is crashfx's contract and every
     airburst in the game is tuned against it, so it is not this wave's to
     move. Named here so the next person can find it.)
     ------------------------------------------------------------------ */
  I.groundSeat = CBZ.blastSeatY = function (x, z) {
    const f = CBZ.floorAt ? +CBZ.floorAt(x, z) : 0;
    return Math.min(2.9, (isFinite(f) && f > 0 ? f : 0) + 1.0);
  };

  /* ------------------------------------------------------------------
     DID THIS LAND ON A WALL, AND WHICH WAY DOES THAT WALL FACE?

     Not a raycast: a scan of the collider AABBs, which is the identical test
     `cityBlastWall` runs for its own parapet read and `cityBreach`/`cityScorch`
     use to find a facade. A detonation inside (or within `pad` of) a tall box
     is on that box's skin; the nearest of its four vertical faces is the one
     it hit, and that face's outward normal is the direction the debris should
     avalanche. Returns a point ON the face (so the wound is not stamped
     floating in the street) plus `n`, or null for open air.

     Cheap enough to run per heavy blast — one linear pass, no allocation
     beyond the two hoisted scratch objects, and gated so grenades never call
     it. Boxes shorter than a storey are furniture, not facades.
     ------------------------------------------------------------------ */
  const _facePt = { x: 0, y: 0, z: 0, n: { x: 0, y: 0, z: 0 } };
  function facadeAt(x, y, z, pad) {
    const cols = CBZ.colliders;
    if (!cols || !cols.length) return null;
    let best = null, bestPen = Infinity;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c.minX == null) continue;
      const y0 = c.y0 != null ? c.y0 : 0, y1 = c.y1 != null ? c.y1 : 18;
      if (y1 - y0 < 3) continue;                       // a kerb/planter is not a facade
      if (y < y0 - pad || y > y1 + pad) continue;
      if (x < c.minX - pad || x > c.maxX + pad || z < c.minZ - pad || z > c.maxZ + pad) continue;
      // distance to each vertical face; the smallest is the skin we are on
      const dxn = Math.abs(x - c.minX), dxp = Math.abs(c.maxX - x);
      const dzn = Math.abs(z - c.minZ), dzp = Math.abs(c.maxZ - z);
      const m = Math.min(dxn, dxp, dzn, dzp);
      if (m >= bestPen) continue;
      bestPen = m;
      best = c;
      _facePt.y = Math.max(0.8, Math.min(y1 - 0.4, y));
      if (m === dxn)      { _facePt.x = c.minX; _facePt.z = z; _facePt.n.x = -1; _facePt.n.y = 0; _facePt.n.z = 0; }
      else if (m === dxp) { _facePt.x = c.maxX; _facePt.z = z; _facePt.n.x = 1;  _facePt.n.y = 0; _facePt.n.z = 0; }
      else if (m === dzn) { _facePt.x = x; _facePt.z = c.minZ; _facePt.n.x = 0;  _facePt.n.y = 0; _facePt.n.z = -1; }
      else                { _facePt.x = x; _facePt.z = c.maxZ; _facePt.n.x = 0;  _facePt.n.y = 0; _facePt.n.z = 1; }
    }
    return best ? _facePt : null;
  }

  // A rumble is a decaying low shake driven for `dur` seconds. One live rumble
  // at a time (the loudest wins) — stacking them just saturates the camera and
  // costs frames. This is the "ongoing aftershock" beat that separates a bomb
  // from a firecracker, and it is four numbers, not a system.
  let rumble = null;
  function addRumble(x, z, dur, power, att) {
    const amp = Math.min(2.6, 0.35 * power) * att;
    if (rumble && rumble.amp > amp && rumble.t < rumble.dur) return;
    rumble = { x: x, z: z, t: 0, dur: dur, amp: amp };
  }
  function stepRumble(dt) {
    if (!rumble) return;
    rumble.t += dt;
    if (rumble.t >= rumble.dur) { rumble = null; return; }
    const k = 1 - rumble.t / rumble.dur;
    // shake at ~6Hz rather than every frame: a per-frame call to CBZ.shake
    // re-triggers its own envelope and reads as a buzz, not a rumble.
    rumble.acc = (rumble.acc || 0) + dt;
    if (rumble.acc < 0.16) return;
    rumble.acc = 0;
    if (CBZ.shake) { try { CBZ.shake(rumble.amp * k * k); } catch (e) {} }
  }
  I.rumbling = function () { return rumble ? +(1 - rumble.t / rumble.dur).toFixed(3) : 0; };

  /* ============================================================
     THE PROPAGATING BLAST WAVE
     Research (Glasstone/Dolan beat table; Half-Life's explosion model): games
     universally LINEARISE blast falloff rather than using inverse-square,
     because inverse-square goes to infinity at d=0 and generates physics bugs.
     We do the same: linear 1->0 across the ring's reach.

     The wave is a RING QUERY, not a sphere query: each tick we damage only
     what newly fell inside r(t), so a nuke visibly rolls outward and you can
     watch it come. r(t) = speed * t, capped at maxR.

     COST: one pass over lots + one crowd/ped sweep per TICK (not per frame —
     see WAVE_TICK), bounded by maxR and by a hard cap of 2 live waves. On the
     lowest quality tier the tick rate halves and maxR is clamped, so levelling
     a district degrades to fewer, coarser rings rather than a frame cliff.
     ============================================================ */
  const waves = [];
  // hoisted billCar bag for the ring's vehicle pass — a wave ticks 20 Hz for
  // seconds, so this is the one place a per-car literal would actually add up.
  // `ignite: 0` is deliberate and permanent: the RING does not light cars, the
  // near-field pass does. A nuke's front rolling over a district must not be
  // able to seed a fire every 50 ms across the whole nuclear pressure zone.
  const _ringBill = { x: 0, y: 0, z: 0, byPlayer: false, sev: 1, ignite: 0, cause: "explosion" };
  let waveSeq = 0;
  const WAVE_MAX = 2;
  const WAVE_TICK = 0.05;               // seconds between ring evaluations

  function queueWave(x, y, z, row, opts, fxScale, strScale) {
    if (waves.length >= WAVE_MAX) waves.shift();      // oldest wave gives way
    const q = CBZ.qScale ? CBZ.qScale(0.45, 1) : 1;
    if (!(fxScale > 0)) fxScale = 1;
    if (!(strScale > 0)) strScale = 1;
    waves.push({
      x: x, y: y, z: z,
      r: row.radius,                                   // start at the fireball rim — the composer already killed inside it
      // REACH is a radius, so it rides the cube root (Hopkinson-Cranz: for a
      // given overpressure, R = R1 * Y^(1/3)). This is the same law the FX
      // multiplier is built on, which is why one wave and one fireball always
      // stay in proportion however hard the thing that made them arrived.
      maxR: row.wave.maxR * q * fxScale,
      // THERMAL REACH. A row may declare `wave.thermal` as a MULTIPLE of maxR
      // (1.25 for the nuke — the Y^0.41 / Y^0.33 divergence). Absent, it is 0
      // and the extra sweep in stepWaves never fires, so every existing row is
      // byte-for-byte unchanged.
      thermal: row.wave.thermal ? row.wave.maxR * q * fxScale * row.wave.thermal : 0,
      speed: row.wave.speed,
      /* THE LETHALITY MODEL AND THE YIELD KEY IT NEEDS. `lethal` names which
         casualty curve this wave runs (only the nuke row declares one, so
         every other wave keeps the legacy boolean). `fireR` is the row's
         EFFECTIVE fireball radius — radius*power, the same product this
         file's own nuke comment cites — and it is what city/nukefx.js
         inverts the yield back out of. Passing it means the casualty
         fractions follow the row: retune power or radius and the rings, the
         cloud and the death toll all move together, because there is exactly
         one number underneath all three. */
      lethal: row.wave.lethal || null,
      fireR: Math.max(1, (row.radius || 14) * (row.power || 1)) * fxScale,
      power: row.power * fxScale,
      struct: row.struct * (strScale / fxScale),       // the ledger's 2/3 power, net of the power term below

      fire: row.fire,
      kind: row.id,
      by: opts.by, byPlayer: !!opts.byPlayer,
      // Unique per wave. city/structural.js stamps each building it damages
      // with this so one wave can never bite the same building twice as its
      // slow-moving front crawls across a wide footprint. See the ONE HIT PER
      // BUILDING PER WAVE block there for what that bug actually cost.
      id: ++waveSeq,
      // WHICH DETONATION THIS WAVE BELONGS TO. The near-field car pass (the
      // 8th wrapper) already billed the vehicles inside the fireball at t=0;
      // this ring starts at row.radius and the two bands overlap, so without a
      // shared identity a nuke would hit the same car twice on its way out.
      carBlastId: opts._carBlastId || 0,
      acc: 0, done: false,
    });
  }

  function stepWaves(dt) {
    if (!waves.length) return;
    for (let i = waves.length - 1; i >= 0; i--) {
      const w = waves[i];
      w.acc += dt;
      if (w.acc < WAVE_TICK) continue;
      const step = w.speed * w.acc;
      const r0 = w.r, r1 = Math.min(w.maxR, w.r + step);
      w.acc = 0;
      w.r = r1;
      try { sweepRing(w, r0, r1); } catch (e) {}
      // ---- THE THERMAL FRONT OUTRUNS THE BLAST FRONT --------------------
      // Blast radius scales as Y^0.33 and thermal as Y^0.41 (Glasstone &
      // Dolan), so at nuclear yield the two genuinely diverge and the IGNITION
      // zone is meaningfully WIDER than the destruction zone — at very high
      // yield a burn victim is out where the blast can do little more than
      // break windows. This is intentionally NOT painted as an outer ring;
      // world fires are the visual receipt. The wave carries `fire`
      // only as far as maxR, so the game's burn zone WAS its blast zone and
      // the two zones could never disagree.
      //
      // A row whose ignition zone reaches PAST its own blast reach gets one
      // extra sweep out there: amount ~0 (nothing that far out is knocked
      // down — that is the whole point) with the fire term intact. It IGNITES
      // without wounding, which is what a thermal pulse does, and it leaves
      // irregular world fires outside the flattened core instead of a fake
      // circular decal.
      // AS OF 2026-07-28 NO SHIPPING ROW TAKES THIS BRANCH: the nuke's
      // ignition radius (2,016 m) is now INSIDE its 1 psi reach (3,276 m),
      // so its thermal boundary acts as the ceiling in sweepRing instead.
      // The branch is kept because it is the correct handling of the other
      // case and a future high-yield row will take it — Y^0.41 vs Y^0.33
      // means ignition really does overtake blast as yield climbs. It is NOT
      // dead code pretending to be a feature: `thermal` is read on every
      // sweep either way, which is what stops it being a stat fiction.
      if (w.thermal > w.maxR && !w.burned && r1 >= w.maxR) {
        w.burned = true;
        if (CBZ.CONFIG.IMPACT_STRUCTURAL && CBZ.structure && CBZ.structure.sweep) {
          try {
            CBZ.structure.sweep(w.x, w.z, w.maxR, w.thermal, 0.001, {
              kind: w.kind, fire: w.fire * 0.5, by: w.by, byPlayer: w.byPlayer,
              waveId: w.id, y: w.y, dirx: 0, dirz: 0, radial: true,
            });
          } catch (e) {}
        }
      }
      if (r1 >= w.maxR) waves.splice(i, 1);
    }
  }

  // Everything whose distance from ground zero falls in [r0, r1) is caught by
  // the front THIS tick. Linear falloff on the OUTER radius, so the edge of a
  // nuke's reach knocks you down and the middle of it does not.
  /* ---- the two helpers the graded sweep below asks -----------------------
     hash01: this repo's determinism primitive. A death must be identical on
     every client, so the casualty roll is a POSITION HASH and never
     Math.random. Degrades to Math.random only if seed.js is absent, which is
     single-player-only territory anyway.
     lethalFor: the ONE lethality answer. A row that declares
     `wave.lethal:"nuclear"` gets city/nukefx.js's researched USSBS curve;
     everything else gets the pre-2026-07-28 boolean, byte for byte, so this
     change cannot reach any warhead but the nuke. */
  function hash01(x, z, salt) {
    if (CBZ.hash01) { try { return CBZ.hash01(x, z, salt); } catch (e) {} }
    return Math.random();
  }
  function lethalFor(w, r) {
    if (w.lethal === "nuclear" && CBZ.nukeLethalAt) {
      try { return CBZ.nukeLethalAt(r, w.fireR || 126); } catch (e) {}
    }
    // legacy: the flat cliff at 0.75 * maxR
    return (1 - r / (w.maxR + 0.01)) > 0.25 ? 1 : 0;
  }
  function sweepRing(w, r0, r1) {
    const frac = 1 - r1 / (w.maxR + 0.01);            // 1 at ground zero -> 0 at the rim
    const bite = w.power * frac;
    if (bite <= 0.02) return;

    // (a) PEOPLE. Route through the shared blast-damage path the whole game
    //     already uses (crashfx.js's applyBlastDamage, reached via a tiny
    //     cosmetic-free cityExplosion) rather than re-implementing crowd/ped/
    //     cop/player iteration a second time. `noDamage:false` + power tuned
    //     to the ring's bite; radius is the ring band.
    //     WHY NOT a direct crowd sweep: because applyBlastDamage already
    //     encodes the lethal-core rule (0.55R) the owner tuned after filming
    //     "kills a huge amount of people", and duplicating it here would let
    //     the two drift apart. Reuse beats re-derive.
    // cityCrowdCircleKill takes a DISC, not a ring, so every call re-scans the
    // already-cleared core. Over a nuke's ~66 ring ticks that is 66 full sweeps
    // of the crowd system to find the handful of agents in the new band. It is
    // correct either way (the dead stay dead) — it is purely wasted work — so
    // gate it on the front having actually advanced a useful distance.
    /* ---- HOW MANY OF THEM DIE, AND IT IS A MEASURED NUMBER ----------------
       OWNER: "the amount of DEATH in the radius should also be REAL based on
       the research — the percentage."

       `frac > 0.25` was a CLIFF: everyone inside 0.75*maxR died and nobody
       outside it did. That is the "flat blast" the owner objects to, and it
       is not what a nuclear weapon does to a city — Hiroshima killed 86% of
       the people in the first 500 m, 51% at 1.0-1.5 km and 2.4% at 2.5-3 km,
       and the gradient between those is the whole shape of the event.

       lethalFor(w, r) is the ONE answer. For the nuke row it is
       city/nukefx.js's CBZ.nukeLethalAt — the USSBS Hiroshima survey's
       measured killed-by-distance curve, cube-root scaled to this row's own
       inverted yield. For every other row it returns the old boolean
       verbatim, so nothing but the nuke changes by one frame.

       THE ROLL IS A POSITION HASH, NEVER Math.random. A death is gameplay,
       not FX: two clients in a multiplayer city must agree about who is
       standing up afterwards, and CBZ.hash01(x, z, salt) is this repo's
       determinism primitive. Same person, same wave, same verdict, every
       machine. */
    if (CBZ.cityCrowdCircleKill && frac > 0.35 && r1 - (w.crowdR || 0) > 18) {
      w.crowdR = r1;
      const pk = lethalFor(w, r1);
      /* The instanced crowd has no individual identity to roll against, so
         it is killed as a DISC while the fatality is above half and then
         thinned in PATCHES: n discs of radius rp sprinkled through the
         annulus, sized so the covered area is p x the annulus area. Real
         casualty maps are patchy for exactly this reason (shielding), so
         this is closer to the truth than a uniform cull would be — and it
         needs no edit to city/crowd.js, which owns that array. */
      if (pk >= 0.5) {
        try {
          CBZ.cityCrowdCircleKill(w.x, w.z, r1, {
            byCar: true, quiet: true, fromX: w.x, fromZ: w.z, noCrime: !w.byPlayer,
          });
        } catch (e) {}
      } else if (pk > 0.004 && r1 > r0) {
        const band = Math.PI * (r1 * r1 - r0 * r0);
        const N = 6;                                     // hard cap: 6 scans
        const rp = Math.sqrt(Math.max(1, pk * band / (Math.PI * N)));
        for (let k = 0; k < N; k++) {
          const hs = hash01(w.x + k * 37.1, w.z + r1, (w.id | 0) + k);
          const a = hs * 6.2832;
          const rr = r0 + (r1 - r0) * hash01(w.z + k * 11.7, w.x + r1, (w.id | 0) + k + 91);
          try {
            CBZ.cityCrowdCircleKill(w.x + Math.cos(a) * rr, w.z + Math.sin(a) * rr, rp, {
              byCar: true, quiet: true, fromX: w.x, fromZ: w.z, noCrime: !w.byPlayer,
            });
          } catch (e) {}
        }
      }
    }
    if (CBZ.cityPeds && CBZ.cityKillPed) {
      const peds = CBZ.cityPeds;
      for (let i = 0; i < peds.length; i++) {
        const p = peds[i];
        if (!p || p.dead || !p.pos) continue;
        const d = Math.hypot(p.pos.x - w.x, p.pos.z - w.z);
        if (d < r0 || d >= r1) continue;
        const pk = lethalFor(w, d);
        if (pk > 0 && hash01(p.pos.x, p.pos.z, (w.id | 0) + 7) < pk) {
          try { CBZ.cityKillPed(p, { fromX: w.x, fromZ: w.z, force: 14 * frac, fling: 10 * frac, byPlayer: w.byPlayer }, w.kind === "nuke" ? "the blast wave" : "explosion"); } catch (e) {}
        }
      }
    }
    /* THE PLAYER IS NOT ROLLED FOR. A dice roll that silently ends a run is
       the worst thing this could do, so the researched fraction becomes a
       DAMAGE CURVE instead: 100% fatality means damage that will certainly
       kill an unarmoured player, 22% means a mauling you can survive with
       health, and the far rim stings. Same curve, honest gradient, and the
       player's own health/armour/shelter still decide the outcome. */
    const PL = CBZ.player;
    if (PL && !PL.dead && PL.pos && CBZ.cityHurtPlayer) {
      const d = Math.hypot(PL.pos.x - w.x, PL.pos.z - w.z);
      if (d >= r0 && d < r1) {
        const pk = lethalFor(w, d);
        const dmg = w.lethal ? Math.round(30 + 190 * pk) : Math.round(120 * frac);
        if (dmg > 0) { try { CBZ.cityHurtPlayer(dmg, w.x, w.z, w.kind === "nuke" ? "caught in the blast wave" : "caught in an explosion", false, null, false); } catch (e) {} }
      }
    }

    // (a2) VEHICLES. A blast wave that levels a district and leaves the parked
    //      cars showroom-fresh is the single loudest tell that nothing real
    //      happened. Nothing in the shared blast path touched them:
    //      crashfx.js's applyBlastDamage covers crowd/peds/cops/player and
    //      stops there, so the ONLY warhead in the game that ever hurt a car
    //      was the nuke, through a private 130 m loop hand-rolled inside
    //      city/strategic.js. That loop is now redundant — every wave-carrying
    //      warhead gets this, and strategic.js can delete its copy.
    //
    //      Routed through CBZ.cityDamageCar, which already owns the whole
    //      arc (engine HP -> smoke -> fire -> cook-off -> the kill bus for
    //      whoever was inside) and is already wrapped by armored.js and
    //      modshop.js for armour and mods. Re-deriving any of that here would
    //      be exactly the second implementation this file exists to prevent.
    //      Bounded: the ring band is thin, and the pass is capped per tick so
    //      a nuke over a car park cannot spike a frame.
    //      SHARED BILLING (2026-07-27): the per-car work moved into `billCar`
    //      below so this ring pass and the near-field wrapper cannot disagree
    //      about what a blast does to a vehicle — and, more importantly, so a
    //      wave-carrying warhead cannot bill the same car TWICE (once at t=0
    //      through the fireball, again as its own ring rolls over the same
    //      metres). `w.carBlastId` is the detonation's identity; billCar
    //      refuses a second bite from it. Nothing about the ring band, the CAP
    //      or the 240*frac amount moved.
    if (CBZ.cityDamageCar && CBZ.cityCars && frac > 0.15) {
      const cars = CBZ.cityCars;
      let hurt = 0;
      const CAP = 24;                                 // vehicles touched per ring tick
      for (let i = 0; i < cars.length && hurt < CAP; i++) {
        const cv = cars[i];
        if (!cv || cv.dead || !cv.pos) continue;
        const d = Math.hypot(cv.pos.x - w.x, cv.pos.z - w.z);
        if (d < r0 || d >= r1) continue;
        hurt++;
        _ringBill.x = w.x; _ringBill.y = w.y; _ringBill.z = w.z;
        _ringBill.byPlayer = w.byPlayer; _ringBill.sev = frac;
        _ringBill.cause = w.kind === "nuke" ? "nuclear blast" : "explosion";
        billCar(cv, w.carBlastId, 240 * frac, _ringBill);
      }
    }

    // (b) STRUCTURE. The ring wounds every building it crosses, which is what
    //     turns a nuke from a light show into a levelled district. Delegated —
    //     one call, the ledger decides what stage that pushes each lot to.
    //
    //     SQUARED falloff here, linear above for people. That asymmetry is
    //     deliberate and is what gives the blast a readable SHAPE: buildings
    //     need several times a shop's capacity to come down, so a linear ramp
    //     would either level everything to the rim or leave the core standing.
    //     Squaring produces the three bands you actually want to fly over —
    //     flattened core, burning middle, scorched-but-standing edge — while
    //     people keep the gentler linear curve so the far rim still knocks
    //     them down rather than sparing them outright.
    if (CBZ.CONFIG.IMPACT_STRUCTURAL && CBZ.structure && CBZ.structure.sweep) {
      try {
        /* THE IGNITION BOUNDARY IS A CEILING NOW, NOT ONLY A FLOOR — and
           this is a real fault the maxR retune exposed rather than caused.
           `thermal` was only ever read as "ignite BEYOND the reach", because
           for its whole life it was a multiple GREATER than 1 of a maxR that
           was really the collapse radius. maxR is now the 1 psi contour and
           the researched ignition radius (2,016 m) sits INSIDE it, so the
           branch below can no longer fire and the fire term would instead
           have carried ignition out to ~2,457 m — where the fire coefficient
           finally falls under structural.js's FIRE_IGNITE_MIN — a full
           kilometre past where a 16 kt burst can actually light anything.
           One expression fixes both readings: a row's `thermal` is now the
           edge of its ignition zone in EITHER direction. Rows that declare
           no thermal, or declare one outside their reach, are untouched. */
        CBZ.structure.sweep(w.x, w.z, r0, r1, w.struct * bite * frac, {
          kind: w.kind,
          fire: (w.thermal > 0 && w.thermal < w.maxR && r1 > w.thermal) ? 0 : w.fire * frac,
          by: w.by, byPlayer: w.byPlayer,
          sudden: true,                     // a shock front is THE sudden load
          waveId: w.id,                     // one bite per building per wave
          // Seat the ring at the DETONATION HEIGHT. structural.js restored a
          // height gate for exactly this ("an airburst 300 m up must not wound
          // every footprint beneath its ground projection") and then never
          // received the number, so the gate was dead on its only caller and
          // an airburst MOAB was damaging ground floors underneath it.
          y: w.y,
          dirx: 0, dirz: 0, radial: true,
        });
      } catch (e) {}
    }
  }

  I.waveCount = function () { return waves.length; };
  I.waveState = function () {
    return waves.map(function (w) { return { kind: w.kind, r: +w.r.toFixed(1), maxR: +w.maxR.toFixed(1) }; });
  };
  I.clearWaves = function () { waves.length = 0; rumble = null; };

  /* ============================================================
     LEGACY BRIDGE — migrate eight call sites without editing their files.

     `CBZ.cityDamageBuilding(x, y, z, power)` (city/buildings.js) is the
     pre-existing semi-consolidated building-damage entry: aircraft.js,
     playeraircraft.js, airtraffic.js, police.js, vehicles.js and crashfx.js
     all call it. Those files belong to other domains, so instead of editing
     them we WRAP the function, exactly the way buildings.js and demolition.js
     already wrap cityExplosion. Every one of those callers now feeds the
     shared structural ledger for free, with no edit and no behaviour change
     to what cityDamageBuilding itself draws.

     WRAPPER DISCIPLINE (CLAUDE.md, and the bug this repo has been bitten by):
     copy EVERY `*Wrapped` marker forward so a sibling's idempotence guard
     still holds, and make the added handler idempotent per event.
     ============================================================ */
  function wrapDamageBuilding() {
    const orig = CBZ.cityDamageBuilding;
    if (typeof orig !== "function" || orig._impactWrapped) return;
    const wrapped = function (x, y, z, power) {
      const r = orig.apply(this, arguments);
      if (CBZ.CONFIG.IMPACT_BUS && CBZ.CONFIG.IMPACT_STRUCTURAL && CBZ.structure) {
        try {
          CBZ.structure.hit(x, y, z, (power || 1) * 1.0, { kind: "impact", legacy: true });
        } catch (e) {}
      }
      return r;
    };
    for (const k in orig) if (k.endsWith("Wrapped")) wrapped[k] = orig[k];
    wrapped._impactWrapped = true;
    CBZ.cityDamageBuilding = wrapped;
  }

  /* ------------------------------------------------------------------
     BLAST SCOPE — why the legacy bridge has to know a blast is in flight.

     Almost every cityDamageBuilding call in the game is the COSMETIC PARTNER
     of a blast that the ledger is already counting:

       cityExplosion(...)                      <- one rocket
         -> [buildings.js structuralBlast wrap] -> cityDamageBuilding(...)   (a)
         -> [demolition.js onBlast wrap]        -> structure.sweep(...)      (b)

     (a) and (b) are the SAME rocket. Letting both through makes every warhead
     stronger than its table row says, which is exactly the kind of silent
     drift the consolidation exists to kill.

     A timestamp/proximity heuristic cannot fix this, because the wrap chain
     runs (a) BEFORE (b) — at the moment the legacy call arrives there is
     nothing yet to dedupe against. So instead we mark the SCOPE: wrap both
     blast entry points purely to raise a re-entrancy depth for the duration
     of the call, and have structure.hit drop `legacy` hits while it is up.
     The bridge then does only what it was built for — catching the callers
     that stand ALONE (a car ramming a storefront, an ambient plane clipping a
     roof), which is where the eight-call-sites-for-free win actually lives.

     Depth, not a boolean: blasts nest (a chain detonation inside a blast
     handler), and a boolean would be cleared by the inner one.
     WRAPPER DISCIPLINE: every `*Wrapped` marker is copied forward, and the
     wrapper adds no behaviour of its own beyond the counter, so it is safe at
     any position in the chain.
     ------------------------------------------------------------------ */
  function wrapBlastScope(name) {
    const orig = CBZ[name];
    if (typeof orig !== "function" || orig._impactScopeWrapped) return;
    const wrapped = function () {
      blastDepth++;
      lastBlastFrame = frameNo;
      try { return orig.apply(this, arguments); }
      finally { blastDepth--; if (blastDepth < 0) blastDepth = 0; }
    };
    for (const k in orig) if (k.endsWith("Wrapped")) wrapped[k] = orig[k];
    wrapped._impactScopeWrapped = true;
    CBZ[name] = wrapped;
  }

  /* ============================================================
     THE 8TH WRAPPER — EVERY BLAST REACHES THE CARS.

     OWNER: "make cars blow up realistically."

     The census that preceded this found that `applyBlastDamage` (crashfx.js) —
     the shared path EVERY explosion in the game funnels its people-damage
     through — iterates crowd, peds, cops, the player and player-built pieces,
     and then stops. It has never touched `CBZ.cityCars`. So an RPG could land
     between two parked cars, kill everyone on the pavement, carve the wall
     behind them, and leave both cars showroom-fresh; the only warheads that
     ever hurt a vehicle were the three rows carrying a `wave` (nuke, MOAB, a
     falling airliner), through the ring pass in sweepRing above.

     THIS IS A WRAPPER AND NOT A CALL IN `detonate` ON PURPOSE. Half the
     explosions in this game do not come through the bus and never will —
     police C4, a scripted set-piece, a mod, anything a future file writes
     against `cityExplosion` because that is the primitive it found first.
     Wrapping the two primitives is what makes the coupling TOTAL without
     editing a file this domain does not own — the same reasoning
     `wrapDamageBuilding` above is built on, and the same reasoning
     aircraftimpact.js's wrapBoom uses.

     THE EXPLOSION-WRAPPER LAW (CLAUDE.md), all three clauses honoured below:
       * a FRESH marker (`_carBlastWrapped`) so no sibling's guard is aliased;
       * EVERY `*Wrapped` marker copied forward, so a sibling that installs
         after us (armored.js at 54.3) still fails its own idempotence test;
       * a per-event idempotency tag (`opts._carSeen`, demolition.js's
         `_demoSeen` idiom verbatim) plus the per-car `_carBlastId` stamp, so a
         chain that has been layered twice bills a car exactly once.
     ============================================================ */
  let carBlastSeq = 0;      // identity of the detonation currently being drawn
  let pendingCarId = 0;     // handed from detonate() to the composer, synchronously
  const CAR_CAP = 24;       // vehicles billed per blast (sweepRing's own number)
  const CAR_FUSE_CAP = 14;  // cars allowed to be cooking off at the same time

  // How many vehicles are already on fire. This is the hard stop on a chain
  // reaction: past it a blast still WRECKS the cars it reaches, it just stops
  // lighting new ones, so a nuke over a multi-storey car park cannot turn into
  // an unbounded cascade of detonations queued against each other.
  function carsCooking() {
    const cars = CBZ.cityCars;
    if (!cars) return 0;
    let n = 0;
    for (let i = 0; i < cars.length; i++) { const c = cars[i]; if (c && c._onFire && !c._exploded) n++; }
    return n;
  }

  /* ONE CAR, ONE BLAST. Shared by the near-field wrapper and sweepRing's ring
     pass so the two can never drift, and so a wave-carrying warhead cannot
     bill the same vehicle in both.
       amount  engine-HP points, already distance-scaled by the caller
       o.sev   0..1 severity, drives the crater and the ignition roll
       o.ignite 0..1 chance this blast lights the car outright (the row's `fire`)
     Everything goes through CBZ.cityDamageCar / cityCarIgnite — never a raw
     `.hp -=` — so armour (armored.js), mods (modshop.js), the smoke/fire/cook
     ladder and the kill bus for whoever is inside all still apply. */
  let carSweepDepth = 0;
  function billCar(cv, blastId, amount, o) {
    if (!cv || cv.dead || cv._exploded || cv._husk || !cv.pos) return false;
    if (!CBZ.cityDamageCar) return false;
    if (blastId && cv._carBlastId === blastId) return false;     // already billed by this detonation
    if (blastId) cv._carBlastId = blastId;
    carSweepDepth++;
    try { billCarInner(cv, amount, o); }
    finally { carSweepDepth--; if (carSweepDepth < 0) carSweepDepth = 0; }
    return true;
  }
  // THE DEPTH LIVES ON billCar, not on the sweep, so BOTH entries are covered:
  // the near-field wrapper and the wave's ring pass. Damaging a car can cook it
  // off, a cook-off is a detonation, and a detonation re-enters the wrapper —
  // so without this a chain could recurse on the STACK instead of travelling
  // through each car's fuse. (It matters most on the CAR_COOKOFF_V2-off
  // degrade path, where a drained car still pops in the same frame.)
  function billCarInner(cv, amount, o) {
    const sev = Math.max(0, Math.min(1, o.sev == null ? 1 : o.sev));
    // (1) THE DENT. A car that "took blast damage" and is still geometrically
    //     pristine is a number, not an event — so the same vertex crater the
    //     crash path stamps goes on, driven from the blast bearing, and with
    //     it the whole consequence ladder crashdeform already owns (hood
    //     sprung, door hanging, glass crazed, wheel splayed, chassis bent).
    if (CBZ.cityCarImpact && sev > 0.08) {
      let ux = cv.pos.x - o.x, uz = cv.pos.z - o.z;
      const ul = Math.hypot(ux, uz);
      if (ul > 1e-3) { ux /= ul; uz /= ul; } else { ux = 0; uz = 1; }
      const half = ((cv.dims && cv.dims.width) || 2) * 0.5;
      try {
        CBZ.cityCarImpact(cv,
          { x: cv.pos.x - ux * half, y: 0.95, z: cv.pos.z - uz * half },
          { x: ux, y: -0.15, z: uz },                    // the metal moves AWAY from the blast
          Math.min(34, 4 + sev * 30),
          { vel: { x: -ux * 6 * sev, z: -uz * 6 * sev } });
      } catch (e) {}
    }
    // (2) THE GLASS. A pressure wave takes the windows before it takes the
    //     panels; the crater ladder only crazes glass once a panel is deeply
    //     caved, which is right for a kerb scrape and wrong for an overpressure.
    if (sev > 0.3 && CBZ.cityCarFrost) { try { CBZ.cityCarFrost(cv); } catch (e) {} }
    // (3) THE DAMAGE. `blast: true` is what tells vehicles.js this is
    //     overpressure and not a rifle round — a drained engine then cooks off
    //     on a short jittered fuse instead of popping in the same frame, which
    //     is the whole difference between one explosion and a rolling cascade.
    try {
      CBZ.cityDamageCar(cv, amount, {
        byPlayer: !!o.byPlayer, blast: true,
        fromX: o.x, fromZ: o.z,
        cause: o.cause || "explosion",
      });
    } catch (e) {}
    // (4) THE FIRE. Fuel-carrying ordnance lights what it does not kill. Rolled
    //     against the row's own `fire`, scaled by severity, and refused once
    //     the concurrent-cook budget is spent — `o.budget` is a live counter
    //     the caller seeds from carsCooking() once, so the cap holds ACROSS a
    //     whole sweep and not just per car.
    if (o.ignite > 0 && !cv._onFire && !cv.dead && CBZ.cityCarIgnite &&
        (!o.budget || o.budget.n > 0) && Math.random() < o.ignite * sev) {
      if (o.budget) o.budget.n--;
      try { CBZ.cityCarIgnite(cv, !!o.byPlayer); } catch (e) {}
    }
  }
  I.billCar = billCar;                 // probes read this; nothing else calls it

  // The near-field pass: every car inside the blast's own effective radius.
  // SQUARED falloff, deliberately — linear would flatten every car out to the
  // rim and leave no readable shape. An RPG (power 1.9, radius 13 => R 24.7 m)
  // therefore cooks off what is within ~10 m, heavily wounds to ~15 m, and
  // dents to ~20 m, which is the gradient a real blast leaves in a car park.
  const _fuseBudget = { n: 0 };            // hoisted: no per-blast allocation
  function carSweep(x, y, z, opts, defRadius, blastId) {
    const cars = CBZ.cityCars;
    if (!cars || !cars.length) return 0;
    // NO NESTED SWEEPS — see the depth block on billCar above. A 24-wide
    // fan-out that can re-enter itself is a frame-killer and, on the
    // CAR_COOKOFF_V2-off path, an unbounded one.
    if (carSweepDepth > 0) return 0;
    const power = (opts && opts.power) || 1;
    const R = ((opts && opts.radius) || defRadius) * power;
    if (!(R > 0.5)) return 0;
    const row = opts && opts.ordnance ? TABLE[opts.ordnance] : null;
    // A legacy blast declares no ordnance row; 0.10 is between the shaped
    // charge (0.05) and the fuel-carrying rows, i.e. the honest average of the
    // things that reach this path without a name.
    const fire = row ? row.fire : 0.10;
    const byPlayer = !!(opts && opts.byPlayer);
    _fuseBudget.n = Math.max(0, CAR_FUSE_CAP - carsCooking());
    const bill = {
      x: x, y: y, z: z, byPlayer: byPlayer, sev: 1, ignite: fire,
      budget: _fuseBudget,
      cause: row && row.id === "carcook" ? "burned in the car" : "explosion",
    };
    let hurt = 0;
    for (let i = 0; i < cars.length && hurt < CAR_CAP; i++) {
      const cv = cars[i];
      if (!cv || cv.dead || cv._exploded || !cv.pos) continue;
      const dx = cv.pos.x - x, dz = cv.pos.z - z;
      const d = Math.hypot(dx, dz);
      if (d >= R) continue;
      bill.sev = 1 - d / R;
      if (billCar(cv, blastId, 150 * power * bill.sev * bill.sev, bill)) hurt++;
    }
    return hurt;
  }

  function wrapCarBlast(name, defRadius) {
    const orig = CBZ[name];
    if (typeof orig !== "function" || orig._carBlastWrapped) return;
    const wrapped = function (x, z, opts) {
      const r = orig.apply(this, arguments);
      try {
        if (CBZ.CONFIG.IMPACT_CAR_BLAST && CBZ.cityCars &&
            (!CBZ.game || CBZ.game.mode === "city") &&
            !(opts && (opts.noDamage || opts._carSeen))) {
          if (opts) opts._carSeen = true;          // one blast, one bill (demolition's idiom)
          // A blast with no `ordnance` tag never came through CBZ.detonate.
          // Counted, not refused — see CBZ.blastAudit().unrowed.
          if (!(opts && opts.ordnance) && unrowedBlasts < 1e9) unrowedBlasts++;
          const y = opts && opts.y != null ? opts.y : 1.0;
          carSweep(x, y, z, opts || {}, defRadius, pendingCarId || (++carBlastSeq));
        }
      } catch (e) { /* a coupling failure must never break the shared blast chain */ }
      return r;
    };
    for (const k in orig) if (/Wrapped$/.test(k)) wrapped[k] = orig[k];
    wrapped._carBlastWrapped = true;
    CBZ[name] = wrapped;
  }

  /* ============================================================
     TICK. Order 34.4 — immediately BEFORE city/demolition.js's 34.5, so a
     wave that condemns a lot this frame is acted on by the demolition phase
     ticker in the SAME frame rather than one frame late. Early-outs to a
     couple of length checks when nothing is exploding.
     ============================================================ */
  if (CBZ.onUpdate) CBZ.onUpdate(34.4, function (dt) {
    // Lazy, idempotent installs. 34.4 sits AFTER buildings.js's own wrap
    // (order 0.01) and BEFORE demolition.js's (34.5), which is exactly the
    // position the scope needs: it must enclose buildings.js's
    // structuralBlast -> cityDamageBuilding call, and must NOT enclose
    // demolition.js's onBlast (which is a real, wanted accumulation).
    frameNo++;                            // drives the one-frame legacy-bridge window
    wrapDamageBuilding();
    wrapBlastScope("cityExplosion");
    wrapBlastScope("cityAirstrikeExplosion");
    // The vehicle coupling installs AFTER the scope wraps and is therefore
    // OUTSIDE them, which is what we want: it runs once the whole legacy chain
    // (buildings' structuralBlast, demolition's onBlast, the armour coupling)
    // has finished, so a car it cooks off cannot re-enter a half-finished
    // blast. The defaults mirror each primitive's own `opts.radius ||` value
    // in crashfx.js, so a caller that omits a radius gets the same R the
    // fireball itself used.
    wrapCarBlast("cityExplosion", 6);
    wrapCarBlast("cityAirstrikeExplosion", 12);
    if (!waves.length && !rumble) return;
    const d = dt > 0.25 ? 0.25 : dt;      // spike-cap: a stalled frame must not teleport the front
    stepWaves(d);
    stepRumble(d);
  });

  /* ============================================================
     CBZ.impactAudit() — THE RATCHET (BLOCK LAW rule 5).

     Counts the structural-damage ACCUMULATORS in the game that are still
     independent of the shared ledger. Each one is a place where "how hurt is
     this building" is tracked separately and can therefore disagree with the
     others. Before this change there were three:

       1. city/demolition.js  `hp`      Map<lot, number>      -> MIGRATED
       2. city/fracture.js    `wounds`  Map<"b|face", score>  -> MIGRATED
       3. city/buildings.js   `wallDmg` Map<collider, rec>    -> still separate
          (per-WALL cosmetic escalation; buildings.js is owned by another
          domain, so it is the remaining legacy entry and the next target)

     A migrated file drops its `_legacyAccum` marker; this counter goes down.
     Pin it in tools/math-gate.mjs's PASS block at its current value. It may
     only ever DECREASE — copying CBZ.treeAudit()'s contract exactly.
     ============================================================ */
  CBZ.impactAudit = function () {
    let n = 0;
    if (CBZ.cityDemolition && CBZ.cityDemolition._legacyAccum) n++;
    if (CBZ.cityFracture && CBZ.cityFracture._legacyAccum) n++;
    if (CBZ._cityWoundWallRec) n++;      // buildings.js per-wall wound map (not this domain's to move yet)
    return n;
  };

  /* ============================================================
     CBZ.blastAudit() — THE RATCHET FOR "EVERY PAYLOAD SPEAKS THE BUS".

     `impactAudit` counts duplicated structural LEDGERS. This counts duplicated
     ORDNANCE: the call sites that still hand-roll a power/radius pair straight
     into cityExplosion instead of naming a table row.

     ADOPTION IS DECLARED AT LOAD, NOT ON THE FIRST TRIGGER PULL — the same
     discipline city/playeraircraft.js's `CBZ.ordnanceSite` uses, and for the
     same reason: the audit must report what the world is WIRED with, not what
     has happened to be fired since boot. A migrated file's whole cost is one
     line next to its detonation:

         (CBZ.ordnanceBusSites = CBZ.ordnanceBusSites || []).push("fps:rocket");

     AN ARRAY AND NOT A FUNCTION, deliberately: index.html loads this file at
     754 and FOUR of the six migrated callers (fpsmode, aircraft,
     vehicles, playeraircraft) load BEFORE it. A `CBZ.ordnanceBusSite(...)`
     call at their load time would have found `undefined` and silently
     declared nothing, and the audit would have read a confident, wrong zero —
     which is precisely the "an audit nobody has executed is not a
     measurement" failure CLAUDE.md keeps catching. A plain array a caller
     creates-or-appends is order-free by construction.

     FIELDS
       busKinds       rows in the ordnance table
       busAdopted     declared sites, of KNOWN_SITES
       handRolled     KNOWN_SITES that have NOT declared. **MAY ONLY GO DOWN.**
       unrowed        blasts seen by the vehicle wrapper carrying no `ordnance`
                      tag since boot — the LIVE version of the same question,
                      and the one that catches a site nobody remembered to add
                      to KNOWN_SITES. Non-zero is not automatically a failure
                      (police C4, scripted set-pieces and mods legitimately
                      reach the primitives directly) but it is the number to
                      look at when asking "what is still not on the bus".
       carsCoupled    both blast primitives carry the vehicle wrapper
       husks          burnt-out car wrecks currently standing in the world
       chainDepthCap  how deep a cook-off cascade may nest ON THE STACK (1 —
                      chains travel through fuses, i.e. through TIME)
       wrappers       how many modules are layered on cityExplosion right now
     ============================================================ */
  const BUS_SITES = Object.create(null);
  let unrowedBlasts = 0;
  // The six hand-rolled detonations this domain owns. fpsmode's 40 mm grenade
  // launcher is deliberately NOT a seventh: it is byte-identical to the rocket
  // (weapon-data gives both 1.9/13) and shares the exact same `w.explosive`
  // branch, so one declaration covers both weapons and inventing a second id
  // would flatter the count.
  const KNOWN_SITES = ["fps:rocket", "combat:grenade", "armor:tank-fallback",
                       "air:missile-pool", "air:player-missile-fallback", "vehicles:carcook"];
  I.site = CBZ.ordnanceBusSite = function (id, kind) {
    if (id) BUS_SITES[id] = kind || true;
  };
  function drainSites() {
    const q = CBZ.ordnanceBusSites;
    if (!q || !q.length) return;
    for (let i = 0; i < q.length; i++) if (q[i]) BUS_SITES[q[i]] = true;
  }
  drainSites();                       // the four callers that load before us
  CBZ.blastAudit = function () {
    drainSites();                     // ...and anything declared since (idempotent)
    let adopted = 0;
    for (let i = 0; i < KNOWN_SITES.length; i++) if (BUS_SITES[KNOWN_SITES[i]]) adopted++;
    let wrappers = 0;
    const be = CBZ.cityExplosion;
    if (be) for (const k in be) if (/Wrapped$/.test(k)) wrappers++;
    return {
      busKinds: Object.keys(TABLE).length,
      busAdopted: adopted,
      handRolled: KNOWN_SITES.length - adopted,
      unrowed: unrowedBlasts,
      carsCoupled: !!(CBZ.cityExplosion && CBZ.cityExplosion._carBlastWrapped &&
                      CBZ.cityAirstrikeExplosion && CBZ.cityAirstrikeExplosion._carBlastWrapped),
      husks: CBZ.cityCarHusks ? CBZ.cityCarHusks() : 0,
      chainDepthCap: 1,
      wrappers: wrappers,
      sites: Object.keys(BUS_SITES),
    };
  };

  /* ============================================================
     DEV/QA surface — read live bus state from a CDP probe without rendering.
     (CLAUDE.md's closed loop is math over live state; these are the numbers.)
     ============================================================ */
  // What a given shot is actually worth, without firing it. This is the number
  // to read from a probe when asking "why did/didn't that tower come down".
  I.priceOf = function (kind, opts) {
    const row = TABLE[kind];
    if (!row) return null;
    opts = opts || {};
    const kin = kineticMul(row, opts);
    const us = (opts.scale > 0 ? +opts.scale : 1);
    const fx = us * (kin ? kin.pow : 1), st = us * (kin ? kin.str : 1);
    return {
      kind: kind, E: kin ? Math.round(kin.E) : 0,
      tnt: kin ? +(kin.E / TNT_J).toFixed(2) : 0,
      fxScale: +fx.toFixed(3), strScale: +st.toFixed(3),
      amount: +(row.struct * row.power * st).toFixed(2),
      fireball: +(row.radius * row.power * fx).toFixed(1),
      pen: +(row.pen * (kin ? Math.min(2.2, kin.pow) : 1)).toFixed(2),
      severWidth: +severOf(row, opts, kin).toFixed(2),
      reach: row.wave ? +(row.wave.maxR * fx).toFixed(1) : 0,
    };
  };

  I.debug = function () {
    return {
      rows: Object.keys(TABLE).length,
      kineticRows: Object.keys(TABLE).filter(function (k) { return TABLE[k].refE > 0; }),
      composers: Object.keys(COMPOSERS),
      waves: I.waveState(),
      rumble: I.rumbling(),
      audit: CBZ.impactAudit(),
      flags: {
        bus: !!CBZ.CONFIG.IMPACT_BUS,
        wave: !!CBZ.CONFIG.IMPACT_SHOCKWAVE,
        struct: !!CBZ.CONFIG.IMPACT_STRUCTURAL,
      },
    };
  };
})();
