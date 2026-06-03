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

      const rec = {
        id: "p" + idx,
        lot, idx, district: island ? "island" : "downtown",
        kind, category, legal, value, name, address: addr,
        beds: (b && b.home && b.home.beds) || 0,
        storeys, business,
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
    if (isOwned(rec)) return isHome(rec) ? "YOUR HOME" : "OWNED";
    if (!rec.legal) return "NOT FOR SALE";
    return "FOR SALE";
  }
  function canBuy(rec) { return rec.legal && !isOwned(rec); }

  // ---- transactions ---------------------------------------------------------
  // feedback while the panel is up (the engine toast is occluded by the overlay)
  let lastMsg = "", lastTone = "ok";
  function flash(msg, tone) { lastMsg = msg; lastTone = tone || "ok"; }

  function buy(id) {
    const r = reg(); if (!r) return;
    const rec = r.byId[id]; if (!rec) return;
    if (!rec.legal) { flash("⛔ " + rec.name + " is an illegal operation — take it by force, not by cheque.", "bad"); CBZ.city.note("That's an illegal operation — not for sale.", 2.2); if (CBZ.sfx) CBZ.sfx("empty"); refresh(); return; }
    if (isOwned(rec)) { flash("You already own " + rec.name + ".", "bad"); refresh(); return; }
    const total = (g.cash || 0) + (g.cityBank || 0);
    if (total < rec.value) { flash("⛔ Need " + money(rec.value) + " (cash + bank) to close.", "bad"); CBZ.city.note("Need " + money(rec.value) + " to close.", 2); if (CBZ.sfx) CBZ.sfx("empty"); refresh(); return; }
    // pull from cash first, then bank
    let owe = rec.value; const fromCash = Math.min(g.cash || 0, owe);
    g.cash = (g.cash || 0) - fromCash; owe -= fromCash; if (owe > 0) g.cityBank = (g.cityBank || 0) - owe;
    ownedSet()[rec.id] = true; rec.ownerId = "player";
    // a residence you buy also marks the engine's home record so the realtor &
    // the [H] safehouse stay consistent; first home auto-becomes your respawn.
    if (rec.category === "residence" && rec.lot.building && rec.lot.building.home) {
      rec.lot.building.home.owned = true;
      if (!g.cityHome) setAsHome(rec, true);
    }
    CBZ.city.addRespect(Math.max(1, Math.min(40, Math.round(rec.value / 8000))));
    const headline = (rec.business ? "🏢 Acquired " + rec.business.name : "🏠 Bought " + rec.name) + "!";
    flash("✅ " + headline, "ok"); CBZ.city.big(headline);
    if (CBZ.sfx) CBZ.sfx("coin");
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    refresh();
  }

  function sell(id) {
    const r = reg(); if (!r) return;
    const rec = r.byId[id]; if (!rec || !isOwned(rec)) return;
    const got = round500(rec.value * SELL_CUT);
    CBZ.city.addCash(got);
    delete ownedSet()[rec.id];
    rec.ownerId = rec.initialOwnerId;
    if (rec.lot.building && rec.lot.building.home) rec.lot.building.home.owned = false;
    if (isHome(rec)) { g.cityHome = null; g.citySpawnPoint = null; CBZ.city.note("Sold your home — no respawn point until you buy another.", 2.6); }
    flash("💸 Sold " + rec.name + " for " + money(got) + ".", "ok"); CBZ.city.big("SOLD " + rec.name + " — +" + money(got));
    if (CBZ.sfx) CBZ.sfx("coin");
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
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
    const r = reg(); if (!r) return { count: 0, value: 0 };
    let count = 0, value = 0;
    for (const rec of r.listings) if (isOwned(rec)) { count++; value += rec.value; }
    return { count, value };
  }

  // ---- passive rent / business income (owned, non-residence) ----------------
  let incomeT = INCOME_TICK;
  CBZ.onUpdate(38.6, function (dt) {
    if (g.mode !== "city") return;
    const r = reg(); if (!r) return;
    incomeT -= dt; if (incomeT > 0) return;
    incomeT = INCOME_TICK;
    let net = 0, n = 0;
    for (const rec of r.listings) {
      if (!isOwned(rec)) continue;
      // the home you live in pays no rent and is taxed by city/realestate.js
      if (isHome(rec)) continue;
      n++;
      net += (rec.rent || 0) - Math.round(rec.value * TAX_PER_TICK);
    }
    if (n === 0) return;
    if (net > 0) net = Math.round(net / (1 + PORTFOLIO_DRAG * n));   // empire-size diminishing returns
    if (net === 0) return;
    if (net > 0) { CBZ.city.addCash(net); CBZ.city.note("🏢 Portfolio income +" + money(net) + " (" + n + " propert" + (n === 1 ? "y" : "ies") + ")", 2); }
    else {
      // upkeep pulls cash THEN bank, matching buy() (you can't dodge it by banking)
      let owe = -net; const fromCash = Math.min(g.cash || 0, owe); g.cash = (g.cash || 0) - fromCash; owe -= fromCash;
      if (owe > 0) g.cityBank = Math.max(0, (g.cityBank || 0) - owe);
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
      CBZ.city.note("🏢 Property upkeep -" + money(-net), 1.8);
    }
    if (isOpen()) refresh();
  });

  // ---- reset per life --------------------------------------------------------
  CBZ.cityZillowReset = function () {
    g.cityRealtyOwned = {};
    incomeT = INCOME_TICK;
    const A = CBZ.city && CBZ.city.arena;
    if (A && A.realty) for (const rec of A.realty.listings) rec.ownerId = rec.initialOwnerId;
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
      else if (act === "sell") sell(id);
      else if (act === "home") setHome(id);
      else if (act === "close") close();
    });
    return panel;
  }
  function isOpen() { return open_; }

  function badge(rec) {
    const s = statusOf(rec);
    let cls = "zb-sale";
    if (s === "OWNED" || s === "YOUR HOME") cls = "zb-own";
    else if (s === "NOT FOR SALE") cls = "zb-illegal";
    return "<span class='zbadge " + cls + "'>" + s + "</span>";
  }
  function icon(rec) {
    if (rec.category === "land") return "🌳";
    if (rec.category === "residence") return "🏠";
    if (!rec.legal) return rec.kind === "abandoned" ? "🏚️" : "💊";
    return "🏪";
  }

  function card(rec) {
    const owner = ownerInfo(effOwnerId(rec));
    const sub = (rec.business ? KIND_LABEL[rec.kind] || "Business" : (rec.category === "land" ? "Vacant land" : (rec.beds ? rec.beds + "-bed home" : "Residence")))
      + " · " + rec.storeys + (rec.storeys === 1 ? " floor" : " floors") + " · " + rec.district;
    let actions = "";
    if (isOwned(rec)) {
      actions += "<button class='zbtn zbtn-sell' data-act='sell' data-id='" + rec.id + "'>Sell " + money(round500(rec.value * SELL_CUT)) + "</button>";
      if (rec.category === "residence" && homeObj(rec) && !isHome(rec)) actions += "<button class='zbtn zbtn-home' data-act='home' data-id='" + rec.id + "'>Set as home</button>";
    } else if (canBuy(rec)) {
      actions += "<button class='zbtn zbtn-buy' data-act='buy' data-id='" + rec.id + "'>Buy " + money(rec.value) + "</button>";
    } else {
      actions += "<span class='znope'>Off market</span>";
    }
    const rentLine = (rec.category !== "land" && rec.rent && rec.legal)
      ? "<span class='zrent'>~" + money(rec.rent) + "/cycle</span>" : "";
    return "<div class='zcard'>"
      + "<div class='zicon'>" + icon(rec) + "</div>"
      + "<div class='zmeta'>"
      + "<div class='zname'>" + (rec.business ? rec.business.name : rec.name) + " " + badge(rec) + "</div>"
      + "<div class='zaddr'>" + rec.address + "</div>"
      + "<div class='zsub'>" + sub + "</div>"
      + "<div class='zowner'>Owner: <b style='color:#" + ("000000" + owner.color.toString(16)).slice(-6) + "'>" + owner.name + "</b></div>"
      + "</div>"
      + "<div class='zright'>"
      + "<div class='zval'>" + money(rec.value) + "</div>"
      + rentLine
      + "<div class='zacts'>" + actions + "</div>"
      + "</div>"
      + "</div>";
  }

  function listFor(which) {
    const r = reg(); if (!r) return [];
    let arr = r.listings.slice();
    if (which === "sale") arr = arr.filter((x) => canBuy(x));
    else if (which === "owned") arr = arr.filter((x) => isOwned(x));
    else if (which === "illegal") arr = arr.filter((x) => !x.legal);
    // sort: for-sale cheapest first (a ladder), others priciest first
    arr.sort((a, b) => which === "sale" ? a.value - b.value : b.value - a.value);
    return arr;
  }

  function render() {
    const r = reg();
    const emp = playerEmpire();
    const ranks = rankings();
    const myRank = ranks.findIndex((x) => x.you) + 1;
    let html = "";
    // header
    html += "<div class='zhead'>"
      + "<div class='ztitle'>🏠 Zillow <span class='ztag'>City Property &amp; Business Market</span></div>"
      + "<button class='zx' data-act='close' data-id='x'>✕</button>"
      + "</div>";
    html += "<div class='zstats'>"
      + "<span>Cash <b>" + money(g.cash || 0) + "</b></span>"
      + "<span>Bank <b>" + money(g.cityBank || 0) + "</b></span>"
      + "<span>Your empire <b>" + money(emp.value) + "</b> (" + emp.count + ")</span>"
      + "<span>Rank <b>#" + (myRank || "—") + "</b> of " + ranks.length + "</span>"
      + "</div>";
    if (lastMsg) html += "<div class='zflash " + (lastTone === "bad" ? "zflash-bad" : "zflash-ok") + "'>" + lastMsg + "</div>";
    // tabs
    const tabs = [["sale", "For Sale"], ["owned", "Owned (" + emp.count + ")"], ["illegal", "Black Market"], ["ranks", "Empires"]];
    html += "<div class='ztabs'>";
    for (const [id, label] of tabs) html += "<button class='ztab" + (tab === id ? " on" : "") + "' data-act='tab' data-id='" + id + "'>" + label + "</button>";
    html += "</div>";

    html += "<div class='zlist'>";
    if (tab === "ranks") {
      html += "<div class='zhint'>Total property + business value held by each player. Buy more to climb.</div>";
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
      const arr = listFor(tab);
      if (tab === "illegal") html += "<div class='zhint'>Illegal operations can't be bought on the market — they're held by the crews. Listed so you can see who runs the streets.</div>";
      if (!arr.length) html += "<div class='zempty'>" + (tab === "owned" ? "You don't own anything yet. Hit the For Sale tab." : "Nothing here.") + "</div>";
      for (const rec of arr) html += card(rec);
    }
    html += "</div>";
    html += "<div class='zfoot'>[Z]/[Esc] close · [1-4] switch tabs · scroll to browse · prices pull from cash then bank</div>";
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
  CBZ.cityZillow = { open, close, buy, sell, setHome, rankings, playerEmpire, ownsLot: CBZ.cityOwnsLot, listings: () => reg() && reg().listings, isOpen };

  // ---- key: [Z] toggles the market -----------------------------------------
  addEventListener("keydown", function (e) {
    if (g.mode !== "city" || g.state !== "playing") return;
    const k = (e.key || "").toLowerCase();
    if (open_) {
      if (k === "escape" || k === "z") { e.preventDefault(); close(); return; }
      if (k >= "1" && k <= "4") { e.preventDefault(); tab = ["sale", "owned", "illegal", "ranks"][parseInt(k, 10) - 1]; render(); return; }
      return;
    }
    if (k === "z" && !e.repeat && !CBZ.cityMenuOpen && !(CBZ.player && CBZ.player.driving)) {
      e.preventDefault(); open();
    }
  });
})();
