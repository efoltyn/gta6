/* ============================================================
   sim/motorsport.js — Stage E, step E10: MOTORSPORT IS CORPORATE.

   MASTER-PLAN VI.6 (verbatim, the piece this file lands): "Car manufacturers
   become listed corporations too — each one makes the actual car models in
   the CARS catalog, so the cars in traffic, on dealership lots, and in the
   player's garage are their products, and dealership sales book into their
   revenue. Every race-car driver is a persistent registry NPC employed by a
   racing team, and every team is owned by a car company... results move the
   market — win on Sunday, sell on Monday... The racing.js purse pool stops
   being printed money and becomes sponsorship spend from the owning
   companies."

   SCOPE (bounded per BUILD-PLAN E10): TWO listed manufacturers — sim/
   corporations.js's kaido/KAI (Kaido Motors) and volante/VLT (Volante Auto
   Group), the two umbrella owners economy.js's CARS catalog was just split
   under (.maker field). More manufacturers, more teams, betting/race-fixing
   and the SEC-heat tie-in are ALL future waves (see the racFix() stub note
   near the bottom) — this wave is teams + drivers + results + sponsorship.

   TEAMS + DRIVERS: one team per manufacturer, 2 drivers each (4 total).
   Drivers are PERSISTENT LEDGER IDENTITIES minted the exact same way sim/
   billionaires.js mints its 8 founders — a synthetic, NEVER-SPAWNED "ped"
   object stashed straight into schedule.js's offline ledger via
   CBZ.cityPedStash (the `_parked:true` trick, see billionaires.js's header
   for why that's safe with no .pos/.group at all). Archetype "racer", real
   minted names. Unlike the founders, drivers get NO family-tree wiring this
   wave — single, no spouse/kids (comment, not a gap: a future wave can weave
   them into social.js's family system the same way billionaires.js does).
   Skill is NOT stored on the ledger page (schedule.js's cityPedStash only
   copies a fixed field set — name/arch/job/wealth/aggr/cash/known/sex/hh/rel
   — no room for an arbitrary "skill" float), so it lives in OUR OWN
   g.motorsport.teams[].drivers[] records instead, keyed alongside each sid.

   RACE RESOLUTION: racing.js's cityRacing.awardRace(resultsArray) is the one
   function every race conclusion calls (city/island_speedway.js's endRace()
   calls it right before computing the purse) — wrapped here (own
   `_msWrap` guard) so every race ALSO rolls a finish among our 4 team
   drivers (+ the player, if resultsArray contains the player's slot — same
   "no roster match" detection awardRace's own header documents) purely on
   skill + seeded dice. This is a SEPARATE field from racing.js's own
   12-driver ROSTER_DEF (that roster's points/standings/walkable NPCs are
   untouched) — the corporate layer riding on top of the same race event.
   Winner's maker: +0.02 stock shock, a small brand-demand bump (a "luxury"
   category recordBuy — the same spendCat apex/dealerships sell against),
   brandHeat set to 1.3 (corporations.js's manufacturer branch reads this;
   it decays back toward 1.0 a bit every city-day). Loser's maker: -0.005.
   If the player wins outright, no maker "wins" this race (no market reaction
   either way) — the field just had a better day than the corporate roster.

   PURSES BECOME SPONSORSHIP: island_speedway.js's endRace no longer prints
   the purse out of nowhere — it calls paySponsorship(purse) here, which
   debits BOTH makers' real treasuries (sim/corporations.js's debitCash)
   purse/2 each and pays the player the total actually collected. A broke
   maker (cash < its half) pays what it has (possibly $0) and a feed line
   says so — "the purse halves" per spec, rather than backfilling the gap
   with printed money. The winning DRIVER (set by resolveTeams, which always
   runs before this — see endRace's call order) takes a 10% cut of whatever
   the player actually got paid, credited straight to their ledger cash, and
   is marked known (DRIVER FAME) — a driver nobody's heard of becomes a name
   the first time they cash a real check.

   KILLING A DRIVER: a second cityKillPed wrap (own `_msKillWrap` guard,
   installed after billionaires.js's `_bilWrap` — same file-load-order
   argument that file's header makes for its own wrap vs. inheritance.js's).
   A dead driver's maker takes a -0.03 shock, a feed line runs, and the team
   SCRAMBLES: a freshly minted reserve driver takes the empty seat (ledger-
   only, same mint path, no family — a promoted nobody, not a dynasty).

   RACE-FIXING / SEC HEAT: explicitly OUT OF SCOPE this wave (per BUILD-PLAN
   E10's own phasing note and VI.6's "P-stage" politics/SEC arc) — a future
   wave wires a bought "fix" + the player winning while it's active into
   sim/corporations.js's SEC-heat mechanic (once one exists). Nothing here
   detects or reacts to fixing; the market-moving results above are the
   honest-race case only.

   PERSISTENCE: v1 blob.msp rides the same two-rider pattern as every other
   sim/* file this wave (g.cityWorld.msp; own guard `_mspSaveWrap`).
   Serializes teams[] (makerId, sym, name, drivers:[{sid,skill}]) — the
   skill floats that don't fit on a ledger page ride along here instead.
   Fresh-run reset: a guarded 1-line hook beside corp/stocks/billionaires'
   own reset() calls in city/peds.js's spawnCityPeds().
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  // own seeded LCG (never Math.random — repo convention for world state).
  const INITIAL_SEED = 481516234 & 0x7fffffff;
  let _seed = INITIAL_SEED;
  function rng() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }

  // ---- THE TWO LAUNCH TEAMS — one per sim/corporations.js manufacturer row.
  const TEAM_DEFS = [
    { makerId: "kaido",   sym: "KAI", teamName: "Kaido Racing" },
    { makerId: "volante", sym: "VLT", teamName: "Volante GT" },
  ];
  const DRIVER_CASH_MIN = 8000, DRIVER_CASH_SPAN = 12000;
  const DRIVER_SKILL_MIN = 0.75, DRIVER_SKILL_SPAN = 0.20;
  const WIN_SHOCK = 0.02, LOSE_SHOCK = -0.005, KILL_SHOCK = -0.03;
  const WIN_BRAND_HEAT = 1.3;
  const FAME_PURSE_CUT = 0.10;

  // sid -> the pending winning driver, set by resolveTeams() right before
  // island_speedway.js computes+pays the purse (same tick, awardRace always
  // runs first — see endRace()'s call order). Cleared once paid out.
  let _lastWinner = null;

  // ---- state lives on g.motorsport ------------------------------------------
  function reset() {
    g.motorsport = { inited: false, teams: [] };
    _lastWinner = null;
  }
  function ensureState() {
    if (!g.motorsport) g.motorsport = { inited: false, teams: [] };
    return g.motorsport;
  }
  function teamFor(makerId) {
    ensureState();
    for (const t of g.motorsport.teams) if (t.makerId === makerId) return t;
    return null;
  }
  function allDrivers() {
    ensureState();
    const out = [];
    for (const t of g.motorsport.teams) for (const d of t.drivers) if (d && d.sid) out.push({ sid: d.sid, skill: d.skill, team: t });
    return out;
  }

  // ---- identity minting: the billionaires.js parked-stash pattern, verbatim
  // (see that file's header for why `_parked:true` makes a never-spawned
  // synthetic object stash cleanly into schedule.js's offline ledger). -------
  function mintIdentity(fields) {
    if (!CBZ.cityPedStash) return null;
    const obj = Object.assign({ _parked: true, kind: "civilian" }, fields);
    CBZ.cityPedStash(obj);
    return obj._sid ? obj : null;
  }
  function mintName(gender) {
    if (CBZ.cityMintName) return CBZ.cityMintName(rng, gender);
    return gender === "f" ? "Nadia Voss" : "Milo Voss";   // no-name fallback (should never hit in practice)
  }
  function nameOf(sid) {
    if (!sid) return "Someone";
    const live = CBZ.cityLedgerLive && CBZ.cityLedgerLive(sid);
    if (live && live.name) return live.name;
    const e = CBZ.cityLedgerEntry && CBZ.cityLedgerEntry(sid);
    return (e && e.name) || "Someone";
  }
  // grantFame(sid, amount) -> credit real ledger cash + mark the driver known.
  // Two possible shapes per billionaires.js's own cashOf()/whaleSession()
  // precedent: a LIVE ped (nameKnown) or an offline ledger page (known).
  function grantFame(sid, amount) {
    if (!sid || !(amount > 0)) return;
    const live = CBZ.cityLedgerLive && CBZ.cityLedgerLive(sid);
    if (live) { live.cash = (live.cash || 0) + amount; live.nameKnown = true; return; }
    const e = CBZ.cityLedgerEntry && CBZ.cityLedgerEntry(sid);
    if (e) { e.cash = (e.cash || 0) + amount; e.known = true; }
  }

  // ---- TEAM/DRIVER MINT (one-shot, lazy — the first tick a live city + the
  // manufacturer corps exist) -------------------------------------------------
  function mintDriver(teamName) {
    const gender = rng() < 0.5 ? "f" : "m";
    const d = mintIdentity({
      name: mintName(gender), gender: gender, archetype: "racer", job: "driver for " + teamName,
      wealth: 0.8, aggr: 0.25, cash: DRIVER_CASH_MIN + Math.round(rng() * DRIVER_CASH_SPAN),
    });
    if (!d) return null;
    return { sid: d._sid, skill: DRIVER_SKILL_MIN + rng() * DRIVER_SKILL_SPAN };
  }
  function mintTeamFor(spec) {
    ensureState();
    if (teamFor(spec.makerId)) return;   // already minted (or restored from a save's apply())
    const drivers = [];
    for (let i = 0; i < 2; i++) { const d = mintDriver(spec.teamName); if (d) drivers.push(d); }
    g.motorsport.teams.push({ makerId: spec.makerId, sym: spec.sym, name: spec.teamName, drivers: drivers });
  }
  function mintAllTeams() {
    if (!CBZ.corps || typeof CBZ.corps.get !== "function") return false;
    let allBuilt = true;
    for (const spec of TEAM_DEFS) {
      const co = CBZ.corps.get(spec.makerId);
      if (!co) { allBuilt = false; continue; }   // manufacturer not registered yet — retry next tick
      try { mintTeamFor(spec); } catch (e) {}
    }
    if (allBuilt) ensureState().inited = true;
    return allBuilt;
  }
  // order 46.02 — after billionaires.js's own 46.0 mint-check (and this
  // file's own 46.01 hydrate below) within the same install-tick family.
  CBZ.onUpdate(46.02, function () {
    const gm = CBZ.game; if (!gm || gm.mode !== "city") return;
    ensureState();
    if (g.motorsport.inited) return;
    try { mintAllTeams(); } catch (e) {}
  });

  // ---- RACE RESULTS: rolls the 4 team drivers (+ the player, if racing)
  // purely on skill + seeded dice — see header for why this is a field
  // SEPARATE from racing.js's own 12-driver roster. -----------------------
  function resolveTeams(resultsArray) {
    ensureState();
    if (g.motorsport.teams.length < TEAM_DEFS.length) return;   // not fully minted yet
    // did the PLAYER race? racing.js's own awardRace() comment: an entry with
    // no .racer/.number/.points match IS the player's slot — mirror that here.
    let playerIn = false;
    if (Array.isArray(resultsArray)) {
      for (const r of resultsArray) {
        const isRosterRacer = !!(r && ((r.number != null && r.points != null) || r.racer));
        if (r && !isRosterRacer) { playerIn = true; break; }
      }
    }
    const field = allDrivers().map(function (d) { return { d: d, roll: d.skill + rng() * 0.5 }; });
    if (!field.length) return;
    if (playerIn) field.push({ d: null, roll: 0.75 + rng() * 0.5 });   // a competent entry, no maker attached
    field.sort(function (a, b) { return b.roll - a.roll; });
    const first = field[0];
    if (!first.d) return;   // the player (or an empty field) took it — no maker result this race
    const winTeam = first.d.team;
    let loseTeam = null;
    for (const f of field) { if (f.d && f.d.team !== winTeam) { loseTeam = f.d.team; break; } }

    const winCo = CBZ.corps && CBZ.corps.get ? CBZ.corps.get(winTeam.makerId) : null;
    if (winCo) {
      if (CBZ.stocks && typeof CBZ.stocks.shock === "function") CBZ.stocks.shock(winTeam.sym, WIN_SHOCK);
      winCo.brandHeat = WIN_BRAND_HEAT;   // WIN ON SUNDAY, SELL ON MONDAY (decays daily — corporations.js)
      if (CBZ.market && typeof CBZ.market.recordBuy === "function") CBZ.market.recordBuy("luxury", 4);   // brand-demand bump
      if (CBZ.cityFlavor) CBZ.cityFlavor("🏁 " + winTeam.sym + " wins the cup — showrooms buzzing", "#ffd76a");
    }
    if (loseTeam) {
      const loseCo = CBZ.corps && CBZ.corps.get ? CBZ.corps.get(loseTeam.makerId) : null;
      if (loseCo && CBZ.stocks && typeof CBZ.stocks.shock === "function") CBZ.stocks.shock(loseTeam.sym, LOSE_SHOCK);
    }
    _lastWinner = { makerId: winTeam.makerId, sid: first.d.sid };
  }
  if (CBZ.cityRacing && typeof CBZ.cityRacing.awardRace === "function" && !CBZ.cityRacing.awardRace._msWrap) {
    const origAward = CBZ.cityRacing.awardRace;
    const wrappedAward = function (resultsArray) {
      const ret = origAward.apply(this, arguments);
      try { resolveTeams(resultsArray); } catch (e) {}
      return ret;
    };
    wrappedAward._msWrap = true;
    CBZ.cityRacing.awardRace = wrappedAward;
  }

  // ---- PURSES BECOME SPONSORSHIP: island_speedway.js calls this instead of
  // printing the purse — see header for the guarded-fallback call site. -----
  function paySponsorship(purse) {
    ensureState();
    if (!(purse > 0)) return;
    const half = purse / 2;
    let total = 0;
    for (const spec of TEAM_DEFS) {
      const co = CBZ.corps && CBZ.corps.get ? CBZ.corps.get(spec.makerId) : null;
      if (!co || co.bankrupt) continue;
      const pay = Math.min(half, Math.max(0, co.cash));
      if (pay <= 0) {
        // BROKE MAKER: pays nothing — the purse comes up short by its half
        // rather than backfilling with printed money (per the E10 spec).
        if (CBZ.cityFlavor) CBZ.cityFlavor("💸 " + co.name + " can't cover its half of the purse this round", "#ff9a6b");
        continue;
      }
      if (CBZ.corps.debitCash) CBZ.corps.debitCash(spec.makerId, pay);
      total += pay;
    }
    if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(total);
    // DRIVER FAME: the winning driver (resolveTeams runs before this, inside
    // the SAME endRace() call — see island_speedway.js) takes a cut of
    // whatever the player actually got paid.
    if (_lastWinner && total > 0) grantFame(_lastWinner.sid, total * FAME_PURSE_CUT);
    _lastWinner = null;
  }

  // ---- KILLING A DRIVER: a second cityKillPed wrap (own guard, installed
  // after billionaires.js's own wrap — same load-order argument). -----------
  function driverRecBySid(sid) {
    ensureState();
    for (const t of g.motorsport.teams) {
      for (let i = 0; i < t.drivers.length; i++) if (t.drivers[i] && t.drivers[i].sid === sid) return { team: t, idx: i };
    }
    return null;
  }
  function handleDriverDeath(hit, ped) {
    const t = hit.team;
    const deadSid = t.drivers[hit.idx].sid;
    const driverName = ped.name || nameOf(deadSid);
    if (CBZ.stocks && typeof CBZ.stocks.shock === "function") CBZ.stocks.shock(t.sym, KILL_SHOCK);
    if (CBZ.cityFlavor) CBZ.cityFlavor("🏎️💥 " + driverName + " of " + t.name + " killed — the team scrambles for a replacement", "#ff6a5e");
    // TEAM SCRAMBLE: a freshly minted reserve takes the empty seat — ledger-
    // only, no family-tree wiring (comment: drivers are single this wave).
    const repl = mintDriver(t.name);
    t.drivers[hit.idx] = repl || { sid: null, skill: DRIVER_SKILL_MIN };
  }
  if (typeof CBZ.cityKillPed === "function" && !CBZ.cityKillPed._msKillWrap) {
    const origKill = CBZ.cityKillPed;
    const wrappedKill = function (ped, imp, cause) {
      const sid = ped && ped._sid;
      const hit = sid ? driverRecBySid(sid) : null;
      const wasDead = !ped || ped.dead;
      const ret = origKill.apply(this, arguments);
      if (hit && !wasDead && ped && ped.dead) {
        try { handleDriverDeath(hit, ped); } catch (e) {}
      }
      return ret;
    };
    wrappedKill._msKillWrap = true;
    CBZ.cityKillPed = wrappedKill;
  }

  CBZ.motorsport = {
    teams: function () { ensureState(); return g.motorsport.teams.slice(); },
    teamFor: teamFor,
    paySponsorship: paySponsorship,
    resolveTeams: resolveTeams,   // exposed for the harness/tests — not called directly in normal play
    serialize: function () {
      ensureState();
      return {
        v: 1, inited: !!g.motorsport.inited,
        teams: g.motorsport.teams.map(function (t) {
          return {
            makerId: t.makerId, sym: t.sym, name: t.name,
            drivers: t.drivers.map(function (d) { return { sid: d.sid, skill: d.skill }; }),
          };
        }),
      };
    },
    apply: function (obj) {
      reset();
      if (!obj || obj.v !== 1) return;
      g.motorsport.inited = !!obj.inited;
      if (Array.isArray(obj.teams)) {
        for (const t of obj.teams) {
          if (!t || !t.makerId) continue;
          g.motorsport.teams.push({
            makerId: t.makerId, sym: t.sym || null, name: t.name || t.makerId,
            drivers: Array.isArray(t.drivers)
              ? t.drivers.map(function (d) { return { sid: d.sid, skill: d.skill != null ? d.skill : 0.8 }; })
              : [],
          });
        }
      }
    },
    reset: reset,
  };

  // ============================================================
  //  SINGLE-PLAYER PERSIST — sim/billionaires.js's g.cityWorld pattern,
  //  verbatim: stamp live state onto g.cityWorld right before the existing
  //  commit/collect save hooks run, hydrate back out whenever that ledger
  //  object's REFERENCE changes. Own idempotence flag (_mspSaveWrap).
  // ------------------------------------------------------------
  function stampMsp() {
    const led = g.cityWorld;
    if (led && typeof led === "object") led.msp = CBZ.motorsport.serialize();
  }
  let _ensureMspSaveWraps_done = false;
  function ensureMspSaveWraps() {
    // ONE-SHOT INSTALL (chain-growth fix): the old guard checked the
    // module flag on the CURRENT top-of-chain function, so once any
    // later module wrapped above us the flag vanished from the top and
    // we re-wrapped EVERY tick - ~20 such modules made the commit chain
    // grow unboundedly (stack overflow on save; found by the P5 full-
    // stack harness). A module-local boolean wraps exactly once, ever.
    if (_ensureMspSaveWraps_done) return;
    _ensureMspSaveWraps_done = true;
    const commit = CBZ.cityWorldCommit;
    if (typeof commit === "function" && !commit._mspSaveWrap) {
      const w = function () { stampMsp(); return commit.apply(this, arguments); };
      w._mspSaveWrap = true; CBZ.cityWorldCommit = w;
    }
    if (CBZ.cityWorldCollect && !CBZ.cityWorldCollect._mspSaveWrap) {
      const col = CBZ.cityWorldCollect;
      const wc = function () { stampMsp(); return col.apply(this, arguments); };
      wc._mspSaveWrap = true; CBZ.cityWorldCollect = wc;
    }
  }
  let _hydratedLedger = null;
  function hydrateFromLedger() {
    const led = g.cityWorld;
    if (!led || led === _hydratedLedger) return;
    _hydratedLedger = led;
    if (led.msp) CBZ.motorsport.apply(led.msp);
  }
  if (CBZ.onUpdate) {
    // 46.01 — BEFORE this file's own 46.02 mint-check (same argument as
    // billionaires.js's 45.995-before-46.0), after billionaires' own 45.995.
    CBZ.onUpdate(46.01, function () {
      if (!g) return;
      ensureMspSaveWraps();
      hydrateFromLedger();
    });
  }
})();
