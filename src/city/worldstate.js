/* ============================================================
   city/worldstate.js - persistent city truth + event bus.

   The city is the hub, so world consequences live here instead of inside
   one-off minigame screens. Activities and existing systems emit compact
   events; this ledger records the durable results and mirrors the live
   cash/bank/inventory fields back into CBZ.game.

   Also round-trips CBZ.cityIdentities (city/identity.js's permanent-death
   registry) through this SAME CBZ_CITY_WORLD_V2 localStorage record, so a
   singleplayer reload respects a killed racer/gang boss/VIP/tycoon exactly
   like the MP host path (net/netpersist.js) already does — commit() mirrors
   the live registry out, applyToGame() rebuilds it on load.
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
      // ---- financial obligations + equipped-slot bookkeeping that must survive
      //      a localStorage reload AND an MP rejoin. bank.js (g.cityLoans) and
      //      pawnshop.js (g.cityPawnTickets) ALSO stamp/hydrate these through the
      //      same collector via their own save-wrap shims; seeding + round-tripping
      //      them HERE too makes worldstate.js self-sufficient (defense in depth):
      //      the borrowed cash already rides g.cash and the pawned item already
      //      left g.cityInv, so dropping the debt/ticket on reload = free money /
      //      an annihilated owned asset. cityOutfit = economy.js's SLOT→worn map,
      //      cityFenceRep = the resale-loyalty bonus; neither was persisted before.
      cityLoans: [],
      cityPawnTickets: [],
      cityOutfit: {},
      cityFenceRep: 0,
      // ---- per-character state that used to BLEED across the three-
      //      protagonist vault (origins.js) because it lived only on
      //      CBZ.game and was never carried by this ledger: wardrobe
      //      (g.cityFit/g.cityWornOutfit — actually persisted by outfits.js's
      //      own commit/collect wrap + hydrateFitFromLedger(), the
      //      established "stamp before commit" pattern in this file — see
      //      outfits.js), the property ladder (home/rent/garage/penthouse/
      //      heli/hangar — persisted here, RESTORED by realestate.js's
      //      cityRealEstateReset() because mode.js's reset() calls that
      //      AFTER cityWorldBeginRun and unconditionally wipes these fields
      //      for "a fresh run" — restoring in applyToGame() alone would just
      //      get clobbered a few lines later in mode.js), and gang state
      //      (playerGang/cityMembership/playerGangId — restored by a lazy
      //      wrap around CBZ.cityPlayerGangReset(), since that call — via
      //      cityCareersReset() — runs even later in the same reset() and
      //      also nulls everything unconditionally).
      cityHome: null,            // {tier,id,name,doorX,doorZ} — see realestate.js cityHomeSerialize/Restore
      cityRentTier: null,
      cityGarage: [],
      cityOwnsPenthouse: false,
      cityOwnsHeli: false,
      cityOwnsHangar: false,
      playerGang: null,           // safe subset only: {id,name,color,founded,order} — never live ped refs
      cityMembership: null,       // {gangId,rank,standing,bodies,contrib,loyalty,how} — plain data, safe whole
      playerGangId: null,
      assets: { properties: [], businesses: [], vehicles: [], weapons: [] },
      injuries: 0,
      criminalRecord: { wantedPeak: 0, heatPeak: 0, arrests: 0, escapes: 0, charges: [] },
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
      // permanent-identity registry mirror (CBZ.cityIdentities) — killed
      // racers/gang bosses/VIPs/tycoons must stay dead across a singleplayer
      // reload too, not just the MP host path (netpersist.js). null until the
      // registry has minted at least one identity; commit()/applyToGame()
      // round-trip it the same way netpersist.js's worldBlob/applyWorld do.
      identities: null,
      lastSaved: now(),
    };
  }

  // S5 (BUILD-PLAN.md Stage S): sqlite-wasm single-player parity. src/net/
  // sqlitedb.js is loaded AFTER this file and inits itself lazily/async
  // (feature-detected, never blocking boot) — CBZ.sqlitedb only ever
  // exists as a fully-formed object once its own script has parsed, and
  // its backend only comes up some time after that, so every touch below
  // is a runtime check, never a parse-time dependency. Until it's ready,
  // load()/save() are BYTE-IDENTICAL to before this wave — that's the
  // "bulletproof fallback" requirement: no wasm, no Worker, or a file://
  // page all resolve to CBZ.sqlitedb being absent/inert and this file
  // behaving exactly as it always has.
  function load() {
    try {
      if (CBZ.sqlitedb && CBZ.sqlitedb.isAvailable && CBZ.sqlitedb.isAvailable()) {
        const cached = CBZ.sqlitedb.cachedWorld();
        if (cached && cached.version === 2) return cached;
      }
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
    let json = null;
    try { json = JSON.stringify(w); } catch (e) { return; }
    // sqlite becomes the size-uncapped primary the moment its backend is
    // ready (fire-and-forget — saveWorld() never throws); localStorage
    // keeps riding as a safety mirror UNLESS the blob has grown past what
    // it can hold, which is exactly the scenario sqlite exists to fix —
    // a write that would throw QuotaExceededError is logged once (not on
    // every 5s autosave tick) and skipped instead of crashing the save path.
    const sqlite = CBZ.sqlitedb;
    const usingSqlite = !!(sqlite && sqlite.saveWorld && sqlite.saveWorld(w, json));
    try {
      if (window.localStorage) localStorage.setItem(STORE_KEY, json);
    } catch (e) {
      if (usingSqlite && sqlite.warnMirrorSkipOnce) sqlite.warnMirrorSkipOnce(e);
    }
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
    // financial obligations + worn-slot bookkeeping (bank.js/pawnshop.js also
    // stamp the first two via their own collector wraps — same runtime arrays,
    // so this write is idempotent and keeps worldstate.js self-contained).
    w.cityLoans = copy(g.cityLoans || []);
    w.cityPawnTickets = copy(g.cityPawnTickets || []);
    w.cityOutfit = copy(g.cityOutfit || {});
    w.cityFenceRep = g.cityFenceRep || 0;
    // ---- property ladder (LEDGER GAP fix — see fresh()'s comment). cityHome
    // holds a LIVE lot reference (buildings/meshes) that must never be
    // JSON.stringify'd directly — realestate.js's cityHomeSerialize() gives us
    // back a small plain descriptor {tier,id,name,doorX,doorZ} instead.
    w.cityHome = (CBZ.cityHomeSerialize && CBZ.cityHomeSerialize()) || null;
    w.cityRentTier = (g.cityRentTier != null) ? g.cityRentTier : null;
    w.cityGarage = Array.isArray(g.cityGarage) ? g.cityGarage.slice() : [];
    w.cityOwnsPenthouse = !!g.cityOwnsPenthouse;
    w.cityOwnsHeli = !!g.cityOwnsHeli;
    w.cityOwnsHangar = !!g.cityOwnsHangar;
    // wire the dead assets.vehicles field to the real garage list (defect: it
    // used to sit empty forever — nothing wrote to it).
    w.assets = w.assets || { properties: [], businesses: [], vehicles: [], weapons: [] };
    w.assets.vehicles = w.cityGarage.slice();
    // ---- gang state. g.playerGang carries LIVE ped refs (members/boss/turf)
    // that are NOT JSON-safe (circular THREE refs would throw inside copy()
    // and abort the whole save) — snapshot only the safe identity subset.
    // g.cityMembership (patched into an NPC gang) is already plain data.
    w.playerGang = g.playerGang
      ? { id: g.playerGang.id, name: g.playerGang.name, color: g.playerGang.color,
          founded: !!g.playerGang.founded, order: g.playerGang.order || "follow" }
      : null;
    w.cityMembership = g.cityMembership ? copy(g.cityMembership) : null;
    w.playerGangId = g.playerGangId || null;
    const stowed = g._copStow;
    w.weapons = (stowed && stowed.inv ? stowed.inv : (CBZ.weaponInventory || [])).slice();
    w.currentWeapon = (stowed && stowed.cur) || CBZ.currentWeaponId || null;
    w.meleeWeapon = g.cityMeleeWeapon || null;
    w.weapon = (CBZ.cityCurrentWeaponName && CBZ.cityCurrentWeaponName()) || w.meleeWeapon || null;
    w.criminalRecord.wantedPeak = Math.max(w.criminalRecord.wantedPeak || 0, g.wanted || 0);
    w.criminalRecord.heatPeak = Math.max(w.criminalRecord.heatPeak || 0, g.heat || 0);
    if (CBZ.cityIdentities && CBZ.cityIdentities.serialize) try { w.identities = CBZ.cityIdentities.serialize(); } catch (e) {}
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
    // restore loans/tickets/worn-outfit/fence-rep on reload (cityWorldBeginRun)
    // AND MP rejoin (cityWorldAdopt) — both funnel through here. bank.js /
    // pawnshop.js ALSO rehydrate g.cityLoans / g.cityPawnTickets off a g.cityWorld
    // reference change, but doing it here removes the dependency on those modules
    // being loaded + their once-per-ledger guard firing (same restored data, so
    // the later sibling hydrate is a harmless idempotent re-copy).
    g.cityLoans = copy(w.cityLoans || []);
    g.cityPawnTickets = copy(w.cityPawnTickets || []);
    g.cityOutfit = copy(w.cityOutfit || {});
    g.cityFenceRep = w.cityFenceRep || 0;
    g.cityMeleeWeapon = w.meleeWeapon || null;
    // ---- property ladder + gang identity (LEDGER GAP fix). Restoring these
    // here covers the MP-adopt path and any future caller of applyToGame()
    // directly; the NORMAL single-player run path additionally relies on
    // realestate.js's cityRealEstateReset() and the cityPlayerGangReset()
    // wrap below re-reading g.cityWorld — mode.js's reset() calls those
    // AFTER cityWorldBeginRun (this function) and unconditionally zeroes
    // these same fields for "a fresh run", so setting them here ALONE would
    // get silently clobbered a few lines later. Both restore paths read the
    // SAME w object, so they always agree.
    g.cityRentTier = (w.cityRentTier != null) ? w.cityRentTier : null;
    g.cityGarage = Array.isArray(w.cityGarage) ? w.cityGarage.slice() : [];
    g.cityOwnsPenthouse = !!w.cityOwnsPenthouse;
    g.cityOwnsHeli = !!w.cityOwnsHeli;
    g.cityOwnsHangar = !!w.cityOwnsHangar;
    if (w.cityHome && CBZ.cityHomeRestore) { try { CBZ.cityHomeRestore(w.cityHome); } catch (e) {} }
    g.playerGang = w.playerGang ? copy(w.playerGang) : null;
    g.cityMembership = w.cityMembership ? copy(w.cityMembership) : null;
    g.playerGangId = w.playerGangId || null;
    // wardrobe (cityFit/cityWornOutfit) + a body/portrait redress: outfits.js
    // owns this state's shape (composite items, painted specials, drip) —
    // delegate the actual restore + redraw to it so there's one source of
    // truth. Synchronous (not "next tick") so a freshly-loaded corner
    // portrait never flashes the default white-tee before catching up.
    if (CBZ.cityWardrobeHydrate) { try { CBZ.cityWardrobeHydrate(); } catch (e) {} }
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
    if (w.identities && CBZ.cityIdentities && CBZ.cityIdentities.apply) try { CBZ.cityIdentities.apply(w.identities); } catch (e) {}
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
      // additive lifetime escape tally on the rap sheet (an older v2 ledger may
      // predate this field — guard the NaN). Mirrors jailHistory.escapes; lives on
      // criminalRecord so the record reads as a single "escaped N times" stat.
      w.criminalRecord.escapes = (w.criminalRecord.escapes || 0) + 1;
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

  // ---- gang-state re-hydrate wrap (LEDGER GAP fix, cont'd) ----------------
  // playergang.js's CBZ.cityPlayerGangReset() unconditionally nulls
  // g.playerGang/g.cityMembership/g.playerGangId every run (called from
  // careers.js's cityCareersReset(), which mode.js's reset() runs LAST of
  // all the per-run resets — after cityWorldBeginRun already re-pointed
  // g.cityWorld at the right character). We don't own playergang.js, so we
  // wrap its exported reset function the same way origins.js already wraps
  // ours (the established pattern here): let the real reset run first (it
  // nulls everything), then restore this character's own safe-subset state
  // off the CURRENT g.cityWorld. Installed lazily/idempotently from a tick
  // because playergang.js may load before OR after this file.
  let _gangResetWrapped = false;
  function ensureGangResetWrap() {
    if (_gangResetWrapped) return;
    const prev = CBZ.cityPlayerGangReset;
    if (typeof prev !== "function") return;   // playergang.js not loaded yet — retry next tick
    _gangResetWrapped = true;
    CBZ.cityPlayerGangReset = function () {
      const r = prev.apply(this, arguments);
      try {
        const w = ensure();
        if (w.playerGang) g.playerGang = copy(w.playerGang);
        if (w.cityMembership) g.cityMembership = copy(w.cityMembership);
        if (w.playerGangId) g.playerGangId = w.playerGangId;
      } catch (e) {}
      return r;
    };
  }

  CBZ.onUpdate(32.4, function (dt) {
    if (g.mode !== "city") return;
    ensureGangResetWrap();
    const w = ensure();
    w.world.panic = Math.max(0, (w.world.panic || 0) - dt * 0.18);
    w.world.emergency = Math.max(0, (w.world.emergency || 0) - dt * 0.05);
    w.transport.delays = Math.max(0, (w.transport.delays || 0) - dt * 0.03);
    w.economy.confidence = clamp((w.economy.confidence || 100) + dt * 0.02, 0, 100);
    saveT += dt;
    if (saveT > 5) { saveT = 0; commit(); }
  });
})();
