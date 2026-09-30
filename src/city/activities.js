/* ============================================================
   city/activities.js - Gang Life activity board.

   These are not isolated modes. Each entry resolves through the shared
   city world event bus, so transit, politics, counterterror, disasters,
   war jobs, jail and hitman work all change the same persistent ledger.

   WHAT IS NOT HERE ANY MORE (2026-09-28): the Racing and Betting tabs and
   the boxing / MMA fight nights. Each duplicated a venue you walk up to:
     casino tables   games/casino.js (the Golden Ace + every town casino's
                     tables via CBZ.cityOpenCasino)
     fights, bets    city/arena_fights.js + games/boxing.js at Ironjaw Arena
     racing          city/island_speedway.js + games/racing.js at Diamond
                     Speedway, street races off a racer on the street
                     (city/racing.js)
     every wager     city/betslip.js, written at the venue that takes it
                     (the racepark windows took over the track bets; the
                     parlay sportsbook had no venue and is gone)
   The board's own copies (menu casino, sportsbook parlay, fight-night bet,
   checkpoint street race, timer races, track bets) are deleted, not dark.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const g = CBZ.game;


  const CATS = ["Combat", "Transit", "Civic", "Emergency", "Crime"];
  let panel = null, activeCat = "Combat";
  let active = null;

  const ACTIVITIES = [
    { id: "paintball", cat: "Combat", label: "Paintball Match", cost: 35, time: 3.5, reward: 180, desc: "Team shooting, no bodies." },


    { id: "bus-route", cat: "Transit", label: "Ride Bus Route", cost: 3, time: 2.4, reward: 0, desc: "A fare across town." },
    { id: "train-pass", cat: "Transit", label: "Buy Train Pass", cost: 120, time: 1.5, reward: 0, desc: "Ride free from here on." },

    { id: "campaign", cat: "Civic", label: "Campaign Event", cost: 100, time: 3.4, reward: 0, desc: "Shake hands, buy a name." },
    { id: "permit-deal", cat: "Civic", label: "Corrupt Permit Deal", cost: 0, time: 3, reward: 380, desc: "Dirty paper, clean money." },

    { id: "counterterror", cat: "Emergency", label: "Counterterror Response", cost: 0, time: 4, reward: 420, desc: "A cell moves. The city panics." },
    { id: "war-sortie", cat: "Emergency", label: "War Sortie Contract", cost: 0, time: 4.5, reward: 700, desc: "Jets, missiles, and a bill for the damage." },
    { id: "disaster", cat: "Emergency", label: "City Disaster Event", cost: 0, time: 4, reward: 260, desc: "Fire, flood, and whoever gets out." },
    { id: "survival-island", cat: "Emergency", label: "Deploy To Disaster Island", cost: 0, time: 0, reward: 0, desc: "Fly out to the island and survive it." },

    { id: "hitman", cat: "Crime", label: "Hitman Contract", cost: 0, time: 0, reward: 900, desc: "One name off the wall. Quiet pays more." },
    { id: "official-contract", cat: "Crime", label: "Protected Contract", cost: 0, time: 0, reward: 15000, desc: "Protected names, and the office itself." },
    { id: "jail", cat: "Crime", label: "Turn Yourself In", cost: 0, time: 0, reward: 0, desc: "Walk in. The ledger keeps the record." },
  ];

  function chance(base, skill) { return clamp(base + (skill || 0) * 0.012 + (Math.random() - 0.5) * 0.18, 0.12, 0.9); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function world() { return CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null; }
  function note(m, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(m, s || 2); }

  function build() {
    if (panel) return;
    panel = document.createElement("div");
    panel.id = "cityActivities";
    document.body.appendChild(panel);
    panel.addEventListener("click", function (e) {
      const close = e.target.closest && e.target.closest(".ca-close");
      if (close) { hide(); return; }
      const tab = e.target.closest && e.target.closest(".ca-tab");
      if (tab) { activeCat = tab.dataset.cat; render(); return; }
      const card = e.target.closest && e.target.closest(".ca-card");
      if (card) start(card.dataset.id);
    });
  }

  function render() {
    build();
    const w = world();
    const defs = ACTIVITIES.filter((a) => a.cat === activeCat);
    const tabs = CATS.map((c) => "<button class='ca-tab" + (c === activeCat ? " on" : "") + "' data-cat='" + c + "'>" + c + "</button>").join("");
    const cards = defs.map((a) => {
      const price = a.cost ? "$" + a.cost : "no entry fee";
      let reward;
      if (a.reward) reward = "payout up to $" + a.reward;
      else if (a.id === "train-pass" && w && w.transport.pass) reward = "pass owned";
      else reward = "world consequence";
      return "<button class='ca-card' data-id='" + a.id + "'><div class='ca-name'>" + a.label + "</div><div class='ca-desc'>" + a.desc + "</div><div class='ca-meta'><span>" + price + "</span><span>" + reward + "</span></div></button>";
    }).join("");
    panel.innerHTML =
      "<div class='ca-head'><div class='ca-title'>Gang Life Board</div><button class='ca-close'>Close</button></div>" +
      "<div class='ca-tabs'>" + tabs + "</div><div class='ca-body'>" + cards + "</div>";
  }

  function show(cat) {
    if (g.mode !== "city" || g.state !== "playing") return;
    if (cat) activeCat = cat;
    if (CBZ.cityCloseShop) CBZ.cityCloseShop();
    render();
    panel.style.display = "block";
    CBZ.cityMenuOpen = true;
    if (document.exitPointerLock) try { document.exitPointerLock(); } catch (e) {}
  }
  function hide() {
    if (!panel) return;
    panel.style.display = "none";
    CBZ.cityMenuOpen = false;
    if (CBZ.requestLock && g.state === "playing") CBZ.requestLock();
  }
  CBZ.cityOpenActivities = show;

  function defById(id) { return ACTIVITIES.find((a) => a.id === id); }

  function start(id) {
    const def = defById(id); if (!def) return;
    if (CBZ.cityCampaignOwnsMission && CBZ.cityCampaignOwnsMission()) {
      if (CBZ.campaignUI && CBZ.campaignUI.open) CBZ.campaignUI.open("missions");
      return;
    }
    if (active || g.cityActivity) { note("Finish the current activity first.", 1.8); return; }
    if (def.id === "survival-island") {
      CBZ.cityEvent && CBZ.cityEvent("disaster", { panic: 4, emergency: 4, political: 1, label: "Disaster island deployment", message: "Disaster deployment logged." });
      hide();
      if (CBZ.setMode && CBZ.startRun) { CBZ.setMode("survival"); CBZ.startRun(); }
      return;
    }
    if (def.id === "jail") {
      hide();
      // turning yourself in from the menu is an authored transfer, not a
      // world arrest (there is no officer's hands to wait for)
      if (CBZ.cityBust) CBZ.cityBust({ peaceful: true, arc: false });
      return;
    }
    // THE ONE CONTRACT PIPE (Block Law): both Crime doors are thin routes into
    // city/hitman.js — the marks ladder that binds real peds / power.js
    // principals / the sitting officeholder and runs through CBZ.mission. The
    // old parallel generator (its own target pick, completion tick and payout)
    // is DELETED, not dark.
    if (def.id === "hitman") { hide(); if (CBZ.hitmanStart) CBZ.hitmanStart(); else note("The network is quiet.", 2); return; }
    if (def.id === "official-contract") { hide(); if (CBZ.hitmanStart) CBZ.hitmanStart({ min: 1 }); else note("The network is quiet.", 2); return; }

    if (def.cost && !CBZ.city.spend(def.cost)) { note("Need $" + def.cost + " for " + def.label + ".", 1.8); return; }
    hide();
    if (!def.time) { resolve(def); return; }
    active = { id: def.id, t: def.time };
    g.cityActivity = { id: def.id, t: def.time, label: def.label };
    g.cityJob = { type: "activity", desc: def.label, reward: def.reward || 0 };
    note(def.label + " started.", 1.6);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  function payout(n) { if (n) CBZ.cityEvent && CBZ.cityEvent("activity-payout", { cash: n, message: "+$" + n }); }

  function resolve(def) {
    const w = world() || {};
    const rep = w.reputation || {};
    const win = chance(0.52, def.cat === "Combat" ? rep.fighter : 0) > Math.random();
    let profit = 0;

    if (def.id === "paintball") {
      profit = win ? def.reward : 0; payout(profit);
      CBZ.cityEvent && CBZ.cityEvent("fight-result", { fight: "paintball", win, profit: profit - def.cost, respect: win ? 2 : 0, factions: { public: 1 }, message: win ? "Paintball match won." : "Paintball match lost." });
      const ww = world(); if (ww) ww.reputation.paintball = clamp((ww.reputation.paintball || 0) + (win ? 3 : 1), -100, 100);
    } else if (def.id === "bus-route") {
      rideTransit(false);
    } else if (def.id === "train-pass") {
      CBZ.cityEvent && CBZ.cityEvent("transport", { pass: true, fare: def.cost, factions: { transit: 5, public: 1 }, message: "Train pass activated." });
    } else if (def.id === "campaign") {
      const support = win ? 8 : 3;
      CBZ.cityEvent && CBZ.cityEvent("politics", { support, political: support, factions: { public: support > 5 ? 2 : 1 }, message: "Campaign event moved public support." });
    } else if (def.id === "permit-deal") {
      profit = def.reward; payout(profit);
      CBZ.cityEvent && CBZ.cityEvent("politics", { corruption: 8, scandal: 5, political: -2, crimeHeat: 25, crimeType: "corruption", message: "Corrupt permit money moved through City Hall." });
    } else if (def.id === "counterterror") {
      profit = win ? def.reward : 0; payout(profit);
      CBZ.cityEvent && CBZ.cityEvent(win ? "counterterror" : "terror-threat", {
        panic: win ? 2 : 14, emergency: win ? 3 : 14, confidence: win ? 1 : -8, cash: 0,
        factions: { police: win ? 5 : -3, public: win ? 3 : -4 }, message: win ? "Counterterror tip prevented an attack." : "Extremist cell caused a city emergency.",
      });
      if (!win) crashNearPlayer(14);
    } else if (def.id === "war-sortie") {
      profit = win ? def.reward : Math.round(def.reward * 0.35); payout(profit);
      CBZ.cityEvent && CBZ.cityEvent("war", { panic: 12, damage: 12, emergency: 18, confidence: -7, factions: { military: 4, public: -3 }, message: "War sortie shook the city." });
      crashNearPlayer(22);
    } else if (def.id === "disaster") {
      profit = win ? def.reward : 0; payout(profit);
      CBZ.cityEvent && CBZ.cityEvent("disaster", { panic: 16, damage: win ? 5 : 14, fire: 1, flood: Math.random() < 0.4 ? 1 : 0, emergency: 20, political: 1, confidence: -5, message: "City disaster response logged." });
      crashNearPlayer(16);
    }
    // (the old "official-contract" branch — $2,200 and city-wide fallout for a
    // 4.5s timer with NO target — was a stat fiction; that door now routes to
    // the one contract pipe in start(), where the officeholder is real.)

    active = null;
    g.cityActivity = null;
    if (g.cityJob && g.cityJob.type === "activity") g.cityJob = null;
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  function crashNearPlayer(speed) {
    const P = CBZ.player && CBZ.player.pos; if (!P) return;
    const x = P.x + (Math.random() - 0.5) * 14;
    const z = P.z + (Math.random() - 0.5) * 14;
    if (CBZ.cityCrashFX) CBZ.cityCrashFX(x, z, { speed, hard: true, catastrophic: speed > 20 });
    if (CBZ.cityShatter) CBZ.cityShatter(x, z, speed > 20 ? 9 : 5);
  }

  function rideTransit(hasPass) {
    const A = CBZ.city && CBZ.city.arena;
    if (!A || !CBZ.player) return;
    const lots = (A.shopLots || A.lots || []).filter((l) => l.building && l.building.door);
    const dst = lots.length ? lots[(Math.random() * lots.length) | 0] : null;
    const fare = hasPass ? 0 : 3;
    if (dst) {
      const d = dst.building.door;
      CBZ.player.pos.set(d.x + (d.nx || 0) * 2, 0, d.z + (d.nz || 0) * 2);
      CBZ.playerChar.group.position.copy(CBZ.player.pos);
      if (CBZ.cam) CBZ.cam.yaw += Math.PI * 0.35;
    }
    const delay = Math.random() < 0.2;
    CBZ.cityEvent && CBZ.cityEvent("transport", { fare, factions: { transit: 1, public: 1 }, label: "Bus route" });
    if (delay) CBZ.cityEvent && CBZ.cityEvent("transport-delay", { delay: 1, panic: 1, confidence: -1, message: "Transit delay rippled through the commute." });
    note(dst ? ("Transit dropped you at " + (dst.building.name || "a stop") + ".") : "Transit route complete.", 2);
  }

  /* ============================================================
     THE SOFT-LOCK CURE (confirmed bug, fixed 2026-07-26): die or get
     arrested with a timed activity running and the board refused every
     entry for the rest of the session. core/mission.js owns the one
     death/arrest/mode-exit edge detector (CBZ.mission.onInterrupt); this
     file is a consumer. The self-watch below is the degrade-safe fallback.
  ============================================================ */
  function abortEverything(reason) {
    const wasBusy = !!(active || g.cityActivity || (panel && panel.style.display === "block"));
    if (!wasBusy) return;
    active = null;
    if (g.cityActivity) g.cityActivity = null;
    if (g.cityJob && g.cityJob.type === "activity") g.cityJob = null;
    try { hide(); } catch (e) {}
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    void reason;
  }
  CBZ.cityActivitiesAbort = abortEverything;   // probes/gates + other modules
  // abortEverything() is idempotent (it early-returns when nothing is open), so
  // hooking BOTH paths is safe and removes any dependence on <script> order:
  // whichever edge fires first does the cleanup and the other finds nothing.
  let hookedMission = false;
  function hookMission() {
    if (hookedMission || !CBZ.mission || !CBZ.mission.onInterrupt) return;
    hookedMission = true;
    CBZ.mission.onInterrupt(abortEverything);
    if (CBZ.mission.adopt) CBZ.mission.adopt("city/activities.js");
  }
  hookMission();
  if (CBZ.onAlways) {
    let wasDead = false, wasBusted = false, lastMode = g.mode;
    CBZ.onAlways(CBZ.PRIO ? CBZ.PRIO.after(CBZ.PRIO.LATE, 2) : 90.02, function () {
      if (!hookedMission) hookMission();
      const dead = !!(CBZ.player && CBZ.player.dead), busted = !!g.busted;
      if ((dead && !wasDead) || (busted && !wasBusted)) abortEverything(dead ? "death" : "bust");
      if (g.mode !== lastMode) { lastMode = g.mode; abortEverything("mode"); }
      wasDead = dead; wasBusted = busted;
    });
  }


  addEventListener("keydown", function (e) {
    if (e.repeat || g.mode !== "city" || g.state !== "playing") return;
    const k = (e.key || "").toLowerCase();
    if (k === "y" && !CBZ.cityMenuOpen) { e.preventDefault(); show(); }
    else if (k === "escape" && panel && panel.style.display === "block") { e.preventDefault(); hide(); }
  });

  CBZ.onUpdate(38.6, function (dt) {
    if (g.mode !== "city" || !active) return;
    active.t -= dt;
    if (g.cityActivity) g.cityActivity.t = Math.max(0, active.t);
    if (active.t <= 0) resolve(defById(active.id));
  });
})();
