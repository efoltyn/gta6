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

   The pawn lot's shell (door, counter, posted clerk, a junk-pile island) is
   already stamped by buildings.js; this stands the real fixtures + the two
   look-and-[E] desks in front of it, mirroring gunstore.js / jewelry.js:
   built ONCE per city on a single group, shared geometries + materials, the
   whole display visibility-gated by distance, mode-gated + headless-guarded.
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
              cur: null, mode: "", redeemIdx: 0, prompt: null, lastTxt: "",
              shelfMeshes: [] };

  function econ() { return CBZ.cityEcon || null; }
  function fmt$(n) { n = Math.round(n || 0); return "$" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function note(t, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(t, s); }
  function now() { return (CBZ.now || 0) / 1000; }   // CBZ.now is ms; tickets count in seconds

  // ---- shared fixture materials (one each, flagged _shared) ------------------
  let M = null, GEO = null;
  function mats() {
    if (M) return M;
    M = {
      wood: new THREE.MeshLambertMaterial({ color: 0x4a3422 }),                                   // scuffed counter wood
      dark: new THREE.MeshLambertMaterial({ color: 0x2a2620 }),                                   // shelving / cabinet body
      bar: new THREE.MeshLambertMaterial({ color: 0x3b4048 }),                                    // the teller's security bars (gunmetal)
      glassPad: new THREE.MeshLambertMaterial({ color: 0xb9d6e0, emissive: 0x3f6a78, emissiveIntensity: 0.3, transparent: true, opacity: 0.34 }),
      neon: new THREE.MeshLambertMaterial({ color: 0xffb23c, emissive: 0xffb23c, emissiveIntensity: 0.85 }),  // the buzzing LOANS sign
      felt: new THREE.MeshLambertMaterial({ color: 0x2c3a2c }),                                   // counter mat
      // junk-stock accents (pawned goods read at a glance from the door)
      brass: new THREE.MeshLambertMaterial({ color: 0xc7a24a }),
      red: new THREE.MeshLambertMaterial({ color: 0x8a3030 }),                                    // a guitar body
      steel: new THREE.MeshLambertMaterial({ color: 0x9aa2ac }),
      black: new THREE.MeshLambertMaterial({ color: 0x16181c }),                                  // a TV / amp
      orange: new THREE.MeshLambertMaterial({ color: 0xd07a2a }),                                 // a power drill
      screen: new THREE.MeshLambertMaterial({ color: 0x3a4e6a, emissive: 0x223047, emissiveIntensity: 0.4 }),
    };
    Object.keys(M).forEach((k) => { M[k]._shared = true; });
    return M;
  }
  function geos() {
    if (GEO) return GEO;
    GEO = {
      box: new THREE.BoxGeometry(1, 1, 1),
      bar: new THREE.CylinderGeometry(0.02, 0.02, 1, 6),     // a single teller bar
      neck: new THREE.CylinderGeometry(0.035, 0.035, 1, 6),  // guitar neck
      body: new THREE.CylinderGeometry(0.16, 0.2, 0.08, 10), // guitar body / drum
      face: new THREE.CylinderGeometry(0.05, 0.05, 0.03, 10),// a watch face
    };
    Object.keys(GEO).forEach((k) => { GEO[k]._shared = true; });
    return GEO;
  }
  function mesh(geo, mat, sx, sy, sz) {
    const m = new THREE.Mesh(geo, mat);
    if (sx != null) m.scale.set(sx, sy == null ? sx : sy, sz == null ? sx : sz);
    m.castShadow = false; m.receiveShadow = false;
    return m;
  }
  function box(mat, w, h, d, x, y, z) { const m = mesh(geos().box, mat, w, h, d); m.position.set(x, y, z); return m; }

  function tagSprite(text, color, sx, sy) {
    if (!CBZ.makeLabelSprite) return null;
    const s = CBZ.makeLabelSprite(text, { color: color || "#ffd166" });
    s.scale.set(sx || 1.8, sy || 0.45, 1);
    return s;
  }

  // ---- build the storefront fixtures once per city ---------------------------
  // Geometry is derived from the building box (b.w/b.d/ox/oz) + the door normal,
  // exactly like the gunstore stamp computes its rack/counter — the pawn lot
  // gets no bespoke world anchors, so we lay the L-shaped counter ourselves.
  function buildDisplays() {
    const b = S.b, m = mats(), GG = geos();
    const group = new THREE.Group();
    S.group = group;
    const root = (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || CBZ.scene;
    root.add(group);

    const ox = (b.ox != null ? b.ox : S.lot.cx), oz = (b.oz != null ? b.oz : S.lot.cz);
    const W = b.w || 10, D = b.d || 10, WT = 0.4;
    S.cx = ox; S.cz = oz;
    const door = (S.lot.building && S.lot.building.door) || { x: ox, z: oz - D / 2, nx: 0, nz: 1 };
    const inx = door.nx, inz = door.nz;            // inward unit (one axis is 0)
    const tx = -inz, tz = inx;                     // wall tangent
    const halfIn = (inx !== 0 ? W : D) / 2;        // door wall → centre depth
    const halfTan = (inx !== 0 ? D : W) / 2;

    // The service counter runs ACROSS the room a little past centre (the clerk
    // posts behind it, toward the back wall). depth measured from the door wall.
    const cDepth = Math.min(2 * halfIn - WT - 1.0, halfIn + 1.4);
    const cLen = Math.min(2 * halfTan - 2 * WT - 0.8, 5.0);
    const ccx = ox + inx * (cDepth - halfIn);
    const ccz = oz + inz * (cDepth - halfIn);
    const cw = Math.abs(tx) * cLen + Math.abs(inx) * 0.7;   // counter footprint
    const cd = Math.abs(tz) * cLen + Math.abs(inz) * 0.7;
    const cTop = 1.06;

    // --- the counter slab (solid: you transact AT it, never through it) ---
    const counter = box(m.wood, cw, cTop, cd, ccx, cTop / 2, ccz);
    counter.receiveShadow = true; group.add(counter);
    const ledge = box(m.felt, cw - 0.1, 0.05, cd - 0.1, ccx, cTop + 0.02, ccz);
    group.add(ledge);
    // a small glass-topped jewellery pad on the counter (the pawned-watch tray)
    const padLat = -cLen * 0.28;
    const padX = ccx + tx * padLat, padZ = ccz + tz * padLat;
    const pad = box(m.glassPad, Math.abs(tx) * 1.0 + Math.abs(inx) * 0.5, 0.14, Math.abs(tz) * 1.0 + Math.abs(inz) * 0.5, padX, cTop + 0.1, padZ);
    group.add(pad);

    // --- the BARRED TELLER WINDOW above the loan end of the counter ---
    // (the security cage every pawn shop runs its cash through — the LOANS desk)
    const loanLat = cLen * 0.3;
    const tellerX = ccx + tx * loanLat, tellerZ = ccz + tz * loanLat;
    const frameTop = box(m.dark, Math.abs(tx) * 1.7 + Math.abs(inx) * 0.16, 0.12, Math.abs(tz) * 1.7 + Math.abs(inz) * 0.16, tellerX, cTop + 1.5, tellerZ);
    group.add(frameTop);
    for (let i = -3; i <= 3; i++) {   // 7 vertical security bars across the window
      const bx = tellerX + tx * (i * 0.22), bz = tellerZ + tz * (i * 0.22);
      const bar = mesh(GG.bar, m.bar, 1, 0.78, 1);   // 0.78m tall bars
      bar.position.set(bx, cTop + 0.92, bz);
      group.add(bar);
    }

    // --- the WALL OF PAWNED GOODS behind the counter (shared-geo junk) ---
    // a shelving cabinet + a guitar, power tools, a TV and a watch tray on it.
    const wDepth = 2 * halfIn - WT - 0.25;
    const wx = ox + inx * (wDepth - halfIn), wz = oz + inz * (wDepth - halfIn);
    const shelfW = Math.min(2 * halfTan - 2 * WT - 0.6, 6.0);
    const cab = box(m.dark, Math.abs(tx) * shelfW + Math.abs(inx) * 0.3, 2.2, Math.abs(tz) * shelfW + Math.abs(inz) * 0.3, wx - inx * 0.05, 1.1, wz - inz * 0.05);
    cab.receiveShadow = true; group.add(cab);
    // two shelf ledges
    for (const sy of [0.85, 1.55]) {
      const sh = box(m.wood, Math.abs(tx) * (shelfW - 0.2) + Math.abs(inx) * 0.34, 0.05, Math.abs(tz) * (shelfW - 0.2) + Math.abs(inz) * 0.34, wx + inx * 0.04, sy, wz + inz * 0.04);
      group.add(sh);
    }
    const place = (lat, y, fn) => { const px = wx + inx * 0.1 + tx * lat, pz = wz + inz * 0.1 + tz * lat; fn(px, pz, y); };
    // a hung GUITAR (red body + neck) — the classic "nobody came back for it"
    place(-shelfW * 0.32, 1.62, (px, pz, y) => {
      const body = mesh(GG.body, m.red, 1, 1.2, 1); body.position.set(px, y, pz); group.add(body);
      const neck = mesh(GG.neck, m.dark, 1, 0.62, 1); neck.position.set(px, y + 0.42, pz); group.add(neck);
    });
    // a POWER DRILL + a tool case
    place(-shelfW * 0.08, 0.95, (px, pz, y) => {
      group.add(box(m.orange, 0.26, 0.16, 0.12, px, y, pz));
      group.add(box(m.steel, 0.04, 0.16, 0.04, px + inx * 0.0 + tx * 0.13, y - 0.04, pz + tz * 0.13));
      group.add(box(m.black, 0.34, 0.12, 0.22, px + tx * 0.36, y - 0.02, pz + tz * 0.36));
    });
    // an old flatscreen TV leaned on the upper shelf
    place(shelfW * 0.16, 1.7, (px, pz, y) => {
      group.add(box(m.black, Math.abs(tx) * 0.7 + Math.abs(inx) * 0.06, 0.42, Math.abs(tz) * 0.7 + Math.abs(inz) * 0.06, px, y, pz));
      group.add(box(m.screen, Math.abs(tx) * 0.6 + Math.abs(inx) * 0.04, 0.32, Math.abs(tz) * 0.6 + Math.abs(inz) * 0.04, px + inx * 0.04, y, pz + inz * 0.04));
    });
    // a tray of pawned WATCHES on the lower shelf
    place(shelfW * 0.34, 0.96, (px, pz, y) => {
      group.add(box(m.dark, 0.5, 0.04, 0.3, px, y - 0.03, pz));
      for (let i = -1; i <= 1; i++) { const f = mesh(GG.face, i === 0 ? m.brass : m.steel); f.rotation.x = Math.PI / 2; f.position.set(px + tx * i * 0.13, y + 0.02, pz + tz * i * 0.13); group.add(f); }
    });

    // --- the buzzing LOANS sign over the teller window ---
    const sign = box(m.neon, Math.abs(tx) * 1.5 + Math.abs(inx) * 0.1, 0.34, Math.abs(tz) * 1.5 + Math.abs(inz) * 0.1, tellerX + inx * 0.1, cTop + 1.85, tellerZ + inz * 0.1);
    group.add(sign);
    const signLabel = tagSprite("$ LOANS · CASH FOR GOLD", "#ffd166", 2.4, 0.5);
    if (signLabel) { signLabel.position.set(tellerX + inx * 0.12, cTop + 1.86, tellerZ + inz * 0.12); group.add(signLabel); }
    const sellLabel = tagSprite("WE BUY · PAWN · SELL", "#9fe0ff", 2.2, 0.46);
    if (sellLabel) { sellLabel.position.set(padX, cTop + 1.2, padZ); group.add(sellLabel); }

    // --- the two transaction desks (where you stand + look + press E) ---
    // SELL at the glass-tray end, PAWN/REDEEM at the barred teller end. Each
    // anchor sits in FRONT of the counter (one step toward the door) so you're
    // never clipping the slab when you transact.
    const front = 1.0;
    S.sellDesk = { mode: "sell", x: padX - inx * front, z: padZ - inz * front,
                   tag: tagSprite("SELL", "#9fe0ff", 0.9, 0.34) };
    S.loanDesk = { mode: "loan", x: tellerX - inx * front, z: tellerZ - inz * front,
                   tag: tagSprite("PAWN", "#ffb23c", 0.9, 0.34) };
    if (S.sellDesk.tag) { S.sellDesk.tag.position.set(padX, cTop + 0.5, padZ); group.add(S.sellDesk.tag); }
    if (S.loanDesk.tag) { S.loanDesk.tag.position.set(tellerX, cTop + 0.5, tellerZ); group.add(S.loanDesk.tag); }

    // keep the counter + cabinet solid for walkers (collider boxes)
    if (CBZ.colliders) {
      CBZ.colliders.push({ minX: ccx - cw / 2, maxX: ccx + cw / 2, minZ: ccz - cd / 2, maxZ: ccz + cd / 2, y0: 0, y1: cTop + 0.1 });
      const cabw = Math.abs(tx) * shelfW + Math.abs(inx) * 0.3, cabd = Math.abs(tz) * shelfW + Math.abs(inz) * 0.3;
      CBZ.colliders.push({ minX: wx - cabw / 2, maxX: wx + cabw / 2, minZ: wz - cabd / 2, maxZ: wz + cabd / 2, y0: 0, y1: 2.2 });
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    }
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
    if (isWorn(name) && n <= 1) { note("That's the only one — and you're wearing it. Take it off first.", 2); return; }
    const p = fencePrice(name);
    if (!e.take(name, 1)) return;
    CBZ.city.addCash(p);
    if (e.bumpFenceRep) e.bumpFenceRep(1);
    if (CBZ.sfx) CBZ.sfx("coin");
    if (p >= 50000 && CBZ.city.big) CBZ.city.big("💰 PAWNED " + name + " for " + fmt$(p) + "!");
    else note("Fenced the " + name + " for " + fmt$(p) + ". (Pawn pays the lowball — that's the price of fast cash.)", 2.2);
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
  function ensurePawnSaveWraps() {
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
    note("Pawned the " + name + " for " + fmt$(o.principal) + ". Redeem for " + fmt$(o.redeem) + " within " + Math.round(o.term) + "s — or it's forfeit.", 3);
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
    if (!CBZ.city.canAfford(t.redeem)) { note("Redeeming the " + t.name + " costs " + fmt$(t.redeem) + " — come back with it.", 2.2); if (CBZ.sfx) CBZ.sfx("glass"); return false; }
    if (!CBZ.city.spend(t.redeem)) return false;
    e.add(t.name, 1);                                          // your item, back in your pocket
    t.forfeit = true; t.redeemed = true;                       // close the ticket
    pruneTickets();
    if (CBZ.sfx) CBZ.sfx("coin");
    note("Redeemed the " + t.name + " for " + fmt$(t.redeem) + " — it's yours again.", 2.4);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    if (CBZ.cityWorldCommit) CBZ.cityWorldCommit();
    return true;
  }
  function forfeit(t) {
    if (!t || t.forfeit) return;
    t.forfeit = true;                                          // the broker keeps the collateral
    const P = CBZ.player;
    if (P && CBZ.city && Math.hypot(P.pos.x - S.cx, P.pos.z - S.cz) < 60)
      note("⏳ The " + t.name + " ticket lapsed — forfeited to the broker.", 2.4);
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

  // ---- the look-pick + [E] prompt --------------------------------------------
  function inStore() {
    const P = CBZ.player, b = S.b;
    if (!P || !b) return false;
    const ox = (b.ox != null ? b.ox : S.lot.cx), oz = (b.oz != null ? b.oz : S.lot.cz);
    const W = b.w || 10, D = b.d || 10;
    return Math.abs(P.pos.x - ox) < W / 2 + 1.5 && Math.abs(P.pos.z - oz) < D / 2 + 1.5;
  }
  function pickDesk() {
    if (!inStore()) return null;
    const P = CBZ.player;
    const yaw = CBZ.cam ? CBZ.cam.yaw : 0, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let best = null, bestScore = -1;
    for (const desk of [S.sellDesk, S.loanDesk]) {
      if (!desk) continue;
      const dx = desk.x - P.pos.x, dz = desk.z - P.pos.z, d = Math.hypot(dx, dz);
      if (d > REACH || d < 0.05) continue;
      const dot = (dx / d) * fx + (dz / d) * fz;
      if (dot < LOOK_DOT) continue;
      const score = dot - d * 0.05;
      if (score > bestScore) { bestScore = score; best = desk; }
    }
    return best;
  }

  function sellPromptText() {
    const list = sellable();
    if (!list.length) return "<span style='color:#7f8794'>Nothing to fence — bring me gold, watches, stones.</span>";
    const top = list[0], p = fencePrice(top.name);
    let extra = "";
    if (list.length > 1) { let t = 0; for (const s of list) t += fencePrice(s.name) * s.n; extra = " <span style='color:#7f8794'>· [G] sell everything — " + fmt$(t) + "</span>"; }
    const nn = top.n > 1 ? " ×" + top.n : "";
    return "<b style='color:#9fe0ff'>[E]</b> Pawn-sell " + top.name + nn + " <span style='color:#7ed957'>" + fmt$(p) + "</span> <span style='color:#7f8794'>· broker's lowball, gone for good</span>" + extra;
  }
  function loanPromptText() {
    const live = liveTickets();
    // REDEEM mode (cycle with [F]) — only meaningful when you hold tickets.
    if (S.mode === "redeem" && live.length) {
      const t = live[S.redeemIdx % live.length];
      const left = Math.max(0, Math.round(t.expires - now()));
      const cyc = live.length > 1 ? " <span style='color:#7f8794'>· [F] next ticket (" + ((S.redeemIdx % live.length) + 1) + "/" + live.length + ")</span>" : "";
      return "<b style='color:#ffd166'>[E]</b> Redeem " + t.name + " <span style='color:#7ed957'>" + fmt$(t.redeem) + "</span> <span style='color:#ff9e9e'>· " + left + "s left</span>" + cyc;
    }
    // PAWN-NEW mode (the default). Offer the priciest pawnable in your pockets.
    const list = sellable();
    const toggle = live.length ? " <span style='color:#7f8794'>· [F] redeem tickets (" + live.length + ")</span>" : "";
    if (!list.length) return "<span style='color:#7f8794'>Bring me something to lend against — gold, a watch, a stone.</span>" + toggle;
    const top = list[0], o = loanOffer(top.name);
    return "<b style='color:#ffb23c'>[E]</b> Pawn " + top.name + " for <span style='color:#7ed957'>" + fmt$(o.principal) + "</span> <span style='color:#7f8794'>· redeem " + fmt$(o.redeem) + " in " + Math.round(o.term) + "s, else forfeit</span>" + toggle;
  }
  function promptText(desk) { return desk.mode === "sell" ? sellPromptText() : loanPromptText(); }

  function promptEl() {
    if (S.prompt) return S.prompt;
    if (typeof document === "undefined" || !document.body) return null;
    const d = document.createElement("div");
    d.id = "pawnPrompt";
    d.style.cssText = "position:fixed;left:50%;bottom:150px;transform:translateX(-50%);z-index:46;display:none;" +
      "background:rgba(13,16,21,.9);border:1px solid #3a4150;border-radius:12px;padding:7px 14px;color:#e8eef7;" +
      "font-family:Fredoka,system-ui,sans-serif;font-size:15px;pointer-events:auto;cursor:pointer;text-align:center;max-width:78vw";
    d.addEventListener("click", function () { if (S.cur) actOn(S.cur); });   // tap-to-act (mobile)
    document.body.appendChild(d);
    S.prompt = d;
    return d;
  }
  function showPrompt(txt) {
    const el = promptEl(); if (!el) return;
    if (txt !== S.lastTxt) { el.innerHTML = txt; S.lastTxt = txt; }
    if (el.style.display !== "block") el.style.display = "block";
  }
  function hidePrompt() {
    if (S.prompt && S.prompt.style.display !== "none") S.prompt.style.display = "none";
    S.cur = null;
  }

  function actOn(desk) {
    if (!desk) return;
    if (desk.mode === "sell") {
      const list = sellable(); if (list.length) sellOne(list[0].name);
      return;
    }
    // loan desk
    const live = liveTickets();
    if (S.mode === "redeem" && live.length) { redeemTicket(live[S.redeemIdx % live.length]); return; }
    const list = sellable(); if (list.length) pawnLoan(list[0].name);
  }
  // [F] at the loan desk toggles pawn-new ↔ redeem, and cycles tickets.
  function cycle() {
    if (!S.cur || S.cur.mode !== "loan") return;
    const live = liveTickets(); if (!live.length) { S.mode = ""; return; }
    if (S.mode !== "redeem") { S.mode = "redeem"; S.redeemIdx = 0; }
    else { S.redeemIdx = (S.redeemIdx + 1) % live.length; if (S.redeemIdx === 0) S.mode = ""; }   // wrap back to pawn-new
  }

  // ---- find the lot + build once (self-healing, gunstore pattern) ------------
  function ensure() {
    const arena = CBZ.city && CBZ.city.arena;
    if (S.built) {
      if (S.arena === arena) return true;
      S.built = false; S.group = null; S.lot = null; S.b = null; S.cur = null; S.sellDesk = null; S.loanDesk = null;
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
    if (!g || g.mode !== "city") { if (S.group && S.group.visible) S.group.visible = false; hidePrompt(); return; }
    if (!ensure()) return;

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
    if (!near || g.state !== "playing" || P.dead || P.driving || CBZ.cityMenuOpen) { hidePrompt(); return; }

    const desk = pickDesk();
    if (!desk) { hidePrompt(); return; }
    // leaving the loan desk drops any redeem cycle so you re-arrive in pawn-new
    if (S.cur && S.cur.mode === "loan" && desk.mode !== "loan") S.mode = "";
    S.cur = desk;
    showPrompt(promptText(desk));
  });

  // [E] transacts at the desk you're looking at; [G] sells everything at the
  // sell desk; [F] toggles/cycles redeem at the loan desk. CAPTURE phase so the
  // counter wins the key over interact.js's bubble listener, and
  // stopImmediatePropagation keeps one press from ALSO opening the clerk menu.
  addEventListener("keydown", function (e) {
    if (!S.cur || !g || g.mode !== "city" || g.state !== "playing") return;
    if (CBZ.cityMenuOpen || (CBZ.player && (CBZ.player.driving || CBZ.player.dead))) return;
    const k = (e.key || "").toLowerCase();
    if (k === "e") {
      e.preventDefault(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); e.stopPropagation();
      actOn(S.cur); return;
    }
    if (k === "g" && S.cur.mode === "sell") {
      e.preventDefault(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); e.stopPropagation();
      const list = sellable(); for (const s of list) for (let i = 0; i < s.n; i++) { if (isWorn(s.name) && (econ().count(s.name) <= 1)) break; sellOne(s.name); }
      return;
    }
    if (k === "f" && S.cur.mode === "loan") {
      e.preventDefault(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); e.stopPropagation();
      cycle(); showPrompt(promptText(S.cur)); return;
    }
  }, true);

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
