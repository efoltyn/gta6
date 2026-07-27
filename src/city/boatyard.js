/* ============================================================
   city/boatyard.js — THE BROKERAGE: buying, owning and anchoring a boat.

   OWNER WANT: "YACHTS to be buildable and buyable."

   THE STATE OF PLAY BEFORE THIS FILE
   ----------------------------------
   There was NO boat purchase path anywhere in the game. The only boats in the
   world were three free hulls moored in the east-harbour gap that you jack.
   wealth.js used to "sell" a $4,000,000 Superyacht — a boolean in g.cityLuxury
   with no mesh, no spawn and no net-worth contribution. That catalog is GONE
   (see the NO-FICTION NOTE at wealth.js:346-359, which deleted the whole
   LUXURY[] array); CLAUDE.md:329 still cites it and is stale.

   THE RULE THIS FILE OBEYS: **if you can buy it, it has a hull.** The dealer's
   catalog is DERIVED from CBZ.marineHulls (WP-2's hull registry). If that
   registry is not loaded, the brokerage sells exactly ONE boat — the runabout
   that playercars.js makeBoat() actually renders — because that is the only
   hull that exists. We never list a yacht we cannot float.

   WHAT IS *NOT* NEW HERE (the point of the block law)
   ---------------------------------------------------
   · The transaction is zillow.js's buy()/financeBuy() shape, not a 7th buy
     pattern: charge cash-then-bank for the outright sale, and 20% down + the
     REAL loan engine (CBZ.cityBankLoan, purpose "auto") for the financed one.
     If the loan engine is absent, financing is simply unavailable — we do NOT
     author a second amortization ledger.
   · Ownership persists with ZERO new save schema. A bought boat is a
     `g.cityGarage` record (`{name, marine:true, key, berthId, ...}`).
     worldstate.js commit() already mirrors g.cityGarage and w.assets.vehicles
     every ~5s, and economy.js holdingsWorth() already loops g.cityGarage,
     resolves carByName() and adds value*0.85 to NET WORTH. Both work for free.
   · The hull spawns through CBZ.citySpawnOwnedCar — the one owned-vehicle
     spawn path — with marina.js's CBZ.cityBerth choosing the water.
   · Boarding needs nothing: boats are CBZ.cityCars records, so they already
     ride the "vehicle" interaction layer and inherit Get in / Boost it /
     Step out from interact.js:1119.

   WHAT *IS* NEW (and had to be)
   -----------------------------
   · A BERTH — a water-side retrieval spot. Every garage spot in the game is on
     land; a retrieved boat would spawn beached. marina.js owns the registry;
     this file owns which berth is YOURS.
   · RUNNING COSTS. Research §H: a boat costs ~10% of its purchase price per
     year, and berth fees are charged per foot of LOA. Buying is the entry fee,
     HOLDING is the sink. Wired into wealth.js's EXISTING passive tick — no
     parallel timer. Arrears accrue; we never repossess (see RISKS below).
   · ANCHORING. Cheap and credible (§I): swing circle = depth x scope, a slow
     heading spring into the current, and a drag check only when load crosses a
     threshold. No chain simulation, ever.

   FLAGS (one-line revert each; config.js is off-limits so they live here):
     CBZ.CONFIG.BOAT_DEALER  (true) — the brokerage and ownership
     CBZ.CONFIG.BOAT_UPKEEP  (true) — daily berth fees / running costs
     CBZ.CONFIG.BOAT_ANCHOR  (true) — the anchor verb and swing circle

   Exposes: CBZ.boatOwned, CBZ.boatBuy, CBZ.boatBerth, CBZ.boatFleet,
            CBZ.cityBoatyard, CBZ.cityOpenBoatyard, CBZ.cityBoatUpkeepTick,
            CBZ.boatAnchorToggle, CBZ.boatAnchored.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;
  const C = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (C.BOAT_DEALER == null) C.BOAT_DEALER = true;
  if (C.BOAT_UPKEEP == null) C.BOAT_UPKEEP = true;
  if (C.BOAT_ANCHOR == null) C.BOAT_ANCHOR = true;

  const M_PER_FT = 0.3048;
  const UPKEEP_YEAR_FRAC = 0.10;     // §H: running costs ~10% of price per year
  const BERTH_PER_FT_DAY = 1.25;     // §H: berth fees are charged per foot of LOA
  const SELL_FRAC = 0.70;            // brokerage takes its cut on the way out
  const DOWN_FRAC = 0.20;            // zillow.js's financeBuy convention

  function money(n) { n = Math.round(n || 0); return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(); }
  function note(m, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(m, s); }
  function big(m) { if (CBZ.city && CBZ.city.big) CBZ.city.big(m); }
  function sfx(n) { if (CBZ.sfx) { try { CBZ.sfx(n); } catch (e) {} } }
  function econ() { return CBZ.cityEcon || null; }
  function bankLoan() { return CBZ.cityBankLoan || null; }
  function commit() { if (CBZ.cityWorldCommit) { try { CBZ.cityWorldCommit(); } catch (e) {} } }

  // cash first, then bank — the chargeCashThenBank convention shared by
  // zillow.js charge(), realestate.js buyHangar(), wealth.js and storage.js.
  function canAfford(amt) { return ((g.cash || 0) + (g.cityBank || 0)) >= amt; }
  function charge(amt) {
    amt = Math.round(amt);
    if (!canAfford(amt)) return false;
    let owe = amt; const fromCash = Math.min(g.cash || 0, owe);
    g.cash = (g.cash || 0) - fromCash; owe -= fromCash;
    if (owe > 0) g.cityBank = Math.max(0, (g.cityBank || 0) - owe);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    commit();
    return true;
  }

  /* ============================================================
     1) THE CATALOG — derived from WP-2's hull registry.
     ------------------------------------------------------------
     Every entry MUST resolve to a model the game can actually build. We bridge
     each hull into economy.js's SPECIAL_VEHICLES (a LIVE array reference on
     CBZ.cityEcon — the contract says PUSH, never edit economy.js) so that:
       · CBZ.citySpawnOwnedCar(x, z, name) can build it,
       · carByName(name) resolves for economy.js holdingsWorth() — which is
         what makes a bought boat show up in NET WORTH with no new code,
       · playercars.js inferStyle()/marineHulls.styleFor() picks its mesh.
     Nothing random draws from SPECIAL_VEHICLES, so pushing is determinism-safe
     (the car-hull harness only validates CARS).
     ============================================================ */
  // Fictional marques, in the register of the existing fleet (Falcone / Bison /
  // Voltra / Adler / Kotori / Vitesse). Used only to NAME hulls WP-2 registered
  // without a label, and to price a hull that shipped without one.
  const PRICE_BANDS = [
    // [maxLOA, low, high]  — research §H, USD
    [3.9, 8000, 22000],          // jetski / PWC
    [5.2, 30000, 150000],        // RIB / tender
    [8.0, 30000, 120000],        // runabout / bowrider
    [12.5, 150000, 1200000],     // centre console
    [17.0, 1500000, 4000000],    // sport cruiser
    [24.0, 5000000, 12000000],   // flybridge yacht
    [1e9, 12000000, 30000000],   // entry superyacht
  ];
  function priceForLoa(loa) {
    for (const b of PRICE_BANDS) {
      if (loa <= b[0]) {
        const t = Math.max(0, Math.min(1, loa / b[0]));      // where in the band she sits
        return Math.round((b[1] + (b[2] - b[1]) * t) / 500) * 500;
      }
    }
    return 25000000;
  }

  let _catalog = null, _catalogSolo = false;
  function catalog() {
    // Rebuild once if WP-2's hull registry showed up after we fell back to the
    // single runabout (script order / lazy load) — otherwise the yard would be
    // stuck selling one boat forever.
    if (_catalog && _catalogSolo && CBZ.marineHulls && CBZ.marineHulls.list) _catalog = null;
    if (_catalog) return _catalog;
    // Never CACHE a catalog built before economy.js is live — bridgeModel()
    // would strike every hull and the yard would be permanently empty.
    if (!econ() || !econ().carByName) return [];
    const out = [];
    const R = CBZ.marineHulls;
    if (R && R.list) {
      try {
        for (const rec of R.list()) {
          // water_hulls.js records carry the authored `hull` block AND a
          // derived `spec`; read either so we survive a shape change.
          const h = rec && (rec.hull || rec.spec);
          if (!h || !isFinite(h.loa)) continue;
          const loa = +h.loa || 6.2, beam = +h.beam || 2.1;
          out.push({
            key: rec.key, label: rec.label || rec.key,
            loa: loa, beam: beam, draft: +h.draft || 0.5,
            topKts: +h.topKts || 0, massT: +h.massT || 0,
            price: Math.round(+rec.price || priceForLoa(loa)),
            // water_hulls.js already publishes rec.model as the economy
            // catalog name (it pushes them into SPECIAL_VEHICLES itself), so
            // take it directly — bridgeModel() only has to fill gaps.
            model: rec.model || null,
          });
        }
      } catch (e) {}
    }
    if (!out.length) {
      // NO REGISTRY -> ONE HULL. playercars.js makeBoat() is a 6.2m x 2.1m
      // runabout and it is the only marine mesh that exists. Selling a "yacht"
      // here would be exactly the stat fiction this repo just deleted.
      const m = econ() && econ().carByName ? econ().carByName("Speedboat") : null;
      out.push({
        key: "runabout", label: "Speedboat", loa: 6.2, beam: 2.1, draft: 0.5,
        topKts: 45, massT: 1.6, price: m && m.value ? m.value : 15000, model: "Speedboat",
        soloFallback: true,
      });
    }
    out.sort(function (a, b) { return a.price - b.price; });
    _catalogSolo = out.length === 1 && !!out[0].soloFallback;
    _catalog = out;
    // Bridge EVERY entry into the economy catalog up front, not lazily at the
    // moment of sale: SPECIAL_VEHICLES is a shared live array and it must end
    // up the same length and order on every client, not depend on what this
    // player happened to browse. Nothing random draws from it, so pushing is
    // determinism-safe (the car-hull harness only validates CARS).
    // A hull we CANNOT build is struck from the list — we never take money for
    // something with no mesh. That is the stat-fiction rule, enforced.
    for (let i = out.length - 1; i >= 0; i--) if (!bridgeModel(out[i])) out.splice(i, 1);
    return out;
  }

  // STRICT model resolution. economy.js:1155's carByName() ends `|| CARS[0]`:
  // it NEVER returns null — an unknown name comes back as an arbitrary ROAD
  // CAR. Every `if (carByName(x))` guard is therefore unconditionally true, and
  // that is not a style nit: it is the path where the yard takes $24M for a
  // superyacht, hands the name to citySpawnOwnedCar(), and floats you a
  // hatchback. Money gone, no hull — precisely the stat fiction this repo
  // banned. So we only ever accept a resolution that is genuinely the thing we
  // asked for: the same name back, or at least a marine hull (which covers
  // economy.js's CAR_NAME_ALIASES mapping an old string onto a real boat).
  function resolveModel(name) {
    const e = econ();
    if (!e || !e.carByName || !name) return null;
    let m = null;
    try { m = e.carByName(name); } catch (err) { return null; }
    if (!m) return null;
    if (m.name === name) return m;
    if (m.body === "boat" || m.detailStyle === "boat") return m;
    return null;                       // carByName fell through to CARS[0]
  }

  // Make sure a catalog entry has a model NAME that carByName() resolves.
  // Returns the name, or null if we truly cannot build it (then it is not for
  // sale — we never take money for something with no hull).
  function bridgeModel(entry) {
    const e = econ();
    if (!e || !e.carByName) return null;
    // A model name water_hulls.js gave us still has to RESOLVE — if its
    // economy push was flagged off (CBZ.CONFIG.BOAT_ECONOMY) the name is real
    // but carByName() knows nothing about it, and we would spawn a random car.
    if (entry.model && resolveModel(entry.model)) return entry.model;
    if (entry.model) entry.model = null;
    // 1) WP-2 may already have registered it under its label or key.
    for (const cand of [entry.label, entry.key]) {
      if (!cand) continue;
      const m = resolveModel(cand);
      if (m && (m.body === "boat" || m.detailStyle === "boat")) { entry.model = m.name || cand; return entry.model; }
    }
    // 2) Otherwise bridge it into SPECIAL_VEHICLES ourselves (push, never edit).
    const SV = e.SPECIAL_VEHICLES;
    if (Array.isArray(SV)) {
      const name = entry.label;
      if (name && !resolveModel(name)) {
        SV.push({
          name: name, value: entry.price, rarity: 0.5,
          color: 0xeceff2, s: 1.0,
          body: "boat", detailStyle: "boat", designStyle: entry.key || "speedboat",
        });
      }
      if (resolveModel(name)) { entry.model = name; return name; }
    }
    // 3) Last resort: the one hull we know exists.
    if (resolveModel("Speedboat")) { entry.model = "Speedboat"; return "Speedboat"; }
    return null;
  }

  function entryByKey(k) { for (const e of catalog()) if (e.key === k) return e; return null; }
  function entryByModel(name) {
    for (const e of catalog()) { if (e.model === name || e.label === name) return e; }
    return null;
  }

  /* ============================================================
     2) OWNERSHIP — a boat IS a g.cityGarage record. Zero new save schema.
     ------------------------------------------------------------
     { name, marine:true, key, label, price, berthId, boughtAt, arrears }
     worldstate.js commit() does `w.cityGarage = g.cityGarage.slice()` — a
     shallow copy, so every extra field above survives the JSON round-trip, and
     hydrate hands it straight back. Nothing else has to know boats exist.
     ============================================================ */
  function garage() { g.cityGarage = g.cityGarage || []; return g.cityGarage; }
  function fleet() {
    return garage().filter(function (r) { return r && typeof r === "object" && r.marine; });
  }
  function owned(key) {
    for (const r of fleet()) if (r.key === key) return r;
    return null;
  }
  function ownedByModel(name) {
    for (const r of fleet()) if (r.name === name) return r;
    return null;
  }
  // The live hull for an owned record, if it is currently in the world.
  function liveHull(rec) {
    if (!rec || !CBZ.cityCars) return null;
    for (const c of CBZ.cityCars) {
      if (c && !c.dead && c._boatKey === rec.key) return c;
    }
    return null;
  }

  /* ---- the berth: where YOUR boat sits ---------------------------------- */
  function B() { return CBZ.cityBerth || null; }
  function berthOf(rec) {
    const b = B(); if (!b || !rec) return null;
    let berth = rec.berthId ? b.byId(rec.berthId) : null;
    if (!berth) {
      berth = b.free(rec.loa, rec.beam) || b.nearest(0, 0);
      if (berth) { rec.berthId = berth.id; commit(); }
    }
    if (berth) b.claim(berth, rec.key);
    return berth;
  }
  // consumed by marina.js's citySpawnOwnedCar wrapper: a boat you OWN goes
  // back to ITS berth, not to whatever slot is empty.
  function berthForModel(modelName) {
    const rec = ownedByModel(modelName);
    return rec ? berthOf(rec) : null;
  }

  /* ---- putting a hull in the water -------------------------------------- */
  // INVARIANT: at most ONE live hull per owned record. This is what stops the
  // duplication exploit if some other system (e.g. realestate.js retrieveCar,
  // which pops the LAST g.cityGarage entry and cannot know it is a boat) tries
  // to "retrieve" a boat that is already floating.
  function deliver(rec, opts) {
    if (!rec) return null;
    // Make sure the SPECIAL_VEHICLES bridge is installed BEFORE we ask
    // citySpawnOwnedCar for this model: after a reload the fleet comes back
    // from the save but nothing has touched the catalog yet, and an
    // unresolvable name would hand us a random CAR hull for a yacht.
    catalog();
    const live = liveHull(rec);
    if (live) {
      if (opts && opts.mark && CBZ.fullMap && CBZ.fullMap.setWaypoint) CBZ.fullMap.setWaypoint(live.pos.x, live.pos.z, rec.label || rec.name);
      return live;
    }
    const berth = berthOf(rec);
    const b = B();
    let car = null;
    if (berth && b && b.spawn) car = b.spawn(berth, rec.name, { key: rec.key });
    else if (CBZ.citySpawnOwnedCar) car = CBZ.citySpawnOwnedCar(berth ? berth.x : 0, berth ? berth.z : 0, rec.name);
    if (!car) return null;
    car._boatKey = rec.key;
    car._boatRec = rec;                 // reconcile() reads this back (see below)
    car.owned = true; car.stolen = false; car.ai = false;
    if (rec.color != null) car.color = rec.color;
    if (opts && opts.mark && CBZ.fullMap && CBZ.fullMap.setWaypoint) CBZ.fullMap.setWaypoint(car.pos.x, car.pos.z, rec.label || rec.name);
    return car;
  }

  // SELF-HEAL. realestate.js retrieveCar() does `g.cityGarage.pop()` with no
  // idea a boat might be in there; if it pops one, the record would vanish and
  // the player would lose a paid-for asset. We re-insert any owned key whose
  // record went missing while its hull is still afloat. Cheap, and it makes
  // losing a boat to an unrelated menu press impossible.
  function reconcile() {
    if (!CBZ.cityCars) return;
    for (const c of CBZ.cityCars) {
      if (!c || c.dead || !c._boatRec) continue;
      if (garage().indexOf(c._boatRec) < 0) { garage().push(c._boatRec); commit(); }
    }
  }

  /* ============================================================
     3) THE TRANSACTION — zillow.js's buy() / financeBuy(), reused.
     ============================================================ */
  function priceOf(entry) { return Math.round(entry.price); }

  function record(entry, modelName, paid) {
    return {
      name: modelName,                 // what carByName()/citySpawnOwnedCar() resolve
      marine: true,
      key: entry.key,
      label: entry.label,
      price: priceOf(entry),
      loa: entry.loa, beam: entry.beam,
      berthId: null,
      boughtAt: paid,
      arrears: 0,
    };
  }

  function finish(rec, entry, headline) {
    garage().push(rec);
    const car = deliver(rec, { mark: true });
    if (car) car._boatRec = rec;
    if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(Math.max(1, Math.min(40, Math.round(rec.price / 250000) + 2)));
    big(headline);
    const berth = berthOf(rec);
    note(rec.label + " is in the water at " + (berth ? (berth.label || berth.id) : "the marina") + ". Upkeep runs " + money(dailyCost(rec)) + "/day.", 4.2);
    sfx("coin");
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    commit();
    if (open_) render();
  }

  function buy(key) {
    if (C.BOAT_DEALER === false) return false;
    const entry = entryByKey(key);
    if (!entry) { flash("That hull isn't on the books.", "bad"); return false; }
    if (owned(key)) { flash("You already own the " + entry.label + ".", "bad"); if (open_) render(); return false; }
    const modelName = bridgeModel(entry);
    if (!modelName) { flash("The yard can't put that hull in the water yet.", "bad"); return false; }
    const price = priceOf(entry);
    if (!canAfford(price)) {
      flash("Need " + money(price) + " cash + bank to close. Try financing.", "bad");
      note("Need " + money(price) + " to close on the " + entry.label + ".", 2.4); sfx("empty");
      if (open_) render(); return false;
    }
    if (!charge(price)) return false;
    finish(record(entry, modelName, price), entry, "Bought the " + entry.label);
    return true;
  }

  // FINANCED BUY — zillow.js financeBuy()'s shape: 20% down out of pocket, the
  // remainder underwritten by the REAL loan engine (bank.js, purpose "auto",
  // which owns rate/term/amortization/auto-pay against g.cityLoans). If the
  // engine is not wired we do NOT fall back to a hand-rolled ledger — that
  // would be exactly the parallel bookkeeping the block law forbids. The yard
  // just says it's a cash sale today.
  function financeBuy(key) {
    if (C.BOAT_DEALER === false) return false;
    const entry = entryByKey(key);
    if (!entry) return false;
    if (owned(key)) { flash("You already own the " + entry.label + ".", "bad"); return false; }
    const bl = bankLoan();
    if (!bl || !bl.offer || !bl.take) { flash("No marine finance desk today — cash sale only.", "bad"); return false; }
    const modelName = bridgeModel(entry);
    if (!modelName) { flash("The yard can't put that hull in the water yet.", "bad"); return false; }
    const price = priceOf(entry);
    const down = Math.round(price * DOWN_FRAC / 500) * 500;
    const principal = Math.max(0, price - down);
    if (!canAfford(down)) { flash("Need " + money(down) + " down to finance.", "bad"); sfx("empty"); if (open_) render(); return false; }
    const offer = bl.offer("auto", principal, { kind: "auto", value: price, down: down, vessel: entry.key, loa: entry.loa });
    if (!offer || !offer.approved) {
      const why = (offer && offer.reason) ? offer.reason : "the bank declined the marine loan";
      flash("Declined — " + why + ".", "bad"); note("Marine finance declined: " + why + ".", 2.4); sfx("empty");
      if (open_) render(); return false;
    }
    if (!charge(down)) return false;
    const loanId = bl.take(offer);
    if (loanId == null) {
      // The engine took the down but could not book the note. Refund the down
      // rather than hand over a boat we did not finance — no silent free hull,
      // no silent lost cash.
      g.cash = (g.cash || 0) + down;
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
      flash("The note wouldn't book — your deposit is back.", "bad"); commit();
      if (open_) render(); return false;
    }
    const rec = record(entry, modelName, down);
    rec.loanId = loanId;
    finish(rec, entry, "Financed the " + entry.label);
    note(money(down) + " down · " + money(offer.principal != null ? offer.principal : principal) + " on the note.", 3);
    return true;
  }

  function sell(key) {
    const rec = owned(key);
    if (!rec) return false;
    const back = Math.round(rec.price * SELL_FRAC);
    const live = liveHull(rec);
    if (live) {
      if (CBZ.player && CBZ.player._vehicle === live && CBZ.cityExitVehicle) CBZ.cityExitVehicle();
      if (live.group && live.group.parent) live.group.parent.remove(live.group);
      if (CBZ.cityCars) { const i = CBZ.cityCars.indexOf(live); if (i >= 0) CBZ.cityCars.splice(i, 1); }
      live._boatRec = null;                       // so reconcile() can't resurrect it
    }
    const b = B(); if (b && rec.berthId) b.release(rec.berthId);
    const gi = garage().indexOf(rec); if (gi >= 0) garage().splice(gi, 1);
    if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(back);
    big("Sold the " + rec.label + " — " + money(back));
    if (rec.loanId != null) note("The note on her is still yours. The bank doesn't care who owns the hull.", 3);
    sfx("coin"); commit();
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    if (open_) render();
    return true;
  }

  /* ============================================================
     4) RUNNING COSTS — the sink. Wired into wealth.js's EXISTING tick.
     ------------------------------------------------------------
     §H: running costs ~10% of purchase price per YEAR; berth fees per FOOT of
     LOA. Charged once per in-game DAY (CBZ.dayCount) so it is a felt rhythm,
     not a per-frame drip. Insufficient funds accrue ARREARS — we never seize
     the boat (see RISKS in the report).
     ============================================================ */
  function berthFeeOf(rec) { return Math.round((rec.loa || 6.2) / M_PER_FT * BERTH_PER_FT_DAY); }
  function dailyCost(rec) {
    const running = (rec.price || 0) * UPKEEP_YEAR_FRAC / 365;
    return Math.max(berthFeeOf(rec), Math.round(running));
  }
  function fleetDaily() { let s = 0; for (const r of fleet()) s += dailyCost(r); return Math.round(s); }
  function totalArrears() { let s = 0; for (const r of fleet()) s += (r.arrears || 0); return Math.round(s); }

  let _lastDay = null, _arrearNag = 0;
  // Called from wealth.js's onUpdate(41) passive tick — NOT a parallel timer.
  function upkeepTick(dt) {
    if (C.BOAT_UPKEEP === false) return;
    const f = fleet(); if (!f.length) { _lastDay = null; return; }
    const day = CBZ.dayCount ? CBZ.dayCount() : null;
    if (day == null) return;
    if (_lastDay == null) { _lastDay = day; return; }
    if (day <= _lastDay) { if (day < _lastDay) _lastDay = day; return; }   // a reset day rolls back cleanly
    const days = Math.min(7, day - _lastDay);                              // never bill a whole skipped week
    _lastDay = day;
    let billed = 0, unpaid = 0;
    for (const r of f) {
      const due = dailyCost(r) * days + (r.arrears || 0);
      if (charge(due)) { r.arrears = 0; billed += due; }
      else { r.arrears = Math.round(due); unpaid += due; }
    }
    if (billed > 0) note("Harbour dues: " + money(billed) + " for " + f.length + " berth" + (f.length === 1 ? "" : "s") + ".", 2.2);
    if (unpaid > 0) {
      _arrearNag -= 1;
      if (_arrearNag <= 0) { _arrearNag = 3; note("The harbourmaster wants " + money(totalArrears()) + " in back dues.", 3); }
    }
    commit();
  }
  function payArrears() {
    const owe = totalArrears();
    if (owe <= 0) { note("You're square with the harbourmaster.", 1.8); return false; }
    if (!charge(owe)) { flash("Need " + money(owe) + " to clear the dues.", "bad"); sfx("empty"); return false; }
    for (const r of fleet()) r.arrears = 0;
    flash("Back dues cleared — " + money(owe) + ".", "ok"); sfx("coin"); commit();
    if (open_) render();
    return true;
  }

  /* ============================================================
     5) ANCHORING (§I) — swing circle, heading spring, rare drag check.
     ------------------------------------------------------------
     NO chain simulation. radius = depth x scope (5:1 is the fine constant;
     4:1 calm, 7:1 rough), the hull is constrained inside it, and the heading
     resolves into the current with a slow spring. Med-mooring is the same
     line-attachment logic rotated 90 degrees, so there is no special case.
     ============================================================ */
  const SCOPE_CALM = 4, SCOPE_NORM = 5, SCOPE_ROUGH = 7;
  function isMarineCar(car) {
    if (!car) return false;
    if (car._hullSpec) return true;
    if (car._playerCarFeel && car._playerCarFeel.marine) return true;
    return !!(car.model && (car.model.body === "boat" || car.model.detailStyle === "boat"));
  }
  function anchored(car) { return !!(car && car._anchor); }

  function anchorToggle(car) {
    if (C.BOAT_ANCHOR === false) return false;
    car = car || (CBZ.player && CBZ.player._vehicle);
    if (!isMarineCar(car)) return false;
    if (car._anchor) {
      car._anchor = null;
      if (car._anchorLight) { if (car._anchorLight.parent) car._anchorLight.parent.remove(car._anchorLight); car._anchorLight = null; }
      note("Anchor up — you have way on.", 1.8); sfx("clank");
      return true;
    }
    const x = car.pos.x, z = car.pos.z;
    if (!(CBZ.cityWaterAt && CBZ.cityWaterAt(x, z))) { note("Nothing to anchor into here.", 1.6); return false; }
    const depth = CBZ.cityWaterDepthAt ? Math.max(1.2, CBZ.cityWaterDepthAt(x, z)) : 4;
    if (depth > 45) { note("Too deep to anchor — you'd never get the rode back.", 2.2); return false; }
    // rough water wants more scope. The swell amplitude is the cheapest proxy
    // we have for "how rough is it" and it costs one call.
    let rough = 0;
    if (CBZ.waterWaveHeight) { try { rough = Math.abs(CBZ.waterWaveHeight(x, z)); } catch (e) {} }
    const scope = rough > 0.55 ? SCOPE_ROUGH : (rough < 0.18 ? SCOPE_CALM : SCOPE_NORM);
    // HOLDING GROUND as a hidden per-area quality (sand/mud good, rock poor).
    // Position-hashed so the same patch of seabed always holds the same.
    const hold = 0.35 + (CBZ.hash01 ? CBZ.hash01(Math.round(x / 12) * 12, Math.round(z / 12) * 12, 9001) : 0.5) * 0.6;
    car._anchor = {
      x: x, z: z, depth: depth, scope: scope,
      radius: Math.max(6, Math.min(70, depth * scope)),
      hold: hold, dragT: 0, drags: 0,
    };
    car.v = 0; car.vx = 0; car.vz = 0;
    // COLREGs: at anchor you show ONE all-round white light and no running
    // lights. We only add the anchor light (touching the hull's existing
    // navigation lights is WP-2's mesh, not ours).
    if (window.THREE && car.group && !car._anchorLight) {
      const L = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 5),
        new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1 }));
      L.position.set(0, 2.6, 0.2);
      car.group.add(L); car._anchorLight = L;
    }
    note("Anchor down — " + Math.round(depth) + "m, " + scope + ":1 scope, " + Math.round(car._anchor.radius) + "m swing.", 3);
    sfx("clank");
    return true;
  }

  const _cur = { x: 0, z: 0 };
  if (CBZ.onUpdate) CBZ.onUpdate(11.6, function (dt) {
    if (C.BOAT_ANCHOR === false || g.mode !== "city" || !CBZ.cityCars) return;
    const t = CBZ.waterClock ? CBZ.waterClock() : (CBZ.now || 0);
    for (const car of CBZ.cityCars) {
      const a = car && car._anchor; if (!a) continue;
      if (car.dead) { car._anchor = null; continue; }
      // the set: current (+ a slow synthetic wind that shares the same field)
      let cx = 0, cz = 0;
      if (CBZ.waterField && CBZ.waterField.currentAt) {
        const c = CBZ.waterField.currentAt(car.pos.x, car.pos.z, t, _cur);
        if (c) { cx = c.x || 0; cz = c.z || 0; }
      }
      const setMag = Math.hypot(cx, cz);

      // 1) SWING CIRCLE — constrain the hull inside radius, and kill the
      //    outward component of its velocity so it does not fight the rode.
      const dx = car.pos.x - a.x, dz = car.pos.z - a.z;
      const d = Math.hypot(dx, dz);
      const load = a.radius > 0 ? d / a.radius : 0;
      if (d > a.radius) {
        const nx = dx / (d || 1), nz = dz / (d || 1);
        car.pos.x = a.x + nx * a.radius;
        car.pos.z = a.z + nz * a.radius;
        const out = (car.vx || 0) * nx + (car.vz || 0) * nz;
        if (out > 0) { car.vx -= out * nx; car.vz -= out * nz; }
        car.v *= 0.72;
        if (car.group) { car.group.position.x = car.pos.x; car.group.position.z = car.pos.z; }
      }
      // 2) LIE TO THE SET — a boat at anchor points into the current. Slow
      //    spring; the hull yaws around lazily, it does not snap.
      if (setMag > 0.02) {
        const want = Math.atan2(-cx, -cz);          // forward = (sin h, cos h)
        let e = want - (car.heading || 0);
        while (e > Math.PI) e -= Math.PI * 2;
        while (e < -Math.PI) e += Math.PI * 2;
        car.heading = (car.heading || 0) + e * Math.min(1, 0.45 * dt);
        if (car.group) car.group.rotation.y = car.heading;
      }
      // 3) DRAG CHECK — only when load crosses a threshold, and only every few
      //    seconds. On failure the anchor point WALKS downstream; it does not
      //    let go. Never a continuous simulation.
      a.dragT -= dt;
      if (load > 0.92 && setMag > 0.35 && a.dragT <= 0) {
        a.dragT = 6;
        const risk = (load - 0.9) * 2.4 * setMag * (1 - a.hold);
        const roll = CBZ.hash01 ? CBZ.hash01(a.x + a.drags * 7.3, a.z - a.drags * 4.1, 9002) : 0.5;
        if (roll < risk) {
          a.drags++;
          const m = setMag || 1;
          a.x += (cx / m) * 3.5; a.z += (cz / m) * 3.5;
          if (a.drags === 1 || a.drags % 3 === 0) note("She's dragging — the anchor is walking.", 2.2);
        }
      }
      // player sync: the drive loop already wrote P.pos this frame, so mirror
      // only what we changed. Y stays owned by water_buoyancy.js (38.5).
      if (car.player && CBZ.player && CBZ.player.pos) {
        CBZ.player.pos.x = car.pos.x; CBZ.player.pos.z = car.pos.z;
        if (CBZ.playerChar && CBZ.playerChar.group) {
          CBZ.playerChar.group.position.x = car.pos.x;
          CBZ.playerChar.group.position.z = car.pos.z;
        }
      }
    }
  });

  /* ============================================================
     6) THE SALES DESK — an interaction ZONE at the brokerage.
     ------------------------------------------------------------
     A dealer is a genuine multi-option menu, so it legitimately gets a card
     (HUD doctrine: the killfeed is the only popup; rich info lives in a panel;
     single-verb RIDES stay silent — and boarding a boat needs nothing from us,
     interact.js:1119 already owns it).
     ============================================================ */
  let _zoneWired = false;
  function deskTarget(px, pz) {
    if (C.BOAT_DEALER === false) return null;
    const d = CBZ.cityMarina && CBZ.cityMarina.desk ? CBZ.cityMarina.desk() : null;
    if (!d) return null;
    const dx = d.x - px, dz = d.z - pz;
    if (dx * dx + dz * dz > 5.0 * 5.0) return null;
    return { x: d.x, z: d.z, name: "Cassaline Marine" };
  }
  function wireZone() {
    if (_zoneWired || !CBZ.interactions || !CBZ.interactions.registerZone) return;
    _zoneWired = true;
    const I = CBZ.interactions;
    I.registerZone({
      id: "boatyard-desk", kind: "boatbroker", radius: 5.0,
      find: deskTarget,
      options: [
        {
          id: "boatyard-browse", slot: "e",
          label: function () { return "Talk to the broker"; },
          onSelect: function () { open("buy"); },
        },
        {
          id: "boatyard-fleet", slot: "i",
          canShow: function () { return fleet().length > 0; },
          label: function () { return "Your fleet (" + fleet().length + ")"; },
          onSelect: function () { open("fleet"); },
        },
      ],
    });
    if (I.describe) I.describe("boatbroker", function () {
      return { label: "Cassaline Marine", note: "Brokerage & yard — hulls in the water, sea trials on request" };
    });
    // ANCHOR: the verb belongs to whoever is at the helm, jacked hull or not.
    I.register("vehicle:inside", {
      id: "boat-anchor", slot: "k",
      canShow: function (car, ctx) {
        if (C.BOAT_ANCHOR === false) return false;
        return !!(ctx && ctx.driving && ctx.vehicle === car && isMarineCar(car));
      },
      label: function (car) { return anchored(car) ? "Weigh anchor" : "Drop anchor"; },
      onSelect: function (car) { anchorToggle(car); },
    });
  }
  if (CBZ.onUpdate) CBZ.onUpdate(14.7, function () { if (!_zoneWired) wireZone(); });
  wireZone();

  /* ============================================================
     7) THE PANEL — the brokerage listing + your fleet.
     ============================================================ */
  let panel = null, open_ = false, tab = "buy", flash_ = "", actions = [];
  function flash(msg, kind) { flash_ = "<span style='color:" + (kind === "bad" ? "#ff8b7a" : "#7ed957") + "'>" + msg + "</span>"; if (open_) render(); }
  function el() {
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "cityBoatyard";
    panel.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:48;display:none;" +
      "min-width:400px;max-width:560px;max-height:78vh;overflow:auto;background:rgba(12,20,28,.97);border:2px solid #2b4356;" +
      "border-radius:16px;padding:14px 18px;color:#e8eef7;font-family:Fredoka,system-ui,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.55);pointer-events:auto";
    panel.addEventListener("click", function (e) {
      if (!CBZ.touchMode || !open_) return;
      if (e.target.closest && e.target.closest("[data-bclose]")) { close(); return; }
      const r = e.target.closest ? e.target.closest("[data-bi]") : null;
      if (r) { const a = actions[+r.getAttribute("data-bi")]; if (a) a.fn(); }
    });
    document.body.appendChild(panel);
    return panel;
  }
  function kts(n) { return n ? Math.round(n) + " kn" : "—"; }
  function ft(m) { return Math.round(m / M_PER_FT) + "'"; }
  function render() {
    actions = [];
    const cash = (g.cash || 0), bank = (g.cityBank || 0);
    let html = "<div style='font-size:19px;font-weight:700'>CASSALINE MARINE</div>";
    html += "<div style='font-size:11px;color:#7fa8c4;margin-bottom:6px'>Brokerage &amp; yard · " + (CBZ.cityMarina && CBZ.cityMarina.exists() ? "Marina berths available" : "Roadstead moorings only") + "</div>";
    html += "<div style='font-size:12px;color:#8a93a3;margin-bottom:9px'>Cash " + money(cash) + " · Bank " + money(bank) + (fleet().length ? " · Upkeep " + money(fleetDaily()) + "/day" : "") + "</div>";
    if (flash_) html += "<div style='font-size:12px;margin-bottom:7px'>" + flash_ + "</div>";
    html += "<div style='font-size:11px;color:#6b7480;margin-bottom:7px'>[B] brokerage · [F] your fleet</div>";

    if (tab === "buy") {
      for (const e of catalog()) {
        const have = owned(e.key);
        const p = priceOf(e);
        html += "<div style='padding:6px 0;border-top:1px solid rgba(255,255,255,.07)'>";
        html += "<b style='color:#cfe0f5'>" + e.label + "</b> <span style='color:#8a93a3;font-size:11px'>" +
          ft(e.loa) + " LOA · " + e.beam.toFixed(1) + "m beam · " + kts(e.topKts) + "</span>";
        html += "<div style='font-size:12px;color:#ffd166'>" + money(p) + "</div>";
        html += "</div>";
        if (have) actions.push({ label: e.label + " — OWNED (locate her)", fn: function () { locate(have); } });
        else {
          actions.push({ label: "Buy " + e.label + " — " + money(p), fn: function () { buy(e.key); } });
          if (bankLoan()) actions.push({ label: "Finance " + e.label + " — " + money(Math.round(p * DOWN_FRAC / 500) * 500) + " down", fn: function () { financeBuy(e.key); } });
        }
      }
      if (catalog().length === 1 && catalog()[0].soloFallback) {
        html += "<div style='font-size:11px;color:#6b7480;margin-top:8px'>The yard only has the one hull in stock.</div>";
      }
    } else {
      const f = fleet();
      if (!f.length) html += "<div style='font-size:13px;color:#9fb0c6'>You don't own a boat yet.</div>";
      for (const r of f) {
        const live = liveHull(r);
        html += "<div style='padding:6px 0;border-top:1px solid rgba(255,255,255,.07)'>";
        html += "<b style='color:#cfe0f5'>" + (r.label || r.name) + "</b> <span style='color:#8a93a3;font-size:11px'>" + ft(r.loa || 6.2) + " · berth " + (r.berthId || "—") + "</span>";
        html += "<div style='font-size:11px;color:" + (r.arrears ? "#ff8b7a" : "#8a93a3") + "'>" +
          money(dailyCost(r)) + "/day" + (r.arrears ? " · " + money(r.arrears) + " OVERDUE" : "") +
          (r.loanId != null ? " · financed" : "") + (live ? " · afloat" : " · laid up") + "</div>";
        html += "</div>";
        actions.push({ label: (live ? "Locate " : "Bring out ") + (r.label || r.name), fn: function () { locate(r); } });
        actions.push({ label: "Sell " + (r.label || r.name) + " — " + money(Math.round(r.price * SELL_FRAC)), fn: function () { sell(r.key); } });
      }
      if (totalArrears() > 0) actions.push({ label: "Pay back dues — " + money(totalArrears()), fn: payArrears });
    }

    if (CBZ.touchMode) {
      actions.forEach(function (a, i) { html += "<div data-bi='" + i + "' style='padding:10px 8px;margin:3px 0;font-size:14px;border:1px solid rgba(232,236,242,.16);border-radius:9px;background:rgba(255,255,255,.05)'>" + a.label + "</div>"; });
      html += "<button type='button' class='tpill tpill-sm' data-bclose='1' style='margin-top:9px'>CLOSE</button>";
    } else {
      actions.forEach(function (a, i) { if (i < 9) html += "<div style='padding:3px 0;font-size:13px'><b style='color:#ffd166'>" + (i + 1) + "</b> " + a.label + "</div>"; });
      html += "<div style='font-size:11px;color:#6b7480;margin-top:9px'>[1–" + Math.min(9, actions.length) + "] select · [Esc] close</div>";
    }
    el().innerHTML = html;
  }
  function locate(rec) {
    const car = deliver(rec, { mark: true });
    if (car) { car._boatRec = rec; note((rec.label || rec.name) + " is at her berth — waypoint set.", 2.6); }
    else note("Couldn't find water to put her in.", 2.2);
    close();
  }
  function open(which) {
    if (CBZ.cityMenuOpen && !open_) return;
    tab = which || "buy"; open_ = true; flash_ = "";
    CBZ.cityMenuOpen = true;
    el().style.display = "block";
    render();
    if (document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
  }
  function close() {
    open_ = false;
    if (panel) panel.style.display = "none";
    CBZ.cityMenuOpen = false;
    if (CBZ.requestLock && g.state === "playing") CBZ.requestLock();
  }
  CBZ.cityOpenBoatyard = function (which) { open(which); };

  addEventListener("keydown", function (e) {
    if (!open_) return;
    const k = (e.key || "").toLowerCase();
    if (k === "escape") { e.preventDefault(); close(); return; }
    if (k === "b") { e.preventDefault(); tab = "buy"; flash_ = ""; render(); return; }
    if (k === "f") { e.preventDefault(); tab = "fleet"; flash_ = ""; render(); return; }
    if (k >= "1" && k <= "9") {
      e.preventDefault();
      const a = actions[parseInt(k, 10) - 1];
      if (a) a.fn();
      return;
    }
  });

  /* ============================================================
     8) HOUSEKEEPING — reconcile owned records once in a while (cheap), and
        drop cached catalog/berth state on a world rebuild.
     ============================================================ */
  let _recT = 0;
  if (CBZ.onUpdate) CBZ.onUpdate(41.5, function (dt) {
    if (g.mode !== "city") return;
    _recT -= dt;
    if (_recT > 0) return;
    _recT = 4;
    catalog();      // idempotent; installs the SPECIAL_VEHICLES bridge early
    reconcile();
  });
  CBZ.cityBoatyardReset = function () { _catalog = null; _lastDay = null; };

  /* ============================================================
     PUBLIC SURFACE — the contract's interface [E]
     ============================================================ */
  CBZ.boatOwned = function (key) { return owned(key); };
  CBZ.boatBuy = function (key) { return buy(key); };
  CBZ.boatBerth = function (key) {
    const rec = owned(key); if (!rec) return null;
    const b = berthOf(rec); if (!b) return null;
    return { x: b.x, z: b.z, heading: b.heading || 0, id: b.id };
  };
  CBZ.boatFleet = function () { return fleet().slice(); };
  CBZ.boatAnchorToggle = anchorToggle;
  CBZ.boatAnchored = anchored;
  CBZ.cityBoatUpkeepTick = upkeepTick;

  CBZ.cityBoatyard = {
    catalog: catalog, buy: buy, financeBuy: financeBuy, sell: sell,
    fleet: fleet, owned: owned, deliver: deliver, locate: locate,
    berthForModel: berthForModel, berthOf: berthOf,
    dailyCost: dailyCost, fleetDaily: fleetDaily, arrears: totalArrears, payArrears: payArrears,
    upkeepTick: upkeepTick, anchorToggle: anchorToggle, anchored: anchored,
    open: open, close: close,
  };
})();
