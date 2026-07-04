/* ============================================================
   city/realestate.js — the property ladder. From a rented flophouse
   room up to a Skyline Penthouse with a private garage + elevator.

   Buy/rent at Keystone Realty (a shop service) or at a residence's door.
   An owned home is a SAFEHOUSE: heal & sleep, set it as your respawn
   point, a money-safe (your bank), a GARAGE that stores cars, and (the
   penthouse) an ELEVATOR up to the top floor. Rent (rented) and property
   tax (owned) are recurring money sinks.

   Exposes: cityHomeMenu (realtor), cityHomeNear, cityOpenHome,
   cityBuyHome, cityRentRoom, cityRealEstateReset.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const g = CBZ.game;
  const C = () => CBZ.CITY || {};

  let panel = null, mode = "buy", payT = 0, actions = [], rpage = 0;
  // realtor home rows per page. Each home row can now carry up to THREE actions
  // (Buy · Finance · Rent), so 3 rows keeps the numeric-key slots ≤ 9 and the
  // menu on one screen. (Was 4 when rows had at most Buy+Rent.)
  const RPAGE = 3;

  function el() {
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "cityRealty";
    panel.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:48;display:none;min-width:360px;max-width:480px;background:rgba(16,20,26,.96);border:2px solid #2f3a44;border-radius:16px;padding:14px 18px;color:#e8eef7;font-family:Fredoka,system-ui,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.5);pointer-events:auto";
    document.body.appendChild(panel);
    return panel;
  }
  function money(n) { n = Math.round(+n); if (!isFinite(n)) n = 0; return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(); }

  // district + controlling gang chip for a home lot (the gang-takeover tie):
  // green = your turf (cheaper at Zillow + earns more), red = a rival's.
  function zoneChip(lot) {
    const z = CBZ.cityZoneAt ? CBZ.cityZoneAt(lot.cx || 0, lot.cz || 0) : null;
    const nm = z ? z.name : "the city";
    const owner = z ? z.owner : null;
    const mine = (g.playerGang && g.playerGang.founded) ? g.playerGang.id : null;
    if (owner && (owner === mine || owner === "player")) return " <span style='color:#7ed957'>· " + nm + " (yours)</span>";
    if (owner) {
      const og = CBZ.cityGangById ? CBZ.cityGangById(owner) : null;
      return " <span style='color:#ff8a7a'>· " + nm + " (" + (og && og.name ? og.name : "rival") + ")</span>";
    }
    return " <span style='color:#8a93a3'>· " + nm + "</span>";
  }

  // ---- realtor: rent the room or buy any unowned residence ----
  // ONE-SCREEN: compact rows, paginated (the homeLots list can be long). Each
  // home shows its DISTRICT + controlling gang so you can buy in turf you hold
  // (cheaper at Zillow, earns more). Buy + Rent share a row to save height.
  CBZ.cityHomeMenu = function () {
    if (CBZ.cityCloseShop) CBZ.cityCloseShop();
    mode = "buy"; actions = [];
    const homes = (CBZ.city.arena.homeLots || []).filter((l) => l.building.home && l.building.home.listed
      && !l.building.home.owned
      && !(CBZ.cityZillow && CBZ.cityZillow.isRentingLot && CBZ.cityZillow.isRentingLot(l)));
    homes.sort((a, b) => a.building.home.tier - b.building.home.tier);

    // build the row "entries" first so we can paginate, THEN flatten the visible
    // page into the `actions[]` array the [1-9] keys index into.
    const entries = [];
    if (!g.cityRentTier && !g.cityHome) {
      const room = (C().homes || [])[0];
      if (room) entries.push({ html: "🛏️ Rent " + room.name + " — " + money(room.rent) + "/period", fns: [{ key: "rent room", fn: () => rentRoom() }] });
    }
    for (const lot of homes) {
      const h = lot.building.home;
      const tags = (h.sqft ? " ·" + h.sqft.toLocaleString() + "sqft" : "") + (h.garage ? " ·🚗×" + h.garage : "") + (h.elevator ? " ·🛗" : "");
      // show the LIVE Zillow price (market + your turf-control discount) so the
      // realtor and Zillow never disagree — buyHome charges this same number.
      const zp = (CBZ.cityZillow && CBZ.cityZillow.buyPriceForLot) ? CBZ.cityZillow.buyPriceForLot(lot) : null;
      const ask = (zp != null) ? zp : h.price;
      const fns = [{ key: "Buy " + money(ask), fn: () => buyHome(lot) }];
      // FINANCE option (contract [E]): only the cash-purchase used to be offered.
      // Pull the live financing quote from Zillow (down payment, and — when the
      // bank loan engine is wired — the real rate/payment + an approval flag). The
      // realtor and Zillow agree because both go through the same quote/transact
      // path. If the bank declines (quote.approved===false) we don't dangle a
      // dead button — we show why instead. Cash buy is always kept above.
      const fq = (CBZ.cityZillow && CBZ.cityZillow.financeQuoteForLot) ? CBZ.cityZillow.financeQuoteForLot(lot) : null;
      let finNote = "";
      if (fq) {
        if (fq.approved !== false) {
          const tail = (fq.viaBank && fq.payment > 0) ? " (" + money(Math.round(fq.payment)) + "/cycle)" : "";
          fns.push({ key: "Finance " + money(fq.down) + " down" + tail, fn: () => financeHome(lot) });
        } else {
          finNote = " <span style='color:#ff9e90;font-size:11px'>· no financing (" + (fq.reason || "declined") + ")</span>";
        }
      }
      const rentPer = zillowRentEstimate(lot);
      if (rentPer != null) fns.push({ key: "Rent ~" + money(rentPer), fn: () => rentResidence(lot) });
      entries.push({ html: "🏠 " + h.name + tags + zoneChip(lot) + finNote, fns });
    }

    const pages = Math.max(1, Math.ceil(entries.length / RPAGE));
    rpage = Math.max(0, Math.min(pages - 1, rpage));
    const slice = entries.slice(rpage * RPAGE, rpage * RPAGE + RPAGE);

    let html = "<div style='font-size:19px;font-weight:700;margin-bottom:4px'>🏠 Keystone Realty</div>";
    html += "<div style='font-size:12px;color:#8a93a3;margin-bottom:9px'>Cash " + money(g.cash) + " · Bank " + money(g.cityBank || 0) + (g.cityHome ? " · Home: " + g.cityHome.name : "") + "</div>";

    let n = 0;
    for (const ent of slice) {
      html += "<div style='padding:3px 0;font-size:13px;display:flex;justify-content:space-between;gap:10px;align-items:center'>"
        + "<span style='min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'>" + ent.html + "</span>"
        + "<span style='flex:0 0 auto'>";
      for (const f of ent.fns) {
        actions.push({ label: f.key, fn: f.fn });
        html += "<b style='color:#ffd166'>[" + actions.length + "]</b> <span style='color:#cfe0f5'>" + f.key + "</span>&nbsp;&nbsp;";
      }
      html += "</span></div>";
      n++;
    }
    if (!slice.length) html += "<div style='font-size:12px;color:#8a93a3;padding:8px 0'>No homes on the market right now.</div>";

    if (pages > 1) {
      // pager uses [ / ] (and arrow keys) so numeric slots stay item-only (≤9)
      html += "<div style='margin-top:8px;font-size:12px;color:#9fb0c6'>"
        + "[<b style='color:#ffd166'>&larr;</b>] Prev &nbsp; [<b style='color:#ffd166'>&rarr;</b>] Next &nbsp; · Page <b style='color:#ffd166'>" + (rpage + 1) + "</b>/" + pages + " (" + entries.length + " listings)</div>";
    }
    html += "<div style='font-size:11px;color:#6b7480;margin-top:8px'>[1–" + actions.length + "] select · [Esc] close · more at Zillow [Z]</div>";
    open(html);
    realtyPages = pages;
  };
  let realtyPages = 1;

  // ---- standing at your own home: the safehouse menu ----
  CBZ.cityHomeNear = function (x, z) {
    if (!g.cityHome || g.cityHome.lot.demolished) return null;    // rubble — no safehouse menu to open
    const lot = g.cityHome.lot, d = Math.hypot(x - lot.building.door.x, z - lot.building.door.z);
    return d < 4.5 ? lot : null;
  };
  CBZ.cityOpenHome = function () {
    if (!g.cityHome) return;
    mode = "home"; actions = [];
    const home = g.cityHome.lot.building.home;
    actions.push({ label: "Sleep & heal (set respawn here)", fn: sleepHeal });
    actions.push({ label: "Deposit all cash to home safe", fn: () => { if (CBZ.cityBankDeposit) CBZ.cityBankDeposit(); else { g.cityBank = (g.cityBank || 0) + (g.cash || 0); g.cash = 0; } CBZ.cityHomeMenuRefresh(); } });
    if (home.garage > 0) {
      actions.push({ label: "Store current car in garage", fn: storeCar });
      if ((g.cityGarage || []).length) actions.push({ label: "Pull a car from garage (" + g.cityGarage.length + "/" + home.garage + ")", fn: retrieveCar });
    }
    if (home.elevator) actions.push({ label: "Take the elevator to the penthouse", fn: elevatorUp });
    // ---- AIRBASE: the penthouse's rooftop helipad + deck hangar (the WHY behind
    // the apex price). The helicopter comes WITH the home (g.cityOwnsHeli); the
    // hangar (→ F-22) is a separate add-on offered here once you own the tower.
    const isPent = !!g.cityOwnsPenthouse || isPenthouse(home);
    if (isPent && g.cityOwnsHangar) {
      actions.push({ label: "🛩 Hangar — your F-22 is on the deck", fn: () => { CBZ.city.note("Your F-22 sits in the deck hangar — walk up and take it out, or call an airstrike from your phone. The chopper waits on the helipad. · F fly · LMB missiles", 3.2); } });
    } else if (isPent) {
      actions.push({ label: "🛩 Buy the rooftop Hangar — " + money(hangarPrice()) + " (a home for a stolen F-22)", fn: buyHangar });
    }
    let html = "<div style='font-size:20px;font-weight:700;margin-bottom:6px'>🏡 " + home.name + "</div>";
    html += "<div style='font-size:12px;color:#8a93a3;margin-bottom:10px'>Your home · safe " + money(g.cityBank || 0) + " · [Esc] leave</div>";
    if (g.cityOwnsHeli) html += "<div style='font-size:12px;color:#7ed957;margin-bottom:8px'>🚁 Helicopter ready on the pad" + (g.cityOwnsHangar ? " · 🛩 F-22 in the hangar" : "") + "</div>";
    actions.forEach((a, i) => { html += "<div style='padding:4px 0'><b style='color:#ffd166'>" + (i + 1) + "</b> " + a.label + "</div>"; });
    open(html);
  };
  CBZ.cityHomeMenuRefresh = function () { if (panel && panel.style.display === "block") { if (mode === "home") CBZ.cityOpenHome(); else CBZ.cityHomeMenu(); } };

  // delegate residence renting to Zillow (single source of lease truth)
  function zillowRentEstimate(lot) {
    return (CBZ.cityZillow && CBZ.cityZillow.rentEstimateForLot) ? CBZ.cityZillow.rentEstimateForLot(lot) : null;
  }
  function rentResidence(lot) {
    if (CBZ.cityZillow && CBZ.cityZillow.rentByLot) CBZ.cityZillow.rentByLot(lot);
    CBZ.cityHomeMenuRefresh();
  }

  function rentRoom() {
    const room = (C().homes || [])[0]; if (!room) return;
    if (!CBZ.city.spend(room.rent)) { CBZ.city.note("Can't afford the first " + money(room.rent) + ".", 1.8); return; }
    g.cityRentTier = 0;
    g.citySpawnPoint = { x: CBZ.city.arena.spawn.x, z: CBZ.city.arena.spawn.z };
    CBZ.city.note("Rented " + room.name + ". A roof over your head — and a respawn point.", 2.6);
    CBZ.cityHomeMenuRefresh();
  }
  // BUY a home at the realtor. We route through Zillow's buy path so there's ONE
  // source of truth: it registers the home in g.cityRealtyOwned, mirrors it to
  // the world ledger (persist), charges the live Zillow price (market + the gang-
  // control discount on your turf), and sets it as your home/respawn. Falls back
  // to a self-contained buy only if Zillow isn't loaded.
  // Is THIS home the flagship mega-tower penthouse? Match on the config id BLD
  // tags the tower with ("penthouse") so realtor + Zillow + buildings.js all
  // coordinate on one identifier. (flagship is the belt-and-suspenders fallback.)
  function isPenthouse(home) { return !!home && (home.id === "penthouse" || home.flagship === true); }
  // Buying the penthouse arms your airpower: the MISSILE HELICOPTER comes parked
  // on its rooftop helipad (free with the home — Phase 3 spawns it there). The
  // HANGAR (→ F-22) is a SEPARATE add-on bought later (see buyHangar). Guarded so
  // a non-penthouse buy never trips these globals; safe to call after any buy.
  // NOTE: zillow.js's takeResidence already arms the penthouse (the single
  // buy/finance chokepoint, so the [Z] market and the realtor agree). This is the
  // belt-and-suspenders for the Zillow-unavailable fallback buy below; it's
  // idempotent (only fires the banner once) so the realtor route doesn't double it.
  function armPenthouse(lot) {
    const h = lot && lot.building && lot.building.home;
    if (!isPenthouse(h)) return;
    if (g.cityOwnsPenthouse && g.cityOwnsHeli) return;   // already armed (Zillow path) — don't re-banner
    g.cityOwnsPenthouse = true;
    g.cityOwnsHeli = true;          // the chopper comes with the penthouse
    CBZ.city.big("🚁 The missile helicopter is yours — parked on the pad.");
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  function buyHome(lot) {
    const h = lot.building.home;
    if (CBZ.cityZillow && CBZ.cityZillow.buyByLot) {
      const price = (CBZ.cityZillow.buyPriceForLot && CBZ.cityZillow.buyPriceForLot(lot));
      const ask = (price != null) ? price : h.price;
      if (((g.cash || 0) + (g.cityBank || 0)) < ask) { CBZ.city.note("Need " + money(ask) + " (cash+bank).", 2); return; }
      const bought = CBZ.cityZillow.buyByLot(lot);   // charges, persists, registers, sets home via takeResidence
      if (bought) {
        // ensure this is the active home/respawn even if the player already had one
        if (CBZ.cityZillow.setHomeByLot) CBZ.cityZillow.setHomeByLot(lot);
        armPenthouse(lot);                            // penthouse → helicopter + flags
        if (CBZ.cityHudDirty) CBZ.cityHudDirty();
        CBZ.cityHomeMenuRefresh();
      }
      return;
    }
    // ---- fallback (Zillow unavailable) — keep the legacy self-contained buy ----
    const total = (g.cash || 0) + (g.cityBank || 0);
    if (total < h.price) { CBZ.city.note("Need " + money(h.price) + " (cash+bank).", 2); return; }
    let owe = h.price; const fromCash = Math.min(g.cash || 0, owe); g.cash -= fromCash; owe -= fromCash; if (owe > 0) g.cityBank -= owe;
    h.owned = true; g.cityRentTier = null;
    if (g.cityHome) g.cityHome.lot.building.home.owned = false;     // moving up: release the old one
    g.cityHome = { lot, tier: h.tier, id: h.id, name: h.name };
    g.citySpawnPoint = { x: lot.building.door.x, z: lot.building.door.z };
    CBZ.city.big("🏠 You bought " + h.name + "!");
    CBZ.city.addRespect(Math.ceil(h.tier * 4));
    armPenthouse(lot);                                // penthouse → helicopter + flags
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    CBZ.cityHomeMenuRefresh();
  }
  // FINANCE a home at the realtor (contract [E]). Routes through Zillow's
  // financeByLot so there's ONE financing path: 20% down from cash+bank, the rest
  // via the bank loan ENGINE (CBZ.cityBankLoan) when wired, else Zillow's
  // self-contained mortgage. Zillow handles charging the down, registering the
  // home, persisting, and setting it as home (takeResidence) — exactly like the
  // cash buy, so the realtor and [Z] panel agree. If financing isn't possible
  // (no Zillow market at all) we honestly fall back to the cash buy.
  function financeHome(lot) {
    const h = lot.building.home;
    if (CBZ.cityZillow && CBZ.cityZillow.financeByLot) {
      const owned = CBZ.cityZillow.financeByLot(lot);   // charges down, registers, sets home, opens the loan
      if (owned) {
        if (CBZ.cityZillow.setHomeByLot) CBZ.cityZillow.setHomeByLot(lot);
        armPenthouse(lot);                              // penthouse → helicopter + flags
        if (CBZ.cityHudDirty) CBZ.cityHudDirty();
      }
      CBZ.cityHomeMenuRefresh();
      return;
    }
    // No Zillow market loaded → no mortgage system to finance against; do the
    // honest thing and route to the cash buy (which has its own fallback).
    buyHome(lot);
  }
  // ---- TASK 2: the HANGAR — a big-ticket add-on, offered only once you own the
  // penthouse. Buying it sets g.cityOwnsHangar=true, which unlocks basing an F-22
  // Raptor in the deck hangar (Phase 3 reads g.cityOwnsHangar). Charged from cash
  // + bank like a home; price comes from the penthouse tier's hangarPrice.
  function hangarPrice() {
    const home = g.cityHome && g.cityHome.lot.building.home;
    return (home && home.hangarPrice) || (((C().homes || []).find((x) => x.id === "penthouse") || {}).hangarPrice) || 1200000;
  }
  function buyHangar() {
    if (!g.cityOwnsPenthouse) { CBZ.city.note("Buy the penthouse first — the hangar is its deck.", 2.2); return; }
    if (g.cityOwnsHangar) { CBZ.city.note("You already own the hangar.", 1.8); return; }
    const cost = hangarPrice();
    const total = (g.cash || 0) + (g.cityBank || 0);
    if (total < cost) { CBZ.city.note("Need " + money(cost) + " (cash+bank) for the hangar.", 2.4); return; }
    let owe = cost; const fromCash = Math.min(g.cash || 0, owe); g.cash -= fromCash; owe -= fromCash; if (owe > 0) g.cityBank = (g.cityBank || 0) - owe;
    g.cityOwnsHangar = true;
    CBZ.city.big("🛩 HANGAR ACQUIRED — now STEAL an F-22 and land it here to keep it.");
    CBZ.city.addRespect(40);
    if (CBZ.sfx) CBZ.sfx("coin");
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    CBZ.cityHomeMenuRefresh();
  }
  // WHY a house matters #1 — RECOVER + LAY LOW. Minecraft's bed skips the night
  // and sets spawn; GTA's safehouse heals you and lets the heat die down. Sleeping
  // in YOUR home does all of it at once: full heal, fed, rested, wounds dressed,
  // AND the cops lose your trail (heat bleeds way down). That's the reason a roof
  // over your head is worth more than the cash — it's the only place you can
  // truly reset. The catch: you can't sleep with cops actively on you (5★ raid),
  // so it rewards getting clear FIRST, then holing up.
  function sleepHeal() {
    const P = CBZ.player;
    const stars = g.wanted | 0;
    P.hp = P.maxHp || 100;
    P.stamina = P.maxStamina || 100;
    g.hunger = 100;
    g.tired = 0;
    P._legWound = false; P._bleeding = false; P._bleedT = 0;      // wounds dressed overnight
    g.citySpawnPoint = { x: g.cityHome.lot.building.door.x, z: g.cityHome.lot.building.door.z };
    // LAY LOW: heat bleeds hard while you're off the streets. A light record
    // (≤2★) goes fully cold; a serious one drops a couple stars but the manhunt
    // doesn't just evaporate — you still surface hot.
    let laid = "";
    if (CBZ.city && CBZ.city.addHeat && (g.heat || 0) > 0) {
      const before = g.heat || 0;
      const cut = stars <= 2 ? before : Math.max(before - (CBZ.CITY.starHeat[Math.max(0, stars - 2)] || 0), before * 0.45);
      CBZ.city.addHeat(-cut);
      const after = g.heat || 0;
      laid = (g.wanted | 0) < stars ? " Heat cooled — you slipped the manhunt." : (after < before ? " Heat dropped while you laid low." : "");
    }
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    if (CBZ.sfx) CBZ.sfx("coin");
    CBZ.city.note("😴 Slept it off — full health, fed, rested, patched up." + laid + " Respawn set to home.", 3.2);
    close();
  }
  function storeCar() {
    const P = CBZ.player, home = g.cityHome.lot.building.home;
    if (!P.driving || !P._vehicle) { CBZ.city.note("Drive a car home to store it.", 1.8); return; }
    g.cityGarage = g.cityGarage || [];
    if (g.cityGarage.length >= home.garage) { CBZ.city.note("Garage is full.", 1.6); return; }
    const car = P._vehicle;
    g.cityGarage.push(car.model ? car.model.name : "Sedan");
    if (CBZ.cityExitVehicle) CBZ.cityExitVehicle();
    if (car.group && car.group.parent) car.group.parent.remove(car.group);
    const idx = CBZ.cityCars.indexOf(car); if (idx >= 0) CBZ.cityCars.splice(idx, 1);
    CBZ.city.note("Stored your car in the garage.", 1.8);
    CBZ.cityHomeMenuRefresh();
  }
  function retrieveCar() {
    g.cityGarage = g.cityGarage || [];
    if (!g.cityGarage.length) return;
    const model = g.cityGarage.pop();
    const lot = g.cityHome.lot, gz = lot.building.garage || { x: lot.building.door.x, z: lot.building.door.z };
    if (CBZ.citySpawnOwnedCar) CBZ.citySpawnOwnedCar(gz.x, gz.z, model);
    CBZ.city.note("Your " + model + " is out front.", 2);
    close();
  }
  function elevatorUp() {
    const lot = g.cityHome.lot, home = lot.building.home;
    const P = CBZ.player;
    // The Spire's living space is the LOFT — the top interior floor — so the
    // elevator lands you ON that floor, centred in the open plan. Older homes
    // (penthouse roof) keep going one flight up onto the open roof terrace.
    if (home.loftY != null) {
      P.pos.set(lot.cx, home.loftY + 0.1, lot.cz);
    } else {
      const roofY = (home.floorY || 0) + (lot.building.FH || 4);
      P.pos.set(lot.cx + 1.4, roofY + 0.2, lot.cz);
    }
    P.vy = 0; P.grounded = true;
    CBZ.playerChar.group.position.copy(P.pos);
    if (CBZ.sfx) CBZ.sfx("door");
    CBZ.city.note(home.loftY != null ? "🛗 The Spire loft — top of the world." : "🛗 Penthouse — top of the world.", 2);
    close();
  }

  function open(html) { el().innerHTML = html; panel.style.display = "block"; CBZ.cityMenuOpen = true; if (document.exitPointerLock) try { document.exitPointerLock(); } catch (e) {} }
  function close() { if (panel) panel.style.display = "none"; CBZ.cityMenuOpen = false; if (CBZ.requestLock && g.state === "playing") CBZ.requestLock(); }
  CBZ.cityCloseRealty = close;

  CBZ.cityRealEstateReset = function () {
    g.cityHome = null; g.cityRentTier = null; g.cityGarage = []; g.citySpawnPoint = null;
    // apex-home airpower (penthouse helicopter + bought hangar) resets per run
    g.cityOwnsPenthouse = false; g.cityOwnsHeli = false; g.cityOwnsHangar = false;
    payT = (C().rentTick || 90); rpage = 0;
    const A = CBZ.city && CBZ.city.arena;
    if (A && A.homeLots) for (const l of A.homeLots) if (l.building.home) l.building.home.owned = false;
    if (panel) panel.style.display = "none";
  };

  addEventListener("keydown", function (e) {
    if (g.mode !== "city" || g.state !== "playing") return;
    if (panel && panel.style.display === "block") {
      const k = e.key.toLowerCase();
      if (k === "escape") { e.preventDefault(); close(); return; }
      // page the realtor list (only when it's the buy menu and has >1 page)
      if (mode === "buy" && realtyPages > 1 && (k === "arrowleft" || k === "[" || k === "arrowright" || k === "]")) {
        e.preventDefault();
        rpage = (k === "arrowleft" || k === "[") ? (rpage - 1 + realtyPages) % realtyPages : (rpage + 1) % realtyPages;
        CBZ.cityHomeMenu();
        return;
      }
      if (k >= "1" && k <= "9") { e.preventDefault(); const a = actions[parseInt(k, 10) - 1]; if (a) a.fn(); }
      return;
    }
    // [H] at your own front door opens the safehouse menu
    if (e.key.toLowerCase() === "h" && !CBZ.cityMenuOpen) {
      const lot = CBZ.cityHomeNear(CBZ.player.pos.x, CBZ.player.pos.z);
      if (lot) { e.preventDefault(); CBZ.cityOpenHome(); }
    }
  });

  // ---- property-empire economy tick (Zillow owns the portfolio data) -------
  // We run the single rent/income/mortgage tick HERE (careers.js owns the wage
  // pay-tick and is off-limits). zillow.js exposes CBZ.cityZillowTick(dt) which
  // revalues listings with the market, pays rent-out income, charges property
  // tax + mortgage payments, and collects the rent the player owes (evicting on
  // a miss). Keeping it on the engine clock means it runs even with the panel
  // closed, so an empire earns / bleeds whether or not you're looking at it.
  CBZ.onUpdate(38.4, function (dt) {
    if (g.mode !== "city") return;
    if (CBZ.cityZillowTick) CBZ.cityZillowTick(dt);
  });

  // ---- legacy FLOPHOUSE-room rent sink (the cheap C().homes[0] starter room) -
  // NOTE: owned-home PROPERTY TAX is charged by the Zillow tick (38.4) on every
  // owned unit including your residence — we must NOT tax g.cityHome again here
  // or you'd pay double. This tick only collects rent on the legacy rented room
  // (g.cityRentTier), which Zillow's lease system doesn't manage.
  CBZ.onUpdate(38.5, function (dt) {
    if (g.mode !== "city") return;
    payT -= dt;
    if (payT > 0) return;
    payT = C().rentTick || 90;
    if (g.cityRentTier != null) {
      const room = (C().homes || [])[g.cityRentTier];
      if (room && room.rent) {
        if (CBZ.city.spend(room.rent)) CBZ.city.note("🏠 Rent due: -" + money(room.rent), 2);
        else { g.cityRentTier = null; g.citySpawnPoint = null; CBZ.city.note("Evicted — couldn't make rent.", 2.4); }
      }
    }
  });
})();
