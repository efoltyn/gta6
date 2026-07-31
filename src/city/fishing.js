/* ============================================================
   city/fishing.js — SOMEBODY FISHES HERE, AND SO CAN YOU.

   THE HOLE THIS FILLS
   -------------------
   city/level.js has carried a "Fisherman" title for its whole life and NOBODY
   in this world has ever been cast as one. Meanwhile the only way a mackerel
   has ever been harvested is by SHOOTING it: wildlife.js registers every
   aquatic species as a huntable target whose "Fresh Fish" and "Fish Fillet"
   drop from the SKINNING interaction on its carcass. A city with a marina, a
   pier, a fuel dock and a fish in the water, where the only fishing verb is a
   rifle, is a hole in the world — not a missing minigame.

   WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
   --------------------------------------------
   NOT a minigame framework. There is no cast-arc physics, no lure inventory,
   no tension bar, no second economy. A catch is routed through the pipeline
   that already exists:

       CBZ.WILDLIFE_SPECIES  ->  the fish that live in this water
       CBZ.cityEcon.add(...) ->  the SAME "Fresh Fish" / "Fish Fillet" items
                                 wildlife.js's skin() grants, already priced,
                                 already tagged `valuable`, already bought by
                                 the pawn shop and the fence

   so the day somebody adds a species to wildlife/aquatic.js it is catchable
   here with no edit, and a fish caught on a rod sells for exactly what a fish
   shot with a rifle sells for. There is NO fish table in this file.

   THREE PIECES, in the order they matter:

     1. A STATION. `CBZ.fishSpotRegister(x, z, opts)` is a place a line can go
        in the water: a pier head, a quay edge, the end of a fuel pontoon. It
        VALIDATES ITSELF against CBZ.cityWaterAt — a station whose water is not
        water is refused and counted, so nobody can register a fishing spot on
        dry land or on the frozen lake and have it quietly work.

     2. THE PEOPLE. `CBZ.fishWorkRod(ped, spot)` hands an ordinary posted ped a
        rod and a slow cast/settle/haul cycle. It authors no body and no brain:
        the ped comes from city/citystaff.js -> occupy.js's cityPostNpc, peds.js
        holds him at his post, entities/poses.js's existing `table` pose puts
        his forearms out, and this file adds ONE mesh and one angle per frame.
        He is a normal NPC — killable through the killfeed bus, aimable, and
        every ped verb interactions.js already registers works on him.

     3. THE PLAYER. One interaction option on the station: cast, wait, and set
        the hook inside the bite window. It borrows the whole UI — the option
        label IS the readout, which is why there is no new HUD element here
        (HUD doctrine: the only popup is the killfeed).

   WHY THE BITE IS A WINDOW AND NOT A TIMER: the same reason predator.js's
   circling mostly ends in nothing. A cue that always pays is not a cue. The
   wait is variable, most of it is quiet, and the strike is a single telegraphed
   press — never a mash meter.

   DETERMINISM: nothing here is on a world-build path. Stations are registered
   from authored coordinates by their venue; the wait, the bite and which fish
   is on the end are RUNTIME rolls (CLAUDE.md: "Runtime-only FX may use
   Math.random"), exactly like wildlife.js's own skin() quality roll.

   FLAGS: CBZ.CONFIG.CITY_FISHING (all of it) · CITY_FISHING_PLAYER (the player
   loop only — leave the workers, drop the verb).

   AUDIT / RATCHET: CBZ.fishAudit() -> { spots, refused, worked, ... }.
   `refused` is a station that lied about its water and must read 0.
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const THREE = window.THREE;

  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.CITY_FISHING == null) CFG.CITY_FISHING = true;
  if (CFG.CITY_FISHING_PLAYER == null) CFG.CITY_FISHING_PLAYER = true;
  // FISH_CHUM — a landed fish bleeds into the water gore.js's chum bus
  // publishes, so a busy fishing spot eventually draws something with teeth.
  // One-line revert to a fishing spot that costs nothing but time.
  if (CFG.FISH_CHUM == null) CFG.FISH_CHUM = true;
  function on() { return CFG.CITY_FISHING !== false; }

  const REACH = 3.4;             // how close you stand to a station to use it
  const CAST_T = 0.9;            // the throw, before the line is in the water
  const WAIT_MIN = 4.5, WAIT_MAX = 16.0;   // quiet water. Most of fishing is this.
  const BITE_T = 1.15;           // the window you have to set the hook in
  const SNAG_CHANCE = 0.18;      // a wait that ends in nothing at all

  const spots = [];              // { x, z, y, face, name, water:{x,z}, rod }
  const rods = [];               // NPC anglers: { ped, spot, mesh, t, phase }
  let refused = 0, playerCatches = 0, playerMisses = 0, npcHauls = 0;
  let propsDone = false, anchorDone = false;

  function note(m, s, o) { if (CBZ.city && CBZ.city.note) { try { CBZ.city.note(m, s, o); } catch (e) {} } }
  function sfx(n) { if (CBZ.sfx) { try { CBZ.sfx(n); } catch (e) {} } }
  function isWater(x, z) {
    if (!CBZ.cityWaterAt) return true;                 // no water oracle: trust the caller
    try { return !!CBZ.cityWaterAt(x, z); } catch (e) { return true; }
  }

  /* ==========================================================================
     1. THE STATION.

     `opts.water` is where the line lands — the caller knows which way the sea
     is and this file must not guess. It is also the ONLY thing that makes a
     station honest, so it is the thing that gets tested: a station whose water
     point is not water is REFUSED, not quietly accepted. That is the whole
     reason biome_snow.js does not register one on its frozen lake.
     ========================================================================== */
  CBZ.fishSpotRegister = function (x, z, opts) {
    if (!on()) return null;
    opts = opts || {};
    const w = opts.water || { x: x, z: z };
    if (!isWater(w.x, w.z)) { refused++; return null; }
    // A world REBUILD re-runs every landmass builder, so beach.js and marina.js
    // hand us the same coordinates again. Dedupe rather than accumulate — the
    // seed is fixed for a session, so the same station arrives at the same
    // metre and this is exact, not a heuristic.
    for (let i = 0; i < spots.length; i++) {
      const q = spots[i];
      if (Math.abs(q.x - x) < 0.5 && Math.abs(q.z - z) < 0.5) return q;
    }
    const s = {
      x: +x, z: +z, y: opts.y != null ? +opts.y : 0,
      face: opts.face != null ? +opts.face : Math.atan2(w.x - x, w.z - z),
      name: opts.name || "the water",
      water: { x: +w.x, z: +w.z },
      rod: opts.rod !== false,          // draw a rod on a rest here (see §1b)
      mesh: null, worker: null,
    };
    spots.push(s);
    return s;
  };
  CBZ.fishSpots = function () { return spots; };
  CBZ.fishSpotsReset = function () {
    for (let i = 0; i < spots.length; i++) {
      const m = spots[i].mesh;
      if (m && m.parent) m.parent.remove(m);
    }
    spots.length = 0; rods.length = 0;
    refused = 0; propsDone = false; anchorDone = false;
  };

  /* --- §1b THE ROD ON THE REST -------------------------------------------
     An interaction hotspot you cannot SEE is a secret, not a feature. Every
     station that did not already have a rod drawn beside it (beach.js's pier
     head does — it has drawn two since the day it shipped, propping up a
     fishing scene with no fisherman in it) gets one rod in a rest, which is
     both the "you can fish here" read and the thing you are picking up.

     Deferred to a one-shot tick: stations are registered from inside landmass
     builders, when CBZ.city.arena does not exist yet — the same reason
     marina.js defers its own moored hulls.
     ----------------------------------------------------------------------- */
  let rodGeo = null, restGeo = null, rodMat = null, restMat = null;
  function rodStock() {
    if (rodGeo || !THREE) return;
    rodGeo = new THREE.BoxGeometry(0.045, 2.4, 0.045); rodGeo._shared = true;
    restGeo = new THREE.BoxGeometry(0.16, 0.5, 0.16); restGeo._shared = true;
    const m = CBZ.cmat || CBZ.mat;
    rodMat = m ? m(0x5e4a30) : new THREE.MeshLambertMaterial({ color: 0x5e4a30 });
    restMat = m ? m(0x3a3f44) : new THREE.MeshLambertMaterial({ color: 0x3a3f44 });
  }
  function buildProps() {
    if (propsDone || !THREE) return;
    const root = (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || CBZ.scene;
    if (!root) return;
    propsDone = true;
    rodStock();
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      if (!s.rod || s.mesh) continue;
      const g = new THREE.Group();
      g.position.set(s.x + Math.sin(s.face) * 0.5, s.y, s.z + Math.cos(s.face) * 0.5);
      g.rotation.y = s.face;
      g.userData.dynamic = true;          // never bake a usable prop into the batch
      const rest = new THREE.Mesh(restGeo, restMat);
      rest.position.set(0, 0.25, 0); rest.castShadow = false; g.add(rest);
      const rod = new THREE.Mesh(rodGeo, rodMat);
      rod.position.set(0, 1.1, 0.35); rod.rotation.x = -0.55; rod.castShadow = false; g.add(rod);
      root.add(g);
      s.mesh = g;
    }
  }

  /* --- §1c THE WORK ANCHOR ------------------------------------------------
     "fisherman" is a real trade in aigoals.js's CITY_JOBS (registered against
     anchor kind "fishing" by city/citystaff.js), and a trade whose anchor kind
     nothing publishes is the same dead promise marina.js's `kind:"work"` was.
     So the stations THEMSELVES are the anchor — one record, whose task spots
     are the places a line actually goes in.
     ----------------------------------------------------------------------- */
  function buildAnchor() {
    if (anchorDone || !spots.length || !CBZ.registerWorkAnchor) return;
    anchorDone = true;
    let cx = 0, cz = 0;
    const pts = [];
    for (let i = 0; i < spots.length; i++) { cx += spots[i].x; cz += spots[i].z; pts.push({ x: spots[i].x, z: spots[i].z }); }
    try {
      CBZ.registerWorkAnchor({
        biome: "coast", kind: "fishing", role: "fisherman",
        x: cx / spots.length, z: cz / spots.length, cap: spots.length,
        spots: pts,
      });
    } catch (e) {}
  }

  /* ==========================================================================
     2. THE PEOPLE WHO FISH.

     One mesh and one angle. The BODY is somebody else's — city/citystaff.js
     posted it, peds.js's posted-staff brain holds it, poses.js's `table` pose
     put the forearms out. All this adds is the rod in them and the fact that
     it moves.

     The cycle is deliberately slow and mostly still: settle, settle, settle,
     a haul, recast. Fishing that visibly twitches every second reads as a
     man having a fit.
     ========================================================================== */
  CBZ.fishWorkRod = function (ped, spot) {
    if (!on() || !ped || !ped.group || !THREE) return null;
    for (let i = 0; i < rods.length; i++) if (rods[i].ped === ped) return rods[i];
    // The caller may hand us its own placement record rather than a station
    // handle (venues declare their people before they know what a station is),
    // so resolve the real station from where the body is standing. That is what
    // makes fishAudit().worked mean "this station has a fisherman at it".
    if ((!spot || !spot.water) && ped.pos) {
      const s = nearestSpot(ped.pos.x, ped.pos.z);
      if (s) spot = s;
    }
    rodStock();
    const mesh = new THREE.Mesh(rodGeo, rodMat);
    // held out in front at hand height; the rig's own arms are already there
    mesh.position.set(0.22, 1.12, 0.46);
    mesh.rotation.x = -0.6;
    mesh.castShadow = false;
    mesh.userData.dynamic = true;
    ped.group.add(mesh);
    const rec = { ped: ped, spot: (spot && spot.water) ? spot : null, mesh: mesh, t: 2 + Math.random() * 9, phase: "settle" };
    rods.push(rec);
    if (rec.spot) rec.spot.worker = ped;
    return rec;
  };

  function stepRods(dt) {
    for (let i = rods.length - 1; i >= 0; i--) {
      const r = rods[i];
      const p = r.ped;
      // the body left the world (killed, swept, or citystaff gave it back):
      // the rod goes with it, and a dead angler drops his line.
      if (!p || p.dead || !p.group || !p.group.parent || (CBZ.cityPeds && CBZ.cityPeds.indexOf(p) < 0)) {
        if (r.mesh && r.mesh.parent) r.mesh.parent.remove(r.mesh);
        if (r.spot && r.spot.worker === p) r.spot.worker = null;
        rods.splice(i, 1);
        continue;
      }
      r.t -= dt;
      if (r.phase === "settle") {
        // a rod at rest breathes with the swell, it does not wave
        r.mesh.rotation.x = -0.60 + Math.sin((CBZ.now || 0) * 0.0011 + i) * 0.035;
        if (r.t <= 0) { r.phase = "haul"; r.t = 1.5; npcHauls++; }
      } else if (r.phase === "haul") {
        // one honest arc: lift, hold, lower. 1.5s of the whole minute.
        const u = 1 - Math.max(0, r.t) / 1.5;
        const lift = Math.sin(Math.min(1, u) * Math.PI);
        r.mesh.rotation.x = -0.60 - lift * 0.85;
        if (r.t <= 0) { r.phase = "settle"; r.t = 8 + Math.random() * 14; }
      }
    }
  }

  /* ==========================================================================
     3. THE PLAYER'S LINE.

     Cast -> wait -> (bite window) -> set the hook. Four states, one key, and
     the option LABEL is the entire readout. Anything that takes the body away
     — walking off the station, dying, getting in a vehicle, a menu — reels the
     line in, so this can never own the player.
     ========================================================================== */
  let line = null;               // { spot, phase, t, wait }
  function playerOn() { return on() && CFG.CITY_FISHING_PLAYER !== false; }
  function drop(msg) {
    if (!line) return;
    line = null;
    if (msg) note(msg, 1.6);
  }

  // THE FISH ARE THE WORLD'S FISH. No table here: read the live species
  // registry, keep the ones that live in water and are not going to eat you
  // (a great white on a rod is a different game), and weight by the rarity
  // wildlife.js already declares. A species added to wildlife/aquatic.js is
  // catchable the day it lands, with no edit to this file.
  const RARITY_W = { common: 1.0, uncommon: 0.35, rare: 0.09, legendary: 0.015 };
  function catchable() {
    const S = CBZ.WILDLIFE_SPECIES || {};
    const out = [];
    for (const id in S) {
      const sp = S[id];
      if (!sp || !sp.aquatic || !sp.fur) continue;
      if ((sp.danger || 0) > 0.2 || (sp.bite || 0) > 0) continue;   // not on a rod
      out.push(sp);
    }
    return out;
  }
  function rollFish() {
    const list = catchable();
    if (!list.length) return null;
    let total = 0;
    for (let i = 0; i < list.length; i++) total += RARITY_W[list[i].rarity] || 0.2;
    let r = Math.random() * total;
    for (let i = 0; i < list.length; i++) {
      r -= RARITY_W[list[i].rarity] || 0.2;
      if (r <= 0) return list[i];
    }
    return list[0];
  }
  function land(spot) {
    const sp = rollFish();
    const econ = CBZ.cityEcon;
    if (!sp || !econ || !econ.add) { note("Nothing biting today.", 1.8); return; }
    econ.add(sp.fur, 1);
    // a bigger fish is worth filleting; the roll is the same shape wildlife.js
    // uses for its meat yield, and both items were registered by registerPelts.
    if (sp.meat && Math.random() < 0.55) econ.add(sp.meat, 1);
    playerCatches++;
    const worth = (econ.ITEMS && econ.ITEMS[sp.fur] && econ.ITEMS[sp.fur].value) || sp.furValue || 8;
    sfx("pickup");
    note("Landed a " + sp.name + " → " + sp.fur + " (~$" + worth + ")", 2.6);

    // BLOOD IN THE WATER. A landed fish bleeds where it came out, and gore.js's
    // chum bus is what turns that into a consequence: predator.js polls
    // CBZ.goreChumList() at 2.5 Hz and every shark's chumR reaches 200+ units,
    // so working one spot long enough draws something bigger than what you are
    // catching. That is the whole point — the sea should have an opinion about
    // you standing at its edge pulling fish out of it.
    //
    // No new blood system: ONE goreChum handle at the station's own water
    // point (fishSpotRegister already VALIDATED that point is water, so this
    // can never chum a car park). The rate rides the fish's own value, so a
    // mackerel is a whiff and a big fish is a signal, and the whole thing costs
    // nothing when GORE_WATER is off — goreChum returns null.
    if (CBZ.goreChum && CFG.FISH_CHUM !== false) {
      const w = spot && spot.water ? spot.water : spot;
      if (w && Number.isFinite(w.x) && Number.isFinite(w.z)) {
        const y = (CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(w.x, w.z) : 0) - 0.4;
        // 0.22 for a mackerel (value 8) up to the 1.0 cap for anything serious.
        const rate = Math.max(0.2, Math.min(1, 0.18 + worth / 90));
        try { CBZ.goreChum(w.x, y, w.z, rate, 9 + rate * 10); } catch (e) {}
      }
    }
  }

  function nearestSpot(px, pz) {
    let best = null, bd = REACH * REACH;
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      const dx = s.x - px, dz = s.z - pz, d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = s; }
    }
    return best;
  }
  function playerBusy() {
    const P = CBZ.player;
    if (!P || P.dead || P.driving) return true;
    if (CBZ.cityMenuOpen) return true;
    if (CBZ.game && CBZ.game.mode !== "city") return true;
    return false;
  }

  function press(spot) {
    if (!playerOn()) return;
    if (!line) {
      // A station whose worker is standing at it is HIS rod; you take the
      // other one. There is always the rod on the rest, so this never refuses.
      line = { spot: spot, phase: "cast", t: CAST_T, wait: 0 };
      sfx("whoosh");
      return;
    }
    if (line.phase === "bite") {
      const s = line.spot;
      line = null;
      land(s);
      return;
    }
    // casting or waiting: this is the reel-in
    drop("Reeled in.");
  }

  function stepLine(dt) {
    if (!line) return;
    const P = CBZ.player;
    if (playerBusy()) { drop(null); return; }
    const s = line.spot;
    const dx = P.pos.x - s.x, dz = P.pos.z - s.z;
    if (dx * dx + dz * dz > (REACH + 1.6) * (REACH + 1.6)) { drop("Line's gone slack."); return; }
    line.t -= dt;
    if (line.phase === "cast") {
      if (line.t <= 0) { line.phase = "wait"; line.t = WAIT_MIN + Math.random() * (WAIT_MAX - WAIT_MIN); }
      return;
    }
    if (line.phase === "wait") {
      if (line.t > 0) return;
      // MOST WAITS END IN NOTHING. That is the point: a cue that reliably
      // pays stops being a cue (predator.js's menace gauge, applied to a rod).
      if (Math.random() < SNAG_CHANCE) {
        line.phase = "wait"; line.t = WAIT_MIN + Math.random() * (WAIT_MAX - WAIT_MIN);
        return;
      }
      line.phase = "bite"; line.t = BITE_T;
      return;
    }
    if (line.phase === "bite" && line.t <= 0) {
      playerMisses++;
      line.phase = "wait"; line.t = WAIT_MIN * 0.6 + Math.random() * WAIT_MAX;
      note("It shook the hook.", 1.4);
    }
  }

  /* ---- the one interaction. The LABEL is the readout — no new HUD. ------- */
  let wired = false;
  function wireZone() {
    if (wired || !CBZ.interactions || !CBZ.interactions.registerZone) return;
    wired = true;
    const I = CBZ.interactions;
    I.registerZone({
      id: "fishing-spot", kind: "fishing", prio: 6, driving: false, radius: REACH,
      find: function (px, pz) {
        if (!playerOn() || !spots.length) return null;
        return nearestSpot(px, pz);
      },
      options: [{
        id: "fish-cast", slot: "e",
        label: function () {
          if (!line) return "Cast a line";
          if (line.phase === "cast") return "Casting…";
          if (line.phase === "bite") return "SET THE HOOK";
          return "Reel in";
        },
        onSelect: function (s) { press(s); },
      }],
    });
    if (I.describe) I.describe("fishing", function (s) {
      return { label: (s && s.name) || "Fishing spot", note: "A rod, a rest, and the water" };
    });
  }

  /* ==========================================================================
     THE TICK — 41.9, immediately behind city/citystaff.js's staffing pass
     (41.86) so a rod handed to a body this frame is animated the same frame.
     ========================================================================== */
  let lastRoot = null;
  if (CBZ.onUpdate) CBZ.onUpdate(41.9, function (dt) {
    if (!on()) return;
    if (!wired) wireZone();
    if (!CBZ.game || CBZ.game.mode !== "city") { if (line) line = null; return; }
    // A REBUILT ARENA is a new scene graph: the rod props we drew belong to a
    // root that has been thrown away, so drop the references and draw them
    // again. The stations themselves survive (they are coordinates), and the
    // work anchor does not — worldmap.js wipes cityWorkAnchors per build.
    const root = (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || null;
    if (root && root !== lastRoot) {
      lastRoot = root;
      for (let i = 0; i < spots.length; i++) spots[i].mesh = null;
      propsDone = false; anchorDone = false;
      if (line) line = null;
    }
    if (!propsDone) buildProps();
    if (!anchorDone) buildAnchor();
    if (rods.length) stepRods(dt);
    stepLine(dt);
  });

  /* ==========================================================================
     THE AUDIT (CLAUDE.md BLOCK LAW #5).

     `refused` is the ratchet and reads 0: a station whose water point is not
     water is a fishing spot on dry land, which is exactly the class of lie
     this file exists to avoid — and it is measured, not asserted, because the
     water mask moves (waterSurge/floodReach) and a coastline can change.
     Everything else is evidence: `worked` proves the fishermen are real bodies
     and not a claim, and `playerCatches` proves the loop is reachable.
     ========================================================================== */
  CBZ.fishAudit = function () {
    let worked = 0, live = 0;
    for (let i = 0; i < spots.length; i++) if (spots[i].worker && !spots[i].worker.dead) worked++;
    for (let i = 0; i < rods.length; i++) if (rods[i].ped && !rods[i].ped.dead) live++;
    return {
      spots: spots.length,
      refused: refused,          // PIN AT 0 — a station that lied about its water
      worked: worked,            // stations with a live fisherman at them
      anglers: live,             // NPCs holding a rod right now
      npcHauls: npcHauls,
      playerCatches: playerCatches,
      playerMisses: playerMisses,
      species: catchable().length,
      casting: !!line,
      enabled: on(),
      playerLoop: playerOn(),
    };
  };
})();
