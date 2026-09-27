/* ============================================================
   warlord/war/bridge.js — THE ZOOM-IN. A sim battle, fought for real.

   W.war.bridge.watch(G, battleId):
     1. freezes that battle in the sim (sim.watch) and stops the war clock;
     2. hides the war map (the view keeps everything built, it just gives
        the scene back: fog, sky, lens, shadows);
     3. scales both sides to figures (at most 60 a side, same men per
        figure on both sides, so the odds on the sand are the odds on the
        map), stands the warlord on ground that matches the battle tile
        (the real island spot for the island map, else a spot on the island
        of the same battle biome), and hands the fight to battle.js;
     4. when battle.js ends it calls opts.onEnd(report) instead of the old
        campaign's aftermath: the dead figures become loss fractions,
        sim.resolveExternal applies them, the old roster and position are
        put back, and the war map comes back up.
============================================================ */
(function () {
  "use strict";
  const G0 = typeof window !== "undefined" ? window : globalThis;
  const CBZ = (G0.CBZ = G0.CBZ || {});
  const W = (CBZ.warlord = CBZ.warlord || {});
  const WAR = (W.war = W.war || {});
  const B = (WAR.bridge = WAR.bridge || {});

  const MAX_FIG = 60, MIN_FIG = 4;
  const spotCache = {};
  let busy = false;

  function mulberry(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function sideMen(G, ids) {
    let n = 0;
    for (const id of ids) { const a = WAR.sim.army(G, id); if (a) n += a.men; }
    return n;
  }
  /* WHERE ON THE ISLAND. The island map knows its own metres; any other map
     borrows a patch of the island whose ground is the same kind as the
     battle tile's (M.battleBiome), searched once per biome and cached. */
  function spotFor(M, tile) {
    const w = M.worldOf ? M.worldOf(tile) : null;
    if (w && isFinite(w.x) && isFinite(w.z)) return { x: w.x, z: w.z };
    const biome = M.battleBiome ? M.battleBiome(tile) : "gravel";
    if (spotCache[biome]) return spotCache[biome];
    const D = W.desert;
    let p = null;
    if (D && D.landPoint) {
      const r = mulberry(0x5eed + biome.length * 977 + biome.charCodeAt(0));
      try { p = D.landPoint(r, { biome: biome === "shore" ? null : biome, maxSlope: 0.28, maxR: (D.RADIUS || 6700) * 0.8 }); } catch (e) { p = null; }
    }
    p = p ? { x: p.x, z: p.z } : { x: 0, z: 0 };
    spotCache[biome] = p;
    return p;
  }
  function rosterFaction(G, owner, army) {
    if (army && army.rogue) return "bandit";
    if (army && army.free) return "militia";
    return owner === G.player ? "company" : "legion";
  }

  B.busy = function () { return busy; };
  B.watch = function (G, battleId) {
    const S = WAR.sim, V = WAR.view, UI = WAR.ui;
    if (busy || !G || !S) return false;
    const b = S.battleById(G, battleId);
    if (!b || !W.battle || !W.battle.start) return false;
    const M = G.M;
    const mineKey = b.defOwner === G.player && b.attOwner !== G.player ? "def" : "att";
    const theirKey = mineKey === "att" ? "def" : "att";
    const mineMen = sideMen(G, b[mineKey]), theirMen = sideMen(G, b[theirKey]);
    if (mineMen <= 0 || theirMen <= 0) return false;
    // one ratio for both sides: the odds on the sand are the odds on the map
    const perFig = Math.max(1, Math.max(mineMen, theirMen) / MAX_FIG);
    const mineFig = Math.max(MIN_FIG, Math.min(MAX_FIG, Math.round(mineMen / perFig)));
    const theirFig = Math.max(MIN_FIG, Math.min(MAX_FIG, Math.round(theirMen / perFig)));

    S.watch(G, battleId, true);
    busy = true;
    if (UI && UI.bridgeBegin) UI.bridgeBegin();
    if (V && V.hide) V.hide();

    const ST = W.state;
    const savedArmy = ST.army.slice();
    const savedYou = Object.assign({}, ST.you);
    const mineA = S.army(G, b[mineKey][0]), theirA = S.army(G, b[theirKey][0]);
    const mineBand = W.makeBand({ size: mineFig, faction: rosterFaction(G, b[mineKey === "att" ? "attOwner" : "defOwner"], mineA) });
    const theirBand = W.makeBand({ size: theirFig, faction: rosterFaction(G, b[theirKey === "att" ? "attOwner" : "defOwner"], theirA) });
    const TF = G.factions[theirA && theirA.free ? 0 : b[theirKey + "Owner"]];
    theirBand.name = String((theirA && theirA.name) || (TF && TF.name) || "the enemy").toUpperCase();
    // their banner is their colour on the map
    if (TF && TF.colour != null) theirBand.colour = TF.colour;
    const spot = spotFor(M, b.tile);
    ST.army.length = 0;
    for (const s of mineBand.men) ST.army.push(s);
    ST.you.x = spot.x; ST.you.z = spot.z;
    ST.you.hp = ST.you.maxHp || 140;
    ST.you.wid = "ak47";          // a commander on the field carries a rifle; the ride keeps its pistol
    theirBand.x = spot.x + 40; theirBand.z = spot.z;

    let done = false;
    function finish(report) {
      if (done) return;
      done = true;
      const deadMine = report ? (report.yourDead || []).length : 0;
      const deadTheirs = report ? (report.theirDead || []).length : 0;
      const won = report && report.outcome === "won";
      const mineLoss = Math.min(1, deadMine / Math.max(1, mineFig));
      const theirLoss = Math.min(1, deadTheirs / Math.max(1, theirFig));
      const res = {
        attLossFrac: mineKey === "att" ? mineLoss : theirLoss,
        defLossFrac: mineKey === "att" ? theirLoss : mineLoss,
        winner: won ? mineKey : theirKey,
      };
      // the old campaign's roster and warlord, exactly as they were
      ST.army.length = 0;
      for (const s of savedArmy) ST.army.push(s);
      Object.assign(ST.you, savedYou);
      try { S.resolveExternal(G, battleId, res); } catch (e) { console.error("[war/bridge] resolve", e); }
      busy = false;
      // the phase first: leaving "battle" runs battle.js's teardown, which puts
      // the fog, the lens and the shadows back; only then does the map take them
      if (W.setPhase) W.setPhase("war");
      if (V && V.show) V.show();
      if (UI && UI.bridgeEnd) UI.bridgeEnd();
      B.last = { battle: battleId, mineFig: mineFig, theirFig: theirFig, perFig: Math.round(perFig), deadMine: deadMine, deadTheirs: deadTheirs, res: res };
    }
    try {
      W.battle.start({ band: theirBand, onEnd: finish });
    } catch (e) {
      console.error("[war/bridge] battle", e);
      finish(null);
      return false;
    }
    return true;
  };
})();
