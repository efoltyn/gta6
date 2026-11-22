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
        estate sign at the curb with the live asking price. The sign is the
        whole listing: its verbs are on it (buy it, finance it on its wheel;
        on a house, take the lockbox key and look round first, city/
        realestate.js), and when it sells it says SOLD and then it is gone.
        (It used to open a listing card with the same two buttons on it.)
     3. THE ADDRESS POST. Every lot you own has one at its gate, and what you
        do with the lot you do there, with your hands: look it over (a line,
        what it is worth and what the bank is owed on it), STAND ITS FOR SALE
        SIGN BACK UP (the sign goes up at the kerb with your price on it, and
        when a buyer takes it the sign says SOLD and the money is yours; take
        the sign down again and it is not for sale), KNOCK IT DOWN (a
        contractor's controlled demolition: the real collapse, pancaked into
        its own footprint, then the rubble is carted off and the lot stays a
        bare poured pad for as long as you own it), and whatever the builder
        and the crew add to it (their works and their hires are on the post's
        wheel). The estate agent sells a lot for you too, and he and the
        bank's counter take a mortgage payment (city/realestate.js).
        (This was a panel: Value, Status, Demolish, Mortgage, Compound, Crew
        and Sell as rows of buttons. It is deleted.)
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
    const now = CBZ.paceTime ? CBZ.paceTime() : 0;
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
    if (plot.data) delete plot.data.sale;              // its sign came down with the deed
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
    // what a system adds to a lot you own (fn(plot) -> { title, rows: [{ text,
    // sub, buttons: [{ label, onClick, disabled }] }] }): each button is a verb
    // on the lot's address post. (The name is from when they were a panel's rows.)
    addPanelSection: function (fn) { if (typeof fn === "function" && sections.indexOf(fn) < 0) sections.push(fn); },
    save: function () { persist(); },
    markSold: markSold, isSold: isSold,
    // a lot of yours with its sign up; put it up / take it down
    listed: function (lot) { return !!mySale(lot); },
    putUpForSale: function (plot) { return listForSale(plot); }, takeDown: function (plot) { return unlist(plot); },
    // the signs standing near you right now (a read)
    signs: function () { const out = []; for (const sg of signs) if (sg.lot && sg.group.visible) out.push({ x: sg.x, z: sg.z, lot: sg.lot, text: sg.text }); return out; },
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
        // before the crew arrives: they walk out and are taken off the world
        // when nobody can see them (systems/leave.js; behind the building's
        // walls that is at once). They used to be "simply not there any more".
        if (CBZ.cityUnpostNpc && !CBZ.cityPlotFriendly(p)) {
          try { if (p._npcAttached && CBZ.cityUnseat) CBZ.cityUnseat(p, { state: "walk" }); } catch (e) {}
          const door = b.door || null;
          if (CBZ.leave && CBZ.leave.go(p, { tag: "demolition", exits: (p.pos.y || 0) < 1.5 && door && door.x != null ? [{ x: door.x, z: door.z, door: true }] : null, remove: CBZ.cityUnpostNpc })) continue;
          try { CBZ.cityUnpostNpc(p); } catch (e) {}
          continue;
        }
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
    if (tag === "SOLD") {
      // the whole board is the word, the way an agent's rider covers the price
      ctx.fillStyle = "#c8202b"; ctx.fillRect(0, 0, W, H * 0.72);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold " + Math.round(H * 0.44) + "px Arial, Helvetica, sans-serif";
      ctx.fillText("SOLD", W / 2, H * 0.38);
    }
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
  /* A sign's picture is a PAINTER, not a canvas: cm.draw(fn) records what the
     sign says and the canvas exists only while three uploads it, the first
     frame the sign is drawn (core/texfree.js lazyCanvasTexture). The pooled
     for-sale signs are painted when a lot is assigned, often far out of
     sight, and each held its 512 x 352 canvas (0.7 MB) from then on: 5.5 MB
     of canvases at the phone boot for signs nobody had looked at. A repaint
     (a new price) re-uploads by running the newest painter. */
  function makeCanvasMat(w, h) {
    let painter = null;
    const paint = function (ctx) { if (painter) painter(ctx, w, h); };
    let t;
    if (CBZ.lazyCanvasTexture) t = CBZ.lazyCanvasTexture(w, h, paint);
    else { const c = document.createElement("canvas"); c.width = w; c.height = h; t = new THREE.CanvasTexture(c); }
    t.anisotropy = 4;
    const m = new THREE.MeshLambertMaterial({ map: t });
    const cm = { tex: t, mat: m };
    cm.draw = function (fn) {
      painter = fn;
      if (!CBZ.lazyCanvasTexture) fn(t.image.getContext("2d"), w, h);
      t.needsUpdate = true;
    };
    return cm;
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
    cm.draw(function (ctx) { paintPlate(ctx, 128, 52, num); });
    const plate = new THREE.Mesh(m.plateG, [m.steel, m.steel, m.steel, m.steel, cm.mat, cm.mat]);
    plate.position.set(0, 1.0, 0.062); grp.add(plate);
    const plate2 = plate.clone(); plate2.position.z = -0.062; grp.add(plate2);
    return { group: grp, cm: cm };
  }

  const SIGN_N = 8, SIGN_R = 95;
  // a lot that just sold keeps its sign for a minute, and the sign says so
  const SOLD_SECS = 60;
  const soldT = new Map();
  let clock = 0;
  function markSold(lot) { if (lot) { soldT.set(lot, clock); lastSX = 1e9; } }
  function isSold(lot) { const t = soldT.get(lot); return t != null && clock - t < SOLD_SECS; }
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
    if (mySale(lot)) return true;                      // yours, with its sign stood back up
    if (lot.demolished || !lot.building || lot.building.park) return false;
    return z.canBuyLot(lot) || seizable(lot);
  }
  /* ---- SELLING IT: THE SIGN GOES BACK UP ----------------------------------------
     A lot you own is put on the market the way every lot in this city is: a
     FOR SALE sign at its kerb, with the price on it (what the market pays
     you today). It stands a while; then a buyer takes it, the sign says SOLD
     and the money is in your account. Take the sign down first and nothing
     is sold. The listing rides the plot's own saved record. */
  const SALE_SECS = 40;
  function mySale(lot) {
    if (!lot) return null;
    const pl = plots.get("plot:" + lotKey(lot));
    return pl && pl.data && pl.data.sale ? pl : null;
  }
  function listForSale(plot) {
    if (!plot || !plots.has(plot.id) || plot.data.sale) return false;
    soldT.delete(plot.lot);                            // (the SOLD board from when you bought it comes off)
    plot.data.sale = { left: SALE_SECS };
    sfx("pickup"); note("The sign is up. " + plot.name + " is for sale.", 2.6);
    lastSX = 1e9; persist();
    return true;
  }
  function unlist(plot) {
    if (!plot || !plot.data || !plot.data.sale) return false;
    plot.data.sale = null; delete plot.data.sale;
    sfx("pickup"); note("The sign is down. " + plot.name + " is not for sale.", 2.4);
    lastSX = 1e9; persist();
    return true;
  }
  function tickSales(dt) {
    for (const plot of plots.values()) {
      const sl = plot.data && plot.data.sale;
      if (!sl) continue;
      sl.left = (+sl.left || 0) - dt;
      if (sl.left > 0) continue;
      const z = Z(), lot = plot.lot, price = z && z.sellPriceForLot ? z.sellPriceForLot(lot) : null, name = plot.name;
      delete plot.data.sale;
      let ok = false;
      try { ok = !!(z && z.sellByLot && z.sellByLot(lot)); } catch (e) { ok = false; }
      if (!ok) { note((z && z.lastMessage && z.lastMessage()) || "Nobody bought " + name + ".", 2.6); lastSX = 1e9; persist(); continue; }
      markSold(lot);
      sfx("coin");
      note(name + " sold" + (price != null ? " for " + money(price) : "") + ".", 3.2);
      syncPlots(true);
      refreshSigns(true);
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    }
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
      if (!saleEligible(lot) && !isSold(lot)) continue;
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
    if (mySale(lot)) return z.sellPriceForLot ? z.sellPriceForLot(lot) : null;   // your sign: what you get
    if (seizable(lot) && z.seizePriceForLot) return z.seizePriceForLot(lot);
    return z.buyPriceForLot ? z.buyPriceForLot(lot) : null;
  }
  function paintSignFor(s, lot) {
    const gone = isSold(lot) && !mySale(lot);
    const p = gone ? null : priceOf(lot);
    const tag = gone ? "SOLD" : "FOR SALE";
    const txt = tag + "|" + (p != null ? money(p) : "");
    if (txt === s.text) return;
    s.text = txt;
    const price = p != null ? money(p) : "";
    s.cm.draw(function (ctx) { paintSale(ctx, 512, 352, price, tag); });
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
     6. THE DEAL, AT THE SIGN. A house goes through city/realestate.js (the
        key, the house you wake up in); a shop, a block or a plot is the
        ledger's own buy; an operation on your turf is taken over. What tells
        you it closed is the sign: it says SOLD.
     ============================================================ */
  function isHouseLot(lot) { const H = CBZ.cityHome; return !!(H && H.isHouse && H.isHouse(lot)); }
  function dealAt(lot, how) {
    const z = Z(); if (!z || !lot || isSold(lot) || mySale(lot)) return false;
    const had = ownsLot(lot);
    const can = z.canBuyLot ? z.canBuyLot(lot) : false;
    if (!can && seizable(lot)) { if (z.seizeByLot) z.seizeByLot(lot); }
    else if (CBZ.cityHome && CBZ.cityHome.buy && lot.building && lot.building.home) CBZ.cityHome.buy(lot, how === "finance" ? "finance" : "cash", null);
    else if (how === "finance") { if (z.financeByLot) z.financeByLot(lot); }
    else if (z.buyByLot) z.buyByLot(lot);
    syncPlots(true);
    const got = !had && ownsLot(lot);
    if (got) markSold(lot); else sfx("empty");
    refreshSigns(true);
    return got;
  }

  /* ============================================================
     7. THE VERBS. At a sale sign: take the key, buy it, finance it (or, on
        your own sign, take it down). At your own lot's address post: look it
        over, stand the sign up, have it knocked down, and every works order
        and hire the builder and the crew add (CBZ.cityPlots.addPanelSection).
     ============================================================ */
  let verbsWired = false;
  function saleLabel(t) {
    const lot = t && t.lot, z = Z(); if (!lot) return "Buy";
    const p = priceOf(lot);
    const take = !(z && z.canBuyLot && z.canBuyLot(lot)) && seizable(lot);
    return (take ? "Take over " : "Buy ") + (p != null ? money(p) : "");
  }
  function lotFacts(lot) {
    const b = lot.building || {};
    if (lot.demolished) return CBZ.cityDemolition && CBZ.cityDemolition.phaseOf && CBZ.cityDemolition.phaseOf(lot) === 1 ? "rubble, being hauled off" : "a bare pad, ready to build on";
    if (pendingDemo && pendingDemo.plot && pendingDemo.plot.lot === lot) return "charges set";
    return b.storeys ? b.storeys + (b.storeys === 1 ? " storey" : " storeys") + " standing" : "standing";
  }
  // one line, said once: what it is, what it is worth, what the bank is owed
  function lookOver(plot) {
    const z = Z(), lot = plot.lot;
    const val = z && z.listingForLot ? (listing(lot) || {}).value : null;
    const mort = z && z.mortgageForLot ? z.mortgageForLot(lot) : null;
    note(plot.name + (plot.title && plot.title !== plot.name ? " (" + plot.title + ")" : "") + ": " + lotFacts(lot) +
      (val != null ? ", worth " + money(val) : "") + (mort && mort.balance > 0 ? ", " + money(mort.balance) + " owed to the bank" : "") +
      (plot.data.sale ? ". The sign is up." : "."), 4);
  }
  /* WHAT THE BUILDER AND THE CREW ADD TO A LOT, as things to do at its post.
     Their sections still hand back rows of buttons (the shape a panel took);
     each button is one verb here. Read at most twice a second: a section may
     price a whole blueprint to label its button. */
  const ACT_N = 10;
  const actCache = new Map();        // plot.id -> { t, list }
  function lotActions(plot) {
    if (!plot) return [];
    const hit = actCache.get(plot.id);
    if (hit && clock - hit.t < 0.5) return hit.list;
    const list = [];
    for (const fn of sections) {
      let sec = null;
      try { sec = fn(plot); } catch (e) { sec = null; }
      if (!sec || !sec.rows) continue;
      for (const r of sec.rows) for (const b of (r.buttons || [])) {
        if (!b || !b.label || b.disabled) continue;
        const pre = /^(Build|Built)/.test(b.label) || b.label.length < 12;
        list.push({ label: pre && r.text ? r.text + ": " + b.label : b.label, onClick: b.onClick });
      }
    }
    actCache.set(plot.id, { t: clock, list: list });
    return list;
  }
  let sureDemo = null, sureDemoT = 0;
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
      options: [
        // your own sign: it comes down again
        { id: "plots-sale-down", slot: "e", prio: 4, campaignSafe: true, label: "Take the sign down",
          canShow: function (t) { return !!(t && t.lot && mySale(t.lot)); },
          onSelect: function (t) { unlist(mySale(t.lot)); refreshSigns(true); } },
        // a house: the lockbox on the post. Look round before you buy.
        { id: "plots-sale-key", slot: "e", prio: 3, campaignSafe: true, label: "Take the key",
          canShow: function (t) { const H = CBZ.cityHome; return !!(t && t.lot && !mySale(t.lot) && !isSold(t.lot) && isHouseLot(t.lot) && H.hasKey && !H.hasKey(t.lot)); },
          onSelect: function (t) { CBZ.cityHome.view(t.lot); } },
        // a shop, a block, a plot: E buys it. A house is a deliberate hand.
        { id: "plots-sale-buy", slot: "e", prio: 2, campaignSafe: true, label: saleLabel,
          canShow: function (t) { return !!(t && t.lot && !mySale(t.lot) && !isSold(t.lot) && !isHouseLot(t.lot)); },
          onSelect: function (t) { dealAt(t.lot, "cash"); } },
        { id: "plots-sale-buy-house", slot: "e", hold: true, prio: 2, campaignSafe: true, label: saleLabel,
          canShow: function (t) { return !!(t && t.lot && !mySale(t.lot) && !isSold(t.lot) && isHouseLot(t.lot)); },
          onSelect: function (t) { dealAt(t.lot, "cash"); } },
        { id: "plots-sale-finance", wheel: true, prio: 1, campaignSafe: true,
          label: function (t) { const z = Z(), fq = z && z.financeQuoteForLot ? z.financeQuoteForLot(t.lot) : null; return fq ? "Finance " + money(fq.down) + " down" : "Finance"; },
          canShow: function (t) {
            const z = Z(); if (!t || !t.lot || !z || mySale(t.lot) || isSold(t.lot) || !z.financeByLot || !(z.canBuyLot && z.canBuyLot(t.lot))) return false;
            const fq = z.financeQuoteForLot ? z.financeQuoteForLot(t.lot) : null;
            return !!(fq && fq.approved !== false);
          },
          onSelect: function (t) { dealAt(t.lot, "finance"); } },
      ],
    });
    if (I.describe) I.describe("sale-sign", function (t) {
      if (!t || !t.lot) return { label: "For sale", note: "" };
      const p = priceOf(t.lot);
      if (mySale(t.lot)) return { label: nameFor(t.lot), note: "your sign" + (p != null ? ", " + money(p) : "") };
      return { label: nameFor(t.lot), note: isSold(t.lot) ? "sold" : ((addressFor(t.lot) ? addressFor(t.lot) + ", " : "") + (p != null ? money(p) : "")) };
    });
    // ---- your own lot's address post ----
    const postOpts = [
      { id: "plots-own-look", slot: "e", prio: 4, campaignSafe: true, label: "Look it over",
        canShow: function (t) { return !!(t && t.plot); }, onSelect: function (t) { lookOver(t.plot); } },
      { id: "plots-own-sell", slot: "e", hold: true, prio: 4, campaignSafe: true,
        label: function (t) { const z = Z(), p = t && t.plot && z && z.sellPriceForLot ? z.sellPriceForLot(t.plot.lot) : null; return "Put it up for sale" + (p != null ? " " + money(p) : ""); },
        canShow: function (t) { return !!(t && t.plot && !t.plot.data.sale); },
        onSelect: function (t) { if (listForSale(t.plot)) refreshSigns(true); } },
      { id: "plots-own-unsell", slot: "e", hold: true, prio: 4, campaignSafe: true, label: "Take the sign down",
        canShow: function (t) { return !!(t && t.plot && t.plot.data.sale); },
        onSelect: function (t) { if (unlist(t.plot)) refreshSigns(true); } },
      // the contractor: asked for twice, because it cannot be put back
      { id: "plots-own-demolish", wheel: true, prio: 3, campaignSafe: true, bad: true,
        label: function (t) { const q = t && t.plot ? demoQuote(t.plot) : null; return (sureDemo === (t && t.plot && t.plot.id) && clock < sureDemoT ? "Yes, knock it down " : "Have it knocked down ") + (q && q.ok ? money(q.cost) : ""); },
        canShow: function (t) { const q = t && t.plot && !t.plot.lot.demolished && !pendingDemo ? demoQuote(t.plot) : null; return !!(q && q.ok && canAfford(q.cost)); },
        onSelect: function (t) {
          const plot = t.plot;
          if (sureDemo !== plot.id || clock >= sureDemoT) { sureDemo = plot.id; sureDemoT = clock + 8; note("A contractor takes " + plot.name + " down to a bare pad. Ask again and it is ordered.", 3.4); return; }
          sureDemo = null;
          orderDemolition(plot);
        } },
    ];
    for (let i = 0; i < ACT_N; i++) {
      postOpts.push({ id: "plots-own-act-" + i, wheel: true, prio: 2, campaignSafe: true,
        label: (function (k) { return function (t) { const a = t && t.plot ? lotActions(t.plot)[k] : null; return a ? a.label : ""; }; })(i),
        canShow: (function (k) { return function (t) { return !!(t && t.plot && lotActions(t.plot)[k]); }; })(i),
        onSelect: (function (k) {
          return function (t) {
            const a = t && t.plot ? lotActions(t.plot)[k] : null; if (!a || typeof a.onClick !== "function") return;
            let res = null; try { res = a.onClick(); } catch (e) { res = null; console.warn("[plots] action", e); }
            if (typeof res === "string" && res) note(res, 2.8);
            actCache.delete(t.plot.id);
          };
        })(i) });
    }
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
      options: postOpts,
    });
    if (I.describe) I.describe("property", function (t) {
      if (!t || !t.plot) return { label: "Your lot", note: "" };
      return { label: t.plot.name, note: t.plot.data.sale ? "for sale" : "yours" };
    });
  }

  /* ============================================================
     8. THE TICK
     ============================================================ */
  let syncT = 0, lastInside = null, insideNoteT = 0, lastArena = null;
  CBZ.onUpdate(46.2, function (dt) {
    if (!inCity()) return;
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
    clock += dt;
    if (soldT.size) for (const [l, t] of soldT) if (clock - t >= SOLD_SECS) { soldT.delete(l); lastSX = 1e9; }
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
    if (g.state === "playing") tickSales(dt);
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
  });

  CBZ.cityPlotsReset = function () {
    pendingDemo = null; watchClear.length = 0;
    for (const plot of plots.values()) lockDoors(plot.lot, false);
    plots.clear(); ownSig = "";
    for (const mk of markers.values()) { if (mk.group.parent) mk.group.parent.remove(mk.group); }
    markers.clear();
    for (const s of signs) { s.lot = null; s.group.visible = false; }
    lastSX = lastSZ = 1e9;
    _spHydrated = null;
    actCache.clear();
  };
})();
