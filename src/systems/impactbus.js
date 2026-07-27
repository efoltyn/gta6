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
                 a row is `radius * power`, NOT `radius` — "rpg" is 8*1.9 = 15m,
                 which is what fpsmode's rocket always was.
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

  // ---- conventional ordnance (migrated from existing call sites) ----------
  I.define("grenade",   { power: 1.0, radius: 6,  struct: 0.8, fire: 0.05 });
  I.define("c4",        { power: 1.4, radius: 7,  struct: 1.6, fire: 0.10 });
  I.define("rpg",       { power: 1.9, radius: 8,  struct: 2.0, fire: 0.12 });
  I.define("tank",      { power: 2.2, radius: 9,  struct: 2.4, pen: 3,  fire: 0.05 });
  I.define("missile",   { power: 2.6, radius: 11, struct: 3.0, pen: 5,  fire: 0.15, fx: "heavy" });
  I.define("airstrike", { power: 3.0, radius: 12, struct: 3.6, fire: 0.20, fx: "heavy" });
  I.define("carcook",   { power: 0.9, radius: 5,  struct: 0.5, fire: 0.25 });
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
  // A stick of these is what a B2 drops. Individually modest; the spectacle
  // is the WALK across a district, which is city/ordnance.js's job to stagger.
  I.define("bomb",   { power: 2.4, radius: 13, struct: 4.0, pen: 6,  fire: 0.30, fx: "heavy" });
  I.define("jdam",   { power: 3.2, radius: 16, struct: 7.0, pen: 18, fire: 0.35, fx: "heavy",
                       quake: 1.2 });
  // radius*power = 41m fireball; the other 110m of reach is the wave.
  // fx "moab" is city/nukefx.js's composer. Naming it here rather than leaving
  // "heavy" for that file to re-point is the preferred end state: the table is
  // the single declaration, and if nukefx never loads the lookup simply falls
  // through to COMPOSERS.heavy — which is the degrade path by construction.
  I.define("moab",   { power: 4.6, radius: 9, struct: 16,  pen: 10, fire: 0.60, fx: "moab",
                       quake: 4, wave: { speed: 140, maxR: 150 }, flashbang: true });

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
  // radius*power = 126m of instantly-vaporised fireball, then the wave rolls
  // from there out to 620m over ~3.2s at 190 m/s. If city/nukefx.js is absent
  // this degrades to the "heavy" composer at that same 126m — a very large
  // airstrike plus a white flash, which is the right shape of wrong.
  I.define("nuke", {
    power: 9, radius: 14, struct: 55, pen: 0, fire: 1, fx: "nuke",
    quake: 14, flashbang: true, sfx: "explosion",
    // thermal 1.25: the ignition ring outranges the destruction ring, because
    // thermal radius goes as Y^0.41 and blast radius as Y^0.33. This is the
    // ONE row that declares it — a chemical warhead's fireball and its blast
    // are the same event and do not diverge. It is also the number
    // city/nukefx.js draws its burn annulus at, so the ring you SEE burning
    // and the ring that actually lights buildings are the same radius.
    wave: { speed: 190, maxR: 620, thermal: 1.25 },
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
    busDepth++;
    try { composer(x, y, z, row, fxOpts); } catch (e) {}
    finally { busDepth--; if (busDepth < 0) busDepth = 0; }

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
          CBZ.sfx(row.sfx, d > 40 ? { delay: Math.min(9, d / 343), dist: d } : { dist: d });
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
    if (!opts.noDamage && row.struct >= 4 && CBZ.cityShatter) {
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
      // ring is meaningfully WIDER than the destruction ring — at very high
      // yield a burn victim is out where the blast can do little more than
      // break windows. city/nukefx.js already draws that outer ring; until
      // now it was light with no consequence, because the wave carries `fire`
      // only as far as maxR, so the game's burn zone WAS its blast zone and
      // the two rings could never disagree.
      //
      // A row that declares `thermal` gets one extra sweep past its own reach:
      // amount ~0 (nothing out there is knocked down — that is the whole
      // point) with the fire term intact. It IGNITES without wounding, which
      // is what a thermal pulse does, and it is what leaves a burning outer
      // band around a flattened core instead of a clean edge.
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
    if (CBZ.cityCrowdCircleKill && frac > 0.35 && r1 - (w.crowdR || 0) > 18) {
      w.crowdR = r1;
      try {
        CBZ.cityCrowdCircleKill(w.x, w.z, r1, {
          byCar: true, quiet: true, fromX: w.x, fromZ: w.z, noCrime: !w.byPlayer,
        });
      } catch (e) {}
    }
    if (CBZ.cityPeds && CBZ.cityKillPed) {
      const peds = CBZ.cityPeds;
      for (let i = 0; i < peds.length; i++) {
        const p = peds[i];
        if (!p || p.dead || !p.pos) continue;
        const d = Math.hypot(p.pos.x - w.x, p.pos.z - w.z);
        if (d < r0 || d >= r1) continue;
        if (frac > 0.25) {
          try { CBZ.cityKillPed(p, { fromX: w.x, fromZ: w.z, force: 14 * frac, fling: 10 * frac, byPlayer: w.byPlayer }, w.kind === "nuke" ? "the blast wave" : "explosion"); } catch (e) {}
        }
      }
    }
    // the player is knocked about but the falloff means the far rim only stings
    const PL = CBZ.player;
    if (PL && !PL.dead && PL.pos && CBZ.cityHurtPlayer) {
      const d = Math.hypot(PL.pos.x - w.x, PL.pos.z - w.z);
      if (d >= r0 && d < r1) {
        const dmg = Math.round(120 * frac);
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
        try {
          CBZ.cityDamageCar(cv, 240 * frac, {
            byPlayer: w.byPlayer, blast: true,
            fromX: w.x, fromZ: w.z,
            cause: w.kind === "nuke" ? "nuclear blast" : "explosion",
          });
        } catch (e) {}
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
        CBZ.structure.sweep(w.x, w.z, r0, r1, w.struct * bite * frac, {
          kind: w.kind, fire: w.fire * frac, by: w.by, byPlayer: w.byPlayer,
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
