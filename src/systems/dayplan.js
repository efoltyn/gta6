/* ============================================================
   systems/dayplan.js — A DAY IS A LIST OF NAMED BLOCKS.

   THE ENGINE OWNS THE CLOCK; A GAME OWNS THE TIMETABLE. Every game built on
   this repo that has ever cared what time it is has written the same forty
   lines again: carve the day into named stretches, ask which one is running,
   ask how long until the next, do something when it changes. The stretches
   differ — a shift rota, a school bell, a hospital round, a lock-up — but
   the arithmetic never does, and the arithmetic is where the bugs are:

     · the LAST block wraps through midnight into the first, so "which block
       owns 03:00" is not a linear scan with a default;
     · "how long until the next one" must wrap too, or a game that starts at
       23:50 waits twenty-three hours for a five-minute block;
     · a run that STARTS mid-block must land in it SILENTLY — firing the
       transition for an hour that passed while nobody was playing is a lie;
     · and the day length is not a constant: it is whatever the world's own
       sun is doing, so the plan reads that and never a private accumulator
       (which is also what makes a saved/restored world land in the right
       block).

   WHAT IT IS NOT. It has no opinion about doors, lights, alarms, curfews or
   where a body belongs — those are DECLARATIONS a caller hangs on its own
   block records, which are the caller's own objects and are never copied.
   This file answers four questions and fires one callback.

       const plan = CBZ.dayPlan.define("clinic", [
         { id: "rounds", from: 7,  ward: "open"  },
         { id: "surgery", from: 9, ward: "shut"  },
         { id: "visiting", from: 14 },
         { id: "night",   from: 21, ward: "shut" },
       ], { tick: 19.5 });
       plan.on(function (b, prev, first) { doors(b.ward); if (!first) bell(); });
       plan.is("surgery");  plan.until();  plan.progress();

   THE BLOCK OBJECTS ARE YOURS. `plan.blocks` IS the array you passed, holding
   the objects you passed — nothing is cloned and no field of yours is
   touched. A caller may mutate `from` in place at runtime (a harder regime, a
   festival, a difficulty tier) and the plan reads the new number on the next
   question, because it never caches anything but the CURRENT block reference.

   NO WORLD REQUIRED. With core/daynight.js present the clock is that sun
   (`CBZ.dayPhase`, `CBZ.dayCycleSeconds`); without it — a one-shot page with
   six script tags — the plan runs its own 150-second day off whatever `dt`
   the poll is handed. Either way `hour()` is 0..24 with sunrise at 6.

   AND WITH `sun: true` IT BECOMES THAT SUN. A self-clocked plan publishes
   `CBZ.dayness` / `duskness` / `sunHeight` off its own phase, under the names
   core/daynight.js uses and only while nothing else owns them — which is what
   makes the advertised `day` + `light` pairing actually produce a dark night
   on a page that loaded no world. See driveSun().

   Flag DAY_PLAN_V1. Ratchet CBZ.dayPlanAudit().gaps pinned at 0 — across
   EVERY plan defined, every one of the 24 hours belongs to exactly one block,
   so nothing can fall through into "no schedule".
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.DAY_PLAN_V1 == null) CFG.DAY_PLAN_V1 = true;
  if (CBZ.dayPlan) return;                       // idempotent (family guard idiom)

  const DEFAULT_DAY = 150;                       // s — core/daynight.js's own default
  const SUNRISE = 6;                             // the hour phase 0 lands on

  const plans = [];

  /* ---- the clock. `CBZ.dayPhase()` is 0..1 over one day with 0 at sunrise,
       which is the convention every other reader of this engine's sun already
       uses; a plan with no sun of its own keeps a private phase advanced by
       the dt its poll is handed, so the same arithmetic runs on a page that
       loaded no world at all. ---- */
  function makeClock(spec) {
    let priv = 0.18;                             // mid-morning, so a bare page starts in daylight
    const dayLen = typeof spec.dayLength === "function" ? spec.dayLength
      : (spec.dayLength > 0 ? function () { return spec.dayLength; }
        : function () { return (CBZ.dayCycleSeconds ? CBZ.dayCycleSeconds() : DEFAULT_DAY) || DEFAULT_DAY; });
    const phase = typeof spec.clock === "function" ? spec.clock
      : function () {
        const t = CBZ.dayPhase ? CBZ.dayPhase() : priv;
        return isFinite(t) ? ((t % 1) + 1) % 1 : priv;
      };
    return {
      phase: phase,
      dayLength: dayLen,
      advance: function (dt) {
        if (CBZ.dayPhase || typeof spec.clock === "function") return;
        const L = dayLen();
        if (L > 0 && dt > 0) priv = (priv + dt / L) % 1;
      },
    };
  }

  /* ---- ...AND BEING THE SUN WHEN THERE ISN'T ONE ------------------------
     The header promises this file READS the world's sun. The other half was
     missing and it is the half a one-shot page lives in: with no
     core/daynight.js, `CBZ.dayness` is undefined, and every reader of it —
     systems/fixtures.js's sky() first among them, since `day` and `light` are
     sold as a pair — falls back to FULL DAYLIGHT. Measured on a bare page: a
     plan sitting in its `night` block while the fixture rig reported sky 1.0,
     every dusk fitting dark and `scale()` returning 1 everywhere. Lights-out
     with no dark in it.

     `sun: true` on define() closes that seam with the SAME arithmetic
     core/daynight.js uses (`up = sin(phase·2π)`, dayness = max(0, up),
     duskness = the glow near the horizon), under the same names, and only
     when nothing else owns them — a real sun always wins. Opt-in, so no
     existing plan changes by a byte. */
  const TAU = Math.PI * 2;
  let sunOwner = null;
  function driveSun(plan, phase) {
    if (sunOwner && sunOwner !== plan) return;
    if (CBZ.dayPhase) return;                    // a real sun is loaded: never fight it
    sunOwner = plan;
    const up = Math.sin(phase * TAU);            // -1 deep night .. 1 noon
    CBZ.dayness = Math.max(0, up);
    CBZ.duskness = Math.max(0, 1 - Math.abs(up) * 3);
    CBZ.sunHeight = up;
    CBZ.nightAmount = 1 - CBZ.dayness;
  }

  /* ==========================================================
     THE PLAN
     ========================================================== */
  function define(id, blocks, spec) {
    spec = spec || {};
    const list = (blocks && blocks.length) ? blocks : [{ id: "day", from: 0 }];
    const clock = makeClock(spec);
    const sunrise = spec.sunrise != null ? spec.sunrise : SUNRISE;
    const enabled = typeof spec.enabled === "function" ? spec.enabled
      : function () { return CFG.DAY_PLAN_V1 !== false; };
    const listeners = [];
    let cur = null, armed = false;

    function hourNow() { return (clock.phase() * 24 + sunrise) % 24; }
    function secsPerHour() { return clock.dayLength() / 24; }

    /* WHICH BLOCK OWNS AN HOUR. The table is authored in ascending `from` and
       the LAST entry wraps through midnight to the first, so an hour before
       the first block's start belongs to the last one — which is why the seed
       is `list[length-1]` and not a null that a caller would have to guard. */
    function blockAt(h) {
      let best = list[list.length - 1];
      for (let i = 0; i < list.length; i++) if (h >= list[i].from) best = list[i];
      return best;
    }
    function nextOf(b) { return list[(list.indexOf(b) + 1) % list.length]; }
    function hoursUntilNext(h) {
      const n = nextOf(blockAt(h));
      return ((n.from - h) % 24 + 24) % 24;
    }
    function live() { return cur || blockAt(hourNow()); }
    // how far through the CURRENT block we are, 0..1
    function progress() {
      const b = live(), n = nextOf(b);
      const span = ((n.from - b.from) % 24 + 24) % 24 || 24;
      return 1 - hoursUntilNext(hourNow()) / span;
    }

    function fire(b, prev, first) {
      for (let i = 0; i < listeners.length; i++) {
        try { listeners[i](b, prev, first); } catch (e) {}
      }
    }

    /* ---- POLL. Returns the live block, and fires the transition when it
         changes. `first` is the arm: a run can begin at any hour (the sky
         clock runs behind a title screen), so the plan lands in the block
         that is ACTUALLY running and tells its listeners this was not a
         change — a klaxon for an hour nobody played is a lie. ---- */
    function poll(dt) {
      if (!enabled()) return null;
      clock.advance(dt || 0);
      if (spec.sun) driveSun(plan, clock.phase());
      const b = blockAt(hourNow());
      if (!armed) { armed = true; const p = cur; cur = b; fire(b, p, true); }
      else if (b !== cur) { const p = cur; cur = b; fire(b, p, false); }
      return b;
    }
    // re-arm: the next poll lands silently again (a fresh run, a mode reset)
    function rearm() { armed = false; cur = null; }

    const plan = {
      id: id || "plan",
      blocks: list,
      enabled: enabled,
      hour: hourNow,
      // {h, m} for anything that needs a real time — a wall clock prop, a
      // watch. Deliberately NOT a HUD string: how a game SHOWS the hour is
      // the game's business and usually the answer is "it doesn't".
      clock: function () { const h = hourNow(); return { h: h | 0, m: ((h % 1) * 60) | 0 }; },
      phase: clock.phase,
      block: live,
      blockId: function () { return live().id; },
      is: function (bid) { return live().id === bid; },
      at: blockAt,
      next: function () { return nextOf(live()); },
      // real seconds until the next block starts
      until: function () { return hoursUntilNext(hourNow()) * secsPerHour(); },
      progress: progress,
      dayLength: clock.dayLength,
      hourLength: secsPerHour,
      on: function (fn) { if (typeof fn === "function") listeners.push(fn); return plan; },
      off: function (fn) { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); return plan; },
      poll: poll,
      rearm: rearm,
      armed: function () { return armed; },
      audit: function () { return auditPlan(plan, list, blockAt, hourNow); },
    };

    /* A plan may drive itself. Omit `tick` and the owner polls it from inside
       its own update — which is what a caller wants whenever the order of the
       transition against its neighbours is load-bearing. */
    if (spec.tick != null && CBZ.onUpdate) CBZ.onUpdate(+spec.tick, function (dt) { poll(dt); });

    plans.push(plan);
    return plan;
  }

  function auditPlan(plan, list, blockAt, hourNow) {
    let gaps = 0;
    for (let h = 0; h < 24; h += 0.25) if (!blockAt(h)) gaps++;
    let ordered = 1;
    for (let i = 1; i < list.length; i++) if (list[i].from <= list[i - 1].from) ordered = 0;
    let named = 1;
    const seen = {};
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.id == null || seen[b.id]) named = 0;
      seen[b.id] = 1;
      if (!(b.from >= 0 && b.from < 24)) ordered = 0;
    }
    return {
      id: plan.id, on: plan.enabled(), blocks: list.length,
      gaps: gaps, ordered: ordered, named: named,
      hour: Math.round(hourNow() * 100) / 100,
      block: plan.blockId(), until: Math.round(plan.until() * 10) / 10,
      progress: Math.round(plan.progress() * 100) / 100,
      dayLength: Math.round(plan.dayLength() * 10) / 10,
      armed: plan.armed(),
    };
  }

  CBZ.dayPlan = {
    define: define,
    plans: plans,
    get: function (id) { for (let i = 0; i < plans.length; i++) if (plans[i].id === id) return plans[i]; return null; },
  };

  /* THE RATCHET, ACROSS EVERY PLAN AT ONCE. `gaps` is the invariant that makes
     any timetable trustworthy: 24 hours, one block each, nothing falling
     through. `ordered` catches the other way a table rots — an entry authored
     out of sequence, which the wrap-seeded lookup would otherwise hide. */
  CBZ.dayPlanAudit = function () {
    let gaps = 0, ordered = 1, named = 1;
    const each = [];
    for (let i = 0; i < plans.length; i++) {
      const a = plans[i].audit();
      gaps += a.gaps; ordered = ordered && a.ordered ? 1 : 0; named = named && a.named ? 1 : 0;
      each.push(a);
    }
    return { plans: plans.length, gaps: gaps, ordered: ordered, named: named, each: each };
  };
})();
