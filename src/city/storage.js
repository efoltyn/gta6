/* ============================================================
   city/storage.js — PROPERTY + STORAGE: launder a hot vehicle into permanence.

   The satisfying GTA loop this closes:  RISK to acquire  →  SAFE once stored
   →  RETRIEVE on demand. A "hot vehicle" (a stolen car, the stolen F-22) can't
   persist on its own — it despawns the moment you walk away. The ONLY way to
   keep it is to own a property and STORE it there. That property is the WHY:

     • GARAGES — buy a lot to store ground vehicles. Two tiers (a 2-bay starter,
       a 10-bay block). Anchored on the city car-lot (the same yard empire.js
       uses), so it reads as a believable place to keep cars.
     • WAREHOUSE — a waterfront unit: 6 vehicles + an AMMO LOCKER (your armory).
     • PRIVATE HANGAR — out on the airport apron: the home for a stolen F-22.
       Landing the hot Raptor inside ANY owned hangar (this one OR the penthouse
       deck hangar) launders it into a permanent g.cityOwnsJet (the keep-gate
       lives in playeraircraft.js; we just expose the AABB via cityStorageHangarHit).

   Buy with cash→bank (the wealth.js charge() convention). Properties persist via
   worldstate (w.storage, hydrated once per run behind g._cityStorageHydrated —
   the exact pattern wealth.js uses for w.luxury). EVERY cross-module call is
   feature-detected so a missing sibling degrades gracefully and nothing throws.

   Walk up to a property spot and press [G] for its menu (Buy if unowned, else
   Store / Retrieve / ammo). Boarding the parked military jet steals it (4★).

   Exposes: CBZ.cityStorage, CBZ.cityOpenStorage, CBZ.cityStorageHangarHit,
   CBZ.cityStorageReset.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  const cmat = CBZ.cmat || CBZ.mat || function (c) { return new THREE.MeshLambertMaterial({ color: c }); };

  // ---- tiny utils (mirror wealth.js / empire.js) ---------------------------
  function money(n) { n = Math.round(n || 0); return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(); }
  function note(m, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(m, s); }
  function big(m) { if (CBZ.city && CBZ.city.big) CBZ.city.big(m); }
  function sfx(n) { if (CBZ.sfx) { try { CBZ.sfx(n); } catch (e) {} } }
  function now() { return CBZ.now || 0; }
  function arena() { return (CBZ.city && CBZ.city.arena) || null; }
  function arenaRoot() { const a = arena(); return a ? a.root : null; }
  function floorY(x, z) { if (CBZ.floorAt) { try { return CBZ.floorAt(x, z) || 0; } catch (e) {} } return 0; }

  // charge cash first, then bank (the wealth.js charge() convention). Returns ok.
  function canAfford(amt) { return ((g.cash || 0) + (g.cityBank || 0)) >= amt; }
  function charge(amt) {
    amt = Math.round(amt);
    if (!canAfford(amt)) return false;
    let owe = amt; const fromCash = Math.min(g.cash || 0, owe);
    g.cash = (g.cash || 0) - fromCash; owe -= fromCash;
    if (owe > 0) g.cityBank = Math.max(0, (g.cityBank || 0) - owe);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    if (CBZ.cityWorldCommit) CBZ.cityWorldCommit();
    return true;
  }

  // ============================================================
  //  PROPERTY CATALOG  (mirror wealth.js BUSINESSES shape)
  // ============================================================
  //  kind: "garage" stores ground vehicles · "warehouse" vehicles + ammo locker
  //        · "hangar" the F-22 keep-home. vehCap = stored-vehicle cap; ammoCap =
  //        per-weapon stash cap (warehouse only). anchor = how we place it.
  const PROPERTIES = [
    { id: "garage1",   name: "Two-Bay Garage",   emoji: "🅿️", kind: "garage",    cost: 35000,   vehCap: 2,  anchor: "carlot",  off: { dx: -7, dz: 0 }, blurb: "A lock-up off the car lot. Two stalls — stash a hot ride and it's yours." },
    { id: "garage2",   name: "Ten-Car Block",    emoji: "🏢", kind: "garage",    cost: 140000,  vehCap: 10, anchor: "carlot",  off: { dx: 7, dz: 0 },  blurb: "A whole storage block. Ten bays for the collection." },
    { id: "warehouse", name: "Dockside Warehouse", emoji: "🏭", kind: "warehouse", cost: 450000,  vehCap: 6, ammoCap: 600, anchor: "beach", blurb: "A waterfront unit — six vehicle bays AND a steel AMMO LOCKER. Your armory." },
    { id: "hangar",    name: "Private Hangar",   emoji: "🛩️", kind: "hangar",    cost: 1200000, vehCap: 0,  anchor: "airport", blurb: "An apron hangar. The home a stolen F-22 needs — land it inside to keep it." },
  ];
  const PROP_BY_ID = {}; for (const p of PROPERTIES) PROP_BY_ID[p.id] = p;

  // ammo crates the warehouse locker can buy (id → engine weapon id, qty, $).
  const AMMO_CRATES = [
    { id: "sidearm", label: "9mm crate",    qty: 90,  cost: 600 },
    { id: "shotgun", label: "12-gauge box", qty: 40,  cost: 900 },
    { id: "carbine", label: "5.56 crate",   qty: 150, cost: 1400 },
    { id: "smg",     label: "SMG crate",    qty: 180, cost: 1300 },
    { id: "bazooka", label: "Rocket crate", qty: 6,   cost: 5200 },
  ];

  const RETRIEVE_CD = 120000;   // ms (~2 min) cooldown between vehicle retrievals

  // ============================================================
  //  STATE  (lazy-init; mirrored to worldstate w.storage)
  // ------------------------------------------------------------
  //  g.cityStorage = { owned:{ [id]:true }, vehicles:[ {kind,model,owner} ],
  //                    ammo:{ [weaponId]:n }, lastRetrieve:ms }
  // ============================================================
  function state() {
    if (!g.cityStorage) g.cityStorage = { owned: {}, vehicles: [], ammo: {}, lastRetrieve: 0 };
    const s = g.cityStorage;
    if (!s.owned) s.owned = {};
    if (!s.vehicles) s.vehicles = [];
    if (!s.ammo) s.ammo = {};
    if (s.lastRetrieve == null) s.lastRetrieve = 0;
    return s;
  }
  function owns(id) { return !!state().owned[id]; }
  function ownsKind(kind) { for (const p of PROPERTIES) if (p.kind === kind && owns(p.id)) return true; return false; }
  function ownedWarehouse() { return owns("warehouse") ? PROP_BY_ID.warehouse : null; }
  // total ground-vehicle storage capacity across owned garages + warehouse
  function vehCapTotal() { let c = 0; for (const p of PROPERTIES) if (owns(p.id)) c += (p.vehCap || 0); return c; }
  function storedVehicleCount() { return state().vehicles.length; }
  function ammoCapTotal() { const w = ownedWarehouse(); return w ? (w.ammoCap || 0) : 0; }

  function persist() {
    if (!CBZ.cityWorldEnsure) return;
    const w = CBZ.cityWorldEnsure(); if (!w) return;
    const s = state();
    // ADD-ONLY: a fresh w (worldstate fresh()) has no .storage; we create it.
    // Never touches any other ledger field, so the save shape is only extended.
    w.storage = {
      owned: JSON.parse(JSON.stringify(s.owned || {})),
      vehicles: JSON.parse(JSON.stringify(s.vehicles || [])),
      ammo: JSON.parse(JSON.stringify(s.ammo || {})),
    };
    if (CBZ.cityWorldCommit) { try { CBZ.cityWorldCommit(); } catch (e) {} }
  }
  function hydrate() {
    state();
    if (g._cityStorageHydrated) return;
    g._cityStorageHydrated = true;
    if (!CBZ.cityWorldEnsure) return;
    const w = CBZ.cityWorldEnsure(); if (!w || !w.storage) return;
    const src = w.storage, s = state();
    if (src.owned) for (const k in src.owned) if (PROP_BY_ID[k] && src.owned[k]) s.owned[k] = true;
    if (Array.isArray(src.vehicles)) s.vehicles = JSON.parse(JSON.stringify(src.vehicles));
    if (src.ammo) for (const k in src.ammo) s.ammo[k] = src.ammo[k] | 0;
  }

  // ============================================================
  //  PLACEMENT  (believable map spots, feature-detected anchors)
  // ------------------------------------------------------------
  //  Each property resolves to a world {x,z}. We drop a small beacon there and
  //  the [G] menu opens within radius. Anchors degrade gracefully: a missing
  //  car-lot / beach / airport just falls back to the arena centre so nothing
  //  is unreachable. Spots are cached per arena (recomputed if the arena rebuilds).
  // ============================================================
  const SPOT_R = 6.5;          // how close you must be to use a property
  let _spots = null, _spotsRoot = null;

  // the car-lot yard (mirror empire.js yardLot/yardZone)
  function carlotSpot() {
    const A = arena(); if (!A) return null;
    const lots = A.shopLots || (A.lots || []).filter((l) => l.building && l.building.shop);
    const lot = (lots && lots.find((l) => l.kind === "carlot")) || A.chopShop || null;
    if (lot && lot.building && lot.building.door) {
      const d = lot.building.door;
      return { x: d.x + (d.nx || 0) * 5, z: d.z + (d.nz || 0) * 5 };
    }
    return null;
  }
  // waterfront — the south-seawall beach span (arena.shore.beach + ES line)
  function beachSpot() {
    const A = arena(); if (!A) return null;
    const sh = A.shore;
    if (sh && sh.beach) {
      const bx = (sh.beach.x0 + sh.beach.x1) / 2;
      const bz = (sh.ES != null ? sh.ES : (A.maxZ || 0)) - 8;   // just inside the wall
      return { x: bx, z: bz };
    }
    return null;
  }
  // airport apron — find the registered airport region, sit on its tarmac edge
  function airportSpot() {
    const A = arena(); if (!A) return null;
    const regs = A.regions || [];
    const air = regs.find((r) => r.biome === "airport" && r.kind === "rect")
      || regs.find((r) => /airport/i.test(r.name || "") && r.kind === "rect");
    if (air) {
      const cx = (air.minX + air.maxX) / 2;
      const cz = (air.minZ + air.maxZ) / 2;
      return { x: cx, z: cz };
    }
    // fall back to the penthouse deck hangar if the airport island isn't built
    if (CBZ.cityMegaTower) { try { const t = CBZ.cityMegaTower(); if (t && t.hangar) return { x: t.hangar.x, z: t.hangar.z }; } catch (e) {} }
    return null;
  }
  function anchorPos(prop) {
    const A = arena(); const fallback = A ? { x: A.center.x, z: A.center.z } : { x: 0, z: 0 };
    let base = null;
    if (prop.anchor === "carlot") base = carlotSpot();
    else if (prop.anchor === "beach") base = beachSpot();
    else if (prop.anchor === "airport") base = airportSpot();
    base = base || fallback;
    return { x: base.x + ((prop.off && prop.off.dx) || 0), z: base.z + ((prop.off && prop.off.dz) || 0) };
  }

  // a small beacon so the property reads in-world (cheap; non-colliding).
  function beacon(x, z, color) {
    const root = arenaRoot(); if (!root) return null;
    const grp = new THREE.Group();
    grp.position.set(x, floorY(x, z), z);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.0, 0.3), cmat(0x2a2f38));
    post.position.y = 1.5; grp.add(post);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1, 0.16), cmat(color || 0x3a78c9, { emissive: 0x12243a, ei: 0.5 }));
    sign.position.y = 2.8; grp.add(sign);
    grp.userData.transient = true;   // arena.reset() sweeps it on a fresh run
    root.add(grp);
    return grp;
  }
  function buildSpots() {
    const root = arenaRoot(); if (!root) return null;
    if (_spots && _spotsRoot === root) return _spots;
    // arena rebuilt → drop the old beacons (transient sweep usually got them)
    if (_spots) { for (const s of _spots) { if (s.beacon && s.beacon.parent) s.beacon.parent.remove(s.beacon); } }
    _spots = [];
    for (const prop of PROPERTIES) {
      const p = anchorPos(prop);
      const col = prop.kind === "hangar" ? 0x6a7a4a : prop.kind === "warehouse" ? 0x9a6a3a : 0x3a78c9;
      const b = beacon(p.x, p.z, col);
      _spots.push({ prop, x: p.x, z: p.z, beacon: b });
    }
    _spotsRoot = root;
    return _spots;
  }
  function nearestSpot(x, z) {
    const spots = buildSpots(); if (!spots) return null;
    let best = null, bd = SPOT_R * SPOT_R;
    for (const s of spots) {
      const dx = s.x - x, dz = s.z - z, dd = dx * dx + dz * dz;
      if (dd < bd) { bd = dd; best = s; }
    }
    return best;
  }
  // the F-22 keep-AABB exposed to playeraircraft.js's keep-gate (only if owned)
  CBZ.cityStorageHangarHit = function (x, z) {
    if (!owns("hangar")) return false;
    const spots = buildSpots(); if (!spots) return false;
    const s = spots.find((q) => q.prop.id === "hangar"); if (!s) return false;
    const R = 14;   // roomier than the menu radius so a fast jet doesn't skip past
    return Math.abs(x - s.x) <= R && Math.abs(z - s.z) <= R;
  };

  // ============================================================
  //  BUY
  // ============================================================
  function buy(prop) {
    if (owns(prop.id)) { note("You already own the " + prop.name + ".", 1.6); return; }
    if (!canAfford(prop.cost)) { note("⛔ Need " + money(prop.cost) + " (cash + bank) for the " + prop.name + ".", 2.4); sfx("hit"); return; }
    charge(prop.cost);
    state().owned[prop.id] = true;
    big(prop.emoji + " ACQUIRED " + prop.name);
    note(prop.kind === "hangar" ? "Now STEAL an F-22 and land it inside to keep it." :
         prop.kind === "warehouse" ? "Vehicle bays + ammo locker online — your armory." :
         "A safe place to stash a hot ride — drive one in and store it.", 3);
    if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(Math.max(3, Math.round(prop.cost / 12000)));
    sfx("coin");
    persist();
    if (open_) render();
  }

  // ============================================================
  //  VEHICLE STORE / RETRIEVE
  // ------------------------------------------------------------
  //  STORE: at an owned garage/warehouse, if you're driving and under the total
  //  cap, record the model and reuse realestate.js's storeCar mechanics (exit +
  //  remove the car group + splice CBZ.cityCars). A HOT (stolen) car is laundered
  //  the instant it's stored — it becomes a permanent owned record.
  //  RETRIEVE: spawn it back as an owned car (CBZ.citySpawnOwnedCar). The jet, if
  //  ever stored, respawns via CBZ.citySpawnStolenJet({owned:true}). ~2-min CD.
  // ============================================================
  function canStoreVehicleHere(prop) { return prop.kind === "garage" || prop.kind === "warehouse"; }

  function storeCurrentVehicle() {
    const P = CBZ.player; if (!P) return;
    if (!P.driving || !P._vehicle) { note("Drive a vehicle in to store it.", 1.8); return; }
    if (storedVehicleCount() >= vehCapTotal()) { note("Storage full (" + storedVehicleCount() + "/" + vehCapTotal() + ") — pull one out first.", 2); sfx("hit"); return; }
    const car = P._vehicle;
    const model = (car.model && car.model.name) || "Sedan";
    state().vehicles.push({ kind: "car", model: model, owner: true });
    // realestate.js storeCar mechanics
    if (CBZ.cityExitVehicle) CBZ.cityExitVehicle();
    if (car.group && car.group.parent) car.group.parent.remove(car.group);
    if (CBZ.cityCars) { const idx = CBZ.cityCars.indexOf(car); if (idx >= 0) CBZ.cityCars.splice(idx, 1); }
    big("🅿️ Stored your " + model);
    note(car.stolen ? "A hot ride, laundered — it's yours now." : "Safely stored.", 2.4);
    sfx("door");
    persist();
    if (open_) render();
  }

  function retrieveVehicle(i) {
    const s = state();
    const v = s.vehicles[i]; if (!v) return;
    const left = RETRIEVE_CD - (now() - (s.lastRetrieve || 0));
    if (left > 0) { note("Retrieval cooling down — " + Math.ceil(left / 1000) + "s.", 1.8); return; }
    const P = CBZ.player; if (!P) return;
    // spawn it just beside the player so it appears at the property
    const ox = Math.sin((P.heading || 0)) * 3 + 3, oz = Math.cos((P.heading || 0)) * 3;
    const sx = P.pos.x + ox, sz = P.pos.z + oz;
    let spawned = false;
    if (v.kind === "jet") {
      if (CBZ.citySpawnStolenJet) { try { CBZ.citySpawnStolenJet(sx, sz, 0, { owned: true }); spawned = true; } catch (e) {} }
    } else {
      if (CBZ.citySpawnOwnedCar) { try { CBZ.citySpawnOwnedCar(sx, sz, v.model); spawned = true; } catch (e) {} }
    }
    if (!spawned) { note("Couldn't pull that out right now.", 1.8); return; }
    s.vehicles.splice(i, 1);
    s.lastRetrieve = now();
    note("🔑 Your " + (v.kind === "jet" ? "F-22" : v.model) + " is out front.", 2.4);
    sfx("door");
    persist();
    close();
  }

  // ============================================================
  //  AMMO STASH  (warehouse locker)
  // ------------------------------------------------------------
  //  Buy ammo crates (CBZ.city.spend) → the stash, capped per weapon at the
  //  warehouse ammoCap. "Load out" moves the whole stash into your carried
  //  reserves (CBZ.fpsAddAmmo(n, weaponId)). The stash IS your armory.
  // ============================================================
  function stashCount(id) { return state().ammo[id] | 0; }
  function buyAmmo(crate) {
    if (!owns("warehouse")) { note("You need the warehouse (ammo locker) for that.", 1.8); return; }
    const cap = ammoCapTotal();
    const have = stashCount(crate.id);
    if (have >= cap) { note(crate.label + " locker is full (" + cap + ").", 1.6); return; }
    const spend = CBZ.city && CBZ.city.spend ? CBZ.city.spend(crate.cost) : (canAfford(crate.cost) && charge(crate.cost));
    if (!spend) { note("⛔ " + crate.label + " costs " + money(crate.cost) + ".", 2); sfx("hit"); return; }
    state().ammo[crate.id] = Math.min(cap, have + crate.qty);
    note("📦 Stocked " + crate.label + " — locker " + stashCount(crate.id) + "/" + cap + ".", 2);
    sfx("coin");
    persist();
    if (open_) render();
  }
  function loadOut() {
    if (!owns("warehouse")) { note("No ammo locker — buy the warehouse.", 1.8); return; }
    const s = state(); let moved = 0;
    for (const id in s.ammo) {
      const n = s.ammo[id] | 0;
      if (n > 0 && CBZ.fpsAddAmmo) { try { CBZ.fpsAddAmmo(n, id); moved += n; s.ammo[id] = 0; } catch (e) {} }
    }
    if (moved <= 0) { note("Locker's empty — buy crates first.", 1.8); return; }
    big("🔫 Loaded out — " + moved + " rounds from the locker");
    sfx("coin");
    persist();
    if (open_) render();
  }

  // ============================================================
  //  [G] MENU  (proximity-gated overlay; number keys act)
  // ============================================================
  let panel = null, open_ = false, curSpot = null, actions = [];
  function el() {
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "cityStorage";
    panel.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:48;display:none;" +
      "min-width:360px;max-width:480px;background:rgba(14,18,24,.96);border:2px solid #2f3a44;border-radius:16px;" +
      "padding:14px 18px;color:#e8eef7;font-family:Fredoka,system-ui,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.5);pointer-events:auto";
    document.body.appendChild(panel);
    return panel;
  }
  function render() {
    if (!curSpot) return;
    const prop = curSpot.prop;
    actions = [];
    let html = "<div style='font-size:19px;font-weight:700;margin-bottom:3px'>" + prop.emoji + " " + prop.name + "</div>";
    html += "<div style='font-size:12px;color:#8a93a3;margin-bottom:9px'>Cash " + money(g.cash || 0) + " · Bank " + money(g.cityBank || 0) + "</div>";

    if (!owns(prop.id)) {
      html += "<div style='font-size:13px;color:#cfe0f5;margin-bottom:8px'>" + prop.blurb + "</div>";
      actions.push({ label: "Buy — " + money(prop.cost), fn: () => buy(prop) });
    } else {
      html += "<div style='font-size:12px;color:#7ed957;margin-bottom:6px'>OWNED ✓</div>";
      if (canStoreVehicleHere(prop)) {
        html += "<div style='font-size:12px;color:#9fb0c6;margin-bottom:6px'>Vehicles " + storedVehicleCount() + "/" + vehCapTotal() + " stored</div>";
        actions.push({ label: "Store the vehicle you're driving", fn: storeCurrentVehicle });
        const s = state();
        s.vehicles.forEach((v, i) => {
          actions.push({ label: "Pull out: " + (v.kind === "jet" ? "F-22 RAPTOR" : v.model), fn: () => retrieveVehicle(i) });
        });
      }
      if (prop.kind === "hangar") {
        html += "<div style='font-size:13px;color:#cfe0f5;margin-bottom:6px'>" + (g.cityOwnsJet ? "Your F-22 lives here." : "Land a STOLEN F-22 inside to keep it.") + "</div>";
      }
      if (prop.kind === "warehouse") {
        html += "<div style='font-size:12px;color:#cdb8ff;margin-top:8px;margin-bottom:3px'>🔒 AMMO LOCKER · cap " + ammoCapTotal() + "/weapon</div>";
        for (const c of AMMO_CRATES) {
          actions.push({ label: "Buy " + c.label + " (+" + c.qty + ") — " + money(c.cost) + "  [have " + stashCount(c.id) + "]", fn: () => buyAmmo(c) });
        }
        actions.push({ label: "LOAD OUT — move the whole locker to your guns", fn: loadOut });
      }
    }
    actions.forEach((a, i) => { html += "<div style='padding:3px 0;font-size:13px'><b style='color:#ffd166'>" + (i + 1) + "</b> " + a.label + "</div>"; });
    html += "<div style='font-size:11px;color:#6b7480;margin-top:9px'>[1–" + Math.min(9, actions.length) + "] select · [Esc] close</div>";
    el().innerHTML = html;
  }
  function open(spot) {
    if (CBZ.cityMenuOpen && !open_) return;
    hydrate();
    curSpot = spot; open_ = true; CBZ.cityMenuOpen = true;
    el().style.display = "block";
    render();
    if (document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
  }
  function close() {
    open_ = false; curSpot = null;
    if (panel) panel.style.display = "none";
    CBZ.cityMenuOpen = false;
    if (CBZ.requestLock && g.state === "playing") CBZ.requestLock();
  }
  CBZ.cityOpenStorage = function () {
    const P = CBZ.player; if (!P) return;
    const s = nearestSpot(P.pos.x, P.pos.z);
    if (s) open(s);
  };

  // ============================================================
  //  INPUT — [G] near a property; number keys in the menu. Military aircraft
  //  use the shared physical-vehicle interaction in militaryvehicles.js, so the
  //  parked prop, collider, taken state and flyable are one authoritative object.
  // ============================================================
  function activeCtx() { return g.mode === "city" && g.state === "playing"; }
  addEventListener("keydown", function (e) {
    if (!activeCtx()) return;
    const k = (e.key || "").toLowerCase();
    if (open_) {
      if (k === "escape") { e.preventDefault(); close(); return; }
      if (k >= "1" && k <= "9") { e.preventDefault(); const a = actions[parseInt(k, 10) - 1]; if (a) a.fn(); return; }
      return;
    }
    if (e.repeat) return;
    const P = CBZ.player; if (!P) return;
    if (k === "g" && !CBZ.cityMenuOpen) {
      const s = nearestSpot(P.pos.x, P.pos.z);
      if (s) { e.preventDefault(); open(s); }
    }
  });

  // ============================================================
  //  ON-FOOT PROMPT  (cheap; only when not flying/driving/menu-open)
  // ============================================================
  let _promptEl = null;
  function promptEl() {
    if (_promptEl) return _promptEl;
    if (typeof document === "undefined" || !document.body) return null;
    const d = document.createElement("div");
    d.id = "cityStoragePrompt";
    d.style.cssText = "position:fixed;left:50%;bottom:118px;transform:translateX(-50%);" +
      "font:700 15px/1.4 ui-sans-serif,system-ui,sans-serif;color:#bfe2ff;text-align:center;" +
      "background:rgba(8,12,18,0.6);padding:7px 16px;border-radius:9px;border:1px solid rgba(120,180,255,0.35);" +
      "pointer-events:none;z-index:60;display:none;text-shadow:0 1px 3px #000";
    document.body.appendChild(d);
    _promptEl = d;
    return d;
  }
  function showPrompt(msg) { const e = promptEl(); if (!e) return; e.style.display = "block"; e.innerHTML = msg; }
  function hidePrompt() { if (_promptEl) _promptEl.style.display = "none"; }

  CBZ.onUpdate(13.5, function () {
    if (g.mode !== "city") { hidePrompt(); return; }
    if (!arenaRoot()) return;
    hydrate();
    const P = CBZ.player;
    if (!P || P.dead || P._aircraft || CBZ.cityMenuOpen || g.state !== "playing") { hidePrompt(); return; }
    const x = P.pos.x, z = P.pos.z;
    const s = nearestSpot(x, z);
    if (s) {
      const prop = s.prop;
      if (!owns(prop.id)) showPrompt("[G] " + prop.name + " — Buy " + money(prop.cost));
      else if (prop.kind === "hangar") showPrompt("[G] " + prop.name + (g.cityOwnsJet ? "" : " — land a stolen F-22 here"));
      else showPrompt("[G] " + prop.name + " — store / retrieve" + (prop.kind === "warehouse" ? " / ammo" : ""));
      return;
    }
    hidePrompt();
  });

  // ============================================================
  //  RESET (new run / mode switch). Keep the owned PROPERTIES + stash persistent
  //  across runs via the ledger (hydrate re-reads them); only clear the live
  //  beacons + per-run UI + the hydrate guard so a reload re-pulls the ledger.
  // ============================================================
  function teardown() {
    g._cityStorageHydrated = false;
    _spots = null; _spotsRoot = null;
    if (panel) panel.style.display = "none";
    open_ = false; curSpot = null;
    hidePrompt();
  }
  CBZ.cityStorageReset = teardown;

  // chain onto the vehicles reset so a fresh run re-hydrates the ledger + re-anchors
  // beacons against the rebuilt arena. Same lazy-wrap hook playeraircraft.js uses.
  // Idempotent flag guard means a hot reload can't double-chain.
  function bindResetChain() {
    if (CBZ.cityVehiclesReset && !CBZ.cityVehiclesReset._storageWrapped) {
      const orig = CBZ.cityVehiclesReset;
      CBZ.cityVehiclesReset = function () { try { teardown(); } catch (e) {} return orig.apply(this, arguments); };
      CBZ.cityVehiclesReset._storageWrapped = true;
      return true;
    }
    return false;
  }
  if (!bindResetChain()) {
    CBZ.onUpdate(14.5, function () {
      if (CBZ.cityVehiclesReset && CBZ.cityVehiclesReset._storageWrapped) return;
      bindResetChain();
    });
  }

  // ============================================================
  //  PUBLIC SURFACE
  // ============================================================
  CBZ.cityStorage = {
    PROPERTIES, AMMO_CRATES,
    owns, buy, state,
    storeVehicle: storeCurrentVehicle, retrieveVehicle, vehCapTotal, storedVehicleCount,
    buyAmmo, loadOut, stashCount, ammoCapTotal,
    open: CBZ.cityOpenStorage, close,
    spots: buildSpots,
  };
})();
