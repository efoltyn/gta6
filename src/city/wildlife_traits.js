/* ============================================================
   city/wildlife_traits.js — EVERY ANIMAL IS AN INDIVIDUAL.

   OWNER, verbatim: "all wildlife including sharks should have varying size
   (viable) and varying hunger (visible behavior and movement)".

   Before this file every animal of a species was EXACTLY sp.scale and no wild
   animal carried a hunger value at all. A shoal of forty mackerel was forty
   identical mackerel; a great white was the same great white every time; and
   the only thing separating a fed shark from a starving one was a satiation
   TIMER nobody could see. Two facts, and neither of them was in the world.

   This file owns both, for land and sea alike, and it owns nothing else — the
   engine (wildlife.js) asks it for numbers and spends them.

   ---- 1. SIZE ---------------------------------------------------------------
   Every individual draws its own multiplier from its SPAWN POSITION, never
   from Math.random: CBZ.hash01 is order-independent, so the same seed grows
   the same fish in the same square metre of sea forever, and adding a species
   tomorrow cannot shuffle the one that spawned before it (the seeded rng
   stream can — that is why it is not used here).

   The SPREAD is a species trait and nobody has to author it. It falls out of
   two fields every row already has:
     * rarity — a rare animal is a rarer draw from a wider distribution.
     * herd   — a schooling species is UNIFORM (that is what schooling IS: a
                bait ball of forty near-identical bodies), a solitary predator
                is not. A row may override the whole thing with `sizeVary`.

   The draw is two hash channels summed, i.e. TRIANGULAR — most animals sit
   near their species norm and the extremes are genuinely uncommon, which is
   the difference between "varied" and "noise".

   ..AND THEN THE BIG ONE. One in a few hundred individuals rolls off a second
   channel into a 1.3-1.65x tail. That is the twenty-two-foot great white you
   tell somebody about, the bull elk with the impossible rack, and it costs the
   line marked THE BIG ONE below and nothing else.

   SIZE IS LOAD-BEARING, NOT COSMETIC. wildlife.js routes hp, bite, speed, turn
   rate, reach, sense radius, seize hold/escape, ragdoll mass, car-impact mass,
   herd spacing, LOD radius, swim depth, shore clearance and the butchered meat
   yield through the INDIVIDUAL's size instead of the species constant. The
   exponents are predator.js's own published power laws (see its ARCH header:
   radii ~ scale^0.5, patience ~ scale^0.7, hold ~ scale^0.9, escape ~
   scale^-0.9, rush ~ scale^-0.13) so a big individual and a big SPECIES are
   the same kind of big.

   ---- 2. HUNGER -------------------------------------------------------------
   A scalar in 0..1 that DRIFTS UP on the clock and DROPS WHEN THE ANIMAL EATS.
   It is deliberately not a HUD number — there is no HUD, no icon, no toast,
   and there never will be. You read it off the animal:

     STARVING (h -> 1)   moves nearly constantly, cruises ~30% faster, changes
                         heading often and roams far from home, stops to loiter
                         almost never, notices prey from ~35% further out,
                         circles a third less before committing, holds a claim
                         on prey it can barely reach, comes into shallow water
                         and up to boats it would otherwise refuse, and is
                         visibly LEAN (the belly draws in).
     FED (h -> 0)        drifts at ~70% speed, stands or hovers for long
                         stretches, will not even LOOK for prey, breaks off
                         early if something makes it, keeps its distance, and
                         is visibly FULL (the belly rounds out).

   Somebody watching one patch of water for thirty seconds can tell which is
   which without being told. That is the whole specification.

   ---- 3. WHAT HUNGER IS THE SPINE OF ---------------------------------------
   Hunger is not a per-animal stat that happens to move a speed multiplier; it
   is the one number the whole food web hangs off, and wildlife.js spends it in
   six places that are each visible from outside without a single word of UI:

     * SCAVENGING. A hungry land predator that smells a carcass takes the free
       meal instead of chasing. Shoot a deer, walk away, and the thing that
       comes out of the treeline to stand over it was hungry. A fed one never
       comes, and never even runs the scan.
     * THE HERD BUNCHES. A hungry hunter in range packs a herd into a knot
       (`herd.bunch`, decayed over ~8s) — tighter cohesion, smaller personal
       space. In the water that has a name: a bait ball. You read the predator's
       hunger off the SHAPE of the prey, from a distance at which you cannot
       see the predator at all.
     * PREY SPOOKS HARDER. The alarm ripple's radius and amplitude both scale
       with the hunter's drive, so a fed wolf drifts through a grazing meadow
       and a starving one empties it from half again as far out.
     * IT HUNTS OUT OF RANGE. The biome fence opens for an animal that is both
       starving AND holding a claim, and closes again the frame the hunt ends.
     * THE FISH RIDES HIGH. Swim depth leans shallow with hunger: a starving
       shark cruises where its fin shows and where the swimmers are, a fed one
       hangs down in blue water.
     * THE EYES. A starving predator's aggro eyes are lit while it is merely
       cruising, not only while it stalks. It carries at night and over water.

   And it goes DOWN in exactly one function (wildlife.js's `mealFrom`), paid on
   ARRIVAL at the body rather than on the decision to go, receipted per
   (eater, carcass) so the three paths that can report one mouthful — the
   universal hook in killAnimal, the food chain's startFeed, and scavenging —
   can never feed an animal twice. A carcass gives a smaller share to each
   successive eater, so one deer does not feed a county.

   ---- BUDGET ----------------------------------------------------------------
   This ticks for every animal in a 25 km sea, so it is allocation-free per
   frame in the same discipline creature_combat.js's header describes: every
   per-actor value lives in a scratch object created ONCE at spawn, and the
   behaviour multipliers are recomputed only when hunger has actually moved a
   quantised step (~2%, i.e. every several seconds), never per frame. The
   per-frame cost of a calm animal is one add, one compare and one clamp.

   ---- FLAGS -----------------------------------------------------------------
   CBZ.CONFIG.WILDLIFE_SIZE_VARY — off: every animal is exactly sp.scale again.
   CBZ.CONFIG.WILDLIFE_HUNGER    — off: no hunger, no body cue, no modulation.
   Both default ON and each is a one-line revert.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const C = CBZ.CONFIG || (CBZ.CONFIG = {});

  if (C.WILDLIFE_SIZE_VARY == null) C.WILDLIFE_SIZE_VARY = true;
  if (C.WILDLIFE_HUNGER == null) C.WILDLIFE_HUNGER = true;
  function SIZE_ON() { return C.WILDLIFE_SIZE_VARY !== false; }
  function HUNGER_ON() { return C.WILDLIFE_HUNGER !== false; }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  // Position hash. hash01 quantises to decimetres, so two animals a hand's
  // width apart still draw independently and float dust cannot flip a value.
  function h01(x, z, salt) {
    return CBZ.hash01 ? CBZ.hash01(x, z, salt) : 0.5;
  }

  // ============================================================
  //  SIZE
  // ============================================================
  // How wide a species' individuals spread, before any per-row override.
  const RARITY_SPREAD = { common: 0.19, uncommon: 0.22, rare: 0.27, legendary: 0.16 };
  const SPREAD_MIN = 0.08, SPREAD_MAX = 0.34;
  // How a species' natural GROUP SIZE tightens its spread, as a smooth curve
  // rather than two thresholds. A step function put a whitetail herd (6-14)
  // and a sardine school (20-60) in the same bucket, which is exactly the
  // claim this feature must not make: a deer herd is varied and a bait ball
  // is not, and the bestiary already knows the difference.
  const GRP_K0 = 1.28, GRP_KL = 0.20, GRP_MIN = 0.50, GRP_MAX = 1.28;
  // THE BIG ONE: base odds per individual at the reference spread, scaled by
  // how variable the species is (a solitary apex rolls monsters more often
  // than a sardine does, which is also true of the real ocean).
  const BIG_ODDS = 1 / 260;
  const BIG_MIN = 1.30, BIG_RAND = 0.35;
  // Hard rails. Nothing may become a baby (breed() owns 0.4) and nothing may
  // become another species: a monster great white (1.2 * 1.65 = 1.98) still
  // reads smaller than a megalodon (2.6), which is the point.
  const K_MIN = 0.62, K_MAX = 1.86;

  function sizeSpread(sp) {
    if (!sp) return 0.17;
    if (Number.isFinite(sp.sizeVary)) return clamp(+sp.sizeVary, 0, 0.45);
    let s = RARITY_SPREAD[sp.rarity] || 0.19;
    // SCHOOLING IS UNIFORMITY. `herd` is the natural group size the bestiary
    // already declares; `packs` is how many groups get seeded and stands in
    // for it when a row declares only that.
    const grp = (sp.herd && sp.herd[1]) || (sp.packs && sp.packs >= 6 ? 6 : 1);
    s *= clamp(GRP_K0 - GRP_KL * Math.log(Math.max(1, grp)), GRP_MIN, GRP_MAX);
    return clamp(s, SPREAD_MIN, SPREAD_MAX);
  }

  // The individual's multiplier on sp.scale. Deterministic in (x, z) alone.
  function sampleSize(sp, x, z) {
    if (!SIZE_ON()) return 1;
    const spread = sizeSpread(sp);
    // Two independent channels summed = a TRIANGULAR draw centred on 1: most
    // of a herd sits near the species norm, the extremes are earned.
    const u = h01(x, z, 0x512E01) + h01(x, z, 0x512E02) - 1;
    let k = 1 + spread * u * 1.55;
    // ---- THE BIG ONE ----------------------------------------------------
    if (h01(x, z, 0xB16041) < BIG_ODDS * (spread / 0.2)) {
      k *= BIG_MIN + h01(x, z, 0xB16042) * BIG_RAND;
    }
    // A legendary is THE specimen of its kind, so it may not be born a runt —
    // but the floor is deliberately modest and does NOT reflect upward. There
    // is exactly one of each in the world and they are already authored at
    // their own scale; a fat floor here would quietly make the megalodon
    // twenty-five per cent bigger than the number somebody tuned.
    if (sp && sp.rarity === "legendary" && k < 1.05) k = 1.05;
    return clamp(k, K_MIN, K_MAX);
  }

  // Was this individual drawn off the monster tail? (read-only; audits/probes)
  function isBigOne(sp, x, z) {
    return SIZE_ON() && h01(x, z, 0xB16041) < BIG_ODDS * (sizeSpread(sp) / 0.2);
  }

  // ============================================================
  //  GROWTH — THE BODY IS THE PROGRESS BAR
  // ============================================================
  /* OWNER, verbatim: "each time the shark eats something it should get
     bigger ... getting bigger is a huge thing, like some megalodons should be
     bigger than others, ALL animals in the game, and it's based on how much
     they eat — eat a big shark you grow more vs eating a little fish."

     Agario logic, and the reason it belongs in THIS file rather than in a new
     one: the section above already answers "how big is this individual" for
     every animal in the game, and every consumer in the repo already reads
     that answer through SZ()/CBZ.wildlifeScale. Growth is therefore not a new
     system — it is a SECOND TERM in the multiplier this file already owns.

       _sizeMul   the spawn draw. IMMUTABLE. What this animal was born as.
       eatenMass  the ledger. How much meat it has eaten in its current form.
       _growMul   the ledger, curved. 1 .. growCap(sp).
       _sizeEff   species.scale x _sizeMul x _growMul x (baby grow)

     Splitting the draw from the ledger is load-bearing: the curve is defined
     relative to the body the animal was BORN with, so folding growth back into
     _sizeMul would make appetite compound on itself and the caps meaningless.

     ---- THE CURVE ----------------------------------------------------------
     g = 1 + (cap - 1) * (1 - exp(-m / M0))

     Monotonic, continuous, and saturating — the three properties the design
     needs. Saturating is the one that matters: it is what makes a big meal
     worth more than the same mass in small ones (25 mass of orca buys 0.71 of
     the range; twenty-five mackerel eaten one at a time buy the same 0.71
     only because the ledger is a SUM — but the first orca buys 0.26 where the
     first mackerel buys 0.06, so the animal that hunts well is visibly ahead
     of the one that grazes, which is the whole design).

     M0 — the e-folding mass — goes as the body^MASS_P, so a megalodon needs
     roughly five times a bull shark's tonnage to move the same fraction. A
     mackerel barely swells you; a shark is a visible jump.

     ---- THE CAP IS NOT DECORATION -----------------------------------------
     Two separate rails, and both are real:
       1. growCap(sp) — per species, 1.0..1.4. A bull shark is a growth animal
          and a bait fish is not, and the ceiling is what keeps a fed animal
          reading as a big ONE OF ITS KIND rather than as a balloon.
       2. K_MAX — the rail the size section already published: nothing may
          become another species. A monster great white (1.86) that eats all
          match still stops short of a megalodon (2.6). Growth is clamped into
          the SAME rail rather than being allowed to sail past it, because the
          silhouette ladder is the game's other progression and a shark that
          can eat its way into looking like the next rung erases it.
     The second rail also protects the LOD/draw radii, which are derived from
     scale and were tuned against K_MAX.

     ---- FLAGS -------------------------------------------------------------
     CBZ.CONFIG.MASS_ECONOMY — off: no ledger, no growth, anywhere.
     CBZ.CONFIG.WILD_GROWTH  — off: the player still grows, wild animals do
                               not (the ledger keeps accruing, it just stops
                               being spent on the body).  */
  if (C.MASS_ECONOMY == null) C.MASS_ECONOMY = true;
  if (C.WILD_GROWTH == null) C.WILD_GROWTH = true;
  function MASS_ON() { return C.MASS_ECONOMY !== false; }
  function WILD_ON() { return C.WILD_GROWTH !== false; }

  const MASS_E = 18;      // e-folding mass for a reference (scale 1) body
  const MASS_P = 1.6;     // ..and how that appetite grows with the body

  /* PER-SPECIES CEILINGS. A row may author its own `growCap` and win outright;
     these are the ones the marine ladder needed to differ by hand (the owner
     asked for exactly this: "a bull shark's ceiling differs from an orca's").
     Everything else derives from facts the bestiary already carries, so a new
     species still costs no row. */
  const GROW_CAP = {
    bull_shark: 1.40, hammerhead_shark: 1.36, great_white_shark: 1.34,
    megalodon: 1.30, orca: 1.26, tiger_shark: 1.38, mako_shark: 1.38,
    barracuda: 1.30, marlin: 1.22, tuna: 1.20, dolphin: 1.16,
    humpback_whale: 1.10, blue_whale: 1.08, fish: 1.10, sardine: 1.08,
  };
  function growCap(sp) {
    if (!sp) return 1;
    if (Number.isFinite(sp.growCap)) return clamp(+sp.growCap, 1, 1.4);
    const named = GROW_CAP[sp.id];
    if (named) return named;
    /* DERIVED. A PREDATOR grows on what it kills, which is the whole premise,
       so `danger` is the dial. A SCHOOLING animal is uniform by definition
       (the size section already spends `herd` on exactly that argument) and
       gets the narrowest ceiling of all — forty near-identical mackerel must
       not become forty differently-sized mackerel just because some of them
       found more plankton. */
    const grp = (sp.herd && sp.herd[1]) || 1;
    const school = grp >= 12 ? 0.35 : (grp >= 5 ? 0.7 : 1);
    return clamp(1 + (0.13 + 0.27 * clamp(sp.danger || 0, 0, 1)) * school, 1, 1.4);
  }

  // The ledger, curved. Pure: same mass in, same multiplier out, forever.
  function growthOf(a) {
    if (!a || !MASS_ON()) return 1;
    const m = +a.eatenMass;
    if (!(m > 0)) return 1;
    const sp = a.species;
    const cap = growCap(sp);
    if (!(cap > 1)) return 1;
    // the body this animal was BORN with — the curve's own reference
    const born = ((sp && sp.scale) || 1) * (a._sizeMul > 0 ? a._sizeMul : 1);
    const m0 = MASS_E * Math.pow(Math.max(0.2, born), MASS_P);
    return 1 + (cap - 1) * (1 - Math.exp(-m / m0));
  }

  /* THE INDIVIDUAL FACTOR, as a multiplier on the SPECIES constant — i.e.
     exactly what sizeKit() below wants and what predatorKit()'s sp.scale-derived
     numbers are missing. Derived from _sizeEff rather than re-multiplied, so it
     picks up the baby grow-up for free (a calf used to be handed a full-grown
     adult's reach and bite, which nothing had noticed). */
  function indivK(a) {
    if (!a) return 1;
    const sp = a.species;
    const base = (sp && sp.scale) || 1;
    const eff = +a._sizeEff;
    if (eff > 0 && base > 0) return eff / base;
    return a._sizeMul > 0 ? a._sizeMul : 1;
  }

  /* HOW MUCH MEAT IS THIS. ONE currency for the whole game: modes/shark_sim.js
     used to own a private copy of this and city/marine_predation.js had none at
     all, which is precisely how a player-facing ladder and a wild food chain
     drift into two different economies. hp is the only honest proxy the
     bestiary carries for tonnage, and people are worth a mouthful flat. */
  function massOf(target, kind) {
    if (kind === "survivor" || kind === "ped" || kind === "cop") return 5;
    if (!target) return 1;
    if (target === CBZ.player || target.isPlayer) return 5;
    const hp = (+target.maxHp) || (target.species && +target.species.hp) || 20;
    return Math.max(1, Math.round(hp / 25));
  }

  /* ---- THE SWELL. ONE animator, and it is deliberately not a second one ----
     modes/shark_sim.js already owns a grow animator for the EVOLVE ceremony
     (0.75 s, overshoot, slow-mo, a ring of white water). That beat is a
     cinematic and stays exactly as it is. This is the other thing entirely: a
     quarter-second meal-sized swell that happens dozens of times a match, on
     any animal in the world, with no camera work at all.

     It is a TRANSIENT on top of _sizeEff, never a second owner of it. The
     resting scale is written once by the engine's applyScale(); this only ever
     multiplies the group by a factor that eases from `from` to exactly 1, so
     an animator that is interrupted, cleared, or never ticked again cannot
     leave a body stuck at the wrong size — the next applyScale() rewrites it.

     _growLock is the handshake with shark_sim's ceremony: while the evolve
     beat owns group.scale, this yields completely rather than fighting it. */
  const PULSE_DUR = 0.28;
  function growPulse(a, fromRatio) {
    if (!a || !(fromRatio > 0) || fromRatio >= 0.999) return;
    const p = a._growP || (a._growP = { t: 0, dur: PULSE_DUR, from: 1 });
    // an interrupted pulse restarts from WHERE IT IS, so a fast eater's body
    // swells continuously instead of snapping back on every mouthful
    const cur = p.t < p.dur ? (p.from + (1 - p.from) * ease(p.t / p.dur)) : 1;
    p.from = Math.min(0.999, fromRatio * cur);
    p.t = 0; p.dur = PULSE_DUR;
  }
  function ease(e) { const k = e < 0 ? 0 : (e > 1 ? 1 : e); return 1 - Math.pow(1 - k, 3); }
  function tickGrow(a, dt) {
    const p = a && a._growP;
    if (!p) return;
    const g = a.group;
    if (!g || !g.scale || a.dead || a._growLock) { a._growP = null; return; }
    p.t += dt;
    const eff = +a._sizeEff > 0 ? a._sizeEff : ((a.species && a.species.scale) || 1);
    const gk = groupGirth(a);                    // ..and the girth rides on top
    if (p.t >= p.dur) { g.scale.set(eff, eff * gk, eff * gk); a._growP = null; return; }
    const e = p.t / p.dur;
    // ease-out with a small settling overshoot — mass arriving, not a lerp.
    // Half the evolve beat's 6%, because this fires on every single meal.
    const k = p.from + (1 - p.from) * ease(e);
    const v = eff * (k + Math.sin(e * Math.PI) * 0.03);
    g.scale.set(v, v * gk, v * gk);
  }

  /* ---- THE LEDGER SINK. Every mouthful in the game arrives here ----------
     Returns the multiplier the body should now be at, or 0 if nothing changed.
     Spending it on the body is the ENGINE's job (wildlife.js owns the one
     place an animal's scale is written, and hp/kits/colliders have to move
     with it) — this file owns the number, never the write. */
  function feedMass(eater, gain, opts) {
    if (!eater || !MASS_ON()) return 0;
    const g = +gain;
    if (!(g > 0) || !isFinite(g)) return 0;
    eater.eatenMass = (+eater.eatenMass || 0) + g;
    eater.eatenCount = (+eater.eatenCount || 0) + 1;
    // The player's own shark is grown by modes/shark_sim.js even with wild
    // growth switched off, so the flag reads as "wild animals" and not "the
    // ledger". `player` marks that caller.
    if (!WILD_ON() && !(opts && opts.player)) return 0;
    const was = +eater._growMul > 0 ? eater._growMul : 1;
    const now = growthOf(eater);
    eater._growMul = now;
    // Below a fifth of a per cent nothing is visible and nothing downstream
    // moved enough to be worth invalidating a cache over.
    if (Math.abs(now - was) < 0.002) return 0;
    return now / was;      // the RATIO — what the caller pulses from
  }

  // ============================================================
  //  HUNGER
  // ============================================================
  // Seconds from stuffed to starving at scale 1. A big animal eats big and
  // burns slow (mass^0.75 metabolism, near enough), a rabbit is hungry again
  // by lunchtime — so the sea is never uniformly ravenous or uniformly bored.
  const FULL_TO_EMPTY = 430;
  // A GRAZE BOUT IS A SNACK, NOT A MEAL. cls.grazeT is three to nine seconds,
  // so this is deliberately small: a herbivore has to put its head down
  // repeatedly to work its hunger off, which is what keeps a herd spread
  // across the range instead of every deer pinned at "fed" forever.
  const GRAZE_RATE = 0.022;      // hunger/s a herbivore recovers with its head down
  // A fish picks at the water column CONTINUOUSLY, so this only ever OFFSETS
  // the drift — never beats it. If it beat it, every non-predator in the sea
  // would settle at zero hunger and there would be no hungry fish at all,
  // which is the same bug as having no hunger.
  const DRIFT_RATE = 0.0022;     // hunger/s a fish claws back picking at the column
  const STEP = 0.02;             // recompute the behaviour scratch on this much change

  function metabolism(sizeEff) {
    return FULL_TO_EMPTY * Math.pow(clamp(sizeEff || 1, 0.2, 4), 0.55);
  }

  // The one read. 0.5 (neutral) whenever the feature is off, so every caller
  // can multiply by it unconditionally and get the old world back.
  function hungerOf(a) {
    if (!HUNGER_ON()) return 0.5;
    const h = a && a.hunger;
    return Number.isFinite(h) ? h : 0.5;
  }

  /* THE BEHAVIOUR SCRATCH — one object per actor, created once, rewritten only
     when hunger has moved a real step. Everything wildlife.js multiplies by
     lives here so there is exactly one place the curves are authored.

       spd       cruise speed multiplier              0.69 fed .. 1.31 starving
       restless  how often it re-aims / how far it roams
       loiter    probability it stops to idle          1.70 fed .. 0.30 starving
       sense     prey-detection radius multiplier      0.65 .. 1.35
       patience  circle time before committing         1.36 .. 0.64 (LOWER = commits sooner)
       bold      willingness to close on / approach    0.55 .. 1.45
       hunt      will it even look for a meal          0 fed .. 1 starving
  */
  const HUNT_FLOOR = 0.34;       // below this a predator is not shopping at all

  /* THE OFF SWITCH IS A REAL OFF SWITCH. With WILDLIFE_HUNGER off every
     multiplier below must be EXACTLY 1 and `hunt` must be 1 (an animal that
     always shops), or the "one-line revert" quietly ships a different world
     than the one it claims to restore — and the flag A/B that verifies this
     feature would be measuring a third thing. Frozen and shared: nobody
     writes to a drive scratch. */
  const OFF = { h: 0.5, spd: 1, restless: 1, loiter: 1, sense: 1, patience: 1, bold: 1, hunt: 1 };

  function drive(a) {
    if (!HUNGER_ON() || !a) return OFF;
    let d = a._hgDrive;
    if (!d) {
      d = a._hgDrive = { h: -9, spd: 1, restless: 1, loiter: 1, sense: 1, patience: 1, bold: 1, hunt: 1 };
    }
    const h = hungerOf(a);
    if (h - d.h < STEP && d.h - h < STEP) return d;
    d.h = h;
    const t = h - 0.5;                        // -0.5 stuffed .. +0.5 starving
    d.spd = 1 + t * 0.62;
    d.restless = 1 + t * 1.30;
    d.loiter = 1 - t * 1.40;
    d.sense = 1 + t * 0.70;
    d.patience = 1 - t * 0.72;
    d.bold = 1 + t * 0.90;
    d.hunt = h <= HUNT_FLOOR ? 0 : clamp((h - HUNT_FLOOR) / (1 - HUNT_FLOOR), 0, 1);
    return d;
  }

  // ---- the clock ---------------------------------------------------------
  // Called once per animal per frame by wildlife.js's tick, INCLUDING for the
  // LOD-frozen ones (an animal that only gets hungry where you are standing is
  // the bug the satiation clock already learned). Two arithmetic ops.
  function tickHunger(a, dt, opts) {
    if (!HUNGER_ON() || !a || a.dead) return;
    let h = a.hunger;
    if (!Number.isFinite(h)) h = a.hunger = 0.5;
    const inv = a._hgInv || (a._hgInv = 1 / metabolism(a._sizeEff || 1));
    h += dt * inv;
    // EATING IS A STATE, NOT AN EVENT, for anything that grazes. A deer with
    // its head down and a mackerel picking at the column are both feeding, and
    // without this every herbivore in the world pins at starving inside ten
    // minutes and stays there — which would make "hungry" mean nothing.
    if (opts === 1) h -= dt * (GRAZE_RATE + inv);          // head down: a real meal
    else if (opts === 2) h -= dt * Math.min(DRIFT_RATE, inv * 0.62);  // picking: an offset
    a.hunger = h < 0 ? 0 : (h > 1 ? 1 : h);
  }

  // ---- the drop ----------------------------------------------------------
  // A real meal. amount 1 = a full kill; wildlife.js also calls this with a
  // partial for a scavenged bite. Also arms the existing satiation clock so
  // the two never disagree about whether an animal has eaten.
  function feed(a, amount) {
    if (!a) return;
    if (Number.isFinite(a.hunger)) {
      a.hunger = clamp(a.hunger - (amount == null ? 1 : amount) * 0.92, 0, 1);
      if (a._hgDrive) a._hgDrive.h = -9;                  // force the scratch to re-derive
    }
  }

  // ============================================================
  //  THE BODY CUE — gaunt vs full-bellied, with no HUD anywhere.
  //
  //  TWO SHAPES OF ANIMAL, and the difference is not cosmetic.
  //
  //  A LAND animal is a torso with limbs hung off it. Scaling the torso mesh
  //  alone reads as a BELLY — the legs and the head stay where they were and
  //  the middle fills out, which is exactly the cue.
  //
  //  A MARINE animal is a WELDED CHAIN. city/wildlife/aquatic.js solves the
  //  rostrum's weld ring and the tail sleeve's front ring against the hull's
  //  OWN rings so the three meshes share a rim to the millimetre — that weld
  //  is the whole reason a shark's head is not a tube plugged into a body.
  //  Fattening the middle link 12% and leaving the ends alone breaks it, and
  //  the owner saw exactly that (2026-08-31): "when they eat things and get
  //  bigger, only the body is getting bigger. The head and tail stay the same,
  //  and that makes the body look stupidly big." Measured on a great white at
  //  the fed end of this range: the hull's crown went 1.475 -> 1.652 and its
  //  beam 0.485 -> 0.543 while sharkRostrum and tailSleeve did not move by a
  //  thousandth. (Worse: hull.scale.y pivots on the GROUP's y=0, which is
  //  under the belly, so the body also lifted off its own head.)
  //
  //  So in water the cue goes on the GROUP, where the head, the tail, the jaw
  //  shells and every fin ride it together and every weld stays welded.
  //
  //  THE GROUP-SCALE CONTRACT — four writers, one rule:
  //      group.scale.x   = the animal's TRUE size. Uniform, authoritative,
  //                        nobody's to lose (every reader in the repo asks
  //                        group.scale.x how big this animal is).
  //      group.scale.y/z = x * girth(a), the fed/lean swell.
  //  The writers are wildlife.js applyScale(), tickGrow() below,
  //  creature_combat.js (restPose + the impact pulse) and shark_sim.js's
  //  evolve beat. A writer that forgets the girth flattens the CUE for a
  //  frame; it can never corrupt the size. Anything that is not one of those
  //  four should be calling one of them.
  // ============================================================
  const BELLY = 0.24;            // full girth swing across the whole hunger range
  const BELLY_STEP = 0.04;

  // NAMED HULLS the authored aquatic builds expose. Checked by name through
  // the whole subtree (not just the direct children) because a build is free
  // to nest its body in a sub-group, and the day one does, a direct-children
  // scan silently loses the cue on exactly the animal the owner named.
  const HULL_NAMES = ["sharkHull", "hull", "body", "torso"];

  function boxOf(m) {
    const p = m.geometry && m.geometry.parameters;
    if (p && p.width != null) return { w: p.width, h: p.height, d: p.depth };
    const gm = m.geometry;
    if (!gm) return null;
    if (!gm.boundingBox) { try { gm.computeBoundingBox(); } catch (e) { return null; } }
    const bb = gm.boundingBox;
    if (!bb) return null;
    return { w: bb.max.x - bb.min.x, h: bb.max.y - bb.min.y, d: bb.max.z - bb.min.z };
  }

  function findBody(a) {
    if (a._bodyMesh !== undefined) return a._bodyMesh;
    a._bodyMesh = null;
    const grp = a && a.group;
    if (!grp) return null;
    let m = null;
    for (let i = 0; i < HULL_NAMES.length && !m; i++) {
      const o = grp.getObjectByName ? grp.getObjectByName(HULL_NAMES[i]) : null;
      if (o && o.isMesh) m = o;
    }
    if (!m) {
      // No name to go on: the body is the biggest mesh that is not a LEG (the
      // gait rig's own tall-and-thin test), so a starving animal never ends up
      // with thin shins. Whole subtree, largest wins, ties broken by order.
      let best = null, bestVol = 0;
      grp.traverse(function (o) {
        if (!o || !o.isMesh || !o.geometry) return;
        const b = boxOf(o);
        if (!b || !(b.w > 0 && b.h > 0 && b.d > 0)) return;
        if (b.h >= b.w * 1.1 && b.h >= b.d * 1.1) return;      // a leg
        const vol = b.w * b.h * b.d;
        if (vol > bestVol) { bestVol = vol; best = o; }
      });
      m = best;
    }
    if (!m) return null;                          // degrade: no cue, size still reads
    a._bodyMesh = m;
    a._bodyBY = m.scale.y; a._bodyBZ = m.scale.z;
    return m;
  }

  // Applied from wildlife.js's tick for VISIBLE animals only, and only when
  // the girth has actually moved — a write per animal per frame would be the
  // one allocation-free thing in this file that still cost something.
  function bodyCue(a) {
    if (!HUNGER_ON()) return;
    const h = hungerOf(a);
    const want = 1 + (0.5 - h) * BELLY;            // full-bellied fed, lean starving
    const q = Math.round(want / BELLY_STEP);
    if (a._bellyQ === q) return;
    a._bellyQ = q;
    const k = q * BELLY_STEP;
    /* IN WATER THE WHOLE BODY SWELLS. One write, and it deliberately reads x
       rather than _sizeEff: x is whatever the size writers last agreed the
       animal is (resting scale, a meal pulse mid-flight, an evolve beat), so
       the girth rides on top of every one of them without racing any. */
    if (a.species && a.species.aquatic) {
      a._girthK = k;
      const g = a.group;
      if (g && g.scale) { const s = g.scale.x > 0 ? g.scale.x : 1; g.scale.y = s * k; g.scale.z = s * k; }
      /* THE SAME CACHES A SIZE CHANGE INVALIDATES, for the same reason
         (wildlife.js sizeChanged()): the beam marine_predation.js measured off
         this hull and the saddle wildlife_tame.js measured off this back are
         both a body-width read, and a girth step just moved the body width. */
      if (a._mp) a._mp.beam = 0;
      if (a.ridden && typeof CBZ.wildlifeRideResize === "function") {
        try { CBZ.wildlifeRideResize(a); } catch (e) {}
      }
      return;
    }
    const m = findBody(a);
    if (!m) return;
    m.scale.y = a._bodyBY * k;
    m.scale.z = a._bodyBZ * k;
  }

  /* THE ONE READ of the group-borne girth, for the four writers of an animal's
     group scale. 1 for anything whose cue lives on a mesh (land) or that has
     not been fed a cue yet, so every writer can multiply unconditionally. */
  function groupGirth(a) {
    if (!a || !a.species || !a.species.aquatic) return 1;
    const k = +a._girthK;
    return (k > 0 && isFinite(k)) ? k : 1;
  }
  /* PUBLISHED ON CBZ because the other writers are not all in this file and
     not all of them can assume it loaded: creature_combat.js also drives the
     beast pit and games/battle.html, where wildlife_traits may be absent. Every
     caller reads it as `CBZ.animalGirth ? CBZ.animalGirth(a) : 1`. */
  CBZ.animalGirth = groupGirth;

  // ============================================================
  //  SIZE INTO THE SHARED PREDATOR KIT — without touching predator.js.
  //
  //  systems/predator.js derives an actor's whole hunt bundle from
  //  a.species.scale ONCE (buildKit), which is a SPECIES constant; a kit built
  //  for "a great white" therefore gives the runt and the monster identical
  //  reach, bite, patience and hold. The bundle is a plain object cached on
  //  the actor (wildlife.js's a._landHunt, wildlife_shark.js's a._shark.opts),
  //  so the individual's size can be folded in from OUT HERE, once, right
  //  after it is built — using predator.js's own published exponents so a big
  //  individual and a big species scale by the same laws.
  //
  //  CONVERGENT ON k, NOT APPLY-ONCE. The `_szK` receipt used to mean "this
  //  bundle has been sized, never touch it again", which was right while size
  //  was fixed at spawn and became THE staleness bug the moment animals could
  //  grow: every consumer of a cached kit (reach, bite, sense radius, seize
  //  hold — and through senseR the LOD/draw radii too) would have kept the
  //  numbers of the body the animal had when it was first built.
  //
  //  So the receipt now records WHICH k the bundle is currently at, and a call
  //  with a different k applies the RATIO. Calling it twice with the same k is
  //  still a no-op (which is what the two-files-build-kits-for-one-actor case
  //  needed), calling it every frame with a live k is free, and the numbers
  //  land on exactly the same values as a fresh build at that k, because every
  //  law here is a power of k and powers compose.
  // ============================================================
  function sizeKit(kit, want) {
    if (!kit || !(want > 0) || !isFinite(want)) return kit;
    const had = +kit._szK > 0 ? kit._szK : 1;
    if (Math.abs(want - had) > 1e-6) {
      kit._szK = want;
      const k = want / had;                    // the RATIO, so this re-converges
      const rs = Math.sqrt(k);                 // radii
      const ct = Math.pow(k, 0.7);             // patience
      const nimble = Math.pow(k, -0.13);       // acceleration
      if (kit.senseR) kit.senseR *= rs;
      if (kit.chumR) kit.chumR *= rs;
      if (kit.circleR) kit.circleR *= rs;
      if (kit.orbitR) kit.orbitR *= rs;
      if (kit.circleT) kit.circleT *= ct;
      if (kit.cruiseSpeed) kit.cruiseSpeed *= nimble;
      if (kit.rushSpeed) kit.rushSpeed *= nimble;
      if (kit.reach) kit.reach *= Math.pow(k, 0.85);
      if (kit.rate) kit.rate *= rs;
      if (kit.dmg) kit.dmg *= Math.pow(k, 1.35);
      if (kit.bumpDmg) kit.bumpDmg *= Math.pow(k, 1.35);
      /* ..AND THE HUNGER LAYER'S SNAPSHOT UNDER IT. hungerKit below caches the
         kit's UNMODULATED radii once and then rewrites the live fields from
         that cache on every hunger step. Left alone, the first hunger step
         after an animal grew would reset its sense radius to the body it used
         to have — the growth silently undone by the other layer, which is
         exactly the composition bug the two-layer design exists to avoid. The
         snapshot is a size-free base, so it rides the same ratio. */
      const hb = kit._hgBase;
      if (hb) {
        if (hb.senseR) hb.senseR *= rs;
        if (hb.chumR) hb.chumR *= rs;
        if (hb.circleT) hb.circleT *= ct;
        if (hb.cruiseSpeed) hb.cruiseSpeed *= nimble;
      }
    }
    /* THE SEIZE CARRIES ITS OWN RECEIPT, and that is not belt-and-braces: two
       bundles on one hunter (hunting YOU and hunting a deer) come out of the
       same predatorKit and can share this exact object, so a receipt only on
       the outer kit would scale the grab twice for anything that does both.

       It converges on the ABSOLUTE k rather than composing the ratio, which is
       what keeps that shared case correct now that the outer receipt is no
       longer a one-shot latch: the second bundle arrives with its own ratio,
       finds the seize already at this k, and does nothing. It also lives
       OUTSIDE the block above so a bundle that was already at `want` can still
       bring a freshly-merged seize up to date. */
    const s = kit.seize;
    if (s && typeof s === "object") {
      const sHad = +s._szK > 0 ? s._szK : 1;
      if (Math.abs(want - sHad) > 1e-6) {
        const sk = want / sHad;
        s._szK = want;
        if (s.dps) s.dps *= Math.pow(sk, 1.35);
        if (s.hold) s.hold *= Math.pow(sk, 0.9);
        if (s.escape) s.escape = clamp(s.escape * Math.pow(sk, -0.9), 0.03, 0.95);
      }
    }
    return kit;
  }

  /* HUNGER INTO THE SAME KIT. predatorHunt reads senseR / chumR / circleT /
     cruiseSpeed off the bundle EVERY frame, so a hungry animal's willingness
     to commit is a matter of rewriting four numbers on an object that already
     exists — no allocation, no second brain, and no edit to predator.js.

     The BASE snapshot is taken once (one small object per hunting actor, at
     its first hunt, never per frame) so repeated applications cannot compound.
     Recomputed only on a hunger step, like everything else here. */
  function hungerKit(kit, a) {
    if (!kit || !HUNGER_ON()) return kit;
    let b = kit._hgBase;
    if (!b) {
      b = kit._hgBase = {
        senseR: kit.senseR || 0, chumR: kit.chumR || 0,
        circleT: kit.circleT || 0, cruiseSpeed: kit.cruiseSpeed || 0,
        h: -9,
      };
    }
    const d = drive(a);
    if (b.h === d.h) return kit;
    b.h = d.h;
    if (b.senseR) kit.senseR = b.senseR * d.sense;
    if (b.chumR) kit.chumR = b.chumR * d.sense;
    if (b.circleT) kit.circleT = Math.max(0.8, b.circleT * d.patience);
    if (b.cruiseSpeed) kit.cruiseSpeed = b.cruiseSpeed * d.spd;
    return kit;
  }

  // ============================================================
  //  PUBLIC SURFACE
  // ============================================================
  // The two the rest of the game (and systems/predator.js, once somebody wires
  // it) should read. Both answer safely for ANY actor, including one this file
  // has never seen — a dog, a battle-page beast, a tamed mount.
  CBZ.wildlifeSize = function (a) {
    if (!a) return 1;
    if (Number.isFinite(a._sizeMul)) return a._sizeMul;
    return 1;
  };
  // The individual's EFFECTIVE world scale (species constant x individual
  // multiplier x how grown it is) — the number every `sp.scale` read that
  // meant "how big is this animal" should have been asking for.
  CBZ.wildlifeScale = function (a) {
    if (!a) return 1;
    if (Number.isFinite(a._sizeEff)) return a._sizeEff;
    const sp = a.species;
    return (sp && sp.scale) || 1;
  };
  CBZ.wildlifeHunger = function (a) { return hungerOf(a); };
  /* ---- GROWTH, PUBLIC ----------------------------------------------------
     wildlifeScale() above already answers "how big is this animal" and now
     carries the ledger, so nothing that reads it needs to learn a new call.
     These are for the things that must credit a meal or report the economy. */
  // How much meat is this? ONE currency for the ladder and the food chain.
  CBZ.wildlifeMassOf = function (target, kind) { return massOf(target, kind); };
  // Lifetime mass eaten IN THIS FORM (shark_sim rebases it on every evolution).
  CBZ.wildlifeEatenMass = function (a) { return (a && +a.eatenMass) || 0; };
  // The ledger curved into a body multiplier, and this species' ceiling.
  CBZ.wildlifeGrowth = function (a) { return (a && +a._growMul > 0) ? a._growMul : 1; };
  CBZ.wildlifeGrowCap = function (sp) { return growCap(sp && sp.species ? sp.species : sp); };
  /* CREDIT A MEAL. The ONE sink; city/marine_predation.js calls it for every
     wild kill and modes/shark_sim.js for every one of the player's. Returns
     the ratio the body must swell by (1 = nothing to do), and does NOT write
     the body: city/wildlife.js owns the single place a scale is written
     because hp, the hunt kits, the colliders and the saddle all move with it.
     `opts.player` exempts the player's own shark from the WILD_GROWTH flag. */
  CBZ.wildlifeFeedMass = function (eater, gain, opts) { return feedMass(eater, gain, opts); };
  // Staging / probes / a future save hydration. Never called in play.
  CBZ.wildlifeSetEatenMass = function (a, m) {
    if (!a) return 0;
    a.eatenMass = Math.max(0, +m || 0);
    a._growMul = growthOf(a);
    if (typeof CBZ.wildlifeApplyScale === "function") { try { CBZ.wildlifeApplyScale(a); } catch (e) {} }
    return a._growMul;
  };

  // Staging / tests / any future save hydration. Never called in play.
  CBZ.wildlifeSetHunger = function (a, v) {
    if (!a) return;
    a.hunger = clamp(+v || 0, 0, 1);
    if (a._hgDrive) a._hgDrive.h = -9;
    a._bellyQ = null;
    bodyCue(a);
  };

  CBZ.wildlifeTraits = {
    SIZE_ON: SIZE_ON, HUNGER_ON: HUNGER_ON,
    sizeSpread: sizeSpread, sampleSize: sampleSize, isBigOne: isBigOne,
    K_MIN: K_MIN, K_MAX: K_MAX, BIG_MIN: BIG_MIN,
    hunger: hungerOf, drive: drive, tick: tickHunger, feed: feed,
    metabolism: metabolism, bodyCue: bodyCue, findBody: findBody,
    girth: groupGirth,
    sizeKit: sizeKit, hungerKit: hungerKit,
    // growth
    MASS_ON: MASS_ON, WILD_ON: WILD_ON, growCap: growCap, growth: growthOf,
    indivK: indivK, massOf: massOf, feedMass: feedMass,
    growPulse: growPulse, tickGrow: tickGrow, MASS_E: MASS_E, MASS_P: MASS_P,
  };
})();
