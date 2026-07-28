/* ============================================================
   city/hunger.js — street survival: HUNGER (slow) + TIREDNESS (night).
   Hunger drains slowly and food fixes it. The real pressure is the
   day/night cycle: once night falls you get tired if you stay up &
   about (CBZ.nightAmount drives it) — resting/standing still is
   sleeping, which recovers it, and daytime is restful. Stay awake,
   exhausted, through the night and it eats your health.

   EATING IS A VERB YOU CAN DO (FOOD_EAT_V2, 2026-07-28). OWNER: "there's
   no way to eat... we made logic for food, for skinning an animal. We
   didn't make any artistic shit. We didn't make anything for eating."
   The logic was all here — cityEat was a ONE-FRAME transaction: take the
   item, add the number, print a line. Nothing about it read as EATING.

   It is a 1.1-2.0 s beat now, and the beat authors NO new HUD, because
   the honest readout already exists: hunger climbs PROGRESSIVELY across
   the chew, so city/hud.js's Minecraft shank row visibly fills while you
   eat. That plus three soft bites of audio is the whole feedback loop —
   the killfeed remains the only popup in this game. The duration is
   derived from the meal, so a rabbit haunch is a snack and a moose steak
   is a sit-down.

   THIS IS STILL THE ONE HUNGER WRITER for the city. Everything that
   feeds you — the hotbar number key (fpsmode's useHotbarItem), the
   pockets card (interact.js self-eat), the line cook's plate
   (roleverbs.js), the inventory grid — routes HERE. Never write g.hunger
   from a new place; call CBZ.cityEat.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const g = CBZ.game;
  const CFG = CBZ.CONFIG || (CBZ.CONFIG = {});
  if (CFG.FOOD_EAT_V2 == null) CFG.FOOD_EAT_V2 = true;
  function chewOn() { return CFG.FOOD_EAT_V2 !== false; }

  let warnT = 0, tireWarnT = 0;

  function isResting(P) {
    if (P.driving) return false;
    if (P.sprint) return false;
    const k = CBZ.keys;
    const moving = (P.speed || 0) > 0.6 || (k && (k["w"] || k["a"] || k["s"] || k["d"]));
    return !moving;     // standing still = sleeping/resting
  }

  // ============================================================
  //  THE CHEW — one live meal at a time. `given` is what has already been
  //  paid into g.hunger, so the arc can be abandoned mid-bite (death, a
  //  mode switch) without ever double-feeding or leaving a debt.
  // ============================================================
  let meal = null;    // { name, heal, hp, boost, t, dur, given, bites }

  // A bigger meal takes longer to get through. Floor 1.1 s so a snack still
  // reads as an action; ceiling 2.0 s so eating never feels like a cutscene.
  function chewTime(heal) { return Math.max(1.1, Math.min(2.0, 0.92 + (heal || 0) * 0.022)); }
  function sfx(n, v) { if (CBZ.sfx) { try { CBZ.sfx(n, { volume: v, force: true }); } catch (e) {} } }

  function feed(amount) {
    if (!(amount > 0)) return;
    g.hunger = Math.min(100, (g.hunger == null ? 100 : g.hunger) + amount);
  }

  function finishMeal() {
    if (!meal) return;
    const m = meal;
    meal = null;
    feed(Math.max(0, m.heal - m.given));       // the remainder of the fill
    // a real meal puts a little back on your feet as well as in your belly —
    // the same relationship the diner counter has always used (shops.js buys
    // food at heal + ~0.4x heal in hp); a carried meal pays a quarter of it.
    const P = CBZ.player;
    if (P && m.hp > 0 && P.maxHp) P.hp = Math.min(P.maxHp, (P.hp || 0) + m.hp);
    if (m.boost) CBZ.player._boost = 12;       // energy drink = temporary stamina/regen
    sfx("pickup", 0.45);
    if (CBZ.city && CBZ.city.note) {
      CBZ.city.note((m.drink ? "Drank " : "Ate ") + m.name + " (+" + Math.round(m.heal) + " food" +
        (m.hp > 0 ? ", +" + m.hp + " hp" : "") + ")", 1.6);
    }
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  function tickMeal(dt) {
    if (!meal) return;
    const P = CBZ.player;
    if (!P || P.dead || g.mode !== "city" || g.state !== "playing") { meal = null; return; }
    meal.t += dt;
    // pay the fill out as you chew: the HUD's existing hunger row IS the
    // progress bar, so this beat needs no widget of its own.
    const want = Math.min(1, meal.t / meal.dur) * meal.heal;
    const step = want - meal.given;
    if (step > 0) { feed(step); meal.given = want; }
    // three soft bites across the arc — muffled, low, never a jingle
    const bite = Math.min(3, Math.floor(meal.t / (meal.dur / 3.2)));
    while (meal.bites < bite) { meal.bites++; sfx("hit", 0.13 + meal.bites * 0.015); }
    if (meal.t >= meal.dur) finishMeal();
  }

  CBZ.onUpdate(32, function (dt) {
    if (g.mode !== "city") { meal = null; return; }
    const P = CBZ.player;
    if (P.dead) { meal = null; return; }
    tickMeal(dt);
    const C = CBZ.CITY;
    // sprinting burns through food faster
    const drain = C.hungerDrain * (P.sprint ? 1.8 : 1) * (P._boost ? 0.6 : 1);
    g.hunger = Math.max(0, (g.hunger == null ? 100 : g.hunger) - drain * dt);
    if (P._boost) P._boost = Math.max(0, P._boost - dt);

    if (g.hunger <= 0 && g.invuln <= 0) {
      // X2 mercy floor: hunger alone can no longer finish you off in the
      // city (combat/falls/etc. can still take you the rest of the way) —
      // per MASTER-PLAN V.1b, starvation stays fully lethal outside the
      // city (see systems/hunger.js's survival/escape branch).
      P.hp = Math.max(5, P.hp - C.starveDmg * dt);
      warnT -= dt;
      if (warnT <= 0) { warnT = 5; CBZ.city && CBZ.city.note("You're starving! Find food.", 2); }
    }

    // ---- TIREDNESS: night wears you down; resting (standing still) sleeps it
    //      off. 0 = wide awake, 100 = dead on your feet. ----
    const night = CBZ.nightAmount || 0;            // 0 day .. 1 deep night
    const resting = isResting(P);
    let rate;
    if (resting) rate = -(C.tireRest || 5) * (0.5 + night);          // sleeping: deeper at night
    else if (night > 0.42) rate = (C.tireNight || 1.15) * (night + 0.2); // up at night: tire
    else rate = -1.4;                                                 // up in daylight: mild recovery
    g.tired = Math.max(0, Math.min(100, (g.tired == null ? 0 : g.tired) + rate * dt));

    // exhaustion effects: no sprinting, then your body starts giving out
    if (g.tired > 70) { P.stamina = Math.min(P.stamina || 0, 8); P.sprint = false; }
    if (g.tired >= 100 && g.invuln <= 0) {
      P.hp -= (C.tireExhaustDmg || 1.4) * dt;
      tireWarnT -= dt;
      if (tireWarnT <= 0) { tireWarnT = 5; CBZ.city && CBZ.city.note("Exhausted — find somewhere to sleep.", 2.4); }
      if (P.hp <= 0 && CBZ.cityKillPlayer) CBZ.cityKillPlayer("collapsed from exhaustion");
    } else if (g.tired > 60 && night > 0.5) {
      tireWarnT -= dt;
      if (tireWarnT <= 0) { tireWarnT = 9; CBZ.city && CBZ.city.note("Getting tired — rest somewhere safe.", 2); }
    }

    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  });

  // ---- the ONE eat. Returns true if the food left your bag. ---------------
  // The item is CONSUMED at the first bite (you cannot eat the same steak
  // twice by walking away), the fill is paid out across the chew, and a
  // second [1] press while your mouth is full is refused rather than queued.
  CBZ.cityEat = function (name) {
    const econ = CBZ.cityEcon; if (!econ) return false;
    const it = econ.ITEMS[name];
    if (!it || !it.heal || !econ.has(name)) return false;
    if ((g.hunger || 0) >= 100 && !it.boost) {
      if (CBZ.city && CBZ.city.note) CBZ.city.note("You're full.", 1.2);
      return false;
    }
    if (!econ.take(name, 1)) return false;

    const heal = it.heal;
    const hp = Math.max(0, Math.round(heal * 0.25));
    const drink = !!(it.boost || /soda|drink|water|juice|beer|coffee|hooch/i.test(name));

    if (!chewOn()) {
      // flag-off: the original one-frame transaction, byte-for-byte in effect.
      g.hunger = Math.min(100, (g.hunger || 0) + heal);
      if (it.boost) CBZ.player._boost = 12;
      if (CBZ.sfx) CBZ.sfx("coin");
      CBZ.city && CBZ.city.note("Ate " + name + " (+" + heal + " food)", 1.6);
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
      return true;
    }
    if (meal) { finishMeal(); }                 // never drop a paid-for meal
    meal = { name, heal, hp, boost: !!it.boost, drink, t: 0, dur: chewTime(heal), given: 0, bites: 0 };
    sfx(drink ? "water" : "pickup", drink ? 0.3 : 0.5);   // unwrap / uncap — the first beat
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  };

  // live chew state, for anything that wants to know your hands are busy
  CBZ.cityEating = function () { return meal ? { name: meal.name, t: meal.t, dur: meal.dur } : null; };
  CBZ.cityEatCancel = function () { meal = null; };
  // Ratchet/exports: `fill` proves the derived meal ladder is real and
  // `edible` proves the catalog actually carries food (it read 6 before the
  // hunt paid in meals; every species meat and fish now counts).
  CBZ.foodAudit = function () {
    const IT = (CBZ.cityEcon && CBZ.cityEcon.ITEMS) || {};
    let items = 0, edible = 0, wild = 0, minFill = 1e9, maxFill = 0;
    for (const n in IT) {
      items++;
      const it = IT[n]; if (!it || !it.heal) continue;
      edible++; if (it.wild) wild++;
      if (it.heal < minFill) minFill = it.heal;
      if (it.heal > maxFill) maxFill = it.heal;
    }
    return {
      items, edible, wild,
      minFill: edible ? minFill : 0, maxFill,
      chewing: !!meal, chewSec: meal ? +meal.dur.toFixed(2) : 0,
    };
  };
})();
