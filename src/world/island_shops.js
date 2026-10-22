/* ============================================================
   world/island_shops.js — THE ISLANDS' SHOPS ARE SHOPS.

   Every shop lot on an archipelago island has a use (world/island_plan.js
   assignUses). This file fits the ground floor of the ones that SELL THINGS
   with the same store systems Gang City runs, per building, through
   CBZ.islandVenue (world/island_venue.js): the default furniture comes out
   (clear(b, 0)), the shop goes in, and it all leaves with the island.

     clothing, suits   city/clothingstore.js (CBZ.clothingStoreMount): the
                       racks, the dressed forms, the fitting room, the
                       mirror, the cash wrap. A tailor (suits) is the same
                       store dark and sparse: suits, shirts, ties, trousers.
     eyewear, phones   city/storegoods.js (CBZ.storeGoodsMount): real frames
                       and real handsets (CBZ.itemAsset) on display tables
                       and wall bays. E buys, I pockets (the clerk who can
                       see it calls it in). Shades go on your face.
     the trades        the chemist, the grocer, the hardware shop, the
                       chandlery, the cafe ... the same shelves with what
                       that trade sells and the game has a real model of
                       (the hardware shop and the chandlery sell torches:
                       the island night is dark). A trade with nothing real
                       to sell (a florist, a laundry) still has its counter
                       and the person behind it.

   Every one of them has a counter at the back and a clerk behind it, one of
   the island's own people (CBZ.islandVenue.staff), who watches you while
   you are in his shop.
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.islandVenue) return;
  const IV = CBZ.islandVenue;
  function IB() { return CBZ.islandBuilding || { FH: 3.2, WT: 0.25, DOORW: 1.4 }; }

  /* ---- WHAT EACH TRADE SELLS --------------------------------------------
     kind: the storegoods profile (and the shop kind the counter acquire
     reads: "food" eats one at the counter, "eyewear" puts the pair on);
     stock: the real items (null = the profile's own catalogue); tables:
     display tables down the middle. No entry = counter and clerk only. */
  const TRADE = {
    eyewear:   { kind: "eyewear", stock: null, tables: 2 },
    phones:    { kind: "electronics", stock: null, tables: 2 },
    hardware:  { kind: "hardware", stock: null },
    chandlery: { kind: "hardware", stock: ["Flashlight", "Water", "Bandage", "Medkit", "Crowbar"] },
    grocer:    { kind: "store", stock: ["Bread", "Apple", "Canned Beans", "Soda", "Water", "Energy Drink", "Flashlight"] },
    newsagent: { kind: "store", stock: ["Soda", "Water", "Energy Drink", "Burner Phone", "Flashlight"] },
    deli:      { kind: "food", stock: ["Bread", "Canned Beans", "Soda", "Water"] },
    bakery:    { kind: "food", stock: ["Bread", "Coffee", "Soda", "Water"] },
    cafe:      { kind: "food", stock: ["Coffee", "Bread", "Soda", "Water"] },
    diner:     { kind: "food", stock: ["Burger", "Fries", "Hotdog", "Pizza Slice", "Soda", "Coffee"] },
    chemist:   { kind: "hospital", stock: ["Bandage", "Medkit"] },
    barber:    { kind: "barber", stock: null },
    surfshop:  { kind: "store", stock: ["Sunglasses", "Sport Wraps", "Water", "Energy Drink"] },
    diveshop:  { kind: "store", stock: ["Flashlight", "Water", "Bandage"] },
  };
  const COUNTER_ONLY = ["books", "florist", "butcher", "icecream", "laundry"];
  const JOB = { suits: "tailor", clothing: "shop assistant", eyewear: "optician", phones: "shop assistant",
    chemist: "pharmacist", barber: "barber", butcher: "butcher", bakery: "baker", cafe: "barista", diner: "cook" };

  /* ---- THE ROOM ------------------------------------------------------------
     The ground floor's walls, less the stair strip down the -x side (when the
     building has stairs): what a shop can stand in. The door band and the
     front walk stay walkable through clearLocal. */
  function roomOf(b) {
    const F = IV.floor(b, 0);
    let x0 = F.local.x0;
    for (const r of F.keepOut) if (r.why === "stairs") x0 = Math.max(x0, r.x1 + 0.1);
    return { F: F, x0: x0, x1: F.local.x1, z0: F.local.z0, z1: F.local.z1 };
  }
  function clearLocal(R, lx, lz, pad) {
    pad = pad || 0;
    if (lx - pad < R.x0 || lx + pad > R.x1 || lz - pad < R.z0 || lz + pad > R.z1) return false;
    for (const r of R.F.keepOut) {
      if (r.why === "stairs") continue;                        // already outside the room
      if (lx + pad > r.x0 && lx - pad < r.x1 && lz + pad > r.z0 && lz - pad < r.z1) return false;
    }
    return true;
  }
  function insideRoom(R, x, z) {
    const p = R.F.toLocal(x, z);
    return p.x > R.x0 - 0.3 && p.x < R.x1 + 0.3 && p.z > R.z0 - 0.3 && p.z < R.z1 + 0.3;
  }

  /* ---- THE COUNTER AND THE PERSON BEHIND IT --------------------------------
     A counter across the back, the clerk between it and the back wall,
     facing the door; he looks at you while you are in his shop. Returns
     { local {x, z, w, d}, top (local y), post }. The counter is drawn here
     unless the store dresses its own (opts.draw === false: the clothing
     store's cash wrap); it is solid either way. */
  function counterAndClerk(b, lot, R, opts) {
    opts = opts || {};
    const L = lot.building, y0 = R.F.yLocal;
    const W = R.x1 - R.x0;
    const cw = opts.w || Math.max(1.6, Math.min(3.0, W - 3.2));
    const cd = 0.7;
    const cx = opts.x != null ? opts.x : (R.x0 + R.x1) / 2;
    const cz = R.z1 - (opts.back || 1.35);
    const top = y0 + 1.165;
    if (opts.draw !== false) {
      L.lbox(cx, y0 + (top - y0 - 0.04) / 2, cz, cw, top - y0 - 0.04, cd, opts.clad || 0x4a3f36, { solid: true });
      L.lbox(cx, top - 0.02, cz + 0.03, cw + 0.08, 0.04, cd + 0.12, opts.work || 0xd9d4ca, {});
      L.lbox(cx, y0 + 0.05, cz + cd / 2 + 0.004, cw - 0.02, 0.1, 0.01, 0x1a1612, {});
      // the till on the clerk's side, and the card reader on yours
      L.lbox(cx - cw / 2 + 0.5, top + 0.14, cz - 0.12, 0.34, 0.24, 0.04, 0x1a1b1e, {});
      L.lbox(cx - cw / 2 + 0.5, top + 0.01, cz - 0.12, 0.2, 0.02, 0.18, 0x2a2d31, {});
      L.lbox(cx - cw / 2 + 0.95, top + 0.03, cz + 0.22, 0.08, 0.05, 0.12, 0x24262a, {});
    } else {
      const F = R.F, a = F.toWorld(cx - cw / 2, cz - cd / 2), c = F.toWorld(cx + cw / 2, cz + cd / 2);
      const rec = { minX: Math.min(a.x, c.x), maxX: Math.max(a.x, c.x), minZ: Math.min(a.z, c.z), maxZ: Math.max(a.z, c.z), y0: b.gy + y0 - 0.1, y1: b.gy + top };
      if (CBZ.colliderAddMany) CBZ.colliderAddMany([rec]); else (CBZ.colliders || (CBZ.colliders = [])).push(rec);
    }
    const look = function () {
      const P = CBZ.player;
      if (!P || !P.pos || P.dead) return null;
      // in his shop, or just out of the door with something he saw you take
      const out = !insideRoom(R, P.pos.x, P.pos.z);
      if (out && !(CBZ.clothingHeld && CBZ.clothingHeld().theft && Math.hypot(P.pos.x - post.x, P.pos.z - post.z) < 30)) return null;
      return { x: P.pos.x, z: P.pos.z };
    };
    const post = IV.staff(b, cx, R.z1 - 0.5, Math.PI, { job: opts.job || "clerk", look: look });
    // the register on the counter is a real balance (city/islandmoney.js IV.till)
    if (IV.till) { try { IV.till(b, { lx: cx - cw / 2 + 0.5, ly: top, lz: cz - 0.12, clerk: post, draw: false }); } catch (e) {} }
    // the clerk the shop systems ask for (theft eyes, the ladder, a thank-you)
    Object.defineProperty(L, "vendor", { configurable: true, get: function () { return post ? post.body() : null; } });
    return { local: { x: cx, z: cz, w: cw, d: cd }, top: top, post: post };
  }

  /* ---- A SHELVED SHOP (storegoods) --------------------------------------- */
  function goodsShop(b, lot, job, T) {
    IV.clear(b, 0);
    const R = roomOf(b), L = lot.building;
    const K = counterAndClerk(b, lot, R, { job: JOB[b.use] || "shop assistant" });
    if (!CBZ.storeGoodsMount || !T) return null;
    const shim = {
      kind: T.kind, cx: b.x, cz: b.z, w: b.w, d: b.d, island: true,
      building: {
        shop: { kind: T.kind }, group: b.group, ox: b.ox, oz: b.oz,
        // building-local, the door on -z: the INWARD normal is +z
        localDoor: { x: 0, z: -(b.ld || b.d) / 2, nx: 0, nz: 1 },
        w: b.lw || b.w, d: b.ld || b.d, wt: IB().WT, floorTops: [R.F.yLocal],
        clearFloorPoint: function (lx, lz, pad) { return clearLocal(R, lx, lz, pad); },
        counterLocal: K.local,
        planHints: { wallStart: 2.2, backKeep: 2.0, tables: T.tables || 0, lanes: T.tables ? 0 : undefined },
        stock: T.stock || null,
      },
    };
    Object.defineProperty(shim.building, "vendor", { get: function () { return L.vendor; } });
    const m = CBZ.storeGoodsMount(shim);
    return m ? m.dispose : null;
  }

  /* ---- AN OUTFITTER / A TAILOR (clothingstore) ----------------------------- */
  function clothesShop(b, lot, job, tailor) {
    if (!CBZ.clothingStoreMount) return null;
    IV.clear(b, 0);
    const R = roomOf(b), F = R.F, WT = IB().WT;
    // the cash wrap on the stair side, the fitting room on the other (local +x)
    const cw = Math.max(1.8, Math.min(2.4, (R.x1 - R.x0) * 0.32));
    const K = counterAndClerk(b, lot, R, { draw: false, x: R.x0 + 0.45 + cw / 2, w: cw, back: 1.45, job: JOB[b.use] || "shop assistant" });
    const o = F.toWorld(0, 0), u = F.toWorld(0, 1);
    const inx = u.x - o.x, inz = u.z - o.z, tx = -inz, tz = inx;
    const c = F.toWorld((R.x0 + R.x1) / 2, (R.z0 + R.z1) / 2);
    const door = F.toWorld(0, R.z0 - WT);
    const a = F.toWorld(R.x0, R.z0), z = F.toWorld(R.x1, R.z1);
    const ff = F.y + 0.005;
    const kc = F.toWorld(K.local.x, K.local.z);
    const L = lot.building;
    const shim = {
      kind: "clothing", cx: c.x, cz: c.z, island: true,
      building: {
        ox: b.ox, oz: b.oz,
        clearFloorPoint: function (dx, dz, pad) { const p = F.toLocal(b.ox + dx, b.oz + dz); return clearLocal(R, p.x, p.z, pad); },
        counter: { x: kc.x, z: kc.z, w: K.local.w, d: K.local.d, top: b.gy + K.top, tx: tx, tz: tz, inx: inx, inz: inz },
      },
    };
    Object.defineProperty(shim.building, "vendor", { get: function () { return L.vendor; } });
    const cs = {
      name: b.name || null, cx: c.x, cz: c.z, inx: inx, inz: inz, tx: tx, tz: tz,
      halfIn: (R.z1 - R.z0) / 2 + WT, halfTan: (R.x1 - R.x0) / 2 + WT, wt: WT,
      ff: ff, ceil: ff + IB().FH - 0.35,
      dwx: door.x, dwz: door.z,
      bounds: { minX: Math.min(a.x, z.x), maxX: Math.max(a.x, z.x), minZ: Math.min(a.z, z.z), maxZ: Math.max(a.z, z.z) },
      // the door band and the walk to the stairs stay clear; +lat is local -x
      walk: WT + 2.45, fitSide: -1, heroSide: -1,
    };
    const m = CBZ.clothingStoreMount(shim, { cs: cs, tailor: tailor, root: job && job.arena && job.arena.root });
    return m ? m.dispose : null;
  }

  IV.on("clothing", function (b, lot, job) { return clothesShop(b, lot, job, false); });
  IV.on("suits", function (b, lot, job) { return clothesShop(b, lot, job, true); });
  for (const use in TRADE) IV.on(use, function (b, lot, job) { return goodsShop(b, lot, job, TRADE[use]); });
  for (const use of COUNTER_ONLY) IV.on(use, function (b, lot, job) {
    IV.clear(b, 0);
    counterAndClerk(b, lot, roomOf(b), { job: JOB[use] || "shop assistant" });
    return null;
  });
})();
