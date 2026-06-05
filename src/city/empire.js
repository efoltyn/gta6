/* ============================================================
   city/empire.js — the CAR-RESALE EMPIRE  (a real flipping loop).

   Rent a yard (a garage to hold cars) at Premium Autos — or OWN the lot
   outright via Zillow for a bigger yard and better margins. Steal/drive
   cars around the city and park them INTO the yard to stock it. Each car's
   CONDITION is read off its real damage on intake (a pristine exotic flips
   for a fortune; a smoking beater barely clears scrap) — RECONDITION it for
   a fee to widen the spread. A per-model MARKET drifts every run: some models
   are HOT right now and pay a premium; dumping the same model FLOODS its
   price, so a diverse stock flips best. Buy low, sell high.

   The yard doubles as a money-LAUNDERING FRONT: legit-looking resale volume
   lets you wash dirty street cash (g.cash) into clean bank money. How much
   you can clean — and your whole yard's throughput/margins — scales with how
   much TURF your gang controls. Coordinates with wealth.js's launder cut.

   The cops eventually RAID a hot yard (risk scales with notoriety + your
   wanted level). Recruit a crew (careers.js) and they fight the police
   alongside you; hold them off or they SEIZE part of your stock.

   Exposes: CBZ.cityOpenCarBiz, CBZ.cityCarBizMenu, CBZ.cityEmpireReset.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const g = CBZ.game;

  // ---- balance knobs --------------------------------------------------------
  const RENT_DEPOSIT = 2000;     // cost to rent a yard (free if you OWN the car lot)
  const RENT_CAP = 6, OWN_CAP = 12;
  // base resale spread vs. a car's clean value (the market + condition move on top)
  const RESALE_RENT = 0.62, RESALE_OWN = 0.74;
  const HOT_FACTOR = 0.86;       // stolen cars fetch less (no clean title)
  const INTAKE_DWELL = 0.8;      // seconds parked in the yard before a car is stocked
  const RAID_BASE = 70;          // notoriety pressure where raids become possible
  const RAID_TICK = 8;           // seconds between raid-risk rolls
  const RAID_DURATION = 30;      // seconds a raid lasts before it resolves
  const RECON_COST = 0.22;       // recondition fee = this × car clean value (per stage fixed)
  const LAUNDER_PER_SALE = 4500; // dirty cash you may wash per legit-looking resale (base)
  const FLOOD_STEP = 0.16;       // how hard selling a model floods its price down
  const MKT_REVERT = 0.06;       // per market-tick pull back to fair value
  const MKT_VOL = 0.05;          // per-tick random-walk volatility

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function money(n) { return "$" + (Math.max(0, n | 0)).toLocaleString(); }
  function biz() {
    return g.cityCarBiz || (g.cityCarBiz = {
      open: false, owned: false, cap: 0, cars: [], notoriety: 0,
      raid: null, raidT: RAID_TICK, mkt: {}, hotModel: null, hotT: 0,
      launderCredit: 0, sold: 0, page: 0
    });
  }

  // ---- the per-model live market -------------------------------------------
  // Each model carries a price level that mean-reverts to 1; selling a model
  // floods its level down (diminishing returns on dumping one model), and a
  // rolling "hot model" pays a premium for a window. Demand makes the spread.
  function rng() { return (CBZ.cityEcon && CBZ.cityEcon.rng) ? CBZ.cityEcon.rng() : Math.random(); }
  function mktLevel(name) {
    const b = biz(); if (!b.mkt) b.mkt = {};
    const v = b.mkt[name]; return (v == null || !isFinite(v)) ? 1 : v;
  }
  function setMkt(name, v) { const b = biz(); if (!b.mkt) b.mkt = {}; b.mkt[name] = clamp(v, 0.45, 2.6); }
  function isHot(name) { const b = biz(); return b.hotModel === name && (b.hotT || 0) > 0; }
  function demandMul(name) {
    // hot model premium + a gentle bias toward higher-tier (rarer) models
    let m = mktLevel(name);
    if (isHot(name)) m *= 1.0 + (biz().hotBonus || 0.45);
    return clamp(m, 0.45, 2.9);
  }

  // ---- turf tie: how much the player gang controls -------------------------
  // More zones => bigger yard cap, better resale spread, more launder throughput.
  function turfFrac() {
    try {
      const pg = g.playerGang;
      if (!pg || !pg.founded || !CBZ.cityZones) return 0;
      const zones = CBZ.cityZones(); if (!zones || !zones.length) return 0;
      let mine = 0; for (const z of zones) if (z.owner === pg.id) mine++;
      return clamp(mine / zones.length, 0, 1);
    } catch (e) { return 0; }
  }
  function turfBonus() { return turfFrac() * 0.18; }          // up to +18% resale spread
  function effCap() { const b = biz(); return (b.cap || 0) + Math.round(turfFrac() * 6); }

  // ---- condition ------------------------------------------------------------
  // 1.0 = pristine, down to ~0.45 = wrecked. Read off the car's real damage on
  // intake; RECONDITION bumps it back up for a fee (the buy-low/fix/sell-high spread).
  function conditionOf(car) {
    let cond = 1;
    try {
      const stage = CBZ.cityCarStage ? CBZ.cityCarStage(car) : 0;
      cond -= [0, 0.18, 0.34, 0.5][stage] || 0;
      if (car.crumple) cond -= Math.min(0.28, car.crumple * 0.4);
    } catch (e) {}
    return clamp(cond, 0.45, 1);
  }
  function condWord(c) { return c >= 0.95 ? "mint" : c >= 0.8 ? "clean" : c >= 0.62 ? "worn" : c >= 0.5 ? "rough" : "wrecked"; }

  function resaleOf(car) {
    const b = biz();
    const base = (car.value || 0) * (b.owned ? RESALE_OWN : RESALE_RENT);
    const spread = base * (1 + turfBonus());
    const v = spread * demandMul(car.name) * (car.cond == null ? 1 : car.cond) * (car.hot ? HOT_FACTOR : 1);
    return Math.max(1, Math.round(v));
  }
  function stockValue() { let t = 0; for (const c of biz().cars) t += resaleOf(c); return t; }

  // the yard = the Premium Autos car-lot front (fallback: the chop shop)
  function yardLot() {
    const A = CBZ.city && CBZ.city.arena; if (!A) return null;
    const lots = A.shopLots || (A.lots || []).filter((l) => l.building && l.building.shop);
    return (lots && lots.find((l) => l.kind === "carlot")) || A.chopShop || null;
  }
  function yardZone() {
    const lot = yardLot(); if (!lot || !lot.building || !lot.building.door) return null;
    const d = lot.building.door;
    return { x: d.x + (d.nx || 0) * 5, z: d.z + (d.nz || 0) * 5, r: 6.5, lot };
  }

  // ---- open / rent the yard -------------------------------------------------
  CBZ.cityOpenCarBiz = function () {
    const b = biz();
    const lot = yardLot();
    if (!lot) { CBZ.city.note("There's no car lot in town to base a yard at.", 2); return; }
    if (b.open) { CBZ.cityCarBizMenu(); return; }
    const owns = CBZ.cityOwnsLot && CBZ.cityOwnsLot(lot);
    if (!owns && !CBZ.city.spend(RENT_DEPOSIT)) { CBZ.city.note("Renting a yard costs " + money(RENT_DEPOSIT) + ".", 2); return; }
    b.open = true; b.owned = !!owns; b.cap = owns ? OWN_CAP : RENT_CAP;
    CBZ.city.big("🚗 Car-resale yard is OPEN at Premium Autos");
    CBZ.city.note(owns ? "You own the lot — bigger yard, better resale." : "Yard rented. Drive cars into the lot to stock it.", 3.2);
    if (CBZ.sfx) CBZ.sfx("coin");
    CBZ.cityCarBizMenu();
  };

  // ---- stock a car driven into the yard -------------------------------------
  function intake(car) {
    const b = biz();
    const model = car.model || { name: "Sedan", value: 3000 };
    const hot = !car.owned;
    const cond = conditionOf(car);
    b.cars.push({ name: model.name, value: model.value, hot: hot, cond: cond });
    if (hot) b.notoriety += clamp(Math.round(model.value / 1500), 5, 30);
    if (CBZ.player._vehicle === car && CBZ.cityExitVehicle) CBZ.cityExitVehicle();
    if (car.group && car.group.parent) car.group.parent.remove(car.group);
    const idx = CBZ.cityCars.indexOf(car); if (idx >= 0) CBZ.cityCars.splice(idx, 1);
    if (CBZ.sfx) CBZ.sfx("door");
    const stocked = b.cars[b.cars.length - 1];
    CBZ.city.note("🚗 Stocked " + model.name + " (" + condWord(cond) + ") — resale " + money(resaleOf(stocked)) +
      (hot ? " · hot" : "") + (isHot(model.name) ? " · 🔥 in demand" : ""), 2.4);
    if (menuOpen) renderMenu();
  }

  // ---- recondition: pay to repair a car's condition (widen the flip spread) --
  function reconCost(car) {
    const gap = 1 - (car.cond == null ? 1 : car.cond);
    return Math.max(1, Math.round((car.value || 0) * RECON_COST * (0.4 + gap)));
  }
  function recondition(i) {
    const b = biz(); const car = b.cars[i]; if (!car) return;
    if ((car.cond || 1) >= 0.95) { CBZ.city.note(car.name + " is already in mint shape.", 1.4); return; }
    const cost = reconCost(car);
    if (!CBZ.city.canAfford(cost)) { CBZ.city.note("Recondition costs " + money(cost) + " — short on cash.", 1.8); return; }
    const before = resaleOf(car);
    CBZ.city.spend(cost); car.cond = 1;
    const after = resaleOf(car);
    if (CBZ.sfx) CBZ.sfx("door");
    CBZ.city.note("🔧 Reconditioned " + car.name + " (−" + money(cost) + ") · resale " + money(before) + " → " + money(after), 2.6);
    renderMenu();
  }

  // ---- sell stock -----------------------------------------------------------
  function recordModelSale(name, n) {
    // dumping a model floods its local price (diminishing the deeper you flood)
    const cur = mktLevel(name);
    setMkt(name, cur - FLOOD_STEP * (n || 1) * (0.5 + 0.5 * cur));
  }
  function grantLaunderCredit(pay) {
    // each legit-looking resale lets you wash more dirty cash; turf widens it
    const b = biz();
    const cap = LAUNDER_PER_SALE * (1 + turfFrac() * 1.5);
    b.launderCredit = Math.min(cap * 6, (b.launderCredit || 0) + Math.min(cap, pay * 0.6));
  }
  function sell(i) {
    const b = biz(); const car = b.cars[i]; if (!car) return;
    const pay = resaleOf(car);
    b.cars.splice(i, 1);
    CBZ.city.addCash(pay); CBZ.city.addRespect(2);
    b.notoriety = Math.max(0, b.notoriety - 3);            // moving clean stock cools heat
    b.sold = (b.sold || 0) + 1;
    recordModelSale(car.name, 1);
    grantLaunderCredit(pay);
    CBZ.city.big("SOLD " + car.name + " — +" + money(pay));
    if (CBZ.sfx) CBZ.sfx("coin");
    clampPage();
    renderMenu();
  }
  function sellAll() {
    const b = biz(); if (!b.cars.length) { CBZ.city.note("No cars in the yard.", 1.4); return; }
    let pay = 0; const n = b.cars.length; const counts = {};
    for (const c of b.cars) { pay += resaleOf(c); counts[c.name] = (counts[c.name] || 0) + 1; }
    b.cars.length = 0; b.notoriety = Math.max(0, b.notoriety - 3 * n);
    b.sold = (b.sold || 0) + n;
    for (const nm in counts) recordModelSale(nm, counts[nm]);
    grantLaunderCredit(pay);
    CBZ.city.addCash(pay); CBZ.city.addRespect(n);
    b.page = 0;
    CBZ.city.big("SOLD " + n + " cars — +" + money(pay));
    if (CBZ.sfx) CBZ.sfx("coin");
    renderMenu();
  }

  // ---- LAUNDERING FRONT -----------------------------------------------------
  // Wash dirty street cash (g.cash) into clean bank money. Throughput is capped
  // by how much resale VOLUME you've moved (launderCredit) — you can only hide
  // so much behind legit-looking sales. Reuses economy.js's launder() so the
  // cut already accounts for wealth.js's laundromats; turf shaves a little more.
  function launderHere() {
    const b = biz();
    const credit = Math.floor(b.launderCredit || 0);
    const dirty = g.cash || 0;
    if (credit < 100) { CBZ.city.note("Sell cars first — resale volume is what lets you wash cash through the yard.", 2.4); return; }
    if (dirty < 100) { CBZ.city.note("No real dirty cash on hand to wash.", 1.6); return; }
    const amount = Math.min(credit, dirty);
    if (CBZ.cityEcon && CBZ.cityEcon.launder) {
      const r = CBZ.cityEcon.launder(amount);
      // turf rebate: hand back a slice of the cut as a small clean bonus
      const rebate = Math.round((r.lost || 0) * Math.min(0.4, turfFrac() * 0.6));
      if (rebate > 0) { g.cityBank = (g.cityBank || 0) + rebate; if (CBZ.cityHudDirty) CBZ.cityHudDirty(); }
      b.launderCredit = Math.max(0, credit - amount);
      if (CBZ.cityWealth && g.cityWealthLog) g.cityWealthLog.laundered = (g.cityWealthLog.laundered || 0) + (r.banked || 0) + rebate;
      CBZ.city.big("🧺 Washed " + money(amount) + " → " + money((r.banked || 0) + rebate) + " clean");
      CBZ.city.note((rebate > 0 ? "Turf rebate +" + money(rebate) + " · " : "") + "cut −" + money((r.lost || 0) - rebate) + ". Buy fronts (Shift+B) to shrink it.", 2.8);
      if (CBZ.sfx) CBZ.sfx("coin");
    } else {
      // fallback fair launder if economy.js launder is unavailable
      const cut = clamp(0.2 - turfFrac() * 0.08, 0.06, 0.2);
      const lost = Math.round(amount * cut), banked = amount - lost;
      if (CBZ.city.spend) CBZ.city.spend(amount); else g.cash = Math.max(0, (g.cash || 0) - amount);
      g.cityBank = (g.cityBank || 0) + banked;
      b.launderCredit = Math.max(0, credit - amount);
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
      CBZ.city.big("🧺 Washed " + money(amount) + " → " + money(banked) + " clean (−" + money(lost) + ")");
      if (CBZ.sfx) CBZ.sfx("coin");
    }
    renderMenu();
  }

  // ---- police RAIDS ---------------------------------------------------------
  function crewCount() { let n = 0; for (const p of CBZ.cityPeds) if (p.recruited && !p.dead && p.kind === "crew") n++; return n; }

  function startRaid(b) {
    const z = yardZone(); if (!z) return;
    const squad = 3 + Math.min(4, Math.floor(b.notoriety / 40));
    const cops = [];
    for (let i = 0; i < squad; i++) { const c = CBZ.citySpawnCop && CBZ.citySpawnCop(z.x, z.z, i % 3 === 0); if (c) cops.push(c); }
    if (CBZ.cityForceStars) CBZ.cityForceStars(Math.min(5, 3 + Math.floor(b.notoriety / 60)));
    b.raid = { t: RAID_DURATION, cops: cops };
    CBZ.city.big("🚨 POLICE RAID on your yard!");
    CBZ.city.note("Hold them off or they'll seize your stock — defend the yard!", 3.2);
    if (CBZ.sfx) CBZ.sfx("alarm");
  }
  function crewDefend(dt) {
    for (const m of CBZ.cityPeds) {
      if (!m.recruited || m.dead || m.kind !== "crew") continue;
      let cop = null, bd = 1e9;
      for (const c of CBZ.cityCops) { if (c.dead) continue; const dx = c.pos.x - m.pos.x, dz = c.pos.z - m.pos.z, d = dx * dx + dz * dz; if (d < bd) { bd = d; cop = c; } }
      if (!cop) continue;
      m.guard = { x: cop.pos.x, z: cop.pos.z };          // steer the ped brain toward the cop
      m.shootCD = (m.shootCD || 0) - dt;
      const dd = Math.sqrt(bd);
      if (dd < 13 && m.shootCD <= 0) {
        m.shootCD = 0.7 + Math.random() * 0.5;
        if (m.armed && CBZ.tracer) {
          if (CBZ.actorAimAt) CBZ.actorAimAt(m, cop);
          const from = CBZ.actorMuzzle ? CBZ.actorMuzzle(m) : { x: m.pos.x, y: 1.4, z: m.pos.z };
          CBZ.tracer(from, { x: cop.pos.x, y: 1.3, z: cop.pos.z }, { muzzleScale: 1.0 });
        }
        if (CBZ.cityHurtCop) CBZ.cityHurtCop(cop, m.armed ? 11 : 6, { fromX: m.pos.x, fromZ: m.pos.z, attacker: m, byPlayer: false });
      }
    }
  }
  function endRaid(b, repelled) {
    b.raid = null; b.raidT = RAID_TICK + 10;
    if (repelled) {
      b.notoriety = Math.max(0, b.notoriety * 0.35 - 10);
      CBZ.city.addRespect(12);
      CBZ.city.big("🚓 Raid repelled — yard secured!");
    } else {
      b.notoriety = Math.max(0, b.notoriety * 0.5);
      if (b.cars.length) {
        const lost = b.cars.splice(0, Math.max(1, Math.floor(b.cars.length / 2)));
        CBZ.city.big("🚔 Police seized " + lost.length + " car" + (lost.length === 1 ? "" : "s") + " from the yard");
        CBZ.city.note("They cleaned out part of your stock. Lay low for a while.", 2.8);
      } else {
        CBZ.city.big("🚔 Police tore through your yard");
        CBZ.city.note("Nothing for them to seize this time. Lay low for a while.", 2.6);
      }
    }
    clampPage();
    if (menuOpen) renderMenu();
  }
  function tickRaid(b, dt) {
    const raid = b.raid;
    raid.t -= dt;
    crewDefend(dt);
    let alive = 0; for (const c of raid.cops) if (!c.dead) alive++;
    if (alive === 0) { endRaid(b, true); return; }
    if (raid.t <= 0) endRaid(b, (g.wanted | 0) < 3);     // time up: held them off only if you shook the heat
  }

  let warnedHeat = false;
  CBZ.onUpdate(38.8, function (dt) {
    if (g.mode !== "city") return;
    const b = g.cityCarBiz; if (!b || !b.open) return;
    if (b.raid) { tickRaid(b, dt); return; }
    if (b.notoriety > 0) b.notoriety = Math.max(0, b.notoriety - dt * 0.6);   // cools when you lie low
    // a heads-up as the heat builds
    if (b.notoriety > RAID_BASE * 0.7 && !warnedHeat) { warnedHeat = true; CBZ.city.note("⚠️ Your chop operation is drawing police attention…", 2.4); }
    if (b.notoriety < RAID_BASE * 0.5) warnedHeat = false;
    b.raidT -= dt; if (b.raidT > 0) return;
    b.raidT = RAID_TICK;
    const hot = b.cars.filter((c) => c.hot).length;
    // raid risk scales with notoriety, hot stock, AND your current wanted level
    const pressure = b.notoriety + hot * 8 + (g.wanted | 0) * 12;
    if (pressure < RAID_BASE) return;
    if (Math.random() < Math.min(0.9, (pressure - RAID_BASE) / 140)) startRaid(b);
  });

  // ---- per-model market drift + rolling "hot model" -------------------------
  CBZ.onUpdate(38.9, function (dt) {
    if (g.mode !== "city") return;
    const b = g.cityCarBiz; if (!b || !b.open) return;
    if (!b.mkt) b.mkt = {};
    // recover every tracked model's level toward fair value (1)
    for (const k in b.mkt) {
      const lv = b.mkt[k];
      if (!isFinite(lv)) { b.mkt[k] = 1; continue; }
      b.mkt[k] = lv + (1 - lv) * MKT_REVERT * dt + (rng() - 0.5) * MKT_VOL * dt;
      b.mkt[k] = clamp(b.mkt[k], 0.45, 2.6);
    }
    // a rolling demand spike: one model is "🔥 hot" (pays a premium) for a window
    b.hotT = (b.hotT || 0) - dt;
    if (b.hotT <= 0) {
      const CARS = (CBZ.cityEcon && CBZ.cityEcon.CARS) || [];
      if (CARS.length && rng() < dt * 0.05) {
        const pick = CARS[(rng() * CARS.length) | 0];
        b.hotModel = pick.name; b.hotT = 25 + rng() * 30; b.hotBonus = 0.35 + rng() * 0.4;
        setMkt(pick.name, mktLevel(pick.name) + 0.3);
        if (CBZ.city && CBZ.city.note) CBZ.city.note("📈 Word from the auctions: " + pick.name + "s are HOT right now — flip yours.", 2.8);
        if (menuOpen) renderMenu();
      } else { b.hotModel = null; }
    }
  });

  // ---- car intake updater ---------------------------------------------------
  CBZ.onUpdate(38.7, function (dt) {
    if (g.mode !== "city") return;
    const b = g.cityCarBiz; if (!b || !b.open) return;
    const P = CBZ.player; const car = P._vehicle;
    if (!P.driving || !car) return;
    const z = yardZone(); if (!z) return;
    const inZone = Math.hypot(P.pos.x - z.x, P.pos.z - z.z) < z.r;
    const vmag = Math.abs(car.v || 0);
    if (inZone && vmag < 2.2) {
      if (b.cars.length >= effCap()) { car._yard = 0; CBZ.city.note("Yard full (" + effCap() + ") — sell some stock first.", 1.0); return; }
      car._yard = (car._yard || 0) + dt;
      if (car._yard >= INTAKE_DWELL) intake(car);
      else if (CBZ.city) CBZ.city.note("Parking the " + (car.model ? car.model.name : "car") + " in the yard…", 0.5);
    } else if (car) car._yard = 0;
  });

  CBZ.cityEmpireReset = function () {
    g.cityCarBiz = {
      open: false, owned: false, cap: 0, cars: [], notoriety: 0,
      raid: null, raidT: RAID_TICK, mkt: {}, hotModel: null, hotT: 0,
      launderCredit: 0, sold: 0, page: 0
    };
    warnedHeat = false;
    if (menu) menu.style.display = "none";
    menuOpen = false;
  };

  // ==========================================================================
  //  yard management overlay  (one screen, no scroll, paginated stock)
  // ==========================================================================
  let menu = null, menuOpen = false;
  const PAGE = 6;                                   // stock rows per page (fits one screen)

  function pages() { return Math.max(1, Math.ceil(biz().cars.length / PAGE)); }
  function clampPage() { const b = biz(); b.page = clamp(b.page || 0, 0, pages() - 1); }

  function menuEl() {
    if (menu) return menu;
    menu = document.createElement("div");
    menu.id = "cityCarBiz";
    menu.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:48;display:none;min-width:380px;max-width:460px;background:rgba(14,16,22,.96);border:2px solid #3a3140;border-radius:16px;padding:15px 18px;color:#e8eef7;font-family:Fredoka,system-ui,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.55);pointer-events:auto";
    document.body.appendChild(menu);
    return menu;
  }
  function condColor(c) { return c >= 0.8 ? "#7ed957" : c >= 0.6 ? "#ffd166" : "#ff8a7a"; }

  function renderMenu() {
    const b = biz();
    clampPage();
    const cap = effCap();
    const tf = turfFrac();
    let html = "<div style='font-size:19px;font-weight:700;margin-bottom:1px'>🚗 Car-Resale Yard</div>";
    html += "<div style='font-size:12px;color:#8a93a3;margin-bottom:7px'>Cash " + money(g.cash || 0) +
      " · Yard " + b.cars.length + "/" + cap + (b.owned ? " · owned" : " · rented") +
      " · Crew " + crewCount() + (tf > 0 ? " · Turf " + Math.round(tf * 100) + "%" : "") + "</div>";
    // notoriety / heat bar
    const pct = Math.min(100, Math.round((b.notoriety / (RAID_BASE * 1.4)) * 100));
    const col = pct > 75 ? "#e2574b" : pct > 45 ? "#ffb454" : "#7ed957";
    html += "<div style='font-size:12px;color:#9fb0c6;margin-bottom:2px'>Police heat" + (b.raid ? " — <b style='color:#ff6b6b'>RAID IN PROGRESS</b>" : "") + "</div>";
    html += "<div style='height:7px;background:#222831;border-radius:5px;overflow:hidden;margin-bottom:8px'><div style='height:100%;width:" + pct + "%;background:" + col + "'></div></div>";

    // stock (paginated)
    if (b.cars.length) {
      const np = pages(), pg = b.page || 0, start = pg * PAGE;
      const slice = b.cars.slice(start, start + PAGE);
      html += "<div style='font-size:12px;color:#9fb0c6;margin-bottom:3px'>STOCK · " +
        "[1–" + slice.length + "] sell · <b style='color:#79c0ff'>F</b>+# recondition · <b style='color:#ff9e6b'>0</b> sell all (" + money(stockValue()) + ")</div>";
      slice.forEach((c, k) => {
        const i = start + k;
        const cond = c.cond == null ? 1 : c.cond;
        html += "<div style='display:flex;justify-content:space-between;align-items:center;padding:2px 0;font-size:14px'>" +
          "<span><b style='color:#ffd166'>" + (k + 1) + "</b> " + c.name +
          " <span style='color:" + condColor(cond) + ";font-size:11px'>" + condWord(cond) + "</span>" +
          (c.hot ? " <span style='color:#ff8a7a;font-size:10px'>hot</span>" : "") +
          (isHot(c.name) ? " <span style='color:#ffb454;font-size:10px'>🔥</span>" : "") +
          "</span><span style='color:#7ed957'>" + money(resaleOf(c)) + "</span></div>";
      });
      if (np > 1) html += "<div style='font-size:11px;color:#8a93a3;text-align:center;margin-top:3px'>◀ <b style='color:#cdd6e0'>[ ]</b> ▶ page " + (pg + 1) + "/" + np + (b.cars.length > start + PAGE ? " · +" + (b.cars.length - start - slice.length) + " more" : "") + "</div>";
    } else {
      html += "<div style='color:#7f8794;padding:6px 0;font-size:13px'>Empty. Steal a car (F) and drive it into the lot out front. Beaters flip cheap — recondition + flip a HOT model for the spread.</div>";
    }

    // laundering front line
    const credit = Math.floor(b.launderCredit || 0);
    html += "<div style='font-size:12px;margin-top:8px;color:#cdb8ff'>🧺 Launder front · <b style='color:#cdd6e0'>L</b> wash dirty cash — capacity " + money(credit) +
      (credit < 100 ? " <span style='color:#8a93a3'>(sell cars to build it)</span>" : "") + "</div>";

    html += "<div style='font-size:11px;color:#6b7480;margin-top:8px'>Recruit a crew ([K] near a person) — they fight cops in a raid. [Esc] close</div>";
    menuEl().innerHTML = html;
  }
  CBZ.cityCarBizMenu = function () {
    if (!biz().open) { CBZ.cityOpenCarBiz(); return; }
    renderMenu();
    menuEl().style.display = "block"; menuOpen = true; CBZ.cityMenuOpen = true;
    if (document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
  };
  function closeMenu() { if (menu) menu.style.display = "none"; menuOpen = false; CBZ.cityMenuOpen = false; if (CBZ.requestLock && g.state === "playing") CBZ.requestLock(); }
  CBZ.cityCarBizClose = closeMenu;

  // a small surface for the headless harness + debugging
  CBZ.cityEmpire = {
    open: function () { return CBZ.cityOpenCarBiz(); },
    menu: function () { return CBZ.cityCarBizMenu(); },
    intake: intake, sell: sell, sellAll: sellAll, resaleOf: resaleOf, yardZone: yardZone,
    recondition: recondition, launder: launderHere, conditionOf: conditionOf,
    forceRaid: function () { const b = biz(); if (b.open && !b.raid) startRaid(b); },
    state: function () { return biz(); },
  };

  // keyboard: stock rows are PAGE-relative; recondition is F+row while menu open.
  let reconMode = false;
  addEventListener("keydown", function (e) {
    if (!menuOpen) return;
    const k = (e.key || "").toLowerCase();
    if (k === "escape") { e.preventDefault(); reconMode = false; closeMenu(); return; }
    const b = biz();
    if (k === "f") { e.preventDefault(); reconMode = true; CBZ.city && CBZ.city.note("Recondition which? press its number.", 1.0); return; }
    if (k === "[" || k === "arrowleft") { e.preventDefault(); b.page = Math.max(0, (b.page || 0) - 1); renderMenu(); return; }
    if (k === "]" || k === "arrowright") { e.preventDefault(); b.page = Math.min(pages() - 1, (b.page || 0) + 1); renderMenu(); return; }
    if (k === "l") { e.preventDefault(); launderHere(); return; }
    if (k >= "1" && k <= "9") {
      e.preventDefault();
      const idx = (b.page || 0) * PAGE + (parseInt(k, 10) - 1);
      if (reconMode) { reconMode = false; recondition(idx); } else sell(idx);
      return;
    }
    if (k === "0") { e.preventDefault(); reconMode = false; sellAll(); return; }
    reconMode = false;
  });
})();
