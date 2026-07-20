/* ============================================================
   games/racing.js — APEX NIGHT, as a GAME PACKAGE.

   The speedway ISLAND already exists (city/island_speedway.js): a banked
   tri-oval, real drivable cars (city/vehicles.js), a real driving-AI brain
   (city/racedrivers.js → CBZ.raceDrivers), a shared scorer (CBZ.raceKit),
   a live timing strip + start-lights (CBZ.raceHud), and a championship
   roster (city/racing.js → CBZ.cityRacing). That's the ENGINE. This package
   does NOT rebuild any of it — it adds the EVENT: a self-contained race
   NIGHT you walk into at the paddock.

   THE ARC (GAMES-FIRST roadmap): [E] at the paddock → pay entry ($250 real
   city cash) → one flying QUALIFYING lap sets your grid slot → optional side
   bet on YOURSELF at odds fixed by that grid slot → a 5-lap race vs the
   championship field (real CBZ.raceDrivers, or pace ghosts on the spline
   headless) under a start-light gantry (jump it = +5s) → purse by finish +
   points → three races make the night; most points = CHAMPION + bonus.
   LEAVE any time between races with your winnings. Night stats persist.

   WHAT IS REUSED vs ADDED
     REUSED  CBZ.raceDrivers.spawn (the AI that actually drives real cars),
             CBZ.raceKit (laps/positions/gaps/best), CBZ.raceHud (the live
             strip + red-light sequence), CBZ.cityMakeCar / cityEnterVehicle
             (the player drives a REAL vehicle — own ride or a paddock
             loaner), the tri-oval TRACK itself (its centreline is
             re-derived read-only from island_speedway's fixed constants —
             the same accepted pattern racedrivers.js uses to mirror
             vehicles.js carDynamics; the oval is a literal, not seeded, so
             this is byte-identical every seed), and CBZ.cityRacing's roster.
     ADDED   the EVENT loop (qualify→grid→race→purse→bet→championship night),
             the salvaged ECON math from games/racing.html (entry/purse/odds/
             points/champion bonus/jump penalty), the paddock dressing
             (start gantry, live timing tower, bookmaker stand), and the cast
             (marshal, bookmaker, patrons via ctx.npc).

   Venue: the speedway is a LANDMASS, not a lot (the "raceway" lot kind is the
   downtown ticket office). So venue.resolve() anchors at the island's
   start/finish line (contract #8: confirmed via city.regions), and the
   engine lazily retries until the island is built.

   Revert: CBZ.CONFIG.PKG_RACING = false → nothing mounts; the island's own
   JOIN-THE-RACE weekend is completely untouched.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.games) return;
  const THREE = window.THREE;

  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.PKG_RACING == null) CBZ.CONFIG.PKG_RACING = true;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const fmtCash = (n) => "$" + Math.round(n).toLocaleString("en-US");
  function fmtT(s) {
    if (CBZ.raceHud && CBZ.raceHud.fmtT) return CBZ.raceHud.fmtT(s);
    if (s == null || !isFinite(s)) return "--.-";
    const m = Math.floor(s / 60), r = s - m * 60;
    return (m > 0 ? m + ":" : "") + (r < 10 && m > 0 ? "0" : "") + r.toFixed(2);
  }
  function hex6(n) { return "#" + ("000000" + ((n >>> 0).toString(16))).slice(-6); }
  function esc(s) { return String(s == null ? "" : s).replace(/[<>&]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;")); }
  function note(m, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(m, s || 2.2); }

  /* ============================================================
     MIRRORED TRACK GEOMETRY — read-only re-derivation of the
     island_speedway.js tri-oval. These are the SAME fixed literals
     the island uses (CX/CZ are not seeded — the speedway is always at
     one place), so the centreline is byte-identical across seeds and
     clients (determinism law #12). Kept in one block so a drift is a
     one-line fix, exactly like racedrivers.js's carDynamics mirror.
  ============================================================ */
  // stage-2 dial: the speedway CAN move now — mirror its anchor exactly
  // (island_speedway.js routes the same worldOff) so the centreline stays
  // byte-identical to the island's own frame at any offset.
  const _SPOFF = (CBZ.worldOff && CBZ.worldOff("speedway")) || { dx: 0, dz: 0 };
  const CX = 490 + _SPOFF.dx, CZ = -350 + _SPOFF.dz, OVAL_RX = 150, OVAL_RZ = 103, TRIBULGE = 12, TRACK_W = 22, SF_T = 0.0;

  // world-space frame at param t — MATCHES island_speedway CBZ_FRAME exactly
  // (race normal convention nx:-tz, nz:tx) so CBZ.raceDrivers line-mode and the
  // grid geometry behave precisely as the island's own weekend already proved.
  function frame(t) {
    const a = t * Math.PI * 2;
    let x = CX + Math.cos(a) * OVAL_RX;
    let z = CZ + Math.sin(a) * OVAL_RZ;
    z += Math.max(0, Math.sin(a)) * Math.max(0, Math.sin(a)) * TRIBULGE;
    const a2 = (t + 0.0015) * Math.PI * 2;
    let x2 = CX + Math.cos(a2) * OVAL_RX, z2 = CZ + Math.sin(a2) * OVAL_RZ;
    z2 += Math.max(0, Math.sin(a2)) * Math.max(0, Math.sin(a2)) * TRIBULGE;
    const dx = x2 - x, dz = z2 - z, len = Math.hypot(dx, dz) || 1;
    const tx = dx / len, tz = dz / len;
    return { x, z, tx, tz, nx: -tz, nz: tx, heading: Math.atan2(tx, tz) };
  }
  let LINE_LEN = 0;
  function lineLen() {
    if (LINE_LEN) return LINE_LEN;
    let L = 0, p = frame(0);
    for (let i = 1; i <= 96; i++) { const f = frame(i / 96); L += Math.hypot(f.x - p.x, f.z - p.z); p = f; }
    return (LINE_LEN = L);
  }
  function paramAt(x, z) {
    let best = 0, bd = 1e9;
    for (let i = 0; i < 64; i++) { const t = i / 64, f = frame(t); const d = (x - f.x) * (x - f.x) + (z - f.z) * (z - f.z); if (d < bd) { bd = d; best = t; } }
    return best;
  }
  // grid slot i (0 = pole) — the SAME staggered two-column geometry
  // island_speedway.gridSlot() lays down, so the painted grid boxes line up.
  function gridSlot(i) {
    const f = frame(SF_T);
    const row = i >> 1, lane = (i % 2 === 0) ? 1 : -1;
    const COLW = 2.6, ROWGAP = 6.0;
    const back = -(row * ROWGAP + (lane > 0 ? 0 : ROWGAP * 0.5) + 3.0);
    const x = f.x + f.tx * back + f.nx * (lane * COLW);
    const z = f.z + f.tz * back + f.nz * (lane * COLW);
    const t = ((back / lineLen()) % 1 + 1) % 1;
    return { x, z, heading: frame(t).heading };
  }

  /* ============================================================
     SALVAGED EVENT ECONOMY — ported verbatim from games/racing.html's
     ECON block (the only pure logic worth lifting; the .html's world
     geometry / physics are all superseded by the city engine). This is
     the whole reason a "night" is a game and not a time-trial: real cash
     in, purse and points out, odds that punish a good grid slot.
  ============================================================ */
  const ECON = {
    entry: 250,
    purse: [700, 400, 250, 120, 60, 0, 0, 0],       // by FINISH position (1-based)
    odds: [1.8, 2.4, 3.2, 4.0, 5.0, 6.5, 8.0, 10.0], // side-bet odds by GRID slot
    stakes: [0, 100, 200, 400],
    points: [10, 7, 5, 3, 2, 1, 0, 0],              // championship points by finish
    championBonus: 1200,
    LAPS: 5, RACES: 3, FIELD: 7, JUMP_PENALTY: 5,
  };
  function purseFor(pos) { return ECON.purse[clamp((pos | 0) - 1, 0, ECON.purse.length - 1)] || 0; }
  function pointsFor(pos) { return ECON.points[clamp((pos | 0) - 1, 0, ECON.points.length - 1)] || 0; }
  function oddsForGrid(grid) { return ECON.odds[clamp((grid | 0) - 1, 0, ECON.odds.length - 1)]; }
  // bet on yourself: only a WIN (P1) pays, at your grid-slot odds. (racing.html)
  function settleBet(stake, grid, finishPos) { return finishPos === 1 ? Math.round(stake * oddsForGrid(grid)) : 0; }

  /* ============================================================
     THE FIELD — the championship roster is the field of names you race.
  ============================================================ */
  function rosterField() {
    const RC = CBZ.cityRacing;
    let field = (RC && RC.standings) ? RC.standings().slice(0, ECON.FIELD) : [];
    field = field.map((r) => r);
    if (field.length < ECON.FIELD) {
      // roster module absent / short: anonymous fast rivals so a night still runs
      const cols = [0xc0392b, 0x1b6ec8, 0x2ba24a, 0xd66a2e, 0x6a2bd6, 0xe0a92e, 0xeef2f6];
      const styles = ["aventador", "ferrari", "porsche", "enzo", "muscle", "veyron", "muscle"];
      for (let i = field.length; i < ECON.FIELD; i++) {
        field.push({ name: "Rival " + (90 + i), number: 90 + i, teamColor: cols[i % cols.length], accent: 0xeef2f6, skill: 0.72 + (i % 5) * 0.045, homeStyle: styles[i % styles.length] });
      }
    }
    return field;
  }
  function liveryFor(r) {
    const RC = CBZ.cityRacing;
    if (RC && RC.liveryFor) return RC.liveryFor(r);
    return { number: r.number, base: r.teamColor, accent: r.accent };
  }

  /* ============================================================
     PURE RACE SIMULATION — a headless model of one race, used by the
     api probe (simRace/simNight) to assert the ECON math WITHOUT the
     3D/physics. The live race (below) uses the real engine; this exists
     so a gate can prove finish-ordering + purse + points + bet + the
     jump penalty deterministically (an injectable rng makes it repeatable).
  ============================================================ */
  function lcg(seed) { let s = (seed | 0) || 1; return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }
  function raceSim(opts) {
    opts = opts || {};
    const rnd = opts.rng || (opts.seed != null ? lcg(opts.seed) : Math.random);
    const laps = opts.laps || ECON.LAPS;
    const baseLap = lineLen() / 38;                 // ~reference lap seconds at 38 m/s
    const field = opts.field || rosterField();
    const ents = field.map((r) => ({ racer: r, name: r.name, number: r.number, color: r.teamColor, skill: r.skill != null ? r.skill : 0.8 }));
    ents.push({ player: true, name: "YOU", number: null, color: null, skill: opts.playerSkill != null ? opts.playerSkill : 0.85 });
    for (const e of ents) {
      // skill sets the pace ceiling; per-lap consistency noise spreads the field
      const lap = baseLap * (1.14 - e.skill * 0.26);
      let tot = 0;
      for (let l = 0; l < laps; l++) tot += lap * (0.985 + rnd() * 0.03);
      e.raceTime = tot;
      if (e.player && opts.crash) e.dnf = true;
      if (e.player && opts.jump) e.raceTime += ECON.JUMP_PENALTY;   // start-light jump
    }
    ents.sort((a, b) => { if (!!a.dnf !== !!b.dnf) return a.dnf ? 1 : -1; return a.raceTime - b.raceTime; });
    ents.forEach((e, i) => { e.pos = i + 1; });
    const pe = ents.find((e) => e.player);
    const playerPos = pe.dnf ? ents.length : pe.pos;
    const grid = opts.playerGrid || 4;
    const stake = opts.stake || 0;
    const purse = pe.dnf ? 0 : purseFor(playerPos);
    const points = pe.dnf ? 0 : pointsFor(playerPos);
    const betPay = (stake && opts.betSelf) ? settleBet(stake, grid, pe.dnf ? 99 : playerPos) : 0;
    return {
      order: ents.map((e) => ({ name: e.name, number: e.number, pos: e.pos, player: !!e.player, dnf: !!e.dnf, time: e.raceTime })),
      playerPos, purse, points, stake, betPay, grid, jump: !!opts.jump, dnf: !!pe.dnf,
    };
  }
  // a full 3-race night, pure — proves the championship-points + bonus math.
  function nightSim(opts) {
    opts = opts || {};
    const field = rosterField();
    const rnd = opts.seed != null ? lcg(opts.seed) : Math.random;
    const tally = {}; field.forEach((r) => { tally[r.number] = 0; }); let playerPts = 0;
    const races = [];
    for (let r = 0; r < ECON.RACES; r++) {
      const res = raceSim(Object.assign({ rng: rnd, field: field }, opts));
      races.push(res);
      playerPts += res.points;
      res.order.forEach((o) => { if (!o.player && o.number != null) tally[o.number] += pointsFor(o.pos); });
    }
    let best = playerPts, championIsPlayer = true;
    field.forEach((r) => { if (tally[r.number] > best) { best = tally[r.number]; championIsPlayer = false; } });
    return { races, playerPts, championIsPlayer, bonus: championIsPlayer ? ECON.championBonus : 0, tally };
  }

  /* ============================================================
     LIVE NIGHT STATE — the event's small state machine, driven from
     update(). phases: idle → qualify → gridcount → race → (results panel).
  ============================================================ */
  const NIGHT = {
    active: false, phase: "idle", raceIx: 0,
    playerPts: 0, aiPts: {},                 // championship tally across the night
    qualArmed: false, qualT: 0, qualLast: 0, qualTime: 0,
    grid: null, playerGrid: 1,
    drivers: [], kit: null, useRD: false,
    playerLaps: -1, playerLastT: 0, playerTotal: -0.02,
    countT: 0, jumped: false, settleT: 0, greenT: 0,
    bet: null, loaner: null, night$: 0,
    gantry: null, tower: null, flag: null, flagT: 0, flagMode: 0,  // 0 none 1 green 2 checker
  };
  let C = null;      // ctx once mounted
  let VENUE = null;  // the mounted venue (group/origin/cast)
  let S = null;      // persisted night-stats bag
  function bag() { return S || (S = C.state(() => ({ nights: 0, races: 0, wins: 0, podiums: 0, titles: 0, bestNet: 0, points: 0 }))); }
  function save() { if (C) C.saveState(); }

  function playerCar() { const P = CBZ.player; return P && P.driving ? P._vehicle : null; }
  function placeCar(car, slot) {
    if (!car) return;
    car.pos.x = slot.x; car.pos.z = slot.z; car.heading = slot.heading;
    car.v = 0; car.vx = 0; car.vz = 0;
    if (car.group) { car.group.position.set(slot.x, 0, slot.z); car.group.rotation.y = slot.heading; }
    if (CBZ.player) CBZ.player.pos.set(slot.x, 0, slot.z);
  }
  // hand the player a real race car if they walked up on foot (a paddock
  // loaner) — a REAL cityMakeCar seated via the REAL enter path (no physics
  // fork). If they drove in, we race their own ride.
  function ensureCar() {
    let car = playerCar();
    if (car && !car.dead) return car;
    if (!CBZ.cityMakeCar || !CBZ.cityEnterVehicle) return null;
    let model = null;
    if (CBZ.raceDrivers && CBZ.raceDrivers.modelForStyle) model = CBZ.raceDrivers.modelForStyle("muscle");
    if (!model) { const CARS = (CBZ.cityEcon && CBZ.cityEcon.CARS) || []; model = CARS[CARS.length - 1] || null; }
    if (!model) return null;
    const spot = gridSlot(0);
    try { car = CBZ.cityMakeCar(spot.x, spot.z, spot.heading, false, model, 0.2); } catch (e) { return null; }
    if (!car) return null;
    car.owned = true; car.ai = false; NIGHT.loaner = car;
    try { CBZ.cityEnterVehicle(car); } catch (e) { return null; }
    return car;
  }
  function clearLoaner() {
    const car = NIGHT.loaner; NIGHT.loaner = null;
    if (!car) return;
    if (CBZ.player && CBZ.player._vehicle === car) return;   // still theirs — let them drive off
    const i = CBZ.cityCars ? CBZ.cityCars.indexOf(car) : -1;
    if (i >= 0) CBZ.cityCars.splice(i, 1);
    car.dead = true;
    if (car.group && car.group.parent) car.group.parent.remove(car.group);
    if (car.group) car.group.traverse((o) => {
      if (o.isSprite) return;
      if (o.geometry && !o.geometry._shared && o.geometry.dispose) { try { o.geometry.dispose(); } catch (e) {} }
      const m = o.material; if (Array.isArray(m)) m.forEach((x) => { if (x && !x._shared && x.dispose) x.dispose(); });
      else if (m && !m._shared && m.dispose) { try { m.dispose(); } catch (e) {} }
    });
  }

  function useRD() { return !!(CBZ.raceDrivers && CBZ.raceDrivers.enabled && CBZ.raceDrivers.enabled() && CBZ.raceKit && CBZ.cityMakeCar); }

  /* ---------------- start the night / a race ---------------- */
  function startNight() {
    if (NIGHT.active) return;
    if (CBZ.speedwayRaceState && CBZ.speedwayRaceState().active) { note("A race is already running on the oval.", 2.2); return; }
    if (!C.wallet.canAfford(ECON.entry)) { note("Entry is " + fmtCash(ECON.entry) + " — you're short.", 2.4); return; }
    if (!ensureCar()) { note("Bring a car to the paddock to qualify.", 2.4); return; }
    if (!C.wallet.spend(ECON.entry, "APEX NIGHT entry")) return;
    NIGHT.active = true; NIGHT.raceIx = 0; NIGHT.playerPts = 0; NIGHT.aiPts = {}; NIGHT.night$ = -ECON.entry;
    rosterField().forEach((r) => { NIGHT.aiPts[r.number] = 0; });
    bag().nights++; save();
    beginQualify();
  }
  function beginQualify() {
    const car = ensureCar();
    if (!car) { cancelNight("Left the paddock without a car."); return; }
    NIGHT.phase = "qualify"; NIGHT.qualArmed = false; NIGHT.qualT = 0; NIGHT.qualTime = 0;
    // a rolling start: sit ~30m back on the racing line, gun it, cross the S/F
    // line to arm the flying lap; the next crossing stops the clock.
    const tBack = ((1 - 30 / lineLen()) % 1 + 1) % 1;
    placeCar(car, { x: frame(tBack).x, z: frame(tBack).z, heading: frame(tBack).heading });
    NIGHT.qualLast = paramAt(car.pos.x, car.pos.z);
    if (CBZ.raceHud) CBZ.raceHud.hide();
    towerDraw(["QUALIFY", "flying lap"], "RACE " + (NIGHT.raceIx + 1) + "/" + ECON.RACES);
    note("QUALIFYING — one flying lap. Cross the line and give it everything!", 3.2);
    C.hud.closePanel();
  }
  function finishQualify(car) {
    // grid = your real lap vs the field's skill-simulated qual times
    const field = rosterField();
    const baseLap = lineLen() / 40;
    const entries = field.map((r) => ({ racer: r, qt: baseLap * (1.10 - (r.skill != null ? r.skill : 0.8) * 0.22) * (0.97 + Math.random() * 0.06) }));
    entries.push({ player: true, qt: NIGHT.qualTime });
    entries.sort((a, b) => a.qt - b.qt);
    entries.forEach((e, i) => { e.slot = i; });        // 0-based grid slot
    NIGHT.grid = entries;
    NIGHT.playerGrid = (entries.find((e) => e.player).slot | 0) + 1;
    note("Qualified P" + NIGHT.playerGrid + " · " + fmtT(NIGHT.qualTime), 3.0);
    openBetPanel();
  }

  function spawnField() {
    NIGHT.drivers = []; NIGHT.useRD = useRD();
    const rd = CBZ.raceDrivers;
    for (const e of NIGHT.grid) {
      if (e.player) continue;
      const slot = gridSlot(e.slot), r = e.racer;
      const lane0 = (e.slot % 2 === 0 ? 1 : -1) * 2.6;
      let rec = null;
      if (NIGHT.useRD) {
        const m = rd.spawn({
          x: slot.x, z: slot.z, heading: slot.heading,
          style: r.homeStyle || "muscle", color: r.teamColor, livery: liveryFor(r),
          name: r.name, number: r.number, skill: r.skill || 0.8,
          aggr: 0.35 + (r.skill || 0.8) * 0.45, consistency: 0.55 + (r.skill || 0.8) * 0.4,
          lane0: lane0, tag: "apex", mode: "line", line: frame, lineLen: lineLen(), trackHalf: TRACK_W / 2,
          playerProgress: function () { return NIGHT.playerTotal; },
        });
        if (m) { m.laps = -1; m._racer = r; rec = { racer: r, real: m, ghost: null }; }
      }
      if (!rec) {
        // headless / no driver module → a pace ghost on the spline (the island's
        // own legacy fallback shape): rubber-banded skill pace, no car physics.
        rec = { racer: r, real: null, ghost: { laps: -1, t: paramAt(slot.x, slot.z), speed: 38, lane: lane0 } };
      }
      NIGHT.drivers.push(rec);
    }
    if (NIGHT.useRD && !NIGHT.drivers.some((d) => d.real)) NIGHT.useRD = false;   // all spawns failed
  }
  function driverProgress(d) { return d.real ? (d.real.laps + d.real.t) : (d.ghost.laps + d.ghost.t); }
  function driverSpeed(d) { return d.real ? Math.abs((d.real.car && d.real.car.v) || 0) : d.ghost.speed; }

  function beginGrid() {
    const car = ensureCar();
    if (!car) { cancelNight("Left the paddock without a car."); return; }
    spawnField();
    placeCar(car, gridSlot(NIGHT.playerGrid - 1));
    NIGHT.phase = "gridcount"; NIGHT.countT = 4.2; NIGHT.settleT = 0.35;
    NIGHT.jumped = false; NIGHT.greenT = 0;
    NIGHT.playerLaps = -1; NIGHT.playerLastT = paramAt(car.pos.x, car.pos.z); NIGHT.playerTotal = -0.02;
    // the scorer: same shape island_speedway feeds raceKit (grid behind the
    // line → lapFloor0 -1 so the roll-over crossing arms lap 1, never scored).
    const entrants = NIGHT.drivers.map((d) => ({
      id: "n" + d.racer.number, name: d.racer.name, number: d.racer.number, color: d.racer.teamColor,
      driver: d, progress: function () { return driverProgress(d); }, speed: function () { return driverSpeed(d); }, lapFloor0: -1,
    }));
    entrants.push({
      id: "you", name: "YOU", number: null, color: null, isPlayer: true,
      progress: function () { return NIGHT.playerTotal; },
      speed: function () { const c = playerCar(); return Math.abs((c && c.v) || 0); }, lapFloor0: -1,
    });
    NIGHT.kit = CBZ.raceKit ? CBZ.raceKit.create({ laps: ECON.LAPS, trackLen: lineLen(), entrants: entrants }) : null;
    if (CBZ.raceHud) { CBZ.raceHud.show(); CBZ.raceHud.lights(0); }
    setGantry(0, false);
    note("RACE " + (NIGHT.raceIx + 1) + " — lights are coming on. Hold the brake!", 3.0);
    C.hud.closePanel();
  }

  function finishRace(opts) {
    opts = opts || {};
    NIGHT.phase = "idle";
    const kit = NIGHT.kit; if (kit) kit.update(0);
    // finishing order (player carries the jump penalty on their finish time)
    let order;
    if (kit) {
      order = kit.entrants.map((e) => ({
        e, isPlayer: !!e.isPlayer, dnf: !!(opts.dnf && e.isPlayer) || !!(e.driver && e.driver.real && (e.driver.real.dnf || (e.driver.real.car && e.driver.real.car.dead))),
        finished: e.finished, ft: e.finishT + (e.isPlayer && NIGHT.jumped ? ECON.JUMP_PENALTY : 0), total: e.total,
        name: e.name, number: e.number, color: e.color,
      }));
      order.sort((a, b) => {
        if (a.dnf !== b.dnf) return a.dnf ? 1 : -1;
        if (a.finished && b.finished) return a.ft - b.ft;
        if (a.finished !== b.finished) return a.finished ? -1 : 1;
        return b.total - a.total;
      });
    } else order = [];
    order.forEach((r, i) => { r.pos = i + 1; });
    const pRow = order.find((r) => r.isPlayer) || { pos: order.length || 1, dnf: !!opts.dnf };
    const place = pRow.dnf ? (order.length || 8) : pRow.pos;

    // championship night points to everyone
    order.forEach((r) => {
      if (r.dnf) return;
      if (r.isPlayer) NIGHT.playerPts += pointsFor(r.pos);
      else if (r.number != null && NIGHT.aiPts[r.number] != null) NIGHT.aiPts[r.number] += pointsFor(r.pos);
    });

    // purse + respect + bet settle
    const purse = pRow.dnf ? 0 : purseFor(place);
    if (purse) { C.wallet.give(purse, "APEX purse P" + place); NIGHT.night$ += purse; }
    if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(place <= 1 ? 12 : place <= 3 ? 5 : 1);
    let betPay = 0, betMsg = "";
    if (NIGHT.bet && NIGHT.bet.stake > 0) {
      betPay = settleBet(NIGHT.bet.stake, NIGHT.playerGrid, pRow.dnf ? 99 : place);
      if (betPay > 0) { C.wallet.give(betPay, "Side bet WON @ " + oddsForGrid(NIGHT.playerGrid) + "x"); NIGHT.night$ += betPay; betMsg = "Side bet pays " + fmtCash(betPay) + "!"; }
      else betMsg = "Side bet lost (−" + fmtCash(NIGHT.bet.stake) + ").";
    }
    NIGHT.bet = null;

    const st = bag(); st.races++; if (place === 1 && !pRow.dnf) st.wins++; if (place <= 3 && !pRow.dnf) st.podiums++; st.points = NIGHT.playerPts; save();

    // podium toast + checkered flag wave
    waveFlag(2);
    if (place === 1 && !pRow.dnf) { C.hud.toast("P1 — CHECKERED FLAG!"); if (CBZ.sfx) CBZ.sfx("coin"); }
    else C.hud.toast(pRow.dnf ? "DNF — out of the race" : "Finished P" + place);

    // tear the field down
    if (CBZ.raceDrivers && CBZ.raceDrivers.despawnAll) CBZ.raceDrivers.despawnAll("apex");
    NIGHT.drivers = []; NIGHT.kit = null;
    if (CBZ.raceHud) CBZ.raceHud.hide();

    openResultsPanel(order, place, purse, betMsg, pRow.dnf);
  }
  function cancelNight(msg) {
    if (CBZ.raceDrivers && CBZ.raceDrivers.despawnAll) CBZ.raceDrivers.despawnAll("apex");
    if (CBZ.raceHud) CBZ.raceHud.hide();
    NIGHT.active = false; NIGHT.phase = "idle"; NIGHT.drivers = []; NIGHT.kit = null; NIGHT.bet = null;
    setGantry(0, false); clearLoaner();
    if (msg) note(msg, 2.6);
  }
  function endNight(walked) {
    // champion = most points after the night
    let best = NIGHT.playerPts, champ = "YOU", isPlayer = true;
    for (const r of rosterField()) { const p = NIGHT.aiPts[r.number] || 0; if (p > best) { best = p; champ = r.name; isPlayer = false; } }
    let bonus = 0;
    if (isPlayer && !walked) { bonus = ECON.championBonus; C.wallet.give(bonus, "APEX NIGHT champion bonus"); NIGHT.night$ += bonus; bag().titles++; }
    const st = bag(); if (NIGHT.night$ > st.bestNet) st.bestNet = NIGHT.night$; save();
    NIGHT.active = false; NIGHT.phase = "idle"; clearLoaner();
    openEndingPanel(walked, isPlayer, champ, bonus);
  }

  /* ============================================================
     UPDATE — the per-frame event tick (GAMEPLAY band, via packages.js).
  ============================================================ */
  function update(ctx, dt) {
    if (!NIGHT.active) return;
    if (CBZ.game && CBZ.game.mode !== "city") return;
    if (dt > 0.12) dt = 0.12;

    if (NIGHT.phase === "qualify") {
      const car = playerCar();
      if (!car || car.dead) { cancelNight("Qualifying scratched — you left the car."); return; }
      const pt = paramAt(car.pos.x, car.pos.z);
      if (NIGHT.qualArmed) NIGHT.qualT += dt;
      const crossed = NIGHT.qualLast > 0.85 && pt < 0.15;
      if (crossed) {
        if (!NIGHT.qualArmed) { NIGHT.qualArmed = true; NIGHT.qualT = 0; note("Flying lap — GO!", 1.4); }
        else { NIGHT.qualTime = NIGHT.qualT; NIGHT.qualLast = pt; finishQualify(car); return; }
      }
      NIGHT.qualLast = pt;
      if (NIGHT.qualArmed && NIGHT.qualT > 120) { NIGHT.qualTime = 999; finishQualify(car); return; }
      towerDraw(["QUALIFY", NIGHT.qualArmed ? fmtT(NIGHT.qualT) : "P" + NIGHT.playerGrid + " to beat"], "RACE " + (NIGHT.raceIx + 1) + "/" + ECON.RACES);
      return;
    }

    if (NIGHT.phase === "gridcount") {
      const car = playerCar();
      if (!car || car.dead) { cancelNight("You left the grid — race scratched."); return; }
      NIGHT.countT -= dt; NIGHT.settleT -= dt;
      const c = NIGHT.countT;
      // 5-stage red-light build then lights-out (raceHud shows 3 lamps, the
      // gantry shows 5) — the real F1 sequence the .html modelled.
      const lit = c > 3.2 ? 1 : c > 2.4 ? 2 : c > 1.6 ? 3 : c > 0.8 ? 4 : 5;
      setGantry(lit, false);
      if (CBZ.raceHud) CBZ.raceHud.lights(c > 2.4 ? 1 : c > 1.4 ? 2 : 3);
      // JUMP START: throttle before lights-out (past the settle window)
      if (!NIGHT.jumped && NIGHT.settleT <= 0 && Math.abs(car.v) > 0.6) {
        NIGHT.jumped = true; note("JUMP START! +" + ECON.JUMP_PENALTY + "s penalty.", 2.6);
      }
      if (c <= 0) {
        NIGHT.phase = "race"; NIGHT.greenT = 1.4;
        setGantry(5, true); waveFlag(1);
        if (CBZ.raceHud) CBZ.raceHud.lights("go");
        if (NIGHT.useRD && CBZ.raceDrivers) CBZ.raceDrivers.setState("race", "apex");
        note(NIGHT.jumped ? "GREEN — but you jumped it." : "GREEN GREEN GREEN!", 1.8);
        if (CBZ.sfx) CBZ.sfx("coin");
      }
      return;
    }

    if (NIGHT.phase === "race") {
      const car = playerCar();
      if (!car || car.dead) { finishRace({ dnf: true }); return; }
      if (NIGHT.greenT > 0) { NIGHT.greenT -= dt; if (NIGHT.greenT <= 0) { setGantry(0, false); if (CBZ.raceHud) CBZ.raceHud.lights(-1); } }
      // pace ghosts (headless): rubber-banded skill advance along the spline
      if (!NIGHT.useRD) advanceGhosts(dt);
      // player lap counting (S/F crossing — same as island_speedway)
      const pt = paramAt(car.pos.x, car.pos.z);
      if (NIGHT.playerLastT > 0.85 && pt < 0.15) NIGHT.playerLaps++;
      else if (NIGHT.playerLastT < 0.15 && pt > 0.85) NIGHT.playerLaps--;
      NIGHT.playerLastT = pt; NIGHT.playerTotal = NIGHT.playerLaps + pt;
      if (NIGHT.kit) {
        NIGHT.kit.update(dt);
        const cx = NIGHT.kit.playerContext();
        if (cx && CBZ.raceHud) CBZ.raceHud.update({
          pos: cx.row.pos, count: NIGHT.kit.entrants.length,
          lap: Math.max(1, Math.min(ECON.LAPS, NIGHT.playerLaps + 1)), laps: ECON.LAPS,
          lapT: NIGHT.kit.time - cx.row.lapStart, best: cx.row.best,
          gapA: cx.ahead ? { name: cx.ahead.name, s: cx.gapA } : null,
          gapB: cx.behind ? { name: cx.behind.name, s: cx.gapB } : null,
        });
        towerRace();
      }
      if (NIGHT.playerLaps >= ECON.LAPS) { finishRace({}); return; }
    }
  }
  // headless ghost pacing — mirrors island_speedway's legacy spline puppets:
  // skill bias + a bounded rubber band to the player, no teleporting.
  function advanceGhosts(dt) {
    const circ = lineLen();
    for (const d of NIGHT.drivers) {
      const gh = d.ghost; if (!gh) continue;
      const gap = (gh.laps + gh.t) - NIGHT.playerTotal;
      const gapMod = 1.01 - clamp(gap * 0.55, -0.11, 0.10);
      const skillBias = 0.92 + (d.racer.skill || 0.8) * 0.16;
      let target = 42 * skillBias * gapMod; target = clamp(target, 22, 56);
      gh.speed += (target - gh.speed) * Math.min(1, dt * 1.5);
      const prev = gh.t;
      gh.t = (gh.t + (gh.speed * dt) / circ) % 1;
      if (prev > 0.85 && gh.t < 0.15) gh.laps++;
      const f = frame(gh.t);
      // keep them ON the visible spline even without a car body (so the tower
      // ordering matches something real if a body was ever attached later)
      d._x = f.x + f.nx * gh.lane; d._z = f.z + f.nz * gh.lane;
    }
  }

  /* ============================================================
     PADDOCK DRESSING (build) — only load-bearing props (WHY rule):
       start gantry  → runs the light sequence (the jump-start mechanic)
       timing tower  → the live-canvas positions board (required)
       bookmaker stand → the side-bet venue
       marshal flag  → green / checkered signal
     All local coords relative to venue.origin (= the S/F line). Chunky
     (≥0.3u) and support-connected to the ground.
  ============================================================ */
  // local point: b metres along track (+forward), s metres along the normal
  // (+ = inboard / infield, since the frame normal points to oval centre).
  function localPt(b, s) { const f = frame(SF_T); return { x: f.tx * b + f.nx * s, z: f.tz * b + f.nz * s }; }
  const HEAD = frame(SF_T).heading;

  function build(ctx, venue) {
    C = ctx; VENUE = venue;
    const g = venue.group;

    // ---- START GANTRY over the S/F line: posts → beam → 5 hanging light pods.
    //      (support chain: posts on the ground, beam on posts, pods on beam.)
    const postO = localPt(0, TRACK_W / 2 + 1.7), postI = localPt(0, -(TRACK_W / 2 + 1.7));
    const steel = ctx.mat(0x3a4048);
    ctx.box(g, postO.x, 3.8, postO.z, 0.55, 7.6, 0.55, steel, HEAD);
    ctx.box(g, postI.x, 3.8, postI.z, 0.55, 7.6, 0.55, steel, HEAD);
    ctx.box(g, 0, 7.2, 0, TRACK_W + 3.8, 0.85, 0.85, ctx.mat(0x2a2f38), HEAD);
    ctx.solid(postO.x - 0.4, postO.z - 0.4, postO.x + 0.4, postO.z + 0.4, 0, 7.6);
    ctx.solid(postI.x - 0.4, postI.z - 0.4, postI.x + 0.4, postI.z + 0.4, 0, 7.6);
    const pods = [];
    for (let i = 0; i < 5; i++) {
      const p = localPt(0, (i - 2) * 2.2);
      ctx.box(g, p.x, 6.55, p.z, 0.72, 1.5, 0.72, ctx.mat(0x14161a), HEAD);
      const m = new THREE.MeshLambertMaterial({ color: 0x330b0b, emissive: 0xff2d2d, emissiveIntensity: 0.05 });
      const bm = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.52, 1.0), m);
      bm.position.set(p.x, 6.3, p.z); bm.rotation.y = HEAD; g.add(bm); pods.push(m);
    }
    NIGHT.gantry = pods;
    ctx.light(0, 8.5, 0, 0xff6a5a, 0.5, 22);

    // ---- LIVE TIMING TOWER (infield paddock): column + a canvas screen that
    //      redraws every frame during qualifying/racing.
    const tw = localPt(-20, 24);
    ctx.box(g, tw.x, 6.6, tw.z, 1.5, 13.2, 1.5, ctx.mat(0x23262b));
    ctx.box(g, tw.x, 13.4, tw.z, 2.1, 0.7, 2.1, ctx.emat(0xc23a36, 0.7));
    ctx.solid(tw.x - 0.9, tw.z - 0.9, tw.x + 0.9, tw.z + 0.9, 0, 13.2);
    const cv = document.createElement("canvas"); cv.width = 256; cv.height = 384;
    const tex = new THREE.CanvasTexture(cv);
    const screen = new THREE.Mesh(new THREE.BoxGeometry(4.4, 6.6, 0.3), new THREE.MeshLambertMaterial({ color: 0xffffff, map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.75 }));
    const scP = localPt(-20, 22.6);
    screen.position.set(scP.x, 7.4, scP.z); screen.rotation.y = HEAD + Math.PI; g.add(screen);
    NIGHT.tower = { cv: cv, c2d: cv.getContext("2d"), tex: tex };
    towerDraw(["APEX NIGHT", "paddock open"], "");
    ctx.light(tw.x, 9, tw.z, 0x5ad1ff, 0.5, 16);

    // ---- BOOKMAKER STAND: booth + counter + odds sign (the side-bet venue).
    const bk = localPt(-26, 22);
    ctx.box(g, bk.x, 1.45, bk.z, 4.2, 2.9, 3.2, ctx.mat(0x1c2634), HEAD);
    const roofP = localPt(-26, 22); ctx.box(g, roofP.x, 3.05, roofP.z, 4.8, 0.42, 3.8, ctx.mat(0x2a3546), HEAD);
    const ctP = localPt(-26, 20.1); ctx.box(g, ctP.x, 0.6, ctP.z, 4.2, 1.15, 0.55, ctx.mat(0x8a6a3a), HEAD);
    const sgP = localPt(-26, 20.3); ctx.box(g, sgP.x, 3.35, sgP.z, 3.8, 0.95, 0.16, ctx.emat(0xff4fa3, 0.9), HEAD);
    ctx.solid(bk.x - 2.1, bk.z - 1.6, bk.x + 2.1, bk.z + 1.6, 0, 2.9);
    ctx.light(bk.x, 3.4, bk.z, 0xff8ac6, 0.5, 12);

    // ---- MARSHAL FLAG at the line (waved via ctx.anim on the start/finish).
    const fl = localPt(2, -(TRACK_W / 2 + 2.4));
    ctx.box(g, fl.x, 1.6, fl.z, 0.18, 3.2, 0.18, ctx.mat(0x6a6d72), HEAD);
    const flagMat = new THREE.MeshLambertMaterial({ color: 0x2dff6a, emissive: 0x2dff6a, emissiveIntensity: 0.4 });
    const flag = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.06), flagMat);
    flag.position.set(fl.x, 2.9, fl.z + 0.4); flag.rotation.y = HEAD; g.add(flag);
    NIGHT.flag = { mesh: flag, mat: flagMat, base: fl };
    // one persistent, cheap animator: only moves while a flag phase is armed.
    ctx.anim(function (dtA, t) {
      if (!NIGHT.flag) return true;
      if (NIGHT.flagMode === 0) { NIGHT.flag.mesh.rotation.z = 0; return true; }
      NIGHT.flagT += dtA;
      NIGHT.flag.mesh.rotation.z = Math.sin(NIGHT.flagT * 9) * 0.5;
      if (NIGHT.flagT > 3.2) NIGHT.flagMode = 0;
      return true;
    });

    // ---- CAST (real city peds via ctx.npc) — queued at build (arena root may
    //      not be published yet for a site venue) and drained on the first tick.
    venue._cast = [];
    const marshalAt = localPt(0, -(TRACK_W / 2 + 3.0));
    venue._cast.push({ role: "marshal", outfit: 0xe8b64c, name: "Race Marshal", at: [marshalAt.x, marshalAt.z], face: HEAD + Math.PI, post: "pinned", pose: "stand",
      dialogue: ["Green means go — jump it and the stewards add five.", "Checkered's mine to wave. Earn it.", "Grid up on my mark."] });
    const bmAt = localPt(-26, 20.9);
    venue._cast.push({ role: "bookmaker", outfit: "banker", name: "The Bookmaker", at: [bmAt.x, bmAt.z], face: HEAD, post: "pinned", pose: "stand",
      dialogue: ["Back yourself — the worse your grid, the fatter the odds.", "Only a win pays here. Second's a coaster.", "Stake's down the moment the lights go."] });
    [localPt(-20, 27), localPt(-30, 18.5)].forEach((p, i) => venue._cast.push({ role: "patron", at: [p.x, p.z], face: HEAD + (i ? 1 : -1), post: "ambient" }));
    venue._pendingCast = true;
    tryDrainCast(ctx, venue);

    // ---- PADDOCK ENTRY zone. registerZone directly (contract #14) so it
    //      offers BOTH the on-foot [E] and a driving [I] at the same spot —
    //      ctx.zone gives only slot "e", and a racer drives in.
    if (CBZ.interactions && CBZ.interactions.registerZone) {
      const o = venue.origin, ent = localPt(-22, 22), r = 5.5;
      const wx = o.x + ent.x, wz = o.z + ent.z;
      CBZ.interactions.registerZone({
        id: "racing:paddock", kind: "apexpaddock", prio: 8,
        find: function (px, pz) { return (Math.hypot(px - wx, pz - wz) <= r) ? { x: wx, z: wz } : null; },
        options: [
          { id: "apex-foot", slot: "e", label: paddockLabel, canShow: function () { return true; }, onSelect: openHub },
          { id: "apex-drive", slot: "i", label: paddockLabel, canShow: function () { return true; }, onSelect: openHub },
        ],
      });
      if (CBZ.interactions.describe) CBZ.interactions.describe("apexpaddock", function () {
        return { label: "APEX NIGHT", note: NIGHT.active ? "Race " + (NIGHT.raceIx + 1) + "/" + ECON.RACES : ECON.RACES + " races · entry " + fmtCash(ECON.entry) };
      });
    }
    // ---- BOOKMAKER zone (ctx service): the stand's [E] opens the book.
    ctx.zone({ id: "book", label: "APEX bookmaker — side bets", pos: [bmAt.x, bmAt.z + 1.0], r: 2.6, onUse: function () { openBetPanel(true); } });
  }
  function paddockLabel() { return NIGHT.active ? "APEX NIGHT — continue" : "APEX NIGHT — enter the paddock"; }

  // NPC cast draining (mirrors casino.js: real peds need the live arena; a
  // site venue usually mounts after the world is up, so this drains at once).
  function arenaLive() { return !!(CBZ.city && CBZ.city.arena && CBZ.city.arena.root); }
  function tryDrainCast(ctx, venue) {
    if (!venue._pendingCast) return;
    if (ctx.npc && !arenaLive() && !(venue.group && venue.group.parent)) return;
    venue._pendingCast = false;
    venue._npcs = [];
    for (const spec of (venue._cast || [])) { const h = ctx.npc(spec); if (h) venue._npcs.push(h); }
  }

  /* ============================================================
     START GANTRY LIGHTS + FLAG + TIMING TOWER canvas
  ============================================================ */
  function setGantry(n, green) {
    const pods = NIGHT.gantry; if (!pods) return;
    for (let i = 0; i < pods.length; i++) {
      const m = pods[i];
      if (green) { m.emissive.setHex(0x2dff6a); m.emissiveIntensity = 1.8; m.color.setHex(0x0b3318); }
      else { m.emissive.setHex(0xff2d2d); m.color.setHex(0x330b0b); m.emissiveIntensity = i < n ? 1.7 : 0.05; }
    }
  }
  function waveFlag(mode) {
    if (!NIGHT.flag) return;
    NIGHT.flagMode = mode; NIGHT.flagT = 0;
    NIGHT.flag.mat.color.setHex(mode === 2 ? 0xeef2f6 : 0x2dff6a);
    NIGHT.flag.mat.emissive.setHex(mode === 2 ? 0xeef2f6 : 0x2dff6a);
  }
  function towerDraw(rows, sub) {
    const T = NIGHT.tower; if (!T) return;
    const x = T.c2d; x.fillStyle = "#0a0f1a"; x.fillRect(0, 0, 256, 384);
    x.textAlign = "center"; x.fillStyle = "#ffb45e"; x.font = "900 30px Verdana"; x.fillText(String(rows[0] || ""), 128, 44);
    x.fillStyle = "#5ad1ff"; x.font = "700 22px Verdana"; x.fillText(String(rows[1] || ""), 128, 78);
    if (sub) { x.fillStyle = "#9fb4dd"; x.font = "700 18px Verdana"; x.fillText(sub, 128, 110); }
    T.tex.needsUpdate = true;
  }
  function towerRace() {
    const T = NIGHT.tower, kit = NIGHT.kit; if (!T || !kit) return;
    const x = T.c2d; x.fillStyle = "#0a0f1a"; x.fillRect(0, 0, 256, 384);
    x.textAlign = "center"; x.fillStyle = "#ffb45e"; x.font = "900 26px Verdana"; x.fillText("APEX", 128, 34);
    x.fillStyle = "#5ad1ff"; x.font = "700 20px Verdana"; x.fillText("LAP " + Math.max(1, Math.min(ECON.LAPS, NIGHT.playerLaps + 1)) + "/" + ECON.LAPS, 128, 62);
    x.textAlign = "left"; x.font = "700 22px Consolas,monospace";
    const ord = kit.order || [];
    for (let i = 0; i < ord.length && i < 8; i++) {
      const e = ord[i];
      x.fillStyle = e.isPlayer ? "#5ad1ff" : "#e8eefc";
      x.fillText((i + 1) + " " + (e.number != null ? "#" + e.number : "YOU"), 16, 100 + i * 34);
    }
    T.tex.needsUpdate = true;
  }

  /* ============================================================
     PANELS (engine panel, data-act delegation — casino.js pattern)
  ============================================================ */
  const BTN = "display:inline-block;margin:4px 6px 2px 0;padding:9px 16px;border-radius:11px;cursor:pointer;font-weight:800;font-size:14px;user-select:none;box-shadow:0 3px 0 rgba(0,0,0,.4);";
  function btn(act, label, bg, dis, data) {
    let d = ""; if (data) for (const k in data) d += " data-" + k + "='" + esc(data[k]) + "'";
    return "<span data-act='" + act + "'" + d + " style='" + BTN + "background:" + (bg || "#1c6b40") + ";" + (dis ? "opacity:.4;pointer-events:none;" : "") + "'>" + label + "</span>";
  }
  function head(title, sub) {
    return "<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:8px'>" +
      "<b style='letter-spacing:2px;color:#e8b64c'>" + title + "</b><span style='opacity:.7;font-size:12px'>" + sub + " · Esc closes</span></div>";
  }
  function standTable() {
    const field = rosterField();
    const rows = field.map((r) => ({ name: r.name, number: r.number, color: r.teamColor, pts: NIGHT.aiPts[r.number] || 0, you: false }));
    rows.push({ name: "YOU", number: null, color: 0x5ad1ff, pts: NIGHT.playerPts, you: true });
    rows.sort((a, b) => b.pts - a.pts);
    let h = "<div style='display:grid;grid-template-columns:24px 30px 1fr 46px;gap:4px;font-size:11px'>";
    rows.forEach((r, i) => {
      h += "<span style='color:" + (i === 0 ? "#ffd166" : "#8a93a3") + ";font-weight:700'>" + (i + 1) + "</span>" +
        "<span style='font-weight:700;color:" + hex6(r.color) + "'>" + (r.number != null ? r.number : "—") + "</span>" +
        "<span style='" + (r.you ? "color:#5ad1ff;font-weight:800" : "") + ";white-space:nowrap;overflow:hidden;text-overflow:ellipsis'>" + esc(r.name) + (r.you ? " (YOU)" : "") + "</span>" +
        "<span style='text-align:right;color:#7ed957;font-weight:700'>" + r.pts + "</span>";
    });
    return h + "</div>";
  }

  function openHub() {
    if (!C) return;
    if (NIGHT.active && NIGHT.phase !== "idle") { note("You're on track — finish the session.", 1.8); return; }
    let body;
    if (!NIGHT.active) {
      body = "<div style='margin:2px 0 8px;font-size:13px'>Cash <b style='color:#e8b64c'>" + fmtCash(C.wallet.cash()) + "</b> · " +
        ECON.RACES + " races · " + ECON.LAPS + " laps · field of " + ECON.FIELD +
        "<br><span style='opacity:.7;font-size:12px'>Best night net " + fmtCash(bag().bestNet) + " · titles " + bag().titles + "</span></div>" +
        btn("start", "PAY ENTRY " + fmtCash(ECON.entry) + " & QUALIFY", "#c98f22", !C.wallet.canAfford(ECON.entry)) +
        btn("close", "Leave", "#26343c");
    } else {
      body = "<div style='margin:2px 0 8px;font-size:13px'>Race <b>" + (NIGHT.raceIx + 1) + "/" + ECON.RACES + "</b> up next · night net " +
        "<b style='color:" + (NIGHT.night$ >= 0 ? "#7ed957" : "#ff9aa2") + "'>" + (NIGHT.night$ >= 0 ? "+" : "−") + fmtCash(Math.abs(NIGHT.night$)).slice(1) + "</b></div>" +
        standTable() +
        "<div style='margin-top:8px'>" + btn("qual", "GO TO QUALIFYING", "#1c6b40") + btn("cashout", "CASH OUT & LEAVE", "#7c1626") + "</div>";
    }
    C.hud.panel(head("APEX NIGHT", "Diamond Speedway"), body, {
      start: startNight, qual: beginQualify, cashout: function () { endNight(true); }, close: function () { C.hud.closePanel(); },
    });
  }

  function openBetPanel(standalone) {
    if (!C) return;
    // standalone = opened from the bookmaker stand outside qualifying flow
    if (standalone && (!NIGHT.active || NIGHT.phase !== "bet" && NIGHT.grid == null)) {
      C.hud.panel(head("THE BOOKMAKER", "side bets"),
        "<div style='margin:6px 0;font-size:13px'>Qualify first — your grid slot sets the odds. Back yourself to WIN; only P1 pays.</div>" + btn("close", "Close", "#26343c"),
        { close: function () { C.hud.closePanel(); } });
      return;
    }
    NIGHT.phase = "bet";
    const odds = oddsForGrid(NIGHT.playerGrid);
    let body = "<div style='margin:2px 0 8px;font-size:13px'>Qualified <b style='color:#5ad1ff'>P" + NIGHT.playerGrid + "</b> · lap " + fmtT(NIGHT.qualTime) +
      "<br>Back yourself to WIN at <b style='color:#e8b64c'>" + odds + "x</b> — only a win pays.</div>";
    body += ECON.stakes.map((s) => s === 0 ? btn("stake", "NO BET", "#26343c") : btn("stake", "$" + s + " → " + fmtCash(s * odds), "#16301f", C.wallet.cash() < s, { s: s })).join("");
    body += "<div style='margin-top:8px'>" + btn("grid", "GO TO THE GRID →", "#c98f22") + "</div>";
    C.hud.panel(head("THE BOOKMAKER", "grid P" + NIGHT.playerGrid + " · " + odds + "x"), body, {
      stake: function (el) {
        const s = el && el.getAttribute ? (el.getAttribute("data-s") | 0) : 0;
        if (s > 0) { if (!C.wallet.spend(s, "Side bet on yourself")) return; NIGHT.bet = { stake: s }; NIGHT.night$ -= s; note("" + fmtCash(s) + " on YOU @ " + odds + "x.", 2.2); }
        else NIGHT.bet = null;
        beginGrid();
      },
      grid: beginGrid,
    });
  }

  function openResultsPanel(order, place, purse, betMsg, dnf) {
    if (!C) return;
    let tbl = "<div style='display:grid;grid-template-columns:24px 30px 1fr 60px 40px;gap:4px;font-size:11px;margin:6px 0'>" +
      "<span style='color:#8a93a3'>#</span><span style='color:#8a93a3'>Car</span><span style='color:#8a93a3'>Driver</span><span style='color:#8a93a3;text-align:right'>Gap</span><span style='color:#8a93a3;text-align:right'>Pts</span>";
    order.forEach((r) => {
      let gap = "";
      if (r.dnf) gap = "DNF";
      else if (r.isPlayer && NIGHT.jumped) gap = "+" + ECON.JUMP_PENALTY + "s*";
      else gap = r.pos === 1 ? "leader" : "";
      tbl += "<span style='color:" + (r.pos === 1 ? "#ffd166" : "#cfd6dd") + "'>" + r.pos + "</span>" +
        "<span style='font-weight:700;color:" + hex6(r.color != null ? r.color : 0x5ad1ff) + "'>" + (r.number != null ? r.number : "—") + "</span>" +
        "<span style='" + (r.isPlayer ? "color:#5ad1ff;font-weight:800" : "") + ";white-space:nowrap;overflow:hidden;text-overflow:ellipsis'>" + esc(r.name) + "</span>" +
        "<span style='text-align:right;color:#9fb4dd'>" + gap + "</span>" +
        "<span style='text-align:right;color:#7ed957'>" + (r.dnf ? 0 : "+" + pointsFor(r.pos)) + "</span>";
    });
    tbl += "</div>";
    let msg = dnf ? "DNF — no purse." : "Finished P" + place + " · purse " + fmtCash(purse);
    if (betMsg) msg += " · " + betMsg;
    if (NIGHT.jumped) msg += " (jump-start +" + ECON.JUMP_PENALTY + "s applied)";
    const last = NIGHT.raceIx >= ECON.RACES - 1;
    const body = "<div style='margin:2px 0 6px;font-size:13px'>" + msg + "</div>" + tbl +
      "<div style='font-size:12px;color:#9fb4dd;margin:4px 0'>Championship</div>" + standTable() +
      "<div style='margin-top:8px'>" + (last ? btn("finale", "FINAL RESULT →", "#c98f22") : btn("next", "NEXT RACE →", "#c98f22") + btn("cashout", "CASH OUT & LEAVE", "#7c1626")) + "</div>";
    C.hud.panel(head("RACE " + (NIGHT.raceIx + 1) + " RESULT", "Diamond Speedway"), body, {
      next: function () { NIGHT.raceIx++; beginQualify(); },
      finale: function () { endNight(false); },
      cashout: function () { endNight(true); },
    });
  }

  function openEndingPanel(walked, isPlayer, champ, bonus) {
    if (!C) return;
    const verdict = walked ? "CASHED OUT" : (isPlayer ? "CHAMPION" : "NIGHT OVER");
    const vc = walked ? "#5ad1ff" : (isPlayer ? "#e8b64c" : "#ff9aa2");
    const st = bag();
    const body = "<div style='font-size:30px;font-weight:900;letter-spacing:3px;color:" + vc + ";margin:4px 0'>" + verdict + "</div>" +
      "<div style='font-size:13px;margin:4px 0'>" + (isPlayer && !walked ? "You take APEX NIGHT — champion bonus " + fmtCash(bonus) + "." : "Champion: <b>" + esc(champ) + "</b>.") +
      "<br>Night net <b style='color:" + (NIGHT.night$ >= 0 ? "#7ed957" : "#ff9aa2") + "'>" + (NIGHT.night$ >= 0 ? "+" : "−") + fmtCash(Math.abs(NIGHT.night$)).slice(1) + "</b> · " +
      "career: " + st.wins + " wins · " + st.titles + " titles</div>" +
      btn("close", "DONE", "#1c6b40");
    C.hud.panel(head("APEX NIGHT", "the night is over"), body, { close: function () { C.hud.closePanel(); } });
  }

  /* ============================================================
     REGISTER
  ============================================================ */
  CBZ.games.register({
    id: "racing", title: "APEX NIGHT",
    // the speedway is a LANDMASS, not a lot — anchor at the S/F line, confirmed
    // via city.regions (contract #8). Retried lazily until the island exists.
    venue: {
      site: "raceway",
      resolve: function (CBZ) {
        const A = CBZ.city && CBZ.city.arena; if (!A) return null;
        // prefer the island's own exposed S/F frame (island_speedway sets it)
        if (A._sfLine && isFinite(A._sfLine.x)) return { x: A._sfLine.x, z: A._sfLine.z };
        const regs = A.regions || (CBZ.city && CBZ.city.regions) || [];
        const has = regs.some((r) => r && (r.biome === "speedway" || /speedway/i.test(r.name || "")));
        if (!has) return null;                 // no speedway in this world → never mount
        const f = frame(SF_T); return { x: f.x, z: f.z };
      },
    },
    build: build,
    update: function (ctx, dt) { if (ctx.venue && ctx.venue._pendingCast) tryDrainCast(ctx, ctx.venue); update(ctx, dt); },
    api: {
      rules: { ECON: ECON, purseFor, pointsFor, oddsForGrid, settleBet, raceSim, nightSim, frame, lineLen, gridSlot, paramAt },
      // probe surface — a gate asserts THROUGH these (no live driving needed)
      open: function () { openHub(); },
      simRace: function (n, opts) { const out = []; for (let i = 0; i < (n || 1); i++) out.push(raceSim(Object.assign({ seed: opts && opts.seed != null ? opts.seed + i : null }, opts))); return out; },
      simNight: function (opts) { return nightSim(opts || {}); },
      night: function () { return { active: NIGHT.active, phase: NIGHT.phase, raceIx: NIGHT.raceIx, playerGrid: NIGHT.playerGrid, playerPts: NIGHT.playerPts, jumped: NIGHT.jumped, net: NIGHT.night$, field: NIGHT.drivers.length, useRD: NIGHT.useRD }; },
      state: function () { return S ? JSON.parse(JSON.stringify(S)) : null; },
      // rig a jump start on the LIVE race (for a gate that drives the state machine)
      rig: function (o) { o = o || {}; if (o.jump != null) NIGHT.jumped = !!o.jump; if (o.playerGrid != null) NIGHT.playerGrid = o.playerGrid | 0; if (o.bet != null) NIGHT.bet = o.bet ? { stake: o.bet | 0 } : null; return NIGHT; },
      cast: function () { return VENUE && VENUE._npcs ? VENUE._npcs.length : 0; },
    },
  });
})();
