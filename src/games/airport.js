/* ============================================================
   games/airport.js — REDEYE INTERNATIONAL, as a GAME PACKAGE.

   The airport ISLAND already exists (city/island_airport.js): a real
   runway (09/27) with edge lights, a terminal, a tower, and — critically —
   PARKED, FLYABLE aircraft (the airliners + private jets register as
   boardable craft, and city/playeraircraft.js owns the REAL flight physics
   the player flies with). That's the ENGINE. This package does NOT rebuild
   any of it and it does NOT fork flight: it OBSERVES the real craft
   (CBZ.player._aircraft) and layers the NIGHT-SHIFT SMUGGLER-PILOT arc on
   top of it.

   THE ARC: [E] at the charter desk → job board (legit cargo, low pay /
   HOT cargo, big pay + customs heat) → optional preflight WALKAROUND
   (a seeded defect hides on the airframe — skip it and it bites in the
   air) → board the real private jet and fly to the destination anchor →
   fly the run home and shoot RUNWAY 27 on the PAPI (4 emissive lamps
   computed from the craft's REAL altitude/distance vs the glideslope —
   genuinely honest) → the touchdown is RATED off the real sink rate the
   physics reports (craft.lastTouchdown.sink) → collect the payout in REAL
   city cash at the desk, where a customs INSPECTOR randomly pulls a hot
   run: pay the fine (a strike) or slip him a bribe at mood-driven odds.
   Three strikes and the license is pulled (arc end, restart at the desk).
   Pay the plane's $12k note down to zero and it's YOURS — the win.

   WHAT IS REUSED vs ADDED
     REUSED  the whole airfield (island_airport.js) and its parked flyable
             jets; the REAL flight model + touchdown physics
             (playeraircraft.js — craft.pos/airspeed/vy/onGround, and
             craft.lastTouchdown.sink the honest landing grade reads);
             CBZ.citySpawnFlyableFromProp (clean board of a real jet);
             CBZ.cityPlayerAircraftDamage (the honest consequence a skipped
             defect cashes in against the real airframe); ctx.wallet (REAL
             city cash), ctx.npc (real peds for the cast), the runway
             geometry (PAPI aims at the real RWY-27 touchdown zone).
     ADDED   the smuggler ECON + arc (ported verbatim from the games/
             airport.html standalone draft: legit-vs-hot payout math, the
             PAPI red/white glideslope computation, landing rating by
             touchdown vspeed, customs heat / bribe odds, the three-strikes
             license arc, the $12k plane note); the pure-logic funnel with a
             rig queue so a gate can force outcomes; the charter/customs/fuel
             cast; and the load-bearing dressing (job board, PAPI array,
             windsock the real wind blows the plane across on final).

   Venue: the airport is a LANDMASS, not a lot. venue.resolve() anchors on
   the apron once island_airport has published its audit (contract #8:
   confirmed via A.airportAudit / the 'airport' region), and the engine
   lazily retries every few frames until the island is built.

   Determinism: build() draws only ctx.rand/ctx.stream (position-hash law).
   Gameplay rolls (jobs, wind, inspection, bribe) run through nextRand() —
   Math.random-backed at runtime, but a rig queue lets the check force
   exact outcomes (this is the SAME funnel the standalone shipped).

   Revert: CBZ.CONFIG.PKG_AIRPORT = false → nothing mounts; the airport's
   own fly-a-jet capability is completely untouched.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.games) return;
  const THREE = window.THREE;

  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.PKG_AIRPORT == null) CBZ.CONFIG.PKG_AIRPORT = true;

  const D2R = Math.PI / 180;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const fmt$ = (n) => (n < 0 ? "-$" : "$") + Math.abs(Math.round(n)).toLocaleString("en-US");
  const esc = (s) => String(s == null ? "" : s).replace(/[<>&]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"));
  function note(m, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(m, s || 2.2); }
  function feed(m, c) { if (CBZ.cityFeed) CBZ.cityFeed(m, c || "#cfe0ff"); }

  /* ============================================================
     GAMEPLAY RNG FUNNEL — every job / wind / defect / inspection / bribe
     roll draws from nextRand(); the rig queue lets a gate force exact
     outcomes without any live flying (ported from airport.html). Runtime
     RNG is Math.random (allowed — this is not a build path).
  ============================================================ */
  const rigQueue = [];
  function nextRand() { return rigQueue.length ? rigQueue.shift() : Math.random(); }

  /* ============================================================
     SALVAGED PURE LOGIC — ported from games/airport.html's ECON/PHYS/PAPI
     blocks. These are the whole reason REDEYE is a GAME and not a flight:
     real cash in and out, a truthful glideslope, a graded touchdown, and
     customs odds that make a hot run a gamble. Every function here is pure
     and asserted through `api` by the gate.
  ============================================================ */
  const ECON = {
    DEBT0: 12000,                            // the plane's note — pay it off to WIN
    BASE: 150, RATE_LEGIT: 280, RATE_HOT: 700, CARGO_LEGIT: 0.5, CARGO_HOT: 1.4,
    ONTIME_FRAC: 0.15, FINE_BASE: 200, FINE_FRAC: 0.5, BRIBE_FRAC: 0.35,
    FIX_DEFECT: 150, BUTTER_BONUS: 120,
    INSPECT_HOT: 0.38, INSPECT_LEGIT: 0.06,
    NOCLR_LAND_FINE: 150,
  };
  // PAPI: four lamp units, each with its own glideslope threshold (deg). A
  // lamp reads WHITE when your approach angle is above its threshold, RED
  // below. On the 3.00° slope that is two white / two red — the "on-slope"
  // read every real PAPI is built to give.
  const PAPI_T = [2.5, 2.83, 3.17, 3.5];

  // legit vs hot payout — distance (nm) pays, hot pays far more, and cargo
  // weight is worth more when it's hot.
  function payoutFor(destId, hot, cargoKg) {
    const d = DESTS.find((k) => k.id === destId); if (!d) return 0;
    const nm = d.dist / 1852;
    return ECON.BASE + Math.round(nm * (hot ? ECON.RATE_HOT : ECON.RATE_LEGIT)) +
      Math.round(cargoKg * (hot ? ECON.CARGO_HOT : ECON.CARGO_LEGIT));
  }
  function fineFor(payout) { return Math.round(payout * ECON.FINE_FRAC) + ECON.FINE_BASE; }
  function bribeCostFor(payout) { return Math.round(payout * ECON.BRIBE_FRAC); }
  function bribeOdds(mood) { return clamp(0.15 + mood * 0.7, 0, 0.95); }  // relaxed inspector = better odds

  // THE HONEST GLIDESLOPE: angle from the real (dist, alt) → the 4-lamp
  // W/R string. This is exactly what the built lamps display each frame.
  function papiAt(dist, alt) {
    const ang = Math.atan2(alt, Math.max(1, dist)) / D2R;
    let s = "";
    for (let i = 0; i < 4; i++) s += ang > PAPI_T[i] ? "W" : "R";
    return s;
  }
  // touchdown grade off the vertical speed the REAL physics reports.
  function simLanding(vspeed) {
    const vs = Math.abs(vspeed);
    if (vs < 1.2) return { rating: "BUTTER", damage: 0, bonus: ECON.BUTTER_BONUS };
    if (vs < 2.5) return { rating: "FIRM", damage: 2, bonus: 0 };
    if (vs < 4.5) return { rating: "HARD", damage: 18, bonus: 0 };
    return { rating: "CRASH", damage: 100, bonus: 0 };
  }
  function inspectionChance(hot) { return hot ? ECON.INSPECT_HOT : ECON.INSPECT_LEGIT; }

  /* ============================================================
     DESTINATIONS — abstract sea anchors reached by flying the REAL jet out
     over open water. Distances are measured from the apron so payoutFor is
     honest. Each carries a lit beacon (built in build()) to aim for; a run
     "delivers" on proximity + low altitude (uncontrolled outstations).
  ============================================================ */
  // Rides the airport's world-layout dial (world/layout.js): the apron spot
  // this venue mounts on is BUILT at 95+dx (island_airport.js private-jet
  // row), so a fixed 95 would mount the whole REDEYE venue on open sea after
  // a stage-2 slide. The sea DESTS below stay absolute (they are open-water
  // beacons, not landmass furniture); dist re-derives from the moved apron.
  const _WOFF = (CBZ.worldOff && CBZ.worldOff("airport")) || { dx: 0, dz: 0 };
  const APRON_REF = { x: 95 + _WOFF.dx, z: 20 + _WOFF.dz };   // airfield reference the run distance is measured from
  const DESTS = [
    // SALT CAY moved west (-40 → -520): the snow island now parks at
    // z≈-1920..-2580 (world/layout.js snow dial), and the old spot put this
    // "open-water" beacon on the alpine tundra. (-520,-2050) is the permanent
    // sea channel between the forest's north shore and the Greater Mercy
    // envelope — open water at every dial setting.
    { id: "salt",    name: "SALT CAY",     x: -520,  z: -2050, col: 0xffb03a },
    { id: "marlin",  name: "MARLIN ROCK",  x: -1650, z: -900,  col: 0x36e0c8 },
    { id: "pelican", name: "PELICAN REEF", x: 980,   z: -1650, col: 0xff5ad0 },
  ];
  // flight distance (metres) → payoutFor turns it into nm. Fixed literals only.
  DESTS.forEach((d) => { d.dist = Math.round(Math.hypot(d.x - APRON_REF.x, d.z - APRON_REF.z)); });

  /* ============================================================
     LIVE + PERSISTED STATE
       S  — the persisted note/record bag (ctx.state, localStorage-mirrored)
       R  — the live run state machine (session-only)
  ============================================================ */
  let C = null;      // ctx once mounted
  let VENUE = null;  // the mounted venue
  let S = null;      // persisted bag
  function bag() { return S || (S = C.state(() => ({
    debt: ECON.DEBT0, strikes: 0, ending: null,
    runs: 0, onTime: 0, bestVs: null, bestRating: "—",
    bribes: 0, bribesPaid: 0, earned: 0, spent: 0, titles: 0,
  }))); }
  function save() { if (C) C.saveState(); }

  const R = {
    job: null,                 // active job or null
    board: [],                 // 3 offered jobs
    boardN: 0,
    phase: "idle",             // idle|preflight|outbound|returning|inbound|arrived
    delivered: false,
    wind: { dir: 0, speed: 3 },
    inspection: null,          // {mood, resolved} once a hot run is pulled
    airborneT: 0, defectFired: false,
    landingRating: null,       // set at the home touchdown
    noClrFined: false,
    lampMats: null,            // 4 PAPI lamp materials
    sock: null,                // {pivot, cone}
    charterRec: null,          // the parked jet rec the clean board uses
  };
  // Both fallbacks self-heal from the live airportAudit at build(), but they
  // ride the dial too so even the audit-lag window points at the MOVED field.
  const AIM = { x: 170 + _WOFF.dx, z: -90 + _WOFF.dz };  // RWY-27 touchdown aim point (overwritten from the real audit)
  let HOME = { minX: -900 + _WOFF.dx, maxX: 290 + _WOFF.dx, minZ: -280 + _WOFF.dz, maxZ: 40 + _WOFF.dz };
  let RUN_HEADING = -Math.PI / 2;            // RWY 27 = land west

  /* -------- jobs -------- */
  const JOB_NAMES_LEGIT = ["MAIL SACKS", "MEDICAL COOLERS", "ENGINE PARTS", "DIVE GEAR", "GENERATOR COILS"];
  const JOB_NAMES_HOT = ["UNMARKED CRATES", "'FISH' — NO MANIFEST", "SEALED DRUMS", "QUIET BOXES", "SPARE PARTS (DON'T ASK)"];
  const DEFECT_NAMES = ["OIL LEAK (nose)", "FUEL CAP OPEN (right wing)", "FLAP HINGE CRACK (left wing)", "ELEVATOR PLAY (tail)"];
  const STATION_NAMES = ["NOSE / ENGINE", "LEFT WING", "RIGHT WING", "TAIL"];

  function makeJob() {
    const hot = nextRand() < 0.45;
    const dest = DESTS[Math.floor(nextRand() * DESTS.length)];
    const names = hot ? JOB_NAMES_HOT : JOB_NAMES_LEGIT;
    const name = names[Math.floor(nextRand() * names.length)];
    const cargoKg = 150 + Math.round(nextRand() * 45) * 10;
    const payout = payoutFor(dest.id, hot, cargoKg);
    const defect = nextRand() < 0.25 ? Math.floor(nextRand() * 4) : -1;
    return {
      id: "J" + (R.boardN++) + (hot ? "H" : "L"), name, destId: dest.id, hot,
      cargoKg, payout, defect, defectFound: false, defectFixed: false, fixArmed: false,
      stations: [false, false, false, false],
    };
  }
  function rollBoard() {
    R.board = [makeJob(), makeJob(), makeJob()];
    if (!R.board.some((j) => j.hot)) R.board[2].hot = true;      // the desk always tempts you
  }
  function rollWind() { return { dir: nextRand() * 360, speed: 1 + nextRand() * 8 }; }

  /* ============================================================
     ARC BOOKKEEPING — strikes / debt / endings, all against the persisted
     bag so a career survives a session. Real cash flows through ctx.wallet.
  ============================================================ */
  function strike(reason) {
    const s = bag();
    if (s.ending) return s.strikes;
    s.strikes++;
    note("STRIKE " + s.strikes + " / 3 — " + reason, 3.2);
    feed("Customs violation logged: " + reason + " (" + s.strikes + "/3)", "#ff9a9a");
    if (s.strikes >= 3) setEnding("LOSE", "License pulled: " + reason);
    save();
    return s.strikes;
  }
  function setEnding(kind, why) {
    const s = bag();
    if (s.ending) return;
    s.ending = kind; s.endReason = why;
    if (kind === "WIN") s.titles++;
    save();
    // clear any run in progress
    R.job = null; R.delivered = false; R.inspection = null; R.phase = "idle";
    openEndingPanel(kind, why);
  }
  function payDebt(n) {
    const s = bag();
    if (n <= 0) return;
    if (!C.wallet.spend(n, "Paid down N407RD")) { note("You're short — payout a run first.", 2.2); return; }
    s.debt = Math.max(0, s.debt - n); s.spent += n; save();
    note("Paid " + fmt$(n) + " on the note — " + fmt$(s.debt) + " to go.", 2.6);
    if (s.debt <= 0) setEnding("WIN", "You paid the plane off. She's yours, free and clear.");
    else openBoard();
  }

  /* ============================================================
     CUSTOMS — the pure resolver a gate drives directly, plus the live flow.
  ============================================================ */
  // pure-ish: riggable through nextRand for the bribe roll (mood → odds).
  function resolveBribe(mood, jobPayout) {
    const s = bag();
    const payout = jobPayout != null ? jobPayout : (R.job ? R.job.payout : 1000);
    const cost = bribeCostFor(payout);
    const odds = bribeOdds(mood);
    const roll = nextRand();
    const accepted = roll < odds;
    C.wallet.spend(cost, "Slipped the inspector");
    s.bribes++; s.bribesPaid += cost; s.spent += cost; save();
    let fine = 0;
    if (!accepted) { fine = fineFor(payout); C.wallet.spend(fine, "Customs fine"); s.spent += fine; save(); strike("attempted bribery of a customs officer"); }
    return { accepted, odds, roll, cost, fine, strikes: bag().strikes };
  }

  /* ============================================================
     COLLECT — the payout + customs gate the desk routes a returned run
     through. Legit clears; hot rolls the inspector.
  ============================================================ */
  function collectRun() {
    const j = R.job; if (!j || !R.delivered) return;
    // customs roll happens once, on the hot run's return.
    if (j.hot && !R.inspection) {
      if (nextRand() < inspectionChance(true)) {
        R.inspection = { mood: nextRand(), resolved: false };
        openInspection();
        return;
      }
    } else if (!j.hot && !R.inspection && nextRand() < inspectionChance(false)) {
      // a legit run gets a cursory look — always clears, no stakes.
      note("Customs waves you through. Papers are clean.", 2.2);
    }
    finishPayout(0, false);
  }
  function finishPayout(bonus, seized) {
    const j = R.job, s = bag();
    s.runs++;
    if (seized || !j) {
      R.job = null; R.delivered = false; R.inspection = null; R.phase = "idle"; rollBoard();
      openBoard();
      return;
    }
    let land = 0;
    if (R.landingRating && R.landingRating.bonus) land = R.landingRating.bonus;
    const pay = j.payout + (bonus || 0) + land;
    C.wallet.give(pay, "REDEYE run: " + j.name);
    s.earned += pay; save();
    note("PAID " + fmt$(pay) + (land ? " (butter bonus)" : ""), 3.2);
    feed("Delivered " + j.name + " — collected " + fmt$(pay) + ". Debt " + fmt$(s.debt), "#8ef0a8");
    R.job = null; R.delivered = false; R.inspection = null; R.phase = "idle"; R.landingRating = null;
    rollBoard();
    openBoard();
  }

  /* ============================================================
     BOARD THE REAL JET — clean flyable spawn off the nearest parked private
     jet (CBZ.citySpawnFlyableFromProp). This reuses the EXACT parked model
     and the real flight physics — no fork. If the infra is absent the
     player can still hijack a jet the normal way; the run OBSERVES
     CBZ.player._aircraft either way.
  ============================================================ */
  function nearestCharterRec() {
    const list = CBZ.cityMilitaryVehicles || [];
    let best = null, bd = 1e9;
    for (const rec of list) {
      if (!rec || rec.destroyed || rec.taken || !rec.civilian || rec.kind !== "plane") continue;
      if (rec.flightKind !== "privatejet") continue;      // fly the little charter bird, not an airliner
      const dx = rec.pos.x - VENUE.origin.x, dz = rec.pos.z - VENUE.origin.z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = rec; }
    }
    return best;
  }
  function boardCharter() {
    if (!R.job) { note("Take a run at the charter desk first.", 2.2); return; }
    const P = CBZ.player;
    if (P && P._aircraft) return;                          // already flying
    const rec = nearestCharterRec();
    if (rec && CBZ.citySpawnFlyableFromProp) {
      const craft = CBZ.citySpawnFlyableFromProp(rec);
      if (craft) {
        R.charterRec = rec;
        note("Engine start. Cargo aboard — call it in and fly the run.", 2.6);
        return;
      }
    }
    // fallback: no clean board — point the player at a real parked jet.
    note("Board a parked jet to fly the run (walk up, press E).", 3.0);
  }

  /* ============================================================
     PREFLIGHT WALKAROUND — 4 stations around the parked charter jet. The
     job's seeded defect hides at one; find it and pay to fix it, or skip
     and it bites ~15s after liftoff (a real airframe consequence).
  ============================================================ */
  function inspectStation(i) {
    const j = R.job; if (!j) return;
    if (j.defect === i && !j.defectFixed) {
      j.defectFound = true;
      if (j.fixArmed) {
        if (!C.wallet.spend(ECON.FIX_DEFECT, "Fixed " + DEFECT_NAMES[i])) { note("Can't cover the repair right now.", 2.2); return; }
        j.defectFixed = true; j.stations[i] = true; j.fixArmed = false;
        note("DEFECT FIXED — " + DEFECT_NAMES[i] + " squared away.", 2.4);
        return;
      }
      j.fixArmed = true;
      note("FOUND: " + DEFECT_NAMES[i] + " — it WILL fail in the air. [E] again to fix for " + fmt$(ECON.FIX_DEFECT) + ".", 3.6);
      return;
    }
    j.stations[i] = true;
    const done = j.stations.filter(Boolean).length;
    note(STATION_NAMES[i] + ": clean (" + done + "/4 checked)", 1.6);
  }

  /* ============================================================
     PANELS (engine panel, data-act delegation — casino/racing pattern)
  ============================================================ */
  const BTN = "display:inline-block;margin:4px 6px 2px 0;padding:9px 15px;border-radius:11px;cursor:pointer;font-weight:800;font-size:13px;user-select:none;box-shadow:0 3px 0 rgba(0,0,0,.4);";
  function btn(act, label, bg, dis, data) {
    let d = ""; if (data) for (const k in data) d += " data-" + k + "='" + esc(data[k]) + "'";
    return "<span data-act='" + act + "'" + d + " style='" + BTN + "background:" + (bg || "#1c5a6b") + ";" + (dis ? "opacity:.4;pointer-events:none;" : "") + "'>" + label + "</span>";
  }
  function head(title, sub) {
    return "<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:8px'>" +
      "<b style='letter-spacing:2px;color:#e8b64c'>" + title + "</b><span style='opacity:.7;font-size:12px'>" + sub + " · Esc closes</span></div>";
  }
  function windStr() {
    const d = Math.round(R.wind.dir / 10) * 10 || 360;
    return ("00" + d).slice(-3) + "° at " + Math.round(R.wind.speed * 1.94) + "kt";
  }

  function openBoard() {
    if (!C) return;
    const s = bag();
    if (s.ending) { openEndingPanel(s.ending, s.endReason || ""); return; }
    // a returned run collects here first
    if (R.job && R.delivered) {
      const j = R.job;
      C.hud.panel(head("REDEYE — CHARTER DESK", "collect"),
        "<div style='margin:2px 0 8px;font-size:13px'>" + esc(j.name) + " is home. " +
        (j.hot ? "<span style='color:#ff8a8a'>Hot cargo — customs may want a look.</span>" : "Paperwork's clean.") +
        (R.landingRating ? " Landing graded <b style='color:#e8b64c'>" + R.landingRating.rating + "</b>." : "") + "</div>" +
        btn("collect", "COLLECT " + fmt$(j.payout), "#1c6b40") + btn("close", "Later", "#26343c"),
        { collect: collectRun, close: () => C.hud.closePanel() });
      return;
    }
    if (R.job) {
      const d = DESTS.find((k) => k.id === R.job.destId);
      C.hud.panel(head("REDEYE — CHARTER DESK", "run in progress"),
        "<div style='margin:2px 0 8px;font-size:13px'>Active: <b>" + esc(R.job.name) + "</b> → " + esc(d.name) +
        " · " + R.job.cargoKg + "kg · " + fmt$(R.job.payout) + (R.job.hot ? " <span style='color:#ff8a8a'>HOT</span>" : "") +
        "<br><span style='opacity:.75'>Walkaround the jet, then board and fly. Wind " + windStr() + ".</span></div>" +
        btn("board", "BOARD N407RD & FLY", "#c98f22") + btn("abort", "Abandon run", "#7c1626") + btn("close", "Close", "#26343c"),
        { board: () => { C.hud.closePanel(); boardCharter(); }, abort: abortRun, close: () => C.hud.closePanel() });
      return;
    }
    // the job board
    let rows = "<div style='display:grid;grid-template-columns:1fr 70px 60px;gap:5px 8px;font-size:12px;margin:4px 0 8px'>";
    R.board.forEach((j, i) => {
      const d = DESTS.find((k) => k.id === j.destId);
      rows += "<span>" + (j.hot ? "<span style='color:#ff8a8a;font-weight:800'>HOT </span>" : "") + esc(j.name) +
        "<br><span style='opacity:.6'>→ " + esc(d.name) + " · " + j.cargoKg + "kg</span></span>" +
        "<span style='align-self:center;color:#8ef0a8;font-weight:800'>" + fmt$(j.payout) + "</span>" +
        "<span style='align-self:center'>" + btn("take", "TAKE", j.hot ? "#8a3324" : "#1c5a6b", false, { i: i }) + "</span>";
    });
    rows += "</div>";
    C.hud.panel(head("REDEYE INTERNATIONAL", "night charter"),
      "<div style='margin:2px 0 6px;font-size:13px'>Plane note <b style='color:#ff9a9a'>" + fmt$(s.debt) + "</b> · " +
      "cash <b style='color:#e8b64c'>" + fmt$(C.wallet.cash()) + "</b> · license " + strikeDots(s.strikes) + "</div>" + rows +
      "<div style='font-size:11px;opacity:.7;margin-bottom:6px'>Legit pays honest money. Hot pays big — and customs runs the ramp on the way home.</div>" +
      btn("pay500", "PAY $500 ON THE NOTE", "#2a5c3a", C.wallet.cash() < 500) +
      btn("payall", "PAY " + fmt$(Math.min(s.debt, C.wallet.cash())), "#2a5c3a", C.wallet.cash() < 1) +
      btn("close", "Leave", "#26343c"),
      {
        take: (el) => { const i = el && el.getAttribute ? (el.getAttribute("data-i") | 0) : 0; acceptJob(R.board[i]); },
        pay500: () => payDebt(Math.min(500, s.debt)),
        payall: () => payDebt(Math.min(s.debt, C.wallet.cash())),
        close: () => C.hud.closePanel(),
      });
  }
  function strikeDots(n) {
    let s = "";
    for (let i = 0; i < 3; i++) s += "<span style='color:" + (i < n ? "#ff5a5a" : "#3a4150") + "'>●</span>";
    return s;
  }

  function acceptJob(j) {
    if (!j) return;
    R.job = j; R.delivered = false; R.inspection = null; R.phase = "preflight";
    R.airborneT = 0; R.defectFired = false; R.landingRating = null; R.noClrFined = false;
    R.wind = rollWind();
    R.board = R.board.filter((k) => k !== j);
    const d = DESTS.find((k) => k.id === j.destId);
    note("RUN ACCEPTED — " + j.name + " → " + d.name + ". Walkaround, then fly.", 3.0);
    if (j.hot) feed("No manifest on this one. You didn't get it from us.", "#ffd08a");
    C.hud.closePanel();
  }
  function abortRun() {
    if (!R.job) return;
    note("Run abandoned.", 2.0);
    R.job = null; R.delivered = false; R.inspection = null; R.phase = "idle"; rollBoard();
    C.hud.closePanel();
  }

  function openInspection() {
    const j = R.job, ins = R.inspection; if (!j || !ins) return;
    if (CUSTOMS && CUSTOMS.say) CUSTOMS.say(moodLine(ins.mood), 3.2);
    const cost = bribeCostFor(j.payout), odds = bribeOdds(ins.mood);
    C.hud.panel(head("CUSTOMS — INSPECTOR VANN", "ramp check"),
      "<div style='margin:2px 0 8px;font-size:13px'>" + esc(moodLine(ins.mood)) +
      "<br>In the back: <b>" + esc(j.name) + "</b>, " + j.cargoKg + "kg — " +
      "<span style='color:#ff8a8a'>this will not survive a manifest check.</span></div>" +
      btn("bribe", "SLIP HIM " + fmt$(cost) + " (" + Math.round(odds * 100) + "% he pockets it)", "#8a6a1c") +
      btn("submit", "HAND OVER THE MANIFEST", "#7c1626"),
      {
        bribe: () => {
          const r = resolveBribe(ins.mood, j.payout);
          C.hud.closePanel();
          if (r.accepted) { note("He pockets it. “Wind must've blown that pallet in. Night.”", 3.0); finishPayout(0, false); }
          else { note("BUSTED — cargo seized, fined " + fmt$(r.fine) + ".", 3.4); if (CUSTOMS) CUSTOMS.say("Hands where I can see 'em.", 2.4); finishPayout(0, true); }
        },
        submit: () => {
          C.hud.closePanel();
          const fine = fineFor(j.payout);
          C.wallet.spend(fine, "Customs fine"); bag().spent += fine; save();
          strike("smuggling — hot cargo on the manifest");
          note("BUSTED — cargo seized, fined " + fmt$(fine) + ".", 3.4);
          finishPayout(0, true);
        },
      });
  }
  function moodLine(m) {
    if (m < 0.34) return "Vann's arms are crossed. He hasn't blinked. “Manifest. Now.”";
    if (m < 0.67) return "Vann flips his clipboard, even keel. “Evening. Papers, please.”";
    return "Vann strolls over, hands behind his back. “Slow night. Whatcha hauling?”";
  }

  function openEndingPanel(kind, why) {
    if (!C) return;
    const s = bag();
    const verdict = kind === "WIN" ? "PAID OFF" : "LICENSE PULLED";
    const vc = kind === "WIN" ? "#e8b64c" : "#ff7a7a";
    const otp = s.runs ? Math.round(100 * s.onTime / s.runs) : 0;
    C.hud.panel(head("REDEYE INTERNATIONAL", "the night is over"),
      "<div style='font-size:28px;font-weight:900;letter-spacing:3px;color:" + vc + ";margin:2px 0'>" + verdict + "</div>" +
      "<div style='font-size:13px;margin:4px 0'>" + esc(why || "") + "</div>" +
      "<div style='font-size:12px;opacity:.85;margin:6px 0'>Runs " + s.runs + " · best landing " + s.bestRating +
      (s.bestVs != null ? " (" + s.bestVs.toFixed(1) + " m/s)" : "") + " · bribes " + s.bribes + " (" + fmt$(s.bribesPaid) + ")" +
      "<br>Career net " + fmt$(s.earned - s.spent) + " · plane notes paid off " + s.titles + "</div>" +
      (kind === "LOSE" ? btn("relicense", "APPLY FOR A NEW LICENSE", "#2a5c3a") : btn("newnote", "SIGN A NEW PLANE ($12k note)", "#2a5c3a")) +
      btn("close", "Done", "#26343c"),
      {
        relicense: () => { const b = bag(); b.strikes = 0; b.ending = null; b.endReason = ""; save(); rollBoard(); openBoard(); },
        newnote: () => { const b = bag(); b.debt = ECON.DEBT0; b.ending = null; b.endReason = ""; save(); rollBoard(); openBoard(); },
        close: () => C.hud.closePanel(),
      });
  }

  /* ============================================================
     LIVE RUN — the per-frame observer. It reads the REAL flown craft and
     advances the phase machine; it never integrates flight itself. It also
     drives the PAPI lamps (from real alt/dist) and the crosswind drift on
     final (the windsock's WHY).
  ============================================================ */
  function flying() { const P = CBZ.player; return P && P._aircraft ? P._aircraft : null; }
  function overHome(x, z) { return x > HOME.minX && x < HOME.maxX && z > HOME.minZ && z < HOME.maxZ; }
  function nearDest(craft) {
    const d = DESTS.find((k) => k.id === (R.job && R.job.destId));
    if (!d) return false;
    const dx = craft.pos.x - d.x, dz = craft.pos.z - d.z;
    return (dx * dx + dz * dz) < 260 * 260 && craft.pos.y < 130;
  }

  function update(ctx, dt) {
    if (dt > 0.12) dt = 0.12;
    if (CBZ.game && CBZ.game.mode !== "city") return;

    // windsock + PAPI animate off whatever wind is current (ambient when idle)
    animateSock(dt);

    const craft = flying();
    const j = R.job;

    // ---------- PAPI: only when a returning run is inbound to RWY 27 ----------
    const inboundZone = !!(craft && j && R.delivered && !craft.onGround &&
      craft.pos.x > AIM.x - 40 && craft.pos.x < AIM.x + 2600 &&
      Math.abs(craft.pos.z - AIM.z) < 480 && craft.pos.y < 500);
    if (inboundZone) {
      R.phase = "inbound";
      const dist = Math.max(1, craft.pos.x - AIM.x);      // horizontal distance down the approach
      setPapi(papiAt(dist, craft.pos.y));
      // CROSSWIND DRIFT — the same wind the sock shows blows the jet across
      // the centreline on final. Small, honest nudge to craft.pos (the engine
      // rebuilds velocity from heading each frame, so this reads as wind, not
      // a shove). Load-bearing WHY for the windsock.
      const wr = R.wind.dir * D2R, mag = R.wind.speed * 0.05 * dt;
      craft.pos.x += Math.sin(wr) * mag;
      craft.pos.z += Math.cos(wr) * mag;
      if (craft.group) craft.group.position.copy(craft.pos);
    } else {
      setPapi(null);
    }

    if (!j) return;

    // ---------- phase machine off the real craft ----------
    if (craft) {
      if (!craft.onGround) {
        R.airborneT += dt;
        if (!R.delivered) R.phase = "outbound"; else if (R.phase !== "inbound") R.phase = "returning";

        // seeded defect bites ~15s after liftoff if the walkaround was skipped
        if (j.defect >= 0 && !j.defectFixed && !R.defectFired && R.airborneT > 15) {
          R.defectFired = true;
          const kind = DEFECT_NAMES[j.defect];
          feed("MAYDAY-ish: " + kind + " — the defect you skipped just let go.", "#ff9a9a");
          note("AIRFRAME FAILURE — " + kind, 3.4);
          // honest consequence: damage the REAL airframe (control authority sags)
          if (CBZ.cityPlayerAircraftDamage) { try { CBZ.cityPlayerAircraftDamage(48, craft.pos.x, craft.pos.z); } catch (e) {} }
        }

        // reached the outstation → delivered, turn for home
        if (!R.delivered && nearDest(craft)) {
          R.delivered = true; R.phase = "returning";
          const d = DESTS.find((k) => k.id === j.destId);
          note("CARGO DROPPED at " + d.name + ". Fly it home to REDEYE — RWY 27, PAPI on the left.", 3.6);
          feed("Delivered to " + d.name + ". Now get home clean.", "#8ef0a8");
        }
      } else {
        // ON GROUND: detect a fresh touchdown at home to grade the landing
        if (R.delivered && !R.landingRating && overHome(craft.pos.x, craft.pos.z)) {
          const sink = craft.lastTouchdown ? Math.abs(craft.lastTouchdown.sink || 0) : Math.abs(craft.vy || 0);
          gradeLanding(sink, craft.pos.x, craft.pos.z);
        }
      }
    } else if (R.phase === "outbound" || R.phase === "returning" || R.phase === "inbound") {
      // player left the cockpit (landed + exited). If a delivered run is home,
      // move to collect.
      if (R.delivered) R.phase = "arrived";
    }

    // ---------- arrived home on foot → the desk collects ----------
    if (R.phase === "arrived" && R.delivered && !flying()) {
      // auto-open the collect flow once, when the player is near the desk
      const P = CBZ.player;
      if (P && VENUE) {
        const dx = P.pos.x - VENUE.origin.x, dz = P.pos.z - VENUE.origin.z;
        if ((dx * dx + dz * dz) < 8 * 8 && !R._collectPrompted) {
          R._collectPrompted = true;
          openBoard();
        }
      }
    } else { R._collectPrompted = false; }
  }

  function gradeLanding(sink, x, z) {
    const r = simLanding(sink);
    R.landingRating = r;
    const s = bag();
    if (s.bestVs == null || sink < s.bestVs) { s.bestVs = sink; s.bestRating = r.rating; save(); }
    if (r.rating === "CRASH") {
      note("CRASH LANDING — " + sink.toFixed(1) + " m/s. That's a strike.", 3.4);
      strike("crashed the aircraft on landing");
    } else {
      note((r.rating === "BUTTER" ? "BUTTER" : r.rating) + " — " + sink.toFixed(1) + " m/s" + (r.bonus ? " · +" + fmt$(r.bonus) + " handling bonus" : ""), 2.8);
    }
    // landed without calling it in → the standalone's no-clearance fine (home only)
    if (!R.noClrFined) {
      R.noClrFined = true;
      C.wallet.spend(ECON.NOCLR_LAND_FINE, "Landed without clearance");
      s.spent += ECON.NOCLR_LAND_FINE; save();
    }
    R.phase = flying() ? "inbound" : "arrived";
  }

  /* ============================================================
     PAPI + WINDSOCK dressing controllers
  ============================================================ */
  const PAPI_W = 0xfff2e0, PAPI_R = 0xff2d2d;
  function setPapi(str) {
    if (!R.lampMats) return;
    for (let i = 0; i < 4; i++) {
      const m = R.lampMats[i];
      if (!str) { m.emissive.setHex(0x141414); m.emissiveIntensity = 0.15; m.color.setHex(0x141414); continue; }
      const white = str[i] === "W";
      m.emissive.setHex(white ? PAPI_W : PAPI_R);
      m.color.setHex(white ? PAPI_W : PAPI_R);
      m.emissiveIntensity = 1.4;
    }
  }
  function animateSock(dt) {
    if (!R.sock) return;
    // sock points DOWNWIND and lifts toward horizontal with wind speed.
    const wr = R.wind.dir * D2R;
    R.sock.pivot.rotation.y = wr;
    const lift = clamp(R.wind.speed / 10, 0.08, 1);
    R.sock.cone.rotation.z = -(Math.PI / 2) * lift + (1 - lift) * -0.15;
  }

  /* ============================================================
     BUILD — load-bearing dressing only (WHY rule). All chunky (≥0.3u) and
     ground-connected. LOCAL coords relative to venue.origin (the apron).
       charter desk  → the job board (the arc's front door)
       fuel truck    → the fueler's station (pre-flight wind/heat brief)
       customs booth → the inspector's post (the bribe/fine gate)
       windsock      → the real wind the crosswind-drift uses
       PAPI array    → the truthful glideslope, at the real RWY-27 aim point
       dest beacons  → what you aim the run at
       walkaround    → 4 [E] stations around the parked charter jet
  ============================================================ */
  let CUSTOMS = null, DISPATCH = null;    // NPC handles (for say())
  function build(ctx, venue) {
    C = ctx; VENUE = venue;
    const g = venue.group, o = venue.origin;

    // align PAPI/home to the REAL airfield audit if it's published
    const A = CBZ.city && CBZ.city.arena;
    if (A && A.airportAudit) {
      const au = A.airportAudit;
      if (au.bounds) HOME = { minX: au.bounds.minX, maxX: au.bounds.maxX, minZ: au.bounds.minZ, maxZ: au.bounds.maxZ };
      if (au.runway) { AIM.x = au.runway.maxX - 70; AIM.z = (au.runway.minZ + au.runway.maxZ) / 2; }
    }

    const steel = ctx.mat(0x39424c), dark = ctx.mat(0x1c2129), warm = ctx.mat(0xe8b64c);

    // ---- CHARTER DESK (job board) : counter + a lit board sign at origin ----
    ctx.box(g, 0, 0.6, 0, 3.2, 1.2, 1.4, ctx.mat(0x2a3542));      // counter
    ctx.box(g, 0, 1.28, 0, 3.2, 0.16, 1.6, ctx.mat(0x141a20));    // counter top
    ctx.box(g, -1.5, 2.2, -0.7, 0.3, 3.4, 0.3, steel);           // board post L
    ctx.box(g, 1.5, 2.2, -0.7, 0.3, 3.4, 0.3, steel);            // board post R
    ctx.box(g, 0, 3.2, -0.7, 3.2, 1.7, 0.24, ctx.emat(0xe8b64c, 0.55)); // the lit JOB BOARD
    ctx.box(g, 0, 3.2, -0.56, 2.8, 1.4, 0.06, ctx.mat(0x141a20)); // board face (dark, sign reads on it)
    ctx.solid(-1.6, -0.7, 1.6, 0.7, 0, 1.3);
    ctx.light(0, 3.4, 0, 0xffca72, 0.8, 12);

    // ---- FUEL TRUCK (fueler station) : tank + cab, chunky ----
    const fx = -14, fz = -3;
    ctx.box(g, fx, 1.1, fz, 3.4, 1.7, 2.0, ctx.mat(0x8a6a1c));    // tank body
    ctx.cyl(g, fx + 2.1, 1.1, fz, 0.9, 0.9, 2.0, ctx.mat(0x9a7a2c), 10); // rounded tank end
    ctx.box(g, fx - 2.2, 0.9, fz, 1.4, 1.6, 2.0, ctx.mat(0x2a2f38)); // cab
    ctx.box(g, fx + 2.4, 1.0, fz + 1.2, 0.28, 1.6, 0.28, dark);   // fuel-hose riser
    ctx.solid(fx - 3.0, fz - 1.1, fx + 3.0, fz + 1.1, 0, 1.9);
    ctx.light(fx, 3.0, fz, 0xffd07a, 0.5, 9);

    // ---- CUSTOMS BOOTH (inspector post) : booth + barrier + sign ----
    const cx = 14, cz = -1;
    ctx.box(g, cx, 1.4, cz, 2.4, 2.8, 2.4, ctx.mat(0x223142));    // booth
    ctx.box(g, cx, 2.95, cz, 2.9, 0.4, 2.9, ctx.mat(0x2c3d50));   // roof
    ctx.box(g, cx - 2.4, 0.55, cz + 1.6, 3.0, 0.2, 0.2, ctx.emat(0xff5a3a, 0.6)); // striped barrier arm
    ctx.box(g, cx, 3.5, cz, 2.2, 0.7, 0.16, ctx.emat(0x36e0c8, 0.7)); // CUSTOMS sign
    ctx.solid(cx - 1.3, cz - 1.3, cx + 1.3, cz + 1.3, 0, 2.8);
    ctx.light(cx, 3.4, cz, 0x6ad0ff, 0.5, 10);

    // ---- WINDSOCK : pole + pivoting frustum cone (real wind drives it) ----
    buildWindsock(ctx, g, -7, 9);

    // ---- PAPI ARRAY : 4 emissive lamp units at the real RWY-27 aim point.
    //      Built in LOCAL coords (worldAim - origin) so they sit on the
    //      runway, wherever the apron origin is. ----
    buildPapi(ctx, g, o);

    // ---- DESTINATION BEACONS : a tall lit column at each outstation ----
    DESTS.forEach((d) => {
      const lx = d.x - o.x, lz = d.z - o.z;
      const m = new THREE.MeshLambertMaterial({ color: d.col, emissive: d.col, emissiveIntensity: 0.9 });
      const col = new THREE.Mesh(new THREE.BoxGeometry(2.2, 46, 2.2), m);
      col.position.set(lx, 23, lz); g.add(col);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(6, 1.4, 6), m);
      cap.position.set(lx, 46, lz); g.add(cap);
    });

    // ---- CAST (real peds via ctx.npc) — queued (arena root may lag a site
    //      venue) and drained on the first tick, exactly like racing.js. ----
    venue._cast = [
      { role: "dispatcher", key: "DISPATCH", outfit: "worker", name: "Dispatch — Marla", at: [0, 1.0], face: Math.PI, post: "pinned", pose: "stand",
        dialogue: ["Board's fresh. Legit keeps the lights on; hot pays the note.", "Twelve grand on that plane, rook. The bank called twice.", "Walk the jet before you fly her. She's old."] },
      { role: "inspector", key: "CUSTOMS", outfit: "security", name: "Inspector Vann", at: [14, 1.6], face: -Math.PI / 2, post: "pinned", pose: "foldarms",
        dialogue: ["Keep it clean tonight.", "Manifest or a reason. Your choice.", "I remember faces. And tail numbers."] },
      { role: "fueler", key: "FUEL", outfit: 0xffc81f, name: "Fueler — Bo", at: [-14, 1.3], face: 0, post: "pinned", pose: "stand",
        dialogue: ["Topped her off. Didn't look in the back.", "Wind's up tonight — mind the sock on final.", "Vann's in a mood. Bring cash if you're dirty."] },
    ];
    venue._pendingCast = true;
    tryDrainCast(ctx, venue);

    // ---- ZONES (interactions) ----
    ctx.zone({ id: "desk", label: () => (R.job && R.delivered ? "Collect at the charter desk" : "REDEYE charter desk"), pos: [0, 1.6], r: 2.4, onUse: openBoard });
    ctx.zone({ id: "fuel", label: "Fueler — wind & heat brief", pos: [-14, -3.4], r: 2.6, onUse: openFuelBrief });
    ctx.zone({ id: "customs", label: "Customs booth", pos: [14, 1.4], r: 2.4, onUse: () => note("Inspector Vann only cares when you come home heavy.", 2.4) });

    // walkaround stations around the parked charter jet — only when a run is
    // accepted, on foot, pre-delivery. Positions key off the nearest charter
    // jet's real parked pose (resolved lazily).
    for (let i = 0; i < 4; i++) registerStation(ctx, i);

    // board zone at the charter jet
    ctx.zone({
      id: "boardjet", label: "Board N407RD & fly the run", r: 5.5,
      pos: stationBasePos(),
      canShow: () => !!(R.job && !R.delivered && CBZ.player && !CBZ.player._aircraft),
      onUse: boardCharter,
    });
  }

  // the fueler's pre-flight brief: tonight's wind + the customs heat on a hot run
  function openFuelBrief() {
    const s = bag();
    const j = R.job;
    let heat = "No run loaded — take one at the desk.";
    if (j) {
      heat = "Wind " + windStr() + ". " + (j.hot
        ? "This one's HOT. Customs pull odds ~" + Math.round(inspectionChance(true) * 100) + "% on the ramp home. Bring the bribe money."
        : "Clean cargo — customs won't blink.");
    }
    C.hud.panel(head("FUELER — BO", "pre-flight brief"),
      "<div style='margin:4px 0;font-size:13px'>" + esc(heat) + "</div>" +
      "<div style='font-size:11px;opacity:.7'>She's fuelled and ready. Watch the sock on final — the crosswind will walk you off the centreline.</div>" +
      btn("close", "Thanks, Bo", "#26343c"), { close: () => C.hud.closePanel() });
  }

  // the parked charter jet's world position (nearest private jet), for the
  // board zone + walkaround stations. Resolved lazily; falls back to a fixed
  // apron spot south of the desk.
  function charterWorld() {
    const rec = R.charterRec || nearestCharterRec();
    if (rec && rec.pos) { R.charterRec = rec; return { x: rec.pos.x, z: rec.pos.z, h: rec.heading || Math.PI / 2 }; }
    return { x: VENUE ? VENUE.origin.x : 0, z: (VENUE ? VENUE.origin.z : 0) - 28, h: Math.PI / 2 };
  }
  function stationBasePos() {
    // local (relative to origin) of the charter jet
    const w = charterWorld();
    return [w.x - (VENUE ? VENUE.origin.x : 0), w.z - (VENUE ? VENUE.origin.z : 0)];
  }
  const STATION_OFF = [[4.4, 0], [0.6, -6.2], [0.6, 6.2], [-5.2, 0]];   // nose, Lwing, Rwing, tail (plane-local)
  function stationWorld(i) {
    const w = charterWorld(), s = Math.sin(w.h), c = Math.cos(w.h);
    const fx = STATION_OFF[i][0], fz = STATION_OFF[i][1];
    return { x: w.x + s * fx + c * fz, z: w.z + c * fx - s * fz };
  }
  function registerStation(ctx, i) {
    ctx.zone({
      id: "walk" + i,
      label: () => "Inspect " + STATION_NAMES[i] + (R.job && R.job.stations[i] ? " (checked)" : ""),
      // position is recomputed live via a getter-like find isn't available;
      // stations sit at build-time-resolved local offsets around the jet.
      pos: (function () { const w = stationWorld(i); return [w.x - (VENUE ? VENUE.origin.x : 0), w.z - (VENUE ? VENUE.origin.z : 0)]; })(),
      r: 2.4,
      canShow: () => !!(R.job && !R.delivered && R.phase === "preflight" && (!CBZ.player || !CBZ.player._aircraft)),
      onUse: () => inspectStation(i),
    });
  }

  function buildWindsock(ctx, g, lx, lz) {
    ctx.box(g, lx, 3.0, lz, 0.3, 6.0, 0.3, ctx.mat(0x8a9099));   // pole
    ctx.solid(lx - 0.25, lz - 0.25, lx + 0.25, lz + 0.25, 0, 6.0);
    const pivot = new THREE.Group();
    pivot.position.set(lx, 5.7, lz); g.add(pivot);
    // cone: a horizontal frustum striped orange/white, hung so it can lift
    const cone = new THREE.Group(); pivot.add(cone);
    const m1 = new THREE.MeshLambertMaterial({ color: 0xff7a1a, emissive: 0xff7a1a, emissiveIntensity: 0.25 });
    const m2 = new THREE.MeshLambertMaterial({ color: 0xf2f2f2, emissive: 0xf2f2f2, emissiveIntensity: 0.2 });
    for (let k = 0; k < 4; k++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.62 - k * 0.09, 0.7 - k * 0.09, 0.7, 10), k % 2 ? m2 : m1);
      seg.rotation.z = Math.PI / 2; seg.position.set(0.4 + k * 0.72, 0, 0); cone.add(seg);
    }
    R.sock = { pivot, cone };
  }

  function buildPapi(ctx, g, o) {
    R.lampMats = [];
    const baseLx = AIM.x - o.x, baseLz = AIM.z - o.z + 18;    // just south of the runway edge, abeam touchdown
    for (let i = 0; i < 4; i++) {
      const lx = baseLx, lz = baseLz + i * 3.4;
      ctx.box(g, lx, 0.5, lz, 0.9, 1.0, 0.7, ctx.mat(0x14161a));   // housing
      const m = new THREE.MeshLambertMaterial({ color: 0x141414, emissive: 0x141414, emissiveIntensity: 0.15 });
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.5), m);
      lamp.position.set(lx, 1.0, lz); g.add(lamp);
      R.lampMats.push(m);
    }
  }

  /* NPC cast draining (mirrors racing.js/casino.js: real peds need the live
     arena; a site venue usually mounts after the world is up). */
  function arenaLive() { return !!(CBZ.city && CBZ.city.arena && CBZ.city.arena.root); }
  function tryDrainCast(ctx, venue) {
    if (!venue._pendingCast) return;
    if (ctx.npc && !arenaLive() && !(venue.group && venue.group.parent)) return;
    venue._pendingCast = false;
    venue._npcs = [];
    for (const spec of (venue._cast || [])) {
      const h = ctx.npc(spec);
      if (h) { venue._npcs.push(h); if (spec.key === "CUSTOMS") CUSTOMS = h; if (spec.key === "DISPATCH") DISPATCH = h; }
    }
  }

  /* ============================================================
     REGISTER
  ============================================================ */
  CBZ.games.register({
    id: "airport", title: "REDEYE INTERNATIONAL",
    // the airport is a LANDMASS — anchor on the apron once island_airport has
    // published its audit (contract #8). Retried lazily until the island
    // exists; returns null (never mounts) in a world without an airport.
    venue: {
      site: "airport",
      resolve: function (CBZ) {
        const A = CBZ.city && CBZ.city.arena; if (!A) return null;
        if (A.airportAudit && A.airportAudit.bounds) {
          // apron east of the terminal, near the parked private jets & spawn
          // (95+dx — the jets themselves ride the airport's world-layout dial)
          return { x: 95 + _WOFF.dx, z: 22 + _WOFF.dz };
        }
        const regs = A.regions || (CBZ.city && CBZ.city.regions) || [];
        const has = regs.some((r) => r && (r.biome === "airport" || /airport|halloran/i.test(r.name || "")));
        return has ? { x: 95 + _WOFF.dx, z: 22 + _WOFF.dz } : null;
      },
    },
    build: build,
    update: function (ctx, dt) { if (ctx.venue && ctx.venue._pendingCast) tryDrainCast(ctx, ctx.venue); update(ctx, dt); },

    /* probe surface — the gate asserts THROUGH these without flying */
    api: {
      rules: { ECON, PAPI_T, DESTS, papiAt, simLanding, payoutFor, fineFor, bribeCostFor, bribeOdds, inspectionChance },
      // deterministic outcome control for the gate
      rig: function (arr) { if (Array.isArray(arr)) for (const v of arr) rigQueue.push(v); return rigQueue.length; },
      papiAt, simLanding, payoutFor, fineFor, bribeCostFor, bribeOdds,
      resolveBribe: function (mood, payout) { return resolveBribe(mood, payout); },
      strike: function (why) { return strike(why || "rigged violation"); },
      board: function () { return R.board.map((j) => ({ id: j.id, name: j.name, destId: j.destId, hot: j.hot, cargoKg: j.cargoKg, payout: j.payout, defect: j.defect })); },
      rollBoard: function () { rollBoard(); return this.board(); },
      accept: function (i) { acceptJob(R.board[i | 0]); return R.job ? { id: R.job.id, hot: R.job.hot, destId: R.job.destId, payout: R.job.payout } : null; },
      // force live arc state for a gate (strikes / debt / delivered / rating)
      set: function (o2) {
        o2 = o2 || {}; const b = bag();
        if (o2.strikes != null) b.strikes = o2.strikes | 0;
        if (o2.debt != null) b.debt = o2.debt | 0;
        if (o2.ending !== undefined) b.ending = o2.ending;
        if (o2.delivered != null) R.delivered = !!o2.delivered;
        save(); return this.state();
      },
      grade: function (sink) { R.delivered = true; R.landingRating = null; gradeLanding(Math.abs(sink || 0), HOME.minX + 1, HOME.minZ + 1); return R.landingRating; },
      state: function () {
        const b = bag();
        return {
          debt: b.debt, strikes: b.strikes, ending: b.ending || null, endReason: b.endReason || "",
          phase: R.phase, delivered: R.delivered, jobHot: !!(R.job && R.job.hot),
          job: R.job ? { id: R.job.id, destId: R.job.destId, payout: R.job.payout, defect: R.job.defect } : null,
          landingRating: R.landingRating ? R.landingRating.rating : null,
          wind: { dir: +R.wind.dir.toFixed(1), speed: +R.wind.speed.toFixed(2) },
          aim: { x: AIM.x, z: AIM.z }, home: HOME,
          stats: { runs: b.runs, bestRating: b.bestRating, bribes: b.bribes, earned: b.earned, spent: b.spent, titles: b.titles },
        };
      },
      open: function () { openBoard(); },
      cast: function () { return VENUE && VENUE._npcs ? VENUE._npcs.length : 0; },
      reset: function () { const b = bag(); b.debt = ECON.DEBT0; b.strikes = 0; b.ending = null; b.endReason = ""; save(); R.job = null; R.delivered = false; R.inspection = null; R.phase = "idle"; rigQueue.length = 0; rollBoard(); return this.state(); },
    },
  });
})();
