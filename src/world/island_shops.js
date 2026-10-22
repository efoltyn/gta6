/* ============================================================
   world/island_shops.js — THE ISLANDS' SHOPS ARE SHOPS.

   Every shop lot on an archipelago island has a use (world/island_plan.js
   assignUses). This file fits the ground floor of the ones that SELL THINGS
   with the same store systems Gang City runs, per building, through
   CBZ.islandVenue (world/island_venue.js): the house furniture comes out
   (clear(b, 0)), the stair goes behind its stairwell wall, a deep enough
   shop gets its back room (city/shopfloor.js shell: the partition, the
   staff door, the stock shelving and the safe), the shop goes in, and it all
   leaves with the island.

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

   THE REST OF THE SHOP. The real stock is the store system's; everything
   else a shop of that kind has is world/island_fitkit.js's dresser
   (CBZ.islandFit.dress), told what the store stood where: the walls lined
   with that trade's fixtures floor to ceiling (the optician's frame wall,
   the phone wall, the chandlery's rope and tins, the tailor's bolts),
   gondolas down the middle, the trade's lights, its name on the back wall,
   the shop window. One merged mesh per building.

   Every one of them has a counter at the back and a clerk behind it, one of
   the island's own people (CBZ.islandVenue.staff), who watches you while
   you are in his shop.
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.islandVenue) return;
  const THREE = window.THREE;
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

  /* ---- WHAT EACH TRADE'S ROOM LOOKS LIKE (the dresser's recipe) ----------
     Built when asked (CBZ.islandFit loads after this file). A wall entry's
     mods cycle along the wall; m(name, over) is a module with its own goods. */
  let RECIPES = null;
  function recipes() {
    if (RECIPES) return RECIPES;
    const FIT = CBZ.islandFit;
    if (!FIT || !FIT.MODS) return null;
    const M = FIT.MODS, P = FIT.PAL;
    const m = function (name, over) { return function (D, Fr, a, w, d, o) { return M[name](D, Fr, a, w, d, Object.assign({}, o, over)); }; };
    const sides = function (mods, o) { return [Object.assign({ edge: "x0", mods: mods }, o), Object.assign({ edge: "x1", mods: mods }, o)]; };
    const behind = function (mods, o) { return Object.assign({ edge: "z1", mods: mods, w: 1.0, d: 0.4, front: 0.5 }, o); };
    const grocery = [m("shelf", { style: "cans", pal: P.grocery }), m("shelf", { style: "boxes", pal: P.grocery }), m("shelf", { style: "bottles", pal: P.grocery })];
    RECIPES = {
      eyewear: {
        walls: sides(["frames"], { w: 1.2, d: 0.42 }).concat([behind(["frames"], { w: 1.2, d: 0.42 })]),
        lights: "track", signBg: "#f2f0ea", signFg: "#1d1f23", signBack: 0xe8e4da,
        window: { style: "cards", pal: [0x15171b, 0x5a3a22, 0xb8963e] },
        extra: eyeTest,
      },
      phones: {
        walls: sides(["phones", m("slat", { style: "cards", pal: P.tech, back: 0xe8e4da })], { w: 1.2, d: 0.42 }),
        centre: { mod: "table", style: "demo", len: [1.6, 1.2], d: 0.8, aisle: 1.0, max: 2, top: 0xf2f0ea },
        lights: "panel", signBg: "#15171b", signFg: "#eaf2ff",
        window: { style: "tech", pal: P.tech },
      },
      hardware: {
        walls: sides([m("shelf", { style: "tools", pal: P.hardware, accent: 0xd2462a }), m("slat", { style: "tools", pal: P.hardware })], { w: 1.2, d: 0.5 })
          .concat([behind([m("shelf", { style: "boxes", pal: P.hardware })])]),
        centre: { mod: "gondola", style: "tools", pal: P.hardware, len: [3.0, 2.4, 1.8], max: 3, cap: 0xd2462a },
        lights: "tube", signBg: "#d2462a", signFg: "#f6f4ee",
        window: { style: "tools", pal: P.hardware },
      },
      chandlery: {
        walls: sides([m("shelf", { style: "cans", pal: P.marine, accent: 0x1f4f8a }), m("slat", { style: "ropes", pal: P.marine }), m("shelf", { style: "boxes", pal: P.marine, accent: 0x1f4f8a })], { w: 1.2, d: 0.5 })
          .concat([behind([m("shelf", { style: "tools", pal: P.marine })])]),
        centre: { mod: "gondola", style: "boxes", pal: P.marine, len: [3.0, 2.4, 1.8], max: 2, cap: 0x1f4f8a },
        lights: "tube", signBg: "#1f3a5a", signFg: "#f2efe6",
        window: { style: "ropes", pal: P.marine },
      },
      grocer: {
        walls: sides(grocery, { w: 1.2, d: 0.5 }).concat([behind([m("shelf", { style: "boxes", pal: P.grocery })])]),
        centre: { mod: "gondola", style: "cans", pal: P.grocery, len: [3.6, 2.4, 1.8], max: 3, cap: 0x3b8a4a },
        lights: "panel", signBg: "#2f5a2a", signFg: "#f6f4ee",
        window: { style: "boxes", pal: P.grocery },
      },
      newsagent: {
        walls: sides([m("shelf", { style: "books", pal: P.paper, levels: [0.12, 0.45, 0.78, 1.11, 1.44] }), m("shelf", { style: "boxes", pal: P.grocery })], { w: 1.2, d: 0.42 })
          .concat([behind([m("shelf", { style: "cards", pal: P.grocery })])]),
        centre: { mod: "gondola", style: "boxes", pal: P.grocery, len: [2.4, 1.8], max: 2 },
        lights: "panel", window: { style: "books", pal: P.paper },
      },
      deli: {
        walls: sides([m("shelf", { style: "jars", pal: P.grocery }), m("shelf", { style: "bottles", pal: P.grocery })], { w: 1.2, d: 0.45 })
          .concat([behind(["board"], { w: 1.6, d: 0.1, front: 0.3 })]),
        lights: "track", window: { style: "jars", pal: P.grocery },
        centre: { mod: "chiller", len: [2.0, 1.4], d: 0.8, max: 1 },
      },
      bakery: {
        walls: sides([m("shelf", { style: "loaves", pal: P.bread, back: 0xd8c8a8, frame: 0x6b4a2a, levels: [0.12, 0.55, 0.95, 1.35] })], { w: 1.2, d: 0.5 })
          .concat([behind(["board"], { w: 1.6, d: 0.1, front: 0.3 })]),
        centre: { mod: "cafe", len: [0.9], d: 0.9, aisle: 0.9, endAisle: 0.9, max: 3 },
        lights: "track", signBg: "#5a3a22", signFg: "#f2e6c8", window: { style: "loaves", pal: P.bread },
      },
      cafe: {
        walls: sides([m("shelf", { style: "jars", pal: P.bread, back: 0x3a2a20, frame: 0x2a1a10, levels: [0.9, 1.3, 1.7] })], { w: 1.2, d: 0.35 })
          .concat([behind(["board"], { w: 1.6, d: 0.1, front: 0.3 })]),
        centre: { mod: "cafe", len: [0.9], d: 0.9, aisle: 0.9, endAisle: 0.9, max: 5 },
        lights: "track", signBg: "#2a1a10", signFg: "#e2c98a",
      },
      diner: {
        walls: [Object.assign({ edge: "x1", mods: ["board"], w: 1.6, d: 0.1, front: 0.3, max: 2 })].concat([behind(["board"], { w: 1.6, d: 0.1, front: 0.3 })]),
        centre: { mod: "cafe", len: [0.9], d: 0.9, aisle: 0.9, endAisle: 0.9, max: 6 },
        lights: "panel", signBg: "#a82a2a", signFg: "#f6f4ee",
      },
      chemist: {
        walls: sides([m("shelf", { style: "boxes", pal: P.pharmacy, back: 0xf4f2ee, accent: 0x2f8a5a }), m("shelf", { style: "bottles", pal: P.pharmacy, back: 0xf4f2ee, accent: 0x2f8a5a })], { w: 1.2, d: 0.42 })
          .concat([behind([m("shelf", { style: "boxes", pal: P.pharmacy, back: 0xf4f2ee })])]),
        centre: { mod: "gondola", style: "boxes", pal: P.pharmacy, len: [2.4, 1.8], max: 2, cap: 0x2f8a5a, back: 0xf4f2ee },
        lights: "panel", signBg: "#2f8a5a", signFg: "#f6f4ee", window: { style: "bottles", pal: P.pharmacy },
      },
      barber: { lights: "panel", extra: barberStations, signBg: "#15171b", signFg: "#f2efe6" },
      surfshop: {
        walls: [{ edge: "x0", mods: ["boards"], w: 1.4, d: 0.3, front: 0.8 }, { edge: "x1", mods: [m("cubbies", { pal: P.surf }), "boards"], w: 1.2, d: 0.42 }],
        centre: { mod: "rail", len: [1.6, 1.2], d: 0.6, aisle: 0.9, max: 3, pal: P.surf },
        lights: "track", window: { style: "stacks", pal: P.surf },
      },
      diveshop: {
        walls: sides([m("slat", { style: "wetsuits", pal: [0x15171b, 0x1d2a44, 0x2a2c30] }), m("shelf", { style: "boxes", pal: P.marine })], { w: 1.2, d: 0.45 }),
        centre: { mod: "gondola", style: "tools", pal: P.marine, len: [2.4, 1.8], max: 2 },
        lights: "tube", window: { style: "boxes", pal: P.marine },
      },
      books: {
        walls: sides([m("shelf", { style: "books", pal: P.books, back: 0x5a3a22, frame: 0x3a2414, accent: 0x2a1a10, h: 2.3, levels: [0.12, 0.5, 0.88, 1.26, 1.64, 2.0] })], { w: 1.0, d: 0.36 })
          .concat([behind([m("shelf", { style: "books", pal: P.books, back: 0x5a3a22, frame: 0x3a2414 })])]),
        centre: { mod: "table", style: "books", pal: P.books, len: [1.6, 1.2], d: 0.9, max: 3, top: 0x5a3a22 },
        lights: "track", window: { style: "books", pal: P.books },
      },
      florist: {
        walls: sides(["flowers"], { w: 1.2, d: 0.6 }),
        centre: { mod: "table", style: "pots", pal: P.plants, len: [1.4, 1.0], d: 0.8, max: 2, top: 0x5a4632 },
        lights: "track", window: { mods: ["flowers"], w: 1.2, d: 0.6 },
      },
      butcher: {
        walls: sides([m("shelf", { style: "jars", pal: P.meat, back: 0xf4f2ee })], { w: 1.2, d: 0.42 })
          .concat([behind(["board"], { w: 1.6, d: 0.1, front: 0.3 })]),
        centre: { mod: "chiller", len: [2.4, 1.6], d: 0.85, max: 1, pal: P.meat },
        lights: "tube", signBg: "#7a1f1f", signFg: "#f6f4ee",
      },
      icecream: {
        walls: [behind(["board"], { w: 1.6, d: 0.1, front: 0.3 })],
        centre: [{ mod: "chiller", len: [2.4, 1.6], d: 0.85, max: 1, pal: P.ice }, { mod: "cafe", len: [0.9], d: 0.9, aisle: 0.9, endAisle: 0.9, max: 3 }],
        lights: "panel", signBg: "#f28ab0", signFg: "#15171b",
      },
      laundry: {
        walls: sides(["washers"], { w: 1.4, d: 0.65, front: 1.0 }),
        centre: { mod: "table", style: "stacks", pal: P.cloth, len: [1.8, 1.2], d: 0.8, max: 1, top: 0xe8e4da },
        lights: "tube",
      },
      clothing: {
        lights: "track", signBg: "#15171b", signFg: "#f2efe6",
        window: { style: "stacks", pal: P.cloth },
      },
      suits: {
        lights: "track", signBg: "#1a120c", signFg: "#e2c98a", signBack: 0x2a1a10,
        floor: null,
      },
    };
    return RECIPES;
  }

  /* ---- THE OPTICIAN'S TEST CORNER: the chair, the refractor on its arm,
     the slit lamp on its table, the chart on the wall across from it ----- */
  function eyeTest(D) {
    const R = D.R, K = D.K, y = D.y;
    const zc = R.z0 + (R.z1 - R.z0) * 0.62;
    const r = { x0: R.x1 - 1.9, x1: R.x1, z0: zc - 1.0, z1: zc + 1.0 };
    if (!D.place(r)) return;
    const cx = R.x1 - 0.95;
    // the chair: base, seat, back to the wall, arms, the footrest
    K.lbox(cx, y + 0.12, zc, 0.5, 0.24, 0.5, 0x2a2c30, { solid: true });
    K.lbox(cx, y + 0.5, zc, 0.6, 0.14, 0.58, 0x1d2a44);
    K.lbox(cx + 0.3, y + 0.95, zc, 0.12, 0.9, 0.58, 0x1d2a44);
    for (const s of [-1, 1]) K.lbox(cx, y + 0.68, zc + s * 0.33, 0.5, 0.08, 0.08, 0x15171b);
    K.lbox(cx - 0.4, y + 0.22, zc, 0.3, 0.06, 0.4, 0x2a2c30);
    // the refractor on its arm, swung in front of the face
    K.lbox(cx + 0.55, y + 1.0, zc + 0.55, 0.08, 2.0, 0.08, 0xd8dcdf);
    K.lbox(cx + 0.15, y + 1.75, zc + 0.55, 0.8, 0.05, 0.05, 0xd8dcdf);
    K.lbox(cx - 0.2, y + 1.58, zc + 0.3, 0.34, 0.18, 0.12, 0x2a2c30);
    // the slit lamp on its table
    K.lbox(cx, y + 0.4, zc - 0.75, 0.6, 0.8, 0.45, 0xe8e4da, { solid: true });
    K.lbox(cx, y + 0.95, zc - 0.75, 0.2, 0.3, 0.24, 0x2a2c30);
    // the chart, across the room on the other wall
    const tex = CBZ.islandFit.chartTex();
    if (tex) {
      const Fr = D.wall("x0"), p = Fr.P(zc, 0.012);
      D.box(Fr, zc, 0.008, 1.0, 0.5, 0.016, 0.72, 0x1d1f23);
      CBZ.islandFit.panel(D.b, null, p.x, y + 1.36, p.z, 0.44, 0.66, Fr.yaw, tex, true);
    }
  }
  /* ---- THE BARBER'S STATIONS: mirror, shelf and chair down the +x wall,
     the waiting bench across from them --------------------------------- */
  function barberStations(D) {
    const R = D.R, K = D.K, y = D.y;
    let n = 0;
    for (let z = R.z0 + 2.2; z + 0.8 < R.z1 - 2.0 && n < 4; z += 1.5) {
      const r = { x0: R.x1 - 1.9, x1: R.x1, z0: z - 0.7, z1: z + 0.7 };
      if (!D.place(r)) continue;
      n++;
      K.lbox(R.x1 - 0.03, y + 1.45, z, 0.04, 1.1, 1.0, 0x1d1f23);
      K.lbox(R.x1 - 0.055, y + 1.45, z, 0.008, 1.02, 0.92, 0xbccbd2);
      K.lbox(R.x1 - 0.18, y + 0.85, z, 0.3, 0.04, 1.2, 0xe8e4da);
      K.lbox(R.x1 - 0.18, y + 0.45, z, 0.3, 0.8, 1.2, 0x2a2c30, { solid: true });
      for (let i = 0; i < 4; i++) K.lbox(R.x1 - 0.18, y + 0.95, z - 0.4 + i * 0.25, 0.06, 0.16, 0.06, [0x2f6fb0, 0xc23b2c, 0xf2efe6, 0x15171b][i]);
      const cx = R.x1 - 1.05;
      K.lbox(cx, y + 0.08, z, 0.5, 0.16, 0.5, 0x8a9096);
      K.lbox(cx, y + 0.32, z, 0.12, 0.32, 0.12, 0xc8ccd2, { solid: true });
      K.lbox(cx, y + 0.55, z, 0.56, 0.14, 0.54, 0x8a1f1f);
      K.lbox(cx - 0.24, y + 0.95, z, 0.1, 0.75, 0.52, 0x8a1f1f);
      for (const s of [-1, 1]) K.lbox(cx + 0.02, y + 0.72, z + s * 0.31, 0.46, 0.06, 0.07, 0xc8ccd2);
      K.lbox(cx + 0.42, y + 0.3, z, 0.24, 0.04, 0.34, 0xc8ccd2);
    }
    const r2 = { x0: R.x0, x1: R.x0 + 0.8, z0: R.z0 + 2.0, z1: R.z0 + 4.2 };
    if (D.place(r2)) D.furnish("bench", R.x0 + 0.35, R.z0 + 3.1, Math.PI / 2, { len: 1.8, tone: "cool" });
  }

  /* ---- THE ROOM ------------------------------------------------------------
     The shop floor: the stair behind its stairwell wall, and (a deep enough
     shop) the back room behind its partition (city/shopfloor.js plan). The
     door band and the front walk stay walkable through clearLocal. */
  function roomOf(b) {
    const F = IV.floor(b, 0);
    const SF = CBZ.shopFloor;
    const P0 = SF && SF.plan ? SF.plan(b, { backRoom: true }) : null;
    if (P0) return { F: F, P0: P0, x0: P0.x0, x1: P0.x1, z0: P0.z0, z1: P0.wallFace };
    const sw = IV.stairwell ? IV.stairwell(b) : null;
    let x0 = F.local.x0;
    for (const r of F.keepOut) if (r.why === "stairs") x0 = Math.max(x0, sw ? sw.face + 0.02 : r.x1 + 0.1);
    return { F: F, P0: null, x0: x0, x1: F.local.x1, z0: F.local.z0, z1: F.local.z1 };
  }
  // the back room behind its partition, its safe in it (a shop too shallow
  // for one keeps its safe behind the counter)
  function* backRoom(b, lot, R, door) {
    const SF = CBZ.shopFloor, FIT = CBZ.islandFit;
    if (R.P0 && R.P0.back && SF && SF.shell) {
      const so = { goods: "boxes", door: door || null, safeGrade: "floor", safeOf: 900 + 2600 * (FIT ? FIT.hash(b.name || String(b.ox)) : 0.5) };
      return SF.shellSteps ? yield* SF.shellSteps(R.P0, lot, so) : SF.shell(R.P0, lot, so);
    }
    if (IV.safe && !b._safeDone) {
      try { IV.safe(b, { k: 0, lx: R.x1 - 0.5, lz: R.z1 - 0.42, yaw: Math.PI, grade: "floor", name: "safe" }); } catch (e) {}
    }
    return null;
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
    // the counter, the clerk's side and the customer's stay clear of the dressing
    // (behind it the back wall is the trade's: its shelves either side of him)
    if (IV.claim) IV.claim(b, 0, { x0: cx - cw / 2 - 0.35, x1: cx + cw / 2 + 0.35, z0: cz - cd / 2 - 1.05, z1: cz + cd / 2 + 0.05 });
    return { local: { x: cx, z: cz, w: cw, d: cd }, top: top, post: post };
  }

  /* ---- DRESS THE REST (world/island_fitkit.js) ---------------------------- */
  // (the fit-outs are generators on the island build's slice clock,
  // world/disaster_arena.js CBZ.sliceLate: a stage of the shop a step)
  function late() { return !!(CBZ.sliceLate && CBZ.sliceLate()); }
  function* dressRoom(b, R, use, keep, over) {
    const FIT = CBZ.islandFit, Rc = recipes();
    if (!FIT || !FIT.dress || !Rc) return null;
    const rc = Rc[use] || {};
    const spec = Object.assign({ kind: use }, rc, over || {}, {
      room: { x0: R.x0, x1: R.x1, z0: R.z0, z1: R.z1 }, keep: keep || [],
      sign: b.name || null, signAt: { ly: FIT.ceil(b, 0) - 0.36, w: Math.min(2.4, (R.x1 - R.x0) * 0.4) },
      backDoor: !(R.P0 && R.P0.back),
    });
    try { return FIT.dressSteps ? yield* FIT.dressSteps(b, spec) : FIT.dress(b, spec); } catch (e) { console.error("[island shop dress " + use + "]", e); return null; }
  }

  /* ---- A SHELVED SHOP (storegoods) ---------------------------------------
     The store's frame is the shop floor itself (a child of the building's
     group at the room's middle): its wall bays stand on both side walls
     (the stairwell wall is one) and its lanes run down the room's middle,
     not the building's. */
  function* goodsShop(b, lot, job, T) {
    const R = roomOf(b);
    IV.clear(b, 0);
    const shell = yield* backRoom(b, lot, R);
    if (late()) yield 0;
    const L = lot.building, WT = IB().WT;
    const K = counterAndClerk(b, lot, R, { job: JOB[b.use] || "shop assistant" });
    if (late()) yield 0;
    let m = null, sub = null;
    const cxL = (R.x0 + R.x1) / 2, czL = (R.z0 + R.z1) / 2;
    if (CBZ.storeGoodsMount && T) {
      sub = new THREE.Group();
      sub.name = "island-shop-floor";
      sub.position.set(cxL, 0, czL);
      b.group.add(sub);
      const shim = {
        kind: T.kind, cx: b.x, cz: b.z, w: b.w, d: b.d, island: true,
        building: {
          shop: { kind: T.kind }, group: sub, ox: b.ox, oz: b.oz,
          // the shop floor's frame, the door on -z: the INWARD normal is +z
          localDoor: { x: 0, z: -(R.z1 - R.z0) / 2 - WT, nx: 0, nz: 1 },
          w: (R.x1 - R.x0) + 2 * WT, d: (R.z1 - R.z0) + 2 * WT, wt: WT, floorTops: [R.F.yLocal],
          clearFloorPoint: function (lx, lz, pad) { return clearLocal(R, lx + cxL, lz + czL, pad); },
          counterLocal: { x: K.local.x - cxL, z: K.local.z - czL, w: K.local.w, d: K.local.d },
          planHints: { wallStart: 2.2, backKeep: 2.0, tables: T.tables || 0, lanes: T.tables ? 0 : undefined },
          stock: T.stock || null,
        },
      };
      Object.defineProperty(shim.building, "vendor", { get: function () { return L.vendor; } });
      m = CBZ.storeGoodsMount(shim);
      if (late()) yield 0;
    }
    // what the store stood, in the building's frame, for the dresser
    const keep = [];
    if (m && m.plan && m.plan.rects) for (const r of m.plan.rects) keep.push({ x0: r.x0 + cxL - 0.05, x1: r.x1 + cxL + 0.05, z0: r.z0 + czL - 0.05, z1: r.z1 + czL + 0.05, pad: r.wall ? 0 : 0.6 });
    yield* dressRoom(b, R, b.use, keep);
    return function () {
      if (m) m.dispose();
      if (sub && sub.parent) sub.parent.remove(sub);
      if (shell) shell.dispose();
    };
  }

  /* ---- AN OUTFITTER / A TAILOR (clothingstore) ----------------------------- */
  function* clothesShop(b, lot, job, tailor) {
    if (!CBZ.clothingStoreMount) return null;
    const R = roomOf(b);
    IV.clear(b, 0);
    // (the staff door behind the cash wrap: the fitting room has the + corner)
    const shell = yield* backRoom(b, lot, R, "x0");
    if (late()) yield 0;
    const F = R.F, WT = IB().WT;
    // the cash wrap on the stair side, the fitting room on the other (local +x)
    const cw = Math.max(1.8, Math.min(2.4, (R.x1 - R.x0) * 0.32));
    const K = counterAndClerk(b, lot, R, { draw: false, x: R.x0 + 0.45 + cw / 2, w: cw, back: 1.45, job: JOB[b.use] || "shop assistant" });
    const o = F.toWorld(0, 0), u = F.toWorld(0, 1);
    const inx = u.x - o.x, inz = u.z - o.z, tx = -inz, tz = inx;
    const cxL = (R.x0 + R.x1) / 2, czL = (R.z0 + R.z1) / 2;
    const c = F.toWorld(cxL, czL);
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
    const mnt = CBZ.clothingStoreMount(shim, { cs: cs, tailor: tailor, root: job && job.arena && job.arena.root });
    if (late()) yield 0;
    // what the store stands (it dresses when you come near: its plan, kept
    // here in the building's frame): the side runs, the spine, the forms
    // by the door, the folded table, the cash wrap, the fitting room
    const keep = [
      { x0: R.x0, x1: R.x0 + 0.8, z0: R.z0 + 2.4, z1: R.z1 - 1.4 },
      { x0: R.x1 - 0.8, x1: R.x1, z0: R.z0 + 2.4, z1: R.z1 - 1.4 },
      { x0: cxL + 0.9, x1: R.x1, z0: R.z0 + 2.3, z1: R.z0 + 4.0 },
      { x0: cxL - 2.8, x1: cxL - 1.0, z0: R.z0 + 2.7, z1: R.z0 + 4.0 },
      { x0: R.x0, x1: R.x0 + 0.8 + cw, z0: R.z1 - 3.0, z1: R.z1 },
      { x0: R.x1 - 1.6, x1: R.x1, z0: R.z1 - 2.9, z1: R.z1 },
    ];
    if (!tailor && (R.x1 - R.x0) / 2 + WT >= 3.4) keep.push({ x0: cxL - 0.65, x1: cxL + 0.65, z0: R.z0 + 2.9, z1: R.z1 - 3.4 });
    const FIT = CBZ.islandFit, P = FIT && FIT.PAL;
    if (P) {
      const over = tailor ? {
        walls: [{ edge: "z1", mods: ["bolts"], w: 1.2, d: 0.5, front: 0.9 }],
        centre: { mod: "table", style: "bolts", pal: P.fabric, len: [1.8, 1.4], d: 0.9, max: 1, top: 0x5a3a22 },
        extra: fittingPodium,
      } : {
        walls: [{ edge: "z1", mods: ["cubbies"], w: 1.2, d: 0.45, front: 0.9, pal: P.cloth }],
        centre: { mod: "rail", len: [1.6, 1.2], d: 0.6, aisle: 0.95, max: 4, pal: P.cloth },
      };
      yield* dressRoom(b, R, tailor ? "suits" : "clothing", keep, over);
    }
    return function () { if (mnt) mnt.dispose(); if (shell) shell.dispose(); };
  }
  // the tailor's fitting podium in front of its three-way mirror
  function fittingPodium(D) {
    const R = D.R, K = D.K, y = D.y;
    const cx = (R.x0 + R.x1) / 2 + 0.4, zc = R.z0 + (R.z1 - R.z0) * 0.58;
    const r = { x0: cx - 1.1, x1: cx + 1.1, z0: zc - 1.0, z1: zc + 1.2 };
    if (!D.place(r)) return;
    K.lbox(cx, y + 0.08, zc, 0.95, 0.16, 0.95, 0x3a2414);
    K.lbox(cx, y + 0.165, zc, 0.9, 0.01, 0.9, 0x6b2a2a);
    // the mirror's three leaves: one behind the podium, one each side
    K.lbox(cx, y + 1.1, zc + 0.85, 1.0, 1.9, 0.05, 0x2a1a10, { solid: true });
    K.lbox(cx, y + 1.1, zc + 0.82, 0.9, 1.8, 0.008, 0xbccbd2);
    for (const s of [-1, 1]) {
      K.lbox(cx + s * 0.75, y + 1.1, zc + 0.45, 0.05, 1.9, 0.8, 0x2a1a10, { solid: true });
      K.lbox(cx + s * 0.72, y + 1.1, zc + 0.45, 0.008, 1.8, 0.7, 0xbccbd2);
    }
  }

  IV.on("clothing", function (b, lot, job) { return clothesShop(b, lot, job, false); });
  IV.on("suits", function (b, lot, job) { return clothesShop(b, lot, job, true); });
  for (const use in TRADE) IV.on(use, function (b, lot, job) { return goodsShop(b, lot, job, TRADE[use]); });
  for (const use of COUNTER_ONLY) IV.on(use, function* (b, lot, job) {
    const R = roomOf(b);
    IV.clear(b, 0);
    const shell = yield* backRoom(b, lot, R);
    if (late()) yield 0;
    counterAndClerk(b, lot, R, { job: JOB[use] || "shop assistant" });
    if (late()) yield 0;
    yield* dressRoom(b, R, use, []);
    return function () { if (shell) shell.dispose(); };
  });
})();
