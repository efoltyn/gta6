/* ============================================================
   city/hitman.js — THE FREELANCE PIPE: one contract producer, one
   ladder of marks.

   Every NON-arc door that hands the player a paid name comes through
   CBZ.hitmanStart(): activities.js's Crime tab ("Street Hitman Contract",
   now a thin door into this), the protected-contract door, probes. The
   Hitman's own story (the Bureau arc, city/agency.js) enters through
   CBZ.hitmanBind(0) for its first street name and through
   agency.onStreetSettled for everyone else. This file authors only the
   offer, the tier gate and the prose; everything else is reused:

     objective/waypoint/payout -> core/mission.js (CBZ.mission.start)
     the mark                  -> a ped the sim ALREADY RUNS (aigoals
                                  CITY_JOBS roles, power.js principals,
                                  officialdom's sitting officeholder via
                                  contracts.js's exposed binder). NEVER
                                  spawned.
     his face                  -> city/mugshot.js, photographed once at
                                  bind time in the clothes he is wearing
     quiet-vs-loud pricing     -> the existing witness/heat path: the
                                  bonus reads g.wanted at the kill
     the one lock              -> the CITY SEAL item + g.cityGovWrit, both
                                  authored by govcomplex.js's strongroom

   THE LADDER OF MARKS (categorical, not numeric):
     tier 0  STREET     a nobody with a real job and a real shift
     tier 1  PROTECTED  a power.js principal, and beating his RING
     tier 2  THE OFFICE the sitting officeholder; the one rung with a
                        LOCK on it, the city seal behind the steel door in
                        City Hall.
   If the world cannot supply a tier's mark, that tier is not offered. No
   reputation number lives here (owner, 2026-08-18: "there's one currency
   for a hitman, that's money, and a box doesn't open up for money, it
   opens up with a key").

   THE ROOM is not in this file. The motel room the Hitman wakes up in (the
   corkboard, the burner, the case, the rail of clothes, the bed) is
   city/hitman_room.js (CBZ.hmRoom). While a freelance name is live this
   pipe pins his photograph and an index card to that corkboard, and puts
   the board back when he is settled or lost. CBZ.hitmanRoom is the room's
   compat alias and is defined there.

   AUTHORED JOBS. The missions somebody sat down and wrote (the protected
   man, the general: city/hitman_m_*.js, one file each) register with
   CBZ.hitmanJobs and are started through the same producer,
   CBZ.hitmanStart({ job: id }). This file delivers them through the room
   (burner, envelope, folder, cork) and pays them through the dead drop; see
   the AUTHORED JOBS section below for the def a mission file hands over.

   FLAGS: HITMAN_PIPE (the freelance pipe). CITY_MUGSHOT belongs to
   city/mugshot.js.
   Ratchet: CBZ.hitmanAudit() — cards 1, pipes 1, legacyStreetHitmanSites 0.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.game) return;
  const g = CBZ.game;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.HITMAN_PIPE == null) CFG.HITMAN_PIPE = true;

  /* ---------------- shared reads ---------------------------------------- */
  function P() { return CBZ.player || null; }
  function world() { return CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null; }
  function recs() {
    const w = world();
    if (!w) return null;
    w.records = w.records || {};
    w.records.hitman = w.records.hitman || { contracts: 0, completed: 0, failed: 0, highValue: 0, heat: 0, paid: 0 };
    return w.records.hitman;
  }
  function d2(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
  function note(t, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(t, s || 2.4, { from: "GHOSTLINE", app: "missions" }); }
  function campaignOwns() { return !!(CBZ.cityCampaignOwnsMission && CBZ.cityCampaignOwnsMission()); }

  /* ---------------- THE LADDER ------------------------------------------ */
  // Rungs gate the CATEGORY of the mark. Two of them are not gated at all:
  // money is the only currency a contract has, so a harder name simply pays
  // more. The office rung carries the one real lock, and it is a KEY: the
  // city seal, taken off its plinth inside govcomplex.js's strongroom.
  // (owner, 2026-08-18: "there's one currency for a hitman, that's money, and
  // a box doesn't open up for money, it opens up with a key")
  const SEAL = "City Seal";
  const TIERS = [
    { id: "street", label: "A STREET NAME", pay: 900 },
    { id: "protected", label: "A PROTECTED NAME", pay: 4600 },
    { id: "office", label: "THE OFFICE", pay: 15000, key: SEAL },
  ];
  // the key in your bag (cityEcon row) or the writ taking it already granted
  // you (govcomplex sets g.cityGovWrit off the same plinth).
  function haveSeal() {
    const e = CBZ.cityEcon;
    try { if (e && e.count && e.count(SEAL) > 0) return true; } catch (err) {}
    return !!g.cityGovWrit;
  }
  function tierOpen(t) { return !TIERS[t].key || haveSeal(); }
  function keyLine(t) {
    if (!TIERS[t] || !TIERS[t].key) return "No names today.";
    return "That name is above your clearance.";
  }
  CBZ.hitmanTier = function () {
    let t = 0;
    for (let i = 0; i < TIERS.length; i++) if (tierOpen(i)) t = i;
    return { tier: t, seal: haveSeal(), key: SEAL };
  };

  /* ---------------- WORLD BINDERS (never spawn a target) ---------------- */
  function principalSet() {
    const s = [];
    if (CBZ.powerPrincipals) { try { return CBZ.powerPrincipals(); } catch (e) {} }
    return s;
  }
  function isPrincipal(p, set) { return set.indexOf(p) >= 0; }

  // tier 0 — a street nobody with a REAL role: the dossier can say where he
  // works because aigoals' CITY_JOBS already knows.
  function bindStreet(opts) {
    const peds = CBZ.cityPeds || [];
    if (!peds.length) return null;
    const pp = P();
    const px = pp && pp.pos ? pp.pos.x : 0, pz = pp && pp.pos ? pp.pos.z : 0;
    const pr = principalSet();
    const pool = [];
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p || p.dead || !p.pos || !p.group || !p.group.parent || p.culled || p.ko > 0) continue;
      if (p.vendor || p.isFamily || p.kid || p.child || p.kind === "cop" || p.swat || p.gang) continue;
      if (p.companion || p.recruited || p.controlled || p._parked || p._crowd || p._regionLife) continue;
      if (p._campaignTarget || p._campaignCaptive || p._hitMark || p._contractId) continue;
      if (p._powerOf || isPrincipal(p, pr)) continue;             // guards/principals are tier 1
      const d = d2(p.pos.x, p.pos.z, px, pz);
      if (d < (opts && opts.minDist != null ? opts.minDist : 50) || d > 320) continue;
      pool.push(p);
    }
    if (!pool.length) return null;
    // prefer a mark whose job the city actually runs — that is what makes the
    // dossier real instead of prose.
    const roled = pool.filter(function (p) { return p.job && CBZ.cityJobs && CBZ.cityJobs[p.job]; });
    const from = roled.length ? roled : pool;
    const day = CBZ.paceDay ? CBZ.paceDay() : 0;
    const r = CBZ.hash01 ? CBZ.hash01(day, ((recs() || {}).completed | 0) + ((opts && opts.salt) | 0), 0x417) : Math.random();
    const ped = from[Math.min(from.length - 1, (r * from.length) | 0)];
    return { tier: 0, ped: ped, name: ped.name || "the mark", facts: streetFacts(ped), pay: TIERS[0].pay };
  }
  function try_(fn, dflt) { try { return fn(); } catch (e) { return dflt; } }
  function hh(n) { n = ((n | 0) % 24 + 24) % 24; return (n < 10 ? "0" : "") + n + ":00"; }
  // FACTS, NOT PROSE. Every one of these used to be welded into a sentence
  // ("works as a line cook · clocks in at the diner · shift 9:00-17:00 · beds
  // down in Riverside.") that the phone printed as a paragraph. Same reads,
  // handed over as labelled rows the card can lay out beside the photograph —
  // and the ones you can SEE (what he is wearing) are the photo's job now.
  function streetFacts(p) {
    const f = [];
    const jt = (CBZ.cityJobTitle && p.job) ? CBZ.cityJobTitle(p.job) : null;
    const J = (CBZ.cityJobs && p.job) ? CBZ.cityJobs[p.job] : null;
    if (jt) f.push({ k: "WORK", v: String(jt) });
    if (J && J.lots && J.lots.length) f.push({ k: "CLOCKS IN", v: String(J.lots[0]) });
    else if (J && J.anchor) f.push({ k: "CLOCKS IN", v: String(J.anchor) });
    if (J && J.hours) f.push({ k: "SHIFT", v: hh(J.hours[0]) + "-" + hh(J.hours[1]) });
    let home = null;
    try { home = CBZ.cityHomeOf ? CBZ.cityHomeOf(p) : null; } catch (e) { home = null; }
    // home.district is economy.js's district KEY, not a name — printing it raw
    // put "BEDS DOWN: 8" on the card. Ask the one namer the whole city uses.
    if (home && home.district != null) {
      const E = CBZ.cityEcon;
      const dn = (E && E.districtName) ? try_(function () { return E.districtName(home.district); }, null) : null;
      if (dn && dn !== "the city") f.push({ k: "BEDS DOWN", v: String(dn) });
    }
    if (!f.length) f.push({ k: "PAPER TRAIL", v: "none" });
    return f;
  }

  // tier 1 — a protected principal: killing him means beating the RING
  // power.js already runs around him. Officeholders are excluded — they are
  // the tier above, bound through officialdom.
  function bindProtected() {
    const pr = principalSet();
    const out = [];
    for (let i = 0; i < pr.length; i++) {
      const p = pr[i];
      if (!p || p.dead || !p.pos || p._sid) continue;             // _sid = an officeholder body
      if (p._campaignTarget || p._hitMark) continue;
      out.push(p);
    }
    if (!out.length) return null;
    const day = CBZ.paceDay ? CBZ.paceDay() : 0;
    const r = CBZ.hash01 ? CBZ.hash01(day, (recs() || {}).completed | 0, 0x418) : Math.random();
    const ped = out[Math.min(out.length - 1, (r * out.length) | 0)];
    let guards = 0, org = null;
    try { guards = CBZ.powerGuardsOf ? CBZ.powerGuardsOf(ped).length : 0; } catch (e) {}
    try { org = CBZ.powerOrgOf ? CBZ.powerOrgOf(ped) : null; } catch (e) {}
    const role = CBZ.cityTitle ? CBZ.cityTitle(ped) : (ped.job || "principal");
    const f = [{ k: "ROLE", v: String(role) }];
    if (org) f.push({ k: "ORG", v: String(org) });
    f.push({ k: "RING", v: (guards || "a") + " gun" + (guards === 1 ? "" : "s") + ", always" });
    f.push({ k: "APPROACH", v: "borrowed cloth walks closer than your face" });
    return { tier: 1, ped: ped, name: ped.name || "the principal", facts: f, pay: TIERS[1].pay };
  }

  // tier 2 — the sitting officeholder. Bound through contracts.js's OWN
  // exposed world binder (cityOrders._official), so the freelance top rung and
  // the faction assassination point at the same live man; completion reads
  // officialdom's real death broadcast, and succession/approval fall out of
  // systems that already exist.
  let lastOfficialDeath = null, deathSub = false;
  function subOfficialDeath() {
    if (deathSub || !CBZ.onOfficialDeath) return;
    deathSub = true;
    CBZ.onOfficialDeath(function (rec, sid) { lastOfficialDeath = { sid: sid, t: Date.now() }; void rec; });
  }
  function officialPed(sid) {
    const peds = CBZ.cityPeds || [];
    for (let i = 0; i < peds.length; i++) if (peds[i] && peds[i]._sid === sid) return peds[i];
    return null;
  }
  function bindOffice() {
    if (CFG.CONTRACTS_ASSASSINATION === false) return null;
    const o = (CBZ.cityOrders && CBZ.cityOrders._official) ? CBZ.cityOrders._official() : null;
    if (!o) return null;
    subOfficialDeath();
    const f = [
      { k: "OFFICE", v: String(o.title) },
      { k: "DESK", v: "City Hall, 09:00-17:00" },
      { k: "AFTER", v: "a public face" },
      { k: "RING", v: "a real detail" },
    ];
    return { tier: 2, official: o, name: o.title + " " + o.name, facts: f, pay: TIERS[2].pay };
  }

  /* ---------------- THE PICTURE ------------------------------------------
     The single biggest read on a contract card is not a sentence, it is the
     man. city/mugshot.js photographs the ACTUAL body — the rig, the skin, the
     hair, and above all the OUTFIT the city cast onto him — so the card can
     show him instead of describing him, and so "the chef" is something you
     recognise across a parking lot rather than something you re-read.

     Taken ONCE, at bind time: a mark can change clothes later (corpse swap,
     the hour recast), and the photo is deliberately the one on file. Degrade-
     safe — no mugshot module, no photo, and every surface falls back to words. */
  function markPed(con) {
    if (!con) return null;
    if (con.ped) return con.ped;
    return con.official ? officialPed(con.official.sid) : null;
  }
  function shootMark(con) {
    const ped = markPed(con);
    if (!ped || !CBZ.cityMugshot) return con;
    try {
      con.photo = CBZ.cityMugshot({ ped: ped }) || null;
      con.photoCanvas = CBZ.cityMugshotCanvas ? CBZ.cityMugshotCanvas({ ped: ped }) : null;
      con.wearing = CBZ.cityMugshotWearing ? CBZ.cityMugshotWearing({ ped: ped }) : null;
    } catch (e) { con.photo = null; con.photoCanvas = null; con.wearing = null; }
    return con;
  }

  CBZ.hitmanBind = function (tier, opts) {
    if (CFG.HITMAN_PIPE === false) return null;
    tier = tier | 0;
    let con = null;
    try {
      con = tier === 2 ? bindOffice() : tier === 1 ? bindProtected() : bindStreet(opts || {});
    } catch (e) { con = null; }
    return con ? shootMark(con) : null;
  };

  /* ---------------- THE PIPE (one mission, through the block) ----------- */
  let serial = 0;
  function escapeStage() {
    let from = null;
    return {
      id: "escape", goal: "custom", text: "Get clear", label: "GET CLEAR", color: 0xffd166,
      onEnter: function (m, st) {
        const p = P(); from = p && p.pos ? { x: p.pos.x, z: p.pos.z } : null;
        st._quiet = (g.wanted | 0) === 0;          // priced at the kill, not the walk
        st._dressed = !!(CBZ.cityDisguise && CBZ.cityDisguise());
      },
      done: function () {
        const p = P(); if (!p || !from) return true;
        if ((g.wanted | 0) > 0) return false;
        return d2(p.pos.x, p.pos.z, from.x, from.z) > 150;
      },
    };
  }
  function settle(m, con) {
    const st = m.stages && m.stages.length ? m.stages[m.stages.length - 1] : null;
    const quiet = !!(st && st._quiet);
    const bonus = quiet ? Math.round(con.pay * 0.4 / 50) * 50 : 0;
    const R0 = recs();
    if (R0) R0.paid = (R0.paid | 0) + con.pay + bonus;    // the corkboard tally reads this
    if (CBZ.cityEvent) {
      try {
        CBZ.cityEvent(con.tier === 2 ? "assassination" : "hitman-complete", {
          cash: bonus, respect: con.tier === 2 ? 12 : con.tier === 1 ? 6 : 3,
          panic: quiet ? 0 : (con.tier === 2 ? 12 : 4), political: con.tier === 2 ? -6 : 0,
          heat: quiet ? 1 : 4,
          label: "Contract: " + con.name, message: quiet ? "Clean. The quiet margin cleared." : "Loud. The fee stands, the margin does not.",
        });
      } catch (e) {}
    }
    note(quiet
      ? "Clean. Fee plus the quiet margin" + (st && st._dressed ? ", and the uniform walked you out." : ".")
      : "It made the scanner. Fee only.", 3);
    // THE BUREAU IS READING THE SAME PAPERS. city/agency.js decides when a
    // freelancer has done enough clean work to be worth a meeting.
    if (CBZ.agency && CBZ.agency.onStreetSettled) { try { CBZ.agency.onStreetSettled(con, quiet); } catch (e) {} }
    unpinMark();
  }
  function releaseMark(con) {
    const ped = con && con.ped;
    if (!ped) return;
    ped._hitMark = false;
    ped._campaignTarget = false;
  }

  function buildDef(con) {
    const n = ++serial;
    const stages = [];
    if (con.tier === 2) {
      const o = con.official;
      const targeted = o.sid;
      const since = Date.now();
      let killed = false;
      stages.push({
        id: "close", goal: "reach", at: o.door, radius: 26,
        text: "Get eyes on City Hall", label: "CITY HALL",
      });
      stages.push({
        id: "hit", goal: "custom", text: "Remove " + o.name, label: String(o.name).toUpperCase(),
        at: function () { return officialPed(targeted) || o.door; },
        done: function () {
          if (killed) return true;
          if (lastOfficialDeath && lastOfficialDeath.sid === targeted && lastOfficialDeath.t > since) { killed = true; return true; }
          const ped = officialPed(targeted);
          if (ped && ped.dead) { killed = true; return true; }
          return false;
        },
      });
    } else {
      const ped = con.ped;
      ped._hitMark = true;
      ped._campaignTarget = true;                    // the shared "spoken for" stamp — origins heat + campaign casting both skip it
      stages.push({
        id: "hit", goal: "kill", actor: ped,
        text: "Eliminate " + con.name, label: String(con.name).toUpperCase(),
      });
    }
    stages.push(escapeStage());
    return {
      id: "hit-" + TIERS[con.tier].id + "-" + n,
      title: "CONTRACT: " + con.name,
      targetName: con.name,
      // THE LEGS WERE BUILT AND THEN THROWN AWAY. This array is filled in
      // above (the kill leg, goal "kill" bound to the real ped or the
      // officeholder's death broadcast, and escapeStage) and the def never
      // carried it, so core/mission.js fell through to its single-leg
      // shorthand: ONE stage, goal "manual", its text the briefing. That is
      // why a contract showed the briefing as its own objective, why the
      // kill never advanced anything, and why settle()'s quiet margin could
      // never pay: it reads `_quiet` off the last stage, which escapeStage's
      // onEnter is the only thing that sets. Found while giving the card a
      // photograph; it has nothing to do with the photograph.
      stages: stages,
      // ONE LINE. The rest of what this card used to say in prose is now the
      // photograph (who he is, what he is wearing) and the `facts` rows below.
      brief: "Quiet pays. A witnessed kill burns the margin.",
      photo: con.photo || "",
      facts: (con.facts || []).concat(con.wearing ? [{ k: "WEARING", v: con.wearing }] : []),
      reward: { cash: con.pay, notoriety: con.tier === 2 ? 160 : con.tier === 1 ? 60 : 20 },
      color: con.tier === 2 ? 0xff4d4d : 0xffc766,
      limit: con.tier === 2 ? 1200 : 900,
      failIf: con.ped ? function () {
        const p = con.ped;
        if (p.dead) return null;                     // dead is the job, not a failure
        return (!p.group || !p.group.parent) ? "the trail went cold" : null;
      } : null,
      doneText: "Contract settled.",
      failText: "Contract lost.",
      onComplete: function (m) { settle(m, con); releaseMark(con); },
      onFail: function () {
        releaseMark(con);
        const R0 = recs(); if (R0) R0.failed++;
        unpinMark();
      },
    };
  }

  // The one entry every door uses (activities' Crime tab, probes).
  // opts.min — lowest acceptable tier (the "protected contract" door passes 1).
  CBZ.hitmanStart = function (opts) {
    opts = opts || {};
    if (CFG.HITMAN_PIPE === false) return null;
    if (opts.job) return jobTake(String(opts.job), opts);     // an authored job (below)
    if (jobLedger().live) { note("Finish what you're carrying first.", 2.2); return null; }
    if (campaignOwns()) {                            // the campaign IS this pipe on a contract run
      if (CBZ.campaignUI && CBZ.campaignUI.open) { try { CBZ.campaignUI.open("missions"); } catch (e) {} }
      return null;
    }
    const M = CBZ.mission;
    if (!M || !M.start) { note("No network here.", 2); return null; }
    if (M.busy && M.busy()) { note("Finish what you're carrying first.", 2.2); return null; }
    const min = opts.min | 0;
    if (min > 0 && !tierOpen(min)) { note(keyLine(min), 3); return null; }
    let con = null;
    for (let t = TIERS.length - 1; t >= min; t--) {
      if (!tierOpen(t)) continue;
      con = CBZ.hitmanBind(t, opts);
      if (con) break;
    }
    if (!con) { note("No names today.", 2.2); return null; }
    const m = M.start(buildDef(con));
    if (!m || m.inert) { releaseMark(con); return null; }
    const R0 = recs();
    if (CBZ.cityEvent) {
      try { CBZ.cityEvent("hitman-contract", { highValue: con.tier === 2, hitman: 1, label: "Contract: " + con.name, message: "Contract accepted: " + con.name + "." }, { silent: true }); } catch (e) {}
    } else if (R0) R0.contracts++;
    pinMark(con);
    return m;
  };

  /* ---------------- AUTHORED JOBS (city/hitman_m_*.js) -------------------
     One file per authored mission. It registers a def here and this pipe
     carries the job to the player the way every job reaches him: the burner
     on the bed rings, the broker talks, an envelope comes under the door, the
     folder opens in his hands, the cork over the desk is pinned. Then it gets
     out of the way: the job file owns its people, its places and its kill.
     After the kill city/hitman_fallout.js owns the witnesses and the news,
     and the money is a bag by some bins. Nothing here draws a panel, an
     objective or a result.

     CBZ.hitmanJobs.add({
       id, order,           offered in `order`, once each, when he is home and
                            the Bureau (city/agency.js) has nothing in his hands
       from,                who rings (default "Nico")
       call,                [{by:"phone", line}] said before the envelope
       when(),              may it be offered now (can the world supply it)
       make(state),         stage it and return the live job, or null
     })
     the live job: {
       mark, name, role, pay, weight, cause, alarm, kills:{civ,guard},
       file()               the hmPaper.folder file (J opens it)
       board(), boardKey()  corkboard items (hmRoom.board.set) and when to redraw
       tick(dt), frame(dt)  5 Hz director, per-frame motion
       pinAt()              {x,z,label} for the one quiet map pin, or null
       isGuard(ped), onKill(ped, imp), onDead(inc), clear(), end(hard)
       onShot(x, z, loud)   the player fired from (x,z); loud = not suppressed
     }
     CBZ.hitmanStart({ job: id })            put it in hand (the burner rings)
     CBZ.hitmanStart({ job: id, now: true }) straight to the folder (probes,
                                             ?hit=<id> on the URL)
     The ledger (records.hitman.jobs) holds only {done, live:{id, phase, ...}};
     a reload re-stages a live job from its def. */
  const MUL = { clean: 1.5, seen: 1, messy: 0.75, bloodbath: 0.5 };
  const PAY_WORDS = {
    clean: "It's all there, and extra for keeping it quiet.",
    seen: "It's all there. People saw you. Be more careful.",
    messy: "It's short. You know why.",
    bloodbath: "Half. I'm not paying for a massacre.",
  };
  const JOBS = { defs: [], job: null, t: 0, idleT: 0, ringing: false, ringAt: 0, inCall: false, envFor: null, skip: {}, boardKey: "", boardT: 0, fileT: 0, pinKey: null, pinWp: null, why: null, mem: null };
  function jobLedger() {
    const R0 = recs();
    if (!R0) return JOBS.mem || (JOBS.mem = { done: {}, live: null });
    if (!R0.jobs || typeof R0.jobs !== "object") R0.jobs = { done: {}, live: null };
    R0.jobs.done = R0.jobs.done || {};
    return R0.jobs;
  }
  function jobDef(id) { for (let i = 0; i < JOBS.defs.length; i++) if (JOBS.defs[i].id === id) return JOBS.defs[i]; return null; }
  function commit() { if (CBZ.cityWorldCommit) { try { CBZ.cityWorldCommit(); } catch (e) {} } }
  function today() { return CBZ.paceDay ? (CBZ.paceDay() | 0) : 0; }
  function playing() { return g.mode === "city" && g.state === "playing"; }
  function hitmanOrigin() { return g.cityOrigin === "contract" || g.cityOrigin === "hitman"; }
  function distP(x, z) { const p = P(); return p && p.pos ? d2(p.pos.x, p.pos.z, x, z) : Infinity; }
  function textFrom(body, from) {
    if (CBZ.phoneNotify) { try { CBZ.phoneNotify({ app: "messages", from: from || "Unknown number", text: String(body), priority: 2 }); } catch (e) {} }
  }
  // the one quiet pin (no "waypoint set" toast), cleared only if it is still ours
  function jobPin(x, z, label, key) {
    const M = CBZ.fullMap; if (!M || !M.setWaypoint || !isFinite(x) || !isFinite(z)) return;
    if (JOBS.pinKey === key && JOBS.pinWp) return;
    const fh = CBZ.flashHint; CBZ.flashHint = null;
    try { JOBS.pinWp = M.setWaypoint(x, z, label) || null; JOBS.pinKey = key; } catch (e) {} finally { CBZ.flashHint = fh; }
  }
  function jobUnpin() {
    const M = CBZ.fullMap;
    if (M && M.clearWaypoint && JOBS.pinWp) {
      let cur = null; try { cur = M.waypoint ? M.waypoint() : null; } catch (e) {}
      if (!M.waypoint || cur === JOBS.pinWp) { try { M.clearWaypoint(); } catch (e) {} }
    }
    JOBS.pinWp = null; JOBS.pinKey = null;
  }
  function jobStage(S) {
    const d = jobDef(S.id); if (!d) return null;
    if (JOBS.job && JOBS.job.id === S.id) return JOBS.job;
    let j = null;
    try { j = d.make(S) || null; } catch (e) { j = null; JOBS.why = "make " + S.id + ": " + (e && e.message); if (window.console) console.error("[hitman job]", e); }
    if (j) { j.id = d.id; j.def = d; j.kills = j.kills || { civ: 0, guard: 0 }; }
    JOBS.job = j; JOBS.boardKey = "";
    return j;
  }
  function jobOpenFolder(j) {
    const Dz = CBZ.dossier; if (!Dz || !Dz.open || !j || !j.file) return;
    try { if (CBZ.hmHold && CBZ.hmHold.isOpen && CBZ.hmHold.isOpen()) CBZ.hmHold.close(); } catch (e) {}
    setTimeout(function () { try { Dz.open(j.file()); } catch (e) {} }, 300);
  }
  // put a job in hand. Whatever was in hand is torn down first.
  function jobTake(id, opts) {
    const d = jobDef(id); if (!d) return null;
    const L = jobLedger();
    if (L.live) jobClose(true);
    if (JOBS.ringing && CBZ.hmRoom && CBZ.hmRoom.phone) { try { CBZ.hmRoom.phone.stop(); } catch (e) {} }
    JOBS.ringing = false; JOBS.inCall = false; JOBS.envFor = null; JOBS.t = 0;
    const S = (L.live = { id: id, phase: opts && opts.now ? "live" : "ring" });
    if (opts && opts.now) {
      if (CBZ.hmRoom && CBZ.hmRoom.phone && CBZ.hmRoom.phone.ringing && CBZ.hmRoom.phone.ringing()) { try { CBZ.hmRoom.phone.stop(); } catch (e) {} }
      const j = jobStage(S);
      if (!j) { L.live = null; return null; }
      if (opts.folder !== false) jobOpenFolder(j);
    }
    commit();
    return S;
  }
  function jobClose(hard) {
    const L = jobLedger();
    if (JOBS.job) { try { if (JOBS.job.end) JOBS.job.end(!!hard); } catch (e) { if (window.console) console.error("[hitman job] end", e); } }
    JOBS.job = null; L.live = null; JOBS.envFor = null; JOBS.inCall = false; JOBS.idleT = 0;
    jobUnpin();
    JOBS.boardKey = "";
    unpinMark();
    commit();
  }
  function jobAnswer() {
    const S = jobLedger().live; if (!S || JOBS.inCall) return;
    const d = jobDef(S.id); if (!d) return;
    JOBS.ringing = false; JOBS.inCall = true; S.phase = "call";
    const lines = typeof d.call === "function" ? d.call() : (d.call || []);
    const done = function () {
      JOBS.inCall = false;
      const S2 = jobLedger().live;
      if (S2 && S2.id === d.id && S2.phase === "call") { S2.phase = "envelope"; JOBS.envFor = null; commit(); }
    };
    if (CBZ.hmCall && lines.length) { try { CBZ.hmCall(lines, done); return; } catch (e) {} }
    setTimeout(done, 200);
  }
  function jobPick(id) {
    const L = jobLedger(), S = L.live;
    if (!S || S.id !== id || S.phase !== "envelope") return;
    const d = jobDef(id);
    const j = jobStage(S);
    if (!j) {
      // the world could not supply it today: the broker says so, and asks again another day
      JOBS.skip[id] = today(); L.live = null; JOBS.envFor = null; commit();
      textFrom("That one fell through. Forget the envelope. I'll call.", d && d.from || "Nico");
      return;
    }
    S.phase = "live"; commit();
    jobOpenFolder(j);
  }
  function jobDead(S, j) {
    const m = j.mark;
    const info = { ped: m, name: j.name, role: j.role || "", cause: j.cause || "shot", kills: j.kills, alarm: !!j.alarm, weight: j.weight || "someone" };
    if (j.place) { try { info.place = j.place(); } catch (e) {} }
    let inc = null;
    try {
      if (CBZ.agency && CBZ.agency.report) inc = CBZ.agency.report(info);      // the morning paper and the TV carry it
      else if (CBZ.hmFallout && CBZ.hmFallout.kill) inc = CBZ.hmFallout.kill(info);
    } catch (e) { inc = null; }
    const v = inc && inc.verdict ? inc.verdict : ((g.wanted | 0) > 0 ? "seen" : "clean");
    S.phase = "after"; S.inc = inc ? inc.id : null; S.verdict = v;
    S.pay = Math.round((j.pay || 0) * (MUL[v] || 1) / 50) * 50;
    S.killX = m.pos.x; S.killZ = m.pos.z; S.name = j.name;
    jobUnpin(); JOBS.boardKey = "";
    commit();
    if (j.onDead) { try { j.onDead(inc); } catch (e) {} }
  }
  function jobKill(j, ped, imp) {
    if (j.onKill) { try { j.onKill(ped, imp); } catch (e) {} }
    if (ped === j.mark) return;
    if (imp.byPlayer === false || imp.attacker) return;
    if ((j.isGuard && j.isGuard(ped)) || ped.kind === "cop" || ped.swat) j.kills.guard++;
    else j.kills.civ++;
  }
  function jobWrapKills() {
    if (typeof CBZ.cityKillPed !== "function" || CBZ.cityKillPed._hmJobWrap) return;
    const orig = CBZ.cityKillPed;
    const w = function (ped, imp) {
      const was = !ped || ped.dead;
      const r = orig.apply(this, arguments);
      // (once per body: a file that wraps cityKillPed over this one without
      // carrying the latch has this wrapper put on twice, and both see the
      // same death)
      if (!was && ped && ped.dead && JOBS.job && !ped._hmJobKilled) { ped._hmJobKilled = true; try { jobKill(JOBS.job, ped, imp || {}); } catch (e) {} }
      return r;
    };
    for (const k in orig) if (Object.prototype.hasOwnProperty.call(orig, k) && k.charAt(0) === "_") w[k] = orig[k];
    w._hmJobWrap = true;
    CBZ.cityKillPed = w;
  }
  // every shot the player fires goes through CBZ.cityAlarm at his own feet
  // (systems/fpsmode.js): the live job hears it, and whether it was suppressed
  function jobWrapAlarm() {
    if (typeof CBZ.cityAlarm !== "function" || CBZ.cityAlarm._hmJobWrap) return;
    const orig = CBZ.cityAlarm;
    const w = function (x, z, radius, intensity, offender) {
      const j = JOBS.job, pl = P();
      const key = (CBZ.now || 0) + ":" + x + ":" + z;
      if (j && j.onShot && offender && pl && pl.pos && offender === (CBZ.city && CBZ.city.playerActor) &&
          (radius || 0) >= 20 && d2(x, z, pl.pos.x, pl.pos.z) < 2.5 && JOBS.shotKey !== key) {
        JOBS.shotKey = key;                                  // (once per shot, however many times this is wrapped)
        let supp = false;
        try { supp = !!(CBZ.gunModsSuppressed && CBZ.gunModsSuppressed(CBZ.currentWeaponId)); } catch (e) { supp = false; }
        try { j.onShot(x, z, !supp); } catch (e) {}
      }
      return orig.apply(this, arguments);
    };
    for (const k in orig) if (Object.prototype.hasOwnProperty.call(orig, k)) w[k] = orig[k];
    w._hmJobWrap = true;
    CBZ.cityAlarm = w;
  }
  function jobBoard(j, dt) {
    const R = CBZ.hmRoom; if (!R || !R.board || !R.board.set || !j.board) return;
    JOBS.boardT -= dt;
    if (JOBS.boardT > 0) return;
    JOBS.boardT = 1.5;
    const rm = R.ensure ? R.ensure() : null;
    if (!rm || !rm.center || distP(rm.center.x, rm.center.z) > 90) return;     // the cork is read in the room
    const key = j.id + "#" + (j.boardKey ? j.boardKey() : "");
    if (key === JOBS.boardKey) return;
    JOBS.boardKey = key;
    let items = null;
    try { items = j.board(); } catch (e) { items = null; }
    if (items && items.length) { try { R.board.set(items); } catch (e) {} }
  }
  function jobsTick(dt) {
    const L = jobLedger(), R = CBZ.hmRoom;
    jobWrapKills();
    jobWrapAlarm();
    let S = L.live;
    if (!S) {
      // nothing in hand: the broker rings when he is home and nobody else is using him
      if (!hitmanOrigin() || campaignOwns() || (CBZ.agency && CBZ.agency.busy && CBZ.agency.busy()) ||
          !R || !R.inRoom || !R.inRoom() || (CBZ.mission && CBZ.mission.busy && CBZ.mission.busy())) { JOBS.idleT = 0; return; }
      JOBS.idleT += dt;
      if (JOBS.idleT < 8) return;
      let d = null;
      for (let i = 0; i < JOBS.defs.length && !d; i++) {
        const c = JOBS.defs[i];
        if (L.done[c.id] || JOBS.skip[c.id] === today()) continue;
        let ok = true;
        if (c.when) { try { ok = !!c.when(); } catch (e) { ok = false; } }
        if (ok) d = c;
      }
      if (!d) { JOBS.idleT = 0; return; }
      S = L.live = { id: d.id, phase: "ring" }; JOBS.t = 0; JOBS.ringing = false; JOBS.inCall = false;
      commit();
    }
    const d = jobDef(S.id);
    if (!d) { L.live = null; return; }                    // a job from a build that no longer carries it
    JOBS.t += dt;
    if (S.phase === "call" && !JOBS.inCall) S.phase = "ring";   // a reload mid-call: he rings again
    if (S.phase === "ring") {
      if (JOBS.ringing) {
        // he walked out and left it ringing: it rings in his pocket instead
        if (!(R && R.inRoom && R.inRoom()) && JOBS.t > JOBS.ringAt + 40) { try { R.phone.stop(); } catch (e) {} jobAnswer(); }
        return;
      }
      if (R && R.phone && R.phone.ring && R.ensure && R.ensure()) {
        try { R.phone.ring({ from: d.from || "Nico", onAnswer: jobAnswer }); JOBS.ringing = true; JOBS.ringAt = JOBS.t; } catch (e) { jobAnswer(); }
      } else if (JOBS.t > 2) jobAnswer();
      return;
    }
    if (S.phase === "call") return;
    if (S.phase === "envelope") {
      if (JOBS.envFor === S.id) return;
      JOBS.envFor = S.id;
      const id = S.id, K = CBZ.hmPaper;
      const pick = function () { jobPick(id); };
      if (R && R.door && R.door.deliver && R.ensure && R.ensure()) {
        setTimeout(function () {
          try { R.door.deliver("envelope", { canvas: K && K.envelope ? K.envelope({ text: d.envelope || "", sealed: true }) : null, verb: "Pick up", onPick: pick }); } catch (e) { pick(); }
        }, 500);
      } else setTimeout(pick, 1200);                       // no room: the envelope is simply in his hand
      return;
    }
    // live, and the aftermath: the job keeps running its world until it is closed
    const j = S.phase === "live" ? (JOBS.job || jobStage(S)) : JOBS.job;
    if (S.phase === "live" && !j) { JOBS.why = JOBS.why || ("could not stage " + S.id); return; }
    if (j) {
      const m = j.mark;
      // the world swept him away alive (a rebuild): stage him again
      if (S.phase === "live" && m && !m.dead && (CBZ.cityPeds || []).indexOf(m) < 0) { try { if (j.end) j.end(true); } catch (e) {} JOBS.job = null; return; }
      try { if (j.tick) j.tick(dt); } catch (e) { if (window.console) console.error("[hitman job] tick", e); }
      if (S.phase === "live" && m && m.dead) jobDead(S, j);
      else if (S.phase === "live") {
        const p = j.pinAt ? j.pinAt() : null;
        if (p) jobPin(p.x, p.z, p.label || j.name, "job:" + (p.key || ""));
      }
      jobBoard(j, dt);
      JOBS.fileT -= dt;
      if (JOBS.fileT <= 0 && CBZ.dossier && CBZ.dossier.isOpen && CBZ.dossier.isOpen() && j.file) { JOBS.fileT = 0.7; try { CBZ.dossier.update(j.file()); } catch (e) {} }
    }
    if (S.phase === "live") return;
    const F = CBZ.hmFallout;
    if (S.phase === "after") {
      const clear = F && F.clear ? F.clear(S.inc) : ((g.wanted | 0) === 0 && distP(S.killX, S.killZ) > 150);
      if (!clear || (j && j.clear && !j.clear())) return;
      const words = PAY_WORDS[S.verdict] || PAY_WORDS.seen;
      let D0 = null;
      if (F && F.drop) {
        try { D0 = F.drop({ pay: S.pay | 0, from: d.from || "Nico", salt: (S.killX | 0) * 31 + (S.killZ | 0), line: function (where) { return "A bag by the bins outside " + where + ". " + words; } }); } catch (e) { D0 = null; }
      }
      if (D0) { S.dropId = D0.id; S.phase = "drop"; jobPin(D0.x, D0.z, "bag", "drop"); }
      else { if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(S.pay | 0); S.phase = "paid"; }
      commit();
      return;
    }
    if (S.phase === "drop") {
      const D0 = F && F.dropState ? F.dropState() : null;
      if (!D0 || D0.id !== S.dropId || D0.taken) { S.phase = "paid"; commit(); }
      return;
    }
    // paid: it is over. His face comes off the cork and the next call can come.
    L.done[S.id] = { verdict: S.verdict || "", day: today(), name: S.name || "" };
    const R0 = recs(); if (R0) R0.completed = (R0.completed | 0) + 1;
    jobClose(false);
  }
  CBZ.hitmanJobs = {
    add: function (def) {
      if (!def || !def.id || typeof def.make !== "function") return false;
      for (let i = JOBS.defs.length - 1; i >= 0; i--) if (JOBS.defs[i].id === def.id) JOBS.defs.splice(i, 1);
      JOBS.defs.push(def);
      JOBS.defs.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
      return true;
    },
    // a job is in his hands (any phase): the Bureau's arc and the old pipe wait
    owns: function () { return !!jobLedger().live; },
    live: function () { return JOBS.job; },
    state: function () { return jobLedger().live; },
    file: function () { const j = JOBS.job; if (!j || !j.file) return null; try { return j.file(); } catch (e) { return null; } },
    drop: function () { jobClose(true); },
    audit: function () {
      const L = jobLedger(), S = L.live, j = JOBS.job;
      return {
        defs: JOBS.defs.map(function (d) { return d.id; }), done: Object.keys(L.done),
        live: S ? { id: S.id, phase: S.phase, verdict: S.verdict || null, pay: S.pay || null } : null,
        staged: !!j, mark: j && j.mark ? { name: j.name, dead: !!j.mark.dead } : null,
        ringing: JOBS.ringing, inCall: JOBS.inCall, envFor: JOBS.envFor, why: JOBS.why,
      };
    },
  };
  // (a re-run of this file, as a dev reload does, retires the old updaters)
  const JOBGEN = (CBZ._hmJobGen = (CBZ._hmJobGen | 0) + 1);
  if (CBZ.onUpdate) {
    let acc = 0, urlDone = false;
    CBZ.onUpdate(39.45, function (dt) {
      if (JOBGEN !== CBZ._hmJobGen || CFG.HITMAN_PIPE === false || !playing()) return;
      if (!urlDone) {
        urlDone = true;
        let q = null;
        try { q = new URLSearchParams(window.location.search).get("hit"); } catch (e) { q = null; }
        if (q && jobDef(q)) jobTake(q, { now: true });
      }
      acc += dt || 0;
      if (acc < 0.2) return;
      const step = acc; acc = 0;
      try { jobsTick(step); } catch (e) { if (window.console) console.error("[hitman jobs]", e); }
    });
    // per frame, after the car loop: a convoy, its riders, a ring on the move
    CBZ.onUpdate(37.35, function (dt) {
      if (JOBGEN !== CBZ._hmJobGen || !playing()) return;
      glassTick(dt || 0);
      const j = JOBS.job;
      if (j && j.frame) { try { j.frame(dt || 0); } catch (e) { if (window.console) console.error("[hitman job] frame", e); } }
    });
  }

  /* ---------------- GLASS: what the lens is on is drawn --------------------
     city/peds.js stops drawing a rig 95 m from the camera, which is right for
     a street and wrong for a man looking down a ten-power scope: the square
     he is watching from two hundred metres was empty. While a scope or the
     binoculars are up, the living bodies inside the lens (and a margin to pan
     into) carry `_farDraw` and are drawn at any range; the flag comes off
     the moment the glass comes down. Costs nothing with the glass down. */
  const GLASS = { t: 0, marked: [], dir: null };
  function glassUp() {
    try { if (CBZ.hmBinoculars && CBZ.hmBinoculars.active && CBZ.hmBinoculars.active()) return true; } catch (e) {}
    try { return !!(CBZ.fpsScoped && CBZ.fpsScoped()); } catch (e) { return false; }
  }
  function glassTick(dt) {
    const M = GLASS.marked;
    if (!glassUp()) {
      if (M.length) { for (let i = 0; i < M.length; i++) M[i]._farDraw = false; M.length = 0; }
      GLASS.t = 0;
      return;
    }
    if ((GLASS.t -= dt) > 0) return;
    GLASS.t = 0.2;
    const cam = CBZ.camera, T3 = window.THREE;
    if (!cam || !T3 || !cam.getWorldDirection) return;
    const dir = GLASS.dir || (GLASS.dir = new T3.Vector3());
    cam.getWorldDirection(dir);
    const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
    for (let i = 0; i < M.length; i++) M[i]._farDraw = false;
    M.length = 0;
    const L = CBZ.cityPeds || [];
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      if (!p || !p.pos || p.dead) continue;                 // a body on the ground has its own 200 m rule
      const dx = p.pos.x - cx, dy = (p.pos.y || 0) + 1 - cy, dz = p.pos.z - cz;
      const dd = dx * dx + dy * dy + dz * dz;
      if (dd < 80 * 80 || dd > 460 * 460) continue;
      if ((dx * dir.x + dy * dir.y + dz * dir.z) / Math.sqrt(dd) < 0.93) continue;
      p._farDraw = true; M.push(p);
    }
  }

  /* ---------------- THE CORKBOARD --------------------------------------
     The room is city/hitman_room.js (CBZ.hmRoom). While a freelance name is
     on the wire this pipe pins him to the board over the desk: his
     photograph (the mugshot taken at bind time, in the clothes he is
     wearing) and an index card in the hitman's own hand with what is known,
     tied together with red string. Settle or lose him and the board goes
     back to its usual dressing. */
  function pinMark(con) {
    const R = CBZ.hmRoom, K = CBZ.hmPaper;
    if (!R || !R.board || !R.board.set || !K) return;
    try {
      const redraw = { onRedraw: function () { if (R.board.refresh) R.board.refresh(); } };
      const photo = con.photoCanvas || con.photo || null;
      const pol = K.polaroid ? K.polaroid({ photo: photo, caption: con.name }, redraw) : null;
      const lines = [String(con.name || "")];
      const F = (con.facts || []).concat(con.wearing ? [{ k: "WEARING", v: con.wearing }] : []);
      for (let i = 0; i < F.length && lines.length < 5; i++) lines.push(cap(F[i].k) + ": " + String(F[i].v));
      const card = K.note ? K.note({ lines: lines, hand: true, tone: "index" }) : null;
      const base = (R.board.defaults ? R.board.defaults() : []).filter(function (it) { return it.id !== "rules"; });
      const items = base.slice();
      if (pol) items.push({ id: "mark", canvas: pol, w: 0.11, h: 0.132, x: -0.12, y: -0.28, rot: 0.04, links: ["markcard", "map"], pin: "red" });
      if (card) items.push({ id: "markcard", canvas: card, w: 0.2, h: 0.13, x: 0.5, y: -0.3, rot: -0.03, links: [], pin: "red" });
      R.board.set(items);
    } catch (e) {}
  }
  function unpinMark() {
    const R = CBZ.hmRoom;
    if (R && R.board && R.board.reset) { try { R.board.reset(); } catch (e) {} }
  }
  function cap(k) { k = String(k || "").toLowerCase(); return k.charAt(0).toUpperCase() + k.slice(1); }

  /* ---------------- THE RATCHET — CBZ.hitmanAudit() ----------------------- */
  // cards must be 1 (one hitman fantasy on the picker), pipes 1 (one contract
  // producer plus any surviving legacy site), legacyStreetHitmanSites 0 (the
  // activities.js parallel system is dead — a live g.cityJob of the retired
  // "hitman" type is the only way this can ever read nonzero again).
  CBZ.hitmanAudit = function () {
    let cards = 0;
    try {
      cards = document.querySelectorAll('#originSelect .origin-btn[data-origin="contract"],#originSelect .origin-btn[data-origin="hitman"]').length;
    } catch (e) { cards = -1; }
    const legacy = (g.cityJob && !g.cityJob._mission && g.cityJob.type === "hitman") ? 1 : 0;
    const T = CBZ.hitmanTier();
    return {
      cards: cards,
      pipes: (typeof CBZ.hitmanStart === "function" && CFG.HITMAN_PIPE !== false ? 1 : 0) + legacy,
      marksLadderTiers: TIERS.length,
      boardMarks: (CBZ.hmRoom && CBZ.hmRoom.board) ? CBZ.hmRoom.board.items().length : 0,
      disguiseHooks: (typeof CBZ.cityDisguise === "function" ? 1 : 0) +
        (typeof CBZ.cityDisguiseTrust === "function" ? 1 : 0) +
        (typeof CBZ.cityOutfitGet === "function" ? 1 : 0),
      legacyStreetHitmanSites: legacy,
      room: !!(CBZ.hmRoom && CBZ.hmRoom.ensure && CBZ.hmRoom.ensure()),
      caseOpen: !!(CBZ.hmRoom && CBZ.hmRoom.gunCase && CBZ.hmRoom.gunCase.isOpen()),
      repGates: 0,                       // no rung and no box in this file reads a reputation number
      keyedRungs: TIERS.filter(function (t) { return !!t.key; }).length,
      seal: T.seal, tier: T.tier,
    };
  };
})();
