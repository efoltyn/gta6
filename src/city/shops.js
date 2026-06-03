/* ============================================================
   city/shops.js — the storefront overlay: buy stock, sell/fence your
   loot, and use per-shop services (eat, heal, bank, jobs, buy a car).

   Opened by city/interact.js when you walk up to a vendor counter and
   press E. While it's up, CBZ.cityMenuOpen blocks shooting. Number keys
   buy the listed items; the lettered actions run services.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const g = CBZ.game;

  let panel = null, openLot = null, listItems = [];

  function el() {
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "cityShop";
    panel.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:48;display:none;min-width:320px;max-width:440px;background:rgba(16,18,24,.94);border:2px solid #2c3140;border-radius:16px;padding:16px 18px;color:#e8eef7;font-family:Fredoka,system-ui,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.5);pointer-events:auto";
    document.body.appendChild(panel);
    return panel;
  }

  function fmt$(n) { return "$" + (n | 0); }

  function render() {
    const econ = CBZ.cityEcon, lot = openLot; if (!lot) return;
    const kind = lot.kind, name = lot.building.name;
    const stock = econ.stockFor(kind);
    listItems = stock.slice(0, 9);
    let html = "<div style='font-size:20px;font-weight:700;margin-bottom:2px'>" + name + "</div>";
    html += "<div style='font-size:12px;color:#8a93a3;margin-bottom:10px'>Cash " + fmt$(g.cash) + " · [Esc]/[E] leave</div>";
    if (listItems.length) {
      html += "<div style='font-size:12px;color:#9fb0c6;margin:4px 0'>BUY</div>";
      listItems.forEach((it, i) => {
        const price = econ.buyPrice(it);
        const meta = econ.ITEMS[it];
        const tagN = kind === "food" ? "eat" : (meta.gun ? "gun" : meta.tag);
        html += "<div style='display:flex;justify-content:space-between;padding:3px 0'><span><b style='color:#ffd166'>" + (i + 1) + "</b> " + it + " <span style='color:#7f8794;font-size:11px'>(" + tagN + ")</span></span><span style='color:#7ed957'>" + fmt$(price) + "</span></div>";
      });
    }
    // services
    const svc = services(kind);
    if (svc.length) {
      html += "<div style='font-size:12px;color:#9fb0c6;margin:8px 0 2px'>SERVICES</div>";
      svc.forEach((s) => { html += "<div style='padding:2px 0'><b style='color:#7fd0ff'>" + s.key.toUpperCase() + "</b> " + s.label + "</div>"; });
    }
    // sellables you hold
    const sell = sellable(kind);
    if (sell.length) {
      html += "<div style='font-size:12px;color:#9fb0c6;margin:8px 0 2px'>SELL — press <b style='color:#ff9e6b'>0</b> to sell all (" + fmt$(sellTotal(kind)) + ")</div>";
      html += "<div style='font-size:12px;color:#aeb8c6'>" + sell.map((s) => s.name + " ×" + s.n).join(", ") + "</div>";
    }
    el().innerHTML = html;
  }

  function services(kind) {
    const s = [];
    if (kind === "hospital") s.push({ key: "h", label: "Heal to full — $200", fn: healFull });
    if (kind === "bank") { s.push({ key: "d", label: "Deposit all cash (safe on death)", fn: deposit }); s.push({ key: "w", label: "Withdraw $500", fn: withdraw }); }
    if (kind === "gas" && CBZ.player.driving) s.push({ key: "r", label: "Refuel car", fn: () => CBZ.city.note("Tank filled.", 1.2) });
    if (kind === "gym") s.push({ key: "t", label: "Train — +10 max HP ($100)", fn: train });
    if (kind === "carlot") s.push({ key: "c", label: "Buy a car — $1,500", fn: buyCar });
    if (kind === "carlot") s.push({ key: "y", label: (g.cityCarBiz && g.cityCarBiz.open) ? "Manage your car-resale yard" : "Open a car-resale yard — $2,000 (free if you own this lot)", fn: () => CBZ.cityOpenCarBiz && CBZ.cityOpenCarBiz() });
    if (kind === "realtor") s.push({ key: "h", label: "Browse homes — rent or buy", fn: () => CBZ.cityHomeMenu && CBZ.cityHomeMenu() });
    if (kind === "chop") s.push({ key: "c", label: "Sell a car — drive it into the bay out front", fn: () => CBZ.city.note("Drive a (stolen) car into the chop bay out front to cash it out.", 2.4) });
    if (kind === "bank") s.push({ key: "p", label: "Pay off the cops — bribe down 1 star", fn: bribe });
    if (kind === "security") s.push({ key: "j", label: "Apply: Security Guard job", fn: () => CBZ.cityStartCareer && CBZ.cityStartCareer("security") });
    if (kind === "drugs") s.push({ key: "j", label: "Become a dealer (street sales)", fn: () => CBZ.cityStartCareer && CBZ.cityStartCareer("dealer") });
    if (kind === "bar") s.push({ key: "j", label: "Run the night crew (pimp/entrepreneur)", fn: () => CBZ.cityStartCareer && CBZ.cityStartCareer("pimp") });
    if (kind === "casino") s.push({ key: "g", label: "Casino, sportsbook, fight and race betting", fn: () => CBZ.cityOpenActivities && CBZ.cityOpenActivities("Betting") });
    if (kind === "raceway") s.push({ key: "r", label: "Racing board: legal, street, drag", fn: () => CBZ.cityOpenActivities && CBZ.cityOpenActivities("Racing") });
    if (kind === "racepark") s.push({ key: "r", label: "Horse and greyhound betting", fn: () => CBZ.cityOpenActivities && CBZ.cityOpenActivities("Racing") });
    if (kind === "arena" || kind === "gym") s.push({ key: "f", label: "Fight card: boxing and MMA", fn: () => CBZ.cityOpenActivities && CBZ.cityOpenActivities("Combat") });
    if (kind === "paintball") s.push({ key: "p", label: "Paintball match board", fn: () => CBZ.cityOpenActivities && CBZ.cityOpenActivities("Combat") });
    if (kind === "transit") s.push({ key: "t", label: "Bus and train routes", fn: () => CBZ.cityOpenActivities && CBZ.cityOpenActivities("Transit") });
    if (kind === "cityhall") s.push({ key: "p", label: "Politics, permits, civic contracts", fn: () => CBZ.cityOpenActivities && CBZ.cityOpenActivities("Civic") });
    if (kind === "airfield") s.push({ key: "w", label: "War, air support and emergency contracts", fn: () => CBZ.cityOpenActivities && CBZ.cityOpenActivities("Emergency") });
    // every shop offers the job board if careers exist
    if (CBZ.cityJobBoard) s.push({ key: "b", label: "Job board (hustles for cash)", fn: () => CBZ.cityJobBoard() });
    return s;
  }

  function sellable(kind) {
    const inv = g.cityInv || {}, econ = CBZ.cityEcon, out = [];
    for (const k in inv) {
      const it = econ.ITEMS[k]; if (!it) continue;
      // pawn buys anything; jewelry buys wearables; others buy their own tags
      const ok = kind === "pawn" || (kind === "jewelry" && it.tag === "wearable") ||
        (kind === "electronics" && it.tag === "valuable") || it.tag === "valuable";
      if (ok) out.push({ name: k, n: inv[k] });
    }
    return out;
  }
  function sellTotal(kind) { let t = 0; for (const s of sellable(kind)) t += CBZ.cityEcon.sellPrice(s.name, kind) * s.n; return t; }
  function sellAll(kind) {
    const econ = CBZ.cityEcon; let got = 0;
    for (const s of sellable(kind)) { const p = econ.sellPrice(s.name, kind); got += p * s.n; econ.take(s.name, s.n); }
    if (got > 0) { CBZ.city.addCash(got); if (CBZ.sfx) CBZ.sfx("coin"); CBZ.city.note("Sold everything for " + fmt$(got), 1.8); }
    else CBZ.city.note("Nothing to sell here.", 1.4);
    render();
  }

  function buy(i) {
    const it = listItems[i]; if (!it) return;
    const econ = CBZ.cityEcon, price = econ.buyPrice(it), meta = econ.ITEMS[it];
    if (!CBZ.city.spend(price)) { CBZ.city.note("Can't afford " + it + " (" + fmt$(price) + ")", 1.6); if (CBZ.sfx) CBZ.sfx("empty"); return; }
    if (CBZ.sfx) CBZ.sfx("coin");
    if (openLot.kind === "food" && meta.heal) { g.hunger = Math.min(100, (g.hunger || 0) + meta.heal); if (meta.boost) CBZ.player._boost = 12; CBZ.city.note("Ate " + it + " (+" + meta.heal + " food)", 1.6); }
    else if (meta.gun || meta.melee) { econ.add(it, 1); CBZ.cityGiveWeapon(it); }
    else if (meta.rounds) { CBZ.cityAddAmmo(meta.rounds); }
    else if (meta.armor) { CBZ.player._armor = (CBZ.player._armor || 0) + meta.armor; CBZ.city.note("Body Armor on (+" + meta.armor + ")", 1.6); }
    else { econ.add(it, 1); if (meta.drip) CBZ.city.addRespect(meta.drip); CBZ.city.note("Bought " + it, 1.4); }
    render();
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  // ---- services impl ----
  function healFull() { if (CBZ.city.spend(200)) { CBZ.player.hp = 100; CBZ.player._armor = Math.max(CBZ.player._armor || 0, 0); CBZ.city.note("Healed to full.", 1.4); if (CBZ.sfx) CBZ.sfx("coin"); render(); } else CBZ.city.note("Need $200.", 1.4); }
  function deposit() { const c = g.cash || 0; if (c <= 0) return; g.cityBank = (g.cityBank || 0) + c; g.cash = 0; CBZ.city.note("Deposited " + fmt$(c) + " (bank: " + fmt$(g.cityBank) + ")", 2); if (CBZ.cityHudDirty) CBZ.cityHudDirty(); render(); }
  function withdraw() { const amt = Math.min(500, g.cityBank || 0); if (amt <= 0) { CBZ.city.note("Bank empty.", 1.2); return; } g.cityBank -= amt; CBZ.city.addCash(amt); CBZ.city.note("Withdrew " + fmt$(amt), 1.6); render(); }
  function bribe() {
    const stars = g.wanted | 0;
    if (stars <= 0) { CBZ.city.note("You're clean — nothing to pay off.", 1.4); return; }
    const cost = ((CBZ.CITY.econ && CBZ.CITY.econ.bribeBase) || 150) * stars;
    if (!CBZ.city.spend(cost)) { CBZ.city.note("A bribe costs " + fmt$(cost) + " right now.", 1.8); return; }
    const T = CBZ.CITY.starHeat; g.heat = Math.max(0, T[Math.max(0, stars - 1)] - 1);
    if (CBZ.city.addHeat) CBZ.city.addHeat(0);
    CBZ.city.note("💰 Paid off the cops — down to " + (stars - 1) + "★ (" + fmt$(cost) + ")", 2.2);
    if (CBZ.sfx) CBZ.sfx("coin"); render();
  }
  function train() { if (CBZ.city.spend(100)) { CBZ.player.maxHp = (CBZ.player.maxHp || 100) + 10; CBZ.player.hp = CBZ.player.maxHp; CBZ.city.addRespect(1); CBZ.city.note("Trained — max HP " + CBZ.player.maxHp, 1.8); render(); } }
  function buyCar() {
    if (!CBZ.city.spend(1500)) { CBZ.city.note("Need $1,500 for a car.", 1.6); return; }
    const A = CBZ.city.arena, door = openLot.building.door;
    if (CBZ.citySpawnOwnedCar) CBZ.citySpawnOwnedCar(door.x + door.nx * 3, door.z + door.nz * 3);
    CBZ.city.note("Your new ride is parked out front!", 2.2);
    close();
  }

  // ---- open / close + input ----
  function open(lot) {
    openLot = lot; CBZ.cityMenuOpen = true;
    el().style.display = "block";
    render();
    if (document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
  }
  function close() {
    openLot = null; CBZ.cityMenuOpen = false;
    if (panel) panel.style.display = "none";
    if (CBZ.requestLock && g.state === "playing") CBZ.requestLock();
  }
  CBZ.cityOpenShop = open;
  CBZ.cityShopOpen = function () { return !!openLot; };
  CBZ.cityCloseShop = close;

  addEventListener("keydown", function (e) {
    if (!openLot) return;
    const k = e.key.toLowerCase();
    if (k === "escape" || k === "e") { e.preventDefault(); close(); return; }
    if (k >= "1" && k <= "9") { e.preventDefault(); buy(parseInt(k, 10) - 1); return; }
    if (k === "0") { e.preventDefault(); sellAll(openLot.kind); return; }
    const svc = services(openLot.kind).find((s) => s.key === k);
    if (svc) { e.preventDefault(); svc.fn(); }
  });
})();
