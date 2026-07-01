/* ============================================================
   city/companies.js — NPC COMPANIES + a living real-estate market, now with
   a REAL, KILLABLE owner behind every firm.

   WHY: the city's offices/businesses shouldn't be empty set-dressing. Each is
   the HQ of a COMPANY that actually OWNS and TRADES real estate across the
   districts — collecting rent, expanding by buying lots, divesting, booming,
   and occasionally going bankrupt (a fire-sale the player can pounce on). This
   is the "offices are managing real estate and running companies, all in the
   game" layer: a background economy that makes the skyline feel owned.

   OWNERSHIP, FOR REAL (this pass): a company used to be a pure data record
   with nobody attached — killing "the owner" meant nothing because there was
   no owner, just a name on a sign. Every company now stages a real, named,
   positioned ped (CBZ.cityMakePed, same constructor every other city NPC uses
   — gangs.js's boss, vips.js's principal, millionaires.js's tycoon) standing
   outside its HQ door, tagged co.owner. He's robbable, shootable, permanent:
   gunning him down doesn't respawn a clone wearing the same name, it retires
   his CBZ.cityIdentities record (kind 'companyOwner', the same permanent-death
   registry racing/vips/tycoons share) and PROMOTES a real understudy — the
   most senior office worker actually staffing that HQ (citystaff.js's queues
   are decoration; officejobs.js's CBZ.cityOfficeDesks occupants are real
   peds) — modeled line-for-line on gangs.js's succeedBoss(): rank the bench,
   crown the heir, rename, announce. See succeedCompanyOwner() below.

   DETERMINISM: this file used to run on raw Math.random() throughout (an
   oversight — there's no actual reason for it to dodge the project's seeded-
   LCG convention; nothing here needs OS entropy or per-tab variance). It now
   carries its own seeded LCG exactly like every other city/*.js file.

   ADDITIVE + SAFE by design (does NOT touch the NPC crowd/nav/peds systems a
   parallel wave is building, and never mutates the player's zillow/empire
   ownership): it maintains its OWN company roster + per-lot tag, overlays the
   managing company onto the EXISTING ownership label (business/landlord lots
   only — never the player's home, gang turf, or city property), and surfaces
   moves through the city feed. Read it via CBZ.cityCompanies.
   ============================================================ */
