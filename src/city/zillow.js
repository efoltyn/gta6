/* ============================================================
   city/zillow.js — "Zillow": the city-wide property + business market.

   Press [Z] in city mode to open a ONE-SCREEN marketplace (no scrolling —
   compact rows + pagination) that lists every lot in the city: shops,
   residences, parks and gang-run derelicts, each with a live Zestimate.

   • LEGAL property + businesses are FOR SALE. Buying a business hands you
     its building AND its trade, so it pays you rent / profit every cycle
     (minus property tax). Prices BREATHE with a macro market index AND with
     each district's gang control + heat — a real buy-low / sell-high flip.
   • DISTRICT CONTROL is the gang tie: property in a zone YOUR gang holds is
     cheaper to buy and yields MORE; rivals' zones cost a premium and earn
     less. Buying a district's property pushes your INFLUENCE there (helps the
     takeover), and you can SEIZE a property cheap once you control its zone.
   • ILLEGAL operations (Trap House, chop shop, gang turf) are listed for the
     "who's the biggest" empire ranking but can't be bought on the market —
     take them by force.

   Ownership is per-life (resets each run). A listing's BASE value is computed
   once when the city is built and memoised; the displayed value floats.

   Exposes: CBZ.cityOpenZillow, CBZ.cityZillow, CBZ.cityZillowReset,
            CBZ.cityOwnsLot, CBZ.cityZillowTick.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const g = CBZ.game;
  const C = () => CBZ.CITY || {};

  // ---- balance knobs --------------------------------------------------------
  // Keep property as a steady long-term layer. Values and rent should not feel
  // like a slot machine pulsing every few seconds.
  const INCOME_TICK = 45;        // seconds between rent / business-profit payouts
  const TAX_PER_TICK = 0.00045;  // property tax per income tick (fraction of value)
  const SELL_CUT = 0.94;         // simple resale spread
  const YIELD = { residence: 0.0016, commercial: 0.0024, land: 0.0007, illegal: 0 };
  const PORTFOLIO_DRAG = 0.025;
  // ---- RENT (you renting FROM the market) ----------------------------------
  const RENT_FRAC = { residence: 0.0045, commercial: 0.006, land: 0.002 };
  const RENT_DEPOSIT = 0.5;
  // ---- RENT OUT (NPC tenants in property YOU own) --------------------------
  const TENANT_YIELD = { residence: 0.0032, commercial: 0.0045, land: 0.0012 };
  const VACANCY_BASE = 0;
  // ---- GANG-CONTROL economics (the takeover tie) ---------------------------
  // The whole point of the district chips: property in a zone YOUR gang holds is
  // cheaper to buy AND pays more rent (you run the block — protected, fewer
  // shakedowns); a RIVAL's zone is a premium to buy into and yields less (they
  // bleed you). Neutral is the baseline. Kept modest so the macro market still
  // dominates the price and rows stay legible, but big enough to FEEL the
  // takeover — owning your turf is a real edge, buying into a rival's is a tax.
  const CTRL = {
    mineBuy: 0.85,   minePay: 1.25,    // your turf: ~15% off, +25% yield
    rivalBuy: 1.20,  rivalPay: 0.80,   // rival turf: +20% to buy, −20% yield
    neutralBuy: 1.0, neutralPay: 1.0,
  };
  const PAGE_SIZE = 7;             // listing rows per page (keeps it ONE screen)

  // the named business magnates who own the city's legit businesses & rentals
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
  const TIERS = [
    { min: 0,       name: "Starter",   tag: "T1" },
    { min: 18000,   name: "Standard",  tag: "T2" },
    { min: 45000,   name: "Premium",   tag: "T3" },
    { min: 90000,   name: "Luxury",    tag: "T4" },
    { min: 160000,  name: "Trophy",    tag: "T5" },
  ];
  const TIER_COL = ["#7ed957", "#5bb0ff", "#b18bff", "#ffb05c", "#ff5d7e"];
  function tierIdx(value) { let n = 0; for (let i = 0; i < TIERS.length; i++) if (value >= TIERS[i].min) n = i; return n; }
  const RES_FLAVOR = ["renovated", "sun-filled", "corner-unit", "loft-style", "park-view", "quiet-street", "modern", "classic"];
  const COM_FLAVOR = ["high-traffic", "established", "turnkey", "flagship", "well-known", "busy-corner"];

  // ---- per-lot deterministic RNG (stable value/address across opens) ---------
  function lotRng(lot, idx) {
    let s = (((lot.i | 0) + 1) * 73856093) ^ (((lot.j | 0) + 1) * 19349663)
      ^ ((Math.round(lot.cx || 0) + 4096) * 83492791) ^ ((idx + 7) * 2654435761);
    s = s >>> 0;
    return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  }
  function round500(n) { n = +n; if (!isFinite(n)) n = 0; return Math.max(0, Math.round(n / 500) * 500); }
  function round5(n) { n = +n; if (!isFinite(n)) n = 0; return Math.max(0, Math.round(n / 5) * 5); }
  function money(n) { n = Math.round(+n); if (!isFinite(n)) n = 0; return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(); }
  function corpFor(rnd) { return CORPS[(rnd() * CORPS.length) | 0]; }
  function colHex(c) { return "#" + ("000000" + ((c | 0) >>> 0).toString(16)).slice(-6); }
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
    // a live gang that isn't in config (e.g. the player gang treated as a gang)
    const live = (CBZ.cityGangs || []).find((x) => x.id === id);
    if (live) return { id, name: live.name || "Crew", color: live.color || 0xb0606e };
    return UNDERWORLD;
  }

  // ---- GANG / DISTRICT CONTROL helpers --------------------------------------
  // Resolve who controls the ZONE a lot sits in (the takeover meta). Returns a
  // gang id ("player" if your gang holds it) or null (neutral / contested).
  function zoneOf(rec) {
    if (!CBZ.cityZoneAt) return null;
    return CBZ.cityZoneAt(rec.lot.cx || 0, rec.lot.cz || 0) || null;
  }
  function zoneOwnerOf(rec) {
    const z = zoneOf(rec);
    if (z) return z.owner || null;
    return CBZ.cityZoneOwner ? CBZ.cityZoneOwner(rec.lot.cx || 0, rec.lot.cz || 0) : null;
  }
  function myGangId() { return (g.playerGang && g.playerGang.founded) ? g.playerGang.id : null; }
  // control class for a listing: "mine" | "rival" | "neutral". Cached per-lot
  // with a short TTL — zone ownership shifts slowly (the takeover director runs
  // on its own clock), so recomputing it every frame for every listing would be
  // wasteful on phones. CBZ.now is ms; refresh the cache ~every 2s.
  let _ctrlAt = -1e9, _ctrlSig = "";
  function controlClass(rec) {
    const now = (CBZ.now != null) ? CBZ.now : 0;
    // bust the cache on a TTL OR whenever the player's gang / its turf changes
    // (founding a gang or claiming a block can flip a district to "yours").
    const pg = g.playerGang;
    const sig = (pg && pg.founded ? pg.id + ":" + (pg.turf ? pg.turf.length : 0) : "-");
    if (now - _ctrlAt > 1500 || sig !== _ctrlSig) {
      _ctrlAt = now; _ctrlSig = sig;
      const r = reg(); if (r) for (const x of r.listings) x._ctrl = null;
    }
    if (rec._ctrl) return rec._ctrl;
    const owner = zoneOwnerOf(rec);
    const mine = myGangId();
    let c = "neutral";
    if (owner) { if ((mine && owner === mine) || owner === "player") c = "mine"; else c = "rival"; }
    rec._ctrl = c;
    return c;
  }
  function ctrlBuyMul(rec) { const c = controlClass(rec); return c === "mine" ? CTRL.mineBuy : c === "rival" ? CTRL.rivalBuy : CTRL.neutralBuy; }
  function ctrlPayMul(rec) { const c = controlClass(rec); return c === "mine" ? CTRL.minePay : c === "rival" ? CTRL.rivalPay : CTRL.neutralPay; }
  // short, glanceable district chip for a row
  function zoneChip(rec) {
    const z = zoneOf(rec);
    const name = z ? z.name : (rec.district === "island" ? "Bay Island" : "Downtown");
    const cls = controlClass(rec);
    if (cls === "mine") return "<span style='color:#9be8b4'>" + name + "</span>";
    if (cls === "rival") {
      const oi = ownerInfo(zoneOwnerOf(rec));
      const nm = (oi.name || "rival").split(" — ")[0];
      return "<span style='color:#b9c6d6'>" + name + " · " + nm + "</span>";
    }
    return "<span style='color:#9fb0c6'>" + name + "</span>";
  }

  function pushInfluence(rec) {
    rec._ctrl = null;
  }

  // ---- build the static registry once, memoised on the arena -----------------
  function ensureRegistry() {
    const A = CBZ.city && CBZ.city.arena;
    if (!A) return null;
    if (A.realty) return A.realty;

    const center = A.center || { x: 0, z: 0 };
    const lots = [].concat(A.lots || [], (A.annex && A.annex.lots) || []);
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
        ownerId = "underworld";
      } else if (b && b.shop || COMMERCIAL_BASE[kind] || kind === "gas" || kind === "carlot") {
        category = "commercial";
        const base = COMMERCIAL_BASE[kind] || 30000;
        value = round500(base * (0.8 + 0.22 * storeys) * loc * noise);
        name = (b && b.name) || KIND_LABEL[kind] || "Business";
        business = { name, kind };
        ownerId = corpFor(rnd).id;
      } else {
        category = "residence";
        const home = b && b.home;
        // LISTED ladder rungs price at (near) their config figure so each LEVEL
        // reads as a clean, distinct number — no slot-machine variance on a buy
        // you're meant to recognise. Filler apartments keep the old estimate.
        if (home && home.listed) value = round500(home.price);
        else if (home && home.price > 0) value = round500(home.price * (0.95 + rnd() * 0.18));
        else value = round500((9000 * storeys + (lot.w || 24) * (lot.d || 24) * 22) * loc * noise);
        name = (home && home.listed && home.name) || (b && b.name) || (island ? "Island Tower" : "Apartments");
        ownerId = corpFor(rnd).id;
      }
      if (!(value > 0)) value = round500(8000 * loc);   // never NaN / zero

      const num = 100 + (((lot.i | 0) * 17 + (lot.j | 0) * 7 + idx * 3) % 89) * 10;
      const street = STREETS[(idx + (lot.i | 0)) % STREETS.length];
      const addr = num + " " + street + (island ? ", Bay Island" : "");

      // ---- read buildings.js's owner stamp (may be ABSENT on annex lots) ------
      // EVERY building carries lot.building.owner = {type, id, name, buyable}.
      // We surface WHO occupies it and use its `buyable` flag to curate the
      // market: only a meaningful subset is on sale; the rest are owner-occupied
      // (still ranked for the empire board, just not listed FOR SALE). Guard the
      // read — annex lots / parks may not be stamped.
      const stamp = (b && b.owner) || null;
      const occupant = stamp && stamp.name ? stamp.name : null;     // human-readable holder
      const occType = stamp && stamp.type ? stamp.type : null;       // business|landlord|gang|city|player
      // marketable = legal AND (no stamp → keep legacy "for sale", or stamp says buyable).
      // Parks/land stay non-marketable (held by the city). Illegal never marketable.
      let marketable;
      if (!legal) marketable = false;
      else if (category === "land") marketable = false;             // parkland isn't bought at a desk
      else if (stamp) marketable = stamp.buyable !== false;          // honor the curated flag
      else marketable = true;                                        // unstamped lot → legacy behaviour

      const flavor = category === "residence" ? RES_FLAVOR[(rnd() * RES_FLAVOR.length) | 0]
        : category === "commercial" ? COM_FLAVOR[(rnd() * COM_FLAVOR.length) | 0] : "";
      const home = (b && b.home) || null;
      const rec = {
        id: "p" + idx,
        lot, idx, district: island ? "island" : "downtown",
        kind, category, legal, base: value, value, name, address: addr,
        beds: (home && home.beds) || 0,
        sqft: (home && home.sqft) || 0,
        homeTier: (home && home.tier) || 0,
        homeListed: !!(home && home.listed),
        flagship: !!(home && home.flagship),
        blurb: (home && home.blurb) || "",
        storeys, business, flavor,
        occupant, occType, marketable,
        beta: 0.7 + rnd() * 0.6,            // stable per-lot market "beta"
        initialOwnerId: ownerId, ownerId,
        initialLegal: legal, initialCategory: category,   // restored on per-life reset
        boughtAt: 0,                        // what YOU paid (flip P&L)
        rent: round5(value * (YIELD[category] || 0)),
      };
      listings.push(rec); byId[rec.id] = rec;
    });

    A.realty = { listings, byId };
    return A.realty;
  }

  function reg() { return ensureRegistry(); }
  function ownedSet() { return (g.cityRealtyOwned = g.cityRealtyOwned || {}); }
  function homeObj(rec) { return rec.lot.building && rec.lot.building.home; }

  // ---- LIVE market value: base × macro index (beta) × district control ------
  function marketIndex() { const i = (CBZ.cityEcon && CBZ.cityEcon.propIndex) ? CBZ.cityEcon.propIndex() : 1; return isFinite(i) && i > 0 ? i : 1; }
  // raw Zestimate before the control/heat tilt (what the macro market says)
  function baseVal(rec) {
    const idx = marketIndex();
    const swing = 1 + (idx - 1) * (rec.beta || 1);
    return round500((rec.base || rec.value || 0) * Math.max(0.5, swing));
  }
  // displayed value: macro × district-control tilt. A district your gang holds
  // is HOTTER property (worth more once you control it — the flip reward); a
  // rival's district is depressed for you. Clamped so it never runs away.
  function mval(rec) {
    let v = baseVal(rec);
    const c = controlClass(rec);
    if (rec.legal) {
      if (c === "mine") v *= 1.12;          // your turf appreciates (control premium)
      else if (c === "rival") v *= 0.92;    // rival turf is discounted for you
    }
    rec.value = round500(v);
    return rec.value;
  }
  // the PRICE you actually pay to buy (value × your control discount/premium)
  function buyPriceOf(rec) { return round500(mval(rec) * ctrlBuyMul(rec)); }
  function refreshAllValues() { const r = reg(); if (r) for (const rec of r.listings) mval(rec); }
  function trendTag() {
    const t = (CBZ.cityEcon && CBZ.cityEcon.propTrend) ? CBZ.cityEcon.propTrend() : "steady";
    const idx = marketIndex();
    const pct = Math.round((idx - 1) * 100);
    if (t === "rising") return "Market +" + pct + "%";
    if (t === "falling") return "Market " + pct + "%";
    return "Market " + (pct >= 0 ? "+" : "") + pct + "%";
  }

  // ---- RENT (player renting FROM the market) --------------------------------
  function rentals() { return (g.cityRentals = g.cityRentals || {}); }
  function isRenting(rec) { return !!rentals()[rec.id]; }
  function rentFor(rec) { return round5(mval(rec) * (RENT_FRAC[rec.category] || 0.012)); }

  // ---- FINANCE / mortgage (financed buys) -----------------------------------
  // A financed property is tracked in g.cityMortgages keyed by listing id. The
  // record is ONE of two shapes depending on whether the dedicated bank loan
  // ENGINE (bank.js → CBZ.cityBankLoan, contract [E]) is loaded:
  //   • LEGACY / self-contained: { balance, orig, rate } — zillow's own
  //     economyTick (below) accrues interest + auto-pays it. Used when bank.js
  //     isn't present (feature-detect), preserving today's behaviour exactly.
  //   • BANK-BACKED: { viaBank:true, loanId, orig, rate } — the loan lives in
  //     g.cityLoans and bank.js owns ALL accrual + auto-pay (its tick runs the
  //     amortization). Zillow keeps only a thin LINK so the property still reads
  //     as FINANCED and its live balance/equity/payoff resolve off the engine.
  // mortgageBalanceOf() is the single resolver both shapes flow through.
  function mortgages() { return (g.cityMortgages = g.cityMortgages || {}); }
  function mortgageOf(rec) { return mortgages()[rec.id] || null; }
  function bankLoan() { return CBZ.cityBankLoan || null; }   // the loan ENGINE, if wired
  // live balance of a property's debt, whichever shape it is. For a bank-backed
  // mortgage we read the engine's ledger; if that loan has been fully paid /
  // closed by bank.js we prune the stale link so the row flips back to OWNED.
  function bankLoanRec(loanId) {
    const bl = bankLoan(); if (!bl || loanId == null) return null;
    const list = (bl.list && bl.list()) || g.cityLoans || [];
    for (let i = 0; i < list.length; i++) if (list[i] && list[i].id === loanId) return list[i];
    return null;
  }
  function mortgageBalanceOf(rec) {
    const m = mortgageOf(rec); if (!m) return 0;
    if (m.viaBank) {
      const lr = bankLoanRec(m.loanId);
      if (!lr) { delete mortgages()[rec.id]; return 0; }   // engine closed it → property is free & clear
      const bal = +(lr.balance != null ? lr.balance : lr.principal);
      return isFinite(bal) && bal > 0 ? bal : 0;
    }
    return Math.max(0, +m.balance || 0);
  }
  function mortgageRateOf(rec) {
    const m = mortgageOf(rec); if (!m) return FIN().rate;
    if (m.viaBank) { const lr = bankLoanRec(m.loanId); if (lr && isFinite(lr.rate)) return lr.rate; }
    return isFinite(m.rate) ? m.rate : FIN().rate;
  }
  function FIN() { return (CBZ.cityEcon && CBZ.cityEcon.FINANCE) || { minDownFrac: 0.2, rate: 0.06, minPaymentFrac: 0.04, maxLTV: 0.8 }; }
  function equity(rec) { return Math.max(0, mval(rec) - mortgageBalanceOf(rec)); }

  // ---- RENT OUT (NPC tenants in property YOU own) ---------------------------
  function tenants() { return (g.cityTenants = g.cityTenants || {}); }
  function tenantLabel(rec) { return rec.category === "commercial" ? "leased business" : "leased unit"; }
  function isOwned(rec) { const h = homeObj(rec); return h ? !!h.owned : !!ownedSet()[rec.id]; }
  function isHome(rec) { return !!(g.cityHome && g.cityHome.lot === rec.lot); }

  function effOwnerId(rec) {
    if (isOwned(rec)) return "player";
    if (!rec.legal) {
      const live = rec.lot.building && rec.lot.building.gang;
      return live || rec.initialOwnerId || "underworld";
    }
    return rec.ownerId;
  }
  function statusOf(rec) {
    if (isOwned(rec)) {
      if (isHome(rec)) return "HOME";
      return mortgageOf(rec) ? "FINANCED" : "OWNED";
    }
    if (isRenting(rec)) return rentals()[rec.id].isHome ? "LEASED·HOME" : "LEASED";
    if (!rec.legal) return canSeize(rec) ? "TAKEABLE" : "BY FORCE";
    if (rec.marketable === false) return "OCCUPIED";
    return "FOR SALE";
  }
  function canBuy(rec) { return rec.legal && rec.marketable !== false && !isOwned(rec) && !isRenting(rec); }
  function canRent(rec) { return rec.legal && rec.marketable !== false && rec.category !== "land" && !isOwned(rec) && !isRenting(rec); }
  function canFinance(rec) { return canBuy(rec) && buyPriceOf(rec) >= 8000; }
  // A side-effect-FREE financing quote for a listing — what the realtor (and the
  // [Z] details panel) preview before you commit. 20% down from FIN(); the rest
  // is the principal. If the bank loan ENGINE is wired we ask it for a pre-qual
  // (a non-binding offer with NO ctx flag so it doesn't book anything) to surface
  // the real rate / per-cycle payment / approval; otherwise we fall back to the
  // self-contained terms. Numbers only — `financeBuy` is the one that transacts.
  function financeQuote(rec) {
    if (!rec || !canFinance(rec)) return null;
    const f = FIN();
    const price = buyPriceOf(rec);
    const down = round500(price * f.minDownFrac);
    const principal = Math.max(0, price - down);
    const q = { price: price, down: down, principal: principal, rate: f.rate, payment: 0, approved: true, reason: "", viaBank: false };
    const bl = bankLoan();
    if (bl && bl.offer) {
      const o = bl.offer("mortgage", principal, { propertyId: rec.id, value: mval(rec), down: down, category: rec.category, kind: rec.kind, quote: true });
      if (o) {
        q.viaBank = true;
        q.approved = !!o.approved;
        if (o.reason) q.reason = o.reason;
        if (isFinite(o.rate)) q.rate = o.rate;
        if (isFinite(o.principal)) q.principal = o.principal;
        if (isFinite(o.payment)) q.payment = o.payment;
        if (isFinite(o.termTicks)) q.termTicks = o.termTicks;
      }
    }
    return q;
  }
  // which RIVAL gang currently HOLDS an illegal op (its live block-owner, else
  // the gang controlling its zone). Returns null if it's your own gang's block
  // (controlClass already grants "mine") or truly unclaimed turf.
  function holdingGangId(rec) {
    const mine = myGangId();
    const live = rec.lot.building && rec.lot.building.gang;
    if (live) return (live === mine || live === "player") ? null : live;
    const z = zoneOwnerOf(rec);
    return (z && z !== "player" && z !== mine) ? z : null;
  }
  const SEIZE_STANDING = 60;   // standing with the holding crew that lets you take over their op
  // An illegal op is takeable (not "off market" forever) only when you've earned
  // it through the takeover meta: you CONTROL its zone (your gang holds the
  // block — muscle it out) OR you're deep in the holding crew's good graces
  // (they hand it to a trusted ally). Otherwise it stays SEIZE-locked: ranked for
  // the empire board, but yours only by force in the world, not at a desk.
  function canSeize(rec) {
    if (rec.legal || isOwned(rec)) return false;
    if (controlClass(rec) === "mine") return true;           // your gang runs this district
    const gid = holdingGangId(rec);
    if (gid && CBZ.cityGangStanding && CBZ.cityGangStanding(gid) >= SEIZE_STANDING) return true;
    return false;
  }
  function seizePrice(rec) { return round500(mval(rec) * 0.35); }

  // ---- transactions ---------------------------------------------------------
  let lastMsg = "", lastTone = "ok";
  function flash(msg, tone) { lastMsg = msg; lastTone = tone || "ok"; }

  // ---- persistence: mirror the portfolio into the world ledger --------------
  function persist() {
    if (!CBZ.cityWorldEnsure) return;
    const w = CBZ.cityWorldEnsure(); if (!w || !w.assets) return;
    const r = reg(); if (!r) return;
    const list = [];
    for (const rec of r.listings) {
      const owned = isOwned(rec), renting = isRenting(rec);
      if (!owned && !renting) continue;
      const m = mortgageOf(rec), t = tenants()[rec.id], bal = mortgageBalanceOf(rec);
      list.push({
        id: rec.id, name: rec.business ? rec.business.name : rec.name, address: rec.address,
        category: rec.category, kind: rec.kind, value: mval(rec),
        tenure: owned ? (m ? "financed" : "owned") : "rented",
        mortgage: Math.round(bal),
        rentedOut: !!(owned && !isHome(rec) && t && t.occupied),
        isHome: isHome(rec) || (renting && rentals()[rec.id].isHome),
      });
    }
    w.assets.properties = list;
  }

  function charge(amt) {
    amt = Math.max(0, Math.round(+amt) || 0);
    if (((g.cash || 0) + (g.cityBank || 0)) < amt) return false;
    let owe = amt; const fromCash = Math.min(g.cash || 0, owe);
    g.cash = (g.cash || 0) - fromCash; owe -= fromCash; if (owe > 0) g.cityBank = (g.cityBank || 0) - owe;
    return true;
  }

  // the flagship mega-tower penthouse (id "penthouse", the one home.flagship lot
  // BLD tags). Match on id (the cross-file handshake), flagship as a fallback.
  function isPenthouseHome(home) { return !!home && (home.id === "penthouse" || home.flagship === true); }
  function takeResidence(rec) {
    if (rec.category === "residence" && rec.lot.building && rec.lot.building.home) {
      const home = rec.lot.building.home;
      home.owned = true;
      if (!g.cityHome) setAsHome(rec, true);
      // APEX HOME: buying the penthouse — at the realtor OR straight off the [Z]
      // market — arms your airpower. The missile HELICOPTER comes parked on its
      // rooftop helipad (free with the home; Phase 3 spawns it there). The deck
      // HANGAR (→ F-22) stays a SEPARATE add-on bought at the safehouse menu.
      // Set here (the single buy/finance chokepoint) so both venues agree.
      if (isPenthouseHome(home)) {
        g.cityOwnsPenthouse = true;
        g.cityOwnsHeli = true;
        if (CBZ.city && CBZ.city.big) CBZ.city.big("🚁 The missile helicopter is yours — on the pad.");
      }
    }
  }

  // ---- VISIT / TOUR a home: teleport the player to its door so EVERY listing on
  // Zillow is somewhere you can actually go, walk through, and (once bought) spawn
  // at. Works before or after purchase — a "show me the place" button. Also drops
  // a map waypoint so you can find your way back on foot/by car next time.
  function teleportPlayer(x, z) {
    const P = CBZ.player; if (!P || !P.pos) return;
    if (P.driving && CBZ.cityExitVehicle) CBZ.cityExitVehicle();
    P.pos.set(x, 0, z); P.vy = 0; P.grounded = true;
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
  }
  function visit(id) {
    const r = reg(); if (!r) return;
    const rec = r.byId[id]; if (!rec) return;
    const b = rec.lot.building, door = (b && b.door) || { x: rec.lot.cx, z: rec.lot.cz };
    const owned = isOwned(rec);
    close();
    teleportPlayer(door.x, door.z);
    if (CBZ.fullMap && CBZ.fullMap.setWaypoint) CBZ.fullMap.setWaypoint(door.x, door.z, rec.name);
    if (CBZ.city) {
      CBZ.city.note((owned ? "🏠 Home — " : "🚪 Touring ") + rec.name
        + (owned ? " (press H at the door for the safehouse menu)." : " — step through the door to look around."), 3.2);
      if (rec.flagship && CBZ.city.big) CBZ.city.big("👑 " + rec.name);
    }
    if (CBZ.sfx) CBZ.sfx("door");
  }

  // `direct` = an explicit realtor/door purchase (realestate.js routes home buys
  // here so there's ONE source of truth) — it bypasses the curated-market gate
  // because the realtor IS a legitimate sales venue for residences.
  function buy(id, direct) {
    const r = reg(); if (!r) return;
    const rec = r.byId[id]; if (!rec) return;
    if (!rec.legal) {
      if (canSeize(rec)) return seize(id);
      flash(rec.name + " can only be taken by force — control its district or earn the crew's trust.", "bad");
      CBZ.city.note("That's a gang operation — take it over by holding the turf, not at a desk.", 2.4); if (CBZ.sfx) CBZ.sfx("empty"); refresh(); return;
    }
    if (isOwned(rec)) { flash("You already own " + rec.name + ".", "bad"); refresh(); return; }
    if (rec.marketable === false && !direct) {
      const oc = rec.occupant ? rec.occupant.split(" — ")[0] : "its owner";
      flash(rec.name + " isn't for sale — " + oc + " occupies it.", "bad");
      CBZ.city.note("That property is occupied and off the market.", 2); if (CBZ.sfx) CBZ.sfx("empty"); refresh(); return;
    }
    if (isRenting(rec)) endRent(id, true);
    const price = buyPriceOf(rec);
    if (((g.cash || 0) + (g.cityBank || 0)) < price) { flash("Need " + money(price) + " cash + bank to close. Try financing.", "bad"); CBZ.city.note("Need " + money(price) + " to close.", 2); if (CBZ.sfx) CBZ.sfx("empty"); refresh(); return; }
    charge(price);
    delete mortgages()[rec.id];
    ownedSet()[rec.id] = true; rec.ownerId = "player"; rec.boughtAt = price;
    takeResidence(rec);
    pushInfluence(rec);
    CBZ.city.addRespect(Math.max(1, Math.min(40, Math.round(price / 8000))));
    const headline = (rec.business ? "Acquired " + rec.business.name : "Bought " + rec.name);
    flash(headline + " for " + money(price), "ok"); CBZ.city.big(headline);
    if (CBZ.sfx) CBZ.sfx("coin");
    persist(); if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    refresh();
  }

  function seize(id) {
    const r = reg(); if (!r) return;
    const rec = r.byId[id]; if (!rec || !canSeize(rec)) { flash("That property is not available through Zillow.", "bad"); refresh(); return; }
    const price = seizePrice(rec);
    if (((g.cash || 0) + (g.cityBank || 0)) < price) { flash("Need " + money(price) + ".", "bad"); if (CBZ.sfx) CBZ.sfx("empty"); refresh(); return; }
    charge(price);
    ownedSet()[rec.id] = true; rec.ownerId = "player"; rec.boughtAt = price; rec.legal = true; rec.category = "commercial";
    pushInfluence(rec);
    CBZ.city.addRespect(25);
    flash("Took over " + rec.name + " for " + money(price) + ".", "ok");
    CBZ.city.big("Took over " + rec.name);
    if (CBZ.sfx) CBZ.sfx("coin");
    persist(); if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    refresh();
  }

  // FINANCED BUY (contract [E] consumer side). 20% down from cash+bank; the
  // REMAINDER is financed. If the bank loan ENGINE is wired we route the loan
  // through it (real underwriting: it may decline, set its own rate/term, and it
  // owns the per-tick amortization + auto-pay against g.cityLoans). If bank.js
  // isn't present we fall back to the self-contained mortgage exactly as before,
  // so financing keeps working today. Either way the property is registered the
  // moment the down clears — the only difference is WHO services the debt.
  function financeBuy(id) {
    const r = reg(); if (!r) return;
    const rec = r.byId[id]; if (!rec) return;
    if (!canFinance(rec)) { flash("Can't finance that.", "bad"); refresh(); return; }
    const f = FIN();
    const price = buyPriceOf(rec);
    const down = round500(price * f.minDownFrac);
    const principal = Math.max(0, price - down);
    if (((g.cash || 0) + (g.cityBank || 0)) < down) { flash("Need " + money(down) + " down to finance.", "bad"); CBZ.city.note("Need " + money(down) + " down.", 2); if (CBZ.sfx) CBZ.sfx("empty"); refresh(); return; }

    const bl = bankLoan();
    let mort;   // the record we'll stamp once the down clears
    if (bl && bl.offer && bl.take) {
      // ---- bank.js underwrites the mortgage ----------------------------------
      const offer = bl.offer("mortgage", principal, { propertyId: rec.id, value: mval(rec), down: down, category: rec.category, kind: rec.kind });
      if (!offer || !offer.approved) {
        const why = (offer && offer.reason) ? offer.reason : "the bank declined the mortgage";
        flash("Mortgage declined — " + why + ".", "bad"); CBZ.city.note("Mortgage declined: " + why + ".", 2.4); if (CBZ.sfx) CBZ.sfx("empty"); refresh(); return;
      }
      charge(down);   // the down comes out of pocket; the engine disburses the rest to escrow
      const loanId = bl.take(offer);
      const bal = +(offer.principal != null ? offer.principal : principal);
      // If the engine couldn't book the loan (no id back), DON'T silently forgive
      // the balance (that'd be a free-house exploit) — keep the debt on Zillow's
      // own books at the offered terms so the player still owes it.
      mort = (loanId != null)
        ? { viaBank: true, loanId: loanId, orig: bal, rate: isFinite(offer.rate) ? offer.rate : f.rate }
        : { balance: bal, orig: bal, rate: isFinite(offer.rate) ? offer.rate : f.rate };
    } else {
      // ---- fallback: self-contained mortgage (legacy, byte-identical) --------
      charge(down);
      mort = { balance: principal, orig: principal, rate: f.rate };
    }
    mortgages()[rec.id] = mort;
    ownedSet()[rec.id] = true; rec.ownerId = "player"; rec.boughtAt = price;
    takeResidence(rec);
    pushInfluence(rec);
    CBZ.city.addRespect(Math.max(1, Math.min(20, Math.round(down / 8000))));
    const owed = mortgageBalanceOf(rec);
    flash("Financed " + (rec.business ? rec.business.name : rec.name) + ": " + money(down) + " down, " + money(owed) + " owed.", "ok");
    CBZ.city.big("Financed " + rec.name);
    if (CBZ.sfx) CBZ.sfx("coin");
    persist(); if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    refresh();
  }
  function payMortgage(id, frac) {
    const r = reg(); if (!r) return;
    const rec = r.byId[id]; const m = rec && mortgageOf(rec); if (!m) return;
    const balance = mortgageBalanceOf(rec);
    let pay = frac >= 1 ? balance : round500(balance * frac);
    pay = Math.min(pay, balance);
    if (pay <= 0) return;
    if (((g.cash || 0) + (g.cityBank || 0)) < pay) { flash("Need " + money(pay) + " to pay down.", "bad"); if (CBZ.sfx) CBZ.sfx("empty"); refresh(); return; }
    if (m.viaBank) {
      // hand the extra principal to the loan engine (it debits cash/bank itself
      // via payExtra); don't double-charge here. Then resolve the live balance.
      const bl = bankLoan();
      if (bl && bl.payExtra) bl.payExtra(m.loanId, pay);
      const left = mortgageBalanceOf(rec);   // re-reads the engine (prunes if closed)
      if (left <= 1 || !mortgageOf(rec)) { delete mortgages()[rec.id]; flash("Mortgage cleared on " + rec.name + ".", "ok"); CBZ.city.big("Mortgage cleared"); }
      else flash("Paid " + money(pay) + " toward " + rec.name + ". " + money(left) + " left.", "ok");
      if (CBZ.sfx) CBZ.sfx("coin");
      persist(); if (CBZ.cityHudDirty) CBZ.cityHudDirty();
      refresh(); return;
    }
    charge(pay);
    m.balance = Math.max(0, balance - pay);
    if (m.balance <= 1) { delete mortgages()[rec.id]; flash("Mortgage cleared on " + rec.name + ".", "ok"); CBZ.city.big("Mortgage cleared"); }
    else flash("Paid " + money(pay) + " toward " + rec.name + ". " + money(m.balance) + " left.", "ok");
    if (CBZ.sfx) CBZ.sfx("coin");
    persist(); if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    refresh();
  }

  function rent(id) {
    const r = reg(); if (!r) return;
    const rec = r.byId[id]; if (!rec || !canRent(rec)) { flash("Can't rent that.", "bad"); refresh(); return; }
    const per = rentFor(rec);
    const deposit = round5(per * RENT_DEPOSIT);
    if (((g.cash || 0) + (g.cityBank || 0)) < deposit) { flash("Need " + money(deposit) + " deposit to move in.", "bad"); if (CBZ.sfx) CBZ.sfx("empty"); refresh(); return; }
    if (deposit > 0) charge(deposit);
    const isHomeRental = rec.category === "residence";
    rentals()[rec.id] = { rent: per, isHome: isHomeRental, missed: 0 };
    if (isHomeRental && !g.cityHome && rec.lot.building) {
      const door = rec.lot.building.door || { x: rec.lot.cx, z: rec.lot.cz };
      g.citySpawnPoint = { x: door.x, z: door.z };
      g.cityRentedHome = rec.id;
    }
    flash("Leased " + rec.name + ": " + money(per) + "/cycle" + (isHomeRental ? ", respawn set" : "") + ".", "ok");
    CBZ.city.big("Leased " + rec.name);
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
    if (!quiet) { flash("Ended your lease on " + rec.name + ".", "ok"); persist(); refresh(); }
  }
  function rentSetHome(id) {
    const rec = reg() && reg().byId[id]; if (!rec) return;
    const lease = rentals()[rec.id]; if (!lease || !lease.isHome) { flash("Only a rented residence can be your home base.", "bad"); refresh(); return; }
    if (g.cityHome) { flash("You already own a home — that's your respawn.", "bad"); refresh(); return; }
    const door = rec.lot.building && rec.lot.building.door || { x: rec.lot.cx, z: rec.lot.cz };
    g.citySpawnPoint = { x: door.x, z: door.z };
    g.cityRentedHome = rec.id;
    flash(rec.name + " is now your home base.", "ok");
    CBZ.city.note("Respawn point set to " + rec.name + ".", 2.2);
    persist(); refresh();
  }

  function sell(id) {
    const r = reg(); if (!r) return;
    const rec = r.byId[id]; if (!rec || !isOwned(rec)) return;
    const gross = round500(mval(rec) * SELL_CUT);
    const m = mortgageOf(rec);
    const payoff = Math.round(mortgageBalanceOf(rec));
    const got = Math.max(0, gross - payoff);
    const pl = rec.boughtAt ? gross - rec.boughtAt : 0;      // flip profit/loss vs. what you paid
    // Settle the outstanding debt out of the sale proceeds (not the seller's
    // pocket). For a bank-backed loan, credit the FULL gross then route the
    // payoff through the engine (payExtra debits cash + closes its books), so the
    // net to the player is `got` and g.cityLoans stays consistent. A legacy
    // self-contained mortgage just nets `got` directly (its record is deleted).
    if (m && m.viaBank) {
      const bl = bankLoan();
      CBZ.city.addCash(gross);
      if (payoff > 0 && bl && bl.payExtra) bl.payExtra(m.loanId, payoff);
    } else {
      CBZ.city.addCash(got);
    }
    delete ownedSet()[rec.id];
    delete mortgages()[rec.id];
    delete tenants()[rec.id];
    rec.ownerId = rec.initialOwnerId; rec.boughtAt = 0;
    if (rec.lot.building && rec.lot.building.home) {
      // selling the penthouse sells its AIRPOWER with it (chopper + any hangar jet)
      if (isPenthouseHome(rec.lot.building.home)) { g.cityOwnsPenthouse = false; g.cityOwnsHeli = false; g.cityOwnsHangar = false; }
      rec.lot.building.home.owned = false;
    }
    if (isHome(rec)) { g.cityHome = null; g.citySpawnPoint = null; CBZ.city.note("Sold your home — no respawn point until you buy another.", 2.6); }
    const plTxt = pl ? " (" + (pl >= 0 ? "+" : "") + money(pl) + " flip)" : "";
    const note = payoff > 0 ? "Sold " + rec.name + " for " + money(gross) + " (-" + money(payoff) + " mortgage = +" + money(got) + ")" + plTxt + "." : "Sold " + rec.name + " for " + money(got) + plTxt + ".";
    flash(note, "ok"); CBZ.city.big("SOLD " + rec.name + " — +" + money(got));
    if (CBZ.sfx) CBZ.sfx("coin");
    persist(); if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    refresh();
  }

  function setAsHome(rec, quiet) {
    if (!rec || !isOwned(rec)) return;
    const b = rec.lot.building, home = b && b.home;
    if (!home) { flash("Only a residence can be your home.", "bad"); CBZ.city.note("Only a residence can be your home.", 1.8); refresh(); return; }
    const movedFrom = (g.cityHome && g.cityHome.lot !== rec.lot) ? g.cityHome.name : null;
    home.owned = true;
    g.cityHome = { lot: rec.lot, tier: home.tier, id: home.id, name: home.name };
    g.cityRentTier = null;
    g.cityRentedHome = null;
    const door = (b.door || { x: rec.lot.cx, z: rec.lot.cz });
    g.citySpawnPoint = { x: door.x, z: door.z };
    if (!quiet) {
      flash(home.name + " is now your home" + (movedFrom ? "; " + movedFrom + " becomes a rental" : "") + ".", "ok");
      CBZ.city.note(home.name + " is now your home. Respawn point set.", 2.4);
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
    for (const rec of r.listings) bump(effOwnerId(rec), mval(rec));
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
      debt += mortgageBalanceOf(rec);
      eq += equity(rec);
    }
    return { count, value, equity: Math.round(eq), debt: Math.round(debt) };
  }

  // ---- the property economy TICK (driven by realestate.js at order 38.4) ----
  let incomeT = INCOME_TICK;
  function economyTick(dt) {
    // PERF + CORRECTNESS: when the panel is open we only need the LIVE numbers
    // (Zestimates / income) to breathe — we must NOT rebuild the whole innerHTML
    // every frame. A full rebuild ~60×/s destroyed and recreated the <select>
    // and <input> under the user's cursor, which (a) ate the sort dropdown's
    // change event / reverted its value, and (b) stole search focus. Now the
    // per-frame path PATCHES the numbers in place (liveUpdate) and leaves the
    // controls + list order untouched, so the chosen sort sticks and the dropdown
    // actually works. Structure only rebuilds on a user action (render()).
    if (isOpen()) { refreshAllValues(); liveUpdate(); }
    incomeT -= dt; if (incomeT > 0) return;
    incomeT = INCOME_TICK;
    const r = reg(); if (!r) return;
    let net = 0, n = 0, vac = 0, evicted = null;

    for (const rec of r.listings) {
      if (!isOwned(rec)) continue;
      const v = mval(rec);
      const tax = Math.max(0, Math.round(v * TAX_PER_TICK));
      const m = mortgageOf(rec);
      // Self-contained mortgages amortize HERE. Bank-backed loans (viaBank) are
      // serviced by bank.js's own tick (it accrues + auto-pays against
      // g.cityLoans) — touching them here would double-bill, so we skip them and
      // only prune the link if the engine has since closed the loan.
      if (m && m.viaBank) {
        if (mortgageBalanceOf(rec) <= 0) { /* mortgageBalanceOf already pruned it */ }
      } else if (m && m.balance > 0) {
        const interest = Math.round(m.balance * (m.rate / 240));
        m.balance += interest;
        const minPay = Math.min(m.balance, Math.max(interest + 50, Math.round(m.orig * FIN().minPaymentFrac)));
        if (charge(minPay)) m.balance = Math.max(0, m.balance - minPay);
        if (m.balance <= 1) delete mortgages()[rec.id];
      }
      if (isHome(rec)) { net -= tax; continue; }
      n++;
      const t = tenants()[rec.id] || (tenants()[rec.id] = { occupied: true });
      // E4: real vacancies — VACANCY_BASE was a dead 0; a district's cohort
      // wallet stress (sim/npcecon.js, fed by robbery draining that district)
      // now drives it, guarded with the old 0 fallback if npcecon.js/the
      // district lookup is unreachable.
      const vacDk = (CBZ.cityEcon && CBZ.cityEcon.districtAt && rec.lot) ? CBZ.cityEcon.districtAt(rec.lot.cx || 0, rec.lot.cz || 0) : null;
      const vacBase = (CBZ.npcEcon && CBZ.npcEcon.vacancyRate && vacDk) ? CBZ.npcEcon.vacancyRate(vacDk) : VACANCY_BASE;
      const vacChance = vacBase * (rec.category === "commercial" ? 1.2 : 1) * (0.6 + 600 / Math.max(600, v));
      if (Math.random() < vacChance) { t.occupied = false; vac++; }
      else if (!t.occupied) { t.occupied = true; }
      // GANG TIE: income is scaled by who controls the district (your turf pays
      // more, a rival's turf pays less). This makes the takeover feed the wallet.
      // AD TIE (adboard.js): billboards you rent that push THIS business bump
      // its take — owning the skyline literally pays the till.
      const income = t.occupied ? round5(v * (TENANT_YIELD[rec.category] || 0.01) * ctrlPayMul(rec) * (CBZ.cityAdBoost ? CBZ.cityAdBoost(rec) : 1)) : 0;
      net += income - tax;
    }
    if (n > 0 && net > 0) net = Math.round(net / (1 + PORTFOLIO_DRAG * n));

    if (net > 0) { CBZ.city.addCash(net); CBZ.city.note("Portfolio +" + money(net) + " (" + n + " unit" + (n === 1 ? "" : "s") + (vac ? ", " + vac + " vacant" : "") + ")", 2); }
    else if (net < 0) {
      let owe = -net; const fromCash = Math.min(g.cash || 0, owe); g.cash = (g.cash || 0) - fromCash; owe -= fromCash;
      if (owe > 0) g.cityBank = Math.max(0, (g.cityBank || 0) - owe);
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
      CBZ.city.note("Property upkeep -" + money(-net), 1.8);
    }

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
    if (evicted) CBZ.city.note("Evicted from " + evicted + " after missed rent.", 2.6);

    persist();
    // A payout cycle can flip ownership/tenant state (rows gain/lose buttons), so
    // a structural rebuild is warranted — but only if the user isn't mid-typing
    // or mid-pick, else we'd nuke the control under them. refresh() guards this.
    if (isOpen()) refresh();
  }
  CBZ.cityZillowTick = economyTick;

  // ---- reset per life --------------------------------------------------------
  CBZ.cityZillowReset = function () {
    g.cityRealtyOwned = {};
    g.cityRentals = {}; g.cityMortgages = {}; g.cityTenants = {}; g.cityRentedHome = null;
    // apex-home airpower (penthouse → helicopter; bought hangar → jet) is per-run
    g.cityOwnsPenthouse = false; g.cityOwnsHeli = false; g.cityOwnsHangar = false;
    incomeT = INCOME_TICK; page = 0; query = ""; sortMode = "smart"; kindFilter = "all"; tab = DEFAULT_TAB; expanded = null;
    if (CBZ.cityEcon && CBZ.cityEcon.initPropMarket) CBZ.cityEcon.initPropMarket();
    const A = CBZ.city && CBZ.city.arena;
    if (A && A.realty) for (const rec of A.realty.listings) {
      rec.ownerId = rec.initialOwnerId; rec.value = rec.base; rec.boughtAt = 0; rec._ctrl = null;
      if (rec.initialLegal != null) rec.legal = rec.initialLegal;          // un-seize: ops go back to the crews
      if (rec.initialCategory != null) rec.category = rec.initialCategory;
    }
    _ctrlAt = -1e9;
    if (open_) { CBZ.cityMenuOpen = false; }
    open_ = false;
    if (panel) panel.style.display = "none";
  };

  // ==========================================================================
  //  UI  — one screen, compact rows, paginated (NO scrolling)
  // ==========================================================================
  // Tabs ARE the category navigation: residence / commercial / land / illegal /
  // owned / renting. Picking a tab switches the visible list (no second dropdown
  // to fight with). "owned"/"rented" are the portfolio views.
  const TABS = [
    { id: "residence", label: "Homes" },
    { id: "commercial", label: "Commercial" },
    { id: "land", label: "Land" },
    { id: "illegal", label: "Illegal Ops" },
    { id: "owned", label: "Owned" },
    { id: "rented", label: "Renting" },
  ];
  const TAB_IDS = TABS.map((t) => t.id);
  const DEFAULT_TAB = "residence";
  function tabLabel(id) { const t = TABS.find((x) => x.id === id); return t ? t.label : "listings"; }
  let panel = null, tab = DEFAULT_TAB, open_ = false, page = 0, expanded = null;
  let query = "", sortMode = "smart", kindFilter = "all";

  // One-screen layout overrides authored HERE (css/city.css is off-limits). A
  // scoped <style> in document.head — same pattern turf.js/hud.js use. It widens
  // the tab strip to fit six tabs, tightens the value column so rows never
  // overflow, and clarifies the active tab. Idempotent.
  function injectCss() {
    if (document.getElementById("cZillowTabCss")) return;
    const st = document.createElement("style");
    st.id = "cZillowTabCss";
    st.textContent = [
      "#cityZillow.zwrap{width:min(940px,96vw);height:min(82vh,720px)}",
      // six-up tab strip that wraps gracefully on narrow screens
      "#cityZillow .ztabs{display:flex;flex-wrap:wrap;gap:6px}",
      "#cityZillow .ztab{flex:1 1 0;min-width:88px;justify-content:center;gap:7px;padding:8px 8px;font-size:13px}",
      "#cityZillow .ztab.on{box-shadow:0 0 0 1px #4f8bff inset,0 4px 12px rgba(47,111,237,.35)}",
      // compact tools row: search + sort only (category lives in the tabs now)
      "#cityZillow .ztools{grid-template-columns:minmax(180px,1fr) 150px auto}",
      // keep the action column from overflowing the panel on desktop
      "#cityZillow .zright{grid-template-columns:96px minmax(80px,108px) minmax(150px,1fr);min-width:330px;gap:7px}",
      "#cityZillow .zval{font-size:14px}",
      // a small market-context strip under the tabs
      "#cityZillow .zctx{display:flex;flex-wrap:wrap;gap:6px;padding:6px 14px 2px;font-size:11px;color:#9fb0c6}",
      "#cityZillow .zctx .pill{padding:2px 9px;border-radius:999px;background:rgba(255,255,255,.05);border:1px solid #2a323c}",
      "#cityZillow .zctx .pill b{color:#ffd166}",
      // the active-sort chip reads as a live status, tinted like the controls
      "#cityZillow .zctx .zsortpill{background:rgba(47,111,237,.14);border-color:#33507e;color:#bcd0f0}",
      "#cityZillow .zctx .zsortpill b{color:#9fc2ff}",
      // make the sort <select> visibly the active control (matches the chip)
      "#cityZillow .zselect{cursor:pointer}",
      "#cityZillow .zselect:focus{outline:none;border-color:#4f8bff;box-shadow:0 0 0 2px rgba(79,139,255,.25)}",
      // owner-occupied (off-market) badge — neutral grey, distinct from for-sale/own
      "#cityZillow .zbadge.zb-occupied{background:rgba(138,147,163,.18);border:1px solid #4a525e;color:#aeb8c6}",
      "#cityZillow .zocc{color:#9fb0c6}",
      "@media(max-width:640px){#cityZillow .ztab{min-width:0;flex:1 1 30%;font-size:12px;padding:7px 4px}",
      "#cityZillow .ztools{grid-template-columns:1fr 1fr}#cityZillow .zsearch{grid-column:1/-1}",
      "#cityZillow .zright{grid-template-columns:1fr;min-width:96px}}",
    ].join("");
    document.head.appendChild(st);
  }

  function el() {
    if (panel) return panel;
    injectCss();
    panel = document.createElement("div");
    panel.id = "cityZillow";
    panel.className = "zwrap";
    document.body.appendChild(panel);
    panel.addEventListener("click", function (e) {
      const t = e.target.closest ? e.target.closest("[data-act]") : null;
      if (!t) return;
      const act = t.getAttribute("data-act"), id = t.getAttribute("data-id");
      // these are deliberate user actions that change the visible structure —
      // render() directly so they always take effect even if a control (search /
      // sort) still holds focus (refresh()'s userBusy guard would defer them).
      if (act === "tab") { if (TAB_IDS.indexOf(id) >= 0) tab = id; page = 0; expanded = null; render(); return; }
      if (act === "page") { setPage(parseInt(id, 10)); return; }
      if (act === "expand") { expanded = expanded === id ? null : id; render(); return; }
      if (act === "clear") { query = ""; sortMode = "smart"; page = 0; expanded = null; render(); return; }
      if (act === "buy") buy(id);
      else if (act === "visit") visit(id);
      else if (act === "seize") seize(id);
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
    panel.addEventListener("input", function (e) {
      const t = e.target && e.target.closest ? e.target.closest("[data-zsearch]") : null;
      if (!t) return;
      query = t.value || ""; page = 0; expanded = null; render();
      const next = panel.querySelector("[data-zsearch]");
      if (next) { next.focus(); try { next.setSelectionRange(query.length, query.length); } catch (err) {} }
    });
    panel.addEventListener("change", function (e) {
      const sort = e.target && e.target.closest ? e.target.closest("[data-zsort]") : null;
      if (!sort) return;
      // A deliberate user pick — ALWAYS rebuild so the list re-sorts instantly,
      // even though the <select> is still focused (refresh()'s userBusy guard
      // would otherwise defer to a no-reorder live patch). After the rebuild,
      // re-focus the freshly-rendered select so keyboard users keep their place
      // and the picked option stays visibly selected.
      sortMode = sort.value || "smart"; page = 0; expanded = null;
      render();
      const next = panel.querySelector("[data-zsort]");
      if (next) { try { next.focus(); } catch (err) {} }
    });
    return panel;
  }
  function isOpen() { return open_; }

  function badge(rec) {
    const s = statusOf(rec);
    let cls = "zb-sale";
    if (s === "OWNED" || s === "HOME" || s === "FINANCED" || s === "LEASED" || s === "LEASED·HOME") cls = "zb-own";
    else if (s === "BY FORCE" || s === "TAKEABLE") cls = "zb-illegal";
    else if (s === "OCCUPIED") cls = "zb-occupied";
    return "<span class='zbadge " + cls + "'>" + s.replace("·", " ") + "</span>";
  }
  function icon(rec) {
    if (rec.category === "land") return "LD";
    if (rec.category === "residence") return "RE";
    if (!rec.legal) return "OFF";
    return "BU";
  }
  function btn(act, id, label, tone) {
    return "<button class='zbtn " + (tone || "zbtn-neutral") + "' data-act='" + act + "' data-id='" + id + "'>" + label + "</button>";
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
  }
  function nameOf(rec) { return rec.business ? rec.business.name : rec.name; }
  // who occupies/owns the building per buildings.js's stamp (guarded — absent on
  // unstamped annex lots). Used to surface "owned by X" on a listing.
  function occLabel(rec) {
    if (isOwned(rec)) return "You";
    if (!rec.occupant) return null;
    const typeWord = rec.occType === "business" ? "business" : rec.occType === "landlord" ? "landlord"
      : rec.occType === "gang" ? "crew" : rec.occType === "city" ? "the city" : rec.occType === "player" ? "you" : null;
    const nm = rec.occupant.split(" — ")[0];
    return typeWord && typeWord !== nm ? nm + " (" + typeWord + ")" : nm;
  }
  function yieldPctOf(rec) { return (TENANT_YIELD[rec.category] || 0) * ctrlPayMul(rec) - TAX_PER_TICK; }
  // The tab IS the category filter. Market tabs (residence/commercial/land/
  // illegal) list every lot of that category — for-sale first, but also ones you
  // already own/rent so a tab is a complete view of its category. owned/rented
  // are the portfolio cuts (across all categories).
  function baseList(which) {
    const r = reg(); if (!r) return [];
    let arr = r.listings.slice();
    if (which === "owned") arr = arr.filter((x) => isOwned(x));
    else if (which === "rented") arr = arr.filter((x) => isRenting(x));
    else if (which === "illegal") arr = arr.filter((x) => !x.legal);
    else if (which === "residence")
      // the Homes tab is the curated LADDER only — one row per level, not every
      // apartment in the city. Filler units stay ranked but off this list.
      arr = arr.filter((x) => x.legal && x.category === "residence" && x.homeListed);
    else if (which === "commercial" || which === "land")
      arr = arr.filter((x) => x.legal && x.category === which);
    else arr = arr.filter((x) => x.legal); // fallback
    return arr;
  }
  function matchesTools(rec) {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const hay = [nameOf(rec), rec.name, rec.address, rec.category, rec.kind, statusOf(rec), zoneChip(rec), rec.flavor].join(" ").toLowerCase();
    return hay.indexOf(q) >= 0;
  }
  // Resolve the effective sort mode for a given tab. "smart" (the Default option)
  // is context-aware: the Homes ladder climbs by level, portfolio tabs read by
  // value, and the market tabs shop cheapest-first. EXPLICIT picks
  // (cheap/value/yield/district) always win and apply on EVERY tab — that's the
  // whole point of the dropdown, so it must never be ignored per-tab.
  function effSortMode(which) {
    if (sortMode !== "smart") return sortMode;          // explicit pick → honor it everywhere
    if (which === "residence") return "ladder";          // homes climb by level
    if (which === "owned" || which === "rented") return "value";
    return "cheap";                                      // market default: best deal first
  }
  // human label for the CURRENTLY-EFFECTIVE sort on a tab — drives the live
  // "Sorted by …" chip so the active order is always legible at a glance.
  const SORT_LABEL = {
    ladder: "Level (low→high)", cheap: "Price (low→high)", value: "Value (high→low)",
    yield: "Income (high→low)", district: "District (your turf first)",
  };
  function sortPillLabel(which) {
    const m = effSortMode(which);
    const base = SORT_LABEL[m] || "Value (high→low)";
    return sortMode === "smart" ? base + " · auto" : base;
  }
  // rank used only to GROUP the "district" sort: your turf, then neutral, then
  // rival blocks — a stable, meaningful order (not an alphabetical accident).
  function ctrlRank(rec) { const c = controlClass(rec); return c === "mine" ? 0 : c === "neutral" ? 1 : 2; }
  function sortListings(arr, which) {
    const mode = effSortMode(which);
    arr.sort(function (a, b) {
      switch (mode) {
        case "ladder":   // Homes default: rungs climb low→high by level then price
          return (a.homeTier - b.homeTier) || (buyPriceOf(a) - buyPriceOf(b)) || a.idx - b.idx;
        case "cheap":    // Price: cheapest buy-in first
          return buyPriceOf(a) - buyPriceOf(b) || mval(a) - mval(b) || a.idx - b.idx;
        case "value":    // Value: priciest Zestimate first
          return mval(b) - mval(a) || a.idx - b.idx;
        case "yield":    // Income: best net rent/cycle first
          return yieldPctOf(b) - yieldPctOf(a) || mval(b) - mval(a) || a.idx - b.idx;
        case "district": // District: grouped by control (yours→neutral→rival), value within
          return ctrlRank(a) - ctrlRank(b) || mval(b) - mval(a) || a.idx - b.idx;
        default:         // smart fallback (shouldn't hit — effSortMode resolves it)
          return mval(b) - mval(a) || a.idx - b.idx;
      }
    });
    return arr;
  }
  function countFor(which) { return baseList(which).filter(matchesTools).length; }

  // Compact row: type · property · district · value · estimated net income · action.
  function row(rec) {
    const v = mval(rec);
    const tIdx = tierIdx(rec.base || v);
    const tcol = TIER_COL[tIdx];
    const ttag = TIERS[tIdx].tag;
    const name = nameOf(rec);
    // estimated net rent/cycle reflects the district-control yield tilt, so the
    // number you see on YOUR turf (worth more) vs a rival's (worth less) matches
    // what the income tick actually pays.
    const estNet = rec.legal && rec.category !== "land"
      ? round5(v * (TENANT_YIELD[rec.category] || 0) * ctrlPayMul(rec) - v * TAX_PER_TICK)
      : 0;
    const incTxt = rec.legal && rec.category !== "land"
      ? "<span class='zincome " + (estNet >= 0 ? "up" : "down") + "' data-zinc='" + rec.id + "'>" + (estNet >= 0 ? "+" : "") + money(estNet) + "/cycle</span>"
      : "<span class='zincome muted'>No income</span>";

    let primary = "";
    const m = mortgageOf(rec);
    const mBal = m ? Math.round(mortgageBalanceOf(rec)) : 0;   // live debt (bank-backed or legacy)
    if (isOwned(rec)) {
      const netSale = Math.max(0, round500(v * SELL_CUT) - mBal);
      primary = btn("sell", rec.id, "Sell " + money(netSale), "zbtn-sell");
    } else if (isRenting(rec)) {
      primary = btn("endrent", rec.id, "End lease", "zbtn-neutral");
    } else if (canSeize(rec)) {
      primary = btn("seize", rec.id, "Take over " + money(seizePrice(rec)), "zbtn-warn");
    } else if (canBuy(rec)) {
      primary = btn("buy", rec.id, "Buy " + money(buyPriceOf(rec)), "zbtn-buy");
    } else if (!rec.legal) {
      primary = "<span class='znope'>Take by force</span>";
    } else if (rec.marketable === false) {
      primary = "<span class='znope'>Occupied</span>";
    } else {
      primary = "<span class='znope'>Off market</span>";
    }

    let extra = "";
    if (expanded === rec.id) {
      let acts = "";
      if (isOwned(rec)) {
        if (m) { acts += btn("payhalf", rec.id, "Pay half", "zbtn-neutral") + btn("payoff", rec.id, "Pay off " + money(mBal), "zbtn-home"); }
        if (rec.category === "residence" && homeObj(rec) && !isHome(rec)) acts += btn("home", rec.id, "Set home", "zbtn-home");
        const t = tenants()[rec.id];
        const occ = isHome(rec) ? "your residence" : (t && t.occupied === false ? "vacant" : tenantLabel(rec));
        const pl = rec.boughtAt ? "<span style='color:" + (v * SELL_CUT - rec.boughtAt >= 0 ? "#9be8b4" : "#ff9e90") + "'> · flip " + (v * SELL_CUT - rec.boughtAt >= 0 ? "+" : "") + money(v * SELL_CUT - rec.boughtAt) + "</span>" : "";
        extra = "<div class='zsub'>" + occ + (m ? " · mortgage " + money(mBal) + " · equity " + money(equity(rec)) : "") + pl + "</div>";
      } else if (isRenting(rec)) {
        const lease = rentals()[rec.id];
        if (lease.isHome && g.cityRentedHome !== rec.id && !g.cityHome) acts += btn("rhome", rec.id, "Set home", "zbtn-home");
        extra = "<div class='zsub'>Rent " + money(rentFor(rec)) + "/cycle.</div>";
      } else if (canBuy(rec)) {
        if (canFinance(rec)) acts += btn("finance", rec.id, "Finance " + money(round500(buyPriceOf(rec) * FIN().minDownFrac)) + " down", "zbtn-home");
        if (canRent(rec)) acts += btn("rent", rec.id, "Lease " + money(rentFor(rec)) + "/cycle", "zbtn-neutral");
        const oi = ownerInfo(effOwnerId(rec));
        // Homes describe themselves by SQFT + a one-liner on what one guy gets;
        // other property keeps the flavor/floors blurb.
        if (rec.category === "residence" && rec.homeListed) {
          // the flagship penthouse advertises its AIRPOWER — a rooftop HELIPAD with
          // a missile helicopter that comes WITH the home, plus a deck HANGAR you
          // can buy to base a fighter jet. That perk line is the WHY behind the price.
          const perks = rec.flagship
            ? " · the city's tallest mega-tower · wraparound sky-deck garage + glass loft · 🚁 rooftop HELIPAD (missile helicopter included) · 🛩 deck HANGAR available (fighter jet)"
            : "";
          extra = "<div class='zsub'>" + rec.sqft.toLocaleString() + " sqft"
            + perks
            + (rec.blurb ? " — " + esc(rec.blurb) : "") + "</div>";
        } else {
          extra = "<div class='zsub'>" + (rec.flavor ? rec.flavor.replace(/-/g, " ") + " · " : "") + (rec.beds ? rec.beds + "-bed · " : "") + rec.storeys + (rec.storeys === 1 ? " floor" : " floors") + " · seller " + (oi.name || "—").split(" — ")[0] + "</div>";
        }
      } else if (!rec.legal) {
        // illegal op: explain the takeover gate (control the zone OR good standing)
        if (canSeize(rec)) {
          extra = "<div class='zsub'>You run this turf — take it over for " + money(seizePrice(rec)) + ".</div>";
        } else {
          const gid = holdingGangId(rec);
          const oi = gid ? ownerInfo(gid) : UNDERWORLD;
          const nm = (oi.name || "a crew").split(" — ")[0];
          const st = (gid && CBZ.cityGangStanding) ? Math.round(CBZ.cityGangStanding(gid)) : 0;
          extra = "<div class='zsub'>Run by " + esc(nm) + ". Take it by controlling this district or earning their trust (standing " + st + "/" + SEIZE_STANDING + ").</div>";
        }
      } else if (rec.marketable === false) {
        // legal but owner-occupied: surface WHO holds it (it's not on the market)
        const oc = occLabel(rec);
        extra = "<div class='zsub'>Owner-occupied" + (oc ? " by " + esc(oc) : "") + " — not listed for sale.</div>";
      }
      if (acts) extra += "<div class='zacts zacts-inline'>" + acts + "</div>";
    }

    // For homes the headline metric is SQUARE FOOTAGE (it's one guy — space, not
    // bedrooms). A green chip carries it; the flagship gets a crown.
    const sqftChip = rec.sqft
      ? " <span class='ztier' style='color:#7ed957'>" + rec.sqft.toLocaleString() + " sqft</span>"
      : "";
    const crown = rec.flagship ? "👑 " : "";
    // Every home (listed residence) gets a one-tap TOUR — teleport over to walk
    // through it before you buy; once it's yours the same button reads "Go home".
    const visitBtn = (rec.category === "residence" && rec.homeListed)
      ? btn("visit", rec.id, isOwned(rec) ? "Go home" : "Tour", "zbtn-home") : "";
    return "<div class='zcard zrow'>"
      + "<div class='zicon'>" + icon(rec) + "</div>"
      + "<div class='zmeta'>"
      + "<div class='zname'>" + crown + esc(name) + " " + badge(rec)
      + (rec.sqft ? sqftChip : " <span class='ztier' style='color:" + tcol + "'>" + ttag + "</span>") + "</div>"
      + "<div class='zaddr'>" + rec.address + " · " + zoneChip(rec)
      + (occLabel(rec) ? " · <span class='zocc'>" + esc(occLabel(rec)) + "</span>" : "") + "</div>"
      + extra
      + "</div>"
      + "<div class='zright'>"
      + "<div class='zval' data-zval='" + rec.id + "'>" + money(v) + "</div>"
      + incTxt
      + "<div class='zacts zacts-inline'>" + primary + visitBtn + btn("expand", rec.id, expanded === rec.id ? "Less" : "Details", "zbtn-neutral") + "</div>"
      + "</div>"
      + "</div>";
  }

  function listFor(which) {
    return sortListings(baseList(which).filter(matchesTools), which);
  }

  function pageCount(len) { return Math.max(1, Math.ceil(len / PAGE_SIZE)); }
  function setPage(p) {
    const arr = listFor(tab);
    const pc = pageCount(arr.length);
    page = Math.max(0, Math.min(pc - 1, p));
    expanded = null;
    render();   // deliberate navigation — always rebuild the visible page
  }

  // a one-line description so each tab's view reads clearly
  const TAB_HINT = {
    residence: "Homes for sale — buy or finance, set one as your respawn.",
    commercial: "Businesses for sale — each pays rent/profit every cycle.",
    land: "Parkland & lots — cheap to hold, no rental income.",
    illegal: "Gang operations — ranked for the empire, but seized by force, not bought.",
    owned: "Your portfolio — sell, pay off mortgages, or set a home.",
    rented: "Active leases — end a lease or set a rental as your home.",
  };

  function render() {
    const r = reg();
    refreshAllValues();
    if (TAB_IDS.indexOf(tab) < 0) tab = DEFAULT_TAB;
    const emp = playerEmpire();
    const nRented = Object.keys(rentals()).length;
    let html = "";
    html += "<div class='zhead'>"
      + "<div class='ztitle'>Property Market <span class='ztag' data-ztrend>" + trendTag() + "</span></div>"
      + "<button class='zx' data-act='close' data-id='x'>✕</button>"
      + "</div>";
    html += "<div class='zstats'>"
      + "<span>Cash <b data-zstat='cash'>" + money(g.cash || 0) + "</b></span>"
      + "<span>Bank <b data-zstat='bank'>" + money(g.cityBank || 0) + "</b></span>"
      + "<span>Holdings <b data-zstat='hval'>" + money(emp.value) + "</b> (<span data-zstat='hcount'>" + emp.count + "</span>)</span>"
      + (nRented > 0 ? "<span>Leases <b>" + nRented + "</b></span>" : "")
      + (emp.debt > 0 ? "<span>Equity <b data-zstat='eq'>" + money(emp.equity) + "</b>·debt <b style='color:#ff9e90' data-zstat='debt'>" + money(emp.debt) + "</b></span>" : "")
      + "</div>";
    if (lastMsg) html += "<div class='zflash " + (lastTone === "bad" ? "zflash-bad" : "zflash-ok") + "'>" + lastMsg + "</div>";

    // CATEGORY TABS — the real navigation. Active tab highlighted; count per tab.
    html += "<div class='ztabs'>";
    for (const t of TABS) {
      html += "<button class='ztab" + (tab === t.id ? " on" : "") + "' data-act='tab' data-id='" + t.id
        + "'><span>" + t.label + "</span><b>" + countFor(t.id) + "</b></button>";
    }
    html += "</div>";

    // tools row: search + sort only (the tabs replaced the category dropdown)
    const sopt = (v, label) => "<option value='" + v + "'" + (sortMode === v ? " selected" : "") + ">" + label + "</option>";
    html += "<div class='ztools'>"
      + "<input class='zsearch' data-zsearch value='" + esc(query) + "' placeholder='Search " + esc(tabLabel(tab)) + "'>"
      + "<select class='zselect' data-zsort title='Re-order the listings below'>"
      + sopt("smart", "Sort: Best (auto)") + sopt("cheap", "Sort: Price (low→high)") + sopt("value", "Sort: Value (high→low)")
      + sopt("yield", "Sort: Income (high→low)") + sopt("district", "Sort: District (your turf first)") + "</select>"
      + "<button class='zbtn zclear' data-act='clear' data-id='x'>Clear</button>"
      + "</div>";

    // context strip: the tab hint + a live chip showing exactly what the list is
    // sorted by RIGHT NOW (so the active sort is obvious, not buried in a closed
    // dropdown). The chip resolves "Best (auto)" to its effective per-tab order.
    html += "<div class='zctx'>"
      + "<span class='pill'>" + esc(TAB_HINT[tab] || "") + "</span>"
      + "<span class='pill zsortpill'>Sorted by <b>" + sortPillLabel(tab) + "</b></span>"
      + (query ? "<span class='pill'>Filter: <b>" + esc(query) + "</b></span>" : "")
      + "</div>";

    html += "<div class='zlist'>";
    const arr = listFor(tab);
    const pc = pageCount(arr.length);
    page = Math.min(page, pc - 1);
    const slice = arr.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
    if (!slice.length) {
      const emptyMsg = query ? "No matches for “" + esc(query) + "”."
        : tab === "owned" ? "You don't own any property yet."
        : tab === "rented" ? "No active leases."
        : tab === "illegal" ? "No gang operations listed."
        : "Nothing listed in this category.";
      html += "<div class='zempty'>" + emptyMsg + "</div>";
    }
    for (const rec of slice) html += row(rec);
    html += pager(arr.length);
    html += "</div>";
    el().innerHTML = html;
  }

  // pager: Prev · "Page X/Y (N listings)" · Next  — only when >1 page
  function pager(total) {
    const pc = pageCount(total);
    if (pc <= 1) return "";
    return "<div class='zpager'>"
      + btn("page", page - 1, "Prev", page > 0 ? "zbtn-home" : "zbtn-disabled")
      + "<span>Page <b>" + (page + 1) + "</b>/" + pc + " · " + total + "</span>"
      + btn("page", page + 1, "Next", page < pc - 1 ? "zbtn-home" : "zbtn-disabled")
      + "</div>";
  }
  // ---- LIVE patch: update only the breathing numbers, in place ---------------
  // Called every frame while the panel is open. It walks the rows currently in
  // the DOM and rewrites their Zestimate + income text (and the header stats /
  // trend) WITHOUT rebuilding the document — so the sort dropdown, the search
  // box, focus, and the list ORDER all survive untouched. This is what makes the
  // sort feel instant and sticky: structure is stable; only the values float.
  function liveUpdate() {
    if (!panel || !open_) return;
    const r = reg(); if (!r) return;
    const set = (sel, txt) => { const e = panel.querySelector(sel); if (e && e.textContent !== txt) e.textContent = txt; };
    // header stats
    const emp = playerEmpire();
    set("[data-zstat='cash']", money(g.cash || 0));
    set("[data-zstat='bank']", money(g.cityBank || 0));
    set("[data-zstat='hval']", money(emp.value));
    set("[data-zstat='hcount']", String(emp.count));
    set("[data-zstat='eq']", money(emp.equity));
    set("[data-zstat='debt']", money(emp.debt));
    set("[data-ztrend]", trendTag());
    // per-row Zestimate + net income (only the rows actually on screen)
    const vals = panel.querySelectorAll("[data-zval]");
    for (let i = 0; i < vals.length; i++) {
      const node = vals[i];
      const rec = r.byId[node.getAttribute("data-zval")]; if (!rec) continue;
      const v = mval(rec);
      const t = money(v); if (node.textContent !== t) node.textContent = t;
    }
    const incs = panel.querySelectorAll("[data-zinc]");
    for (let i = 0; i < incs.length; i++) {
      const node = incs[i];
      const rec = r.byId[node.getAttribute("data-zinc")]; if (!rec) continue;
      if (!(rec.legal && rec.category !== "land")) continue;
      const v = mval(rec);
      const estNet = round5(v * (TENANT_YIELD[rec.category] || 0) * ctrlPayMul(rec) - v * TAX_PER_TICK);
      const txt = (estNet >= 0 ? "+" : "") + money(estNet) + "/cycle";
      if (node.textContent !== txt) node.textContent = txt;
      const up = estNet >= 0;
      node.classList.toggle("up", up);
      node.classList.toggle("down", !up);
    }
  }

  // Is the user actively interacting with a control inside the panel right now
  // (typing in search, or the sort dropdown is focused/open)? If so, a structural
  // rebuild would yank the element out from under them — so we defer to a light
  // live patch instead. User ACTIONS (clicking a tab/sort/buy) call render()
  // directly and intentionally rebuild; this guard only protects the per-frame
  // and timed (income-cycle) rebuilds that the user didn't ask for.
  function userBusy() {
    if (!panel) return false;
    const ae = document.activeElement;
    if (!ae || !panel.contains(ae)) return false;
    return !!(ae.closest && (ae.closest("[data-zsearch]") || ae.closest("[data-zsort]")));
  }
  function refresh() {
    if (!open_) return;
    if (userBusy()) { liveUpdate(); return; }
    render();
  }

  function open() {
    if (CBZ.cityMenuOpen) return;
    if (!reg()) { CBZ.city && CBZ.city.note("Property market not ready.", 1.4); return; }
    open_ = true; tab = DEFAULT_TAB; lastMsg = ""; page = 0; expanded = null; query = ""; sortMode = "smart"; kindFilter = "all"; CBZ.cityMenuOpen = true;
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
  CBZ.cityOwnsLot = function (lot) { const r = reg(); if (!r || !lot) return false; const rec = r.listings.find((x) => x.lot === lot); return rec ? isOwned(rec) : false; };
  function recForLot(lot) { const r = reg(); if (!r || !lot) return null; return r.listings.find((x) => x.lot === lot) || null; }

  // total equity in the player's portfolio (consumed by economy.js net worth)
  function portfolioValue() {
    const r = reg(); if (!r) return 0;
    let eq = 0;
    for (const rec of r.listings) if (isOwned(rec)) eq += equity(rec);
    return Math.round(eq);
  }

  // Resolve a listing record from EITHER a listing id ("p7") or a world lot —
  // the shared currency the realtor/realtyoffice modules pass us.
  function recForAny(lotOrId) {
    const r = reg(); if (!r) return null;
    if (lotOrId == null) return null;
    if (typeof lotOrId === "string") return r.byId[lotOrId] || null;
    if (lotOrId.lot) return lotOrId;                 // already a record
    return recForLot(lotOrId);                       // a world lot
  }

  CBZ.cityZillow = {
    open, close, buy, finance: financeBuy, rent, sell, setHome, seize, rankings, playerEmpire,
    ownsLot: CBZ.cityOwnsLot, listings: () => reg() && reg().listings, isOpen, portfolioValue,
    isRenting: (id) => { const rec = reg() && reg().byId[id]; return rec ? isRenting(rec) : false; },
    rentByLot: (lot) => { const rec = recForLot(lot); if (rec) rent(rec.id); },
    rentEstimateForLot: (lot) => { const rec = recForLot(lot); return rec && canRent(rec) ? rentFor(rec) : null; },
    isRentingLot: (lot) => { const rec = recForLot(lot); return rec ? isRenting(rec) : false; },
    // realestate.js routes home purchases through HERE (single source of truth):
    // registers in g.cityRealtyOwned, mirrors to the world ledger, sets the home.
    buyByLot: (lot) => { const rec = recForLot(lot); if (rec) buy(rec.id, true); return rec ? isOwned(rec) : false; },
    buyPriceForLot: (lot) => { const rec = recForLot(lot); return rec ? buyPriceOf(rec) : null; },
    setHomeByLot: (lot) => { const rec = recForLot(lot); if (rec && isOwned(rec) && homeObj(rec)) setAsHome(rec, true); },
    // FINANCING (contract [E]) — financed buy by lot OR id, single source of truth.
    financeByLot: (lot) => { const rec = recForLot(lot); if (rec) financeBuy(rec.id); return rec ? isOwned(rec) : false; },
    financeQuoteForLot: (lot) => { const rec = recForLot(lot); return rec ? financeQuote(rec) : null; },
    canFinanceLot: (lot) => { const rec = recForLot(lot); return rec ? canFinance(rec) : false; },
  };

  // ==========================================================================
  //  REALTY FINANCING — the consumer side of the financing chain (contract [E]).
  //  realtyoffice.js (the in-world realtor desk) drives the player through a
  //  financed home/commercial purchase using these. They REUSE the Zillow market
  //  (no duplicate listings) and the SAME transact path as the [Z] panel, so the
  //  realtor and Zillow can never disagree on price, ownership, or debt.
  // ==========================================================================
  // Finance a property by lot OR listing id: 20% down from cash+bank, remainder
  // via the bank loan engine (or the self-contained fallback). Returns true if
  // the player ended up owning it. This is the ONLY financing entry realtyoffice
  // needs — financeBuy itself feature-detects CBZ.cityBankLoan.
  CBZ.cityRealtyFinance = function (lotOrId) {
    const rec = recForAny(lotOrId);
    if (!rec) return false;
    financeBuy(rec.id);
    return isOwned(rec);
  };
  // The buyable inventory for the realtor desk, DERIVED from the live Zillow
  // registry (which already folds the config home ladder into listed-residence
  // rows). Default = the listed home LADDER (what a realtor sells); pass
  // { commercial:true } to also include for-sale businesses, { all:true } for
  // every marketable legal lot. Each row carries everything realtyoffice.js needs
  // to render AND to drive a cash/finance buy (it calls back into buyByLot /
  // cityRealtyFinance with the id). Cash price + the financing quote are included
  // so the desk never has to recompute money. Sorted like the realtor list (homes
  // climb by level, then price).
  CBZ.cityRealtyListings = function (opts) {
    const r = reg(); if (!r) return [];
    opts = opts || {};
    const rows = [];
    for (const rec of r.listings) {
      if (!rec.legal) continue;
      const home = homeObj(rec);
      const isLadderHome = rec.category === "residence" && rec.homeListed;
      let include = false;
      if (opts.all) include = rec.marketable !== false;
      else if (isLadderHome) include = true;                                  // the ladder is always the core inventory
      else if (opts.commercial && rec.category === "commercial") include = rec.marketable !== false;
      if (!include) continue;
      const price = buyPriceOf(rec);
      rows.push({
        id: rec.id, lot: rec.lot, name: nameOf(rec), address: rec.address,
        category: rec.category, kind: rec.kind,
        value: mval(rec), price: price,
        sqft: rec.sqft || 0, beds: rec.beds || 0, storeys: rec.storeys || 1,
        tier: rec.homeTier || 0, flagship: !!rec.flagship, listedHome: isLadderHome,
        blurb: rec.blurb || "", flavor: rec.flavor || "",
        owned: isOwned(rec), isHome: isHome(rec), renting: isRenting(rec),
        canBuy: canBuy(rec), canFinance: canFinance(rec), canRent: canRent(rec),
        rentPerCycle: canRent(rec) ? rentFor(rec) : null,
        finance: financeQuote(rec),     // {down, principal, rate, payment, approved, reason, viaBank} or null
        zone: (function () { const z = (CBZ.cityZoneAt && rec.lot) ? CBZ.cityZoneAt(rec.lot.cx || 0, rec.lot.cz || 0) : null; return z ? z.name : null; })(),
      });
    }
    rows.sort((a, b) => (a.listedHome === b.listedHome ? 0 : a.listedHome ? -1 : 1)
      || (a.tier - b.tier) || (a.price - b.price) || (a.id < b.id ? -1 : 1));
    return rows;
  };

  // ---- key: [Z] toggles the market; arrows page; number keys switch tabs ----
  addEventListener("keydown", function (e) {
    if (g.mode !== "city" || g.state !== "playing") return;
    const k = (e.key || "").toLowerCase();
    if (open_) {
      if (k === "escape") { e.preventDefault(); close(); return; }
      // don't hijack keys while typing in the search box (number/Z should type)
      const ae = document.activeElement;
      const typing = ae && ae.closest && ae.closest("[data-zsearch]");
      if (typing) return;
      if (k === "z") { e.preventDefault(); close(); return; }
      // number keys 1..6 jump straight to a category tab
      if (k >= "1" && k <= "6") { e.preventDefault(); tab = TAB_IDS[parseInt(k, 10) - 1] || tab; page = 0; expanded = null; render(); return; }
      if (k === "arrowleft" || k === "[") { e.preventDefault(); setPage(page - 1); return; }
      if (k === "arrowright" || k === "]") { e.preventDefault(); setPage(page + 1); return; }
      return;
    }
    if (k === "z" && !e.repeat && !CBZ.cityMenuOpen && !(CBZ.player && CBZ.player.driving)) {
      e.preventDefault(); open();
    }
  });
})();
