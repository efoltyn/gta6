/* ============================================================
   city/militia.js — Stage P, step P7: MILITIA — the escalation rung of the
   ONE PROTECTOR SYSTEM (city/protection.js, P5).

   MASTER-PLAN V.2b (verbatim, the paragraph this file ships): "Militia —
   hired security past a headcount threshold becomes a faction: it needs
   wages (a real funding stream), a base to muster at (the tool-cupboard
   plot), and it inherits the gang machinery — turf capability, the war-shape
   combat formations, treasury, standing. Regimes react to it: fascist
   governments deputize friendly militias, democracies restrict private
   armies (a legal-status heat mechanic), anarchist collapse makes them the
   only law. Former cops and veterans... recruit cheaper and fight better —
   your militia is built out of the simulation's own casualties of history."

   THE CORE MOVE: a ProtectionDetail (protection.js) is payroll bookkeeping —
   memberCount, wageRate, a formation. Past MILITIA_HEADCOUNT it stops being
   that and becomes a REAL entry in CBZ.cityGangs — gangs.js's own war
   director, turf-payday loop, recruit trickle, succession, and defection
   machinery all pick it up FOR FREE the instant it's pushed onto that array
   (exactly how city/playergang.js already mirrors a founded player crew into
   CBZ.cityGangs via a plain object literal with isPlayer:true — this file
   does the identical trick with kind:"militia" + playerOwned instead).
   Nothing in gangs.js is forked or edited to make this work; two ONE-LINE
   guards were added there (launchWar's early-return + the war director's
   `live` aggressor filter) so a militia never LAUNCHES a war on its own,
   the same courtesy playergang.js's isPlayer already gets — it still
   defends turf, gets raided, and can be the anarchist strongman fully,
   because regimes.js's strongestGang() and gangs.js's whole upkeep tick
   (34.5) just scan CBZ.cityGangs, no militia-aware branch required.

   ESCALATION SOURCE: CBZ.protection.details() — every live ProtectionDetail,
   whether the player's own hired security (principal.kind:"player",
   fundingSource:"wallet") or an officeholder's Secret Service
   (principal.kind:"sid", fundingSource:"treasury", id "off_"+polity-rec-id).
   protection.js's HIRE_CAP was raised from 4 to 8 in this same wave (see
   that file's header) specifically so the player's own detail can cross
   MILITIA_HEADCOUNT(6) through ordinary play; officials.js's own country-
   tier Secret Service (base 4, +3 more from repeated attempt-escalation —
   protection.js's notePrincipalHp) can cross it too, under sustained
   assassination pressure — that path is exactly what feeds the "loyalist
   absorption" branch below (an officeholder's OWN guard detail growing into
   a "militia" and immediately folding back into itself under an
   authoritarian regime is the intended, not a leftover, behaviour).

   ADAPTATIONS FROM THE DETAILED WAVE PROMPT (recorded here, not silently):
     - Members are TRANSFERRED bodies, never conjured: escalate() tops up the
       source detail to its current memberCount (protection.js's own
       spawnMembers, so an off-hours/never-materialized detail gets real
       bodies FIRST), then hands those exact ped references to the new gang
       record. The detail's memberPedRefs/memberCount are zeroed (not
       despawned) so it can never double-pay wages for a roster it no longer
       drives — protection.js's own onNewDay wage sweep sees memberCount<=0
       and no-ops. The SAME detail id can escalate again later if the player
       re-hires it back up past the threshold — a second militia, not a cap.
     - "A base to muster at" = ONE seeded turf lot nearest the employer's
       anchor (player position, or the office's own jurisdiction rect centre
       for a sid employer), using the exact nearest-lot claim playergang.js's
       claimTurfAt() already uses (own copy here — that function is a closure
       local to that file, not exported).
     - Regime reactions are read off CBZ.polity/govType directly (this file
       subscribes its OWN CBZ.onNewDay, per the wave prompt's own preference
       for "whichever needs the smaller regimes.js diff" — regimes.js is NOT
       touched at all). A per-militia `lastGov` tracks regime CHANGES so
       "on formation (or on regime entry for an existing militia)" is one
       code path: formation calls the same onGovChange() with lastGov=null.
     - Fascist/dictatorship crackdown is a seeded DAILY chance once "armed"
       (entered that regime) — gated to never fire the same day it arms, so
       formation-under-fascism and the first crackdown roll are always two
       observably different days (deterministic for tests). A harness/dev
       hook (_forceCrackdown) also exists, matching regimes.js's own
       _forceGov test-only precedent.
     - Communist nationalization and loyalist absorption are ONE-SHOT and
       deterministic (no roll) — they fire the instant govType enters that
       state, exactly per "on regime ENTRY."
     - Disband ("employer dies or treasury hits 0"): a sid employer is
       "dead" when CBZ.cityLedgerEntry() no longer finds them (schedule.js's
       own dropSid permanence contract) — the player never permadies in this
       codebase, so that branch is sid-only; treasury<=0 is universal, gated
       to day>formedDay so a freshly-seeded record can never same-tick-
       disband on a rounding fluke.
     - "Security-flagged hireable pool" reuses regimes.js's OWN
       `_formerCopFlavor:"security"` convention verbatim (flag-only, same as
       that file's cop conversion) rather than inventing a parallel tag.
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  // own seeded LCG (never Math.random — repo convention for world state).
  let _seed = 730991143 & 0x7fffffff;
  function rng() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }

  const MILITIA_HEADCOUNT = 6;          // protection.js's HIRE_CAP(8) comfortably clears this
  const MILITIA_COLOR = 0x6b8e23;       // olive drab — reads as "irregulars," not a street gang
  const MILITIA_DEFEND_W = 1.3;         // defends hard...
  const MILITIA_EXPAND_W = 0.7;         // ...but doesn't go looking for turf (see gangs.js press())
  const MILITIA_ROAM_W = 0.4;           // guards, not street freelancers
  const DEMOCRACY_APPROVAL_DIP = 3;     // "private armies scare voters"
  const CRACKDOWN_DAILY_CHANCE = 0.25;
  const CRACKDOWN_APPROVAL_DIP = 2;     // the crackdown itself is a visible use of force
  const ANARCHY_TRICKLE_MIN = 1, ANARCHY_TRICKLE_MAX = 2;

  // ============================================================
  //  STATE — g.militiaWorld.byGangId[gangId] = links/flags ONLY. The gang
  //  record itself lives in CBZ.cityGangs like any other faction; we never
  //  duplicate its turf/members/treasury here except a treasury SNAPSHOT
  //  taken at serialize() time (so a reload can re-seed a fresh shell before
  //  the recruit tick slowly refills it).
  // ============================================================
  function state() {
    if (!g.militiaWorld) g.militiaWorld = { byGangId: Object.create(null), nextId: 1 };
    return g.militiaWorld;
  }
  function reset() { g.militiaWorld = { byGangId: Object.create(null), nextId: 1 }; }

  // ============================================================
  //  ANCHOR / JURISDICTION — where a militia's "base" and "home country" are,
  //  read off the EMPLOYER (player position, or the office's own polity rect
  //  centre for a sid employer), never off the transient gang.center (which
  //  only exists once turf is seeded).
  // ============================================================
  function anchorFor(employerKind, officeId, gang) {
    if (employerKind === "player") {
      const P = CBZ.player;
      if (P && P.pos) return { x: P.pos.x, z: P.pos.z };
    }
    if (officeId && CBZ.polity && CBZ.polity.get) {
      const rec = CBZ.polity.get(officeId);
      if (rec && rec.rect) return { x: rec.rect.cx, z: rec.rect.cz };
    }
    if (gang && gang.center && (gang.center.x || gang.center.z)) return { x: gang.center.x, z: gang.center.z };
    return { x: 0, z: 0 };
  }
  function countryRecFor(mrec, gang) {
    if (mrec.officeId && CBZ.polity && CBZ.polity.countryOf) {
      const c = CBZ.polity.countryOf(mrec.officeId);
      if (c) return c;
    }
    const a = anchorFor(mrec.employerKind, mrec.officeId, gang);
    if (a && CBZ.polity && CBZ.polity.of && CBZ.polity.countryOf) {
      const loc = CBZ.polity.of(a.x, a.z);
      if (loc) { const c = CBZ.polity.countryOf(loc.id); if (c) return c; }
    }
    return CBZ.polity && CBZ.polity.get ? CBZ.polity.get("republic") : null;
  }
  function homeCityId(mrec, gang) {
    const a = anchorFor(mrec.employerKind, mrec.officeId, gang);
    if (a && CBZ.polity && CBZ.polity.of) { const loc = CBZ.polity.of(a.x, a.z); if (loc) return loc.id; }
    if (mrec.officeId) return mrec.officeId;
    return null;
  }
  function govFor(mrec, gang) {
    const c = countryRecFor(mrec, gang);
    return (c && c.govType) || "democracy";
  }
  function isEmployerOfficeholder(mrec) {
    if (mrec.employerKind !== "sid" || mrec.employerRef == null || !CBZ.polity) return false;
    if (mrec.officeId) {
      const rec = CBZ.polity.get(mrec.officeId);
      if (rec && rec.office && rec.office.holder === mrec.employerRef) return true;
    }
    const kinds = ["city", "state", "country", "federal"];
    for (let i = 0; i < kinds.length; i++) {
      const recs = CBZ.polity.list ? CBZ.polity.list(kinds[i]) : [];
      for (let j = 0; j < recs.length; j++) { const r = recs[j]; if (r.office && r.office.holder === mrec.employerRef) return true; }
    }
    return false;
  }
  function nameFor(mrec, gang) {
    const cid = homeCityId(mrec, gang);
    const loc = cid && CBZ.polity && CBZ.polity.get ? CBZ.polity.get(cid) : null;
    const base = (loc && loc.name) ? loc.name : "The";
    return mrec.playerOwned ? (base + " Irregulars") : (base + " Militia");
  }

  // ============================================================
  //  TURF — one seeded lot nearest the anchor (playergang.js's own
  //  claimTurfAt() nearest-lot pick, copied — that function is a closure
  //  local to that file, not exported).
  // ============================================================
  function seedTurf(gang, anchor) {
    const A = CBZ.city && CBZ.city.arena; if (!A) return;
    const pool = (A.abandonedLots && A.abandonedLots.length) ? A.abandonedLots : (A.lots || []);
    if (!pool || !pool.length) return;
    let best = null, bd = Infinity;
    for (let i = 0; i < pool.length; i++) {
      const lot = pool[i]; if (lot.building && lot.building.gang) continue;   // prefer unclaimed
      const dx = lot.cx - anchor.x, dz = lot.cz - anchor.z, dd = dx * dx + dz * dz;
      if (dd < bd) { bd = dd; best = lot; }
    }
    if (!best) {   // fall back to the nearest lot regardless (a militia still needs a literal home block)
      bd = Infinity;
      for (let i = 0; i < pool.length; i++) {
        const lot = pool[i]; const dx = lot.cx - anchor.x, dz = lot.cz - anchor.z, dd = dx * dx + dz * dz;
        if (dd < bd) { bd = dd; best = lot; }
      }
    }
    if (!best) return;
    if (gang.turf.indexOf(best) < 0) gang.turf.push(best);
    best.building = best.building || {};
    best.building.gang = gang.id; best.building.gangColor = gang.color; best.building.playerTurf = !!gang.playerOwned;
    gang.hq = { x: best.cx, z: best.cz, lot: best, name: gang.name + " HQ" };
    gang.center = { x: best.cx, z: best.cz };
  }
  function releaseTurf(gang) {
    const turf = gang.turf || [];
    for (let i = 0; i < turf.length; i++) {
      const lot = turf[i];
      if (lot.building) { lot.building.gang = null; lot.building.gangColor = null; lot.building.playerTurf = false; }
    }
    gang.turf = [];
  }
  function removeFromCityGangs(gid) {
    if (!CBZ.cityGangs) return;
    for (let i = CBZ.cityGangs.length - 1; i >= 0; i--) if (CBZ.cityGangs[i].id === gid) { CBZ.cityGangs.splice(i, 1); break; }
  }

  // ============================================================
  //  MEMBER TRANSITIONS — persistent-population principle: NEVER despawned.
  //  Strip gang/faction tags and hand off a flavor. "security" reuses
  //  regimes.js's own `_formerCopFlavor` convention verbatim.
  // ============================================================
  function releaseMember(ped, flavor) {
    if (!ped) return;
    ped.gang = null; ped.faction = null; ped.rank = null;
    ped.guard = null; ped.rage = null; ped.hunting = false; ped.isBoss = false;
    ped._formerCopFlavor = flavor;
    if (flavor === "gang" && CBZ.cityNearestRivalHQ && CBZ.cityGangById && ped.pos) {
      const hq = CBZ.cityNearestRivalHQ(ped.pos.x, ped.pos.z, null);
      const gg = hq ? CBZ.cityGangById(hq.id) : null;
      if (gg) gg.recruitPool = (gg.recruitPool || 0) + 1;
    }
  }
  // weighted buckets (e.g. [{p:0.4,flavor:"security"},{p:0.3,flavor:"gang"}])
  // — whatever probability mass is left over falls to "home" (plain civilian).
  function releaseMembers(list, gang, buckets) {
    for (let i = 0; i < list.length; i++) {
      const ped = list[i]; if (!ped) continue;
      const r = rng(); let acc = 0, flavor = "home";
      for (let b = 0; b < buckets.length; b++) { acc += buckets[b].p; if (r < acc) { flavor = buckets[b].flavor; break; } }
      releaseMember(ped, flavor);
    }
    gang.members = [];
  }

  // ============================================================
  //  ESCALATION — ProtectionDetail -> real CBZ.cityGangs faction.
  // ============================================================
  function seedTreasury(detail) {
    const wage = detail.wageRate || 10;
    const mc = detail.memberCount || MILITIA_HEADCOUNT;
    return Math.max(400, Math.round(mc * wage * 12));   // "seeds from the employer's payroll budget"
  }
  function formMilitia(detail, bodies, anchor) {
    const S = state();
    const gangId = "mil" + (S.nextId++);
    const mrec = {
      employerKind: detail.principal.kind, employerRef: detail.principal.ref != null ? detail.principal.ref : null,
      officeId: detail.id.indexOf("off_") === 0 ? detail.id.slice(4) : null,
      detailId: detail.id, playerOwned: detail.principal.kind === "player",
      lastGov: null, crackdownArmed: false, crackdownArmedDay: 0,
      disbanded: false, absorbed: false, nationalized: false, crackedDown: false,
      formedDay: CBZ.worldDay ? CBZ.worldDay() : 0, name: null, color: MILITIA_COLOR,
    };
    S.byGangId[gangId] = mrec;
    mrec.name = nameFor(mrec, null);

    const gang = {
      id: gangId, name: mrec.name, color: MILITIA_COLOR,
      turf: [], center: { x: anchor.x, z: anchor.z }, provoke: 0,
      members: [], boss: null, bossName: null, bossDead: false,
      warWith: null, warRemain: 0, warIntensity: 0,
      treasury: seedTreasury(detail), hostility: 0, strikeT: 0, lostTurfT: 0, peakTurf: 0,
      hq: null, standing: 0, absorbed: false,
      kind: "militia", playerOwned: mrec.playerOwned,
      defendW: MILITIA_DEFEND_W, expandW: MILITIA_EXPAND_W, roamW: MILITIA_ROAM_W,
      recruitPool: Math.max(1, Math.round(bodies.length * 0.5)),
      rosterCap: bodies.length + 2,
      recruitInterval: 30, recruitT: 30, lastDownT: 0,
    };
    // THE GANG LADDER IS gangs.js's, NOT OURS. `"lt"` and `"soldier"` were
    // hand-typed here — the ninth and tenth copies of an order CLAUDE.md's
    // census already counts eight times across six files. Read the declared
    // ladder; keep the literals only as the degrade-safe fallback.
    const gl = (CBZ.factions && CBZ.factions.ladderKeys) ? (CBZ.factions.ladderKeys("gang") || []) : [];
    // second from the top that merit can reach (gangs.js locks "boss" to
    // succession), and the middle of the ladder for everyone else.
    const LEAD = gl.length >= 2 ? gl[gl.length - 2] : "lt";
    const RANKER = gl.length >= 4 ? gl[Math.max(0, Math.floor((gl.length - 1) / 2))] : "soldier";
    for (let i = 0; i < bodies.length; i++) {
      const ped = bodies[i];
      ped.gang = gangId; ped.faction = gangId; ped.rank = i === 0 ? LEAD : RANKER;
      ped.homeGuard = { x: anchor.x, z: anchor.z }; ped.guard = { x: anchor.x, z: anchor.z };
      const ms = CBZ.cityMemberStats ? CBZ.cityMemberStats(ped) : null;
      if (ms) ms.joined = "militia";
      gang.members.push(ped);
    }
    CBZ.cityGangs.push(gang);
    seedTurf(gang, anchor);

    // retire the source detail WITHOUT despawning the bodies just transferred
    // — protection.js's own onNewDay wage sweep sees memberCount<=0 and skips.
    detail.memberPedRefs = [];
    detail.memberCount = 0;

    const label = mrec.playerOwned ? "Your hired security has grown into a real militia" : "A protection detail has grown into a real militia";
    if (CBZ.cityFeed) CBZ.cityFeed("" + label + ": " + gang.name + " (" + bodies.length + " strong).", "#ffd76a");
    if (mrec.playerOwned && CBZ.city && CBZ.city.big) CBZ.city.big("MILITIA FORMED: " + gang.name.toUpperCase());

    // formation-time regime reaction ("on formation, or on regime entry" —
    // one code path: lastGov starts null, so this always reads as "entry").
    const gov = govFor(mrec, gang);
    onGovChange(gangId, gang, mrec, gov, mrec.formedDay);
    mrec.lastGov = gov;
    return gang;
  }
  function tryEscalate(detail) {
    if (!detail || (detail.memberCount || 0) < MILITIA_HEADCOUNT) return null;
    const A = CBZ.city && CBZ.city.arena; if (!A) return null;
    const officeId = detail.id.indexOf("off_") === 0 ? detail.id.slice(4) : null;
    const anchor = anchorFor(detail.principal.kind, officeId, null);
    if (CBZ.protection && CBZ.protection.spawnMembers) CBZ.protection.spawnMembers(detail, A, anchor.x, anchor.z, rng);
    const bodies = (detail.memberPedRefs || []).filter(function (p) { return p && !p.dead; });
    if (bodies.length < MILITIA_HEADCOUNT) return null;   // couldn't field enough live bodies this tick — retry tomorrow
    return formMilitia(detail, bodies, anchor);
  }

  // ============================================================
  //  REGIME REACTIONS
  // ============================================================
  function onGovChange(gid, gang, mrec, gov, day) {
    if (gov === "democracy") {
      if (CBZ.cityFeed) CBZ.cityFeed("" + gang.name + " registers as a private security force, legal, but watched.", "#ffd76a");
      const home = homeCityId(mrec, gang);
      if (home && CBZ.approvalShock) CBZ.approvalShock(home, -DEMOCRACY_APPROVAL_DIP);
    } else if (gov === "fascism" || gov === "dictatorship") {
      if (isEmployerOfficeholder(mrec)) {
        absorbLoyalist(gid, gang, mrec);
      } else {
        mrec.crackdownArmed = true; mrec.crackdownArmedDay = day;
        if (CBZ.cityFeed) CBZ.cityFeed("" + gang.name + " is now an unsanctioned militia, the regime is watching.", "#ff9e6b");
      }
    } else if (gov === "communism") {
      nationalize(gid, gang, mrec);
    } else if (gov === "anarchism") {
      if (CBZ.cityFeed) CBZ.cityFeed("" + gang.name + " thrives in the vacuum, recruits are lining up.", "#ffd76a");
    }
  }
  // A CRACKDOWN NEEDS SOMEBODY WHO CAN ORDER ONE. This is the General's rung
  // (ARMY_LADDER grants "crackdown"), and it is the only verb on the ladder
  // above Lieutenant — which is why the Chief of the General Staff standing at
  // the Defence HQ is a person worth finding, and worth killing. With the chair
  // empty, an unsanctioned militia simply is not broken up. Degrade-safe: with
  // the rank layer absent the answer is the old unconditional yes.
  function crackdownAuthorised() {
    if (!CBZ.rankHolder || !CBZ.rankKnows || !CBZ.rankKnows(ARMY_ID, "crackdown")) return true;
    return !!CBZ.rankHolder(ARMY_ID, "crackdown");
  }
  function tickGovEffects(gid, gang, mrec, gov, day) {
    if ((gov === "fascism" || gov === "dictatorship") && mrec.crackdownArmed) {
      if (day > (mrec.crackdownArmedDay || 0) && rng() < CRACKDOWN_DAILY_CHANCE && crackdownAuthorised()) crackdown(gid, gang, mrec);
    } else if (gov === "anarchism") {
      gang.recruitPool = (gang.recruitPool || 0) + ANARCHY_TRICKLE_MIN + Math.floor(rng() * (ANARCHY_TRICKLE_MAX - ANARCHY_TRICKLE_MIN + 1));
    }
  }
  function absorbLoyalist(gid, gang, mrec) {
    mrec.disbanded = true; mrec.absorbed = true;
    const det = mrec.officeId && CBZ.protection && CBZ.protection.get ? CBZ.protection.get("off_" + mrec.officeId) : null;
    const members = (gang.members || []).slice();
    if (det) {
      for (let i = 0; i < members.length; i++) {
        const m = members[i];
        m.gang = null; m.faction = null; m.rank = null; m.guard = null; m.rage = null; m.hunting = false;
        det.memberPedRefs.push(m);
      }
      det.memberCount = (det.memberCount || 0) + members.length;
      gang.members = [];
    } else {
      releaseMembers(members, gang, [{ p: 1, flavor: "security" }]);   // no live detail to fold into — hireable pool instead of losing them
    }
    const country = countryRecFor(mrec, gang);
    if (country) country.treasury = (country.treasury || 0) + Math.round(gang.treasury || 0);
    releaseTurf(gang);
    removeFromCityGangs(gid);
    if (CBZ.cityFeed) CBZ.cityFeed("" + gang.name + " folds loyally into the state's own protection detail.", "#8fe08a");
  }
  function nationalize(gid, gang, mrec) {
    mrec.disbanded = true; mrec.nationalized = true;
    const n = (gang.members || []).length;
    for (let i = 0; i < gang.members.length; i++) {
      const m = gang.members[i];
      m.gang = null; m.faction = null; m.rank = null; m.guard = null; m._formerCopFlavor = "nationalized";
    }
    gang.members = [];
    if (CBZ.cityPoliceForceAdd) CBZ.cityPoliceForceAdd(n);
    const country = countryRecFor(mrec, gang);
    if (country) country.treasury = (country.treasury || 0) + Math.round(gang.treasury || 0);
    releaseTurf(gang);
    removeFromCityGangs(gid);
    if (CBZ.cityFeed) CBZ.cityFeed("" + gang.name + " nationalized · " + n + " personnel fold into the police, its treasury seized.", "#8fe08a");
  }
  function crackdown(gid, gang, mrec) {
    mrec.disbanded = true; mrec.crackedDown = true;
    const bossName = (gang.boss && gang.boss.name) || "their leader";
    const members = (gang.members || []).slice();
    releaseMembers(members, gang, [{ p: 0.3, flavor: "gang" }]);   // remaining 70% -> civilian
    releaseTurf(gang);
    removeFromCityGangs(gid);
    const home = homeCityId(mrec, gang);
    if (home && CBZ.approvalShock) CBZ.approvalShock(home, -CRACKDOWN_APPROVAL_DIP);
    if (CBZ.cityFeed) CBZ.cityFeed("The regime cracks down on " + gang.name + " · scattered, but " + bossName + " won't forget this.", "#ff6a5e");
  }
  function disband(gid, gang, mrec, reason) {
    mrec.disbanded = true;
    const members = (gang.members || []).slice();
    releaseMembers(members, gang, [{ p: 0.4, flavor: "security" }, { p: 0.3, flavor: "gang" }]);   // remaining 30% -> civilian
    releaseTurf(gang);
    removeFromCityGangs(gid);
    if (CBZ.cityFeed) CBZ.cityFeed("" + gang.name + " disbands (" + (reason === "employer" ? "employer gone" : "treasury exhausted") + "), its people scatter, never vanish.", "#ff9e6b");
  }
  function checkDisband(gid, gang, mrec, day) {
    let employerGone = false;
    if (mrec.employerKind === "sid" && mrec.employerRef != null) {
      employerGone = !(CBZ.cityLedgerEntry && CBZ.cityLedgerEntry(mrec.employerRef));
    }
    const broke = (gang.treasury || 0) <= 0 && day > mrec.formedDay;
    if (employerGone || broke) { disband(gid, gang, mrec, employerGone ? "employer" : "broke"); return true; }
    return false;
  }

  // ============================================================
  //  DAILY TICK — escalate eligible details, then react per surviving militia.
  // ============================================================
  function tickAll(day) {
    if (CBZ.protection && CBZ.protection.details) {
      const list = CBZ.protection.details();
      for (let i = 0; i < list.length; i++) { try { tryEscalate(list[i]); } catch (e) { try { console.error("[militia] escalate failed", e); } catch (e2) {} } }
    }
    const S = state();
    for (const gid in S.byGangId) {
      const mrec = S.byGangId[gid];
      if (mrec.disbanded) continue;
      const gang = CBZ.cityGangById ? CBZ.cityGangById(gid) : null;
      if (!gang) { mrec.disbanded = true; continue; }
      if (checkDisband(gid, gang, mrec, day)) continue;
      const gov = govFor(mrec, gang);
      if (gov !== mrec.lastGov) { onGovChange(gid, gang, mrec, gov, day); mrec.lastGov = gov; }
      if (!mrec.disbanded) tickGovEffects(gid, gang, mrec, gov, day);
    }
  }
  if (CBZ.onNewDay) CBZ.onNewDay(function (day) { tickAll(day); });

  // ============================================================
  //  PUBLIC API
  // ============================================================
  function list() {
    const S = state(); const out = [];
    for (const gid in S.byGangId) { const m = S.byGangId[gid]; if (!m.disbanded) out.push(Object.assign({ gangId: gid }, m)); }
    return out;
  }
  function isMilitia(gid) { const S = state(); return !!(S.byGangId[gid] && !S.byGangId[gid].disbanded); }

  // ============================================================
  //  THE ARMY — "join the military" (owner's ask, 2026-07-26).
  //
  //  Before this block the repo had NO enlist path of any kind: grepping
  //  `join.*milit|enlist` across src/ returned zero hits, and militia.js
  //  itself set ped.rank ONCE at formation (line ~285) with no promotion
  //  function anywhere in the file. The census called this out as "has to be
  //  built from scratch, most naturally by copying gangs.js's RANKS a SEVENTH
  //  time unless a shared primitive exists first."
  //
  //  It does now. This is the whole thing — a declare() call and a zone:
  //  no new ladder array, no new membership field, no new promotion function,
  //  no new pay path, no new HUD. The ladder is factions.js's; the pay is
  //  CBZ.city.addCash; the verb is interactions.js; the jobs come from
  //  city/contracts.js. What is genuinely NEW here is a recruiting post at
  //  a REAL world position and five rank names.
  //
  //  ANCHOR (no stat fictions): the enlist zone exists only if
  //  CBZ._militaryBase does — the actual Fort Brandt build in
  //  city/island_military.js, which publishes {center,minX,maxX,minZ,maxZ}
  //  at :1256. No base in the loaded world → no recruiting post, rather than
  //  a menu that claims one.
  // ============================================================
  const ARMY_ID = "army";
  // ============================================================
  //  THE ARMY LADDER — ONE ladder, and every rung on it opens a verb.
  //
  //  WHAT WAS HERE BEFORE, AND WHAT WAS IN level.js: two military ladders that
  //  had never met. This file declared five bare strings (Recruit…Lieutenant)
  //  for the PLAYER's career; level.js separately carried MIL_NAME/MIL_LVL, an
  //  EIGHT-rung display table (…Captain, Major, Colonel, General) stamped onto
  //  NPCs by peds.js, unlocking nothing whatsoever — CLAUDE.md's census called
  //  it "the largest ladder in the repo is pure display". They shared four rank
  //  NAMES and no code.
  //
  //  They are one ladder now, declared here, and level.js reads it. Which
  //  forced the honest question on every rung the merge inherited, because
  //  CLAUDE.md's rule is binding: "every rung must unlock a VERB, not just a
  //  bigger number." Three rungs could not answer it and are DELETED:
  //
  //    Captain · Major · Colonel — CUT. Between "leads a platoon" and "commands
  //    the army" there is no verb in this game that one of them has and the
  //    others do not, and every candidate I could name (a sortie, an air
  //    request, a district lockdown) lives in island_military.js /
  //    strategic.js / checkpoints.js — files this change does not own, so
  //    declaring the rung here would have been a promise made in someone else's
  //    file. Three numbers deleted beats three numbers shipped.
  //
  //  What each surviving rung actually opens (all enforced, none aspirational):
  //    Recruit     army:sweep        contracts.js minRank 0
  //    Private     army:armour       contracts.js minRank 1
  //    Corporal    army:ferry        contracts.js minRank 2
  //    Sergeant    army:strike       contracts.js minRank 3
  //                enlist            THIS FILE — the recruiting desk needs an
  //                                  NCO; a private cannot swear you in
  //                vouch             level.js — sees through a military cover
  //                post              city/garrison.js — MOUNTS THE GUARD. Every
  //                                  standing sentry in the game names {org:
  //                                  "army", verb:"post"} as its author, and a
  //                                  post whose author is dead is orphaned,
  //                                  goes relaxed and is struck. Detailing a
  //                                  man to a slot is an NCO's job in every
  //                                  army that has ever existed, and the
  //                                  Sergeant of the Guard is a body standing
  //                                  at the gate you can walk up to and shoot.
  //    Lieutenant  army:carpet       contracts.js minRank 4
  //                standto           city/garrison.js — ORDERS THE WIRE HOT.
  //                                  The rung that separates a lieutenant from
  //                                  a sergeant, and the one this file's own
  //                                  header said it could not name in 2026-07:
  //                                  it lives in garrison.js now, so the rung
  //                                  is no longer a promise made in somebody
  //                                  else's file. With no holder alive the
  //                                  sentries WATCH and never draw — a
  //                                  perimeter with no officer is a perimeter
  //                                  that cannot go weapons-up, which you can
  //                                  see from outside the fence.
  //    General     crackdown         THIS FILE — the ONE rung that can order an
  //                                  unsanctioned militia disarmed. He is a
  //                                  real, findable person: govcomplex.js's
  //                                  Defence HQ principal, the Chief of the
  //                                  General Staff. Kill him and private
  //                                  armies stop being broken up.
  //
  //  REACHABILITY. The old General was drawn at 0.3% PER BODY off the seeded
  //  stream, so a seed whose garrison never rolled r() > 0.997 had no general
  //  at all, forever — the top of the biggest ladder in the game was unreachable
  //  BY CONSTRUCTION. peds.js now assigns military rank by ROSTER SLOT (a unit
  //  is a pyramid, and a pyramid is a roster), so a garrison has a commander the
  //  moment it has bodies; and level.js derives the rung of the Defence HQ
  //  officeholder from the power tier he was already declared at.
  //
  //  `locked` on General is factions.js's own vocabulary for "never granted by
  //  merit" — the same rule that makes gangs.js's Boss a succession, not a
  //  grind. You do not get four stars for running errands.
  // ============================================================
  const ARMY_LADDER = [
    { key: "recruit",    pip: "Recruit",    lvl: 12 },
    { key: "private",    pip: "Private",    lvl: 15 },
    { key: "corporal",   pip: "Corporal",   lvl: 20 },
    { key: "sergeant",   pip: "Sergeant",   lvl: 27, grants: ["enlist", "vouch", "post"] },
    { key: "lieutenant", pip: "Lieutenant", lvl: 36, grants: ["standto"],
      unlock: "Guard authority: the perimeter may go weapons-up on your word." },
    { key: "general",    pip: "General",    lvl: 85, locked: true, grants: ["crackdown", "vouch"],
      unlock: "Command authority: an unsanctioned militia can be ordered disarmed." },
  ];
  // ARMY_ENLIST — the player-facing half of this file: the declared Garrison
  // faction and its recruiting post. Off -> no declare(), no zone, no enlist
  // verb, and city/contracts.js's four army templates simply never post
  // (their faction stops existing). The NPC militia-escalation sim above is
  // untouched either way. Flip false (or ?cfg_ARMY_ENLIST=0) for a one-line
  // revert to the exact prior behaviour.
  if (CBZ.CONFIG) { if (CBZ.CONFIG.ARMY_ENLIST == null) CBZ.CONFIG.ARMY_ENLIST = true; }
  function armyOn() { return !CBZ.CONFIG || CBZ.CONFIG.ARMY_ENLIST !== false; }
  function declareArmy() {
    if (!armyOn()) return;
    if (!CBZ.factions || !CBZ.factions.declare) return;
    if (CBZ.factions.exists(ARMY_ID)) return;
    CBZ.factions.declare({
      id: ARMY_ID,
      name: "Fort Brandt Garrison",
      short: "Garrison",
      kind: "military",
      color: 0x6b8e23,
      // ONE ladder for the whole army — the player's career AND the chain of
      // command the world casts. See ARMY_LADDER above for what each rung
      // opens and which three were cut for opening nothing.
      ranks: ARMY_LADDER,
      // NO PARALLEL BOOKKEEPING: an NPC's rank stays in `milRank`, the field
      // peds.js has always written and level.js has always read.
      rankField: "milRank",
      // seniority (seconds in uniform) AND carried-out orders — you cannot
      // wait your way up and you cannot shoot your way up alone.
      needScale: { served: 240, orders: 2, bodies: 0, contrib: 0 },
      wage: 220,                    // REAL cash, paid on CBZ.onNewDay
      heat: 0.7,                    // a uniform makes witnesses quieter
      hostileTo: ["cell", "gang"],
      friendlyTo: ["agency"],
      // the REAL field the world already stamps on every garrison body:
      // island_military.js:1061 sets `p.organization = "military"` on each
      // trooper it spawns. So CBZ.factions.of(thatSoldier) -> ["army"] and
      // reactionTo(player, soldier) is a live query against real NPCs with no
      // extra tagging pass anywhere.
      npcTag: { field: "organization", value: "military" },
      admission: {
        cleanRecord: true,          // they don't take you with stars up
        test: function (F) {
          if (F.isMember("cell")) return "Not with your file. Word travels.";
          return true;
        },
      },
      lore: "A standing garrison. Enlist, take orders, get paid on the first of every day.",
      onJoin: function () {
        // Say where the work comes from. "Orders come by phone" was a lie —
        // there is no inbound channel; orders come off the ORDERS BOARD at
        // this same desk (contracts.js's openBoard), and a recruit who does
        // not know that never credits an order and never leaves Recruit.
        // opts.from is mandatory: mode.js's phoneWorthy() deletes any note
        // without a named sender or an "important" keyword (mode.js:101-115).
        if (CBZ.city && CBZ.city.note) CBZ.city.note("Sworn in. Orders are posted at this desk, report in whenever you want work.", 3.4, { from: "GARRISON OPS", app: "missions" });
      },
      onLeave: function () {
        if (CBZ.city && CBZ.city.note) CBZ.city.note("Discharged. Hand the rifle back.", 2.4, { from: "GARRISON OPS", app: "missions" });
      },
    });
  }

  // The recruiting post: one interactions.js zone at the base's own centre.
  // No keybinding, no menu, no HUD — the same registerZone every venue in the
  // repo already uses (18 adopter files).
  let armyZoneUp = false;
  function wireArmyZone() {
    if (armyZoneUp || !armyOn()) return;
    if (!CBZ.interactions || !CBZ.interactions.registerZone) return;
    const B = CBZ._militaryBase;
    if (!B || !B.center) return;                 // no base built → no post
    const F = function () { return CBZ.factions; };
    // The fallback token IS the base centre (island_military.js publishes
    // {center,minX..maxZ} and nothing finer). In practice you almost never
    // meet it: find() prefers any live garrison body within R, and the base is
    // staffed. It is the "the yard is empty" backstop, not the desk.
    const tok = { x: B.center.x, z: B.center.z, kind: "recruiter" };
    const R = 8.0;
    CBZ.interactions.registerZone({
      id: "army-recruiter", kind: "recruiter", radius: R,
      // prio feeds interactions.js's candidate score directly (`base: z.prio`,
      // interactions.js:454). The recruiter returns the SAME ped object the
      // street-verb source is already pushing, so without a prio above the ped
      // layer the enlist card loses the coin-flip to "Talk" and the only door
      // into the army in the game is invisible. 14 clears interact.js's own
      // highest zone (zone-club, prio 11).
      prio: 14,
      // The recruiter is a REAL soldier when the base has one standing near
      // you (island_military.js publishes its garrison as
      // CBZ.cityMilitaryPersonnel) and the apron itself otherwise. Either way
      // it is a place that exists in the world, never a menu entry — and you
      // are talking to a body whenever the world supplies one.
      find: function (px, pz) {
        // ON THE BASE, or nowhere. Troops are not confined to Fort Brandt —
        // island_military.js sorties a squad into the city at 5 stars, and
        // without this rect test a soldier hunting you through a manhunt was a
        // walking recruiting desk. Enlistment happens at the post.
        const pad = 40;
        if (px < B.minX - pad || px > B.maxX + pad || pz < B.minZ - pad || pz > B.maxZ + pad) return null;
        // SWEARING SOMEBODY IN IS AN NCO'S JOB (ARMY_LADDER grants "enlist" at
        // Sergeant). A private standing on the apron cannot enlist you — he can
        // point you at the desk, which is exactly what the token fallback below
        // is. So the desk still always works and nobody is ever locked out; what
        // changed is that the BODY you talk to has to be somebody whose rank
        // means something, which is the whole point of having ranks.
        const troops = CBZ.cityMilitaryPersonnel || [];
        let best = null, bestD = R * R;
        for (let i = 0; i < troops.length; i++) {
          const t = troops[i];
          if (!t || t.dead || !t.pos) continue;
          if (CBZ.rankKnows && CBZ.rankKnows(ARMY_ID, "enlist") &&
              !CBZ.rankCan(t, ARMY_ID, "enlist")) continue;
          const dx = t.pos.x - px, dz = t.pos.z - pz;
          const d = dx * dx + dz * dz;
          if (d < bestD) { bestD = d; best = t; }
        }
        if (best) return best;
        const dx = tok.x - px, dz = tok.z - pz;
        return (dx * dx + dz * dz) < R * R ? tok : null;
      },
      options: [
        {
          id: "army-enlist", slot: "e",
          // forceYes BYPASSES THE SOCIAL STANDING GATE, and it has to.
          // interactions.js:235 standingGates() applies to any HUMAN target
          // whose id+label matches SOCIAL_ID — which includes /recruit/. Our
          // find() prefers a live trooper over the apron token, `label` is a
          // FUNCTION so String(label) stringifies its source (containing
          // "Recruiting desk"), and the match fires. interactions.js:392 then
          // refuses onSelect entirely unless canInfluence, i.e. score
          // 50 + (playerLv - targetLv) * 2.25 >= 25. A trooper reads Lv.15
          // (level.js:66-71) and a fresh unarmed player Lv.1 → 18.5. So a new
          // player standing in front of a soldier was silently refused, while
          // the same player standing on empty tarmac (token target, not human)
          // enlisted fine. Enlisting is paperwork, not a charisma check.
          forceYes: true,
          label: function () {
            const f = F(); if (!f) return "Recruiting desk";
            if (f.isMember(ARMY_ID)) return "Report in · " + f.rankName(ARMY_ID, f.rank(ARMY_ID));
            return "Enlist. Fort Brandt Garrison";
          },
          canShow: function () { return !!F(); },
          onSelect: function () {
            const f = F(); if (!f) return;
            if (f.isMember(ARMY_ID)) {
              // Reporting in = asking for work. contracts.js answers with the
              // ORDERS BOARD — every job this rank opens, plus the ones the
              // next rung will, greyed with the rank that opens them. It used
              // to call brief(), which took ONE job chosen by a per-day hash:
              // a Sergeant asking for work got the same perimeter sweep all
              // day and never saw the airstrike his rank had just unlocked.
              if (CBZ.cityOrderBoard) CBZ.cityOrderBoard(ARMY_ID);
              else if (CBZ.cityOrders && CBZ.cityOrders.brief) CBZ.cityOrders.brief(ARMY_ID);
              else if (CBZ.city && CBZ.city.note) CBZ.city.note("Nothing on the board today.", 2, { from: "GARRISON OPS", app: "missions" });
              return;
            }
            const c = f.canJoin(ARMY_ID);
            if (!c.ok) { if (CBZ.city && CBZ.city.note) CBZ.city.note(c.why, 2.6, { from: "GARRISON OPS", app: "missions" }); return; }
            f.join(ARMY_ID, "enlisted");
          },
        },
        // (No discharge option here. `slot:"j"` cannot be pressed:
        //  interactions.js builds exactly one row and hard-codes its key to
        //  "e" (interactions.js:300-306) — `slot` is a +18 tiebreak, not a
        //  keybinding — and `bad:true` costs a further -240 on the choice
        //  score. This verb was the ONLY caller of factions.leave("army") in
        //  the repo, so enlistment was a one-way door that also permanently
        //  locked you out of every gang via ARMY's hostileTo. Discharge is on
        //  the orders board now, which has a working click handler.)
      ],
    });
    armyZoneUp = true;
  }
  declareArmy();
  // the base is built during world generation, which may land after this file
  // parses — retry on the cheap until it exists, then never again.
  if (CBZ.onUpdate) {
    CBZ.onUpdate(CBZ.PRIO ? CBZ.PRIO.after(CBZ.PRIO.INTERACT, 60) : 39.6, function () {
      if (armyZoneUp) return;
      declareArmy();
      wireArmyZone();
    });
  }

  CBZ.militia = {
    MILITIA_HEADCOUNT,
    tryEscalate, tick: tickAll, list, isMilitia, reset,
    ARMY_ID: ARMY_ID,
    // ORDER A CRACKDOWN — the public door on the verb the General's rung
    // already grants (city/presidency.js's Situation Room presses it; the
    // head of state outranks the General, but the ORDER still needs a
    // living holder to carry it out). Degrade-safe guard is rankKnows,
    // never a bare rankCan null-check (doctrine): an undeclared ladder
    // stands the gate DOWN; a declared ladder with an empty General's
    // chair REFUSES — the brass are people you can find, and kill.
    orderCrackdown: function (gid, opts) {
      const S = state();
      const mrec = S.byGangId[gid];
      const gang = CBZ.cityGangById ? CBZ.cityGangById(gid) : null;
      if (!mrec || !gang || mrec.disbanded) return { ok: false, why: "No such militia stands." };
      if (CBZ.rankKnows && CBZ.rankHolder && CBZ.rankKnows(ARMY_ID, "crackdown") && !CBZ.rankHolder(ARMY_ID, "crackdown")) {
        return { ok: false, why: "Nobody alive holds the authority to carry it out." };
      }
      crackdown(gid, gang, mrec);
      void opts;
      return { ok: true, why: "", gangId: gid };
    },
    // harness/test-only hooks — not part of the public contract (mirrors
    // regimes.js's own _forceGov/_st precedent).
    _state: state, _anchorFor: anchorFor, _govFor: govFor, _countryRecFor: countryRecFor,
    _isEmployerOfficeholder: isEmployerOfficeholder,
    _forceCrackdown: function (gid) {
      const S = state(); const mrec = S.byGangId[gid]; const gang = CBZ.cityGangById ? CBZ.cityGangById(gid) : null;
      if (mrec && gang && !mrec.disbanded) crackdown(gid, gang, mrec);
    },
  };
  CBZ.militiaReset = reset;

  // ============================================================
  //  PERSISTENCE — links/flags ONLY (the gang record itself lives however
  //  CBZ.cityGangs already does; a militia gang isn't config-seeded, so on
  //  restore we rebuild a minimal shell — turf/members re-materialize lazily
  //  through the exact same "physical presence is runtime-only" convention
  //  every other P-wave file uses, via gangs.js's own recruit tick once the
  //  shell is back on CBZ.cityGangs).
  // ============================================================
  function serialize() {
    const S = state();
    const out = {};
    for (const gid in S.byGangId) {
      const m = S.byGangId[gid];
      const gang = CBZ.cityGangById ? CBZ.cityGangById(gid) : null;
      out[gid] = {
        employerKind: m.employerKind, employerRef: m.employerRef,
        officeId: m.officeId, detailId: m.detailId, playerOwned: !!m.playerOwned,
        lastGov: m.lastGov || null, crackdownArmed: !!m.crackdownArmed, crackdownArmedDay: m.crackdownArmedDay || 0,
        disbanded: !!m.disbanded, absorbed: !!m.absorbed, nationalized: !!m.nationalized, crackedDown: !!m.crackedDown,
        formedDay: m.formedDay || 0, name: m.name || (gang && gang.name) || null,
        color: m.color != null ? m.color : MILITIA_COLOR,
        treasury: gang ? Math.round(gang.treasury || 0) : 0,
      };
    }
    return { v: 1, nextId: S.nextId, militias: out };
  }
  function reviveGangShell(gid, mrec, treasury) {
    if (!CBZ.cityGangs) return;
    if (CBZ.cityGangById && CBZ.cityGangById(gid)) return;   // already live — nothing to rebuild
    const anchor = anchorFor(mrec.employerKind, mrec.officeId, null);
    const gang = {
      id: gid, name: mrec.name || "Militia", color: mrec.color || MILITIA_COLOR,
      turf: [], center: { x: anchor.x, z: anchor.z }, provoke: 0,
      members: [], boss: null, bossName: null, bossDead: false,
      warWith: null, warRemain: 0, warIntensity: 0,
      treasury: treasury || 0, hostility: 0, strikeT: 0, lostTurfT: 0, peakTurf: 0,
      hq: null, standing: 0, absorbed: false,
      kind: "militia", playerOwned: !!mrec.playerOwned,
      defendW: MILITIA_DEFEND_W, expandW: MILITIA_EXPAND_W, roamW: MILITIA_ROAM_W,
      recruitPool: 2, rosterCap: MILITIA_HEADCOUNT + 2,
      recruitInterval: 30, recruitT: 30, lastDownT: 0,
    };
    CBZ.cityGangs.push(gang);
    if (CBZ.city && CBZ.city.arena) seedTurf(gang, anchor);
  }
  function apply(obj) {
    reset();
    if (!obj || obj.v !== 1) return;
    const S = state();
    S.nextId = obj.nextId || 1;
    for (const gid in (obj.militias || {})) {
      const src = obj.militias[gid]; if (!src) continue;
      const mrec = {
        employerKind: src.employerKind || null, employerRef: src.employerRef != null ? src.employerRef : null,
        officeId: src.officeId || null, detailId: src.detailId || null, playerOwned: !!src.playerOwned,
        lastGov: src.lastGov || null, crackdownArmed: !!src.crackdownArmed, crackdownArmedDay: src.crackdownArmedDay || 0,
        disbanded: !!src.disbanded, absorbed: !!src.absorbed, nationalized: !!src.nationalized, crackedDown: !!src.crackedDown,
        formedDay: src.formedDay || 0, name: src.name || null, color: src.color != null ? src.color : MILITIA_COLOR,
      };
      S.byGangId[gid] = mrec;
      if (!mrec.disbanded) reviveGangShell(gid, mrec, src.treasury || 0);
    }
  }
  CBZ.militia.serialize = serialize;
  CBZ.militia.apply = apply;

  // ---- SINGLE-PLAYER PERSIST — polity.js's own g.cityWorld pattern: stamp
  // before the existing commit/collect save hooks run, hydrate back out
  // whenever that ledger object's REFERENCE changes. One-shot install guard
  // (module-local boolean, checked BEFORE ever wrapping — the P5 chain-
  // growth fix's own convention, copied verbatim). ------------------------
  function stampMilitia() {
    const led = g.cityWorld;
    if (led && typeof led === "object") led.mil = serialize();
  }
  let _ensureMilitiaSaveWraps_done = false;
  function ensureMilitiaSaveWraps() {
    if (_ensureMilitiaSaveWraps_done) return;
    _ensureMilitiaSaveWraps_done = true;
    const commit = CBZ.cityWorldCommit;
    if (typeof commit === "function" && !commit._milWrap) {
      const w = function () { stampMilitia(); return commit.apply(this, arguments); };
      w._milWrap = true; CBZ.cityWorldCommit = w;
    }
    if (CBZ.cityWorldCollect && !CBZ.cityWorldCollect._milWrap) {
      const col = CBZ.cityWorldCollect;
      const wc = function () { stampMilitia(); return col.apply(this, arguments); };
      wc._milWrap = true; CBZ.cityWorldCollect = wc;
    }
  }
  let _hydratedLedger = null;
  function hydrateFromLedger() {
    const led = g.cityWorld;
    if (!led || led === _hydratedLedger) return;
    _hydratedLedger = led;
    if (led.mil) apply(led.mil);
  }
  if (CBZ.onUpdate) {
    // 46.17 — next free slot after relations.js's own 46.15 and crown.js's
    // 46.16 install-ticks; militia's own gov reads need polity/regimes/crown
    // already hydrated, and protection/gangs are both live well before this.
    CBZ.onUpdate(46.17, function () {
      if (!g) return;
      ensureMilitiaSaveWraps();
      hydrateFromLedger();
    });
  }
})();
