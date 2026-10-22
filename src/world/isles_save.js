/* ============================================================
   world/isles_save.js — THE ISLES REMEMBER.

   Close the game on The Isles and open it again: you are on the island you
   left, where you stood, at the hour you left it, with the same money in
   your pocket, the car you bought parked where you left it, the flat and
   what is in its wardrobe, the room at the hotel until its checkout, your
   rank in the army and your missed musters, the shark's book, the goods
   that are still hot, and the clerk you shot still dead.

   ONE SAVE. This is not a store of its own: it is a slice of the character's
   ledger (city/worldstate.js CBZ.cityWorldIsles: the CBZ_CITY_WORLD_V2 slot,
   sqlite with the localStorage mirror, the permadeath block, New Life's
   wipe). The wallet (cash, bank, loans incl. the bank's g.cityLoans, the
   pockets g.cityInv, the guns, the wardrobe) is the character's and rides
   the ledger's own fields; this file writes the slice:
     { v, island, pos{x,y,z,face}, clock{phase,day,pace}, staked,
       cars[{model,color,island,x,y,z,heading}],      g.isleCars
       homes{"<island>:<lot>": {mode,rent,paidTo,seized,stash{cash,guns}}}, g.isleHomes
       army{...} | null,                              g.isleArmy
       shark{loans,repaid},                           CBZ.loanShark
       lodging{key,until,wake} | null,                CBZ.islandLodging
       hot{name:[{age,where}]},                       g.cityHot
       dead{"<island>:<lot>:<job>:<x>,<z>": day} }    g.isleDead
   Plain data, keyed by island id and lot id, never a mesh or an index. A
   slice of another version is ignored (the wallet still loads); a field that
   does not read right is dropped on its own; nothing here throws into the
   game.

   WHEN. On a sleep (the clock jumps), on owning or losing something (a car,
   a flat, a rental, a loan, the army, what you carry), on walking into or
   out of a place, every two minutes, when you pause or go to the title, and
   when the page is hidden or closed.

   THE CLOCK. The pace clock (rent, the vig, the musters) and the sky clock
   come back where they were: a debt grows by the time you played, never by
   the time the game was shut.

   LOADING. The first start of The Isles on a page (a run starting, not a
   respawn) loads the slice before the island's reset; the archipelago
   builds the island you were on first (CBZ.islesSave.island(), read by
   world/archipelago.js), and after the reset you are put back where you
   stood. Wanted stars are not kept: a run begins clean.

   A FRESH START is the title's New Life (systems/newlife.js), shown on The
   Isles too: it wipes the one ledger.

   API  CBZ.islesSave = { island(), save(why), loaded(), slice() }
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.game) return;
  const g = CBZ.game;
  const MODE = "archipelago";
  const V = 1;
  const AUTOSAVE_S = 120;
  const MIN_GAP_S = 4;              // the soonest a second triggered save follows one
  const REHIRE_DAYS = 7;            // world/island_people.js: the dead stay dead this long

  let loaded = false;
  let lastSlice = null;

  function led() { return CBZ.cityWorldIsles || null; }
  function num(v, d) { v = +v; return isFinite(v) ? v : d; }
  function str(v) { return typeof v === "string" && v ? v : null; }
  function nowS() { return (CBZ.now || 0) / 1000; }
  function arena() { return CBZ.surv && CBZ.surv.arena; }
  function islandId() { const A = arena(); return (A && A.id) || null; }
  function valid(s) { return !!(s && typeof s === "object" && s.v === V); }
  function live() { return g.mode === MODE && loaded; }
  function groundY(x, z) { const A = arena(); return A && A.groundHeightAt ? A.groundHeightAt(x, z) : 0; }

  /* ---- OUT ---------------------------------------------------------------- */
  function where() {
    const P = CBZ.player, id = islandId();
    if (!P || !P.pos || P.dead || !id || P._aircraft) return null;
    let x = P.pos.x, y = P.pos.y, z = P.pos.z;
    const c = P.driving ? P._vehicle : null;
    if (c && c.pos) {
      // beside the car you were driving, on the driver's side
      const h = c.heading || 0;
      x = c.pos.x + Math.cos(h) * 2.4; z = c.pos.z - Math.sin(h) * 2.4; y = groundY(x, z);
    }
    if (groundY(x, z) < 0.3) return null;                 // at sea: the island's own spawn
    const face = CBZ.cam ? CBZ.cam.yaw - Math.PI : 0;
    return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, z: Math.round(z * 100) / 100, face: Math.round(face * 1000) / 1000 };
  }
  function forecourt(b) {
    // a car still on the showroom floor is saved where it is moved to once
    // nobody is looking (world/island_dealers.js outFront): out front
    const lot = CBZ.islandVenue && CBZ.islandVenue.lotFor ? CBZ.islandVenue.lotFor(b) : null;
    const D = lot && lot.building && lot.building.door;
    if (!D) return null;
    const x = D.x + D.nx * 6.5 + D.nz * 3, z = D.z + D.nz * 6.5 - D.nx * 3;
    return { x: x, y: groundY(x, z), z: z, heading: Math.atan2(D.nz, -D.nx) };
  }
  function carsOut() {
    const out = [];
    for (const r of g.isleCars || []) {
      if (!r) continue;
      let x = r.x, y = r.y, z = r.z, h = r.heading;
      const c = r.car;
      if (c && c.dead) continue;
      if (c && c.pos && !c._scrapped) { x = c.pos.x; y = c.pos.y; z = c.pos.z; h = c.heading || 0; }
      if (r.showroom) { const f = forecourt(r.showroom); if (f) { x = f.x; y = f.y; z = f.z; h = f.heading; } }
      if (!isFinite(x) || !isFinite(z)) continue;
      out.push({ model: str(r.model), color: isFinite(+r.color) ? +r.color : null, island: str(r.island),
        x: x, y: num(y, 0), z: z, heading: num(h, 0) });
    }
    return out;
  }
  function stashOut(S) {
    return { cash: Math.max(0, Math.floor(num(S && S.cash, 0))),
      guns: S && Array.isArray(S.guns) ? S.guns.filter(function (s) { return typeof s === "string"; }) : [] };
  }
  function homesOut() {
    const H = g.isleHomes || {}, out = {};
    for (const k in H) {
      const r = H[k];
      if (!r) continue;
      const mode = r.mode === "own" || r.mode === "rent" ? r.mode : null;
      const st = stashOut(r.stash);
      if (!mode && !r.seized && !st.cash && !st.guns.length) continue;
      out[k] = { mode: mode, rent: num(r.rent, 0), paidTo: mode === "own" ? null : num(r.paidTo, 0), seized: !!r.seized,
        seizedDay: r.seized ? num(r.seizedDay, 0) : null, stash: st };
    }
    return out;
  }
  function hotOut() {
    const H = g.cityHot || {}, out = {}, t = nowS();
    for (const n in H) {
      const L = H[n];
      if (!Array.isArray(L) || !L.length) continue;
      out[n] = L.map(function (h) { return { age: Math.max(0, t - num(h && h.t, t)), where: h && h.where != null ? h.where : null }; });
    }
    return out;
  }
  function deadOut() {
    const D = g.isleDead || {}, out = {}, day = CBZ.dayCount ? CBZ.dayCount() : 0;
    let n = 0;
    for (const k in D) {
      const d = num(D[k], null);
      if (d == null || day - d >= REHIRE_DAYS) continue;
      out[k] = d;
      if (++n >= 400) break;
    }
    return out;
  }
  // the dealers' sold spots (world/island_dealers.js): kept a couple of days
  function soldOut() {
    const D = g.isleSold || {}, out = {}, day = CBZ.dayCount ? CBZ.dayCount() : 0;
    for (const k in D) { const d = num(D[k], null); if (d != null && day - d < 2) out[k] = d; }
    return out;
  }
  function collect() {
    const prev = lastSlice || {};
    const s = { v: V, island: islandId() || prev.island || null, pos: where() };
    if (!s.pos && prev.pos && prev.island === s.island) s.pos = prev.pos;   // in a plane: the last place you stood
    s.clock = { phase: CBZ.dayPhase ? CBZ.dayPhase() : 0, day: CBZ.dayCount ? CBZ.dayCount() : 0, pace: CBZ.paceTime ? CBZ.paceTime() : 0 };
    s.staked = !!g._islesStake;
    s.cars = carsOut();
    s.homes = homesOut();
    s.army = g.isleArmy && typeof g.isleArmy === "object" ? JSON.parse(JSON.stringify(g.isleArmy)) : null;
    s.shark = CBZ.loanShark && CBZ.loanShark.snapshot ? CBZ.loanShark.snapshot() : null;
    s.lodging = CBZ.islandLodging && CBZ.islandLodging.snapshot ? CBZ.islandLodging.snapshot() : null;
    s.hot = hotOut();
    s.dead = deadOut();
    s.sold = soldOut();
    return s;
  }

  let lastSave = -1e9;
  function save(why) {
    if (!live() || !led()) return false;
    let s = null;
    try { s = collect(); } catch (e) { console.error("[isles save]", e); return false; }
    let ok = false;
    try { ok = !!led().commit(s); } catch (e) { console.error("[isles save]", e); ok = false; }
    if (ok) { lastSlice = s; lastSave = nowS(); }
    return ok;
  }

  /* ---- IN ----------------------------------------------------------------- */
  function step(name, fn) { try { fn(); } catch (e) { console.error("[isles load " + name + "]", e); } }
  function apply(s) {
    step("clock", function () {
      const c = s.clock || {};
      if (CBZ.dayCount && isFinite(+c.day)) CBZ.dayCount(+c.day);
      if (CBZ.dayPhase && isFinite(+c.phase)) CBZ.dayPhase(+c.phase);
      if (CBZ.paceTime && isFinite(+c.pace)) CBZ.paceTime(+c.pace);
    });
    step("stake", function () { if (s.staked) g._islesStake = true; });
    step("cars", function () {
      const out = [];
      for (const r of Array.isArray(s.cars) ? s.cars : []) {
        if (!r || !isFinite(+r.x) || !isFinite(+r.z)) continue;
        out.push({ model: str(r.model), color: isFinite(+r.color) ? +r.color : undefined, island: str(r.island),
          x: +r.x, y: num(r.y, 0), z: +r.z, heading: num(r.heading, 0), car: null, showroom: null });
      }
      g.isleCars = out;
    });
    step("homes", function () {
      const H = {};
      const src = s.homes && typeof s.homes === "object" ? s.homes : {};
      for (const k in src) {
        const r = src[k];
        if (!r || typeof k !== "string") continue;
        const mode = r.mode === "own" || r.mode === "rent" ? r.mode : null;
        H[k] = { mode: mode, rent: num(r.rent, 0), paidTo: mode === "own" ? Infinity : num(r.paidTo, 0), stash: stashOut(r.stash) };
        if (r.seized) { H[k].seized = true; H[k].seizedDay = num(r.seizedDay, 0); }
      }
      g.isleHomes = H;
    });
    step("army", function () {
      const A = s.army;
      g.isleArmy = A && typeof A === "object" && typeof A.rank === "string" && typeof A.island === "string"
        ? { rank: A.rank, island: A.island, musters: A.musters | 0, strikes: A.strikes | 0, lastDay: num(A.lastDay, 0),
            since: num(A.since, 0), reported: !!A.reported }
        : null;
    });
    step("shark", function () { if (CBZ.loanShark && CBZ.loanShark.restore) CBZ.loanShark.restore(s.shark || null); });
    step("lodging", function () { if (CBZ.islandLodging && CBZ.islandLodging.restore) CBZ.islandLodging.restore(s.lodging || null); });
    step("hot", function () {
      const H = {}, t = nowS(), src = s.hot && typeof s.hot === "object" ? s.hot : {};
      for (const n in src) {
        if (!Array.isArray(src[n])) continue;
        const L = src[n].filter(Boolean).map(function (h) { return { t: t - Math.max(0, num(h.age, 0)), where: h.where != null ? h.where : null }; });
        if (L.length) H[n] = L;
      }
      g.cityHot = H;
    });
    step("dead", function () {
      const D = {}, src = s.dead && typeof s.dead === "object" ? s.dead : {};
      for (const k in src) if (isFinite(+src[k])) D[k] = +src[k];
      g.isleDead = D;
    });
    step("sold", function () {
      const D = {}, src = s.sold && typeof s.sold === "object" ? s.sold : {};
      for (const k in src) if (isFinite(+src[k])) D[k] = +src[k];
      g.isleSold = D;
    });
  }
  // the first start of The Isles on this page: the wallet and the slice
  function load() {
    const L = led();
    if (!L) return null;
    let s = null;
    try { s = L.begin(); } catch (e) { console.error("[isles load]", e); s = null; }
    if (!valid(s)) return null;
    apply(s);
    lastSlice = s;
    const p = s.pos;
    return p && str(s.island) && isFinite(+p.x) && isFinite(+p.z) ? { island: s.island, x: +p.x, y: num(p.y, null), z: +p.z, face: num(p.face, 0) } : null;
  }
  // back where you stood, when the island in force is the one you left
  function place(R) {
    const A = arena(), P = CBZ.player, PC = CBZ.playerChar;
    if (!A || A.id !== R.island || !P || !P.pos) return;
    const gy = groundY(R.x, R.z);
    const y = R.y != null && R.y > gy - 0.5 ? R.y : gy;
    P.pos.set(R.x, y, R.z);
    P.vy = 0; P.grounded = true;
    if (PC && PC.group) { PC.group.position.copy(P.pos); PC.group.rotation.set(0, R.face, 0); }
    if (CBZ.cam) CBZ.cam.yaw = R.face + Math.PI;
  }

  /* ---- THE MODE'S RESET: a run starting loads, a respawn does not -------- */
  function wrapReset() {
    const m = CBZ.modes && CBZ.modes[MODE];
    if (!m || typeof m.reset !== "function") return false;
    if (m._islesSaveWrap) return true;
    const orig = m.reset;
    m.reset = function () {
      const starting = g.state !== "playing";
      let back = null;
      if (starting && !loaded) { back = load(); loaded = true; }
      const r = orig.apply(this, arguments);
      if (back) { try { place(back); } catch (e) { console.error("[isles place]", e); } }
      if (starting) { sigNow = sig(); lastSave = nowS(); }
      return r;
    };
    m._islesSaveWrap = true;
    return true;
  }
  wrapReset();

  /* ---- WHEN TO SAVE ------------------------------------------------------- */
  // what you own and carry, cheap to read: a change in it is a save
  function sig() {
    const parts = [];
    const C = g.isleCars || [];
    parts.push(C.length);
    const H = g.isleHomes || {};
    for (const k in H) { const r = H[k]; if (r) parts.push(k + (r.mode || "-") + (r.stash ? (r.stash.cash | 0) + "/" + ((r.stash.guns && r.stash.guns.length) | 0) : "")); }
    const A = g.isleArmy;
    parts.push(A ? A.rank + (A.strikes | 0) + (A.musters | 0) + (A.reported ? 1 : 0) : "no-army");
    const SL = g.sharkLoans || [];
    for (const l of SL) parts.push(l.key + ":" + (l.stage | 0) + ":" + Math.round(l.owed / 100));
    const LG = CBZ.islandLodging && CBZ.islandLodging.snapshot ? CBZ.islandLodging.snapshot() : null;
    parts.push(LG ? LG.key + "@" + Math.round(LG.until * 100) : "no-room");
    const inv = g.cityInv || {};
    let items = 0;
    for (const n in inv) items += inv[n] | 0;
    parts.push(items, (CBZ.weaponInventory || []).length, (g.cityLoans || []).length);
    return parts.join("|");
  }
  // the venue you are standing in (a building with a use), or null
  function venueAt() {
    const IV = CBZ.islandVenue, FIT = CBZ.islandFit, P = CBZ.player;
    if (!IV || !IV.list || !FIT || !FIT.frame || !P || !P.pos) return null;
    const L = IV.list();
    for (let i = 0; i < L.length; i++) {
      const b = L[i];
      const hw = (b.lw || b.w || 0) / 2, hd = (b.ld || b.d || 0) / 2;
      if (!(hw > 0) || Math.abs(P.pos.x - b.ox) > hw + hd || Math.abs(P.pos.z - b.oz) > hw + hd) continue;
      const q = FIT.frame(b).l(P.pos.x, P.pos.z);
      if (Math.abs(q.x) < hw && Math.abs(q.z) < hd) return b;
    }
    return null;
  }
  let sigNow = "", sigT = 0, autoT = 0, paceLast = null, sleepT = -1, venue = null, venueT = 0, wantSave = null;
  if (CBZ.onUpdate) CBZ.onUpdate(46.9, function (dt) {
    if (!live()) return;
    if (!wrapReset()) return;
    dt = dt || 0;
    const t = nowS();
    // a night slept (the clock jumps): once the morning is in
    const pc = CBZ.paceTime ? CBZ.paceTime() : 0;
    if (paceLast != null && pc - paceLast > 0.05) sleepT = 1.2;
    paceLast = pc;
    if (sleepT >= 0) { sleepT -= dt; if (sleepT < 0) wantSave = "sleep"; }
    // owning, losing, buying
    if ((sigT += dt) >= 1) {
      sigT = 0;
      const s = sig();
      if (s !== sigNow) { sigNow = s; wantSave = wantSave || "owned"; }
    }
    // in at a door, out at a door
    if ((venueT += dt) >= 0.5) {
      venueT = 0;
      const b = venueAt();
      if (b !== venue) { venue = b; wantSave = wantSave || "venue"; }
    }
    if ((autoT += dt) >= AUTOSAVE_S) { autoT = 0; wantSave = wantSave || "auto"; }
    if (wantSave && t - lastSave >= MIN_GAP_S) {
      const why = wantSave;
      wantSave = null;
      if (save(why)) autoT = 0;
    }
  });
  // pausing, the title, another game: the moment play stops
  let wasPlaying = false;
  if (CBZ.onAlways) CBZ.onAlways(46.9, function () {
    const on = g.state === "playing" && g.mode === MODE;
    if (wasPlaying && !on && loaded) save("stop");
    wasPlaying = on;
  });
  /* THE PAGE GOING AWAY. Synchronous, in the handler itself: collect() is
     plain reads and worldstate.js's save() writes the localStorage copy with
     setItem before it returns (sqlite is handed the same blob alongside), so
     nothing here waits on a frame, a promise or a timer. Paused or playing:
     a blur pauses the game before the page is hidden, and a hidden page
     runs no more frames for the "stop" save above. */
  function onHide() { if (g.mode === MODE && loaded) save("hide"); }
  try {
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") onHide(); });
    window.addEventListener("pagehide", onHide);
  } catch (e) {}

  CBZ.islesSave = {
    // the island a saved game is on (world/archipelago.js builds it first)
    island: function () {
      if (lastSlice) return lastSlice.island || null;
      const L = led();
      let s = null;
      try { s = L ? L.read() : null; } catch (e) { s = null; }
      return valid(s) ? str(s.island) : null;
    },
    save: save,
    loaded: function () { return loaded; },
    slice: function () { return lastSlice ? JSON.parse(JSON.stringify(lastSlice)) : null; },
  };
})();
