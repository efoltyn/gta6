/* ============================================================
   city/activities.js - Gang Life activity board.

   These are not isolated modes. Each entry resolves through the shared
   city world event bus, so races, fights, betting, transit, politics,
   counterterror, disasters, war jobs, jail, and hitman work all change
   the same persistent ledger.

   The high-value entries are no longer fake timers: street racing is a
   real drivable checkpoint course with rubber-band rivals + side bets,
   the casino runs blackjack / European roulette / weighted slots against
   a live bankroll, fight nights resolve a round-by-round momentum bout,
   and the sportsbook builds a real multi-leg parlay with combined odds.
   Research basis: GTA Diamond Casino house edges (BJ ~0.5-1.5%, single-
   zero roulette 35:1 straight / ~48.65% even-money / 2.70% edge, weighted
   3-reel slots), GTA street-race side betting + rubber-band catch-up AI,
   and real boxing round/decision/knockdown structure.
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
    { id: "street-race", cat: "Racing", label: "Illegal Street Race", cost: 80, time: 4, reward: 620, desc: "DRIVE a real checkpoint course vs rivals. Side bets, crash risk, police witnesses." },
    { id: "drag-race", cat: "Racing", label: "Drag Race", cost: 60, time: 3.2, reward: 420, desc: "Short illegal sprint. Strong link to car tuning and traffic enforcement." },
    { id: "horse-bet", cat: "Racing", label: "Horse Race Bet", cost: 40, time: 3, reward: 190, desc: "Animal race sportsbook with odds, crowd money, and fixing rumors." },
    { id: "greyhound-bet", cat: "Racing", label: "Greyhound Bet", cost: 30, time: 2.8, reward: 145, desc: "AI-only race participants, quick odds, and track spectators." },

    { id: "boxing", cat: "Combat", label: "Boxing Fight Night", cost: 20, time: 4, reward: 260, desc: "Bet then watch a live round-by-round bout: momentum, stamina, knockdowns, judges." },
    { id: "mma", cat: "Combat", label: "UFC/MMA Fight Night", cost: 40, time: 4.5, reward: 420, desc: "Striking, takedowns, submissions, finishes, and arena reputation. Live bet card." },
    { id: "paintball", cat: "Combat", label: "Paintball Match", cost: 35, time: 3.5, reward: 180, desc: "Nonlethal team shooting, cover, colored marks, scoring, and tactics." },

    { id: "casino-table", cat: "Betting", label: "Casino Floor", cost: 0, time: 0, reward: 0, desc: "Walk the floor: Blackjack, European Roulette, and Slots on a live bankroll." },
    { id: "sportsbook", cat: "Betting", label: "Sportsbook Parlay", cost: 0, time: 0, reward: 0, desc: "Build a multi-leg parlay across fights, races, horses, and greyhounds with real odds." },

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
  function note(m, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(m, s || 2); }
  function big(m) { if (CBZ.city && CBZ.city.big) CBZ.city.big(m); }
  function rndi(n) { return (Math.random() * n) | 0; }
  function pick(a) { return a[rndi(a.length)]; }
  function bankroll() { return (g.cash || 0); }

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
      if (a.id === "casino-table") reward = "live bankroll";
      else if (a.id === "sportsbook") reward = "build a parlay";
      else if (a.reward) reward = "payout up to $" + a.reward;
      else if (a.id === "train-pass" && w && w.transport.pass) reward = "pass owned";
      else reward = "world consequence";
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
    if (CBZ.cityCampaignOwnsMission && CBZ.cityCampaignOwnsMission()) {
      if (CBZ.campaignUI && CBZ.campaignUI.open) CBZ.campaignUI.open("missions");
      return;
    }
    if (active || g.cityActivity || raceRun) { note("Finish the current activity first.", 1.8); return; }
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

    // ---- rich interactive sub-modals (no entry-fee gate here; they take stakes inside) ----
    if (def.id === "casino-table") { openCasino(); return; }
    if (def.id === "sportsbook") { openSportsbook(); return; }
    if (def.id === "boxing" || def.id === "mma") { openFightNight(def); return; }
    if (def.id === "street-race") { openRaceSetup(def); return; }

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
    const win = chance(0.52, def.cat === "Racing" ? rep.driver : (def.cat === "Combat" ? rep.fighter : 0)) > Math.random();
    let profit = 0;

    if (def.id === "legal-race") {
      profit = win ? def.reward : 0; payout(profit);
      CBZ.cityEvent && CBZ.cityEvent("race-finish", { race: "legal", win, profit: profit - def.cost, driver: win ? 3 : 1, respect: win ? 2 : 0, message: win ? "Legal race won." : "Finished off the podium." });
    } else if (def.id === "drag-race") {
      profit = win ? def.reward : 0; payout(profit);
      const crashed = Math.random() < (win ? 0.18 : 0.42);
      if (crashed) crashNearPlayer(win ? 10 : 18);
      CBZ.cityEvent && CBZ.cityEvent("race-finish", {
        race: "drag", win, illegal: true, profit: profit - def.cost, driver: win ? 4 : 1, respect: win ? 4 : 1,
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
    } else if (def.id === "paintball") {
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
    note(dst ? ("Transit dropped you at " + (dst.building.name || "a stop") + ".") : "Transit route complete.", 2);
  }

  function startHitman(highValue) {
    const pool = (CBZ.cityPeds || []).filter((p) => !p.dead && !p.vendor && !p.gang);
    const target = pool.length ? pool[(Math.random() * pool.length) | 0] : null;
    if (!target) { note("No viable target in the city right now.", 1.8); return; }
    const reward = highValue ? 2200 : 650 + ((Math.random() * 450) | 0);
    g.cityJob = {
      type: "hitman", target, reward,
      desc: (highValue ? "HIGH VALUE CONTRACT: " : "HITMAN CONTRACT: ") + target.name,
      highValue: !!highValue,
    };
    CBZ.cityEvent && CBZ.cityEvent("hitman-contract", { highValue, label: g.cityJob.desc, hitman: 2, message: "Contract target marked on the HUD." });
    note("Contract accepted: " + target.name + ".", 2.4);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  /* =========================================================
     Shared modal scaffolding for the interactive minigames.
     Uses inline cssText (same pattern as careers.js / shops.js)
     so it does not depend on adding new rules to css/city.css.
  ========================================================= */
  let modal = null, modalBtns = {};
  function modalEl() {
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "cityActivityModal";
    modal.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:60;display:none;width:min(560px,94vw);max-height:88vh;overflow:auto;background:rgba(13,15,21,.97);border:2px solid #36405a;border-radius:18px;padding:18px 20px;color:#e8eef7;font-family:Fredoka,system-ui,sans-serif;box-shadow:0 22px 64px rgba(0,0,0,.6);pointer-events:auto";
    document.body.appendChild(modal);
    modal.addEventListener("click", function (e) {
      const b = e.target.closest && e.target.closest("[data-act]");
      if (b && modalBtns[b.dataset.act]) modalBtns[b.dataset.act](b);
    });
    return modal;
  }
  function openModal() {
    if (g.mode !== "city" || g.state !== "playing") return;
    hide();
    modalEl().style.display = "block";
    CBZ.cityMenuOpen = true;
    if (document.exitPointerLock) try { document.exitPointerLock(); } catch (e) {}
  }
  function closeModal() {
    if (modal) modal.style.display = "none";
    modalBtns = {};
    CBZ.cityMenuOpen = false;
    if (CBZ.requestLock && g.state === "playing") CBZ.requestLock();
  }
  function btn(label, act, accent, disabled) {
    const bg = disabled ? "rgba(255,255,255,.04)" : (accent ? "#2f6fed" : "rgba(255,255,255,.07)");
    const col = disabled ? "#5b6472" : (accent ? "#fff" : "#cdd6e3");
    const bd = disabled ? "#262d38" : (accent ? "#4f8bff" : "#39424f");
    return "<button data-act='" + act + "'" + (disabled ? " disabled" : "") + " style='border:1px solid " + bd + ";background:" + bg + ";color:" + col + ";border-radius:9px;padding:8px 12px;cursor:" + (disabled ? "default" : "pointer") + ";font:inherit;font-size:13px;font-weight:600'>" + label + "</button>";
  }
  function head(title, sub) {
    return "<div style='display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px'>" +
      "<div><div style='font-size:21px;font-weight:700'>" + title + "</div><div style='font-size:12px;color:#8a93a3;margin-top:2px'>" + (sub || "") + "</div></div>" +
      "<div style='text-align:right'><div style='font-size:11px;color:#8a93a3'>BANKROLL</div><div style='font-size:18px;font-weight:700;color:#7ed957'>$" + bankroll().toLocaleString() + "</div></div></div>";
  }
  function takeStake(n) {
    n = Math.round(n);
    if (n <= 0) return true;
    if (CBZ.city && CBZ.city.spend) { if (!CBZ.city.spend(n)) return false; return true; }
    if ((g.cash || 0) < n) return false; g.cash -= n; return true;
  }

  /* =========================================================
     1) CASINO FLOOR  —  Blackjack / European Roulette / Slots
        House edges modelled on GTA Diamond Casino numbers.
  ========================================================= */
  let casino = null;
  function openCasino() {
    casino = casino || { game: "menu", chips: 0, bj: null, bet: 25, rouletteHist: [], hr: false };
    openModal();
    renderCasino();
  }
  // HIGH-ROLLER GATE (E9): members-only VIP tables at 10x stakes — gated by
  // wealth tier (baller+) OR max DRIP (the club's own VIP threshold).
  const STAKE_MAX_NORMAL = 5000, STAKE_MAX_HIGH = 50000;
  function highRoller() {
    const tier = CBZ.cityEcon && CBZ.cityEcon.wealthTier ? CBZ.cityEcon.wealthTier() : null;
    const tierOk = !!tier && (tier.id === "baller" || tier.id === "kingpin");
    const drip = CBZ.cityPlayerDrip ? CBZ.cityPlayerDrip() : 0;
    return tierOk || drip >= ((CBZ.CITY && CBZ.CITY.VIP_DRIP) || 70);
  }
  function stakeCap() { return (casino.hr && highRoller()) ? STAKE_MAX_HIGH : STAKE_MAX_NORMAL; }
  function casinoBetControls(min, max) {
    const b = casino.bet;
    return "<div style='display:flex;gap:6px;align-items:center;margin:6px 0 10px'>" +
      "<span style='font-size:12px;color:#8a93a3'>Stake</span>" +
      btn("-25", "betdown") + "<div style='min-width:64px;text-align:center;font-weight:700;font-size:16px;color:#ffd166'>$" + b + "</div>" + btn("+25", "betup") +
      btn("Min", "betmin") + btn("Max", "betmax") +
      btn(casino.hr ? "High Roller ✓" : "High Roller", "hiroll", casino.hr) + "</div>";
  }
  function renderCasino() {
    const m = modalEl();
    modalBtns = {};
    if (casino.game === "menu") {
      m.innerHTML = head("Diamond-Style Casino", "Pick a game. The house always has an edge — bet smart.") +
        "<div style='display:grid;grid-template-columns:1fr 1fr 1fr;gap:9px;margin:6px 0 12px'>" +
        casinoTile("Blackjack", "blackjack", "Dealer stands on 17. BJ pays 3:2. ~99% RTP with good play.") +
        casinoTile("Roulette", "roulette", "Single-zero wheel. Straight 35:1, even-money ~48.6%.") +
        casinoTile("Slots", "slots", "3-reel weighted machine. Jackpot 250:1, ~90% RTP.") +
        "</div>" +
        "<div style='display:flex;justify-content:flex-end;gap:8px'>" + btn("Leave Casino", "leave") + "</div>";
      modalBtns.leave = function () { casinoCashout(); };
      modalBtns.blackjack = function () { casino.game = "blackjack"; casino.bj = null; renderCasino(); };
      modalBtns.roulette = function () { casino.game = "roulette"; renderCasino(); };
      modalBtns.slots = function () { casino.game = "slots"; renderCasino(); };
      return;
    }
    if (casino.game === "blackjack") return renderBlackjack();
    if (casino.game === "roulette") return renderRoulette();
    if (casino.game === "slots") return renderSlots();
  }
  function casinoTile(name, act, desc) {
    return "<button data-act='" + act + "' style='text-align:left;border:1px solid #2c3645;background:rgba(255,255,255,.04);color:#e8eef7;border-radius:12px;padding:12px;cursor:pointer;font:inherit'>" +
      "<div style='font-size:15px;font-weight:700;margin-bottom:4px'>" + name + "</div>" +
      "<div style='font-size:11px;color:#9fb0c6;line-height:1.3'>" + desc + "</div></button>";
  }
  function casinoCommit(profit, label) {
    // profit already net of stake (stake removed up front via takeStake)
    if (profit > 0) payout(profit);
    // E9: the HOUSE side of every settled bet books straight into Royale
    // Casino Corp (sim/corporations.js). Player loses -> real house revenue;
    // player wins -> the house pays out of its own bankroll (floored at 0).
    if (CBZ.corps) {
      if (profit < 0 && typeof CBZ.corps.creditRevenue === "function") CBZ.corps.creditRevenue("royale", -profit);
      else if (profit > 0 && typeof CBZ.corps.debitCash === "function") CBZ.corps.debitCash("royale", profit);
    }
    // BIG WIN SHOCK: a jackpot big enough to make the news dents confidence
    // in the house's stock — tiny per-dollar effect, but a real one.
    if (profit > 25000 && CBZ.stocks && typeof CBZ.stocks.shock === "function") {
      CBZ.stocks.shock("RYL", -profit / 2000000);
      if (CBZ.cityFeed) CBZ.cityFeed("🎰 Casino floor jackpot rattles Royale Casino Corp — RYL dips", "#ffd166");
    }
    CBZ.cityEvent && CBZ.cityEvent("casino", { profit, faction: "casino", factionDelta: profit > 0 ? -1 : 1 }, { silent: true });
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  function casinoCashout() {
    closeModal();
    note("Stepped off the casino floor.", 1.8);
  }

  // ----- Blackjack -----
  function freshShoe() {
    const cards = [];
    for (let d = 0; d < 6; d++) for (let r = 1; r <= 13; r++) for (let s = 0; s < 4; s++) cards.push(r);
    for (let i = cards.length - 1; i > 0; i--) { const j = rndi(i + 1); const t = cards[i]; cards[i] = cards[j]; cards[j] = t; }
    return cards;
  }
  function cardVal(r) { return r > 10 ? 10 : (r === 1 ? 11 : r); }
  function handTotal(h) {
    let t = 0, aces = 0;
    for (const r of h) { t += cardVal(r); if (r === 1) aces++; }
    while (t > 21 && aces > 0) { t -= 10; aces--; }
    return t;
  }
  function cardName(r) { return r === 1 ? "A" : (r === 11 ? "J" : r === 12 ? "Q" : r === 13 ? "K" : (r > 10 ? "10" : "" + r)); }
  function renderBlackjack() {
    const m = modalEl();
    modalBtns = {};
    const s = casino.bj;
    if (!s) {
      // betting screen
      const b = casino.bet, can = bankroll() >= b;
      m.innerHTML = head("Blackjack", "Place your bet, then Deal. Blackjack pays 3:2.") +
        casinoBetControls() +
        "<div style='display:flex;gap:8px;flex-wrap:wrap'>" +
        btn("Deal $" + b, "deal", true, !can) + btn("Back to floor", "back") + "</div>" +
        (can ? "" : "<div style='color:#ff6b6b;font-size:12px;margin-top:8px'>Not enough cash for that bet.</div>");
      bindBet();
      modalBtns.back = function () { casino.game = "menu"; renderCasino(); };
      modalBtns.deal = function () {
        if (!takeStake(b)) { note("Not enough cash.", 1.6); return; }
        const shoe = freshShoe();
        casino.bj = { shoe, bet: b, p: [shoe.pop(), shoe.pop()], d: [shoe.pop(), shoe.pop()], done: false, result: "", doubled: false };
        // immediate blackjack check
        renderBlackjack();
      };
      return;
    }
    const pt = handTotal(s.p), dShown = s.done ? handTotal(s.d) : cardVal(s.d[0]);
    const blackjackP = s.p.length === 2 && pt === 21;
    const dealerCards = s.done ? s.d.map(cardName).join(" ") : cardName(s.d[0]) + " ??";
    let body = "<div style='background:rgba(255,255,255,.03);border:1px solid #2a333f;border-radius:12px;padding:12px;margin:4px 0 10px'>" +
      "<div style='font-size:12px;color:#8a93a3'>DEALER " + (s.done ? "(" + handTotal(s.d) + ")" : "") + "</div>" +
      "<div style='font-size:24px;font-weight:700;letter-spacing:2px'>" + dealerCards + "</div>" +
      "<div style='height:8px'></div>" +
      "<div style='font-size:12px;color:#8a93a3'>YOU (" + pt + ")" + (blackjackP ? " — BLACKJACK!" : "") + "</div>" +
      "<div style='font-size:24px;font-weight:700;letter-spacing:2px'>" + s.p.map(cardName).join(" ") + "</div></div>";
    if (!s.done) {
      // auto-resolve naturals
      if (blackjackP) { settleBlackjack(); return; }
      const canDouble = s.p.length === 2 && bankroll() >= s.bet;
      m.innerHTML = head("Blackjack", "Stake $" + s.bet + (s.doubled ? " (doubled to $" + (s.bet) + ")" : "")) + body +
        "<div style='display:flex;gap:8px;flex-wrap:wrap'>" +
        btn("Hit", "hit", true) + btn("Stand", "stand") + btn("Double", "double", false, !canDouble) + "</div>";
      modalBtns.hit = function () {
        s.p.push(s.shoe.pop());
        if (handTotal(s.p) > 21) settleBlackjack();
        else renderBlackjack();
      };
      modalBtns.stand = function () { dealerPlay(); settleBlackjack(); };
      modalBtns.double = function () {
        if (!canDouble || !takeStake(s.bet)) return;
        s.bet *= 2; s.doubled = true; s.p.push(s.shoe.pop());
        if (handTotal(s.p) > 21) settleBlackjack(); else { dealerPlay(); settleBlackjack(); }
      };
      return;
    }
    // resolved
    const col = s.net > 0 ? "#7ed957" : (s.net < 0 ? "#ff6b6b" : "#ffd166");
    m.innerHTML = head("Blackjack", s.result) + body +
      "<div style='font-size:18px;font-weight:700;color:" + col + ";margin:4px 0 10px'>" + (s.net > 0 ? "+$" + s.net : (s.net < 0 ? "-$" + (-s.net) : "Push")) + "</div>" +
      "<div style='display:flex;gap:8px'>" + btn("Deal again", "again", true) + btn("Back to floor", "back") + "</div>";
    modalBtns.again = function () { casino.bj = null; renderBlackjack(); };
    modalBtns.back = function () { casino.bj = null; casino.game = "menu"; renderCasino(); };
  }
  function dealerPlay() {
    const s = casino.bj; s.done = true;
    while (handTotal(s.d) < 17) s.d.push(s.shoe.pop());
  }
  function settleBlackjack() {
    const s = casino.bj; s.done = true;
    const pt = handTotal(s.p), dt = handTotal(s.d);
    const bjP = s.p.length === 2 && pt === 21, bjD = s.d.length === 2 && dt === 21;
    let net = 0;
    if (pt > 21) { net = -s.bet; s.result = "Bust."; }
    else if (bjP && !bjD) { net = Math.round(s.bet * 1.5); s.result = "Blackjack! Pays 3:2."; }
    else if (bjD && !bjP) { net = -s.bet; s.result = "Dealer blackjack."; }
    else { if (dt > 21 || pt > dt) { net = s.bet; s.result = dt > 21 ? "Dealer busts — you win." : "You win."; } else if (pt < dt) { net = -s.bet; s.result = "Dealer wins."; } else { net = 0; s.result = "Push."; } }
    s.net = net;
    // stake already removed; return stake+win on a win, return stake on push
    if (net > 0) payout(s.bet + net);
    else if (net === 0) payout(s.bet);
    casinoCommit(net, "blackjack");
    renderBlackjack();
  }

  // ----- European Roulette (single zero, 0..36) -----
  const ROUL_BETS = [
    { id: "red", name: "Red", odds: 1, p: 18 / 37 },
    { id: "black", name: "Black", odds: 1, p: 18 / 37 },
    { id: "odd", name: "Odd", odds: 1, p: 18 / 37 },
    { id: "even", name: "Even", odds: 1, p: 18 / 37 },
    { id: "low", name: "1-18", odds: 1, p: 18 / 37 },
    { id: "high", name: "19-36", odds: 1, p: 18 / 37 },
    { id: "dozen1", name: "1st 12", odds: 2, p: 12 / 37 },
    { id: "dozen2", name: "2nd 12", odds: 2, p: 12 / 37 },
    { id: "dozen3", name: "3rd 12", odds: 2, p: 12 / 37 },
    { id: "straight", name: "Lucky #", odds: 35, p: 1 / 37 },
  ];
  const RED_SET = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  function spinRoulette(betId, lucky) {
    const n = rndi(37); // 0..36
    const red = RED_SET.has(n);
    let win = false;
    if (betId === "red") win = red && n !== 0;
    else if (betId === "black") win = !red && n !== 0;
    else if (betId === "odd") win = n !== 0 && n % 2 === 1;
    else if (betId === "even") win = n !== 0 && n % 2 === 0;
    else if (betId === "low") win = n >= 1 && n <= 18;
    else if (betId === "high") win = n >= 19 && n <= 36;
    else if (betId === "dozen1") win = n >= 1 && n <= 12;
    else if (betId === "dozen2") win = n >= 13 && n <= 24;
    else if (betId === "dozen3") win = n >= 25 && n <= 36;
    else if (betId === "straight") win = n === lucky;
    return { n, red, win };
  }
  function renderRoulette() {
    const m = modalEl();
    modalBtns = {};
    const lucky = casino.lucky == null ? (casino.lucky = rndi(37)) : casino.lucky;
    const hist = casino.rouletteHist.slice(-10).map((h) => "<span style='display:inline-block;min-width:20px;text-align:center;border-radius:4px;margin:1px;font-size:11px;font-weight:700;padding:1px 3px;background:" + (h.n === 0 ? "#1f7a3f" : (h.red ? "#b3261e" : "#222")) + ";color:#fff'>" + h.n + "</span>").join("");
    const betsHtml = ROUL_BETS.map((b) => {
      const label = b.id === "straight" ? "Lucky #" + lucky + " (35:1)" : b.name + " (" + b.odds + ":1)";
      return btn(label, "place:" + b.id);
    }).join("");
    m.innerHTML = head("European Roulette", "Single-zero wheel. Pick a bet for $" + casino.bet + ".") +
      casinoBetControls() +
      (casino.rollMsg ? "<div style='font-size:15px;font-weight:700;margin:2px 0 8px;color:" + (casino.rollMsg.win ? "#7ed957" : "#ff6b6b") + "'>" + casino.rollMsg.text + "</div>" : "") +
      "<div style='font-size:11px;color:#8a93a3;margin-bottom:4px'>RECENT: " + (hist || "—") + "</div>" +
      "<div style='display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:8px 0'>" + betsHtml + "</div>" +
      "<div style='display:flex;justify-content:flex-end;gap:8px'>" + btn("Back to floor", "back") + "</div>";
    bindBet();
    modalBtns.back = function () { casino.game = "menu"; renderCasino(); };
    ROUL_BETS.forEach((b) => {
      modalBtns["place:" + b.id] = function () {
        const stake = casino.bet;
        if (!takeStake(stake)) { note("Not enough cash.", 1.6); return; }
        const r = spinRoulette(b.id, lucky);
        casino.rouletteHist.push(r);
        if (r.win) {
          const winAmt = stake * b.odds; // profit; plus stake returned
          payout(stake + winAmt);
          casinoCommit(winAmt, "roulette");
          casino.rollMsg = { win: true, text: "Ball landed on " + r.n + " — " + b.name + " hits! +$" + winAmt };
        } else {
          casinoCommit(-stake, "roulette");
          casino.rollMsg = { win: false, text: "Ball landed on " + r.n + ". " + b.name + " loses -$" + stake };
        }
        casino.lucky = rndi(37); // re-roll the lucky number each spin
        renderRoulette();
      };
    });
  }

  // ----- Slots (3-reel weighted) -----
  // Weighted symbol table tuned to ~90% RTP w/ a fat jackpot tail.
  const SLOT_SYMS = ["7", "BAR", "BELL", "CHERRY", "LEMON", "PLUM"];
  const SLOT_WEIGHTS = [2, 5, 8, 14, 18, 18]; // rarer 7 / BAR
  const SLOT_PAY = { "7": 250, "BAR": 60, "BELL": 25, "CHERRY": 12, "LEMON": 8, "PLUM": 6 };
  function spinReel() {
    const total = SLOT_WEIGHTS.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < SLOT_SYMS.length; i++) { r -= SLOT_WEIGHTS[i]; if (r <= 0) return SLOT_SYMS[i]; }
    return SLOT_SYMS[SLOT_SYMS.length - 1];
  }
  function renderSlots() {
    const m = modalEl();
    modalBtns = {};
    const reels = casino.reels || ["?", "?", "?"];
    const can = bankroll() >= casino.bet;
    m.innerHTML = head("Slots", "3 of a kind pays. Three 7s = 250:1 jackpot.") +
      casinoBetControls() +
      "<div style='display:flex;gap:10px;justify-content:center;margin:10px 0;font-size:34px;font-weight:800;letter-spacing:2px'>" +
      reels.map((r) => "<div style='min-width:80px;text-align:center;background:rgba(255,255,255,.05);border:1px solid #2c3645;border-radius:12px;padding:10px 0'>" + r + "</div>").join("") + "</div>" +
      (casino.slotMsg ? "<div style='text-align:center;font-size:16px;font-weight:700;margin:2px 0 10px;color:" + (casino.slotMsg.win ? "#7ed957" : "#ff6b6b") + "'>" + casino.slotMsg.text + "</div>" : "") +
      "<div style='display:flex;gap:8px;justify-content:center'>" + btn("SPIN $" + casino.bet, "spin", true, !can) + btn("Back to floor", "back") + "</div>";
    bindBet();
    modalBtns.back = function () { casino.game = "menu"; renderCasino(); };
    modalBtns.spin = function () {
      if (!takeStake(casino.bet)) { note("Not enough cash.", 1.6); return; }
      const r = [spinReel(), spinReel(), spinReel()];
      casino.reels = r;
      let mult = 0, txt = "";
      if (r[0] === r[1] && r[1] === r[2]) { mult = SLOT_PAY[r[0]]; txt = r[0] === "7" ? "JACKPOT! Three 7s!" : "Three " + r[0] + "s!"; }
      else if ((r[0] === "CHERRY") + (r[1] === "CHERRY") + (r[2] === "CHERRY") >= 2) { mult = 2; txt = "Two cherries."; }
      else { mult = 0; txt = "No match."; }
      if (mult > 0) {
        const winAmt = casino.bet * mult; payout(casino.bet + winAmt); casinoCommit(winAmt, "slots");
        casino.slotMsg = { win: true, text: txt + " +$" + winAmt };
        if (mult >= 250) { big("SLOTS JACKPOT +$" + winAmt); }   // (no jingle — user: no music in gang city)
      } else { casinoCommit(-casino.bet, "slots"); casino.slotMsg = { win: false, text: txt + " -$" + casino.bet }; }
      renderSlots();
    };
  }
  function bindBet() {
    modalBtns.betup = function () { casino.bet = Math.min(stakeCap(), casino.bet + 25); reRenderCasinoGame(); };
    modalBtns.betdown = function () { casino.bet = Math.max(25, casino.bet - 25); reRenderCasinoGame(); };
    modalBtns.betmin = function () { casino.bet = 25; reRenderCasinoGame(); };
    modalBtns.betmax = function () { casino.bet = Math.max(25, Math.min(stakeCap(), Math.floor(bankroll() / 25) * 25)) || 25; reRenderCasinoGame(); };
    modalBtns.hiroll = function () {
      if (!casino.hr && !highRoller()) { note("⛔ Members only — VIP tables need Baller wealth or max DRIP.", 2.4); return; }
      casino.hr = !casino.hr;
      casino.bet = Math.min(stakeCap(), casino.bet);
      reRenderCasinoGame();
    };
  }
  function reRenderCasinoGame() {
    if (casino.game === "blackjack") renderBlackjack();
    else if (casino.game === "roulette") renderRoulette();
    else if (casino.game === "slots") renderSlots();
  }

  /* =========================================================
     2) FIGHT NIGHT  —  live round-by-round bout w/ momentum.
        You bet on yourself or the opponent, then watch a real
        simulated bout: per-round damage, stamina drain, momentum
        swings, knockdowns, finishes, and a judges' decision.
  ========================================================= */
  let fight = null;
  const FIGHTER_NAMES = ["Diaz", "Volk", "O'Malley", "Adesanya", "Holloway", "Pereira", "Makhachev", "Chimaev", "Gaethje", "Poirier", "Rodriguez", "Tank Davis", "Crawford", "Canelo"];
  function openFightNight(def) {
    const mma = def.id === "mma";
    const w = world() || {}; const fr = (w.reputation && w.reputation.fighter) || 0;
    const oppName = pick(FIGHTER_NAMES);
    // Opponent strength relative to player; player gets a rep edge.
    const oppRating = clamp(0.42 + Math.random() * 0.3 - fr * 0.004, 0.25, 0.7);
    const playerRating = clamp(0.5 + fr * 0.004 + (mma ? 0.02 : 0), 0.3, 0.78);
    // Moneyline-style odds from win probabilities.
    const pWin = clamp(playerRating / (playerRating + oppRating), 0.2, 0.8);
    const playerOdds = +(1 / pWin * 0.94).toFixed(2);   // 6% vig
    const oppOdds = +(1 / (1 - pWin) * 0.94).toFixed(2);
    fight = {
      mma, def, oppName, rounds: mma ? 5 : 8, bet: def.cost || 25, side: "me",
      playerRating, oppRating, pWin, playerOdds, oppOdds,
      stage: "bet", log: [], round: 0, me: { hp: 100, stam: 100, kd: 0 }, opp: { hp: 100, stam: 100, kd: 0 },
      momentum: 0,
    };
    openModal();
    renderFightBet();
  }
  function renderFightBet() {
    const m = modalEl(); modalBtns = {};
    const f = fight, can = bankroll() >= f.bet;
    const myOdds = f.side === "me" ? f.playerOdds : f.oppOdds;
    const payoutEst = Math.round(f.bet * myOdds);
    m.innerHTML = head((f.mma ? "UFC/MMA Fight Night" : "Boxing Fight Night"), "YOU vs " + f.oppName + " — " + f.rounds + " rounds") +
      "<div style='display:flex;gap:8px;margin:4px 0 10px'>" +
      fightSideTile("Back Yourself", "me", f.playerOdds, f.side === "me") +
      fightSideTile("Back " + f.oppName, "opp", f.oppOdds, f.side === "opp") + "</div>" +
      "<div style='display:flex;gap:6px;align-items:center;margin:6px 0 10px'>" +
      "<span style='font-size:12px;color:#8a93a3'>Bet</span>" + btn("-25", "betdown") +
      "<div style='min-width:64px;text-align:center;font-weight:700;font-size:16px;color:#ffd166'>$" + f.bet + "</div>" + btn("+25", "betup") + "</div>" +
      "<div style='font-size:12px;color:#9fb0c6;margin-bottom:10px'>Win probability you're backing: " + Math.round((f.side === "me" ? f.pWin : 1 - f.pWin) * 100) + "% · payout ~$" + payoutEst + " (incl. stake)</div>" +
      "<div style='display:flex;gap:8px'>" + btn("Start the bout", "go", true, !can) + btn("Walk away", "leave") + "</div>" +
      (can ? "" : "<div style='color:#ff6b6b;font-size:12px;margin-top:8px'>Not enough cash for that bet.</div>");
    modalBtns.betup = function () { f.bet = Math.min(5000, f.bet + 25); renderFightBet(); };
    modalBtns.betdown = function () { f.bet = Math.max(0, f.bet - 25); renderFightBet(); };
    modalBtns.me = function () { f.side = "me"; renderFightBet(); };
    modalBtns.opp = function () { f.side = "opp"; renderFightBet(); };
    modalBtns.leave = function () { fight = null; closeModal(); note("Skipped the fight card.", 1.6); };
    modalBtns.go = function () {
      if (f.bet > 0 && !takeStake(f.bet)) { note("Not enough cash.", 1.6); return; }
      f.stage = "live"; f.round = 0; runFightRound();
    };
  }
  function fightSideTile(label, side, odds, on) {
    return "<button data-act='" + side + "' style='flex:1;text-align:center;border:1px solid " + (on ? "#4f8bff" : "#2c3645") + ";background:" + (on ? "rgba(79,139,255,.16)" : "rgba(255,255,255,.04)") + ";color:#e8eef7;border-radius:12px;padding:12px;cursor:pointer;font:inherit'>" +
      "<div style='font-size:14px;font-weight:700'>" + label + "</div><div style='font-size:13px;color:#ffd166;margin-top:3px'>" + odds.toFixed(2) + "x</div></button>";
  }
  function runFightRound() {
    const f = fight; f.round++;
    const me = f.me, opp = f.opp;
    // each round: both throw; output scaled by rating, stamina, momentum
    function out(att, def, baseRating, momentumFor) {
      const stamFactor = 0.5 + att.stam / 200;
      const mo = 1 + momentumFor * 0.12;
      let dmg = (4 + Math.random() * 11) * baseRating * stamFactor * mo;
      att.stam = clamp(att.stam - (5 + Math.random() * 7), 5, 100);
      return dmg;
    }
    const meDmg = out(me, opp, f.playerRating + 0.5, f.momentum);
    const oppDmg = out(opp, me, f.oppRating + 0.5, -f.momentum);
    opp.hp = clamp(opp.hp - meDmg, 0, 100);
    me.hp = clamp(me.hp - oppDmg, 0, 100);
    // momentum swings toward whoever landed harder this round
    f.momentum = clamp(f.momentum + (meDmg - oppDmg) * 0.05, -3, 3);
    // knockdown chance scales with damage taken in the round
    let line = "R" + f.round + ": ";
    if (oppDmg - meDmg > 7 && Math.random() < 0.35) { me.kd++; me.hp = clamp(me.hp - 6, 0, 100); line += "YOU dropped! "; }
    if (meDmg - oppDmg > 7 && Math.random() < 0.35) { opp.kd++; opp.hp = clamp(opp.hp - 6, 0, 100); line += f.oppName + " dropped! "; }
    line += "you " + Math.round(me.hp) + "hp / " + f.oppName + " " + Math.round(opp.hp) + "hp";
    f.log.unshift(line);
    if (f.log.length > 6) f.log.length = 6;
    // finish conditions
    const sub = f.mma && Math.random() < 0.06 * (1 + Math.max(0, f.momentum) * 0.3) && opp.hp < 55;
    const subAgainst = f.mma && Math.random() < 0.05 * (1 + Math.max(0, -f.momentum) * 0.3) && me.hp < 50;
    if (opp.hp <= 0 || (me.kd >= 0 && opp.kd >= 0 && opp.hp < 12 && Math.random() < 0.6) || sub) { return finishFight("win", sub ? "submission" : "KO"); }
    if (me.hp <= 0 || (opp.hp < 100 && me.hp < 12 && Math.random() < 0.6) || subAgainst) { return finishFight("loss", subAgainst ? "submission" : "KO"); }
    if (f.round >= f.rounds) { return finishFight(judgeDecision(), "decision"); }
    renderFightLive();
  }
  function judgeDecision() {
    const f = fight;
    // score by remaining hp + knockdowns landed
    const myScore = f.me.hp + (f.opp.kd * 8) - (f.me.kd * 8);
    const oppScore = f.opp.hp + (f.me.kd * 8) - (f.opp.kd * 8);
    return myScore >= oppScore ? "win" : "loss";
  }
  function renderFightLive() {
    const f = fight; const m = modalEl(); modalBtns = {};
    function bar(label, val, col) {
      return "<div style='margin:4px 0'><div style='font-size:11px;color:#8a93a3'>" + label + "</div>" +
        "<div style='height:9px;background:#222a33;border-radius:6px;overflow:hidden'><div style='height:100%;width:" + Math.round(val) + "%;background:" + col + "'></div></div></div>";
    }
    const moArrow = f.momentum > 0.4 ? "▲ you" : (f.momentum < -0.4 ? "▼ " + f.oppName : "even");
    m.innerHTML = head((f.mma ? "MMA — Round " + f.round + "/" + f.rounds : "Boxing — Round " + f.round + "/" + f.rounds), "Momentum: " + moArrow) +
      "<div style='display:flex;gap:14px'>" +
      "<div style='flex:1'>" + bar("YOU", f.me.hp, "#4f8bff") + bar("stamina", f.me.stam, "#7ed957") + "</div>" +
      "<div style='flex:1'>" + bar(f.oppName, f.opp.hp, "#ff6b6b") + bar("stamina", f.opp.stam, "#ffb347") + "</div></div>" +
      "<div style='background:rgba(255,255,255,.03);border:1px solid #2a333f;border-radius:10px;padding:10px;margin:10px 0;font-size:12px;line-height:1.5;color:#cdd6e3'>" + f.log.join("<br>") + "</div>" +
      "<div style='display:flex;gap:8px'>" + btn("Next round", "next", true) + btn("Sim to end", "sim") + "</div>";
    modalBtns.next = function () { runFightRound(); };
    modalBtns.sim = function () { while (fight && fight.stage === "live") runFightRound(); };
  }
  function finishFight(result, method) {
    const f = fight; f.stage = "done";
    const won = result === "win";
    const betWon = (f.side === "me") === won;
    const odds = f.side === "me" ? f.playerOdds : f.oppOdds;
    let net = 0;
    if (f.bet > 0) {
      if (betWon) { const gross = Math.round(f.bet * odds); payout(gross); net = gross - f.bet; }
      else net = -f.bet;
    }
    // hurt the player a bit if they lost a bout they fought
    if (!won && CBZ.cityHurtPlayer) CBZ.cityHurtPlayer(f.mma ? 24 : 16, CBZ.player.pos.x - 2, CBZ.player.pos.z, "beat up", false, null, true);
    CBZ.cityEvent && CBZ.cityEvent("fight-result", {
      fight: f.mma ? "mma" : "boxing", win: won, profit: net,
      fighter: won ? 4 : 1, respect: won ? 5 : 1,
      message: (won ? "You won by " + method + "!" : "You lost by " + method + "."),
    });
    if (f.bet > 0) {
      CBZ.cityEvent && CBZ.cityEvent("bet", { stake: f.bet, profit: net, faction: "casino", factionDelta: betWon ? -1 : 1 }, { silent: true });
    }
    renderFightDone(result, method, net);
  }
  function renderFightDone(result, method, net) {
    const f = fight; const m = modalEl(); modalBtns = {};
    const won = result === "win";
    const col = net > 0 ? "#7ed957" : (net < 0 ? "#ff6b6b" : "#ffd166");
    m.innerHTML = head("Fight Over", (won ? "YOU win by " + method + "." : f.oppName + " wins by " + method + ".")) +
      "<div style='font-size:30px;font-weight:800;margin:6px 0;color:" + (won ? "#7ed957" : "#ff6b6b") + "'>" + (won ? "VICTORY" : "DEFEAT") + "</div>" +
      "<div style='font-size:12px;color:#cdd6e3;margin-bottom:6px'>" + f.log.slice(0, 4).join("<br>") + "</div>" +
      (f.bet > 0 ? "<div style='font-size:18px;font-weight:700;color:" + col + ";margin:6px 0 10px'>Bet result: " + (net > 0 ? "+$" + net : (net < 0 ? "-$" + (-net) : "push")) + "</div>" : "") +
      "<div style='display:flex;gap:8px'>" + btn("Leave arena", "leave", true) + "</div>";
    modalBtns.leave = function () { fight = null; closeModal(); };
  }

  /* =========================================================
     3) SPORTSBOOK  —  real multi-leg parlay w/ combined odds.
        Each leg is a real underground event with win-prob-based
        decimal odds; the parlay multiplies them. One stake.
  ========================================================= */
  let book = null;
  function buildBookEvents() {
    const ev = [];
    function legs(name, runners) {
      const total = runners.reduce((a, r) => a + r.w, 0);
      return { name, runners: runners.map((r) => ({ name: r.name, p: r.w / total, odds: +(total / r.w * 0.9).toFixed(2) })) };
    }
    ev.push(legs("Main Event Boxing", [{ name: pick(FIGHTER_NAMES), w: 5 }, { name: pick(FIGHTER_NAMES), w: 4 }]));
    ev.push(legs("MMA Co-Main", [{ name: pick(FIGHTER_NAMES), w: 6 }, { name: pick(FIGHTER_NAMES), w: 3 }]));
    ev.push(legs("Street Race", [{ name: "Crimson", w: 4 }, { name: "Viper", w: 3 }, { name: "Ghost", w: 2 }, { name: "Nitro", w: 2 }]));
    ev.push(legs("Horse Race", [{ name: "Iron Hoof", w: 5 }, { name: "Lucky Strike", w: 4 }, { name: "Midnight", w: 3 }, { name: "Long Shot", w: 1 }]));
    ev.push(legs("Greyhound Sprint", [{ name: "Dash", w: 5 }, { name: "Bolt", w: 4 }, { name: "Comet", w: 3 }]));
    return ev;
  }
  function openSportsbook() {
    book = { events: buildBookEvents(), picks: {}, stake: 50, stage: "build", result: null };
    openModal();
    renderSportsbook();
  }
  function parlayOdds() {
    let mult = 1, n = 0;
    for (const eid in book.picks) { mult *= book.picks[eid].odds; n++; }
    return { mult: n ? mult : 0, legs: n };
  }
  function renderSportsbook() {
    const m = modalEl(); modalBtns = {};
    if (book.stage === "result") return renderBookResult();
    const po = parlayOdds();
    const evHtml = book.events.map((ev, ei) => {
      const runners = ev.runners.map((r) => {
        const picked = book.picks[ei] && book.picks[ei].name === r.name;
        return "<button data-act='pick:" + ei + ":" + r.name + "' style='border:1px solid " + (picked ? "#4f8bff" : "#2c3645") + ";background:" + (picked ? "rgba(79,139,255,.18)" : "rgba(255,255,255,.04)") + ";color:#e8eef7;border-radius:8px;padding:6px 9px;cursor:pointer;font:inherit;font-size:12px'>" + r.name + " <span style='color:#ffd166'>" + r.odds.toFixed(2) + "</span></button>";
      }).join("");
      return "<div style='margin:8px 0'><div style='font-size:12px;color:#9fb0c6;margin-bottom:4px'>" + ev.name + "</div><div style='display:flex;gap:6px;flex-wrap:wrap'>" + runners + "</div></div>";
    }).join("");
    const can = po.legs >= 1 && bankroll() >= book.stake;
    const payoutEst = po.legs ? Math.round(book.stake * po.mult) : 0;
    m.innerHTML = head("Underground Sportsbook", "Pick one runner per event. Legs multiply into a parlay.") +
      evHtml +
      "<div style='display:flex;gap:6px;align-items:center;margin:10px 0 6px'>" +
      "<span style='font-size:12px;color:#8a93a3'>Stake</span>" + btn("-25", "down") +
      "<div style='min-width:64px;text-align:center;font-weight:700;font-size:16px;color:#ffd166'>$" + book.stake + "</div>" + btn("+25", "up") + "</div>" +
      "<div style='font-size:13px;color:#cdd6e3;margin-bottom:10px'>" + po.legs + "-leg parlay · combined " + (po.legs ? po.mult.toFixed(2) + "x" : "—") + " · returns ~$" + payoutEst + "</div>" +
      "<div style='display:flex;gap:8px'>" + btn("Place parlay", "place", true, !can) + btn("Clear", "clear") + btn("Leave", "leave") + "</div>" +
      (po.legs && !can ? "<div style='color:#ff6b6b;font-size:12px;margin-top:8px'>Not enough cash for that stake.</div>" : "");
    book.events.forEach((ev, ei) => ev.runners.forEach((r) => {
      modalBtns["pick:" + ei + ":" + r.name] = function () { book.picks[ei] = r; renderSportsbook(); };
    }));
    modalBtns.up = function () { book.stake = Math.min(5000, book.stake + 25); renderSportsbook(); };
    modalBtns.down = function () { book.stake = Math.max(25, book.stake - 25); renderSportsbook(); };
    modalBtns.clear = function () { book.picks = {}; renderSportsbook(); };
    modalBtns.leave = function () { book = null; closeModal(); note("Left the sportsbook.", 1.6); };
    modalBtns.place = function () {
      if (po.legs < 1) return;
      if (!takeStake(book.stake)) { note("Not enough cash.", 1.6); return; }
      // resolve each leg
      const legResults = [];
      let allHit = true;
      for (const eid in book.picks) {
        const ev = book.events[eid], picked = book.picks[eid];
        // sample a winner weighted by each runner's win prob
        let r = Math.random(), winner = ev.runners[ev.runners.length - 1];
        for (const run of ev.runners) { r -= run.p; if (r <= 0) { winner = run; break; } }
        const hit = winner.name === picked.name;
        if (!hit) allHit = false;
        legResults.push({ ev: ev.name, pick: picked.name, winner: winner.name, hit });
      }
      let net;
      if (allHit) { const gross = Math.round(book.stake * po.mult); payout(gross); net = gross - book.stake; }
      else net = -book.stake;
      CBZ.cityEvent && CBZ.cityEvent("bet", { stake: book.stake, profit: net, faction: "casino", factionDelta: allHit ? -2 : 1 }, { silent: true });
      if (allHit && po.legs >= 3) { CBZ.cityEvent && CBZ.cityEvent("activity-payout", { respect: 3 }, { silent: true }); }
      book.result = { legResults, allHit, net, mult: po.mult };
      book.stage = "result";
      renderSportsbook();
    };
  }
  function renderBookResult() {
    const m = modalEl(); modalBtns = {};
    const R = book.result;
    const rows = R.legResults.map((l) => "<div style='display:flex;justify-content:space-between;font-size:12px;padding:3px 0;color:" + (l.hit ? "#7ed957" : "#ff6b6b") + "'><span>" + l.ev + ": " + l.pick + "</span><span>" + (l.hit ? "won" : "won by " + l.winner) + "</span></div>").join("");
    const col = R.net > 0 ? "#7ed957" : "#ff6b6b";
    m.innerHTML = head("Parlay Settled", R.allHit ? "Every leg cashed!" : "Parlay busted.") +
      "<div style='background:rgba(255,255,255,.03);border:1px solid #2a333f;border-radius:10px;padding:10px;margin:6px 0 10px'>" + rows + "</div>" +
      "<div style='font-size:20px;font-weight:800;color:" + col + ";margin-bottom:10px'>" + (R.net > 0 ? "+$" + R.net + " (" + R.mult.toFixed(2) + "x)" : "-$" + (-R.net)) + "</div>" +
      "<div style='display:flex;gap:8px'>" + btn("New parlay", "again", true) + btn("Leave", "leave") + "</div>";
    modalBtns.again = function () { openSportsbook(); };
    modalBtns.leave = function () { book = null; closeModal(); };
  }

  /* =========================================================
     4) STREET RACE  —  a REAL drivable checkpoint race.
        Builds a loop of road checkpoints with in-world beacons,
        spawns rubber-band rivals you can lose to, takes an entry
        fee + optional side bet, and pays out / heats the city on
        finish. If the player is not in a car it offers a fully
        simulated race instead (rivals + bet + payout).
  ========================================================= */
  let raceRun = null, raceBeacons = [];
  CBZ.cityStreetRaceState = function () { return raceRun; };   // probe/debug peek (headless gates)
  function clearRaceBeacons() {
    for (const b of raceBeacons) { if (b.parent) b.parent.remove(b); if (b.geometry) b.geometry.dispose(); if (b.material) b.material.dispose(); }
    raceBeacons = [];
  }
  function makeCheckpointBeacon(x, z, on) {
    const A = CBZ.city && CBZ.city.arena; if (!A || !A.root) return null;
    const mat = new THREE.MeshBasicMaterial({ color: on ? 0xffd166 : 0x4f8bff, transparent: true, opacity: on ? 0.5 : 0.22, side: THREE.DoubleSide, depthWrite: false });
    const m = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 34, 16, 1, true), mat);
    m.position.set(x, 17, z); m.userData.transient = true;
    A.root.add(m);
    return m;
  }
  function buildRaceCourse() {
    const A = CBZ.city && CBZ.city.arena; if (!A) return null;
    const pts = [];
    const P = CBZ.player.pos;
    // Prefer intersections so checkpoints sit on drivable road.
    const inters = (A.intersections || []).slice();
    if (inters.length >= 5) {
      // sort by distance from player, take a spread, then shuffle middle
      inters.sort((a, b) => (Math.hypot(a.x - P.x, a.z - P.z)) - (Math.hypot(b.x - P.x, b.z - P.z)));
      const chosen = [];
      const step = Math.max(1, Math.floor(inters.length / 7));
      for (let i = 2; i < inters.length && chosen.length < 6; i += step) chosen.push(inters[i]);
      for (const c of chosen) pts.push({ x: c.x, z: c.z });
    }
    while (pts.length < 5 && A.randomRoadPoint) { const rp = A.randomRoadPoint(); pts.push({ x: rp.x, z: rp.z }); }
    return pts.length >= 3 ? pts : null;
  }
  function openRaceSetup(def) {
    const driving = !!(CBZ.player && CBZ.player.driving);
    const w = world() || {}; const dr = (w.reputation && w.reputation.driver) || 0;
    const rivalCount = 3;
    // rival base skill; player edge from driver rep
    const setup = { def, driving, bet: 0, entry: def.cost, rivalCount, driverRep: dr };
    raceRun = { setup, stage: "menu" };
    openModal();
    renderRaceMenu();
  }
  function renderRaceMenu() {
    const m = modalEl(); modalBtns = {};
    const s = raceRun.setup;
    const totalCost = s.entry + s.bet;
    const can = bankroll() >= totalCost;
    const winChance = Math.round(clamp(0.34 + s.driverRep * 0.004 + (s.driving ? 0.12 : 0), 0.15, 0.78) * 100);
    m.innerHTML = head("Illegal Street Race", s.driving ? "You're behind the wheel — this is a LIVE checkpoint race." : "On foot — this resolves as a simulated race.") +
      "<div style='font-size:12px;color:#9fb0c6;margin-bottom:8px'>Entry $" + s.entry + " · " + s.rivalCount + " rivals · est. win chance " + winChance + "%" + (s.driving ? "" : " (get in a car for the drivable version)") + "</div>" +
      "<div style='display:flex;gap:6px;align-items:center;margin:6px 0 10px'>" +
      "<span style='font-size:12px;color:#8a93a3'>Side bet on yourself</span>" + btn("-50", "down") +
      "<div style='min-width:64px;text-align:center;font-weight:700;font-size:16px;color:#ffd166'>$" + s.bet + "</div>" + btn("+50", "up") + "</div>" +
      "<div style='font-size:12px;color:#cdd6e3;margin-bottom:10px'>Win the race: prize $" + s.def.reward + (s.bet ? " + bet pays $" + Math.round(s.bet * 2.2) : "") + ". Lose: forfeit entry" + (s.bet ? " + side bet" : "") + ".</div>" +
      "<div style='display:flex;gap:8px'>" + btn(s.driving ? "GREEN LIGHT — drive!" : "Run the race", "go", true, !can) + btn("Back out", "leave") + "</div>" +
      (can ? "" : "<div style='color:#ff6b6b;font-size:12px;margin-top:8px'>Need $" + totalCost + " for entry + bet.</div>");
    modalBtns.up = function () { s.bet = Math.min(5000, s.bet + 50); renderRaceMenu(); };
    modalBtns.down = function () { s.bet = Math.max(0, s.bet - 50); renderRaceMenu(); };
    modalBtns.leave = function () { raceRun = null; closeModal(); note("Backed out of the race.", 1.6); };
    modalBtns.go = function () {
      if (!takeStake(s.entry + s.bet)) { note("Not enough cash.", 1.6); return; }
      if (s.driving) startLiveRace(s);
      else simulateRace(s);
    };
  }
  // ---- REAL RIVALS: road-legal waypoint path threading every checkpoint.
  // CBZ.cityNav.routeTo walks the street grid between legs (its point objects
  // are pooled — copy the values out immediately), so rival cars drive ROADS
  // to the same checkpoints the player does instead of ghosting through blocks.
  function buildRivalPath(course) {
    const path = [];
    const NAV = CBZ.cityNav;
    let sx = CBZ.player.pos.x, sz = CBZ.player.pos.z;
    for (let i = 0; i < course.length; i++) {
      const c = course[i];
      if (NAV && NAV.routeTo) {
        try {
          const legs = NAV.routeTo(sx, sz, c.x, c.z);
          for (const p of legs) path.push({ x: p.x, z: p.z, cp: null });   // COPY — pooled objects
        } catch (e) { /* nav unavailable → straight leg */ }
      }
      // the checkpoint itself (drop routeTo's final goal point — it IS the cp)
      if (path.length && Math.hypot(path[path.length - 1].x - c.x, path[path.length - 1].z - c.z) < 2) path.pop();
      path.push({ x: c.x, z: c.z, cp: i });
      sx = c.x; sz = c.z;
    }
    return path;
  }
  const RIVAL_NAMES = ["Crimson", "Viper", "Ghost", "Nitro"];
  function spawnStreetRivals(s, course) {
    const RD = CBZ.raceDrivers;
    if (!RD || !RD.enabled() || !CBZ.cityMakeCar) return null;
    const path = buildRivalPath(course);
    if (path.length < 2) return null;
    const P = CBZ.player, car = P._vehicle;
    const h = (car && car.heading) || 0;
    const fx = Math.sin(h), fz = Math.cos(h), rx = Math.cos(h), rz = -Math.sin(h);
    const CARS = (CBZ.cityEcon && CBZ.cityEcon.CARS) || [];
    const fast = CARS.filter((c) => (c.value || 0) >= 9000 && /coupe|muscle/.test(c.body || ""));
    const slots = [[3.0, -1], [-3.0, -6], [3.0, -6], [-3.0, -11]];
    const drivers = [];
    for (let i = 0; i < s.rivalCount; i++) {
      const off = slots[i % slots.length];
      const x = P.pos.x + rx * off[0] + fx * off[1];
      const z = P.pos.z + rz * off[0] + fz * off[1];
      const model = fast.length ? fast[(i * 2 + 1) % fast.length] : null;
      const name = RIVAL_NAMES[i] || "Rival " + (i + 1);
      const number = 11 * (i + 1);
      const m = RD.spawn({
        x: x, z: z, heading: h, model: model,
        livery: { number: number, scheme: CBZ.cityRaceSchemeFor ? CBZ.cityRaceSchemeFor(name) : null },
        name: name, number: number,
        skill: 0.68 + i * 0.07 + Math.min(0.12, s.driverRep * 0.001),
        aggr: 0.55 + i * 0.1, consistency: 0.55 + i * 0.08,
        tag: "street", mode: "path",
        path: path.map((p) => ({ x: p.x, z: p.z, cp: p.cp })),   // own copy per driver
        cpTotal: course.length,
      });
      if (m) { m.state = "race"; drivers.push(m); }
    }
    return drivers.length ? drivers : null;
  }
  // player street-race progress in course units (cp passed + a smooth fraction)
  function playerStreetProgress(r) {
    let frac = 0;
    const c = r.course[Math.min(r.cp, r.course.length - 1)];
    if (c) {
      const d = Math.hypot(CBZ.player.pos.x - c.x, CBZ.player.pos.z - c.z);
      frac = Math.max(0, Math.min(0.95, 1 - d / 40));
    }
    return (r.cp + frac) / r.course.length;
  }

  function startLiveRace(s) {
    const course = buildRaceCourse();
    if (!course) { note("No room for a course — running it simulated.", 2); simulateRace(s); return; }
    closeModal();
    clearRaceBeacons();
    // REAL rivals when the driver brain is loaded; virtual progress ghosts as
    // the one-line-revert fallback (CBZ.CONFIG.RACE_REAL_DRIVERS = false).
    const rivalDrivers = spawnStreetRivals(s, course);
    const rivals = [];
    if (!rivalDrivers) {
      for (let i = 0; i < s.rivalCount; i++) rivals.push({ name: RIVAL_NAMES[i] || "Rival", prog: 0, skill: 0.9 + Math.random() * 0.35 });
    }
    raceRun = {
      setup: s, stage: "live", course, cp: 0, rivals, rivalDrivers,
      t: 0, limit: 18 + course.length * 8, startPos: { x: CBZ.player.pos.x, z: CBZ.player.pos.z },
      playerProg: 0, totalLen: course.length,
    };
    // one scorer for positions/gaps (same kit the speedway uses)
    if (rivalDrivers && CBZ.raceKit) {
      const RD = CBZ.raceDrivers;
      const entrants = rivalDrivers.map(function (m) {
        return {
          id: "r" + m.number, name: m.name, number: m.number, color: m.car && m.car.model ? m.car.model.color : null,
          driver: m,
          progress: function () { return RD.progressOf(m); },
          speed: function () { return Math.abs((m.car && m.car.v) || 0); },
        };
      });
      entrants.push({
        id: "you", name: "YOU", isPlayer: true,
        progress: function () { return raceRun ? playerStreetProgress(raceRun) : 0; },
        speed: function () { const c = CBZ.player && CBZ.player._vehicle; return Math.abs((c && c.v) || 0); },
      });
      // trackLen ≈ course span so progress gaps convert to honest seconds
      let L = 0;
      for (let i = 1; i < course.length; i++) L += Math.hypot(course[i].x - course[i - 1].x, course[i].z - course[i - 1].z);
      raceRun.kit = CBZ.raceKit.create({ laps: 1, trackLen: Math.max(120, L), entrants: entrants });
      if (CBZ.raceHud) { CBZ.raceHud.show(); }
    }
    // place first two beacons
    refreshBeacons();
    note("RACE ON — hit the gold checkpoints! " + course.length + " to go." + (rivalDrivers ? " " + rivalDrivers.length + " rivals on the road." : ""), 2.6);
    big("3.. 2.. 1.. GO!");
    if (CBZ.sfx) CBZ.sfx("siren");
  }
  function refreshBeacons() {
    clearRaceBeacons();
    const r = raceRun; if (!r || !r.course) return;
    for (let i = r.cp; i < Math.min(r.cp + 2, r.course.length); i++) {
      const c = r.course[i];
      const b = makeCheckpointBeacon(c.x, c.z, i === r.cp);
      if (b) raceBeacons.push(b);
    }
  }
  function endLiveRace(won, crashed) {
    const r = raceRun, s = r.setup;
    clearRaceBeacons();
    // pack up the rival field + the race HUD, and post the results board
    if (r.rivalDrivers) {
      if (r.kit && CBZ.raceHud) {
        r.kit.update(0);
        let order = r.kit.order.slice();
        const pRow = r.kit.playerRow();
        if (!won && pRow) { order = order.filter((e) => e !== pRow); order.push(pRow); }
        else if (won && pRow) { order = order.filter((e) => e !== pRow); order.unshift(pRow); }
        const rows = order.map(function (e, i) {
          return {
            pos: i + 1, name: e.name, number: e.number, color: e.color,
            time: e === pRow ? "" : (Math.round(e.total * 100) + "% of course"),
            pts: null, purse: (e === pRow && won) ? s.def.reward : 0, you: e === pRow,
            dnf: !!(e.driver && (e.driver.dnf || (e.driver.car && e.driver.car.dead))),
          };
        });
        CBZ.raceHud.hide();
        CBZ.raceHud.results(rows, {
          title: won ? "STREET RACE — YOU WIN" : "STREET RACE — BEATEN",
          sub: r.course.length + " checkpoints · illegal",
          foot: won ? "Prize $" + s.def.reward + (s.bet ? " + side bet $" + Math.round(s.bet * 2.2) : "") + " · Esc closes" : "Entry forfeited · Esc closes",
        });
      } else if (CBZ.raceHud) CBZ.raceHud.hide();
      if (CBZ.raceDrivers) CBZ.raceDrivers.despawnAll("street");
    } else if (CBZ.raceHud) CBZ.raceHud.hide();
    let net = 0;
    if (won) {
      payout(s.def.reward);
      net += s.def.reward;
      if (s.bet) { const bp = Math.round(s.bet * 2.2); payout(bp); net += bp - s.bet; }
    } else {
      net -= s.entry + s.bet; // already spent
    }
    CBZ.cityEvent && CBZ.cityEvent("race-finish", {
      race: "street", win: won, illegal: true, profit: won ? net : -(s.entry + s.bet),
      driver: won ? 5 : 1, respect: won ? 6 : 1,
      panic: crashed ? 5 : 2, damage: crashed ? 5 : 0.5,
      crimeHeat: crashed ? 80 : 45, crimeType: "illegal-racing",
      message: won ? "STREET RACE WON!" : (crashed ? "Wrecked out of the race." : "Lost the street race."),
    });
    if (s.bet) CBZ.cityEvent && CBZ.cityEvent("bet", { stake: s.bet, profit: won ? Math.round(s.bet * 2.2) - s.bet : -s.bet, faction: "gang", factionDelta: won ? 1 : -1 }, { silent: true });
    if (won) { big("STREET RACE WON +$" + net); }   // (no jingle — user: no music in gang city)
    raceRun = null;
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  function simulateRace(s) {
    closeModal();
    // virtual race: roll player vs rivals; rep + RNG decide.
    const base = clamp(0.34 + s.driverRep * 0.004, 0.15, 0.6);
    const playerScore = base * (0.8 + Math.random() * 0.6);
    let beat = 0;
    for (let i = 0; i < s.rivalCount; i++) { const rv = (0.4 + Math.random() * 0.55); if (playerScore > rv) beat++; }
    const won = beat >= s.rivalCount; // must beat all rivals to take 1st
    const crashed = Math.random() < (won ? 0.16 : 0.4);
    if (crashed) crashNearPlayer(won ? 10 : 18);
    let net = 0;
    if (won) { payout(s.def.reward); net += s.def.reward; if (s.bet) { const bp = Math.round(s.bet * 2.2); payout(bp); net += bp - s.bet; } }
    else net -= s.entry + s.bet;
    CBZ.cityEvent && CBZ.cityEvent("race-finish", {
      race: "street", win: won, illegal: true, profit: won ? net : -(s.entry + s.bet),
      driver: won ? 4 : 1, respect: won ? 4 : 1,
      panic: crashed ? 5 : 2, damage: crashed ? 5 : 0.5, crimeHeat: crashed ? 70 : 35, crimeType: "illegal-racing",
      message: won ? ("Won the street race (P" + 1 + ")!") : ("Finished P" + (s.rivalCount + 1 - beat) + " in the street race."),
    });
    if (s.bet) CBZ.cityEvent && CBZ.cityEvent("bet", { stake: s.bet, profit: won ? Math.round(s.bet * 2.2) - s.bet : -s.bet, faction: "gang", factionDelta: won ? 1 : -1 }, { silent: true });
    if (won) { big("STREET RACE WON +$" + net); }   // (no jingle — user: no music in gang city)
    raceRun = null;
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  addEventListener("keydown", function (e) {
    if (e.repeat || g.mode !== "city" || g.state !== "playing") return;
    const k = (e.key || "").toLowerCase();
    if (k === "y" && !CBZ.cityMenuOpen) {
      e.preventDefault();
      if (raceRun && raceRun.stage === "live") { note("Finish the race first!", 1.4); return; }
      show();
    } else if (k === "escape") {
      if (modal && modal.style.display === "block") { e.preventDefault();
        if (raceRun && raceRun.stage === "live") return; // can't escape a live race via modal
        if (fight) { fight = null; closeModal(); return; }
        if (casino) { casinoCashout(); return; }
        if (book) { book = null; closeModal(); return; }
        if (raceRun) { raceRun = null; closeModal(); return; }
        closeModal(); return;
      }
      if (panel && panel.style.display === "block") { e.preventDefault(); hide(); }
    }
  });

  CBZ.onUpdate(38.6, function (dt) {
    if (g.mode !== "city") return;

    // ---- live drivable street race ----
    if (raceRun && raceRun.stage === "live") {
      const r = raceRun, P = CBZ.player.pos;
      r.t += dt;
      // abort if player leaves the car
      if (!CBZ.player.driving) {
        note("You left the car — race forfeited.", 2.2);
        endLiveRace(false, false);
      } else {
        // checkpoint hit test
        const c = r.course[r.cp];
        if (c && Math.hypot(P.x - c.x, P.z - c.z) < 6.5) {
          r.cp++;
          if (CBZ.sfx) CBZ.sfx("coin");
          if (r.cp >= r.course.length) {
            // player finished — did rivals beat them?
            const lead = r.rivalDrivers
              ? r.rivalDrivers.every((m) => !m.finished)
              : r.rivals.every((rv) => rv.prog < 0.985);
            endLiveRace(lead, false);
          } else {
            note("Checkpoint " + r.cp + "/" + r.course.length + "!", 1.2);
            refreshBeacons();
          }
        }
        // ---- rivals ----
        if (raceRun && r.rivalDrivers) {
          // REAL cars on the road: their brains drive; we just read the scoreboard.
          if (r.kit) {
            r.kit.update(dt);
            const ctx = r.kit.playerContext();
            if (ctx && CBZ.raceHud) {
              CBZ.raceHud.update({
                pos: ctx.row.pos, count: r.kit.entrants.length,
                lap: r.cp, laps: r.course.length,
                lapT: r.kit.time, best: 0,
                gapA: ctx.ahead ? { name: ctx.ahead.name, s: ctx.gapA } : null,
                gapB: ctx.behind ? { name: ctx.behind.name, s: ctx.gapB } : null,
              });
            }
          }
          for (const m of r.rivalDrivers) {
            if (m.finished) {
              note(m.name + " took the checkered flag. You lost.", 2.4);
              endLiveRace(false, false);
              break;
            }
          }
        } else if (raceRun) {
          // fallback: virtual progress racers with rubber-band catch-up
          const pProg = r.cp / r.course.length;
          for (const rv of r.rivals) {
            const behind = pProg - rv.prog;
            const rubber = 1 + clamp(behind * 1.6, -0.25, 0.6); // catch up when behind, ease when ahead
            rv.prog = Math.min(1, rv.prog + dt * 0.052 * rv.skill * rubber);
            if (rv.prog >= 1) { // a rival won
              note(rv.name + " took the checkered flag. You lost.", 2.4);
              endLiveRace(false, false);
              break;
            }
          }
        }
        // time limit
        if (raceRun && r.t > r.limit) { note("Too slow — race over.", 2.2); endLiveRace(false, false); }
      }
    }

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
