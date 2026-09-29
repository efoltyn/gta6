/* ============================================================
   city/pawnshop.js — LAST CHANCE PAWN: the walk-in fence + collateral desk.

   WHY: the loot economy already let you fence valuables through a text menu,
   and the jewelry case lets you BUY a sick watch — but there was no PLACE that
   answered "I bought the flashy Rolex, the heat's on, I need cash NOW." A pawn
   shop is exactly that place: a barred teller window, a counter, a wall of
   other people's pawned junk (a guitar nobody redeemed, a stack of power
   tools, an old TV, a tray of watches), and a buzzing LOANS sign. Two desks,
   two fantasies:
     • SELL it outright at a HAIRCUT — fast cash, gone forever. The pawnbroker
       pays 40–55% of value (LESS than the jeweller's retail fence: the spread
       IS the point — sell the sick watch you bought and eat the loss, the
       price of liquidity). Routes through the SAME fence (CBZ.city.addCash +
       fence rep), so the buy-low/sell-high loop is untouched.
     • PAWN it for a short-term COLLATERAL LOAN — ~40–60% of fence value in
       cash on the spot, the item held behind the glass as collateral. Redeem
       it (repay principal + a fee) before the ticket expires and you walk out
       with both the cash you spent AND your item back; let it lapse and it's
       FORFEIT — the broker keeps it and the markup is their profit. (Real
       pawnbroking: 25–60% advance, 30–90 day terms, ~20% monthly fee, forfeit
       on default — see research notes.)

   The pawn lot's shell (door, counter, posted clerk) is stamped by
   buildings.js; this dresses that counter, stands the showcase, the teller
   cage, the back-wall shelving of pawned goods, and the two look-and-[E]
   desks in front of it (see buildDisplays). Built ONCE per city on a single
   group through the store fixture kit (city/gunstore.js), the whole display
   visibility-gated by distance, mode-gated + headless-guarded.
   No price tables duplicated — every $ comes from cityEcon. Public hooks:
   CBZ.cityPawnLive(lot) (interact.js trims the generic "Shop here" verb when
   live) + CBZ.cityPawnLoan(item) (the collateral-loan engine, contract [E]).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.onUpdate) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  const VIS_R = 55;          // display group draws only when you're near the shop
  const REACH = 3.0;         // you transact at the counter's arm-length
  const LOOK_DOT = 0.66;     // act on the desk you're LOOKING at (tight so the clerk's E isn't stolen)
  // Collateral-loan terms (research-grounded pawnbroking, tuned for the game):
  const LOAN_FRAC = 0.50;    // advance = 50% of the item's clean value (in the 40–60% band)
  const LOAN_TERM = 240;     // seconds the ticket runs before forfeiture (a real countdown you feel)
  const LOAN_FEE = 0.20;     // redemption fee = 20% of the principal (the broker's monthly cut)
  const SELL_LO = 0.40, SELL_HI = 0.55;   // outright-sale haircut band (LESS than jeweller retail)

  const S = { lot: null, b: null, group: null, built: false, arena: null, noLotArena: null,
              sellDesk: null, loanDesk: null, cx: 0, cz: 0,
              near: false };

  function econ() { return CBZ.cityEcon || null; }
  function fmt$(n) { n = Math.round(n || 0); return "$" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function note(t, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(t, s); }
  function now() { return (CBZ.now || 0) / 1000; }   // CBZ.now is ms; tickets count in seconds

  // ---- build the storefront fixtures once per city ---------------------------
  // WHAT THE ROOM IS (de-slop pass, 2026-09-27). The pawn desk is the counter
  // the clerk already stands behind (buildings.js's counter, found through the
  // fit-out record: CBZ.storeFixtureKit.counterOf). This file used to lay a
  // SECOND counter of its own at a different depth, so the store had two
  // counters and the clerk was never behind the one you traded at. Now:
  //   • the counter, dressed: clad in scuffed oak laminate over a kick
  //     plinth, a brass trim line, a dark worktop;
  //   • SELL end: a countertop showcase (glass, chrome frame, black velvet
  //     deck, LED under the lid) holding a watch tray, a ring tray, coiled
  //     chains and a phone, all pawned goods at real size;
  //   • LOAN end: the teller cage, a real one: steel posts from the worktop
  //     to 2.3 m, a lower and top rail, bars between them, a glazed back, a
  //     speak-through grille at head height, a stainless deal tray passing
  //     under the lower rail, and the till behind it;
  //   • the back wall: open steel-and-oak shelving bays stocked with what
  //     people actually pawn (a flat TV on its stand, a guitar amp, laptops,
  //     phones, a drill, a toolbox, a boombox, a pair of speakers, a camera,
  //     boxed electronics), an electric and an acoustic guitar hung by their
  //     headstocks at the two ends, and an orange neon dollar sign on a black
  //     backing board above the run (a lit sign, no invented words).
  // Deleted as slop: the monolithic 2.2 m dark cabinet box, the red cylinder
  // "guitar", the orange box "drill", the black box "TV", three cylinder
  // "watches", the translucent GLOWING "glass pad", teller bars floating
  // half a metre above the counter under a frame that touched nothing, and
  // the blank GLOWING orange "LOANS" box.
  function buildDisplays() {
    const b = S.b;
    const K = CBZ.storeFixtureKit;
    const group = new THREE.Group();
    S.group = group;
    const root = (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || CBZ.scene;
    root.add(group);

    const ox = (b.ox != null ? b.ox : S.lot.cx), oz = (b.oz != null ? b.oz : S.lot.cz);
    const W = b.w || 10, D = b.d || 10, WT = 0.4;
    S.cx = ox; S.cz = oz;
    const FY = ((Array.isArray(b.floorTops) && b.floorTops[0] != null) ? b.floorTops[0] : 0.14) + 0.06;   // the fit-out's finished floor
    const door = (S.lot.building && S.lot.building.door) || { x: ox, z: oz - D / 2, nx: 0, nz: 1 };
    const inx = door.nx, inz = door.nz;            // inward unit (one axis is 0)
    const tx = -inz, tz = inx;                     // wall tangent
    const halfIn = (inx !== 0 ? W : D) / 2;        // door wall → centre depth
    const halfTan = (inx !== 0 ? D : W) / 2;

    // the counter the clerk stands behind (fallback: where buildings.js puts it)
    let C = K ? K.counterOf(S.lot) : null;
    if (!C) {
      const along = inx !== 0;
      C = { x: ox + inx * (halfIn - 2.8), z: oz + inz * (halfIn - 2.8),
            w: along ? 0.8 : Math.min(W - 2, 4.5), d: along ? Math.min(D - 2, 4.5) : 0.8, top: 1.2, tx, tz };
    }
    const L = Math.max(C.w, C.d), CD = Math.min(C.w, C.d);
    const sellX = -L * 0.26, loanX = L * 0.27;
    const front = 1.0;                             // desks stand one step in front of the counter line
    const yawC = K ? K.yawOf(C.tx, C.tz) : Math.atan2(-C.tz, C.tx);
    const onFloor = function (lx, lz) { const c = Math.cos(yawC), s = Math.sin(yawC); return { x: C.x + lx * c + lz * s, z: C.z - lx * s + lz * c }; };
    const sp = onFloor(sellX, front), lp = onFloor(loanX, front);
    S.sellDesk = { mode: "sell", x: sp.x, z: sp.z };
    S.loanDesk = { mode: "loan", x: lp.x, z: lp.z };
    if (!K) return;                                // no kit: the desks still trade

    // ---- the counter ----
    const k = K.create().frame(C.x, 0, C.z, yawC);
    const top = K.dressCounter(k, L, CD, C.top, FY, { clad: 0x6b5238, trim: 0xb8953e, work: 0x24211e, kick: 0x141210 });

    // ---- SELL end: the showcase of pawned jewellery ----
    const cLen = Math.min(1.5, Math.max(0.9, L * 0.4)), cWid = Math.min(0.56, CD - 0.1);
    const deck = K.showcase(k, sellX, top, cLen, cWid, { felt: 0x121114, frame: 0xc4c8cc });
    const BLK = 0x1a1a1c, GOLD = 0xc9a44a, SILV = 0xc6cdd6;
    // watch tray: a velvet tray with three watches lying on it
    const wtx = sellX - cLen * 0.28;
    k.box(wtx, deck + 0.008, -0.04, 0.3, 0.016, 0.2, BLK);
    [GOLD, SILV, GOLD].forEach(function (cc, i) {
      const x = wtx - 0.09 + i * 0.09;
      k.box(x, deck + 0.018, -0.04, 0.022, 0.004, 0.16, i === 1 ? SILV : 0x3a2a1c);        // strap / bracelet
      k.cyl(x, deck + 0.023, -0.04, 0.02, 0.02, 0.009, cc, "metal", 0, 0, 0, 20);          // case
      k.cyl(x, deck + 0.028, -0.04, 0.016, 0.016, 0.002, i === 1 ? 0x1c3a66 : 0xe8e2d0);   // dial
    });
    // ring tray: slotted velvet, four rings standing in the slots
    const rtx = sellX + cLen * 0.05;
    k.box(rtx, deck + 0.012, -0.04, 0.24, 0.024, 0.16, BLK);
    for (let r = 0; r < 3; r++) k.box(rtx, deck + 0.0245, -0.1 + r * 0.06, 0.22, 0.002, 0.006, 0x050505);
    for (let i = 0; i < 4; i++) {
      const x = rtx - 0.075 + i * 0.05, z = -0.1 + (i % 3) * 0.06;
      k.torus(x, deck + 0.034, z, 0.01, 0.0022, i % 2 ? SILV : GOLD, "metal", 0, 0, 0, null, 16);
      if (i !== 2) k.push(new THREE.OctahedronGeometry(0.004, 0), 0xeaf6ff, "metal", x, deck + 0.047, z);
    }
    // two coiled chains and a phone near the front glass
    const chx = sellX + cLen * 0.32;
    k.torus(chx, deck + 0.004, 0.02, 0.05, 0.003, GOLD, "metal", Math.PI / 2);
    k.torus(chx, deck + 0.004, 0.02, 0.035, 0.003, GOLD, "metal", Math.PI / 2);
    k.torus(chx - 0.02, deck + 0.004, -0.1, 0.03, 0.0035, SILV, "metal", Math.PI / 2);
    if (CBZ.itemAsset) { const ph = CBZ.itemAsset("Phone"); if (ph) k.absorb(ph, sellX - cLen * 0.05, deck, 0.13, 0, 0.3, 0); }

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

    // ---- the back wall: shelving bays, guitars, the neon sign ----
    const wallK = K.create();
    const wIn = halfIn - WT;                                        // inner back face, from the centre
    const wx = ox + inx * wIn, wz = oz + inz * wIn;
    wallK.frame(wx, 0, wz, K.yawOf(tx, tz));                        // +Z points back into the room
    const shelfW = Math.min(2 * halfTan - 2 * WT - 0.6, 6.4);
    const bays = Math.max(1, Math.min(4, Math.floor((shelfW - 1.1) / 1.2)));
    const runW = bays * 1.2;
    const R = K.rng(Math.round(ox * 17) ^ Math.round(oz * 29));
    buildShelving(wallK, runW, bays, FY, R);
    // guitars hung by the headstock at both ends of the run
    buildGuitar(wallK, -(runW / 2 + 0.34), FY, true);
    buildGuitar(wallK, runW / 2 + 0.34, FY, false);
    buildNeon(wallK, 0, FY + 2.52);
    wallK.build(group);
    // the shelving is solid for walkers
    if (CBZ.colliders) {
      const a = wallK.world(-runW / 2, 0), c = wallK.world(runW / 2, 0.46);
      CBZ.colliders.push({ minX: Math.min(a.x, c.x), maxX: Math.max(a.x, c.x), minZ: Math.min(a.z, c.z), maxZ: Math.max(a.z, c.z), y0: 0, y1: FY + 2.1 });
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    }
    if (CBZ.interiorTrackFixture) CBZ.interiorTrackFixture("pawn-shop", b, group);
  }

  // Open shelving: steel angle uprights, five oak boards with a white price
  // channel, an X brace at the back; each board stocked from a real pawn
  // inventory. Frame: +X along the wall, +Z out of the wall, y absolute.
  const DEPTH = 0.44;
  const BOARDS = [0.12, 0.58, 1.04, 1.5, 1.94];
  function buildShelving(k, runW, bays, FY, R) {
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
    // what's on the boards, bay by bay
    // (tall things — the TV — only on the top board, and never under the
    //  neon sign in the middle of the run)
    const PLAN = [
      [toolbox, amp, drill, laptops, tv],
      [amp, boombox, phones, camera, boxes],
      [toolbox, speakers, laptops, boxes, tv],
      [boxes, drill, phones, camera, tv],
    ];
    for (let i = 0; i < bays; i++) {
      const x0 = -runW / 2 + i * 1.2 + 0.6;
      const row = PLAN[i % PLAN.length];
      for (let j = 0; j < BOARDS.length; j++) {
        let fn = row[j];
        if (fn === tv && Math.abs(x0) < 0.55) fn = boxes;
        fn(k, x0 + (R() - 0.5) * 0.1, FY + BOARDS[j] + 0.011, R);
      }
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
    k.box(x - 0.12, y + 0.035, 0.2, 0.07, 0.07, 0.1, 0x1b1b1d);                         // battery
    k.box(x - 0.12, y + 0.12, 0.2, 0.04, 0.11, 0.05, col, "solid", 0, 0, -0.18);        // handle
    k.cyl(x - 0.09, y + 0.2, 0.2, 0.034, 0.034, 0.16, col, "solid", 0, 0, Math.PI / 2); // motor housing
    k.cyl(x + 0.02, y + 0.2, 0.2, 0.018, 0.022, 0.05, 0x2a2a2a, "metal", 0, 0, Math.PI / 2);
    k.cyl(x + 0.06, y + 0.2, 0.2, 0.004, 0.004, 0.06, 0xb8bcc0, "metal", 0, 0, Math.PI / 2);
    // and a boxed circular saw beside it
    k.box(x + 0.22, y + 0.13, 0.22, 0.3, 0.26, 0.28, 0x2a5aa8);
    k.box(x + 0.22, y + 0.13, 0.3605, 0.2, 0.12, 0.002, 0xf2f0ea);
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
    k.box(x - 0.2, y + 0.045, 0.2, 0.14, 0.09, 0.07, 0x1b1b1d);
    k.cyl(x - 0.2, y + 0.045, 0.26, 0.034, 0.036, 0.07, 0x222326, "metal", Math.PI / 2, 0, 0, 18);
    k.box(x - 0.24, y + 0.1, 0.2, 0.04, 0.02, 0.04, 0x2a2b2e);
    // and a game console, flat, with its pad
    k.box(x + 0.12, y + 0.035, 0.2, 0.3, 0.07, 0.24, 0x16171a, "gloss");
    k.box(x + 0.12, y + 0.036, 0.3215, 0.26, 0.004, 0.002, 0x3c7cd0, "solid");
    k.box(x + 0.34, y + 0.018, 0.25, 0.12, 0.035, 0.07, 0x1b1b1d);
  }
  function laptops(k, x, y) {
    if (!CBZ.itemAsset) return boxes(k, x, y);
    const a = CBZ.itemAsset("Laptop"), b2 = CBZ.itemAsset("Laptop");
    if (a) k.absorb(a, x - 0.2, y, 0.22, 0, Math.PI, 0);
    if (b2) k.absorb(b2, x + 0.2, y, 0.22, 0, Math.PI + 0.2, 0);
  }
  function phones(k, x, y) {
    // three phones propped on a little acrylic stand
    k.box(x, y + 0.004, 0.24, 0.5, 0.008, 0.12, 0xdfe8ec, "glass");
    if (!CBZ.itemAsset) return;
    for (let i = 0; i < 3; i++) {
      const p = CBZ.itemAsset("Phone");
      if (p) k.absorb(p, x - 0.16 + i * 0.16, y + 0.06, 0.26, -1.15, 0, 0);
      k.box(x - 0.16 + i * 0.16, y + 0.02, 0.3, 0.07, 0.03, 0.01, 0xdfe8ec, "glass");
    }
  }
  function boxes(k, x, y, R) {
    const cols = [0x2a5aa8, 0xc23a36, 0x3a7a4a, 0x1b1b1d, 0xe0b020];
    let cx = x - 0.5;
    for (let i = 0; i < 4 && cx < x + 0.4; i++) {
      const w = 0.18 + ((i * 37) % 7) * 0.02, h = 0.14 + ((i * 13) % 5) * 0.03;
      k.box(cx + w / 2, y + h / 2, 0.2, w, h, 0.28, 0xb08a55);
      k.box(cx + w / 2, y + h * 0.55, 0.3405, w * 0.8, h * 0.5, 0.002, cols[i % cols.length]);
      cx += w + 0.04;
    }
  }

  // A guitar hung flat on the wall by its headstock from a wall yoke. Built
  // from bouts (two flattened discs), a waist, a neck with a fretboard, an
  // angled headstock with six tuners, six strings, and either a sound hole
  // and bridge (acoustic) or pickups, knobs and a pickguard (electric).
  function buildGuitar(k, x, FY, acoustic) {
    const hookY = FY + 1.95;
    const col = acoustic ? 0xc8955a : 0xa02a2a, dark = 0x2b1d14;
    const th = acoustic ? 0.1 : 0.045;
    // the body hangs 2 cm off the wall; its face sets the neck's plane
    const bz = 0.02 + th / 2, face = bz + th / 2, Z = face - 0.012;
    // wall yoke: plate, arm out to the neck, two padded prongs either side of it
    k.box(x, hookY, 0.01, 0.06, 0.08, 0.02, 0x2a2d31, "metal");
    k.cyl(x, hookY - 0.012, (Z + 0.012) / 2, 0.007, 0.007, Z + 0.012, 0x2a2d31, "metal", Math.PI / 2);
    for (const sx of [-1, 1]) k.cyl(x + sx * 0.034, hookY + 0.008, Z + 0.004, 0.006, 0.006, 0.04, 0x1b1b1d, "solid");
    // headstock above the yoke, neck below it
    k.box(x, hookY + 0.09, Z - 0.005, 0.085, 0.19, 0.016, dark, "gloss");
    for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) k.cyl(x + sx * 0.05, hookY + 0.04 + i * 0.05, Z - 0.005, 0.006, 0.006, 0.02, 0xc0c5ca, "metal", 0, 0, Math.PI / 2);
    const neckTop = hookY - 0.005, neckLen = 0.48;
    k.box(x, neckTop - neckLen / 2, Z - 0.004, 0.05, neckLen, 0.02, acoustic ? 0x9a6a3a : 0x6b4a2a);
    k.box(x, neckTop - neckLen / 2, Z + 0.008, 0.048, neckLen, 0.004, 0x1c1410);          // fretboard
    for (let i = 1; i < 12; i++) k.box(x, neckTop - i * 0.036, Z + 0.0105, 0.048, 0.002, 0.001, 0xc0c5ca, "metal");
    // the body: upper and lower bouts, their centres below the neck
    const bodyTop = neckTop - neckLen + 0.02;
    const ub = acoustic ? 0.14 : 0.13, lb = acoustic ? 0.19 : 0.165;
    const ubY = bodyTop - ub * 0.8, lbY = ubY - (acoustic ? 0.2 : 0.17);
    k.cyl(x, ubY, bz, ub, ub, th, col, "gloss", Math.PI / 2, 0, 0, 28);
    k.cyl(x, lbY, bz, lb, lb, th, col, "gloss", Math.PI / 2, 0, 0, 28);
    k.box(x, (ubY + lbY) / 2, bz, ub * 1.55, (ubY - lbY), th, col, "gloss");
    if (acoustic) {
      k.cyl(x, ubY - 0.03, face + 0.0005, 0.045, 0.045, 0.002, 0x120c08, "solid", Math.PI / 2, 0, 0, 20);
      k.torus(x, ubY - 0.03, face + 0.001, 0.052, 0.003, 0x3a2414, "solid", 0, 0, 0, null, 24);
      k.box(x, lbY - 0.03, face + 0.004, 0.14, 0.025, 0.008, 0x2b1d14);                // bridge
    } else {
      k.box(x + 0.035, lbY + 0.02, face + 0.001, 0.2, 0.26, 0.002, 0xeeeae0, "solid", 0, 0, 0.3);   // pickguard
      for (const py of [ubY - 0.02, lbY + 0.06]) k.box(x, py, face + 0.006, 0.075, 0.03, 0.01, 0x111111);
      k.box(x, lbY - 0.06, face + 0.005, 0.08, 0.02, 0.01, 0xc0c5ca, "metal");         // bridge
      for (let i = 0; i < 3; i++) k.cyl(x + 0.1 - i * 0.012, lbY - 0.05 - i * 0.04, face + 0.008, 0.011, 0.011, 0.016, 0x1a1a1a, "solid", Math.PI / 2, 0, 0, 12);
    }
    // six strings from the nut to the bridge
    const sTop = neckTop, sBot = acoustic ? lbY - 0.03 : lbY - 0.06;
    for (let i = 0; i < 6; i++) k.box(x - 0.018 + i * 0.0072, (sTop + sBot) / 2, Z + 0.013, 0.0011, sTop - sBot, 0.0011, 0xd8dade, "metal");
  }

  // An orange neon dollar sign on a black backing board: two open loops and
  // a bar, bent glass tube, lit (a lit sign glows; nothing else here does).
  function buildNeon(k, x, y) {
    k.box(x, y, 0.012, 0.36, 0.4, 0.02, 0x0c0c0e, "gloss");
    const r = 0.06, t = 0.008, z = 0.04, NEON = 0xffa43a;
    // upper loop (its opening to the lower right), lower loop (opening to the upper left)
    k.torus(x, y + r, z, r, t, NEON, "glow", 0, 0, Math.PI * 0.2, Math.PI * 1.3, 24);
    k.torus(x, y - r, z, r, t, NEON, "glow", 0, 0, -Math.PI * 0.8, Math.PI * 1.3, 24);
    k.cyl(x, y, z, t, t, 0.32, NEON, "glow", 0, 0, 0, 8);
    for (const sy of [-1, 1]) k.cyl(x, y + sy * 0.172, 0.026, 0.006, 0.006, 0.03, 0x9aa0a6, "metal", Math.PI / 2, 0, 0, 8);   // standoffs
  }

  // ============================================================
  //  THE FENCE — outright sale at a HAIRCUT (less than jeweller retail)
  // ------------------------------------------------------------
  //  Same sellable set the text-menu pawn used (valuables + jewelry wearables),
  //  but the price is the pawnbroker's lowball: 40–55% of clean value (luxe
  //  pieces a touch fatter — a broker who can move a Patek takes a thinner cut),
  //  nudged up a little by your fence rep. Always LESS than the jeweller's 0.6
  //  retail fence, so "sell the sick watch you bought" is a real, felt loss.
  // ============================================================
  function isWorn(name) { const e = econ(); return !!(e && e.isEquipped && e.isEquipped(name)); }
  function sellable() {
    const e = econ(), inv = (g && g.cityInv) || {}, out = [];
    for (const k in inv) {
      const it = e && e.ITEMS[k]; if (!it || (inv[k] | 0) <= 0) continue;
      // a pawn shop fences VALUABLES + the legacy jewelry/streetwear "wearable"
      // pieces (the new tag:"clothing"/"jewelry" composables are the boutique's
      // / jeweller's beat). Mirrors shops.js sellable(kind==="pawn").
      if (it.tag === "valuable" || it.tag === "wearable" || it.tag === "jewelry") out.push({ name: k, n: inv[k] | 0, it });
    }
    out.sort((a, b) => fencePrice(b.name) - fencePrice(a.name));   // priciest first (walk the pile down)
    return out;
  }
  // The outright fence quote for one unit. Built locally (NOT econ.sellPrice, so
  // the pawn haircut stays strictly below the jeweller's retail multiplier).
  function fencePrice(name) {
    const e = econ(), it = e && e.ITEMS[name]; if (!it) return 0;
    let mul = it.tag === "valuable" ? SELL_HI : SELL_LO;     // valuables fence a bit better than worn drip
    if (it.luxe) mul = 0.62;                                  // a broker who moves seven figures takes a thinner cut
    const rep = (e.fenceBonus && e.fenceBonus()) || 0;        // your rep shaves the haircut (shared faucet)
    mul = Math.min(it.luxe ? 0.7 : 0.6, mul + rep);           // capped UNDER the jeweller's clean-ish payout
    return Math.max(1, Math.round(it.value * mul));
  }
  function sellOne(name) {
    const e = econ(); if (!e || !CBZ.city) return;
    let n = e.count ? e.count(name) : 0; if (n <= 0) return;
    if (isWorn(name) && n <= 1) { note("That's the only one, and you're wearing it. Take it off first.", 2); return; }
    const p = fencePrice(name);
    if (!e.take(name, 1)) return;
    CBZ.city.addCash(p);
    if (e.bumpFenceRep) e.bumpFenceRep(1);
    if (CBZ.sfx) CBZ.sfx("coin");
    if (p >= 50000 && CBZ.city.big) CBZ.city.big("PAWNED " + name + " for " + fmt$(p) + "!");
    else note("Fenced the " + name + " for " + fmt$(p) + ". (Pawn pays the lowball, that's the price of fast cash.)", 2.2);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
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
  //      the server — one collector, no new store. WHY THIS IS LOAD-BEARING:
  //      pawnLoan() already e.take()'d the collateral OUT of g.cityInv (which IS
  //      saved), so without persisting the redeem TICKET a reload / MP-adopt
  //      loses BOTH the item AND the way to get it back — permanent, with the
  //      cash already spent. Expires are absolute (now()-based) so they survive
  //      serialization; the forfeit countdown is honored across a reload.
  //
  //      STAMP BEFORE COMMIT: worldstate's commit() calls save() internally, so
  //      the tickets must be on the live ledger (g.cityWorld) BEFORE the inner
  //      commit runs — we stamp first, then delegate, so the very same save()
  //      that writes cash/bank/inventory also writes the tickets.
  function stampTickets() {
    const led = g.cityWorld;
    if (led && typeof led === "object") led.cityPawnTickets = (g.cityPawnTickets || []).map((t) => Object.assign({}, t));
  }
  // Idempotent lazy wraps (the outfits.js pattern): worldstate.js may load after
  // us. cityWorldCommit (local save) AND cityWorldCollect (the MP/persistence
  // collector) both point at the same inner commit — wrap BOTH so localStorage
  // and the server blob carry the tickets.
  let _ensurePawnSaveWraps_done = false;
  function ensurePawnSaveWraps() {
    // ONE-SHOT INSTALL (chain-growth fix): the old guard checked the
    // module flag on the CURRENT top-of-chain function, so once any
    // later module wrapped above us the flag vanished from the top and
    // we re-wrapped EVERY tick - ~20 such modules made the commit chain
    // grow unboundedly (stack overflow on save; found by the P5 full-
    // stack harness). A module-local boolean wraps exactly once, ever.
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
  // RESTORE side: worldstate.js's beginRun/adopt populate g.cityWorld BEFORE our
  // first city tick (and it loads after us, so a load-time begin-run wrap would
  // miss the very first entry). Instead hydrate from the live ledger whenever
  // its object REFERENCE changes — covers fresh load, respawn, AND a multiplayer
  // adopt (cityWorldAdopt swaps the whole g.cityWorld object).
  let _hydratedLedger = null;
  function hydratePawnFromLedger() {
    const led = g.cityWorld;
    if (!led || led === _hydratedLedger) return;
    _hydratedLedger = led;
    if (Array.isArray(led.cityPawnTickets)) g.cityPawnTickets = led.cityPawnTickets.map((t) => Object.assign({}, t));
  }
  // a sane per-unit clean value for an item (drives the advance).
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
    if (!it || (it.tag !== "valuable" && it.tag !== "wearable" && it.tag !== "jewelry")) { note("The broker only lends against jewellery, watches and valuables.", 2); return null; }
    if ((e.count ? e.count(name) : 0) <= 0) { note("You're not carrying that to pawn.", 1.6); return null; }
    if (isWorn(name) && e.count(name) <= 1) { note("Take it off before you pawn it.", 1.8); return null; }
    const o = loanOffer(name);
    if (!(o.principal > 0) || !isFinite(o.principal)) return null;
    if (!e.take(name, 1)) return null;                         // collateral leaves your pockets, into the cage
    CBZ.city.addCash(o.principal);
    const id = "pawn-" + Math.floor(now() * 1000) + "-" + (tickets().length);
    const t = { id, name, principal: o.principal, fee: o.fee, redeem: o.redeem, born: now(), expires: now() + o.term, forfeit: false };
    tickets().push(t);
    if (CBZ.sfx) CBZ.sfx("coin");
    note("Pawned the " + name + " for " + fmt$(o.principal) + ". Redeem for " + fmt$(o.redeem) + " within " + Math.round(o.term) + "s, or it's forfeit.", 3);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    if (CBZ.cityWorldCommit) CBZ.cityWorldCommit();
    return id;
  }
  // live (un-forfeited) tickets, soonest-to-expire first.
  function liveTickets() {
    return tickets().filter((t) => t && !t.forfeit).sort((a, b) => a.expires - b.expires);
  }
  // returns TRUE only when the item actually came back to the player; FALSE on
  // every no-op branch (bad/forfeited ticket, expired→forfeit, can't afford, or
  // the spend failing) so CBZ.cityPawnRedeem can't report a success that didn't
  // happen — the in-world [E] flow ignores the bool (it reads the surfaced note).
  function redeemTicket(t) {
    const e = econ(); if (!e || !CBZ.city || !t || t.forfeit) return false;
    if (now() >= t.expires) { forfeit(t); return false; }      // too late — the broker already pulled it
    if (!CBZ.city.canAfford(t.redeem)) { note("Redeeming the " + t.name + " costs " + fmt$(t.redeem) + ", come back with it.", 2.2); return false; }
    if (!CBZ.city.spend(t.redeem)) return false;
    e.add(t.name, 1);                                          // your item, back in your pocket
    t.forfeit = true; t.redeemed = true;                       // close the ticket
    pruneTickets();
    if (CBZ.sfx) CBZ.sfx("coin");
    note("Redeemed the " + t.name + " for " + fmt$(t.redeem) + ", it's yours again.", 2.4);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    if (CBZ.cityWorldCommit) CBZ.cityWorldCommit();
    return true;
  }
  function forfeit(t) {
    if (!t || t.forfeit) return;
    t.forfeit = true;                                          // the broker keeps the collateral
    const P = CBZ.player;
    if (P && CBZ.city && Math.hypot(P.pos.x - S.cx, P.pos.z - S.cz) < 60)
      note("The " + t.name + " ticket lapsed, forfeited to the broker.", 2.4);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  // drop redeemed/forfeited tickets older than a grace window so the array
  // can't grow without bound across a long run (MP-safe: pure state on g.*).
  function pruneTickets() {
    const arr = tickets(), keep = [];
    for (const t of arr) {
      if (!t) continue;
      if (t.redeemed) continue;                                   // a redeemed ticket is closed — drop it now
      if (t.forfeit && (now() - (t.expires || 0)) > 30) continue; // lapsed tickets linger briefly for the HUD, then go
      keep.push(t);
    }
    g.cityPawnTickets = keep;
  }

  // ---- THE DESKS ARE CANDIDATES (city/interactions.js registerFixtures) -----
  // The sell desk and the loan desk are things in the registry: E does the
  // obvious deal on the desk you look at, Q / a tap shows the rest (sell
  // everything, each ticket you can redeem). The old [G] sell-all and the [F]
  // ticket cycle were private keys on a private prompt; they are verbs now.
  function inStore(px, pz) {
    const b = S.b;
    if (!b || !S.lot) return false;
    const ox = (b.ox != null ? b.ox : S.lot.cx), oz = (b.oz != null ? b.oz : S.lot.cz);
    return Math.abs(px - ox) < (b.w || 10) / 2 + 1.5 && Math.abs(pz - oz) < (b.d || 10) / 2 + 1.5;
  }
  function sellAll() {
    const list = sellable();
    for (const s of list) for (let i = 0; i < s.n; i++) { if (isWorn(s.name) && (econ().count(s.name) <= 1)) break; sellOne(s.name); }
  }
  function sellAllTotal() { let t = 0; for (const s of sellable()) t += fencePrice(s.name) * s.n; return t; }
  function redeemVerb(i) {
    return {
      id: "pawn-redeem-" + i, slot: "e", prio: 4 - i * 0.1,
      label: () => { const t = liveTickets()[i]; return t ? "Redeem " + t.name + " " + fmt$(t.redeem) : "Redeem"; },
      canShow: (d) => d.mode === "loan" && liveTickets().length > i,
      onSelect: () => { const t = liveTickets()[i]; if (t) redeemTicket(t); },
    };
  }
  let fixturesWired = false;
  function wireFixtures() {
    if (fixturesWired || !CBZ.interactions || !CBZ.interactions.registerFixtures) return;
    fixturesWired = true;
    CBZ.interactions.registerFixtures({
      id: "pawn-desk", kind: "pawn-desk", prio: 9,
      list: function (ctx, px, pz) { return S.built && S.near && inStore(px, pz) ? [S.sellDesk, S.loanDesk] : null; },
      reach: function () { return REACH; },
      dot: function () { return LOOK_DOT; },
      verbs: [
        { id: "pawn-sell", slot: "e", prio: 6, forceYes: true,
          label: () => { const t = sellable()[0]; return t ? "Sell " + t.name + " " + fmt$(fencePrice(t.name)) : "Sell"; },
          canShow: (d) => d.mode === "sell" && sellable().length > 0,
          onSelect: () => { const t = sellable()[0]; if (t) sellOne(t.name); } },
        { id: "pawn-sell-all", prio: 5, forceYes: true, label: () => "Sell all " + fmt$(sellAllTotal()),
          canShow: (d) => d.mode === "sell" && sellable().length > 1, onSelect: sellAll },
        { id: "pawn-loan", slot: "e", prio: 6, forceYes: true,
          label: () => { const t = sellable()[0]; return t ? "Pawn " + t.name + " " + fmt$(loanOffer(t.name).principal) : "Pawn"; },
          canShow: (d) => d.mode === "loan" && sellable().length > 0,
          onSelect: () => { const t = sellable()[0]; if (t) pawnLoan(t.name); } },
        redeemVerb(0), redeemVerb(1), redeemVerb(2),
      ],
    });
  }

  // ---- find the lot + build once (self-healing, gunstore pattern) ------------
  function ensure() {
    const arena = CBZ.city && CBZ.city.arena;
    if (S.built) {
      if (S.arena === arena) return true;
      S.built = false; S.group = null; S.lot = null; S.b = null; S.near = false; S.sellDesk = null; S.loanDesk = null;
    }
    if (!arena || !econ()) return false;
    if (S.noLotArena === arena) return false;          // this city has no pawn lot — answered once
    let lot = arena.pawnLot || null;
    if (!(lot && lot.building && lot.building.shop && lot.building.shop.kind === "pawn")) {
      lot = null;
      const lots = (CBZ.city && CBZ.city.shopLots) || arena.lots || [];
      for (let i = 0; i < lots.length; i++) {
        const L = lots[i];
        if (L && L.building && L.building.shop && L.building.shop.kind === "pawn") { lot = L; break; }
      }
      if (!lot && lots.length) { S.noLotArena = arena; return false; }
    }
    if (!lot) return false;
    S.lot = lot; S.b = lot.building; S.arena = arena;
    buildDisplays();
    S.built = true;
    return true;
  }

  // ---- per-frame --------------------------------------------------------------
  CBZ.onUpdate(39, function (dt) {
    // persistence wrap+hydrate run EVERY frame, regardless of mode: the whole
    // module is THREE-guarded (no separate headless onUpdate possible here), and
    // the mode-guard return below would otherwise skip them — but the ledger can
    // be swapped (load/respawn/MP-adopt) while we're outside the city too.
    ensurePawnSaveWraps();
    hydratePawnFromLedger();
    if (!g || g.mode !== "city") { if (S.group && S.group.visible) S.group.visible = false; S.near = false; return; }
    if (!ensure()) return;
    wireFixtures();

    // tickets count down in real seconds; lapse → forfeit (broker keeps it).
    const arr = tickets();
    if (arr.length) {
      const t0 = now();
      for (const t of arr) if (t && !t.forfeit && t0 >= t.expires) forfeit(t);
      pruneTickets();
    }

    const P = CBZ.player;
    const dx = P.pos.x - S.cx, dz = P.pos.z - S.cz;
    const near = (dx * dx + dz * dz) < VIS_R * VIS_R;
    if (S.group && S.group.visible !== near) S.group.visible = near;
    S.near = near;
  });

  // ---- public hooks (contracts E + F; gunstore/jewelry-style) ----------------
  // is the pawn desk live (for this lot)? interact.js trims the generic "Shop
  // here" verb when true, so the in-world desks are the way to fence/pawn here.
  CBZ.cityPawnLive = function (lot) { return !!(S.built && S.lot && (!lot || lot === S.lot)); };
  // the canonical collateral-loan engine (contract [E]). NAME or {name} record.
  CBZ.cityPawnLoan = function (item) { if (!ensure()) { /* still allow a pure-state loan in headless tests */ } return pawnLoan(item); };
  // headless/harness handles, mirroring cityGunstoreBuy / cityJewelryScoop.
  CBZ.cityPawnLot = function () { return (S.built && S.lot) || null; };
  CBZ.cityPawnSell = function (name) { if (!ensure()) return false; const e = econ(); if (!e || (e.count ? e.count(name) : 0) <= 0) return false; sellOne(name); return true; };
  CBZ.cityPawnRedeem = function (id) {
    const t = tickets().find((x) => x && x.id === id && !x.forfeit);
    if (!t) return false; return redeemTicket(t);   // propagate the REAL result (don't lie on a no-op)
  };
  CBZ.cityPawnFenceQuote = function (name) { return fencePrice(name); };
  CBZ.cityPawnState = function () {
    return {
      live: !!S.built,
      sellable: sellable().map((s) => ({ name: s.name, n: s.n, fence: fencePrice(s.name) })),
      tickets: liveTickets().map((t) => ({ id: t.id, name: t.name, principal: t.principal, redeem: t.redeem, left: Math.max(0, Math.round(t.expires - now())) })),
    };
  };
})();
