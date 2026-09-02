/* ============================================================
   city/propertyvault.js — A VAULT YOU BOUGHT, ON LAND YOU BOUGHT.

   OWNER: "…you can open the back of a truck and put the bags in and drive them
   to a property you pay for land and build a property and then buy your own
   vault for it and boom all the assets of a game matter and it feels real as
   fuck."

   The last link of that chain was the only one missing. The game already had:
   a property ledger with places you buy (city/storage.js), money that exists
   as physical duffels (city/inventory.js's CBZ.cashBags), somewhere to put
   them down that is YOURS (city/cashstore.js — the Freeport racks and a house
   floor safe), and a real steel strongroom with a door that only a key, an
   officer under a gun or a shaped charge will move (city/bank.js's
   CBZ.cityVaultRoom). What it did not have was the sentence that joins them:
   the vault is a thing you can BUY, for a property you own, and then it is
   yours the way the bank's is theirs.

   WHAT THIS FILE IS NOT:
     • not a second vault. The room is CBZ.cityVaultRoom — the same partition,
       the same 0.42 m leaf, the same boltwork, the same hp, the same
       registerBreachTarget. Someone can blow YOUR door with the same C4 in the
       same pounds, and the bags land on the floor by the same code path.
     • not a second money ledger. The dollars in it are a declared CBZ.cityTill
       source, exactly as the Freeport racks are, so "how much is in there" has
       one answer and a robber draining it drains the thing you own.
     • not a second key system. Buying the vault mints ONE key into your
       inventory through city/keys.js — the same item class the branch manager
       carries — so your own door opens the same way his does, and if you die
       carrying it, it drops like everything else.
     • not a second property system. Ownership, price and the [G] desk are
       city/storage.js's; this file adds a row to that desk and nothing else.

   THE BUILDING. cityVaultRoom wants a `building` record with w/d/wt/ox/oz/door
   /floorTops and an `lbox` sink — that is its whole contract, and city/casino.js
   already proved a second caller costs a spec object. So the vault ships with a
   plain reinforced-concrete outbuilding: a slab, four walls with a doorway you
   walk through, a roof and a light. The strongroom is cut INSIDE that shell by
   the real builder, which is why it looks like the bank's, because it is.

   Exposes: CBZ.cityPropVault, CBZ.propVaultAudit.
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  const cmat = CBZ.cmat || CBZ.mat || function (c) { return new THREE.MeshLambertMaterial({ color: c }); };

  function money(n) { n = Math.round(n || 0); return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US"); }
  function note(m, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(m, s == null ? 2 : s); }
  function big(m) { if (CBZ.city && CBZ.city.big) CBZ.city.big(m); }
  function sfx(n) { if (CBZ.sfx) { try { CBZ.sfx(n); } catch (e) {} } }
  function arenaRoot() { const A = CBZ.city && CBZ.city.arena; return (A && A.root) || null; }
  function floorY(x, z) { if (CBZ.floorAt) { try { return CBZ.floorAt(x, z) || 0; } catch (e) {} } return 0; }

  /* ---- THE CATALOG ---------------------------------------------------------
     Two tiers, priced off what they hold and against the ladder that already
     exists: the Freeport itself is $1.75M and holds its bags on open racks in
     a shed anybody can walk into. A strongroom is cheaper than the land and
     dearer than a garage, and the cash centre is the endgame box.

     `shell` is the outbuilding's footprint, and it is not a taste number: it is
     the smallest square that survives cityVaultRoom's own habitability test
     (hDeep >= rd + 2.6 and hTan >= rw + 0.4 against the room it derives). A
     smaller shed is REFUSED by that builder and counted, which is exactly
     right — a strongroom you clip through is worse than none. */
  const TIERS = [
    { id: "strongroom", tier: "branch",  name: "Strongroom",  cost: 320000,  cap: 14, shell: 15,
      blurb: "A poured box with a 0.42 m door on a hinge column. Fourteen duffels on real shelves, and only your key opens it." },
    { id: "cashcentre", tier: "reserve", name: "Cash Centre", cost: 1150000, cap: 34, shell: 21,
      blurb: "The big steel. Thirty-four duffels, twice the door, and it takes ten pounds of C4 to take off — which is what somebody will bring." },
  ];
  const TIER_BY_ID = {}; for (const t of TIERS) TIER_BY_ID[t.id] = t;
  function tierOf(rec) { return (rec && TIER_BY_ID[rec.tier]) || TIERS[0]; }

  /* ---- STATE — one plain, JSON-safe object, the cashstore.js shape ---------
     g.cityPropVaults = { [propertyId]: { tier, bags:[{a,dyed}] } } */
  function S() {
    if (!g.cityPropVaults || typeof g.cityPropVaults !== "object") g.cityPropVaults = {};
    return g.cityPropVaults;
  }
  function recOf(propId) { const r = S()[propId]; return (r && Array.isArray(r.bags)) ? r : null; }
  function ownedList() {
    const out = [], s = S();
    for (const id in s) if (recOf(id)) out.push({ propId: id, rec: s[id] });
    return out;
  }
  function valueOf(list) { let v = 0; for (let i = 0; i < list.length; i++) v += list[i].a | 0; return v; }
  function stainedOf(list) { let v = 0; for (let i = 0; i < list.length; i++) if (list[i].dyed) v += list[i].a | 0; return v; }

  function snapshot() {
    const s = S(), o = {};
    for (const id in s) {
      const r = s[id]; if (!r || !Array.isArray(r.bags)) continue;
      o[id] = { tier: r.tier, bags: r.bags.map(function (b) { return { a: b.a | 0, dyed: !!b.dyed }; }) };
    }
    return o;
  }
  function persist() {
    if (!CBZ.cityWorldEnsure) return;
    let w = null;
    try { w = CBZ.cityWorldEnsure(); } catch (e) { w = null; }
    if (!w) return;
    w.propVaults = snapshot();
    if (CBZ.cityWorldCommit) { try { CBZ.cityWorldCommit(); } catch (e) {} }
  }
  function hydrate() {
    S();
    if (g._cityPropVaultHydrated) return;
    g._cityPropVaultHydrated = true;
    if (!CBZ.cityWorldEnsure) return;
    let w = null;
    try { w = CBZ.cityWorldEnsure(); } catch (e) { w = null; }
    const src = w && w.propVaults;
    if (!src) return;
    const s = S();
    for (const id in src) {
      const r = src[id]; if (!r || !TIER_BY_ID[r.tier]) continue;
      s[id] = { tier: r.tier, bags: Array.isArray(r.bags) ? r.bags.map(function (b) { return { a: b.a | 0, dyed: !!b.dyed }; }) : [] };
    }
  }

  // ---- money in: city/wealth.js's charge convention, cash then bank --------
  function canAfford(n) { return ((g.cash || 0) + (g.cityBank || 0)) >= n; }
  function charge(n) {
    n = Math.round(n);
    if (CBZ.city && CBZ.city.spend) { try { return !!CBZ.city.spend(n); } catch (e) {} }
    if (!canAfford(n)) return false;
    let owe = n; const fromCash = Math.min(g.cash || 0, owe);
    g.cash = (g.cash || 0) - fromCash; owe -= fromCash;
    if (owe > 0) g.cityBank = Math.max(0, (g.cityBank || 0) - owe);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  }

  /* ============================================================
     THE OUTBUILDING. Our own boxes; the room inside them is not ours.
     ============================================================ */
  const LIVE = {};        // propId -> { grp, v, srcTill, colliders:[], site }
  let _liveRoot = null;

  function propSpot(propId) {
    const St = CBZ.cityStorage;
    if (!St || !St.spots) return null;
    let spots = null;
    try { spots = St.spots(); } catch (e) { spots = null; }
    if (!spots) return null;
    for (let i = 0; i < spots.length; i++) if (spots[i].prop && spots[i].prop.id === propId) return spots[i];
    return null;
  }
  /* WHERE THE SHED GOES. Not on top of the property beacon (you would never
     find the [G] desk again) and not at a typed offset either — eight
     candidate bearings at 13 m, scored by how FLAT the ground under the
     footprint is, because a strongroom half-buried in a bank is a strongroom
     with no door. The flattest wins; ties break on the first bearing, so the
     placement is deterministic for a given world. */
  // how much of somebody else's solid geometry this footprint would sit on.
  // CBZ.colliders is the world's own AABB list, so "is that ground clear" is a
  // question the game can already answer — asking it beats a typed offset that
  // happens to work at one property and puts a strongroom through a showroom
  // wall at the next.
  function overlapArea(cx, cz, half) {
    const C = CBZ.colliders;
    if (!C || !C.length) return 0;
    const x0 = cx - half, x1 = cx + half, z0 = cz - half, z1 = cz + half;
    let a = 0;
    for (let i = 0; i < C.length; i++) {
      const c = C[i];
      if (!c || c.minX == null) continue;
      const ox = Math.min(x1, c.maxX) - Math.max(x0, c.minX);
      if (ox <= 0) continue;
      const oz = Math.min(z1, c.maxZ) - Math.max(z0, c.minZ);
      if (oz <= 0) continue;
      a += ox * oz;
    }
    return a;
  }
  function siteFor(spot, size) {
    const R = 13;
    let best = null, bestScore = Infinity;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const cx = spot.x + Math.cos(a) * R, cz = spot.z + Math.sin(a) * R;
      const h = size / 2 - 0.6;
      let lo = Infinity, hi = -Infinity;
      for (let q = 0; q < 4; q++) {
        const px = cx + (q % 2 ? h : -h), pz = cz + (q < 2 ? -h : h);
        const y = floorY(px, pz);
        if (y < lo) lo = y; if (y > hi) hi = y;
      }
      // a metre of slope and a square metre of somebody else's wall are both
      // reasons to put the shed somewhere else; weight the wall harder,
      // because a slope is ugly and a wall is unusable.
      //
      // PARKED CARS ARE NOT IN CBZ.colliders — vehicles carry their own — and
      // the first build of this put a strongroom down on top of the car lot's
      // front row, which photographed as a bonnet through the vault doorway.
      // They count too, at a lower weight: a car can be driven away, a wall
      // cannot.
      let cars = 0;
      const CL = CBZ.cityCars;
      if (CL) for (let k = 0; k < CL.length; k++) {
        const c = CL[k];
        if (!c || c.dead || !c.pos) continue;
        if (Math.abs(c.pos.x - cx) < size / 2 + 2 && Math.abs(c.pos.z - cz) < size / 2 + 2) cars++;
      }
      const score = (hi - lo) * 2 + overlapArea(cx, cz, size / 2 + 0.8) * 0.25 + cars * 6;
      if (score < bestScore - 1e-4) { bestScore = score; best = { x: cx, z: cz, y: lo, flat: hi - lo, clash: score }; }
    }
    return best || { x: spot.x + R, z: spot.z, y: floorY(spot.x + R, spot.z), flat: 0 };
  }

  function buildShell(site, size, grp, cols) {
    const WT = 0.34, H = 3.7, half = size / 2;
    const y0 = site.y;
    const put = function (lx, ly, lz, w, h, d, col) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), cmat(col));
      m.position.set(site.x + lx, y0 + ly, site.z + lz);
      m.castShadow = false; m.receiveShadow = true;
      grp.add(m);
      return m;
    };
    const wall = function (lx, ly, lz, w, h, d, col) {
      put(lx, ly, lz, w, h, d, col);
      cols.push({ minX: site.x + lx - w / 2, maxX: site.x + lx + w / 2,
                  minZ: site.z + lz - d / 2, maxZ: site.z + lz + d / 2,
                  y0: y0, y1: y0 + h });
    };
    // slab + apron
    put(0, -0.09, 0, size + 1.6, 0.18, size + 1.6, 0x6b6f74);
    put(0, 0.02, 0, size - 0.4, 0.06, size - 0.4, 0x82868c);
    // three solid walls
    wall(-half + WT / 2, H / 2, 0, WT, H, size, 0x8a8f95);
    wall(half - WT / 2, H / 2, 0, WT, H, size, 0x8a8f95);
    wall(0, H / 2, -half + WT / 2, size, H, WT, 0x8a8f95);
    // the front, with a doorway you walk through
    const DW = 2.9, side = (size - DW) / 2;
    wall(-(DW / 2 + side / 2), H / 2, half - WT / 2, side, H, WT, 0x8a8f95);
    wall(DW / 2 + side / 2, H / 2, half - WT / 2, side, H, WT, 0x8a8f95);
    put(0, H - 0.4, half - WT / 2, DW, 0.8, WT, 0x8a8f95);          // lintel
    // roof + a parapet so it reads as a building and not an open pen
    put(0, H + 0.12, 0, size + 0.5, 0.24, size + 0.5, 0x74797f);
    put(0, H + 0.42, 0, size + 0.5, 0.36, 0.28, 0x62676d);
    // the strip light, so the hall in front of the door is not a black hole
    put(0, H - 0.14, half * 0.35, 1.6, 0.10, 0.26, 0x9aa3ae);
    put(0, H - 0.22, half * 0.35, 1.4, 0.05, 0.16, 0xdfe9ff);
  }

  /* ONE TILL SOURCE PER VAULT, FOR THE LIFE OF THE RUN. This used to mint a
     fresh object every time the shed was built, and an arena rebuild would
     therefore hand city/shops.js a SECOND declaration of the same money — the
     parallel-bookkeeping trap, arriving as a doubled balance rather than as a
     crash. The record is created once, its coordinates are updated in place,
     and `declareTill`'s identity guard is what keeps the ledger honest. */
  const SRC = {};
  function tillSrcFor(propId, site, name) {
    const s = SRC[propId] || (SRC[propId] = { kind: "vault", _propVault: propId, building: { name: name } });
    s.cx = site.x; s.cz = site.z;
    s.building.name = name;
    return s;
  }
  // a shell the builder REFUSED is not retried every frame: the pass would
  // pour and demolish an outbuilding sixty times a second forever.
  const REFUSED = {};

  function buildAt(propId) {
    const rec = recOf(propId);
    if (!rec || LIVE[propId] || REFUSED[propId]) return LIVE[propId] || null;
    if (!CBZ.cityVaultRoom) return null;
    const root = arenaRoot(); if (!root) return null;
    const spot = propSpot(propId); if (!spot) return null;
    const T = tierOf(rec);
    const size = T.shell;
    const site = siteFor(spot, size);
    const name = (spot.prop && spot.prop.name) || "your property";

    const grp = new THREE.Group();
    grp.userData.transient = true;
    root.add(grp);
    const cols = [];
    buildShell(site, size, grp, cols);

    // the synthetic building record — the whole contract cityVaultRoom asks
    // for, and the boxes it draws land in OUR group.
    const b = {
      name: T.name + " · " + name,
      w: size, d: size, wt: 0.34,
      ox: site.x, oz: site.z,
      floorTops: [site.y + 0.05], storeys: 1, h: 3.7,
      door: { nx: 0, nz: 1, x: site.x, z: site.z + size / 2 },
      lbox: function (lx, ly, lz, bw, bh, bd, col, o) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(bw), Math.abs(bh), Math.abs(bd)), cmat(col, o));
        m.position.set(site.x + lx, ly, site.z + lz);
        m.castShadow = !(o && o.cast === false);
        m.receiveShadow = true;
        grp.add(m);
        if (o && o.solid) {
          cols.push({ minX: m.position.x - Math.abs(bw) / 2, maxX: m.position.x + Math.abs(bw) / 2,
                      minZ: m.position.z - Math.abs(bd) / 2, maxZ: m.position.z + Math.abs(bd) / 2,
                      y0: site.y, y1: site.y + Math.abs(bh) });
        }
        return m;
      },
    };
    const lot = { cx: site.x, cz: site.z, w: size, d: size, kind: "vault", building: b };
    const src = tillSrcFor(propId, site, T.name + " · " + name);
    let v = null;
    try {
      v = CBZ.cityVaultRoom(lot, {
        tier: T.tier, kind: "player", name: T.name + " · " + name,
        till: { src: src, point: "vault" },
      });
    } catch (e) { v = null; }
    if (!v) {
      // REFUSED: the builder said this shell cannot hold a room you can stand
      // in. Take the shed back down rather than leaving a windowless box on
      // the map with nothing in it, and remember, so the pass does not pour
      // and demolish it again on the next frame.
      root.remove(grp);
      REFUSED[propId] = true;
      return null;
    }
    // our own walls join the world's collider list (the room's own door
    // collider was already pushed by the builder)
    if (CBZ.colliders) { for (let i = 0; i < cols.length; i++) CBZ.colliders.push(cols[i]); }
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();

    declareTill(propId, src);
    const L = LIVE[propId] = { grp: grp, v: v, site: site, src: src, cols: cols, meshes: [], size: size };
    seatBags(propId);
    return L;
  }

  function teardownLive() {
    for (const id in LIVE) {
      const L = LIVE[id];
      if (!L) continue;
      if (L.grp && L.grp.parent) L.grp.parent.remove(L.grp);
      if (CBZ.colliders) for (let i = 0; i < L.cols.length; i++) {
        const k = CBZ.colliders.indexOf(L.cols[i]);
        if (k >= 0) CBZ.colliders.splice(k, 1);
      }
      delete LIVE[id];
    }
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }

  /* ============================================================
     THE LEDGER. One declared till source per vault — the roofloot.js /
     cashstore.js shape: bind `amount` and `drain` to a balance somebody else
     owns and keep no mirror. The somebody else is the bag list above, which is
     why a robber blowing your door drains the thing you actually own.
     ============================================================ */
  const DECLARED = {};
  function declareTill(propId, src) {
    if (DECLARED[propId] === src || !CBZ.cityTill || !CBZ.cityTill.declare) return;
    DECLARED[propId] = src;
    CBZ.cityTill.declare(src, {
      name: (src.building && src.building.name) || "your vault", kind: "vault", point: "vault",
      amount: function () { const r = recOf(propId); return r ? valueOf(r.bags) : 0; },
      drain: function (n) { removeValue(propId, n, true); },
    });
  }
  function removeValue(propId, n, preferDyed) {
    const r = recOf(propId); if (!r) return 0;
    n = Math.max(0, Math.round(n || 0));
    let got = 0;
    while (n > 0 && r.bags.length) {
      let idx = -1;
      if (preferDyed !== false) for (let i = 0; i < r.bags.length; i++) if (r.bags[i].dyed) { idx = i; break; }
      if (idx < 0) idx = r.bags.length - 1;
      const b = r.bags[idx];
      if (b.a <= n) { got += b.a; n -= b.a; r.bags.splice(idx, 1); }
      else { b.a -= n; got += n; n = 0; }
    }
    if (got > 0) { seatBags(propId); persist(); }
    return got;
  }

  /* ============================================================
     THE DUFFELS ON THE SHELVES. city/bank.js's buildRoom stands its racks at
     four board heights up the back wall of the strongroom; those numbers are
     read here rather than re-guessed, so a bag sits ON a board.
     ============================================================ */
  const SHELF_Y = [0.44, 1.06, 1.68, 2.30];
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
    if (!m) {
      m = new THREE.Group();
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.30, 0.72), cmat(rec.dyed ? 0x7a2a26 : 0x2f3a2c));
      b.position.y = 0.16; m.add(b);
    }
    const k = Math.max(0.86, Math.min(1.30, 0.86 + 0.26 * Math.log10(Math.max(1, rec.a) / 50000 + 1)));
    m.scale.setScalar(k);
    m.userData.transient = true;
    return m;
  }
  function seatBags(propId) {
    const L = LIVE[propId]; const r = recOf(propId);
    if (!L || !L.v) return;
    for (let i = 0; i < L.meshes.length; i++) if (L.meshes[i].parent) L.meshes[i].parent.remove(L.meshes[i]);
    L.meshes.length = 0;
    if (!r || !r.bags.length) return;
    const v = L.v;
    const nx = v.inx, nz = v.inz, tx = -nz, tz = nx;
    const backD = v.rd - 0.72;                       // just in front of the back rack
    const perShelf = Math.max(2, Math.floor((v.rw - 1.2) / 0.86));
    for (let i = 0; i < r.bags.length; i++) {
      const shelf = Math.floor(i / perShelf);
      const col = i % perShelf;
      const y = shelf < SHELF_Y.length ? SHELF_Y[shelf] : 0.10;    // overflow lies on the floor
      const lat = (perShelf > 1 ? (col / (perShelf - 1) - 0.5) : 0) * (v.rw - 1.3);
      const deep = shelf < SHELF_Y.length ? backD : (v.rd * 0.45 - col * 0.05);
      const m = bagMesh(r.bags[i]);
      m.position.set(v.x + nx * deep + tx * lat, v.y + y + 0.09, v.z + nz * deep + tz * lat);
      m.rotation.y = Math.atan2(tx, tz) + ((i % 2) ? 0.11 : -0.08);
      L.grp.add(m);
      L.meshes.push(m);
    }
  }

  /* ============================================================
     THE VERBS' DATA. cashstore.js asks these three questions and prints the
     answers; interact.js asks the same ones at the shelf.
     ============================================================ */
  function capOf(propId) { const r = recOf(propId); return r ? tierOf(r).cap : 0; }
  function stored(propId) {
    const r = recOf(propId);
    if (!r) return { bags: 0, cap: 0, value: 0, clean: 0, stained: 0 };
    const v = valueOf(r.bags), st = stainedOf(r.bags);
    return { bags: r.bags.length, cap: capOf(propId), value: v, clean: v - st, stained: st };
  }
  // are you standing INSIDE this vault's strongroom? (the room, not the shed —
  // stowing a duffel means putting it behind the steel)
  function insideRoom(L, x, z) {
    const v = L && L.v; if (!v) return false;
    const nx = v.inx, nz = v.inz, tx = -nz, tz = nx;
    const dx = x - v.x, dz = z - v.z;
    const deep = dx * nx + dz * nz;
    const lat = dx * tx + dz * tz;
    return deep > -0.6 && deep < v.rd + 0.4 && Math.abs(lat) < v.rw / 2 + 0.4;
  }
  function at(x, z) {
    for (const id in LIVE) {
      const L = LIVE[id];
      if (L && insideRoom(L, x, z)) return { propId: id, live: L, rec: recOf(id) };
    }
    return null;
  }
  // near the shed at all — the [G]-desk courtesy and the audit's reach
  function nearVault(x, z, r) {
    r = r == null ? 12 : r;
    for (const id in LIVE) {
      const L = LIVE[id];
      if (!L || !L.site) continue;
      const half = L.size / 2 + r;
      if (Math.abs(x - L.site.x) < half && Math.abs(z - L.site.z) < half) return { propId: id, live: L, rec: recOf(id) };
    }
    return null;
  }

  function put(propId, amt, dyed) {
    const r = recOf(propId); if (!r) return false;
    if (r.bags.length >= capOf(propId)) return false;
    r.bags.push({ a: Math.round(amt) | 0, dyed: !!dyed });
    seatBags(propId);
    persist();
    sfx("coin");
    const st = stored(propId);
    big("IN YOUR VAULT · " + money(amt));
    note(tierOf(r).name + ": " + st.bags + "/" + st.cap + " bags · " + money(st.value) +
         (st.stained ? " (" + money(st.stained) + " stained)" : ""), 2.8);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  }
  // take a duffel BACK OFF the shelf and onto your shoulder — the same
  // physicalisation the bank's door performs, one bag at a time.
  function pull(propId) {
    const r = recOf(propId); if (!r || !r.bags.length) { note("Nothing on the shelves.", 1.6); return false; }
    const L = LIVE[propId];
    const CB = CBZ.cashBags;
    if (!L || !CB || !CB.payout) return false;
    if (CB.carried()) { note("Both hands are full already.", 1.6); return false; }
    const b = r.bags.pop();
    const v = L.v;
    const out = CB.payout(v.rx, v.y, v.rz, b.a | 0, { src: "propvault:" + propId, srcName: tierOf(r).name, spread: 0.4, cap: 1 });
    if (out && out.bags && out.bags[0]) {
      if (b.dyed && CB.dye) { try { CB.dye(out.bags[0]); } catch (e) {} }
      CB.pickup(out.bags[0]);
    }
    seatBags(propId);
    persist();
    note("Off the shelf · " + money(b.a), 1.8);
    return true;
  }
  /* WIRE IT OUT. Same shape as cashstore.bankIt: the money leaves the shelves
     through the ONE ledger (a take against this vault's own declared source)
     and lands in the bank account. Stained notes take the fence's cut, which
     is city/cashstore.js's number, read not re-typed. */
  function bankIt(propId) {
    const r = recOf(propId); if (!r) return 0;
    const st = stored(propId);
    if (st.value <= 0) { note("The shelves are empty.", 1.6); return 0; }
    const fee = (CBZ.cashStore && CBZ.cashStore.STAINED_FEE != null) ? CBZ.cashStore.STAINED_FEE : 0.3;
    const net = Math.max(0, Math.round(st.value - st.stained * fee));
    let taken = 0;
    if (CBZ.cityTill && CBZ.cityTill.take && DECLARED[propId]) {
      try { taken = CBZ.cityTill.take(DECLARED[propId], { max: st.value, by: "player" }).taken | 0; } catch (e) { taken = 0; }
    }
    if (taken <= 0) taken = removeValue(propId, st.value, true);
    if (taken <= 0) return 0;
    const paid = Math.round(net * (taken / Math.max(1, st.value)));
    g.cityBank = (g.cityBank || 0) + paid;
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    seatBags(propId);
    persist();
    big("WIRED " + money(paid));
    if (st.stained) note(money(st.stained) + " of it was marked — the fence took " + Math.round(fee * 100) + "%.", 2.8);
    sfx("coin");
    return paid;
  }

  /* ---- BUY ---------------------------------------------------------------- */
  function ownsProp(propId) {
    return !!(CBZ.cityStorage && CBZ.cityStorage.owns && CBZ.cityStorage.owns(propId));
  }
  function buy(propId, tierId) {
    hydrate();
    const T = TIER_BY_ID[tierId] || TIERS[0];
    if (!ownsProp(propId)) { note("Buy the land first.", 2); return false; }
    const have = recOf(propId);
    if (have && have.tier === T.id) { note("You already have a " + T.name + " here.", 1.8); return false; }
    // an upgrade pays the DIFFERENCE and keeps every duffel already on a shelf
    const owe = have ? Math.max(0, T.cost - tierOf(have).cost) : T.cost;
    if (!charge(owe)) { note("Need " + money(owe) + " for the " + T.name + ".", 2.4); sfx("hit"); return false; }
    const bags = have ? have.bags : [];
    S()[propId] = { tier: T.id, bags: bags };
    // tear down the old shell so the upgrade rebuilds at the new size
    if (LIVE[propId]) {
      const L = LIVE[propId];
      if (L.grp && L.grp.parent) L.grp.parent.remove(L.grp);
      if (CBZ.colliders) for (let i = 0; i < L.cols.length; i++) {
        const k = CBZ.colliders.indexOf(L.cols[i]); if (k >= 0) CBZ.colliders.splice(k, 1);
      }
      delete LIVE[propId];
    }
    delete REFUSED[propId];
    const built = buildAt(propId);
    persist();
    if (!built) {
      note("Poured, but the ground here would not take the room. Nothing lost — try another property.", 3.4);
      return false;
    }
    // THE KEY IS AN ITEM, and it is yours. Same class as the branch manager's,
    // same door code, same drop-on-death.
    const spot = propSpot(propId);
    if (CBZ.cityKeys && CBZ.cityKeys.grant) {
      CBZ.cityKeys.grant(built.v.id, "Vault Key · " + ((spot && spot.prop && spot.prop.name) || T.name));
    }
    big("YOUR VAULT · " + T.name);
    note(T.cap + " duffels behind your own steel. The key is in your pocket.", 3.2);
    sfx("coin");
    if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(Math.max(3, Math.round(T.cost / 12000)));
    return true;
  }

  /* ============================================================
     THE PASS. Build every bought vault once the arena exists, and rebuild
     after a world rebuild (arena.root is replaced wholesale).
     ============================================================ */
  CBZ.onUpdate(13.52, function () {
    if (!g || g.mode !== "city") return;
    const root = arenaRoot();
    if (!root) return;
    hydrate();
    if (root !== _liveRoot) { teardownLive(); for (const k in REFUSED) delete REFUSED[k]; _liveRoot = root; }
    const list = ownedList();
    for (let i = 0; i < list.length; i++) {
      const id = list[i].propId;
      if (LIVE[id] || !ownsProp(id)) continue;
      buildAt(id);
    }
  });

  function teardown() {
    g._cityPropVaultHydrated = false;
    teardownLive();
    _liveRoot = null;
  }
  CBZ.cityPropVaultReset = teardown;

  CBZ.cityPropVault = {
    TIERS: TIERS, tierOf: tierOf,
    buy: buy, stored: stored, cap: capOf,
    has: function (propId) { return !!recOf(propId); },
    at: at, near: nearVault,
    put: put, pull: pull, bank: bankIt,
    room: function (propId) { const L = LIVE[propId]; return L ? L.v : null; },
    site: function (propId) { const L = LIVE[propId]; return L ? L.site : null; },
    list: function () {
      const out = [];
      const l = ownedList();
      for (let i = 0; i < l.length; i++) {
        out.push({ propId: l[i].propId, tier: l[i].rec.tier, built: !!LIVE[l[i].propId], stored: stored(l[i].propId) });
      }
      return out;
    },
  };

  /* THE RATCHET. `refused` is the honest failure of a room-in-a-building
     system, and it is the SAME failure city/bank.js counts — a shell that
     cannot hold a strongroom you can stand in. It may only ever go down.
     `unbuilt` is the other honest one: a vault the player paid for that is not
     standing in the world right now, which must be 0 whenever you are in the
     city with the arena up. */
  CBZ.propVaultAudit = function () {
    const l = ownedList();
    let bags = 0, value = 0, cap = 0, built = 0, open = 0;
    for (let i = 0; i < l.length; i++) {
      const id = l[i].propId, st = stored(id);
      bags += st.bags; value += st.value; cap += st.cap;
      const L = LIVE[id];
      if (L) { built++; if (L.v && L.v.open) open++; }
    }
    let keys = 0;
    for (const id in LIVE) if (LIVE[id].v && CBZ.cityKeys && CBZ.cityKeys.has(LIVE[id].v.id)) keys++;
    return {
      bought: l.length, built: built, unbuilt: l.length - built,
      doorsOpen: open, keysHeld: keys,
      bags: bags, capacity: cap, value: value,
      tiers: TIERS.map(function (t) { return t.id + ":" + t.cap; }).join(" "),
    };
  };
})();
