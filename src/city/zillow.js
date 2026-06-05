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
  // Tuned so a single business is a steady trickle (payback ~an hour), NOT an
  // ATM, and a sprawling empire suffers diminishing returns (PORTFOLIO_DRAG) so
  // it can't compound into an unbounded money fountain that trivialises the city.
  const INCOME_TICK = 11;        // seconds between rent / business-profit payouts
  const TAX_PER_TICK = 0.0022;   // property tax per income tick (fraction of value)
  const SELL_CUT = 0.90;         // you recoup 90% of value when you sell (realtor fee)
  const YIELD = { residence: 0.0035, commercial: 0.005, land: 0.0018, illegal: 0 };
  const PORTFOLIO_DRAG = 0.05;   // net income /= (1 + DRAG × number of income properties)
  // ---- RENT (you renting FROM the market) ----------------------------------
  const RENT_FRAC = { residence: 0.012, commercial: 0.018, land: 0.006 };
  const RENT_DEPOSIT = 0.5;      // upfront deposit = RENT_DEPOSIT × first rent
  // ---- RENT OUT (NPC tenants in property YOU own) --------------------------
  const TENANT_YIELD = { residence: 0.011, commercial: 0.016, land: 0.004 };
  const VACANCY_BASE = 0.10;     // base chance a unit sits empty (no income) per cycle
  // ---- GANG-CONTROL economics (the takeover tie) ---------------------------
  // Property in a district YOUR gang owns is a HOME-FIELD bargain that earns
  // more; a rival-held district charges a premium and pays you less (you're an
  // outsider). Neutral districts sit in between. These multiply price + yield.
  const CTRL = {
    mineBuy: 0.82,   minePay: 1.30,   // your turf: 18% off to buy, +30% income
    rivalBuy: 1.22,  rivalPay: 0.72,  // rival turf: 22% premium, −28% income
    neutralBuy: 1.0, neutralPay: 1.0,
  };
  const PAGE_SIZE = 6;             // listing rows per page (keeps it ONE screen)

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
  // short, glanceable district + controller chip for a row
  function zoneChip(rec) {
    const z = zoneOf(rec);
    const name = z ? z.name : (rec.district === "island" ? "Bay Island" : "Downtown");
    const cls = controlClass(rec);
    if (cls === "mine") return "<span style='color:#7ed957'>" + name + " · yours</span>";
    if (cls === "rival") {
      const oi = ownerInfo(zoneOwnerOf(rec));
      const nm = (oi.name || "rival").split(" — ")[0];
      return "<span style='color:#ff8a7a'>" + name + " · " + nm + "</span>";
    }
    return "<span style='color:#9fb0c6'>" + name + " · neutral</span>";
  }

  // Buying a district's property pushes your INFLUENCE there: we nudge the
  // player gang to claim the nearest contested (abandoned) block to the lot you
  // just bought, so snapping up a district's real estate helps you FLIP the
  // zone in the takeover war. Only when your gang is actually founded; the
  // playergang hook claims the nearest derelict turf to a world position and
  // re-derives zone ownership itself. Safe no-op otherwise.
  function pushInfluence(rec) {
    if (!myGangId()) return;
    try {
      if (CBZ.cityPlayerGangClaimTurf) CBZ.cityPlayerGangClaimTurf(rec.lot.cx || 0, rec.lot.cz || 0);
    } catch (e) {}
    if (CBZ.cityRefreshTurfHud) try { CBZ.cityRefreshTurfHud(); } catch (e) {}
    _ctrlAt = -1e9;   // force the control cache to re-derive (a zone may have flipped)
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
        if (home && home.price > 0) value = round500(home.price * (0.95 + rnd() * 0.18));
        else value = round500((9000 * storeys + (lot.w || 24) * (lot.d || 24) * 22) * loc * noise);
        name = (home && home.name) || (b && b.name) || (island ? "Island Tower" : "Apartments");
        ownerId = corpFor(rnd).id;
      }
      if (!(value > 0)) value = round500(8000 * loc);   // never NaN / zero

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
    if (t === "rising") return "📈 Hot " + (pct >= 0 ? "+" : "") + pct + "%";
    if (t === "falling") return "📉 Cooling " + pct + "%";
    return "➖ Flat " + (pct >= 0 ? "+" : "") + pct + "%";
  }

  // ---- RENT (player renting FROM the market) --------------------------------
  function rentals() { return (g.cityRentals = g.cityRentals || {}); }
  function isRenting(rec) { return !!rentals()[rec.id]; }
  function rentFor(rec) { return round5(mval(rec) * (RENT_FRAC[rec.category] || 0.012)); }

  // ---- FINANCE / mortgage (financed buys) -----------------------------------
  function mortgages() { return (g.cityMortgages = g.cityMortgages || {}); }
  function mortgageOf(rec) { return mortgages()[rec.id] || null; }
  function FIN() { return (CBZ.cityEcon && CBZ.cityEcon.FINANCE) || { minDownFrac: 0.2, rate: 0.06, minPaymentFrac: 0.04, maxLTV: 0.8 }; }
  function equity(rec) { const m = mortgageOf(rec); return Math.max(0, mval(rec) - (m ? m.balance : 0)); }

  // ---- RENT OUT (NPC tenants in property YOU own) ---------------------------
  function tenants() { return (g.cityTenants = g.cityTenants || {}); }
  function TENANT_NAMES() { return ["the Ramirez family", "a young couple", "a startup", "a retiree", "a barista", "a remote worker", "a corner store", "a nail salon", "a med student"]; }
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
    if (!rec.legal) return "SEIZE-ONLY";
    return "FOR SALE";
  }
  function canBuy(rec) { return rec.legal && !isOwned(rec) && !isRenting(rec); }
  function canRent(rec) { return rec.legal && rec.category !== "land" && !isOwned(rec) && !isRenting(rec); }
  function canFinance(rec) { return canBuy(rec) && buyPriceOf(rec) >= 8000; }
  // you can SEIZE an illegal op cheap once your gang controls its zone
  function canSeize(rec) { return !rec.legal && rec.kind !== "abandoned" && !isOwned(rec) && controlClass(rec) === "mine"; }
  function seizePrice(rec) { return round500(mval(rec) * 0.35); }   // a steal — you run the streets here

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

  function charge(amt) {
    amt = Math.max(0, Math.round(+amt) || 0);
    if (((g.cash || 0) + (g.cityBank || 0)) < amt) return false;
    let owe = amt; const fromCash = Math.min(g.cash || 0, owe);
    g.cash = (g.cash || 0) - fromCash; owe -= fromCash; if (owe > 0) g.cityBank = (g.cityBank || 0) - owe;
    return true;
  }

  function takeResidence(rec) {
    if (rec.category === "residence" && rec.lot.building && rec.lot.building.home) {
      rec.lot.building.home.owned = true;
      if (!g.cityHome) setAsHome(rec, true);
    }
  }

  function buy(id) {
    const r = reg(); if (!r) return;
    const rec = r.byId[id]; if (!rec) return;
    if (!rec.legal) {
      if (canSeize(rec)) return seize(id);
      flash("⛔ " + rec.name + " is an illegal op — take it by force (control its zone, then Seize).", "bad");
      CBZ.city.note("That's an illegal operation — not for sale.", 2.2); if (CBZ.sfx) CBZ.sfx("empty"); refresh(); return;
    }
    if (isOwned(rec)) { flash("You already own " + rec.name + ".", "bad"); refresh(); return; }
    if (isRenting(rec)) endRent(id, true);
    const price = buyPriceOf(rec);
    if (((g.cash || 0) + (g.cityBank || 0)) < price) { flash("⛔ Need " + money(price) + " (cash + bank) to close. Try Finance.", "bad"); CBZ.city.note("Need " + money(price) + " to close.", 2); if (CBZ.sfx) CBZ.sfx("empty"); refresh(); return; }
    charge(price);
    delete mortgages()[rec.id];
    ownedSet()[rec.id] = true; rec.ownerId = "player"; rec.boughtAt = price;
    takeResidence(rec);
    pushInfluence(rec);
    CBZ.city.addRespect(Math.max(1, Math.min(40, Math.round(price / 8000))));
    const headline = (rec.business ? "🏢 Acquired " + rec.business.name : "🏠 Bought " + rec.name) + "!";
    flash("✅ " + headline + " for " + money(price), "ok"); CBZ.city.big(headline);
    if (CBZ.sfx) CBZ.sfx("coin");
    persist(); if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    refresh();
  }

  // SEIZE an illegal op in a district your gang controls — a fraction of value.
  function seize(id) {
    const r = reg(); if (!r) return;
    const rec = r.byId[id]; if (!rec || !canSeize(rec)) { flash("Can't seize that — control its district first.", "bad"); refresh(); return; }
    const price = seizePrice(rec);
    if (((g.cash || 0) + (g.cityBank || 0)) < price) { flash("⛔ Need " + money(price) + " to muscle in.", "bad"); if (CBZ.sfx) CBZ.sfx("empty"); refresh(); return; }
    charge(price);
    ownedSet()[rec.id] = true; rec.ownerId = "player"; rec.boughtAt = price; rec.legal = true; rec.category = "commercial";
    pushInfluence(rec);
    CBZ.city.addRespect(25);
    flash("🩸 Seized " + rec.name + " for " + money(price) + " — it runs under your flag now.", "ok");
    CBZ.city.big("🩸 Took over " + rec.name);
    if (CBZ.sfx) CBZ.sfx("win");
    persist(); if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    refresh();
  }

  function financeBuy(id) {
    const r = reg(); if (!r) return;
    const rec = r.byId[id]; if (!rec) return;
    if (!canFinance(rec)) { flash("Can't finance that.", "bad"); refresh(); return; }
    const f = FIN();
    const price = buyPriceOf(rec);
    const down = round500(price * f.minDownFrac);
    if (((g.cash || 0) + (g.cityBank || 0)) < down) { flash("⛔ Need " + money(down) + " down (20%) to finance.", "bad"); CBZ.city.note("Need " + money(down) + " down.", 2); if (CBZ.sfx) CBZ.sfx("empty"); refresh(); return; }
    charge(down);
    const bal = Math.max(0, price - down);
    mortgages()[rec.id] = { balance: bal, orig: bal, rate: f.rate };
    ownedSet()[rec.id] = true; rec.ownerId = "player"; rec.boughtAt = price;
    takeResidence(rec);
    pushInfluence(rec);
    CBZ.city.addRespect(Math.max(1, Math.min(20, Math.round(down / 8000))));
    flash("🏦 Financed " + (rec.business ? rec.business.name : rec.name) + " — " + money(down) + " down, " + money(bal) + " owed.", "ok");
    CBZ.city.big("🏦 Financed " + rec.name);
    if (CBZ.sfx) CBZ.sfx("coin");
    persist(); if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    refresh();
  }
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

  function rent(id) {
    const r = reg(); if (!r) return;
    const rec = r.byId[id]; if (!rec || !canRent(rec)) { flash("Can't rent that.", "bad"); refresh(); return; }
    const per = rentFor(rec);
    const deposit = round5(per * RENT_DEPOSIT);
    if (((g.cash || 0) + (g.cityBank || 0)) < deposit) { flash("⛔ Need " + money(deposit) + " deposit to move in.", "bad"); if (CBZ.sfx) CBZ.sfx("empty"); refresh(); return; }
    if (deposit > 0) charge(deposit);
    const isHomeRental = rec.category === "residence";
    rentals()[rec.id] = { rent: per, isHome: isHomeRental, missed: 0 };
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
    const payoff = m ? Math.round(m.balance) : 0;
    const got = Math.max(0, gross - payoff);
    const pl = rec.boughtAt ? gross - rec.boughtAt : 0;      // flip profit/loss vs. what you paid
    CBZ.city.addCash(got);
    delete ownedSet()[rec.id];
    delete mortgages()[rec.id];
    delete tenants()[rec.id];
    rec.ownerId = rec.initialOwnerId; rec.boughtAt = 0;
    if (rec.lot.building && rec.lot.building.home) rec.lot.building.home.owned = false;
    if (isHome(rec)) { g.cityHome = null; g.citySpawnPoint = null; CBZ.city.note("Sold your home — no respawn point until you buy another.", 2.6); }
    const plTxt = pl ? " (" + (pl >= 0 ? "+" : "") + money(pl) + " flip)" : "";
    const note = payoff > 0 ? "💸 Sold " + rec.name + " for " + money(gross) + " (−" + money(payoff) + " mortgage = +" + money(got) + ")" + plTxt + "." : "💸 Sold " + rec.name + " for " + money(got) + plTxt + ".";
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
      const m = mortgageOf(rec); if (m) debt += m.balance;
      eq += equity(rec);
    }
    return { count, value, equity: Math.round(eq), debt: Math.round(debt) };
  }

  // ---- the property economy TICK (driven by realestate.js at order 38.4) ----
  let incomeT = INCOME_TICK;
  function economyTick(dt) {
    refreshAllValues();
    if (isOpen()) refresh();
    incomeT -= dt; if (incomeT > 0) return;
    incomeT = INCOME_TICK;
    const r = reg(); if (!r) return;
    let net = 0, n = 0, vac = 0, evicted = null;

    for (const rec of r.listings) {
      if (!isOwned(rec)) continue;
      const v = mval(rec);
      const tax = Math.max(0, Math.round(v * TAX_PER_TICK));
      const m = mortgageOf(rec);
      if (m && m.balance > 0) {
        const interest = Math.round(m.balance * m.rate);
        m.balance += interest;
        const minPay = Math.min(m.balance, Math.max(interest + 50, Math.round(m.orig * FIN().minPaymentFrac)));
        if (charge(minPay)) m.balance = Math.max(0, m.balance - minPay);
        if (m.balance <= 1) delete mortgages()[rec.id];
      }
      if (isHome(rec)) { net -= tax; continue; }
      n++;
      const t = tenants()[rec.id] || (tenants()[rec.id] = { occupied: true, name: "" });
      const vacChance = VACANCY_BASE * (rec.category === "commercial" ? 1.2 : 1) * (0.6 + 600 / Math.max(600, v));
      if (Math.random() < vacChance) { t.occupied = false; t.name = ""; vac++; }
      else if (!t.occupied) { t.occupied = true; t.name = TENANT_NAMES()[(Math.random() * 9) | 0]; }
      // GANG TIE: income is scaled by who controls the district (your turf pays
      // more, a rival's turf pays less). This makes the takeover feed the wallet.
      const income = t.occupied ? round5(v * (TENANT_YIELD[rec.category] || 0.01) * ctrlPayMul(rec)) : 0;
      net += income - tax;
    }
    if (n > 0 && net > 0) net = Math.round(net / (1 + PORTFOLIO_DRAG * n));

    if (net > 0) { CBZ.city.addCash(net); CBZ.city.note("🏢 Portfolio +" + money(net) + " (" + n + " unit" + (n === 1 ? "" : "s") + (vac ? ", " + vac + " vacant" : "") + ")", 2); }
    else if (net < 0) {
      let owe = -net; const fromCash = Math.min(g.cash || 0, owe); g.cash = (g.cash || 0) - fromCash; owe -= fromCash;
      if (owe > 0) g.cityBank = Math.max(0, (g.cityBank || 0) - owe);
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
      CBZ.city.note("🏢 Property upkeep -" + money(-net), 1.8);
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
    if (evicted) CBZ.city.note("📦 Evicted from " + evicted + " — missed the rent.", 2.6);

    persist();
    if (isOpen()) refresh();
  }
  CBZ.cityZillowTick = economyTick;

  // ---- reset per life --------------------------------------------------------
  CBZ.cityZillowReset = function () {
    g.cityRealtyOwned = {};
    g.cityRentals = {}; g.cityMortgages = {}; g.cityTenants = {}; g.cityRentedHome = null;
    incomeT = INCOME_TICK; page = 0;
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
  let panel = null, tab = "sale", open_ = false, page = 0, expanded = null;

  function el() {
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "cityZillow";
    panel.className = "zwrap";
    document.body.appendChild(panel);
    panel.addEventListener("click", function (e) {
      const t = e.target.closest ? e.target.closest("[data-act]") : null;
      if (!t) return;
      const act = t.getAttribute("data-act"), id = t.getAttribute("data-id");
      if (act === "tab") { tab = id; page = 0; expanded = null; refresh(); return; }
      if (act === "page") { setPage(parseInt(id, 10)); return; }
      if (act === "expand") { expanded = expanded === id ? null : id; refresh(); return; }
      if (act === "buy") buy(id);
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
    return panel;
  }
  function isOpen() { return open_; }

  function badge(rec) {
    const s = statusOf(rec);
    let cls = "zb-sale";
    if (s === "OWNED" || s === "HOME" || s === "FINANCED" || s === "LEASED" || s === "LEASED·HOME") cls = "zb-own";
    else if (s === "SEIZE-ONLY") cls = "zb-illegal";
    return "<span class='zbadge " + cls + "'>" + s + "</span>";
  }
  function icon(rec) {
    if (rec.category === "land") return "🌳";
    if (rec.category === "residence") return "🏠";
    if (!rec.legal) return rec.kind === "abandoned" ? "🏚️" : "💊";
    return "🏪";
  }
  function btn(act, id, label, bg) {
    return "<button class='zbtn' style='background:" + bg + ";color:#fff;padding:5px 10px;font-size:12px' data-act='" + act + "' data-id='" + id + "'>" + label + "</button>";
  }

  // a COMPACT one-line row: icon · name+badge · district/gang · tier · yield · value
  // The row's primary button is inline; clicking the row name expands extra
  // actions (finance/rent/sell/home) so the list stays a single tidy line.
  function row(rec) {
    const v = mval(rec);
    const tIdx = tierIdx(rec.base || v);
    const tcol = TIER_COL[tIdx];
    const ttag = TIERS[tIdx].tag;
    const name = rec.business ? rec.business.name : rec.name;
    const yieldPct = (TENANT_YIELD[rec.category] || 0) * ctrlPayMul(rec) - TAX_PER_TICK;
    const yldTxt = rec.legal && rec.category !== "land"
      ? "<span style='color:" + (yieldPct > 0 ? "#9be8b4" : "#ff9e90") + ";font-size:11px'>" + (yieldPct >= 0 ? "+" : "") + (yieldPct * 100).toFixed(2) + "%/cyc</span>"
      : "<span style='color:#7f8794;font-size:11px'>—</span>";

    // primary action (right side)
    let primary = "";
    const m = mortgageOf(rec);
    if (isOwned(rec)) {
      const netSale = Math.max(0, round500(v * SELL_CUT) - (m ? Math.round(m.balance) : 0));
      primary = btn("sell", rec.id, "Sell " + money(netSale), "#b8553a");
    } else if (isRenting(rec)) {
      primary = btn("endrent", rec.id, "End lease", "#6b7480");
    } else if (canSeize(rec)) {
      primary = btn("seize", rec.id, "Seize " + money(seizePrice(rec)), "#a8324b");
    } else if (canBuy(rec)) {
      primary = btn("buy", rec.id, "Buy " + money(buyPriceOf(rec)), "#2f9e4f");
    } else {
      primary = "<span class='znope'>Off market</span>";
    }

    // expandable secondary actions / detail
    let extra = "";
    if (expanded === rec.id) {
      let acts = "";
      if (isOwned(rec)) {
        if (m) { acts += btn("payhalf", rec.id, "Pay ½", "#3a6ea5") + btn("payoff", rec.id, "Pay off " + money(Math.round(m.balance)), "#2f6fed"); }
        if (rec.category === "residence" && homeObj(rec) && !isHome(rec)) acts += btn("home", rec.id, "Set as home", "#3a4658");
        const t = tenants()[rec.id];
        const occ = isHome(rec) ? "your residence (no rent)" : (t && t.occupied === false ? "🚪 vacant" : (t && t.name ? "🧍 " + t.name : "🧍 leased"));
        const pl = rec.boughtAt ? "<span style='color:" + (v * SELL_CUT - rec.boughtAt >= 0 ? "#9be8b4" : "#ff9e90") + "'> · flip " + (v * SELL_CUT - rec.boughtAt >= 0 ? "+" : "") + money(v * SELL_CUT - rec.boughtAt) + "</span>" : "";
        extra = "<div class='zsub'>" + occ + (m ? " · mortgage " + money(Math.round(m.balance)) + " · equity " + money(equity(rec)) : "") + pl + "</div>";
      } else if (isRenting(rec)) {
        const lease = rentals()[rec.id];
        if (lease.isHome && g.cityRentedHome !== rec.id && !g.cityHome) acts += btn("rhome", rec.id, "Set as home", "#3a4658");
        extra = "<div class='zsub'>Rent " + money(rentFor(rec)) + "/cycle · pay it or you're evicted.</div>";
      } else if (canBuy(rec)) {
        if (canFinance(rec)) acts += btn("finance", rec.id, "Finance " + money(round500(buyPriceOf(rec) * FIN().minDownFrac)) + "↓", "#2f6fed");
        if (canRent(rec)) acts += btn("rent", rec.id, "Rent " + money(rentFor(rec)) + "/cyc", "#7a5cc0");
        const oi = ownerInfo(effOwnerId(rec));
        extra = "<div class='zsub'>" + (rec.flavor ? rec.flavor.replace(/-/g, " ") + " · " : "") + (rec.beds ? rec.beds + "-bed · " : "") + rec.storeys + (rec.storeys === 1 ? " floor" : " floors") + " · seller " + (oi.name || "—").split(" — ")[0] + "</div>";
      } else if (canSeize(rec)) {
        extra = "<div class='zsub'>Illegal op in YOUR district — muscle in cheap and fly your flag.</div>";
      }
      if (acts) extra += "<div class='zacts' style='flex-direction:row;flex-wrap:wrap'>" + acts + "</div>";
    }

    return "<div class='zcard' style='padding:7px 11px;gap:9px;cursor:pointer' data-act='expand' data-id='" + rec.id + "'>"
      + "<div class='zicon' style='font-size:22px;width:28px'>" + icon(rec) + "</div>"
      + "<div class='zmeta'>"
      + "<div class='zname' style='font-size:14px'>" + name + " " + badge(rec)
      + " <span style='color:" + tcol + ";font-size:10px;font-weight:700'>" + ttag + "</span></div>"
      + "<div class='zaddr' style='font-size:11px'>" + rec.address + " · " + zoneChip(rec) + "</div>"
      + extra
      + "</div>"
      + "<div class='zright' style='min-width:118px;gap:1px'>"
      + "<div class='zval' style='font-size:15px'>" + money(v) + "</div>"
      + yldTxt
      + "<div class='zacts' style='margin-top:2px'>" + primary + "</div>"
      + "</div>"
      + "</div>";
  }

  function listFor(which) {
    const r = reg(); if (!r) return [];
    let arr = r.listings.slice();
    if (which === "sale") arr = arr.filter((x) => canBuy(x) || canSeize(x));
    else if (which === "owned") arr = arr.filter((x) => isOwned(x));
    else if (which === "rented") arr = arr.filter((x) => isRenting(x));
    else if (which === "illegal") arr = arr.filter((x) => !x.legal);
    arr.sort((a, b) => which === "sale" ? mval(a) - mval(b) : mval(b) - mval(a));
    return arr;
  }

  function pageCount(len) { return Math.max(1, Math.ceil(len / PAGE_SIZE)); }
  function setPage(p) {
    const arr = listFor(tab);
    const pc = pageCount(arr.length);
    page = Math.max(0, Math.min(pc - 1, p));
    expanded = null;
    refresh();
  }

  function render() {
    const r = reg();
    refreshAllValues();
    const emp = playerEmpire();
    const ranks = rankings();
    const myRank = ranks.findIndex((x) => x.you) + 1;
    const nRented = Object.keys(rentals()).length;
    let html = "";
    html += "<div class='zhead'>"
      + "<div class='ztitle' style='font-size:19px'>🏠 Zillow <span class='ztag'>Property &amp; Business · " + trendTag() + "</span></div>"
      + "<button class='zx' data-act='close' data-id='x'>✕</button>"
      + "</div>";
    html += "<div class='zstats'>"
      + "<span>Cash <b>" + money(g.cash || 0) + "</b></span>"
      + "<span>Bank <b>" + money(g.cityBank || 0) + "</b></span>"
      + "<span>Empire <b>" + money(emp.value) + "</b> (" + emp.count + ")</span>"
      + (emp.debt > 0 ? "<span>Equity <b>" + money(emp.equity) + "</b>·debt <b style='color:#ff9e90'>" + money(emp.debt) + "</b></span>" : "")
      + "<span>Rank <b>#" + (myRank || "—") + "</b>/" + ranks.length + "</span>"
      + "</div>";
    if (lastMsg) html += "<div class='zflash " + (lastTone === "bad" ? "zflash-bad" : "zflash-ok") + "' style='padding:5px 12px;font-size:12px'>" + lastMsg + "</div>";

    const tabs = [["sale", "Buy"], ["owned", "Owned " + emp.count], ["rented", "Rent " + nRented], ["illegal", "Streets"], ["ranks", "Empires"]];
    html += "<div class='ztabs'>";
    for (const [id, label] of tabs) html += "<button class='ztab" + (tab === id ? " on" : "") + "' style='padding:6px 4px;font-size:12px' data-act='tab' data-id='" + id + "'>" + label + "</button>";
    html += "</div>";

    html += "<div class='zlist' style='gap:6px'>";
    if (tab === "ranks") {
      html += "<div class='zhint'>Total property + business value held by each player. Control districts + buy them up to climb.</div>";
      const pc = pageCount(ranks.length);
      page = Math.min(page, pc - 1);
      const slice = ranks.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
      slice.forEach((rowd, i) => {
        const gi = page * PAGE_SIZE + i;
        html += "<div class='zrank" + (rowd.you ? " me" : "") + "' style='padding:7px 11px;font-size:13px'>"
          + "<span class='zrnum'>#" + (gi + 1) + "</span>"
          + "<span class='zrname' style='color:" + colHex(rowd.color) + "'>" + rowd.name + (rowd.you ? " (you)" : "") + "</span>"
          + "<span class='zrcount'>" + rowd.count + " prop" + (rowd.count === 1 ? "" : "s") + "</span>"
          + "<span class='zrval'>" + money(rowd.value) + "</span>"
          + "</div>";
      });
      html += pager(ranks.length);
    } else {
      const hints = {
        sale: "Tap a row for Finance/Rent. Prices float with the market + gang control — buy in YOUR district for a discount, in a rival's for a premium.",
        owned: "Units you don't live in auto-lease to tenants (your district pays more). Tap to pay off mortgages or set a home.",
        rented: "Rent is charged every cycle — miss it and you're evicted. A rented home is a respawn point.",
        illegal: "Illegal ops belong to the crews. Take a district with your gang, then Seize the op cheap.",
      };
      html += "<div class='zhint'>" + (hints[tab] || "") + "</div>";
      const arr = listFor(tab);
      const pc = pageCount(arr.length);
      page = Math.min(page, pc - 1);
      const slice = arr.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
      if (!slice.length) html += "<div class='zempty'>" + (tab === "owned" ? "You own nothing yet. Hit Buy." : tab === "rented" ? "You're not renting. Lease one from Buy." : tab === "illegal" ? "The streets are quiet." : "Nothing for sale.") + "</div>";
      for (const rec of slice) html += row(rec);
      html += pager(arr.length);
    }
    html += "</div>";
    html += "<div class='zfoot'>[Z]/[Esc] close · [1-5] tabs · [←/→] page · tap a row for more</div>";
    el().innerHTML = html;
  }

  // pager: Prev · "Page X/Y (N listings)" · Next  — only when >1 page
  function pager(total) {
    const pc = pageCount(total);
    if (pc <= 1) return "";
    const hidden = total - PAGE_SIZE;
    return "<div style='display:flex;align-items:center;justify-content:center;gap:10px;padding:4px 0 2px;font-size:12px;color:#9fb0c6'>"
      + "<button class='zbtn' style='background:" + (page > 0 ? "#2f6fed" : "#2a323c") + ";color:#fff;padding:4px 12px' data-act='page' data-id='" + (page - 1) + "'>‹ Prev</button>"
      + "<span>Page <b style='color:#ffd166'>" + (page + 1) + "</b>/" + pc + " · " + total + " listings</span>"
      + "<button class='zbtn' style='background:" + (page < pc - 1 ? "#2f6fed" : "#2a323c") + ";color:#fff;padding:4px 12px' data-act='page' data-id='" + (page + 1) + "'>Next ›</button>"
      + "</div>";
  }
  function refresh() { if (open_) render(); }

  function open() {
    if (CBZ.cityMenuOpen) return;
    if (!reg()) { CBZ.city && CBZ.city.note("Property market not ready.", 1.4); return; }
    open_ = true; tab = "sale"; lastMsg = ""; page = 0; expanded = null; CBZ.cityMenuOpen = true;
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

  CBZ.cityZillow = {
    open, close, buy, finance: financeBuy, rent, sell, setHome, seize, rankings, playerEmpire,
    ownsLot: CBZ.cityOwnsLot, listings: () => reg() && reg().listings, isOpen, portfolioValue,
    isRenting: (id) => { const rec = reg() && reg().byId[id]; return rec ? isRenting(rec) : false; },
    rentByLot: (lot) => { const rec = recForLot(lot); if (rec) rent(rec.id); },
    rentEstimateForLot: (lot) => { const rec = recForLot(lot); return rec && canRent(rec) ? rentFor(rec) : null; },
    isRentingLot: (lot) => { const rec = recForLot(lot); return rec ? isRenting(rec) : false; },
  };

  // ---- key: [Z] toggles the market; arrows page; 1-5 switch tabs ------------
  addEventListener("keydown", function (e) {
    if (g.mode !== "city" || g.state !== "playing") return;
    const k = (e.key || "").toLowerCase();
    if (open_) {
      if (k === "escape" || k === "z") { e.preventDefault(); close(); return; }
      if (k >= "1" && k <= "5") { e.preventDefault(); tab = ["sale", "owned", "rented", "illegal", "ranks"][parseInt(k, 10) - 1]; page = 0; expanded = null; render(); return; }
      if (k === "arrowleft" || k === "[") { e.preventDefault(); setPage(page - 1); return; }
      if (k === "arrowright" || k === "]") { e.preventDefault(); setPage(page + 1); return; }
      return;
    }
    if (k === "z" && !e.repeat && !CBZ.cityMenuOpen && !(CBZ.player && CBZ.player.driving)) {
      e.preventDefault(); open();
    }
  });
})();
