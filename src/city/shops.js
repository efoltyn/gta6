/* ============================================================
   city/shops.js — the storefront overlay: buy stock, sell/fence your
   loot, and use per-shop services (eat, heal, bank, jobs, buy a car).

   Opened by city/interact.js when you walk up to a vendor counter and
   press E. While it's up, CBZ.cityMenuOpen blocks shooting. Number keys
   buy the listed items; the lettered actions run services.

   DEEPER SHOPPING (GTA-style): clothing/jewelry you can actually WEAR
   (drip → respect + a "look" you carry), barbers that restyle you, food
   that heals, hardware tools, BULK buys with a quantity discount,
   one-shot HAGGLING per visit, and ROBBING THE TILL for risk/reward.
   Researched against GTA V clothing stores, barbers, tattoo parlors, and
   GTA Online store-robbery / intimidation mechanics.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const g = CBZ.game;

  let panel = null, openLot = null, listItems = [];
  // per-visit transient state (reset every time a shop opens)
  let qty = 1;                 // buy multiplier (1 / 5 / 10), toggled with [Q]... wait, Q is taken
  let haggle = 0;             // -% discount earned this visit (0..maxHaggle), one attempt
  let haggleTried = false;    // only one haggle attempt per visit

  // ---- the WARDROBE: wearables you've equipped (worn flex) + your style ----
  // We DON'T double-count respect: buying a wearable adds it to inventory and,
  // for jewelry/clothing kinds, auto-equips it (drip applied ONCE on equip).
  function worn() { g.cityWorn = g.cityWorn || {}; return g.cityWorn; }
  function isWorn(name) { return !!worn()[name]; }
  function look() {
    g.cityLook = g.cityLook || { hair: "Default", outfit: "Streetwear", swagger: 0 };
    return g.cityLook;
  }
  // total drip from everything you're WEARING (jewelry + outfit + style)
  function wornDrip() {
    let s = 0; const w = worn(), it = CBZ.cityEcon.ITEMS;
    for (const k in w) { if (w[k] && it[k] && it[k].drip) s += it[k].drip; }
    s += (look().swagger || 0);
    return s;
  }
  CBZ.cityWornDrip = wornDrip;
  CBZ.cityLook = look;

  // BARBER haircuts & CLOTHING outfits — pure-cosmetic-ish style that nudges
  // your street swagger (a small standing respect bonus while you keep it).
  const HAIRCUTS = [
    { name: "Fresh Fade", cost: 35, swag: 2 },
    { name: "Cornrows", cost: 45, swag: 3 },
    { name: "Buzz Cut", cost: 25, swag: 1 },
    { name: "Slick Back", cost: 55, swag: 3 },
    { name: "Dreads", cost: 70, swag: 4 },
    { name: "Mohawk", cost: 60, swag: 4 },
    { name: "Clean Shave + Lineup", cost: 30, swag: 2 },
  ];
  const OUTFITS = [
    { name: "Tracksuit", cost: 180, swag: 3 },
    { name: "Tailored Suit", cost: 900, swag: 8 },
    { name: "Designer Drip", cost: 1400, swag: 12 },
    { name: "Goon Hoodie", cost: 120, swag: 2 },
    { name: "Leather Jacket", cost: 520, swag: 6 },
    { name: "All Black Tactical", cost: 700, swag: 7 },
  ];

  function el() {
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "cityShop";
    panel.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:48;display:none;min-width:340px;max-width:460px;background:rgba(16,18,24,.94);border:2px solid #2c3140;border-radius:16px;padding:16px 18px;color:#e8eef7;font-family:Fredoka,system-ui,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.5);pointer-events:auto;max-height:88vh;overflow-y:auto";
    document.body.appendChild(panel);
    return panel;
  }

  function fmt$(n) { return "$" + (n | 0); }

  // the per-shop discount that actually lands on a price: haggle + bulk +
  // a small loyalty cut if you're a baller (the rich get treated better).
  function shopDiscount(n) {
    n = n || 1;
    let d = haggle;                                 // 0..0.18 earned by haggling
    if (n >= 10) d += 0.10; else if (n >= 5) d += 0.05;   // bulk
    const nw = CBZ.cityEcon.netWorth ? CBZ.cityEcon.netWorth() : (g.cash || 0);
    if (nw > 150000) d += 0.03;                     // VIP/loyalty
    return Math.min(0.35, d);
  }
  // final unit price for an item at this counter, after discounts
  function unitPrice(it, n) {
    const base = CBZ.cityEcon.buyPrice(it);
    return Math.max(1, Math.round(base * (1 - shopDiscount(n))));
  }

  function render() {
    const econ = CBZ.cityEcon, lot = openLot; if (!lot) return;
    const kind = lot.kind, name = lot.building.name;
    const stock = econ.stockFor(kind);
    listItems = stock.slice(0, 9);
    let html = "<div style='font-size:20px;font-weight:700;margin-bottom:2px'>" + name + "</div>";
    const disc = shopDiscount(qty);
    html += "<div style='font-size:12px;color:#8a93a3;margin-bottom:6px'>Cash " + fmt$(g.cash) + " · " +
      (g.cityBank ? "Bank " + fmt$(g.cityBank) + " · " : "") +
      "Drip <span style='color:#ffd166'>" + (wornDrip() | 0) + "</span> · [Esc]/[E] leave</div>";

    // BUY CONTROLS: bulk multiplier + haggle (only show where there's stock)
    if (listItems.length) {
      html += "<div style='font-size:11px;color:#7f8794;margin-bottom:6px;display:flex;gap:10px;flex-wrap:wrap'>" +
        "<span><b style='color:#7fd0ff'>[X]</b> qty ×" + qty + "</span>" +
        (haggleTried ? "<span style='color:#9fb0c6'>[V] haggled" + (haggle > 0 ? " −" + Math.round(haggle * 100) + "%" : " (no luck)") + "</span>"
          : "<span><b style='color:#7fd0ff'>[V]</b> haggle</span>") +
        (disc > 0 ? "<span style='color:#7ed957'>deal −" + Math.round(disc * 100) + "%</span>" : "") +
        "</div>";
      html += "<div style='font-size:12px;color:#9fb0c6;margin:4px 0'>BUY</div>";
      listItems.forEach((it, i) => {
        const each = unitPrice(it, qty);
        const meta = econ.ITEMS[it];
        const tagN = kind === "food" ? "+" + (meta.heal || 0) + "hp"
          : (meta.gun ? "gun" : (meta.tag === "wearable" ? "+" + (meta.drip || 0) + " drip" : meta.tag));
        const owned = (kind === "jewelry" || kind === "clothing") && isWorn(it);
        const line = qty > 1 ? (fmt$(each) + " ea · " + fmt$(each * qty) + "/×" + qty) : fmt$(each);
        html += "<div style='display:flex;justify-content:space-between;padding:3px 0'><span><b style='color:#ffd166'>" + (i + 1) + "</b> " + it +
          " <span style='color:#7f8794;font-size:11px'>(" + tagN + ")</span>" + (owned ? " <span style='color:#7ed957;font-size:11px'>✓worn</span>" : "") +
          "</span><span style='color:#7ed957'>" + line + "</span></div>";
      });
    }
    // BARBER chair / CLOTHING styling (real cosmetic restyle that nudges swagger)
    const styles = styleMenu(kind);
    if (styles.length) {
      const label = kind === "barber" ? "BARBER CHAIR" : "FITTING ROOM";
      html += "<div style='font-size:12px;color:#9fb0c6;margin:8px 0 2px'>" + label +
        " <span style='color:#7f8794'>· current: " + (kind === "barber" ? look().hair : look().outfit) + "</span></div>";
      styles.forEach((s, i) => {
        const letter = String.fromCharCode(97 + i);  // a,b,c...
        html += "<div style='display:flex;justify-content:space-between;padding:2px 0'><span><b style='color:#7fd0ff'>" + letter.toUpperCase() + "</b> " +
          s.name + " <span style='color:#7f8794;font-size:11px'>(+" + s.swag + " swagger)</span></span><span style='color:#7ed957'>" + fmt$(s.cost) + "</span></div>";
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
    // ROB THE TILL — every shop with a register (not banks/services-only) can be
    // stuck up for the cash drawer: fast money, but it spikes your wanted level.
    if (canRobTill(kind)) {
      html += "<div style='font-size:12px;color:#ff7a7a;margin:10px 0 0;border-top:1px solid #2c3140;padding-top:6px'>" +
        "<b style='color:#ff9e6b'>[R]</b> Rob the till <span style='color:#7f8794'>(~" + fmt$(tillEstimate(kind)) + ", and the heat that comes with it)</span></div>";
    }
    el().innerHTML = html;
  }

  // styling menus (cosmetic restyle that grants a small standing swagger bonus)
  function styleMenu(kind) {
    if (kind === "barber") return HAIRCUTS;
    if (kind === "clothing") return OUTFITS;
    return [];
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
    // electronics: spend on a phone upgrade that pings nearby loot/cash on people
    if (kind === "electronics") s.push({ key: "u", label: (g.cityPhoneTier ? "Upgrade your phone (tier " + g.cityPhoneTier + ")" : "Buy a smartphone — track marks & deals") + " — $" + phoneUpgCost(), fn: phoneUpgrade });
    // jewelry: ICE OUT — buy the whole chain+ring+grill set at a bundle discount
    if (kind === "jewelry") s.push({ key: "u", label: "Ice out — buy the full set (bundle deal)", fn: iceOut });
    // every shop offers the job board if careers exist
    if (CBZ.cityJobBoard) s.push({ key: "b", label: "Job board (hustles for cash)", fn: () => CBZ.cityJobBoard() });
    return s;
  }

  function sellable(kind) {
    const inv = g.cityInv || {}, econ = CBZ.cityEcon, out = [];
    for (const k in inv) {
      const it = econ.ITEMS[k]; if (!it) continue;
      // don't offer to sell something you're currently WEARING (flex stays on)
      if ((kind === "jewelry" || kind === "pawn") && isWorn(k) && inv[k] <= 1) continue;
      // pawn buys anything; jewelry buys wearables; others buy their own tags
      const ok = kind === "pawn" || (kind === "jewelry" && it.tag === "wearable") ||
        (kind === "electronics" && it.tag === "valuable") || it.tag === "valuable";
      if (ok) out.push({ name: k, n: inv[k] });
    }
    return out;
  }
  function sellTotal(kind) { let t = 0; for (const s of sellable(kind)) t += CBZ.cityEcon.sellPrice(s.name, kind) * s.n; return t; }
  function sellAll(kind) {
    const econ = CBZ.cityEcon; let got = 0, n = 0;
    for (const s of sellable(kind)) {
      // never sell the last copy of something you're flexing
      let sellN = s.n; if (isWorn(s.name)) sellN = Math.max(0, s.n - 1);
      if (sellN <= 0) continue;
      const p = econ.sellPrice(s.name, kind); got += p * sellN; econ.take(s.name, sellN); n += sellN;
      if (econ.bumpFenceRep && (s.name && (econ.ITEMS[s.name].tag === "valuable" || econ.ITEMS[s.name].tag === "wearable"))) econ.bumpFenceRep(sellN);
    }
    if (got > 0) { CBZ.city.addCash(got); if (CBZ.sfx) CBZ.sfx("coin"); CBZ.city.note("Sold " + n + " for " + fmt$(got), 1.8); }
    else CBZ.city.note("Nothing to sell here.", 1.4);
    render();
  }

  // ---- buying (now supports a quantity multiplier + the shop discount) ------
  function buy(i) {
    const it = listItems[i]; if (!it) return;
    const econ = CBZ.cityEcon, meta = econ.ITEMS[it];
    // weapons/armor are single-buy (you can't carry a stack of the same gun
    // meaningfully); everything else respects the qty multiplier.
    const single = !!(meta.gun || meta.melee || meta.armor);
    const n = single ? 1 : qty;
    const each = unitPrice(it, n);
    const total = each * n;
    if (!CBZ.city.spend(total)) {
      CBZ.city.note("Can't afford " + (n > 1 ? n + "× " : "") + it + " (" + fmt$(total) + ")", 1.6);
      if (CBZ.sfx) CBZ.sfx("glass");
      return;
    }
    if (CBZ.sfx) CBZ.sfx("coin");
    if (openLot.kind === "food" && meta.heal) {
      for (let k = 0; k < n; k++) { g.hunger = Math.min(100, (g.hunger || 0) + meta.heal); if (CBZ.player.hp != null && CBZ.player.maxHp) CBZ.player.hp = Math.min(CBZ.player.maxHp, CBZ.player.hp + Math.round(meta.heal * 0.4)); }
      if (meta.boost) CBZ.player._boost = 12;
      CBZ.city.note((n > 1 ? n + "× " : "Ate ") + it + " (+" + (meta.heal * n) + " food)", 1.6);
    }
    else if (meta.gun || meta.melee) { econ.add(it, 1); CBZ.cityGiveWeapon(it); }
    else if (meta.rounds) { CBZ.cityAddAmmo(meta.rounds * n); CBZ.city.note("+" + (meta.rounds * n) + " ammo", 1.4); }
    else if (meta.armor) { CBZ.player._armor = Math.min(100, (CBZ.player._armor || 0) + meta.armor); CBZ.city.note("Body Armor on (+" + meta.armor + ")", 1.6); }
    else if (meta.tag === "wearable") {
      econ.add(it, n);
      // jewelry & clothing stores: AUTO-EQUIP the flex (drip applied once here)
      if (openLot.kind === "jewelry" || openLot.kind === "clothing") equip(it);
      else CBZ.city.note("Bought " + (n > 1 ? n + "× " : "") + it, 1.4);
    }
    else { econ.add(it, n); CBZ.city.note("Bought " + (n > 1 ? n + "× " : "") + it, 1.4); }
    render();
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  // equip a wearable you own → it counts toward worn drip, respect once
  function equip(name) {
    const meta = CBZ.cityEcon.ITEMS[name]; if (!meta || meta.tag !== "wearable") return;
    if (!isWorn(name)) {
      worn()[name] = true;
      if (meta.drip) CBZ.city.addRespect(meta.drip);
      CBZ.city.note("💎 Iced out: " + name + " (+" + (meta.drip || 0) + " drip)", 1.8);
    } else {
      CBZ.city.note("Already flexing " + name + ".", 1.4);
    }
  }

  // ---- HAGGLING: one attempt per visit. Higher respect = better odds & cut.
  // Win → a discount on everything this visit; lose → clerk holds firm (small
  // chance they're insulted and the deal's slightly worse — risk, not free).
  function tryHaggle() {
    if (haggleTried) { CBZ.city.note("You already worked them. " + (haggle > 0 ? "Deal's −" + Math.round(haggle * 100) + "%." : "No discount this trip."), 1.6); return; }
    haggleTried = true;
    const rep = (g.respect || 0), swag = wornDrip();
    const odds = Math.min(0.85, 0.4 + rep / 800 + swag / 120);
    const roll = Math.random();
    if (roll < odds) {
      const cut = 0.05 + Math.random() * 0.13 + Math.min(0.05, swag / 300);
      haggle = Math.min(0.18, cut);
      if (CBZ.sfx) CBZ.sfx("coin");
      CBZ.city.note("🤝 Talked them down −" + Math.round(haggle * 100) + "% on the whole counter.", 2);
    } else if (roll > 0.93 && rep < 40) {
      haggle = 0;
      CBZ.city.note("The clerk's insulted — no deal today.", 1.8);
    } else {
      haggle = 0;
      CBZ.city.note("They won't budge on price.", 1.6);
    }
    render();
  }

  // ---- ROBBING THE TILL: GTA convenience-store stick-up. Big cash for the
  // register, but it's an armed robbery: instant wanted spike, a panicking
  // clerk + witnesses, and a real chance cops are already rolling. The clerk
  // may also resist (you get less + extra heat). Bigger shops = fatter tills.
  const TILL = {
    food: 120, gas: 160, electronics: 600, jewelry: 1400, clothing: 220,
    pawn: 400, hardware: 140, drugs: 500, gym: 90, barber: 70, bar: 350,
    casino: 2200, security: 300,
  };
  function canRobTill(kind) {
    // banks/realtors/services-only counters and vehicle lots don't have a
    // stick-up-able register here (banks are heists handled elsewhere).
    if (kind === "bank" || kind === "realtor" || kind === "carlot" || kind === "chop") return false;
    return TILL[kind] != null;
  }
  function tillEstimate(kind) {
    const base = TILL[kind] || 100;
    // richer districts keep more cash on hand; scale a touch with your rep too
    let mul = 1;
    if (CBZ.cityEcon.playerDistrict) {
      const dk = CBZ.cityEcon.playerDistrict();
      mul = (dk === "uptown" || dk === "island") ? 1.4 : (dk === "projects" ? 0.75 : 1);
    }
    return Math.round(base * mul);
  }
  function robTill() {
    const kind = openLot.kind;
    if (!canRobTill(kind)) { CBZ.city.note("No register to crack here.", 1.4); return; }
    const door = openLot.building.door, x = door ? door.x : CBZ.player.pos.x, z = door ? door.z : CBZ.player.pos.z;
    const est = tillEstimate(kind);
    // clerk resistance: the better-defended shops (guns/jewelry/casino) fight
    // back more; a high-respect robber intimidates better (GTA intimidation).
    const armed = (kind === "jewelry" || kind === "casino" || kind === "security" || kind === "drugs");
    const intimidation = Math.min(0.9, 0.45 + (g.respect || 0) / 600 + wornDrip() / 150 + (CBZ.cityHasGun && CBZ.cityHasGun() ? 0.2 : 0));
    let take = est;
    let resisted = false;
    if (armed && Math.random() > intimidation) {
      resisted = true;
      take = Math.round(est * (0.3 + Math.random() * 0.3));   // grabbed what you could
    } else {
      take = Math.round(est * (0.7 + Math.random() * 0.6));   // 0.7×–1.3× of the estimate
    }
    take = Math.max(20, take);
    CBZ.city.addCash(take);
    if (CBZ.sfx) CBZ.sfx("coin");
    // CRIME: this is armed robbery — big heat, marks your last-known position,
    // panics the block, and rolls a chance a unit is already responding.
    if (CBZ.cityCrime) CBZ.cityCrime(resisted ? 220 : 170, { instant: true, x: x, z: z, type: "store robbery" });
    if (CBZ.cityAlarm) CBZ.cityAlarm(x, z, 22, resisted ? 1.4 : 1, CBZ.city.playerActor);
    if (CBZ.cityPanic) CBZ.cityPanic(x, z, 1.2, CBZ.city.playerActor);
    CBZ.city.addRespect(resisted ? 4 : 2);
    // a real chance the silent alarm already called it in: spawn a responder
    if (CBZ.citySpawnCop && (resisted || Math.random() < 0.5)) {
      const ang = Math.random() * Math.PI * 2, r = 26 + Math.random() * 10;
      CBZ.citySpawnCop(x + Math.cos(ang) * r, z + Math.sin(ang) * r, false);
      if (CBZ.sfx) CBZ.sfx("siren");
    }
    if (resisted) CBZ.city.big("🔫 Clerk resisted! Grabbed " + fmt$(take) + " — cops rolling!");
    else CBZ.city.big("💸 Robbed the till: " + fmt$(take) + " — WANTED!");
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    // the store kicks you out after a stick-up
    close();
  }

  // ---- styling (barber / clothing fitting room) ------------------------------
  function restyle(kind, idx) {
    const list = styleMenu(kind); const s = list[idx]; if (!s) return;
    const cur = kind === "barber" ? look().hair : look().outfit;
    if (cur === s.name) { CBZ.city.note("You're already rocking that.", 1.4); return; }
    if (!CBZ.city.spend(s.cost)) { CBZ.city.note("Need " + fmt$(s.cost) + " for that.", 1.6); if (CBZ.sfx) CBZ.sfx("glass"); return; }
    // swagger replaces the prior style's swagger contribution (no stacking)
    const prevSwag = stylePrevSwag(kind, cur);
    look().swagger = Math.max(0, (look().swagger || 0) - prevSwag + s.swag);
    if (kind === "barber") look().hair = s.name; else look().outfit = s.name;
    CBZ.city.addRespect(Math.max(1, Math.round(s.swag / 2)));
    if (CBZ.sfx) CBZ.sfx("coin");   // real payment-confirm sound (was a DIY "whoosh" for cuts)
    CBZ.city.note((kind === "barber" ? "💈 Fresh cut: " : "🧥 New fit: ") + s.name + " (+" + s.swag + " swagger)", 2);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    render();
  }
  function stylePrevSwag(kind, name) {
    const list = kind === "barber" ? HAIRCUTS : OUTFITS;
    const f = list.find((x) => x.name === name);
    return f ? f.swag : 0;
  }

  // ---- electronics: a phone upgrade money sink (utility flex) ----------------
  function phoneUpgCost() { return 250 + (g.cityPhoneTier || 0) * 350; }
  function phoneUpgrade() {
    const cost = phoneUpgCost();
    if ((g.cityPhoneTier || 0) >= 4) { CBZ.city.note("Top-tier phone already — nothing better in stock.", 1.8); return; }
    if (!CBZ.city.spend(cost)) { CBZ.city.note("Need " + fmt$(cost) + ".", 1.6); if (CBZ.sfx) CBZ.sfx("glass"); return; }
    g.cityPhoneTier = (g.cityPhoneTier || 0) + 1;
    if (CBZ.sfx) CBZ.sfx("coin");
    CBZ.city.note("📱 Phone upgraded to tier " + g.cityPhoneTier + " — better deals & street intel.", 2.2);
    render();
  }

  // ---- jewelry: ICE OUT bundle (buy the full flex set at a discount) ---------
  function iceOut() {
    const econ = CBZ.cityEcon;
    const set = ["Gold Chain", "Diamond Ring", "Rolex", "Diamond Grill", "Earrings"];
    const missing = set.filter((s) => !isWorn(s));
    if (!missing.length) { CBZ.city.note("You're already fully iced out. 💎", 1.8); return; }
    let raw = 0; for (const m of missing) raw += econ.buyPrice(m);
    const price = Math.round(raw * 0.82);   // 18% bundle deal
    if (!CBZ.city.spend(price)) { CBZ.city.note("The full set runs " + fmt$(price) + " right now.", 2); if (CBZ.sfx) CBZ.sfx("glass"); return; }
    if (CBZ.sfx) CBZ.sfx("coin");
    for (const m of missing) { econ.add(m, 1); equip(m); }
    CBZ.city.big("💎💎 ICED OUT — full set for " + fmt$(price) + "!");
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    render();
  }

  // ---- services impl ----
  function healFull() { if (CBZ.city.spend(200)) { CBZ.player.hp = CBZ.player.maxHp || 100; CBZ.player._armor = Math.max(CBZ.player._armor || 0, 0); CBZ.city.note("Healed to full.", 1.4); if (CBZ.sfx) CBZ.sfx("coin"); render(); } else CBZ.city.note("Need $200.", 1.4); }
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
    qty = 1; haggle = 0; haggleTried = false;   // reset per visit
    el().style.display = "block";
    if (CBZ.sfx) CBZ.sfx("door");
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
    // bulk-quantity toggle (1 → 5 → 10 → 1)
    if (k === "x") { e.preventDefault(); qty = qty === 1 ? 5 : qty === 5 ? 10 : 1; render(); return; }
    // haggle (one attempt this visit)
    if (k === "v") { e.preventDefault(); tryHaggle(); return; }
    // rob the till
    if (k === "r" && canRobTill(openLot.kind) && !services(openLot.kind).some((s) => s.key === "r")) {
      e.preventDefault(); robTill(); return;
    }
    // barber / clothing restyle (letters a..g map to the style list)
    const styles = styleMenu(openLot.kind);
    if (styles.length && k >= "a" && k <= "z") {
      const idx = k.charCodeAt(0) - 97;
      if (idx < styles.length) {
        // don't hijack a letter that's also a service key
        if (!services(openLot.kind).some((s) => s.key === k)) { e.preventDefault(); restyle(openLot.kind, idx); return; }
      }
    }
    const svc = services(openLot.kind).find((s) => s.key === k);
    if (svc) { e.preventDefault(); svc.fn(); }
  });
})();
