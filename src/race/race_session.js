/* ============================================================
   race/race_session.js — ONE RACE, as rules. No THREE, no DOM.

   The grid → lights → laps → flag → cool-down loop, the standings and
   the field of drivers, in one place for both places a race is run:
     - Gang City's Bullring (city/speedway_race.js): the player's own
       character sits in one of the cars on the grid with the game's
       normal F, and the city's driving controls feed step();
     - games/race.html (race_game.js), the standalone test page.
   Both drive the SAME cars (race_physics) with the SAME drivers
   (race_ai), so there is one racing game, not two.

   create({ field, laps, playerSlot, playerNumber, auto, coolPlayer,
            seed }) → session
     session.phase      "idle" | "grid" | "race" | "done"
     session.entries    [{ i, number, name, player, car, driver,
                           finishT, place }]
     session.me         the player's entry (or null)
     session.layGrid()  every car in its grid box, standing still
     session.begin()    lay the grid and start the lights
     session.step(dt, input)   input = the player's RAW {steer, throttle,
                        brake} (steer +1 = LEFT); the assist is applied
                        here so every surface steers the same car
     session.setPlayer(slot)   which car the player sits in (-1: none)
     session.abandon()  the player left mid-race: everyone cools down
     session.standings()
     session.on         { lights(n, green), flash(text, kind),
                          finish(entry, place), results(order) }
============================================================ */
(function (root) {
  "use strict";

  const R = root && root.CBZ && root.CBZ.race;
  const core = (R && R.core) || (typeof require === "function" ? require("./race_core.js") : null);
  const PH = (R && R.physics) || (typeof require === "function" ? require("./race_physics.js") : null);
  const AI = (R && R.ai) || (typeof require === "function" ? require("./race_ai.js") : null);

  const NAMES = ["Harlan", "Okafor", "Brandt", "Castillo", "Voss", "Lindqvist", "Marchetti", "Pryce", "Tanaka", "Doyle", "Keane", "Sorensen"];
  const NUMBERS = [3, 8, 11, 22, 31, 42, 48, 54, 88, 91, 6, 99];
  // the field is dealt onto the grid MIXED (a grid sorted fastest-first is a procession)
  const GRID_MIX = [3, 7, 0, 5, 8, 1, 6, 2, 4, 9, 10, 11];
  const HOLD = Object.freeze({ steer: 0, throttle: 0, brake: 1, hold: true });   // a foot on the brake that never reverses
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  const ordinal = (n) => n + (n % 10 === 1 && n !== 11 ? "ST" : n % 10 === 2 && n !== 12 ? "ND" : n % 10 === 3 && n !== 13 ? "RD" : "TH");

  function create(o) {
    o = o || {};
    const FIELD = clamp(o.field || 10, 2, 12);
    const LAPS = clamp(o.laps || 8, 1, 60);
    const AUTO = !!o.auto;
    const COOL_PLAYER = o.coolPlayer !== false;
    const playerNumber = o.playerNumber || 17;
    const presets = AI.field(FIELD, o.seed || 17);
    const on = Object.assign({ lights() {}, flash() {}, finish() {}, results() {} }, o.on || {});

    const entries = [];
    for (let i = 0; i < FIELD; i++) {
      entries.push({ i, number: NUMBERS[i], name: NAMES[i % NAMES.length], player: false, car: null, driver: null, finishT: 0, place: i + 1, preset: presets[GRID_MIX[i] % presets.length] });
    }
    const slot0 = o.playerSlot == null ? 5 : o.playerSlot;
    if (slot0 >= 0 && slot0 < FIELD) entries[slot0].number = playerNumber;

    const S = {
      phase: "idle", t: 0, lit: 0, holdT: 0, raceT: 0, doneT: 0, flag: "green",
      finishOrder: [], leaderLap: -1, leader: null, excite: 0, laps: LAPS, field: FIELD,
      entries, me: null, on, ordinal,
    };

    /* WHO IS THE PLAYER. The page seats you in slot 5 (row 3, outside: you start
       mid-pack and race forward). The city seats you in whichever car you got
       into; that car keeps its own number, the others keep theirs. */
    S.setPlayer = function (slot) {
      S.me = null;
      for (const e of entries) {
        e.player = e.i === slot;
        if (e.player) { S.me = e; e.name = "You"; }
        else e.name = NAMES[e.i % NAMES.length];
        if (e.car) {
          e.car.isPlayer = e.player;
          e.car.assist.stab = e.player ? 0.5 : 0;
          // the car you take stops being an AI's; a car you leave gets no driver
          // (it brakes to a stop where you left it) — layGrid() deals the field
          if (e.player) e.driver = AUTO ? makeDriver(e) : null;
        }
      }
      return S.me;
    };
    function makeDriver(e) {
      if (e.player) return AUTO ? AI.create(e.car, { skill: 0.9, aggression: 0.4, seed: 4242 }) : null;
      return AI.create(e.car, Object.assign({ seed: 1000 + e.i * 7919 }, e.preset));
    }

    S.layGrid = function () {
      for (const e of entries) {
        const slot = core.GRID.slot(e.i);
        e.car = PH.createCar({ id: e.i, number: e.number, s: slot.s, u: slot.u, isPlayer: e.player, assist: e.player ? { stab: 0.5 } : undefined });
        e.driver = makeDriver(e);
        e.finishT = 0; e.place = e.i + 1;
      }
      S.phase = "idle"; S.finishOrder = []; S.leaderLap = -1; S.leader = null; S.flag = "green"; S.excite = 0;
      S.lit = 0; on.lights(0, false);                     // the gantry goes dark over a fresh grid
    };
    /* a car that is not on the grid any more (the city: the player drove it
       somewhere, or a shove moved it) is re-made where it actually stands */
    S.placeCar = function (e, x, z, yaw) {
      const n = core.nearest(x, z);
      e.car = PH.createCar({ id: e.i, number: e.number, s: n.s, u: n.u, isPlayer: e.player, assist: e.player ? { stab: 0.5 } : undefined });
      e.car.pos.x = x; e.car.pos.z = z; e.car.yaw = yaw;
      e.driver = makeDriver(e);
      return e.car;
    };

    S.begin = function () {
      S.layGrid();
      S.phase = "grid"; S.t = 0; S.lit = 0; S.raceT = 0; S.doneT = 0;
      S.holdT = 0.4 + ((Date.now() % 1000) / 1000) * 1.1;   // the unpredictable wait with all five lit
      on.lights(0, false);
    };

    S.standings = function () {
      // finished cars keep the order they took the flag in; everyone else by progress
      const live = entries.slice().sort((a, b) => {
        if (a.finishT && b.finishT) return a.finishT - b.finishT;
        if (a.finishT) return -1; if (b.finishT) return 1;
        return (b.car.lapS || 0) - (a.car.lapS || 0);
      });
      for (let i = 0; i < live.length; i++) live[i].place = i + 1;
      return live;
    };

    function cool(e) {
      if (e.player && !COOL_PLAYER) return;
      if (!e.driver) e.driver = AI.create(e.car, { skill: 0.8, aggression: 0, seed: 99 });
      e.driver.cruise = 0.7;
    }
    S.abandon = function () {
      if (S.phase === "idle") return;
      for (const e of entries) if (!e.player) cool(e);
      if (S.phase !== "done") { S.phase = "done"; S.doneT = 0; S.flag = "checker"; }
    };

    function onLap(e) {
      const lap = e.car.lap;
      if (lap > S.leaderLap) {
        S.leaderLap = lap;
        if (lap === LAPS - 1) S.flag = "white";
        if (lap >= LAPS) S.flag = "checker";
      }
      if (e === S.me && lap === LAPS - 1) on.flash("FINAL LAP", "white");
      if (lap >= LAPS && !e.finishT) {
        e.finishT = S.raceT; e.car.finished = true;
        S.finishOrder.push(e);
        cool(e);
        if (e === S.me) { const pl = S.standings().indexOf(S.me) + 1; on.flash(ordinal(pl), "chk"); on.finish(e, pl); S.excite = 1; }
      }
    }

    const cars = [], inputs = [], laps0 = [];
    const pin = { steer: 0, throttle: 0, brake: 0, hold: false };
    function playerIn(e, input, dt) {
      if (!input) return HOLD;
      pin.steer = PH.assistSteer(e.car, input.steer || 0, dt);
      pin.throttle = clamp(input.throttle || 0, 0, 1);
      pin.brake = clamp(input.brake || 0, 0, 1);
      pin.hold = !!input.hold;
      return pin;
    }

    /* step(dt, input): one frame of the whole field. The physics substeps
       itself (<= 1/120 s); dt is clamped to 0.1 there. */
    S.step = function (dt, input) {
      if (!(dt > 0)) return;
      cars.length = inputs.length = 0;
      for (const e of entries) cars.push(e.car);
      if (S.phase === "grid") {
        S.t += dt;
        // a beat to settle, then one lamp every 0.8 s, hold, all out
        const t = S.t - 1.2;
        const lit = t < 0 ? 0 : Math.min(5, 1 + Math.floor(t / 0.8));
        if (lit !== S.lit) { S.lit = lit; on.lights(lit, false); }
        if (lit === 5 && t > 4 * 0.8 + S.holdT) { S.phase = "race"; S.raceT = 0; on.lights(0, true); }
        for (const e of entries) inputs.push(HOLD);                // on the grid: feet on the brake
        PH.stepAll(cars, inputs, dt);
        return;
      }
      if (S.phase === "race") {
        S.raceT += dt;
        for (const e of entries) inputs.push(e.driver ? e.driver.drive(e.car, cars, dt) : playerIn(e, input, dt));
        for (let i = 0; i < entries.length; i++) laps0[i] = entries[i].car.lap;
        PH.stepAll(cars, inputs, dt);
        for (let i = 0; i < entries.length; i++) if (entries[i].car.lap > laps0[i]) onLap(entries[i]);
        for (const e of entries) if (e.car.fx && e.car.fx.impact && e.car.fx.impact.mag > 8) S.excite = Math.min(1, S.excite + 0.4);
        // everyone home (or the player home and 25 s passed): the board
        const done = entries.every((e) => e.finishT);
        if (done || (S.me && S.me.finishT && S.raceT - S.me.finishT > 25) || (!S.me && S.finishOrder.length && S.raceT - S.finishOrder[0].finishT > 40)) {
          S.phase = "done"; S.doneT = 0;
          for (const e of entries) cool(e);
          on.results(S.standings());
        }
        S.excite = Math.max(0, S.excite - dt * 0.3);
        return;
      }
      // after the flag the others cool down and the player drives on; idle
      // (practice on a parked field) only the player's car moves
      S.doneT += dt;
      const idle = S.phase === "idle";
      for (const e of entries) {
        if (e.player && (!e.driver || idle)) inputs.push(playerIn(e, input, dt));
        else if (e.driver && !idle) inputs.push(e.driver.drive(e.car, cars, dt));
        else inputs.push(HOLD);
      }
      PH.stepAll(cars, inputs, dt);
      S.excite = Math.max(0, S.excite - dt * 0.3);
    };
    /* the field comes to a stop where it is (the player got out and walked
       away): no more driving, brakes on */
    S.park = function () {
      for (const e of entries) { if (!e.player) e.driver = null; }
      S.phase = "idle";
    };

    S.setPlayer(slot0);
    return S;
  }

  const api = { create, NAMES, NUMBERS, ordinal };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    const CBZ = root.CBZ = root.CBZ || {};
    CBZ.race = CBZ.race || {};
    CBZ.race.session = api;
  }
})(typeof window !== "undefined" ? window : null);
