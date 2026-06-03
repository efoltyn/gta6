/* ============================================================
   city/careers.js — the many ways to make money.

   • Job board (any shop): HIT contracts, DELIVERY runs, store HEISTS.
   • Drug dealing: buy cheap at the trap house, sell on the street.
   • Crew / workers: recruit peds (gangster crew that defends you;
     pimp/entrepreneur workers that pay you passive income).
   • Legal: a Security Guard salary that pays while your record stays
     clean (and fires you the moment you go wanted).

   An active gig lives on g.cityJob with a world beacon; city/hud.js
   shows the objective + distance.
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

  // ---- job offers ----
  function rollJobs() {
    const jobs = [];
    const civ = aliveCivilians();
    if (civ.length) {
      const t = civ[(rng() * civ.length) | 0];
      jobs.push({ type: "hit", target: t, reward: 300 + ((rng() * 700) | 0), desc: "HIT: take out " + t.name });
    }
    const lots = CBZ.city.arena.lots.filter((l) => l.building);
    if (lots.length) {
      const dst = lots[(rng() * lots.length) | 0];
      jobs.push({ type: "delivery", dest: { x: dst.building.door.x, z: dst.building.door.z }, reward: 180 + ((rng() * 320) | 0), desc: "DELIVERY: drive a package across town" });
    }
    const shops = CBZ.city.arena.shopLots || [];
    if (shops.length) {
      const s = shops[(rng() * shops.length) | 0];
      jobs.push({ type: "heist", lot: s, reward: 400 + ((rng() * 900) | 0), desc: "HEIST: knock over " + s.building.name });
    }
    jobs.push({ type: "vandal", count: 5, done: 0, reward: 250, desc: "MAYHEM: rob or drop 5 people" });
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
  CBZ.cityJobBoard = function () {
    if (CBZ.cityCloseShop) CBZ.cityCloseShop();
    offered = rollJobs();
    let html = "<div style='font-size:20px;font-weight:700;margin-bottom:8px'>📋 Job Board</div>";
    offered.forEach((j, i) => { html += "<div style='padding:4px 0'><b style='color:#ffd166'>" + (i + 1) + "</b> " + j.desc + " <span style='color:#7ed957'>$" + j.reward + "</span></div>"; });
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
    if (j.dest) makeBeacon(j.dest.x, j.dest.z, 0x7ed957);
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
    CBZ.city.addCash(j.reward + (bonus || 0));
    CBZ.city.addRespect(Math.ceil(j.reward / 80));
    CBZ.city.big("+ $" + (j.reward + (bonus || 0)));
    if (CBZ.sfx) CBZ.sfx("win");
    g.cityJob = null; clearBeacon();
  }
  CBZ.cityJobComplete = finishJob;

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
      dealer: "You're a dealer now. Buy drugs at the trap house, then [I] Deal to people on the street.",
      security: "Hired as a Security Guard. Stay clean (0 stars) and earn a salary. KO criminals for bonuses.",
      pimp: "Running the night crew. [K] Recruit people — they'll earn you money over time.",
      gangster: "Building a crew. [K] Recruit fighters — they ride with you.",
    }[kind] || ("Career: " + kind);
    CBZ.city.note(msg, 3.5);
  };

  // street drug sale to a ped (called by interact.js [I] Deal)
  CBZ.cityDealTo = function (ped) {
    const econ = CBZ.cityEcon, inv = g.cityInv || {};
    const drugs = Object.keys(inv).filter((k) => econ.ITEMS[k] && econ.ITEMS[k].tag === "drug");
    if (!drugs.length) { CBZ.city.note("No product to sell. Buy at the trap house.", 1.8); return; }
    if (ped.boughtT && CBZ.now - ped.boughtT < 8) { CBZ.city.note(ped.name + " isn't interested right now.", 1.4); return; }
    const drug = drugs[0];
    if (rng() < 0.22) {   // some are narcs / refuse and may call it in
      ped.alarmed = 5; CBZ.cityAlarm(ped.pos.x, ped.pos.z, 12, 0.6, CBZ.city.playerActor);
      CBZ.cityCrime && CBZ.cityCrime(20, { x: ped.pos.x, z: ped.pos.z, type: "dealing" });
      CBZ.city.note(ped.name + " freaks out and walks off!", 1.6);
      return;
    }
    // the street price floats with the market; dumping product floods it down
    const price = econ.streetPrice ? econ.streetPrice(drug) : Math.round(econ.ITEMS[drug].value * 2.2);
    econ.take(drug, 1);
    if (econ.recordSale) econ.recordSale(drug, 1);
    CBZ.city.addCash(price); CBZ.city.addRespect(1);
    ped.boughtT = CBZ.now;
    // Personality and inventory stay independent. Buying product changes a
    // routine need, not whether this person happens to own a weapon.
    ped.drugUser = true;
    ped.tweakT = 0;
    if (ped.archetype === "resident") ped.archetype = "customer";
    ped.erratic = Math.max(ped.erratic || 0, drug === "Meth" ? 0.48 : 0.16);
    if (CBZ.sfx) CBZ.sfx("coin");
    CBZ.city.note("Sold " + drug + " to " + ped.name + " for $" + price, 1.8);
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
      CBZ.city.note("Recruited " + ped.name + " into the " + g.playerGang.name + ". Crew: " + g.cityCrew, 2.4);
    } else {
      CBZ.city.note("Recruited " + ped.name + " (" + (ped.kind === "crew" ? "bodyguard" : ped.kind) + "). Crew: " + g.cityCrew +
        (ped.kind === "crew" && g.cityCrew >= 3 && !(CBZ.cityPlayerGangExists && CBZ.cityPlayerGangExists()) ? " — press [O] to FOUND a gang!" : ""), 2.6);
    }
  };

  CBZ.cityCareersReset = function () { g.cityJob = null; g.cityCrew = 0; g.cityBank = g.cityBank || 0; clearBeacon(); payT = 0; if (CBZ.cityPlayerGangReset) CBZ.cityPlayerGangReset(); if (CBZ.cityStoryReset) CBZ.cityStoryReset(); };

  // ---- per-frame: job progress + passive income ----
  CBZ.onUpdate(38, function (dt) {
    if (g.mode !== "city") return;
    const j = g.cityJob;
    if (j) {
      if (j.type === "hit" && j.target) {
        if (beacon && !j.target.dead) beacon.position.set(j.target.pos.x, 15, j.target.pos.z);
        if (j.target.dead) { CBZ.city.note("Contract complete.", 1.6); finishJob(); }
      } else if (j.type === "delivery" && j.dest) {
        const d = Math.hypot(CBZ.player.pos.x - j.dest.x, CBZ.player.pos.z - j.dest.z);
        if (d < 4) { CBZ.city.note("Package delivered.", 1.6); finishJob(CBZ.player.driving ? 80 : 0); }
      } else if (j.type === "heist" && j.lot) {
        const ped = j.lot.building.vendor;
        if (ped && ped.robbed) { CBZ.city.note("Register cleared.", 1.6); finishJob(); }
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
      // banked cash earns a little interest (the safe, slow way to grow money)
      if ((g.cityBank || 0) > 0 && E.bankRate) { const gain = Math.floor(g.cityBank * E.bankRate * (E.payTick || 6)); if (gain > 0) { g.cityBank += gain; if (CBZ.cityHudDirty) CBZ.cityHudDirty(); } }
    }
  });
})();
