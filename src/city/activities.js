/* ============================================================
   city/activities.js - Gang Life activity board.

   These are not isolated modes. Each entry resolves through the shared
   city world event bus, so races, fights, betting, transit, politics,
   counterterror, disasters, war jobs, jail, and hitman work all change
   the same persistent ledger.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const g = CBZ.game;

  const CATS = ["Racing", "Combat", "Betting", "Transit", "Civic", "Emergency", "Crime"];
  let panel = null, activeCat = "Racing";
  let active = null;

  const ACTIVITIES = [
    { id: "legal-race", cat: "Racing", label: "Legal Circuit Race", cost: 50, time: 4, reward: 320, desc: "Closed-course race. Improves driver reputation without police heat." },
    { id: "street-race", cat: "Racing", label: "Illegal Street Race", cost: 80, time: 4, reward: 620, desc: "High payout, crash risk, police witnesses, gang side bets." },
    { id: "drag-race", cat: "Racing", label: "Drag Race", cost: 60, time: 3.2, reward: 420, desc: "Short illegal sprint. Strong link to car tuning and traffic enforcement." },
    { id: "horse-bet", cat: "Racing", label: "Horse Race Bet", cost: 40, time: 3, reward: 190, desc: "Animal race sportsbook with odds, crowd money, and fixing rumors." },
    { id: "greyhound-bet", cat: "Racing", label: "Greyhound Bet", cost: 30, time: 2.8, reward: 145, desc: "AI-only race participants, quick odds, and track spectators." },

    { id: "boxing", cat: "Combat", label: "Boxing Bout", cost: 20, time: 4, reward: 260, desc: "Punches, stamina, knockdowns, judging, fight record, and sportsbook action." },
    { id: "mma", cat: "Combat", label: "UFC/MMA Bout", cost: 40, time: 4.5, reward: 420, desc: "Kicks, clinch, takedowns, submissions, injuries, and arena reputation." },
    { id: "paintball", cat: "Combat", label: "Paintball Match", cost: 35, time: 3.5, reward: 180, desc: "Nonlethal team shooting, cover, colored marks, scoring, and tactics." },

    { id: "casino-table", cat: "Betting", label: "Casino Table", cost: 100, time: 2.7, reward: 260, desc: "Table games that affect casino status, debt, VIP access, and laundering hooks." },
    { id: "sportsbook", cat: "Betting", label: "Sportsbook Parlay", cost: 75, time: 3, reward: 340, desc: "Bet across fights, races, horses, greyhounds, and underground events." },

    { id: "bus-route", cat: "Transit", label: "Ride Bus Route", cost: 3, time: 2.4, reward: 0, desc: "Pay a fare, move across the city, seed commute crowds and delay events." },
    { id: "train-pass", cat: "Transit", label: "Buy Train Pass", cost: 120, time: 1.5, reward: 0, desc: "Persistent transit access for fast travel, getaways, and commuter economy." },

    { id: "campaign", cat: "Civic", label: "Campaign Event", cost: 100, time: 3.4, reward: 0, desc: "Build political reputation through public events, supporters, and policy pressure." },
    { id: "permit-deal", cat: "Civic", label: "Corrupt Permit Deal", cost: 0, time: 3, reward: 380, desc: "Dirty civic money that adds scandal, corruption, police pressure, and business hooks." },

    { id: "counterterror", cat: "Emergency", label: "Counterterror Response", cost: 0, time: 4, reward: 420, desc: "Fictional extremist faction pressure, public fear, police response, and transit security." },
    { id: "war-sortie", cat: "Emergency", label: "War Sortie Contract", cost: 0, time: 4.5, reward: 700, desc: "Air vehicles, missiles, explosions, smoke, military escalation, and city damage." },
    { id: "disaster", cat: "Emergency", label: "City Disaster Event", cost: 0, time: 4, reward: 260, desc: "Fire, flood, panic, evacuation, destruction, repairs, and emergency politics." },
    { id: "survival-island", cat: "Emergency", label: "Deploy To Disaster Island", cost: 0, time: 0, reward: 0, desc: "Launch the disaster survival activity while writing deployment consequences to City." },

    { id: "hitman", cat: "Crime", label: "Street Hitman Contract", cost: 0, time: 0, reward: 650, desc: "Pick a real city target. Completion affects money, wanted level, factions, and hitman rep." },
    { id: "official-contract", cat: "Crime", label: "Protected Official Contract", cost: 0, time: 4.5, reward: 2200, desc: "Fictional high-risk contract with major police, political, media, and public panic fallout." },
    { id: "jail", cat: "Crime", label: "Turn Yourself In", cost: 0, time: 0, reward: 0, desc: "Route into the jail/prison activity. Your city ledger keeps the arrest history." },
  ];

  function chance(base, skill) { return clamp(base + (skill || 0) * 0.012 + (Math.random() - 0.5) * 0.18, 0.12, 0.9); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function world() { return CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null; }

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
      const reward = a.reward ? "payout up to $" + a.reward : (a.id === "train-pass" && w && w.transport.pass ? "pass owned" : "world consequence");
      return "<button class='ca-card' data-id='" + a.id + "'><div class='ca-name'>" + a.label + "</div><div class='ca-desc'>" + a.desc + "</div><div class='ca-meta'><span>" + price + "</span><span>" + reward + "</span></div></button>";
    }).join("");
    panel.innerHTML =
      "<div class='ca-head'><div><div class='ca-title'>Gang Life Board</div><div class='ca-sub'>Jobs, bets, contracts, jail handoffs, and city consequences.</div></div><button class='ca-close'>Close</button></div>" +
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
    if (active || g.cityActivity) { CBZ.city && CBZ.city.note("Finish the current activity first.", 1.8); return; }
    if (def.id === "survival-island") {
      CBZ.cityEvent && CBZ.cityEvent("disaster", { panic: 4, emergency: 4, political: 1, label: "Disaster island deployment", message: "Disaster deployment logged." });
      hide();
      if (CBZ.setMode && CBZ.startRun) { CBZ.setMode("survival"); CBZ.startRun(); }
      return;
    }
    if (def.id === "jail") {
      hide();
      if (CBZ.cityBust) CBZ.cityBust({ peaceful: true });
      return;
    }
    if (def.id === "hitman") { startHitman(false); hide(); return; }
    if (def.cost && !CBZ.city.spend(def.cost)) { CBZ.city && CBZ.city.note("Need $" + def.cost + " for " + def.label + ".", 1.8); return; }
    hide();
    if (!def.time) { resolve(def); return; }
    active = { id: def.id, t: def.time };
    g.cityActivity = { id: def.id, t: def.time, label: def.label };
    g.cityJob = { type: "activity", desc: def.label, reward: def.reward || 0 };
    CBZ.city && CBZ.city.note(def.label + " started.", 1.6);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  function payout(n) { if (n) CBZ.cityEvent && CBZ.cityEvent("activity-payout", { cash: n, message: "+$" + n }); }

  function resolve(def) {
    const w = world() || {};
    const rep = w.reputation || {};
    const win = chance(0.52, def.cat === "Racing" ? rep.driver : (def.cat === "Combat" ? rep.fighter : 0)) > Math.random();
    let profit = 0;

    if (def.id === "legal-race") {
      profit = win ? def.reward : 0; payout(profit);
      CBZ.cityEvent && CBZ.cityEvent("race-finish", { race: "legal", win, profit: profit - def.cost, driver: win ? 3 : 1, respect: win ? 2 : 0, message: win ? "Legal race won." : "Finished off the podium." });
    } else if (def.id === "street-race" || def.id === "drag-race") {
      const race = def.id === "drag-race" ? "drag" : "street";
      profit = win ? def.reward : 0; payout(profit);
      const crashed = Math.random() < (win ? 0.18 : 0.42);
      if (crashed) crashNearPlayer(win ? 10 : 18);
      CBZ.cityEvent && CBZ.cityEvent("race-finish", {
        race, win, illegal: true, profit: profit - def.cost, driver: win ? 4 : 1, respect: win ? 4 : 1,
        panic: crashed ? 5 : 2, damage: crashed ? 5 : 0.5, crimeHeat: crashed ? 70 : 35, crimeType: "illegal-racing",
        message: win ? "Illegal race won." : "Illegal race lost.",
      });
    } else if (def.id === "horse-bet" || def.id === "greyhound-bet") {
      const race = def.id === "horse-bet" ? "horse" : "greyhound";
      const odds = race === "horse" ? 4.5 : 3.8;
      const hit = Math.random() < (race === "horse" ? 0.28 : 0.31);
      profit = hit ? Math.round(def.cost * odds) : -def.cost;
      if (hit) payout(def.cost + profit);
      CBZ.cityEvent && CBZ.cityEvent("race-finish", { race, win: hit, profit });
      CBZ.cityEvent && CBZ.cityEvent("bet", { stake: def.cost, profit, faction: "casino", factionDelta: hit ? -1 : 1, message: hit ? "Track bet hit." : "Track bet lost." });
    } else if (def.id === "boxing" || def.id === "mma") {
      const fight = def.id === "mma" ? "mma" : "boxing";
      profit = win ? def.reward : 0; payout(profit);
      if (!win && CBZ.cityHurtPlayer) CBZ.cityHurtPlayer(fight === "mma" ? 28 : 18, CBZ.player.pos.x - 2, CBZ.player.pos.z, "beat up", false, null, true);
      CBZ.cityEvent && CBZ.cityEvent("fight-result", { fight, win, profit: profit - def.cost, fighter: win ? 4 : 1, respect: win ? 5 : 1, message: win ? "Fight won." : "Fight lost." });
    } else if (def.id === "paintball") {
      profit = win ? def.reward : 0; payout(profit);
      CBZ.cityEvent && CBZ.cityEvent("fight-result", { fight: "paintball", win, profit: profit - def.cost, respect: win ? 2 : 0, factions: { public: 1 }, message: win ? "Paintball match won." : "Paintball match lost." });
      const ww = world(); if (ww) ww.reputation.paintball = clamp((ww.reputation.paintball || 0) + (win ? 3 : 1), -100, 100);
    } else if (def.id === "casino-table" || def.id === "sportsbook") {
      const hit = Math.random() < (def.id === "casino-table" ? 0.43 : 0.26);
      profit = hit ? def.reward : -def.cost;
      if (hit) payout(def.cost + profit);
      else if (Math.random() < 0.2) CBZ.cityEvent && CBZ.cityEvent("casino-credit", { debt: Math.round(def.cost * 0.8), faction: "casino", factionDelta: 2 });
      CBZ.cityEvent && CBZ.cityEvent(def.id === "casino-table" ? "casino" : "bet", { stake: def.cost, profit, faction: "casino", factionDelta: hit ? -1 : 1, message: hit ? "Bet paid out." : "Bet lost." });
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
    } else if (def.id === "official-contract") {
      profit = def.reward; payout(profit);
      CBZ.cityEvent && CBZ.cityEvent("assassination", {
        cash: 0, hitman: 10, panic: 24, damage: 4, emergency: 22, political: -8, heat: 5,
        crimeHeat: 900, instant: true, crimeType: "protected-official-assassination", factions: { police: -10, political: -12, public: -10 },
        label: "Protected official contract", message: "Major fictional political fallout hit the city.",
      });
    }

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
    CBZ.city && CBZ.city.note(dst ? ("Transit dropped you at " + (dst.building.name || "a stop") + ".") : "Transit route complete.", 2);
  }

  function startHitman(highValue) {
    const pool = (CBZ.cityPeds || []).filter((p) => !p.dead && !p.vendor && !p.gang);
    const target = pool.length ? pool[(Math.random() * pool.length) | 0] : null;
    if (!target) { CBZ.city && CBZ.city.note("No viable target in the city right now.", 1.8); return; }
    const reward = highValue ? 2200 : 650 + ((Math.random() * 450) | 0);
    g.cityJob = {
      type: "hitman", target, reward,
      desc: (highValue ? "HIGH VALUE CONTRACT: " : "HITMAN CONTRACT: ") + target.name,
      highValue: !!highValue,
    };
    CBZ.cityEvent && CBZ.cityEvent("hitman-contract", { highValue, label: g.cityJob.desc, hitman: 2, message: "Contract target marked on the HUD." });
    CBZ.city && CBZ.city.note("Contract accepted: " + target.name + ".", 2.4);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  addEventListener("keydown", function (e) {
    if (e.repeat || g.mode !== "city" || g.state !== "playing") return;
    if ((e.key || "").toLowerCase() === "y" && !CBZ.cityMenuOpen) { e.preventDefault(); show(); }
    else if ((e.key || "").toLowerCase() === "escape" && panel && panel.style.display === "block") { e.preventDefault(); hide(); }
  });

  CBZ.onUpdate(38.6, function (dt) {
    if (g.mode !== "city") return;
    if (active) {
      active.t -= dt;
      if (g.cityActivity) g.cityActivity.t = Math.max(0, active.t);
      if (active.t <= 0) resolve(defById(active.id));
    }
    const j = g.cityJob;
    if (j && j.type === "hitman" && j.target) {
      if (j.target.dead) {
        CBZ.cityEvent && CBZ.cityEvent(j.highValue ? "assassination" : "hitman-complete", {
          cash: j.reward, respect: j.highValue ? 12 : 5, hitman: j.highValue ? 8 : 4,
          panic: j.highValue ? 18 : 5, emergency: j.highValue ? 10 : 2,
          crimeHeat: j.highValue ? 720 : 260, instant: !!j.highValue, crimeType: j.highValue ? "protected-target-hit" : "murder-for-hire",
          label: j.desc, message: "Contract complete.",
        });
        if (CBZ.city && CBZ.city.big) CBZ.city.big("CONTRACT PAID + $" + j.reward);
        g.cityJob = null;
      }
    }
  });
})();
