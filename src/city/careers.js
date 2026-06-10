/* ============================================================
   city/careers.js — the many ways to make money.

   • Job board (any shop): a deep CONTRACT BOARD — HIT, DELIVERY,
     store HEIST, SMUGGLING run, GETAWAY-DRIVER, PROTECTION racket.
     Pay & danger scale with your NOTORIETY rank (Nobody → Kingpin),
     GTA-style: do dirt, get bigger jobs. (Real rank/standing progression
     comes from GANG MEMBERSHIP + crew contracts, not freelance body count.)
   • Drug dealing: a real loop — buy WHOLESALE at the trap house
     ([U] when near a dealer / trap lot), build a CUSTOMER BASE that
     re-ups from you, sell on the street where TERRITORY (your gang's
     turf vs. a rival's) shapes price and bust-risk. Get greedy and a
     narc tips off the cops (a real BUST, scaled by heat + load).
   • Crew / workers: recruit peds (gangster crew that defends you;
     pimp/entrepreneur workers that pay you passive income).
   • Legal: a Security Guard salary that pays while your record stays
     clean (and fires you the moment you go wanted).

   An active gig lives on g.cityJob with a world beacon; city/hud.js
   shows the objective + distance.

   Researched against GTA San Andreas crack-dealing / turf, GTA Online
   heist & getaway roles, and dealer-sim buy-low/sell-high + heat loops.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  let beacon = null, board = null, payT = 0;
  let _s = 8675309;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }
  function pick(a) { return a[(rng() * a.length) | 0]; }

  // ---- NOTORIETY: a criminal CV that rises with every gig you finish.
  // Pay and the calibre of jobs offered scale with your rank (GTA: prove
  // yourself, get bigger scores). Persisted on g so it survives a new life.
  const RANKS = [
    { xp: 0,    name: "Nobody",    cut: 1.00 },
    { xp: 600,  name: "Hustler",   cut: 1.15 },
    { xp: 1800, name: "Earner",    cut: 1.35 },
    { xp: 4200, name: "Shot-Caller", cut: 1.6 },
    { xp: 9000, name: "Boss",      cut: 1.95 },
    { xp: 20000, name: "Kingpin",  cut: 2.4 },
  ];
  function notoriety() { return g.cityNotoriety || 0; }
  function rankIdx() { const xp = notoriety(); let i = 0; for (let k = 0; k < RANKS.length; k++) if (xp >= RANKS[k].xp) i = k; return i; }
  function rankInfo() { return RANKS[rankIdx()]; }
  CBZ.cityNotoriety = function () { const r = rankInfo(); return { xp: notoriety(), idx: rankIdx(), name: r.name, cut: r.cut, max: rankIdx() >= RANKS.length - 1 }; };
  // Notoriety is now a QUIET flavor stat (kept for HUD / leaderboard + as a job
  // pay multiplier) — NOT a parallel auto-promote ladder. Real progression comes
  // from gang membership + contracts (see finishGangContract). No rank-up jingle,
  // no loud RANK UP banner: when your name carries a touch further, it's a quiet note.
  function gainNotoriety(amt) {
    const before = rankIdx();
    g.cityNotoriety = notoriety() + Math.max(0, amt | 0);
    const after = rankIdx();
    if (after > before && CBZ.city) {
      CBZ.city.note("Word's getting around — heavier jobs hit the board now.", 2.2);
    }
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  CBZ.cityGainNotoriety = gainNotoriety;

  function makeBeacon(x, z, color) {
    clearBeacon();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 30, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: color || 0xffd166, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false }));
    m.position.set(x, 15, z); m.userData.transient = true;
    CBZ.city.arena.root.add(m);
    beacon = m;
  }
  function clearBeacon() { if (beacon) { if (beacon.parent) beacon.parent.remove(beacon); if (beacon.geometry) beacon.geometry.dispose(); if (beacon.material) beacon.material.dispose(); beacon = null; } }

  function aliveCivilians() { return (CBZ.cityPeds || []).filter((p) => !p.dead && !p.vendor); }
  function lotDoor(l) { return { x: l.building.door.x, z: l.building.door.z }; }
  function randSpot() {
    const a = CBZ.city.arena;
    const p = a.randomSidewalkPoint ? a.randomSidewalkPoint() : { x: (rng() - 0.5) * 120, z: (rng() - 0.5) * 120 };
    return { x: p.x, z: p.z };
  }
  // reward = base × notoriety cut × small per-gig roll, rounded to a clean number
  function payout(base, spread) {
    const r = rankInfo().cut;
    const v = (base + (rng() * (spread || base * 0.6) | 0)) * r;
    return Math.max(50, Math.round(v / 10) * 10);
  }

  // ============================================================
  //  GANG CONTRACTS — the work your CREW puts you on.
  //
  //  This is what makes joining a gang and climbing the ladder mean
  //  something. The crew you belong to (CBZ.cityMembership — joined
  //  someone else's set, OR your own founded gang via g.playerGang)
  //  hands you JOBS. Finishing them pays CASH + RANK PROGRESS routed
  //  through the real hierarchy: cityMemberPutInWork("body"/"cash")
  //  feeds your standing inside an NPC crew (so you actually get bumped
  //  up Prospect→Lookout→…→Lt.), and when you're the boss of your own
  //  set it banks treasury + respect.
  //
  //  Contracts (GTA SA turf / GTA Online crew-job flavour):
  //    HIT      — clip a marked rival member (or their Lieutenant: harder, richer)
  //    TAKE     — seize/hold a rival or neutral BLOCK for the set
  //    COLLECT  — shake a debt out of a marked ped (rob/drop them)
  //    RUN      — courier PRODUCT across town without getting it taken
  //    DEFEND   — hold your own turf through a rival raid window
  //  Each has a target/location, a payout + rank reward scaled to risk,
  //  a TIME WINDOW, and a clean success/fail. Researched against GTA San
  //  Andreas gang turf wars (kill rivals to take a hood, defend to keep
  //  it) and GTA Online crew/sell-mission structure.
  // ============================================================
  let gcOffered = [];
  const GC_ICON = { gcHit: "🔫", gcTake: "🚩", gcCollect: "💵", gcRun: "🎒", gcDefend: "🛡️" };

  // who do you ride with? returns { kind:"member"|"boss", gangId, rank, name }
  // — works whether you JOINED an NPC crew or FOUNDED your own.
  function myCrew() {
    const pg = g.playerGang;
    if (pg && pg.founded) return { kind: "boss", gangId: "player", rank: "boss", rec: pg, name: pg.name || "your gang" };
    const m = (CBZ.cityMembership && CBZ.cityMembership()) || null;
    if (m && m.gangId) {
      const rec = (CBZ.cityGangs || []).find((x) => x.id === m.gangId) || null;
      return { kind: "member", gangId: m.gangId, rank: m.rank, rec: rec, memb: m, name: rec ? rec.name : "the crew" };
    }
    return null;
  }
  CBZ.cityInCrew = function () { return !!myCrew(); };

  // crew rank tier 0..6 (gates which contracts the set trusts you with) —
  // a boss of his own set is treated as top-tier.
  const GC_RANK_TIER = { prospect: 0, lookout: 1, runner: 2, soldier: 3, enforcer: 4, lt: 5, lieutenant: 5, capo: 5, underboss: 6, boss: 6 };
  function crewTier(c) { return c ? (GC_RANK_TIER[c.rank] != null ? GC_RANK_TIER[c.rank] : 0) : 0; }

  // a rival member of a DIFFERENT, non-allied crew (optionally a lieutenant).
  function findRivalMember(myGangId, wantLt) {
    let best = null, bd = Infinity, anyLt = null, anyLtd = Infinity;
    const P = CBZ.player ? CBZ.player.pos : { x: 0, z: 0 };
    for (const p of CBZ.cityPeds) {
      if (!p || p.dead || !p.gang || p.gang === myGangId || p.gang === "player") continue;
      if (CBZ.cityAreAllied && CBZ.cityAreAllied(myGangId, p.gang)) continue;
      const d = Math.hypot(p.pos.x - P.x, p.pos.z - P.z);
      const isLt = p.isBoss || p.rank === "lt" || p.rank === "enforcer";
      if (isLt && d < anyLtd) { anyLtd = d; anyLt = p; }
      if (d < bd) { bd = d; best = p; }
    }
    return (wantLt && anyLt) ? anyLt : best;
  }
  // Exposed so the playergang join-task system can reuse the SAME "nearest rival
  // member of a non-allied crew" pick to choose + beacon a rival mark.
  CBZ.cityFindRivalMember = function (myGangId, wantLt) { return findRivalMember(myGangId, wantLt); };

  // a rival / neutral ZONE the crew would want to take (not already yours/the set's).
  function findTakeZone(myGangId) {
    if (!CBZ.cityZones) return null;
    const P = CBZ.player ? CBZ.player.pos : { x: 0, z: 0 };
    let best = null, bd = Infinity;
    for (const z of CBZ.cityZones()) {
      if (z.owner === myGangId) continue;
      if (myGangId !== "player" && z.owner === "player") continue;
      if (z.owner && CBZ.cityAreAllied && CBZ.cityAreAllied(myGangId, z.owner)) continue;
      const d = Math.hypot(z.cx - P.x, z.cz - P.z);
      if (d < bd) { bd = d; best = z; }
    }
    return best;
  }

  // a YOUR-side zone to defend (only meaningful for a boss of a founded set).
  function findOwnZone(myGangId) {
    if (!CBZ.cityZones) return null;
    for (const z of CBZ.cityZones()) if (z.owner === myGangId) return z;
    return null;
  }

  // roll a believable slate of crew jobs for the set you ride with. Heavier
  // work (lieutenant hits, taking blocks, defending) unlocks as your in-crew
  // RANK climbs — the set doesn't put a fresh Prospect on a hit squad.
  function rollGangContracts() {
    const c = myCrew(); if (!c) return [];
    const tier = crewTier(c);
    const jobs = [];

    // HIT a rival — always on the table; at higher rank it's their Lieutenant.
    const wantLt = tier >= 4;
    const mark = findRivalMember(c.gangId, wantLt);
    if (mark) {
      const isLt = mark.isBoss || mark.rank === "lt" || mark.rank === "enforcer";
      jobs.push({
        type: "gcHit", target: mark, lt: isLt, t: 150,
        reward: payout(isLt ? 1100 : 380, isLt ? 600 : 500),
        body: isLt ? 3 : 1, kick: isLt ? 0.30 : 0.22, respect: isLt ? 14 : 6,
        desc: (isLt ? "HIT (Lt.): clip " : "HIT: clip ") + (mark.name || "a rival") + (mark.gang ? " · rival set" : ""),
      });
    }

    // COLLECT a debt — shake down a marked ped (rob OR drop them to clear it).
    const civs = aliveCivilians().filter((p) => !p.gang && !p.recruited && !p.companion && !p.robbed);
    if (civs.length) {
      const debtor = pick(civs);
      const owed = 200 + ((rng() * 500) | 0);
      jobs.push({
        type: "gcCollect", target: debtor, owed: owed, t: 150,
        reward: payout(260, 300), kick: 0.35, respect: 5,
        desc: "COLLECT: lean on " + (debtor.name || "a debtor") + " for the $" + owed + " they owe",
      });
    }

    // RUN PRODUCT — courier the set's stash across town clean (lose it if you
    // get too hot carrying it). A driving job; clean drops pay a wheel bonus.
    const lots = CBZ.city.arena.lots.filter((l) => l.building);
    if (lots.length && tier >= 1) {
      const a = randSpot(), b = lotDoor(pick(lots));
      jobs.push({
        type: "gcRun", pickup: a, dest: b, got: false, t: 180,
        reward: payout(700, 700), kick: 0.28, respect: 7,
        desc: "RUN PRODUCT: grab the package, run it clean across town",
      });
    }

    // TAKE A BLOCK — seize a rival/neutral zone for the set (be on it; if a
    // rival holds it, thin out their bodies there to flip it).
    if (tier >= 2) {
      const z = findTakeZone(c.gangId);
      if (z) {
        const held = !!z.owner;
        jobs.push({
          type: "gcTake", zoneId: z.id, x: z.cx, z: z.cz, held: held, hits: 0,
          need: held ? 3 : 0, t: 220,
          reward: payout(held ? 1300 : 800, 700), body: held ? 2 : 0, kick: 0.25, respect: held ? 16 : 9,
          desc: (held ? "TAKE: run the " : "CLAIM: plant the flag on the ") + (z.name || "block") + (held ? " set off their corner" : ""),
        });
      }
    }

    // DEFEND TURF — only if you're the BOSS of a set that actually holds turf:
    // hold a block through a live rival raid window.
    if (c.kind === "boss") {
      const z = findOwnZone(c.gangId);
      if (z) {
        jobs.push({
          type: "gcDefend", zoneId: z.id, x: z.cx, z: z.cz, t: 60, raided: false,
          reward: payout(900, 500), kick: 0.20, respect: 12,
          desc: "DEFEND: hold " + (z.name || "your block") + " — a raid is coming",
        });
      }
    }

    return jobs;
  }
  CBZ.cityRollGangContracts = rollGangContracts;

  // accept a gang contract: stash it on g.cityJob, drop a beacon, kick off
  // the live bits (defend spawns the raid; take/run point the marker).
  function acceptGangContract(j) {
    if (!j) return;
    g.cityJob = j;
    const c = myCrew();
    j.gangId = c ? c.gangId : null;
    if (j.type === "gcHit" && j.target) makeBeacon(j.target.pos.x, j.target.pos.z, 0xff5b5b);
    else if (j.type === "gcCollect" && j.target) makeBeacon(j.target.pos.x, j.target.pos.z, 0xffd166);
    else if (j.type === "gcRun") makeBeacon(j.pickup.x, j.pickup.z, 0xffd166);
    else if (j.type === "gcTake") makeBeacon(j.x, j.z, 0x7de7ff);
    else if (j.type === "gcDefend") {
      makeBeacon(j.x, j.z, 0x7ed957);
      // muster your own crew on the block and call the raid in
      if (CBZ.cityPlayerGangDefendTurf) CBZ.cityPlayerGangDefendTurf(j.x, j.z);
      CBZ.city.note("Get to the block and HOLD it — they're rolling up.", 2.8);
    }
    if (CBZ.city.big) CBZ.city.big("CONTRACT · " + (c ? c.name : "the set"));
    CBZ.city.note(j.desc + " · $" + j.reward, 2.6);
    closeBoard();
  }
  CBZ.cityAcceptGangContract = acceptGangContract;

  // pay out a finished crew contract: cash + respect, and — crucially — RANK
  // progress through the real hierarchy so the work actually promotes you.
  function finishGangContract(j, bonus) {
    if (!j) return;
    const c = myCrew();
    const total = j.reward + (bonus || 0);
    CBZ.city.addCash(total);
    if (j.respect) CBZ.city.addRespect(j.respect);
    CBZ.city.big("CREW PAID + $" + total);
    // notoriety on the street still grows (your name carries)
    gainNotoriety(Math.round(j.reward * 0.45) + 30);
    // climb the crew ladder: bodies + cash kicked up = the promotion currency
    if (c && c.kind === "member" && CBZ.cityMemberPutInWork) {
      if (j.body) CBZ.cityMemberPutInWork("body", j.body);
      CBZ.cityMemberPutInWork("cash", Math.round(total * (j.kick || 0.25)));
      CBZ.cityMemberPutInWork("standing", 0.12);
    } else if (c && c.kind === "boss" && c.rec) {
      // you're the boss: the work feeds your own war chest + reputation
      c.rec.treasury = (c.rec.treasury || 0) + Math.round(total * (j.kick || 0.25));
    }
    // A HIT whose mark was a RIVAL-GANG member or a SPECIFIC marked target is the
    // real "earn your standing" work — credit a STRONGER membership gain so that
    // hitting a named rival meaningfully advances your gang standing (this is what
    // climbs the crew ladder, not body count from random violence).
    if (j.type === "gcHit" && j.target && c && c.kind === "member" && CBZ.cityMemberPutInWork) {
      const wasRivalMember = !!j.target.gang && j.target.gang !== c.gangId && j.target.gang !== "player";
      const wasSpecificMark = wasRivalMember || j.lt || j.target === j._mark;
      if (wasRivalMember || wasSpecificMark) {
        CBZ.cityMemberPutInWork("body", j.lt ? 2 : 1);                 // a real, named body on top of the job's base body
        CBZ.cityMemberPutInWork("standing", j.lt ? 0.18 : 0.10);
      }
    }
    g.cityGangJobsDone = (g.cityGangJobsDone || 0) + 1;
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    g.cityJob = null; clearBeacon();
  }
  function failGangContract(j, why) {
    if (!j) return;
    CBZ.city.note("Crew job blown — " + (why || "you lost it") + ". The set won't be happy.", 2.6);
    // a botched job sours the crew a touch (they trust you less)
    const c = myCrew();
    if (c && c.kind === "member" && c.memb) c.memb.loyalty = Math.max(0, (c.memb.loyalty || 0.6) - 0.06);
    g.cityJob = null; clearBeacon();
  }
  CBZ.cityGangContractFail = failGangContract;

  // open the CREW CONTRACTS board (also folded into the main Job Board below,
  // and callable on its own so a gang member / [Y] hub can surface it).
  function isGangJob(t) { return t && t.indexOf && t.indexOf("gc") === 0; }
  CBZ.cityGangContracts = function () {
    const c = myCrew();
    if (!c) { CBZ.city.note("You're not in a crew. Prospect a set (or found your own) to pick up contracts.", 3); return; }
    if (CBZ.cityCloseShop) CBZ.cityCloseShop();
    gcOffered = rollGangContracts();
    offered = gcOffered.slice();   // share the [1-9] accept handler
    let html = "<div style='font-size:20px;font-weight:700;margin-bottom:2px'>🩸 " + c.name + " · Contracts</div>";
    html += "<div style='font-size:12px;color:#ffd166;margin-bottom:8px'>You: " +
      (CBZ.cityRankName ? CBZ.cityRankName(c.rank) : c.rank) +
      " <span style='color:#8a93a3'>· finish jobs to climb the ranks</span></div>";
    if (!gcOffered.length) html += "<div style='color:#8a93a3'>No work right now — check back after the heat dies down.</div>";
    gcOffered.forEach((j, i) => {
      html += "<div style='padding:4px 0'><b style='color:#ffd166'>" + (i + 1) + "</b> " +
        (GC_ICON[j.type] || "•") + " " + j.desc +
        " <span style='color:#7ed957'>$" + j.reward + "</span>" +
        (j.respect ? " <span style='color:#c792ea'>+" + j.respect + " rep</span>" : "") + "</div>";
    });
    html += "<div style='font-size:12px;color:#8a93a3;margin-top:8px'>[1–" + Math.max(1, gcOffered.length) + "] accept · [0] freelance hustles · [Esc] close</div>";
    boardEl().innerHTML = html;
    board.style.display = "block";
    board._gang = true;
    CBZ.cityMenuOpen = true;
    if (document.exitPointerLock) try { document.exitPointerLock(); } catch (e) {}
  };

  // ---- job offers ----
  // A rotating contract board. Always offers a couple of starter gigs; the
  // heavier scores (smuggling, getaway, protection rackets, multi-target hits)
  // unlock as your NOTORIETY climbs — exactly like GTA gating bigger jobs.
  function rollJobs() {
    const jobs = [];
    const ri = rankIdx();
    const civ = aliveCivilians();
    const lots = CBZ.city.arena.lots.filter((l) => l.building);
    const shops = CBZ.city.arena.shopLots || [];

    // HIT — at higher ranks it's a multi-target sweep worth a lot more
    if (civ.length) {
      const multi = ri >= 3 && rng() < 0.5;
      if (multi) {
        const n = 2 + ((rng() * 2) | 0);
        const targets = []; for (let i = 0; i < n && i < civ.length; i++) targets.push(pick(civ));
        jobs.push({ type: "hit", targets: targets.slice(), target: targets[0], reward: payout(900, 700), desc: "SWEEP: take out " + targets.length + " marks" });
      } else {
        const t = pick(civ);
        jobs.push({ type: "hit", target: t, reward: payout(300, 700), desc: "HIT: take out " + t.name });
      }
    }
    // DELIVERY — courier a package; driving pays a clean bonus
    if (lots.length) {
      const dst = pick(lots);
      jobs.push({ type: "delivery", dest: lotDoor(dst), reward: payout(180, 320), desc: "DELIVERY: run a package across town" });
    }
    // HEIST — knock over a store register
    if (shops.length) {
      const s = pick(shops);
      jobs.push({ type: "heist", lot: s, reward: payout(400, 900), desc: "HEIST: knock over " + s.building.name });
    }
    // SMUGGLING — pick up a stash at point A, run it to point B without losing
    // it (drop it / get busted en route and it's blown). A driving job at heart.
    if (lots.length >= 2 && ri >= 1) {
      const a = randSpot(), b = lotDoor(pick(lots));
      jobs.push({ type: "smuggle", pickup: a, dest: b, got: false, heat: 0, reward: payout(650, 700), desc: "SMUGGLING: grab the stash, run it clean across town" });
    }
    // GETAWAY DRIVER — be in a car at the rendezvous before the timer, then
    // shake the heat. Pure wheelman work (GTA Online getaway role).
    if (ri >= 1) {
      const a = randSpot();
      jobs.push({ type: "getaway", rdv: a, phase: "drive", t: 45, reward: payout(550, 600), desc: "GETAWAY: be the wheelman at the marker, then lose the law" });
    }
    // PROTECTION RACKET — lean on a business for the boss. Collect at the door;
    // they may not pay quietly. Repeatable shakedown for steady respect + cash.
    if (shops.length && ri >= 2) {
      const s = pick(shops);
      jobs.push({ type: "protection", lot: s, reward: payout(500, 500), desc: "RACKET: collect protection from " + s.building.name });
    }
    // (The old MAYHEM "rob or drop N people" spree gig is GONE — it was pure
    //  body-count filler. Progression is gang membership + contracts now, not a
    //  freelance kill-count. See finishGangContract / playergang task system.)

    // trim to a tidy board, keep the starters + a random slice of the rest
    return jobs;
  }

  function boardEl() {
    if (board) return board;
    board = document.createElement("div");
    board.id = "cityJobs";
    board.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:49;display:none;min-width:340px;background:rgba(14,16,22,.96);border:2px solid #3a3140;border-radius:16px;padding:16px 18px;color:#e8eef7;font-family:Fredoka,system-ui,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.55);pointer-events:auto";
    document.body.appendChild(board);
    return board;
  }
  let offered = [];
  const ICON = { hit: "🎯", delivery: "📦", heist: "💰", smuggle: "🚚", getaway: "🏎️", protection: "💼" };
  CBZ.cityJobBoard = function () {
    if (CBZ.cityCloseShop) CBZ.cityCloseShop();
    // if you ride with a crew, the board opens straight onto YOUR set's
    // contracts (the climb-the-ranks work); [0] swaps to freelance hustles.
    const crew = myCrew();
    if (crew) { CBZ.cityGangContracts(); return; }
    offered = rollJobs();
    if (board) board._gang = false;
    const r = rankInfo(), nxt = RANKS[rankIdx() + 1];
    let html = "<div style='font-size:20px;font-weight:700;margin-bottom:2px'>📋 Contract Board</div>";
    html += "<div style='font-size:12px;color:#ffd166;margin-bottom:8px'>Notoriety: " + r.name +
      (nxt ? " <span style='color:#8a93a3'>(" + (notoriety()) + "/" + nxt.xp + " → " + nxt.name + ", pay ×" + r.cut.toFixed(2) + ")</span>" : " <span style='color:#7ed957'>· MAX · pay ×" + r.cut.toFixed(2) + "</span>") + "</div>";
    offered.forEach((j, i) => { html += "<div style='padding:4px 0'><b style='color:#ffd166'>" + (i + 1) + "</b> " + (ICON[j.type] || "•") + " " + j.desc + " <span style='color:#7ed957'>$" + j.reward + "</span></div>"; });
    html += "<div style='font-size:12px;color:#8a93a3;margin-top:8px'>[1–" + offered.length + "] accept · [Esc] close</div>";
    boardEl().innerHTML = html;
    board.style.display = "block";
    CBZ.cityMenuOpen = true;
    if (document.exitPointerLock) try { document.exitPointerLock(); } catch (e) {}
  };
  function closeBoard() { if (board) { board.style.display = "none"; board._gang = false; } CBZ.cityMenuOpen = false; if (CBZ.requestLock && g.state === "playing") CBZ.requestLock(); }
  function accept(i) {
    const j = offered[i]; if (!j) return;
    // gang contracts route through the crew-job path (beacon + rank reward)
    if (isGangJob(j.type)) { acceptGangContract(j); return; }
    g.cityJob = j;
    if (j.type === "smuggle") makeBeacon(j.pickup.x, j.pickup.z, 0xffd166);
    else if (j.type === "getaway") makeBeacon(j.rdv.x, j.rdv.z, 0x7de7ff);
    else if (j.type === "protection" && j.lot) makeBeacon(j.lot.building.door.x, j.lot.building.door.z, 0xffd166);
    else if (j.dest) makeBeacon(j.dest.x, j.dest.z, 0x7ed957);
    else if (j.type === "hit" && j.target) makeBeacon(j.target.pos.x, j.target.pos.z, 0xff5b5b);
    else if (j.type === "heist" && j.lot) makeBeacon(j.lot.building.door.x, j.lot.building.door.z, 0xff9e6b);
    CBZ.city.note("Job accepted: " + j.desc, 2.4);
    closeBoard();
  }

  // freelance hustle view, forced (used by [0] to leave the crew board)
  function openFreelanceBoard() {
    offered = rollJobs();
    if (board) board._gang = false;
    const r = rankInfo(), nxt = RANKS[rankIdx() + 1];
    let html = "<div style='font-size:20px;font-weight:700;margin-bottom:2px'>📋 Freelance Hustles</div>";
    html += "<div style='font-size:12px;color:#ffd166;margin-bottom:8px'>Notoriety: " + r.name +
      (nxt ? " <span style='color:#8a93a3'>(" + (notoriety()) + "/" + nxt.xp + " → " + nxt.name + ")</span>" : " <span style='color:#7ed957'>· MAX</span>") +
      (myCrew() ? " <span style='color:#8a93a3'>· [0] crew contracts</span>" : "") + "</div>";
    offered.forEach((j, i) => { html += "<div style='padding:4px 0'><b style='color:#ffd166'>" + (i + 1) + "</b> " + (ICON[j.type] || "•") + " " + j.desc + " <span style='color:#7ed957'>$" + j.reward + "</span></div>"; });
    html += "<div style='font-size:12px;color:#8a93a3;margin-top:8px'>[1–" + offered.length + "] accept · [Esc] close</div>";
    boardEl().innerHTML = html;
    board.style.display = "block";
    CBZ.cityMenuOpen = true;
  }

  addEventListener("keydown", function (e) {
    if (!board || board.style.display !== "block") return;
    const k = e.key.toLowerCase();
    if (k === "escape") { e.preventDefault(); closeBoard(); return; }
    // [0] toggles between the crew contract board and freelance hustles
    if (k === "0" && myCrew()) { e.preventDefault(); if (board._gang) openFreelanceBoard(); else CBZ.cityGangContracts(); return; }
    if (k >= "1" && k <= "9") { e.preventDefault(); accept(parseInt(k, 10) - 1); }
  });

  function finishJob(bonus) {
    const j = g.cityJob; if (!j) return;
    const total = j.reward + (bonus || 0);
    CBZ.city.addCash(total);
    CBZ.city.addRespect(Math.ceil(j.reward / 80));
    CBZ.city.big("+ $" + total);
    // every finished contract grows your criminal CV (≈ a fraction of the pay)
    gainNotoriety(Math.round(j.reward * 0.5) + 40);
    g.cityJobsDone = (g.cityJobsDone || 0) + 1;
    g.cityJob = null; clearBeacon();
  }
  function failJob(why) {
    const j = g.cityJob; if (!j) return;
    CBZ.city.note("Job blown — " + (why || "you lost it") + ".", 2.4);
    g.cityJob = null; clearBeacon();
  }
  CBZ.cityJobComplete = finishJob;
  CBZ.cityJobFail = failJob;

  // The MAYHEM (vandal) "rob or drop N people" spree gig was removed (body-count
  // filler). This hook is kept as a harmless no-op so its peds.js callers (which
  // null-guard on existence) keep working without firing any kill-count job.
  CBZ.cityCountMayhem = function () {};

  // ---- careers ----
  CBZ.cityStartCareer = function (kind) {
    g.career = kind;
    if (CBZ.cityCloseShop) CBZ.cityCloseShop();
    const msg = {
      dealer: "You're slinging now. Cop WHOLESALE at the trap house ([U] near a dealer), then [I] Deal on the street. Turn buyers into regulars, keep the heat off your back.",
      security: "On the books as a Security Guard. Keep your record clean (0 stars) for the salary; drop criminals for bonus pay.",
      pimp: "You run the night crew now. [K] Recruit earners — they kick up to you while you sleep.",
      gangster: "Putting a crew together. [K] Recruit shooters — they ride with you and answer your orders [O].",
    }[kind] || ("Career: " + kind);
    CBZ.city.note(msg, 3.5);
  };

  // ============================================================
  //  DRUG DEALING — the full loop
  //  buy wholesale → sell on the street → grow a customer base →
  //  territory shapes price & risk → get greedy and catch a BUST.
  // ============================================================
  const DRUGS = ["Weed", "Coke", "Meth", "Pills"];

  // ---- WHOLESALE BUY at the trap house (called by interact.js [U] near a
  // dealer ped or a trap lot). Sources product at the district wholesale
  // price; buying in bulk drains local supply and nudges the price up.
  CBZ.cityBuyDrugs = function (drug, qty) {
    const econ = CBZ.cityEcon;
    drug = drug || "Weed"; qty = Math.max(1, qty | 0);
    const it = econ.ITEMS[drug];
    if (!it || it.tag !== "drug") { CBZ.city.note("That's not product.", 1.6); return false; }
    const unit = econ.wholesalePrice ? econ.wholesalePrice(drug) : Math.round(it.value * 0.8);
    const cost = unit * qty;
    if (!CBZ.city.canAfford(cost)) {
      const can = Math.floor((g.cash || 0) / Math.max(1, unit));
      if (can <= 0) { CBZ.city.note("Need $" + cost + " for " + qty + "× " + drug + ".", 1.8); return false; }
      qty = can; // buy what you can afford instead of failing outright
    }
    CBZ.city.spend(unit * qty);
    econ.add(drug, qty);
    if (econ.recordBuy) econ.recordBuy(drug, qty);
    if (!g.career) g.career = "dealer";
    if (CBZ.sfx) CBZ.sfx("coin");
    CBZ.city.note("Bought " + qty + "× " + drug + " @ $" + unit + " ($" + (unit * qty) + "). Now go move it.", 2.2);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  };

  // Open a tiny trap-house buy menu (qty options) — interact.js can call this.
  CBZ.cityTrapMenu = function (drug) {
    const econ = CBZ.cityEcon;
    drug = drug || "Weed";
    const unit = econ.wholesalePrice ? econ.wholesalePrice(drug) : Math.round((econ.ITEMS[drug] || { value: 30 }).value * 0.8);
    // default to a 5-pack if affordable, else as many as cash allows
    const want = CBZ.city.canAfford(unit * 5) ? 5 : 1;
    return CBZ.cityBuyDrugs(drug, want);
  };

  // ---- the live customer base. Each successful sale can convert a ped into a
  // REGULAR who knows your face: they re-up, pay a loyalty premium, and tip you
  // off to the best market. Bigger base = more passive street demand.
  function regulars() { return (CBZ.cityPeds || []).filter((p) => p.regular && !p.dead); }
  // send a ped walking to (x,z) the same way the ped AI does (sets finalGoal,
  // a 2-hop path via the nearest intersection if far, target + a short pause so
  // the routine picker doesn't immediately override it).
  function sendPedTo(ped, x, z) {
    const A = CBZ.city.arena; if (!A || !ped.target) return;
    const goal = { x, z };
    ped.finalGoal = goal;
    const dGoal = Math.hypot(x - ped.pos.x, z - ped.pos.z);
    if (A.nearestIntersection && dGoal > 18) { const it = A.nearestIntersection(x, z); ped.path = [{ x: it.x, z: it.z }, goal]; }
    else ped.path = [goal];
    ped.target.set(ped.path[0].x, 0, ped.path[0].z);
    ped.pause = 0; ped.state = "walk";
  }
  function makeRegular(ped, drug) {
    if (!ped.regular) {
      ped.regular = true; ped.loyalty = 0.1;
      ped.favDrug = drug;
      g.cityCustomers = (g.cityCustomers || 0) + 1;
      ped.tagColor = ped.tagColor || "#c792ea";
      CBZ.city.note(ped.name + " is a regular now — they'll come back for more.", 2.0);
    } else {
      ped.loyalty = Math.min(1, (ped.loyalty || 0.1) + 0.08);
      if (drug) ped.favDrug = drug;
    }
    ped.reUpT = CBZ.now + (40 + rng() * 50) * 1000; // ms: when they'll want to re-up
  }

  // territory factor: dealing on YOUR gang's turf is safer & a touch richer;
  // a rival's turf is hostile ground — worse prices, far higher bust risk.
  function turfFactor(ped) {
    const gang = CBZ.cityGangOf ? CBZ.cityGangOf(ped.pos.x, ped.pos.z) : null;
    if (!gang) return { mult: 1, risk: 1, where: "neutral" };
    const mine = CBZ.cityPlayerGangExists && CBZ.cityPlayerGangExists() && g.playerGang && gang.id === g.playerGang.id;
    if (mine) return { mult: 1.18, risk: 0.55, where: "home" };
    const hostile = (gang.provoke || 0) > 0.4;
    return { mult: 0.88, risk: hostile ? 2.2 : 1.5, where: "rival" };
  }

  // ---- street drug sale to a ped (called by interact.js [I] Deal) ----
  CBZ.cityDealTo = function (ped) {
    const econ = CBZ.cityEcon, inv = g.cityInv || {};
    const drugs = Object.keys(inv).filter((k) => econ.ITEMS[k] && econ.ITEMS[k].tag === "drug");
    if (!drugs.length) { CBZ.city.note("No product to sell. Buy WHOLESALE at the trap house.", 2.0); return; }
    if (CBZ.now - (g._lastDealT || 0) < 700) return;   // global anti-spam: one street sale at a time (no fan-the-crowd faucet)
    g._lastDealT = CBZ.now;
    if (ped.boughtT && CBZ.now - ped.boughtT < 8000) { CBZ.city.note(ped.name + " isn't interested right now.", 1.4); return; }
    // a regular wants their drug of choice if you have it; else best earner
    let drug = (ped.regular && ped.favDrug && inv[ped.favDrug]) ? ped.favDrug : null;
    if (!drug) { let bp = -1; for (const d of drugs) { const p = econ.streetPrice ? econ.streetPrice(d) : econ.ITEMS[d].value * 2; if (p > bp) { bp = p; drug = d; } } }

    const turf = turfFactor(ped);
    // BUST RISK: narcs/undercover refuse and may call it in. Risk rises with the
    // heat already on you, on hostile turf, with hard drugs, and falls hard for a
    // loyal regular who trusts you. (GTA crack-dealing: get greedy, get caught.)
    let bustChance = 0.16 * turf.risk;
    bustChance += 0.03 * (g.wanted | 0);
    if (drug === "Meth" || drug === "Coke") bustChance += 0.05;
    if (ped.regular) bustChance *= (1 - 0.6 * (ped.loyalty || 0.1));
    bustChance = Math.max(0.02, Math.min(0.6, bustChance));
    if (rng() < bustChance) {
      ped.alarmed = 6; CBZ.cityAlarm(ped.pos.x, ped.pos.z, 14, 0.7, CBZ.city.playerActor);
      const sev = 24 + (g.wanted | 0) * 8 + (turf.where === "rival" ? 16 : 0);
      CBZ.cityCrime && CBZ.cityCrime(sev, { x: ped.pos.x, z: ped.pos.z, type: "dealing" });
      if (ped.regular) { ped.loyalty = Math.max(0, (ped.loyalty || 0.1) - 0.2); }
      CBZ.city.note(turf.where === "rival" ? ped.name + " is rival-affiliated — they call it in!" : ped.name + " is a narc — they call it in!", 2.0);
      return;
    }

    // price: market street price × territory factor × loyalty premium
    let price = econ.streetPrice ? econ.streetPrice(drug) : Math.round(econ.ITEMS[drug].value * 2.2);
    price = Math.round(price * turf.mult * (ped.regular ? 1 + 0.25 * (ped.loyalty || 0.1) : 1));
    if (!econ.take(drug, 1)) { CBZ.city.note(ped.name + " — you're out of that product.", 1.4); return; }   // only pay for a unit actually removed
    if (econ.recordSale) econ.recordSale(drug, 1);
    CBZ.city.addCash(price); CBZ.city.addRespect(1);
    g.cityDrugSales = (g.cityDrugSales || 0) + 1;
    gainNotoriety(3 + (drug === "Coke" ? 3 : 0));
    ped.boughtT = CBZ.now;
    // turn a satisfied buyer into a repeat customer (loyalty grows per sale)
    if (ped.regular || rng() < 0.45) makeRegular(ped, drug);
    // Personality and inventory stay independent. Buying product changes a
    // routine need, not whether this person happens to own a weapon.
    ped.drugUser = true;
    ped.tweakT = 0;
    if (ped.archetype === "resident") ped.archetype = "customer";
    ped.erratic = Math.max(ped.erratic || 0, drug === "Meth" ? 0.48 : 0.16);
    // satisfy the buyer's craving (the NPC need system) so they walk off content
    // instead of immediately hunting another fix; release them from seeking you.
    if (ped._needs) ped._needs.high = Math.min(1, (ped._needs.high || 0.3) + 0.6 + (drug === "Meth" ? 0.2 : 0));
    ped.seekPlayer = false;
    // a player sale on YOUR turf banks promotion currency for your own gang
    if (CBZ.cityPlayerGangExists && CBZ.cityPlayerGangExists() && g.playerGang) {
      g.playerGang.treasury = (g.playerGang.treasury || 0) + Math.round(price * 0.2);
    }
    if (CBZ.sfx) CBZ.sfx("coin");
    CBZ.city.note("Sold " + drug + " to " + ped.name + " for $" + price + (turf.where === "home" ? " (your turf)" : "") + ".", 1.8);
  };

  // dealer dashboard line for interact/HUD prompts
  CBZ.cityDealerStatus = function () {
    const econ = CBZ.cityEcon, inv = g.cityInv || {};
    let units = 0; for (const d of DRUGS) units += (inv[d] || 0);
    const cust = regulars().length;
    const best = econ.bestMarket ? econ.bestMarket(pick(DRUGS)) : null;
    const district = econ.playerDistrict ? econ.playerDistrict() : null;
    return { units, customers: cust, sales: g.cityDrugSales || 0, best, posted: !!g.cityPostedUp, district };
  };

  // ---- POST UP: hold a corner like a real street dealer. While posted, nearby
  // addicts — your regulars AND any ped with a live craving (the NPC need
  // system in aigoals) — walk straight up to you to score. Stop moving much
  // and the trade comes to you; the better your block's demand, the more buyers
  // drift over. (GTA San Andreas crack-corner / GTA Online street-dealer vibe.)
  CBZ.cityPostUp = function () {
    if (g.career !== "dealer") { CBZ.city.note("Start dealing first — cop product at the trap house.", 2.0); return false; }
    g.cityPostedUp = !g.cityPostedUp;
    if (g.cityPostedUp) {
      g.cityPostX = CBZ.player.pos.x; g.cityPostZ = CBZ.player.pos.z;
      const econ = CBZ.cityEcon;
      const dn = econ && econ.districtName ? econ.districtName(econ.playerDistrict ? econ.playerDistrict() : null) : "this block";
      CBZ.city.note("Posted up on " + dn + ". Word's out — buyers will come to you. [I] to deal, post up again to move on.", 2.8);
    } else {
      CBZ.city.note("Off the corner. You're moving again.", 1.6);
      // release any seekers so they get on with their own lives
      for (const p of (CBZ.cityPeds || [])) if (p.seekPlayer) { p.seekPlayer = false; }
    }
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return g.cityPostedUp;
  };

  // recruit a ped as crew (gangster) or worker (pimp/entrepreneur)
  CBZ.cityRecruit = function (ped) {
    if (!ped || ped.dead || ped.vendor || ped.recruited) return;
    const cost = 100;
    if ((g.respect || 0) < 5 && !CBZ.city.canAfford(cost)) { CBZ.city.note("Need respect or $100 to recruit.", 1.8); return; }
    if ((g.respect || 0) < 5) CBZ.city.spend(cost);
    // running a car-resale yard? recruits become CREW (raid defenders); the
    // pimp/entrepreneur path recruits WORKERS (passive income) instead.
    // pimp/entrepreneur recruit passive WORKERS; everyone else gets a CREW
    // bodyguard who travels with you and shoots to defend (costs a salary).
    ped.recruited = true; ped.kind = (g.career === "pimp" || g.career === "entrepreneur") ? "worker" : "crew";
    if (ped.kind === "crew") {
      ped.companion = true; ped.aggr = 0.96; ped.maxHp = 160; ped.hp = 160;
      ped.armed = true; ped.weapon = ped.weapon && ped.weapon !== "Bat" ? ped.weapon : "Pistol"; ped.ammo = 999;
      ped.faction = "player"; ped.gang = null; ped.npcWanted = 0;
      if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(ped);
    }
    ped.tagColor = "#7ed957";
    g.cityCrew = (g.cityCrew || 0) + 1;
    CBZ.city.addRespect(3);
    // if you already run a gang, a new bodyguard joins it as a Soldier under
    // your colours (city/playergang.js); otherwise it's a free-agent bodyguard
    // and 3 of them unlock FOUNDing a gang via the [O] orders menu.
    if (ped.kind === "crew" && CBZ.cityPlayerGangExists && CBZ.cityPlayerGangExists() && CBZ.cityPlayerGangEnlist) {
      CBZ.cityPlayerGangEnlist(ped, "soldier");
      CBZ.city.note(ped.name + " patched into the " + g.playerGang.name + " as a Soldier. Crew: " + g.cityCrew, 2.4);
    } else {
      CBZ.city.note(ped.name + " is on your payroll (" + (ped.kind === "crew" ? "shooter" : ped.kind) + "). Crew: " + g.cityCrew +
        (ped.kind === "crew" && g.cityCrew >= 3 && !(CBZ.cityPlayerGangExists && CBZ.cityPlayerGangExists()) ? " — press [O] to FOUND your own gang." : ""), 2.6);
    }
  };

  // count live hostile rival members standing on/near a block (used by TAKE).
  function rivalsOnBlock(myGangId, x, z, r) {
    let n = 0; const rr = r * r;
    for (const p of CBZ.cityPeds) {
      if (!p || p.dead || !p.gang || p.gang === myGangId || p.gang === "player") continue;
      if (CBZ.cityAreAllied && CBZ.cityAreAllied(myGangId, p.gang)) continue;
      if (p.surrender || p.state === "flee") continue;     // cleared / routed don't count
      const dx = p.pos.x - x, dz = p.pos.z - z;
      if (dx * dx + dz * dz <= rr) n++;
    }
    return n;
  }

  // per-frame progress for a CREW CONTRACT. Each type tracks its own window +
  // success/fail; payouts route through finishGangContract (rank progress).
  function gangContractTick(j, P, dt) {
    // every crew contract is on a clock — blow the window and the job's dead.
    if (j.t != null) {
      j.t -= dt;
      if (j.t <= 0 && j.type !== "gcDefend") { failGangContract(j, "you ran out of time"); return; }
    }
    if (j.type === "gcHit") {
      if (beacon && j.target && !j.target.dead) beacon.position.set(j.target.pos.x, 15, j.target.pos.z);
      if (j.target && j.target.dead) { CBZ.city.note("Mark's down. The set noticed.", 1.8); finishGangContract(j, 0); }
    } else if (j.type === "gcCollect") {
      if (beacon && j.target && !j.target.dead) beacon.position.set(j.target.pos.x, 15, j.target.pos.z);
      // collected = you robbed them (took the debt) OR put them in the ground
      if (j.target && (j.target.robbed || j.target.dead)) {
        const clean = j.target.robbed && !j.target.dead;
        CBZ.city.note(clean ? "Debt squeezed out clean." : "Debt settled the hard way.", 1.8);
        finishGangContract(j, clean ? Math.round(j.reward * 0.2) : 0);   // a clean shakedown pays a touch more
      }
    } else if (j.type === "gcRun") {
      if (!j.got) {
        if (Math.hypot(P.x - j.pickup.x, P.z - j.pickup.z) < 4) {
          j.got = true; makeBeacon(j.dest.x, j.dest.z, 0x7ed957);
          CBZ.city.note("Product's on you. Run it to the drop — don't get hot.", 2.4);
        }
      } else {
        if ((g.wanted | 0) >= 4) { failGangContract(j, "you got too hot carrying the load"); }
        else if (Math.hypot(P.x - j.dest.x, P.z - j.dest.z) < 4) {
          CBZ.city.note("Product dropped — clean run.", 1.6);
          finishGangContract(j, CBZ.player.driving && (g.wanted | 0) === 0 ? 150 : 0);
        }
      }
    } else if (j.type === "gcTake") {
      const onBlock = Math.hypot(P.x - j.x, P.z - j.z) < 16;
      if (!onBlock) { j.plant = 0; return; }
      const rivals = rivalsOnBlock(j.gangId, j.x, j.z, 16);
      if (j.held && rivals > 0) {
        // a rival corner: you have to run their bodies off before it flips
        j.plant = 0;
        if (CBZ.now - (j._noteT || 0) > 4000) { j._noteT = CBZ.now; CBZ.city.note(rivals + " still holding the corner — run them off.", 1.6); }
        return;
      }
      // corner is clear (or it was always neutral): plant the flag to claim it
      j.plant = (j.plant || 0) + dt;
      if (j.plant >= (j.held ? 2 : 3)) {
        // a BOSS of his own set actually flips the zone to his colours; a member
        // taking it for an NPC crew just clears it for them (NPC turf is theirs).
        if (j.gangId === "player" && CBZ.cityPlayerGangClaimTurf) CBZ.cityPlayerGangClaimTurf(j.x, j.z);
        CBZ.city.note("Block taken — it flies the colours now.", 2.0);
        finishGangContract(j, 0);
      } else if (CBZ.now - (j._noteT || 0) > 2200) {
        j._noteT = CBZ.now; CBZ.city.note("Hold the corner… " + Math.ceil((j.held ? 2 : 3) - j.plant) + "s", 1.0);
      }
    } else if (j.type === "gcDefend") {
      const onBlock = Math.hypot(P.x - j.x, P.z - j.z) < 18;
      // the raid: bodies coming for the block. We just need the player present
      // and the block still ours when the window closes.
      if (!j.raided && j.t < 50) {
        j.raided = true;
        if (CBZ.cityCrime) CBZ.cityCrime(60, { x: j.x, z: j.z, type: "robbery" });
        CBZ.city.note("They're here — hold the block!", 2.0);
      }
      if (!onBlock && CBZ.now - (j._noteT || 0) > 3000) {
        j._noteT = CBZ.now; CBZ.city.note("Get back on the block — you can't defend it from across town!", 1.8);
      }
      // lost the block? (a rival flipped the zone) → fail
      if (j.zoneId != null && CBZ.cityZoneOwner && CBZ.cityZoneOwner(j.x, j.z) !== j.gangId) {
        // only fail if it's actually been taken by a rival, not merely neutral churn
        const own = CBZ.cityZoneOwner(j.x, j.z);
        if (own && own !== j.gangId) { failGangContract(j, "they overran the block"); return; }
      }
      if (j.t <= 0) {
        if (onBlock) { CBZ.city.note("Held it. The block's still ours.", 2.0); finishGangContract(j, 0); }
        else { failGangContract(j, "you weren't there to hold it"); }
      }
    }
  }

  CBZ.cityCareersReset = function () {
    g.cityJob = null; g.cityCrew = 0; g.cityBank = g.cityBank || 0; clearBeacon(); payT = 0;
    // notoriety + sales tallies are a CAREER — they persist a new life like the
    // story arc. We only clear transient regular flags off live peds.
    g.cityNotoriety = g.cityNotoriety || 0;
    g.cityGangJobsDone = g.cityGangJobsDone || 0;   // crew-contract CV persists too
    g.cityCustomers = 0; g.cityDrugSales = g.cityDrugSales || 0;
    g.cityPostedUp = false; g.cityPostX = 0; g.cityPostZ = 0;
    for (const p of (CBZ.cityPeds || [])) { p.regular = false; p.reUpT = 0; p.loyalty = 0; p.seekPlayer = false; }
    if (CBZ.cityPlayerGangReset) CBZ.cityPlayerGangReset();
    if (CBZ.cityStoryReset) CBZ.cityStoryReset();
  };

  // ---- per-frame: job progress + passive income ----
  CBZ.onUpdate(38, function (dt) {
    if (g.mode !== "city") return;
    const j = g.cityJob;
    if (j) {
      const P = CBZ.player.pos;
      if (j.type === "hit") {
        if (j.targets && j.targets.length) {
          // multi-target sweep: retarget the beacon to the next live mark
          j.targets = j.targets.filter((t) => t && !t.dead);
          if (!j.targets.length) { CBZ.city.note("Sweep complete.", 1.6); finishJob(); }
          else { const t = j.targets[0]; if (beacon) beacon.position.set(t.pos.x, 15, t.pos.z); }
        } else if (j.target) {
          if (beacon && !j.target.dead) beacon.position.set(j.target.pos.x, 15, j.target.pos.z);
          if (j.target.dead) { CBZ.city.note("Contract complete.", 1.6); finishJob(); }
        }
      } else if (j.type === "delivery" && j.dest) {
        if (Math.hypot(P.x - j.dest.x, P.z - j.dest.z) < 4) { CBZ.city.note("Package delivered.", 1.6); finishJob(CBZ.player.driving ? 80 : 0); }
      } else if (j.type === "heist" && j.lot) {
        const ped = j.lot.building.vendor;
        if (ped && j._robBase === undefined) j._robBase = !!ped.robbed;   // baseline at activation
        if (ped && ped.robbed && !j._robBase) { CBZ.city.note("Register cleared.", 1.6); finishJob(); }   // only a FRESH rob counts — a pre-robbed store can't instant-complete
      } else if (j.type === "smuggle") {
        if (!j.got) {
          if (Math.hypot(P.x - j.pickup.x, P.z - j.pickup.z) < 4) {
            j.got = true; makeBeacon(j.dest.x, j.dest.z, 0x7ed957);
            CBZ.city.note("Stash secured. Run it to the drop — keep it clean.", 2.4);
          }
        } else {
          // wanted heat while carrying corrupts the load; lose it if it spikes
          if ((g.wanted | 0) >= 4) { failJob("the cops smelled the stash"); }
          else if (Math.hypot(P.x - j.dest.x, P.z - j.dest.z) < 4) { CBZ.city.note("Stash dropped — clean run.", 1.6); finishJob(CBZ.player.driving && (g.wanted | 0) === 0 ? 120 : 0); }
        }
      } else if (j.type === "getaway") {
        if (j.phase === "drive") {
          j.t -= dt;
          if (j.t <= 0) { failJob("you missed the pickup window"); }
          else if (CBZ.player.driving && Math.hypot(P.x - j.rdv.x, P.z - j.rdv.z) < 6) {
            j.phase = "escape"; clearBeacon();
            // pulling the job draws heat — now SHAKE it to get paid
            if (CBZ.cityCrime) CBZ.cityCrime(120, { x: P.x, z: P.z, type: "robbery" });
            CBZ.city.note("Crew's in! Lose the cops to get paid.", 2.6);
          }
        } else { // escape: clear your stars while staying in a car
          if (!CBZ.player.driving) { /* bailing on foot is risky but allowed */ }
          if ((g.wanted | 0) === 0) { CBZ.city.note("Clean getaway.", 1.6); finishJob(CBZ.player.driving ? 100 : 0); }
        }
      } else if (j.type === "protection" && j.lot) {
        const d = j.lot.building.door;
        if (Math.hypot(P.x - d.x, P.z - d.z) < 4 && !j.collecting) {
          j.collecting = true;
          // the owner may pay up — or resist and call it in (a shakedown gone loud)
          if (rng() < 0.45) {
            const ped = j.lot.building.vendor;
            if (ped) { ped.alarmed = 6; ped.fear = Math.min(10, (ped.fear || 0) + 4); }
            if (CBZ.cityCrime) CBZ.cityCrime(40, { x: d.x, z: d.z, type: "robbery" });
            CBZ.city.note("They balked — lean harder (rob the place) to collect.", 2.6);
            j.type = "heist"; // resolve via the register being cleared
          } else {
            CBZ.city.note("Envelope collected. The boss is pleased.", 1.8);
            finishJob();
          }
        }
      } else if (isGangJob(j.type)) {
        gangContractTick(j, P, dt);
      }
    }

    // passive income + wages + bank interest, on the economy's pay tick
    payT -= dt;
    if (payT <= 0) {
      const E = (CBZ.CITY && CBZ.CITY.econ) || {};
      payT = E.payTick || 6;
      const workers = CBZ.cityPeds.filter((p) => p.recruited && p.kind === "worker" && !p.dead).length;
      if (workers > 0 && (g.wanted | 0) === 0) { const inc = workers * (E.workerCut || 7); CBZ.city.addCash(inc); CBZ.city.note("Workers earned you $" + inc, 1.4); }
      // crew bodyguards are on SALARY — make payroll or one walks off the job
      const crew = CBZ.cityPeds.filter((p) => p.companion && !p.dead);
      if (crew.length) {
        const wage = crew.length * (E.crewSalary || 14);
        if ((g.cash || 0) >= wage) { g.cash -= wage; if (CBZ.cityHudDirty) CBZ.cityHudDirty(); }
        else { const q = crew[0]; q.companion = false; q.recruited = false; q.faction = null; if (q.gang === "player") q.gang = null; g.cityCrew = Math.max(0, (g.cityCrew || 0) - 1); CBZ.city.note("💸 Couldn't make payroll — " + q.name + " walked off.", 2.6); }
      }
      if (g.career === "security") {
        if ((g.wanted | 0) === 0) { CBZ.city.addCash(E.securityWage || 14); }
        else { g.career = null; CBZ.city.note("Security: you went wanted — you're FIRED.", 2.2); }
      }
      // CUSTOMER BASE + WALK-UP DEMAND: regulars who are due to re-up seek YOU
      // out, and — when you're POSTED UP on a corner — fresh addicts with a live
      // craving (the NPC need system) drift over to score too. Either way the
      // deal comes to you, passive street demand that scales with your base and
      // the block's appetite. (GTA street-dealer corner economics.)
      if (g.career === "dealer") {
        const inv = g.cityInv || {}; let units = 0; for (const d of DRUGS) units += (inv[d] || 0);
        const px = CBZ.player.pos.x, pz = CBZ.player.pos.z;
        // if you've wandered off your posted corner, you're effectively unposted
        if (g.cityPostedUp && (Math.abs(px - (g.cityPostX || px)) > 14 || Math.abs(pz - (g.cityPostZ || pz)) > 14)) {
          g.cityPostX = px; g.cityPostZ = pz; // re-anchor to where you stopped
        }
        let seekers = 0;
        // 1) regulars re-upping (works whether or not you're posted)
        const reg = regulars();
        for (const p of reg) {
          if (p.reUpT && CBZ.now >= p.reUpT) {
            const dx = p.pos.x - px, dz = p.pos.z - pz;
            const near = (dx * dx + dz * dz) < (60 * 60);
            if (near && units > 0 && !p.rage && p.state !== "flee" && !p.surrender) { sendPedTo(p, px, pz); p.seekPlayer = true; seekers++; }
            else if (!near) { p.reUpT = CBZ.now + 25000; } // ms: check back later
          }
        }
        // 2) posted-up walk-up trade: nearby craving addicts come find you. The
        // hotter the block's demand for what you carry, the more drift over.
        if (g.cityPostedUp && units > 0) {
          const econ = CBZ.cityEcon;
          const demand = econ && econ.streetPrice ? Math.min(1.6, econ.streetPrice(DRUGS[0]) / 60) : 1;
          let drawn = 0, cap = 2 + Math.round(demand);   // a small, believable trickle
          for (const p of CBZ.cityPeds) {
            if (drawn >= cap) break;
            if (p.dead || p.vendor || p.companion || p.controlled || p.recruited || p.seekPlayer) continue;
            if (!p.drugUser || p.rage || p.surrender || p.state === "flee") continue;
            const crave = p._needs ? p._needs.high : 0.3;     // a real craving from aigoals
            if (crave > 0.45) continue;                       // only the jonesing come over
            const dx = p.pos.x - px, dz = p.pos.z - pz;
            if ((dx * dx + dz * dz) > (45 * 45)) continue;     // within a block
            sendPedTo(p, px, pz); p.seekPlayer = true; drawn++;
          }
          seekers += drawn;
        }
        if (seekers > 0 && units > 0) CBZ.city.note(seekers + " buyer" + (seekers > 1 ? "s are" : " is") + " coming to score — [I] to deal.", 1.8);
      }
      // banked cash earns a little interest (the safe, slow way to grow money)
      if ((g.cityBank || 0) > 0 && E.bankRate) { const gain = Math.floor(g.cityBank * E.bankRate * (E.payTick || 6)); if (gain > 0) { g.cityBank += gain; if (CBZ.cityHudDirty) CBZ.cityHudDirty(); } }
    }
  });
})();
