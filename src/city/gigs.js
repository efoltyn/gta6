/* ============================================================
   city/gigs.js — the PLAYER GIG ENGINE.

   One unified state machine — CBZ.cityGig — drives four money loops
   that all share the same diegetic skeleton:

       OFFERED → PICKUP → CARRY → DROPOFF → PAID  (or FAIL).

   WHY-FIRST.  The city already runs a smuggling economy (buy product
   low at a trap, run it hot, sell high on the right turf). DELIVERY
   and TAXI are the LEGAL MIRROR of that exact loop — go somewhere,
   carry something fragile/impatient, get paid for getting it there
   intact and fast — and SMUGGLING is the risky reflection that reuses
   the live drug market + wanted system. Every reward is something you
   can FEEL: a cargo-intact bar you watch drain on a crash, a tip bar
   that decays while the passenger waits, rising HEAT you can see in
   your stars. No hidden stats, no parallel UI clutter:

     • the OBJECTIVE + distance ride the existing g.cityJob HUD line
       (city/hud.js already renders desc + $reward + dist-to-dest);
     • ONE extra small HUD bar shows the active loop's skill meter
       (cargo-intact for delivery, tip-bar for taxi, heat for smuggling).

   Loops (researched against the genre's core skill expressions):
     DELIVERY  — legal, smooth-driving skill. A CARGO-INTACT meter
                 (Death-Stranding style) drains on collisions / hard
                 impacts + a soft time factor. Pay = base × distance ×
                 (0.5 + 0.5×intact) + speed bonus, with an S/A/B rating
                 + a tip number. Clean runs build a STREAK multiplier;
                 a milestone unlocks an insulated bag (drains slower).
     TAXI/UBER — the decaying TIP BAR. An NPC boards at a color zone,
                 a destination waypoint points the way, the tip bar
                 bleeds ~3%/30s AND on every crash/damage; near-misses
                 tick a small combo, clipping a car zeroes the combo.
                 Arrival pays fare(distance) + remaining tip + speed.
                 TAXI = hail from the street; UBER = an accepted app fare.
     SMUGGLE   — buy contraband low at a trap/dealer lot (econ street
                 price), CARRY = rising HEAT (hooked to cityCrime/wanted);
                 holding/selling at NIGHT lowers heat; cops within radius
                 can trigger a SEARCH → bust = lose the load + a fine.
                 Counterplay: stash it, or sell in a far/rival district
                 where streetPrice (turf+heat multipliers) pays more.

   Self-contained IIFE. City-gated. Every external API is feature-
   detected so a headless / non-city harness is a no-op. Determinism:
   reuses the same LCG-rng convention as careers.js for offer rolls.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  // ---- deterministic rng (same convention as careers.js) ----
  let _s = 1973272912;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }
  function rndi(n) { return (rng() * n) | 0; }
  function pick(a) { return a && a.length ? a[rndi(a.length)] : null; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function now() { return CBZ.now || (typeof performance !== "undefined" ? performance.now() : Date.now()); }

  // ---- small safe shims over the city helpers (all feature-detected) ----
  function arena() { return (CBZ.city && CBZ.city.arena) || null; }
  function alive() { return g.mode === "city" && g.state === "playing"; }
  function note(m, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(m, s == null ? 2 : s); }
  function big(m) { if (CBZ.city && CBZ.city.big) CBZ.city.big(m); }
  function addCash(n) { if (n > 0) { if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(n); else g.cash = (g.cash || 0) + n; } }
  function spend(n) { if (n <= 0) return true; if (CBZ.city && CBZ.city.spend) return CBZ.city.spend(n); if ((g.cash || 0) < n) return false; g.cash -= n; return true; }
  function canAfford(n) { if (CBZ.city && CBZ.city.canAfford) return CBZ.city.canAfford(n); return (g.cash || 0) >= n; }
  function addRespect(n) { if (n && CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(n); }
  function hudDirty() { if (CBZ.cityHudDirty) CBZ.cityHudDirty(); }
  function playerPos() { return (CBZ.player && CBZ.player.pos) || { x: 0, z: 0 }; }
  function dist(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
  function isNight() {
    if (CBZ.cityIsNight) { try { return !!CBZ.cityIsNight(); } catch (e) {} }
    if (g.cityNight != null) return !!g.cityNight;
    const t = g.cityTimeOfDay != null ? g.cityTimeOfDay : (g.cityHour != null ? g.cityHour / 24 : null);
    if (t != null) return t < 0.25 || t > 0.80;
    return false;
  }

  // ---- lots: feed off the real city. Delivery picks up at FOOD, drops at a
  //      HOME/OFFICE; smuggle buys at a TRAP/dealer lot. We classify by the
  //      shop kind buildings.js bakes into the lot (food / drugs) and use the
  //      home lots for residential drops. ----
  function allLots() {
    const a = arena(); if (!a) return [];
    const out = [];
    const push = (arr) => { if (arr) for (const l of arr) if (l && l.building && l.building.door && !l.demolished) out.push(l); };
    push(a.lots); push(CBZ.city && CBZ.city.lots);
    return out;
  }
  function shopLots() {
    const a = arena();
    const arr = (CBZ.city && CBZ.city.shopLots) || (a && a.shopLots) || [];
    return arr.filter((l) => l && l.building && l.building.door && !l.demolished);
  }
  function homeLots() {
    const arr = (CBZ.city && CBZ.city.homeLots) || (arena() && arena().homeLots) || [];
    return arr.filter((l) => l && l.building && l.building.door && !l.demolished);
  }
  function lotName(l) { return (l && l.building && (l.building.name || "")) || ""; }
  function nameMatches(l, re) { return re.test(lotName(l)); }
  function foodLots() {
    const s = shopLots().filter((l) => nameMatches(l, /food|spoon|diner|grill|burger|pizza|taco|cafe|eatery|kitchen|deli/i));
    return s.length ? s : shopLots();  // any shop counts as a pickup if no food lot exists
  }
  function trapLots() {
    const s = shopLots().filter((l) => nameMatches(l, /trap|drug|dealer/i));
    return s;  // may be empty — smuggle falls back to a dealer ped / any shop
  }
  function dropLots() {
    const h = homeLots();
    const o = shopLots().filter((l) => nameMatches(l, /office|tower|corp|plaza|firm/i));
    const pool = h.concat(o);
    return pool.length ? pool : allLots();
  }
  function doorOf(l) { const d = l.building.door; return { x: d.x + (d.nx || 0) * 1.4, z: d.z + (d.nz || 0) * 1.4 }; }

  // ---- a roaming pickup/dropoff point if there are no usable lots (a sidewalk
  //      corner) so the loop still works on a sparse map. ----
  function streetPoint() {
    const a = arena();
    if (a && a.randomSidewalkPoint) { try { const p = a.randomSidewalkPoint(); if (p) return { x: p.x, z: p.z }; } catch (e) {} }
    const P = playerPos();
    return { x: P.x + (rng() - 0.5) * 90, z: P.z + (rng() - 0.5) * 90 };
  }

  /* =========================================================
     A LIGHTWEIGHT BEACON + ground RING for the active gig leg.
     (careers.js owns its own beacon for g.cityJob; we keep ours
      separate so the two never fight over the same mesh.)
  ========================================================= */
  let beacon = null, ring = null;
  function clearMarker() {
    if (beacon) { if (beacon.parent) beacon.parent.remove(beacon); if (beacon.geometry) beacon.geometry.dispose(); if (beacon.material) beacon.material.dispose(); beacon = null; }
    if (ring) { if (ring.parent) ring.parent.remove(ring); if (ring.geometry) ring.geometry.dispose(); if (ring.material) ring.material.dispose(); ring = null; }
    if (CBZ.fullMap && CBZ.fullMap.clearWaypoint) { try { CBZ.fullMap.clearWaypoint("city"); } catch (e) {} }
  }
  function setMarker(x, z, color, label) {
    clearMarker();
    const a = arena(); if (!a || !a.root) return;
    const hgt = 34;
    beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(1.0, 1.0, hgt, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.30, side: THREE.DoubleSide, depthWrite: false }));
    beacon.position.set(x, hgt / 2, z); beacon.userData.transient = true;
    a.root.add(beacon);
    ring = new THREE.Mesh(
      new THREE.RingGeometry(2.2, 3.0, 24),
      new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.12, z); ring.userData.transient = true;
    a.root.add(ring);
    if (CBZ.fullMap && CBZ.fullMap.setWaypoint && label) { try { CBZ.fullMap.setWaypoint(x, z, label); } catch (e) {} }
  }
  function moveMarker(x, z) {
    if (beacon) beacon.position.set(x, beacon.position.y, z);
    if (ring) ring.position.set(x, 0.12, z);
  }

  /* =========================================================
     THE SHARED SKILL-METER HUD BAR. One small bar, bottom-center,
     re-labelled per loop: CARGO (intact) / TIP / HEAT. Built lazily,
     hidden whenever no gig is active. No css/city.css dependency
     (inline cssText, the careers.js / activities.js convention).
  ========================================================= */
  let barWrap = null, barFill = null, barLabel = null, barCombo = null;
  function buildBar() {
    if (barWrap) return;
    barWrap = document.createElement("div");
    barWrap.id = "cityGigBar";
    barWrap.style.cssText = "position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:42;display:none;width:230px;font-family:Fredoka,system-ui,sans-serif;pointer-events:none;text-align:center";
    const top = document.createElement("div");
    top.style.cssText = "display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:3px";
    barLabel = document.createElement("div");
    barLabel.style.cssText = "font-size:11px;font-weight:700;letter-spacing:1px;color:#cdd6e3;text-shadow:0 1px 2px #000";
    barCombo = document.createElement("div");
    barCombo.style.cssText = "font-size:11px;font-weight:700;color:#ffd166;text-shadow:0 1px 2px #000";
    top.appendChild(barLabel); top.appendChild(barCombo);
    const track = document.createElement("div");
    track.style.cssText = "height:10px;background:rgba(8,10,14,.7);border:1px solid #2c3645;border-radius:6px;overflow:hidden";
    barFill = document.createElement("div");
    barFill.style.cssText = "height:100%;width:100%;border-radius:6px;transition:width .12s linear";
    track.appendChild(barFill);
    barWrap.appendChild(top); barWrap.appendChild(track);
    document.body.appendChild(barWrap);
  }
  function showBar(label, frac01, color, combo) {
    buildBar();
    barWrap.style.display = "block";
    barLabel.textContent = label;
    barCombo.textContent = combo || "";
    barFill.style.width = clamp(frac01, 0, 1) * 100 + "%";
    barFill.style.background = color;
  }
  function hideBar() { if (barWrap) barWrap.style.display = "none"; }

  /* =========================================================
     PLAYER-CAR IMPACT DETECTION (shared by delivery + taxi).
     We don't reach into the crash branch of vehicles.js — we just
     watch the driven car's speed each tick: a sudden large drop in
     |v| while moving is a collision (wall / car / ped). Returns the
     magnitude of the jolt (0 if none). Also samples engine HP loss.
  ========================================================= */
  function drivenCar() {
    const P = CBZ.player;
    if (!P || !P.driving) return null;
    return P._vehicle || P.car || null;
  }
  let _lastV = 0, _lastHp = null;
  function sampleImpact() {
    const car = drivenCar();
    if (!car) { _lastV = 0; _lastHp = null; return 0; }
    const v = Math.abs(car.v || 0);
    let jolt = 0;
    // a sharp deceleration while we were moving fast = a hit (crash branch in
    // vehicles.js bleeds car.v to 5–48% on a wall, harder = bigger drop).
    if (_lastV > 7 && v < _lastV * 0.6) jolt = Math.max(jolt, (_lastV - v));
    // engine HP loss this frame (run-ins that didn't fully stop us)
    if (car.hp != null) {
      if (_lastHp != null && car.hp < _lastHp - 0.5) jolt = Math.max(jolt, (_lastHp - car.hp) * 0.6);
      _lastHp = car.hp;
    }
    _lastV = v;
    return jolt;
  }

  /* =========================================================
     STATE.  g.cityGig holds the active gig (survives nothing fancy —
     a single run). The state machine: OFFERED is transient (lives in
     the offer list, not on g.cityGig); accept() puts a gig into PICKUP.
  ========================================================= */
  // g.cityGig = {
  //   kind: "delivery"|"taxi"|"uber"|"smuggle",
  //   phase: "pickup"|"carry"|"dropoff"|"done",
  //   pickup:{x,z}, dest:{x,z}, base, distM,
  //   intact, tip, combo, heat, drug, qty, unit, passenger, ...
  // }
  let offers = [];           // current OFFERED list (for the accept-UI agent)
  let lastOfferKind = null;

  function nearestLotPair(fromPool, toPool, minSep) {
    // pick a pickup near the player and a dropoff a satisfying distance away.
    const P = playerPos();
    let pk = null, pd = Infinity;
    for (const l of fromPool) { const d = doorOf(l); const dd = dist(P.x, P.z, d.x, d.z); if (dd < pd) { pd = dd; pk = l; } }
    if (!pk) return null;
    const pkPt = doorOf(pk);
    let best = null, bestScore = -Infinity;
    for (const l of toPool) {
      if (l === pk) continue;
      const d = doorOf(l);
      const sep = dist(pkPt.x, pkPt.z, d.x, d.z);
      if (sep < (minSep || 40)) continue;
      // prefer a medium-long run, lightly randomized so offers vary
      const score = sep * (0.7 + rng() * 0.6) - sep * sep * 0.0008;
      if (score > bestScore) { bestScore = score; best = l; }
    }
    if (!best) { // fallback: just the farthest viable
      let fd = -1; for (const l of toPool) { if (l === pk) continue; const d = doorOf(l); const sep = dist(pkPt.x, pkPt.z, d.x, d.z); if (sep > fd) { fd = sep; best = l; } }
    }
    if (!best) return null;
    return { pickup: pkPt, dest: doorOf(best), distM: dist(pkPt.x, pkPt.z, doorOf(best).x, doorOf(best).z), pickupLot: pk, destLot: best };
  }

  // ---------------------------------------------------------
  //  OFFER — build 1..3 offers of a kind from real lots near the player.
  //  Returns the offer array (the accept-UI agent renders + calls accept()).
  // ---------------------------------------------------------
  function buildDeliveryOffers() {
    const food = foodLots(), drops = dropLots();
    if (!food.length || !drops.length) return [];
    const out = [];
    const n = 1 + rndi(3);
    for (let i = 0; i < n; i++) {
      const pair = nearestLotPair(food, drops, 45);
      if (!pair) break;
      const distKm = pair.distM / 100;          // ~100u ≈ a "block-km" for payout scaling
      const base = 28 + Math.round(distKm * 38);
      out.push({
        kind: "delivery", base, distM: pair.distM,
        pickup: pair.pickup, dest: pair.dest,
        from: lotName(pair.pickupLot) || "the kitchen", to: lotName(pair.destLot) || "the drop",
        reward: Math.round(base * (1 + distKm * 0.5)),
        desc: "Deliver from " + (lotName(pair.pickupLot) || "the kitchen"),
      });
    }
    return out;
  }
  function buildTaxiOffers(uber) {
    // pickup = a street hail (taxi) or a chosen fare (uber). Either way an NPC
    // boards at the pickup and rides to a dropoff lot/street point.
    const drops = allLots();
    const out = [];
    const n = uber ? (1 + rndi(3)) : 1;
    for (let i = 0; i < n; i++) {
      const pk = uber ? doorOf(pick(drops) || { building: { door: streetPoint() } }) : streetPoint();
      const pkPt = pk.x != null ? pk : streetPoint();
      let destPt = drops.length ? doorOf(pick(drops)) : streetPoint();
      if (dist(pkPt.x, pkPt.z, destPt.x, destPt.z) < 45) destPt = streetPoint();
      const distM = dist(pkPt.x, pkPt.z, destPt.x, destPt.z);
      const fare = 12 + Math.round(distM / 100 * 30);
      out.push({
        kind: uber ? "uber" : "taxi", pickup: pkPt, dest: destPt, distM,
        base: fare, reward: Math.round(fare * 1.6),  // shown estimate incl. a full tip
        desc: (uber ? "Pick up the rider" : "Pick up a fare"),
      });
    }
    return out;
  }
  function buildSmuggleOffers() {
    const econ = CBZ.cityEcon; if (!econ || !econ.streetPrice) return [];
    const traps = trapLots();
    const drugs = ["Weed", "Coke", "Meth", "Pills"].filter((d) => econ.ITEMS && econ.ITEMS[d]);
    if (!drugs.length) return [];
    const out = [];
    const n = 1 + rndi(3);
    for (let i = 0; i < n; i++) {
      const drug = pick(drugs);
      // buy at a trap lot (or a dealer ped / street corner near the player)
      const buyLot = traps.length ? pick(traps) : null;
      const buyPt = buyLot ? doorOf(buyLot) : streetPoint();
      // sell where it pays most (the live market's best district)
      const market = econ.bestMarket ? econ.bestMarket(drug) : null;
      const sellPt = pickPointInDistrict(market && market.dk) || streetPoint();
      const unit = econ.wholesalePrice ? econ.wholesalePrice(drug) : Math.round((econ.ITEMS[drug].value || 30) * 0.8);
      const qty = 4 + rndi(8);
      const distM = dist(buyPt.x, buyPt.z, sellPt.x, sellPt.z);
      out.push({
        kind: "smuggle", drug, qty, unit,
        pickup: buyPt, dest: sellPt, distM,
        sellDistrict: market && market.dk, sellName: (market && market.name) || "across town",
        base: unit * qty,
        reward: market ? Math.round(market.price * qty * 0.9) : Math.round(unit * qty * 1.6),
        desc: "Cop " + qty + "× " + drug + ", move it to " + ((market && market.name) || "a hot market"),
      });
    }
    return out;
  }
  function pickPointInDistrict(dk) {
    if (!dk) return null;
    const econ = CBZ.cityEcon; const a = arena();
    if (!econ || !econ.districtAt || !a || !a.randomSidewalkPoint) return null;
    for (let i = 0; i < 40; i++) {
      let p; try { p = a.randomSidewalkPoint(); } catch (e) { return null; }
      if (p && econ.districtAt(p.x, p.z) === dk) return { x: p.x, z: p.z };
    }
    return null;
  }

  function offer(kind) {
    if (!alive()) return [];
    lastOfferKind = kind;
    if (kind === "delivery") offers = buildDeliveryOffers();
    else if (kind === "taxi") offers = buildTaxiOffers(false);
    else if (kind === "uber") offers = buildTaxiOffers(true);
    else if (kind === "smuggle") offers = buildSmuggleOffers();
    else offers = [];
    return offers;
  }

  // ---------------------------------------------------------
  //  ACCEPT — turn an offer def into the live gig (enters PICKUP).
  // ---------------------------------------------------------
  function accept(def) {
    if (!def || !def.kind) { note("No gig to accept.", 1.6); return false; }
    if (CBZ.cityCampaignOwnsMission && CBZ.cityCampaignOwnsMission()) {
      if (CBZ.campaignUI && CBZ.campaignUI.open) CBZ.campaignUI.open("missions");
      return false;
    }
    if (g.cityGig) { note("Finish your current gig first.", 1.8); return false; }
    if (g.cityJob) { note("Wrap your current job first.", 1.8); return false; }
    const gig = {
      kind: def.kind, phase: "pickup",
      pickup: def.pickup, dest: def.dest,
      base: def.base || 0, distM: def.distM || dist(def.pickup.x, def.pickup.z, def.dest.x, def.dest.z),
      startT: now(),
      // delivery
      intact: 1.0, topSpeed: 0,
      // taxi
      tip: 1.0, combo: 0, passenger: null, uber: def.kind === "uber",
      // smuggle
      drug: def.drug, qty: def.qty || 0, unit: def.unit || 0,
      heat: 0, stashed: false, sellDistrict: def.sellDistrict, sellName: def.sellName,
      from: def.from, to: def.to,
      reward: def.reward || 0,
    };
    g.cityGig = gig;
    offers = [];
    enterPickup(gig);
    if (CBZ.cityGigOnAccept) { try { CBZ.cityGigOnAccept(gig); } catch (e) {} }   // hook for company-system agent
    return true;
  }

  function gigLabel(gig) {
    if (gig.kind === "delivery") return "DELIVERY";
    if (gig.kind === "taxi") return "TAXI";
    if (gig.kind === "uber") return "RIDESHARE";
    if (gig.kind === "smuggle") return "SMUGGLE";
    return "GIG";
  }

  function enterPickup(gig) {
    gig.phase = "pickup";
    const col = gig.kind === "smuggle" ? 0x4caf6e : (gig.kind === "delivery" ? 0xff9e6b : 0x7de7ff);
    const verb = gig.kind === "smuggle" ? "COP THE LOAD"
      : gig.kind === "delivery" ? "GRAB THE ORDER"
      : "PICK UP";
    setMarker(gig.pickup.x, gig.pickup.z, col, verb);
    g.cityJob = {
      type: "gig", desc: pickupDesc(gig), reward: gig.reward || 0,
      dest: { x: gig.pickup.x, z: gig.pickup.z }, _gig: true,
    };
    big(gigLabel(gig) + " · accepted");
    note(pickupDesc(gig), 2.6);
    hudDirty();
  }
  function pickupDesc(gig) {
    if (gig.kind === "delivery") return "Pick up the order from " + (gig.from || "the kitchen");
    if (gig.kind === "smuggle") return "Cop " + gig.qty + "× " + gig.drug + " at the trap";
    return gig.uber ? "Collect your rider" : "Pull up to the fare";
  }
  function enterCarry(gig) {
    gig.phase = "carry";
    const col = gig.kind === "smuggle" ? 0xc792ea : (gig.kind === "delivery" ? 0x7ed957 : 0xffd166);
    let label;
    if (gig.kind === "smuggle") label = "SELL: " + (gig.sellName || "hot market");
    else if (gig.kind === "delivery") label = "DROP: " + (gig.to || "the address");
    else label = "DROP OFF RIDER";
    setMarker(gig.dest.x, gig.dest.z, col, label);
    g.cityJob = { type: "gig", desc: carryDesc(gig), reward: gig.reward || 0, dest: { x: gig.dest.x, z: gig.dest.z }, _gig: true };
    note(carryDesc(gig), 2.4);
    hudDirty();
  }
  function carryDesc(gig) {
    if (gig.kind === "delivery") return "Drive it clean to " + (gig.to || "the address");
    if (gig.kind === "smuggle") return "Run the load to " + (gig.sellName || "a hot market") + " — stay cool";
    return "Get the rider to the drop — mind the tip";
  }

  // ---------------------------------------------------------
  //  PICKUP arrival per loop
  // ---------------------------------------------------------
  function tryPickup(gig, P) {
    if (dist(P.x, P.z, gig.pickup.x, gig.pickup.z) > 4.5) return;
    if (gig.kind === "smuggle") {
      const econ = CBZ.cityEcon;
      const cost = gig.unit * gig.qty;
      if (!canAfford(cost)) {
        const can = Math.floor((g.cash || 0) / Math.max(1, gig.unit));
        if (can <= 0) { note("Need $" + cost + " to cop the load. Come back with cash.", 2.2); return; }
        gig.qty = can;
      }
      spend(gig.unit * gig.qty);
      if (econ && econ.add) econ.add(gig.drug, gig.qty);
      if (econ && econ.recordBuy) econ.recordBuy(gig.drug, gig.qty);
      if (!g.career) g.career = "dealer";
      note("Copped " + gig.qty + "× " + gig.drug + " @ $" + gig.unit + ". It's HOT now — move.", 2.6);
    } else if (gig.kind === "delivery") {
      note("Order's in the car. Keep it intact — drive smooth.", 2.2);
    } else {
      // a passenger boards; seat-snap them into the player's car if driving.
      gig.passenger = boardPassenger(gig);
      note(gig.passenger ? ((gig.passenger.name || "Your fare") + " is in. Tip's on the clock.") : "Fare's aboard — go.", 2.4);
    }
    enterCarry(gig);
  }

  // find / snap an NPC passenger near the pickup into the car (best-effort).
  function boardPassenger(gig) {
    const peds = CBZ.cityPeds || [];
    let best = null, bd = 16 * 16;
    for (const p of peds) {
      if (!p || p.dead || p.vendor || p.gang || p.recruited || p.companion || p._gigRider) continue;
      const dd = (p.pos.x - gig.pickup.x) * (p.pos.x - gig.pickup.x) + (p.pos.z - gig.pickup.z) * (p.pos.z - gig.pickup.z);
      if (dd < bd) { bd = dd; best = p; }
    }
    if (best) {
      best._gigRider = true;
      best.seekPlayer = false; best.state = "ride"; best.pause = 9999;
      if (best.group) best.group.visible = false;   // they "get in" — hidden during the ride
    }
    return best;
  }
  function dropPassenger(gig) {
    const p = gig.passenger; if (!p) return;
    p._gigRider = false; p.pause = 0; p.state = "walk"; p.seekPlayer = false;
    if (p.pos) p.pos.set(gig.dest.x, 0, gig.dest.z);
    if (p.group) { p.group.position.set(gig.dest.x, 0, gig.dest.z); p.group.visible = true; }
  }

  // ---------------------------------------------------------
  //  CARRY — per-frame skill: the meter that defines each loop.
  // ---------------------------------------------------------
  function carryTick(gig, P, dt) {
    const jolt = sampleImpact();          // shared crash sampler

    if (gig.kind === "delivery") {
      // CARGO-INTACT drains on impacts (Death-Stranding) + a slow time bleed.
      if (jolt > 0) {
        const dmg = clamp(jolt * 0.018, 0, 0.5);
        gig.intact = clamp(gig.intact - dmg / (gig.insulated ? 2 : 1), 0, 1);
        if (dmg > 0.08) note("⚠ Cargo took a hit (" + Math.round(gig.intact * 100) + "% intact)", 1.4);
      }
      gig.intact = clamp(gig.intact - dt * 0.0018, 0, 1);   // soft time factor
      const car = drivenCar(); if (car) gig.topSpeed = Math.max(gig.topSpeed, Math.abs(car.v || 0));
      showBar("CARGO " + Math.round(gig.intact * 100) + "%", gig.intact,
        gig.intact > 0.66 ? "#7ed957" : gig.intact > 0.33 ? "#ffd166" : "#ff6b6b",
        (streak() > 1 ? "STREAK ×" + streak().toFixed(1) : "") + (gig.insulated ? "  ❄INSULATED" : ""));

    } else if (gig.kind === "taxi" || gig.kind === "uber") {
      // TIP BAR decays ~3%/30s and on every crash/damage; near-misses build a
      // small combo, clipping a car zeroes it.
      gig.tip = clamp(gig.tip - dt * (0.03 / 30), 0, 1);
      if (jolt > 0) {
        gig.tip = clamp(gig.tip - clamp(jolt * 0.02, 0.04, 0.4), 0, 1);
        gig.combo = 0;
        note("😱 The rider grabs the door — tip drops.", 1.2);
      } else {
        const nm = nearMiss(P);
        if (nm) { gig.combo = Math.min(99, gig.combo + 1); gig.lastNearT = now(); }
        else if (gig.lastNearT && now() - gig.lastNearT > 2500) { gig.combo = Math.max(0, gig.combo - 0); }
      }
      // keep the (hidden) rider riding with the car
      const car = drivenCar();
      if (gig.passenger && car && gig.passenger.pos) gig.passenger.pos.set(car.pos.x, 0, car.pos.z);
      showBar("TIP " + Math.round(gig.tip * 100) + "%", gig.tip,
        gig.tip > 0.6 ? "#7ed957" : gig.tip > 0.3 ? "#ffd166" : "#ff6b6b",
        gig.combo >= 2 ? "COMBO ×" + gig.combo : "");

    } else if (gig.kind === "smuggle") {
      // CARRY = rising HEAT. Holding/selling at NIGHT bleeds it; cops nearby
      // can trigger a search → bust. Stashing parks the load (no heat gain).
      if (!gig.stashed) {
        let rate = 0.010;                       // base heat gain per second carrying
        if (isNight()) rate -= 0.014;           // cover of night cools it
        const wd = (g.wanted | 0); if (wd > 0) rate += wd * 0.004;
        gig.heat = clamp(gig.heat + rate * dt, 0, 1);
        maybeCopSearch(gig, P, dt);
      } else {
        gig.heat = clamp(gig.heat - dt * 0.02, 0, 1);
      }
      showBar((gig.stashed ? "STASHED · HEAT " : "HEAT ") + Math.round(gig.heat * 100) + "%", gig.heat,
        gig.heat < 0.4 ? "#7ed957" : gig.heat < 0.75 ? "#ffd166" : "#ff6b6b",
        gig.stashed ? "" : (isNight() ? "🌙 cooler" : ""));
    }
  }

  // a near-miss: a non-player car whipping past close at speed (taxi combo).
  function nearMiss(P) {
    const car = drivenCar(); if (!car || Math.abs(car.v || 0) < 8) return false;
    const cars = CBZ.cityCars || [];
    for (const c of cars) {
      if (!c || c === car || c.player || c.dead) continue;
      const d2 = (c.pos.x - car.pos.x) * (c.pos.x - car.pos.x) + (c.pos.z - car.pos.z) * (c.pos.z - car.pos.z);
      if (d2 < 16 && d2 > 4) return true;   // within ~4u but not touching
    }
    return false;
  }

  // a cop within radius of a hot smuggler can roll a SEARCH → bust.
  function maybeCopSearch(gig, P, dt) {
    if (gig.heat < 0.35) return;
    const cops = CBZ.cityCops || [];
    let near = false;
    for (const c of cops) { if (c.dead) continue; if (dist(c.pos.x, c.pos.z, P.x, P.z) < 14) { near = true; break; } }
    if (!near) { gig._searchCD = 0; return; }
    gig._searchCD = (gig._searchCD || 0) + dt;
    // a search check roughly every ~2.5s of cop proximity, odds scale with heat
    if (gig._searchCD < 2.5) return;
    gig._searchCD = 0;
    const chance = clamp(0.10 + gig.heat * 0.55, 0.1, 0.7) * (isNight() ? 0.7 : 1);
    if (rng() < chance) bustSmuggle(gig);
    else note("👮 A cop eyeballs you… you keep it together.", 1.6);
  }
  function bustSmuggle(gig) {
    const econ = CBZ.cityEcon;
    // lose the load + a fine; flag a real crime so the wanted system reacts.
    if (econ && econ.take) econ.take(gig.drug, gig.qty);
    const fine = Math.round((gig.base || 0) * 0.5 + 120);
    spend(Math.min(fine, g.cash || 0));
    const P = playerPos();
    if (CBZ.cityCrime) CBZ.cityCrime(80, { x: P.x, z: P.z, type: "dealing", instant: true });
    note("🚨 SEARCHED — they found the load. Lost it + a $" + fine + " fine.", 3);
    big("BUSTED · load gone");
    failInternal(gig, "you got searched");
  }

  // ---------------------------------------------------------
  //  DROPOFF / COMPLETE per loop
  // ---------------------------------------------------------
  function tryDropoff(gig, P) {
    if (dist(P.x, P.z, gig.dest.x, gig.dest.z) > 4.5) return;

    if (gig.kind === "delivery") {
      const distKm = gig.distM / 100;
      const speedBonus = clamp(Math.round((gig.topSpeed - 14) * 2), 0, 60);
      const intactFactor = 0.5 + 0.5 * gig.intact;
      let pay = Math.round(gig.base * (1 + distKm * 0.5) * intactFactor) + speedBonus;
      // STREAK multiplier on a clean run
      const clean = gig.intact >= 0.85;
      pay = Math.round(pay * streak());
      const tip = Math.round(pay * (0.05 + 0.35 * gig.intact));
      const rating = gig.intact >= 0.92 ? "S" : gig.intact >= 0.7 ? "A" : gig.intact >= 0.45 ? "B" : "C";
      addCash(pay + tip); addRespect(1);
      bumpStreak(clean);
      g.cityGigsDone = (g.cityGigsDone || 0) + 1;
      big("DELIVERED · " + rating + "  + $" + (pay + tip));
      note("Rated " + rating + " · pay $" + pay + " + tip $" + tip + (clean ? " · clean!" : "") + ".", 3);
      completeInternal(gig);

    } else if (gig.kind === "taxi" || gig.kind === "uber") {
      dropPassenger(gig);
      const distKm = gig.distM / 100;
      const fare = Math.round(gig.base * (0.9 + distKm * 0.25));
      const car = drivenCar();
      const sp = car ? Math.abs(car.v || 0) : 0;
      const speedBonus = clamp(Math.round((sp - 10)), 0, 25);
      const tipPay = Math.round(fare * (0.4 * gig.tip)) + gig.combo * 3;
      addCash(fare + tipPay + speedBonus); addRespect(1);
      g.cityGigsDone = (g.cityGigsDone || 0) + 1;
      const stars = gig.tip > 0.7 ? "★★★★★" : gig.tip > 0.45 ? "★★★★" : gig.tip > 0.2 ? "★★★" : "★★";
      big((gig.uber ? "RIDE DONE" : "FARE PAID") + "  + $" + (fare + tipPay + speedBonus));
      note(stars + " · fare $" + fare + " + tip $" + tipPay + (speedBonus ? " + $" + speedBonus + " speed" : "") + ".", 3);
      completeInternal(gig);

    } else if (gig.kind === "smuggle") {
      const econ = CBZ.cityEcon;
      const dk = econ && econ.districtAt ? econ.districtAt(P.x, P.z) : null;
      // sell the load at the LIVE street price for wherever you actually are —
      // the turf + heat multipliers already baked into econ.streetPrice reward
      // making it to a far / rival district instead of dumping it next door.
      let unit = econ && econ.streetPrice ? econ.streetPrice(gig.drug, dk) : Math.round((gig.unit || 30) * 1.6);
      const have = econ && econ.count ? Math.min(gig.qty, econ.count(gig.drug)) : gig.qty;
      if (have <= 0) { note("You've got nothing left to sell.", 1.8); failInternal(gig, "no product"); return; }
      if (econ && econ.take) econ.take(gig.drug, have);
      if (econ && econ.recordSale) econ.recordSale(gig.drug, have);
      const gross = Math.round(unit * have);
      addCash(gross); addRespect(2);
      if (CBZ.cityGainNotoriety) CBZ.cityGainNotoriety(8 + have * 2);
      g.cityDrugSales = (g.cityDrugSales || 0) + have;
      g.cityGigsDone = (g.cityGigsDone || 0) + 1;
      const profit = gross - (gig.unit * gig.qty);
      big("SOLD · + $" + gross);
      note("Moved " + have + "× " + gig.drug + " for $" + gross + " (profit ~$" + profit + ") in " +
        ((econ && econ.districtName) ? econ.districtName(dk) : "the city") + ".", 3.2);
      completeInternal(gig);
    }
  }

  // STASH the load (smuggle counterplay): park the heat, pick it back up by
  // re-entering the CARRY phase near the stash. Exposed for an interact key.
  function stashLoad() {
    const gig = g.cityGig;
    if (!gig || gig.kind !== "smuggle" || gig.phase !== "carry") { note("Nothing to stash.", 1.4); return false; }
    const P = playerPos();
    gig.stashed = !gig.stashed;
    if (gig.stashed) { gig.stashX = P.x; gig.stashZ = P.z; note("Load stashed — heat's bleeding. Come back when it's quiet.", 2.6); }
    else note("Picked the load back up.", 1.8);
    hudDirty();
    return gig.stashed;
  }

  // ---- STREAK (delivery): consecutive clean deliveries ramp a multiplier; a
  //      milestone unlocks the insulated bag (cargo drains slower). ----
  function streak() { const s = g.cityGigStreak || 0; return 1 + Math.min(1.0, s * 0.05); }
  function bumpStreak(clean) {
    if (clean) {
      g.cityGigStreak = (g.cityGigStreak || 0) + 1;
      if (g.cityGigStreak === 10 && !g.cityGigInsulated) {
        g.cityGigInsulated = true;
        big("UNLOCKED · Insulated Bag");
        note("10 clean drops — you earned an INSULATED BAG. Cargo survives rougher rides now.", 3.4);
      } else if (g.cityGigStreak % 3 === 0) {
        note("Clean streak ×" + g.cityGigStreak + " — pay multiplier ×" + streak().toFixed(2), 2.0);
      }
    } else {
      if ((g.cityGigStreak || 0) >= 3) note("Streak broken.", 1.4);
      g.cityGigStreak = 0;
    }
  }

  // ---------------------------------------------------------
  //  COMPLETE / FAIL — teardown shared by all loops
  // ---------------------------------------------------------
  function teardown() {
    clearMarker(); hideBar();
    if (g.cityJob && g.cityJob._gig) g.cityJob = null;
    _lastV = 0; _lastHp = null;
    g.cityGig = null;
    hudDirty();
  }
  function completeInternal(gig) {
    gig.phase = "done";
    if (CBZ.cityGigOnComplete) { try { CBZ.cityGigOnComplete(gig); } catch (e) {} }   // company-system hook
    teardown();
  }
  function failInternal(gig, why) {
    if (!gig) return;
    if (gig.passenger) dropPassenger(gig);
    if (gig.kind === "delivery") bumpStreak(false);
    if (CBZ.cityGigOnFail) { try { CBZ.cityGigOnFail(gig, why); } catch (e) {} }
    teardown();
  }
  // public complete()/fail(): act on the active gig.
  function complete() { const gig = g.cityGig; if (!gig) return; if (gig.phase === "carry") { tryDropoff(gig, gig.dest); } else completeInternal(gig); }
  function fail(why) { const gig = g.cityGig; if (!gig) return; note("Gig dropped — " + (why || "you bailed") + ".", 2.2); failInternal(gig, why || "abandoned"); }

  // ---------------------------------------------------------
  //  THE TICK — one onUpdate; the accept-UI agent can also call tick(dt)
  //  directly if it wants to drive a gig outside the loop (we de-dupe).
  // ---------------------------------------------------------
  let _tickStamp = -1;
  function tick(dt) {
    const gig = g.cityGig;
    if (!gig) { hideBar(); return; }
    if (!alive()) return;
    const P = playerPos();
    // keep the pickup marker glued to a moving passenger? (pickup is static)
    if (gig.phase === "pickup") {
      tryPickup(gig, P);
    } else if (gig.phase === "carry") {
      carryTick(gig, P, dt);
      tryDropoff(gig, P);
    }
    // smuggle: a screaming-hot load with no cops around still costs you if you
    // hit max heat and a manhunt is already on (the world bust takes over).
    if (gig && gig.kind === "smuggle" && gig.phase === "carry" && (g.wanted | 0) >= 5 && gig.heat > 0.9) {
      note("Too hot — the load's a liability. Stash it or sell NOW.", 2.0);
    }
  }

  if (typeof CBZ.onUpdate === "function") {
    CBZ.onUpdate(38.7, function (dt) {
      if (!g.cityGig) { if (barWrap && barWrap.style.display !== "none") hideBar(); return; }
      const s = now();
      if (s === _tickStamp) return;   // de-dupe if accept-UI already called tick this frame
      _tickStamp = s;
      tick(typeof dt === "number" && dt > 0 ? dt : 0.016);
    });
  }

  // ---------------------------------------------------------
  //  PUBLIC API — for the accept-UI agent (interact.js / phone.js)
  //  and the company-system agent.
  // ---------------------------------------------------------
  CBZ.cityGig = {
    // build & inspect offers
    offer: offer,                 // offer(kind) -> [def,...]  kind: delivery|taxi|uber|smuggle
    offers: function () { return offers.slice(); },
    lastKind: function () { return lastOfferKind; },
    // lifecycle
    accept: accept,               // accept(def) -> bool
    tick: tick,                   // tick(dt) — usually auto-driven by onUpdate
    complete: complete,           // force-complete the active gig (pay if at drop)
    fail: fail,                   // fail([why]) — abandon the active gig
    active: function () { return g.cityGig || null; },
    isActive: function () { return !!g.cityGig; },
    // smuggle counterplay
    stash: stashLoad,             // toggle stash on the active smuggle load
    // a couple of conveniences the company agent may want
    kinds: ["delivery", "taxi", "uber", "smuggle"],
    label: function () { return g.cityGig ? gigLabel(g.cityGig) : null; },
    streak: function () { return g.cityGigStreak || 0; },
    insulated: function () { return !!g.cityGigInsulated; },
  };
})();
