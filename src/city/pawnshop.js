/* ============================================================
   city/pawnshop.js — THE PAWN SHOP: other people's things, for sale, and
   a man who buys yours.

   Owner (2026-10-22): pawn shops are where you "buy things or sell things
   you've stolen". So the shop is its goods:

   • THE SHELVES. Open steel-and-oak bays on the back wall stocked with what
     people actually pawn: a flat TV on its stand, a guitar amp, a drill, a
     toolbox, laptops, phones, a camera, a console, a boombox, speakers; an
     electric and an acoustic guitar hung by their headstocks. Each is a real
     model and a real item (city/economy.js). [Take] it (CBZ.verbs.pickup),
     the broker rings up what you are holding at the counter ([Buy]), [Put
     back] returns it, and walking out with it is stealing it — he shouts,
     it is reported, it is hot, and he has a shotgun under the counter
     (city/shopfloor.js's till).
   • THE SHOWCASE on the counter's sell end: watches, a chain, a ring, a
     phone, laid on velvet. Same [Take].
   • THE GUN CASE past the counter's end: two handguns under glass, taken and
     paid for like the gun store's.
   • THE SELL END. [Sell <thing>] sets what you carry (watches, jewellery,
     phones, the shelf goods, a gun) on his counter with your hand; he names
     his number ("I'll give you $X"), less than half that for hot goods he
     knows about (stolen on this island, stolen lately, or you are wanted).
     [Take $X] or [No deal] (it comes back to your hand).
   • THE LOAN END. The teller cage: [Pawn] an item for a collateral loan
     (~50% of its value, a ticket with a 4-minute term), [Redeem] it back for
     the principal and a 20% fee; let it lapse and it is forfeit.

   ONE STORE PER SHOP: Gang City's (its lot's shell from city/buildings.js)
   and one per island pawn shop (CBZ.islandVenue "pawn": the ground floor
   cleared, a back room with the safe behind a partition, the shelving on the
   partition, the counter in front of it, a broker at his post).

   Built through the store fixture kit (city/gunstore.js); every $ comes from
   cityEcon. Public hooks: CBZ.cityPawnLive(lot), CBZ.cityPawnLoan(item),
   CBZ.cityPawnSell(name), CBZ.cityPawnRedeem(id), CBZ.cityPawnFenceQuote,
   CBZ.cityPawnState(), CBZ.pawnShops().
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.onUpdate) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  const VIS_R = 55;          // display group draws only when you're near the shop
  const DRESS_R = 110;       // past the draw gate, with room to build it unseen
  const REACH = 3.0;         // you deal at the counter's arm-length
  const SHELF_REACH = 6.0;   // the shelves behind the counter, across it
  const LOOK_DOT = 0.66;     // act on the desk you're LOOKING at
  const RESTOCK = 300;       // seconds a sold shelf spot stays bare
  // Collateral-loan terms (research-grounded pawnbroking, tuned for the game):
  const LOAN_FRAC = 0.50;    // advance = 50% of the item's clean value (in the 40–60% band)
  const LOAN_TERM = 240;     // seconds the ticket runs before forfeiture (a real countdown you feel)
  const LOAN_FEE = 0.20;     // redemption fee = 20% of the principal (the broker's monthly cut)
  const SELL_LO = 0.40, SELL_HI = 0.55;   // outright-sale haircut band (LESS than jeweller retail)
  const HOT_CUT = 0.45;      // what a broker pays for hot goods he knows about, of his clean number
  const RESALE = 0.85;       // his shelf price, of the item's value
  const HOT_KNOWN_S = 600;   // a theft this recent is talked about on every island

  const STORES = [];
  let cityStore = null;
  const CITY = { arena: null, noLotArena: null };

  function econ() { return CBZ.cityEcon || null; }
  function SF() { return CBZ.shopFloor || null; }
  function fmt$(n) { n = Math.round(n || 0); return "$" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function note(t, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(t, s); }
  function now() { return (CBZ.now || 0) / 1000; }   // CBZ.now is ms; tickets count in seconds
  function gunIdOf(name) { return (CBZ.cityGunIdOf && CBZ.cityGunIdOf(name)) || null; }

  /* ---- A STORE ----------------------------------------------------------
     d: { kind, lot, FY, C (counter: x, z, w, d, top, tx, tz), wall (the back
          wall's inner face at floor: x, z, yaw with +Z into the room),
          runMax (shelf run cap), bounds (the room, world AABB), root, clerk,
          where, inStore(x, z), nearDoor?, behind? } */
  function makeStore(d) {
    const S = {
      kind: d.kind, lot: d.lot, FY: d.FY, C: d.C, wall: d.wall, runMax: d.runMax, bounds: d.bounds, root: d.root,
      where: d.where, clerk: d.clerk, inStore: d.inStore, cols: [], group: null, goods: [], dressed: false, near: false, dead: false,
      sellDesk: null, loanDesk: null, offer: null, tillCand: null,
      cx: (d.bounds.minX + d.bounds.maxX) / 2, cz: (d.bounds.minZ + d.bounds.maxZ) / 2,
    };
    S.till = SF() ? SF().till({ clerk: d.clerk, inStore: d.inStore, nearDoor: d.nearDoor, behind: d.behind, where: d.where }) : null;
    const K = CBZ.storeFixtureKit;
    const C = S.C, L = Math.max(C.w, C.d), CD = Math.min(C.w, C.d);
    const yawC = K ? K.yawOf(C.tx, C.tz) : Math.atan2(-C.tz, C.tx);
    const onFloor = function (lx, lz) { const c = Math.cos(yawC), s = Math.sin(yawC); return { x: C.x + lx * c + lz * s, z: C.z - lx * s + lz * c }; };
    const sellX = -L * 0.26, loanX = L * 0.27;
    const sp = onFloor(sellX, 1.0), lp = onFloor(loanX, 1.0), tp = onFloor(0, CD / 2 + 0.5);
    S.sellDesk = { mode: "sell", store: S, x: sp.x, z: sp.z };
    S.loanDesk = { mode: "loan", store: S, x: lp.x, z: lp.z };
    S.tillCand = { till: true, store: S, x: tp.x, z: tp.z };
    S.onFloor = onFloor; S.yawC = yawC; S.L = L; S.CD = CD; S.sellX = sellX; S.loanX = loanX;
    STORES.push(S);
    return S;
  }
  function disposeStore(S) {
    if (!S || S.dead) return;
    S.dead = true;
    if (S.offer) cancelOffer(S, true);
    if (S.till) S.till.dropAll();
    const i = STORES.indexOf(S); if (i >= 0) STORES.splice(i, 1);
    if (S.group) { if (S.group.parent) S.group.parent.remove(S.group); if (SF()) SF().disposeTree(S.group); }
    if (SF()) SF().dropCols(S.cols);
    if (S.clerk && S.clerk.dispose) S.clerk.dispose();
    S.group = null; S.goods = [];
  }
  // a frame-aligned rect (frame origin, yaw, local half sizes) as a world AABB
  function solidLocal(S, k, lx, lz, hw, hd, y0, y1) {
    const a = k.world(lx - hw, lz - hd), b = k.world(lx + hw, lz + hd);
    const c = { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z), y0: y0, y1: y1 };
    CBZ.colliders.push(c); S.cols.push(c);
  }

  /* ---- THE ROOM ---------------------------------------------------------
     (de-slop pass 2026-09-27, kept) the counter dressed in scuffed oak
     laminate over a kick plinth, a brass trim line, a dark worktop; the
     SELL end's countertop showcase; the LOAN end's teller cage (steel posts
     from the worktop to 2.3 m, bars, a glazed back, a speak-through grille,
     a stainless deal tray, the till behind it); the back wall's shelving
     bays and their goods, the guitars at the two ends, an orange neon dollar
     sign on a black board above the run (a lit sign, no invented words). */
  function buildDisplays(S) {
    const K = CBZ.storeFixtureKit;
    if (!K) return;
    const group = new THREE.Group();
    group.name = "pawn-shop";
    S.group = group;
    (S.root || CBZ.scene).add(group);
    const FY = S.FY, C = S.C, L = S.L, CD = S.CD, sellX = S.sellX, loanX = S.loanX;
    const R = K.rng(Math.round(S.cx * 17) ^ Math.round(S.cz * 29));

    // ---- the counter ----
    const k = K.create().frame(C.x, 0, C.z, S.yawC);
    const top = K.dressCounter(k, L, CD, C.top, FY, { clad: 0x6b5238, trim: 0xb8953e, work: 0x24211e, kick: 0x141210 });
    if (S.kind === "island") solidLocal(S, k, 0, 0, L / 2 + 0.04, CD / 2 + 0.06, FY, C.top + 0.05);
    S.top = top;

    // ---- SELL end: the showcase of pawned jewellery, every piece for sale ----
    const cLen = Math.min(1.5, Math.max(0.9, L * 0.4)), cWid = Math.min(0.56, CD - 0.1);
    const deck = K.showcase(k, sellX, top, cLen, cWid, { felt: 0x121114, frame: 0xc4c8cc });
    const BLK = 0x1a1a1c;
    k.box(sellX - cLen * 0.28, deck + 0.008, -0.04, 0.3, 0.016, 0.2, BLK);                  // the watch tray
    k.box(sellX + cLen * 0.05, deck + 0.012, -0.04, 0.24, 0.024, 0.16, BLK);                // the ring tray
    const CASE_GOODS = [["Omega", sellX - cLen * 0.36, deck + 0.017, -0.04], ["Rolex", sellX - cLen * 0.2, deck + 0.017, -0.04],
      ["Diamond Ring", sellX + cLen * 0.05, deck + 0.025, -0.06], ["Gold Chain", sellX + cLen * 0.3, deck + 0.002, 0.0],
      ["Phone", sellX - cLen * 0.05, deck, 0.13]];
    for (const cg of CASE_GOODS) caseGood(S, group, k, cg[0], cg[1], cg[2], cg[3]);

    // ---- LOAN end: the teller cage ----
    const TW = Math.min(1.3, L * 0.42), TOP = FY + 2.3, STEEL = 0x3b4048;
    const lr = top + 0.16, zc = -0.04;
    for (const sx of [-1, 1]) k.box(loanX + sx * TW / 2, (top + TOP) / 2, zc, 0.05, TOP - top, 0.05, STEEL, "metal");
    k.box(loanX, lr, zc, TW, 0.04, 0.06, STEEL, "metal");                                   // lower rail over the deal slot
    k.box(loanX, TOP - 0.03, zc, TW + 0.05, 0.06, 0.06, STEEL, "metal");                    // top rail
    const bars = Math.max(5, Math.round(TW / 0.11));
    for (let i = 1; i < bars; i++) k.cyl(loanX - TW / 2 + (TW * i) / bars, (lr + TOP - 0.06) / 2, zc + 0.012, 0.009, 0.009, TOP - 0.06 - lr, STEEL, "metal", 0, 0, 0, 8);
    k.box(loanX, (lr + TOP - 0.06) / 2, zc - 0.022, TW - 0.05, TOP - 0.06 - lr - 0.02, 0.01, 0, "glass");
    k.cyl(loanX, FY + 1.52, zc + 0.024, 0.05, 0.05, 0.012, 0xa7abb0, "metal", Math.PI / 2, 0, 0, 20);   // speak-through grille
    k.cyl(loanX, FY + 1.52, zc + 0.026, 0.042, 0.042, 0.012, 0x2a2d31, "metal", Math.PI / 2, 0, 0, 20);
    k.box(loanX, top + 0.006, zc + 0.02, 0.34, 0.012, 0.42, 0xc0c5ca, "metal");             // stainless deal tray
    for (const sx of [-1, 1]) k.box(loanX + sx * 0.165, top + 0.028, zc + 0.02, 0.01, 0.034, 0.42, 0xc0c5ca, "metal");
    K.till(k, loanX, top, CD);
    k.build(group);

    // ---- the gun case, past the counter's sell end ----
    buildGunCase(S, group, K, R);

    // ---- the back wall: shelving bays, guitars, the neon sign ----
    const W0 = S.wall;
    const wallK = K.create().frame(W0.x, 0, W0.z, W0.yaw);                // +Z points back into the room
    const shelfW = S.runMax;
    const bays = Math.max(1, Math.min(4, Math.floor((shelfW - 1.1) / 1.2)));
    const runW = bays * 1.2;
    buildShelving(S, group, wallK, runW, bays, FY, R);
    hangGuitar(S, group, K, W0, -(runW / 2 + 0.34), FY, true);
    hangGuitar(S, group, K, W0, runW / 2 + 0.34, FY, false);
    buildNeon(wallK, 0, FY + 2.52);
    wallK.build(group);
    // the shelving is solid for walkers
    solidLocal(S, wallK, 0, 0.23, runW / 2, 0.23, FY - 0.1, FY + 2.1);
    if (S.kind === "city" && CBZ.interiorTrackFixture) CBZ.interiorTrackFixture("pawn-shop", S.lot.building, group);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }

  /* ---- THE GOODS ---------------------------------------------------------
     A good is its own small group (it leaves the shelf in your hand) built
     by its own kit in the shelf's frame; a slot record carries what it is,
     what it costs and where it stands. */
  function addGood(S, group, name, model, wp, y, reach, price) {
    const e = econ(), it = e && e.ITEMS[name];
    if (!it || !model) return null;
    group.add(model);
    const s = { good: true, store: S, name: name, model: model, x: wp.x, y: y, z: wp.z, reach: reach || SHELF_REACH, dot: 0.6,
                price: price || Math.max(1, Math.round((it.value || 0) * RESALE)), sold: false, held: false, restockT: 0,
                gun: !!it.gun };
    S.goods.push(s);
    return s;
  }
  function kitGood(S, group, frameK, name, fn, x, y, R) {
    const K = CBZ.storeFixtureKit;
    const gk = K.create().frame(frameK.ox, 0, frameK.oz, frameK.yaw);
    fn(gk, x, y, R);
    const grp = new THREE.Group();
    grp.name = "pawn-good";
    gk.build(grp);
    return addGood(S, group, name, grp, frameK.world(x, 0.22), y + 0.15);
  }
  // a piece in the counter showcase (real item models, CBZ.itemAsset)
  function caseGood(S, group, k, name, lx, y, lz) {
    if (!CBZ.itemAsset) return;
    const m = CBZ.itemAsset(name);
    if (!m) return;
    const wp = k.world(lx, lz);
    m.position.set(wp.x, y, wp.z);
    m.rotation.y = k.yaw + (lx * 7 % 1) * 0.6;
    addGood(S, group, name, m, wp, y + 0.03, REACH + 0.4);
  }
  // the locked gun case: a cabinet with a glass top box, two handguns on felt
  function buildGunCase(S, group, K, R) {
    const C = S.C, L = S.L;
    const tx = C.tx, tz = C.tz, cx = -C.tz, cz = C.tx;                 // tangent, toward the customer
    const B = S.bounds;
    // past whichever end of the counter has the room (the + end on an island:
    // the - end is the way round to the back room)
    const rp = latRoomOf(B, C.x, C.z, tx, tz, 1), rm = latRoomOf(B, C.x, C.z, tx, tz, -1);
    const sgn = rp >= rm - 0.05 ? 1 : -1, room = Math.max(rp, rm);
    const lat = L / 2 + 0.7;
    if (room < lat + 0.55) return;
    const x = C.x + tx * sgn * lat + cx * 0.1, z = C.z + tz * sgn * lat + cz * 0.1;
    const k = K.create().frame(x, 0, z, S.yawC);
    const FY = S.FY, LEN = 0.9, WID = 0.56, TOPY = FY + 0.86;
    k.box(0, FY + 0.05, 0, LEN - 0.06, 0.1, WID - 0.06, 0x111214);
    k.box(0, FY + 0.1 + (TOPY - FY - 0.1) / 2, 0, LEN, TOPY - FY - 0.1, WID, 0x4a3a2a);
    k.box(0, TOPY - 0.08, WID / 2 + 0.003, LEN + 0.002, 0.012, 0.004, 0xb8953e, "metal");
    const deck = K.showcase(k, 0, TOPY - 0.02, LEN, WID, { felt: 0x1f2a33, h: 0.24 });
    k.build(group);
    solidLocal(S, k, 0, 0, LEN / 2, WID / 2, FY, TOPY + 0.26);
    const guns = ["Pistol", "Revolver"];
    guns.forEach(function (name, i) {
      if (!CBZ.buildActorWeapon) return;
      const e = econ(), it = e && e.ITEMS[name];
      if (!it) return;
      const raw = CBZ.buildActorWeapon(it.gun || name);
      if (!raw) return;
      raw.rotation.set(0, 0, 0); raw.position.set(0, 0, 0);
      raw.scale.setScalar((CBZ.weaponWorldScale && CBZ.weaponWorldScale(raw.userData.weaponId || name)) || 0.95);
      const holder = K.seat(raw, function (turn, m) { m.rotation.set(0, 0, Math.PI / 2); turn.rotation.y = -Math.PI / 2 + 0.3; });
      const lx = (i - 0.5) * 0.36;
      const wp = k.world(lx, -0.02);
      holder.position.set(wp.x, deck + 0.001, wp.z);
      holder.rotation.y = k.yaw;
      addGood(S, group, name, holder, wp, deck + 0.05, REACH, Math.round((e.buyPrice ? e.buyPrice(name) : it.value) * 0.8));
    });
  }
  function latRoomOf(B, x, z, tx, tz, sgn) {
    let best = 1e9;
    const dx = tx * sgn, dz = tz * sgn;
    if (dx > 1e-6) best = Math.min(best, (B.maxX - x) / dx);
    if (dx < -1e-6) best = Math.min(best, (B.minX - x) / dx);
    if (dz > 1e-6) best = Math.min(best, (B.maxZ - z) / dz);
    if (dz < -1e-6) best = Math.min(best, (B.minZ - z) / dz);
    return best;
  }

  // Open shelving: steel angle uprights, five oak boards with a white price
  // channel, an X brace at the back; each board stocked from a real pawn
  // inventory. Frame: +X along the wall, +Z out of the wall, y absolute.
  const DEPTH = 0.44;
  const BOARDS = [0.12, 0.58, 1.04, 1.5, 1.94];
  function buildShelving(S, group, k, runW, bays, FY, R) {
    const STEEL = 0x5a6068, OAK = 0x8a6a44;
    for (let i = 0; i <= bays; i++) {
      const x = -runW / 2 + i * 1.2;
      for (const z of [0.02, DEPTH - 0.02]) k.box(x, FY + 1.05, z, 0.035, 2.1, 0.035, STEEL, "metal");
    }
    for (let i = 0; i < bays; i++) {
      const x0 = -runW / 2 + i * 1.2 + 0.6;
      k.box(x0, FY + 1.05, 0.012, 1.55, 0.012, 0.01, STEEL, "metal", 0, 0, Math.atan2(2.0, 1.2));   // X brace
      k.box(x0, FY + 1.05, 0.012, 1.55, 0.012, 0.01, STEEL, "metal", 0, 0, -Math.atan2(2.0, 1.2));
    }
    for (const y of BOARDS) {
      k.box(0, FY + y, DEPTH / 2, runW, 0.022, DEPTH, OAK);
      k.box(0, FY + y - 0.006, DEPTH + 0.004, runW, 0.034, 0.008, 0xefefe9);
    }
    // what's on the boards, bay by bay (tall things, the TV, only on the top
    // board and never under the neon sign in the middle of the run)
    const PLAN = [
      ["toolbox", "amp", "drill", "laptops", "tv"],
      ["amp", "boombox", "phones", "camera", "boxes"],
      ["toolbox", "speakers", "laptops", "boxes", "tv"],
      ["boxes", "drill", "phones", "console", "tv"],
    ];
    for (let i = 0; i < bays; i++) {
      const x0 = -runW / 2 + i * 1.2 + 0.6;
      const row = PLAN[i % PLAN.length];
      for (let j = 0; j < BOARDS.length; j++) {
        let what = row[j];
        if (what === "tv" && Math.abs(x0) < 0.55) what = "boxes";
        stockBoard(S, group, k, what, x0 + (R() - 0.5) * 0.1, FY + BOARDS[j] + 0.011, R);
      }
    }
  }
  // one board's goods: the pickable ones each in their own group, the boxed
  // stock merged into the shelving
  function stockBoard(S, group, k, what, x, y, R) {
    switch (what) {
      case "tv": kitGood(S, group, k, "Flat TV", tv, x, y, R); break;
      case "amp": kitGood(S, group, k, "Guitar Amp", amp, x, y, R); break;
      case "drill": kitGood(S, group, k, "Power Drill", drill, x - 0.12, y, R); boxedSaw(k, x + 0.22, y); break;
      case "toolbox": kitGood(S, group, k, "Toolbox", toolbox, x, y, R); break;
      case "boombox": kitGood(S, group, k, "Boombox", boombox, x, y, R); break;
      case "speakers": kitGood(S, group, k, "Speakers", speakers, x, y, R); break;
      case "camera": kitGood(S, group, k, "Camera", camera, x - 0.2, y, R); kitGood(S, group, k, "Game Console", consoleFn, x + 0.16, y, R); break;
      case "console": kitGood(S, group, k, "Game Console", consoleFn, x, y, R); break;
      case "laptops": laptops(S, group, k, x, y); break;
      case "phones": phones(S, group, k, x, y); break;
      default: boxes(k, x, y);
    }
  }

  // ---- the pawned goods (each at real size, sitting on the board top y) ----
  function tv(k, x, y) {
    k.box(x, y + 0.006, 0.2, 0.24, 0.012, 0.14, 0x1a1a1c, "gloss");
    k.box(x, y + 0.045, 0.19, 0.05, 0.07, 0.025, 0x1a1a1c, "gloss");
    k.box(x, y + 0.28, 0.2, 0.74, 0.43, 0.035, 0x151517, "gloss");
    k.box(x, y + 0.285, 0.2181, 0.71, 0.4, 0.002, 0x0d1116, "gloss");
  }
  function amp(k, x, y) {
    k.box(x, y + 0.18, 0.22, 0.44, 0.36, 0.24, 0x1b1b1b);
    k.box(x, y + 0.14, 0.3405, 0.4, 0.24, 0.004, 0x3a3936);
    k.box(x, y + 0.315, 0.3405, 0.4, 0.06, 0.004, 0xb8bcc0, "metal");
    for (let i = 0; i < 5; i++) k.cyl(x - 0.14 + i * 0.07, y + 0.315, 0.35, 0.009, 0.009, 0.014, 0x111111, "solid", Math.PI / 2, 0, 0, 10);
    k.box(x, y + 0.37, 0.22, 0.16, 0.016, 0.03, 0x111111);
    for (const sx of [-1, 1]) for (const sy of [0, 1]) k.box(x + sx * 0.215, y + 0.015 + sy * 0.33, 0.335, 0.02, 0.03, 0.02, 0xa7abb0, "metal");
  }
  function drill(k, x, y) {
    const col = 0xd07a2a;
    k.box(x, y + 0.035, 0.2, 0.07, 0.07, 0.1, 0x1b1b1d);                                 // battery
    k.box(x, y + 0.12, 0.2, 0.04, 0.11, 0.05, col, "solid", 0, 0, -0.18);                // handle
    k.cyl(x + 0.03, y + 0.2, 0.2, 0.034, 0.034, 0.16, col, "solid", 0, 0, Math.PI / 2);  // motor housing
    k.cyl(x + 0.14, y + 0.2, 0.2, 0.018, 0.022, 0.05, 0x2a2a2a, "metal", 0, 0, Math.PI / 2);
    k.cyl(x + 0.18, y + 0.2, 0.2, 0.004, 0.004, 0.06, 0xb8bcc0, "metal", 0, 0, Math.PI / 2);
  }
  function boxedSaw(k, x, y) {
    k.box(x, y + 0.13, 0.22, 0.3, 0.26, 0.28, 0x2a5aa8);
    k.box(x, y + 0.13, 0.3605, 0.2, 0.12, 0.002, 0xf2f0ea);
  }
  function toolbox(k, x, y) {
    k.box(x, y + 0.1, 0.2, 0.46, 0.2, 0.22, 0xb3322b, "metal");
    k.box(x, y + 0.22, 0.2, 0.47, 0.04, 0.23, 0x8a2621, "metal");
    k.box(x, y + 0.27, 0.2, 0.2, 0.014, 0.02, 0x1b1b1d, "metal");
    for (const sx of [-1, 1]) k.box(x + sx * 0.1, y + 0.255, 0.2, 0.012, 0.03, 0.012, 0x1b1b1d, "metal");
    for (const sx of [-1, 1]) k.box(x + sx * 0.16, y + 0.2, 0.312, 0.03, 0.04, 0.008, 0xc0c5ca, "metal");
  }
  function boombox(k, x, y) {
    k.box(x, y + 0.13, 0.2, 0.52, 0.24, 0.13, 0x8e949b, "metal");
    for (const sx of [-1, 1]) {
      k.cyl(x + sx * 0.17, y + 0.12, 0.266, 0.075, 0.075, 0.004, 0x1c1d20, "solid", Math.PI / 2, 0, 0, 20);
      k.torus(x + sx * 0.17, y + 0.12, 0.268, 0.075, 0.004, 0xc0c5ca, "metal", 0, 0, 0, null, 24);
    }
    k.box(x, y + 0.14, 0.2665, 0.13, 0.07, 0.002, 0x2a2d31);
    for (const sx of [-1, 1]) k.box(x + sx * 0.15, y + 0.275, 0.2, 0.02, 0.05, 0.03, 0x2a2d31, "metal");
    k.box(x, y + 0.305, 0.2, 0.34, 0.022, 0.034, 0x2a2d31, "metal");
  }
  function speakers(k, x, y) {
    for (const sx of [-1, 1]) {
      const cx = x + sx * 0.14;
      k.box(cx, y + 0.15, 0.2, 0.2, 0.3, 0.22, 0x5a3d26);
      k.cyl(cx, y + 0.11, 0.311, 0.065, 0.065, 0.004, 0x1c1d20, "solid", Math.PI / 2, 0, 0, 20);
      k.cyl(cx, y + 0.24, 0.311, 0.022, 0.022, 0.004, 0x2a2d31, "metal", Math.PI / 2, 0, 0, 14);
    }
  }
  function camera(k, x, y) {
    k.box(x, y + 0.045, 0.2, 0.14, 0.09, 0.07, 0x1b1b1d);
    k.cyl(x, y + 0.045, 0.26, 0.034, 0.036, 0.07, 0x222326, "metal", Math.PI / 2, 0, 0, 18);
    k.box(x - 0.04, y + 0.1, 0.2, 0.04, 0.02, 0.04, 0x2a2b2e);
  }
  function consoleFn(k, x, y) {
    k.box(x, y + 0.035, 0.2, 0.3, 0.07, 0.24, 0x16171a, "gloss");
    k.box(x, y + 0.036, 0.3215, 0.26, 0.004, 0.002, 0x3c7cd0, "solid");
    k.box(x + 0.22, y + 0.018, 0.25, 0.12, 0.035, 0.07, 0x1b1b1d);
  }
  function laptops(S, group, k, x, y) {
    if (!CBZ.itemAsset) return boxes(k, x, y);
    [[-0.2, Math.PI], [0.2, Math.PI + 0.2]].forEach(function (a) {
      const m = CBZ.itemAsset("Laptop");
      if (!m) return;
      const wp = k.world(x + a[0], 0.22);
      m.position.set(wp.x, y, wp.z);
      m.rotation.y = k.yaw + a[1];
      addGood(S, group, "Laptop", m, wp, y + 0.06);
    });
  }
  function phones(S, group, k, x, y) {
    // three phones propped on a little acrylic stand
    k.box(x, y + 0.004, 0.24, 0.5, 0.008, 0.12, 0xdfe8ec, "glass");
    if (!CBZ.itemAsset) return;
    for (let i = 0; i < 3; i++) {
      k.box(x - 0.16 + i * 0.16, y + 0.02, 0.3, 0.07, 0.03, 0.01, 0xdfe8ec, "glass");
      const m = CBZ.itemAsset("Phone");
      if (!m) continue;
      const wp = k.world(x - 0.16 + i * 0.16, 0.26);
      m.position.set(wp.x, y + 0.06, wp.z);
      m.rotation.set(-1.15, k.yaw, 0, "YXZ");
      addGood(S, group, "Phone", m, wp, y + 0.08);
    }
  }
  function boxes(k, x, y) {
    const cols = [0x2a5aa8, 0xc23a36, 0x3a7a4a, 0x1b1b1d, 0xe0b020];
    let cx = x - 0.5;
    for (let i = 0; i < 4 && cx < x + 0.4; i++) {
      const w = 0.18 + ((i * 37) % 7) * 0.02, h = 0.14 + ((i * 13) % 5) * 0.03;
      k.box(cx + w / 2, y + h / 2, 0.2, w, h, 0.28, 0xb08a55);
      k.box(cx + w / 2, y + h * 0.55, 0.3405, w * 0.8, h * 0.5, 0.002, cols[i % cols.length]);
      cx += w + 0.04;
    }
  }

  // A guitar hung flat on the wall by its headstock from a wall yoke (bouts,
  // a waist, a neck with a fretboard, an angled headstock with six tuners,
  // six strings; a sound hole and bridge, or pickups, knobs and a guard).
  // The yoke stays on the wall; the guitar is a good.
  function hangGuitar(S, group, K, W0, x, FY, acoustic) {
    const yoke = K.create().frame(W0.x, 0, W0.z, W0.yaw);
    const k = K.create().frame(W0.x, 0, W0.z, W0.yaw);
    const hookY = FY + 1.95;
    const col = acoustic ? 0xc8955a : 0xa02a2a, dark = 0x2b1d14;
    const th = acoustic ? 0.1 : 0.045;
    const bz = 0.02 + th / 2, face = bz + th / 2, Z = face - 0.012;
    yoke.box(x, hookY, 0.01, 0.06, 0.08, 0.02, 0x2a2d31, "metal");
    yoke.cyl(x, hookY - 0.012, (Z + 0.012) / 2, 0.007, 0.007, Z + 0.012, 0x2a2d31, "metal", Math.PI / 2);
    for (const sx of [-1, 1]) yoke.cyl(x + sx * 0.034, hookY + 0.008, Z + 0.004, 0.006, 0.006, 0.04, 0x1b1b1d, "solid");
    yoke.build(group);
    k.box(x, hookY + 0.09, Z - 0.005, 0.085, 0.19, 0.016, dark, "gloss");
    for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) k.cyl(x + sx * 0.05, hookY + 0.04 + i * 0.05, Z - 0.005, 0.006, 0.006, 0.02, 0xc0c5ca, "metal", 0, 0, Math.PI / 2);
    const neckTop = hookY - 0.005, neckLen = 0.48;
    k.box(x, neckTop - neckLen / 2, Z - 0.004, 0.05, neckLen, 0.02, acoustic ? 0x9a6a3a : 0x6b4a2a);
    k.box(x, neckTop - neckLen / 2, Z + 0.008, 0.048, neckLen, 0.004, 0x1c1410);
    for (let i = 1; i < 12; i++) k.box(x, neckTop - i * 0.036, Z + 0.0105, 0.048, 0.002, 0.001, 0xc0c5ca, "metal");
    const bodyTop = neckTop - neckLen + 0.02;
    const ub = acoustic ? 0.14 : 0.13, lb = acoustic ? 0.19 : 0.165;
    const ubY = bodyTop - ub * 0.8, lbY = ubY - (acoustic ? 0.2 : 0.17);
    k.cyl(x, ubY, bz, ub, ub, th, col, "gloss", Math.PI / 2, 0, 0, 28);
    k.cyl(x, lbY, bz, lb, lb, th, col, "gloss", Math.PI / 2, 0, 0, 28);
    k.box(x, (ubY + lbY) / 2, bz, ub * 1.55, (ubY - lbY), th, col, "gloss");
    if (acoustic) {
      k.cyl(x, ubY - 0.03, face + 0.0005, 0.045, 0.045, 0.002, 0x120c08, "solid", Math.PI / 2, 0, 0, 20);
      k.torus(x, ubY - 0.03, face + 0.001, 0.052, 0.003, 0x3a2414, "solid", 0, 0, 0, null, 24);
      k.box(x, lbY - 0.03, face + 0.004, 0.14, 0.025, 0.008, 0x2b1d14);
    } else {
      k.box(x + 0.035, lbY + 0.02, face + 0.001, 0.2, 0.26, 0.002, 0xeeeae0, "solid", 0, 0, 0.3);
      for (const py of [ubY - 0.02, lbY + 0.06]) k.box(x, py, face + 0.006, 0.075, 0.03, 0.01, 0x111111);
      k.box(x, lbY - 0.06, face + 0.005, 0.08, 0.02, 0.01, 0xc0c5ca, "metal");
      for (let i = 0; i < 3; i++) k.cyl(x + 0.1 - i * 0.012, lbY - 0.05 - i * 0.04, face + 0.008, 0.011, 0.011, 0.016, 0x1a1a1a, "solid", Math.PI / 2, 0, 0, 12);
    }
    const sTop = neckTop, sBot = acoustic ? lbY - 0.03 : lbY - 0.06;
    for (let i = 0; i < 6; i++) k.box(x - 0.018 + i * 0.0072, (sTop + sBot) / 2, Z + 0.013, 0.0011, sTop - sBot, 0.0011, 0xd8dade, "metal");
    const grp = new THREE.Group();
    grp.name = "pawn-good";
    k.build(grp);
    addGood(S, group, acoustic ? "Acoustic Guitar" : "Electric Guitar", grp, k.world(x, 0.08), (ubY + lbY) / 2);
  }

  // An orange neon dollar sign on a black backing board: two open loops and
  // a bar, bent glass tube, lit (a lit sign glows; nothing else here does).
  function buildNeon(k, x, y) {
    k.box(x, y, 0.012, 0.36, 0.4, 0.02, 0x0c0c0e, "gloss");
    const r = 0.06, t = 0.008, z = 0.04, NEON = 0xffa43a;
    k.torus(x, y + r, z, r, t, NEON, "glow", 0, 0, Math.PI * 0.2, Math.PI * 1.3, 24);
    k.torus(x, y - r, z, r, t, NEON, "glow", 0, 0, -Math.PI * 0.8, Math.PI * 1.3, 24);
    k.cyl(x, y, z, t, t, 0.32, NEON, "glow", 0, 0, 0, 8);
    for (const sy of [-1, 1]) k.cyl(x, y + sy * 0.172, 0.026, 0.006, 0.006, 0.03, 0x9aa0a6, "metal", Math.PI / 2, 0, 0, 8);
  }

  /* ---- TAKING A GOOD OFF THE SHELF ----------------------------------------
     In your hand (a gun) or your pocket (anything else) and on the till until
     the broker rings it up; put it back and it goes back where it stood. */
  function setSold(s, on) {
    s.sold = !!on;
    if (s.model) s.model.visible = !on;
    if (on) s.restockT = RESTOCK * (0.8 + Math.random() * 0.5);
  }
  function takeGood(s) {
    const S = s.store;
    if (!S || !S.till || s.sold || s.held || s._taking || !CBZ.player) return;
    s._taking = true;
    const done = function () {
      s._taking = false;
      if (S.dead || s.sold) return;
      s.held = true;
      if (s.model) s.model.visible = false;
      if (s.gun) {
        const id = gunIdOf(s.name);
        s.had = !!(id && CBZ.hasWeapon && CBZ.hasWeapon(id));
        if (CBZ.cityGiveWeapon) CBZ.cityGiveWeapon(s.name);
      }
      S.till.hold({ name: s.name, price: s.price, slot: s,
        onPay: function () { goodYours(s); setSold(s, true); },
        onSteal: function () { goodYours(s); setSold(s, true); },
        onReturn: function (silent) { goodBack(s, silent); } });
    };
    if (CBZ.verbs && CBZ.verbs.pickup && s.model) CBZ.verbs.pickup(CBZ.player, s.model, { pose: "grip", keep: !!s.gun, onTaken: done });
    else done();
  }
  function goodYours(s) {
    const e = econ();
    s.held = false;
    if (e) e.add(s.name, 1);
    if (s.gun && CBZ.cityAddAmmo) CBZ.cityAddAmmo(Math.max(2, ((e && e.ITEMS[s.name] && e.ITEMS[s.name].ammo) | 0)));
    if (CBZ.cityBlingPlayerDirty) CBZ.cityBlingPlayerDirty();
  }
  function goodBack(s, silent) {
    s.held = false;
    if (s.gun) { const id = gunIdOf(s.name); if (id && !s.had && CBZ.lockWeapon) CBZ.lockWeapon(id); }
    const show = function () { if (!s.sold && s.model) s.model.visible = true; };
    if (!silent && CBZ.verbs && CBZ.verbs.putDown && s.model && CBZ.player) CBZ.verbs.putDown(CBZ.player, s.model, null, { onPlaced: show });
    else show();
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  function returnGood(s) {
    const S = s.store, it = S && S.till ? S.till.holding(s) : null;
    if (!it) return;
    S.till.release(it);
    goodBack(s, false);
  }

  // ============================================================
  //  THE FENCE — what he pays for what you carry
  // ------------------------------------------------------------
  //  Valuables, worn pieces and jewellery, and guns: 40–55% of clean value
  //  (luxe pieces a touch fatter), nudged up by your fence rep, always under
  //  the jeweller's retail fence. Hot goods he knows about: under half that.
  // ============================================================
  function isWorn(name) { const e = econ(); return !!(e && e.isEquipped && e.isEquipped(name)); }
  function fenceable(it) { return !!it && (it.tag === "valuable" || it.tag === "wearable" || it.tag === "jewelry" || (it.tag === "weapon" && !!it.gun)); }
  function sellable(forLoan) {
    const e = econ(), inv = (g && g.cityInv) || {}, out = [];
    for (const k in inv) {
      const it = e && e.ITEMS[k]; if (!it || (inv[k] | 0) <= 0 || !fenceable(it)) continue;
      if (forLoan && it.tag === "weapon") continue;
      if (isWorn(k) && (inv[k] | 0) <= 1) continue;        // the one you are wearing is not for sale
      out.push({ name: k, n: inv[k] | 0, it });
    }
    out.sort((a, b) => fencePrice(b.name) - fencePrice(a.name));   // priciest first (walk the pile down)
    return out;
  }
  function fencePrice(name) {
    const e = econ(), it = e && e.ITEMS[name]; if (!it) return 0;
    let mul = it.tag === "valuable" ? SELL_HI : SELL_LO;
    if (it.tag === "weapon") mul = 0.35;                     // a used gun with no paper on it
    if (it.luxe) mul = 0.62;                                  // a broker who moves seven figures takes a thinner cut
    const rep = (e.fenceBonus && e.fenceBonus()) || 0;        // your rep shaves the haircut (shared faucet)
    mul = Math.min(it.luxe ? 0.7 : 0.6, mul + rep);           // capped UNDER the jeweller's clean-ish payout
    return Math.max(1, Math.round(it.value * mul));
  }

  /* ---- ON HIS COUNTER ------------------------------------------------------
     [Sell X]: your hand sets it on the counter (CBZ.verbs.putDown), he names
     his number. [Take $] and the cash is yours; [No deal] and it comes back
     to your hand. Walk off and it comes back with you. */
  function counterModel(name) {
    const e = econ(), it = e && e.ITEMS[name];
    if (it && it.gun && CBZ.buildActorWeapon) {
      const m = CBZ.buildActorWeapon(it.gun);
      if (m) {
        m.rotation.set(0, 0, 0); m.position.set(0, 0, 0);
        m.scale.setScalar((CBZ.weaponWorldScale && CBZ.weaponWorldScale(m.userData.weaponId || name)) || 0.95);
        const K = CBZ.storeFixtureKit;
        return K ? K.seat(m, function (turn, mm) { mm.rotation.set(0, 0, Math.PI / 2); }) : m;
      }
    }
    return CBZ.itemAsset ? CBZ.itemAsset(name) : null;
  }
  function offerItem(S, name) {
    const e = econ();
    if (!e || S.offer || !S.till || !S.till.open()) return;
    const it = e.ITEMS[name];
    const before = e.count(name);
    if (before <= 0) return;
    const hotN = CBZ.cityHotCount ? CBZ.cityHotCount(name) : 0;
    const hot = hotN >= before;                               // every one you carry is stolen: this one is
    const rec = hot && CBZ.cityHotTake ? CBZ.cityHotTake(name) : null;
    if (!e.take(name, 1)) { if (rec) CBZ.cityHotPut(name, rec); return; }
    let unarmed = false;
    if (it && it.gun && e.count(name) <= 0) { const id = gunIdOf(name); if (id && CBZ.lockWeapon) { CBZ.lockWeapon(id); unarmed = id; } }
    const knows = !!(rec && (rec.where === S.where || now() - (rec.t || 0) < HOT_KNOWN_S || (g.wanted | 0) > 0));
    const price = Math.max(1, Math.round(fencePrice(name) * (knows ? HOT_CUT : 1)));
    // the piece on his counter, in front of the sell end
    const m = counterModel(name);
    if (m) {
      const p = S.onFloor(S.sellX + 0.35, S.CD / 2 - 0.12);
      m.position.set(p.x, (S.top || S.C.top + 0.04) + 0.005, p.z);
      m.rotation.y = S.yawC;
      m.visible = false;
      (S.group || CBZ.scene).add(m);
    }
    S.offer = { name: name, price: price, knows: knows, rec: rec, model: m, unarmed: unarmed, t: 0 };
    const said = function () {
      if (m) m.visible = true;
      if (S.offer && S.clerk) S.clerk.say(knows ? "offerHot" : "offer", { vars: { price: fmt$(price) } });
    };
    if (m && CBZ.verbs && CBZ.verbs.putDown && CBZ.player) CBZ.verbs.putDown(CBZ.player, m, null, { onPlaced: said });
    else said();
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  function dropOfferModel(S) {
    const o = S.offer;
    if (o && o.model && o.model.parent) { o.model.parent.remove(o.model); if (SF()) SF().disposeTree(o.model); }
  }
  function acceptOffer(S) {
    const o = S.offer, e = econ();
    if (!o || !e || !CBZ.city || !S.till || !S.till.open()) return;
    S.offer = null;
    dropOfferModel(S);
    CBZ.city.addCash(o.price);
    if (e.bumpFenceRep) e.bumpFenceRep(1);
    if (CBZ.sfx) CBZ.sfx("coin");
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  // back in your hand (a refusal), or straight back in your pocket (walked off)
  function cancelOffer(S, silent) {
    const o = S.offer, e = econ();
    if (!o) return;
    S.offer = null;
    const back = function () {
      dropOfferModel(S);
      if (e) e.add(o.name, 1);
      if (o.rec && CBZ.cityHotPut) CBZ.cityHotPut(o.name, o.rec);
      if (o.unarmed && CBZ.unlockWeapon) CBZ.unlockWeapon(o.unarmed, { select: false });
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    };
    if (!silent && o.model && o.model.visible && CBZ.verbs && CBZ.verbs.pickup && CBZ.player) CBZ.verbs.pickup(CBZ.player, o.model, { onTaken: back });
    else back();
  }

  // ============================================================
  //  THE COLLATERAL LOAN — pawn an item, redeem or forfeit (contract [E])
  // ------------------------------------------------------------
  //  CBZ.cityPawnLoan(item): hold the item as collateral, disburse ~50% of its
  //  fence value to g.cash on the spot, write a ticket into g.cityPawnTickets.
  //  Redeem before expiry = repay principal + a 20% fee, get the item back.
  //  Lapse = forfeit (the broker keeps it; the spread is their profit).
  // ============================================================
  function tickets() { if (!Array.isArray(g.cityPawnTickets)) g.cityPawnTickets = []; return g.cityPawnTickets; }

  // ---- PERSIST the pawn tickets via the EXISTING save hook (the outfits.js
  //      _fitWrap pattern): g.cityPawnTickets rides into the same world ledger
  //      that worldstate.js writes to localStorage AND netpersist.js syncs to
  //      the server. pawnLoan() takes the collateral OUT of g.cityInv (which IS
  //      saved), so without persisting the TICKET a reload loses both the item
  //      and the way to get it back. Expiries are absolute (now()-based).
  //      STAMP BEFORE COMMIT: worldstate's commit() calls save() internally.
  function stampTickets() {
    const led = g.cityWorld;
    if (led && typeof led === "object") led.cityPawnTickets = (g.cityPawnTickets || []).map((t) => Object.assign({}, t));
  }
  // ONE-SHOT INSTALL (a module-local boolean: a flag on the top-of-chain
  // function vanished once another module wrapped above us, and the chain grew
  // every tick until a save overflowed the stack).
  let _ensurePawnSaveWraps_done = false;
  function ensurePawnSaveWraps() {
    if (_ensurePawnSaveWraps_done) return;
    _ensurePawnSaveWraps_done = true;
    const commit = CBZ.cityWorldCommit;
    if (typeof commit === "function" && !commit._pawnWrap) {
      const w = function () { stampTickets(); return commit.apply(this, arguments); };
      w._pawnWrap = true; CBZ.cityWorldCommit = w;
    }
    const col = CBZ.cityWorldCollect;
    if (typeof col === "function" && !col._pawnWrap) {
      const wc = function () { stampTickets(); return col.apply(this, arguments); };
      wc._pawnWrap = true; CBZ.cityWorldCollect = wc;
    }
  }
  // RESTORE: hydrate from the live ledger whenever its object REFERENCE changes
  // (a fresh load, a respawn, a multiplayer adopt).
  let _hydratedLedger = null;
  function hydratePawnFromLedger() {
    const led = g.cityWorld;
    if (!led || led === _hydratedLedger) return;
    _hydratedLedger = led;
    if (Array.isArray(led.cityPawnTickets)) g.cityPawnTickets = led.cityPawnTickets.map((t) => Object.assign({}, t));
  }
  function itemValue(name) { const e = econ(), it = e && e.ITEMS[name]; return it ? (it.value || 0) : 0; }
  function loanOffer(name) {
    const v = itemValue(name);
    const principal = Math.max(1, Math.round(v * LOAN_FRAC));
    return { principal, fee: Math.round(principal * LOAN_FEE), redeem: principal + Math.round(principal * LOAN_FEE), term: LOAN_TERM };
  }
  // the canonical engine hook. Accepts a NAME ("Rolex") or a {name} record.
  function pawnLoan(item) {
    const e = econ(); if (!e || !CBZ.city) return null;
    const name = (item && item.name) || item;
    if (!name || typeof name !== "string") return null;
    const it = e.ITEMS[name];
    if (!it || (it.tag !== "valuable" && it.tag !== "wearable" && it.tag !== "jewelry")) return null;
    if ((e.count ? e.count(name) : 0) <= 0) return null;
    if (isWorn(name) && e.count(name) <= 1) return null;
    const o = loanOffer(name);
    if (!(o.principal > 0) || !isFinite(o.principal)) return null;
    if (!e.take(name, 1)) return null;                         // collateral leaves your pockets, into the cage
    CBZ.city.addCash(o.principal);
    const id = "pawn-" + Math.floor(now() * 1000) + "-" + (tickets().length);
    const t = { id, name, principal: o.principal, fee: o.fee, redeem: o.redeem, born: now(), expires: now() + o.term, forfeit: false };
    tickets().push(t);
    if (CBZ.sfx) CBZ.sfx("coin");
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    if (CBZ.cityWorldCommit) CBZ.cityWorldCommit();
    return id;
  }
  function liveTickets() {
    return tickets().filter((t) => t && !t.forfeit).sort((a, b) => a.expires - b.expires);
  }
  // TRUE only when the item actually came back to the player
  function redeemTicket(t) {
    const e = econ(); if (!e || !CBZ.city || !t || t.forfeit) return false;
    if (now() >= t.expires) { forfeit(t); return false; }      // too late — the broker already pulled it
    if (!CBZ.city.canAfford(t.redeem)) { note(fmt$(t.redeem), 1.4); return false; }
    if (!CBZ.city.spend(t.redeem)) return false;
    e.add(t.name, 1);                                          // your item, back in your pocket
    t.forfeit = true; t.redeemed = true;                       // close the ticket
    pruneTickets();
    if (CBZ.sfx) CBZ.sfx("coin");
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    if (CBZ.cityWorldCommit) CBZ.cityWorldCommit();
    return true;
  }
  function forfeit(t) {
    if (!t || t.forfeit) return;
    t.forfeit = true;                                          // the broker keeps the collateral
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  function pruneTickets() {
    const arr = tickets(), keep = [];
    for (const t of arr) {
      if (!t) continue;
      if (t.redeemed) continue;
      if (t.forfeit && (now() - (t.expires || 0)) > 30) continue;
      keep.push(t);
    }
    g.cityPawnTickets = keep;
  }

  // ---- THE COUNTER IS CANDIDATES (city/interactions.js registerFixtures) ----
  // The goods, the register, the sell end and the loan end are things in the
  // registry: E does the obvious verb on the one you look at, Q / a tap shows
  // them all.
  function inBounds(S, px, pz) {
    const B = S.bounds;
    return px >= B.minX - 1.5 && px <= B.maxX + 1.5 && pz >= B.minZ - 1.5 && pz <= B.maxZ + 1.5;
  }
  function storeAt(px, pz) {
    for (const S of STORES) if (!S.dead && S.dressed && S.near && inBounds(S, px, pz)) return S;
    return null;
  }
  function sellAll(S) {
    const list = sellable(false).filter(function (s) { const it = s.it; return it.tag !== "weapon"; });
    let total = 0;
    const e = econ();
    for (const s of list) for (let i = 0; i < s.n; i++) {
      if (isWorn(s.name) && (e.count(s.name) <= 1)) break;
      const hotN = CBZ.cityHotCount ? CBZ.cityHotCount(s.name) : 0;
      const rec = hotN >= e.count(s.name) && CBZ.cityHotTake ? CBZ.cityHotTake(s.name) : null;
      const knows = !!(rec && (rec.where === S.where || now() - (rec.t || 0) < HOT_KNOWN_S || (g.wanted | 0) > 0));
      if (!e.take(s.name, 1)) break;
      total += Math.max(1, Math.round(fencePrice(s.name) * (knows ? HOT_CUT : 1)));
    }
    if (total > 0 && CBZ.city) { CBZ.city.addCash(total); if (e.bumpFenceRep) e.bumpFenceRep(1); if (CBZ.sfx) CBZ.sfx("coin"); }
  }
  function sellAllTotal() {
    let t = 0;
    for (const s of sellable(false)) if (s.it.tag !== "weapon") t += fencePrice(s.name) * s.n;
    return t;
  }
  function offerVerb(i) {
    return {
      id: "pawn-offer-" + i, slot: i === 0 ? "e" : undefined, prio: 6 - i * 0.1,
      label: () => { const t = sellable(false)[i]; return t ? "Sell " + t.name : "Sell"; },
      canShow: (d) => d.mode === "sell" && !d.store.offer && !!d.store.till && d.store.till.open() && sellable(false).length > i,
      onSelect: (d) => { const t = sellable(false)[i]; if (t) offerItem(d.store, t.name); },
    };
  }
  function redeemVerb(i) {
    return {
      id: "pawn-redeem-" + i, slot: "e", prio: 4 - i * 0.1,
      label: () => { const t = liveTickets()[i]; return t ? "Redeem " + t.name + " " + fmt$(t.redeem) : "Redeem"; },
      canShow: (d) => d.mode === "loan" && !!d.store.till && d.store.till.open() && liveTickets().length > i,
      onSelect: () => { const t = liveTickets()[i]; if (t) redeemTicket(t); },
    };
  }
  const _list = [];
  let fixturesWired = false;
  function wireFixtures() {
    if (fixturesWired || !CBZ.interactions || !CBZ.interactions.registerFixtures) return;
    fixturesWired = true;
    const open = (d) => !!(d.store && d.store.till && d.store.till.open());
    CBZ.interactions.registerFixtures({
      id: "pawn-desk", kind: "pawn-desk", prio: 9, islands: true,
      list: function (ctx, px, pz) {
        const S = storeAt(px, pz);
        if (!S) return null;
        _list.length = 0;
        _list.push(S.sellDesk, S.loanDesk, S.tillCand);
        for (const s of S.goods) _list.push(s);
        return _list;
      },
      reach: function (d) { return d.reach || REACH; },
      dot: function (d) { return d.dot || LOOK_DOT; },
      name: function (d) { return d.good ? d.name : ""; },
      verbs: [
        // the register: what you are holding, rung up
        { id: "pawn-pay", slot: "e", prio: 8, label: (d) => "Buy " + fmt$(d.store.till.total()),
          canShow: (d) => !!d.till && !!d.store.till && d.store.till.held.length > 0 && open(d), onSelect: (d) => d.store.till.pay() },
        // the goods
        { id: "pawn-take", slot: "e", prio: 6, label: (d) => "Take " + fmt$(d.price),
          canShow: (d) => !!d.good && !d.sold && !d.held && !d._taking, onSelect: takeGood },
        { id: "pawn-return", slot: "e", prio: 6, label: "Put back",
          canShow: (d) => !!d.good && d.held && !!(d.store.till && d.store.till.holding(d)), onSelect: returnGood },
        // his number for what is on the counter
        { id: "pawn-accept", slot: "e", prio: 8, forceYes: true, label: (d) => "Take " + fmt$(d.store.offer.price),
          canShow: (d) => d.mode === "sell" && !!d.store.offer && open(d), onSelect: (d) => acceptOffer(d.store) },
        { id: "pawn-decline", prio: 4, label: "No deal",
          canShow: (d) => d.mode === "sell" && !!d.store.offer, onSelect: (d) => cancelOffer(d.store, false) },
        offerVerb(0), offerVerb(1), offerVerb(2),
        { id: "pawn-sell-all", prio: 3, forceYes: true, label: () => "Sell all " + fmt$(sellAllTotal()),
          canShow: (d) => d.mode === "sell" && !d.store.offer && open(d) && sellable(false).filter((s) => s.it.tag !== "weapon").length > 1,
          onSelect: (d) => sellAll(d.store) },
        // the loan end
        { id: "pawn-loan", slot: "e", prio: 6, forceYes: true,
          label: () => { const t = sellable(true)[0]; return t ? "Pawn " + t.name + " " + fmt$(loanOffer(t.name).principal) : "Pawn"; },
          canShow: (d) => d.mode === "loan" && open(d) && sellable(true).length > 0,
          onSelect: () => { const t = sellable(true)[0]; if (t) pawnLoan(t.name); } },
        redeemVerb(0), redeemVerb(1), redeemVerb(2),
      ],
    });
  }

  // ---- GANG CITY's store (self-healing, gunstore pattern) ------------------
  function cityDesc(lot) {
    const b = lot.building, K = CBZ.storeFixtureKit;
    const ox = (b.ox != null ? b.ox : lot.cx), oz = (b.oz != null ? b.oz : lot.cz);
    const W = b.w || 10, D = b.d || 10, WT = 0.4;
    const FY = ((Array.isArray(b.floorTops) && b.floorTops[0] != null) ? b.floorTops[0] : 0.14) + 0.06;   // the fit-out's finished floor
    const door = b.door || { x: ox, z: oz - D / 2, nx: 0, nz: 1 };
    const inx = door.nx, inz = door.nz;            // inward unit (one axis is 0)
    const tx = -inz, tz = inx;                     // wall tangent
    const halfIn = (inx !== 0 ? W : D) / 2;        // door wall → centre depth
    const halfTan = (inx !== 0 ? D : W) / 2;
    // the counter the clerk stands behind (fallback: where buildings.js puts it)
    let C = K ? K.counterOf(lot) : null;
    if (!C) {
      const along = inx !== 0;
      C = { x: ox + inx * (halfIn - 2.8), z: oz + inz * (halfIn - 2.8),
            w: along ? 0.8 : Math.min(W - 2, 4.5), d: along ? Math.min(D - 2, 4.5) : 0.8, top: 1.2, tx, tz };
    }
    const wIn = halfIn - WT;
    const bounds = { minX: ox - W / 2 + WT, maxX: ox + W / 2 - WT, minZ: oz - D / 2 + WT, maxZ: oz + D / 2 - WT };
    return {
      FY: FY, C: C, bounds: bounds,
      wall: { x: ox + inx * wIn, z: oz + inz * wIn, yaw: K ? K.yawOf(tx, tz) : 0 },
      runMax: Math.min(2 * halfTan - 2 * WT - 0.6, 6.4),
      inStore: function (x, z) { return Math.abs(x - ox) < W / 2 + 0.3 && Math.abs(z - oz) < D / 2 + 0.3; },
    };
  }
  function ensureCity() {
    const arena = CBZ.city && CBZ.city.arena;
    if (cityStore) {
      if (CITY.arena === arena) return cityStore;
      disposeStore(cityStore); cityStore = null;
    }
    if (!arena || !econ()) return null;
    if (CITY.noLotArena === arena) return null;          // this city has no pawn lot — answered once
    let lot = arena.pawnLot || null;
    if (!(lot && lot.building && lot.building.shop && lot.building.shop.kind === "pawn")) {
      lot = null;
      const lots = (CBZ.city && CBZ.city.shopLots) || arena.lots || [];
      for (let i = 0; i < lots.length; i++) {
        const L = lots[i];
        if (L && L.building && L.building.shop && L.building.shop.kind === "pawn") { lot = L; break; }
      }
      if (!lot && lots.length) { CITY.noLotArena = arena; return null; }
    }
    if (!lot) return null;
    CITY.arena = arena;
    const d = cityDesc(lot);
    cityStore = makeStore(Object.assign(d, { kind: "city", lot: lot, root: arena.root || CBZ.scene,
      clerk: SF() ? SF().cityClerk(lot) : null, where: "city" }));
    return cityStore;
  }
  function dress(S) {
    if (!S || S.dressed || S.dead) return;
    S.dressed = true;
    buildDisplays(S);
  }

  /* ---- THE ISLANDS: one pawn shop per building (CBZ.islandVenue "pawn") --- */
  function islandFit(b, lot, job) {
    const F = SF(), IV = CBZ.islandVenue, K = CBZ.storeFixtureKit;
    if (!F || !IV || !K || !econ()) return null;
    const P0 = F.plan(b, { backRoom: true });
    if (!P0) return null;
    IV.clear(b, 0);
    const shell = F.shell(P0, lot, { goods: "boxes", wall: 0xd6cdb8, trim: 0x5a4a38, safeGrade: "office", safeOf: 12000 });
    const gd = F.gunDescriptor(P0);                         // the same counter line as the gun shop
    const zone = F.counterZone(P0, gd);
    const c = P0.cust, wp = P0.w(P0.xc, P0.wallFace);
    const clerk = F.postedClerk({ b: b, lot: lot, lx: zone.post.lx, lz: zone.post.lz, face: zone.post.face, armed: "Shotgun", job: "pawnbroker" });
    F.register(P0, gd, clerk, gd.counter.L * 0.27, (lot.name || "pawn shop") + " register");   // behind the teller cage
    const S = makeStore({
      kind: "island", lot: lot, FY: P0.fy, root: CBZ.scene, clerk: clerk, where: F.whereKey(lot.island),
      C: { x: gd.counter.x, z: gd.counter.z, w: gd.counter.w, d: gd.counter.d, top: gd.counter.top, tx: gd.counter.tx, tz: gd.counter.tz },
      wall: { x: wp.x, z: wp.z, yaw: K.yawOf(c.z, -c.x) },
      runMax: Math.min(6.4, P0.W - 1.6), bounds: P0.room,
      inStore: function (x, z) { return P0.inside(x, z, 0.4); }, nearDoor: P0.nearDoor, behind: zone.behind,
    });
    return function () { disposeStore(S); shell.dispose(); };
  }
  if (CBZ.islandVenue && CBZ.islandVenue.on) CBZ.islandVenue.on("pawn", islandFit);

  // ---- per-frame --------------------------------------------------------------
  function tickStore(S, dt, live) {
    const P = CBZ.player;
    if (!live || !P) {
      if (S.group && S.group.visible) S.group.visible = false;
      S.near = false;
      if (S.offer) cancelOffer(S, true);
      return;
    }
    for (const s of S.goods) if (s.sold) { s.restockT -= dt; if (s.restockT <= 0) setSold(s, false); }
    const dx = P.pos.x - S.cx, dz = P.pos.z - S.cz, d2 = dx * dx + dz * dz;
    if (!S.dressed && d2 < DRESS_R * DRESS_R) dress(S);
    const near = d2 < VIS_R * VIS_R;
    if (S.group && S.group.visible !== near) S.group.visible = near;
    S.near = near;
    const inside = S.inStore(P.pos.x, P.pos.z);
    if (S.clerk && S.clerk.look) S.clerk.look(inside ? P.pos.x : null, P.pos.z);
    if (S.clerk) S.clerk.tick(dt);
    if (S.till) S.till.tick(dt);
    // walked off from his counter, or he is gone: your piece comes back with you
    if (S.offer && (!inside || P.dead || !S.till || !S.till.open() || Math.hypot(P.pos.x - S.sellDesk.x, P.pos.z - S.sellDesk.z) > 5)) cancelOffer(S, true);
  }
  CBZ.onUpdate(39, function (dt) {
    // persistence wrap+hydrate run EVERY frame, regardless of mode: the ledger
    // can be swapped (load/respawn/MP-adopt) while we're outside the city too.
    ensurePawnSaveWraps();
    hydratePawnFromLedger();
    const econMode = !!g && (CBZ.economyMode ? CBZ.economyMode(g.mode) : g.mode === "city");
    const cityLive = econMode && !!(CBZ.cityArenaLive ? CBZ.cityArenaLive() : (g.mode === "city"));
    if (cityLive) ensureCity();
    if (econMode) {
      wireFixtures();
      // tickets count down in real seconds; lapse → forfeit (broker keeps it).
      const arr = tickets();
      if (arr.length) {
        const t0 = now();
        for (const t of arr) if (t && !t.forfeit && t0 >= t.expires) forfeit(t);
        pruneTickets();
      }
    }
    for (let i = STORES.length - 1; i >= 0; i--) {
      const S = STORES[i];
      tickStore(S, dt, S.kind === "city" ? cityLive : (econMode && g.mode !== "city"));
    }
  });

  // ---- public hooks (contracts E + F; gunstore/jewelry-style) ----------------
  CBZ.cityPawnLive = function (lot) { return !!(cityStore && !cityStore.dead && (!lot || lot === cityStore.lot)); };
  // the canonical collateral-loan engine (contract [E]). NAME or {name} record.
  CBZ.cityPawnLoan = function (item) { ensureCity(); return pawnLoan(item); };
  CBZ.cityPawnLot = function () { return (cityStore && cityStore.lot) || null; };
  // harness handle: fence one unit straight (no counter scene)
  CBZ.cityPawnSell = function (name) {
    const e = econ(); if (!e || (e.count ? e.count(name) : 0) <= 0 || !CBZ.city) return false;
    if (!e.take(name, 1)) return false;
    CBZ.city.addCash(fencePrice(name));
    return true;
  };
  CBZ.cityPawnRedeem = function (id) {
    const t = tickets().find((x) => x && x.id === id && !x.forfeit);
    if (!t) return false; return redeemTicket(t);   // propagate the REAL result (don't lie on a no-op)
  };
  CBZ.cityPawnFenceQuote = function (name) { return fencePrice(name); };
  CBZ.cityPawnState = function () {
    return {
      live: !!cityStore,
      sellable: sellable(false).map((s) => ({ name: s.name, n: s.n, fence: fencePrice(s.name), hot: CBZ.cityHotCount ? CBZ.cityHotCount(s.name) : 0 })),
      tickets: liveTickets().map((t) => ({ id: t.id, name: t.name, principal: t.principal, redeem: t.redeem, left: Math.max(0, Math.round(t.expires - now())) })),
    };
  };
  CBZ.pawnShops = function () {
    return STORES.map(function (S) {
      return { kind: S.kind, name: (S.lot && S.lot.name) || null, dressed: S.dressed, goods: S.goods.length,
        onSale: S.goods.filter(function (s) { return !s.sold && !s.held; }).length,
        holding: S.till ? S.till.held.length : 0, offer: S.offer ? { name: S.offer.name, price: S.offer.price, hot: S.offer.knows } : null,
        clerk: !!(S.clerk && S.clerk.alive()) };
    });
  };
})();
