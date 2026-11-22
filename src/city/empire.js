/* ============================================================
   city/empire.js — THE CAR TRADE: the dealer buys the car you drove in.

   OWNER: "No dashboards are needed. Everything can be existing."

   WHAT THIS REPLACED. A "car-resale yard": you paid a deposit, drove a car
   onto a marker and it VANISHED into a list, and an HTML panel sold rows of
   that list ("[1-9] sell, F+# recondition, 0 sell all, L launder"), with a
   police raid that deleted half the rows. The cars in it were nowhere.

   NOW it is a trade you do standing at the dealer with the car outside:
     - Drive a car to Premium Autos and get out. The salesman (the dealer's
       own clerk, city/shops.js's rows on him) looks at THAT car, the one
       you came in, standing outside his door:
         Sell him the <car> $X   he takes it round the back; the notes come
                                 across in his hand
         Recondition it $Y       his shop puts the damage right first (the
                                 real car is repaired), which is the spread
         What's selling          he tells you which model is moving and which
                                 one the lot is drowning in
         Wash $N through the books   dirty cash behind what you have sold him
     - The price is the car: its model's value, its real damage (condition is
       read off the car, it is not a number in a row), whether it is hot,
       the per-model market (one model is in demand for a while; dumping the
       same model floods its price), your turf, and whether you own the lot.
     - There is no yard, no stock list and no raid on a list. A car you want
       to hold for a better week is a car you keep: at your house, in a
       garage you own (city/storage.js), where you parked it.

   Exposes: CBZ.cityEmpire { offer, sell, recondition, launder, resaleOf,
   conditionOf, state } (wealth.js adds bizValue/laundromats for
   economy.js), CBZ.cityEmpireReset.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const g = CBZ.game;

  // ---- balance knobs --------------------------------------------------------
  const RESALE = 0.62, RESALE_OWN = 0.74;   // what he pays against clean value; better if the lot is yours
  const HOT_FACTOR = 0.86;       // a stolen car has no clean title
  const RECON_COST = 0.22;       // recondition fee = this x clean value, scaled by the damage
  const LAUNDER_PER_SALE = 4500; // dirty cash one legit-looking sale can hide (base)
  const FLOOD_STEP = 0.16;       // how hard selling a model floods its price
  const MKT_REVERT = 0.06;       // pull back to fair value, per second
  const MKT_VOL = 0.05;          // random walk, per second
  const AT_DOOR = 22;            // the car has to be standing this near the dealer's door

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function money(n) { return "$" + (Math.max(0, n | 0)).toLocaleString("en-US"); }
  function rng() { return (CBZ.cityEcon && CBZ.cityEcon.rng) ? CBZ.cityEcon.rng() : Math.random(); }
  function biz() {
    return g.cityCarBiz || (g.cityCarBiz = { mkt: {}, hotModel: null, hotT: 0, hotBonus: 0, launderCredit: 0, sold: 0 });
  }
  function say(v, text, secs) {
    if (v && !v.dead && CBZ.citySay) { try { CBZ.citySay(v, text, null, { secs: secs || 3, force: true }); return; } catch (e) {} }
    if (CBZ.city && CBZ.city.note) CBZ.city.note(text, 2.2);
  }

  // ---- the per-model market ---------------------------------------------------
  function mktLevel(name) { const m = biz().mkt || (biz().mkt = {}); const v = m[name]; return (v == null || !isFinite(v)) ? 1 : v; }
  function setMkt(name, v) { const b = biz(); if (!b.mkt) b.mkt = {}; b.mkt[name] = clamp(v, 0.45, 2.6); }
  function isHot(name) { const b = biz(); return b.hotModel === name && (b.hotT || 0) > 0; }
  function demandMul(name) {
    let m = mktLevel(name);
    if (isHot(name)) m *= 1.0 + (biz().hotBonus || 0.45);
    return clamp(m, 0.45, 2.9);
  }
  // how much of the city your gang holds: a better price, more room to wash
  function turfFrac() {
    try {
      const pg = g.playerGang;
      if (!pg || !pg.founded || !CBZ.cityZones) return 0;
      const zones = CBZ.cityZones(); if (!zones || !zones.length) return 0;
      let mine = 0; for (const z of zones) if (z.owner === pg.id) mine++;
      return clamp(mine / zones.length, 0, 1);
    } catch (e) { return 0; }
  }

  // ---- the car itself ---------------------------------------------------------
  // 1.0 = pristine, down to 0.45 = a wreck that still rolls: read off the car
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
  function modelOf(car) { return (car && car.model) || { name: "Sedan", value: 3000 }; }
  function resaleOf(car, lot) {
    const m = modelOf(car);
    const owns = !!(lot && CBZ.cityOwnsLot && CBZ.cityOwnsLot(lot));
    const v = (m.value || 0) * (owns ? RESALE_OWN : RESALE) * (1 + turfFrac() * 0.18) *
      demandMul(m.name) * conditionOf(car) * (car.owned ? 1 : HOT_FACTOR);
    return Math.max(1, Math.round(v));
  }
  function reconCost(car) {
    const gap = 1 - conditionOf(car);
    return Math.max(1, Math.round((modelOf(car).value || 0) * RECON_COST * (0.4 + gap)));
  }

  // ---- the car you came in ----------------------------------------------------
  let lastCar = null;
  function doorOf(lot) { return lot && lot.building && lot.building.door; }
  function offer(lot) {
    const c = lastCar, d = doorOf(lot), P = CBZ.player;
    if (!c || !d || c.dead || !c.pos || !c.group || !c.group.parent) return null;
    if (CBZ.cityCars.indexOf(c) < 0 || (P && P._vehicle === c)) return null;
    if ((c.model && c.model.body === "boat") || (c._playerCarFeel && c._playerCarFeel.marine) || c._emergency || c._propParked) return null;   // he sells cars, and not the city's
    if (Math.hypot(c.pos.x - d.x, c.pos.z - d.z) > AT_DOOR) return null;
    return c;
  }

  // ---- the trade ----------------------------------------------------------------
  function handCash(v, then) {
    const V = CBZ.verbs;
    let S0 = null, done = false;
    const fin = function () { if (done) return; done = true; then(); };
    if (v) v._faceT = Math.max(v._faceT || 0, 1.6);
    if (v && V && V.takeFrom) { try { S0 = V.takeFrom(CBZ.player, v, { at: "wristR", kind: "cash", pose: "card", dur: 0.55, onTaken: fin }); } catch (e) { S0 = null; } }
    if (!S0) fin();
  }
  function sell(v, lot) {
    const car = offer(lot); if (!car) return false;
    const b = biz(), m = modelOf(car), pay = resaleOf(car, lot);
    // the car leaves the street: it is his now
    if (car.group && car.group.parent) car.group.parent.remove(car.group);
    const idx = CBZ.cityCars.indexOf(car); if (idx >= 0) CBZ.cityCars.splice(idx, 1);
    car.dead = true;
    if (lastCar === car) lastCar = null;
    b.sold = (b.sold || 0) + 1;
    // dumping a model floods its price here; legit-looking volume is what hides dirty cash
    const cur = mktLevel(m.name);
    setMkt(m.name, cur - FLOOD_STEP * (0.5 + 0.5 * cur));
    const cap = LAUNDER_PER_SALE * (1 + turfFrac() * 1.5);
    b.launderCredit = Math.min(cap * 6, (b.launderCredit || 0) + Math.min(cap, pay * 0.6));
    say(v, "Sold. " + money(pay) + " for the " + m.name + ".");
    handCash(v, function () {
      CBZ.city.addCash(pay); CBZ.city.addRespect(2);
      if (CBZ.sfx) CBZ.sfx("coin");
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    });
    return true;
  }
  function recondition(v, lot) {
    const car = offer(lot); if (!car) return false;
    if (conditionOf(car) >= 0.95) { say(v, "Nothing to fix on that one."); return false; }
    const cost = reconCost(car);
    if (!CBZ.city.spend(cost)) { say(v, "The shop wants " + money(cost) + " for that."); return false; }
    if (v) v.cash = (v.cash | 0) + cost;
    // the real car is put right
    car.engineHp = 100; car._smoking = false; car.crumple = 0;
    if (car._onFire && CBZ.cityCarExtinguish) { try { CBZ.cityCarExtinguish(car); } catch (e) {} }
    if (CBZ.cityCarUncrumple) { try { CBZ.cityCarUncrumple(car); } catch (e) {} }
    if (CBZ.sfx) CBZ.sfx("coin");
    say(v, "Good as it left the factory. That's " + money(resaleOf(car, lot)) + " now.");
    return true;
  }
  function whatSells(v) {
    const b = biz();
    let low = null, lv = 0.85;
    for (const k in b.mkt) if (b.mkt[k] < lv) { lv = b.mkt[k]; low = k; }
    let line = (b.hotModel && b.hotT > 0) ? "Everybody wants a " + b.hotModel + " this week. Bring me one."
      : "Nothing special moving. Clean ones always sell.";
    if (low) line += " I can't shift another " + low + ".";
    say(v, line, 3.6);
  }
  // DIRTY CASH BEHIND THE SALES. What you may wash is capped by what you have
  // sold him (launderCredit); the cut is economy.js's, turf hands a little back.
  function washable() { return Math.floor(Math.min(biz().launderCredit || 0, g.cash || 0)); }
  function launder(v) {
    const b = biz(), amount = washable();
    if (amount < 100) { say(v, "Sell me something first. I can't hide money behind nothing."); return false; }
    if (!(CBZ.cityEcon && CBZ.cityEcon.launder)) return false;
    const r = CBZ.cityEcon.launder(amount);
    const rebate = Math.round((r.lost || 0) * Math.min(0.4, turfFrac() * 0.6));
    if (rebate > 0) g.cityBank = (g.cityBank || 0) + rebate;
    b.launderCredit = Math.max(0, (b.launderCredit || 0) - amount);
    if (g.cityWealthLog) g.cityWealthLog.laundered = (g.cityWealthLog.laundered || 0) + (r.banked || 0) + rebate;
    if (CBZ.sfx) CBZ.sfx("coin");
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    say(v, money((r.banked || 0) + rebate) + " of it is in your account, as sales. The rest is my trouble.", 3.4);
    return true;
  }

  // ---- what the salesman does for you (city/shops.js asks, every row build) ----
  (CBZ._counterAsks || (CBZ._counterAsks = [])).push(function (v, lot, kind, add) {
    if (kind !== "carlot") return;
    const car = offer(lot);
    if (car) {
      const m = modelOf(car);
      add("trade-sell", "Sell him the " + m.name + " " + money(resaleOf(car, lot)), function (vv) { sell(vv, lot); },
        condWord(conditionOf(car)) + (car.owned ? "" : ", hot") + (isHot(m.name) ? ", in demand" : ""));
      if (conditionOf(car) < 0.95) add("trade-recon", "Recondition it " + money(reconCost(car)), function (vv) { recondition(vv, lot); });
    }
    add("trade-market", "What's selling", function (vv) { whatSells(vv); });
    if (washable() >= 100) add("trade-wash", "Wash " + money(washable()) + " through the books", function (vv) { launder(vv); });
  });

  // ---- the car you drove last, and the market's drift ---------------------------
  CBZ.onUpdate(38.9, function (dt) {
    if (g.mode !== "city") return;
    const P = CBZ.player;
    if (P && P.driving && P._vehicle) lastCar = P._vehicle;
    const b = biz();
    for (const k in b.mkt) {
      const lv = b.mkt[k];
      if (!isFinite(lv)) { b.mkt[k] = 1; continue; }
      b.mkt[k] = clamp(lv + (1 - lv) * MKT_REVERT * dt + (rng() - 0.5) * MKT_VOL * dt, 0.45, 2.6);
    }
    // one model is in demand for a while: he tells you if you ask
    b.hotT = (b.hotT || 0) - dt;
    if (b.hotT <= 0) {
      const CARS = (CBZ.cityEcon && CBZ.cityEcon.CARS) || [];
      if (CARS.length && rng() < dt * 0.05) {
        const pick = CARS[(rng() * CARS.length) | 0];
        b.hotModel = pick.name; b.hotT = 60 + rng() * 90; b.hotBonus = 0.35 + rng() * 0.4;
        setMkt(pick.name, mktLevel(pick.name) + 0.3);
      } else b.hotModel = null;
    }
  });

  CBZ.cityEmpireReset = function () { g.cityCarBiz = null; lastCar = null; biz(); };

  CBZ.cityEmpire = {
    offer: offer, sell: sell, recondition: recondition, launder: launder, whatSells: whatSells,
    resaleOf: resaleOf, conditionOf: conditionOf,
    state: function () { return biz(); },
  };
})();
