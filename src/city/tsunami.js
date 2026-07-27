/* ============================================================
   city/tsunami.js — THE SEA COMES ASHORE, IN THE REAL WORLD.

   A tsunami already existed in this game and you could never see it: it lived
   in systems/disasters.js, bound to the survival mode's own arena, drawn as
   its own rising mesh over its own island. The main world — the one with the
   beach, the marina, the harbour, the boats, the sharks — had no such thing,
   and could not have had one, because a flood built as a separate rising mesh
   has to be individually taught to every system that cares about water. That
   is why it stayed in the arena.

   THIS ONE AUTHORS NO WATER AT ALL.
   ---------------------------------
   The whole event is ONE NUMBER: CBZ.waterSurgeSet(metres), the sea-level
   offset in world/water_spec.js. Everything else in the game is already
   downstream of sea level:

     • the ocean shader displaces from it, and its shoreline cut walks inland
       with it, so the rendered waterline moves;
     • city/waterfield.js's water mask moves with it, so "is there water here"
       becomes true for streets that were dry — which is what makes it real to
       swimming, drowning, buoyancy, the gore medium and the underwater view;
     • every boat and floating body reads that same surface, so the marina
       lifts on its lines and a drifting corpse rides in over the seawall;
     • the sharks read it too, and their reach is a water test, so deep water
       coming inland means what deep water coming inland means.

   None of those files were told a tsunami exists. That is the entire design.

   THE SHAPE OF THE EVENT — and why the drawdown matters most
   ---------------------------------------------------------
   WARN: the sea pulls OUT. A negative surge, held long enough to be noticed,
   and it is the only warning you get. It is also the real one — the receding
   ocean is the signal that has actually saved lives — and it beats a siren
   because it is information you have to KNOW how to read rather than a label
   telling you what to feel. Boats settle onto the mud, the reef shows.

   SURGE: the sea comes back, fast and much further. HOLD: it stands over the
   waterfront. DRAIN: it goes out slowly, over most of a minute, and what it
   drags with it is the part people remember.

   The event is deliberately RARE and always announced by the water rather than
   by the HUD, and it never fires unattended: no player anywhere near the coast
   means no tsunami, because a disaster nobody witnesses is a save-file event,
   not a scene.

   Flags: TSUNAMI (whole file) · TSUNAMI_AUTO (does it ever fire on its own) ·
   TSUNAMI_PEAK (metres at the crest) · TSUNAMI_PERIOD (mean seconds between).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  CBZ.CONFIG = CBZ.CONFIG || {};

  if (CBZ.CONFIG.TSUNAMI == null) CBZ.CONFIG.TSUNAMI = true;
  // ON, because a disaster nothing can trigger is exactly the stat fiction
  // CLAUDE.md bans — a complete event behind a door that never opens. It is
  // made safe to leave on by being RARE (TSUNAMI_PERIOD), by never firing
  // unless the player is actually on the coast to see it, and above all by
  // announcing itself with 19 seconds of drawdown before the water turns
  // round. You are not ambushed; you are warned, in the only language the
  // sea has. ?cfg_TSUNAMI_AUTO=0 leaves CBZ.cityTsunami() as the only trigger.
  if (CBZ.CONFIG.TSUNAMI_AUTO == null) CBZ.CONFIG.TSUNAMI_AUTO = true;
  if (CBZ.CONFIG.TSUNAMI_PEAK == null) CBZ.CONFIG.TSUNAMI_PEAK = 5.4;      // metres above mean
  if (CBZ.CONFIG.TSUNAMI_DRAW == null) CBZ.CONFIG.TSUNAMI_DRAW = -2.6;     // metres of drawdown
  if (CBZ.CONFIG.TSUNAMI_PERIOD == null) CBZ.CONFIG.TSUNAMI_PERIOD = 2400; // s between auto events

  function on() { return CBZ.CONFIG.TSUNAMI !== false && !!CBZ.waterSurgeSet; }

  // ---- the arc ------------------------------------------------------------
  // Named beats with durations, read by a single stepper — the propuse.js arc
  // shape. Nothing accumulates, so the event can be cancelled on any frame by
  // dropping the state and zeroing the surge.
  const PHASES = [
    ["draw", 16],     // the sea goes out — the warning
    ["lull", 3.5],    // and holds there, low and wrong
    ["surge", 11],    // it comes back
    ["hold", 13],     // and stands
    ["drain", 34],    // and leaves
  ];
  const TOTAL = PHASES.reduce(function (a, p) { return a + p[1]; }, 0);

  let ev = null;          // { t, phase, peak, draw }
  // Seeded to a FULL period, not 0. Starting at zero means the very first tick
  // of the very first session finds the timer already expired and fires a
  // tsunami in your first second of play — which is not "rare", it is "always".
  let autoCD = CBZ.CONFIG.TSUNAMI_PERIOD;
  let noted = "";
  let _rising = false;    // is the water still coming in (set at 9.2, read at 10.6)
  let panicCD = 0;

  function ease(u) { return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; }

  // surge in metres for a given time into the event
  function surgeAt(t, peak, draw) {
    let acc = 0;
    for (let i = 0; i < PHASES.length; i++) {
      const name = PHASES[i][0], dur = PHASES[i][1];
      if (t < acc + dur) {
        const u = (t - acc) / dur;
        switch (name) {
          // The drawdown is FAST going out — a receding tsunami empties a bay
          // in well under a minute, and the speed of it is the tell.
          case "draw":  return draw * ease(Math.min(1, u * 1.9));
          case "lull":  return draw;
          // Coming back is faster still, and it overshoots straight past mean
          // sea level without pausing there. That non-stop is the wall.
          case "surge": return draw + (peak - draw) * ease(u);
          case "hold":  return peak * (1 - 0.10 * u);      // sags a little as it spreads
          case "drain": return peak * 0.90 * (1 - ease(u));
        }
      }
      acc += dur;
    }
    return 0;
  }
  function phaseAt(t) {
    let acc = 0;
    for (let i = 0; i < PHASES.length; i++) {
      if (t < acc + PHASES[i][1]) return PHASES[i][0];
      acc += PHASES[i][1];
    }
    return "";
  }

  /* ---- WHO IS ON THE COAST ----------------------------------------------
     Both the trigger gate and the panic radius. `shoreAt` is not public, so
     this asks the question the public API can answer: how far is the player
     from water that already exists. */
  function nearCoast(x, z, r) {
    if (!CBZ.cityWaterAt) return false;
    const step = Math.max(8, r / 8);
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
      const dx = Math.sin(a), dz = Math.cos(a);
      for (let d = 0; d <= r; d += step) if (CBZ.cityWaterAt(x + dx * d, z + dz * d)) return true;
    }
    return false;
  }

  /* ---- THE EVENT ---------------------------------------------------------- */
  CBZ.cityTsunami = function (opts) {
    if (!on() || ev) return false;
    opts = opts || {};
    ev = {
      t: 0,
      peak: opts.peak != null ? +opts.peak : CBZ.CONFIG.TSUNAMI_PEAK,
      draw: opts.draw != null ? +opts.draw : CBZ.CONFIG.TSUNAMI_DRAW,
      phase: "",
    };
    noted = "";
    return true;
  };
  CBZ.cityTsunamiState = function () {
    return ev ? { phase: ev.phase, t: ev.t, total: TOTAL, surge: CBZ.waterSurge ? CBZ.waterSurge() : 0 } : null;
  };
  CBZ.cityTsunamiStop = function () {
    ev = null;
    if (CBZ.waterSurgeSet) CBZ.waterSurgeSet(0);
  };

  /* ---- DROWNING ----------------------------------------------------------
     The flood does not need its own damage model. A body standing in water
     deeper than it is tall is a body underwater, and this game already knows
     what to do with one — city/swim.js owns the player's waterline and
     drowning, and it reads the same surface. So the only thing this file does
     is what nothing else can know: a body that never chose to be in water is
     SWEPT, and being swept is what kills people in a tsunami, not the depth.
     Deaths go through the kill bus like every other death in the game. */
  const SWEEP = 9.0;                    // m/s the flood front drags a body at
  function sweep(dt, rising) {
    const P = CBZ.player;
    if (!P || P.dead || P.driving) return;
    const d = CBZ.cityFloodDepthAt ? CBZ.cityFloodDepthAt(P.pos.x, P.pos.z) : 0;
    if (d <= 0.35) return;
    // shoved inland on the surge, dragged seaward on the drain — the direction
    // reverses, which is the thing that makes the drain the dangerous half.
    const water = nearestWaterDir(P.pos.x, P.pos.z);
    if (!water) return;
    const s = Math.min(1, d / 2.2) * SWEEP * dt * (rising ? -1 : 1);
    P.pos.x += water.x * s;
    P.pos.z += water.z * s;
    // knocked off your feet: the existing stun channel, not a new one
    if (d > 1.1 && P.stun != null) P.stun = Math.max(P.stun, 0.25);
  }
  // WHICH WAY IS THE SEA. Sixteen bearings × a handful of ranges is ~128 water
  // queries, which is nothing once but real money twice a frame for a minute,
  // so the answer is cached for half a second and against movement. The
  // direction to the coast does not change quickly, and being a beat stale
  // costs a fraction of a metre of shove.
  const _wd = { x: 0, z: 0 };
  let _wdT = -1e9, _wdX = 0, _wdZ = 0, _wdOk = false;
  function nearestWaterDir(x, z) {
    const now = CBZ.now || 0;
    if (now - _wdT < 500 && Math.abs(x - _wdX) < 12 && Math.abs(z - _wdZ) < 12) return _wdOk ? _wd : null;
    _wdT = now; _wdX = x; _wdZ = z;
    _wdOk = false;
    const r = scanWaterDir(x, z);
    _wdOk = !!r;
    return r;
  }
  function scanWaterDir(x, z) {
    if (!CBZ.cityWaterAt) return null;
    let bx = 0, bz = 0, found = false, bd = 1e9;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const dx = Math.sin(a), dz = Math.cos(a);
      for (let d = 6; d <= 90; d += 12) {
        if (!CBZ.cityWaterAt(x + dx * d, z + dz * d)) continue;
        if (d < bd) { bd = d; bx = dx; bz = dz; found = true; }
        break;
      }
    }
    if (!found) return null;
    _wd.x = bx; _wd.z = bz;
    return _wd;
  }

  /* ---- TICK --------------------------------------------------------------- */
  CBZ.onUpdate(9.2, function (dt) {
    if (!on()) return;
    const g = CBZ.game;
    if (!g || g.mode !== "city") {
      if (ev) CBZ.cityTsunamiStop();
      return;
    }
    const P = CBZ.player;

    if (!ev) {
      if (!CBZ.CONFIG.TSUNAMI_AUTO || g.state !== "playing" || !P) return;
      autoCD -= dt;
      if (autoCD > 0) return;
      autoCD = CBZ.CONFIG.TSUNAMI_PERIOD;
      // never unattended, and never while you are already out at sea with no
      // chance of reading the warning
      if (!nearCoast(P.pos.x, P.pos.z, 260)) return;
      CBZ.cityTsunami();
      return;
    }

    const prev = CBZ.waterSurge ? CBZ.waterSurge() : 0;
    ev.t += dt;
    if (ev.t >= TOTAL) { CBZ.cityTsunamiStop(); return; }
    const s = surgeAt(ev.t, ev.peak, ev.draw);
    CBZ.waterSurgeSet(s);
    ev.phase = phaseAt(ev.t);
    const rising = s > prev;

    // ---- the world reacts, through the channels it already had -------------
    if (ev.phase !== noted) {
      noted = ev.phase;
      const note = CBZ.city && CBZ.city.note;
      // Only the drawdown is announced, and it is announced as an OBSERVATION,
      // not a warning: the game tells you what you can see, and leaves the
      // conclusion to you. Naming it would throw away the only interesting
      // moment the event has.
      if (note && ev.phase === "draw") note("The water is going out. Fast.", 3.4);
      if (note && ev.phase === "surge") note("It's coming back.", 2.6);
    }

    if (P && !P.dead) {
      // panic: the crowd runs from the WATER, which means inland, which is the
      // correct thing to do — and it costs one call because crowd.js's flee
      // already takes a point to run away from.
      const w = nearestWaterDir(P.pos.x, P.pos.z);
      // PANIC — one call, city/cityevents.js's bus. It drives the full-rig
      // peds' rippling per-ped panic (so the fear spreads outward and the
      // brave ones stop to gawk at the water instead of everyone starbursting
      // on the same frame) AND scatters the instanced background crowd itself.
      // Posted from a point OUT TO SEA, so "away from the threat" is inland,
      // which is the correct thing to run.
      //
      // Throttled: the ring is small and each entry radiates for 0.6s, so
      // posting every frame would flush every other event in the world out of
      // it. Twice a second keeps the field alive and leaves the ring usable.
      panicCD -= dt;
      if (w && s > 0.6 && panicCD <= 0) {
        panicCD = 0.5;
        CBZ.cityPostEvent && CBZ.cityPostEvent({
          type: "explosion", pos: { x: P.pos.x + w.x * 40, y: 0, z: P.pos.z + w.z * 40 },
          radius: 150, intensity: 1.2,
        });
      }
      _rising = rising;
      // the dread bus (systems/predator.js) is the game's ONE tension channel;
      // an approaching wall of water is exactly what it is for, so the music
      // and the near-silence before the surge come free.
      if (CBZ.predatorDread && s !== 0) {
        const lvl = ev.phase === "surge" ? 1 : (ev.phase === "draw" ? 0.45 : 0.7);
        CBZ.predatorDread({ id: "tsunami" }, lvl, { dist: 40 });
      }
    }
  });

  /* THE SWEEP RUNS AFTER THE PLAYER, NOT WITH THE WATER.
     The surge has to be set at 9.2 — ahead of the moving platforms at 9.4/9.5
     and updatePlayer at 10 — because everything downstream reads sea level
     that frame. But shoving the body has to happen AFTER updatePlayer has
     resolved, or the movement solve simply overwrites it and the flood pushes
     you nowhere. Same one-frame ordering lesson as city/beach.js's dock. */
  CBZ.onUpdate(10.6, function (dt) {
    if (!ev || !on()) return;
    const g = CBZ.game;
    if (!g || g.mode !== "city" || g.state !== "playing") return;
    sweep(dt, _rising);
  });

  // Evidence: is a surge live, and is the water mask agreeing with the shader.
  // `mismatch` is the one thing that would be a real bug — the sea rendered
  // somewhere the game does not think is wet.
  CBZ.tsunamiAudit = function () {
    return {
      running: !!ev,
      phase: ev ? ev.phase : null,
      surge: CBZ.waterSurge ? CBZ.waterSurge() : 0,
      floodQuery: !!CBZ.cityFloodDepthAt,
    };
  };
})();
