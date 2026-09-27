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
    return "That name needs the city seal. It is behind the steel door in City Hall.";
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
    const day = CBZ.dayCount ? CBZ.dayCount() : 0;
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
    const day = CBZ.dayCount ? CBZ.dayCount() : 0;
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
