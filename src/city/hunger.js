/* ============================================================
   city/hunger.js — street survival: HUNGER (slow) + TIREDNESS (night).
   Hunger drains slowly and food fixes it. The real pressure is the
   day/night cycle: once night falls you get tired if you stay up &
   about (CBZ.nightAmount drives it) — resting/standing still is
   sleeping, which recovers it, and daytime is restful. Stay awake,
   exhausted, through the night and it eats your health.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const g = CBZ.game;

  let warnT = 0, tireWarnT = 0;

  function isResting(P) {
    if (P.driving) return false;
    if (P.sprint) return false;
    const k = CBZ.keys;
    const moving = (P.speed || 0) > 0.6 || (k && (k["w"] || k["a"] || k["s"] || k["d"]));
    return !moving;     // standing still = sleeping/resting
  }

  CBZ.onUpdate(32, function (dt) {
    if (g.mode !== "city") return;
    const P = CBZ.player;
    if (P.dead) return;
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
      if (warnT <= 0) { warnT = 5; CBZ.city && CBZ.city.note("🍔 You're starving! Find food.", 2); }
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
      if (tireWarnT <= 0) { tireWarnT = 5; CBZ.city && CBZ.city.note("😴 Exhausted — find somewhere to sleep.", 2.4); }
      if (P.hp <= 0 && CBZ.cityKillPlayer) CBZ.cityKillPlayer("collapsed from exhaustion");
    } else if (g.tired > 60 && night > 0.5) {
      tireWarnT -= dt;
      if (tireWarnT <= 0) { tireWarnT = 9; CBZ.city && CBZ.city.note("🥱 Getting tired — rest somewhere safe.", 2); }
    }

    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  });

  // eat a food item by name; returns true if eaten
  CBZ.cityEat = function (name) {
    const econ = CBZ.cityEcon; if (!econ) return false;
    const it = econ.ITEMS[name];
    if (!it || !it.heal || !econ.has(name)) return false;
    econ.take(name, 1);
    g.hunger = Math.min(100, (g.hunger || 0) + it.heal);
    if (it.boost) CBZ.player._boost = 12;     // energy drink = temporary stamina/regen
    if (CBZ.sfx) CBZ.sfx("coin");
    CBZ.city && CBZ.city.note("Ate " + name + " (+" + it.heal + " food)", 1.6);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  };
})();
