/* ============================================================
   city/cashstore.js — CASH_STORE_V1: THE PLACE THE MONEY BECOMES YOURS.

   OWNER (2026-08-02, verbatim): "drive [the stolen money] to a plot like the
   plot we put the fake pentagon on. they can buy a warehouse on a plot like
   this and then can store their money like gta — but gta is fake, you do
   choreographed mini-missions. this is interaction/animation options and
   physical assets… only driving to your own place can store the cash, not
   just rob… maybe you have a cargo plane there and then can load it up and
   fly somewhere else to a house you can buy with the z key. do you feel how
   all these features connect when all are built with real physical assets
   and have real effect on the game."

   THE LOOP THIS CLOSES, end to end, with no cutscene in it anywhere:
     rob a vault  →  the money is CANVAS DUFFELS on the floor (city/inventory
     .js's CBZ.cashBags)  →  you carry them ONE AT A TIME, no sprint, no gun
     →  you load a bed or a cargo hold  →  you DRIVE OR FLY to a plot you own
     →  each bag goes on a rack and STAYS THERE, visible, countable, robbable
     →  and only then is it wealth.

   WHY THIS FILE EXISTS AT ALL. Before it, `CBZ.cashBags` was a one-way
   street: bank.js and armored.js could turn a balance into duffels and
   NOTHING anywhere turned a duffel back into money. That was deliberate —
   inventory.js's header names "a warehouse that counts what you stored" as
   the missing half — and this is that half. The rule it keeps is the rule
   that made the bags worth building: **nothing auto-banks.** Walking over a
   bag does nothing. Driving past your own gate does nothing. A deliberate
   verb, at a place you own, with the bag on your shoulder, is the only path.

   WHAT THIS FILE DOES NOT AUTHOR, because somebody else already does:
     • the plot, the fence, the shed, the dock, the racks — city/govcomplex
       .js's `freeport` COMPLEXES row (its `site.warehouse` publishes every
       coordinate used here; this file re-derives none of them).
     • the bags — city/inventory.js. We only ever `take()` and `spawn()`.
     • the money ledger — city/shops.js's CBZ.cityTill. The stash is DECLARED
       as a till source, so the value on the racks is a first-class balance
       something else can come and take (the crew does, below).
     • ownership plumbing — city/storage.js's property ledger. The Freeport
       is a fourth PROPERTIES row there, so it inherits the vehicle bays, the
       ammo locker, the [G] menu and the save slot for free.
     • the crew's cut — city/heists.js's CBZ.cityHeistPayCrew, the same
       routing an abstract score has always used.

   THE THREE DESIGN CALLS, stated so the next person can argue with them:

   1. BAGS BUY THE BUILDING. A vault haul is unbankable until you own a place
      to bank it, and the place costs $1.75M — a chicken-and-egg that would
      have made the first score worthless. So the sale office takes DUFFELS:
      every bag you set down on the counter is money DOWN, and when the
      escrow covers the price the yard is yours. Physical money buying
      physical property, and no dollar is ever minted — a bag consumed into
      escrow is deleted from the world exactly like a bag consumed onto a
      shelf.
   2. THE RACK IS BETTER THAN THE BANK, AND RISKIER. Stored cash counts at
      100%; wiring it to your account is free for clean notes. What the racks
      cost you is exposure: the stash is a declared till source with a real
      balance and a real drain, so anything that can take money can take
      THIS money. There is no fee anywhere in this file for keeping it — the
      risk IS the price, which is the shape city/shops.js already uses ("the
      emptiness IS the cooldown").
   3. DYE-STAINED NOTES ARE ACCEPTED AND DISCOUNTED — never refused. A dye
      pack has already burned part of the bag (inventory.js's `dye()`); what
      is left is real money that no counter will take at face. So it goes on
      the rack at full stored value, it is COUNTED SEPARATELY, and wiring it
      out costs a 30% fence cut. Refusing it would have deleted money twice
      for one dye pack, and pretending it was clean would have made the dye
      pack cosmetic.

   Exposes: CBZ.cashStore, CBZ.warehouseAudit, CBZ.cashStoreReset.
   Flags:   CASH_STORE_V1 (this file), WAREHOUSE_COMPLEX_V1 (the plot).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});

  // FLAGS DEFAULTED HERE, never in src/config.js — a one-line revert that
  // lives with the code it reverts. CASH_STORE_V1 off = no verbs, no state,
  // no meshes (the plot still stands; it is just a yard). WAREHOUSE_COMPLEX_V1
  // off = govcomplex.js's row never claims land either.
  if (CFG.CASH_STORE_V1 == null) CFG.CASH_STORE_V1 = true;
  if (CFG.WAREHOUSE_COMPLEX_V1 == null) CFG.WAREHOUSE_COMPLEX_V1 = true;
  function on() { return CFG.CASH_STORE_V1 !== false; }

  // ---- the economy numbers, and the arithmetic behind each -----------------
  // $1.75M sits deliberately between the casino floor ($1.2M, wealth.js's
  // second-biggest sink) and the REIT tower ($3.5M, its biggest): more than
  // any single building you can buy, less than owning a skyline. It is also
  // roughly one reserve-vault job in bags, which is the point — the first big
  // score buys the place that lets you keep the second one.
  const PRICE = 1750000;
  // What a fence takes to wash dye-stained notes into an account. Nothing is
  // charged to STORE them; this is only ever paid on the way out.
  const STAINED_FEE = 0.30;
  // A house is not a warehouse. Three duffels is a floor safe and a wardrobe
  // — enough that flying a load home means something, few enough that the
  // yard is still where the money lives.
  const HOME_CAP = 3;
  const REACH_SALE = 7.0;      // the sale office counter / for-sale board
  const REACH_DOCK = 16.0;     // "unload here" — a truck's length from the dock
  const REACH_SAFE = 3.6;      // standing at a home safe
  const HOME_NEAR = 60;        // how close before a home safe is built/visible

  function money(n) { n = Math.round(n || 0); return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US"); }
  function note(m, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(m, s); }
  function big(m) { if (CBZ.city && CBZ.city.big) CBZ.city.big(m); }
  function sfx(n) { if (CBZ.sfx) { try { CBZ.sfx(n); } catch (e) {} } }
  function arenaRoot() { const A = CBZ.city && CBZ.city.arena; return (A && A.root) || null; }
  function floorY(x, z) { if (CBZ.floorAt) { try { return CBZ.floorAt(x, z) || 0; } catch (e) {} } return 0; }

  /* ============================================================
     STATE — one plain, JSON-safe object. Live meshes are kept OUT of it
     (a parallel array) so a save can never try to stringify a THREE node.
     ============================================================ */
  function S() {
    if (!g.cityCashStore) g.cityCashStore = {};
    const s = g.cityCashStore;
    if (!Array.isArray(s.bags)) s.bags = [];       // the racks: [{a, dyed}]
    if (!s.homes || typeof s.homes !== "object") s.homes = {};   // {propId:[{a,dyed}]}
    if (s.escrow == null) s.escrow = 0;
    if (s.owned == null) s.owned = false;          // the degrade-safe mirror
    if (s.crewDebt == null) s.crewDebt = 0;
    if (s.crewPaid == null) s.crewPaid = 0;
    if (s.banked == null) s.banked = 0;
    if (s.deposits == null) s.deposits = 0;
    if (s.stainedSunk == null) s.stainedSunk = 0;
    return s;
  }

  // OWNERSHIP HAS ONE HOME AND IT IS city/storage.js. That file already owns
  // the property ledger, the [G] menu and the save slot; keeping a second
  // boolean here would be the parallel-bookkeeping trap. The local mirror is
  // only ever the answer when storage.js is absent from the build.
  function owned() {
    if (CBZ.cityStorage && CBZ.cityStorage.owns) {
      try { return !!CBZ.cityStorage.owns("freeport"); } catch (e) {}
    }
    return !!S().owned;
  }
  function grantOwnership() {
    S().owned = true;
    if (CBZ.cityStorage && CBZ.cityStorage.grant) { try { CBZ.cityStorage.grant("freeport"); } catch (e) {} }
  }

  /* ============================================================
     PERSISTENCE — the slice rides the world ledger worldstate.js already
     saves. Hydrated ONCE per run behind a game-object guard (the exact
     pattern city/storage.js uses for w.storage).
     ============================================================ */
  function snapshot() {
    const s = S();
    return {
      owned: !!s.owned, escrow: s.escrow | 0,
      bags: s.bags.map(function (b) { return { a: b.a | 0, dyed: !!b.dyed }; }),
      homes: (function () {
        const o = {};
        for (const k in s.homes) {
          const L = s.homes[k]; if (!L || !L.length) continue;
          o[k] = L.map(function (b) { return { a: b.a | 0, dyed: !!b.dyed }; });
        }
        return o;
      })(),
      crewDebt: s.crewDebt | 0, crewPaid: s.crewPaid | 0,
      banked: s.banked | 0, deposits: s.deposits | 0, stainedSunk: s.stainedSunk | 0,
    };
  }
  function persist() {
    if (!CBZ.cityWorldEnsure) return;
    let w = null;
    try { w = CBZ.cityWorldEnsure(); } catch (e) { w = null; }
    if (!w) return;
    // stamp the live ledger, then let worldstate's own commit write the slot.
    // (worldstate.js's commit() ALSO stamps this, off snapshot(), so the 5 s
    // autosave and the multiplayer collector carry it without this call —
    // this one just makes a deposit hit the disk the instant it happens.)
    w.cashStore = snapshot();
    if (CBZ.cityWorldCommit) { try { CBZ.cityWorldCommit(); } catch (e) {} }
  }
  function hydrate() {
    S();
    if (g._cityCashStoreHydrated) return;
    g._cityCashStoreHydrated = true;
    if (!CBZ.cityWorldEnsure) return;
    let w = null;
    try { w = CBZ.cityWorldEnsure(); } catch (e) { w = null; }
    const src = w && w.cashStore;
    if (!src) return;
    const s = S();
    s.owned = !!src.owned;
    s.escrow = src.escrow | 0;
    s.crewDebt = src.crewDebt | 0; s.crewPaid = src.crewPaid | 0;
    s.banked = src.banked | 0; s.deposits = src.deposits | 0;
    s.stainedSunk = src.stainedSunk | 0;
    if (Array.isArray(src.bags)) s.bags = src.bags.map(function (b) { return { a: b.a | 0, dyed: !!b.dyed }; });
    if (src.homes) {
      s.homes = {};
      for (const k in src.homes) {
        if (!Array.isArray(src.homes[k])) continue;
        s.homes[k] = src.homes[k].map(function (b) { return { a: b.a | 0, dyed: !!b.dyed }; });
      }
    }
    _dirty = true;
  }

  /* ============================================================
     THE SITE — read LIVE off govcomplex.js's published record. Nothing is
     cached across a rebuild: CBZ.govComplexes is replaced wholesale by the
     landmass pass, so asking every time is both correct and cheap.
     ============================================================ */
  function site() {
    const L = CBZ.govComplexes;
    if (!L || !L.length) return null;
    for (let i = 0; i < L.length; i++) if (L[i] && L[i].id === "freeport" && L[i].warehouse) return L[i];
    return null;
  }
  function wh() { const s = site(); return s ? s.warehouse : null; }
  function inside(x, z) {
    const W = wh(); if (!W || !W.inside) return false;
    const b = W.inside;
    return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
  }
  function near(p, x, z, r) { return !!p && (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) <= r * r; }
  function atDock(x, z) { const W = wh(); return !!W && near(W.dock, x, z, REACH_DOCK); }
  function atSale(x, z) {
    const W = wh(); if (!W) return false;
    return near(W.board, x, z, REACH_SALE) || (W.door && near(W.door, x, z, REACH_SALE));
  }
  // ON THE PLOT AT ALL — the gate-side courtesy line and the audit's reach.
  function onPlot(x, z) {
    const s = site();
    if (!s || !s.rect) return false;
    const R = s.rect;
    return x >= R.minX && x <= R.maxX && z >= R.minZ && z <= R.maxZ;
  }

  /* ============================================================
     THE STASH — value, and the ONE writer that removes it.
     ============================================================ */
  function valueOf(list) { let v = 0; for (let i = 0; i < list.length; i++) v += list[i].a | 0; return v; }
  function stainedOf(list) { let v = 0; for (let i = 0; i < list.length; i++) if (list[i].dyed) v += list[i].a | 0; return v; }
  function shelfCap() { const W = wh(); return W && W.shelves ? W.shelves.length : 0; }
  function stored() {
    const s = S(), v = valueOf(s.bags), st = stainedOf(s.bags);
    return { bags: s.bags.length, cap: shelfCap(), value: v, clean: v - st, stained: st };
  }

  /* REMOVE `n` DOLLARS FROM THE RACKS, physically: whole duffels come off
     first (dirtiest first — you hand over the marked notes before the clean
     ones, which is what anybody would do), and the last one is left lighter
     rather than being rounded away. Returns what actually came off, so a
     caller can never take more than exists. This is the `drain` the till
     declaration below hands to city/shops.js. */
  function removeValue(n, preferDyed) {
    const s = S();
    n = Math.max(0, Math.round(n || 0));
    let got = 0;
    while (n > 0 && s.bags.length) {
      let idx = -1;
      if (preferDyed !== false) for (let i = 0; i < s.bags.length; i++) if (s.bags[i].dyed) { idx = i; break; }
      if (idx < 0) idx = s.bags.length - 1;
      const b = s.bags[idx];
      if (b.a <= n) { got += b.a; n -= b.a; s.bags.splice(idx, 1); }
      else { b.a -= n; got += n; n = 0; }
    }
    if (got > 0) { _dirty = true; persist(); }
    return got;
  }

  /* THE STASH IS A DECLARED TILL SOURCE. city/shops.js's CBZ.cityTill is the
     one ledger in this game that answers "how much money is really in this
     place", and roofloot.js proved the shape: bind `amount` and `drain` to a
     balance SOMEBODY ELSE owns and keep no mirror. The somebody else here is
     the rack list above. The first consumer is the crew, below — they come
     and take their cut off the shelf — and every future one (a rival set
     turning the yard over, a federal seizure) gets a real balance for free. */
  const TILL_SRC = { cx: 0, cz: 0, kind: "stash", building: { name: "Your Freeport stash" } };
  let _tillDeclared = false;
  function ensureTill() {
    if (_tillDeclared || !CBZ.cityTill || !CBZ.cityTill.declare) return;
    _tillDeclared = true;
    CBZ.cityTill.declare(TILL_SRC, {
      name: "the Freeport racks", kind: "stash", point: "vault",
      amount: function () { return owned() ? valueOf(S().bags) : 0; },
      drain: function (n) { removeValue(n, true); },
    });
  }
  function tillTake(max) {
    ensureTill();
    const W = wh();
    if (W) { TILL_SRC.cx = W.origin.x; TILL_SRC.cz = W.origin.z; }
    if (CBZ.cityTill && CBZ.cityTill.take) {
      try { return CBZ.cityTill.take(TILL_SRC, { max: max }).taken | 0; } catch (e) {}
    }
    return removeValue(max, true);      // degrade: the same write, no ledger
  }

  /* ============================================================
     THE CREW'S CUT — settled the moment the score is really banked.

     city/heists.js records `crewOwed` on a PHYSICAL bank job and pays
     nothing, because at that moment nothing has been paid: the money is
     canvas on your shoulder. Its header says the debt "settles when the bags
     are actually converted — the warehouse/cargo wave that consumes
     CBZ.cashBags is where that lands." This is that landing.

     It is settled by TAKING IT OFF THE RACK through the till, not by
     deducting a number: the crew physically carry their duffels out of your
     yard, and the payment itself goes through heists.js's own routing (gang
     treasury / factions contribution / your pocket if you are the crew), so
     there is no second crew-payment implementation anywhere.
     ============================================================ */
  function oweCrew(amount, why) {
    amount = Math.max(0, Math.round(amount || 0));
    if (!amount) return 0;
    const s = S();
    s.crewDebt += amount;
    persist();
    return s.crewDebt;
  }
  function settleCrew(quiet) {
    const s = S();
    if (!(s.crewDebt > 0) || !s.bags.length) return 0;
    const paid = tillTake(Math.min(s.crewDebt, valueOf(s.bags)));
    if (paid <= 0) return 0;
    s.crewDebt = Math.max(0, s.crewDebt - paid);
    s.crewPaid += paid;
    let routed = false;
    if (CBZ.cityHeistPayCrew) { try { CBZ.cityHeistPayCrew(paid); routed = true; } catch (e) {} }
    if (!routed) {
      // degrade: heists.js absent from this build — the crew still gets paid,
      // through the treasury it would have used.
      if (g.playerGang) g.playerGang.treasury = (g.playerGang.treasury || 0) + paid;
      else if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(paid);
    }
    if (!quiet) note("The crew took their cut off the rack — " + money(paid) +
      (s.crewDebt > 0 ? " (" + money(s.crewDebt) + " still owed)" : "") + ".", 2.8);
    persist();
    return paid;
  }

  /* ============================================================
     THE MESHES — one duffel on one shelf per stored bag.
     ============================================================ */
  let _meshes = [], _meshRoot = null, _dirty = true;
  function bagMesh(rec) {
    let m = null;
    if (CBZ.itemAsset) {
      try {
        m = CBZ.itemAsset(null, null, {
          kind: "moneybag",
          canvas: rec.dyed ? 0x7a2a26 : 0x2f3a2c,
          note: rec.dyed ? 0x8c4a44 : 0x6fae5a,
          flash: 0xc9a227,
        });
      } catch (e) { m = null; }
    }
    if (!m && THREE) {
      // degrade: still a bag-shaped object, never an invisible pile
      m = new THREE.Group();
      const mat = CBZ.cmat ? CBZ.cmat(rec.dyed ? 0x7a2a26 : 0x2f3a2c) : new THREE.MeshLambertMaterial({ color: 0x2f3a2c });
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.30, 0.72), mat);
      b.position.y = 0.16; m.add(b);
    }
    if (m) {
      // the same log scale inventory.js gives a live bag, so a fat duffel on
      // the rack reads as the fat duffel you carried in.
      const k = Math.max(0.86, Math.min(1.30, 0.86 + 0.13 * Math.log10(Math.max(1, rec.a) / 50000 + 1) * 2));
      m.scale.setScalar(k);
      m.userData.transient = true;
    }
    return m;
  }
  function clearMeshes() {
    for (let i = 0; i < _meshes.length; i++) {
      const m = _meshes[i];
      if (m && m.parent) m.parent.remove(m);
    }
    _meshes.length = 0;
  }
  function rebuildMeshes() {
    const root = arenaRoot();
    if (!root || !THREE) return;
    if (root !== _meshRoot) { clearMeshes(); _meshRoot = root; }
    const W = wh();
    clearMeshes();
    if (!W || !owned()) return;
    const s = S(), slots = W.shelves || [];
    for (let i = 0; i < s.bags.length && i < slots.length; i++) {
      const sl = slots[i];
      const m = bagMesh(s.bags[i]);
      if (!m) continue;
      m.position.set(sl.x, sl.y, sl.z);
      // alternate the lie of the duffel so a full rack is not a comb
      m.rotation.y = (i % 2) ? 0.12 : -0.09;
      root.add(m);
      _meshes.push(m);
    }
  }

  /* ---- the HOME safe: a steel box just inside the door of a house you
     bought on [Z], and the duffels stacked beside it. Built lazily when you
     are near enough to see it, dropped when you are not. */
  let _homeVis = null;      // {id, grp, n}
  function homeAnchor(h) {
    // 2.6 m inside the threshold, on the line from the door to the lot centre
    // — no door-normal convention to agree with, so it is right on any lot.
    let dx = (h.cx - h.x), dz = (h.cz - h.z);
    const d = Math.hypot(dx, dz) || 1;
    dx /= d; dz /= d;
    return { x: h.x + dx * 2.6, z: h.z + dz * 2.6, fx: dx, fz: dz };
  }
  function buildHomeVisual(h) {
    const root = arenaRoot(); if (!root || !THREE) return;
    dropHomeVisual();
    const a = homeAnchor(h), y = floorY(a.x, a.z);
    const grp = new THREE.Group();
    grp.position.set(a.x, y, a.z);
    // FACE THE DOOR. `a.fx/fz` points from the threshold into the room, so the
    // group's +Z (the face the dial is on) turns back the way you came in —
    // otherwise you walk up to the blank back of your own safe.
    grp.rotation.y = Math.atan2(-a.fx, -a.fz);
    grp.userData.transient = true;
    const steel = CBZ.cmat ? CBZ.cmat(0x3c4046) : new THREE.MeshLambertMaterial({ color: 0x3c4046 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.82, 0.62), steel);
    body.position.y = 0.41; grp.add(body);
    const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 10),
      CBZ.cmat ? CBZ.cmat(0xd0c088) : new THREE.MeshLambertMaterial({ color: 0xd0c088 }));
    dial.rotation.x = Math.PI / 2; dial.position.set(0, 0.46, 0.33); grp.add(dial);
    const list = S().homes[h.id] || [];
    for (let i = 0; i < list.length && i < HOME_CAP; i++) {
      const m = bagMesh(list[i]);
      if (!m) continue;
      m.position.set(0.75 + i * 0.5, 0, -0.1 + (i % 2) * 0.22);
      m.rotation.y = 0.4 + i * 0.3;
      grp.add(m);
    }
    root.add(grp);
    _homeVis = { id: h.id, grp: grp, n: list.length };
  }
  function dropHomeVisual() {
    if (_homeVis && _homeVis.grp && _homeVis.grp.parent) _homeVis.grp.parent.remove(_homeVis.grp);
    _homeVis = null;
  }
  // the owned house you are standing in/at, if any
  function homeAt(x, z) {
    if (!CBZ.cityRealtyOwnedHomes) return null;
    let list = null;
    try { list = CBZ.cityRealtyOwnedHomes(); } catch (e) { list = null; }
    if (!list || !list.length) return null;
    let best = null, bd = REACH_SAFE * REACH_SAFE;
    for (let i = 0; i < list.length; i++) {
      const h = list[i], a = homeAnchor(h);
      const d = (a.x - x) * (a.x - x) + (a.z - z) * (a.z - z);
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }
  function homeNear(x, z, r) {
    if (!CBZ.cityRealtyOwnedHomes) return null;
    let list = null;
    try { list = CBZ.cityRealtyOwnedHomes(); } catch (e) { list = null; }
    if (!list || !list.length) return null;
    let best = null, bd = r * r;
    for (let i = 0; i < list.length; i++) {
      const h = list[i];
      const d = (h.x - x) * (h.x - x) + (h.z - z) * (h.z - z);
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }
  function homeList(id) { const s = S(); return (s.homes[id] = s.homes[id] || []); }

  /* ============================================================
     THE VERBS. Every one of them takes a PHYSICAL bag and gives back a
     physical consequence; none of them can be triggered by walking.
     ============================================================ */

  // WHERE WOULD THE BAG ON MY SHOULDER GO IF I PUT IT DOWN HERE? One answer
  // for the whole UI, so the label the player reads and the thing that
  // happens can never disagree.
  function stowTarget() {
    const P = CBZ.player;
    if (!on() || !P || !P.pos) return null;
    const x = P.pos.x, z = P.pos.z;
    const W = wh();
    if (W) {
      if (!owned()) {
        if (atSale(x, z)) return { kind: "escrow" };
        return null;
      }
      if (inside(x, z)) {
        if (S().bags.length >= shelfCap()) return { kind: "full" };
        return { kind: "shelf" };
      }
      if (atDock(x, z)) return { kind: "dock" };
    }
    const h = homeAt(x, z);
    if (h) return { kind: homeList(h.id).length >= HOME_CAP ? "homefull" : "home", home: h };
    return null;
  }
  function stowLabel() {
    const t = stowTarget();
    if (!t) return null;
    const b = CBZ.cashBags && CBZ.cashBags.carried();
    const amt = b ? money(b.amount) : "the bag";
    if (t.kind === "escrow") return "Put " + amt + " down as money on the yard (" + money(remaining()) + " to go)";
    if (t.kind === "shelf") return "Stow " + amt + " on the rack";
    if (t.kind === "dock") return "Set " + amt + " down on the dock";
    if (t.kind === "home") return "Into the floor safe — " + amt;
    if (t.kind === "full") return "The racks are full — wire some out first";
    if (t.kind === "homefull") return "The floor safe is full (" + HOME_CAP + " bags)";
    return null;
  }

  // put the carried bag wherever `stowTarget` said it would go
  function stowCarried() {
    if (!on()) return false;
    const CBg = CBZ.cashBags;
    const bag = CBg && CBg.carried();
    if (!bag) { note("Nothing on your shoulder.", 1.5); return false; }
    const t = stowTarget();
    if (!t) { note("Not your place — you can only store cash somewhere you own.", 2.2); return false; }
    if (t.kind === "full") { note("Every rack slot is full. Wire some of it out and come back.", 2.6); return false; }
    if (t.kind === "homefull") { note("The floor safe only takes " + HOME_CAP + " bags. The yard takes the rest.", 2.6); return false; }
    if (t.kind === "dock") { CBg.drop(); note("On the dock. Carry it inside to bank it.", 2.0); return true; }
    const dyed = !!bag.dyed;
    const amt = CBg.take(bag) | 0;        // the bag leaves the world, for a value
    if (amt <= 0) return false;
    if (t.kind === "escrow") return payEscrow(amt, dyed);
    if (t.kind === "home") return putHome(t.home, amt, dyed);
    return putShelf(amt, dyed);
  }

  function putShelf(amt, dyed) {
    const s = S();
    s.bags.push({ a: amt, dyed: !!dyed });
    s.deposits++;
    _dirty = true;
    sfx("coin");
    const st = stored();
    big("STORED " + money(amt));
    note("Freeport racks: " + st.bags + "/" + st.cap + " bags · " + money(st.value) +
      (st.stained ? " (" + money(st.stained) + " stained)" : ""), 2.8);
    persist();
    settleCrew(false);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  }
  function putHome(h, amt, dyed) {
    const L = homeList(h.id);
    L.push({ a: amt, dyed: !!dyed });
    S().deposits++;
    sfx("coin");
    big("IN THE SAFE — " + money(amt));
    note(h.name + ": " + L.length + "/" + HOME_CAP + " bags · " + money(valueOf(L)), 2.6);
    persist();
    buildHomeVisual(h);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  }

  /* THE BULK VERB — "unload everything here". It is a CONVENIENCE, never a
     capability: every bag it moves is one you could have carried in by hand,
     and it only ever reaches bags that are physically AT the dock, either
     lying on it or strapped in a hold parked against it. The cargo-hold API
     is feature-detected (the sibling wave owns it); with no hold in the
     build, the loose-bag sweep alone still works, which is the whole reason
     it is written as a radius rather than as a hold query. */
  function unloadHere() {
    if (!on()) return 0;
    const P = CBZ.player; if (!P || !P.pos) return 0;
    if (!owned()) { note("Buy the yard first — this is somebody else's dock.", 2.2); return 0; }
    const CBg = CBZ.cashBags;
    if (!CBg || !CBg.list) return 0;
    const W = wh(); if (!W) return 0;
    if (!atDock(P.pos.x, P.pos.z) && !inside(P.pos.x, P.pos.z)) { note("Get to the loading dock.", 1.8); return 0; }
    const list = CBg.list();
    let moved = 0, value = 0, held = 0;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (!b || b.carried || b.air) continue;
      if (S().bags.length >= shelfCap()) break;
      const d = Math.hypot(b.x - W.dock.x, b.z - W.dock.z);
      const inHold = !!b._heldBy || !!(CBZ.vehicleHoldAt && CBZ.vehicleHoldAt(b.x, b.y, b.z));
      if (d > REACH_DOCK + (inHold ? 8 : 0) && !inside(b.x, b.z)) continue;
      if (inHold && CBZ.vehicleHoldRelease) { try { CBZ.vehicleHoldRelease(b); } catch (e) {} }
      const dyed = !!b.dyed;
      const amt = CBg.take(b) | 0;
      if (amt <= 0) continue;
      S().bags.push({ a: amt, dyed: dyed });
      moved++; value += amt; if (inHold) held++;
    }
    if (!moved) { note("Nothing to unload here — bags have to be ON the dock.", 2.2); return 0; }
    S().deposits += moved;
    _dirty = true;
    sfx("coin");
    const st = stored();
    big("UNLOADED " + moved + " BAGS — " + money(value));
    note("Freeport racks: " + st.bags + "/" + st.cap + " · " + money(st.value) +
      (held ? " (" + held + " out of the hold)" : ""), 3.0);
    persist();
    settleCrew(false);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return moved;
  }

  // TAKE ONE BACK. The stash is not a one-way box: a duffel comes off the
  // rack as a real bag in the world, exactly the object that went on.
  function pullBag() {
    if (!on() || !owned()) return false;
    const s = S();
    if (!s.bags.length) { note("The racks are empty.", 1.6); return false; }
    const P = CBZ.player; if (!P || !P.pos) return false;
    const CBg = CBZ.cashBags;
    const rec = s.bags.pop();
    _dirty = true;
    if (CBg && CBg.spawn) {
      const yaw = (CBZ.cam && CBZ.cam.yaw) || 0;
      const x = P.pos.x - Math.sin(yaw) * 1.1, z = P.pos.z - Math.cos(yaw) * 1.1;
      const b = CBg.spawn(x, floorY(x, z), z, rec.a, { src: "freeport", srcName: "your stash", dyed: rec.dyed });
      if (!b) { s.bags.push(rec); note("No room for another loose bag out here.", 2.0); return false; }
    } else if (CBZ.city && CBZ.city.addCash) {
      CBZ.city.addCash(rec.a);            // degrade: no bag system, no bag
    }
    note("Off the rack: " + money(rec.a) + (rec.dyed ? " — stained notes." : "."), 2.2);
    persist();
    return true;
  }

  /* WIRE IT OUT. Your own building, your own money: clean notes go to the
     account at face. Stained notes have to go through somebody, and that
     somebody takes 30% — the only fee in this file, and it exists because a
     dye pack has to keep costing something after the bag is safe. */
  function bankIt() {
    if (!on() || !owned()) return 0;
    const s = S();
    const st = stored();
    if (!st.value) { note("Nothing on the racks to wire.", 1.8); return 0; }
    settleCrew(true);
    const after = stored();
    const fee = Math.round(after.stained * STAINED_FEE);
    const net = after.clean + after.stained - fee;
    s.bags.length = 0; _dirty = true;
    g.cityBank = (g.cityBank || 0) + net;
    s.banked += net; s.stainedSunk += fee;
    sfx("coin");
    big("WIRED " + money(net) + " TO YOUR ACCOUNT");
    note(fee > 0 ? ("A fence took " + money(fee) + " to wash the stained notes.")
                 : "Clean money, clean transfer — the racks are empty.", 2.8);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    persist();
    return net;
  }

  // the home safe's two verbs (the same two, smaller)
  function homeBank(h) {
    const L = homeList(h.id);
    if (!L.length) { note("The safe is empty.", 1.6); return 0; }
    const v = valueOf(L), st = stainedOf(L);
    const fee = Math.round(st * STAINED_FEE);
    const net = v - fee;
    L.length = 0;
    g.cityBank = (g.cityBank || 0) + net;
    S().banked += net; S().stainedSunk += fee;
    sfx("coin");
    big("BANKED " + money(net));
    if (fee > 0) note("A fence took " + money(fee) + " to wash the stained notes.", 2.4);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    persist();
    buildHomeVisual(h);
    return net;
  }
  function homePull(h) {
    const L = homeList(h.id);
    if (!L.length) { note("The safe is empty.", 1.6); return false; }
    const P = CBZ.player; if (!P || !P.pos) return false;
    const rec = L.pop();
    const CBg = CBZ.cashBags;
    if (CBg && CBg.spawn) {
      const b = CBg.spawn(P.pos.x + 0.9, floorY(P.pos.x + 0.9, P.pos.z), P.pos.z, rec.a, { src: "homesafe", srcName: "the safe", dyed: rec.dyed });
      if (!b) { L.push(rec); return false; }
    } else if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(rec.a);
    note("Out of the safe: " + money(rec.a) + ".", 2.0);
    persist();
    buildHomeVisual(h);
    return true;
  }

  /* ============================================================
     THE SALE. Two ways to close it, and both are the same money.
     ============================================================ */
  function remaining() { return Math.max(0, PRICE - (S().escrow | 0)); }
  function payEscrow(amt, dyed) {
    const s = S();
    // stained notes are worth less to a vendor too, and the discount is the
    // SAME one the fence charges on the way out — one number, two doors.
    const credit = dyed ? Math.round(amt * (1 - STAINED_FEE)) : amt;
    s.escrow = Math.min(PRICE, (s.escrow | 0) + credit);
    sfx("coin");
    if (s.escrow >= PRICE) { closeSale(true); return true; }
    note(money(credit) + " down" + (dyed ? " (stained — the vendor discounted it)" : "") +
      ". " + money(remaining()) + " still owed on the Freeport.", 3.0);
    // OVERPAYMENT IS NOT SWALLOWED: escrow is capped at the price and the
    // change is never taken off the player in the first place.
    persist();
    return true;
  }
  function closeSale(fromEscrow) {
    if (owned()) { note("You already own the Freeport.", 1.6); return false; }
    const s = S();
    if (!fromEscrow) {
      const owe = remaining();
      if (((g.cash || 0) + (g.cityBank || 0)) < owe) {
        note("Need " + money(owe) + " (cash + bank) to close — or carry the difference in bags.", 3.0);
        sfx("hit"); return false;
      }
      let left = owe;
      const fromCash = Math.min(g.cash || 0, left);
      g.cash = (g.cash || 0) - fromCash; left -= fromCash;
      if (left > 0) g.cityBank = Math.max(0, (g.cityBank || 0) - left);
      s.escrow = PRICE;
    }
    grantOwnership();
    big("THE FREEPORT IS YOURS");
    note("Bonded yard, dock, racks and the strip. Drive the money here — bags on the rack are money in hand.", 4.2);
    sfx("coin");
    if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(120);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    _dirty = true;
    persist();
    return true;
  }

  /* ============================================================
     THE FOR-SALE BOARD — the one piece of geometry this file does draw,
     because it is the piece that has to CHANGE when you buy the place.
     ============================================================ */
  let _board = null, _boardOwned = null;
  function ensureBoard() {
    const root = arenaRoot(), W = wh();
    if (!root || !W || !THREE) return;
    const own = owned();
    if (_board && _board.parent === root && _boardOwned === own) return;
    if (_board && _board.parent) _board.parent.remove(_board);
    _board = null;
    const grp = new THREE.Group();
    const y = floorY(W.board.x, W.board.z);
    grp.position.set(W.board.x, y, W.board.z);
    grp.userData.transient = true;
    const post = CBZ.cmat ? CBZ.cmat(0x3c4046) : new THREE.MeshLambertMaterial({ color: 0x3c4046 });
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.0, 0.16), post);
      p.position.set(s * 1.7, 1.5, 0); grp.add(p);
    }
    const faceHex = own ? 0x2f5b8c : 0xb43a32;
    const face = new THREE.Mesh(new THREE.BoxGeometry(4.0, 1.8, 0.14),
      CBZ.cmat ? CBZ.cmat(faceHex, { emissive: faceHex, ei: 0.28 }) : new THREE.MeshLambertMaterial({ color: faceHex }));
    face.position.set(0, 2.3, 0); grp.add(face);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.22, 0.06),
      CBZ.cmat ? CBZ.cmat(0xecf0f1) : new THREE.MeshLambertMaterial({ color: 0xecf0f1 }));
    bar.position.set(0, own ? 2.3 : 2.62, 0.11); grp.add(bar);
    if (!own) {
      const bar2 = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.16, 0.06),
        CBZ.cmat ? CBZ.cmat(0xecf0f1) : new THREE.MeshLambertMaterial({ color: 0xecf0f1 }));
      bar2.position.set(-0.5, 2.16, 0.11); grp.add(bar2);
    }
    root.add(grp);
    _board = grp; _boardOwned = own;
  }

  /* ============================================================
     THE TICK — cheap, and it does exactly three things: keep the pile
     looking like the ledger, keep the board honest, and build/drop the one
     home safe you are near.
     ============================================================ */
  let acc = 0;
  if (CBZ.onUpdate) CBZ.onUpdate(38.76, function (dt) {
    if (!on()) return;
    if (!g || g.mode !== "city") { return; }
    acc += dt || 0;
    if (acc < 0.6) return;
    acc = 0;
    hydrate();
    const root = arenaRoot(); if (!root) return;
    if (root !== _meshRoot) { _meshRoot = root; _dirty = true; _board = null; _boardOwned = null; dropHomeVisual(); }
    ensureTill();
    if (wh()) ensureBoard();
    if (_dirty) { rebuildMeshes(); _dirty = false; }
    const P = CBZ.player;
    if (!P || !P.pos) return;
    const h = homeNear(P.pos.x, P.pos.z, HOME_NEAR);
    if (h) { if (!_homeVis || _homeVis.id !== h.id || _homeVis.n !== homeList(h.id).length) buildHomeVisual(h); }
    else if (_homeVis) dropHomeVisual();
  });

  /* ============================================================
     RESET — a fresh run keeps the property and the money (they are in the
     ledger; permadeath wipes the whole slot, which is the design). Only the
     live meshes and the hydrate guard are cleared so a rebuilt arena
     re-places the pile against the rebuilt racks.
     ============================================================ */
  function teardown() {
    clearMeshes(); dropHomeVisual();
    if (_board && _board.parent) _board.parent.remove(_board);
    _board = null; _boardOwned = null; _meshRoot = null;
    g._cityCashStoreHydrated = false;
    _dirty = true;
  }
  CBZ.cashStoreReset = teardown;

  /* ============================================================
     PUBLIC SURFACE
     ============================================================ */
  CBZ.cashStore = {
    PRICE: PRICE, HOME_CAP: HOME_CAP, STAINED_FEE: STAINED_FEE,
    site: site, warehouse: wh, owned: owned, onPlot: onPlot,
    inside: inside, atDock: atDock, atSale: atSale,
    stored: stored, remaining: remaining, escrow: function () { return S().escrow | 0; },
    stowTarget: stowTarget, stowLabel: stowLabel, stow: stowCarried,
    unloadHere: unloadHere, pullBag: pullBag, bankIt: bankIt,
    homeAt: homeAt, homeStored: function (id) { const L = homeList(id); return { bags: L.length, cap: HOME_CAP, value: valueOf(L), stained: stainedOf(L) }; },
    homeBank: homeBank, homePull: homePull,
    buy: function () { return closeSale(false); },
    // the crew ledger — heists.js pushes the debt, the racks settle it
    oweCrew: oweCrew, settleCrew: settleCrew,
    crewDebt: function () { return S().crewDebt | 0; },
    persist: persist, hydrate: hydrate, snapshot: snapshot,
  };

  /* THE RATCHET. `plotClaimOk` is the honest failure mode of a feature whose
     whole premise is "a place you drive to": a Freeport that never found
     clear ground, or found it with no access road, is a warehouse nobody can
     reach. It is pinned TRUE. `orphanBags` is the second: a stored bag with
     no mesh on a rack is money that exists only in a save file, which is the
     abstraction this wave exists to delete — pinned at 0. Everything else
     prints beside them so a "fix" that simply stops storing anything cannot
     pass. */
  CBZ.warehouseAudit = function () {
    const s = S(), st = stored(), W = wh(), site_ = site();
    let orphan = 0;
    if (owned() && W) orphan = Math.max(0, Math.min(s.bags.length, st.cap) - _meshes.length);
    return {
      owned: owned(),
      price: PRICE, escrow: s.escrow | 0, remaining: remaining(),
      bagsStored: st.bags, shelfCap: st.cap,
      valueStored: st.value, cleanStored: st.clean, stainedStored: st.stained,
      homes: (function () { let n = 0, v = 0; for (const k in s.homes) { n += s.homes[k].length; v += valueOf(s.homes[k]); } return { bags: n, value: v }; })(),
      crewOwed: s.crewDebt | 0, crewSettled: s.crewPaid | 0,
      deposits: s.deposits | 0, banked: s.banked | 0, fencePaid: s.stainedSunk | 0,
      // the placement facts, read LIVE off govcomplex.js's own record
      plotClaimOk: !!(site_ && site_.rect && (site_.roads || []).length > 0),
      plotPlaced: !!(site_ && site_.rect),
      plotRoads: site_ ? (site_.roads || []).length : 0,
      plotAt: site_ && site_.rect ? { x: site_.cx, z: site_.cz } : null,
      shelvesPublished: W ? (W.shelves || []).length : 0,
      dock: W ? W.dock : null, apron: W ? W.apron : null,
      meshes: _meshes.length, orphanBags: orphan,
      tillDeclared: _tillDeclared,
      holdApi: !!CBZ.vehicleHoldAt,
    };
  };
})();