(function () {
  if (!window.CBZ || !window.THREE) return;
  const CBZ = window.CBZ;

  // ---- deterministic LCG (project convention — see gangs.js/careers.js for
  //      the same shape). Replaces the old raw Math.random() calls below. ----
  let _s = 47261;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }

  // ---- procedural company identity -------------------------------------
  const PRE = ["Vantage", "Keystone", "Apex", "Meridian", "Crown", "Atlas", "Pinnacle",
    "Harbor", "Summit", "Onyx", "Cobalt", "Vertex", "Granite", "Beacon", "Sterling",
    "Halcyon", "Ironwood", "Marlow", "Cardinal", "Empyrean", "Dovetail", "Brackish"];
  const SUF = ["Holdings", "Group", "Capital", "Properties", "Realty", "Ventures",
    "Partners", "Industries", "Trust", "Development", "Estates", "& Co.", "Equity",
    "Asset Mgmt", "Acquisitions"];
  const SECTORS = ["real estate", "hospitality", "retail", "finance", "logistics",
    "entertainment", "construction", "media", "tech"];
  // owner job-title flavour, read off the company's sector when we cast the body
  const OWNER_TITLE = { "real estate": "developer", hospitality: "hotelier", retail: "retail magnate",
    finance: "investor", logistics: "shipping exec", entertainment: "promoter",
    construction: "contractor", media: "media exec", tech: "founder" };

  let companies = [];
  let arenaRef = null;     // the arena this roster was built for (rebuild on a new city)
  let tickT = 0;
  let buildCool = 0;
  const MOVE_EVERY = 22;   // seconds between market moves (one feed line at most)

  function rint(n) { return (rng() * n) | 0; }
  function pick(a) { return a[rint(a.length)]; }

  function districtName(arena, dq) {
    const d = arena && arena.districts && arena.districts[dq];
    return (d && (d.name || d.kind)) || ("District " + ((dq | 0) + 1));
  }

  // A lot a company may own/manage: a real building owned as a BUSINESS or a
  // generic LANDLORD tower. Never the player's home/residential ladder, never
  // gang turf, never city property.
  function claimable(lot) {
    const b = lot && lot.building; if (!b || !b.owner) return false;
    if (b.home) return false;
    const t = b.owner.type;
    return t === "business" || t === "landlord";
  }

  function lotValue(lot) {
    const b = lot.building || {}, area = (lot.w || 10) * (lot.d || 10);
    return Math.round(area * (b.shop ? 1400 : 900) * (1 + (b.storeys || 1) * 0.1));
  }

  function note(msg, color) {
    try { if (CBZ.cityFeed) CBZ.cityFeed(msg, color || "#8fc7e0"); } catch (e) {}
  }
  function announce(msg) {
    try { if (CBZ.city && CBZ.city.big) CBZ.city.big(msg); else note(msg, "#ffce8f"); } catch (e) {}
  }

  // Overlay the managing company onto the EXISTING ownership label (plain-string
  // business/landlord owners only — homes are excluded by claimable, so the
  // home getter is never touched). Original name stashed for clean restore.
  function tagOwner(lot, co) {
    const b = lot.building; if (!b || !b.owner) return;
    if (b.owner.type !== "business" && b.owner.type !== "landlord") return;
    try {
      if (b.owner._origName == null) b.owner._origName = b.owner.name;
      b.owner.name = co.name;
      b.owner.company = co.id;
    } catch (e) {}
  }
  function restoreOwner(lot) {
    const b = lot && lot.building;
    if (b && b.owner && b.owner._origName != null) {
      try { b.owner.name = b.owner._origName; b.owner.company = null; } catch (e) {}
    }
  }

  // ============================================================
  //  THE OWNER PED — a real, permanent, killable individual standing at the
  //  HQ's door. Spawned via CBZ.cityMakePed, the SAME constructor gangs.js
  //  uses for a gang boss / vips.js for a principal — added to CBZ.cityPeds
  //  for real (not a decorative instanced figure), so combat/looting/the
  //  central death chain (peds.js cityKillPed) all treat him like any NPC.
  // ============================================================
  function ownerSpawnPoint(hq) {
    const d = hq.building && hq.building.door;
    if (d && d.x != null) {
      const nx = d.nx != null ? d.nx : 0, nz = d.nz != null ? d.nz : 1;
      const nl = Math.hypot(nx, nz) || 1;
      return { x: d.x + (nx / nl) * 2.2, z: d.z + (nz / nl) * 2.2 };
    }
    return { x: hq.cx, z: hq.cz };
  }

  // mint (or reuse) the cityIdentities record for the CURRENT owner of a
  // company and stamp it onto the ped — same stamp-on-the-individual pattern
  // racing.js/vips.js/millionaires.js use so peds.js's central death chain
  // (a separate task this wave) can reach it via p._identityId too.
  function registerOwnerIdentity(co, owner) {
    const R = CBZ.cityIdentities;
    if (!R || !R.register || !owner) return;
    const rec = R.register("companyOwner", owner.name || (co.name + " Owner"), { companyId: co.id, companyName: co.name, sector: co.sector });
    owner._identityId = rec.id;
  }

  function spawnOwner(co, A) {
    if (!CBZ.cityMakePed || !CBZ.cityPeds || !A || !A.root) return null;
    const sp = ownerSpawnPoint(co.hq);
    const title = OWNER_TITLE[co.sector] || "executive";
    const owner = CBZ.cityMakePed(sp.x, sp.z, rng, {
      kind: "civilian", archetype: "socialite", job: title,
      wealth: Math.min(0.97, 0.55 + rint(40) / 100), aggr: 0.16,    // money doesn't brawl
      guard: { x: sp.x, z: sp.z },
    });
    if (!owner) return null;
    owner.isCompanyOwner = true;
    owner.company = co.id;
    owner.homeGuard = { x: sp.x, z: sp.z };
    A.root.add(owner.group);
    CBZ.cityPeds.push(owner);
    registerOwnerIdentity(co, owner);
    return owner;
  }

  // drop the owner ped cleanly (company busted out from under them / a fresh
  // arena rebuild). Doesn't kill him in-fiction — just removes the body, the
  // way a one-off cast NPC is torn down elsewhere when its role ends.
  function despawnOwner(co) {
    const owner = co && co.owner; if (!owner) return;
    co.owner = null;
    const i = CBZ.cityPeds ? CBZ.cityPeds.indexOf(owner) : -1;
    if (i >= 0) CBZ.cityPeds.splice(i, 1);
    if (owner.group && owner.group.parent) owner.group.parent.remove(owner.group);
  }

  // ---- SUCCESSION — modeled line-for-line on gangs.js's succeedBoss(): rank
  // a candidate bench, promote the top one, rename, announce. The bench here
  // is the office staff actually working that HQ: officejobs.js's desk
  // registry (CBZ.cityOfficeDesks — real peds, .occupant) first, falling back
  // to any live ped whose ._work points at the HQ lot (aigoals.js stamps this
  // on office workers generally, desk or not). Ranked by SENIORITY (time held
  // the post — the same "served" currency gangs.js's memStats tracks), then
  // by officejobs.js's own manager flag if careers.js/officejobs.js has
  // crowned one (see officejobs.js's CBZ.cityOfficeManager ladder) so a
  // standing manager always outranks a rank-and-file desk worker.
  // ============================================================
  function ownerStats(p) {
    if (!p._coStat) p._coStat = { served: 0 };
    return p._coStat;
  }
  function candidateBench(co) {
    const out = [];
    const seen = new Set();
    const desks = CBZ.cityOfficeDesks || [];
    for (let i = 0; i < desks.length; i++) {
      const d = desks[i];
      if (d.lot !== co.hq || !d.occupant || d.occupant.dead || d.occupant === co.owner) continue;
      if (!seen.has(d.occupant)) { seen.add(d.occupant); out.push(d.occupant); }
    }
    // fall back to any office worker whose work lot is this HQ (covers HQs
    // that aren't furnished with the desk registry, e.g. retail/landlord lots)
    if (CBZ.cityPeds) {
      for (let i = 0; i < CBZ.cityPeds.length; i++) {
        const p = CBZ.cityPeds[i];
        if (!p || p.dead || p === co.owner || seen.has(p)) continue;
        if (p._work === co.hq) { seen.add(p); out.push(p); }
      }
    }
    return out;
  }
  function rankCandidate(p) {
    const isMgr = CBZ.cityIsOfficeManager ? CBZ.cityIsOfficeManager(p) : !!p._mgr;
    return (isMgr ? 1000 : 0) + ownerStats(p).served;
  }
  function succeedCompanyOwner(co) {
    if (!co) return;
    const bench = candidateBench(co);
    bench.sort((a, b) => rankCandidate(b) - rankCandidate(a));
    const heir = bench[0];
    const A = CBZ.city && CBZ.city.arena;
    if (!heir) {
      // no staff to promote — the seat doesn't stay empty: a fresh face takes
      // over the firm (mirrors gangs.js's "no live members" leaderless branch,
      // but a company without ANY staff just hires a new owner rather than
      // folding, since it still owns real, valuable real estate).
      const fresh = spawnOwner(co, A);
      co.owner = fresh;
      if (fresh) announce("🏢 " + co.name + " names a new owner after the old one was killed.");
      return;
    }
    // promote the heir IN PLACE — leave their desk/anchor claim alone if any
    // (officejobs.js cityReleaseDesk isn't needed: the owner doesn't sit a desk).
    if (CBZ.cityReleaseDesk) CBZ.cityReleaseDesk(heir);
    if (CBZ.cityOfficeClearManager) CBZ.cityOfficeClearManager(co.hq);   // the old manager seat is now the owner's
    heir.isCompanyOwner = true; heir.company = co.id;
    heir.job = OWNER_TITLE[co.sector] || "executive";
    heir.archetype = "socialite"; heir.aggr = Math.min(heir.aggr || 0.2, 0.2);
    const sp = ownerSpawnPoint(co.hq);
    heir.homeGuard = { x: sp.x, z: sp.z }; heir.guard = { x: sp.x, z: sp.z };
    const prevIdentityId = co.owner && co.owner._identityId;
    co.owner = heir;
    registerOwnerIdentity(co, heir);
    if (prevIdentityId && CBZ.cityIdentities && CBZ.cityIdentities.setSuccessor) {
      CBZ.cityIdentities.setSuccessor(prevIdentityId, heir._identityId || null);
    }
    announce("🏢 " + (heir.name || "An understudy") + " takes over " + co.name + " after the owner was killed.");
  }
  CBZ.citySucceedCompanyOwner = succeedCompanyOwner;   // exposed for tests / other systems

  // permanent-death plug-in for kind 'companyOwner': identity.js dispatches
  // here once markDead() fires (whichever path reaches it first — our own
  // per-tick sweep below, or peds.js's central death chain via p._identityId,
  // a separate task this wave). Idempotent: identity.js no-ops a repeat
  // markDead on the same id, and succeedCompanyOwner only ever runs off THIS
  // callback, so a double-fire can't double-promote.
  if (CBZ.cityIdentities && CBZ.cityIdentities.onDeathRegister) {
    CBZ.cityIdentities.onDeathRegister("companyOwner", function (rec) {
      const co = companies.find((c) => c.id === rec.companyId);
      if (co) succeedCompanyOwner(co);
    });
  }

  // PERMANENCE SAFETY NET (mirrors racing.js's R.scanCD sweep): if cityIdentities
  // isn't loaded at all, OR peds.js's central death hook hasn't landed yet,
  // we still need to notice "the owner's body went down" and react. Cheap —
  // at most one ped check per company per sweep.
  function sweepOwners() {
    for (let i = 0; i < companies.length; i++) {
      const co = companies[i], owner = co.owner;
      if (!owner) continue;
      if (owner.dead) {
        if (CBZ.cityIdentities && CBZ.cityIdentities.markDead && owner._identityId) {
          const before = CBZ.cityIdentities.get(owner._identityId);
          if (before && before.status !== "dead") CBZ.cityIdentities.markDead(owner._identityId, { killedBy: null });
          // markDead's onDeathRegister dispatch (registered above) handles
          // succession; nothing else to do here.
        } else {
          // no identity registry loaded at all → fall back to running
          // succession directly so the feature still works end-to-end.
          succeedCompanyOwner(co);
        }
      }
    }
  }

  function build(arena) {
    const lots = (arena.lots || []).filter(claimable);
    if (lots.length < 4) return false;             // too early (owners not stamped) or too small — retry
    // tear down any prior roster cleanly
    for (const co of companies) { for (const lot of co.lots) restoreOwner(lot); despawnOwner(co); }
    companies = [];
    arenaRef = arena;
    for (const l of lots) l._company = null;
    const A = CBZ.city && CBZ.city.arena;

    const N = Math.max(4, Math.min(14, Math.floor(lots.length / 6)));
    const pool = lots.slice();
    for (let i = pool.length - 1; i > 0; i--) { const j = rint(i + 1); const t = pool[i]; pool[i] = pool[j]; pool[j] = t; }

    let pi = 0; const used = {};
    for (let i = 0; i < N && pi < pool.length; i++) {
      let name, guard = 0;
      do { name = pick(PRE) + " " + pick(SUF); } while (used[name] && guard++ < 24);
      used[name] = 1;
      const hq = pool[pi++];
      const co = { id: "co" + i, name: name, sector: pick(SECTORS), hq: hq,
        cash: 60000 + rint(420000), lots: [hq], growth: 0, owner: null };
      hq._company = co; tagOwner(hq, co);
      companies.push(co);
      co.owner = spawnOwner(co, A);
    }
    // hand the remaining claimable lots out as starting portfolios
    for (; pi < pool.length; pi++) {
      const co = companies[rint(companies.length)];
      const lot = pool[pi];
      co.lots.push(lot); lot._company = co; tagOwner(lot, co);
    }
    return true;
  }

  // drop any portfolio lot that the player has since taken (keeps the overlay
  // honest without ever fighting zillow/empire for ownership)
  function prune(co) {
    for (let i = co.lots.length - 1; i > 0; i--) {       // index 0 = HQ, kept
      if (!claimable(co.lots[i])) { co.lots[i]._company = null; co.lots.splice(i, 1); }
    }
  }

  // one market move: rent income, then expand / divest / bust
  function marketMove() {
    if (!companies.length || !arenaRef) return;
    const arena = arenaRef;
    const co = companies[rint(companies.length)];
    prune(co);
    co.cash += co.lots.reduce((s, l) => s + lotValue(l) * 0.012, 0);   // rent roll

    const roll = rng();
    if (roll < 0.44 && co.cash > 130000) {
      // EXPAND — claim an un-companied lot, preferring the HQ's district
      const free = (arena.lots || []).filter(l => claimable(l) && !l._company);
      if (free.length) {
        free.sort((a, b) => (b.district === co.hq.district) - (a.district === co.hq.district));
        const lot = free[0], cost = lotValue(lot);
        if (co.cash >= cost) {
          co.cash -= cost; co.lots.push(lot); lot._company = co; tagOwner(lot, co); co.growth++;
          note("📈 " + co.name + " acquired a property in " + districtName(arena, lot.district));
        }
      }
    } else if (roll < 0.64 && co.lots.length > 2) {
      // DIVEST — release a non-HQ lot back to the open market
      const lot = co.lots[1 + rint(co.lots.length - 1)];
      const v = lotValue(lot);
      const i = co.lots.indexOf(lot); if (i > 0) co.lots.splice(i, 1);
      lot._company = null; restoreOwner(lot);
      co.cash += v * 0.9;
      note("📉 " + co.name + " sold off a " + districtName(arena, lot.district) + " property");
    } else if (roll < 0.72 && co.cash < 45000 && co.lots.length > 3) {
      // BUST — the firm collapses, its portfolio dumped on the market
      const n = co.lots.length - 1;
      for (let i = co.lots.length - 1; i > 0; i--) { co.lots[i]._company = null; restoreOwner(co.lots[i]); }
      co.lots.length = 1; co.cash = 60000 + rint(120000); co.growth = 0;
      note("💥 " + co.name + " COLLAPSED — " + n + " properties dumped on the market", "#ff9a6b");
    }
    if (co.growth > 0 && co.growth % 4 === 0) {
      note("🏢 " + co.name + " is booming — " + co.lots.length + " properties under management");
      co.growth++;
    }
  }

  // ---- public API ------------------------------------------------------
  CBZ.cityCompanies = {
    list: function () { return companies; },
    ofLot: function (lot) { return lot && lot._company ? { name: lot._company.name, sector: lot._company.sector } : null; },
    objOfLot: function (lot) { return (lot && lot._company) || null; },   // raw company record (citystaff.js ties workers/queues to it)
    forDistrict: function (dq) { return companies.filter(function (c) { return c.lots.some(function (l) { return l.district === dq; }); }); },
    count: function () { return companies.length; },
    ownerOf: function (lot) { const c = lot && lot._company; return c ? c.owner : null; },   // the live owner ped, or null
    reset: function () {
      for (const co of companies) { for (const lot of co.lots) restoreOwner(lot); despawnOwner(co); }
      companies = []; arenaRef = null; tickT = 0;
    },
  };
  CBZ.cityCompaniesReset = CBZ.cityCompanies.reset;

  // tick: (re)build lazily for a fresh arena, then run periodic market moves
  // + the owner-permanence sweep (cheap: ≤14 companies, one ped check each).
  let serveT = 0;
  CBZ.onUpdate(41.7, function (dt) {
    if (!CBZ.game || CBZ.game.mode !== "city") return;
    const arena = CBZ.city && CBZ.city.arena;
    if (!arena || !arena.lots) return;
    if (arena !== arenaRef) {                 // new city → build, retried (with a small backoff) until it takes
      buildCool -= dt;
      if (buildCool > 0) return;
      buildCool = 1.0;
      try { build(arena); } catch (e) {}
      return;
    }
    try { sweepOwners(); } catch (e) {}
    // seniority accrues for the SUCCESSION rank-by-tenure read (rankCandidate
    // above) — counted on the owner AND every live desk/work occupant at each
    // HQ so a long-serving worker genuinely outranks a fresh hire when the
    // owner falls. Cheap: bounded to companies × their own staff, not a scan.
    serveT += dt;
    if (serveT >= 1) {
      const step = serveT; serveT = 0;
      for (let i = 0; i < companies.length; i++) {
        const co = companies[i];
        if (co.owner && !co.owner.dead) ownerStats(co.owner).served += step;
        for (const p of candidateBench(co)) ownerStats(p).served += step;
      }
    }
    tickT += dt;
    if (tickT >= MOVE_EVERY) { tickT = 0; try { marketMove(); } catch (e) {} }
  });
})();
