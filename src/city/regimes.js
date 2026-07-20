/* ============================================================
   city/regimes.js — Stage P, step P6: THE REGIME STATE MACHINE + first
   effects (fascist curfew, communist price controls, anarchist collapse).

   MASTER-PLAN V.4 (verbatim, the parts this file ships) — regime table:
   "Democracy: Baseline; elections; true polls" / "Fascism: Police ×1.6
   aggression, faster heat; night curfew (wanted accrual 23:00-05:00); gang
   crackdowns; propaganda +12; rigged elections; fake displayed polls" /
   "Communism: Price controls (sell −40% but shop stock caps → shortages);
   ...; zero unemployment but confidence decays" / "Anarchism: Police are not
   despawned — they are transitioned. Every officer is a persistent person:
   on collapse each becomes a former cop (same ped, same identity, keeps gun
   and armor) who re-resolves by his own traits — some become private
   security you can hire, some join gangs, some form a vigilante militia...
   some go home to their families. Taxes 0; gang expandW ×1.5, turf payday
   ×1.3; SEIZE everywhere; services collapse... When order is restored,
   surviving former cops can be re-hired" / "Dictatorship: Fascism + no
   elections; assassination becomes the only ballot."

   Transition graph (verbatim): "democracy → emergency rule (approval<35 +
   crisis + military faction support; emergencyPowers +12/day, at 100 →
   dictatorship) → assassination → vacuum rolls (loyalist 45% / junta 30% /
   restoration 25%)." V.0's own persistent-population principle: "every
   person in the world is a stored individual... simulation events transition
   people — they never delete-and-respawn them... cop → former cop with his
   gun."

   THIS WAVE'S NARROWING — the coefficients this file ACTUALLY drives, and
   why (every field here already exists, written by an earlier wave and
   mostly unconsumed until now — the same "write-only, free depth" pattern
   approval.js's own header names):
     - democracy → emergencyRule: approval<35 AND (w.politics.emergencyPowers
       >50 OR any CBZ.relations.warPressure(us, them)>0.5). "Crisis + military
       faction support" is approximated by these two already-wired signals —
       there is no standalone "military faction" stat yet (V.6's own future
       depth), so warPressure (relations.js, already exported, "unconsumed"
       per that file's own header) stands in for it this wave.
     - emergencyRule: emergencyPowers +12/day (worldstate.js's own field,
       fed today only by assassination/terror events — this file is its
       first DAILY driver), headline each step, → dictatorship at 100.
       Repeals to democracy after 3 CONSECUTIVE days of approval>45.
     - dictatorship never auto-transitions on its own tick (V.4: "assassination
       becomes the only ballot") — it only changes via the vacuum roll below,
       fired off officials.js's OWN death machinery (CBZ.onOfficialDeath
       fires AFTER officials.js's succession already ran; this file instead
       keeps its own tiny cityKillPed wrap installed BEFORE that succession
       mutates office.holder/deputy, so it can capture "was this sid the
       dictator" and then OVERRIDE whatever officials.js's default deputy-
       sworn/vacuum path did, with the real 45/30/25 rolls V.4 specifies).
     - anarchism: any non-monarchy, non-anarchism regime can collapse when
       approval<15 AND systems/hunger.js's miseryIndex()>0.6 hold for 2
       CONSECUTIVE days (X6b's civil-war fuse, "exported now, unconsumed" per
       that file's header — this is its first real consumer too).
     - communism is NOT reachable through this wave's daily graph (V.4 says
       "reachable via revolution later" — X6b's civil-war/revolution wave
       owns the trigger); the EFFECTS MACHINERY ships now regardless, wired
       through the same apply/removeEffects path every other regime uses, and
       a harness/dev-only forceGov() hook drives it for testing until a real
       trigger lands.
     - monarchy never enters this state machine (P6b's own bloodline
       succession wave owns it entirely — tickCountry() early-returns on it,
       the same one-line guard elections.js's own P4 header already uses).

   REGIME EFFECTS — applied/removed cleanly on transition, to the country
   record only (V.1's hierarchy root — "the mainland republic is where most
   systems live" per this wave's own scope: police/wanted/gangs/market/
   stocks are still city-wide singletons, not sharded per-country, so a
   transitioning country OTHER than "republic" gets real bookkeeping
   (govType/taxRate/approval all update on its own polity record, and every
   accessor below is generalized off CBZ.polity, never hardcoded to
   "republic" as anything but a DEFAULT) but no visible city-mode effect —
   exactly the plan's own "mostly bookkeeping this wave" framing):
     - fascism/dictatorship: CBZ.CITY.policeForce ×1.3 (self-default pattern,
       matches police.js's own "never edit config.js, nudge CBZ.CITY at
       load" convention — captured/restored per-country so repeated cycles
       never compound); CBZ.regimeHeatMul() (a guarded read wanted.js's
       report() multiplies its heat charge by — see that file's ≤1-line
       edit) returns 1.4 while the PLAYER currently stands in a fascist/
       dictatorship country; a night curfew (23:00-05:00, citySunHour) drips
       heat on an outdoors player in that country + fires one warning feed
       per night; propaganda (+12 w.politics.support) fires ONCE on entry.
     - communism: CBZ.market.setControls({maxP:0.8}) (a NEW market.js API —
       see that file's header for the clamp-override it adds) caps food/goods
       above 1.0 fair-value multiplier, i.e. a real price CEILING; taxRate →
       0.25 on the country's own polity record (approval.js's servicesInput
       already reads rec.taxRate — "the political tax knob" its own header
       names); dividends suspended (CBZ.regimes.dividendsAllowed() — a
       2-line sim/stocks.js payDividends() guard). Controlled prices ALSO
       cutting shop STOCK (V.4: "shop stock caps → shortages") has no home
       yet — there is no stock-quantity concept anywhere in this codebase
       (shops sell off an infinite catalog) — shortages land with whatever
       future wave adds real inventory, not this one.
     - anarchism: EVERY active (non-dead) cop CONVERTS — see COP CONVERSION
       below, the owner's headline rule, implemented faithfully: nobody is
       despawned, each becomes a real, ledger-minted former cop who keeps his
       gun. forcePool → 0 (CBZ.cityPoliceForceZero(), a tiny new police.js
       export) and maintain() stops refilling it (CBZ.regimes.policeAllowed()
       — a ≤2-line police.js gate) — no respawn while anarchism holds.
       taxRate → 0. Gangs' expandW effectively ×1.5 while it holds
       (CBZ.regimes.gangBoostMul() — a guarded read at gangs.js's own
       press() computation, ~line 1822, ≤1-line edit). Approval is FROZEN —
       this file's own 1Hz tick re-stamps the snapshot taken at collapse over
       whatever approval.js's independent equation computes that same second
       (no approval.js edit — this is the exact "own tick stomps the value
       back after the other module's tick" technique already precedented by
       every _xWrap in this codebase, just via ordering instead of wrapping).
       RESTORATION: after 5+ days in anarchism, the single strongest live
       gang's boss crowns himself — govType → dictatorship, boss.sid becomes
       office.holder (a gang boss running the country, minted a ledger
       identity via cityPedStash if he never had one — gangs.js bosses never
       do, per protection.js's own documented precedent for this exact gap).

   COP CONVERSION (the owner's rule, implemented faithfully) — HOW THE
   PERSON PERSISTS: cops (police.js's makeCop) and civilians (peds.js's
   makePed) are two DIFFERENT record shapes; there is no in-place "flip a
   flag" conversion. So each active cop's exact position + weapon are read
   off the live cop record, a brand-new civilian ped is spawned there
   carrying that gun (armed:true, weapon from the cop, aggr rolled 0.3-0.7),
   CBZ.cityPedStash(ped) MINTS A REAL LEDGER IDENTITY for it (the schedule.js
   population registry — not the "parked, off-screen" mintIdentity() shape
   officials.js/elections.js use for identities with no live body; this
   person has a live body, right now, so it gets the REAL stash path, the
   same one every ordinary civilian ped earns), and ONLY THEN is the old cop
   record retired (scene-graph disposal + spliced out of CBZ.cityCops — never
   routed through cityKillPed/cityHurtCop, which would ring the kill feed,
   drop loot, and count as a death; this person didn't die, their job did).
   The three-way split V.4 names (security/gang/home) is flavor on top of
   that same persisted body: 30% get a `_formerCopFlavor:"security"` tag
   (protection.js's hireable-pool flavor — a flag only, this wave; no new
   hire-source wiring), 20% bump the nearest live gang's `recruitPool` by 1
   (gangs.js's own finite-reserve field — CBZ.cityNearestRivalHQ/
   cityGangById, both already exported, resolve "nearest gang" with no new
   spatial-query code), the remaining 50% are tagged "home" and left exactly
   like any other freshly-spawned civilian ped — schedule.js's own routine
   system takes it from there (V.0: "a laid-off clerk → gang recruit pool...
   every transition is visible and consequential").

   CROSS-FILE HOOKS (every one guarded, so a load-order hiccup or an absent
   regimes.js is a silent no-op everywhere else, never a throw):
     - wanted.js report(): charge *= CBZ.regimeHeatMul() (heat gain ×1.4
       under fascism/dictatorship, read off the PLAYER's current country).
     - police.js maintain(): gated by CBZ.regimes.policeAllowed() (no new
       spawns/replenishment while anarchism holds) + a new
       CBZ.cityPoliceForceZero() export this file calls once on collapse.
     - sim/stocks.js payDividends(): gated by CBZ.regimes.dividendsAllowed()
       (communism suspends payouts).
     - sim/market.js: gains CBZ.market.setControls({maxP}|null) — a real
       per-category upper-clamp override this file drives.
     - city/gangs.js: its rival-war press() computation reads
       CBZ.regimes.gangBoostMul() (anarchism ×1.5).

   LOAD ORDER: after city/relations.js (needs CBZ.relations.warPressure +
   CBZ.hunger.miseryIndex + CBZ.polity/approvalShock/onNewDay/worldDay, all
   already live by the end of the P/X-wave block) — the last script in that
   block, right before core/quality.js.

   PERSISTENCE: polity.js's OWN serialize()/apply() already carries govType/
   taxRate/approval/office per record (its header says so, verified) — this
   file's own blob (blob.reg, netpersist.js) carries only what polity's
   shape can't: per-country day-counters + one-shot effect flags (see
   PERSISTENCE section below). Two riders, the exact polity.js/protection.js
   dual pattern (MULTIPLAYER blob.reg + SINGLE-PLAYER g.cityWorld.reg), WITH
   the one-shot install guard from the P5 chain-growth fix (a module-local
   boolean, checked before ever wrapping cityWorldCommit/Collect — see that
   fix's own comment, copied verbatim below).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  // own seeded LCG (never Math.random — repo convention for world state).
  let _seed = 190402011 & 0x7fffffff;
  function rng() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }
  function clampNum(lo, hi, v) { return Math.max(lo, Math.min(hi, v)); }

  const REPUBLIC_ID = "republic";        // default country id every mainland-only accessor below falls back to
  const EMERGENCY_APPROVAL = 35, EMERGENCY_POWERS_T = 50, WAR_PRESSURE_T = 0.5;
  const EMERGENCY_GAIN = 12, EMERGENCY_MAX = 100;
  const REPEAL_APPROVAL = 45, REPEAL_DAYS = 3;
  const ANARCHY_APPROVAL = 15, ANARCHY_MISERY = 0.6, ANARCHY_DAYS = 2;
  const STRONGMAN_DAYS = 5;
  const POLICE_MUL = 1.3, HEAT_MUL = 1.4, GANG_MUL = 1.5;
  const CURFEW_LO = 23, CURFEW_HI = 5;   // 23:00-05:00
  const CURFEW_HEAT_DRIP = 6;
  const PROPAGANDA_BUMP = 12;
  const COMMUNISM_MAXP = 0.8, COMMUNISM_TAXRATE = 0.25, TAX_BASELINE = 0.10;

  // ============================================================
  //  STATE — g.regimesWorld.perCountry[id] = per-country counters/flags
  // ============================================================
  function freshCountryState() {
    return {
      repealDays: 0, miseryDays: 0,
      anarchyStartDay: null, frozenApproval: null,
      propagandaApplied: false,
      policeForceBumped: false, _origPoliceForce: null,
      curfewWarnedNight: null,
    };
  }
  function reset() {
    // revert any LIVE config bump before wiping our own bookkeeping (own
    // state, own cleanup — never leaves CBZ.CITY.policeForce stuck bumped
    // across a fresh run) + drop any live market price-control override.
    if (g.regimesWorld && g.regimesWorld.perCountry) {
      for (const id in g.regimesWorld.perCountry) {
        const s = g.regimesWorld.perCountry[id];
        if (s.policeForceBumped && CBZ.CITY && s._origPoliceForce != null) CBZ.CITY.policeForce = s._origPoliceForce;
      }
    }
    if (CBZ.market && CBZ.market.setControls) try { CBZ.market.setControls(null); } catch (e) {}
    g.regimesWorld = { perCountry: Object.create(null) };
  }
  function ensureInit() { if (!g.regimesWorld || !g.regimesWorld.perCountry) reset(); }
  function st(id) {
    ensureInit();
    const P = g.regimesWorld.perCountry;
    if (!P[id]) P[id] = freshCountryState();
    return P[id];
  }

  // ============================================================
  //  HELPERS
  // ============================================================
  function isAuthoritarian(gov) { return gov === "fascism" || gov === "dictatorship"; }
  function countryRec(id) { return CBZ.polity && CBZ.polity.get ? CBZ.polity.get(id || REPUBLIC_ID) : null; }
  function politics() { return CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null; }
  function maxWarPressure(id) {
    if (!CBZ.relations || !CBZ.relations.warPressure || !CBZ.polity) return 0;
    const countries = CBZ.polity.list("country");
    let best = 0;
    for (let i = 0; i < countries.length; i++) {
      const o = countries[i]; if (o.id === id) continue;
      const p = CBZ.relations.warPressure(id, o.id);
      if (p > best) best = p;
    }
    return best;
  }
  const GOV_LABEL = {
    democracy: "Democracy", emergencyRule: "Emergency Rule", dictatorship: "Dictatorship",
    fascism: "Fascist Rule", communism: "Communism", anarchism: "Anarchy", monarchy: "Monarchy",
  };
  function feedTransition(rec, oldGov, newGov) {
    const lbl = GOV_LABEL[newGov] || newGov;
    if (CBZ.city && CBZ.city.big) CBZ.city.big("" + rec.name.toUpperCase() + ": " + lbl.toUpperCase());
    if (CBZ.cityFeed) CBZ.cityFeed("" + rec.name + " shifts from " + (GOV_LABEL[oldGov] || oldGov) + " to " + lbl + ".", "#ffd76a");
  }
  // neighbors of a new dictatorship: every OTHER democracy loses standing.
  function rippleDictatorship(rec) {
    if (!CBZ.relations || !CBZ.relations.get || !CBZ.relations.set || !CBZ.polity) return;
    const countries = CBZ.polity.list("country");
    for (let i = 0; i < countries.length; i++) {
      const o = countries[i];
      if (o.id === rec.id || o.govType !== "democracy") continue;
      const cur = CBZ.relations.get(rec.id, o.id);
      CBZ.relations.set(rec.id, o.id, cur - 10);
    }
  }

  // ============================================================
  //  REGIME EFFECTS — apply/remove, one country record at a time
  // ============================================================
  function applyEffects(rec, gov, day) {
    const s = st(rec.id);
    if (isAuthoritarian(gov)) {
      if (!s.policeForceBumped) {
        s._origPoliceForce = (CBZ.CITY && CBZ.CITY.policeForce != null) ? CBZ.CITY.policeForce : 40;
        if (CBZ.CITY) CBZ.CITY.policeForce = Math.round(s._origPoliceForce * POLICE_MUL);
        s.policeForceBumped = true;
      }
      if (!s.propagandaApplied) {
        const w = politics();
        if (w && w.politics) w.politics.support = clampNum(-100, 100, (w.politics.support || 0) + PROPAGANDA_BUMP);
        s.propagandaApplied = true;
      }
    } else if (gov === "communism") {
      if (CBZ.market && CBZ.market.setControls) try { CBZ.market.setControls({ maxP: COMMUNISM_MAXP }); } catch (e) {}
      rec.taxRate = COMMUNISM_TAXRATE;
    } else if (gov === "anarchism") {
      convertAllCops();
      if (CBZ.cityPoliceForceZero) try { CBZ.cityPoliceForceZero(); } catch (e) {}
      rec.taxRate = 0;
      s.anarchyStartDay = day;
      s.frozenApproval = rec.approval;
    }
  }
  function removeEffects(rec, gov) {
    const s = st(rec.id);
    if (isAuthoritarian(gov)) {
      if (s.policeForceBumped && CBZ.CITY) {
        CBZ.CITY.policeForce = s._origPoliceForce != null ? s._origPoliceForce : CBZ.CITY.policeForce;
      }
      s.policeForceBumped = false; s._origPoliceForce = null;
      s.propagandaApplied = false;   // one-shot re-arms if this regime is re-entered later
    } else if (gov === "communism") {
      if (CBZ.market && CBZ.market.setControls) try { CBZ.market.setControls(null); } catch (e) {}
      rec.taxRate = TAX_BASELINE;
    } else if (gov === "anarchism") {
      rec.taxRate = TAX_BASELINE;
      s.anarchyStartDay = null;
      s.frozenApproval = null;
    }
  }

  // ============================================================
  //  COP CONVERSION — see header. Never routed through cityKillPed/despawn.
  // ============================================================
  function disposeGroup(grp) {
    if (!grp) return;
    if (grp.parent) grp.parent.remove(grp);
    grp.traverse(function (o) {
      if (o.isSprite) return;   // sprites share an r128 geometry singleton — never dispose (repo convention)
      if (o.geometry && !o.geometry._shared && o.geometry.dispose) try { o.geometry.dispose(); } catch (e) {}
      const m = o.material;
      if (m) {
        if (Array.isArray(m)) m.forEach(function (mm) { if (mm && !mm._shared && mm.dispose) try { mm.dispose(); } catch (e) {} });
        else if (!m._shared && m.dispose) try { m.dispose(); } catch (e) {}
      }
    });
  }
  function removeCopRecord(c) {
    disposeGroup(c.group);
    const i = CBZ.cityCops ? CBZ.cityCops.indexOf(c) : -1;
    if (i >= 0) CBZ.cityCops.splice(i, 1);
  }
  function nearestGangFor(x, z) {
    if (!CBZ.cityNearestRivalHQ || !CBZ.cityGangById) return null;
    const hq = CBZ.cityNearestRivalHQ(x, z, null);
    return hq ? CBZ.cityGangById(hq.id) : null;
  }
  // convert ONE active cop into a persisted former-cop ped. Returns the new
  // ped (or null if the spawn couldn't happen — the cop record is still
  // retired either way, matching "no despawn" only for the PERSON, not a
  // guaranteed-successful spawn under a degenerate arena).
  function convertCop(c) {
    if (!c || c.dead || c._converted) return null;
    c._converted = true;
    const A = CBZ.city && CBZ.city.arena;
    if (!A || !CBZ.cityMakePed) { removeCopRecord(c); return null; }
    const roll = rng();
    const weapon = c.weapon || c._beltGun || "Pistol";
    const aggr = 0.3 + rng() * 0.4;
    let ped = null;
    try {
      ped = CBZ.cityMakePed(c.pos.x, c.pos.z, rng, {
        job: "former cop", archetype: "civilian",
        armed: true, weapon: weapon, aggr: aggr, wealth: 0.35,
      });
    } catch (e) { ped = null; }
    if (!ped) { removeCopRecord(c); return null; }
    ped.ammo = c.ammo || 30;
    if (A.root) A.root.add(ped.group);
    if (CBZ.cityPeds) CBZ.cityPeds.push(ped);
    // MINT THE LEDGER IDENTITY — the real, live-body stash path (schedule.js),
    // not officials.js's "parked, no body" mintIdentity() shape: this person
    // has a body standing right here, right now. THIS is how the person
    // persists — a ledger row, not a runtime-only guard body. schedule.js's
    // own worth() gate (cityPedStash) only pages a ped with a gang/vendor/
    // bounty/nameKnown/fat-wallet/etc — a plain ex-officer with no cash on
    // them would otherwise silently fail to mint. nameKnown:true (the exact
    // flag every mintIdentity()-shaped official/candidate already carries)
    // guarantees the page every time — a former cop is always worth one.
    ped.nameKnown = true;
    if (CBZ.cityPedStash) try { CBZ.cityPedStash(ped); } catch (e) {}
    if (roll < 0.30) {
      ped._formerCopFlavor = "security";           // protection.js hireable-pool flavor (flag only, this wave)
    } else if (roll < 0.50) {
      ped._formerCopFlavor = "gang";
      const gang = nearestGangFor(c.pos.x, c.pos.z);
      if (gang) gang.recruitPool = (gang.recruitPool || 0) + 1;
    } else {
      ped._formerCopFlavor = "home";               // an ordinary civilian now — schedule.js's routine owns the rest
    }
    removeCopRecord(c);
    return ped;
  }
  function convertAllCops() {
    const cops = (CBZ.cityCops || []).slice();
    let n = 0;
    for (let i = 0; i < cops.length; i++) {
      const c = cops[i];
      if (c.dead) continue;
      if (convertCop(c)) n++;
    }
    if (n && CBZ.cityFeed) CBZ.cityFeed("The force collapses — " + n + " officers walk away, guns in hand.", "#ff9e6b");
    return n;
  }

  // ============================================================
  //  TRANSITION — clean apply/remove + headline/shock/ripple, every path
  // ============================================================
  function transition(rec, newGov, day, shock) {
    if (!rec || rec.govType === newGov) return;
    const oldGov = rec.govType;
    removeEffects(rec, oldGov);
    rec.govType = newGov;
    const s = st(rec.id);
    s.repealDays = 0; s.miseryDays = 0;
    applyEffects(rec, newGov, day);
    feedTransition(rec, oldGov, newGov);
    if (CBZ.approvalShock && isFinite(shock)) CBZ.approvalShock(rec.id, shock);
    if (newGov === "dictatorship") rippleDictatorship(rec);
  }

  // ============================================================
  //  DAILY TICK — democracy -> emergencyRule -> dictatorship (+ repeal),
  //  and the anarchy collapse check (runs for any live, non-monarchy regime).
  // ============================================================
  function tickCountry(rec, day) {
    if (!rec || rec.govType === "monarchy") return;
    const s = st(rec.id);
    const gov = rec.govType;

    if (gov === "anarchism") {
      if (s.anarchyStartDay != null && day - s.anarchyStartDay >= STRONGMAN_DAYS) {
        // P6b: a country whose royal house survives with a living claimant
        // rallies to the pretender, not a warlord — defer to crown.js's
        // restoration (fires at its own day-7 threshold). The strongman only
        // takes a throne nobody living can claim.
        const royalist = !!(CBZ.crown && CBZ.crown.hasLivingLine && CBZ.crown.hasLivingLine(rec.id));
        if (!royalist) strongmanRestore(rec, day);
      }
      return;   // no other transitions evaluated while anarchism holds
    }

    // ANARCHY CHECK — any live non-monarchy regime can collapse.
    const misery = (CBZ.hunger && CBZ.hunger.miseryIndex) ? CBZ.hunger.miseryIndex() : 0;
    if ((rec.approval || 0) < ANARCHY_APPROVAL && misery > ANARCHY_MISERY) {
      s.miseryDays = (s.miseryDays || 0) + 1;
      if (s.miseryDays >= ANARCHY_DAYS) { transition(rec, "anarchism", day, -20); return; }
    } else s.miseryDays = 0;

    if (gov === "democracy") {
      const w = politics();
      const ep = (w && w.politics && w.politics.emergencyPowers) || 0;
      const warP = maxWarPressure(rec.id);
      if ((rec.approval || 0) < EMERGENCY_APPROVAL && (ep > EMERGENCY_POWERS_T || warP > WAR_PRESSURE_T)) {
        transition(rec, "emergencyRule", day, -8);
      }
    } else if (gov === "emergencyRule") {
      const w = politics();
      if (w && w.politics) {
        w.politics.emergencyPowers = clampNum(0, EMERGENCY_MAX, (w.politics.emergencyPowers || 0) + EMERGENCY_GAIN);
        if (CBZ.cityFeed) CBZ.cityFeed("Emergency powers rising in " + rec.name + " (" + Math.round(w.politics.emergencyPowers) + "%)", "#ffb35e");
        if (w.politics.emergencyPowers >= EMERGENCY_MAX) { transition(rec, "dictatorship", day, -10); return; }
      }
      if ((rec.approval || 0) > REPEAL_APPROVAL) {
        s.repealDays = (s.repealDays || 0) + 1;
        if (s.repealDays >= REPEAL_DAYS) transition(rec, "democracy", day, 6);
      } else s.repealDays = 0;
    }
    // fascism/dictatorship: no daily auto-transition — only the assassination
    // vacuum roll (dictatorVacuum, below) or the anarchy check above move it.
  }
  if (CBZ.onNewDay) {
    CBZ.onNewDay(function (day) {
      if (!CBZ.polity) return;
      const countries = CBZ.polity.list("country");
      for (let i = 0; i < countries.length; i++) {
        try { tickCountry(countries[i], day); } catch (e) { try { console.error("[regimes] tick failed", countries[i].id, e); } catch (e2) {} }
      }
    });
  }

  // ============================================================
  //  APPROVAL FREEZE — anarchism has no government to approve of. Own 1Hz
  //  tick re-stamps the snapshot taken at collapse over approval.js's own
  //  independent convergence (no approval.js edit — ordering does the work,
  //  same "later tick wins" technique every _xWrap in this codebase uses).
  // ============================================================
  CBZ.onUpdate(33.2, function () {
    if (g.mode !== "city" || !CBZ.polity) return;
    const countries = CBZ.polity.list("country");
    for (let i = 0; i < countries.length; i++) {
      const rec = countries[i];
      if (rec.govType !== "anarchism") continue;
      const s = st(rec.id);
      if (s.frozenApproval != null) rec.approval = s.frozenApproval;
    }
  });

  // ============================================================
  //  NIGHT CURFEW — fascism/dictatorship, 23:00-05:00, player outdoors in
  //  that country: a slow heat drip + one warning feed per night.
  // ============================================================
  let curfewT = 0;
  CBZ.onUpdate(33.3, function (dt) {
    if (g.mode !== "city") return;
    curfewT -= dt; if (curfewT > 0) return;
    curfewT = 1.0;
    const P = CBZ.player; if (!P || P.dead) return;
    const loc = (CBZ.polity && CBZ.polity.of) ? CBZ.polity.of(P.pos.x, P.pos.z) : null;
    const country = loc && CBZ.polity.countryOf ? CBZ.polity.countryOf(loc.id) : countryRec(REPUBLIC_ID);
    if (!country || !isAuthoritarian(country.govType)) return;
    const hr = CBZ.citySunHour ? CBZ.citySunHour() : 12;
    const night = hr >= CURFEW_LO || hr < CURFEW_HI;
    if (!night) return;
    const indoor = !!(CBZ.cityNav && CBZ.cityNav.indoorLotAt && CBZ.cityNav.indoorLotAt(P.pos.x, P.pos.z));
    if (indoor) return;
    g.heat = (g.heat || 0) + CURFEW_HEAT_DRIP;
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    const s = st(country.id);
    const day = CBZ.worldDay ? CBZ.worldDay() : 0;
    if (s.curfewWarnedNight !== day) {
      s.curfewWarnedNight = day;
      if (CBZ.city && CBZ.city.note) CBZ.city.note("Curfew in effect — get off the streets.", 2.4);
    }
  });

  // ============================================================
  //  PUBLIC ACCESSORS — cross-file hooks read these (all guarded elsewhere)
  // ============================================================
  CBZ.regimeHeatMul = function () {
    const P = CBZ.player;
    const loc = (P && P.pos && CBZ.polity && CBZ.polity.of) ? CBZ.polity.of(P.pos.x, P.pos.z) : null;
    const country = loc && CBZ.polity.countryOf ? CBZ.polity.countryOf(loc.id) : countryRec(REPUBLIC_ID);
    return (country && isAuthoritarian(country.govType)) ? HEAT_MUL : 1;
  };
  function gangBoostMul() {
    const rec = countryRec(REPUBLIC_ID);
    return (rec && rec.govType === "anarchism") ? GANG_MUL : 1;
  }
  function policeAllowed() {
    const rec = countryRec(REPUBLIC_ID);
    return !(rec && rec.govType === "anarchism");
  }
  function dividendsAllowed() {
    const rec = countryRec(REPUBLIC_ID);
    return !(rec && rec.govType === "communism");
  }

  // ============================================================
  //  ASSASSINATION → DICTATOR VACUUM ROLLS (45/30/25) — own cityKillPed
  //  wrap installed BEFORE officials.js's succession mutates office.holder/
  //  deputy, so it can capture "was this sid the dictator" first, then
  //  OVERRIDE whatever the default deputy-sworn/vacuum path did.
  // ============================================================
  function findDictatorshipRecordFor(sid) {
    if (!sid || !CBZ.polity) return null;
    const recs = [].concat(CBZ.polity.list("city"), CBZ.polity.list("state"), CBZ.polity.list("country"), CBZ.polity.list("federal"));
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i];
      if (r.office && r.office.holder === sid && r.govType === "dictatorship") return r;
    }
    return null;
  }
  function mintFigure(job) {
    if (!CBZ.cityPedStash) return null;
    const gender = rng() < 0.5 ? "f" : "m";
    const name = CBZ.cityMintName ? CBZ.cityMintName(rng, gender) : (gender === "f" ? "Adelaide Winthrop" : "Foster Winthrop");
    const obj = {
      _parked: true, nameKnown: true, kind: "civilian", name: name, gender: gender,
      archetype: "official", job: job, wealth: 0.6, aggr: 0.3, cash: 1500 + Math.round(rng() * 4000),
    };
    CBZ.cityPedStash(obj);
    return obj._sid ? obj : null;
  }
  function dictatorVacuum(rec, deadSid, depSidBefore, day) {
    const roll = rng();
    const victimName = (CBZ.officials && CBZ.officials.identityOf) ? CBZ.officials.identityOf(deadSid).name : "The dictator";
    if (roll < 0.45) {
      // LOYALIST — the deputy (if one existed) continues the dictatorship.
      let newHolder = depSidBefore;
      if (!newHolder) { const m = mintFigure("dictator"); newHolder = m && m._sid; }
      rec.office.holder = newHolder || null; rec.office.deputy = null; rec.vacuum = null;
      if (newHolder && CBZ.cityLedgerEntry) { const e = CBZ.cityLedgerEntry(newHolder); if (e) e.job = "dictator"; }
      if (CBZ.city && CBZ.city.big) CBZ.city.big("LOYALIST SUCCESSION — THE REGIME HOLDS");
      if (CBZ.cityFeed) CBZ.cityFeed("A loyalist deputy seizes power in " + rec.name + " after " + victimName + "'s death — the dictatorship continues.", "#ff9e6b");
      if (CBZ.approvalShock) CBZ.approvalShock(rec.id, -4);
    } else if (roll < 0.75) {
      // JUNTA — stays dictatorship, military flavor.
      const m = mintFigure("junta general");
      rec.office.holder = m ? m._sid : null; rec.office.deputy = null; rec.vacuum = null;
      if (CBZ.city && CBZ.city.big) CBZ.city.big("MILITARY JUNTA SEIZES POWER");
      if (CBZ.cityFeed) CBZ.cityFeed("The generals move in — a junta rules " + rec.name + " now.", "#ff9e6b");
      if (CBZ.approvalShock) CBZ.approvalShock(rec.id, -8);
    } else {
      // DEMOCRATIC RESTORATION — govType flips, a snap election is queued
      // (rec.vacuum stamped — elections.js's own tickOffice() picks it up).
      removeEffects(rec, "dictatorship");
      rec.office.holder = null; rec.office.deputy = null;
      rec.govType = "democracy";
      rec.vacuum = day;
      if (CBZ.city && CBZ.city.big) CBZ.city.big("THE REGIME FALLS — DEMOCRACY RESTORED");
      if (CBZ.cityFeed) CBZ.cityFeed("" + rec.name + " restores democracy after " + victimName + "'s fall.", "#8fe08a");
      if (CBZ.approvalShock) CBZ.approvalShock(rec.id, 15);
    }
  }
  if (typeof CBZ.cityKillPed === "function" && !CBZ.cityKillPed._regWrap) {
    const origKillPed = CBZ.cityKillPed;
    const wrappedKillPed = function (ped, imp, cause) {
      const sid = ped && ped._sid;
      const wasDead = !ped || ped.dead;
      let dictRec = null, depBefore = null;
      if (sid && !wasDead) {
        dictRec = findDictatorshipRecordFor(sid);
        if (dictRec) depBefore = dictRec.office.deputy;
      }
      const ret = origKillPed.apply(this, arguments);
      if (dictRec && ped && ped.dead) {
        try { dictatorVacuum(dictRec, sid, depBefore, CBZ.worldDay ? CBZ.worldDay() : 0); } catch (e) {}
      }
      return ret;
    };
    wrappedKillPed._regWrap = true;
    CBZ.cityKillPed = wrappedKillPed;
  }

  // ============================================================
  //  ANARCHISM RESTORATION — strongman: the strongest live gang's boss
  //  crowns himself after STRONGMAN_DAYS, govType -> dictatorship.
  // ============================================================
  function strongestGang() {
    let best = null, bestScore = -1;
    for (const gang of (CBZ.cityGangs || [])) {
      if (!gang || gang.isPlayer || gang.absorbed || !gang.boss || gang.boss.dead) continue;
      const alive = gang.members ? gang.members.filter(function (m) { return m && !m.dead; }).length : 0;
      const score = (gang.treasury || 0) + alive * 200 + (gang.turf ? gang.turf.length : 0) * 100;
      if (score > bestScore) { bestScore = score; best = gang; }
    }
    return best;
  }
  function strongmanRestore(rec, day) {
    const gang = strongestGang();
    removeEffects(rec, "anarchism");
    const s = st(rec.id);
    s.anarchyStartDay = null; s.frozenApproval = null;
    let holderSid = null, name = "A warlord";
    if (gang && gang.boss) {
      if (!gang.boss._sid && CBZ.cityPedStash) try { CBZ.cityPedStash(gang.boss); } catch (e) {}
      holderSid = gang.boss._sid || null;
      name = gang.boss.name || gang.bossName || name;
    }
    rec.govType = "dictatorship";
    rec.office.holder = holderSid; rec.office.deputy = null; rec.vacuum = null;
    rec.approval = 40;   // the strongman's own honeymoon baseline — no longer frozen
    applyEffects(rec, "dictatorship", day);
    if (CBZ.city && CBZ.city.big) CBZ.city.big("" + name.toUpperCase() + " SEIZES THE STATE");
    if (CBZ.cityFeed) CBZ.cityFeed("" + name + ", a gang boss, crowns himself over the ashes of anarchy.", "#ffd76a");
    if (CBZ.approvalShock) CBZ.approvalShock(rec.id, -5);
    rippleDictatorship(rec);
  }

  // ============================================================
  //  PERSISTENCE
  // ============================================================
  function serialize() {
    ensureInit();
    const P = g.regimesWorld.perCountry;
    const out = {};
    for (const id in P) {
      const s = P[id];
      out[id] = {
        repealDays: s.repealDays || 0, miseryDays: s.miseryDays || 0,
        anarchyStartDay: s.anarchyStartDay, frozenApproval: s.frozenApproval,
        propagandaApplied: !!s.propagandaApplied,
        policeForceBumped: !!s.policeForceBumped,
        origPoliceForce: s._origPoliceForce != null ? s._origPoliceForce : null,
        curfewWarnedNight: s.curfewWarnedNight != null ? s.curfewWarnedNight : null,
      };
    }
    return { v: 1, perCountry: out };
  }
  // re-assert the STATIC config-level effects a restored govType implies —
  // the one-shot WORLD mutations (cop conversion, propaganda bump) are
  // deliberately NOT redone on load (see header: "physical presence"/one-
  // shot conventions elsewhere) — only cheap, idempotent config re-reads.
  function reapplyStaticEffects() {
    if (!CBZ.polity) return;
    const countries = CBZ.polity.list("country");
    for (let i = 0; i < countries.length; i++) {
      const rec = countries[i];
      const s = st(rec.id);
      if (s.policeForceBumped && CBZ.CITY) {
        const base = s._origPoliceForce != null ? s._origPoliceForce : (CBZ.CITY.policeForce || 40);
        CBZ.CITY.policeForce = Math.round(base * POLICE_MUL);
      }
      if (rec.govType === "communism" && CBZ.market && CBZ.market.setControls) {
        try { CBZ.market.setControls({ maxP: COMMUNISM_MAXP }); } catch (e) {}
      }
    }
  }
  function apply(obj) {
    reset();
    if (!obj || obj.v !== 1 || !obj.perCountry) return;
    const P = g.regimesWorld.perCountry;
    for (const id in obj.perCountry) {
      const src = obj.perCountry[id]; if (!src) continue;
      const s = freshCountryState();
      s.repealDays = src.repealDays || 0; s.miseryDays = src.miseryDays || 0;
      s.anarchyStartDay = src.anarchyStartDay != null ? src.anarchyStartDay : null;
      s.frozenApproval = isFinite(src.frozenApproval) ? +src.frozenApproval : null;
      s.propagandaApplied = !!src.propagandaApplied;
      s.policeForceBumped = !!src.policeForceBumped;
      s._origPoliceForce = isFinite(src.origPoliceForce) ? +src.origPoliceForce : null;
      s.curfewWarnedNight = src.curfewWarnedNight != null ? src.curfewWarnedNight : null;
      P[id] = s;
    }
    reapplyStaticEffects();
  }

  CBZ.regimes = {
    tickCountry, transition, dictatorVacuum, strongmanRestore,
    convertAllCops, convertCop,
    gangBoostMul, policeAllowed, dividendsAllowed,
    maxWarPressure,
    serialize, apply, reset,
    // harness/test hooks only — not part of the public contract.
    _st: st, _findDictatorshipRecordFor: findDictatorshipRecordFor,
    _strongestGang: strongestGang,
    _forceGov: function (id, gov, day) {
      const rec = countryRec(id);
      if (!rec) return null;
      transition(rec, gov, day != null ? day : (CBZ.worldDay ? CBZ.worldDay() : 0), 0);
      return rec;
    },
  };
  CBZ.regimesReset = reset;

  // ============================================================
  //  SINGLE-PLAYER PERSIST — polity.js's own g.cityWorld pattern, verbatim:
  //  stamp before the existing commit/collect save hooks run, hydrate back
  //  out whenever that ledger object's REFERENCE changes. Own guard flag
  //  (_regWrap2 — the cityKillPed wrap above already claims _regWrap), WITH
  //  the P5 chain-growth fix's one-shot install guard (a module-local
  //  boolean checked BEFORE ever wrapping, so re-entering this tick after
  //  some later module has wrapped commit/collect above us can never
  //  re-wrap and grow the chain unboundedly).
  // ------------------------------------------------------------
  function stampRegimes() {
    const led = g.cityWorld;
    if (led && typeof led === "object") led.reg = serialize();
  }
  let _ensureRegimesSaveWraps_done = false;
  function ensureRegimesSaveWraps() {
    if (_ensureRegimesSaveWraps_done) return;
    _ensureRegimesSaveWraps_done = true;
    const commit = CBZ.cityWorldCommit;
    if (typeof commit === "function" && !commit._regWrap2) {
      const w = function () { stampRegimes(); return commit.apply(this, arguments); };
      w._regWrap2 = true; CBZ.cityWorldCommit = w;
    }
    if (CBZ.cityWorldCollect && !CBZ.cityWorldCollect._regWrap2) {
      const col = CBZ.cityWorldCollect;
      const wc = function () { stampRegimes(); return col.apply(this, arguments); };
      wc._regWrap2 = true; CBZ.cityWorldCollect = wc;
    }
  }
  let _hydratedLedger = null;
  function hydrateFromLedger() {
    const led = g.cityWorld;
    if (!led || led === _hydratedLedger) return;
    _hydratedLedger = led;
    if (led.reg) apply(led.reg);
  }
  if (CBZ.onUpdate) {
    // 46.12 — next free slot after elections.js's own 46.11 install-tick.
    CBZ.onUpdate(46.12, function () {
      if (!g) return;
      ensureRegimesSaveWraps();
      hydrateFromLedger();
    });
  }
})();
