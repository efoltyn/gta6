/* ============================================================
   city/zillow.js - the city-wide property + business MARKET (the ledger).

   Every lot in the city has a listing here: shops, residences, parks and
   gang-run derelicts, each with a live value. This file is the ledger and
   the transaction paths; it has NO screen of its own. You buy, finance,
   rent, sell and take over property in the world, through ONE flow:
     city/plots.js       the FOR SALE sign at the curb (buy / finance / take
                         over) and your own lot's address post (value,
                         mortgage, set as home, demolish, sell)
     city/realestate.js  the realtor's home ladder and a residence's door
                         (buy / finance / rent a home, the safehouse)
   (The [Z] phone marketplace and the realty-office listings wall were two
   more screens over this same ledger; both are deleted.)

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

   Exposes: CBZ.cityZillow, CBZ.cityZillowReset, CBZ.cityOwnsLot,
            CBZ.cityZillowTick, CBZ.cityRealtyOwnedHomes.
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
      // ALMOST EVERY LOT IS FOR SALE (owner: "being able to buy almost every
      // property in almost every lot"). The curated flag used to keep every
      // apartment block that was not a rung of the home ladder off the market;
      // a landlord sells for the right price, so a residence is always
      // listed. What stays off: city-held civic buildings and parks (the
      // stamp says city), and gang operations (illegal, taken by force).
      else if (stamp) marketable = stamp.buyable !== false || (category === "residence" && stamp.type !== "city");
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

    // lot -> listing, so "is this lot mine" is O(1) for the map, the build
    // gate and the sale signs (it was a linear find over every listing).
    const byLot = new Map();
    for (const rec of listings) byLot.set(rec.lot, rec);
    A.realty = { listings, byId, byLot };
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
  function canBuy(rec) { return rec.legal && rec.marketable !== false && !isOwned(rec) && !isRenting(rec); }
  function canRent(rec) { return rec.legal && rec.marketable !== false && rec.category !== "land" && !isOwned(rec) && !isRenting(rec); }
  function canFinance(rec) { return canBuy(rec) && buyPriceOf(rec) >= 8000; }
  // A side-effect-FREE financing quote for a listing — what the realtor (and the
  // listing panel) preview before you commit. 20% down from FIN(); the rest
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
  // the last transaction's outcome, in words: the plots/realtor panels show it
  // when a buy they asked for did not close
  let lastMsg = "";
  function flash(msg) { lastMsg = msg; }

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
    /* THE PORTFOLIO ABOVE IS A REPORT, NOT A SAVE — every field in it is a
       formatted display string and nothing ever read one back, so a reload
       handed the deeds back to the corporations. That was survivable while a
       house was only a spawn point; it is not survivable now that a house is
       somewhere you can leave money (city/cashstore.js's floor safe keys its
       bags on rec.id), because the safe would outlive the ownership of the
       building it is in. The ids are what the game actually needs, they are
       deterministic per seed (`p<lotIndex>`), and they are two lines. */
    const own = [];
    for (const id in ownedSet()) if (ownedSet()[id]) own.push(id);
    w.assets.realtyOwned = own;
  }
  /* …and the other half. Hydration is idempotent and self-validating: an id
     that no longer matches a listing in THIS world is dropped rather than
     resurrected, so a save carried to a different seed cannot hand you a deed
     to a lot that does not exist. */
  let _hydrated = false;
  function hydrateOwned() {
    if (_hydrated) return;
    const r = reg(); if (!r) return;          // no arena yet — try again later
    _hydrated = true;
    if (!CBZ.cityWorldEnsure) return;
    let w = null;
    try { w = CBZ.cityWorldEnsure(); } catch (e) { w = null; }
    const list = w && w.assets && w.assets.realtyOwned;
    if (!Array.isArray(list)) return;
    const set = ownedSet();
    for (let i = 0; i < list.length; i++) {
      const rec = r.byId[list[i]];
      if (!rec) continue;
      set[rec.id] = true; rec.ownerId = "player";
      takeResidence(rec);
    }
  }

  /* WHICH HOUSES ARE YOURS, as PLACES — the seam city/cashstore.js consumes
     to put a floor safe inside a home you bought on [Z] without re-deriving
     one word of this file's ownership rules. Doors first (a safe belongs
     inside the threshold), lot centre as the fallback for a lot with no
     stamped door. */
  CBZ.cityRealtyOwnedHomes = function () {
    const r = reg(); if (!r) return [];
    const out = [];
    for (const rec of r.listings) {
      if (rec.category !== "residence" || !isOwned(rec)) continue;
      const b = rec.lot.building, d = (b && b.door) || null;
      out.push({
        id: rec.id, name: nameOf(rec), value: mval(rec),
        tier: rec.homeTier || 0, isHome: isHome(rec),
        x: d ? d.x : rec.lot.cx, z: d ? d.z : rec.lot.cz,
        cx: rec.lot.cx, cz: rec.lot.cz, lot: rec.lot,
      });
    }
    return out;
  };

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
        if (CBZ.city && CBZ.city.big) CBZ.city.big("The missile helicopter is yours, on the pad.");
      }
    }
  }

  // `direct` = an explicit realtor/door purchase (realestate.js routes home buys
  // here so there's ONE source of truth) — it bypasses the curated-market gate
  // because the realtor IS a legitimate sales venue for residences.
  function buy(id, direct) {
    const r = reg(); if (!r) return;
    const rec = r.byId[id]; if (!rec) return;
    if (!rec.legal) {
      if (canSeize(rec)) return seize(id);
      flash(rec.name + " can only be taken by force, control its district or earn the crew's trust.", "bad");
      CBZ.city.note("That's a gang operation, take it over by holding the turf, not at a desk.", 2.4); if (CBZ.sfx) CBZ.sfx("empty"); return;
    }
    if (isOwned(rec)) { flash("You already own " + rec.name + ".", "bad"); return; }
    if (rec.marketable === false && !direct) {
      const oc = rec.occupant ? rec.occupant.split(" — ")[0] : "its owner";
      flash(rec.name + " isn't for sale · " + oc + " occupies it.", "bad");
      CBZ.city.note("That property is occupied and off the market.", 2); if (CBZ.sfx) CBZ.sfx("empty"); return;
    }
    if (isRenting(rec)) endRent(id, true);
    const price = buyPriceOf(rec);
    if (((g.cash || 0) + (g.cityBank || 0)) < price) { flash("Need " + money(price) + " cash + bank to close. Try financing.", "bad"); CBZ.city.note("Need " + money(price) + " to close.", 2); if (CBZ.sfx) CBZ.sfx("empty"); return; }
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

  }

  function seize(id) {
    const r = reg(); if (!r) return;
    const rec = r.byId[id]; if (!rec || !canSeize(rec)) { flash("That operation isn't yours to take over.", "bad"); return; }
    const price = seizePrice(rec);
    if (((g.cash || 0) + (g.cityBank || 0)) < price) { flash("Need " + money(price) + ".", "bad"); if (CBZ.sfx) CBZ.sfx("empty"); return; }
    charge(price);
    ownedSet()[rec.id] = true; rec.ownerId = "player"; rec.boughtAt = price; rec.legal = true; rec.category = "commercial";
    pushInfluence(rec);
    CBZ.city.addRespect(25);
    flash("Took over " + rec.name + " for " + money(price) + ".", "ok");
    CBZ.city.big("Took over " + rec.name);
    if (CBZ.sfx) CBZ.sfx("coin");
    persist(); if (CBZ.cityHudDirty) CBZ.cityHudDirty();

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
    if (!canFinance(rec)) { flash("Can't finance that.", "bad"); return; }
    const f = FIN();
    const price = buyPriceOf(rec);
    const down = round500(price * f.minDownFrac);
    const principal = Math.max(0, price - down);
    if (((g.cash || 0) + (g.cityBank || 0)) < down) { flash("Need " + money(down) + " down to finance.", "bad"); CBZ.city.note("Need " + money(down) + " down.", 2); if (CBZ.sfx) CBZ.sfx("empty"); return; }

    const bl = bankLoan();
    let mort;   // the record we'll stamp once the down clears
    if (bl && bl.offer && bl.take) {
      // ---- bank.js underwrites the mortgage ----------------------------------
      const offer = bl.offer("mortgage", principal, { propertyId: rec.id, value: mval(rec), down: down, category: rec.category, kind: rec.kind });
      if (!offer || !offer.approved) {
        const why = (offer && offer.reason) ? offer.reason : "the bank declined the mortgage";
        flash("Mortgage declined · " + why + ".", "bad"); CBZ.city.note("Mortgage declined: " + why + ".", 2.4); if (CBZ.sfx) CBZ.sfx("empty"); return;
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

  }
  function payMortgage(id, frac) {
    const r = reg(); if (!r) return;
    const rec = r.byId[id]; const m = rec && mortgageOf(rec); if (!m) return;
    const balance = mortgageBalanceOf(rec);
    let pay = frac >= 1 ? balance : round500(balance * frac);
    pay = Math.min(pay, balance);
    if (pay <= 0) return;
    if (((g.cash || 0) + (g.cityBank || 0)) < pay) { flash("Need " + money(pay) + " to pay down.", "bad"); if (CBZ.sfx) CBZ.sfx("empty"); return; }
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
      return;
    }
    charge(pay);
    m.balance = Math.max(0, balance - pay);
    if (m.balance <= 1) { delete mortgages()[rec.id]; flash("Mortgage cleared on " + rec.name + ".", "ok"); CBZ.city.big("Mortgage cleared"); }
    else flash("Paid " + money(pay) + " toward " + rec.name + ". " + money(m.balance) + " left.", "ok");
    if (CBZ.sfx) CBZ.sfx("coin");
    persist(); if (CBZ.cityHudDirty) CBZ.cityHudDirty();

  }

  function rent(id) {
    const r = reg(); if (!r) return;
    const rec = r.byId[id]; if (!rec || !canRent(rec)) { flash("Can't rent that.", "bad"); return; }
    const per = rentFor(rec);
    const deposit = round5(per * RENT_DEPOSIT);
    if (((g.cash || 0) + (g.cityBank || 0)) < deposit) { flash("Need " + money(deposit) + " deposit to move in.", "bad"); if (CBZ.sfx) CBZ.sfx("empty"); return; }
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

  }
  function endRent(id, quiet) {
    const rec = reg() && reg().byId[id]; if (!rec) return;
    const had = rentals()[rec.id]; if (!had) return;
    delete rentals()[rec.id];
    if (g.cityRentedHome === rec.id) {
      g.cityRentedHome = null;
      if (!g.cityHome) { g.citySpawnPoint = null; if (!quiet) CBZ.city.note("Your lease is up, you\u2019ve got no place to crash until you rent or buy again.", 2.4, { from: "Zillow" }); }
    }
    if (!quiet) { flash("Ended your lease on " + rec.name + ".", "ok"); persist(); }
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
    if (isHome(rec)) { g.cityHome = null; g.citySpawnPoint = null; CBZ.city.note("Sale closed on your place, you\u2019re off the books until you buy again.", 2.6, { from: "Zillow" }); }
    const plTxt = pl ? " (" + (pl >= 0 ? "+" : "") + money(pl) + " flip)" : "";
    const note = payoff > 0 ? "Sold " + rec.name + " for " + money(gross) + " (-" + money(payoff) + " mortgage = +" + money(got) + ")" + plTxt + "." : "Sold " + rec.name + " for " + money(got) + plTxt + ".";
    flash(note, "ok"); CBZ.city.big("SOLD " + rec.name + " · +" + money(got));
    if (CBZ.sfx) CBZ.sfx("coin");
    persist(); if (CBZ.cityHudDirty) CBZ.cityHudDirty();

  }

  function setAsHome(rec, quiet) {
    if (!rec || !isOwned(rec)) return;
    const b = rec.lot.building, home = b && b.home;
    if (!home) { flash("Only a residence can be your home.", "bad"); CBZ.city.note("Only a residence can be your home.", 1.8); return; }
    const movedFrom = (g.cityHome && g.cityHome.lot !== rec.lot) ? g.cityHome.name : null;
    home.owned = true;
    g.cityHome = { lot: rec.lot, tier: home.tier, id: home.id, name: home.name };
    g.cityRentTier = null;
    g.cityRentedHome = null;
    const door = (b.door || { x: rec.lot.cx, z: rec.lot.cz });
    g.citySpawnPoint = { x: door.x, z: door.z };
    if (!quiet) {
      flash(home.name + " is now your home" + (movedFrom ? "; " + movedFrom + " becomes a rental" : "") + ".", "ok");
      CBZ.city.note(home.name + " is yours now, welcome home.", 2.4, { from: "Zillow" });

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
    hydrateOwned();          // one shot, the first tick the arena exists
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
      // A LOT YOU KNOCKED DOWN HAS NO TENANTS. Nobody leases a unit in a
      // building that is a pad; the land still owes its tax. What a cleared
      // lot earns is what its crew physically brings home (city/compoundcrew.js).
      if (rec.lot.demolished) { net -= tax; continue; }
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
  }
  CBZ.cityZillowTick = economyTick;

  // ---- reset per life --------------------------------------------------------
  CBZ.cityZillowReset = function () {
    g.cityRealtyOwned = {};
    _hydrated = false;       // a fresh arena re-reads the ledger

    g.cityRentals = {}; g.cityMortgages = {}; g.cityTenants = {}; g.cityRentedHome = null;
    // apex-home airpower (penthouse → helicopter; bought hangar → jet) is per-run
    g.cityOwnsPenthouse = false; g.cityOwnsHeli = false; g.cityOwnsHangar = false;
    incomeT = INCOME_TICK;
    if (CBZ.cityEcon && CBZ.cityEcon.initPropMarket) CBZ.cityEcon.initPropMarket();
    const A = CBZ.city && CBZ.city.arena;
    if (A && A.realty) for (const rec of A.realty.listings) {
      rec.ownerId = rec.initialOwnerId; rec.value = rec.base; rec.boughtAt = 0; rec._ctrl = null;
      if (rec.initialLegal != null) rec.legal = rec.initialLegal;          // un-seize: ops go back to the crews
      if (rec.initialCategory != null) rec.category = rec.initialCategory;
    }
    _ctrlAt = -1e9;
  };

  function nameOf(rec) { return rec.business ? rec.business.name : rec.name; }

  CBZ.cityOwnsLot = function (lot) { const rec = recForLot(lot); return rec ? isOwned(rec) : false; };
  function recForLot(lot) { const r = reg(); if (!r || !lot) return null; return (r.byLot && r.byLot.get(lot)) || r.listings.find((x) => x.lot === lot) || null; }

  // total equity in the player's portfolio (consumed by economy.js net worth)
  function portfolioValue() {
    const r = reg(); if (!r) return 0;
    let eq = 0;
    for (const rec of r.listings) if (isOwned(rec)) eq += equity(rec);
    return Math.round(eq);
  }

  CBZ.cityZillow = {
    buy, finance: financeBuy, rent, sell, setHome, seize, rankings, playerEmpire,
    ownsLot: CBZ.cityOwnsLot, listings: () => reg() && reg().listings, portfolioValue,
    lastMessage: () => lastMsg,
    // OWNED-LOT upkeep for the address-post panel (city/plots.js)
    mortgageForLot: (lot) => { const rec = recForLot(lot); if (!rec || !mortgageOf(rec)) return null; return { balance: mortgageBalanceOf(rec), rate: mortgageRateOf(rec) }; },
    payMortgageByLot: (lot, frac) => { const rec = recForLot(lot); if (rec) payMortgage(rec.id, frac == null ? 1 : frac); return lastMsg; },
    // GANG OPS: an illegal op you have earned (your turf, or the crew trusts
    // you) is taken over at its curb, not bought
    canSeizeLot: (lot) => { const rec = recForLot(lot); return rec ? canSeize(rec) : false; },
    seizePriceForLot: (lot) => { const rec = recForLot(lot); return rec ? seizePrice(rec) : null; },
    seizeByLot: (lot) => { const rec = recForLot(lot); if (rec) seize(rec.id); return rec ? isOwned(rec) : false; },
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
    // THE PHYSICAL PROPERTY LAYER (city/plots.js) reads the market through
    // these: the sale sign's price, whether the lot can be bought here, the
    // name/address on the deed, and the sell path.
    listingForLot: (lot) => recForLot(lot),
    canBuyLot: (lot) => { const rec = recForLot(lot); return rec ? canBuy(rec) : false; },
    sellByLot: (lot) => { const rec = recForLot(lot); if (rec && isOwned(rec)) sell(rec.id); return rec ? !isOwned(rec) : false; },
    sellPriceForLot: (lot) => { const rec = recForLot(lot); return rec ? Math.round(mval(rec) * SELL_CUT) : null; },
    nameOfLot: (lot) => { const rec = recForLot(lot); return rec ? nameOf(rec) : null; },
    ownedLots: () => { const r = reg(); if (!r) return []; const out = []; for (const rec of r.listings) if (isOwned(rec)) out.push(rec.lot); return out; },
  };

  // The buyable inventory as rows, DERIVED from the live registry (which
  // already folds the config home ladder into listed-residence rows). Default =
  // the listed home LADDER; { commercial:true } adds for-sale businesses,
  // { all:true } every marketable legal lot. Each row carries the cash price and
  // the financing quote. Read-only: probes/presets read it; buying goes through
  // buyByLot / financeByLot like everything else.
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

})();
