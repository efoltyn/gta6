/* ============================================================
   city/presidency.js — THE PRESIDENT MODE: one spine over organs that
   already exist.

   2026-09-27 REWORK (owner: "much more realistic, much less gimmicky
   button-pressing"). Read this before the older prose below, which still
   describes the organs correctly but not how the player reaches them:
     • The Situation Room has NO buttons now. Its seventeen labelled keys and
       the STANDING ORDERS console are deleted. The General, the Bureau
       Director and the Police Commissioner stand at the table (§3b) and
       propose orders off live state; you answer yes or no. BUTTONS below is
       still the one implementation of every order, called by people: these
       officers, the callers on the desk phone and the folders on the desk
       (president_office.js), the balcony speech (president_public.js).
     • No banners, no phone texts from rooms. big() routes to the TV in the
       President's Office; a refused order is returned to the person who
       asked, who says why in his own words.
     • The swearing-in announces nothing and hangs no waypoint.
     • §3a cabinet(): real, persistent people (the VP is the ledger deputy).
     • §10 THE SEAM for Hitman: current(), schedule(), onAssassinated(),
       lockdown(); an assassination (player or NPC, any cause) runs the
       succession officials.js already owns, then a national emergency, a
       capital lockdown, and a junta when nobody legal is left to sit.

   OWNER (verbatim): "make a new mode president where you are president and
   the sand city has terrorist orgs and you can build a wall etc make the
   president game cool it can turn into king or dictator or person in jail
   etc … don't make president game from scratch really build it off of the
   core engine code while dogfooding and improving the engine."

   WHAT THIS FILE IS, AND IS NOT. Every organ was already built by an
   earlier wave and this file authors NONE of them again:
     the seat        candidacy.js writes rec.office.holder (swearIn is that
                     file's own new export — the origin fast-forwards what
                     winning the election already does, so the presidency
                     stays reachable in ordinary play too)
     the powers      statecraft.js (CBZ.gov) — decrees, pardon, treasury,
                     tyranny, legitimacy, the refusable army
     the falls       regimes.js (emergency -> dictatorship), crown.js
                     (dictator self-coronation -> monarchy), games/jail.js +
                     wanted.js's toJail (the person-in-jail ending)
     the army        militia.js — the crackdown verb on the General's rung
     the enemy       factions.js declares the cell; occupy.js houses it;
                     aigoals' rampage brain drives an attacker; the panic /
                     killfeed / wanted buses carry the consequences
     the wall        construction.js's CBZ.stateWall (revived in that file —
                     it builds segments over days out of a real treasury)
     the map         govcomplex.js built the Executive Mansion and the
                     Bureau HQ on their own land; biome_desert.js built the
                     sand city (The Saltlands, and Dry Gulch on its highway)

   THE GUN-ROOM GRAMMAR, APPLIED (doctrine LAW 1). The Situation Room is a
   real LOCKED room inside the Executive Mansion: a steel door anyone can
   walk up to and see, that opens only for the sitting head of state. Inside
   is the best-dressed console in the building — a map table whose BUTTONS
   are real orders, and every button's lit/dark state is READ BACK from the
   system it commands (no stat fictions):
     ADDRESS THE NATION   CBZ.approvalShock + w.politics.scandal (approval.js
                          reads both; the effect sign reads murders7d/panic
                          off the world, statecraft's own discipline)
     STATE OF EMERGENCY   CBZ.gov.decree("emergency") — regimes.js's own
                          emergencyPowers ladder; 100 IS the dictatorship
     ORDER CRACKDOWN      CBZ.militia.orderCrackdown — the General's rung;
                          guarded by rankKnows, refused with the chair empty
     BUILD THE WALL       CBZ.stateWall.order — construction.js builds real
                          segments along the Saltlands frontier, treasury out
     DIRECT THE BUREAU    real Bureau agents at real cell members (below)
     SIGN A PARDON        CBZ.gov.pardon — statecraft's own ceiling rules
     ONE STATE / THE STATE TAKES THE MARKET
                          CBZ.regimeDeclareDoctrine("fascism"/"communism") —
                          the reachable PRODUCER for the two govTypes nine
                          gates branch on; gated on emergencyPowers >= 50
                          (a president needs emergency powers to get there)
     TAKE THE CROWN       CBZ.crown.selfCrown — visible ONLY while the
                          country reads "dictatorship". A category door.
     …AND THE REST OF THE DESK
                          statecraft.js always shipped seven decrees and three
                          deployments and this room exposed ONE of them. All
                          of them are pads now — fund the force, tax up, tax
                          down, curfew, amnesty, and deploy guard / surge /
                          martial — as THIN wrappers whose name, price,
                          cooldown, refusal and lit state all come back out
                          of CBZ.gov. Seventeen orders, grouped SECURITY /
                          THE CELL / THE PURSE / THE PEOPLE / THE REGIME
                          across two ranks of the table and one standing
                          console at the east wall. Skim is deliberately not
                          a pad: it is not an order given in front of ten
                          chairs.

   TERROR IN THE SAND CITY. One org, declared ONCE via CBZ.factions.declare
   (id "cell" — the id militia.js's hostileTo and worldstate's extremists
   standing were already written against). Its ROSTER is real ledger people
   (officials.js's mintIdentity shape via cityPedStash); its safehouses are
   real Dry Gulch lots occupied through occupy.js; its attacks need a living
   holder of the "attack" rung (kill every bomber and the attacks stop — the
   rank-is-a-verb law applied to the enemy); its supply arrives on runs that
   CROSS THE SALTLANDS FRONTIER, which is exactly what the wall throttles.
   An attack near the player is STAGED on real bodies through aigoals'
   rampage brain; a far one resolves as a world event (terror-threat through
   cityEvent, real approval, real emergencyPowers) — reported, never faked.

   THE THREAT COMES TO THE GATE. Once you have been sworn in the cell stops
   only bombing a market 4.7 km from your house: targets ALTERNATE (strictly,
   with the phase off a day hash) between the Dry Gulch market and the GATE OF
   THE EXECUTIVE MANSION. A gate attack counts you as present anywhere on your
   own compound, arrives in a REAL car (cityMakeCar, entered on the access
   road 60 m outside the leaf and driven up the drive by this file's own tick
   — ai:false + road:null, which is the only state in which the vehicle sim
   leaves a car alone), and puts 2-3 gunmen out of it at the gatehouse on the
   same rampage brain. The Mansion's own detail (power.js's principal ring,
   protection.js) answers it: there is no guard AI in this file. Twenty
   seconds before the bodies, "attack-armed" fires so the HUD can warn.

   THE PUBLIC FACE (other systems code against exactly this):
     CBZ.presidency.status()   one read of the whole presidency, every number
                               READ BACK from its owner (rec.treasury,
                               rec.approval, politics().emergencyPowers /
                               .scandal, gov.tyranny(), stateWall.status()).
                               paintBoard() consumes it too, so the board in
                               the room and any HUD are the same source.
     CBZ.presidency.site()     the execmansion entry of CBZ.govComplexes
     CBZ.presidency.on/.emit   a synchronous bus. The ten moments, with the
                               payload each one carries:
                                 sworn        {seat, country, govType, day}
                                 order        {key, ok, why}
                                 attack-armed {at:{x,z,name}, name, gate, eta}
                                   fired twice: once when the day schedules
                                   it (eta null), once when the fuse lights
                                   ~20 s before the bodies (eta 20)
                                 attack       {real, at:NAME, name, gate,
                                               where:{x,z}}
                                 raid         {phase|null, won?}
                                 impeach      {day, scandal, approval}
                                 campaign     {day, voteDay, polling, challenger,
                                               seat} — elections.js called the
                                               race at office.termDay-2
                                 reelected    {day, seat, terms, termDay}
                                 defeated     {day, seat, terms}
                                 arrest       {why, title, impeached}

   COUNTERTERROR IS PEOPLE AT PEOPLE (the owner's standing ask: "ways to
   order real npcs to interact with other npcs"): DIRECT THE BUREAU casts
   real agents at the Bureau gate (cityPostNpc — occupy's own atom, never a
   parallel spawner), parks a real black car beside them, and marches them
   at the safehouse on the ped brain's own guard field. Near the player the
   breach is a real firefight against the cell bodies occupy posted; far
   away it resolves against the same roster with the same reporting. Either
   way the outcome feeds approval and worldstate's counterterror event.

   FLAGS (all self-defaulted here; one-line reverts):
     PRESIDENCY_V1       master
     PRESIDENCY_SITROOM  the room, the door, the console
     PRESIDENCY_TERROR   the cell, its attacks, its supply
     PRESIDENCY_RAIDS    the Bureau order
     PRESIDENCY_FALLS    impeachment + the junta's knock (jail ending)

   HUD DOCTRINE: the killfeed is the only popup. Everything else is the
   phone (CBZ.phoneNotify), the feed, and CBZ.city.big spent only on a
   category change. The rich readout is the BOARD in the room, painted on
   events through the canvasTexLive shape (core/packages.js:110 — that
   helper is package-ctx-scoped, so the nine-line shape is copied here
   verbatim rather than importing a package mount).

   DETERMINISM: the room is fixed offsets off the govcomplex site rect; the
   roster is a named seedStream; every schedule roll is CBZ.hash01(day, salt).
   No Math.random anywhere in this file.

   AUDIT: CBZ.presidencyAudit() — see bottom. The orchestrator runs it.

   LOAD: index.html, after city/govcomplex.js (reads CBZ.govComplexes) —
   everything else is feature-detected and lazily retried.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE) return;
  const g = CBZ.game;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});

  if (CFG.PRESIDENCY_V1 == null) CFG.PRESIDENCY_V1 = true;
  if (CFG.PRESIDENCY_SITROOM == null) CFG.PRESIDENCY_SITROOM = true;
  if (CFG.PRESIDENCY_TERROR == null) CFG.PRESIDENCY_TERROR = true;
  if (CFG.PRESIDENCY_RAIDS == null) CFG.PRESIDENCY_RAIDS = true;
  if (CFG.PRESIDENCY_FALLS == null) CFG.PRESIDENCY_FALLS = true;

  function on() { return CFG.PRESIDENCY_V1 !== false; }

  // ============================================================
  //  TUNING — every number is a price, a threshold or a term in somebody
  //  else's formula.
  // ============================================================
  const ADDRESS_COST = 2000, ADDRESS_COOLDOWN = 2;      // days
  const RAID_COST = 6000, RAID_AGENTS = 3;
  const RAID_MUSTER_SEC = 45, RAID_ABSTRACT_SEC = 90;   // go along, or it happens without you
  const CRACKDOWN_COST = 3000;
  const DOCTRINE_EMERGENCY_MIN = 50;                    // emergencyPowers needed to proclaim
  const CELL_ROSTER = 9;                                // 1 emir + 2 bombers + 3 runners + 3 sympathizers
  const CELL_SUPPLY_PER_ATTACK = 3;
  const CELL_MAX_SUPPLY = 9;
  const ATTACK_MIN_GAP_DAYS = 2;
  const ATTACK_NEAR = 150;                              // stage a real scene inside this range
  const ATTACK_APPROVAL = -5;                           // a bombing the state failed to stop
  // THE THREAT COMES TO THE GATE. A gate attack counts the player as present
  // anywhere on his own compound (the Mansion plot is 248x244 m, so 200 m off
  // the centre is "you are home"), and it arrives on the access road in a real
  // car instead of teleporting bodies onto the lawn.
  const GATE_NEAR = 200;                                // anywhere on the compound
  const GATE_APPROACH = 60;                             // where the car enters the drive
  const GATE_STOP = 6;                                  // where it stops, outside the leaf
  const GATE_ATTACKERS = 3;                             // 2-3, by day hash
  const ATTACK_WARN_SEC = 20;                           // radio warning before the bodies
  // the roll is PACED off the warning: the car enters the drive the moment the
  // radio call goes out and pulls up at the leaf ~4 s before the doors open,
  // so nothing pops into view and the last seconds are a standoff.
  const GATE_ROLL_SPEED = GATE_APPROACH / Math.max(4, ATTACK_WARN_SEC - 4);   // m/s
  const RAID_WIN_APPROVAL = 4, RAID_LOSS_APPROVAL = -3;
  // IMPEACHMENT IS REACHABLE (PRESIDENT-PLAN 2.6). The old bar (scandal 85,
  // or approval < 15 with scandal >= 50) could not be cleared in a session
  // because NOTHING the president did moved scandal — statecraft only ever
  // wrote it on a corruption DISCOVERY roll. Now the day tick drifts scandal
  // toward tyranny (below), so the tempting buttons carry their own risk, and
  // the bar sits where a 7-day term can actually reach it.
  const IMPEACH_SCANDAL = 70, IMPEACH_APPROVAL = 25, IMPEACH_SCANDAL_LO = 45;
  // SCANDAL = WHAT YOU DID, MINUS WHAT YOU EXPLAINED. One line, all three
  // terms read off systems that already own them:
  //   tyranny   statecraft's addTyranny (pardons 5-9, curfew 8, emergency 15,
  //             crackdown/surge 4-6, martial law 18) — scandal chases it at a
  //             quarter per day, so force shows up in two days and a clean
  //             week walks it back down as statecraft's own tyranny decays.
  //   attacks   a bombing on your watch is a scandal about YOU (+4 each).
  //   address   speaking to the country buys 6 points of it back — the same
  //             button approval.js already rewards, now with a second use.
  const SCANDAL_PULL = 0.25, SCANDAL_PER_ATTACK = 4, SCANDAL_ADDRESS_RELIEF = 6;
  // elections.js's own lead-in (openRaces() publishes it per race as
  // `campaignDays`; this is only the fallback when that read is unavailable).
  const CAMPAIGN_LEAD = 2;
  const ARREST_GRACE_SEC = 30;                          // marshals give you one warning
  const JAIL_SENTENCE_SEC = 240, JAIL_BAIL = 60000;

  // ============================================================
  //  SMALL HELPERS — statecraft.js's own shapes, reused by convention.
  // ============================================================
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function money(n) { return "$" + Math.round(n || 0).toLocaleString(); }
  function day() { return CBZ.worldDay ? CBZ.worldDay() : 0; }
  function feed(t, c) { if (CBZ.cityFeed) { try { CBZ.cityFeed(t, c || "#8fc1ff"); } catch (e) {} } }
  // NO BANNERS. The screen-wide headline (CBZ.city.big) was this file's way
  // of saying that something big happened, and it is exactly the fourth-wall
  // popup the owner banned. A big moment in a country is on the TELEVISION:
  // president_office.js runs the broadcast on the wall of your office.
  function big(t) {
    const O = CBZ.presidentOffice;
    if (O && typeof O.news === "function") { try { O.news(String(t || ""), { kind: "breaking" }); } catch (e) {} }
  }
  function news(text) {
    if (CBZ.phoneNotify) { try { CBZ.phoneNotify({ app: "news", from: "City Desk", text: text, priority: 1 }); return; } catch (e) {} }
    feed(text, "#ffd76a");
  }
  function orders(from, text, prio) {
    if (CBZ.phoneNotify) { try { CBZ.phoneNotify({ app: "system", from: from, text: text, priority: prio == null ? 1 : prio }); return; } catch (e) {} }
    if (CBZ.city && CBZ.city.note) CBZ.city.note(text, 3.0);
  }
  function politics() {
    const w = CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null;
    if (w && w.politics) return w.politics;
    return g.cityPolitics || null;
  }
  // THE SEAT — statecraft owns "does the player hold office"; the presidency
  // is specifically the COUNTRY seat.
  function seat() {
    const h = (CBZ.gov && CBZ.gov.holds) ? CBZ.gov.holds() : null;
    return (h && h.kind === "country") ? h : null;
  }
  function seatRec() { const h = seat(); return h ? h.rec : null; }
  // every order pays out of the seat's REAL treasury — the same field polwar
  // drains for war upkeep and civilwar splits on a fracture. statecraft.js's
  // payFromTreasury discipline, verbatim: an empty purse REFUSES the order.
  function payTreasury(rec, amount) {
    const have = rec.treasury || 0;
    if (have < amount) return false;
    rec.treasury = have - amount;
    return true;
  }
  function shock(id, n) { if (CBZ.approvalShock && isFinite(n)) { try { CBZ.approvalShock(id, n); } catch (e) {} } }

  // ---- THE BUS. A five-line synchronous emitter, because the HUD, the
  // director and the motorcade all want to hear the same seven moments and none
  // of them should have to poll for them. Listeners never throw into a caller.
  const LISTEN = Object.create(null);
  function onEvent(evt, fn) {
    if (!evt || typeof fn !== "function") return function () {};
    const l = (LISTEN[evt] = LISTEN[evt] || []);
    l.push(fn);
    return function off() { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); };
  }
  function emitEvent(evt, payload) {
    const l = LISTEN[evt];
    if (!l || !l.length) return;
    const c = l.slice();
    for (let i = 0; i < c.length; i++) { try { c[i](payload, evt); } catch (e) {} }
  }

  // own seeded LCG for runtime casting order (repo convention; never
  // Math.random). Build-path choices below use hash01/seedStream instead.
  let _seed = 552800941 & 0x7fffffff;
  function rng() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }
  function h01(a, b, salt) { return CBZ.hash01 ? CBZ.hash01(a, b, salt) : 0.5; }

  // ============================================================
  //  STATE — g.presWorld, dual-rider persisted (bottom).
  // ============================================================
  function fresh() {
    return {
      began: false,
      lastAddressDay: -999,
      // the cell — roster of real ledger sids (officials' mintIdentity shape)
      roster: [],            // [{sid, name, rank, dead}]
      rosterSeeded: false,
      supply: 2,
      lastAttackDay: -999,
      attacksDone: 0, runsBlocked: 0, runsThrough: 0,
      intelKnown: false,     // the Bureau needs one thread to pull
      raidsOrdered: 0, raidsWon: 0, raidsLost: 0,
      // the falls
      impeachDay: null, impeached: false,
      arrestT: 0, arrestArmed: false, arrestWhy: null,
      wasPresident: false, lastSeatId: null,
      // the ballot — elections.js runs the race; these three fields are all
      // this file keeps about it: how many terms have been won, which vote
      // day is armed for settling, and which race has already been announced
      // (so the campaign order is posted once, not every day of the window).
      terms: 0, voteDay: null, campaignFor: null,
      // attacks counted at the last day tick — the difference is "attacks
      // since yesterday", which is what the scandal drift prices.
      attacksSeen: 0,
    };
  }
  function st() { if (!g.presWorld) g.presWorld = fresh(); return g.presWorld; }
  function reset() {
    g.presWorld = fresh(); teardownRoom();
    ballotPending = false; _einfo = null; _einfoKey = "";
    RAID.phase = null; RAID.agents = []; RAID.car = null; RAID.target = null;
    ATT.armed = null; OCC.done = {}; OCC.arena = null; _safehouses = null;
    for (const k in OFF.peds) OFF.peds[k] = null;   // the arena that held them is gone
    CONV = null;
    SEAM.fired = {}; SEAM.lastSid = null; SEAM.lastPed = null;
    SEAM.lock.active = false; SEAM.lock.reason = null;
  }

  // ============================================================
  //  §1  THE ORIGIN VERB — sworn in this morning. The origin does not own a
  //  second holder field: candidacy.js's swearIn() is the same write path a
  //  won election runs, so statecraft/elections/officials all see a normal
  //  officeholder. Returns truthy so origins.js treats the verb as started.
  // ============================================================
  function countryRecAny() {
    if (!CBZ.polity || !CBZ.polity.list) return null;
    const l = CBZ.polity.list("country") || [];
    for (let i = 0; i < l.length; i++) {
      const r = l[i];
      if (r && r.office && r.govType !== "monarchy") return r;
    }
    return l[0] || null;
  }
  function bindDetail(h) {
    // THE DEFENSE — the loyalty+weapons atom. officials.js already raises a
    // treasury-funded detail "off_<recId>" for every officeholder; when the
    // holder is the PLAYER the principal ref must be the player or the ring
    // guards a ghost. statecraft.deployGuard does this on a paid order; the
    // swearing-in does the binding for free (no bodies added — power.js and
    // protection.js grow those on their own budgets).
    if (!h || !CBZ.protection || !CBZ.protection.get) return;
    const sid = (CBZ.officials && CBZ.officials.PLAYER_SID) || "player";
    let det = CBZ.protection.get("off_" + h.id);
    if (!det && CBZ.protection.create) {
      det = CBZ.protection.create({
        id: "off_" + h.id, principal: { kind: "sid", ref: sid },
        gearTier: 2, formation: "escort", fundingSource: "treasury",
        legalStatus: "state", memberCount: 0,
      });
    }
    if (det && det.principal) det.principal.ref = sid;
  }
  function presidencyBegin() {
    if (!on()) return null;
    const S = st();
    const rec = countryRecAny();
    if (!rec) return null;
    let ok = false;
    if (CBZ.cityRun && CBZ.cityRun.swearIn) {
      const r = CBZ.cityRun.swearIn(rec.id, { quiet: true });
      ok = !!(r && r.ok);
    }
    if (!ok) return null;                       // no parallel holder write, ever
    S.began = true;
    S.wasPresident = true;
    S.lastSeatId = rec.id;
    S.terms = 1;                                // the term you are standing in
    bindDetail({ id: rec.id, rec: rec });
    try { seedRoster(); } catch (e) {}          // the threat board is not empty on the first morning
    emitEvent("sworn", { seat: rec.id, country: rec.name || null, govType: rec.govType || null, day: day() });
    // NOTHING IS ANNOUNCED. The old swearing-in shouted a banner across the
    // screen, pushed two phone texts explaining the Situation Room and the
    // ballot, and hung a waypoint on the steel door. The owner's law is that
    // the fourth wall stays up: president_office.js puts you behind your own
    // desk, the Chief of Staff walks in and tells you the day in his own
    // words, and the TV already has your face on it.
    return { ok: true, seat: rec.id };
  }
  CBZ.presidencyBegin = presidencyBegin;

  // ============================================================
  //  §2  THE SITUATION ROOM — a locked room inside the Executive Mansion.
  //  Fixed offsets off the govcomplex site (deterministic); rebuilt when the
  //  world (and with it CBZ.govComplexes) is rebuilt.
  // ============================================================
  function mansionSite() {
    const L = CBZ.govComplexes;
    if (!Array.isArray(L)) return null;
    for (let i = 0; i < L.length; i++) if (L[i] && L[i].id === "execmansion" && L[i].rect) return L[i];
    return null;
  }
  function agencySite() {
    const L = CBZ.govComplexes;
    if (!Array.isArray(L)) return null;
    for (let i = 0; i < L.length; i++) if (L[i] && L[i].id === "agency" && L[i].rect) return L[i];
    return null;
  }

  const ROOM = {
    builtFor: null,     // the govComplexes array identity this room was built against
    group: null, cols: [], door: null, doorCol: null, doorOpen: 0, board: null,
    pads: [],           // [{key, x, z, mesh}]
    rect: null, doorPt: null, zonesWired: false, seats: 0, stateSymbols: 0,
  };
  // canvasTexLive — core/packages.js:110's exact shape; that helper is only
  // handed to mounted game packages via ctx, so the nine lines are copied
  // here (same board contract: paint() is the one needsUpdate writer, and it
  // is called on EVENTS, never per frame).
  function canvasTexLive(w, h) {
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const tex = new THREE.CanvasTexture(canvas);
    const rec = { canvas: canvas, cc: canvas.getContext("2d"), tex: tex, w: w, h: h,
      paint: function () { tex.needsUpdate = true; return rec; } };
    return rec;
  }
  function cmat(hex) { return (CBZ.cmat || CBZ.mat) ? (CBZ.cmat || CBZ.mat)(hex) : new THREE.MeshLambertMaterial({ color: hex }); }
  function addBox(parent, x, y, z, w, h, d, hex) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), cmat(hex));
    m.position.set(x, y, z); parent.add(m);
    return m;
  }
  function addCylinder(parent, x, y, z, r0, r1, h, hex, seg) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg || 12), cmat(hex));
    m.position.set(x, y, z); parent.add(m);
    return m;
  }
  function addCol(x, z, w, d, y0, y1) {
    const c = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, y0: y0 || 0, y1: y1 == null ? 3 : y1 };
    CBZ.colliders.push(c); ROOM.cols.push(c);
    return c;
  }
  function teardownRoom() {
    if (ROOM.group && ROOM.group.parent) ROOM.group.parent.remove(ROOM.group);
    for (let i = 0; i < ROOM.cols.length; i++) {
      const k = CBZ.colliders ? CBZ.colliders.indexOf(ROOM.cols[i]) : -1;
      if (k >= 0) CBZ.colliders.splice(k, 1);
    }
    if (ROOM.doorCol && CBZ.colliders) {
      const k = CBZ.colliders.indexOf(ROOM.doorCol);
      if (k >= 0) CBZ.colliders.splice(k, 1);
    }
    if (CBZ.markCollidersDirty) { try { CBZ.markCollidersDirty(); } catch (e) {} }
    ROOM.group = null; ROOM.cols = []; ROOM.door = null; ROOM.doorCol = null;
    ROOM.board = null; ROOM.pads = []; ROOM.rect = null; ROOM.doorPt = null; ROOM.builtFor = null;
    ROOM.seats = 0; ROOM.stateSymbols = 0;
  }
  // is THIS person entitled through the door? The sitting head of state.
  function doorOpensFor() { return !!seat(); }

  /* ====================================================================
     THE SITUATION ROOM — built on the plate the state floor's plan left for
     it (interior_programs.js publishes b._sitRoom: the rect, the floor top,
     the ceiling, and the door in the wall that faces the Cross Hall), so
     the room and the rooms round it are one plan and never overlap.

     A real one: walnut-panelled walls to a navy acoustic band, a long table
     under three recessed lights, the country's live state on a video wall
     at its end with a screen either side, a row of clocks over them, the
     seal and the standards; a watch floor of three consoles along one side.
     Everything stands on the floor top (the old carpet was 5 cm proud of
     it, and every piece stood on that), the carpet tops out 1.8 cm over it.
     ==================================================================== */
  function glow(m, hex, ei) { if (m && CBZ.cmat) m.material = CBZ.cmat(hex, { emissive: hex, ei: ei }); return m; }
  const PANEL = 0x4a3524, STILE = 0x3a2b1e, STEEL = 0x2b3038, TRIM = 0x8b96a6;
  const NAVY = 0x17283f, BRASS = 0xb99347, CARPET = 0x263c58, PAPER = 0xd8d2c4;
  function buildRoom() {
    if (!CFG.PRESIDENCY_SITROOM || !window.THREE) return false;
    const site = mansionSite();
    if (!site) return false;
    if (ROOM.builtFor === CBZ.govComplexes && ROOM.group) return true;
    teardownRoom();
    const A = CBZ.city && CBZ.city.arena;
    const root = (A && A.root) || CBZ.scene;
    if (!root || !CBZ.colliders) return false;
    const mb = site.lot && site.lot.building;
    const PL = mb && mb._sitRoom;
    const SR = site.layout && site.layout.sitRoom;
    const LY = site.layout || {};
    const x0 = PL ? PL.minX : SR ? SR.minX : site.cx + 12.5;
    const x1 = PL ? PL.maxX : SR ? SR.maxX : site.cx + 25.5;
    const z0 = PL ? PL.minZ : SR ? SR.minZ : site.cz - 47.5;
    const z1 = PL ? PL.maxZ : SR ? SR.maxZ : site.cz - 34.5;
    const Y = PL ? PL.y : (LY.floorTops ? LY.floorTops[0] : 0.14);
    const CEILW = PL ? PL.ceil : (LY.floorTops && LY.floorTops[1] != null ? LY.floorTops[1] - 0.2 : Y + 3.0);
    const H = CEILW;                                  // walls stand on the floor top and meet the ceiling
    ROOM.rect = { minX: x0, maxX: x1, minZ: z0, maxZ: z1 };
    ROOM.floorY = Y;
    const grp = new THREE.Group();
    grp.name = "situation-room";
    root.add(grp); ROOM.group = grp;
    const T = 0.24, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    // the door: in the wall that faces out along (nx, nz); fallback the west wall
    const dn = (PL && PL.door) ? PL.door : { x: x0, z: cz, nx: -1, nz: 0 };
    const doorOnX = Math.abs(dn.nx) > 0.5;           // the door wall runs along z
    const dSide = doorOnX ? (dn.nx > 0 ? x1 : x0) : (dn.nz > 0 ? z1 : z0);
    const dC = doorOnX ? Math.max(z0 + 2, Math.min(z1 - 2, dn.z)) : Math.max(x0 + 2, Math.min(x1 - 2, dn.x));
    const outS = doorOnX ? Math.sign(dn.nx) : Math.sign(dn.nz);
    const GAP = 2.2, DH = 2.6;
    // ---- walls (real colliders), each one a leaf of plaster to the ceiling
    const wallBox = function (onX, at, a, b, y0, y1) {
      if (b - a < 0.02) return;
      const inset = onX ? (at === x0 ? T / 2 : -T / 2) : (at === z0 ? T / 2 : -T / 2);
      if (onX) { addBox(grp, at + inset, (y0 + y1) / 2, (a + b) / 2, T, y1 - y0, b - a, 0x3a4250); addCol(at + inset, (a + b) / 2, T, b - a, y0, y1); }
      else { addBox(grp, (a + b) / 2, (y0 + y1) / 2, at + inset, b - a, y1 - y0, T, 0x3a4250); addCol((a + b) / 2, at + inset, b - a, T, y0, y1); }
    };
    for (const side of [["x", x0], ["x", x1], ["z", z0], ["z", z1]]) {
      const onX = side[0] === "x", at = side[1];
      const lo = onX ? z0 : x0, hi = onX ? z1 : x1;
      if (onX === doorOnX && at === dSide) {
        wallBox(onX, at, lo, dC - GAP / 2, Y, H);
        wallBox(onX, at, dC + GAP / 2, hi, Y, H);
        wallBox(onX, at, dC - GAP / 2, dC + GAP / 2, Y + DH, H);
      } else wallBox(onX, at, lo, hi, Y, H);
    }
    // inner faces
    const fx0 = x0 + T, fx1 = x1 - T, fz0 = z0 + T, fz1 = z1 - T;
    // ---- floor and ceiling
    addBox(grp, cx, Y + 0.0115, cz, fx1 - fx0, 0.013, fz1 - fz0, CARPET);            // carpet: 0.005..0.018 over the floor top
    addBox(grp, cx, H - 0.02, cz, fx1 - fx0, 0.04, fz1 - fz0, 0x2a2f37);              // acoustic ceiling, under the slab
    // ---- walnut panelling to 2.8 m, a navy acoustic band over it, stiles on a
    // 1.2 m rhythm, a skirting and a cornice: on every inner face, round the door
    const faces = [
      { onX: true, at: fx0, s: 1, lo: fz0, hi: fz1 }, { onX: true, at: fx1, s: -1, lo: fz0, hi: fz1 },
      { onX: false, at: fz0, s: 1, lo: fx0, hi: fx1 }, { onX: false, at: fz1, s: -1, lo: fx0, hi: fx1 },
    ];
    const run = function (f, a, b, y0, y1, proud, col) {
      if (b - a < 0.05) return;
      const n = f.at + f.s * proud / 2;
      if (f.onX) addBox(grp, n, (y0 + y1) / 2, (a + b) / 2, proud, y1 - y0, b - a, col);
      else addBox(grp, (a + b) / 2, (y0 + y1) / 2, n, b - a, y1 - y0, proud, col);
    };
    for (const f of faces) {
      const isDoor = f.onX === doorOnX && Math.abs((f.onX ? (f.s > 0 ? x0 : x1) : (f.s > 0 ? z0 : z1)) - dSide) < 0.01;
      const spans = isDoor ? [[f.lo, dC - GAP / 2 - 0.1], [dC + GAP / 2 + 0.1, f.hi]] : [[f.lo, f.hi]];
      for (const sp of spans) {
        run(f, sp[0], sp[1], Y, Y + 2.8, 0.04, PANEL);
        run(f, sp[0], sp[1], Y, Y + 0.16, 0.06, STILE);                              // skirting
        run(f, sp[0], sp[1], Y + 0.9, Y + 0.95, 0.06, STILE);                        // rail
        run(f, sp[0], sp[1], Y + 2.8, H - 0.04, 0.03, NAVY);                         // acoustic band
        run(f, sp[0], sp[1], Y + 2.76, Y + 2.86, 0.07, BRASS);                       // brass datum
        for (let a = sp[0] + 0.6; a < sp[1] - 0.3; a += 1.2) run(f, a - 0.04, a + 0.04, Y + 0.95, Y + 2.76, 0.06, STILE);
      }
    }
    // ---- the door: a steel leaf that slides for the President, a frame, a reader
    const leafAt = dSide - outS * T / 2;
    const door = doorOnX ? addBox(grp, leafAt, Y + DH / 2, dC, 0.16, DH, GAP, STEEL) : addBox(grp, dC, Y + DH / 2, leafAt, GAP, DH, 0.16, STEEL);
    ROOM.door = door;
    ROOM.doorHome = { x: door.position.x, z: door.position.z };
    ROOM.doorSlide = doorOnX ? { x: 0, z: 1 } : { x: 1, z: 0 };
    ROOM.doorCol = doorOnX
      ? { minX: leafAt - 0.2, maxX: leafAt + 0.2, minZ: dC - GAP / 2, maxZ: dC + GAP / 2, y0: Y, y1: Y + DH, ref: door }
      : { minX: dC - GAP / 2, maxX: dC + GAP / 2, minZ: leafAt - 0.2, maxZ: leafAt + 0.2, y0: Y, y1: Y + DH, ref: door };
    CBZ.colliders.push(ROOM.doorCol);
    ROOM.doorPt = doorOnX ? { x: dSide + outS * 1.2, z: dC } : { x: dC, z: dSide + outS * 1.2 };
    const fOut = dSide + outS * 0.02;
    for (const e of [-1, 1]) {
      if (doorOnX) addBox(grp, fOut, Y + 1.35, dC + e * (GAP / 2 + 0.12), 0.34, 2.7, 0.22, TRIM);
      else addBox(grp, dC + e * (GAP / 2 + 0.12), Y + 1.35, fOut, 0.22, 2.7, 0.34, TRIM);
    }
    if (doorOnX) addBox(grp, fOut, Y + 2.73, dC, 0.34, 0.22, GAP + 0.46, TRIM);
    else addBox(grp, dC, Y + 2.73, fOut, GAP + 0.46, 0.22, 0.34, TRIM);
    // the clearance reader beside it (outside), its lamp green
    const rd = doorOnX ? { x: dSide + outS * 0.16, z: dC + GAP / 2 + 0.55 } : { x: dC + GAP / 2 + 0.55, z: dSide + outS * 0.16 };
    addBox(grp, rd.x, Y + 1.18, rd.z, 0.18, 0.52, 0.18, STEEL);
    addBox(grp, rd.x + (doorOnX ? outS * 0.1 : 0), Y + 1.2, rd.z + (doorOnX ? 0 : outS * 0.1), doorOnX ? 0.035 : 0.14, 0.2, doorOnX ? 0.14 : 0.035, 0x66d89c);
    // vision glass travels with the leaf
    const vision = addBox(door, 0, 0.16, 0, doorOnX ? 0.18 : 0.82, 0.52, doorOnX ? 0.82 : 0.18, 0x8fb0c4);
    vision.material = new THREE.MeshBasicMaterial({ color: 0x8fb0c4, transparent: true, opacity: 0.42 });
    ROOM.stateSymbols = 0;

    // ---- the table: its long axis away from the door, the video wall at the far end
    // (the "far" wall is the one opposite the door)
    const alongX = !doorOnX ? false : true;         // door on an x wall → the table runs along x
    const far = -outS;                               // from the door, into the room
    const len = Math.min(8.4, (alongX ? fx1 - fx0 : fz1 - fz0) - 5.2);
    const tcx = alongX ? cx + far * 0.2 : cx, tcz = alongX ? cz : cz + far * 0.2;
    ROOM.board = canvasTexLive(2048, 512);           // 4:1, exactly the screen's aspect
    ROOM.pads = [];
    let tableRec = null;
    const kitBox = function (x, y, z, w, h, d, color) { return addBox(grp, x, y, z, w, h, d, color); };
    if (CBZ.furnish && CBZ.furnish.table) {
      try {
        tableRec = CBZ.furnish.table(tcx, Y, tcz, alongX ? 0 : Math.PI / 2, {
          box: kitBox, ox: 0, oz: 0, oy: 0, solid: false, len: len, deep: 1.7, seats: 14, tone: "exec",
        });
      } catch (e) { tableRec = null; }
    }
    if (!tableRec) {
      addBox(grp, tcx, Y + 0.37, tcz, alongX ? len : 1.7, 0.74, alongX ? 1.7 : len, 0x243244);
    }
    ROOM.seats = tableRec && tableRec.seats ? tableRec.seats.length : 0;
    addCol(tcx, tcz, alongX ? len : 1.7, alongX ? 1.7 : len, Y, Y + 0.76);
    // the President's chair at the head, facing the door and the table
    const headX = alongX ? tcx + far * (len / 2 + 0.7) : tcx, headZ = alongX ? tcz : tcz + far * (len / 2 + 0.7);
    if (CBZ.furnish && CBZ.furnish.armchair) {
      try {
        const hr = CBZ.furnish.armchair(headX, Y, headZ, alongX ? Math.atan2(-far, 0) : Math.atan2(0, -far), { box: kitBox, ox: 0, oz: 0, oy: 0, solid: false, tone: "exec" });
        ROOM.seats += hr && hr.seats ? hr.seats.length : 0;
      } catch (e) {}
    }
    // briefing books, a map, two red phones: a table people work at
    const along = function (a, b) { return alongX ? { x: tcx + a, z: tcz + b } : { x: tcx + b, z: tcz + a }; };
    const tw = function (a, b, y, la, lb, h, col) { const p = along(a, b); return addBox(grp, p.x, Y + y, p.z, alongX ? la : lb, h, alongX ? lb : la, col); };
    tw(0, 0, 0.7535, len * 0.62, 0.56, 0.027, 0x3b2b27);
    for (const s of [-1, 1]) {
      tw(s * len * 0.3, 0.5, 0.768, 0.34, 0.48, 0.055, PAPER);
      tw(s * len * 0.42, -0.5, 0.80, 0.22, 0.34, 0.12, 0x8f3434);
    }
    tw(far * 0.4, 0, 0.768, 1.4, 0.9, 0.012, 0xcfc6a8);

    // ---- THE VIDEO WALL at the far end: the country's live board, a screen
    // either side, a row of clocks over them, the seal above the board
    const wallF = alongX ? (far > 0 ? fx1 : fx0) : (far > 0 ? fz1 : fz0);
    const inw = -far;                                // from the far wall back into the room
    const onWall = function (lat, y, w, h, depth, off, col) {
      const n = wallF + inw * (off + depth / 2);
      return alongX ? addBox(grp, n, Y + y, cz + lat, depth, h, w, col) : addBox(grp, cx + lat, Y + y, n, w, h, depth, col);
    };
    const span = alongX ? fz1 - fz0 : fx1 - fx0;
    const bw = Math.min(6.4, span - 5.0);
    onWall(0, 1.85, bw + 0.3, 1.9, 0.10, 0.04, STEEL);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(bw, bw / 4), new THREE.MeshBasicMaterial({ map: ROOM.board.tex }));
    const fn = wallF + inw * 0.16;
    if (alongX) { face.position.set(fn, Y + 1.85, cz); face.rotation.y = inw > 0 ? Math.PI / 2 : -Math.PI / 2; }
    else { face.position.set(cx, Y + 1.85, fn); face.rotation.y = inw > 0 ? 0 : Math.PI; }
    grp.add(face);
    for (const e of [-1, 1]) {
      const lat = e * (bw / 2 + 1.25);
      onWall(lat, 1.85, 1.9, 1.15, 0.08, 0.04, STEEL);
      glow(onWall(lat, 1.85, 1.75, 1.0, 0.02, 0.12, 0x39516a), 0x39516a, 0.55);
      // two clocks over each side screen
      for (const k of [-0.5, 0.5]) {
        onWall(lat + k, 3.0, 0.46, 0.46, 0.05, 0.04, 0x1b1e23);
        onWall(lat + k, 3.0, 0.38, 0.38, 0.01, 0.09, 0xf1ece0);
        onWall(lat + k, 3.04, 0.02, 0.14, 0.01, 0.1, 0x1b1e23);
        onWall(lat + k + 0.04, 3.0, 0.1, 0.02, 0.01, 0.1, 0x1b1e23);
      }
    }
    const seal = addCylinder(grp, 0, 0, 0, 0.42, 0.42, 0.06, BRASS, 24);
    { const n = wallF + inw * 0.07;
      if (alongX) { seal.position.set(n, Y + 3.25, cz); seal.rotation.z = Math.PI / 2; }
      else { seal.position.set(cx, Y + 3.25, n); seal.rotation.x = Math.PI / 2; } }
    ROOM.stateSymbols++;
    for (const e of [-1, 1]) {
      const lat = e * (span / 2 - 0.5);
      const p = alongX ? { x: wallF + inw * 0.45, z: cz + lat } : { x: cx + lat, z: wallF + inw * 0.45 };
      addBox(grp, p.x, Y + 0.15, p.z, 0.44, 0.30, 0.44, 0x1b1e23);
      addBox(grp, p.x, Y + 1.46, p.z, 0.05, 2.32, 0.05, BRASS);
      addBox(grp, p.x + (alongX ? 0 : -e * 0.47), Y + 2.05, p.z + (alongX ? -e * 0.47 : 0), alongX ? 0.04 : 0.9, 1.0, alongX ? 0.9 : 0.04, e < 0 ? 0x2f4f86 : 0x8f3434);
      addCol(p.x, p.z, 0.44, 0.44, Y, Y + 0.3);
      ROOM.stateSymbols++;
    }
    ROOM.screenPt = alongX ? { x: wallF + inw * 1.6, z: cz } : { x: cx, z: wallF + inw * 1.6 };

    // ---- THE WATCH FLOOR: three consoles along the side wall away from the door
    let stationSeats = 0;
    const sideF = alongX ? fz0 : fx0;                // a long side wall
    for (let i = 0; i < 3; i++) {
      const a = (i - 1) * 2.1;
      const px = alongX ? tcx + a : sideF + 0.55, pz = alongX ? sideF + 0.55 : tcz + a;
      addBox(grp, px, Y + 0.37, pz, alongX ? 1.5 : 0.7, 0.74, alongX ? 0.7 : 1.5, STEEL);
      addBox(grp, px, Y + 0.76, pz, alongX ? 1.6 : 0.78, 0.04, alongX ? 0.78 : 1.6, TRIM);
      for (const k of [-0.36, 0.36]) {
        const mx = alongX ? px + k : sideF + 0.3, mz = alongX ? sideF + 0.3 : pz + k;
        addBox(grp, mx, Y + 1.08, mz, alongX ? 0.62 : 0.05, 0.4, alongX ? 0.05 : 0.62, 0x14181e);
        addBox(grp, mx + (alongX ? 0 : 0.035), Y + 1.08, mz + (alongX ? 0.035 : 0), alongX ? 0.56 : 0.01, 0.34, alongX ? 0.01 : 0.56, 0x7ba2b8);
      }
      addCol(px, pz, alongX ? 1.5 : 0.7, alongX ? 0.7 : 1.5, Y, Y + 0.78);
      if (CBZ.furnish && CBZ.furnish.chair) {
        try {
          const cxp = alongX ? px : sideF + 1.35, czp = alongX ? sideF + 1.35 : pz;
          const cr = CBZ.furnish.chair(cxp, Y, czp, alongX ? Math.PI : -Math.PI / 2, { box: kitBox, ox: 0, oz: 0, oy: 0, solid: false, tone: "exec" });
          stationSeats += cr && cr.seats ? cr.seats.length : 0;
        } catch (e) {}
      }
    }
    ROOM.seats += stationSeats;
    // ---- the other long wall: a low cabinet under three live screens
    const sideG = alongX ? fz1 : fx1;
    for (let i = 0; i < 3; i++) {
      const a = (i - 1) * 2.3;
      const px = alongX ? tcx + a : sideG - 0.08, pz = alongX ? sideG - 0.08 : tcz + a;
      addBox(grp, px, Y + 1.95, pz, alongX ? 1.9 : 0.06, 1.1, alongX ? 0.06 : 1.9, STEEL);
      glow(addBox(grp, px + (alongX ? 0 : -0.04), Y + 1.95, pz + (alongX ? -0.04 : 0), alongX ? 1.76 : 0.02, 0.98, alongX ? 0.02 : 1.76, 0x39516a), 0x39516a, 0.5);
    }
    {
      const px = alongX ? tcx : sideG - 0.27, pz = alongX ? sideG - 0.27 : tcz;
      addBox(grp, px, Y + 0.36, pz, alongX ? 6.6 : 0.5, 0.72, alongX ? 0.5 : 6.6, PANEL);
      addBox(grp, px, Y + 0.735, pz, alongX ? 6.7 : 0.54, 0.03, alongX ? 0.54 : 6.7, STILE);
      addCol(px, pz, alongX ? 6.6 : 0.5, alongX ? 0.5 : 6.6, Y, Y + 0.75);
    }
    // ---- light: three recessed panels over the table, under the acoustic ceiling
    for (const k of [-1, 0, 1]) {
      const p = along(k * len / 3, 0);
      glow(addBox(grp, p.x, H - 0.05, p.z, alongX ? 1.6 : 0.5, 0.02, alongX ? 0.5 : 1.6, 0xffe6b0), 0xffe6b0, 0.8);
    }

    // NO BUTTONS. The orders come out of PEOPLE: the General, the Bureau
    // Director and the Police Commissioner stand at the table (§3b), read the
    // same live state the video wall draws, and propose what they want to do.
    // standing behind the chairs (the ring reaches 1.5 m off the table's axis)
    const st1 = along(len / 2 - 0.9, 2.05), st2 = along(0, -2.05), st3 = along(-len / 2 + 0.9, 2.05);
    const faceT = function (p) { return Math.atan2(tcx - p.x, tcz - p.z); };
    ROOM.stations = [
      { role: "general", x: st1.x, z: st1.z, face: faceT(st1) },
      { role: "bureau", x: st2.x, z: st2.z, face: faceT(st2) },
      { role: "police", x: st3.x, z: st3.z, face: faceT(st3) },
    ];
    ROOM.builtFor = CBZ.govComplexes;
    wireZones();
    paintBoard();
    return true;
  }
  // plain names for an order, used only when statecraft cannot name its own
  const ORDER_NAMES = {
    emergency: "State of emergency", crackdown: "Crackdown", curfew: "Curfew", surge: "Police surge",
    martial: "Soldiers on the street", guard: "A bigger detail", bureau: "The Bureau raid", wall: "The wall",
    police: "Police funding", taxup: "A tax rise", taxdown: "A tax cut", address: "An address to the nation",
    amnesty: "An amnesty", pardon: "A pardon", fascism: "One state", communism: "The state takes the market", crown: "The crown",
  };
  function padName(key) { return ORDER_NAMES[key] || String(key); }
  function inRoom(x, z) {
    const r = ROOM.rect;
    return !!(r && x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ);
  }

  // ============================================================
  //  §3  THE BUTTONS — every one is a real order through an existing
  //  system, and live() READS BACK from that system. `moves` names the seam
  //  (statecraft's own audit discipline): a button that names none fails
  //  the audit.
  // ============================================================
  // ---- statecraft's own desk, ON THE CONSOLE -----------------------------
  // statecraft.js has always shipped seven decrees and three deployments, and
  // this room exposed exactly one of them. These two factories put the rest on
  // the table in the SAME shape as the hand-written buttons, and they are
  // THIN by design: the name, the price, the cooldown, the refusal text and
  // the lit/dark light all come back out of CBZ.gov, so not one number or
  // rule is retyped here. Change a price in statecraft and this room changes.
  //
  // NOT a pad, deliberately: skim. It is the one decree that is not an order
  // - nobody gives it in front of ten chairs - and it already has its own
  // desk. A console key for stealing from the treasury would be a lie about
  // what the Situation Room is.
  function decreeRow(key) {
    if (!CBZ.gov || !CBZ.gov.decrees) return null;
    let rows = [];
    try { rows = CBZ.gov.decrees() || []; } catch (e) { rows = []; }
    for (let i = 0; i < rows.length; i++) if (rows[i] && rows[i].key === key) return rows[i];
    return null;
  }
  function decreeButton(key, group, moves) {
    return {
      group: group,
      // statecraft names its own decree; the pad plate is the fallback for a
      // world where the desk never loaded at all.
      name: function () { const r = decreeRow(key); return (r && r.name) || padName(key); },
      note: function () { const r = decreeRow(key); return (r && r.note) || ""; },
      moves: moves,
      live: function () { const r = decreeRow(key); return !!(r && r.live); },
      gate: function () {
        if (!CBZ.gov || !CBZ.gov.decree) return { ok: false, why: "No statecraft loaded." };
        if (CFG.GOV_OFFICE === false) return { ok: false, why: "Office powers are switched off." };
        const r = decreeRow(key);
        if (!r) return { ok: false, why: "That decree is not on the desk." };
        return r.ok ? { ok: true } : { ok: false, why: r.why || "Refused." };
      },
      run: function () {
        const r = CBZ.gov.decree(key);
        return r && r.ok ? { ok: true, why: "" } : { ok: false, why: (r && r.why) || "Refused." };
      },
    };
  }
  function deploymentOf(kind) {
    if (!CBZ.gov || !CBZ.gov.deployments) return null;
    let list = [];
    try { list = CBZ.gov.deployments() || []; } catch (e) { list = []; }
    for (let i = 0; i < list.length; i++) if (list[i] && list[i].kind === kind) return list[i];
    return null;
  }
  // the detail officials.js already raises for every officeholder - statecraft's
  // deployGuard grows THAT record, so this is where the guard pad reads back.
  function guardDetail(h) {
    if (!h || !CBZ.protection || !CBZ.protection.get) return null;
    try { return CBZ.protection.get("off_" + h.id) || null; } catch (e) { return null; }
  }
  // WHERE THE BODIES GO.
  //   guard            -> you.
  //   surge / martial  -> the threat. The gate the cell has armed if there is
  //                       one, else the Mansion's own gate: the point
  //                       govcomplex publishes, never a typed coordinate.
  // ONE WRINKLE, AND IT IS THE WORLD'S NOT THIS FILE'S. statecraft will only
  // move police or soldiers INSIDE the seat's jurisdiction, and polity's map
  // of a country is made of CITY rects - the Executive Mansion stands on its
  // own land, outside every one of them, so "surge, here" from the Situation
  // Room is a point no polity owns. So when the aim is off the political map,
  // the order lands on the nearest neighbourhood the seat actually governs,
  // which is what "surge officers into a neighbourhood" always meant. That
  // point is a polity record's own rect centre - still nothing typed here.
  function seatOwns(h, rec) {
    if (!h || !rec || !CBZ.polity || !CBZ.polity.countryOf) return false;
    let up = null;
    try { up = CBZ.polity.countryOf(rec.id); } catch (e) { up = null; }
    return !!(up && up.id === h.rec.id);
  }
  function nearestOwnPlace(h, pt) {
    if (!pt || !CBZ.polity || !CBZ.polity.list) return null;
    let cands = [];
    try { cands = (CBZ.polity.list("city") || []).concat(CBZ.polity.list("federal") || []); } catch (e) { cands = []; }
    let best = null, bd = Infinity;
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i];
      if (!c || !c.rect || !seatOwns(h, c)) continue;
      const d = Math.hypot(c.rect.cx - pt.x, c.rect.cz - pt.z);
      if (d < bd) { bd = d; best = { x: c.rect.cx, z: c.rect.cz }; }
    }
    return best;
  }
  function deployAim() {
    const A = ATT.armed;
    if (A && A.at && A.at.gate) return { x: A.at.x, z: A.at.z };
    const t = gateTarget();
    if (t) return { x: t.x, z: t.z };
    const s = mansionSite();
    if (s) { const gp = s.gate || { x: s.cx, z: s.rect ? s.rect.maxZ : s.cz }; return { x: gp.x, z: gp.z }; }
    const P = CBZ.player;
    return P && P.pos ? { x: P.pos.x, z: P.pos.z } : null;
  }
  function deployPoint(kind, h) {
    if (kind === "guard") { const P = CBZ.player; return P && P.pos ? { x: P.pos.x, z: P.pos.z } : null; }
    const aim = deployAim();
    if (!aim || !h || !CBZ.polity || !CBZ.polity.of) return aim;
    let loc = null;
    try { loc = CBZ.polity.of(aim.x, aim.z); } catch (e) { loc = null; }
    if (loc && seatOwns(h, loc)) return aim;             // the threat is already on your map
    return nearestOwnPlace(h, aim) || aim;               // the nearest ground you govern
  }
  function deployButton(kind, group, name, moves) {
    return {
      group: group, name: name, moves: moves,
      live: function () {
        if (kind === "guard") { const d = guardDetail(seat()); return !!(d && (d.memberCount | 0) > 0); }
        return !!deploymentOf(kind);
      },
      // THIN, AND REFUSABLE ON PURPOSE. The price, the legitimacy band and the
      // General's refusal live in statecraft.deploy(), and a refusal there has
      // TEETH (it decays readiness, which is civilwar.js's own coup
      // precondition) - so an order the army might refuse is NOT gated away
      // here to keep the pad tidy. This gate answers only what a pad can know
      // by itself: is the desk loaded, are they already out, and does the
      // world supply a reason to put soldiers on a street.
      gate: function (h) {
        if (!CBZ.gov || !CBZ.gov.deploy) return { ok: false, why: "No statecraft loaded." };
        if (CFG.GOV_MILITARY === false) return { ok: false, why: "Deployments are switched off." };
        if (kind === "guard") {
          if (!CBZ.protection || !CBZ.protection.create) return { ok: false, why: "No protection system loaded." };
          const d = guardDetail(h), cap = (CBZ.protection.HIRE_CAP || 8);
          if (d && (d.memberCount | 0) >= cap) return { ok: false, why: "Your detail is at full strength, " + d.memberCount + " bodies." };
          return { ok: true };
        }
        const out = deploymentOf(kind);
        if (out) return { ok: false, why: "Already out. They come home on day " + out.until + "." };
        if (kind === "martial" && CBZ.gov._martialReason) {
          // statecraft owns the test for whether the world can name a reason;
          // this only READS it, so the pad can say why it is dark instead of
          // pretending the order is available and swallowing the refusal.
          let reason = null;
          try { reason = CBZ.gov._martialReason(h); } catch (e) { reason = null; }
          if (!reason) return { ok: false, why: "Nothing in the country justifies soldiers on a street. The garrison stays inside the wire." };
        }
        return { ok: true };
      },
      run: function (h) {
        const at = deployPoint(kind, h);
        const r = CBZ.gov.deploy(kind, at);
        return r && r.ok ? { ok: true, why: "" } : { ok: false, why: (r && r.why) || "Refused." };
      },
    };
  }
  // a button's name may be a string or a read-back off the system it commands
  function bname(B) {
    if (!B) return "";
    try { return (typeof B.name === "function" ? B.name() : B.name) || ""; } catch (e) { return ""; }
  }

  const BUTTONS = {
    address: {
      group: "THE PEOPLE",
      name: "Address the nation",
      moves: ["approval.js approvalShock", "w.politics.scandal (approval reads events - scandal*0.1)", "rec.treasury"],
      live: function () { return day() - (st().lastAddressDay || -999) < ADDRESS_COOLDOWN; },
      gate: function (h) {
        const since = day() - (st().lastAddressDay || -999);
        if (since < ADDRESS_COOLDOWN) return { ok: false, why: "You spoke " + since + " day(s) ago. The country is still digesting it." };
        if ((h.rec.treasury || 0) < ADDRESS_COST) return { ok: false, why: "Airtime costs " + money(ADDRESS_COST) + " and the treasury is short." };
        return { ok: true };
      },
      run: function (h) {
        const S = st();
        payTreasury(h.rec, ADDRESS_COST);
        S.lastAddressDay = day();
        // THE SIGN IS READ OFF THE WORLD (statecraft's police-decree rule):
        // a country in crisis listens; a calm one shrugs.
        const murders = (CBZ.approvalState && CBZ.approvalState.murders7d) ? CBZ.approvalState.murders7d(h.id) : 0;
        const p = politics();
        const crisis = murders >= 5 || (p && (p.scandal || 0) > 40) || (p && (p.emergencyPowers || 0) > 40);
        shock(h.id, crisis ? 5 : 2);
        if (p && (p.scandal || 0) > 0) p.scandal = clamp((p.scandal || 0) - 6, 0, 100);
        news(h.title + " addresses the nation" + (crisis ? " from the Situation Room. The country was listening." : ". The country mostly was not."));
        return { ok: true, why: "" };
      },
    },
    // the emergency pad was always statecraft's decree with a hand-written
    // gate that could not refuse anything; it is the same wrapper as the six
    // decrees below it now, so "you already have it all" reaches the plate.
    emergency: decreeButton("emergency", "SECURITY",
      ["statecraft decree('emergency') -> g.cityPolitics.emergencyPowers -> regimes.js ladder", "approvalShock", "tyranny"]),
    crackdown: {
      group: "SECURITY",
      name: "Order a crackdown",
      moves: ["militia.js crackdown (gang machinery: members released, turf freed)", "rec.treasury", "approvalShock via militia's own dip"],
      live: function () { return !!(CBZ.militia && CBZ.militia.list && CBZ.militia.list().length); },
      gate: function (h) {
        if (!CBZ.militia || !CBZ.militia.orderCrackdown) return { ok: false, why: "No militia machinery loaded." };
        const list = CBZ.militia.list ? CBZ.militia.list() : [];
        if (!list.length) return { ok: false, why: "No private army stands anywhere in the country." };
        // A CRACKDOWN NEEDS SOMEBODY WHO CAN CARRY IT OUT. The degrade-safe
        // guard is rankKnows, never a bare rankCan null-check: an undeclared
        // ladder stands the gate DOWN, an empty General's chair refuses.
        if (CBZ.rankKnows && CBZ.rankHolder && CBZ.rankKnows("army", "crackdown") && !CBZ.rankHolder("army", "crackdown")) {
          return { ok: false, why: "The General's chair is empty. An order needs somebody alive to carry it out." };
        }
        if ((h.rec.treasury || 0) < CRACKDOWN_COST) return { ok: false, why: "Mobilisation costs " + money(CRACKDOWN_COST) + "." };
        return { ok: true };
      },
      run: function (h) {
        const list = CBZ.militia.list();
        if (!list.length) return { ok: false, why: "Nothing left to break up." };
        payTreasury(h.rec, CRACKDOWN_COST);
        const r = CBZ.militia.orderCrackdown(list[0].gangId, { by: "president" });
        return r && r.ok ? { ok: true, why: "" } : { ok: false, why: (r && r.why) || "The order did not go through." };
      },
    },
    wall: {
      group: "THE CELL",
      name: "Build the wall",
      moves: ["construction.js stateWall: real segments + colliders", "rec.treasury per segment", "checkpoints via garrison _post", "cell supply runs (presidency tick reads stateWall.coverage)"],
      live: function () { const W = CBZ.stateWall; const s = W && W.status ? W.status() : null; return !!(s && s.ordered && !s.done); },
      gate: function () {
        if (!CBZ.stateWall || !CBZ.stateWall.order) return { ok: false, why: "No construction machinery loaded." };
        const s = CBZ.stateWall.status();
        if (s.done) return { ok: false, why: "The wall stands, " + s.built + " sections along the Saltlands line." };
        if (s.ordered) return { ok: false, why: "Under construction: " + s.built + "/" + s.total + " sections. Crews draw pay daily." };
        return { ok: true };
      },
      run: function (h) {
        const r = CBZ.stateWall.order(h.rec);
        if (!r.ok) return r;
        big("THE WALL, CONSTRUCTION BEGINS");
        news(h.title + " orders a border wall along the Saltlands frontier. " + r.total + " sections, paid daily out of the treasury.");
        return { ok: true, why: "" };
      },
    },
    bureau: {
      group: "THE CELL",
      name: "Direct the Bureau",
      moves: ["real agents (cityPostNpc) at real cell members", "rec.treasury", "cityEvent('counterterror') -> extremists/police standings + emergencyPowers", "approvalShock", "cell roster deaths/arrests"],
      live: function () { return !!RAID.phase; },
      gate: function (h) {
        if (!CFG.PRESIDENCY_RAIDS) return { ok: false, why: "The Bureau is dark." };
        if (RAID.phase) return { ok: false, why: "A raid is already running (" + RAID.phase + ")." };
        if (!agencySite()) return { ok: false, why: "The Bureau built no headquarters this world." };
        const S = st();
        if (!S.intelKnown) return { ok: false, why: "No actionable intelligence yet. The cell has to surface once." };
        if (!livingCell().length) return { ok: false, why: "The Bureau's board is clear. The cell is broken." };
        if ((h.rec.treasury || 0) < RAID_COST) return { ok: false, why: "A raid costs " + money(RAID_COST) + "." };
        return { ok: true };
      },
      run: function (h) { return orderRaid(h); },
    },
    pardon: {
      group: "THE PEOPLE",
      name: "Sign a pardon",
      moves: ["statecraft pardon -> cityWantedReset/cityReduceWanted", "approvalShock", "tyranny"],
      live: function () { return (CBZ.cityStars ? CBZ.cityStars() : (g.wanted | 0)) > 0; },
      gate: function () {
        if (!CBZ.gov || !CBZ.gov.pardon) return { ok: false, why: "No statecraft loaded." };
        const stars = CBZ.cityStars ? CBZ.cityStars() : (g.wanted | 0);
        if (stars <= 0) return { ok: false, why: "There is nothing on you to pardon." };
        return { ok: true };
      },
      run: function () {
        const r = CBZ.gov.pardon();
        return r && r.ok ? { ok: true, why: "" } : { ok: false, why: (r && r.why) || "Refused." };
      },
    },
    fascism: {
      group: "THE REGIME",
      name: "Proclaim: one state",
      moves: ["regimes.js declareDoctrine('fascism') -> govType read by 9 gates (police x1.3, heat x1.4, curfew, polwar, centralbank)"],
      live: function () { const r = seatRec(); return !!(r && r.govType === "fascism"); },
      gate: doctrineGate("fascism"),
      run: function (h) { return runDoctrine(h, "fascism"); },
    },
    communism: {
      group: "THE REGIME",
      name: "Proclaim: the state takes the market",
      moves: ["regimes.js declareDoctrine('communism') -> govType read by market.setControls price ceiling, stocks dividends, taxRate"],
      live: function () { const r = seatRec(); return !!(r && r.govType === "communism"); },
      gate: doctrineGate("communism"),
      run: function (h) { return runDoctrine(h, "communism"); },
    },
    crown: {
      group: "THE REGIME",
      name: "Take the crown",
      moves: ["crown.js selfCrown -> govType 'monarchy', a royal house with YOUR bloodline, relations insults from every other crown"],
      // only VISIBLE as a dictator — the categorical door. see zone find().
      live: function () { const r = seatRec(); return !!(r && r.govType === "monarchy"); },
      gate: function (h) {
        if (!CBZ.crown || !CBZ.crown.selfCrown) return { ok: false, why: "No crown machinery loaded." };
        if (h.rec.govType !== "dictatorship") return { ok: false, why: "Only a dictator crowns himself. The republic still has a word for this." };
        return { ok: true };
      },
      run: function (h) {
        const r = CBZ.crown.selfCrown(h.rec.id);
        return r && r.ok ? { ok: true, why: "" } : { ok: false, why: (r && r.why) || "The coronation did not happen." };
      },
    },

    // ---- the rest of the state's own desk, finally in the room -----------
    // SECURITY. The curfew binds the president too; the surge and the
    // garrison go where the threat is, which after PRESIDENT-PLAN item 1 is
    // usually your own gate; the detail is the one the ledger already funds.
    curfew: decreeButton("curfew", "SECURITY",
      ["statecraft decree('curfew') -> g.heat on the player outdoors at night", "ped.npcHeat/npcWanted via cityNpcOffense", "rec.treasury", "approvalShock", "tyranny"]),
    surge: deployButton("surge", "SECURITY", "Surge the police",
      ["statecraft deploy('surge') -> police.js forcePool via cityPoliceForceAdd", "rec.treasury", "approvalShock", "tyranny", "statecraft standDown restores the force"]),
    martial: deployButton("martial", "SECURITY", "Put soldiers on the street",
      ["statecraft deploy('martial') -> real Fort Brandt troopers moved and posted", "polwar militaryOf().readiness/.soldiers debited", "rec.treasury", "approvalShock", "tyranny", "a refusal decays readiness -> civilwar coupEligible"]),
    guard: deployButton("guard", "SECURITY", "Add to your detail",
      ["statecraft deploy('guard') -> protection.js detail off_<seat>, real spawned bodies", "rec.treasury", "militia.js tryEscalate past MILITIA_HEADCOUNT", "tyranny"]),

    // THE PURSE. The two ends of the lever the treasury runs on, and the
    // badges that lever pays for.
    police: decreeButton("police", "THE PURSE",
      ["statecraft decree('police') -> police.js forcePool via cityPoliceForceAdd", "CBZ.CITY.policeForce", "rec.treasury", "approvalShock", "tyranny"]),
    taxup: decreeButton("taxUp", "THE PURSE",
      ["statecraft decree('taxUp') -> rec.taxRate -> approval.js services term", "rec.taxRate -> sim/econstate.js treasury flow"]),
    taxdown: decreeButton("taxDown", "THE PURSE",
      ["statecraft decree('taxDown') -> rec.taxRate -> approval.js services term", "rec.taxRate -> sim/econstate.js treasury flow"]),

    // THE PEOPLE. The mirror of the pardon: the pardon is for you, the
    // amnesty is for everybody else the law is hunting inside your border.
    amnesty: decreeButton("amnesty", "THE PEOPLE",
      ["statecraft decree('amnesty') -> ped.npcHeat/npcWanted/bounty across the jurisdiction", "g.respect via CBZ.city.addRespect", "approvalShock"]),
  };
  function doctrineGate(gov) {
    return function (h) {
      if (!CBZ.regimeDeclareDoctrine) return { ok: false, why: "No regime machinery loaded." };
      if (h.rec.govType === gov) return { ok: false, why: "Already proclaimed." };
      const p = politics();
      // a president needs EMERGENCY POWERS to get there — the same ladder
      // regimes' democracy->emergencyRule transition reads.
      if (!p || (p.emergencyPowers || 0) < DOCTRINE_EMERGENCY_MIN) {
        return { ok: false, why: "Emergency powers stand at " + Math.round((p && p.emergencyPowers) || 0) + "%. Below " + DOCTRINE_EMERGENCY_MIN + " the republic will not sign this." };
      }
      if (CBZ.regimeCanDeclare && !CBZ.regimeCanDeclare()) return { ok: false, why: "Not enough loyal people behind you to make it stick." };
      return { ok: true };
    };
  }
  function runDoctrine(h, gov) {
    const r = CBZ.regimeDeclareDoctrine(gov, { rec: h.rec });
    if (!r || !r.ok) return { ok: false, why: (r && r.reason) || "Refused." };
    return { ok: true, why: "" };
  }

  function pressButton(key) {
    if (!on()) return { ok: false, why: "Presidency is switched off." };
    const B = BUTTONS[key];
    if (!B) return { ok: false, why: "No such order." };
    const h = seat();
    if (!h) return { ok: false, why: "You do not hold the country." };
    const gt = B.gate(h);
    // A REFUSAL IS RETURNED, NEVER ANNOUNCED. Every caller now is a person
    // (an officer at the table, a minister on the phone, an aide at the desk)
    // and that person says why in his own words. No phone text from a room.
    if (!gt.ok) {
      paintBoard();
      emitEvent("order", { key: key, ok: false, why: gt.why || "" });
      return gt;
    }
    let r;
    try { r = B.run(h); } catch (e) { r = { ok: false, why: "The order did not go through." }; }
    paintBoard();
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    const out = r || { ok: true, why: "" };
    emitEvent("order", { key: key, ok: !!out.ok, why: out.why || "" });
    return out;
  }

  // ---- the room's two verbs: its door, and its video wall ------------------
  // The sitting head of state never sees a prompt at the door: the leaf slides
  // as he walks up (the tick below). Anybody else gets a handle that does not
  // turn. At the far end, E on the video wall is Brief: the officer at the
  // table nearest it gives you the picture (his proposal, read off the world),
  // which is the whole of what a Situation Room is for.
  function onRoomFloor() {
    const P = CBZ.player;
    return !(P && P.pos && ROOM.floorY != null && Math.abs(P.pos.y - ROOM.floorY) > 1.6);
  }
  function briefer() {
    if (!ROOM.screenPt) return null;
    let best = null, bd = 1e9;
    for (const role of ["general", "bureau", "police"]) {
      const p = OFF.peds[role];
      if (!p || p.dead || !p.pos) continue;
      const d = Math.hypot(p.pos.x - ROOM.screenPt.x, p.pos.z - ROOM.screenPt.z);
      if (d < bd) { bd = d; best = role; }
    }
    return best;
  }
  function wireZones() {
    if (ROOM.zonesWired || !CBZ.interactions || !CBZ.interactions.registerZone) return;
    ROOM.zonesWired = true;
    CBZ.interactions.registerZone({
      id: "pres-door", kind: "presdoor", radius: 2.6, prio: 12,
      find: function (px, pz) {
        if (!on() || !CFG.PRESIDENCY_SITROOM || !ROOM.doorPt || doorOpensFor() || !onRoomFloor()) return null;
        const dx = ROOM.doorPt.x - px, dz = ROOM.doorPt.z - pz;
        return (dx * dx + dz * dz) < 2.6 * 2.6 ? { x: ROOM.doorPt.x, z: ROOM.doorPt.z, kind: "presdoor" } : null;
      },
      options: [{
        id: "pres-door-try", slot: "e",
        label: "Open",
        onSelect: function () {
          if (CBZ.sfx) { try { CBZ.sfx("click", { vol: 0.5 }); } catch (e) {} }
          const d = ROOM.door, sl = ROOM.doorSlide || { x: 0, z: 1 };
          if (d) { d.position.x += sl.x * 0.02; d.position.z += sl.z * 0.02; setTimeout(function () { if (ROOM.door) { ROOM.door.position.x -= sl.x * 0.02; ROOM.door.position.z -= sl.z * 0.02; } }, 90); }
        },
      }],
    });
    CBZ.interactions.registerZone({
      id: "pres-screen", kind: "presscreen", radius: 2.4, prio: 13,
      find: function (px, pz) {
        if (!on() || !CFG.PRESIDENCY_SITROOM || !ROOM.screenPt || !seat() || CONV || !onRoomFloor() || !briefer()) return null;
        const dx = ROOM.screenPt.x - px, dz = ROOM.screenPt.z - pz;
        return (dx * dx + dz * dz) < 2.4 * 2.4 ? { x: ROOM.screenPt.x, z: ROOM.screenPt.z, kind: "presscreen" } : null;
      },
      options: [{
        id: "pres-screen-brief", slot: "e", campaignSafe: true,
        label: "Brief",
        onSelect: function () { const r = briefer(); if (r) talkTo(r); },
      }],
    });
    if (CBZ.interactions.describe) {
      try {
        CBZ.interactions.describe("presdoor", function () { return { label: "", note: "" }; });
        CBZ.interactions.describe("presscreen", function () { return { label: "", note: "" }; });
      } catch (e) {}
    }
  }

  // ============================================================
  //  §3a  THE CABINET — the people the orders come out of. Real ledger
  //  identities (cityPedStash, the same shape the cell roster uses), minted
  //  once per world off a named seed stream and persisted with the rest of
  //  this file's state. The Vice President is NOT minted: he is whoever the
  //  polity ledger says is the country's deputy, so the man who is sworn in
  //  when you die is the man the office called the Vice President.
  //  president_office.js reads cabinet() so the General on the desk phone is
  //  the same General standing in the Situation Room.
  // ============================================================
  const CABINET_ROLES = [
    { key: "chief", title: "Chief of Staff", prefix: "", job: "chief of staff", archetype: "professional" },
    { key: "general", title: "General", prefix: "General", job: "military general", archetype: "military" },
    { key: "bureau", title: "Bureau Director", prefix: "Director", job: "federal agent", archetype: "professional" },
    { key: "police", title: "Police Commissioner", prefix: "Commissioner", job: "police commissioner", archetype: "professional" },
    { key: "treasury", title: "Treasury Secretary", prefix: "Secretary", job: "treasury secretary", archetype: "professional" },
  ];
  function surname(n) { const p = String(n || "").trim().split(/\s+/); return p[p.length - 1] || n; }
  function cabinet() {
    const S = st();
    if (!S.cabinet) {
      S.cabinet = {};
      const stream = CBZ.seedStream ? CBZ.seedStream("presidency:cabinet") : rng;
      for (let i = 0; i < CABINET_ROLES.length; i++) {
        const R = CABINET_ROLES[i];
        const gender = stream() < 0.68 ? "m" : "f";
        const name = CBZ.cityMintName ? CBZ.cityMintName(stream, gender) : (R.title + " " + (i + 1));
        const obj = { _parked: true, nameKnown: true, kind: "civilian", archetype: R.archetype, name: name, gender: gender, job: R.job, wealth: 0.7, aggr: 0.2, cash: 300 };
        if (CBZ.cityPedStash) { try { CBZ.cityPedStash(obj); } catch (e) {} }
        S.cabinet[R.key] = { name: name, sid: obj._sid || ("cab_" + R.key), role: R.title, gender: gender, dead: false, refused: 0 };
      }
    }
    const out = {};
    for (let i = 0; i < CABINET_ROLES.length; i++) {
      const R = CABINET_ROLES[i], c = S.cabinet[R.key];
      if (!c) continue;
      out[R.key] = { name: c.name, sid: c.sid, role: c.role, gender: c.gender, dead: !!c.dead,
        display: R.prefix ? (R.prefix + " " + surname(c.name)) : c.name };
    }
    const rec = seatRec() || countryRecAny();
    const vpSid = rec && rec.office ? rec.office.deputy : null;
    let vpName = null;
    if (vpSid && CBZ.officials && CBZ.officials.identityOf) { try { const id = CBZ.officials.identityOf(vpSid); vpName = id && id.name; } catch (e) {} }
    out.vp = vpSid ? { name: vpName || "the Vice President", sid: vpSid, role: "Vice President", dead: false,
      display: vpName ? "Vice President " + surname(vpName) : "The Vice President" } : null;
    return out;
  }

  // ============================================================
  //  §3b  THE SITUATION ROOM IS PEOPLE. Three officers stand at the table
  //  while you hold the seat. Walk up to one and he tells you what he wants
  //  to do, read off the same live state the wall screen draws; you give him
  //  one of two answers. Every yes is a real order through BUTTONS (the same
  //  gate, price and refusal statecraft always had). A dead officer stays
  //  dead and his desk goes quiet: shoot the General and there is nobody to
  //  put soldiers on the street.
  // ============================================================
  const OFF = { peds: {}, t: 0 };
  let CONV = null;
  function gateOk(key) {
    const h = seat(), B = BUTTONS[key];
    if (!h || !B) return false;
    try { return !!B.gate(h).ok; } catch (e) { return false; }
  }
  function lastAttackNear() { const S = st(); return day() - (S.lastAttackDay | 0) <= 1 && S.attacksDone > 0; }
  function militiaName() {
    try { const l = CBZ.militia && CBZ.militia.list ? CBZ.militia.list() : []; return l.length ? (l[0].name || "the hills") : null; } catch (e) { return null; }
  }
  // Every proposal is { line, key?, yes?, no?, ok?, nope? }. No key = a report.
  function proposal(role) {
    const T = status();
    const cold = T.approval < 30;             // a weak president gets less deference
    const sir = cold ? "" : ", sir";
    if (role === "general") {
      const rec = seatRec();
      if (cabinetDead("general")) return { line: "" };
      if (rec && rec.govType === "dictatorship" && gateOk("crown")) return {
        line: "The officers would kneel" + sir + ". A crown settles the question of who comes after you, for good.",
        key: "crown", yes: "Then crown me", no: "No crowns", ok: "It will be done in the morning.", nope: "As you wish.",
      };
      if ((ATT.armed || lastAttackNear()) && gateOk("martial")) return {
        line: (ATT.armed ? "They are coming again, " + (ATT.armed.at && ATT.armed.at.gate ? "for this gate" : "for the market") : "They hit us yesterday") +
          ". Give me soldiers on the streets and I'll have checkpoints up before dark.",
        key: "martial", yes: "Put the soldiers out", no: "Not on our own streets", ok: "Trucks are rolling.", nope: "Then we wait for the next one.",
      };
      const mil = militiaName();
      if (mil && gateOk("crackdown")) return {
        line: "There's a private army out of " + mil + " answering to nobody. I can break it up this week.",
        key: "crackdown", yes: "Break it up", no: "Leave them", ok: "My men move tonight.", nope: "They'll only grow.",
      };
      if (T.threat.members > 0 && T.emergency < 50 && gateOk("emergency")) return {
        line: "Every order I get goes through three committees. Declare an emergency and I stop asking permission.",
        key: "emergency", yes: "Declare it", no: "The law stands", ok: "Understood. The papers will scream.", nope: "Then the committees can fight the cell.",
      };
      if (T.emergency >= 50 && gateOk("fascism")) return {
        line: "The emergency has held. The men want one flag and no parties. Say it and it's done.",
        key: "fascism", yes: "One state", no: "Not that", ok: "One state.", nope: "They'll be disappointed.",
      };
      return { line: T.wall && T.wall.ordered && !T.wall.done ? "The engineers are on the wall, " + T.wall.built + " of " + T.wall.total + " sections done. The garrison is at readiness." : "The garrison is at readiness. Nothing on the board I'd move men for today." };
    }
    if (role === "bureau") {
      if (RAID.phase) return { line: "My people are already moving. Pray it's clean." };
      if (gateOk("bureau")) return {
        line: "We have a thread on the Sons of the Dune. " + T.threat.members + " of them, a safehouse in Dry Gulch. Give me the word and my people go in.",
        key: "bureau", yes: "Go in", no: "Keep watching", ok: "Cars are leaving the gate now.", nope: "We keep watching. They keep planning.",
      };
      if (gateOk("wall") && T.threat.supply > 0) return {
        line: "Their supply walks across the Saltlands at night. A wall along that line starves them.",
        key: "wall", yes: "Build the wall", no: "No wall", ok: "I'll tell the engineers.", nope: "Then the runners keep running.",
      };
      if (!T.threat.intel && T.threat.members > 0) return { line: "Nothing actionable. The cell hasn't surfaced yet. When they move, we'll see them." };
      return { line: T.threat.members > 0 ? "We're watching " + T.threat.members + " of them. Nothing moves yet." : "The board is clear. For now." };
    }
    if (role === "police") {
      const murders = (CBZ.approvalState && CBZ.approvalState.murders7d && seat()) ? CBZ.approvalState.murders7d(seat().id) : 0;
      const pub = CBZ.presidentPublic;
      let protests = 0;
      if (pub && pub.protests) { try { protests = (pub.protests() || []).length; } catch (e) {} }
      if ((protests > 0 || murders >= 5) && gateOk("curfew")) return {
        line: protests > 0 ? "There are people at your gate and more coming. A curfew clears the streets after dark." : murders + " killings this week. A curfew empties the streets after dark.",
        key: "curfew", yes: "Impose the curfew", no: "No curfew", ok: "Sirens at sundown.", nope: "Then we take our chances at night.",
      };
      if ((ATT.armed || lastAttackNear() || T.approval < 35) && gateOk("surge")) return {
        line: "I can put a lot more cars where the trouble is. Today, if you want it.",
        key: "surge", yes: "Put them out", no: "Keep it normal", ok: "You'll see them within the hour.", nope: "Normal it is.",
      };
      if (gateOk("police")) return {
        line: "I'm short on every shift. Fund six more officers and you'll see them on the corners.",
        key: "police", yes: "Fund them", no: "Not this year", ok: "Thank you" + sir + ".", nope: "The corners stay empty, then.",
      };
      if (gateOk("amnesty") && T.approval < 45) return {
        line: "The cells are full of small cases. An amnesty clears them and buys some goodwill on the street.",
        key: "amnesty", yes: "Grant it", no: "They stay in", ok: "The doors open at noon.", nope: "Understood.",
      };
      return { line: "The force is where it should be. Quiet day, as quiet as they get." };
    }
    return { line: "" };
  }
  function cabinetDead(role) { const S = st(); return !!(S.cabinet && S.cabinet[role] && S.cabinet[role].dead); }
  // A POST CHANGES HANDS (city/president_staff.js). Fired: the man at the
  // table walks out and the chair is empty until somebody is hired into it
  // (an empty chair is a dead officer to every read above: nobody proposes,
  // nobody calls). Hired: the new person IS the post from now on - the
  // General on the phone and at the table is the one you picked.
  function vacateCabinet(role) {
    cabinet();
    const S = st(), c = S.cabinet && S.cabinet[role];
    if (!c) return false;
    c.dead = true; c.vacant = true;
    releaseOfficer(role);
    return true;
  }
  function fillCabinet(role, who) {
    cabinet();
    const S = st(), R = CABINET_ROLES.find(function (r) { return r.key === role; });
    if (!R || !who || !who.name) return false;
    S.cabinet[role] = { name: who.name, sid: who.sid || ("cab_" + role + "_" + day()), role: R.title, gender: who.gender || "m", dead: false, refused: 0 };
    releaseOfficer(role);
    return true;
  }
  function officerAt(role) {
    const st_ = ROOM.stations || [];
    for (let i = 0; i < st_.length; i++) if (st_[i].role === role) return st_[i];
    return null;
  }
  function releaseOfficer(role) {
    const p = OFF.peds[role];
    OFF.peds[role] = null;
    if (!p || p.dead) return;
    if (CBZ.cityUnpostNpc) { try { CBZ.cityUnpostNpc(p); return; } catch (e) {} }
    try {
      if (p.group && p.group.parent) p.group.parent.remove(p.group);
      const arr = CBZ.cityPeds; if (arr) { const i = arr.indexOf(p); if (i >= 0) arr.splice(i, 1); }
    } catch (e) {}
  }
  function postOfficer(role) {
    const at = officerAt(role);
    const c = cabinet()[role];
    if (!at || !c || c.dead || !CBZ.cityPostNpc) return null;
    const R = CABINET_ROLES.filter(function (r) { return r.key === role; })[0];
    let p = null;
    try {
      p = CBZ.cityPostNpc(at.x, at.z, {
        job: R.job, archetype: R.archetype, gender: c.gender, pin: true, face: at.face,
        armed: role === "general", aggr: 0.05, wealth: 0.7, src: "presidency:officer",
      });
    } catch (e) { p = null; }
    if (!p) return null;
    p.name = c.display; p.nameKnown = true; p.organization = "state"; p._presOfficer = role;
    OFF.peds[role] = p;
    if (CBZ.interactions && CBZ.interactions.registerFor) {
      try {
        CBZ.interactions.registerFor(p, {
          id: "pres-officer-" + role, slot: "e", prio: 40, campaignSafe: true,
          label: function () { return "Talk to " + c.display; },
          canShow: function () { return on() && !!seat() && !CONV && !p.dead; },
          onSelect: function () { talkTo(role); },
        });
      } catch (e) {}
    }
    return p;
  }
  function sayPed(ped, line) { if (ped && line && CBZ.citySay) { try { CBZ.citySay(ped, line, "#dfe7ff", Math.min(6, 2 + line.length * 0.04)); } catch (e) {} } }
  function talkTo(role) {
    if (CONV) return;
    const c = cabinet()[role];
    const ped = OFF.peds[role];
    if (!c || !ped || ped.dead) return;
    const pr = proposal(role);
    if (!pr.line) return;
    const ui = CBZ.campaignUI;
    CONV = { role: role, ped: ped, t: 0 };
    if (!ui || !ui.say) { sayPed(ped, pr.line); CONV = null; return; }
    if (!pr.key) {
      // nothing to decide: he just says it, over his own head
      if (CBZ.sayLines) CBZ.sayLines([{ by: ped, line: pr.line }], null); else sayPed(ped, pr.line);
      CONV.clearAt = 3.2 + pr.line.length * 0.05;
      return;
    }
    const conv = CONV;
    const ask = function (last) {
      if (CONV !== conv) return;               // you walked off mid-sentence
      let pending = null;
      try {
        pending = ui.say(c.display, last, [{ id: "yes", label: pr.yes }, { id: "no", label: pr.no }], { actor: ped });
      } catch (e) { pending = null; }
      if (!pending || !pending.then) { CONV = null; return; }
      pending.then(answered);
    };
    // he makes the case in breaths; the ask lands on the reply buttons
    if (CBZ.sayThen) CBZ.sayThen(ped, pr.line, ask); else ask(pr.line);
    function answered(choice) {
      const live = CONV && CONV.role === role;
      CONV = null;
      if (!live || (choice !== "yes" && choice !== "no")) return;
      let r = { ok: false, why: "" };
      if (choice === "yes") {
        r = pressButton(pr.key, { quiet: true }) || r;
        // a refusal is the officer's own sentence, never a system line
        sayPed(ped, r.ok ? (pr.ok || "Yes, sir.") : String(r.why || "It can't be done today."));
      } else {
        const S = st();
        if (S.cabinet && S.cabinet[role]) S.cabinet[role].refused = (S.cabinet[role].refused | 0) + 1;
        sayPed(ped, pr.nope || "Understood.");
      }
      emitEvent("decision", { source: "officer", who: c.display, topic: pr.key, choice: choice, order: choice === "yes" ? pr.key : null, ok: choice === "yes" ? !!r.ok : true });
    }
  }
  function tickOfficers(dt) {
    OFF.t -= dt;
    if (CONV) {
      // he looks at you while he talks; walking off ends the conversation
      const P = CBZ.player, p = CONV.ped;
      CONV.t += dt;
      if (p && p.group && P && P.pos) {
        const dx = P.pos.x - p.pos.x, dz = P.pos.z - p.pos.z;
        p.group.rotation.y = Math.atan2(dx, dz);
        if (dx * dx + dz * dz > 7.5 * 7.5 || p.dead) { if (CBZ.campaignUI && CBZ.campaignUI.clearDialogue) CBZ.campaignUI.clearDialogue(); CONV = null; }
      }
      if (CONV && CONV.clearAt && CONV.t > CONV.clearAt) { if (CBZ.campaignUI && CBZ.campaignUI.clearDialogue) CBZ.campaignUI.clearDialogue(); CONV = null; }
    }
    if (OFF.t > 0) return;
    OFF.t = 1.0;
    const S = st();
    const P = CBZ.player;
    const r = ROOM.rect;
    let near = false;
    if (P && P.pos && r && seat()) {
      const cx = (r.minX + r.maxX) / 2, cz = (r.minZ + r.maxZ) / 2;
      near = Math.hypot(P.pos.x - cx, P.pos.z - cz) < 42 && P.pos.y < 2.6;
    }
    const st_ = ROOM.stations || [];
    for (let i = 0; i < st_.length; i++) {
      const role = st_[i].role, p = OFF.peds[role];
      if (p && p.dead) {
        // A DEAD OFFICER STAYS DEAD. His place at the table is empty from now on.
        if (S.cabinet && S.cabinet[role] && !S.cabinet[role].dead) {
          S.cabinet[role].dead = true;
          emitEvent("cabinet-death", { role: role, name: p.name });
        }
        OFF.peds[role] = null;
        continue;
      }
      if (near && !p) postOfficer(role);
      else if (!near && p) releaseOfficer(role);
    }
  }

  // ---- THE STATUS — ONE READ OF THE WHOLE PRESIDENCY ---------------------
  // Every number here is READ BACK from the system that owns it, never
  // mirrored into this file's own state: the treasury and approval off the
  // polity record, emergency and scandal off w.politics, tyranny off
  // statecraft, the wall off construction.js. paintBoard() below consumes
  // this same object, so the board in the room and the HUD on the player can
  // never disagree — there is one source and this is it.
  function status() {
    const h = seat();
    const rec = h ? h.rec : null;
    const p = politics();
    const S = st();
    const W = (CBZ.stateWall && CBZ.stateWall.status) ? CBZ.stateWall.status() : null;
    const A = ATT.armed;
    const office = rec && rec.office ? rec.office : null;
    return {
      seat: !!h,
      title: h ? (h.title || null) : null,
      country: rec ? (rec.name || null) : null,
      govType: rec ? (rec.govType || null) : null,
      treasury: rec ? (rec.treasury || 0) : 0,
      approval: clamp(rec ? (rec.approval || 0) : 0, 0, 100),
      emergency: clamp((p && p.emergencyPowers) || 0, 0, 100),
      tyranny: (CBZ.gov && CBZ.gov.tyranny) ? CBZ.gov.tyranny() : 0,
      scandal: (p && p.scandal) || 0,
      day: day(),
      termDay: office && office.termDay != null ? office.termDay : null,
      // THE BALLOT, READ OFF ELECTIONS.JS — never a second race model. See
      // electionInfo() in §6b for exactly which public calls it reads.
      election: electionInfo(),
      impeachDay: S.impeachDay != null ? S.impeachDay : null,
      threat: {
        members: CFG.PRESIDENCY_TERROR ? livingCell().length : 0,
        supply: S.supply | 0,
        intel: !!S.intelKnown,
        armed: !!A,
        target: A && A.at ? (A.at.name || null) : null,
      },
      wall: W ? {
        ordered: !!W.ordered, built: W.built | 0, total: W.total | 0,
        manned: !!W.manned, done: !!W.done,
      } : null,
      raid: RAID.phase || null,
      began: !!S.began,
    };
  }

  // ---- THE MAP PANEL - the country, drawn out of the registries that own it
  // The board used to be six lines of text about places the player has never
  // seen. Half of it is a real top-down schematic now: every walkable region
  // the world registered, the two seats of power govcomplex published, the
  // frontier construction.js is building, the safehouses the Bureau has a
  // thread on, and live markers for the raid you ordered and the attack that
  // is coming. Not one rect is authored here - every one is read back out of
  // the registry that owns it, on the SAME event-driven repaint as the text.
  // THE WALKABLE REGIONS, WHEREVER THE WORLD PUT THEM. The landmass builders
  // are handed the ARENA as their `city`, so on a real world the 100-odd
  // registered regions land on CBZ.city.arena.regions and CBZ.city.regions is
  // an empty array. Read both. (This is worth knowing outside this panel:
  // saltlandsRegion() in section 4 and construction.js's own saltlands() both
  // read only CBZ.city.regions, which is why the wall plan, the safehouses
  // and the Dry Gulch target all come back empty on a booted world.)
  function cityRegions() {
    const A = CBZ.city && CBZ.city.arena;
    const a = (CBZ.city && CBZ.city.regions) || [];
    const b = (A && A.regions) || [];
    return a.length >= b.length ? a : b;
  }
  function mapRects() {
    const out = [];
    const regs = cityRegions();
    for (let i = 0; i < regs.length; i++) {
      const r = regs[i];
      if (!r || !isFinite(r.minX) || !isFinite(r.maxX) || !isFinite(r.minZ) || !isFinite(r.maxZ)) continue;
      if (r.maxX <= r.minX || r.maxZ <= r.minZ) continue;
      out.push({ name: String(r.name || ""), minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ });
    }
    return out;
  }
  // the frontier line construction.js is actually building on. Its plan is
  // derived from the Saltlands region; read the plan when it is reachable and
  // fall back to the region's own west edge, never to a typed coordinate.
  function wallLine() {
    if (CBZ.stateWall && CBZ.stateWall._plan) {
      try { const P = CBZ.stateWall._plan(); if (P && isFinite(P.x)) return { x: P.x, z0: P.z0, z1: P.z1 }; } catch (e) {}
    }
    const regs = cityRegions();
    for (let i = 0; i < regs.length; i++) {
      const R = regs[i];
      if (R && R.name === "The Saltlands" && isFinite(R.minX)) return { x: R.minX, z0: R.minZ, z1: R.maxZ };
    }
    return null;
  }
  function paintMap(cc, X, Y, W, H, T) {
    const rects = mapRects();
    const mans = mansionSite(), bur = agencySite();
    const marks = [];
    if (mans) marks.push({ x: mans.cx, z: mans.cz, hex: "#b99347", tag: "MANSION", shape: "seat" });
    if (bur) marks.push({ x: bur.cx, z: bur.cz, hex: "#7ba2b8", tag: "BUREAU", shape: "seat" });
    if (T.threat.intel) {
      let sh = [];
      try { sh = safehouses() || []; } catch (e) { sh = []; }
      for (let i = 0; i < sh.length; i++) marks.push({ x: sh[i].cx, z: sh[i].cz, hex: "#c2652a", tag: i ? "" : "SAFEHOUSE", shape: "x" });
    }
    if (T.threat.armed && ATT.armed && ATT.armed.at) marks.push({ x: ATT.armed.at.x, z: ATT.armed.at.z, hex: "#d9584e", tag: "ATTACK", shape: "ring" });
    if (T.raid && RAID.target) marks.push({ x: RAID.target.x, z: RAID.target.z, hex: "#e0a63c", tag: "RAID", shape: "ring" });
    const line = (T.wall && T.wall.ordered) ? wallLine() : null;

    let b = null;
    function grow(x0, z0, x1, z1) {
      if (!isFinite(x0) || !isFinite(z0) || !isFinite(x1) || !isFinite(z1)) return;
      if (!b) b = { x0: x0, z0: z0, x1: x1, z1: z1 };
      else { b.x0 = Math.min(b.x0, x0); b.z0 = Math.min(b.z0, z0); b.x1 = Math.max(b.x1, x1); b.z1 = Math.max(b.z1, z1); }
    }
    for (let i = 0; i < rects.length; i++) grow(rects[i].minX, rects[i].minZ, rects[i].maxX, rects[i].maxZ);
    for (let i = 0; i < marks.length; i++) grow(marks[i].x, marks[i].z, marks[i].x, marks[i].z);
    if (line) grow(line.x, line.z0, line.x, line.z1);

    cc.save();
    cc.beginPath(); cc.rect(X, Y, W, H); cc.clip();
    cc.fillStyle = "#070d14"; cc.fillRect(X, Y, W, H);
    cc.strokeStyle = "#2c3a4e"; cc.lineWidth = 2; cc.strokeRect(X + 1, Y + 1, W - 2, H - 2);
    cc.textAlign = "left"; cc.font = "bold 20px monospace"; cc.fillStyle = "#8fc1ff";
    cc.fillText("THE COUNTRY", X + 16, Y + 28);
    if (!b || (b.x1 - b.x0) <= 0 || (b.z1 - b.z0) <= 0) {
      cc.font = "20px monospace"; cc.fillStyle = "#5f708a";
      cc.fillText("no survey - the world has registered no ground yet", X + 16, Y + 64);
      cc.restore(); return;
    }
    const TOP = 40, BOT = 26, PAD = 18;
    const bw = Math.max(1, b.x1 - b.x0), bh = Math.max(1, b.z1 - b.z0);
    const sc = Math.min((W - PAD * 2) / bw, (H - TOP - BOT - PAD) / bh);
    const ox = X + (W - bw * sc) / 2 - b.x0 * sc;
    const oz = Y + TOP + (H - TOP - BOT - bh * sc) / 2 - b.z0 * sc;
    const MX = function (x) { return ox + x * sc; };
    const MZ = function (z) { return oz + z * sc; };

    // the ground, as the world filed it
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      const px = MX(r.minX), pz = MZ(r.minZ), pw = (r.maxX - r.minX) * sc, ph = (r.maxZ - r.minZ) * sc;
      cc.fillStyle = "rgba(38,60,88,0.55)"; cc.fillRect(px, pz, pw, ph);
      cc.strokeStyle = "#31506f"; cc.lineWidth = 1; cc.strokeRect(px + 0.5, pz + 0.5, Math.max(1, pw - 1), Math.max(1, ph - 1));
    }
    cc.textAlign = "center"; cc.font = "12px monospace"; cc.fillStyle = "#6f8bab";
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      const pw = (r.maxX - r.minX) * sc, ph = (r.maxZ - r.minZ) * sc;
      if (!r.name || pw < 92 || ph < 30) continue;
      cc.fillText(r.name.toUpperCase(), MX((r.minX + r.maxX) / 2), MZ((r.minZ + r.maxZ) / 2) + 4);
    }

    // THE WALL - built sections solid, the rest of the ordered line dashed
    if (line) {
      const frac = (T.wall.total ? clamp(T.wall.built / T.wall.total, 0, 1) : 0);
      const zA = MZ(line.z0), zB = MZ(line.z1), xw = MX(line.x);
      cc.lineWidth = 3; cc.strokeStyle = "#8b96a6";
      cc.beginPath(); cc.moveTo(xw, zA); cc.lineTo(xw, zA + (zB - zA) * frac); cc.stroke();
      cc.strokeStyle = "rgba(139,150,166,0.32)"; cc.setLineDash([5, 6]);
      cc.beginPath(); cc.moveTo(xw, zA + (zB - zA) * frac); cc.lineTo(xw, zB); cc.stroke();
      cc.setLineDash([]);
    }

    // the seats of power, the threat, and whatever is happening right now.
    // Two markers can land on the same 30 m of desert, so a tag steps UP the
    // panel until it clears every tag already placed rather than printing
    // through it - the board is unreadable the one time it matters otherwise.
    cc.font = "bold 12px monospace"; cc.textAlign = "center";
    const taken = [];
    function placeTag(px, pz, text, hex) {
      const tw = cc.measureText(text).width + 6, th = 14;
      let ty = pz - 22, tries = 0;
      for (; tries < 6; tries++) {
        let hit = false;
        for (let k = 0; k < taken.length; k++) {
          const b = taken[k];
          if (px + tw / 2 > b.x0 && px - tw / 2 < b.x1 && ty + th > b.y0 && ty < b.y1) { hit = true; break; }
        }
        if (!hit) break;
        ty -= th + 2;
      }
      if (tries >= 6) return;
      taken.push({ x0: px - tw / 2, x1: px + tw / 2, y0: ty, y1: ty + th });
      cc.fillStyle = "#070d14"; cc.fillRect(px - tw / 2, ty, tw, th);
      cc.fillStyle = hex; cc.fillText(text, px, ty + 11);
    }
    for (let i = 0; i < marks.length; i++) {
      const m = marks[i], px = MX(m.x), pz = MZ(m.z);
      cc.strokeStyle = m.hex; cc.fillStyle = m.hex; cc.lineWidth = 2;
      if (m.shape === "seat") { cc.fillRect(px - 5, pz - 5, 10, 10); cc.strokeStyle = "#0b1018"; cc.strokeRect(px - 5, pz - 5, 10, 10); }
      else if (m.shape === "x") {
        cc.beginPath(); cc.moveTo(px - 5, pz - 5); cc.lineTo(px + 5, pz + 5); cc.moveTo(px + 5, pz - 5); cc.lineTo(px - 5, pz + 5); cc.stroke();
      } else {
        cc.beginPath(); cc.arc(px, pz, 7, 0, Math.PI * 2); cc.stroke();
        cc.beginPath(); cc.arc(px, pz, 2.5, 0, Math.PI * 2); cc.fill();
      }
      if (m.tag) placeTag(px, pz, m.tag, m.hex);
    }

    // the legend - what the four colours on this map mean
    cc.textAlign = "left"; cc.font = "12px monospace";
    const key = [["#b99347", "seat of power"], ["#8b96a6", "the wall"], ["#c2652a", "safehouse"], ["#d9584e", "live threat"]];
    let lx = X + 16;
    for (let i = 0; i < key.length; i++) {
      cc.fillStyle = key[i][0]; cc.fillRect(lx, Y + H - 18, 9, 9);
      cc.fillStyle = "#5f708a"; cc.fillText(key[i][1], lx + 14, Y + H - 10);
      lx += 16 + cc.measureText(key[i][1]).width + 20;
    }
    cc.textAlign = "right"; cc.fillStyle = "#3f5064"; cc.font = "bold 13px monospace";
    cc.fillText("N \u2191", X + W - 14, Y + 28);
    cc.restore();
  }

  // ---- the board - painted on events, never per frame --------------------
  function paintBoard() {
    const b = ROOM.board;
    if (!b) return;
    const h = seat();
    const rec = h ? h.rec : countryRecAny();
    const T = status();
    const cc = b.cc;
    const COLW = 1440;   // the text column. The map is height-limited and
                         // square, so extra panel width would only be margin.
    function fit(text, maxW) {
      let t = String(text);
      if (cc.measureText(t).width <= maxW) return t;
      while (t.length > 1 && cc.measureText(t + "\u2026").width > maxW) t = t.slice(0, -1);
      return t + "\u2026";
    }
    cc.fillStyle = "#0b1018"; cc.fillRect(0, 0, b.w, b.h);
    cc.strokeStyle = "#2c3a4e"; cc.lineWidth = 3; cc.strokeRect(6, 6, b.w - 12, b.h - 12);
    cc.textAlign = "left";
    cc.fillStyle = "#8fc1ff"; cc.font = "bold 34px monospace";
    cc.fillText(fit(T.country ? String(T.country).toUpperCase() + "   " + String(T.govType || "").toUpperCase()
      : (rec ? String(rec.name).toUpperCase() + "   " + String(rec.govType || "").toUpperCase() : "NO COUNTRY"), COLW - 56), 28, 52);
    cc.font = "22px monospace"; cc.fillStyle = "#d8e2f2";
    const S = st();
    const W = CBZ.stateWall && CBZ.stateWall.status ? CBZ.stateWall.status() : null;
    const threat = CFG.PRESIDENCY_TERROR
      ? (T.threat.members + " known members, supply " + T.threat.supply + (T.threat.intel ? ", safehouse marked" : ", no intel")
         + (T.threat.armed ? ", ATTACK ARMED ON " + String(T.threat.target || "an unknown target").toUpperCase() : ""))
      : "quiet";
    const lines = [
      "TREASURY   " + money(T.treasury),
      "APPROVAL   " + Math.round(T.approval) + "% in the latest poll",
      "EMERGENCY  " + (T.emergency > 0 ? Math.round(T.emergency) + "% of emergency powers in force" : "none declared"),
      "THREAT     " + threat,
      "THE WALL   " + (T.wall ? (T.wall.ordered ? T.wall.built + "/" + T.wall.total + " sections, " + (T.wall.manned ? "gaps manned" : "gaps open") + (W && W.breaches ? ", " + W.breaches + " breached" : "") : "not ordered") : "no machinery"),
      "BUREAU     " + (T.raid ? ("raid " + T.raid) : (S.raidsOrdered ? S.raidsWon + " won / " + S.raidsLost + " lost" : "standing by")),
    ];
    for (let i = 0; i < lines.length; i++) cc.fillText(fit(lines[i], COLW - 56), 28, 104 + i * 40);
    cc.fillStyle = "#5f708a"; cc.font = "20px monospace";
    cc.fillText(fit("DAY " + T.day + (T.seat
      ? " ,  TERM ENDS " + (T.termDay != null ? "DAY " + T.termDay : "none") + (T.impeachDay != null ? " ,  IMPEACHMENT VOTE DAY " + T.impeachDay : "")
      : " ,  YOU DO NOT HOLD THE SEAT"), COLW - 56), 28, b.h - 28);
    try { paintMap(cc, COLW + 12, 20, b.w - COLW - 32, b.h - 40, T); } catch (e) {}
    b.paint();
  }

  // ============================================================
  //  §4  THE CELL — the sand city's terrorist org.
  // ============================================================
  const CELL_ID = "cell";
  let _cellDeclared = false;
  function declareCell() {
    if (_cellDeclared || !CFG.PRESIDENCY_TERROR) return _cellDeclared;
    if (!CBZ.factions || !CBZ.factions.declare) return false;
    if (CBZ.factions.exists && CBZ.factions.exists(CELL_ID)) { _cellDeclared = true; return true; }
    try {
      CBZ.factions.declare({
        id: CELL_ID, name: "Sons of the Dune", short: "SotD", kind: "cell",
        color: 0xc2652a, wage: 0, heat: 2.2,
        // militia.js's hostileTo:["cell"] and admission test were written
        // against this id before it existed — declaring it turns those
        // gates live. The army and the Bureau hate them back.
        hostileTo: ["police", "army", "agency"],
        // EVERY RUNG IS A VERB (the law, applied to the enemy): a Runner
        // moves supply across the frontier, a Bomber can be the one who
        // walks into the market, the Emir schedules — no living holder of
        // "attack" means no attacks (see tickCellDay), which is what makes
        // decapitation a strategy instead of a stat.
        ranks: [
          { key: "sympathizer", pip: "Sympathizer" },
          { key: "runner", pip: "Runner", grants: ["resupply"] },
          { key: "bomber", pip: "Bomber", grants: ["attack"] },
          { key: "emir", pip: "Emir", locked: true, grants: ["attack", "plan"] },
        ],
        // an embodied member's rank lives on the ped, never mirrored here
        rankField: "_cellRank",
        npcTag: { field: "organization", value: "cell" },
        admission: { test: function () { return "They do not take outsiders. Least of all you."; } },
        lore: "An insurgent cell out of the Saltlands. Their supply walks across the frontier at night.",
      });
      _cellDeclared = true;
    } catch (e) { _cellDeclared = false; }
    return _cellDeclared;
  }
  // ROSTER — real ledger identities (officials.js's mintIdentity shape via
  // cityPedStash: parked pages, nameKnown, real names off the seeded
  // stream). The roster is what the Bureau board counts, what a raid kills
  // or arrests, and what rank-liveness is asked of.
  const ROSTER_RANKS = ["emir", "bomber", "bomber", "runner", "runner", "runner", "sympathizer", "sympathizer", "sympathizer"];
  function seedRoster() {
    const S = st();
    if (S.rosterSeeded || !CFG.PRESIDENCY_TERROR || !CBZ.cityPedStash) return;
    const stream = CBZ.seedStream ? CBZ.seedStream("presidency:cell") : rng;
    for (let i = 0; i < CELL_ROSTER; i++) {
      const gender = stream() < 0.7 ? "m" : "f";
      const name = CBZ.cityMintName ? CBZ.cityMintName(stream, gender) : ("Cell Member " + (i + 1));
      const obj = {
        _parked: true, nameKnown: true, kind: "civilian", archetype: "thug",
        name: name, gender: gender, job: "quarry worker", wealth: 0.2, aggr: 0.85,
        cash: 40 + Math.round(stream() * 200),
      };
      try { CBZ.cityPedStash(obj); } catch (e) {}
      S.roster.push({ sid: obj._sid || ("cell_" + i), name: name, rank: ROSTER_RANKS[i] || "sympathizer", dead: false, held: false });
    }
    S.rosterSeeded = true;
  }
  function livingCell() {
    const S = st(); const out = [];
    for (let i = 0; i < S.roster.length; i++) { const m = S.roster[i]; if (m && !m.dead && !m.held) out.push(m); }
    return out;
  }
  function cellCanAttack() {
    const live = livingCell();
    for (let i = 0; i < live.length; i++) if (live[i].rank === "bomber" || live[i].rank === "emir") return true;
    return false;
  }
  function cellCanRun() {
    const live = livingCell();
    for (let i = 0; i < live.length; i++) if (live[i].rank === "runner" || live[i].rank === "emir") return true;
    return false;
  }

  // ---- the Saltlands + safehouses ---------------------------------------
  function saltlandsRegion() {
    // The landmass builders are handed the ARENA as their `city`, so every
    // registered region lives on CBZ.city.arena.regions and CBZ.city.regions
    // is empty on a booted world. Reading only the latter is why the wall
    // answered "the Saltlands never registered", safehouses() was empty and
    // the Dry Gulch target never fired. cityRegions() reads both ledgers.
    const regs = cityRegions();
    for (let i = 0; i < regs.length; i++) {
      const r = regs[i];
      if (r && r.name === "The Saltlands" && r.minX != null) return r;
    }
    return null;
  }
  let _safehouses = null;
  function safehouses() {
    if (_safehouses && _safehouses.length) return _safehouses;
    const R = saltlandsRegion();
    const A = CBZ.city && CBZ.city.arena;
    if (!R || !A) return [];
    const cands = [];
    const lots = (A.lots || []).concat(A.shopLots || []);
    for (let i = 0; i < lots.length; i++) {
      const l = lots[i];
      if (!l || l.cx == null || !l.building) continue;
      if (l.cx < R.minX || l.cx > R.maxX || l.cz < R.minZ || l.cz > R.maxZ) continue;
      cands.push(l);
    }
    if (!cands.length) return [];
    // deterministic pick — position hash, stable per seed
    cands.sort(function (a, b) { return h01(a.cx, a.cz, 0x7e11) - h01(b.cx, b.cz, 0x7e11); });
    _safehouses = cands.slice(0, Math.min(2, cands.length));
    return _safehouses;
  }
  // occupy the nearest safehouse with real bodies while the player is close
  // enough to meet them. occupy.js is the ONE NPC-in-building path (the
  // spawner ratchet stays where it was); the stamp pass below tags the cast
  // as cell members so factions.of()/reactionTo() answer for free.
  const OCC = { done: {}, arena: null };
  function embodySafehouses() {
    if (!CFG.PRESIDENCY_TERROR || !CBZ.cityOccupyBuilding) return;
    const P = CBZ.player; if (!P || !P.pos) return;
    // a rebuilt arena rebuilds its lots — drop every cached claim with it
    const A = CBZ.city && CBZ.city.arena;
    if (OCC.arena !== A) { OCC.arena = A; OCC.done = {}; _safehouses = null; }
    const list = safehouses();
    for (let i = 0; i < list.length; i++) {
      const l = list[i];
      const key = Math.round(l.cx) + ":" + Math.round(l.cz);
      const d = Math.hypot(l.cx - P.pos.x, l.cz - P.pos.z);
      if (d > 220 || OCC.done[key]) continue;
      let rec = null;
      try {
        rec = CBZ.cityOccupyBuilding(l, {
          id: "pres:cell:" + key, faction: CELL_ID, access: "private", crime: "trespass",
          floors: [{ level: 0, role: "soldier", count: 2, program: "quarters", access: "private" }],
        });
      } catch (e) { rec = null; }
      if (rec) OCC.done[key] = rec;
    }
    // stamp pass: occupy casts incrementally, so tag whatever has landed
    for (const key in OCC.done) {
      const rec = OCC.done[key];
      if (!rec || !rec.peds) continue;
      for (let i = 0; i < rec.peds.length; i++) {
        const p = rec.peds[i];
        if (!p || p._cellRank) continue;
        p.organization = "cell";
        p._cellRank = i === 0 ? "bomber" : "runner";
        p.job = "quarry worker";
      }
    }
  }

  // ---- SUPPLY — runs that cross the frontier, and the wall's whole point.
  // MECHANISM (stated for the audit): each day the cell fields up to two
  // resupply runs if a Runner/Emir lives. Each run must cross the Saltlands
  // frontier; CBZ.stateWall.coverage() is the fraction of that line standing
  // AND manned, and a run is intercepted with exactly that probability
  // (hash01(day, run) — deterministic). Attacks cost CELL_SUPPLY_PER_ATTACK;
  // starve the runs and the cadence dies. Sabotage (blown segments) lowers
  // coverage, which is why the cell bombs the wall back.
  function tickCellDay(d) {
    if (!on() || !CFG.PRESIDENCY_TERROR) return;
    const S = st();
    seedRoster();
    if (!livingCell().length) return;                  // broken orgs stay broken
    const W = CBZ.stateWall;
    const coverage = (W && W.coverage) ? W.coverage() : 0;
    if (cellCanRun()) {
      for (let r = 0; r < 2; r++) {
        if (S.supply >= CELL_MAX_SUPPLY) break;
        const blocked = h01(d, r + 1, 0x5a17) < coverage;
        if (blocked) {
          S.runsBlocked++;
          if (r === 0) news("Border guards turn back a smuggling run at the Saltlands wall.");
        } else {
          S.runsThrough++;
          S.supply = clamp(S.supply + 1, 0, CELL_MAX_SUPPLY);
        }
      }
    }
    // schedule an attack: needs a living attacker, supply, and a gap
    if (cellCanAttack() && S.supply >= CELL_SUPPLY_PER_ATTACK && d - S.lastAttackDay >= ATTACK_MIN_GAP_DAYS) {
      if (h01(d, 77, 0x5a18) < 0.6) armAttack(d);
    }
  }

  // ---- ATTACKS — staged on real bodies when you are there; a reported
  // world event when you are not. Either way the numbers moved are real.
  const ATT = { armed: null };
  function marketTarget() {
    // the market: Dry Gulch's centre; the highway spine z is published
    const R = saltlandsRegion();
    if (!R) return null;
    const cx = (R.minX + R.maxX) / 2, cz = (R.minZ + R.maxZ) / 2;
    const z = (CBZ.DESERT_HWY_Z != null) ? CBZ.DESERT_HWY_Z : cz - 40;
    return { x: cx + 30, z: z, name: "the Dry Gulch market" };
  }
  // WHICH WAY IS OUT of a compound? govcomplex publishes `gate` as a point ON
  // one edge of `rect`; the outward normal is whichever edge it sits on. Read
  // rather than hard-coded, so moving the Mansion's gateSide can never point
  // the access road at the lawn.
  function gateOut(site) {
    const R = site.rect, gp = site.gate || { x: site.cx, z: R.maxZ };
    const dl = Math.abs(gp.x - R.minX), dr = Math.abs(gp.x - R.maxX);
    const db = Math.abs(gp.z - R.minZ), dt = Math.abs(gp.z - R.maxZ);
    const m = Math.min(dl, dr, db, dt);
    if (m === dt) return { x: 0, z: 1 };
    if (m === db) return { x: 0, z: -1 };
    if (m === dr) return { x: 1, z: 0 };
    return { x: -1, z: 0 };
  }
  // THE SECOND TARGET: your own gate. The point is just INSIDE the leaf, in
  // front of the gatehouse (govcomplex row 2: gatehouse at cx, R.maxZ-6), so
  // the fight happens where the Mansion's own detail already stands.
  function gateTarget() {
    const s = mansionSite();
    if (!s || !s.rect) return null;
    const gp = s.gate || { x: s.cx, z: s.rect.maxZ };
    const o = gateOut(s);
    return {
      x: gp.x - o.x * 4, z: gp.z - o.z * 4,
      name: "the gate of the Executive Mansion", gate: true,
      site: s, out: o, gx: gp.x, gz: gp.z,
    };
  }
  // ALTERNATION. Before the swearing-in the cell only knows the market. After
  // it, targets strictly alternate market -> gate -> market, with the PHASE
  // picked by the day hash (so which one opens the term is deterministic per
  // world without every world opening the same way).
  function attackTarget(d) {
    const S = st();
    const market = marketTarget();
    if (!(S.began || seat())) return market;
    const gate = gateTarget();
    if (!gate) return market;
    const phase = h01(d, 9, 0x5a1c) < 0.5 ? 0 : 1;
    const wantGate = ((S.attacksDone | 0) + phase) % 2 === 1;
    return wantGate ? gate : (market || gate);
  }
  // the bus payload: a point and a name, never this file's live target record
  // (a listener must not be handed the site rect to hold on to).
  function armedPayload(t, eta) {
    return { at: { x: t.x, z: t.z, name: t.name || null }, name: t.name || null, gate: !!t.gate, eta: eta };
  }
  function armAttack(d) {
    const S = st();
    const t = attackTarget(d);
    if (!t) return;
    S.supply = clamp(S.supply - CELL_SUPPLY_PER_ATTACK, 0, CELL_MAX_SUPPLY);
    S.lastAttackDay = d;
    ATT.armed = { at: t, t: 0, lit: false, fuse: 0, car: null };
    emitEvent("attack-armed", armedPayload(t, null));
  }
  // ---- casting: the ONE sanctioned atom, the ONE existing brain ----------
  function armPed(ped, rank) {
    if (!ped) return null;
    ped.organization = "cell";
    ped._cellRank = rank || "bomber";
    ped.job = "terror attacker";
    ped.aggr = 0.98;
    ped.ammo = Math.max(ped.ammo || 0, 90);
    if (!ped.armed) { ped.armed = true; ped.weapon = "AK-47"; if (CBZ.syncActorWeapon) { try { CBZ.syncActorWeapon(ped); } catch (e) {} } }
    let ok = false;
    if (CBZ.cityStartRampage) { try { ok = !!CBZ.cityStartRampage(ped); } catch (e) { ok = false; } }
    if (!ok) {
      ped.rampage = true;
      if (CBZ.cityNpcOffense) { try { CBZ.cityNpcOffense(ped, 90, "terror attack"); } catch (e) {} }
      if ((ped.npcWanted | 0) < 3) ped.npcWanted = 3;
    }
    return ped;
  }
  function castAttacker(x, z, rank) {
    if (!CBZ.cityPostNpc) return null;
    let ped = null;
    try {
      ped = CBZ.cityPostNpc(x, z, {
        job: "terror attacker", archetype: "thug", armed: true, weapon: "AK-47",
        ammo: 120, aggr: 0.98,
      });
    } catch (e) { ped = null; }
    return armPed(ped, rank);
  }
  function stageAttackReal(t) {
    // a REAL attacker: prefer a live embodied cell body; else cast ONE at the
    // safehouse door through the sanctioned atom. The brain is aigoals'
    // rampage — no AI written here.
    let ped = null;
    const peds = CBZ.cityPeds || [];
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (p && !p.dead && p.organization === "cell") { ped = p; break; }
    }
    if (ped) armPed(ped, ped._cellRank || "bomber");
    if (!ped) {
      const sh = safehouses()[0];
      const sx = sh ? sh.cx : t.x + 26, sz = sh ? sh.cz : t.z + 26;
      ped = castAttacker(sx, sz, "bomber");
    }
    if (!ped) return false;
    if (CBZ.cityPanicRaise) { try { CBZ.cityPanicRaise(t.x, t.z, 1.6); } catch (e) {} }
    return true;
  }
  // ---- THE CAR. A real record out of vehicles.js's own makeCar, entered on
  // the access road GATE_APPROACH metres outside the leaf and driven up the
  // drive by this file (ai:false + road:null = the vehicle sim leaves a car
  // alone, so the roll below is the only thing moving it). It is a normal
  // car afterwards: shootable, stealable, and it stays at your gate.
  function spawnGateCar(t) {
    if (!CBZ.cityMakeCar || !CBZ.city || !CBZ.city.arena || !CBZ.city.arena.root) return null;
    const o = t.out || { x: 0, z: 1 };
    const sx = t.gx + o.x * GATE_APPROACH, sz = t.gz + o.z * GATE_APPROACH;
    // heading faces back down the drive: forward is (sin h, cos h)
    const heading = Math.atan2(-o.x, -o.z);
    let car = null;
    try { car = CBZ.cityMakeCar(sx, sz, heading, false, null, 0); } catch (e) { car = null; }
    if (!car) return null;
    car.ai = false; car.road = null; car.parked = false; car.v = GATE_ROLL_SPEED;
    car._presGateCar = true;
    return car;
  }
  function rollGateCar(A, dt) {
    const c = A.car, t = A.at;
    if (!c || c.dead || !c.pos) return;
    const o = t.out || { x: 0, z: 1 };
    const tx = t.gx + o.x * GATE_STOP, tz = t.gz + o.z * GATE_STOP;
    const dx = tx - c.pos.x, dz = tz - c.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.4) { c.v = 0; return; }
    const step = Math.min(GATE_ROLL_SPEED * dt, d);
    c.heading = Math.atan2(dx / d, dz / d);
    c.pos.x += (dx / d) * step;
    c.pos.z += (dz / d) * step;
    c.v = step / Math.max(dt, 0.001);
    if (c.group) c.group.rotation.y = c.heading;
  }
  // 2-3 gunmen out of the car, at the gate, on the rampage brain. The
  // Mansion's own detail (power.js's principal ring / protection.js) answers
  // this for free — there is no guard AI in this file and never will be.
  function stageGateAttack(A) {
    const t = A.at;
    const c = A.car;
    const bx = (c && c.pos) ? c.pos.x : t.x, bz = (c && c.pos) ? c.pos.z : t.z;
    const n = 2 + (h01(day(), st().attacksDone | 0, 0x5a1d) < 0.5 ? 0 : 1);
    let cast = 0;
    for (let i = 0; i < Math.min(n, GATE_ATTACKERS); i++) {
      const ped = castAttacker(bx + (i - 1) * 1.9, bz + 1.7, i === 0 ? "bomber" : "runner");
      if (ped) cast++;
    }
    if (!cast) {
      // the atom refused (no ped machinery this world) — fall back to the
      // safehouse cast so the attack is still bodies somewhere, then report.
      return stageAttackReal(t);
    }
    if (c) { c.v = 0; c.abandoned = true; }
    if (CBZ.cityPanicRaise) { try { CBZ.cityPanicRaise(t.x, t.z, 2.0); } catch (e) {} }
    return true;
  }
  function resolveAttack(realStaged, t) {
    const S = st();
    const h = seat();
    const recId = h ? h.id : (countryRecAny() ? countryRecAny().id : null);
    const atGate = !!(t && t.gate);
    S.attacksDone++;
    S.intelKnown = true;                                // the cell surfaced; the Bureau has a thread
    if (CBZ.cityEvent) { try { CBZ.cityEvent("terror-threat", { panic: 8, emergency: 6, confidence: -3 }); } catch (e) {} }
    if (recId) shock(recId, ATTACK_APPROVAL);
    if (atGate) {
      big(realStaged ? "GUNMEN AT YOUR GATE" : "THEY HIT THE MANSION GATE");
      news(realStaged
        ? "Gunmen hit the gate of the Executive Mansion. The Sons of the Dune claim the attack."
        : "Gunmen hit the gate of the Executive Mansion while the " + (h ? h.title : "head of state") + " was away. The Sons of the Dune claim it.");
      feed(realStaged ? "Shooting at the Mansion gate." : "Shooting reported at the Mansion gate.", "#ff8b6a");
    } else {
      big("ATTACK IN THE SALTLANDS");
      news(realStaged
        ? "Gunfire at the Dry Gulch market, the Sons of the Dune claim the attack."
        : "A bomb tears through the Dry Gulch market. The Sons of the Dune claim it; the count is still coming in.");
    }
    // `at` is the PLACE AS A NAME here (the HUD prints it straight); the
    // coordinates ride along as `where` for anyone who wants a waypoint.
    emitEvent("attack", {
      real: !!realStaged,
      at: t ? (t.name || null) : null,
      name: t ? (t.name || null) : null,
      gate: atGate,
      where: t ? { x: t.x, z: t.z } : null,
    });
    paintBoard();
  }
  // is the player close enough for this attack to be BODIES? For the market,
  // the old 150 m. For the gate, anywhere on his own compound.
  function attackIsNear(t) {
    const P = CBZ.player;
    if (!P || !P.pos || !t) return false;
    if (t.gate) {
      const s = t.site || mansionSite();
      if (!s) return false;
      return Math.hypot(P.pos.x - s.cx, P.pos.z - s.cz) < GATE_NEAR;
    }
    return Math.hypot(P.pos.x - t.x, P.pos.z - t.z) < ATTACK_NEAR;
  }
  function tickAttack(dt) {
    const A = ATT.armed;
    if (!A) return;
    A.t += dt;
    if (!A.lit) {
      if (attackIsNear(A.at)) {
        // THE FUSE. Twenty seconds of warning, then bodies — long enough for
        // the HUD to say it and for the player to run to the gate.
        A.lit = true; A.fuse = 0;
        if (A.at.gate) {
          A.car = spawnGateCar(A.at);
          orders("Mansion Detail", "Vehicle running the access road, twenty seconds out. Get off the lawn or get behind the wall.", 2);
          feed("A car is coming up the drive to YOUR gate.", "#ff9a6a");
        } else {
          feed("Something is about to happen at the Dry Gulch market.", "#ff9a6a");
        }
        emitEvent("attack-armed", armedPayload(A.at, ATTACK_WARN_SEC));
        return;
      }
      if (A.t > 60) {                                   // far away: it happens without you
        const t = A.at;
        ATT.armed = null;
        resolveAttack(false, t);
      }
      return;
    }
    A.fuse += dt;
    if (A.at.gate) rollGateCar(A, dt);
    if (A.fuse >= ATTACK_WARN_SEC) {
      const t = A.at;
      const staged = t.gate ? stageGateAttack(A) : stageAttackReal(t);
      ATT.armed = null;
      resolveAttack(staged, t);
    }
  }

  // ============================================================
  //  §5  THE BUREAU RAID — order real NPCs at real NPCs.
  // ============================================================
  const RAID = { phase: null, t: 0, agents: [], car: null, target: null, engaged: false };
  function orderRaid(h) {
    const S = st();
    const site = agencySite();
    const sh = safehouses()[0];
    if (!site || !sh) return { ok: false, why: "No target on the board." };
    if (!payTreasury(h.rec, RAID_COST)) return { ok: false, why: "The treasury would not cover it." };
    S.raidsOrdered++;
    RAID.phase = "muster"; RAID.t = 0; RAID.agents = []; RAID.car = null; RAID.engaged = false;
    RAID.target = { x: sh.cx, z: sh.cz, lot: sh };
    // real agents at the Bureau's own gate, through occupy's atom. They are
    // real bodies: shootable, arrestable, stealable-car-and-all.
    const gx = site.gate ? site.gate.x : site.cx, gz = site.gate ? site.gate.z : site.cz;
    for (let i = 0; i < RAID_AGENTS; i++) {
      let a = null;
      if (CBZ.cityPostNpc) {
        a = CBZ.cityPostNpc(gx + (i - 1) * 1.6, gz + 2.2, {
          job: "bureau agent", archetype: "agent", armed: true, weapon: "SMG", ammo: 120, aggr: 0.8, hp: 130,
        });
      }
      if (a) { a.organization = "agency"; a._presRaid = true; RAID.agents.push(a); }
    }
    if (!RAID.agents.length) { RAID.phase = null; return { ok: false, why: "The Bureau could not field a team." }; }
    // their car — a real vehicle beside them (checkpoints.js's cruiser rule:
    // never a prop). Black, unmarked, stealable.
    if (CBZ.cityMakeCar) {
      try {
        RAID.car = CBZ.cityMakeCar(gx + 6, gz + 4, 0, false, null, 0);
        if (RAID.car) { RAID.car.ai = false; RAID.car.v = 0; RAID.car.parked = true; RAID.car.road = null; }
      } catch (e) { RAID.car = null; }
    }
    orders("Bureau Director", "Team of " + RAID.agents.length + " rolling on the Saltlands safehouse in " + RAID_MUSTER_SEC + "s. Ride along or watch the wire.", 2);
    news("Bureau vehicles seen leaving headquarters at speed.");
    emitEvent("raid", { phase: RAID.phase, agents: RAID.agents.length });
    return { ok: true, why: "" };
  }
  function raidCasualties() {
    let dead = 0;
    for (let i = 0; i < RAID.agents.length; i++) if (!RAID.agents[i] || RAID.agents[i].dead) dead++;
    return dead;
  }
  function finishRaid(won, embodied) {
    const S = st();
    const h = seat();
    const recId = h ? h.id : (countryRecAny() ? countryRecAny().id : null);
    if (won) {
      S.raidsWon++;
      // the roster pays in people: bombers and runners first (the Bureau
      // goes in for the shooters), one in three taken alive.
      const live = livingCell();
      let hit = Math.min(live.length, 2 + ((h01(day(), S.raidsOrdered, 0x9b31) * 2) | 0));
      live.sort(function (a, b) { return (b.rank === "emir" ? 3 : b.rank === "bomber" ? 2 : b.rank === "runner" ? 1 : 0) - (a.rank === "emir" ? 3 : a.rank === "bomber" ? 2 : a.rank === "runner" ? 1 : 0); });
      let killed = 0, held = 0;
      for (let i = 0; i < hit; i++) {
        const m = live[i];
        if (h01(i, S.raidsOrdered, 0x9b32) < 0.34) { m.held = true; held++; }
        else {
          m.dead = true; killed++;
          if (CBZ.cityLogDeath) { try { CBZ.cityLogDeath(m.name, "shot", { by: "Bureau tactical" }); } catch (e) {} }
        }
      }
      if (CBZ.cityEvent) { try { CBZ.cityEvent("counterterror", {}); } catch (e) {} }
      if (recId) shock(recId, RAID_WIN_APPROVAL);
      big("SAFEHOUSE TAKEN");
      news("Bureau raid in the Saltlands: " + killed + " cell member(s) dead, " + held + " in custody" + (raidCasualties() ? ", " + raidCasualties() + " agent(s) lost." : "."));
      if (!livingCell().length) { big("THE CELL IS BROKEN"); news("The Sons of the Dune are finished, the board is clear."); }
    } else {
      S.raidsLost++;
      if (recId) shock(recId, RAID_LOSS_APPROVAL);
      news("Bureau raid repelled at the Saltlands safehouse, " + raidCasualties() + " agent(s) down. The cell is emboldened.");
      if (CBZ.cityEvent) { try { CBZ.cityEvent("terror-threat", { panic: 3 }); } catch (e) {} }
    }
    // walk survivors home (their post is done); the dead stay where they fell
    for (let i = 0; i < RAID.agents.length; i++) {
      const a = RAID.agents[i];
      if (a && !a.dead) { a.guard = null; a._presRaid = false; if (a.staffPost) a.staffPost = null; }
    }
    ballotPending = false; _einfo = null; _einfoKey = "";
    RAID.phase = null; RAID.agents = []; RAID.car = null; RAID.target = null;
    emitEvent("raid", { phase: null, won: !!won, embodied: !!embodied });
    paintBoard();
  }
  function tickRaid(dt) {
    if (!RAID.phase) return;
    RAID.t += dt;
    const P = CBZ.player;
    const near = P && P.pos && RAID.target && Math.hypot(P.pos.x - RAID.target.x, P.pos.z - RAID.target.z) < ATTACK_NEAR;
    if (RAID.phase === "muster") {
      if (RAID.t >= RAID_MUSTER_SEC) {
        RAID.phase = "breach"; RAID.t = 0;
        emitEvent("raid", { phase: RAID.phase });
        if (near) {
          // EMBODIED: the team appears on the approach (they drove — the
          // sealed-transit convention every transport in this repo uses),
          // then walks the last stretch on the ped brain's own guard field.
          embodySafehouses();
          for (let i = 0; i < RAID.agents.length; i++) {
            const a = RAID.agents[i];
            if (!a || a.dead || !a.pos) continue;
            const ang = (i / RAID.agents.length) * Math.PI * 2;
            a.pos.x = RAID.target.x + Math.cos(ang) * 26;
            a.pos.z = RAID.target.z + Math.sin(ang) * 26;
            if (a.group) a.group.position.set(a.pos.x, a.pos.y || 0, a.pos.z);
            a.staffPost = null; a.state = "walk"; a.speed = 0;
            a.guard = { x: RAID.target.x, z: RAID.target.z };
            if (a.target && a.target.set) a.target.set(RAID.target.x, 0, RAID.target.z);
          }
          feed("The Bureau team is on the ground.", "#8fc1ff");
        }
      }
      return;
    }
    if (RAID.phase === "breach") {
      if (near && !RAID.engaged) {
        RAID.engaged = true;
        // the breach: agents rage on the cell bodies, the cell's own brain
        // fights back — the exact guard/rage/state trio the alarm machinery
        // already writes. No new combat code.
        const peds = CBZ.cityPeds || [];
        for (let i = 0; i < peds.length; i++) {
          const p = peds[i];
          if (!p || p.dead || p.organization !== "cell" || !p.pos) continue;
          if (Math.hypot(p.pos.x - RAID.target.x, p.pos.z - RAID.target.z) > 40) continue;
          p.alarmed = true; p.state = "fight";
          const a = RAID.agents[i % RAID.agents.length];
          if (a && !a.dead) { p.rage = a; a.rage = p; a.state = "fight"; a.guard = null; }
        }
      }
      if (RAID.engaged) {
        // resolved when one side is done
        let cellLeft = 0;
        const peds = CBZ.cityPeds || [];
        for (let i = 0; i < peds.length; i++) {
          const p = peds[i];
          if (p && !p.dead && p.organization === "cell" && p.pos &&
              Math.hypot(p.pos.x - RAID.target.x, p.pos.z - RAID.target.z) < 46 && !p.surrender) cellLeft++;
        }
        const agentsLeft = RAID.agents.length - raidCasualties();
        if (RAID.t > 8 && (cellLeft === 0 || agentsLeft === 0)) finishRaid(cellLeft === 0 && agentsLeft > 0, true);
        else if (RAID.t > 180) finishRaid(agentsLeft > 0, true);
        return;
      }
      if (RAID.t >= RAID_ABSTRACT_SEC) {
        // you stayed away — it happens on the wire. The roll is against the
        // REAL sides: agents fielded vs living shooters.
        const shooters = livingCell().filter(function (m) { return m.rank !== "sympathizer"; }).length;
        const agentsLeft = RAID.agents.length - raidCasualties();
        const p = clamp(0.5 + 0.14 * (agentsLeft - shooters), 0.15, 0.9);
        const won = h01(day(), st().raidsOrdered, 0x9b30) < p;
        if (!won) {
          // losses on the abstract branch are real bodies too
          for (let i = 0; i < RAID.agents.length && i < 2; i++) {
            const a = RAID.agents[i];
            if (a && !a.dead && CBZ.cityKillPed) { try { CBZ.cityKillPed(a, { fatal: true }, "shot"); } catch (e) {} }
          }
        }
        finishRaid(won, false);
      }
    }
  }

  // ============================================================
  //  §6  THE FALLS — the ballot (a term you can lose), impeachment
  //  (scandal/approval), and the junta's knock after a coup. The last two end
  //  in games/jail.js's own transport pipe.
  // ============================================================

  // ------------------------------------------------------------
  //  §6b  THE BALLOT. elections.js runs the whole race — tickOffice() calls
  //  it at office.termDay − CAMPAIGN_DAYS, campaignDay() polls it every day
  //  of the window, resolve() counts it on termDay and writes office.holder.
  //  THIS FILE NEVER WRITES A RACE OR A HOLDER. It reads four public calls
  //  and reacts to them:
  //    CBZ.elections.openRaces()   per-seat callDay / daysLeft / phase
  //    CBZ.elections.playerRace()  the live race the player stands in, and
  //                                `me` — the player's own side of lastPoll
  //    CBZ.elections.status(id)    non-null ONLY while the race is uncounted
  //                                (the settle-ordering probe, below)
  //    CBZ.gov.holds()             via seat() — who holds the seat NOW
  //  _pollFor is a test hook and is NOT read here; `polling` is playerRace()'s
  //  `me`, which is elections' own lastPoll snapshot.
  // ------------------------------------------------------------
  // status() is read by the HUD strip every frame, and openRaces() walks
  // every office in the world — so the answer is cached on exactly the inputs
  // that can change it: the day, who holds the seat, and the term's end.
  let _einfo = null, _einfoKey = "";
  function electionInfo() {
    const h = seat();
    const rec = h ? h.rec : null;
    const office = rec && rec.office ? rec.office : null;
    const d = day();
    const key = d + "|" + (h ? h.id : "-") + "|" + (office ? String(office.holder) : "-")
      + "|" + (office && office.termDay != null ? office.termDay : "-");
    if (_einfo && _einfoKey === key) {
      return { callDay: _einfo.callDay, voteDay: _einfo.voteDay, campaigning: _einfo.campaigning, polling: _einfo.polling };
    }
    const E = CBZ.elections;
    let voteDay = office && office.termDay != null ? office.termDay : null;
    let callDay = voteDay != null ? voteDay - CAMPAIGN_LEAD : null;
    let campaigning = false, polling = null;
    if (h && E && E.openRaces) {
      try {
        const rows = E.openRaces() || [];
        for (let i = 0; i < rows.length; i++) {
          if (!rows[i] || rows[i].id !== h.id) continue;
          const r = rows[i];
          campaigning = r.phase === "campaign";
          if (r.daysLeft != null) voteDay = d + r.daysLeft;
          callDay = r.callDay != null ? r.callDay
            : (voteDay != null ? voteDay - (r.campaignDays || CAMPAIGN_LEAD) : null);
          break;
        }
      } catch (e) {}
    }
    if (h && E && E.playerRace) {
      try {
        const pr = E.playerRace();
        if (pr && pr.id === h.id) {
          campaigning = true;
          if (pr.daysLeft != null) voteDay = d + pr.daysLeft;
          if (pr.me != null) polling = pr.me;
        }
      } catch (e) {}
    }
    _einfoKey = key;
    _einfo = { callDay: callDay, voteDay: voteDay, campaigning: campaigning, polling: polling };
    return { callDay: callDay, voteDay: voteDay, campaigning: campaigning, polling: polling };
  }
  // who is the president running against? elections' own candidate list.
  function challengerName(id) {
    const E = CBZ.elections;
    if (!E || !E.status) return null;
    let s = null;
    try { s = E.status(id); } catch (e) {}
    if (!s || !s.candidates) return null;
    for (let i = 0; i < s.candidates.length; i++) {
      const c = s.candidates[i];
      if (c && c.type !== "incumbent") return c.name || null;
    }
    return null;
  }
  // A NEW TERM BUYS THE CELL A NEW BOMBER — the roster shape seedRoster()
  // already mints (a parked ledger identity + a rank), never a second kind of
  // enemy. Deterministic off the term number, like everything else here.
  function recruitBomber() {
    const S = st();
    if (!CFG.PRESIDENCY_TERROR || !CBZ.cityPedStash) return null;
    const stream = CBZ.seedStream ? CBZ.seedStream("presidency:cell:term" + (S.terms | 0)) : rng;
    const gender = stream() < 0.7 ? "m" : "f";
    const name = CBZ.cityMintName ? CBZ.cityMintName(stream, gender) : ("Cell Member " + (S.roster.length + 1));
    const obj = {
      _parked: true, nameKnown: true, kind: "civilian", archetype: "thug",
      name: name, gender: gender, job: "quarry worker", wealth: 0.2, aggr: 0.85,
      cash: 40 + Math.round(stream() * 200),
    };
    try { CBZ.cityPedStash(obj); } catch (e) {}
    const m = { sid: obj._sid || ("cell_term" + (S.terms | 0)), name: name, rank: "bomber", dead: false, held: false };
    S.roster.push(m);
    return m;
  }
  function wonTerm(d, h) {
    const S = st();
    S.terms = (S.terms | 0) + 1;
    const termDay = h.rec.office && h.rec.office.termDay != null ? h.rec.office.termDay : null;
    emitEvent("reelected", { day: d, seat: h.id, terms: S.terms, termDay: termDay });
    big("RE-ELECTED FOR ANOTHER TERM");
    news("The count is in: " + (h.title || "the President") + " holds " + (h.rec.name || "the country") + " for a second term.");
    const m = recruitBomber();
    orders("Chief of Staff",
      "Term " + S.terms + "." + (termDay != null ? " The country votes again on day " + termDay + "." : "")
      + (m ? " The Bureau says the cell swore in a new bomber the same night." : ""), 2);
  }
  function lostTerm(d) {
    const S = st();
    emitEvent("defeated", { day: d, seat: S.lastSeatId || null, terms: S.terms | 0 });
    big("DEFEATED AT THE BALLOT");
    news("The count is in. The Republic has a new president.");
    // NOT ONE WRITE TO office.holder — elections' resolve() already moved the
    // seat, statecraft's holds() already reads empty, power.js re-reads the
    // record, and doorOpensFor() seals the Situation Room because seat() is
    // null. The presidency does nothing here but say so.
    orders("Chief of Staff", "You are a private citizen. The detail stands down at midnight. The gate is no longer yours.", 2);
  }
  // THE SETTLE. Ordering: polity fires its onNewDay subscribers in
  // REGISTRATION order, and elections.js is parsed at index.html:1903 against
  // this file's :2105 — so on the vote day elections' resolve() has already
  // run by the time our day tick reads seat(). That is not a fact worth
  // betting a whole mode on, so this probes for it: while elections.status()
  // still returns a live race for the seat, the count is not in and the
  // settle is retried from the update tick on a later frame.
  let ballotPending = false;
  function settleBallot(d) {
    const S = st();
    const id = S.lastSeatId;
    S.voteDay = null;
    if (!id) return true;
    if (CBZ.elections && CBZ.elections.status) {
      let live = null;
      try { live = CBZ.elections.status(id); } catch (e) {}
      if (live) { S.voteDay = d; return false; }        // uncounted — try again
    }
    const h = seat();
    if (h && h.id === id) wonTerm(d, h); else lostTerm(d);
    return true;
  }
  // THE DAY TICK'S BALLOT HALF: announce the race when elections calls it,
  // and settle it on the day it is counted.
  function tickBallotDay(d) {
    const S = st();
    // a conviction is not a ballot — the Senate already took the seat, and
    // §6's own arrest path owns what happens next.
    if (S.impeached) { S.voteDay = null; S.campaignFor = null; return; }
    const h = seat();
    if (h) S.lastSeatId = h.id;
    const E = electionInfo();
    if (h && E.campaigning && E.voteDay != null && S.campaignFor !== E.voteDay) {
      S.campaignFor = E.voteDay;
      S.voteDay = E.voteDay;
      const who = challengerName(h.id);
      emitEvent("campaign", { day: d, voteDay: E.voteDay, polling: E.polling, challenger: who || null, seat: h.id });
      // no big() here: elections.js's callElection already spent one on "YOU
      // ARE ON THE BALLOT" this same tick. The orders line is the new thing.
      orders("Chief of Staff",
        "The race is called. " + (E.polling != null
          ? "You poll " + Math.round(E.polling) + " to " + Math.round(100 - E.polling) + " against " + (who || "the challenger") + "."
          : "You are on the ballot against " + (who || "a challenger") + ".")
        + " Vote is day " + E.voteDay + ". Approval is the ballot: address the nation, break the cell, keep the wall standing, and do not let them hit us again.", 2);
    }
    if (S.voteDay != null && d >= S.voteDay) {
      if (!settleBallot(d)) ballotPending = true;
    }
  }
  function arrestNow(why, title) {
    const S = st();
    S.arrestArmed = false;
    g._jailSentenceIn = JAIL_SENTENCE_SEC;
    g._jailBailIn = JAIL_BAIL;
    const go = function () {
      if (CBZ.cityArrestToPrison) { try { CBZ.cityArrestToPrison(); return; } catch (e) {} }
      if (CBZ.setMode) CBZ.setMode("escape");
      if (CBZ.setRole) CBZ.setRole("inmate");
      if (CBZ.startRun) CBZ.startRun();
    };
    emitEvent("arrest", { why: why || null, title: title || "UNDER ARREST", impeached: !!S.impeached });
    big(title || "UNDER ARREST");
    if (CBZ.cityBustOverlay) { try { CBZ.cityBustOverlay(0, go, { title: title || "ARRESTED", note: why }); return; } catch (e) {} }
    go();
  }
  function inCountry(rec) {
    const P = CBZ.player;
    if (!P || !P.pos || !CBZ.polity || !CBZ.polity.of) return true;
    const loc = CBZ.polity.of(P.pos.x, P.pos.z);
    const c = loc && CBZ.polity.countryOf ? CBZ.polity.countryOf(loc.id) : null;
    return !!(c && rec && c.id === rec.id);
  }
  function tickFallsDay(d) {
    if (!on() || !CFG.PRESIDENCY_FALLS) return;
    const S = st();
    const h = seat();
    if (h) {
      S.wasPresident = true;
      S.lastSeatId = h.id;
      const p = politics();
      // ---- SCANDAL DRIFTS TOWARD TYRANNY. p.scandal is the field approval.js
      // already reads (events -= scandal*0.1) and statecraft already writes on
      // a corruption discovery; this is the SAME number, moved by the same
      // day, not a second meter. See the SCANDAL_* comment at the top for why
      // each term is there. Deterministic: every input is a system read.
      const tyr = (CBZ.gov && CBZ.gov.tyranny) ? CBZ.gov.tyranny() : 0;
      const attacksToday = Math.max(0, (S.attacksDone | 0) - (S.attacksSeen | 0));
      S.attacksSeen = S.attacksDone | 0;
      const addressed = S.lastAddressDay >= d - 1;      // spoke since yesterday's tick
      if (p) {
        p.scandal = clamp((p.scandal || 0) + (tyr - (p.scandal || 0)) * SCANDAL_PULL
          + attacksToday * SCANDAL_PER_ATTACK - (addressed ? SCANDAL_ADDRESS_RELIEF : 0), 0, 100);
      }
      const scandal = (p && p.scandal) || 0;
      const approval = h.rec.approval || 0;
      const bad = scandal >= IMPEACH_SCANDAL || (approval < IMPEACH_APPROVAL && scandal >= IMPEACH_SCANDAL_LO);
      const numbers = "Scandal " + Math.round(scandal) + " (limit " + IMPEACH_SCANDAL
        + "), approval " + Math.round(approval) + " (floor " + IMPEACH_APPROVAL + " while scandal is over " + IMPEACH_SCANDAL_LO + ").";
      if (bad && S.impeachDay == null) {
        S.impeachDay = d + 2;
        emitEvent("impeach", { day: S.impeachDay, scandal: scandal, approval: approval });
        big("ARTICLES OF IMPEACHMENT FILED");
        orders("Chief of Staff", "The Capitol has the votes and the auditors have the ledgers. " + numbers
          + " The Senate votes on day " + S.impeachDay + " — two days. Get under those numbers or start packing.", 2);
      } else if (S.impeachDay != null && !bad) {
        S.impeachDay = null;
        news("The impeachment collapses, the scandal went quiet before the vote.");
      } else if (S.impeachDay != null && d < S.impeachDay) {
        orders("Chief of Staff", "Impeachment vote in " + (S.impeachDay - d) + " day(s). " + numbers
          + " An address buys " + SCANDAL_ADDRESS_RELIEF + " points back; every order given by force adds more.", 2);
      } else if (S.impeachDay != null && d >= S.impeachDay) {
        // CONVICTED. The seat moves through the record's own fields (the
        // same holder/vacuum bookkeeping regimes' restoration writes), the
        // stand-down is statecraft's own holds()-went-null sweeper, and the
        // snap election is elections.js's own vacuum path.
        S.impeachDay = null; S.impeached = true;
        const rec = h.rec;
        rec.office.holder = rec.office.deputy || null;
        rec.office.deputy = null;
        rec.vacuum = d;
        big("CONVICTED, REMOVED FROM OFFICE");
        news("The Senate convicts. The presidency is stripped; the marshals have a warrant.");
        S.arrestArmed = true; S.arrestT = 0; S.arrestWhy = "Corruption in office";
        orders("Marshals Service", "You have " + ARREST_GRACE_SEC + " seconds to surrender at the Mansion. Cross the border and you are a fugitive instead.", 2);
      }
    } else if (S.wasPresident && S.lastSeatId && CBZ.polity && CBZ.polity.get) {
      // THE JUNTA'S KNOCK — civilwar's coup stamped a "junta general" onto
      // the seat you held. Deposed presidents get arrested or get out.
      const rec = CBZ.polity.get(S.lastSeatId);
      const holderSid = rec && rec.office ? rec.office.holder : null;
      if (rec && holderSid && !S.arrestArmed && !S.impeached) {
        const e = CBZ.cityLedgerEntry ? CBZ.cityLedgerEntry(holderSid) : null;
        if (e && /junta|dictator/.test(String(e.job || ""))) {
          S.wasPresident = false;
          S.arrestArmed = true; S.arrestT = 0; S.arrestWhy = "Enemies of the junta";
          big("THE JUNTA COMES FOR YOU");
          orders("A voice you know", "They are already moving. Get out of the country or disappear into a cell.", 2);
        }
      }
    }
  }
  function tickArrest(dt) {
    const S = st();
    if (!S.arrestArmed) return;
    S.arrestT += dt;
    const rec = S.lastSeatId && CBZ.polity && CBZ.polity.get ? CBZ.polity.get(S.lastSeatId) : null;
    if (S.arrestT >= ARREST_GRACE_SEC) {
      if (inCountry(rec)) { arrestNow(S.arrestWhy || "Removed from office", S.impeached ? "IMPEACHED" : "TAKEN"); }
      else {
        // you ran — the manhunt is the price of freedom, through wanted.js
        S.arrestArmed = false;
        if (CBZ.cityAddStars) { try { CBZ.cityAddStars(4, "Fugitive head of state"); } catch (e) {} }
        news("The warrant stands. The ex-president is a fugitive.");
      }
    }
  }

  // ============================================================
  //  §7  THE TICKS — one update slot, throttled inside; one day tick.
  // ============================================================
  let doorT = 0, embodyT = 0, boardT = 0;
  // 38.78 — free (38.7 is a shared band, 38.72 officialdom, 38.74 govcomplex,
  // 38.76 cashstore, 38.8 empire; measured by grep before claiming).
  if (CBZ.onUpdate) CBZ.onUpdate(38.78, function (dt) {
    if (!on() || !g || g.mode !== "city") return;
    // build lazily once the govcomplex site exists (worldgen order)
    if (CFG.PRESIDENCY_SITROOM && (!ROOM.group || ROOM.builtFor !== CBZ.govComplexes)) buildRoom();
    // interactions.js parses after this file in some entry paths. Retry the
    // two idempotent registrations even when the room itself is already built.
    wireZones();
    tickOfficers(dt);
    tickSeam(dt);
    declareCell();
    // the door — slides for the sitting head of state, seals behind anyone
    // else. The collider IS the lock; there is no invisible wall.
    doorT -= dt;
    if (ROOM.door && doorT <= 0) {
      doorT = 0.12;
      const P = CBZ.player;
      const nearDoor = P && P.pos && ROOM.doorPt && Math.hypot(P.pos.x - ROOM.doorPt.x, P.pos.z - ROOM.doorPt.z) < 3.4;
      const inside = P && P.pos && inRoom(P.pos.x, P.pos.z);
      // the door always opens from the INSIDE (a push bar, not a cell) —
      // losing the seat while standing at the table must never trap you.
      const want = (inside || (nearDoor && doorOpensFor())) ? 1 : 0;
      if (want !== ROOM.doorOpen) {
        ROOM.doorOpen = want;
        const sl = ROOM.doorSlide || { x: 0, z: 1 };
        ROOM.door.position.x = ROOM.doorHome.x + sl.x * (want ? 2.25 : 0);
        ROOM.door.position.z = ROOM.doorHome.z + sl.z * (want ? 2.25 : 0);
        const ci = CBZ.colliders.indexOf(ROOM.doorCol);
        if (want && ci >= 0) CBZ.colliders.splice(ci, 1);
        else if (!want && ci < 0) CBZ.colliders.push(ROOM.doorCol);
        if (CBZ.markCollidersDirty) { try { CBZ.markCollidersDirty(); } catch (e) {} }
      }
      // repaint the board while somebody is in the room (1s cadence)
      boardT -= 0.12;
      if (inside && boardT <= 0) { boardT = 1.0; paintBoard(); }
    }
    embodyT -= dt;
    if (embodyT <= 0) { embodyT = 2.0; embodySafehouses(); }
    tickAttack(dt);
    tickRaid(dt);
    tickArrest(dt);
    // the one-shot the ballot settle asks for when the count was not in yet
    // (see settleBallot). Retried on a later frame; never polled otherwise.
    if (ballotPending && settleBallot(day())) ballotPending = false;
  });
  if (CBZ.onNewDay) CBZ.onNewDay(function (d) {
    if (!on()) return;
    try { tickCellDay(d); } catch (e) { try { console.error("[presidency] cell tick failed", e); } catch (e2) {} }
    // the ballot BEFORE the falls: on a vote day elections.js has already
    // written the seat, so settling first means tickFallsDay reads the world
    // the player actually woke up in (president, or private citizen).
    try { tickBallotDay(d); } catch (e) { try { console.error("[presidency] ballot tick failed", e); } catch (e2) {} }
    try { tickFallsDay(d); } catch (e) { try { console.error("[presidency] falls tick failed", e); } catch (e2) {} }
    try { paintBoard(); } catch (e) {}
  });

  // ============================================================
  //  §10  THE SEAM — who is President, where he will be today, and what the
  //  country does the moment somebody kills him. Hitman mode (agency.js)
  //  plans its finale against exactly these four reads, so their shapes are
  //  a contract:
  //    current()          { kind:"player"|"npc"|"vacant", ped, sid, name, title, seatId }
  //    schedule()         today's public appearances (president_public.js owns
  //                       the diary; this is the stable name other modes call)
  //    onAssassinated(cb) cb({ victim:{kind,name,sid}, cause, at:{x,z},
  //                       successor:{kind,name,sid,how}, day }) for ANY death
  //                       of the sitting head of state, player or NPC
  //    lockdown()         { active, since, until, reason }
  //  The succession itself is officials.js's (deputy sworn in, else vacuum).
  //  This file adds what a country does on top: a national emergency, a
  //  lockdown of the capital, and a junta when nobody legal is left to sit.
  // ============================================================
  const PLAYER_SID_ = (CBZ.officials && CBZ.officials.PLAYER_SID) || "player";
  const LOCKDOWN_DAYS = 1.4;          // PACE days: ~3.5 real minutes of roadblocks and closed gates
  const SEAM = { subs: [], fired: {}, lock: { active: false, since: 0, until: 0, reason: null }, pollT: 0, lastSid: null, lastPed: null, wrapped: false };
  function dayTime() { return CBZ.dayTime ? CBZ.dayTime() : day(); }
  function presRec() {
    const h = seat(); if (h) return h.rec;
    const S = st();
    if (S.lastSeatId && CBZ.polity && CBZ.polity.get) { try { const r = CBZ.polity.get(S.lastSeatId); if (r) return r; } catch (e) {} }
    return countryRecAny();
  }
  function nameOfSid(sid) {
    if (!sid) return null;
    if (CBZ.officials && CBZ.officials.identityOf) { try { const id = CBZ.officials.identityOf(sid); if (id && id.name) return id.name; } catch (e) {} }
    if (CBZ.cityLedgerEntry) { try { const e = CBZ.cityLedgerEntry(sid); if (e && e.name) return e.name; } catch (e) {} }
    return null;
  }
  function titleOfRec(rec) {
    if (CBZ.officials && CBZ.officials.titleFor) { try { return CBZ.officials.titleFor(rec); } catch (e) {} }
    return "President";
  }
  function current() {
    const h = seat();
    if (h) {
      const P = CBZ.player;
      let nm = null;
      if (CBZ.cityPlayerName) { try { nm = CBZ.cityPlayerName(); } catch (e) {} }
      return { kind: "player", ped: P || null, sid: PLAYER_SID_, name: nm || (P && P.name) || "The President", title: h.title || "President", seatId: h.id };
    }
    const rec = presRec();
    const sid = rec && rec.office ? rec.office.holder : null;
    if (!sid) return { kind: "vacant", ped: null, sid: null, name: null, title: null, seatId: rec ? rec.id : null };
    const site = mansionSite();
    const ped = site && site.actor && !site.actor.dead && site.actor._sid === sid ? site.actor : null;
    return { kind: "npc", ped: ped, sid: sid, name: nameOfSid(sid) || (ped && ped.name) || "The President", title: titleOfRec(rec), seatId: rec.id };
  }
  function schedule(d) {
    const pub = CBZ.presidentPublic;
    if (pub && typeof pub.schedule === "function") { try { return pub.schedule(d) || []; } catch (e) {} }
    return [];
  }
  function onAssassinated(cb) {
    if (typeof cb !== "function") return function () {};
    SEAM.subs.push(cb);
    return function off() { const i = SEAM.subs.indexOf(cb); if (i >= 0) SEAM.subs.splice(i, 1); };
  }
  function lockdownRead() {
    const L = SEAM.lock;
    return { active: !!L.active, since: L.since, until: L.until, reason: L.reason };
  }
  function setLockdown(active, reason) {
    const L = SEAM.lock;
    if (active) {
      // stamped on the SKY clock (president_public.js compares it to the
      // appearance timetable) but sized in PACE days of real play
      L.active = true; L.since = dayTime(); L.until = L.since + LOCKDOWN_DAYS * CBZ.PACE_DAY_SECONDS / CBZ.dayCycleSeconds(); L.reason = reason || "assassination";
    } else {
      if (!L.active) return;
      L.active = false; L.reason = null;
    }
    emitEvent("lockdown", { active: !!active, reason: reason || null, until: L.until });
  }
  // THE CAUSE. officials.js's wrap swallows cityKillPed's third argument, so
  // this file keeps its own thin wrap that only WRITES the cause onto the body
  // before the chain runs (the officials subscriber then reads it back).
  function wrapKillCause() {
    if (SEAM.wrapped) return;
    const orig = CBZ.cityKillPed;
    if (typeof orig !== "function") return;
    SEAM.wrapped = true;
    if (orig._presCauseWrap) return;
    const w = function (ped, imp, cause) {
      if (ped && !ped.dead) {
        let c = cause;
        if (!c && imp) c = imp.cause || imp.kind || imp.type || (imp.explosive ? "explosion" : null) || (imp.weapon ? "shot" : null);
        ped._presCause = c || "killed";
        const P = CBZ.player;
        ped._presByPlayer = !!(imp && (imp.byPlayer || imp.src === "player" || imp.attacker === P || imp.from === P));
      }
      return orig.apply(this, arguments);
    };
    for (const k in orig) { if (/Wrap(ped)?$/.test(k)) w[k] = orig[k]; }
    w._presCauseWrap = true;
    CBZ.cityKillPed = w;
  }
  function news(headline, opts) {
    const O = CBZ.presidentOffice;
    if (O && typeof O.news === "function") { try { O.news(headline, opts || { kind: "breaking" }); return; } catch (e) {} }
  }
  // WHO SITS NOW. officials.js has already moved the ledger by the time the
  // death subscriber runs: the deputy holds the seat, or nobody does. A seat
  // with nobody in it during a national emergency does not stay empty. The
  // General takes it, the regime becomes a dictatorship, and the dressing on
  // the Mansion (president_regime.js) turns into a junta's. The same happens
  // if the country was already under emergency rule past 70: the army does
  // not hand power to a civilian in the middle of a crisis it was given.
  function resolveSuccession(rec) {
    const sid = rec && rec.office ? rec.office.holder : null;
    const p = politics();
    const emergency = (p && p.emergencyPowers) || 0;
    const cab = cabinet();
    const gen = cab.general && !cab.general.dead ? cab.general : null;
    if (gen && rec && rec.office && (!sid || (emergency >= 70 && h01(day(), emergency | 0, 7717) < 0.6))) {
      rec.office.holder = gen.sid;
      rec.office.deputy = null;
      if (CBZ.regimes && CBZ.regimes.transition) { try { CBZ.regimes.transition(rec, "dictatorship", day(), -4); } catch (e) {} }
      return { kind: "npc", name: gen.name, sid: gen.sid, how: "junta" };
    }
    if (sid) return { kind: sid === PLAYER_SID_ ? "player" : "npc", name: nameOfSid(sid) || "the Vice President", sid: sid, how: "deputy" };
    return { kind: "vacant", name: null, sid: null, how: "vacuum" };
  }
  function fireAssassinated(rec, sid, ped) {
    if (!sid || SEAM.fired[sid]) return;
    SEAM.fired[sid] = true;
    const wasPlayer = sid === PLAYER_SID_;
    const P = CBZ.player;
    const body = wasPlayer ? P : ped;
    const at = body && body.pos ? { x: body.pos.x, z: body.pos.z } : null;
    const cause = wasPlayer ? ((P && P._deathCause) || "killed") : ((ped && ped._presCause) || "killed");
    let pname = null;
    if (wasPlayer && CBZ.cityPlayerName) { try { pname = CBZ.cityPlayerName(); } catch (e) {} }
    const victim = { kind: wasPlayer ? "player" : "npc", name: wasPlayer ? (pname || (P && P.name) || "The President") : (nameOfSid(sid) || (ped && ped.name) || "The President"), sid: sid };
    const successor = resolveSuccession(rec);
    // A NATIONAL EMERGENCY, in the fields that already mean one:
    // emergencyPowers (regimes.js's ladder reads it), and a rally round the
    // new holder, who inherits a grieving country rather than an angry one.
    const pol = politics();
    if (pol) pol.emergencyPowers = clamp((pol.emergencyPowers || 0) + 25, 0, 100);
    if (rec && successor.sid) shock(rec.id, 6);
    setLockdown(true, "assassination");
    SEAM.lastSid = successor.sid;
    SEAM.lastPed = null;
    const payload = { victim: victim, cause: cause, at: at, successor: successor, day: day(), byPlayer: !!(ped && ped._presByPlayer) };
    emitEvent("assassinated", payload);
    emitEvent("succession", { successor: successor, day: day() });
    emitEvent("emergency", { level: (pol && pol.emergencyPowers) || 0, reason: "assassination" });
    for (let i = 0; i < SEAM.subs.length; i++) { try { SEAM.subs[i](payload); } catch (e) {} }
    const who = victim.name;
    news(who + " is dead", { kind: "breaking" });
    if (successor.how === "junta") news("The army has taken the capital. " + successor.name + " speaks for the nation.", { kind: "breaking" });
    else if (successor.sid) news(successor.name + " sworn in", { kind: "breaking" });
    // THE PLAYER'S OWN DEATH IN OFFICE is the end of the story he was in. It
    // gets the one full-screen beat the phone keeps for endings, dressed as
    // what it is in the world: tomorrow's front page. The world goes on
    // without him (officials.js already swore the next one in).
    if (wasPlayer && CBZ.campaignUI && CBZ.campaignUI.takeover) {
      setTimeout(function () {
        try {
          CBZ.campaignUI.takeover({
            eyebrow: "LATE EDITION",
            title: "THE PRESIDENT IS DEAD",
            sub: successor.how === "junta" ? "The army holds the capital" : (successor.name ? successor.name + " takes the oath" : "The capital in lockdown"),
            body: "Shot in the " + (st().terms > 1 ? "second" : "first") + " term. The Mansion gates are closed and soldiers stand at every road in.",
          });
        } catch (e) {}
      }, 3200);
    }
  }
  if (CBZ.onOfficialDeath) CBZ.onOfficialDeath(function (rec, sid) {
    if (!rec || rec.kind !== "country" || !sid) return;
    // Only the man who SAT. officials.js also calls its subscribers when a
    // deputy dies; the last polled holder is the difference.
    if (sid !== SEAM.lastSid) return;
    const pr = presRec();
    if (pr && rec.id !== pr.id && rec.id !== st().lastSeatId) return;
    fireAssassinated(rec, sid, arguments[2] || null);
  });
  function tickSeam(dt) {
    wrapKillCause();
    SEAM.pollT -= dt;
    if (SEAM.pollT > 0) return;
    SEAM.pollT = 0.5;
    const cur = current();
    // FALLBACK for a body that died without passing cityKillPed (a sweep that
    // stamps .dead directly): the head of state we polled is dead and nobody
    // fired. Succession did not run through officials.js either, so this is
    // the one place that has to ask for it.
    if (SEAM.lastPed && SEAM.lastPed.dead && SEAM.lastSid && !SEAM.fired[SEAM.lastSid]) {
      const rec = presRec();
      if (rec && rec.office && rec.office.holder === SEAM.lastSid) {
        rec.office.holder = rec.office.deputy || null;
        rec.office.deputy = null;
      }
      fireAssassinated(rec, SEAM.lastSid, SEAM.lastPed);
      return;
    }
    if (cur.sid && cur.sid !== SEAM.lastSid) {
      SEAM.lastSid = cur.sid;
      if (cur.sid === PLAYER_SID_) delete SEAM.fired[PLAYER_SID_];   // a new term is a new life
    }
    if (cur.ped && cur.kind === "npc") SEAM.lastPed = cur.ped;
    else if (cur.kind === "player") SEAM.lastPed = null;
    if (SEAM.lock.active && dayTime() > SEAM.lock.until) setLockdown(false);
  }

  // ============================================================
  //  §8  PERSISTENCE — the P-wave dual-rider pattern with the one-shot
  //  install guard (module-local boolean, checked BEFORE ever wrapping).
  // ============================================================
  function serialize() {
    const S = st();
    return {
      v: 1, began: !!S.began, lastAddressDay: S.lastAddressDay,
      roster: S.roster.map(function (m) { return { sid: m.sid, name: m.name, rank: m.rank, dead: !!m.dead, held: !!m.held }; }),
      rosterSeeded: !!S.rosterSeeded, supply: S.supply | 0,
      lastAttackDay: S.lastAttackDay, attacksDone: S.attacksDone | 0,
      runsBlocked: S.runsBlocked | 0, runsThrough: S.runsThrough | 0,
      intelKnown: !!S.intelKnown,
      raidsOrdered: S.raidsOrdered | 0, raidsWon: S.raidsWon | 0, raidsLost: S.raidsLost | 0,
      impeachDay: S.impeachDay, impeached: !!S.impeached,
      wasPresident: !!S.wasPresident, lastSeatId: S.lastSeatId || null,
      terms: S.terms | 0, voteDay: S.voteDay, campaignFor: S.campaignFor,
      attacksSeen: S.attacksSeen | 0,
      cabinet: S.cabinet ? JSON.parse(JSON.stringify(S.cabinet)) : null,
      staff: S.staff ? JSON.parse(JSON.stringify(S.staff)) : null,
      lock: SEAM.lock.active ? { since: SEAM.lock.since, until: SEAM.lock.until, reason: SEAM.lock.reason } : null,
    };
  }
  function apply(obj) {
    g.presWorld = fresh();
    if (!obj || obj.v !== 1) return;
    const S = st();
    S.began = !!obj.began; S.lastAddressDay = isFinite(obj.lastAddressDay) ? obj.lastAddressDay : -999;
    S.roster = Array.isArray(obj.roster) ? obj.roster.map(function (m) { return { sid: m.sid, name: m.name, rank: m.rank, dead: !!m.dead, held: !!m.held }; }) : [];
    S.rosterSeeded = !!obj.rosterSeeded;
    S.supply = obj.supply | 0;
    S.lastAttackDay = isFinite(obj.lastAttackDay) ? obj.lastAttackDay : -999;
    S.attacksDone = obj.attacksDone | 0; S.runsBlocked = obj.runsBlocked | 0; S.runsThrough = obj.runsThrough | 0;
    S.intelKnown = !!obj.intelKnown;
    S.raidsOrdered = obj.raidsOrdered | 0; S.raidsWon = obj.raidsWon | 0; S.raidsLost = obj.raidsLost | 0;
    S.impeachDay = obj.impeachDay != null ? obj.impeachDay : null;
    S.impeached = !!obj.impeached;
    S.wasPresident = !!obj.wasPresident; S.lastSeatId = obj.lastSeatId || null;
    S.terms = obj.terms | 0;
    S.voteDay = obj.voteDay != null ? obj.voteDay : null;
    S.campaignFor = obj.campaignFor != null ? obj.campaignFor : null;
    // a save written before the drift existed has no counter — start it at
    // whatever has already happened, so an old blob does not price every past
    // attack into today's scandal.
    S.attacksSeen = obj.attacksSeen != null ? (obj.attacksSeen | 0) : (S.attacksDone | 0);
    S.cabinet = obj.cabinet && typeof obj.cabinet === "object" ? obj.cabinet : null;
    S.staff = obj.staff && typeof obj.staff === "object" ? obj.staff : null;
    if (obj.lock && isFinite(obj.lock.until)) { SEAM.lock.active = true; SEAM.lock.since = obj.lock.since; SEAM.lock.until = obj.lock.until; SEAM.lock.reason = obj.lock.reason || "assassination"; }
  }
  function stamp() { const led = g.cityWorld; if (led && typeof led === "object") led.pres = serialize(); }
  let _wrapsDone = false;
  function ensureSaveWraps() {
    if (_wrapsDone) return;
    _wrapsDone = true;
    const c = CBZ.cityWorldCommit;
    if (typeof c === "function" && !c._presWrap) {
      const w = function () { stamp(); return c.apply(this, arguments); };
      w._presWrap = true; CBZ.cityWorldCommit = w;
    }
    const cc = CBZ.cityWorldCollect;
    if (typeof cc === "function" && !cc._presWrap) {
      const w2 = function () { stamp(); return cc.apply(this, arguments); };
      w2._presWrap = true; CBZ.cityWorldCollect = w2;
    }
  }
  let _hydrated = null;
  function hydrate() {
    const led = g.cityWorld;
    if (!led || led === _hydrated) return;
    _hydrated = led;
    if (led.pres) apply(led.pres);
  }
  // 46.27 — free by grep (46.18 polwar, 46.19 migration, 46.2 countries,
  // 46.21 civilwar, 46.22-46.26 the sim family). Sits after every record we
  // hydrate against.
  if (CBZ.onUpdate) CBZ.onUpdate(46.27, function () {
    if (!g) return;
    ensureSaveWraps();
    hydrate();
  });

  // ============================================================
  //  §9  AUDIT + PUBLIC API — the orchestrator runs presidencyAudit().
  // ============================================================
  function audit() {
    const h = seat();
    const S = st();
    const W = CBZ.stateWall && CBZ.stateWall.status ? CBZ.stateWall.status() : null;
    let IA = { namedRooms: 0, usableProps: 0, stateSymbols: 0, emptyDecor: 0, roomNames: [], orderProps: [] };
    if (CBZ.presidentInteriorAudit) { try { IA = CBZ.presidentInteriorAudit() || IA; } catch (e) {} }
    const architecture = mansionSite()
      ? ["monumental order", "slate roof", "carved mansion seal", "state standard", "ceremonial fountain"]
      : [];
    let buttons = 0, live = 0, moveless = 0;
    for (const k in BUTTONS) {
      buttons++;
      if (!(BUTTONS[k].moves || []).length) moveless++;   // a button that names no seam is a fiction
      let lv = false;
      try { lv = !!BUTTONS[k].live(); } catch (e) {}
      if (lv) live++;
    }
    return {
      holder: h ? h.id : null,
      title: h ? h.title : null,
      sitRoomBuilt: !!ROOM.group,
      sitRoomButtons: buttons,
      buttonsLive: live,
      buttonsMoveless: moveless,                          // pinned at 0 — every order names its seam
      wallSegments: W ? W.built : 0,
      wallManned: W ? W.mannedPosts : 0,
      wallCoverage: (CBZ.stateWall && CBZ.stateWall.coverage) ? Math.round(CBZ.stateWall.coverage() * 100) / 100 : 0,
      terrorOrgs: (CBZ.factions && CBZ.factions.exists && CBZ.factions.exists(CELL_ID)) ? 1 : 0,
      terrorMembers: livingCell().length,
      terrorRoster: S.roster.length,
      terrorSupply: S.supply | 0,
      attacksDone: S.attacksDone | 0,
      // THE PLOT TRAVELS: is the seat itself a reachable target this world,
      // and is one armed at it right now? (PRESIDENT-PLAN 1a: from the
      // Mansion every attack used to be a headline 4.7 km away.)
      gateTargetable: !!gateTarget(),
      attackArmedAtGate: !!(ATT.armed && ATT.armed.at && ATT.armed.at.gate),
      runsBlocked: S.runsBlocked | 0,
      raidsOrdered: S.raidsOrdered | 0,
      raidsWon: S.raidsWon | 0,
      // THE LADDER MIGRATION (doctrine's "next migration owed"): the
      // political title ladder was hand-typed in EIGHT files. After this
      // wave it exists in THREE: officials.js (the one declaration),
      // contracts.js and elections.js (both outside this wave's fence —
      // named so the next wave knows exactly where the debt sits). This
      // number may only ever go DOWN, and never below 1.
      ladderCopies: 3,
      ladderCopyFiles: ["officials.js (owner)", "contracts.js", "elections.js"],
      // reachable producers for the once-produce-less govTypes
      govTypeProducers: (CBZ.regimeDeclareDoctrine ? 1 : 0) + ((ROOM.stations && ROOM.stations.length) ? 1 : 0),
      transitions: {
        dictator: !!(CBZ.gov && CBZ.gov.decree && CBZ.regimes),          // emergency decree -> regimes ladder
        king: !!(CBZ.crown && CBZ.crown.selfCrown),                       // dictatorship -> monarchy
        jail: !!(CBZ.cityArrestToPrison || CBZ.setMode),                  // impeachment/junta -> transport
      },
      // The visual comparator reads this live ledger. Furniture counts only
      // when it carries a real sit/lie/order use; attached seals, flags and
      // architectural hierarchy are counted separately from usable props.
      visual: {
        namedRooms: (IA.namedRooms | 0) + (ROOM.group ? 1 : 0),
        usableProps: (IA.usableProps | 0) + (ROOM.seats | 0) + buttons,
        stateSymbols: (IA.stateSymbols | 0) + (ROOM.stateSymbols | 0) + architecture.length,
        emptyDecor: IA.emptyDecor | 0,
        roomNames: (IA.roomNames || []).concat(ROOM.group ? ["Situation Room"] : []),
        orderProps: (IA.orderProps || []).concat((ROOM.stations || []).map(function (p) { return "officer:" + p.role; })),
        architecture: architecture,
      },
      officeOrderProps: IA.orderProps ? IA.orderProps.length : 0,
      officeOrderZones: 0,
      officersPosted: Object.keys(OFF.peds).filter(function (k) { return !!OFF.peds[k]; }).length,
    };
  }
  CBZ.presidencyAudit = audit;
  CBZ.presidency = {
    begin: presidencyBegin,
    press: pressButton,
    buttons: function () {
      const h = seat(); const out = [];
      for (const k in BUTTONS) {
        const B = BUTTONS[k];
        let gt = { ok: false, why: "You do not hold the country." };
        if (h) { try { gt = B.gate(h); } catch (e) { gt = { ok: false, why: "?" }; } }
        let lv = false; try { lv = !!B.live(); } catch (e) {}
        out.push({ key: k, name: bname(B), group: B.group || "", ok: gt.ok, why: gt.why || "", live: lv, moves: (B.moves || []).slice() });
      }
      return out;
    },
    seat: seat,
    // THE SEAM (§10) — stable names other modes (Hitman) code against.
    current: current,
    schedule: schedule,
    onAssassinated: onAssassinated,
    lockdown: lockdownRead,
    cabinet: cabinet,
    vacateCabinet: vacateCabinet, fillCabinet: fillCabinet,
    CABINET_ROLES: CABINET_ROLES.map(function (r) { return { key: r.key, title: r.title, job: r.job, archetype: r.archetype }; }),
    // the President's hires (city/president_staff.js owns the shape; saved here)
    staff: function () { const S = st(); return S.staff || (S.staff = {}); },
    // officers at the Situation Room table (probe surface)
    officers: function () { const o = {}; for (const k in OFF.peds) if (OFF.peds[k]) o[k] = OFF.peds[k]; return o; },
    proposal: proposal,
    // THE PUBLIC READ + THE PUBLIC BUS. Other systems (the HUD strip, the
    // Chief of Staff's missions, the motorcade) consume exactly these two and
    // nothing else out of this file's internals.
    status: status,
    site: mansionSite,
    on: onEvent,
    emit: emitEvent,
    roster: function () { return st().roster.slice(); },
    orderRaid: function () { const h = seat(); return h ? orderRaid(h) : { ok: false, why: "You do not hold the country." }; },
    audit: audit,
    reset: reset,
    serialize: serialize,
    apply: apply,
    // harness/test hooks only — not part of the public contract
    _state: st, _buildRoom: buildRoom, _room: ROOM, _raid: RAID,
    _armAttack: function (d) { armAttack(d == null ? day() : d); }, _tickCellDay: tickCellDay,
    _att: ATT, _attackTarget: attackTarget, _tickAttack: tickAttack, _gateTarget: gateTarget,
    _tickFallsDay: tickFallsDay, _safehouses: safehouses, _paint: paintBoard,
  };
  CBZ.presidencyReset = reset;
})();
