/* ============================================================
   city/companies.js — NPC COMPANIES + a living real-estate market.

   WHY: the city's offices/businesses shouldn't be empty set-dressing. Each is
   the HQ of a COMPANY that actually OWNS and TRADES real estate across the
   districts — collecting rent, expanding by buying lots, divesting, booming,
   and occasionally going bankrupt (a fire-sale the player can pounce on). This
   is the "offices are managing real estate and running companies, all in the
   game" layer: a background economy that makes the skyline feel owned.

   ADDITIVE + SAFE by design (does NOT touch the NPC crowd/nav/peds systems a
   parallel wave is building, and never mutates the player's zillow/empire
   ownership): it maintains its OWN company roster + per-lot tag, overlays the
   managing company onto the EXISTING ownership label (business/landlord lots
   only — never the player's home, gang turf, or city property), and surfaces
   moves through the city feed. Read it via CBZ.cityCompanies.

   Runs entirely POST-worldgen on the update loop, so it's free to use
   Math.random without disturbing the deterministic worldgen stream.
   ============================================================ */
(function () {
  if (!window.CBZ) return;
  const CBZ = window.CBZ;

  // ---- procedural company identity -------------------------------------
  const PRE = ["Vantage", "Keystone", "Apex", "Meridian", "Crown", "Atlas", "Pinnacle",
    "Harbor", "Summit", "Onyx", "Cobalt", "Vertex", "Granite", "Beacon", "Sterling",
    "Halcyon", "Ironwood", "Marlow", "Cardinal", "Empyrean", "Dovetail", "Brackish"];
  const SUF = ["Holdings", "Group", "Capital", "Properties", "Realty", "Ventures",
    "Partners", "Industries", "Trust", "Development", "Estates", "& Co.", "Equity",
    "Asset Mgmt", "Acquisitions"];
  const SECTORS = ["real estate", "hospitality", "retail", "finance", "logistics",
    "entertainment", "construction", "media", "tech"];

  let companies = [];
  let arenaRef = null;     // the arena this roster was built for (rebuild on a new city)
  let tickT = 0;
  let buildCool = 0;
  const MOVE_EVERY = 22;   // seconds between market moves (one feed line at most)

  function rint(n) { return (Math.random() * n) | 0; }
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

  function build(arena) {
    const lots = (arena.lots || []).filter(claimable);
    if (lots.length < 4) return false;             // too early (owners not stamped) or too small — retry
    // tear down any prior roster cleanly
    for (const co of companies) for (const lot of co.lots) restoreOwner(lot);
    companies = [];
    arenaRef = arena;
    for (const l of lots) l._company = null;

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
        cash: 60000 + rint(420000), lots: [hq], growth: 0 };
      hq._company = co; tagOwner(hq, co);
      companies.push(co);
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

    const roll = Math.random();
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
    reset: function () { for (const co of companies) for (const lot of co.lots) restoreOwner(lot); companies = []; arenaRef = null; tickT = 0; },
  };
  CBZ.cityCompaniesReset = CBZ.cityCompanies.reset;

  // tick: (re)build lazily for a fresh arena, then run periodic market moves
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
    tickT += dt;
    if (tickT >= MOVE_EVERY) { tickT = 0; try { marketMove(); } catch (e) {} }
  });
})();
