/* ============================================================
   net/netpersist.js — FiveM-style persistence client.
     - CBZ.netPid(): a stable per-browser identity (localStorage),
       carried in the hello so the server can key your character.
     - charBlob: this player's progress (the shared worldstate
       ledger + portfolio/garage/outfit/ammo/position) → csave.
     - worldBlob (WORLD HOST only): gang control, wall holes,
       the NPC ledger, day phase → wsave.
   Inert in single-player and on servers without the "persist"
   feature — everything here is feature-detected off the welcome.
============================================================ */
(function () {
  "use strict";
  if (typeof window === "undefined" || !window.CBZ) return;
  const CBZ = window.CBZ;
  const g = CBZ.game;

  // ---- stable player identity (exported early; net.js sends it in hello) ----
  let pid = null;
  CBZ.netPid = function () {
    if (pid) return pid;
    try { pid = localStorage.getItem("cbz_pid") || null; } catch (e) {}
    if (!pid) {
      pid = "";
      for (let i = 0; i < 16; i++) pid += ((Math.random() * 16) | 0).toString(16);
      try { localStorage.setItem("cbz_pid", pid); } catch (e) {}
    }
    return pid;
  };

  const net = CBZ.net;
  if (!net || !net.onEv) return;

  // ---- feature detect + per-connection state --------------------------------
  let featPersist = false, autosaveSec = 120;
  let pendingChar = null, pendingWorld = null, charApplied = false;
  let settleT = 0, worldWait = 0, charT = 0, worldT = 0;

  net.on("welcome", function (m) {
    const feat = m.feat || (m.server && m.server.feat) || [];
    featPersist = feat.indexOf("persist") >= 0;
    autosaveSec = (+(m.autosaveSec || (m.world && m.world.autosaveSec) ||
      (m.server && (m.server.autosaveSec || (m.server.world && m.server.world.autosaveSec))))) || 120;
    pendingChar = pendingWorld = null;
    charApplied = false;
    settleT = worldWait = charT = worldT = 0;
  });
  net.on("_offline", function () { featPersist = false; pendingChar = pendingWorld = null; });

  function copy(o) { try { return JSON.parse(JSON.stringify(o)); } catch (e) { return null; } }
  function round1(v) { return Math.round(v * 10) / 10; }
  function lotArr() {
    const A = CBZ.city && CBZ.city.arena;
    if (!A || !A.lots) return null;
    return [].concat(A.lots, (A.annex && A.annex.lots) || []);
  }
  function weaponIdx(id) {
    const W = CBZ.FPS_WEAPONS;
    if (W) for (let i = 0; i < W.length; i++) if (W[i].id === id || W[i].key === id) return i;
    return -1;
  }

  // ---- charBlob: everything that makes YOU you on this server ---------------
  function ammoMap() {
    const f = CBZ.fps;
    if (!f || !f.rounds || !f.reserves) return null;
    const out = {};
    for (const id of CBZ.weaponInventory || []) {
      const i = weaponIdx(id);
      if (i >= 0) out[id] = [f.rounds[i] | 0, f.reserves[i] | 0];
    }
    return out;
  }

  function propsBlob() {
    const out = {
      owned: {},
      mortgages: copy(g.cityMortgages || {}),
      rentals: copy(g.cityRentals || {}),
      tenants: copy(g.cityTenants || {}),
      rentedHome: g.cityRentedHome || null,
      homeId: null,
    };
    const list = CBZ.cityZillow && CBZ.cityZillow.listings && CBZ.cityZillow.listings();
    if (list) for (const rec of list) {
      if (g.cityRealtyOwned && g.cityRealtyOwned[rec.id]) {
        // enough to rebuild the deed: what you paid + a seized op's flipped books
        out.owned[rec.id] = { paid: rec.boughtAt || 0, legal: !!rec.legal, cat: rec.category };
      }
      if (g.cityHome && g.cityHome.lot === rec.lot) out.homeId = rec.id;
    }
    return out;
  }

  function charBlob() {
    const P = CBZ.player;
    return {
      v: 1,
      name: net.name, role: net.role,
      pos: (P && P.pos) ? [round1(P.pos.x), round1(P.pos.y), round1(P.pos.z)] : null,
      // the shared single-player ledger IS the core of the character (cash/bank/
      // respect/inventory/weapon unlocks/records/businesses/luxury — one collector)
      ledger: CBZ.cityWorldCollect ? copy(CBZ.cityWorldCollect()) : null,
      ammo: ammoMap(),
      outfit: { id: g.cityOutfitId || null, owned: copy(g.cityOutfitsOwned || null) },
      props: propsBlob(),
      garage: (g.cityGarage || []).slice(),
      air: { pent: !!g.cityOwnsPenthouse, heli: !!g.cityOwnsHeli, hangar: !!g.cityOwnsHangar },
      jail: { busted: !!g.busted },
    };
  }

  // ---- worldBlob (host only): the city the crew comes back to ----------------
  function worldBlob() {
    const blob = { v: 1, savedAt: Date.now() };
    const lots = lotArr(), gangs = [];
    for (const gang of CBZ.cityGangs || []) {
      if (gang.id === "player") continue;          // crew members are live ped refs — not serializable
      const turf = [];
      if (lots && gang.turf) for (const lot of gang.turf) {
        const i = lots.indexOf(lot);
        if (i >= 0) turf.push(i);
      }
      gangs.push({
        id: gang.id, treasury: Math.round(gang.treasury || 0), standing: gang.standing || 0,
        provoke: gang.provoke || 0, hostility: gang.hostility || 0,
        warWith: gang.warWith || null, warRemain: gang.warRemain || 0, turf,
      });
    }
    if (gangs.length) blob.gangs = gangs;
    if (CBZ.cityFracture && CBZ.cityFracture.serialize) try { blob.fracture = CBZ.cityFracture.serialize(); } catch (e) {}
    if (CBZ.cityNpcLedger && CBZ.cityNpcLedger.serialize) try { blob.npc = CBZ.cityNpcLedger.serialize(); } catch (e) {}
    if (CBZ.cityFamilyTree && CBZ.cityFamilyTree.serialize) try { blob.fam = CBZ.cityFamilyTree.serialize(); } catch (e) {}
    if (CBZ.building && CBZ.building.serialize) try { blob.bld = CBZ.building.serialize(); } catch (e) {}
    // B6: BaseRecords ride their OWN rider (NOT folded into blob.bld) so a
    // world's ownership claims restore independently of piece geometry —
    // see systems/baseclaim.js's file header for why.
    if (CBZ.baseClaim && CBZ.baseClaim.serialize) try { blob.base = CBZ.baseClaim.serialize(); } catch (e) {}
    if (CBZ.dayPhase) blob.day = CBZ.dayPhase();
    if (g.cityPropMkt) blob.propMkt = copy(g.cityPropMkt);   // macro market rides the save
    if (CBZ.market && CBZ.market.serialize) try { blob.mkt = CBZ.market.serialize(); } catch (e) {}
    if (CBZ.econState && CBZ.econState.serialize) try { blob.econ = CBZ.econState.serialize(); } catch (e) {}
    if (CBZ.npcEcon && CBZ.npcEcon.serialize) try { blob.npce = CBZ.npcEcon.serialize(); } catch (e) {}
    return blob;
  }

  // ---- apply: character (queued until the city run is up; pos lands AFTER spawn)
  function applyChar(c) {
    if (!c || c.v !== 1) { if (c) console.warn("[netpersist] char blob v" + c.v + " — skipped"); return; }
    if (c.ledger && CBZ.cityWorldAdopt) {
      // the server's character wins over whatever the local reset/ledger dealt
      if (CBZ.resetWeaponInventory) CBZ.resetWeaponInventory();
      g.cityEmpireBiz = {}; g.cityLuxury = {};
      CBZ.cityWorldAdopt(c.ledger);
      if (CBZ.fpsResetWeapons) CBZ.fpsResetWeapons();
      g._wealthHydrated = false;        // wealth.js re-hydrates businesses/luxury from the adopted ledger
    }
    if (c.ammo && CBZ.fps && CBZ.fps.rounds) {
      for (const id in c.ammo) {
        const i = weaponIdx(id);
        if (i < 0) continue;
        CBZ.fps.rounds[i] = c.ammo[id][0] | 0;
        CBZ.fps.reserves[i] = c.ammo[id][1] | 0;
      }
      if (CBZ.fps.weapon != null) {
        CBZ.fps.ammo = CBZ.fps.rounds[CBZ.fps.weapon];
        CBZ.fps.reserve = CBZ.fps.reserves[CBZ.fps.weapon];
      }
    }
    if (c.outfit) {
      if (c.outfit.owned) {
        g.cityOutfitsOwned = g.cityOutfitsOwned || {};
        for (const k in c.outfit.owned) g.cityOutfitsOwned[k] = true;
      }
      if (c.outfit.id && CBZ.cityWearOutfit) CBZ.cityWearOutfit(c.outfit.id, { silent: true });
    }
    applyProps(c.props);
    if (Array.isArray(c.garage)) g.cityGarage = c.garage.slice();
    if (c.air) { g.cityOwnsPenthouse = !!c.air.pent; g.cityOwnsHeli = !!c.air.heli; g.cityOwnsHangar = !!c.air.hangar; }
    if (c.pos && CBZ.player && CBZ.player.pos) {
      CBZ.player.pos.set(+c.pos[0] || 0, +c.pos[1] || 0, +c.pos[2] || 0);
      CBZ.player.vy = 0;
      if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(CBZ.player.pos);
    }
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  // re-deed the portfolio through the live zillow registry so rent/income/
  // menus/respawn all work off the real records, not dead flags
  function applyProps(p) {
    if (!p) return;
    g.cityRealtyOwned = {};
    for (const id in (p.owned || {})) g.cityRealtyOwned[id] = true;
    g.cityMortgages = copy(p.mortgages) || {};
    g.cityRentals = copy(p.rentals) || {};
    g.cityTenants = copy(p.tenants) || {};
    g.cityRentedHome = p.rentedHome || null;
    const list = CBZ.cityZillow && CBZ.cityZillow.listings && CBZ.cityZillow.listings();
    if (!list) return;
    let homeLot = null;
    for (const rec of list) {
      const o = (p.owned || {})[rec.id];
      if (!o && rec.ownerId === "player") { // a re-apply revokes deeds the save doesn't carry
        rec.ownerId = null;
        const h = rec.lot.building && rec.lot.building.home;
        if (h) h.owned = false;
      }
      if (o) {
        rec.ownerId = "player";
        if (o.paid) rec.boughtAt = o.paid;
        if (o.legal != null) rec.legal = !!o.legal;     // a seized op stays flipped legit
        if (o.cat) rec.category = o.cat;
        const home = rec.lot.building && rec.lot.building.home;
        if (home) home.owned = true;
      }
      if (p.homeId && rec.id === p.homeId) homeLot = rec.lot;
      if (p.rentedHome === rec.id && rec.lot.building && !g.citySpawnPoint) {
        const door = rec.lot.building.door || { x: rec.lot.cx, z: rec.lot.cz };
        g.citySpawnPoint = { x: door.x, z: door.z };
      }
    }
    if (homeLot && CBZ.cityZillow.setHomeByLot) CBZ.cityZillow.setHomeByLot(homeLot);
  }

  // ---- apply: world (first host after server boot; queued until gangs exist) -
  function applyWorld(w) {
    if (!w || w.v !== 1) { console.warn("[netpersist] world blob v" + (w && w.v) + " — skipped"); return; }
    if (w.gangs) applyGangs(w.gangs);
    if (w.fracture && CBZ.cityFracture && CBZ.cityFracture.apply) try { CBZ.cityFracture.apply(w.fracture); } catch (e) { console.error("[netpersist]", e); }
    if (w.npc && CBZ.cityNpcLedger && CBZ.cityNpcLedger.apply) try { CBZ.cityNpcLedger.apply(w.npc); } catch (e) { console.error("[netpersist]", e); }
    if (w.fam && CBZ.cityFamilyTree && CBZ.cityFamilyTree.apply) try { CBZ.cityFamilyTree.apply(w.fam); } catch (e) { console.error("[netpersist]", e); }
    // B6: restore BaseRecords BEFORE the pieces (w.bld) below — a replayed
    // cupboard's onPiecePlace hook checks CBZ.baseAt() to decide whether to
    // mint a NEW record; applying blob.base first means it finds the
    // already-restored record (matching id/authorized/lastBreach) instead
    // of manufacturing a duplicate.
    if (w.base && CBZ.baseClaim && CBZ.baseClaim.apply) try { CBZ.baseClaim.apply(w.base); } catch (e) { console.error("[netpersist]", e); }
    if (w.bld && CBZ.building && CBZ.building.apply) try { CBZ.building.apply(w.bld); } catch (e) { console.error("[netpersist]", e); }
    if (w.day != null && CBZ.dayPhase) CBZ.dayPhase(w.day);
    if (w.propMkt) { const m = copy(w.propMkt); if (m) g.cityPropMkt = m; }
    if (w.mkt && CBZ.market && CBZ.market.apply) try { CBZ.market.apply(w.mkt); } catch (e) { console.error("[netpersist]", e); }
    if (w.econ && CBZ.econState && CBZ.econState.apply) try { CBZ.econState.apply(w.econ); } catch (e) { console.error("[netpersist]", e); }
    if (w.npce && CBZ.npcEcon && CBZ.npcEcon.apply) try { CBZ.npcEcon.apply(w.npce); } catch (e) { console.error("[netpersist]", e); }
  }

  function applyGangs(rows) {
    const lots = lotArr(), gangs = CBZ.cityGangs || [];
    for (const row of rows) {
      let gang = null;
      for (const x of gangs) if (x.id === row.id) { gang = x; break; }
      if (!gang) continue;
      gang.treasury = row.treasury || 0;
      gang.standing = row.standing || 0;
      gang.provoke = row.provoke || 0;
      gang.hostility = row.hostility || 0;
      gang.warWith = row.warWith || null;
      gang.warRemain = row.warRemain || 0;
      if (lots && Array.isArray(row.turf)) for (const i of row.turf) {
        const lot = lots[i];
        if (!lot || !lot.building || gang.turf.indexOf(lot) >= 0) continue;
        for (const other of gangs) {             // same hand-off mechanics turf wars use
          const j = other.turf ? other.turf.indexOf(lot) : -1;
          if (j >= 0) other.turf.splice(j, 1);
        }
        gang.turf.push(lot);
        lot.building.gang = gang.id;
        lot.building.gangColor = gang.color;
      }
      if (gang.turf && gang.turf.length && gang.center) {
        let sx = 0, sz = 0;
        for (const l of gang.turf) { sx += l.cx; sz += l.cz; }
        gang.center.x = sx / gang.turf.length;
        gang.center.z = sz / gang.turf.length;
      }
    }
  }

  // ---- wire: loads come down as ev subtypes; saves go up the same envelope ---
  net.onEv("cload", function (m) { if (m && m.char) pendingChar = m.char; });
  net.onEv("wload", function (m) { if (m && m.world) pendingWorld = m.world; });

  function sendChar() { try { net.sendEv({ e: "csave", char: charBlob() }); } catch (e) {} }
  function sendWorld() {
    try {
      const w = worldBlob(); // the relay hard-drops sockets past ~1.5MB — never risk the host's
      if (JSON.stringify(w).length > 1400 * 1024) return;
      net.sendEv({ e: "wsave", world: w });
    } catch (e) {}
  }
  // don't let a fresh-spawn body overwrite the saved character before the
  // cload lands (it arrives right after join; 10s of play = no save existed).
  // playT accumulates across pauses — a player who pauses early still crosses it.
  let playT = 0;
  function charSafe() { return !pendingChar && (charApplied || playT > 10); }

  if (CBZ.onAlways) CBZ.onAlways(62, function (dt) {
    if (!net.active || !featPersist) return;
    if (g.mode !== "city" || g.state !== "playing" || !(CBZ.city && CBZ.city.arena)) { settleT = 0; return; }
    playT += dt;
    settleT += dt;
    if (settleT < 0.4) return;                   // land AFTER the mode reset + spawn placement
    if (pendingChar) {
      const c = pendingChar; pendingChar = null; charApplied = true;
      try { applyChar(c); } catch (e) { console.error("[netpersist]", e); }
    }
    if (pendingWorld && net.isHost()) {
      worldWait += dt;
      const needGangs = pendingWorld.gangs && !(CBZ.cityGangs && CBZ.cityGangs.length);
      if (!needGangs || worldWait > 12) {        // bail to a partial apply if gangs never spawn
        const w = pendingWorld; pendingWorld = null;
        try { applyWorld(w); } catch (e) { console.error("[netpersist]", e); }
      }
    }
    charT += dt;
    if (charT >= 60) { charT = 0; if (charSafe()) sendChar(); }
    if (net.isHost()) {
      worldT += dt;
      if (worldT >= autosaveSec) { worldT = 0; if (!pendingWorld) sendWorld(); }
    }
  });

  // ---- flush on the way out (tab close / background) -------------------------
  function flush() {
    if (!net.active || !featPersist || g.mode !== "city") return;
    if (charSafe()) sendChar();
    if (net.isHost() && !pendingWorld) sendWorld();
  }
  if (typeof addEventListener === "function") addEventListener("pagehide", flush);
  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") flush();
    });
  }
})();
