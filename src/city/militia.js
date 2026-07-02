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
    for (let i = 0; i < bodies.length; i++) {
      const ped = bodies[i];
      ped.gang = gangId; ped.faction = gangId; ped.rank = i === 0 ? "lt" : "soldier";
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
    if (CBZ.cityFeed) CBZ.cityFeed("🪖 " + label + ": " + gang.name + " (" + bodies.length + " strong).", "#ffd76a");
    if (mrec.playerOwned && CBZ.city && CBZ.city.big) CBZ.city.big("🪖 MILITIA FORMED: " + gang.name.toUpperCase());

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
      if (CBZ.cityFeed) CBZ.cityFeed("🪖 " + gang.name + " registers as a private security force — legal, but watched.", "#ffd76a");
      const home = homeCityId(mrec, gang);
      if (home && CBZ.approvalShock) CBZ.approvalShock(home, -DEMOCRACY_APPROVAL_DIP);
    } else if (gov === "fascism" || gov === "dictatorship") {
      if (isEmployerOfficeholder(mrec)) {
        absorbLoyalist(gid, gang, mrec);
      } else {
        mrec.crackdownArmed = true; mrec.crackdownArmedDay = day;
        if (CBZ.cityFeed) CBZ.cityFeed("⚠ " + gang.name + " is now an unsanctioned militia — the regime is watching.", "#ff9e6b");
      }
    } else if (gov === "communism") {
      nationalize(gid, gang, mrec);
    } else if (gov === "anarchism") {
      if (CBZ.cityFeed) CBZ.cityFeed("🏴 " + gang.name + " thrives in the vacuum — recruits are lining up.", "#ffd76a");
    }
  }
  function tickGovEffects(gid, gang, mrec, gov, day) {
    if ((gov === "fascism" || gov === "dictatorship") && mrec.crackdownArmed) {
      if (day > (mrec.crackdownArmedDay || 0) && rng() < CRACKDOWN_DAILY_CHANCE) crackdown(gid, gang, mrec);
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
    if (CBZ.cityFeed) CBZ.cityFeed("🎖️ " + gang.name + " folds loyally into the state's own protection detail.", "#8fe08a");
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
    if (CBZ.cityFeed) CBZ.cityFeed("🚩 " + gang.name + " nationalized — " + n + " personnel fold into the police, its treasury seized.", "#8fe08a");
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
    if (CBZ.cityFeed) CBZ.cityFeed("🚨 The regime cracks down on " + gang.name + " — scattered, but " + bossName + " won't forget this.", "#ff6a5e");
  }
  function disband(gid, gang, mrec, reason) {
    mrec.disbanded = true;
    const members = (gang.members || []).slice();
    releaseMembers(members, gang, [{ p: 0.4, flavor: "security" }, { p: 0.3, flavor: "gang" }]);   // remaining 30% -> civilian
    releaseTurf(gang);
    removeFromCityGangs(gid);
    if (CBZ.cityFeed) CBZ.cityFeed("🪖 " + gang.name + " disbands (" + (reason === "employer" ? "employer gone" : "treasury exhausted") + ") — its people scatter, never vanish.", "#ff9e6b");
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

  CBZ.militia = {
    MILITIA_HEADCOUNT,
    tryEscalate, tick: tickAll, list, isMilitia, reset,
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
