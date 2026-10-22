/* ============================================================
   world/island_homes.js — THE FLATS OVER THE SHOPS.

   An island's tall shops (b.use "apartments": world/island_plan.js) are
   flats over a shop. Every floor above the shop is a flat now: a wall
   along the stairwell with the flat's own front door in it where the stair
   lands, and inside a home: a living room with a sofa facing the TV and a
   coffee table, a kitchen along the wall (the counter run, the fridge, the
   cooker) with a table for two, the bedroom at the far end with a double
   bed, its nightstands and a wardrobe, a bathroom behind its own door.

   ONE OF THEM IS TO LET (the top floor). The letting board stands by the
   building's street door:
     [E] Rent $N/wk   the decision: a week's rent out of your cash; it comes
                      out again every week (seven of the game's days) while
                      you can pay, and when you cannot, the door is shut on
                      you (what you stashed is kept for you).
     [I] Buy $N       it is yours for good.
   YOUR FLAT: its door opens for you as you come up to it and nobody else
   (every other flat's door is locked); its bed is yours (a night in it is a
   night in your own bed: world/island_lodging.js reads bed.isMine); the
   wardrobe is your stash:
     [E] Stash $N / [I] Take $N   your cash
     [J] Stash guns / [K] Take guns   every gun you carry, and back
   g.isleHomes = { "<island>:<lot>": { mode: "rent"|"own", paidTo (pace
     days), rent, stash: { cash, guns: [] } } }
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  if (!window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game || (CBZ.game = {});

  const flats = [];            // the let flat of every apartments building standing
  function live() { return !!(g && g.mode === "archipelago"); }
  // the island build's slice clock (world/disaster_arena.js): the fit-out
  // yields there, a room or a floor a step
  function late() { return !!(CBZ.sliceLate && CBZ.sliceLate()); }
  function homes() { return g.isleHomes || (g.isleHomes = {}); }
  function islandId(b) { const I = CBZ.islandVenue && CBZ.islandVenue.island(b); return (I && I.arena && I.arena.id) || "isle"; }
  function fmt(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
  function pace() { return CBZ.paceTime ? CBZ.paceTime() : 0; }
  function mine(F) { const r = homes()[F.key]; return !!(r && (r.mode === "own" || r.mode === "rent")); }
  /* A FLAT THE SHARK TOOK (city/islandmoney.js: r.seized, r.seizedDay) is off
     the market for a few days, and never yours again while you still owe him. */
  const SEIZED_DAYS = 3;
  function offMarket(F) {
    const r = homes()[F.key];
    if (!r || !r.seized) return false;
    const day = CBZ.dayCount ? CBZ.dayCount() : 0;
    if (day - (+r.seizedDay || 0) < SEIZED_DAYS) return true;
    return !!(CBZ.loanShark && CBZ.loanShark.owed && CBZ.loanShark.owed() > 0);
  }
  function landingOf(b, k) {
    const IB = CBZ.islandBuilding;
    if (!IB || !IB.plan) return null;
    let P = null;
    try { P = IB.plan({ w: b.lw, d: b.ld, storeys: b.storeys }); } catch (e) { P = null; }
    return P && P.landingAt ? P.landingAt(k) : null;
  }

  /* ---- ONE FLAT on storey k of b ------------------------------------------ */
  const WALLC = [0xe7e1d6, 0xdfe4e2, 0xeee3cf, 0xe3dbe6];
  function* flat(b, k, K, let_) {
    const IV = CBZ.islandVenue, FIT = CBZ.islandFit;
    const F = IV.floor(b, k), I = b.interior || {};
    let sx = F.local.x0;
    for (const r of I.keepOut || []) if (r.why === "stairs") sx = Math.max(sx, r.x1 - 0.35);
    const lg = landingOf(b, k);
    if (!lg) return null;
    const y = F.yLocal + 0.015;
    const H = (I.fyOf ? I.fyOf[1] : 3.4) - 0.25;
    const PX = sx + 0.2;                                   // the flat's front wall, along the stairwell
    const xa = PX + 0.12, xb = F.local.x1, za = F.local.z0, zb = F.local.z1;
    if (xb - xa < 5 || zb - za < 7) return null;
    const front = (lg.z0 + lg.z1) / 2 < 0;                 // the stair lands at the front: the door end
    const s = front ? 1 : -1, zA = front ? za : zb, zB = front ? zb : za;
    const WC = WALLC[(CBZ.islandFit.hash(b.planId + ":" + k) * WALLC.length) | 0];
    // THE FRONT WALL with the door in it, where the landing is
    const dz0 = Math.max(za + 0.2, Math.min(zb - 1.2, (lg.z0 + lg.z1) / 2 - 0.5)), dz1 = dz0 + 1.0;
    K.lbox(PX, y + H / 2, (za + dz0) / 2, 0.12, H, dz0 - za, WC, { solid: true });
    K.lbox(PX, y + H / 2, (dz1 + zb) / 2, 0.12, H, zb - dz1, WC, { solid: true });
    K.lbox(PX, y + 2.1 + (H - 2.1) / 2, (dz0 + dz1) / 2, 0.12, H - 2.1, 1.0, WC);
    K.lbox(PX - 0.07, y + 2.13, (dz0 + dz1) / 2, 0.03, 0.08, 1.14, 0x6e6a64);
    K.lbox(PX - 0.07, y + 1.05, dz0 - 0.04, 0.03, 2.1, 0.08, 0x6e6a64);
    K.lbox(PX - 0.07, y + 1.05, dz1 + 0.04, 0.03, 2.1, 0.08, 0x6e6a64);
    const doorC = let_ ? 0x2c4a6e : 0x5a3f2c;
    let door = null;
    if (let_) {
      // the let flat's door: a leaf on its hinge (it opens for whoever's flat it is)
      const mat = new THREE.MeshLambertMaterial({ color: doorC });
      mat.name = "island-flat-door";
      if (CBZ.islandRoomLight) CBZ.islandRoomLight(mat, false);
      const pivot = new THREE.Group();
      pivot.position.set(PX, y, dz0);
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.08, 0.98), mat);
      leaf.position.set(0, 1.04, 0.49);
      leaf.castShadow = true; leaf.receiveShadow = true;
      pivot.add(leaf);
      const knob = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.08), new THREE.MeshLambertMaterial({ color: 0xb08d4a }));
      knob.position.set(-0.06, 1.0, 0.85);
      pivot.add(knob);
      b.group.add(pivot);
      (b.group.userData.rooms || (b.group.userData.rooms = [])).push(pivot);
      const col = K.lbox(PX, y + 1.05, (dz0 + dz1) / 2, 0.14, 2.1, 1.0, 0, { solid: true, noVis: true });
      const at = FIT.frame(b).w(PX - 0.6, (dz0 + dz1) / 2);
      door = { pivot: pivot, col: col, y0: col.y0, y1: col.y1, open: false, t: 0, at: { x: at.x, y: b.gy + y, z: at.z } };
    } else {
      K.lbox(PX, y + 1.04, (dz0 + dz1) / 2, 0.05, 2.08, 0.98, doorC, { solid: true });
      K.lbox(PX - 0.05, y + 1.0, dz1 - 0.15, 0.08, 0.04, 0.12, 0xb08d4a);
    }
    // the flat's number on the landing side
    K.lbox(PX - 0.07, y + 1.6, dz1 + 0.25, 0.02, 0.14, 0.2, 0xb08d4a);

    if (late()) yield 0;
    // THE BATHROOM: the far corner by the front wall, its door open
    const bz = zB - s * 2.2, bx = xa + 2.3;
    K.lbox(xa + 0.3 / 2, y + H / 2, bz, 0.3, H, 0.1, WC, { solid: true });
    K.lbox((xa + 1.1 + bx) / 2, y + H / 2, bz, bx - xa - 1.1, H, 0.1, WC, { solid: true });
    K.lbox(xa + 0.7, y + 2.1 + (H - 2.1) / 2, bz, 0.8, H - 2.1, 0.1, WC);
    K.lbox(bx, y + H / 2, (bz + zB) / 2, 0.1, H, Math.abs(zB - bz), WC, { solid: true });
    K.lbox(xa + 1.08, y + 1.02, bz + s * 0.4, 0.04, 2.0, 0.75, 0xd9d4ca);
    K.lbox((xa + bx) / 2, y + 0.006, (bz + zB) / 2, bx - xa, 0.012, Math.abs(zB - bz), 0xd9dcd8);
    K.lbox(bx - 0.35, y + 0.2, zB - s * 0.32, 0.38, 0.4, 0.5, 0xf2f2ef, { solid: true, noStep: true });
    K.lbox(bx - 0.35, y + 0.62, zB - s * 0.1, 0.42, 0.42, 0.16, 0xf2f2ef);
    K.lbox(xa + 0.5, y + 0.84, zB - s * 0.26, 0.5, 0.1, 0.42, 0xf2f2ef);
    K.lbox(xa + 0.5, y + 0.4, zB - s * 0.28, 0.16, 0.8, 0.16, 0xf2f2ef);
    K.lbox(xa + 0.5, y + 1.45, zB - s * 0.03, 0.55, 0.7, 0.02, 0xb9c4c9);
    K.lbox(xa + 1.4, y + 0.05, (bz + zB) / 2, 0.9, 0.1, 0.9, 0xeeeeea);

    if (late()) yield 0;
    // THE BEDROOM at the far end: the bed's head to the end wall
    const bcx = (bx + 0.2 + xb) / 2, bcz = zB - s * 1.12;
    const bedR = K.furnish("bed", bcx, bcz, y, s > 0 ? 0 : Math.PI, { len: 2.1, wide: 1.6, tone: "auto" });
    for (const sd of [-1, 1]) {
      const nx = bcx + sd * 1.15;
      if (nx - 0.22 < bx + 0.1 || nx + 0.22 > xb) continue;
      K.lbox(nx, y + 0.27, zB - s * 0.3, 0.44, 0.54, 0.4, 0x4a3324, { solid: true, noStep: true });
      K.lbox(nx, y + 0.72, zB - s * 0.3, 0.03, 0.3, 0.03, 0x3a3a3a);
      K.lbox(nx, y + 0.92, zB - s * 0.3, 0.24, 0.2, 0.24, 0xf3dcae, { glow: true });
    }
    // the wardrobe (the stash) on the outside wall
    const wz = zB - s * 3.0;
    K.furnish("wardrobe", xb - 0.32, wz, y, -Math.PI / 2, { len: 1.4, tone: "auto" });

    if (late()) yield 0;
    // THE LIVING ROOM: the sofa facing the TV on the front wall
    const mz = (zA + zB) / 2 + s * 0.4;
    K.furnish("sofa", xa + 3.3, mz, y, -Math.PI / 2, { len: 2.2, tone: "auto" });
    K.furnish("coffee", xa + 2.2, mz, y, 0, { tone: "auto" });
    K.lbox(xa + 0.3, y + 0.25, mz, 0.45, 0.5, 1.5, 0x3b2c22, { solid: true, noStep: true });
    K.lbox(xa + 0.13, y + 1.2, mz, 0.05, 0.66, 1.15, 0x0e1013);
    K.lbox((xa + xa + 4.2) / 2, y + 0.005, mz, 3.4, 0.01, 2.4, 0x7a5a4a);

    if (late()) yield 0;
    // THE KITCHEN along the outside wall at the door end
    const kz = zA + s * 1.9;
    K.furnish("counter", xb - 0.4, kz, y, -Math.PI / 2, { len: 2.4, deep: 0.65 });
    K.lbox(xb - 0.38, y + 0.9, zA + s * 0.45, 0.7, 1.8, 0.7, 0xe9eaea, { solid: true });
    K.lbox(xb - 0.75, y + 1.0, zA + s * 0.45, 0.02, 0.5, 0.02, 0x9a9c98);
    K.lbox(xb - 0.38, y + 0.46, kz + s * 1.65, 0.62, 0.92, 0.62, 0x2a2c2e, { solid: true, noStep: true });
    for (const q of [[-0.14, -0.14], [0.14, 0.14], [-0.14, 0.14], [0.14, -0.14]]) K.lbox(xb - 0.38 + q[0], y + 0.925, kz + s * 1.65 + q[1], 0.18, 0.01, 0.18, 0x111111);
    K.lbox(xb - 0.06, y + 1.6, kz, 0.3, 0.6, 2.4, 0xe9e4d8);
    K.furnish("table", xa + 4.6 > xb - 1.6 ? (xa + xb) / 2 : xb - 2.1, zA + s * 2.2, y, 0, { len: 0.9, deep: 0.75, seats: 2, tone: "auto" });
    // the lights
    K.lbox((xa + xb) / 2, y + H - 0.03, mz, 0.5, 0.04, 0.5, 0xf6efe0, { glow: true });
    K.lbox(bcx, y + H - 0.03, bcz - s * 0.6, 0.4, 0.04, 0.4, 0xf6efe0, { glow: true });

    const fr = FIT.frame(b);
    const beds = bedR && bedR.beds ? bedR.beds.slice() : [];
    const st = fr.w(xb - 0.32, wz);
    const box = (function () { const a = fr.w(xa, za), c = fr.w(xb, zb); return { minX: Math.min(a.x, c.x), maxX: Math.max(a.x, c.x), minZ: Math.min(a.z, c.z), maxZ: Math.max(a.z, c.z), y0: b.gy + y - 0.3, y1: b.gy + y + H }; })();
    return { k: k, beds: beds, door: door, stash: { x: st.x, y: b.gy + y, z: st.z }, box: box, y: b.gy + y };
  }

  /* ---- THE BUILDING ---------------------------------------------------- */
  function* fitFlats(b, lot, job) {
    const IV = CBZ.islandVenue, FIT = CBZ.islandFit;
    if (!IV || !FIT || !b.interior || (b.storeys | 0) < 2) return null;
    const K = FIT.kit(b, { name: "flats" });
    const top = (b.storeys | 0) - 1;
    let L = null;
    for (let k = 1; k <= top; k++) {
      if (late()) yield 0;
      IV.clear(b, k);
      const f = yield* flat(b, k, K, k === top);
      if (f && k === top) L = f;
    }
    if (!L) { yield* K.flushSteps(); return null; }
    const key = islandId(b) + ":" + (b.planId != null ? b.planId : (Math.round(b.ox) + "," + Math.round(b.oz)));
    const storeys = b.storeys | 0;
    const F = { b: b, key: key, flat: L, rent: 50 * Math.round((150 + storeys * 20 + top * 15) / 50),
      price: 1000 * Math.round((16000 + storeys * 3500 + top * 2500) / 1000), board: null };
    for (const r of L.beds) { r.isMine = function () { return mine(F); }; r.home = b; }
    // THE LETTING BOARD on the front wall, beside the street door
    yield* K.flushSteps();
    const ld = b.ld || b.d, lw = b.lw || b.w;
    const bx = Math.min(lw / 2 - 0.5, 1.75), bz = -ld / 2 - 0.05;
    const tex = FIT.text(["TO LET", "FLAT " + (top + 1)], { bg: "#f4f1e8", fg: "#8a1d1d", w: 256, h: 160 });
    if (tex) FIT.panel(b, null, bx, 1.6, bz, 0.72, 0.45, Math.PI, tex, false);
    const bw = FIT.frame(b).w(bx, bz - 0.5);
    F.board = { x: bw.x, z: bw.z, y: b.gy, F: F };
    F.stashAt = { x: L.stash.x, z: L.stash.z, y: L.stash.y, F: F };
    flats.push(F);
    return function () {
      const i = flats.indexOf(F);
      if (i >= 0) flats.splice(i, 1);
    };
  }

  /* ---- RENT, BUY, THE DOOR, THE STASH -------------------------------------- */
  function rent(f) {
    const F = f && f.F;
    if (!F || mine(F) || offMarket(F)) return;
    if (!(CBZ.city && CBZ.city.spend && CBZ.city.spend(F.rent))) return;
    const H = homes();
    const r = H[F.key] || (H[F.key] = { stash: { cash: 0, guns: [] } });
    r.seized = false; r.seizedDay = null;
    r.mode = "rent"; r.rent = F.rent; r.paidTo = pace() + 7;
    if (CBZ.sfx) { try { CBZ.sfx("coin"); } catch (e) {} }
  }
  function buy(f) {
    const F = f && f.F;
    if (!F) return;
    const H = homes(), r0 = H[F.key];
    if ((r0 && r0.mode === "own") || offMarket(F)) return;
    if (!(CBZ.city && CBZ.city.spend && CBZ.city.spend(F.price))) return;
    const r = r0 || (H[F.key] = { stash: { cash: 0, guns: [] } });
    r.seized = false; r.seizedDay = null;
    r.mode = "own"; r.paidTo = Infinity;
    if (CBZ.sfx) { try { CBZ.sfx("coin"); } catch (e) {} }
  }
  function stashOf(F) { const r = homes()[F.key]; return r ? (r.stash || (r.stash = { cash: 0, guns: [] })) : null; }
  function putCash(f) {
    const S = stashOf(f.F), n = Math.floor(g.cash || 0);
    if (!S || n <= 0 || !(CBZ.city && CBZ.city.spend && CBZ.city.spend(n))) return;
    S.cash += n;
  }
  function takeCash(f) {
    const S = stashOf(f.F);
    if (!S || S.cash <= 0) return;
    const n = S.cash; S.cash = 0;
    if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(n); else g.cash = (g.cash || 0) + n;
  }
  function gunsOn() { return (CBZ.weaponInventory || []).filter(function (id) { return id && id !== "fists" && id !== "fist" && id !== "hands"; }); }
  function putGuns(f) {
    const S = stashOf(f.F);
    if (!S || !CBZ.lockWeapon) return;
    for (const id of gunsOn()) { if (CBZ.lockWeapon(id)) S.guns.push(id); }
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  function takeGuns(f) {
    const S = stashOf(f.F);
    if (!S || !S.guns.length || !CBZ.unlockWeapon) return;
    for (const id of S.guns) CBZ.unlockWeapon(id, { select: false });
    S.guns.length = 0;
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  function doorTick(F, dt) {
    const D = F.flat.door, P = CBZ.player;
    if (!D || !P || !P.pos) return;
    const near = Math.abs(P.pos.y - D.at.y) < 1.6 && Math.hypot(P.pos.x - D.at.x, P.pos.z - D.at.z) < 1.6;
    const inside = F.flat.box && P.pos.x > F.flat.box.minX && P.pos.x < F.flat.box.maxX && P.pos.z > F.flat.box.minZ && P.pos.z < F.flat.box.maxZ &&
      P.pos.y > F.flat.box.y0 && P.pos.y < F.flat.box.y1;
    const want = mine(F) && (near || (inside && Math.hypot(P.pos.x - D.at.x, P.pos.z - D.at.z) < 2.4));
    if (want !== D.open) {
      D.open = want;
      if (want) { D.col.y0 = -1e4; D.col.y1 = -1e4 + 0.01; } else { D.col.y0 = D.y0; D.col.y1 = D.y1; }
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    }
    const tw = D.open ? 1 : 0;
    if (D.t !== tw) {
      D.t = tw > D.t ? Math.min(1, D.t + dt * 2.6) : Math.max(0, D.t - dt * 2.6);
      const e = D.t * D.t * (3 - 2 * D.t);
      D.pivot.rotation.y = e * Math.PI * 0.5;
    }
  }
  // the weekly rent comes out while you can pay it
  function rentTick() {
    const H = homes(), now = pace();
    for (const k in H) {
      const r = H[k];
      if (!r || r.mode !== "rent" || !(now > r.paidTo)) continue;
      if (CBZ.city && CBZ.city.spend && CBZ.city.spend(r.rent || 200)) r.paidTo += 7;
      else r.mode = null;
    }
  }

  /* ---- THE CARD ------------------------------------------------------------ */
  function near(list, px, pz, py, r) {
    const out = [];
    for (const f of list) if (f && Math.abs(f.x - px) < r && Math.abs(f.z - pz) < r && Math.abs(f.y - py) < 1.8) out.push(f);
    return out;
  }
  if (CBZ.islandFit) {
    CBZ.islandFit.fixtures("flat-board", {
      prio: 8,
      list: function (ctx, px, pz) {
        if (!live() || !flats.length) return null;
        return near(flats.filter(function (F) { return !offMarket(F); }).map(function (F) { return F.board; }), px, pz, CBZ.player.pos.y, 3);
      },
      reach: function () { return 2.4; }, dot: function () { return 0.3; },
      name: function () { return "To let"; },
      verbs: [
        { id: "flat-rent", slot: "e", prio: 5, label: function (f) { return "Rent " + fmt(f.F.rent) + "/wk"; },
          canShow: function (f) { return !!(f && !mine(f.F) && !offMarket(f.F)); }, onSelect: rent },
        { id: "flat-buy", slot: "i", prio: 5, label: function (f) { return "Buy " + fmt(f.F.price); },
          canShow: function (f) { const r = f && homes()[f.F.key]; return !!(f && !(r && r.mode === "own") && !offMarket(f.F)); }, onSelect: buy },
      ],
    });
    CBZ.islandFit.fixtures("flat-stash", {
      prio: 8,
      list: function (ctx, px, pz) {
        if (!live() || !flats.length) return null;
        return near(flats.filter(mine).map(function (F) { return F.stashAt; }), px, pz, CBZ.player.pos.y, 3);
      },
      reach: function () { return 2.0; }, dot: function () { return 0.3; },
      name: function () { return "Wardrobe"; },
      verbs: [
        { id: "flat-cash-in", slot: "e", prio: 5, label: function () { return "Stash " + fmt(g.cash || 0); },
          canShow: function () { return (g.cash || 0) >= 1; }, onSelect: putCash },
        { id: "flat-cash-out", slot: "i", prio: 5, label: function (f) { const S = stashOf(f.F); return "Take " + fmt(S ? S.cash : 0); },
          canShow: function (f) { const S = stashOf(f.F); return !!(S && S.cash > 0); }, onSelect: takeCash },
        { id: "flat-guns-in", slot: "j", prio: 5, label: "Stash guns",
          canShow: function () { return gunsOn().length > 0; }, onSelect: putGuns },
        { id: "flat-guns-out", slot: "k", prio: 5, label: "Take guns",
          canShow: function (f) { const S = stashOf(f.F); return !!(S && S.guns.length); }, onSelect: takeGuns },
      ],
    });
  }

  if (CBZ.islandVenue && CBZ.islandVenue.on) CBZ.islandVenue.on("apartments", fitFlats);
  let acc = 0, accR = 0;
  if (CBZ.onUpdate) CBZ.onUpdate(36.5, function (dt) {
    if (!live()) return;
    for (const F of flats) doorTick(F, dt || 0);
    accR += dt || 0;
    if (accR >= 2) { accR = 0; rentTick(); }
  });

  CBZ.islandHomes = { flats: function () { return flats.slice(); }, homes: homes, mine: mine };
})();
