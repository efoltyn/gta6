/* ============================================================
   city/worldstate.js - persistent city truth + event bus.

   The city is the hub, so world consequences live here instead of inside
   one-off minigame screens. Activities and existing systems emit compact
   events; this ledger records the durable results and mirrors the live
   cash/bank/inventory fields back into CBZ.game.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;
  const STORE_KEY = "CBZ_CITY_WORLD_V2";
  const LOG_MAX = 24;
  let saveT = 0;
  const lastEmit = {};

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function copy(obj) { return JSON.parse(JSON.stringify(obj || {})); }
  function now() { return Date.now ? Date.now() : 0; }

  function blankRecord() { return { starts: 0, wins: 0, losses: 0, profit: 0 }; }

  function fresh() {
    const factions = {
      police: 0, transit: 0, casino: 0, political: 0, military: 0,
      extremists: -20, security: 0, public: 0,
    };
    for (const gang of (CBZ.CITY && CBZ.CITY.gangs) || []) factions[gang.id] = 0;
    return {
      version: 2,
      cash: ((CBZ.CITY && CBZ.CITY.econ && CBZ.CITY.econ.startCash) || 30),
      bank: 0,
      debt: 0,
      respect: 0,
      inventory: {},
      weapon: null,               // legacy single city-name save
      weapons: [],                // shared engine weapon ids
      currentWeapon: null,
      meleeWeapon: null,
      assets: { properties: [], businesses: [], vehicles: [], weapons: [] },
      injuries: 0,
      criminalRecord: { wantedPeak: 0, heatPeak: 0, arrests: 0, charges: [] },
      jailHistory: { busts: 0, escapes: 0, visits: 0 },
      reputation: { driver: 0, fighter: 0, paintball: 0, hitman: 0, political: 0, gang: 0 },
      records: {
        races: { legal: blankRecord(), street: blankRecord(), drag: blankRecord(), horse: blankRecord(), greyhound: blankRecord() },
        fights: { boxing: blankRecord(), mma: blankRecord(), street: blankRecord() },
        betting: { wins: 0, losses: 0, profit: 0, staked: 0 },
        casino: { wins: 0, losses: 0, profit: 0, vip: 0 },
        hitman: { contracts: 0, completed: 0, failed: 0, highValue: 0, heat: 0 },
      },
      transport: { pass: false, rides: 0, fares: 0, delays: 0, access: 0 },
      world: { panic: 0, damage: 0, fires: 0, floods: 0, emergency: 0, destroyed: 0 },
      economy: { confidence: 100, laundering: 0, repairDebt: 0, taxes: 0, insurance: 0 },
      politics: { support: 0, corruption: 0, scandal: 0, emergencyPowers: 0, official: "Mayor Rosa Vale" },
      factions,
      activityLog: [],
      lastSaved: now(),
    };
  }

  function load() {
    try {
      if (!window.localStorage) return null;
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && parsed.version === 2 ? parsed : null;
    } catch (e) { return null; }
  }

  function save(w) {
    if (!w) return;
    w.lastSaved = now();
    try {
      if (window.localStorage) localStorage.setItem(STORE_KEY, JSON.stringify(w));
    } catch (e) {}
  }

  function ensure() {
    if (!g.cityWorld || g.cityWorld.version !== 2) g.cityWorld = load() || fresh();
    return g.cityWorld;
  }
  CBZ.cityWorldEnsure = ensure;

  function commit() {
    const w = ensure();
    w.cash = g.cash || 0;
    w.bank = g.cityBank || 0;
    w.debt = g.cityDebt || w.debt || 0;
    w.respect = g.respect || 0;
    w.inventory = copy(g.cityInv || {});
    const stowed = g._copStow;
    w.weapons = (stowed && stowed.inv ? stowed.inv : (CBZ.weaponInventory || [])).slice();
    w.currentWeapon = (stowed && stowed.cur) || CBZ.currentWeaponId || null;
    w.meleeWeapon = g.cityMeleeWeapon || null;
    w.weapon = (CBZ.cityCurrentWeaponName && CBZ.cityCurrentWeaponName()) || w.meleeWeapon || null;
    w.criminalRecord.wantedPeak = Math.max(w.criminalRecord.wantedPeak || 0, g.wanted || 0);
    w.criminalRecord.heatPeak = Math.max(w.criminalRecord.heatPeak || 0, g.heat || 0);
    save(w);
    return w;
  }
  CBZ.cityWorldCommit = commit;

  function applyToGame() {
    const w = ensure();
    const restoreWeapon = w.weapon || null;
    g.cash = w.cash || 0;
    g.cityBank = w.bank || 0;
    g.cityDebt = w.debt || 0;
    g.respect = w.respect || 0;
    g.cityInv = copy(w.inventory || {});
    g.cityMeleeWeapon = w.meleeWeapon || null;
    g.cityTransport = w.transport;
    g.cityPolitics = w.politics;
    g.cityFactions = w.factions;
    const weapons = Array.isArray(w.weapons) ? w.weapons : [];
    if (weapons.length && CBZ.unlockWeapon) {
      for (let i = 0; i < weapons.length; i++) CBZ.unlockWeapon(weapons[i], { select: false });
      if (w.currentWeapon && CBZ.setCurrentWeapon) CBZ.setCurrentWeapon(w.currentWeapon);
    } else if (restoreWeapon && CBZ.cityGiveWeapon) {
      CBZ.cityGiveWeapon(restoreWeapon);     // migrate legacy single-name saves
    }
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return w;
  }
  CBZ.cityWorldBeginRun = applyToGame;

  CBZ.cityWorldReset = function () {
    g.cityWorld = fresh();
    applyToGame();
    commit();
  };

  // ---- shared collectors: the multiplayer persistence client (src/net/
  //      netpersist.js) composes/applies the SAME ledger truth the local
  //      save uses — one collector, two destinations (localStorage / server).
  CBZ.cityWorldCollect = function () { return commit(); };
  CBZ.cityWorldAdopt = function (w) {
    if (!w || w.version !== 2) return false;
    g.cityWorld = w;
    applyToGame();
    save(w);
    return true;
  };

  function addLog(w, type, label) {
    w.activityLog.unshift({ type, label, t: now() });
    if (w.activityLog.length > LOG_MAX) w.activityLog.length = LOG_MAX;
  }

  function addRecord(rec, win, profit) {
    rec.starts++;
    if (win) rec.wins++; else rec.losses++;
    rec.profit += profit || 0;
  }

  function addFaction(w, key, n) {
    if (!key || !n) return;
    if (w.factions[key] == null) w.factions[key] = 0;
    w.factions[key] = clamp(w.factions[key] + n, -100, 100);
  }

  function cashDelta(n) {
    if (!n) return;
    if (g.mode === "city" && CBZ.city && CBZ.city.addCash) CBZ.city.addCash(n);
    else g.cash = Math.max(0, (g.cash || 0) + n);
  }

  function applyCommon(w, type, data, opts) {
    data = data || {}; opts = opts || {};
    if (data.cash) cashDelta(data.cash);
    if (data.bank) { g.cityBank = Math.max(0, (g.cityBank || 0) + data.bank); w.bank = g.cityBank; }
    if (data.debt) { w.debt = Math.max(0, (w.debt || 0) + data.debt); g.cityDebt = w.debt; }
    if (data.respect && CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(data.respect);
    if (data.panic) w.world.panic = clamp((w.world.panic || 0) + data.panic, 0, 100);
    if (data.damage) w.world.damage = Math.max(0, (w.world.damage || 0) + data.damage);
    if (data.fire) w.world.fires = Math.max(0, (w.world.fires || 0) + data.fire);
    if (data.flood) w.world.floods = Math.max(0, (w.world.floods || 0) + data.flood);
    if (data.emergency) w.world.emergency = clamp((w.world.emergency || 0) + data.emergency, 0, 100);
    if (data.confidence) w.economy.confidence = clamp((w.economy.confidence || 100) + data.confidence, 0, 100);
    if (data.repairDebt) w.economy.repairDebt = Math.max(0, (w.economy.repairDebt || 0) + data.repairDebt);
    if (data.political) w.reputation.political = clamp((w.reputation.political || 0) + data.political, -100, 100);
    if (data.hitman) w.reputation.hitman = clamp((w.reputation.hitman || 0) + data.hitman, -100, 100);
    if (data.driver) w.reputation.driver = clamp((w.reputation.driver || 0) + data.driver, -100, 100);
    if (data.fighter) w.reputation.fighter = clamp((w.reputation.fighter || 0) + data.fighter, -100, 100);
    if (data.faction) addFaction(w, data.faction, data.factionDelta || 0);
    if (data.factions) for (const k in data.factions) addFaction(w, k, data.factions[k]);
    if (data.crimeHeat && !opts.noWanted && g.mode === "city" && CBZ.cityCrime) {
      CBZ.cityCrime(data.crimeHeat, { instant: !!data.instant, x: data.x, z: data.z, type: data.crimeType || type });
    }
  }

  CBZ.cityEvent = function (type, data, opts) {
    const w = ensure();
    data = data || {}; opts = opts || {};
    const t = CBZ.now || 0;
    if (opts.throttle && lastEmit[type] && t - lastEmit[type] < opts.throttle) return w;
    lastEmit[type] = t;

    applyCommon(w, type, data, opts);

    if (type === "race-finish") {
      const kind = data.race || "street";
      addRecord(w.records.races[kind] || (w.records.races[kind] = blankRecord()), !!data.win, data.profit || 0);
      if (data.illegal) w.criminalRecord.charges.unshift("illegal racing");
      addLog(w, type, (data.win ? "Won " : "Lost ") + kind + " race");
    } else if (type === "fight-result") {
      const kind = data.fight || "boxing";
      addRecord(w.records.fights[kind] || (w.records.fights[kind] = blankRecord()), !!data.win, data.profit || 0);
      addLog(w, type, (data.win ? "Won " : "Lost ") + kind + " fight");
    } else if (type === "bet") {
      w.records.betting.staked += data.stake || 0;
      w.records.betting.profit += data.profit || 0;
      if ((data.profit || 0) >= 0) w.records.betting.wins++; else w.records.betting.losses++;
      addLog(w, type, (data.profit || 0) >= 0 ? "Bet won" : "Bet lost");
    } else if (type === "casino") {
      w.records.casino.profit += data.profit || 0;
      if ((data.profit || 0) >= 0) w.records.casino.wins++; else w.records.casino.losses++;
      w.records.casino.vip = Math.max(w.records.casino.vip || 0, Math.floor(Math.abs(w.records.casino.profit) / 1000));
      addLog(w, type, (data.profit || 0) >= 0 ? "Casino win" : "Casino loss");
    } else if (type === "transport") {
      w.transport.rides++; w.transport.fares += data.fare || 0; w.transport.access = Math.min(100, (w.transport.access || 0) + 3);
      if (data.pass) w.transport.pass = true;
      addLog(w, type, data.label || "Used public transport");
    } else if (type === "transport-delay") {
      w.transport.delays = Math.max(0, (w.transport.delays || 0) + (data.delay || 1));
      addLog(w, type, "Transit delay");
    } else if (type === "hitman-contract") {
      w.records.hitman.contracts++;
      if (data.highValue) w.records.hitman.highValue++;
      addLog(w, type, data.label || "Contract accepted");
    } else if (type === "hitman-complete" || type === "assassination") {
      w.records.hitman.completed++;
      w.records.hitman.heat += data.heat || 0;
      if (type === "assassination") {
        w.politics.scandal = clamp((w.politics.scandal || 0) + 18, 0, 100);
        w.politics.emergencyPowers = clamp((w.politics.emergencyPowers || 0) + 10, 0, 100);
      }
      addLog(w, type, data.label || "Contract completed");
    } else if (type === "politics") {
      w.politics.support = clamp((w.politics.support || 0) + (data.support || 0), -100, 100);
      w.politics.corruption = clamp((w.politics.corruption || 0) + (data.corruption || 0), 0, 100);
      w.politics.scandal = clamp((w.politics.scandal || 0) + (data.scandal || 0), 0, 100);
      addLog(w, type, data.label || "Political move");
    } else if (type === "counterterror" || type === "terror-threat") {
      addFaction(w, "extremists", type === "counterterror" ? -8 : 8);
      addFaction(w, "police", type === "counterterror" ? 5 : -3);
      w.politics.emergencyPowers = clamp((w.politics.emergencyPowers || 0) + (type === "terror-threat" ? 8 : 2), 0, 100);
      addLog(w, type, type === "counterterror" ? "Counterterror response" : "Extremist threat");
    } else if (type === "war" || type === "explosion" || type === "disaster") {
      w.world.emergency = clamp((w.world.emergency || 0) + 12, 0, 100);
      w.economy.confidence = clamp((w.economy.confidence || 100) - 5, 0, 100);
      addLog(w, type, data.label || "City emergency");
    } else if (type === "crime") {
      if (data.crime) w.criminalRecord.charges.unshift(data.crime);
      if (w.criminalRecord.charges.length > 20) w.criminalRecord.charges.length = 20;
    } else if (type === "crime-reported") {
      w.criminalRecord.wantedPeak = Math.max(w.criminalRecord.wantedPeak || 0, data.wantedPeak || g.wanted || 0);
      w.criminalRecord.heatPeak = Math.max(w.criminalRecord.heatPeak || 0, g.heat || data.severity || 0);
    } else if (type === "arrest") {
      w.criminalRecord.arrests++;
      w.jailHistory.busts++;
      addFaction(w, "police", data.peaceful ? 1 : -3);
      addLog(w, type, "Arrested and sent to jail");
    } else if (type === "jail-escape") {
      w.jailHistory.escapes++;
      addFaction(w, "police", -5);
      addLog(w, type, "Escaped jail");
    } else if (type === "crash" || type === "bullet-impact") {
      if (data.damage) w.economy.repairDebt = Math.max(0, (w.economy.repairDebt || 0) + Math.round(data.damage * 8));
    }

    w.cash = g.cash || w.cash || 0;
    w.bank = g.cityBank || w.bank || 0;
    w.debt = g.cityDebt || w.debt || 0;
    w.respect = g.respect || w.respect || 0;
    if (!opts.silent && CBZ.city && CBZ.city.note && data.message) CBZ.city.note(data.message, 2.2);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    save(w);
    return w;
  };

  CBZ.cityWorldSummary = function () {
    const w = ensure();
    // Only surface ACTIONABLE state on the always-on HUD — debt you owe. The raw
    // panic/emergency/transit/scandal meters were HUD clutter (panic lingers maxed
    // for minutes); they live in the world/politics screens, not the corner readout.
    if ((w.debt || 0) > 0) return "debt $" + Math.round(w.debt);
    return "";
  };

  CBZ.onUpdate(32.4, function (dt) {
    if (g.mode !== "city") return;
    const w = ensure();
    w.world.panic = Math.max(0, (w.world.panic || 0) - dt * 0.18);
    w.world.emergency = Math.max(0, (w.world.emergency || 0) - dt * 0.05);
    w.transport.delays = Math.max(0, (w.transport.delays || 0) - dt * 0.03);
    w.economy.confidence = clamp((w.economy.confidence || 100) + dt * 0.02, 0, 100);
    saveT += dt;
    if (saveT > 5) { saveT = 0; commit(); }
  });
})();
