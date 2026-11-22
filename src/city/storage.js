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

   Walk up to a property's sign: what you do there is on it (Buy it; Park it
   inside from the driver's seat; Bring out a car by name; Load out and
   stock the locker). No menu. Boarding the parked military jet steals it (4★).

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
    { id: "garage1",   name: "Two-Bay Garage",   emoji: "", kind: "garage",    cost: 35000,   vehCap: 2,  anchor: "carlot",  off: { dx: -7, dz: 0 }, blurb: "A lock-up off the car lot. Two stalls, stash a hot ride and it's yours." },
    { id: "garage2",   name: "Ten-Car Block",    emoji: "", kind: "garage",    cost: 140000,  vehCap: 10, anchor: "carlot",  off: { dx: 7, dz: 0 },  blurb: "A whole storage block. Ten bays for the collection." },
    { id: "warehouse", name: "Dockside Warehouse", emoji: "", kind: "warehouse", cost: 450000,  vehCap: 6, ammoCap: 600, anchor: "beach", blurb: "A waterfront unit, six vehicle bays AND a steel AMMO LOCKER. Your armory." },
    { id: "hangar",    name: "Private Hangar",   emoji: "", kind: "hangar",    cost: 1200000, vehCap: 0,  anchor: "airport", blurb: "An apron hangar. The home a stolen F-35 needs, land it inside to keep it." },
    /* THE FREEPORT — the top of this ladder, and the first property in the
       game that is a PLACE ON ITS OWN LAND rather than a spot on somebody
       else's. It is city/govcomplex.js's `freeport` COMPLEXES row: a bonded
       yard outside the city with a fence, a gate, a shed, a loading dock,
       container stacks and a lit cargo strip.

       WHY IT IS A ROW HERE AND NOT A SECOND PROPERTY SYSTEM: this file
       already owns "which places does the player own", the [G] menu, the
       vehicle bays, the ammo locker and the save slot. The Freeport needs
       all five, so it takes them — and city/cashstore.js adds the ONE thing
       this file has never had a word for, which is money you can stack on a
       shelf. Ownership is read from here by that file; there is no second
       boolean anywhere.

       PRICE: $1.75M, between wealth.js's casino floor ($1.2M) and its REIT
       tower ($3.5M) — more than any single building you can buy, less than
       owning a skyline. And it is the only property in the game you can pay
       for in DUFFELS at the gate (cashstore.js's escrow), which is what
       stops the first unbankable vault haul from being worthless. */
    { id: "freeport",  name: "Freeport Compound", emoji: "", kind: "compound", cost: 1750000, vehCap: 8, ammoCap: 900, anchor: "freeport", blurb: "A bonded freight yard on its own land, dock, racks, container yard and a cargo strip. The only place in the world you can bank a duffel." },
  ];
  const PROP_BY_ID = {}; for (const p of PROPERTIES) PROP_BY_ID[p.id] = p;

  // ammo crates the warehouse locker can buy (id → engine weapon id, qty, $).
  const AMMO_CRATES = [
    { id: "sidearm", label: "9mm crate",    qty: 90,  cost: 600 },
    { id: "shotgun", label: "12-gauge box", qty: 40,  cost: 900 },
    { id: "carbine", label: "5.56 crate",   qty: 150, cost: 1400 },
    { id: "smg",     label: "SMG crate",    qty: 180, cost: 1300 },
    { id: "bazooka", label: "Rocket crate", qty: 6,   cost: 5200 },
    { id: "glauncher", label: "40mm crate", qty: 12,  cost: 2600 },
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
  // the AMMO LOCKER lives at the dockside warehouse OR the Freeport shed —
  // both are "a place with steel shelves you own", and the locker cap is the
  // best one you hold rather than the sum (one armory, not two).
  function ownedWarehouse() {
    let best = null;
    for (const p of PROPERTIES) {
      if (!p.ammoCap || !owns(p.id)) continue;
      if (!best || p.ammoCap > best.ammoCap) best = p;
    }
    return best;
  }
  // total ground-vehicle storage capacity across owned garages + warehouse
  // + every garage you built on your own land (city/compoundkit.js, 2 bays each)
  function vehCapTotal() {
    let c = 0; for (const p of PROPERTIES) if (owns(p.id)) c += (p.vehCap || 0);
    if (CBZ.compoundKit && CBZ.compoundKit.garageBays) { try { c += CBZ.compoundKit.garageBays() | 0; } catch (e) {} }
    return c;
  }
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
  //  the property menu opens within radius. Anchors degrade gracefully: a missing
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
  // THE FREEPORT'S OWN LAND. city/govcomplex.js placed the plot and published
  // the gate it pushed a road to; asking that record is the only honest answer
  // (a guessed offset is how you end up with a beacon inside a fence). Absent
  // the complex — flag off, or a world where the placer found no clear ground
  // — this returns null and the row falls back like every other anchor, so the
  // property is never unreachable.
  function freeportSpot() {
    const L = CBZ.govComplexes;
    if (!L) return null;
    for (let i = 0; i < L.length; i++) {
      const s = L[i];
      if (!s || s.id !== "freeport" || !s.rect) continue;
      const gt = s.gate || { x: s.cx, z: s.rect.maxZ };
      return { x: gt.x + 7.5, z: gt.z - 11 };     // just inside the gate, off the lane
    }
    return null;
  }
  function anchorPos(prop) {
    const A = arena(); const fallback = A ? { x: A.center.x, z: A.center.z } : { x: 0, z: 0 };
    let base = null;
    if (prop.anchor === "carlot") base = carlotSpot();
    else if (prop.anchor === "beach") base = beachSpot();
    else if (prop.anchor === "airport") base = airportSpot();
    else if (prop.anchor === "freeport") base = freeportSpot();
    base = base || fallback;
    return { x: base.x + ((prop.off && prop.off.dx) || 0), z: base.z + ((prop.off && prop.off.dz) || 0) };
  }

  /* THE SIGN ON THE LOT (rebuild 2026-10-31, Opus 5.5). It was a grey stick
     with a glowing coloured box on it. A property for sale is marked the way
     a real one is: a two-post galvanised frame with a crossbar, a printed
     agent's board swinging from it on S-hooks (the kind's colour band, FOR
     SALE, the property's name, its price, the agency), and a SOLD rider
     bolted across the top the moment it is yours. One canvas per property;
     the board is faintly self-lit so it still reads at night. */
  const SIGN = { post: null, bar: null, hook: null, board: null, rider: null, steel: null, edge: null };
  function signGeo() {
    if (SIGN.post) return SIGN;
    SIGN.post = new THREE.BoxGeometry(0.07, 2.5, 0.07);
    SIGN.bar = new THREE.BoxGeometry(1.5, 0.06, 0.06);
    SIGN.hook = new THREE.TorusGeometry(0.035, 0.007, 4, 10);
    SIGN.board = new THREE.BoxGeometry(1.2, 0.8, 0.025);
    SIGN.rider = new THREE.BoxGeometry(1.2, 0.22, 0.02);
    SIGN.cap = new THREE.BoxGeometry(0.1, 0.03, 0.1);
    SIGN.steel = new THREE.MeshLambertMaterial({ color: 0xb4bac0 });
    SIGN.edge = new THREE.MeshLambertMaterial({ color: 0xe9e6dc });
    for (const k in SIGN) if (SIGN[k]) SIGN[k]._shared = true;
    return SIGN;
  }
  const KIND_BAND = { garage: "#2f5f9e", warehouse: "#8a5a2c", hangar: "#4f6a36", compound: "#a8661a" };
  const KIND_WORD = { garage: "LOCK-UP GARAGE", warehouse: "WATERFRONT WAREHOUSE", hangar: "AIRCRAFT HANGAR", compound: "BONDED FREIGHT YARD" };
  function signTex(prop, sold) {
    const c = document.createElement("canvas");
    c.width = 512; c.height = 340;
    const x = c.getContext("2d");
    x.fillStyle = "#f4f1e8"; x.fillRect(0, 0, 512, 340);
    x.fillStyle = KIND_BAND[prop.kind] || "#2f5f9e"; x.fillRect(0, 0, 512, 96);
    x.fillStyle = "#ffffff"; x.textAlign = "center"; x.textBaseline = "middle";
    x.font = "bold 64px Arial"; x.fillText(sold ? "SOLD" : "FOR SALE", 256, 50);
    x.fillStyle = "#1d2228"; x.font = "bold 40px Arial"; x.fillText(String(prop.name || "").toUpperCase(), 256, 140);
    x.fillStyle = "#59606a"; x.font = "24px Arial"; x.fillText(KIND_WORD[prop.kind] || "PROPERTY", 256, 182);
    x.fillStyle = "#1d2228"; x.font = "bold 50px Arial"; x.fillText(money(prop.cost), 256, 236);
    x.fillStyle = KIND_BAND[prop.kind] || "#2f5f9e"; x.fillRect(24, 278, 464, 4);
    x.fillStyle = "#3a4048"; x.font = "bold 22px Arial"; x.fillText("MERIDIAN PROPERTIES  ·  555-0142", 256, 310);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 2;
    return t;
  }
  function makeSign(prop, color) {
    const G = signGeo();
    const grp = new THREE.Group();
    grp.name = "property-sign";
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(G.post, G.steel); p.position.set(s * 0.7, 1.25, 0); grp.add(p);
      const cp = new THREE.Mesh(G.cap, G.steel); cp.position.set(s * 0.7, 2.515, 0); grp.add(cp);
    }
    const bar = new THREE.Mesh(G.bar, G.steel); bar.position.set(0, 2.32, 0); grp.add(bar);
    for (const s of [-1, 1]) {
      const h = new THREE.Mesh(G.hook, G.steel); h.position.set(s * 0.48, 2.26, 0); h.rotation.y = Math.PI / 2; grp.add(h);
    }
    const tex = prop ? signTex(prop, false) : null;
    const face = tex ? new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.18 })
      : new THREE.MeshLambertMaterial({ color: color || 0x3a78c9 });
    const board = new THREE.Mesh(G.board, [G.edge, G.edge, G.edge, G.edge, face, face]);
    board.position.set(0, 1.82, 0);
    board.rotation.x = 0.03;                          // it hangs, so it never quite plumbs
    grp.add(board);
    const soldTex = prop ? signTex(prop, true) : null;
    grp.userData.signFace = face; grp.userData.signTex = { sale: tex, sold: soldTex };
    // the SOLD rider bolted across the crossbar
    if (prop) {
      const c = document.createElement("canvas"); c.width = 256; c.height = 48;
      const q = c.getContext("2d");
      q.fillStyle = "#b3261e"; q.fillRect(0, 0, 256, 48);
      q.fillStyle = "#ffffff"; q.font = "bold 34px Arial"; q.textAlign = "center"; q.textBaseline = "middle"; q.fillText("SOLD", 128, 26);
      const rt = new THREE.CanvasTexture(c);
      const rm = new THREE.MeshLambertMaterial({ map: rt });
      const rider = new THREE.Mesh(G.rider, [G.edge, G.edge, G.edge, G.edge, rm, rm]);
      rider.position.set(0, 2.5, 0);
      rider.visible = false;
      grp.add(rider);
      grp.userData.rider = rider;
    }
    grp.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; o.userData.storageSign = true; } });
    return grp;
  }
  function beacon(x, z, color, prop) {
    const root = arenaRoot(); if (!root) return null;
    const grp = makeSign(prop, color);
    grp.position.set(x, floorY(x, z), z);
    grp.userData.transient = true;   // arena.reset() sweeps it on a fresh run
    root.add(grp);
    return grp;
  }
  // the board says what the ledger says: SOLD rider up and the face reprinted
  // once you own it (checked when the spots are walked, and right after a buy)
  function refreshSigns() {
    if (!_spots) return;
    for (const s of _spots) {
      const b = s.beacon; if (!b || !b.userData) continue;
      const own = owns(s.prop.id);
      if (b.userData._sold === own) continue;
      b.userData._sold = own;
      if (b.userData.rider) b.userData.rider.visible = own;
      const f = b.userData.signFace, T = b.userData.signTex;
      if (f && T && T.sale && T.sold) { f.map = own ? T.sold : T.sale; f.emissiveMap = f.map; f.needsUpdate = true; }
    }
  }
  CBZ.storageSign = function (id) {                 // the turntable's door: one sign, alone
    return makeSign(PROP_BY_ID[id || "garage1"] || PROPERTIES[0]);
  };
  function buildSpots() {
    const root = arenaRoot(); if (!root) return null;
    if (_spots && _spotsRoot === root) return _spots;
    // arena rebuilt → drop the old beacons (transient sweep usually got them)
    if (_spots) { for (const s of _spots) { if (s.beacon && s.beacon.parent) s.beacon.parent.remove(s.beacon); } }
    _spots = [];
    for (const prop of PROPERTIES) {
      const p = anchorPos(prop);
      const col = prop.kind === "hangar" ? 0x6a7a4a : prop.kind === "compound" ? 0xb0761f : prop.kind === "warehouse" ? 0x9a6a3a : 0x3a78c9;
      const b = beacon(p.x, p.z, col, prop);
      _spots.push({ prop, x: p.x, z: p.z, beacon: b });
    }
    _spotsRoot = root;
    refreshSigns();
    return _spots;
  }
  function nearestSpot(x, z) {
    const spots = buildSpots(); if (!spots) return null;
    refreshSigns();
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
    /* THE FREEPORT CLOSES THROUGH cashstore.js, and that is not indirection
       for its own sake: money already handed over IN BAGS at the gate sits in
       an escrow that file owns, so the price left to pay is not `prop.cost`.
       Charging the full figure here would bill the player twice for the same
       duffels. It grants ownership back through grant() below. */
    if (prop.id === "freeport" && CBZ.cashStore && CBZ.cashStore.buy) {
      CBZ.cashStore.buy();
      return;
    }
    if (!canAfford(prop.cost)) { note("Need " + money(prop.cost) + " (cash + bank) for the " + prop.name + ".", 2.4); sfx("hit"); return; }
    charge(prop.cost);
    state().owned[prop.id] = true;
    big(prop.emoji + " ACQUIRED " + prop.name);
    if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(Math.max(3, Math.round(prop.cost / 12000)));
    sfx("coin");
    persist();
    refreshSigns();
  }

  /* GRANT — mark a property owned WITHOUT charging for it, for a caller that
     has already collected the money its own way (cashstore.js's bag escrow is
     the first and only one). It is deliberately not a general back door: the
     id must be a real row, and the ledger write + save is identical to buy()'s
     so nothing downstream can tell the two apart. */
  function grant(id) {
    const prop = PROP_BY_ID[id];
    if (!prop || owns(id)) return false;
    state().owned[id] = true;
    persist();
    return true;
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
  function canStoreVehicleHere(prop) { return prop.kind === "garage" || prop.kind === "warehouse" || prop.kind === "compound"; }

  function storeCurrentVehicle() {
    const P = CBZ.player; if (!P) return;
    if (!P.driving || !P._vehicle) { note("Drive a vehicle in to store it.", 1.8); return; }
    if (storedVehicleCount() >= vehCapTotal()) { note("Storage full (" + storedVehicleCount() + "/" + vehCapTotal() + "), pull one out first.", 2); sfx("hit"); return; }
    const car = P._vehicle;
    const model = (car.model && car.model.name) || "Sedan";
    state().vehicles.push({ kind: "car", model: model, owner: true });
    // realestate.js storeCar mechanics
    if (CBZ.cityExitVehicle) CBZ.cityExitVehicle();
    if (car.group && car.group.parent) car.group.parent.remove(car.group);
    if (CBZ.cityCars) { const idx = CBZ.cityCars.indexOf(car); if (idx >= 0) CBZ.cityCars.splice(idx, 1); }
    big("Stored your " + model);
    note(car.stolen ? "A hot ride, laundered, it's yours now." : "Safely stored.", 2.4);
    persist();
  }

  function retrieveVehicle(i) {
    const s = state();
    const v = s.vehicles[i]; if (!v) return;
    const left = RETRIEVE_CD - (now() - (s.lastRetrieve || 0));
    if (left > 0) { note("Retrieval cooling down · " + Math.ceil(left / 1000) + "s.", 1.8); return; }
    const P = CBZ.player; if (!P) return;
    // spawn it just beside the player so it appears at the property
    const ox = Math.sin((P.heading || 0)) * 3 + 3, oz = Math.cos((P.heading || 0)) * 3;
    const sx = P.pos.x + ox, sz = P.pos.z + oz;
    let spawned = false, berthed = null;
    if (v.kind === "jet") {
      // null while the F-35's file is still loading (it has been asked for): try again
      if (CBZ.citySpawnStolenJet) { try { spawned = !!CBZ.citySpawnStolenJet(sx, sz, 0, { owned: true }); } catch (e) {} }
    } else if (CBZ.cityBerth && CBZ.cityBerth.isMarine && CBZ.cityBerth.isMarine(v.model)) {
      // A BERTH, not a bay. Every storage spot in this file is on LAND, so a
      // boat pulled out of the Dockside Warehouse used to appear beached in a
      // car park. city/marina.js's CBZ.cityBerth owns water-side spots; ask it
      // for one that fits, and tell the player where she actually went.
      const dims = CBZ.cityBerth.dimsFor(v.model);
      const b = CBZ.cityBerth.free(dims.loa, dims.beam) || CBZ.cityBerth.nearest(sx, sz);
      if (b && CBZ.cityBerth.spawn) { try { spawned = !!CBZ.cityBerth.spawn(b, v.model); berthed = b; } catch (e) {} }
      // degrade-safe: no berth anywhere -> the old inline behaviour, unchanged
      if (!spawned && CBZ.citySpawnOwnedCar) { try { CBZ.citySpawnOwnedCar(sx, sz, v.model); spawned = true; } catch (e) {} }
    } else {
      if (CBZ.citySpawnOwnedCar) { try { CBZ.citySpawnOwnedCar(sx, sz, v.model); spawned = true; } catch (e) {} }
    }
    if (!spawned) { note("Couldn't pull that out right now.", 1.8); return; }
    s.vehicles.splice(i, 1);
    s.lastRetrieve = now();
    if (berthed) {
      note("Your " + v.model + " is in the water at " + (berthed.label || berthed.id) + ".", 2.8);
      if (CBZ.fullMap && CBZ.fullMap.setWaypoint) { try { CBZ.fullMap.setWaypoint(berthed.x, berthed.z, v.model); } catch (e) {} }
    } else note("Your " + (v.kind === "jet" ? "F-35" : v.model) + " is out front.", 2.4);
    persist();
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
    if (!ownedWarehouse()) { note("You need a warehouse or the Freeport (an ammo locker) for that.", 1.8); return; }
    const cap = ammoCapTotal();
    const have = stashCount(crate.id);
    if (have >= cap) { note(crate.label + " locker is full (" + cap + ").", 1.6); return; }
    const spend = CBZ.city && CBZ.city.spend ? CBZ.city.spend(crate.cost) : (canAfford(crate.cost) && charge(crate.cost));
    if (!spend) { note("" + crate.label + " costs " + money(crate.cost) + ".", 2); sfx("hit"); return; }
    state().ammo[crate.id] = Math.min(cap, have + crate.qty);
    note("Stocked " + crate.label + " · locker " + stashCount(crate.id) + "/" + cap + ".", 2);
    sfx("coin");
    persist();
  }
  function loadOut() {
    if (!ownedWarehouse()) { note("No ammo locker, buy the warehouse or the Freeport.", 1.8); return; }
    const s = state(); let moved = 0;
    for (const id in s.ammo) {
      const n = s.ammo[id] | 0;
      if (n > 0 && CBZ.fpsAddAmmo) { try { CBZ.fpsAddAmmo(n, id); moved += n; s.ammo[id] = 0; } catch (e) {} }
    }
    if (moved <= 0) { note("Locker's empty, buy crates first.", 1.8); return; }
    big("Loaded out · " + moved + " rounds from the locker");
    sfx("coin");
    persist();
  }

  // ============================================================
  //  THE PROPERTY IS A THING YOU STAND AT (city/interactions.js). Its sign is
  //  in the world (makeSign) and what you do there is on it: E, the wheel, a
  //  tap, on foot or at the wheel.
  //    not yours     Buy it $X
  //    yours, in a car        Park it inside
  //    yours, on foot         Bring out the <last one in>   (each car by name
  //                           round the wheel), Load out the locker, Stock a
  //                           crate (a warehouse's ammo locker)
  //  and its card says what is in it. (This was a numbered HTML menu: a cash
  //  readout, a blurb, a table of stored vehicles, a table of ammo crates.)
  // ============================================================
  function asIs(s) { const VW = CBZ.cityVerbWord; if (VW && VW.keep) VW.keep(s); return s; }
  function vehName(v) { return v ? (v.kind === "jet" ? "F-35" : v.model) : ""; }
  function lockerProp(prop) { return !!(prop && (prop.virtual ? false : (prop.kind === "warehouse" || prop.kind === "compound"))); }
  function stashTotal() { const a = state().ammo; let n = 0; for (const k in a) n += a[k] | 0; return n; }
  function contentsNote(prop) {
    if (!prop.virtual && !owns(prop.id)) return prop.blurb || "";
    const v = state().vehicles;
    let s = canStoreVehicleHere(prop) ? (v.length ? v.length + " of " + vehCapTotal() + " bays: " + v.slice(-3).reverse().map(vehName).join(", ") + (v.length > 3 ? " and " + (v.length - 3) + " more" : "") : "bays empty") : "";
    if (lockerProp(prop)) s += (s ? ". " : "") + (stashTotal() ? stashTotal() + " rounds in the locker" : "locker empty");
    return s;
  }
  // the last vehicle put in comes out first
  function retrieveLast() { const n = state().vehicles.length; if (n) retrieveVehicle(n - 1); return n > 0; }
  CBZ.cityOpenStorage = function () { return false; };     // (there is no menu to open)
  let zoned = false;
  function wireZone() {
    if (zoned || !CBZ.interactions || !CBZ.interactions.registerZone) return;
    zoned = true;
    const owe = (prop) => (prop.id === "freeport" && CBZ.cashStore && CBZ.cashStore.remaining) ? CBZ.cashStore.remaining() : prop.cost;
    const mine = (s) => owns(s.prop.id);
    const onFoot = (ctx) => !(ctx && ctx.driving);
    const opts = [
      { id: "property-buy", slot: "e", prio: 5, campaignSafe: true, label: (s) => asIs("Buy it " + money(owe(s.prop))),
        canShow: (s) => !mine(s), onSelect: (s) => buy(s.prop) },
      { id: "property-park", slot: "e", prio: 6, campaignSafe: true, label: () => asIs("Park it inside"),
        canShow: (s, ctx) => mine(s) && !onFoot(ctx) && canStoreVehicleHere(s.prop), onSelect: () => storeCurrentVehicle() },
      { id: "property-out", slot: "e", prio: 5, campaignSafe: true,
        label: () => { const v = state().vehicles; return asIs("Bring out the " + vehName(v[v.length - 1])); },
        canShow: (s, ctx) => mine(s) && onFoot(ctx) && canStoreVehicleHere(s.prop) && state().vehicles.length > 0, onSelect: () => retrieveLast() },
      { id: "property-loadout", prio: 4, campaignSafe: true, label: () => asIs("Load out, " + stashTotal() + " rounds"),
        canShow: (s, ctx) => mine(s) && onFoot(ctx) && lockerProp(s.prop) && stashTotal() > 0, onSelect: () => loadOut() },
    ];
    for (let n = 0; n < 8; n++) {
      opts.push({ id: "property-out-" + n, wheel: true, prio: 3, campaignSafe: true,
        label: () => asIs("Bring out the " + vehName(state().vehicles[n])),
        canShow: (s, ctx) => mine(s) && onFoot(ctx) && canStoreVehicleHere(s.prop) && !!state().vehicles[n] && n !== state().vehicles.length - 1,
        onSelect: () => retrieveVehicle(n) });
    }
    AMMO_CRATES.forEach((crate) => {
      opts.push({ id: "property-crate-" + crate.id, wheel: true, prio: 2, campaignSafe: true,
        label: () => asIs("Stock a " + crate.label + " " + money(crate.cost)),
        canShow: (s, ctx) => mine(s) && onFoot(ctx) && lockerProp(s.prop) && stashCount(crate.id) < ammoCapTotal(),
        onSelect: () => buyAmmo(crate) });
    });
    CBZ.interactions.registerZone({
      id: "zone-property", kind: "property", radius: SPOT_R, prio: 7,
      find: function (px, pz) {
        const P = CBZ.player;
        if (!P || P._aircraft) return null;
        return nearestSpot(px, pz);
      },
      options: opts,
    });
    CBZ.interactions.describe("property", function (s) { return { label: (s && s.prop && s.prop.name) || "", note: s && s.prop ? contentsNote(s.prop) : "" }; });
  }
  CBZ.onUpdate(13.5, function () {
    if (g.mode !== "city" || !arenaRoot()) return;
    hydrate();
    wireZone();
  });

  // ============================================================
  //  RESET (new run / mode switch). Keep the owned PROPERTIES + stash persistent
  //  across runs via the ledger (hydrate re-reads them); only clear the live
  //  beacons + per-run UI + the hydrate guard so a reload re-pulls the ledger.
  // ============================================================
  function teardown() {
    g._cityStorageHydrated = false;
    _spots = null; _spotsRoot = null;
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
    owns, buy, grant, state,
    storeVehicle: storeCurrentVehicle, retrieveVehicle, vehCapTotal, storedVehicleCount,
    buyAmmo, loadOut, stashCount, ammoCapTotal,
    retrieveLast, contentsNote,
    spots: buildSpots,
  };
})();
