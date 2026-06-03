/* ============================================================
   city/empire.js — the CAR-RESALE EMPIRE.

   Rent a yard (a garage to hold cars) at Premium Autos — or OWN the lot
   outright via Zillow for a bigger yard and better margins. Steal cars
   around the city and drive them INTO the yard to stock it; each stolen
   ("hot") car raises your NOTORIETY. Resell your stock for profit from
   the yard menu.

   The catch the player asked for: the bigger your hot operation grows,
   the more likely the cops eventually RAID the yard — a squad storms in,
   and if you can't hold them off they SEIZE part of your stock. Recruit a
   crew (careers.js) and they fight the police alongside you during a raid.

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
  const RESALE_RENT = 0.70, RESALE_OWN = 0.82;   // fraction of a car's value you resell at
  const HOT_FACTOR = 0.85;       // stolen cars fetch a little less (no clean title)
  const INTAKE_DWELL = 0.8;      // seconds parked in the yard before a car is stocked
  const RAID_BASE = 70;          // notoriety pressure where raids become possible
  const RAID_TICK = 8;           // seconds between raid-risk rolls
  const RAID_DURATION = 30;      // seconds a raid lasts before it resolves

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function money(n) { return "$" + (n | 0).toLocaleString(); }
  function biz() { return g.cityCarBiz || (g.cityCarBiz = { open: false, owned: false, cap: 0, cars: [], notoriety: 0, raid: null, raidT: RAID_TICK }); }

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
  function resaleOf(car) {
    const b = biz();
    return Math.round((car.value || 0) * (b.owned ? RESALE_OWN : RESALE_RENT) * (car.hot ? HOT_FACTOR : 1));
  }
  function stockValue() { let t = 0; for (const c of biz().cars) t += resaleOf(c); return t; }

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
    b.cars.push({ name: model.name, value: model.value, hot: hot });
    if (hot) b.notoriety += clamp(Math.round(model.value / 1500), 5, 30);
    if (CBZ.player._vehicle === car && CBZ.cityExitVehicle) CBZ.cityExitVehicle();
    if (car.group && car.group.parent) car.group.parent.remove(car.group);
    const idx = CBZ.cityCars.indexOf(car); if (idx >= 0) CBZ.cityCars.splice(idx, 1);
    if (CBZ.sfx) CBZ.sfx("door");
    CBZ.city.note("🚗 Stocked " + model.name + " — resale " + money(resaleOf(b.cars[b.cars.length - 1])) + (hot ? " (hot)" : ""), 2.2);
    if (menuOpen) renderMenu();
  }

  // ---- sell stock -----------------------------------------------------------
  function sell(i) {
    const b = biz(); const car = b.cars[i]; if (!car) return;
    const pay = resaleOf(car);
    b.cars.splice(i, 1);
    CBZ.city.addCash(pay); CBZ.city.addRespect(2);
    b.notoriety = Math.max(0, b.notoriety - 3);
    CBZ.city.big("SOLD " + car.name + " — +" + money(pay));
    if (CBZ.sfx) CBZ.sfx("coin");
    renderMenu();
  }
  function sellAll() {
    const b = biz(); if (!b.cars.length) { CBZ.city.note("No cars in the yard.", 1.4); return; }
    let pay = 0, n = b.cars.length;
    for (const c of b.cars) pay += resaleOf(c);
    b.cars.length = 0; b.notoriety = Math.max(0, b.notoriety - 3 * n);
    CBZ.city.addCash(pay); CBZ.city.addRespect(n);
    CBZ.city.big("SOLD " + n + " cars — +" + money(pay));
    if (CBZ.sfx) CBZ.sfx("coin");
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
    const z = yardZone();
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
    const pressure = b.notoriety + hot * 8;
    if (pressure < RAID_BASE) return;
    if (Math.random() < Math.min(0.9, (pressure - RAID_BASE) / 140)) startRaid(b);
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
      if (b.cars.length >= b.cap) { car._yard = 0; CBZ.city.note("Yard full (" + b.cap + ") — sell some stock first.", 1.0); return; }
      car._yard = (car._yard || 0) + dt;
      if (car._yard >= INTAKE_DWELL) intake(car);
      else if (CBZ.city) CBZ.city.note("Parking the " + (car.model ? car.model.name : "car") + " in the yard…", 0.5);
    } else if (car) car._yard = 0;
  });

  CBZ.cityEmpireReset = function () {
    g.cityCarBiz = { open: false, owned: false, cap: 0, cars: [], notoriety: 0, raid: null, raidT: RAID_TICK };
    warnedHeat = false;
    if (menu) menu.style.display = "none";
    menuOpen = false;
  };

  // ==========================================================================
  //  yard management overlay
  // ==========================================================================
  let menu = null, menuOpen = false;

  function menuEl() {
    if (menu) return menu;
    menu = document.createElement("div");
    menu.id = "cityCarBiz";
    menu.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:48;display:none;min-width:360px;max-width:440px;background:rgba(14,16,22,.96);border:2px solid #3a3140;border-radius:16px;padding:16px 18px;color:#e8eef7;font-family:Fredoka,system-ui,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.55);pointer-events:auto";
    document.body.appendChild(menu);
    return menu;
  }
  function renderMenu() {
    const b = biz();
    let html = "<div style='font-size:20px;font-weight:700;margin-bottom:2px'>🚗 Your Car-Resale Yard</div>";
    html += "<div style='font-size:12px;color:#8a93a3;margin-bottom:8px'>Cash " + money(g.cash || 0) + " · Yard " + b.cars.length + "/" + b.cap + (b.owned ? " · OWNED" : " · rented") + " · Crew " + crewCount() + "</div>";
    // notoriety bar
    const pct = Math.min(100, Math.round((b.notoriety / (RAID_BASE * 1.4)) * 100));
    const col = pct > 75 ? "#e2574b" : pct > 45 ? "#ffb454" : "#7ed957";
    html += "<div style='font-size:12px;color:#9fb0c6;margin-bottom:2px'>Police heat on your operation" + (b.raid ? " — <b style='color:#ff6b6b'>RAID IN PROGRESS</b>" : "") + "</div>";
    html += "<div style='height:8px;background:#222831;border-radius:5px;overflow:hidden;margin-bottom:10px'><div style='height:100%;width:" + pct + "%;background:" + col + "'></div></div>";
    if (b.cars.length) {
      html += "<div style='font-size:12px;color:#9fb0c6;margin-bottom:3px'>STOCK — [1–9] sell · <b style='color:#ff9e6b'>0</b> sell all (" + money(stockValue()) + ")</div>";
      b.cars.slice(0, 9).forEach((c, i) => {
        html += "<div style='display:flex;justify-content:space-between;padding:3px 0'><span><b style='color:#ffd166'>" + (i + 1) + "</b> " + c.name + (c.hot ? " <span style='color:#ff8a7a;font-size:11px'>(hot)</span>" : "") + "</span><span style='color:#7ed957'>" + money(resaleOf(c)) + "</span></div>";
      });
    } else {
      html += "<div style='color:#7f8794;padding:8px 0'>Empty. Steal a car (F) and drive it into the lot out front to stock it.</div>";
    }
    html += "<div style='font-size:11px;color:#6b7480;margin-top:10px'>Recruit a crew ([K] near a person) — they fight the cops during a raid. [Esc] close</div>";
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
    forceRaid: function () { const b = biz(); if (b.open && !b.raid) startRaid(b); },
    state: function () { return biz(); },
  };

  addEventListener("keydown", function (e) {
    if (!menuOpen) return;
    const k = (e.key || "").toLowerCase();
    if (k === "escape") { e.preventDefault(); closeMenu(); return; }
    if (k >= "1" && k <= "9") { e.preventDefault(); sell(parseInt(k, 10) - 1); return; }
    if (k === "0") { e.preventDefault(); sellAll(); return; }
  });
})();
