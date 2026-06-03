/* ============================================================
   city/zillow.js — "Zillow": the city-wide property + business market.

   Press [Z] in city mode to open a scrollable marketplace that lists
   EVERY lot in the city (downtown + the island) — shops, residences,
   parks and gang-run derelicts — each with a Zestimate value.

   • LEGAL property (homes, vacant land) and LEGAL businesses (the shops)
     are FOR SALE. Buying a business hands you its building AND its trade,
     so it pays you rent / profit every cycle (minus property tax).
   • ILLEGAL businesses (the Trap House, the chop shop, gang turf) are
     listed but CANNOT be bought on the open market — they show their
     crew + an estimated street value so the board doubles as a
     "who's the biggest" empire ranking (you vs. holding companies vs.
     the gangs).
   • Sell anything you own back to the market for a small realtor cut.

   Ownership is per-life (resets each run). Static facts (value, address,
   legality, the business name) are computed ONCE when the city is built
   and memoised on the arena, so a listing's price never wobbles.

   Exposes: CBZ.cityOpenZillow, CBZ.cityZillow, CBZ.cityZillowReset.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const g = CBZ.game;
  const C = () => CBZ.CITY || {};

  // ---- balance knobs --------------------------------------------------------
  // Tuned so a single business is a steady trickle (payback ~an hour), NOT an
  // ATM, and a sprawling empire suffers diminishing returns (PORTFOLIO_DRAG) so
  // it can't compound into an unbounded money fountain that trivialises the city.
  const INCOME_TICK = 11;        // seconds between rent / business-profit payouts
  const TAX_PER_TICK = 0.0022;   // property tax per income tick (fraction of value)
  const SELL_CUT = 0.90;         // you recoup 90% of value when you sell (realtor fee)
  const YIELD = { residence: 0.0035, commercial: 0.005, land: 0.0018, illegal: 0 };
  const PORTFOLIO_DRAG = 0.05;   // net income /= (1 + DRAG × number of income properties)
  // ---- RENT (you renting FROM the market) ----------------------------------
  // Renting costs little/nothing upfront but a recurring charge; miss it and
  // you're evicted. The rent/cycle is a fraction of the *current* value.
  const RENT_FRAC = { residence: 0.012, commercial: 0.018, land: 0.006 };
  const RENT_DEPOSIT = 0.5;      // upfront deposit = RENT_DEPOSIT × first rent
  // ---- RENT OUT (NPC tenants in property YOU own) --------------------------
  // A scaling, better-than-workers passive income with occasional vacancies.
  const TENANT_YIELD = { residence: 0.011, commercial: 0.016, land: 0.004 };
  const VACANCY_BASE = 0.10;     // base chance a unit sits empty (no income) per cycle

  // the named business magnates who own the city's legit businesses & rentals
  // at the start of every life — every business has a real OWNER. Buying
  // transfers a property to YOU; selling hands it back to one of them. They're
  // the rivals on the empire leaderboard ("who's the biggest").
  const CORPS = [
    { id: "corp_castellano", name: "Don Castellano", color: 0x5b8bff },
    { id: "corp_vance",      name: "Marla Vance",    color: 0xf2c43d },
    { id: "corp_sterling",   name: "Rico Sterling",  color: 0x9b6bff },
    { id: "corp_okafor",     name: "Ada Okafor",     color: 0x49c46e },
    { id: "corp_petrov",     name: "Yuri Petrov",    color: 0xe88a3c },
    { id: "corp_zhang",      name: "Vivian Zhang",   color: 0x39d0c0 },
  ];
  const PLAYER = { id: "player", name: "You", color: 0x7ed957 };
  const CITYHALL = { id: "city", name: "City of Libertyville", color: 0x8a93a3 };
  const UNDERWORLD = { id: "underworld", name: "Unaffiliated Crew", color: 0xb0606e };

  // base $ value by business trade (× storeys × location × noise, below)
  const COMMERCIAL_BASE = {
    bank: 130000, jewelry: 72000, carlot: 68000, hospital: 88000, guns: 46000,
    electronics: 40000, bar: 52000, security: 38000, realtor: 50000, gym: 30000,
    clothing: 28000, pawn: 25000, hardware: 22000, gas: 34000, food: 21000, barber: 17000,
  };
  const ILLEGAL_BASE = { drugs: 60000, chop: 44000 };   // street value of the operation
  const ILLEGAL_KINDS = { drugs: 1, chop: 1, abandoned: 1 };

  // friendly trade labels for the card subtitle
  const KIND_LABEL = {
    bank: "Bank", jewelry: "Jeweler", carlot: "Auto Dealer", hospital: "Hospital",
    guns: "Gun Store", electronics: "Electronics", bar: "Nightclub", security: "Security Firm",
    realtor: "Realty Office", gym: "Gym", clothing: "Boutique", pawn: "Pawn Shop",
    hardware: "Hardware Store", gas: "Gas Station", food: "Diner", barber: "Barber Shop",
    drugs: "Trap House", chop: "Chop Shop", abandoned: "Gang Turf",
    tower: "Residence", park: "Parkland",
  };
  const STREETS = ["Maple Ave", "Oak St", "Sunset Blvd", "Vine St", "Lincoln Way",
    "Industrial Row", "Park Pl", "Harbor Way", "Crest Dr", "Madison Ave", "Dover Ln", "Kingsway"];

  // ---- property TIERS (variety / status badges on listings) -----------------
  // A value-banded tier gives the board real range — from a Tier-1 starter to a
  // Tier-5 trophy asset — and drives a flavour adjective on the card subtitle.
  const TIERS = [
    { min: 0,       name: "Starter",   tag: "🟢 Tier 1" },
    { min: 18000,   name: "Standard",  tag: "🔵 Tier 2" },
    { min: 45000,   name: "Premium",   tag: "🟣 Tier 3" },
    { min: 90000,   name: "Luxury",    tag: "🟠 Tier 4" },
    { min: 160000,  name: "Trophy",    tag: "🔴 Tier 5" },
  ];
  function tierFor(value) { let t = TIERS[0]; for (const x of TIERS) if (value >= x.min) t = x; return t; }
  // a tiny bit of per-lot character so subtitles aren't all identical
  const RES_FLAVOR = ["renovated", "sun-filled", "corner-unit", "loft-style", "park-view", "quiet-street", "modern", "classic"];
  const COM_FLAVOR = ["high-traffic", "established", "turnkey", "flagship", "well-known", "busy-corner"];

  // ---- per-lot deterministic RNG (stable value/address across opens) ---------
  function lotRng(lot, idx) {
    let s = (((lot.i | 0) + 1) * 73856093) ^ (((lot.j | 0) + 1) * 19349663)
      ^ ((Math.round(lot.cx || 0) + 4096) * 83492791) ^ ((idx + 7) * 2654435761);
    s = s >>> 0;
    return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  }
  function round500(n) { return Math.max(0, Math.round(n / 500) * 500); }
  function money(n) { return "$" + (n | 0).toLocaleString(); }
  function corpFor(rnd) { return CORPS[(rnd() * CORPS.length) | 0]; }
  function ownerInfo(id) {
    if (id === "player") return PLAYER;
    if (id === "city") return CITYHALL;
    if (id === "underworld") return UNDERWORLD;
    const c = CORPS.find((x) => x.id === id);
    if (c) return c;
    const gd = (C().gangs || []).find((x) => x.id === id);
    if (gd) {
      const live = (CBZ.cityGangs || []).find((x) => x.id === gd.id);
      return { id: gd.id, name: gd.name + (live && live.bossName ? " — " + live.bossName : ""), color: gd.color };
    }
    return UNDERWORLD;
  }

  // ---- build the static registry once, memoised on the arena -----------------
  function ensureRegistry() {
    const A = CBZ.city && CBZ.city.arena;
    if (!A) return null;
    if (A.realty) return A.realty;

    const center = A.center || { x: 0, z: 0 };
    const lots = [].concat(A.lots || [], (A.annex && A.annex.lots) || []);
    // farthest lot from centre → normalises the downtown location premium
    let maxD = 1;
    for (const l of lots) { const d = Math.hypot((l.cx || 0) - center.x, (l.cz || 0) - center.z); if (d > maxD) maxD = d; }

    const listings = [], byId = {};
    lots.forEach((lot, idx) => {
      const rnd = lotRng(lot, idx);
      const b = lot.building || null;
      const kind = lot.kind || (b && b.shop && b.shop.kind) || "land";
      const storeys = Math.max(1, (b && b.storeys) || 1);
      const island = lot.district === "island";
      const dist = Math.hypot((lot.cx || 0) - center.x, (lot.cz || 0) - center.z);
      const loc = 1 + 0.55 * (1 - Math.min(1, dist / maxD));   // 1.0 (edge) .. 1.55 (downtown)
      const noise = 0.9 + rnd() * 0.2;

      let category, legal = true, value = 0, business = null, ownerId, name;

      if (kind === "park") {
        category = "land";
        const area = (lot.w || 30) * (lot.d || 30);
        value = round500((18000 + area * 90) * loc * noise);
        name = "Public Park";
        ownerId = "city";
      } else if (ILLEGAL_KINDS[kind]) {
        // illegal operation — listed for the rankings, never for sale
        category = "illegal"; legal = false;
        if (kind === "abandoned") {
          const st = b && b.stash;
          value = round500((14000 + storeys * 7000 + (st ? st.cash * 6 : 0)) * loc * noise);
          name = "Derelict Block";
          business = { name: "Gang Turf", kind: "abandoned" };
        } else {
          value = round500((ILLEGAL_BASE[kind] || 40000) * (0.85 + storeys * 0.15) * loc * noise);
          name = (b && b.name) || KIND_LABEL[kind] || "Illegal Business";
          business = { name, kind };
        }
        ownerId = "underworld";   // resolved to the live gang at render time
      } else if (b && b.shop || COMMERCIAL_BASE[kind] || kind === "gas" || kind === "carlot") {
        category = "commercial";
        const base = COMMERCIAL_BASE[kind] || 30000;
        value = round500(base * (0.8 + 0.22 * storeys) * loc * noise);
        name = (b && b.name) || KIND_LABEL[kind] || "Business";
        business = { name, kind };
        ownerId = corpFor(rnd).id;
      } else {
        // residence / tower
        category = "residence";
        const home = b && b.home;
        if (home && home.price > 0) value = round500(home.price * (0.95 + rnd() * 0.18));
        else value = round500((9000 * storeys + (lot.w || 24) * (lot.d || 24) * 22) * loc * noise);
        name = (home && home.name) || (b && b.name) || (island ? "Island Tower" : "Apartments");
        ownerId = corpFor(rnd).id;
      }

      const num = 100 + (((lot.i | 0) * 17 + (lot.j | 0) * 7 + idx * 3) % 89) * 10;
      const street = STREETS[(idx + (lot.i | 0)) % STREETS.length];
      const addr = num + " " + street + (island ? ", Bay Island" : "");

      const flavor = category === "residence" ? RES_FLAVOR[(rnd() * RES_FLAVOR.length) | 0]
        : category === "commercial" ? COM_FLAVOR[(rnd() * COM_FLAVOR.length) | 0] : "";
      const rec = {
        id: "p" + idx,
        lot, idx, district: island ? "island" : "downtown",
        kind, category, legal, base: value, value, name, address: addr,
        beds: (b && b.home && b.home.beds) || 0,
        storeys, business, flavor,
        // a stable per-lot "beta": how much this property swings with the market
        beta: 0.7 + rnd() * 0.6,
        initialOwnerId: ownerId, ownerId,
        rent: round5(value * (YIELD[category] || 0)),
      };
      listings.push(rec); byId[rec.id] = rec;
    });

    A.realty = { listings, byId };
    return A.realty;
  }
  function round5(n) { return Math.max(0, Math.round(n / 5) * 5); }

  function reg() { return ensureRegistry(); }
  function ownedSet() { return (g.cityRealtyOwned = g.cityRealtyOwned || {}); }
  function homeObj(rec) { return rec.lot.building && rec.lot.building.home; }

  // ---- LIVE market value: base × macro index (scaled by the lot's beta) ------
  // Zillow shows a Zestimate that breathes with the housing market. A property's
  // *base* is fixed at build time; the displayed value floats with the city
  // index so a buy-low/sell-high game exists. Owned value updates too.
  function marketIndex() { return (CBZ.cityEcon && CBZ.cityEcon.propIndex) ? CBZ.cityEcon.propIndex() : 1; }
  function mval(rec) {
    const idx = marketIndex();
    const swing = 1 + (idx - 1) * (rec.beta || 1);      // beta scales the swing
    rec.value = round500((rec.base || rec.value || 0) * Math.max(0.5, swing));
    return rec.value;
  }
  function refreshAllValues() { const r = reg(); if (r) for (const rec of r.listings) mval(rec); }
  function trendTag() {
    const t = (CBZ.cityEcon && CBZ.cityEcon.propTrend) ? CBZ.cityEcon.propTrend() : "steady";
    const idx = marketIndex();
    const pct = Math.round((idx - 1) * 100);
    if (t === "rising") return "📈 Market hot " + (pct >= 0 ? "+" : "") + pct + "%";
    if (t === "falling") return "📉 Market cooling " + pct + "%";
    return "➖ Market flat " + (pct >= 0 ? "+" : "") + pct + "%";
  }

  // ---- RENT (player renting FROM the market) --------------------------------
  // g.cityRentals: { recId: { rent, sinceTick, isHome } } — what you rent.
  function rentals() { return (g.cityRentals = g.cityRentals || {}); }
  function isRenting(rec) { return !!rentals()[rec.id]; }
  function rentFor(rec) { return round5(mval(rec) * (RENT_FRAC[rec.category] || 0.012)); }

  // ---- FINANCE / mortgage (financed buys) -----------------------------------
  // g.cityMortgages: { recId: { balance, orig, rate } } — debt against a buy.
  function mortgages() { return (g.cityMortgages = g.cityMortgages || {}); }
  function mortgageOf(rec) { return mortgages()[rec.id] || null; }
  function FIN() { return (CBZ.cityEcon && CBZ.cityEcon.FINANCE) || { minDownFrac: 0.2, rate: 0.06, minPaymentFrac: 0.04, maxLTV: 0.8 }; }
  // equity you actually hold in a property = value − outstanding mortgage
  function equity(rec) { const m = mortgageOf(rec); return Math.max(0, mval(rec) - (m ? m.balance : 0)); }

  // ---- RENT OUT (NPC tenants in property YOU own) ---------------------------
  // g.cityTenants: { recId: { occupied:bool, name, nextCheck } } lazily filled.
  function tenants() { return (g.cityTenants = g.cityTenants || {}); }
  function TENANT_NAMES() { return ["the Ramirez family", "a young couple", "a startup", "a retiree", "a barista", "a remote worker", "a corner store", "a nail salon", "a med student"]; }
  // SINGLE SOURCE OF TRUTH for ownership: a residence's `home.owned` flag is shared
  // with city/realestate.js (the realtor + the [H] safehouse), so Zillow and the
  // realtor can never disagree about who owns a house — buy at either, it shows
  // OWNED in both; "move up" at the realtor releases the old place in both.
  // Businesses / land / island towers (no home object) live in Zillow's ownedSet.
  function isOwned(rec) { const h = homeObj(rec); return h ? !!h.owned : !!ownedSet()[rec.id]; }
  function isHome(rec) { return !!(g.cityHome && g.cityHome.lot === rec.lot); }

  // effective owner of a listing right now (drives the rankings)
  function effOwnerId(rec) {
    if (isOwned(rec)) return "player";
    if (!rec.legal) {
      const live = rec.lot.building && rec.lot.building.gang;   // gangs.js tags this on reset
      return live || rec.initialOwnerId || "underworld";
    }
    return rec.ownerId;
  }
  function statusOf(rec) {
    if (isOwned(rec)) {
      if (isHome(rec)) return "YOUR HOME";
      return mortgageOf(rec) ? "FINANCED" : "OWNED";
    }
    if (isRenting(rec)) return rentals()[rec.id].isHome ? "RENTED (HOME)" : "RENTED";
    if (!rec.legal) return "NOT FOR SALE";
    return "FOR SALE";
  }
  function canBuy(rec) { return rec.legal && !isOwned(rec) && !isRenting(rec); }
  function canRent(rec) { return rec.legal && rec.category !== "land" && !isOwned(rec) && !isRenting(rec); }
  function canFinance(rec) { return canBuy(rec) && mval(rec) >= 8000; }

  // ---- transactions ---------------------------------------------------------
  // feedback while the panel is up (the engine toast is occluded by the overlay)
  let lastMsg = "", lastTone = "ok";
  function flash(msg, tone) { lastMsg = msg; lastTone = tone || "ok"; }

  // ---- persistence: mirror the portfolio into the world ledger --------------
  // cityWorldEnsure().assets.properties is the durable record (survives runs);
  // g.* holds the live per-run state realestate.js ticks against.
  function persist() {
    if (!CBZ.cityWorldEnsure) return;
    const w = CBZ.cityWorldEnsure(); if (!w || !w.assets) return;
    const r = reg(); if (!r) return;
    const list = [];
    for (const rec of r.listings) {
      const owned = isOwned(rec), renting = isRenting(rec);
      if (!owned && !renting) continue;
      const m = mortgageOf(rec), t = tenants()[rec.id];
      list.push({
        id: rec.id, name: rec.business ? rec.business.name : rec.name, address: rec.address,
        category: rec.category, kind: rec.kind, value: mval(rec),
        tenure: owned ? (m ? "financed" : "owned") : "rented",
        mortgage: m ? Math.round(m.balance) : 0,
        rentedOut: !!(owned && !isHome(rec) && t && t.occupied),
        isHome: isHome(rec) || (renting && rentals()[rec.id].isHome),
      });
    }
    w.assets.properties = list;
  }

  // pull `amt` from cash first, then bank. Returns false (no charge) if short.
  function charge(amt) {
    if (((g.cash || 0) + (g.cityBank || 0)) < amt) return false;
    let owe = amt; const fromCash = Math.min(g.cash || 0, owe);
    g.cash = (g.cash || 0) - fromCash; owe -= fromCash; if (owe > 0) g.cityBank = (g.cityBank || 0) - owe;
    return true;
  }

  // finalise ownership of a residence (home record + respawn for the first one)
  function takeResidence(rec) {
    if (rec.category === "residence" && rec.lot.building && rec.lot.building.home) {
      rec.lot.building.home.owned = true;
      if (!g.cityHome) setAsHome(rec, true);
    }
  }

  function buy(id) {
    const r = reg(); if (!r) return;
    const rec = r.byId[id]; if (!rec) return;
    if (!rec.legal) { flash("⛔ " + rec.name + " is an illegal operation — take it by force, not by cheque.", "bad"); CBZ.city.note("That's an illegal operation — not for sale.", 2.2); if (CBZ.sfx) CBZ.sfx("empty"); refresh(); return; }
    if (isOwned(rec)) { flash("You already own " + rec.name + ".", "bad"); refresh(); return; }
    if (isRenting(rec)) { endRent(id, true); }   // buying out your own rental
    const price = mval(rec);
    if (((g.cash || 0) + (g.cityBank || 0)) < price) { flash("⛔ Need " + money(price) + " (cash + bank) to close. Try Finance.", "bad"); CBZ.city.note("Need " + money(price) + " to close.", 2); if (CBZ.sfx) CBZ.sfx("empty"); refresh(); return; }
    charge(price);
    delete mortgages()[rec.id];
    ownedSet()[rec.id] = true; rec.ownerId = "player";
    takeResidence(rec);
    CBZ.city.addRespect(Math.max(1, Math.min(40, Math.round(price / 8000))));
    const headline = (rec.business ? "🏢 Acquired " + rec.business.name : "🏠 Bought " + rec.name) + "!";
    flash("✅ " + headline + " for " + money(price), "ok"); CBZ.city.big(headline);
    if (CBZ.sfx) CBZ.sfx("coin");
    persist(); if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    refresh();
  }

  // ---- finance: put a down payment, carry a mortgage on the rest ------------
  function financeBuy(id) {
    const r = reg(); if (!r) return;
    const rec = r.byId[id]; if (!rec) return;
    if (!canFinance(rec)) { flash("Can't finance that.", "bad"); refresh(); return; }
    const f = FIN();
    const price = mval(rec);
    const down = round500(price * f.minDownFrac);
    if (((g.cash || 0) + (g.cityBank || 0)) < down) { flash("⛔ Need " + money(down) + " down (20%) to finance.", "bad"); CBZ.city.note("Need " + money(down) + " down.", 2); if (CBZ.sfx) CBZ.sfx("empty"); refresh(); return; }
    charge(down);
    const bal = price - down;
    mortgages()[rec.id] = { balance: bal, orig: bal, rate: f.rate };
    ownedSet()[rec.id] = true; rec.ownerId = "player";
    takeResidence(rec);
    CBZ.city.addRespect(Math.max(1, Math.min(20, Math.round(down / 8000))));
    flash("🏦 Financed " + (rec.business ? rec.business.name : rec.name) + " — " + money(down) + " down, " + money(bal) + " owed.", "ok");
    CBZ.city.big("🏦 Financed " + rec.name);
    if (CBZ.sfx) CBZ.sfx("coin");
    persist(); if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    refresh();
  }
  // pay down a chunk of an outstanding mortgage (or clear it)
  function payMortgage(id, frac) {
    const r = reg(); if (!r) return;
    const rec = r.byId[id]; const m = rec && mortgageOf(rec); if (!m) return;
    let pay = frac >= 1 ? m.balance : round500(m.balance * frac);
    pay = Math.min(pay, m.balance);
    if (pay <= 0) return;
    if (((g.cash || 0) + (g.cityBank || 0)) < pay) { flash("⛔ Need " + money(pay) + " to pay down.", "bad"); if (CBZ.sfx) CBZ.sfx("empty"); refresh(); return; }
    charge(pay);
    m.balance -= pay;
    if (m.balance <= 1) { delete mortgages()[rec.id]; flash("✅ Mortgage cleared on " + rec.name + " — you own it outright.", "ok"); CBZ.city.big("Mortgage cleared!"); }
    else flash("🏦 Paid " + money(pay) + " toward " + rec.name + " — " + money(m.balance) + " left.", "ok");
    if (CBZ.sfx) CBZ.sfx("coin");
    persist(); if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    refresh();
  }

  // ---- rent (player rents FROM the market) ---------------------------------
  function rent(id) {
    const r = reg(); if (!r) return;
    const rec = r.byId[id]; if (!rec || !canRent(rec)) { flash("Can't rent that.", "bad"); refresh(); return; }
    const per = rentFor(rec);
    const deposit = round5(per * RENT_DEPOSIT);
    if (((g.cash || 0) + (g.cityBank || 0)) < deposit) { flash("⛔ Need " + money(deposit) + " deposit to move in.", "bad"); if (CBZ.sfx) CBZ.sfx("empty"); refresh(); return; }
    if (deposit > 0) charge(deposit);
    const isHomeRental = rec.category === "residence";
    rentals()[rec.id] = { rent: per, isHome: isHomeRental, missed: 0 };
    // renting a HOME gives you a respawn point, just like owning, if you have none
    if (isHomeRental && !g.cityHome && rec.lot.building) {
      const door = rec.lot.building.door || { x: rec.lot.cx, z: rec.lot.cz };
      g.citySpawnPoint = { x: door.x, z: door.z };
      g.cityRentedHome = rec.id;
    }
    flash("🔑 Rented " + rec.name + " — " + money(per) + "/cycle" + (isHomeRental ? " · respawn set" : "") + ".", "ok");
    CBZ.city.big("🔑 Leased " + rec.name);
    if (CBZ.sfx) CBZ.sfx("coin");
    persist(); if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    refresh();
  }
  function endRent(id, quiet) {
    const rec = reg() && reg().byId[id]; if (!rec) return;
    const had = rentals()[rec.id]; if (!had) return;
    delete rentals()[rec.id];
    if (g.cityRentedHome === rec.id) {
      g.cityRentedHome = null;
      if (!g.cityHome) { g.citySpawnPoint = null; if (!quiet) CBZ.city.note("Lease ended — no respawn point until you rent/buy a home.", 2.4); }
    }
    if (!quiet) { flash("📦 Ended your lease on " + rec.name + ".", "ok"); persist(); refresh(); }
  }
  // make a residence you RENT your respawn home (no garage/safe — that needs ownership)
  function rentSetHome(id) {
    const rec = reg() && reg().byId[id]; if (!rec) return;
    const lease = rentals()[rec.id]; if (!lease || !lease.isHome) { flash("Only a rented residence can be your home base.", "bad"); refresh(); return; }
    if (g.cityHome) { flash("You already own a home — that's your respawn.", "bad"); refresh(); return; }
    const door = rec.lot.building && rec.lot.building.door || { x: rec.lot.cx, z: rec.lot.cz };
    g.citySpawnPoint = { x: door.x, z: door.z };
    g.cityRentedHome = rec.id;
    flash("🏠 " + rec.name + " is now your home base — respawn set.", "ok");
    CBZ.city.note("🏠 Respawn point set to " + rec.name + ".", 2.2);
    persist(); refresh();
  }

  function sell(id) {
    const r = reg(); if (!r) return;
    const rec = r.byId[id]; if (!rec || !isOwned(rec)) return;
    const gross = round500(mval(rec) * SELL_CUT);
    const m = mortgageOf(rec);
    const payoff = m ? Math.round(m.balance) : 0;     // the bank gets paid first
    const got = Math.max(0, gross - payoff);
    CBZ.city.addCash(got);
    delete ownedSet()[rec.id];
    delete mortgages()[rec.id];
    delete tenants()[rec.id];
    rec.ownerId = rec.initialOwnerId;
    if (rec.lot.building && rec.lot.building.home) rec.lot.building.home.owned = false;
    if (isHome(rec)) { g.cityHome = null; g.citySpawnPoint = null; CBZ.city.note("Sold your home — no respawn point until you buy another.", 2.6); }
    const note = payoff > 0 ? "💸 Sold " + rec.name + " for " + money(gross) + " (−" + money(payoff) + " mortgage = +" + money(got) + ")." : "💸 Sold " + rec.name + " for " + money(got) + ".";
    flash(note, "ok"); CBZ.city.big("SOLD " + rec.name + " — +" + money(got));
    if (CBZ.sfx) CBZ.sfx("coin");
    persist(); if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    refresh();
  }

  // make an owned residence the safehouse (respawn / heal / garage via [H])
  function setAsHome(rec, quiet) {
    if (!rec || !isOwned(rec)) return;
    const b = rec.lot.building, home = b && b.home;
    if (!home) { flash("Only a residence can be your home.", "bad"); CBZ.city.note("Only a residence can be your home.", 1.8); refresh(); return; }
    // moving residency keeps the old place owned as a RENTAL (you paid for it) —
    // it just stops being your respawn/safehouse and starts earning rent.
    const movedFrom = (g.cityHome && g.cityHome.lot !== rec.lot) ? g.cityHome.name : null;
    home.owned = true;
    g.cityHome = { lot: rec.lot, tier: home.tier, id: home.id, name: home.name };
    g.cityRentTier = null;
    g.cityRentedHome = null;   // an owned home supersedes any rented home base
    const door = (b.door || { x: rec.lot.cx, z: rec.lot.cz });
    g.citySpawnPoint = { x: door.x, z: door.z };
    if (!quiet) {
      flash("🏡 " + home.name + " is now your home" + (movedFrom ? " — " + movedFrom + " becomes a rental" : "") + ".", "ok");
      CBZ.city.note("🏡 " + home.name + " is now your home — respawn point set.", 2.4);
      refresh();
    }
  }
  function setHome(id) { const r = reg(); if (r) setAsHome(r.byId[id], false); }

  // ---- empire rankings ("who's the biggest") --------------------------------
  function rankings() {
    const r = reg(); if (!r) return [];
    const tally = {};
    function bump(id, value) {
      const o = tally[id] || (tally[id] = { id, count: 0, value: 0 });
      o.count++; o.value += value;
    }
    for (const rec of r.listings) bump(effOwnerId(rec), rec.value);
    // make sure the player + every faction appear even with nothing
    if (!tally.player) tally.player = { id: "player", count: 0, value: 0 };
    const rows = Object.keys(tally).map((id) => {
      const info = ownerInfo(id);
      return { id, name: info.name, color: info.color, count: tally[id].count, value: tally[id].value, you: id === "player" };
    });
    rows.sort((a, b) => b.value - a.value || b.count - a.count);
    return rows;
  }
  function playerEmpire() {
    const r = reg(); if (!r) return { count: 0, value: 0, equity: 0, debt: 0 };
    let count = 0, value = 0, eq = 0, debt = 0;
    for (const rec of r.listings) if (isOwned(rec)) {
      count++; const v = mval(rec); value += v;
      const m = mortgageOf(rec); if (m) debt += m.balance;
      eq += equity(rec);
    }
    return { count, value, equity: Math.round(eq), debt: Math.round(debt) };
  }

  // ---- the property economy TICK (driven by realestate.js at order 38.4) ----
  // Revalue with the market, then settle, per income cycle:
  //   • rent-out income from owned non-home units (scaling, with vacancies)
  //   • property tax on everything you own
  //   • mortgage interest + minimum payment on financed properties
  //   • the rent YOU owe on properties you lease (eviction if you can't pay)
  // Returns true if any UI-visible change happened (so the panel refreshes).
  let incomeT = INCOME_TICK;
  function economyTick(dt) {
    refreshAllValues();                    // every listing's Zestimate breathes
    if (isOpen()) refresh();               // keep the market panel live
    incomeT -= dt; if (incomeT > 0) return;
    incomeT = INCOME_TICK;
    const r = reg(); if (!r) return;
    let net = 0, n = 0, vac = 0, evicted = null;

    // --- properties YOU own: rent-out income, tax, mortgage service ---
    for (const rec of r.listings) {
      if (!isOwned(rec)) continue;
      const v = mval(rec);
      const tax = Math.round(v * TAX_PER_TICK);
      const m = mortgageOf(rec);
      if (m && m.balance > 0) {
        // interest accrues; a minimum payment (always > interest, so the loan
        // actually amortizes down) is auto-deducted toward principal.
        const interest = Math.round(m.balance * m.rate);
        m.balance += interest;
        const minPay = Math.min(m.balance, Math.max(interest + 50, Math.round(m.orig * FIN().minPaymentFrac)));
        if (charge(minPay)) m.balance = Math.max(0, m.balance - minPay);
        // else can't service: balance just grows (no eviction; mortgage compounds)
        if (m.balance <= 1) delete mortgages()[rec.id];
      }
      if (isHome(rec)) { net -= tax; continue; }   // your residence pays tax, earns no rent
      n++;
      // rent-out: an NPC tenant pays scaling rent unless the unit is vacant
      const t = tenants()[rec.id] || (tenants()[rec.id] = { occupied: true, name: "" });
      // re-roll occupancy each cycle: bigger places have lower vacancy
      const vacChance = VACANCY_BASE * (rec.category === "commercial" ? 1.2 : 1) * (0.6 + 600 / Math.max(600, v));
      if (Math.random() < vacChance) { t.occupied = false; t.name = ""; vac++; }
      else if (!t.occupied) { t.occupied = true; t.name = TENANT_NAMES()[(Math.random() * 9) | 0]; }
      const income = t.occupied ? round5(v * (TENANT_YIELD[rec.category] || 0.01)) : 0;
      net += income - tax;
    }
    if (n > 0 && net > 0) net = Math.round(net / (1 + PORTFOLIO_DRAG * n));   // empire diminishing returns

    if (net > 0) { CBZ.city.addCash(net); CBZ.city.note("🏢 Portfolio +" + money(net) + " (" + n + " unit" + (n === 1 ? "" : "s") + (vac ? ", " + vac + " vacant" : "") + ")", 2); }
    else if (net < 0) {
      let owe = -net; const fromCash = Math.min(g.cash || 0, owe); g.cash = (g.cash || 0) - fromCash; owe -= fromCash;
      if (owe > 0) g.cityBank = Math.max(0, (g.cityBank || 0) - owe);
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
      CBZ.city.note("🏢 Property upkeep -" + money(-net), 1.8);
    }

    // --- properties YOU rent: pay the landlord or get evicted ---
    const rs = rentals();
    for (const id in rs) {
      const lease = rs[id]; const rec = r.byId[id]; if (!rec) { delete rs[id]; continue; }
      const due = rentFor(rec); lease.rent = due;
      if (charge(due)) { /* paid */ }
      else {
        evicted = rec.name;
        delete rs[id];
        if (g.cityRentedHome === id) { g.cityRentedHome = null; if (!g.cityHome) g.citySpawnPoint = null; }
      }
    }
    if (evicted) CBZ.city.note("📦 Evicted from " + evicted + " — missed the rent.", 2.6);

    persist();
    if (isOpen()) refresh();
  }
  // expose so realestate.js can drive the single property tick
  CBZ.cityZillowTick = economyTick;

  // ---- reset per life --------------------------------------------------------
  CBZ.cityZillowReset = function () {
    g.cityRealtyOwned = {};
    g.cityRentals = {}; g.cityMortgages = {}; g.cityTenants = {}; g.cityRentedHome = null;
    incomeT = INCOME_TICK;
    if (CBZ.cityEcon && CBZ.cityEcon.initPropMarket) CBZ.cityEcon.initPropMarket();
    const A = CBZ.city && CBZ.city.arena;
    if (A && A.realty) for (const rec of A.realty.listings) { rec.ownerId = rec.initialOwnerId; rec.value = rec.base; }
    if (open_) { CBZ.cityMenuOpen = false; }   // a reset while the market was up releases the screen
    open_ = false;
    if (panel) panel.style.display = "none";
  };

  // ==========================================================================
  //  UI
  // ==========================================================================
  let panel = null, tab = "sale", open_ = false;

  function el() {
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "cityZillow";
    panel.className = "zwrap";
    document.body.appendChild(panel);
    // one delegated click handler survives every re-render
    panel.addEventListener("click", function (e) {
      const t = e.target.closest ? e.target.closest("[data-act]") : null;
      if (!t) return;
      const act = t.getAttribute("data-act"), id = t.getAttribute("data-id");
      if (act === "tab") { tab = id; refresh(); return; }
      if (act === "buy") buy(id);
      else if (act === "finance") financeBuy(id);
      else if (act === "rent") rent(id);
      else if (act === "endrent") endRent(id, false);
      else if (act === "payhalf") payMortgage(id, 0.5);
      else if (act === "payoff") payMortgage(id, 1);
      else if (act === "sell") sell(id);
      else if (act === "home") setHome(id);
      else if (act === "rhome") rentSetHome(id);
      else if (act === "close") close();
    });
    return panel;
  }
  function isOpen() { return open_; }

  function badge(rec) {
    const s = statusOf(rec);
    let cls = "zb-sale";
    if (s === "OWNED" || s === "YOUR HOME" || s === "FINANCED") cls = "zb-own";
    else if (s === "NOT FOR SALE") cls = "zb-illegal";
    else if (s === "RENTED" || s === "RENTED (HOME)") cls = "zb-own";
    return "<span class='zbadge " + cls + "'>" + s + "</span>";
  }
  function icon(rec) {
    if (rec.category === "land") return "🌳";
    if (rec.category === "residence") return "🏠";
    if (!rec.legal) return rec.kind === "abandoned" ? "🏚️" : "💊";
    return "🏪";
  }

  // inline-styled buttons for the new actions (CSS file is owned elsewhere; we
  // reuse .zbtn for layout and only tint via inline background)
  function btn(act, id, label, bg) {
    return "<button class='zbtn' style='background:" + bg + ";color:#fff' data-act='" + act + "' data-id='" + id + "'>" + label + "</button>";
  }

  function card(rec) {
    const v = mval(rec);
    const owner = ownerInfo(effOwnerId(rec));
    const tier = tierFor(rec.base || v);
    const flav = rec.flavor ? rec.flavor.replace(/-/g, " ") + " · " : "";
    const sub = flav + (rec.business ? KIND_LABEL[rec.kind] || "Business" : (rec.category === "land" ? "vacant land" : (rec.beds ? rec.beds + "-bed home" : "residence")))
      + " · " + rec.storeys + (rec.storeys === 1 ? " floor" : " floors") + " · " + rec.district;
    const tierLine = "<div class='zsub' style='color:#9aa7bb'>" + tier.tag + " " + tier.name + "</div>";

    let actions = "", info = "";
    const m = mortgageOf(rec);
    if (isOwned(rec)) {
      const eq = equity(rec);
      const netSale = Math.max(0, round500(v * SELL_CUT) - (m ? Math.round(m.balance) : 0));
      actions += btn("sell", rec.id, "Sell " + money(netSale), "#b8553a");
      if (m) {
        actions += btn("payhalf", rec.id, "Pay ½", "#3a6ea5");
        actions += btn("payoff", rec.id, "Pay off", "#2f6fed");
        info = "<span class='zrent' style='color:#ff9e90'>Mortgage " + money(Math.round(m.balance)) + " @ " + Math.round(m.rate * 100) + "%</span>"
          + "<span class='zrent' style='color:#8fb6ff'>Equity " + money(eq) + "</span>";
      }
      if (rec.category === "residence" && homeObj(rec) && !isHome(rec)) actions += "<button class='zbtn zbtn-home' data-act='home' data-id='" + rec.id + "'>Set as home</button>";
      if (!isHome(rec)) {
        const t = tenants()[rec.id];
        const tincome = round5(v * (TENANT_YIELD[rec.category] || 0.01));
        const occLabel = t && t.occupied === false ? "🚪 VACANT" : (t && t.name ? "🧍 " + t.name : "🧍 leased");
        info += "<span class='zrent'>" + occLabel + " · +" + money(tincome) + "/cyc</span>";
      }
    } else if (isRenting(rec)) {
      const lease = rentals()[rec.id];
      actions += btn("endrent", rec.id, "End lease", "#6b7480");
      if (lease.isHome && g.cityRentedHome !== rec.id && !g.cityHome) actions += btn("rhome", rec.id, "Set as home", "#3a4658");
      info = "<span class='zrent'>Rent " + money(rentFor(rec)) + "/cycle</span>";
    } else if (canBuy(rec)) {
      actions += btn("buy", rec.id, "Buy " + money(v), "#2f9e4f");
      if (canFinance(rec)) actions += btn("finance", rec.id, "Finance " + money(round500(v * FIN().minDownFrac)) + " ↓", "#2f6fed");
      if (canRent(rec)) actions += btn("rent", rec.id, "Rent " + money(rentFor(rec)) + "/cyc", "#7a5cc0");
      // ROI: what owning it nets per cycle vs. its price (rough annualish guide)
      const yld = (TENANT_YIELD[rec.category] || 0) - TAX_PER_TICK;
      const perCyc = Math.round(v * Math.max(0, yld));
      if (perCyc > 0) info = "<span class='zrent' style='color:#9be8b4'>ROI +" + money(perCyc) + "/cyc (" + (yld * 100).toFixed(2) + "%)</span>";
    } else {
      actions += "<span class='znope'>Off market</span>";
    }

    return "<div class='zcard'>"
      + "<div class='zicon'>" + icon(rec) + "</div>"
      + "<div class='zmeta'>"
      + "<div class='zname'>" + (rec.business ? rec.business.name : rec.name) + " " + badge(rec) + "</div>"
      + "<div class='zaddr'>" + rec.address + "</div>"
      + "<div class='zsub'>" + sub + "</div>"
      + tierLine
      + "<div class='zowner'>Owner: <b style='color:#" + ("000000" + owner.color.toString(16)).slice(-6) + "'>" + owner.name + "</b></div>"
      + "</div>"
      + "<div class='zright'>"
      + "<div class='zval'>" + money(v) + "</div>"
      + info
      + "<div class='zacts'>" + actions + "</div>"
      + "</div>"
      + "</div>";
  }

  function listFor(which) {
    const r = reg(); if (!r) return [];
    let arr = r.listings.slice();
    if (which === "sale") arr = arr.filter((x) => canBuy(x));
    else if (which === "owned") arr = arr.filter((x) => isOwned(x));
    else if (which === "rented") arr = arr.filter((x) => isRenting(x));
    else if (which === "illegal") arr = arr.filter((x) => !x.legal);
    // sort: for-sale cheapest first (a ladder), others priciest first
    arr.sort((a, b) => which === "sale" ? mval(a) - mval(b) : mval(b) - mval(a));
    return arr;
  }

  function render() {
    const r = reg();
    refreshAllValues();
    const emp = playerEmpire();
    const ranks = rankings();
    const myRank = ranks.findIndex((x) => x.you) + 1;
    const nRented = Object.keys(rentals()).length;
    let html = "";
    // header
    html += "<div class='zhead'>"
      + "<div class='ztitle'>🏠 Zillow <span class='ztag'>City Property &amp; Business Market</span></div>"
      + "<button class='zx' data-act='close' data-id='x'>✕</button>"
      + "</div>";
    html += "<div class='zstats'>"
      + "<span>Cash <b>" + money(g.cash || 0) + "</b></span>"
      + "<span>Bank <b>" + money(g.cityBank || 0) + "</b></span>"
      + "<span>Empire <b>" + money(emp.value) + "</b> (" + emp.count + ")</span>"
      + (emp.debt > 0 ? "<span>Equity <b>" + money(emp.equity) + "</b> · debt <b style='color:#ff9e90'>" + money(emp.debt) + "</b></span>" : "")
      + "<span>Rank <b>#" + (myRank || "—") + "</b> of " + ranks.length + "</span>"
      + "<span style='color:#cfe0f5'>" + trendTag() + "</span>"
      + "</div>";
    if (lastMsg) html += "<div class='zflash " + (lastTone === "bad" ? "zflash-bad" : "zflash-ok") + "'>" + lastMsg + "</div>";
    // tabs
    const tabs = [["sale", "For Sale"], ["owned", "Owned (" + emp.count + ")"], ["rented", "Renting (" + nRented + ")"], ["illegal", "Black Market"], ["ranks", "Empires"]];
    html += "<div class='ztabs'>";
    for (const [id, label] of tabs) html += "<button class='ztab" + (tab === id ? " on" : "") + "' data-act='tab' data-id='" + id + "'>" + label + "</button>";
    html += "</div>";

    html += "<div class='zlist'>";
    if (tab === "ranks") {
      html += "<div class='zhint'>Total property + business value held by each player. Buy, finance or rent-out to climb.</div>";
      ranks.forEach((row, i) => {
        const col = "#" + ("000000" + row.color.toString(16)).slice(-6);
        html += "<div class='zrank" + (row.you ? " me" : "") + "'>"
          + "<span class='zrnum'>#" + (i + 1) + "</span>"
          + "<span class='zrname' style='color:" + col + "'>" + row.name + (row.you ? " (you)" : "") + "</span>"
          + "<span class='zrcount'>" + row.count + " propert" + (row.count === 1 ? "y" : "ies") + "</span>"
          + "<span class='zrval'>" + money(row.value) + "</span>"
          + "</div>";
      });
    } else {
      if (tab === "sale") html += "<div class='zhint'>Buy outright, FINANCE with 20% down + a mortgage, or RENT for a low deposit. Prices move with the market — buy in a dip.</div>";
      else if (tab === "owned") html += "<div class='zhint'>Owned units you don't live in auto-lease to tenants for scaling passive income (with the odd vacancy). Pay off mortgages to keep more.</div>";
      else if (tab === "rented") html += "<div class='zhint'>Rent is charged every income cycle — miss it and you're evicted. A rented home gives you a respawn point.</div>";
      else if (tab === "illegal") html += "<div class='zhint'>Illegal operations can't be bought on the market — they're held by the crews. Listed so you can see who runs the streets.</div>";
      const arr = listFor(tab);
      if (!arr.length) html += "<div class='zempty'>" + (tab === "owned" ? "You don't own anything yet. Hit the For Sale tab." : tab === "rented" ? "You're not renting anything. Lease a place from For Sale." : "Nothing here.") + "</div>";
      for (const rec of arr) html += card(rec);
    }
    html += "</div>";
    html += "<div class='zfoot'>[Z]/[Esc] close · [1-5] switch tabs · Buy / Finance / Rent · prices float with the market</div>";
    el().innerHTML = html;
  }
  function refresh() { if (open_) render(); }

  function open() {
    if (CBZ.cityMenuOpen) return;        // another city menu owns the screen
    if (!reg()) { CBZ.city && CBZ.city.note("Property market not ready.", 1.4); return; }
    open_ = true; tab = "sale"; lastMsg = ""; CBZ.cityMenuOpen = true;
    el().style.display = "flex";
    render();
    if (document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
  }
  function close() {
    open_ = false; if (panel) panel.style.display = "none";
    CBZ.cityMenuOpen = false;
    if (CBZ.requestLock && g.state === "playing") CBZ.requestLock();
  }
  CBZ.cityOpenZillow = open;
  // does the player own the business/building on this lot? (used by city/empire.js)
  CBZ.cityOwnsLot = function (lot) { const r = reg(); if (!r || !lot) return false; const rec = r.listings.find((x) => x.lot === lot); return rec ? isOwned(rec) : false; };
  function recForLot(lot) { const r = reg(); if (!r || !lot) return null; return r.listings.find((x) => x.lot === lot) || null; }
  CBZ.cityZillow = {
    open, close, buy, finance: financeBuy, rent, sell, setHome, rankings, playerEmpire,
    ownsLot: CBZ.cityOwnsLot, listings: () => reg() && reg().listings, isOpen,
    isRenting: (id) => { const rec = reg() && reg().byId[id]; return rec ? isRenting(rec) : false; },
    // by-lot helpers so the Keystone Realty menu (realestate.js) can offer Rent
    rentByLot: (lot) => { const rec = recForLot(lot); if (rec) rent(rec.id); },
    rentEstimateForLot: (lot) => { const rec = recForLot(lot); return rec && canRent(rec) ? rentFor(rec) : null; },
    isRentingLot: (lot) => { const rec = recForLot(lot); return rec ? isRenting(rec) : false; },
  };

  // ---- key: [Z] toggles the market -----------------------------------------
  addEventListener("keydown", function (e) {
    if (g.mode !== "city" || g.state !== "playing") return;
    const k = (e.key || "").toLowerCase();
    if (open_) {
      if (k === "escape" || k === "z") { e.preventDefault(); close(); return; }
      if (k >= "1" && k <= "5") { e.preventDefault(); tab = ["sale", "owned", "rented", "illegal", "ranks"][parseInt(k, 10) - 1]; render(); return; }
      return;
    }
    if (k === "z" && !e.repeat && !CBZ.cityMenuOpen && !(CBZ.player && CBZ.player.driving)) {
      e.preventDefault(); open();
    }
  });
})();
