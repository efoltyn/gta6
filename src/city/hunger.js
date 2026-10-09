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
   feeds you — the pockets card (interact.js self-eat), the line cook's
   plate (roleverbs.js), a diner counter, and the automatic meal below —
   routes HERE. Never write g.hunger from a new place; call CBZ.cityEat.

   FOOD AND MEDS USE THEMSELVES (2026-09-28). OWNER: "only guns are cool...
   all other inventory is dumb af." A burger was a chip on the weapon bar
   you had to remember to press. Now a man with food in his pocket eats it
   when he gets hungry (the cheapest thing that fixes it), and a man with a
   medkit patches himself up when he is hurt badly. No chip, no line of
   text: the chew's bites and your eyes clearing ARE the feedback.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const g = CBZ.game;

  // AUTO-USE thresholds: eat below HUNGRY, aiming to land at least at FED;
  // patch up below HURT (a fraction of max hp). The cooldowns keep one item
  // per beat so a stack is never wolfed in a single frame.
  const AUTO = { hungry: 35, fed: 70, hurt: 0.35, eatCD: 2.5, medCD: 4 };
  let autoEatT = 0, autoMedT = 0;

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
    // tired legs: the tank shrinks (60% at 70 tired, 35% at 100), never to a
    // stub. The old cap of 8 (a third of a second of sprint) hit within a
    // minute of nightfall and read as "stamina is broken".
    if (g.tired > 70) {
      const capK = 0.6 - 0.25 * Math.min(1, (g.tired - 70) / 30);
      const cap = (P.maxStamina || (CBZ.CITY && CBZ.CITY.staminaMax) || 100) * capK;
      if ((P.stamina || 0) > cap) P.stamina = cap;
    }
    if (g.tired >= 100 && g.invuln <= 0) {
      P.hp -= (C.tireExhaustDmg || 1.4) * dt;
      if (P.hp <= 0 && CBZ.cityKillPlayer) CBZ.cityKillPlayer("collapsed from exhaustion");
    }

    autoUse(P, dt);

    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  });

  // ============================================================
  //  AUTO-USE — the pocket looks after itself
  // ============================================================
  // PURE: which carried food to eat at hunger `h`. The cheapest item that
  // lifts you to AUTO.fed; if nothing that big is carried, the most filling
  // one. Dog treats are for dogs. Returns a name or null.
  function pickFood(inv, ITEMS, h) {
    const need = AUTO.fed - h;
    let fix = null, fixV = Infinity, big = null, bigH = -1;
    for (const name in inv) {
      if (!((inv[name] | 0) > 0)) continue;
      const it = ITEMS[name];
      if (!it || it.tag !== "food" || !(it.heal > 0) || it.dogfeed) continue;
      const v = it.value || 0;
      if (it.heal >= need) { if (v < fixV || (v === fixV && fix && it.heal < ITEMS[fix].heal)) { fix = name; fixV = v; } }
      else if (it.heal > bigH) { big = name; bigH = it.heal; }
    }
    return fix || big;
  }
  // PURE: which carried medicine to use (any row with a `medkit` heal): the
  // smallest that covers the wound, else the biggest. A roll of gauze is
  // never picked (no `medkit`): wrapping a wound is yours to do, by hand.
  function pickMed(inv, ITEMS, missing) {
    let fix = null, fixH = Infinity, big = null, bigH = -1;
    for (const name in inv) {
      if (!((inv[name] | 0) > 0)) continue;
      const it = ITEMS[name];
      if (!it || !(it.medkit > 0)) continue;
      if (it.medkit >= missing) { if (it.medkit < fixH) { fix = name; fixH = it.medkit; } }
      else if (it.medkit > bigH) { big = name; bigH = it.medkit; }
    }
    return fix || big;
  }
  CBZ.cityAutoPick = { food: pickFood, med: pickMed, AUTO: AUTO };
  function autoUse(P, dt) {
    autoEatT = Math.max(0, autoEatT - dt);
    autoMedT = Math.max(0, autoMedT - dt);
    if (g.state !== "playing" || CBZ.cityMenuOpen || P.dead) return;
    const econ = CBZ.cityEcon;
    if (!econ || !econ.ITEMS) return;
    const inv = g.cityInv || {};
    if (!meal && autoEatT <= 0 && (g.hunger == null ? 100 : g.hunger) < AUTO.hungry) {
      const food = pickFood(inv, econ.ITEMS, g.hunger || 0);
      autoEatT = AUTO.eatCD;
      if (food) CBZ.cityEat(food);
    }
    const maxHp = P.maxHp || 100;
    if (autoMedT <= 0 && (P.hp || 0) > 0 && (P.hp || 0) < maxHp * AUTO.hurt) {
      const med = pickMed(inv, econ.ITEMS, maxHp - (P.hp || 0));
      autoMedT = AUTO.medCD;
      if (med && CBZ.cityUseItem) CBZ.cityUseItem(med);
    }
  }

  // ---- the ONE eat. Returns true if the food left your bag. ---------------
  // The item is CONSUMED at the first bite (you cannot eat the same steak
  // twice by walking away), the fill is paid out across the chew, and a
  // second [1] press while your mouth is full is refused rather than queued.
  CBZ.cityEat = function (name) {
    const econ = CBZ.cityEcon; if (!econ) return false;
    const it = econ.ITEMS[name];
    if (!it || !it.heal || !econ.has(name)) return false;
    if ((g.hunger || 0) >= 100 && !it.boost) return false;   // full: the food stays in your pocket
    if (!econ.take(name, 1)) return false;

    const heal = it.heal;
    const hp = Math.max(0, Math.round(heal * 0.25));
    const drink = !!(it.boost || /soda|drink|water|juice|beer|coffee|hooch/i.test(name));

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
