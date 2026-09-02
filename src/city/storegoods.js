/* ============================================================
   city/storegoods.js — WHAT IS ON THE SHELF IS WHAT YOU BUY.

   OWNER (verbatim): "gun store having all the real guns for sale on shelves
   and armoury having real armour on mannequins, and sunglass store, things
   already existing in the game real wearable or holdable items that can be in
   space i dont want a store with a bunch of fake shit why should that even be
   built."

   THE FAKE SHIT, NAMED — AND IT WAS WORSE THAN THE ASK. buildings.js's
   furnishShop is written to stand wall shelving in every store and put painted
   blocks on it (rows of ~22 cm coloured cubes; emissive slabs the electronics
   dresser calls "screens"). MEASURED ON A LIVE CITY AT SEED 90210, NONE OF IT
   IS THERE. `wallShelves` places its units at a lateral offset of
   `halfTan - deep - 0.05` — i.e. hugging the wall, which is what a shop shelf
   does — and then gates every one of them through `clearFloorPoint(..., 0.8)`,
   which demands 0.8 m of clearance from the INNER WALL FACE. With WT = 0.4 the
   deepest a wall-hugging piece can sit and still pass is `halfTan - 1.2`; the
   shelf asks for `halfTan - 0.75`. The gate can never say yes. So across all
   182 shops in the city, `lot.building.shoplift` had exactly THREE entries —
   the free-standing gondola in the three stores that fall to the generic
   dresser — and every kind-specific store (food, gas, hardware, electronics,
   drugs, hospital, security) had zero shelf anchors, zero shelf carcasses and
   therefore zero painted goods, because the thing the paint was going on was
   never placed. A shop was a floor, a counter and a clerk.

   (The same `wallShelves` also lays each unit's LONG axis across the tangent —
   perpendicular to the wall it is hugging — so had the gate ever passed one,
   a 2 m shelf would have jutted into the aisle 0.7 m wide. It is not a fixture
   this file wants to revive; it is one it replaces.)

   So the shelf you can buy off had to be BUILT, not just stocked. The only verb
   the old dressing ever had was the shoplift runtime's [E], which took a FLAVOUR
   WORD ("some snacks") off the gondola and paid a few seeded dollars.

   Meanwhile the game already draws every one of those items for real:
   CBZ.itemAsset(name) returns the phone, the laptop, the medkit, the burger,
   the crowbar, the pair of shades — the same models the inventory photographs
   and the pavement drops. The catalog already knows what each shop stocks
   (cityEcon.stockFor(kind)) and what each unit costs (cityEcon.buyPrice). The
   only thing missing was standing one on the other.

   SO THIS FILE IS THE JOIN, AND IT IS ALL IT IS.
     1. A DRESS PASS at landmass order 90.5 — after every shop is furnished,
        before core/batch.js merges. For each generic shop lot it STANDS REAL
        SHELVING against the side walls through the building's own b.lbox (so
        the carcass folds into the batch merge and costs no draw call): a back
        panel, two end uprights, a kick and THREE open boards you can see the
        goods on, long axis running along the wall. It then deals the shop's
        real stock across those boards plus whatever free-standing island
        furnishShop did manage to record, strips any painted blocks off them
        while they are still separate meshes, and moves the old anchors to
        lot.building.storeShelves — which is exactly how the flavour-word
        shoplift stops for a dressed lot: it finds no shelves.
     2. A LIVE DRESSER: the item models themselves are built only for the
        stores near you (a handful at a time) and torn down behind you, so a
        181-shop city costs nothing until you are in one. Same visibility
        economics as gunstore.js's wall, generalised.
     3. TWO VERBS through CBZ.interactions: [E] Buy (money and goods through
        CBZ.cityShopAcquire — the counter menu's own path, one price source)
        and, when the clerk cannot see the shelf, [I] Pocket it (free, and the
        clerk who CAN see it calls it in through the shoplift system's own
        charge, CBZ.cityShopTheftSeen).
     4. Sold or stolen, the unit LEAVES THE SHELF and the shop restocks on the
        same daily count-out the till runs on (CBZ.dayCount).

   The counter keeps everything a counter is for — services, the sell window,
   the till — and stops listing whatever is standing on the shelves
   (shops.js reads CBZ.cityGoodsLive).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.onUpdate) return;
  const THREE = window.THREE;

  // Kinds a FLAGSHIP walk-in already owns end to end (gunstore.js's wall,
  // jewelry.js's cases, clothingstore.js's racks, pawnshop.js, realtyoffice.js,
  // modshop/carlot showrooms) or that have no retail stock to stand up at all
  // (the civic counters, the bar, the bank). Dressing those would be a second
  // store inside the first.
  const SKIP = {
    guns: 1, jewelry: 1, pawn: 1, clothing: 1, boutique: 1, realtor: 1,
    carlot: 1, chop: 1, casino: 1, bar: 1, bank: 1, cityhall: 1, raceway: 1,
    courthouse: 1, federal: 1, cityannex: 1, postoffice: 1, dmv: 1,
    library: 1, firestation: 1,
  };

  const LIVE_R = 48;        // a store BUILDS its goods this far out (no pop-in)
  const SHOW_R = 26;        // …and DRAWS them only this close (glass-front range)
  const MAX_LIVE = 3;       // never more than this many stores standing at once
  const FACINGS = 2;        // units of one product per board — a facing, like a real shelf

  // THE SHELF UNIT. A shop shelf is an open carcass you can SEE INTO, not the
  // solid 2 m block furnishShop draws (which is why its painted stock rows,
  // which sit at y 0.7 and 1.35 inside a 2.0-tall solid box, were buried in it
  // even in the buildings where the gate let one through).
  const SH = {
    h: 1.86,                          // overall height
    deep: 0.52,                       // how far it comes into the room
    span: 2.05,                       // how far it runs ALONG the wall
    boards: [0.46, 1.02, 1.58],       // the three levels goods stand on
    kick: 0.10,                       // toe kick under the bottom board
    body: 0x555c66, board: 0x7a838d,  // carcass / board tones
  };
  const REACH = 2.6;        // arm's length at the shelf (the shoplift grab's 2.4, and change)
  // SHELF SCALE. The item models are honest about size — an apple is 8 cm
  // because an apple is 8 cm — and 8 cm of apple across a shop floor is
  // invisible. itemAssetPickup solves the same problem for the pavement, but at
  // a 34 cm reference that makes a burger the size of a bin bag on a shelf. So
  // the same order-PRESERVING ramp, at a retail reference: the tiniest goods
  // lift most, a ring still reads smaller than a medkit, and nothing standing
  // on a 2 m shelf is taller than half a metre.
  const SREF = 0.22, SMAX = 0.55, SPOW = 0.6;

  const PLANS = [];                       // one per dressed lot
  const BY_LOT = new WeakMap();
  const S = { arena: null, live: [], scanT: 0, refreshed: false };

  function econ() { return CBZ.cityEcon || null; }
  function fmt$(n) { n = Math.round(n || 0); return "$" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function hash01(x, z, k) { return CBZ.hash01 ? CBZ.hash01(x, z, k) : 0.5; }
  function today() { return (CBZ.dayCount ? CBZ.dayCount() : 0) | 0; }

  /* ============================================================
     1. THE PLAN — pure data, computed once at city build.
     ============================================================ */

  // THE PAINTED GOODS DIE HERE. Every stockRow block is a small unit box drawn
  // through b.lbox — a shared unit geometry SCALED, so its scale IS its size —
  // sitting inside the footprint of a shelf we are about to stock for real.
  // Bounded by size on both axes and by the shelf's own footprint, so the
  // shelf carcass (2 m span), its top plate, the potted plant, the bin and the
  // coffee machine are all outside the net. Runs before core/batch.js, which
  // is the only moment these are still separate objects.
  function stripPainted(lot, shelves) {
    const b = lot.building, grp = b && b.group;
    if (!grp || !grp.children) return 0;
    let killed = 0;
    for (let i = grp.children.length - 1; i >= 0; i--) {
      const m = grp.children[i];
      if (!m || !m.isMesh) continue;
      const sx = m.scale.x, sy = m.scale.y, sz = m.scale.z;
      if (Math.max(sx, sz) > 0.42 || sy > 0.62) continue;      // too big to be a unit of stock
      const mx = m.position.x, mz = m.position.z, my = m.position.y;
      if (my < 0.25) continue;                                  // floor dressing, not goods
      for (let s = 0; s < shelves.length; s++) {
        const sh = shelves[s];
        if (my > sh.top + 0.55) continue;                       // above the shelf's own stock band
        if (Math.abs(mx - sh.lx) > sh.hx + 0.10) continue;
        if (Math.abs(mz - sh.lz) > sh.hz + 0.10) continue;
        grp.remove(m);
        killed++;
        break;
      }
    }
    return killed;
  }

  /* ---- STANDING THE SHELVING ---------------------------------------------
     Drawn through the BUILDING'S OWN b.lbox, at landmass order 90.5, which is
     after the shell exists and before core/batch.js collapses it — so a store's
     four shelf units are ~28 boxes that cost exactly zero draw calls, the same
     deal every wall and every counter in the city already takes.

     Frame: IN is the way you walk from the door (b.localDoor's normal, one axis
     always 0); the TANGENT is the side walls. A wall shelf's LENGTH runs along
     the wall (the IN axis) and its DEPTH into the room (the tangent) — the way
     shelving actually stands in a shop, and the opposite of what furnishShop
     asks for. Only the door aisle, the stair strip and any lift shaft can veto
     a unit; hugging the wall is the POINT, not a violation. */
  function standShelving(lot, plan) {
    const b = lot.building;
    if (typeof b.lbox !== "function" || !b.localDoor) return;
    const dr = b.localDoor;
    const inx = dr.nx || 0, inz = dr.nz || 0;
    if (!inx && !inz) return;
    const tx = -inz, tz = inx;
    const along = Math.abs(inx) > 0.5;
    const W = b.w, D = b.d, wt = b.wt != null ? b.wt : 0.4;
    const halfIn = (along ? W : D) / 2, halfTan = (along ? D : W) / 2;
    if (halfTan - wt - SH.deep < 1.1) return;            // too narrow for a shelf and an aisle
    const lat = halfTan - wt - SH.deep / 2 - 0.02;       // back panel flush to the wall
    // Stay in front of whatever the room already has at the back: the counter
    // (~2.8 in from the back wall) always, and the universal back-of-house
    // partition (5.5 in from it) in the rooms big enough to get one — the same
    // (2*halfTan >= 8 && 2*halfIn >= 13) test furnishShop uses.
    const walled = (2 * halfTan) >= 8 && (2 * halfIn) >= 13;
    const maxDepth = 2 * halfIn - (walled ? 6.3 : 4.3);
    // Up to three units a side, SPREAD down the run rather than packed at the
    // front — these rooms are 28 m deep and two units by the door would leave
    // 17 m of bare wall behind them.
    const run = maxDepth - 4.2;
    const units = Math.max(0, Math.min(3, Math.floor(run / (SH.span + 0.6))));
    if (!units) return;
    const step = units > 1 ? (run - SH.span) / (units - 1) : 0;
    const depths = [];
    for (let u = 0; u < units; u++) depths.push(4.2 + SH.span / 2 + u * step);
    const bw = function (lenOnIn, lenOnTan) { return along ? lenOnIn : lenOnTan; };
    const bd = function (lenOnIn, lenOnTan) { return along ? lenOnTan : lenOnIn; };

    for (const side of [-1, 1]) {
      for (let i = 0; i < depths.length; i++) {
        const d0 = depths[i];
        if (d0 + SH.span / 2 > maxDepth + 0.01) break;
        const cx = inx * (-halfIn + d0) + tx * (side * lat);
        const cz = inz * (-halfIn + d0) + tz * (side * lat);
        // the ONLY vetoes that matter for something standing against a wall
        if (b.clearFloorPoint && !b.clearFloorPoint(cx, cz, 0.06)) continue;
        // …and one more: if furnishShop ever DOES manage to record a fixture
        // here (someone fixes that clearance gate), stand down rather than
        // build a second shelf inside the first. Duplication is the one thing
        // this pass must never add.
        let taken = false;
        for (let q = 0; q < plan.anchors.length; q++) {
          const a0 = plan.anchors[q];
          if (Math.hypot(a0.lx - cx, a0.lz - cz) < 1.3) { taken = true; break; }
        }
        if (taken) continue;
        const nx = side * tx, nz = side * tz;            // outward, into the wall
        // back panel, flush against the wall
        b.lbox(cx + nx * (SH.deep / 2 - 0.02), SH.h / 2, cz + nz * (SH.deep / 2 - 0.02),
          bw(SH.span, 0.04), SH.h, bd(SH.span, 0.04), SH.body, { cast: false });
        // end uprights
        for (const e of [-1, 1]) {
          b.lbox(cx + inx * e * (SH.span / 2 - 0.03), SH.h / 2, cz + inz * e * (SH.span / 2 - 0.03),
            bw(0.06, SH.deep), SH.h, bd(0.06, SH.deep), SH.body, { cast: false });
        }
        // toe kick
        b.lbox(cx, SH.kick / 2, cz, bw(SH.span - 0.12, SH.deep - 0.04), SH.kick,
          bd(SH.span - 0.12, SH.deep - 0.04), SH.body, { cast: false });
        // the boards — and each one is a place goods can stand
        for (let k = 0; k < SH.boards.length; k++) {
          const y = SH.boards[k];
          b.lbox(cx, y, cz, bw(SH.span - 0.12, SH.deep - 0.06), 0.05,
            bd(SH.span - 0.12, SH.deep - 0.06), SH.board, { cast: false });
          plan.anchors.push({
            lx: cx, lz: cz, top: y + 0.025,
            across: SH.span - 0.22, deep: SH.deep - 0.10,
            hx: bw(SH.span, SH.deep) / 2, hz: bd(SH.span, SH.deep) / 2,
            ax: inx, az: inz,                    // goods spread ALONG the wall
            fx: -nx, fz: -nz,                    // and face the aisle
          });
        }
      }
    }
  }

  // Any free-standing island furnishShop DID record (the generic dresser's
  // gondola) is a display too — reuse it rather than standing a second one.
  function islandAnchors(lot, plan, along) {
    const b = lot.building, list = b.shoplift || [];
    // recordStock stamps `b.ox + local`, so subtracting the shell origin puts
    // the island back in the SAME building-local frame everything else here
    // uses. (b.ox is the shell's offset inside whatever root holds it — for a
    // town that root is itself translated, which is exactly why nothing in this
    // file may treat b.ox as a world coordinate.)
    const ox = b.ox || 0, oz = b.oz || 0;
    for (let i = 0; i < list.length; i++) {
      const sh = list[i];
      const lx = sh.x - ox, lz = sh.z - oz;
      const hx = (along ? sh.deep : sh.across) / 2, hz = (along ? sh.across : sh.deep) / 2;
      let fx = -lx, fz = -lz;                     // face the room centre (local origin)
      const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
      plan.anchors.push({
        lx: lx, lz: lz, top: sh.y,
        across: Math.max(0.6, sh.across - 0.3), deep: sh.deep,
        hx: hx, hz: hz,
        ax: along ? 0 : 1, az: along ? 1 : 0,     // spread along the island's long side
        fx: fx, fz: fz, island: true,
      });
    }
  }

  /* WORLD COORDINATES ARE A DERIVED, REFRESHABLE FACT. The models live in the
     shell's own frame and are always right; the world numbers (player distance,
     the clerk's line of sight, the interaction zone, tooling) are computed FROM
     that frame and are only as good as the transform at the moment they were
     taken. So they are taken again the first time a store actually goes live,
     by which point every root in the graph has certainly composed itself. */
  function refreshWorld(plan) {
    const w0 = plan.toWorld(0, 0, 0);
    plan.cx = w0.x; plan.cz = w0.z;
    for (let i = 0; i < plan.anchors.length; i++) {
      const a = plan.anchors[i], w = plan.toWorld(a.lx, a.top, a.lz);
      a.x = w.x; a.y = w.y; a.z = w.z;
      // the direction the goods FACE, in world terms — a tripod or an NPC that
      // wants to stand in front of this shelf needs it, and a rotated host root
      // would make the local one a lie.
      const w2 = plan.toWorld(a.lx + a.fx, a.top, a.lz + a.fz);
      let dx = w2.x - a.x, dz = w2.z - a.z;
      const dl = Math.hypot(dx, dz) || 1;
      a.wfx = dx / dl; a.wfz = dz / dl;
    }
    for (let i = 0; i < plan.slots.length; i++) {
      const sl = plan.slots[i], w = plan.toWorld(sl.lx, sl.ly, sl.lz);
      sl.x = w.x; sl.y = w.y; sl.z = w.z;
    }
    plan.worldFresh = true;
  }

  function planLot(lot) {
    const e = econ(), b = lot && lot.building;
    if (!e || !b) return null;
    if (b.gunstore || b.jewelry) return null;                    // flagship walk-ins
    const kind = (b.shop && b.shop.kind) || lot.kind || "";
    if (SKIP[kind]) return null;
    const stock = (e.stockFor(kind) || []).filter(function (n) { return !!e.ITEMS[n]; });
    if (!stock.length) return null;
    const door = b.door || {};
    const along = Math.abs(door.nx || 0) > 0.5;

    const plan = {
      lot: lot, kind: kind, cx: lot.cx, cz: lot.cz,
      anchors: [], names: [], slots: [], group: null, built: false,
      painted: 0, boards: 0,
    };
    /* THE FRAME, AND WHY IT IS NOT WORLD. A shop's shell is a group inside
       whatever root holds it — the mainland's arena root for a city block, but a
       TOWN's own translated root for anything the mini-city / biome builders
       raised. `b.ox` is the shell's offset INSIDE that root, so `b.ox + local`
       is a town-local coordinate, not a world one. The first cut of this file
       treated it as world and stood a hardware store's crowbars in mid-air over
       a road eight hundred metres from the shop. Everything below is authored in
       BUILDING-LOCAL coordinates, the goods group is parented to the shell so
       the models inherit its transform, and world positions (which the player
       distance, the clerk's line of sight and the interaction zone all need)
       are derived ONCE from the shell's own matrixWorld. */
    const W2 = new THREE.Vector3();
    plan.toWorld = function (lx, ly, lz) {
      W2.set(lx, ly || 0, lz);
      const g = plan.lot.building && plan.lot.building.group;
      // updateWorldMatrix(true, false) walks the ANCESTORS first. During the
      // build sweep a town's root may not have composed its own matrixWorld
      // yet, and updateMatrixWorld(true) would happily compose this shell
      // against a stale (identity) parent — which is how a trap house's stock
      // ended up buyable from a spot on the road outside it while the models
      // themselves drew correctly inside. Ask for the ancestors.
      if (g) {
        try {
          if (g.updateWorldMatrix) g.updateWorldMatrix(true, false);
          else g.updateMatrixWorld(true);
          W2.applyMatrix4(g.matrixWorld);
        } catch (e) { /* no transform available — local IS world */ }
      }
      return W2;
    };
    islandAnchors(lot, plan, along);          // whatever already stood here
    standShelving(lot, plan);                 // and the shelving that never did
    if (!plan.anchors.length) return null;
    plan.boards = plan.anchors.length;
    refreshWorld(plan);

    // Deal the stock over the boards: ONE product per board, several facings of
    // it, the way a shop shelf is actually merchandised. Every name the catalog
    // says this trade sells gets a board before any name gets a second one.
    for (let i = 0; i < plan.anchors.length; i++) {
      const a = plan.anchors[i];
      const name = stock[i % stock.length];
      if (plan.names.indexOf(name) < 0) plan.names.push(name);
      const n = a.island ? FACINGS + 1 : FACINGS;
      const usable = Math.max(0.4, a.across);
      for (let u = 0; u < n; u++) {
        const t = -usable / 2 + (u + 0.5) * (usable / n);
        const jitter = (hash01(a.lx + u, a.lz + i, 0x51e1) - 0.5) * 0.05;
        const lx = a.lx + a.ax * t + a.fx * jitter;
        const lz = a.lz + a.az * t + a.fz * jitter;
        const w = plan.toWorld(lx, a.top, lz);
        plan.slots.push({
          plan: plan, lot: lot, name: name,
          lx: lx, ly: a.top, lz: lz,                   // where the model stands, in the shell
          x: w.x, y: w.y, z: w.z,                      // and where that is in the world
          yaw: Math.atan2(a.fx, a.fz) + (hash01(a.lz + u, a.lx + i, 0x9ab3) - 0.5) * 0.45,
          taken: false, tookDay: -1,      // sold/lifted, and on which trading day
          obj: null,
        });
      }
    }
    if (!plan.slots.length) return null;

    plan.painted = stripPainted(lot, plan.anchors);
    // THE OLD SHOPLIFT STOPS HERE, and it stops the way the gun wall stops the
    // counter's firearm rows: by removing what it reads. buildings.js's runtime
    // enumerates lot.building.shoplift; with the anchors moved to storeShelves
    // it finds none on this lot and offers nothing, so there is exactly one way
    // to take something off this shelf and it hands you a real object. Nothing
    // is lost — the anchors are still here, under a name that says who owns
    // them now.
    b.storeShelves = b.shoplift;
    b.shoplift = null;
    BY_LOT.set(lot, plan);
    return plan;
  }

  if (CBZ.addLandmass) CBZ.addLandmass(function (city) {
    const A = city || CBZ._settlementArena || (CBZ.city && CBZ.city.arena) || null;
    if (!A) return;
    // a rebuilt arena invalidates every plan from the last one
    for (let i = PLANS.length - 1; i >= 0; i--) if (PLANS[i]._arena !== A) PLANS.splice(i, 1);
    teardownAll();
    const lots = A.shopLots || A.lots || [];
    for (let i = 0; i < lots.length; i++) {
      const lot = lots[i];
      if (!lot || !lot.building || lot.demolished) continue;
      if (BY_LOT.get(lot)) continue;
      const p = planLot(lot);
      if (p) { p._arena = A; PLANS.push(p); }
    }
    S.arena = A;
    S.refreshed = false;      // world coords get re-derived on the first live tick
  }, 90.5);

  /* ============================================================
     2. THE LIVE DRESSER — models only where you are.
     ============================================================ */

  // A SHOP RESTOCKS. Not on a bespoke timer — on the same daily count-out the
  // till already runs on (CBZ.dayCount), so the shelf you cleared on Monday is
  // full again on Tuesday and empty for the rest of Monday.
  function slotAvailable(sl) { return !sl.taken || sl.tookDay !== today(); }

  // the model for one unit of stock, standing on the shelf with its base on it.
  function shelfModel(name) {
    if (!CBZ.itemAsset) return null;
    let o = null;
    try { o = CBZ.itemAsset(name); } catch (err) { o = null; }
    if (!o) return null;
    o.updateMatrixWorld(true);
    let bb = new THREE.Box3().setFromObject(o);
    if (!isFinite(bb.min.x) || !isFinite(bb.max.x)) return null;
    const m = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
    let k = 1;
    if (m > 1e-4) {
      if (m < SREF) k = Math.min(SREF / m, Math.pow(SREF / m, SPOW));
      else if (m > SMAX) k = SMAX / m;
    }
    if (k !== 1) { o.scale.multiplyScalar(k); o.updateMatrixWorld(true); bb = new THREE.Box3().setFromObject(o); }
    if (isFinite(bb.min.y)) o.position.y -= bb.min.y;
    const w = new THREE.Group();
    w.add(o);
    w.userData.storeGood = name;
    return w;
  }

  function buildPlan(plan) {
    if (plan.built) return;
    if (!plan.livedOnce) { plan.livedOnce = true; refreshWorld(plan); }
    // parented to the SHELL, so the models ride whatever root the shell rides
    // (a town's translated one included) and their coordinates are the same
    // building-local numbers the shelving they stand on was drawn in.
    const root = (plan.lot.building && plan.lot.building.group) ||
                 (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || CBZ.scene;
    if (!root) return;
    const grp = new THREE.Group();
    grp.userData.storeGoods = plan.kind;
    // goods arrive AFTER the city's one-shot batch/freeze pass, but tag them
    // anyway: a body of stock is not scenery and must never be folded into a
    // shell it can be taken off.
    grp.userData.dynamic = true;
    root.add(grp);
    plan.group = grp;
    for (let i = 0; i < plan.slots.length; i++) {
      const sl = plan.slots[i];
      sl.obj = null;
      if (!slotAvailable(sl)) continue;
      const o = shelfModel(sl.name);
      if (!o) continue;
      o.position.set(sl.lx, sl.ly, sl.lz);
      o.rotation.y = sl.yaw;
      o.traverse(function (m) { if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; } });
      grp.add(o);
      sl.obj = o;
    }
    plan.built = true;
  }

  function teardownPlan(plan) {
    if (!plan.built) return;
    if (plan.group && plan.group.parent) plan.group.parent.remove(plan.group);
    plan.group = null;
    for (let i = 0; i < plan.slots.length; i++) plan.slots[i].obj = null;
    plan.built = false;
  }
  function teardownAll() { for (let i = 0; i < PLANS.length; i++) teardownPlan(PLANS[i]); S.live.length = 0; }

  // take one unit off the shelf (bought or pocketed) — the model goes with it.
  function clearSlot(sl) {
    sl.taken = true; sl.tookDay = today();
    if (sl.obj) { if (sl.obj.parent) sl.obj.parent.remove(sl.obj); sl.obj = null; }
  }

  CBZ.onUpdate(37.6, function (dt) {
    const g = CBZ.game;
    if (!g || g.mode !== "city") { if (S.live.length) teardownAll(); return; }
    if (!PLANS.length) return;
    S.scanT -= dt;
    if (S.scanT > 0) return;
    S.scanT = 0.4;
    const P = CBZ.player;
    if (!P) return;
    // ONCE, on the first tick of a built city: re-derive every store's world
    // numbers now that every root in the graph has certainly composed itself.
    // (Doing it at build time read some shells against a parent that had not
    // yet computed its own matrixWorld — see refreshWorld.)
    if (!S.refreshed) { S.refreshed = true; for (let i = 0; i < PLANS.length; i++) refreshWorld(PLANS[i]); }
    const px = P.pos.x, pz = P.pos.z;
    // nearest few stores inside the radius; everything else stands down
    const near = [];
    for (let i = 0; i < PLANS.length; i++) {
      const p = PLANS[i];
      const d = Math.hypot(p.cx - px, p.cz - pz);
      if (d <= LIVE_R) near.push([d, p]);
    }
    near.sort(function (a, b) { return a[0] - b[0]; });
    if (near.length > MAX_LIVE) near.length = MAX_LIVE;
    const want = near.map(function (r) { return r[1]; });
    const dOf = new Map();
    for (let i = 0; i < near.length; i++) dOf.set(near[i][1], near[i][0]);
    for (let i = 0; i < PLANS.length; i++) {
      const p = PLANS[i];
      if (want.indexOf(p) < 0) { if (p.built) teardownPlan(p); continue; }
      if (!p.built) buildPlan(p);
      // a slot the day-count restocked comes back without a rebuild
      else for (let k = 0; k < p.slots.length; k++) {
        const sl = p.slots[k];
        if (sl.obj || !slotAvailable(sl)) continue;
        const o = shelfModel(sl.name);
        if (!o) continue;
        o.position.set(sl.lx, sl.ly, sl.lz);
        o.rotation.y = sl.yaw;
        o.traverse(function (m) { if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; } });
        p.group.add(o);
        sl.obj = o;
      }
      // BUILT IS NOT DRAWN. A store's stock is ~150 small meshes; three shops
      // within earshot of a high street is 450 draw calls of goods nobody is
      // looking at. They are BUILT early so there is no pop-in as you reach the
      // door, and DRAWN only once you are close enough to read a shelf through
      // the glass.
      if (p.group) p.group.visible = (dOf.get(p) || 0) < SHOW_R;
    }
    S.live = want;
  });

  /* ============================================================
     3. THE VERBS — one zone, every store in the city.
     ============================================================ */

  function nearestSlot(px, pz) {
    let best = null, bd = REACH;
    for (let i = 0; i < S.live.length; i++) {
      const p = S.live[i];
      if (!p.built) continue;
      if (Math.abs(p.cx - px) > 40 || Math.abs(p.cz - pz) > 40) continue;
      for (let k = 0; k < p.slots.length; k++) {
        const sl = p.slots[k];
        if (!sl.obj) continue;
        const d = Math.hypot(sl.x - px, sl.z - pz);
        if (d < bd) { bd = d; best = sl; }
      }
    }
    return best;
  }

  function priceOf(name) { const e = econ(); return (e && e.buyPrice) ? e.buyPrice(name) : 0; }
  function note(t, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(t, s); }

  function buySlot(sl) {
    if (!sl || !sl.obj) return;
    if (!CBZ.cityShopAcquire) { note("The clerk waves you to the counter.", 1.6); return; }
    if (!CBZ.cityShopAcquire(sl.lot, sl.name, 1, null)) return;   // failed spend keeps the goods
    clearSlot(sl);
  }

  function takeSlot(sl) {
    if (!sl || !sl.obj) return;
    // MADE: the shoplift system's own charge and its own panic — one theft
    // model for the whole city, whether you lifted a flavour word or a laptop.
    if (CBZ.cityShopTheftSeen && CBZ.cityShopTheftSeen(sl.lot, sl.x, sl.z)) return;
    if (!CBZ.cityShopAcquire || !CBZ.cityShopAcquire(sl.lot, sl.name, 1, { free: true })) return;
    if (CBZ.sfx) CBZ.sfx("coin");
    clearSlot(sl);
  }

  const I = CBZ.interactions;
  if (I && I.registerZone) {
    I.registerZone({
      id: "zone-store-goods", kind: "storegoods", prio: 8, driving: false,
      find: function (px, pz) {
        const g = CBZ.game;
        if (!g || g.mode !== "city" || CBZ.cityMenuOpen) return null;
        return nearestSlot(px, pz);
      },
      options: [
        {
          id: "storegoods-buy", slot: "e",
          label: function (sl) { return "Buy " + sl.name + " · " + fmt$(priceOf(sl.name)); },
          onSelect: function (sl) { buySlot(sl); },
        },
        {
          // THE RISK IS THE VERB. The flavour-word grab this replaces always
          // offered itself and told you when the clerk was looking; pressing it
          // anyway is how you got charged. Same deal, with a real object at the
          // end of it: the label reads the posted clerk's actual eyes (the same
          // ones, published from buildings.js) and taking it under their gaze
          // fires the same reported theft and the same panic.
          id: "storegoods-take", slot: "i", bad: true,
          label: function (sl) {
            const seen = CBZ.cityShopClerkSees && CBZ.cityShopClerkSees(sl.lot, sl.x, sl.z);
            return seen ? "Pocket the " + sl.name + " (they're watching)"
                        : "Pocket the " + sl.name;
          },
          onSelect: function (sl) { takeSlot(sl); },
        },
      ],
    });
    if (I.describe) I.describe("storegoods", function (sl) {
      return { label: sl.name, note: "on the shelf \u00b7 " + fmt$(priceOf(sl.name)) };
    });
  }

  /* ============================================================
     4. PUBLIC HOOKS
     ============================================================ */

  // shops.js reads this to trim the counter menu: the names actually standing
  // on this lot's shelves. Feature-detected there, so a build without this file
  // sells everything over the counter exactly as before.
  CBZ.cityGoodsLive = function (lot) {
    const p = lot && BY_LOT.get(lot);
    return p ? p.names : null;
  };
  // the boards this store's goods stand on, in world coords (tools/tripods).
  CBZ.cityStoreGoodsShelves = function (lot) {
    const p = lot && BY_LOT.get(lot);
    if (!p) return null;
    return p.anchors.map(function (a) {
      return { x: a.x, y: a.y, z: a.z, top: a.top, fx: a.wfx, fz: a.wfz, island: !!a.island };
    });
  };
  CBZ.cityGoodsLot = function (kind) {
    for (let i = 0; i < PLANS.length; i++) if (!kind || PLANS[i].kind === kind) return PLANS[i].lot;
    return null;
  };
  // headless / harness handle: buy a named unit off the nearest live shelf.
  CBZ.cityGoodsBuy = function (name) {
    for (let i = 0; i < S.live.length; i++) {
      const p = S.live[i];
      for (let k = 0; k < p.slots.length; k++) {
        const sl = p.slots[k];
        if (sl.obj && sl.name === name) { buySlot(sl); return true; }
      }
    }
    return false;
  };
  // the ratchet: what is REAL on the shelves, and what painted stock died for it.
  CBZ.cityStoreGoodsAudit = function () {
    let shelves = 0, slots = 0, standing = 0, painted = 0, meshes = 0;
    const kinds = {};
    for (let i = 0; i < PLANS.length; i++) {
      const p = PLANS[i];
      shelves += p.boards | 0;
      slots += p.slots.length;
      painted += p.painted;
      kinds[p.kind] = (kinds[p.kind] | 0) + 1;
      for (let k = 0; k < p.slots.length; k++) if (p.slots[k].obj) standing++;
      if (p.group) p.group.traverse(function (m) { if (m.isMesh) meshes++; });
    }
    return { stores: PLANS.length, kinds: kinds, shelves: shelves, slots: slots,
             standing: standing, paintedStripped: painted, meshes: meshes,
             live: S.live.length };
  };
  // what is on the shelves of the store nearest the player, right now.
  CBZ.cityStoreGoodsNear = function () {
    const P = CBZ.player;
    if (!P) return null;
    let best = null, bd = 1e9;
    for (let i = 0; i < PLANS.length; i++) {
      const d = Math.hypot(PLANS[i].cx - P.pos.x, PLANS[i].cz - P.pos.z);
      if (d < bd) { bd = d; best = PLANS[i]; }
    }
    if (!best) return null;
    let standing = 0, mesh = 0;
    for (let k = 0; k < best.slots.length; k++) if (best.slots[k].obj) standing++;
    if (best.group) best.group.traverse(function (m) { if (m.isMesh) mesh++; });
    return { kind: best.kind, dist: Math.round(bd * 10) / 10, names: best.names.slice(),
             shelves: best.boards | 0, slots: best.slots.length, standing: standing,
             meshes: mesh, paintedStripped: best.painted, built: !!best.built };
  };
})();
