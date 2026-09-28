/* ============================================================
   city/plots.js — LAND YOU OWN, AS A PLACE.

   OWNER: "being able to buy almost every property in almost every lot, and
   then not have to buy any customized ones, or just do a lot of customizing
   of your lot, but not fake customizing, the real thing." And: "the idea that
   you can buy a bunch of properties and knock them down and build your own
   properties is really cool."

   The market already existed (city/zillow.js: every lot has a listing, a
   live price and an owner) and so did a builder (systems/building.js) and a
   crew (city/playergang.js). What did not exist was the PLACE between them:
   you could own a lot only as a row on a phone app, you could build anywhere
   on the planet regardless of whose land it was, and nothing on the street
   told you a building was for sale. This file is that place. It owns no
   ledger of its own: ownership is zillow's, the teardown is structural.js +
   demolition.js's, the pieces are building.js's, the crew is
   compoundcrew.js's. It adds:

     1. THE PLOT. Every lot you own is a Plot: its ground rect, a 3 m build
        grid laid on the lot's own edges (a 30 m lot is exactly 10 x 10
        cells, so a wall lands ON the property line), the street frontage
        where a gate belongs, and a small persisted record (name, cleared,
        data) for the systems that live on it. CBZ.cityPlots is the contract
        the builder and the crew read.
     2. THE SIGN. Walk down a street and the lots on the market carry a real
        estate sign at the curb with the live asking price. E at the sign
        opens the listing: buy it cash or finance it through the same zillow
        transact path the phone and the realtor use.
     3. THE PANEL. E at your own lot's address post: what you own, what it is
        worth, KNOCK IT DOWN (a contractor's controlled demolition: the real
        collapse, pancaked into its own footprint, then the rubble is carted
        off and the lot stays a bare poured pad for as long as you own it),
        sell it, and whatever the builder and the crew add to it.
     4. THE LOCK. The doors of a building you own swing for you and your
        people, nobody else (buildings.js reads dr._ownerLock).
     5. THE MAP. Owned lots are painted in your colour (systems/fullmap.js
        reads CBZ.cityPlots).

   Exposes: CBZ.cityPlots, CBZ.cityPlotFriendly.
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  const CELL = 3;

  // ---- tiny utils --------------------------------------------------------
  function money(n) { n = Math.round(+n); if (!isFinite(n)) n = 0; return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(); }
  function note(m, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(m, s || 2.2); }
  function big(m) { if (CBZ.city && CBZ.city.big) CBZ.city.big(m); }
  function sfx(n) { if (CBZ.sfx) { try { CBZ.sfx(n); } catch (e) {} } }
  function arena() { return CBZ.city && CBZ.city.arena; }
  function inCity() { return g && g.mode === "city"; }
  function playing() { return inCity() && g.state === "playing"; }
  function Z() { return CBZ.cityZillow || null; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function canAfford(amt) { return ((g.cash || 0) + (g.cityBank || 0)) >= amt; }
  function charge(amt) {
    amt = Math.max(0, Math.round(+amt) || 0);
    if (!canAfford(amt)) return false;
    let owe = amt; const fromCash = Math.min(g.cash || 0, owe);
    g.cash = (g.cash || 0) - fromCash; owe -= fromCash;
    if (owe > 0) g.cityBank = Math.max(0, (g.cityBank || 0) - owe);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  }
  function myColorHex() {
    const pg = g.playerGang;
    const c = (pg && pg.founded && pg.color != null) ? pg.color : 0x7ed957;
    return c;
  }
  function hex6(c) { return "#" + ("000000" + ((c >>> 0).toString(16))).slice(-6); }

  function allLots() {
    const A = arena(); if (!A) return [];
    return [].concat(A.lots || [], (A.annex && A.annex.lots) || []);
  }
  function lotKey(lot) { return Math.round(lot.cx) + "," + Math.round(lot.cz); }
  function lotRect(lot) {
    const w = lot.w || 24, d = lot.d || 24;
    return { minX: lot.cx - w / 2, maxX: lot.cx + w / 2, minZ: lot.cz - d / 2, maxZ: lot.cz + d / 2 };
  }
  /* THE FRONTAGE: the lot edge the building's door faces. Measured, not
     trusted: the edge the door POINT sits nearest is the street side whatever
     sign convention a builder used for the door normal. A lot with no door
     faces +z. */
  function frontOf(lot, rect) {
    const b = lot.building, d = b && b.door;
    let side = 2;                                   // 0 -z, 1 +x, 2 +z, 3 -x
    if (d && isFinite(d.x) && isFinite(d.z) && !(b && b.park)) {
      const dd = [Math.abs(d.z - rect.minZ), Math.abs(rect.maxX - d.x), Math.abs(rect.maxZ - d.z), Math.abs(d.x - rect.minX)];
      let best = 0; for (let i = 1; i < 4; i++) if (dd[i] < dd[best]) best = i;
      side = best;
    }
    const cx = (rect.minX + rect.maxX) / 2, cz = (rect.minZ + rect.maxZ) / 2;
    if (side === 0) return { x: cx, z: rect.minZ, nx: 0, nz: -1, side: 0 };
    if (side === 1) return { x: rect.maxX, z: cz, nx: 1, nz: 0, side: 1 };
    if (side === 2) return { x: cx, z: rect.maxZ, nx: 0, nz: 1, side: 2 };
    return { x: rect.minX, z: cz, nx: -1, nz: 0, side: 3 };
  }
  function listing(lot) { const z = Z(); return z && z.listingForLot ? z.listingForLot(lot) : null; }
  function nameFor(lot) {
    const rec = listing(lot);
    if (rec) return rec.business ? rec.business.name : rec.name;
    return (lot.building && lot.building.name) || "Lot";
  }
  function addressFor(lot) { const rec = listing(lot); return (rec && rec.address) || ""; }
  function ownsLot(lot) { return !!(CBZ.cityOwnsLot && CBZ.cityOwnsLot(lot)); }

  /* ============================================================
     1. THE PLOT REGISTRY — derived from zillow ownership, re-synced on a
        cheap signature so a buy/sell anywhere (phone, realtor, sign) lands
        here within a fraction of a second.
     ============================================================ */
  const plots = new Map();            // id -> Plot
  const saved = Object.create(null);  // id -> persisted {name, cleared, data} (survives sell/buy and loads)
  const listeners = [];
  const sections = [];
  let ownSig = "";

  function emit(type, plot) {
    for (let i = 0; i < listeners.length; i++) { try { listeners[i]({ type: type, plot: plot }); } catch (e) {} }
  }
  function lockDoors(lot, on) {
    const b = lot.building; if (!b || !b.doors) return;
    for (const dr of b.doors) if (dr) { dr._ownerLock = !!on; dr._ownerLot = on ? lot : null; }
  }
  function makePlot(lot) {
    const id = "plot:" + lotKey(lot);
    const rect = lotRect(lot);
    const rec = saved[id] || (saved[id] = { name: null, cleared: false, data: {} });
    if (!rec.data || typeof rec.data !== "object") rec.data = {};
    const plot = {
      id: id, lot: lot, rect: rect,
      center: { x: lot.cx, z: lot.cz },
      grid: { ox: rect.minX + CELL / 2, oz: rect.minZ + CELL / 2 },
      front: frontOf(lot, rect),
      name: rec.name || addressFor(lot) || nameFor(lot),
      address: addressFor(lot),
      title: nameFor(lot),
      cleared: !!rec.cleared || !!lot.demolished,
      data: rec.data,
      _rec: rec,
    };
    return plot;
  }
  function syncPlots(force) {
    const z = Z(); if (!z || !z.ownedLots || !arena()) return;
    const owned = z.ownedLots();
    let sig = owned.length + ":";
    for (let i = 0; i < owned.length; i++) sig += lotKey(owned[i]) + ";";
    if (!force && sig === ownSig) return;
    ownSig = sig;
    const keep = new Set();
    for (const lot of owned) {
      const id = "plot:" + lotKey(lot);
      keep.add(id);
      if (plots.has(id)) continue;
      const plot = makePlot(lot);
      plots.set(id, plot);
      lockDoors(lot, true);
      // a pad the save says you cleared, on a world that rebuilt it (a new
      // run, a reset): take it down again, quietly, straight to the pad.
      if (plot._rec.cleared && !lot.demolished) restoreCleared(plot);
      else if (lot.demolished && CBZ.cityDemolition && CBZ.cityDemolition.hold) CBZ.cityDemolition.hold(lot, !!plot._rec.cleared);
      emit(_loading ? "load" : "buy", plot);
    }
    for (const [id, plot] of Array.from(plots)) {
      if (keep.has(id)) continue;
      plots.delete(id);
      releasePlot(plot);
      emit("sell", plot);
    }
    persist();
  }
  // the first few seconds after a load report plots as "load", not "buy": zillow
  // hydrates its deeds on its own first tick, which may land after ours
  let _loading = true, _loadingT = 4;

  function restoreCleared(plot) {
    const D = CBZ.cityDemolition; if (!D || !D.destroy) return;
    const lot = plot.lot;
    if (D.hold) D.hold(lot, true);
    const now = CBZ.dayTime ? CBZ.dayTime() : 0;
    try { D.destroy(lot, { quiet: true, silent: true, held: true, at: now - 1 }); } catch (e) {}
    plot.cleared = !!lot.demolished;
  }
  // You sold it: the pieces you built come down with the deed (the contractor
  // strips the lot), the doors unlock, and a cleared pad goes back on the
  // city's rebuild calendar.
  function releasePlot(plot) {
    const lot = plot.lot;
    lockDoors(lot, false);
    const K = CBZ.compoundKit;
    if (K && K.piecesOn && CBZ.building && CBZ.building.remove) {
      let pcs = [];
      try { pcs = K.piecesOn(plot) || []; } catch (e) { pcs = []; }
      for (const p of pcs) { try { if (p && p.alive) CBZ.building.remove(p.id); } catch (e) {} }
    }
    if (lot.demolished && CBZ.cityDemolition && CBZ.cityDemolition.hold) CBZ.cityDemolition.hold(lot, false);
    plot._rec.cleared = false; plot.cleared = false;
    persist();
  }

  /* ============================================================
     2. PERSISTENCE — one small section of the world ledger (g.cityWorld.
        plots), stamped on every commit/collect through the same lazy wrap
        demolition.js and bank.js use, adopted once per ledger identity.
     ============================================================ */
  let _spHydrated = null, _wrapped = false;
  function spLedger() { return (g && g.cityWorld && typeof g.cityWorld === "object") ? g.cityWorld : null; }
  function stamp() {
    if (CBZ.net && CBZ.net.active) return;
    const led = spLedger(); if (!led || _spHydrated !== led) return;
    const out = {};
    for (const id in saved) {
      const r = saved[id];
      const plot = plots.get(id);
      if (plot) { r.name = plot.name; r.cleared = !!plot.cleared; }
      // only keep what carries information: an unowned lot with nothing on it is forgotten
      if (!plot && !r.cleared && (!r.data || !Object.keys(r.data).length)) continue;
      out[id] = { name: r.name || null, cleared: !!r.cleared, data: r.data || {} };
    }
    try { led.plots = JSON.parse(JSON.stringify(out)); } catch (e) {}
  }
  function wrapSaves() {
    if (_wrapped) return;
    const c = CBZ.cityWorldCommit; if (typeof c !== "function") return;
    _wrapped = true;
    if (!c._plotsWrap) {
      const w = function () { try { stamp(); } catch (e) {} return c.apply(this, arguments); };
      w._plotsWrap = true; CBZ.cityWorldCommit = w;
    }
    const cc = CBZ.cityWorldCollect;
    if (typeof cc === "function" && !cc._plotsWrap) {
      const w2 = function () { try { stamp(); } catch (e) {} return cc.apply(this, arguments); };
      w2._plotsWrap = true; CBZ.cityWorldCollect = w2;
    }
  }
  function hydrate() {
    const led = spLedger();
    if (!led || led === _spHydrated) return;
    if (!playing() || !arena()) return;
    _spHydrated = led;
    _loading = true; _loadingT = 4;
    const blob = led.plots;
    if (blob && typeof blob === "object") {
      for (const id in blob) {
        const r = blob[id]; if (!r) continue;
        saved[id] = { name: r.name || null, cleared: !!r.cleared, data: (r.data && typeof r.data === "object") ? r.data : {} };
      }
    }
    // re-derive every plot against the restored records
    for (const [id, plot] of Array.from(plots)) { plots.delete(id); lockDoors(plot.lot, false); }
    ownSig = "";
  }
  let _persistT = 0;
  function persist() { _persistT = 0.6; }   // coalesced: one commit a beat after a burst of changes

  /* ============================================================
     3. THE CONTRACT — CBZ.cityPlots
     ============================================================ */
  function plotAt(x, z, pad) {
    pad = pad || 0;
    for (const p of plots.values()) {
      const r = p.rect;
      if (x >= r.minX - pad && x <= r.maxX + pad && z >= r.minZ - pad && z <= r.maxZ + pad) return p;
    }
    return null;
  }
  function canBuild(rect) {
    if (!rect) return { ok: false, reason: "not your land", plot: null };
    const T = 0.05;
    for (const p of plots.values()) {
      const r = p.rect;
      if (rect.minX >= r.minX - T && rect.maxX <= r.maxX + T && rect.minZ >= r.minZ - T && rect.maxZ <= r.maxZ + T) return { ok: true, reason: null, plot: p };
    }
    return { ok: false, reason: "not your land", plot: null };
  }
  CBZ.cityPlots = {
    CELL: CELL,
    list: function () { return Array.from(plots.values()); },
    at: plotAt,
    ofLot: function (lot) { return lot ? plots.get("plot:" + lotKey(lot)) || null : null; },
    byId: function (id) { return plots.get(id) || null; },
    canBuild: canBuild,
    onChange: function (fn) { if (typeof fn === "function") listeners.push(fn); },
    addPanelSection: function (fn) { if (typeof fn === "function" && sections.indexOf(fn) < 0) sections.push(fn); },
    save: function () { persist(); },
    open: function (plot) { openPanel(plot || plotAt(CBZ.player.pos.x, CBZ.player.pos.z, 2)); },
    openListingFor: function (lot) { if (lot) openListing(lot); },
    close: function () { closePanel(); },
    demolish: function (plot) { return orderDemolition(plot); },
    demolitionQuote: function (plot) { return demoQuote(plot); },
    rename: function (plot, name) { if (plot && name) { plot.name = String(name).slice(0, 40); persist(); } },
    lotRect: lotRect,
    sync: function () { syncPlots(true); },
  };
  // Is this body one of yours? (doors, gates and the crew all ask the same thing)
  CBZ.cityPlotFriendly = function (p, door) {
    if (!p) return false;
    // your tenants still live there: the lease is yours now, the key is theirs
    if (door && door._ownerLot && p._digs === door._ownerLot) return true;
    if (p === (CBZ.city && CBZ.city.playerActor)) return true;
    return !!(p.recruited || p.companion || p._compoundCrew || p.faction === "player" ||
      (g.playerGang && g.playerGang.founded && p.gang && p.gang === g.playerGang.id));
  };

  /* ============================================================
     4. THE CONTRACTOR — a controlled demolition of a building you own.
     ============================================================ */
  // Trades the city cannot lose for good: knocking down the only hospital or
  // bank would break systems far away from this lot, and a landmark tower is
  // not a contractor's job.
  const PROTECTED = { bank: 1, hospital: 1, guns: 1, realtor: 1, casino: 1, carlot: 1, security: 1,
    cityhall: 1, arena: 1, raceway: 1, police: 1, jewelry: 1, airfield: 1, transit: 1 };
  function demoQuote(plot) {
    if (!plot) return { ok: false, reason: "No plot." };
    const lot = plot.lot, b = lot.building;
    if (lot.demolished) return { ok: false, reason: "Already a bare lot." };
    if (!b || b.park || !b.group || !b.colliders || !b.colliders.length) return { ok: false, reason: "Nothing standing to knock down." };
    const kind = (b.shop && b.shop.kind) || lot.kind || "";
    if (PROTECTED[kind]) return { ok: false, reason: "The city won't permit tearing down a " + (kind === "guns" ? "gun store" : kind) + "." };
    if (b.helipad || b.hangar || (b.home && (b.home.flagship || b.home.id === "penthouse")) || (b.storeys || 1) > 30) return { ok: false, reason: "No contractor will take down a tower that size." };
    if (g.cityHome && g.cityHome.lot === lot) return { ok: false, reason: "You live here. Move your home first." };
    const cost = Math.round((4000 + (b.w || 20) * (b.d || 20) * (b.storeys || 1) * 6) / 500) * 500;
    return { ok: true, cost: cost, storeys: b.storeys || 1 };
  }
  let pendingDemo = null;   // {plot, t, warned, count}
  function dangerRadius(b) { return Math.max(b.w || 20, b.d || 20) * 0.55 + 7; }
  function orderDemolition(plot) {
    const q = demoQuote(plot);
    if (!q.ok) { note(q.reason, 2.2); sfx("empty"); return false; }
    if (pendingDemo) { note("The crew is already on a job.", 1.8); return false; }
    if (!charge(q.cost)) { note("Need " + money(q.cost) + " for the demolition crew.", 2.2); sfx("empty"); return false; }
    closePanel();
    pendingDemo = { plot: plot, count: -1, waitNote: 0 };
    if (CBZ.cityDemolition && CBZ.cityDemolition.hold) CBZ.cityDemolition.hold(plot.lot, true);
    note("Demolition paid. The crew is setting charges, get clear of the building.", 3.2);
    sfx("coin");
    return true;
  }
  // everyone inside walks out before the charges go (a legal job clears the
  // building; the dead-in-the-rubble outcome is the RPG's, not the contractor's)
  function evacuate(b) {
    const peds = CBZ.cityPeds || [];
    const R = Math.max(b.w, b.d) * 0.6 + 2;
    for (const p of peds) {
      if (!p || p.dead || !p.pos) continue;
      const dx = p.pos.x - b.ox, dz = p.pos.z - b.oz;
      if (Math.abs(dx) > R || Math.abs(dz) > R) continue;
      if (p.staffPost || p._npcAttached || (p.pos.y || 0) > 1.5) {
        // posted staff and people up on the floors leave by the back stairs
        // before the crew arrives: they are simply not there any more.
        if (CBZ.cityUnpostNpc && !CBZ.cityPlotFriendly(p)) { try { CBZ.cityUnpostNpc(p); } catch (e) {} continue; }
      }
      const l = Math.hypot(dx, dz) || 1;
      if (p.target && p.target.set) p.target.set(b.ox + dx / l * (R + 26), 0, b.oz + dz / l * (R + 26));
      p.state = "walk"; p.pause = 0; p.path = null; p.guard = null;
    }
  }
  function tickDemolition(dt) {
    const pd = pendingDemo; if (!pd) return;
    const lot = pd.plot.lot, b = lot.building;
    if (!plots.has(pd.plot.id) || lot.demolished || !b) { pendingDemo = null; return; }
    const P = CBZ.player; if (!P || !P.pos) return;
    const R = dangerRadius(b);
    const d = Math.hypot(P.pos.x - b.ox, P.pos.z - b.oz);
    if (pd.count < 0) {
      if (d < R) {
        pd.waitNote -= dt;
        if (pd.waitNote <= 0) { pd.waitNote = 5; note("The crew won't fire with you this close. Back off " + Math.ceil(R - d + 1) + " m.", 2.2); }
        return;
      }
      pd.count = 3.0; pd.beep = 0;
      evacuate(b);
      big("STAND CLEAR");
    }
    pd.count -= dt;
    pd.beep -= dt;
    if (pd.beep <= 0 && pd.count > 0.2) { pd.beep = 1; note("Charges in " + Math.max(1, Math.ceil(pd.count)), 0.9); sfx("key"); }
    if (pd.count > 0) return;
    pendingDemo = null;
    const S = CBZ.structure;
    let ok = false;
    try { ok = !!(S && S.forceCollapse && S.forceCollapse(lot, { by: "contractor", controlled: true })); } catch (e) { ok = false; }
    if (!ok && CBZ.cityDemolition && CBZ.cityDemolition.destroy) {
      try { ok = !!CBZ.cityDemolition.destroy(lot, { held: true }); } catch (e) { ok = false; }
    }
    if (!ok) { note("The charges fizzled. Try again.", 2); return; }
    watchClear.push(pd.plot);
  }
  // the collapse takes several seconds of choreography before demolition.js
  // lays the rubble; the plot flips to "cleared" the moment it actually does
  const watchClear = [];
  function tickClearWatch() {
    for (let i = watchClear.length - 1; i >= 0; i--) {
      const plot = watchClear[i];
      if (!plot.lot.demolished) continue;
      watchClear.splice(i, 1);
      plot.cleared = true; plot._rec.cleared = true;
      if (CBZ.cityDemolition && CBZ.cityDemolition.hold) CBZ.cityDemolition.hold(plot.lot, true);
      note("The lot is yours to build on once the rubble is hauled off.", 3);
      emit("clear", plot);
      persist();
    }
  }

  /* ============================================================
     5. THE STREET — FOR SALE signs on the market's lots near you, and an
        address post on every lot you own. Pooled, distance-gated, built
        from one shared set of geometries/materials.
     ============================================================ */
  let M = null;   // shared geometry + materials
  function mats() {
    if (M) return M;
    const cm = CBZ.cmat || function (c) { return new THREE.MeshLambertMaterial({ color: c }); };
    M = {
      post: cm(0xf1efe8), arm: cm(0xf1efe8), chain: cm(0x3a3d42), steel: cm(0x23262b), box: cm(0x1d2024),
      concrete: cm(0x8e9193),
      postG: new THREE.BoxGeometry(0.09, 2.15, 0.09),
      armG: new THREE.BoxGeometry(1.15, 0.07, 0.07),
      chainG: new THREE.BoxGeometry(0.012, 0.16, 0.012),
      boardG: new THREE.BoxGeometry(0.92, 0.62, 0.025),
      footG: new THREE.BoxGeometry(0.18, 0.05, 0.18),
      apostG: new THREE.BoxGeometry(0.11, 1.12, 0.11),
      mboxG: new THREE.BoxGeometry(0.26, 0.24, 0.5),
      mlidG: new THREE.CylinderGeometry(0.13, 0.13, 0.5, 12, 1, false, 0, Math.PI),
      plateG: new THREE.BoxGeometry(0.34, 0.14, 0.012),
      baseG: new THREE.BoxGeometry(0.34, 0.08, 0.34),
    };
    return M;
  }
  function paintSale(ctx, W, H, price, tag) {
    ctx.fillStyle = "#fbfaf6"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#c8202b"; ctx.fillRect(0, 0, W, H * 0.34);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold " + Math.round(H * 0.22) + "px Arial, Helvetica, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(tag, W / 2, H * 0.18);
    ctx.fillStyle = "#1b1d21";
    ctx.font = "bold " + Math.round(H * 0.2) + "px Arial, Helvetica, sans-serif";
    ctx.fillText(price, W / 2, H * 0.56);
    ctx.fillStyle = "#c8202b"; ctx.fillRect(W * 0.08, H * 0.74, W * 0.84, 3);
    ctx.fillStyle = "#3a3f46";
    ctx.font = "bold " + Math.round(H * 0.1) + "px Arial, Helvetica, sans-serif";
    ctx.fillText("KEYSTONE REALTY", W / 2, H * 0.86);
    ctx.strokeStyle = "#1b1d21"; ctx.lineWidth = 6; ctx.strokeRect(3, 3, W - 6, H - 6);
  }
  function paintPlate(ctx, W, H, num) {
    ctx.fillStyle = "#15171a"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#e9e3cf";
    ctx.font = "bold " + Math.round(H * 0.72) + "px Arial, Helvetica, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(num, W / 2, H * 0.54);
  }
  function makeCanvasMat(w, h) {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    const m = new THREE.MeshLambertMaterial({ map: t });
    return { canvas: c, ctx: c.getContext("2d"), tex: t, mat: m };
  }
  // a sign stands just inside the frontage, off to one side of the door so it
  // never sits in the walkway, and its board faces the street
  // how far the building's face stands back from the frontage line (a sign
  // or a post never stands inside a wall: when the shell runs right up to the
  // property line it moves out onto the sidewalk band instead)
  function frontGap(lot, f) {
    const b = lot.building;
    if (!b || lot.demolished || !(b.w > 0) || !(b.d > 0) || b.park) return 99;
    if (f.side === 0) return (b.oz - b.d / 2) - f.z;
    if (f.side === 2) return f.z - (b.oz + b.d / 2);
    if (f.side === 1) return f.x - (b.ox + b.w / 2);
    return (b.ox - b.w / 2) - f.x;
  }
  function spotAt(lot, inset, sideSign) {
    const r = lotRect(lot), f = frontOf(lot, r);
    const gap = frontGap(lot, f);
    const ins = gap > inset + 0.8 ? inset : Math.max(-1.1, gap - 0.7);
    const tx = -f.nz, tz = f.nx;                       // along the frontage
    const along = Math.min(9, ((f.side === 0 || f.side === 2) ? (r.maxX - r.minX) : (r.maxZ - r.minZ)) * 0.3) * sideSign;
    return { x: f.x - f.nx * ins + tx * along, z: f.z - f.nz * ins + tz * along, yaw: Math.atan2(f.nx, f.nz), f: f };
  }
  // a sign stands just inside the frontage, off to one side of the door so it
  // never sits in the walkway, and its board faces the street
  function signSpot(lot) { return spotAt(lot, 1.3, 1); }
  // the address post sits inside the property line by 2.4 m on the other
  // side: behind a perimeter wall, beside the gate
  function markerSpot(lot) { return spotAt(lot, 2.4, -1); }
  function buildSign() {
    const m = mats();
    const grp = new THREE.Group();
    const post = new THREE.Mesh(m.postG, m.post); post.position.set(-0.52, 1.075, 0); post.castShadow = true; grp.add(post);
    const foot = new THREE.Mesh(m.footG, m.steel); foot.position.set(-0.52, 0.025, 0); grp.add(foot);
    const arm = new THREE.Mesh(m.armG, m.arm); arm.position.set(0.0, 2.02, 0); arm.castShadow = true; grp.add(arm);
    const c1 = new THREE.Mesh(m.chainG, m.chain); c1.position.set(-0.3, 1.9, 0); grp.add(c1);
    const c2 = new THREE.Mesh(m.chainG, m.chain); c2.position.set(0.3, 1.9, 0); grp.add(c2);
    const cm = makeCanvasMat(512, 352);
    const faceMats = [m.post, m.post, m.post, m.post, cm.mat, cm.mat];
    const board = new THREE.Mesh(m.boardG, faceMats); board.position.set(0.02, 1.5, 0); board.castShadow = true; grp.add(board);
    grp.visible = false;
    return { group: grp, cm: cm, text: "", lot: null, x: 0, z: 0 };
  }
  function buildMarker(num) {
    const m = mats();
    const grp = new THREE.Group();
    const base = new THREE.Mesh(m.baseG, m.concrete); base.position.y = 0.14; grp.add(base);
    const post = new THREE.Mesh(m.apostG, m.steel); post.position.y = 0.72; post.castShadow = true; grp.add(post);
    const box = new THREE.Mesh(m.mboxG, m.box); box.position.set(0, 1.4, 0); box.castShadow = true; grp.add(box);
    const lid = new THREE.Mesh(m.mlidG, m.box); lid.rotation.x = Math.PI / 2; lid.rotation.z = Math.PI / 2; lid.position.set(0, 1.52, 0); grp.add(lid);
    const cm = makeCanvasMat(128, 52);
    paintPlate(cm.ctx, 128, 52, num); cm.tex.needsUpdate = true;
    const plate = new THREE.Mesh(m.plateG, [m.steel, m.steel, m.steel, m.steel, cm.mat, cm.mat]);
    plate.position.set(0, 1.0, 0.062); grp.add(plate);
    const plate2 = plate.clone(); plate2.position.z = -0.062; grp.add(plate2);
    return { group: grp, cm: cm };
  }

  const SIGN_N = 8, SIGN_R = 95;
  const signs = [];
  const markers = new Map();    // plot.id -> {group, cm, x, z, plot}
  let signT = 0, lastSX = 1e9, lastSZ = 1e9;
  function ensureSigns() {
    const A = arena(); if (!A || !A.root) return false;
    if (signs.length && signs[0].group.parent === A.root) return true;
    for (const s of signs) { if (s.group.parent) s.group.parent.remove(s.group); }
    signs.length = 0;
    for (let i = 0; i < SIGN_N; i++) { const s = buildSign(); A.root.add(s.group); signs.push(s); }
    return true;
  }
  function saleEligible(lot) {
    const z = Z(); if (!z || !z.canBuyLot) return false;
    if (lot.demolished || !lot.building || lot.building.park) return false;
    return z.canBuyLot(lot) || seizable(lot);
  }
  // a gang op on YOUR turf (or whose crew trusts you) is taken over, not bought
  function seizable(lot) { const z = Z(); return !!(z && z.canSeizeLot && z.canSeizeLot(lot)); }
  function refreshSigns(force) {
    const P = CBZ.player; if (!P || !P.pos || !ensureSigns()) return;
    const moved = Math.hypot(P.pos.x - lastSX, P.pos.z - lastSZ);
    if (!force && moved < 6) {
      // repaint only: prices breathe with the market
      for (const s of signs) if (s.lot) paintSignFor(s, s.lot);
      return;
    }
    lastSX = P.pos.x; lastSZ = P.pos.z;
    const cands = [];
    for (const lot of allLots()) {
      const dx = lot.cx - P.pos.x, dz = lot.cz - P.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > SIGN_R * SIGN_R) continue;
      if (!saleEligible(lot)) continue;
      cands.push({ lot: lot, d2: d2 });
    }
    cands.sort(function (a, b) { return a.d2 - b.d2; });
    for (let i = 0; i < signs.length; i++) {
      const s = signs[i], c = cands[i];
      if (!c) { s.group.visible = false; s.lot = null; continue; }
      if (s.lot !== c.lot) {
        s.lot = c.lot;
        const sp = signSpot(c.lot);
        s.x = sp.x; s.z = sp.z;
        const y = CBZ.floorAt ? (+CBZ.floorAt(sp.x, sp.z) || 0.1) : 0.1;
        s.group.position.set(sp.x, Math.min(0.4, Math.max(0, y)), sp.z);
        s.group.rotation.y = sp.yaw;
        s.text = "";
      }
      paintSignFor(s, c.lot);
      s.group.visible = true;
    }
  }
  function priceOf(lot) {
    const z = Z(); if (!z) return null;
    if (seizable(lot) && z.seizePriceForLot) return z.seizePriceForLot(lot);
    return z.buyPriceForLot ? z.buyPriceForLot(lot) : null;
  }
  function paintSignFor(s, lot) {
    const p = priceOf(lot);
    const rec = listing(lot);
    const tag = (rec && rec.category === "commercial") ? "FOR SALE" : "FOR SALE";
    const txt = tag + "|" + (p != null ? money(p) : "");
    if (txt === s.text) return;
    s.text = txt;
    paintSale(s.cm.ctx, 512, 352, p != null ? money(p) : "", tag);
    s.cm.tex.needsUpdate = true;
  }
  function refreshMarkers() {
    const A = arena(); if (!A || !A.root) return;
    for (const [id, mk] of Array.from(markers)) {
      if (plots.has(id) && mk.group.parent === A.root) continue;
      if (mk.group.parent) mk.group.parent.remove(mk.group);
      if (mk.cm) { try { mk.cm.tex.dispose(); mk.cm.mat.dispose(); } catch (e) {} }
      markers.delete(id);
    }
    for (const plot of plots.values()) {
      if (markers.has(plot.id)) continue;
      const num = (String(plot.address || "").match(/^\d+/) || [""])[0] || "";
      const mk = buildMarker(num);
      const sp = markerSpot(plot.lot);
      mk.group.position.set(sp.x, 0.02, sp.z);
      mk.group.rotation.y = sp.yaw;
      mk.x = sp.x; mk.z = sp.z; mk.plot = plot;
      A.root.add(mk.group);
      markers.set(plot.id, mk);
    }
  }

  /* ============================================================
     6. THE PANELS — the listing card (at a sign) and your property (at your
        address post). One overlay element, re-rendered on every action.
     ============================================================ */
  let panel = null, panelMode = null, panelLot = null, panelPlot = null;
  function injectCss() {
    if (document.getElementById("plotsCss")) return;
    const st = document.createElement("style"); st.id = "plotsCss";
    st.textContent =
      "#plotPanel{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:49;display:none;width:min(440px,94vw);max-height:86vh;overflow:auto;" +
      "background:linear-gradient(180deg,rgba(22,26,32,.97),rgba(14,17,21,.97));border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:16px 18px 14px;color:#e8eef7;" +
      "font-family:Fredoka,system-ui,sans-serif;box-shadow:0 22px 60px rgba(0,0,0,.55);pointer-events:auto}" +
      "#plotPanel .ph{font-size:20px;font-weight:700;line-height:1.15}" +
      "#plotPanel .ps{font-size:12.5px;color:#93a1b3;margin-top:3px}" +
      "#plotPanel .pv{display:flex;gap:10px;margin:12px 0 4px}" +
      "#plotPanel .pv div{flex:1;background:rgba(255,255,255,.05);border-radius:9px;padding:7px 9px}" +
      "#plotPanel .pv b{display:block;font-size:16px;color:#fff}" +
      "#plotPanel .pv span{font-size:11px;color:#8d9aab;text-transform:uppercase;letter-spacing:.06em}" +
      "#plotPanel .sec{margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,.08)}" +
      "#plotPanel .st{font-size:11px;color:#8d9aab;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px}" +
      "#plotPanel .row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:4px 0;font-size:13.5px}" +
      "#plotPanel .row .sub{display:block;font-size:11.5px;color:#8d9aab}" +
      "#plotPanel .bts{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}" +
      "#plotPanel button{font:600 13px Fredoka,system-ui,sans-serif;border:0;border-radius:8px;padding:7px 11px;cursor:pointer;background:#2c3947;color:#e8f1ff}" +
      "#plotPanel button.ok{background:#2f7d4a;color:#fff}#plotPanel button.bad{background:#7a2a2a;color:#fff}" +
      "#plotPanel button[disabled]{opacity:.45;cursor:default}" +
      "#plotPanel .msg{font-size:12.5px;color:#ffcf7a;margin-top:8px;min-height:1em}" +
      "#plotPanel .x{position:absolute;right:12px;top:10px;font-size:18px;color:#8d9aab;cursor:pointer;background:none;padding:2px 6px}";
    document.head.appendChild(st);
  }
  function el() {
    if (panel) return panel;
    injectCss();
    panel = document.createElement("div"); panel.id = "plotPanel";
    panel.addEventListener("click", function (e) {
      const b = e.target && e.target.closest ? e.target.closest("[data-a]") : null;
      if (!b || b.disabled) return;
      e.preventDefault(); e.stopPropagation();
      const fn = actions[+b.getAttribute("data-a")];
      if (typeof fn === "function") { try { fn(); } catch (err) { console.warn("[plots] action", err); } }
    });
    document.body.appendChild(panel);
    return panel;
  }
  let actions = [], msg = "";
  function act(fn) { actions.push(fn); return actions.length - 1; }
  function btn(label, fn, tone, disabled) {
    return "<button data-a='" + act(fn) + "'" + (tone ? " class='" + tone + "'" : "") + (disabled ? " disabled" : "") + ">" + esc(label) + "</button>";
  }
  function openShell() {
    if (CBZ.cityMenuOpen && !(panel && panel.style.display === "block")) return false;
    el().style.display = "block";
    CBZ.cityMenuOpen = true;
    if (document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
    return true;
  }
  function closePanel() {
    if (!panel || panel.style.display !== "block") return;
    panel.style.display = "none";
    panelMode = null; panelLot = null; panelPlot = null; msg = "";
    CBZ.cityMenuOpen = false;
    if (CBZ.requestLock && g.state === "playing") CBZ.requestLock();
  }
  function lotFacts(lot) {
    const b = lot.building || {};
    const w = Math.round(lot.w || 0), d = Math.round(lot.d || 0);
    const bits = [];
    if (w && d) bits.push(w + " x " + d + " m lot");
    if (lot.demolished) bits.push("cleared pad");
    else if (b.storeys) bits.push(b.storeys + (b.storeys === 1 ? " storey" : " storeys"));
    return bits.join(", ");
  }
  function openListing(lot) {
    if (!openShell()) return;
    panelMode = "sale"; panelLot = lot; msg = "";
    renderListing();
  }
  function renderListing() {
    const lot = panelLot, z = Z(); if (!lot || !z) return closePanel();
    actions = [];
    const rec = listing(lot);
    const price = priceOf(lot);
    const fq = z.financeQuoteForLot ? z.financeQuoteForLot(lot) : null;
    let h = "<button class='x' data-a='" + act(closePanel) + "'>x</button>";
    h += "<div class='ph'>" + esc(nameFor(lot)) + "</div>";
    h += "<div class='ps'>" + esc(addressFor(lot)) + (rec && rec.occupant ? ", held by " + esc(String(rec.occupant).split(" — ")[0]) : "") + "</div>";
    h += "<div class='pv'><div><span>Asking</span><b>" + (price != null ? money(price) : "n/a") + "</b></div>" +
      "<div><span>Parcel</span><b style='font-size:13px'>" + esc(lotFacts(lot)) + "</b></div></div>";
    h += "<div class='ps' style='margin-top:6px'>You have " + money(g.cash || 0) + " cash and " + money(g.cityBank || 0) + " in the bank.</div>";
    const can = z.canBuyLot ? z.canBuyLot(lot) : false;
    if (!can && seizable(lot)) {
      h += "<div class='sec'><div class='row'><span>Take it over<span class='sub'>The block is yours, so is the operation. Pay the crew off and it changes hands.</span></span><span class='bts'>" +
        btn("Take over " + (price != null ? money(price) : ""), function () {
          const had = ownsLot(lot);
          if (z.seizeByLot) z.seizeByLot(lot);
          afterBuy(lot, had);
        }, "ok", price == null || !canAfford(price)) + "</span></div></div><div class='msg'>" + esc(msg) + "</div>";
      panel.innerHTML = h;
      return;
    }
    h += "<div class='sec'><div class='row'><span>Buy it outright<span class='sub'>The deed, the building and the ground under it.</span></span><span class='bts'>" +
      btn("Buy " + (price != null ? money(price) : ""), function () {
        const had = ownsLot(lot);
        if (z.buyByLot) z.buyByLot(lot);
        afterBuy(lot, had);
      }, "ok", !can || price == null || !canAfford(price)) + "</span></div>";
    if (fq && fq.approved !== false && z.financeByLot) {
      h += "<div class='row'><span>Finance it<span class='sub'>" + money(fq.down) + " down, the bank carries the rest.</span></span><span class='bts'>" +
        btn("Finance", function () { const had = ownsLot(lot); z.financeByLot(lot); afterBuy(lot, had); }, null, !can || !canAfford(fq.down)) + "</span></div>";
    }
    h += "</div><div class='msg'>" + esc(msg) + "</div>";
    panel.innerHTML = h;
  }
  function afterBuy(lot, had) {
    syncPlots(true);
    if (!had && ownsLot(lot)) {
      closePanel();
      refreshSigns(true);
      const plot = CBZ.cityPlots.ofLot(lot);
      note("It's yours. The address post by the front is where you run the place.", 3);
      if (plot) setTimeout(function () { if (playing() && !CBZ.cityMenuOpen) openPanel(plot); }, 900);
    } else {
      const z = Z();
      msg = (z && z.lastMessage && z.lastMessage()) || "The sale didn't close. Check your cash.";
      renderListing();
    }
  }
  function openPanel(plot) {
    if (!plot) return;
    if (!openShell()) return;
    panelMode = "own"; panelPlot = plot; msg = "";
    renderPanel();
  }
  function renderPanel() {
    const plot = panelPlot; if (!plot || !plots.has(plot.id)) return closePanel();
    actions = [];
    const z = Z(), lot = plot.lot;
    const val = z && z.listingForLot ? (listing(lot) || {}).value : null;
    const sellP = z && z.sellPriceForLot ? z.sellPriceForLot(lot) : null;
    let h = "<button class='x' data-a='" + act(closePanel) + "'>x</button>";
    h += "<div class='ph'>" + esc(plot.name) + "</div>";
    h += "<div class='ps'>" + esc(plot.title && plot.title !== plot.name ? plot.title + ", " : "") + esc(lotFacts(lot)) + "</div>";
    h += "<div class='pv'><div><span>Value</span><b>" + (val != null ? money(val) : "n/a") + "</b></div>" +
      "<div><span>Status</span><b style='font-size:13px'>" + (lot.demolished ? (CBZ.cityDemolition && CBZ.cityDemolition.phaseOf && CBZ.cityDemolition.phaseOf(lot) === 1 ? "Rubble, hauling" : "Bare pad, ready to build") : (pendingDemo && pendingDemo.plot === plot ? "Charges set" : "Building standing")) + "</b></div></div>";

    // ---- the land itself -----------------------------------------------
    h += "<div class='sec'><div class='st'>The lot</div>";
    if (!lot.demolished) {
      const q = demoQuote(plot);
      h += "<div class='row'><span>Knock it down<span class='sub'>" + (q.ok ? "Controlled demolition, rubble hauled off, a poured pad left to build on." : esc(q.reason)) + "</span></span><span class='bts'>" +
        btn(q.ok ? "Demolish " + money(q.cost) : "Demolish", function () { orderDemolition(plot); }, "bad", !q.ok || !!pendingDemo || (q.ok && !canAfford(q.cost))) + "</span></div>";
    } else {
      h += "<div class='row'><span>Build on it<span class='sub'>Press N standing on the lot to place walls, gates and buildings piece by piece.</span></span></div>";
    }
    const mort = z && z.mortgageForLot ? z.mortgageForLot(lot) : null;
    if (mort && mort.balance > 0) {
      const half = Math.round(mort.balance * 0.5);
      h += "<div class='row'><span>Mortgage<span class='sub'>" + money(mort.balance) + " still owed to the bank.</span></span><span class='bts'>" +
        btn("Pay " + money(half), function () { msg = z.payMortgageByLot(lot, 0.5) || ""; renderPanel(); }, null, !canAfford(half)) +
        btn("Pay off", function () { msg = z.payMortgageByLot(lot, 1) || ""; renderPanel(); }, "ok", !canAfford(mort.balance)) + "</span></div>";
    }
    const home = lot.building && lot.building.home;
    if (home && !lot.demolished && z && z.setHomeByLot && !(g.cityHome && g.cityHome.lot === lot)) {
      h += "<div class='row'><span>Live here<span class='sub'>Your respawn and safehouse.</span></span><span class='bts'>" +
        btn("Set as home", function () { z.setHomeByLot(lot); msg = "This is home now."; renderPanel(); }) + "</span></div>";
    }
    h += "</div>";

    // ---- what the builder and the crew add --------------------------------
    for (const fn of sections) {
      let s = null;
      try { s = fn(plot); } catch (e) { s = null; console.warn("[plots] section", e); }
      if (!s || !s.rows || !s.rows.length) continue;
      h += "<div class='sec'>" + (s.title ? "<div class='st'>" + esc(s.title) + "</div>" : "");
      for (const r of s.rows) {
        h += "<div class='row'><span>" + esc(r.text || "") + (r.sub ? "<span class='sub'>" + esc(r.sub) + "</span>" : "") + "</span><span class='bts'>";
        for (const b of (r.buttons || [])) {
          h += btn(b.label, (function (bb) { return function () { const res = bb.onClick && bb.onClick(); if (typeof res === "string") msg = res; if (panelMode === "own") renderPanel(); }; })(b), b.tone || null, !!b.disabled);
        }
        h += "</span></div>";
      }
      h += "</div>";
    }

    // ---- let it go --------------------------------------------------------
    h += "<div class='sec'><div class='row'><span>Sell<span class='sub'>Whatever you built on it is stripped with the sale.</span></span><span class='bts'>" +
      btn("Sell " + (sellP != null ? money(sellP) : ""), function () {
        if (!confirmSell) { confirmSell = plot.id; msg = "Press Sell again to close the sale."; renderPanel(); return; }
        confirmSell = null;
        if (z && z.sellByLot) z.sellByLot(lot);
        syncPlots(true);
        closePanel(); refreshSigns(true);
      }, "bad") + "</span></div></div>";
    h += "<div class='msg'>" + esc(msg) + "</div>";
    panel.innerHTML = h;
  }
  let confirmSell = null;
  addEventListener("keydown", function (e) {
    if (!panel || panel.style.display !== "block") return;
    if ((e.key || "").toLowerCase() === "escape") { e.preventDefault(); e.stopPropagation(); closePanel(); }
  }, true);

  /* ============================================================
     7. THE VERBS — E at a sale sign, E at your address post.
     ============================================================ */
  let verbsWired = false;
  function wireVerbs() {
    if (verbsWired || !CBZ.interactions || !CBZ.interactions.registerZone) return;
    verbsWired = true;
    const I = CBZ.interactions;
    const RADIUS = 3.4;
    I.registerZone({
      id: "plots-sale", kind: "sale-sign", radius: RADIUS,
      find: function (px, pz) {
        let best = null, bd = RADIUS * RADIUS;
        for (const s of signs) {
          if (!s.lot || !s.group.visible) continue;
          const dx = s.x - px, dz = s.z - pz, d2 = dx * dx + dz * dz;
          if (d2 < bd) { bd = d2; best = s; }
        }
        if (!best) return null;
        // ONE target object per sign: the card's hysteresis compares identity
        const t = best.tgt || (best.tgt = { pos: { x: 0, y: 1.4, z: 0 } });
        t.x = t.pos.x = best.x; t.z = t.pos.z = best.z; t.lot = best.lot; t.name = nameFor(best.lot);
        return t;
      },
      options: [{
        id: "plots-sale-look", slot: "e", prio: 2, campaignSafe: true,
        label: function (t) { const p = t && t.lot ? priceOf(t.lot) : null; return "For sale" + (p != null ? ", " + money(p) : ""); },
        onSelect: function (t) { if (t && t.lot) openListing(t.lot); },
      }],
    });
    I.registerZone({
      id: "plots-own", kind: "property", radius: RADIUS,
      find: function (px, pz) {
        let best = null, bd = RADIUS * RADIUS;
        for (const mk of markers.values()) {
          const dx = mk.x - px, dz = mk.z - pz, d2 = dx * dx + dz * dz;
          if (d2 < bd) { bd = d2; best = mk; }
        }
        if (!best || !plots.has(best.plot.id)) return null;
        const t = best.tgt || (best.tgt = { pos: { x: 0, y: 1.2, z: 0 } });
        t.x = t.pos.x = best.x; t.z = t.pos.z = best.z; t.plot = plots.get(best.plot.id); t.name = t.plot.name;
        return t;
      },
      options: [{
        id: "plots-own-manage", slot: "e", prio: 2, campaignSafe: true,
        label: function (t) { return "Your property" + (t && t.plot ? ", " + t.plot.name : ""); },
        onSelect: function (t) { if (t && t.plot) openPanel(t.plot); },
      }],
    });
  }

  /* ============================================================
     8. THE TICK
     ============================================================ */
  let syncT = 0, lastInside = null, insideNoteT = 0, lastArena = null;
  CBZ.onUpdate(46.2, function (dt) {
    if (!inCity()) { if (panel && panel.style.display === "block") closePanel(); return; }
    wrapSaves();
    hydrate();
    const A = arena();
    if (!A) return;
    // A NEW WORLD IS A NEW SET OF LOTS: plots hold live lot refs, so a city
    // rebuild re-derives them (the persisted records carry over by id).
    if (A !== lastArena) {
      lastArena = A;
      for (const plot of plots.values()) lockDoors(plot.lot, false);
      plots.clear(); ownSig = ""; lastSX = lastSZ = 1e9;
    }
    dt = dt || 0.016;
    syncT -= dt;
    if (syncT <= 0) {
      syncT = 0.5;
      syncPlots(false);
      _loadingT -= 0.5; if (_loadingT <= 0) _loading = false;
      refreshMarkers();
    }
    wireVerbs();
    tickDemolition(dt);
    tickClearWatch();
    signT -= dt;
    if (signT <= 0) { signT = 1.0; refreshSigns(false); }
    if (_persistT > 0) { _persistT -= dt; if (_persistT <= 0 && CBZ.cityWorldCommit) { try { CBZ.cityWorldCommit(); } catch (e) {} } }
    // a quiet line the first time you step onto your own land this visit
    const P = CBZ.player;
    if (P && P.pos && !P.dead) {
      insideNoteT -= dt;
      if (insideNoteT <= 0) {
        insideNoteT = 0.5;
        const here = plotAt(P.pos.x, P.pos.z, 0);
        if (here && here !== lastInside) note("Your land, " + here.name + ".", 1.8);
        lastInside = here;
      }
    }
    if (panel && panel.style.display === "block") {
      if (g.state !== "playing") return;
      // re-render the owned panel as the lot changes state underneath it
      panelT -= dt;
      if (panelT <= 0 && panelMode === "own") { panelT = 1; if (!document.activeElement || document.activeElement === document.body) renderPanel(); }
    }
  });
  let panelT = 0;

  CBZ.cityPlotsReset = function () {
    closePanel();
    pendingDemo = null; watchClear.length = 0;
    for (const plot of plots.values()) lockDoors(plot.lot, false);
    plots.clear(); ownSig = "";
    for (const mk of markers.values()) { if (mk.group.parent) mk.group.parent.remove(mk.group); }
    markers.clear();
    for (const s of signs) { s.lot = null; s.group.visible = false; }
    lastSX = lastSZ = 1e9;
    _spHydrated = null;
  };
})();
