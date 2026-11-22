/* ============================================================
   city/storage.js — PROPERTY YOU KEEP THINGS IN. A lock-up is a real unit
   with a roller door you raise: your cars are parked inside it, your crates
   and guns are on the floor and the rack where you put them.

   THE FIVE PROPERTIES
     garage1 / garage2   two lock-up blocks on the nearest clear hardstanding
                         to the car lot (2 bays / 10 bays, a door a bay)
     warehouse           a dockside shed by the beach: 6 bays, 3 wide doors
     freeport            an 8-bay block inside the Freeport's own fence
                         (city/govcomplex.js built the yard; its sign stays
                         at the gate, where the yard is sold)
     hangar              the airfield's own small hangar (city/airport_kit.js
                         built it). Nothing is built here: the sign stands at
                         its doors and the F-35 keep-gate is its floor
                         (CBZ.cityStorageHangarHit, read by playeraircraft.js)

   WHERE A UNIT STANDS is found, not typed: the nearest rectangle to its
   anchor that is dry, flat, off every road, lot, plot, keep-out and collider,
   with a clear forecourt in front of the doors (findSite). The site is saved
   and checked again on every boot, so a unit stays put unless the world under
   it changed.

   WHAT IS IN A UNIT (all of it in the save slot w.storage)
     cars     a record per car: which place, where in it (unit-local metres
              and heading), model, paint, mods, still hot or not. A car you
              leave inside stays exactly there, as a real CBZ.cityCars car;
              its body is put back whenever you are near, after a reload too.
              Taking it out is getting in and driving out: the record goes
              when the car leaves. A stolen car behind a shut door is yours.
              The same rule keeps the cars in a garage you built on your own
              land (city/compoundkit.js lists those as places).
     guns     on the rack on the back wall: the gun in your hands goes up
              (CBZ.lockWeapon), a gun comes down (CBZ.unlockWeapon)
     crates   ammunition is bought by the crate from a gun-shop clerk
              (CBZ.cityCounterAsk), carried as an item, put down on the
              pallet, and rounds are taken out of the box on the floor

   VERBS (city/interactions.js): Buy it $X on the sign · Raise / Lower on a
   door (on foot or from the driver's seat) · Put up / Take on the rack ·
   Stack on the pallet · Take N rounds / Take all on a crate.

   DRAW CALLS: a unit is two merged kits (shell + inside, ~6 meshes), one mesh
   per door, the sign; built when you are within sight and freed past it.

   Exposes: CBZ.cityStorage, CBZ.cityStorageHangarHit, CBZ.cityStorageReset,
   CBZ.storageSign.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  function money(n) { n = Math.round(n || 0); return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(); }
  function note(m, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(m, s); }
  function big(m) { if (CBZ.city && CBZ.city.big) CBZ.city.big(m); }
  function sfx(n) { if (CBZ.sfx) { try { CBZ.sfx(n); } catch (e) {} } }
  function arena() { return (CBZ.city && CBZ.city.arena) || null; }
  function arenaRoot() { const a = arena(); return a ? a.root : null; }
  function floorY(x, z) { if (CBZ.floorAt) { try { return +CBZ.floorAt(x, z) || 0; } catch (e) {} } return 0; }
  function asIs(s) { const VW = CBZ.cityVerbWord; if (VW && VW.keep) VW.keep(s); return s; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function r2(n) { return Math.round(n * 100) / 100; }
  function wrap(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }

  // cash first, then the bank
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
  //  THE CATALOG
  //  unit: bays (cars), perDoor (bays behind one door), depth, h, doorH,
  //        pegs (guns on the rack), crates (boxes on the pallet), colours
  // ============================================================
  const PROPERTIES = [
    { id: "garage1", name: "Two-Bay Garage", kind: "garage", cost: 35000, anchor: "carlot",
      unit: { bays: 2, perDoor: 1, depth: 7.4, h: 3.0, doorH: 2.4, pegs: 4, crates: 2, wall: 0x6f665b, door: 0x163a6e, roof: 0x25272b },
      blurb: "A lock-up off the car lot. Two bays, a roller door each." },
    { id: "garage2", name: "Ten-Car Block", kind: "garage", cost: 140000, anchor: "carlot", after: "garage1",
      unit: { bays: 10, perDoor: 1, depth: 7.4, h: 3.0, doorH: 2.4, pegs: 6, crates: 4, wall: 0x6f665b, door: 0x1d4a2c, roof: 0x25272b },
      blurb: "A whole row of lock-ups. Ten bays, ten doors." },
    { id: "warehouse", name: "Dockside Warehouse", kind: "warehouse", cost: 450000, anchor: "beach",
      unit: { bays: 6, perDoor: 2, depth: 11.5, h: 4.6, doorH: 3.4, pegs: 8, crates: 8, wall: 0x596169, door: 0x7c3d10, roof: 0x2a2e33 },
      blurb: "A shed on the water. Six bays behind three wide doors, a rack and a pallet for the armoury." },
    { id: "hangar", name: "Private Hangar", kind: "hangar", cost: 1200000, anchor: "airport",
      blurb: "A hangar on the field. Land a stolen F-35 inside it and it is yours." },
    /* THE FREEPORT is city/govcomplex.js's `freeport` yard, and it closes
       through city/cashstore.js (money handed over in bags at the gate sits in
       an escrow that file owns, so the price left to pay is not `cost`). This
       file owns the deed (owns / grant) and the vehicle block in the yard. */
    { id: "freeport", name: "Freeport Compound", kind: "compound", cost: 1750000, anchor: "freeport",
      unit: { bays: 8, perDoor: 2, depth: 8.4, h: 4.0, doorH: 3.0, pegs: 8, crates: 8, wall: 0x4f5961, door: 0x8a5206, roof: 0x272b30 },
      blurb: "A bonded freight yard on its own land: dock, racks, a container yard, a cargo strip and an eight-bay vehicle block." },
  ];
  const PROP_BY_ID = {};
  for (const p of PROPERTIES) { PROP_BY_ID[p.id] = p; p.vehCap = p.unit ? p.unit.bays : 0; }

  // a crate: the item you carry, the rounds in it, how many come out at a time
  const AMMO_CRATES = [
    { id: "sidearm",   label: "9mm crate",    qty: 90,  take: 30, cost: 600,  tone: 0x5d6b3a, size: [0.5, 0.26, 0.34], one: "round", many: "rounds" },
    { id: "shotgun",   label: "12-gauge box", qty: 40,  take: 10, cost: 900,  tone: 0x8a3a2c, size: [0.46, 0.24, 0.32], one: "shell", many: "shells" },
    { id: "carbine",   label: "5.56 crate",   qty: 150, take: 30, cost: 1400, tone: 0x4d5a34, size: [0.58, 0.3, 0.36], one: "round", many: "rounds" },
    { id: "smg",       label: "SMG crate",    qty: 180, take: 30, cost: 1300, tone: 0x55603f, size: [0.56, 0.28, 0.36], one: "round", many: "rounds" },
    { id: "bazooka",   label: "Rocket crate", qty: 6,   take: 1,  cost: 5200, tone: 0x3f4a30, size: [0.74, 0.3, 0.4], one: "rocket", many: "rockets" },
    { id: "glauncher", label: "40mm crate",   qty: 12,  take: 2,  cost: 2600, tone: 0x6a6f3c, size: [0.54, 0.3, 0.36], one: "grenade", many: "grenades" },
  ];
  const CRATE_BY_ID = {}; for (const c of AMMO_CRATES) CRATE_BY_ID[c.id] = c;
  function econ() { return CBZ.cityEcon || null; }
  // the crates are real items in the city's catalog (a thing in your bag)
  function registerItems() {
    const E = econ(), IT = E && E.ITEMS; if (!IT) return;
    for (const c of AMMO_CRATES) if (!IT[c.label]) IT[c.label] = { value: c.cost, tag: "tool", crate: c.id };
  }
  registerItems();

  // ============================================================
  //  STATE (one plain object, mirrored to the save slot w.storage)
  //    owned    { [propId]: true }
  //    vehicles [ { place, name, lx, lz, lh, color?, mods?, hot? } ]
  //    guns     { [propId]: [weaponId, ...] }         the racks
  //    crates   [ { unit, id, n } ]                   boxes on the pallets
  //    sites    { [propId]: { x, z, q } }             where each unit stands
  // ============================================================
  function state() {
    if (!g.cityStorage) g.cityStorage = {};
    const s = g.cityStorage;
    if (!s.owned) s.owned = {};
    if (!Array.isArray(s.vehicles)) s.vehicles = [];
    if (!s.guns || typeof s.guns !== "object") s.guns = {};
    if (!Array.isArray(s.crates)) s.crates = [];
    if (!s.sites || typeof s.sites !== "object") s.sites = {};
    return s;
  }
  function owns(id) { return !!state().owned[id]; }
  function gunsOf(id) { const s = state(); return s.guns[id] || (s.guns[id] = []); }
  function cratesOf(id) { return state().crates.filter(function (c) { return c && c.unit === id; }); }
  function carsOf(key) { return state().vehicles.filter(function (v) { return v && v.place === key; }); }
  function vehCapTotal() {
    let c = 0; for (const p of PROPERTIES) if (owns(p.id)) c += p.vehCap || 0;
    if (CBZ.compoundKit && CBZ.compoundKit.garageBays) { try { c += CBZ.compoundKit.garageBays() | 0; } catch (e) {} }
    return c;
  }
  function storedVehicleCount() { return state().vehicles.length; }

  function persist() {
    if (!CBZ.cityWorldEnsure) return;
    const w = CBZ.cityWorldEnsure(); if (!w) return;
    const s = state();
    w.storage = { owned: clone(s.owned), vehicles: clone(s.vehicles), guns: clone(s.guns), crates: clone(s.crates), sites: clone(s.sites) };
    if (CBZ.cityWorldCommit) { try { CBZ.cityWorldCommit(); } catch (e) {} }
  }
  function hydrate() {
    const s = state();
    if (g._cityStorageHydrated) return;
    g._cityStorageHydrated = true;
    const w = CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null;
    const src = w && w.storage;
    let oldAmmo = s.ammo || null;
    if (src) {
      if (src.owned) for (const k in src.owned) if (PROP_BY_ID[k] && src.owned[k]) s.owned[k] = true;
      if (Array.isArray(src.vehicles)) s.vehicles = clone(src.vehicles).filter(function (v) { return v && typeof v === "object"; });
      if (src.guns && typeof src.guns === "object") s.guns = clone(src.guns);
      if (Array.isArray(src.crates)) s.crates = clone(src.crates).filter(function (c) { return c && CRATE_BY_ID[c.id] && (c.n | 0) > 0; });
      if (src.sites && typeof src.sites === "object") s.sites = clone(src.sites);
      if (src.ammo) oldAmmo = src.ammo;
    }
    // A SAVE FROM BEFORE THE UNITS HAD INSIDES. A stored car was a name in a
    // list: it is given a bay (adoptLegacy, once its place is known). The
    // locker was a count per calibre: each count is a box on the pallet.
    for (let i = s.vehicles.length - 1; i >= 0; i--) {
      const v = s.vehicles[i];
      if (v.place !== undefined && v.name) continue;
      if (v.kind === "jet" || !(v.model || v.name)) { s.vehicles.splice(i, 1); continue; }
      s.vehicles[i] = { place: null, name: v.model || v.name };
    }
    if (oldAmmo) {
      let home = null;
      for (const p of PROPERTIES) if (p.unit && owns(p.id) && (p.kind === "warehouse" || p.kind === "compound")) home = home || p.id;
      for (const p of PROPERTIES) if (p.unit && owns(p.id)) home = home || p.id;
      if (home) for (const id in oldAmmo) { const n = oldAmmo[id] | 0; if (n > 0 && CRATE_BY_ID[id]) s.crates.push({ unit: home, id: id, n: n }); }
    }
    delete s.ammo; delete s.lastRetrieve;
  }

  // ============================================================
  //  THE UNIT'S OWN FRAME. Origin: the middle of the door line, on the
  //  outer face. Local +X runs along the front, local +Z goes IN. A unit
  //  stands square to the world (q quarter turns), so every wall is an AABB.
  // ============================================================
  const BP = 3.7;        // bay pitch
  const WT = 0.3;        // wall thickness
  const EP = 0.6;        // end pad: room to open a car door against the end wall
  const PIER = 0.7;      // masonry between two doors
  const FC = 7;          // clear forecourt in front of the doors
  const CR_P = 0.85;     // crate pitch along the pallet
  const QC = [1, 0, -1, 0], QS = [0, 1, 0, -1];
  function frame(ox, oz, q) {
    const c = QC[q & 3], s = QS[q & 3];
    return {
      ox: ox, oz: oz, q: q & 3, yaw: (q & 3) * Math.PI / 2, c: c, s: s,
      w: function (lx, lz) { return { x: ox + lx * c + lz * s, z: oz - lx * s + lz * c }; },
      l: function (x, z) { const dx = x - ox, dz = z - oz; return { x: dx * c - dz * s, z: dx * s + dz * c }; },
      box: function (x0, x1, z0, z1) {
        const a = this.w(x0, z0), b = this.w(x1, z1);
        return { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) };
      },
    };
  }
  function dimsOf(u) {
    if (u._d) return u._d;
    const W = u.bays * BP + 2 * EP, D = u.depth, nd = Math.ceil(u.bays / u.perDoor), DW = BP * u.perDoor - PIER;
    const doors = [];
    for (let j = 0; j < nd; j++) doors.push(-W / 2 + EP + BP * u.perDoor * (j + 0.5));
    const cols = Math.ceil(u.pegs / 2), boardW = cols * 0.72 + 0.1;
    const rackX = -W / 2 + WT + 0.35 + boardW / 2;
    return (u._d = { W: W, D: D, H: u.h, DH: u.doorH, DW: DW, doors: doors, cols: cols, boardW: boardW,
      rackX: rackX, crateX0: rackX + boardW / 2 + 0.8, x0: -W / 2 + WT, x1: W / 2 - WT, z0: WT, z1: D - WT });
  }
  function bayX(u, i) { return -dimsOf(u).W / 2 + EP + BP * (i + 0.5); }
  // the ground a unit needs: itself, a margin, the forecourt (the sign stands in the margin)
  function footprint(F, d) { return F.box(-d.W / 2 - 1.9, d.W / 2 + 1.2, -FC, d.D + 1.2); }

  // ============================================================
  //  WHERE IT GOES
  // ============================================================
  function carlotAnchor() {
    const A = arena(); if (!A) return null;
    const lots = A.shopLots || (A.lots || []).filter(function (l) { return l.building && l.building.shop; });
    const lot = (lots && lots.find(function (l) { return l.kind === "carlot"; })) || A.chopShop || null;
    return lot && lot.cx != null ? { x: lot.cx, z: lot.cz } : null;
  }
  // the hardstanding beside the beach's far end, between the seawall and the ring road
  function beachAnchor() {
    const A = arena(); const sh = A && A.shore;
    if (!sh || !sh.beach || sh.ES == null) return null;
    const inland = (A.center && A.center.z > sh.ES) ? 1 : -1;
    return { x: sh.beach.x1 + 45, z: sh.ES + inland * 14 };
  }
  function beachRect() {
    const A = arena(); const sh = A && A.shore;
    if (!sh || !sh.beach || sh.ES == null) return null;
    return { minX: sh.beach.x0 - 4, maxX: sh.beach.x1 + 4, minZ: sh.ES - 50, maxZ: sh.ES + 27 };
  }
  function airportRegion() {
    const A = arena(); const regs = (A && A.regions) || [];
    return regs.find(function (r) { return r.biome === "airport" && r.kind === "rect"; })
      || regs.find(function (r) { return /airport/i.test(r.name || "") && r.kind === "rect"; }) || null;
  }
  function airportAnchor() {
    const air = airportRegion();
    if (air) return { x: (air.minX + air.maxX) / 2, z: (air.minZ + air.maxZ) / 2 };
    if (CBZ.cityMegaTower) { try { const t = CBZ.cityMegaTower(); if (t && t.hangar) return { x: t.hangar.x, z: t.hangar.z }; } catch (e) {} }
    return null;
  }
  function freeportSite() {
    const L = CBZ.govComplexes; if (!L) return null;
    for (let i = 0; i < L.length; i++) if (L[i] && L[i].id === "freeport" && L[i].rect) return L[i];
    return null;
  }
  // the gate and which way is out of it (the yard's record says; never typed)
  function freeportGate() {
    const s = freeportSite(); if (!s) return null;
    const gt = s.gate || { x: s.cx, z: s.rect.maxZ };
    let ox = 0, oz = 0;
    const o = s.warehouse && s.warehouse.out;
    if (o && (o.x || o.z)) { ox = o.x; oz = o.z; }
    else { ox = gt.x - s.cx; oz = gt.z - s.cz; if (Math.abs(ox) > Math.abs(oz)) { ox = Math.sign(ox); oz = 0; } else { oz = Math.sign(oz) || 1; ox = 0; } }
    return { x: gt.x, z: gt.z, ox: ox, oz: oz, site: s };
  }
  // anchor: where the search starts. face: what the doors should look at.
  function anchorOf(prop) {
    const A = arena();
    const fallback = A && A.center ? { x: A.center.x, z: A.center.z } : { x: 0, z: 0 };
    if (prop.anchor === "carlot") { const a = carlotAnchor() || fallback; return { x: a.x, z: a.z, face: a }; }
    if (prop.anchor === "beach") { const a = beachAnchor() || fallback; return { x: a.x, z: a.z, face: fallback }; }
    if (prop.anchor === "airport") { const a = airportAnchor() || fallback; return { x: a.x, z: a.z, face: a }; }
    if (prop.anchor === "freeport") {
      const G = freeportGate(); if (!G) return { x: fallback.x, z: fallback.z, face: fallback };
      const lane = { x: G.x - G.ox * 42, z: G.z - G.oz * 42 };
      const r = G.site.rect, W = G.site.warehouse || {};
      const avoid = [];
      if (W.strip) avoid.push(W.strip.len != null
        ? { minX: W.strip.x - W.strip.len / 2 - 4, maxX: W.strip.x + W.strip.len / 2 + 4, minZ: W.strip.z - (W.strip.w || 26) / 2 - 4, maxZ: W.strip.z + (W.strip.w || 26) / 2 + 4 } : null);
      if (W.apron) avoid.push({ minX: W.apron.x - (W.apron.r || 26) - 6, maxX: W.apron.x + (W.apron.r || 26) + 6, minZ: W.apron.z - (W.apron.r || 26) - 6, maxZ: W.apron.z + (W.apron.r || 26) + 6 });
      if (W.dock) avoid.push({ minX: W.dock.x - 22, maxX: W.dock.x + 22, minZ: W.dock.z - 16, maxZ: W.dock.z + 16 });
      // the lane from the gate to the shed stays a lane
      avoid.push({ minX: Math.min(G.x, lane.x) - 11, maxX: Math.max(G.x, lane.x) + 11, minZ: Math.min(G.z, lane.z) - 11, maxZ: Math.max(G.z, lane.z) + 11 });
      return { x: lane.x + G.oz * 46, z: lane.z - G.ox * 46, face: lane,
        within: { minX: r.minX + 9, maxX: r.maxX - 9, minZ: r.minZ + 9, maxZ: r.maxZ - 9 }, avoid: avoid.filter(Boolean), inYard: true };
    }
    return { x: fallback.x, z: fallback.z, face: fallback };
  }

  const GC = 12;         // the solids' grid cell (metres)
  function hitSolid(ob, r) {
    if (hitAny(ob.wide, r)) return true;
    const x0 = Math.floor(r.minX / GC), x1 = Math.floor(r.maxX / GC), z0 = Math.floor(r.minZ / GC), z1 = Math.floor(r.maxZ / GC);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const a = ob.grid.get(ix * 100003 + iz);
      if (a && hitAny(a, r)) return true;
    }
    return false;
  }
  function hitAny(list, r) {
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.maxX > r.minX && a.minX < r.maxX && a.maxZ > r.minZ && a.minZ < r.maxZ) return true;
    }
    return false;
  }
  /* WHAT IS ALREADY THERE, within R of a point: every solid the world has
     (CBZ.colliders), every lot, road, narrow region rect (a link road, a
     bridge approach), the beach, the other units, the city's parked
     fixtures. Gathered once per search; a candidate is then a few dozen
     rectangle tests. */
  function gather(cx, cz, R, A0, skipId) {
    const A = arena(), ob = { cols: [], rects: [] };
    const near = function (r) { return !(r.maxX < cx - R || r.minX > cx + R || r.maxZ < cz - R || r.minZ > cz + R); };
    // (the city has tens of thousands of solids: they go in a coarse grid, so
    //  a candidate asks only the cells it covers)
    const C = CBZ.colliders || [];
    ob.grid = new Map(); ob.wide = [];
    for (let i = 0; i < C.length; i++) {
      const c = C[i];
      if (!c || c.minX == null || c._lockup || !near(c)) continue;
      ob.cols.push(c);
      const x0 = Math.floor(c.minX / GC), x1 = Math.floor(c.maxX / GC), z0 = Math.floor(c.minZ / GC), z1 = Math.floor(c.maxZ / GC);
      if ((x1 - x0 + 1) * (z1 - z0 + 1) > 64) { ob.wide.push(c); continue; }
      for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
        const k = ix * 100003 + iz; let a = ob.grid.get(k);
        if (!a) ob.grid.set(k, a = []);
        a.push(c);
      }
    }
    const lots = (A && A.lots) || [];
    for (let i = 0; i < lots.length; i++) {
      const l = lots[i]; if (!l || l.cx == null) continue;
      const r = { minX: l.cx - (l.w || 0) / 2 - 1, maxX: l.cx + (l.w || 0) / 2 + 1, minZ: l.cz - (l.d || 0) / 2 - 1, maxZ: l.cz + (l.d || 0) / 2 + 1 };
      if (near(r)) ob.rects.push(r);
    }
    const roads = (A && A.roads) || [], RW = (A && A.ROAD) || 18;
    for (let i = 0; i < roads.length; i++) {
      const rd = roads[i]; if (!rd || rd.x == null) continue;
      const hw = (rd.w || RW) / 2 + 1.5, hl = (rd.len || 0) / 2;
      const r = rd.vertical ? { minX: rd.x - hw, maxX: rd.x + hw, minZ: rd.z - hl, maxZ: rd.z + hl } : { minX: rd.x - hl, maxX: rd.x + hl, minZ: rd.z - hw, maxZ: rd.z + hw };
      if (near(r)) ob.rects.push(r);
    }
    if (!(A0 && A0.inYard)) {
      const regs = (A && A.regions) || [];
      for (let i = 0; i < regs.length; i++) {
        const rg = regs[i];
        if (!rg || rg.kind !== "rect" || Math.min(rg.maxX - rg.minX, rg.maxZ - rg.minZ) > 40) continue;
        const r = { minX: rg.minX - 1, maxX: rg.maxX + 1, minZ: rg.minZ - 1, maxZ: rg.maxZ + 1 };
        if (near(r)) ob.rects.push(r);
      }
    }
    const br = beachRect(); if (br && near(br)) ob.rects.push(br);
    if (A0 && A0.avoid) for (const r of A0.avoid) ob.rects.push(r);
    for (const U of UNITS) if (U.rect && U.prop.id !== skipId) ob.rects.push(U.rect);
    const cars = CBZ.cityCars || [];
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!c || !c.pos || !(c._propParked || c._cargoFleet) || c._lockupRec) continue;
      const r = { minX: c.pos.x - 3, maxX: c.pos.x + 3, minZ: c.pos.z - 3, maxZ: c.pos.z + 3 };
      if (near(r)) ob.rects.push(r);
    }
    return ob;
  }
  // dry, level, nobody's land: sampled every few metres across the rectangle
  function groundOk(r) {
    const nx = Math.max(2, Math.ceil((r.maxX - r.minX) / 4)), nz = Math.max(2, Math.ceil((r.maxZ - r.minZ) / 4));
    const PL = CBZ.cityPlots;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
      const x = r.minX + (r.maxX - r.minX) * i / nx, z = r.minZ + (r.maxZ - r.minZ) * j / nz;
      try {
        if (CBZ.cityWaterAt && CBZ.cityWaterAt(x, z)) return false;
        if (CBZ.cityKeepOutAt && CBZ.cityKeepOutAt(x, z, 0)) return false;
        if (PL && PL.at && PL.at(x, z)) return false;
      } catch (e) {}
      const y = floorY(x, z);
      if (y < lo) lo = y; if (y > hi) hi = y;
    }
    return hi - lo <= 0.08;
  }
  function siteClear(ob, r, A0, usePlacement) {
    if (A0 && A0.within) { const w = A0.within; if (r.minX < w.minX || r.maxX > w.maxX || r.minZ < w.minZ || r.maxZ > w.maxZ) return false; }
    if (hitAny(ob.rects, r)) return false;
    if (usePlacement && CBZ.placement && CBZ.placement.isFree) { try { if (!CBZ.placement.isFree(r)) return false; } catch (e) {} }
    if (hitSolid(ob, r)) return false;
    return groundOk(r);
  }
  /* THE NEAREST CLEAR GROUND, doors toward `face`. Square rings out from the
     anchor; a candidate's cost is its distance plus what it loses by facing
     the wrong way, and the rings stop once they are further out than the
     best cost found. Deterministic: the same world gives the same site. */
  function findSite(prop, A0) {
    const d = dimsOf(prop.unit), R = 240, step = 1.5;
    const ax = Math.round(A0.x * 2) / 2, az = Math.round(A0.z * 2) / 2;
    const ob = gather(ax, az, R + 50, A0, prop.id);
    const face = A0.face || A0;
    let best = null, bestCost = Infinity;
    const tryAt = function (x, z) {
      const dist = Math.hypot(x - ax, z - az);
      if (dist >= bestCost) return;
      const fx = face.x - x, fz = face.z - z, fl = Math.hypot(fx, fz) || 1;
      for (let q = 0; q < 4; q++) {
        const dot = (-QS[q] * fx - QC[q] * fz) / fl;          // the way out of the doors, against the way to `face`
        const cost = dist + (1 - dot) * 18;
        if (cost >= bestCost) continue;
        const F = frame(x, z, q);
        if (!siteClear(ob, footprint(F, d), A0, !A0.inYard)) continue;   // (a yard's whole rectangle is one reservation: its solids answer instead)
        best = { x: x, z: z, q: q }; bestCost = cost;
      }
    };
    for (let k = 0; k * step <= R; k++) {
      const r = k * step;
      if (r >= bestCost) break;
      if (!k) { tryAt(ax, az); continue; }
      for (let i = -k; i < k; i++) {
        const t = i * step;
        tryAt(ax + t, az - r); tryAt(ax + r, az + t); tryAt(ax - t, az + r); tryAt(ax - r, az - t);
      }
    }
    return best;
  }

  // ============================================================
  //  THE UNITS. One record per property for the life of an arena:
  //    { prop, unit, d, F, y, rect, cols, doors, sign:{x,z,yaw}, keep, grp... }
  // ============================================================
  const UNITS = [];
  const UNIT_BY_ID = {};
  let _unitsRoot = null;
  function unitOf(id) { return UNIT_BY_ID[id] || null; }
  function addCol(c) { if (CBZ.colliderAdd) CBZ.colliderAdd(c); else if (CBZ.colliders) { CBZ.colliders.push(c); if (CBZ.markCollidersDirty) CBZ.markCollidersDirty(); } }
  function dropCol(c) {
    if (CBZ.colliderRemove) { try { CBZ.colliderRemove(c); } catch (e) {} return; }
    const C = CBZ.colliders; if (!C) return;
    const i = C.indexOf(c); if (i >= 0) { C.splice(i, 1); if (CBZ.markCollidersDirty) CBZ.markCollidersDirty(); }
  }
  function ensureUnits() {
    const root = arenaRoot(); if (!root) return false;
    if (_unitsRoot === root) return true;
    dropUnits();
    _unitsRoot = root;
    for (const prop of PROPERTIES) {
      const U = { prop: prop, unit: prop.unit || null, d: prop.unit ? dimsOf(prop.unit) : null, F: null, y: 0, rect: null,
        cols: [], doors: [], sign: null, keep: null, grp: null, own: [], signGrp: null, contents: null, sig: null,
        readyT: 0, failAt: null, resolved: false, tok: null, rackTok: null, floorTok: null };
      U.tok = { prop: prop, U: U, x: 0, z: 0 };
      UNITS.push(U); UNIT_BY_ID[prop.id] = U;
    }
    return true;
  }
  function dropUnits() {
    for (const U of UNITS) {
      free(U);
      for (const c of U.cols) dropCol(c);
      for (const D of U.doors) if (D.solid) dropCol(D.col);
      if (U.lamp) { const A = arena(), L = A && A._lightCandidates; if (L) { const i = L.indexOf(U.lamp); if (i >= 0) L.splice(i, 1); } }
    }
    UNITS.length = 0;
    for (const k in UNIT_BY_ID) delete UNIT_BY_ID[k];
    _unitsRoot = null;
  }

  function mkCol(U, x0, x1, z0, z1, ya, yb) {
    const b = U.F.box(x0, x1, z0, z1);
    b.y0 = U.y + ya; b.y1 = U.y + yb; b._lockup = U.prop.id;
    return b;
  }
  // the unit is THERE from now on: its walls are solid whether or not its
  // meshes are built (they are built long before anyone is close enough to
  // walk into one)
  function settle(U, site) {
    const d = U.d, W = d.W, D = d.D, H = d.H;
    U.F = frame(site.x, site.z, site.q);
    U.y = floorY(site.x, site.z);
    U.rect = footprint(U.F, d);
    U.cols = [
      mkCol(U, -W / 2, W / 2, D - WT, D, 0, H),                      // back
      mkCol(U, -W / 2, -W / 2 + WT, 0, D, 0, H),                     // ends
      mkCol(U, W / 2 - WT, W / 2, 0, D, 0, H),
      mkCol(U, -W / 2, W / 2, 0, WT, d.DH, H),                       // the header over the doors
      mkCol(U, -W / 2 - 0.18, W / 2 + 0.18, -0.18, D + 0.18, H, H + 0.22),   // roof
    ];
    let px = -W / 2;
    for (let j = 0; j <= d.doors.length; j++) {
      const x1 = j < d.doors.length ? d.doors[j] - d.DW / 2 : W / 2;
      U.cols.push(mkCol(U, px, x1, 0, WT, 0, d.DH));                 // piers
      if (j < d.doors.length) px = d.doors[j] + d.DW / 2;
    }
    for (const c of U.cols) addCol(c);
    U.doors = d.doors.map(function (x, j) {
      const p = U.F.w(x, WT / 2);
      const D0 = { U: U, j: j, lx: x, x: p.x, z: p.z, open: 0, want: 0, solid: true, mesh: null, base: null,
        col: mkCol(U, x - d.DW / 2, x + d.DW / 2, 0.03, WT - 0.03, 0, d.DH) };
      D0.pos = { x: p.x, y: U.y + 1.2, z: p.z };
      addCol(D0.col);
      return D0;
    });
    const sp = U.F.w(-W / 2 - 1.0, -0.9);
    U.sign = { x: sp.x, z: sp.z, yaw: U.F.yaw };
    const cp = U.F.w(0, D / 2);
    U.cx = cp.x; U.cz = cp.z;
    const rp = U.F.w(d.rackX, D - WT - 0.7), fp = U.F.w(d.crateX0 + (U.unit.crates - 1) * CR_P / 2, D - WT - 1.0);
    U.rackTok = { U: U, x: rp.x, z: rp.z, pos: { x: rp.x, y: U.y + 1.4, z: rp.z } };
    U.floorTok = { U: U, x: fp.x, z: fp.z, pos: { x: fp.x, y: U.y + 0.5, z: fp.z } };
    // a real lamp inside at night, from the street's own pool of eight
    const A = arena();
    if (A && A._lightCandidates) { U.lamp = { x: cp.x, y: U.y + H - 0.5, z: cp.z, kind: "lamp", ref: { broken: false } }; A._lightCandidates.push(U.lamp); }
    U.place = null;
  }

  /* THE HANGAR IS THE FIELD'S. city/airport_kit.js stands real hangars on the
     apron (groups named "hangar"); the private one is the smallest of them,
     nearest the middle of the field. Nothing is built: its doors are where
     the sign goes and its floor, with the apron before the doors, is where a
     stolen jet is kept. */
  function adoptHangar(U, A0) {
    const root = arenaRoot(); if (!root) return false;
    const found = [];
    const walk = function (o, depth) {
      if (o.name === "hangar") { found.push(o); return; }
      if (o.isMesh || depth > 6) return;
      const ch = o.children;
      for (let i = 0; i < ch.length; i++) walk(ch[i], depth + 1);
    };
    walk(root, 0);
    if (!found.length) return false;
    const b = new THREE.Box3(), v = new THREE.Vector3();
    let best = null, bestS = Infinity;
    for (const o of found) {
      o.updateWorldMatrix(true, true);
      b.setFromObject(o);
      if (!isFinite(b.min.x) || b.max.x - b.min.x < 8) continue;
      const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
      const score = (b.max.x - b.min.x) * (b.max.z - b.min.z) + Math.hypot(cx - A0.x, cz - A0.z) * 2;
      if (score < bestS) { bestS = score; o.getWorldDirection(v); best = { minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z, fx: v.x, fz: v.z }; }
    }
    if (!best) return false;
    // which way the doors look, squared to an axis
    let fx = 0, fz = 0;
    if (Math.abs(best.fx) > Math.abs(best.fz)) fx = Math.sign(best.fx); else fz = Math.sign(best.fz) || 1;
    const cx = (best.minX + best.maxX) / 2, cz = (best.minZ + best.maxZ) / 2;
    const hw = fx ? (best.maxZ - best.minZ) / 2 : (best.maxX - best.minX) / 2;
    const hd = fx ? (best.maxX - best.minX) / 2 : (best.maxZ - best.minZ) / 2;
    // the sign: outside the doors, off their corner
    U.sign = { x: cx + fx * (hd + 2.2) + fz * (hw - 2), z: cz + fz * (hd + 2.2) - fx * (hw - 2), yaw: Math.atan2(fx, fz) };
    U.keep = { minX: best.minX - 4 - (fx < 0 ? 26 : 0), maxX: best.maxX + 4 + (fx > 0 ? 26 : 0),
               minZ: best.minZ - 4 - (fz < 0 ? 26 : 0), maxZ: best.maxZ + 4 + (fz > 0 ? 26 : 0) };
    U.cx = cx; U.cz = cz;
    return true;
  }

  function playerPos() { const P = CBZ.player; return P && P.pos ? P.pos : null; }
  function sightR() {
    let r = 200;
    if (CBZ.carSleepD2) { try { r = Math.sqrt(CBZ.carSleepD2()); } catch (e) {} }
    return Math.max(160, Math.min(700, r));
  }
  /* A UNIT IS PLACED once the ground it needs is built and has been for a
     moment (the streamed city, core/citystream.js, builds what is within the
     keep circle; RESOLVE_R is well inside it). */
  const RESOLVE_R = 320;
  function resolveTick(dt) {
    const P = playerPos(); if (!P) return;
    const S = state();
    for (const U of UNITS) {
      if (U.resolved) continue;
      const prop = U.prop;
      if (prop.after && !(UNIT_BY_ID[prop.after] && UNIT_BY_ID[prop.after].resolved)) continue;
      const A0 = anchorOf(prop);
      const saved = U.unit ? S.sites[prop.id] : null;
      const at = saved || A0;
      if (Math.hypot(P.x - at.x, P.z - at.z) > RESOLVE_R) { U.readyT = 0; continue; }
      if (CBZ.sliceKeeps && !CBZ.sliceKeeps(at.x, at.z, -120)) { U.readyT = 0; continue; }
      U.readyT += dt;
      if (U.readyT < 2) continue;
      if (!U.unit) {
        // (the field's dressing is built a step at a time: asked again every few seconds)
        if (prop.anchor === "airport" && adoptHangar(U, A0)) { U.resolved = true; continue; }
        if (prop.anchor === "airport" && airportRegion()) { U.readyT = -2; continue; }
        U.sign = { x: A0.x, z: A0.z, yaw: 0 }; U.cx = A0.x; U.cz = A0.z; U.resolved = true;
        continue;
      }
      let site = null;
      if (saved && saved.x != null) {
        const F = frame(saved.x, saved.z, saved.q | 0);
        const r = footprint(F, U.d);
        const ob = gather((r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2, 60, A0, prop.id);
        if (siteClear(ob, r, A0, false)) site = { x: saved.x, z: saved.z, q: saved.q | 0 };
      }
      // a search that found nothing is not run again until you have moved
      if (!site && U.failAt && Math.hypot(P.x - U.failAt.x, P.z - U.failAt.z) < 40) { U.readyT = 0; continue; }
      if (!site) {
        site = findSite(prop, A0);
        if (site) { S.sites[prop.id] = { x: site.x, z: site.z, q: site.q }; _dirty = true; }
      }
      if (!site) {
        U.failAt = { x: P.x, z: P.z }; U.readyT = 0;
        if (!U._noSite) { U._noSite = true; console.warn("[storage] no clear ground for the " + prop.name + " near", Math.round(A0.x), Math.round(A0.z)); }
        // the Freeport is still for sale at its gate while its block has nowhere to stand
        if (prop.anchor === "freeport" && freeportGate() && !U.signOnly) { const sp = signPlace(U); U.signOnly = true; U.cx = sp.x; U.cz = sp.z; }
        continue;
      }
      settle(U, site);
      U.signOnly = false;
      if (U.grp) free(U);
      U.resolved = true;
    }
  }

  // ============================================================
  //  THE SIGN ON THE LOT. A two-post galvanised frame, an agent's board
  //  hanging from it on S-hooks (FOR SALE, the name, the price), a SOLD rider
  //  bolted across the top the moment it is yours.
  // ============================================================
  const SIGN = { post: null };
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
  function makeSign(prop) {
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
    const tex = signTex(prop, false), soldTex = signTex(prop, true);
    const face = new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.18 });
    const board = new THREE.Mesh(G.board, [G.edge, G.edge, G.edge, G.edge, face, face]);
    board.position.set(0, 1.82, 0);
    board.rotation.x = 0.03;                          // it hangs, so it never quite plumbs
    grp.add(board);
    grp.userData.signFace = face; grp.userData.signTex = { sale: tex, sold: soldTex };
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
    grp.userData.rider = rider; grp.userData.riderMat = rm;
    grp.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; o.userData.storageSign = true; } });
    return grp;
  }
  function freeSign(grp) {
    if (!grp) return;
    if (grp.parent) grp.parent.remove(grp);
    const ud = grp.userData || {};
    if (ud.signTex) { if (ud.signTex.sale) ud.signTex.sale.dispose(); if (ud.signTex.sold) ud.signTex.sold.dispose(); }
    if (ud.signFace) ud.signFace.dispose();
    if (ud.riderMat) { if (ud.riderMat.map) ud.riderMat.map.dispose(); ud.riderMat.dispose(); }
  }
  // the board says what the ledger says
  function refreshSign(U) {
    const b = U.signGrp; if (!b) return;
    const own = owns(U.prop.id);
    if (b.userData._sold === own) return;
    b.userData._sold = own;
    if (b.userData.rider) b.userData.rider.visible = own;
    const f = b.userData.signFace, T = b.userData.signTex;
    if (f && T) { f.map = own ? T.sold : T.sale; f.emissiveMap = f.map; f.needsUpdate = true; }
  }
  CBZ.storageSign = function (id) { return makeSign(PROP_BY_ID[id || "garage1"] || PROPERTIES[0]); };   // the turntable's door: one sign, alone
  // the Freeport is sold at its gate (the yard is the property; the block is inside it)
  function signPlace(U) {
    if (U.prop.anchor === "freeport") {
      const G = freeportGate();
      if (G) return { x: G.x + G.ox * 11 - G.oz * 7.5, z: G.z + G.oz * 11 + G.ox * 7.5, yaw: Math.atan2(G.ox, G.oz) };
    }
    return U.sign;
  }

  // ============================================================
  //  BUILDING IT (when you are within sight) AND FREEING IT (past that)
  // ============================================================
  // (this city's sun and sky put about twice the albedo on a wall and four
  //  times on a floor, so every paint here is mixed dark)
  const LINER = 0xa7a49b, FLOOR = 0x4c4d4a;
  const DOOR_MAT = {};
  function doorMat(hex) {
    if (!DOOR_MAT[hex]) { DOOR_MAT[hex] = new THREE.MeshLambertMaterial({ color: hex, vertexColors: true }); DOOR_MAT[hex]._shared = true; }
    return DOOR_MAT[hex];
  }
  /* THE ROLLER DOOR: a curtain of slats in one geometry. Raising it lifts
     every slat and gathers the ones that pass the head into the roll behind
     the header, so the curtain shortens from the top the way a real one does
     (not a panel that shrinks, and not one that slides up through the roof). */
  function slatGeo(DW, DH) {
    const n = Math.max(8, Math.round(DH / 0.12)), sh = DH / n;
    const one = new THREE.BoxGeometry(DW, sh, 0.05).toNonIndexed();
    const P0 = one.attributes.position.array, N0 = one.attributes.normal.array, vc = P0.length / 3;
    const pos = new Float32Array(n * vc * 3), nor = new Float32Array(n * vc * 3), col = new Float32Array(n * vc * 3);
    for (let i = 0; i < n; i++) {
      const k = i === 0 ? 0.42 : (i % 2 ? 0.86 : 1);                 // the bottom rail is dark rubber; the rest reads as ribs
      for (let v = 0; v < vc; v++) {
        const o = (i * vc + v) * 3;
        pos[o] = P0[v * 3]; pos[o + 1] = P0[v * 3 + 1] + (i + 0.5) * sh; pos[o + 2] = P0[v * 3 + 2];
        nor[o] = N0[v * 3]; nor[o + 1] = N0[v * 3 + 1]; nor[o + 2] = N0[v * 3 + 2];
        col[o] = col[o + 1] = col[o + 2] = k;
      }
    }
    one.dispose();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.computeBoundingBox(); geo.computeBoundingSphere();
    return geo;
  }
  function doorPose(D) {
    const m = D.mesh; if (!m) return;
    const DH = D.U.d.DH, lift = D.open * (DH - 0.3), top = DH + 0.05;
    const a = m.geometry.attributes.position, arr = a.array, base = D.base;
    for (let i = 1; i < arr.length; i += 3) { const y = base[i] + lift; arr[i] = y > top ? top : y; }
    a.needsUpdate = true;
  }
  function build(U) {
    const root = arenaRoot(); if (!root || U.grp || !(U.resolved || U.signOnly)) return;
    const grp = new THREE.Group();
    grp.name = "lockup:" + U.prop.id;
    grp.userData.transient = true;
    U.grp = grp; U.own = [];
    const sp = signPlace(U);
    if (sp) {
      const sg = makeSign(U.prop);
      sg.position.set(sp.x, floorY(sp.x, sp.z), sp.z);
      sg.rotation.y = sp.yaw || 0;
      grp.add(sg);
      U.signGrp = sg; U.tok.x = sp.x; U.tok.z = sp.z;
      refreshSign(U);
    }
    const K = CBZ.storeFixtureKit;
    if (U.unit && U.F && K && K.create) {
      const u = U.unit, d = U.d, F = U.F, y = U.y, W = d.W, D = d.D, H = d.H, DH = d.DH, DW = d.DW;
      // ---- the shell: block walls, piers between the doors, a flat roof
      const kS = K.create(); kS.frame(F.ox, y, F.oz, F.yaw);
      kS.box(0, H / 2, D - WT / 2, W, H, WT, u.wall, "solid");
      for (const sx of [-1, 1]) kS.box(sx * (W / 2 - WT / 2), H / 2, D / 2, WT, H, D - 0.002, u.wall, "solid");
      kS.box(0, DH + (H - DH) / 2, WT / 2, W - 0.002, H - DH, WT, u.wall, "solid");
      let px = -W / 2;
      for (let j = 0; j <= d.doors.length; j++) {
        const x1 = j < d.doors.length ? d.doors[j] - DW / 2 : W / 2;
        kS.box((px + x1) / 2, DH / 2, WT / 2, x1 - px - 0.002, DH, WT - 0.002, u.wall, "solid");
        if (j < d.doors.length) px = d.doors[j] + DW / 2;
      }
      kS.box(0, H + 0.1, D / 2, W + 0.36, 0.2, D + 0.36, u.roof, "solid");                    // roof slab
      kS.box(0, H + 0.26, D / 2, W + 0.44, 0.12, D + 0.44, 0x1c1e21, "solid");                // coping
      kS.box(0, H - 0.2, -0.035, W + 0.02, 0.34, 0.07, u.door, "solid");                      // the painted fascia over the doors
      for (const sx of [-1, 1]) kS.box(sx * (W / 2 + 0.012), 0.22, D / 2, 0.03, 0.44, D, 0x3a3d41, "solid");   // plinth course
      kS.box(0, 0.22, D + 0.012, W, 0.44, 0.03, 0x3a3d41, "solid");
      for (const m of kS.build(grp)) { m.castShadow = true; U.own.push(m); }
      // ---- the inside: a poured floor, painted block, strip lights, the rack, the pallet
      const kI = K.create(); kI.frame(F.ox, y, F.oz, F.yaw);
      kI.box(0, 0.012, D / 2, W - 2 * WT, 0.024, D - 2 * WT + 0.3, FLOOR, "solid");
      kI.box(0, 0.008, -1.0, W, 0.016, 2.0, 0x454644, "solid");                               // the threshold apron
      kI.box(0, H / 2, D - WT - 0.012, W - 2 * WT, H, 0.024, LINER, "solid");
      for (const sx of [-1, 1]) kI.box(sx * (W / 2 - WT - 0.012), H / 2, D / 2, 0.024, H, D - 2 * WT, LINER, "solid");
      kI.box(0, H - 0.012, D / 2, W - 2 * WT, 0.024, D - 2 * WT, 0x9a978e, "solid");
      kI.box(0, DH + (H - DH) / 2, WT + 0.012, W - 2 * WT, H - DH, 0.024, LINER, "solid");
      px = -W / 2 + WT;
      for (let j = 0; j <= d.doors.length; j++) {
        const x1 = j < d.doors.length ? d.doors[j] - DW / 2 : W / 2 - WT;
        kI.box((px + x1) / 2, DH / 2, WT + 0.012, x1 - px, DH, 0.024, LINER, "solid");
        if (j < d.doors.length) px = d.doors[j] + DW / 2;
      }
      for (let i = 0; i < u.bays; i++) {
        const bx = bayX(u, i);
        kI.box(bx, H - 0.06, D * 0.46, 0.18, 0.07, 1.6, 0x9aa0a6, "metal");                   // a strip light a bay
        kI.box(bx, H - 0.105, D * 0.46, 0.11, 0.03, 1.4, 0xfff3d6, "glow");
        if (i) kI.box(-W / 2 + EP + BP * i, 0.026, 0.5 + (D - 2.6) / 2, 0.09, 0.004, D - 2.6, 0x9a7c10, "solid");   // bay line
      }
      for (const x of d.doors) {
        for (const sx of [-1, 1]) kI.box(x + sx * (DW / 2 + 0.03), DH / 2, WT + 0.06, 0.08, DH, 0.1, 0x6e7378, "metal");   // guides
        kI.box(x, DH + 0.26, WT + 0.22, DW + 0.3, 0.42, 0.42, 0x7a8087, "metal");             // the roll's housing
        kI.box(x, DH + 0.34, -0.07, 0.36, 0.13, 0.12, 0x2e3237, "metal");                     // bulkhead lamp over the door
        kI.box(x, DH + 0.262, -0.08, 0.28, 0.03, 0.09, 0xfff0c8, "glow");
      }
      // the rack: a board on the back wall with two rows of pegs
      const rz = D - WT - 0.024;
      kI.box(d.rackX, 1.36, rz - 0.022, d.boardW, 1.0, 0.04, 0x4a3320, "solid");
      kI.box(d.rackX, 1.9, rz - 0.04, d.boardW + 0.06, 0.06, 0.07, 0x2f2014, "solid");
      for (let i = 0; i < u.pegs; i++) {
        const pxx = d.rackX - (d.cols - 1) * 0.36 + ((i / 2) | 0) * 0.72, py = 1.5 - (i % 2) * 0.34;
        for (const dx of [-0.2, 0.2]) kI.box(pxx + dx, py, rz - 0.1, 0.025, 0.025, 0.12, 0x2b2f35, "metal");
      }
      // the pallet the crates stand on
      if (u.crates) {
        const len = u.crates * CR_P, cxm = d.crateX0 + (u.crates - 1) * CR_P / 2, pz = D - WT - 0.52;
        kI.box(cxm, 0.105, pz, len, 0.03, 0.86, 0x5e4a2e, "solid");
        for (let i = 0; i < 3; i++) kI.box(cxm, 0.057, pz - 0.36 + i * 0.36, len, 0.066, 0.1, 0x4a3820, "solid");
      }
      for (const m of kI.build(grp)) { m.castShadow = false; m.receiveShadow = false; U.own.push(m); }
      // ---- the doors
      const mat = doorMat(u.door);
      for (const Dr of U.doors) {
        const geo = slatGeo(DW, DH);
        const m = new THREE.Mesh(geo, mat);
        m.position.set(Dr.x, y, Dr.z); m.rotation.y = F.yaw;
        m.castShadow = true; m.receiveShadow = true;
        m.updateMatrix(); m.matrixAutoUpdate = false;
        m.frustumCulled = true;
        grp.add(m);
        Dr.mesh = m; Dr.base = new Float32Array(geo.attributes.position.array);
        doorPose(Dr);
        U.own.push(m);
      }
      U.contents = new THREE.Group();
      grp.add(U.contents);
      U.sig = null;
    }
    root.add(grp);
  }
  function free(U) {
    const grp = U.grp; if (!grp) return;
    if (grp.parent) grp.parent.remove(grp);
    for (const m of U.own) if (m.geometry) m.geometry.dispose();
    freeSign(U.signGrp);
    for (const Dr of U.doors) { Dr.mesh = null; Dr.base = null; }
    U.grp = null; U.own = []; U.signGrp = null; U.contents = null; U.sig = null;
  }
  function nearTick() {
    const P = playerPos(); if (!P) return;
    const R = sightR();
    for (const U of UNITS) {
      if (!U.resolved && !U.signOnly) continue;
      const d = Math.hypot(P.x - U.cx, P.z - U.cz);
      if (!U.grp && d < R) { try { build(U); } catch (e) { if (!U._warned) { U._warned = true; console.error("[storage] build " + U.prop.id, e); } } }
      else if (U.grp && d > R + 60) free(U);
      if (U.grp) { refreshSign(U); refreshContents(U); }
    }
  }

  // ---- the doors -------------------------------------------------------
  // is anything standing in this doorway? (a door does not come down on a car or on you)
  function doorBlocked(Dr) {
    const U = Dr.U, d = U.d, P = CBZ.player;
    const inGap = function (x, z, back, fwd) { const l = U.F.l(x, z); return Math.abs(l.x - Dr.lx) < d.DW / 2 + 0.3 && l.z > -back && l.z < fwd; };
    if (P && P.pos && !P.driving && inGap(P.pos.x, P.pos.z, 0.55, WT + 0.55)) return true;
    const cars = CBZ.cityCars || [];
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i]; if (!c || !c.pos) continue;
      const half = ((c.dims && c.dims.length) || 4.6) / 2 + 0.2;
      if (inGap(c.pos.x, c.pos.z, half, WT + half)) return true;
    }
    return false;
  }
  function setDoor(Dr, open) {
    if (!Dr) return false;
    if (!open && doorBlocked(Dr)) { note("Something is in the doorway.", 1.6); return false; }
    Dr.want = open ? 1 : 0;
    sfx(open ? "door_open" : "door_close");
    return true;
  }
  function doorsTick(dt) {
    for (const U of UNITS) {
      for (const Dr of U.doors) {
        if (Dr.open === Dr.want) continue;
        if (!Dr.want && Dr.open < 0.75 && doorBlocked(Dr)) { Dr.want = 1; continue; }
        const stp = dt * 0.62;                                        // about a second and a half, end to end
        Dr.open = Dr.want > Dr.open ? Math.min(1, Dr.open + stp) : Math.max(0, Dr.open - stp);
        // the way is clear from the moment it starts up, and shut only once it is down
        if (Dr.open > 0.02 && Dr.solid) { dropCol(Dr.col); Dr.solid = false; }
        if (Dr.open === 0 && !Dr.solid) { addCol(Dr.col); Dr.solid = true; }
        doorPose(Dr);
      }
    }
  }

  // ============================================================
  //  BUY / GRANT
  // ============================================================
  function buy(prop) {
    if (owns(prop.id)) { note("You already own the " + prop.name + ".", 1.6); return; }
    // the Freeport closes through cashstore.js: bags already handed over at the gate count
    if (prop.id === "freeport" && CBZ.cashStore && CBZ.cashStore.buy) { CBZ.cashStore.buy(); return; }
    if (!canAfford(prop.cost)) { note("Need " + money(prop.cost) + " (cash + bank) for the " + prop.name + ".", 2.4); sfx("hit"); return; }
    charge(prop.cost);
    state().owned[prop.id] = true;
    big("ACQUIRED " + prop.name);
    if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(Math.max(3, Math.round(prop.cost / 12000)));
    sfx("coin");
    persist();
  }
  /* GRANT — mark a property owned WITHOUT charging for it, for a caller that
     has already collected the money its own way (cashstore.js's bag escrow).
     The id must be a real row, and the ledger write is the same as buy()'s. */
  function grant(id) {
    const prop = PROP_BY_ID[id];
    if (!prop || owns(id)) return false;
    state().owned[id] = true;
    persist();
    return true;
  }
  // the F-35 keep-gate (city/playeraircraft.js): on the floor of the hangar you own, or before its doors
  CBZ.cityStorageHangarHit = function (x, z) {
    if (!owns("hangar")) return false;
    const U = unitOf("hangar");
    if (U && U.keep) return x >= U.keep.minX && x <= U.keep.maxX && z >= U.keep.minZ && z <= U.keep.maxZ;
    const a = (U && U.sign) || anchorOf(PROP_BY_ID.hangar);
    return Math.abs(x - a.x) <= 14 && Math.abs(z - a.z) <= 14;
  };

  // ============================================================
  //  THE CARS. A PLACE is somewhere a car you leave stays: a unit of yours
  //  (its inside), a garage you built on your own land. A place has a frame
  //  (origin, the axis along its front, the axis going in) and a rectangle
  //  in that frame; a record keeps the car's spot in the PLACE'S frame, so
  //  the car is where you left it in the unit wherever the unit stands.
  // ============================================================
  const live = new Map();          // record -> the car in the world
  let _dirty = false;
  function unitPlace(U) {
    const F = U.F, d = U.d, u = U.unit;
    return { key: U.prop.id, name: U.prop.name, cap: u.bays, ox: F.ox, oz: F.oz, ax: F.c, az: -F.s, ix: F.s, iz: F.c,
      x0: d.x0, x1: d.x1, z0: 0.35, z1: d.z1, cx: U.cx, cz: U.cz,
      bay: function (i) { return { lx: bayX(u, i), lz: Math.min(3.5, d.D / 2) }; },
      shutAt: function (lx) {
        let best = null, bd = Infinity;
        for (const Dr of U.doors) { const dd = Math.abs(Dr.lx - lx); if (dd < bd) { bd = dd; best = Dr; } }
        return !best || (best.open === 0 && best.want === 0);
      } };
  }
  function ckPlace(G) {
    const n = G.bays || 2;
    return { key: "ck:" + Math.round(G.x) + "," + Math.round(G.z), name: "your garage", cap: n, ox: G.x, oz: G.z, ax: G.ax, az: G.az, ix: G.ix, iz: G.iz,
      x0: -G.hw, x1: G.hw, z0: -G.hd, z1: G.hd, cx: G.x, cz: G.z,
      bay: function (i) { return { lx: (i - (n - 1) / 2) * (2 * G.hw / n), lz: 0.4 }; },
      shutAt: function () { return !!G.shut; } };
  }
  function places() {
    const out = [];
    for (const U of UNITS) if (U.unit && U.F && owns(U.prop.id)) out.push(U.place || (U.place = unitPlace(U)));
    const CK = CBZ.compoundKit;
    if (CK && CK.garages) { let L = null; try { L = CK.garages(); } catch (e) { L = null; } if (L) for (const G of L) out.push(ckPlace(G)); }
    return out;
  }
  function toLocal(pl, x, z) { const dx = x - pl.ox, dz = z - pl.oz; return { x: dx * pl.ax + dz * pl.az, z: dx * pl.ix + dz * pl.iz }; }
  function toWorld(pl, lx, lz) { return { x: pl.ox + lx * pl.ax + lz * pl.ix, z: pl.oz + lx * pl.az + lz * pl.iz }; }
  function headIn(pl) { return Math.atan2(pl.ix, pl.iz); }
  function insidePlace(pl, x, z) { const l = toLocal(pl, x, z); return l.x > pl.x0 && l.x < pl.x1 && l.z > pl.z0 && l.z < pl.z1; }
  function carGone(c) { return !c || c._scrapped || !CBZ.cityCars || CBZ.cityCars.indexOf(c) < 0; }
  function recOfCar(c) { const r = c && c._lockupRec; return r && live.get(r) === c ? r : null; }
  function carName(c) { return (c && c.model && c.model.name) || "Sedan"; }
  function claimable(c, P) {
    if (!c || c.dead || c.ai || c.player || c === P._vehicle || !c.pos || !(c.owned || c.stolen)) return false;
    if (c.airClass || c._raceCar || recOfCar(c)) return false;
    if (CBZ.isMarineHull) { try { if (CBZ.isMarineHull(c)) return false; } catch (e) {} }
    return Math.abs(c.v || 0) < 0.4;
  }
  function dropRec(rec, car) {
    const V = state().vehicles, i = V.indexOf(rec);
    if (i >= 0) V.splice(i, 1);
    live.delete(rec);
    if (car && car._lockupRec === rec) { car._lockupRec = null; car._persist = !!car._lockupWasPersist; }
    _dirty = true;
  }
  function putBody(rec, pl) {
    if (!CBZ.citySpawnOwnedCar || !CBZ.cityCars) return null;
    const w = toWorld(pl, rec.lx, rec.lz), h = headIn(pl) + (rec.lh || 0);
    for (const c of CBZ.cityCars) if (c && !c.dead && c.pos && Math.hypot(c.pos.x - w.x, c.pos.z - w.z) < 2) return null;   // something stands there
    /* NOBODY IS SITTING IN IT. vehicles.js decides a crew for every car it
       makes and, when the camera is close, seats real people in it on the
       spot, before the caller can say the car is parked; a body put back
       beside you (a reload inside your own lock-up) came back with a stranger
       pulled off the street into the driver's seat. For the length of this
       one call no crew is decided at all. */
    const CF = CBZ.CONFIG, had = CF ? CF.VEHICLE_REAL_GLASS : undefined;
    let car = null;
    if (CF) CF.VEHICLE_REAL_GLASS = false;
    try { car = CBZ.citySpawnOwnedCar(w.x, w.z, rec.name); } catch (e) { car = null; }
    if (CF) { if (had === undefined) delete CF.VEHICLE_REAL_GLASS; else CF.VEHICLE_REAL_GLASS = had; }
    if (!car) return null;
    car.heading = h; car.v = 0; car.ai = false;
    if (car.pos) { car.pos.x = w.x; car.pos.z = w.z; }
    if (car.group) { car.group.position.x = w.x; car.group.position.z = w.z; car.group.rotation.y = h; }
    if (rec.hot) { car.stolen = true; car.owned = false; }
    car._lockupWasPersist = false; car._persist = true; car._lockupRec = rec;
    if (rec.mods && CBZ.cityRestoreCarMods) { try { CBZ.cityRestoreCarMods(car, rec); } catch (e) {} }
    if (rec.color != null) {
      const paint = function (cc) { if (CBZ.cityRecolorCar) { try { CBZ.cityRecolorCar(cc, rec.color); } catch (e) {} } };
      if (CBZ.cityWhenCarBuilt) CBZ.cityWhenCarBuilt(car, paint); else paint(car);
    }
    live.set(rec, car);
    return car;
  }
  function carTick() {
    const P = CBZ.player; if (!P || !P.pos || !CBZ.cityCars) return;
    const S = state(), PL = places(), byKey = {};
    for (const pl of PL) byKey[pl.key] = pl;
    // a car from a save that had no places: the first free bay you own
    for (const rec of S.vehicles) {
      if (rec.place) continue;
      for (const pl of PL) {
        const mine = carsOf(pl.key);
        if (mine.length >= pl.cap) continue;
        for (let i = 0; i < pl.cap; i++) {
          const b = pl.bay(i);
          if (mine.some(function (r) { return Math.hypot(r.lx - b.lx, r.lz - b.lz) < 1.8; })) continue;
          rec.place = pl.key; rec.lx = r2(b.lx); rec.lz = r2(b.lz); rec.lh = 0; _dirty = true;
          break;
        }
        if (rec.place) break;
      }
    }
    // the cars that are here: still here? moved? driven out?
    for (let i = S.vehicles.length - 1; i >= 0; i--) {
      const rec = S.vehicles[i], car = live.get(rec), pl = byKey[rec.place];
      if (!car) continue;
      if (carGone(car)) { live.delete(rec); continue; }               // the world dropped the body: it is put back
      if (car.dead) { dropRec(rec, car); continue; }                  // burnt out: there is no car to keep
      if (!pl) { if (String(rec.place).indexOf("ck:") === 0) dropRec(rec, car); continue; }   // the garage it stood in was taken down
      if (!insidePlace(pl, car.pos.x, car.pos.z)) { dropRec(rec, car); continue; }            // you took it
      if (car.player || Math.abs(car.v || 0) > 0.4) continue;
      const l = toLocal(pl, car.pos.x, car.pos.z), lh = wrap((car.heading || 0) - headIn(pl));
      if (Math.abs(l.x - rec.lx) > 0.05 || Math.abs(l.z - rec.lz) > 0.05 || Math.abs(wrap(lh - (rec.lh || 0))) > 0.02) {
        rec.lx = r2(l.x); rec.lz = r2(l.z); rec.lh = r2(lh); _dirty = true;
      }
      if (car.color != null && rec.color !== car.color) { rec.color = car.color; _dirty = true; }
      // a stolen car behind a shut door is yours
      if (rec.hot && pl.shutAt(rec.lx)) {
        delete rec.hot; car.stolen = false; car.owned = true; car._propParked = false; _dirty = true;
        note("Off the street. The " + rec.name + " is yours.", 2.4);
      }
    }
    for (const pl of PL) {
      const dP = Math.hypot(pl.cx - P.pos.x, pl.cz - P.pos.z);
      // a car you leave inside stays
      if (dP < 90) {
        let n = carsOf(pl.key).length;
        for (const c of CBZ.cityCars) {
          if (!claimable(c, P) || !insidePlace(pl, c.pos.x, c.pos.z)) continue;
          if (n >= pl.cap) { if (!c._lockupFull) { c._lockupFull = true; note("No bay left in " + pl.name + ".", 2); } continue; }
          const l = toLocal(pl, c.pos.x, c.pos.z);
          const rec = { place: pl.key, name: carName(c), lx: r2(l.x), lz: r2(l.z), lh: r2(wrap((c.heading || 0) - headIn(pl))) };
          if (c.color != null) rec.color = c.color;
          if (c.mods) { try { rec.mods = clone(c.mods); } catch (e) {} }
          if (c.stolen && !c.owned) rec.hot = true;
          c._lockupWasPersist = !!c._persist; c._persist = true; c._lockupRec = rec; c._lockupFull = false;
          S.vehicles.push(rec); live.set(rec, c); n++; _dirty = true;
        }
      }
      // the bodies of the cars that are kept here
      if (dP < sightR()) {
        for (const rec of S.vehicles) if (rec.place === pl.key && !live.get(rec)) putBody(rec, pl);
      }
    }
  }

  // ============================================================
  //  THE RACK AND THE PALLET
  // ============================================================
  function gunName(id) {
    try { const W = CBZ.WEAPONS || CBZ.weaponData; const w = W && W[id]; if (w && w.name) return w.name; } catch (e) {}
    return String(id || "gun").replace(/^\w/, function (c) { return c.toUpperCase(); });
  }
  // the gun you have out (the test city/inventory.js's chest makes)
  function heldGun() {
    const id = CBZ.currentWeaponId;
    if (!id || !(CBZ.cityHasGun && CBZ.cityHasGun())) return null;
    if ((CBZ.weaponInventory || []).indexOf(id) < 0) return null;
    return id;
  }
  function rackPut(U) {
    const id = heldGun(), L = gunsOf(U.prop.id);
    if (!id || !CBZ.lockWeapon || L.length >= U.unit.pegs) return false;
    if (!CBZ.lockWeapon(id)) return false;
    L.push(id);
    sfx("pickup"); persist();
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  }
  function rackTake(U, i) {
    const L = gunsOf(U.prop.id);
    if (i == null) i = L.length - 1;
    if (!L[i] || !CBZ.unlockWeapon) return false;
    const id = L.splice(i, 1)[0];
    CBZ.unlockWeapon(id, { select: true });
    sfx("pickup"); persist();
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  }
  function carried() {
    const E = econ(), out = [];
    if (E) for (const c of AMMO_CRATES) if (E.count(c.label) > 0) out.push(c);
    return out;
  }
  function crateDown(U, def) {
    const E = econ(); if (!E || !def) return false;
    if (cratesOf(U.prop.id).length >= U.unit.crates) { note("The pallet is full.", 1.6); return false; }
    if (!E.take(def.label, 1)) return false;
    state().crates.push({ unit: U.prop.id, id: def.id, n: def.qty });
    sfx("pickup"); persist();
    return true;
  }
  function crateTake(rec, n) {
    const def = CRATE_BY_ID[rec.id]; if (!def || !CBZ.fpsAddAmmo) return false;
    n = Math.min(rec.n | 0, n | 0);
    if (n <= 0) return false;
    try { CBZ.fpsAddAmmo(n, rec.id); } catch (e) { return false; }
    rec.n -= n;
    if (rec.n <= 0) { const C = state().crates, i = C.indexOf(rec); if (i >= 0) C.splice(i, 1); }
    sfx("pickup"); persist();
    return true;
  }
  // a full box goes back in your bag (to carry to another unit)
  function crateUp(rec) {
    const def = CRATE_BY_ID[rec.id], E = econ();
    if (!def || !E || rec.n !== def.qty) return false;
    const C = state().crates, i = C.indexOf(rec); if (i < 0) return false;
    C.splice(i, 1); E.add(def.label, 1);
    sfx("pickup"); persist();
    return true;
  }

  // ---- what is on the rack and the pallet is THERE -----------------------
  const CRATE = { geo: {}, mat: {}, lid: null, rope: null };
  function crateMesh(def) {
    const s = def.size, grp = new THREE.Group();
    const key = s.join("x");
    if (!CRATE.geo[key]) { CRATE.geo[key] = { body: new THREE.BoxGeometry(s[0], s[1], s[2]), lid: new THREE.BoxGeometry(s[0] + 0.03, 0.035, s[2] + 0.03), band: new THREE.BoxGeometry(s[0] * 0.36, s[1] * 0.5, s[2] + 0.006) }; }
    if (!CRATE.mat[def.id]) CRATE.mat[def.id] = new THREE.MeshLambertMaterial({ color: def.tone });
    if (!CRATE.lid) { CRATE.lid = new THREE.MeshLambertMaterial({ color: 0x2f3526 }); CRATE.rope = new THREE.MeshLambertMaterial({ color: 0xd9c98a }); }
    const G = CRATE.geo[key];
    const body = new THREE.Mesh(G.body, CRATE.mat[def.id]); body.position.y = s[1] / 2; grp.add(body);
    const lid = new THREE.Mesh(G.lid, CRATE.lid); lid.position.y = s[1] + 0.0175; grp.add(lid);
    const band = new THREE.Mesh(G.band, CRATE.rope); band.position.y = s[1] * 0.5; grp.add(band);   // the stencilled label panel
    return grp;
  }
  function gunMesh(id) {
    let m = null;
    try { m = CBZ.buildActorWeapon ? CBZ.buildActorWeapon(id) : null; } catch (e) { m = null; }
    if (!m) return new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.05), new THREE.MeshLambertMaterial({ color: 0x24272c }));
    const sc = (CBZ.weaponWorldScale && CBZ.weaponWorldScale((m.userData && m.userData.weaponId) || id)) || 1;
    m.scale.setScalar(sc);
    return m;
  }
  const crateTok = new WeakMap();   // crate record -> its stable card target
  function crateSpot(U, i) { const p = U.F.w(U.d.crateX0 + i * CR_P, U.d.D - WT - 0.52); return { x: p.x, z: p.z }; }
  function tokensOf(U) {
    const out = [], L = cratesOf(U.prop.id);
    for (let i = 0; i < L.length; i++) {
      let t = crateTok.get(L[i]);
      if (!t) { t = { rec: L[i], U: U, x: 0, y: 0, z: 0 }; crateTok.set(L[i], t); }
      const p = crateSpot(U, i);
      t.U = U; t.x = p.x; t.z = p.z; t.y = U.y + 0.3; t.def = CRATE_BY_ID[L[i].id];
      out.push(t);
    }
    return out;
  }
  function refreshContents(U) {
    if (!U.contents || !U.unit) return;
    const id = U.prop.id, guns = owns(id) ? gunsOf(id) : [], crates = owns(id) ? cratesOf(id) : [];
    const sig = guns.join(",") + "|" + crates.map(function (c) { return c.id; }).join(",");
    if (sig === U.sig) return;
    U.sig = sig;
    const C = U.contents, d = U.d;
    for (let i = C.children.length - 1; i >= 0; i--) C.remove(C.children[i]);
    // the rack faces the room: its own +Z is the way back out to the doors
    const rp = U.F.w(d.rackX, d.D - WT - 0.07);
    const rack = new THREE.Group();
    rack.position.set(rp.x, U.y, rp.z); rack.rotation.y = U.F.yaw + Math.PI;
    for (let i = 0; i < guns.length && i < U.unit.pegs; i++) {
      const m = gunMesh(guns[i]);
      m.position.set(-(d.cols - 1) * 0.36 + ((i / 2) | 0) * 0.72, 1.55 - (i % 2) * 0.34, 0.07);
      m.rotation.set(0, Math.PI / 2, 0);
      rack.add(m);
    }
    C.add(rack);
    for (let i = 0; i < crates.length; i++) {
      const def = CRATE_BY_ID[crates[i].id]; if (!def) continue;
      const m = crateMesh(def), p = crateSpot(U, i);
      m.position.set(p.x, U.y + 0.12, p.z); m.rotation.y = U.F.yaw;
      C.add(m);
    }
  }
  function contentsNote(prop) {
    if (!owns(prop.id)) return prop.blurb || "";
    if (!prop.unit) return "yours";
    const v = carsOf(prop.id), gn = gunsOf(prop.id).length, cr = cratesOf(prop.id).length;
    let s = v.length ? v.length + " of " + prop.unit.bays + " bays: " + v.slice(-3).reverse().map(function (r) { return r.name; }).join(", ") + (v.length > 3 ? " and " + (v.length - 3) + " more" : "") : "bays empty";
    if (gn) s += ". " + gn + (gn === 1 ? " gun" : " guns") + " on the rack";
    if (cr) s += ". " + cr + (cr === 1 ? " crate" : " crates");
    return s;
  }

  // ============================================================
  //  THE VERBS (city/interactions.js)
  // ============================================================
  // the unit of yours this point is inside (its inside, built)
  function unitAround(px, pz) {
    for (const U of UNITS) {
      if (!U.unit || !U.F || !U.grp || !owns(U.prop.id)) continue;
      const l = U.F.l(px, pz);
      if (l.x > U.d.x0 - 0.2 && l.x < U.d.x1 + 0.2 && l.z > -0.6 && l.z < U.d.z1 + 0.2) return U;
    }
    return null;
  }
  function near(t, px, pz, r) { return (t.x - px) * (t.x - px) + (t.z - pz) * (t.z - pz) < r * r; }
  let wired = false;
  function wire() {
    const I = CBZ.interactions;
    if (wired || !I || !I.registerZone) return;
    wired = true;
    const owe = function (prop) { return (prop.id === "freeport" && CBZ.cashStore && CBZ.cashStore.remaining) ? CBZ.cashStore.remaining() : prop.cost; };
    const safe = function (fn) { return function (px, pz, ctx) { try { return fn(px, pz, ctx); } catch (e) { return null; } }; };

    // ---- the sign: buy it
    I.registerZone({
      id: "zone-property", kind: "lockupsign", radius: 5, prio: 7,     // (kind "property" is city/plots.js's lot card)
      find: safe(function (px, pz) {
        const P = CBZ.player; if (!P || P._aircraft) return null;
        let best = null, bd = 25;
        for (const U of UNITS) {
          if (!U.signGrp) continue;
          const dd = (U.tok.x - px) * (U.tok.x - px) + (U.tok.z - pz) * (U.tok.z - pz);
          if (dd < bd) { bd = dd; best = U.tok; }
        }
        return best;
      }),
      options: [
        { id: "property-buy", slot: "e", prio: 5, campaignSafe: true, label: function (t) { return asIs("Buy it " + money(owe(t.prop))); },
          canShow: function (t) { return !owns(t.prop.id); }, onSelect: function (t) { buy(t.prop); refreshSign(t.U); } },
      ],
    });
    I.describe("lockupsign", function (t) { return { label: (t && t.prop && t.prop.name) || "", note: t && t.prop ? contentsNote(t.prop) : "" }; });

    // ---- a roller door: raise it, lower it (from the seat too)
    I.registerZone({
      id: "zone-lockup-door", kind: "lockupdoor", radius: 14, prio: 7,
      find: safe(function (px, pz, ctx) {
        const P = CBZ.player; if (!P || P._aircraft) return null;
        const reach = ctx && ctx.driving ? 9 : 2.7;
        let best = null, bd = reach;
        for (const U of UNITS) {
          if (!U.grp || !U.doors.length || !owns(U.prop.id)) continue;
          if (Math.abs(px - U.cx) > U.d.W / 2 + 12 || Math.abs(pz - U.cz) > U.d.W / 2 + 12) continue;
          const l = U.F.l(px, pz);
          for (const Dr of U.doors) {
            const ex = Math.max(0, Math.abs(l.x - Dr.lx) - U.d.DW / 2), dd = Math.hypot(ex, l.z - WT / 2);
            if (dd < bd) { bd = dd; best = Dr; }
          }
        }
        return best;
      }),
      options: [
        { id: "lockup-raise", slot: "e", prio: 6, campaignSafe: true, label: function () { return asIs("Raise the door"); },
          canShow: function (t) { return t.want === 0; }, onSelect: function (t) { setDoor(t, true); } },
        { id: "lockup-lower", slot: "e", prio: 6, campaignSafe: true, label: function () { return asIs("Lower the door"); },
          canShow: function (t) { return t.want === 1; }, onSelect: function (t) { setDoor(t, false); } },
      ],
    });
    I.describe("lockupdoor", function (t) {
      if (!t || !t.U) return { label: "" };
      const U = t.U, half = U.d.DW / 2 + PIER / 2;
      const inBay = carsOf(U.prop.id).filter(function (r) { return Math.abs(r.lx - t.lx) < half; }).map(function (r) { return r.name; });
      return { label: U.prop.name, note: inBay.length ? inBay.join(", ") + " inside" : "empty" };
    });

    // ---- the rack: the gun in your hands goes up, a gun comes down
    const rackOpts = [
      { id: "lockup-rack-put", slot: "e", prio: 6, campaignSafe: true, label: function () { return asIs("Put up the " + gunName(heldGun())); },
        canShow: function (t) { return !!heldGun() && gunsOf(t.U.prop.id).length < t.U.unit.pegs; }, onSelect: function (t) { rackPut(t.U); } },
      { id: "lockup-rack-take", slot: "e", prio: 5, campaignSafe: true,
        label: function (t) { const L = gunsOf(t.U.prop.id); return asIs("Take the " + gunName(L[L.length - 1])); },
        canShow: function (t) { return !heldGun() && gunsOf(t.U.prop.id).length > 0; }, onSelect: function (t) { rackTake(t.U); } },
      { id: "lockup-rack-take-held", slot: "e", hold: true, prio: 5, campaignSafe: true,
        label: function (t) { const L = gunsOf(t.U.prop.id); return asIs("Take the " + gunName(L[L.length - 1])); },
        canShow: function (t) { return !!heldGun() && gunsOf(t.U.prop.id).length > 0; }, onSelect: function (t) { rackTake(t.U); } },
    ];
    for (let n = 0; n < 8; n++) rackOpts.push({ id: "lockup-rack-take-" + n, wheel: true, prio: 3, campaignSafe: true,
      label: function (t) { return asIs("Take the " + gunName(gunsOf(t.U.prop.id)[n])); },
      canShow: function (t) { const L = gunsOf(t.U.prop.id); return !!L[n] && n !== L.length - 1; },
      onSelect: function (t) { rackTake(t.U, n); } });
    I.registerZone({
      id: "zone-lockup-rack", kind: "lockuprack", radius: 2.6, prio: 9, driving: false,
      find: safe(function (px, pz) { const U = unitAround(px, pz); return U && U.unit.pegs && near(U.rackTok, px, pz, 2.6) ? U.rackTok : null; }),
      options: rackOpts,
    });
    I.describe("lockuprack", function (t) {
      const L = t && t.U ? gunsOf(t.U.prop.id) : [];
      return { label: "Gun rack", note: L.length ? L.map(gunName).join(", ") : "empty" };
    });

    // ---- the pallet: a crate you are carrying goes down on it
    const floorOpts = AMMO_CRATES.map(function (def, k) {
      return { id: "lockup-crate-down-" + def.id, slot: "e", prio: 6 - k * 0.1, campaignSafe: true,
        label: function () { return asIs("Stack the " + def.label); },
        canShow: function () { const E = econ(); return !!E && E.count(def.label) > 0; },
        onSelect: function (t) { crateDown(t.U, def); } };
    });
    I.registerZone({
      id: "zone-lockup-pallet", kind: "lockuppallet", radius: 3.2, prio: 8, driving: false,
      // (the card hangs where the next box will stand, so looking at a crate
      //  is that crate and looking at the empty boards is the pallet)
      find: safe(function (px, pz) {
        const U = unitAround(px, pz);
        if (!U || !U.unit.crates || !carried().length) return null;
        const n = cratesOf(U.prop.id).length;
        if (n >= U.unit.crates) return null;
        const p = crateSpot(U, n), t = U.floorTok;
        t.x = t.pos.x = p.x; t.z = t.pos.z = p.z;
        return near(t, px, pz, 3.2) ? t : null;
      }),
      options: floorOpts,
    });
    I.describe("lockuppallet", function (t) {
      const n = t && t.U ? cratesOf(t.U.prop.id).length : 0;
      return { label: "Pallet", note: n ? n + " of " + t.U.unit.crates + " crates" : "empty" };
    });

    // ---- a crate on the floor: take rounds out of it
    if (I.registerFixtures) {
      I.registerFixtures({
        id: "lockup-crate", kind: "lockupcrate", prio: 9,
        list: function (ctx, px, pz) { const U = unitAround(px, pz); return U ? tokensOf(U) : null; },
        reach: function () { return 2.3; },
        dot: function () { return 0.5; },
        verbs: [
          { id: "lockup-crate-take", slot: "e", prio: 6,
            label: function (t) { const n = Math.min(t.rec.n, t.def.take); return asIs("Take " + n + " " + (n === 1 ? t.def.one : t.def.many)); },
            canShow: function (t) { return !!t.def && t.rec.n > 0; }, onSelect: function (t) { crateTake(t.rec, t.def.take); } },
          { id: "lockup-crate-all", slot: "e", hold: true, prio: 5,
            label: function (t) { return asIs("Take all " + t.rec.n); },
            canShow: function (t) { return !!t.def && t.rec.n > t.def.take; }, onSelect: function (t) { crateTake(t.rec, t.rec.n); } },
          { id: "lockup-crate-up", wheel: true, prio: 2, label: function () { return asIs("Pick up the crate"); },
            canShow: function (t) { return !!t.def && t.rec.n === t.def.qty; }, onSelect: function (t) { crateUp(t.rec); } },
        ],
      });
      I.describe("lockupcrate", function (t) { return { label: (t && t.def && t.def.label) || "Crate", note: t && t.rec && t.def ? t.rec.n + " " + (t.rec.n === 1 ? t.def.one : t.def.many) : "" }; });
    }
  }

  /* THE CRATES ARE SOLD BY THE GUN-SHOP CLERK (city/shops.js asks every file
     what else its clerks do): he hands one over the counter and it is an item
     in your bag until you put it down on a pallet. He only offers them to
     somebody who has a pallet to put one on. */
  function hasPallet() { for (const p of PROPERTIES) if (p.unit && p.unit.crates && owns(p.id)) return true; return false; }
  function say(v, text) {
    if (v && !v.dead && CBZ.citySay) { try { CBZ.citySay(v, text, null, { secs: 2.6, force: true }); return; } catch (e) {} }
    note(text, 2);
  }
  function sellCrate(v, def) {
    const E = econ(); if (!E) return;
    const paid = CBZ.city && CBZ.city.spend ? CBZ.city.spend(def.cost) : (canAfford(def.cost) && charge(def.cost));
    if (!paid) { say(v, money(def.cost) + ". You're short."); return; }
    sfx("coin");
    if (v) v.cash = (v.cash | 0) + def.cost;
    let done = false;
    const fin = function () {
      if (done) return; done = true;
      registerItems(); E.add(def.label, 1);
      say(v, def.qty + " " + def.many + ". Stack it on your pallet.");
    };
    let S = null;
    const V = CBZ.verbs;
    if (v && V && V.takeFrom) { try { S = V.takeFrom(CBZ.player, v, { at: "wristR", kind: "box", pose: "grip", dur: 0.55, onTaken: fin }); } catch (e) { S = null; } }
    if (!S) fin();
  }
  if (CBZ.cityCounterAsk) CBZ.cityCounterAsk(function (v, lot, kind, add) {
    if (kind !== "guns" || !hasPallet()) return;
    for (const def of AMMO_CRATES) add("crate-" + def.id, def.label + " " + money(def.cost), function (vv) { sellCrate(vv, def); });
  });

  // ============================================================
  //  THE TICK
  // ============================================================
  let slowT = 0;
  CBZ.onUpdate(13.5, function (dt) {
    if (g.mode !== "city" || !arenaRoot()) return;
    dt = dt || 0.016;
    hydrate();
    wire();
    if (!ensureUnits()) return;
    doorsTick(dt);
    slowT -= dt;
    if (slowT > 0) return;
    const step = 0.5 - slowT; slowT = 0.5;
    registerItems();
    resolveTick(step);
    nearTick();
    carTick();
    if (_dirty) { _dirty = false; persist(); }
  });

  // ============================================================
  //  RESET (new run / mode switch). What you own and what is in it is the
  //  ledger's (hydrate re-reads it); the bodies and the meshes are rebuilt.
  // ============================================================
  function teardown() {
    if (_dirty) { _dirty = false; persist(); }
    g._cityStorageHydrated = false;
    for (const pair of live) { const car = pair[1]; if (car && !carGone(car) && !car.player && CBZ.cityScrapCar) { try { CBZ.cityScrapCar(car); } catch (e) {} } }
    live.clear();
    dropUnits();
  }
  CBZ.cityStorageReset = teardown;
  // chained onto the vehicles reset, so a fresh run re-reads the ledger and
  // re-stands the units against the rebuilt arena
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
  // where each property is (its sign; before a unit is placed, its anchor)
  function spots() {
    if (!ensureUnits()) return null;
    return UNITS.map(function (U) {
      const p = ((U.resolved || U.signOnly) && signPlace(U)) || anchorOf(U.prop);
      return { prop: U.prop, x: p.x, z: p.z, beacon: U.signGrp || null };
    });
  }
  CBZ.cityStorage = {
    PROPERTIES: PROPERTIES, AMMO_CRATES: AMMO_CRATES,
    owns: owns, buy: buy, grant: grant, state: state,
    vehCapTotal: vehCapTotal, storedVehicleCount: storedVehicleCount,
    contentsNote: contentsNote, spots: spots,
    unit: unitOf, setDoor: setDoor, places: places,
  };
})();
