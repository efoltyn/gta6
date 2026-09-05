/* ============================================================
   city/motorcade.js — THE PRESIDENT DOES NOT WALK.

   PRESIDENT-PLAN.md §1b, measured: the Executive Mansion (seed 260811) sits at
   (2040, −4454). The Saltlands / Dry Gulch — where the cell, the safehouses and
   the wall live — is at ≈ (1120, 150). That is 4.7 km. The Capitol and the
   Bureau are their own long walks. So the whole terror plot was TEXT: you read
   about it on a board in a locked room and never went anywhere, because going
   anywhere was ten minutes of holding W across farmland.

   govcomplex.js §5b already posts a CHAUFFEUR in the Mansion's motor court
   (`{ job: "chauffeur", at: "court" }`). He had nothing to drive and nothing to
   do. This file gives him the car and the job:

     • a real black state car (CBZ.cityAddParkedCar — vehicles.js's own world
       fixture, which is cityMakeCar plus `_persist`; no prop, no second
       vehicle system) parked on the motor-court ring, one per world, rebuilt
       when the arena is
     • E on the chauffeur → a DESTINATION CARD. Four rows through the one
       interaction registry: interactions.js's registerZone for the options and
       registerVerbCard for the multi-row card (dialogue.js's two-answer card is
       the same seam). Not a modal, not a new UI.
     • the ride: a 700 ms fade, the state car placed on the road outside the
       destination's gate facing out, and you standing at its rear door.
       activities.js rideTransit()'s placement idiom, plus the car and the fade
       it never had.
     • the helipad at (site.cx+74, site.cz+62) gets a REAL boardable helicopter,
       registered through CBZ.cityRegisterMilitaryVehicle — the seam yachts.js's
       helideck and island_airport.js's fleet already use. No new aircraft code.

   EVERY DESTINATION IS RESOLVED LIVE, per ride, out of CBZ.govComplexes and
   CBZ.city.regions. Nothing here caches a coordinate across a world rebuild,
   because the seed decides where the Capitol is.

   COSTS NOTHING. A head of state's car is state-funded; charging the player
   for it would be a toll booth on the only thing that makes the mode playable.

   FLAG: CBZ.CONFIG.MOTORCADE_V1 (default true) — off and this file is inert.
   GATE: only while you hold the country. presidency.js's status() contract is
   feature-detected (it may not exist yet in a given build); seat() is the
   fallback, and with neither, nothing here ever arms.

   LOAD: index.html, after presidency.js. Every CBZ.* read is guarded.
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.MOTORCADE_V1 == null) CFG.MOTORCADE_V1 = true;

  // ---- tuning -------------------------------------------------------------
  const CAR_MODEL = "Adler Kanzler";   // economy.js's big black state sedan
  const CAR_PAINT = 0x0b0d12;          // state black, darker than the catalog coat
  const PARK_DX = 14, PARK_DZ = 26;    // on the court ring, clear of the fountain
  const MENU_R = 5.6;                  // how close you stand to get the card
  const CARD_PRIO = 16;                // beats the ped card on the same body
  const GATE_OUT = 11;                 // how far up the road outside a gate we stop
  const HOME_HIDE = 220;               // "Home" is not offered while you are home
  const FADE_MS = 700;
  const HELI_BOARD_R = 11;             // reach for the president's own boarding path

  const AUDIT = { rides: 0, heliBoards: 0, lastDest: null };

  // ---- small helpers ------------------------------------------------------
  function on() { return CFG.MOTORCADE_V1 !== false; }
  function feed(t, c) { if (CBZ.cityFeed) { try { CBZ.cityFeed(t, c || "#8fc1ff"); } catch (e) {} } }
  function note(t) {
    if (CBZ.city && CBZ.city.note) { try { CBZ.city.note(t, 2.4); return; } catch (e) {} }
    feed(t);
  }
  function arena() { return (CBZ.city && CBZ.city.arena) || null; }
  function arenaRoot() { const A = arena(); return (A && A.root) || null; }
  function groundY(x, z) {
    if (CBZ.groundAt) { try { const y = +CBZ.groundAt(x, z, 400); if (isFinite(y)) return y; } catch (e) {} }
    if (CBZ.cityGroundHeightAt) { try { const y = +CBZ.cityGroundHeightAt(x, z); if (isFinite(y)) return y; } catch (e) {} }
    return 0;
  }

  /* THE SEAT. presidency.js's status() is being written alongside this file, so
     it is feature-detected rather than depended on: status().seat first, the
     shipped seat() second, and if neither exists the motorcade never arms. This
     is the ONLY gate — no second notion of "am I the president" is invented
     here, because two answers to that question is how they start disagreeing. */
  function seated() {
    const P = CBZ.presidency;
    if (!P) return false;
    if (typeof P.status === "function") {
      try { const s = P.status(); if (s && s.seat) return true; if (s) return false; } catch (e) {}
    }
    if (typeof P.seat === "function") { try { return !!P.seat(); } catch (e) {} }
    return false;
  }
  function playing() { return !!(g && g.mode === "city" && g.state === "playing"); }
  function active() { return on() && playing() && seated(); }

  // ---- the world, asked fresh every time ----------------------------------
  function govSite(id) {
    const L = CBZ.govComplexes;
    if (!Array.isArray(L)) return null;
    for (let i = 0; i < L.length; i++) {
      const s = L[i];
      if (s && s.id === id && s.rect && s.gate) return s;
    }
    return null;
  }
  function mansion() { return govSite("execmansion"); }
  function saltlands() {
    const regs = (CBZ.city && CBZ.city.regions) || [];
    for (let i = 0; i < regs.length; i++) {
      const r = regs[i];
      if (r && r.name === "The Saltlands" && r.minX != null) return r;
    }
    return null;
  }

  /* ---- THE DESTINATIONS ---------------------------------------------------
     Four ids, each a LIVE lookup. A destination that cannot be resolved this
     frame simply is not offered — no dead row, no stale coordinate. Every
     entry answers with the same shape: where the car stops, and what you should
     be looking at when the fade lifts. */
  const DESTS = [
    {
      id: "capitol", label: "Ride to the Capitol", name: "the Capitol",
      at: function () { return gatePoint(govSite("capitol")); },
    },
    {
      id: "bureau", label: "Ride to the Bureau", name: "Bureau Headquarters",
      at: function () { return gatePoint(govSite("agency")); },
    },
    {
      id: "saltlands", label: "Ride to the Saltlands", name: "the Dry Gulch wall road",
      at: function () {
        // presidency.js's own attackTarget geometry: the town centre on the
        // published desert highway spine. That is where the plot is, so that is
        // where the car stops.
        const R = saltlands();
        if (!R) return null;
        const cx = (R.minX + R.maxX) / 2, cz = (R.minZ + R.maxZ) / 2;
        const z = (CBZ.DESERT_HWY_Z != null) ? +CBZ.DESERT_HWY_Z : cz - 40;
        const x = cx + 30;
        // parked along the highway, nose east; you look back toward the town.
        return { x: x, z: z, heading: Math.PI / 2, face: { x: x, z: cz } };
      },
    },
    {
      id: "home", label: "Ride home", name: "the Executive Mansion",
      at: function () { return gatePoint(mansion()); },
      // pointless while you are standing on your own lawn
      show: function () {
        const s = mansion(), P = CBZ.player;
        if (!s || !P || !P.pos) return true;
        return Math.hypot(P.pos.x - s.cx, P.pos.z - s.cz) > HOME_HIDE;
      },
    },
  ];
  const ALIAS = {
    agency: "bureau", execmansion: "home", mansion: "home",
    drygulch: "saltlands", "dry-gulch": "saltlands", wall: "saltlands",
  };
  function destById(id) {
    id = String(id || "").toLowerCase();
    if (ALIAS[id]) id = ALIAS[id];
    for (let i = 0; i < DESTS.length; i++) if (DESTS[i].id === id) return DESTS[i];
    return null;
  }

  // A gov complex's gate, plus the direction OUT of it. The gate is on the
  // rect edge the builder pushed its access road to, so "outward" is simply
  // gate-minus-centre — no builder convention to agree with.
  function gatePoint(site) {
    if (!site || !site.gate) return null;
    const gx = +site.gate.x, gz = +site.gate.z;
    let ox = gx - site.cx, oz = gz - site.cz;
    const d = Math.hypot(ox, oz);
    if (!(d > 0.001)) { ox = 0; oz = 1; } else { ox /= d; oz /= d; }
    return {
      x: gx + ox * GATE_OUT, z: gz + oz * GATE_OUT,
      heading: Math.atan2(ox, oz),          // nose pointing away from the gate
      face: { x: gx, z: gz },               // ...and you looking back at it
    };
  }

  // ============================================================
  //  §1  THE STATE CAR — one per world, from the engine's car factory.
  // ============================================================
  const CAR = { rec: null, forArena: null, forSites: null };

  function stateCarModel() {
    const econ = CBZ.cityEcon;
    let m = null;
    if (econ && econ.carByName) { try { m = econ.carByName(CAR_MODEL); } catch (e) { m = null; } }
    // shallow clone so the catalog entry keeps its own paint (gangs.js's rule)
    return m ? Object.assign({}, m, { color: CAR_PAINT }) : null;
  }

  function parkSpot(site) {
    // the motor court is a 34 m disc centred (cx, cz+18) with a fountain (and
    // its collider) at the middle; the ring is where a car actually stands.
    let x = site.cx + PARK_DX, z = site.cz + PARK_DZ;
    // ...but never on top of the chauffeur, because a car within 4.8 m of him
    // is a car the E-router boards instead of showing his card.
    const p = chauffeurPost();
    if (p && Math.hypot(x - p.x, z - p.z) < 9) { x = site.cx + PARK_DX + 6; z = site.cz + PARK_DZ - 6; }
    return { x: x, z: z, heading: Math.atan2(site.gate.x - x, site.gate.z - z) };
  }

  function carAlive() {
    const c = CAR.rec;
    if (!c || c.dead) return false;
    const list = CBZ.cityCars;
    return !!(Array.isArray(list) && list.indexOf(c) >= 0);
  }

  /* WHY cityAddParkedCar AND NOT A BARE cityMakeCar: a raw makeCar record is
     AMBIENT TRAFFIC, and clearCars() — which runs on every spawnCityTraffic —
     deletes and disposes anything without `_persist`. The state car would have
     evaporated the first time traffic respawned. cityAddParkedCar is the
     shipped world-fixture path: same factory, plus `_persist`, plus the
     stale-arena purge, plus syncOccupants so there is no ghost driver sitting
     in a car whose driver is standing outside it. cityMakeCar stays as the
     fallback for a build with CARS_ALL_DRIVABLE off. */
  function buildCar() {
    const A = arena();
    const site = mansion();
    if (!A || !A.root || !site) return false;
    const s = parkSpot(site);
    let c = null;
    if (CBZ.cityAddParkedCar) {
      try { c = CBZ.cityAddParkedCar(s.x, s.z, s.heading, { modelName: CAR_MODEL, color: CAR_PAINT, force: true }); } catch (e) { c = null; }
    }
    if (!c && CBZ.cityMakeCar) {
      try { c = CBZ.cityMakeCar(s.x, s.z, s.heading, false, stateCarModel(), 0); } catch (e) { c = null; }
      if (c) { c._persist = true; c._propParked = true; c._arenaRoot = A.root; }
    }
    if (!c) return false;
    // checkpoints.js's parked-fixture flags, verbatim: no brain, no road, no roll.
    c.ai = false; c.v = 0; c.baseV = 0; c.road = null; c.parked = true;
    c.stolen = false;
    c.name = "State Car";
    c._motorcade = true;
    CAR.rec = c; CAR.forArena = A; CAR.forSites = CBZ.govComplexes;
    return true;
  }

  function moveCar(to) {
    const c = CAR.rec;
    if (!c || !c.group) return;
    // makeCar aliases c.pos to the group's position, so this IS the move; the
    // vehicle loop's own terrain seat writes y and the pitch/roll next frame.
    c.pos.x = to.x; c.pos.z = to.z;
    c.heading = to.heading;
    c.group.rotation.y = to.heading;
    c.v = 0; c.vx = 0; c.vz = 0;
    c.ai = false; c.road = null; c.parked = true;
  }

  function dropCar() {
    const c = CAR.rec;
    CAR.rec = null; CAR.forArena = null; CAR.forSites = null;
    if (!c) return;
    if (c.player || (CBZ.player && CBZ.player._vehicle === c)) return;   // you are IN it
    const list = CBZ.cityCars;
    if (Array.isArray(list)) { const i = list.indexOf(c); if (i >= 0) list.splice(i, 1); }
    if (c.group && c.group.parent) c.group.parent.remove(c.group);
  }

  // ============================================================
  //  §2  THE CHAUFFEUR — citystaff.js's post, found by job, not by guessing.
  //  A post carries { id, job, x, z, ped }: the coordinates are the station,
  //  `ped` is the body, and the body only exists inside 170 m (citystaff's
  //  own arithmetic). Inside the motor court he is therefore always embodied
  //  unless he has been shot — which is the one case the card has to survive,
  //  and does, by moving to the car.
  // ============================================================
  function chauffeurPost() {
    if (!CBZ.cityStaffPosts) return null;
    let list = null;
    try { list = CBZ.cityStaffPosts(); } catch (e) { list = null; }
    if (!Array.isArray(list)) return null;
    let loose = null;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p || p.job !== "chauffeur") continue;
      if (String(p.id || "").indexOf("gov:execmansion:") === 0) return p;
      if (!loose) loose = p;
    }
    // no id match (a renamed row): take the chauffeur nearest the Mansion
    const s = mansion();
    if (loose && s && Math.hypot(loose.x - s.cx, loose.z - s.cz) < 400) return loose;
    return null;
  }

  /* Where the destination card lives right now. The BODY first — a chauffeur is
     a person and you talk to the person. Then the CAR, which is the honest
     answer when he is not embodied or has been shot: an empty patch of gravel
     where a man used to stand is not something to press E on. The station is
     the last resort, for a world with a post and no car yet. */
  function cardAnchor() {
    const p = chauffeurPost();
    if (p && p.ped && !p.ped.dead && p.ped.pos) return { x: p.ped.pos.x, z: p.ped.pos.z, who: "chauffeur" };
    const c = CAR.rec;
    if (c && !c.dead && c.pos) return { x: c.pos.x, z: c.pos.z, who: "car" };
    if (p) return { x: p.x, z: p.z, who: "post" };
    return null;
  }

  /* ============================================================
     §3  THE FADE. Nothing in this repo exposes a plain screen fade —
     cityBustOverlay is an arrest CARD with its own copy and a 2.6 s hold, and
     drinking.js's blackout is a state machine tied to a drunkenness level. So
     this is one div, 700 ms, black, pointer-transparent, and that is all of it.

     IT RUNS ON THE ENGINE CLOCK, NOT setTimeout. That is not a style choice:
     the whole simulation advances through CBZ.stepSim(dt), and a headless
     probe (tools/president-check.mjs) that calls go() and then steps 180 sim
     frames burns ~0 wall-clock seconds — a wall-clock timer would never fire
     and the ride would silently never happen. Driving it off `dt` also means
     the fade honours pause, hitstop and slow-motion for free, and a mode change
     mid-ride cancels the placement instead of teleporting you into a menu.
     ============================================================ */
  const FADE_HALF = Math.max(0.12, FADE_MS / 2000);   // seconds
  const FADE = { phase: null, t: 0, mid: null };
  let fadeEl = null;
  function riding() { return !!FADE.phase; }
  function fadePaint(a) {
    if (!fadeEl) {
      if (typeof document === "undefined" || !document.body || !document.createElement) return;
      fadeEl = document.createElement("div");
      fadeEl.id = "motorcadeFade";
      fadeEl.style.cssText =
        "position:fixed;left:0;top:0;width:100%;height:100%;z-index:70;background:#000;" +
        "opacity:0;pointer-events:none;display:none";
      document.body.appendChild(fadeEl);
    }
    fadeEl.style.opacity = String(a);
    fadeEl.style.display = a > 0.002 ? "block" : "none";
  }
  function fadeThrough(mid) { FADE.phase = "out"; FADE.t = 0; FADE.mid = mid; fadePaint(0); }
  function fadeCancel() { FADE.phase = null; FADE.t = 0; FADE.mid = null; fadePaint(0); }
  function tickFade(dt) {
    if (!FADE.phase) return;
    FADE.t += dt || 0;
    const k = Math.min(1, FADE.t / FADE_HALF);
    if (FADE.phase === "out") {
      fadePaint(k);
      if (k >= 1) {
        const m = FADE.mid;
        FADE.mid = null; FADE.phase = "in"; FADE.t = 0;
        if (m) { try { m(); } catch (e) { if (window.console) console.error("[motorcade] ride", e); } }
      }
      return;
    }
    fadePaint(1 - k);
    if (k >= 1) fadeCancel();
  }

  // ============================================================
  //  §4  THE RIDE — the public verb. `CBZ.motorcade.go(destId)`, which is
  //  also what every card row calls, so the agenda agent's order and the
  //  player's keypress are the same code path.
  // ============================================================
  function go(destId) {
    if (!on()) return { ok: false, why: "The motorcade is not running." };
    if (!playing()) return { ok: false, why: "Not in the world." };
    if (!seated()) return { ok: false, why: "You do not hold the country." };
    if (riding()) return { ok: false, why: "The car is already moving." };
    const P = CBZ.player;
    if (!P || !P.pos || P.dead) return { ok: false, why: "No." };
    if (P._aircraft) return { ok: false, why: "You are flying." };
    if (P.driving || P._vehicle) return { ok: false, why: "Get out of the car you are in." };
    const d = destById(destId);
    if (!d) return { ok: false, why: "No such destination." };
    const at = d.at();
    if (!at) return { ok: false, why: "That place is not on the map yet." };

    fadeThrough(function () { arrive(d, at); });
    return { ok: true, dest: d.id };
  }

  function arrive(d, at) {
    const P = CBZ.player;
    if (!P || !P.pos) return;

    // the car goes first — you are placed relative to where it ended up
    ensureCar();
    if (CAR.rec) moveCar(at);

    // the rear door, on whichever flank faces the thing you came to look at
    const fx = Math.sin(at.heading), fz = Math.cos(at.heading);
    const rx = Math.cos(at.heading), rz = -Math.sin(at.heading);
    const backX = at.x - fx * 1.7, backZ = at.z - fz * 1.7;
    const face = at.face || { x: at.x + fx * 20, z: at.z + fz * 20 };
    const a = { x: backX + rx * 2.3, z: backZ + rz * 2.3 };
    const b = { x: backX - rx * 2.3, z: backZ - rz * 2.3 };
    const da = Math.hypot(a.x - face.x, a.z - face.z), db = Math.hypot(b.x - face.x, b.z - face.z);
    const stand = da <= db ? a : b;

    // activities.js rideTransit()'s placement idiom, with a real ground height
    // (its literal 0 is fine downtown and wrong on a desert mesa).
    P.pos.set(stand.x, groundY(stand.x, stand.z), stand.z);
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
    P.vy = 0; P.speed = 0; P.grounded = true;
    if (CBZ.cam) {
      const lx = face.x - stand.x, lz = face.z - stand.z;
      if (Math.hypot(lx, lz) > 0.5) CBZ.cam.yaw = Math.atan2(-lx, -lz);
    }

    AUDIT.rides++; AUDIT.lastDest = d.id;
    // the same world-event channel every other transport posts on; a president
    // moving is a state fact, not a fare.
    if (CBZ.cityEvent) {
      try { CBZ.cityEvent("transport", { fare: 0, factions: { state: 1, public: 1 }, label: "Presidential motorcade" }); } catch (e) {}
    }
    feed("The motorcade arrives at " + d.name + ".", "#ffd76a");
  }

  // ============================================================
  //  §5  THE CARD — one zone, one option per destination, and the verb-card
  //  provider that renders them as rows. interactions.js resolves a candidate
  //  down to ONE verb by design; registerVerbCard is the sanctioned way to
  //  hand back several (dualRideRows for the airliner, dialogue.js for its two
  //  answers). A choice menu is not a new UI here — it is that seam.
  // ============================================================
  let wired = false;
  function optionFor(d) {
    return {
      id: "motorcade-" + d.id,
      slot: "e",
      campaignSafe: true,
      label: function () { return d.label; },
      canShow: function () { return active() && !riding() && (!d.show || d.show()) && !!d.at(); },
      onSelect: function () {
        const r = go(d.id);
        if (r && !r.ok && r.why) note(r.why);
      },
    };
  }

  function wireCard() {
    const I = CBZ.interactions;
    if (wired || !I || !I.registerZone) return;
    wired = true;

    I.registerZone({
      id: "motorcade-court", kind: "motorcade", prio: CARD_PRIO, radius: MENU_R + 1.5,
      find: function (px, pz) {
        if (!active() || riding()) return null;
        const a = cardAnchor();
        if (!a) return null;
        const dx = a.x - px, dz = a.z - pz;
        if (dx * dx + dz * dz > MENU_R * MENU_R) return null;
        return { x: a.x, z: a.z, kind: "motorcade", who: a.who };
      },
      options: DESTS.map(optionFor),
    });

    if (I.describe) {
      try {
        I.describe("motorcade", function (t) {
          const who = t && t.who;
          return {
            label: who === "chauffeur" ? "Your chauffeur" : who === "car" ? "The state car" : "The motor court",
            note: "the motorcade",
          };
        });
      } catch (e) {}
    }

    /* THE ROWS. `rows._pass` is the already-gated pool interactions.js built
       for this candidate — the same options, canShow'd against live state — so
       this never re-decides what is offerable, it only lays it out. Five key
       slots exist; four destinations fit, and `home` hides itself at home. */
    if (I.registerVerbCard) {
      const KEYS = ["e", "i", "j", "k", "l"];
      I.registerVerbCard(function (pick, rows, ctx) {
        if (!pick || pick.kind !== "motorcade") return null;
        const pass = rows && rows._pass;
        if (!pass || !pass.length) return null;
        const out = [];
        for (let i = 0; i < pass.length && i < KEYS.length; i++) {
          const o = pass[i];
          let lab = o.label;
          if (typeof lab === "function") { try { lab = lab(pick.t, ctx); } catch (e) { lab = null; } }
          lab = String(lab || "Ride");
          out.push({ key: KEYS[i], hold: false, label: lab, bad: false, opt: o, decision: "yes", proposal: lab, standing: null });
        }
        if (!out.length) return null;
        // dualRide does two things we need: it renders as a multi-row VERB card,
        // and it makes the E-router yield — so pressing E beside the state car
        // takes the ride instead of silently getting in and driving.
        out.dualRide = true;
        out.note = (pick.t && pick.t.who === "chauffeur")
          ? "“Where to, sir?”"
          : "The car is yours. Where to?";
        return out;
      });
    }
  }

  // ============================================================
  //  §6  THE HELICOPTER — govcomplex.js draws a 12 m helipad at
  //  (cx+74, cz+62) on the Mansion's lawn and nothing has ever stood on it.
  //
  //  NO NEW AIRCRAFT CODE IS WRITTEN HERE, and none is needed. Two shipped
  //  seams do the whole thing: playeraircraft.js's own heli mesh builder
  //  (CBZ.debugBuildAircraft.heli — the one that TAGS userData.rotor, which is
  //  what makes citySpawnFlyableFromProp fly THIS airframe instead of spawning
  //  a second stand-in beside it), and militaryvehicles.js's boardable registry
  //  (CBZ.cityRegisterMilitaryVehicle) — the same seam yachts.js's helideck and
  //  island_airport.js's fleet register through. E boards it on the existing
  //  router; the flight model, the doors, the audit and the exit are all theirs.
  // ============================================================
  const HELI = { rec: null, forArena: null, forSites: null };

  function heliSpot(site) {
    const x = site.cx + 74, z = site.cz + 62;
    return { x: x, z: z, heading: Math.atan2(site.cx - x, site.cz - z) };  // nose to the house
  }

  function buildHeli() {
    const root = arenaRoot();
    const site = mansion();
    if (!root || !site) return false;
    if (!CBZ.cityRegisterMilitaryVehicle || !CBZ.debugBuildAircraft || !CBZ.debugBuildAircraft.heli) return false;
    let grp = null;
    try { grp = CBZ.debugBuildAircraft.heli(); } catch (e) { grp = null; }
    if (!grp) return false;
    const s = heliSpot(site);
    const belly = (grp.userData && +grp.userData.belly) || 1.2;
    grp.position.set(s.x, groundY(s.x, s.z) + belly, s.z);
    grp.rotation.y = s.heading;
    grp.userData.dynamic = true;
    root.add(grp);
    let rec = null;
    try {
      rec = CBZ.cityRegisterMilitaryVehicle({
        group: grp, kind: "heli", name: "Executive One",
        model: { name: "Executive One", value: 9000000, rarity: 0.02, body: "heli" },
        footW: 4.0, footL: 12.0,
        hot: false,          // it is the state's aircraft, not a trophy to launder
      });
    } catch (e) { rec = null; }
    if (!rec) { if (grp.parent) grp.parent.remove(grp); return false; }
    rec._motorcade = true;
    HELI.rec = rec; HELI.forArena = arena(); HELI.forSites = CBZ.govComplexes;
    return true;
  }

  function heliAlive() {
    const r = HELI.rec;
    if (!r || r.destroyed) return false;
    const list = CBZ.cityMilitaryVehicles;
    return !!(Array.isArray(list) && list.indexOf(r) >= 0);
  }

  function dropHeli() {
    const r = HELI.rec;
    HELI.rec = null; HELI.forArena = null; HELI.forSites = null;
    if (!r) return;
    if (r.taken) return;                                  // somebody is flying it
    const list = CBZ.cityMilitaryVehicles;
    if (Array.isArray(list)) { const i = list.indexOf(r); if (i >= 0) list.splice(i, 1); }
    // the meshes are aircraft.js's SHARED cached assets — detach, never dispose.
    if (r.group && r.group.parent) r.group.parent.remove(r.group);
  }

  /* BOARDING YOUR OWN AIRCRAFT IS NOT GRAND THEFT.

     militaryvehicles.js's boardVehicle() is the right controller and the wrong
     verb: it fires cityCrime("grand-theft-military") + cityForceStars(4) and
     radios "a Executive One just rolled off the reservation" — unconditionally,
     because every other machine on that registry belongs to somebody else.
     (The yacht helideck has the same defect today: you get four stars for
     boarding the helicopter parked on the boat you own.)

     E is routed by CBZ.cityTryNearestRide BEFORE the interaction card resolves,
     so an option row cannot win this. The repo's wrapper doctrine (yachts.js
     around spawnCityTraffic) is the answer: intercept exactly one record, for
     exactly one person, and delegate everything else untouched. The president
     boards through the same citySpawnFlyableFromProp the theft path ends in —
     same airframe, same flight model, no crime. */
  function wrapRide() {
    const orig = CBZ.cityTryNearestRide;
    if (!orig || orig._motorcade) return !!(orig && orig._motorcade);
    const w = function () {
      try {
        const rec = HELI.rec, P = CBZ.player;
        if (rec && !rec.taken && !rec.destroyed && rec.pos && P && P.pos && !P.dead &&
            !P._aircraft && !P._vehicle && !P.driving && active() &&
            CBZ.citySpawnFlyableFromProp &&
            Math.hypot(P.pos.x - rec.pos.x, P.pos.z - rec.pos.z) < HELI_BOARD_R) {
          rec.taken = true;
          let c = null;
          try { c = CBZ.citySpawnFlyableFromProp(rec); } catch (e) { c = null; }
          if (c) { AUDIT.heliBoards++; feed("Executive One, lifting.", "#8fc1ff"); return true; }
          rec.taken = false;
        }
      } catch (e) { /* never let this break the use key */ }
      return orig.apply(this, arguments);
    };
    for (const k in orig) { try { w[k] = orig[k]; } catch (e) {} }
    w._motorcade = true;
    CBZ.cityTryNearestRide = w;
    return true;
  }

  // ============================================================
  //  §7  UPKEEP — build lazily, rebuild on a new arena, stand down when the
  //  seat is lost. cityMakeCar needs CBZ.city.arena, which mode.js assigns
  //  only AFTER worldgen (marina.js's note), so nothing here can run at load.
  // ============================================================
  function stale(slot) {
    return slot.forArena !== arena() || slot.forSites !== CBZ.govComplexes;
  }
  function ensureCar() {
    if (!on()) return false;
    if (carAlive() && !stale(CAR)) return true;
    if (CAR.rec) dropCar();
    return buildCar();
  }
  function ensureHeli() {
    if (!on()) return false;
    if (heliAlive() && !stale(HELI)) return true;
    if (HELI.rec) dropHeli();
    return buildHeli();
  }
  function standDown() {
    if (CAR.rec) dropCar();
    if (HELI.rec && !HELI.rec.taken) dropHeli();
  }

  let acc = 99;                                 // first pass runs immediately
  if (CBZ.onUpdate) {
    // 41.92 — just behind citystaff.js's post tick (41.86), so a chauffeur
    // minted this frame is already on the roster when the card looks for him.
    CBZ.onUpdate(41.92, function (dt) {
      if (!on()) return;
      wireCard();
      wrapRide();
      // the fade is the ONE per-frame thing here; everything else is ~1 Hz.
      if (!playing()) {
        // a death, an arrest, a menu or a mode change mid-ride: cancel the
        // placement rather than teleporting somebody who is no longer playing,
        // and never leave the screen stuck black.
        if (FADE.phase) fadeCancel();
        return;
      }
      tickFade(dt);
      acc += dt || 0;
      if (acc < 0.9) return;
      acc = 0;
      if (!seated()) { if (CAR.rec || HELI.rec) standDown(); return; }
      if (!mansion() || !arena()) return;
      ensureCar();
      ensureHeli();
    });
  }

  // ============================================================
  //  §8  THE PROBE. What actually exists, not what was intended.
  // ============================================================
  function liveDestinations() {
    const out = [];
    for (let i = 0; i < DESTS.length; i++) { try { if (DESTS[i].at()) out.push(DESTS[i].id); } catch (e) {} }
    return out;
  }
  CBZ.motorcadeAudit = function () {
    return {
      car: carAlive(),
      destinations: liveDestinations(),
      rides: AUDIT.rides | 0,
      helicopter: heliAlive(),
      // beyond the asked-for four — the things a failure would show up in
      chauffeur: !!chauffeurPost(),
      chauffeurEmbodied: !!(function () { const p = chauffeurPost(); return p && p.ped && !p.ped.dead; })(),
      seated: seated(),
      heliBoards: AUDIT.heliBoards | 0,
      lastDest: AUDIT.lastDest,
      flag: CFG.MOTORCADE_V1 !== false,
    };
  };

  CBZ.motorcade = {
    go: go,
    destinations: function () {
      return DESTS.map(function (d) { return { id: d.id, name: d.name, label: d.label, at: (function () { try { return d.at(); } catch (e) { return null; } })() }; });
    },
    car: function () { return CAR.rec; },
    helicopter: function () { return HELI.rec; },
    chauffeur: function () { const p = chauffeurPost(); return (p && p.ped) || null; },
    audit: CBZ.motorcadeAudit,
    // harness/test hooks only — not part of the public contract
    _ensure: function () { return { car: ensureCar(), heli: ensureHeli() }; },
    _standDown: standDown,
  };
})();
