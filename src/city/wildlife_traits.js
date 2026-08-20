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
  const RARITY_SPREAD = { common: 0.17, uncommon: 0.21, rare: 0.26, legendary: 0.24 };
  const SPREAD_MIN = 0.07, SPREAD_MAX = 0.34;
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
    let s = RARITY_SPREAD[sp.rarity] || 0.18;
    // SCHOOLING IS UNIFORMITY. herd is the natural group size the bestiary
    // already declares; packs is how many groups get seeded and stands in for
    // it when a row declares only that.
    const grp = (sp.herd && sp.herd[1]) || (sp.packs && sp.packs >= 6 ? 6 : 1);
    if (grp >= 8) s *= 0.62;
    else if (grp >= 3) s *= 0.84;
    else s *= 1.22;
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
    // A legendary is THE specimen of its kind; it may not be born a runt.
    if (sp && sp.rarity === "legendary" && k < 1.14) k = 1.14 + (1.14 - k) * 0.5;
    return clamp(k, K_MIN, K_MAX);
  }

  // Was this individual drawn off the monster tail? (read-only; audits/probes)
  function isBigOne(sp, x, z) {
    return SIZE_ON() && h01(x, z, 0xB16041) < BIG_ODDS * (sizeSpread(sp) / 0.2);
  }

  // ============================================================
  //  HUNGER
  // ============================================================
  // Seconds from stuffed to starving at scale 1. A big animal eats big and
  // burns slow (mass^0.75 metabolism, near enough), a rabbit is hungry again
  // by lunchtime — so the sea is never uniformly ravenous or uniformly bored.
  const FULL_TO_EMPTY = 430;
  const GRAZE_RATE = 0.055;      // hunger/s a herbivore recovers with its head down
  const DRIFT_RATE = 0.0065;     // hunger/s a fish recovers picking at the water column
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

  function drive(a) {
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
    if (opts === 1) h -= dt * (GRAZE_RATE + inv);          // head down, grazing
    else if (opts === 2) h -= dt * (DRIFT_RATE + inv);     // aquatic, picking
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
  //  A modest NON-UNIFORM scale on the body/hull child only. Never on the
  //  group: creature_combat.js caches actor._baseScale off group.scale.x and
  //  then forces all three components back to it between swings, so a
  //  non-uniform group scale would be silently flattened the first time
  //  anything attacked — and the size multiplier, which IS uniform and IS on
  //  the group, composes with this for free.
  //
  //  DISCOVERY, not declaration (the law the gait rig and the swim rig already
  //  follow): the authored shark hull carries the name "sharkHull"; everything
  //  else offers its largest non-leg mesh, which for a quadruped is the torso
  //  and for a fish is the body slab. Nothing found = no cue, and the size
  //  multiplier still reads.
  // ============================================================
  const BELLY = 0.24;            // full girth swing across the whole hunger range
  const BELLY_STEP = 0.04;

  function findBody(a) {
    if (a._bodyMesh !== undefined) return a._bodyMesh;
    a._bodyMesh = null;
    const grp = a && a.group;
    if (!grp || !grp.children) return null;
    const kids = grp.children;
    let named = null, best = null, bestVol = 0;
    for (let i = 0; i < kids.length; i++) {
      const m = kids[i];
      if (!m || !m.isMesh || !m.geometry) continue;
      if (m.name === "sharkHull") { named = m; break; }
      const p = m.geometry.parameters;
      let w, hh, dd;
      if (p && p.width != null) { w = p.width; hh = p.height; dd = p.depth; }
      else {
        if (!m.geometry.boundingBox) { try { m.geometry.computeBoundingBox(); } catch (e) {} }
        const bb = m.geometry.boundingBox;
        if (!bb) continue;
        w = bb.max.x - bb.min.x; hh = bb.max.y - bb.min.y; dd = bb.max.z - bb.min.z;
      }
      if (!(w > 0 && hh > 0 && dd > 0)) continue;
      // a LEG is tall and thin — the gait rig's own test, and the torso is
      // never one. Skip them so a starving animal does not get thin shins.
      if (hh >= w * 1.1 && hh >= dd * 1.1) continue;
      const vol = w * hh * dd;
      if (vol > bestVol) { bestVol = vol; best = m; }
    }
    const m = named || best;
    if (!m) return null;
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
    const m = findBody(a);
    if (!m) return;
    const k = q * BELLY_STEP;
    m.scale.y = a._bodyBY * k;
    m.scale.z = a._bodyBZ * k;
  }

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
  //  Idempotent by the `_szK` receipt: calling it twice on one bundle is a
  //  no-op, which matters because two files build kits for the same actor.
  // ============================================================
  function sizeKit(kit, k) {
    if (!kit || !(k > 0) || kit._szK) return kit;
    kit._szK = k;
    if (k === 1) return kit;
    const rs = Math.sqrt(k);                 // radii
    const ct = Math.pow(k, 0.7);             // patience
    const hs = Math.pow(k, 0.9);             // hold
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
    const s = kit.seize;
    if (s && typeof s === "object") {
      if (s.dps) s.dps *= Math.pow(k, 1.35);
      if (s.hold) s.hold *= hs;
      if (s.escape) s.escape = clamp(s.escape * Math.pow(k, -0.9), 0.03, 0.95);
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
    sizeKit: sizeKit, hungerKit: hungerKit,
  };
})();
