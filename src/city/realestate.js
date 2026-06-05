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
  const RPAGE = 4;          // realtor home rows per page — keeps numeric keys ≤ 9 and one screen

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
    const homes = (CBZ.city.arena.homeLots || []).filter((l) => l.building.home && !l.building.home.owned
      && !(CBZ.cityZillow && CBZ.cityZillow.isRentingLot && CBZ.cityZillow.isRentingLot(l)));
    homes.sort((a, b) => a.building.home.price - b.building.home.price);

    // build the row "entries" first so we can paginate, THEN flatten the visible
    // page into the `actions[]` array the [1-9] keys index into.
    const entries = [];
    if (!g.cityRentTier && !g.cityHome) {
      const room = (C().homes || [])[0];
      if (room) entries.push({ html: "🛏️ Rent " + room.name + " — " + money(room.rent) + "/period", fns: [{ key: "rent room", fn: () => rentRoom() }] });
    }
    for (const lot of homes) {
      const h = lot.building.home;
      const tags = (h.garage ? " ·🚗×" + h.garage : "") + (h.elevator ? " ·🛗" : "");
      const fns = [{ key: "Buy " + money(h.price), fn: () => buyHome(lot) }];
      const rentPer = zillowRentEstimate(lot);
      if (rentPer != null) fns.push({ key: "Rent ~" + money(rentPer), fn: () => rentResidence(lot) });
      entries.push({ html: "🏠 " + h.name + tags + zoneChip(lot), fns });
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
    if (!g.cityHome) return null;
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
    let html = "<div style='font-size:20px;font-weight:700;margin-bottom:6px'>🏡 " + home.name + "</div>";
    html += "<div style='font-size:12px;color:#8a93a3;margin-bottom:10px'>Your home · safe " + money(g.cityBank || 0) + " · [Esc] leave</div>";
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
  function buyHome(lot) {
    const h = lot.building.home;
    const total = (g.cash || 0) + (g.cityBank || 0);
    if (total < h.price) { CBZ.city.note("Need " + money(h.price) + " (cash+bank).", 2); return; }
    // pull from cash first, then bank
    let owe = h.price; const fromCash = Math.min(g.cash || 0, owe); g.cash -= fromCash; owe -= fromCash; if (owe > 0) g.cityBank -= owe;
    h.owned = true; g.cityRentTier = null;
    if (g.cityHome) g.cityHome.lot.building.home.owned = false;     // moving up: release the old one
    g.cityHome = { lot, tier: h.tier, id: h.id, name: h.name };
    g.citySpawnPoint = { x: lot.building.door.x, z: lot.building.door.z };
    CBZ.city.big("🏠 You bought " + h.name + "!");
    CBZ.city.addRespect(Math.ceil(h.tier * 4));
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    CBZ.cityHomeMenuRefresh();
  }
  function sleepHeal() {
    const P = CBZ.player;
    P.hp = P.maxHp || 100; g.hunger = Math.min(100, (g.hunger || 0) + 40);
    g.citySpawnPoint = { x: g.cityHome.lot.building.door.x, z: g.cityHome.lot.building.door.z };
    if (CBZ.sfx) CBZ.sfx("coin");
    CBZ.city.note("Rested up. Respawn point set to home.", 2);
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
    const roofY = (home.floorY || 0) + (lot.building.FH || 4);
    P.pos.set(lot.cx + 1.4, roofY + 0.2, lot.cz);
    P.vy = 0; P.grounded = true;
    CBZ.playerChar.group.position.copy(P.pos);
    if (CBZ.sfx) CBZ.sfx("door");
    CBZ.city.note("🛗 Penthouse — top of the world.", 2);
    close();
  }

  function open(html) { el().innerHTML = html; panel.style.display = "block"; CBZ.cityMenuOpen = true; if (document.exitPointerLock) try { document.exitPointerLock(); } catch (e) {} }
  function close() { if (panel) panel.style.display = "none"; CBZ.cityMenuOpen = false; if (CBZ.requestLock && g.state === "playing") CBZ.requestLock(); }
  CBZ.cityCloseRealty = close;

  CBZ.cityRealEstateReset = function () {
    g.cityHome = null; g.cityRentTier = null; g.cityGarage = []; g.citySpawnPoint = null;
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
