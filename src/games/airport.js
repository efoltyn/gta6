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

   THE ARC: ask Marla at the charter desk about work and she tells you ONE
   run at a time (legit cargo, low pay / HOT cargo, big pay + customs heat);
   take it and she hands you the manifest → optional preflight WALKAROUND
   (a seeded defect hides on the airframe — skip it and it bites in the
   air) → board the real private jet and fly to the destination anchor →
   fly the run home and shoot RUNWAY 27 on the PAPI (4 emissive lamps
   computed from the craft's REAL altitude/distance vs the glideslope —
   genuinely honest) → the touchdown is RATED off the real sink rate the
   physics reports (craft.lastTouchdown.sink) → Marla pays you in REAL city
   cash at the desk, unless customs flags a hot run: then Inspector Vann
   wants you first, and you let him look (a fine and a strike) or slip him
   a bribe at mood-driven odds. Three strikes and the license is pulled
   (Marla takes the application for a new one). Pay the plane's $12k note
   down to zero and it's YOURS — the win.

   NO PANEL. Everything here is asked of a person or written on paper: the
   desk, the fueler and the customs officer are real peds with their asks
   on them (and on their spots), the manifest and the plane's note are
   sheets you hold (city/paper.js), pay and fines pass hand to hand.

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
  // people talk over their own heads, in breaths (systems/speech.js cuts a
  // line to a few words; CBZ.speech.lines says a longer one piece by piece
  // and a new line from the same mouth replaces what he was saying). The
  // tower and the dispatcher on the radio sit by the player's hand.
  function sayBy(h, line) {
    if (!h || !line) return false;
    const p = h.ped, Sp = CBZ.speech;
    if (p) { if (p.dead || !Sp || !Sp.lines) return false; Sp.lines([{ by: p, line: line }]); return true; }
    if (h.say) { h.say(line, 3.0); return true; }      // the bare-harness dummy
    return false;
  }
  function radio(line) { const Sp = CBZ.speech; if (Sp && Sp.lines && line) Sp.lines([{ by: "phone", line: line }]); }
  // is this cast member there to deal with (posted, and not shot)
  function up(h) { return !!(h && (h.ped ? !h.ped.dead : true)); }
  // a label that prints as written (city/verbword.js would cut it to its verb)
  function asIs(s) { const VW = CBZ.cityVerbWord; if (VW && VW.keep) VW.keep(s); return s; }
  // money or paper passing between you and him: the reach, then what it does
  function handed(h, then) {
    const p = h && h.ped, Vb = CBZ.verbs;
    let S0 = null, done = false;
    const fin = function () { if (done) return; done = true; then(); };
    if (p && !p.dead && Vb && Vb.takeFrom) { try { S0 = Vb.takeFrom(CBZ.player, p, { at: "wristR", kind: "cash", pose: "card", dur: 0.55, onTaken: fin }); } catch (e) { S0 = null; } }
    if (!S0) fin();
  }

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
  // WHERE REDEYE STANDS: on the GA ramp at the east end of the apron, BEHIND
  // the tails of the two parked private jets (city/island_airport.js parks
  // them at 240+dx, z -64 and -32, noses south). Behind them is the one side a
  // jet never rolls or swings through on its way out, and the desk is a
  // twenty-metre walk from the charter bird. It rides the airport's
  // world-layout dial with the jets. (It used to mount at 95+dx, z 22: since
  // the terminal grew that is the middle of the landside taxi rank, with the
  // airside fence and 150 m between the desk and the plane it sends you to.)
  // The sea DESTS below stay absolute (open-water beacons, not landmass
  // furniture); dist re-derives from the moved apron.
  const _WOFF = (CBZ.worldOff && CBZ.worldOff("airport")) || { dx: 0, dz: 0 };
  const RAMP = { x: 242 + _WOFF.dx, z: -86 + _WOFF.dz };      // the venue's origin (the desk)
  // venue-local x of the fuel truck and the customs booth, kept inside the
  // ramp's width (the apron ends 11 m east of the desk)
  const FUEL_X = -9.5, CUSTOMS_X = 8.5;
  const APRON_REF = RAMP;                                     // airfield reference the run distance is measured from
  const DESTS = [
    // SALT CAY moved west (-40 → -520): the snow island now parks at
    // z≈-1920..-2580 (world/worldplan.js snow offset), and the old spot put this
    // "open-water" beacon on the alpine tundra. (-520,-2050) is the permanent
    // sea channel between the forest's north shore and the Greater Mercy
    // envelope — open water at every dial setting.
    { id: "salt",    name: "Salt Cay",     x: -520,  z: -2050, col: 0xffb03a },
    { id: "marlin",  name: "Marlin Rock",  x: -1650, z: -900,  col: 0x36e0c8 },
    { id: "pelican", name: "Pelican Reef", x: 980,   z: -1650, col: 0xff5ad0 },
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
  // ending: null, or "LOSE" while the license is pulled. (A paid-off plane is
  // not an ending: debt 0 and you keep flying her. Old saves said "WIN".)
  function bag() {
    if (S) return S;
    S = C.state(() => ({
      debt: ECON.DEBT0, strikes: 0, ending: null,
      runs: 0, onTime: 0, bestVs: null, bestRating: "none",
      bribes: 0, bribesPaid: 0, earned: 0, spent: 0, titles: 0,
    }));
    if (S.ending === "WIN") S.ending = null;
    return S;
  }
  function save() { if (C) C.saveState(); }

  const R = {
    job: null,                 // active job or null
    board: [],                 // 3 offered jobs
    boardN: 0,
    phase: "idle",             // idle|preflight|outbound|returning|inbound|arrived
    delivered: false,
    wind: { dir: 0, speed: 3 },
    inspection: null,          // {mood, resolved, met} once customs flags a hot run
    mood: null,                // Vann's mood tonight (0 foul .. 1 easy), set when hot cargo goes aboard
    airborneT: 0, defectFired: false,
    landingRating: null,       // set at the home touchdown
    lampMats: null,            // 4 PAPI lamp materials
    sock: null,                // {pivot, cone}
  };
  // Both fallbacks self-heal from the live airportAudit at build(), but they
  // ride the dial too so even the audit-lag window points at the MOVED field.
  const AIM = { x: 170 + _WOFF.dx, z: -220 + _WOFF.dz };  // RWY-27 touchdown aim point (overwritten from the real audit)
  let HOME = { minX: -900 + _WOFF.dx, maxX: 290 + _WOFF.dx, minZ: -280 + _WOFF.dz, maxZ: 40 + _WOFF.dz };
  let RUN_HEADING = -Math.PI / 2;            // RWY 27 = land west

  /* -------- jobs -------- */
  // cargo as Marla says it and as it is typed on the manifest
  const JOB_NAMES_LEGIT = ["Mail sacks", "Medical coolers", "Engine parts", "Dive gear", "Generator coils"];
  const JOB_NAMES_HOT = ["Unmarked crates", "Fish on ice", "Sealed drums", "Quiet boxes", "Spare parts"];
  // defect i hides at station i
  const DEFECT_NAMES = ["Oil leak at the nose", "Flap hinge cracked", "Fuel cap left open", "Play in the elevator"];
  const STATION_NAMES = ["Nose", "Left wing", "Right wing", "Tail"];

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
    // the desk always tempts you: one of the three is hot, priced as hot
    if (!R.board.some((j) => j.hot)) {
      const j = R.board[2];
      j.hot = true; j.id = j.id.slice(0, -1) + "H";
      j.name = JOB_NAMES_HOT[Math.floor(nextRand() * JOB_NAMES_HOT.length)];
      j.payout = payoutFor(j.destId, true, j.cargoKg);
    }
    PITCH.i = -1;
  }
  function rollWind() { return { dir: nextRand() * 360, speed: 1 + nextRand() * 8 }; }
  function destOf(j) { return DESTS.find((k) => k.id === (j && j.destId)) || DESTS[0]; }
  // compass heading to fly from the apron (north is -z, east is +x)
  function headingTo(d) {
    const deg = Math.round(Math.atan2(d.x - APRON_REF.x, -(d.z - APRON_REF.z)) / D2R / 5) * 5;
    return ("00" + (((deg % 360) + 360) % 360 || 360)).slice(-3);
  }
  function windStr() {
    const d = Math.round(R.wind.dir / 10) * 10 || 360;
    return ("00" + d).slice(-3) + " at " + Math.round(R.wind.speed * 1.94) + " kt";
  }

  /* ============================================================
     ARC BOOKKEEPING — strikes / debt / the pulled license, all against the
     persisted bag so a career survives a session. Real cash flows through
     ctx.wallet. Nothing here is announced on a card: whoever caused it SAYS
     it (Vann at his booth, the tower on the radio, Marla at her desk).
  ============================================================ */
  const NTH = ["", "one", "two", "three"];
  function strike(reason) {
    const s = bag();
    if (s.ending) return s.strikes;
    s.strikes++;
    if (s.strikes >= 3) pullLicense(reason);
    save();
    return s.strikes;
  }
  // what a strike sounds like, from whoever is writing you up
  function strikeWords(n) { return n >= 3 ? "That's three. Your license is pulled." : "That's strike " + NTH[n] + " on your ticket."; }
  function pullLicense(why) {
    const s = bag();
    if (s.ending) return;
    s.ending = "LOSE"; s.endReason = "License pulled: " + why;
    save();
    endRun();                                 // whatever was in the air is over
  }
  function relicense() {
    const s = bag();
    s.strikes = 0; s.ending = null; s.endReason = ""; save();
    rollBoard();
    sayBy(DISPATCH, "Sign there. Clean ticket. Don't make me file this twice.");
  }
  function payDebt(n) {
    const s = bag();
    n = Math.min(n, s.debt);
    if (n <= 0) return;
    if (C.wallet.cash() < n || !C.wallet.spend(n, "Paid down N407RD")) { sayBy(DISPATCH, "You're short. Fly a run first."); return; }
    s.debt = Math.max(0, s.debt - n); s.spent += n;
    const paidOff = s.debt <= 0;
    if (paidOff) s.titles++;
    save();
    sayBy(DISPATCH, paidOff ? "That's the last of it. Four-oh-seven is yours, free and clear."
      : fmt$(n) + " off the note. " + fmt$(s.debt) + " to go.");
    handed(DISPATCH, function () { if (CBZ.sfx) CBZ.sfx("coin"); if (paidOff) notePaper(); });
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
     COLLECT — Marla pays a returned run, unless customs has flagged it:
     then Vann wants you at his booth first. Legit clears; hot rolls him.
  ============================================================ */
  function inspectionDue() { return !!(R.job && R.delivered && R.inspection && !R.inspection.resolved); }
  function collectRun() {
    const j = R.job; if (!j || !R.delivered) return;
    if (inspectionDue()) { sayBy(DISPATCH, "Vann first. I can't pay out till customs clears you."); return; }
    let waved = false;
    if (!R.inspection) {
      // the customs roll happens once, on the run's return. Nobody at the
      // booth (Vann is dead) = nobody to pull you.
      if (j.hot && up(CUSTOMS) && nextRand() < inspectionChance(true)) {
        R.inspection = { mood: R.mood != null ? R.mood : nextRand(), resolved: false, met: false };
        sayBy(DISPATCH, "Hold on. Vann's flagged your tail number. See him before I pay you.");
        return;
      }
      // a legit run gets a cursory look: always clears, no stakes
      if (!j.hot && nextRand() < inspectionChance(false)) waved = true;
    }
    payOut(waved);
  }
  // the run is over (paid, seized or abandoned): clear it, fresh work on the desk
  function endRun() {
    R.job = null; R.delivered = false; R.inspection = null; R.mood = null;
    R.phase = "idle"; R.landingRating = null;
    rollBoard();
  }
  function payOut(waved) {
    const j = R.job, s = bag(); if (!j) return;
    const rating = R.landingRating ? R.landingRating.rating : null;
    const land = R.landingRating && R.landingRating.bonus ? R.landingRating.bonus : 0;
    const pay = j.payout + land;
    s.runs++; s.earned += pay; save();
    sayBy(DISPATCH, (waved ? "Customs waved you through. " : "") + fmt$(j.payout) + " for the " + j.name.toLowerCase() + "." +
      (land ? " And " + fmt$(land) + " more for setting her down like that." : rating === "HARD" ? " Go easier on her next time." : ""));
    C.wallet.give(pay, "REDEYE run: " + j.name);          // yours the moment she counts it out; the reach is the handing over
    handed(DISPATCH, function () { if (CBZ.sfx) CBZ.sfx("coin"); });
    endRun();
  }
  // customs keeps the cargo: the run is flown, nothing is paid
  function seizeRun() { bag().runs++; save(); endRun(); }

  /* ============================================================
     THE JET IS THE THING. The parked private jet is already a target in the
     world (the "milvehicle" candidate, city/militaryvehicles.js: F steals
     her, with heat). A zone on or beside a hull is a second candidate and is
     always shadowed by the hull's own (island_airport.js found the same with
     the airliner's door; the old "Board N407RD" zone and the four walkaround
     zones never got the card). So the charter's verbs ride the jet's own
     layer. With a run in hand:
       F  Board      a clean board of the real parked model (no theft, no
                     heat: CBZ.citySpawnFlyableFromProp, the real flight
                     physics, no fork). Without a run F is still Steal.
       E  Look over  the part of her you are standing at: nose, left wing,
                     right wing, tail. The run's seeded defect hides at one;
                     find it and E again pays for the fix, or skip the walk
                     and it bites ~15 s after liftoff.
     The charter bird is the nearest private jet still parked.
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
  function isCharter(v) { return !!v && !!VENUE && v === nearestCharterRec(); }
  function onFoot() { const P = CBZ.player; return !!P && !P._aircraft && !P.driving; }
  function boardCharter(rec) {
    if (!R.job || !onFoot()) return;
    rec = rec || nearestCharterRec();
    if (!rec || !CBZ.citySpawnFlyableFromProp) return;      // no clean board: her own Steal still carries it
    if (CBZ.citySpawnFlyableFromProp(rec)) radio("Cargo's aboard. You're on your own.");
  }

  // where each part of her is: [metres ahead of the jet's centre, metres to
  // its right]. The parked bizjet is a nose-along-X model, so at heading h
  // the nose points (cos h, -sin h) and the right wing (sin h, cos h). (The
  // old zones read the heading as a nose-along-Z yaw: "NOSE" hung off a wingtip.)
  const STATION_OFF = [[9.6, 0], [-3.6, -8.6], [-3.6, 8.6], [-8.4, 0]];   // nose, Lwing, Rwing, tail
  function nearStation(v) {
    const P = CBZ.player; if (!P || !v || !v.pos) return 0;
    const h = v.heading || 0, c = Math.cos(h), s = Math.sin(h);
    const dx = P.pos.x - v.pos.x, dz = P.pos.z - v.pos.z;
    const a = dx * c - dz * s, b = dx * s + dz * c;
    let best = 0, bd = 1e9;
    for (let i = 0; i < 4; i++) { const d = Math.hypot(a - STATION_OFF[i][0], b - STATION_OFF[i][1]); if (d < bd) { bd = d; best = i; } }
    return best;
  }
  function walkOpen(v) {
    const j = R.job;
    if (!j || R.delivered || R.phase !== "preflight" || !onFoot()) return false;
    const i = nearStation(v);
    return !j.stations[i] || (j.defect === i && !j.defectFixed);
  }
  // what E says at the part you are standing at. A fault you have found is
  // named on the verb that fixes it (city.note is a phone push now, not a
  // toast: there is nowhere else to say what you saw).
  const FIX_NAMES = ["Fix the oil leak", "Fix the flap hinge", "Close the fuel cap", "Fix the elevator play"];
  function walkLabel(v) {
    const j = R.job, i = nearStation(v);
    return j && j.fixArmed && j.defect === i && !j.defectFixed ? FIX_NAMES[i] + ", " + fmt$(ECON.FIX_DEFECT) : "Look over the " + STATION_NAMES[i].toLowerCase();
  }
  function inspectStation(i) {
    const j = R.job; if (!j) return;
    if (j.defect === i && !j.defectFixed) {
      j.defectFound = true;
      if (!j.fixArmed) { j.fixArmed = true; if (CBZ.sfx) CBZ.sfx("hit"); return; }      // found: the card now offers the fix
      if (!C.wallet.spend(ECON.FIX_DEFECT, "Fixed: " + DEFECT_NAMES[i].toLowerCase())) { radio("Parts are " + fmt$(ECON.FIX_DEFECT) + ". You don't have it."); return; }
      j.defectFixed = true; j.stations[i] = true; j.fixArmed = false;
      if (CBZ.sfx) CBZ.sfx("coin");
      return;
    }
    j.stations[i] = true;                        // clean: the verb is done and leaves the card
  }
  let jetWired = false;
  function wireJet() {
    const I = CBZ.interactions;
    if (jetWired || !I || !I.register) return;
    jetWired = true;
    I.register("milvehicle", {
      id: "redeye-board", slot: "i", ride: true, prio: 2, campaignSafe: true, label: "Board",
      canShow: (v) => !!(R.job && !R.delivered) && onFoot() && isCharter(v),
      onSelect: (v) => boardCharter(v),
    });
    I.register("milvehicle", {
      id: "redeye-walk", slot: "e", prio: 1, campaignSafe: true, forceYes: true,
      label: (v) => asIs(walkLabel(v)),
      canShow: (v) => isCharter(v) && walkOpen(v),
      onSelect: (v) => inspectStation(nearStation(v)),
    });
  }

  /* ============================================================
     THE DESK, THE FUELER, THE INSPECTOR — no panel.
     OWNER: "No dashboards are needed. Everything can be existing."

     This used to be an HTML panel at the bottom of the screen: a three-row
     job board with TAKE buttons, a "BOARD & FLY / Abandon" card, a COLLECT
     card, a CUSTOMS card with the bribe odds printed on the button, and a
     career-stats ending card. Now:
       MARLA (the dispatcher behind the charter counter) tells you ONE run
         at a time: what, where, how heavy, what it pays. Your answers are on
         her: Take it / What else. Taking it, she hands you the manifest (a
         sheet you hold; a hot run is a scrap in her handwriting). She pays
         you over the counter when you are back, takes money against the
         plane's note, turns the note round for you to read, and takes the
         application when your license is pulled.
       BO (the fueler) reads you the wind off the sock and tells you what
         mood Vann is in tonight: that mood IS the bribe's odds.
       VANN (the inspector) is who you deal with when customs flags a hot
         run: let him look in the back (fine + strike, cargo seized) or slip
         him cash. Nobody prints a percentage; his mood is in his words.
     The same asks hang on each person (I J K L, CBZ.interactions.registerFor)
     and on the spot they work at (E / hold E / the wheel, ctx.zone verbs).
  ============================================================ */
  // ---- Marla's pitch: one run off her board at a time; walking off is no ----
  const PITCH = { i: -1 };
  function pitched() {
    if (PITCH.i < 0 || R.job || !R.board.length) return null;
    const P = CBZ.player;
    if (P && VENUE && Math.hypot(P.pos.x - VENUE.origin.x, P.pos.z - VENUE.origin.z) > 9) { PITCH.i = -1; return null; }
    return R.board[PITCH.i % R.board.length];
  }
  function pitchSay(j) {
    const d = destOf(j);
    sayBy(DISPATCH, j.name + " for " + d.name + ". " + j.cargoKg + " kilos. " + fmt$(j.payout) + "." + (j.hot ? " No paper on it." : ""));
  }
  function pitchStart() {
    if (bag().ending) { sayBy(DISPATCH, "Your ticket's pulled. I can't put you on anything."); return; }
    if (!R.board.length) rollBoard();
    PITCH.i = 0;
    pitchSay(R.board[0]);
  }
  function pitchNext() {
    if (!pitched()) return;
    if (R.board.length < 2) { sayBy(DISPATCH, "That's all I've got tonight."); return; }
    PITCH.i = (PITCH.i + 1) % R.board.length;
    pitchSay(R.board[PITCH.i]);
  }

  function acceptJob(j) {
    if (!j || bag().ending) return;
    R.job = j; R.delivered = false; R.inspection = null; R.phase = "preflight";
    R.airborneT = 0; R.defectFired = false; R.landingRating = null;
    R.wind = rollWind();
    // Vann's mood tonight is settled the moment hot cargo goes aboard: Bo can
    // tell you what it is before you fly, and it is the bribe's odds after
    R.mood = j.hot ? nextRand() : null;
    R.board = R.board.filter((k) => k !== j);
    PITCH.i = -1;
    const d = destOf(j);
    sayBy(DISPATCH, j.hot ? "No manifest on this one. You didn't get it from me." : "Walk the jet, then take it to " + d.name + ".");
    handed(DISPATCH, manifestPaper);
  }
  function abortRun() {
    if (!R.job || R.delivered) return;
    endRun();
    sayBy(DISPATCH, "Your call. It goes back in the pile.");
  }

  // ---- the papers (city/paper.js: a sheet in your hands) ----
  function manifestPaper() {
    const K = CBZ.cityPaper, j = R.job; if (!K || !j) return;
    const d = destOf(j);
    if (j.hot) {
      // nothing typed, nothing signed: what she scribbled for you
      K.show({ key: "redeye-run", hand: true, lines: [
        { text: j.name + ", " + j.cargoKg + " kg. N407RD." },
        { text: d.name + ". Fly " + headingTo(d) + " off the field, low over the light." },
        { text: "Wind " + windStr() + "." },
        { text: fmt$(j.payout) + " when you are back." },
        { gap: 12 },
        { text: "No manifest. If customs asks, it was aboard when you got her.", italic: true },
      ] });
      return;
    }
    K.show({ key: "redeye-run", org: "Redeye Charter", title: "CARGO MANIFEST", ink: "#3a2c0c", lines: [
      { k: "AIRCRAFT", v: "N407RD" },
      { k: "CARGO", v: j.name },
      { k: "WEIGHT", v: j.cargoKg + " kg" },
      { k: "DELIVER TO", v: d.name, big: true },
      { k: "HEADING OFF THE FIELD", v: headingTo(d) },
      { k: "WIND", v: windStr() },
      { k: "PAYS ON RETURN", v: fmt$(j.payout), big: true },
    ], foot: "Low and slow over the outstation light, then home to runway 27. Collect at the desk.", sign: "Marla" });
  }
  function notePaper() {
    const K = CBZ.cityPaper, s = bag(); if (!K) return;
    K.show({ key: "redeye-note", org: "Redeye Charter", title: "AIRCRAFT NOTE", ink: "#3a2c0c", lines: [
      { k: "AIRCRAFT", v: "N407RD" },
      { k: "OWED ON THE NOTE", v: fmt$(s.debt), big: true },
      { k: "PILOT LICENSE", v: s.ending === "LOSE" ? "pulled" : s.strikes ? s.strikes + " of 3 strikes" : "clean" },
      { gap: 14 },
      { k: "RUNS FLOWN", v: String(s.runs) },
      { k: "BEST LANDING", v: s.bestVs != null ? s.bestRating + ", " + s.bestVs.toFixed(1) + " m/s" : "none yet" },
      { k: "PAID TO YOU", v: fmt$(s.earned) },
    ], foot: s.debt > 0 ? "Pay the note to nothing and the aircraft is yours." : "Title released to the pilot.",
      stamp: s.debt <= 0 ? "PAID IN FULL" : null, sign: "Marla" });
  }

  // ---- what you can say to Marla, best first ----
  const MARLA_ASKS = [
    { id: "collect", key: "e", label: () => "Collect " + fmt$(R.job ? R.job.payout : 0), show: () => !!(R.job && R.delivered), run: collectRun },
    { id: "license", key: "e", label: () => "Apply for a new license", show: () => bag().ending === "LOSE", run: relicense },
    { id: "take", key: "e", label: () => "Take it", show: () => !!pitched(), run: () => acceptJob(pitched()) },
    { id: "ask", key: "e", label: () => "Ask about work", show: () => !R.job && !pitched() && !bag().ending, run: pitchStart },
    { id: "next", key: "hold", label: () => "What else", show: () => !!pitched(), run: pitchNext },
    { id: "manifest", key: "e", label: () => (R.job && R.job.hot ? "Read her note again" : "Read the manifest"), show: () => !!(R.job && !R.delivered), run: manifestPaper },
    { id: "pay500", key: "wheel", label: () => "Pay " + fmt$(Math.min(500, bag().debt)) + " on the plane", show: () => bag().debt > 0, run: () => payDebt(500) },
    { id: "payoff", key: "wheel", label: () => "Pay off the plane, " + fmt$(bag().debt), show: () => bag().debt > 500 && C.wallet.cash() >= bag().debt, run: () => payDebt(bag().debt) },
    { id: "note", key: "wheel", label: () => "Ask what you owe", show: () => true, run: () => {
      const s = bag();
      sayBy(DISPATCH, s.debt > 0 ? fmt$(s.debt) + " still on four-oh-seven." + (s.strikes ? " And " + NTH[s.strikes] + (s.strikes > 1 ? " strikes" : " strike") + " on your ticket." : "")
        : "Nothing. She's yours.");
      handed(DISPATCH, notePaper);
    } },
    { id: "abandon", key: "wheel", bad: true, label: () => "Abandon the run", show: () => !!(R.job && !R.delivered), run: abortRun },
  ];

  // ---- what you can ask Bo ----
  function windSpoken() {
    const d = ("00" + (Math.round(R.wind.dir / 10) * 10 || 360)).slice(-3).split("").map((c) => ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "niner"][+c]).join(" ");
    return d + " at " + Math.round(R.wind.speed * 1.94) + " knots";
  }
  const BO_ASKS = [
    { id: "wind", key: "e", label: () => "Ask about the wind", show: () => true, run: () => {
      sayBy(FUEL, "Wind's " + windSpoken() + ". " + (R.wind.speed > 5 ? "It'll push you off the line. Watch the sock." : "Sock's barely lifting."));
    } },
    { id: "vann", key: "hold", label: () => "Ask about Vann", show: () => true, run: () => {
      const m = R.mood;
      sayBy(FUEL, !R.job ? "Vann? Only bites when you come home heavy."
        : !R.job.hot || m == null ? "Clean paper tonight. He's got nothing on you."
          : m < 0.34 ? "Face like thunder all shift. I wouldn't offer him a thing."
            : m < 0.67 ? "He's Vann. Might take it, might write you up."
              : "Half asleep an hour ago. He'd take a folded bill.");
    } },
  ];

  // ---- Vann, when customs has flagged your run ----
  // what he SAYS as you walk up; his mood is in the words, not narrated
  function moodLine(m) {
    if (m < 0.34) return "Manifest. Now.";
    if (m < 0.67) return "Evening. Papers, please.";
    return "Slow night. Whatcha hauling?";
  }
  function bribeVann() {
    const j = R.job, ins = R.inspection; if (!j || !inspectionDue()) return;
    const cost = bribeCostFor(j.payout);
    if (C.wallet.cash() < cost) { sayBy(CUSTOMS, "Is that all you've got on you? Open the hold."); return; }
    const r = resolveBribe(ins.mood, j.payout);
    if (r.accepted) {
      ins.resolved = true;
      sayBy(CUSTOMS, "Wind must've blown that pallet in. Night.");
      handed(CUSTOMS, function () { if (CBZ.sfx) CBZ.sfx("coin"); });
      return;
    }
    sayBy(CUSTOMS, "Bribing an officer. Cargo's seized. " + fmt$(r.fine) + " fine. " + strikeWords(r.strikes));
    handed(CUSTOMS, function () {});
    if (R.job) seizeRun();                     // (a third strike already ended it)
  }
  function submitToVann() {
    const j = R.job; if (!j || !inspectionDue()) return;
    const fine = fineFor(j.payout);
    C.wallet.spend(fine, "Customs fine"); bag().spent += fine; save();
    const n = strike("smuggling, hot cargo and no manifest");
    sayBy(CUSTOMS, j.name + ", no paper. It's seized. " + fmt$(fine) + " fine. " + strikeWords(n));
    handed(CUSTOMS, function () {});
    if (R.job) seizeRun();
  }
  const VANN_ASKS = [
    { id: "bribe", key: "e", label: () => "Slip him " + fmt$(R.job ? bribeCostFor(R.job.payout) : 0), show: inspectionDue, run: bribeVann },
    { id: "submit", key: "hold", label: () => "Let him look in the back", show: inspectionDue, run: submitToVann },
    { id: "idle", key: "e", label: () => "Ask what he's checking", show: () => !inspectionDue(), run: () => sayBy(CUSTOMS, "I only care when you come home heavy.") },
  ];

  // the same asks as rows on a spot (ctx.zone verbs) and on the person himself
  function spotVerbs(asks, who) {
    return asks.map((a) => ({
      id: a.id, slot: a.key === "wheel" ? null : "e", hold: a.key === "hold", wheel: a.key === "wheel", bad: !!a.bad,
      label: () => asIs(a.label()), canShow: () => up(who()) && a.show(), onSelect: () => a.run(),
    }));
  }
  function giveVerbs(h, tag, asks) {
    const I = CBZ.interactions, p = h && h.ped;
    if (!p || p._redeyeVerbs || !I || !I.registerFor) return;
    p._redeyeVerbs = true;
    asks.forEach((a, i) => I.registerFor(p, {
      id: "airport-" + tag + "-" + a.id, prio: 90 - i, bad: !!a.bad, forceYes: true, campaignSafe: true,
      label: () => asIs(a.label()), canShow: (t) => !!t && !t.dead && a.show(), onSelect: () => a.run(),
    }));
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
    // the cast carry their own asks (a person in front of you is the card's
    // target before the spot he works at is)
    giveVerbs(DISPATCH, "marla", MARLA_ASKS); giveVerbs(FUEL, "bo", BO_ASKS); giveVerbs(CUSTOMS, "vann", VANN_ASKS);
    wireJet();

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
          radio("Four-oh-seven, tower. Something just let go on you: " + kind.toLowerCase() + ".");
          // honest consequence: damage the REAL airframe (control authority sags)
          if (CBZ.cityPlayerAircraftDamage) { try { CBZ.cityPlayerAircraftDamage(48, craft.pos.x, craft.pos.z); } catch (e) {} }
        }

        // reached the outstation → delivered, turn for home
        if (!R.delivered && nearDest(craft)) {
          R.delivered = true; R.phase = "returning";
          const d = DESTS.find((k) => k.id === j.destId);
          radio(d.name + " has it. Bring her home, runway two seven.");
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

    // ---------- arrived home on foot → Marla calls you over to be paid ----------
    const P = CBZ.player;
    if (R.phase === "arrived" && R.delivered && !flying()) {
      if (P && VENUE) {
        const dx = P.pos.x - VENUE.origin.x, dz = P.pos.z - VENUE.origin.z;
        if ((dx * dx + dz * dz) < 8 * 8 && !R._collectPrompted) {
          R._collectPrompted = true;
          sayBy(DISPATCH, "There you are. Come and get paid.");
        }
      }
    } else { R._collectPrompted = false; }
    // ---------- customs has flagged the run: Vann speaks as you walk up ----------
    const ins = R.inspection;
    if (ins && !ins.resolved && !ins.met && P && CUSTOMS && CUSTOMS.ped && !flying()) {
      const cp = CUSTOMS.ped.pos;
      if (Math.hypot(P.pos.x - cp.x, P.pos.z - cp.z) < 5.5) { ins.met = true; sayBy(CUSTOMS, moodLine(ins.mood)); }
    }
  }

  function gradeLanding(sink, x, z) {
    const r = simLanding(sink);
    R.landingRating = r;
    const s = bag();
    if (s.bestVs == null || sink < s.bestVs) { s.bestVs = sink; s.bestRating = r.rating; save(); }
    // the tower saw it: the grade comes over the radio, by your hand
    if (r.rating === "CRASH") {
      const n = strike("crashed the aircraft on landing");
      radio("Tower. You put her in the ground. " + strikeWords(n));
    } else {
      radio("Tower. " + (r.rating === "BUTTER" ? "Like butter. The desk owes you extra for that." : r.rating === "FIRM" ? "Firm one. You're down." : "Hard one. She felt that."));
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
       charter desk  → Marla's counter (the arc's front door: work, pay, the note)
       fuel truck    → Bo's station (the wind, and Vann's mood tonight)
       customs booth → Vann's post (the bribe/fine gate)
       windsock      → the real wind the crosswind-drift uses
       PAPI array    → the truthful glideslope, at the real RWY-27 aim point
       dest beacons  → what you aim the run at
       (the walkaround and the boarding are verbs on the parked jet herself)
  ============================================================ */
  let CUSTOMS = null, DISPATCH = null, FUEL = null;    // NPC handles (for say())
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

    /* THE APRON PROPS (2026-10-31 rebuild), on one merged store-fixture kit:
       the charter desk is a real check-in counter under a framed departures
       board; the fueler's truck is a cab-over refueller with an elliptical
       tank, hose reel, ladder and placards; customs is a glazed booth under
       a canopy with a real boom barrier. Real metres; colliders unchanged. */
    const K = CBZ.storeFixtureKit, k = K ? K.create() : null;

    // ---- CHARTER DESK : counter + the departures board ----------
    if (k) {
      k.frame(0, 0, 0, 0);                                                   // customer side = +z
      const top = K.dressCounter(k, 3.2, 1.2, 1.06, 0, { clad: 0x2a3542, trim: 0xb0b6c0, work: 0xd8d6d0, kick: 0x141a20, cladKind: "gloss" });
      k.box(0, top + 0.14, 0.52, 3.3, 0.04, 0.3, 0xe8e6e0, "gloss");          // the raised ledge
      k.box(0, 0.7, 0.62, 3.2, 0.06, 0.004, 0xe8b64c, "glow");               // the brand stripe
      for (const mx of [-0.8, 0.8]) {
        k.box(mx, top + 0.24, -0.2, 0.46, 0.3, 0.04, 0x1a1c20, "metal", 0.1, Math.PI, 0);
        k.box(mx, top + 0.24, -0.222, 0.42, 0.26, 0.004, 0x2e4a66, "glow", 0.1, Math.PI, 0);
      }
      k.box(1.3, top + 0.08, -0.25, 0.4, 0.16, 0.3, 0x2a2d33, "metal");      // the bag-tag printer
      // the board: two brushed posts, a black frame, a lit face
      for (const e of [-1, 1]) k.box(e * 1.55, 2.2, -0.7, 0.12, 4.4, 0.12, 0x8a9098, "metal");
      k.box(0, 3.25, -0.7, 3.2, 1.6, 0.14, 0x14161a, "gloss");
    }
    {
      const tex = ctx.canvasTex(512, 256, (cc, w, h) => {
        cc.fillStyle = "#0b0f14"; cc.fillRect(0, 0, w, h);
        cc.fillStyle = "#e8b64c"; cc.fillRect(0, 0, w, 44);
        cc.fillStyle = "#0b0f14"; cc.font = "900 28px Arial"; cc.textBaseline = "middle"; cc.textAlign = "left";
        cc.fillText("REDEYE CHARTER", 16, 23); cc.textAlign = "right"; cc.fillText("DEPARTURES", w - 16, 23);
        const rows = [["N407RD", "CAPE HARBOR", "BOARDING"], ["N211KX", "HALLORAN", "ON TIME"], ["N88VL", "THE ISLES", "DELAYED"], ["N604TT", "FORT BRANDT", "CANCELLED"]];
        cc.font = "700 24px 'Courier New', monospace";
        rows.forEach((r, i) => {
          const y = 76 + i * 46;
          cc.fillStyle = i % 2 ? "#121820" : "#0e131a"; cc.fillRect(0, y - 22, w, 44);
          cc.textAlign = "left"; cc.fillStyle = "#ffd977"; cc.fillText(r[0], 16, y); cc.fillStyle = "#e8eef4"; cc.fillText(r[1], 150, y);
          cc.textAlign = "right"; cc.fillStyle = r[2] === "DELAYED" ? "#ffb43a" : (r[2] === "CANCELLED" ? "#ff5a4a" : "#5ae08a"); cc.fillText(r[2], w - 16, y);
        });
      });
      const board = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.5), new THREE.MeshBasicMaterial({ map: tex }));
      board.position.set(0, 3.25, -0.62); g.add(board);
    }
    ctx.solid(-1.6, -0.7, 1.6, 0.7, 0, 1.3);
    ctx.light(0, 3.4, 0, 0xffca72, 0.8, 12);

    // ---- FUEL TRUCK (fueler station) : a cab-over refueller, nose to -x ----
    const fx = FUEL_X, fz = -3;
    if (k) {
      k.frame(fx, 0, fz, -Math.PI / 2);                                         // local +Z = the cab end (-x)
      const Y = 0xe8c21a, Yd = 0xb8960e;
      k.box(0, 0.62, 0, 0.9, 0.2, 5.8, 0x1a1c20, "metal");                     // chassis rails
      for (const z of [2.0, -1.2, -2.4]) for (const e of [-1, 1]) {
        k.cyl(e * 0.95, 0.5, z, 0.5, 0.5, 0.32, 0x141414, "solid", 0, 0, Math.PI / 2, 16);
        k.cyl(e * 1.11, 0.5, z, 0.26, 0.26, 0.02, 0xb0b6c0, "metal", 0, 0, Math.PI / 2, 12);
      }
      // the cab: a tall box, windscreen, doors, mirrors, beacon
      k.box(0, 1.55, 2.3, 2.3, 1.7, 1.3, 0xf2f0ea, "gloss");
      k.box(0, 1.85, 2.96, 2.1, 0.8, 0.02, 0x26303a, "gloss");
      k.box(0, 0.86, 3.0, 2.34, 0.3, 0.12, 0x2a2d33, "metal");                  // bumper
      for (const e of [-1, 1]) {
        k.box(e * 1.16, 1.85, 2.4, 0.02, 0.6, 0.7, 0x26303a, "gloss");          // door glass
        k.box(e * 1.3, 1.95, 2.8, 0.06, 0.3, 0.12, 0x1a1c20, "metal");          // mirror
        k.box(e * 0.8, 0.95, 3.04, 0.3, 0.14, 0.02, 0xfff4dc, "glow");          // headlamps
      }
      k.box(0, 2.48, 2.2, 0.4, 0.14, 0.2, 0xffb43a, "glow");                     // the beacon
      // the tank: elliptical barrel, end dishes, a walkway with a rail
      k.push(new THREE.CylinderGeometry(1.0, 1.0, 3.9, 20, 1), Y, "gloss", 0, 1.75, -0.6, Math.PI / 2, 0, 0, 1.15, 1, 0.85);
      for (const e of [-1, 1]) k.push(new THREE.SphereGeometry(1.0, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), Yd, "gloss", 0, 1.75, -0.6 + e * 1.95, e * Math.PI / 2, 0, 0, 1.15, 0.12, 0.85);
      k.box(0, 2.62, -0.6, 0.6, 0.04, 3.6, 0x8a9098, "metal");
      for (const e of [-1, 1]) k.box(e * 0.32, 2.85, -0.6, 0.03, 0.03, 3.6, 0xb0b6c0, "metal");
      for (let i = 0; i < 5; i++) for (const e of [-1, 1]) k.box(e * 0.32, 2.74, -2.3 + i * 0.85, 0.03, 0.24, 0.03, 0xb0b6c0, "metal");
      k.box(0, 1.75, -2.75, 0.5, 0.2, 0.02, 0xc0392b, "solid");                  // the placard (UN 1863)
      // the hose reel and nozzle at the rear, the ladder up to the walkway
      k.cyl(0, 0.95, -2.75, 0.45, 0.45, 0.6, 0x2a2d33, "metal", 0, 0, Math.PI / 2, 16);
      k.cyl(0, 0.95, -2.75, 0.5, 0.5, 0.04, 0x8a9098, "metal", 0, 0, Math.PI / 2, 16);
      k.cyl(0.35, 0.95, -2.75, 0.5, 0.5, 0.04, 0x8a9098, "metal", 0, 0, Math.PI / 2, 16);
      for (let i = 0; i < 6; i++) k.box(-1.2, 0.95 + i * 0.3, -2.1, 0.4, 0.03, 0.03, 0xb0b6c0, "metal");
      for (const e of [-1, 1]) k.box(-1.2 + e * 0.2, 1.7, -2.1, 0.03, 1.8, 0.03, 0xb0b6c0, "metal");
    }
    ctx.solid(fx - 3.0, fz - 1.1, fx + 3.0, fz + 1.1, 0, 1.9);
    ctx.light(fx, 3.0, fz, 0xffd07a, 0.5, 9);

    // ---- CUSTOMS BOOTH (inspector post) : glazed booth, canopy, barrier ------
    const cx = CUSTOMS_X, cz = -1;
    if (k) {
      k.frame(cx, 0, cz, 0);
      k.box(0, 0.08, 0, 2.6, 0.16, 2.6, 0x9a968c);                              // plinth
      k.box(0, 0.6, 0, 2.4, 0.9, 2.4, 0x223142, "gloss");                       // the lower panels
      for (const e of [-1, 1]) {
        k.box(e * 1.19, 1.65, 0, 0.02, 1.2, 2.2, 0, "glass");
        k.box(0, 1.65, e * 1.19, 2.2, 1.2, 0.02, 0, "glass");
        for (const f of [-1, 1]) k.box(e * 1.18, 1.65, f * 1.18, 0.08, 1.24, 0.08, 0x8a9098, "metal");   // corner mullions
      }
      k.box(0, 2.35, 0, 2.5, 0.2, 2.5, 0x223142, "gloss");
      k.box(0, 2.6, 0, 3.2, 0.12, 3.2, 0x2c3d50, "metal");                      // the canopy
      k.box(0, 1.1, 0.6, 2.2, 0.04, 0.5, 0xd8d6d0, "gloss");                    // inside counter
      // the barrier: housing, counterweight, a red/white arm across the lane
      k.box(-1.6, 0.5, 1.6, 0.4, 1.0, 0.4, 0xd8d6cc, "gloss");
      k.box(-1.6, 1.0, 1.95, 0.16, 0.24, 0.5, 0x2a2d33, "metal");
      for (let i = 0; i < 4; i++) k.box(-2.1 - i * 0.8, 0.95, 1.6, 0.8, 0.08, 0.08, i % 2 ? 0xf2f0ea : 0xc0392b, "gloss");
      k.box(0, 2.95, 1.62, 2.2, 0.6, 0.08, 0x14161a, "gloss");                  // the sign board
    }
    {
      const tex = ctx.canvasTex(256, 64, (cc, w, h) => {
        cc.fillStyle = "#0b1218"; cc.fillRect(0, 0, w, h);
        cc.fillStyle = "#36e0c8"; cc.font = "900 34px Arial"; cc.textAlign = "center"; cc.textBaseline = "middle"; cc.fillText("CUSTOMS", w / 2, h / 2 + 2);
      });
      const sg = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.5), new THREE.MeshBasicMaterial({ map: tex }));
      sg.position.set(cx, 2.95, cz + 1.665); g.add(sg);
    }
    ctx.solid(cx - 1.3, cz - 1.3, cx + 1.3, cz + 1.3, 0, 2.8);
    ctx.light(cx, 3.4, cz, 0x6ad0ff, 0.5, 10);
    if (k) k.build(g);

    // ---- WINDSOCK : pole + pivoting frustum cone (real wind drives it) ----
    buildWindsock(ctx, g, -4.5, -6.5);

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
      // Marla stands BEHIND her counter, under the board, facing whoever walks up
      { role: "dispatcher", key: "DISPATCH", outfit: "worker", name: "Marla", at: [0, -1.25], face: 0, post: "pinned", pose: "stand",
        dialogue: ["Board's fresh. Coffee isn't.", "Twelve grand on that plane, rook. The bank called twice.", "She's old. Walk her before you fly.", "Fourteen years on this desk. Never once flew."] },
      // (a plain uniform: the catalog's painted "security" fit drew him with no legs)
      { role: "inspector", key: "CUSTOMS", outfit: 0x1f2c3c, name: "Inspector Vann", at: [CUSTOMS_X, 1.6], face: 0, post: "pinned", pose: "foldarms",
        dialogue: ["Keep it clean tonight.", "Manifest or a reason. Your choice.", "I remember faces. And tail numbers."] },
      { role: "fueler", key: "FUEL", outfit: 0xffc81f, name: "Bo", at: [FUEL_X, 0.2], face: 0, post: "pinned", pose: "stand",
        dialogue: ["Topped her off. Didn't look in the back.", "Wind's up tonight, mind the sock on final.", "My kid starts flight school in March.", "Heard a Cessna went down off the cape. Nobody talks about it."] },
    ];
    venue._pendingCast = true;
    tryDrainCast(ctx, venue);

    // ---- ZONES (interactions) ----
    // each spot carries its person's asks (E / hold E / the wheel); the same
    // asks are I J K L on the person (giveVerbs, from update)
    ctx.zone({ id: "desk", name: "Charter desk", note: () => (up(DISPATCH) ? "Marla has the board" : "Nobody on the desk"), pos: [0, 1.7], at: [-1.2, 0.4], y: 1.15, r: 2.4, verbs: spotVerbs(MARLA_ASKS, () => DISPATCH) });   // the card hangs at the counter's left end: a sheet you are handed is held on the right
    ctx.zone({ id: "fuel", name: "Fuel truck", note: () => (up(FUEL) ? "Bo fuels the charter birds" : "Nobody on the truck"), pos: [FUEL_X, 1.9], at: [FUEL_X, -1.6], y: 1.4, r: 2.4, verbs: spotVerbs(BO_ASKS, () => FUEL) });
    ctx.zone({ id: "customs", name: "Customs booth", note: () => (up(CUSTOMS) ? "Inspector Vann" : "Booth unmanned"), pos: [CUSTOMS_X, 1.8], at: [CUSTOMS_X, 0.3], y: 1.5, r: 2.4, verbs: spotVerbs(VANN_ASKS, () => CUSTOMS) });

    // (the walkaround and the boarding are on the jet herself: wireJet)
  }

  function buildWindsock(ctx, g, lx, lz) {
    // an ICAO windsock: a 6 m tapered mast on a base plate with its swivel
    // ring and frame, and a 3.6 m sock in five red/white bands that the real
    // wind fills (R.sock.pivot yaws it, R.sock.cone droops it)
    ctx.cyl(g, lx, 3.0, lz, 0.05, 0.09, 6.0, ctx.pmat(0x8a9099, 40), 10);
    ctx.box(g, lx, 0.04, lz, 0.6, 0.08, 0.6, ctx.mat(0x6a6e66));
    ctx.solid(lx - 0.25, lz - 0.25, lx + 0.25, lz + 0.25, 0, 6.0);
    const pivot = new THREE.Group();
    pivot.position.set(lx, 5.7, lz); g.add(pivot);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.02, 6, 20), ctx.pmat(0x8a9099, 40));
    ring.rotation.y = Math.PI / 2; ring.position.set(0.05, 0, 0); pivot.add(ring);
    const cone = new THREE.Group(); pivot.add(cone);
    const m1 = new THREE.MeshLambertMaterial({ color: 0xff5a1a, emissive: 0xff5a1a, emissiveIntensity: 0.25, side: THREE.DoubleSide });
    const m2 = new THREE.MeshLambertMaterial({ color: 0xf2f2f2, emissive: 0xf2f2f2, emissiveIntensity: 0.2, side: THREE.DoubleSide });
    for (let q = 0; q < 5; q++) {
      const r0 = 0.3 - q * 0.033, r1 = 0.3 - (q + 1) * 0.033;
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, 0.72, 14, 1, true), q % 2 ? m2 : m1);   // top (+y) turns to -x: the wide end at the mast
      seg.rotation.z = Math.PI / 2; seg.position.set(0.41 + q * 0.72, 0, 0); cone.add(seg);
    }
    R.sock = { pivot, cone };
  }

  function buildPapi(ctx, g, o) {
    R.lampMats = [];
    const baseLx = AIM.x - o.x, baseLz = AIM.z - o.z + 18;    // just south of the runway edge, abeam touchdown
    for (let i = 0; i < 4; i++) {
      const lx = baseLx, lz = baseLz + i * 3.4;
      // a PAPI light unit: a low box housing on two legs, two lenses in its
      // face (the lamp colour is driven per frame through R.lampMats)
      for (const e of [-0.3, 0.3]) ctx.box(g, lx + 0.2, 0.2, lz + e, 0.08, 0.4, 0.08, ctx.mat(0x2a2d33));
      ctx.box(g, lx, 0.5, lz, 0.9, 0.36, 0.8, ctx.mat(0xe8c21a));                 // housing (airfield yellow)
      ctx.box(g, lx + 0.1, 0.7, lz, 0.9, 0.04, 0.84, ctx.mat(0x2a2d33));         // hood
      const m = new THREE.MeshLambertMaterial({ color: 0x141414, emissive: 0x141414, emissiveIntensity: 0.15 });
      for (const e of [-0.2, 0.2]) {
        const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.04, 16), m);
        lamp.rotation.z = Math.PI / 2; lamp.position.set(lx + 0.46, 0.5, lz + e); g.add(lamp);   // faces the approach (east)
      }
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
      if (h) { venue._npcs.push(h); if (spec.key === "CUSTOMS") CUSTOMS = h; if (spec.key === "DISPATCH") DISPATCH = h; if (spec.key === "FUEL") FUEL = h; }
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
        if (A.airportAudit && A.airportAudit.bounds) return { x: RAMP.x, z: RAMP.z };
        const regs = A.regions || (CBZ.city && CBZ.city.regions) || [];
        const has = regs.some((r) => r && (r.biome === "airport" || /airport|halloran/i.test(r.name || "")));
        return has ? { x: RAMP.x, z: RAMP.z } : null;
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
      strike: function (why) { const n = strike(why || "rigged violation"); radio("Tower. " + strikeWords(n)); return n; },
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
          inspection: R.inspection ? { mood: R.inspection.mood, resolved: R.inspection.resolved } : null, mood: R.mood,
          job: R.job ? { id: R.job.id, destId: R.job.destId, payout: R.job.payout, defect: R.job.defect } : null,
          landingRating: R.landingRating ? R.landingRating.rating : null,
          wind: { dir: +R.wind.dir.toFixed(1), speed: +R.wind.speed.toFixed(2) },
          aim: { x: AIM.x, z: AIM.z }, home: HOME,
          stats: { runs: b.runs, bestRating: b.bestRating, bribes: b.bribes, earned: b.earned, spent: b.spent, titles: b.titles },
        };
      },
      // what each person will do for you right now (labels), and one of them run
      asks: function (who) { const A = who === "bo" ? BO_ASKS : who === "vann" ? VANN_ASKS : MARLA_ASKS; return A.filter((a) => a.show()).map((a) => a.id + ":" + a.label()); },
      ask: function (who, id) { const A = who === "bo" ? BO_ASKS : who === "vann" ? VANN_ASKS : MARLA_ASKS; const a = A.find((k) => k.id === id); if (!a || !a.show()) return false; a.run(); return true; },
      pitch: function () { const j = pitched(); return j ? { id: j.id, name: j.name, destId: j.destId, hot: j.hot, payout: j.payout } : null; },
      castPeds: function () { return { marla: DISPATCH && DISPATCH.ped, bo: FUEL && FUEL.ped, vann: CUSTOMS && CUSTOMS.ped }; },
      cast: function () { return VENUE && VENUE._npcs ? VENUE._npcs.length : 0; },
      reset: function () { const b = bag(); b.debt = ECON.DEBT0; b.strikes = 0; b.ending = null; b.endReason = ""; save(); rigQueue.length = 0; endRun(); return this.state(); },
    },
  });
})();
