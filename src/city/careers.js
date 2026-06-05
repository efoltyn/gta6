/* ============================================================
   city/careers.js — the many ways to make money.

   • Job board (any shop): a deep CONTRACT BOARD — HIT, DELIVERY,
     store HEIST, SMUGGLING run, GETAWAY-DRIVER, PROTECTION racket,
     plus a MAYHEM spree. Pay & danger scale with your NOTORIETY rank
     (Nobody → Kingpin), GTA-style: do dirt, get bigger jobs.
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
  function gainNotoriety(amt) {
    const before = rankIdx();
    g.cityNotoriety = notoriety() + Math.max(0, amt | 0);
    const after = rankIdx();
    if (after > before) {
      CBZ.city.big("RANK UP · " + RANKS[after].name);
      CBZ.city.note("Your name carries weight now — a " + RANKS[after].name + ". Heavier jobs hit the board, and they pay.", 3.2);
      if (CBZ.sfx) CBZ.sfx("win");
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

  function aliveCivilians() { return CBZ.cityPeds.filter((p) => !p.dead && !p.vendor); }
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
    // MAYHEM — a spree gig that ticks on each rob/drop (kept from wave 1)
    jobs.push({ type: "vandal", count: 5 + ri, done: 0, reward: payout(250, 150), desc: "MAYHEM: rob or drop " + (5 + ri) + " people" });

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
  const ICON = { hit: "🎯", delivery: "📦", heist: "💰", smuggle: "🚚", getaway: "🏎️", protection: "💼", vandal: "🔨" };
  CBZ.cityJobBoard = function () {
    if (CBZ.cityCloseShop) CBZ.cityCloseShop();
    offered = rollJobs();
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
  function closeBoard() { if (board) board.style.display = "none"; CBZ.cityMenuOpen = false; if (CBZ.requestLock && g.state === "playing") CBZ.requestLock(); }
  function accept(i) {
    const j = offered[i]; if (!j) return;
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

  addEventListener("keydown", function (e) {
    if (!board || board.style.display !== "block") return;
    const k = e.key.toLowerCase();
    if (k === "escape") { e.preventDefault(); closeBoard(); return; }
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
    if (CBZ.sfx) CBZ.sfx("win");
    g.cityJob = null; clearBeacon();
  }
  function failJob(why) {
    const j = g.cityJob; if (!j) return;
    CBZ.city.note("Job blown — " + (why || "you lost it") + ".", 2.4);
    g.cityJob = null; clearBeacon();
  }
  CBZ.cityJobComplete = finishJob;
  CBZ.cityJobFail = failJob;

  // a MAYHEM (vandal) gig ticks up on each rob/drop you commit
  CBZ.cityCountMayhem = function () {
    const j = g.cityJob; if (!j || j.type !== "vandal") return;
    j.done = (j.done || 0) + 1;
    if (j.done >= j.count) { CBZ.city.note("Mayhem spree done!", 1.6); finishJob(); }
    else CBZ.city.note("Mayhem " + j.done + "/" + j.count, 1.1);
  };

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
  function regulars() { return CBZ.cityPeds.filter((p) => p.regular && !p.dead); }
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
    ped.reUpT = CBZ.now + (40 + rng() * 50); // when they'll want to re-up
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
    if (ped.boughtT && CBZ.now - ped.boughtT < 8) { CBZ.city.note(ped.name + " isn't interested right now.", 1.4); return; }
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
    econ.take(drug, 1);
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
    if (CBZ.sfx) CBZ.sfx("coin");
    CBZ.city.note("Sold " + drug + " to " + ped.name + " for $" + price + (turf.where === "home" ? " (your turf)" : "") + ".", 1.8);
  };

  // dealer dashboard line for interact/HUD prompts
  CBZ.cityDealerStatus = function () {
    const econ = CBZ.cityEcon, inv = g.cityInv || {};
    let units = 0; for (const d of DRUGS) units += (inv[d] || 0);
    const cust = regulars().length;
    const best = econ.bestMarket ? econ.bestMarket(pick(DRUGS)) : null;
    return { units, customers: cust, sales: g.cityDrugSales || 0, best };
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

  CBZ.cityCareersReset = function () {
    g.cityJob = null; g.cityCrew = 0; g.cityBank = g.cityBank || 0; clearBeacon(); payT = 0;
    // notoriety + sales tallies are a CAREER — they persist a new life like the
    // story arc. We only clear transient regular flags off live peds.
    g.cityNotoriety = g.cityNotoriety || 0;
    g.cityCustomers = 0; g.cityDrugSales = g.cityDrugSales || 0;
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
        if (ped && ped.robbed) { CBZ.city.note("Register cleared.", 1.6); finishJob(); }
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
      // CUSTOMER BASE: regulars who are due to re-up will seek YOU out. Nearby
      // ones path to the player so the deal comes to you (passive street demand
      // that grows with your base). Far ones just idle until they're in range.
      if (g.career === "dealer") {
        const inv = g.cityInv || {}; let units = 0; for (const d of DRUGS) units += (inv[d] || 0);
        const reg = regulars();
        if (reg.length) {
          let seekers = 0;
          for (const p of reg) {
            if (p.reUpT && CBZ.now >= p.reUpT) {
              const dx = p.pos.x - CBZ.player.pos.x, dz = p.pos.z - CBZ.player.pos.z;
              const near = (dx * dx + dz * dz) < (60 * 60);
              if (near && units > 0 && !p.rage && p.state !== "flee") { sendPedTo(p, CBZ.player.pos.x, CBZ.player.pos.z); p.seekPlayer = true; seekers++; }
              else if (!near) { p.reUpT = CBZ.now + 25; } // check back later
            }
          }
          if (seekers > 0 && units > 0) CBZ.city.note(seekers + " regular" + (seekers > 1 ? "s are" : " is") + " looking to re-up — [I] to deal.", 1.8);
        }
      }
      // banked cash earns a little interest (the safe, slow way to grow money)
      if ((g.cityBank || 0) > 0 && E.bankRate) { const gain = Math.floor(g.cityBank * E.bankRate * (E.payTick || 6)); if (gain > 0) { g.cityBank += gain; if (CBZ.cityHudDirty) CBZ.cityHudDirty(); } }
    }
  });
})();
